import frappe
from frappe import _
from frappe.utils import flt


TRACE_FIELDS = [
	"tag_no", "parent_tag_no", "root_tag_no", "lineage_path", "status", "sales_order",
	"item_code", "item_name", "batch_no", "customer_name", "current_process",
	"source_doctype", "source_docname", "source_child_doctype", "source_child_name",
	"current_doctype", "current_docname",
]


def _registry_rows(filters, movement_rows):
	conditions = []
	values = {}
	for field, column in (("status", "status"), ("sales_order", "sales_order"), ("item_code", "item_code")):
		if filters.get(field):
			conditions.append(f"{column} = %({field})s")
			values[field] = filters[field]
	if filters.get("customer"):
		conditions.append("customer_name = %(customer)s")
		values["customer"] = filters.customer
	if filters.get("root_tag_no"):
		conditions.append("ifnull(root_tag_no, tag_no) = %(root_tag_no)s")
		values["root_tag_no"] = filters.root_tag_no
	if filters.get("parent_tag_no"):
		conditions.append("(parent_tag_no = %(parent_tag_no)s or tag_no = %(parent_tag_no)s or root_tag_no = %(parent_tag_no)s)")
		values["parent_tag_no"] = filters.parent_tag_no
	if filters.get("tag_no"):
		conditions.append("(tag_no like %(tag_no)s or parent_tag_no like %(tag_no)s or ifnull(root_tag_no, tag_no) in (select ifnull(root_tag_no, tag_no) from `tabTag Registry` where tag_no like %(tag_no)s))")
		values["tag_no"] = f"%{filters.tag_no}%"

	# With no lineage selector, show the families touched by the selected stock movements.
	if not conditions:
		observed_tags = {row.get("tag_no") for row in movement_rows if row.get("tag_no")}
		if not observed_tags:
			return []
		roots = set(frappe.get_all(
			"Tag Registry", filters={"tag_no": ["in", list(observed_tags)]}, pluck="root_tag_no"
		))
		roots.update(observed_tags)
		conditions.append("(tag_no in %(roots)s or ifnull(root_tag_no, tag_no) in %(roots)s)")
		values["roots"] = tuple(roots)

	where = " where " + " and ".join(conditions) if conditions else ""
	return frappe.db.sql(
		f"select {', '.join(TRACE_FIELDS)} from `tabTag Registry`{where} order by ifnull(root_tag_no, tag_no), generation_level, tag_no",
		values,
		as_dict=True,
	)


def execute(filters=None):
	filters = frappe._dict(filters or {})
	from ss_coil.ss_coil.report.coil_stock_movement.coil_stock_movement import execute as stock_movement_execute

	movement_filters = frappe._dict({key: value for key, value in filters.items() if key not in ("root_tag_no", "parent_tag_no", "status")})
	if filters.get("tag_no"):
		movement_filters.pop("tag_no", None)
	movement_columns, movement_rows = stock_movement_execute(movement_filters)
	registry_rows = _registry_rows(filters, movement_rows)
	registry_by_tag = {row.tag_no: row for row in registry_rows}

	columns = [
		{"label": _("Parent / Input Tag No"), "fieldname": "trace_parent_tag_no", "fieldtype": "Link", "options": "Tag Registry", "width": 175},
		{"label": _("Output / Child Tag No"), "fieldname": "trace_output_tag_no", "fieldtype": "Link", "options": "Tag Registry", "width": 175},
		{"label": _("Tag Role"), "fieldname": "tag_role", "fieldtype": "Data", "width": 115},
		{"label": _("Lineage Path"), "fieldname": "lineage_path", "fieldtype": "Data", "width": 260},
		{"label": _("Tag Status"), "fieldname": "tag_status", "fieldtype": "Data", "width": 105},
		{"label": _("Produced Qty"), "fieldname": "produced_qty", "fieldtype": "Float", "precision": 3, "width": 115},
		{"label": _("Remainder Width"), "fieldname": "remainder_width", "fieldtype": "Float", "precision": 3, "width": 115},
		{"label": _("Remainder Qty"), "fieldname": "remainder_qty", "fieldtype": "Float", "precision": 3, "width": 115},
		{"label": _("Remainder Type"), "fieldname": "remainder_type", "fieldtype": "Data", "width": 120},
	]
	columns.extend(movement_columns)
	columns.extend([
		{"label": _("Source Document"), "fieldname": "source_docname", "fieldtype": "Data", "width": 170},
		{"label": _("Current Process"), "fieldname": "current_process", "fieldtype": "Data", "width": 130},
		{"label": _("Current Document"), "fieldname": "current_docname", "fieldtype": "Data", "width": 170},
	])

	rows_by_tag = {}
	for movement in movement_rows:
		tag = movement.get("tag_no")
		if tag in registry_by_tag:
			rows_by_tag.setdefault(tag, []).append(movement)

	output_tags = [tag.tag_no for tag in registry_rows if tag.parent_tag_no]
	output_details = {
		row.tag_no: row for row in frappe.get_all(
			"Coil Output",
			filters={"tag_no": ["in", output_tags]},
			fields=["tag_no", "actual_wt", "estimated_wt", "thickness", "width", "length", "customer"],
		)
	} if output_tags else {}
	remainder_details = {
		row.remainder_tag_no: row for row in frappe.get_all(
			"Coil Balance Row",
			filters={"remainder_tag_no": ["in", [tag.tag_no for tag in registry_rows]]},
			fields=["remainder_tag_no", "remaining_width", "remaining_qty", "remaining_type"],
		)
	} if registry_rows else {}

	data = []
	for tag in registry_rows:
		is_child = bool(tag.parent_tag_no)
		base = {
			"trace_parent_tag_no": tag.parent_tag_no or (tag.root_tag_no if tag.root_tag_no != tag.tag_no else tag.tag_no),
			"trace_output_tag_no": tag.tag_no if is_child else None,
			"tag_role": _("Output / Child") if is_child else _("Parent / Input"),
			"lineage_path": tag.lineage_path,
			"tag_status": tag.status,
			"source_docname": tag.source_docname,
			"current_process": tag.current_process,
			"current_docname": tag.current_docname,
		}
		output_detail = output_details.get(tag.tag_no)
		remainder_detail = remainder_details.get(tag.tag_no)
		if output_detail:
			base.update({
				"produced_qty": flt(output_detail.actual_wt) or flt(output_detail.estimated_wt),
				"thickness": output_detail.thickness,
				"width": output_detail.width,
				"length": output_detail.length,
				"customer": output_detail.customer,
			})
		if remainder_detail:
			base.update({
				"remainder_width": remainder_detail.remaining_width,
				"remainder_qty": remainder_detail.remaining_qty,
				"remainder_type": remainder_detail.remaining_type,
			})
		tag_movements = rows_by_tag.get(tag.tag_no) or []
		if tag_movements:
			for movement in tag_movements:
				data.append({**movement, **base})
		else:
			data.append({
				**base,
				"customer_name": tag.customer_name,
				"tag_no": tag.tag_no,
				"sales_order": tag.sales_order,
				"item_code": tag.item_code,
				"item_name": tag.item_name,
				"customer": output_detail.customer if output_detail else None,
				"thickness": output_detail.thickness if output_detail else None,
				"width": output_detail.width if output_detail else None,
				"length": output_detail.length if output_detail else None,
				"batch_no": tag.batch_no,
				"remainder_width": remainder_detail.remaining_width if remainder_detail else None,
				"remainder_qty": remainder_detail.remaining_qty if remainder_detail else None,
				"remainder_type": remainder_detail.remaining_type if remainder_detail else None,
				"stock_in": 0,
				"stock_out": 0,
				"balance": None,
			})
	return columns, data
