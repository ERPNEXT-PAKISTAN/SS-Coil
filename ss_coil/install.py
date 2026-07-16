import frappe


def after_install():
	run_post_install_setup()


def after_migrate():
	run_post_install_setup()


def run_post_install_setup():
	"""Ensure tag-origin custom fields and form layouts exist after install or migrate."""
	from ss_coil.api import setup_tag_origin_fields
	from ss_coil.form_layout import sync_coil_form_layouts

	setup_tag_origin_fields()
	sync_coil_form_layouts()
	frappe.db.commit()
