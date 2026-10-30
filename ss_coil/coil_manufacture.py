"""Coil Manufacture — create Manufacture Stock Entry from finished SS Coil Job Output tags.

Rules:
- No Semi Finished stock between processes.
- A Job Output tag is eligible when `next_process` is blank (final for that branch).
- One BOM-based Manufacture SE is created per finished output tag.
- FG receive: batch_no = tag_no = custom_tag_no.
- Consume original mother raw material (root tag/batch), not intermediate tags.
"""

from __future__ import annotations

import frappe
from frappe import _
from frappe.utils import cint, flt, getdate

from ss_coil.api import (
	_ensure_batch_for_tag_row,
	_has_field,
	_root_tag_for,
	_truthy_process_value,
)


def setup_coil_manufacture_fields():
	"""Stock Entry and item-line fields used to trace coil manufacture output."""
	from frappe.custom.doctype.custom_field.custom_field import create_custom_fields

	fields = {"Stock Entry": [], "Stock Entry Detail": []}
	if not frappe.db.exists("Custom Field", "Stock Entry-custom_ss_coil"):
		fields["Stock Entry"].append(
			{
				"fieldname": "custom_ss_coil",
				"label": "SS Coil",
				"fieldtype": "Link",
				"options": "SS Coil",
				"insert_after": "custom_sales_order"
				if frappe.db.exists("Custom Field", "Stock Entry-custom_sales_order")
				else "remarks",
				"read_only": 1,
				"description": "Source SS Coil when this Manufacture Entry was created from Job Output tags.",
			}
		)
	# Stock Entry Detail has fields for the usual coil attributes. Add the output
	# measurements that otherwise get lost when a Job Output tag is manufactured.
	output_fields = [
		("custom_actual_wt", "Actual WT", "Float", "custom_estimated_wt"),
		("custom_output_tag_no", "Output Tag No", "Data", "custom_tag_no"),
		("custom_actual_qty", "Actual Qty", "Float", "custom_estimated_wt"),
		("custom_estimated_qty", "Estimated Qty", "Float", "custom_estimated_wt"),
		("custom_packing", "Packing", "Data", "custom_estimated_wt"),
		("custom_current_process", "Current Process", "Data", "custom_estimated_wt"),
		("custom_coil_class", "Coil Class", "Data", "custom_finish_good_item"),
		("custom_sales_order", "Sales Order", "Link", "custom_ss_coil"),
		("custom_sales_order_item", "Sales Order Item", "Link", "custom_ss_coil"),
		("custom_customer", "Customer", "Link", "custom_ss_coil"),
		("custom_ss_coil_completed_on", "SS Coil Completed On", "Date", "custom_estimated_wt"),
		("custom_ss_coil_remarks", "SS Coil Remarks", "Small Text", "custom_estimated_wt"),
	]
	for fieldname, label, fieldtype, insert_after in output_fields:
		field = f"Stock Entry Detail-{fieldname}"
		if frappe.db.exists("Custom Field", field):
			continue
		definition = {
			"fieldname": fieldname,
			"label": label,
			"fieldtype": fieldtype,
			"insert_after": insert_after,
			"read_only": 1,
			"allow_on_submit": 1,
		}
		if fieldtype == "Link":
			definition["options"] = {
				"custom_sales_order": "Sales Order",
				"custom_sales_order_item": "Sales Order Item",
				"custom_customer": "Customer",
			}[fieldname]
		fields["Stock Entry Detail"].append(definition)
	fields = {doctype: defs for doctype, defs in fields.items() if defs}
	if fields:
		create_custom_fields(fields, update=True)
	setup_stock_entry_type_naming_series()
	_ensure_manufacture_trace_field_order()
	frappe.clear_cache(doctype="Stock Entry")
	frappe.clear_cache(doctype="Stock Entry Detail")
	return {"status": "ok"}


# Keep the existing Material Receipt prefix/counter, while giving every Stock
# Entry Type its own independent naming series. These values are also exposed
# in Document Naming Settings through the naming_series Property Setter.
STOCK_ENTRY_TYPE_SERIES = {
	"Material Receipt": "MR-.YYYY.-",
	"Material Issue": "MI-.YYYY.-",
	"Material Transfer": "MT-.YYYY.-",
	"Material Transfer for Manufacture": "MTM-.YYYY.-",
	"Material Consumption for Manufacture": "MCM-.YYYY.-",
	"Manufacture": "MFG-.YYYY.-",
	"Repack": "RPK-.YYYY.-",
	"Disassemble": "DIS-.YYYY.-",
	"Receive from Customer": "RFC-.YYYY.-",
	"Return Raw Material to Customer": "RRM-.YYYY.-",
	"Send to Subcontractor": "STS-.YYYY.-",
	"Subcontracting Delivery": "SCD-.YYYY.-",
	"Subcontracting Return": "SCR-.YYYY.-",
}


def setup_stock_entry_type_naming_series():
	"""Expose one distinct numbering series for each Stock Entry Type."""
	if not frappe.db.exists("DocField", {"parent": "Stock Entry", "fieldname": "naming_series"}):
		return
	options = "\n".join(["MAT-STE-.YYYY.-", *STOCK_ENTRY_TYPE_SERIES.values()])
	name = "Stock Entry-naming_series-options"
	values = {
		"doctype_or_field": "DocField",
		"doc_type": "Stock Entry",
		"field_name": "naming_series",
		"property": "options",
		"property_type": "Text",
		"value": options,
	}
	if frappe.db.exists("Property Setter", name):
		frappe.db.set_value("Property Setter", name, values, update_modified=False)
	else:
		frappe.get_doc({"doctype": "Property Setter", "name": name, **values}).insert(ignore_permissions=True)
	frappe.clear_cache(doctype="Stock Entry")


def set_stock_entry_type_naming_series(doc, method=None):
	"""Choose the configured independent series from the selected Stock Entry Type."""
	series = STOCK_ENTRY_TYPE_SERIES.get(doc.get("stock_entry_type"))
	if series:
		doc.naming_series = series


def _ensure_manufacture_trace_field_order():
	"""Keep the new trace fields visible in the Stock Entry item detail form."""
	setter = frappe.db.get_value(
		"Property Setter",
		{"doc_type": "Stock Entry Detail", "property": "field_order"},
		"name",
	)
	if not setter:
		return
	import json

	order = json.loads(frappe.db.get_value("Property Setter", setter, "value") or "[]")
	blocks = {
		"custom_tag_no": ["custom_output_tag_no"],
		"custom_estimated_wt": [
			"custom_actual_wt",
			"custom_actual_qty",
			"custom_estimated_qty",
			"custom_packing",
			"custom_current_process",
			"custom_ss_coil_completed_on",
			"custom_ss_coil_remarks",
		],
		"custom_finish_good_item": ["custom_coil_class"],
		"custom_width": ["custom_length_c", "custom_length"],
		"custom_ss_coil": [
			"custom_sales_order",
			"custom_sales_order_item",
			"custom_customer",
			"custom_for_customer",
			"custom_po_no",
			"custom_ref_no",
		],
	}
	for anchor, fieldnames in blocks.items():
		if anchor not in order:
			continue
		for fieldname in fieldnames:
			if fieldname in order:
				continue
			order.insert(order.index(anchor) + 1, fieldname)
			anchor = fieldname
	frappe.db.set_value("Property Setter", setter, "value", json.dumps(order), update_modified=False)


def _output_qty(row):
	for key in ("actual_wt", "estimated_wt", "actual_qty", "estimated_qty"):
		val = flt(row.get(key) if isinstance(row, dict) else getattr(row, key, None))
		if val:
			return val
	return 0.0


def _resolve_fg_item(ss_coil):
	so_item = getattr(ss_coil, "sales_order_item", None)
	if so_item and frappe.db.exists("Sales Order Item", so_item):
		code = frappe.db.get_value("Sales Order Item", so_item, "item_code")
		if code:
			return code
	so_row = (ss_coil.so_item or [None])[0]
	if so_row:
		# Coil SO may store display name; prefer Item match
		name = getattr(so_row, "item_name", None)
		if name and frappe.db.exists("Item", name):
			return name
	# Fallback: Job Output class if it is an Item
	for row in ss_coil.job_output or []:
		klass = getattr(row, "class", None)
		if klass and frappe.db.exists("Item", klass):
			return klass
	return None


def _resolve_output_fg_item(ss_coil, output_row):
	"""Prefer the output row's finish-good Item; fall back to linked SO item."""
	item_code = getattr(output_row, "class", None)
	if item_code and frappe.db.exists("Item", item_code):
		return item_code
	return _resolve_fg_item(ss_coil)


def _default_active_bom(item_code):
	if not item_code or not frappe.db.exists("Item", item_code):
		return None
	bom_no = frappe.db.get_value("Item", item_code, "default_bom")
	if bom_no and frappe.db.exists("BOM", {"name": bom_no, "item": item_code, "is_active": 1, "docstatus": 1}):
		return bom_no
	return frappe.db.get_value(
		"BOM",
		{"item": item_code, "is_active": 1, "is_default": 1, "docstatus": 1},
		"name",
	)


def _resolve_mother(ss_coil):
	"""Mother raw material item + root tag/batch for warehouse consumption."""
	so_item = getattr(ss_coil, "sales_order_item", None)
	mother_item = None
	mother_tag = None
	mother_batch = None

	if so_item and frappe.db.exists("Sales Order Item", so_item):
		row = frappe.db.get_value(
			"Sales Order Item",
			so_item,
			[
				"custom_raw_material_item",
				"custom_raw_material_tag_no",
				"custom_raw_material_batch_no",
			],
			as_dict=True,
		) or {}
		mother_item = row.get("custom_raw_material_item")
		mother_tag = row.get("custom_raw_material_tag_no")
		mother_batch = row.get("custom_raw_material_batch_no")

	# Coil Production Line override
	prod = getattr(ss_coil, "coil_production_line", None)
	if prod and frappe.db.exists("Coil Production Line", prod):
		prow = frappe.db.get_value(
			"Coil Production Line",
			prod,
			["raw_material_item", "raw_material_tag_no", "raw_material_batch_no", "tag_no"],
			as_dict=True,
		) or {}
		mother_item = mother_item or prow.get("raw_material_item")
		mother_tag = mother_tag or prow.get("raw_material_tag_no") or prow.get("tag_no")
		mother_batch = mother_batch or prow.get("raw_material_batch_no")

	input_row = (ss_coil.input_coil or [None])[0]
	input_tag = getattr(input_row, "tag_no", None) if input_row else None
	if input_row and not mother_item:
		klass = getattr(input_row, "class", None)
		if klass and frappe.db.exists("Item", klass):
			mother_item = klass

	# Prefer root mother tag for stock (no semi-finished warehouse)
	work_tag = mother_tag or input_tag
	root = _root_tag_for(work_tag) if work_tag else None
	mother_tag = root or work_tag
	if not mother_batch and mother_tag:
		mother_batch = mother_tag if frappe.db.exists("Batch", mother_tag) else None

	# Tag Registry may know the item for the mother tag
	if mother_tag and not mother_item and frappe.db.exists("Tag Registry", {"tag_no": mother_tag}):
		mother_item = frappe.db.get_value("Tag Registry", {"tag_no": mother_tag}, "item_code")

	return {
		"item_code": mother_item,
		"tag_no": mother_tag,
		"batch_no": mother_batch or mother_tag,
	}


def _tag_already_manufactured(tag_no, sales_order=None):
	if not tag_no:
		return None
	filters = {
		"custom_tag_no": tag_no,
		"docstatus": ["<", 2],
		"is_finished_item": 1,
	}
	# Prefer SE Detail with this tag as finished
	name = frappe.db.get_value("Stock Entry Detail", filters, "parent")
	if name:
		purpose = frappe.db.get_value("Stock Entry", name, "purpose")
		if purpose in ("Manufacture", "Repack"):
			if sales_order:
				so = frappe.db.get_value("Stock Entry", name, "custom_sales_order")
				if so and so != sales_order:
					return name  # still count as manufactured elsewhere
			return name
	return None


def _finished_output_rows(ss_coil, include_already=False):
	"""Job Output rows with no next process (= ready to manufacture)."""
	rows = []
	for row in ss_coil.job_output or []:
		tag = getattr(row, "tag_no", None)
		if not tag:
			continue
		if _truthy_process_value(getattr(row, "next_process", None)):
			continue
		existing = _tag_already_manufactured(tag, getattr(ss_coil, "order_no", None))
		if existing and not include_already:
			continue
		rows.append(
			{
				"tag_no": tag,
				"qty": flt(getattr(row, "actual_wt", None)),
				"actual_wt": flt(getattr(row, "actual_wt", None)),
				"estimated_wt": flt(getattr(row, "estimated_wt", None)),
				"width": getattr(row, "width", None),
				"thickness": getattr(row, "thickness", None),
				"length": getattr(row, "length", None),
				"class": getattr(row, "class", None),
				"fg_item": _resolve_output_fg_item(ss_coil, row),
				"row_status": getattr(row, "status", None),
				"next_process": getattr(row, "next_process", None) or "",
				"already_se": existing,
				"row_name": getattr(row, "name", None),
			}
		)
	return rows


@frappe.whitelist()
def get_ss_coil_manufacture_preview(ss_coil):
	"""Return finished tags ready for Manufacture SE from this SS Coil."""
	if not ss_coil or not frappe.db.exists("SS Coil", ss_coil):
		frappe.throw(_("SS Coil not found"))
	doc = frappe.get_doc("SS Coil", ss_coil)
	fg_item = _resolve_fg_item(doc)
	mother = _resolve_mother(doc)
	finished = _finished_output_rows(doc, include_already=True)
	coil_complete = (doc.order_status or "") in ("Completed", "Closed")
	ready = []
	blocked = []
	for row in finished:
		row["bom_no"] = _default_active_bom(row.get("fg_item"))
		if row.get("already_se"):
			continue
		if not coil_complete:
			row["blocked_reason"] = _("SS Coil must be Completed before manufacture.")
		elif flt(row.get("actual_wt")) <= 0:
			row["blocked_reason"] = _("Actual WT must be greater than zero.")
		elif not row.get("fg_item"):
			row["blocked_reason"] = _("No valid finished-good Item is set on this Job Output.")
		elif not row.get("bom_no"):
			row["blocked_reason"] = _("No active default BOM is available for this finished-good Item.")
		else:
			ready.append(row)
			continue
		blocked.append(row)
	continuing = []
	for row in doc.job_output or []:
		if getattr(row, "tag_no", None) and _truthy_process_value(getattr(row, "next_process", None)):
			continuing.append(
				{
					"tag_no": row.tag_no,
					"next_process": row.next_process,
					"qty": _output_qty(row),
				}
			)

	default_wh = frappe.db.get_single_value("Stock Settings", "default_warehouse")
	return {
		"ss_coil": doc.name,
		"order_status": doc.order_status,
		"operation": doc.operation,
		"sales_order": doc.order_no,
		"sales_order_item": doc.sales_order_item,
		"fg_item": fg_item,
		"mother": mother,
		"coil_complete": coil_complete,
		"ready_tags": ready,
		"already_tags": [r for r in finished if r.get("already_se")],
		"blocked_tags": blocked,
		"continuing_tags": continuing,
		"default_warehouse": default_wh,
		"can_create": bool(ready),
	}


@frappe.whitelist()
def get_sales_order_coil_manufacture_preview(sales_order):
	"""Aggregate finished tags across all SS Coil docs for a Sales Order."""
	if not sales_order or not frappe.db.exists("Sales Order", sales_order):
		frappe.throw(_("Sales Order not found"))
	names = frappe.get_all(
		"SS Coil",
		filters={"order_no": sales_order},
		pluck="name",
		order_by="creation asc",
	)
	groups = []
	for name in names:
		preview = get_ss_coil_manufacture_preview(name)
		if (
			preview.get("ready_tags")
			or preview.get("already_tags")
			or preview.get("blocked_tags")
			or preview.get("continuing_tags")
		):
			groups.append(preview)
	return {"sales_order": sales_order, "groups": groups}


def _ensure_batch(item_code, tag_no):
	if not item_code or not tag_no:
		return None
	row = frappe._dict({"doctype": "Stock Entry Detail", "item_code": item_code, "batch_no": None})
	_ensure_batch_for_tag_row(row, tag_no)
	if not row.batch_no and frappe.get_cached_value("Item", item_code, "has_batch_no"):
		# Force create even if use_tag flag off — coil rule Tag=Batch
		if not frappe.db.exists("Batch", tag_no):
			frappe.get_doc({"doctype": "Batch", "batch_id": tag_no, "item": item_code}).insert(
				ignore_permissions=True
			)
		row.batch_no = tag_no
	return row.batch_no or tag_no


def _set_stock_entry_detail_values(row, values):
	"""Copy supported trace values without relying on optional custom fields."""
	for fieldname, value in values.items():
		if value is not None and value != "" and _has_field("Stock Entry Detail", fieldname):
			row.set(fieldname, value)


def _coil_output_detail_values(doc, output, fg_item, so_context, input_row=None):
	"""Map SS Coil output and source context onto one Stock Entry item row."""
	so_item = frappe.db.get_value(
		"Sales Order Item",
		doc.sales_order_item,
		["custom_thickness", "custom_width", "custom_length_c", "custom_length", "custom_ref_no"],
		as_dict=True,
	) if doc.sales_order_item and frappe.db.exists("Sales Order Item", doc.sales_order_item) else frappe._dict()
	thickness = getattr(output, "thickness", None) or getattr(input_row, "thickness", None)
	width = getattr(output, "width", None) or getattr(input_row, "width", None)
	length = getattr(output, "length", None) or getattr(input_row, "length", None)
	thickness = thickness or so_item.get("custom_thickness")
	width = width or so_item.get("custom_width")
	length = length or so_item.get("custom_length")
	dimension = " x ".join(str(value) for value in (thickness, width, length) if value not in (None, ""))
	actual_wt = flt(getattr(output, "actual_wt", None))
	process_row = (doc.so_item or [None])[0]
	return {
		"custom_finish_good_item": fg_item,
		"custom_coil_class": getattr(output, "class", None),
		"custom_actual_wt": actual_wt,
		"custom_estimated_wt": flt(getattr(output, "estimated_wt", None)),
		"custom_actual_qty": flt(getattr(output, "actual_qty", None)),
		"custom_estimated_qty": flt(getattr(output, "estimated_qty", None)),
		"custom_qty_of_coil": flt(getattr(output, "actual_qty", None) or getattr(output, "estimated_qty", None)),
		"custom_packing": getattr(output, "packing", None),
		"custom_thickness": thickness,
		"custom_width": width,
		"custom_length": length,
		"custom_length_c": so_item.get("custom_length_c"),
		"custom_ref_no": so_item.get("custom_ref_no"),
		"custom_dimension": dimension or getattr(input_row, "dimension", None),
		"custom_location": getattr(input_row, "location", None),
		"custom_current_process": getattr(output, "current_process", None) or doc.operation,
		"custom_ss_coil_completed_on": doc.get("completed_on"),
		"custom_slitter": getattr(process_row, "slitter", None) if process_row else None,
		"custom_leveler": getattr(process_row, "leveler", None) if process_row else None,
		"custom_reshearing": getattr(process_row, "reshearing", None) if process_row else None,
		"custom_tag_no": output.tag_no,
		"custom_output_tag_no": output.tag_no,
		"custom_sub_tag_no": output.tag_no,
		"custom_entry_no": doc.name,
		"custom_ss_coil": doc.name,
		"custom_sales_order": getattr(output, "so_no", None) or doc.order_no,
		"custom_sales_order_item": doc.sales_order_item,
		"custom_customer": getattr(output, "customer", None) or so_context.get("customer"),
		"custom_for_customer": getattr(output, "for_customer", None) or so_context.get("custom_for_customer"),
		"custom_mill": doc.mill if doc.mill and frappe.db.exists("Mills", doc.mill) else None,
		"custom_po_no": so_context.get("po_no"),
		"custom_commodity": doc.commodity,
		"custom_specification": doc.specifications,
		"custom_ss_coil_remarks": doc.remarks,
		"custom_create_tag_no": 0,
	}


def backfill_manufacture_stock_entry_trace(ss_coil):
	"""Copy SS Coil trace metadata onto existing linked Manufacture item rows.

	This only updates Stock Entry Detail custom fields. It does not change stock
	quantities, batches, tag registration, or the submitted stock ledger.
	"""
	if not frappe.db.exists("SS Coil", ss_coil):
		frappe.throw(_("SS Coil not found"))
	doc = frappe.get_doc("SS Coil", ss_coil)
	if doc.order_no and frappe.db.exists("Sales Order", doc.order_no):
		so_context = frappe.db.get_value(
			"Sales Order", doc.order_no, ["customer", "custom_for_customer", "po_no"], as_dict=True
		) or frappe._dict()
	else:
		so_context = frappe._dict()
	input_row = (doc.input_coil or [None])[0]
	mother = _resolve_mother(doc)
	output_by_tag = {row.tag_no: row for row in (doc.job_output or []) if row.tag_no}
	entries = frappe.get_all(
		"Stock Entry",
		filters={"custom_ss_coil": doc.name, "purpose": "Manufacture", "docstatus": ["<", 2]},
		pluck="name",
	)
	updated_rows = 0
	for entry_name in entries:
		entry = frappe.get_doc("Stock Entry", entry_name)
		finished_row = next((row for row in entry.items if row.is_finished_item and row.custom_tag_no), None)
		if not finished_row:
			continue
		output_tag = finished_row.custom_tag_no
		output = output_by_tag.get(output_tag)
		if not output:
			continue
		fg_item = _resolve_output_fg_item(doc, output)
		for row in entry.items:
			if row.is_finished_item:
				values = _coil_output_detail_values(doc, output, fg_item, so_context, input_row)
			else:
				values = {
					"custom_output_tag_no": output_tag,
					"custom_sub_tag_no": output_tag,
					"custom_entry_no": f"{entry.name} / {doc.name}",
					"custom_ss_coil": doc.name,
					"custom_sales_order": doc.order_no,
					"custom_sales_order_item": doc.sales_order_item,
					"custom_customer": so_context.get("customer"),
					"custom_for_customer": so_context.get("custom_for_customer"),
					"custom_finish_good_item": fg_item,
					"custom_ss_coil_completed_on": doc.get("completed_on"),
					"custom_ss_coil_remarks": doc.remarks,
					"custom_create_tag_no": 0,
				}
				if mother.get("item_code") == row.item_code and mother.get("tag_no"):
					values.update(
						{
							"custom_tag_no": mother["tag_no"],
							"custom_actual_wt": flt(getattr(input_row, "actual_wt", None)),
							"custom_estimated_wt": flt(getattr(input_row, "estimated_wt", None)),
							"custom_actual_qty": flt(getattr(input_row, "actual_qty", None)),
							"custom_estimated_qty": flt(getattr(input_row, "estimated_qty", None)),
							"custom_qty_of_coil": flt(getattr(input_row, "actual_qty", None) or getattr(input_row, "estimated_qty", None)),
							"custom_coil_class": getattr(input_row, "class", None),
							"custom_dimension": getattr(input_row, "dimension", None),
							"custom_thickness": getattr(input_row, "thickness", None),
							"custom_width": getattr(input_row, "width", None),
							"custom_length": getattr(input_row, "length", None),
							"custom_location": getattr(input_row, "location", None),
						}
					)
			for fieldname, value in values.items():
				if value is not None and value != "" and _has_field("Stock Entry Detail", fieldname):
					row.set(fieldname, value)
			row.custom_entry_no = f"{entry.name} / {doc.name}"
			frappe.db.set_value(
				"Stock Entry Detail",
				row.name,
				{field: row.get(field) for field in values if _has_field("Stock Entry Detail", field)},
				update_modified=False,
			)
			updated_rows += 1
	return {"ss_coil": doc.name, "stock_entries": len(entries), "updated_item_rows": updated_rows}


@frappe.whitelist()
def create_manufacture_stock_entry_from_ss_coil(
	ss_coil,
	tags=None,
	source_warehouse=None,
	target_warehouse=None,
	submit=1,
	remarks=None,
	posting_date=None,
):
	"""Create one BOM-based Manufacture Stock Entry for each selected output tag."""
	if not ss_coil or not frappe.db.exists("SS Coil", ss_coil):
		frappe.throw(_("SS Coil not found"))
	doc = frappe.get_doc("SS Coil", ss_coil)
	if (doc.order_status or "") not in ("Completed", "Closed"):
		frappe.throw(_("Complete the SS Coil before creating Manufacture entries."))

	if isinstance(tags, str):
		import json

		try:
			tags = json.loads(tags)
		except Exception:
			tags = [tag.strip() for tag in tags.split(",") if tag.strip()]

	preview = get_ss_coil_manufacture_preview(ss_coil)
	ready_map = {row["tag_no"]: row for row in preview.get("ready_tags") or []}
	if not tags:
		tags = list(ready_map)
	tags = list(dict.fromkeys(tags or []))
	if not tags:
		frappe.throw(_("No completed Job Output tags are ready for manufacture."))
	if not source_warehouse or not target_warehouse:
		frappe.throw(_("Source and Finished Goods warehouses are required."))

	selected = []
	for tag in tags:
		row = ready_map.get(tag)
		if not row:
			frappe.throw(_("Tag {0} is not eligible. Check SS Coil completion, Actual WT, BOM, Next Process, and existing entries.").format(tag))
		if flt(row.get("actual_wt")) <= 0:
			frappe.throw(_("Tag {0} needs an Actual WT greater than zero.").format(tag))
		selected.append(row)

	company = frappe.db.get_value("Sales Order", doc.order_no, "company") if doc.order_no and frappe.db.exists("Sales Order", doc.order_no) else None
	company = company or frappe.defaults.get_user_default("Company")
	if not company:
		frappe.throw(_("Set a Company before creating Manufacture entries."))

	from erpnext.manufacturing.doctype.bom.bom import get_bom_items

	created = []
	for output in selected:
		tag = output["tag_no"]
		qty = flt(output.get("actual_wt"))
		fg_item = output.get("fg_item")
		bom_no = output.get("bom_no") or _default_active_bom(fg_item)
		if not fg_item or not bom_no:
			frappe.throw(_("Tag {0}: no finished-good Item or active default BOM is available.").format(tag))
		if _tag_already_manufactured(tag, doc.order_no):
			frappe.throw(_("Tag {0} already has a Manufacture Stock Entry.").format(tag))

		bom = frappe.get_doc("BOM", bom_no)
		if bom.docstatus != 1 or not bom.is_active or bom.item != fg_item:
			frappe.throw(_("BOM {0} is not an active, submitted BOM for {1}.").format(bom_no, fg_item))
		bom_items = get_bom_items(bom_no, company, qty, 1)
		if not bom_items:
			frappe.throw(_("BOM {0} has no stock components for tag {1}.").format(bom_no, tag))

		se = frappe.new_doc("Stock Entry")
		se.stock_entry_type = "Manufacture"
		se.purpose = "Manufacture"
		se.naming_series = STOCK_ENTRY_TYPE_SERIES["Manufacture"]
		if posting_date:
			se.posting_date = getdate(posting_date)
			se.set_posting_time = 1
		se.company = company
		se.from_warehouse = source_warehouse
		se.to_warehouse = target_warehouse
		se.bom_no = bom_no
		se.from_bom = 1
		se.use_multi_level_bom = 1
		se.fg_completed_qty = qty
		se.remarks = "\n".join(filter(None, [
			remarks,
			_("Manufactured from SS Coil {0}, Job Output {1}, Tag {2}, Actual WT {3}").format(doc.name, output.get("row_name") or "-", tag, qty),
		]))
		if _has_field("Stock Entry", "custom_sales_order") and doc.order_no:
			se.custom_sales_order = doc.order_no
		if _has_field("Stock Entry", "custom_ss_coil"):
			se.custom_ss_coil = doc.name
		if doc.order_no and frappe.db.exists("Sales Order", doc.order_no):
			so_context = frappe.db.get_value(
				"Sales Order", doc.order_no, ["customer", "custom_for_customer", "po_no"], as_dict=True
			) or frappe._dict()
		else:
			so_context = frappe._dict()
		if _has_field("Stock Entry", "custom_customer"):
			se.custom_customer = so_context.get("customer")
		if _has_field("Stock Entry", "custom_for_customer"):
			se.custom_for_customer = so_context.get("custom_for_customer")

		component_rows = {}
		for idx, component in enumerate(bom_items):
			item = frappe._dict(component)
			item.from_warehouse = item.get("source_warehouse") or source_warehouse
			item.to_warehouse = ""
			component_rows[f"{item.item_code}-{idx}"] = item
		se.add_to_stock_entry_detail(component_rows, bom_no=bom_no)
		se.load_items_from_bom()

		finished_rows = [row for row in se.items if row.is_finished_item and row.item_code == fg_item]
		if len(finished_rows) != 1:
			frappe.throw(_("Could not prepare exactly one finished-good row for tag {0}.").format(tag))
		finished = finished_rows[0]
		finished.qty = qty
		finished.transfer_qty = qty
		finished.t_warehouse = target_warehouse
		source_output = next((row for row in (doc.job_output or []) if row.tag_no == tag), None)
		input_row = (doc.input_coil or [None])[0]
		_set_stock_entry_detail_values(
			finished,
			_coil_output_detail_values(doc, source_output, fg_item, so_context, input_row) if source_output else {},
		)
		if frappe.get_cached_value("Item", fg_item, "has_batch_no"):
			finished.batch_no = _ensure_batch(fg_item, tag)
			if _has_field("Stock Entry Detail", "use_serial_batch_fields"):
				finished.use_serial_batch_fields = 1

		mother = _resolve_mother(doc)
		for component in se.items:
			if component.is_finished_item:
				continue
			_set_stock_entry_detail_values(
				component,
				{
					**(_coil_output_detail_values(doc, source_output, fg_item, so_context, input_row) if source_output else {}),
					"custom_ss_coil": doc.name,
					"custom_entry_no": doc.name,
					"custom_sales_order": doc.order_no,
					"custom_sales_order_item": doc.sales_order_item,
					"custom_customer": so_context.get("customer"),
					"custom_for_customer": so_context.get("custom_for_customer"),
					"custom_finish_good_item": fg_item,
					"custom_output_tag_no": tag,
					"custom_sub_tag_no": tag,
					"custom_ss_coil_completed_on": doc.get("completed_on"),
					"custom_ss_coil_remarks": doc.remarks,
					"custom_mill": doc.mill if doc.mill and frappe.db.exists("Mills", doc.mill) else None,
					"custom_commodity": doc.commodity,
					"custom_specification": doc.specifications,
					"custom_create_tag_no": 0,
				},
			)
			if mother.get("item_code") == component.item_code and mother.get("tag_no"):
				_set_stock_entry_detail_values(
					component,
					{
						"custom_tag_no": mother["tag_no"],
						"custom_actual_wt": flt(getattr(input_row, "actual_wt", None)),
						"custom_estimated_wt": flt(getattr(input_row, "estimated_wt", None)),
						"custom_actual_qty": flt(getattr(input_row, "actual_qty", None)),
						"custom_estimated_qty": flt(getattr(input_row, "estimated_qty", None)),
						"custom_qty_of_coil": flt(getattr(input_row, "actual_qty", None) or getattr(input_row, "estimated_qty", None)),
						"custom_coil_class": getattr(input_row, "class", None),
						"custom_dimension": getattr(input_row, "dimension", None),
						"custom_thickness": getattr(input_row, "thickness", None),
						"custom_width": getattr(input_row, "width", None),
						"custom_length": getattr(input_row, "length", None),
						"custom_length_c": frappe.db.get_value("Sales Order Item", doc.sales_order_item, "custom_length_c") if doc.sales_order_item and frappe.db.exists("Sales Order Item", doc.sales_order_item) else None,
						"custom_location": getattr(input_row, "location", None),
						"custom_current_process": getattr(input_row, "previous_job_order", None),
					},
				)
				if frappe.get_cached_value("Item", component.item_code, "has_batch_no"):
					component.batch_no = _ensure_batch(component.item_code, mother.get("tag_no"))
					if _has_field("Stock Entry Detail", "use_serial_batch_fields"):
						component.use_serial_batch_fields = 1

		se.insert(ignore_permissions=True)
		if cint(submit):
			se.submit()
		# Keep both identifiers on every line: the Stock Entry parent is the
		# Stock Entry number, and the suffix is the source SS Coil entry.
		for detail in se.items:
			frappe.db.set_value(
				"Stock Entry Detail",
				detail.name,
				"custom_entry_no",
				f"{se.name} / {doc.name}",
				update_modified=False,
			)
		created.append({"tag_no": tag, "stock_entry": se.name, "bom_no": bom_no, "qty": qty, "docstatus": se.docstatus})

	# Preserve all selected tags on their Sales Order line without creating a
	# single multi-tag Stock Entry; each created entry remains tied to one tag.
	if doc.sales_order_item and frappe.db.exists("Sales Order Item", doc.sales_order_item):
		values = {}
		item_doc = frappe.db.get_value(
			"Sales Order Item",
			doc.sales_order_item,
			["custom_tag_no", "custom_sub_tag_no", "custom_entry_no"],
			as_dict=True,
		) or frappe._dict()
		selected_tags = [row["tag_no"] for row in selected]
		if _has_field("Sales Order Item", "custom_tag_no") and not item_doc.get("custom_tag_no"):
			values["custom_tag_no"] = selected_tags[0]
		if _has_field("Sales Order Item", "custom_sub_tag_no"):
			existing = [tag.strip() for tag in str(item_doc.get("custom_sub_tag_no") or "").split(",") if tag.strip()]
			values["custom_sub_tag_no"] = ", ".join(dict.fromkeys([*existing, *selected_tags]))
		if _has_field("Sales Order Item", "custom_ss_coil"):
			values["custom_ss_coil"] = doc.name
		if _has_field("Sales Order Item", "custom_entry_no") and not item_doc.get("custom_entry_no"):
			values["custom_entry_no"] = created[0]["stock_entry"]
		if values:
			frappe.db.set_value("Sales Order Item", doc.sales_order_item, values, update_modified=False)

	return {
		"stock_entry": created[0]["stock_entry"] if created else None,
		"stock_entries": created,
		"docstatus": cint(submit),
		"tags": [row["tag_no"] for row in selected],
		"fg_item": selected[0].get("fg_item") if selected else None,
		"qty": sum(flt(row.get("actual_wt")) for row in selected),
	}
