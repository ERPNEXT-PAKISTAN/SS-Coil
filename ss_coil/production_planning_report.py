"""Shared builders for Production Planning script reports (Sales Order & SS Coil)."""

from html import escape

import frappe
from frappe import _
from frappe.utils import cint, flt

# Strip / SEQ colors for cutting scheme rows (visual planning view).
SCHEME_COLORS = (
	"#2f6df6",
	"#18a957",
	"#ff8d1f",
	"#7c3aed",
	"#e11d48",
	"#0891b2",
	"#ca8a04",
	"#6366f1",
	"#0d9488",
	"#db2777",
)

SO_ITEM_PRODUCT_FIELDS = (
	("item_code", _("Item Code")),
	("item_name", _("Item Name")),
	("qty", _("Qty")),
	("custom_tag_no", _("Tag No")),
	("custom_dimension", _("Dimension")),
	("custom_specification", _("Specification")),
	("custom_thickness", _("Thickness")),
	("custom_width", _("Width")),
	("custom_length_c", _("Length C")),
	("custom_length", _("Length")),
	("custom_qty_of_coil", _("Qty of Coil")),
	("custom_mill", _("Mill")),
	("custom_ref_no", _("Ref No")),
	("custom_commodity", _("Commodity")),
	("custom_condition", _("Condition")),
	("custom_estimated_wt", _("Estimated Wt")),
	("custom_po_no", _("PO No")),
	("custom_remarks", _("Remarks")),
	("custom_comments", _("Comments")),
	("custom_packing_type", _("Packing Type")),
	("custom_packing_weightsize", _("Packing Weight/Size")),
)

CUTTING_SCHEME_COLUMNS = (
	("seq", _("SEQ")),
	("width", _("Width")),
	("strip", _("Strip")),
	("lengthcut", _("LengthCut")),
	("total_width", _("Total Width")),
	("tolerance_plus", _("Tol (+)")),
	("tolerance_minus", _("Tol (-)")),
	("knife", _("Knife")),
)

COIL_SO_FIELDS = (
	("tag_no", _("Tag No")),
	("item_name", _("Item Name")),
	("specification", _("Specification")),
	("thickness", _("Thickness")),
	("width", _("Width")),
	("length", _("Length")),
	("qty", _("Qty")),
	("estimated_wt", _("Estimated Wt")),
	("mill", _("Mill")),
	("ref_no", _("Ref No")),
	("condition", _("Condition")),
)

COIL_INPUT_FIELDS = (
	("tag_no", _("Tag No")),
	("class", _("Class")),
	("dimension", _("Dimension")),
	("width", _("Width")),
	("length", _("Length")),
	("estimated_qty", _("Est Qty")),
	("estimated_wt", _("Est Wt")),
	("actual_qty", _("Actual Qty")),
	("actual_wt", _("Actual Wt")),
	("next_process", _("Next Process")),
)

COIL_OUTPUT_FIELDS = (
	("tag_no", _("Tag No")),
	("class", _("Class")),
	("customer", _("Customer")),
	("thickness", _("Thickness")),
	("width", _("Width")),
	("length", _("Length")),
	("estimated_qty", _("Est Qty")),
	("actual_qty", _("Actual Qty")),
	("packing_type", _("Packing Type")),
	("next_process", _("Next Process")),
)


def get_report_columns():
	return [
		{"fieldname": "row_type", "fieldtype": "Data", "hidden": 1, "width": 80},
		{"fieldname": "section_title", "fieldtype": "Data", "label": _("Section"), "width": 220},
		{"fieldname": "label", "fieldtype": "Data", "label": _("Field / SEQ"), "width": 160},
		{"fieldname": "value", "fieldtype": "Data", "label": _("Value"), "width": 200},
		{"fieldname": "color", "fieldtype": "Data", "label": _("Color"), "width": 90},
		{"fieldname": "width", "fieldtype": "Float", "label": _("Width"), "width": 80},
		{"fieldname": "strip", "fieldtype": "Float", "label": _("Strip"), "width": 70},
		{"fieldname": "lengthcut", "fieldtype": "Float", "label": _("LengthCut"), "width": 90},
		{"fieldname": "total_width", "fieldtype": "Float", "label": _("Total Width"), "width": 100},
		{"fieldname": "tolerance_plus", "fieldtype": "Float", "label": _("Tol (+)"), "width": 80},
		{"fieldname": "tolerance_minus", "fieldtype": "Float", "label": _("Tol (-)"), "width": 80},
		{"fieldname": "knife", "fieldtype": "Data", "label": _("Knife"), "width": 70},
		{"fieldname": "detail_1", "fieldtype": "Data", "label": _("Detail 1"), "width": 120},
		{"fieldname": "detail_2", "fieldtype": "Data", "label": _("Detail 2"), "width": 120},
		{"fieldname": "detail_3", "fieldtype": "Data", "label": _("Detail 3"), "width": 120},
		{"fieldname": "detail_4", "fieldtype": "Data", "label": _("Detail 4"), "width": 120},
		{"fieldname": "detail_5", "fieldtype": "Data", "label": _("Detail 5"), "width": 120},
	]


def _scheme_color(index):
	return SCHEME_COLORS[cint(index) % len(SCHEME_COLORS)]


def _row_base(**kwargs):
	row = {
		"row_type": "",
		"section_title": "",
		"label": "",
		"value": "",
		"color": "",
		"width": None,
		"strip": None,
		"lengthcut": None,
		"total_width": None,
		"tolerance_plus": None,
		"tolerance_minus": None,
		"knife": "",
		"detail_1": "",
		"detail_2": "",
		"detail_3": "",
		"detail_4": "",
		"detail_5": "",
	}
	row.update(kwargs)
	return row


def _append_section(data, title):
	data.append(_row_base(row_type="section", section_title=title))


def _append_blank(data):
	data.append(_row_base(row_type="blank"))


def _append_kv_rows(data, mapping):
	for label, value in mapping:
		if value in (None, ""):
			continue
		data.append(_row_base(row_type="kv", label=str(label), value=str(value)))


def _append_field_rows(data, doc, field_defs):
	if isinstance(doc, dict):
		row_doc = doc
	else:
		row_doc = frappe._dict(doc.as_dict() if hasattr(doc, "as_dict") and callable(doc.as_dict) else {})
	pairs = []
	for fieldname, label in field_defs:
		val = row_doc.get(fieldname)
		if val in (None, ""):
			continue
		if fieldname == "knife":
			val = _("Yes") if cint(val) else _("No")
		pairs.append((label, val))
	_append_kv_rows(data, pairs)


def _append_cutting_scheme_table(data, rows, section_label=None):
	if section_label:
		_append_section(data, section_label)
	if not rows:
		data.append(_row_base(row_type="empty", label=_("No cutting scheme rows")))
		return

	data.append(
		_row_base(
			row_type="table_header",
			label=_("SEQ"),
			value=_("Width"),
			color=_("Color"),
			strip=None,
			lengthcut=None,
			total_width=None,
			tolerance_plus=None,
			tolerance_minus=None,
			knife=_("Knife"),
		)
	)

	for index, row in enumerate(rows):
		if not isinstance(row, dict):
			row = row.as_dict() if hasattr(row, "as_dict") and callable(row.as_dict) else frappe._dict(row)
		color = _scheme_color(index)
		data.append(
			_row_base(
				row_type="cutting_row",
				label=str(row.get("seq") or index + 1),
				value=str(row.get("width") or ""),
				color=color,
				width=flt(row.get("width")),
				strip=flt(row.get("strip")),
				lengthcut=flt(row.get("lengthcut")),
				total_width=flt(row.get("total_width")),
				tolerance_plus=flt(row.get("tolerance_plus")),
				tolerance_minus=flt(row.get("tolerance_minus")),
				knife=_("Yes") if cint(row.get("knife")) else _("No"),
			)
		)


def _append_generic_table(data, section_title, rows, field_defs):
	_append_section(data, section_title)
	if not rows:
		data.append(_row_base(row_type="empty", label=_("No rows")))
		return

	headers = [label for _, label in field_defs[:5]]
	data.append(
		_row_base(
			row_type="table_header",
			label=headers[0] if len(headers) > 0 else "",
			value=headers[1] if len(headers) > 1 else "",
			detail_1=headers[2] if len(headers) > 2 else "",
			detail_2=headers[3] if len(headers) > 3 else "",
			detail_3=headers[4] if len(headers) > 4 else "",
		)
	)

	for row in rows:
		if not isinstance(row, dict):
			row = row.as_dict() if hasattr(row, "as_dict") and callable(row.as_dict) else frappe._dict(row)
		values = [row.get(fieldname) for fieldname, _label in field_defs]
		while len(values) < 5:
			values.append("")
		data.append(
			_row_base(
				row_type="table_row",
				label=str(values[0] or ""),
				value=str(values[1] or ""),
				detail_1=str(values[2] or ""),
				detail_2=str(values[3] or ""),
				detail_3=str(values[4] or ""),
				detail_4=str(values[5] or "") if len(values) > 5 else "",
				detail_5=str(values[6] or "") if len(values) > 6 else "",
			)
		)


def _normalize_child_rows(rows):
	out = []
	for row in rows or []:
		if isinstance(row, dict):
			out.append(row)
		elif hasattr(row, "as_dict") and callable(row.as_dict):
			out.append(row.as_dict())
		else:
			out.append(frappe._dict(row))
	return out


def build_sales_order_production_planning(filters):
	filters = filters or {}
	sales_order = filters.get("sales_order")
	if not sales_order:
		frappe.throw(_("Sales Order is required"))

	doc = frappe.get_doc("Sales Order", sales_order)
	data = []

	_append_section(data, _("Sales Order — {0}").format(doc.name))
	_append_kv_rows(
		data,
		[
			(_("Customer"), doc.customer_name or doc.customer),
			(_("For Customer"), doc.get("custom_for_customer")),
			(_("Transaction Date"), doc.transaction_date),
			(_("Delivery Date"), doc.delivery_date),
			(_("Status"), doc.status),
			(_("Company"), doc.company),
		],
	)
	_append_blank(data)

	item_filters = {"parent": sales_order, "parenttype": "Sales Order", "parentfield": "items"}
	if filters.get("sales_order_item"):
		item_filters["name"] = filters.get("sales_order_item")

	so_items = frappe.get_all(
		"Sales Order Item",
		filters=item_filters,
		fields=["name"],
		order_by="idx asc",
	)

	if not so_items:
		data.append(_row_base(row_type="empty", label=_("No Sales Order items found")))
		return data

	for item_row in so_items:
		item = frappe.get_doc("Sales Order Item", item_row.name)
		_append_section(data, _("Product — {0}").format(item.item_name or item.item_code or item.name))
		_append_field_rows(data, item, SO_ITEM_PRODUCT_FIELDS)
		_append_blank(data)

		plan_fields = ["name", "process_key"] if frappe.db.has_column("SO Production Plan", "process_key") else ["name"]
		plan_rows = frappe.get_all(
			"SO Production Plan",
			filters={"sales_order": sales_order, "sales_order_item": item.name},
			fields=plan_fields,
			order_by="creation asc",
		)
		if not plan_rows:
			_append_cutting_scheme_table(
				data,
				[],
				section_label=_("Cutting Scheme — {0}").format(item.item_name or item.item_code),
			)
		else:
			for plan_row in plan_rows:
				plan = frappe.get_doc("SO Production Plan", plan_row.name)
				pk = plan.get("process_key") or "slitter"
				label = _("Cutting Scheme — {0} ({1})").format(
					item.item_name or item.item_code,
					pk.title(),
				)
				_append_cutting_scheme_table(data, _normalize_child_rows(plan.cutting_scheme), section_label=label)
		_append_blank(data)

		ss_coils = frappe.get_all(
			"SS Coil",
			filters={"sales_order_item": item.name},
			fields=["name", "operation", "order_status"],
			order_by="creation asc",
		)
		if ss_coils:
			_append_section(data, _("Linked SS Coil Jobs"))
			for coil in ss_coils:
				data.append(
					_row_base(
						row_type="kv",
						label=_("SS Coil"),
						value=f"{coil.name} | {coil.operation or '-'} | {coil.order_status or '-'}",
					)
				)
			_append_blank(data)

	return data


def _doc_field(doc, fieldname, default=None):
	if isinstance(doc, dict):
		return doc.get(fieldname, default)
	if hasattr(doc, "get"):
		return doc.get(fieldname, default)
	return getattr(doc, fieldname, default)


def _ss_coil_header_thickness(doc):
	for row in _normalize_child_rows(_doc_field(doc, "so_item") or []):
		if row.get("thickness") not in (None, ""):
			return row.get("thickness")
	for row in _normalize_child_rows(_doc_field(doc, "input_coil") or []):
		if row.get("thickness") not in (None, ""):
			return row.get("thickness")
	for row in _normalize_child_rows(_doc_field(doc, "job_output") or []):
		if row.get("thickness") not in (None, ""):
			return row.get("thickness")
	return None


def build_ss_coil_production_planning(filters):
	filters = filters or {}
	ss_coil = filters.get("ss_coil") or filters.get("name")
	if not ss_coil:
		frappe.throw(_("SS Coil is required"))

	doc = frappe.get_doc("SS Coil", ss_coil)
	data = []

	_append_section(data, _("SS Coil — {0}").format(doc.name))
	_append_kv_rows(
		data,
		[
			(_("Operation"), _doc_field(doc, "operation")),
			(_("Order Status"), _doc_field(doc, "order_status")),
			(_("Sales Order"), _doc_field(doc, "order_no")),
			(_("Customer"), _doc_field(doc, "customer_name")),
			(_("For Customer"), _doc_field(doc, "for_customer")),
			(_("Sales Order Item"), _doc_field(doc, "sales_order_item")),
			(_("Stock Entry"), _doc_field(doc, "stock_entry")),
			(_("Machine"), _doc_field(doc, "machine")),
			(_("Calc Ratio"), _doc_field(doc, "calc_ratio")),
			(_("Actual Ratio"), _doc_field(doc, "actual_ratio")),
			(_("Remaining Width"), _doc_field(doc, "remaining_width")),
			(_("Grand Total Width"), _doc_field(doc, "grand_total_width")),
			(_("Thickness"), _ss_coil_header_thickness(doc)),
			(_("Width"), _doc_field(doc, "width")),
			(_("Mill"), _doc_field(doc, "mill")),
			(_("Specifications"), _doc_field(doc, "specifications")),
			(_("Commodity"), _doc_field(doc, "commodity")),
			(_("Special Instructions"), _doc_field(doc, "special_instructions")),
			(_("Remarks"), _doc_field(doc, "remarks")),
		],
	)
	_append_blank(data)

	_append_generic_table(
		data,
		_("Sales Order Item (Coil SO)"),
		_normalize_child_rows(_doc_field(doc, "so_item") or []),
		COIL_SO_FIELDS,
	)
	_append_blank(data)

	cutting_rows = _normalize_child_rows(_doc_field(doc, "cutting_detail") or [])
	if not cutting_rows and _doc_field(doc, "sales_order_item"):
		from ss_coil.api import get_so_production_plan_rows

		cutting_rows = get_so_production_plan_rows(_doc_field(doc, "sales_order_item")) or []

	_append_cutting_scheme_table(data, cutting_rows, section_label=_("Cutting Scheme / Cutting Detail"))
	_append_blank(data)

	_append_generic_table(
		data,
		_("Input Coil"),
		_normalize_child_rows(_doc_field(doc, "input_coil") or []),
		COIL_INPUT_FIELDS,
	)
	_append_blank(data)

	_append_generic_table(
		data,
		_("Job Output"),
		_normalize_child_rows(_doc_field(doc, "job_output") or []),
		COIL_OUTPUT_FIELDS,
	)

	return data


def color_swatch_html(hex_color):
	if not hex_color:
		return ""
	safe = escape(str(hex_color))
	return (
		f'<span style="display:inline-block;width:18px;height:18px;border-radius:4px;'
		f"background:{safe};border:1px solid #cbd5e1;vertical-align:middle;"
		f'margin-right:6px;"></span>{safe}'
	)
