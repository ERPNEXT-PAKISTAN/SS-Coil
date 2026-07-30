"""Sales Order process charge lines (Slitting / Leveling / Reshearing).

When a production SO item has Slitter / Leveler / Reshearing set, matching
non-stock service rows are added so each process can be invoiced at its own rate.
"""

from __future__ import annotations

import frappe
from frappe import _
from frappe.custom.doctype.custom_field.custom_field import create_custom_fields
from frappe.utils import flt

from ss_coil.api import PROCESS_FIELDS, PROCESS_LABELS, _get_enabled_processes_from_row, _has_field

PROCESS_CHARGE_CATALOG = {
	"slitter": {
		"item_code": "Slitting Charges",
		"item_name": "Slitting Charges",
		"rate": 20.0,
		"description": "Coil slitting / process charge",
	},
	"leveler": {
		"item_code": "Leveling Charges",
		"item_name": "Leveling Charges",
		"rate": 25.0,
		"description": "Coil leveling / process charge",
	},
	"reshearing": {
		"item_code": "Reshearing Charges",
		"item_name": "Reshearing Charges",
		"rate": 10.0,
		"description": "Coil reshearing / process charge",
	},
}


def _default_uom():
	for candidate in ("Kg", "kg", "Nos", "Unit"):
		if frappe.db.exists("UOM", candidate):
			return candidate
	return "Nos"


def ensure_process_charge_items():
	"""Create/update the three process-charge service items and SO marker fields."""
	_ensure_process_charge_custom_fields()
	uom = _default_uom()
	created = []
	for process_key, meta in PROCESS_CHARGE_CATALOG.items():
		item_code = meta["item_code"]
		if frappe.db.exists("Item", item_code):
			updates = {
				"is_stock_item": 0,
				"is_sales_item": 1,
				"include_item_in_manufacturing": 0,
			}
			if _has_field("Item", "custom_ss_coil_item_type"):
				updates["custom_ss_coil_item_type"] = ""
			if flt(frappe.db.get_value("Item", item_code, "standard_rate") or 0) <= 0:
				updates["standard_rate"] = meta["rate"]
			frappe.db.set_value("Item", item_code, updates, update_modified=False)
			continue

		doc = frappe.get_doc(
			{
				"doctype": "Item",
				"item_code": item_code,
				"item_name": meta["item_name"],
				"description": meta["description"],
				"item_group": _service_item_group(),
				"stock_uom": uom,
				"is_stock_item": 0,
				"is_sales_item": 1,
				"is_purchase_item": 0,
				"include_item_in_manufacturing": 0,
				"standard_rate": meta["rate"],
			}
		)
		if _has_field("Item", "custom_ss_coil_item_type"):
			doc.custom_ss_coil_item_type = ""
		doc.flags.ignore_permissions = True
		doc.insert(ignore_permissions=True)
		created.append(item_code)

	frappe.clear_cache(doctype="Item")
	frappe.clear_cache(doctype="Sales Order Item")
	return {"created": created, "catalog": {k: v["item_code"] for k, v in PROCESS_CHARGE_CATALOG.items()}}


def _service_item_group():
	for name in ("Services", "Service", "All Item Groups"):
		if frappe.db.exists("Item Group", name):
			return name
	return frappe.db.get_single_value("Stock Settings", "item_group") or "Products"


def _ensure_process_charge_custom_fields():
	fields = [
		{
			"fieldname": "custom_is_process_charge",
			"label": "Is Process Charge",
			"fieldtype": "Check",
			"insert_after": "item_code",
			"default": "0",
			"read_only": 1,
			"print_hide": 1,
			"report_hide": 1,
		},
		{
			"fieldname": "custom_process_charge_key",
			"label": "Process Charge Key",
			"fieldtype": "Data",
			"insert_after": "custom_is_process_charge",
			"read_only": 1,
			"hidden": 1,
			"print_hide": 1,
			"report_hide": 1,
		},
		{
			"fieldname": "custom_process_charge_source",
			"label": "Process Charge Source",
			"fieldtype": "Data",
			"insert_after": "custom_process_charge_key",
			"read_only": 1,
			"hidden": 1,
			"print_hide": 1,
			"report_hide": 1,
			"description": "Sales Order Item name this charge belongs to",
		},
	]
	to_create = [f for f in fields if not frappe.db.exists("Custom Field", f"Sales Order Item-{f['fieldname']}")]
	if to_create:
		create_custom_fields({"Sales Order Item": to_create}, update=True)


def is_process_charge_row(row):
	if bool(cint_safe(row.get("custom_is_process_charge"))) or bool(row.get("custom_process_charge_key")):
		return True
	# Fallback: known process-charge service items (markers may be missing briefly)
	item_code = row.get("item_code")
	if not item_code:
		return False
	return item_code in {meta["item_code"] for meta in PROCESS_CHARGE_CATALOG.values()}


def cint_safe(value):
	try:
		return int(value or 0)
	except Exception:
		return 0


def process_charge_item_code(process_key):
	meta = PROCESS_CHARGE_CATALOG.get(process_key)
	return meta["item_code"] if meta else None


def process_charge_rate(process_key):
	item_code = process_charge_item_code(process_key)
	if not item_code:
		return 0
	if frappe.db.exists("Item", item_code):
		rate = flt(frappe.db.get_value("Item", item_code, "standard_rate"))
		if rate:
			return rate
	return flt(PROCESS_CHARGE_CATALOG.get(process_key, {}).get("rate"))


def _source_rows(doc):
	return [row for row in (doc.items or []) if row.item_code and not is_process_charge_row(row)]


def _charge_rows(doc):
	return [row for row in (doc.items or []) if is_process_charge_row(row)]


def _charge_source_specs(doc):
	"""Yield (charge_source_key, commercial_or_proxy_row, process_keys).

	Prefers Coil Production Line processes; charge lines still attach to the
	linked Finish Good Sales Order Item name (or production line name).
	"""
	from ss_coil.coil_production import (
		get_coil_production_rows,
		production_line_as_so_item_proxy,
		sales_order_has_coil_production,
	)

	if sales_order_has_coil_production(doc):
		for prod in get_coil_production_rows(doc):
			processes = _get_enabled_processes_from_row(prod, custom=False)
			if not processes:
				continue
			so_item = None
			if prod.get("sales_order_item"):
				so_item = next(
					(r for r in (doc.items or []) if r.name == prod.sales_order_item),
					None,
				)
			proxy = production_line_as_so_item_proxy(prod, so_item)
			# Prefer commercial SO Item name so DN/invoice stay tied to FG line
			source_key = (so_item.name if so_item else None) or prod.name
			if not source_key:
				continue
			# Ensure qty/item_name available on proxy for charge description
			if so_item:
				proxy.qty = so_item.qty
				proxy.uom = so_item.uom
				proxy.warehouse = so_item.warehouse
				proxy.delivery_date = so_item.delivery_date
				proxy.conversion_factor = so_item.conversion_factor
				proxy.name = so_item.name
			else:
				proxy.name = source_key
			yield source_key, proxy, processes
		return

	for source in _source_rows(doc):
		if not source.name:
			continue
		processes = _get_enabled_processes_from_row(source, custom=True)
		if processes:
			yield source.name, source, processes


def _charge_source_aliases(doc):
	"""Map production-line name <-> commercial SO Item name to one canonical key."""
	from ss_coil.coil_production import get_coil_production_rows, sales_order_has_coil_production

	aliases = {}
	if not sales_order_has_coil_production(doc):
		return aliases
	for prod in get_coil_production_rows(doc):
		canonical = prod.get("sales_order_item") or prod.name
		if not canonical:
			continue
		aliases[canonical] = canonical
		if prod.name:
			aliases[prod.name] = canonical
		if prod.get("sales_order_item"):
			aliases[prod.sales_order_item] = canonical
	return aliases


def sync_sales_order_process_charge_lines(doc, method=None):
	"""Maintain process charge lines on Sales Order Items.

	With Coil Production Line, commercial Items must stay Finish Good only —
	auto charge rows were perceived as “double items” and churned on every
	save (remove + re-add). When production exists we strip charge rows and
	clear process flags from FG items; charges are not auto-created.
	"""
	if getattr(doc, "doctype", None) != "Sales Order":
		return
	if not _has_field("Sales Order Item", "custom_is_process_charge"):
		return
	if doc.docstatus and cint_safe(doc.docstatus) > 0:
		return

	from ss_coil.coil_production import sales_order_has_coil_production

	if sales_order_has_coil_production(doc):
		# Clear process flags from FG — they live on Coil Production only
		for row in _source_rows(doc):
			for fieldname in (
				"custom_slitter",
				"custom_leveler",
				"custom_reshearing",
				"custom_packing_type",
				"custom_packing_weightsize",
				"custom_no_of_pack",
				"custom_packing_remarks",
				"custom_packing_comments",
			):
				if _has_field("Sales Order Item", fieldname) and row.get(fieldname) not in (None, ""):
					row.set(fieldname, "")
		# Remove auto process-charge lines so Items stay FG-only
		for charge in list(_charge_rows(doc)):
			doc.remove(charge)
		_dedupe_commercial_items_by_stock_entry_detail(doc)
		return

	# Legacy Sales Orders without Coil Production: keep old charge sync behaviour
	wanted = {}  # (source_name, process_key) -> source_row
	for source_key, source, processes in _charge_source_specs(doc):
		for process_key in processes:
			wanted[(source_key, process_key)] = source

	aliases = _charge_source_aliases(doc)

	to_remove = []
	seen = set()
	for charge in _charge_rows(doc):
		raw_source = charge.get("custom_process_charge_source")
		process_key = charge.get("custom_process_charge_key")
		if not process_key:
			for catalog_key, meta in PROCESS_CHARGE_CATALOG.items():
				if charge.get("item_code") == meta["item_code"]:
					process_key = catalog_key
					charge.custom_process_charge_key = process_key
					charge.custom_is_process_charge = 1
					break

		canonical_source = aliases.get(raw_source, raw_source) if raw_source else raw_source
		key = (canonical_source, process_key)
		source = wanted.get(key) if key[0] and key[1] else None
		if not source or key in seen:
			to_remove.append(charge)
			continue
		seen.add(key)
		_apply_charge_values(charge, source, key[1], overwrite_rate=False)

	for charge in to_remove:
		doc.remove(charge)

	for key, source in wanted.items():
		if key in seen:
			continue
		process_key = key[1]
		item_code = process_charge_item_code(process_key)
		if not item_code or not frappe.db.exists("Item", item_code):
			continue
		row = doc.append("items", {})
		_apply_charge_values(row, source, process_key, overwrite_rate=True)


def _dedupe_commercial_items_by_stock_entry_detail(doc):
	"""Remove duplicate Finish Good rows that share the same SE detail link."""
	seen_details = set()
	to_remove = []
	for row in list(_source_rows(doc)):
		detail = row.get("custom_source_stock_entry_detail")
		if not detail:
			continue
		if detail in seen_details:
			to_remove.append(row)
			continue
		seen_details.add(detail)
	for row in to_remove:
		# Do not remove if a coil production line still points at this SO item
		from ss_coil.coil_production import get_coil_production_rows, sales_order_has_coil_production

		if sales_order_has_coil_production(doc):
			linked = any(p.get("sales_order_item") == row.name for p in get_coil_production_rows(doc))
			if linked:
				continue
		doc.remove(row)


def _apply_charge_values(row, source, process_key, overwrite_rate=True):
	meta = PROCESS_CHARGE_CATALOG[process_key]
	item_code = meta["item_code"]
	item = frappe.get_cached_doc("Item", item_code) if frappe.db.exists("Item", item_code) else None

	row.item_code = item_code
	row.item_name = (item.item_name if item else None) or meta["item_name"]
	row.description = (
		f"{PROCESS_LABELS.get(process_key) or process_key} charge for "
		f"{source.get('item_name') or source.get('item_code') or source.name}"
	)
	row.qty = flt(source.qty) or 1
	row.uom = source.uom or (item.stock_uom if item else None) or _default_uom()
	row.stock_uom = (item.stock_uom if item else None) or row.uom
	row.conversion_factor = flt(source.conversion_factor) or 1
	if source.get("delivery_date"):
		row.delivery_date = source.delivery_date
	if source.get("warehouse"):
		row.warehouse = source.warehouse

	rate = process_charge_rate(process_key)
	if overwrite_rate or flt(row.rate) == 0:
		row.rate = rate
	row.amount = flt(row.qty) * flt(row.rate)

	row.custom_is_process_charge = 1
	row.custom_process_charge_key = process_key
	row.custom_process_charge_source = source.name

	# Keep production fields blank on charge lines
	for fieldname in (
		"custom_slitter",
		"custom_leveler",
		"custom_reshearing",
		"custom_raw_material_item",
		"custom_raw_material_tag_no",
		"custom_raw_material_batch_no",
		"custom_tag_no",
		"custom_child_tag_no",
		"custom_finish_good_item",
	):
		if _has_field("Sales Order Item", fieldname) and hasattr(row, fieldname):
			row.set(fieldname, None if fieldname != "custom_is_process_charge" else 1)


@frappe.whitelist()
def setup_process_charge_items():
	return ensure_process_charge_items()


@frappe.whitelist()
def get_process_charge_catalog():
	ensure_fields = _has_field("Sales Order Item", "custom_is_process_charge")
	if not ensure_fields:
		_ensure_process_charge_custom_fields()
	out = {}
	for process_key, meta in PROCESS_CHARGE_CATALOG.items():
		out[process_key] = {
			"item_code": meta["item_code"],
			"item_name": meta["item_name"],
			"rate": process_charge_rate(process_key),
			"label": PROCESS_LABELS.get(process_key) or process_key,
		}
	return out
