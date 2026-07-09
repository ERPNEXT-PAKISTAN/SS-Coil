import frappe


def after_install():
	run_post_install_setup()


def after_migrate():
	run_post_install_setup()


def run_post_install_setup():
	"""Ensure tag-origin custom fields exist after install or migrate."""
	from ss_coil.api import setup_tag_origin_fields

	setup_tag_origin_fields()
	frappe.db.commit()
