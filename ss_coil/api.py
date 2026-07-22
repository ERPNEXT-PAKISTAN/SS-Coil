"""SS Coil backend: tag lifecycle, batch creation, sticker/QR printing, SS
Coil cutting workflow, Sales Order raw-material planning, and one-time
Custom Field setup.

This file is large (grouped by feature, not alphabetical) - see
ARCHITECTURE.md at the app root for the full flow explanation and a map of
which function group does what before making changes here.
"""

import html
import json
import re
from io import BytesIO

import frappe
from frappe.custom.doctype.custom_field.custom_field import create_custom_fields
from frappe.utils import cint, flt, now_datetime, nowdate, strip_html_tags
from barcode import Code128
from barcode.writer import SVGWriter

try:
	import pyqrcode
except ImportError:  # pragma: no cover - optional runtime dependency
	pyqrcode = None

from ss_coil.stock_entry_data_entry import (
	get_stock_entry_data_entry_meta,
	save_stock_entry_data_entry,
)


def _format_number(value):
	if value is None:
		return "-"
	num = float(value)
	if num.is_integer():
		return str(int(num))
	return f"{num:.6f}".rstrip("0").rstrip(".")


def _format_dimension_part(value):
	if value in (None, ""):
		return ""
	if isinstance(value, (int, float)):
		return _format_number(value)
	text = str(value).strip()
	if not text:
		return ""
	if re.fullmatch(r"-?\d+(\.\d+)?", text):
		return _format_number(float(text))
	return text


def _has_field(doctype, fieldname):
	return bool(frappe.get_meta(doctype).get_field(fieldname))


TAG_ORIGIN_DOCTYPES = ("Purchase Receipt", "Stock Entry")


def _is_material_receipt_stock_entry(doc):
	if (doc.purpose or "") == "Material Receipt":
		return True
	stock_entry_type = getattr(doc, "stock_entry_type", None)
	if not stock_entry_type:
		return False
	if stock_entry_type == "Material Receipt":
		return True
	if frappe.db.exists("Stock Entry Type", stock_entry_type):
		purpose = frappe.db.get_value("Stock Entry Type", stock_entry_type, "purpose")
		return purpose == "Material Receipt"
	return False


def _item_create_tag_on_receipt(item_code):
	if not item_code or not _has_field("Item", "custom_create_tag_on_receipt"):
		return False
	return cint(frappe.get_cached_value("Item", item_code, "custom_create_tag_on_receipt"))


def _tag_creation_enabled(doc, row):
	if not cint(getattr(doc, "custom_create_tag_numbers", 0)):
		return False
	if cint(getattr(row, "custom_create_tag_no", 0)):
		return True
	return _item_create_tag_on_receipt(getattr(row, "item_code", None))


def apply_inward_tag_row_defaults(doc):
	needs_header = False
	for row in doc.items or []:
		if not _has_field(row.doctype, "custom_create_tag_no"):
			continue
		if _item_create_tag_on_receipt(row.item_code):
			row.custom_create_tag_no = 1
			needs_header = True
	if needs_header and _has_field(doc.doctype, "custom_create_tag_numbers"):
		doc.custom_create_tag_numbers = 1


STOCK_SOURCE_PURCHASE_RECEIPTS = "Purchase Receipts"
STOCK_SOURCE_STOCK_ENTRY = "Stock Entry"

LEGACY_STOCK_SOURCE_MAP = {
	"Purchased": STOCK_SOURCE_PURCHASE_RECEIPTS,
	"Customer Provided": STOCK_SOURCE_STOCK_ENTRY,
}

COIL_INWARD_SO_FIELDNAMES = (
	"custom_mill",
	"custom_location",
	"custom_ref_no",
	"custom_thickness",
	"custom_js_number",
	"custom_length_c",
	"custom_po_no",
	"custom_width",
	"custom_condition",
	"custom_commodity",
	"custom_length",
	"custom_remarks",
	"custom_estimated_wt",
	"custom_specification",
	"custom_dimension",
	"custom_comments",
	"custom_qty_of_coil",
)


def _normalize_stock_source_type(value):
	if not value:
		return ""
	return LEGACY_STOCK_SOURCE_MAP.get(value, value)


def _stock_source_for_origin(source_doctype):
	if source_doctype == "Purchase Receipt":
		return STOCK_SOURCE_PURCHASE_RECEIPTS
	if source_doctype == "Stock Entry":
		return STOCK_SOURCE_STOCK_ENTRY
	return ""


def _origin_doctype_for_stock_source(stock_source_type):
	normalized = _normalize_stock_source_type(stock_source_type)
	if normalized == STOCK_SOURCE_PURCHASE_RECEIPTS:
		return "Purchase Receipt"
	if normalized == STOCK_SOURCE_STOCK_ENTRY:
		return "Stock Entry"
	return ""


def _extract_coil_inward_row_details(row):
	"""Return inward coil fields for SS Coil input and Sales Order item population."""
	if not row:
		return {}

	details = {}
	for fieldname in COIL_INWARD_SO_FIELDNAMES:
		value = getattr(row, fieldname, None)
		if value not in (None, ""):
			details[fieldname] = value

	short_map = {
		"mill": "custom_mill",
		"location": "custom_location",
		"ref_no": "custom_ref_no",
		"thickness": "custom_thickness",
		"js_number": "custom_js_number",
		"length_c": "custom_length_c",
		"po_no": "custom_po_no",
		"width": "custom_width",
		"condition": "custom_condition",
		"commodity": "custom_commodity",
		"length": "custom_length",
		"remarks": "custom_remarks",
		"estimated_wt": "custom_estimated_wt",
		"specification": "custom_specification",
		"dimension": "custom_dimension",
		"comments": "custom_comments",
		"qty_of_coil": "custom_qty_of_coil",
	}
	for short_key, fieldname in short_map.items():
		value = details.get(fieldname)
		if value not in (None, ""):
			details[short_key] = value

	if getattr(row, "qty", None) not in (None, ""):
		details["estimated_qty"] = row.qty
		details["actual_qty"] = row.qty
	if details.get("custom_estimated_wt"):
		details["actual_wt"] = details["custom_estimated_wt"]
	if getattr(row, "batch_no", None):
		details["batch_no"] = row.batch_no

	return details


def _link_origin_tag_to_sales_order_items(tag_no, item_code, sales_order, batch_no=None, source_doctype=None):
	if not tag_no or not item_code or not sales_order:
		return
	if not _has_field("Sales Order Item", "custom_raw_material_item"):
		return

	rows = frappe.get_all(
		"Sales Order Item",
		filters={
			"parent": sales_order,
			"custom_raw_material_item": item_code,
			"custom_raw_material_tag_no": ["in", ["", None]],
		},
		fields=["name"],
		order_by="idx asc",
		limit=1,
	)
	if not rows:
		return

	values = {"custom_raw_material_tag_no": tag_no}
	if batch_no and _has_field("Sales Order Item", "custom_raw_material_batch_no"):
		# custom_raw_material_batch_no is a Link to Batch - only set it when we
		# have a real Batch id, never fall back to the tag number.
		values["custom_raw_material_batch_no"] = batch_no
	stock_source = _stock_source_for_origin(source_doctype)
	if stock_source and _has_field("Sales Order Item", "custom_stock_source_type"):
		values["custom_stock_source_type"] = stock_source
	frappe.db.set_value("Sales Order Item", rows[0].name, values, update_modified=False)


def sync_sales_order_item_child_tags(doc, method=None):
	if not getattr(doc, "sales_order_item", None):
		return
	child_tags = [row.tag_no for row in (doc.job_output or []) if getattr(row, "tag_no", None)]
	if not child_tags:
		return

	primary_tag = child_tags[0]
	values = {}
	if _has_field("Sales Order Item", "custom_child_tag_no"):
		values["custom_child_tag_no"] = ", ".join(child_tags)
	if _has_field("Sales Order Item", "custom_tag_no"):
		values["custom_tag_no"] = primary_tag
	if values:
		frappe.db.set_value("Sales Order Item", doc.sales_order_item, values, update_modified=False)


def _find_tag_by_batch(batch_no, item_code=None):
	if not batch_no:
		return None
	batch_no = str(batch_no).strip()
	if frappe.db.exists("Tag Registry", {"tag_no": batch_no}):
		return batch_no
	if _has_field("Tag Registry", "batch_no"):
		tag = frappe.db.get_value("Tag Registry", {"batch_no": batch_no}, "tag_no")
		if tag:
			return tag
	return None


def _find_stock_entry_detail_tag(stock_entry=None, se_detail=None, item_code=None, batch_no=None):
	if se_detail and frappe.db.exists("Stock Entry Detail", se_detail):
		tag_no = frappe.db.get_value("Stock Entry Detail", se_detail, "custom_tag_no")
		if tag_no:
			return tag_no
	if stock_entry and item_code:
		filters = {"parent": stock_entry, "item_code": item_code}
		if batch_no:
			filters["batch_no"] = batch_no
		rows = frappe.get_all("Stock Entry Detail", filters=filters, pluck="custom_tag_no")
		return _first_unique([tag for tag in rows if tag])
	return None


def _resolve_carried_tag(row, doc=None):
	if getattr(row, "custom_tag_no", None):
		return row.custom_tag_no

	tag = _find_tag_by_batch(getattr(row, "batch_no", None), getattr(row, "item_code", None))
	if tag:
		return tag

	if getattr(row, "purchase_receipt_item", None):
		tag = _find_purchase_receipt_item_tag(pr_detail=row.purchase_receipt_item, item_code=row.item_code)
		if tag:
			return tag

	if getattr(row, "reference_purchase_receipt", None):
		tag = _find_purchase_receipt_item_tag(
			purchase_receipt=row.reference_purchase_receipt,
			item_code=row.item_code,
		)
		if tag:
			return tag

	if getattr(row, "serial_and_batch_bundle", None):
		bundle_batches = frappe.get_all(
			"Serial and Batch Entry",
			filters={"parent": row.serial_and_batch_bundle, "batch_no": ["is", "set"]},
			pluck="batch_no",
		)
		for batch in bundle_batches:
			tag = _find_tag_by_batch(batch, row.item_code)
			if tag:
				return tag

	return None


def _ensure_batch_for_tag_row(row, tag_no):
	"""Auto-create a Batch using the Tag No as its Batch ID.

	Only runs when Item.has_batch_no AND Item.custom_use_tag_as_batch_no are
	both enabled (the latter defaults to 1 to preserve existing behavior).
	Uncheck custom_use_tag_as_batch_no on an item to let ERPNext's own batch
	settings (Automatically Create New Batch + Batch Number Series, or manual
	Batch No entry) handle batching for that item instead - see
	ARCHITECTURE.md > "Batch auto-creation".
	"""
	if not tag_no or not getattr(row, "item_code", None):
		return
	if not _has_field(row.doctype, "batch_no"):
		return
	if row.batch_no:
		return
	has_batch = frappe.get_cached_value("Item", row.item_code, "has_batch_no")
	if not has_batch:
		return
	if _has_field("Item", "custom_use_tag_as_batch_no"):
		use_tag_as_batch = frappe.get_cached_value("Item", row.item_code, "custom_use_tag_as_batch_no")
		if not use_tag_as_batch:
			return
	if not frappe.db.exists("Batch", tag_no):
		frappe.get_doc(
			{
				"doctype": "Batch",
				"batch_id": tag_no,
				"item": row.item_code,
			}
		).insert(ignore_permissions=True)
	row.batch_no = tag_no


def _create_origin_tag(doc, row, source_doctype, sales_order=None, stock_entry=None):
	existing = _resolve_carried_tag(row, doc)
	if existing:
		row.custom_tag_no = existing
		return existing

	if row.custom_tag_no:
		is_persisted = bool(doc.name and not str(doc.name).startswith("new-"))
		if is_persisted:
			_ensure_origin_tag_available(row.custom_tag_no, source_doctype, doc.name, row.doctype, row.name)
		tag_no = row.custom_tag_no
	else:
		tag_no = _next_tag_number()
		while frappe.db.exists("Tag Registry", {"tag_no": tag_no}):
			tag_no = _next_tag_number()
		if _has_field(row.doctype, "custom_tag_no"):
			row.custom_tag_no = tag_no

	_ensure_batch_for_tag_row(row, tag_no)
	# Only use a real Batch record's id here - _ensure_batch_for_tag_row only
	# creates one when the item has batch tracking enabled. Falling back to
	# tag_no would set Tag Registry.batch_no (a Link to Batch) to a value
	# that doesn't exist as a Batch, which fails link validation on save.
	batch_no = getattr(row, "batch_no", None)
	sales_order = sales_order or getattr(doc, "custom_sales_order", None)
	_register_tag(
		tag_no,
		source_doctype=source_doctype,
		source_docname=doc.name,
		source_child_doctype=row.doctype,
		source_child_name=row.name,
		item_code=row.item_code,
		item_name=row.item_name,
		sales_order=sales_order,
		stock_entry=stock_entry,
		batch_no=batch_no,
		status="Active",
	)
	_link_origin_tag_to_sales_order_items(tag_no, row.item_code, sales_order, batch_no, source_doctype)
	return tag_no


def _update_tag_location(doc, row, status="Active", sales_order=None, stock_entry=None):
	if not getattr(row, "custom_tag_no", None):
		return
	batch_no = getattr(row, "batch_no", None)
	_register_tag(
		row.custom_tag_no,
		source_doctype=None,
		source_docname=None,
		source_child_doctype=None,
		source_child_name=None,
		item_code=row.item_code,
		item_name=row.item_name,
		sales_order=sales_order,
		stock_entry=stock_entry,
		batch_no=batch_no,
		status=status,
		current_doctype=doc.doctype,
		current_docname=doc.name,
		current_child_doctype=row.doctype,
		current_child_name=row.name,
	)


PROCESS_FIELDS = ("slitter", "leveler", "reshearing")
PROCESS_LABELS = {
	"slitter": "Slitter",
	"leveler": "Leveler",
	"reshearing": "Reshearing",
}


def _clean_text(value):
	return strip_html_tags(value or "").strip()


def _truthy_process_value(value):
	return str(value or "").strip()


def _get_enabled_processes_from_row(row, custom=False):
	processes = []
	for fieldname in PROCESS_FIELDS:
		source_field = f"custom_{fieldname}" if custom else fieldname
		if _truthy_process_value(getattr(row, source_field, None)):
			processes.append(fieldname)
	return processes


def _next_process_for(current_process, configured_processes):
	if not current_process:
		return configured_processes[0] if configured_processes else ""
	current_key = str(current_process or "").strip().lower()
	keys = [field for field in configured_processes]
	if current_key in keys:
		index = keys.index(current_key)
		return keys[index + 1] if index + 1 < len(keys) else ""
	for field in configured_processes:
		if PROCESS_LABELS[field].lower() == current_key:
			index = configured_processes.index(field)
			return configured_processes[index + 1] if index + 1 < len(configured_processes) else ""
	return ""


def _label_for_process(process_name):
	key = str(process_name or "").strip().lower()
	return PROCESS_LABELS.get(key, process_name or "")


def _first_unique(values):
	values = [v for v in values if v]
	unique = list(dict.fromkeys(values))
	return unique[0] if len(unique) == 1 else None


def _sales_order_from_sales_invoice(sales_invoice):
	return _first_unique(
		frappe.db.sql(
			"""
			select distinct sii.sales_order
			from `tabSales Invoice Item` sii
			where sii.parent = %s and ifnull(sii.sales_order, '') != ''
			""",
			(sales_invoice,),
			pluck="sales_order",
		)
	)


def _sales_order_from_purchase_order(purchase_order):
	if _has_field("Purchase Order", "custom_sales_order"):
		so = frappe.db.get_value("Purchase Order", purchase_order, "custom_sales_order")
		if so:
			return so
	return _first_unique(
		frappe.db.sql(
			"""
			select distinct sales_order
			from `tabPurchase Order Item`
			where parent = %s and ifnull(sales_order, '') != ''
			""",
			(purchase_order,),
			pluck="sales_order",
		)
	)


def _sales_order_from_purchase_receipt(purchase_receipt):
	if _has_field("Purchase Receipt", "custom_sales_order"):
		so = frappe.db.get_value("Purchase Receipt", purchase_receipt, "custom_sales_order")
		if so:
			return so
	sales_orders = frappe.db.sql(
		"""
		select distinct sales_order
		from `tabPurchase Receipt Item`
		where parent = %s and ifnull(sales_order, '') != ''
		""",
		(purchase_receipt,),
		pluck="sales_order",
	)
	if sales_orders:
		return _first_unique(sales_orders)
	purchase_orders = frappe.db.sql(
		"""
		select distinct purchase_order
		from `tabPurchase Receipt Item`
		where parent = %s and ifnull(purchase_order, '') != ''
		""",
		(purchase_receipt,),
		pluck="purchase_order",
	)
	return _first_unique([_sales_order_from_purchase_order(po) for po in purchase_orders])


def _infer_custom_sales_order(doc):
	if getattr(doc, "custom_sales_order", None):
		return doc.custom_sales_order

	doctype = doc.doctype
	if doctype == "Stock Entry":
		return frappe.db.get_value("SS Coil", {"stock_entry": doc.name}, "order_no")

	if doctype == "Payment Entry":
		sales_orders = []
		for ref in doc.references or []:
			if ref.reference_doctype == "Sales Order":
				sales_orders.append(ref.reference_name)
			elif ref.reference_doctype == "Sales Invoice":
				sales_orders.append(_sales_order_from_sales_invoice(ref.reference_name))
		return _first_unique(sales_orders)

	if doctype == "Journal Entry":
		sales_orders = []
		for row in doc.accounts or []:
			if row.reference_type == "Sales Order":
				sales_orders.append(row.reference_name)
			elif row.reference_type == "Sales Invoice":
				sales_orders.append(_sales_order_from_sales_invoice(row.reference_name))
			elif row.reference_type == "Payment Entry" and _has_field("Payment Entry", "custom_sales_order"):
				sales_orders.append(frappe.db.get_value("Payment Entry", row.reference_name, "custom_sales_order"))
		return _first_unique(sales_orders)

	if doctype == "Purchase Order":
		return _first_unique([getattr(row, "sales_order", None) for row in (doc.items or [])])

	if doctype == "Purchase Receipt":
		sales_orders = [getattr(row, "sales_order", None) for row in (doc.items or [])]
		sales_orders.extend(_sales_order_from_purchase_order(getattr(row, "purchase_order", None)) for row in (doc.items or []))
		return _first_unique(sales_orders)

	if doctype == "Purchase Invoice":
		sales_orders = []
		for row in doc.items or []:
			if getattr(row, "purchase_order", None):
				sales_orders.append(_sales_order_from_purchase_order(row.purchase_order))
			if getattr(row, "purchase_receipt", None):
				sales_orders.append(_sales_order_from_purchase_receipt(row.purchase_receipt))
		return _first_unique(sales_orders)

	if doctype == "Expense Claim":
		return None

	return None


def populate_custom_sales_order(doc, method=None):
	if not _has_field(doc.doctype, "custom_sales_order"):
		return
	sales_order = _infer_custom_sales_order(doc)
	if sales_order:
		doc.custom_sales_order = sales_order


def _tag_settings_defaults():
	return {
		"prefix": "SSCC",
		"digits": 5,
		"next_number": 4439,
		"suffix": "-000",
	}


def _get_tag_setting(fieldname):
	defaults = _tag_settings_defaults()
	default_value = defaults.get(fieldname)
	if not frappe.db.exists("DocType", "Tag Number Settings"):
		return default_value
	value = frappe.db.get_single_value("Tag Number Settings", fieldname)
	return value if value not in (None, "") else default_value


def _tag_settings():
	return {
		"prefix": (_get_tag_setting("prefix") or "SSCC").strip(),
		"digits": cint(_get_tag_setting("digits")) or 5,
		"next_number": cint(_get_tag_setting("next_number")) or 4439,
		"suffix": _get_tag_setting("suffix") or "-000",
	}


def _format_tag_number(number, settings=None):
	settings = settings or _tag_settings()
	return f"{settings['prefix']}-{cint(number):0{cint(settings['digits'])}d}{settings['suffix']}"


def _parse_tag_number(tag_no):
	match = re.match(r"^(.*?)-(\d+)(-.+)?$", (tag_no or "").strip())
	if not match:
		return None
	return {
		"prefix": match.group(1),
		"number": cint(match.group(2)),
		"suffix": match.group(3) or "",
	}


def _strip_svg_preamble(svg):
	if not svg:
		return ""
	svg = re.sub(r"<\?xml[^>]*\?>\s*", "", str(svg), flags=re.IGNORECASE)
	svg = re.sub(r"<!DOCTYPE[^>]*>\s*", "", svg, flags=re.IGNORECASE)
	return svg.strip()


def _ensure_svg_viewbox(svg):
	"""Add a viewBox matching the SVG's own width/height if it lacks one.

	pyqrcode emits fixed width/height with no viewBox, so CSS-resizing the
	element shrinks the viewport without scaling the drawing - the code gets
	clipped instead of scaled down. A viewBox fixes that.
	"""
	if not svg or "viewBox" in svg:
		return svg
	svg_tag_match = re.search(r"<svg\b[^>]*>", svg)
	if not svg_tag_match:
		return svg
	svg_tag = svg_tag_match.group(0)
	width_match = re.search(r'\bwidth="(\d+(?:\.\d+)?)"', svg_tag)
	height_match = re.search(r'\bheight="(\d+(?:\.\d+)?)"', svg_tag)
	if not width_match or not height_match:
		return svg
	width, height = width_match.group(1), height_match.group(1)
	return svg.replace("<svg ", f'<svg viewBox="0 0 {width} {height}" ', 1)


def _is_managed_tag(tag_no, settings=None):
	settings = settings or _tag_settings()
	parsed = _parse_tag_number(tag_no)
	if not parsed:
		return False
	return parsed["prefix"] == settings["prefix"] and (parsed["suffix"] or "") == (settings["suffix"] or "")


def _register_tag(
	tag_no,
	source_doctype=None,
	source_docname=None,
	source_child_doctype=None,
	source_child_name=None,
	item_code=None,
	item_name=None,
	sales_order=None,
	stock_entry=None,
	parent_tag_no=None,
	root_tag_no=None,
	batch_no=None,
	status="Active",
	current_doctype=None,
	current_docname=None,
	current_child_doctype=None,
	current_child_name=None,
):
	if not tag_no or not frappe.db.exists("DocType", "Tag Registry"):
		return

	resolved_root_tag = root_tag_no or parent_tag_no or tag_no
	customer_name = None
	current_process = None
	next_process = None
	generation_level = 0
	lineage_path = str(tag_no)

	if sales_order and frappe.db.exists("Sales Order", sales_order):
		customer_name = frappe.db.get_value("Sales Order", sales_order, "customer")

	if parent_tag_no and parent_tag_no != tag_no and frappe.db.exists("DocType", "Tag Registry"):
		parent_meta = frappe.db.get_value(
			"Tag Registry",
			{"tag_no": parent_tag_no},
			["generation_level", "lineage_path", "root_tag_no", "customer_name"],
			as_dict=True,
		)
		if parent_meta:
			generation_level = cint(parent_meta.generation_level) + 1
			resolved_root_tag = parent_meta.root_tag_no or resolved_root_tag
			lineage_path = f"{parent_meta.lineage_path or parent_tag_no} > {tag_no}"
			customer_name = customer_name or parent_meta.customer_name
		else:
			generation_level = max(1, len([part for part in str(tag_no).split("-") if part.isdigit()]) - 1)
			lineage_path = f"{parent_tag_no} > {tag_no}"

	if source_doctype == "SS Coil" and source_docname and frappe.db.exists("SS Coil", source_docname):
		ss_meta = frappe.db.get_value(
			"SS Coil",
			source_docname,
			["operation", "customer_name", "order_no"],
			as_dict=True,
		)
		if ss_meta:
			current_process = _label_for_process(ss_meta.operation)
			customer_name = customer_name or ss_meta.customer_name
			if not sales_order:
				sales_order = ss_meta.order_no
		if source_child_doctype == "Coil Output" and source_child_name and frappe.db.exists("Coil Output", source_child_name):
			output_meta = frappe.db.get_value(
				"Coil Output",
				source_child_name,
				["current_process", "next_process"],
				as_dict=True,
			)
			if output_meta:
				current_process = output_meta.current_process or current_process
				next_process = output_meta.next_process or next_process
		elif source_child_doctype == "Coil Input" and source_child_name and frappe.db.exists("Coil Input", source_child_name):
			input_meta = frappe.db.get_value("Coil Input", source_child_name, ["next_process"], as_dict=True)
			if input_meta:
				next_process = input_meta.next_process or next_process

	registry = frappe.db.get_value("Tag Registry", {"tag_no": tag_no}, "name")
	if registry:
		doc = frappe.get_doc("Tag Registry", registry)
	else:
		doc = frappe.get_doc({"doctype": "Tag Registry", "tag_no": tag_no})

	if not doc.get("source_doctype"):
		doc.source_doctype = source_doctype
	if not doc.get("source_docname") or (
		doc.get("source_docname", "").startswith("new-") and source_docname and not str(source_docname).startswith("new-")
	):
		doc.source_docname = source_docname
	if not doc.get("source_child_doctype"):
		doc.source_child_doctype = source_child_doctype
	if not doc.get("source_child_name") or (
		doc.get("source_child_name", "").startswith("new-") and source_child_name and not str(source_child_name).startswith("new-")
	):
		doc.source_child_name = source_child_name

	doc.current_doctype = current_doctype or source_doctype
	doc.current_docname = current_docname or source_docname
	doc.current_child_doctype = current_child_doctype or source_child_doctype
	doc.current_child_name = current_child_name or source_child_name
	doc.item_code = item_code
	doc.item_name = item_name
	doc.sales_order = sales_order
	doc.stock_entry = stock_entry
	doc.parent_tag_no = parent_tag_no
	doc.root_tag_no = resolved_root_tag
	doc.customer_name = customer_name
	doc.current_process = current_process
	doc.next_process = next_process
	doc.generation_level = generation_level
	doc.lineage_path = lineage_path
	if batch_no and _has_field("Tag Registry", "batch_no"):
		doc.batch_no = batch_no
	doc.status = status or "Active"
	doc.flags.ignore_permissions = True
	# The source/current doc (Stock Entry, SS Coil, etc.) is often still mid
	# insert when this runs (before_validate/before_save), so it may not be
	# committed to the DB yet even though its name is already assigned -
	# link validation against it would fail otherwise.
	doc.flags.ignore_links = True
	if registry:
		doc.save(ignore_permissions=True)
	else:
		doc.insert(ignore_permissions=True)


def backfill_tag_registry_hierarchy():
	if not frappe.db.exists("DocType", "Tag Registry"):
		return {"updated": 0}

	rows = frappe.get_all(
		"Tag Registry",
		fields=[
			"name",
			"tag_no",
			"parent_tag_no",
			"root_tag_no",
			"sales_order",
			"source_doctype",
			"source_docname",
			"source_child_doctype",
			"source_child_name",
			"current_doctype",
			"current_docname",
			"current_child_doctype",
			"current_child_name",
			"stock_entry",
			"item_code",
			"item_name",
			"status",
		],
		order_by="creation asc",
	)
	updated = 0
	for row in rows:
		before = frappe.db.get_value(
			"Tag Registry",
			row.name,
			["generation_level", "lineage_path", "customer_name", "current_process", "next_process"],
			as_dict=True,
		) or {}
		_register_tag(
			row.tag_no,
			source_doctype=row.source_doctype or row.current_doctype,
			source_docname=row.source_docname or row.current_docname,
			source_child_doctype=row.source_child_doctype or row.current_child_doctype,
			source_child_name=row.source_child_name or row.current_child_name,
			item_code=row.item_code,
			item_name=row.item_name,
			sales_order=row.sales_order,
			stock_entry=row.stock_entry,
			parent_tag_no=row.parent_tag_no,
			root_tag_no=row.root_tag_no,
			status=row.status,
		)
		after = frappe.db.get_value(
			"Tag Registry",
			row.name,
			["generation_level", "lineage_path", "customer_name", "current_process", "next_process"],
			as_dict=True,
		) or {}
		if before != after:
			updated += 1
	frappe.db.commit()
	return {"updated": updated}


def _next_tag_number():
	settings = _tag_settings()
	if not frappe.db.exists("DocType", "Tag Number Settings"):
		return _format_tag_number(settings["next_number"], settings)

	row = frappe.db.sql(
		"""
		select value
		from `tabSingles`
		where doctype = 'Tag Number Settings' and field = 'next_number'
		for update
		""",
		as_dict=True,
	)
	current = cint(row[0].value) if row else settings["next_number"]
	tag_no = _format_tag_number(current, settings)
	frappe.db.set_single_value("Tag Number Settings", "next_number", current + 1)
	return tag_no


def _get_or_create_tag(
	source_doctype,
	source_docname,
	source_child_doctype,
	source_child_name,
	item_code=None,
	item_name=None,
	sales_order=None,
	stock_entry=None,
	parent_tag_no=None,
	root_tag_no=None,
	existing_tag=None,
):
	if existing_tag:
		_register_tag(
			existing_tag,
			source_doctype=source_doctype,
			source_docname=source_docname,
			source_child_doctype=source_child_doctype,
			source_child_name=source_child_name,
			item_code=item_code,
			item_name=item_name,
			sales_order=sales_order,
			stock_entry=stock_entry,
			parent_tag_no=parent_tag_no,
			root_tag_no=root_tag_no,
		)
		return existing_tag

	current = frappe.db.get_value(
		"Tag Registry",
		{
			"source_doctype": source_doctype,
			"source_docname": source_docname,
			"source_child_doctype": source_child_doctype,
			"source_child_name": source_child_name,
		},
		"tag_no",
	)
	if current:
		return current

	tag_no = _next_tag_number()
	while frappe.db.exists("Tag Registry", {"tag_no": tag_no}):
		tag_no = _next_tag_number()

	_register_tag(
		tag_no,
		source_doctype=source_doctype,
		source_docname=source_docname,
		source_child_doctype=source_child_doctype,
		source_child_name=source_child_name,
		item_code=item_code,
		item_name=item_name,
		sales_order=sales_order,
		stock_entry=stock_entry,
		parent_tag_no=parent_tag_no,
		root_tag_no=root_tag_no,
	)
	return tag_no


def _normalize_subtag_base(parent_tag_no):
	parsed = _parse_tag_number(parent_tag_no)
	if not parsed:
		return None
	return f"{parsed['prefix']}-{parsed['number']:0{len(str(parsed['number']))}d}"


def _root_tag_for(tag_no):
	if not tag_no:
		return None
	if frappe.db.exists("DocType", "Tag Registry"):
		row = frappe.db.get_value("Tag Registry", {"tag_no": tag_no}, ["root_tag_no", "parent_tag_no"], as_dict=True)
		if row:
			return row.root_tag_no or row.parent_tag_no or tag_no
	return tag_no


def _next_sub_tag(parent_tag_no):
	if not parent_tag_no:
		return None
	parent_tag = str(parent_tag_no).strip()
	settings = _tag_settings()
	base = parent_tag
	suffix = settings.get("suffix") or "-000"
	if suffix and parent_tag.endswith(suffix):
		base = parent_tag[: -len(suffix)]
	existing = frappe.get_all(
		"Tag Registry",
		filters={"parent_tag_no": parent_tag_no},
		pluck="tag_no",
	) if frappe.db.exists("DocType", "Tag Registry") else []
	used = set()
	for tag_no in existing:
		if not tag_no:
			continue
		tag_text = str(tag_no).strip()
		if tag_text == parent_tag:
			continue
		if not tag_text.startswith(f"{base}-"):
			continue
		last_segment = tag_text.rsplit("-", 1)[-1]
		if last_segment.isdigit():
			used.add(cint(last_segment))
	idx = 1
	while idx in used:
		idx += 1
	return f"{base}-{idx:03d}"


def _is_child_subtag(candidate_tag, parent_tag_no):
	if not candidate_tag or not parent_tag_no:
		return False
	candidate = str(candidate_tag).strip()
	parent = str(parent_tag_no).strip()
	settings = _tag_settings()
	suffix = settings.get("suffix") or "-000"
	base = parent[:-len(suffix)] if suffix and parent.endswith(suffix) else parent
	if not candidate.startswith(f"{base}-"):
		return False
	last_segment = candidate.rsplit("-", 1)[-1]
	return last_segment.isdigit() and cint(last_segment) > 0


def _ensure_origin_tag_available(tag_no, source_doctype, source_docname, source_child_doctype, source_child_name):
	if not tag_no or not frappe.db.exists("DocType", "Tag Registry"):
		return
	row = frappe.db.get_value(
		"Tag Registry",
		{"tag_no": tag_no},
		["source_doctype", "source_docname", "source_child_doctype", "source_child_name"],
		as_dict=True,
	)
	if not row:
		return
	if row.source_doctype == source_doctype and row.source_docname == source_docname:
		return
	if (
		row.source_doctype == source_doctype
		and row.source_docname == source_docname
		and row.source_child_doctype == source_child_doctype
		and row.source_child_name == source_child_name
	):
		return
	if (
		row.source_doctype == source_doctype
		and row.source_docname == source_docname
		and row.source_child_doctype == source_child_doctype
	):
		return
	frappe.throw(
		f"Tag No {tag_no} is already assigned to source {row.source_doctype} / {row.source_docname} / {row.source_child_name}. Please use a different origin tag or carry the existing one downstream."
	)


def _find_sales_order_item_tag(so_detail=None, sales_order=None, item_code=None):
	if so_detail and frappe.db.exists("Sales Order Item", so_detail):
		tag_no = frappe.db.get_value("Sales Order Item", so_detail, "custom_tag_no")
		if tag_no:
			return tag_no

	if sales_order and item_code:
		rows = frappe.get_all(
			"Sales Order Item",
			filters={"parent": sales_order, "item_code": item_code},
			pluck="custom_tag_no",
		)
		return _first_unique(rows)
	return None


def _find_purchase_receipt_item_tag(pr_detail=None, purchase_receipt=None, item_code=None):
	if pr_detail and frappe.db.exists("Purchase Receipt Item", pr_detail):
		tag_no = frappe.db.get_value("Purchase Receipt Item", pr_detail, "custom_tag_no")
		if tag_no:
			return tag_no

	if purchase_receipt and item_code:
		rows = frappe.get_all(
			"Purchase Receipt Item",
			filters={"parent": purchase_receipt, "item_code": item_code},
			pluck="custom_tag_no",
		)
		return _first_unique(rows)
	return None


def _find_purchase_invoice_item_tag(pi_detail=None, purchase_invoice=None, item_code=None):
	if pi_detail and frappe.db.exists("Purchase Invoice Item", pi_detail):
		tag_no = frappe.db.get_value("Purchase Invoice Item", pi_detail, "custom_tag_no")
		if tag_no:
			return tag_no

	if purchase_invoice and item_code:
		rows = frappe.get_all(
			"Purchase Invoice Item",
			filters={"parent": purchase_invoice, "item_code": item_code},
			pluck="custom_tag_no",
		)
		return _first_unique(rows)
	return None


def _get_tag_trace_rows(tag_numbers):
	tag_numbers = [t for t in tag_numbers if t]
	if not tag_numbers:
		return {}

	placeholders = tuple(tag_numbers)
	traces = {tag_no: {"tag_no": tag_no, "events": []} for tag_no in tag_numbers}

	def add_event(tag_no, stage, doctype, docname, row_name=None, date=None, item_code=None, item_name=None, qty=None, extra=None):
		if not tag_no:
			return
		traces.setdefault(tag_no, {"tag_no": tag_no, "events": []})
		traces[tag_no]["events"].append(
			{
				"stage": stage,
				"doctype": doctype,
				"docname": docname,
				"row_name": row_name,
				"date": str(date) if date else None,
				"item_code": item_code,
				"item_name": item_name,
				"qty": flt(qty),
				"extra": extra or {},
			}
		)

	registry_rows = frappe.get_all(
		"Tag Registry",
		filters={"tag_no": ["in", tag_numbers]},
		fields=[
			"tag_no",
			"status",
			"issued_on",
			"item_code",
			"item_name",
			"sales_order",
			"stock_entry",
			"source_doctype",
			"source_docname",
			"source_child_name",
			"current_doctype",
			"current_docname",
			"current_child_name",
		],
	)
	for row in registry_rows:
		traces.setdefault(row.tag_no, {"tag_no": row.tag_no, "events": []})
		traces[row.tag_no]["registry"] = row

	sales_order_rows = frappe.db.sql(
		"""
		select parent, name, item_code, item_name, qty, custom_tag_no
		from `tabSales Order Item`
		where custom_tag_no in %(tags)s
		order by parent asc, idx asc
		""",
		{"tags": placeholders},
		as_dict=True,
	)
	for row in sales_order_rows:
		add_event(row.custom_tag_no, "Sales Order", "Sales Order", row.parent, row.name, None, row.item_code, row.item_name, row.qty)

	purchase_receipt_rows = frappe.db.sql(
		"""
		select pri.parent, pri.name, pri.item_code, pri.item_name, pri.qty, pri.custom_tag_no, pr.posting_date, pr.supplier
		from `tabPurchase Receipt Item` pri
		inner join `tabPurchase Receipt` pr on pr.name = pri.parent
		where pri.custom_tag_no in %(tags)s
		order by pr.posting_date asc, pri.idx asc
		""",
		{"tags": placeholders},
		as_dict=True,
	)
	for row in purchase_receipt_rows:
		add_event(row.custom_tag_no, "Purchase Receipt", "Purchase Receipt", row.parent, row.name, row.posting_date, row.item_code, row.item_name, row.qty, {"supplier": row.supplier})

	purchase_invoice_rows = frappe.db.sql(
		"""
		select pii.parent, pii.name, pii.item_code, pii.item_name, pii.qty, pii.custom_tag_no, pi.posting_date, pi.supplier
		from `tabPurchase Invoice Item` pii
		inner join `tabPurchase Invoice` pi on pi.name = pii.parent
		where pii.custom_tag_no in %(tags)s
		order by pi.posting_date asc, pii.idx asc
		""",
		{"tags": placeholders},
		as_dict=True,
	)
	for row in purchase_invoice_rows:
		add_event(row.custom_tag_no, "Purchase Invoice", "Purchase Invoice", row.parent, row.name, row.posting_date, row.item_code, row.item_name, row.qty, {"supplier": row.supplier})

	stock_entry_rows = frappe.db.sql(
		"""
		select sed.parent, sed.name, sed.item_code, sed.item_name, sed.qty, sed.custom_tag_no, se.posting_date, se.purpose
		from `tabStock Entry Detail` sed
		inner join `tabStock Entry` se on se.name = sed.parent
		where sed.custom_tag_no in %(tags)s
		order by se.posting_date asc, sed.idx asc
		""",
		{"tags": placeholders},
		as_dict=True,
	)
	for row in stock_entry_rows:
		add_event(row.custom_tag_no, "Stock Entry", "Stock Entry", row.parent, row.name, row.posting_date, row.item_code, row.item_name, row.qty, {"purpose": row.purpose})

	ss_coil_output_rows = frappe.db.sql(
		"""
		select
			co.parent,
			co.name,
			co.class as item_name,
			co.tag_no,
			co.estimated_qty as qty,
			sc.sc_date,
			sc.operation
		from `tabCoil Output` co
		inner join `tabSS Coil` sc on sc.name = co.parent
		where ifnull(co.tag_no, '') in %(tags)s
		order by sc.sc_date asc, co.idx asc
		""",
		{"tags": placeholders},
		as_dict=True,
	)
	for row in ss_coil_output_rows:
		add_event(row.tag_no, "SS Coil Output", "SS Coil", row.parent, row.name, row.sc_date, None, row.item_name, row.qty, {"operation": row.operation})

	delivery_rows = frappe.db.sql(
		"""
		select dni.parent, dni.name, dni.item_code, dni.item_name, dni.qty, dni.custom_tag_no, dn.posting_date, dn.customer
		from `tabDelivery Note Item` dni
		inner join `tabDelivery Note` dn on dn.name = dni.parent
		where dni.custom_tag_no in %(tags)s
		order by dn.posting_date asc, dni.idx asc
		""",
		{"tags": placeholders},
		as_dict=True,
	)
	for row in delivery_rows:
		add_event(row.custom_tag_no, "Delivery Note", "Delivery Note", row.parent, row.name, row.posting_date, row.item_code, row.item_name, row.qty, {"customer": row.customer})

	sales_invoice_rows = frappe.db.sql(
		"""
		select sii.parent, sii.name, sii.item_code, sii.item_name, sii.qty, sii.custom_tag_no, si.posting_date, si.customer
		from `tabSales Invoice Item` sii
		inner join `tabSales Invoice` si on si.name = sii.parent
		where sii.custom_tag_no in %(tags)s
		order by si.posting_date asc, sii.idx asc
		""",
		{"tags": placeholders},
		as_dict=True,
	)
	for row in sales_invoice_rows:
		add_event(row.custom_tag_no, "Sales Invoice", "Sales Invoice", row.parent, row.name, row.posting_date, row.item_code, row.item_name, row.qty, {"customer": row.customer})

	for tag_no, payload in traces.items():
		payload["events"].sort(key=lambda d: ((d.get("date") or "9999-12-31"), d.get("doctype") or "", d.get("docname") or ""))

	return traces


def _build_tag_tree(tag_trace_rows):
	groups = {}
	for trace in tag_trace_rows:
		registry = trace.get("registry") or {}
		root_tag = registry.get("root_tag_no") or trace.get("tag_no")
		parent_tag = registry.get("parent_tag_no")
		group = groups.setdefault(
			root_tag,
			{
				"root_tag_no": root_tag,
				"root_trace": None,
				"children": [],
			},
		)
		if not parent_tag:
			group["root_trace"] = trace
		else:
			group["children"].append(trace)

	for root_tag, group in groups.items():
		group["children"].sort(key=lambda d: d.get("tag_no") or "")
		if not group["root_trace"]:
			group["root_trace"] = {
				"tag_no": root_tag,
				"registry": {"tag_no": root_tag, "root_tag_no": root_tag, "status": "Active"},
				"events": [],
			}

	return [groups[key] for key in sorted(groups.keys())]


@frappe.whitelist()
def get_tag_trace(tag_no):
	traces = _get_tag_trace_rows([tag_no])
	return traces.get(tag_no, {"tag_no": tag_no, "events": []})


def sync_sales_order_item_dimensions(doc, method=None):
	for row in doc.items or []:
		if not _has_field(row.doctype, "custom_dimension"):
			continue

		parts = []
		for value in [row.get("custom_thickness"), row.get("custom_width"), row.get("custom_length_c")]:
			if value in (None, ""):
				continue
			text = _format_dimension_part(value)
			if text:
				parts.append(text)

		row.custom_dimension = " x ".join(parts)


@frappe.whitelist()
def backfill_sales_order_item_dimensions(sales_order=None):
	filters = {"name": sales_order} if sales_order else {}
	names = frappe.get_all("Sales Order", filters=filters, pluck="name")
	updated = []

	for name in names:
		doc = frappe.get_doc("Sales Order", name)
		changed = False
		for row in doc.items or []:
			if not _has_field(row.doctype, "custom_dimension"):
				continue

			parts = []
			for value in [row.get("custom_thickness"), row.get("custom_width"), row.get("custom_length_c")]:
				if value in (None, ""):
					continue
				text = _format_dimension_part(value)
				if text:
					parts.append(text)

			dimension = " x ".join(parts)
			if (row.get("custom_dimension") or "") != dimension:
				frappe.db.set_value(
					row.doctype,
					row.name,
					"custom_dimension",
					dimension,
					update_modified=False,
				)
				changed = True

		if changed:
			updated.append(name)

	return {"updated_sales_orders": updated, "count": len(updated)}


def assign_sales_order_item_tags(doc, method=None):
	"""Sales Order does not create tags. Only sync manually linked tags to the registry."""
	for row in doc.items or []:
		if not row.get("custom_tag_no"):
			continue
		_update_tag_location(
			doc,
			row,
			status="Linked",
			sales_order=doc.name,
		)


def sync_sales_order_item_tag_registry(doc, method=None):
	for row in doc.items or []:
		if row.get("custom_tag_no"):
			_update_tag_location(
				doc,
				row,
				status="Linked",
				sales_order=doc.name,
			)
		if row.get("custom_raw_material_tag_no"):
			frappe.db.set_value(
				"Tag Registry",
				{"tag_no": row.custom_raw_material_tag_no},
				"sales_order",
				doc.name,
				update_modified=False,
			)


def assign_purchase_receipt_item_tags(doc, method=None):
	for row in doc.items or []:
		if not _has_field(row.doctype, "custom_tag_no"):
			continue

		carried_tag = _resolve_carried_tag(row, doc)
		if carried_tag:
			row.custom_tag_no = carried_tag
			_update_tag_location(
				doc,
				row,
				sales_order=getattr(row, "sales_order", None) or getattr(doc, "custom_sales_order", None),
			)
			continue

		if not _tag_creation_enabled(doc, row):
			continue

		_create_origin_tag(
			doc,
			row,
			"Purchase Receipt",
			sales_order=getattr(row, "sales_order", None) or getattr(doc, "custom_sales_order", None),
		)


def assign_purchase_invoice_item_tags(doc, method=None):
	for row in doc.items or []:
		if not _has_field(row.doctype, "custom_tag_no"):
			continue

		if not row.custom_tag_no and getattr(row, "purchase_receipt_item", None):
			row.custom_tag_no = _find_purchase_receipt_item_tag(
				pr_detail=row.purchase_receipt_item,
				item_code=row.item_code,
			)
		if not row.custom_tag_no:
			row.custom_tag_no = _resolve_carried_tag(row, doc)

		if row.custom_tag_no:
			_update_tag_location(
				doc,
				row,
				sales_order=getattr(row, "sales_order", None) or getattr(doc, "custom_sales_order", None),
			)


def assign_stock_entry_detail_tags(doc, method=None):
	is_receipt = _is_material_receipt_stock_entry(doc)
	for row in doc.items or []:
		if not _has_field(row.doctype, "custom_tag_no"):
			continue

		carried_tag = _resolve_carried_tag(row, doc)
		if carried_tag:
			row.custom_tag_no = carried_tag
			_update_tag_location(
				doc,
				row,
				sales_order=getattr(doc, "custom_sales_order", None),
				stock_entry=doc.name,
			)
			continue

		if is_receipt and _tag_creation_enabled(doc, row):
			_create_origin_tag(
				doc,
				row,
				"Stock Entry",
				sales_order=getattr(doc, "custom_sales_order", None),
				stock_entry=doc.name,
			)
		elif row.custom_tag_no:
			_update_tag_location(
				doc,
				row,
				sales_order=getattr(doc, "custom_sales_order", None),
				stock_entry=doc.name,
			)


def prepare_ss_coil_output_tags(doc, method=None):
	if getattr(getattr(doc, "flags", None), "skip_auto_job_output", False):
		return
	_sync_job_output_rows_from_cutting_detail(doc)
	parent_input = (doc.input_coil or [None])[0]
	parent_tag_no = getattr(parent_input, "tag_no", None) if parent_input else None
	root_tag_no = _root_tag_for(parent_tag_no) if parent_tag_no else None

	for row in doc.job_output or []:
		row_parent_tag = parent_tag_no
		if row.tag_no:
			_ensure_origin_tag_available(row.tag_no, "SS Coil", doc.name, row.doctype, row.name)
		if row_parent_tag and not row.tag_no:
			row.tag_no = _next_sub_tag(row_parent_tag)

		if row.tag_no:
			_register_tag(
				row.tag_no,
				source_doctype="SS Coil",
				source_docname=doc.name,
				source_child_doctype=row.doctype,
				source_child_name=row.name,
				item_code=getattr(row, "class", None),
				item_name=getattr(row, "class", None),
				sales_order=doc.order_no,
				stock_entry=doc.stock_entry,
				parent_tag_no=row_parent_tag,
				root_tag_no=root_tag_no or row_parent_tag or row.tag_no,
				status="Produced",
			)


def _get_coil_output_target_fields():
	meta = frappe.get_meta("Coil Output")
	ignored_fieldtypes = {
		"Section Break",
		"Column Break",
		"Tab Break",
		"HTML",
		"Button",
		"Table",
		"Table MultiSelect",
	}
	return [df.fieldname for df in meta.fields if df.fieldname and df.fieldtype not in ignored_fieldtypes]


def _build_child_tag(parent_tag_no, sequence_number):
	if not parent_tag_no:
		return ""
	parent_tag = str(parent_tag_no).strip()
	sequence = str(cint(sequence_number)).zfill(3)
	settings = _tag_settings()
	suffix = settings.get("suffix") or "-000"
	base = parent_tag[:-len(suffix)] if suffix and parent_tag.endswith(suffix) else parent_tag
	return f"{base}-{sequence}"


def _sync_job_output_rows_from_cutting_detail(doc):
	input_row = (doc.input_coil or [None])[0]
	so_row = (doc.so_item or [None])[0]
	if not input_row:
		return

	existing_rows = list(doc.job_output or [])
	cutting_rows = doc.cutting_detail or []
	total_pieces = sum(max(0, cint(getattr(row, "strip", 0))) for row in cutting_rows)
	target_fields = _get_coil_output_target_fields()

	def resolve_parent_tag_base():
		# Normally input_row.tag_no is the parent tag every output row's
		# child tag is derived from. If that field is blank (e.g. cleared
		# after the fact) but a sibling output row already has a tag, infer
		# the same base from it instead of leaving new rows untagged.
		parent_tag = getattr(input_row, "tag_no", None)
		if parent_tag:
			return parent_tag
		for existing_row in existing_rows:
			existing_tag = getattr(existing_row, "tag_no", None)
			if not existing_tag:
				continue
			match = re.match(r"^(.*)-\d{3}$", str(existing_tag).strip())
			if match:
				return match.group(1)
		return None

	parent_tag_base = resolve_parent_tag_base()

	def apply_values(row, existing_row=None, sequence_number=1, output_width=None, pieces_count=1):
		estimated_qty = flt(getattr(input_row, "estimated_qty", 0)) / pieces_count if pieces_count else flt(getattr(input_row, "estimated_qty", 0))
		estimated_wt = flt(getattr(input_row, "estimated_wt", 0)) / pieces_count if pieces_count else flt(getattr(input_row, "estimated_wt", 0))
		for fieldname in target_fields:
			if fieldname == "class":
				row.set("class", getattr(input_row, "class", None))
			elif fieldname == "tag_no":
				row.tag_no = getattr(existing_row, "tag_no", None) or _build_child_tag(parent_tag_base, sequence_number)
			elif fieldname == "estimated_qty":
				row.estimated_qty = estimated_qty
			elif fieldname == "actual_qty":
				row.actual_qty = getattr(existing_row, "actual_qty", None) or estimated_qty
			elif fieldname == "estimated_wt":
				row.estimated_wt = getattr(existing_row, "estimated_wt", None) or estimated_wt
			elif fieldname == "actual_wt":
				row.actual_wt = getattr(existing_row, "actual_wt", None) or estimated_wt
			elif fieldname == "customer":
				row.customer = getattr(doc, "customer_name", None)
			elif fieldname == "thickness":
				row.thickness = (getattr(existing_row, "thickness", None) or getattr(so_row, "thickness", None) or getattr(input_row, "thickness", None))
			elif fieldname == "width":
				row.width = output_width or getattr(existing_row, "width", None) or getattr(so_row, "width", None)
			elif fieldname == "packing":
				row.packing = getattr(existing_row, "packing", None) or getattr(so_row, "packing", None) or getattr(so_row, "custom_packing_type", None)
			elif fieldname == "length":
				row.length = getattr(existing_row, "length", None) or getattr(input_row, "length", None)
			elif fieldname == "barcode":
				row.barcode = getattr(existing_row, "barcode", None) or row.tag_no
			elif fieldname in {"current_process", "next_process", "next_process_date", "qr_code"}:
				continue
			else:
				existing_value = getattr(existing_row, fieldname, None) if existing_row else None
				if existing_value not in (None, ""):
					row.set(fieldname, existing_value)
				else:
					row.set(fieldname, getattr(input_row, fieldname, None))

	doc.set("job_output", [])

	if not cutting_rows or not total_pieces:
		row = doc.append("job_output", {})
		apply_values(row, existing_rows[0] if existing_rows else None, 1, flt(getattr(so_row, "width", 0)) or flt(getattr(input_row, "width", 0)), 1)
		return

	output_index = 0
	for cutting_row in cutting_rows:
		strip_count = max(0, cint(getattr(cutting_row, "strip", 0)))
		for _ in range(strip_count):
			existing_row = existing_rows[output_index] if output_index < len(existing_rows) else None
			row = doc.append("job_output", {})
			apply_values(row, existing_row, output_index + 1, flt(getattr(cutting_row, "width", 0)), total_pieces)
			output_index += 1


def _update_sales_order_item_process_status(sales_order_item=None):
	if not sales_order_item or not frappe.db.exists("Sales Order Item", sales_order_item):
		return
	if not _has_field("Sales Order Item", "custom_status"):
		return

	rows = frappe.get_all(
		"SS Coil",
		filters={"sales_order_item": sales_order_item},
		fields=["name", "docstatus", "order_status"],
		order_by="modified desc",
	)

	status = ""
	if any((row.order_status or "") == "Completed" or row.docstatus == 1 for row in rows):
		status = "Completed"
	elif any((row.order_status or "") in ("Started", "In Process", "Partially Completed") for row in rows):
		status = "In Process"
	elif any((row.order_status or "") == "Not Started" for row in rows):
		status = "Not Started"
	elif rows:
		status = "Closed"

	frappe.db.set_value("Sales Order Item", sales_order_item, "custom_status", status, update_modified=False)


def _build_qr_payload(row, ss_coil_doc):
	payload = {
		"tag_no": row.get("tag_no"),
		"item": row.get("class"),
		"customer": row.get("customer") or ss_coil_doc.get("customer_name") or ss_coil_doc.get("customer"),
		"sales_order": ss_coil_doc.get("order_no"),
		"stock_entry": ss_coil_doc.get("stock_entry"),
		"current_process": row.get("current_process"),
		"next_process": row.get("next_process"),
		"next_process_date": row.get("next_process_date"),
		"dimension": " x ".join(filter(None, [_format_dimension_part(row.get("thickness")), _format_dimension_part(row.get("width")), _format_dimension_part(row.get("length"))])),
		"estimated_wt": _format_number(row.get("estimated_wt")) if row.get("estimated_wt") not in (None, "") else "",
	}
	return "\n".join(f"{key}: {value}" for key, value in payload.items() if value)


def _build_qr_html(payload_text, plain=False, scale=3):
	if not payload_text:
		return ""
	if pyqrcode:
		qr = pyqrcode.create(payload_text, error="M")
		buffer = BytesIO()
		qr.svg(buffer, scale=scale)
		svg = _ensure_svg_viewbox(_strip_svg_preamble(buffer.getvalue().decode()))
		if plain:
			return f'<div class="ss-coil-qr" style="padding:0;background:#fff;border:none;display:inline-block;">{svg}</div>'
		return f'<div class="ss-coil-qr" style="padding:8px; background:#fff; border:1px solid #dbe4f0; border-radius:10px; display:inline-block;">{svg}</div>'
	return (
		'<div class="ss-coil-qr-fallback" style="padding:12px; border:1px dashed #8aa2c1; '
		'border-radius:10px; font-size:11px; color:#243b53; white-space:pre-wrap; background:#fff;">'
		f"{html.escape(payload_text)}</div>"
	)


def _build_barcode_html(value):
	if not value:
		return ""
	buffer = BytesIO()
	Code128(str(value), writer=SVGWriter()).write(
		buffer,
		options={
			"module_width": 0.22,
			"module_height": 12,
			"font_size": 8,
			"text_distance": 3,
			"quiet_zone": 1,
			"write_text": False,
		},
	)
	svg = _strip_svg_preamble(buffer.getvalue().decode())
	return (
		'<div class="ss-coil-barcode" style="background:#fff;padding:6px;border:1px solid #dbe4f0;'
		'border-radius:8px;display:inline-block;">'
		f"{svg}<div style='text-align:center;font:700 11px/1.4 monospace;margin-top:4px;color:#111827;'>{html.escape(str(value))}</div></div>"
	)


@frappe.whitelist()
def get_coil_output_qr_html(payload_text):
	return _build_qr_html(payload_text)


def get_stock_entry_sticker_logo_url(company):
	logo = frappe.get_cached_value("Company", company, "company_logo") if company else None
	if logo:
		return frappe.utils.get_url(logo) if logo.startswith("/") else logo
	return "/assets/ss_coil/images/ss-coil-logo.svg"


def build_stock_entry_sticker_qr_payload(doc, row):
	"""Full data payload encoded into the sticker QR code.

	Includes every field shown on the sticker plus the Sales Order (Stock
	Entry) and the Company's Domain, which aren't printed on the sticker
	itself.
	"""
	fields = dict(build_stock_entry_sticker_payload(doc, row))
	fields["Sales Order"] = doc.get("custom_sales_order") or "-"
	fields["Domain"] = frappe.get_cached_value("Company", doc.get("company"), "domain") or "-" if doc.get("company") else "-"
	return "\n".join(f"{label}: {value}" for label, value in fields.items())


def build_stock_entry_sticker_payload(doc, row):
	"""Build QR/text payload for a Stock Entry item sticker."""
	date_value = frappe.format(doc.get("posting_date"), {"fieldtype": "Date"}) if doc.get("posting_date") else "-"

	def _fmt_float(value):
		return frappe.format(value, {"fieldtype": "Float"}) if value not in (None, "") else "-"

	return {
		"Tag No": row.get("custom_tag_no") or "-",
		"Customer": doc.get("custom_customer") or "-",
		"Item Name": row.get("item_name") or row.get("item_code") or "-",
		"Specification": row.get("custom_specification") or "-",
		"Qty": _fmt_float(row.get("qty")),
		"No of Coils": _fmt_float(row.get("custom_qty_of_coil")),
		"Thickness": row.get("custom_thickness") or "-",
		"Width": row.get("custom_width") or "-",
		"Length": row.get("custom_length") or "-",
		"Mill": row.get("custom_mill") or "-",
		"Ref No": row.get("custom_ref_no") or "-",
		"Date": date_value,
		"Entry No": doc.get("name") or "-",
		"Company Name": doc.get("company") or "-",
	}


def _sticker_field_line(label, value, cls=""):
	css_class = f"sticker-line {cls}".strip()
	return (
		f'<div class="{css_class}"><span class="sticker-label">{html.escape(label)}:</span> '
		f'<span class="sticker-value">{html.escape(str(value))}</span></div>'
	)


def _sticker_triple_row(items, divider=False):
	# Fixed-pixel inline-block cells instead of a nested percentage table:
	# a percentage-width table-layout:fixed table nested inside another
	# table's cell can't reliably resolve its containing-block width in
	# print/PDF rendering engines, so percentage columns were silently
	# collapsing back to a much narrower width than declared.
	col_classes = ("sticker-triple-col-wide", "sticker-triple-col-narrow", "sticker-triple-col-narrow")
	cells = "".join(
		f'<div class="sticker-triple-cell {col_classes[i]}">'
		f'<div class="sticker-triple-label">{html.escape(label)}</div>'
		f'<div class="sticker-triple-value">{html.escape(str(value))}</div>'
		"</div>"
		for i, (label, value) in enumerate(items)
	)
	row_class = "sticker-triple sticker-triple-divider" if divider else "sticker-triple"
	return f'<div class="{row_class}">{cells}</div>'


def build_stock_entry_sticker_body_html(fields):
	"""Build the ordered/grouped field markup for the sticker's left column."""
	triple_box = (
		'<div class="sticker-triple-box">'
		+ _sticker_triple_row(
			[
				("Spec", fields["Specification"]),
				("Qty", fields["Qty"]),
				("Coils", fields["No of Coils"]),
			]
		)
		+ _sticker_triple_row(
			[
				("Thick", fields["Thickness"]),
				("Width", fields["Width"]),
				("Length", fields["Length"]),
			],
			divider=True,
		)
		+ "</div>"
	)
	return "".join(
		[
			f'<div class="sticker-tagno">{html.escape(str(fields["Tag No"]))}</div>',
			_sticker_field_line("Customer", fields["Customer"]),
			_sticker_field_line("Item Name", fields["Item Name"]),
			triple_box,
			_sticker_field_line("Mill", fields["Mill"]),
			_sticker_field_line("Ref No", fields["Ref No"]),
		]
	)


def build_stock_entry_sticker_combo_html(fields):
	"""Full-width, centered 'Mill x Qty x Thickness x Width' line below the two-column layout."""
	combo_value = " x ".join(str(fields[key]) for key in ("Mill", "Qty", "Thickness", "Width"))
	return f'<div class="sticker-combo-line">{html.escape(combo_value)}</div>'


def build_stock_entry_sticker_footer_html(doc):
	logo_url = get_stock_entry_sticker_logo_url(doc.get("company"))
	logo_html = (
		f'<div class="sticker-logo-box"><img src="{html.escape(logo_url)}" alt="Logo" class="sticker-logo"></div>'
		if logo_url
		else ""
	)
	entry_no = doc.get("name") or "-"
	date_value = (
		frappe.format(doc.get("posting_date"), {"fieldtype": "Date"}) if doc.get("posting_date") else "-"
	)
	company_name = doc.get("company") or "-"
	lines_html = (
		f'<div class="sticker-footer-line"><span class="sticker-label">Entry No:</span> '
		f'<span class="sticker-value">{html.escape(str(entry_no))}</span></div>'
		f'<div class="sticker-footer-line"><span class="sticker-label">Date:</span> '
		f'<span class="sticker-value">{html.escape(str(date_value))}</span></div>'
		f'<div class="sticker-footer-line sticker-company-name">{html.escape(str(company_name))}</div>'
	)
	return f'<div class="sticker-footer">{logo_html}<div class="sticker-footer-text">{lines_html}</div></div>'


def _get_sticker_items(doc, item_names=None, filter_items=False):
	if hasattr(doc, "items"):
		items = doc.items or []
	else:
		items = doc.get("items") or []
	if not filter_items:
		return items
	if isinstance(item_names, str):
		item_names = frappe.parse_json(item_names)
	if not item_names:
		return []
	name_set = set(item_names)
	return [row for row in items if row.name in name_set]


def _get_sticker_print_options(print_format=None, print_settings=None):
	print_settings = print_settings or {}
	has_filter = "item_names" in print_settings
	item_names = print_settings.get("item_names")
	if isinstance(item_names, str):
		item_names = frappe.parse_json(item_names)
	layout = print_settings.get("layout")
	if not layout:
		layout = "thermal" if print_format and "Thermal" in print_format else "a4"
	return item_names, layout, has_filter


@frappe.whitelist()
def build_stock_entry_sticker_html(doc, row):
	"""Return sticker HTML block with QR code and field text for one item row."""
	if isinstance(doc, str):
		doc = frappe.parse_json(doc)
	if isinstance(row, str):
		row = frappe.parse_json(row)
	if not isinstance(doc, dict):
		doc = doc.as_dict()
	if not isinstance(row, dict):
		row = row.as_dict()

	fields = build_stock_entry_sticker_payload(doc, row)
	qr_html = _build_qr_html(build_stock_entry_sticker_qr_payload(doc, row), plain=True, scale=4)
	lines_html = build_stock_entry_sticker_body_html(fields)
	combo_html = build_stock_entry_sticker_combo_html(fields)
	footer_html = build_stock_entry_sticker_footer_html(doc)
	return f"""
	<div class="sticker-card">
		<table class="sticker-inner" cellspacing="0" cellpadding="0">
			<tr>
				<td class="sticker-fields">{lines_html}</td>
				<td class="sticker-qr">{qr_html}</td>
			</tr>
		</table>
		{combo_html}
		{footer_html}
	</div>
	"""


def build_stock_entry_sticker_sheet_html(doc, item_names=None, layout="a4", filter_items=False):
	"""Build sticker sheet HTML for selected item rows."""
	rows = _get_sticker_items(doc, item_names=item_names, filter_items=filter_items)
	stickers = [
		build_stock_entry_sticker_html(doc, row.as_dict() if hasattr(row, "as_dict") else row) for row in rows
	]
	if not stickers:
		return ""

	if layout == "thermal":
		return '<div class="sticker-thermal-sheet">' + "".join(
			f'<div class="sticker-thermal-item">{sticker_html}</div>' for sticker_html in stickers
		) + "</div>"

	parts = ['<table class="sticker-sheet" cellspacing="0" cellpadding="0">']
	for sticker_html in stickers:
		parts.append(f"<tr><td>{sticker_html}</td></tr>")
	parts.append("</table>")
	return "".join(parts)


def prepare_stock_entry_sticker_print(doc, method=None, print_settings=None):
	"""Build sticker sheet HTML on the Stock Entry before printing."""
	print_format = (getattr(frappe, "form_dict", None) or {}).get("format")
	if print_format not in ("Stock Entry Sticker", "Stock Entry Sticker Thermal"):
		return

	item_names, layout, has_filter = _get_sticker_print_options(print_format, print_settings)
	html = build_stock_entry_sticker_sheet_html(
		doc, item_names=item_names, layout=layout, filter_items=has_filter
	)
	doc.custom_sticker_print_html = html or ""


@frappe.whitelist()
def get_stock_entry_sticker_qr_image(stock_entry, item_name):
	"""Return QR SVG image for one Stock Entry item sticker."""
	doc = frappe.get_doc("Stock Entry", stock_entry)
	row = next((item for item in doc.items if item.name == item_name), None)
	if not row:
		frappe.throw(_("Stock Entry item row not found"))

	payload_text = build_stock_entry_sticker_qr_payload(doc, row.as_dict())
	if not pyqrcode:
		frappe.local.response.filecontent = payload_text.encode()
		frappe.local.response.type = "download"
		frappe.local.response.filename = f"sticker-{item_name}.txt"
		return

	qr = pyqrcode.create(payload_text, error="M")
	buffer = BytesIO()
	qr.svg(buffer, scale=4)
	svg = buffer.getvalue()
	frappe.local.response.filecontent = svg
	frappe.local.response.type = "download"
	frappe.local.response.filename = f"sticker-{item_name}.svg"
	frappe.local.response["content_type"] = "image/svg+xml"


@frappe.whitelist()
def get_stock_entry_sticker_html(stock_entry, item_name):
	doc = frappe.get_doc("Stock Entry", stock_entry)
	row = frappe._dict(next((item.as_dict() for item in doc.items if item.name == item_name), {}))
	if not row:
		return ""
	return build_stock_entry_sticker_html(doc, row)


def _build_output_tag_cards_html(ss_coil_doc):
	cards = []
	for row in ss_coil_doc.get("job_output") or []:
		payload = _build_qr_payload(row, ss_coil_doc)
		qr_html = _build_qr_html(payload)
		dimension = " x ".join(
			filter(
				None,
				[
					_format_dimension_part(row.get("thickness")),
					_format_dimension_part(row.get("width")),
					_format_dimension_part(row.get("length")),
				],
			)
		)
		cards.append(
			f"""
			<div class="tag-card">
				<div class="tag-left">
					<div class="tag-title">{html.escape(row.get("tag_no") or "-")}</div>
					<div class="tag-line"><b>Item:</b> {html.escape(str(row.get("class") or "-"))}</div>
					<div class="tag-line"><b>Customer:</b> {html.escape(str(row.get("customer") or ss_coil_doc.get("customer_name") or "-"))}</div>
					<div class="tag-line"><b>Sales Order:</b> {html.escape(str(ss_coil_doc.get("order_no") or "-"))}</div>
					<div class="tag-line"><b>Current Process:</b> {html.escape(str(row.get("current_process") or "-"))}</div>
					<div class="tag-line"><b>Next Process:</b> {html.escape(str(row.get("next_process") or "-"))}</div>
					<div class="tag-line"><b>Dimension:</b> {html.escape(dimension or "-")}</div>
					<div class="tag-line"><b>Packing:</b> {html.escape(str(row.get("packing") or "-"))}</div>
					<div class="tag-line"><b>Estimated WT:</b> {html.escape(_format_number(row.get("estimated_wt")) if row.get("estimated_wt") not in (None, "") else "-")}</div>
				</div>
				<div class="tag-right">
					<div class="tag-code-block">{_build_barcode_html(row.get("barcode") or row.get("tag_no"))}</div>
					<div class="tag-code-block">{qr_html}</div>
				</div>
			</div>
			"""
		)

	return f"""
	<!DOCTYPE html>
	<html>
	<head>
		<meta charset="utf-8">
		<title>SS Coil Output Tags - {html.escape(ss_coil_doc.get('name') or '')}</title>
		<style>
			body {{
				font-family: Arial, sans-serif;
				margin: 16px;
				color: #1f2937;
				background: #ffffff;
			}}
			.page-title {{
				font-size: 22px;
				font-weight: 700;
				margin-bottom: 4px;
			}}
			.page-subtitle {{
				font-size: 13px;
				color: #4b5563;
				margin-bottom: 18px;
			}}
			.tag-grid {{
				display: grid;
				grid-template-columns: repeat(2, minmax(0, 1fr));
				gap: 10px;
			}}
			.tag-card {{
				border: 1px solid #0f172a;
				border-radius: 10px;
				padding: 10px;
				display: grid;
				grid-template-columns: 1.2fr 1fr;
				gap: 8px;
				align-items: start;
				break-inside: avoid;
				page-break-inside: avoid;
				min-height: 94mm;
			}}
			.tag-title {{
				font-size: 16px;
				font-weight: 700;
				color: #0f172a;
				margin-bottom: 6px;
			}}
			.tag-line {{
				font-size: 11px;
				line-height: 1.5;
			}}
			.tag-right {{
				display: flex;
				flex-direction: column;
				align-items: center;
				justify-content: flex-start;
				gap: 8px;
				min-height: 100%;
			}}
			.tag-code-block {{
				width: 100%;
				display: flex;
				align-items: center;
				justify-content: center;
			}}
			.page-brand {{
				display:flex;
				align-items:center;
				gap:10px;
				margin-bottom:10px;
			}}
			.page-brand img {{
				height:34px;
				width:auto;
			}}
			@media print {{
				@page {{ size: A4 portrait; margin: 8mm; }}
				body {{ margin: 0; }}
				.tag-grid {{ gap: 8px; }}
			}}
		</style>
	</head>
	<body>
		<div class="page-brand">
			<img src="/assets/ss_coil/images/ss-coil-logo.svg" alt="SS Coil Logo">
			<div>
				<div class="page-title">SS Coil Output Tags</div>
				<div class="page-subtitle">{html.escape(ss_coil_doc.get('name') or '')} | Sales Order: {html.escape(str(ss_coil_doc.get('order_no') or '-'))}</div>
			</div>
		</div>
		<div class="tag-grid">
			{''.join(cards) if cards else '<div>No output tags found.</div>'}
		</div>
	</body>
	</html>
	"""


@frappe.whitelist()
def get_ss_coil_output_tags_html(ss_coil_name):
	if not frappe.db.exists("SS Coil", ss_coil_name):
		frappe.throw(f"SS Coil {ss_coil_name} not found")
	doc = frappe.get_doc("SS Coil", ss_coil_name)
	return _build_output_tag_cards_html(doc)


@frappe.whitelist()
def render_ss_coil_output_tags_page(ss_coil_name, print_view=0):
	if not frappe.db.exists("SS Coil", ss_coil_name):
		frappe.throw(f"SS Coil {ss_coil_name} not found")
	doc = frappe.get_doc("SS Coil", ss_coil_name)
	html_content = _build_output_tag_cards_html(doc)
	if cint(print_view):
		html_content = html_content.replace(
			"</body>",
			"<script>window.addEventListener('load', function(){ setTimeout(function(){ window.print(); }, 400); });</script></body>",
		)
	frappe.response["type"] = "download"
	frappe.response["filename"] = f"{doc.name}-output-tags.html"
	frappe.response["filecontent"] = html_content.encode("utf-8")
	frappe.response["content_type"] = "text/html; charset=utf-8"
	frappe.response["display_content_as"] = "inline"


def sync_ss_coil_process_tracking(doc, method=None):
	operation_value = _clean_text(getattr(doc, "operation", None))
	current_process = _label_for_process(operation_value)

	so_row = (doc.so_item or [None])[0]
	input_row = (doc.input_coil or [None])[0]

	configured_processes = []
	if so_row:
		configured_processes = _get_enabled_processes_from_row(so_row)
	if not configured_processes and input_row:
		configured_processes = _get_enabled_processes_from_row(input_row)

	next_process = _next_process_for(operation_value, configured_processes)
	next_process_label = _label_for_process(next_process)
	next_process_date = nowdate() if next_process_label else ""

	for row in doc.input_coil or []:
		for fieldname in PROCESS_FIELDS:
			if not getattr(row, fieldname, None) and so_row and getattr(so_row, fieldname, None):
				setattr(row, fieldname, getattr(so_row, fieldname, None))
		if not getattr(row, "next_process", None):
			row.next_process = current_process or next_process_label

	for row in doc.job_output or []:
		row.current_process = current_process
		row.next_process = next_process_label or ""
		row.next_process_date = next_process_date
		row.barcode = row.tag_no or ""
		row.qr_code = _build_qr_html(_build_qr_payload(row, doc))

	if getattr(doc, "sales_order_item", None):
		_update_sales_order_item_process_status(doc.sales_order_item)
	sync_sales_order_item_child_tags(doc, method=method)


def _resolve_operation_name(process_value):
	if not process_value:
		return ""
	process_text = str(process_value).strip()
	if frappe.db.exists("Operation", process_text):
		return process_text
	match = frappe.db.sql(
		"""
		select name
		from `tabOperation`
		where lower(name) = lower(%s)
		limit 1
		""",
		(process_text,),
	)
	return match[0][0] if match else process_text


def _make_output_dimension(row):
	return " x ".join(
		part
		for part in (
			_format_dimension_part(getattr(row, "thickness", None)),
			_format_dimension_part(getattr(row, "width", None)),
			_format_dimension_part(getattr(row, "length", None)),
		)
		if part
	)


def _find_existing_next_process_doc(source_doc, next_operation, tag_no):
	if not tag_no:
		return None
	rows = frappe.db.sql(
		"""
		select parent
		from `tabCoil Input`
		where tag_no = %s
			and parenttype = 'SS Coil'
			and parent in (
				select name from `tabSS Coil`
				where ifnull(order_no, '') = %s
					and ifnull(sales_order_item, '') = %s
					and ifnull(operation, '') = %s
			)
		order by creation desc
		limit 1
		""",
		(tag_no, source_doc.order_no or "", source_doc.sales_order_item or "", next_operation or ""),
		as_dict=True,
	)
	return rows[0].parent if rows else None


@frappe.whitelist()
def create_next_ss_coil_entry(source_name):
	if not frappe.db.exists("SS Coil", source_name):
		frappe.throw(f"SS Coil {source_name} not found")

	source_doc = frappe.get_doc("SS Coil", source_name)
	next_process = ""
	for row in source_doc.job_output or []:
		if getattr(row, "next_process", None):
			next_process = row.next_process
			break

	if not next_process:
		# Not an error: this item's configured process chain (so_item's
		# slitter/leveler/reshearing flags) simply ends at this document's
		# operation - e.g. only Slitter+Leveler are required, so completing
		# Leveler has nothing further to advance to. Both the "Create Next
		# Process" button (only shown when getNextProcessLabelFromOutputs
		# finds something) and the auto-trigger after "Complete" already
		# guard against calling this with nothing to do, but return
		# gracefully here too for any other caller.
		return {"created_docs": [], "skipped_docs": [], "count": 0, "skipped_count": 0, "no_next_process": True}

	next_operation = _resolve_operation_name(next_process)
	created_docs = []
	skipped_docs = []
	for output_row in source_doc.job_output or []:
		existing_name = _find_existing_next_process_doc(source_doc, next_operation, output_row.get("tag_no"))
		if existing_name:
			skipped_docs.append(
				{
					"name": existing_name,
					"tag_no": output_row.get("tag_no"),
					"operation": next_operation,
					"order_status": frappe.db.get_value("SS Coil", existing_name, "order_status"),
				}
			)
			continue

		target_doc = frappe.new_doc("SS Coil")
		target_doc.operation = next_operation
		target_doc.order_status = "Not Started"
		target_doc.order_no = source_doc.order_no
		target_doc.sales_order_item = source_doc.sales_order_item
		target_doc.customer_name = source_doc.customer_name
		target_doc.for_customer = source_doc.for_customer
		target_doc.order_received_date = source_doc.order_received_date
		target_doc.sc_date = nowdate()
		target_doc.job_sheet_no = source_doc.job_sheet_no
		target_doc.machine = source_doc.machine
		target_doc.special_instructions = source_doc.special_instructions
		target_doc.remarks = source_doc.remarks

		for fieldname in ("thickness", "width", "ds", "ctr", "ws", "mill", "specifications", "commodity", "works"):
			if hasattr(target_doc, fieldname):
				setattr(target_doc, fieldname, getattr(source_doc, fieldname, None))

		for source_row in source_doc.so_item or []:
			target_doc.append(
				"so_item",
				{
					"item_name": source_row.item_name,
					"dimension": source_row.dimension,
					"ref_no": source_row.ref_no,
					"location": source_row.location,
					"tag_no": source_row.tag_no,
					"specification": source_row.specification,
					"thickness": source_row.thickness,
					"qty": source_row.qty,
					"width": source_row.width,
					"so_number": source_row.so_number,
					"estimated_wt": source_row.estimated_wt,
					"length": source_row.length,
					"length_c": source_row.length_c,
					"qty_of_coil": source_row.qty_of_coil,
					"condition": source_row.condition,
					"remarks": source_row.remarks,
					"comments": source_row.comments,
					"slitter": source_row.slitter,
					"leveler": source_row.leveler,
					"reshearing": source_row.reshearing,
				},
			)

		target_doc.append(
			"input_coil",
			{
				"class": output_row.get("class"),
				"tag_no": output_row.get("tag_no"),
				"dimension": _make_output_dimension(output_row),
				"length": output_row.get("length"),
				"estimated_qty": output_row.get("estimated_qty"),
				"estimated_wt": output_row.get("estimated_wt"),
				"actual_qty": output_row.get("actual_qty"),
				"actual_wt": output_row.get("actual_wt"),
				"previous_job_order": source_doc.operation,
				"processed_date": nowdate(),
				"slitter": (source_doc.so_item[0].slitter if source_doc.so_item else ""),
				"leveler": (source_doc.so_item[0].leveler if source_doc.so_item else ""),
				"reshearing": (source_doc.so_item[0].reshearing if source_doc.so_item else ""),
				"next_process": output_row.get("next_process"),
			},
		)

		target_doc.flags.skip_auto_job_output = True
		target_doc.insert(ignore_permissions=True)
		created_docs.append(
			{
				"name": target_doc.name,
				"tag_no": output_row.get("tag_no"),
				"operation": target_doc.operation,
				"order_status": target_doc.order_status,
			}
		)

	frappe.db.commit()
	return {
		"created_docs": created_docs,
		"skipped_docs": skipped_docs,
		"count": len(created_docs),
		"skipped_count": len(skipped_docs),
	}


@frappe.whitelist()
def sync_ss_coil_output_tags(ss_coil=None):
	filters = {"name": ss_coil} if ss_coil else {}
	names = frappe.get_all("SS Coil", filters=filters, pluck="name")
	updated = []
	for name in names:
		doc = frappe.get_doc("SS Coil", name)
		parent_input = (doc.input_coil or [None])[0]
		parent_tag_no = getattr(parent_input, "tag_no", None) if parent_input else None
		root_tag_no = _root_tag_for(parent_tag_no) if parent_tag_no else None
		doc_changed = False

		for row in doc.job_output or []:
			effective_tag = row.tag_no
			if parent_tag_no and _is_child_subtag(getattr(row, "class", None), parent_tag_no):
				effective_tag = getattr(row, "class", None)
			elif not effective_tag and parent_tag_no:
				effective_tag = _next_sub_tag(parent_tag_no)

			if effective_tag and row.tag_no != effective_tag:
				frappe.db.set_value(row.doctype, row.name, "tag_no", effective_tag, update_modified=False)
				row.tag_no = effective_tag
				doc_changed = True

			if effective_tag:
				_register_tag(
					effective_tag,
					source_doctype="SS Coil",
					source_docname=doc.name,
					source_child_doctype=row.doctype,
					source_child_name=row.name,
					item_code=getattr(row, "class", None),
					item_name=getattr(row, "class", None),
					sales_order=doc.order_no,
					stock_entry=doc.stock_entry,
					parent_tag_no=parent_tag_no,
					root_tag_no=root_tag_no or parent_tag_no or effective_tag,
					status="Produced",
				)

		if doc_changed:
			updated.append(doc.name)

	frappe.clear_cache()
	return {"updated_docs": updated, "count": len(updated)}


def _linked_rows_by_tags(doctype, child_doctype, parent_field, tag_field, tags, fields, order_by="modified desc"):
	if not tags:
		return []
	tag_tuple = tuple(tags)
	select_fields = ", ".join(fields)
	return frappe.db.sql(
		f"""
		select
			{select_fields}
		from `tab{child_doctype}` child
		inner join `tab{doctype}` parent on parent.name = child.parent
		where child.{tag_field} in %(tags)s
		order by {order_by}
		""",
		{"tags": tag_tuple},
		as_dict=True,
	)


def _build_tag_hierarchy(root_tag_no):
	if not root_tag_no or not frappe.db.exists("DocType", "Tag Registry"):
		return {}

	rows = frappe.get_all(
		"Tag Registry",
		filters={"root_tag_no": root_tag_no},
		fields=[
			"name",
			"tag_no",
			"status",
			"source_doctype",
			"source_docname",
			"current_doctype",
			"current_docname",
			"parent_tag_no",
			"root_tag_no",
			"item_code",
			"item_name",
			"sales_order",
		],
		order_by="tag_no asc",
	)
	if not rows:
		root_row = frappe.db.get_value(
			"Tag Registry",
			{"tag_no": root_tag_no},
			[
				"name",
				"tag_no",
				"status",
				"source_doctype",
				"source_docname",
				"current_doctype",
				"current_docname",
				"parent_tag_no",
				"root_tag_no",
				"item_code",
				"item_name",
				"sales_order",
			],
			as_dict=True,
		)
		rows = [root_row] if root_row else []
	if not rows:
		return {}

	nodes = {}
	for row in rows:
		nodes[row.tag_no] = {
			**row,
			"children": [],
		}

	root_node = None
	for row in rows:
		tag_no = row.tag_no
		parent = row.parent_tag_no
		if parent and parent in nodes and parent != tag_no:
			nodes[parent]["children"].append(nodes[tag_no])
		else:
			if tag_no == root_tag_no:
				root_node = nodes[tag_no]

	if not root_node:
		root_node = nodes.get(root_tag_no) or nodes[rows[0].tag_no]

	def enrich(node, depth=0):
		tag_no = node.get("tag_no")
		node["depth"] = depth
		prev_docs = frappe.db.sql(
			"""
			select distinct parent.name, parent.operation, parent.order_status
			from `tabCoil Output` child
			inner join `tabSS Coil` parent on parent.name = child.parent
			where child.tag_no = %s
			order by parent.modified desc
			limit 5
			""",
			(tag_no,),
			as_dict=True,
		)
		next_docs = frappe.db.sql(
			"""
			select distinct parent.name, parent.operation, parent.order_status
			from `tabCoil Input` child
			inner join `tabSS Coil` parent on parent.name = child.parent
			where child.tag_no = %s
			order by parent.modified desc
			limit 5
			""",
			(tag_no,),
			as_dict=True,
		)
		node["previous_docs"] = prev_docs
		node["next_docs"] = next_docs
		node["child_count"] = len(node.get("children") or [])
		node["descendant_count"] = 0
		for child in node.get("children") or []:
			enrich(child, depth + 1)
			node["descendant_count"] += 1 + cint(child.get("descendant_count"))
		return node

	return enrich(root_node, 0)


def _build_ss_coil_process_checklist(doc, so_item):
	"""Per-item process demand vs. actual completion: which of the processes
	the customer's Sales Order Item asked for (so_item.slitter/leveler/
	reshearing) are Completed/In Process/Pending, across every SS Coil
	document for that same sales_order_item - not just this one. Each stage
	is a child of the previous one in the chain (see
	create_next_ss_coil_entry), so this doubles as "how far along the chain
	is this item overall."
	"""
	if not so_item:
		return []

	configured = [key for key in PROCESS_FIELDS if so_item.get(key)]
	if not configured:
		return []

	by_operation = {}
	if doc.sales_order_item:
		rows = frappe.get_all(
			"SS Coil",
			filters={"sales_order_item": doc.sales_order_item},
			fields=["name", "operation", "order_status", "modified"],
			order_by="modified desc",
		)
		for row in rows:
			key = (row.operation or "").strip().lower()
			# rows are already latest-modified-first; keep only the first
			# (most recent) SS Coil seen per operation
			if key not in by_operation:
				by_operation[key] = row

	checklist = []
	for key in configured:
		label = PROCESS_LABELS.get(key, key.title())
		match = by_operation.get(label.lower())
		if not match:
			checklist.append(
				{"key": key, "label": label, "status": "pending", "ss_coil": None, "order_status": None}
			)
			continue

		is_current = match.name == doc.name
		if match.order_status in ("Completed", "Closed"):
			status = "completed"
		elif is_current:
			status = "current"
		else:
			status = "in_progress"

		checklist.append(
			{
				"key": key,
				"label": label,
				"status": status,
				"ss_coil": match.name,
				"order_status": match.order_status,
			}
		)
	return checklist


@frappe.whitelist()
def get_ss_coil_detail_dashboard(ss_coil_name):
	if not frappe.db.exists("SS Coil", ss_coil_name):
		frappe.throw(f"SS Coil {ss_coil_name} not found")

	doc = frappe.get_doc("SS Coil", ss_coil_name)
	so_item = (doc.so_item or [None])[0]
	input_rows = [row.as_dict() for row in (doc.input_coil or [])]
	output_rows = [row.as_dict() for row in (doc.job_output or [])]
	cutting_rows = [row.as_dict() for row in (doc.cutting_detail or [])]

	input_tags = [row.get("tag_no") for row in input_rows if row.get("tag_no")]
	output_tags = [row.get("tag_no") for row in output_rows if row.get("tag_no")]
	all_tags = list(dict.fromkeys(input_tags + output_tags))

	previous_docs = []
	if input_tags:
		previous_docs = frappe.db.sql(
			"""
			select distinct
				parent.name,
				parent.operation,
				parent.order_status,
				parent.order_no,
				parent.sales_order_item,
				child.tag_no
			from `tabCoil Output` child
			inner join `tabSS Coil` parent on parent.name = child.parent
			where child.tag_no in %(tags)s
				and parent.name != %(current)s
			order by parent.modified desc
			""",
			{"tags": tuple(input_tags), "current": doc.name},
			as_dict=True,
		)

	next_docs = []
	if output_tags:
		next_docs = frappe.db.sql(
			"""
			select distinct
				parent.name,
				parent.operation,
				parent.order_status,
				parent.order_no,
				parent.sales_order_item,
				child.tag_no
			from `tabCoil Input` child
			inner join `tabSS Coil` parent on parent.name = child.parent
			where child.tag_no in %(tags)s
				and parent.name != %(current)s
			order by parent.modified desc
			""",
			{"tags": tuple(output_tags), "current": doc.name},
			as_dict=True,
		)

	stock_entry_details = []
	if all_tags:
		stock_entry_details = frappe.db.sql(
			"""
			select
				parent.name as stock_entry,
				parent.posting_date,
				parent.purpose,
				child.item_code,
				child.item_name,
				child.qty,
				child.transfer_qty,
				child.custom_tag_no as tag_no,
				child.custom_dimension as dimension,
				child.custom_estimated_wt as estimated_wt
			from `tabStock Entry Detail` child
			inner join `tabStock Entry` parent on parent.name = child.parent
			where child.custom_tag_no in %(tags)s
			order by parent.posting_date desc, child.idx asc
			""",
			{"tags": tuple(all_tags)},
			as_dict=True,
		)

	# Match by tag_no (this SS Coil's own input/output tags) OR by the linked
	# Sales Order Item (so_detail). A delivered/invoiced row can carry a
	# completely unrelated tag number if it fulfilled this SO line from a
	# different stock source/lineage - tag_no alone misses that case, even
	# though it's clearly "this document's" delivery from the Sales Order's
	# point of view. This mirrors why the Sales Order's own dashboard shows
	# these rows correctly while this one didn't: it isn't filtering by tag
	# at all, just by Sales Order Item.
	tag_filter_values = tuple(all_tags) if all_tags else ("",)
	sales_order_item = doc.sales_order_item or ""

	delivery_details = []
	if (all_tags or sales_order_item) and _has_field("Delivery Note Item", "custom_tag_no"):
		delivery_details = frappe.db.sql(
			"""
			select
				parent.name as delivery_note,
				parent.posting_date,
				parent.status,
				child.item_code,
				child.item_name,
				child.qty,
				child.amount,
				child.custom_tag_no as tag_no
			from `tabDelivery Note Item` child
			inner join `tabDelivery Note` parent on parent.name = child.parent
			where child.custom_tag_no in %(tags)s
				or (%(sales_order_item)s != '' and child.so_detail = %(sales_order_item)s)
			order by parent.posting_date desc, child.idx asc
			""",
			{"tags": tag_filter_values, "sales_order_item": sales_order_item},
			as_dict=True,
		)

	invoice_details = []
	if (all_tags or sales_order_item) and _has_field("Sales Invoice Item", "custom_tag_no"):
		invoice_details = frappe.db.sql(
			"""
			select
				parent.name as sales_invoice,
				parent.posting_date,
				parent.status,
				parent.outstanding_amount,
				child.item_code,
				child.item_name,
				child.qty,
				child.amount,
				child.custom_tag_no as tag_no
			from `tabSales Invoice Item` child
			inner join `tabSales Invoice` parent on parent.name = child.parent
			where child.custom_tag_no in %(tags)s
				or (%(sales_order_item)s != '' and child.so_detail = %(sales_order_item)s)
			order by parent.posting_date desc, child.idx asc
			""",
			{"tags": tag_filter_values, "sales_order_item": sales_order_item},
			as_dict=True,
		)

	tag_registry_rows = []
	if all_tags and frappe.db.exists("DocType", "Tag Registry"):
		tag_registry_rows = frappe.get_all(
			"Tag Registry",
			filters={"tag_no": ["in", all_tags]},
			fields=[
				"name",
				"tag_no",
				"status",
				"source_doctype",
				"source_docname",
				"current_doctype",
				"current_docname",
				"parent_tag_no",
				"root_tag_no",
				"item_code",
				"item_name",
				"sales_order",
			],
			order_by="tag_no asc",
		)

	root_tag_no = ""
	if tag_registry_rows:
		root_tag_no = _first_unique([row.get("root_tag_no") or row.get("tag_no") for row in tag_registry_rows]) or ""
	if not root_tag_no and input_tags:
		root_tag_no = _root_tag_for(input_tags[0]) or input_tags[0]
	tag_hierarchy = _build_tag_hierarchy(root_tag_no) if root_tag_no else {}

	output_weight_total = sum(flt(row.get("estimated_wt")) for row in output_rows)
	output_qty_total = sum(flt(row.get("estimated_qty")) for row in output_rows)
	total_strips = sum(cint(row.get("strip")) for row in cutting_rows)

	status_flow = {
		"operation": doc.operation,
		"order_status": doc.order_status,
		"started_on": getattr(doc, "started_on", None),
		"completed_on": getattr(doc, "completed_on", None),
		"elapsed_time": getattr(doc, "elapsed_time", None),
		"current_process": _label_for_process(doc.operation),
		"next_process": _first_unique([row.get("next_process") for row in output_rows]) or "",
	}
	process_checklist = _build_ss_coil_process_checklist(doc, so_item)

	return {
		"name": doc.name,
		"order_no": doc.order_no,
		"sales_order_item": doc.sales_order_item,
		"stock_entry": doc.stock_entry,
		"customer_name": doc.customer_name,
		"machine": doc.machine,
		"operation": doc.operation,
		"order_status": doc.order_status,
		"remarks": doc.remarks,
		"status_flow": status_flow,
		"process_checklist": process_checklist,
		"so_item": so_item.as_dict() if so_item else {},
		"input_rows": input_rows,
		"output_rows": output_rows,
		"cutting_rows": cutting_rows,
		"input_tags": input_tags,
		"output_tags": output_tags,
		"summary": {
			"input_count": len(input_rows),
			"output_count": len(output_rows),
			"cutting_count": len(cutting_rows),
			"total_strips": total_strips,
			"grand_total_width": flt(getattr(doc, "grand_total_width", 0)),
			"grand_estimated_wt": flt(getattr(doc, "grand_estimated_wt", 0)),
			"output_weight_total": output_weight_total,
			"output_qty_total": output_qty_total,
			"calc_ratio": flt(getattr(doc, "calc_ratio", 0)),
			"actual_ratio": flt(getattr(doc, "actual_ratio", 0)),
			"remaining_width": flt(getattr(doc, "remaining_width", 0)),
		},
		"previous_docs": previous_docs,
		"next_docs": next_docs,
		"stock_entry_details": stock_entry_details,
		"delivery_details": delivery_details,
		"invoice_details": invoice_details,
		"tag_registry_rows": tag_registry_rows,
		"root_tag_no": root_tag_no,
		"tag_hierarchy": tag_hierarchy,
	}


@frappe.whitelist()
def get_duplicate_origin_tags():
	return frappe.db.sql(
		"""
		select
			tag_no,
			count(*) as row_count,
			group_concat(source separator ' || ') as sources
		from (
			select custom_tag_no as tag_no, concat('Sales Order / ', parent, ' / ', name) as source
			from `tabSales Order Item`
			where ifnull(custom_tag_no, '') != ''
			union all
			select custom_tag_no as tag_no, concat('Purchase Receipt / ', parent, ' / ', name) as source
			from `tabPurchase Receipt Item`
			where ifnull(custom_tag_no, '') != ''
			union all
			select custom_tag_no as tag_no, concat('Purchase Invoice / ', parent, ' / ', name) as source
			from `tabPurchase Invoice Item`
			where ifnull(custom_tag_no, '') != ''
			union all
			select custom_tag_no as tag_no, concat('Stock Entry / ', parent, ' / ', name) as source
			from `tabStock Entry Detail`
			where ifnull(custom_tag_no, '') != ''
			union all
			select tag_no as tag_no, concat('SS Coil / ', parent, ' / ', name) as source
			from `tabCoil Output`
			where ifnull(tag_no, '') != ''
		) x
		group by tag_no
		having count(*) > 1
		order by tag_no asc
		""",
		as_dict=True,
	)


@frappe.whitelist()
def resolve_sales_order_item_duplicate_tag(sales_order_item, replacement_tag=None):
	if not frappe.db.exists("Sales Order Item", sales_order_item):
		frappe.throw(f"Sales Order Item {sales_order_item} not found")

	row = frappe.get_doc("Sales Order Item", sales_order_item)
	old_tag = row.get("custom_tag_no")
	if not old_tag:
		frappe.throw(f"Sales Order Item {sales_order_item} has no tag to replace")

	if not replacement_tag:
		replacement_tag = _next_tag_number()

	if frappe.db.exists("Tag Registry", {"tag_no": replacement_tag}):
		frappe.throw(f"Replacement tag {replacement_tag} already exists in Tag Registry")

	frappe.db.set_value("Sales Order Item", sales_order_item, "custom_tag_no", replacement_tag, update_modified=False)
	row.custom_tag_no = replacement_tag

	_register_tag(
		replacement_tag,
		source_doctype="Sales Order",
		source_docname=row.parent,
		source_child_doctype=row.doctype,
		source_child_name=row.name,
		item_code=row.item_code,
		item_name=row.item_name,
		sales_order=row.parent,
		status="Active",
	)

	# Rebuild registry view of source/current rows after the source change.
	backfill_tag_registry()
	frappe.clear_cache()
	return {
		"sales_order": row.parent,
		"sales_order_item": row.name,
		"old_tag": old_tag,
		"new_tag": replacement_tag,
	}


STOCK_ENTRY_TO_SALES_ORDER_SKIP_FIELDNAMES = {
	"name",
	"owner",
	"creation",
	"modified",
	"modified_by",
	"docstatus",
	"idx",
	"naming_series",
	"amended_from",
	"doctype",
	"parent",
	"parentfield",
	"parenttype",
}
STOCK_ENTRY_TO_SALES_ORDER_SKIP_FIELDTYPES = {
	"Section Break",
	"Column Break",
	"Tab Break",
	"HTML",
	"Button",
	"Table",
	"Table MultiSelect",
	"Fold",
	"Heading",
	"Image",
	"Attach",
	"Attach Image",
	"Signature",
}


def _copyable_fieldnames(source_doctype, target_doctype):
	"""Fieldnames that exist on both doctypes with a plain, copyable type.

	Used to transfer "same field, same meaning" data (mostly our own custom_*
	fields) as-is between two doctypes without hand-maintaining a mapping
	list that drifts out of sync as fields get added/renamed.
	"""
	target_fields = {df.fieldname: df for df in frappe.get_meta(target_doctype).fields}
	fieldnames = []
	for df in frappe.get_meta(source_doctype).fields:
		if df.fieldname in STOCK_ENTRY_TO_SALES_ORDER_SKIP_FIELDNAMES:
			continue
		if df.fieldtype in STOCK_ENTRY_TO_SALES_ORDER_SKIP_FIELDTYPES:
			continue
		target_df = target_fields.get(df.fieldname)
		if not target_df or target_df.fieldtype in STOCK_ENTRY_TO_SALES_ORDER_SKIP_FIELDTYPES:
			continue
		fieldnames.append(df.fieldname)
	return fieldnames


@frappe.whitelist()
def create_sales_order_from_stock_entry(source_name):
	"""Build a new (unsaved) Sales Order pre-filled from a Stock Entry.

	Copies every field that exists with the same fieldname on both doctypes
	(parent-to-parent and Stock Entry Detail-to-Sales Order Item), so custom
	coil fields (tag no, thickness/width/length, mill, spec, ...) carry over
	as-is without a hand-maintained mapping list.

	If a Stock Entry Detail row has Finish Good Item set, that FG becomes the
	Sales Order item_code and the received mother coil is linked as Raw
	Material Item / Tag (see _apply_finish_good_to_sales_order_row).

	Returns the doc for the client to open via frappe.model.open_mapped_doc -
	nothing is inserted here; the user reviews/edits and saves it themselves.
	"""
	source = frappe.get_doc("Stock Entry", source_name)

	sales_order = frappe.new_doc("Sales Order")

	parent_fields = _copyable_fieldnames("Stock Entry", "Sales Order")
	for fieldname in parent_fields:
		value = source.get(fieldname)
		if value not in (None, ""):
			sales_order.set(fieldname, value)

	if not sales_order.get("customer"):
		sales_order.customer = source.get("custom_customer") or source.get("custom_for_customer")
	if not sales_order.get("transaction_date"):
		sales_order.transaction_date = source.get("posting_date") or nowdate()
	if not sales_order.get("company"):
		sales_order.company = source.get("company")

	item_fields = _copyable_fieldnames("Stock Entry Detail", "Sales Order Item")
	for row in source.items:
		so_row = sales_order.append("items", {})
		for fieldname in item_fields:
			value = row.get(fieldname)
			if value not in (None, ""):
				so_row.set(fieldname, value)
		_apply_finish_good_to_sales_order_row(so_row, row)
		if not so_row.get("delivery_date"):
			so_row.delivery_date = sales_order.transaction_date
		if _has_field("Sales Order Item", "custom_source_stock_entry"):
			so_row.custom_source_stock_entry = source.name
		if _has_field("Sales Order Item", "custom_source_stock_entry_detail"):
			so_row.custom_source_stock_entry_detail = row.name

	if _has_field("Sales Order", "custom_source_stock_entries"):
		sales_order.custom_source_stock_entries = source.name

	return sales_order


def _apply_finish_good_to_sales_order_row(so_row, se_row):
	"""When Stock Entry Detail has Finish Good Item, SO line is the FG and
	the received mother coil becomes the raw-material link (item + tag).

	Without Finish Good Item, behaviour stays as before: SO item_code is the
	same received item_code from the Stock Entry row.
	"""
	finish_good = se_row.get("custom_finish_good_item") if _has_field(se_row.doctype, "custom_finish_good_item") else None
	if not finish_good:
		return

	raw_item = se_row.get("item_code")
	so_row.item_code = finish_good

	item = frappe.db.get_value(
		"Item",
		finish_good,
		["item_name", "stock_uom", "sales_uom"],
		as_dict=True,
	)
	if item:
		so_row.item_name = item.item_name
		so_row.stock_uom = item.stock_uom
		so_row.uom = item.sales_uom or item.stock_uom

	if _has_field("Sales Order Item", "custom_raw_material_item") and raw_item:
		so_row.custom_raw_material_item = raw_item

	if _has_field("Sales Order Item", "custom_stock_source_type"):
		so_row.custom_stock_source_type = STOCK_SOURCE_STOCK_ENTRY

	parent_tag = se_row.get("custom_tag_no")
	if parent_tag and _has_field("Sales Order Item", "custom_raw_material_tag_no"):
		so_row.custom_raw_material_tag_no = parent_tag
		# SO Item.custom_tag_no is for production child tags, not the mother coil.
		if so_row.get("custom_tag_no") == parent_tag:
			so_row.custom_tag_no = None

	batch_no = se_row.get("batch_no") or parent_tag
	if (
		batch_no
		and _has_field("Sales Order Item", "custom_raw_material_batch_no")
		and frappe.db.exists("Batch", batch_no)
	):
		so_row.custom_raw_material_batch_no = batch_no


@frappe.whitelist()
def create_stock_entry_from_sales_order(source_name):
	"""Reverse of create_sales_order_from_stock_entry: build a new (unsaved)
	Stock Entry pre-filled from a Sales Order. Same generic same-fieldname
	copy approach, mirrored direction.
	"""
	source = frappe.get_doc("Sales Order", source_name)

	stock_entry = frappe.new_doc("Stock Entry")

	parent_fields = _copyable_fieldnames("Sales Order", "Stock Entry")
	for fieldname in parent_fields:
		value = source.get(fieldname)
		if value not in (None, ""):
			stock_entry.set(fieldname, value)

	if not stock_entry.get("custom_customer"):
		stock_entry.custom_customer = source.get("customer")
	if not stock_entry.get("posting_date"):
		stock_entry.posting_date = source.get("transaction_date") or nowdate()
	if not stock_entry.get("company"):
		stock_entry.company = source.get("company")

	item_fields = _copyable_fieldnames("Sales Order Item", "Stock Entry Detail")
	for row in source.items:
		se_row = stock_entry.append("items", {})
		for fieldname in item_fields:
			value = row.get(fieldname)
			if value not in (None, ""):
				se_row.set(fieldname, value)

	return stock_entry


@frappe.whitelist()
def sync_sales_order_stock_entry_links(sales_order):
	"""Manual "Sync" button on Sales Order: recompute
	custom_source_stock_entries from the current items and push any missed
	updates to the linked Stock Entries' custom_linked_sales_orders.
	"""
	doc = frappe.get_doc("Sales Order", sales_order)
	sync_stock_entry_sales_order_links(doc)
	if _has_field("Sales Order", "custom_source_stock_entries"):
		frappe.db.set_value(
			"Sales Order",
			sales_order,
			"custom_source_stock_entries",
			doc.custom_source_stock_entries or "",
			update_modified=False,
		)
	frappe.db.commit()
	return {"custom_source_stock_entries": doc.get("custom_source_stock_entries") or ""}


@frappe.whitelist()
def sync_stock_entry_links_from_source(stock_entry):
	"""Manual "Sync" button on Stock Entry: rebuild
	custom_linked_sales_orders from scratch by looking up every Sales Order
	Item that currently references this Stock Entry. Unlike the append-only
	before_save hook, this also drops names that no longer apply (e.g. if a
	Sales Order's items were edited to point elsewhere since).
	"""
	if not _has_field("Sales Order Item", "custom_source_stock_entry") or not _has_field(
		"Stock Entry", "custom_linked_sales_orders"
	):
		return {"custom_linked_sales_orders": ""}

	sales_orders = frappe.get_all(
		"Sales Order Item",
		filters={"custom_source_stock_entry": stock_entry},
		fields=["parent"],
		distinct=True,
		order_by="parent asc",
	)
	value = ", ".join(row.parent for row in sales_orders)
	frappe.db.set_value("Stock Entry", stock_entry, "custom_linked_sales_orders", value, update_modified=False)
	frappe.db.commit()
	return {"custom_linked_sales_orders": value}


def sync_stock_entry_sales_order_links(doc, method=None):
	"""Keep the Stock Entry <-> Sales Order link fields (see
	setup_stock_entry_sales_order_link_fields) accurate on every Sales Order
	save - not just at creation time, since items can be added/edited/removed
	later.
	"""
	if not _has_field("Sales Order Item", "custom_source_stock_entry"):
		return

	stock_entry_names = list(
		dict.fromkeys(
			row.custom_source_stock_entry for row in (doc.items or []) if row.get("custom_source_stock_entry")
		)
	)

	if _has_field("Sales Order", "custom_source_stock_entries"):
		doc.custom_source_stock_entries = ", ".join(stock_entry_names)

	if not stock_entry_names or not _has_field("Stock Entry", "custom_linked_sales_orders"):
		return

	for stock_entry_name in stock_entry_names:
		if not frappe.db.exists("Stock Entry", stock_entry_name):
			continue
		existing = frappe.db.get_value("Stock Entry", stock_entry_name, "custom_linked_sales_orders") or ""
		linked = [value.strip() for value in existing.split(",") if value.strip()]
		if doc.name not in linked:
			linked.append(doc.name)
			frappe.db.set_value(
				"Stock Entry",
				stock_entry_name,
				"custom_linked_sales_orders",
				", ".join(linked),
				update_modified=False,
			)


def prepare_stock_entry_links(doc, method=None):
	populate_custom_sales_order(doc, method=method)
	apply_inward_tag_row_defaults(doc)
	assign_stock_entry_detail_tags(doc, method=method)


def prepare_purchase_receipt_links(doc, method=None):
	populate_custom_sales_order(doc, method=method)
	apply_inward_tag_row_defaults(doc)
	assign_purchase_receipt_item_tags(doc, method=method)


def prepare_purchase_invoice_links(doc, method=None):
	populate_custom_sales_order(doc, method=method)
	assign_purchase_invoice_item_tags(doc, method=method)


def assign_delivery_note_item_tags(doc, method=None):
	for row in doc.items or []:
		if not _has_field(row.doctype, "custom_tag_no"):
			continue
		if not row.custom_tag_no:
			row.custom_tag_no = _resolve_carried_tag(row, doc)
		if not row.custom_tag_no:
			row.custom_tag_no = _find_sales_order_item_tag(
				so_detail=getattr(row, "so_detail", None),
				sales_order=getattr(row, "against_sales_order", None),
				item_code=row.item_code,
			)
		if row.custom_tag_no:
			_update_tag_location(
				doc,
				row,
				status="Delivered",
				sales_order=getattr(row, "against_sales_order", None),
			)


def assign_sales_invoice_item_tags(doc, method=None):
	for row in doc.items or []:
		if not _has_field(row.doctype, "custom_tag_no"):
			continue
		if not row.custom_tag_no:
			row.custom_tag_no = _resolve_carried_tag(row, doc)
		if not row.custom_tag_no:
			row.custom_tag_no = _find_sales_order_item_tag(
				so_detail=getattr(row, "so_detail", None),
				sales_order=getattr(row, "sales_order", None),
				item_code=row.item_code,
			)
		if not row.custom_tag_no and getattr(row, "delivery_note", None):
			row.custom_tag_no = frappe.db.get_value(
				"Delivery Note Item",
				{
					"parent": row.delivery_note,
					"so_detail": getattr(row, "so_detail", None),
					"item_code": row.item_code,
				},
				"custom_tag_no",
			)
		if row.custom_tag_no:
			_update_tag_location(
				doc,
				row,
				status="Invoiced",
				sales_order=getattr(row, "sales_order", None),
			)


@frappe.whitelist()
def backfill_custom_sales_order_links(limit_per_doctype=500):
	limit_per_doctype = cint(limit_per_doctype) or 500
	doctypes = [
		"Stock Entry",
		"Expense Claim",
		"Journal Entry",
		"Payment Entry",
		"Purchase Order",
		"Purchase Receipt",
		"Purchase Invoice",
	]
	results = {}
	for doctype in doctypes:
		if not _has_field(doctype, "custom_sales_order"):
			results[doctype] = {"updated": 0, "checked": 0}
			continue

		names = frappe.get_all(
			doctype,
			filters={"custom_sales_order": ["in", ["", None]]},
			pluck="name",
			limit=limit_per_doctype,
			order_by="modified desc",
		)
		updated = 0
		for name in names:
			doc = frappe.get_doc(doctype, name)
			sales_order = _infer_custom_sales_order(doc)
			if sales_order:
				doc.db_set("custom_sales_order", sales_order, update_modified=False)
				updated += 1
		results[doctype] = {"updated": updated, "checked": len(names)}

	frappe.clear_cache()
	return results


@frappe.whitelist()
def setup_tag_origin_fields():
	"""Create item, sales order, and inward controls for the coil tag flow."""
	custom_fields = {
		"Item": [
			{
				"fieldname": "custom_ss_coil_section",
				"label": "SS Coil",
				"fieldtype": "Section Break",
				"insert_after": "description",
				"collapsible": 1,
			},
			{
				"fieldname": "custom_ss_coil_item_type",
				"label": "SS Coil Item Type",
				"fieldtype": "Select",
				"insert_after": "custom_ss_coil_section",
				"options": "\nRaw Material\nFinished Good\nSemi Finished",
			},
			{
				"fieldname": "custom_create_tag_on_receipt",
				"label": "Create Tag on Receipt",
				"fieldtype": "Check",
				"insert_after": "custom_ss_coil_item_type",
				"default": "0",
				"description": "When checked, inward rows for this item auto-enable tag creation on Purchase Receipt and Material Receipt Stock Entry.",
			},
			{
				"fieldname": "custom_use_tag_as_batch_no",
				"label": "Use Tag No as Batch No",
				"fieldtype": "Check",
				"insert_after": "custom_create_tag_on_receipt",
				"default": "1",
				"depends_on": "eval:doc.has_batch_no",
				"description": (
					"When checked (default), the auto-created Batch ID always equals the row's "
					"Tag No. Uncheck to let ERPNext's own batch settings (Automatically Create New "
					"Batch + Batch Number Series, or manual Batch No entry) control batching for "
					"this item instead."
				),
			},
			{
				"fieldname": "custom_default_raw_material_item",
				"label": "Default Raw Material Item",
				"fieldtype": "Link",
				"insert_after": "custom_create_tag_on_receipt",
				"options": "Item",
				"depends_on": "eval:['Finished Good','Semi Finished'].includes(doc.custom_ss_coil_item_type)",
				"description": "Default raw material used when this finished/semi-finished item is added to a Sales Order.",
			},
		],
		"Sales Order Item": [
			{
				"fieldname": "custom_raw_material_section",
				"label": "Raw Material Link",
				"fieldtype": "Section Break",
				"insert_after": "custom_qty_of_coil",
				"collapsible": 1,
			},
			{
				"fieldname": "custom_stock_source_type",
				"label": "Stock Source",
				"fieldtype": "Select",
				"insert_after": "custom_raw_material_section",
				"options": f"\n{STOCK_SOURCE_PURCHASE_RECEIPTS}\n{STOCK_SOURCE_STOCK_ENTRY}",
				"description": "Purchase Receipts = own stock received on Purchase Receipt. Stock Entry = customer material received on Material Receipt Stock Entry.",
			},
			{
				"fieldname": "custom_raw_material_item",
				"label": "Raw Material Item",
				"fieldtype": "Link",
				"insert_after": "custom_stock_source_type",
				"options": "Item",
			},
			{
				"fieldname": "custom_select_raw_material_tag",
				"label": "Select Raw Material Tag",
				"fieldtype": "Button",
				"insert_after": "custom_raw_material_item",
				"depends_on": "eval:doc.custom_raw_material_item",
			},
			{
				"fieldname": "custom_raw_material_tag_no",
				"label": "Raw Material Tag No",
				"fieldtype": "Data",
				"insert_after": "custom_select_raw_material_tag",
				"read_only": 1,
				"description": "Parent tag assigned when raw material is received on Purchase Receipt or Material Receipt Stock Entry.",
			},
			{
				"fieldname": "custom_raw_material_batch_no",
				"label": "Raw Material Batch No",
				"fieldtype": "Link",
				"insert_after": "custom_raw_material_tag_no",
				"options": "Batch",
				"read_only": 1,
			},
			{
				"fieldname": "custom_child_tag_no",
				"label": "Child Tag No",
				"fieldtype": "Small Text",
				"insert_after": "custom_raw_material_batch_no",
				"read_only": 1,
				"description": "Child tag numbers generated in SS Coil during slitting/leveling/reshearing.",
			},
		],
		"Purchase Receipt": [
			{
				"fieldname": "custom_create_tag_numbers",
				"label": "Create Tag Numbers",
				"fieldtype": "Check",
				"insert_after": "custom_sales_order",
				"description": "Enable tag number creation for selected item rows on this Purchase Receipt.",
			}
		],
		"Stock Entry": [
			{
				"fieldname": "custom_create_tag_numbers",
				"label": "Create Tag Numbers",
				"fieldtype": "Check",
				"insert_after": "custom_sales_order",
				"description": "Enable tag number creation for Material Receipt rows only.",
			},
			{
				"fieldname": "custom_sticker_print_html",
				"label": "Sticker Print HTML",
				"fieldtype": "Long Text",
				"insert_after": "custom_create_tag_numbers",
				"hidden": 1,
				"read_only": 1,
				"no_copy": 1,
				"print_hide": 1,
				"report_hide": 1,
			},
		],
		"Purchase Receipt Item": [
			{
				"fieldname": "custom_create_tag_no",
				"label": "Create Tag No",
				"fieldtype": "Check",
				"insert_after": "item_name",
				"in_list_view": 1,
				"depends_on": "eval:parent.custom_create_tag_numbers",
			}
		],
		"Stock Entry Detail": [
			{
				"fieldname": "custom_create_tag_no",
				"label": "Create Tag No",
				"fieldtype": "Check",
				"insert_after": "custom_tag_no",
				"in_list_view": 1,
				"depends_on": "eval:parent.custom_create_tag_numbers && parent.purpose == 'Material Receipt'",
			},
			{
				"fieldname": "custom_finish_good_item",
				"label": "Finish Good Item",
				"fieldtype": "Link",
				"options": "Item",
				"insert_after": "item_name",
				"in_list_view": 1,
				"allow_on_submit": 1,
				"depends_on": "eval:parent.purpose == 'Material Receipt'",
				"description": (
					"Customer-ordered finish good (e.g. FG Slitter / FG Leveler / FG Reshearing). "
					"When Create Sales Order runs, this becomes the Sales Order item and the "
					"received mother coil stays linked as Raw Material Item + Tag."
				),
			},
		],
	}
	create_custom_fields(custom_fields, update=True)

	for doctype, description in {
		"Purchase Receipt Item": "Assigned automatically at material inward. Carried forward on downstream documents.",
		"Stock Entry Detail": "Assigned automatically at Material Receipt inward. Carried forward on downstream documents.",
		"Sales Order Item": "Child tag from SS Coil production. Parent tag is stored in Raw Material Tag No.",
	}.items():
		fieldname = f"{doctype}-custom_tag_no"
		if frappe.db.exists("Custom Field", fieldname):
			frappe.db.set_value(
				"Custom Field",
				fieldname,
				{
					"read_only": 1,
					"description": description,
				},
				update_modified=False,
			)

	_update_sales_order_item_field_order()
	_setup_purchase_receipt_coil_fields()
	_migrate_legacy_stock_source_values()
	_sync_workspace_query_report_links()
	setup_stock_entry_sales_order_link_fields()

	frappe.clear_cache()
	return {"status": "ok"}


def setup_stock_entry_sales_order_link_fields():
	"""Fields for the "Create Sales Order from Stock Entry" link (see
	create_sales_order_from_stock_entry and ARCHITECTURE.md > "Create Sales
	Order from Stock Entry").

	Deliberately separate from Stock Entry.custom_sales_order, which already
	has a different meaning elsewhere in this app (see
	_infer_custom_sales_order) - reusing it here would silently conflict.

	The relationship is many-to-many (one Stock Entry can spawn several
	Sales Orders over repeated button clicks; one Sales Order's items can
	come from different source Stock Entries), so:
	- Sales Order Item gets an exact, per-row Link back to its source Stock
	  Entry (+ the specific source row name for full traceability).
	- Sales Order gets a read-only summary listing every distinct source
	  Stock Entry among its items (recomputed on every save, so it stays
	  correct even if items are edited later).
	- Stock Entry gets a read-only, append-only summary listing every Sales
	  Order ever created from it (never overwritten, only appended to).
	"""
	custom_fields = {
		"Sales Order Item": [
			{
				"fieldname": "custom_source_stock_entry",
				"label": "Source Stock Entry",
				"fieldtype": "Link",
				"options": "Stock Entry",
				"insert_after": "item_code",
				"read_only": 1,
				"no_copy": 1,
				"print_hide": 1,
			},
			{
				"fieldname": "custom_source_stock_entry_detail",
				"label": "Source Stock Entry Row",
				"fieldtype": "Data",
				"insert_after": "custom_source_stock_entry",
				"read_only": 1,
				"hidden": 1,
				"no_copy": 1,
			},
		],
		"Sales Order": [
			{
				"fieldname": "custom_source_stock_entries",
				"label": "Source Stock Entries",
				"fieldtype": "Small Text",
				"insert_after": "customer",
				"read_only": 1,
				"no_copy": 1,
				"description": "Auto-filled: every Stock Entry this Sales Order's items were created from.",
			},
		],
		"Stock Entry": [
			{
				"fieldname": "custom_linked_sales_orders",
				"label": "Linked Sales Orders (Created)",
				"fieldtype": "Small Text",
				"insert_after": "custom_sales_order",
				"read_only": 1,
				"no_copy": 1,
				"description": "Auto-filled: every Sales Order created from this Stock Entry via the Create Sales Order button.",
			},
		],
	}
	create_custom_fields(custom_fields, update=True)


def _migrate_legacy_stock_source_values():
	if not _has_field("Sales Order Item", "custom_stock_source_type"):
		return
	frappe.db.sql(
		"""
		update `tabSales Order Item`
		set custom_stock_source_type = %(new_value)s
		where custom_stock_source_type = %(old_value)s
		""",
		{"new_value": STOCK_SOURCE_PURCHASE_RECEIPTS, "old_value": "Purchased"},
	)
	frappe.db.sql(
		"""
		update `tabSales Order Item`
		set custom_stock_source_type = %(new_value)s
		where custom_stock_source_type = %(old_value)s
		""",
		{"new_value": STOCK_SOURCE_STOCK_ENTRY, "old_value": "Customer Provided"},
	)
	if frappe.db.exists("Custom Field", "Sales Order Item-custom_stock_source_type"):
		frappe.db.set_value(
			"Custom Field",
			"Sales Order Item-custom_stock_source_type",
			{
				"options": f"\n{STOCK_SOURCE_PURCHASE_RECEIPTS}\n{STOCK_SOURCE_STOCK_ENTRY}",
				"description": "Purchase Receipts = own stock received on Purchase Receipt. Stock Entry = customer material received on Material Receipt Stock Entry.",
			},
			update_modified=False,
		)


def _setup_purchase_receipt_coil_fields():
	"""Mirror Stock Entry Detail coil inward fields on Purchase Receipt Item."""
	ignore_fields = {"custom_create_tag_no"}
	se_fields = frappe.get_all(
		"Custom Field",
		filters={"dt": "Stock Entry Detail", "fieldname": ["like", "custom_%"]},
		fields=[
			"fieldname",
			"fieldtype",
			"label",
			"insert_after",
			"options",
			"precision",
			"read_only",
			"in_list_view",
			"depends_on",
			"collapsible",
			"description",
		],
		order_by="idx asc",
	)
	if not se_fields:
		return

	pr_existing = set(
		frappe.get_all("Custom Field", filters={"dt": "Purchase Receipt Item"}, pluck="fieldname")
	)
	new_fields = []
	for cf in se_fields:
		if cf.fieldname in ignore_fields or cf.fieldname in pr_existing:
			continue
		field_def = {
			"fieldname": cf.fieldname,
			"fieldtype": cf.fieldtype,
			"label": cf.label,
			"insert_after": cf.insert_after,
		}
		if cf.options:
			field_def["options"] = cf.options
		if cf.precision:
			field_def["precision"] = cf.precision
		if cf.read_only:
			field_def["read_only"] = cf.read_only
		if cf.in_list_view:
			field_def["in_list_view"] = cf.in_list_view
		if cf.depends_on:
			field_def["depends_on"] = cf.depends_on
		if cf.collapsible:
			field_def["collapsible"] = cf.collapsible
		if cf.description:
			field_def["description"] = cf.description
		if cf.fieldname == "custom_section_break_rajk0":
			field_def["insert_after"] = "custom_create_tag_no"
		new_fields.append(field_def)

	if new_fields:
		create_custom_fields({"Purchase Receipt Item": new_fields}, update=True)

	if frappe.db.exists("Custom Field", "Purchase Receipt Item-custom_tag_no"):
		frappe.db.set_value(
			"Custom Field",
			"Purchase Receipt Item-custom_tag_no",
			{"insert_after": "custom_section_break_rajk0", "read_only": 1},
			update_modified=False,
		)

	_update_purchase_receipt_item_field_order()


def _update_purchase_receipt_item_field_order():
	ps_name = "Purchase Receipt Item-main-field_order"
	se_order_name = "Stock Entry Detail-main-field_order"
	if not frappe.db.exists("Property Setter", se_order_name):
		return

	se_order = json.loads(frappe.db.get_value("Property Setter", se_order_name, "value") or "[]")
	coil_fields = [fieldname for fieldname in se_order if fieldname.startswith("custom_")]
	coil_fields = [fieldname for fieldname in coil_fields if fieldname != "custom_create_tag_no"]

	if frappe.db.exists("Property Setter", ps_name):
		order = json.loads(frappe.db.get_value("Property Setter", ps_name, "value") or "[]")
	else:
		order = [field.fieldname for field in frappe.get_meta("Purchase Receipt Item").fields]

	for fieldname in order[:]:
		if fieldname.startswith("custom_") and fieldname != "custom_create_tag_no":
			order.remove(fieldname)

	anchor = "custom_create_tag_no" if "custom_create_tag_no" in order else "item_name"
	insert_at = order.index(anchor) + 1 if anchor in order else len(order)
	for fieldname in coil_fields:
		if fieldname in order:
			continue
		order.insert(insert_at, fieldname)
		insert_at += 1

	if frappe.db.exists("Property Setter", ps_name):
		frappe.db.set_value("Property Setter", ps_name, "value", json.dumps(order), update_modified=False)
	else:
		frappe.make_property_setter(
			{
				"doctype": "Purchase Receipt Item",
				"fieldname": None,
				"property": "field_order",
				"property_type": "Data",
				"value": json.dumps(order),
			},
			ignore_validate=True,
			is_system_generated=False,
		)


def _sync_workspace_query_report_links():
	script_reports = ("Tag Registry Trace",)
	for report_name in script_reports:
		frappe.db.sql(
			"""
			update `tabWorkspace Link`
			set is_query_report = 1
			where link_type = 'Report' and link_to = %s
			""",
			(report_name,),
		)


def _update_sales_order_item_field_order():
	"""Ensure raw material link fields appear on the Sales Order Item grid form."""
	ps_name = "Sales Order Item-main-field_order"
	if not frappe.db.exists("Property Setter", ps_name):
		return

	order = json.loads(frappe.db.get_value("Property Setter", ps_name, "value") or "[]")
	new_fields = [
		"custom_raw_material_section",
		"custom_stock_source_type",
		"custom_raw_material_item",
		"custom_select_raw_material_tag",
		"custom_raw_material_tag_no",
		"custom_raw_material_batch_no",
		"custom_child_tag_no",
	]
	anchor = "custom_qty_of_coil"
	insert_at = order.index(anchor) + 1 if anchor in order else len(order)
	changed = False
	for fieldname in new_fields:
		if fieldname in order:
			continue
		order.insert(insert_at, fieldname)
		insert_at += 1
		changed = True
	if changed:
		frappe.db.set_value("Property Setter", ps_name, "value", json.dumps(order), update_modified=False)


@frappe.whitelist()
def get_item_coil_defaults(item_code):
	if not item_code or not frappe.db.exists("Item", item_code):
		return {}
	item = frappe.get_cached_value(
		"Item",
		item_code,
		[
			"custom_ss_coil_item_type",
			"custom_create_tag_on_receipt",
			"custom_default_raw_material_item",
			"item_name",
		],
		as_dict=True,
	)
	return item or {}


@frappe.whitelist()
def get_raw_material_inward_details(tag_no):
	if not tag_no:
		return {}

	registry = frappe.db.get_value(
		"Tag Registry",
		{"tag_no": tag_no},
		[
			"tag_no",
			"batch_no",
			"item_code",
			"item_name",
			"sales_order",
			"source_doctype",
			"source_docname",
			"source_child_doctype",
			"source_child_name",
		],
		as_dict=True,
	)
	if not registry:
		return {"tag_no": tag_no}

	details = {
		"tag_no": registry.tag_no,
		"batch_no": registry.batch_no,
		"item_code": registry.item_code,
		"item_name": registry.item_name,
		"class": registry.item_name or registry.item_code,
	}

	if registry.source_child_doctype and registry.source_child_name:
		if frappe.db.exists(registry.source_child_doctype, registry.source_child_name):
			row = frappe.get_doc(registry.source_child_doctype, registry.source_child_name)
			mapped = _extract_coil_inward_row_details(row)
			for key, value in mapped.items():
				if value not in (None, ""):
					details[key] = value
			if mapped.get("batch_no"):
				details["batch_no"] = mapped["batch_no"]

	details["stock_source_type"] = _stock_source_for_origin(registry.source_doctype)
	details["so_item_fields"] = {
		fieldname: details[fieldname]
		for fieldname in COIL_INWARD_SO_FIELDNAMES
		if details.get(fieldname) not in (None, "")
	}
	return details


def _enrich_tag_rows_with_inward_details(rows):
	for row in rows:
		row["stock_source_type"] = _stock_source_for_origin(row.get("source_doctype"))
		inward = get_raw_material_inward_details(row.get("tag_no"))
		row["dimension"] = inward.get("dimension") or ""
		row["thickness"] = inward.get("thickness") or ""
		row["width"] = inward.get("width") or ""
		row["length"] = inward.get("length") or ""
		row["estimated_wt"] = inward.get("estimated_wt") or ""
		row["ref_no"] = inward.get("ref_no") or ""
		row["specification"] = inward.get("specification") or ""
	return rows


@frappe.whitelist()
def get_available_raw_material_tags(
	sales_order, sales_order_item=None, raw_material_item=None, stock_source_type=None
):
	if sales_order_item and frappe.db.exists("Sales Order Item", sales_order_item):
		so_row = frappe.db.get_value(
			"Sales Order Item",
			sales_order_item,
			["custom_raw_material_item", "custom_raw_material_tag_no", "parent", "custom_stock_source_type"],
			as_dict=True,
		)
		if so_row:
			raw_material_item = raw_material_item or so_row.custom_raw_material_item
			sales_order = sales_order or so_row.parent
			stock_source_type = stock_source_type or so_row.custom_stock_source_type

	if not raw_material_item:
		return {"tags": [], "message": "Select a Raw Material Item first."}

	stock_source_type = _normalize_stock_source_type(stock_source_type)
	origin_doctype = _origin_doctype_for_stock_source(stock_source_type)
	if stock_source_type and not origin_doctype:
		return {"tags": [], "message": "Select a valid Stock Source first."}

	used_tags = frappe.get_all(
		"Sales Order Item",
		filters={
			"custom_raw_material_tag_no": ["is", "set"],
			"name": ["!=", sales_order_item] if sales_order_item and not str(sales_order_item).startswith("new-") else ["!=", ""],
		},
		pluck="custom_raw_material_tag_no",
	)
	used_tags = [tag for tag in used_tags if tag]

	conditions = [
		"generation_level = 0",
		"ifnull(tag_no, '') != ''",
		"item_code = %(raw_material_item)s",
		"(ifnull(sales_order, '') = '' or sales_order = %(sales_order)s)",
	]
	params = {
		"raw_material_item": raw_material_item,
		"sales_order": sales_order or "",
	}
	if used_tags:
		conditions.append("tag_no not in %(used_tags)s")
		params["used_tags"] = tuple(used_tags)

	if origin_doctype:
		conditions.append("source_doctype = %(origin_doctype)s")
		params["origin_doctype"] = origin_doctype
		if origin_doctype == "Stock Entry":
			conditions.append(
				"""
				source_docname in (
					select name from `tabStock Entry`
					where ifnull(purpose, '') = 'Material Receipt'
				)
				"""
			)

	rows = frappe.db.sql(
		f"""
		select
			tag_no,
			batch_no,
			item_code,
			item_name,
			sales_order,
			source_doctype,
			source_docname,
			status,
			current_docname
		from `tabTag Registry`
		where {" and ".join(conditions)}
		order by tag_no asc
		""",
		params,
		as_dict=True,
	)
	return {
		"tags": _enrich_tag_rows_with_inward_details(rows),
		"raw_material_item": raw_material_item,
		"sales_order": sales_order,
		"stock_source_type": stock_source_type,
		"count": len(rows),
	}


def _prepare_raw_material_tag_assignment(row, tag_no):
	if not tag_no:
		frappe.throw("Tag No is required")

	registry = frappe.db.get_value(
		"Tag Registry",
		{"tag_no": tag_no},
		["tag_no", "batch_no", "item_code", "source_doctype", "sales_order", "generation_level"],
		as_dict=True,
	)
	if not registry:
		frappe.throw(f"Tag {tag_no} not found in Tag Registry")
	if cint(registry.generation_level) > 0:
		frappe.throw(f"{tag_no} is a child tag. Select a parent tag from inward stock.")

	raw_material_item = row.get("custom_raw_material_item")
	if raw_material_item and registry.item_code != raw_material_item:
		frappe.throw(
			f"Tag {tag_no} belongs to item {registry.item_code}, but this line expects {raw_material_item}."
		)

	exclude_name = row.get("name")
	if exclude_name and not str(exclude_name).startswith("new-"):
		existing = frappe.db.exists(
			"Sales Order Item",
			{
				"custom_raw_material_tag_no": tag_no,
				"name": ["!=", exclude_name],
			},
		)
	else:
		existing = frappe.db.exists(
			"Sales Order Item",
			{"custom_raw_material_tag_no": tag_no},
		)
	if existing:
		existing_row = frappe.db.get_value(
			"Sales Order Item",
			existing,
			["parent", "item_code"],
			as_dict=True,
		)
		frappe.throw(
			f"Tag {tag_no} is already linked to Sales Order {existing_row.parent} / {existing_row.item_code}."
		)

	parent_sales_order = row.get("parent")
	if registry.sales_order and parent_sales_order and registry.sales_order not in ("", parent_sales_order):
		frappe.throw(f"Tag {tag_no} belongs to Sales Order {registry.sales_order}.")

	stock_source = _stock_source_for_origin(registry.source_doctype)
	inward = get_raw_material_inward_details(tag_no)
	values = {
		"custom_raw_material_tag_no": tag_no,
		"custom_raw_material_batch_no": registry.batch_no or tag_no,
	}
	if stock_source:
		values["custom_stock_source_type"] = stock_source
	if not raw_material_item and registry.item_code:
		values["custom_raw_material_item"] = registry.item_code

	so_item_fields = inward.get("so_item_fields") or {}
	for fieldname, value in so_item_fields.items():
		if _has_field("Sales Order Item", fieldname):
			values[fieldname] = value

	return {
		"sales_order_item": row.get("name"),
		"tag_no": tag_no,
		"batch_no": values.get("custom_raw_material_batch_no"),
		"stock_source_type": stock_source,
		"so_item_fields": values,
		"sales_order": parent_sales_order,
	}


@frappe.whitelist()
def assign_raw_material_tag_to_sales_order_item(
	sales_order_item, tag_no, sales_order=None, raw_material_item=None
):
	is_new_row = bool(sales_order_item and str(sales_order_item).startswith("new-"))

	if is_new_row:
		if not raw_material_item:
			frappe.throw("Raw Material Item is required for unsaved Sales Order lines.")
		row = frappe._dict(
			{
				"name": sales_order_item,
				"parent": sales_order,
				"custom_raw_material_item": raw_material_item,
			}
		)
	elif sales_order_item and frappe.db.exists("Sales Order Item", sales_order_item):
		row = frappe.get_doc("Sales Order Item", sales_order_item)
	else:
		frappe.throw(f"Sales Order Item {sales_order_item} not found")

	prepared = _prepare_raw_material_tag_assignment(row, tag_no)
	values = prepared.get("so_item_fields") or {}

	if not is_new_row:
		frappe.db.set_value("Sales Order Item", sales_order_item, values, update_modified=False)
		if row.parent:
			frappe.db.set_value(
				"Tag Registry",
				{"tag_no": tag_no},
				"sales_order",
				row.parent,
				update_modified=False,
			)

	return prepared


@frappe.whitelist()
def get_sales_order_items_pending_raw_material_tags(sales_order):
	if not sales_order or not frappe.db.exists("Sales Order", sales_order):
		frappe.throw(f"Sales Order {sales_order} not found")

	rows = frappe.get_all(
		"Sales Order Item",
		filters={"parent": sales_order},
		fields=[
			"name",
			"item_code",
			"item_name",
			"custom_raw_material_item",
			"custom_raw_material_tag_no",
			"custom_stock_source_type",
			"custom_dimension",
		],
		order_by="idx asc",
	)
	pending = [row for row in rows if row.custom_raw_material_item and not row.custom_raw_material_tag_no]
	return {"items": rows, "pending": pending, "pending_count": len(pending)}


@frappe.whitelist()
@frappe.validate_and_sanitize_search_inputs
def raw_material_tag_query(doctype, txt, searchfield, start, page_len, filters):
	sales_order = (filters or {}).get("sales_order")
	raw_material_item = (filters or {}).get("raw_material_item")
	conditions = ["generation_level = 0", "ifnull(tag_no, '') != ''"]
	params = {"txt": f"%{txt}%", "start": cint(start), "page_len": cint(page_len)}

	if raw_material_item:
		conditions.append("item_code = %(raw_material_item)s")
		params["raw_material_item"] = raw_material_item
	if sales_order:
		conditions.append("(ifnull(sales_order, '') = '' or sales_order = %(sales_order)s)")
		params["sales_order"] = sales_order

	rows = frappe.db.sql(
		f"""
		select tag_no, item_code, item_name, batch_no, sales_order, status
		from `tabTag Registry`
		where {" and ".join(conditions)}
			and tag_no like %(txt)s
		order by tag_no asc
		limit %(start)s, %(page_len)s
		""",
		params,
		as_dict=True,
	)
	return [
		[
			row.tag_no,
			f"{row.tag_no} | {row.item_name or row.item_code or ''} | {row.batch_no or '-'} | {row.status or ''}",
		]
		for row in rows
	]


@frappe.whitelist()
def setup_tag_tracking_fields():
	custom_fields = {
		"Delivery Note Item": [
			{
				"fieldname": "custom_tag_no",
				"label": "Tag No",
				"fieldtype": "Data",
				"insert_after": "item_name",
				"read_only": 1,
				"in_list_view": 1,
			}
		],
		"Sales Invoice Item": [
			{
				"fieldname": "custom_tag_no",
				"label": "Tag No",
				"fieldtype": "Data",
				"insert_after": "item_name",
				"read_only": 1,
				"in_list_view": 1,
			}
		],
		"Purchase Receipt Item": [
			{
				"fieldname": "custom_tag_no",
				"label": "Tag No",
				"fieldtype": "Data",
				"insert_after": "item_name",
				"read_only": 1,
				"in_list_view": 1,
			}
		],
		"Purchase Invoice Item": [
			{
				"fieldname": "custom_tag_no",
				"label": "Tag No",
				"fieldtype": "Data",
				"insert_after": "item_name",
				"read_only": 1,
				"in_list_view": 1,
			}
		],
	}
	create_custom_fields(custom_fields, update=True)
	if frappe.db.exists("DocType", "Tag Number Settings"):
		defaults = _tag_settings_defaults()
		for fieldname, value in defaults.items():
			if frappe.db.get_single_value("Tag Number Settings", fieldname) in (None, ""):
				frappe.db.set_single_value("Tag Number Settings", fieldname, value)
		frappe.db.set_single_value(
			"Tag Number Settings",
			"naming_preview",
			_format_tag_number(cint(frappe.db.get_single_value("Tag Number Settings", "next_number")) or defaults["next_number"]),
		)
	frappe.clear_cache()
	return {"status": "ok"}


@frappe.whitelist()
def backfill_tag_registry():
	settings = _tag_settings()
	max_seen = 0
	sources = [
		("Sales Order", "Sales Order Item", "tabSales Order Item", "parent", "item_code", "item_name", "custom_tag_no"),
		("Purchase Receipt", "Purchase Receipt Item", "tabPurchase Receipt Item", "parent", "item_code", "item_name", "custom_tag_no"),
		("Purchase Invoice", "Purchase Invoice Item", "tabPurchase Invoice Item", "parent", "item_code", "item_name", "custom_tag_no"),
		("Stock Entry", "Stock Entry Detail", "tabStock Entry Detail", "parent", "item_code", "item_name", "custom_tag_no"),
		("Delivery Note", "Delivery Note Item", "tabDelivery Note Item", "parent", "item_code", "item_name", "custom_tag_no"),
		("Sales Invoice", "Sales Invoice Item", "tabSales Invoice Item", "parent", "item_code", "item_name", "custom_tag_no"),
	]
	count = 0
	for source_doctype, child_doctype, table_name, parent_field, item_code_field, item_name_field, tag_field in sources:
		if not frappe.db.exists("DocType", child_doctype) or not _has_field(child_doctype, tag_field):
			continue
		rows = frappe.db.sql(
			f"""
			select name, {parent_field} as parent, {item_code_field} as item_code, {item_name_field} as item_name, {tag_field} as tag_no
			from `{table_name}`
			where ifnull({tag_field}, '') != ''
			""",
			as_dict=True,
		)
		for row in rows:
			parsed = _parse_tag_number(row.tag_no)
			if parsed and _is_managed_tag(row.tag_no, settings):
				max_seen = max(max_seen, cint(parsed["number"]))
			_register_tag(
				row.tag_no,
				source_doctype=source_doctype,
				source_docname=row.parent,
				source_child_doctype=child_doctype,
				source_child_name=row.name,
				item_code=row.item_code,
				item_name=row.item_name,
				sales_order=row.parent if source_doctype == "Sales Order" else None,
				stock_entry=row.parent if source_doctype == "Stock Entry" else None,
			)
			count += 1

	if frappe.db.exists("DocType", "Tag Number Settings") and max_seen:
		frappe.db.set_single_value("Tag Number Settings", "next_number", max_seen + 1)
	if frappe.db.exists("DocType", "Tag Number Settings"):
		next_number = cint(frappe.db.get_single_value("Tag Number Settings", "next_number")) or _tag_settings_defaults()["next_number"]
		frappe.db.set_single_value("Tag Number Settings", "naming_preview", _format_tag_number(next_number))
	frappe.clear_cache()
	return {"registered": count, "next_number": cint(frappe.db.get_single_value("Tag Number Settings", "next_number")) if frappe.db.exists("DocType", "Tag Number Settings") else None}


@frappe.whitelist()
@frappe.validate_and_sanitize_search_inputs
def sales_order_item_query(doctype, txt, searchfield, start, page_len, filters):
	parent = (filters or {}).get("parent")
	if not parent:
		return []

	rows = frappe.db.sql(
		"""
		select
			name,
			item_name,
			qty,
			custom_tag_no,
			custom_dimension,
			custom_specification,
			custom_estimated_wt
		from `tabSales Order Item`
		where parent = %(parent)s
			and parenttype = 'Sales Order'
			and parentfield = 'items'
			and (
				name like %(txt)s
				or item_name like %(txt)s
				or ifnull(custom_tag_no, '') like %(txt)s
				or ifnull(custom_dimension, '') like %(txt)s
			)
		order by idx asc
		limit %(start)s, %(page_len)s
		""",
		{
			"parent": parent,
			"txt": f"%{txt}%",
			"start": cint(start),
			"page_len": cint(page_len),
		},
		as_dict=True,
	)

	results = []
	for d in rows:
		description = (
			f"Qty: {_format_number(d.qty)} | "
			f"Tag: {d.custom_tag_no or '-'} | "
			f"Dim: {d.custom_dimension or '-'} | "
			f"Spec: {d.custom_specification or '-'} | "
			f"Est WT: {_format_number(d.custom_estimated_wt)}"
		)
		results.append([d.name, d.item_name, description])

	return results


@frappe.whitelist()
@frappe.validate_and_sanitize_search_inputs
def stock_entry_item_query(doctype, txt, searchfield, start, page_len, filters):
	parent = (filters or {}).get("parent")
	if not parent:
		return []

	rows = frappe.db.sql(
		"""
		select
			name,
			item_name,
			qty,
			custom_tag_no,
			custom_dimension,
			custom_specification,
			custom_estimated_wt
		from `tabStock Entry Detail`
		where parent = %(parent)s
			and parenttype = 'Stock Entry'
			and parentfield = 'items'
			and (
				name like %(txt)s
				or ifnull(item_name, '') like %(txt)s
				or ifnull(custom_tag_no, '') like %(txt)s
				or ifnull(custom_dimension, '') like %(txt)s
			)
		order by idx asc
		limit %(start)s, %(page_len)s
		""",
		{
			"parent": parent,
			"txt": f"%{txt}%",
			"start": cint(start),
			"page_len": cint(page_len),
		},
		as_dict=True,
	)

	results = []
	for d in rows:
		description = (
			f"Qty: {_format_number(d.qty)} | "
			f"Tag: {d.custom_tag_no or '-'} | "
			f"Dim: {d.custom_dimension or '-'} | "
			f"Spec: {d.custom_specification or '-'} | "
			f"Est WT: {_format_number(d.custom_estimated_wt)}"
		)
		results.append([d.name, d.item_name or d.name, description])

	return results


@frappe.whitelist()
def setup_sales_order_cutting_scheme_fields():
	custom_fields = {
		"Sales Order Item": [
			{
				"fieldname": "custom_manage_cutting_scheme",
				"label": "Manage Cutting Scheme",
				"fieldtype": "Button",
				"insert_after": "custom_remaining_width",
			},
			{
				"fieldname": "custom_cutting_scheme_preview_section",
				"label": "Cutting Scheme Preview",
				"fieldtype": "Section Break",
				"insert_after": "custom_manage_cutting_scheme",
			},
			{
				"fieldname": "custom_cutting_scheme_preview",
				"label": "Cutting Scheme Preview",
				"fieldtype": "HTML",
				"insert_after": "custom_cutting_scheme_preview_section",
			},
		],
		"Sales Order": [
			{
				"fieldname": "custom_dashboard",
				"label": "Dashboard",
				"fieldtype": "Tab Break",
				"insert_after": "connections_tab",
			},
			{
				"fieldname": "custom_detail_status",
				"label": "Detail Status",
				"fieldtype": "HTML",
				"insert_after": "custom_dashboard",
			},
			{
				"fieldname": "custom_cutting_scheme_report_section",
				"label": "Cutting Scheme Report",
				"fieldtype": "Section Break",
				"insert_after": "custom_detail_status",
			},
			{
				"fieldname": "custom_cutting_scheme_report",
				"label": "Cutting Scheme Report",
				"fieldtype": "HTML",
				"insert_after": "custom_cutting_scheme_report_section",
			},
		],
	}
	create_custom_fields(custom_fields, update=True)

	for fieldname in ["custom_cutting_scheme", "custom_production_plan"]:
		name = f"Sales Order Item-{fieldname}"
		if frappe.db.exists("Custom Field", name):
			frappe.db.set_value("Custom Field", name, "hidden", 1, update_modified=False)

	frappe.clear_cache()
	return {"status": "ok"}


@frappe.whitelist()
def setup_sales_order_link_fields():
	custom_fields = {
		"Stock Entry": [
			{
				"fieldname": "custom_sales_order",
				"label": "Sales Order",
				"fieldtype": "Link",
				"options": "Sales Order",
				"insert_after": "custom_job_purpose",
			}
		],
		"Expense Claim": [
			{
				"fieldname": "custom_sales_order",
				"label": "Sales Order",
				"fieldtype": "Link",
				"options": "Sales Order",
				"insert_after": "project",
			}
		],
		"Journal Entry": [
			{
				"fieldname": "custom_sales_order",
				"label": "Sales Order",
				"fieldtype": "Link",
				"options": "Sales Order",
				"insert_after": "title",
			}
		],
		"Payment Entry": [
			{
				"fieldname": "custom_sales_order",
				"label": "Sales Order",
				"fieldtype": "Link",
				"options": "Sales Order",
				"insert_after": "party_name",
			}
		],
		"Purchase Order": [
			{
				"fieldname": "custom_sales_order",
				"label": "Sales Order",
				"fieldtype": "Link",
				"options": "Sales Order",
				"insert_after": "supplier_name",
			}
		],
		"Purchase Receipt": [
			{
				"fieldname": "custom_sales_order",
				"label": "Sales Order",
				"fieldtype": "Link",
				"options": "Sales Order",
				"insert_after": "supplier_name",
			}
		],
		"Purchase Invoice": [
			{
				"fieldname": "custom_sales_order",
				"label": "Sales Order",
				"fieldtype": "Link",
				"options": "Sales Order",
				"insert_after": "supplier_name",
			}
		],
	}
	create_custom_fields(custom_fields, update=True)
	frappe.clear_cache()
	return {"status": "ok"}


@frappe.whitelist()
def get_sales_order_detail_dashboard(sales_order):
	doc = frappe.get_doc("Sales Order", sales_order)

	items = []
	packing_details = []
	for item in doc.items:
		items.append(
			{
				"name": item.name,
				"item_code": item.item_code,
				"item_name": item.item_name,
				"qty": flt(item.qty),
				"amount": flt(item.amount),
				"tag_no": item.get("custom_tag_no"),
				"child_tag_no": item.get("custom_child_tag_no"),
				"raw_material_item": item.get("custom_raw_material_item"),
				"raw_material_tag_no": item.get("custom_raw_material_tag_no"),
				"raw_material_batch_no": item.get("custom_raw_material_batch_no"),
				"stock_source_type": item.get("custom_stock_source_type"),
				"ref_no": item.get("custom_ref_no"),
				"thickness": item.get("custom_thickness"),
				"width": item.get("custom_width"),
				"length": item.get("custom_length"),
				"length_c": item.get("custom_length_c"),
				"dimension": item.get("custom_dimension"),
				"specification": item.get("custom_specification"),
				"estimated_wt": flt(item.get("custom_estimated_wt")),
				"machine": item.get("custom_machine"),
				"calc_ratio": flt(item.get("custom_calc_ratio")),
				"calc_ratio_2": flt(item.get("custom_calc_ratio_2")),
				"actual_ratio": flt(item.get("custom_actual_ratio")),
				"remaining_width": flt(item.get("custom_remaining_width")),
				"packing_type": item.get("custom_packing_type"),
				"packing_weightsize": item.get("custom_packing_weightsize"),
				"no_of_pack": item.get("custom_no_of_pack"),
				"packing_remarks": item.get("custom_packing_remarks"),
				"packing_comments": item.get("custom_packing_comments"),
			}
		)
		if any(
			item.get(field)
			for field in [
				"custom_packing_type",
				"custom_packing_weightsize",
				"custom_no_of_pack",
				"custom_packing_remarks",
				"custom_packing_comments",
			]
		):
			packing_details.append(
				{
					"item_code": item.item_code,
					"item_name": item.item_name,
					"tag_no": item.get("custom_tag_no"),
					"packing_type": item.get("custom_packing_type"),
					"packing_weightsize": item.get("custom_packing_weightsize"),
					"no_of_pack": item.get("custom_no_of_pack"),
					"packing_remarks": item.get("custom_packing_remarks"),
					"packing_comments": item.get("custom_packing_comments"),
				}
			)

	ss_coil_docs = frappe.get_all(
		"SS Coil",
		filters={"order_no": sales_order},
		fields=[
			"name",
			"docstatus",
			"machine",
			"sales_order_item",
			"stock_entry",
			"grand_estimated_wt",
			"grand_total_width",
			"actual_ratio",
			"remaining_width",
		],
		order_by="creation desc",
	)

	sales_order_item_names = [item.name for item in doc.items]
	item_codes = sorted({item.item_code for item in doc.items if item.item_code})

	plan_rows = frappe.db.sql(
		"""
		select
			p.sales_order_item,
			count(c.name) as row_count,
			sum(ifnull(c.total_width, 0)) as total_width,
			sum(ifnull(c.width, 0)) as plain_width
		from `tabSO Production Plan` p
		left join `tabCutting Scheme SO` c on c.parent = p.name
		where p.sales_order = %s
		group by p.sales_order_item
		""",
		(sales_order,),
		as_dict=True,
	)

	stock_entry_refs = {d.stock_entry for d in ss_coil_docs if d.stock_entry}
	stock_entry_filter_values = set(stock_entry_refs)
	if _has_field("Stock Entry", "custom_sales_order"):
		stock_entry_filter_values.update(
			frappe.get_all("Stock Entry", filters={"custom_sales_order": sales_order}, pluck="name")
		)
	stock_entries = frappe.get_all(
		"Stock Entry",
		filters={"name": ["in", list(stock_entry_filter_values)]} if stock_entry_filter_values else {"name": ["in", [""]]},
		fields=["name", "purpose", "posting_date", "custom_customer", "custom_for_customer"],
		order_by="posting_date desc",
	)
	stock_entry_items = (
		frappe.db.sql(
			"""
			select
				parent, item_code, item_name, qty,
				custom_tag_no, custom_dimension, custom_estimated_wt
			from `tabStock Entry Detail`
			where parent in %(parents)s
			order by parent asc, idx asc
			""",
			{"parents": tuple(stock_entry_filter_values)},
			as_dict=True,
		)
		if stock_entry_filter_values
		else []
	)

	delivery_note_items = frappe.db.sql(
		"""
		select
			dni.parent as delivery_note,
			dni.item_code,
			dni.item_name,
			dni.qty,
			dni.amount,
			dni.so_detail,
			dn.posting_date,
			dn.status
		from `tabDelivery Note Item` dni
		inner join `tabDelivery Note` dn on dn.name = dni.parent
		where dni.against_sales_order = %(sales_order)s
			or dni.so_detail in %(so_details)s
		order by dn.posting_date desc, dni.idx asc
		""",
		{"sales_order": sales_order, "so_details": tuple(sales_order_item_names or [""])},
		as_dict=True,
	)

	sales_invoice_items = frappe.db.sql(
		"""
		select
			sii.parent as sales_invoice,
			sii.item_code,
			sii.item_name,
			sii.qty,
			sii.amount,
			sii.so_detail,
			sii.delivery_note,
			si.posting_date,
			si.status,
			si.outstanding_amount
		from `tabSales Invoice Item` sii
		inner join `tabSales Invoice` si on si.name = sii.parent
		where sii.sales_order = %(sales_order)s
			or sii.so_detail in %(so_details)s
		order by si.posting_date desc, sii.idx asc
		""",
		{"sales_order": sales_order, "so_details": tuple(sales_order_item_names or [""])},
		as_dict=True,
	)
	sales_invoice_names = [row.parent for row in sales_invoice_items]

	direct_payment_entries = (
		frappe.get_all(
			"Payment Entry",
			filters={"custom_sales_order": sales_order},
			fields=["name as payment_entry", "posting_date", "party_type", "party"],
			order_by="posting_date desc",
		)
		if _has_field("Payment Entry", "custom_sales_order")
		else []
	)
	payment_entry_refs = (
		frappe.db.sql(
			"""
			select
				per.parent as payment_entry,
				pe.posting_date,
				pe.party_type,
				pe.party,
				per.reference_doctype,
				per.reference_name,
				per.allocated_amount
			from `tabPayment Entry Reference` per
			inner join `tabPayment Entry` pe on pe.name = per.parent
			where per.reference_doctype = 'Sales Invoice'
				and per.reference_name in %(sales_invoices)s
			order by pe.posting_date desc
			""",
			{"sales_invoices": tuple(sales_invoice_names or [""])},
			as_dict=True,
		)
		if sales_invoice_names
		else []
	)
	for row in direct_payment_entries:
		row.update(
			{
				"reference_doctype": "Sales Order",
				"reference_name": sales_order,
				"allocated_amount": 0,
			}
		)
	payment_entry_refs = direct_payment_entries + payment_entry_refs

	journal_entry_refs = frappe.db.sql(
		"""
		select
			jea.parent as journal_entry,
			je.posting_date,
			jea.account,
			jea.debit_in_account_currency as debit,
			jea.credit_in_account_currency as credit,
			jea.reference_type,
			jea.reference_name
		from `tabJournal Entry Account` jea
		inner join `tabJournal Entry` je on je.name = jea.parent
		where (
			(jea.reference_type = 'Sales Order' and jea.reference_name = %(sales_order)s)
			or (jea.reference_type = 'Sales Invoice' and jea.reference_name in %(sales_invoices)s)
			or (%(has_je_sales_order)s = 1 and je.custom_sales_order = %(sales_order)s)
		)
		order by je.posting_date desc
		""",
		{
			"sales_order": sales_order,
			"sales_invoices": tuple(sales_invoice_names or [""]),
			"has_je_sales_order": 1 if _has_field("Journal Entry", "custom_sales_order") else 0,
		},
		as_dict=True,
	)
	journal_entry_expense_rows = [row for row in journal_entry_refs if flt(row.get("debit")) > 0]

	expense_claims = (
		frappe.db.sql(
			"""
			select
				ec.name,
				ec.posting_date,
				ec.employee,
				ec.project,
				ec.cost_center,
				ec.status,
				ec.total_sanctioned_amount
			from `tabExpense Claim` ec
			where ifnull(ec.project, '') = %(project)s
				or (%(has_ec_sales_order)s = 1 and ec.custom_sales_order = %(sales_order)s)
			order by ec.posting_date desc
			""",
			{"project": doc.project or "", "sales_order": sales_order, "has_ec_sales_order": 1 if _has_field("Expense Claim", "custom_sales_order") else 0},
			as_dict=True,
		)
		if doc.project or (_has_field("Expense Claim", "custom_sales_order") and frappe.db.exists("Expense Claim", {"custom_sales_order": sales_order}))
		else []
	)

	purchase_orders = frappe.get_all(
		"Purchase Order",
		filters={"custom_sales_order": sales_order},
		fields=["name", "transaction_date", "supplier", "status", "grand_total"],
		order_by="transaction_date desc",
	) if _has_field("Purchase Order", "custom_sales_order") else []
	purchase_receipts = frappe.get_all(
		"Purchase Receipt",
		filters={"custom_sales_order": sales_order},
		fields=["name", "posting_date", "supplier", "status", "grand_total"],
		order_by="posting_date desc",
	) if _has_field("Purchase Receipt", "custom_sales_order") else []
	purchase_invoices = frappe.get_all(
		"Purchase Invoice",
		filters={"custom_sales_order": sales_order},
		fields=["name", "posting_date", "supplier", "status", "grand_total", "outstanding_amount"],
		order_by="posting_date desc",
	) if _has_field("Purchase Invoice", "custom_sales_order") else []

	expense_claim_details = (
		frappe.db.sql(
			"""
			select
				ecd.parent,
				ecd.expense_date,
				ecd.default_account,
				ecd.description,
				ecd.amount,
				ecd.project,
				ecd.cost_center
			from `tabExpense Claim Detail` ecd
			where ecd.parent in %(parents)s
			order by ecd.expense_date desc
			""",
			{"parents": tuple([row.name for row in expense_claims] or [""])},
			as_dict=True,
		)
		if expense_claims
		else []
	)
	for row in expense_claim_details:
		row["description"] = " ".join((strip_html_tags(row.get("description") or "") or "").split())
	expense_claim_total = sum(flt(row.get("amount")) for row in expense_claim_details)
	journal_expense_total = sum(flt(row.get("debit")) for row in journal_entry_expense_rows)
	tax_expense_total = flt(doc.total_taxes_and_charges)
	expense_total = tax_expense_total + expense_claim_total + journal_expense_total
	profit_proxy = flt(doc.grand_total) - expense_total

	bom_details = []
	for item in doc.items:
		bom_no = frappe.db.get_value("Item", item.item_code, "default_bom") if item.item_code else None
		if not bom_no:
			bom_no = frappe.db.get_value("BOM", {"item": item.item_code, "is_default": 1, "is_active": 1, "docstatus": 1}, "name") if item.item_code else None
		if not bom_no:
			continue
		bom_items = frappe.db.sql(
			"""
			select
				bi.item_code,
				bi.item_name,
				bi.qty,
				bi.stock_qty,
				ifnull(sum(bin.actual_qty), 0) as stock_qty_available
			from `tabBOM Item` bi
			left join tabBin bin on bin.item_code = bi.item_code and bin.company = %(company)s
			where bi.parent = %(bom_no)s
			group by bi.name
			order by bi.idx asc
			""",
			{"bom_no": bom_no, "company": doc.company},
			as_dict=True,
		)
		bom_details.append(
			{
				"sales_order_item": item.name,
				"item_code": item.item_code,
				"item_name": item.item_name,
				"bom_no": bom_no,
				"qty": flt(item.qty),
				"rows": [
					{
						**row,
						"required_qty": flt(row.qty) * flt(item.qty),
						"shortage_qty": max((flt(row.qty) * flt(item.qty)) - flt(row.stock_qty_available), 0),
					}
					for row in bom_items
				],
			}
		)

	stock_ledger_rows = (
		frappe.db.sql(
			"""
			select
				posting_date, voucher_type, voucher_no,
				item_code, warehouse, actual_qty, qty_after_transaction
			from `tabStock Ledger Entry`
			where company = %(company)s
				and item_code in %(item_codes)s
			order by posting_date desc, posting_time desc
			limit 100
			""",
			{"company": doc.company, "item_codes": tuple(item_codes or [""])},
			as_dict=True,
		)
		if item_codes
		else []
	)

	dispatch_summary = []
	invoice_by_so_detail = {}
	for row in sales_invoice_items:
		invoice_by_so_detail.setdefault(row.so_detail, []).append(row)
	for item in doc.items:
		delivered_qty = sum(flt(d.qty) for d in delivery_note_items if d.so_detail == item.name)
		invoiced_qty = sum(flt(d.qty) for d in sales_invoice_items if d.so_detail == item.name)
		dispatch_summary.append(
			{
				"item_code": item.item_code,
				"item_name": item.item_name,
				"ordered_qty": flt(item.qty),
				"delivered_qty": delivered_qty,
				"invoiced_qty": invoiced_qty,
				"pending_qty": max(flt(item.qty) - delivered_qty, 0),
				"invoices": invoice_by_so_detail.get(item.name, []),
			}
		)

	tag_numbers = sorted(
		{
			item.get("custom_tag_no")
			for item in doc.items
			if item.get("custom_tag_no")
		}
	)
	tag_trace = _get_tag_trace_rows(tag_numbers)
	tag_trace_rows = [tag_trace[tag] for tag in tag_numbers if tag in tag_trace]
	tag_tree = _build_tag_tree(tag_trace_rows)

	return {
		"sales_order": doc.name,
		"company": doc.company,
		"customer": doc.customer,
		"customer_name": doc.customer_name,
		"for_customer": doc.get("custom_for_customer"),
		"status": doc.status,
		"delivery_status": doc.delivery_status,
		"billing_status": doc.billing_status,
		"transaction_date": str(doc.transaction_date) if doc.transaction_date else None,
		"delivery_date": str(doc.delivery_date) if doc.delivery_date else None,
		"currency": doc.currency,
		"total_qty": flt(doc.total_qty),
		"net_total": flt(doc.net_total),
		"grand_total": flt(doc.grand_total),
		"rounded_total": flt(doc.rounded_total),
		"per_billed": flt(doc.per_billed),
		"per_delivered": flt(doc.per_delivered),
		"po_no": doc.po_no,
		"igp_no": doc.get("custom_igp_no"),
		"items": items,
		"item_codes": item_codes,
		"plans": plan_rows,
		"ss_coil_docs": ss_coil_docs,
		"stock_entries": stock_entries,
		"stock_entry_items": stock_entry_items,
		"delivery_note_items": delivery_note_items,
		"sales_invoice_items": sales_invoice_items,
		"dispatch_summary": dispatch_summary,
		"bom_details": bom_details,
		"stock_ledger_rows": stock_ledger_rows,
		"payment_entry_refs": payment_entry_refs,
		"journal_entry_refs": journal_entry_expense_rows,
		"expense_claims": expense_claims,
		"expense_claim_details": expense_claim_details,
		"packing_details": packing_details,
		"purchase_orders": purchase_orders,
		"purchase_receipts": purchase_receipts,
		"purchase_invoices": purchase_invoices,
		"stock_entry_refs": sorted(stock_entry_filter_values),
		"packed_items_count": len(doc.packed_items or []),
		"tax_rows_count": len(doc.taxes or []),
		"expense_total": expense_total,
		"expense_breakup": {
			"taxes": tax_expense_total,
			"journal_entries": journal_expense_total,
			"expense_claims": expense_claim_total,
		},
		"profit_proxy": profit_proxy,
		"tag_trace": tag_trace_rows,
		"tag_tree": tag_tree,
	}


def _get_or_create_so_production_plan(sales_order, sales_order_item):
	name = frappe.db.get_value(
		"SO Production Plan",
		{"sales_order": sales_order, "sales_order_item": sales_order_item},
		"name",
	)
	if name:
		return frappe.get_doc("SO Production Plan", name)

	doc = frappe.get_doc(
		{
			"doctype": "SO Production Plan",
			"sales_order": sales_order,
			"sales_order_item": sales_order_item,
			"cutting_scheme": [],
		}
	)
	doc.insert(ignore_permissions=True)
	return doc


@frappe.whitelist()
def get_so_production_plan(sales_order, sales_order_item):
	doc = _get_or_create_so_production_plan(sales_order, sales_order_item)
	return {
		"name": doc.name,
		"rows": [row.as_dict() for row in doc.cutting_scheme],
	}


@frappe.whitelist()
def save_so_production_plan(sales_order, sales_order_item, rows):
	rows = frappe.parse_json(rows) if isinstance(rows, str) else (rows or [])
	doc = _get_or_create_so_production_plan(sales_order, sales_order_item)
	doc.set("cutting_scheme", [])
	total_popup_width = 0
	total_total_width = 0

	for idx, row in enumerate(rows, start=1):
		row = frappe._dict(row)
		width = flt(row.width)
		if not width:
			continue
		strip = flt(row.strip)
		total_width = width * strip
		total_popup_width += width
		total_total_width += total_width
		doc.append(
			"cutting_scheme",
			{
				"seq": idx,
				"width": width,
				"strip": strip,
				"lengthcut": row.lengthcut,
				"total_width": total_width,
				"tolerance_plus": row.tolerance_plus,
				"tolerance_minus": row.tolerance_minus,
				"knife": row.knife,
			},
		)

	doc.save(ignore_permissions=True)

	item = frappe.get_doc("Sales Order Item", sales_order_item)
	parent_width = flt(item.get("custom_width"))
	qty = flt(item.get("qty"))
	calc_ratio = ((qty / parent_width) * total_popup_width) if parent_width else 0
	remaining_width = parent_width - total_total_width
	item.db_set("custom_calc_ratio", calc_ratio, update_modified=False)
	item.db_set("custom_remaining_width", remaining_width, update_modified=False)

	return {
		"status": "ok",
		"name": doc.name,
		"custom_calc_ratio": calc_ratio,
		"custom_remaining_width": remaining_width,
	}


@frappe.whitelist()
def get_so_production_plan_rows(sales_order_item):
	name = frappe.db.get_value(
		"SO Production Plan",
		{"sales_order_item": sales_order_item},
		"name",
	)
	if not name:
		return []
	doc = frappe.get_doc("SO Production Plan", name)
	return [row.as_dict() for row in doc.cutting_scheme]


@frappe.whitelist()
def get_sales_order_cutting_scheme_report(sales_order):
	plans = frappe.get_all(
		"SO Production Plan",
		filters={"sales_order": sales_order},
		fields=["name", "sales_order_item"],
		order_by="modified asc",
	)
	if not plans:
		return []

	item_meta = {
		d.name: d
		for d in frappe.get_all(
			"Sales Order Item",
			filters={"parent": sales_order, "parenttype": "Sales Order", "parentfield": "items"},
			fields=["name", "item_name", "item_code", "qty", "custom_dimension", "custom_tag_no"],
		)
	}

	result = []
	for plan in plans:
		doc = frappe.get_doc("SO Production Plan", plan.name)
		item = item_meta.get(plan.sales_order_item, frappe._dict())
		result.append(
			{
				"plan_name": plan.name,
				"sales_order_item": plan.sales_order_item,
				"item_label": item.get("item_name") or item.get("item_code") or plan.sales_order_item,
				"qty": item.get("qty"),
				"dimension": item.get("custom_dimension"),
				"tag_no": item.get("custom_tag_no"),
				"rows": [row.as_dict() for row in doc.cutting_scheme],
			}
		)
	return result
