import html
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
	status="Active",
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

	doc.current_doctype = source_doctype
	doc.current_docname = source_docname
	doc.current_child_doctype = source_child_doctype
	doc.current_child_name = source_child_name
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
	doc.status = status or "Active"
	doc.flags.ignore_permissions = True
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
	for row in doc.items or []:
		is_persisted_source = bool(doc.name and frappe.db.exists("Sales Order", doc.name))
		if row.get("custom_tag_no") and is_persisted_source:
			_ensure_origin_tag_available(row.custom_tag_no, "Sales Order", doc.name, row.doctype, row.name)
		if row.get("custom_tag_no"):
			tag_no = row.get("custom_tag_no")
		else:
			tag_no = _next_tag_number()
			if _has_field(row.doctype, "custom_tag_no"):
				row.custom_tag_no = tag_no

		if is_persisted_source:
			_register_tag(
				tag_no,
				source_doctype="Sales Order",
				source_docname=doc.name,
				source_child_doctype=row.doctype,
				source_child_name=row.name,
				item_code=row.item_code,
				item_name=row.item_name,
				sales_order=doc.name,
				status="Active",
			)


def sync_sales_order_item_tag_registry(doc, method=None):
	for row in doc.items or []:
		if not row.get("custom_tag_no"):
			continue
		_register_tag(
			row.get("custom_tag_no"),
			source_doctype="Sales Order",
			source_docname=doc.name,
			source_child_doctype=row.doctype,
			source_child_name=row.name,
			item_code=row.item_code,
			item_name=row.item_name,
			sales_order=doc.name,
			status="Active",
		)


def assign_purchase_receipt_item_tags(doc, method=None):
	for row in doc.items or []:
		if not _has_field(row.doctype, "custom_tag_no"):
			continue
		derived_from_upstream = False
		if not row.custom_tag_no and getattr(row, "purchase_invoice_item", None):
			row.custom_tag_no = _find_purchase_invoice_item_tag(pi_detail=row.purchase_invoice_item, item_code=row.item_code)
			derived_from_upstream = bool(row.custom_tag_no)
		if not row.custom_tag_no and getattr(row, "sales_order_item", None):
			row.custom_tag_no = _find_sales_order_item_tag(so_detail=row.sales_order_item, item_code=row.item_code)
			derived_from_upstream = bool(row.custom_tag_no)
		if row.custom_tag_no and not derived_from_upstream:
			_ensure_origin_tag_available(row.custom_tag_no, "Purchase Receipt", doc.name, row.doctype, row.name)
		tag_no = _get_or_create_tag(
			source_doctype="Purchase Receipt",
			source_docname=doc.name,
			source_child_doctype=row.doctype,
			source_child_name=row.name,
			item_code=row.item_code,
			item_name=row.item_name,
			sales_order=getattr(row, "sales_order", None) or getattr(doc, "custom_sales_order", None),
			existing_tag=row.custom_tag_no,
		)
		row.custom_tag_no = tag_no


def assign_purchase_invoice_item_tags(doc, method=None):
	for row in doc.items or []:
		if not _has_field(row.doctype, "custom_tag_no"):
			continue
		derived_from_upstream = False
		if not row.custom_tag_no and getattr(row, "purchase_receipt_item", None):
			row.custom_tag_no = _find_purchase_receipt_item_tag(pr_detail=row.purchase_receipt_item, item_code=row.item_code)
			derived_from_upstream = bool(row.custom_tag_no)
		if not row.custom_tag_no and getattr(row, "sales_order_item", None):
			row.custom_tag_no = _find_sales_order_item_tag(so_detail=row.sales_order_item, item_code=row.item_code)
			derived_from_upstream = bool(row.custom_tag_no)
		if row.custom_tag_no and not derived_from_upstream:
			_ensure_origin_tag_available(row.custom_tag_no, "Purchase Invoice", doc.name, row.doctype, row.name)
		tag_no = _get_or_create_tag(
			source_doctype="Purchase Invoice",
			source_docname=doc.name,
			source_child_doctype=row.doctype,
			source_child_name=row.name,
			item_code=row.item_code,
			item_name=row.item_name,
			sales_order=getattr(row, "sales_order", None) or getattr(doc, "custom_sales_order", None),
			existing_tag=row.custom_tag_no,
		)
		row.custom_tag_no = tag_no


def assign_stock_entry_detail_tags(doc, method=None):
	is_receipt = (doc.purpose or "") == "Material Receipt"
	for row in doc.items or []:
		if not _has_field(row.doctype, "custom_tag_no"):
			continue
		derived_from_upstream = False
		if not row.custom_tag_no and getattr(row, "reference_purchase_receipt", None):
			row.custom_tag_no = _find_purchase_receipt_item_tag(
				purchase_receipt=row.reference_purchase_receipt,
				item_code=row.item_code,
			)
			derived_from_upstream = bool(row.custom_tag_no)
		if not row.custom_tag_no and is_receipt:
			row.custom_tag_no = _get_or_create_tag(
				source_doctype="Stock Entry",
				source_docname=doc.name,
				source_child_doctype=row.doctype,
				source_child_name=row.name,
				item_code=row.item_code,
				item_name=row.item_name,
				sales_order=getattr(doc, "custom_sales_order", None),
				stock_entry=doc.name,
				existing_tag=row.custom_tag_no,
			)
		elif row.custom_tag_no:
			if is_receipt and not derived_from_upstream:
				_ensure_origin_tag_available(row.custom_tag_no, "Stock Entry", doc.name, row.doctype, row.name)
			_register_tag(
				row.custom_tag_no,
				source_doctype="Stock Entry",
				source_docname=doc.name,
				source_child_doctype=row.doctype,
				source_child_name=row.name,
				item_code=row.item_code,
				item_name=row.item_name,
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

	def apply_values(row, existing_row=None, sequence_number=1, output_width=None, pieces_count=1):
		estimated_qty = flt(getattr(input_row, "estimated_qty", 0)) / pieces_count if pieces_count else flt(getattr(input_row, "estimated_qty", 0))
		estimated_wt = flt(getattr(input_row, "estimated_wt", 0)) / pieces_count if pieces_count else flt(getattr(input_row, "estimated_wt", 0))
		for fieldname in target_fields:
			if fieldname == "class":
				row.set("class", getattr(input_row, "class", None))
			elif fieldname == "tag_no":
				row.tag_no = getattr(existing_row, "tag_no", None) or _build_child_tag(getattr(input_row, "tag_no", None), sequence_number)
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


def _build_qr_html(payload_text):
	if not payload_text:
		return ""
	if pyqrcode:
		qr = pyqrcode.create(payload_text, error="M")
		buffer = BytesIO()
		qr.svg(buffer, scale=3)
		svg = _strip_svg_preamble(buffer.getvalue().decode())
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
		frappe.throw("No next process found in Job Output.")

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

	delivery_details = []
	if all_tags and _has_field("Delivery Note Item", "custom_tag_no"):
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
			order by parent.posting_date desc, child.idx asc
			""",
			{"tags": tuple(all_tags)},
			as_dict=True,
		)

	invoice_details = []
	if all_tags and _has_field("Sales Invoice Item", "custom_tag_no"):
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
			order by parent.posting_date desc, child.idx asc
			""",
			{"tags": tuple(all_tags)},
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


def prepare_stock_entry_links(doc, method=None):
	populate_custom_sales_order(doc, method=method)
	assign_stock_entry_detail_tags(doc, method=method)


def prepare_purchase_receipt_links(doc, method=None):
	populate_custom_sales_order(doc, method=method)
	assign_purchase_receipt_item_tags(doc, method=method)


def prepare_purchase_invoice_links(doc, method=None):
	populate_custom_sales_order(doc, method=method)
	assign_purchase_invoice_item_tags(doc, method=method)


def assign_delivery_note_item_tags(doc, method=None):
	for row in doc.items or []:
		if not _has_field(row.doctype, "custom_tag_no"):
			continue
		if not row.custom_tag_no:
			row.custom_tag_no = _find_sales_order_item_tag(
				so_detail=getattr(row, "so_detail", None),
				sales_order=getattr(row, "against_sales_order", None),
				item_code=row.item_code,
			)
		if row.custom_tag_no:
			_register_tag(
				row.custom_tag_no,
				source_doctype="Delivery Note",
				source_docname=doc.name,
				source_child_doctype=row.doctype,
				source_child_name=row.name,
				item_code=row.item_code,
				item_name=row.item_name,
				sales_order=getattr(row, "against_sales_order", None),
				status="Delivered",
			)


def assign_sales_invoice_item_tags(doc, method=None):
	for row in doc.items or []:
		if not _has_field(row.doctype, "custom_tag_no"):
			continue
		if not row.custom_tag_no:
			row.custom_tag_no = _find_sales_order_item_tag(
				so_detail=getattr(row, "so_detail", None),
				sales_order=getattr(row, "sales_order", None),
				item_code=row.item_code,
			)
		if not row.custom_tag_no and getattr(row, "delivery_note", None):
			row.custom_tag_no = frappe.db.get_value(
				"Delivery Note Item",
				{"parent": row.delivery_note, "so_detail": getattr(row, "so_detail", None), "item_code": row.item_code},
				"custom_tag_no",
			)
		if row.custom_tag_no:
			_register_tag(
				row.custom_tag_no,
				source_doctype="Sales Invoice",
				source_docname=doc.name,
				source_child_doctype=row.doctype,
				source_child_name=row.name,
				item_code=row.item_code,
				item_name=row.item_name,
				sales_order=getattr(row, "sales_order", None),
				status="Invoiced",
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
