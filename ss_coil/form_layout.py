import json
import os

import frappe

LAYOUT_DOCTYPES = {
	"Stock Entry",
	"Stock Entry Detail",
	"Sales Order",
	"Sales Order Item",
	"Purchase Receipt Item",
	"SS Coil",
}

LAYOUT_PROPERTIES = {"field_order", "hidden", "button_color"}


@frappe.whitelist()
def sync_coil_form_layouts():
	"""Apply Stock Entry / Sales Order field layout from app fixtures on every install/migrate."""
	_apply_fixture_property_setters()
	remove_sales_order_empty_custom_column_breaks()
	remove_sales_order_item_legacy_columns()
	_sync_stock_entry_job_purpose_field()
	_ensure_stock_entry_detail_field_order()
	ensure_ss_coil_job_sheet_field_order()
	ensure_ss_coil_cutting_scheme_field_order()
	ensure_ss_coil_thickness_field_order()
	ensure_sales_order_other_tab_field_order()
	ensure_sales_order_customer_section_field_order()
	ensure_sales_order_job_sheet_field_order()
	ensure_item_ss_coil_field_order()
	frappe.clear_cache(doctype="Stock Entry")
	frappe.clear_cache(doctype="Stock Entry Detail")
	frappe.clear_cache(doctype="Sales Order")
	frappe.clear_cache(doctype="Sales Order Item")
	frappe.clear_cache(doctype="Purchase Receipt Item")
	frappe.clear_cache(doctype="SS Coil")
	frappe.clear_cache(doctype="Item")


SALES_ORDER_EMPTY_COLUMN_BREAKS = (
	"custom_column_break_c68bo",
	"custom_column_break_vy7hm",
	"custom_column_break_jom2z",
	"custom_column_break_ooacy",
)


def remove_sales_order_empty_custom_column_breaks():
	"""Remove the four site-created empty Sales Order columns reported by users."""
	targets = set(SALES_ORDER_EMPTY_COLUMN_BREAKS)
	fields = frappe.get_all(
		"Custom Field",
		filters={"dt": "Sales Order"},
		fields=["name", "fieldname", "insert_after"],
	)
	by_fieldname = {row.fieldname: row for row in fields}
	to_delete = [by_fieldname[name] for name in targets if name in by_fieldname]
	if not to_delete:
		return

	def resolve_anchor(fieldname):
		seen = set()
		while fieldname in targets and fieldname not in seen:
			seen.add(fieldname)
			fieldname = (by_fieldname.get(fieldname) or {}).get("insert_after")
		return fieldname or "customer_section"

	for row in fields:
		if row.insert_after in targets and row.fieldname not in targets:
			frappe.db.set_value(
				"Custom Field",
				row.name,
				"insert_after",
				resolve_anchor(row.insert_after),
				update_modified=False,
			)

	for row in to_delete:
		frappe.delete_doc("Custom Field", row.name, force=True, ignore_permissions=True)

	ps_name = "Sales Order-main-field_order"
	if frappe.db.exists("Property Setter", ps_name):
		order = json.loads(frappe.db.get_value("Property Setter", ps_name, "value") or "[]")
		cleaned = [fieldname for fieldname in order if fieldname not in targets]
		if cleaned != order:
			frappe.db.set_value("Property Setter", ps_name, "value", json.dumps(cleaned), update_modified=False)
	frappe.clear_cache(doctype="Sales Order")


def remove_sales_order_item_legacy_columns():
	"""Restore the five-column Tag No section by removing legacy layout breaks."""
	doctype = "Sales Order Item"
	legacy = {
		"custom_column_break_tr3fl": "custom_js_number",
		"custom_column_break_vphoe": "custom_comments",
	}
	for fieldname, anchor in legacy.items():
		for dependent in frappe.get_all(
			"Custom Field", filters={"dt": doctype, "insert_after": fieldname}, pluck="name"
		):
			frappe.db.set_value("Custom Field", dependent, "insert_after", anchor)
		name = f"{doctype}-{fieldname}"
		if frappe.db.get_value("Custom Field", name, "fieldtype") == "Column Break":
			frappe.delete_doc("Custom Field", name, force=True, ignore_permissions=True)
	for setter in frappe.get_all(
		"Property Setter",
		filters={"doc_type": doctype, "property": "field_order"},
		fields=["name", "value"],
	):
		order = json.loads(setter.value or "[]")
		cleaned = [fieldname for fieldname in order if fieldname not in legacy]
		if cleaned != order:
			frappe.db.set_value("Property Setter", setter.name, "value", json.dumps(cleaned))
	frappe.clear_cache(doctype=doctype)


def _apply_fixture_property_setters():
	fixture_path = os.path.join(frappe.get_app_path("ss_coil"), "fixtures", "property_setter.json")
	if not os.path.exists(fixture_path):
		return

	with open(fixture_path, encoding="utf-8") as handle:
		records = json.load(handle)

	for record in records:
		if record.get("doc_type") not in LAYOUT_DOCTYPES:
			continue
		if record.get("property") not in LAYOUT_PROPERTIES:
			continue
		# Keep a site's current Sales Order layout across app migrations instead
		# of resetting its manually arranged columns from this older fixture.
		if (
			record.get("doc_type") == "Sales Order"
			and record.get("property") == "field_order"
			and frappe.db.exists("Property Setter", record.get("name"))
		):
			continue

		args = {
			"doctype": record["doc_type"],
			"fieldname": record.get("field_name"),
			"property": record["property"],
			"property_type": record.get("property_type") or "Data",
			"value": record.get("value"),
		}
		name = record.get("name")
		if name and frappe.db.exists("Property Setter", name):
			frappe.db.set_value(
				"Property Setter",
				name,
				{
					"value": args["value"],
					"property_type": args["property_type"],
				},
				update_modified=False,
			)
			continue

		frappe.make_property_setter(
			{**args, "doctype_or_field": record.get("doctype_or_field") or "DocType"},
			ignore_validate=True,
			is_system_generated=False,
		)


def _sync_stock_entry_job_purpose_field():
	from frappe.custom.doctype.custom_field.custom_field import create_custom_fields

	field_spec = {
		"fieldname": "custom_job_purpose",
		"label": "Job Purpose",
		"fieldtype": "Select",
		"options": "Tolling\nOwn",
		"insert_after": "purpose",
	}
	fieldname = "Stock Entry-custom_job_purpose"

	if not frappe.db.exists("Custom Field", fieldname):
		create_custom_fields({"Stock Entry": [field_spec]}, update=True)
		return

	frappe.db.set_value(
		"Custom Field",
		fieldname,
		field_spec,
		update_modified=False,
	)


def _ensure_stock_entry_detail_field_order():
	ps_name = "Stock Entry Detail-main-field_order"
	if not frappe.db.exists("Property Setter", ps_name):
		return

	order = json.loads(frappe.db.get_value("Property Setter", ps_name, "value") or "[]")
	changed = False

	if "custom_create_tag_no" not in order and "custom_tag_no" in order:
		order.insert(order.index("custom_tag_no") + 1, "custom_create_tag_no")
		changed = True

	if "custom_finish_good_item" not in order:
		anchor = "item_name" if "item_name" in order else "item_code"
		if anchor in order:
			order.insert(order.index(anchor) + 1, "custom_finish_good_item")
			changed = True

	process_fields = (
		"custom_section_break_gbgwe",
		"custom_slitter",
		"custom_column_break_kidd0",
		"custom_leveler",
		"custom_column_break_ehrzk",
		"custom_reshearing",
	)
	if "custom_qty_of_coil" in order:
		insert_at = order.index("custom_qty_of_coil") + 1
		for fieldname in process_fields:
			if fieldname in order:
				continue
			order.insert(insert_at, fieldname)
			insert_at += 1
			changed = True

	if changed:
		frappe.db.set_value("Property Setter", ps_name, "value", json.dumps(order), update_modified=False)


# Machine / cutting / signature fields belong on the Details tab.
# They used to be dumped onto the Job Sheet tab, which squeezed the HTML report into a column.
SS_COIL_JOB_SHEET_INTRUDER_FIELDS = (
	"section_break_wqal",
	"special_instructions",
	"column_break_lnsp",
	"remarks",
	"section_break_ifey",
	"planning",
	"column_break_aovo",
	"sales",
	"column_break_titn",
	"produciton",
	"column_break_ueot",
	"encoded_by",
)

SS_COIL_JOB_SHEET_FIELD_SEQUENCE = (
	"job_sheet_tab",
	"section_break_job_sheet_html",
	"job_sheet_report",
)


def ensure_ss_coil_job_sheet_field_order():
	"""Job Sheet tab holds only a full-width HTML report."""
	ps_name = "SS Coil-main-field_order"
	if not frappe.db.exists("Property Setter", ps_name):
		return

	meta = frappe.get_meta("SS Coil")
	order = json.loads(frappe.db.get_value("Property Setter", ps_name, "value") or "[]")

	intruders = [fn for fn in SS_COIL_JOB_SHEET_INTRUDER_FIELDS if meta.get_field(fn)]
	for fieldname in intruders:
		while fieldname in order:
			order.remove(fieldname)

	restore_at = len(order)
	if "dashboard_tab" in order:
		restore_at = order.index("dashboard_tab")
	elif "cutting_scheme" in order:
		restore_at = order.index("cutting_scheme") + 1
	for idx, fieldname in enumerate(intruders):
		order.insert(restore_at + idx, fieldname)

	for fieldname in SS_COIL_JOB_SHEET_FIELD_SEQUENCE:
		while fieldname in order:
			order.remove(fieldname)

	tail = [fn for fn in SS_COIL_JOB_SHEET_FIELD_SEQUENCE if meta.get_field(fn)]
	if tail:
		insert_at = len(order)
		for anchor in ("formula_tab", "formulas"):
			if anchor in order:
				insert_at = min(insert_at, order.index(anchor))
		for idx, fieldname in enumerate(tail):
			order.insert(insert_at + idx, fieldname)

	frappe.db.set_value("Property Setter", ps_name, "value", json.dumps(order), update_modified=False)


SS_COIL_CUTTING_SCHEME_FIELD_SEQUENCE = (
	"cutting_scheme",
	"section_break_xqer",
	"machine",
	"column_break_kqkz",
	"calc_ratio",
	"column_break_etcy",
	"calc_ratio_2",
	"column_break_twrr",
	"actual_ratio",
	"column_break_rtqo",
	"remaining_width",
	"section_break_ajao",
	"cutting_detail",
	"grand_total_width",
)

SS_COIL_CUTTING_SCHEME_STRAY_FIELDS = ()


def ensure_ss_coil_cutting_scheme_field_order():
	"""Keep the yellow Cutting Scheme button as the section name, then machine, ratios, and the table."""
	ps_name = "SS Coil-main-field_order"
	if not frappe.db.exists("Property Setter", ps_name):
		return

	meta = frappe.get_meta("SS Coil")
	order = json.loads(frappe.db.get_value("Property Setter", ps_name, "value") or "[]")
	for fieldname in list(SS_COIL_CUTTING_SCHEME_FIELD_SEQUENCE) + list(SS_COIL_CUTTING_SCHEME_STRAY_FIELDS):
		while fieldname in order:
			order.remove(fieldname)

	if "section_break_fkea" not in order:
		return
	insert_at = order.index("section_break_fkea") + 1
	for idx, fieldname in enumerate(SS_COIL_CUTTING_SCHEME_FIELD_SEQUENCE):
		if meta.get_field(fieldname):
			order.insert(insert_at + idx, fieldname)

	frappe.db.set_value("Property Setter", ps_name, "value", json.dumps(order), update_modified=False)


SS_COIL_THICKNESS_FIELD_SEQUENCE = (
	"width",
	"mill",
	"column_break_cwla",
	"ds",
	"specifications",
	"column_break_afmq",
	"ctr",
	"commodity",
	"column_break_evbq",
	"ws",
	"works",
)

SS_COIL_THICKNESS_STRAY_FIELDS = (
	"thickness",
	"section_break_qasa",
	"column_break_slet",
	"section_break_zbvk",
	"column_break_ajyx",
	"column_break_kbpk",
	"column_break_yzap",
)


def ensure_ss_coil_thickness_field_order():
	"""Keep Width/DS/CTR/WS and Mill/Specifications/Commodity/Works in Thickness."""
	ps_name = "SS Coil-main-field_order"
	if not frappe.db.exists("Property Setter", ps_name):
		return

	meta = frappe.get_meta("SS Coil")
	order = json.loads(frappe.db.get_value("Property Setter", ps_name, "value") or "[]")
	for fieldname in list(SS_COIL_THICKNESS_FIELD_SEQUENCE) + list(SS_COIL_THICKNESS_STRAY_FIELDS):
		while fieldname in order:
			order.remove(fieldname)

	if "section_break_lmaa" not in order:
		return
	insert_at = order.index("section_break_lmaa") + 1
	for idx, fieldname in enumerate(SS_COIL_THICKNESS_FIELD_SEQUENCE):
		if meta.get_field(fieldname):
			order.insert(insert_at + idx, fieldname)

	frappe.db.set_value("Property Setter", ps_name, "value", json.dumps(order), update_modified=False)


SALES_ORDER_JOB_SHEET_FIELD_SEQUENCE = (
	"custom_job_sheet_tab",
	"custom_job_sheet_report",
)


SALES_ORDER_CUSTOMER_SECTION_FIELD_SEQUENCE = (
	"customer_section",
	"column_break0",
	"naming_series",
	"customer",
	"custom_source_stock_entries",
	"customer_name",
	"column_break_7",
	"transaction_date",
	"transaction_time",
	"delivery_date",
	"column_break1",
	"custom_igp_no",
	"custom_for_customer",
	"custom_column_break_rmdpf",
	"tax_id",
	"skip_delivery_note",
	"has_unit_price_items",
	"amended_from",
	"title",
	"custom_column_break_ixxzz",
	"custom_driver_name",
	"custom_vehicle_no",
)


def ensure_sales_order_customer_section_field_order():
	"""Keep the five populated customer-section columns as part of the app layout."""
	ps_name = "Sales Order-main-field_order"
	if not frappe.db.exists("Property Setter", ps_name):
		return

	meta = frappe.get_meta("Sales Order")
	order = json.loads(frappe.db.get_value("Property Setter", ps_name, "value") or "[]")
	section_fields = [
		fieldname for fieldname in SALES_ORDER_CUSTOMER_SECTION_FIELD_SEQUENCE if meta.get_field(fieldname)
	]
	for fieldname in set(section_fields) | {"section_break_zstt"}:
		while fieldname in order:
			order.remove(fieldname)

	anchor = "items_section"
	insert_at = order.index(anchor) if anchor in order else len(order)
	order[insert_at:insert_at] = section_fields
	frappe.db.set_value("Property Setter", ps_name, "value", json.dumps(order), update_modified=False)
	frappe.clear_cache(doctype="Sales Order")


def ensure_sales_order_other_tab_field_order():
	"""Move secondary Sales Order settings into an app-managed Other tab."""
	from frappe.custom.doctype.custom_field.custom_field import create_custom_fields

	tab_name = "Sales Order-custom_other_tab"
	if not frappe.db.exists("Custom Field", tab_name):
		create_custom_fields(
			{
				"Sales Order": [
					{
						"fieldname": "custom_other_tab",
						"label": "Other",
						"fieldtype": "Tab Break",
						"insert_after": "party_account_currency",
						"module": "SS Coil",
					}
				]
			},
			update=True,
		)

	ps_name = "Sales Order-main-field_order"
	if not frappe.db.exists("Property Setter", ps_name):
		return

	meta = frappe.get_meta("Sales Order")
	order = json.loads(frappe.db.get_value("Property Setter", ps_name, "value") or "[]")

	# Preserve intentional populated columns while moving whole sections into Other.
	def take_section(start, stop):
		if start not in order:
			return []
		start_at = order.index(start)
		stop_at = order.index(stop, start_at + 1) if stop in order[start_at + 1 :] else len(order)
		return [fieldname for fieldname in order[start_at:stop_at] if meta.get_field(fieldname)]

	other_fields = [
		fieldname
		for fieldname in ("company", "order_type", "is_subcontracted")
		if fieldname in order and meta.get_field(fieldname)
	]
	other_fields += take_section("accounting_dimensions_section", "currency_and_price_list")
	other_fields += take_section("currency_and_price_list", "sec_warehouse")
	other_fields += take_section("sec_warehouse", "items_section")

	for fieldname in set(other_fields) | {"custom_other_tab"}:
		while fieldname in order:
			order.remove(fieldname)

	if not meta.get_field("custom_other_tab"):
		frappe.clear_cache(doctype="Sales Order")
		meta = frappe.get_meta("Sales Order", refresh=True)

	insert_at = order.index("connections_tab") if "connections_tab" in order else len(order)
	other_fields = [fieldname for fieldname in other_fields if meta.get_field(fieldname)]
	order[insert_at:insert_at] = ["custom_other_tab", *other_fields]
	frappe.db.set_value("Property Setter", ps_name, "value", json.dumps(order), update_modified=False)
	frappe.clear_cache(doctype="Sales Order")


def _remove_empty_sales_order_columns(order, meta):
	"""Drop column breaks with no visible fields on either side."""
	break_types = {"Section Break", "Tab Break", "Column Break"}
	remove = set()
	for index, fieldname in enumerate(order):
		field = meta.get_field(fieldname)
		if not field or field.fieldtype != "Column Break":
			continue

		left = []
		for candidate in reversed(order[:index]):
			candidate_field = meta.get_field(candidate)
			if candidate_field and candidate_field.fieldtype in break_types:
				break
			if candidate_field and not candidate_field.hidden:
				left.append(candidate_field)

		right = []
		for candidate in order[index + 1 :]:
			candidate_field = meta.get_field(candidate)
			if candidate_field and candidate_field.fieldtype in break_types:
				break
			if candidate_field and not candidate_field.hidden:
				right.append(candidate_field)

		if not left or not right:
			remove.add(fieldname)
	return [fieldname for fieldname in order if fieldname not in remove]


def ensure_sales_order_job_sheet_field_order():
	"""Append missing Job Sheet fields without rearranging the saved Sales Order layout."""
	ps_name = "Sales Order-main-field_order"
	if not frappe.db.exists("Property Setter", ps_name):
		return

	meta = frappe.get_meta("Sales Order")
	order = json.loads(frappe.db.get_value("Property Setter", ps_name, "value") or "[]")

	missing = [
		fieldname
		for fieldname in SALES_ORDER_JOB_SHEET_FIELD_SEQUENCE
		if meta.get_field(fieldname) and not meta.get_field(fieldname).hidden and fieldname not in order
	]
	if not missing:
		return

	order.extend(missing)
	frappe.db.set_value("Property Setter", ps_name, "value", json.dumps(order), update_modified=False)


# Last standard field of Item Details tab, first section. SS Coil is the 2nd section.
ITEM_SS_COIL_SECTION_ANCHOR = "asset_naming_series"
ITEM_SS_COIL_FIELD_SEQUENCE = (
	"custom_ss_coil_section",
	"custom_ss_coil_item_type",
	"custom_default_raw_material_item",
	"custom_ss_coil_column_break",
	"custom_create_tag_on_receipt",
	"custom_use_tag_as_batch_no",
)
ITEM_SS_COIL_INSERT_AFTER = {
	"custom_ss_coil_section": ITEM_SS_COIL_SECTION_ANCHOR,
	"custom_ss_coil_item_type": "custom_ss_coil_section",
	"custom_default_raw_material_item": "custom_ss_coil_item_type",
	"custom_ss_coil_column_break": "custom_default_raw_material_item",
	"custom_create_tag_on_receipt": "custom_ss_coil_column_break",
	"custom_use_tag_as_batch_no": "custom_create_tag_on_receipt",
}


def ensure_item_ss_coil_field_order():
	"""Keep SS Coil fields in the 2nd Details section; leave default Item layout alone."""
	for fieldname, insert_after in ITEM_SS_COIL_INSERT_AFTER.items():
		name = f"Item-{fieldname}"
		if frappe.db.exists("Custom Field", name):
			frappe.db.set_value(
				"Custom Field",
				name,
				{"insert_after": insert_after, "module": "SS Coil"},
				update_modified=False,
			)

	ps_name = "Item-main-field_order"
	if not frappe.db.exists("Property Setter", ps_name):
		return

	order = json.loads(frappe.db.get_value("Property Setter", ps_name, "value") or "[]")
	if not order:
		return

	for fieldname in ITEM_SS_COIL_FIELD_SEQUENCE:
		while fieldname in order:
			order.remove(fieldname)

	meta = frappe.get_meta("Item")
	block = [fn for fn in ITEM_SS_COIL_FIELD_SEQUENCE if meta.get_field(fn)]
	if not block:
		return

	insert_at = 0
	if ITEM_SS_COIL_SECTION_ANCHOR in order:
		insert_at = order.index(ITEM_SS_COIL_SECTION_ANCHOR) + 1
	else:
		for idx, fieldname in enumerate(order):
			df = meta.get_field(fieldname)
			if df and df.fieldtype == "Section Break":
				insert_at = idx
				break

	for offset, fieldname in enumerate(block):
		order.insert(insert_at + offset, fieldname)

	# Keep the next standard Item section after SS Coil so it is not injected
	# back between asset_naming_series and this app's section.
	next_standard_section = "section_break_zlmj"
	after_block = insert_at + len(block)
	if next_standard_section in order:
		order.remove(next_standard_section)
	if meta.get_field(next_standard_section):
		order.insert(after_block, next_standard_section)

	frappe.db.set_value("Property Setter", ps_name, "value", json.dumps(order), update_modified=False)
