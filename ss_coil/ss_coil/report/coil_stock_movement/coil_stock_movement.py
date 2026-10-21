import frappe
from frappe import _
from frappe.utils import flt, getdate


def execute(filters=None):
	filters = frappe._dict(filters or {})
	if not filters.get("company"):
		filters.company = frappe.defaults.get_user_default("Company")
	if not filters.get("company"):
		frappe.throw(_("Select a Company."))
	if filters.get("from_date") and filters.get("to_date") and getdate(filters.from_date) > getdate(filters.to_date):
		frappe.throw(_("From Date cannot be after To Date."))

	columns = [
		{"label": _("Posting Date"), "fieldname": "posting_date", "fieldtype": "Date", "width": 100},
		{"label": _("Voucher Type"), "fieldname": "voucher_type", "fieldtype": "Data", "width": 125},
		{"label": _("Voucher No"), "fieldname": "voucher_no", "fieldtype": "Dynamic Link", "options": "voucher_type", "width": 160},
		{"label": _("Stock Entry"), "fieldname": "stock_entry", "fieldtype": "Link", "options": "Stock Entry", "width": 155},
		{"label": _("Item Code"), "fieldname": "item_code", "fieldtype": "Link", "options": "Item", "width": 140},
		{"label": _("Item Name"), "fieldname": "item_name", "fieldtype": "Data", "width": 180},
		{"label": _("Tag No"), "fieldname": "tag_no", "fieldtype": "Data", "width": 150},
		{"label": _("Customer"), "fieldname": "customer", "fieldtype": "Link", "options": "Customer", "width": 150},
		{"label": _("Customer Name"), "fieldname": "customer_name", "fieldtype": "Data", "width": 170},
		{"label": _("Sales Order"), "fieldname": "sales_order", "fieldtype": "Link", "options": "Sales Order", "width": 155},
		{"label": _("Warehouse"), "fieldname": "warehouse", "fieldtype": "Link", "options": "Warehouse", "width": 160},
		{"label": _("Thickness"), "fieldname": "thickness", "fieldtype": "Float", "precision": 3, "width": 90},
		{"label": _("Width"), "fieldname": "width", "fieldtype": "Float", "precision": 3, "width": 90},
		{"label": _("Length"), "fieldname": "length", "fieldtype": "Float", "precision": 3, "width": 90},
		{"label": _("Mill"), "fieldname": "mill", "fieldtype": "Data", "width": 110},
		{"label": _("UOM"), "fieldname": "stock_uom", "fieldtype": "Link", "options": "UOM", "width": 80},
		{"label": _("Stock In Qty"), "fieldname": "stock_in", "fieldtype": "Float", "precision": 3, "width": 115},
		{"label": _("Stock Out Qty"), "fieldname": "stock_out", "fieldtype": "Float", "precision": 3, "width": 115},
		{"label": _("Opening Balance Qty"), "fieldname": "opening_balance", "fieldtype": "Float", "precision": 3, "width": 130},
		{"label": _("Balance Qty"), "fieldname": "balance", "fieldtype": "Float", "precision": 3, "width": 115},
		{"label": _("Batch No"), "fieldname": "batch_no", "fieldtype": "Link", "options": "Batch", "width": 130},
		{"label": _("Serial No"), "fieldname": "serial_no", "fieldtype": "Small Text", "width": 140},
	]

	base_conditions = ["sle.company = %(company)s", "sle.is_cancelled = 0"]
	values = {"company": filters.company}
	for field, sql in (("item_code", "sle.item_code = %(item_code)s"), ("warehouse", "sle.warehouse = %(warehouse)s"), ("stock_entry", "(sle.voucher_no = %(stock_entry)s OR ste.name = %(stock_entry)s)"), ("voucher_type", "sle.voucher_type = %(voucher_type)s"), ("batch_no", "sle.batch_no = %(batch_no)s"), ("serial_no", "sle.serial_no like %(serial_no)s")):
		if filters.get(field):
			base_conditions.append(sql)
			values[field] = f"%{filters[field]}%" if field == "serial_no" else filters[field]
	if filters.get("sales_order"):
		base_conditions.append("tr.sales_order = %(sales_order)s")
		values.sales_order = filters.sales_order
	if filters.get("customer"):
		base_conditions.append("coalesce(ste.custom_customer, dn.customer, si.customer, so.customer, cust_tag.name) = %(customer)s")
		values.customer = filters.customer
	if filters.get("tag_no"):
		base_conditions.append("(coalesce(sed.custom_tag_no, dni.custom_tag_no, pri.custom_tag_no, sii.custom_tag_no, tr.tag_no) like %(tag_no)s)")
		values.tag_no = f"%{filters.tag_no}%"
	if filters.get("thickness") not in (None, ""):
		base_conditions.append("coalesce(sed.custom_thickness, pri.custom_thickness) = %(thickness)s")
		values.thickness = filters.thickness
	if filters.get("width") not in (None, ""):
		base_conditions.append("coalesce(sed.custom_width, pri.custom_width) = %(width)s")
		values.width = filters.width
	if filters.get("mill"):
		base_conditions.append("coalesce(sed.custom_mill, pri.custom_mill) like %(mill)s")
		values.mill = f"%{filters.mill}%"

	joins = """
		left join `tabStock Entry Detail` sed on sle.voucher_type = 'Stock Entry' and sed.name = sle.voucher_detail_no
		left join `tabStock Entry` ste on ste.name = sle.voucher_no and sle.voucher_type = 'Stock Entry'
		left join `tabDelivery Note Item` dni on sle.voucher_type = 'Delivery Note' and dni.name = sle.voucher_detail_no
		left join `tabDelivery Note` dn on dn.name = sle.voucher_no and sle.voucher_type = 'Delivery Note'
		left join `tabPurchase Receipt Item` pri on sle.voucher_type = 'Purchase Receipt' and pri.name = sle.voucher_detail_no
		left join `tabPurchase Receipt` pr on pr.name = sle.voucher_no and sle.voucher_type = 'Purchase Receipt'
		left join `tabSales Invoice Item` sii on sle.voucher_type = 'Sales Invoice' and sii.name = sle.voucher_detail_no
		left join `tabSales Invoice` si on si.name = sle.voucher_no and sle.voucher_type = 'Sales Invoice'
		left join `tabTag Registry` tr on tr.tag_no = coalesce(sed.custom_tag_no, dni.custom_tag_no, pri.custom_tag_no, sii.custom_tag_no)
		left join `tabSales Order` so on so.name = tr.sales_order
		left join `tabCustomer` cust_tag on cust_tag.customer_name = tr.customer_name
	"""
	select_fields = """
		sle.name, sle.posting_date, sle.posting_time, sle.creation, sle.voucher_type, sle.voucher_no,
		sle.item_code, item.item_name, sle.warehouse, sle.actual_qty, sle.stock_uom, sle.batch_no, sle.serial_no,
		coalesce(sed.custom_tag_no, dni.custom_tag_no, pri.custom_tag_no, sii.custom_tag_no, tr.tag_no) as tag_no,
		coalesce(ste.custom_customer, dn.customer, si.customer, so.customer, cust_tag.name) as customer,
		coalesce(cust.customer_name, cust_tag.customer_name, tr.customer_name, ste.custom_customer, dn.customer, si.customer, so.customer) as customer_name,
		tr.sales_order as sales_order,
		coalesce(sed.custom_thickness, pri.custom_thickness) as thickness,
		coalesce(sed.custom_width, pri.custom_width) as width,
		coalesce(sed.custom_length_c, pri.custom_length_c) as length,
		coalesce(sed.custom_mill, pri.custom_mill) as mill
	"""
	joins += " left join `tabItem` item on item.name = sle.item_code left join `tabCustomer` cust on cust.name = coalesce(ste.custom_customer, dn.customer, si.customer, so.customer, cust_tag.name) "
	where = " and ".join(base_conditions)
	opening = []
	period = []
	if filters.get("from_date"):
		opening = frappe.db.sql(f"select {select_fields} from `tabStock Ledger Entry` sle {joins} where {where} and sle.posting_date < %(from_date)s order by sle.posting_date, sle.posting_time, sle.creation, sle.name", {**values, "from_date": filters.from_date}, as_dict=True)
		period_conditions = f"{where} and sle.posting_date >= %(from_date)s"
		period_values = {**values, "from_date": filters.from_date}
	else:
		period_conditions = where
		period_values = values
	if filters.get("to_date"):
		period_conditions += " and sle.posting_date <= %(to_date)s"
		period_values["to_date"] = filters.to_date
	period = frappe.db.sql(f"select {select_fields} from `tabStock Ledger Entry` sle {joins} where {period_conditions} order by sle.posting_date, sle.posting_time, sle.creation, sle.name", period_values, as_dict=True)

	balances = {}
	for row in opening:
		key = (row.item_code, row.warehouse, row.tag_no or "")
		balances[key] = balances.get(key, 0) + flt(row.actual_qty)
	data = []
	opening_balances = dict(balances)
	first_row_for_key = set()
	for row in period:
		key = (row.item_code, row.warehouse, row.tag_no or "")
		qty = flt(row.actual_qty)
		balances[key] = balances.get(key, 0) + qty
		if not filters.get("include_zero_qty") and not qty:
			continue
		data.append({
			**row,
			"stock_entry": row.voucher_no if row.voucher_type == "Stock Entry" else None,
			"sales_order": row.get("sales_order"),
			"opening_balance": opening_balances.get(key, 0) if key not in first_row_for_key else 0,
			"stock_in": max(qty, 0),
			"stock_out": abs(min(qty, 0)),
			"balance": balances[key],
		})
		first_row_for_key.add(key)
	return columns, data
