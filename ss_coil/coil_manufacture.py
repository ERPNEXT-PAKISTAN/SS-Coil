"""Coil Manufacture — create Manufacture Stock Entry from finished SS Coil Job Output tags.

Rules:
- No Semi Finished stock between processes.
- A Job Output tag is eligible when `next_process` is blank (final for that branch).
- One Manufacture SE can close one or more finished tags from the same SS Coil.
- FG receive: batch_no = tag_no = custom_tag_no.
- Consume original mother raw material (root tag/batch), not intermediate tags.
"""

from __future__ import annotations

import frappe
from frappe import _
from frappe.utils import cint, flt

from ss_coil.api import (
	_ensure_batch_for_tag_row,
	_has_field,
	_root_tag_for,
	_truthy_process_value,
)


def setup_coil_manufacture_fields():
	"""Stock Entry parent link to SS Coil for manufacture trace."""
	from frappe.custom.doctype.custom_field.custom_field import create_custom_fields

	fields = {}
	if not frappe.db.exists("Custom Field", "Stock Entry-custom_ss_coil"):
		fields["Stock Entry"] = [
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
		]
	if fields:
		create_custom_fields(fields, update=True)
	frappe.clear_cache(doctype="Stock Entry")
	return {"status": "ok"}


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
				"qty": _output_qty(row),
				"width": getattr(row, "width", None),
				"thickness": getattr(row, "thickness", None),
				"length": getattr(row, "length", None),
				"class": getattr(row, "class", None),
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
	ready = [r for r in finished if not r.get("already_se")]
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
		"ready_tags": ready,
		"already_tags": [r for r in finished if r.get("already_se")],
		"continuing_tags": continuing,
		"default_warehouse": default_wh,
		"can_create": bool(ready and fg_item and mother.get("item_code")),
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
		if preview.get("ready_tags") or preview.get("already_tags") or preview.get("continuing_tags"):
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


@frappe.whitelist()
def create_manufacture_stock_entry_from_ss_coil(
	ss_coil,
	tags=None,
	source_warehouse=None,
	target_warehouse=None,
	submit=1,
	remarks=None,
):
	"""Create one Manufacture Stock Entry for selected finished Job Output tags."""
	if not ss_coil or not frappe.db.exists("SS Coil", ss_coil):
		frappe.throw(_("SS Coil not found"))
	doc = frappe.get_doc("SS Coil", ss_coil)

	if isinstance(tags, str):
		import json

		try:
			tags = json.loads(tags)
		except Exception:
			tags = [t.strip() for t in tags.split(",") if t.strip()]

	preview = get_ss_coil_manufacture_preview(ss_coil)
	ready_map = {r["tag_no"]: r for r in preview.get("ready_tags") or []}
	if not tags:
		tags = list(ready_map.keys())
	selected = []
	for tag in tags:
		row = ready_map.get(tag)
		if not row:
			frappe.throw(_("Tag {0} is not ready for manufacture (needs next process or already made).").format(tag))
		if flt(row.get("qty")) <= 0:
			frappe.throw(_("Tag {0} has zero qty/weight — set Actual WT or Estimated WT on Job Output.").format(tag))
		selected.append(row)

	if not selected:
		frappe.throw(_("No finished tags selected for manufacture."))

	fg_item = preview.get("fg_item")
	mother = preview.get("mother") or {}
	if not fg_item:
		frappe.throw(_("Cannot resolve Finish Good item from Sales Order Item."))
	if not mother.get("item_code"):
		frappe.throw(_("Cannot resolve mother / raw material item. Set Raw Material on Sales Order / Coil Production."))
	if not source_warehouse or not target_warehouse:
		frappe.throw(_("Source and Finished Goods warehouses are required."))

	fg_uom = frappe.get_cached_value("Item", fg_item, "stock_uom") or "Nos"
	rm_uom = frappe.get_cached_value("Item", mother["item_code"], "stock_uom") or "Nos"
	total_fg_qty = sum(flt(r["qty"]) for r in selected)

	mother_batch = _ensure_batch(mother["item_code"], mother.get("tag_no") or mother.get("batch_no"))
	company = None
	if doc.order_no and frappe.db.exists("Sales Order", doc.order_no):
		company = frappe.db.get_value("Sales Order", doc.order_no, "company")
	if not company:
		company = frappe.defaults.get_user_default("Company")

	se = frappe.new_doc("Stock Entry")
	se.stock_entry_type = "Manufacture"
	se.purpose = "Manufacture"
	se.company = company
	se.from_warehouse = source_warehouse
	se.to_warehouse = target_warehouse
	se.fg_completed_qty = total_fg_qty
	se.remarks = remarks or _("Coil manufacture from SS Coil {0}").format(doc.name)
	if _has_field("Stock Entry", "custom_sales_order") and doc.order_no:
		se.custom_sales_order = doc.order_no
	if _has_field("Stock Entry", "custom_ss_coil"):
		se.custom_ss_coil = doc.name

	# Consume mother once for total qty of selected finished tags
	rm = se.append("items", {})
	rm.item_code = mother["item_code"]
	rm.qty = total_fg_qty
	rm.transfer_qty = total_fg_qty
	rm.uom = rm_uom
	rm.stock_uom = rm_uom
	rm.conversion_factor = 1
	rm.s_warehouse = source_warehouse
	rm.is_finished_item = 0
	if mother.get("tag_no") and _has_field("Stock Entry Detail", "custom_tag_no"):
		rm.custom_tag_no = mother["tag_no"]
	if mother_batch and _has_field("Stock Entry Detail", "batch_no"):
		rm.batch_no = mother_batch
		if _has_field("Stock Entry Detail", "use_serial_batch_fields"):
			rm.use_serial_batch_fields = 1
	if _has_field("Stock Entry Detail", "custom_ss_coil"):
		rm.custom_ss_coil = doc.name
	if _has_field("Stock Entry Detail", "custom_entry_no"):
		rm.custom_entry_no = f"{doc.name}"

	# Receive each finished tag as FG with Tag = Batch
	for row in selected:
		tag = row["tag_no"]
		qty = flt(row["qty"])
		fg_batch = _ensure_batch(fg_item, tag)
		fg = se.append("items", {})
		fg.item_code = fg_item
		fg.qty = qty
		fg.transfer_qty = qty
		fg.uom = fg_uom
		fg.stock_uom = fg_uom
		fg.conversion_factor = 1
		fg.t_warehouse = target_warehouse
		fg.is_finished_item = 1
		if _has_field("Stock Entry Detail", "custom_tag_no"):
			fg.custom_tag_no = tag
		if _has_field("Stock Entry Detail", "custom_sub_tag_no"):
			fg.custom_sub_tag_no = tag
		if fg_batch and _has_field("Stock Entry Detail", "batch_no"):
			fg.batch_no = fg_batch
			if _has_field("Stock Entry Detail", "use_serial_batch_fields"):
				fg.use_serial_batch_fields = 1
		if _has_field("Stock Entry Detail", "custom_ss_coil"):
			fg.custom_ss_coil = doc.name
		if _has_field("Stock Entry Detail", "custom_entry_no"):
			fg.custom_entry_no = doc.name

	se.insert(ignore_permissions=True)
	if cint(submit):
		se.submit()

	# Mirror primary finished tag onto SO item when linked
	if doc.sales_order_item and frappe.db.exists("Sales Order Item", doc.sales_order_item):
		primary = selected[0]["tag_no"]
		values = {}
		if _has_field("Sales Order Item", "custom_tag_no"):
			values["custom_tag_no"] = primary
		if _has_field("Sales Order Item", "custom_sub_tag_no"):
			values["custom_sub_tag_no"] = ", ".join(r["tag_no"] for r in selected)
		if _has_field("Sales Order Item", "custom_ss_coil"):
			values["custom_ss_coil"] = doc.name
		if _has_field("Sales Order Item", "custom_entry_no"):
			values["custom_entry_no"] = doc.name
		if values:
			frappe.db.set_value("Sales Order Item", doc.sales_order_item, values, update_modified=False)

	return {
		"stock_entry": se.name,
		"docstatus": se.docstatus,
		"tags": [r["tag_no"] for r in selected],
		"fg_item": fg_item,
		"mother_item": mother["item_code"],
		"qty": total_fg_qty,
	}
