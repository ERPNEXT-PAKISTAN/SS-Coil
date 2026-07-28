# Copyright (c) 2026, Taimoor and contributors
# For license information, please see license.txt

from frappe.model.document import Document


class SOProductionPlan(Document):
	def validate(self):
		for row in self.cutting_scheme or []:
			if self.sales_order and not row.get("so_no"):
				row.so_no = self.sales_order
