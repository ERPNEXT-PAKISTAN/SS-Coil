frappe.provide("ss_coil.delivery_by_tag");

function escape_html(value) {
	return frappe.utils.escape_html(String(value == null ? "" : value));
}

function format_qty(value) {
	const n = flt(value);
	if (!n && n !== 0) return "-";
	return format_number(n, null, 3);
}

function open_delivery_note_by_tag_dialog(sales_order, options = {}) {
	// Legacy SO / Flow entry: still works with one Sales Order
	if (!sales_order && !options.customer) {
		frappe.msgprint(__("Customer or Sales Order is required"));
		return;
	}

	if (options.customer) {
		open_delivery_note_by_customer_tag_dialog(options.customer, options);
		return;
	}

	frappe.call({
		method: "ss_coil.delivery_by_tag.get_sales_order_delivery_tag_rows",
		args: { sales_order },
		freeze: true,
		freeze_message: __("Loading Tag No list..."),
		callback(r) {
			const data = r.message || {};
			const rows = data.rows || [];
			if (!rows.length) {
				frappe.msgprint(__("No undelivered Sales Order items with pending qty to deliver."));
				return;
			}
			show_delivery_note_by_tag_dialog(data, options);
		},
	});
}

function open_delivery_note_by_customer_tag_dialog(customer, options = {}) {
	if (!customer) {
		frappe.msgprint(__("Select Customer first"));
		return;
	}

	frappe.call({
		method: "ss_coil.delivery_by_tag.get_customer_delivery_tag_rows",
		args: {
			customer,
			company: options.company || null,
			tagged_only: 1,
		},
		freeze: true,
		freeze_message: __("Loading Tag No list for customer..."),
		callback(r) {
			const data = r.message || {};
			const rows = data.rows || [];
			if (!rows.length) {
				frappe.msgprint(
					__("No pending Sales Order Tag items found for customer {0}", [customer])
				);
				return;
			}
			options.mode = "customer";
			show_delivery_note_by_tag_dialog(data, options);
		},
	});
}

function show_delivery_note_by_tag_dialog(data, options = {}) {
	const selected = new Set();
	const rows = data.rows || [];
	const multi_so = new Set(rows.map((r) => r.sales_order).filter(Boolean)).size > 1;

	rows.forEach((row) => {
		if (row.tag_no || row.custom_tag_no) selected.add(row.so_detail);
	});
	if (!selected.size && rows.length) {
		rows.forEach((row) => selected.add(row.so_detail));
	}

	const dialog = new frappe.ui.Dialog({
		title: __("Load Delivery Items by Tag No"),
		size: "extra-large",
		fields: [
			{ fieldtype: "HTML", fieldname: "header_html" },
			{
				fieldtype: "Data",
				fieldname: "search",
				label: __("Search Tag No / Item / Sales Order"),
				placeholder: __("Type tag, item, sales order..."),
			},
			{ fieldtype: "HTML", fieldname: "table_html" },
			{ fieldtype: "HTML", fieldname: "footer_html" },
		],
		primary_action_label: __("Load Selected Items"),
		primary_action() {
			const names = Array.from(selected);
			if (!names.length) {
				frappe.msgprint(__("Select at least one Tag / item row"));
				return;
			}
			load_selected_tag_items(names, data, options, dialog);
		},
	});

	dialog.$wrapper.addClass("ss-coil-dn-tag-dialog");
	const so_label = data.sales_order || (multi_so ? __("Multiple") : rows[0]?.sales_order || "-");
	dialog.fields_dict.header_html.$wrapper.html(`
		<div class="ss-coil-dn-tag-header">
			<div>
				<div class="ss-coil-dn-tag-kicker">${__("Customer")}</div>
				<div class="ss-coil-dn-tag-title">${escape_html(data.customer_name || data.customer || "")}</div>
			</div>
			<div>
				<div class="ss-coil-dn-tag-kicker">${__("Sales Order")}</div>
				<div class="ss-coil-dn-tag-title">${escape_html(so_label)}</div>
			</div>
			<div class="ss-coil-dn-tag-actions">
				<button type="button" class="btn btn-xs btn-default ss-coil-dn-select-all">${__("Select All")}</button>
				<button type="button" class="btn btn-xs btn-default ss-coil-dn-clear">${__("Clear")}</button>
				<button type="button" class="btn btn-xs btn-default ss-coil-dn-tagged-only">${__("Tagged Only")}</button>
			</div>
		</div>
		<div class="text-muted" style="margin-bottom:8px;font-size:12px;">
			${__("Select Tag No rows to load onto this Delivery Note. No need to save first.")}
		</div>
	`);

	const render = () => {
		const q = String(dialog.get_value("search") || "")
			.trim()
			.toLowerCase();
		const filtered = rows.filter((row) => {
			if (!q) return true;
			const hay = [
				row.tag_no,
				row.custom_tag_no,
				row.custom_sub_tag_no,
				row.item_code,
				row.item_name,
				row.sales_order,
				row.dimension,
				row.mill,
				row.mill_key,
				row.location,
				row.js_number,
			]
				.join(" ")
				.toLowerCase();
			return hay.includes(q);
		});

		const so_col = multi_so || options.mode === "customer";
		const body = filtered
			.map((row) => {
				const checked = selected.has(row.so_detail) ? "checked" : "";
				const tag_cell = row.tag_no || row.custom_tag_no
					? `<b class="ss-coil-dn-tag-value">${escape_html(row.tag_no || row.custom_tag_no)}</b>`
					: `<span class="text-muted">${__("No Tag")}</span>`;
				const sub_tag = row.custom_sub_tag_no
					? `<div class="text-muted small">${escape_html(row.custom_sub_tag_no)}</div>`
					: "";
				return `<tr data-so-detail="${escape_html(row.so_detail)}">
					<td class="ss-coil-dn-check-col">
						<input type="checkbox" class="ss-coil-dn-row-check" data-so-detail="${escape_html(
							row.so_detail
						)}" ${checked} />
					</td>
					<td class="ss-coil-dn-tag-col">${tag_cell}${sub_tag}</td>
					${
						so_col
							? `<td><a href="/app/sales-order/${encodeURIComponent(
									row.sales_order || ""
							  )}">${escape_html(row.sales_order || "")}</a></td>`
							: ""
					}
					<td><b>${escape_html(row.item_code || "")}</b></td>
					<td class="text-right">${format_qty(row.qty)}</td>
					<td class="text-right">${format_qty(row.delivered_qty)}</td>
					<td class="text-right"><b>${format_qty(row.pending_qty)}</b></td>
				</tr>`;
			})
			.join("");

		dialog.fields_dict.table_html.$wrapper.html(`
			<div class="ss-coil-dn-tag-table-wrap">
				<table class="table table-bordered table-sm ss-coil-dn-tag-table">
					<thead>
						<tr>
							<th class="ss-coil-dn-check-col"></th>
							<th>${__("Tag No")}</th>
							${so_col ? `<th>${__("Sales Order")}</th>` : ""}
							<th>${__("Item")}</th>
							<th class="text-right">${__("Ordered")}</th>
							<th class="text-right">${__("Delivered")}</th>
							<th class="text-right">${__("Pending")}</th>
						</tr>
					</thead>
					<tbody>${
						body || `<tr><td colspan="7" class="text-muted">${__("No matching rows")}</td></tr>`
					}</tbody>
				</table>
			</div>
		`);

		const total_pending = Array.from(selected).reduce((sum, name) => {
			const row = rows.find((r) => r.so_detail === name);
			return sum + flt(row && row.pending_qty);
		}, 0);
		dialog.fields_dict.footer_html.$wrapper.html(`
			<div class="ss-coil-dn-tag-footer">
				<span><b>${selected.size}</b> ${__("selected")}</span>
				<span>${__("Pending qty")}: <b>${format_qty(total_pending)}</b></span>
			</div>
		`);

		dialog.fields_dict.table_html.$wrapper.find(".ss-coil-dn-row-check").on("change", function () {
			const name = $(this).attr("data-so-detail");
			if (this.checked) selected.add(name);
			else selected.delete(name);
			render();
		});
	};

	dialog.fields_dict.search.df.onchange = () => render();
	dialog.$wrapper.on("input", '[data-fieldname="search"] input', () => render());
	dialog.fields_dict.header_html.$wrapper.find(".ss-coil-dn-select-all").on("click", () => {
		rows.forEach((row) => selected.add(row.so_detail));
		render();
	});
	dialog.fields_dict.header_html.$wrapper.find(".ss-coil-dn-clear").on("click", () => {
		selected.clear();
		render();
	});
	dialog.fields_dict.header_html.$wrapper.find(".ss-coil-dn-tagged-only").on("click", () => {
		selected.clear();
		rows.forEach((row) => {
			if (row.tag_no || row.custom_tag_no) selected.add(row.so_detail);
		});
		render();
	});

	ensure_delivery_by_tag_styles();
	dialog.show();
	render();
}

function load_selected_tag_items(so_detail_names, data, options, dialog) {
	const args = {
		so_detail_names,
		customer: options.customer || data.customer || null,
		company: options.company || data.company || null,
		replace_items: options.replace_items == null ? 1 : cint(options.replace_items),
	};
	if (options.target_doc) {
		args.target_doc = options.target_doc;
	} else if (data.sales_order) {
		// Creating a brand-new DN from SO button / Flow
		args.customer = args.customer || data.customer;
		args.company = args.company || data.company;
	}

	frappe.call({
		method: "ss_coil.delivery_by_tag.load_delivery_note_items_by_tags",
		args,
		freeze: true,
		freeze_message: __("Loading Tag items onto Delivery Note..."),
		callback(r) {
			if (!r.message) return;
			if (dialog) dialog.hide();

			if (typeof options.on_success === "function") {
				options.on_success(r.message);
				return;
			}

			frappe.model.sync(r.message);
			frappe.set_route("Form", "Delivery Note", r.message.name);
		},
	});
}

function apply_mapped_delivery_note_to_form(frm, dn, opts = {}) {
	if (!frm || !dn) return;

	const parent_skip = new Set([
		"name",
		"owner",
		"creation",
		"modified",
		"modified_by",
		"docstatus",
		"idx",
		"amended_from",
		"naming_series",
	]);

	Object.keys(dn).forEach((key) => {
		if (parent_skip.has(key) || key.startsWith("__")) return;
		if (Array.isArray(dn[key])) return;
		if (!frm.fields_dict[key]) return;
		if (dn[key] == null || dn[key] === "") return;
		frm.set_value(key, dn[key]);
	});

	frm.clear_table("items");
	(dn.items || []).forEach((row) => {
		const child = frm.add_child("items");
		Object.keys(row).forEach((fieldname) => {
			if (
				["name", "owner", "creation", "modified", "modified_by", "parent", "parenttype", "parentfield"].includes(
					fieldname
				)
			) {
				return;
			}
			if (fieldname.startsWith("__")) return;
			child[fieldname] = row[fieldname];
		});
	});
	frm.refresh_field("items");
	if (frm.doc.taxes_and_charges || (dn.taxes || []).length) {
		frm.refresh_field("taxes");
	}
	frm.dirty();
	frappe.show_alert({
		message: __("Loaded {0} item(s) by Tag No", [(dn.items || []).length]),
		indicator: "green",
	});
	if (opts.run_totals !== false && frm.cscript && frm.cscript.calculate_taxes_and_totals) {
		frm.cscript.calculate_taxes_and_totals();
	}
}

function ensure_delivery_by_tag_styles() {
	if (document.getElementById("ss-coil-dn-tag-styles")) return;
	const style = document.createElement("style");
	style.id = "ss-coil-dn-tag-styles";
	style.textContent = `
		.ss-coil-dn-tag-dialog .modal-dialog { max-width: 1100px; width: 96vw; }
		.ss-coil-dn-tag-header {
			display: flex; gap: 24px; align-items: flex-end; flex-wrap: wrap;
			margin-bottom: 8px; padding-bottom: 10px; border-bottom: 1px solid #e2e8f0;
		}
		.ss-coil-dn-tag-kicker {
			font-size: 11px; letter-spacing: .04em; text-transform: uppercase; color: #64748b;
		}
		.ss-coil-dn-tag-title { font-size: 15px; font-weight: 700; color: #0f172a; }
		.ss-coil-dn-tag-actions { margin-left: auto; display: flex; gap: 6px; }
		.ss-coil-dn-tag-table-wrap { max-height: 52vh; overflow: auto; border: 1px solid #e2e8f0; border-radius: 8px; }
		.ss-coil-dn-tag-table { margin: 0; }
		.ss-coil-dn-tag-table thead th {
			position: sticky; top: 0; background: #f8fafc; z-index: 1; white-space: nowrap;
		}
		.ss-coil-dn-tag-value { color: #0e7490; font-size: 13px; }
		.ss-coil-dn-tag-col { min-width: 140px; white-space: nowrap; }
		.ss-coil-dn-check-col { width: 36px; text-align: center; }
		.ss-coil-dn-tag-footer {
			display: flex; justify-content: space-between; gap: 12px; margin-top: 10px;
			color: #334155; font-size: 13px;
		}
	`;
	document.head.appendChild(style);
}

ss_coil.delivery_by_tag.open = open_delivery_note_by_tag_dialog;
ss_coil.delivery_by_tag.open_for_customer = open_delivery_note_by_customer_tag_dialog;
ss_coil.delivery_by_tag.apply_to_form = apply_mapped_delivery_note_to_form;
ss_coil.delivery_by_tag.create = load_selected_tag_items;
