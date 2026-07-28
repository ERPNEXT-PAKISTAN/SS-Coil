frappe.ui.form.on("SO Production Plan", {
	refresh(frm) {
		apply_so_production_plan_cutting_grid_mode(frm);
	},
	process_key(frm) {
		apply_so_production_plan_cutting_grid_mode(frm);
	},
});

function apply_so_production_plan_cutting_grid_mode(frm) {
	const grid_field = frm.fields_dict.cutting_scheme;
	if (!grid_field || !grid_field.grid) {
		return;
	}
	const process_key = (frm.doc.process_key || "slitter").toLowerCase();
	const is_slitter = process_key === "slitter";
	ensure_so_production_plan_grid_styles();
	grid_field.grid.wrapper
		.toggleClass("ss-coil-scheme-slitter", is_slitter)
		.toggleClass("ss-coil-scheme-leveler", !is_slitter);
}

function ensure_so_production_plan_grid_styles() {
	if (document.getElementById("ss-coil-scheme-grid-style")) {
		return;
	}
	const style = document.createElement("style");
	style.id = "ss-coil-scheme-grid-style";
	style.textContent = `
		.ss-coil-scheme-slitter .grid-heading-row [data-fieldname="length"],
		.ss-coil-scheme-slitter .grid-row [data-fieldname="length"],
		.ss-coil-scheme-slitter .grid-heading-row [data-fieldname="total_sheets"],
		.ss-coil-scheme-slitter .grid-row [data-fieldname="total_sheets"] { display: none !important; }
		.ss-coil-scheme-leveler .grid-heading-row [data-fieldname="strip"],
		.ss-coil-scheme-leveler .grid-row [data-fieldname="strip"],
		.ss-coil-scheme-leveler .grid-heading-row [data-fieldname="total_width"],
		.ss-coil-scheme-leveler .grid-row [data-fieldname="total_width"],
		.ss-coil-scheme-leveler .grid-heading-row [data-fieldname="knife"],
		.ss-coil-scheme-leveler .grid-row [data-fieldname="knife"] { display: none !important; }
	`;
	document.head.appendChild(style);
}

frappe.ui.form.on("Cutting Scheme SO", {
	total_sheets(frm, cdt, cdn) {
		const row = locals[cdt] && locals[cdt][cdn];
		if (!row || !flt(row.total_sheets)) {
			return;
		}
		const pk = (frm.doc.process_key || "").toLowerCase();
		if (pk === "leveler" || pk === "reshearing") {
			frappe.model.set_value(cdt, cdn, "strip", 1);
		}
	},
});
