import frappe


def execute():
	if not frappe.db.has_column("SO Production Plan", "process_key"):
		return

	frappe.db.sql(
		"""
		UPDATE `tabSO Production Plan`
		SET process_key = 'slitter'
		WHERE IFNULL(process_key, '') = ''
		"""
	)
