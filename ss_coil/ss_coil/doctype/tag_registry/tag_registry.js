frappe.ui.form.on("Tag Registry", {
	refresh(frm) {
		if (!frm.doc.name || (frm.is_new && frm.is_new())) return;

		frm.add_custom_button(__("Trace Report"), function () {
			frappe.set_route("query-report", "Tag Registry Trace", {
				tag_no: frm.doc.tag_no,
			});
		}, __("Trace"));

		frm.add_custom_button(__("Print Trace"), function () {
			const url = `/printview?doctype=${encodeURIComponent("Tag Registry")}&name=${encodeURIComponent(frm.doc.name)}&format=${encodeURIComponent("Tag Trace")}&no_letterhead=0&trigger_print=1`;
			window.open(url, "_blank");
		}, __("Trace"));

		if (frm.doc.sales_order) {
			frm.add_custom_button(__("Sales Order"), function () {
				frappe.set_route("Form", "Sales Order", frm.doc.sales_order);
			}, __("Open"));
		}

		if (frm.doc.current_doctype && frm.doc.current_docname) {
			frm.add_custom_button(__("Current Document"), function () {
				frappe.set_route("Form", frm.doc.current_doctype, frm.doc.current_docname);
			}, __("Open"));
		}
	},
});
