// Stock Entry form JS: the custom "Data Entry" bulk-item dialog, sticker
// print dialog, coil dimension auto-calc, and tag registry buttons.
// See ARCHITECTURE.md ("Data Entry dialog" / "Sticker printing" sections)
// at the app root before changing the dialog logic below - two easy-to-miss
// gotchas are documented there: the __islocal fake-name issue on save, and
// the parent/child field lists needing to stay in sync with
// stock_entry_data_entry.py's meta endpoint.

window.SS_COIL_DEFAULT_WAREHOUSE = window.SS_COIL_DEFAULT_WAREHOUSE || "Stores - SSC";
window.SS_COIL_DEFAULT_QTY_OF_COIL = window.SS_COIL_DEFAULT_QTY_OF_COIL || 1;
window.SS_COIL_DEFAULT_LENGTH_C = window.SS_COIL_DEFAULT_LENGTH_C || "C";

frappe.ui.form.on("Stock Entry", {
	setup(frm) {
		apply_ss_coil_stock_entry_header_defaults(frm);
	},
	refresh(frm) {
		ensure_inward_tag_batch_dialog_suppressed();
		add_stock_entry_data_entry_button(frm);
		maybe_open_stock_entry_data_entry_from_route(frm);
		add_stock_entry_sticker_print_button(frm);
		frappe.require("/assets/ss_coil/js/coil_detail_print.js", () => {
			add_coil_detail_print_button(frm);
		});
		if (typeof bind_ss_coil_entry_trace_formatters === "function") {
			bind_ss_coil_entry_trace_formatters(frm, "items");
		}
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
	items_add(frm, cdt, cdn) {
		apply_ss_coil_stock_entry_row_defaults(frm, cdt, cdn);
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
		apply_ss_coil_stock_entry_row_defaults(frm, cdt, cdn);
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
	custom_length_c(frm, cdt, cdn) {
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

function apply_ss_coil_stock_entry_header_defaults(frm) {
	if (!frm.is_new()) {
		return;
	}
	if (frm.fields_dict.from_warehouse && !frm.doc.from_warehouse) {
		frm.set_value("from_warehouse", SS_COIL_DEFAULT_WAREHOUSE);
	}
	if (frm.fields_dict.to_warehouse && !frm.doc.to_warehouse) {
		frm.set_value("to_warehouse", SS_COIL_DEFAULT_WAREHOUSE);
	}
}

function apply_ss_coil_stock_entry_row_defaults(frm, cdt, cdn) {
	const row = locals[cdt] && locals[cdt][cdn];
	if (!row) {
		return;
	}
	if (row.custom_qty_of_coil === undefined || row.custom_qty_of_coil === null || row.custom_qty_of_coil === "") {
		frappe.model.set_value(cdt, cdn, "custom_qty_of_coil", SS_COIL_DEFAULT_QTY_OF_COIL);
	}
	if (row.custom_length_c === undefined || row.custom_length_c === null || row.custom_length_c === "") {
		frappe.model.set_value(cdt, cdn, "custom_length_c", SS_COIL_DEFAULT_LENGTH_C);
		set_stock_entry_dimension_from_values(cdt, cdn);
	}
	if (is_material_receipt_stock_entry(frm.doc)) {
		if (!row.t_warehouse) {
			frappe.model.set_value(
				cdt,
				cdn,
				"t_warehouse",
				frm.doc.to_warehouse || SS_COIL_DEFAULT_WAREHOUSE
			);
		}
		return;
	}
	if (!row.s_warehouse) {
		frappe.model.set_value(
			cdt,
			cdn,
			"s_warehouse",
			frm.doc.from_warehouse || SS_COIL_DEFAULT_WAREHOUSE
		);
	}
	if (!row.t_warehouse) {
		frappe.model.set_value(
			cdt,
			cdn,
			"t_warehouse",
			frm.doc.to_warehouse || SS_COIL_DEFAULT_WAREHOUSE
		);
	}
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

function maybe_open_stock_entry_data_entry_from_route(frm) {
	if (!frappe.route_options || !frappe.route_options.ss_coil_open_data_entry) {
		return;
	}
	delete frappe.route_options.ss_coil_open_data_entry;
	setTimeout(() => open_stock_entry_data_entry_dialog(frm), 350);
}

function add_stock_entry_create_sales_order_button(frm) {
	if (frm.is_new() || !(frm.doc.items || []).length) return;

	frm.add_custom_button(
		__("Create Sales Order"),
		function () {
			frappe.call({
				method: "ss_coil.api.create_sales_order_from_stock_entry",
				args: { source_name: frm.doc.name },
				freeze: true,
				freeze_message: __("Preparing Sales Order..."),
				callback(r) {
					if (!r.message) return;
					const doc = r.message;
					doc.__ss_coil_from_stock_entry = frm.doc.name;
					frappe.model.with_doctype("Sales Order", () => {
						frappe.model.with_doctype("Sales Order Item", () => {
							frappe.model.with_doctype("Coil Production Line", () => {
								frappe.model.sync(doc);
								frappe.set_route("Form", "Sales Order", doc.name);
							});
						});
					});
				},
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
						const msg = r.message || {};
						if (frm.fields_dict.custom_linked_sales_orders) {
							frm.doc.custom_linked_sales_orders = msg.custom_linked_sales_orders || "";
							frm.refresh_field("custom_linked_sales_orders");
						}
						if (frm.fields_dict.custom_sales_order) {
							frm.doc.custom_sales_order = msg.custom_sales_order || "";
							frm.refresh_field("custom_sales_order");
						}
						if (frm.fields_dict.custom_invoice__igp_no && msg.custom_invoice__igp_no) {
							frm.doc.custom_invoice__igp_no = msg.custom_invoice__igp_no;
							frm.refresh_field("custom_invoice__igp_no");
						}
						const seUpdates = msg.stock_entry_updates || {};
						(frm.doc.items || []).forEach((row) => {
							const patch = seUpdates[row.name];
							if (!patch) return;
							Object.keys(patch).forEach((fieldname) => {
								row[fieldname] = patch[fieldname];
							});
						});
						if (Object.keys(seUpdates).length) {
							frm.refresh_field("items");
						}
						const updated = (msg.sales_orders_updated || []).length;
						const tagLines = Object.values(msg.item_updates_by_sales_order || {}).reduce(
							(n, rows) => n + Object.keys(rows || {}).length,
							0,
						);
						const prodLines = Object.values(msg.production_updates_by_sales_order || {}).reduce(
							(n, rows) => n + Object.keys(rows || {}).length,
							0,
						);
						let alert = __("Sales Order links synced");
						if (tagLines || prodLines) {
							alert = __("Sales Order coil/process fields synced ({0} item, {1} production)", [
								tagLines,
								prodLines,
							]);
						} else if (updated) {
							alert = __("Sales Order links synced ({0} order(s))", [updated]);
						}
						frappe.show_alert({ message: alert, indicator: "green" });
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
		fields: ["custom_thickness", "custom_width", "custom_length_c", "custom_length", "custom_dimension"],
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
		fields: ["custom_finish_good_item", "custom_slitter", "custom_leveler", "custom_reshearing", "custom_comments"],
	},
];

function get_stock_entry_data_entry_shell_html() {
	return `<div class="ss-coil-de-shell">
		<div class="ss-coil-de-parent-block">
			<div class="ss-coil-de-block-title">
				<span class="ss-coil-de-block-icon">${frappe.utils.icon("file", "sm")}</span>
				<span>${__("Stock Entry Details")}</span>
			</div>
			<div class="ss-coil-de-parent-fields"></div>
		</div>
		<div class="ss-coil-de-items-block">
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
		</div>
	</div>`;
}

function build_stock_entry_data_entry_state(frm, meta) {
	const parent_field_map = {};
	(meta.parent_sections || []).forEach((section) => {
		(section.fields || []).forEach((df) => {
			parent_field_map[df.fieldname] = df;
		});
	});

	return {
		frm,
		meta,
		items: get_stock_entry_data_entry_initial_items(frm),
		item_rows: [],
		parent_field_map,
	};
}

function normalize_stock_entry_date_value(value) {
	if (!value) return value;
	if (frappe.datetime.validate(value)) return value;
	const system = frappe.datetime.user_to_str(String(value), false);
	return frappe.datetime.validate(system) ? system : value;
}

function stock_entry_set_date_control_value(control, value) {
	const system = normalize_stock_entry_date_value(value);
	if (!control || !system || !control.$input) {
		return;
	}
	if (control.doc) {
		control.doc[control.df.fieldname] = system;
	}
	control.value = system;
	control.last_value = system;
	const display = control.format_for_input
		? control.format_for_input(system)
		: frappe.datetime.str_to_user(system, false, true);
	control.$input.val(display);
	if (control.datepicker) {
		const dateObj = frappe.datetime.str_to_obj(system);
		control.datepicker.date = dateObj;
		if (Array.isArray(control.datepicker.selectedDates)) {
			control.datepicker.selectedDates = [dateObj];
		}
	}
}

function apply_stock_entry_data_entry_parent_values(state, values) {
	if (ss_coil.flow_forms && ss_coil.flow_forms.set_parent_values) {
		ss_coil.flow_forms.set_parent_values(state.parent_fg, values);
		return;
	}
	if (!state.parent_fg || !values) return;

	const batch = {};
	Object.entries(values).forEach(([fieldname, value]) => {
		const control = state.parent_fg.fields_dict[fieldname];
		if (!control || value === undefined || value === null || value === "") {
			return;
		}
		if (control.df.fieldtype === "Date") {
			stock_entry_set_date_control_value(control, value);
			return;
		}
		batch[fieldname] = control.df.fieldtype === "Check" ? cint(value) : value;
	});

	if (Object.keys(batch).length) {
		state.parent_fg.set_values(batch);
	}
}

function setup_stock_entry_data_entry_ui(state, $root) {
	state.$root = $root;
	$root.html(get_stock_entry_data_entry_shell_html());

	state.parent_fg = new frappe.ui.FieldGroup({
		fields: build_stock_entry_data_entry_flat_fields(
			STOCK_ENTRY_DATA_ENTRY_PARENT_FIELDS,
			state.parent_field_map
		),
		body: null,
		no_submit_on_enter: true,
	});

	const $parent_body = $root.find(".ss-coil-de-parent-fields");
	state.parent_fg.body = $parent_body.get(0);
	state.parent_fg.make();
	apply_stock_entry_data_entry_parent_values(
		state,
		state.initial_parent_values || get_stock_entry_data_entry_parent_values(state.frm, state.meta)
	);
	if (state.mode === "flow_page" && !state.saved_name) {
		const control = state.parent_fg.fields_dict.posting_date;
		if (control) {
			stock_entry_set_date_control_value(control, frappe.datetime.get_today());
		}
	}
	apply_stock_entry_data_entry_grid_layout($parent_body);
	Object.values(state.parent_fg.fields_dict || {}).forEach(relocate_stock_entry_data_entry_dropdown);
	bind_stock_entry_data_entry_header_events(state);
	apply_stock_entry_data_entry_type_defaults(state);

	state.child_columns = build_stock_entry_data_entry_child_columns(state.meta.child_fields || []);
	const $table = $root.find(".ss-coil-de-table");
	render_stock_entry_data_entry_table_head(state, $table.find("thead"));
	render_stock_entry_data_entry_item_rows(state, $table.find("tbody"));
	update_stock_entry_data_entry_row_count(state);

	$root.find(".ss-coil-de-add-row").on("click", () => {
		const item = make_stock_entry_data_entry_item_row();
		state.items.push(item);
		append_stock_entry_data_entry_item_row(state, $table.find("tbody"), item, state.items.length - 1);
		update_stock_entry_data_entry_row_count(state);
		const $wrap = $root.find(".ss-coil-de-table-wrap");
		$wrap.scrollTop($wrap[0].scrollHeight);
	});
}

function show_stock_entry_data_entry_dialog(frm, meta) {
	const state = build_stock_entry_data_entry_state(frm, meta);

	const dialog = new frappe.ui.Dialog({
		title: __("Data Entry"),
		fields: [{ fieldtype: "HTML", fieldname: "data_entry_host", options: "<div></div>" }],
		primary_action_label: __("Save"),
		primary_action() {
			save_stock_entry_data_entry_from_dialog(state, dialog);
		},
	});

	apply_stock_entry_data_entry_dialog_layout(dialog);
	dialog.show();

	state.dialog = dialog;
	setup_stock_entry_data_entry_ui(state, dialog.$wrapper.find('[data-fieldname="data_entry_host"]'));
}

function update_stock_entry_data_entry_row_count(state) {
	const $root = state.$root || (state.dialog && state.dialog.$wrapper);
	if (!$root) return;
	$root.find(".ss-coil-de-row-count").text(state.items.length);
}

function is_material_receipt_stock_entry_type(value) {
	return (value || "") === "Material Receipt";
}

function apply_stock_entry_data_entry_type_defaults(state, opts = {}) {
	if (!state.parent_fg) {
		return;
	}
	const type_ctrl = state.parent_fg.fields_dict.stock_entry_type;
	const tag_ctrl = state.parent_fg.fields_dict.custom_create_tag_numbers;
	const purpose_ctrl = state.parent_fg.fields_dict.purpose;
	const type_val = (type_ctrl && type_ctrl.get_value()) || "";
	const is_receipt = is_material_receipt_stock_entry_type(type_val);

	if (tag_ctrl) {
		if (is_receipt) {
			tag_ctrl.set_value(1);
		} else if (opts.from_change) {
			tag_ctrl.set_value(0);
		}
	}

	if (!opts.from_change && state.saved_name) {
		return;
	}

	if (is_receipt && purpose_ctrl) {
		purpose_ctrl.set_value("Material Receipt");
		return;
	}
	if (type_val && purpose_ctrl) {
		frappe.db.get_value("Stock Entry Type", type_val, "purpose", (r) => {
			if (r && r.purpose) {
				purpose_ctrl.set_value(r.purpose);
			}
		});
	}
}

function bind_stock_entry_data_entry_header_events(state) {
	const type_ctrl = state.parent_fg && state.parent_fg.fields_dict.stock_entry_type;
	if (!type_ctrl) {
		return;
	}
	const original = type_ctrl.df.onchange;
	type_ctrl.df.onchange = function () {
		if (typeof original === "function") {
			original.apply(this, arguments);
		}
		apply_stock_entry_data_entry_type_defaults(state, { from_change: true });
	};
}

function collect_stock_entry_data_entry_payload(state) {
	const parent_data = state.parent_fg.get_values();
	if (!parent_data) return null;

	const tag_ctrl = state.parent_fg.fields_dict.custom_create_tag_numbers;
	if (tag_ctrl) {
		parent_data.custom_create_tag_numbers = cint(tag_ctrl.get_value());
	}

	const items = [];
	for (const row of state.item_rows) {
		Object.keys(row.controls).forEach((fieldname) => {
			row.item[fieldname] = row.controls[fieldname].get_value();
		});
		update_stock_entry_data_entry_row_dimension(row.item);
		const item_payload = { ...row.item };
		if (item_payload.__islocal) {
			delete item_payload.name;
		}
		items.push(item_payload);
	}

	return {
		...parent_data,
		items: apply_stock_entry_data_entry_parent_to_items(parent_data, items),
	};
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
	const payload = collect_stock_entry_data_entry_payload(state);
	if (!payload) return;
	save_stock_entry_data_entry(state.frm, payload, dialog);
}

function update_stock_entry_data_entry_row_dimension(row) {
	const parts = [row.custom_thickness, row.custom_width, row.custom_length_c]
		.map((value) => format_stock_entry_dimension_part(value))
		.filter(Boolean);
	row.custom_dimension = parts.join(" x ");
}

function format_stock_entry_dimension_part(value) {
	if (value === undefined || value === null) return "";
	const text = String(value).trim();
	if (!text) return "";
	const num = Number(text);
	if (!Number.isNaN(num) && text.match(/^-?\d+(\.\d+)?$/)) {
		return String(num % 1 === 0 ? parseInt(num, 10) : num);
	}
	return text;
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
	if (df.fieldname === "custom_finish_good_item") {
		delete field.depends_on;
		field.get_query = get_stock_entry_finish_good_item_query;
	}
	return field;
}

function get_stock_entry_finish_good_item_query() {
	return {
		filters: {
			disabled: 0,
			is_sales_item: 1,
			custom_ss_coil_item_type: ["in", ["Finished Good", "Semi Finished"]],
		},
	};
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
			custom_qty_of_coil: SS_COIL_DEFAULT_QTY_OF_COIL,
			custom_length_c: SS_COIL_DEFAULT_LENGTH_C,
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

function get_stock_entry_data_entry_default_parent_values(meta) {
	const values = {};
	const today = frappe.datetime.get_today();
	(meta.parent_sections || []).forEach((section) => {
		(section.fields || []).forEach((df) => {
			if (df.default !== undefined && df.default !== null && df.default !== "") {
				values[df.fieldname] = df.default;
			}
			if (df.fieldtype === "Date") {
				values[df.fieldname] = today;
			}
		});
	});
	if (!values.company) {
		values.company = frappe.defaults.get_user_default("company");
	}
	values.stock_entry_type = "Material Receipt";
	values.purpose = "Material Receipt";
	values.custom_job_purpose = "Tolling";
	values.custom_create_tag_numbers = 1;
	return values;
}

function get_stock_entry_data_entry_parent_values(frm, meta) {
	const values = get_stock_entry_data_entry_default_parent_values(meta);
	(meta.parent_sections || []).forEach((section) => {
		(section.fields || []).forEach((df) => {
			if (frm.doc[df.fieldname] !== undefined && frm.doc[df.fieldname] !== null && frm.doc[df.fieldname] !== "") {
				values[df.fieldname] = frm.doc[df.fieldname];
			}
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
	const dimension_fields = ["custom_thickness", "custom_width", "custom_length_c"];

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
					depends_on: df.fieldname === "custom_finish_good_item" ? null : df.depends_on,
					get_query:
						df.fieldname === "custom_finish_good_item"
							? get_stock_entry_finish_good_item_query
							: df.get_query,
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
		`<button type="button" class="btn-reset ss-coil-de-remove-row" title="${__("Remove Row")}">${frappe.utils.icon("close", "xs")}</button>`
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
		update_stock_entry_data_entry_row_count(state);
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
					{ value: "a4", label: __("A4 Sheet (3 × 2 in stickers)") },
					{ value: "thermal", label: __("Thermal / label printer (3 × 2 in)") },
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
		'[data-fieldname="custom_length_c"] input',
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
				$scope.find('[data-name="' + row_name + '"] [data-fieldname="custom_length_c"] input').val() ??
				$scope.find('[data-fieldname="custom_length_c"] input').val() ??
				row.custom_length_c;

			const parts = [typed_thickness, typed_width, typed_length]
				.map((v) => format_stock_entry_dimension_part(v))
				.filter((v) => v !== "");

			frappe.model.set_value(row.doctype, row.name, "custom_dimension", parts.join(" x "));
		},
	);
}

function set_stock_entry_dimension_from_values(cdt, cdn) {
	const row = locals[cdt] && locals[cdt][cdn];
	if (!row) return;

	const parts = [row.custom_thickness, row.custom_width, row.custom_length_c]
		.map((v) => format_stock_entry_dimension_part(v))
		.filter((v) => v !== "");

	frappe.model.set_value(cdt, cdn, "custom_dimension", parts.join(" x "));
}

frappe.provide("ss_coil.stock_entry_data_entry");

function make_flow_page_stock_entry_frm() {
	return {
		doc: { doctype: "Stock Entry", items: [] },
		is_new: () => true,
		set_value(key, value) {
			this.doc[key] = value;
		},
		add_child() {
			return {
				doctype: "Stock Entry Detail",
				name: frappe.utils.get_random(10),
			};
		},
		refresh_field() {},
	};
}

ss_coil.stock_entry_data_entry.mount_inline = function ($container, handlers = {}) {
	const $host = $($container);
	if (!$host.length) return;

	const boot = (meta, documentData) => {
		const frm = make_flow_page_stock_entry_frm();
		if (documentData) {
			Object.assign(frm.doc, documentData);
			frm.doc.items = (documentData.items || []).map((row) => ({
				...row,
				__islocal: ss_coil.flow_forms && ss_coil.flow_forms.is_local_doc
					? ss_coil.flow_forms.is_local_doc(documentData)
					: !documentData.name || String(documentData.name).startsWith("new-"),
			}));
		}

		const state = build_stock_entry_data_entry_state(frm, meta);
		state.mode = "flow_page";
		if (documentData) {
			const local = ss_coil.flow_forms && ss_coil.flow_forms.is_local_doc
				? ss_coil.flow_forms.is_local_doc(documentData)
				: !documentData.name || String(documentData.name).startsWith("new-");
			state.saved_name = local ? null : documentData.name;
			state.initial_parent_values = get_stock_entry_data_entry_parent_values(frm, meta);
			if (local) {
				$host.data("ss_coil_flow_mapped_doc", documentData);
			} else {
				$host.removeData("ss_coil_flow_mapped_doc");
			}
		} else {
			state.initial_parent_values = get_stock_entry_data_entry_default_parent_values(meta);
			$host.removeData("ss_coil_flow_mapped_doc");
		}

		$host.html('<div class="ss-coil-de-inline-panel ss-coil-data-entry-dialog"></div>');
		setup_stock_entry_data_entry_ui(state, $host.find(".ss-coil-de-inline-panel"));
		$host.data("ss_coil_data_entry_state", state);

		if (handlers.on_ready) {
			handlers.on_ready(state);
		}
	};

	if (handlers.document) {
		$host.html(`<div class="ss-coil-de-inline-loading">${__("Loading data entry form…")}</div>`);
		frappe.call({
			method: "ss_coil.stock_entry_data_entry.get_stock_entry_data_entry_meta",
			callback(r) {
				if (!r.message) return;
				boot(r.message, handlers.document);
			},
			error(r) {
				frappe.msgprint((r && r.message) || __("Could not load Stock Entry form."));
			},
		});
		return;
	}

	$host.html(`<div class="ss-coil-de-inline-loading">${__("Loading data entry form…")}</div>`);

	frappe.call({
		method: "ss_coil.stock_entry_data_entry.get_stock_entry_data_entry_meta",
		callback(r) {
			if (!r.message) return;
			boot(r.message);
		},
	});
};

function apply_saved_stock_entry_data_entry_rows(state, saved) {
	const saved_items = (saved && saved.items) || [];
	let saved_idx = 0;
	(state.item_rows || []).forEach((row) => {
		if (!row.item || !row.item.item_code) {
			return;
		}
		const saved_row = saved_items[saved_idx];
		saved_idx += 1;
		if (!saved_row) {
			return;
		}
		if (saved_row.name) {
			row.item.name = saved_row.name;
			row.item.__islocal = 0;
			if (row.$tr) {
				row.$tr.attr("data-row-name", saved_row.name);
			}
		}
		if (saved_row.custom_tag_no) {
			row.item.custom_tag_no = saved_row.custom_tag_no;
			if (row.controls && row.controls.custom_tag_no) {
				row.controls.custom_tag_no.set_value(saved_row.custom_tag_no);
			}
		}
	});
	if (state.items && state.item_rows) {
		state.items = state.item_rows.map((row) => row.item);
	}
}

ss_coil.stock_entry_data_entry.collect_payload = collect_stock_entry_data_entry_payload;

ss_coil.stock_entry_data_entry.save_inline = function ($container, handlers = {}) {
	const state = $($container).data("ss_coil_data_entry_state");
	if (!state) return;

	const payload = collect_stock_entry_data_entry_payload(state);
	if (!payload) return;

	const method = state.saved_name
		? "ss_coil.stock_entry_data_entry.save_stock_entry_data_entry"
		: "ss_coil.stock_entry_data_entry.create_stock_entry_from_data_entry";

	const args = state.saved_name
		? { stock_entry: state.saved_name, data: payload }
		: { data: payload };

	return frappe.call({
		method,
		args,
		freeze: true,
		freeze_message: __("Saving Stock Entry..."),
		callback(r) {
			const name = (r.message && r.message.name) || state.saved_name;
			state.saved_name = name;
			apply_saved_stock_entry_data_entry_rows(state, r.message);
			if (handlers.on_saved) {
				handlers.on_saved(name, r.message || {});
			} else {
				frappe.show_alert({
					message: __("Stock Entry {0} saved", [name]),
					indicator: "green",
				});
			}
		},
	});
};

ss_coil.stock_entry_data_entry.create_sales_order = function (stock_entry_name, handlers = {}) {
	return frappe.call({
		method: "ss_coil.api.create_sales_order_from_stock_entry",
		args: { source_name: stock_entry_name },
		freeze: true,
		freeze_message: __("Preparing Sales Order..."),
		callback(r) {
			if (!r.message) {
				frappe.msgprint(__("Could not prepare a Sales Order from this Stock Entry."));
				return;
			}
			const doc = r.message;
			if (!doc.doctype) {
				doc.doctype = "Sales Order";
			}
			if (handlers.on_created) {
				handlers.on_created(doc);
			} else {
				frappe.model.with_doctype("Sales Order", () => {
					frappe.model.sync(doc);
					frappe.set_route("Form", "Sales Order", doc.name);
				});
			}
		},
		error(r) {
			frappe.msgprint((r && r.message) || __("Could not create Sales Order from this Stock Entry."));
		},
	});
};

ss_coil.stock_entry_data_entry.reset_inline = function ($container) {
	ss_coil.stock_entry_data_entry.mount_inline($container);
};
