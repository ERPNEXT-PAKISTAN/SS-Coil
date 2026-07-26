function add_ss_coil_sticker_print_button(frm) {
	if (!frm.doc.name || (frm.is_new && frm.is_new())) {
		return;
	}
	const tagged_rows = (frm.doc.job_output || []).filter((row) => row.tag_no);
	if (!tagged_rows.length) {
		return;
	}

	frm.add_custom_button(
		__("Print Stickers"),
		function () {
			show_ss_coil_sticker_print_dialog(frm);
		},
		__("Print")
	);
}

function show_ss_coil_sticker_print_dialog(frm) {
	const item_options = (frm.doc.job_output || [])
		.filter((row) => row.tag_no)
		.map((row, index) => ({
			label: [
				`${index + 1}.`,
				row.tag_no || __("Tag"),
				row.class || __("Class"),
				row.width ? `${row.width}` : "",
			]
				.filter(Boolean)
				.join(" | "),
			value: row.name,
			checked: true,
		}));

	if (!item_options.length) {
		frappe.msgprint(__("No output tags found on Job Output."));
		return;
	}

	const dialog = new frappe.ui.Dialog({
		title: __("Print Output Stickers"),
		fields: [
			{
				fieldtype: "Select",
				fieldname: "layout",
				label: __("Printer Type"),
				options: [
					{ value: "a4", label: __("A4 Sheet (3 × 2 in stickers)") },
					{ value: "thermal", label: __("Thermal / label printer (3 × 2 in)") },
				],
				default: "a4",
				reqd: 1,
			},
			{
				fieldtype: "MultiCheck",
				fieldname: "output_names",
				label: __("Select Output Tags"),
				options: item_options,
				columns: 1,
				select_all: true,
			},
		],
		primary_action_label: __("Print"),
		primary_action(values) {
			const multicheck = dialog.fields_dict.output_names;
			let output_names = multicheck ? multicheck.get_value() : values.output_names || [];
			if (typeof output_names === "string") {
				try {
					output_names = JSON.parse(output_names);
				} catch (e) {
					output_names = output_names ? [output_names] : [];
				}
			}
			output_names = (output_names || []).filter(Boolean);
			if (!output_names.length) {
				frappe.msgprint(__("Select at least one output tag to print."));
				return;
			}

			const print_format =
				values.layout === "thermal" ? "SS Coil Sticker Thermal" : "SS Coil Sticker";
			const settings = JSON.stringify({
				output_names,
				layout: values.layout,
			});
			const url =
				frappe.urllib.get_full_url(
					"/printview?doctype=" +
						encodeURIComponent(frm.doctype) +
						"&name=" +
						encodeURIComponent(frm.doc.name) +
						"&format=" +
						encodeURIComponent(print_format) +
						"&no_letterhead=1" +
						"&trigger_print=1" +
						"&settings=" +
						encodeURIComponent(settings) +
						"&_=" +
						Date.now()
				);

			const print_window = window.open(url);
			if (!print_window) {
				frappe.msgprint(__("Please enable pop-ups to print stickers."));
				return;
			}
			dialog.hide();
		},
	});
	dialog.show();
}

frappe.ui.form.on("SS Coil", {
	refresh(frm) {
		add_ss_coil_sticker_print_button(frm);
	},
});
