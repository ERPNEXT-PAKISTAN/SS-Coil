# Copyright (c) 2026, Taimoor and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.model.document import Document
from frappe.model.naming import getseries
from frappe.utils import now_datetime

# Each operation gets a distinct tabSeries key so its yearly sequence starts
# and advances independently, while the visible number keeps the suffix last.
SS_COIL_OPERATION_NAME_SUFFIXES = {
	"Slitter": "SL",
	"Leveler": "LV",
	"Reshearing": "RS",
}

# order_status values past which a document is considered locked - see
# validate() below. ARCHITECTURE.md > "SS Coil processing" documents why
# this is a lightweight validate-time lock rather than a full submittable
# workflow.
SS_COIL_LOCKED_STATUSES = ("Completed", "Closed")

class SSCoil(Document):
	def autoname(self):
		suffix = SS_COIL_OPERATION_NAME_SUFFIXES.get(self.operation, "SL")
		year = now_datetime().strftime("%y")
		sequence = getseries(f"JS-{year}-{suffix}-", 5)
		self.name = f"JS-{year}-{sequence}-{suffix}"

	def validate(self):
		if not self.get("order_status"):
			self.order_status = "Not Started"
		self._enforce_completed_lock()
		self._block_duplicate_active_entry()
		for idx, row in enumerate(self.cutting_detail or [], start=1):
			row.seq = idx

	def _block_duplicate_active_entry(self):
		# One SS Coil entry is allowed per production row and operation. This
		# also blocks re-creating an entry after it is completed; reopen the
		# existing document for corrections or continuation.
		if not self.is_new():
			return
		if self.get("allow_duplicate_process"):
			return
		if not self.sales_order_item or not self.operation:
			return
		if self.coil_production_line:
			context_filter = "ifnull(parent.coil_production_line, '') = %(coil_production_line)s"
			context = {"coil_production_line": self.coil_production_line}
		else:
			context_filter = "ifnull(parent.sales_order_item, '') = %(sales_order_item)s"
			context = {"sales_order_item": self.sales_order_item}
		existing = frappe.db.sql(
			f"""
			select parent.name, parent.order_status
			from `tabSS Coil` parent
			where {context_filter}
				and ifnull(parent.operation, '') = %(operation)s
				and parent.docstatus < 2
			limit 1
			""",
			{**context, "operation": self.operation},
			as_dict=True,
		)
		if not existing:
			return

		row = existing[0]
		frappe.throw(
			_(
				"An SS Coil entry for {0} already exists for this Sales Order Item: {1} (status: {2}). "
				"Open the existing entry. A Sales Order item can have only one SS Coil entry per process."
			).format(self.operation, frappe.utils.get_link_to_form("SS Coil", row.name), row.order_status)
		)

	def _enforce_completed_lock(self):
		if self.is_new():
			return
		if self.get("order_status") not in SS_COIL_LOCKED_STATUSES:
			return
		if "System Manager" in frappe.get_roles():
			return
		if self.get("process_control_enabled"):
			return

		previous_status = frappe.db.get_value(self.doctype, self.name, "order_status")
		if previous_status not in SS_COIL_LOCKED_STATUSES:
			# Transitioning into Completed/Closed in this very save - allow it.
			return

		frappe.throw(
			_(
				"This SS Coil is {0} and locked for further edits. "
				"Enable 'Process Control' (or ask a System Manager) to make changes."
			).format(previous_status)
		)
