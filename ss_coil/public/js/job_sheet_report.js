frappe.provide("ss_coil.job_sheet");

ss_coil.job_sheet.JOB_SHEET_HTML_FIELDS = [
	"job_sheet_report",
	"custom_job_sheet_report",
];

ss_coil.job_sheet.ensure_styles = function () {
	if (window.__ss_coil_job_sheet_report_styles) {
		return;
	}
	window.__ss_coil_job_sheet_report_styles = true;
	frappe.require("/assets/ss_coil/css/job_sheet_report.css");
};

ss_coil.job_sheet.get_html_field = function (frm) {
	for (const fieldname of ss_coil.job_sheet.JOB_SHEET_HTML_FIELDS) {
		const field = frm.fields_dict[fieldname];
		if (field && field.$wrapper) {
			return field;
		}
	}
	return null;
};

ss_coil.job_sheet.placeholder_html = function (message) {
	return `<div style="padding:18px;border:1px dashed #cbd5e1;border-radius:12px;color:#64748b;font-size:13px;background:#f8fafc;">${frappe.utils.escape_html(
		message || __("No job sheet to display.")
	)}</div>`;
};

ss_coil.job_sheet.open_print = function (ss_coil_name) {
	if (!ss_coil_name) {
		frappe.msgprint(__("SS Coil not found."));
		return;
	}
	const url = frappe.urllib.get_full_url(
		"/printview?doctype=" +
			encodeURIComponent("SS Coil") +
			"&name=" +
			encodeURIComponent(ss_coil_name) +
			"&format=" +
			encodeURIComponent("SS Coil Job Sheet") +
			"&no_letterhead=1" +
			"&trigger_print=1" +
			"&_=" +
			Date.now()
	);
	const print_window = window.open(url);
	if (!print_window) {
		frappe.msgprint(__("Please enable pop-ups to print the job sheet."));
	}
};

ss_coil.job_sheet.bind_inline_print = function ($wrapper, ss_coil_name) {
	$wrapper.find(".ss-coil-print-job-sheet").off("click").on("click", function () {
		ss_coil.job_sheet.open_print(ss_coil_name);
	});
};

ss_coil.job_sheet.render_on_ss_coil_form = function (frm) {
	const field = ss_coil.job_sheet.get_html_field(frm);
	if (!field) {
		return;
	}
	ss_coil.job_sheet.ensure_styles();
	if (!frm.doc.name || (frm.is_new && frm.is_new())) {
		field.$wrapper.html(
			ss_coil.job_sheet.placeholder_html(__("Save the SS Coil document to generate the job sheet."))
		);
		return;
	}
	frappe.call({
		method: "ss_coil.job_sheet_print.get_ss_coil_job_sheet_html",
		args: { ss_coil: frm.doc.name },
		callback(r) {
			field.$wrapper.html(r.message || "");
			ss_coil.job_sheet.bind_inline_print(field.$wrapper, frm.doc.name);
		},
		error() {
			field.$wrapper.html(
				ss_coil.job_sheet.placeholder_html(__("Could not load job sheet report."))
			);
		},
	});
};

ss_coil.job_sheet.add_print_button = function (frm, get_ss_coil_name) {
	if (!frm.doc.name || (frm.is_new && frm.is_new())) {
		return;
	}
	if (!ss_coil.job_sheet.get_html_field(frm)) {
		return;
	}
	frm.add_custom_button(
		__("Job Sheet"),
		function () {
			const name =
				typeof get_ss_coil_name === "function" ? get_ss_coil_name(frm) : get_ss_coil_name;
			ss_coil.job_sheet.open_print(name);
		},
		__("Print")
	);
};
