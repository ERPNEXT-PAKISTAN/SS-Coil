frappe.query_reports["Tag Registry Trace"] = {
	filters: [
		{
			fieldname: "sales_order",
			label: __("Sales Order"),
			fieldtype: "Link",
			options: "Sales Order",
		},
		{
			fieldname: "root_tag_no",
			label: __("Root Tag No"),
			fieldtype: "Data",
		},
		{
			fieldname: "tag_no",
			label: __("Tag No"),
			fieldtype: "Data",
		},
		{
			fieldname: "status",
			label: __("Status"),
			fieldtype: "Select",
			options: "\nActive\nProduced\nDelivered\nInvoiced\nLinked\nCancelled",
		},
	],
	formatter(value, row, column, data, default_formatter) {
		value = default_formatter(value, row, column, data);
		if (column.fieldname === "tree_label" && data && data.parent_tag_no) {
			return `<span style="padding-left:12px;">${value || ""}</span>`;
		}
		return value;
	},
};
