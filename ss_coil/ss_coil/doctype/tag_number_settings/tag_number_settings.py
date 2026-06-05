from frappe.model.document import Document


class TagNumberSettings(Document):
	def validate(self):
		prefix = (self.prefix or "SSCC").strip()
		digits = int(self.digits or 5)
		next_number = int(self.next_number or 1)
		suffix = self.suffix or "-000"
		self.naming_preview = f"{prefix}-{next_number:0{digits}d}{suffix}"
