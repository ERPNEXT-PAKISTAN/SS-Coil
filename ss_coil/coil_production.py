"""Coil Production Line child on Sales Order — manufacturing / raw material plan.

Commercial SO `items` stay FG + process charges. Mother coil, tags, dimensions,
and process flags live on `custom_coil_production` (Coil Production Line).
"""

from __future__ import annotations

import frappe
from frappe.custom.doctype.custom_field.custom_field import create_custom_fields
from frappe.utils import flt

from ss_coil.api import (
	COIL_INWARD_SO_FIELDNAMES,
	PROCESS_FIELDS,
	STOCK_SOURCE_STOCK_ENTRY,
	_format_dimension_part,
	_has_field,
)

# Coil Production Line field -> Sales Order Item custom_* (for reuse of SO helpers)
PROD_TO_SO_CUSTOM = {
	"raw_material_item": "custom_raw_material_item",
	"raw_material_tag_no": "custom_raw_material_tag_no",
	"raw_material_batch_no": "custom_raw_material_batch_no",
	"stock_source_type": "custom_stock_source_type",
	"source_stock_entry": "custom_source_stock_entry",
	"source_stock_entry_detail": "custom_source_stock_entry_detail",
	"tag_no": "custom_tag_no",
	"sub_tag_no": "custom_sub_tag_no",
	"entry_no": "custom_entry_no",
	"status": "custom_status",
	"mill": "custom_mill",
	"location": "custom_location",
	"ref_no": "custom_ref_no",
	"js_number": "custom_js_number",
	"hdgc_no": "custom_hdgc_no",
	"po_no": "custom_po_no",
	"thickness": "custom_thickness",
	"width": "custom_width",
	"length": "custom_length",
	"length_c": "custom_length_c",
	"dimension": "custom_dimension",
	"estimated_wt": "custom_estimated_wt",
	"qty_of_coil": "custom_qty_of_coil",
	"for_customer": "custom_for_customer",
	"commodity": "custom_commodity",
	"specification": "custom_specification",
	"condition": "custom_condition",
	"remarks": "custom_remarks",
	"comments": "custom_comments",
	"slitter": "custom_slitter",
	"leveler": "custom_leveler",
	"reshearing": "custom_reshearing",
	"machine": "custom_machine",
	"calc_ratio": "custom_calc_ratio",
	"calc_ratio_2": "custom_calc_ratio_2",
	"actual_ratio": "custom_actual_ratio",
	"remaining_width": "custom_remaining_width",
	"packing_type": "custom_packing_type",
	"packing_weightsize": "custom_packing_weightsize",
	"no_of_pack": "custom_no_of_pack",
	"packing_remarks": "custom_packing_remarks",
	"packing_comments": "custom_packing_comments",
}

SO_CUSTOM_TO_PROD = {v: k for k, v in PROD_TO_SO_CUSTOM.items()}

COIL_PRODUCTION_TABLE = "custom_coil_production"


def setup_coil_production_fields():
	"""Ensure Coil Production Line exists and is attached to Sales Order + SS Coil."""
	_ensure_coil_production_line_doctype()
	fields = {
		"Sales Order": [
			{
				"fieldname": "custom_coil_production_section",
				"label": "Coil Production",
				"fieldtype": "Section Break",
				"insert_after": "items",
				"collapsible": 0,
			},
			{
				"fieldname": COIL_PRODUCTION_TABLE,
				"label": "Coil Production",
				"fieldtype": "Table",
				"options": "Coil Production Line",
				"insert_after": "custom_coil_production_section",
				"description": "Mother coil, tags, dimensions, and processes. Commercial lines stay in Items.",
			},
		],
		"SS Coil": [
			{
				"fieldname": "coil_production_line",
				"label": "Coil Production Line",
				"fieldtype": "Data",
				"insert_after": "sales_order_item",
				"read_only": 1,
				"description": "Sales Order Coil Production Line row this job sheet was created from.",
			},
		],
	}

	to_create = {}
	for dt, rows in fields.items():
		needed = []
		for row in rows:
			cf_name = f"{dt}-{row['fieldname']}"
			# SS Coil field is native-style: check meta if already in DocType JSON
			if dt == "SS Coil" and _has_field("SS Coil", row["fieldname"]):
				continue
			if frappe.db.exists("Custom Field", cf_name) or (
				dt != "SS Coil" and _has_field(dt, row["fieldname"])
			):
				continue
			needed.append(row)
		if needed:
			to_create[dt] = needed

	if to_create:
		create_custom_fields(to_create, update=True)

	# Prefer native field on SS Coil when migrating later; custom field is fine for now.
	frappe.clear_cache(doctype="Sales Order")
	frappe.clear_cache(doctype="SS Coil")
	frappe.clear_cache(doctype="Coil Production Line")
	return {"status": "ok"}


def _ensure_coil_production_line_doctype():
	if frappe.db.exists("DocType", "Coil Production Line"):
		return
	from frappe.modules.import_file import import_file_by_path

	path = frappe.get_app_path(
		"ss_coil", "ss_coil", "doctype", "coil_production_line", "coil_production_line.json"
	)
	import_file_by_path(path, force=True)


def sales_order_has_coil_production(doc):
	return bool(_has_field("Sales Order", COIL_PRODUCTION_TABLE)) and bool(
		doc.get(COIL_PRODUCTION_TABLE)
	)


def get_coil_production_rows(doc):
	if not _has_field("Sales Order", COIL_PRODUCTION_TABLE):
		return []
	return list(doc.get(COIL_PRODUCTION_TABLE) or [])


def link_coil_production_to_sales_order_items(doc, method=None):
	"""Bind each Coil Production Line to its Finish Good Sales Order Item."""
	if getattr(doc, "doctype", None) != "Sales Order":
		return
	if not _has_field("Sales Order", COIL_PRODUCTION_TABLE):
		return

	from ss_coil.process_charges import is_process_charge_row

	commercial = [row for row in (doc.items or []) if row.item_code and not is_process_charge_row(row)]
	used = set()

	for prod in get_coil_production_rows(doc):
		# Keep valid existing link
		if prod.get("sales_order_item"):
			match = next((r for r in commercial if r.name == prod.sales_order_item), None)
			if match:
				used.add(match.name)
				_mirror_light_trace_to_so_item(match, prod)
				continue
			prod.sales_order_item = None

		match = None
		detail = prod.get("source_stock_entry_detail")
		if detail:
			match = next(
				(
					r
					for r in commercial
					if r.name not in used
					and r.get("custom_source_stock_entry_detail") == detail
				),
				None,
			)
		if not match and prod.get("finish_good_item"):
			match = next(
				(
					r
					for r in commercial
					if r.name not in used and r.item_code == prod.finish_good_item
				),
				None,
			)
		if not match:
			continue
		prod.sales_order_item = match.name
		used.add(match.name)
		_mirror_light_trace_to_so_item(match, prod)


def _mirror_light_trace_to_so_item(so_row, prod):
	"""Keep minimal SO Item customs for DN/SI / SE match (not full production dump).

	Mother coil, raw tags, and process flags stay on Coil Production Line only.
	Commercial SO Item keeps Finish Good + SE link + output tags/status after job.
	"""
	pairs = (
		("custom_source_stock_entry", "source_stock_entry"),
		("custom_source_stock_entry_detail", "source_stock_entry_detail"),
		("custom_stock_source_type", "stock_source_type"),
		("custom_tag_no", "tag_no"),
		("custom_sub_tag_no", "sub_tag_no"),
		("custom_child_tag_no", "sub_tag_no"),
		("custom_entry_no", "entry_no"),
		("custom_status", "status"),
	)
	for so_field, prod_field in pairs:
		if not _has_field("Sales Order Item", so_field):
			continue
		value = prod.get(prod_field)
		if value not in (None, ""):
			so_row.set(so_field, value)


def production_line_as_so_item_proxy(prod_row, so_item=None):
	"""Expose Coil Production Line as a Sales Order Item-like dict (custom_* keys)."""
	proxy = frappe._dict()
	if so_item:
		if hasattr(so_item, "as_dict"):
			proxy.update(so_item.as_dict())
		else:
			proxy.update(dict(so_item))

	for prod_field, so_field in PROD_TO_SO_CUSTOM.items():
		value = prod_row.get(prod_field) if hasattr(prod_row, "get") else getattr(prod_row, prod_field, None)
		if value not in (None, ""):
			proxy[so_field] = value
			proxy[prod_field] = value

	# Commercial identity
	fg = prod_row.get("finish_good_item") if hasattr(prod_row, "get") else getattr(prod_row, "finish_good_item", None)
	if fg:
		proxy["item_code"] = fg
	if prod_row.get("item_name"):
		proxy["item_name"] = prod_row.get("item_name")
	if prod_row.get("qty") not in (None, ""):
		proxy["qty"] = flt(prod_row.get("qty"))
	if prod_row.get("name"):
		proxy["name"] = so_item.name if so_item and getattr(so_item, "name", None) else prod_row.get("name")
		proxy["coil_production_line"] = prod_row.get("name")
	if prod_row.get("sales_order_item"):
		proxy["name"] = prod_row.get("sales_order_item")

	# child_tag_no alias
	if proxy.get("custom_sub_tag_no") and not proxy.get("custom_child_tag_no"):
		proxy["custom_child_tag_no"] = proxy["custom_sub_tag_no"]

	return proxy


def find_production_line(doc, coil_production_line=None, sales_order_item=None):
	rows = get_coil_production_rows(doc)
	if not rows:
		return None
	if coil_production_line:
		for row in rows:
			if row.name == coil_production_line:
				return row
	if sales_order_item:
		for row in rows:
			if row.get("sales_order_item") == sales_order_item:
				return row
	if len(rows) == 1:
		return rows[0]
	return None


def append_production_line_from_stock_entry_row(sales_order, se_row, stock_entry_name):
	"""Create one Coil Production Line from a Stock Entry Detail row.

	Stock Entry item_code = Mother Coil / raw material.
	custom_finish_good_item = Finish Good to produce / bill.
	"""
	if not _has_field("Sales Order", COIL_PRODUCTION_TABLE):
		return None

	raw_item = se_row.get("item_code")
	finish_good = None
	if _has_field(se_row.doctype, "custom_finish_good_item"):
		finish_good = se_row.get("custom_finish_good_item")

	# If Finish Good is not set, treat SE item as the FG (legacy / no tolling split)
	if not finish_good:
		finish_good = raw_item
		raw_item = None
	elif finish_good == raw_item:
		# Same code on both — keep as FG only
		raw_item = None

	prod = sales_order.append(COIL_PRODUCTION_TABLE, {})
	prod.finish_good_item = finish_good
	prod.qty = flt(se_row.get("qty")) or 1

	fg_name = frappe.db.get_value("Item", finish_good, "item_name") if finish_good else None
	if fg_name:
		prod.item_name = fg_name

	if raw_item:
		prod.raw_material_item = raw_item

	prod.stock_source_type = STOCK_SOURCE_STOCK_ENTRY
	prod.source_stock_entry = stock_entry_name
	prod.source_stock_entry_detail = se_row.name

	tag = se_row.get("custom_tag_no")
	if tag:
		prod.raw_material_tag_no = tag
		prod.entry_no = stock_entry_name
	batch_no = se_row.get("batch_no") or tag
	if batch_no and frappe.db.exists("Batch", batch_no):
		prod.raw_material_batch_no = batch_no

	# Inward coil fields (custom_* on SE → plain on production line)
	for so_field in COIL_INWARD_SO_FIELDNAMES:
		prod_field = SO_CUSTOM_TO_PROD.get(so_field)
		if not prod_field:
			continue
		if not _has_field(se_row.doctype, so_field):
			continue
		value = se_row.get(so_field)
		if value not in (None, ""):
			prod.set(prod_field, value)

	# Processes live on production line (not commercial SO Item)
	for proc in PROCESS_FIELDS:
		se_field = f"custom_{proc}"
		if _has_field(se_row.doctype, se_field) and se_row.get(se_field):
			prod.set(proc, se_row.get(se_field))

	# Packing if present on SE
	for so_field, prod_field in (
		("custom_packing_type", "packing_type"),
		("custom_packing_weightsize", "packing_weightsize"),
		("custom_no_of_pack", "no_of_pack"),
		("custom_packing_remarks", "packing_remarks"),
		("custom_packing_comments", "packing_comments"),
	):
		if _has_field(se_row.doctype, so_field) and se_row.get(so_field):
			prod.set(prod_field, se_row.get(so_field))

	_recompute_production_dimension(prod)
	return prod


def append_commercial_so_item_from_stock_entry_row(sales_order, se_row, stock_entry_name):
	"""Append Finish Good Sales Order Item with full Stock Entry coil / custom values.

	item_code = Finish Good (commercial). Mother coil, tags, dims, processes, packing
	live on Coil Production — FG item stays commercial only.
	"""
	from ss_coil.api import (
		_apply_finish_good_to_sales_order_row,
		_apply_stock_entry_row_tags_to_sales_order_item,
		_copyable_fieldnames,
	)

	so_row = sales_order.append("items", {})

	# Copy every same-named field SE Detail → SO Item (qty, warehouse, packing, customs, …)
	for fieldname in _copyable_fieldnames("Stock Entry Detail", "Sales Order Item"):
		value = se_row.get(fieldname)
		if value not in (None, ""):
			so_row.set(fieldname, value)

	# Finish Good becomes item_code; SE item_code becomes raw material (+ tag/batch)
	_apply_finish_good_to_sales_order_row(so_row, se_row)
	_apply_stock_entry_row_tags_to_sales_order_item(so_row, se_row, copy_process=True)

	if not so_row.get("delivery_date"):
		so_row.delivery_date = sales_order.transaction_date

	if _has_field("Sales Order Item", "custom_source_stock_entry"):
		so_row.custom_source_stock_entry = stock_entry_name
	if _has_field("Sales Order Item", "custom_source_stock_entry_detail"):
		so_row.custom_source_stock_entry_detail = se_row.name
	if _has_field("Sales Order Item", "custom_stock_source_type"):
		so_row.custom_stock_source_type = STOCK_SOURCE_STOCK_ENTRY

	return so_row


def _recompute_production_dimension(prod):
	parts = []
	for value in [prod.get("thickness"), prod.get("width"), prod.get("length_c") or prod.get("length")]:
		if value in (None, ""):
			continue
		text = _format_dimension_part(value)
		if text:
			parts.append(text)
	if parts:
		prod.dimension = " x ".join(parts)


def apply_ss_coil_trace_to_coil_production(ss_coil_doc):
	"""Push Job Output tags / entry onto Coil Production Line (+ light SO Item mirror)."""
	prod_name = getattr(ss_coil_doc, "coil_production_line", None)
	so_item = getattr(ss_coil_doc, "sales_order_item", None)
	order_no = getattr(ss_coil_doc, "order_no", None)

	if not order_no or not frappe.db.exists("Sales Order", order_no):
		return
	if not _has_field("Sales Order", COIL_PRODUCTION_TABLE):
		return

	child_tags = [row.tag_no for row in (ss_coil_doc.job_output or []) if getattr(row, "tag_no", None)]
	sub_tag_text = ", ".join(child_tags) if child_tags else ""
	primary_tag = child_tags[0] if child_tags else None
	entry_no = ss_coil_doc.name

	values = {}
	if primary_tag:
		values["tag_no"] = primary_tag
	if sub_tag_text:
		values["sub_tag_no"] = sub_tag_text
	if entry_no:
		values["entry_no"] = entry_no
		values["ss_coil"] = entry_no

	# Resolve production line row name
	target = prod_name
	if not target and so_item:
		target = frappe.db.get_value(
			"Coil Production Line",
			{"parent": order_no, "sales_order_item": so_item},
			"name",
		)
	if not target:
		# single-row fallback
		names = frappe.get_all(
			"Coil Production Line",
			filters={"parent": order_no},
			pluck="name",
			limit=2,
		)
		if len(names) == 1:
			target = names[0]

	if target and values and frappe.db.exists("Coil Production Line", target):
		# Only write fields that exist on Coil Production Line
		meta = frappe.get_meta("Coil Production Line")
		values = {k: v for k, v in values.items() if meta.has_field(k)}
		if values:
			frappe.db.set_value("Coil Production Line", target, values, update_modified=False)
		# Mirror to SO Item for DN/SI
		linked_so_item = frappe.db.get_value("Coil Production Line", target, "sales_order_item") or so_item
		if linked_so_item and frappe.db.exists("Sales Order Item", linked_so_item):
			so_values = {}
			if primary_tag and _has_field("Sales Order Item", "custom_tag_no"):
				so_values["custom_tag_no"] = primary_tag
			if sub_tag_text:
				if _has_field("Sales Order Item", "custom_sub_tag_no"):
					so_values["custom_sub_tag_no"] = sub_tag_text
				if _has_field("Sales Order Item", "custom_child_tag_no"):
					so_values["custom_child_tag_no"] = sub_tag_text
			if entry_no and _has_field("Sales Order Item", "custom_entry_no"):
				so_values["custom_entry_no"] = entry_no
			if entry_no and _has_field("Sales Order Item", "custom_ss_coil"):
				so_values["custom_ss_coil"] = entry_no
			if so_values:
				frappe.db.set_value("Sales Order Item", linked_so_item, so_values, update_modified=False)

		# SE detail sub tag
		detail = frappe.db.get_value("Coil Production Line", target, "source_stock_entry_detail")
		if detail and frappe.db.exists("Stock Entry Detail", detail):
			se_values = {}
			if sub_tag_text and _has_field("Stock Entry Detail", "custom_sub_tag_no"):
				se_values["custom_sub_tag_no"] = sub_tag_text
			if entry_no and _has_field("Stock Entry Detail", "custom_ss_coil"):
				se_values["custom_ss_coil"] = entry_no
			if entry_no and _has_field("Stock Entry Detail", "custom_entry_no"):
				existing = frappe.db.get_value("Stock Entry Detail", detail, "custom_entry_no")
				se_parent = frappe.db.get_value("Stock Entry Detail", detail, "parent")
				base = existing or se_parent or ""
				if not base:
					se_values["custom_entry_no"] = entry_no
				elif entry_no and entry_no not in str(base):
					se_name = se_parent or (str(base).split(" / ")[0].strip())
					se_values["custom_entry_no"] = f"{se_name} / {entry_no}"
			if se_values:
				frappe.db.set_value("Stock Entry Detail", detail, se_values, update_modified=False)


def backfill_coil_production_from_sales_order_items(sales_order=None):
	"""One-time / migrate: copy manufacturing customs from SO Items into Coil Production."""
	filters = {}
	if sales_order:
		filters["name"] = sales_order
	orders = frappe.get_all("Sales Order", filters=filters, pluck="name")
	created = 0
	errors = []
	for name in orders:
		doc = frappe.get_doc("Sales Order", name)
		if not _has_field("Sales Order", COIL_PRODUCTION_TABLE):
			continue
		if doc.get(COIL_PRODUCTION_TABLE):
			continue
		from ss_coil.process_charges import is_process_charge_row

		row_created = 0
		for so_row in doc.items or []:
			if is_process_charge_row(so_row):
				continue
			if not so_row.item_code:
				continue
			# Only backfill rows that look like production (have RM or processes or SE link)
			if not (
				so_row.get("custom_raw_material_item")
				or so_row.get("custom_raw_material_tag_no")
				or so_row.get("custom_source_stock_entry")
				or so_row.get("custom_slitter")
				or so_row.get("custom_leveler")
				or so_row.get("custom_reshearing")
			):
				continue
			values = {
				"doctype": "Coil Production Line",
				"parent": name,
				"parenttype": "Sales Order",
				"parentfield": COIL_PRODUCTION_TABLE,
				"finish_good_item": so_row.item_code,
				"item_name": so_row.item_name,
				"qty": flt(so_row.qty) or 1,
				"sales_order_item": so_row.name,
			}
			for so_field, prod_field in SO_CUSTOM_TO_PROD.items():
				value = so_row.get(so_field)
				if value not in (None, ""):
					df = frappe.get_meta("Coil Production Line").get_field(prod_field)
					if df and df.fieldtype == "Link" and df.options and not frappe.db.exists(df.options, value):
						continue
					if prod_field == "status" and value not in ("In Process", "Completed", "Closed"):
						continue
					values[prod_field] = value
			# dimension
			parts = []
			for value in [values.get("thickness"), values.get("width"), values.get("length_c") or values.get("length")]:
				if value not in (None, ""):
					text = _format_dimension_part(value)
					if text:
						parts.append(text)
			if parts:
				values["dimension"] = " x ".join(parts)
			try:
				child = frappe.get_doc(values)
				child.flags.ignore_links = True
				child.insert(ignore_permissions=True)
				row_created += 1
				created += 1
			except Exception as exc:
				errors.append({"sales_order": name, "sales_order_item": so_row.name, "error": str(exc)})
		if row_created:
			frappe.db.commit()
	return {"created_rows": created, "errors": errors}


@frappe.whitelist()
def setup_coil_production():
	setup_coil_production_fields()
	return backfill_coil_production_from_sales_order_items()
