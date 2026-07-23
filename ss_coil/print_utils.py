"""Hooked into Frappe's PDF generation (`pdf_body_html` in hooks.py) to
pre-render the Stock Entry sticker sheet server-side and inject it as
`sticker_print_html`, so the PDF path and the browser print-preview path
(which falls back to an inline Jinja loop in the print format templates)
render identically. See ARCHITECTURE.md > "Sticker / QR printing".
"""

import frappe
from frappe.utils.pdf import pdf_body_html as fw_pdf_body_html

from ss_coil.api import _get_sticker_print_options, build_stock_entry_sticker_sheet_html
from ss_coil.coil_print import DETAIL_PRINT_FORMATS, build_coil_detail_print_html
from ss_coil.delivery_advise_print import (
	DELIVERY_ADVISE_PRINT_FORMATS,
	build_delivery_advise_print_html,
)

STICKER_PRINT_FORMATS = ("Stock Entry Sticker", "Stock Entry Sticker Thermal")
DETAIL_PRINT_FORMAT_NAMES = frozenset(DETAIL_PRINT_FORMATS.values())
DELIVERY_ADVISE_PRINT_FORMAT_NAMES = frozenset(DELIVERY_ADVISE_PRINT_FORMATS.values())


def pdf_body_html(jenv, template, print_format, args):
	_inject_sticker_print_html(print_format, args)
	_inject_coil_detail_print_html(print_format, args)
	_inject_delivery_advise_print_html(print_format, args)

	try:
		from print_designer.print_designer.pdf import pdf_body_html as pd_pdf_body_html

		return pd_pdf_body_html(print_format=print_format, jenv=jenv, args=args, template=template)
	except ImportError:
		return fw_pdf_body_html(template, args)


def _inject_sticker_print_html(print_format, args):
	if not print_format or print_format.name not in STICKER_PRINT_FORMATS:
		return

	doc = args.get("doc")
	if not doc or doc.doctype != "Stock Entry":
		return

	settings = frappe.parse_json(frappe.form_dict.get("settings") or "{}")
	item_names, layout, has_filter = _get_sticker_print_options(print_format.name, settings)
	html = build_stock_entry_sticker_sheet_html(
		doc, item_names=item_names, layout=layout, filter_items=has_filter
	)
	args["sticker_print_html"] = html or ""
	args["selected_item_names"] = item_names or []
	args["filter_sticker_items"] = has_filter
	if html:
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
