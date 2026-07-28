import frappe

from ss_coil.api import setup_length_c_and_length_fields


def execute():
	"""Ensure custom_length_c label is Length C (not C) on all coil doctypes."""
	setup_length_c_and_length_fields()
	frappe.db.commit()
