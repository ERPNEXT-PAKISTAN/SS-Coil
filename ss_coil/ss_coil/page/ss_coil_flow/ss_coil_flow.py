"""API for the SS Coil Flow desk page."""

import frappe


@frappe.whitelist()
def get_ss_coil_flow_stats():
	"""Return open document counts for each step in the process flow."""
	return {
		"stock_entry": frappe.db.count("Stock Entry", {"docstatus": ["<", 2]}),
		"purchase_receipt": frappe.db.count("Purchase Receipt", {"docstatus": ["<", 2]}),
		"sales_order": frappe.db.count("Sales Order", {"docstatus": ["<", 2]}),
		"ss_coil": frappe.db.count("SS Coil"),
		"delivery_note": frappe.db.count("Delivery Note", {"docstatus": ["<", 2]}),
		"sales_invoice": frappe.db.count("Sales Invoice", {"docstatus": ["<", 2]}),
	}
