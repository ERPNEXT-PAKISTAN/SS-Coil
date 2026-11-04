// Compact linked Sales Order card shared by Sales Order and SS Coil forms.
function render_linked_sales_order_card(frm) {
	const $layout = frm.layout?.wrapper;
	if (!$layout?.length) return;
	$layout.children(".ss-coil-linked-sales-order-card").remove();
	if (frm.is_new?.()) return;
	const doctype = frm.doctype;
	const sales_order = doctype === "Sales Order" ? frm.doc.name : frm.doc.order_no;
	if (!sales_order) return;
	const request_id = (frm.__ss_coil_linked_sales_order_card_request || 0) + 1;
	frm.__ss_coil_linked_sales_order_card_request = request_id;
	const esc = (value) => frappe.utils.escape_html(String(value ?? "-"));
	let $card = $('<div class="ss-coil-linked-sales-order-card"></div>');
	const $page = $layout.children(".form-page").first();
	$page.length ? $card.insertBefore($page) : $layout.prepend($card);
	$card.html(`<div style="padding:8px 10px;border:1px solid #93c5fd;border-left:4px solid #2563eb;border-radius:9px;background:linear-gradient(100deg,#eff6ff,#fff 75%);color:#475569;font-size:10px;font-weight:700;">${__("Linked Sales Order")} · ${esc(sales_order)} · ${__("Loading…")}</div>`);
	frappe.call({
		method: "ss_coil.api.get_sales_order_detail_dashboard",
		args: { sales_order },
		callback(r) {
			if (frm.__ss_coil_linked_sales_order_card_request !== request_id || frm.doc.name !== (doctype === "Sales Order" ? sales_order : frm.doc.name)) return;
			const data = r.message || {};
			const status = data.status || __("Unknown");
			const color = /cancel/i.test(status) ? "#dc2626" : /deliver/i.test(status) ? "#d97706" : /closed|complete|bill/i.test(status) ? "#15803d" : "#2563eb";
			const customer = data.customer_name || data.customer || "";
			const date = data.transaction_date || "";
			$card.html(`<div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;margin:0 0 7px;padding:8px 10px;border:1px solid #93c5fd;border-left:4px solid #2563eb;border-radius:9px;background:linear-gradient(100deg,#eff6ff,#fff 75%);"><div style="display:flex;align-items:center;flex-wrap:wrap;gap:7px;"><b style="font-size:9px;letter-spacing:.05em;text-transform:uppercase;color:#475569;">${__("Linked Sales Order")}</b><a href="/app/sales-order/${encodeURIComponent(sales_order)}" style="font-size:12px;font-weight:850;color:#1d4ed8;text-decoration:none;">${esc(sales_order)} ↗</a><span style="padding:3px 8px;border-radius:999px;background:${color}18;color:${color};font-size:10px;font-weight:850;">${esc(status)}</span><span style="font-size:10px;color:#475569;">${esc(customer)}</span></div><div style="display:flex;align-items:center;flex-wrap:wrap;gap:8px;font-size:10px;font-weight:700;color:#475569;"><span>${__("Delivery")}: ${format_number(flt(data.per_delivered))}%</span><span>${__("Billing")}: ${esc(data.billing_status || __("Not Billed"))}</span>${date ? `<span>${esc(date)}</span>` : ""}<button type="button" data-linked-so-view style="border:0;border-radius:999px;background:#16324f;color:#fff;padding:4px 10px;font-size:9px;font-weight:850;cursor:pointer;">${__("View all")} ↗</button><button type="button" data-linked-so-delivery style="border:0;border-radius:999px;background:#15803d;color:#fff;padding:4px 10px;font-size:9px;font-weight:850;cursor:pointer;">${__("Create Delivery Note by Tag")}</button></div></div>`);
			$card.off("click.ss_coil_linked_so").on("click.ss_coil_linked_so", "[data-linked-so-view]", () => frappe.set_route("Form", "Sales Order", sales_order));
			$card.on("click.ss_coil_linked_so", "[data-linked-so-delivery]", () => {
				const open = () => ss_coil.delivery_by_tag?.open?.(sales_order);
				if (ss_coil.delivery_by_tag?.open) open();
				else frappe.require("/assets/ss_coil/js/delivery_by_tag.js", open);
			});
		},
		error() {
			if (frm.__ss_coil_linked_sales_order_card_request === request_id) $card.remove();
		},
	});
}

frappe.ui.form.on("Sales Order", { refresh(frm) { render_linked_sales_order_card(frm); } });
frappe.ui.form.on("SS Coil", { refresh(frm) { render_linked_sales_order_card(frm); } });
