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
	sync_stock_entry_sticker_print_formats()
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


def sync_stock_entry_sticker_print_formats():
	"""Push sticker print HTML from app files into Print Format (required for print/PDF)."""
	import os

	formats = {
		"stock_entry_sticker": ("Stock Entry Sticker", {"margin_top": 3, "margin_bottom": 3, "margin_left": 3, "margin_right": 3}),
		"stock_entry_sticker_thermal": (
			"Stock Entry Sticker Thermal",
			{"margin_top": 0, "margin_bottom": 0, "margin_left": 0, "margin_right": 0},
		),
		"ss_coil_sticker": ("SS Coil Sticker", {"margin_top": 3, "margin_bottom": 3, "margin_left": 3, "margin_right": 3}),
		"ss_coil_sticker_thermal": (
			"SS Coil Sticker Thermal",
			{"margin_top": 0, "margin_bottom": 0, "margin_left": 0, "margin_right": 0},
		),
	}

	for folder, (name, margins) in formats.items():
		json_path = frappe.get_app_path("ss_coil", "ss_coil", "print_format", folder, f"{folder}.json")
		if not frappe.db.exists("Print Format", name) and os.path.exists(json_path):
			frappe.modules.import_file.import_file_by_path(json_path, force=True, ignore_links=True)

		if not frappe.db.exists("Print Format", name):
			continue

		html_path = frappe.get_app_path("ss_coil", "ss_coil", "print_format", folder, f"{folder}.html")
		if os.path.exists(html_path):
			with open(html_path) as handle:
				html = handle.read().strip()
			if html:
				frappe.db.set_value("Print Format", name, "html", html, update_modified=False)
		frappe.db.set_value("Print Format", name, margins, update_modified=False)
