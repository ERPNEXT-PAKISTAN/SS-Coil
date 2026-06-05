frappe.ui.form.on("Purchase Invoice", {
	refresh(frm) {
		add_purchase_invoice_tag_buttons(frm);
	},
});

function add_purchase_invoice_tag_buttons(frm) {
	if (!frm.doc.name || (frm.is_new && frm.is_new())) return;

	const tags = [...new Set((frm.doc.items || []).map((row) => row.custom_tag_no).filter(Boolean))];
	if (!tags.length) return;

	frm.add_custom_button(__("Tag Registry"), function () {
		frappe.set_route("List", "Tag Registry", { current_docname: frm.doc.name });
	}, __("Tags"));

	if (tags.length === 1) {
		frm.add_custom_button(__("Open Tag"), function () {
			frappe.set_route("Form", "Tag Registry", tags[0]);
		}, __("Tags"));
	} else {
		frm.add_custom_button(__("Open Item Tags"), function () {
			frappe.set_route("List", "Tag Registry", { current_docname: frm.doc.name });
		}, __("Tags"));
	}
}
