import frappe


def after_install():
	run_post_install_setup()


def after_migrate():
	run_post_install_setup()


def run_post_install_setup():
	"""Ensure tag-origin custom fields and form layouts exist after install or migrate."""
	from ss_coil.api import setup_sales_order_job_sheet_fields, setup_tag_origin_fields
	from ss_coil.form_layout import sync_coil_form_layouts

	setup_tag_origin_fields()
	setup_sales_order_job_sheet_fields()
	sync_coil_form_layouts()
	sync_delivery_advise_print_formats()
	sync_ss_coil_detail_print_format()
	sync_stock_entry_sticker_print_formats()
	sync_ss_coil_job_sheet_print_format()
	sync_ss_coil_desktop_icon()
	frappe.db.commit()


def sync_ss_coil_desktop_icon():
	"""SS Coil app icon opens the workspace directly; keep icon visible (App permission check)."""
	import os

	from frappe.modules.import_file import import_file_by_path

	name = "SS Coil"
	json_path = frappe.get_app_path("ss_coil", "desktop_icon", "ss_coil.json")
	if not frappe.db.exists("Desktop Icon", name) and os.path.exists(json_path):
		import_file_by_path(json_path, force=True)

	if not frappe.db.exists("Desktop Icon", name):
		return

	updates = {
		"icon_type": "App",
		"app": "ss_coil",
		"link_type": "External",
		"link": "/desk/ss-coil-space",
		"hidden": 0,
	}
	frappe.db.set_value("Desktop Icon", name, updates, update_modified=False)

	# Avoid app picker modal: hide workspace shortcut icons grouped under SS Coil
	for child in frappe.get_all(
		"Desktop Icon",
		filters={"parent_icon": name},
		pluck="name",
	):
		frappe.db.set_value(
			"Desktop Icon",
			child,
			{"hidden": 1, "parent_icon": None},
			update_modified=False,
		)
	if frappe.db.exists("Desktop Icon", "SS Coil Space"):
		frappe.db.set_value(
			"Desktop Icon",
			"SS Coil Space",
			{"hidden": 1},
			update_modified=False,
		)

	from frappe.desk.doctype.desktop_icon.desktop_icon import clear_desktop_icons_cache

	clear_desktop_icons_cache()
	frappe.cache.delete_key("bootinfo")


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


def sync_ss_coil_job_sheet_print_format():
	"""Push SS Coil Job Sheet print HTML into Print Format (A4 landscape, one page)."""
	import os

	name = "SS Coil Job Sheet"
	folder = "ss_coil_job_sheet"
	margins = {"margin_top": 2, "margin_bottom": 2, "margin_left": 2, "margin_right": 2}

	json_path = frappe.get_app_path("ss_coil", "ss_coil", "print_format", folder, f"{folder}.json")
	if not frappe.db.exists("Print Format", name) and os.path.exists(json_path):
		frappe.modules.import_file.import_file_by_path(json_path, force=True)

	if not frappe.db.exists("Print Format", name):
		return

	html_path = frappe.get_app_path("ss_coil", "ss_coil", "print_format", folder, f"{folder}.html")
	if os.path.exists(html_path):
		with open(html_path) as handle:
			html = handle.read().strip()
		if html:
			frappe.db.set_value("Print Format", name, "html", html, update_modified=False)
	frappe.db.set_value("Print Format", name, margins, update_modified=False)
