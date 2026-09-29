frappe.provide("ss_coil.prints");

// Custom print actions shared by the document form and the SS Coil Flow page.
// Labels match the layouts already used on Stock Entry: tag stickers and Delivery Advise.
ss_coil.prints.ACTIONS = {
	"Stock Entry": [
		{ id: "tag_print", label: __("Tag Print") },
		{ id: "delivery_advise", label: __("Delivery Advise"), format: "Stock Entry Coil" },
		{ id: "coil_detail", label: __("Coil Detail"), format: "Stock Entry Coil Detail" },
	],
	"Sales Order": [
		{ id: "delivery_advise", label: __("Delivery Advise"), format: "Sales Order Coil" },
		{ id: "coil_detail", label: __("Coil Detail"), format: "Sales Order Coil Detail" },
		{ id: "job_sheet", label: __("Job Sheet") },
		{ id: "sales_contract", label: __("Sales Contract"), format: "Sales Contract" },
		{
			id: "sales_contract_plain",
			label: __("Sales Contract (No Letterhead)"),
			format: "Sales Contract No Letterhead",
		},
		{ id: "ss_sales_order", label: __("SS Sales Order"), format: "SS Sales Order" },
	],
	"SS Coil": [
		{ id: "tag_print", label: __("Tag Print") },
		{ id: "coil_detail", label: __("Coil Detail"), format: "SS Coil Detail" },
		{ id: "job_sheet", label: __("Job Sheet"), format: "SS Coil Job Sheet" },
	],
};

ss_coil.prints.actions_for = function (doctype) {
	return ss_coil.prints.ACTIONS[doctype] || [];
};

ss_coil.prints.is_saved = function (doc) {
	return doc && doc.name && !doc.__islocal;
};

ss_coil.prints.add_form_buttons = function (frm) {
	if (!frm || !ss_coil.prints.is_saved(frm.doc) || (frm.is_new && frm.is_new())) {
		return;
	}
	ss_coil.prints.actions_for(frm.doctype).forEach((action) => {
		if (frm.remove_custom_button) {
			frm.remove_custom_button(action.label, __("Print"));
		}
		frm.add_custom_button(
			action.label,
			() => ss_coil.prints.open(frm.doctype, frm.doc.name, action.id),
			__("Print")
		);
	});
};

ss_coil.prints.open = function (doctype, name, action_id) {
	if (!doctype || !name) {
		frappe.msgprint(__("Save the document before printing."));
		return;
	}
	const action = ss_coil.prints.actions_for(doctype).find((row) => row.id === action_id);
	if (!action) {
		frappe.msgprint(__("This print is not available for {0}.", [doctype]));
		return;
	}
	if (action.id === "tag_print") {
		ss_coil.prints.open_tag_print(doctype, name);
		return;
	}
	if (action.id === "job_sheet" && doctype === "Sales Order") {
		ss_coil.prints.open_sales_order_job_sheet(name);
		return;
	}
	ss_coil.prints.open_printview(doctype, name, action.format);
};

ss_coil.prints.open_printview = function (doctype, name, format, options) {
	options = options || {};
	const url = frappe.urllib.get_full_url(
		"/printview?doctype=" +
			encodeURIComponent(doctype) +
			"&name=" +
			encodeURIComponent(name) +
			"&format=" +
			encodeURIComponent(format) +
			"&no_letterhead=1" +
			(options.trigger_print ? "&trigger_print=1" : "") +
			(options.settings ? "&settings=" + encodeURIComponent(options.settings) : "") +
			"&_=" +
			Date.now()
	);
	const print_window = window.open(url, "_blank");
	if (!print_window) {
		frappe.msgprint({
			title: __("Pop-up Blocked"),
			message: __("Please allow pop-ups for this site, then print again."),
			indicator: "orange",
		});
		return null;
	}
	try {
		print_window.focus();
	} catch (e) {
		// ignore cross-window focus errors
	}
	return print_window;
};

ss_coil.prints.open_tag_print = function (doctype, name) {
	const launch = (doc) => {
		const frm = { doctype: doctype, doc: doc, is_new: () => false };
		if (doctype === "Stock Entry") {
			const run = () => show_stock_entry_sticker_print_dialog(frm);
			if (typeof show_stock_entry_sticker_print_dialog === "function") {
				run();
				return;
			}
			frappe.require("/assets/ss_coil/js/stock_entry.js", run);
			return;
		}
		if (doctype === "SS Coil") {
			const run = () => show_ss_coil_sticker_print_dialog(frm);
			if (typeof show_ss_coil_sticker_print_dialog === "function") {
				run();
				return;
			}
			frappe.require("/assets/ss_coil/js/ss_coil_sticker_print.js", run);
		}
	};

	frappe.model.with_doc(doctype, name, () => {
		const doc = frappe.get_doc(doctype, name);
		if (!doc) {
			frappe.msgprint(__("Could not load {0} {1} for printing.", [doctype, name]));
			return;
		}
		launch(doc);
	});
};

ss_coil.prints.open_sales_order_job_sheet = function (name) {
	frappe.call({
		method: "ss_coil.sales_order_job_sheet_print.get_sales_order_job_sheet_html",
		args: { sales_order: name },
		freeze: true,
		freeze_message: __("Preparing job sheet..."),
		callback(r) {
			const win = window.open("");
			if (!win) {
				frappe.msgprint(__("Please enable pop-ups to print the job sheet."));
				return;
			}
			const css = frappe.urllib.get_full_url("/assets/ss_coil/css/job_sheet_report.css");
			win.document.write(
				`<!DOCTYPE html><html><head><meta charset="utf-8"><title>${frappe.utils.escape_html(
					name
				)}</title>` +
					`<link rel="stylesheet" href="${css}">` +
					`<style>@page{size:A4 landscape;margin:8mm;} body{margin:0;padding:12px;}</style></head><body>${
						r.message || ""
					}</body></html>`
			);
			win.document.close();
		},
	});
};
