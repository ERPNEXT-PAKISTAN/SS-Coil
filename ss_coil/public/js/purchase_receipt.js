frappe.ui.form.on("Purchase Receipt Item", {
	item_code(frm, cdt, cdn) {
		apply_inward_item_tag_default(frm, cdt, cdn);
		set_purchase_receipt_dimension_from_values(cdt, cdn);
	},
	custom_thickness(frm, cdt, cdn) {
		set_purchase_receipt_dimension_from_values(cdt, cdn);
	},
	custom_width(frm, cdt, cdn) {
		set_purchase_receipt_dimension_from_values(cdt, cdn);
	},
	custom_length(frm, cdt, cdn) {
		set_purchase_receipt_dimension_from_values(cdt, cdn);
	},
	form_render(frm, cdt, cdn) {
		set_purchase_receipt_dimension_from_values(cdt, cdn);
	},
	custom_create_tag_no(frm, cdt, cdn) {
		const row = locals[cdt][cdn];
		if (!row.custom_create_tag_no && !row.custom_tag_no) {
			return;
		}
		if (!frm.doc.custom_create_tag_numbers && row.custom_create_tag_no) {
			frappe.show_alert({
				message: __("Enable 'Create Tag Numbers' on the Purchase Receipt first."),
				indicator: "orange",
			});
			frappe.model.set_value(cdt, cdn, "custom_create_tag_no", 0);
		}
	},
});

function apply_inward_item_tag_default(frm, cdt, cdn) {
	const row = locals[cdt] && locals[cdt][cdn];
	if (!row || !row.item_code) return;

	frappe.db.get_value("Item", row.item_code, "custom_create_tag_on_receipt", (r) => {
		if (r && r.custom_create_tag_on_receipt) {
			frappe.model.set_value(cdt, cdn, "custom_create_tag_no", 1);
			if (!frm.doc.custom_create_tag_numbers) {
				frm.set_value("custom_create_tag_numbers", 1);
			}
		}
	});
}

frappe.ui.form.on("Purchase Receipt", {
	refresh(frm) {
		add_purchase_receipt_tag_buttons(frm);
		toggle_purchase_receipt_tag_fields(frm);
		bind_live_purchase_receipt_dimension_events(frm);
		(frm.doc.items || []).forEach((row) => {
			set_purchase_receipt_dimension_from_values(row.doctype, row.name);
		});
	},
	onload(frm) {
		(frm.doc.items || []).forEach((row) => {
			set_purchase_receipt_dimension_from_values(row.doctype, row.name);
		});
	},
	validate(frm) {
		(frm.doc.items || []).forEach((row) => {
			set_purchase_receipt_dimension_from_values(row.doctype, row.name);
		});
	},
	custom_create_tag_numbers(frm) {
		toggle_purchase_receipt_tag_fields(frm);
	},
});

function toggle_purchase_receipt_tag_fields(frm) {
	const enabled = !!frm.doc.custom_create_tag_numbers;
	const grid = frm.fields_dict.items && frm.fields_dict.items.grid;
	if (!grid) {
		return;
	}
	grid.toggle_enable("custom_create_tag_no", enabled);
	grid.toggle_display("custom_create_tag_no", enabled);
}

function add_purchase_receipt_tag_buttons(frm) {
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

function bind_live_purchase_receipt_dimension_events(frm) {
	const grid = frm.fields_dict.items && frm.fields_dict.items.grid;
	if (!grid || !grid.wrapper) return;

	const selector = [
		'[data-fieldname="custom_thickness"] input',
		'[data-fieldname="custom_width"] input',
		'[data-fieldname="custom_length"] input',
	].join(", ");

	grid.wrapper.off(".ss_coil_pr_dimension");
	grid.wrapper.on(
		"input.ss_coil_pr_dimension keyup.ss_coil_pr_dimension change.ss_coil_pr_dimension",
		selector,
		function () {
			let row_name =
				$(this).attr("data-name") || $(this).closest(".grid-row").attr("data-name");
			if (!row_name) {
				row_name = grid.get_selected_children()?.[0]?.name;
			}
			if (!row_name) {
				row_name = grid.grid_rows?.find((r) => r.row?.hasClass("grid-row-open"))?.doc?.name;
			}
			if (!row_name) return;

			const row = locals["Purchase Receipt Item"] && locals["Purchase Receipt Item"][row_name];
			if (!row) return;

			const $grid_row = $(this).closest(".grid-row");
			const $scope = $grid_row.length ? $grid_row : grid.wrapper;
			const typed_thickness =
				$scope.find('[data-name="' + row_name + '"] [data-fieldname="custom_thickness"] input').val() ??
				$scope.find('[data-fieldname="custom_thickness"] input').val() ??
				row.custom_thickness;
			const typed_width =
				$scope.find('[data-name="' + row_name + '"] [data-fieldname="custom_width"] input').val() ??
				$scope.find('[data-fieldname="custom_width"] input').val() ??
				row.custom_width;
			const typed_length =
				$scope.find('[data-name="' + row_name + '"] [data-fieldname="custom_length"] input').val() ??
				$scope.find('[data-fieldname="custom_length"] input').val() ??
				row.custom_length;

			const parts = [typed_thickness, typed_width, typed_length]
				.map((v) => (v === undefined || v === null ? "" : String(v).trim()))
				.filter((v) => v !== "");

			frappe.model.set_value(row.doctype, row.name, "custom_dimension", parts.join(" x "));
		},
	);
}

function set_purchase_receipt_dimension_from_values(cdt, cdn) {
	const row = locals[cdt] && locals[cdt][cdn];
	if (!row) return;

	const parts = [row.custom_thickness, row.custom_width, row.custom_length]
		.map((v) => (v === undefined || v === null ? "" : String(v).trim()))
		.filter((v) => v !== "");

	frappe.model.set_value(cdt, cdn, "custom_dimension", parts.join(" x "));
}
