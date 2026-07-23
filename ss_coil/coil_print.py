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

SS_COIL_PRINT_HEADER_FIELDS = [
	"operation",
	"order_status",
	"order_no",
	"customer_name",
	"for_customer",
	"order_received_date",
	"started_on",
	"completed_on",
	"machine",
	"calc_ratio",
	"actual_ratio",
	"stock_entry",
	"job_sheet_no",
]

SS_COIL_PRINT_SECTION_FIELDS = {
	"Coil SO": [
		"tag_no",
		"ref_no",
		"so_number",
		"thickness",
		"width",
		"length",
		"qty",
		"estimated_wt",
		"specification",
		"mill",
		"condition",
		"remarks",
	],
	"Cutting Scheme": [
		"seq",
		"width",
		"strip",
		"lengthcut",
		"total_width",
		"tolerance_plus",
		"tolerance_minus",
		"knife",
		"so_no",
	],
	"Coil Input": [
		"tag_no",
		"class",
		"dimension",
		"length",
		"estimated_qty",
		"estimated_wt",
		"actual_qty",
		"actual_wt",
		"location",
		"next_process",
	],
	"Coil Output": [
		"tag_no",
		"customer",
		"thickness",
		"width",
		"length",
		"estimated_qty",
		"actual_qty",
		"estimated_wt",
		"actual_wt",
		"packing",
		"next_process",
	],
}

SS_COIL_COMPACT_FIELDTYPES = frozenset({"Int", "Float", "Currency", "Percent", "Date", "Datetime"})


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
	if doc.doctype == "SS Coil":
		context = build_ss_coil_detail_context(doc)
		return render_ss_coil_detail_html(context)
	if doc.doctype == "Stock Entry":
		context = build_stock_entry_detail_context(doc)
	elif doc.doctype == "Sales Order":
		context = build_sales_order_detail_context(doc)
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
	header_fields = _filter_print_fields(
		get_printable_fields("SS Coil"),
		SS_COIL_PRINT_HEADER_FIELDS,
	)
	child_sections = [
		("Sales Order Item", "Coil SO", doc.so_item or []),
		("Cutting Detail", "Cutting Scheme", doc.cutting_detail or []),
		("Input Coil", "Coil Input", doc.input_coil or []),
		("Job Output", "Coil Output", doc.job_output or []),
	]

	sections = []
	for title, child_doctype, rows in child_sections:
		columns = _filter_print_fields(
			get_printable_fields(child_doctype),
			SS_COIL_PRINT_SECTION_FIELDS.get(child_doctype),
		)
		section_rows = []
		for idx, row in enumerate(rows, 1):
			row_doc = _normalize_row_dict(row)
			section_rows.append(
				{
					"idx": idx,
					"name": row_doc.get("name"),
					"columns": get_row_column_values(row_doc, columns),
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


def _filter_print_fields(fields, allowed_fieldnames):
	if not allowed_fieldnames:
		return fields
	order = {name: idx for idx, name in enumerate(allowed_fieldnames)}
	return sorted(
		[field for field in fields if field["fieldname"] in order],
		key=lambda field: order[field["fieldname"]],
	)


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


def render_ss_coil_detail_html(context):
	parts = [
		_render_ss_coil_styles(),
		'<div class="ss-coil-print"><div class="page-body">',
		_render_ss_coil_header(context),
		_render_ss_coil_document_details(context.get("header_columns") or []),
	]

	dashboard = context.get("dashboard")
	if dashboard:
		parts.append(_render_ss_coil_dashboard(dashboard))

	for section in context.get("sections") or []:
		parts.append(_render_ss_coil_section_table(section))

	if context.get("root_tag_hierarchy"):
		parts.append(_render_ss_coil_tag_table("Complete Tag Hierarchy", context["root_tag_hierarchy"]))

	parts.append(
		f'<div class="footer-note">Generated on {_esc(frappe.utils.now_datetime().strftime("%Y-%m-%d %H:%M"))}</div>'
	)
	parts.append("</div></div>")
	return "".join(parts)


def _render_ss_coil_styles():
	return """
<style>
	@page { size: A4 landscape; margin: 6mm; }
	.print-format {
		orientation: Landscape;
		page-size: A4;
		page-width: 297mm;
		page-height: 210mm;
		margin-top: 6mm;
		margin-bottom: 6mm;
		margin-left: 6mm;
		margin-right: 6mm;
		font-family: Inter, Arial, sans-serif;
		font-size: 10px;
		color: #000;
	}
	@media screen {
		.print-format {
			box-sizing: border-box;
			width: 11.69in !important;
			max-width: 11.69in !important;
			min-height: 8.27in !important;
			padding: 6mm !important;
			margin: 30px auto !important;
		}
		.print-format-gutter { overflow: visible; }
	}
	@media print {
		.print-format { width: 100%; max-width: none; min-height: auto; padding: 0; margin: 0; }
	}
	.ss-coil-print,
	.ss-coil-print .page-body {
		width: 100%;
		max-width: 100%;
		box-sizing: border-box;
		color: #000;
		font-size: 9px;
		line-height: 1.2;
	}
	.ss-coil-print .report-header {
		text-align: center;
		margin-bottom: 3px;
		padding-bottom: 3px;
		border-bottom: 1px solid #333;
	}
	.ss-coil-print .report-title {
		font-size: 10px;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}
	.ss-coil-print .report-name {
		font-size: 14px;
		font-weight: 800;
		margin-top: 1px;
	}
	.ss-coil-print .report-sub {
		font-size: 9px;
		font-weight: 600;
		margin-top: 1px;
	}
	.ss-coil-print .doc-details {
		margin: 3px 0 6px;
	}
	.ss-coil-print .doc-details-title {
		font-size: 9px;
		font-weight: 700;
		margin: 0 0 2px;
		color: #000;
	}
	.ss-coil-print .detail-row {
		display: table;
		table-layout: fixed;
		width: 100%;
		line-height: 1.15;
		font-size: 8px;
		margin: 0;
	}
	.ss-coil-print .detail-row + .detail-row { margin-top: 1px; }
	.ss-coil-print .detail-cell {
		display: table-cell;
		width: 33.33%;
		vertical-align: top;
		padding: 0;
		color: #000;
		word-break: break-word;
	}
	.ss-coil-print .detail-left { text-align: left; padding-right: 6px; }
	.ss-coil-print .detail-center { text-align: center; padding: 0 3px; }
	.ss-coil-print .detail-right { text-align: right; padding-left: 6px; }
	.ss-coil-print .lbl { font-weight: 600; color: #000; }
	.ss-coil-print .val { font-weight: 700; color: #000; }
	.ss-coil-print .section-heading {
		font-size: 9px;
		font-weight: 700;
		color: #000;
		margin: 6px 0 2px;
		padding: 0 0 2px;
		border-bottom: 1px solid #666;
		background: none;
	}
	.ss-coil-print .summary-lines {
		margin-bottom: 4px;
		font-size: 8px;
		line-height: 1.2;
	}
	.ss-coil-print table.data-table {
		width: 100%;
		max-width: 100%;
		border-collapse: collapse;
		table-layout: fixed;
		font-size: 8px;
		margin: 0 0 5px;
	}
	.ss-coil-print table.data-table th,
	.ss-coil-print table.data-table td {
		border: 1px solid #999;
		padding: 2px 3px !important;
		vertical-align: top;
		color: #000 !important;
		line-height: 1.15;
		word-break: break-word;
		overflow-wrap: anywhere;
		background: #fff;
	}
	.ss-coil-print table.data-table th {
		background: #eee !important;
		color: #000 !important;
		font-weight: 700;
		font-size: 7px;
		text-transform: uppercase;
		-webkit-print-color-adjust: exact;
		print-color-adjust: exact;
	}
	.ss-coil-print table.data-table tbody tr:nth-child(even) td {
		background: #fafafa !important;
	}
	.ss-coil-print table.data-table .col-no {
		width: 3%;
		text-align: center;
		white-space: nowrap;
	}
	.ss-coil-print table.data-table .col-num {
		width: 6%;
		text-align: center;
		white-space: nowrap;
	}
	.ss-coil-print table.data-table .col-tag { width: 9%; }
	.ss-coil-print table.data-table td div,
	.ss-coil-print table.data-table th div {
		page-break-inside: auto !important;
	}
	.ss-coil-print table.data-table tr {
		page-break-inside: avoid;
		break-inside: avoid;
	}
	.ss-coil-print table.data-table thead { display: table-header-group; }
	.ss-coil-print .empty {
		font-size: 8px;
		margin-bottom: 4px;
	}
	.ss-coil-print .footer-note {
		margin-top: 5px;
		font-size: 7px;
		text-align: right;
	}
</style>
"""


def _render_ss_coil_header(context):
	return (
		'<div class="report-header">'
		f'<div class="report-title">{_esc(context.get("title") or "SS Coil Detail Report")}</div>'
		f'<div class="report-name">{_esc(context.get("name") or "-")}</div>'
		f'<div class="report-sub">{_esc(context.get("subtitle") or "-")}</div>'
		"</div>"
	)


def _render_ss_coil_document_details(columns):
	if not columns:
		return ""
	rows = []
	for index in range(0, len(columns), 3):
		chunk = columns[index : index + 3]
		cells = []
		for position, col in enumerate(chunk):
			cell_class = ("detail-left", "detail-center", "detail-right")[position]
			cells.append(
				f'<div class="{cell_class}">'
				f'<span class="lbl">{_esc(col["label"])}:</span> '
				f'<span class="val">{_esc(col["value"])}</span>'
				f"</div>"
			)
		while len(cells) < 3:
			cells.append(f'<div class="{("detail-left", "detail-center", "detail-right")[len(cells)]}"></div>')
		rows.append(f'<div class="detail-row">{"".join(cells)}</div>')
	return (
		'<div class="doc-details">'
		'<div class="doc-details-title">Document Details</div>'
		f'{"".join(rows)}'
		"</div>"
	)


def _ss_coil_column_class(column):
	fieldname = (column.get("fieldname") or "").lower()
	fieldtype = column.get("fieldtype")
	if fieldname in {"tag_no", "custom_tag_no", "ref_no"}:
		return "col-tag"
	if fieldtype in SS_COIL_COMPACT_FIELDTYPES:
		return "col-num"
	if fieldname in {"seq", "strip", "qty", "width", "length", "thickness"}:
		return "col-num"
	return ""


def _render_ss_coil_section_table(section):
	title = section.get("title") or "Section"
	columns = section.get("columns") or []
	rows = section.get("rows") or []
	if not rows:
		return f'<div class="section-heading">{_esc(title)}</div><div class="empty">No rows.</div>'

	header = '<th class="col-no">#</th>' + "".join(
		f'<th class="{_ss_coil_column_class(col)}">{_esc(col["label"], "")}</th>' for col in columns
	)
	body = []
	for row in rows:
		value_map = {item["fieldname"]: item["value"] for item in row.get("columns") or []}
		cells = f'<td class="col-no">{_esc(row.get("idx"))}</td>'
		cells += "".join(
			f'<td class="{_ss_coil_column_class(col)}">{_esc(value_map.get(col["fieldname"], "-"))}</td>'
			for col in columns
		)
		body.append(f"<tr>{cells}</tr>")

	return (
		f'<div class="section-heading">{_esc(title)}</div>'
		f'<table class="data-table"><thead><tr>{header}</tr></thead>'
		f'<tbody>{"".join(body)}</tbody></table>'
	)


def _render_ss_coil_tag_table(title, rows):
	if not rows:
		return ""
	body = []
	for row in rows:
		indent = 4 + (cint(row.get("depth")) * 8)
		body.append(
			"<tr>"
			f'<td class="col-tag" style="padding-left:{indent}px;">{_esc(row.get("tag_no"))}</td>'
			f'<td class="col-num">{_esc(row.get("status"))}</td>'
			f'<td class="col-tag">{_esc(row.get("parent_tag_no"))}</td>'
			f'<td>{_esc(row.get("item_code"))}</td>'
			f'<td class="col-num">{_esc(row.get("child_count"))}</td>'
			"</tr>"
		)
	return (
		f'<div class="section-heading">{_esc(title)}</div>'
		'<table class="data-table"><thead><tr>'
		'<th class="col-tag">Tag No</th><th class="col-num">Status</th>'
		'<th class="col-tag">Parent</th><th>Item</th><th class="col-num">Children</th>'
		f"</tr></thead><tbody>{''.join(body)}</tbody></table>"
	)


def _render_ss_coil_summary_row(items):
	cells = []
	for position, (label, value) in enumerate(items):
		cell_class = ("detail-left", "detail-center", "detail-right")[position % 3]
		cells.append(
			f'<div class="{cell_class}">'
			f'<span class="lbl">{_esc(label)}:</span> '
			f'<span class="val">{_esc(value if value not in (None, "") else "-")}</span>'
			f"</div>"
		)
	while len(cells) % 3:
		cells.append(f'<div class="{("detail-left", "detail-center", "detail-right")[len(cells) % 3]}"></div>')
	rows = []
	for index in range(0, len(cells), 3):
		rows.append(f'<div class="detail-row">{"".join(cells[index : index + 3])}</div>')
	return "".join(rows)


def _render_ss_coil_dashboard(dashboard):
	summary = dashboard.get("summary") or {}
	status_flow = dashboard.get("status_flow") or {}
	checklist = dashboard.get("process_checklist") or []

	summary_items = [
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
	flow_items = [
		("Operation", status_flow.get("operation")),
		("Order Status", status_flow.get("order_status")),
		("Current Process", status_flow.get("current_process")),
		("Next Process", status_flow.get("next_process")),
	]

	parts = [
		'<div class="section-heading">Summary</div>',
		f'<div class="summary-lines">{_render_ss_coil_summary_row(summary_items)}'
		f'{_render_ss_coil_summary_row(flow_items)}</div>',
	]

	if checklist:
		checklist_rows = []
		for item in checklist:
			checklist_rows.append(
				"<tr>"
				f"<td>{_esc(item.get('label'))}</td>"
				f'<td class="col-num">{_esc(item.get("status"))}</td>'
				f'<td class="col-tag">{_esc(item.get("ss_coil"))}</td>'
				f"<td>{_esc(item.get('order_status'))}</td>"
				"</tr>"
			)
		parts.append(
			'<div class="section-heading">Process Checklist</div>'
			'<table class="data-table"><thead><tr>'
			"<th>Process</th><th class=\"col-num\">Status</th><th class=\"col-tag\">SS Coil</th><th>Order Status</th>"
			f"</tr></thead><tbody>{''.join(checklist_rows)}</tbody></table>"
		)

	linked_rows = []
	for row in dashboard.get("stock_entry_details") or []:
		linked_rows.append(
			"<tr>"
			'<td class="col-num">Stock Entry</td>'
			f'<td class="col-tag">{_esc(row.get("stock_entry"))}</td>'
			f'<td class="col-num">{_esc(row.get("posting_date"))}</td>'
			f"<td>{_esc(row.get('purpose'))}</td>"
			f"<td>{_esc(row.get('item_code'))}</td>"
			f'<td class="col-tag">{_esc(row.get("tag_no"))}</td>'
			"</tr>"
		)
	for row in dashboard.get("delivery_details") or []:
		linked_rows.append(
			"<tr>"
			'<td class="col-num">Delivery Note</td>'
			f'<td class="col-tag">{_esc(row.get("delivery_note"))}</td>'
			f'<td class="col-num">{_esc(row.get("posting_date"))}</td>'
			f"<td>{_esc(row.get('status'))}</td>"
			f"<td>{_esc(row.get('item_code'))}</td>"
			f'<td class="col-tag">{_esc(row.get("tag_no"))}</td>'
			"</tr>"
		)
	for row in dashboard.get("invoice_details") or []:
		linked_rows.append(
			"<tr>"
			'<td class="col-num">Sales Invoice</td>'
			f'<td class="col-tag">{_esc(row.get("sales_invoice"))}</td>'
			f'<td class="col-num">{_esc(row.get("posting_date"))}</td>'
			f"<td>{_esc(row.get('status'))}</td>"
			f"<td>{_esc(row.get('item_code'))}</td>"
			f'<td class="col-tag">{_esc(row.get("tag_no"))}</td>'
			"</tr>"
		)

	if linked_rows:
		parts.append(
			'<div class="section-heading">Linked Documents</div>'
			'<table class="data-table"><thead><tr>'
			'<th class="col-num">Type</th><th class="col-tag">Name</th><th class="col-num">Date</th>'
			"<th>Status</th><th>Item</th><th class=\"col-tag\">Tag</th>"
			f"</tr></thead><tbody>{''.join(linked_rows)}</tbody></table>"
		)

	return "".join(parts)
