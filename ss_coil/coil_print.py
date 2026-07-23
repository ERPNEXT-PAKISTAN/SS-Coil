"""Coil detail print reports for Stock Entry, Sales Order, and SS Coil.

Builds a full document context (header fields, child-table rows, tag parent/child
hierarchy) and renders landscape HTML for the Coil Detail print formats.
"""

from html import escape

import frappe
from frappe.utils import cint, flt

from ss_coil.api import _build_tag_hierarchy, get_ss_coil_detail_dashboard

SKIP_FIELDTYPES = frozenset(
	{
		"Section Break",
		"Column Break",
		"Tab Break",
		"HTML",
		"Button",
		"Fold",
		"Heading",
		"Table MultiSelect",
		"Attach",
		"Attach Image",
		"Barcode",
		"Geolocation",
		"Signature",
		"Color",
		"Image",
		"Icon",
	}
)

DETAIL_PRINT_FORMATS = {
	"Sales Order": "Sales Order Coil Detail",
	"SS Coil": "SS Coil Detail",
}


def get_detail_print_format(doctype):
	return DETAIL_PRINT_FORMATS.get(doctype)


def _ensure_print_doc(doc):
	if isinstance(doc, str):
		frappe.throw("Document reference must include doctype")

	doctype = getattr(doc, "doctype", None)
	name = getattr(doc, "name", None)
	if isinstance(doc, dict):
		doctype = doctype or doc.get("doctype")
		name = name or doc.get("name")

	if doctype and name and frappe.db.exists(doctype, name):
		return frappe.get_doc(doctype, name)
	if getattr(doc, "doctype", None):
		return doc
	frappe.throw("Unable to resolve document for printing")


def _normalize_row_dict(row):
	if row is None:
		return {}
	if isinstance(row, dict):
		return row
	as_dict = getattr(row, "as_dict", None)
	if callable(as_dict):
		return as_dict()
	if hasattr(row, "items"):
		try:
			return frappe._dict(row)
		except TypeError:
			pass
	return {}


def build_coil_detail_print_html(doc):
	doc = _ensure_print_doc(doc)
	if doc.doctype == "Stock Entry":
		context = build_stock_entry_detail_context(doc)
	elif doc.doctype == "Sales Order":
		context = build_sales_order_detail_context(doc)
	elif doc.doctype == "SS Coil":
		context = build_ss_coil_detail_context(doc)
	else:
		return ""

	return render_coil_detail_html(context)


def build_stock_entry_detail_context(doc):
	header_fields = get_printable_fields("Stock Entry")
	item_fields = get_printable_fields("Stock Entry Detail")
	items = []

	for idx, row in enumerate(doc.items or [], 1):
		root_tag = row.get("custom_tag_no")
		tag_hierarchy = _tag_hierarchy_rows(root_tag)
		items.append(
			{
				"idx": idx,
				"name": row.name,
				"tag_no": root_tag,
				"columns": get_row_column_values(row, item_fields),
				"tag_hierarchy": tag_hierarchy,
			}
		)

	return {
		"doctype": doc.doctype,
		"title": "Stock Entry Detail Report",
		"name": doc.name,
		"subtitle": f"{doc.purpose or '-'} | {doc.stock_entry_type or '-'} | {doc.posting_date or '-'}",
		"header_columns": get_row_column_values(doc, header_fields),
		"sections": [{"title": "Items", "columns": item_fields, "rows": items}],
	}


def build_sales_order_detail_context(doc):
	header_fields = get_printable_fields("Sales Order")
	item_fields = get_printable_fields("Sales Order Item")
	items = []

	for idx, row in enumerate(doc.items or [], 1):
		root_tag = row.get("custom_raw_material_tag_no") or row.get("custom_tag_no")
		tag_hierarchy = _tag_hierarchy_rows(root_tag)
		if row.get("custom_child_tag_no"):
			child_rows = _tag_hierarchy_rows(row.get("custom_child_tag_no"))
			existing = {entry.get("tag_no") for entry in tag_hierarchy}
			for child_row in child_rows:
				if child_row.get("tag_no") not in existing:
					tag_hierarchy.append(child_row)
		items.append(
			{
				"idx": idx,
				"name": row.name,
				"tag_no": root_tag,
				"columns": get_row_column_values(row, item_fields),
				"tag_hierarchy": tag_hierarchy,
			}
		)

	return {
		"doctype": doc.doctype,
		"title": "Sales Order Detail Report",
		"name": doc.name,
		"subtitle": f"{doc.customer_name or doc.customer or '-'} | {doc.transaction_date or '-'} | {doc.status or '-'}",
		"header_columns": get_row_column_values(doc, header_fields),
		"sections": [{"title": "Items", "columns": item_fields, "rows": items}],
	}


def build_ss_coil_detail_context(doc):
	dashboard = get_ss_coil_detail_dashboard(doc.name)
	header_fields = get_printable_fields("SS Coil")
	child_sections = [
		("Sales Order Item", "Coil SO", doc.so_item or []),
		("Cutting Detail", "Cutting Scheme", doc.cutting_detail or []),
		("Input Coil", "Coil Input", doc.input_coil or []),
		("Job Output", "Coil Output", doc.job_output or []),
	]

	sections = []
	for title, child_doctype, rows in child_sections:
		columns = get_printable_fields(child_doctype)
		section_rows = []
		for idx, row in enumerate(rows, 1):
			row_doc = _normalize_row_dict(row)
			root_tag = row_doc.get("tag_no") or row_doc.get("custom_tag_no")
			section_rows.append(
				{
					"idx": idx,
					"name": row_doc.get("name"),
					"tag_no": root_tag,
					"columns": get_row_column_values(row_doc, columns),
					"tag_hierarchy": _tag_hierarchy_rows(root_tag),
				}
			)
		sections.append({"title": title, "columns": columns, "rows": section_rows})

	root_tag = dashboard.get("tag_hierarchy", {}).get("tag_no") if dashboard.get("tag_hierarchy") else ""
	if not root_tag:
		input_tags = dashboard.get("input_tags") or []
		root_tag = input_tags[0] if input_tags else ""

	return {
		"doctype": doc.doctype,
		"title": "SS Coil Detail Report",
		"name": doc.name,
		"subtitle": (
			f"{doc.operation or '-'} | {doc.order_status or '-'} | "
			f"{doc.order_no or '-'} | {doc.customer_name or '-'}"
		),
		"header_columns": get_row_column_values(doc, header_fields),
		"sections": sections,
		"dashboard": dashboard,
		"root_tag_hierarchy": flatten_tag_hierarchy(dashboard.get("tag_hierarchy") or {}),
	}


def get_printable_fields(doctype):
	meta = frappe.get_meta(doctype)
	fields = []
	for df in meta.fields:
		if df.fieldtype in SKIP_FIELDTYPES:
			continue
		if df.fieldtype == "Table":
			continue
		if cint(df.hidden):
			continue
		if not df.fieldname:
			continue
		fields.append(
			{
				"label": df.label or df.fieldname,
				"fieldname": df.fieldname,
				"fieldtype": df.fieldtype,
				"options": df.options,
			}
		)
	return fields


def get_row_column_values(row, fields):
	values = []
	row_data = _normalize_row_dict(row)
	for field in fields:
		raw = row_data.get(field["fieldname"])
		values.append(
			{
				"label": field["label"],
				"fieldname": field["fieldname"],
				"value": format_print_value(raw, field["fieldtype"]),
			}
		)
	return values


def format_print_value(value, fieldtype):
	if value in (None, ""):
		return "-"
	if fieldtype == "Check":
		return "Yes" if cint(value) else "No"
	if fieldtype in ("Date", "Datetime", "Currency", "Float", "Int", "Percent"):
		return str(frappe.format(value, {"fieldtype": fieldtype}))
	return str(value)


def _text(value, default="-"):
	if value in (None, ""):
		return default
	return str(value)


def _esc(value, default="-"):
	return escape(_text(value, default))


def _tag_hierarchy_rows(root_tag_no):
	return flatten_tag_hierarchy(_build_tag_hierarchy(root_tag_no) if root_tag_no else {})


def flatten_tag_hierarchy(node, rows=None, depth=0):
	if rows is None:
		rows = []
	if not node:
		return rows

	rows.append(
		{
			"depth": depth,
			"tag_no": node.get("tag_no") or "-",
			"status": node.get("status") or "-",
			"parent_tag_no": node.get("parent_tag_no") or "-",
			"item_code": node.get("item_code") or "-",
			"item_name": node.get("item_name") or "-",
			"source": f"{node.get('source_doctype') or '-'} / {node.get('source_docname') or '-'}",
			"current": f"{node.get('current_doctype') or '-'} / {node.get('current_docname') or '-'}",
			"child_count": cint(node.get("child_count")),
		}
	)
	for child in node.get("children") or []:
		flatten_tag_hierarchy(child, rows, depth + 1)
	return rows


def render_coil_detail_html(context):
	parts = [
		_render_styles(),
		'<div class="coil-detail-print">',
		_render_header(context),
		_render_header_grid(context.get("header_columns") or []),
	]

	for section in context.get("sections") or []:
		parts.append(_render_section(section))

	if context.get("dashboard"):
		parts.append(_render_ss_coil_dashboard(context["dashboard"]))

	if context.get("root_tag_hierarchy"):
		parts.append(_render_tag_block("Complete Tag Hierarchy", context["root_tag_hierarchy"]))

	parts.append(
		f'<div class="footer-note">Generated on {escape(frappe.utils.now_datetime().strftime("%Y-%m-%d %H:%M"))}</div>'
	)
	parts.append("</div>")
	return "".join(parts)


def _render_styles():
	return """
<style>
	@page { size: A4 landscape; margin: 6mm; }
	.print-format {
		orientation: Landscape;
		page-size: A4;
		margin: 6mm;
		font-family: Inter, Arial, sans-serif;
		font-size: 9px;
		color: #0f172a;
	}
	.coil-detail-print { width: 100%; }
	.coil-detail-print .hero {
		background: linear-gradient(135deg, #16324f 0%, #1f56d2 100%);
		color: #fff;
		border-radius: 12px;
		padding: 16px 18px;
		margin-bottom: 12px;
	}
	.coil-detail-print .hero-title { font-size: 11px; text-transform: uppercase; letter-spacing: .08em; opacity: .85; }
	.coil-detail-print .hero-name { font-size: 22px; font-weight: 800; margin-top: 4px; }
	.coil-detail-print .hero-sub { font-size: 10px; margin-top: 6px; opacity: .92; }
	.coil-detail-print .section-title {
		font-size: 11px;
		font-weight: 700;
		margin: 12px 0 4px;
		color: #16324f;
	}
	.coil-detail-print table.grid,
	.coil-detail-print table.data,
	.coil-detail-print table.tag-table {
		width: 100%;
		border-collapse: collapse;
		margin-bottom: 10px;
	}
	.coil-detail-print table.grid td {
		border: 1px solid #dbe5f1;
		padding: 4px 6px;
		vertical-align: top;
		width: 25%;
	}
	.coil-detail-print table.grid .label {
		font-size: 7px;
		text-transform: uppercase;
		color: #64748b;
		letter-spacing: .04em;
	}
	.coil-detail-print table.grid .value {
		font-size: 8px;
		font-weight: 600;
		margin-top: 2px;
		word-break: break-word;
	}
	.coil-detail-print table.data th,
	.coil-detail-print table.data td,
	.coil-detail-print table.tag-table th,
	.coil-detail-print table.tag-table td {
		border: 1px solid #cbd5e1;
		padding: 2px 4px;
		font-size: 6.5px;
		line-height: 1.15;
		vertical-align: top;
	}
	.coil-detail-print table.data th,
	.coil-detail-print table.tag-table th {
		background: #eef4fb;
		font-weight: 700;
	}
	.coil-detail-print .row-block {
		border: 1px solid #dbe5f1;
		border-radius: 8px;
		padding: 8px;
		margin-bottom: 10px;
		background: #fafcff;
	}
	.coil-detail-print .row-block-title {
		font-size: 9px;
		font-weight: 700;
		margin-bottom: 6px;
	}
	.coil-detail-print .indent-tag { padding-left: 12px; }
	.coil-detail-print .summary-grid td { width: 20%; }
	.coil-detail-print .footer-note {
		margin-top: 12px;
		font-size: 7px;
		color: #64748b;
		text-align: right;
	}
</style>
"""


def _render_header(context):
	return (
		f'<div class="hero">'
		f'<div class="hero-title">{escape(context.get("title") or "Coil Detail Report")}</div>'
		f'<div class="hero-name">{escape(context.get("name") or "-")}</div>'
		f'<div class="hero-sub">{escape(context.get("subtitle") or "-")}</div>'
		f"</div>"
	)


def _render_header_grid(columns):
	if not columns:
		return ""
	rows = []
	for index in range(0, len(columns), 4):
		chunk = columns[index : index + 4]
		cells = []
		for col in chunk:
			cells.append(
				f'<td><div class="label">{_esc(col["label"])}</div>'
				f'<div class="value">{_esc(col["value"])}</div></td>'
			)
		while len(cells) < 4:
			cells.append("<td></td>")
		rows.append(f"<tr>{''.join(cells)}</tr>")
	return f'<div class="section-title">Document Details</div><table class="grid">{"".join(rows)}</table>'


def _render_section(section):
	title = section.get("title") or "Section"
	columns = section.get("columns") or []
	rows = section.get("rows") or []
	if not rows:
		return f'<div class="section-title">{escape(title)}</div><div>No rows.</div>'

	parts = [f'<div class="section-title">{escape(title)}</div>']
	for row in rows:
		parts.append(
			f'<div class="row-block">'
			f'<div class="row-block-title">Row {row.get("idx")}'
			f'{f" | Tag: {escape(row.get('tag_no'))}" if row.get("tag_no") else ""}'
			f"</div>"
		)
		parts.append(_render_data_table(columns, row.get("columns") or []))
		if row.get("tag_hierarchy"):
			parts.append(_render_tag_block("Tag Parent / Child", row["tag_hierarchy"]))
		parts.append("</div>")
	return "".join(parts)


def _render_data_table(columns, values):
	if not columns:
		return ""
	value_map = {item["fieldname"]: item["value"] for item in values}
	header = "".join(f"<th>{_esc(col['label'], '')}</th>" for col in columns)
	cells = "".join(f"<td>{_esc(value_map.get(col['fieldname'], '-'))}</td>" for col in columns)
	return f'<table class="data"><thead><tr>{header}</tr></thead><tbody><tr>{cells}</tr></tbody></table>'


def _render_tag_block(title, rows):
	if not rows:
		return ""
	body = []
	for row in rows:
		indent = 8 + (cint(row.get("depth")) * 10)
		body.append(
			"<tr>"
			f'<td style="padding-left:{indent}px;">{escape(row.get("tag_no") or "-")}</td>'
			f"<td>{escape(row.get('status') or '-')}</td>"
			f"<td>{escape(row.get('parent_tag_no') or '-')}</td>"
			f"<td>{escape(row.get('item_code') or '-')}"
			f"{('<br><span style=\"color:#64748b;\">' + escape(row.get('item_name') or '') + '</span>') if row.get('item_name') and row.get('item_name') != '-' else ''}"
			f"</td>"
			f"<td>{escape(row.get('source') or '-')}</td>"
			f"<td>{escape(row.get('current') or '-')}</td>"
			f"<td>{escape(str(row.get('child_count') or 0))}</td>"
			"</tr>"
		)
	return (
		f'<div class="section-title">{escape(title)}</div>'
		'<table class="tag-table"><thead><tr>'
		"<th>Tag No</th><th>Status</th><th>Parent</th><th>Item</th>"
		"<th>Source</th><th>Current</th><th>Children</th>"
		f"</tr></thead><tbody>{''.join(body)}</tbody></table>"
	)


def _render_ss_coil_dashboard(dashboard):
	summary = dashboard.get("summary") or {}
	status_flow = dashboard.get("status_flow") or {}
	checklist = dashboard.get("process_checklist") or []

	summary_cells = [
		("Input Rows", summary.get("input_count")),
		("Output Rows", summary.get("output_count")),
		("Cutting Rows", summary.get("cutting_count")),
		("Total Strips", summary.get("total_strips")),
		("Grand Width", summary.get("grand_total_width")),
		("Grand Est WT", summary.get("grand_estimated_wt")),
		("Output WT", summary.get("output_weight_total")),
		("Output Qty", summary.get("output_qty_total")),
		("Calc Ratio", summary.get("calc_ratio")),
		("Actual Ratio", summary.get("actual_ratio")),
		("Remaining Width", summary.get("remaining_width")),
	]
	summary_html = "".join(
		f"<td><div class='label'>{escape(str(label))}</div><div class='value'>{escape(str(value if value not in (None, '') else '-'))}</div></td>"
		for label, value in summary_cells
	)

	flow_html = (
		f"<tr><td><div class='label'>Operation</div><div class='value'>{escape(status_flow.get('operation') or '-')}</div></td>"
		f"<td><div class='label'>Order Status</div><div class='value'>{escape(status_flow.get('order_status') or '-')}</div></td>"
		f"<td><div class='label'>Current Process</div><div class='value'>{escape(status_flow.get('current_process') or '-')}</div></td>"
		f"<td><div class='label'>Next Process</div><div class='value'>{escape(status_flow.get('next_process') or '-')}</div></td></tr>"
	)

	checklist_rows = []
	for item in checklist:
		checklist_rows.append(
			"<tr>"
			f"<td>{escape(item.get('label') or '-')}</td>"
			f"<td>{escape(item.get('status') or '-')}</td>"
			f"<td>{escape(item.get('ss_coil') or '-')}</td>"
			f"<td>{escape(item.get('order_status') or '-')}</td>"
			"</tr>"
		)
	checklist_html = ""
	if checklist_rows:
		checklist_html = (
			'<div class="section-title">Process Checklist</div>'
			'<table class="data"><thead><tr><th>Process</th><th>Status</th><th>SS Coil</th><th>Order Status</th></tr></thead>'
			f"<tbody>{''.join(checklist_rows)}</tbody></table>"
		)

	linked_rows = []
	for row in dashboard.get("stock_entry_details") or []:
		linked_rows.append(
			"<tr>"
			f"<td>Stock Entry</td>"
			f"<td>{escape(str(row.get('stock_entry') or '-'))}</td>"
			f"<td>{escape(str(row.get('posting_date') or '-'))}</td>"
			f"<td>{escape(str(row.get('purpose') or '-'))}</td>"
			f"<td>{escape(str(row.get('item_code') or '-'))}</td>"
			f"<td>{escape(str(row.get('tag_no') or '-'))}</td>"
			"</tr>"
		)
	for row in dashboard.get("delivery_details") or []:
		linked_rows.append(
			"<tr>"
			f"<td>Delivery Note</td>"
			f"<td>{escape(str(row.get('delivery_note') or '-'))}</td>"
			f"<td>{escape(str(row.get('posting_date') or '-'))}</td>"
			f"<td>{escape(str(row.get('status') or '-'))}</td>"
			f"<td>{escape(str(row.get('item_code') or '-'))}</td>"
			f"<td>{escape(str(row.get('tag_no') or '-'))}</td>"
			"</tr>"
		)
	for row in dashboard.get("invoice_details") or []:
		linked_rows.append(
			"<tr>"
			f"<td>Sales Invoice</td>"
			f"<td>{escape(str(row.get('sales_invoice') or '-'))}</td>"
			f"<td>{escape(str(row.get('posting_date') or '-'))}</td>"
			f"<td>{escape(str(row.get('status') or '-'))}</td>"
			f"<td>{escape(str(row.get('item_code') or '-'))}</td>"
			f"<td>{escape(str(row.get('tag_no') or '-'))}</td>"
			"</tr>"
		)

	linked_html = ""
	if linked_rows:
		linked_html = (
			'<div class="section-title">Linked Documents</div>'
			'<table class="data"><thead><tr><th>Type</th><th>Name</th><th>Date</th><th>Status</th><th>Item</th><th>Tag</th></tr></thead>'
		 f"<tbody>{''.join(linked_rows)}</tbody></table>"
		)

	return (
		'<div class="section-title">Detail Tab Summary</div>'
		f'<table class="grid summary-grid"><tr>{summary_html}</tr>{flow_html}</table>'
		f"{checklist_html}{linked_html}"
	)
