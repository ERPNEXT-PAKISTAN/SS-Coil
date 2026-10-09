"""Portrait inspection sheets, preserving the two reference layouts."""
from html import escape

import frappe
from frappe.utils import formatdate

from ss_coil.inspection_setup import get_inspection_context

FORM1_FIELDS = (
    "thickness_head_ds", "thickness_head_c", "thickness_head_ws",
    "thickness_tail_ds", "thickness_tail_c", "thickness_tail_ws",
    "width_head_end", "width_center", "width_tail_end",
    "burr_head_ds_1", "burr_tail_ws_1", "burr_head_ds_2", "burr_tail_ws_2",
    "camber", "api_st",
)
FORM2_GROUPS = (
    ("Thickness (mm)", (("thickness_ds", "DS"), ("thickness_c", "C"), ("thickness_ws", "WS"))),
    ("Width (mm)", (("width_head", "Head"), ("width_tail", "Tail"))),
    ("Length (mm)", (("length_l1", "L1"), ("length_l2", "L2"))),
    ("Diagonal (mm)", (("diagonal_a", "A"), ("diagonal_b", "B"), ("diagonal_difference", "A−B"))),
    ("Flatness (mm)", (("flatness_ds", "DS"), ("flatness_c", "C"), ("flatness_ws", "WS"))),
    ("Camber (mm)", (("camber", "C"),)),
    ("Burr (mm)", (("burr_thickness", "Thick (T)"), ("burr_cut", "Cut (C)"), ("burr_difference", "B=C−T"))),
    ("Appearance OK/NG", tuple(("appearance_" + name, name.title()) for name in
        ("dent", "pimple", "dimple", "bump", "scratch", "rust", "abrasion", "dirty", "stain", "passed", "reject"))),
)
PRINT_FORMATS = {"SS Coil Inspection 1": 1, "SS Coil Inspection 2": 2}


def _esc(value):
    return escape(str(value if value is not None else ""), quote=True)


def _value(value):
    if isinstance(value, (float, int)):
        return _esc(format(value, ".9f").rstrip("0").rstrip("."))
    return _esc(value)


def _date(value):
    return _esc(formatdate(value)) if value else ""


def _header(doc, context, form):
    prefix = f"inspection_{form}_"
    title = "Slitter Inspection Sheet" if form == 1 else "Slitter Inspection Sheet Report"
    logo = context.get("logo_url")
    logo_html = f'<img class="inspection-logo" src="{_esc(logo)}">' if logo else ""
    company = f'<table class="inspection-company"><tr><td>{logo_html}<strong>{_esc(context.get("company_name"))}</strong><br>{_esc(context.get("company_address"))}<br>{_esc(context.get("company_phone"))}</td><td class="inspection-title">{title}</td></tr></table>'
    size = " × ".join(str(context.get(key) if context.get(key) is not None else "") for key in ("thickness", "width", "length"))
    tags = ", ".join(str(row.get("tag_no")) for row in (doc.get("input_coil") or []) if row.get("tag_no"))
    labels = (("Customer", context.get("customer") or doc.get("customer_name") or doc.get("for_customer")),
              ("Specs", context.get("specs")), ("Size (mm)", size),
              ("P/O No.", context.get("po_no")), ("J/S No.", doc.name), ("Coil/Tag No.", tags))
    details = '<table class="inspection-details">' + "".join(f'<tr><th>{label}</th><td>{_esc(value)}</td></tr>' for label, value in labels) + '</table>'
    groups = [("Thickness (mm)", ("thickness_min", "thickness_max")), ("Width (mm)", ("width_min", "width_max"))]
    if form == 1:
        groups += [("Weight (kg)", ("weight_min", "weight_max")), ("Burr Height (mm)", ("burr_max",))]
    else:
        groups += [("Length (mm)", ("length_min", "length_max")), ("Burr Height", ("burr_max",)), ("Edge Wave", ("edge_wave_max",)), ("Camber (mm)", ("camber_max",))]
    count = sum(len(fields) for _, fields in groups)
    tolerances = f'<table class="inspection-tolerances"><thead><tr><th colspan="{count}">Tolerances</th></tr><tr>'
    tolerances += "".join(f'<th colspan="{len(fields)}">{label}</th>' for label, fields in groups) + '</tr><tr>'
    tolerances += "".join('<th>Min.</th><th>Max.</th>' if len(fields) == 2 else '<th>Max.</th>' for _, fields in groups) + '</tr></thead><tbody><tr>'
    tolerances += "".join(f'<td>{_value(doc.get(prefix + field))}</td>' for _, fields in groups for field in fields) + '</tr></tbody></table>'
    return company + f'<table class="inspection-heading"><tr><td style="width:35%">{details}</td><td>{tolerances}</td></tr></table>'


def _footer(doc, form):
    prefix = f"inspection_{form}_"
    return (f'<div class="inspection-remarks"><strong>Remarks:</strong> {_esc(doc.get(prefix + "remarks"))}</div>'
            '<table class="inspection-signatures"><tr>'
            f'<td>Inspected By: {_esc(doc.get(prefix + "inspected_by"))}</td><td>Checked By: {_esc(doc.get(prefix + "checked_by"))}</td></tr><tr>'
            f'<td>Date: {_date(doc.get(prefix + "inspected_date"))}</td><td>Date: {_date(doc.get(prefix + "checked_date"))}</td></tr></table>')


def _form1(rows, offset):
    result = ['<table class="inspection-measurements"><thead><tr><th colspan="16">Measurements</th></tr>',
        '<tr><th rowspan="3">#<br>From DS</th><th colspan="6">Thickness (mm)</th><th colspan="3">Width (mm)</th><th colspan="4">Burr (mm)</th><th rowspan="3">Camber</th><th rowspan="3">API<br>St</th></tr>',
        '<tr><th colspan="3">Head End</th><th colspan="3">Tail End</th><th rowspan="2">Head<br>End</th><th rowspan="2">Center</th><th rowspan="2">Tail<br>End</th><th>Head</th><th>Tail</th><th>Head</th><th>Tail</th></tr>',
        '<tr><th>DS</th><th>C</th><th>WS</th><th>DS</th><th>C</th><th>WS</th><th>DS</th><th>WS</th><th>DS</th><th>WS</th></tr></thead><tbody>']
    for index in range(max(32, len(rows))):
        row = rows[index] if index < len(rows) else {}
        result.append(f'<tr><td>{offset + index + 1}</td>' + ''.join(f'<td>{_value(row.get(field))}</td>' for field in FORM1_FIELDS) + '</tr>')
    result.append('</tbody></table>')
    return ''.join(result)


def _form2(rows, offset):
    result = ['<table class="inspection-measurements inspection-checkpoints"><thead><tr><th colspan="2">Check Point</th>']
    result.extend(f'<th>{offset + index + 1}</th>' for index in range(8))
    result.append('</tr></thead><tbody>')
    for group, fields in FORM2_GROUPS:
        for position, (field, label) in enumerate(fields):
            result.append('<tr>')
            if position == 0:
                result.append(f'<th class="checkpoint-group" rowspan="{len(fields)}">{group}</th>')
            result.append(f'<th class="checkpoint-label">{label}</th>')
            result.extend(f'<td>{_value(rows[index].get(field)) if index < len(rows) else ""}</td>' for index in range(8))
            result.append('</tr>')
    result.append('</tbody></table>')
    return ''.join(result)


def build_inspection_print_html(doc, form=1):
    form = int(form)
    if form not in (1, 2):
        frappe.throw("Invalid inspection form")
    if isinstance(doc, str):
        doc = frappe.get_doc("SS Coil", doc)
    doc.check_permission("read")
    context = get_inspection_context(ss_coil=doc.name)
    rows = doc.get("custom_slitter_inspection_sheet_1" if form == 1 else "slitter_inspection_sheet_2") or []
    size = 32 if form == 1 else 8
    pages = []
    for offset in range(0, max(len(rows), 1), size):
        measurements = _form1(rows[offset:offset + size], offset) if form == 1 else _form2(rows[offset:offset + size], offset)
        pages.append('<section class="inspection-print-page">' + _header(doc, context, form) + measurements + _footer(doc, form) + '</section>')
    return ''.join(pages)
