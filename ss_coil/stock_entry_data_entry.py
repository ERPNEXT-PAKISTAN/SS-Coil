"""Backend for the Stock Entry "Data Entry" dialog (see
ss_coil/public/js/stock_entry.js for the frontend, and ARCHITECTURE.md for
the full flow).

get_stock_entry_data_entry_meta() tells the dialog which fields to render,
pulled live from DocType meta so labels/options never drift out of sync with
the DocType. save_stock_entry_data_entry() writes the dialog's values back
onto the real Stock Entry doc.
"""

import frappe

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
	"qty",
	"custom_tag_no",
	"custom_mill",
	"custom_location",
	"custom_ref_no",
	"custom_thickness",
	"custom_width",
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


@frappe.whitelist()
def save_stock_entry_data_entry(stock_entry, data):
	"""Save parent and child values from the data entry dialog."""
	data = frappe.parse_json(data) if isinstance(data, str) else data
	doc = frappe.get_doc("Stock Entry", stock_entry)

	for fieldname in _all_parent_fieldnames():
		if fieldname in data:
			doc.set(fieldname, data.get(fieldname))

	for row_data in data.get("items") or []:
		row_data = frappe.parse_json(row_data) if isinstance(row_data, str) else row_data
		row_name = row_data.get("name")
		if row_name:
			row = next((item for item in doc.items if item.name == row_name), None)
			if not row:
				continue
			for fieldname in STOCK_ENTRY_DATA_ENTRY_CHILD_FIELDS:
				if fieldname in row_data:
					row.set(fieldname, row_data.get(fieldname))
			_sync_item_from_parent(doc, row)
		else:
			row = doc.append(
				"items",
				{k: row_data.get(k) for k in STOCK_ENTRY_DATA_ENTRY_CHILD_FIELDS if k in row_data},
			)
			_sync_item_from_parent(doc, row)

	for item in doc.items:
		_sync_item_from_parent(doc, item)

	doc.save()
	return {"name": doc.name}
