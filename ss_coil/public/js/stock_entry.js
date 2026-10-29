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
		// Render here (in the primary Stock Entry client script) so the ribbon
		// is not dependent on the optional linked-workflow script being loaded.
		render_stock_entry_order_progress(frm);
		ensure_inward_tag_batch_dialog_suppressed();
		add_stock_entry_data_entry_button(frm);
		maybe_open_stock_entry_data_entry_from_route(frm);
		frappe.require("/assets/ss_coil/js/ss_coil_prints.js", () => {
			ss_coil.prints.add_form_buttons(frm);
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

function render_stock_entry_order_progress(frm) {
	const $layout = frm.layout?.wrapper;
	if (!$layout?.length || frm.is_new()) return;
	const linked_orders = String(frm.doc.custom_linked_sales_orders || "").split(/[\n,]+/).map((name) => name.trim()).filter(Boolean);
	const sales_order = frm.doc.custom_sales_order || linked_orders[0];
	const request_id = (frm.__ss_coil_order_progress_request_id || 0) + 1;
	frm.__ss_coil_order_progress_request_id = request_id;
	const esc = (value) => frappe.utils.escape_html(String(value ?? "-"));
	const local_status = [__("Draft"), __("Submitted"), __("Cancelled")][Number(frm.doc.docstatus)] || __("Unknown");
	$layout.children(".ss-coil-linked-workflow-ribbon").remove();
	let $ribbon = $layout.children(".ss-coil-order-progress-ribbon");
	if (!$ribbon.length) {
		$ribbon = $('<div class="ss-coil-order-progress-ribbon"></div>');
		const $page = $layout.children(".form-page").first();
		$page.length ? $ribbon.insertBefore($page) : $layout.prepend($ribbon);
	}
	const render = (data = {}) => {
		if (frm.__ss_coil_order_progress_request_id !== request_id) return;
		const loading = Boolean(data.loading);
		const status = data.status || (loading ? __("Loading…") : __("No linked Sales Order"));
		const coils = data.ss_coil_docs || [];
		const process_complete = coils.length > 0 && coils.every((row) => /complete|closed/i.test(row.order_status || ""));
		const process_started = coils.some((row) => /process|partial|complete/i.test(row.order_status || ""));
		const unique = (rows, key) => [...new Map((rows || []).filter((row) => row[key]).map((row) => [row[key], { ...row, name: row[key] }])).values()];
		const stock_entries = unique(data.stock_entries, "name");
		const delivery_notes = unique(data.delivery_note_items, "delivery_note");
		const invoices = unique(data.sales_invoice_items, "sales_invoice");
		const tag_map = new Map((data.tag_trace || []).filter((row) => row.tag_no).map((row) => [row.tag_no, { ...row }]));
		const roots = new Set();
		const walk = (node) => {
			if (!node) return;
			if (node.tag_no) tag_map.set(node.tag_no, { ...(tag_map.get(node.tag_no) || {}), ...node });
			(node.children || []).forEach(walk);
		};
		(data.tag_tree || []).forEach((group) => { if (group.root_tag_no) roots.add(group.root_tag_no); walk(group.hierarchy); });
		const tag_rows = [...tag_map.values()];
		const root_count = Math.min(roots.size, tag_rows.length);
		const child_count = Math.max(tag_rows.length - root_count, 0);
		const steps = [
			[__("Sales Order"), status, data.status ? "done" : "active"],
			[__("Production"), loading ? __("Loading…") : process_complete ? __("Completed") : process_started ? __("In Progress") : __("Not Started"), process_complete ? "done" : process_started ? "active" : "waiting"],
			[__("Delivery"), loading ? __("Loading…") : `${format_number(flt(data.per_delivered))}%`, flt(data.per_delivered) >= 100 ? "done" : flt(data.per_delivered) > 0 ? "active" : "waiting"],
			[__("Billing"), loading ? __("Loading…") : `${format_number(flt(data.per_billed))}%`, flt(data.per_billed) >= 100 ? "done" : flt(data.per_billed) > 0 ? "active" : "waiting"],
		];
		const colors = { done: "#15803d", active: "#2563eb", waiting: "#94a3b8", cancelled: "#dc2626" };
		const progress = steps.map(([label, value, state], index) => {
			const color = colors[state];
			const marker = state === "done" ? "✓" : state === "cancelled" ? "!" : index + 1;
			return `${index ? '<span style="color:#94a3b8;font-size:16px;font-weight:900;">➜</span>' : ""}<div style="display:flex;align-items:center;gap:7px;flex:1 1 155px;min-width:0;padding:6px 9px;border:1px solid ${color}33;border-radius:9px;background:linear-gradient(110deg,${color}12,#fff 80%);"><span style="display:grid;place-items:center;flex:0 0 23px;height:23px;border-radius:50%;background:${color};color:#fff;font-size:11px;font-weight:900;">${marker}</span><span style="min-width:0;display:flex;flex-direction:column;line-height:1.2;"><b style="font-size:9px;letter-spacing:.045em;text-transform:uppercase;color:#64748b;">${esc(label)}</b><span style="font-size:10px;font-weight:800;color:${color};white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${esc(value)}</span></span></div>`;
		}).join("");
		const coil_counts = {};
		coils.forEach((row) => { const key = row.order_status || __("Not Started"); coil_counts[key] = (coil_counts[key] || 0) + 1; });
		const purpose_counts = {};
		stock_entries.forEach((row) => { const key = row.purpose || __("Other"); purpose_counts[key] = (purpose_counts[key] || 0) + 1; });
		const card_specs = [
			["stock_entries", __("Stock Entries"), stock_entries.length, loading ? __("Loading linked documents…") : Object.entries(purpose_counts).map(([key, count]) => `${key}: ${count}`).join(" · ") || __("No linked entries"), "#7c3aed", "stock-entry", stock_entries, stock_entries.map((row) => row.name)],
			["ss_coils", __("SS Coil Production"), coils.length, loading ? __("Loading linked documents…") : Object.entries(coil_counts).map(([key, count]) => `${key}: ${count}`).join(" · ") || __("No SS Coil records yet"), "#0891b2", "ss-coil", coils, coils.map((row) => row.name)],
			["delivery_notes", __("Delivery Notes"), delivery_notes.length, loading ? __("Loading delivery status…") : `${format_number(flt(data.per_delivered))}% ${__("delivered")}`, "#16a34a", "delivery-note", delivery_notes, delivery_notes.map((row) => row.delivery_note)],
			["invoices", __("Sales Invoices"), invoices.length, loading ? __("Loading billing status…") : `${format_number(flt(data.per_billed))}% ${__("billed")} · ${__("Billing")}: ${data.billing_status || __("Not Billed")}`, "#ea580c", "sales-invoice", invoices, invoices.map((row) => row.sales_invoice)],
			["tags", __("Tag Hierarchy"), tag_rows.length, loading ? __("Loading tag hierarchy…") : `${root_count} ${__("parent/root")} · ${child_count} ${__("child tags")}`, "#db2777", "tag-registry", tag_rows, []],
		];
		const cards_html = card_specs.map(([kind, label, count, detail, color, route, rows, names]) => {
			const links = names.slice(0, 2).map((name) => `<a href="/app/${route}/${encodeURIComponent(name)}" style="color:${color};font-size:10px;font-weight:750;text-decoration:none;white-space:nowrap;">${esc(name)}</a>`).join('<span style="color:#cbd5e1;padding:0 5px;">·</span>');
			return `<div style="min-width:0;padding:8px 10px;border:1px solid ${color}44;border-top:3px solid ${color};border-radius:10px;background:linear-gradient(145deg,${color}18,#fff 75%);box-shadow:0 2px 8px #0f172a10;"><div style="display:flex;align-items:center;justify-content:space-between;gap:7px;"><a href="/app/${route}/view/list" style="font-size:10px;font-weight:850;letter-spacing:.045em;text-transform:uppercase;color:${color};text-decoration:none;">${esc(label)} ↗</a><button type="button" data-stock-order-popup="${kind}" style="display:flex;align-items:center;gap:4px;border:0;border-radius:999px;background:${color};color:#fff;padding:3px 8px 3px 4px;font-size:9px;font-weight:800;cursor:pointer;"><span style="display:grid;place-items:center;width:22px;height:22px;border-radius:50%;background:#fff;color:${color};font-size:11px;font-weight:900;">${loading ? "…" : count}</span>${__("View all")}</button></div><div style="margin-top:4px;font-size:10px;line-height:1.3;font-weight:650;color:#334155;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${esc(detail)}</div>${links ? `<div style="display:flex;align-items:center;gap:2px;margin-top:4px;overflow:hidden;">${links}</div>` : ""}</div>`;
		}).join("");
		const order_state_color = /cancel/i.test(status) ? "#dc2626" : /deliver/i.test(status) ? "#d97706" : /closed|complete|bill/i.test(status) ? "#15803d" : "#2563eb";
		const order_indicator = `<div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;margin:0 0 7px;padding:8px 10px;border:1px solid #93c5fd;border-left:4px solid #2563eb;border-radius:9px;background:linear-gradient(100deg,#eff6ff,#fff 75%);"><div style="display:flex;align-items:center;flex-wrap:wrap;gap:7px;"><b style="font-size:9px;letter-spacing:.05em;text-transform:uppercase;color:#475569;">${__("Linked Sales Order")}</b>${sales_order ? `<a href="/app/sales-order/${encodeURIComponent(sales_order)}" style="font-size:12px;font-weight:850;color:#1d4ed8;text-decoration:none;">${esc(sales_order)} ↗</a>` : `<span style="font-size:11px;font-weight:750;color:#64748b;">${__("No linked Sales Order")}</span>`}<span style="padding:3px 8px;border-radius:999px;background:${order_state_color}18;color:${order_state_color};font-size:10px;font-weight:850;">${esc(status)}</span><span style="font-size:10px;color:#475569;">${esc(data.customer_name || data.customer || "")}</span></div><div style="display:flex;align-items:center;flex-wrap:wrap;gap:8px;font-size:10px;font-weight:700;color:#475569;"><span>${__("Delivery")}: ${loading ? "…" : `${format_number(flt(data.per_delivered))}%`}</span><span>${__("Billing")}: ${loading ? "…" : esc(data.billing_status || __("Not Billed"))}</span>${data.transaction_date ? `<span>${esc(data.transaction_date)}</span>` : ""}${sales_order ? `<button type="button" data-stock-order-detail-all style="border:0;border-radius:999px;background:#16324f;color:#fff;padding:4px 10px;font-size:9px;font-weight:850;cursor:pointer;">${__("View all")} ↗</button>` : ""}</div></div>`;
		$ribbon.html(`<div style="padding:5px 4px 8px;"><div style="display:flex;align-items:center;gap:8px;margin:0 0 6px 2px;color:#16324f;font-size:12px;font-weight:800;">${__("Order Progress")} <span style="font-size:10px;font-weight:650;color:#64748b;">· ${__("This Stock Entry")}: ${esc(local_status)}</span><span style="height:1px;flex:1;background:#dbe5ef;"></span></div>${order_indicator}<div style="display:flex;align-items:center;flex-wrap:wrap;gap:5px;margin:0 0 7px;">${progress}</div><div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(175px,1fr));gap:7px;">${cards_html}</div></div>`).show();
		$ribbon.off("click.ss_coil_stock_order_detail", "[data-stock-order-detail-all]").on("click.ss_coil_stock_order_detail", "[data-stock-order-detail-all]", function () {
			show_stock_entry_sales_order_detail(sales_order, data);
		});
		$ribbon.off("click.ss_coil_stock_order", "[data-stock-order-popup]").on("click.ss_coil_stock_order", "[data-stock-order-popup]", function () {
			const kind = $(this).attr("data-stock-order-popup");
			const spec = card_specs.find(([key]) => key === kind);
			if (!spec) return;
			const [, label, , , , route, rows] = spec;
			if (kind === "tags") {
				frappe.require("/assets/ss_coil/js/tag_hierarchy_viewer.js", () => {
					if (typeof open_ss_coil_tag_hierarchy_popup === "function") {
						open_ss_coil_tag_hierarchy_popup({ title: label, tag_groups: data.tag_tree || [], rows: tag_rows });
					}
				});
				return;
			}
			const configs = {
				stock_entries: rows.map((row) => ({ name: row.name, status: [__("Draft"), __("Submitted"), __("Cancelled")][Number(row.docstatus)] || __("Unknown"), date: row.posting_date, detail: row.purpose || "-" })),
				ss_coils: rows.map((row) => ({ name: row.name, status: row.order_status || __("Not Started"), date: row.sc_date, detail: [row.operation, row.machine, row.sales_order_item].filter(Boolean).join(" · ") || "-" })),
				delivery_notes: rows.map((row) => ({ name: row.delivery_note, status: row.status || "-", date: row.posting_date, detail: row.item_name || row.item_code || "-" })),
				invoices: rows.map((row) => ({ name: row.sales_invoice, status: row.status || "-", date: row.posting_date, detail: `${row.item_name || row.item_code || "-"} · ${__("Outstanding")}: ${format_number(row.outstanding_amount || 0)}` })),
			};
			show_stock_entry_records_dialog(label, route, configs[kind] || []);
		});
	};
	const loading = sales_order ? { status: __("Loading…"), loading: true } : {};
	render(loading);
	if (!sales_order) return;
	frappe.call({
		method: "ss_coil.api.get_sales_order_detail_dashboard",
		args: { sales_order },
		callback: (r) => render(r.message || {}),
		error: () => render({ load_error: true }),
	});
}

function show_stock_entry_sales_order_detail(sales_order, data) {
	const esc = (value) => frappe.utils.escape_html(String(value ?? "-"));
	const qty = (value) => format_number(flt(value || 0));
	const dispatch_rows = data.dispatch_summary || [];
	const coils = data.ss_coil_docs || [];
	const coils_by_item = new Map();
	const coils_by_name = new Map(coils.map((coil) => [coil.name, coil]));
	coils.forEach((coil) => {
		if (!coils_by_item.has(coil.sales_order_item)) coils_by_item.set(coil.sales_order_item, []);
		coils_by_item.get(coil.sales_order_item).push(coil);
	});
	const traces = new Map((data.tag_trace || []).filter((row) => row.tag_no).map((row) => [row.tag_no, row]));
	const order_items = new Map((data.items || []).map((item) => [item.name, item]));
	const status_summary = (records) => {
		const counts = {};
		(records || []).forEach((record) => {
			const status = record.order_status || __("Not Started");
			counts[status] = (counts[status] || 0) + 1;
		});
		return Object.entries(counts).map(([status, count]) => `${status}: ${count}`).join(" · ") || __("Not Started");
	};
	const root_for_tag = (tag) => String(tag || "").replace(/-\d+$/, "-000");
	const tag_groups = data.tag_tree || [];
	const group_has_tags = (group, tags) => {
		let found = false;
		const visit = (node) => {
			if (!node || found) return;
			if (tags.has(node.tag_no)) found = true;
			(node.children || []).forEach(visit);
		};
		visit(group.hierarchy);
		return found;
	};
	const item_sections = dispatch_rows.map((item) => {
		const production_docs = coils_by_item.get(item.sales_order_item) || [];
		const order_item = order_items.get(item.sales_order_item) || {};
		const item_tags = [...new Set([item.tag_no, ...String(item.child_tag_no || "").split(/[\n,;]+/)].map((tag) => String(tag || "").trim()).filter(Boolean))];
		const item_tag_set = new Set(item_tags);
		const roots = new Set(item_tags.map(root_for_tag));
		const groups = tag_groups.filter((group) => roots.has(group.root_tag_no) || group_has_tags(group, item_tag_set));
		return {
			item,
			name: item.item_name || item.item_code || "-",
			status: production_docs.length ? status_summary(production_docs) : order_item.custom_status || __("Not Started"),
			production: production_docs.map((doc) => `${doc.name} · ${doc.operation || ""} · ${doc.order_status || __("Not Started")}`).join("; ") || __("No SS Coil production"),
			groups,
		};
	});
	const delivered_total = dispatch_rows.reduce((sum, item) => sum + flt(item.delivered_qty), 0);
	const invoiced_total = dispatch_rows.reduce((sum, item) => sum + flt(item.invoiced_qty), 0);
	const summary = [
		[__("Sales Order"), sales_order], [__("Status"), data.status || "-"], [__("Order Qty"), qty(data.total_qty)],
		[__("Delivered Qty"), qty(delivered_total)], [__("Invoice Status"), data.billing_status || __("Not Billed")],
		[__("Invoiced Qty"), qty(invoiced_total)], [__("SS Coil Production"), `${coils.length} ${__("records")}`],
	].map(([label, value]) => `<div style="padding:8px 9px;border:1px solid #dbe5ef;border-top:3px solid #2563eb;border-radius:8px;background:#f8fbff;font-size:10px;"><div style="font-size:8px;font-weight:800;letter-spacing:.04em;text-transform:uppercase;color:#64748b;">${esc(label)}</div><div style="margin-top:3px;font-size:10px;font-weight:650;color:#1e3a5f;">${esc(value)}</div></div>`).join("");
	const table = (headers, body, width) => `<div style="max-height:34vh;overflow:auto;border:1px solid #dbe5ef;border-radius:8px;"><table class="table table-bordered" style="margin:0;min-width:${width}px;background:#fff;font-size:10px;font-weight:400;"><thead style="position:sticky;top:0;z-index:1;background:#eff6ff;font-size:9px;"><tr>${headers.map((header) => `<th style="padding:5px 6px;white-space:nowrap;">${esc(header)}</th>`).join("")}</tr></thead><tbody>${body}</tbody></table></div>`;
	const item_tables = item_sections.map((section) => {
		const item = section.item;
		const body = `<tr style="background:#eaf2ff;font-size:10px;font-weight:400;"><td style="padding:5px 6px;">${esc(item.tag_no || "-")}</td><td style="padding:5px 6px;">${esc(section.status)}</td><td style="padding:5px 6px;text-align:right;">${qty(item.ordered_qty)}</td><td style="padding:5px 6px;text-align:right;">${qty(item.delivered_qty)}</td><td style="padding:5px 6px;text-align:right;">${qty(item.invoiced_qty)}</td><td style="padding:5px 6px;">${esc(section.production)}</td></tr>`;
		return `<div style="margin:8px 0 10px;"><div style="margin:0 0 4px;color:#334155;font-size:10px;font-weight:700;">${esc(section.name)}</div>${table([__("Item Tag"), __("Production Status"), __("Order Qty"), __("Delivered"), __("Invoiced"), __("SS Coil Records / Status")], body, 820)}</div>`;
	}).join("") || `<div style="padding:20px;text-align:center;color:#64748b;font-size:10px;">${__("No Sales Order item details found.")}</div>`;
	const flatten_group = (group, item_section) => {
		const rows = [];
		const walk = (node, depth = 0) => {
			if (!node?.tag_no) return;
			const trace = traces.get(node.tag_no) || {};
			const events = trace.events || [];
			const doc_statuses = new Map();
			[...(node.previous_docs || []), ...(node.next_docs || [])].forEach((doc) => {
				if (doc.name) doc_statuses.set(doc.name, { name: doc.name, order_status: doc.order_status || coils_by_name.get(doc.name)?.order_status || __("Unknown"), operation: doc.operation || coils_by_name.get(doc.name)?.operation || "" });
			});
			events.filter((event) => /^SS Coil (Input|Output)$/.test(event.stage || "") && event.docname).forEach((event) => {
				const coil = coils_by_name.get(event.docname);
				doc_statuses.set(event.docname, { name: event.docname, order_status: coil?.order_status || doc_statuses.get(event.docname)?.order_status || __("Unknown"), operation: coil?.operation || event.extra?.operation || "" });
			});
			if (node.source_doctype === "SS Coil" && node.source_docname && !doc_statuses.has(node.source_docname)) {
				const coil = coils_by_name.get(node.source_docname);
				if (coil) doc_statuses.set(coil.name, { name: coil.name, order_status: coil.order_status || __("Unknown"), operation: coil.operation || "" });
			}
			const related_coils = [...doc_statuses.values()];
			const tag_status = trace.registry?.status || node.status || "-";
			const coil_status = related_coils.length ? status_summary(related_coils) : tag_status === "Produced" ? __("Produced") : __("No production record");
			const delivered_events = events.filter((event) => event.stage === "Delivery Note");
			const invoice_events = events.filter((event) => event.stage === "Sales Invoice");
			const is_item_tag = node.tag_no === item_section.item.tag_no;
			rows.push(`<tr style="background:${depth === 0 ? "#eaf2ff" : "#fff"};font-size:9px;font-weight:400;"><td style="padding:4px 6px;white-space:nowrap;">${depth ? `${"　".repeat(Math.min(depth, 4))}↳ ` : ""}${esc(node.tag_no)}</td><td style="padding:4px 6px;white-space:nowrap;">${esc(node.parent_tag_no || "-")}</td><td style="padding:4px 6px;">${esc(tag_status)}</td><td style="padding:4px 6px;">${esc(coil_status)}</td><td style="padding:4px 6px;">${esc(related_coils.map((doc) => `${doc.name} · ${doc.operation} · ${doc.order_status}`).join("; ") || "-")}</td><td style="padding:4px 6px;text-align:right;">${qty(is_item_tag ? item_section.item.ordered_qty : 0)}</td><td style="padding:4px 6px;text-align:right;">${qty(delivered_events.reduce((sum, event) => sum + flt(event.qty), 0))}</td><td style="padding:4px 6px;">${esc([...new Set(delivered_events.map((event) => event.docname).filter(Boolean))].join(", ") || "-")}</td><td style="padding:4px 6px;text-align:right;">${qty(invoice_events.reduce((sum, event) => sum + flt(event.qty), 0))}</td><td style="padding:4px 6px;">${esc([...new Set(invoice_events.map((event) => event.docname).filter(Boolean))].join(", ") || "-")}</td></tr>`);
			(node.children || []).forEach((child) => walk(child, depth + 1));
		};
		walk(group.hierarchy);
		return rows;
	};
	const tag_sections = item_sections.map((section) => {
		const hierarchy_rows = section.groups.flatMap((group) => flatten_group(group, section));
		const body = hierarchy_rows.length ? hierarchy_rows.join("") : `<tr style="background:#fff;font-size:9px;font-weight:400;"><td colspan="10" style="padding:12px;text-align:center;color:#64748b;">${__("No registered tag hierarchy found for this item.")}</td></tr>`;
		return `<div style="margin:8px 0 12px;"><div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin:0 0 4px;color:#334155;font-size:10px;font-weight:700;"><span>${esc(section.name)}</span><span style="font-size:9px;font-weight:400;color:#64748b;">${__("Order Qty")}: ${qty(section.item.ordered_qty)}</span></div>${table([__("Tag No"), __("Parent Tag"), __("Tag Status"), __("SS Coil Status"), __("SS Coil Production"), __("Order Qty"), __("Delivered Qty"), __("Delivery Notes"), __("Invoiced Qty"), __("Sales Invoices")], body, 1120)}</div>`;
	}).join("") || `<div style="padding:20px;text-align:center;color:#64748b;font-size:10px;">${__("No tag details found.")}</div>`;
	const dialog = new frappe.ui.Dialog({ title: `${__("Sales Order Details")}: ${sales_order}`, size: "extra-large", fields: [{ fieldtype: "HTML", fieldname: "details" }], primary_action_label: __("Close"), primary_action() { dialog.hide(); } });
	dialog.fields_dict.details.$wrapper.html(`<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:6px;margin-bottom:10px;">${summary}</div><h5 style="margin:10px 0 5px;font-size:11px;color:#334155;">${__("Sales Order Items")}</h5>${item_tables}<h5 style="margin:12px 0 5px;font-size:11px;color:#334155;">${__("Tag-wise Production and Dispatch")}</h5>${tag_sections}`);
	 dialog.show();
}
function show_stock_entry_records_dialog(title, route, rows) {
	const esc = (value) => frappe.utils.escape_html(String(value ?? "-"));
	const body = rows.length
		? rows.map((row) => `<tr><td><a href="/app/${route}/${encodeURIComponent(row.name)}" target="_blank" style="font-weight:750;">${esc(row.name)}</a></td><td>${esc(row.status)}</td><td>${esc(row.date)}</td><td>${esc(row.detail)}</td></tr>`).join("")
		: `<tr><td colspan="4" style="padding:24px;text-align:center;color:#64748b;">${__("No linked records found.")}</td></tr>`;
	const dialog = new frappe.ui.Dialog({ title, size: "large", fields: [{ fieldtype: "HTML", fieldname: "records" }], primary_action_label: __("Close"), primary_action() { dialog.hide(); } });
	dialog.fields_dict.records.$wrapper.html(`<div style="max-height:65vh;overflow:auto;border:1px solid #e2e8f0;border-radius:10px;"><table class="table table-bordered" style="margin:0;background:#fff;min-width:760px;"><thead style="position:sticky;top:0;background:#eff6ff;z-index:1;"><tr><th>${__("Document")}</th><th>${__("Status")}</th><th>${__("Date")}</th><th>${__("Details")}</th></tr></thead><tbody>${body}</tbody></table></div>`);
	dialog.show();
}

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
			async function () {
				if (frm.is_dirty()) {
					await frm.save(frm.doc.docstatus === 1 ? "Update" : "Save");
				}
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
		fields: ["custom_tag_no", "custom_ref_no", "custom_mill"],
	},
	{
		label: "Dimensions",
		fields: ["custom_thickness", "custom_width", "custom_length_c", "custom_length", "custom_dimension"],
	},
	{
		label: "References",
		fields: ["custom_condition"],
	},
	{
		label: "Specification",
		fields: ["custom_commodity", "custom_specification", "custom_estimated_wt", "custom_qty_of_coil"],
	},
	{
		label: "Processing",
		fields: ["custom_finish_good_item", "custom_slitter", "custom_leveler", "custom_reshearing", "custom_comments"],
	},
	{
		label: "JS / Location",
		fields: ["custom_js_number", "custom_location"],
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
	const requires_finish_good =
		payload.purpose === "Material Receipt" &&
		(!!payload.custom_create_tag_numbers || !!payload.custom_sales_order || !!payload.custom_linked_sales_orders);
	if (requires_finish_good) {
		const missing_rows = payload.items
			.map((row, idx) => (!row.custom_finish_good_item && row.item_code ? idx + 1 : null))
			.filter(Boolean);
		if (missing_rows.length) {
			frappe.msgprint(
				__("Select a Finish Good Item for each Material Receipt item row used for tagged coil production or Sales Order planning. Missing on row(s): {0}.", [missing_rows.join(", ")])
			);
			return;
		}
	}
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
		label: df.fieldname === "qty" || df.label === "Qty" || df.label === "Quantity" ? __("Qty (kg)") : __(df.label),
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
				`<th data-fieldname="${df.fieldname}">${df.fieldname === "qty" || df.label === "Qty" || df.label === "Quantity" ? __("Qty (kg)") : __(df.label)}${df.reqd ? '<span class="ss-coil-de-reqd">*</span>' : ""}</th>`
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
