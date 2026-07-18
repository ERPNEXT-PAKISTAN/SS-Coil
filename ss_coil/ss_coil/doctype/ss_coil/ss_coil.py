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


class SSCoil(Document):
	def autoname(self):
		# _format_autoname replicates the exact "format:" parsing the original
		# JSON autoname used (make_autoname alone rejects the {YY}/{#####}
		# brace syntax when not going through the "format:" prefix path).
		suffix = SS_COIL_OPERATION_NAME_SUFFIXES.get(self.operation, "SL")
		self.name = _format_autoname(f"format:JS{{YY}}-.{{#####}}.-{suffix}", self)

	def validate(self):
		self._enforce_completed_lock()

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
