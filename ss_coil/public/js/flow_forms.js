frappe.provide("ss_coil.flow_forms");

const FLOW_CHILD_GROUPS = [
	{ label: "Item", fields: ["item_code", "custom_finish_good_item", "custom_raw_material_item", "qty", "rate", "received_qty"] },
	{
		label: "Identification",
		fields: [
			"custom_tag_no",
			"custom_raw_material_tag_no",
			"custom_raw_material_batch_no",
			"tag_no",
			"class",
			"custom_ref_no",
			"custom_mill",
			"custom_location",
			"location",
			"custom_po_no",
		],
	},
	{
		label: "Dimensions",
		fields: ["custom_thickness", "custom_width", "custom_length_c", "custom_length", "custom_dimension", "dimension", "thickness", "width", "length"],
	},
	{
		label: "Specification",
		fields: [
			"custom_commodity",
			"custom_condition",
			"custom_specification",
			"custom_estimated_wt",
			"custom_qty_of_coil",
			"custom_remarks",
			"estimated_wt",
			"estimated_qty",
			"actual_qty",
			"actual_wt",
		],
	},
	{
		label: "References",
		fields: [
			"against_sales_order",
			"custom_source_stock_entry",
			"custom_source_stock_entry_detail",
			"custom_stock_source_type",
			"custom_js_number",
			"custom_hdgc_no",
			"custom_entry_no",
			"custom_ss_coil",
			"custom_status",
		],
	},
	{
		label: "Processing",
		fields: [
			"slitter",
			"leveler",
			"reshearing",
			"custom_slitter",
			"custom_leveler",
			"custom_reshearing",
			"custom_machine",
			"custom_calc_ratio",
			"custom_calc_ratio_2",
			"custom_actual_ratio",
			"custom_remaining_width",
			"custom_comments",
			"current_process",
			"next_process",
		],
	},
	{
		label: "Packing",
		fields: [
			"custom_packing_type",
			"custom_packing_weightsize",
			"custom_no_of_pack",
			"custom_packing_remarks",
			"custom_packing_comments",
			"packing_type",
			"packing_weightsize",
			"no_of_pack",
			"packing_remarks",
			"packing_comments",
			"packing",
		],
	},
];

function flow_table_block_html(table_key, title) {
	return `<div class="ss-coil-de-items-block" data-table="${frappe.utils.escape_html(table_key)}">
			<div class="ss-coil-de-block-title">
				<span class="ss-coil-de-block-title-text">
					<span class="ss-coil-de-block-icon">${frappe.utils.icon("stock", "sm")}</span>
					<span>${frappe.utils.escape_html(title || __("Item Rows"))}</span>
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
		</div>`;
}

function flow_jobs_html() {
	return `<div class="ss-coil-flow-jobs">
			<div class="ss-coil-de-block-title">
				<span class="ss-coil-de-block-title-text">
					<span class="ss-coil-de-block-icon">${frappe.utils.icon("list", "sm")}</span>
					<span>${__("Jobs & Operations")}</span>
				</span>
			</div>
			<div class="ss-coil-flow-jobs-list"></div>
		</div>`;
}

function flow_control_html() {
	return `<div class="ss-coil-flow-control-deck">
			<div class="ss-coil-flow-control-head">
				<div class="ss-coil-flow-control-title-wrap">
					<span class="ss-coil-flow-control-kicker">${__("Process Control")}</span>
					<span class="ss-coil-flow-control-op"></span>
				</div>
				<div class="ss-coil-flow-control-head-right">
					<div class="ss-coil-flow-watch">
						<div class="ss-coil-flow-watch-face">
							<div class="ss-coil-flow-watch-unit"><span class="ss-coil-flow-watch-digits" data-unit="d">00</span><small>${__("DAY")}</small></div>
							<span class="ss-coil-flow-watch-sep">:</span>
							<div class="ss-coil-flow-watch-unit"><span class="ss-coil-flow-watch-digits" data-unit="h">00</span><small>${__("HR")}</small></div>
							<span class="ss-coil-flow-watch-sep">:</span>
							<div class="ss-coil-flow-watch-unit"><span class="ss-coil-flow-watch-digits" data-unit="m">00</span><small>${__("MIN")}</small></div>
							<span class="ss-coil-flow-watch-sep">:</span>
							<div class="ss-coil-flow-watch-unit"><span class="ss-coil-flow-watch-digits" data-unit="s">00</span><small>${__("SEC")}</small></div>
						</div>
					</div>
					<button type="button" class="ss-coil-flow-control-toggle ss-coil-flow-control-off" title="${__(
						"Turn Process Control on or off"
					)}">
						<span class="ss-coil-flow-control-switch"><span class="ss-coil-flow-control-knob"></span></span>
						<span class="ss-coil-flow-control-toggle-text">${__("OFF")}</span>
					</button>
				</div>
			</div>
			<div class="ss-coil-flow-control-actions"></div>
			<div class="ss-coil-flow-control-status-row">
				<span class="ss-coil-flow-control-label">${__("Status")}</span>
				<div class="ss-coil-flow-control-stepper"></div>
			</div>
			<div class="ss-coil-flow-control-hint"></div>
		</div>`;
}

function flow_form_shell_html(meta) {
	const child_table = (meta && meta.child_table) || "items";
	const child_title = (meta && meta.child_title) || __("Item Rows");
	const extra = meta && meta.hide_extra_tables
		? ""
		: ((meta && meta.extra_tables) || [])
			.map((spec) => flow_table_block_html(spec.child_table, spec.child_title || spec.child_table))
			.join("");
	const control = meta && meta.doctype === "SS Coil" ? flow_control_html() : "";
	return `<div class="ss-coil-de-shell">
		<div class="ss-coil-de-parent-block">
			<div class="ss-coil-de-block-title">
				<span class="ss-coil-de-block-title-text">
					<span class="ss-coil-de-block-icon">${frappe.utils.icon("file", "sm")}</span>
					<span>${frappe.utils.escape_html((meta && meta.title) || __("Document Details"))}</span>
				</span>
			</div>
			<div class="ss-coil-de-parent-fields"></div>
		</div>
		${control}
		${extra}
		${flow_table_block_html(child_table, child_title)}
	</div>`;
}

function flow_compact_fieldtype(fieldtype) {
	if (["Text", "Small Text", "Long Text", "Code", "Text Editor", "HTML Editor"].includes(fieldtype)) {
		return "Data";
	}
	return fieldtype;
}

function flow_map_field(df, doctype) {
	const field = {
		fieldtype: flow_compact_fieldtype(df.fieldtype),
		fieldname: df.fieldname,
		label: __(df.label),
		options: df.options,
		reqd: df.reqd,
		read_only: df.read_only,
		default: df.default,
		depends_on: df.depends_on,
	};
	if (/dimension$/i.test(df.fieldname)) {
		field.read_only = 1;
	}
	// SS Coil Item row name is a Link; many users cannot read Sales Order Item directly.
	if (doctype === "SS Coil" && df.fieldname === "sales_order_item") {
		field.fieldtype = "Data";
		field.read_only = 1;
		delete field.options;
	}
	return field;
}

function flow_build_parent_fields(meta) {
	const field_map = {};
	(meta.parent_sections || []).forEach((section) => {
		(section.fields || []).forEach((df) => {
			field_map[df.fieldname] = df;
		});
	});
	const fields = [{ fieldtype: "Section Break", fieldname: "section_details" }];
	Object.keys(field_map).forEach((fieldname) => {
		fields.push(flow_map_field(field_map[fieldname], meta.doctype));
	});
	return fields;
}

function flow_build_child_columns(child_field_defs) {
	const field_map = {};
	child_field_defs.forEach((df) => {
		field_map[df.fieldname] = df;
	});
	const groups = [];
	FLOW_CHILD_GROUPS.forEach((group) => {
		const fields = group.fields.filter((fieldname) => field_map[fieldname]).map((fieldname) => field_map[fieldname]);
		if (fields.length) {
			groups.push({ label: group.label, fields });
		}
	});
	const used = new Set(groups.flatMap((g) => g.fields.map((f) => f.fieldname)));
	Object.values(field_map).forEach((df) => {
		if (!used.has(df.fieldname)) {
			let misc = groups.find((g) => g.label === "Other");
			if (!misc) {
				misc = { label: "Other", fields: [] };
				groups.push(misc);
			}
			misc.fields.push(df);
		}
	});
	return groups;
}

function flow_relocate_dropdown(control) {
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

function flow_update_row_count(state) {
	const $scope = state.$table_block || state.$root;
	if (!$scope) return;
	$scope.find(".ss-coil-de-row-count").first().text((state.items || []).length);
}

function flow_collect_table(ctx) {
	const items = [];
	for (const row of ctx.item_rows || []) {
		Object.keys(row.controls).forEach((fieldname) => {
			row.item[fieldname] = row.controls[fieldname].get_value();
		});
		const item_payload = { ...row.item };
		if (item_payload.__islocal) {
			delete item_payload.name;
		}
		items.push(item_payload);
	}
	return items;
}

function flow_collect_payload(state) {
	const parent_data = state.parent_fg.get_values();
	if (!parent_data) return null;
	const payload = { ...parent_data, [state.meta.child_table || "items"]: flow_collect_table(state) };
	Object.entries(state.extra_ctx || {}).forEach(([table, ctx]) => {
		payload[table] = flow_collect_table(ctx);
	});
	return payload;
}

function flow_render_table_head(state, $thead) {
	const groups = state.child_columns;
	const $group_row = $('<tr class="ss-coil-de-group-row"></tr>');
	const $field_row = $('<tr class="ss-coil-de-field-row"></tr>');
	$group_row.append('<th class="ss-coil-de-col-index ss-coil-de-sticky"></th>');
	$field_row.append('<th class="ss-coil-de-col-index ss-coil-de-sticky">#</th>');
	groups.forEach((group) => {
		$group_row.append(`<th class="ss-coil-de-group-head" colspan="${group.fields.length}">${__(group.label)}</th>`);
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

function flow_make_item_row() {
	return {
		name: frappe.utils.get_random(10),
		__islocal: 1,
	};
}

function flow_append_item_row(state, $tbody, item, idx) {
	const $tr = $(`<tr class="ss-coil-de-item-row" data-row-name="${item.name}"></tr>`).appendTo($tbody);
	$tr.append(`<td class="ss-coil-de-col-index ss-coil-de-sticky">${idx + 1}</td>`);
	const controls = {};
	state.child_columns.forEach((group) => {
		group.fields.forEach((df) => {
			const $td = $(`<td data-fieldname="${df.fieldname}"></td>`).appendTo($tr);
			const control = frappe.ui.form.make_control({
				df: {
					fieldtype: flow_compact_fieldtype(df.fieldtype),
					fieldname: df.fieldname,
					label: df.label,
					options: df.options,
					reqd: df.reqd,
					read_only: /dimension$/i.test(df.fieldname) ? 1 : df.read_only,
					depends_on: df.fieldname === "custom_finish_good_item" ? null : df.depends_on,
					get_query:
						df.fieldname === "custom_finish_good_item" && typeof get_stock_entry_finish_good_item_query === "function"
							? get_stock_entry_finish_good_item_query
							: df.get_query,
					onchange: () => {
						item[df.fieldname] = control.get_value();
					},
				},
				parent: $td.get(0),
				only_input: true,
				render_input: true,
			});
			control.refresh();
			control.set_value(item[df.fieldname]);
			flow_relocate_dropdown(control);
			controls[df.fieldname] = control;
		});
	});
	const $remove_td = $('<td class="ss-coil-de-col-action ss-coil-de-sticky-right"></td>').appendTo($tr);
	if (state.doctype === "Sales Order" && !cint(item.custom_is_process_charge) && !item.custom_process_charge_key) {
		$(`<button type="button" class="btn btn-xs ss-coil-de-plan-row" title="${__("Manage Cutting Scheme")}">${__("Cutting")}</button>`)
			.appendTo($remove_td)
			.on("click", (e) => {
				e.preventDefault();
				e.stopPropagation();
				ss_coil.flow_forms.open_cutting_scheme(state, item);
			});
	}
	$(`<button type="button" class="btn-reset ss-coil-de-remove-row" title="${__("Remove Row")}">${frappe.utils.icon("close", "xs")}</button>`)
		.appendTo($remove_td)
		.on("click", () => {
			const min_rows = state.min_rows == null ? 1 : state.min_rows;
			if (state.items.length <= min_rows) {
				frappe.msgprint(
					min_rows
						? __("At least one item row is required.")
						: __("No rows left to remove.")
				);
				return;
			}
			state.items = state.items.filter((row) => row.name !== item.name);
			state.item_rows = state.item_rows.filter((row) => row.item.name !== item.name);
			$tr.remove();
			$tbody.find(".ss-coil-de-item-row").each((i, el) => {
				$(el).find(".ss-coil-de-col-index").text(i + 1);
			});
			flow_update_row_count(state);
		});
	state.item_rows.push({ item, controls, $tr });
}

function flow_render_item_rows(state, $tbody) {
	$tbody.empty();
	state.item_rows = [];
	if (!state.items.length && (state.min_rows == null ? 1 : state.min_rows) > 0) {
		state.items.push(flow_make_item_row());
	}
	state.items.forEach((item, idx) => flow_append_item_row(state, $tbody, item, idx));
}

function flow_apply_today_defaults(state) {
	const today = frappe.datetime.get_today();
	meta_sections(state).forEach((section) => {
		(section.fields || []).forEach((df) => {
			if (df.fieldtype === "Date" && state.parent_fg.fields_dict[df.fieldname]) {
				flow_set_date_control_value(state.parent_fg.fields_dict[df.fieldname], today);
			}
		});
	});
}

function meta_sections(state) {
	return (state.meta && state.meta.parent_sections) || [];
}

function flow_build_initial_values(meta) {
	const values = { ...(meta.defaults || {}) };
	const today = frappe.datetime.get_today();
	(meta.parent_sections || []).forEach((section) => {
		(section.fields || []).forEach((df) => {
			if (df.fieldtype === "Date") {
				values[df.fieldname] = today;
			}
		});
	});
	return values;
}
function flow_child_table_name(meta) {
	return meta.child_table || "items";
}

function flow_build_values_from_document(meta, data) {
	const values = {};
	meta_sections({ meta }).forEach((section) => {
		(section.fields || []).forEach((df) => {
			const value = data[df.fieldname];
			if (value !== undefined && value !== null && value !== "") {
				values[df.fieldname] = value;
			}
		});
	});
	if (!values.company) {
		values.company = frappe.defaults.get_user_default("company");
	}
	return values;
}

function flow_normalize_date_value(value) {
	if (!value) {
		return value;
	}
	if (frappe.datetime.validate(value)) {
		return value;
	}
	const system = frappe.datetime.user_to_str(String(value), false);
	return frappe.datetime.validate(system) ? system : value;
}

function flow_format_control_value(control, value) {
	if (value === undefined || value === null || value === "") {
		return value;
	}
	if (control.df.fieldtype === "Date") {
		return flow_normalize_date_value(value);
	}
	if (control.df.fieldtype === "Check") {
		return cint(value);
	}
	return value;
}

function flow_set_date_control_value(control, value) {
	const system = flow_normalize_date_value(value);
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

function flow_set_link_control_value(control, value) {
	if (!control || value === undefined || value === null || value === "") {
		return;
	}
	const link_value = String(value);
	if (control.doc) {
		control.doc[control.df.fieldname] = link_value;
	}
	control.value = link_value;
	control.last_value = link_value;
	if (control.$input) {
		control.$input.val(link_value);
	}
	if (control.$link) {
		control.$link.toggle(true);
	}
}

function flow_set_parent_values(parent_fg, values) {
	if (!parent_fg || !values) return;

	const batch = {};
	Object.entries(values).forEach(([fieldname, value]) => {
		const control = parent_fg.fields_dict[fieldname];
		if (!control || value === undefined || value === null || value === "") {
			return;
		}
		if (control.df.fieldtype === "Date") {
			flow_set_date_control_value(control, value);
			return;
		}
		if (control.df.fieldtype === "Link") {
			flow_set_link_control_value(control, value);
			return;
		}
		batch[fieldname] = flow_format_control_value(control, value);
	});

	if (Object.keys(batch).length) {
		parent_fg.set_values(batch);
	}
}

function flow_apply_document_items(state, data) {
	if (!data) return;
	const child_table = flow_child_table_name(state.meta);
	const rows = data[child_table] || data.items || [];
	const parent_local = ss_coil.flow_forms.is_local_doc(data);
	state.items = rows.length
		? rows.map((row) => ({
				...row,
				name: row.name || frappe.utils.get_random(10),
				__islocal: parent_local || ss_coil.flow_forms.is_local_name(row.name) ? 1 : 0,
		  }))
		: state.min_rows
			? [flow_make_item_row()]
			: [];
	flow_render_item_rows(state, (state.$table_block || state.$root).find(".ss-coil-de-table tbody"));
	flow_update_row_count(state);
}

function flow_setup_ui(state, $root, options = {}) {
	state.$root = $root;
	$root.html(flow_form_shell_html(state.meta));
	state.min_rows = state.doctype === "SS Coil" ? 0 : 1;
	state.$table_block = $root.find(
		`.ss-coil-de-items-block[data-table="${flow_child_table_name(state.meta)}"]`
	);
	state.parent_fg = new frappe.ui.FieldGroup({
		fields: flow_build_parent_fields(state.meta),
		body: null,
		no_submit_on_enter: true,
	});
	const $parent_body = $root.find(".ss-coil-de-parent-fields");
	state.parent_fg.body = $parent_body.get(0);
	state.parent_fg.make();

	const parentValues = options.document
		? flow_build_values_from_document(state.meta, options.document)
		: state.initial_values || flow_build_initial_values(state.meta);

	if (options.document) {
		state.saved_name = ss_coil.flow_forms.is_local_doc(options.document)
			? null
			: options.document.name;
	}

	flow_set_parent_values(state.parent_fg, parentValues);

	$parent_body.find(".form-column > form").addClass("ss-coil-de-grid-6");
	Object.values(state.parent_fg.fields_dict || {}).forEach(flow_relocate_dropdown);

	state.child_columns = flow_build_child_columns(state.meta.child_fields || []);
	const $table = state.$table_block.find(".ss-coil-de-table");
	flow_render_table_head(state, $table.find("thead"));
	if (options.document) {
		flow_apply_document_items(state, options.document);
	} else {
		flow_render_item_rows(state, $table.find("tbody"));
		flow_update_row_count(state);
	}

	state.$table_block.find(".ss-coil-de-add-row").on("click", () => {
		const item = flow_make_item_row();
		state.items.push(item);
		flow_append_item_row(state, $table.find("tbody"), item, state.items.length - 1);
		flow_update_row_count(state);
	});

	flow_setup_extra_tables(state, $root, options.document);
	if (state.doctype === "SS Coil") {
		flow_bind_ss_coil_control(state, options.document);
	}
}

function flow_map_table_rows(rows, parent_local) {
	return (rows || []).map((row) => ({
		...row,
		name: row.name || frappe.utils.get_random(10),
		__islocal: parent_local || ss_coil.flow_forms.is_local_name(row.name) ? 1 : 0,
	}));
}

function flow_setup_extra_tables(state, $root, document) {
	state.extra_ctx = {};
	if (state.meta && state.meta.hide_extra_tables) {
		return;
	}
	(state.meta.extra_tables || []).forEach((spec) => {
		const $block = $root.find(`.ss-coil-de-items-block[data-table="${spec.child_table}"]`);
		if (!$block.length) return;
		const ctx = {
			doctype: state.doctype,
			meta: state.meta,
			items: [],
			item_rows: [],
			min_rows: 0,
			child_columns: flow_build_child_columns(spec.child_fields || []),
			$table_block: $block,
			$root: $block,
		};
		flow_render_table_head(ctx, $block.find("thead"));
		const parent_local = document ? ss_coil.flow_forms.is_local_doc(document) : true;
		ctx.items = flow_map_table_rows(document && document[spec.child_table], parent_local);
		flow_render_item_rows(ctx, $block.find("tbody"));
		flow_update_row_count(ctx);
		$block.find(".ss-coil-de-add-row").on("click", () => {
			const item = flow_make_item_row();
			ctx.items.push(item);
			flow_append_item_row(ctx, $block.find("tbody"), item, ctx.items.length - 1);
			flow_update_row_count(ctx);
		});
		state.extra_ctx[spec.child_table] = ctx;
	});
}

const SS_COIL_CONTROL_STEPS = [
	{ status: "Not Started", label: "Not Started" },
	{ status: "In Process", label: "Start" },
	{ status: "Partially Completed", label: "Partial" },
	{ status: "Completed", label: "Complete" },
	{ status: "Closed", label: "Close" },
];

function flow_clear_elapsed_timer(state) {
	if (state && state._elapsed_timer) {
		clearInterval(state._elapsed_timer);
		state._elapsed_timer = null;
	}
}

function flow_ss_coil_process_state(state, document) {
	const src = document || {};
	const proc = state.process || {};
	const get = (fieldname) =>
		(state.parent_fg && state.parent_fg.get_value && state.parent_fg.get_value(fieldname)) || "";
	return {
		name: state.saved_name || src.name || "",
		operation: proc.operation || get("operation") || src.operation || "",
		order_status: proc.order_status || get("order_status") || src.order_status || "Not Started",
		process_control_enabled: cint(
			proc.process_control_enabled != null ? proc.process_control_enabled : src.process_control_enabled
		),
		started_on: proc.started_on || src.started_on || "",
		completed_on: proc.completed_on || src.completed_on || "",
		elapsed_time: proc.elapsed_time || src.elapsed_time || "",
	};
}

function flow_apply_process_payload(state, payload) {
	if (!payload) return;
	state.process = {
		...(state.process || {}),
		process_control_enabled: cint(payload.process_control_enabled),
		order_status: payload.order_status || (state.process && state.process.order_status),
		started_on:
			payload.started_on ||
			(state.process && state.process.started_on) ||
			(["In Process", "Partially Completed"].includes(payload.order_status)
				? frappe.datetime.now_datetime()
				: ""),
		completed_on: payload.completed_on || "",
		elapsed_time: payload.elapsed_time || "",
		operation: payload.operation || (state.process && state.process.operation) || "",
	};
	if (payload.order_status && state.parent_fg) {
		flow_set_parent_values(state.parent_fg, { order_status: payload.order_status });
	}
}

function flow_parse_datetime(value) {
	if (!value) return null;
	if (value instanceof Date) {
		return Number.isNaN(value.getTime()) ? null : value;
	}
	const raw = String(value).trim();
	if (!raw) return null;
	const cleaned = raw.replace("T", " ").replace(/\.\d+/, "");
	if (window.moment) {
		let m = moment(cleaned, "YYYY-MM-DD HH:mm:ss", true);
		if (!m.isValid()) {
			m = moment(raw);
		}
		if (m.isValid()) {
			return m.toDate();
		}
	}
	const parsed = frappe.datetime.str_to_obj(cleaned);
	if (parsed && parsed instanceof Date && !Number.isNaN(parsed.getTime())) {
		return parsed;
	}
	const fallback = new Date(raw);
	return Number.isNaN(fallback.getTime()) ? null : fallback;
}

function flow_format_elapsed_clock(started_on, completed_on) {
	const start = flow_parse_datetime(started_on);
	if (!start) {
		return "0d 00h 00m 00s";
	}
	const end = completed_on ? flow_parse_datetime(completed_on) : new Date();
	if (!end) {
		return "0d 00h 00m 00s";
	}
	const seconds = Math.max(0, Math.floor((end - start) / 1000));
	const days = Math.floor(seconds / 86400);
	const hours = Math.floor((seconds % 86400) / 3600);
	const minutes = Math.floor((seconds % 3600) / 60);
	const secs = seconds % 60;
	return `${days}d ${String(hours).padStart(2, "0")}h ${String(minutes).padStart(2, "0")}m ${String(
		secs
	).padStart(2, "0")}s`;
}

function flow_elapsed_parts(started_on, completed_on) {
	const text = flow_format_elapsed_clock(started_on, completed_on);
	const match = String(text).match(/(\d+)\s*d\s*(\d+)\s*h\s*(\d+)\s*m\s*(\d+)\s*s/i);
	if (!match) {
		return { d: "00", h: "00", m: "00", s: "00" };
	}
	return {
		d: String(match[1]).padStart(2, "0"),
		h: String(match[2]).padStart(2, "0"),
		m: String(match[3]).padStart(2, "0"),
		s: String(match[4]).padStart(2, "0"),
	};
}

function flow_paint_watch(state, started_on, completed_on, running) {
	if (!state.$root) return;
	const $watch = state.$root.find(".ss-coil-flow-watch");
	const $card = state.$root.find(".ss-coil-flow-clock-card");
	$watch.add($card).toggleClass("ss-coil-flow-clock-running", !!running);
	const parts = flow_elapsed_parts(started_on, completed_on);
	const $digits = state.$root.find(".ss-coil-flow-watch-digits");
	if ($digits.length) {
		$digits.filter("[data-unit='d']").text(parts.d);
		$digits.filter("[data-unit='h']").text(parts.h);
		$digits.filter("[data-unit='m']").text(parts.m);
		$digits.filter("[data-unit='s']").text(parts.s);
		return;
	}
	state.$root.find(".ss-coil-flow-clock").text(flow_format_elapsed_clock(started_on, completed_on));
}

function flow_status_step_index(status) {
	if (status === "Stopped") {
		return 1;
	}
	const idx = SS_COIL_CONTROL_STEPS.findIndex((step) => step.status === status);
	return idx >= 0 ? idx : 0;
}

function flow_bind_ss_coil_control(state, document) {
	const $deck = state.$root.find(".ss-coil-flow-control-deck");
	if (!$deck.length) return;
	state.process = flow_ss_coil_process_state(state, document);
	$deck.removeAttr("hidden").show();
	$deck
		.find(".ss-coil-flow-control-toggle")
		.off("click.ss_coil_ctl")
		.on("click.ss_coil_ctl", () => flow_toggle_ss_coil_control(state));
	flow_render_ss_coil_control(state);
}

function flow_render_ss_coil_control(state) {
	const $deck = state.$root.find(".ss-coil-flow-control-deck");
	if (!$deck.length) return;
	const proc = flow_ss_coil_process_state(state);
	const control_on = Boolean(proc.process_control_enabled);
	const status = proc.order_status || "Not Started";
	const running = ["In Process", "Partially Completed"].includes(status) && !proc.completed_on;
	const saved = Boolean(state.saved_name);

	$deck.find(".ss-coil-flow-control-op").text(proc.operation || __("No operation"));
	const $toggle = $deck.find(".ss-coil-flow-control-toggle");
	$toggle
		.toggleClass("ss-coil-flow-control-on", control_on)
		.toggleClass("ss-coil-flow-control-off", !control_on);
	$toggle.find(".ss-coil-flow-control-toggle-text").text(control_on ? __("ON") : __("OFF"));

	flow_paint_watch(state, proc.started_on, proc.completed_on, running);

	const actions = [];
	if (status === "Stopped") {
		actions.push({ status: "In Process", label: __("Resume"), kind: "resume" });
	} else if (status === "Not Started") {
		actions.push({ status: "In Process", label: __("Start"), kind: "start" });
	} else if (status === "In Process") {
		actions.push({ status: "Partially Completed", label: __("Partial"), kind: "partial" });
		actions.push({ status: "Completed", label: __("Complete"), kind: "complete" });
		actions.push({ status: "Stopped", label: __("Stop"), kind: "stop" });
	} else if (status === "Partially Completed") {
		actions.push({ status: "Completed", label: __("Complete"), kind: "complete" });
		actions.push({ status: "Stopped", label: __("Stop"), kind: "stop" });
	} else if (status === "Completed") {
		actions.push({ status: "Closed", label: __("Close"), kind: "close" });
	}
	actions.push({ status: "__next__", label: __("Next Process"), kind: "next" });

	const $actions = $deck.find(".ss-coil-flow-control-actions").empty();
	actions.forEach((action) => {
		const $btn = $(
			`<button type="button" class="ss-coil-ctl-btn ss-coil-ctl-${action.kind}" data-kind="${action.kind}">
				<span>${frappe.utils.escape_html(action.label)}</span>
			</button>`
		);
		if (!saved) {
			$btn.prop("disabled", true);
		} else if (!control_on) {
			$btn.addClass("is-locked");
		}
		$btn.on("click", () => {
			if (action.kind === "next") {
				if (!control_on) {
					flow_control_locked_message(__("Create Next Process"));
					return;
				}
				flow_create_next_ss_coil(state);
				return;
			}
			flow_set_ss_coil_status(state, action.status, action.label);
		});
		$actions.append($btn);
	});

	const currentIndex = flow_status_step_index(status);
	const $stepper = $deck.find(".ss-coil-flow-control-stepper").empty();
	const visibleSteps = SS_COIL_CONTROL_STEPS.filter((step, idx) => !(idx === 0 && currentIndex > 0));
	visibleSteps.forEach((step, visIdx) => {
		const idx = SS_COIL_CONTROL_STEPS.indexOf(step);
		if (visIdx > 0) {
			$stepper.append(`<span class="ss-coil-ctl-connector${idx <= currentIndex ? " is-done" : ""}"></span>`);
		}
		const stateName = idx < currentIndex ? "done" : idx === currentIndex ? "current" : "upcoming";
		const label = idx <= currentIndex && step.status !== "Not Started" ? step.status : step.label;
		const $step = $(
			`<button type="button" class="ss-coil-ctl-step is-${stateName}" data-status="${step.status}">${
				stateName === "done" ? "✓ " : ""
			}${frappe.utils.escape_html(__(label))}</button>`
		);
		if (idx >= 1 && saved) {
			$step.on("click", () => flow_set_ss_coil_status(state, step.status, step.label));
		} else {
			$step.prop("disabled", true);
		}
		$stepper.append($step);
	});
	if (status === "Stopped") {
		$stepper.append(`<span class="ss-coil-ctl-stopped">${__("STOPPED")}</span>`);
	}

	const $hint = $deck.find(".ss-coil-flow-control-hint");
	if (!saved) {
		$hint.text(__("Save this SS Coil to use Start, Complete, Watch, and Process Control."));
	} else if (!control_on) {
		$hint.text(__("Turn Process Control ON, then Start or Complete this job."));
	} else {
		$hint.text(__("Process Control is ON. Choose Start, Partial, Complete, or Stop."));
	}

	flow_start_elapsed_timer(state);
}

function flow_start_elapsed_timer(state) {
	flow_clear_elapsed_timer(state);
	const proc = flow_ss_coil_process_state(state);
	const running = ["In Process", "Partially Completed"].includes(proc.order_status) && !proc.completed_on;
	if (running && !flow_parse_datetime(proc.started_on)) {
		state.process = state.process || {};
		state.process.started_on = frappe.datetime.now_datetime();
	}
	const tick = () => {
		const latest = flow_ss_coil_process_state(state);
		const is_running =
			["In Process", "Partially Completed"].includes(latest.order_status) && !latest.completed_on;
		flow_paint_watch(state, latest.started_on, latest.completed_on, is_running);
	};
	tick();
	if (running) {
		state._elapsed_timer = setInterval(tick, 1000);
	}
}

function flow_control_locked_message(actionLabel) {
	frappe.msgprint({
		title: __("Process Control Locked"),
		indicator: "orange",
		message: __("Turn ON <b>Process Control</b> before using <b>{0}</b>.", [actionLabel]),
	});
}

function flow_toggle_ss_coil_control(state) {
	if (!state.saved_name) {
		frappe.msgprint(__("Save the SS Coil first, then use Process Control."));
		return;
	}
	const enabled = cint(state.process && state.process.process_control_enabled) ? 0 : 1;
	frappe.call({
		method: "ss_coil.flow_forms.set_ss_coil_process_control",
		args: { name: state.saved_name, enabled },
		freeze: true,
		freeze_message: enabled ? __("Enabling Process Control...") : __("Locking Process Control..."),
		callback(r) {
			if (!r.message) return;
			flow_apply_process_payload(state, r.message);
			flow_render_ss_coil_control(state);
		},
	});
}

function flow_bind_ss_coil_jobs(state, document) {
	const $jobs = state.$root.find(".ss-coil-flow-jobs");
	if (!$jobs.length) return;

	const order_no =
		(state.parent_fg && state.parent_fg.get_value("order_no")) ||
		(document && document.order_no) ||
		"";
	const current_name = state.saved_name || (document && document.name) || "";

	if (!order_no) {
		$jobs.find(".ss-coil-flow-jobs-list").html(
			`<div class="ss-coil-flow-job-chip-meta">${__("Save this job, then related operations for the Sales Order will appear here.")}</div>`
		);
		$jobs.removeAttr("hidden").show();
		return;
	}

	frappe.call({
		method: "ss_coil.flow_forms.get_ss_coils_for_order",
		args: { order_no },
		callback(r) {
			const jobs = r.message || [];
			const $list = $jobs.find(".ss-coil-flow-jobs-list").empty();
			if (!jobs.length) {
				$list.html(
					`<div class="ss-coil-flow-job-chip-meta">${__("No SS Coil jobs found for this Sales Order.")}</div>`
				);
			} else {
				jobs.forEach((job) => {
					const active = job.name === current_name ? " is-active" : "";
					const $chip = $(
						`<button type="button" class="ss-coil-flow-job-chip${active}">
							<span class="ss-coil-flow-job-chip-name">${frappe.utils.escape_html(job.name)}</span>
							<span class="ss-coil-flow-job-chip-meta">${frappe.utils.escape_html(
								job.operation || "-"
							)} · ${frappe.utils.escape_html(job.order_status || "-")}</span>
						</button>`
					);
					$chip.on("click", () => {
						if (job.name === current_name || !state.$host) return;
						flow_clear_elapsed_timer(state);
						ss_coil.flow_forms.load(state.$host, "SS Coil", job.name, state.handlers || {});
					});
					$list.append($chip);
				});
			}
			$jobs.removeAttr("hidden").show();
		},
	});
}

function flow_set_ss_coil_status(state, order_status, actionLabel) {
	if (!state.saved_name) {
		frappe.msgprint(__("Save the SS Coil first, then change status."));
		return;
	}
	if (!cint(state.process && state.process.process_control_enabled)) {
		flow_control_locked_message(actionLabel || order_status);
		return;
	}
	frappe.call({
		method: "ss_coil.flow_forms.set_ss_coil_order_status",
		args: { name: state.saved_name, order_status },
		freeze: true,
		freeze_message: __("Updating status..."),
		callback(r) {
			if (!r.message) return;
			flow_apply_process_payload(state, r.message);
			flow_render_ss_coil_control(state);
			frappe.show_alert({
				message: __("Status set to {0}", [r.message.order_status]),
				indicator: "green",
			});
		},
	});
}

function flow_create_next_ss_coil(state) {
	if (!state.saved_name) {
		frappe.msgprint(__("Save the SS Coil first, then create the next process."));
		return;
	}
	frappe.call({
		method: "ss_coil.api.create_next_ss_coil_entry",
		args: { source_name: state.saved_name },
		freeze: true,
		freeze_message: __("Creating next process entries..."),
		callback(r) {
			const message = r.message || {};
			const created = message.created_docs || [];
			if (created.length) {
				frappe.show_alert({
					message: __("{0} next process entries created", [created.length]),
					indicator: "green",
				});
				if (state.$host) {
					ss_coil.flow_forms.load(state.$host, "SS Coil", created[0].name, state.handlers || {});
				}
				return;
			}
			if (message.no_next_process) {
				frappe.msgprint(__("Set Next Process on Job Output rows first, then create the next job."));
				return;
			}
			if ((message.skipped_docs || []).length) {
				frappe.msgprint(__("Next process entries already exist for all output tags."));
				return;
			}
			frappe.msgprint(__("No next process to create from this job's output."));
		},
	});
}

ss_coil.flow_forms.is_local_name = function (name) {
	return !name || String(name).startsWith("new-");
};

ss_coil.flow_forms.is_local_doc = function (doc) {
	if (!doc) return true;
	return !!doc.__islocal || ss_coil.flow_forms.is_local_name(doc.name);
};

ss_coil.flow_forms.prompt_load_document = function (doctype, callback) {
	frappe.call({
		method: "frappe.client.get_list",
		args: {
			doctype,
			fields: ["name"],
			order_by: "name desc",
			limit_page_length: 100,
		},
		freeze: true,
		freeze_message: __("Loading {0} list...", [doctype]),
		callback(r) {
			const names = (r.message || []).map((row) => row.name).filter(Boolean);
			if (!names.length) {
				frappe.msgprint(__("No saved {0} found.", [doctype]));
				return;
			}
			const d = new frappe.ui.Dialog({
				title: __("Load {0}", [doctype]),
				fields: [
					{
						fieldtype: "Select",
						fieldname: "name",
						label: doctype,
						options: names.join("\n"),
						reqd: 1,
						default: names[0],
					},
				],
				primary_action_label: __("Load"),
				primary_action(values) {
					if (!values.name) return;
					d.hide();
					callback(values.name);
				},
			});
			d.show();
		},
	});
};

ss_coil.flow_forms.load = function ($container, doctype, name, handlers = {}) {
	const $host = $($container);
	if (!$host.length || !name) return;

	return frappe.call({
		method: "ss_coil.flow_forms.get_flow_form_document",
		args: { doctype, name },
		freeze: true,
		freeze_message: __("Loading {0}...", [doctype]),
		callback(r) {
			if (!r.message) {
				frappe.msgprint(__("Could not load {0}.", [doctype]));
				return;
			}
			ss_coil.flow_forms.mount($host, doctype, {
				...handlers,
				document: r.message,
				on_ready(state) {
					if (handlers.on_loaded) {
						handlers.on_loaded(r.message.name, r.message);
					}
					if (handlers.on_ready) {
						handlers.on_ready(state);
					}
				},
			});
		},
		error(r) {
			frappe.msgprint(
				(r && r.message) || __("Could not load {0}. Restart bench if this is a new feature.", [doctype])
			);
		},
	});
};

ss_coil.flow_forms.mount = function ($container, doctype, handlers = {}) {
	const $host = $($container);
	if (!$host.length) return;
	flow_clear_elapsed_timer($host.data("ss_coil_flow_form_state"));

	if (doctype === "Stock Entry" && ss_coil.stock_entry_data_entry) {
		ss_coil.stock_entry_data_entry.mount_inline($host, handlers);
		$host.data("ss_coil_flow_doctype", doctype);
		if (handlers.document && ss_coil.flow_forms.is_local_doc(handlers.document)) {
			$host.data("ss_coil_flow_mapped_doc", handlers.document);
		} else {
			$host.removeData("ss_coil_flow_mapped_doc");
		}
		return;
	}

	$host.html(`<div class="ss-coil-de-inline-loading">${__("Loading form…")}</div>`);
	frappe.call({
		method: "ss_coil.flow_forms.get_flow_form_meta",
		args: { doctype },
		callback(r) {
			if (!r.message) return;
			const meta = r.message;
			const loaded = !!handlers.document;
			const state = {
				meta,
				doctype,
				items: [],
				item_rows: [],
				saved_name: loaded ? handlers.document.name : null,
				initial_values: loaded ? null : flow_build_initial_values(meta),
				handlers,
				$host,
			};
			$host.html('<div class="ss-coil-de-inline-panel ss-coil-data-entry-dialog"></div>');
			flow_setup_ui(state, $host.find(".ss-coil-de-inline-panel"), {
				document: handlers.document,
			});
			$host.data("ss_coil_flow_form_state", state);
			$host.data("ss_coil_flow_doctype", doctype);
			if (handlers.document && ss_coil.flow_forms.is_local_doc(handlers.document)) {
				$host.data("ss_coil_flow_mapped_doc", handlers.document);
			} else {
				$host.removeData("ss_coil_flow_mapped_doc");
			}
			if (handlers.on_ready) handlers.on_ready(state);
		},
	});
};

ss_coil.flow_forms.reset = function ($container, doctype) {
	ss_coil.flow_forms.mount($container, doctype);
};

ss_coil.flow_forms.save = function ($container, handlers = {}) {
	const $host = $($container);
	const doctype = $host.data("ss_coil_flow_doctype");
	const mapped_doc = $host.data("ss_coil_flow_mapped_doc");

	if (doctype === "Stock Entry" && ss_coil.stock_entry_data_entry && !mapped_doc) {
		return ss_coil.stock_entry_data_entry.save_inline($host, handlers);
	}

	const state =
		doctype === "Stock Entry"
			? $host.data("ss_coil_data_entry_state")
			: $host.data("ss_coil_flow_form_state");
	if (!state) return;

	const payload =
		doctype === "Stock Entry" && ss_coil.stock_entry_data_entry
			? ss_coil.stock_entry_data_entry.collect_payload(state)
			: flow_collect_payload(state);
	if (!payload) return;

	if (mapped_doc && !state.saved_name) {
		return frappe.call({
			method: "ss_coil.flow_forms.insert_mapped_flow_document",
			args: { doctype, mapped_doc, data: payload },
			freeze: true,
			freeze_message: __("Saving {0}...", [doctype]),
			callback(r) {
				const name = (r.message && r.message.name) || state.saved_name;
				state.saved_name = name;
				$host.removeData("ss_coil_flow_mapped_doc");
				if (handlers.on_saved) {
					handlers.on_saved(name, r.message || {});
				} else {
					frappe.show_alert({ message: __("{0} {1} saved", [doctype, name]), indicator: "green" });
				}
			},
		});
	}

	if (doctype === "Stock Entry" && ss_coil.stock_entry_data_entry) {
		return ss_coil.stock_entry_data_entry.save_inline($host, handlers);
	}

	const method = state.saved_name ? "ss_coil.flow_forms.save_flow_form_document" : "ss_coil.flow_forms.create_flow_form_document";
	const args = state.saved_name
		? { doctype, name: state.saved_name, data: payload }
		: { doctype, data: payload };

	return frappe.call({
		method,
		args,
		freeze: true,
		freeze_message: __("Saving {0}...", [doctype]),
		callback(r) {
			const name = (r.message && r.message.name) || state.saved_name;
			state.saved_name = name;
			if (handlers.on_saved) {
				handlers.on_saved(name, r.message || {});
			} else {
				frappe.show_alert({ message: __("{0} {1} saved", [doctype, name]), indicator: "green" });
			}
		},
	});
};

ss_coil.flow_forms.open_document = function (doctype, name) {
	if (!name) return;
	frappe.set_route("Form", doctype, name);
};

ss_coil.flow_forms.open_cutting_scheme = function (state, item) {
	const sales_order = state && state.saved_name;
	const row_name = item && item.name;
	if (!sales_order || ss_coil.flow_forms.is_local_name(sales_order)) {
		frappe.msgprint(__("Save the Sales Order first, then open Cutting Scheme for this row."));
		return;
	}
	if (!row_name || item.__islocal || ss_coil.flow_forms.is_local_name(row_name)) {
		frappe.msgprint(__("Save the Sales Order so this item row has a real name, then plan cutting."));
		return;
	}

	const opener = () => ss_coil.open_cutting_scheme_dialog || window.open_cutting_scheme_dialog;

	const open = () => {
		const dialog_fn = opener();
		if (typeof dialog_fn !== "function") {
			frappe.msgprint(__("Cutting Scheme planner is not loaded. Refresh the page and try again."));
			return;
		}
		frappe.model.with_doc("Sales Order", sales_order, () => {
			const doc = frappe.get_doc("Sales Order", sales_order);
			if (!doc || !locals["Sales Order Item"] || !locals["Sales Order Item"][row_name]) {
				frappe.msgprint(__("Item row not found on {0}. Reload and try again.", [sales_order]));
				return;
			}
			const frm = {
				doc,
				doctype: "Sales Order",
				is_new: () => false,
				reload_doc() {},
				refresh_field() {},
				fields_dict: {},
			};
			dialog_fn(frm, "Sales Order Item", row_name);
		});
	};

	if (typeof opener() === "function") {
		open();
		return;
	}
	frappe.require("/assets/ss_coil/js/sales_order.js", open);
};

ss_coil.flow_forms.submit = function ($container, handlers = {}) {
	const $host = $($container);
	const doctype = $host.data("ss_coil_flow_doctype");
	const mapped_doc = $host.data("ss_coil_flow_mapped_doc");
	const state =
		doctype === "Stock Entry"
			? $host.data("ss_coil_data_entry_state")
			: $host.data("ss_coil_flow_form_state");
	if (!state) return;

	const payload =
		doctype === "Stock Entry" && ss_coil.stock_entry_data_entry
			? ss_coil.stock_entry_data_entry.collect_payload(state)
			: flow_collect_payload(state);
	if (!payload) return;

	return frappe.call({
		method: "ss_coil.flow_forms.submit_flow_form_document",
		args: {
			doctype,
			name: state.saved_name || null,
			data: payload,
			mapped_doc: mapped_doc && !state.saved_name ? mapped_doc : undefined,
		},
		freeze: true,
		freeze_message: __("Submitting {0}...", [doctype]),
		callback(r) {
			const name = (r.message && r.message.name) || state.saved_name;
			state.saved_name = name;
			$host.removeData("ss_coil_flow_mapped_doc");
			if (handlers.on_submitted) {
				handlers.on_submitted(name, r.message || {});
			} else {
				frappe.show_alert({
					message: __("{0} {1} submitted", [doctype, name]),
					indicator: "green",
				});
			}
		},
	});
};

ss_coil.flow_forms.create_ss_coil_from_sales_order = function (sales_order_name, handlers = {}) {
	return frappe.call({
		method: "ss_coil.api.create_ss_coil_from_sales_order",
		args: { source_name: sales_order_name },
		freeze: true,
		freeze_message: __("Creating SS Coil..."),
		callback(r) {
			if (!r.message) return;
			if (handlers.on_created) {
				handlers.on_created(r.message);
			} else {
				frappe.set_route("Form", "SS Coil", r.message.name);
			}
		},
	});
};

ss_coil.flow_forms.create_sales_order_from_stock_entry = function (stock_entry_name, handlers = {}) {
	if (ss_coil.stock_entry_data_entry && ss_coil.stock_entry_data_entry.create_sales_order) {
		return ss_coil.stock_entry_data_entry.create_sales_order(stock_entry_name, handlers);
	}
	return frappe.call({
		method: "ss_coil.api.create_sales_order_from_stock_entry",
		args: { source_name: stock_entry_name },
		freeze: true,
		freeze_message: __("Preparing Sales Order..."),
		callback(r) {
			if (!r.message) return;
			if (handlers.on_created) handlers.on_created(r.message);
		},
	});
};

ss_coil.flow_forms.sync_mapped_doc = function (doctype, doc, handlers = {}) {
	frappe.model.with_doctype(doctype, () => {
		frappe.model.sync(doc);
		if (handlers.on_created) {
			handlers.on_created(doc);
		} else {
			frappe.set_route("Form", doctype, doc.name);
		}
	});
};

ss_coil.flow_forms.create_stock_entry_from_sales_order = function (sales_order_name, handlers = {}) {
	return frappe.call({
		method: "ss_coil.api.create_stock_entry_from_sales_order",
		args: { source_name: sales_order_name },
		freeze: true,
		freeze_message: __("Preparing Stock Entry..."),
		callback(r) {
			if (!r.message) return;
			ss_coil.flow_forms.sync_mapped_doc("Stock Entry", r.message, handlers);
		},
	});
};

ss_coil.flow_forms.create_delivery_note_from_sales_order = function (sales_order_name, handlers = {}) {
	return frappe.call({
		method: "erpnext.selling.doctype.sales_order.sales_order.make_delivery_note",
		args: { source_name: sales_order_name },
		freeze: true,
		freeze_message: __("Preparing Delivery Note..."),
		callback(r) {
			if (!r.message) return;
			ss_coil.flow_forms.sync_mapped_doc("Delivery Note", r.message, handlers);
		},
	});
};

ss_coil.flow_forms.create_sales_invoice_from_delivery_note = function (delivery_note_name, handlers = {}) {
	return frappe.call({
		method: "erpnext.stock.doctype.delivery_note.delivery_note.make_sales_invoice",
		args: { source_name: delivery_note_name },
		freeze: true,
		freeze_message: __("Preparing Sales Invoice..."),
		callback(r) {
			if (!r.message) return;
			ss_coil.flow_forms.sync_mapped_doc("Sales Invoice", r.message, handlers);
		},
	});
};

ss_coil.flow_forms.open_create_ss_coil_dialog = function (sales_order_name, handlers = {}) {
	frappe.call({
		method: "ss_coil.api.get_sales_order_ss_coil_create_options",
		args: { source_name: sales_order_name },
		freeze: true,
		freeze_message: __("Loading Sales Order items..."),
		callback(r) {
			const options = r.message || [];
			if (!options.length) {
				frappe.msgprint(__("This Sales Order has no coil production lines or items."));
				return;
			}
			options.forEach((row, idx) => {
				row._option_key = row.coil_production_line || row.sales_order_item || `row-${idx}`;
				const code = row.item_code || __("Item");
				const name = row.item_name && row.item_name !== code ? ` — ${row.item_name}` : "";
				const tag = row.tag_no ? ` · ${row.tag_no}` : "";
				row._label = `${idx + 1}. ${code}${name}${tag}`;
				row._processes = row.processes || row.operations || [];
				if (!row._processes.length) {
					row._processes = [__("Slitter")];
				}
			});
			const first = options[0];
			const dialog = new frappe.ui.Dialog({
				title: __("Create SS Coil"),
				fields: [
					{
						fieldname: "production_row",
						label: __("Coil Production / Item"),
						fieldtype: "Select",
						reqd: 1,
						options: options.map((o) => o._label).join("\n"),
						default: first._label,
					},
					{
						fieldname: "item_details",
						fieldtype: "HTML",
					},
					{
						fieldname: "operation",
						label: __("Operation"),
						fieldtype: "Select",
						reqd: 1,
						options: first._processes.join("\n"),
						default: first._processes[0],
					},
				],
				primary_action_label: __("Create"),
				primary_action(values) {
					const row = options.find((o) => o._label === values.production_row) || first;
					if (!row) return;
					frappe.call({
						method: "ss_coil.api.create_ss_coil_from_sales_order",
						args: {
							source_name: sales_order_name,
							sales_order_item: row.sales_order_item,
							operation: values.operation,
							coil_production_line: row.coil_production_line || null,
						},
						freeze: true,
						freeze_message: __("Creating SS Coil..."),
						callback(res) {
							dialog.hide();
							if (!res.message) return;
							ss_coil.flow_forms.sync_mapped_doc("SS Coil", res.message, handlers);
						},
					});
				},
			});

			function apply_row(label) {
				const row = options.find((o) => o._label === label) || first;
				const details = dialog.fields_dict.item_details;
				if (details && details.$wrapper) {
					details.$wrapper.html(
						`<div style="font-size:12px;color:#334155;line-height:1.6;padding:8px 10px;background:#f8fafc;border-radius:8px;border:1px solid #e2e8f0;">
							<div><b>${frappe.utils.escape_html(row.item_code || "-")}</b>${
								row.item_name
									? ` — ${frappe.utils.escape_html(row.item_name)}`
									: ""
							}</div>
							<div>${__("Qty")}: ${frappe.utils.escape_html(String(row.qty ?? "-"))} | ${__(
								"Dimension"
							)}: ${frappe.utils.escape_html(row.dimension || "-")} | ${__("Tag")}: ${frappe.utils.escape_html(
								row.tag_no || "-"
							)}</div>
						</div>`
					);
				}
				const op = dialog.fields_dict.operation;
				op.df.options = row._processes.join("\n");
				op.refresh();
				op.set_value(row._processes[0] || "");
			}

			dialog.fields_dict.production_row.df.onchange = () => apply_row(dialog.get_value("production_row"));
			dialog.show();
			apply_row(first._label);
		},
	});
};

ss_coil.flow_forms.get_linked_sales_order = function (ss_coil_name, callback) {
	frappe.db.get_value("SS Coil", ss_coil_name, "order_no").then((r) => {
		callback((r && r.message && r.message.order_no) || null);
	});
};

ss_coil.flow_forms.set_date_control_value = flow_set_date_control_value;
ss_coil.flow_forms.set_link_control_value = flow_set_link_control_value;
ss_coil.flow_forms.set_parent_values = flow_set_parent_values;
