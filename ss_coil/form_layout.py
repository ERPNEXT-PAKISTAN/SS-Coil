import json
import os

import frappe

LAYOUT_DOCTYPES = {
	"Stock Entry",
	"Stock Entry Detail",
	"Sales Order",
	"Sales Order Item",
	"Purchase Receipt Item",
}

LAYOUT_PROPERTIES = {"field_order", "hidden", "button_color"}


@frappe.whitelist()
def sync_coil_form_layouts():
	"""Apply Stock Entry / Sales Order field layout from app fixtures on every install/migrate."""
	_apply_fixture_property_setters()
	_sync_stock_entry_job_purpose_field()
	_ensure_stock_entry_detail_field_order()
	frappe.clear_cache(doctype="Stock Entry")
	frappe.clear_cache(doctype="Stock Entry Detail")
	frappe.clear_cache(doctype="Sales Order")
	frappe.clear_cache(doctype="Sales Order Item")
	frappe.clear_cache(doctype="Purchase Receipt Item")


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
	fieldname = "Stock Entry-custom_job_purpose"
	if not frappe.db.exists("Custom Field", fieldname):
		return
	frappe.db.set_value(
		"Custom Field",
		fieldname,
		{
			"fieldtype": "Select",
			"options": "Tolling\nOwn",
			"insert_after": "purpose",
			"label": "Job Purpose",
		},
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
