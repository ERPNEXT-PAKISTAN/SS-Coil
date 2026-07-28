import frappe


def execute():
	from ss_coil.api import setup_ss_coil_machine_operation_link

	setup_ss_coil_machine_operation_link()
	frappe.db.commit()
