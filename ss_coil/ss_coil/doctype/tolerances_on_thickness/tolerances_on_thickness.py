# Copyright (c) 2026, Taimoor and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.model.document import Document


class TolerancesonThickness(Document):
	def validate(self):
		seen = []
		for row in self.tolerance_details or []:
			if row.thickness_from in (None, ""):
				frappe.throw(_("Set the inclusive start of every thickness range."))
				continue
			if row.thickness_to not in (None, "", 0) and row.thickness_from >= row.thickness_to:
				frappe.throw(_("Thickness range start must be less than its exclusive end."))
			end = row.thickness_to if row.thickness_to not in (None, "", 0) else float("inf")
			for start, previous_end in seen:
				if row.thickness_from < previous_end and end > start:
					frappe.throw(_("Thickness ranges cannot overlap in one tolerance table."))
			seen.append((row.thickness_from, end))
