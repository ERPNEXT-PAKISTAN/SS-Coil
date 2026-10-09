"""Promote inspection Custom Fields without renaming their stored columns."""
import json
from pathlib import Path

import frappe


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
    # Older inspection sheets used this parentfield before the table was renamed.
    if not frappe.get_meta('SS Coil').get_field('custom_measurements'):
        frappe.db.sql("""UPDATE `tabInspection Measurement`
            SET parentfield = 'custom_slitter_inspection_sheet_1'
            WHERE parenttype = 'SS Coil' AND parentfield = 'custom_measurements'""")
    frappe.clear_cache(doctype='SS Coil')


@frappe.whitelist()
def get_inspection_context(ss_coil=None, sales_order=None, sales_order_item=None):
    """Read company and order labels for the inspection sheet header."""
    from frappe.utils import strip_html
    from ss_coil.api import get_stock_entry_sticker_logo_url

    if ss_coil:
        coil = frappe.get_doc('SS Coil', ss_coil)
        coil.check_permission('read')
        sales_order = coil.order_no
        sales_order_item = coil.sales_order_item
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
                           length=row.get('custom_length_c') or row.get('custom_length'))
    if company:
        record = frappe.get_cached_doc('Company', company)
        record.check_permission('read')
        context.update(company_name=record.company_name,
                       company_address=strip_html(record.get('primary_address') or ''),
                       company_phone=record.get('phone_no') or '',
                       logo_url=get_stock_entry_sticker_logo_url(company))
    return context
