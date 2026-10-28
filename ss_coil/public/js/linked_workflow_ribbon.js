// Compact cross-document production status for Stock Entry and SS Coil forms.
function render_linked_workflow_ribbon(frm, context) {
	if (!frm?.layout?.wrapper) return;
	const doctype = frm.doctype;
	const ribbon_class = "ss-coil-linked-workflow-ribbon";
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
	const steps = context.doctype === "Stock Entry"
		? [
			{ label: __("Sales Order"), value: sales_order_status, done: data.status && !data.loading },
			{ label: __("Stock Entry"), value: local_status, done: Number(frm.doc.docstatus) === 1 },
			{ label: __("SS Coil"), value: data.loading ? __("Loading…") : ss_coils.length ? `${ss_coils.length} ${__("records")}` : __("Not Started"), done: ss_coils.length > 0 && ss_coils.every((doc) => complete(doc.order_status)) },
			{ label: __("Delivery"), value: data.loading ? __("Loading…") : `${percent_delivered}%`, done: percent_delivered >= 100 },
			{ label: __("Billing"), value: data.loading ? __("Loading…") : `${percent_billed}%`, done: percent_billed >= 100 },
		]
		: [
			{ label: __("Sales Order"), value: sales_order_status, done: data.status && !data.loading },
			{ label: __("SS Coil"), value: local_status, done: complete(local_status) },
			{ label: __("Stock Entry"), value: data.loading ? __("Loading…") : `${stock_entries.length} ${__("records")}`, done: stock_entries.some((doc) => Number(doc.docstatus) === 1) },
			{ label: __("Delivery"), value: data.loading ? __("Loading…") : `${percent_delivered}%`, done: percent_delivered >= 100 },
			{ label: __("Billing"), value: data.loading ? __("Loading…") : `${percent_billed}%`, done: percent_billed >= 100 },
		];
	const steps_html = steps.map((step, index) => `${index ? `<span style="color:#94a3b8;font-size:14px;font-weight:900;">➜</span>` : ""}<div style="display:flex;align-items:center;gap:6px;flex:1 1 140px;min-width:0;padding:5px 7px;border:1px solid ${step.done ? "#86efac" : "#dbe5ef"};border-radius:8px;background:${step.done ? "#f0fdf4" : "#f8fafc"};"><span style="display:grid;place-items:center;flex:0 0 21px;width:21px;height:21px;border-radius:50%;background:${step.done ? "#16a34a" : "#94a3b8"};color:white;font-size:10px;font-weight:900;">${step.done ? "✓" : index + 1}</span><span style="min-width:0;display:flex;flex-direction:column;line-height:1.15;"><b style="font-size:9px;color:#64748b;text-transform:uppercase;">${esc(step.label)}</b><span title="${esc(step.value)}" style="font-size:10px;font-weight:750;color:#334155;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(step.value)}</span></span></div>`).join("");
	const route_map = { stock_entries: [__("Stock Entries"), "stock-entry", stock_entries], ss_coils: [__("SS Coil Records"), "ss-coil", ss_coils], delivery_notes: [__("Delivery Notes"), "delivery-note", delivery_notes], invoices: [__("Sales Invoices"), "sales-invoice", invoices], tags: [__("Tag Hierarchy"), "tag-registry", tag_rows.map((tag) => ({ ...tag, name: tag.tag_no }))] };
	const detail_map = {
		stock_entries: stock_entries.map((d) => d.purpose || __("Stock movement")).filter(Boolean),
		ss_coils: ss_coils.map((d) => d.order_status || __("Not Started")),
		delivery_notes: [data.loading ? __("Loading delivery status…") : `${percent_delivered}% ${__("delivered")}`],
		invoices: [data.loading ? __("Loading billing status…") : `${percent_billed}% ${__("billed")}`],
		tags: [`${tag_rows.length} ${__("parent and child tags")}`],
	};
	const cards_html = Object.entries(route_map).map(([kind, [label, route, rows]]) => {
		const color = { stock_entries: "#7c3aed", ss_coils: "#0891b2", delivery_notes: "#16a34a", invoices: "#ea580c", tags: "#db2777" }[kind];
		const links = kind !== "tags" ? rows.slice(0, 2).map((row) => `<a href="/app/${route}/${encodeURIComponent(row.name)}" style="color:${color};font-size:10px;font-weight:700;text-decoration:none;">${esc(row.name)}</a>`).join('<span style="color:#cbd5e1;padding:0 4px;">·</span>') : "";
		return `<div style="min-width:0;padding:7px 9px;border:1px solid ${color}44;border-top:3px solid ${color};border-radius:9px;background:linear-gradient(145deg,${color}14,#fff 75%);"><div style="display:flex;justify-content:space-between;align-items:center;gap:5px;"><a href="/app/${route}/view/list" style="color:${color};font-size:9px;font-weight:850;text-transform:uppercase;text-decoration:none;">${esc(label)} ↗</a><button type="button" data-linked-workflow-popup="${kind}" style="display:flex;align-items:center;gap:4px;border:0;border-radius:999px;background:${color};color:white;padding:2px 7px 2px 3px;font-size:9px;font-weight:800;cursor:pointer;"><span style="display:grid;place-items:center;width:19px;height:19px;border-radius:50%;background:white;color:${color};font-size:10px;">${data.loading ? "…" : rows.length}</span>${__("View all")}</button></div><div title="${esc((detail_map[kind] || []).join(" · ") || __("No linked records"))}" style="margin-top:4px;color:#475569;font-size:10px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${esc((detail_map[kind] || []).slice(0, 2).join(" · ") || (data.loading ? __("Loading…") : __("No linked records")))}</div>${links ? `<div style="margin-top:3px;display:flex;gap:2px;overflow:hidden;white-space:nowrap;">${links}</div>` : ""}</div>`;
	}).join("");
	const html = `<div style="padding:5px 4px 8px;"><div style="display:flex;align-items:center;gap:8px;margin:0 0 6px 2px;color:#16324f;font-size:12px;font-weight:800;">${__("Order Progress")}<span style="height:1px;flex:1;background:#dbe5ef;"></span></div><div style="display:flex;align-items:center;flex-wrap:wrap;gap:5px;margin-bottom:7px;">${steps_html}</div><div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:6px;">${cards_html}</div></div>`;
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
			status: kind === "stock_entries" ? [__("Draft"), __("Submitted"), __("Cancelled")][Number(row.docstatus)] || __("Unknown") : kind === "ss_coils" ? row.order_status || __("Not Started") : kind === "tags" ? row.registry?.status || row.status || "-" : row.status || "-",
			date: row.posting_date || row.sc_date || "-",
			detail: row.purpose || row.operation || row.item_name || row.item_code || row.root_tag_no || "-",
		}));
		const table = row_data.length ? row_data.map((row) => `<tr><td>${kind === "tags" ? esc(row.name) : `<a href="/app/${route}/${encodeURIComponent(row.name)}" target="_blank">${esc(row.name)}</a>`}</td><td>${esc(row.status)}</td><td>${esc(row.date)}</td><td>${esc(row.detail)}</td></tr>`).join("") : `<tr><td colspan="4" style="padding:22px;text-align:center;color:#64748b;">${__("No linked records found.")}</td></tr>`;
		const dialog = new frappe.ui.Dialog({ title: label, size: "large", fields: [{ fieldtype: "HTML", fieldname: "records" }], primary_action_label: __("Close"), primary_action() { dialog.hide(); } });
		dialog.fields_dict.records.$wrapper.html(`<div style="max-height:65vh;overflow:auto;border:1px solid #e2e8f0;border-radius:9px;"><table class="table table-bordered" style="margin:0;min-width:600px;background:#fff;"><thead style="background:#eff6ff;"><tr><th>${__("Document")}</th><th>${__("Status")}</th><th>${__("Date")}</th><th>${__("Details")}</th></tr></thead><tbody>${table}</tbody></table></div>`);
		dialog.show();
	});
}

frappe.ui.form.on("Stock Entry", {
	refresh(frm) {
		render_linked_workflow_ribbon(frm, { doctype: "Stock Entry", name: frm.doc.name });
	},
});

frappe.ui.form.on("SS Coil", {
	refresh(frm) {
		render_linked_workflow_ribbon(frm, { doctype: "SS Coil", name: frm.doc.name });
	},
});
