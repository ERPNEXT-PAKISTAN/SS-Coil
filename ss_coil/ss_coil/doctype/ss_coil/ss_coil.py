# Copyright (c) 2026, Taimoor and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.model.document import Document
from frappe.model.naming import _format_autoname

# The doctype JSON used a fixed "format:JS{YY}-.{#####}.-SL" autoname for
# every SS Coil document regardless of its actual Operation, so a Leveler or
# Reshearing document was still named like a Slitter one. Only three
# Operations exist in this system today (Slitter/Leveler/Reshearing) - keep
# "SL" as the fallback so any future/unmapped Operation still gets a name
# instead of erroring.
#
# Note: the counter (tabSeries) is keyed by the literal text *before* the
# "#####" placeholder ("JS26-", once {YY} is resolved) - the suffix after it
# doesn't affect the series key. So Slitter/Leveler/Reshearing all continue
# sharing one counter (JS26-00001, 00002, 00003...), they just get a
# different trailing suffix; existing numbering isn't disrupted or forked.
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

# order_status values that DON'T block a new document from being created for
# the same Sales Order Item + Operation + tag - see _block_duplicate_active_entry.
# "Stopped" deliberately still blocks: a stopped entry should be reopened
# (Resume, in the flow banner) rather than re-created from scratch.
SS_COIL_NON_BLOCKING_STATUSES = ("Completed", "Closed")


class SSCoil(Document):
	def autoname(self):
		# _format_autoname replicates the exact "format:" parsing the original
		# JSON autoname used (make_autoname alone rejects the {YY}/{#####}
		# brace syntax when not going through the "format:" prefix path).
		suffix = SS_COIL_OPERATION_NAME_SUFFIXES.get(self.operation, "SL")
		self.name = _format_autoname(f"format:JS{{YY}}-.{{#####}}.-{suffix}", self)

	def validate(self):
		if not self.get("order_status"):
			self.order_status = "Not Started"
		self._enforce_completed_lock()
		self._block_duplicate_active_entry()

	def _block_duplicate_active_entry(self):
		# Prevents the same Sales Order Item + Operation + coil tag from being
		# started twice (either by hand, picking the same Sales Order Item
		# again, or by re-running Create Next Process). create_next_ss_coil_entry
		# already skips (not errors) when it finds one of these, since that's
		# an automated chain call; this is the hard-stop for manual creation.
		if not self.is_new():
			return
		if not self.sales_order_item or not self.operation:
			return
		tag_no = None
		if self.input_coil:
			tag_no = self.input_coil[0].get("tag_no")
		if not tag_no:
			return

		existing = frappe.db.sql(
			"""
			select parent.name, parent.order_status
			from `tabCoil Input` child
			inner join `tabSS Coil` parent on parent.name = child.parent
			where child.tag_no = %(tag_no)s
				and ifnull(parent.sales_order_item, '') = %(sales_order_item)s
				and ifnull(parent.operation, '') = %(operation)s
				and ifnull(parent.order_status, '') not in %(non_blocking)s
			limit 1
			""",
			{
				"tag_no": tag_no,
				"sales_order_item": self.sales_order_item,
				"operation": self.operation,
				"non_blocking": SS_COIL_NON_BLOCKING_STATUSES,
			},
			as_dict=True,
		)
		if not existing:
			return

		row = existing[0]
		frappe.throw(
			_(
				"An active {0} entry already exists for this Sales Order Item: {1} (status: {2}). "
				"Open it and use Resume/Stop from its Process Flow instead of creating a new one, "
				"or complete/close it first."
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
