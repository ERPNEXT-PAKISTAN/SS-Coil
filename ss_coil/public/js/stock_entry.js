frappe.ui.form.on("Stock Entry", {
	refresh(frm) {
		add_stock_entry_data_entry_button(frm);
		add_stock_entry_sticker_print_button(frm);
		add_stock_entry_tag_buttons(frm);
		bind_live_stock_entry_dimension_events(frm);
		toggle_stock_entry_tag_fields(frm);
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
	purpose(frm) {
		toggle_stock_entry_tag_fields(frm);
	},
	stock_entry_type(frm) {
		toggle_stock_entry_tag_fields(frm);
	},
	custom_create_tag_numbers(frm) {
		toggle_stock_entry_tag_fields(frm);
	},
});

frappe.ui.form.on("Stock Entry Detail", {
	item_code(frm, cdt, cdn) {
		set_stock_entry_dimension_from_values(cdt, cdn);
		if (is_material_receipt_stock_entry(frm.doc)) {
			apply_inward_item_tag_default(frm, cdt, cdn);
		}
	},
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
	custom_create_tag_no(frm, cdt, cdn) {
		const row = locals[cdt][cdn];
		if (!is_material_receipt_stock_entry(frm.doc) && row.custom_create_tag_no) {
			frappe.show_alert({
				message: __("Tag creation is only available for Material Receipt Stock Entries."),
				indicator: "orange",
			});
			frappe.model.set_value(cdt, cdn, "custom_create_tag_no", 0);
			return;
		}
		if (!frm.doc.custom_create_tag_numbers && row.custom_create_tag_no) {
			frappe.show_alert({
				message: __("Enable 'Create Tag Numbers' on the Stock Entry first."),
				indicator: "orange",
			});
			frappe.model.set_value(cdt, cdn, "custom_create_tag_no", 0);
		}
	},
});

function is_material_receipt_stock_entry(doc) {
	return (doc.purpose || "") === "Material Receipt";
}

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

function toggle_stock_entry_tag_fields(frm) {
	const is_receipt = is_material_receipt_stock_entry(frm.doc);
	const enabled = is_receipt && !!frm.doc.custom_create_tag_numbers;

	if (frm.fields_dict.custom_create_tag_numbers) {
		frm.toggle_display("custom_create_tag_numbers", is_receipt);
	}

	const grid = frm.fields_dict.items && frm.fields_dict.items.grid;
	if (!grid) {
		return;
	}
	grid.toggle_enable("custom_create_tag_no", enabled);
	grid.toggle_display("custom_create_tag_no", is_receipt);
}

function add_stock_entry_data_entry_button(frm) {
	frm.add_custom_button(__("Data Entry"), function () {
		open_stock_entry_data_entry_dialog(frm);
	});
}

function open_stock_entry_data_entry_dialog(frm) {
	frappe.call({
		method: "ss_coil.stock_entry_data_entry.get_stock_entry_data_entry_meta",
		callback(r) {
			if (!r.message) return;
			show_stock_entry_data_entry_dialog(frm, r.message);
		},
	});
}

const STOCK_ENTRY_DATA_ENTRY_PARENT_GROUPS = [
	{
		label: "Document",
		fields: [
			"company",
			"stock_entry_type",
			"purpose",
			"custom_job_purpose",
			"posting_date",
			"posting_time",
			"custom_sales_order",
			"custom_mr_number",
		],
	},
	{
		label: "Customer & Warehouse",
		fields: [
			"custom_lot",
			"custom_create_tag_numbers",
			"custom_customer",
			"custom_for_customer",
			"custom_vehicle_no",
			"custom_driver_name",
			"custom_invoice__igp_no",
			"from_warehouse",
			"to_warehouse",
		],
	},
];

const STOCK_ENTRY_DATA_ENTRY_CHILD_GROUPS = [
	{ label: "Item", fields: ["item_code", "item_name", "qty", "uom"] },
	{
		label: "Identification",
		fields: ["custom_tag_no", "custom_ref_no", "custom_mill", "custom_location"],
	},
	{
		label: "Dimensions",
		fields: ["custom_thickness", "custom_width", "custom_length", "custom_dimension"],
	},
	{
		label: "References",
		fields: ["custom_js_number", "custom_hdgc_no", "custom_po_no", "custom_condition"],
	},
	{
		label: "Specification",
		fields: ["custom_commodity", "custom_specification", "custom_estimated_wt", "custom_qty_of_coil"],
	},
	{
		label: "Processing",
		fields: ["custom_slitter", "custom_leveler", "custom_reshearing", "custom_comments"],
	},
];

function show_stock_entry_data_entry_dialog(frm, meta) {
	const parent_field_map = {};
	(meta.parent_sections || []).forEach((section) => {
		(section.fields || []).forEach((df) => {
			parent_field_map[df.fieldname] = df;
		});
	});

	const state = {
		frm,
		meta,
		items: get_stock_entry_data_entry_initial_items(frm),
		item_cards: [],
	};

	const dialog = new frappe.ui.Dialog({
		title: __("Data Entry"),
		fields: [
			{
				fieldtype: "HTML",
				fieldname: "parent_container",
				options: `<div class="ss-coil-de-parent-block">
					<div class="ss-coil-de-block-title">${__("Stock Entry Details")}</div>
					<div class="ss-coil-de-parent-fields"></div>
				</div>`,
			},
			{
				fieldtype: "HTML",
				fieldname: "items_container",
				options: `<div class="ss-coil-de-items-block">
					<div class="ss-coil-de-block-title">
						<span>${__("Item Rows")}</span>
						<button type="button" class="btn btn-sm btn-secondary ss-coil-de-add-row">${__("Add Row")}</button>
					</div>
					<div class="ss-coil-de-item-list"></div>
				</div>`,
			},
		],
		primary_action_label: __("Save"),
		primary_action() {
			save_stock_entry_data_entry_from_dialog(state, dialog);
		},
	});

	state.parent_fg = new frappe.ui.FieldGroup({
		fields: build_stock_entry_data_entry_grouped_fields(
			STOCK_ENTRY_DATA_ENTRY_PARENT_GROUPS,
			parent_field_map
		),
		body: null,
		no_submit_on_enter: true,
	});

	apply_stock_entry_data_entry_dialog_layout(dialog);
	dialog.show();

	const $parent_body = dialog.$wrapper.find(".ss-coil-de-parent-fields");
	state.parent_fg.body = $parent_body.get(0);
	state.parent_fg.make();
	state.parent_fg.set_values(get_stock_entry_data_entry_parent_values(frm, meta));
	apply_stock_entry_data_entry_grid_layout($parent_body);

	const $list = dialog.$wrapper.find(".ss-coil-de-item-list");
	render_stock_entry_data_entry_item_cards(state, $list);

	dialog.$wrapper.find(".ss-coil-de-add-row").on("click", () => {
		const item = make_stock_entry_data_entry_item_row();
		state.items.push(item);
		append_stock_entry_data_entry_item_card(state, $list, item, state.items.length - 1);
	});

	state.dialog = dialog;
}

function build_stock_entry_data_entry_grouped_fields(groups, field_map) {
	const fields = [];
	groups.forEach((group) => {
		fields.push({
			fieldtype: "Section Break",
			fieldname: `section_${frappe.scrub(group.label)}`,
			label: __(group.label),
		});
		group.fields.forEach((fieldname) => {
			if (field_map[fieldname]) {
				fields.push(map_stock_entry_data_entry_field(field_map[fieldname]));
			}
		});
	});
	return fields;
}

function build_stock_entry_data_entry_child_grouped_fields(child_field_defs) {
	const field_map = {};
	child_field_defs.forEach((df) => {
		field_map[df.fieldname] = df;
	});
	return build_stock_entry_data_entry_grouped_fields(
		STOCK_ENTRY_DATA_ENTRY_CHILD_GROUPS,
		field_map
	);
}

function apply_stock_entry_data_entry_grid_layout($wrapper) {
	$wrapper.find(".section-body").addClass("ss-coil-de-grid-4");
}

function apply_stock_entry_data_entry_dialog_layout(dialog) {
	dialog.$wrapper.addClass("ss-coil-data-entry-dialog");
	const $modal_dialog = $(dialog.wrapper);
	$modal_dialog
		.addClass("ss-coil-data-entry-modal")
		.removeClass("modal-sm modal-lg modal-xl modal-dialog-centered");
	$modal_dialog.css({
		maxWidth: "96vw",
		width: "96vw",
		height: "96vh",
		maxHeight: "96vh",
		margin: "2vh auto",
	});
	dialog.$wrapper.css("padding", "0");
	dialog.$wrapper.find(".modal-content").css({
		height: "96vh",
		maxHeight: "96vh",
		display: "flex",
		flexDirection: "column",
	});
	dialog.$wrapper.find(".modal-body").css({
		flex: "1",
		overflowY: "auto",
		maxHeight: "none",
	});
}

function save_stock_entry_data_entry_from_dialog(state, dialog) {
	const parent_data = state.parent_fg.get_values();
	if (!parent_data) return;

	const items = [];
	for (const card of state.item_cards) {
		const row_values = card.field_group.get_values();
		if (!row_values) return;
		Object.assign(card.item, row_values);
		update_stock_entry_data_entry_row_dimension(card.item);
		items.push({ ...card.item });
	}

	const payload = {
		...parent_data,
		items: apply_stock_entry_data_entry_parent_to_items(parent_data, items),
	};

	save_stock_entry_data_entry(state.frm, payload, dialog);
}

function update_stock_entry_data_entry_row_dimension(row) {
	const parts = [row.custom_thickness, row.custom_width, row.custom_length]
		.map((value) => (value === undefined || value === null ? "" : String(value).trim()))
		.filter(Boolean);
	row.custom_dimension = parts.join(" x ");
}

function map_stock_entry_data_entry_field(df) {
	const field = {
		fieldtype: df.fieldtype,
		fieldname: df.fieldname,
		label: __(df.label),
		options: df.options,
		reqd: df.reqd,
		read_only: df.read_only,
		default: df.default,
		depends_on: df.depends_on,
	};
	if (df.fieldname === "custom_dimension") {
		field.read_only = 1;
	}
	return field;
}

function apply_stock_entry_data_entry_parent_to_items(parent_data, items) {
	return (items || []).map((row) => ({
		...row,
		custom_for_customer: parent_data.custom_for_customer || "",
		s_warehouse: parent_data.from_warehouse || "",
		t_warehouse: parent_data.to_warehouse || "",
	}));
}

function make_stock_entry_data_entry_item_row(existing) {
	return (
		existing || {
			name: frappe.utils.get_random(10),
			doctype: "Stock Entry Detail",
			__islocal: 1,
		}
	);
}

function get_stock_entry_data_entry_initial_items(frm) {
	return (frm.doc.items || []).map((row) => {
		const item = { ...row };
		delete item.custom_for_customer;
		delete item.s_warehouse;
		delete item.t_warehouse;
		delete item.custom_create_tag_no;
		delete item.custom_remarks;
		return item;
	});
}

function get_stock_entry_data_entry_parent_values(frm, meta) {
	const values = {};
	(meta.parent_sections || []).forEach((section) => {
		(section.fields || []).forEach((df) => {
			values[df.fieldname] = frm.doc[df.fieldname];
		});
	});
	return values;
}

function render_stock_entry_data_entry_item_cards(state, $list) {
	$list.empty();
	state.item_cards = [];
	if (!state.items.length) {
		state.items.push(make_stock_entry_data_entry_item_row());
	}
	state.items.forEach((item, idx) => {
		append_stock_entry_data_entry_item_card(state, $list, item, idx);
	});
}

function append_stock_entry_data_entry_item_card(state, $list, item, idx) {
	const $card = $(`
		<div class="ss-coil-de-item-card" data-row-name="${item.name}">
			<div class="ss-coil-de-item-head">
				<span class="ss-coil-de-row-label">${__("Row {0}", [idx + 1])}${item.item_code ? ` — ${frappe.utils.escape_html(item.item_code)}` : ""}</span>
				<button type="button" class="btn btn-xs btn-default ss-coil-de-remove-row">${__("Remove")}</button>
			</div>
			<div class="ss-coil-de-item-body"></div>
		</div>
	`).appendTo($list);

	const field_group = new frappe.ui.FieldGroup({
		fields: build_stock_entry_data_entry_child_grouped_fields(state.meta.child_fields || []),
		body: $card.find(".ss-coil-de-item-body").get(0),
		no_submit_on_enter: true,
	});
	field_group.make();
	field_group.set_values(item);
	apply_stock_entry_data_entry_grid_layout($card.find(".ss-coil-de-item-body"));
	bind_stock_entry_data_entry_card_dimension(field_group, item);

	$card.find(".ss-coil-de-remove-row").on("click", () => {
		if (state.items.length <= 1) {
			frappe.msgprint(__("At least one item row is required."));
			return;
		}
		state.items = state.items.filter((row) => row.name !== item.name);
		state.item_cards = state.item_cards.filter((card) => card.item.name !== item.name);
		$card.remove();
		renumber_stock_entry_data_entry_item_cards($list);
	});

	state.item_cards.push({ item, field_group, $card });
}

function renumber_stock_entry_data_entry_item_cards($list) {
	$list.find(".ss-coil-de-item-card").each((idx, el) => {
		const $label = $(el).find(".ss-coil-de-row-label");
		const text = $label.text();
		const item_code = text.includes("—") ? text.split("—")[1].trim() : "";
		$label.text(`${__("Row {0}", [idx + 1])}${item_code ? ` — ${item_code}` : ""}`);
	});
}

function bind_stock_entry_data_entry_card_dimension(field_group, item) {
	const dimension_fields = ["custom_thickness", "custom_width", "custom_length"];
	const update_dimension = () => {
		dimension_fields.forEach((fieldname) => {
			const control = field_group.fields_dict[fieldname];
			if (control) {
				item[fieldname] = control.get_value();
			}
		});
		update_stock_entry_data_entry_row_dimension(item);
		const dimension_control = field_group.fields_dict.custom_dimension;
		if (dimension_control) {
			dimension_control.set_value(item.custom_dimension);
		}
	};

	dimension_fields.forEach((fieldname) => {
		const control = field_group.fields_dict[fieldname];
		if (!control || !control.$input) return;
		control.$input.on("change.ss_coil_de_dimension", update_dimension);
	});
}

function save_stock_entry_data_entry(frm, values, dialog) {
	const parent_data = {};
	Object.keys(values).forEach((key) => {
		if (key !== "items") {
			parent_data[key] = values[key];
		}
	});

	const payload = {
		...parent_data,
		items: apply_stock_entry_data_entry_parent_to_items(parent_data, values.items || []),
	};

	const close_data_entry = () => {
		if (dialog) {
			dialog.hide();
		}
	};

	if (frm.is_new()) {
		Object.keys(parent_data).forEach((key) => {
			frm.set_value(key, parent_data[key]);
		});
		(payload.items || []).forEach((row, index) => {
			const synced_row = apply_stock_entry_data_entry_parent_to_items(parent_data, [row])[0];
			if (frm.doc.items[index]) {
				Object.keys(synced_row).forEach((key) => {
					frappe.model.set_value(
						frm.doc.items[index].doctype,
						frm.doc.items[index].name,
						key,
						synced_row[key]
					);
				});
			} else {
				const child = frm.add_child("items");
				Object.keys(synced_row).forEach((key) => {
					frappe.model.set_value(child.doctype, child.name, key, synced_row[key]);
				});
			}
		});
		frm.refresh_field("items");
		close_data_entry();
		frappe.show_alert({
			message: __("Data applied to form. Save the Stock Entry to keep changes."),
			indicator: "green",
		});
		return;
	}

	frappe.call({
		method: "ss_coil.stock_entry_data_entry.save_stock_entry_data_entry",
		args: {
			stock_entry: frm.doc.name,
			data: payload,
		},
		freeze: true,
		freeze_message: __("Saving..."),
		callback() {
			close_data_entry();
			frm.reload_doc();
			frappe.show_alert({ message: __("Stock Entry updated"), indicator: "green" });
		},
	});
}

function add_stock_entry_sticker_print_button(frm) {
	if (!frm.doc.name || (frm.is_new && frm.is_new())) {
		return;
	}
	if (!(frm.doc.items || []).length) {
		return;
	}

	frm.add_custom_button(
		__("Print Stickers"),
		function () {
			show_stock_entry_sticker_print_dialog(frm);
		},
		__("Print")
	);
}

function show_stock_entry_sticker_print_dialog(frm) {
	const item_options = (frm.doc.items || []).map((row, index) => ({
		label: [
			`${index + 1}.`,
			row.item_code || __("Item"),
			row.custom_tag_no || "",
			row.custom_ref_no || "",
			row.qty ? `${row.qty}` : "",
		]
			.filter(Boolean)
			.join(" | "),
		value: row.name,
		checked: true,
	}));

	const dialog = new frappe.ui.Dialog({
		title: __("Print Stickers"),
		fields: [
			{
				fieldtype: "Select",
				fieldname: "layout",
				label: __("Printer Type"),
				options: [
					{ value: "a4", label: __("A4 Sheet") },
					{ value: "thermal", label: __("Thermal Printer") },
				],
				default: "a4",
				reqd: 1,
			},
			{
				fieldtype: "MultiCheck",
				fieldname: "item_names",
				label: __("Select Item Rows"),
				options: item_options,
				columns: 1,
				select_all: true,
			},
		],
		primary_action_label: __("Print"),
		primary_action(values) {
			const multicheck = dialog.fields_dict.item_names;
			let item_names = multicheck ? multicheck.get_value() : values.item_names || [];
			if (typeof item_names === "string") {
				try {
					item_names = JSON.parse(item_names);
				} catch (e) {
					item_names = item_names ? [item_names] : [];
				}
			}
			item_names = (item_names || []).filter(Boolean);
			if (!item_names.length) {
				frappe.msgprint(__("Select at least one item row to print."));
				return;
			}

			const print_format =
				values.layout === "thermal" ? "Stock Entry Sticker Thermal" : "Stock Entry Sticker";
			const settings = JSON.stringify({
				item_names,
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
						encodeURIComponent(settings)
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
