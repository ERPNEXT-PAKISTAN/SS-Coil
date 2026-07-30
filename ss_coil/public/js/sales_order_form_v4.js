/* ss_coil cutting-scheme-report-v4 */
frappe.ui.form.on("Sales Order", {
	setup(frm) {
		apply_ss_coil_sales_order_header_defaults(frm);
		load_process_charge_catalog(frm);
	},
	refresh(frm) {
		bind_live_dimension_events(frm);
		add_sales_order_tag_buttons(frm);
		frappe.require("/assets/ss_coil/js/coil_detail_print.js", () => {
			add_coil_detail_print_button(frm);
		});
		hide_sales_order_job_sheet_extra_fields(frm);
		render_sales_order_job_sheet_report(frm);
		add_sales_order_job_sheet_print_button(frm);
		add_sales_order_create_stock_entry_button(frm);
		add_sales_order_create_ss_coil_button(frm);
		render_sales_order_dashboard(frm);
		render_packing_detail(frm);
		render_cutting_scheme_report(frm);
		add_production_planning_report_button(frm);
		load_process_charge_catalog(frm);
		configure_sales_order_cutting_scheme_ui(frm);
		style_coil_production_grid(frm);
		reapply_stock_entry_coil_fields_to_sales_order(frm);
		if (!frm.is_new() && !frm.doc.__islocal) {
			// Keep charge markers readable in grid without cluttering.
			frm.fields_dict.items?.grid?.update_docfield_property?.("custom_is_process_charge", "hidden", 1);
		}
		// Do not client-sync process charges on refresh — that recreated duplicates.
	},
	validate(frm) {
		(frm.doc.items || []).forEach((row) => {
			set_custom_dimension_from_values(row.doctype, row.name);
		});
		// Process charges are synced server-side on before_validate only.
	},
	items_add(frm, cdt, cdn) {
		apply_ss_coil_sales_order_row_defaults(frm, cdt, cdn);
	},
	items_remove(frm) {
		// Charge lines are rebuilt on Save by the server if processes are set.
	},
});

const SS_COIL_DEFAULT_WAREHOUSE = "Stores - SSC";
const SS_COIL_DEFAULT_LENGTH_C = "C";

const SO_JOB_SHEET_HTML_FIELD = "custom_job_sheet_report";

function hide_sales_order_job_sheet_extra_fields(frm) {
	// Keep only the main HTML report under the Job Sheet tab.
	Object.keys(frm.fields_dict || {}).forEach((fieldname) => {
		if (!fieldname || !fieldname.includes("job_sheet")) {
			return;
		}
		if (fieldname === "custom_job_sheet_tab" || fieldname === SO_JOB_SHEET_HTML_FIELD) {
			frm.set_df_property(fieldname, "hidden", 0);
			return;
		}
		frm.set_df_property(fieldname, "hidden", 1);
	});
}

function get_sales_order_job_sheet_field(frm) {
	const field = frm.fields_dict[SO_JOB_SHEET_HTML_FIELD];
	if (field && field.$wrapper) {
		return field;
	}
	return null;
}

function so_job_sheet_placeholder(message) {
	return `<div style="padding:18px;border:1px dashed #cbd5e1;border-radius:12px;color:#64748b;font-size:13px;background:#f8fafc;">${escape_html(
		message || __("No job sheet to display.")
	)}</div>`;
}

function render_sales_order_job_sheet_report(frm) {
	const field = get_sales_order_job_sheet_field(frm);
	if (!field) {
		return;
	}
	frappe.require("/assets/ss_coil/css/job_sheet_report.css");
	if (!frm.doc.name || (frm.is_new && frm.is_new())) {
		field.$wrapper.html(so_job_sheet_placeholder(__("Save the Sales Order to load the job sheet.")));
		return;
	}
	frappe.call({
		method: "ss_coil.sales_order_job_sheet_print.get_sales_order_job_sheet_html",
		args: { sales_order: frm.doc.name },
		callback(r) {
			field.$wrapper.html(r.message || "");
			field.$wrapper.find(".ss-coil-print-so-job-sheet").on("click", function () {
				print_sales_order_job_sheet(frm);
			});
		},
		error() {
			field.$wrapper.html(so_job_sheet_placeholder(__("Could not load job sheet report.")));
		},
	});
}

function print_sales_order_job_sheet(frm) {
	const field = get_sales_order_job_sheet_field(frm);
	if (!field || !field.$wrapper || !field.$wrapper.html()) {
		return;
	}
	const content = field.$wrapper.find(".ss-coil-so-job-sheet-root").length
		? field.$wrapper.find(".ss-coil-so-job-sheet-root").parent().html()
		: field.$wrapper.html();
	const win = window.open("");
	if (!win) {
		frappe.msgprint(__("Please enable pop-ups to print the job sheet."));
		return;
	}
	win.document.write(
		`<!DOCTYPE html><html><head><meta charset="utf-8"><title>${escape_html(
			frm.doc.name
		)}</title>` +
			`<link rel="stylesheet" href="${frappe.urllib.get_full_url("/assets/ss_coil/css/job_sheet_report.css")}">` +
			`<style>@page{size:A4 landscape;margin:8mm;} body{margin:0;padding:12px;}</style></head><body>${content}` +
			`<script>window.onload=function(){window.print();}<\/script></body></html>`
	);
	win.document.close();
}

function add_sales_order_job_sheet_print_button(frm) {
	if (!frm.doc.name || (frm.is_new && frm.is_new())) {
		return;
	}
	if (!get_sales_order_job_sheet_field(frm)) {
		return;
	}
	frm.add_custom_button(
		__("Job Sheet"),
		function () {
			print_sales_order_job_sheet(frm);
		},
		__("Print")
	);
}

function add_production_planning_report_button(frm) {
	if (!frm.doc.name || (frm.is_new && frm.is_new())) {
		return;
	}
	frm.add_custom_button(
		__("Production Planning"),
		function () {
			frappe.set_route("query-report", "Production Planning", {
				sales_order: frm.doc.name,
			});
		},
		__("Reports")
	);
}

function apply_ss_coil_sales_order_header_defaults(frm) {
	if (!frm.is_new()) {
		return;
	}
	if (frm.fields_dict.custom_source_warehouse && !frm.doc.custom_source_warehouse) {
		frm.set_value("custom_source_warehouse", SS_COIL_DEFAULT_WAREHOUSE);
	}
	if (frm.fields_dict.set_warehouse && !frm.doc.set_warehouse) {
		frm.set_value("set_warehouse", SS_COIL_DEFAULT_WAREHOUSE);
	}
}

function apply_ss_coil_sales_order_row_defaults(frm, cdt, cdn) {
	const row = locals[cdt] && locals[cdt][cdn];
	if (!row) {
		return;
	}
	if (row.custom_length_c === undefined || row.custom_length_c === null || row.custom_length_c === "") {
		frappe.model.set_value(cdt, cdn, "custom_length_c", SS_COIL_DEFAULT_LENGTH_C);
		set_custom_dimension_from_values(cdt, cdn);
	}
	if (row.warehouse) {
		return;
	}
	frappe.model.set_value(
		cdt,
		cdn,
		"warehouse",
		frm.doc.custom_source_warehouse || frm.doc.set_warehouse || SS_COIL_DEFAULT_WAREHOUSE
	);
}

function add_sales_order_create_stock_entry_button(frm) {
	if (frm.is_new() || !(frm.doc.items || []).length) return;

	frm.add_custom_button(
		__("Create Stock Entry"),
		function () {
			frappe.model.open_mapped_doc({
				method: "ss_coil.api.create_stock_entry_from_sales_order",
				frm: frm,
			});
		},
		__("Create")
	);

	if (frm.fields_dict.custom_source_stock_entries) {
		frm.add_custom_button(
			__("Sync Stock Entry Links"),
			function () {
				frappe.call({
					method: "ss_coil.api.sync_sales_order_stock_entry_links",
					args: { sales_order: frm.doc.name },
					freeze: true,
					freeze_message: __("Syncing..."),
					callback(r) {
						const msg = r.message || {};
						if (frm.fields_dict.custom_source_stock_entries) {
							frm.doc.custom_source_stock_entries = msg.custom_source_stock_entries || "";
							frm.refresh_field("custom_source_stock_entries");
						}
						if (frm.fields_dict.custom_igp_no && msg.custom_igp_no !== undefined) {
							frm.doc.custom_igp_no = msg.custom_igp_no || "";
							frm.refresh_field("custom_igp_no");
						}
						const itemUpdates = msg.item_updates || {};
						(frm.doc.items || []).forEach((row) => {
							const patch = itemUpdates[row.name];
							if (!patch) return;
							Object.keys(patch).forEach((fieldname) => {
								row[fieldname] = patch[fieldname];
							});
						});
						frm.refresh_field("items");
						const lineCount = Object.keys(itemUpdates).length;
						frappe.show_alert({
							message: lineCount
								? __("Stock Entry links and tags synced ({0} line(s))", [lineCount])
								: __("Stock Entry links synced"),
							indicator: "green",
						});
					},
				});
			},
			__("Sync")
		);
	}
}

function add_sales_order_create_ss_coil_button(frm) {
	if (frm.is_new() || !(frm.doc.items || []).length) return;

	frm.add_custom_button(
		__("Create SS Coil"),
		function () {
			const production = frm.doc.custom_coil_production || [];
			if (production.length === 1) {
				open_ss_coil_from_sales_order(
					frm.doc.name,
					production[0].sales_order_item,
					null,
					production[0].name
				);
				return;
			}
			if (!production.length) {
				const items = (frm.doc.items || []).filter(
					(row) => !cint(row.custom_is_process_charge) && !row.custom_process_charge_key
				);
				if (items.length === 1) {
					open_ss_coil_from_sales_order(frm.doc.name, items[0].name);
					return;
				}
			}
			open_sales_order_ss_coil_item_dialog(frm);
		},
		__("Create")
	);

	frm.add_custom_button(
		__("View SS Coil"),
		function () {
			frappe.set_route("List", "SS Coil", { order_no: frm.doc.name });
		},
		__("Create")
	);
}

function open_ss_coil_from_sales_order(sales_order, sales_order_item, operation, coil_production_line) {
	frappe.call({
		method: "ss_coil.api.create_ss_coil_from_sales_order",
		args: {
			source_name: sales_order,
			sales_order_item,
			operation,
			coil_production_line: coil_production_line || null,
		},
		freeze: true,
		freeze_message: __("Preparing SS Coil..."),
		callback(r) {
			if (!r.message) return;
			frappe.model.sync(r.message);
			frappe.set_route("Form", "SS Coil", r.message.name);
		},
	});
}

function open_sales_order_ss_coil_item_dialog(frm) {
	frappe.call({
		method: "ss_coil.api.get_sales_order_ss_coil_create_options",
		args: { source_name: frm.doc.name },
		freeze: true,
		freeze_message: __("Loading Sales Order items..."),
		callback(r) {
			const options = r.message || [];
			if (!options.length) {
				frappe.msgprint(__("This Sales Order has no coil production lines or items."));
				return;
			}

			const optionKeys = options.map((row, idx) => {
				row._option_key =
					row.coil_production_line || row.sales_order_item || `row-${idx}`;
				return row._option_key;
			});

			const fields = [
				{
					fieldname: "production_row",
					label: __("Coil Production / Item"),
					fieldtype: "Select",
					reqd: 1,
					options: optionKeys.join("\n"),
				},
				{
					fieldname: "item_details",
					fieldtype: "HTML",
					label: __("Item Details"),
				},
				{
					fieldname: "operation",
					label: __("Operation"),
					fieldtype: "Select",
					reqd: 1,
				},
				{
					fieldname: "existing_html",
					fieldtype: "HTML",
					label: __("Existing SS Coil"),
				},
			];

			const dialog = new frappe.ui.Dialog({
				title: __("Create SS Coil"),
				fields,
				primary_action_label: __("Create"),
				primary_action(values) {
					dialog.hide();
					const row =
						options.find((entry) => entry._option_key === values.production_row) ||
						options[0];
					open_ss_coil_from_sales_order(
						frm.doc.name,
						row.sales_order_item,
						values.operation,
						row.coil_production_line
					);
				},
			});

			const itemField = dialog.fields_dict.production_row;
			const detailsField = dialog.fields_dict.item_details;
			const operationField = dialog.fields_dict.operation;
			const existingField = dialog.fields_dict.existing_html;

			function renderExisting(optionKey) {
				const row = options.find((entry) => entry._option_key === optionKey) || options[0];
				const processes = row.processes || ["Slitter"];
				detailsField.$wrapper.html(
					`<div style="font-size:12px;color:#334155;line-height:1.6;padding:8px 10px;background:#f8fafc;border-radius:8px;border:1px solid #e2e8f0;">
						<div><b>${frappe.utils.escape_html(row.item_code || "-")}</b> — ${frappe.utils.escape_html(
							row.item_name || ""
						)}</div>
						<div>${__("Qty")}: ${frappe.utils.escape_html(String(row.qty ?? "-"))} | ${__(
							"Dimension"
						)}: ${frappe.utils.escape_html(row.dimension || "-")} | ${__("Tag")}: ${frappe.utils.escape_html(
							row.tag_no || "-"
						)}</div>
					</div>`
				);
				operationField.df.options = processes.join("\n");
				operationField.set_value(processes[0]);
				operationField.refresh();

				const existing = row.existing_ss_coils || [];
				if (!existing.length) {
					existingField.$wrapper.html(
						`<div style="font-size:12px;color:#64748b;padding:6px 0;">${__(
							"No SS Coil yet for this production line."
						)}</div>`
					);
					return;
				}
				existingField.$wrapper.html(
					`<div style="font-size:12px;line-height:1.7;">${existing
						.map(
							(e) =>
								`<div><a href="/app/ss-coil/${encodeURIComponent(e.name)}">${frappe.utils.escape_html(
									e.name
								)}</a> — ${frappe.utils.escape_html(e.operation || "-")} (${frappe.utils.escape_html(
									e.order_status || "-"
								)})</div>`
						)
						.join("")}</div>`
				);
			}

			itemField.df.onchange = () => renderExisting(itemField.get_value());
			dialog.show();
			itemField.set_value(optionKeys[0]);
			renderExisting(optionKeys[0]);
		},
	});
}

frappe.ui.form.on("Coil Production Line", {
	slitter(frm) {
		sync_sales_order_process_charge_lines(frm);
	},
	leveler(frm) {
		sync_sales_order_process_charge_lines(frm);
	},
	reshearing(frm) {
		sync_sales_order_process_charge_lines(frm);
	},
	qty(frm) {
		sync_sales_order_process_charge_lines(frm);
	},
	finish_good_item(frm, cdt, cdn) {
		const row = locals[cdt][cdn];
		if (row.finish_good_item) {
			frappe.db.get_value("Item", row.finish_good_item, "item_name", (r) => {
				if (r && r.item_name) {
					frappe.model.set_value(cdt, cdn, "item_name", r.item_name);
				}
			});
		}
		sync_sales_order_process_charge_lines(frm);
	},
	thickness(frm, cdt, cdn) {
		set_production_line_dimension(cdt, cdn);
	},
	width(frm, cdt, cdn) {
		set_production_line_dimension(cdt, cdn);
	},
	length_c(frm, cdt, cdn) {
		set_production_line_dimension(cdt, cdn);
	},
	length(frm, cdt, cdn) {
		set_production_line_dimension(cdt, cdn);
	},
	form_render(frm, cdt, cdn) {
		if (is_unsaved_sales_order_context(frm, cdn)) {
			const grid_row = frm.fields_dict.custom_coil_production?.grid?.grid_rows_by_docname?.[cdn];
			const wrapper = grid_row?.grid_form?.fields_dict?.cutting_scheme_preview?.$wrapper;
			if (wrapper) {
				wrapper.html(
					`<div class="text-muted">${__(
						"Save the Sales Order, then use Manage Cutting Scheme on this Mother Coil / Raw row."
					)}</div>`
				);
			}
			return;
		}
		render_production_cutting_scheme_preview(frm, cdt, cdn);
	},
	manage_cutting_scheme(frm, cdt, cdn) {
		open_cutting_scheme_dialog(frm, cdt, cdn, { from_production: true });
	},
});

function set_production_line_dimension(cdt, cdn) {
	const row = locals[cdt][cdn];
	const parts = [row.thickness, row.width, row.length_c || row.length]
		.filter((v) => v !== undefined && v !== null && v !== "")
		.map((v) => String(v).trim())
		.filter(Boolean);
	frappe.model.set_value(cdt, cdn, "dimension", parts.join(" x "));
}

function is_unsaved_sales_order_context(frm, rowName) {
	if (!frm || !frm.doc) {
		return true;
	}
	if ((frm.is_new && frm.is_new()) || frm.doc.__islocal) {
		return true;
	}
	const name = String(frm.doc.name || "");
	if (!name || name.startsWith("new-sales-order-") || name.startsWith("new-")) {
		return true;
	}
	const row = String(rowName || "");
	if (row.startsWith("new-sales-order-item-") || row.startsWith("new-coil-production-line-") || row.startsWith("new-")) {
		return true;
	}
	return false;
}

function style_coil_production_grid(frm) {
	const grid = frm.fields_dict.custom_coil_production?.grid;
	if (!grid?.wrapper) {
		return;
	}
	const $wrap = $(grid.wrapper);
	if ($wrap.data("ss-coil-grid-styled")) {
		return;
	}
	$wrap.data("ss-coil-grid-styled", 1);
	$wrap.find("style.ss-coil-prod-grid-style").remove();
	$wrap.prepend(`<style class="ss-coil-prod-grid-style">
		[data-fieldname="custom_coil_production"] .grid-heading-row {
			background: linear-gradient(180deg, #243b53 0%, #2f4a66 100%) !important;
			color: #f8fbff !important;
			border-radius: 8px 8px 0 0;
		}
		[data-fieldname="custom_coil_production"] .grid-heading-row .grid-static-col,
		[data-fieldname="custom_coil_production"] .grid-heading-row .row-check,
		[data-fieldname="custom_coil_production"] .grid-heading-row .row-index {
			color: #f8fbff !important;
			font-weight: 700 !important;
			font-size: 12px !important;
			letter-spacing: .02em;
		}
		[data-fieldname="custom_coil_production"] .grid-row:nth-child(even) .data-row {
			background: #f7fafc;
		}
		[data-fieldname="custom_coil_production"] .grid-row .data-row:hover {
			background: #eef5ff !important;
		}
		[data-fieldname="custom_coil_production"] .form-in-grid {
			background: #fbfcfe;
			border: 1px solid #d7e3ef;
			border-radius: 10px;
			padding: 8px 10px 4px;
		}
		[data-fieldname="custom_coil_production"] .ss-coil-cutting-preview {
			max-width: 100%;
		}
	</style>`);
}

function configure_sales_order_cutting_scheme_ui(frm) {
	const hasProduction = (frm.doc.custom_coil_production || []).length > 0;
	const itemGrid = frm.fields_dict.items?.grid;
	if (itemGrid?.update_docfield_property) {
		// Manage Cutting Scheme stays on Coil Production (mother coil / raw), not FG Items.
		itemGrid.update_docfield_property("custom_manage_cutting_scheme", "hidden", hasProduction ? 1 : 0);
		itemGrid.update_docfield_property("custom_cutting_scheme_preview_section", "hidden", hasProduction ? 1 : 0);
		itemGrid.update_docfield_property("custom_cutting_scheme_preview", "hidden", hasProduction ? 1 : 0);
		// Packing lives on Coil Production — hide packing section on Finish Good items
		[
			"custom_packing_detail",
			"custom_packing_type",
			"custom_packing_weightsize",
			"custom_no_of_pack",
			"custom_packing_remarks",
			"custom_packing_comments",
		].forEach((fieldname) => {
			itemGrid.update_docfield_property(fieldname, "hidden", hasProduction ? 1 : 0);
		});
	}
	// Always show the SO Cutting Scheme Report (read-only summary).
	if (frm.set_df_property) {
		frm.set_df_property("custom_cutting_scheme_report_section", "hidden", 0);
		frm.set_df_property("custom_cutting_scheme_report", "hidden", 0);
	}
}

function production_row_as_cutting_context(row) {
	return {
		name: row.sales_order_item || row.name,
		// Cutting scheme is for mother coil / raw — not Finish Good
		item_code: row.raw_material_item || row.finish_good_item,
		item_name: row.raw_material_item || row.item_name || row.finish_good_item,
		qty: row.qty,
		custom_tag_no: row.raw_material_tag_no || row.tag_no,
		custom_ref_no: row.ref_no,
		custom_thickness: row.thickness,
		custom_width: row.width,
		custom_length: row.length,
		custom_length_c: row.length_c,
		custom_slitter: row.slitter,
		custom_leveler: row.leveler,
		custom_reshearing: row.reshearing,
		_coil_production_line: row.name,
		_raw_material_item: row.raw_material_item,
		_raw_material_tag_no: row.raw_material_tag_no,
		_finish_good_item: row.finish_good_item,
	};
}

function add_sales_order_tag_buttons(frm) {
	if (!frm.doc.name || (frm.is_new && frm.is_new())) return;

	frm.add_custom_button(__("Tag Registry"), function () {
		frappe.set_route("List", "Tag Registry", { sales_order: frm.doc.name });
	}, __("Tags"));

	frm.add_custom_button(__("Link Parent Tags"), function () {
		open_sales_order_parent_tag_dialog(frm);
	}, __("Tags"));

	const tags = [...new Set((frm.doc.items || []).map((row) => row.custom_tag_no).filter(Boolean))];
	if (tags.length === 1) {
		frm.add_custom_button(__("Open Tag"), function () {
			frappe.set_route("Form", "Tag Registry", tags[0]);
		}, __("Tags"));
	} else if (tags.length > 1) {
		frm.add_custom_button(__("Open Item Tags"), function () {
			frappe.set_route("List", "Tag Registry", { sales_order: frm.doc.name });
		}, __("Tags"));
	}
}

frappe.ui.form.on("Sales Order Item", {
	item_code(frm, cdt, cdn) {
		const row = locals[cdt][cdn];
		if (is_process_charge_row(row)) {
			return;
		}
		const preserved = snapshot_so_item_coil_fields(row);
		apply_ss_coil_sales_order_row_defaults(frm, cdt, cdn);
		apply_sales_order_item_coil_defaults(frm, cdt, cdn);
		sync_sales_order_process_charge_lines(frm);
		if (row.custom_source_stock_entry_detail) {
			// item_code / get_item_details can clear mapped SE coil values — restore them.
			setTimeout(() => restore_so_item_coil_fields(cdt, cdn, preserved), 400);
			setTimeout(() => reapply_stock_entry_coil_fields_to_sales_order(frm), 700);
		}
	},
	qty(frm, cdt, cdn) {
		const row = locals[cdt][cdn];
		if (is_process_charge_row(row)) {
			return;
		}
		sync_sales_order_process_charge_lines(frm);
	},
	custom_slitter(frm, cdt, cdn) {
		const row = locals[cdt][cdn];
		if (is_process_charge_row(row)) {
			return;
		}
		sync_sales_order_process_charge_lines(frm);
	},
	custom_leveler(frm, cdt, cdn) {
		const row = locals[cdt][cdn];
		if (is_process_charge_row(row)) {
			return;
		}
		sync_sales_order_process_charge_lines(frm);
	},
	custom_reshearing(frm, cdt, cdn) {
		const row = locals[cdt][cdn];
		if (is_process_charge_row(row)) {
			return;
		}
		sync_sales_order_process_charge_lines(frm);
	},
	custom_raw_material_item(frm, cdt, cdn) {
		if (frm.__ss_coil_applying_se_fields) {
			return;
		}
		frappe.model.set_value(cdt, cdn, "custom_raw_material_tag_no", "");
		frappe.model.set_value(cdt, cdn, "custom_raw_material_batch_no", "");
	},
	custom_stock_source_type(frm, cdt, cdn) {
		if (frm.__ss_coil_applying_se_fields) {
			return;
		}
		const row = locals[cdt][cdn];
		frappe.model.set_value(cdt, cdn, "custom_raw_material_tag_no", "");
		frappe.model.set_value(cdt, cdn, "custom_raw_material_batch_no", "");
		if (row.custom_stock_source_type === STOCK_SOURCE_PURCHASE_RECEIPTS && !row.custom_raw_material_item) {
			apply_sales_order_item_coil_defaults(frm, cdt, cdn);
		}
	},
	custom_thickness(frm, cdt, cdn) {
		set_custom_dimension_from_values(cdt, cdn);
	},
	custom_width(frm, cdt, cdn) {
		set_custom_dimension_from_values(cdt, cdn);
	},
	custom_length_c(frm, cdt, cdn) {
		set_custom_dimension_from_values(cdt, cdn);
	},
	form_render(frm, cdt, cdn) {
		// Cutting scheme lives on Coil Production (raw). Skip SO Item preview
		// especially on unsaved mapped docs (avoids parent DocType permission error).
		if ((frm.doc.custom_coil_production || []).length) {
			return;
		}
		if (is_unsaved_sales_order_context(frm, cdn)) {
			return;
		}
		render_item_cutting_scheme_preview(frm, cdt, cdn);
	},
	custom_manage_cutting_scheme(frm, cdt, cdn) {
		if ((frm.doc.custom_coil_production || []).length) {
			frappe.msgprint(
				__("Use Manage Cutting Scheme on the Coil Production (Mother Coil / Raw) row.")
			);
			return;
		}
		open_cutting_scheme_dialog(frm, cdt, cdn);
	},
	custom_select_raw_material_tag(frm, cdt, cdn) {
		open_raw_material_tag_dialog(frm, cdt, cdn);
	},
});

const SO_ITEM_COIL_PRESERVE_FIELDS = [
	"custom_raw_material_item",
	"custom_raw_material_tag_no",
	"custom_raw_material_batch_no",
	"custom_stock_source_type",
	"custom_source_stock_entry",
	"custom_source_stock_entry_detail",
	"custom_tag_no",
	"custom_sub_tag_no",
	"custom_child_tag_no",
	"custom_entry_no",
	"custom_mill",
	"custom_location",
	"custom_ref_no",
	"custom_js_number",
	"custom_hdgc_no",
	"custom_po_no",
	"custom_thickness",
	"custom_width",
	"custom_length",
	"custom_length_c",
	"custom_dimension",
	"custom_estimated_wt",
	"custom_qty_of_coil",
	"custom_for_customer",
	"custom_commodity",
	"custom_specification",
	"custom_condition",
	"custom_remarks",
	"custom_comments",
	"custom_slitter",
	"custom_leveler",
	"custom_reshearing",
	"custom_packing_type",
	"custom_packing_weightsize",
	"custom_no_of_pack",
	"custom_packing_remarks",
	"custom_packing_comments",
	"custom_machine",
	"custom_calc_ratio",
	"custom_calc_ratio_2",
	"custom_actual_ratio",
	"custom_remaining_width",
];

function snapshot_so_item_coil_fields(row) {
	const out = {};
	SO_ITEM_COIL_PRESERVE_FIELDS.forEach((fieldname) => {
		const value = row[fieldname];
		if (value !== undefined && value !== null && value !== "") {
			out[fieldname] = value;
		}
	});
	return out;
}

function restore_so_item_coil_fields(cdt, cdn, preserved) {
	const row = locals[cdt] && locals[cdt][cdn];
	if (!row || !preserved) return;
	Object.keys(preserved).forEach((fieldname) => {
		const current = row[fieldname];
		const empty =
			current === undefined ||
			current === null ||
			current === "" ||
			(typeof current === "number" && !current && preserved[fieldname]);
		if (empty) {
			frappe.model.set_value(cdt, cdn, fieldname, preserved[fieldname]);
		}
	});
}

function reapply_stock_entry_coil_fields_to_sales_order(frm) {
	if (!frm || !frm.doc) return;
	if (!(frm.is_new && frm.is_new()) && !frm.doc.__islocal) {
		// Only auto-reapply on unsaved mapped docs (or when explicitly from SE create)
		if (!frm.doc.__ss_coil_from_stock_entry) {
			return;
		}
	}

	const stockEntries = [
		frm.doc.__ss_coil_from_stock_entry,
		frm.doc.custom_source_stock_entries,
		...((frm.doc.items || []).map((r) => r.custom_source_stock_entry).filter(Boolean)),
		...((frm.doc.custom_coil_production || []).map((r) => r.source_stock_entry).filter(Boolean)),
	].filter(Boolean);
	const stockEntry = stockEntries[0];
	if (!stockEntry) return;

	// Avoid loops; still re-run when mapped coil fields were wiped (e.g. by item_code)
	const needsRefill = (frm.doc.items || []).some(
		(r) =>
			r.custom_source_stock_entry_detail &&
			!r.custom_mill &&
			!r.custom_raw_material_item &&
			!r.custom_thickness
	);
	if (frm.__ss_coil_reapplying_se_fields) return;
	if (frm.__ss_coil_se_fields_applied && !needsRefill) return;
	frm.__ss_coil_reapplying_se_fields = true;

	frappe.call({
		method: "ss_coil.api.get_stock_entry_coil_field_map",
		args: { stock_entry: stockEntry },
		callback(r) {
			frm.__ss_coil_reapplying_se_fields = false;
			const map = r.message || {};
			if (!Object.keys(map).length) return;

			frm.__ss_coil_applying_se_fields = true;
			(frm.doc.items || []).forEach((row) => {
				const detail = row.custom_source_stock_entry_detail;
				const payload = detail && map[detail] ? map[detail].sales_order_item : null;
				if (!payload) return;
				Object.keys(payload).forEach((fieldname) => {
					if (fieldname === "item_code") return; // keep FG already set
					const value = payload[fieldname];
					if (value === undefined || value === null || value === "") return;
					const current = row[fieldname];
					const empty =
						current === undefined ||
						current === null ||
						current === "" ||
						(typeof current === "number" && !current && value);
					if (empty) {
						frappe.model.set_value(row.doctype, row.name, fieldname, value);
					}
				});
			});

			(frm.doc.custom_coil_production || []).forEach((row) => {
				const detail = row.source_stock_entry_detail;
				const payload = detail && map[detail] ? map[detail].coil_production : null;
				if (!payload) return;
				Object.keys(payload).forEach((fieldname) => {
					const value = payload[fieldname];
					if (value === undefined || value === null || value === "") return;
					const current = row[fieldname];
					const empty =
						current === undefined ||
						current === null ||
						current === "" ||
						(typeof current === "number" && !current && value);
					if (empty) {
						frappe.model.set_value(row.doctype, row.name, fieldname, value);
					}
				});
			});

			frm.refresh_field("items");
			frm.refresh_field("custom_coil_production");
			frm.__ss_coil_se_fields_applied = true;
			setTimeout(() => {
				frm.__ss_coil_applying_se_fields = false;
			}, 300);
		},
		error() {
			frm.__ss_coil_reapplying_se_fields = false;
			frm.__ss_coil_applying_se_fields = false;
		},
	});
}

const PROCESS_CHARGE_FIELDS = ["custom_slitter", "custom_leveler", "custom_reshearing"];
const PROCESS_CHARGE_KEYS = ["slitter", "leveler", "reshearing"];
let _process_charge_catalog = null;
let _process_charge_syncing = false;
let _process_charge_sync_token = 0;

function load_process_charge_catalog(frm) {
	if (_process_charge_catalog) {
		return;
	}
	frappe.call({
		method: "ss_coil.process_charges.get_process_charge_catalog",
		callback(r) {
			_process_charge_catalog = r.message || {};
		},
		error() {
			_process_charge_catalog = _process_charge_catalog || {};
		},
	});
}

function is_process_charge_row(row) {
	if (cint(row.custom_is_process_charge) || !!row.custom_process_charge_key) {
		return true;
	}
	const code = row.item_code;
	if (!code || !_process_charge_catalog) {
		return false;
	}
	return Object.values(_process_charge_catalog).some((meta) => meta && meta.item_code === code);
}

function enabled_processes_for_row(row, useCustomPrefix = true) {
	const enabled = [];
	PROCESS_CHARGE_KEYS.forEach((key) => {
		const value = useCustomPrefix ? row[`custom_${key}`] : row[key];
		if (value !== undefined && value !== null && String(value).trim() !== "") {
			enabled.push(key);
		}
	});
	return enabled;
}

function sync_sales_order_process_charge_lines(frm) {
	// Intentionally a no-op for add/remove.
	// Browser-side add_child / gridRow.remove raced with Save and recreated
	// duplicate Slitting/Leveling/Reshearing rows after every save.
	// Process charge lines are maintained only on the server
	// (before_validate → sync_sales_order_process_charge_lines).
	return;
}

function apply_process_charge_row_values(frm, row, source, processKey, catalog, setRate) {
	const meta = catalog[processKey] || {};
	const label = meta.label || processKey;
	const description = __("{0} charge for {1}", [
		label,
		source.item_name || source.item_code || source.name,
	]);
	row.custom_is_process_charge = 1;
	row.custom_process_charge_key = processKey;
	row.custom_process_charge_source = source.name;
	row.item_code = meta.item_code;
	row.item_name = meta.item_name || meta.item_code;
	row.qty = flt(source.qty) || 1;
	row.description = description;
	if (setRate || !flt(row.rate)) {
		row.rate = flt(meta.rate);
	}
}

const STOCK_SOURCE_PURCHASE_RECEIPTS = "Purchase Receipts";
const STOCK_SOURCE_STOCK_ENTRY = "Stock Entry";

function apply_sales_order_item_coil_defaults(frm, cdt, cdn) {
	const row = locals[cdt] && locals[cdt][cdn];
	if (!row || !row.item_code) return;

	frappe.call({
		method: "ss_coil.api.get_item_coil_defaults",
		args: { item_code: row.item_code },
		callback(r) {
			const defaults = r.message || {};
			if (defaults.custom_default_raw_material_item && !row.custom_raw_material_item) {
				frappe.model.set_value(cdt, cdn, "custom_raw_material_item", defaults.custom_default_raw_material_item);
			}
			if (defaults.custom_ss_coil_item_type === "Raw Material" && !row.custom_stock_source_type) {
				frappe.model.set_value(cdt, cdn, "custom_stock_source_type", STOCK_SOURCE_PURCHASE_RECEIPTS);
			}
			if (["Finished Good", "Semi Finished"].includes(defaults.custom_ss_coil_item_type) && !row.custom_stock_source_type) {
				frappe.model.set_value(cdt, cdn, "custom_stock_source_type", STOCK_SOURCE_PURCHASE_RECEIPTS);
			}
		},
		error() {
			// Ignore if API is unavailable during reload; item defaults are optional.
		},
	});
}

function open_raw_material_tag_dialog(frm, cdt, cdn) {
	const row = locals[cdt] && locals[cdt][cdn];
	if (!row) return;

	if (!row.custom_raw_material_item) {
		frappe.msgprint(__("Select a Raw Material Item before choosing a parent tag."));
		return;
	}
	if (!row.custom_stock_source_type) {
		frappe.msgprint(__("Select Stock Source (Purchase Receipts or Stock Entry) before choosing a parent tag."));
		return;
	}

	frappe.call({
		method: "ss_coil.api.get_available_raw_material_tags",
		args: {
			sales_order: frm.doc.name,
			sales_order_item: row.name,
			raw_material_item: row.custom_raw_material_item,
			stock_source_type: row.custom_stock_source_type,
		},
		freeze: true,
		freeze_message: __("Loading available parent tags..."),
		callback(r) {
			const payload = r.message || {};
			const tags = payload.tags || [];
			if (!tags.length) {
				const source_label =
					row.custom_stock_source_type === STOCK_SOURCE_PURCHASE_RECEIPTS
						? __("Purchase Receipts")
						: row.custom_stock_source_type === STOCK_SOURCE_STOCK_ENTRY
							? __("Stock Entry")
							: row.custom_stock_source_type;
				frappe.msgprint({
					title: __("No Parent Tags Available"),
					message: __(
						"No unassigned parent tags were found for {0} from {1}. Receive the raw material first.",
						[row.custom_raw_material_item, source_label],
					),
					indicator: "orange",
				});
				return;
			}
			show_raw_material_tag_picker_dialog(frm, cdt, cdn, row, tags);
		},
	});
}

function show_raw_material_tag_picker_dialog(frm, cdt, cdn, row, tags) {
	const dialog = new frappe.ui.Dialog({
		title: __("Select Raw Material Tag"),
		size: "extra-large",
		fields: [
			{
				fieldtype: "HTML",
				fieldname: "tag_picker_html",
			},
		],
		primary_action_label: __("Close"),
		primary_action() {
			dialog.hide();
		},
	});

	const rows_html = tags
		.map((tag) => {
			const source_label =
				tag.stock_source_type ||
				(tag.source_doctype === "Purchase Receipt"
					? STOCK_SOURCE_PURCHASE_RECEIPTS
					: tag.source_doctype === "Stock Entry"
						? STOCK_SOURCE_STOCK_ENTRY
						: "-");
			return `
				<tr>
					<td><b>${escape_html(tag.tag_no || "-")}</b></td>
					<td>${escape_html(tag.batch_no || "-")}</td>
					<td>${escape_html(tag.dimension || "-")}</td>
					<td>${escape_html(tag.specification || "-")}</td>
					<td>${escape_html(String(tag.estimated_wt || "-"))}</td>
					<td>${escape_html(source_label)}</td>
					<td>${escape_html(tag.source_docname || tag.current_docname || "-")}</td>
					<td>
						<button class="btn btn-xs btn-primary ss-coil-pick-tag" data-tag-no="${escape_html(tag.tag_no || "")}">
							${__("Select")}
						</button>
					</td>
				</tr>
			`;
		})
		.join("");

	dialog.fields_dict.tag_picker_html.$wrapper.html(`
		<div style="margin-bottom:10px;color:#475569;">
			<b>${escape_html(row.item_name || row.item_code || "")}</b>
			→ Raw Material: <b>${escape_html(row.custom_raw_material_item || "")}</b>
			${row.custom_raw_material_tag_no ? ` | Current Tag: <b>${escape_html(row.custom_raw_material_tag_no)}</b>` : ""}
		</div>
		<div class="table-responsive">
			<table class="table table-bordered table-sm">
				<thead>
					<tr>
						<th>${__("Tag No")}</th>
						<th>${__("Batch")}</th>
						<th>${__("Dimension")}</th>
						<th>${__("Specification")}</th>
						<th>${__("Est WT")}</th>
						<th>${__("Stock Source")}</th>
						<th>${__("Inward Doc")}</th>
						<th></th>
					</tr>
				</thead>
				<tbody>${rows_html}</tbody>
			</table>
		</div>
	`);

	dialog.fields_dict.tag_picker_html.$wrapper.find(".ss-coil-pick-tag").on("click", function () {
		const tag_no = $(this).attr("data-tag-no");
		if (!tag_no) return;
		assign_raw_material_tag_to_row(frm, cdt, cdn, row, tag_no, dialog);
	});

	dialog.show();
}

function assign_raw_material_tag_to_row(frm, cdt, cdn, row, tag_no, dialog) {
	frappe.call({
		method: "ss_coil.api.assign_raw_material_tag_to_sales_order_item",
		args: {
			sales_order_item: row.name,
			tag_no,
			sales_order: frm.doc.name,
			raw_material_item: row.custom_raw_material_item,
		},
		freeze: true,
		freeze_message: __("Linking parent tag..."),
		callback(res) {
			const result = res.message || {};
			apply_raw_material_tag_to_sales_order_row(cdt, cdn, result);
			frappe.show_alert({
				message: __("Linked parent tag {0}", [result.tag_no || tag_no]),
				indicator: "green",
			});
			if (dialog) {
				dialog.hide();
			}
			frm.refresh_field("items");
		},
	});
}

function apply_raw_material_tag_to_sales_order_row(cdt, cdn, result) {
	const values = result.so_item_fields || {};
	if (!Object.keys(values).length) {
		if (result.tag_no) {
			values.custom_raw_material_tag_no = result.tag_no;
		}
		if (result.batch_no) {
			values.custom_raw_material_batch_no = result.batch_no;
		}
		if (result.stock_source_type) {
			values.custom_stock_source_type = result.stock_source_type;
		}
	}
	Object.entries(values).forEach(([fieldname, value]) => {
		if (value !== undefined && value !== null && value !== "") {
			frappe.model.set_value(cdt, cdn, fieldname, value);
		}
	});
}

function open_sales_order_parent_tag_dialog(frm) {
	frappe.call({
		method: "ss_coil.api.get_sales_order_items_pending_raw_material_tags",
		args: { sales_order: frm.doc.name },
		freeze: true,
		callback(r) {
			const payload = r.message || {};
			const pending = payload.pending || [];
			if (!pending.length) {
				frappe.msgprint({
					title: __("All Lines Linked"),
					message: __("Every Sales Order item with a raw material already has a parent tag assigned."),
					indicator: "green",
				});
				return;
			}

			const dialog = new frappe.ui.Dialog({
				title: __("Link Parent Tags"),
				size: "large",
				fields: [{ fieldtype: "HTML", fieldname: "pending_html" }],
				primary_action_label: __("Close"),
				primary_action() {
					dialog.hide();
				},
			});

			const pending_html = pending
				.map(
					(item) => `
					<div style="display:flex;justify-content:space-between;align-items:center;padding:10px 0;border-bottom:1px solid #e2e8f0;">
						<div>
							<b>${escape_html(item.item_name || item.item_code || item.name)}</b><br>
							<span style="color:#64748b;">${__("Raw Material")}: ${escape_html(item.custom_raw_material_item || "-")}</span>
						</div>
						<button class="btn btn-sm btn-primary ss-coil-open-tag-picker" data-row-name="${escape_html(item.name)}">
							${__("Select Tag")}
						</button>
					</div>
				`,
				)
				.join("");

			dialog.fields_dict.pending_html.$wrapper.html(`
				<div style="margin-bottom:12px;color:#475569;">
					${__("{0} line(s) still need a parent raw material tag.", [pending.length])}
				</div>
				${pending_html}
			`);

			dialog.fields_dict.pending_html.$wrapper.find(".ss-coil-open-tag-picker").on("click", function () {
				const row_name = $(this).attr("data-row-name");
				const grid_row = (frm.doc.items || []).find((item) => item.name === row_name);
				if (!grid_row) return;
				dialog.hide();
				open_raw_material_tag_dialog(frm, grid_row.doctype, grid_row.name);
			});

			dialog.show();
		},
	});
}

function bind_live_dimension_events(frm) {
	const grid = frm.fields_dict.items && frm.fields_dict.items.grid;
	if (!grid || !grid.wrapper) return;

	const selector = [
		'[data-fieldname="custom_thickness"] input',
		'[data-fieldname="custom_width"] input',
		'[data-fieldname="custom_length_c"] input',
	].join(", ");

	grid.wrapper.off(".ss_coil_dimension");
	grid.wrapper.on("input.ss_coil_dimension keyup.ss_coil_dimension change.ss_coil_dimension", selector, function () {
		let row_name =
			$(this).attr("data-name") || $(this).closest(".grid-row").attr("data-name");
		if (!row_name) {
			row_name = grid.get_selected_children()?.[0]?.name;
		}
		if (!row_name) {
			row_name = grid.grid_rows?.find((r) => r.row?.hasClass("grid-row-open"))?.doc?.name;
		}
		if (!row_name) return;

		const row = locals["Sales Order Item"] && locals["Sales Order Item"][row_name];
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
			.map((v) => format_dimension_part(v))
			.filter((v) => v !== "");
		const dimension = parts.join(" x ");
		if ((row.custom_dimension || "") !== dimension) {
			frappe.model.set_value(row.doctype, row.name, "custom_dimension", dimension);
		}
	});
}

function set_custom_dimension_from_values(cdt, cdn) {
	const row = locals[cdt][cdn];
	if (!row) return;

	const parts = [row.custom_thickness, row.custom_width, row.custom_length_c]
		.map((v) => format_dimension_part(v))
		.filter((v) => v !== "");
	const dimension = parts.join(" x ");
	if ((row.custom_dimension || "") !== dimension) {
		frappe.model.set_value(cdt, cdn, "custom_dimension", dimension);
	}
}

function format_dimension_part(value) {
	if (value === undefined || value === null) return "";
	const text = String(value).trim();
	if (!text) return "";
	const num = Number(text);
	if (!Number.isNaN(num) && text.match(/^-?\d+(\.\d+)?$/)) {
		return format_number(num);
	}
	return text;
}

const SS_COIL_CUTTING_PROCESS_LABELS = {
	slitter: __("Slitter"),
	leveler: __("Leveler"),
	reshearing: __("Reshearing"),
};

function cutting_scheme_dialog_table_fields() {
	/** Single schema for all tabs — Frappe grid breaks if column defs change on tab switch. */
	return [
		{ fieldname: "seq", fieldtype: "Float", label: "SEQ", in_list_view: 1, read_only: 1, columns: 1 },
		{ fieldname: "width", fieldtype: "Float", label: "Width", in_list_view: 1, reqd: 1, columns: 2 },
		{ fieldname: "length", fieldtype: "Float", label: "Length", in_list_view: 1, columns: 2 },
		{ fieldname: "lengthcut", fieldtype: "Float", label: "LengthCut", in_list_view: 1, columns: 2 },
		{ fieldname: "strip", fieldtype: "Float", label: __("Strip"), in_list_view: 1, columns: 2 },
		{ fieldname: "total_sheets", fieldtype: "Float", label: __("Total sheets"), in_list_view: 1, columns: 2 },
		{
			fieldname: "total_width",
			fieldtype: "Float",
			label: __("Total Width"),
			in_list_view: 1,
			read_only: 1,
			columns: 2,
		},
		{ fieldname: "tolerance_plus", fieldtype: "Float", label: "Tol(+)", in_list_view: 1, columns: 1 },
		{ fieldname: "tolerance_minus", fieldtype: "Float", label: "Tol(-)", in_list_view: 1, columns: 1 },
		{ fieldname: "knife", fieldtype: "Check", label: "Knife", in_list_view: 1, columns: 1 },
	];
}

function ensure_cutting_scheme_dialog_grid_styles() {
	if (document.getElementById("ss-coil-scheme-grid-style")) {
		return;
	}
	const style = document.createElement("style");
	style.id = "ss-coil-scheme-grid-style";
	style.textContent = `
		.ss-coil-scheme-slitter .grid-heading-row [data-fieldname="length"],
		.ss-coil-scheme-slitter .grid-row [data-fieldname="length"],
		.ss-coil-scheme-slitter .grid-heading-row [data-fieldname="total_sheets"],
		.ss-coil-scheme-slitter .grid-row [data-fieldname="total_sheets"] { display: none !important; }
		.ss-coil-scheme-leveler .grid-heading-row [data-fieldname="strip"],
		.ss-coil-scheme-leveler .grid-row [data-fieldname="strip"],
		.ss-coil-scheme-leveler .grid-heading-row [data-fieldname="total_width"],
		.ss-coil-scheme-leveler .grid-row [data-fieldname="total_width"],
		.ss-coil-scheme-leveler .grid-heading-row [data-fieldname="knife"],
		.ss-coil-scheme-leveler .grid-row [data-fieldname="knife"] { display: none !important; }
	`;
	document.head.appendChild(style);
}

function apply_cutting_scheme_grid_process_mode(grid, process_key) {
	if (!grid || !grid.wrapper) {
		return;
	}
	ensure_cutting_scheme_dialog_grid_styles();
	const is_slitter = process_key === "slitter";
	grid.wrapper
		.toggleClass("ss-coil-scheme-slitter", is_slitter)
		.toggleClass("ss-coil-scheme-leveler", !is_slitter);
}

function default_cutting_scheme_row_for_process(so_item_row, process_key) {
	if (process_key === "slitter" || !so_item_row) {
		return null;
	}
	const width = flt(so_item_row.custom_width);
	const length = flt(so_item_row.custom_length);
	const total_sheets = flt(so_item_row.qty);
	const lengthcut = 1;
	return {
		width: width || undefined,
		length: length || undefined,
		strip: 1,
		total_sheets: total_sheets || undefined,
		lengthcut,
		tolerance_plus: length ? length + 1 : undefined,
		tolerance_minus: length ? length - 1 : undefined,
	};
}

function cutting_scheme_fieldname(process_key) {
	return `cutting_scheme_${process_key}`;
}

function get_cutting_scheme_field(dialog, process_key) {
	return dialog.fields_dict[cutting_scheme_fieldname(process_key)];
}

function sanitize_process_plan_rows(rows, process_key, so_item_row) {
	if (process_key === "slitter") {
		return rows || [];
	}
	const list = rows || [];
	if (!list.length) {
		return list;
	}
	const with_length = list.filter((r) => flt(r.length));
	const slitter_copies = list.filter((r) => !flt(r.length) && flt(r.width));
	if (!slitter_copies.length) {
		return list;
	}
	if (with_length.length === 1) {
		return [with_length[0]];
	}
	if (with_length.length > 1) {
		return with_length;
	}
	const defaults = default_cutting_scheme_row_for_process(so_item_row, process_key);
	return defaults ? [defaults] : [];
}

function show_cutting_scheme_process_tab(dialog, processes, active_process) {
	(processes || []).forEach((pk) => {
		const field = get_cutting_scheme_field(dialog, pk);
		if (!field) {
			return;
		}
		const show = pk === active_process;
		// Do not use df.hidden — Frappe skips rendering Table grids when hidden.
		field.df.hidden = 0;
		if (field.$wrapper) {
			field.$wrapper.css("display", show ? "block" : "none");
		}
		if (show && field.grid) {
			apply_cutting_scheme_grid_process_mode(field.grid, pk);
			field.grid.refresh();
		}
	});
}

function seed_cutting_scheme_grid_if_empty(dialog, process_key) {
	if (process_key === "slitter") {
		return;
	}
	const field = get_cutting_scheme_field(dialog, process_key);
	if (!field || !field.grid) {
		return;
	}
	const existing = normalize_cutting_scheme_rows(field.grid.get_data() || [], process_key);
	if (existing.length) {
		return;
	}
	const defaults = default_cutting_scheme_row_for_process(dialog.__so_item_row, process_key);
	if (!defaults) {
		return;
	}
	const data = normalize_cutting_scheme_rows([defaults], process_key);
	field.df.data = data;
	field.grid.df.data = data;
	field.grid.refresh();
}

function map_cutting_scheme_row_from_server(d) {
	return {
		seq: d.seq,
		width: d.width,
		strip: d.strip,
		total_sheets: d.total_sheets,
		length: d.length,
		lengthcut: d.lengthcut,
		total_width: d.total_width,
		tolerance_plus: d.tolerance_plus,
		tolerance_minus: d.tolerance_minus,
		knife: d.knife,
	};
}

function open_cutting_scheme_dialog(frm, cdt, cdn, opts) {
	opts = opts || {};
	const fromProduction = !!opts.from_production || cdt === "Coil Production Line";
	const row = locals[cdt] && locals[cdt][cdn];
	if (!row || !frm.doc.name) return;

	if (is_unsaved_sales_order_context(frm, row.name) || (fromProduction && is_unsaved_sales_order_context(frm, row.sales_order_item))) {
		frappe.msgprint(
			__(
				"Please save the Sales Order once, then open Coil Production (Mother Coil / Raw) and use Manage Cutting Scheme."
			)
		);
		return;
	}

	const contextRow = fromProduction ? production_row_as_cutting_context(row) : row;
	const coilProductionLine = fromProduction ? row.name : null;
	const salesOrderItem = fromProduction ? row.sales_order_item : row.name;

	if (fromProduction && !salesOrderItem) {
		frappe.msgprint(
			__("This production row is not linked to a Finish Good item yet. Save the Sales Order and try again.")
		);
		return;
	}

	frappe.call({
		method: "ss_coil.api.get_so_production_plans_for_item",
		args: {
			sales_order: frm.doc.name,
			sales_order_item: salesOrderItem,
			coil_production_line: coilProductionLine,
		},
		callback: function (r) {
			const payload = r.message || {};
			const processes = payload.processes || ["slitter"];
			const plans = payload.plans || {};
			const plan_cache = {};
			processes.forEach((pk) => {
				const from_server = (plans[pk]?.rows || []).map(map_cutting_scheme_row_from_server);
				plan_cache[pk] = sanitize_process_plan_rows(from_server, pk, contextRow);
			});
			let active_process = processes[0] || "slitter";
			const titleItem =
				(fromProduction && (row.raw_material_item || row.finish_good_item)) ||
				contextRow.item_name ||
				contextRow.item_code ||
				contextRow.name;

			const dialog_fields = [
				{ fieldname: "item_meta_html", fieldtype: "HTML" },
				{ fieldname: "process_tabs_html", fieldtype: "HTML" },
			];
			processes.forEach((pk) => {
				dialog_fields.push({
					fieldname: cutting_scheme_fieldname(pk),
					fieldtype: "Table",
					label: __("Cutting Scheme Rows"),
					in_place_edit: true,
					cannot_add_rows: false,
					data: normalize_cutting_scheme_rows(plan_cache[pk] || [], pk),
					fields: cutting_scheme_dialog_table_fields(),
				});
			});
			dialog_fields.push({ fieldname: "totals_html", fieldtype: "HTML" });

			const dialog = new frappe.ui.Dialog({
				title: __("Cutting Scheme: {0}", [titleItem]),
				size: "extra-large",
				fields: dialog_fields,
				primary_action_label: __("Save All Processes"),
				primary_action() {
					const plans_to_save = {};
					processes.forEach((pk) => {
						const grid_field = get_cutting_scheme_field(dialog, pk);
						const raw = grid_field?.grid ? grid_field.grid.get_data() || [] : plan_cache[pk] || [];
						plans_to_save[pk] = normalize_cutting_scheme_rows(raw, pk);
					});
					for (const pk of processes) {
						if ((plans_to_save[pk] || []).some((d) => !flt(d.width))) {
							frappe.msgprint(
								__("Width is mandatory in each saved row for {0}.", [
									SS_COIL_CUTTING_PROCESS_LABELS[pk] || pk,
								]),
							);
							return;
						}
					}

					frappe.call({
						method: "ss_coil.api.save_so_production_plans_for_item",
						args: {
							sales_order: frm.doc.name,
							sales_order_item: salesOrderItem,
							coil_production_line: coilProductionLine,
							plans: plans_to_save,
						},
						freeze: true,
						freeze_message: __("Saving Cutting Schemes..."),
						callback: function (save_r) {
							dialog.hide();
							if (save_r.message?.migrate_required) {
								frappe.msgprint({
									title: __("Migrate required"),
									message: __(
										"Only the Slitter tab was saved. Run <code>bench --site {0} migrate</code> then save again to store Leveler / Reshearing schemes on the Sales Order.",
										[frappe.boot.sitename || ""],
									),
									indicator: "orange",
								});
							}
							if (save_r.message && fromProduction) {
								if (save_r.message.custom_calc_ratio != null) {
									frappe.model.set_value(cdt, cdn, "calc_ratio", flt(save_r.message.custom_calc_ratio));
								}
								if (save_r.message.custom_remaining_width != null) {
									frappe.model.set_value(
										cdt,
										cdn,
										"remaining_width",
										flt(save_r.message.custom_remaining_width)
									);
								}
								frm.refresh_field("custom_coil_production");
								render_production_cutting_scheme_preview(frm, cdt, cdn);
							} else if (save_r.message) {
								frappe.model.set_value(
									cdt,
									cdn,
									"custom_calc_ratio",
									flt(save_r.message.custom_calc_ratio),
								);
								frappe.model.set_value(
									cdt,
									cdn,
									"custom_remaining_width",
									flt(save_r.message.custom_remaining_width),
								);
								frm.refresh_field("items");
								render_item_cutting_scheme_preview(frm, cdt, cdn);
							}
							render_cutting_scheme_report(frm);
							frappe.show_alert({ message: __("Cutting schemes saved"), indicator: "green" });
						},
					});
				},
			});

			dialog.show();
			dialog.__so_item_qty = contextRow.qty;
			dialog.__so_item_width = contextRow.custom_width;
			dialog.__so_item_row = contextRow;
			dialog.__processes = processes;
			dialog.__active_process = active_process;
			dialog.__plan_cache = plan_cache;
			if (payload.process_key_enabled === false && processes.length > 1) {
				frappe.show_alert({
					message: __(
						"Slitter scheme works now. Run bench migrate on the site to save separate Leveler / Reshearing schemes on this order.",
					),
					indicator: "orange",
				});
			}
			render_cutting_scheme_item_meta(dialog, contextRow, fromProduction);
			const switchProcess = (next_process) => {
				if (next_process === dialog.__active_process) {
					return;
				}
				dialog.__active_process = next_process;
				active_process = next_process;
				show_cutting_scheme_process_tab(dialog, processes, next_process);
				seed_cutting_scheme_grid_if_empty(dialog, next_process);
				render_cutting_scheme_process_tabs(dialog, processes, next_process, switchProcess);
				setTimeout(() => update_cutting_scheme_totals(dialog), 0);
			};
			render_cutting_scheme_process_tabs(dialog, processes, active_process, switchProcess);
			setTimeout(() => {
				show_cutting_scheme_process_tab(dialog, processes, active_process);
				bind_cutting_scheme_dialog_events(dialog);
				processes.forEach((pk) => {
					if (pk !== active_process) {
						seed_cutting_scheme_grid_if_empty(dialog, pk);
					}
				});
				seed_cutting_scheme_grid_if_empty(dialog, active_process);
				update_cutting_scheme_totals(dialog);
			}, 200);
		},
	});
}

function sync_cutting_dialog_grid_to_cache(dialog, plan_cache, process_key) {
	const field = get_cutting_scheme_field(dialog, process_key);
	if (!field || !field.grid || !process_key) {
		return;
	}
	const rows = normalize_cutting_scheme_rows(field.grid.get_data() || [], process_key);
	plan_cache[process_key] = rows.map((row) => ({ ...row }));
}

function bind_cutting_scheme_dialog_events(dialog) {
	if (dialog.__cutting_scheme_events_bound) {
		return;
	}
	dialog.__cutting_scheme_events_bound = true;

	(dialog.__processes || []).forEach((process_key) => {
		const field = get_cutting_scheme_field(dialog, process_key);
		if (!field || !field.grid) {
			return;
		}

		field.grid.wrapper.css("overflow-x", "auto");
		field.grid.wrapper.find(".grid-body").css("overflow-x", "auto");
		field.grid.wrapper.find(".grid-heading-row, .rows").css("min-width", "1200px");
		field.grid.wrapper.find(".grid-add-row, .grid-remove-rows").css("display", "");

		field.grid.wrapper.off(".ss_coil_cutting_dialog");
		field.grid.wrapper.on(
			"input.ss_coil_cutting_dialog change.ss_coil_cutting_dialog",
			'[data-fieldname="width"] input, [data-fieldname="strip"] input, [data-fieldname="length"] input, [data-fieldname="lengthcut"] input, [data-fieldname="tolerance_plus"] input, [data-fieldname="tolerance_minus"] input',
			function () {
				if (dialog.__active_process !== process_key) {
					return;
				}
				const row_name =
					$(this).attr("data-name") || $(this).closest(".grid-row").attr("data-name");
				if (!row_name) return;
				const row = (locals["Dialog Table"] || {})[row_name];
				if (!row) return;

				row.total_width = flt(row.width) * (flt(row.strip) || 1);
				field.grid.refresh_row(row_name);
				update_cutting_scheme_totals(dialog);
			},
		);

		field.grid.wrapper.on("click.ss_coil_cutting_dialog", ".grid-add-row", function () {
			setTimeout(() => {
				if (dialog.__active_process !== process_key) {
					return;
				}
				const data = normalize_cutting_scheme_rows(field.grid.get_data() || [], process_key);
				const so_row = dialog.__so_item_row;
				if (so_row && process_key !== "slitter" && data.length) {
					const last = data[data.length - 1];
					const defaults = default_cutting_scheme_row_for_process(so_row, process_key);
					if (defaults) {
						Object.keys(defaults).forEach((key) => {
							if (last[key] === undefined || last[key] === null || last[key] === "") {
								last[key] = defaults[key];
							}
						});
					}
				}
				field.df.data = data;
				field.grid.df.data = data;
				field.grid.refresh();
				update_cutting_scheme_totals(dialog);
			}, 50);
		});

		field.grid.wrapper.on("click.ss_coil_cutting_dialog", ".grid-remove-rows, .grid-delete-row", function () {
			setTimeout(() => {
				if (dialog.__active_process !== process_key) {
					return;
				}
				const data = normalize_cutting_scheme_rows(field.grid.get_data() || [], process_key);
				field.df.data = data;
				field.grid.df.data = data;
				field.grid.refresh();
				update_cutting_scheme_totals(dialog);
			}, 50);
		});
	});
}

function render_cutting_scheme_process_tabs(dialog, processes, active_process, on_select) {
	const html_field = dialog.fields_dict.process_tabs_html;
	if (!html_field) return;
	const tabs = processes
		.map((pk) => {
			const active = pk === active_process;
			const style = active
				? "background:#1d4ed8;color:#fff;border-color:#1d4ed8;"
				: "background:#fff;color:#334155;border-color:#cbd5e1;";
			return `<button type="button" class="btn btn-sm ss-coil-scheme-tab" data-process="${pk}" style="${style}border-radius:10px;font-weight:800;margin:0 6px 8px 0;padding:8px 14px;">${frappe.utils.escape_html(
				SS_COIL_CUTTING_PROCESS_LABELS[pk] || pk,
			)}</button>`;
		})
		.join("");
	html_field.$wrapper.html(
		`<div style="margin:0 0 12px;display:flex;flex-wrap:wrap;align-items:center;gap:4px;">
			<span style="font-size:11px;font-weight:700;text-transform:uppercase;color:#64748b;margin-right:6px;">${__(
				"Process",
			)}</span>${tabs}
		</div>`,
	);
	html_field.$wrapper.find(".ss-coil-scheme-tab").off("click").on("click", function () {
		const pk = $(this).attr("data-process");
		const current = dialog.__active_process;
		if (pk && pk !== current && typeof on_select === "function") {
			on_select(pk);
		}
	});
}

function prepare_cutting_scheme_dialog(dialog) {
	bind_cutting_scheme_dialog_events(dialog);
	if (dialog.__processes && dialog.__active_process) {
		show_cutting_scheme_process_tab(dialog, dialog.__processes, dialog.__active_process);
		update_cutting_scheme_totals(dialog);
	}
}

function normalize_cutting_scheme_rows(rows, process_key = "slitter") {
	const is_slitter = process_key === "slitter";
	return (rows || [])
		.filter((d) =>
			[
				d.seq,
				d.width,
				d.strip,
				d.total_sheets,
				d.length,
				d.lengthcut,
				d.tolerance_plus,
				d.tolerance_minus,
				d.knife,
			].some((v) => v !== undefined && v !== null && String(v).trim() !== ""),
		)
		.map((d, idx) => {
			const strip = is_slitter ? flt(d.strip) : flt(d.strip) || 1;
			const total_sheets = is_slitter
				? undefined
				: flt(d.total_sheets) || (flt(d.strip) > 1 ? flt(d.strip) : undefined);
			return {
				...d,
				seq: idx + 1,
				strip,
				total_sheets,
				total_width: is_slitter ? flt(d.width) * (strip || 0) : flt(d.width),
			};
		});
}

function update_cutting_scheme_totals(dialog) {
	const process_key = dialog.__active_process || "slitter";
	const field = get_cutting_scheme_field(dialog, process_key);
	const html_field = dialog.fields_dict.totals_html;
	if (!field || !html_field || !field.grid) return;

	const rows = normalize_cutting_scheme_rows(field.grid.get_data() || [], process_key);
	const total_width = rows.reduce((sum, row) => sum + flt(row.total_width), 0);
	const total_strips = rows.reduce((sum, row) => sum + flt(row.strip), 0);
	const total_plain_width = rows.reduce((sum, row) => sum + flt(row.width), 0);
	const row_count = rows.length;
	const qty = flt(dialog.__so_item_qty);
	const item_width = flt(dialog.__so_item_width);
	const calc_ratio = item_width ? (qty / item_width) * total_plain_width : 0;
	const remaining_width = item_width - total_width;

	if (process_key !== "slitter") {
		html_field.$wrapper.html(`
		<div style="margin-top: 12px; display: flex; gap: 12px; flex-wrap: wrap;">
			<div style="background:#16324f; color:#fff; padding:10px 14px; border-radius:10px; min-width:140px;">
				<div style="font-size:11px; opacity:.8; text-transform:uppercase;">Rows</div>
				<div style="font-size:20px; font-weight:700;">${row_count}</div>
			</div>
			<div style="background:#edf9f2; color:#1c6b3f; padding:10px 14px; border-radius:10px; min-width:160px; border:1px solid #cbe8d7;">
				<div style="font-size:11px; opacity:.8; text-transform:uppercase;">${__("Total Sheet")}</div>
				<div style="font-size:20px; font-weight:700;">${format_number(total_strips)}</div>
			</div>
			<div style="font-size:12px;color:#64748b;padding:10px 14px;max-width:420px;line-height:1.5;">${__(
				"Leveler / Reshearing scheme: Width, Length, LengthCut, Total Sheet (Strip), tolerances. Calc ratio on SO item is updated from Slitter tab only.",
			)}</div>
		</div>
	`);
		return;
	}

	html_field.$wrapper.html(`
		<div style="margin-top: 12px; display: flex; gap: 12px; flex-wrap: wrap;">
			<div style="background:#16324f; color:#fff; padding:10px 14px; border-radius:10px; min-width:140px;">
				<div style="font-size:11px; opacity:.8; text-transform:uppercase;">Rows</div>
				<div style="font-size:20px; font-weight:700;">${row_count}</div>
			</div>
			<div style="background:#eef6ff; color:#16324f; padding:10px 14px; border-radius:10px; min-width:160px; border:1px solid #d8e6f7;">
				<div style="font-size:11px; opacity:.8; text-transform:uppercase;">Total Width</div>
				<div style="font-size:20px; font-weight:700;">${format_number(total_width)}</div>
			</div>
			<div style="background:#edf9f2; color:#1c6b3f; padding:10px 14px; border-radius:10px; min-width:160px; border:1px solid #cbe8d7;">
				<div style="font-size:11px; opacity:.8; text-transform:uppercase;">Width Sum</div>
				<div style="font-size:20px; font-weight:700;">${format_number(total_plain_width)}</div>
			</div>
			<div style="background:#f7fbef; color:#355724; padding:10px 14px; border-radius:10px; min-width:160px; border:1px solid #dbe9c8;">
				<div style="font-size:11px; opacity:.8; text-transform:uppercase;">Total Strip</div>
				<div style="font-size:20px; font-weight:700;">${format_number(total_strips)}</div>
			</div>
			<div style="background:#fff6e8; color:#8a4b08; padding:10px 14px; border-radius:10px; min-width:180px; border:1px solid #f1d6ad;">
				<div style="font-size:11px; opacity:.8; text-transform:uppercase;">Calc Ratio Preview</div>
				<div style="font-size:20px; font-weight:700;">${format_number(calc_ratio)}</div>
			</div>
			<div style="background:#fdf0f3; color:#8d2344; padding:10px 14px; border-radius:10px; min-width:180px; border:1px solid #f4c6d3;">
				<div style="font-size:11px; opacity:.8; text-transform:uppercase;">Remaining Width Preview</div>
				<div style="font-size:20px; font-weight:700;">${format_number(remaining_width)}</div>
			</div>
		</div>
	`);
}

function render_cutting_scheme_item_meta(dialog, row, fromProduction) {
	const html_field = dialog.fields_dict.item_meta_html;
	if (!html_field) return;

	const cards = fromProduction
		? [
				metaCard("Mother Coil / Raw", row._raw_material_item || row.item_code || "-"),
				metaCard("Raw Tag", row._raw_material_tag_no || row.custom_tag_no || "-"),
				metaCard("Finish Good", row._finish_good_item || "-"),
				metaCard("Qty", format_number(row.qty)),
				metaCard("Thickness", row.custom_thickness || "-"),
				metaCard("Width", row.custom_width || "-"),
				metaCard("Length C", row.custom_length_c || "-"),
				metaCard("Length", row.custom_length != null && row.custom_length !== "" ? format_number(row.custom_length) : "-"),
		  ].join("")
		: [
				metaCard("Item", row.item_name || row.item_code || row.name),
				metaCard("Tag No", row.custom_tag_no || "-"),
				metaCard("Qty", format_number(row.qty)),
				metaCard("Ref No", row.custom_ref_no || "-"),
				metaCard("Thickness", row.custom_thickness || "-"),
				metaCard("Width", row.custom_width || "-"),
				metaCard("Length C", row.custom_length_c || "-"),
				metaCard("Length", row.custom_length != null && row.custom_length !== "" ? format_number(row.custom_length) : "-"),
		  ].join("");

	html_field.$wrapper.html(`
		<div style="margin-bottom: 14px; display: grid; grid-template-columns: repeat(4, minmax(140px, 1fr)); gap: 10px; background: #f6f9fc; border: 1px solid #dce7f2; border-radius: 12px; padding: 12px;">
			${cards}
		</div>
	`);
}

function metaCard(label, value) {
	return `<div style="background:#fff; border:1px solid #e3ebf3; border-radius:10px; padding:10px 12px;">
		<div style="font-size:11px; color:#6b7280; text-transform:uppercase; letter-spacing:0.04em;">${frappe.utils.escape_html(label)}</div>
		<div style="font-size:14px; font-weight:700; color:#16324f; margin-top:4px;">${frappe.utils.escape_html(String(value || "-"))}</div>
	</div>`;
}

function format_number(value) {
	const num = flt(value);
	return num % 1 === 0 ? String(parseInt(num, 10)) : num.toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
}

function render_sales_order_dashboard(frm) {
	const html_field = frm.fields_dict.custom_detail_status || frm.fields_dict.detail_status;
	if (!html_field) return;
	if (frm.is_new && frm.is_new()) {
		html_field.$wrapper.empty();
		return;
	}
	if (!frm.doc.name || String(frm.doc.name).startsWith("new-sales-order-")) {
		html_field.$wrapper.empty();
		return;
	}

	frappe.call({
		method: "ss_coil.api.get_sales_order_detail_dashboard",
		args: {
			sales_order: frm.doc.name,
		},
		callback: function (r) {
			const data = r.message || {};
			frappe.call({
				method: "ss_coil.api.get_sales_order_cutting_scheme_report",
				args: {
					sales_order: frm.doc.name,
				},
				callback: function (report_r) {
					html_field.$wrapper.html(
						build_sales_order_dashboard_html(data, report_r.message || []),
					);
				},
			});
		},
	});
}

function render_packing_detail(frm) {
	const html_field = frm.fields_dict.custom_packing;
	if (!html_field) return;
	if (frm.is_new && frm.is_new()) {
		html_field.$wrapper.empty();
		return;
	}
	if (!frm.doc.name || String(frm.doc.name).startsWith("new-sales-order-")) {
		html_field.$wrapper.empty();
		return;
	}

	frappe.call({
		method: "ss_coil.api.get_sales_order_detail_dashboard",
		args: { sales_order: frm.doc.name },
		callback: function (r) {
			const packing = (r.message && r.message.packing_details) || [];
			html_field.$wrapper.html(build_packing_detail_html(packing));
		},
	});
}

function build_sales_order_planning_operations_html(items) {
	const tableRows = [];
	(items || []).forEach((item) => {
		const itemLabel = item.item_name || item.item_code || item.name || "-";
		const lineStatus = item.custom_status || "-";
		(item.operation_rows || []).forEach((op) => {
			tableRows.push(`
				<tr>
					<td>${escape_html(itemLabel)}</td>
					<td>${statusPill(lineStatus, ssCoilStatusTone(lineStatus))}</td>
					<td>${escape_html(op.operation || "-")}</td>
					<td>${escape_html(op.planned || "-")}</td>
					<td>${statusPill(op.line_status || "-", ssCoilStatusTone(op.line_status))}</td>
					<td>${op.ss_coil ? docLink("ss-coil", op.ss_coil, "dark") : "-"}</td>
					<td>${escape_html(op.machine || "-")}</td>
					<td>${escape_html(op.source || "-")}</td>
				</tr>`);
		});
	});

	if (!tableRows.length) {
		return `<div style="color:#64748b;font-size:13px;">No operations configured on Sales Order items (Slitter / Leveler / Reshearing).</div>`;
	}

	return `<div style="overflow:auto;">
		<table class="table table-bordered" style="margin-bottom:0;background:#fff;min-width:980px;">
			<thead style="background:#eef4fb;color:#1f56d2;">
				<tr>
					<th>Item</th>
					<th>SO Item Status</th>
					<th>Operation</th>
					<th>Planned (SO / Coil SO)</th>
					<th>SS Coil Status</th>
					<th>SS Coil</th>
					<th>Machine</th>
					<th>Source</th>
				</tr>
			</thead>
			<tbody>${tableRows.join("")}</tbody>
		</table>
	</div>`;
}

function ssCoilStatusTone(status) {
	const normalized = (status || "").toLowerCase();
	if (normalized.includes("complete")) return "success";
	if (normalized.includes("process") || normalized.includes("start")) return "warning";
	return "muted";
}

function build_sales_order_dashboard_html(data, cuttingGroups) {
	const items = data.items || [];
	const packingDetails = data.packing_details || [];
	const plans = data.plans || [];
	const ssCoilDocs = data.ss_coil_docs || [];
	const stockEntries = data.stock_entry_refs || [];
	const stockEntryDocs = data.stock_entries || [];
	const stockEntryItems = data.stock_entry_items || [];
	const deliveryNoteItems = data.delivery_note_items || [];
	const salesInvoiceItems = data.sales_invoice_items || [];
	const dispatchSummary = data.dispatch_summary || [];
	const bomDetails = data.bom_details || [];
	const stockLedgerRows = data.stock_ledger_rows || [];
	const paymentEntryRefs = data.payment_entry_refs || [];
	const journalEntryRefs = data.journal_entry_refs || [];
	const expenseClaims = data.expense_claims || [];
	const expenseClaimDetails = data.expense_claim_details || [];
	const expenseBreakup = data.expense_breakup || {};
	const purchaseOrders = data.purchase_orders || [];
	const purchaseReceipts = data.purchase_receipts || [];
	const purchaseInvoices = data.purchase_invoices || [];
	const tagTrace = data.tag_trace || [];
	const tagTree = data.tag_tree || [];
	const cuttingSchemeHtml = build_cutting_scheme_report_html(cuttingGroups || []);
	const dashboardId = `ss-coil-dashboard-${(data.sales_order || "so").replace(/[^a-zA-Z0-9]/g, "-")}`;
	const totalPlanRows = plans.reduce((sum, row) => sum + flt(row.row_count), 0);
	const totalPlanWidth = plans.reduce((sum, row) => sum + flt(row.total_width), 0);
	const draftSsCoil = ssCoilDocs.filter((d) => Number(d.docstatus || 0) === 0).length;
	const submittedSsCoil = ssCoilDocs.filter((d) => Number(d.docstatus || 0) === 1).length;
	const totalSsCoilWeight = ssCoilDocs.reduce((sum, d) => sum + flt(d.grand_estimated_wt), 0);
	const pendingQty = Math.max(flt(data.total_qty) - flt(totalSsCoilWeight), 0);
	const itemRows = items.length
		? items
				.map(
					(item) => `
						<tr>
							<td>${escape_html(item.item_name || item.item_code || item.name || "-")}</td>
							<td>${format_number(item.qty)}</td>
							<td>${escape_html(item.tag_no || "-")}${
								item.raw_material_tag_no
									? `<br><span style="color:#64748b;font-size:11px;">Mother: ${escape_html(item.raw_material_tag_no)}</span>`
									: ""
							}</td>
							<td>${escape_html(item.ref_no || "-")}</td>
							<td>${escape_html(item.dimension || "-")}</td>
							<td>${escape_html(item.specification || "-")}</td>
							<td>${escape_html(item.raw_material_item || "-")}</td>
							<td>${statusPill(item.custom_status || "-", ssCoilStatusTone(item.custom_status))}</td>
							<td>${format_number(item.estimated_wt)}</td>
							<td>${format_number(item.calc_ratio)}</td>
							<td>${format_number(item.actual_ratio)}</td>
							<td>${numberPill(item.remaining_width, flt(item.remaining_width) < 0 ? "danger" : "success")}</td>
						</tr>`,
				)
				.join("")
		: `<tr><td colspan="12" style="text-align:center; color:#64748b;">No Sales Order items found.</td></tr>`;

	const planningOperationsHtml = build_sales_order_planning_operations_html(items);

	const ssCoilRows = ssCoilDocs.length
		? ssCoilDocs
				.map(
					(doc) => `
						<tr>
							<td>${docLink("ss-coil", doc.name)}</td>
							<td>${statusPill(doc.docstatus === 1 ? "Submitted" : doc.docstatus === 2 ? "Cancelled" : "Draft", doc.docstatus === 1 ? "success" : doc.docstatus === 2 ? "danger" : "dark")}</td>
							<td>${escape_html(doc.machine || "-")}</td>
							<td>${escape_html(doc.sales_order_item || "-")}</td>
							<td>${escape_html(doc.stock_entry || "-")}</td>
							<td>${format_number(doc.grand_estimated_wt)}</td>
							<td>${format_number(doc.grand_total_width)}</td>
							<td>${format_number(doc.actual_ratio)}</td>
							<td>${format_number(doc.remaining_width)}</td>
						</tr>`,
				)
				.join("")
		: `<tr><td colspan="9" style="text-align:center; color:#64748b;">No SS Coil records linked yet.</td></tr>`;

	const stockEntryDocRows = stockEntryDocs.length
		? stockEntryDocs.map((row) => `<tr>
			<td>${docLink("stock-entry", row.name)}</td>
			<td>${statusPill(row.purpose || "-", "dark")}</td>
			<td>${escape_html(row.posting_date || "-")}</td>
			<td>${escape_html(row.custom_customer || "-")}</td>
			<td>${escape_html(row.custom_for_customer || "-")}</td>
		</tr>`).join("")
		: `<tr><td colspan="5" style="text-align:center; color:#64748b;">No linked stock entries yet.</td></tr>`;

	const stockEntryItemRows = stockEntryItems.length
		? stockEntryItems.map((row) => `<tr>
			<td>${escape_html(row.parent || "-")}</td>
			<td>${escape_html(row.item_code || "-")}</td>
			<td>${escape_html(row.item_name || "-")}</td>
			<td>${format_number(row.qty)}</td>
			<td>${escape_html(row.custom_tag_no || "-")}</td>
			<td>${escape_html(row.custom_dimension || "-")}</td>
			<td>${format_number(row.custom_estimated_wt)}</td>
		</tr>`).join("")
		: `<tr><td colspan="7" style="text-align:center; color:#64748b;">No stock entry item rows yet.</td></tr>`;

	const dispatchSummaryRows = dispatchSummary.length
		? dispatchSummary.map((row) => `<tr>
			<td>${escape_html(row.item_code || "-")}</td>
			<td>${escape_html(row.item_name || "-")}</td>
			<td>${format_number(row.ordered_qty)}</td>
			<td>${format_number(row.delivered_qty)}</td>
			<td>${format_number(row.invoiced_qty)}</td>
			<td>${numberPill(row.pending_qty, flt(row.pending_qty) ? "warning" : "success")}</td>
		</tr>`).join("")
		: `<tr><td colspan="6" style="text-align:center; color:#64748b;">No dispatch summary yet.</td></tr>`;

	const deliveryBillingRows = deliveryNoteItems.length
		? deliveryNoteItems.map((row) => {
			const invoices = salesInvoiceItems.filter((inv) => inv.so_detail === row.so_detail);
			return `<tr>
				<td>${docLink("delivery-note", row.delivery_note || "-", "success")} <span style="color:#64748b;">${escape_html(row.posting_date || "-")}</span></td>
				<td>${invoices.length ? invoices.map((inv) => `${docLink("sales-invoice", inv.sales_invoice || "-", "dark")} <span style="color:#64748b;">${escape_html(inv.posting_date || "-")}</span>`).join("<br>") : "-"}</td>
			</tr>`;
		}).join("")
		: `<tr><td colspan="2" style="text-align:center; color:#64748b;">No delivery / invoice records linked yet.</td></tr>`;

	const paymentEntryRows = paymentEntryRefs.length
		? paymentEntryRefs.map((row) => `<tr>
			<td>${docLink("payment-entry", row.payment_entry || "-", "dark")}</td>
			<td>${escape_html(row.posting_date || "-")}</td>
			<td>${escape_html(row.party || "-")}</td>
			<td>${row.reference_name ? docLink(row.reference_doctype === "Sales Invoice" ? "sales-invoice" : "sales-order", row.reference_name || "-", "muted") : "-"}</td>
			<td>${numberPill(row.allocated_amount, "success")}</td>
		</tr>`).join("")
		: `<tr><td colspan="5" style="text-align:center; color:#64748b;">No payment entry records linked yet.</td></tr>`;

	const journalEntryRows = journalEntryRefs.length
		? journalEntryRefs.map((row) => `<tr>
			<td>${docLink("journal-entry", row.journal_entry || "-", "dark")}</td>
			<td>${escape_html(row.posting_date || "-")}</td>
			<td>${escape_html(row.account || "-")}</td>
			<td>${statusPill(row.reference_type || "-", "muted")}</td>
			<td>${escape_html(row.reference_name || "-")}</td>
			<td>${numberPill(row.debit, flt(row.debit) ? "success" : "muted")}</td>
			<td>${numberPill(row.credit, flt(row.credit) ? "warning" : "muted")}</td>
		</tr>`).join("")
		: `<tr><td colspan="7" style="text-align:center; color:#64748b;">No journal entry records linked yet.</td></tr>`;

	const expenseClaimRows = expenseClaims.length
		? expenseClaims.map((row) => `<tr>
			<td>${docLink("expense-claim", row.name || "-", "dark")}</td>
			<td>${escape_html(row.posting_date || "-")}</td>
			<td>${escape_html(row.employee || "-")}</td>
			<td>${escape_html(row.project || "-")}</td>
			<td>${statusPill(row.status || "-", expenseStatusTone(row.status))}</td>
			<td>${numberPill(row.total_sanctioned_amount, "success")}</td>
		</tr>`).join("")
		: `<tr><td colspan="6" style="text-align:center; color:#64748b;">No expense claim records linked yet.</td></tr>`;

	const expenseClaimDetailRows = expenseClaimDetails.length
		? expenseClaimDetails.map((row) => `<tr>
			<td>${docLink("expense-claim", row.parent || "-", "dark")}</td>
			<td>${escape_html(row.expense_date || "-")}</td>
			<td>${escape_html(row.default_account || "-")}</td>
			<td>${escape_html(row.description || "-")}</td>
			<td>${numberPill(row.amount, "warning")}</td>
			<td>${escape_html(row.cost_center || "-")}</td>
		</tr>`).join("")
		: `<tr><td colspan="6" style="text-align:center; color:#64748b;">No expense detail rows linked yet.</td></tr>`;

	const purchaseOrderRows = purchaseOrders.length
		? purchaseOrders.map((row) => `<tr>
			<td>${docLink("purchase-order", row.name || "-", "dark")}</td>
			<td>${escape_html(row.transaction_date || "-")}</td>
			<td>${escape_html(row.supplier || "-")}</td>
			<td>${statusPill(row.status || "-", purchaseStatusTone(row.status))}</td>
			<td>${numberPill(row.grand_total, "warning")}</td>
		</tr>`).join("")
		: `<tr><td colspan="5" style="text-align:center; color:#64748b;">No purchase orders linked yet.</td></tr>`;

	const purchaseReceiptRows = purchaseReceipts.length
		? purchaseReceipts.map((row) => `<tr>
			<td>${docLink("purchase-receipt", row.name || "-", "dark")}</td>
			<td>${escape_html(row.posting_date || "-")}</td>
			<td>${escape_html(row.supplier || "-")}</td>
			<td>${statusPill(row.status || "-", purchaseStatusTone(row.status))}</td>
			<td>${numberPill(row.grand_total, "success")}</td>
		</tr>`).join("")
		: `<tr><td colspan="5" style="text-align:center; color:#64748b;">No purchase receipts linked yet.</td></tr>`;

	const purchaseInvoiceRows = purchaseInvoices.length
		? purchaseInvoices.map((row) => `<tr>
			<td>${docLink("purchase-invoice", row.name || "-", "dark")}</td>
			<td>${escape_html(row.posting_date || "-")}</td>
			<td>${escape_html(row.supplier || "-")}</td>
			<td>${statusPill(row.status || "-", purchaseStatusTone(row.status))}</td>
			<td>${numberPill(row.grand_total, "warning")}</td>
			<td>${numberPill(row.outstanding_amount, flt(row.outstanding_amount) ? "danger" : "success")}</td>
		</tr>`).join("")
		: `<tr><td colspan="6" style="text-align:center; color:#64748b;">No purchase invoices linked yet.</td></tr>`;
	const poTotal = purchaseOrders.reduce((sum, row) => sum + flt(row.grand_total), 0);
	const prTotal = purchaseReceipts.reduce((sum, row) => sum + flt(row.grand_total), 0);
	const piTotal = purchaseInvoices.reduce((sum, row) => sum + flt(row.grand_total), 0);
	const piOutstandingTotal = purchaseInvoices.reduce((sum, row) => sum + flt(row.outstanding_amount), 0);
	const tagTraceHtml = build_tag_trace_html(tagTrace);
	const tagTreeHtml = build_tag_tree_html(tagTree);
	const packingTotalPacks = packingDetails.reduce((sum, row) => sum + flt(row.no_of_pack), 0);
	const packingRows = packingDetails.length
		? packingDetails
				.map(
					(row) => `<tr>
			<td>${escape_html(row.raw_material_item || row.item_name || row.item_code || "-")}</td>
			<td>${escape_html(row.tag_no || "-")}</td>
			<td>${escape_html(row.packing_type || "-")}</td>
			<td>${escape_html(row.packing_weightsize || "-")}</td>
			<td>${format_number(row.no_of_pack)}</td>
			<td>${escape_html(row.packing_remarks || "-")}</td>
			<td>${escape_html(row.packing_comments || "-")}</td>
		</tr>`,
				)
				.join("")
		: `<tr><td colspan="7" style="text-align:center; color:#64748b;">No packing detail entered yet.</td></tr>`;

	const bomSectionsHtml = bomDetails.length
		? bomDetails.map((bom) => `
			<div style="margin-top:12px; border:1px solid #d7e5ef; border-radius:14px; overflow:hidden;">
				<div style="padding:12px 14px; background:#fff;">
					<div style="font-size:14px; font-weight:800; color:#102a43;">Item: ${escape_html(bom.item_name || bom.item_code)} | <span style="color:#c96c00;">BOM: ${escape_html(bom.bom_no)}</span></div>
					<div style="font-size:12px; color:#6b7280; margin-top:4px;">SO Qty: ${format_number(bom.qty)}</div>
				</div>
				<div style="overflow:auto;">
					<table class="table table-bordered" style="margin-bottom:0; background:#fff; min-width:760px;">
						<thead style="background:#dfe9ff; color:#1f56d2;">
							<tr><th>Raw Material</th><th>Qty / BOM</th><th>Required for Order</th><th>Stock</th><th>Shortage</th></tr>
						</thead>
						<tbody>
							${(bom.rows || []).map((row) => `<tr>
								<td>${escape_html(row.item_code || row.item_name || "-")}</td>
								<td>${format_number(row.qty)}</td>
								<td>${format_number(row.required_qty)}</td>
								<td>${format_number(row.stock_qty_available)}</td>
								<td>${numberPill(row.shortage_qty, flt(row.shortage_qty) ? "danger" : "success")}</td>
							</tr>`).join("") || `<tr><td colspan="5" style="text-align:center; color:#64748b;">No BOM rows found.</td></tr>`}
						</tbody>
					</table>
				</div>
			</div>`).join("")
		: `<div style="color:#64748b;">No active/default BOM found for this order's items yet.</div>`;

	const stockLedgerTableRows = stockLedgerRows.length
		? stockLedgerRows.map((row) => `<tr>
			<td>${escape_html(row.posting_date || "-")}</td>
			<td>${escape_html(row.voucher_type || "-")}</td>
			<td>${escape_html(row.voucher_no || "-")}</td>
			<td>${escape_html(row.item_code || "-")}</td>
			<td>${escape_html(row.warehouse || "-")}</td>
			<td>${format_number(row.actual_qty)}</td>
			<td>${format_number(row.qty_after_transaction)}</td>
		</tr>`).join("")
		: `<tr><td colspan="7" style="text-align:center; color:#64748b;">No stock ledger rows found for current order items.</td></tr>`;

	const reportLinks = [
		actionButton(`/app/query-report/Stock%20Ledger?company=${encodeURIComponent(data.company || "")}`, "Item Ledger"),
		actionButton(`/app/sales-order/${encodeURIComponent(data.sales_order || "")}`, "Open Order"),
		actionButton(`/app/ss-coil/view/list?order_no=${encodeURIComponent(data.sales_order || "")}`, "SS Coil"),
		actionButton(`/app/stock-entry/view/list`, "Stock Entry"),
	].join("");

	return `
		<div id="${dashboardId}" style="display:grid; gap:16px; margin-bottom:18px; font-family:'Segoe UI','Helvetica Neue',sans-serif; color:#142433;">
			${dashboardBehaviorScript(dashboardId)}
			<div style="background:linear-gradient(90deg,#2467d6 0%,#2396d1 52%,#18bbcb 100%); color:#fff; border-radius:18px; padding:18px 18px 14px; box-shadow:0 18px 40px rgba(24,76,149,.22);">
				<div style="font-size:13px; font-weight:800;">Sales Order Connection Report</div>
				<div style="margin-top:8px; color:#eaf5ff; font-size:15px;">Sales Order: ${escape_html(data.sales_order || "-")}</div>
				<div style="display:flex; gap:10px; flex-wrap:wrap; margin-top:12px;">${reportLinks}</div>
				<div style="display:grid; grid-template-columns:repeat(auto-fit,minmax(180px,1fr)); gap:10px; margin-top:14px;">
					${heroMetricCard("Total Qty", format_number(data.total_qty))}
					${heroMetricCard("Produced Qty", format_number(totalSsCoilWeight))}
					${heroMetricCard("Pending Qty", format_number(pendingQty))}
					${heroMetricCard("Completion", `${format_number(data.per_delivered)}%`)}
					${heroMetricCard("Linked WO", format_number(ssCoilDocs.length))}
				</div>
			</div>

			${collapsibleSection("Manufacturing Control Center", "Same logic style with live order control and linked production visibility", "#2d7ff0", `
				<div style="display:grid; grid-template-columns:repeat(auto-fit,minmax(210px,1fr)); gap:10px;">
					${flatInfoCard("Company", data.company || "-")}
					${flatInfoCard("Sales Order", data.sales_order || "-")}
					${flatInfoCard("Customer", data.customer_name || data.customer || "-")}
					${flatInfoCard("For Customer", data.for_customer || "-")}
					${flatInfoCard("Items", items.map((item) => item.item_name || "-").filter((n) => n !== "-").slice(0, 2).join(", ") || "-")}
				</div>
				<div style="display:grid; grid-template-columns:repeat(auto-fit,minmax(190px,1fr)); gap:10px; margin-top:12px;">
					${dashboardCard("Links", "Status", data.status || "-", "#ffffff", "#0f2842", "18px")}
					${dashboardCard("Delivery", "Delivery / Billing", `${format_number(data.per_delivered)}% / ${format_number(data.per_billed)}%`, "#ffffff", "#2451d3")}
					${dashboardCard("SS Coil", "Orders in Work", format_number(ssCoilDocs.length), "#ffffff", "#198754")}
					${dashboardCard("Stock Entry", "Linked Entries", format_number(stockEntries.length), "#ffffff", "#8a4b08")}
					${dashboardCard("Plans", "Plan Rows", format_number(totalPlanRows), "#ffffff", "#7b2cbf")}
				</div>
			`)}

			${collapsibleSection("Sales Order Items Planning", "Planning overview by Sales Order item", "#1f56d2", `
				<div style="overflow:auto;">
					<table class="table table-bordered" style="margin-bottom:0; background:#fffdf9; min-width:1100px; border-color:#d9e6ff;">
						<thead style="background:#dfe9ff; color:#1f56d2;">
							<tr>
								<th>Item</th>
								<th>Qty</th>
								<th>Tag</th>
								<th>Ref</th>
								<th>Dimension</th>
								<th>Specification</th>
								<th>Mother Item</th>
								<th>Status</th>
								<th>Est WT</th>
								<th>Calc Ratio</th>
								<th>Actual Ratio</th>
								<th>Remaining Width</th>
							</tr>
						</thead>
						<tbody>${itemRows}</tbody>
					</table>
				</div>
				<div style="margin-top:16px;">
					<div style="font-size:13px;font-weight:800;color:#102a43;margin-bottom:8px;">Operations (Slitter / Leveler / Reshearing)</div>
					${planningOperationsHtml}
				</div>
			`)}

			${(cuttingGroups && cuttingGroups.length)
				? collapsibleSection("Cutting Scheme Report", "Mother coil / raw cutting scheme detail", "#1f8c3a", cuttingSchemeHtml)
				: ""}

			${collapsibleSection("Tag Traceability", "Mother coil from Stock Entry through Sales Order, plan, SS Coil operations, and finish goods", "#be185d", `
				<div style="display:flex; flex-wrap:wrap; gap:12px; align-items:center; margin-bottom:14px;">
					${dashboardLinkButton(`/app/query-report/Tag%20Registry%20Trace?sales_order=${encodeURIComponent(data.sales_order || "")}`, "Tag Registry Trace Report", "#16324f", "#ffffff")}
					${dashboardLinkButton(`/app/tag-registry?sales_order=${encodeURIComponent(data.sales_order || "")}`, "Tag Registry List", "#1f56d2", "#ffffff")}
				</div>
				<div style="color:#52657a; font-size:13px; margin-bottom:16px;">Trail order: <b>Purchase / Stock Entry (mother coil)</b> → <b>Sales Order</b> → <b>SS Coil Input / Output (operation)</b> → <b>Delivery / Invoice</b>. Each root tag below is one mother-coil lineage.</div>
				${stackedDetailSection("Tag Tree", "Root parent tag, child / sub-child tags, and SS Coil operation flow", tagTreeHtml)}
				<div style="height:14px;"></div>
				${stackedDetailSection("Tag Trace", "Full document trail per tag (sorted by root → parent → tag)", tagTraceHtml)}
			`)}

			${collapsibleSection("Profit & Loss", "Commercial totals and order profitability snapshot", "#7b2cbf", `
				<div style="display:grid; grid-template-columns:repeat(auto-fit,minmax(220px,1fr)); gap:14px;">
					${dashboardCard("Profit & Loss", "Grand Total", format_currency(data.grand_total, data.currency), "#ffffff", "#0f2842")}
					${dashboardCard("Profit & Loss", "Expense Total", format_currency(data.expense_total, data.currency), "#ffffff", "#9a3412")}
					${dashboardCard("Profit & Loss", "Profit Proxy", format_currency(data.profit_proxy, data.currency), "#ffffff", "#15803d")}
				</div>
				<div style="margin-top:14px;">
					${stackedDetailSection("Profit Detail", "Current summary with account-wise expense effect", infoPanel("Profit & Loss", [["Currency", data.currency], ["Taxes & Charges", format_currency(expenseBreakup.taxes || 0, data.currency)], ["Journal Entry Expense", format_currency(expenseBreakup.journal_entries || 0, data.currency)], ["Expense Claim Total", format_currency(expenseBreakup.expense_claims || 0, data.currency)], ["Net Total", format_currency(data.net_total, data.currency)], ["Rounded Total", format_currency(data.rounded_total, data.currency)]], '#fcfbff', '#e7ddfb'))}
				</div>
			`)}

			${collapsibleSection("Operations", "Core commercial and planning snapshot", "#0f766e", `
				${stackedDetailSection("Operations Snapshot", "Current sales order operational state", infoPanel("Operations", [["Order Date", data.transaction_date], ["Delivery Date", data.delivery_date], ["PO No", data.po_no], ["IGP No", data.igp_no], ["Currency", data.currency], ["Total Qty", format_number(data.total_qty)]], '#fbfdff', '#d8e5ef'))}
			`)}

			${collapsibleSection("Production SS Coil", "Planning and execution details from SS Coil records", "#9a5b00", `
				<div style="display:grid; grid-template-columns:repeat(auto-fit,minmax(220px,1fr)); gap:12px;">
					${dashboardCard("Production", "Orders in Work", String(ssCoilDocs.length), "#ffffff", "#184d83")}
					${dashboardCard("Production", "Draft / Submitted", `${draftSsCoil} / ${submittedSsCoil}`, "#ffffff", "#5055a2")}
					${dashboardCard("Production", "Plan Rows", format_number(totalPlanRows), "#ffffff", "#1f5d42")}
					${dashboardCard("Production", "Plan Total Width", format_number(totalPlanWidth), "#ffffff", "#985612")}
				</div>
				<div style="margin-top:14px;">
					${stackedDetailSection("Production Summary", "Execution summary with room for job and output detail", infoPanel("Production SS Coil", [["Draft / Submitted", `${draftSsCoil} / ${submittedSsCoil}`], ["Plan Rows", format_number(totalPlanRows)], ["Planned Est WT", format_number(totalSsCoilWeight)], ["Pending Qty", format_number(pendingQty)]], '#fafcff', '#d7e1ec'))}
				</div>
			`)}

			${collapsibleSection("Stock Entry", "Linked stock movement and receiving visibility", "#5d2ca5", `
				${stackedDetailSection("Stock Entry Documents", "Linked stock entry headers", `
					<div style="overflow:auto;">
						<table class="table table-bordered" style="margin-bottom:0; background:#fff; min-width:760px;">
							<thead style="background:#dfe9ff; color:#1f56d2;">
								<tr><th>Stock Entry</th><th>Purpose</th><th>Date</th><th>Customer</th><th>For Customer</th></tr>
							</thead>
							<tbody>${stockEntryDocRows}</tbody>
						</table>
					</div>
				`)}
				${stackedDetailSection("Stock Entry Items", "Linked stock entry item rows", `
					<div style="overflow:auto;">
						<table class="table table-bordered" style="margin-bottom:0; background:#fff; min-width:980px;">
							<thead style="background:#dfe9ff; color:#1f56d2;">
								<tr><th>Stock Entry</th><th>Item Code</th><th>Item Name</th><th>Qty</th><th>Tag No</th><th>Dimension</th><th>Est WT</th></tr>
							</thead>
							<tbody>${stockEntryItemRows}</tbody>
						</table>
					</div>
				`)}
			`)}

			${collapsibleSection("Expenses", "Charges and commercial deductions", "#7c2de2", `
				${stackedDetailSection("Expense Summary", "Current totals and overview", infoPanel("Expenses", [["Taxes & Charges", format_currency(expenseBreakup.taxes || 0, data.currency)], ["Journal Entry Expense", format_currency(expenseBreakup.journal_entries || 0, data.currency)], ["Expense Claim Total", format_currency(expenseBreakup.expense_claims || 0, data.currency)], ["Expense Total", format_currency(data.expense_total, data.currency)], ["Profit Proxy", format_currency(data.profit_proxy, data.currency)]], '#fffafd', '#f1d9e4'))}
				${stackedDetailSection("Journal Entries", "Real linked journal entry rows", `
					<div style="overflow:auto;">
						<table class="table table-bordered" style="margin-bottom:0; background:#fff; min-width:980px;">
							<thead style="background:#dfe9ff; color:#1f56d2;">
								<tr><th>Journal Entry</th><th>Date</th><th>Account</th><th>Ref Type</th><th>Ref Name</th><th>Debit</th><th>Credit</th></tr>
							</thead>
							<tbody>${journalEntryRows}</tbody>
						</table>
					</div>
				`)}
				${stackedDetailSection("Expense Claims", "Expense claim documents linked by project when available", `
					<div style="overflow:auto;">
						<table class="table table-bordered" style="margin-bottom:0; background:#fff; min-width:900px;">
							<thead style="background:#dfe9ff; color:#1f56d2;">
								<tr><th>Expense Claim</th><th>Date</th><th>Employee</th><th>Project</th><th>Status</th><th>Sanctioned Amount</th></tr>
							</thead>
							<tbody>${expenseClaimRows}</tbody>
						</table>
					</div>
				`)}
				${stackedDetailSection("Expense Claim Detail", "Expense lines with account and amount", `
					<div style="overflow:auto;">
						<table class="table table-bordered" style="margin-bottom:0; background:#fff; min-width:980px;">
							<thead style="background:#dfe9ff; color:#1f56d2;">
								<tr><th>Expense Claim</th><th>Date</th><th>Account</th><th>Description</th><th>Amount</th><th>Cost Center</th></tr>
							</thead>
							<tbody>${expenseClaimDetailRows}</tbody>
						</table>
					</div>
				`)}
			`)}

			${collapsibleSection("BOM", "BOM and raw material section", "#13a0bf", `
				${stackedDetailSection("BOM & Raw Materials", "Item and BOM merged for easier reading", bomSectionsHtml)}
			`)}

			${collapsibleSection("Packing Detail", "Packing from Coil Production (mother coil / raw)", "#0f7f7c", `
				${stackedDetailSection("Packing Snapshot", "Packing summary from Coil Production raw rows", infoPanel("Packing Detail", [["Packed Rows", format_number(packingDetails.length)], ["No. of Pack Total", format_number(packingTotalPacks)], ["System Packed Rows", format_number(data.packed_items_count)], ["Status", packingDetails.length ? "Packing detail available" : "No packing rows yet"]], '#f8fefe', '#d1ece8'))}
				${stackedDetailSection("Packing Table", "Mother coil / raw packing detail with tag number", `
					<div style="overflow:auto;">
						<table class="table table-bordered" style="margin-bottom:0; background:#fff; min-width:1080px;">
							<thead style="background:#dfe9ff; color:#1f56d2;">
								<tr><th>Mother Coil / Raw</th><th>Tag No</th><th>Packing Type</th><th>Packing Weight/Size</th><th>No of Pack</th><th>Remarks</th><th>Comments</th></tr>
							</thead>
							<tbody>${packingRows}</tbody>
						</table>
					</div>
				`)}
			`)}

			${collapsibleSection("Dispatched Status", "Delivery, invoicing and payment completion", "#ff6a00", `
				${stackedDetailSection("Order Item Summary", "Ordered, delivered, invoiced and pending quantity by item", `
					<div style="overflow:auto;">
						<table class="table table-bordered" style="margin-bottom:0; background:#fff; min-width:860px; border-color:#d9e6ff;">
							<thead style="background:#dfe9ff; color:#1f56d2;">
								<tr>
									<th>Item Code</th>
									<th>Item Name</th>
									<th>Ordered</th>
									<th>Delivered</th>
									<th>Invoiced</th>
									<th>Pending</th>
								</tr>
							</thead>
							<tbody>${dispatchSummaryRows}</tbody>
						</table>
					</div>
				`)}
				${stackedDetailSection("Delivery & Billing", "Delivery Note -> Invoices detail", `
					<div style="overflow:auto;">
						<table class="table table-bordered" style="margin-bottom:0; background:#fff; min-width:760px;">
							<thead style="background:#dfe9ff; color:#1f56d2;">
								<tr><th>Delivery Note</th><th>Invoices</th></tr>
							</thead>
							<tbody>${deliveryBillingRows}</tbody>
						</table>
					</div>
				`)}
				${stackedDetailSection("Payments", "Payment entries linked to sales invoices of this order", `
					<div style="overflow:auto;">
						<table class="table table-bordered" style="margin-bottom:0; background:#fff; min-width:900px;">
							<thead style="background:#dfe9ff; color:#1f56d2;">
								<tr><th>Payment Entry</th><th>Date</th><th>Party</th><th>Invoice</th><th>Allocated Amount</th></tr>
							</thead>
							<tbody>${paymentEntryRows}</tbody>
						</table>
					</div>
				`)}
				${stackedDetailSection("Delivery Risk Prediction", "Delivery delay warning based on current completion", `
					<div style="display:grid; grid-template-columns:repeat(auto-fit,minmax(220px,1fr)); gap:12px;">
						${dashboardCard("Risk", "Delivery Date", data.delivery_date || "-", "#ffffff", "#0f2842")}
						${dashboardCard("Risk", "Completion", `${format_number(data.per_delivered)}%`, "#ffffff", "#2451d3")}
						${dashboardCard("Risk", "Status", data.per_delivered >= 100 ? "On Track" : "Monitor", "#ffffff", data.per_delivered >= 100 ? "#16a34a" : "#d97706")}
					</div>
				`)}
			`)}

			${collapsibleSection("Reports", "Order reporting area and future document drill-down", "#1d8b3d", `
				<div style="display:grid; grid-template-columns:repeat(auto-fit,minmax(200px,1fr)); gap:12px; margin-bottom:14px;">
					${dashboardCard("PO", "Count / Total", `${format_number(purchaseOrders.length)} / ${format_currency(poTotal, data.currency)}`, "#ffffff", "#1f56d2")}
					${dashboardCard("PR", "Count / Total", `${format_number(purchaseReceipts.length)} / ${format_currency(prTotal, data.currency)}`, "#ffffff", "#198754")}
					${dashboardCard("PI", "Count / Total", `${format_number(purchaseInvoices.length)} / ${format_currency(piTotal, data.currency)}`, "#ffffff", "#9a3412")}
					${dashboardCard("PI", "Outstanding", format_currency(piOutstandingTotal, data.currency), "#ffffff", "#dc2626")}
				</div>
				${stackedDetailSection("PO Analytics", "Purchase Order records linked by custom sales order", `
					<div style="overflow:auto;">
						<table class="table table-bordered" style="margin-bottom:0; background:#fff; min-width:880px;">
							<thead style="background:#dfe9ff; color:#1f56d2;">
								<tr><th>Purchase Order</th><th>Date</th><th>Supplier</th><th>Status</th><th>Total</th></tr>
							</thead>
							<tbody>${purchaseOrderRows}</tbody>
						</table>
					</div>
				`)}
				${stackedDetailSection("Purchase Receipt", "Purchase receipts linked by custom sales order", `
					<div style="overflow:auto;">
						<table class="table table-bordered" style="margin-bottom:0; background:#fff; min-width:880px;">
							<thead style="background:#dfe9ff; color:#1f56d2;">
								<tr><th>Purchase Receipt</th><th>Date</th><th>Supplier</th><th>Status</th><th>Total</th></tr>
							</thead>
							<tbody>${purchaseReceiptRows}</tbody>
						</table>
					</div>
				`)}
				${stackedDetailSection("Purchase Invoice", "Purchase invoices linked by custom sales order", `
					<div style="overflow:auto;">
						<table class="table table-bordered" style="margin-bottom:0; background:#fff; min-width:980px;">
							<thead style="background:#dfe9ff; color:#1f56d2;">
								<tr><th>Purchase Invoice</th><th>Date</th><th>Supplier</th><th>Status</th><th>Total</th><th>Outstanding</th></tr>
							</thead>
							<tbody>${purchaseInvoiceRows}</tbody>
						</table>
					</div>
				`)}
				${stackedDetailSection("Tag Registry Trace", "Open grouped parent-child tag report or browse registry for this order", `
					<div style="display:flex; flex-wrap:wrap; gap:12px; align-items:center; margin-bottom:12px;">
						${dashboardLinkButton(`/app/query-report/Tag%20Registry%20Trace?sales_order=${encodeURIComponent(data.sales_order || "")}`, "Open Tag Registry Trace", "#16324f", "#ffffff")}
						${dashboardLinkButton(`/app/tag-registry?sales_order=${encodeURIComponent(data.sales_order || "")}`, "Open Tag Registry List", "#1f56d2", "#ffffff")}
					</div>
					<div style="color:#52657a; font-size:13px;">Use the <b>Tag Traceability</b> section on this dashboard for the full tree and document trail.</div>
				`)}
			`)}

			${collapsibleSection("Stock of this Order", "Current stock status tied to this order", "#0f766e", `
				${stackedDetailSection("Stock Position", "Current stock references tied to this order", `
					<div style="overflow:auto;">
						<table class="table table-bordered" style="margin-bottom:0; background:#fff; min-width:980px;">
							<thead style="background:#dfe9ff; color:#1f56d2;">
								<tr><th>Stock Entry</th><th>Item Code</th><th>Item Name</th><th>Qty</th><th>Tag No</th><th>Dimension</th><th>Est WT</th></tr>
							</thead>
							<tbody>${stockEntryItemRows}</tbody>
						</table>
					</div>
				`)}
			`)}

			${collapsibleSection("Item Ledger of this Order", "Ledger and movement trace for order items", "#0f2a47", `
				${stackedDetailSection("Item Ledger", "Current stock ledger rows for order items", `
					<div style="overflow:auto;">
						<table class="table table-bordered" style="margin-bottom:0; background:#fff; min-width:980px;">
							<thead style="background:#dfe9ff; color:#1f56d2;">
								<tr><th>Date</th><th>Voucher Type</th><th>Voucher No</th><th>Item Code</th><th>Warehouse</th><th>Actual Qty</th><th>Qty After Txn</th></tr>
							</thead>
							<tbody>${stockLedgerTableRows}</tbody>
						</table>
					</div>
				`)}
			`)}

			${collapsibleSection("Production SS Coil Records", "Order wise operational records loaded from SS Coil", "#0f2a47", `
				<div style="overflow:auto;">
					<table class="table table-bordered" style="margin-bottom:0; background:#fbfdff; min-width:1000px; border-color:#dbe5f1;">
						<thead style="background:#203549; color:#f8fbff;">
							<tr>
								<th>SS Coil</th>
								<th>Status</th>
								<th>Machine</th>
								<th>SO Item</th>
								<th>Stock Entry</th>
								<th>Grand Est WT</th>
								<th>Grand Total Width</th>
								<th>Actual Ratio</th>
								<th>Remaining Width</th>
							</tr>
						</thead>
						<tbody>${ssCoilRows}</tbody>
					</table>
				</div>
			`)}
		</div>
	`;
}

function dashboardBehaviorScript(dashboardId) {
	return `<script>
		(function() {
			const root = document.getElementById(${JSON.stringify(dashboardId)});
			if (!root || root.dataset.boundAccordion === "1") return;
			root.dataset.boundAccordion = "1";
			root.querySelectorAll("[data-accordion]").forEach(function(section) {
				const body = section.querySelector("[data-accordion-body]");
				const expandBtn = section.querySelector("[data-accordion-expand]");
				const collapseBtn = section.querySelector("[data-accordion-collapse]");
				if (!body || !expandBtn || !collapseBtn) return;
				expandBtn.addEventListener("click", function() { body.style.display = ""; });
				collapseBtn.addEventListener("click", function() { body.style.display = "none"; });
			});
		})();
	</script>`;
}

function collapsibleSection(title, subtitle, barColor, bodyHtml) {
	return `
		<div data-accordion="${escape_html(title)}" style="background:#fff; border:1px solid #dbe5f1; border-radius:18px; overflow:hidden; box-shadow:0 12px 28px rgba(15,23,42,.05);">
			<div style="background:${barColor}; color:#fff; padding:12px 14px; display:flex; align-items:center; justify-content:space-between; gap:12px;">
				<div>
					<div style="font-size:20px; font-weight:800; line-height:1.1;">${escape_html(title)}</div>
					<div style="font-size:12px; opacity:.84; margin-top:4px;">${escape_html(subtitle)}</div>
				</div>
				<div style="display:flex; gap:8px;">
					<button type="button" data-accordion-expand style="${accordionButtonStyle()}">Expand</button>
					<button type="button" data-accordion-collapse style="${accordionButtonStyle()}">Collapse</button>
				</div>
			</div>
			<div data-accordion-body style="padding:16px; background:#fff;">${bodyHtml}</div>
		</div>`;
}

function stackedDetailSection(title, subtitle, contentHtml) {
	return `<div style="background:#f8fbff; border:1px solid #d8e3f0; border-radius:16px; overflow:hidden;">
		<div style="padding:14px 16px; background:linear-gradient(180deg,#f7fbff 0%,#eef4fb 100%); border-bottom:1px solid #dce8f4;">
			<div style="font-size:15px; font-weight:800; color:#102a43;">${escape_html(title)}</div>
			<div style="font-size:12px; color:#708399; margin-top:3px;">${escape_html(subtitle)}</div>
		</div>
		<div style="padding:14px 16px;">${contentHtml}</div>
	</div>`;
}

function heroMetricCard(label, value) {
	return `<div style="background:rgba(255,255,255,.95); color:#0f2842; border-radius:14px; padding:12px 14px; min-height:66px; display:flex; flex-direction:column; justify-content:space-between;">
		<div style="font-size:11px; color:#64748b; text-transform:uppercase; font-weight:800; letter-spacing:.04em;">${escape_html(label)}</div>
		<div style="font-size:16px; font-weight:800; text-align:right;">${escape_html(value)}</div>
	</div>`;
}

function flatInfoCard(label, value) {
	return `<div style="background:#fff; border:1px solid #d7e4f4; border-radius:14px; padding:12px 14px;">
		<div style="font-size:11px; text-transform:uppercase; color:#6b7280; font-weight:800;">${escape_html(label)}</div>
		<div style="font-size:14px; font-weight:800; color:#102a43; margin-top:4px;">${escape_html(value)}</div>
	</div>`;
}

function accordionButtonStyle() {
	return 'display:inline-flex; align-items:center; justify-content:center; min-width:84px; padding:8px 12px; background:#0e2440; color:#fff; border:0; border-radius:10px; font-size:12px; font-weight:800; cursor:pointer;';
}

function statusPill(label, tone) {
	const themes = {
		success: ["#16a34a", "#f0fdf4"],
		warning: ["#d97706", "#fff7ed"],
		danger: ["#dc2626", "#fef2f2"],
		dark: ["#111827", "#e5e7eb"],
		muted: ["#475569", "#f1f5f9"],
	};
	const [fg, bg] = themes[tone] || themes.muted;
	return `<span style="display:inline-flex; align-items:center; padding:4px 10px; border-radius:999px; background:${bg}; color:${fg}; font-size:11px; font-weight:800; line-height:1.2;">${escape_html(label)}</span>`;
}

function numberPill(value, tone) {
	return statusPill(format_number(value), tone);
}

function docChip(value, tone) {
	return statusPill(value, tone);
}

function docLink(route, value, tone = "dark") {
	if (!value || value === "-") return "-";
	return `<a href="/app/${route}/${encodeURIComponent(value)}" target="_blank" style="text-decoration:none;">${docChip(value, tone)}</a>`;
}

function expenseStatusTone(status) {
	const normalized = (status || "").toLowerCase();
	if (["paid", "submitted"].includes(normalized)) return "success";
	if (["rejected", "cancelled"].includes(normalized)) return "danger";
	if (["unpaid", "draft"].includes(normalized)) return "warning";
	return "muted";
}

function purchaseStatusTone(status) {
	const normalized = (status || "").toLowerCase();
	if (normalized.includes("complete") || normalized.includes("paid")) return "success";
	if (normalized.includes("cancel")) return "danger";
	if (normalized.includes("bill") || normalized.includes("receive") || normalized.includes("progress") || normalized.includes("submit")) return "warning";
	return "muted";
}

function dashboardCard(section, label, value, bg, color, valueSize = "25px") {
	return `<div style="background:${bg}; border:1px solid rgba(17,24,39,.08); border-radius:16px; padding:16px 18px; box-shadow: inset 0 1px 0 rgba(255,255,255,.5);">
		<div style="font-size:11px; text-transform:uppercase; letter-spacing:.08em; color:#6b7280; font-weight:700;">${escape_html(section)}</div>
		<div style="font-size:13px; color:#475569; margin-top:8px;">${escape_html(label)}</div>
		<div style="font-size:${valueSize}; font-weight:800; color:${color}; margin-top:6px; line-height:1.1;">${escape_html(value)}</div>
	</div>`;
}

function panelStyle(bg = '#fff', border = '#dce6f2') {
	return `background:${bg}; border:1px solid ${border}; border-radius:18px; padding:18px 20px; box-shadow:0 10px 30px rgba(18,52,79,.06);`;
}

function panelTitle(title, subtitle) {
	return `<div style="margin-bottom:12px;">
		<div style="font-size:18px; font-weight:800; color:#16324f; letter-spacing:.01em;">${escape_html(title)}</div>
		<div style="font-size:12px; color:#64748b; margin-top:3px;">${escape_html(subtitle)}</div>
	</div>`;
}

function metricLine(label, value) {
	return `<div style="display:flex; justify-content:space-between; gap:12px; padding:8px 0; border-bottom:1px dashed #e5edf5;">
		<div style="color:#64748b;">${escape_html(label)}</div>
		<div style="font-weight:700; color:#16324f; text-align:right;">${escape_html(value || "-")}</div>
	</div>`;
}

function infoPanel(title, rows, bg = '#fff', border = '#dce6f2') {
	return `<div style="${panelStyle(bg, border)}">
		${panelTitle(title, "Operational snapshot")}
		${rows.map((row) => metricLine(row[0], row[1])).join("")}
	</div>`;
}

function sectionWrap(bg, border) {
	return `background:${bg}; border:1px solid ${border}; border-radius:22px; padding:18px; display:grid; gap:14px; box-shadow:0 16px 36px rgba(15,23,42,.05);`;
}

function sectionHeader(title, subtitle) {
	return `<div style="padding-bottom:8px; border-bottom:1px dashed rgba(22,50,79,.16);">
		<div style="font-size:22px; font-weight:800; color:#16324f; letter-spacing:.01em;">${escape_html(title)}</div>
		<div style="font-size:12px; color:#66788d; margin-top:4px;">${escape_html(subtitle)}</div>
	</div>`;
}

function actionButton(href, label) {
	return `<a href="${href}" target="_blank" style="display:inline-flex; align-items:center; padding:10px 14px; background:rgba(255,255,255,.14); color:#f7fbff; border:1px solid rgba(255,255,255,.22); border-radius:999px; font-size:12px; font-weight:700; text-decoration:none; backdrop-filter: blur(4px);">${escape_html(label)}</a>`;
}

function dashboardLinkButton(href, label, bg, color) {
	return `<a href="${href}" target="_blank" style="display:inline-flex; align-items:center; justify-content:center; padding:10px 16px; background:${bg}; color:${color}; border-radius:999px; font-size:12px; font-weight:800; text-decoration:none; border:1px solid rgba(15,23,42,.08); box-shadow:0 8px 18px rgba(15,23,42,.08);">${escape_html(label)}</a>`;
}

function format_currency(value, currency) {
	return `${escape_html(currency || "")} ${format_number(value)}`.trim();
}

function escape_html(value) {
	return frappe.utils.escape_html(value == null ? "" : String(value));
}

function cutting_scheme_dimension_part(value) {
	if (value == null || value === "") {
		return "";
	}
	const num = flt(value);
	if (!Number.isNaN(num) && String(value).trim() !== "" && /^-?\d+(\.\d+)?$/.test(String(value).trim())) {
		return num % 1 === 0 ? String(parseInt(num, 10)) : String(num);
	}
	return String(value).trim();
}

function cutting_scheme_row_dimension(group, row) {
	const t = cutting_scheme_dimension_part(group.thickness);
	const w = cutting_scheme_dimension_part(row?.width ?? group.width);
	const pk = group.process_key || "slitter";
	if (pk === "slitter") {
		const lc = group.length_c || "C";
		return [t, w, lc].filter((p) => p !== "").join(" × ");
	}
	const len = cutting_scheme_dimension_part(row?.length ?? group.length);
	return [t, w, len].filter((p) => p !== "").join(" × ");
}

function cutting_scheme_process_dimension(group) {
	const row_list = group.rows || [];
	return (
		(row_list.length ? cutting_scheme_row_dimension(group, row_list[0]) : "") ||
		cutting_scheme_row_dimension(group, {}) ||
		group.dimension ||
		group.dimension_numeric ||
		""
	);
}

function build_cutting_scheme_process_table_html(group) {
	const process_key = group.process_key || "slitter";
	const process_label = group.process_label || SS_COIL_CUTTING_PROCESS_LABELS[process_key] || process_key;
	const is_slitter = process_key === "slitter";
	const row_list = group.rows || [];
	const cell = "padding:8px 10px; font-size:12px;";

	const rows = row_list.length
		? row_list
				.map((row) => {
					if (is_slitter) {
						return `<tr>
							<td style="${cell}">${row.seq || ""}</td>
							<td style="${cell}">${row.width || ""}</td>
							<td style="${cell}">${row.strip || ""}</td>
							<td style="${cell}">${row.lengthcut || ""}</td>
							<td style="${cell}">${row.total_width || ""}</td>
							<td style="${cell}">${row.tolerance_plus || ""}</td>
							<td style="${cell}">${row.tolerance_minus || ""}</td>
							<td style="${cell}">${row.knife ? "Yes" : "No"}</td>
						</tr>`;
					}
					const totalSheets =
						row.total_sheets != null && row.total_sheets !== ""
							? row.total_sheets
							: flt(row.strip) > 1
								? row.strip
								: "";
					return `<tr>
						<td style="${cell}">${row.seq || ""}</td>
						<td style="${cell}">${row.width || ""}</td>
						<td style="${cell}">${row.length || ""}</td>
						<td style="${cell}">${row.lengthcut || ""}</td>
						<td style="${cell}">${totalSheets}</td>
						<td style="${cell}">${row.tolerance_plus || ""}</td>
						<td style="${cell}">${row.tolerance_minus || ""}</td>
					</tr>`;
				})
				.join("")
		: `<tr><td colspan="${is_slitter ? 8 : 7}" style="color:#64748b;text-align:center;padding:12px;">${__(
				"No rows saved",
			)}</td></tr>`;

	const thead = is_slitter
		? `<tr>
			<th style="${cell}">SEQ</th><th style="${cell}">Width</th><th style="${cell}">Strip</th><th style="${cell}">LengthCut</th>
			<th style="${cell}">Total Width</th><th style="${cell}">Tol (+)</th><th style="${cell}">Tol (-)</th><th style="${cell}">Knife</th>
		</tr>`
		: `<tr>
			<th style="${cell}">SEQ</th><th style="${cell}">Width</th><th style="${cell}">Length</th><th style="${cell}">LengthCut</th>
			<th style="${cell}">Total sheets</th><th style="${cell}">Tol(+)</th><th style="${cell}">Tol(-)</th>
		</tr>`;

	return `
		<div style="margin-bottom:12px;">
			<div style="display:flex;align-items:center;gap:10px;margin-bottom:8px;flex-wrap:wrap;">
				<span style="display:inline-block;background:#1d4ed8;color:#fff;font-size:12px;font-weight:800;padding:5px 14px;border-radius:8px;">${escape_html(process_label)}</span>
				<span style="font-size:12px;color:#64748b;">${row_list.length ? `${row_list.length} ${__("row(s)")}` : __("Not saved")}</span>
			</div>
			<div style="overflow:auto;">
				<table class="table table-bordered" style="margin-bottom:0; background:#fffefb; min-width:${is_slitter ? 680 : 620}px;">
					<thead style="background:#22384d; color:#f8fbff;">${thead}</thead>
					<tbody>${rows}</tbody>
				</table>
			</div>
		</div>`;
}

function group_cutting_scheme_report_by_item(groups) {
	const process_order = { slitter: 0, leveler: 1, reshearing: 2 };
	const by_item = new Map();
	(groups || []).forEach((group) => {
		const key = group.sales_order_item || group.item_label || group.plan_name || "";
		if (!by_item.has(key)) {
			by_item.set(key, { meta: { ...group }, processes: [] });
		}
		const entry = by_item.get(key);
		if (!entry.meta.dimension_numeric && group.dimension_numeric) {
			entry.meta.dimension_numeric = group.dimension_numeric;
		}
		if (!entry.meta.thickness && group.thickness) {
			entry.meta.thickness = group.thickness;
		}
		if (!entry.meta.length_c && group.length_c) {
			entry.meta.length_c = group.length_c;
		}
		if (!entry.meta.length && group.length) {
			entry.meta.length = group.length;
		}
		entry.processes.push(group);
	});
	return Array.from(by_item.values()).map((entry) => {
		entry.processes.sort(
			(a, b) =>
				(process_order[a.process_key] ?? 9) - (process_order[b.process_key] ?? 9) ||
				String(a.process_label || "").localeCompare(String(b.process_label || "")),
		);
		return entry;
	});
}

function build_cutting_scheme_report_html(groups) {
	if (!groups.length) {
		return `<div style="${panelStyle("#fffefb", "#eadfbe")}"><div style="color:#7b6f5c;">No cutting scheme saved yet.</div></div>`;
	}

	return group_cutting_scheme_report_by_item(groups)
		.map(({ meta, processes }) => {
			const process_chips = processes
				.map((p) => {
					const label = p.process_label || SS_COIL_CUTTING_PROCESS_LABELS[p.process_key] || p.process_key;
					const dim = cutting_scheme_process_dimension(p);
					return `<div style="margin:0 0 8px;padding:8px 10px;background:rgba(15,23,42,.28);border:1px solid rgba(255,255,255,.12);border-radius:10px;">
						<div style="display:inline-block;background:#334155;color:#f8fafc;font-size:10px;font-weight:800;padding:3px 9px;border-radius:6px;letter-spacing:.02em;">${escape_html(label)}</div>
						${
							dim
								? `<div style="margin-top:6px;font-size:12px;font-weight:700;color:#e2e8f0;line-height:1.35;">
							<span style="font-size:9px;text-transform:uppercase;letter-spacing:.06em;color:#94a3b8;font-weight:800;margin-right:6px;">${__("Dim")}</span>${escape_html(dim)}
						</div>`
								: ""
						}
					</div>`;
				})
				.join("");
			const process_tables = processes.map((p) => build_cutting_scheme_process_table_html(p)).join("");

			return `
				<div style="border:1px solid #ddd6bf; border-radius:18px; overflow:hidden; background:linear-gradient(180deg,#fffdfa 0%,#f7f2e8 100%); box-shadow:0 10px 28px rgba(70,53,20,.06); margin-bottom:16px;">
					<div style="display:flex; gap:0; align-items:stretch; flex-wrap:wrap;">
						<div style="flex:0 0 240px; background:linear-gradient(180deg,#203549 0%,#314e68 100%); color:#f7fbff; padding:14px 16px;">
							<div style="font-size:10px; text-transform:uppercase; letter-spacing:.1em; opacity:.72;">Cutting Item</div>
							<div style="font-size:17px; font-weight:800; margin-top:6px;line-height:1.3;">${escape_html(meta.item_label || meta.sales_order_item)}</div>
							<div style="margin-top:10px; display:grid; gap:6px; font-size:11px; color:#d9e7f4;">
								<div><strong>Qty:</strong> ${meta.qty || "-"}</div>
								<div><strong>Tag:</strong> ${escape_html(meta.tag_no || "-")}</div>
							</div>
							<div style="margin-top:12px;">
								<div style="font-size:10px;text-transform:uppercase;letter-spacing:.08em;opacity:.75;margin-bottom:8px;">${__(
									"Processes",
								)}</div>
								${process_chips}
							</div>
						</div>
						<div style="flex:1; min-width:420px; padding:12px 12px 8px;">
							${process_tables}
						</div>
					</div>
				</div>`;
		})
		.join("");
}

function build_packing_detail_html(packing) {
	if (!packing || !packing.length) {
		return `<div style="background:#f8fbff; border:1px solid #d8e3f0; border-radius:16px; padding:18px; color:#64748b;">
			No packing detail entered yet. Set packing on Coil Production (Mother Coil / Raw) rows.
		</div>`;
	}

	const totalPacks = packing.reduce((sum, row) => sum + flt(row.no_of_pack), 0);
	const rows = packing
		.map(
			(row, index) => `<tr>
				<td>${index + 1}</td>
				<td>${escape_html(row.raw_material_item || row.item_name || row.item_code || "-")}</td>
				<td>${escape_html(row.tag_no || "-")}</td>
				<td>${escape_html(row.packing_type || "-")}</td>
				<td>${escape_html(row.packing_weightsize || "-")}</td>
				<td>${format_number(row.no_of_pack)}</td>
				<td>${escape_html(row.packing_remarks || "-")}</td>
				<td>${escape_html(row.packing_comments || "-")}</td>
			</tr>`,
		)
		.join("");

	return `<div style="display:grid; gap:14px; margin-bottom:14px; font-family:'Segoe UI','Helvetica Neue',sans-serif;">
		<div style="background:linear-gradient(90deg,#0f7f7c 0%,#159b92 100%); color:#fff; border-radius:16px; padding:16px 18px; box-shadow:0 14px 30px rgba(15,127,124,.18);">
			<div style="font-size:18px; font-weight:800;">Packing Detail</div>
			<div style="margin-top:6px; color:#dbfffb; font-size:13px;">Mother coil / raw packing from Coil Production</div>
			<div style="display:grid; grid-template-columns:repeat(auto-fit,minmax(180px,1fr)); gap:10px; margin-top:14px;">
				${heroMetricCard("Packing Rows", format_number(packing.length))}
				${heroMetricCard("No Of Pack", format_number(totalPacks))}
			</div>
		</div>
		<div style="background:#fff; border:1px solid #d8e3f0; border-radius:16px; overflow:hidden; box-shadow:0 12px 28px rgba(15,23,42,.05);">
			<div style="padding:14px 16px; background:linear-gradient(180deg,#f7fbff 0%,#eef4fb 100%); border-bottom:1px solid #dce8f4;">
				<div style="font-size:15px; font-weight:800; color:#102a43;">Packing Table</div>
				<div style="font-size:12px; color:#708399; margin-top:3px;">Raw material and tag number with packing detail</div>
			</div>
			<div style="padding:14px 16px; overflow:auto;">
				<table class="table table-bordered" style="margin-bottom:0; background:#fff; min-width:1100px;">
					<thead style="background:#dfe9ff; color:#1f56d2;">
						<tr><th>#</th><th>Mother Coil / Raw</th><th>Tag No</th><th>Packing Type</th><th>Packing Weight/Size</th><th>No of Pack</th><th>Remarks</th><th>Comments</th></tr>
					</thead>
					<tbody>${rows}</tbody>
				</table>
			</div>
		</div>
	</div>`;
}

function build_tag_trace_html(tagTrace) {
	if (!tagTrace || !tagTrace.length) {
		return `<div style="${panelStyle("#fbfdff", "#d7e5ef")}"><div style="color:#64748b;">No tag trace found for this order yet.</div></div>`;
	}

	return tagTrace
		.map((trace) => {
			const registry = trace.registry || {};
			const events = trace.events || [];
			const eventRows = events.length
				? events
						.map(
							(event) => `<tr>
								<td>${statusPill(event.stage || "-", tagStageTone(event.stage))}</td>
								<td>${event.doctype && event.docname ? docLink(routeForDoctype(event.doctype), event.docname, "dark") : "-"}</td>
								<td>${escape_html(event.date || "-")}</td>
								<td>${escape_html(event.item_name || event.item_code || "-")}</td>
								<td>${format_number(event.qty)}</td>
								<td>${escape_html(tagExtraText(event.extra || {}))}</td>
							</tr>`,
						)
						.join("")
				: `<tr><td colspan="6" style="text-align:center; color:#64748b;">No movement rows found for this tag yet.</td></tr>`;

			return `<div style="border:1px solid #d8e3f0; border-radius:16px; overflow:hidden; background:#fff; box-shadow:0 10px 22px rgba(15,23,42,.05); margin-top:12px;">
				<div style="background:linear-gradient(90deg,#0f2a47 0%,#1f56d2 100%); color:#fff; padding:14px 16px;">
					<div style="display:flex; justify-content:space-between; gap:12px; align-items:flex-start; flex-wrap:wrap;">
						<div>
							<div style="font-size:18px; font-weight:800;">${escape_html(trace.tag_no || "-")}</div>
							<div style="font-size:12px; color:#dbeafe; margin-top:4px;">Source: ${escape_html(registry.source_doctype || "-")} / ${escape_html(registry.source_docname || "-")}</div>
							<div style="font-size:12px; color:#dbeafe; margin-top:4px;">Parent: ${escape_html(registry.parent_tag_no || "-")} | Root: ${escape_html(registry.root_tag_no || trace.tag_no || "-")}</div>
						</div>
						<div style="display:grid; grid-template-columns:repeat(auto-fit,minmax(120px,1fr)); gap:8px; min-width:320px;">
							${miniTraceCard("Status", registry.status || "Active")}
							${miniTraceCard("Item", registry.item_name || registry.item_code || "-")}
							${miniTraceCard("Current", [registry.current_doctype, registry.current_docname].filter(Boolean).join(" / ") || "-")}
						</div>
					</div>
				</div>
				<div style="padding:14px 16px;">
					<div style="overflow:auto;">
						<table class="table table-bordered" style="margin-bottom:0; background:#fff; min-width:980px;">
							<thead style="background:#dfe9ff; color:#1f56d2;">
								<tr><th>Stage</th><th>Document</th><th>Date</th><th>Item</th><th>Qty</th><th>Detail</th></tr>
							</thead>
							<tbody>${eventRows}</tbody>
						</table>
					</div>
				</div>
			</div>`;
		})
		.join("");
}

function build_tag_tree_html(tagTree) {
	if (!tagTree || !tagTree.length) {
		return `<div style="${panelStyle("#fbfdff", "#d7e5ef")}"><div style="color:#64748b;">No parent / child tag tree found yet. Link a Stock Entry mother coil or save SS Coil output tags for this order.</div></div>`;
	}

	return tagTree
		.map((group) => {
			const rootTrace = group.root_trace || {};
			const rootRegistry = rootTrace.registry || {};
			const children = group.children || [];
			const hierarchy = group.hierarchy || null;
			const hierarchyDiagram = hierarchy ? build_so_tag_hierarchy_diagram(hierarchy) : "";
			const hierarchyDetail = hierarchy ? build_so_tag_hierarchy_detail(hierarchy) : "";
			const flatRows = hierarchy ? flatten_so_tag_hierarchy(hierarchy) : [];

			const childRows = flatRows.length
				? flatRows
						.map((node, index) => {
							const op =
								(node.previous_docs && node.previous_docs[0] && node.previous_docs[0].operation) ||
								(node.next_docs && node.next_docs[0] && node.next_docs[0].operation) ||
								"-";
							const ssCoilDoc =
								(node.previous_docs && node.previous_docs[0] && node.previous_docs[0].name) ||
								(node.next_docs && node.next_docs[0] && node.next_docs[0].name) ||
								"";
							const indent = "&nbsp;".repeat(Math.min((node.depth || 0) * 4, 24));
							return `<tr>
								<td>${index + 1}</td>
								<td>${indent}${escape_html(node.tag_no || "-")}</td>
								<td>${statusPill(node.status || "Active", node.depth ? "warning" : "success")}</td>
								<td>${escape_html(node.item_name || node.item_code || "-")}</td>
								<td>${escape_html(op)}</td>
								<td>${ssCoilDoc ? docLink("ss-coil", ssCoilDoc, "dark") : "-"}</td>
								<td>${escape_html([node.current_doctype, node.current_docname].filter(Boolean).join(" / ") || "-")}</td>
							</tr>`;
						})
						.join("")
				: children.length
					? children
							.map((child, index) => {
								const reg = child.registry || {};
								const ssCoilEvent = (child.events || []).find((e) => (e.stage || "").includes("SS Coil")) || {};
								const latestEvent = (child.events || []).slice(-1)[0] || {};
								const operation = (ssCoilEvent.extra || {}).operation || (latestEvent.extra || {}).operation || "-";
								return `<tr>
								<td>${index + 1}</td>
								<td>${escape_html(child.tag_no || "-")}</td>
								<td>${statusPill(reg.status || "Produced", "warning")}</td>
								<td>${escape_html(reg.item_name || reg.item_code || latestEvent.item_name || "-")}</td>
								<td>${escape_html(operation)}</td>
								<td>${ssCoilEvent.docname ? docLink("ss-coil", ssCoilEvent.docname, "dark") : "-"}</td>
								<td>${escape_html([reg.current_doctype, reg.current_docname].filter(Boolean).join(" / ") || "-")}</td>
							</tr>`;
							})
							.join("")
					: `<tr><td colspan="7" style="text-align:center; color:#64748b;">No produced child tags yet.</td></tr>`;

			return `<div style="border:1px solid #d8e3f0; border-radius:16px; overflow:hidden; background:#fff; box-shadow:0 10px 22px rgba(15,23,42,.05); margin-top:12px;">
				<div style="background:linear-gradient(90deg,#14532d 0%,#1f8c3a 100%); color:#fff; padding:14px 16px;">
					<div style="display:flex; justify-content:space-between; gap:12px; flex-wrap:wrap; align-items:flex-start;">
						<div>
							<div style="font-size:18px; font-weight:800;">Root / Mother Tag: ${escape_html(group.root_tag_no || "-")}</div>
							<div style="font-size:12px; color:#def7e3; margin-top:4px;">Source: ${escape_html(rootRegistry.source_doctype || "-")} / ${escape_html(rootRegistry.source_docname || "-")}</div>
						</div>
						<div style="display:grid; grid-template-columns:repeat(auto-fit,minmax(120px,1fr)); gap:8px; min-width:320px;">
							${miniTraceCard("Root Status", rootRegistry.status || "Active")}
							${miniTraceCard("Tags in Tree", format_number(flatRows.length || children.length + 1))}
							${miniTraceCard("Current", [rootRegistry.current_doctype, rootRegistry.current_docname].filter(Boolean).join(" / ") || "-")}
						</div>
					</div>
				</div>
				<div style="padding:14px 16px; display:grid; gap:14px;">
					<div style="background:#f8fbff; border:1px solid #d8e3f0; border-radius:14px; padding:14px 16px;">
						<div style="font-size:14px; font-weight:800; color:#102a43;">Parent Summary</div>
						<div style="display:grid; grid-template-columns:repeat(auto-fit,minmax(180px,1fr)); gap:10px; margin-top:10px;">
							${flatInfoCard("Tag No", group.root_tag_no || "-")}
							${flatInfoCard("Item", rootRegistry.item_name || rootRegistry.item_code || "-")}
							${flatInfoCard("Sales Order", rootRegistry.sales_order || "-")}
							${flatInfoCard("Stock Entry", rootRegistry.stock_entry || "-")}
						</div>
					</div>
					${hierarchyDiagram ? `<div style="background:#f8fbff;border:1px solid #dbe7f3;border-radius:14px;padding:14px 16px;">
						<div style="font-size:14px;font-weight:800;color:#102a43;margin-bottom:10px;">Hierarchy Diagram</div>
						${hierarchyDiagram}
					</div>` : ""}
					${hierarchyDetail ? `<div style="background:#fff;border:1px solid #dbe7f3;border-radius:14px;padding:14px 16px;">
						<div style="font-size:14px;font-weight:800;color:#102a43;margin-bottom:8px;">Hierarchy Detail</div>
						<div style="overflow:auto;">${hierarchyDetail}</div>
					</div>` : ""}
					<div style="overflow:auto;">
						<table class="table table-bordered" style="margin-bottom:0; background:#fff; min-width:980px;">
							<thead style="background:#dfe9ff; color:#1f56d2;">
								<tr><th>#</th><th>Tag</th><th>Status</th><th>Item</th><th>Operation</th><th>SS Coil</th><th>Current Document</th></tr>
							</thead>
							<tbody>${childRows}</tbody>
						</table>
					</div>
				</div>
			</div>`;
		})
		.join("");
}

function flatten_so_tag_hierarchy(node, depth = 0, rows = []) {
	if (!node || !node.tag_no) return rows;
	rows.push({ ...node, depth });
	for (const child of node.children || []) {
		flatten_so_tag_hierarchy(child, depth + 1, rows);
	}
	return rows;
}

function build_so_tag_hierarchy_diagram(node) {
	if (!node || !node.tag_no) {
		return `<div style="color:#64748b;font-size:13px;">No hierarchy diagram.</div>`;
	}
	const renderLevel = (current, depth = 0) => {
		const kids = current.children || [];
		const op =
			(current.previous_docs && current.previous_docs[0] && current.previous_docs[0].operation) ||
			(current.next_docs && current.next_docs[0] && current.next_docs[0].operation) ||
			"";
		return `
			<div style="display:flex;flex-direction:column;align-items:center;gap:10px;min-width:max-content;">
				<div style="background:${depth ? "#1d4ed8" : "#0f172a"};color:#fff;border-radius:14px;padding:12px 16px;min-width:200px;max-width:240px;text-align:center;">
					<div style="font-size:15px;font-weight:800;">${escape_html(current.tag_no)}</div>
					<div style="font-size:11px;opacity:.92;margin-top:4px;">${escape_html(op || current.status || "-")}</div>
				</div>
				${kids.length ? `
					<div style="font-size:16px;font-weight:800;color:#2563eb;">↓</div>
					<div style="display:flex;gap:12px;align-items:flex-start;justify-content:center;flex-wrap:wrap;">${kids.map((child) => renderLevel(child, depth + 1)).join("")}</div>
				` : ""}
			</div>`;
	};
	return `<div style="overflow:auto;padding:8px 0;"><div style="display:flex;justify-content:center;min-width:max-content;">${renderLevel(node)}</div></div>`;
}

function build_so_tag_hierarchy_detail(node, depth = 0) {
	if (!node || !node.tag_no) return "";
	const op =
		(node.previous_docs && node.previous_docs[0] && node.previous_docs[0].operation) ||
		(node.next_docs && node.next_docs[0] && node.next_docs[0].operation) ||
		"-";
	const pad = 12 + depth * 18;
	const childHtml = (node.children || []).map((child) => build_so_tag_hierarchy_detail(child, depth + 1)).join("");
	return `
		<div style="margin-left:${pad}px;border-left:2px solid #dbe7f3;padding-left:12px;margin-bottom:8px;">
			<div style="font-weight:800;color:#102a43;">${escape_html(node.tag_no)}</div>
			<div style="font-size:12px;color:#64748b;margin-top:2px;">${escape_html(node.status || "-")} | Op: ${escape_html(op)} | ${escape_html(node.item_name || node.item_code || "-")}</div>
		</div>${childHtml}`;
}

function routeForDoctype(doctype) {
	const mapping = {
		"Sales Order": "sales-order",
		"Purchase Receipt": "purchase-receipt",
		"Purchase Invoice": "purchase-invoice",
		"Stock Entry": "stock-entry",
		"Delivery Note": "delivery-note",
		"Sales Invoice": "sales-invoice",
		"SS Coil": "ss-coil",
	};
	return mapping[doctype] || frappe.router.slug(doctype || "");
}

function tagStageTone(stage) {
	const normalized = (stage || "").toLowerCase();
	if (normalized.includes("ss coil input")) return "dark";
	if (normalized.includes("ss coil")) return "warning";
	if (normalized.includes("invoice")) return "success";
	if (normalized.includes("delivery")) return "warning";
	if (normalized.includes("stock")) return "dark";
	if (normalized.includes("purchase")) return "muted";
	if (normalized.includes("sales")) return "success";
	return "muted";
}

function tagExtraText(extra) {
	if (extra.supplier) return `Supplier: ${extra.supplier}`;
	if (extra.customer) return `Customer: ${extra.customer}`;
	if (extra.purpose) return `Purpose: ${extra.purpose}`;
	if (extra.operation) {
		const parts = [`Operation: ${extra.operation}`];
		if (extra.sales_order) parts.push(`SO: ${extra.sales_order}`);
		return parts.join(" | ");
	}
	return "-";
}

function miniTraceCard(label, value) {
	return `<div style="background:rgba(255,255,255,.95); color:#0f2842; border-radius:12px; padding:10px 12px;">
		<div style="font-size:10px; text-transform:uppercase; color:#64748b; font-weight:800; letter-spacing:.04em;">${escape_html(label)}</div>
		<div style="font-size:12px; font-weight:800; margin-top:4px;">${escape_html(value)}</div>
	</div>`;
}

function render_cutting_scheme_report(frm) {
	const html_field = frm.fields_dict.custom_cutting_scheme_report;
	if (!html_field) return;
	if (frm.is_new && frm.is_new()) {
		html_field.$wrapper.empty();
		return;
	}
	if (!frm.doc.name || String(frm.doc.name).startsWith("new-sales-order-")) {
		html_field.$wrapper.empty();
		return;
	}

	frappe.call({
		method: "ss_coil.api.get_sales_order_cutting_scheme_report",
		args: {
			sales_order: frm.doc.name,
		},
		callback: function (r) {
			const groups = r.message || [];
			if (!groups.length) {
				html_field.$wrapper.html("<div class='text-muted'>No cutting scheme saved yet.</div>");
				return;
			}
			html_field.$wrapper.html(build_cutting_scheme_report_html(groups));
		},
	});
}

function render_item_cutting_scheme_preview(frm, cdt, cdn) {
	const row = locals[cdt] && locals[cdt][cdn];
	if (!row || !frm.doc.name) return;
	if (is_unsaved_sales_order_context(frm, row.name)) {
		return;
	}

	const grid_row = frm.fields_dict.items?.grid?.grid_rows_by_docname?.[cdn];
	const wrapper =
		grid_row?.grid_form?.fields_dict?.custom_cutting_scheme_preview?.$wrapper;
	if (!wrapper) return;

	frappe.call({
		method: "ss_coil.api.get_so_production_plans_for_item",
		args: {
			sales_order: frm.doc.name,
			sales_order_item: row.name,
		},
		callback: function (r) {
			wrapper.html(format_cutting_scheme_preview_html(r.message || {}));
		},
	});
}

function render_production_cutting_scheme_preview(frm, cdt, cdn) {
	const row = locals[cdt] && locals[cdt][cdn];
	if (!row || !frm.doc.name) return;
	if (is_unsaved_sales_order_context(frm, row.name)) {
		return;
	}

	const grid_row = frm.fields_dict.custom_coil_production?.grid?.grid_rows_by_docname?.[cdn];
	const wrapper = grid_row?.grid_form?.fields_dict?.cutting_scheme_preview?.$wrapper;
	if (!wrapper) return;

	if (!row.sales_order_item) {
		wrapper.html(
			`<div class="text-muted">${__("Save the Sales Order to link this raw row, then manage cutting scheme.")}</div>`
		);
		return;
	}

	frappe.call({
		method: "ss_coil.api.get_so_production_plans_for_item",
		args: {
			sales_order: frm.doc.name,
			sales_order_item: row.sales_order_item,
			coil_production_line: row.name,
		},
		callback: function (r) {
			wrapper.html(format_cutting_scheme_preview_html(r.message || {}));
		},
	});
}

function cutting_scheme_process_tone(process_key) {
	const tones = {
		slitter: { bg: "#1d4ed8", soft: "#eff4ff", border: "#c7d7fe", text: "#1e3a8a" },
		leveler: { bg: "#0f766e", soft: "#ecfdf8", border: "#99f6e4", text: "#115e59" },
		reshearing: { bg: "#b45309", soft: "#fff7ed", border: "#fdba74", text: "#9a3412" },
	};
	return tones[process_key] || tones.slitter;
}

function format_cutting_scheme_preview_html(payload) {
	const processes = payload.processes || ["slitter"];
	const plans = payload.plans || {};
	if (!processes.length) {
		return `<div style="padding:10px 12px;color:#64748b;font-size:12px;">${__(
			"No processes configured on this row.",
		)}</div>`;
	}

	const sections = processes
		.map((pk) => {
			const label = SS_COIL_CUTTING_PROCESS_LABELS[pk] || pk;
			const tone = cutting_scheme_process_tone(pk);
			const rows = (plans[pk]?.rows || []).map(map_cutting_scheme_row_from_server);
			const is_slitter = pk === "slitter";
			const th =
				"padding:7px 9px;font-size:11px;font-weight:700;letter-spacing:.02em;white-space:nowrap;border-bottom:1px solid rgba(255,255,255,.12);";
			const td =
				"padding:6px 9px;font-size:12px;color:#1f2937;border-bottom:1px solid #e8eef5;white-space:nowrap;";

			if (!rows.length) {
				return `<div style="margin:0 0 10px;border:1px solid ${tone.border};border-radius:10px;overflow:hidden;background:${tone.soft};">
					<div style="display:flex;align-items:center;gap:8px;padding:8px 12px;background:#fff;border-bottom:1px solid ${tone.border};">
						<span style="display:inline-block;background:${tone.bg};color:#fff;font-size:11px;font-weight:800;padding:4px 12px;border-radius:999px;">${frappe.utils.escape_html(
							label,
						)}</span>
						<span style="font-size:11px;color:#64748b;">${__("No rows saved")}</span>
					</div>
				</div>`;
			}

			const body = rows
				.map((d, idx) => {
					const bg = idx % 2 ? "#f8fafc" : "#ffffff";
					if (is_slitter) {
						return `<tr style="background:${bg};">
							<td style="${td}">${d.seq || ""}</td>
							<td style="${td}">${d.width || ""}</td>
							<td style="${td}">${d.strip || ""}</td>
							<td style="${td}">${d.lengthcut || ""}</td>
							<td style="${td}">${d.total_width || ""}</td>
							<td style="${td}">${d.tolerance_plus || ""}</td>
							<td style="${td}">${d.tolerance_minus || ""}</td>
							<td style="${td}">${d.knife ? __("Yes") : __("No")}</td>
						</tr>`;
					}
					const totalSheets =
						d.total_sheets != null && d.total_sheets !== ""
							? d.total_sheets
							: flt(d.strip) > 1
								? d.strip
								: "";
					return `<tr style="background:${bg};">
						<td style="${td}">${d.seq || ""}</td>
						<td style="${td}">${d.width || ""}</td>
						<td style="${td}">${d.length || ""}</td>
						<td style="${td}">${d.lengthcut || ""}</td>
						<td style="${td}">${totalSheets}</td>
						<td style="${td}">${d.tolerance_plus || ""}</td>
						<td style="${td}">${d.tolerance_minus || ""}</td>
					</tr>`;
				})
				.join("");

			const thead = is_slitter
				? `<tr>
					<th style="${th}">SEQ</th>
					<th style="${th}">${__("Width")}</th>
					<th style="${th}">${__("Strip")}</th>
					<th style="${th}">${__("LengthCut")}</th>
					<th style="${th}">${__("Total Width")}</th>
					<th style="${th}">${__("Tol (+)")}</th>
					<th style="${th}">${__("Tol (-)")}</th>
					<th style="${th}">${__("Knife")}</th>
				</tr>`
				: `<tr>
					<th style="${th}">SEQ</th>
					<th style="${th}">${__("Width")}</th>
					<th style="${th}">${__("Length")}</th>
					<th style="${th}">${__("LengthCut")}</th>
					<th style="${th}">${__("Total sheets")}</th>
					<th style="${th}">${__("Tol (+)")}</th>
					<th style="${th}">${__("Tol (-)")}</th>
				</tr>`;

			return `<div style="margin:0 0 12px;border:1px solid #d7e3ef;border-radius:10px;overflow:hidden;background:#fff;box-shadow:0 1px 2px rgba(15,23,42,.04);">
				<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;padding:8px 12px;background:linear-gradient(180deg,#ffffff 0%,${tone.soft} 100%);border-bottom:1px solid ${tone.border};">
					<span style="display:inline-block;background:${tone.bg};color:#fff;font-size:11px;font-weight:800;padding:4px 12px;border-radius:999px;letter-spacing:.02em;">${frappe.utils.escape_html(
						label,
					)}</span>
					<span style="font-size:11px;color:${tone.text};font-weight:600;">${rows.length} ${__("row(s)")}</span>
				</div>
				<div style="overflow:auto;">
					<table style="width:100%;margin:0;border-collapse:collapse;min-width:${is_slitter ? 560 : 520}px;">
						<thead style="background:#243b53;color:#f8fbff;">${thead}</thead>
						<tbody>${body}</tbody>
					</table>
				</div>
			</div>`;
		})
		.join("");

	return (
		`<div class="ss-coil-cutting-preview" style="padding:2px 0 4px;">${sections}</div>` ||
		`<div style="padding:10px 12px;color:#64748b;font-size:12px;">${__(
			"No cutting scheme rows saved for this item.",
		)}</div>`
	);
}
