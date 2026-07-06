import frappe
from frappe import _


def execute(filters=None):
    filters = filters or {}
    columns = [
        {"label": _("Tree"), "fieldname": "tree_label", "fieldtype": "Data", "width": 260},
        {"label": _("Tag No"), "fieldname": "tag_no", "fieldtype": "Link", "options": "Tag Registry", "width": 180},
        {"label": _("Status"), "fieldname": "status", "fieldtype": "Data", "width": 110},
        {"label": _("Sales Order"), "fieldname": "sales_order", "fieldtype": "Link", "options": "Sales Order", "width": 170},
        {"label": _("Item Code"), "fieldname": "item_code", "fieldtype": "Data", "width": 150},
        {"label": _("Item Name"), "fieldname": "item_name", "fieldtype": "Data", "width": 220},
        {"label": _("Batch No"), "fieldname": "batch_no", "fieldtype": "Link", "options": "Batch", "width": 150},
        {"label": _("Parent Tag No"), "fieldname": "parent_tag_no", "fieldtype": "Data", "width": 150},
        {"label": _("Source Doctype"), "fieldname": "source_doctype", "fieldtype": "Data", "width": 130},
        {"label": _("Source Document"), "fieldname": "source_docname", "fieldtype": "Data", "width": 170},
        {"label": _("Current Doctype"), "fieldname": "current_doctype", "fieldtype": "Data", "width": 130},
        {"label": _("Current Document"), "fieldname": "current_docname", "fieldtype": "Data", "width": 170},
        {"label": _("Issued On"), "fieldname": "issued_on", "fieldtype": "Datetime", "width": 170},
    ]

    conditions = []
    values = {}
    if filters.get("sales_order"):
        conditions.append("sales_order = %(sales_order)s")
        values["sales_order"] = filters.get("sales_order")
    if filters.get("root_tag_no"):
        conditions.append("ifnull(root_tag_no, tag_no) = %(root_tag_no)s")
        values["root_tag_no"] = filters.get("root_tag_no")
    if filters.get("tag_no"):
        conditions.append("tag_no = %(tag_no)s")
        values["tag_no"] = filters.get("tag_no")
    if filters.get("status"):
        conditions.append("status = %(status)s")
        values["status"] = filters.get("status")

    where = f"where {' and '.join(conditions)}" if conditions else ""

    rows = frappe.db.sql(
        f"""
        select
            tag_no, status, sales_order, item_code, item_name, batch_no,
            parent_tag_no, root_tag_no,
            source_doctype, source_docname,
            current_doctype, current_docname,
            issued_on
        from `tabTag Registry`
        {where}
        order by ifnull(root_tag_no, tag_no),
                 case when ifnull(parent_tag_no, '') = '' then 0 else 1 end,
                 parent_tag_no,
                 tag_no
        """,
        values,
        as_dict=True,
    )

    grouped = {}
    for row in rows:
        root = row.root_tag_no or row.tag_no
        grouped.setdefault(root, []).append(row)

    data = []
    for root, group_rows in grouped.items():
        root_row = next((r for r in group_rows if r.tag_no == root), group_rows[0])
        data.append({
            **root_row,
            "tree_label": f"Root: {root}",
        })
        for row in group_rows:
            if row.tag_no == root_row.tag_no:
                continue
            parent = row.parent_tag_no or root
            data.append({
                **row,
                "tree_label": f"  Child of {parent}: {row.tag_no}",
            })

    return columns, data
