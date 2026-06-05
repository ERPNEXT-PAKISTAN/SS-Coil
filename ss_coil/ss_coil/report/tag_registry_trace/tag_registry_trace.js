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
			options: "\nActive\nProduced\nDelivered\nInvoiced\nCancelled",
		},
	],
};
