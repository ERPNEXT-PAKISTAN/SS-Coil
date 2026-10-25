"""Promote inspection Custom Fields without renaming their stored columns."""
import json
from pathlib import Path

import frappe
from frappe import _


def sync_inspection_fields():
    definition = json.loads((Path(__file__).parent / 'ss_coil/doctype/ss_coil/ss_coil.json').read_text())
    order = definition['field_order']
    names = order[order.index('inspection_report_tab'):]
    for name in frappe.get_all('Custom Field', filters={'dt': 'SS Coil', 'fieldname': ['in', names]}, pluck='name'):
        frappe.delete_doc('Custom Field', name, ignore_permissions=True)
    # Field names and child-table parentfields stay unchanged; existing data is retained.
    for name in frappe.get_all('Property Setter', filters={'doc_type': 'SS Coil', 'property': 'field_order'}, pluck='name'):
        value = json.loads(frappe.db.get_value('Property Setter', name, 'value') or '[]')
        value = [field for field in value if field not in names] + names
        frappe.db.set_value('Property Setter', name, 'value', json.dumps(value), update_modified=False)
    # Keep persisted label overrides in sync with the process names in the DocType.
    for fieldname, label in (
        ('inspection_report_tab', 'Slitter Insp'),
        ('inspection_report_2_tab', 'Leveler Insp'),
        ('inspection_report_3_tab', 'Reshearing Insp'),
    ):
        setter = f'SS Coil-{fieldname}-label'
        if frappe.db.exists('Property Setter', setter):
            frappe.db.set_value('Property Setter', setter, 'value', label, update_modified=False)
    # Older inspection sheets used this parentfield before the table was renamed.
    if not frappe.get_meta('SS Coil').get_field('custom_measurements'):
        frappe.db.sql("""UPDATE `tabInspection Measurement`
            SET parentfield = 'custom_slitter_inspection_sheet_1'
            WHERE parenttype = 'SS Coil' AND parentfield = 'custom_measurements'""")
    frappe.clear_cache(doctype='SS Coil')


@frappe.whitelist()
def get_inspection_context(ss_coil=None, sales_order=None, sales_order_item=None, operation=None, inspection_tag=None, output_width=None):
    """Read company and order labels for the inspection sheet header."""
    from frappe.utils import strip_html
    from ss_coil.api import get_stock_entry_sticker_logo_url

    coil = None
    output_row = None
    if ss_coil:
        coil = frappe.get_doc('SS Coil', ss_coil)
        coil.check_permission('read')
        sales_order = coil.order_no
        sales_order_item = coil.sales_order_item
        operation = coil.operation
        output_row = next((row for row in (coil.get('job_output') or []) if row.get('tag_no') == inspection_tag), None)
    context = {}
    company = frappe.defaults.get_global_default('company')
    if sales_order:
        order = frappe.get_doc('Sales Order', sales_order)
        order.check_permission('read')
        company = order.company
        context.update(customer=order.customer_name, po_no=order.po_no)
        row = next((row for row in order.items if row.name == sales_order_item), None)
        if row:
            context.update(specs=row.get('custom_specification'),
                           thickness=row.get('custom_thickness'),
                           width=row.get('custom_width'),
                           length_c=row.get('custom_length_c'),
                           length=row.get('custom_length'))
        cutting_rows = [row.as_dict() for row in (coil.get('cutting_detail') or [])] if coil else []
        if not cutting_rows and sales_order_item:
            from ss_coil.api import get_so_production_plan_rows

            cutting_rows = get_so_production_plan_rows(sales_order_item) or []
        cutting_widths = []
        for cutting_row in cutting_rows:
            width = cutting_row.get('width') if isinstance(cutting_row, dict) else getattr(cutting_row, 'width', None)
            if width not in (None, '') and str(width) not in [str(value) for value in cutting_widths]:
                cutting_widths.append(width)
        context['cutting_widths'] = ' / '.join(str(width) for width in cutting_widths)
    selected_width = (output_row.get('width') if output_row else None) or output_width or context.get('width')
    context['inspection_width'] = selected_width
    if context.get('thickness') not in (None, '') and selected_width not in (None, ''):
        tolerance = _get_thickness_tolerance(context['thickness'], selected_width, operation or 'Slitter')
        if tolerance:
            from frappe.utils import flt

            nominal = flt(context['thickness'])
            deviation = flt(tolerance['tolerance_amount'])
            context['tolerances'] = {
                'thickness_min': round(nominal - deviation, 3),
                'thickness_max': round(nominal + deviation, 3),
            }
            context['thickness_tolerance'] = deviation
            context['tolerance_set'] = tolerance.get('parent')
    if company:
        record = frappe.get_cached_doc('Company', company)
        record.check_permission('read')
        context.update(company_name=record.company_name,
                       company_address=strip_html(record.get('primary_address') or ''),
                       company_phone=record.get('phone_no') or '',
                       logo_url=get_stock_entry_sticker_logo_url(company))
    return context


def _get_thickness_tolerance(thickness, width, process_name='Slitter'):
    if not frappe.db.table_exists('Tolerances Detail') or not frappe.db.table_exists('Tolerances on Thickness'):
        return None
    from frappe.utils import flt

    width = flt(width)
    width_field = (
        'tolerance_under_630' if width < 630 else
        'tolerance_630_1000' if width < 1000 else
        'tolerance_1000_1250' if width < 1250 else
        'tolerance_1250_1600' if width < 1600 else
        'tolerance_1600_over'
    )
    rows = frappe.db.sql(
        f"""SELECT detail.parent, detail.`{width_field}` AS tolerance_amount
           FROM `tabTolerances Detail` detail
           INNER JOIN `tabTolerances on Thickness` rule_set ON rule_set.name = detail.parent
           WHERE detail.parenttype = 'Tolerances on Thickness'
             AND detail.parentfield = 'tolerance_details'
             AND rule_set.process_name = %(process_name)s
             AND ifnull(rule_set.disabled, 0) = 0
             AND detail.thickness_from <= %(thickness)s
             AND (detail.thickness_to IS NULL OR detail.thickness_to = 0 OR %(thickness)s < detail.thickness_to)
             AND detail.`{width_field}` IS NOT NULL
             AND detail.`{width_field}` <> 0
           ORDER BY detail.thickness_from DESC, rule_set.modified DESC
           LIMIT 1""",
        {'thickness': flt(thickness), 'process_name': process_name},
        as_dict=True,
    )
    return rows[0] if rows else None


@frappe.whitelist()
def get_tolerance_table_for_coil(ss_coil=None, operation=None):
    """Return the active process tolerance table for an SS Coil form."""
    if ss_coil:
        coil = frappe.get_doc('SS Coil', ss_coil)
        coil.check_permission('read')
        operation = coil.operation
    else:
        if not frappe.has_permission('SS Coil', 'read'):
            frappe.throw(_('Not permitted to read SS Coil.'))
        if operation and not frappe.db.exists('Operation', operation):
            frappe.throw(_('Invalid process.'))
    if not operation:
        return None

    parent_name = frappe.db.get_value(
        'Tolerances on Thickness', {'process_name': operation}, 'name'
    )
    if not parent_name:
        return {'process_name': operation, 'remarks': '', 'disabled': 0, 'rows': []}

    rule_set = frappe.get_doc('Tolerances on Thickness', parent_name)
    return {
        'process_name': rule_set.process_name,
        'remarks': rule_set.remarks or '',
        'disabled': rule_set.disabled,
        'rows': [
            {
                'thickness_range': row.thickness_range,
                'tolerance_under_630': row.tolerance_under_630 or None,
                'tolerance_630_1000': row.tolerance_630_1000 or None,
                'tolerance_1000_1250': row.tolerance_1000_1250 or None,
                'tolerance_1250_1600': row.tolerance_1250_1600 or None,
                'tolerance_1600_over': row.tolerance_1600_over or None,
            }
            for row in rule_set.tolerance_details
        ],
    }
