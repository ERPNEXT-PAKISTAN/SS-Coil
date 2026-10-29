// Compact cross-document production status for Stock Entry and SS Coil forms.
function render_linked_workflow_ribbon(frm, context) {
	if (!frm?.layout?.wrapper) return;
	const doctype = frm.doctype;
	// Use the same ribbon container as Sales Order so both forms share the same
	// Order Progress presentation and do not leave behind the older compact UI.
	const ribbon_class = "ss-coil-order-progress-ribbon";
	frm.layout.wrapper.children(".ss-coil-linked-workflow-ribbon").remove();
	if (frm.is_new?.()) {
		frm.layout.wrapper.children(`.${ribbon_class}`).remove();
		return;
	}
	const request_id = (frm.__ss_coil_workflow_request_id || 0) + 1;
	frm.__ss_coil_workflow_request_id = request_id;
	const linked_orders = String(frm.doc.custom_linked_sales_orders || "")
		.split(/[\n,]+/).map((name) => name.trim()).filter(Boolean);
	const sales_order = doctype === "SS Coil"
		? frm.doc.order_no
		: frm.doc.custom_sales_order || linked_orders[0];
	const local_status = doctype === "Stock Entry"
		? [__("Draft"), __("Submitted"), __("Cancelled")][Number(frm.doc.docstatus)] || __("Unknown")
		: frm.doc.order_status || __("Not Started");
	const loading_data = { status: sales_order ? __("Loading…") : __("No linked Sales Order"), loading: true };
	render_linked_workflow_ribbon_html(frm, context, loading_data, local_status, ribbon_class);
	if (!sales_order) {
		render_linked_workflow_ribbon_html(frm, context, { loading: false }, local_status, ribbon_class);
		return;
	}
	frappe.call({
		method: "ss_coil.api.get_sales_order_detail_dashboard",
		args: { sales_order },
		callback: (r) => {
			if (frm.__ss_coil_workflow_request_id !== request_id || frm.doc.name !== context.name) return;
			render_linked_workflow_ribbon_html(frm, context, r.message || {}, local_status, ribbon_class);
		},
		error: () => {
			if (frm.__ss_coil_workflow_request_id !== request_id) return;
			render_linked_workflow_ribbon_html(frm, context, { loading: false, load_error: true }, local_status, ribbon_class);
		},
	});
}

function render_linked_workflow_ribbon_html(frm, context, data, local_status, ribbon_class) {
	try {
		render_linked_workflow_ribbon_html_content(frm, context, data, local_status, ribbon_class);
	} catch (error) {
		console.error("SS Coil Order Progress ribbon failed to render", error);
		const esc = (value) => frappe.utils.escape_html(String(value ?? "-"));
		const order = context.doctype === "Stock Entry"
			? frm.doc.custom_sales_order || String(frm.doc.custom_linked_sales_orders || "").split(/[\n,]+/).map((name) => name.trim()).find(Boolean)
			: frm.doc.order_no;
		const order_status = data.status || (data.loading ? __("Loading…") : __("No linked Sales Order"));
		const order_step = order
			? `<a href="/app/sales-order/${encodeURIComponent(order)}" style="font-weight:800;color:#2563eb;text-decoration:none;">${esc(order)} · ${esc(order_status)}</a>`
			: `<span style="font-weight:800;color:#64748b;">${esc(order_status)}</span>`;
		const local_step = context.doctype === "Stock Entry"
			? `<span style="margin-left:12px;font-weight:800;color:#475569;">${esc(__("Stock Entry"))}: ${esc(local_status)}</span>`
			: "";
		const $layout = frm.layout?.wrapper;
		if (!$layout) return;
		let $ribbon = $layout.children(`.${ribbon_class}`);
		if (!$ribbon.length) {
			$ribbon = $(`<div class="${ribbon_class}"></div>`);
			const $page = $layout.children(".form-page").first();
			$page.length ? $ribbon.insertBefore($page) : $layout.append($ribbon);
		}
		$ribbon.html(`<div style="padding:8px 10px;border:1px solid #dbe5ef;border-radius:9px;background:#f8fbff;"><b style="margin-right:10px;color:#16324f;">${__("Order Progress")}</b>${order_step}${local_step}</div>`).show();
	}
}

function render_linked_workflow_ribbon_html_content(frm, context, data, local_status, ribbon_class) {
	const esc = (value) => frappe.utils.escape_html(String(value ?? "-"));
	const unique = (rows, key) => [...new Map((rows || []).filter((row) => row[key]).map((row) => [row[key], { ...row, name: row[key] }])).values()];
	const stock_entries = unique(data.stock_entries, "name");
	const ss_coils = unique(data.ss_coil_docs, "name");
	const delivery_notes = unique(data.delivery_note_items, "delivery_note");
	const invoices = unique(data.sales_invoice_items, "sales_invoice");
	const tag_rows = (data.tag_trace || []).filter((row) => row.tag_no);
	const sales_order_status = data.status || (data.loading ? __("Loading…") : __("No linked Sales Order"));
	const percent_delivered = flt(data.per_delivered);
	const percent_billed = flt(data.per_billed);
	const complete = (value) => /complete|closed|submitted/i.test(value || "");
	const process_statuses = new Map();
	const order_status_counts = new Map();
	ss_coils.forEach((doc) => {
		const process = doc.operation || __("Other Process");
		const status = doc.order_status || __("Not Started");
		order_status_counts.set(status, (order_status_counts.get(status) || 0) + 1);
		if (!process_statuses.has(process)) process_statuses.set(process, new Map());
		const counts = process_statuses.get(process);
		counts.set(status, (counts.get(status) || 0) + 1);
	});
	const status_order = [__("Not Started"), __("In Process"), __("Partially Completed"), __("Stopped"), __("Completed"), __("Closed")];
	const status_totals = [...order_status_counts.entries()].sort((a, b) => {
		const ai = status_order.indexOf(a[0]);
		const bi = status_order.indexOf(b[0]);
		return (ai < 0 ? status_order.length : ai) - (bi < 0 ? status_order.length : bi) || a[0].localeCompare(b[0]);
	});
	const process_summary = data.loading
		? __("Loading process statuses…")
		: ss_coils.length
			? `${ss_coils.length} ${__("entries")}: ${status_totals.map(([status, count]) => `${count}-${status}`).join(" · ")}`
			: __("No process entries yet");
	const operation_summary = [...process_statuses.entries()].map(([process, statuses]) => `${process}: ${[...statuses.entries()].map(([status, count]) => `${count}-${status}`).join(", ")}`).join(" · ");
	const process_complete = ss_coils.length > 0 && ss_coils.every((doc) => complete(doc.order_status));
	const process_started = ss_coils.some((doc) => /process|partial|complete/i.test(doc.order_status || ""));
	const steps = context.doctype === "Stock Entry"
		? [
			{ label: __("Sales Order"), value: sales_order_status, state: Number(frm.doc.docstatus) === 2 ? "cancelled" : data.status && !data.loading ? "done" : "active" },
			{ label: __("Production"), value: data.loading ? __("Loading…") : process_complete ? __("Completed") : process_started ? __("In Progress") : __("Not Started"), state: process_complete ? "done" : process_started ? "active" : "waiting" },
			{ label: __("Delivery"), value: data.loading ? __("Loading…") : `${format_number(percent_delivered)}%`, state: percent_delivered >= 100 ? "done" : percent_delivered > 0 ? "active" : "waiting" },
			{ label: __("Billing"), value: data.loading ? __("Loading…") : `${format_number(percent_billed)}%`, state: percent_billed >= 100 ? "done" : percent_billed > 0 ? "active" : "waiting" },
		]
		: [
			{ label: __("Sales Order"), value: sales_order_status, done: data.status && !data.loading },
			{ label: __("All Order Processes"), value: process_summary, done: process_complete, active: process_started, multiline: true },
			{ label: __("Stock Entry"), value: data.loading ? __("Loading…") : `${stock_entries.length} ${__("records")}`, done: stock_entries.some((doc) => Number(doc.docstatus) === 1) },
			{ label: __("Delivery"), value: data.loading ? __("Loading…") : `${percent_delivered}%`, done: percent_delivered >= 100 },
			{ label: __("Billing"), value: data.loading ? __("Loading…") : `${percent_billed}%`, done: percent_billed >= 100 },
		];
	const steps_html = steps.map((step, index) => {
		const state = step.state || (step.done ? "done" : step.active ? "active" : "waiting");
		const color = state === "done" ? "#15803d" : state === "cancelled" ? "#dc2626" : state === "active" ? "#2563eb" : "#94a3b8";
		const marker = state === "done" ? "✓" : state === "cancelled" ? "!" : index + 1;
		return `${index ? `<span aria-hidden="true" style="color:#94a3b8;font-size:16px;font-weight:900;padding:0 2px;">➜</span>` : ""}<div style="display:flex;align-items:center;gap:7px;flex:1 1 155px;min-width:0;padding:6px 9px;border:1px solid ${color}33;border-radius:9px;background:linear-gradient(110deg,${color}12,#fff 80%);"><span style="display:grid;place-items:center;flex:0 0 23px;width:23px;height:23px;border-radius:50%;background:${color};color:#fff;font-size:11px;font-weight:900;">${marker}</span><span style="min-width:0;display:flex;flex-direction:column;line-height:1.2;"><b style="font-size:9px;letter-spacing:.045em;text-transform:uppercase;color:#64748b;">${esc(step.label)}</b><span title="${esc(step.value)}" style="font-size:10px;font-weight:800;color:${color};white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${esc(step.value)}</span></span></div>`;
	}).join("");
	const route_map = { stock_entries: [__("Stock Entries"), "stock-entry", stock_entries], ss_coils: [__("SS Coil Records"), "ss-coil", ss_coils], delivery_notes: [__("Delivery Notes"), "delivery-note", delivery_notes], invoices: [__("Sales Invoices"), "sales-invoice", invoices], tags: [__("Tag Hierarchy"), "tag-registry", tag_rows.map((tag) => ({ ...tag, name: tag.tag_no }))] };
	const detail_map = {
		stock_entries: stock_entries.map((d) => d.purpose || __("Stock movement")).filter(Boolean),
		ss_coils: context.doctype === "SS Coil" ? [`${__("This Entry")}: ${local_status}`, process_summary] : [process_summary],
		delivery_notes: [data.loading ? __("Loading delivery status…") : `${percent_delivered}% ${__("delivered")}`],
		invoices: [data.loading ? __("Loading billing status…") : `${percent_billed}% ${__("billed")}`],
		tags: [`${tag_rows.length} ${__("parent and child tags")}`],
	};
	if (context.doctype === "Stock Entry") {
		const order_rows = sales_order
			? [{ name: sales_order, status: sales_order_status, transaction_date: data.transaction_date, customer_name: data.customer_name }]
			: [];
		// Reuse the established linked-record card and replace only its target.
		route_map.stock_entries = [__("Sales Order"), "sales-order", order_rows];
		detail_map.stock_entries = [sales_order_status, data.customer_name || data.customer].filter(Boolean);
	}
	const cards_html = Object.entries(route_map).map(([kind, [label, route, rows]]) => {
		const color = { stock_entries: "#7c3aed", ss_coils: "#0891b2", delivery_notes: "#16a34a", invoices: "#ea580c", tags: "#db2777" }[kind];
		const links = kind !== "tags" ? rows.slice(0, 2).map((row) => `<a href="/app/${route}/${encodeURIComponent(row.name)}" style="color:${color};font-size:10px;font-weight:700;text-decoration:none;">${esc(row.name)}</a>`).join('<span style="color:#cbd5e1;padding:0 4px;">·</span>') : "";
		const detail_title = [detail_map[kind] || [], operation_summary].flat().filter(Boolean).join(" · ") || __("No linked records");
		const details_html = kind === "ss_coils"
			? `<div title="${esc(detail_title)}" style="margin-top:4px;display:flex;flex-wrap:wrap;gap:3px;">${data.loading ? `<span style="color:#64748b;font-size:10px;">${__("Loading statuses…")}</span>` : status_totals.length ? status_totals.map(([status, count]) => {
				const status_color = /complete|closed/i.test(status) ? "#15803d" : /process|partial/i.test(status) ? "#1d4ed8" : /stop|cancel/i.test(status) ? "#dc2626" : "#64748b";
				return `<span style="padding:2px 5px;border-radius:999px;background:${status_color}14;color:${status_color};font-size:9px;font-weight:800;white-space:nowrap;">${count}-${esc(status)}</span>`;
			}).join("") : `<span style="color:#64748b;font-size:10px;">${__("No process entries yet")}</span>`}</div><div title="${esc(local_status)}" style="margin-top:3px;color:#475569;font-size:9px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${context.doctype === "SS Coil" ? `${__("This entry")}: ${esc(local_status)}` : __("Status grouped across all processes")}</div>`
			: `<div title="${esc(detail_title)}" style="margin-top:4px;color:#475569;font-size:10px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${esc((detail_map[kind] || []).slice(0, 2).join(" · ") || (data.loading ? __("Loading…") : __("No linked records")))}</div>`;
		return `<div style="min-width:0;padding:7px 9px;border:1px solid ${color}44;border-top:3px solid ${color};border-radius:9px;background:linear-gradient(145deg,${color}14,#fff 75%);"><div style="display:flex;justify-content:space-between;align-items:center;gap:5px;"><a href="/app/${route}/view/list" style="color:${color};font-size:9px;font-weight:850;text-transform:uppercase;text-decoration:none;">${esc(label)} ↗</a><button type="button" data-linked-workflow-popup="${kind}" style="display:flex;align-items:center;gap:4px;border:0;border-radius:999px;background:${color};color:white;padding:2px 7px 2px 3px;font-size:9px;font-weight:800;cursor:pointer;"><span style="display:grid;place-items:center;width:19px;height:19px;border-radius:50%;background:white;color:${color};font-size:10px;">${data.loading ? "…" : rows.length}</span>${__("View all")}</button></div>${details_html}${links ? `<div style="margin-top:3px;display:flex;gap:2px;overflow:hidden;white-space:nowrap;">${links}</div>` : ""}</div>`;
	}).join("");
	const html = `<div id="ss-coil-so-status-ribbon" style="padding:5px 4px 8px;"><div style="display:flex;align-items:center;gap:8px;margin:0 0 6px 2px;color:#16324f;font-size:12px;font-weight:800;">${__("Order Progress")}<span style="height:1px;flex:1;background:#dbe5ef;"></span></div><div style="display:flex;align-items:center;flex-wrap:wrap;gap:5px;margin:0 0 7px;">${steps_html}</div><div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(175px,1fr));gap:7px;">${cards_html}</div>${context.doctype === "Stock Entry" ? `<div style="margin-top:5px;text-align:right;font-size:10px;font-weight:700;color:#475569;">${__("This Stock Entry")}: ${esc(local_status)}</div>` : ""}</div>`;
	const $layout = frm.layout.wrapper;
	let $ribbon = $layout.children(`.${ribbon_class}`);
	if (!$ribbon.length) {
		$ribbon = $(`<div class="${ribbon_class}"></div>`);
		const $page = $layout.children(".form-page").first();
		$page.length ? $ribbon.insertBefore($page) : $layout.append($ribbon);
	}
	$ribbon.html(html).show();
	$ribbon.off("click.ss_coil_linked_workflow", "[data-linked-workflow-popup]").on("click.ss_coil_linked_workflow", "[data-linked-workflow-popup]", function () {
		const kind = $(this).attr("data-linked-workflow-popup");
		const config = route_map[kind];
		if (!config) return;
		const [label, route, rows] = config;
		if (kind === "tags") {
			const render_node = (node, depth = 0) => {
				if (!node?.tag_no) return "";
				const accent = depth === 0 ? "#1d4ed8" : depth === 1 ? "#0891b2" : "#7c3aed";
				const children = (node.children || []).map((child) => render_node(child, depth + 1)).join("");
				return `<div style="width:100%;min-width:0;"><details open style="width:100%;border:1px solid ${accent}55;border-top:3px solid ${accent};border-radius:10px;background:#fff;overflow:hidden;"><summary style="list-style:none;cursor:pointer;padding:8px 10px;background:linear-gradient(120deg,${accent}18,#fff);display:flex;justify-content:space-between;gap:8px;"><b style="font-size:11px;color:${accent};">${esc(node.tag_no)}</b><span style="font-size:9px;font-weight:800;color:${accent};">${esc(node.status || "Active")}</span></summary><div style="padding:6px 10px;font-size:10px;color:#475569;">${esc(node.item_name || node.item_code || "")}${node.current_docname ? ` · ${esc([node.current_doctype, node.current_docname].filter(Boolean).join(" / "))}` : ""}</div>${children ? `<div style="text-align:center;color:${accent};font-weight:900;">↓</div><div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(min(190px,100%),1fr));gap:9px;border-top:1px solid #e2e8f0;padding:9px;">${children}</div>` : ""}</details></div>`;
			};
			const groups = (data.tag_tree || []).map((group) => group.hierarchy).filter((node) => node?.tag_no);
			const chart = groups.length ? groups.map((root) => render_node(root)).join("") : `<div style="padding:22px;text-align:center;color:#64748b;">${__("No tag hierarchy found.")}</div>`;
			const dialog = new frappe.ui.Dialog({ title: label, size: "large", fields: [{ fieldtype: "HTML", fieldname: "records" }], primary_action_label: __("Close"), primary_action() { dialog.hide(); } });
			dialog.fields_dict.records.$wrapper.html(`<div style="max-height:68vh;overflow:auto;padding:8px;border:1px solid #dbe5ef;border-radius:10px;background:#f8fbff;"><div style="display:grid;gap:12px;width:100%;">${chart}</div></div>`);
			dialog.show();
			return;
		}
		const row_data = rows.map((row) => ({
			name: row.name,
			status: kind === "stock_entries"
				? context.doctype === "Stock Entry"
					? row.status || __("Unknown")
					: [__("Draft"), __("Submitted"), __("Cancelled")][Number(row.docstatus)] || __("Unknown")
				: kind === "ss_coils"
					? row.order_status || __("Not Started")
					: kind === "tags"
						? row.registry?.status || row.status || "-"
						: row.status || "-",
			date: row.posting_date || row.sc_date || row.transaction_date || "-",
			detail: row.purpose || row.operation || row.customer_name || row.item_name || row.item_code || row.root_tag_no || "-",
		}));
		const table = row_data.length ? row_data.map((row) => `<tr><td>${kind === "tags" ? esc(row.name) : `<a href="/app/${route}/${encodeURIComponent(row.name)}" target="_blank">${esc(row.name)}</a>`}</td><td>${esc(row.status)}</td><td>${esc(row.date)}</td><td>${esc(row.detail)}</td></tr>`).join("") : `<tr><td colspan="4" style="padding:22px;text-align:center;color:#64748b;">${__("No linked records found.")}</td></tr>`;
		const dialog = new frappe.ui.Dialog({ title: label, size: "large", fields: [{ fieldtype: "HTML", fieldname: "records" }], primary_action_label: __("Close"), primary_action() { dialog.hide(); } });
		dialog.fields_dict.records.$wrapper.html(`<div style="max-height:65vh;overflow:auto;border:1px solid #e2e8f0;border-radius:9px;"><table class="table table-bordered" style="margin:0;min-width:600px;background:#fff;"><thead style="background:#eff6ff;"><tr><th>${__("Document")}</th><th>${__("Status")}</th><th>${__("Date")}</th><th>${__("Details")}</th></tr></thead><tbody>${table}</tbody></table></div>`);
		dialog.show();
	});
}

frappe.ui.form.on("SS Coil", {
	refresh(frm) {
		render_linked_workflow_ribbon(frm, { doctype: "SS Coil", name: frm.doc.name });
	},
});
