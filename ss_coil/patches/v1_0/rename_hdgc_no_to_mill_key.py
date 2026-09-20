"""Rename HDGC No → Mill Key (fieldname + label) on coil child tables."""

from __future__ import annotations

import frappe

OLD_CUSTOM = "custom_hdgc_no"
NEW_CUSTOM = "custom_mill_key"
NEW_LABEL = "Mill Key"

OLD_NATIVE = "hdgc_no"
NEW_NATIVE = "mill_key"
NATIVE_DOCTYPE = "Coil Production Line"

CUSTOM_FIELD_DOCTYPES = (
	"Stock Entry Detail",
	"Purchase Receipt Item",
	"Sales Order Item",
	"Delivery Note Item",
	"Sales Invoice Item",
	"Purchase Invoice Item",
)


def _rename_column(doctype: str, old: str, new: str) -> None:
	table = f"tab{doctype}"
	if not frappe.db.table_exists(doctype):
		return
	has_old = frappe.db.has_column(doctype, old)
	has_new = frappe.db.has_column(doctype, new)
	if has_old and not has_new:
		frappe.db.sql_ddl(f"ALTER TABLE `{table}` CHANGE `{old}` `{new}` varchar(140) NULL")
	elif has_old and has_new:
		frappe.db.sql(
			f"""
			UPDATE `{table}`
			SET `{new}` = `{old}`
			WHERE IFNULL(`{new}`, '') = '' AND IFNULL(`{old}`, '') != ''
			"""
		)
		try:
			frappe.db.sql_ddl(f"ALTER TABLE `{table}` DROP COLUMN `{old}`")
		except Exception:
			frappe.log_error(title=f"ss_coil: drop column {doctype}.{old}")


def _rename_custom_field(doctype: str) -> None:
	old_name = f"{doctype}-{OLD_CUSTOM}"
	new_name = f"{doctype}-{NEW_CUSTOM}"

	_rename_column(doctype, OLD_CUSTOM, NEW_CUSTOM)

	if frappe.db.exists("Custom Field", old_name):
		frappe.db.set_value(
			"Custom Field",
			old_name,
			{"fieldname": NEW_CUSTOM, "label": NEW_LABEL},
			update_modified=False,
		)
		if old_name != new_name and not frappe.db.exists("Custom Field", new_name):
			frappe.rename_doc("Custom Field", old_name, new_name, force=True, show_alert=False)
		elif old_name != new_name and frappe.db.exists("Custom Field", new_name):
			frappe.delete_doc("Custom Field", old_name, force=1, ignore_permissions=True)
	elif frappe.db.exists("Custom Field", new_name):
		frappe.db.set_value(
			"Custom Field",
			new_name,
			{"fieldname": NEW_CUSTOM, "label": NEW_LABEL},
			update_modified=False,
		)

	frappe.db.sql(
		"""
		UPDATE `tabCustom Field`
		SET insert_after = %s
		WHERE dt = %s AND insert_after = %s
		""",
		(NEW_CUSTOM, doctype, OLD_CUSTOM),
	)


def _update_property_setter_field_order(doctype: str) -> None:
	for ps in frappe.get_all(
		"Property Setter",
		filters={"doc_type": doctype, "property": "field_order"},
		fields=["name", "value"],
	):
		if not ps.value or OLD_CUSTOM not in ps.value:
			continue
		frappe.db.set_value(
			"Property Setter",
			ps.name,
			"value",
			ps.value.replace(OLD_CUSTOM, NEW_CUSTOM),
			update_modified=False,
		)


def execute():
	_rename_column(NATIVE_DOCTYPE, OLD_NATIVE, NEW_NATIVE)

	for dt in CUSTOM_FIELD_DOCTYPES:
		_rename_custom_field(dt)
		_update_property_setter_field_order(dt)

	frappe.clear_cache()
