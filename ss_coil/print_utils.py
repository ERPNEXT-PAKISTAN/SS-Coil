"""Hooked into Frappe's PDF generation (`pdf_body_html` in hooks.py) to
pre-render the Stock Entry sticker sheet server-side and inject it as
`sticker_print_html`, so the PDF path and the browser print-preview path
(which falls back to an inline Jinja loop in the print format templates)
render identically. See ARCHITECTURE.md > "Sticker / QR printing".
"""

import frappe
from frappe.utils.pdf import pdf_body_html as fw_pdf_body_html

from ss_coil.api import (
	_get_sticker_print_options,
	build_ss_coil_sticker_sheet_html,
	build_stock_entry_sticker_sheet_html,
)
from ss_coil.coil_print import DETAIL_PRINT_FORMATS, build_coil_detail_print_html
from ss_coil.delivery_advise_print import (
	DELIVERY_ADVISE_PRINT_FORMATS,
	build_delivery_advise_print_html,
)
from ss_coil.job_sheet_print import build_ss_coil_job_sheet_html

STICKER_PRINT_FORMATS = (
	"Stock Entry Sticker",
	"Stock Entry Sticker Thermal",
	"SS Coil Sticker",
	"SS Coil Sticker Thermal",
)
STOCK_ENTRY_STICKER_FORMATS = frozenset({"Stock Entry Sticker", "Stock Entry Sticker Thermal"})
SS_COIL_STICKER_FORMATS = frozenset({"SS Coil Sticker", "SS Coil Sticker Thermal"})
DETAIL_PRINT_FORMAT_NAMES = frozenset(DETAIL_PRINT_FORMATS.values())
DELIVERY_ADVISE_PRINT_FORMAT_NAMES = frozenset(DELIVERY_ADVISE_PRINT_FORMATS.values())
SS_COIL_JOB_SHEET_FORMAT = "SS Coil Job Sheet"
SALES_CONTRACT_PRINT_FORMATS = frozenset({"Sales Contract", "Sales Contract No Letterhead"})


def pdf_body_html(jenv, template, print_format, args):
	_inject_sticker_print_html(print_format, args)
	_inject_coil_detail_print_html(print_format, args)
	_inject_delivery_advise_print_html(print_format, args)
	_inject_job_sheet_print_html(print_format, args)
	_inject_sales_contract_context(print_format, args)

	# Bypass Print Designer for formats that rely on injected context / custom Jinja.
	if print_format and print_format.name in (
		{SS_COIL_JOB_SHEET_FORMAT} | SALES_CONTRACT_PRINT_FORMATS
	):
		return fw_pdf_body_html(template, args)

	try:
		from print_designer.print_designer.pdf import pdf_body_html as pd_pdf_body_html

		return pd_pdf_body_html(print_format=print_format, jenv=jenv, args=args, template=template)
	except (ImportError, ModuleNotFoundError):
		return fw_pdf_body_html(template, args)


def _inject_sticker_print_html(print_format, args):
	if not print_format or print_format.name not in STICKER_PRINT_FORMATS:
		return

	doc = args.get("doc")
	if not doc:
		return

	settings = frappe.parse_json(frappe.form_dict.get("settings") or "{}")
	row_names, layout, has_filter = _get_sticker_print_options(print_format.name, settings)

	if print_format.name in STOCK_ENTRY_STICKER_FORMATS:
		if doc.doctype != "Stock Entry":
			return
		html = build_stock_entry_sticker_sheet_html(
			doc, item_names=row_names, layout=layout, filter_items=has_filter
		)
	elif print_format.name in SS_COIL_STICKER_FORMATS:
		if doc.doctype != "SS Coil":
			return
		html = build_ss_coil_sticker_sheet_html(
			doc, output_names=row_names, layout=layout, filter_items=has_filter
		)
	else:
		return

	args["sticker_print_html"] = html or ""
	args["selected_item_names"] = row_names or []
	args["filter_sticker_items"] = has_filter
	if html and hasattr(doc, "custom_sticker_print_html"):
		doc.custom_sticker_print_html = html


def _inject_coil_detail_print_html(print_format, args):
	if not print_format or print_format.name not in DETAIL_PRINT_FORMAT_NAMES:
		return

	doc = args.get("doc")
	if not doc:
		return

	html = build_coil_detail_print_html(doc)
	args["coil_detail_print_html"] = html or ""


def _inject_delivery_advise_print_html(print_format, args):
	if not print_format or print_format.name not in DELIVERY_ADVISE_PRINT_FORMAT_NAMES:
		return

	doc = args.get("doc")
	if not doc:
		return

	html = build_delivery_advise_print_html(doc)
	args["delivery_advise_print_html"] = html or ""


def _inject_job_sheet_print_html(print_format, args):
	if not print_format or print_format.name != SS_COIL_JOB_SHEET_FORMAT:
		return

	doc = args.get("doc")
	if not doc or doc.doctype != "SS Coil":
		return

	try:
		html = build_ss_coil_job_sheet_html(doc) or ""
	except Exception:
		frappe.log_error(title="SS Coil Job Sheet print failed")
		html = ""
	args["job_sheet_print_html"] = html


def _inject_sales_contract_context(print_format, args):
	"""Inject `sc` for Sales Contract print formats (avoids stale jinja method workers)."""
	if not print_format or print_format.name not in SALES_CONTRACT_PRINT_FORMATS:
		return

	doc = args.get("doc")
	if not doc or getattr(doc, "doctype", None) != "Sales Order":
		return

	from ss_coil.sales_contract_print import build_sales_contract_lines

	try:
		args["sc"] = build_sales_contract_lines(doc)
	except Exception:
		frappe.log_error(title="Sales Contract print failed")
		args["sc"] = {
			"rows": [],
			"gst_rate": 0,
			"total_qty": 0,
			"total_amount": 0,
			"total_gst": 0,
			"total_with_gst": 0,
		}
