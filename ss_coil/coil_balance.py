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
	if not raw_tag_no:
		return None
	from ss_coil.api import _next_sub_tag, _subtag_series_base

	output_tags = [str(tag).strip() for tag in (output_tags or []) if tag]
	if existing_tag and existing_tag not in output_tags:
		base = _subtag_series_base(raw_tag_no)
		prefix = f"{base}-" if base else ""
		if prefix and str(existing_tag).startswith(prefix):
			suffix = str(existing_tag)[len(prefix) :]
			output_indexes = [
				int(str(tag)[len(prefix) :])
				for tag in output_tags
				if str(tag).startswith(prefix) and str(tag)[len(prefix) :].isdigit()
			]
			if suffix.isdigit() and int(suffix) > max(output_indexes or [0]):
				return existing_tag
	return _next_sub_tag(raw_tag_no, also_used=output_tags)


def _register_remainder_tag(doc, tag_no, parent_tag_no, method):
	if not tag_no or not method:
		return
	from ss_coil.api import _register_tag
	_register_tag(tag_no, source_doctype=doc.doctype, source_docname=doc.name,
		sales_order=doc.name if doc.doctype == "Sales Order" else doc.get("order_no"),
		parent_tag_no=parent_tag_no, root_tag_no=parent_tag_no, status="Active")


def _material_type(processed_width, remaining_width, previous=None):
	if previous and frappe.db.exists("Coil Balance Type", previous):
		return previous
	if processed_width <= 0:
		status = "Unprocessed"
	elif remaining_width > 0:
		status = "Leftover"
	else:
		status = "Fully Processed"
	if frappe.db.exists("DocType", "Coil Balance Type"):
		return frappe.db.get_value("Coil Balance Type", {"balance_status": status}, "name", order_by="type_name asc") or None
	return status


def _qty_by_width(qty, processed_width, remaining_width, received_width):
	if received_width <= 0:
		return 0, 0
	return (
		flt(qty) * flt(processed_width) / flt(received_width),
		flt(qty) * flt(remaining_width) / flt(received_width),
	)


def _output_tags_for_sales_order_item(item):
	job_names = frappe.get_all("SS Coil", filters={"sales_order_item": item.name}, pluck="name")
	if job_names:
		rows = frappe.get_all(
			"Coil Output",
			filters={"parent": ["in", job_names], "tag_no": ["is", "set"]},
			fields=["tag_no", "parent", "idx"],
			order_by="parent asc, idx asc",
		)
		tags = list(dict.fromkeys(row.tag_no for row in rows if row.tag_no))
		if tags:
			return tags
	raw_tag_no = item.get("custom_raw_material_tag_no") or item.get("custom_tag_no")
	return list(
		dict.fromkeys(
			tag.strip()
			for fieldname in ("custom_tag_no", "custom_sub_tag_no", "custom_child_tag_no")
			for tag in str(item.get(fieldname) or "").split(",")
			if tag.strip() and tag.strip() != raw_tag_no
		)
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


def sync_sales_order_coil_balance_rows(doc, method=None, extra_output_tags_by_item=None):
	if not doc.meta.has_field("custom_coil_balance"):
		return

	old_types = _existing_types(doc, "custom_coil_balance")
	old_remainder_tags = _existing_remainder_tags(doc, "custom_coil_balance")
	cut_width_by_item = _sales_order_cut_widths(doc)
	doc.set("custom_coil_balance", [])
	from ss_coil.process_charges import is_process_charge_row

	extra_output_tags_by_item = extra_output_tags_by_item or {}
	for item in (doc.items or []):
		if is_process_charge_row(item):
			continue
		received_width = flt(item.get("custom_width"))
		received_qty = flt(item.get("custom_estimated_wt")) or flt(item.get("qty"))
		processed_width = cut_width_by_item.get(item.name, 0)
		if not processed_width and item.get("custom_remaining_width") not in (None, ""):
			processed_width = max(received_width - flt(item.get("custom_remaining_width")), 0)
		processed_width = min(processed_width, received_width) if received_width > 0 else processed_width
		remaining_width = max(received_width - processed_width, 0)
		produced_qty, remaining_qty = _qty_by_width(received_qty, processed_width, remaining_width, received_width)
		raw_tag_no = (
			item.get("custom_raw_material_tag_no")
			or item.get("custom_finish_good_item")
			or item.get("custom_raw_material_item")
			or item.get("custom_tag_no")
		)
		output_tags = list(
			dict.fromkeys(
				_output_tags_for_sales_order_item(item)
				+ list(extra_output_tags_by_item.get(item.name) or [])
			)
		)
		tags = ", ".join(output_tags)
		remainder_tag_no = _remainder_tag(raw_tag_no, old_remainder_tags.get(raw_tag_no), output_tags) if remaining_width > 0 else None
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
				"remaining_type": _material_type(processed_width, remaining_width, old_types.get(raw_tag_no)),
				"qty_basis": "Width ratio estimate",
			},
		)
		_register_remainder_tag(doc, remainder_tag_no, raw_tag_no, method)


def sync_ss_coil_balance_rows(doc, method=None):
	if not doc.meta.has_field("coil_balance"):
		return
	doc.set("coil_balance", [])
	if not doc.get("order_no") or not doc.get("sales_order_item"):
		return

	order = frappe.get_doc("Sales Order", doc.order_no)
	job_output_tags = [row.get("tag_no") for row in (doc.get("job_output") or []) if row.get("tag_no")]
	sync_sales_order_coil_balance_rows(
		order,
		method=None,
		extra_output_tags_by_item={doc.sales_order_item: job_output_tags},
	)
	so_item = next((row for row in (order.items or []) if row.name == doc.sales_order_item), None)
	if not so_item:
		return
	raw_tag_no = (
		so_item.get("custom_raw_material_tag_no")
		or so_item.get("custom_finish_good_item")
		or so_item.get("custom_raw_material_item")
		or so_item.get("custom_tag_no")
	)
	balance = next(
		(row for row in (order.get("custom_coil_balance") or []) if row.get("raw_tag_no") == raw_tag_no),
		None,
	)
	if not balance:
		return

	values = {
		fieldname: balance.get(fieldname)
		for fieldname in (
			"raw_tag_no",
			"output_tag_no",
			"remainder_tag_no",
			"received_qty",
			"received_width",
			"processed_width",
			"produced_qty",
			"remaining_width",
			"remaining_qty",
			"remaining_type",
			"qty_basis",
		)
	}
	doc.append("coil_balance", values.copy())

	# Keep the Sales Order's row current as later SS Coil outputs consume new tags.
	so_balance_name = frappe.db.get_value(
		"Coil Balance Row",
		{"parent": order.name, "parenttype": "Sales Order", "parentfield": "custom_coil_balance", "raw_tag_no": raw_tag_no},
		"name",
	)
	if so_balance_name:
		frappe.db.set_value("Coil Balance Row", so_balance_name, values, update_modified=False)
	if values.get("remainder_tag_no"):
		_register_remainder_tag(order, values["remainder_tag_no"], raw_tag_no, method="SS Coil balance mirror")


def repair_existing_coil_balance_rows(sales_order, ss_coils):
	"""Refresh one SO balance and its linked SS Coil information rows in place."""
	order = frappe.get_doc("Sales Order", sales_order)
	sync_sales_order_coil_balance_rows(order, method=None)
	so_rows_updated = 0
	for row in order.get("custom_coil_balance") or []:
		values = {
			fieldname: row.get(fieldname)
			for fieldname in (
				"raw_tag_no",
				"output_tag_no",
				"remainder_tag_no",
				"received_qty",
				"received_width",
				"processed_width",
				"produced_qty",
				"remaining_width",
				"remaining_qty",
				"remaining_type",
				"qty_basis",
			)
		}
		child_name = frappe.db.get_value(
			"Coil Balance Row",
			{
				"parent": order.name,
				"parenttype": "Sales Order",
				"parentfield": "custom_coil_balance",
				"raw_tag_no": row.raw_tag_no,
			},
			"name",
		)
		if child_name:
			frappe.db.set_value("Coil Balance Row", child_name, values, update_modified=False)
			so_rows_updated += 1
		if values.get("remainder_tag_no"):
			_register_remainder_tag(order, values["remainder_tag_no"], row.raw_tag_no, method="Sales Order balance repair")

	ss_rows_updated = 0
	for coil_name in ss_coils or []:
		coil = frappe.get_doc("SS Coil", coil_name)
		if coil.order_no != order.name:
			continue
		sync_ss_coil_balance_rows(coil, method=None)
		if not coil.get("coil_balance"):
			continue
		values = {
			fieldname: coil.coil_balance[0].get(fieldname)
			for fieldname in (
				"raw_tag_no",
				"output_tag_no",
				"remainder_tag_no",
				"received_qty",
				"received_width",
				"processed_width",
				"produced_qty",
				"remaining_width",
				"remaining_qty",
				"remaining_type",
				"qty_basis",
			)
		}
		child_name = frappe.db.get_value(
			"Coil Balance Row",
			{"parent": coil.name, "parenttype": "SS Coil", "parentfield": "coil_balance"},
			"name",
		)
		if child_name:
			frappe.db.set_value("Coil Balance Row", child_name, values, update_modified=False)
			ss_rows_updated += 1
	return {"sales_order_rows_updated": so_rows_updated, "ss_coil_rows_updated": ss_rows_updated}
