import frappe

from ss_coil.api import setup_length_c_and_length_fields


def execute():
	setup_length_c_and_length_fields()
	frappe.db.commit()
