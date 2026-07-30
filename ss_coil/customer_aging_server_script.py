# Server Script: Customer Aging API
# Party balances from GL Entry so invoices, payments, journals, returns, and openings are included.
args = frappe.form_dict
as_on_date = frappe.utils.getdate(args.get("as_on_date") or frappe.utils.today())
company = args.get("company")
if not company:
    default_companies = frappe.get_all("Company", pluck="name", order_by="is_group asc, name asc", limit_page_length=1)
    if default_companies:
        company = default_companies[0]
balance_type = args.get("balance_type") or "all"
customer_group_filter = args.get("customer_group")

gl_filters = {
    "is_cancelled": 0,
    "party_type": "Customer",
    "party": ["is", "set"],
    "posting_date": ["<=", as_on_date],
}
if company:
    gl_filters["company"] = company

entries = frappe.get_all(
    "GL Entry",
    filters=gl_filters,
    fields=["party", "posting_date", "debit", "credit"],
    order_by="party asc, posting_date asc, creation asc, name asc",
    limit_page_length=100000,
)

customer_names = list(set([entry.get("party") for entry in entries if entry.get("party")]))
customer_map = {}
if customer_names:
    customers = frappe.get_all(
        "Customer",
        filters={"name": ["in", customer_names]},
        fields=["name", "customer_name", "customer_group"],
        limit_page_length=100000,
    )
    for customer_doc in customers:
        customer_map[customer_doc.get("name")] = customer_doc

customer_rows = {}
for entry in entries:
    customer = entry.get("party")
    if not customer:
        continue

    customer_doc = customer_map.get(customer) or {}
    customer_group = customer_doc.get("customer_group") or "Ungrouped"
    if customer_group_filter and customer_group != customer_group_filter:
        continue

    if customer not in customer_rows:
        customer_rows[customer] = {
            "customer": customer,
            "customer_name": customer_doc.get("customer_name") or customer,
            "customer_group": customer_group,
            "balance": 0,
            "age_1_15": 0,
            "age_16_30": 0,
            "age_31_60": 0,
            "age_61_90": 0,
            "age_91_above": 0,
        }

    amount = (entry.get("debit") or 0) - (entry.get("credit") or 0)
    if not amount:
        continue

    row = customer_rows[customer]
    age = frappe.utils.date_diff(as_on_date, entry.get("posting_date"))
    if age < 1:
        age = 1

    row["balance"] = row["balance"] + amount
    if age <= 15:
        row["age_1_15"] = row["age_1_15"] + amount
    elif age <= 30:
        row["age_16_30"] = row["age_16_30"] + amount
    elif age <= 60:
        row["age_31_60"] = row["age_31_60"] + amount
    elif age <= 90:
        row["age_61_90"] = row["age_61_90"] + amount
    else:
        row["age_91_above"] = row["age_91_above"] + amount

rows = []
for row in customer_rows.values():
    balance = row.get("balance") or 0
    if balance_type == "greater" and balance <= 0:
        continue
    if balance_type == "less" and balance >= 0:
        continue
    if balance == 0:
        continue
    rows.append(row)

rows.sort(key=lambda row: ((row.get("customer_group") or ""), -(row.get("balance") or 0), row.get("customer") or ""))
companies = frappe.get_all("Company", pluck="name", order_by="name asc", limit_page_length=10000)
all_customer_groups = frappe.get_all("Customer Group", pluck="name", order_by="name asc", limit_page_length=10000)
frappe.response["message"] = {"rows": rows, "companies": companies, "customer_groups": all_customer_groups, "as_on_date": str(as_on_date)}
