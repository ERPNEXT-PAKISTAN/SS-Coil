"""SS Coil Job Sheet — A4 HTML for form preview and print."""

from html import escape

import frappe
from frappe import _
from frappe.utils import cint, flt, getdate, today

from ss_coil.api import get_stock_entry_sticker_logo_url
from ss_coil.production_planning_report import _doc_field, _normalize_child_rows

CUTTING_SCHEME_COLUMNS = (
	("seq", "SEQ"),
	("width", "Width"),
	("strip", "Strip"),
	("lengthcut", "LengthCut"),
	("length", "Length"),
	("total_sheets", "Total Sheets"),
	("total_width", "Total Width"),
	("tolerance_plus", "Tol (+)"),
	("tolerance_minus", "Tol (-)"),
	("knife", "Knife"),
)

INPUT_COIL_COLUMNS = (
	("tag_no", "Tag No"),
	("class", "Class"),
	("dimension", "Dimension"),
	("length", "Length"),
	("estimated_qty", "Est Qty"),
	("estimated_wt", "Est WT"),
	("actual_qty", "Actual Qty"),
	("actual_wt", "Actual WT"),
	("location", "Location"),
	("next_process", "Next Process"),
)

JOB_OUTPUT_COLUMNS = (
	("tag_no", "Tag No"),
	("class", "Class"),
	("customer", "Customer"),
	("thickness", "Thick"),
	("width", "Width"),
	("length", "Length"),
	("estimated_qty", "Est Qty"),
	("actual_qty", "Actual Qty"),
	("estimated_wt", "Est WT"),
	("packing", "Packing"),
)


def _esc(value):
	if value in (None, ""):
		return "—"
	return escape(str(value))


def _fmt_date(value):
	if not value:
		return "—"
	return escape(str(frappe.format(getdate(value), {"fieldtype": "Date"})))


def _fmt_float(value):
	if value in (None, ""):
		return "—"
	return escape(str(frappe.format(value, {"fieldtype": "Float"})))


def _cell(value, align="left"):
	return f'<td style="padding:7px 10px;border:1px solid #dbe4ef;text-align:{align};vertical-align:top;">{_esc(value) if value not in (None, "") else "—"}</td>'


def _knife(value):
	return "Yes" if cint(value) else "No"


def _resolve_company(doc):
	company = frappe.defaults.get_global_default("company")
	stock_entry = _doc_field(doc, "stock_entry")
	if stock_entry and frappe.db.exists("Stock Entry", stock_entry):
		company = frappe.db.get_value("Stock Entry", stock_entry, "company") or company
	order_no = _doc_field(doc, "order_no")
	if order_no and frappe.db.exists("Sales Order", order_no):
		company = frappe.db.get_value("Sales Order", order_no, "company") or company
	return company


def _primary_so_row(doc):
	rows = _normalize_child_rows(_doc_field(doc, "so_item") or [])
	return rows[0] if rows else {}


def _cutting_rows(doc):
	rows = _normalize_child_rows(_doc_field(doc, "cutting_detail") or [])
	if rows:
		return rows
	sales_order_item = _doc_field(doc, "sales_order_item")
	if sales_order_item:
		from ss_coil.api import get_so_production_plan_rows

		return get_so_production_plan_rows(sales_order_item) or []
	return []


def _render_table(columns, rows, empty_label="No rows"):
	if not rows:
		return f'<div style="padding:14px;color:#64748b;font-size:12px;background:#f8fafc;border:1px dashed #cbd5e1;border-radius:10px;">{escape(empty_label)}</div>'

	head = "".join(
		f'<th style="padding:8px 10px;background:#1e3a5f !important;color:#f8fafc;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;border:1px solid #1e3a5f;text-align:left;-webkit-print-color-adjust:exact;print-color-adjust:exact;">{escape(label)}</th>'
		for _field, label in columns
	)
	body_rows = []
	for idx, row in enumerate(rows):
		bg = "#ffffff" if idx % 2 == 0 else "#f8fafc"
		cells = []
		for fieldname, _label in columns:
			val = row.get(fieldname)
			if fieldname == "knife":
				cell_val = escape(_knife(val))
			elif fieldname in (
				"width",
				"strip",
				"lengthcut",
				"length",
				"total_sheets",
				"total_width",
				"estimated_qty",
				"actual_qty",
				"estimated_wt",
				"actual_wt",
				"thickness",
				"seq",
			):
				cell_val = _fmt_float(val) if val not in (None, "") else "—"
			else:
				cell_val = _esc(val) if val not in (None, "") else "—"
			cells.append(
				f'<td style="padding:7px 10px;border:1px solid #e2e8f0;background:{bg} !important;font-size:11px;color:#0f172a;-webkit-print-color-adjust:exact;print-color-adjust:exact;">{cell_val}</td>'
			)
		body_rows.append(f"<tr>{''.join(cells)}</tr>")

	return f"""
	<div style="overflow:auto;border-radius:12px;border:1px solid #cbd5e1;box-shadow:0 4px 14px rgba(15,23,42,.06);">
		<table class="ss-coil-job-sheet-data" style="width:100%;border-collapse:collapse;min-width:640px;">
			<thead><tr>{head}</tr></thead>
			<tbody>{"".join(body_rows)}</tbody>
		</table>
	</div>"""


def _info_grid(pairs):
	"""Order & product fields: one row, each field in its own box (full width)."""
	cells = []
	for label, value in pairs:
		cells.append(
			f"""
			<td style="padding:0;vertical-align:top;">
				<div style="background:#fff;border:1px solid #cbd5e1;border-radius:10px;padding:8px 9px;height:100%;box-sizing:border-box;min-height:52px;">
					<div style="font-size:12px;font-weight:800;text-transform:uppercase;letter-spacing:.04em;color:#1e3a5f;line-height:1.25;">{escape(str(label))}</div>
					<div style="font-size:13px;font-weight:700;color:#0f172a;margin-top:5px;line-height:1.3;word-break:break-word;">{_esc(value)}</div>
				</div>
			</td>"""
		)
	if not cells:
		return '<div style="color:#94a3b8;font-size:12px;">—</div>'
	col_width = round(100 / max(len(cells), 1), 2)
	return f"""
	<div style="width:100%;box-sizing:border-box;">
		<table style="width:100%;border-collapse:separate;border-spacing:6px 0;table-layout:fixed;">
			<tr>{"".join(cells)}</tr>
		</table>
	</div>"""


def _notes_row(special_instructions, remarks):
	def note_cell(label, value, pad_side):
		body = _esc(value) if value not in (None, "") else "—"
		pad = "padding:0 5px 0 0;" if pad_side == "left" else "padding:0 0 0 5px;"
		return f"""
		<td style="width:50%;{pad}vertical-align:top;">
			<div style="background:#fffbeb !important;border:1px solid #fde68a;border-radius:10px;padding:12px 14px;height:100%;box-sizing:border-box;-webkit-print-color-adjust:exact;print-color-adjust:exact;">
				<div style="font-size:10px;font-weight:800;text-transform:uppercase;color:#92400e;">{escape(label)}</div>
				<div style="font-size:12px;color:#78350f;margin-top:6px;line-height:1.5;white-space:pre-wrap;">{body}</div>
			</div>
		</td>"""

	return f"""
	<table style="width:100%;border-collapse:collapse;table-layout:fixed;">
		<tr>
			{note_cell("Special Instructions", special_instructions, "left")}
			{note_cell("Remarks", remarks, "right")}
		</tr>
	</table>"""


def _employee_name(employee):
	if not employee:
		return "—"
	return frappe.db.get_value("Employee", employee, "employee_name") or employee


def _signature_row(pairs):
	cells = []
	for label, employee_id in pairs:
		name = _employee_name(employee_id)
		cells.append(
			f"""
			<td style="width:25%;vertical-align:top;padding:4px 6px 0 0;">
				<div style="border:1px solid #cbd5e1;border-radius:10px;padding:10px 12px;min-height:72px;background:#fff;">
					<div style="font-size:9px;font-weight:800;text-transform:uppercase;color:#64748b;">{escape(label)}</div>
					<div style="font-size:12px;font-weight:700;color:#0f172a;margin-top:28px;border-top:1px solid #94a3b8;padding-top:6px;">{_esc(name)}</div>
				</div>
			</td>"""
		)
	return f'<table style="width:100%;border-collapse:collapse;table-layout:fixed;"><tr>{"".join(cells)}</tr></table>'


def build_ss_coil_job_sheet_context(doc):
	if isinstance(doc, str):
		doc = frappe.get_doc("SS Coil", doc)
	company = _resolve_company(doc)
	so_row = _primary_so_row(doc)
	user = frappe.get_value("User", frappe.session.user if frappe.session.user else doc.owner, "full_name") or doc.owner

	specification = so_row.get("specification") or _doc_field(doc, "specifications")
	dimension = so_row.get("dimension")
	if not dimension and so_row.get("width"):
		parts = [p for p in (so_row.get("thickness"), so_row.get("width"), so_row.get("length")) if p not in (None, "")]
		if parts:
			dimension = " x ".join(str(p) for p in parts)

	order_qty = so_row.get("qty")
	estimated_wt = _doc_field(doc, "grand_estimated_wt") or so_row.get("estimated_wt")

	return {
		"doc": doc,
		"company": company,
		"company_name": frappe.get_cached_value("Company", company, "company_name") if company else "—",
		"logo_url": get_stock_entry_sticker_logo_url(company),
		"entry_no": _doc_field(doc, "name"),
		"operation_title": _doc_field(doc, "operation") or "Job Sheet",
		"report_date": _doc_field(doc, "order_received_date") or today(),
		"sc_date": _doc_field(doc, "sc_date"),
		"user": user,
		"customer_name": _doc_field(doc, "customer_name"),
		"for_customer": _doc_field(doc, "for_customer"),
		"sales_order_no": _doc_field(doc, "order_no"),
		"specification": specification,
		"dimension": dimension,
		"order_qty": order_qty,
		"estimated_wt": estimated_wt,
		"special_instructions": _doc_field(doc, "special_instructions"),
		"remarks": _doc_field(doc, "remarks"),
		"machine": _doc_field(doc, "machine"),
		"calc_ratio": _doc_field(doc, "calc_ratio"),
		"calc_ratio_2": _doc_field(doc, "calc_ratio_2"),
		"actual_ratio": _doc_field(doc, "actual_ratio"),
		"remaining_width": _doc_field(doc, "remaining_width"),
		"grand_total_width": _doc_field(doc, "grand_total_width"),
		"width": _doc_field(doc, "width"),
		"ds": _doc_field(doc, "ds"),
		"ctr": _doc_field(doc, "ctr"),
		"ws": _doc_field(doc, "ws"),
		"mill": _doc_field(doc, "mill"),
		"specifications": _doc_field(doc, "specifications"),
		"commodity": _doc_field(doc, "commodity"),
		"works": _doc_field(doc, "works"),
		"planning": _doc_field(doc, "planning"),
		"sales": _doc_field(doc, "sales"),
		"production": _doc_field(doc, "produciton"),
		"encoded_by": _doc_field(doc, "encoded_by"),
		"cutting_rows": _cutting_rows(doc),
		"input_rows": _normalize_child_rows(_doc_field(doc, "input_coil") or []),
		"output_rows": _normalize_child_rows(_doc_field(doc, "job_output") or []),
	}


def build_ss_coil_job_sheet_html(doc, for_print=False):
	"""Build job sheet HTML. Preview and print use the same markup; print hides the toolbar via CSS."""
	del for_print  # same HTML for preview and print
	ctx = build_ss_coil_job_sheet_context(doc)
	logo_url = ctx["logo_url"]
	if logo_url and logo_url.startswith("/"):
		logo_url = frappe.utils.get_url(logo_url)
	logo_html = ""
	if logo_url:
		logo_html = (
			f'<img class="ss-coil-job-sheet-header-logo-img" src="{escape(logo_url)}" alt="Logo" '
			f'style="height:24px;width:auto;max-width:140px;object-fit:contain;display:block;">'
		)
	else:
		logo_html = '<span class="ss-coil-job-sheet-header-logo-img" style="display:block;width:24px;height:24px;"></span>'

	header_title_style = (
		"font-size:24px;font-weight:900;color:#1e3a5f;line-height:1.1;"
		"letter-spacing:.02em;text-transform:uppercase;"
	)

	def _render_header():
		return f"""
		<table class="ss-coil-job-sheet-header" style="width:100%;border-collapse:collapse;border-bottom:3px solid #1e3a5f;margin-bottom:14px;table-layout:fixed;">
			<tr>
				<td style="width:48%;vertical-align:middle;padding:0 12px 12px 0;">
					<div class="ss-coil-job-sheet-brand">
						<table class="ss-coil-job-sheet-brand-table"><tr>
							<td class="ss-coil-job-sheet-brand-logo-cell ss-coil-job-sheet-header-logo">{logo_html}</td>
							<td class="ss-coil-job-sheet-brand-name-cell">
								<div class="ss-coil-job-sheet-company" style="{header_title_style}">{_esc(ctx["company_name"])}</div>
							</td>
						</tr></table>
					</div>
				</td>
				<td style="width:28%;text-align:center;vertical-align:middle;padding:0 8px 12px;">
					<div class="ss-coil-job-sheet-operation" style="{header_title_style}">{_esc(ctx["operation_title"])}</div>
					<div class="ss-coil-job-sheet-subtitle" style="margin-top:4px;font-size:11px;color:#64748b;font-weight:700;text-transform:uppercase;letter-spacing:.08em;">Job Sheet</div>
				</td>
				<td style="width:24%;vertical-align:middle;padding:0 0 12px 8px;">&nbsp;</td>
			</tr>
		</table>"""

	def section(title, body):
		return f"""
		<section style="margin-top:16px;width:100%;box-sizing:border-box;">
			<div style="font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.08em;color:#1e3a5f;margin-bottom:8px;padding-bottom:6px;border-bottom:2px solid #1e3a5f;">{escape(title)}</div>
			{body}
		</section>"""

	def order_product_section(body):
		return f"""
		<section style="margin-top:16px;width:100%;box-sizing:border-box;">
			<table style="width:100%;border-collapse:separate;border-spacing:0;table-layout:fixed;">
				<tr>
					<td style="width:118px;vertical-align:top;padding:0 10px 0 0;">
						<div style="background:#1e3a5f !important;color:#f8fafc;border-radius:10px;padding:12px 10px;height:100%;box-sizing:border-box;min-height:52px;display:flex;align-items:center;justify-content:center;text-align:center;font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.06em;line-height:1.35;-webkit-print-color-adjust:exact;print-color-adjust:exact;">Order &amp; Product</div>
					</td>
					<td style="vertical-align:top;padding:0;">{body}</td>
				</tr>
			</table>
		</section>"""

	meta_row = _info_grid(
		[
			("Customer Name", ctx["customer_name"]),
			("For Customer", ctx["for_customer"]),
			("Sales Order No", ctx["sales_order_no"]),
			("Specification", ctx["specification"]),
			("Dimension", ctx["dimension"]),
			("Order Qty", ctx["order_qty"]),
			("Estimated WT", ctx["estimated_wt"]),
		]
	)

	prep_row = _info_grid(
		[
			("Machine", ctx["machine"]),
			("Calc Ratio", ctx["calc_ratio"]),
			("Calc Ratio 2", ctx["calc_ratio_2"]),
			("Actual Ratio", ctx["actual_ratio"]),
			("Remaining Width", ctx["remaining_width"]),
		]
	)

	dimension_row = _info_grid(
		[
			("Width", ctx["width"]),
			("DS", ctx["ds"]),
			("CTR", ctx["ctr"]),
			("WS", ctx["ws"]),
		]
	)

	mill_row = _info_grid(
		[
			("Mill", ctx["mill"]),
			("Specifications", ctx["specifications"]),
			("Commodity", ctx["commodity"]),
			("Works", ctx["works"]),
		]
	)

	text_block = _notes_row(ctx["special_instructions"], ctx["remarks"])
	signatures = _signature_row(
		[
			("Planning", ctx["planning"]),
			("Sales", ctx["sales"]),
			("Production", ctx["production"]),
			("Encoded By", ctx["encoded_by"]),
		]
	)

	grand_total = ctx.get("grand_total_width")
	cutting_body = _render_table(CUTTING_SCHEME_COLUMNS, ctx["cutting_rows"], "No cutting scheme rows")
	if grand_total not in (None, ""):
		cutting_body += (
			f'<div style="margin-top:8px;font-size:11px;font-weight:700;color:#1e3a5f;">'
			f"Grand Total Width: {_fmt_float(grand_total)}</div>"
		)

	entry = escape(str(ctx["entry_no"]))
	print_css = """
	<style>
		.ss-coil-job-sheet-root,
		.ss-coil-job-sheet-root * {
			-webkit-print-color-adjust: exact !important;
			print-color-adjust: exact !important;
		}
		.ss-coil-job-sheet-root {
			width: 100%;
			max-width: 100%;
			box-sizing: border-box;
		}
		.ss-coil-job-sheet-header-logo-img {
			height: 24px !important;
			max-height: 24px !important;
			width: auto;
			max-width: 140px;
			object-fit: contain;
			flex-shrink: 0;
		}
		.ss-coil-job-sheet-brand {
			width: 100%;
		}
		.ss-coil-job-sheet-brand-table {
			border-collapse: collapse;
			width: 100%;
		}
		.ss-coil-job-sheet-brand-table td {
			vertical-align: middle;
			padding: 0;
		}
		.ss-coil-job-sheet-brand-logo-cell {
			width: auto;
			padding-right: 10px !important;
			white-space: nowrap;
		}
		.ss-coil-job-sheet-brand-name-cell {
			white-space: nowrap;
			word-break: keep-all;
			overflow: visible;
		}
		.ss-coil-job-sheet-company,
		.ss-coil-job-sheet-operation {
			font-size: 24px !important;
			font-weight: 900 !important;
			line-height: 1.1 !important;
			letter-spacing: 0.02em !important;
			color: #1e3a5f !important;
			text-transform: uppercase;
		}
		.ss-coil-job-sheet-company {
			white-space: nowrap;
			word-break: normal;
			overflow: visible;
		}
		@media print {
			@page {
				size: A4 landscape;
				margin: 2mm;
			}
			html, body {
				margin: 0 !important;
				padding: 0 !important;
				background: #fff !important;
			}
			html, body, .print-format, .action-banner, .print-hide {
				background: #fff !important;
			}
			.print-format {
				padding: 0 !important;
				margin: 0 !important;
				max-width: none !important;
				width: 100% !important;
			}
			.ss-coil-job-sheet-print-bar { display: none !important; }
			.ss-coil-job-sheet-print-page {
				width: 100% !important;
				max-width: 100% !important;
				box-sizing: border-box;
				page-break-after: avoid !important;
				page-break-before: avoid !important;
				page-break-inside: avoid !important;
			}
			.ss-coil-job-sheet-root {
				width: 100% !important;
				max-width: 100% !important;
				padding: 6px 8px !important;
				margin: 0 !important;
				box-shadow: none !important;
				border-radius: 4px !important;
				font-size: 9px !important;
				line-height: 1.15 !important;
				page-break-inside: avoid !important;
				break-inside: avoid !important;
			}
			.ss-coil-job-sheet-root section {
				margin-top: 5px !important;
				page-break-inside: avoid !important;
				break-inside: avoid !important;
			}
			.ss-coil-job-sheet-root table.ss-coil-job-sheet-data {
				width: 100% !important;
				table-layout: fixed;
				page-break-inside: avoid !important;
				break-inside: avoid !important;
			}
			.ss-coil-job-sheet-root table.ss-coil-job-sheet-data th,
			.ss-coil-job-sheet-root table.ss-coil-job-sheet-data td {
				padding: 3px 5px !important;
				font-size: 8px !important;
				line-height: 1.15 !important;
			}
			.ss-coil-job-sheet-header > tbody > tr > td {
				padding: 0 8px 10px 0 !important;
				font-size: inherit !important;
			}
			.ss-coil-job-sheet-header .ss-coil-job-sheet-brand-table td {
				padding: 0 !important;
				font-size: inherit !important;
			}
			.ss-coil-job-sheet-header .ss-coil-job-sheet-brand-logo-cell {
				padding-right: 10px !important;
			}
			.ss-coil-job-sheet-header-logo-img {
				height: 22px !important;
				max-height: 22px !important;
				width: auto !important;
				max-width: 130px !important;
			}
			.ss-coil-job-sheet-company,
			.ss-coil-job-sheet-operation {
				font-size: 22px !important;
				line-height: 1.1 !important;
				font-weight: 900 !important;
			}
			.ss-coil-job-sheet-brand {
				width: 100% !important;
			}
			.ss-coil-job-sheet-brand-name-cell,
			.ss-coil-job-sheet-brand-name-cell .ss-coil-job-sheet-company {
				white-space: nowrap !important;
				word-break: keep-all !important;
			}
			.ss-coil-job-sheet-subtitle {
				font-size: 9px !important;
			}
			.ss-coil-job-sheet-meta td {
				padding: 8px !important;
				font-size: inherit !important;
			}
			.ss-coil-job-sheet-meta td span,
			.ss-coil-job-sheet-meta td div {
				font-size: inherit !important;
			}
		}
	</style>"""

	print_bar = f"""
		<div class="ss-coil-job-sheet-print-bar" style="display:flex;justify-content:flex-end;margin-bottom:12px;gap:8px;">
			<button type="button" class="btn btn-primary btn-sm ss-coil-print-job-sheet" data-ss-coil="{entry}" style="font-weight:700;">
				{escape(_("Print"))}
			</button>
		</div>"""

	html = f"""
	{print_css}
	<div class="ss-coil-job-sheet-print-page">
	<div class="ss-coil-job-sheet-root" style="font-family:Inter,'Segoe UI',Arial,sans-serif;color:#0f172a;background:#fff !important;border:1px solid #e2e8f0;border-radius:16px;padding:20px 22px;box-shadow:0 8px 28px rgba(15,23,42,.08);width:100%;box-sizing:border-box;-webkit-print-color-adjust:exact;print-color-adjust:exact;">
		{print_bar}
		{_render_header()}
		<table class="ss-coil-job-sheet-meta" style="width:100%;border-collapse:collapse;table-layout:fixed;margin-bottom:4px;">
			<tr>
				<td style="width:25%;padding:8px;background:#f1f5f9 !important;border:1px solid #e2e8f0;border-radius:8px 0 0 8px;-webkit-print-color-adjust:exact;print-color-adjust:exact;">
					<span style="font-size:9px;font-weight:700;color:#64748b;text-transform:uppercase;">Entry No</span>
					<div style="font-size:13px;font-weight:800;">{_esc(ctx["entry_no"])}</div>
				</td>
				<td style="width:25%;padding:8px;background:#f1f5f9 !important;border:1px solid #e2e8f0;border-left:none;-webkit-print-color-adjust:exact;print-color-adjust:exact;">
					<span style="font-size:9px;font-weight:700;color:#64748b;text-transform:uppercase;">Date</span>
					<div style="font-size:13px;font-weight:800;">{_fmt_date(ctx["report_date"])}</div>
				</td>
				<td style="width:25%;padding:8px;background:#f1f5f9 !important;border:1px solid #e2e8f0;border-left:none;-webkit-print-color-adjust:exact;print-color-adjust:exact;">
					<span style="font-size:9px;font-weight:700;color:#64748b;text-transform:uppercase;">SC Date</span>
					<div style="font-size:13px;font-weight:800;">{_fmt_date(ctx["sc_date"])}</div>
				</td>
				<td style="width:25%;padding:8px;background:#f1f5f9 !important;border:1px solid #e2e8f0;border-left:none;border-radius:0 8px 8px 0;-webkit-print-color-adjust:exact;print-color-adjust:exact;">
					<span style="font-size:9px;font-weight:700;color:#64748b;text-transform:uppercase;">User</span>
					<div style="font-size:13px;font-weight:800;">{_esc(ctx["user"])}</div>
				</td>
			</tr>
		</table>
		{order_product_section(meta_row)}
		{section("Machine &amp; Ratios", prep_row)}
		{section("Cutting Scheme", cutting_body)}
		{section("Notes", text_block)}
		{section("Dimensions", dimension_row)}
		{section("Mill &amp; Product", mill_row)}
		{section("Input Coil", _render_table(INPUT_COIL_COLUMNS, ctx["input_rows"], "No input coil rows"))}
		{section("Job Output", _render_table(JOB_OUTPUT_COLUMNS, ctx["output_rows"], "No job output rows"))}
		{section("Signatures", signatures)}
	</div>
	</div>"""
	return html


@frappe.whitelist()
def get_ss_coil_job_sheet_html(ss_coil):
	if not ss_coil or not frappe.db.exists("SS Coil", ss_coil):
		frappe.throw(_("SS Coil not found"))
	doc = frappe.get_doc("SS Coil", ss_coil)
	return build_ss_coil_job_sheet_html(doc)
