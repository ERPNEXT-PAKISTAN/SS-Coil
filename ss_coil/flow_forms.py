"""Generic data-entry forms for the SS Coil Flow page."""

import frappe
from frappe.utils import cint, getdate

from ss_coil.stock_entry_data_entry import (
	CHILD_FIELD_COLUMNS,
	get_stock_entry_data_entry_meta,
)

FLOW_FORM_CONFIGS = {
	"Purchase Receipt": {
		"title": "Purchase Receipt Details",
		"parent_fields": [
			"company",
			"supplier",
			"posting_date",
			"set_warehouse",
			"custom_sales_order",
		],
		"child_table": "items",
		"child_doctype": "Purchase Receipt Item",
		"child_fields": [
			"item_code",
			"qty",
			"received_qty",
			"custom_tag_no",
			"custom_thickness",
			"custom_width",
			"custom_length_c",
			"custom_dimension",
			"custom_ref_no",
			"custom_mill",
		],
		"defaults": {"posting_date": "Today"},
	},
	"Sales Order": {
		"title": "Sales Order Details",
		"parent_fields": [
			"company",
			"customer",
			"transaction_date",
			"delivery_date",
			"custom_for_customer",
			"custom_mr_number",
			"custom_customer",
			"custom_source_stock_entries",
		],
		"child_table": "items",
		"child_doctype": "Sales Order Item",
		"child_fields": [
			"item_code",
			"qty",
			"custom_finish_good_item",
			"custom_raw_material_item",
			"custom_tag_no",
			"custom_raw_material_tag_no",
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
			"custom_source_stock_entry",
		],
		"defaults": {"transaction_date": "Today"},
	},
	"SS Coil": {
		"title": "SS Coil Job Details",
		"parent_fields": [
			"order_no",
			"sales_order_item",
			"operation",
			"machine",
			"customer_name",
			"for_customer",
			"order_received_date",
			"order_status",
			"sc_date",
		],
		"child_table": "input_coil",
		"child_doctype": "Coil Input",
		"child_fields": [
			"tag_no",
			"dimension",
			"length",
			"estimated_wt",
			"estimated_qty",
			"location",
			"slitter",
			"leveler",
			"reshearing",
		],
		"defaults": {"order_received_date": "Today", "sc_date": "Today", "order_status": "Not Started"},
	},
	"Delivery Note": {
		"title": "Delivery Note Details",
		"parent_fields": [
			"company",
			"customer",
			"posting_date",
			"custom_sales_order",
			"custom_for_customer",
		],
		"child_table": "items",
		"child_doctype": "Delivery Note Item",
		"child_fields": [
			"item_code",
			"qty",
			"custom_tag_no",
			"custom_thickness",
			"custom_width",
			"custom_length_c",
			"custom_dimension",
			"against_sales_order",
		],
		"defaults": {"posting_date": "Today"},
	},
	"Sales Invoice": {
		"title": "Sales Invoice Details",
		"parent_fields": [
			"company",
			"customer",
			"posting_date",
			"due_date",
			"custom_sales_order",
			"custom_for_customer",
		],
		"child_table": "items",
		"child_doctype": "Sales Invoice Item",
		"child_fields": [
			"item_code",
			"qty",
			"rate",
			"custom_tag_no",
			"custom_thickness",
			"custom_width",
			"custom_dimension",
		],
		"defaults": {"posting_date": "Today"},
	},
}


def _meta_field_to_dict(meta, fieldname):
	df = meta.get_field(fieldname)
	if not df or df.fieldtype in ("Section Break", "Column Break", "Tab Break", "HTML", "Button", "Heading"):
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


def _build_sections(doctype, fieldnames, title):
	meta = frappe.get_meta(doctype)
	fields = [field for fieldname in fieldnames if (field := _meta_field_to_dict(meta, fieldname))]
	if not fields:
		return []
	return [{"label": title, "fields": fields}]


def _apply_defaults(values, defaults, doctype=None, parent_fields=None):
	today = frappe.utils.today()
	for key, value in (defaults or {}).items():
		if values.get(key) in (None, ""):
			if value == "Today":
				values[key] = today
			else:
				values[key] = value
	if doctype and parent_fields:
		meta = frappe.get_meta(doctype)
		for fieldname in parent_fields:
			df = meta.get_field(fieldname)
			if df and df.fieldtype == "Date":
				values[fieldname] = today
	if not values.get("company"):
		values["company"] = frappe.defaults.get_user_default("company")
	return values


@frappe.whitelist()
def get_flow_form_meta(doctype):
	"""Return parent/child field meta for a flow-page inline form."""
	if doctype == "Stock Entry":
		meta = get_stock_entry_data_entry_meta()
		meta["doctype"] = doctype
		meta["title"] = "Stock Entry Details"
		meta["child_table"] = "items"
		return meta

	config = FLOW_FORM_CONFIGS.get(doctype)
	if not config:
		frappe.throw(f"Flow form is not configured for {doctype}")

	child_meta = frappe.get_meta(config["child_doctype"])
	child_fields = [
		field
		for fieldname in config["child_fields"]
		if (field := _meta_field_to_dict(child_meta, fieldname))
	]

	return {
		"doctype": doctype,
		"title": config["title"],
		"child_table": config["child_table"],
		"parent_sections": _build_sections(doctype, config["parent_fields"], config["title"]),
		"child_fields": child_fields,
		"defaults": _apply_defaults({}, config.get("defaults") or {}, doctype, config["parent_fields"]),
	}


def _serialize_flow_field_value(meta, fieldname, value):
	df = meta.get_field(fieldname) if meta else None
	if value in (None, ""):
		return value
	if df and df.fieldtype == "Date":
		return getdate(value).strftime("%Y-%m-%d")
	if df and df.fieldtype == "Check":
		return 1 if cint(value) else 0
	return value


def _extract_flow_form_document(doc, config):
	parent_fields = config["parent_fields"]
	child_fields = config["child_fields"]
	child_table = config["child_table"]
	parent_meta = frappe.get_meta(doc.doctype)
	child_meta = frappe.get_meta(config["child_doctype"])

	data = {"name": doc.name}
	for fieldname in parent_fields:
		data[fieldname] = _serialize_flow_field_value(parent_meta, fieldname, doc.get(fieldname))

	rows = []
	for row in doc.get(child_table) or []:
		item = {"name": row.name}
		for fieldname in child_fields:
			item[fieldname] = _serialize_flow_field_value(child_meta, fieldname, row.get(fieldname))
		rows.append(item)
	data[child_table] = rows
	return data


@frappe.whitelist()
def get_flow_form_document(doctype, name):
	"""Return saved document values for the flow-page inline form."""
	if not name:
		frappe.throw("Document name is required")

	if doctype == "Stock Entry":
		from ss_coil.stock_entry_data_entry import get_stock_entry_data_entry_document

		return get_stock_entry_data_entry_document(name)

	config = FLOW_FORM_CONFIGS.get(doctype)
	if not config:
		frappe.throw(f"Flow form is not configured for {doctype}")

	doc = frappe.get_doc(doctype, name)
	if doctype == "Sales Order":
		if _backfill_sales_order_from_stock_entry(doc) and cint(doc.docstatus) == 0:
			try:
				doc.save()
			except Exception:
				pass
	return _extract_flow_form_document(doc, config)


def _source_stock_entry_row(so_row):
	detail = so_row.get("custom_source_stock_entry_detail")
	if detail and frappe.db.exists("Stock Entry Detail", detail):
		return frappe.get_doc("Stock Entry Detail", detail)
	return None


def _backfill_sales_order_from_stock_entry(doc):
	"""Copy missing coil/process fields from the source Stock Entry onto SO items."""
	from ss_coil.stock_entry_data_entry import STOCK_ENTRY_DATA_ENTRY_CHILD_FIELDS

	process_fields = {"custom_slitter", "custom_leveler", "custom_reshearing"}
	so_meta = frappe.get_meta("Sales Order Item")
	changed = False
	for row in doc.items or []:
		se_row = _source_stock_entry_row(row)
		if not se_row:
			continue
		for fieldname in STOCK_ENTRY_DATA_ENTRY_CHILD_FIELDS:
			if fieldname in ("item_code", "qty") or not so_meta.has_field(fieldname):
				continue
			se_value = se_row.get(fieldname)
			so_value = row.get(fieldname)
			if fieldname in process_fields:
				if cint(se_value) and not cint(so_value):
					row.set(fieldname, 1)
					changed = True
				continue
			if se_value not in (None, "") and so_value in (None, ""):
				row.set(fieldname, se_value)
				changed = True
	return changed


def _write_flow_form_doc(doc, config, data):
	parent_fields = config["parent_fields"]
	child_fields = config["child_fields"]
	child_table = config["child_table"]

	for fieldname in parent_fields:
		if fieldname in data:
			doc.set(fieldname, data.get(fieldname))

	for row_data in data.get(child_table) or data.get("items") or []:
		row_data = frappe.parse_json(row_data) if isinstance(row_data, str) else row_data
		row_name = row_data.get("name")
		if row_name and doc.get(child_table):
			row = next((item for item in doc.get(child_table) if item.name == row_name), None)
			if not row:
				continue
			for fieldname in child_fields:
				if fieldname in row_data:
					row.set(fieldname, row_data.get(fieldname))
		else:
			doc.append(child_table, {k: row_data.get(k) for k in child_fields if k in row_data})

	doc.save()
	return doc


@frappe.whitelist()
def create_flow_form_document(doctype, data):
	data = frappe.parse_json(data) if isinstance(data, str) else data
	if doctype == "Stock Entry":
		from ss_coil.stock_entry_data_entry import create_stock_entry_from_data_entry

		return create_stock_entry_from_data_entry(data)

	config = FLOW_FORM_CONFIGS.get(doctype)
	if not config:
		frappe.throw(f"Flow form is not configured for {doctype}")

	doc = frappe.new_doc(doctype)
	_write_flow_form_doc(doc, config, data)
	return {"name": doc.name, "doctype": doctype}


@frappe.whitelist()
def save_flow_form_document(doctype, name, data):
	data = frappe.parse_json(data) if isinstance(data, str) else data
	if doctype == "Stock Entry":
		from ss_coil.stock_entry_data_entry import save_stock_entry_data_entry

		return save_stock_entry_data_entry(name, data)

	config = FLOW_FORM_CONFIGS.get(doctype)
	if not config:
		frappe.throw(f"Flow form is not configured for {doctype}")

	doc = frappe.get_doc(doctype, name)
	_write_flow_form_doc(doc, config, data)
	return {"name": doc.name, "doctype": doctype}


def _is_local_doc_name(name):
	return not name or str(name).startswith("new-")


def _strip_local_identity(value):
	if isinstance(value, list):
		return [_strip_local_identity(item) for item in value]
	if not isinstance(value, dict):
		return value
	row = dict(value)
	if _is_local_doc_name(row.get("name")) or row.get("__islocal"):
		row.pop("name", None)
	row.pop("__islocal", None)
	row.pop("__unsaved", None)
	row.pop("creation", None)
	row.pop("modified", None)
	row.pop("modified_by", None)
	row.pop("owner", None)
	for key, nested in list(row.items()):
		if isinstance(nested, list) and nested and isinstance(nested[0], dict):
			row[key] = _strip_local_identity(nested)
	return row


def _overlay_flow_values(doc, doctype, data):
	if not data:
		return
	if doctype == "Stock Entry":
		from ss_coil.stock_entry_data_entry import (
			STOCK_ENTRY_DATA_ENTRY_CHILD_FIELDS,
			_all_parent_fieldnames,
			_apply_data_entry_tag_row_flags,
			_parse_item_rows,
			_sync_stock_entry_type_purpose,
		)

		for fieldname in _all_parent_fieldnames():
			if fieldname in data:
				doc.set(fieldname, data.get(fieldname))
		_sync_stock_entry_type_purpose(doc)
		incoming = _parse_item_rows(data)
		for index, row_data in enumerate(incoming):
			if index >= len(doc.items):
				break
			for fieldname in STOCK_ENTRY_DATA_ENTRY_CHILD_FIELDS:
				if fieldname in row_data:
					doc.items[index].set(fieldname, row_data.get(fieldname))
		_apply_data_entry_tag_row_flags(doc)
		return

	config = FLOW_FORM_CONFIGS.get(doctype)
	if not config:
		return
	for fieldname in config["parent_fields"]:
		if fieldname in data:
			doc.set(fieldname, data.get(fieldname))
	incoming = data.get(config["child_table"]) or data.get("items") or []
	rows = doc.get(config["child_table"]) or []
	for index, row_data in enumerate(incoming):
		row_data = frappe.parse_json(row_data) if isinstance(row_data, str) else row_data
		if index >= len(rows) or not row_data:
			continue
		for fieldname in config["child_fields"]:
			if fieldname in row_data:
				rows[index].set(fieldname, row_data.get(fieldname))


def _prepare_mapped_sales_order(doc):
	if not doc.get("delivery_date") and doc.get("transaction_date"):
		doc.delivery_date = doc.transaction_date
	for row in doc.items or []:
		if not row.get("delivery_date"):
			row.delivery_date = doc.delivery_date or doc.transaction_date
	series_df = frappe.get_meta("Sales Order").get_field("naming_series")
	options = [opt.strip() for opt in (series_df.options or "").split("\n") if opt.strip()] if series_df else []
	if doc.get("naming_series") and options and doc.naming_series not in options:
		doc.naming_series = options[0]


@frappe.whitelist()
def insert_mapped_flow_document(doctype, mapped_doc, data=None):
	"""Insert a mapped (unsaved) document from the flow page, keeping child tables.

	The flow form only edits a subset of fields. Overlay those onto the full
	mapped doc so Coil Production / source links are not dropped on save.
	"""
	if not doctype:
		frappe.throw("Document type is required")
	mapped_doc = frappe.parse_json(mapped_doc) if isinstance(mapped_doc, str) else mapped_doc
	data = frappe.parse_json(data) if isinstance(data, str) else data
	if not mapped_doc:
		frappe.throw("Mapped document is required")

	payload = _strip_local_identity(mapped_doc)
	payload["doctype"] = doctype
	doc = frappe.get_doc(payload)
	_overlay_flow_values(doc, doctype, data or {})
	if doctype == "Sales Order":
		_prepare_mapped_sales_order(doc)
	doc.insert()
	if doctype == "Stock Entry":
		from ss_coil.stock_entry_data_entry import _stock_entry_data_entry_response

		doc.reload()
		return _stock_entry_data_entry_response(doc)
	return {"name": doc.name, "doctype": doctype}
