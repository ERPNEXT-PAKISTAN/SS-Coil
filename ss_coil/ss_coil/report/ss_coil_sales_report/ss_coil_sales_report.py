"""Customer receipt/dispatch weights and invoiced sales, without multiplying joins."""
import frappe
from frappe import _
from frappe.utils import flt, getdate


WEIGHTS = ("mill_tag_weight", "number_of_coils", "received_weight", "scrap", "finish_goods", "out_weight", "remaining_weight")
MONEY = ("amount", "with_sales_tax_amount", "receivable")


def get_columns():
    labels = ["Mill Tag Weight (Kgs)", "Number of Coils", "Received Weight (Kgs)", "Scrap (Kgs)", "Finish Goods (Kgs)", "Out Weight (Kgs)", "Remaining Weight (Kgs)"]
    columns = [{"label": _("Customer Name"), "fieldname": "customer_name", "fieldtype": "Data", "width": 240}]
    columns += [{"label": _(label), "fieldname": key, "fieldtype": "Float", "precision": 3, "width": 155} for key, label in zip(WEIGHTS, labels)]
    columns += [{"label": _(label), "fieldname": key, "fieldtype": "Currency", "options": "currency", "width": 175} for key, label in [("price", "Price"), ("amount", "Amount"), ("with_sales_tax_amount", "with Sales Tax Amount"), ("receivable", "Receivable (Rs)")]]
    columns.append({"label": _("Remarks"), "fieldname": "remarks", "fieldtype": "Data", "width": 360})
    return columns


def _documents(doctype, filters, customer_field="customer"):
    # get_list applies role, document-sharing and user permission restrictions.
    conditions = {"docstatus": 1, "company": filters.company}
    if filters.get("from_date"):
        conditions["posting_date"] = ["between", [filters.from_date, filters.to_date]]
    else:
        conditions["posting_date"] = ["<=", filters.to_date]
    if filters.get("customer"):
        conditions[customer_field] = filters.customer
    if doctype == "Stock Entry":
        conditions["purpose"] = "Material Receipt"
    return frappe.get_list(doctype, filters=conditions, fields=["*"], limit_page_length=0)


def _items(doctype, names):
    if not names:
        return []
    return frappe.db.sql(f"select d.*, i.item_group from `tab{doctype}` d left join `tabItem` i on i.name=d.item_code where d.parent in %(names)s", {"names": names}, as_dict=True)


def _kg(item):
    unit = (item.get("stock_uom") or "").lower()
    if unit in ("kg", "kgs", "kilogram", "kilograms"):
        return flt(item.get("stock_qty") if item.get("stock_qty") is not None else item.get("transfer_qty"))
    if unit in ("ton", "tons", "tonne", "tonnes", "metric ton"):
        return 1000 * flt(item.get("stock_qty") if item.get("stock_qty") is not None else item.get("transfer_qty"))
    return None


def execute(filters=None):
    filters = frappe._dict(filters or {})
    if not filters.company:
        frappe.throw(_("Please select a Company"))
    if not frappe.db.exists("Company", filters.company):
        frappe.throw(_("Company does not exist"))
    filters.to_date = filters.get("to_date") or frappe.utils.today()
    if filters.get("from_date") and getdate(filters.from_date) > getdate(filters.to_date):
        frappe.throw(_("From Date cannot be after To Date"))
    for doctype in ("Stock Entry", "Delivery Note", "Sales Invoice"):
        frappe.has_permission(doctype, "read", throw=True)
    currency = frappe.get_cached_value("Company", filters.company, "default_currency")
    rows = {}

    def row(customer):
        if customer not in rows:
            rows[customer] = dict.fromkeys(WEIGHTS + MONEY + ("price", "invoice_qty"), 0.0)
            rows[customer].update(customer_name=frappe.get_cached_value("Customer", customer, "customer_name") or customer, currency=currency)
        return rows[customer]

    receipts = {d.name: d for d in _documents("Stock Entry", filters, "custom_customer") if d.custom_customer}
    for item in _items("Stock Entry Detail", tuple(receipts)):
        customer = receipts[item.parent].custom_customer
        target = row(customer)
        weight = _kg(item)
        if weight is None:
            continue
        target["received_weight"] += weight
        target["mill_tag_weight"] += flt(item.custom_estimated_wt)
        target["number_of_coils"] += flt(item.custom_qty_of_coil)

    deliveries = {d.name: d for d in _documents("Delivery Note", filters)}
    # Stock-updating invoices are dispatches too; rows linked to a Delivery Note
    # are excluded here to avoid counting the same physical movement twice.
    invoices = {d.name: d for d in _documents("Sales Invoice", filters)}
    invoice_items = _items("Sales Invoice Item", tuple(invoices))
    dispatches = [(deliveries[i.parent].customer, i) for i in _items("Delivery Note Item", tuple(deliveries))]
    dispatches += [(invoices[i.parent].customer, i) for i in invoice_items if invoices[i.parent].update_stock and not i.delivery_note]
    for customer, item in dispatches:
        target = row(customer)
        weight = _kg(item)
        if weight is None:
            continue
        is_scrap = (filters.get("scrap_item") and item.item_code == filters.scrap_item) or (filters.get("scrap_item_group") and item.item_group == filters.scrap_item_group)
        target["scrap" if is_scrap else "finish_goods"] += weight

    for invoice in invoices.values():
        target = row(invoice.customer)
        target["amount"] += flt(invoice.base_net_total)
        target["with_sales_tax_amount"] += flt(invoice.base_grand_total)
        target["receivable"] += flt(invoice.outstanding_amount) * flt(invoice.conversion_rate or 1)
    for item in invoice_items:
        row(invoices[item.parent].customer)["invoice_qty"] += flt(item.qty)

    data = []
    for customer, target in rows.items():
        target["out_weight"] = target["scrap"] + target["finish_goods"]
        target["remaining_weight"] = target["received_weight"] - target["out_weight"]
        target["price"] = target["amount"] / target["invoice_qty"] if target["invoice_qty"] else 0
        target["remarks"] = ""
        data.append(target)
    data.sort(key=lambda d: d["customer_name"].lower())
    message = _("Submitted transactions only. Mill weight = receipt Estimated WT; coil count = receipt Qty of Coil. Out weight = net dispatch (returns reduce weight). Price = invoice net amount / invoiced quantity. Amount and tax-inclusive amount use company currency; tax-inclusive amount includes all invoice taxes/charges. Receivable is the current outstanding balance of invoices in the selected period. With From Date set, remaining weight is the period net movement, excluding opening stock.")
    return get_columns(), data, message
