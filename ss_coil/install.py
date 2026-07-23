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
	sync_delivery_advise_print_formats()
	sync_ss_coil_detail_print_format()
	frappe.db.commit()


def sync_delivery_advise_print_formats():
	"""Keep Delivery Advise print HTML in the Print Format record."""
	import os

	formats = {
		"stock_entry_coil": "Stock Entry Coil",
		"sales_order_coil": "Sales Order Coil",
	}
	landscape_margins = {
		"margin_top": 6,
		"margin_bottom": 6,
		"margin_left": 6,
		"margin_right": 6,
	}

	for folder, name in formats.items():
		if not frappe.db.exists("Print Format", name):
			continue

		html_path = frappe.get_app_path("ss_coil", "ss_coil", "print_format", folder, f"{folder}.html")
		html = ""
		if os.path.exists(html_path):
			with open(html_path) as handle:
				html = handle.read().strip()

		if html:
			frappe.db.set_value("Print Format", name, "html", html, update_modified=False)
		frappe.db.set_value("Print Format", name, landscape_margins, update_modified=False)


def sync_ss_coil_detail_print_format():
	"""Keep SS Coil Detail landscape print HTML in the Print Format record."""
	import os

	name = "SS Coil Detail"
	if not frappe.db.exists("Print Format", name):
		return

	html_path = frappe.get_app_path("ss_coil", "ss_coil", "print_format", "ss_coil_detail", "ss_coil_detail.html")
	if os.path.exists(html_path):
		with open(html_path) as handle:
			html = handle.read().strip()
		if html:
			frappe.db.set_value("Print Format", name, "html", html, update_modified=False)

	frappe.db.set_value(
		"Print Format",
		name,
		{
			"margin_top": 6,
			"margin_bottom": 6,
			"margin_left": 6,
			"margin_right": 6,
		},
		update_modified=False,
	)
