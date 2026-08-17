"""Backend for the Stock Entry "Data Entry" dialog (see
ss_coil/public/js/stock_entry.js for the frontend, and ARCHITECTURE.md for
the full flow).

get_stock_entry_data_entry_meta() tells the dialog which fields to render,
pulled live from DocType meta so labels/options never drift out of sync with
the DocType. save_stock_entry_data_entry() writes the dialog's values back
onto the real Stock Entry doc.
"""

import frappe
from frappe.utils import cint, getdate

PARENT_SECTIONS = [
	{
		"label": "Stock Entry Details",
		"fields": [
			"company",
			"stock_entry_type",
			"purpose",
			"custom_job_purpose",
			"posting_date",
			"custom_sales_order",
			"custom_mr_number",
			"custom_customer",
			"custom_for_customer",
			"custom_create_tag_numbers",
		],
	},
]

STOCK_ENTRY_DATA_ENTRY_CHILD_FIELDS = [
	"item_code",
	"custom_finish_good_item",
	"qty",
	"custom_tag_no",
	"custom_mill",
	"custom_location",
	"custom_ref_no",
	"custom_thickness",
	"custom_width",
	"custom_length_c",
	"custom_length",
	"custom_dimension",
	"custom_js_number",
	"custom_hdgc_no",
	"custom_condition",
	"custom_commodity",
	"custom_specification",
	"custom_estimated_wt",
	"custom_qty_of_coil",
	"custom_comments",
	"custom_slitter",
	"custom_leveler",
	"custom_reshearing",
]

CHILD_FIELDS_SYNCED_FROM_PARENT = {
	"custom_for_customer": "custom_for_customer",
	"s_warehouse": "from_warehouse",
	"t_warehouse": "to_warehouse",
}

CHILD_FIELD_COLUMNS = {
	"item_code": 2,
	"custom_finish_good_item": 2,
	"custom_specification": 2,
	"custom_dimension": 2,
	"custom_comments": 2,
}


def _meta_field_to_dict(meta, fieldname):
	df = meta.get_field(fieldname)
	if not df or df.fieldtype in ("Section Break", "Column Break", "Tab Break", "HTML", "Button"):
		return None
	if df.hidden:
		return None
	return {
		"fieldname": df.fieldname,
		"label": df.label,
		"fieldtype": df.fieldtype,
		"options": df.options,
		"reqd": df.reqd,
		"default": df.default,
		"read_only": df.read_only,
		"depends_on": df.depends_on,
		"columns": CHILD_FIELD_COLUMNS.get(fieldname, 1),
	}


def _build_parent_sections(parent_meta):
	sections = []
	for section in PARENT_SECTIONS:
		fields = [
			field
			for fieldname in section["fields"]
			if (field := _meta_field_to_dict(parent_meta, fieldname))
		]
		if fields:
			sections.append({"label": section["label"], "fields": fields})
	return sections


def _sync_item_from_parent(doc, item):
	for child_field, parent_field in CHILD_FIELDS_SYNCED_FROM_PARENT.items():
		parent_value = doc.get(parent_field)
		if parent_value not in (None, ""):
			item.set(child_field, parent_value)


def _is_material_receipt_stock_entry(doc):
	if (doc.get("purpose") or "") == "Material Receipt":
		return True
	stock_entry_type = (doc.get("stock_entry_type") or "").strip()
	if stock_entry_type == "Material Receipt":
		return True
	if stock_entry_type and frappe.db.exists("Stock Entry Type", stock_entry_type):
		return frappe.db.get_value("Stock Entry Type", stock_entry_type, "purpose") == "Material Receipt"
	return False


def _sync_stock_entry_type_purpose(doc):
	stock_entry_type = (doc.get("stock_entry_type") or "").strip()
	if not stock_entry_type:
		return
	if stock_entry_type == "Material Receipt":
		doc.purpose = "Material Receipt"
		return
	if frappe.db.exists("Stock Entry Type", stock_entry_type):
		purpose = frappe.db.get_value("Stock Entry Type", stock_entry_type, "purpose")
		if purpose:
			doc.purpose = purpose


def _apply_parent_fields(doc, data):
	for fieldname in _all_parent_fieldnames():
		if fieldname in data:
			doc.set(fieldname, data.get(fieldname))
	_sync_stock_entry_type_purpose(doc)


def _parse_item_rows(data):
	items = []
	for row_data in data.get("items") or []:
		row_data = frappe.parse_json(row_data) if isinstance(row_data, str) else row_data
		if not row_data or not row_data.get("item_code"):
			continue
		items.append(row_data)
	return items


def _apply_item_fields(row, row_data):
	for fieldname in STOCK_ENTRY_DATA_ENTRY_CHILD_FIELDS:
		if fieldname in row_data:
			row.set(fieldname, row_data.get(fieldname))


def _existing_item_by_name(doc, row_name):
	if not row_name:
		return None
	return next((item for item in doc.items if item.name == row_name), None)


def _sync_stock_entry_items(doc, data):
	"""Update existing item rows in place. Never append a row that already exists.

	Flow-page rows keep a client-only `__islocal` name after the first save, so
	the payload often has no real child `name`. Match by real name first, then
	reuse unmatched existing rows in order, then append leftovers, then remove
	rows the form no longer has.
	"""
	incoming = _parse_item_rows(data)
	used_rows = []

	for row_data in incoming:
		row = _existing_item_by_name(doc, row_data.get("name"))
		if row is not None and row in used_rows:
			row = None
		if row is None:
			row = next((item for item in doc.items if item not in used_rows), None)
		if row is None:
			row = doc.append(
				"items",
				{k: row_data.get(k) for k in STOCK_ENTRY_DATA_ENTRY_CHILD_FIELDS if k in row_data},
			)
		else:
			_apply_item_fields(row, row_data)
		_sync_item_from_parent(doc, row)
		used_rows.append(row)

	for row in list(doc.items):
		if row not in used_rows:
			doc.remove(row)

	for item in doc.items:
		_sync_item_from_parent(doc, item)


def _apply_data_entry_tag_row_flags(doc):
	"""Header 'Create Tag Numbers' on Material Receipt maps to the same per-row
	flag the Stock Entry form uses, so assign_stock_entry_detail_tags can run.
	"""
	if not frappe.get_meta("Stock Entry Detail").has_field("custom_create_tag_no"):
		return
	create_tags = cint(doc.get("custom_create_tag_numbers")) and _is_material_receipt_stock_entry(doc)
	if not create_tags:
		return
	for row in doc.items or []:
		if not row.get("item_code"):
			continue
		row.custom_create_tag_no = 1


def _prepare_data_entry_stock_entry(doc, data):
	_apply_parent_fields(doc, data)
	_sync_stock_entry_items(doc, data)
	_apply_data_entry_tag_row_flags(doc)


def _stock_entry_data_entry_response(doc):
	return {
		"name": doc.name,
		"doctype": "Stock Entry",
		"docstatus": cint(doc.docstatus),
		"items": [
			{
				"name": row.name,
				"item_code": row.item_code,
				"custom_tag_no": row.get("custom_tag_no"),
			}
			for row in doc.items
		],
	}


@frappe.whitelist()
def get_stock_entry_data_entry_meta():
	"""Return grouped parent sections and child field definitions for data entry."""
	parent_meta = frappe.get_meta("Stock Entry")
	child_meta = frappe.get_meta("Stock Entry Detail")
	child_fields = [
		field
		for fieldname in STOCK_ENTRY_DATA_ENTRY_CHILD_FIELDS
		if (field := _meta_field_to_dict(child_meta, fieldname))
	]
	return {
		"parent_sections": _build_parent_sections(parent_meta),
		"child_fields": child_fields,
		"parent_sync_fields": CHILD_FIELDS_SYNCED_FROM_PARENT,
	}


def _all_parent_fieldnames():
	names = []
	for section in PARENT_SECTIONS:
		names.extend(section["fields"])
	return names


def _serialize_flow_field_value(meta, fieldname, value):
	df = meta.get_field(fieldname) if meta else None
	if value in (None, ""):
		return value
	if df and df.fieldtype == "Date":
		return getdate(value).strftime("%Y-%m-%d")
	if df and df.fieldtype == "Check":
		return 1 if cint(value) else 0
	return value


@frappe.whitelist()
def get_stock_entry_data_entry_document(stock_entry):
	"""Return parent + item values for loading into the data entry form."""
	doc = frappe.get_doc("Stock Entry", stock_entry)
	meta = frappe.get_meta("Stock Entry")
	child_meta = frappe.get_meta("Stock Entry Detail")
	parent = {}
	for fieldname in _all_parent_fieldnames():
		parent[fieldname] = _serialize_flow_field_value(meta, fieldname, doc.get(fieldname))

	items = []
	for row in doc.items:
		item = {"name": row.name}
		for fieldname in STOCK_ENTRY_DATA_ENTRY_CHILD_FIELDS:
			item[fieldname] = _serialize_flow_field_value(child_meta, fieldname, row.get(fieldname))
		items.append(item)

	return {"name": doc.name, "docstatus": cint(doc.docstatus), **parent, "items": items}


@frappe.whitelist()
def save_stock_entry_data_entry(stock_entry, data):
	"""Save parent and child values from the data entry dialog."""
	data = frappe.parse_json(data) if isinstance(data, str) else data
	doc = frappe.get_doc("Stock Entry", stock_entry)
	_prepare_data_entry_stock_entry(doc, data)
	doc.save()
	doc.reload()
	return _stock_entry_data_entry_response(doc)


@frappe.whitelist()
def create_stock_entry_from_data_entry(data):
	"""Create a new Stock Entry from the flow-page data entry form."""
	data = frappe.parse_json(data) if isinstance(data, str) else data
	doc = frappe.new_doc("Stock Entry")
	_prepare_data_entry_stock_entry(doc, data)
	doc.save()
	doc.reload()
	return _stock_entry_data_entry_response(doc)
