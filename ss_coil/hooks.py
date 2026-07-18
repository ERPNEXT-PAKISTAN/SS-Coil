# This file wires up everything: which doc_events call which api.py
# functions, which JS/CSS loads on which doctype, print hooks, fixtures.
# Read this top-to-bottom to see what's connected before changing api.py -
# see ARCHITECTURE.md at the app root for the "why" behind each flow.

app_name = "ss_coil"
app_title = "SS Coil"
app_publisher = "Taimoor"
app_description = "Silver Sheet Coil"
app_email = "taimoor986@gmail.com"
app_license = "mit"
app_logo_url = "/assets/ss_coil/images/ss-coil-logo.svg"
app_home = "/app/ss-coil-space"

fixtures = [
	{
		"dt": "Custom Field",
		"filters": [["dt", "in", ["SS Coil", "Coil Output", "Coil Input", "Cutting Scheme", "Cutting Scheme SO", "Coil SO", "For Customer", "Sales Order", "Sales Order Item", "Stock Entry", "Stock Entry Detail", "Delivery Note Item", "Sales Invoice Item", "Purchase Receipt Item", "Purchase Invoice Item", "Expense Claim", "Journal Entry", "Payment Entry", "Purchase Order", "Purchase Receipt", "Purchase Invoice", "Item"]]],
	},
	{
		"dt": "Property Setter",
		"filters": [["doc_type", "in", ["SS Coil", "Coil Output", "Coil Input", "Cutting Scheme", "Cutting Scheme SO", "Coil SO", "For Customer", "Sales Order", "Sales Order Item", "Stock Entry", "Stock Entry Detail", "Delivery Note Item", "Sales Invoice Item", "Purchase Receipt Item", "Purchase Invoice Item", "Expense Claim", "Journal Entry", "Payment Entry", "Purchase Order", "Purchase Receipt", "Purchase Invoice"]]],
	},
	{
		"dt": "Client Script",
		"filters": [["dt", "in", ["SS Coil", "Coil Output", "Coil Input", "Cutting Scheme", "Cutting Scheme SO", "Coil SO", "For Customer", "Sales Order", "Stock Entry"]]],
	},
	{
		"dt": "Server Script",
		"filters": [["reference_doctype", "in", ["SS Coil", "Coil Output", "Coil Input", "Cutting Scheme", "Cutting Scheme SO", "Coil SO", "For Customer", "Stock Entry", "Stock Entry Detail"]]],
	},
]

# Apps
# ------------------

# required_apps = []

# Each item in the list will be shown as an app in the apps page
add_to_apps_screen = [
	{
		"name": "ss_coil",
		"logo": app_logo_url,
		"title": app_title,
		"route": app_home,
	}
]

# Includes in <head>
# ------------------

# include js, css files in header of desk.html
app_include_css = "/assets/ss_coil/css/stock_entry_data_entry.css?v=8"
# app_include_js = "/assets/ss_coil/js/ss_coil.js"

# include js, css files in header of web template
# web_include_css = "/assets/ss_coil/css/ss_coil.css"
# web_include_js = "/assets/ss_coil/js/ss_coil.js"

# include custom scss in every website theme (without file extension ".scss")
# website_theme_scss = "ss_coil/public/scss/website"

# include js, css files in header of web form
# webform_include_js = {"doctype": "public/js/doctype.js"}
# webform_include_css = {"doctype": "public/css/doctype.css"}

# include js in page
# page_js = {"page" : "public/js/file.js"}

# include js in doctype views
doctype_js = {
	"Sales Order": ["public/js/sales_order.js", "public/js/sales_order_manufacture.js"],
	"Stock Entry": "public/js/stock_entry.js",
	"Delivery Note": "public/js/delivery_note.js",
	"Sales Invoice": "public/js/sales_invoice.js",
	"Purchase Receipt": "public/js/purchase_receipt.js",
	"Purchase Invoice": "public/js/purchase_invoice.js",
	"Tag Registry": "ss_coil/doctype/tag_registry/tag_registry.js",
	"Production Plan": "public/js/production_plan.js",
}

doctype_list_js = {
	"Tag Registry": "public/js/tag_registry_list.js",
}

doc_events = {
	"Sales Order": {
		"before_validate": [
			"ss_coil.api.sync_sales_order_item_dimensions",
		],
		"before_save": [
			"ss_coil.api.sync_sales_order_item_dimensions",
			"ss_coil.api.assign_sales_order_item_tags",
			"ss_coil.api.sync_stock_entry_sales_order_links",
		],
		"after_insert": "ss_coil.api.sync_sales_order_item_tag_registry",
		"on_update": "ss_coil.api.sync_sales_order_item_tag_registry",
	},
	"SS Coil": {
		# prepare_ss_coil_output_tags/sync_ss_coil_process_tracking used to be
		# wired on before_validate AND before_save AND after_insert AND
		# on_update AND on_submit/on_cancel - up to 6 calls per single save,
		# 4 of them exact duplicates (before_validate always fires
		# immediately before before_save in the same request) and 2 dead
		# (SS Coil isn't submittable, so on_submit/on_cancel never fire).
		#
		# before_validate: mutates the doc's own fields (job_output rows,
		# tag assignment) before the DB write - only needs to run once.
		#
		# on_update: sync_ss_coil_process_tracking also rolls up this SS
		# Coil's status onto its Sales Order Item via a query that only
		# finds already-committed documents (frappe.get_all("SS Coil", ...)
		# in _update_sales_order_item_process_status) - that rollup would be
		# stale-by-one-save if it only ran pre-commit, so it genuinely needs
		# a second, post-commit run. on_update alone covers both insert and
		# update (Frappe fires on_update on both), so after_insert is
		# redundant on top of it.
		"before_validate": [
			"ss_coil.api.prepare_ss_coil_output_tags",
			"ss_coil.api.sync_ss_coil_process_tracking",
		],
		"on_update": "ss_coil.api.sync_ss_coil_process_tracking",
	},
	"Stock Entry": {
		"before_validate": "ss_coil.api.prepare_stock_entry_links",
		"before_save": "ss_coil.api.prepare_stock_entry_links",
		"before_print": "ss_coil.api.prepare_stock_entry_sticker_print",
	},
	"Delivery Note": {"before_validate": "ss_coil.api.assign_delivery_note_item_tags"},
	"Sales Invoice": {"before_validate": "ss_coil.api.assign_sales_invoice_item_tags"},
	"Expense Claim": {"before_validate": "ss_coil.api.populate_custom_sales_order", "before_save": "ss_coil.api.populate_custom_sales_order"},
	"Journal Entry": {"before_validate": "ss_coil.api.populate_custom_sales_order", "before_save": "ss_coil.api.populate_custom_sales_order"},
	"Payment Entry": {"before_validate": "ss_coil.api.populate_custom_sales_order", "before_save": "ss_coil.api.populate_custom_sales_order"},
	"Purchase Order": {"before_validate": "ss_coil.api.populate_custom_sales_order", "before_save": "ss_coil.api.populate_custom_sales_order"},
	"Purchase Receipt": {"before_validate": "ss_coil.api.prepare_purchase_receipt_links", "before_save": "ss_coil.api.prepare_purchase_receipt_links"},
	"Purchase Invoice": {"before_validate": "ss_coil.api.prepare_purchase_invoice_links", "before_save": "ss_coil.api.prepare_purchase_invoice_links"},
}
# doctype_list_js = {"doctype" : "public/js/doctype_list.js"}
# doctype_tree_js = {"doctype" : "public/js/doctype_tree.js"}
# doctype_calendar_js = {"doctype" : "public/js/doctype_calendar.js"}

# Svg Icons
# ------------------
# include app icons in desk
# app_include_icons = "ss_coil/public/icons.svg"

# Home Pages
# ----------

# application home page (will override Website Settings)
# home_page = "login"

# website user home page (by Role)
# role_home_page = {
# 	"Role": "home_page"
# }

# Generators
# ----------

# automatically create page for each record of this doctype
# website_generators = ["Web Page"]

# automatically load and sync documents of this doctype from downstream apps
# importable_doctypes = [doctype_1]

# Jinja
# ----------

jinja = {
	"methods": [
		"ss_coil.jinja_methods",
	],
}

pdf_body_html = "ss_coil.print_utils.pdf_body_html"

# Installation
# ------------

# before_install = "ss_coil.install.before_install"
after_install = "ss_coil.install.after_install"
after_migrate = "ss_coil.install.after_migrate"

# Uninstallation
# ------------

# before_uninstall = "ss_coil.uninstall.before_uninstall"
# after_uninstall = "ss_coil.uninstall.after_uninstall"

# Integration Setup
# ------------------
# To set up dependencies/integrations with other apps
# Name of the app being installed is passed as an argument

# before_app_install = "ss_coil.utils.before_app_install"
# after_app_install = "ss_coil.utils.after_app_install"

# Integration Cleanup
# -------------------
# To clean up dependencies/integrations with other apps
# Name of the app being uninstalled is passed as an argument

# before_app_uninstall = "ss_coil.utils.before_app_uninstall"
# after_app_uninstall = "ss_coil.utils.after_app_uninstall"

# Build
# ------------------
# To hook into the build process

# after_build = "ss_coil.build.after_build"

# Desk Notifications
# ------------------
# See frappe.core.notifications.get_notification_config

# notification_config = "ss_coil.notifications.get_notification_config"

# Permissions
# -----------
# Permissions evaluated in scripted ways

# permission_query_conditions = {
# 	"Event": "frappe.desk.doctype.event.event.get_permission_query_conditions",
# }
#
# has_permission = {
# 	"Event": "frappe.desk.doctype.event.event.has_permission",
# }

# Document Events
# ---------------
# Hook on document methods and events

# doc_events = {
# 	"*": {
# 		"on_update": "method",
# 		"on_cancel": "method",
# 		"on_trash": "method"
# 	}
# }

# Scheduled Tasks
# ---------------

# scheduler_events = {
# 	"all": [
# 		"ss_coil.tasks.all"
# 	],
# 	"daily": [
# 		"ss_coil.tasks.daily"
# 	],
# 	"hourly": [
# 		"ss_coil.tasks.hourly"
# 	],
# 	"weekly": [
# 		"ss_coil.tasks.weekly"
# 	],
# 	"monthly": [
# 		"ss_coil.tasks.monthly"
# 	],
# }

# Testing
# -------

# before_tests = "ss_coil.install.before_tests"

# Extend DocType Class
# ------------------------------
#
# Specify custom mixins to extend the standard doctype controller.
# extend_doctype_class = {
# 	"Task": "ss_coil.custom.task.CustomTaskMixin"
# }

# Overriding Methods
# ------------------------------
#
# override_whitelisted_methods = {
# 	"frappe.desk.doctype.event.event.get_events": "ss_coil.event.get_events"
# }
#
# each overriding function accepts a `data` argument;
# generated from the base implementation of the doctype dashboard,
# along with any modifications made in other Frappe apps
# override_doctype_dashboards = {
# 	"Task": "ss_coil.task.get_dashboard_data"
# }

# exempt linked doctypes from being automatically cancelled
#
# auto_cancel_exempted_doctypes = ["Auto Repeat"]

# Ignore links to specified DocTypes when deleting documents
# -----------------------------------------------------------

# ignore_links_on_delete = ["Communication", "ToDo"]

# Request Events
# ----------------
# before_request = ["ss_coil.utils.before_request"]
# after_request = ["ss_coil.utils.after_request"]

# Job Events
# ----------
# before_job = ["ss_coil.utils.before_job"]
# after_job = ["ss_coil.utils.after_job"]

# User Data Protection
# --------------------

# user_data_fields = [
# 	{
# 		"doctype": "{doctype_1}",
# 		"filter_by": "{filter_by}",
# 		"redact_fields": ["{field_1}", "{field_2}"],
# 		"partial": 1,
# 	},
# 	{
# 		"doctype": "{doctype_2}",
# 		"filter_by": "{filter_by}",
# 		"partial": 1,
# 	},
# 	{
# 		"doctype": "{doctype_3}",
# 		"strict": False,
# 	},
# 	{
# 		"doctype": "{doctype_4}"
# 	}
# ]

# Authentication and authorization
# --------------------------------

# auth_hooks = [
# 	"ss_coil.auth.validate"
# ]

# Automatically update python controller files with type annotations for this app.
# export_python_type_annotations = True

# default_log_clearing_doctypes = {
# 	"Logging DocType Name": 30  # days to retain logs
# }

# Translation
# ------------
# List of apps whose translatable strings should be excluded from this app's translations.
# ignore_translatable_strings_from = []
