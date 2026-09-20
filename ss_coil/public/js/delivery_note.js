frappe.ui.form.on("Delivery Note", {
	refresh(frm) {
		add_delivery_note_tag_buttons(frm);
		add_delivery_note_load_by_tag_button(frm);
	},
	customer(frm) {
		add_delivery_note_load_by_tag_button(frm);
	},
});

function add_delivery_note_tag_buttons(frm) {
	if (frm.is_new && frm.is_new()) return;
	if (!frm.doc.name) return;

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

function open_dn_tag_picker(frm) {
	if (!frm.doc.customer) {
		frappe.msgprint(__("Select Customer first, then load items by Tag No."));
		return;
	}

	const run = () => {
		ss_coil.delivery_by_tag.open_for_customer(frm.doc.customer, {
			company: frm.doc.company,
			target_doc: frm.doc,
			replace_items: 1,
			on_success(dn) {
				ss_coil.delivery_by_tag.apply_to_form(frm, dn);
			},
		});
	};

	if (ss_coil.delivery_by_tag && ss_coil.delivery_by_tag.open_for_customer) {
		run();
	} else {
		frappe.require("/assets/ss_coil/js/delivery_by_tag.js", run);
	}
}

function add_delivery_note_load_by_tag_button(frm) {
	if (cint(frm.doc.docstatus) !== 0) return;

	frm.add_custom_button(__("Load by Tag No"), () => open_dn_tag_picker(frm));
}
