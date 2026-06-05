frappe.listview_settings["Tag Registry"] = {
	add_fields: [
		"tag_no",
		"status",
		"sales_order",
		"item_code",
		"item_name",
		"parent_tag_no",
		"root_tag_no",
		"source_doctype",
		"source_docname",
		"current_doctype",
		"current_docname",
	],
	get_indicator(doc) {
		const status = doc.status || "Active";
		const tone = {
			Active: "green",
			Produced: "blue",
			Delivered: "orange",
			Invoiced: "purple",
			Cancelled: "red",
		}[status] || "gray";
		return [status, tone, `status,=,${status}`];
	},
	onload(listview) {
		if (!listview.page) return;

		listview.page.add_inner_button(__("Active"), () => {
			frappe.set_route("List", "Tag Registry", { status: "Active" });
		});

		listview.page.add_inner_button(__("Produced"), () => {
			frappe.set_route("List", "Tag Registry", { status: "Produced" });
		});

		listview.page.add_inner_button(__("Delivered"), () => {
			frappe.set_route("List", "Tag Registry", { status: "Delivered" });
		});

		listview.page.add_inner_button(__("Invoiced"), () => {
			frappe.set_route("List", "Tag Registry", { status: "Invoiced" });
		});
	},
	formatters: {
		tag_no(value) {
			return `<span style="font-weight:700; color:#16324f;">${frappe.utils.escape_html(value || "")}</span>`;
		},
		parent_tag_no(value) {
			return value
				? `<span style="display:inline-block;padding:2px 8px;border-radius:999px;background:#eef6ff;color:#1d4ed8;font-weight:600;">${frappe.utils.escape_html(value)}</span>`
				: "";
		},
		root_tag_no(value) {
			return value
				? `<span style="display:inline-block;padding:2px 8px;border-radius:999px;background:#f5f3ff;color:#7c3aed;font-weight:600;">${frappe.utils.escape_html(value)}</span>`
				: "";
		},
	},
};
