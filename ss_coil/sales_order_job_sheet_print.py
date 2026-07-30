"""Sales Order Job Sheet — items, cutting scheme, and packing (not SS Coil job sheet)."""

from html import escape

import frappe
from frappe import _
from frappe.utils import cint, flt, getdate

from ss_coil.api import get_sales_order_cutting_scheme_report, get_stock_entry_sticker_logo_url
from ss_coil.job_sheet_print import _info_grid, _notes_row, _signature_row

ITEM_COLUMNS = (
	("item_label", "Item"),
	("qty", "Qty"),
	("tag_no", "Tag No"),
	("ref_no", "Ref No"),
	("dimension", "Dimension"),
	("specification", "Specification"),
	("mill", "Mill"),
	("operations", "Operations"),
	("estimated_wt", "Est WT"),
)

CUTTING_COLUMNS = (
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

PACKING_COLUMNS = (
	("item_label", "Item"),
	("tag_no", "Tag No"),
	("packing_type", "Packing Type"),
	("packing_weightsize", "Weight / Size"),
	("no_of_pack", "No Of Pack"),
	("packing_remarks", "Remarks"),
	("packing_comments", "Comments"),
)


def _esc(value):
	if value in (None, ""):
		return "—"
	return escape(str(value))


def _desk_link(route, label, label_text=None):
	text = label_text if label_text is not None else label
	return (
		f'<a href="/app/{escape(route)}/{escape(label)}" '
		f'style="color:#1d4ed8;font-weight:800;text-decoration:none;">{escape(text)}</a>'
	)


def _format_item_operations(item):
	parts = []
	for field, label in (
		("custom_slitter", "Slitter"),
		("custom_leveler", "Leveler"),
		("custom_reshearing", "Reshearing"),
	):
		value = item.get(field)
		if value in (None, ""):
			continue
		text = str(value).strip()
		if text.lower() == label.lower() or text in ("1", "Yes"):
			parts.append(label)
		else:
			parts.append(f"{label}: {text}")
	return " · ".join(parts) if parts else "—"


def _linked_stock_entry_names(doc):
	names = set()
	raw = doc.get("custom_source_stock_entries") or ""
	for part in raw.replace(";", ",").split(","):
		token = part.strip()
		if token:
			names.add(token)
	for item in doc.items or []:
		se = item.get("custom_source_stock_entry")
		if se:
			names.add(se)
	return sorted(names)


def _stock_entry_links_html(doc):
	entries = _linked_stock_entry_names(doc)
	if not entries:
		return "—"
	return " · ".join(_desk_link("stock-entry", name) for name in entries)


def _fmt_date(value):
	if not value:
		return "—"
	return escape(str(frappe.format(getdate(value), {"fieldtype": "Date"})))


def _fmt_float(value):
	if value in (None, ""):
		return "—"
	return escape(str(frappe.format(value, {"fieldtype": "Float"})))


def _knife(value):
	return "Yes" if cint(value) else "No"


def _render_table(columns, rows, empty_label="No rows"):
	if not rows:
		return (
			f'<div style="padding:14px;color:#64748b;font-size:12px;background:#f8fafc;'
			f'border:1px dashed #cbd5e1;border-radius:10px;">{escape(empty_label)}</div>'
		)

	head = "".join(
		f'<th style="padding:8px 10px;background:#1e3a5f !important;color:#f8fafc;font-size:10px;'
		f"font-weight:700;text-transform:uppercase;letter-spacing:.04em;border:1px solid #1e3a5f;"
		f'text-align:left;-webkit-print-color-adjust:exact;print-color-adjust:exact;">{escape(label)}</th>'
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
				"qty",
				"estimated_wt",
				"no_of_pack",
				"width",
				"strip",
				"lengthcut",
				"length",
				"total_sheets",
				"total_width",
				"tolerance_plus",
				"tolerance_minus",
			):
				cell_val = _fmt_float(val) if val not in (None, "") else "—"
			elif fieldname == "operations":
				cell_val = _esc(val) if val not in (None, "") else "—"
			else:
				cell_val = _esc(val)
			cells.append(
				f'<td style="padding:7px 10px;border:1px solid #e2e8f0;background:{bg} !important;'
				f'font-size:11px;color:#0f172a;-webkit-print-color-adjust:exact;print-color-adjust:exact;">{cell_val}</td>'
			)
		body_rows.append(f"<tr>{''.join(cells)}</tr>")

	return f"""
	<div style="overflow:auto;border-radius:12px;border:1px solid #cbd5e1;">
		<table class="ss-coil-so-job-sheet-data" style="width:100%;border-collapse:collapse;min-width:640px;">
			<thead><tr>{head}</tr></thead>
			<tbody>{"".join(body_rows)}</tbody>
		</table>
	</div>"""


def _section(title, body):
	return f"""
	<section style="margin-top:16px;width:100%;box-sizing:border-box;">
		<div style="font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.08em;color:#1e3a5f;
			margin-bottom:8px;padding-bottom:6px;border-bottom:2px solid #1e3a5f;">{escape(title)}</div>
		{body}
	</section>"""


def _so_items(doc):
	rows = []
	for item in doc.items:
		rows.append(
			{
				"item_label": item.item_name or item.item_code or item.name,
				"qty": flt(item.qty),
				"tag_no": item.get("custom_tag_no"),
				"ref_no": item.get("custom_ref_no"),
				"dimension": item.get("custom_dimension"),
				"specification": item.get("custom_specification"),
				"mill": item.get("custom_mill"),
				"operations": _format_item_operations(item),
				"estimated_wt": item.get("custom_estimated_wt"),
			}
		)
	return rows


def _so_packing(doc):
	"""Packing rows for Job Sheet print — prefer Coil Production (raw)."""
	rows = []
	try:
		from ss_coil.coil_production import get_coil_production_rows, sales_order_has_coil_production

		if sales_order_has_coil_production(doc):
			for prod in get_coil_production_rows(doc):
				if not any(
					prod.get(field)
					for field in (
						"packing_type",
						"packing_weightsize",
						"no_of_pack",
						"packing_remarks",
						"packing_comments",
					)
				):
					continue
				raw_item = prod.get("raw_material_item") or prod.get("item_name") or prod.get("finish_good_item")
				rows.append(
					{
						"item_label": raw_item,
						"tag_no": prod.get("raw_material_tag_no") or prod.get("tag_no"),
						"packing_type": prod.get("packing_type"),
						"packing_weightsize": prod.get("packing_weightsize"),
						"no_of_pack": prod.get("no_of_pack"),
						"packing_remarks": prod.get("packing_remarks"),
						"packing_comments": prod.get("packing_comments"),
					}
				)
			return rows
	except Exception:
		pass

	for item in doc.items:
		if not any(
			item.get(field)
			for field in (
				"custom_packing_type",
				"custom_packing_weightsize",
				"custom_no_of_pack",
				"custom_packing_remarks",
				"custom_packing_comments",
			)
		):
			continue
		rows.append(
			{
				"item_label": item.item_name or item.item_code,
				"tag_no": item.get("custom_tag_no"),
				"packing_type": item.get("custom_packing_type"),
				"packing_weightsize": item.get("custom_packing_weightsize"),
				"no_of_pack": item.get("custom_no_of_pack"),
				"packing_remarks": item.get("custom_packing_remarks"),
				"packing_comments": item.get("custom_packing_comments"),
			}
		)
	return rows


def _so_item_job_sheet_fields(sales_order_item):
	if not sales_order_item:
		return frappe._dict()
	if isinstance(sales_order_item, str):
		if not frappe.db.exists("Sales Order Item", sales_order_item):
			return frappe._dict()
		return frappe.get_doc("Sales Order Item", sales_order_item)
	return sales_order_item


def _job_sheet_prep_grid(item):
	item = _so_item_job_sheet_fields(item)
	return _info_grid(
		[
			("Machine", item.get("custom_machine")),
			("Calc Ratio", item.get("custom_calc_ratio")),
			("Calc Ratio 2", item.get("custom_calc_ratio_2")),
			("Actual Ratio", item.get("custom_actual_ratio")),
			("Remaining Width", item.get("custom_remaining_width")),
		]
	)


def _job_sheet_dimension_grid(item, doc=None):
	item = _so_item_job_sheet_fields(item)

	def _pick(item_key, header_key):
		val = item.get(item_key)
		if val not in (None, ""):
			return val
		return doc.get(header_key) if doc else None

	return _info_grid(
		[
			("Width", _pick("custom_width", "custom_job_sheet_width")),
			("DS", _pick("custom_ds", "custom_job_sheet_ds")),
			("CTR", _pick("custom_ctr", "custom_job_sheet_ctr")),
			("WS", _pick("custom_ws", "custom_job_sheet_ws")),
		]
	)


def _job_sheet_mill_grid(item, doc=None):
	item = _so_item_job_sheet_fields(item)

	def _pick(item_key, header_key):
		val = item.get(item_key)
		if val not in (None, ""):
			return val
		return doc.get(header_key) if doc else None

	return _info_grid(
		[
			("Mill", _pick("custom_mill", "custom_job_sheet_mill")),
			("Specifications", _pick("custom_specification", "custom_job_sheet_specifications")),
			("Commodity", _pick("custom_commodity", "custom_job_sheet_commodity")),
			("Works", _pick("custom_works", "custom_job_sheet_works")),
		]
	 )


def _job_sheet_notes_block(item, doc=None):
	item = _so_item_job_sheet_fields(item)
	special = item.get("custom_comments")
	remarks = item.get("custom_remarks")
	if doc:
		if special in (None, ""):
			special = doc.get("custom_job_sheet_special_instructions")
		if remarks in (None, ""):
			remarks = doc.get("custom_job_sheet_remarks")
	return _notes_row(special, remarks)


def _so_cutting_sections(sales_order, doc=None):
	if doc is None:
		doc = frappe.get_doc("Sales Order", sales_order)
	groups = get_sales_order_cutting_scheme_report(sales_order) or []
	if not groups:
		first_item = (doc.items or [None])[0]
		body = (
			f'<div style="margin-bottom:10px;">{_job_sheet_prep_grid(first_item)}</div>'
			+ _render_table(CUTTING_COLUMNS, [], "No cutting scheme saved yet.")
			+ _section("Notes", _job_sheet_notes_block(first_item, doc))
			+ _section("Dimensions", _job_sheet_dimension_grid(first_item, doc))
			+ _section("Mill &amp; Product", _job_sheet_mill_grid(first_item, doc))
		)
		return _section("Cutting Scheme", body)

	parts = []
	for group in groups:
		label = group.get("item_label") or group.get("sales_order_item") or "Item"
		meta = (
			f'<div style="font-size:11px;font-weight:700;color:#475569;margin-bottom:8px;">'
			f"{_esc(label)} · Qty: {_fmt_float(group.get('qty'))} · "
			f"Tag: {_esc(group.get('tag_no'))} · Dim: {_esc(group.get('dimension'))}</div>"
		)
		rows = []
		for row in group.get("rows") or []:
			rows.append(
				{
					"seq": row.get("seq"),
					"width": row.get("width"),
					"strip": row.get("strip"),
					"lengthcut": row.get("lengthcut"),
					"length": row.get("length"),
					"total_sheets": row.get("total_sheets"),
					"total_width": row.get("total_width"),
					"tolerance_plus": row.get("tolerance_plus"),
					"tolerance_minus": row.get("tolerance_minus"),
					"knife": row.get("knife"),
				}
			)
		item_key = group.get("sales_order_item")
		parts.append(
			f'<div style="margin-bottom:18px;">{meta}'
			f'<div style="margin-bottom:10px;">{_job_sheet_prep_grid(item_key)}</div>'
			f"{_render_table(CUTTING_COLUMNS, rows, 'No rows')}"
			f'{_section("Notes", _job_sheet_notes_block(item_key, doc))}'
			f'{_section("Dimensions", _job_sheet_dimension_grid(item_key, doc))}'
			f'{_section("Mill &amp; Product", _job_sheet_mill_grid(item_key, doc))}'
			f"</div>"
		)
	return _section("Cutting Scheme", "".join(parts))


def build_sales_order_job_sheet_html(doc):
	if isinstance(doc, str):
		doc = frappe.get_doc("Sales Order", doc)

	company = doc.company
	company_name = frappe.get_cached_value("Company", company, "company_name") if company else "—"
	logo_url = get_stock_entry_sticker_logo_url(company)
	if logo_url and logo_url.startswith("/"):
		logo_url = frappe.utils.get_url(logo_url)
	logo_html = ""
	if logo_url:
		logo_html = (
			f'<img class="ss-coil-job-sheet-header-logo-img" src="{escape(logo_url)}" alt="Logo" '
			f'style="height:48px;width:auto;max-width:280px;object-fit:contain;display:block;">'
		)

	header_title_style = (
		"font-size:24px;font-weight:900;color:#1e3a5f;line-height:1.1;"
		"letter-spacing:.02em;text-transform:uppercase;"
	)
	for_customer = doc.get("custom_for_customer") or "—"

	print_css = """
	<style>
		.ss-coil-so-job-sheet-root,
		.ss-coil-so-job-sheet-root * {
			-webkit-print-color-adjust: exact !important;
			print-color-adjust: exact !important;
		}
		.ss-coil-so-job-sheet-root .ss-coil-job-sheet-company,
		.ss-coil-so-job-sheet-root .ss-coil-job-sheet-operation {
			font-size: 24px !important;
			font-weight: 900 !important;
			line-height: 1.1 !important;
			color: #1e3a5f !important;
		}
		@media print {
			.ss-coil-so-job-sheet-print-bar { display: none !important; }
		}
		.ss-coil-so-job-sheet-root .ss-coil-job-sheet-header-logo-img {
			height: 48px !important;
			max-height: 48px !important;
			max-width: 280px !important;
		}
	</style>"""

	print_bar = f"""
		<div class="ss-coil-so-job-sheet-print-bar" style="display:flex;justify-content:flex-end;margin-bottom:12px;">
			<button type="button" class="btn btn-primary btn-sm ss-coil-print-so-job-sheet" style="font-weight:700;">
				{escape(_("Print"))}
			</button>
		</div>"""

	header = f"""
		<table class="ss-coil-job-sheet-header" style="width:100%;border-collapse:collapse;border-bottom:3px solid #1e3a5f;margin-bottom:14px;table-layout:fixed;">
			<tr>
				<td style="width:48%;vertical-align:middle;padding:0 12px 12px 0;">
					<table class="ss-coil-job-sheet-brand-table" style="border-collapse:collapse;width:100%;"><tr>
						<td class="ss-coil-job-sheet-brand-logo-cell" style="padding-right:10px;vertical-align:middle;">{logo_html}</td>
						<td style="vertical-align:middle;white-space:nowrap;">
							<div class="ss-coil-job-sheet-company" style="{header_title_style}">{_esc(company_name)}</div>
						</td>
					</tr></table>
				</td>
				<td style="width:28%;text-align:center;vertical-align:middle;padding:0 8px 12px;">
					<div class="ss-coil-job-sheet-operation" style="{header_title_style}">Sales Order</div>
					<div style="margin-top:4px;font-size:11px;color:#64748b;font-weight:700;text-transform:uppercase;letter-spacing:.08em;">Job Sheet</div>
				</td>
				<td style="width:24%;">&nbsp;</td>
			</tr>
		</table>
		<table style="width:100%;border-collapse:collapse;table-layout:fixed;margin-bottom:4px;">
			<tr>
				<td style="width:25%;padding:8px;background:#f1f5f9;border:1px solid #e2e8f0;border-radius:8px 0 0 8px;">
					<span style="font-size:9px;font-weight:700;color:#64748b;text-transform:uppercase;">Order No</span>
					<div style="font-size:13px;font-weight:800;">{_esc(doc.name)}</div>
				</td>
				<td style="width:25%;padding:8px;background:#f1f5f9;border:1px solid #e2e8f0;border-left:none;">
					<span style="font-size:9px;font-weight:700;color:#64748b;text-transform:uppercase;">Date</span>
					<div style="font-size:13px;font-weight:800;">{_fmt_date(doc.transaction_date)}</div>
				</td>
				<td style="width:25%;padding:8px;background:#f1f5f9;border:1px solid #e2e8f0;border-left:none;">
					<span style="font-size:9px;font-weight:700;color:#64748b;text-transform:uppercase;">Customer</span>
					<div style="font-size:13px;font-weight:800;">{_esc(doc.customer_name)}</div>
				</td>
				<td style="width:25%;padding:8px;background:#f1f5f9;border:1px solid #e2e8f0;border-left:none;border-radius:0 8px 8px 0;">
					<span style="font-size:9px;font-weight:700;color:#64748b;text-transform:uppercase;">For Customer</span>
					<div style="font-size:13px;font-weight:800;">{_esc(for_customer)}</div>
				</td>
			</tr>
		</table>
		<table style="width:100%;border-collapse:collapse;table-layout:fixed;margin-bottom:4px;">
			<tr>
				<td style="width:50%;padding:8px;background:#eef2ff;border:1px solid #c7d2fe;border-radius:8px 0 0 8px;">
					<span style="font-size:9px;font-weight:700;color:#64748b;text-transform:uppercase;">Sales Order</span>
					<div style="font-size:13px;font-weight:800;">{_desk_link("sales-order", doc.name)}</div>
				</td>
				<td style="width:50%;padding:8px;background:#eef2ff;border:1px solid #c7d2fe;border-left:none;border-radius:0 8px 8px 0;">
					<span style="font-size:9px;font-weight:700;color:#64748b;text-transform:uppercase;">Linked Stock Entry</span>
					<div style="font-size:13px;font-weight:800;line-height:1.5;">{_stock_entry_links_html(doc)}</div>
				</td>
			</tr>
		</table>"""

	body = (
		_section("Order Items", _render_table(ITEM_COLUMNS, _so_items(doc), "No order items."))
		+ _so_cutting_sections(doc.name, doc)
		+ _section(
			"Signatures",
			_signature_row(
				[
					("Planning", doc.get("custom_job_sheet_planning")),
					("Sales", doc.get("custom_job_sheet_sales")),
					("Production", doc.get("custom_job_sheet_production")),
					("Encoded By", doc.get("custom_job_sheet_encoded_by")),
				]
			),
		)
		+ _section("Packing", _render_table(PACKING_COLUMNS, _so_packing(doc), "No packing detail yet."))
	)

	return f"""
	{print_css}
	<div class="ss-coil-so-job-sheet-root ss-coil-job-sheet-root" style="font-family:Inter,'Segoe UI',Arial,sans-serif;color:#0f172a;background:#fff;border:1px solid #e2e8f0;border-radius:16px;padding:20px 22px;width:100%;box-sizing:border-box;">
		{print_bar}
		{header}
		{body}
	</div>"""


@frappe.whitelist()
def get_sales_order_job_sheet_html(sales_order):
	if not sales_order or not frappe.db.exists("Sales Order", sales_order):
		frappe.throw(_("Sales Order not found"))
	return build_sales_order_job_sheet_html(sales_order)
