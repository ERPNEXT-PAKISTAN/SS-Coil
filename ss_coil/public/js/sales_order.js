frappe.ui.form.on("Sales Order", {
	refresh(frm) {
		bind_live_dimension_events(frm);
		add_sales_order_tag_buttons(frm);
		render_sales_order_dashboard(frm);
		render_packing_detail(frm);
		render_cutting_scheme_report(frm);
	},
	validate(frm) {
		(frm.doc.items || []).forEach((row) => {
			set_custom_dimension_from_values(row.doctype, row.name);
		});
	},
});

function add_sales_order_tag_buttons(frm) {
	if (!frm.doc.name || (frm.is_new && frm.is_new())) return;

	frm.add_custom_button(__("Tag Registry"), function () {
		frappe.set_route("List", "Tag Registry", { sales_order: frm.doc.name });
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
		render_item_cutting_scheme_preview(frm, cdt, cdn);
	},
	custom_manage_cutting_scheme(frm, cdt, cdn) {
		open_cutting_scheme_dialog(frm, cdt, cdn);
	},
});

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

function open_cutting_scheme_dialog(frm, cdt, cdn) {
	const row = locals[cdt] && locals[cdt][cdn];
	if (!row || !frm.doc.name) return;
	if (
		(frm.is_new && frm.is_new()) ||
		String(frm.doc.name || "").startsWith("new-sales-order-") ||
		String(row.name || "").startsWith("new-sales-order-item-")
	) {
		frappe.msgprint(__("Please save the Sales Order once before using Manage Cutting Scheme."));
		return;
	}

	frappe.call({
		method: "ss_coil.api.get_so_production_plan",
		args: {
			sales_order: frm.doc.name,
			sales_order_item: row.name,
		},
		callback: function (r) {
			const data = r.message || {};
			const dialog = new frappe.ui.Dialog({
				title: __("Cutting Scheme: {0}", [row.item_name || row.item_code || row.name]),
				size: "extra-large",
				fields: [
					{
						fieldname: "item_meta_html",
						fieldtype: "HTML",
					},
					{
						fieldname: "cutting_rows",
						fieldtype: "Table",
						label: "Cutting Scheme Rows",
						in_place_edit: true,
						cannot_add_rows: false,
						data: (data.rows || []).map((d) => ({
							seq: d.seq,
							width: d.width,
							strip: d.strip,
							lengthcut: d.lengthcut,
							total_width: d.total_width,
							tolerance_plus: d.tolerance_plus,
							tolerance_minus: d.tolerance_minus,
							knife: d.knife,
						})),
						fields: [
							{ fieldname: "seq", fieldtype: "Float", label: "SEQ", in_list_view: 1, read_only: 1, columns: 1 },
							{ fieldname: "width", fieldtype: "Float", label: "Width", in_list_view: 1, reqd: 1, columns: 2 },
							{ fieldname: "strip", fieldtype: "Float", label: "Strip", in_list_view: 1, columns: 1 },
							{ fieldname: "lengthcut", fieldtype: "Float", label: "LengthCut", in_list_view: 1, columns: 2 },
							{ fieldname: "total_width", fieldtype: "Float", label: "Total Width", in_list_view: 1, read_only: 1, columns: 2 },
							{ fieldname: "tolerance_plus", fieldtype: "Float", label: "Tol (+)", in_list_view: 1, columns: 1 },
							{ fieldname: "tolerance_minus", fieldtype: "Float", label: "Tol (-)", in_list_view: 1, columns: 1 },
							{ fieldname: "knife", fieldtype: "Check", label: "Knife", in_list_view: 1, columns: 1 },
						],
					},
					{
						fieldname: "totals_html",
						fieldtype: "HTML",
					},
				],
				primary_action_label: __("Save"),
				primary_action(values) {
					const rows = normalize_cutting_scheme_rows(values.cutting_rows || []);
					if (rows.some((d) => !flt(d.width))) {
						frappe.msgprint(__("Width is mandatory in each saved row."));
						return;
					}

					frappe.call({
						method: "ss_coil.api.save_so_production_plan",
						args: {
							sales_order: frm.doc.name,
							sales_order_item: row.name,
							rows,
						},
						freeze: true,
						freeze_message: __("Saving Cutting Scheme..."),
						callback: function (r) {
							dialog.hide();
							if (r.message) {
								const item_row = locals[cdt] && locals[cdt][cdn];
								if (item_row) {
									item_row.custom_calc_ratio = flt(r.message.custom_calc_ratio);
									item_row.custom_remaining_width = flt(r.message.custom_remaining_width);
								}
								frappe.model.set_value(cdt, cdn, "custom_calc_ratio", flt(r.message.custom_calc_ratio));
								frappe.model.set_value(cdt, cdn, "custom_remaining_width", flt(r.message.custom_remaining_width));
								frm.refresh_field("items");
							}
							render_item_cutting_scheme_preview(frm, cdt, cdn);
							render_cutting_scheme_report(frm);
							frappe.show_alert({
								message: __("Cutting Scheme saved"),
								indicator: "green",
							});
						},
					});
				},
			});

			dialog.show();
			dialog.__so_item_qty = row.qty;
			dialog.__so_item_width = row.custom_width;
			render_cutting_scheme_item_meta(dialog, row);
			prepare_cutting_scheme_dialog(dialog);
		},
	});
}

function prepare_cutting_scheme_dialog(dialog) {
	const field = dialog.fields_dict.cutting_rows;
	if (!field || !field.grid) return;

	field.grid.df.data = normalize_cutting_scheme_rows(field.grid.df.data || []);
	field.grid.refresh();
	field.grid.wrapper.css("overflow-x", "auto");
	field.grid.wrapper.find(".grid-body").css("overflow-x", "auto");
	field.grid.wrapper.find(".grid-heading-row, .rows").css("min-width", "1100px");
	update_cutting_scheme_totals(dialog);

	// Keep the grid editable inside the dialog and avoid full refresh on each keystroke.
	field.grid.wrapper.find(".grid-add-row, .grid-remove-rows").css("display", "");

	field.grid.wrapper.off(".ss_coil_cutting_dialog");
	field.grid.wrapper.on(
		"input.ss_coil_cutting_dialog change.ss_coil_cutting_dialog",
		'[data-fieldname="width"] input, [data-fieldname="strip"] input, [data-fieldname="lengthcut"] input, [data-fieldname="tolerance_plus"] input, [data-fieldname="tolerance_minus"] input',
		function () {
			const row_name =
				$(this).attr("data-name") || $(this).closest(".grid-row").attr("data-name");
			if (!row_name) return;
			const row = (locals["Dialog Table"] || {})[row_name];
			if (!row) return;

			row.total_width = flt(row.width) * flt(row.strip);
			field.grid.refresh_row(row_name);
			update_cutting_scheme_totals(dialog);
		},
	);

	field.grid.wrapper.on("click.ss_coil_cutting_dialog", ".grid-add-row", function () {
		setTimeout(() => {
			const data = normalize_cutting_scheme_rows(field.grid.get_data() || []);
			field.grid.df.data = data;
			field.grid.refresh();
			update_cutting_scheme_totals(dialog);
		}, 50);
	});

	field.grid.wrapper.on("click.ss_coil_cutting_dialog", ".grid-remove-rows, .grid-delete-row", function () {
		setTimeout(() => {
			const data = normalize_cutting_scheme_rows(field.grid.get_data() || []);
			field.grid.df.data = data;
			field.grid.refresh();
			update_cutting_scheme_totals(dialog);
		}, 50);
	});
}

function normalize_cutting_scheme_rows(rows) {
	return (rows || [])
		.filter((d) =>
			[
				d.seq,
				d.width,
				d.strip,
				d.lengthcut,
				d.tolerance_plus,
				d.tolerance_minus,
				d.knife,
			].some((v) => v !== undefined && v !== null && String(v).trim() !== ""),
		)
		.map((d, idx) => ({
			...d,
			seq: idx + 1,
			total_width: flt(d.width) * flt(d.strip),
		}));
}

function update_cutting_scheme_totals(dialog) {
	const field = dialog.fields_dict.cutting_rows;
	const html_field = dialog.fields_dict.totals_html;
	if (!field || !html_field) return;

	const rows = normalize_cutting_scheme_rows(field.grid.get_data() || []);
	const total_width = rows.reduce((sum, row) => sum + flt(row.total_width), 0);
	const total_strips = rows.reduce((sum, row) => sum + flt(row.strip), 0);
	const total_plain_width = rows.reduce((sum, row) => sum + flt(row.width), 0);
	const row_count = rows.length;
	const qty = flt(dialog.__so_item_qty);
	const item_width = flt(dialog.__so_item_width);
	const calc_ratio = item_width ? (qty / item_width) * total_plain_width : 0;
	const remaining_width = item_width - total_width;

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

function render_cutting_scheme_item_meta(dialog, row) {
	const html_field = dialog.fields_dict.item_meta_html;
	if (!html_field) return;

	html_field.$wrapper.html(`
		<div style="margin-bottom: 14px; display: grid; grid-template-columns: repeat(6, minmax(120px, 1fr)); gap: 10px; background: #f6f9fc; border: 1px solid #dce7f2; border-radius: 12px; padding: 12px;">
			${metaCard("Item", row.item_name || row.item_code || row.name)}
			${metaCard("Qty", format_number(row.qty))}
			${metaCard("Tag No", row.custom_tag_no || "-")}
			${metaCard("Ref No", row.custom_ref_no || "-")}
			${metaCard("Thickness", row.custom_thickness || "-")}
			${metaCard("Width", row.custom_width || "-")}
			${metaCard("Length C", row.custom_length_c || "-")}
			${metaCard("Length", row.custom_length || "-")}
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
							<td><strong>${escape_html(item.item_name || item.item_code || item.name)}</strong><br><span style="color:#64748b;">${escape_html(item.item_code || item.name || "-")}</span></td>
							<td>${format_number(item.qty)}</td>
							<td>${escape_html(item.tag_no || "-")}</td>
							<td>${escape_html(item.ref_no || "-")}</td>
							<td>${escape_html(item.dimension || "-")}</td>
							<td>${escape_html(item.specification || "-")}</td>
							<td>${escape_html(item.machine || "-")}</td>
							<td>${format_number(item.estimated_wt)}</td>
							<td>${format_number(item.calc_ratio)}</td>
							<td>${format_number(item.actual_ratio)}</td>
							<td>${numberPill(item.remaining_width, flt(item.remaining_width) < 0 ? "danger" : "success")}</td>
						</tr>`,
				)
				.join("")
		: `<tr><td colspan="11" style="text-align:center; color:#64748b;">No Sales Order items found.</td></tr>`;

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
			<td>${escape_html(row.item_name || row.item_code || "-")}</td>
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
					${flatInfoCard("Items", items.map((item) => item.item_name || item.item_code).slice(0, 2).join(", ") || "-")}
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
								<th>Machine</th>
								<th>Est WT</th>
								<th>Calc Ratio</th>
								<th>Actual Ratio</th>
								<th>Remaining Width</th>
							</tr>
						</thead>
						<tbody>${itemRows}</tbody>
					</table>
				</div>
			`)}

			${collapsibleSection("Cutting Scheme Report", "Item wise cutting scheme dashboard detail", "#1f8c3a", cuttingSchemeHtml)}

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

			${collapsibleSection("Packing Detail", "Packing readiness and packed rows overview", "#0f7f7c", `
				${stackedDetailSection("Packing Snapshot", "Packing summary from Sales Order item custom fields", infoPanel("Packing Detail", [["Packed Rows", format_number(packingDetails.length)], ["No. of Pack Total", format_number(packingTotalPacks)], ["System Packed Rows", format_number(data.packed_items_count)], ["Status", packingDetails.length ? "Packing detail available" : "No packing rows yet"]], '#f8fefe', '#d1ece8'))}
				${stackedDetailSection("Packing Table", "Item wise packing detail with tag number", `
					<div style="overflow:auto;">
						<table class="table table-bordered" style="margin-bottom:0; background:#fff; min-width:1080px;">
							<thead style="background:#dfe9ff; color:#1f56d2;">
								<tr><th>Item Name</th><th>Tag No</th><th>Packing Type</th><th>Packing Weight/Size</th><th>No of Pack</th><th>Remarks</th><th>Comments</th></tr>
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
					<div style="color:#52657a; font-size:13px;">Use <b>Tag Registry Trace</b> to group parent tags and produced child tags, or open the registry list already filtered by this Sales Order.</div>
				`)}
				${stackedDetailSection("Tag Tree", "Parent tag with produced child tags and current status", tagTreeHtml)}
				${stackedDetailSection("Tag Trace", "Unique tag journey across purchase, stock, sales, dispatch and invoice", tagTraceHtml)}
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

function build_cutting_scheme_report_html(groups) {
	if (!groups.length) {
		return `<div style="${panelStyle('#fffefb','#eadfbe')}"><div style="color:#7b6f5c;">No cutting scheme saved yet.</div></div>`;
	}

	return groups
		.map((group) => {
			const rows = (group.rows || [])
				.map(
					(row) => `
						<tr>
							<td>${row.seq || ""}</td>
							<td>${row.width || ""}</td>
							<td>${row.strip || ""}</td>
							<td>${row.lengthcut || ""}</td>
							<td>${row.total_width || ""}</td>
							<td>${row.tolerance_plus || ""}</td>
							<td>${row.tolerance_minus || ""}</td>
							<td>${row.knife ? "Yes" : "No"}</td>
						</tr>`,
				)
				.join("");

			return `
				<div style="border:1px solid #ddd6bf; border-radius:18px; overflow:hidden; background:linear-gradient(180deg,#fffdfa 0%,#f7f2e8 100%); box-shadow:0 10px 28px rgba(70,53,20,.06);">
					<div style="display:flex; gap:0; align-items:stretch; flex-wrap:wrap;">
						<div style="flex:0 0 290px; background:linear-gradient(180deg,#203549 0%,#314e68 100%); color:#f7fbff; padding:18px;">
							<div style="font-size:11px; text-transform:uppercase; letter-spacing:.1em; opacity:.72;">Cutting Item</div>
							<div style="font-size:20px; font-weight:800; margin-top:8px;">${escape_html(group.item_label || group.sales_order_item)}</div>
							<div style="margin-top:14px; display:grid; gap:8px; font-size:12px; color:#d9e7f4;">
								<div><strong>Qty:</strong> ${group.qty || "-"}</div>
								<div><strong>Tag:</strong> ${escape_html(group.tag_no || "-")}</div>
								<div><strong>Dimension:</strong> ${escape_html(group.dimension || "-")}</div>
							</div>
						</div>
						<div style="flex:1; min-width:420px; padding:16px;">
							<div style="overflow:auto;">
								<table class="table table-bordered" style="margin-bottom:0; background:#fffefb; min-width:760px;">
									<thead style="background:#22384d; color:#f8fbff;">
										<tr>
											<th>SEQ</th>
											<th>Width</th>
											<th>Strip</th>
											<th>LengthCut</th>
											<th>Total Width</th>
											<th>Tol (+)</th>
											<th>Tol (-)</th>
											<th>Knife</th>
										</tr>
									</thead>
									<tbody>${rows}</tbody>
								</table>
							</div>
						</div>
					</div>
				</div>`;
		})
		.join("");
}

function build_packing_detail_html(packing) {
	if (!packing || !packing.length) {
		return `<div style="background:#f8fbff; border:1px solid #d8e3f0; border-radius:16px; padding:18px; color:#64748b;">
			No packing detail entered yet.
		</div>`;
	}

	const totalPacks = packing.reduce((sum, row) => sum + flt(row.no_of_pack), 0);
	const rows = packing
		.map(
			(row, index) => `<tr>
				<td>${index + 1}</td>
				<td>${escape_html(row.item_name || row.item_code || "-")}</td>
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
			<div style="margin-top:6px; color:#dbfffb; font-size:13px;">Sales Order item wise packing detail with tag tracking</div>
			<div style="display:grid; grid-template-columns:repeat(auto-fit,minmax(180px,1fr)); gap:10px; margin-top:14px;">
				${heroMetricCard("Packing Rows", format_number(packing.length))}
				${heroMetricCard("No Of Pack", format_number(totalPacks))}
			</div>
		</div>
		<div style="background:#fff; border:1px solid #d8e3f0; border-radius:16px; overflow:hidden; box-shadow:0 12px 28px rgba(15,23,42,.05);">
			<div style="padding:14px 16px; background:linear-gradient(180deg,#f7fbff 0%,#eef4fb 100%); border-bottom:1px solid #dce8f4;">
				<div style="font-size:15px; font-weight:800; color:#102a43;">Packing Table</div>
				<div style="font-size:12px; color:#708399; margin-top:3px;">Item name and tag number shown with packing detail</div>
			</div>
			<div style="padding:14px 16px; overflow:auto;">
				<table class="table table-bordered" style="margin-bottom:0; background:#fff; min-width:1100px;">
					<thead style="background:#dfe9ff; color:#1f56d2;">
						<tr><th>#</th><th>Item Name</th><th>Tag No</th><th>Packing Type</th><th>Packing Weight/Size</th><th>No of Pack</th><th>Remarks</th><th>Comments</th></tr>
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
		return `<div style="${panelStyle("#fbfdff", "#d7e5ef")}"><div style="color:#64748b;">No parent / child tag tree found yet.</div></div>`;
	}

	return tagTree
		.map((group) => {
			const rootTrace = group.root_trace || {};
			const rootRegistry = rootTrace.registry || {};
			const children = group.children || [];
			const childRows = children.length
				? children
						.map((child, index) => {
							const reg = child.registry || {};
							const latestEvent = (child.events || []).slice(-1)[0] || {};
							return `<tr>
								<td>${index + 1}</td>
								<td>${escape_html(child.tag_no || "-")}</td>
								<td>${statusPill(reg.status || "Produced", "warning")}</td>
								<td>${escape_html(reg.item_name || reg.item_code || latestEvent.item_name || "-")}</td>
								<td>${latestEvent.doctype && latestEvent.docname ? docLink(routeForDoctype(latestEvent.doctype), latestEvent.docname, "dark") : "-"}</td>
								<td>${escape_html(latestEvent.date || "-")}</td>
							</tr>`;
						})
						.join("")
				: `<tr><td colspan="6" style="text-align:center; color:#64748b;">No produced child tags yet.</td></tr>`;

			return `<div style="border:1px solid #d8e3f0; border-radius:16px; overflow:hidden; background:#fff; box-shadow:0 10px 22px rgba(15,23,42,.05); margin-top:12px;">
				<div style="background:linear-gradient(90deg,#14532d 0%,#1f8c3a 100%); color:#fff; padding:14px 16px;">
					<div style="display:flex; justify-content:space-between; gap:12px; flex-wrap:wrap; align-items:flex-start;">
						<div>
							<div style="font-size:18px; font-weight:800;">Parent Tag: ${escape_html(group.root_tag_no || "-")}</div>
							<div style="font-size:12px; color:#def7e3; margin-top:4px;">Source: ${escape_html(rootRegistry.source_doctype || "-")} / ${escape_html(rootRegistry.source_docname || "-")}</div>
						</div>
						<div style="display:grid; grid-template-columns:repeat(auto-fit,minmax(120px,1fr)); gap:8px; min-width:320px;">
							${miniTraceCard("Parent Status", rootRegistry.status || "Active")}
							${miniTraceCard("Child Tags", format_number(children.length))}
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
					<div style="overflow:auto;">
						<table class="table table-bordered" style="margin-bottom:0; background:#fff; min-width:920px;">
							<thead style="background:#dfe9ff; color:#1f56d2;">
								<tr><th>#</th><th>Child Tag</th><th>Status</th><th>Item</th><th>Current Document</th><th>Last Date</th></tr>
							</thead>
							<tbody>${childRows}</tbody>
						</table>
					</div>
				</div>
			</div>`;
		})
		.join("");
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
	if (extra.operation) return `Operation: ${extra.operation}`;
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

			const sections = groups
				.map((group) => {
					const rows = (group.rows || [])
						.map(
							(row) => `
								<tr>
									<td>${row.seq || ""}</td>
									<td>${row.width || ""}</td>
									<td>${row.strip || ""}</td>
									<td>${row.lengthcut || ""}</td>
									<td>${row.total_width || ""}</td>
									<td>${row.tolerance_plus || ""}</td>
									<td>${row.tolerance_minus || ""}</td>
									<td>${row.knife ? "Yes" : "No"}</td>
								</tr>`,
						)
						.join("");

					return `
						<div style="margin-bottom: 18px; border: 1px solid #d9e2f2; border-radius: 12px; overflow: hidden; background: linear-gradient(180deg, #fbfdff 0%, #f3f7fc 100%);">
							<div style="display: flex; gap: 18px; align-items: stretch;">
								<div style="flex: 0 0 280px; padding: 16px; background: #16324f; color: #fff;">
									<div style="font-size: 12px; opacity: 0.8; text-transform: uppercase; letter-spacing: 0.06em;">Item</div>
									<div style="font-size: 18px; font-weight: 700; margin-top: 6px;">
										${frappe.utils.escape_html(group.item_label || group.sales_order_item)}
									</div>
									<div style="font-size: 12px; margin-top: 12px; line-height: 1.7; color: #d7e6f7;">
										<div><strong>Qty:</strong> ${group.qty || "-"}</div>
										<div><strong>Tag:</strong> ${group.tag_no || "-"}</div>
										<div><strong>Dim:</strong> ${group.dimension || "-"}</div>
									</div>
								</div>
								<div style="flex: 1; padding: 14px 14px 10px 0;">
									<table class="table table-bordered" style="margin-bottom: 0; background: #fff;">
										<thead style="background: #edf4fb; color: #16324f;">
											<tr>
												<th>SEQ</th>
												<th>Width</th>
												<th>Strip</th>
												<th>LengthCut</th>
												<th>Total Width</th>
												<th>Tol (+)</th>
												<th>Tol (-)</th>
												<th>Knife</th>
											</tr>
										</thead>
										<tbody>${rows}</tbody>
									</table>
								</div>
							</div>
						</div>`;
				})
				.join("");

			html_field.$wrapper.html(sections);
		},
	});
}

function render_item_cutting_scheme_preview(frm, cdt, cdn) {
	const row = locals[cdt] && locals[cdt][cdn];
	if (!row || !frm.doc.name) return;

	const grid_row = frm.fields_dict.items?.grid?.grid_rows_by_docname?.[cdn];
	const wrapper =
		grid_row?.grid_form?.fields_dict?.custom_cutting_scheme_preview?.$wrapper;
	if (!wrapper) return;

	frappe.call({
		method: "ss_coil.api.get_so_production_plan_rows",
		args: {
			sales_order_item: row.name,
		},
		callback: function (r) {
			const rows = r.message || [];
			if (!rows.length) {
				wrapper.html("<div class='text-muted'>No cutting scheme rows saved for this item.</div>");
				return;
			}

			const body = rows
				.map(
					(d) => `<tr>
						<td>${d.seq || ""}</td>
						<td>${d.width || ""}</td>
						<td>${d.strip || ""}</td>
						<td>${d.lengthcut || ""}</td>
						<td>${d.total_width || ""}</td>
						<td>${d.tolerance_plus || ""}</td>
						<td>${d.tolerance_minus || ""}</td>
						<td>${d.knife ? "Yes" : "No"}</td>
					</tr>`,
				)
				.join("");

			wrapper.html(`
				<div style="border:1px solid #dbe6f1; border-radius:10px; overflow:hidden; margin-top:8px;">
					<table class="table table-bordered" style="margin-bottom:0; background:#fff;">
						<thead style="background:#edf4fb; color:#16324f;">
							<tr>
								<th>SEQ</th>
								<th>Width</th>
								<th>Strip</th>
								<th>LengthCut</th>
								<th>Total Width</th>
								<th>Tol (+)</th>
								<th>Tol (-)</th>
								<th>Knife</th>
							</tr>
						</thead>
						<tbody>${body}</tbody>
					</table>
				</div>
			`);
		},
	});
}
