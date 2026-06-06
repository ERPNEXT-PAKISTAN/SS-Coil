// Copyright (c) 2026, Taimoor and contributors
// For license information, please see license.txt

frappe.ui.form.on("SS Coil", {
	setup(frm) {
		frm.set_query("sales_order_item", function () {
			if (!frm.doc.order_no) {
				return { filters: { name: "" } };
			}

			return {
				query: "ss_coil.api.sales_order_item_query",
				filters: {
					parent: frm.doc.order_no,
				},
			};
		});
		frm.set_query("stock_entry_items", function () {
			if (!frm.doc.stock_entry) {
				return { filters: { name: "" } };
			}

			return {
				query: "ss_coil.api.stock_entry_item_query",
				filters: {
					parent: frm.doc.stock_entry,
				},
			};
		});
	},
	refresh(frm) {
		add_ss_coil_tag_buttons(frm);
		add_process_action_buttons(frm);
		frm.set_df_property("order_status", "read_only", 1);
		update_grand_totals(frm);
		update_calc_ratio(frm);
		update_remaining_width(frm);
		update_input_coil_length(frm);
		rebuild_job_output_if_needed(frm);
		update_elapsed_time_display(frm);
		render_job_output_qr_fields(frm);
		render_ss_coil_dashboard(frm);
	},
	operation(frm) {
		sync_process_preview(frm);
	},
	estimated_wt(frm) {
		update_calc_ratio(frm);
	},
	grand_estimated_wt(frm) {
		update_calc_ratio(frm);
	},
	cutting_detail_add(frm) {
		rebuild_job_output_from_input(frm);
		update_grand_totals(frm);
	},
	cutting_detail_remove(frm) {
		rebuild_job_output_from_input(frm);
		update_grand_totals(frm);
	},
	job_output_add(frm) {
		sync_process_preview(frm);
		update_grand_totals(frm);
	},
	job_output_remove(frm) {
		sync_process_preview(frm);
		update_grand_totals(frm);
	},
	order_no(frm) {
		if (!frm.doc.order_no) {
			frm.set_value("sales_order_item", "");
			frm.clear_table("so_item");
			frm.refresh_field("so_item");
			frm.clear_table("input_coil");
			frm.refresh_field("input_coil");
			frm.clear_table("job_output");
			frm.refresh_field("job_output");
			frm.clear_table("cutting_detail");
			frm.refresh_field("cutting_detail");
			clear_sales_order_item_mapped_fields(frm);
			update_elapsed_time_display(frm);
			update_grand_totals(frm);
			return;
		}
		frm.set_value("sales_order_item", "");
		frm.clear_table("so_item");
		frm.refresh_field("so_item");
		frm.clear_table("input_coil");
		frm.refresh_field("input_coil");
		frm.clear_table("job_output");
		frm.refresh_field("job_output");
		frm.clear_table("cutting_detail");
		frm.refresh_field("cutting_detail");
		clear_sales_order_item_mapped_fields(frm);
		update_elapsed_time_display(frm);
		update_grand_totals(frm);
	},
	stock_entry(frm) {
		if (!frm.doc.stock_entry) {
			frm.set_value("stock_entry_items", "");
			frm.clear_table("input_coil");
			frm.refresh_field("input_coil");
			return;
		}
		frm.set_value("stock_entry_items", "");
		frm.clear_table("input_coil");
		frm.refresh_field("input_coil");
	},
	sales_order_item(frm) {
		if (!frm.doc.order_no || !frm.doc.sales_order_item) {
			frm.clear_table("so_item");
			frm.refresh_field("so_item");
			frm.clear_table("input_coil");
			frm.refresh_field("input_coil");
			frm.clear_table("job_output");
			frm.refresh_field("job_output");
			frm.clear_table("cutting_detail");
			frm.refresh_field("cutting_detail");
			clear_sales_order_item_mapped_fields(frm);
			update_elapsed_time_display(frm);
			update_grand_totals(frm);
			return;
		}

		frappe.call({
			method: "frappe.client.get",
			args: {
				doctype: "Sales Order Item",
				name: frm.doc.sales_order_item,
			},
			freeze: true,
			freeze_message: __("Loading Selected Sales Order Item..."),
			callback: function (r) {
				const item = r.message;
				if (!item) return;

				const target_fields = (frappe.meta.get_docfields("Coil SO") || [])
					.filter(
						(df) =>
							df.fieldname &&
							![
								"Section Break",
								"Column Break",
								"Tab Break",
								"HTML",
								"Button",
								"Table",
								"Table MultiSelect",
							].includes(df.fieldtype),
					)
					.map((df) => df.fieldname);

				frm.clear_table("so_item");
				const row = frm.add_child("so_item");

				target_fields.forEach((fieldname) => {
					if (fieldname === "so_number") {
						row.so_number = frm.doc.order_no;
						return;
					}

					if (fieldname === "length_c") {
						row.length_c = item.custom_length_c || "";
						return;
					}

					if (fieldname === "dimension") {
						row.dimension = item.custom_dimension || item.custom_dimensin || "";
						return;
					}

					const direct_value = item[fieldname];
					const custom_value = item[`custom_${fieldname}`];

					if (direct_value !== undefined && direct_value !== null) {
						row[fieldname] = direct_value;
					} else if (custom_value !== undefined && custom_value !== null) {
						row[fieldname] = custom_value;
					}
				});

				if (!row.item_name && item.item_code) {
					row.item_name = item.item_name || item.item_code;
				}

				frm.set_value("machine", item.custom_machine || "");
				frm.set_value("calc_ratio", flt(item.custom_calc_ratio));
				frm.set_value("calc_ratio_2", flt(item.custom_calc_ratio_2));
				frm.set_value("actual_ratio", flt(item.custom_actual_ratio));
				frm.set_value("remaining_width", flt(item.custom_remaining_width));
				frm.set_value("order_status", item.custom_status || "");

				frm.refresh_field("so_item");
				load_input_coil_from_sales_order_item(frm, item);
				update_input_coil_length(frm);
				rebuild_job_output_from_input(frm);
				sync_process_preview(frm);

				frappe.call({
					method: "ss_coil.api.get_so_production_plan_rows",
					args: {
						sales_order_item: item.name,
					},
					callback: function (scheme_response) {
						load_cutting_scheme_from_so_item(frm, scheme_response.message || []);
					},
				});
			},
		});
	},
	stock_entry_items(frm) {
		if (!frm.doc.stock_entry || !frm.doc.stock_entry_items) {
			frm.clear_table("input_coil");
			frm.refresh_field("input_coil");
			return;
		}

		frappe.call({
			method: "frappe.client.get",
			args: {
				doctype: "Stock Entry Detail",
				name: frm.doc.stock_entry_items,
			},
			freeze: true,
			freeze_message: __("Loading Selected Stock Entry Item..."),
			callback: function (r) {
				const item = r.message;
				if (!item) return;

				const target_fields = (frappe.meta.get_docfields("Coil Input") || [])
					.filter(
						(df) =>
							df.fieldname &&
							![
								"Section Break",
								"Column Break",
								"Tab Break",
								"HTML",
								"Button",
								"Table",
								"Table MultiSelect",
							].includes(df.fieldtype),
					)
					.map((df) => df.fieldname);

				const special_map = {
					class: item.item_name || item.item_code,
					tag_no: item.custom_tag_no,
					dimension: item.custom_dimension,
					estimated_wt: item.custom_estimated_wt,
					location: item.custom_location,
					estimated_qty: item.qty,
					actual_qty: item.transfer_qty,
				};

				frm.clear_table("input_coil");
				const row = frm.add_child("input_coil");

				target_fields.forEach((fieldname) => {
					if (special_map[fieldname] !== undefined) {
						row[fieldname] = special_map[fieldname];
						return;
					}

					if (fieldname === "length") {
						return;
					}

					const direct_value = item[fieldname];
					const custom_value = item[`custom_${fieldname}`];

					if (direct_value !== undefined && direct_value !== null) {
						row[fieldname] = direct_value;
					} else if (custom_value !== undefined && custom_value !== null) {
						row[fieldname] = custom_value;
					}
				});

				update_input_coil_length(frm, row);
				rebuild_job_output_from_input(frm);
				sync_process_preview(frm);
				frm.refresh_field("input_coil");
			},
		});
	},
	order_status(frm) {
		if (frm.doc.order_status === "Completed" && !frm.doc.completed_on) {
			frm.set_value("completed_on", frappe.datetime.now_datetime());
		}
		if (["In Process", "Partially Completed"].includes(frm.doc.order_status) && !frm.doc.started_on) {
			frm.set_value("started_on", frappe.datetime.now_datetime());
		}
		if (frm.doc.started_on) {
			frm.set_value("elapsed_time", getElapsedTimeValue(frm));
		}
		update_elapsed_time_display(frm);
		render_ss_coil_dashboard(frm);
	},
});

function render_ss_coil_dashboard(frm) {
	const field = frm.fields_dict.order_status_report;
	if (!field) return;
	if (!frm.doc.name || (frm.is_new && frm.is_new())) {
		field.$wrapper && field.$wrapper.html(
			`<div style="padding:18px;border:1px dashed #c9d7ea;border-radius:12px;background:#f8fbff;color:#486581;">
				Save the SS Coil document once to load its live dashboard.
			</div>`,
		);
		return;
	}

	frappe.call({
		method: "ss_coil.api.get_ss_coil_detail_dashboard",
		args: { ss_coil_name: frm.doc.name },
		callback: function (r) {
			const data = r.message || {};
			if (!field.$wrapper) return;
			field.$wrapper.html(buildSSCoilDashboardHtml(data));
			bindSSCoilDashboardActions(frm, field.$wrapper, data);
		},
	});
}

function buildSSCoilDashboardHtml(data) {
	const esc = (value) => frappe.utils.escape_html(String(value ?? ""));
	const fmt = (value, decimals = 2) => format_number(value || 0, null, decimals);
	const summary = data.summary || {};
	const status = data.status_flow || {};
	const so = data.so_item || {};
	const inputTitleTag = (data.input_tags && data.input_tags[0]) || data.root_tag_no || "-";
	const currentTagSet = new Set([...(data.input_tags || []), ...(data.output_tags || [])]);
	const soProcessList = [
		so.slitter || so.custom_slitter,
		so.leveler || so.custom_leveler,
		so.reshearing || so.custom_reshearing,
	].filter(Boolean);
	const cuttingRows = data.cutting_rows || [];

	const statCard = (label, value, accent) => `
		<div style="background:#fff;border:1px solid #dbe7f3;border-radius:16px;padding:14px 16px;box-shadow:0 4px 14px rgba(15,23,42,.05);">
			<div style="font-size:11px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:${accent || "#52667a"};">${esc(label)}</div>
			<div style="font-size:24px;font-weight:800;color:#102a43;margin-top:6px;">${esc(value)}</div>
		</div>
	`;

	const section = (title, subtitle, color, body) => `
		<div style="border:1px solid #d8e3f0;border-radius:18px;overflow:hidden;background:#fff;box-shadow:0 8px 28px rgba(15,23,42,.06);margin-top:16px;">
			<div style="background:${color};color:#fff;padding:14px 18px;">
				<div style="font-size:20px;font-weight:800;">${esc(title)}</div>
				<div style="font-size:12px;opacity:.9;margin-top:4px;">${esc(subtitle || "")}</div>
			</div>
			<div style="padding:18px;">${body}</div>
		</div>
	`;

	const chips = (values, tone) => (values || []).length
		? values.map((value) => `<span style="display:inline-block;background:${tone || "#eef6ff"};color:#1d4f91;border:1px solid #bfdbfe;border-radius:999px;padding:6px 10px;margin:0 8px 8px 0;font-size:12px;font-weight:700;">${esc(value)}</span>`).join("")
		: `<span style="color:#7b8794;font-size:12px;">No tags available</span>`;

	const table = (headers, rows) => `
		<div style="overflow:auto;border:1px solid #d9e2ec;border-radius:14px;">
			<table style="width:100%;border-collapse:collapse;background:#fff;">
				<thead>
					<tr style="background:#edf4ff;">
						${headers.map((header) => `<th style="padding:10px 12px;border-bottom:1px solid #d9e2ec;font-size:12px;font-weight:800;color:#1f4d8f;text-align:left;white-space:nowrap;">${esc(header)}</th>`).join("")}
					</tr>
				</thead>
				<tbody>
					${rows.length ? rows.join("") : `<tr><td colspan="${headers.length}" style="padding:14px;color:#7b8794;">No records found.</td></tr>`}
				</tbody>
			</table>
		</div>
	`;

	const linkBtn = (label, doctype, name, tone = "#0f172a") => {
		if (!name) return "";
		return `<button class="btn btn-xs ss-coil-dash-link" data-doctype="${esc(doctype)}" data-name="${esc(name)}" style="margin-right:8px;background:${tone};border:none;color:#fff;border-radius:8px;padding:6px 10px;font-size:12px;font-weight:700;">${esc(label)}</button>`;
	};

	const processColor = (value) => {
		const key = String(value || "").toLowerCase();
		if (key.includes("slitter")) return { bg: "#dbeafe", text: "#1d4ed8", border: "#93c5fd" };
		if (key.includes("leveler")) return { bg: "#dcfce7", text: "#15803d", border: "#86efac" };
		if (key.includes("reshearing")) return { bg: "#fef3c7", text: "#b45309", border: "#fcd34d" };
		return { bg: "#e5e7eb", text: "#374151", border: "#cbd5e1" };
	};

	const statusColor = (value) => {
		const key = String(value || "").toLowerCase();
		if (key.includes("completed") && !key.includes("partial")) return { bg: "#dcfce7", text: "#166534", border: "#86efac" };
		if (key.includes("partial")) return { bg: "#fef3c7", text: "#b45309", border: "#fcd34d" };
		if (key.includes("process")) return { bg: "#dbeafe", text: "#1d4ed8", border: "#93c5fd" };
		if (key.includes("closed")) return { bg: "#ede9fe", text: "#6d28d9", border: "#c4b5fd" };
		return { bg: "#f3f4f6", text: "#374151", border: "#d1d5db" };
	};

	const processOverview = `
		<div style="display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;">
			${statCard("Current Process", status.current_process || "-", "#124e78")}
			${statCard("Order Status", data.order_status || "-", "#8b5cf6")}
			${statCard("Next Process", status.next_process || "-", "#1d8348")}
			${statCard("Elapsed Time", status.elapsed_time || "-", "#b45309")}
		</div>
		<div style="display:grid;grid-template-columns:1.2fr 1fr;gap:14px;margin-top:16px;">
			<div style="background:#f8fbff;border:1px solid #dbe7f3;border-radius:14px;padding:14px;">
				<div style="font-size:16px;font-weight:800;color:#102a43;">Core Links</div>
				<div style="margin-top:12px;">
					${linkBtn("Sales Order", "Sales Order", data.order_no, "#2563eb")}
					${linkBtn("Sales Order Item", "Sales Order Item", data.sales_order_item, "#3b82f6")}
					${linkBtn("Stock Entry", "Stock Entry", data.stock_entry, "#0f766e")}
					${linkBtn("View Tags", "List", "", "#374151")}
				</div>
				<div style="font-size:12px;color:#486581;margin-top:12px;">Customer: <b>${esc(data.customer_name || "-")}</b> | Machine: <b>${esc(data.machine || "-")}</b></div>
			</div>
			<div style="background:#fff7ed;border:1px solid #fed7aa;border-radius:14px;padding:14px;">
				<div style="font-size:16px;font-weight:800;color:#9a3412;">Process Timing</div>
				<div style="font-size:12px;color:#7c2d12;margin-top:10px;">Started On: <b>${esc(status.started_on || "-")}</b></div>
				<div style="font-size:12px;color:#7c2d12;margin-top:8px;">Completed On: <b>${esc(status.completed_on || "-")}</b></div>
				<div style="font-size:12px;color:#7c2d12;margin-top:8px;">Remarks: <b>${esc(data.remarks || "-")}</b></div>
			</div>
		</div>
	`;

	const planningSection = `
		<div style="display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;">
			${statCard("Input Coils", summary.input_count || 0, "#0f766e")}
			${statCard("Output Coils", summary.output_count || 0, "#1d4ed8")}
			${statCard("Cutting Rows", summary.cutting_count || 0, "#7c3aed")}
			${statCard("Total Strips", summary.total_strips || 0, "#ea580c")}
		</div>
		<div style="display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin-top:12px;">
			${statCard("Grand Width", fmt(summary.grand_total_width), "#1f4d8f")}
			${statCard("Grand Est WT", fmt(summary.grand_estimated_wt), "#7c2d12")}
			${statCard("Actual Ratio", fmt(summary.actual_ratio), "#047857")}
			${statCard("Remaining Width", fmt(summary.remaining_width), "#be123c")}
		</div>
		<div style="margin-top:16px;background:#f8fbff;border:1px solid #dbe7f3;border-radius:14px;padding:14px;">
			<div style="font-size:16px;font-weight:800;color:#102a43;">SO Item Detail</div>
			<div style="display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;margin-top:12px;font-size:12px;color:#334e68;">
				<div><b>Item</b><br>${esc(so.item_name || "-")}</div>
				<div><b>Tag No</b><br>${esc(so.tag_no || "-")}</div>
				<div><b>Dimension</b><br>${esc(so.dimension || "-")}</div>
				<div><b>Packing</b><br>${esc(so.custom_packing_type || so.packing || "-")}</div>
				<div><b>Thickness</b><br>${esc(so.thickness || "-")}</div>
				<div><b>Width</b><br>${esc(so.width || "-")}</div>
				<div><b>Qty</b><br>${esc(so.qty || "-")}</div>
				<div><b>Estimated WT</b><br>${esc(so.estimated_wt || "-")}</div>
			</div>
			<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:14px;">
				<div style="background:#fff;border:1px solid #dbe7f3;border-radius:12px;padding:12px;">
					<div style="font-size:13px;font-weight:800;color:#102a43;">Sales Order Process Plan</div>
					<div style="margin-top:8px;">${soProcessList.length ? soProcessList.map((p) => `<span style="display:inline-block;background:#eef6ff;color:#1d4f91;border:1px solid #bfdbfe;border-radius:999px;padding:6px 10px;margin:0 8px 8px 0;font-size:12px;font-weight:700;">${esc(p)}</span>`).join("") : `<span style="color:#7b8794;font-size:12px;">No process selected</span>`}</div>
					<div style="font-size:12px;color:#486581;margin-top:8px;">Status on SO Item: <b>${esc(data.order_status || so.custom_status || "-")}</b></div>
				</div>
				<div style="background:#fff;border:1px solid #dbe7f3;border-radius:12px;padding:12px;">
					<div style="font-size:13px;font-weight:800;color:#102a43;">Cutting Scheme Summary</div>
					<div style="font-size:12px;color:#486581;margin-top:8px;">Rows: <b>${esc(cuttingRows.length || 0)}</b> | Strips: <b>${esc(summary.total_strips || 0)}</b></div>
					<div style="font-size:12px;color:#486581;margin-top:6px;">Width Total: <b>${fmt(summary.grand_total_width)}</b> | Remaining: <b>${fmt(summary.remaining_width)}</b></div>
				</div>
			</div>
		</div>
	`;

	const inputRows = (data.input_rows || []).map((row) => `
		<tr>
			<td style="padding:10px 12px;border-bottom:1px solid #eef2f6;">${esc(row.tag_no || "-")}</td>
			<td style="padding:10px 12px;border-bottom:1px solid #eef2f6;">${esc(row.class || "-")}</td>
			<td style="padding:10px 12px;border-bottom:1px solid #eef2f6;">${esc(row.dimension || "-")}</td>
			<td style="padding:10px 12px;border-bottom:1px solid #eef2f6;">${esc(row.next_process || "-")}</td>
			<td style="padding:10px 12px;border-bottom:1px solid #eef2f6;">${esc(row.previous_job_order || "-")}</td>
		</tr>
	`);
	const outputRows = (data.output_rows || []).map((row) => `
		<tr>
			<td style="padding:10px 12px;border-bottom:1px solid #eef2f6;">${esc(row.tag_no || "-")}</td>
			<td style="padding:10px 12px;border-bottom:1px solid #eef2f6;">${esc(row.class || "-")}</td>
			<td style="padding:10px 12px;border-bottom:1px solid #eef2f6;">${esc(row.width || "-")}</td>
			<td style="padding:10px 12px;border-bottom:1px solid #eef2f6;">${esc(row.current_process || "-")}</td>
			<td style="padding:10px 12px;border-bottom:1px solid #eef2f6;">${esc(row.next_process || "-")}</td>
			<td style="padding:10px 12px;border-bottom:1px solid #eef2f6;">${esc(row.packing || "-")}</td>
		</tr>
	`);

	const movementRows = (data.previous_docs || []).map((row) => `
		<tr>
			<td style="padding:10px 12px;border-bottom:1px solid #eef2f6;">${esc(row.tag_no || "-")}</td>
			<td style="padding:10px 12px;border-bottom:1px solid #eef2f6;">${linkBtn(row.name, "SS Coil", row.name, "#1d4ed8")}</td>
			<td style="padding:10px 12px;border-bottom:1px solid #eef2f6;">${esc(row.operation || "-")}</td>
			<td style="padding:10px 12px;border-bottom:1px solid #eef2f6;">${esc(row.order_status || "-")}</td>
		</tr>
	`);

	const nextRows = (data.next_docs || []).map((row) => `
		<tr>
			<td style="padding:10px 12px;border-bottom:1px solid #eef2f6;">${esc(row.tag_no || "-")}</td>
			<td style="padding:10px 12px;border-bottom:1px solid #eef2f6;">${linkBtn(row.name, "SS Coil", row.name, "#0f766e")}</td>
			<td style="padding:10px 12px;border-bottom:1px solid #eef2f6;">${esc(row.operation || "-")}</td>
			<td style="padding:10px 12px;border-bottom:1px solid #eef2f6;">${esc(row.order_status || "-")}</td>
		</tr>
	`);

	const stockRows = (data.stock_entry_details || []).map((row) => `
		<tr>
			<td style="padding:10px 12px;border-bottom:1px solid #eef2f6;">${esc(row.tag_no || "-")}</td>
			<td style="padding:10px 12px;border-bottom:1px solid #eef2f6;">${esc(row.stock_entry || "-")}</td>
			<td style="padding:10px 12px;border-bottom:1px solid #eef2f6;">${esc(row.item_name || row.item_code || "-")}</td>
			<td style="padding:10px 12px;border-bottom:1px solid #eef2f6;">${esc(row.purpose || "-")}</td>
			<td style="padding:10px 12px;border-bottom:1px solid #eef2f6;">${esc(row.posting_date || "-")}</td>
		</tr>
	`);

	const dispatchRows = (data.delivery_details || []).map((row) => `
		<tr>
			<td style="padding:10px 12px;border-bottom:1px solid #eef2f6;">${esc(row.tag_no || "-")}</td>
			<td style="padding:10px 12px;border-bottom:1px solid #eef2f6;">${esc(row.delivery_note || "-")}</td>
			<td style="padding:10px 12px;border-bottom:1px solid #eef2f6;">${esc(row.posting_date || "-")}</td>
			<td style="padding:10px 12px;border-bottom:1px solid #eef2f6;">${esc(row.status || "-")}</td>
		</tr>
	`);

	const invoiceRows = (data.invoice_details || []).map((row) => `
		<tr>
			<td style="padding:10px 12px;border-bottom:1px solid #eef2f6;">${esc(row.tag_no || "-")}</td>
			<td style="padding:10px 12px;border-bottom:1px solid #eef2f6;">${esc(row.sales_invoice || "-")}</td>
			<td style="padding:10px 12px;border-bottom:1px solid #eef2f6;">${esc(row.posting_date || "-")}</td>
			<td style="padding:10px 12px;border-bottom:1px solid #eef2f6;">${esc(row.status || "-")}</td>
			<td style="padding:10px 12px;border-bottom:1px solid #eef2f6;">${fmt(row.outstanding_amount || 0)}</td>
		</tr>
	`);

	const tagRows = (data.tag_registry_rows || []).map((row) => `
		<tr>
			<td style="padding:10px 12px;border-bottom:1px solid #eef2f6;">${esc(row.tag_no || "-")}</td>
			<td style="padding:10px 12px;border-bottom:1px solid #eef2f6;">${esc(row.parent_tag_no || "-")}</td>
			<td style="padding:10px 12px;border-bottom:1px solid #eef2f6;">${esc(row.root_tag_no || "-")}</td>
			<td style="padding:10px 12px;border-bottom:1px solid #eef2f6;">${esc(row.status || "-")}</td>
			<td style="padding:10px 12px;border-bottom:1px solid #eef2f6;">${esc(row.current_doctype || "-")} ${esc(row.current_docname || "")}</td>
		</tr>
	`);

	const buildHierarchyNode = (node) => {
		if (!node || !node.tag_no) return "";
		const prevDocs = node.previous_docs || [];
		const nextDocs = node.next_docs || [];
		const prev = prevDocs.map((doc) => `${doc.operation || "-"} / ${doc.name || "-"}`).join(", ");
		const next = nextDocs.map((doc) => `${doc.operation || "-"} / ${doc.name || "-"}`).join(", ");
		const isCurrentNode = node.current_docname === data.name || currentTagSet.has(node.tag_no);
		const childHtmlParts = (node.children || []).map((child) => buildHierarchyNode(child));
		const children = childHtmlParts.map((part) => part.html).join("");
		const childContainsCurrent = childHtmlParts.some((part) => part.containsCurrent);
		const containsCurrent = isCurrentNode || childContainsCurrent;
		const badgeColor = node.child_count ? "#2563eb" : "#0f766e";
		const primaryFlow = (node.previous_docs && node.previous_docs[0] && node.previous_docs[0].operation) || (node.next_docs && node.next_docs[0] && node.next_docs[0].operation) || "";
		const pTone = processColor(primaryFlow);
		const sTone = statusColor(node.status);
		const hasChildren = (node.children || []).length > 0;
		const lineDotColor = sTone.text;
		const nodeBorder = containsCurrent ? "#2563eb" : "#dbe7f3";
		const nodeShadow = containsCurrent ? "0 0 0 3px rgba(37,99,235,.16), 0 10px 22px rgba(15,23,42,.08)" : "0 8px 18px rgba(15,23,42,.05)";
		const prevTitle = prevDocs.map((doc) => `${doc.operation || "-"} | ${doc.name || "-"} | ${doc.order_status || "-"}`).join("\n");
		const nextTitle = nextDocs.map((doc) => `${doc.operation || "-"} | ${doc.name || "-"} | ${doc.order_status || "-"}`).join("\n");
		return {
			containsCurrent,
			html: `
			<li style="list-style:none;position:relative;padding-left:28px;margin:12px 0;">
				<div style="position:absolute;left:10px;top:-4px;bottom:-12px;width:2px;background:linear-gradient(180deg,#cbd5e1,#e2e8f0);"></div>
				<div style="position:absolute;left:10px;top:15px;width:16px;height:18px;border-left:2px solid #cbd5e1;border-bottom:2px solid #cbd5e1;border-bottom-left-radius:12px;"></div>
				<div style="position:absolute;left:24px;top:23px;width:9px;height:9px;border-radius:999px;background:${lineDotColor};box-shadow:0 0 0 3px rgba(255,255,255,.96), 0 0 0 5px ${containsCurrent ? "rgba(37,99,235,.16)" : "rgba(148,163,184,.12)"};"></div>
				<div class="ss-coil-tree-node" data-tag-no="${esc(node.tag_no)}" style="background:${containsCurrent ? "#f8fbff" : "#fff"};border:1px solid ${nodeBorder};border-radius:15px;padding:10px 12px;box-shadow:${nodeShadow};min-width:680px;max-width:860px;cursor:pointer;">
					<div style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;">
						<div>
							<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
								<div style="font-size:17px;font-weight:900;color:#102a43;">${esc(node.tag_no)}</div>
								${containsCurrent ? `<span style="background:#1d4ed8;color:#fff;border-radius:999px;padding:4px 8px;font-size:11px;font-weight:800;">Current Path</span>` : ""}
								<span style="background:${pTone.bg};color:${pTone.text};border:1px solid ${pTone.border};border-radius:999px;padding:4px 8px;font-size:11px;font-weight:800;">${esc(primaryFlow || "-")}</span>
								<span style="background:${sTone.bg};color:${sTone.text};border:1px solid ${sTone.border};border-radius:999px;padding:4px 8px;font-size:11px;font-weight:800;">${esc(node.status || "-")}</span>
							</div>
							<div style="font-size:11px;color:#486581;margin-top:5px;line-height:1.6;">
								Source: <b>${esc(node.source_doctype || "-")} ${esc(node.source_docname || "")}</b> |
								Current: <b>${esc(node.current_doctype || "-")} ${esc(node.current_docname || "")}</b>
							</div>
						</div>
						<div style="display:flex;gap:8px;flex-wrap:wrap;">
							${hasChildren ? `<button class="ss-coil-tree-toggle" data-tag-no="${esc(node.tag_no)}" data-default-open="${containsCurrent ? 1 : 0}" style="background:#0f172a;color:#fff;border:none;border-radius:999px;padding:5px 9px;font-size:10px;font-weight:800;">${containsCurrent ? "Collapse" : "Expand"}</button>` : ""}
							<span style="background:${badgeColor};color:#fff;border-radius:999px;padding:5px 9px;font-size:10px;font-weight:800;">Children ${esc(node.child_count || 0)}</span>
							<span style="background:#7c3aed;color:#fff;border-radius:999px;padding:5px 9px;font-size:10px;font-weight:800;">Desc ${esc(node.descendant_count || 0)}</span>
						</div>
					</div>
					<div style="display:grid;grid-template-columns:repeat(5,minmax(110px,1fr));gap:8px;margin-top:12px;font-size:11px;color:#334e68;">
						<div style="background:#f8fbff;border:1px solid #e2e8f0;border-radius:12px;padding:8px 10px;"><b>Parent</b><br>${esc(node.parent_tag_no || "-")}</div>
						<div style="background:#f8fbff;border:1px solid #e2e8f0;border-radius:12px;padding:8px 10px;"><b>Root</b><br>${esc(node.root_tag_no || "-")}</div>
						<div style="background:#f8fbff;border:1px solid #e2e8f0;border-radius:12px;padding:8px 10px;"><b>Item</b><br>${esc(node.item_name || node.item_code || "-")}</div>
						<div title="${esc(prevTitle || prev || "-")}" style="background:#fff7ed;border:1px solid #fed7aa;border-radius:12px;padding:8px 10px;"><b>Previous Flow</b><br>${esc(prev || "-")}</div>
						<div title="${esc(nextTitle || next || "-")}" style="background:#ecfeff;border:1px solid #a5f3fc;border-radius:12px;padding:8px 10px;"><b>Next Flow</b><br>${esc(next || "-")}</div>
					</div>
				</div>
				${children ? `<ul class="ss-coil-tree-children" data-parent-tag="${esc(node.tag_no)}" style="margin:10px 0 0 0;padding:0;display:${containsCurrent ? "block" : "none"};">${children}</ul>` : ""}
			</li>
		`};
	};

	const buildHierarchyDiagram = (node) => {
		if (!node || !node.tag_no) {
			return `<div style="color:#7b8794;font-size:13px;">No hierarchy available.</div>`;
		}
		const renderLevel = (current) => {
			const kids = current.children || [];
			const currentStatusTone = statusColor(current.status);
			const currentFlow = (current.previous_docs && current.previous_docs[0] && current.previous_docs[0].operation) || (current.next_docs && current.next_docs[0] && current.next_docs[0].operation) || "";
			const currentProcessTone = processColor(currentFlow);
			return `
				<div style="display:flex;flex-direction:column;align-items:center;gap:10px;">
					<div style="background:#0f172a;color:#fff;border-radius:14px;padding:12px 16px;min-width:220px;text-align:center;box-shadow:0 8px 20px rgba(15,23,42,.16);border:2px solid ${currentStatusTone.border};">
						<div style="font-size:16px;font-weight:900;">${esc(current.tag_no)}</div>
						<div style="display:flex;justify-content:center;gap:6px;flex-wrap:wrap;margin-top:6px;">
							<span style="background:${currentProcessTone.bg};color:${currentProcessTone.text};border:1px solid ${currentProcessTone.border};border-radius:999px;padding:3px 7px;font-size:10px;font-weight:800;">${esc(currentFlow || "-")}</span>
							<span style="background:${currentStatusTone.bg};color:${currentStatusTone.text};border:1px solid ${currentStatusTone.border};border-radius:999px;padding:3px 7px;font-size:10px;font-weight:800;">${esc(current.status || "-")}</span>
						</div>
						<div style="font-size:11px;opacity:.9;margin-top:6px;">${esc(current.current_doctype || current.source_doctype || "-")}</div>
					</div>
					${kids.length ? `<div style="display:flex;flex-direction:column;align-items:center;gap:2px;"><div style="width:2px;height:18px;background:#94a3b8;"></div><div style="width:10px;height:10px;border-radius:999px;background:${currentStatusTone.text};box-shadow:0 0 0 3px rgba(255,255,255,.95), 0 0 0 5px rgba(148,163,184,.16);"></div><div style="width:2px;height:18px;background:#94a3b8;"></div></div>` : ""}
					${kids.length ? `<div style="display:flex;gap:14px;align-items:flex-start;justify-content:center;flex-wrap:wrap;">${kids.map((child) => renderLevel(child)).join("")}</div>` : ""}
				</div>
			`;
		};
		return `<div style="overflow:auto;padding:10px 0;">${renderLevel(node)}</div>`;
	};

	return `
		<div style="font-family:system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f5f9ff;padding:14px;border-radius:20px;">
			<div style="background:linear-gradient(135deg,#1d4ed8,#0ea5e9);padding:22px;border-radius:20px;color:#fff;box-shadow:0 14px 30px rgba(29,78,216,.28);">
				<div style="font-size:28px;font-weight:900;">SS Coil Control Dashboard</div>
				<div style="font-size:20px;font-weight:800;margin-top:8px;">Root / Input Tag: ${esc(inputTitleTag)}</div>
				<div style="font-size:13px;opacity:.92;margin-top:6px;">${esc(data.name || "-")} | Sales Order: ${esc(data.order_no || "-")} | Operation: ${esc(data.operation || "-")}</div>
				<div style="display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin-top:18px;">
					${statCard("Input Tags", data.input_tags?.length || 0, "#1e3a8a")}
					${statCard("Output Tags", data.output_tags?.length || 0, "#0f766e")}
					${statCard("Next Entries", data.next_docs?.length || 0, "#7c3aed")}
					${statCard("Order Status", data.order_status || "-", "#b45309")}
				</div>
			</div>
			${section("Process Overview", "Live stage, timing and primary links", "linear-gradient(90deg,#0f172a,#334155)", processOverview)}
			${section("Planning Summary", "SO item, cutting summary and ratio metrics", "linear-gradient(90deg,#0f766e,#14b8a6)", planningSection)}
			${section("Tag Flow", "Parent tags, output tags and registry tracking", "linear-gradient(90deg,#7c3aed,#a855f7)", `
				<div style="margin-bottom:14px;"><div style="font-size:13px;font-weight:800;color:#102a43;margin-bottom:8px;">Input Tags</div>${chips(data.input_tags)}</div>
				<div style="margin-bottom:14px;"><div style="font-size:13px;font-weight:800;color:#102a43;margin-bottom:8px;">Output Tags</div>${chips(data.output_tags, "#ecfeff")}</div>
				${table(["Tag No","Parent","Root","Status","Current Document"], tagRows)}
			`)}
			${section("Tag Hierarchy", "Recursive parent, child and sub-child process chain", "linear-gradient(90deg,#be185d,#ec4899)", `
				<div style="background:#f8fbff;border:1px solid #dbe7f3;border-radius:16px;padding:16px;">
					<div style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;">
						<div>
							<div style="font-size:16px;font-weight:800;color:#102a43;">Hierarchy Diagram</div>
							<div style="font-size:12px;color:#486581;margin-top:4px;">This shows the full chain from root tag to children, sub-children and later process outputs.</div>
						</div>
						<div style="display:flex;gap:8px;flex-wrap:wrap;">
							<button class="btn btn-xs ss-coil-print-hierarchy" style="background:#0f172a;color:#fff;border:none;border-radius:10px;padding:7px 10px;font-size:12px;font-weight:800;">Print Hierarchy</button>
							<button class="btn btn-xs ss-coil-export-hierarchy" style="background:#2563eb;color:#fff;border:none;border-radius:10px;padding:7px 10px;font-size:12px;font-weight:800;">Export HTML</button>
						</div>
					</div>
					<div class="ss-coil-hierarchy-diagram" style="margin-top:14px;">${buildHierarchyDiagram(data.tag_hierarchy)}</div>
				</div>
				<div style="margin-top:16px;background:#fff;border:1px solid #dbe7f3;border-radius:16px;padding:16px;">
					<div style="font-size:16px;font-weight:800;color:#102a43;">Hierarchy Detail Tree</div>
					<div style="font-size:12px;color:#486581;margin-top:4px;">Every node shows parent/root tracking, current document, previous flow and next flow.</div>
					<div style="margin-top:16px;overflow:auto;padding-bottom:8px;">
						<ul style="margin:0;padding:0;min-width:980px;">${(buildHierarchyNode(data.tag_hierarchy) || {}).html || ""}</ul>
					</div>
				</div>
			`)}
			${section("Input and Output", "Current input coils and produced output coils", "linear-gradient(90deg,#1d4ed8,#3b82f6)", `
				<div style="font-size:15px;font-weight:800;color:#102a43;margin-bottom:10px;">Input Coil</div>
				${table(["Tag No","Class","Dimension","Next Process","Previous Job"], inputRows)}
				<div style="font-size:15px;font-weight:800;color:#102a43;margin:18px 0 10px;">SS Coil Cutting Detail</div>
				${table(
					["Seq","Width","Strip","Total Width","Length Cut","Tol +","Tol -"],
					cuttingRows.map((row) => `
						<tr>
							<td style="padding:10px 12px;border-bottom:1px solid #eef2f6;">${esc(row.seq || "-")}</td>
							<td style="padding:10px 12px;border-bottom:1px solid #eef2f6;">${esc(row.width || "-")}</td>
							<td style="padding:10px 12px;border-bottom:1px solid #eef2f6;">${esc(row.strip || "-")}</td>
							<td style="padding:10px 12px;border-bottom:1px solid #eef2f6;">${esc(row.total_width || "-")}</td>
							<td style="padding:10px 12px;border-bottom:1px solid #eef2f6;">${esc(row.lengthcut || "-")}</td>
							<td style="padding:10px 12px;border-bottom:1px solid #eef2f6;">${esc(row.tolerance_plus || "-")}</td>
							<td style="padding:10px 12px;border-bottom:1px solid #eef2f6;">${esc(row.tolerance_minus || "-")}</td>
						</tr>
					`),
				)}
				<div style="font-size:15px;font-weight:800;color:#102a43;margin:18px 0 10px;">Job Output</div>
				${table(["Tag No","Class","Width","Current","Next","Packing"], outputRows)}
			`)}
			${section("Process Chain", "Previous and next SS Coil documents linked by tags", "linear-gradient(90deg,#f97316,#ea580c)", `
				<div style="font-size:15px;font-weight:800;color:#102a43;margin-bottom:10px;">Previous Process</div>
				${table(["Tag No","Document","Operation","Status"], movementRows)}
				<div style="font-size:15px;font-weight:800;color:#102a43;margin:18px 0 10px;">Next Process Entries</div>
				${table(["Tag No","Document","Operation","Status"], nextRows)}
			`)}
			${section("Linked Documents", "Stock, dispatch and invoicing details for related tags", "linear-gradient(90deg,#0f766e,#22c55e)", `
				<div style="font-size:15px;font-weight:800;color:#102a43;margin-bottom:10px;">Stock Entry Detail</div>
				${table(["Tag No","Stock Entry","Item","Purpose","Posting Date"], stockRows)}
				<div style="font-size:15px;font-weight:800;color:#102a43;margin:18px 0 10px;">Delivery Note</div>
				${table(["Tag No","Delivery Note","Posting Date","Status"], dispatchRows)}
				<div style="font-size:15px;font-weight:800;color:#102a43;margin:18px 0 10px;">Sales Invoice</div>
				${table(["Tag No","Sales Invoice","Posting Date","Status","Outstanding"], invoiceRows)}
			`)}
		</div>
	`;
}

function bindSSCoilDashboardActions(frm, $wrapper, data) {
	$wrapper.find(".ss-coil-dash-link").on("click", function () {
		const doctype = $(this).data("doctype");
		const name = $(this).data("name");
		if (!doctype) return;
		if (doctype === "List") {
			frappe.set_route("List", "Tag Registry", { root_tag_no: (data.input_tags || [])[0] || "" });
			return;
		}
		if (!name) return;
		frappe.set_route("Form", doctype, name);
	});

	$wrapper.find(".ss-coil-tree-node").on("click", function (e) {
		if ($(e.target).closest(".ss-coil-tree-toggle").length) return;
		const tagNo = $(this).data("tag-no");
		if (!tagNo) return;
		frappe.set_route("Form", "Tag Registry", tagNo);
	});

	$wrapper.find(".ss-coil-tree-toggle").on("click", function (e) {
		e.preventDefault();
		e.stopPropagation();
		const tagNo = $(this).data("tag-no");
		if (!tagNo) return;
		const $children = $wrapper.find(`.ss-coil-tree-children[data-parent-tag="${tagNo}"]`);
		if (!$children.length) return;
		const isHidden = $children.is(":hidden");
		$children.toggle(!isHidden);
		$(this).text(isHidden ? "Collapse" : "Expand");
	});

	const openHierarchyWindow = (shouldPrint) => {
		const content = $wrapper.find(".ss-coil-hierarchy-diagram").html();
		if (!content) return;
		const win = window.open("", "_blank");
		if (!win) {
			frappe.msgprint(__("Please allow popups to print or export the hierarchy."));
			return;
		}
		const html = `
			<html>
				<head>
					<title>SS Coil Hierarchy - ${frappe.utils.escape_html(frm.doc.name || "")}</title>
					<style>
						body { font-family: Arial, sans-serif; margin: 20px; background: #fff; color: #102a43; }
						.header { margin-bottom: 18px; }
						.title { font-size: 24px; font-weight: 800; }
						.subtitle { font-size: 13px; color: #486581; margin-top: 6px; }
						@media print {
							body { margin: 10mm; }
						}
					</style>
				</head>
				<body>
					<div class="header">
						<div class="title">SS Coil Hierarchy Diagram</div>
						<div class="subtitle">${frappe.utils.escape_html(frm.doc.name || "")} | Root / Input Tag: ${frappe.utils.escape_html(((data.input_tags || [])[0] || data.root_tag_no || ""))}</div>
					</div>
					<div>${content}</div>
				</body>
			</html>
		`;
		win.document.open();
		win.document.write(html);
		win.document.close();
		if (shouldPrint) {
			win.focus();
			setTimeout(() => win.print(), 400);
		}
	};

	$wrapper.find(".ss-coil-print-hierarchy").on("click", function (e) {
		e.preventDefault();
		openHierarchyWindow(true);
	});

	$wrapper.find(".ss-coil-export-hierarchy").on("click", function (e) {
		e.preventDefault();
		openHierarchyWindow(false);
	});
}

function add_ss_coil_tag_buttons(frm) {
	if (!frm.doc.name || (frm.is_new && frm.is_new())) return;

	const inputTags = [...new Set((frm.doc.input_coil || []).map((row) => row.tag_no).filter(Boolean))];
	const outputTags = [...new Set((frm.doc.job_output || []).map((row) => row.tag_no).filter(Boolean))];
	const allTags = [...new Set([...inputTags, ...outputTags])];

	frm.add_custom_button(__("Tag Registry"), function () {
		if (frm.doc.order_no) {
			frappe.set_route("List", "Tag Registry", { sales_order: frm.doc.order_no });
			return;
		}
		if (inputTags.length === 1) {
			frappe.set_route("List", "Tag Registry", { root_tag_no: inputTags[0] });
			return;
		}
		frappe.set_route("List", "Tag Registry");
	}, __("Tags"));

	if (inputTags.length === 1) {
		frm.add_custom_button(__("Open Parent Tag"), function () {
			frappe.set_route("Form", "Tag Registry", inputTags[0]);
		}, __("Tags"));
	}

	if (outputTags.length === 1) {
		frm.add_custom_button(__("Open Output Tag"), function () {
			frappe.set_route("Form", "Tag Registry", outputTags[0]);
		}, __("Tags"));
	} else if (outputTags.length > 1 || allTags.length > 1) {
		frm.add_custom_button(__("Open Related Tags"), function () {
			if (inputTags.length === 1) {
				frappe.set_route("List", "Tag Registry", { root_tag_no: inputTags[0] });
				return;
			}
			if (frm.doc.order_no) {
				frappe.set_route("List", "Tag Registry", { sales_order: frm.doc.order_no });
				return;
			}
			frappe.set_route("List", "Tag Registry");
		}, __("Tags"));
	}

	if (outputTags.length) {
		const openOutputTags = function (shouldPrint) {
			const base = `/api/method/ss_coil.api.render_ss_coil_output_tags_page?ss_coil_name=${encodeURIComponent(frm.doc.name)}&print_view=${shouldPrint ? 1 : 0}`;
			const win = window.open(base, "_blank");
			if (!win) {
				frappe.msgprint(__("Please allow popups to view or print output tags."));
				return;
			}
		};

		frm.add_custom_button(__("View Output Tags"), function () {
			openOutputTags(false);
		}, __("Tags"));

		frm.add_custom_button(__("Print Output Tags"), function () {
			openOutputTags(true);
		}, __("Tags"));
	}
}

function add_process_action_buttons(frm) {
	if (!frm.doc.name || (frm.is_new && frm.is_new())) return;

	const hasStatusFields =
		Boolean(frm.fields_dict.order_status) &&
		Boolean(frm.fields_dict.started_on) &&
		Boolean(frm.fields_dict.completed_on) &&
		Boolean(frm.fields_dict.elapsed_time);

	if (!hasStatusFields) {
		return;
	}

	const startAction = function () {
		const now = frappe.datetime.now_datetime();
		if (!frm.doc.started_on) {
			frm.set_value("started_on", now);
		}
		frm.set_value("elapsed_time", getElapsedTimeValue(frm, now));
		frm.set_value("order_status", "In Process");
		frm.save();
	};

	const inProcessAction = function () {
		const now = frappe.datetime.now_datetime();
		if (!frm.doc.started_on) {
			frm.set_value("started_on", now);
		}
		frm.set_value("elapsed_time", getElapsedTimeValue(frm, now));
		frm.set_value("order_status", "In Process");
		frm.save();
	};

	const partialAction = function () {
		const now = frappe.datetime.now_datetime();
		if (!frm.doc.started_on) {
			frm.set_value("started_on", now);
		}
		frm.set_value("elapsed_time", getElapsedTimeValue(frm, now));
		frm.set_value("order_status", "Partially Completed");
		frm.save();
	};

	const completeAction = function () {
		const now = frappe.datetime.now_datetime();
		if (!frm.doc.started_on) {
			frm.set_value("started_on", now);
		}
		frm.set_value("completed_on", now);
		frm.set_value("elapsed_time", getElapsedTimeValue(frm, now));
		frm.set_value("order_status", "Completed");
		frm.save().then(() => {
			createNextProcessEntries(frm, true);
		});
	};

	frm.add_custom_button(__("Start"), startAction, __("Process"));
	frm.add_custom_button(__("Partial"), partialAction, __("Process"));
	frm.add_custom_button(__("Complete"), completeAction, __("Process"));

	frm.add_custom_button(__("Close"), function () {
		frm.set_value("order_status", "Closed");
		frm.save();
	}, __("Process"));

	const nextProcess = getNextProcessLabelFromOutputs(frm);
	if (nextProcess) {
		frm.add_custom_button(__("Create Next Process Entries"), function () {
			frm.save().then(() => {
				createNextProcessEntries(frm, false);
			});
		}, __("Process"));
	}
}

function createNextProcessEntries(frm, silentIfSkipped) {
	frappe.call({
		method: "ss_coil.api.create_next_ss_coil_entry",
		args: { source_name: frm.doc.name },
		freeze: true,
		freeze_message: __("Creating next process entries..."),
		callback: function (r) {
			const message = r.message || {};
			const created = message.created_docs || [];
			const skipped = message.skipped_docs || [];

			if (created.length) {
				frappe.show_alert({
					message: __("{0} next process entries created", [created.length]),
					indicator: "green",
				});
				if (created.length === 1) {
					frappe.set_route("Form", "SS Coil", created[0].name);
				} else {
					frappe.set_route("List", "SS Coil", { operation: created[0].operation, order_no: frm.doc.order_no });
				}
				return;
			}

			if (skipped.length && !silentIfSkipped) {
				frappe.msgprint(__("Next process entries already exist for all output tags."));
			}
		},
	});
}

frappe.ui.form.on("Cutting Scheme", {
	width(frm, cdt, cdn) {
		update_cutting_total_width(cdt, cdn);
		rebuild_job_output_from_input(frm);
	},
	strip(frm, cdt, cdn) {
		update_cutting_total_width(cdt, cdn);
		rebuild_job_output_from_input(frm);
	},
	total_width(frm) {
		update_grand_totals(frm);
	},
});

frappe.ui.form.on("Coil Output", {
	estimated_wt(frm) {
		update_grand_totals(frm);
	},
	tag_no(frm) {
		sync_process_preview(frm);
	},
	class(frm) {
		sync_process_preview(frm);
	},
	job_output_form_render(frm) {
		sync_process_preview(frm);
		render_job_output_qr_fields(frm);
	},
});

frappe.ui.form.on("Coil SO", {
	qty(frm) {
		update_input_coil_length(frm);
	},
	thickness(frm) {
		update_input_coil_length(frm);
	},
	width(frm) {
		update_remaining_width(frm);
		update_input_coil_length(frm);
	},
});

frappe.ui.form.on("Coil Input", {
	input_coil_form_render(frm) {
		rebuild_job_output_from_input(frm);
	},
	tag_no(frm) {
		rebuild_job_output_from_input(frm);
	},
	class(frm) {
		rebuild_job_output_from_input(frm);
	},
	estimated_qty(frm) {
		rebuild_job_output_from_input(frm);
	},
	estimated_wt(frm) {
		rebuild_job_output_from_input(frm);
	},
	length(frm) {
		rebuild_job_output_from_input(frm);
	},
});

function update_grand_totals(frm) {
	const total_width_sum = (frm.doc.cutting_detail || []).reduce(
		(sum, row) => sum + flt(row.total_width),
		0,
	);
	const estimated_wt_sum = (frm.doc.job_output || []).reduce(
		(sum, row) => sum + flt(row.estimated_wt),
		0,
	);

	frm.set_value("grand_total_width", total_width_sum);
	frm.set_value("grand_estimated_wt", estimated_wt_sum);
	update_remaining_width(frm);
}

function update_cutting_total_width(cdt, cdn) {
	const row = locals[cdt] && locals[cdt][cdn];
	if (!row) return;

	frappe.model.set_value(cdt, cdn, "total_width", flt(row.width) * flt(row.strip));
}

function update_calc_ratio(frm) {
	const estimated = flt(frm.doc.estimated_wt);
	const grand = flt(frm.doc.grand_estimated_wt);

	if (!estimated) {
		frm.set_value("calc_ratio", 0);
		return;
	}

	frm.set_value("calc_ratio", (grand / estimated) * 100);
}

function update_remaining_width(frm) {
	const so_width = flt((frm.doc.so_item || [])[0]?.width);
	const grand_total_width = flt(frm.doc.grand_total_width);
	frm.set_value("remaining_width", so_width - grand_total_width);
}

function update_input_coil_length(frm, target_row = null) {
	const so_row = (frm.doc.so_item || [])[0];
	if (!so_row) return;

	const qty = flt(so_row.qty);
	const thickness = flt(so_row.thickness);
	const width = flt(so_row.width);
	const denominator = thickness * width * 0.00000785 * 1000;
	const length = denominator ? qty / denominator : 0;

	const rows = target_row ? [target_row] : frm.doc.input_coil || [];
	rows.forEach((row) => {
		if (row) {
			row.length = length;
		}
	});

	frm.refresh_field("input_coil");
}

function formatCounterDuration(totalSeconds) {
	const seconds = Math.max(0, cint(totalSeconds));
	const hours = Math.floor(seconds / 3600);
	const minutes = Math.floor((seconds % 3600) / 60);
	const remainingSeconds = seconds % 60;
	return [hours, minutes, remainingSeconds].map((value) => String(value).padStart(2, "0")).join(":");
}

function renderElapsedTimeField(frm, value) {
	const control = frm.fields_dict.elapsed_time;
	if (!control) return;
	if (control.$input && control.$input.length) {
		control.$input.val(value || "");
		return;
	}
	if (control.disp_area) {
		$(control.disp_area).text(value || "");
	}
}

function getElapsedTimeValue(frm, endValue = null) {
	if (!frm.doc.started_on) {
		return "";
	}
	const start = frappe.datetime.str_to_obj(frm.doc.started_on);
	const end = endValue
		? frappe.datetime.str_to_obj(endValue)
		: frm.doc.completed_on
			? frappe.datetime.str_to_obj(frm.doc.completed_on)
			: new Date();
	const seconds = Math.floor((end - start) / 1000);
	return formatCounterDuration(seconds);
}

function update_elapsed_time_display(frm) {
	if (frm.__elapsed_timer) {
		clearInterval(frm.__elapsed_timer);
		frm.__elapsed_timer = null;
	}

	if (!frm.doc.started_on) {
		renderElapsedTimeField(frm, frm.doc.elapsed_time || "");
		return;
	}

	const render = () => {
		renderElapsedTimeField(frm, getElapsedTimeValue(frm));
	};

	render();

	if (["In Process", "Partially Completed"].includes(frm.doc.order_status) && !frm.doc.completed_on) {
		frm.__elapsed_timer = setInterval(render, 1000);
	}
}

function get_mappable_fieldnames(doctype) {
	return (frappe.meta.get_docfields(doctype) || [])
		.filter(
			(df) =>
				df.fieldname &&
				![
					"Section Break",
					"Column Break",
					"Tab Break",
					"HTML",
					"Button",
					"Table",
					"Table MultiSelect",
				].includes(df.fieldtype),
		)
		.map((df) => df.fieldname);
}

function load_input_coil_from_sales_order_item(frm, item) {
	const target_fields = get_mappable_fieldnames("Coil Input");
	const special_map = {
		class: item.item_name || item.item_code,
		tag_no: item.custom_tag_no,
		dimension: item.custom_dimension || item.custom_dimensin,
		estimated_qty: item.qty,
		estimated_wt: item.custom_estimated_wt || item.estimated_wt,
		actual_qty: item.qty,
		location: item.custom_location || item.location,
		length: item.custom_length || item.length,
		slitter: item.custom_slitter || item.slitter,
		leveler: item.custom_leveler || item.leveler,
		reshearing: item.custom_reshearing || item.reshearing,
	};

	frm.clear_table("input_coil");
	const row = frm.add_child("input_coil");

	target_fields.forEach((fieldname) => {
		if (special_map[fieldname] !== undefined) {
			row[fieldname] = special_map[fieldname];
			return;
		}

		const direct_value = item[fieldname];
		const custom_value = item[`custom_${fieldname}`];

		if (direct_value !== undefined && direct_value !== null) {
			row[fieldname] = direct_value;
		} else if (custom_value !== undefined && custom_value !== null) {
			row[fieldname] = custom_value;
		}
	});

	frm.refresh_field("input_coil");
}

function buildSubTag(parentTagNo, sequenceNumber) {
	if (!parentTagNo) return "";
	const trimmed = String(parentTagNo).trim();
	const padded = String(sequenceNumber).padStart(3, "0");
	const base = trimmed.endsWith("-000") ? trimmed.slice(0, -4) : trimmed;
	return `${base}-${padded}`;
}

function getNextProcessLabelFromOutputs(frm) {
	return (frm.doc.job_output || []).map((row) => row.next_process).find(Boolean) || "";
}

function getExpectedOutputCount(frm) {
	const cutting_rows = frm.doc.cutting_detail || [];
	const totalPieces = cutting_rows.reduce((sum, row) => sum + Math.max(0, cint(row.strip)), 0);
	if (!cutting_rows.length || !totalPieces) {
		return (frm.doc.input_coil || []).length ? 1 : 0;
	}
	return totalPieces;
}

function rebuild_job_output_if_needed(frm) {
	const expectedCount = getExpectedOutputCount(frm);
	const currentCount = (frm.doc.job_output || []).length;
	if (expectedCount !== currentCount) {
		rebuild_job_output_from_input(frm);
	}
}

function rebuild_job_output_from_input(frm) {
	const input_rows = frm.doc.input_coil || [];
	const so_row = (frm.doc.so_item || [])[0] || {};
	const existing_rows = frm.doc.job_output || [];
	const cutting_rows = frm.doc.cutting_detail || [];
	const input_row = input_rows[0];
	const target_fields = get_mappable_fieldnames("Coil Output");
	const totalPieces = cutting_rows.reduce((sum, row) => sum + Math.max(0, cint(row.strip)), 0);

	frm.clear_table("job_output");

	if (!input_row) {
		frm.refresh_field("job_output");
		update_grand_totals(frm);
		return;
	}

	if (!cutting_rows.length || !totalPieces) {
		const row = frm.add_child("job_output");
		apply_job_output_values(frm, row, input_row, so_row, existing_rows[0], 1, flt(so_row.width) || flt(input_row.width), 1);
	} else {
		let outputIndex = 0;
		cutting_rows.forEach((cuttingRow) => {
			const stripCount = Math.max(0, cint(cuttingRow.strip));
			for (let i = 0; i < stripCount; i += 1) {
				const row = frm.add_child("job_output");
				apply_job_output_values(
					frm,
					row,
					input_row,
					so_row,
					existing_rows[outputIndex],
					outputIndex + 1,
					flt(cuttingRow.width),
					totalPieces,
				);
				outputIndex += 1;
			}
		});
	}

	frm.refresh_field("job_output");
	update_grand_totals(frm);
	render_job_output_qr_fields(frm);
}

function apply_job_output_values(frm, row, input_row, so_row, existing_row, sequenceNumber, outputWidth, totalPieces) {
	const target_fields = get_mappable_fieldnames("Coil Output");
	const estimatedQty = totalPieces ? flt(input_row.estimated_qty) / totalPieces : flt(input_row.estimated_qty);
	const estimatedWt = totalPieces ? flt(input_row.estimated_wt) / totalPieces : flt(input_row.estimated_wt);
	const parentTag = input_row.tag_no || "";

	target_fields.forEach((fieldname) => {
		if (fieldname === "class") {
			row.class = input_row.class;
			return;
		}
		if (fieldname === "tag_no") {
			row.tag_no = existing_row?.tag_no || buildSubTag(parentTag, sequenceNumber);
			return;
		}
		if (fieldname === "estimated_qty") {
			row.estimated_qty = estimatedQty;
			return;
		}
		if (fieldname === "actual_qty") {
			row.actual_qty = existing_row?.actual_qty || estimatedQty;
			return;
		}
		if (fieldname === "estimated_wt") {
			row.estimated_wt = existing_row?.estimated_wt || estimatedWt;
			return;
		}
		if (fieldname === "actual_wt") {
			row.actual_wt = existing_row?.actual_wt || estimatedWt;
			return;
		}
		if (fieldname === "length") {
			row.length = existing_row?.length || input_row.length;
			return;
		}
		if (fieldname === "customer") {
			row.customer = frm.doc.customer_name || existing_row?.customer || "";
			return;
		}
		if (fieldname === "thickness") {
			row.thickness = existing_row?.thickness || so_row.thickness || input_row.thickness || "";
			return;
		}
		if (fieldname === "width") {
			row.width = outputWidth || existing_row?.width || so_row.width || "";
			return;
		}
		if (fieldname === "packing") {
			row.packing = existing_row?.packing || so_row.custom_packing_type || so_row.packing || "";
			return;
		}
		if (fieldname === "barcode") {
			row.barcode = existing_row?.barcode || row.tag_no || "";
			return;
		}
		if (fieldname === "current_process" || fieldname === "next_process" || fieldname === "next_process_date" || fieldname === "qr_code") {
			return;
		}

		if (existing_row && existing_row[fieldname] !== undefined && existing_row[fieldname] !== null && existing_row[fieldname] !== "") {
			row[fieldname] = existing_row[fieldname];
			return;
		}

		if (input_row[fieldname] !== undefined && input_row[fieldname] !== null) {
			row[fieldname] = input_row[fieldname];
		}
	});
}

function sync_process_preview(frm) {
	const currentProcess = formatProcessLabel(frm.doc.operation);
	const configuredProcesses = getConfiguredProcesses(frm);
	const nextProcessKey = getNextProcessKey(frm.doc.operation, configuredProcesses);
	const nextProcess = formatProcessLabel(nextProcessKey);
	const today = frappe.datetime ? frappe.datetime.get_today() : "";

	(frm.doc.input_coil || []).forEach((row) => {
		if (!row.next_process) {
			row.next_process = currentProcess || nextProcess;
		}
	});

	(frm.doc.job_output || []).forEach((row) => {
		row.current_process = currentProcess;
		row.next_process = nextProcess;
		row.next_process_date = nextProcess ? today : "";
		row.barcode = row.tag_no || "";
		row.qr_code = buildOutputQrHtml(frm, row);
	});

	frm.refresh_field("input_coil");
	frm.refresh_field("job_output");
	render_job_output_qr_fields(frm);
}

function getConfiguredProcesses(frm) {
	const row = (frm.doc.so_item || [])[0] || (frm.doc.input_coil || [])[0] || {};
	return ["slitter", "leveler", "reshearing"].filter((fieldname) => Boolean(row[fieldname]));
}

function getNextProcessKey(currentProcess, configuredProcesses) {
	if (!configuredProcesses.length) return "";
	if (!currentProcess) return configuredProcesses[0];

	const normalized = String(currentProcess || "").trim().toLowerCase();
	const labels = {
		slitter: "slitter",
		leveler: "leveler",
		reshearing: "reshearing",
	};
	const currentKey = labels[normalized] || normalized;
	const index = configuredProcesses.indexOf(currentKey);
	return index >= 0 && index + 1 < configuredProcesses.length ? configuredProcesses[index + 1] : "";
}

function formatProcessLabel(processName) {
	const labelMap = {
		slitter: "Slitter",
		leveler: "Leveler",
		reshearing: "Reshearing",
	};
	const key = String(processName || "").trim().toLowerCase();
	return labelMap[key] || processName || "";
}

function buildOutputQrHtml(frm, row) {
	const parts = [
		["Tag No", row.tag_no],
		["Item", row.class],
		["Customer", row.customer || frm.doc.customer],
		["Sales Order", frm.doc.order_no],
		["Stock Entry", frm.doc.stock_entry],
		["Current Process", row.current_process],
		["Next Process", row.next_process],
		["Next Process Date", row.next_process_date],
		["Dimension", [row.thickness, row.width, row.length].filter((value) => value !== undefined && value !== null && value !== "").join(" x ")],
		["Estimated WT", row.estimated_wt],
	].filter((entry) => entry[1]);

	if (!parts.length) return "";

	return `
		<div style="background:#fff;border:1px solid #d7e3f4;border-radius:10px;padding:10px;line-height:1.55;font-size:11px;color:#16324f;">
			${parts.map(([label, value]) => `<div><b>${frappe.utils.escape_html(label)}:</b> ${frappe.utils.escape_html(String(value))}</div>`).join("")}
		</div>
	`;
}

function render_job_output_qr_fields(frm) {
	const grid = frm.fields_dict.job_output && frm.fields_dict.job_output.grid;
	if (!grid || !grid.grid_rows_by_docname) return;

	(frm.doc.job_output || []).forEach((row) => {
		const html = row.qr_code || buildOutputQrHtml(frm, row);
		if (!html) return;

		const gridRow = grid.grid_rows_by_docname[row.name];
		if (!gridRow || !gridRow.grid_form || !gridRow.grid_form.fields_dict.qr_code) return;

		const qrField = gridRow.grid_form.fields_dict.qr_code;
		if (qrField.$wrapper) {
			qrField.$wrapper.html(html);
		}

		if (gridRow.row && gridRow.row.length) {
			const qrCell = gridRow.row.find('[data-fieldname="qr_code"]');
			if (qrCell && qrCell.length) {
				qrCell.html(`<div style="min-width:110px">${html}</div>`);
			}
		}
	});
}

function load_cutting_scheme_from_so_item(frm, rows) {
	const target_fields = (frappe.meta.get_docfields("Cutting Scheme") || [])
		.filter(
			(df) =>
				df.fieldname &&
				![
					"Section Break",
					"Column Break",
					"Tab Break",
					"HTML",
					"Button",
					"Table",
					"Table MultiSelect",
				].includes(df.fieldtype),
		)
		.map((df) => df.fieldname);

	frm.clear_table("cutting_detail");

	(rows || []).forEach((source_row) => {
		const row = frm.add_child("cutting_detail");
		target_fields.forEach((fieldname) => {
			if (source_row[fieldname] !== undefined && source_row[fieldname] !== null) {
				row[fieldname] = source_row[fieldname];
			}
		});
	});

	frm.refresh_field("cutting_detail");
	rebuild_job_output_from_input(frm);
	sync_process_preview(frm);
	update_grand_totals(frm);
}

function clear_sales_order_item_mapped_fields(frm) {
	frm.set_value("machine", "");
	frm.set_value("calc_ratio", 0);
	frm.set_value("calc_ratio_2", 0);
	frm.set_value("actual_ratio", 0);
	frm.set_value("remaining_width", 0);
	frm.set_value("order_status", "");
}
