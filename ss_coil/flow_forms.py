"""Generic data-entry forms for the SS Coil Flow page."""

from copy import deepcopy

import frappe
from frappe.utils import cint, get_datetime, getdate, now_datetime

from ss_coil.stock_entry_data_entry import (
	CHILD_FIELD_COLUMNS,
	get_stock_entry_data_entry_meta,
)


def _parse_optional_json(value):
	"""Parse JSON from RPC args. Frappe sends JS null as an empty string."""
	if value in (None, "", b"", "null", "None"):
		return None
	if isinstance(value, (dict, list)):
		return value
	if isinstance(value, (bytes, bytearray)):
		value = value.decode("utf-8")
	if isinstance(value, str):
		stripped = value.strip()
		if not stripped or stripped in ("null", "None"):
			return None
		return frappe.parse_json(stripped)
	return value

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
			"rate",
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
			"custom_packing_type",
			"custom_packing_weightsize",
			"custom_no_of_pack",
			"custom_packing_remarks",
			"custom_packing_comments",
		],
		"defaults": {"transaction_date": "Today"},
	},
	"SS Coil": {
		"title": "SS Coil Job Details",
		"child_title": "Job Output",
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
		"child_table": "job_output",
		"child_doctype": "Coil Output",
		"child_fields": [
			"class",
			"tag_no",
			"estimated_qty",
			"actual_qty",
			"estimated_wt",
			"actual_wt",
			"thickness",
			"width",
			"length",
			"packing",
			"current_process",
			"next_process",
		],
		"extra_tables": [
			{
				"child_table": "input_coil",
				"child_doctype": "Coil Input",
				"child_title": "Input Coil",
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
			}
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


def _resolve_flow_form_config(doctype):
	config = FLOW_FORM_CONFIGS.get(doctype)
	if not config:
		return None

	resolved = deepcopy(config)
	if doctype != "Sales Order":
		return resolved

	from ss_coil.coil_production import (
		COIL_PRODUCTION_TABLE,
		get_sales_order_flow_production_fields,
		get_sales_order_flow_so_item_fields,
	)

	resolved["child_fields"] = get_sales_order_flow_so_item_fields()
	resolved["child_title"] = "Items"
	resolved["hide_extra_tables"] = True

	if not frappe.get_meta("Sales Order").has_field(COIL_PRODUCTION_TABLE):
		return resolved

	# Keep production meta for backend sync, but flow UI shows one Items table only.
	if not any((spec or {}).get("child_table") == COIL_PRODUCTION_TABLE for spec in (resolved.get("extra_tables") or [])):
		resolved.setdefault("extra_tables", []).append(
			{
				"child_table": COIL_PRODUCTION_TABLE,
				"child_doctype": "Coil Production Line",
				"child_title": "Coil Production",
				"child_fields": get_sales_order_flow_production_fields(),
			}
		)
	return resolved


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

	config = _resolve_flow_form_config(doctype)
	if not config:
		frappe.throw(f"Flow form is not configured for {doctype}")

	return {
		"doctype": doctype,
		"title": config["title"],
		"child_title": config.get("child_title") or "Item Rows",
		"child_table": config["child_table"],
		"parent_sections": _build_sections(doctype, config["parent_fields"], config["title"]),
		"child_fields": _child_field_dicts(config["child_doctype"], config["child_fields"]),
		"extra_tables": [] if config.get("hide_extra_tables") else _extra_table_meta(config),
		"hide_extra_tables": bool(config.get("hide_extra_tables")),
		"defaults": _apply_defaults({}, config.get("defaults") or {}, doctype, config["parent_fields"]),
	}


def _child_field_dicts(doctype, fieldnames):
	child_meta = frappe.get_meta(doctype)
	fields = []
	for fieldname in fieldnames:
		field = _meta_field_to_dict(child_meta, fieldname)
		if not field:
			continue
		if field["fieldtype"] in ("Text", "Small Text", "Long Text", "Code", "Text Editor"):
			field["fieldtype"] = "Data"
		fields.append(field)
	return fields


def _extra_table_meta(config):
	extra = []
	for spec in config.get("extra_tables") or []:
		extra.append(
			{
				"child_table": spec["child_table"],
				"child_doctype": spec["child_doctype"],
				"child_title": spec.get("child_title") or spec["child_table"],
				"child_fields": _child_field_dicts(spec["child_doctype"], spec["child_fields"]),
			}
		)
	return extra


def _serialize_child_rows(doc, child_table, child_doctype, child_fields):
	child_meta = frappe.get_meta(child_doctype)
	rows = []
	for row in doc.get(child_table) or []:
		item = {"name": row.name}
		for fieldname in child_fields:
			item[fieldname] = _serialize_flow_field_value(child_meta, fieldname, row.get(fieldname))
		rows.append(item)
	return rows


def _write_child_rows(doc, child_table, child_fields, incoming):
	for row_data in incoming or []:
		row_data = frappe.parse_json(row_data) if isinstance(row_data, str) else row_data
		if not row_data:
			continue
		row_name = row_data.get("name")
		values = {k: row_data.get(k) for k in child_fields if k in row_data}
		if not row_name and not any(value not in (None, "") for value in values.values()):
			continue
		if row_name and doc.get(child_table):
			row = next((item for item in doc.get(child_table) if item.name == row_name), None)
			if not row:
				continue
			for fieldname, value in values.items():
				row.set(fieldname, value)
		else:
			doc.append(child_table, values)


def _iter_table_specs(config):
	yield config["child_table"], config["child_fields"]
	for spec in config.get("extra_tables") or []:
		yield spec["child_table"], spec["child_fields"]


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
	parent_meta = frappe.get_meta(doc.doctype)

	data = {"name": doc.name, "doctype": doc.doctype, "docstatus": cint(doc.docstatus)}
	for fieldname in parent_fields:
		data[fieldname] = _serialize_flow_field_value(parent_meta, fieldname, doc.get(fieldname))

	data[config["child_table"]] = _serialize_child_rows(
		doc, config["child_table"], config["child_doctype"], config["child_fields"]
	)
	for spec in config.get("extra_tables") or []:
		data[spec["child_table"]] = _serialize_child_rows(
			doc, spec["child_table"], spec["child_doctype"], spec["child_fields"]
		)
	if doc.doctype == "Sales Order":
		_fill_shared_sales_order_table_fields(doc, data)
	if doc.doctype == "SS Coil":
		data.update(_ss_coil_control_payload(doc))
	return data


def _matching_production_for_so_item(doc, so_row):
	from ss_coil.coil_production import matching_production_rows_for_so_item

	return matching_production_rows_for_so_item(doc, so_row)


def _fill_shared_sales_order_table_fields(doc, data):
	"""Fill empty shared fields on items / production rows for the flow form display."""
	from ss_coil.coil_production import COIL_PRODUCTION_TABLE, PROD_TO_SO_CUSTOM

	items = data.get("items") or []
	prod_rows = data.get(COIL_PRODUCTION_TABLE) or []
	by_name = {row.name: row for row in (doc.items or [])}
	prod_by_name = {row.name: row for row in (doc.get(COIL_PRODUCTION_TABLE) or [])}

	for item in items:
		so_row = by_name.get(item.get("name"))
		if not so_row:
			continue
		for prod in _matching_production_for_so_item(doc, so_row):
			prod_payload = next((row for row in prod_rows if row.get("name") == prod.name), None)
			if not prod_payload:
				continue
			for prod_field, so_field in PROD_TO_SO_CUSTOM.items():
				if item.get(so_field) not in (None, ""):
					continue
				value = prod_payload.get(prod_field)
				if value not in (None, ""):
					item[so_field] = value
			if not item.get("item_code") and prod_payload.get("finish_good_item"):
				item["item_code"] = prod_payload.get("finish_good_item")
			if item.get("qty") in (None, "") and prod_payload.get("qty") not in (None, ""):
				item["qty"] = prod_payload.get("qty")

	for prod_payload in prod_rows:
		prod_row = prod_by_name.get(prod_payload.get("name"))
		if not prod_row:
			continue
		so_row = None
		so_payload = None
		if prod_row.get("sales_order_item"):
			so_row = by_name.get(prod_row.sales_order_item)
			so_payload = next((row for row in items if row.get("name") == prod_row.sales_order_item), None)
		if not so_row:
			for candidate in doc.items or []:
				if candidate.get("custom_source_stock_entry_detail") == prod_row.get("source_stock_entry_detail"):
					so_row = candidate
					so_payload = next((row for row in items if row.get("name") == candidate.name), None)
					break
		if not so_payload:
			continue
		for prod_field, so_field in PROD_TO_SO_CUSTOM.items():
			if prod_payload.get(prod_field) not in (None, ""):
				continue
			value = so_payload.get(so_field)
			if value not in (None, ""):
				prod_payload[prod_field] = value
		if not prod_payload.get("finish_good_item") and so_payload.get("item_code"):
			prod_payload["finish_good_item"] = so_payload.get("item_code")
		if prod_payload.get("qty") in (None, "") and so_payload.get("qty") not in (None, ""):
			prod_payload["qty"] = so_payload.get("qty")


@frappe.whitelist()
def get_flow_form_document(doctype, name):
	"""Return saved document values for the flow-page inline form."""
	if not name:
		frappe.throw("Document name is required")

	if doctype == "Stock Entry":
		from ss_coil.stock_entry_data_entry import get_stock_entry_data_entry_document

		return get_stock_entry_data_entry_document(name)

	config = _resolve_flow_form_config(doctype)
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
				if se_value not in (None, "") and so_value in (None, ""):
					row.set(fieldname, se_value)
					changed = True
				continue
			if se_value not in (None, "") and so_value in (None, ""):
				row.set(fieldname, se_value)
				changed = True

	from ss_coil.coil_production import COIL_PRODUCTION_TABLE, sync_sales_order_items_and_production

	if frappe.get_meta("Sales Order").has_field(COIL_PRODUCTION_TABLE):
		sync_sales_order_items_and_production(doc, fill_missing=True)
		changed = True
	return changed


def _write_flow_form_doc(doc, config, data):
	parent_fields = config["parent_fields"]

	for fieldname in parent_fields:
		if fieldname in data:
			doc.set(fieldname, data.get(fieldname))

	_write_child_rows(
		doc,
		config["child_table"],
		config["child_fields"],
		data.get(config["child_table"]) or data.get("items") or [],
	)
	for spec in config.get("extra_tables") or []:
		_write_child_rows(doc, spec["child_table"], spec["child_fields"], data.get(spec["child_table"]) or [])

	if doc.doctype == "Sales Order":
		from ss_coil.coil_production import sync_sales_order_items_and_production

		sync_sales_order_items_and_production(doc, fill_missing=True)
	_fix_sales_order_payment_schedule(doc)
	doc.save()
	return doc


def _fix_sales_order_payment_schedule(doc):
	"""Keep Payment Schedule due dates on/after transaction date so flow save can succeed."""
	if getattr(doc, "doctype", None) != "Sales Order":
		return
	if not doc.get("transaction_date"):
		doc.transaction_date = frappe.utils.today()
	txn = getdate(doc.transaction_date)
	if doc.get("delivery_date") and getdate(doc.delivery_date) < txn:
		doc.delivery_date = txn
	for row in doc.get("payment_schedule") or []:
		due = getdate(row.due_date) if row.get("due_date") else None
		if not due or due < txn:
			row.due_date = txn


@frappe.whitelist()
def create_flow_form_document(doctype, data):
	data = _parse_optional_json(data)
	if doctype == "Stock Entry":
		from ss_coil.stock_entry_data_entry import create_stock_entry_from_data_entry

		return create_stock_entry_from_data_entry(data)

	config = _resolve_flow_form_config(doctype)
	if not config:
		frappe.throw(f"Flow form is not configured for {doctype}")

	doc = frappe.new_doc(doctype)
	_write_flow_form_doc(doc, config, data)
	return {"name": doc.name, "doctype": doctype, "docstatus": cint(doc.docstatus)}


@frappe.whitelist()
def save_flow_form_document(doctype, name, data):
	data = _parse_optional_json(data)
	if doctype == "Stock Entry":
		from ss_coil.stock_entry_data_entry import save_stock_entry_data_entry

		return save_stock_entry_data_entry(name, data)

	config = _resolve_flow_form_config(doctype)
	if not config:
		frappe.throw(f"Flow form is not configured for {doctype}")

	doc = frappe.get_doc(doctype, name)
	_write_flow_form_doc(doc, config, data)
	return {"name": doc.name, "doctype": doctype, "docstatus": cint(doc.docstatus)}


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

	config = _resolve_flow_form_config(doctype)
	if not config:
		return
	for fieldname in config["parent_fields"]:
		if fieldname in data:
			doc.set(fieldname, data.get(fieldname))
	for child_table, child_fields in _iter_table_specs(config):
		incoming = data.get(child_table) or (
			[] if child_table != config["child_table"] else data.get("items") or []
		)
		rows = doc.get(child_table) or []
		for index, row_data in enumerate(incoming):
			row_data = frappe.parse_json(row_data) if isinstance(row_data, str) else row_data
			if index >= len(rows) or not row_data:
				continue
			for fieldname in child_fields:
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
	mapped_doc = _parse_optional_json(mapped_doc)
	data = _parse_optional_json(data)
	if not mapped_doc:
		frappe.throw("Mapped document is required")

	payload = _strip_local_identity(mapped_doc)
	payload["doctype"] = doctype
	doc = frappe.get_doc(payload)
	_overlay_flow_values(doc, doctype, data or {})
	if doctype == "Sales Order":
		_prepare_mapped_sales_order(doc)
		from ss_coil.coil_production import sync_sales_order_items_and_production

		sync_sales_order_items_and_production(doc, fill_missing=True)
	doc.insert()
	if doctype == "Stock Entry":
		from ss_coil.stock_entry_data_entry import _stock_entry_data_entry_response

		doc.reload()
		return _stock_entry_data_entry_response(doc)
	return {"name": doc.name, "doctype": doctype, "docstatus": cint(doc.docstatus)}


@frappe.whitelist()
def submit_flow_form_document(doctype, name=None, data=None, mapped_doc=None):
	"""Save the current flow form as a draft if needed, then submit.

	SS Coil is not submittable — callers should hide Submit for that step.
	"""
	if not doctype:
		frappe.throw("Document type is required")
	meta = frappe.get_meta(doctype)
	if not meta.is_submittable:
		frappe.throw(f"{doctype} cannot be submitted")

	data = _parse_optional_json(data)
	mapped_doc = _parse_optional_json(mapped_doc)

	if mapped_doc and _is_local_doc_name(name):
		result = insert_mapped_flow_document(doctype, mapped_doc, data)
		name = result.get("name")
	elif _is_local_doc_name(name):
		result = create_flow_form_document(doctype, data)
		name = result.get("name")
	elif name and cint(frappe.db.get_value(doctype, name, "docstatus")) == 0:
		save_flow_form_document(doctype, name, data)

	if not name:
		frappe.throw("Could not save the document before submit")

	doc = frappe.get_doc(doctype, name)
	if cint(doc.docstatus) == 2:
		frappe.throw("Cancelled documents cannot be submitted")
	if cint(doc.docstatus) == 0:
		doc.submit()
		doc.reload()

	if doctype == "Stock Entry":
		from ss_coil.stock_entry_data_entry import _stock_entry_data_entry_response

		return _stock_entry_data_entry_response(doc)
	return {"name": doc.name, "doctype": doctype, "docstatus": cint(doc.docstatus)}


@frappe.whitelist()
def get_ss_coils_for_order(order_no):
	"""Related SS Coil jobs for one Sales Order, used by the flow operations strip."""
	if not order_no:
		return []
	return frappe.get_all(
		"SS Coil",
		filters={"order_no": order_no},
		fields=["name", "operation", "order_status", "machine", "sales_order_item"],
		order_by="creation asc",
	)


SS_COIL_FLOW_STATUSES = (
	"Not Started",
	"In Process",
	"Partially Completed",
	"Stopped",
	"Completed",
	"Closed",
)


def _datetime_str(value):
	if not value:
		return ""
	return get_datetime(value).strftime("%Y-%m-%d %H:%M:%S")


def _format_elapsed(started_on, completed_on=None):
	if not started_on:
		return ""
	start = get_datetime(started_on)
	end = get_datetime(completed_on or now_datetime())
	seconds = max(int((end - start).total_seconds()), 0)
	days, rem = divmod(seconds, 86400)
	hours, rem = divmod(rem, 3600)
	minutes, secs = divmod(rem, 60)
	return f"{days}d {hours:02d}h {minutes:02d}m {secs:02d}s"


def _ss_coil_control_payload(doc):
	completed_on = doc.get("completed_on")
	started_on = doc.get("started_on")
	order_status = doc.get("order_status") or "Not Started"
	if order_status in ("In Process", "Partially Completed") and not started_on and doc.get("name"):
		started_on = now_datetime()
		frappe.db.set_value("SS Coil", doc.name, "started_on", started_on, update_modified=False)
		doc.started_on = started_on
	return {
		"process_control_enabled": cint(doc.get("process_control_enabled")),
		"started_on": _datetime_str(started_on),
		"completed_on": _datetime_str(completed_on),
		"elapsed_time": _format_elapsed(started_on, completed_on) if started_on else (doc.get("elapsed_time") or ""),
		"order_status": order_status,
		"operation": doc.get("operation") or "",
	}


def _require_ss_coil_process_control(doc, action_label):
	if cint(doc.get("process_control_enabled")):
		return
	frappe.throw(f"Turn ON Process Control before using {action_label}.")


@frappe.whitelist()
def set_ss_coil_process_control(name, enabled):
	if not name:
		frappe.throw("SS Coil name is required")
	doc = frappe.get_doc("SS Coil", name)
	doc.process_control_enabled = 1 if cint(enabled) else 0
	doc.save()
	payload = _ss_coil_control_payload(doc)
	payload["name"] = doc.name
	return payload


@frappe.whitelist()
def set_ss_coil_order_status(name, order_status):
	if not name:
		frappe.throw("SS Coil name is required")
	if order_status not in SS_COIL_FLOW_STATUSES:
		frappe.throw(f"Invalid order status: {order_status}")

	doc = frappe.get_doc("SS Coil", name)
	_require_ss_coil_process_control(doc, order_status)
	now = now_datetime()
	started_on = doc.get("started_on")
	if order_status in ("In Process", "Partially Completed", "Completed") and not started_on:
		started_on = now
	completed_on = doc.get("completed_on")
	if order_status == "Completed":
		completed_on = now
	elif order_status in ("Not Started", "In Process", "Partially Completed", "Stopped"):
		completed_on = None
	frappe.db.set_value(
		"SS Coil",
		name,
		{
			"order_status": order_status,
			"started_on": started_on,
			"completed_on": completed_on,
			"elapsed_time": _format_elapsed(started_on, completed_on or now),
			"process_control_enabled": 0,
		},
		update_modified=True,
	)
	doc = frappe.get_doc("SS Coil", name)
	payload = _ss_coil_control_payload(doc)
	payload["name"] = doc.name
	return payload
