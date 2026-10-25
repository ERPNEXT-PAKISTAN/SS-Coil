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
		{ id: "inspection_1", label: __("Slitter Insp"), format: "SS Coil Inspection 1" },
		{ id: "inspection_2", label: __("Leveler Insp"), format: "SS Coil Inspection 2" },
		{ id: "inspection_3", label: __("Reshearing Insp"), format: "SS Coil Inspection 3" },
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
			frm.remove_custom_button(action.label);
		}
		const inspection_process = { inspection_1: "Slitter", inspection_2: "Leveler", inspection_3: "Reshearing" }[action.id];
		if (inspection_process && frm.doc.operation !== inspection_process) return;
		const inspection = action.id.startsWith("inspection_");
		const button = frm.add_custom_button(
			action.label,
			() => ss_coil.prints.open(frm.doctype, frm.doc.name, action.id),
			inspection ? undefined : __("Print")
		);
		if (inspection && button && frm.page?.inner_toolbar) {
			button.prependTo(frm.page.inner_toolbar);
		}
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
	if (doctype === "SS Coil" && action.id.startsWith("inspection_")) {
		frappe.model.with_doc(doctype, name, () => {
			const doc = frappe.get_doc(doctype, name);
			const tags = [...new Set((doc?.job_output || []).map((row) => row.tag_no).filter(Boolean))];
			if (!tags.length) {
				frappe.msgprint(__("Add output tags to Job Output before printing an inspection report."));
				return;
			}
			const dialog = new frappe.ui.Dialog({
				title: action.label,
				fields: [{ fieldname: "inspection_tag", label: __("Output Tag No"), fieldtype: "Select", options: tags.join("\n"), reqd: 1 }],
				primary_action_label: __("Print"),
				primary_action(values) {
					dialog.hide();
					ss_coil.prints.open_printview(doctype, name, action.format, { inspection_tag: values.inspection_tag });
				},
			});
			dialog.show();
		});
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
		(options.inspection_tag ? "&inspection_tag=" + encodeURIComponent(options.inspection_tag) : "") +
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
