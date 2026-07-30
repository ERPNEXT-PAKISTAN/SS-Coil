/**
 * Make Entry Number tokens clickable on Sales Order / Stock Entry item grids.
 * Values look like: "STE-0001", "JS26-00001-SL", or "STE-0001 / JS26-00001-SL".
 */
function ss_coil_guess_entry_route(token) {
	const name = String(token || "").trim();
	if (!name) {
		return null;
	}
	// SS Coil naming series: JS{YY}-.…
	if (/^JS\d/i.test(name) || /^JS-/i.test(name)) {
		return "ss-coil";
	}
	// Stock Entry common prefixes
	if (/^(MAT-)?STE[-.]/i.test(name) || /^STE\d/i.test(name)) {
		return "stock-entry";
	}
	// Prefer SS Coil when the row already has custom_ss_coil matching this token
	return null;
}

function ss_coil_format_entry_no_links(value, row) {
	if (value === undefined || value === null || value === "") {
		return "";
	}
	const text = String(value);
	const parts = text.split(/\s*\/\s*/).map((p) => p.trim()).filter(Boolean);
	if (!parts.length) {
		return frappe.utils.escape_html(text);
	}
	const linkedSsCoil = row && row.custom_ss_coil ? String(row.custom_ss_coil).trim() : "";
	return parts
		.map((token) => {
			let route = ss_coil_guess_entry_route(token);
			if (!route && linkedSsCoil && token === linkedSsCoil) {
				route = "ss-coil";
			}
			if (!route && linkedSsCoil && parts.length === 1) {
				// Single token on a row that already has SS Coil link → open SS Coil
				route = "ss-coil";
				token = linkedSsCoil;
			}
			if (!route) {
				// Ambiguous: try SS Coil first in href; desk 404 is acceptable vs plain text
				route = /^JS/i.test(token) ? "ss-coil" : "stock-entry";
			}
			const href = `/app/${route}/${encodeURIComponent(token)}`;
			return (
				`<a href="${href}" ` +
				`style="color:#1d4ed8;font-weight:700;text-decoration:none;" ` +
				`onclick="event.stopPropagation();">` +
				`${frappe.utils.escape_html(token)}</a>`
			);
		})
		.join(' <span style="color:#94a3b8;">/</span> ');
}

function bind_ss_coil_entry_trace_formatters(frm, childTableField = "items") {
	const grid = frm.fields_dict?.[childTableField]?.grid;
	if (!grid) {
		return;
	}

	const applyFormatter = (fieldname, formatter) => {
		if (!grid.get_docfield || !grid.get_docfield(fieldname)) {
			return;
		}
		grid.update_docfield_property(fieldname, "formatter", formatter);
	};

	applyFormatter("custom_entry_no", (value, df, options, doc) =>
		ss_coil_format_entry_no_links(value, doc || options?.doc)
	);
	applyFormatter("entry_no", (value, df, options, doc) =>
		ss_coil_format_entry_no_links(value, doc || options?.doc)
	);

	// Native Link field already clickable; keep visible in grid when present.
	if (grid.get_docfield && grid.get_docfield("custom_ss_coil")) {
		grid.update_docfield_property("custom_ss_coil", "in_list_view", 1);
	}
	if (grid.get_docfield && grid.get_docfield("ss_coil")) {
		grid.update_docfield_property("ss_coil", "in_list_view", 1);
	}
}
