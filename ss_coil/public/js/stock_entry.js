frappe.ui.form.on("Stock Entry", {
	refresh(frm) {
		add_stock_entry_tag_buttons(frm);
		bind_live_stock_entry_dimension_events(frm);
		(frm.doc.items || []).forEach((row) => {
			set_stock_entry_dimension_from_values(row.doctype, row.name);
		});
	},
	onload(frm) {
		(frm.doc.items || []).forEach((row) => {
			set_stock_entry_dimension_from_values(row.doctype, row.name);
		});
	},
	validate(frm) {
		(frm.doc.items || []).forEach((row) => {
			set_stock_entry_dimension_from_values(row.doctype, row.name);
		});
	},
});

function add_stock_entry_tag_buttons(frm) {
	if (!frm.doc.name || (frm.is_new && frm.is_new())) return;

	const tags = [...new Set((frm.doc.items || []).map((row) => row.custom_tag_no).filter(Boolean))];
	if (!tags.length) return;

	frm.add_custom_button(__("Tag Registry"), function () {
		frappe.set_route("List", "Tag Registry", {
			current_docname: frm.doc.name,
		});
	}, __("Tags"));

	if (tags.length === 1) {
		frm.add_custom_button(__("Open Tag"), function () {
			frappe.set_route("Form", "Tag Registry", tags[0]);
		}, __("Tags"));
	} else {
		frm.add_custom_button(__("Open Item Tags"), function () {
			frappe.set_route("List", "Tag Registry", {
				current_docname: frm.doc.name,
			});
		}, __("Tags"));
	}
}

frappe.ui.form.on("Stock Entry Detail", {
	custom_thickness(frm, cdt, cdn) {
		set_stock_entry_dimension_from_values(cdt, cdn);
	},
	custom_width(frm, cdt, cdn) {
		set_stock_entry_dimension_from_values(cdt, cdn);
	},
	custom_length(frm, cdt, cdn) {
		set_stock_entry_dimension_from_values(cdt, cdn);
	},
	form_render(frm, cdt, cdn) {
		set_stock_entry_dimension_from_values(cdt, cdn);
	},
	item_code(frm, cdt, cdn) {
		set_stock_entry_dimension_from_values(cdt, cdn);
	},
});

function bind_live_stock_entry_dimension_events(frm) {
	const grid = frm.fields_dict.items && frm.fields_dict.items.grid;
	if (!grid || !grid.wrapper) return;

	const selector = [
		'[data-fieldname="custom_thickness"] input',
		'[data-fieldname="custom_width"] input',
		'[data-fieldname="custom_length"] input',
	].join(", ");

	grid.wrapper.off(".ss_coil_stock_dimension");
	grid.wrapper.on(
		"input.ss_coil_stock_dimension keyup.ss_coil_stock_dimension change.ss_coil_stock_dimension",
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

			const row = locals["Stock Entry Detail"] && locals["Stock Entry Detail"][row_name];
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

function set_stock_entry_dimension_from_values(cdt, cdn) {
	const row = locals[cdt] && locals[cdt][cdn];
	if (!row) return;

	const parts = [row.custom_thickness, row.custom_width, row.custom_length]
		.map((v) => (v === undefined || v === null ? "" : String(v).trim()))
		.filter((v) => v !== "");

	frappe.model.set_value(cdt, cdn, "custom_dimension", parts.join(" x "));
}
