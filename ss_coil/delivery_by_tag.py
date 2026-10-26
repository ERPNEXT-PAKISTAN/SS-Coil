"""Load Delivery Note items by selecting Sales Order Item Tag Nos.

Primary UX: open a new Delivery Note, set Customer, then pick Tag No rows
from open Sales Orders for that customer — no draft save required.
"""

from __future__ import annotations

import frappe
from frappe import _
from frappe.utils import cint, flt

from ss_coil.api import _has_field


def _parse_name_list(value):
	if value in (None, "", b""):
		return []
	if isinstance(value, str):
		value = frappe.parse_json(value)
	if not isinstance(value, (list, tuple)):
		return []
	return [cstr for name in value if (cstr := str(name or "").strip())]


def _sql_col(doctype: str, fieldname: str, alias: str | None = None, table: str | None = None) -> str:
	alias = alias or fieldname
	table = table or doctype
	if frappe.db.has_column(doctype, fieldname):
		return f"`tab{table}`.`{fieldname}` as `{alias}`"
	return f"NULL as `{alias}`"


def _is_process_charge_sql() -> str:
	parts = ["0"]
	if frappe.db.has_column("Sales Order Item", "custom_is_process_charge"):
		parts.append("ifnull(`tabSales Order Item`.custom_is_process_charge, 0) = 1")
	if frappe.db.has_column("Sales Order Item", "custom_process_charge_key"):
		parts.append("ifnull(`tabSales Order Item`.custom_process_charge_key, '') != ''")
	return " or ".join(parts)


def _tag_sql_parts():
	has_prod = frappe.db.table_exists("Coil Production Line")
	prod_join = ""
	prod_tag_expr = "NULL"
	prod_sub_expr = "NULL"
	if has_prod:
		prod_join = """
			left join `tabCoil Production Line` prod
				on prod.parent = `tabSales Order Item`.parent
				and (
					prod.sales_order_item = `tabSales Order Item`.name
					or (
						ifnull(prod.sales_order_item, '') = ''
						and prod.idx = `tabSales Order Item`.idx
					)
				)
		"""
		if frappe.db.has_column("Coil Production Line", "tag_no"):
			prod_tag_expr = "prod.tag_no"
		if frappe.db.has_column("Coil Production Line", "sub_tag_no"):
			prod_sub_expr = "prod.sub_tag_no"

	soi_tag = (
		"`tabSales Order Item`.custom_tag_no"
		if frappe.db.has_column("Sales Order Item", "custom_tag_no")
		else "NULL"
	)
	soi_sub = (
		"`tabSales Order Item`.custom_sub_tag_no"
		if frappe.db.has_column("Sales Order Item", "custom_sub_tag_no")
		else "NULL"
	)
	soi_child = (
		"`tabSales Order Item`.custom_child_tag_no"
		if frappe.db.has_column("Sales Order Item", "custom_child_tag_no")
		else "NULL"
	)
	soi_raw = (
		"`tabSales Order Item`.custom_raw_material_tag_no"
		if frappe.db.has_column("Sales Order Item", "custom_raw_material_tag_no")
		else "NULL"
	)

	tag_expr = f"""
		nullif(trim(coalesce(
			nullif(trim({soi_tag}), ''),
			nullif(trim({prod_tag_expr}), ''),
			nullif(trim({soi_sub}), ''),
			nullif(trim({soi_child}), ''),
			nullif(trim({prod_sub_expr}), ''),
			nullif(trim({soi_raw}), '')
		)), '')
	"""
	return {
		"prod_join": prod_join,
		"tag_expr": tag_expr,
		"soi_tag": soi_tag,
		"soi_sub": soi_sub,
		"prod_tag_expr": prod_tag_expr,
	}


def _fetch_delivery_tag_rows(filters: dict):
	parts = _tag_sql_parts()
	tag_expr = parts["tag_expr"]
	select_cols = [
		"`tabSales Order`.name as sales_order",
		"`tabSales Order`.customer as customer",
		"`tabSales Order`.customer_name as customer_name",
		"`tabSales Order`.company as company",
		"`tabSales Order`.transaction_date as transaction_date",
		"`tabSales Order Item`.name as so_detail",
		"`tabSales Order Item`.idx as idx",
		"`tabSales Order Item`.item_code as item_code",
		"`tabSales Order Item`.item_name as item_name",
		"`tabSales Order Item`.qty as qty",
		"`tabSales Order Item`.delivered_qty as delivered_qty",
		"`tabSales Order Item`.uom as uom",
		"`tabSales Order Item`.warehouse as warehouse",
		"`tabSales Order Item`.rate as rate",
		f"{tag_expr} as tag_no",
		f"{parts['soi_tag']} as custom_tag_no",
		f"{parts['soi_sub']} as custom_sub_tag_no",
		f"{parts['prod_tag_expr']} as production_tag_no",
		_sql_col("Sales Order Item", "custom_dimension", "dimension"),
		_sql_col("Sales Order Item", "custom_mill", "mill"),
		_sql_col("Sales Order Item", "custom_location", "location"),
		_sql_col("Sales Order Item", "custom_js_number", "js_number"),
		_sql_col("Sales Order Item", "custom_thickness", "thickness"),
		_sql_col("Sales Order Item", "custom_width", "width"),
	]

	where = [
		"`tabSales Order`.docstatus = 1",
		"`tabSales Order`.status not in ('Closed', 'Completed', 'Cancelled')",
		"ifnull(`tabSales Order Item`.delivered_by_supplier, 0) = 0",
		"(abs(ifnull(`tabSales Order Item`.qty, 0)) - abs(ifnull(`tabSales Order Item`.delivered_qty, 0))) > 0",
		f"not ({_is_process_charge_sql()})",
	]
	params = {}

	if filters.get("sales_order"):
		where.append("`tabSales Order`.name = %(sales_order)s")
		params["sales_order"] = filters["sales_order"]
	if filters.get("customer"):
		where.append("`tabSales Order`.customer = %(customer)s")
		params["customer"] = filters["customer"]
	if filters.get("company"):
		where.append("`tabSales Order`.company = %(company)s")
		params["company"] = filters["company"]
	if filters.get("tagged_only"):
		where.append(f"{tag_expr} is not null")

	rows = frappe.db.sql(
		f"""
		select
			{", ".join(select_cols)}
		from `tabSales Order Item`
		inner join `tabSales Order`
			on `tabSales Order`.name = `tabSales Order Item`.parent
		{parts["prod_join"]}
		where {" and ".join(where)}
		group by `tabSales Order Item`.name
		order by
			case when {tag_expr} is null then 1 else 0 end,
			{tag_expr},
			`tabSales Order`.transaction_date desc,
			`tabSales Order`.name,
			`tabSales Order Item`.idx
		""",
		params,
		as_dict=True,
	)

	out = []
	for row in rows:
		pending = max(flt(row.qty) - flt(row.delivered_qty), 0)
		if pending <= 0:
			continue
		tag_no = (
			(row.get("custom_tag_no") or "").strip()
			or (row.get("tag_no") or "").strip()
			or (row.get("production_tag_no") or "").strip()
			or ""
		)
		out.append(
			{
				"sales_order": row.sales_order,
				"customer": row.customer,
				"customer_name": row.customer_name,
				"company": row.company,
				"transaction_date": str(row.transaction_date) if row.transaction_date else "",
				"so_detail": row.so_detail,
				"idx": row.idx,
				"item_code": row.item_code,
				"item_name": row.item_name,
				"tag_no": tag_no,
				"custom_tag_no": (row.get("custom_tag_no") or "").strip(),
				"custom_sub_tag_no": (row.get("custom_sub_tag_no") or "").strip(),
				"qty": flt(row.qty),
				"delivered_qty": flt(row.delivered_qty),
				"pending_qty": pending,
				"uom": row.uom,
				"warehouse": row.warehouse,
				"dimension": row.get("dimension") or "",
				"mill": row.get("mill") or "",
				"location": row.get("location") or "",
				"js_number": row.get("js_number") or "",
				"thickness": row.get("thickness") or "",
				"width": row.get("width") or "",
				"rate": flt(row.rate),
			}
		)
	return _expand_pending_ss_coil_outputs(out, filters)


def _expand_pending_ss_coil_outputs(sales_order_rows, filters):
	"""Show each undelivered SS Coil output as its own selectable SO row."""
	if not frappe.db.table_exists("Coil Output") or not frappe.db.table_exists("SS Coil"):
		return sales_order_rows

	where = [
		"so.docstatus = 1",
		"so.status not in ('Closed', 'Completed', 'Cancelled')",
		"ifnull(soi.delivered_by_supplier, 0) = 0",
		"(abs(ifnull(soi.qty, 0)) - abs(ifnull(soi.delivered_qty, 0))) > 0",
		"ifnull(trim(co.tag_no), '') != ''",
		"ifnull(reg.status, '') not in ('Delivered', 'Invoiced', 'Cancelled')",
		"ifnull(reg.current_doctype, '') != 'Delivery Note'",
	]
	params = {}
	if filters.get("sales_order"):
		where.append("so.name = %(sales_order)s")
		params["sales_order"] = filters["sales_order"]
	if filters.get("customer"):
		where.append("so.customer = %(customer)s")
		params["customer"] = filters["customer"]
	if filters.get("company"):
		where.append("so.company = %(company)s")
		params["company"] = filters["company"]

	outputs = frappe.db.sql(
		f"""
		select
			so.name as sales_order, so.customer, so.customer_name, so.company,
			so.transaction_date, soi.name as so_detail, soi.idx,
			soi.item_code, soi.item_name, soi.qty as order_qty,
			soi.delivered_qty, soi.uom, soi.warehouse, soi.rate,
			co.tag_no as output_tag_no,
			co.actual_wt, co.estimated_wt, co.idx as output_idx, sc.name as ss_coil
		from `tabSS Coil` sc
		inner join `tabSales Order` so on so.name = sc.order_no
		inner join `tabSales Order Item` soi on soi.name = sc.sales_order_item
		inner join `tabCoil Output` co on co.parent = sc.name and co.parentfield = 'job_output'
		left join `tabTag Registry` reg on reg.tag_no = co.tag_no
		where {' and '.join(where)}
		order by so.transaction_date desc, so.name, soi.idx, co.idx
		""",
		params,
		as_dict=True,
	)
	outputs = [
		output
		for output in outputs
		if flt(output.actual_wt) > 0 or flt(output.estimated_wt) > 0
	]
	if not outputs:
		return sales_order_rows

	output_details = {row.so_detail for row in outputs}
	rows = [row for row in sales_order_rows if row.get("so_detail") not in output_details]
	for output in outputs:
		weight = flt(output.actual_wt) or flt(output.estimated_wt)
		selection_key = f"{output.so_detail}|{output.output_tag_no}"
		rows.append(
			{
				"sales_order": output.sales_order,
				"customer": output.customer,
				"customer_name": output.customer_name,
				"company": output.company,
				"transaction_date": str(output.transaction_date) if output.transaction_date else "",
				"so_detail": output.so_detail,
				"selection_key": selection_key,
				"output_tag_no": output.output_tag_no,
				"ss_coil": output.ss_coil,
				"idx": output.idx,
				"item_code": output.item_code,
				"item_name": output.item_name,
				"tag_no": output.output_tag_no,
				"custom_tag_no": output.output_tag_no,
				"custom_sub_tag_no": "",
				"qty": weight,
				"delivered_qty": 0,
				"pending_qty": weight,
				"uom": output.uom,
				"warehouse": output.warehouse,
				"dimension": "",
				"mill": "",
				"location": "",
				"js_number": "",
				"thickness": "",
				"width": "",
				"rate": flt(output.rate),
			}
		)
	return rows


@frappe.whitelist()
def get_sales_order_delivery_tag_rows(sales_order: str):
	"""Undelivered SO item rows for one Sales Order (used from SO form / Flow)."""
	if not sales_order:
		frappe.throw(_("Sales Order is required"))
	so = frappe.get_doc("Sales Order", sales_order)
	if so.docstatus != 1:
		frappe.throw(_("Sales Order {0} must be submitted").format(so.name))
	rows = _fetch_delivery_tag_rows({"sales_order": sales_order})
	return {
		"sales_order": so.name,
		"customer": so.customer,
		"customer_name": so.customer_name,
		"company": so.company,
		"rows": rows,
	}


@frappe.whitelist()
def get_customer_delivery_tag_rows(customer: str, company: str | None = None, tagged_only: int = 1):
	"""Undelivered SO item rows for a Customer — primary Delivery Note picker source."""
	if not customer:
		frappe.throw(_("Customer is required"))
	if not frappe.db.exists("Customer", customer):
		frappe.throw(_("Customer {0} not found").format(customer))

	filters = {"customer": customer, "tagged_only": cint(tagged_only)}
	if company:
		filters["company"] = company

	rows = _fetch_delivery_tag_rows(filters)
	# If tagged_only found nothing, retry with all pending rows so user still sees items
	if not rows and cint(tagged_only):
		filters["tagged_only"] = 0
		rows = _fetch_delivery_tag_rows(filters)

	customer_name = frappe.db.get_value("Customer", customer, "customer_name") or customer
	return {
		"customer": customer,
		"customer_name": customer_name,
		"company": company,
		"rows": rows,
	}


def _resolve_target_delivery_note(target_doc, customer=None, company=None):
	"""Build an in-memory Delivery Note target without requiring a saved draft."""
	if not target_doc:
		dn = frappe.new_doc("Delivery Note")
		if customer:
			dn.customer = customer
		if company:
			dn.company = company
		return dn

	if isinstance(target_doc, str):
		if frappe.db.exists("Delivery Note", target_doc):
			return frappe.get_doc("Delivery Note", target_doc)
		parsed = frappe.parse_json(target_doc)
		if isinstance(parsed, dict) and parsed.get("doctype") == "Delivery Note":
			target_doc = parsed
		else:
			frappe.throw(_("Invalid Delivery Note target"))

	if isinstance(target_doc, dict) and target_doc.get("doctype") == "Delivery Note":
		name = target_doc.get("name")
		is_local = cint(target_doc.get("__islocal")) or not name or str(name).startswith("new-")
		if not is_local and name and frappe.db.exists("Delivery Note", name):
			return frappe.get_doc("Delivery Note", name)
		# Unsaved / local DN: build from client values without saving
		dn = frappe.new_doc("Delivery Note")
		skip = {
			"name",
			"owner",
			"creation",
			"modified",
			"modified_by",
			"docstatus",
			"idx",
			"amenities",
			"__islocal",
			"__unsaved",
		}
		for key, value in target_doc.items():
			if key in skip or key.startswith("__"):
				continue
			if isinstance(value, list):
				continue
			if hasattr(dn, key):
				dn.set(key, value)
		if customer and not dn.customer:
			dn.customer = customer
		if company and not dn.company:
			dn.company = company
		# Keep existing client items only if caller wants append; default replace handled below
		return dn

	frappe.throw(_("Invalid Delivery Note target"))


@frappe.whitelist()
def load_delivery_note_items_by_tags(
	so_detail_names=None,
	output_tags=None,
	customer: str | None = None,
	company: str | None = None,
	target_doc=None,
	replace_items: int = 1,
):
	"""Map selected SO item rows into a Delivery Note (saved or unsaved). Never auto-saves new DNs."""
	from erpnext.selling.doctype.sales_order.sales_order import make_delivery_note

	selected = _parse_name_list(so_detail_names)
	if isinstance(output_tags, str):
		output_tags = frappe.parse_json(output_tags)
	output_tags = output_tags if isinstance(output_tags, (list, tuple)) else []
	output_tags = [
		{"so_detail": str(row.get("so_detail") or "").strip(), "tag_no": str(row.get("tag_no") or "").strip()}
		for row in output_tags
		if isinstance(row, dict) and row.get("so_detail") and row.get("tag_no")
	]
	if not selected:
		frappe.throw(_("Select at least one Tag / item row"))

	# Resolve selected rows + owning sales orders
	placeholders = ", ".join(["%s"] * len(selected))
	meta_rows = frappe.db.sql(
		f"""
		select
			soi.name as so_detail,
			soi.parent as sales_order,
			soi.custom_tag_no as custom_tag_no,
			so.customer as customer,
			so.company as company
		from `tabSales Order Item` soi
		inner join `tabSales Order` so on so.name = soi.parent
		where soi.name in ({placeholders})
			and so.docstatus = 1
		""",
		tuple(selected),
		as_dict=True,
	)
	if not meta_rows:
		frappe.throw(_("No deliverable Sales Order items selected"))

	if not customer:
		customer = meta_rows[0].customer
	if not company:
		company = meta_rows[0].company

	# All selected rows must belong to the same customer
	customers = {row.customer for row in meta_rows}
	if len(customers) > 1:
		frappe.throw(_("Selected tags belong to more than one Customer"))

	eligible_outputs = {}
	if output_tags:
		eligible_rows = _expand_pending_ss_coil_outputs(
			[], {"customer": customer or meta_rows[0].customer, "company": company or meta_rows[0].company}
		)
		eligible_outputs = {
			(row["so_detail"], row["output_tag_no"]): row
			for row in eligible_rows
			if row.get("output_tag_no")
		}
		invalid = [
			selection
			for selection in output_tags
			if (selection["so_detail"], selection["tag_no"]) not in eligible_outputs
		]
		if invalid:
			frappe.throw(_("One or more selected SS Coil output tags are no longer pending delivery"))

	by_so = {}
	tag_by_detail = {}
	for row in meta_rows:
		by_so.setdefault(row.sales_order, []).append(row.so_detail)
		tag_by_detail[row.so_detail] = (row.custom_tag_no or "").strip()

	target = _resolve_target_delivery_note(target_doc, customer=customer, company=company)
	if cint(replace_items):
		target.set("items", [])
	existing_dn_item_names = {row.name for row in target.items or []}

	for sales_order, details in by_so.items():
		target = make_delivery_note(
			sales_order,
			target_doc=target,
			kwargs={"filtered_children": details},
		)

	if output_tags:
		output_by_detail = {}
		for selection in output_tags:
			output = eligible_outputs[(selection["so_detail"], selection["tag_no"])]
			output_by_detail.setdefault(selection["so_detail"], []).append(output)
		so_rows_by_name = {row.name: row for row in meta_rows}
		mapped_by_detail = {}
		for row in target.items or []:
			if row.name not in existing_dn_item_names and row.get("so_detail"):
				mapped_by_detail.setdefault(row.so_detail, []).append(row)
		for so_detail, outputs_for_detail in output_by_detail.items():
			mapped_rows = mapped_by_detail.get(so_detail) or []
			if not mapped_rows:
				frappe.throw(_("Could not map selected output tag to Delivery Note item {0}").format(so_detail))
			base = mapped_rows[0]
			so_row = so_rows_by_name.get(so_detail)
			pending_so_qty = max(flt(so_row.qty) - flt(so_row.delivered_qty), 0) if so_row else 0
			total_output_qty = sum(flt(output.get("pending_qty")) for output in outputs_for_detail)
			if pending_so_qty and total_output_qty > pending_so_qty + 0.000001:
				frappe.throw(_("Selected output tag weights exceed the pending Sales Order quantity"))
			base_values = base.as_dict()
			for fieldname in (
				"name", "idx", "owner", "creation", "modified", "modified_by", "parent", "parenttype", "parentfield"
			):
				base_values.pop(fieldname, None)
			target.remove(base)
			for output in outputs_for_detail:
				item = target.append("items", dict(base_values))
				weight = flt(output.get("pending_qty"))
				item.qty = weight
				item.custom_tag_no = output["output_tag_no"]
				conversion = flt(item.get("conversion_factor")) or 1
				item.stock_qty = weight * conversion
				item.amount = weight * flt(item.get("rate"))
				item.net_amount = weight * flt(item.get("net_rate") or item.get("rate"))
				item.base_amount = weight * flt(item.get("base_rate") or item.get("rate"))
				item.base_net_amount = weight * flt(item.get("base_net_rate") or item.get("base_rate") or item.get("rate"))

	if not target.items:
		frappe.throw(_("No Delivery Note items were created for the selected tags"))

	if customer and not target.customer:
		target.customer = customer
	if company and not target.company:
		target.company = company
	if _has_field("Delivery Note", "custom_sales_order") and len(by_so) == 1:
		target.custom_sales_order = next(iter(by_so.keys()))

	if _has_field("Delivery Note Item", "custom_tag_no"):
		for dn_item in target.items:
			so_detail = dn_item.get("so_detail")
			if so_detail and not dn_item.get("custom_tag_no") and tag_by_detail.get(so_detail):
				dn_item.custom_tag_no = tag_by_detail[so_detail]

	# Only save when appending to an already-persisted draft
	if target_doc and not target.is_new() and frappe.db.exists("Delivery Note", target.name):
		target.save()

	return target.as_dict()


@frappe.whitelist()
def make_delivery_note_by_tags(sales_order: str, so_detail_names=None, target_doc=None):
	"""Back-compat wrapper used by Sales Order / Flow create buttons."""
	if not sales_order:
		frappe.throw(_("Sales Order is required"))
	so = frappe.get_doc("Sales Order", sales_order)
	return load_delivery_note_items_by_tags(
		so_detail_names=so_detail_names,
		customer=so.customer,
		company=so.company,
		target_doc=target_doc,
		replace_items=0 if target_doc else 1,
	)
