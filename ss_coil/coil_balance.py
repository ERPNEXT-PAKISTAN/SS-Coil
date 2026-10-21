"""Build the per-tag material balance child tables on Sales Order and SS Coil."""

import frappe
from frappe.utils import flt


def _existing_types(doc, fieldname):
	return {
		row.get("raw_tag_no"): row.get("remaining_type")
		for row in (doc.get(fieldname) or [])
		if row.get("raw_tag_no")
	}


def _existing_remainder_tags(doc, fieldname):
	return {row.get("raw_tag_no"): row.get("remainder_tag_no") for row in (doc.get(fieldname) or []) if row.get("raw_tag_no") and row.get("remainder_tag_no")}


def _remainder_tag(raw_tag_no, existing_tag, output_tags):
	if existing_tag or not raw_tag_no:
		return existing_tag
	from ss_coil.api import _next_sub_tag
	return _next_sub_tag(raw_tag_no, also_used=output_tags or [])


def _register_remainder_tag(doc, tag_no, parent_tag_no, method):
	if not tag_no or not method:
		return
	from ss_coil.api import _register_tag
	_register_tag(tag_no, source_doctype=doc.doctype, source_docname=doc.name,
		sales_order=doc.name if doc.doctype == "Sales Order" else doc.get("order_no"),
		parent_tag_no=parent_tag_no, root_tag_no=parent_tag_no, status="Active")


def _material_type(processed_width, remaining_width, previous=None):
	if previous:
		return previous
	if processed_width <= 0:
		return "Unprocessed"
	if remaining_width > 0:
		return "Leftover"
	return "Fully Processed"


def _qty_by_width(qty, processed_width, remaining_width, received_width):
	if received_width <= 0:
		return 0, 0
	return (
		flt(qty) * flt(processed_width) / flt(received_width),
		flt(qty) * flt(remaining_width) / flt(received_width),
	)


def _sales_order_cut_widths(doc):
	from ss_coil.api import _has_field

	by_item = {}
	plan_fields = ["name", "sales_order_item"]
	if _has_field("SO Production Plan", "process_key"):
		plan_fields.append("process_key")
	for plan in frappe.get_all("SO Production Plan", filters={"sales_order": doc.name}, fields=plan_fields):
		if plan.get("process_key") and plan.process_key != "slitter":
			continue
		plan_doc = frappe.get_doc("SO Production Plan", plan.name)
		width = sum(
			flt(row.get("total_width"))
			if flt(row.get("total_width"))
			else flt(row.get("width")) * flt(row.get("strip"))
			for row in (plan_doc.get("cutting_scheme") or [])
		)
		by_item[plan.sales_order_item] = by_item.get(plan.sales_order_item, 0) + width
	return by_item


def sync_sales_order_coil_balance_rows(doc, method=None):
	if not doc.meta.has_field("custom_coil_balance"):
		return

	old_types = _existing_types(doc, "custom_coil_balance")
	old_remainder_tags = _existing_remainder_tags(doc, "custom_coil_balance")
	cut_width_by_item = _sales_order_cut_widths(doc)
	doc.set("custom_coil_balance", [])
	for coil in (doc.get("custom_coil_production") or []):
		received_width = flt(coil.get("width"))
		received_qty = flt(coil.get("qty")) or flt(coil.get("estimated_wt"))
		processed_width = cut_width_by_item.get(coil.get("sales_order_item"), 0)
		if not processed_width and coil.get("remaining_width") not in (None, ""):
			processed_width = max(received_width - flt(coil.get("remaining_width")), 0)
		processed_width = min(processed_width, received_width) if received_width > 0 else processed_width
		remaining_width = max(received_width - processed_width, 0)
		produced_qty, remaining_qty = _qty_by_width(received_qty, processed_width, remaining_width, received_width)
		tags = ", ".join(dict.fromkeys(filter(None, [coil.get("tag_no"), coil.get("sub_tag_no")])))
		raw_tag_no = coil.get("raw_material_tag_no") or coil.get("tag_no")
		remainder_tag_no = _remainder_tag(raw_tag_no, old_remainder_tags.get(raw_tag_no), tags.split(", ")) if remaining_width > 0 else None
		doc.append(
			"custom_coil_balance",
			{
				"raw_tag_no": raw_tag_no,
				"output_tag_no": tags,
				"remainder_tag_no": remainder_tag_no,
				"received_qty": received_qty,
				"received_width": received_width,
				"processed_width": processed_width,
				"produced_qty": produced_qty,
				"remaining_width": remaining_width,
				"remaining_qty": remaining_qty,
				"remaining_type": _material_type(processed_width, remaining_width, old_types.get(coil.get("raw_material_tag_no") or coil.get("tag_no"))),
				"qty_basis": "Width ratio estimate",
			},
		)
		_register_remainder_tag(doc, remainder_tag_no, raw_tag_no, method)


def sync_ss_coil_balance_rows(doc, method=None):
	if not doc.meta.has_field("coil_balance"):
		return

	old_types = _existing_types(doc, "coil_balance")
	old_remainder_tags = _existing_remainder_tags(doc, "coil_balance")
	received_width = flt(doc.get("width"))
	if not received_width and doc.get("so_item"):
		received_width = flt(doc.so_item[0].get("width"))
	processed_width = sum(
		flt(row.get("total_width"))
		if flt(row.get("total_width"))
		else flt(row.get("width")) * flt(row.get("strip"))
		for row in (doc.get("cutting_detail") or [])
	)
	if not processed_width:
		processed_width = flt(doc.get("grand_total_width"))
	processed_width = min(processed_width, received_width) if received_width > 0 else processed_width
	remaining_width = max(received_width - processed_width, 0)
	received_qty = sum(
		flt(row.get("actual_wt")) or flt(row.get("estimated_wt"))
		for row in (doc.get("input_coil") or [])
	) or flt(doc.get("grand_estimated_wt"))
	produced_qty, remaining_qty = _qty_by_width(received_qty, processed_width, remaining_width, received_width)
	input_tags = ", ".join(row.get("tag_no") for row in (doc.get("input_coil") or []) if row.get("tag_no"))
	output_tags = ", ".join(row.get("tag_no") for row in (doc.get("job_output") or []) if row.get("tag_no"))
	raw_tag_no = next((row.get("tag_no") for row in (doc.get("input_coil") or []) if row.get("tag_no")), None)
	remainder_tag_no = _remainder_tag(raw_tag_no, old_remainder_tags.get(input_tags) or old_remainder_tags.get(raw_tag_no), output_tags.split(", ")) if remaining_width > 0 else None
	doc.set("coil_balance", [])
	doc.append(
		"coil_balance",
		{
			"raw_tag_no": input_tags,
			"output_tag_no": output_tags,
			"remainder_tag_no": remainder_tag_no,
			"received_qty": received_qty,
			"received_width": received_width,
			"processed_width": processed_width,
			"produced_qty": produced_qty,
			"remaining_width": remaining_width,
			"remaining_qty": remaining_qty,
			"remaining_type": _material_type(processed_width, remaining_width, old_types.get(input_tags)),
			"qty_basis": "Width ratio estimate",
		},
	)
	_register_remainder_tag(doc, remainder_tag_no, raw_tag_no, method)
