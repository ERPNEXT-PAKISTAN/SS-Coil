# Server Script: Overview Dashboard API
# Type: API | API Method: overview_dashboard_api | Allow Guest: Yes
# Read-only live aggregates for Web Page overview (/or).

default_dates = frappe.db.sql("SELECT DATE_FORMAT(CURDATE(), '%Y-%m-01'), DATE_FORMAT(CURDATE(), '%Y-%m-%d')", as_list=True)[0]
from_date = frappe.form_dict.get("from_date") or default_dates[0]
to_date = frappe.form_dict.get("to_date") or default_dates[1]
date_params = {"from_date": from_date, "to_date": to_date}
previous_dates = frappe.db.sql("""
    SELECT DATE_SUB(%(from_date)s, INTERVAL DATEDIFF(%(to_date)s,%(from_date)s)+1 DAY),
           DATE_SUB(%(from_date)s, INTERVAL 1 DAY)
""", date_params, as_list=True)[0]
previous_params = {"from_date": str(previous_dates[0]), "to_date": str(previous_dates[1])}
company_row = frappe.db.sql("""
    SELECT c.name, c.company_name, c.default_currency
    FROM `tabCompany` c
    ORDER BY CASE WHEN c.name=(SELECT value FROM `tabSingles` WHERE doctype='Global Defaults' AND field='default_company' LIMIT 1) THEN 0 ELSE 1 END, c.creation
    LIMIT 1
""", as_dict=True)
company_info = company_row[0] if company_row else {"name": "ERP", "company_name": "ERP", "default_currency": "PKR"}
company_date_params = {"from_date": from_date, "to_date": to_date, "company": company_info.name}

sales_orders = frappe.db.sql("""
    SELECT status, COUNT(*) count, COALESCE(SUM(grand_total), 0) amount
    FROM `tabSales Order`
    WHERE docstatus < 2 AND transaction_date BETWEEN %(from_date)s AND %(to_date)s
    GROUP BY status
""", date_params, as_dict=True)

sales_invoices = frappe.db.sql("""
    SELECT status, COUNT(*) count, COALESCE(SUM(base_net_total), 0) amount,
           COALESCE(SUM(outstanding_amount), 0) outstanding
    FROM `tabSales Invoice`
    WHERE docstatus = 1 AND is_return = 0
      AND posting_date BETWEEN %(from_date)s AND %(to_date)s
    GROUP BY status
""", date_params, as_dict=True)

purchase_orders = frappe.db.sql("""
    SELECT status, COUNT(*) count, COALESCE(SUM(base_grand_total), 0) amount
    FROM `tabPurchase Order`
    WHERE docstatus < 2 AND transaction_date BETWEEN %(from_date)s AND %(to_date)s
    GROUP BY status
""", date_params, as_dict=True)

month_rows = frappe.db.sql("""
    SELECT DATE_FORMAT(posting_date, '%%b') label,
           DATE_FORMAT(posting_date, '%%Y-%%m') month_key,
           COALESCE(SUM(CASE WHEN is_return=0 THEN base_net_total ELSE -ABS(base_net_total) END),0) revenue,
           SUM(CASE WHEN is_return=0 THEN 1 ELSE 0 END) invoices
    FROM `tabSales Invoice`
    WHERE docstatus=1 AND posting_date BETWEEN %(from_date)s AND %(to_date)s
    GROUP BY month_key, label ORDER BY month_key
""", date_params, as_dict=True)

department_rows = frappe.db.sql("""
    SELECT COALESCE(department, 'Unassigned') label, COUNT(*) value
    FROM `tabEmployee` WHERE status='Active'
    GROUP BY department ORDER BY value DESC LIMIT 8
""", as_dict=True)

has_ss_coil = frappe.db.exists("DocType", "SS Coil") and frappe.db.exists("DocType", "Coil Output")
if has_ss_coil:
    production_months = frappe.db.sql("""
        SELECT DATE_FORMAT(sc.creation, '%%b') label, DATE_FORMAT(sc.creation, '%%Y-%%m') month_key,
               COALESCE(SUM(co.actual_wt),0) output
        FROM `tabSS Coil` sc LEFT JOIN `tabCoil Output` co ON co.parent=sc.name
        WHERE DATE(sc.creation) BETWEEN %(from_date)s AND %(to_date)s
        GROUP BY month_key, label ORDER BY month_key
    """, date_params, as_dict=True)
else:
    production_months = frappe.db.sql("""
        SELECT DATE_FORMAT(se.posting_date, '%%b') label, DATE_FORMAT(se.posting_date, '%%Y-%%m') month_key,
               COALESCE(SUM(sed.qty),0) output
        FROM `tabStock Entry` se JOIN `tabStock Entry Detail` sed ON sed.parent=se.name
        WHERE se.docstatus=1 AND se.stock_entry_type='Manufacture' AND sed.is_finished_item=1
          AND se.posting_date BETWEEN %(from_date)s AND %(to_date)s
        GROUP BY month_key, label ORDER BY month_key
    """, date_params, as_dict=True)

top_products = frappe.db.sql("""
    SELECT COALESCE(i.item_group,'Uncategorised') label, COALESCE(SUM(sii.base_net_amount),0) value
    FROM `tabSales Invoice Item` sii JOIN `tabSales Invoice` si ON si.name=sii.parent
    LEFT JOIN `tabItem` i ON i.name=sii.item_code
    WHERE si.docstatus=1 AND si.is_return=0 AND si.posting_date BETWEEN %(from_date)s AND %(to_date)s
    GROUP BY i.item_group ORDER BY value DESC LIMIT 6
""", date_params, as_dict=True)

customer_group_sales = frappe.db.sql("""
    SELECT COALESCE(c.customer_group,'Unassigned') label,
           COALESCE(SUM(CASE WHEN si.is_return=0 THEN si.base_net_total ELSE -ABS(si.base_net_total) END),0) value
    FROM `tabSales Invoice` si LEFT JOIN `tabCustomer` c ON c.name=si.customer
    WHERE si.docstatus=1 AND si.posting_date BETWEEN %(from_date)s AND %(to_date)s
    GROUP BY c.customer_group ORDER BY value DESC
""", date_params, as_dict=True)

customer_group_monthly_sales = frappe.db.sql("""
    SELECT DATE_FORMAT(si.posting_date,'%%b') label,
           DATE_FORMAT(si.posting_date,'%%Y-%%m') month_key,
           COALESCE(c.customer_group,'Unassigned') customer_group,
           COALESCE(SUM(CASE WHEN si.is_return=0 THEN si.base_net_total ELSE -ABS(si.base_net_total) END),0) value
    FROM `tabSales Invoice` si LEFT JOIN `tabCustomer` c ON c.name=si.customer
    WHERE si.docstatus=1 AND si.posting_date BETWEEN %(from_date)s AND %(to_date)s
    GROUP BY month_key, label, c.customer_group ORDER BY month_key, customer_group
""", date_params, as_dict=True)

purchase_categories = frappe.db.sql("""
    SELECT COALESCE(i.item_group,'Uncategorised') label, COALESCE(SUM(pii.base_net_amount),0) value
    FROM `tabPurchase Invoice Item` pii JOIN `tabPurchase Invoice` pi ON pi.name=pii.parent
    LEFT JOIN `tabItem` i ON i.name=pii.item_code
    WHERE pi.docstatus=1 AND pi.is_return=0 AND pi.posting_date BETWEEN %(from_date)s AND %(to_date)s
    GROUP BY i.item_group ORDER BY value DESC LIMIT 6
""", date_params, as_dict=True)

recent_sales_orders = frappe.db.sql("""
    SELECT so.name, so.customer_name customer, so.status, so.transaction_date,
           so.grand_total amount, COALESCE(SUM(soi.qty),0) qty,
           SUBSTRING_INDEX(GROUP_CONCAT(COALESCE(soi.item_name,soi.item_code) ORDER BY soi.idx), ',', 1) item
    FROM `tabSales Order` so LEFT JOIN `tabSales Order Item` soi ON soi.parent=so.name
    WHERE so.docstatus < 2 AND so.transaction_date BETWEEN %(from_date)s AND %(to_date)s GROUP BY so.name ORDER BY so.modified DESC LIMIT 8
""", date_params, as_dict=True)

delivery_rows = frappe.db.sql("""
    SELECT dn.name, dn.customer_name customer, dn.status, dn.posting_date,
           COALESCE(SUM(dni.qty),0) qty,
           SUBSTRING_INDEX(GROUP_CONCAT(COALESCE(dni.item_name,dni.item_code) ORDER BY dni.idx), ',', 1) item,
           SUBSTRING_INDEX(GROUP_CONCAT(COALESCE(dni.against_sales_order,'') ORDER BY dni.idx), ',', 1) sales_order
    FROM `tabDelivery Note` dn LEFT JOIN `tabDelivery Note Item` dni ON dni.parent=dn.name
    WHERE dn.docstatus < 2 AND dn.posting_date BETWEEN %(from_date)s AND %(to_date)s GROUP BY dn.name ORDER BY dn.modified DESC LIMIT 8
""", date_params, as_dict=True)

recent_purchase_orders = frappe.db.sql("""
    SELECT po.name, po.supplier_name supplier, po.status, po.transaction_date,
           po.grand_total amount, COALESCE(SUM(poi.qty),0) qty,
           SUBSTRING_INDEX(GROUP_CONCAT(COALESCE(poi.item_name,poi.item_code) ORDER BY poi.idx), ',', 1) item
    FROM `tabPurchase Order` po LEFT JOIN `tabPurchase Order Item` poi ON poi.parent=po.name
    WHERE po.docstatus < 2 AND po.transaction_date BETWEEN %(from_date)s AND %(to_date)s GROUP BY po.name ORDER BY po.modified DESC LIMIT 8
""", date_params, as_dict=True)

recent_purchase_receipts = frappe.db.sql("""
    SELECT pr.name, pr.supplier_name supplier, pr.status, pr.posting_date,
           pr.grand_total amount, COALESCE(SUM(pri.qty),0) qty,
           SUBSTRING_INDEX(GROUP_CONCAT(COALESCE(pri.item_name,pri.item_code) ORDER BY pri.idx), ',', 1) item
    FROM `tabPurchase Receipt` pr LEFT JOIN `tabPurchase Receipt Item` pri ON pri.parent=pr.name
    WHERE pr.docstatus < 2 AND pr.posting_date BETWEEN %(from_date)s AND %(to_date)s
    GROUP BY pr.name ORDER BY pr.modified DESC LIMIT 10
""", date_params, as_dict=True)

if has_ss_coil:
    work_orders = frappe.db.sql("""
        SELECT sc.name, COALESCE(sc.job_sheet_no,sc.name) job_no, COALESCE(sc.operation,'Unassigned') operation,
               COALESCE(sc.machine,'Unassigned') machine, COALESCE(sc.grand_estimated_wt,0) target,
               sc.order_status status, COALESCE(SUM(co.actual_wt),0) actual
        FROM `tabSS Coil` sc LEFT JOIN `tabCoil Output` co ON co.parent=sc.name
        WHERE DATE(sc.creation) BETWEEN %(from_date)s AND %(to_date)s
        GROUP BY sc.name ORDER BY sc.modified DESC LIMIT 10
    """, date_params, as_dict=True)
    machine_rows = frappe.db.sql("""
        SELECT COALESCE(machine,'Unassigned') machine, COUNT(*) jobs,
               SUM(order_status='Completed') completed, SUM(order_status IN ('In Process','Partially Completed')) active
        FROM `tabSS Coil` WHERE DATE(creation) BETWEEN %(from_date)s AND %(to_date)s
        GROUP BY machine ORDER BY jobs DESC
    """, date_params, as_dict=True)
    operation_rows = frappe.db.sql("""
        SELECT COALESCE(operation,'Unassigned') operation, COUNT(*) jobs,
               SUM(order_status='Completed') completed, SUM(order_status IN ('In Process','Partially Completed')) active
        FROM `tabSS Coil` WHERE DATE(creation) BETWEEN %(from_date)s AND %(to_date)s
        GROUP BY operation ORDER BY jobs DESC
    """, date_params, as_dict=True)
else:
    work_orders = frappe.db.sql("""
        SELECT wo.name, wo.name job_no, COALESCE(wo.production_item,'Unassigned') operation,
               'Standard Work Order' machine, COALESCE(wo.qty,0) target, wo.status,
               COALESCE(wo.produced_qty,0) actual
        FROM `tabWork Order` wo WHERE wo.docstatus<2 AND DATE(wo.creation) BETWEEN %(from_date)s AND %(to_date)s
        ORDER BY wo.modified DESC LIMIT 10
    """, date_params, as_dict=True)
    machine_rows = frappe.db.sql("""
        SELECT COALESCE(workstation,'Unassigned') machine, COUNT(*) jobs,
               SUM(status='Completed') completed, SUM(status IN ('Open','Work In Progress')) active
        FROM `tabJob Card` WHERE docstatus<2 AND DATE(creation) BETWEEN %(from_date)s AND %(to_date)s
        GROUP BY workstation ORDER BY jobs DESC
    """, date_params, as_dict=True)
    operation_rows = frappe.db.sql("""
        SELECT COALESCE(operation,'Unassigned') operation, COUNT(*) jobs,
               SUM(status='Completed') completed, SUM(status IN ('Open','Work In Progress')) active
        FROM `tabJob Card` WHERE docstatus<2 AND DATE(creation) BETWEEN %(from_date)s AND %(to_date)s
        GROUP BY operation ORDER BY jobs DESC
    """, date_params, as_dict=True)

attendance_departments = frappe.db.sql("""
    SELECT COALESCE(e.department,'Unassigned') label, COUNT(DISTINCT e.name) employees,
           COUNT(DISTINCT CASE WHEN a.status IN ('Present','Work From Home','Half Day') THEN e.name END) present
    FROM `tabEmployee` e LEFT JOIN `tabAttendance` a ON a.employee=e.name
      AND a.docstatus=1 AND a.attendance_date=CURDATE()
    WHERE e.status='Active' GROUP BY e.department ORDER BY employees DESC
""", as_dict=True)

trial_balance = frappe.db.sql("""
    SELECT gl.account, a.root_type type, COALESCE(SUM(gl.debit),0) debit,
           COALESCE(SUM(gl.credit),0) credit, COALESCE(SUM(gl.debit-gl.credit),0) balance
    FROM `tabGL Entry` gl JOIN `tabAccount` a ON a.name=gl.account
    WHERE gl.is_cancelled=0 AND gl.posting_date <= CURDATE()
    GROUP BY gl.account, a.root_type HAVING ABS(SUM(gl.debit-gl.credit)) > 0.005
    ORDER BY ABS(SUM(gl.debit-gl.credit)) DESC LIMIT 12
""", as_dict=True)

pl_months = frappe.db.sql("""
    SELECT DATE_FORMAT(gl.posting_date,'%%b') label, DATE_FORMAT(gl.posting_date,'%%Y-%%m') month_key,
           SUM(CASE WHEN a.root_type='Income' THEN gl.credit-gl.debit ELSE 0 END) income,
           SUM(CASE WHEN a.root_type='Expense' THEN gl.debit-gl.credit ELSE 0 END) expense
    FROM `tabGL Entry` gl JOIN `tabAccount` a ON a.name=gl.account
    WHERE gl.is_cancelled=0 AND gl.posting_date BETWEEN %(from_date)s AND %(to_date)s
    GROUP BY month_key,label ORDER BY month_key
""", date_params, as_dict=True)

profit_loss_hierarchy = frappe.db.sql("""
    SELECT g.name, g.account_name, g.parent_account, g.root_type, g.is_group, g.lft, g.rgt,
           (SELECT COUNT(*)-1 FROM `tabAccount` p
            WHERE p.company=g.company AND p.is_group=1 AND p.root_type=g.root_type
              AND p.lft<=g.lft AND p.rgt>=g.rgt) depth,
           COALESCE((SELECT SUM(gl.debit-gl.credit)
            FROM `tabGL Entry` gl JOIN `tabAccount` leaf ON leaf.name=gl.account
            WHERE leaf.company=g.company
              AND ((g.is_group=1 AND leaf.lft>g.lft AND leaf.rgt<g.rgt) OR (g.is_group=0 AND leaf.name=g.name))
              AND gl.is_cancelled=0 AND gl.voucher_type!='Period Closing Voucher'
              AND gl.posting_date BETWEEN %(from_date)s AND %(to_date)s),0) balance
    FROM `tabAccount` g
    WHERE g.company=%(company)s AND g.root_type IN ('Income','Expense')
    ORDER BY FIELD(g.root_type,'Income','Expense'), g.lft
""", company_date_params, as_dict=True)

balance_sheet_hierarchy = frappe.db.sql("""
    SELECT g.name, g.account_name, g.parent_account, g.root_type, g.is_group, g.lft, g.rgt,
           (SELECT COUNT(*)-1 FROM `tabAccount` p
            WHERE p.company=g.company AND p.is_group=1 AND p.root_type=g.root_type
              AND p.lft<=g.lft AND p.rgt>=g.rgt) depth,
           COALESCE((SELECT SUM(gl.debit-gl.credit)
            FROM `tabGL Entry` gl JOIN `tabAccount` leaf ON leaf.name=gl.account
            WHERE leaf.company=g.company
              AND ((g.is_group=1 AND leaf.lft>g.lft AND leaf.rgt<g.rgt) OR (g.is_group=0 AND leaf.name=g.name))
              AND gl.is_cancelled=0 AND gl.posting_date<=%(to_date)s),0) balance
    FROM `tabAccount` g
    WHERE g.company=%(company)s AND g.root_type IN ('Asset','Liability','Equity')
    ORDER BY FIELD(g.root_type,'Asset','Liability','Equity'), g.lft
""", company_date_params, as_dict=True)

finished_production = frappe.db.sql("""
    SELECT se.posting_date, sed.item_code, COALESCE(i.item_name,sed.item_code) item_name,
           COALESCE(SUM(sed.qty),0) qty, COALESCE(i.stock_uom,sed.stock_uom) uom
    FROM `tabStock Entry Detail` sed JOIN `tabStock Entry` se ON se.name=sed.parent
    LEFT JOIN `tabItem` i ON i.name=sed.item_code
    WHERE se.docstatus=1 AND sed.is_finished_item=1
      AND se.posting_date BETWEEN DATE_FORMAT(%(to_date)s, '%%Y-%%m-01') AND %(to_date)s
    GROUP BY se.posting_date, sed.item_code, i.item_name, i.stock_uom, sed.stock_uom
    ORDER BY se.posting_date, sed.item_code
""", date_params, as_dict=True)

stock_row = frappe.db.sql("""
    SELECT COALESCE(SUM(actual_qty),0) qty, COALESCE(SUM(stock_value),0) value,
           COUNT(DISTINCT item_code) item_count FROM `tabBin`
""", as_dict=True)[0]

finance_rows = frappe.db.sql("""
    SELECT a.root_type, COALESCE(SUM(gl.debit-gl.credit),0) balance
    FROM `tabGL Entry` gl JOIN `tabAccount` a ON a.name=gl.account
    WHERE gl.is_cancelled=0 AND gl.posting_date <= CURDATE()
    GROUP BY a.root_type
""", as_dict=True)
finance = {}
for row in finance_rows:
    finance[str(row.root_type).lower()] = float(row.balance or 0)

def scalar(query, values=None):
    result = frappe.db.sql(query, values, as_list=True) if values else frappe.db.sql(query, as_list=True)
    return float(result[0][0] or 0) if result else 0

def clean_rows(rows):
    cleaned = []
    for row in rows:
        item = {}
        for key in row:
            value = row[key]
            if key in ["count", "invoices", "value"]:
                value = float(value or 0)
            if key in ["amount", "outstanding", "revenue"]:
                value = float(value or 0)
            item[key] = value
        cleaned.append(item)
    return cleaned

if has_ss_coil:
    jobs = scalar("SELECT COUNT(*) FROM `tabSS Coil` WHERE DATE(creation) BETWEEN %(from_date)s AND %(to_date)s", date_params)
    completed_jobs = scalar("SELECT COUNT(*) FROM `tabSS Coil` WHERE order_status='Completed' AND DATE(creation) BETWEEN %(from_date)s AND %(to_date)s", date_params)
    in_progress_jobs = scalar("SELECT COUNT(*) FROM `tabSS Coil` WHERE order_status NOT IN ('Completed','Not Started') AND DATE(creation) BETWEEN %(from_date)s AND %(to_date)s", date_params)
    output_qty = scalar("SELECT COALESCE(SUM(co.actual_wt),0) FROM `tabCoil Output` co JOIN `tabSS Coil` sc ON sc.name=co.parent WHERE DATE(sc.creation) BETWEEN %(from_date)s AND %(to_date)s", date_params)
else:
    jobs = scalar("SELECT COUNT(*) FROM `tabWork Order` WHERE docstatus<2 AND DATE(creation) BETWEEN %(from_date)s AND %(to_date)s", date_params)
    completed_jobs = scalar("SELECT COUNT(*) FROM `tabWork Order` WHERE docstatus<2 AND status='Completed' AND DATE(creation) BETWEEN %(from_date)s AND %(to_date)s", date_params)
    in_progress_jobs = scalar("SELECT COUNT(*) FROM `tabWork Order` WHERE docstatus<2 AND status NOT IN ('Completed','Not Started','Cancelled') AND DATE(creation) BETWEEN %(from_date)s AND %(to_date)s", date_params)
    output_qty = scalar("SELECT COALESCE(SUM(sed.qty),0) FROM `tabStock Entry` se JOIN `tabStock Entry Detail` sed ON sed.parent=se.name WHERE se.docstatus=1 AND se.stock_entry_type='Manufacture' AND sed.is_finished_item=1 AND se.posting_date BETWEEN %(from_date)s AND %(to_date)s", date_params)

documents = {
    "delivery_notes_today": scalar("SELECT COUNT(*) FROM `tabDelivery Note` WHERE docstatus=1 AND is_return=0 AND posting_date=%(to_date)s", date_params),
    "delivery_notes_month": scalar("SELECT COUNT(*) FROM `tabDelivery Note` WHERE docstatus=1 AND is_return=0 AND posting_date BETWEEN %(from_date)s AND %(to_date)s", date_params),
    "sales_invoices_month": scalar("SELECT COUNT(*) FROM `tabSales Invoice` WHERE docstatus=1 AND is_return=0 AND posting_date BETWEEN %(from_date)s AND %(to_date)s", date_params),
    "purchase_receipts_month": scalar("SELECT COUNT(*) FROM `tabPurchase Receipt` WHERE docstatus=1 AND is_return=0 AND posting_date BETWEEN %(from_date)s AND %(to_date)s", date_params),
    "purchase_invoices_month": scalar("SELECT COUNT(*) FROM `tabPurchase Invoice` WHERE docstatus=1 AND is_return=0 AND posting_date BETWEEN %(from_date)s AND %(to_date)s", date_params),
    "leave_applications_month": scalar("SELECT COUNT(*) FROM `tabLeave Application` WHERE docstatus=1 AND from_date <= %(to_date)s AND to_date >= %(from_date)s", date_params),
	"employee_checkins": scalar("SELECT COUNT(*) FROM `tabEmployee Checkin` WHERE DATE(time) BETWEEN %(from_date)s AND %(to_date)s", date_params),
    "payments_received_month": scalar("SELECT COALESCE(SUM(base_received_amount),0) FROM `tabPayment Entry` WHERE docstatus=1 AND payment_type='Receive' AND posting_date BETWEEN %(from_date)s AND %(to_date)s", date_params),
	"payment_entries_month": scalar("SELECT COUNT(*) FROM `tabPayment Entry` WHERE docstatus=1 AND payment_type='Receive' AND posting_date BETWEEN %(from_date)s AND %(to_date)s", date_params),
    "payroll_month": scalar("SELECT COALESCE(SUM(gross_pay),0) FROM `tabSalary Slip` WHERE docstatus=1 AND start_date <= %(to_date)s AND end_date >= %(from_date)s", date_params)
}
payroll_row = frappe.db.sql("""
    SELECT COALESCE(SUM(gross_pay),0) gross, COALESCE(SUM(total_deduction),0) deductions,
           COALESCE(SUM(net_pay),0) net
    FROM `tabSalary Slip` WHERE docstatus=1
      AND start_date <= %(to_date)s AND end_date >= %(from_date)s
""", date_params, as_dict=True)[0]
documents["payroll"] = {"gross": float(payroll_row.gross or 0), "deductions": float(payroll_row.deductions or 0), "net": float(payroll_row.net or 0)}

# Same-length preceding period, used by the KPI percentage and mini-bar indicators.
previous = {
    "Monthly Revenue": scalar("SELECT COALESCE(SUM(CASE WHEN is_return=0 THEN base_net_total ELSE -ABS(base_net_total) END),0) FROM `tabSales Invoice` WHERE docstatus=1 AND posting_date BETWEEN %(from_date)s AND %(to_date)s", previous_params),
    "Orders in Pipeline": scalar("SELECT COUNT(*) FROM `tabSales Order` WHERE docstatus<2 AND status IN ('To Deliver and Bill','To Deliver','To Bill','On Hold') AND transaction_date BETWEEN %(from_date)s AND %(to_date)s", previous_params),
    "Dispatched Today": scalar("SELECT COUNT(*) FROM `tabDelivery Note` WHERE docstatus=1 AND is_return=0 AND posting_date=%(to_date)s", previous_params),
    "Production Efficiency": scalar("SELECT COALESCE(100*SUM(order_status='Completed')/NULLIF(COUNT(*),0),0) FROM `tabSS Coil` WHERE DATE(creation) BETWEEN %(from_date)s AND %(to_date)s", previous_params),
    "Open Sales Orders": scalar("SELECT COUNT(*) FROM `tabSales Order` WHERE docstatus<2 AND status IN ('To Deliver and Bill','To Deliver','To Bill','On Hold') AND transaction_date BETWEEN %(from_date)s AND %(to_date)s", previous_params),
    "Delivery Notes": scalar("SELECT COUNT(*) FROM `tabDelivery Note` WHERE docstatus=1 AND is_return=0 AND posting_date BETWEEN %(from_date)s AND %(to_date)s", previous_params),
    "Sales Invoices": scalar("SELECT COUNT(*) FROM `tabSales Invoice` WHERE docstatus=1 AND is_return=0 AND posting_date BETWEEN %(from_date)s AND %(to_date)s", previous_params),
    "Payments Received": scalar("SELECT COALESCE(SUM(base_received_amount),0) FROM `tabPayment Entry` WHERE docstatus=1 AND payment_type='Receive' AND posting_date BETWEEN %(from_date)s AND %(to_date)s", previous_params),
    "Purchase Orders": scalar("SELECT COUNT(*) FROM `tabPurchase Order` WHERE docstatus<2 AND transaction_date BETWEEN %(from_date)s AND %(to_date)s", previous_params),
    "Receipts (GRN)": scalar("SELECT COUNT(*) FROM `tabPurchase Receipt` WHERE docstatus=1 AND is_return=0 AND posting_date BETWEEN %(from_date)s AND %(to_date)s", previous_params),
    "Purchase Invoices": scalar("SELECT COUNT(*) FROM `tabPurchase Invoice` WHERE docstatus=1 AND is_return=0 AND posting_date BETWEEN %(from_date)s AND %(to_date)s", previous_params),
    "Monthly Payroll": scalar("SELECT COALESCE(SUM(gross_pay),0) FROM `tabSalary Slip` WHERE docstatus=1 AND start_date<=%(to_date)s AND end_date>=%(from_date)s", previous_params),
    "Leave Applications": scalar("SELECT COUNT(*) FROM `tabLeave Application` WHERE docstatus=1 AND from_date<=%(to_date)s AND to_date>=%(from_date)s", previous_params),
    "Net Revenue (MTD)": scalar("SELECT COALESCE(SUM(CASE WHEN is_return=0 THEN base_net_total ELSE -ABS(base_net_total) END),0) FROM `tabSales Invoice` WHERE docstatus=1 AND posting_date BETWEEN %(from_date)s AND %(to_date)s", previous_params),
    "Cost of Goods Sold": scalar("SELECT COALESCE(SUM(gl.debit-gl.credit),0) FROM `tabGL Entry` gl JOIN `tabAccount` a ON a.name=gl.account WHERE gl.is_cancelled=0 AND gl.voucher_type!='Period Closing Voucher' AND gl.posting_date BETWEEN %(from_date)s AND %(to_date)s AND a.account_type='Cost of Goods Sold'", previous_params),
    "Net Profit": scalar("SELECT COALESCE(SUM(CASE WHEN a.root_type='Income' THEN gl.credit-gl.debit WHEN a.root_type='Expense' THEN gl.credit-gl.debit ELSE 0 END),0) FROM `tabGL Entry` gl JOIN `tabAccount` a ON a.name=gl.account WHERE gl.is_cancelled=0 AND gl.voucher_type!='Period Closing Voucher' AND gl.posting_date BETWEEN %(from_date)s AND %(to_date)s AND a.root_type IN ('Income','Expense')", previous_params)
}

frappe.response["message"] = {
    "generated_at": str(frappe.db.sql("SELECT NOW()", as_list=True)[0][0]),
    "currency": company_info.default_currency or "PKR",
	"company": company_info.company_name or company_info.name,
    "sales": {"orders": clean_rows(sales_orders), "invoices": clean_rows(sales_invoices), "months": clean_rows(month_rows), "customer_groups": clean_rows(customer_group_sales), "customer_group_months": clean_rows(customer_group_monthly_sales), "top_products": clean_rows(top_products), "recent_orders": clean_rows(recent_sales_orders), "deliveries": clean_rows(delivery_rows)},
    "purchases": {"orders": clean_rows(purchase_orders), "categories": clean_rows(purchase_categories), "recent_orders": clean_rows(recent_purchase_orders), "receipts": clean_rows(recent_purchase_receipts)},
    "stock": {"qty": float(stock_row.qty or 0), "value": float(stock_row.value or 0), "items": int(stock_row.item_count or 0), "low_stock": 0},
    "production": {"jobs": int(jobs), "completed": int(completed_jobs), "in_progress": int(in_progress_jobs), "output_qty": output_qty, "months": clean_rows(production_months), "work_orders": clean_rows(work_orders), "machines": clean_rows(machine_rows), "operations": clean_rows(operation_rows), "finished_goods": clean_rows(finished_production)},
    "hr": {
        "employees": int(scalar("SELECT COUNT(*) FROM `tabEmployee` WHERE status='Active'")),
        "present": int(scalar("SELECT COUNT(*) FROM `tabAttendance` WHERE docstatus=1 AND attendance_date=CURDATE() AND status IN ('Present','Work From Home','Half Day')")),
        "on_leave": int(scalar("SELECT COUNT(*) FROM `tabAttendance` WHERE docstatus=1 AND attendance_date=CURDATE() AND status='On Leave'")),
        "departments": clean_rows(department_rows), "attendance_departments": clean_rows(attendance_departments)
    },
    "finance": {
        "asset": finance.get("asset", 0), "expense": finance.get("expense", 0),
        "income": finance.get("income", 0), "liability": finance.get("liability", 0),
        "receivable": scalar("SELECT COALESCE(SUM(outstanding_amount),0) FROM `tabSales Invoice` WHERE docstatus=1 AND is_return=0"),
        "payable": scalar("SELECT COALESCE(SUM(outstanding_amount),0) FROM `tabPurchase Invoice` WHERE docstatus=1 AND is_return=0"),
		"bank_balance": scalar("SELECT COALESCE(SUM(gl.debit-gl.credit),0) FROM `tabGL Entry` gl JOIN `tabAccount` a ON a.name=gl.account WHERE gl.is_cancelled=0 AND gl.posting_date<=%(to_date)s AND a.account_type IN ('Bank','Cash')", date_params),
		"cogs": scalar("SELECT COALESCE(SUM(gl.debit-gl.credit),0) FROM `tabGL Entry` gl JOIN `tabAccount` a ON a.name=gl.account WHERE gl.is_cancelled=0 AND gl.voucher_type!='Period Closing Voucher' AND gl.posting_date BETWEEN %(from_date)s AND %(to_date)s AND a.account_type='Cost of Goods Sold'", date_params),
        "stock_value": float(stock_row.value or 0)
    },
    "documents": documents,
    "trial_balance": clean_rows(trial_balance),
    "pl_months": clean_rows(pl_months)
	,"profit_loss_hierarchy": clean_rows(profit_loss_hierarchy)
	,"balance_sheet_hierarchy": clean_rows(balance_sheet_hierarchy)
    ,"filters": {"from_date": from_date, "to_date": to_date}
    ,"previous": previous
}
