import json
import os

import frappe

LAYOUT_DOCTYPES = {
	"Stock Entry",
	"Stock Entry Detail",
	"Sales Order",
	"Sales Order Item",
	"Purchase Receipt Item",
	"SS Coil",
}

LAYOUT_PROPERTIES = {"field_order", "hidden", "button_color"}


@frappe.whitelist()
def sync_coil_form_layouts():
	"""Apply Stock Entry / Sales Order field layout from app fixtures on every install/migrate."""
	_apply_fixture_property_setters()
	_sync_stock_entry_job_purpose_field()
	_ensure_stock_entry_detail_field_order()
	ensure_ss_coil_job_sheet_field_order()
	ensure_sales_order_job_sheet_field_order()
	frappe.clear_cache(doctype="Stock Entry")
	frappe.clear_cache(doctype="Stock Entry Detail")
	frappe.clear_cache(doctype="Sales Order")
	frappe.clear_cache(doctype="Sales Order Item")
	frappe.clear_cache(doctype="Purchase Receipt Item")
	frappe.clear_cache(doctype="SS Coil")


def _apply_fixture_property_setters():
	fixture_path = os.path.join(frappe.get_app_path("ss_coil"), "fixtures", "property_setter.json")
	if not os.path.exists(fixture_path):
		return

	with open(fixture_path, encoding="utf-8") as handle:
		records = json.load(handle)

	for record in records:
		if record.get("doc_type") not in LAYOUT_DOCTYPES:
			continue
		if record.get("property") not in LAYOUT_PROPERTIES:
			continue

		args = {
			"doctype": record["doc_type"],
			"fieldname": record.get("field_name"),
			"property": record["property"],
			"property_type": record.get("property_type") or "Data",
			"value": record.get("value"),
		}
		name = record.get("name")
		if name and frappe.db.exists("Property Setter", name):
			frappe.db.set_value(
				"Property Setter",
				name,
				{
					"value": args["value"],
					"property_type": args["property_type"],
				},
				update_modified=False,
			)
			continue

		frappe.make_property_setter(
			{**args, "doctype_or_field": record.get("doctype_or_field") or "DocType"},
			ignore_validate=True,
			is_system_generated=False,
		)


def _sync_stock_entry_job_purpose_field():
	from frappe.custom.doctype.custom_field.custom_field import create_custom_fields

	field_spec = {
		"fieldname": "custom_job_purpose",
		"label": "Job Purpose",
		"fieldtype": "Select",
		"options": "Tolling\nOwn",
		"insert_after": "purpose",
	}
	fieldname = "Stock Entry-custom_job_purpose"

	if not frappe.db.exists("Custom Field", fieldname):
		create_custom_fields({"Stock Entry": [field_spec]}, update=True)
		return

	frappe.db.set_value(
		"Custom Field",
		fieldname,
		field_spec,
		update_modified=False,
	)


def _ensure_stock_entry_detail_field_order():
	ps_name = "Stock Entry Detail-main-field_order"
	if not frappe.db.exists("Property Setter", ps_name):
		return

	order = json.loads(frappe.db.get_value("Property Setter", ps_name, "value") or "[]")
	changed = False

	if "custom_create_tag_no" not in order and "custom_tag_no" in order:
		order.insert(order.index("custom_tag_no") + 1, "custom_create_tag_no")
		changed = True

	if "custom_finish_good_item" not in order:
		anchor = "item_name" if "item_name" in order else "item_code"
		if anchor in order:
			order.insert(order.index(anchor) + 1, "custom_finish_good_item")
			changed = True

	process_fields = (
		"custom_section_break_gbgwe",
		"custom_slitter",
		"custom_column_break_kidd0",
		"custom_leveler",
		"custom_column_break_ehrzk",
		"custom_reshearing",
	)
	if "custom_qty_of_coil" in order:
		insert_at = order.index("custom_qty_of_coil") + 1
		for fieldname in process_fields:
			if fieldname in order:
				continue
			order.insert(insert_at, fieldname)
			insert_at += 1
			changed = True

	if changed:
		frappe.db.set_value("Property Setter", ps_name, "value", json.dumps(order), update_modified=False)


SS_COIL_JOB_SHEET_FIELD_SEQUENCE = (
	"job_sheet_tab",
	"section_break_xqer",
	"machine",
	"column_break_kqkz",
	"calc_ratio",
	"column_break_etcy",
	"calc_ratio_2",
	"column_break_twrr",
	"actual_ratio",
	"column_break_rtqo",
	"remaining_width",
	"section_break_ajao",
	"cutting_detail",
	"grand_total_width",
	"section_break_wqal",
	"special_instructions",
	"column_break_lnsp",
	"remarks",
	"section_break_qasa",
	"width",
	"column_break_cwla",
	"ds",
	"column_break_afmq",
	"ctr",
	"column_break_evbq",
	"ws",
	"column_break_slet",
	"section_break_zbvk",
	"mill",
	"column_break_ajyx",
	"specifications",
	"column_break_kbpk",
	"commodity",
	"column_break_yzap",
	"works",
	"section_break_ifey",
	"planning",
	"column_break_aovo",
	"sales",
	"column_break_titn",
	"produciton",
	"column_break_ueot",
	"encoded_by",
	"job_sheet_report",
)


def ensure_ss_coil_job_sheet_field_order():
	"""Keep Job Sheet tab fields grouped on the Job Sheet tab (before HTML report)."""
	ps_name = "SS Coil-main-field_order"
	if not frappe.db.exists("Property Setter", ps_name):
		return

	meta = frappe.get_meta("SS Coil")
	order = json.loads(frappe.db.get_value("Property Setter", ps_name, "value") or "[]")

	for fieldname in SS_COIL_JOB_SHEET_FIELD_SEQUENCE:
		while fieldname in order:
			order.remove(fieldname)

	tail = [fn for fn in SS_COIL_JOB_SHEET_FIELD_SEQUENCE if meta.get_field(fn)]
	if not tail:
		return

	# Job Sheet tab block sits after Daigrams, before Formula tab if present.
	insert_at = len(order)
	for anchor in ("formula_tab", "formulas"):
		if anchor in order:
			insert_at = min(insert_at, order.index(anchor))
	for anchor in ("daigrams_view", "daigrams_tab", "order_status_report", "dashboard_tab"):
		if anchor in order:
			insert_at = max(insert_at, order.index(anchor) + 1)

	for idx, fieldname in enumerate(tail):
		order.insert(insert_at + idx, fieldname)

	frappe.db.set_value("Property Setter", ps_name, "value", json.dumps(order), update_modified=False)


SALES_ORDER_JOB_SHEET_FIELD_SEQUENCE = (
	"custom_job_sheet_tab",
	"custom_job_sheet_report",
)


def ensure_sales_order_job_sheet_field_order():
	"""Job Sheet tab + HTML report only — always last on the form."""
	ps_name = "Sales Order-main-field_order"
	if not frappe.db.exists("Property Setter", ps_name):
		return

	meta = frappe.get_meta("Sales Order")
	order = json.loads(frappe.db.get_value("Property Setter", ps_name, "value") or "[]")

	# Drop any legacy job-sheet fieldnames from the order list
	legacy = [
		fn
		for fn in order
		if "job_sheet" in (fn or "") and fn not in SALES_ORDER_JOB_SHEET_FIELD_SEQUENCE
	]
	for fieldname in list(SALES_ORDER_JOB_SHEET_FIELD_SEQUENCE) + legacy:
		while fieldname in order:
			order.remove(fieldname)

	tail = [fn for fn in SALES_ORDER_JOB_SHEET_FIELD_SEQUENCE if meta.get_field(fn) and not meta.get_field(fn).hidden]
	if not tail:
		return

	order.extend(tail)
	frappe.db.set_value("Property Setter", ps_name, "value", json.dumps(order), update_modified=False)
