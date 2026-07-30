# Server Script: Ledger Report API
args = frappe.form_dict
from_date = args.get("from_date")
to_date = args.get("to_date")
company = args.get("company")
if not company:
    default_companies = frappe.get_all("Company", pluck="name", order_by="is_group asc, name asc", limit_page_length=1)
    if default_companies:
        company = default_companies[0]
account = args.get("account")
party_type = args.get("party_type") or "Customer"
party = args.get("party")

base_filters = {"is_cancelled": 0}
if company:
    base_filters["company"] = company
if account:
    base_filters["account"] = account
if party_type:
    base_filters["party_type"] = party_type
if party:
    base_filters["party"] = party

opening_filters = dict(base_filters)
if from_date:
    opening_filters["posting_date"] = ["<", from_date]
opening_entries = frappe.get_all("GL Entry", filters=opening_filters, fields=["debit", "credit"], limit_page_length=100000)
opening_balance = 0
for entry in opening_entries:
    opening_balance = opening_balance + (entry.get("debit") or 0) - (entry.get("credit") or 0)

period_filters = dict(base_filters)
if from_date and to_date:
    period_filters["posting_date"] = ["between", [from_date, to_date]]
elif from_date:
    period_filters["posting_date"] = [">=", from_date]
elif to_date:
    period_filters["posting_date"] = ["<=", to_date]

entries = frappe.get_all(
    "GL Entry",
    filters=period_filters,
    fields=["posting_date", "voucher_type", "voucher_no", "against", "remarks", "debit", "credit", "account", "party_type", "party", "creation"],
    order_by="posting_date asc, creation asc, name asc",
    limit_page_length=100000,
)
rows = []
for entry in entries:
    rows.append({
        "posting_date": str(entry.get("posting_date")),
        "voucher_type": entry.get("voucher_type"),
        "voucher_no": entry.get("voucher_no"),
        "against_account": entry.get("against"),
        "remarks": entry.get("remarks"),
        "debit": entry.get("debit") or 0,
        "credit": entry.get("credit") or 0,
        "account": entry.get("account"),
        "party_type": entry.get("party_type"),
        "party": entry.get("party"),
    })

frappe.response["message"] = {"rows": rows, "opening_balance": opening_balance}
