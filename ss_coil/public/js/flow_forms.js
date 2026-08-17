frappe.provide("ss_coil.flow_forms");

const FLOW_CHILD_GROUPS = [
	{ label: "Item", fields: ["item_code", "custom_finish_good_item", "custom_raw_material_item", "qty", "rate", "received_qty"] },
	{
		label: "Identification",
		fields: ["custom_tag_no", "custom_raw_material_tag_no", "tag_no", "custom_ref_no", "custom_mill", "custom_location", "location"],
	},
	{
		label: "Dimensions",
		fields: ["custom_thickness", "custom_width", "custom_length_c", "custom_length", "custom_dimension", "dimension", "length"],
	},
	{
		label: "Specification",
		fields: ["custom_commodity", "custom_condition", "custom_specification", "custom_estimated_wt", "custom_qty_of_coil", "estimated_wt", "estimated_qty"],
	},
	{
		label: "References",
		fields: ["against_sales_order", "custom_source_stock_entry", "custom_js_number", "custom_hdgc_no"],
	},
	{
		label: "Processing",
		fields: ["slitter", "leveler", "reshearing", "custom_slitter", "custom_leveler", "custom_reshearing", "custom_comments"],
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
		],
	},
];

function flow_form_shell_html(title) {
	return `<div class="ss-coil-de-shell">
		<div class="ss-coil-de-parent-block">
			<div class="ss-coil-de-block-title">
				<span class="ss-coil-de-block-title-text">
					<span class="ss-coil-de-block-icon">${frappe.utils.icon("file", "sm")}</span>
					<span>${frappe.utils.escape_html(title || __("Document Details"))}</span>
				</span>
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

function flow_map_field(df, doctype) {
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
	if (!state.$root) return;
	state.$root.find(".ss-coil-de-row-count").text(state.items.length);
}

function flow_collect_payload(state) {
	const parent_data = state.parent_fg.get_values();
	if (!parent_data) return null;
	const items = [];
	for (const row of state.item_rows) {
		Object.keys(row.controls).forEach((fieldname) => {
			row.item[fieldname] = row.controls[fieldname].get_value();
		});
		const item_payload = { ...row.item };
		if (item_payload.__islocal) {
			delete item_payload.name;
		}
		items.push(item_payload);
	}
	return { ...parent_data, [state.meta.child_table || "items"]: items };
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
					fieldtype: df.fieldtype,
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
			if (state.items.length <= 1) {
				frappe.msgprint(__("At least one item row is required."));
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
	if (!state.items.length) {
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
		: [flow_make_item_row()];
	flow_render_item_rows(state, state.$root.find(".ss-coil-de-table tbody"));
	flow_update_row_count(state);
}

function flow_setup_ui(state, $root, options = {}) {
	state.$root = $root;
	$root.html(flow_form_shell_html(state.meta.title));
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
	const $table = $root.find(".ss-coil-de-table");
	flow_render_table_head(state, $table.find("thead"));
	if (options.document) {
		flow_apply_document_items(state, options.document);
	} else {
		flow_render_item_rows(state, $table.find("tbody"));
		flow_update_row_count(state);
	}

	$root.find(".ss-coil-de-add-row").on("click", () => {
		const item = flow_make_item_row();
		state.items.push(item);
		flow_append_item_row(state, $table.find("tbody"), item, state.items.length - 1);
		flow_update_row_count(state);
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
						options: options.map((o) => o._option_key).join("\n"),
						default: first._option_key,
					},
					{
						fieldname: "operation",
						label: __("Operation"),
						fieldtype: "Select",
						reqd: 1,
						options: (first.operations || []).join("\n"),
						default: (first.operations || [])[0],
					},
				],
				primary_action_label: __("Create"),
				primary_action(values) {
					const row = options.find((o) => o._option_key === values.production_row);
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
			dialog.fields_dict.production_row.df.onchange = () => {
				const row = options.find((o) => o._option_key === dialog.get_value("production_row"));
				if (!row) return;
				dialog.fields_dict.operation.df.options = (row.operations || []).join("\n");
				dialog.fields_dict.operation.set_value((row.operations || [])[0] || "");
				dialog.fields_dict.operation.refresh();
			};
			dialog.show();
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
