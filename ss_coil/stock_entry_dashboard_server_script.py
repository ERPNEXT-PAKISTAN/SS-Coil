# Server Script: Daily Production API
# Submitted Stock Entry Detail rows that ERPNext marks as finished items.
args = frappe.form_dict
from_date = args.get("from_date")
to_date = args.get("to_date")
stock_entry_type = args.get("stock_entry_type")
item_group = args.get("item_group")

se_filters = {"docstatus": 1}
if from_date and to_date:
    se_filters["posting_date"] = ["between", [from_date, to_date]]
elif from_date:
    se_filters["posting_date"] = [">=", from_date]
elif to_date:
    se_filters["posting_date"] = ["<=", to_date]
if stock_entry_type:
    se_filters["stock_entry_type"] = stock_entry_type

entries = frappe.get_all("Stock Entry", filters=se_filters, fields=["name", "posting_date", "stock_entry_type"], order_by="posting_date asc", limit_page_length=100000)
entry_map = {}
for entry in entries:
    entry_map[entry.get("name")] = entry

production_rows = []
item_groups = set()
entry_names = list(entry_map.keys())
if entry_names:
    detail_filters = {"parent": ["in", entry_names], "parenttype": "Stock Entry", "is_finished_item": 1}
    details = frappe.get_all("Stock Entry Detail", filters=detail_filters, fields=["parent", "item_code", "item_name", "qty", "stock_uom"], limit_page_length=100000)
    item_codes = list(set([row.get("item_code") for row in details if row.get("item_code")]))
    group_map = {}
    if item_codes:
        item_docs = frappe.get_all("Item", filters={"name": ["in", item_codes]}, fields=["name", "item_group"], limit_page_length=100000)
        for item in item_docs:
            group_map[item.get("name")] = item.get("item_group") or ""
            if item.get("item_group"):
                item_groups.add(item.get("item_group"))
    for row in details:
        row_group = group_map.get(row.get("item_code"), "")
        if item_group and row_group != item_group:
            continue
        entry = entry_map.get(row.get("parent"))
        if entry:
            production_rows.append({"posting_date": str(entry.get("posting_date")), "stock_entry": row.get("parent"), "stock_entry_type": entry.get("stock_entry_type"), "item_code": row.get("item_code"), "item_name": row.get("item_name"), "item_group": row_group, "qty": row.get("qty") or 0, "uom": row.get("stock_uom")})

all_types = frappe.get_all("Stock Entry", filters={"docstatus": 1}, pluck="stock_entry_type", distinct=True, limit_page_length=10000)
all_groups = frappe.get_all("Item", filters={"disabled": 0}, pluck="item_group", distinct=True, limit_page_length=10000)
frappe.response["message"] = {"production_rows": production_rows, "stock_entry_types": sorted(list(set([x for x in all_types if x]))), "item_groups": sorted(list(set([x for x in all_groups if x])))}
