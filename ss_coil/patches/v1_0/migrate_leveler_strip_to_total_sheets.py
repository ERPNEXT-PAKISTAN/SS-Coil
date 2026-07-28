import frappe
from frappe.utils import flt


def execute():
	if frappe.db.has_column("Cutting Scheme SO", "so_no"):
		frappe.db.sql(
			"""
			update `tabCutting Scheme SO` cs
			inner join `tabSO Production Plan` p on p.name = cs.parent
			set cs.so_no = p.sales_order
			where ifnull(cs.so_no, '') = '' and ifnull(p.sales_order, '') != ''
			"""
		)

	if not frappe.db.has_column("Cutting Scheme SO", "total_sheets"):
		return

	for plan in frappe.get_all(
		"SO Production Plan",
		filters={"process_key": ("in", ["leveler", "reshearing"])},
		fields=["name"],
	):
		for row in frappe.get_all(
			"Cutting Scheme SO",
			filters={"parent": plan.name},
			fields=["name", "strip", "total_sheets"],
		):
			if flt(row.total_sheets):
				continue
			strip = flt(row.strip)
			if strip <= 1:
				continue
			frappe.db.set_value(
				"Cutting Scheme SO",
				row.name,
				{"total_sheets": strip, "strip": 1},
				update_modified=False,
			)

	if not frappe.db.has_column("Cutting Scheme", "total_sheets"):
		return

	for coil in frappe.get_all(
		"SS Coil",
		filters={"operation": ("in", ["Leveler", "Reshearing"])},
		pluck="name",
	):
		for row in frappe.get_all(
			"Cutting Scheme",
			filters={"parent": coil},
			fields=["name", "strip", "total_sheets"],
		):
			if flt(row.total_sheets):
				continue
			strip = flt(row.strip)
			if strip <= 1:
				continue
			frappe.db.set_value(
				"Cutting Scheme",
				row.name,
				{"total_sheets": strip, "strip": 1},
				update_modified=False,
			)
