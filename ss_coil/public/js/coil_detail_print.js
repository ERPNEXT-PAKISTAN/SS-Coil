const COIL_DETAIL_PRINT_FORMATS = {
	"Stock Entry": "Stock Entry Coil",
	"Sales Order": "Sales Order Coil Detail",
	"SS Coil": "SS Coil Detail",
};

function is_saved_coil_form(frm) {
	return frm && frm.doc && frm.doc.name && !frm.doc.__islocal && !frm.is_new();
}

function open_coil_detail_print(frm) {
	if (!is_saved_coil_form(frm)) {
		frappe.msgprint(__("Please save the document before printing."));
		return;
	}

	const print_format = COIL_DETAIL_PRINT_FORMATS[frm.doctype];
	if (!print_format) {
		frappe.msgprint(__("No detail print format is configured for this document."));
		return;
	}

	// Separate window: preview first, user clicks Print when ready (no auto-print).
	const url = frappe.urllib.get_full_url(
		"/printview?doctype=" +
			encodeURIComponent(frm.doctype) +
			"&name=" +
			encodeURIComponent(frm.doc.name) +
			"&format=" +
			encodeURIComponent(print_format) +
			"&no_letterhead=1" +
			"&_=" +
			Date.now()
	);

	const print_window = window.open(url, "_blank");
	if (!print_window) {
		frappe.msgprint(__("Please enable pop-ups to preview the report."));
	}
}

function add_coil_detail_print_button(frm) {
	if (!is_saved_coil_form(frm)) {
		return;
	}
	if (!COIL_DETAIL_PRINT_FORMATS[frm.doctype]) {
		return;
	}

	frm.add_custom_button(__("Print Report"), function () {
		open_coil_detail_print(frm);
	});
}
