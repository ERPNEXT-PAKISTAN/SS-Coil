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
		frappe.msgprint(__("Select an SS Coil job sheet to print."));
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

ss_coil.job_sheet.load_ss_coil_html = function (field, ss_coil_name) {
	if (!field || !ss_coil_name) {
		return Promise.resolve();
	}
	return new Promise((resolve, reject) => {
		frappe.call({
			method: "ss_coil.job_sheet_print.get_ss_coil_job_sheet_html",
			args: { ss_coil: ss_coil_name },
			callback(r) {
				const html = r.message || "";
				field.$wrapper.find(".ss-coil-job-sheet-report-body").html(html);
				ss_coil.job_sheet.bind_inline_print(field.$wrapper, ss_coil_name);
				resolve(r);
			},
			error: reject,
		});
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

ss_coil.job_sheet.coil_selector_label = function (row) {
	const parts = [row.name];
	if (row.operation) {
		parts.push(row.operation);
	}
	if (row.job_sheet_no && row.job_sheet_no !== row.name) {
		parts.push(row.job_sheet_no);
	}
	return parts.join(" · ");
};

ss_coil.job_sheet.render_on_sales_order_form = function (frm) {
	const field = ss_coil.job_sheet.get_html_field(frm);
	if (!field) {
		return;
	}
	ss_coil.job_sheet.ensure_styles();
	if (!frm.doc.name || (frm.is_new && frm.is_new())) {
		field.$wrapper.html(
			ss_coil.job_sheet.placeholder_html(__("Save the Sales Order to load job sheets."))
		);
		return;
	}

	frappe.call({
		method: "ss_coil.job_sheet_print.get_sales_order_job_sheet_coils",
		args: { sales_order: frm.doc.name },
		callback(r) {
			const coils = r.message || [];
			if (!coils.length) {
				field.$wrapper.html(
					ss_coil.job_sheet.placeholder_html(
						__("No SS Coil linked to this Sales Order. Create SS Coil from this order first.")
					)
				);
				frm.__ss_coil_job_sheet_selected = null;
				return;
			}

			const selected =
				frm.__ss_coil_job_sheet_selected &&
				coils.some((c) => c.name === frm.__ss_coil_job_sheet_selected)
					? frm.__ss_coil_job_sheet_selected
					: coils[0].name;
			frm.__ss_coil_job_sheet_selected = selected;

			let toolbar = "";
			if (coils.length > 1) {
				const options = coils
					.map(
						(c) =>
							`<option value="${frappe.utils.escape_html(c.name)}"${
								c.name === selected ? " selected" : ""
							}>${frappe.utils.escape_html(ss_coil.job_sheet.coil_selector_label(c))}</option>`
					)
					.join("");
				toolbar = `
					<div class="ss-coil-so-job-sheet-toolbar" style="display:flex;align-items:center;gap:12px;margin-bottom:12px;flex-wrap:wrap;">
						<label style="font-size:12px;font-weight:700;color:#475569;margin:0;">${__("SS Coil")}</label>
						<select class="form-control input-sm ss-coil-so-job-sheet-select" style="max-width:420px;">${options}</select>
					</div>`;
			}

			field.$wrapper.html(
				`${toolbar}<div class="ss-coil-job-sheet-report-body"></div>`
			);

			const load = (ss_coil_name) => {
				frm.__ss_coil_job_sheet_selected = ss_coil_name;
				ss_coil.job_sheet
					.load_ss_coil_html(field, ss_coil_name)
					.catch(() => {
						field.$wrapper.find(".ss-coil-job-sheet-report-body").html(
							ss_coil.job_sheet.placeholder_html(__("Could not load job sheet report."))
						);
					});
			};

			load(selected);
			field.$wrapper.find(".ss-coil-so-job-sheet-select").on("change", function () {
				load($(this).val());
			});
		},
		error() {
			field.$wrapper.html(
				ss_coil.job_sheet.placeholder_html(__("Could not load job sheet list."))
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
