import frappe


def run_post_install_setup():
	"""Ensure tag-origin custom fields and form layouts exist after install or migrate."""
	ensure_coil_balance_types()
	seed_international_thickness_tolerance_table()
	from ss_coil.api import (
		setup_length_c_and_length_fields,
		setup_sales_order_job_sheet_fields,
		setup_ss_coil_machine_operation_link,
		setup_stock_entry_sales_order_link_fields,
		setup_tag_origin_fields,
		setup_updatable_stock_entry_sales_order_property_setters,
	)
	from ss_coil.coil_item_fields import setup_coil_item_trace_fields
	from ss_coil.coil_manufacture import setup_coil_manufacture_fields
	from ss_coil.coil_production import setup_coil_production_fields
	from ss_coil.form_layout import sync_coil_form_layouts
	from ss_coil.process_charges import ensure_process_charge_items
	from ss_coil.workspace_sync import sync_ss_coil_workspace

	setup_tag_origin_fields()
	setup_ss_coil_duplicate_override_field()
	setup_stock_entry_sales_order_link_fields()
	setup_updatable_stock_entry_sales_order_property_setters()
	setup_coil_item_trace_fields()
	setup_coil_manufacture_fields()
	setup_coil_production_fields()
	setup_length_c_and_length_fields()
	sync_stock_entry_item_descriptions()
	setup_ss_coil_machine_operation_link()
	setup_sales_order_job_sheet_fields()
	ensure_process_charge_items()
	from ss_coil.inspection_setup import sync_inspection_fields
	sync_inspection_fields()
	sync_coil_form_layouts()
	sync_delivery_advise_print_formats()
	sync_ss_coil_detail_print_format()
	sync_stock_entry_sticker_print_formats()
	sync_ss_coil_job_sheet_print_format()
	sync_inspection_print_formats()
	sync_sales_contract_print_formats()
	sync_sales_contract_terms()
	sync_ss_sales_order_print_format()
	sync_ss_coil_desktop_icon()
	sync_ss_coil_workspace()
	remove_arabic_name_fields()
	remove_vat_emirate_fields()
	frappe.db.commit()


def sync_stock_entry_item_descriptions():
	"""Keep inward coil field help text aligned with the SS Coil app wording."""
	descriptions = {
		("Stock Entry Detail", "custom_finish_good_item"): "",
		("Purchase Receipt Item", "custom_finish_good_item"): "",
		("Stock Entry Detail", "custom_tag_no"): "",
		("Stock Entry Detail", "custom_length_c"): "Length of Coil which is unknown",
		("Purchase Receipt Item", "custom_length_c"): "Length of Coil which is unknown",
	}
	for (doctype, fieldname), description in descriptions.items():
		custom_field = f"{doctype}-{fieldname}"
		if frappe.db.exists("Custom Field", custom_field):
			frappe.db.set_value(
				"Custom Field", custom_field, "description", description, update_modified=False
			)
	frappe.clear_cache(doctype="Stock Entry Detail")
	frappe.clear_cache(doctype="Purchase Receipt Item")


def setup_ss_coil_duplicate_override_field():
	"""Add the explicit, opt-in override for a repeated SS Coil process entry."""
	from frappe.custom.doctype.custom_field.custom_field import create_custom_fields

	create_custom_fields(
		{
			"SS Coil": [
				{
					"fieldname": "allow_duplicate_process",
					"label": "Allow Duplicate Process Entry",
					"fieldtype": "Check",
					"default": "0",
					"insert_after": "sales_order_item",
					"description": "Explicitly allow another SS Coil for this Sales Order item and process.",
				}
			]
		},
		update=True,
	)


def ensure_coil_balance_types():
	"""Seed the default selectable types used by coil balance rows."""
	if not frappe.db.exists("DocType", "Coil Balance Type"):
		return
	for type_name in ("Unprocessed", "Leftover", "Scrap / Waste", "Fully Processed"):
		if not frappe.db.exists("Coil Balance Type", type_name):
			frappe.get_doc({
				"doctype": "Coil Balance Type",
				"type_name": type_name,
				"balance_status": type_name,
			}).insert(ignore_permissions=True)


INTERNATIONAL_THICKNESS_TOLERANCES = (
	(0.00, 0.25, 0.03, 0.03, 0.03, None, None),
	(0.25, 0.40, 0.04, 0.04, 0.04, None, None),
	(0.40, 0.60, 0.05, 0.05, 0.05, 0.06, None),
	(0.60, 0.80, 0.06, 0.06, 0.06, 0.06, 0.07),
	(0.80, 1.00, 0.06, 0.06, 0.07, 0.08, 0.09),
	(1.00, 1.25, 0.07, 0.07, 0.08, 0.09, 0.11),
	(1.25, 1.60, 0.08, 0.09, 0.10, 0.11, 0.13),
	(1.60, 2.00, 0.10, 0.11, 0.12, 0.13, 0.15),
	(2.00, 2.50, 0.12, 0.13, 0.14, 0.15, 0.17),
	(2.50, 3.15, 0.14, 0.15, 0.16, 0.17, 0.20),
	(3.15, None, 0.16, 0.17, 0.19, 0.20, None),
)


def seed_international_thickness_tolerance_table():
	"""Install the supplied Slitter thickness-by-width table once, preserving edits."""
	if not frappe.db.exists("DocType", "Tolerances on Thickness"):
		return
	name = frappe.db.get_value("Tolerances on Thickness", {"process_name": "Slitter"}, "name")
	legacy_name = frappe.db.get_value("Tolerances on Thickness", "International Standard", "name")
	if not name and legacy_name:
		frappe.rename_doc("Tolerances on Thickness", legacy_name, "Slitter", force=True)
		name = "Slitter"
	if not name:
		doc = frappe.get_doc({
			"doctype": "Tolerances on Thickness",
			"process_name": "Slitter",
			"disabled": 0,
		})
	else:
		doc = frappe.get_doc("Tolerances on Thickness", name)
	labels = (
		"Under 0.25",
		"0.25 or over to and excl. 0.40",
		"0.40 or over to and excl. 0.60",
		"0.60 or over to and excl. 0.80",
		"0.80 or over to and excl. 1.00",
		"1.00 or over to and excl. 1.25",
		"1.25 or over to and excl. 1.60",
		"1.60 or over to and excl. 2.00",
		"2.00 or over to and excl. 2.50",
		"2.50 or over to and excl. 3.15",
		"3.15 or over",
	)
	if not doc.tolerance_details:
		for index, (thickness_from, thickness_to, under_630, width_630_1000, width_1000_1250, width_1250_1600, width_1600_over) in enumerate(INTERNATIONAL_THICKNESS_TOLERANCES):
			doc.append("tolerance_details", {
				"thickness_range": labels[index],
				"thickness_from": thickness_from,
				"thickness_to": thickness_to,
				"tolerance_under_630": under_630,
				"tolerance_630_1000": width_630_1000,
				"tolerance_1000_1250": width_1000_1250,
				"tolerance_1250_1600": width_1250_1600,
				"tolerance_1600_over": width_1600_over,
			})
	else:
		for row, label in zip(doc.tolerance_details, labels):
			if not row.thickness_range:
				row.thickness_range = label
	if doc.is_new():
		doc.insert(ignore_permissions=True)
	else:
		doc.save(ignore_permissions=True)


def remove_vat_emirate_fields():
	"""Remove the UAE-only VAT Emirate customization from this Pakistan app."""
	fields = frappe.get_all(
		"Custom Field", filters={"fieldname": "vat_emirate"}, fields=["name", "dt", "insert_after"]
	)
	for field in fields:
		for name in frappe.get_all(
			"Custom Field", filters={"dt": field.dt, "insert_after": "vat_emirate"}, pluck="name"
		):
			frappe.db.set_value("Custom Field", name, "insert_after", field.insert_after or "")
		frappe.delete_doc("Custom Field", field.name, force=1, ignore_permissions=True)
		frappe.clear_cache(doctype=field.dt)


ARABIC_NAME_FIELDNAMES = (
	"customer_name_in_arabic",
	"supplier_name_in_arabic",
	"custom_company_name_in_arabic",
)


def remove_arabic_name_fields():
	"""Delete Arabic name fields so link validation does not select a missing column.

	Sales Order (and the buying/selling doctypes) fetch customer_name_in_arabic /
	supplier_name_in_arabic. When that column is not on the linked table, insert
	fails with MySQL 1054. Remove the fields on every doctype, including Customer
	and Supplier, and do not restore them from fixtures.
	"""
	names = frappe.get_all(
		"Custom Field",
		filters={"fieldname": ["in", list(ARABIC_NAME_FIELDNAMES)]},
		pluck="name",
	)
	if not names:
		return
	doctypes = set()
	for name in names:
		doctypes.add(frappe.db.get_value("Custom Field", name, "dt"))
		frappe.delete_doc("Custom Field", name, force=1, ignore_permissions=True)
	for doctype in doctypes:
		if doctype:
			frappe.clear_cache(doctype=doctype)


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


def sync_sales_contract_terms():
	"""Install the Sales Contract terms template shipped with the app.

	Creates the record when the site does not have it. An existing template
	keeps its terms text so a later migrate does not overwrite edits.
	"""
	import json
	import os
	import re

	path = os.path.join(frappe.get_app_path("ss_coil"), "fixtures", "terms_and_conditions.json")
	if not os.path.exists(path):
		return

	with open(path, encoding="utf-8") as handle:
		records = json.load(handle)

	record = next((row for row in records if row.get("name") == "Sales Contract"), None)
	if not record:
		return

	# Legacy Sales Contract templates looked up mill names on the removed
	# production table. Read the same value from the Sales Order Item rows.
	mill_template = '{{ items | map(attribute="custom_mill") | select | unique | join(", ") or custom_job_sheet_mill or "" }}'
	for key in ("terms",):
		record[key] = re.sub(
			r'{% if custom_coil_production %}.*?{% else %}{{ custom_job_sheet_mill or "" }}{% endif %}',
			mill_template,
			record.get(key) or "",
		)

	if frappe.db.exists("Terms and Conditions", "Sales Contract"):
		updates = {"selling": 1, "disabled": 0}
		current = frappe.db.get_value("Terms and Conditions", "Sales Contract", "terms")
		if "custom_coil_production" in (current or ""):
			updates["terms"] = re.sub(
				r'{% if custom_coil_production %}.*?{% else %}{{ custom_job_sheet_mill or "" }}{% endif %}',
				mill_template,
				current,
			)
		if not (current or "").strip() and record.get("terms"):
			updates["terms"] = record.get("terms")
		frappe.db.set_value("Terms and Conditions", "Sales Contract", updates, update_modified=False)
		return

	frappe.get_doc(
		{
			"doctype": "Terms and Conditions",
			"title": record.get("title") or "Sales Contract",
			"terms": record.get("terms") or "",
			"selling": 1,
			"buying": 1 if record.get("buying") else 0,
			"hr": 0,
			"disabled": 0,
		}
	).insert(ignore_permissions=True)


def sync_sales_contract_print_formats():
	"""Sales Contract (+ No Letterhead) print formats for Sales Order."""
	import os

	specs = (
		("Sales Contract", "sales_contract"),
		("Sales Contract No Letterhead", "sales_contract_no_letterhead"),
	)
	margins = {"margin_top": 10, "margin_bottom": 10, "margin_left": 10, "margin_right": 10}
	for name, folder in specs:
		json_path = frappe.get_app_path("ss_coil", "ss_coil", "print_format", folder, f"{folder}.json")
		html_path = frappe.get_app_path("ss_coil", "ss_coil", "print_format", folder, f"{folder}.html")
		if not os.path.exists(json_path) or not os.path.exists(html_path):
			continue

		if not frappe.db.exists("Print Format", name):
			frappe.modules.import_file.import_file_by_path(json_path, force=True)
		elif frappe.db.get_value("Print Format", name, "module") != "SS Coil":
			# Take over site-created format with the same title
			frappe.db.set_value(
				"Print Format",
				name,
				{
					"module": "SS Coil",
					"doc_type": "Sales Order",
					"custom_format": 1,
					"print_format_type": "Jinja",
					"standard": "No",
					"disabled": 0,
				},
				update_modified=False,
			)

		if not frappe.db.exists("Print Format", name):
			# Create manually if import skipped due to name clash
			from frappe.modules.import_file import import_file_by_path

			try:
				import_file_by_path(json_path, force=True)
			except Exception:
				doc = frappe.new_doc("Print Format")
				doc.name = name
				doc.doc_type = "Sales Order"
				doc.module = "SS Coil"
				doc.custom_format = 1
				doc.print_format_type = "Jinja"
				doc.standard = "No"
				doc.insert(ignore_permissions=True)

		with open(html_path) as handle:
			html = handle.read().strip()
		if html and frappe.db.exists("Print Format", name):
			frappe.db.set_value(
				"Print Format",
				name,
				{
					"html": html,
					"css": "",
					"custom_format": 1,
					"print_format_type": "Jinja",
					"doc_type": "Sales Order",
					"disabled": 0,
					**margins,
				},
				update_modified=False,
			)


def sync_ss_sales_order_print_format():
	"""SS Sales Order: copy of ERPNext Sales Order Standard, owned by SS Coil."""
	import os

	name = "SS Sales Order"
	folder = "ss_sales_order"
	json_path = frappe.get_app_path("ss_coil", "ss_coil", "print_format", folder, f"{folder}.json")
	html_path = frappe.get_app_path("ss_coil", "ss_coil", "print_format", folder, f"{folder}.html")
	if not os.path.exists(json_path) or not os.path.exists(html_path):
		return

	if not frappe.db.exists("Print Format", name):
		try:
			frappe.modules.import_file.import_file_by_path(json_path, force=True)
		except Exception:
			doc = frappe.new_doc("Print Format")
			doc.name = name
			doc.doc_type = "Sales Order"
			doc.module = "SS Coil"
			doc.custom_format = 1
			doc.print_format_type = "Jinja"
			doc.standard = "No"
			doc.insert(ignore_permissions=True)

	if not frappe.db.exists("Print Format", name):
		return

	with open(html_path) as handle:
		html = handle.read().strip()
	if not html:
		return

	frappe.db.set_value(
		"Print Format",
		name,
		{
			"html": html,
			"css": "",
			"custom_format": 1,
			"print_format_type": "Jinja",
			"doc_type": "Sales Order",
			"module": "SS Coil",
			"disabled": 0,
			"margin_top": 12,
			"margin_bottom": 12,
			"margin_left": 12,
			"margin_right": 12,
		},
		update_modified=False,
	)


def sync_inspection_print_formats():
	"""Install all process inspection print formats on every migration."""
	from pathlib import Path
	from frappe.modules.import_file import import_file_by_path
	for form in (1, 2, 3):
		folder = f"ss_coil_inspection_{form}"
		path = Path(frappe.get_app_path("ss_coil", "ss_coil", "print_format", folder))
		import_file_by_path(str(path / f"{folder}.json"), force=True)
		frappe.db.set_value("Print Format", f"SS Coil Inspection {form}", "html", (path / f"{folder}.html").read_text(), update_modified=False)
