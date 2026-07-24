// Stock Entry form JS: the custom "Data Entry" bulk-item dialog, sticker
// print dialog, coil dimension auto-calc, and tag registry buttons.
// See ARCHITECTURE.md ("Data Entry dialog" / "Sticker printing" sections)
// at the app root before changing the dialog logic below - two easy-to-miss
// gotchas are documented there: the __islocal fake-name issue on save, and
// the parent/child field lists needing to stay in sync with
// stock_entry_data_entry.py's meta endpoint.

frappe.ui.form.on("Stock Entry", {
	refresh(frm) {
		ensure_inward_tag_batch_dialog_suppressed();
		add_stock_entry_data_entry_button(frm);
		add_stock_entry_sticker_print_button(frm);
		frappe.require("/assets/ss_coil/js/coil_detail_print.js", () => {
			add_coil_detail_print_button(frm);
		});
		add_stock_entry_create_sales_order_button(frm);
		add_stock_entry_tag_buttons(frm);
		bind_live_stock_entry_dimension_events(frm);
		toggle_stock_entry_tag_fields(frm);
		setup_finish_good_item_query(frm);
		(frm.doc.items || []).forEach((row) => {
			set_stock_entry_dimension_from_values(row.doctype, row.name);
		});
	},
	onload(frm) {
		ensure_inward_tag_batch_dialog_suppressed();
		setup_finish_good_item_query(frm);
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

function setup_finish_good_item_query(frm) {
	frm.set_query("custom_finish_good_item", "items", () => ({
		filters: {
			disabled: 0,
			is_sales_item: 1,
			custom_ss_coil_item_type: ["in", ["Finished Good", "Semi Finished"]],
		},
	}));
}

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

let inward_tag_batch_dialog_wrapped = false;

function ensure_inward_tag_batch_dialog_suppressed() {
	if (inward_tag_batch_dialog_wrapped || !erpnext.stock || !erpnext.stock.select_batch_and_serial_no) {
		return;
	}

	const original = erpnext.stock.select_batch_and_serial_no;
	erpnext.stock.select_batch_and_serial_no = function (frm, item) {
		if (!item || !item.item_code) {
			return original(frm, item);
		}

		frappe.db
			.get_value("Item", item.item_code, [
				"has_batch_no",
				"custom_use_tag_as_batch_no",
				"custom_create_tag_on_receipt",
			])
			.then((r) => {
				if (should_skip_inward_tag_batch_dialog(frm, item, r.message || {})) {
					frappe.flags.dialog_set = false;
					return;
				}
				original(frm, item);
			});
	};

	inward_tag_batch_dialog_wrapped = true;
}

function should_skip_inward_tag_batch_dialog(frm, item, item_flags) {
	if (!is_material_receipt_stock_entry(frm.doc)) {
		return false;
	}
	if (item.serial_and_batch_bundle || item.batch_no) {
		return true;
	}
	if (!item_flags.has_batch_no) {
		return false;
	}
	if (cint(item_flags.custom_use_tag_as_batch_no) === 0) {
		return false;
	}
	const tag_on_save =
		!!frm.doc.custom_create_tag_numbers &&
		(!!item.custom_create_tag_no || !!cint(item_flags.custom_create_tag_on_receipt));
	return tag_on_save;
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

function add_stock_entry_create_sales_order_button(frm) {
	if (frm.is_new() || !(frm.doc.items || []).length) return;

	frm.add_custom_button(
		__("Create Sales Order"),
		function () {
			frappe.model.open_mapped_doc({
				method: "ss_coil.api.create_sales_order_from_stock_entry",
				frm: frm,
			});
		},
		__("Create")
	);

	if (frm.fields_dict.custom_linked_sales_orders) {
		frm.add_custom_button(
			__("Sync Sales Orders"),
			function () {
				frappe.call({
					method: "ss_coil.api.sync_stock_entry_links_from_source",
					args: { stock_entry: frm.doc.name },
					freeze: true,
					freeze_message: __("Syncing..."),
					callback(r) {
						// Already persisted server-side via frappe.db.set_value; just
						// reflect it locally without marking the form dirty.
						frm.doc.custom_linked_sales_orders = (r.message || {}).custom_linked_sales_orders || "";
						frm.refresh_field("custom_linked_sales_orders");
						frappe.show_alert({ message: __("Sales Order links synced"), indicator: "green" });
					},
				});
			},
			__("Sync")
		);
	}
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

const STOCK_ENTRY_DATA_ENTRY_PARENT_FIELDS = [
	"company",
	"stock_entry_type",
	"purpose",
	"custom_job_purpose",
	"posting_date",
	"custom_sales_order",
	"custom_mr_number",
	"custom_customer",
	"custom_for_customer",
	"custom_create_tag_numbers",
];

const STOCK_ENTRY_DATA_ENTRY_CHILD_GROUPS = [
	{ label: "Item", fields: ["item_code", "qty"] },
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
		fields: ["custom_js_number", "custom_hdgc_no", "custom_condition"],
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
		item_rows: [],
	};

	const dialog = new frappe.ui.Dialog({
		title: __("Data Entry"),
		fields: [
			{
				fieldtype: "HTML",
				fieldname: "parent_container",
				options: `<div class="ss-coil-de-parent-block">
					<div class="ss-coil-de-block-title">
						<span class="ss-coil-de-block-icon">${frappe.utils.icon("file", "sm")}</span>
						<span>${__("Stock Entry Details")}</span>
					</div>
					<div class="ss-coil-de-parent-fields"></div>
				</div>`,
			},
			{
				fieldtype: "HTML",
				fieldname: "items_container",
				options: `<div class="ss-coil-de-items-block">
					<div class="ss-coil-de-block-title">
						<span class="ss-coil-de-block-title-text">
							<span class="ss-coil-de-block-icon">${frappe.utils.icon("stock", "sm")}</span>
							<span>${__("Item Rows")}</span>
							<span class="ss-coil-de-row-count badge">0</span>
						</span>
						<button type="button" class="btn btn-sm btn-primary ss-coil-de-add-row">
							${frappe.utils.icon("add", "xs")} ${__("Add Row")}
						</button>
					</div>
					<div class="ss-coil-de-table-wrap">
						<table class="ss-coil-de-table">
							<thead></thead>
							<tbody></tbody>
						</table>
					</div>
				</div>`,
			},
		],
		primary_action_label: __("Save"),
		primary_action() {
			save_stock_entry_data_entry_from_dialog(state, dialog);
		},
	});

	state.parent_fg = new frappe.ui.FieldGroup({
		fields: build_stock_entry_data_entry_flat_fields(
			STOCK_ENTRY_DATA_ENTRY_PARENT_FIELDS,
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
	Object.values(state.parent_fg.fields_dict || {}).forEach(relocate_stock_entry_data_entry_dropdown);

	state.child_columns = build_stock_entry_data_entry_child_columns(state.meta.child_fields || []);
	const $table = dialog.$wrapper.find(".ss-coil-de-table");
	render_stock_entry_data_entry_table_head(state, $table.find("thead"));
	render_stock_entry_data_entry_item_rows(state, $table.find("tbody"));
	update_stock_entry_data_entry_row_count(dialog, state);

	dialog.$wrapper.find(".ss-coil-de-add-row").on("click", () => {
		const item = make_stock_entry_data_entry_item_row();
		state.items.push(item);
		append_stock_entry_data_entry_item_row(state, $table.find("tbody"), item, state.items.length - 1);
		update_stock_entry_data_entry_row_count(dialog, state);
		const $wrap = dialog.$wrapper.find(".ss-coil-de-table-wrap");
		$wrap.scrollTop($wrap[0].scrollHeight);
	});

	state.dialog = dialog;
}

function update_stock_entry_data_entry_row_count(dialog, state) {
	dialog.$wrapper.find(".ss-coil-de-row-count").text(state.items.length);
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

function build_stock_entry_data_entry_flat_fields(fieldnames, field_map) {
	const fields = [
		{ fieldtype: "Section Break", fieldname: "section_stock_entry_details" },
	];
	fieldnames.forEach((fieldname) => {
		if (field_map[fieldname]) {
			fields.push(map_stock_entry_data_entry_field(field_map[fieldname]));
		}
	});
	return fields;
}

function relocate_stock_entry_data_entry_dropdown(control) {
	if (!control || !control.$input) return;

	const reposition = () => {
		const awesomplete = control.awesomplete;
		if (!awesomplete || !awesomplete.ul) return;
		const ul = awesomplete.ul;
		const rect = control.$input.get(0).getBoundingClientRect();
		ul.style.position = "fixed";
		ul.style.zIndex = 99999;
		ul.style.left = `${rect.left}px`;
		ul.style.top = `${rect.bottom + 2}px`;
		ul.style.width = `${rect.width}px`;
		ul.style.minWidth = `${Math.max(rect.width, 220)}px`;
	};

	control.$input.on("awesomplete-open input click focus", reposition);
}

function build_stock_entry_data_entry_child_columns(child_field_defs) {
	const field_map = {};
	child_field_defs.forEach((df) => {
		field_map[df.fieldname] = df;
	});
	const groups = [];
	STOCK_ENTRY_DATA_ENTRY_CHILD_GROUPS.forEach((group) => {
		const fields = group.fields.filter((fieldname) => field_map[fieldname]).map((fieldname) => field_map[fieldname]);
		if (fields.length) {
			groups.push({ label: group.label, fields });
		}
	});
	return groups;
}

function apply_stock_entry_data_entry_grid_layout($wrapper) {
	$wrapper.find(".form-column > form").addClass("ss-coil-de-grid-6");
}

function apply_stock_entry_data_entry_dialog_layout(dialog) {
	dialog.$wrapper.addClass("ss-coil-data-entry-dialog");

	const set_important = (el, styles) => {
		if (!el) return;
		Object.keys(styles).forEach((prop) => {
			el.style.setProperty(prop, styles[prop], "important");
		});
	};

	const apply = () => {
		const modal_dialog_el = dialog.$wrapper.find(".modal-dialog").get(0);
		set_important(modal_dialog_el, {
			"max-width": "96vw",
			width: "96vw",
			height: "96vh",
			"max-height": "96vh",
			margin: "2vh auto",
		});
		if (modal_dialog_el) {
			modal_dialog_el.classList.add("ss-coil-data-entry-modal");
			modal_dialog_el.classList.remove("modal-sm", "modal-lg", "modal-xl", "modal-dialog-centered");
		}
		set_important(dialog.$wrapper.get(0), { padding: "0" });
		set_important(dialog.$wrapper.find(".modal-content").get(0), {
			height: "96vh",
			"max-height": "96vh",
			display: "flex",
			"flex-direction": "column",
		});
		set_important(dialog.$wrapper.find(".modal-body").get(0), {
			flex: "1",
			"overflow-y": "auto",
			"max-height": "none",
		});
	};

	apply();
	dialog.$wrapper.on("shown.bs.modal", apply);
}

function save_stock_entry_data_entry_from_dialog(state, dialog) {
	const parent_data = state.parent_fg.get_values();
	if (!parent_data) return;

	const items = [];
	for (const row of state.item_rows) {
		Object.keys(row.controls).forEach((fieldname) => {
			row.item[fieldname] = row.controls[fieldname].get_value();
		});
		update_stock_entry_data_entry_row_dimension(row.item);
		const item_payload = { ...row.item };
		if (item_payload.__islocal) {
			// Rows added via "+ Add Row" carry a client-side placeholder name
			// (frappe.utils.get_random) that never matches a real doc row.
			// Sending it as-is makes the server think this is an update to an
			// existing row, find no match, and silently skip it. Drop the
			// fake name so the server correctly treats it as a new row.
			delete item_payload.name;
		}
		items.push(item_payload);
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
	return (items || []).map((row) => {
		const updated = { ...row };
		if (parent_data.custom_for_customer !== undefined) {
			updated.custom_for_customer = parent_data.custom_for_customer || "";
		}
		if (parent_data.from_warehouse !== undefined) {
			updated.s_warehouse = parent_data.from_warehouse || "";
		}
		if (parent_data.to_warehouse !== undefined) {
			updated.t_warehouse = parent_data.to_warehouse || "";
		}
		return updated;
	});
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

function render_stock_entry_data_entry_table_head(state, $thead) {
	const groups = state.child_columns;
	const $group_row = $('<tr class="ss-coil-de-group-row"></tr>');
	const $field_row = $('<tr class="ss-coil-de-field-row"></tr>');

	$group_row.append('<th class="ss-coil-de-col-index ss-coil-de-sticky"></th>');
	$field_row.append('<th class="ss-coil-de-col-index ss-coil-de-sticky">#</th>');

	groups.forEach((group) => {
		$group_row.append(
			`<th class="ss-coil-de-group-head" colspan="${group.fields.length}">${__(group.label)}</th>`
		);
		group.fields.forEach((df) => {
			$field_row.append(
				`<th data-fieldname="${df.fieldname}">${__(df.label)}${df.reqd ? '<span class="ss-coil-de-reqd">*</span>' : ""}</th>`
			);
		});
	});

	$group_row.append('<th class="ss-coil-de-col-action ss-coil-de-sticky-right"></th>');
	$field_row.append('<th class="ss-coil-de-col-action ss-coil-de-sticky-right"></th>');

	$thead.empty().append($group_row).append($field_row);
}

function render_stock_entry_data_entry_item_rows(state, $tbody) {
	$tbody.empty();
	state.item_rows = [];
	if (!state.items.length) {
		state.items.push(make_stock_entry_data_entry_item_row());
	}
	state.items.forEach((item, idx) => {
		append_stock_entry_data_entry_item_row(state, $tbody, item, idx);
	});
}

function append_stock_entry_data_entry_item_row(state, $tbody, item, idx) {
	const $tr = $(`<tr class="ss-coil-de-item-row" data-row-name="${item.name}"></tr>`).appendTo($tbody);
	$tr.append(`<td class="ss-coil-de-col-index ss-coil-de-sticky">${idx + 1}</td>`);

	const controls = {};
	const dimension_fields = ["custom_thickness", "custom_width", "custom_length"];

	state.child_columns.forEach((group) => {
		group.fields.forEach((df) => {
			const $td = $(`<td data-fieldname="${df.fieldname}"></td>`).appendTo($tr);
			const control = frappe.ui.form.make_control({
				df: {
					fieldtype: df.fieldtype,
					fieldname: df.fieldname,
					label: df.label,
					options: df.options,
					reqd: df.reqd,
					read_only: df.fieldname === "custom_dimension" ? 1 : df.read_only,
					depends_on: df.depends_on,
					onchange: () => {
						item[df.fieldname] = control.get_value();
						if (dimension_fields.includes(df.fieldname)) {
							update_row_dimension_control();
						}
					},
				},
				parent: $td.get(0),
				only_input: true,
				render_input: true,
			});
			control.refresh();
			control.set_value(item[df.fieldname]);
			relocate_stock_entry_data_entry_dropdown(control);
			controls[df.fieldname] = control;
		});
	});

	function update_row_dimension_control() {
		dimension_fields.forEach((fieldname) => {
			if (controls[fieldname]) {
				item[fieldname] = controls[fieldname].get_value();
			}
		});
		update_stock_entry_data_entry_row_dimension(item);
		if (controls.custom_dimension) {
			controls.custom_dimension.set_value(item.custom_dimension);
		}
	}

	const $remove_td = $('<td class="ss-coil-de-col-action ss-coil-de-sticky-right"></td>').appendTo($tr);
	const $remove_btn = $(
		`<button type="button" class="btn-reset ss-coil-de-remove-row" title="${__("Remove Row")}">${frappe.utils.icon("close", "sm")}</button>`
	).appendTo($remove_td);

	$remove_btn.on("click", () => {
		if (state.items.length <= 1) {
			frappe.msgprint(__("At least one item row is required."));
			return;
		}
		state.items = state.items.filter((row) => row.name !== item.name);
		state.item_rows = state.item_rows.filter((row) => row.item.name !== item.name);
		$tr.remove();
		renumber_stock_entry_data_entry_item_rows($tbody);
		update_stock_entry_data_entry_row_count(state.dialog, state);
	});

	state.item_rows.push({ item, controls, $tr });
}

function renumber_stock_entry_data_entry_item_rows($tbody) {
	$tbody.find(".ss-coil-de-item-row").each((idx, el) => {
		$(el).find(".ss-coil-de-col-index").text(idx + 1);
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
