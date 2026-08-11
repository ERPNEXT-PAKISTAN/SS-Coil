"""Keep SS Coil Space workspace links and shortcuts in sync with app doctypes/reports."""

import frappe

WORKSPACE_NAME = "SS Coil Space"
SS_COIL_FLOW_PAGE = "ss-coil-flow"

# Standalone DocTypes in the SS Coil module (exclude child tables).
APP_DOCTYPES = (
	"SS Coil",
	"SO Production Plan",
	"Tag Number Settings",
	"Mills",
	"Tag Registry",
	"For Customer",
)

# ERPNext doctypes heavily used by this app.
TRACKING_DOCTYPES = (
	"Sales Order",
	"Stock Entry",
	"Purchase Receipt",
	"Purchase Invoice",
	"Delivery Note",
	"Sales Invoice",
)

SCRIPT_REPORTS = (
	("Tag Registry Trace", "Tag Registry"),
	("Production Planning", "Sales Order"),
	("Production Planning SS Coil", "SS Coil"),
)

WORKSPACE_SHORTCUTS = (
	{"type": "Page", "link_to": SS_COIL_FLOW_PAGE, "label": "SS Coil Flow", "color": "Orange", "doc_view": ""},
	{"type": "DocType", "link_to": "SS Coil", "label": "SS Coil", "color": "Blue", "doc_view": "List"},
	{"type": "DocType", "link_to": "Sales Order", "label": "Sales Order", "color": "Orange", "doc_view": "List"},
	{"type": "DocType", "link_to": "Stock Entry", "label": "Stock Entry", "color": "Green", "doc_view": "List"},
	{"type": "DocType", "link_to": "Tag Registry", "label": "Tag Registry", "color": "Purple", "doc_view": "List"},
	{"type": "DocType", "link_to": "Mills", "label": "Mills", "color": "Grey", "doc_view": "List"},
	{"type": "DocType", "link_to": "SO Production Plan", "label": "SO Production Plan", "color": "Cyan", "doc_view": "List"},
	{"type": "DocType", "link_to": "For Customer", "label": "For Customer", "color": "Pink", "doc_view": "List"},
	{"type": "DocType", "link_to": "Tag Number Settings", "label": "Tag Number Settings", "color": "Yellow", "doc_view": "List"},
	{"type": "Report", "link_to": "Production Planning", "label": "Production Planning", "color": "Red", "doc_view": "List"},
	{"type": "Report", "link_to": "Tag Registry Trace", "label": "Tag Registry Trace", "color": "Red", "doc_view": "List"},
)

SIDEBAR_ITEMS = (
	{"type": "Link", "label": "Home", "link_to": WORKSPACE_NAME, "link_type": "Workspace", "icon": "home", "indent": 0, "child": 0},
	{"type": "Link", "label": "SS Coil Flow", "link_to": SS_COIL_FLOW_PAGE, "link_type": "Page", "icon": "route", "indent": 0, "child": 0},
	{"type": "Section Break", "label": "Production", "icon": "layers", "indent": 0, "child": 0, "collapsible": 1, "keep_closed": 0},
	{"type": "Link", "label": "SS Coil", "link_to": "SS Coil", "link_type": "DocType", "icon": "layers", "indent": 1, "child": 1},
	{"type": "Link", "label": "SO Production Plan", "link_to": "SO Production Plan", "link_type": "DocType", "icon": "", "indent": 1, "child": 1},
	{"type": "Link", "label": "Mills", "link_to": "Mills", "link_type": "DocType", "icon": "tool", "indent": 1, "child": 1},
	{"type": "Link", "label": "Tag Number Settings", "link_to": "Tag Number Settings", "link_type": "DocType", "icon": "settings", "indent": 1, "child": 1},
	{"type": "Link", "label": "For Customer", "link_to": "For Customer", "link_type": "DocType", "icon": "users", "indent": 1, "child": 1},
	{"type": "Section Break", "label": "Documents", "icon": "folder", "indent": 0, "child": 0, "collapsible": 1, "keep_closed": 0},
	{"type": "Link", "label": "Sales Order", "link_to": "Sales Order", "link_type": "DocType", "icon": "shopping-cart", "indent": 1, "child": 1},
	{"type": "Link", "label": "Stock Entry", "link_to": "Stock Entry", "link_type": "DocType", "icon": "package", "indent": 1, "child": 1},
	{"type": "Link", "label": "Tag Registry", "link_to": "Tag Registry", "link_type": "DocType", "icon": "tag", "indent": 1, "child": 1},
	{"type": "Section Break", "label": "Reports", "icon": "notepad-text", "indent": 0, "child": 0, "collapsible": 1, "keep_closed": 1},
	{"type": "Link", "label": "Production Planning", "link_to": "Production Planning", "link_type": "Report", "icon": "", "indent": 1, "child": 1},
	{"type": "Link", "label": "Production Planning SS Coil", "link_to": "Production Planning SS Coil", "link_type": "Report", "icon": "", "indent": 1, "child": 1},
	{"type": "Link", "label": "Tag Registry Trace", "link_to": "Tag Registry Trace", "link_type": "Report", "icon": "", "indent": 1, "child": 1},
)


def _existing_doctypes(names):
	return [name for name in names if frappe.db.exists("DocType", name)]


def _append_doctype_link(doc, label, doctype, onboard=0):
	if not frappe.db.exists("DocType", doctype):
		return
	doc.append(
		"links",
		{
			"type": "Link",
			"label": label or doctype,
			"link_type": "DocType",
			"link_to": doctype,
			"onboard": onboard,
			"is_query_report": 0,
			"hidden": 0,
		},
	)


def _append_report_link(doc, report_name, ref_doctype):
	if not frappe.db.exists("Report", report_name):
		return
	doc.append(
		"links",
		{
			"type": "Link",
			"label": report_name,
			"link_type": "Report",
			"link_to": report_name,
			"report_ref_doctype": ref_doctype,
			"is_query_report": 1,
			"onboard": 0,
			"hidden": 0,
		},
	)


def sync_ss_coil_workspace():
	"""Rebuild SS Coil Space shortcuts, card links, and sidebar from app catalog."""
	if not frappe.db.exists("Workspace", WORKSPACE_NAME):
		return {"status": "skipped", "reason": "workspace missing"}

	ws = frappe.get_doc("Workspace", WORKSPACE_NAME)
	ws.links = []

	if frappe.db.exists("Page", SS_COIL_FLOW_PAGE):
		ws.append(
			"links",
			{
				"type": "Link",
				"label": "SS Coil Flow",
				"link_type": "Page",
				"link_to": SS_COIL_FLOW_PAGE,
				"onboard": 1,
				"is_query_report": 0,
				"hidden": 0,
			},
		)

	ws.append("links", {"type": "Card Break", "label": "Planning & Production", "hidden": 0, "onboard": 0})
	for dt in _existing_doctypes(APP_DOCTYPES):
		_append_doctype_link(ws, dt, dt, onboard=1 if dt == "SS Coil" else 0)

	ws.append("links", {"type": "Card Break", "label": "Documents & Tracking", "hidden": 0, "onboard": 0})
	for dt in _existing_doctypes(TRACKING_DOCTYPES):
		_append_doctype_link(ws, dt, dt, onboard=1 if dt in ("Sales Order", "Stock Entry") else 0)

	ws.append("links", {"type": "Card Break", "label": "Reports & Settings", "hidden": 0, "onboard": 0})
	for report_name, ref_doctype in SCRIPT_REPORTS:
		_append_report_link(ws, report_name, ref_doctype)

	if frappe.db.exists("Page", "print-designer"):
		ws.append(
			"links",
			{
				"type": "Link",
				"label": "Print Designer",
				"link_type": "Page",
				"link_to": "print-designer",
				"onboard": 0,
				"is_query_report": 0,
				"hidden": 0,
			},
		)

	ws.shortcuts = []
	for row in WORKSPACE_SHORTCUTS:
		if row["type"] == "DocType" and not frappe.db.exists("DocType", row["link_to"]):
			continue
		if row["type"] == "Report" and not frappe.db.exists("Report", row["link_to"]):
			continue
		if row["type"] == "Page" and not frappe.db.exists("Page", row["link_to"]):
			continue
		ws.append("shortcuts", row)

	ws.save(ignore_permissions=True)
	_sync_workspace_sidebar()
	frappe.clear_cache(doctype="Workspace")
	return {"status": "ok", "workspace": WORKSPACE_NAME}


def _sync_workspace_sidebar():
	sidebar_name = WORKSPACE_NAME
	if not frappe.db.exists("Workspace Sidebar", sidebar_name):
		return

	doc = frappe.get_doc("Workspace Sidebar", sidebar_name)
	doc.items = []
	for row in SIDEBAR_ITEMS:
		if row.get("link_type") == "DocType" and row.get("link_to") and not frappe.db.exists("DocType", row["link_to"]):
			continue
		if row.get("link_type") == "Report" and row.get("link_to") and not frappe.db.exists("Report", row["link_to"]):
			continue
		if row.get("link_type") == "Page" and row.get("link_to") and not frappe.db.exists("Page", row["link_to"]):
			continue
		doc.append("items", row)

	doc.save(ignore_permissions=True)


@frappe.whitelist()
def setup_ss_coil_workspace():
	sync_ss_coil_workspace()
	frappe.db.commit()
	return {"status": "ok"}
