"""Item-level coil trace fields: Sub Tag No, Entry Number, and inward coil field sync."""

from __future__ import annotations

import frappe
from frappe.custom.doctype.custom_field.custom_field import create_custom_fields

from ss_coil.api import _has_field

# Extra inward fields that exist on Stock Entry Detail but were not always on SO.
EXTRA_COIL_INWARD_FIELDS = (
	"custom_hdgc_no",
	"custom_for_customer",
)

TRACE_CHILD_DOCTYPES = (
	"Stock Entry Detail",
	"Sales Order Item",
	"Delivery Note Item",
	"Sales Invoice Item",
	"Purchase Receipt Item",
	"Purchase Invoice Item",
)


def setup_coil_item_trace_fields():
	"""Ensure Sub Tag No + Entry Number (and missing SO coil fields) exist at item level."""
	fields_by_dt = {}

	for dt in TRACE_CHILD_DOCTYPES:
		rows = []
		anchor = "custom_tag_no" if _field_exists(dt, "custom_tag_no") else "item_name"
		if not _field_exists(dt, "custom_sub_tag_no"):
			rows.append(
				{
					"fieldname": "custom_sub_tag_no",
					"label": "Sub Tag No",
					"fieldtype": "Small Text",
					"insert_after": anchor,
					"read_only": 1,
					"description": "Child / sub tags from SS Coil Job Output (e.g. SSCC-05579-001, SSCC-05579-002).",
				}
			)
			anchor = "custom_sub_tag_no"
		elif _field_exists(dt, "custom_sub_tag_no"):
			anchor = "custom_sub_tag_no"

		if not _field_exists(dt, "custom_entry_no"):
			rows.append(
				{
					"fieldname": "custom_entry_no",
					"label": "Entry Number",
					"fieldtype": "Data",
					"insert_after": anchor,
					"read_only": 1,
					"in_list_view": 1 if dt in ("Stock Entry Detail", "Sales Order Item") else 0,
					"description": "Stock Entry name on inward; latest SS Coil Job Sheet entry after processing. Clickable on the form grid.",
				}
			)
			anchor = "custom_entry_no"
		elif _field_exists(dt, "custom_entry_no"):
			anchor = "custom_entry_no"

		# Item-level Link to the SS Coil process entry (one SS Coil per line / process).
		if dt in ("Sales Order Item", "Stock Entry Detail") and not _field_exists(dt, "custom_ss_coil"):
			rows.append(
				{
					"fieldname": "custom_ss_coil",
					"label": "SS Coil",
					"fieldtype": "Link",
					"options": "SS Coil",
					"insert_after": anchor,
					"read_only": 1,
					"in_list_view": 1,
					"description": "Linked SS Coil process entry for this item line.",
				}
			)
		if rows:
			fields_by_dt[dt] = rows

	# Sales Order Item: missing HDGC / For Customer from Stock Entry layout
	so_extra = []
	if not _field_exists("Sales Order Item", "custom_hdgc_no"):
		so_extra.append(
			{
				"fieldname": "custom_hdgc_no",
				"label": "HDGC No",
				"fieldtype": "Data",
				"insert_after": "custom_js_number"
				if _field_exists("Sales Order Item", "custom_js_number")
				else "custom_thickness",
			}
		)
	if not _field_exists("Sales Order Item", "custom_for_customer"):
		so_extra.append(
			{
				"fieldname": "custom_for_customer",
				"label": "For Customer",
				"fieldtype": "Link",
				"options": "For Customer",
				"insert_after": "custom_condition"
				if _field_exists("Sales Order Item", "custom_condition")
				else "custom_width",
			}
		)
	if so_extra:
		fields_by_dt.setdefault("Sales Order Item", []).extend(so_extra)

	# DN / SI: process flags (optional visibility for completed process chain)
	for dt in ("Delivery Note Item", "Sales Invoice Item"):
		proc_rows = []
		insert_after = "custom_entry_no" if _field_exists(dt, "custom_entry_no") else (
			"custom_sub_tag_no" if _field_exists(dt, "custom_sub_tag_no") else "custom_tag_no"
		)
		for fieldname, label in (
			("custom_slitter", "Slitter"),
			("custom_leveler", "Leveler"),
			("custom_reshearing", "Reshearing"),
		):
			if _field_exists(dt, fieldname):
				insert_after = fieldname
				continue
			proc_rows.append(
				{
					"fieldname": fieldname,
					"label": label,
					"fieldtype": "Link",
					"options": "Operation",
					"insert_after": insert_after,
					"read_only": 1,
				}
			)
			insert_after = fieldname
		if proc_rows:
			fields_by_dt.setdefault(dt, []).extend(proc_rows)

	if fields_by_dt:
		create_custom_fields(fields_by_dt, update=True)

	# Ensure list-view + label for existing Entry Number / SS Coil fields
	for dt in ("Sales Order Item", "Stock Entry Detail"):
		for fieldname, props in (
			(
				"custom_entry_no",
				{
					"in_list_view": 1,
					"read_only": 1,
					"description": "Stock Entry and/or SS Coil entry. Tokens are clickable on the form grid.",
				},
			),
			(
				"custom_ss_coil",
				{
					"in_list_view": 1,
					"read_only": 1,
					"label": "SS Coil",
					"description": "Linked SS Coil process entry for this item line.",
				},
			),
		):
			name = f"{dt}-{fieldname}"
			if frappe.db.exists("Custom Field", name):
				frappe.db.set_value("Custom Field", name, props, update_modified=False)

	# Prefer "Sub Tag No" wording on legacy Child Tag No
	if frappe.db.exists("Custom Field", "Sales Order Item-custom_child_tag_no"):
		frappe.db.set_value(
			"Custom Field",
			"Sales Order Item-custom_child_tag_no",
			{
				"label": "Sub Tag No",
				"description": "Sub / child tags from SS Coil Job Output (synced with Sub Tag No).",
			},
			update_modified=False,
		)

	for dt in TRACE_CHILD_DOCTYPES:
		frappe.clear_cache(doctype=dt)
	frappe.clear_cache(doctype="Coil Production Line")
	_backfill_ss_coil_links_from_entry_numbers()
	return {"status": "ok", "doctypes": list(fields_by_dt.keys())}


def _backfill_ss_coil_links_from_entry_numbers():
	"""Fill custom_ss_coil / ss_coil from Entry Number when it already stores an SS Coil name."""
	# Sales Order Item / Stock Entry Detail
	for dt, link_field in (
		("Sales Order Item", "custom_ss_coil"),
		("Stock Entry Detail", "custom_ss_coil"),
	):
		if not _field_exists(dt, link_field) or not _field_exists(dt, "custom_entry_no"):
			continue
		rows = frappe.db.sql(
			f"""
			select name, custom_entry_no
			from `tab{dt}`
			where ifnull(custom_ss_coil, '') = ''
			  and ifnull(custom_entry_no, '') != ''
			limit 5000
			""",
			as_dict=True,
		)
		for row in rows:
			token = _extract_ss_coil_token(row.custom_entry_no)
			if token and frappe.db.exists("SS Coil", token):
				frappe.db.set_value(dt, row.name, link_field, token, update_modified=False)

	if frappe.db.exists("DocType", "Coil Production Line") and frappe.get_meta("Coil Production Line").has_field(
		"ss_coil"
	):
		rows = frappe.db.sql(
			"""
			select name, entry_no
			from `tabCoil Production Line`
			where ifnull(ss_coil, '') = ''
			  and ifnull(entry_no, '') != ''
			limit 5000
			""",
			as_dict=True,
		)
		for row in rows:
			token = _extract_ss_coil_token(row.entry_no)
			if token and frappe.db.exists("SS Coil", token):
				frappe.db.set_value("Coil Production Line", row.name, "ss_coil", token, update_modified=False)


def _extract_ss_coil_token(entry_no):
	if not entry_no:
		return None
	parts = [p.strip() for p in str(entry_no).split("/") if p.strip()]
	for part in reversed(parts):
		if part.upper().startswith("JS") and frappe.db.exists("SS Coil", part):
			return part
	# Single token that is an SS Coil
	token = parts[-1] if parts else None
	if token and frappe.db.exists("SS Coil", token):
		return token
	return None


def _field_exists(doctype, fieldname):
	return bool(frappe.db.exists("Custom Field", f"{doctype}-{fieldname}")) or _has_field(doctype, fieldname)


def fill_stock_entry_item_entry_numbers(doc, method=None):
	"""On Stock Entry, set each row Entry Number = Stock Entry name when blank."""
	if getattr(doc, "doctype", None) != "Stock Entry":
		return
	if not doc.name or str(doc.name).startswith("new-"):
		return
	if not _has_field("Stock Entry Detail", "custom_entry_no"):
		return
	for row in doc.items or []:
		if not row.get("custom_entry_no"):
			row.custom_entry_no = doc.name


def apply_ss_coil_trace_to_sales_order_item(ss_coil_doc):
	"""Push Sub Tag No + Entry Number (+ primary Tag No) from SS Coil to SO.

	Writes Coil Production Line first (when linked), then mirrors light trace
	fields onto the Finish Good Sales Order Item for DN/SI.
	"""
	from ss_coil.coil_production import apply_ss_coil_trace_to_coil_production

	apply_ss_coil_trace_to_coil_production(ss_coil_doc)

	so_item = getattr(ss_coil_doc, "sales_order_item", None)
	if not so_item or not frappe.db.exists("Sales Order Item", so_item):
		return

	# If production line already mirrored tags, skip duplicate SO Item write
	# unless production table is absent / unresolved.
	prod_name = getattr(ss_coil_doc, "coil_production_line", None)
	if prod_name and frappe.db.exists("Coil Production Line", prod_name):
		return

	child_tags = [row.tag_no for row in (ss_coil_doc.job_output or []) if getattr(row, "tag_no", None)]
	sub_tag_text = ", ".join(child_tags) if child_tags else ""
	primary_tag = child_tags[0] if child_tags else None
	entry_no = ss_coil_doc.name

	values = {}
	if primary_tag and _has_field("Sales Order Item", "custom_tag_no"):
		values["custom_tag_no"] = primary_tag
	if sub_tag_text:
		if _has_field("Sales Order Item", "custom_sub_tag_no"):
			values["custom_sub_tag_no"] = sub_tag_text
		if _has_field("Sales Order Item", "custom_child_tag_no"):
			values["custom_child_tag_no"] = sub_tag_text
			if entry_no and _has_field("Sales Order Item", "custom_entry_no"):
				values["custom_entry_no"] = entry_no
			if entry_no and _has_field("Sales Order Item", "custom_ss_coil"):
				values["custom_ss_coil"] = entry_no

	# Also push entry/sub tag onto linked Stock Entry Detail (item-level "here")
	source_detail = frappe.db.get_value("Sales Order Item", so_item, "custom_source_stock_entry_detail")
	if source_detail and frappe.db.exists("Stock Entry Detail", source_detail):
		se_values = {}
		if sub_tag_text and _has_field("Stock Entry Detail", "custom_sub_tag_no"):
			se_values["custom_sub_tag_no"] = sub_tag_text
		if entry_no and _has_field("Stock Entry Detail", "custom_ss_coil"):
			se_values["custom_ss_coil"] = entry_no
		if entry_no and _has_field("Stock Entry Detail", "custom_entry_no"):
			# Keep original SE name; show latest SS Coil after a separator once processing starts.
			existing = frappe.db.get_value("Stock Entry Detail", source_detail, "custom_entry_no")
			se_parent = frappe.db.get_value("Stock Entry Detail", source_detail, "parent")
			base = existing or se_parent or ""
			if not base:
				se_values["custom_entry_no"] = entry_no
			elif entry_no and entry_no not in str(base):
				# Prefer "SE / SS Coil" for item-level visibility
				se_name = se_parent or (str(base).split(" / ")[0].strip())
				se_values["custom_entry_no"] = f"{se_name} / {entry_no}"
			elif not existing and se_parent:
				se_values["custom_entry_no"] = se_parent
		if se_values:
			frappe.db.set_value("Stock Entry Detail", source_detail, se_values, update_modified=False)

	if values:
		frappe.db.set_value("Sales Order Item", so_item, values, update_modified=False)


def copy_sales_order_trace_fields_to_row(target_row, so_item_name=None, sales_order=None, item_code=None):
	"""Copy Tag / Sub Tag / Entry / processes from Sales Order Item onto DN/SI row."""
	so_row = None
	if so_item_name and frappe.db.exists("Sales Order Item", so_item_name):
		so_row = frappe.get_doc("Sales Order Item", so_item_name)
	elif sales_order and item_code:
		name = frappe.db.get_value(
			"Sales Order Item",
			{"parent": sales_order, "item_code": item_code},
			"name",
		)
		if name:
			so_row = frappe.get_doc("Sales Order Item", name)
	if not so_row:
		return

	mapping = (
		("custom_tag_no", "custom_tag_no"),
		("custom_sub_tag_no", "custom_sub_tag_no"),
		("custom_sub_tag_no", "custom_child_tag_no"),  # fallback source
		("custom_entry_no", "custom_entry_no"),
		("custom_ss_coil", "custom_ss_coil"),
		("custom_slitter", "custom_slitter"),
		("custom_leveler", "custom_leveler"),
		("custom_reshearing", "custom_reshearing"),
	)
	for target_field, source_field in mapping:
		if not _has_field(target_row.doctype, target_field):
			continue
		if target_row.get(target_field) not in (None, ""):
			continue
		value = so_row.get(source_field)
		if value not in (None, ""):
			target_row.set(target_field, value)

	# Tag No → Batch No on DN/SI when item is batch-tracked
	if (
		_has_field(target_row.doctype, "batch_no")
		and target_row.get("batch_no") in (None, "")
		and target_row.get("custom_tag_no")
	):
		tag = target_row.custom_tag_no
		item = target_row.get("item_code")
		if item and frappe.get_cached_value("Item", item, "has_batch_no"):
			if frappe.db.exists("Batch", tag):
				target_row.batch_no = tag
			elif frappe.db.exists("Batch", {"name": tag}):
				target_row.batch_no = tag

	# If SO only has child_tag_no, mirror into sub_tag_no on target
	if (
		_has_field(target_row.doctype, "custom_sub_tag_no")
		and target_row.get("custom_sub_tag_no") in (None, "")
		and so_row.get("custom_child_tag_no")
	):
		target_row.custom_sub_tag_no = so_row.custom_child_tag_no
