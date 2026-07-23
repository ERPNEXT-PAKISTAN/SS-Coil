"""Shared Delivery Advise print layout for Stock Entry and Sales Order."""

from html import escape

import frappe
from frappe.utils import flt, formatdate

DELIVERY_ADVISE_PRINT_FORMATS = {
	"Stock Entry": "Stock Entry Coil",
	"Sales Order": "Sales Order Coil",
}


def build_delivery_advise_print_html(doc):
	try:
		doc = _ensure_doc(doc)
		if doc.doctype not in DELIVERY_ADVISE_PRINT_FORMATS:
			return ""

		header = _delivery_advise_header(doc)
		rows, total_qty, total_weight = _delivery_advise_item_rows(doc)
		return _render_delivery_advise_html(header, rows, total_qty, total_weight)
	except Exception:
		frappe.log_error(title="Delivery Advise Print Error")
		return "<p>Unable to render Delivery Advise print format.</p>"


def _ensure_doc(doc):
	if isinstance(doc, str):
		frappe.throw("Document reference must include doctype")
	doctype = getattr(doc, "doctype", None)
	name = getattr(doc, "name", None)
	if doctype and name and frappe.db.exists(doctype, name):
		return frappe.get_doc(doctype, name)
	if getattr(doc, "doctype", None):
		return doc
	frappe.throw("Unable to resolve document for printing")


def _delivery_advise_header(doc):
	if doc.doctype == "Stock Entry":
		return {
			"company": doc.company or "-",
			"name": doc.name,
			"job_purpose": doc.get("custom_job_purpose") or "-",
			"date": formatdate(doc.posting_date) if doc.posting_date else "-",
			"customer": doc.get("custom_customer") or "-",
			"for_customer": doc.get("custom_for_customer") or "-",
			"mr_number": doc.get("custom_mr_number") or "-",
			"lot": doc.get("custom_lot") or "-",
			"vehicle_no": doc.get("custom_vehicle_no") or "-",
			"driver_name": doc.get("custom_driver_name") or "-",
			"invoice_igp": doc.get("custom_invoice__igp_no") or "-",
		}

	return {
		"company": doc.company or "-",
		"name": doc.name,
		"job_purpose": "-",
		"date": formatdate(doc.transaction_date) if doc.transaction_date else "-",
		"customer": doc.customer_name or doc.customer or "-",
		"for_customer": doc.get("custom_for_customer") or "-",
		"mr_number": "-",
		"lot": "-",
		"vehicle_no": "-",
		"driver_name": "-",
		"invoice_igp": doc.get("custom_igp_no") or "-",
	}


def _normalize_item_row(row):
	if isinstance(row, dict):
		return row
	as_dict = getattr(row, "as_dict", None)
	if callable(as_dict):
		return as_dict()
	return frappe._dict(row)


def _delivery_advise_item_rows(doc):
	rows = []
	total_qty = 0.0
	total_weight = 0.0

	for row in doc.items or []:
		item = _normalize_item_row(row)
		qty = flt(item.get("custom_qty_of_coil"))
		weight = flt(item.get("qty"))
		total_qty += qty
		total_weight += weight
		rows.append(
			{
				"tag_no": item.get("custom_tag_no") or item.get("custom_child_tag_no") or "-",
				"ref_no": item.get("custom_ref_no") or "-",
				"hdgc_no": item.get("custom_hdgc_no") or "-",
				"commodity": item.get("custom_commodity") or "-",
				"specification": item.get("custom_specification") or "-",
				"mill": item.get("custom_mill") or "-",
				"thickness": item.get("custom_thickness") if item.get("custom_thickness") not in (None, "") else "-",
				"width": item.get("custom_width") if item.get("custom_width") not in (None, "") else "-",
				"length": item.get("custom_length") if item.get("custom_length") not in (None, "") else "-",
				"qty": qty if qty else "-",
				"weight": weight if weight else "-",
				"js_no": item.get("custom_js_number") or "-",
				"condition": item.get("custom_condition") or "-",
				"remarks": item.get("custom_remarks") or "-",
			}
		)

	return rows, total_qty, total_weight


def _cell(value):
	return escape(_text(value))


def _text(value, default="-"):
	if value in (None, ""):
		return default
	return str(value)


def _render_delivery_advise_html(header, rows, total_qty, total_weight):
	item_rows = []
	for row in rows:
		item_rows.append(
			"<tr>"
			f'<td class="col-tag col-wrap">{_cell(row["tag_no"])}</td>'
			f'<td class="col-medium col-wrap">{_cell(row["ref_no"])}</td>'
			f'<td class="col-medium col-wrap">{_cell(row["hdgc_no"])}</td>'
			f'<td class="col-compact">{_cell(row["commodity"])}</td>'
			f'<td class="col-wrap">{_cell(row["specification"])}</td>'
			f'<td class="col-medium">{_cell(row["mill"])}</td>'
			f'<td class="col-compact">{_cell(row["thickness"])}</td>'
			f'<td class="col-compact">{_cell(row["width"])}</td>'
			f'<td class="col-compact">{_cell(row["length"])}</td>'
			f'<td class="col-compact">{_cell(row["qty"])}</td>'
			f'<td class="col-compact">{_cell(row["weight"])}</td>'
			f'<td class="col-medium">{_cell(row["js_no"])}</td>'
			f'<td class="col-compact">{_cell(row["condition"])}</td>'
			f'<td class="col-wrap">{_cell(row["remarks"])}</td>'
			"</tr>"
		)

	total_qty_text = _text(total_qty if total_qty else "-")
	total_weight_text = _text(total_weight if total_weight else "-")

	return (
		_render_delivery_advise_styles()
		+ '<div class="coil-print"><div class="page-body">'
		+ '<div class="report-header">'
		+ f'<div class="company-heading">{_cell(header["company"])}</div>'
		+ '<div class="report-meta">'
		+ f'<span class="voucher-no">{_cell(header["name"])} | <strong class="job-purpose">{_cell(header["job_purpose"])}</strong></span>'
		+ '<span class="doc-title">Delivery Advise</span>'
		+ "</div></div>"
		+ '<div class="info-grid">'
		+ '<div class="info-row">'
		f'<div class="info-left"><span class="coil-lbl">Customer:</span> <span class="coil-val">{_cell(header["customer"])}</span></div>'
		f'<div class="info-center"><span class="coil-lbl">LOT No:</span> <span class="coil-val">{_cell(header["lot"])}</span></div>'
		f'<div class="info-right"><span class="coil-lbl">Invoice / IGP No:</span> <span class="coil-val">{_cell(header["invoice_igp"])}</span></div>'
		+ "</div>"
		+ '<div class="info-row">'
		f'<div class="info-left"><span class="coil-lbl">For Customer:</span> <span class="coil-val">{_cell(header["for_customer"])}</span></div>'
		f'<div class="info-center"><span class="coil-lbl">Vehicle No:</span> <span class="coil-val">{_cell(header["vehicle_no"])}</span></div>'
		f'<div class="info-right"><span class="coil-lbl">Date:</span> <span class="coil-val">{_cell(header["date"])}</span></div>'
		+ "</div>"
		+ '<div class="info-row">'
		f'<div class="info-left"><span class="coil-lbl">MR Number:</span> <span class="coil-val">{_cell(header["mr_number"])}</span></div>'
		f'<div class="info-center"><span class="coil-lbl">Driver Name:</span> <span class="coil-val">{_cell(header["driver_name"])}</span></div>'
		+ '<div class="info-right"></div>'
		+ "</div></div>"
		+ '<div class="section-title">Items</div>'
		+ '<table class="items"><thead><tr>'
		+ '<th class="col-tag col-wrap">Tag No</th>'
		+ '<th class="col-medium col-wrap">Ref No</th>'
		+ '<th class="col-medium col-wrap">HDGC No</th>'
		+ '<th class="col-compact">Commodity</th>'
		+ '<th class="col-wrap">Specification</th>'
		+ '<th class="col-medium">Mill</th>'
		+ '<th class="col-compact">Thickness</th>'
		+ '<th class="col-compact">Width</th>'
		+ '<th class="col-compact">Length</th>'
		+ '<th class="col-compact">Qty</th>'
		+ '<th class="col-compact">Weight</th>'
		+ '<th class="col-medium">JS No</th>'
		+ '<th class="col-compact">Condition</th>'
		+ '<th class="col-wrap">Remarks</th>'
		+ "</tr></thead><tbody>"
		+ "".join(item_rows)
		+ '<tr class="totals-row">'
		+ '<td colspan="9" class="totals-label">Total</td>'
		+ f'<td class="col-compact">{escape(total_qty_text)}</td>'
		+ f'<td class="col-compact">{escape(total_weight_text)}</td>'
		+ '<td colspan="3"></td>'
		+ "</tr></tbody></table></div>"
		+ '<div class="signatures-wrap"><table class="signatures" width="100%"><tr>'
		+ '<td><div class="sign-line">Issue By</div></td>'
		+ '<td><div class="sign-line">Checked By</div></td>'
		+ '<td><div class="sign-line">Approved By</div></td>'
		+ '<td><div class="sign-line">Received By</div></td>'
		+ "</tr></table></div></div>"
	)


def _render_delivery_advise_styles():
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
		font-size: 11px;
		color: #0f172a;
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
		.coil-print {
			display: flex;
			flex-direction: column;
			min-height: calc(8.27in - 12mm);
		}
		.coil-print .signatures-wrap { margin-top: auto; }
	}
	@media print {
		.print-format { width: 100%; max-width: none; min-height: auto; padding: 0; margin: 0; }
		.coil-print { display: block; min-height: 0; }
		.coil-print .signatures-wrap {
			margin-top: 18px;
			page-break-inside: avoid;
			break-inside: avoid;
			page-break-before: avoid;
		}
	}
	.coil-print {
		width: 100%;
		max-width: 100%;
		font-size: 11px;
		line-height: 1.35;
	}
	.coil-print .page-body { width: 100%; }
	.coil-print .signatures-wrap {
		flex-shrink: 0;
		width: 100%;
		padding-top: 8px;
	}
	.coil-print table { border-collapse: collapse; border-spacing: 0; }
	.coil-print .report-header {
		text-align: center;
		margin-bottom: 4px;
		padding-bottom: 4px;
		border-bottom: 2px solid #1e3a5f;
	}
	.coil-print .company-heading {
		font-size: 18px;
		font-weight: 800;
		line-height: 1.2;
		margin: 0 0 4px;
	}
	.coil-print .report-meta {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-top: 2px;
	}
	.coil-print .voucher-no { font-size: 11px; font-weight: 600; color: #334155; }
	.coil-print .voucher-no .job-purpose { font-weight: 800; color: #0f172a; }
	.coil-print .doc-title {
		font-size: 14px;
		font-weight: 800;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: #1e40af;
	}
	.coil-print .info-grid {
		width: 100%;
		margin: 2px 0 6px;
	}
	.coil-print .info-row {
		display: table;
		table-layout: fixed;
		width: 100%;
		margin: 0;
		padding: 0;
		line-height: 1.1;
		font-size: 10px;
	}
	.coil-print .info-row + .info-row {
		margin-top: 1px;
	}
	.coil-print .info-left,
	.coil-print .info-center,
	.coil-print .info-right {
		display: table-cell;
		vertical-align: top;
		margin: 0;
		padding: 0;
		line-height: 1.1;
		white-space: normal;
		word-break: break-word;
	}
	.coil-print .info-left { text-align: left; padding-right: 8px; }
	.coil-print .info-center { text-align: center; padding-left: 4px; padding-right: 4px; }
	.coil-print .info-right { text-align: right; padding-left: 8px; }
	.coil-print .coil-lbl { font-weight: 500; color: #64748b; }
	.coil-print .coil-val { font-weight: 700; color: #0f172a; }
	.coil-print .section-title {
		font-size: 11px;
		font-weight: 800;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: #1e3a5f;
		margin: 6px 0 4px;
		padding: 4px 8px;
		background: #eef4fb;
		border-left: 4px solid #1e40af;
	}
	.coil-print .items {
		width: 100%;
		border-collapse: collapse;
		table-layout: auto;
		font-size: 10px;
	}
	.coil-print .items th,
	.coil-print .items td {
		border: 1px solid #94a3b8;
		padding: 4px 5px;
		font-size: 10px;
		line-height: 1.25;
		white-space: normal;
		word-break: break-word;
		overflow-wrap: anywhere;
		vertical-align: top;
	}
	.coil-print .items .col-compact {
		width: 1%;
		white-space: nowrap;
		text-align: center;
	}
	.coil-print .items .col-medium { width: 1%; white-space: nowrap; }
	.coil-print .items .col-wrap { min-width: 48px; }
	.coil-print .items .col-tag { min-width: 88px; }
	.coil-print .items th {
		background: #1e3a5f;
		color: #fff;
		font-weight: 700;
		text-transform: uppercase;
		font-size: 9px;
		-webkit-print-color-adjust: exact;
		print-color-adjust: exact;
	}
	.coil-print .items tbody tr:nth-child(even) { background: #f8fafc; }
	.coil-print .items .totals-row td {
		font-weight: 800;
		background: #eef4fb;
		border-top: 2px solid #1e3a5f;
	}
	.coil-print .items .totals-label { text-align: right; padding-right: 8px; }
	.coil-print .signatures { width: 100%; }
	.coil-print .signatures td {
		width: 25%;
		padding-top: 24px;
		text-align: center;
		vertical-align: bottom;
		border: none;
	}
	.coil-print .signatures .sign-line {
		border-top: 1px solid #334155;
		padding-top: 5px;
		font-size: 10px;
		font-weight: 700;
		color: #334155;
	}
</style>
"""
