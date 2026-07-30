"""Live data source for the Operations Overview web page.

All queries are read-only and execute in the current Frappe site/database.
The endpoint deliberately requires a logged-in ERP user because it exposes
company-wide operational and financial totals.
"""

from pathlib import Path

import frappe
from frappe import _
from frappe.utils import add_months, cint, flt, get_first_day, get_last_day, nowdate


def _scalar(query, values=None):
	row = frappe.db.sql(query, values or {}, as_list=True)
	return flt(row[0][0]) if row and row[0] else 0


def _rows(query, values=None):
	return frappe.db.sql(query, values or {}, as_dict=True)


def _require_user():
	if frappe.session.user == "Guest":
		frappe.throw(_("Please log in to view live operational data."), frappe.PermissionError)


@frappe.whitelist(allow_guest=True)
def get_overview():
	"""Return current dashboard values from the site's live ERP database."""
	today = nowdate()
	month_start = get_first_day(today)
	month_end = get_last_day(today)
	year_start = f"{today[:4]}-01-01"
	params = {"today": today, "month_start": month_start, "month_end": month_end, "year_start": year_start}

	# Sales / purchasing pipeline
	sales_orders = _rows(
		"""SELECT status, COUNT(*) count, COALESCE(SUM(grand_total), 0) amount
		FROM `tabSales Order` WHERE docstatus < 2 AND transaction_date >= %(year_start)s
		GROUP BY status""", params
	)
	sales_invoices = _rows(
		"""SELECT status, COUNT(*) count, COALESCE(SUM(base_net_total), 0) amount,
		COALESCE(SUM(outstanding_amount), 0) outstanding
		FROM `tabSales Invoice` WHERE docstatus = 1 AND is_return = 0
		AND posting_date BETWEEN %(month_start)s AND %(month_end)s GROUP BY status""", params
	)
	purchase_orders = _rows(
		"""SELECT status, COUNT(*) count, COALESCE(SUM(base_grand_total), 0) amount
		FROM `tabPurchase Order` WHERE docstatus < 2 AND transaction_date >= %(year_start)s
		GROUP BY status""", params
	)

	# Six-month series, based on submitted invoices.
	months = []
	for offset in range(-5, 1):
		start = get_first_day(add_months(today, offset))
		end = get_last_day(start)
		row = frappe.db.sql(
			"""SELECT COALESCE(SUM(CASE WHEN is_return=0 THEN base_net_total ELSE -ABS(base_net_total) END),0) revenue,
			COUNT(CASE WHEN is_return=0 THEN 1 END) invoices
			FROM `tabSales Invoice` WHERE docstatus=1 AND posting_date BETWEEN %s AND %s""",
			(start, end), as_dict=True,
		)[0]
		months.append({"label": start.strftime("%b"), "revenue": flt(row.revenue), "invoices": cint(row.invoices)})

	top_items = _rows(
		"""SELECT COALESCE(i.item_group, 'Uncategorised') label,
		COALESCE(SUM(sii.base_net_amount),0) value
		FROM `tabSales Invoice Item` sii
		JOIN `tabSales Invoice` si ON si.name=sii.parent
		LEFT JOIN `tabItem` i ON i.name=sii.item_code
		WHERE si.docstatus=1 AND si.is_return=0
		AND si.posting_date BETWEEN %(month_start)s AND %(month_end)s
		GROUP BY i.item_group ORDER BY value DESC LIMIT 5""", params
	)

	# Stock value uses the latest Bin balances, never sample quantities.
	stock = frappe.db.sql(
		"""SELECT COALESCE(SUM(actual_qty),0) qty,
		COALESCE(SUM(stock_value),0) value, COUNT(DISTINCT item_code) items
		FROM `tabBin`""", as_dict=True
	)[0]
	low_stock = _scalar(
		"""SELECT COUNT(*) FROM `tabItem Reorder` ir
		JOIN `tabItem` i ON i.name=ir.parent
		LEFT JOIN `tabBin` b ON b.item_code=ir.parent AND b.warehouse=ir.warehouse
		WHERE i.disabled=0 AND i.is_stock_item=1
		AND COALESCE(b.actual_qty,0) <= ir.warehouse_reorder_level
		AND ir.warehouse_reorder_level > 0"""
	)

	# Custom production docs may be absent during an install/migration.
	production = {"jobs": 0, "completed": 0, "in_progress": 0, "output_qty": 0}
	if frappe.db.table_exists("SS Coil"):
		status_field = "order_status" if frappe.db.has_column("SS Coil", "order_status") else None
		production["jobs"] = cint(frappe.db.count("SS Coil"))
		if status_field:
			production["completed"] = cint(frappe.db.count("SS Coil", {status_field: "Completed"}))
			production["in_progress"] = cint(frappe.db.count("SS Coil", {status_field: ["not in", ["Completed", "Not Started"]]}))
	if frappe.db.table_exists("Coil Output"):
		for candidate in ("actual_wt", "actual_qty", "estimated_wt", "estimated_qty"):
			if frappe.db.has_column("Coil Output", candidate):
				production["output_qty"] = _scalar(f"SELECT COALESCE(SUM(`{candidate}`),0) FROM `tabCoil Output`")
				break

	# HR values use active employees and today's submitted attendance.
	employees = cint(frappe.db.count("Employee", {"status": "Active"}))
	present = _scalar(
		"""SELECT COUNT(*) FROM `tabAttendance` WHERE docstatus=1
		AND attendance_date=%(today)s AND status IN ('Present','Work From Home','Half Day')""", params
	)
	on_leave = _scalar(
		"""SELECT COUNT(*) FROM `tabAttendance` WHERE docstatus=1
		AND attendance_date=%(today)s AND status='On Leave'""", params
	)
	departments = _rows(
		"""SELECT COALESCE(department,'Unassigned') label, COUNT(*) value
		FROM `tabEmployee` WHERE status='Active' GROUP BY department ORDER BY value DESC LIMIT 8"""
	)

	# Current accounting balances derived from submitted GL Entries.
	finance_rows = _rows(
		"""SELECT a.root_type, COALESCE(SUM(gl.debit-gl.credit),0) balance
		FROM `tabGL Entry` gl JOIN `tabAccount` a ON a.name=gl.account
		WHERE gl.is_cancelled=0 AND gl.posting_date <= %(today)s
		GROUP BY a.root_type""", params
	)
	finance = {r.root_type.lower(): flt(r.balance) for r in finance_rows}
	receivable = _scalar("SELECT COALESCE(SUM(outstanding_amount),0) FROM `tabSales Invoice` WHERE docstatus=1 AND is_return=0")
	payable = _scalar("SELECT COALESCE(SUM(outstanding_amount),0) FROM `tabPurchase Invoice` WHERE docstatus=1 AND is_return=0")
	documents = {
		"delivery_notes_today": cint(frappe.db.count("Delivery Note", {"docstatus": 1, "posting_date": today, "is_return": 0})),
		"delivery_notes_month": cint(frappe.db.count("Delivery Note", {"docstatus": 1, "posting_date": ["between", [month_start, month_end]], "is_return": 0})),
		"sales_invoices_month": cint(frappe.db.count("Sales Invoice", {"docstatus": 1, "posting_date": ["between", [month_start, month_end]], "is_return": 0})),
		"purchase_receipts_month": cint(frappe.db.count("Purchase Receipt", {"docstatus": 1, "posting_date": ["between", [month_start, month_end]], "is_return": 0})),
		"purchase_invoices_month": cint(frappe.db.count("Purchase Invoice", {"docstatus": 1, "posting_date": ["between", [month_start, month_end]], "is_return": 0})),
		"leave_applications_month": cint(frappe.db.count("Leave Application", {"docstatus": 1, "from_date": ["<=", month_end], "to_date": [">=", month_start]})),
		"payments_received_month": _scalar(
			"""SELECT COALESCE(SUM(base_received_amount),0) FROM `tabPayment Entry`
			WHERE docstatus=1 AND payment_type='Receive'
			AND posting_date BETWEEN %(month_start)s AND %(month_end)s""", params
		),
		"payroll_month": _scalar(
			"""SELECT COALESCE(SUM(gross_pay),0) FROM `tabSalary Slip`
			WHERE docstatus=1 AND start_date <= %(month_end)s AND end_date >= %(month_start)s""", params
		),
	}

	return {
		"generated_at": frappe.utils.now_datetime(),
		"currency": frappe.get_cached_value("Company", frappe.defaults.get_user_default("Company"), "default_currency") or "PKR",
		"sales": {"orders": sales_orders, "invoices": sales_invoices, "months": months, "top_items": top_items},
		"purchases": {"orders": purchase_orders},
		"stock": {"qty": flt(stock.qty), "value": flt(stock.value), "items": cint(stock["items"]), "low_stock": cint(low_stock)},
		"production": production,
		"hr": {"employees": employees, "present": cint(present), "on_leave": cint(on_leave), "departments": departments},
		"finance": {**finance, "receivable": receivable, "payable": payable, "stock_value": flt(stock.value)},
		"documents": documents,
	}


@frappe.whitelist()
def sync_overview_page_script():
	"""Install the source-controlled live binding into Web Page overview."""
	_require_user()
	frappe.only_for("System Manager")
	path = Path(__file__).with_name("public") / "js" / "overview_dashboard.js"
	script = path.read_text(encoding="utf-8")
	server_script_path = Path(__file__).with_name("overview_dashboard_server_script.py")
	server_script_source = server_script_path.read_text(encoding="utf-8")
	server_script = frappe.get_doc("Server Script", "Overview Dashboard API") if frappe.db.exists("Server Script", "Overview Dashboard API") else frappe.new_doc("Server Script")
	server_script.update({
		"name": "Overview Dashboard API",
		"script_type": "API",
		"api_method": "overview_dashboard_api",
		"allow_guest": 1,
		"disabled": 0,
		"script": server_script_source,
	})
	server_script.save(ignore_permissions=True)
	page = frappe.get_doc("Web Page", "overview")
	page.javascript = script
	page.save(ignore_permissions=True)
	frappe.clear_cache()
	return {"page": page.name, "route": page.route, "bytes": len(script), "server_script": server_script.name}
