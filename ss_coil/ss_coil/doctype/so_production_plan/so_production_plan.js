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
	const hide = new Set(
		is_slitter ? ["length", "total_sheets"] : ["strip", "total_width", "knife"]
	);
	const col_map = is_slitter
		? {
				seq: 1,
				width: 2,
				lengthcut: 1,
				strip: 1,
				total_width: 1,
				tolerance_plus: 1,
				tolerance_minus: 1,
				knife: 1,
				carry_forward: 1,
		  }
		: {
				seq: 1,
				width: 2,
				length: 2,
				lengthcut: 1,
				total_sheets: 1,
				tolerance_plus: 1,
				tolerance_minus: 1,
				carry_forward: 1,
		  };

	ensure_so_production_plan_grid_styles();
	grid_field.grid.wrapper.addClass("ss-coil-scheme-grid");

	(grid_field.grid.docfields || []).forEach((df) => {
		if (!df || !df.fieldname) {
			return;
		}
		const is_hidden = hide.has(df.fieldname) ? 1 : 0;
		df.hidden = is_hidden;
		grid_field.grid.column_disp_overrides = grid_field.grid.column_disp_overrides || {};
		grid_field.grid.column_disp_overrides[df.fieldname] = is_hidden;
		if (col_map[df.fieldname]) {
			df.columns = col_map[df.fieldname];
		}
		if (df.fieldname === "carry_forward") {
			df.label = __("Next");
		}
	});

	grid_field.grid.visible_columns = null;
	grid_field.grid.grid_rows = [];
	grid_field.grid.grid_rows_by_docname = {};
	if (grid_field.grid.parent) {
		$(grid_field.grid.parent).find(".grid-body .grid-row").remove();
		$(grid_field.grid.parent).find(".grid-heading-row .grid-row").remove();
	}
	grid_field.grid.header_row = null;
	grid_field.grid.header_search = null;
	if (typeof grid_field.grid.reset_grid === "function") {
		grid_field.grid.reset_grid();
	} else {
		grid_field.grid.setup_visible_columns();
		grid_field.grid.refresh();
	}
}

function ensure_so_production_plan_grid_styles() {
	const css = `
		.ss-coil-scheme-grid .form-grid-container {
			overflow-x: auto !important;
			overflow-y: hidden;
			width: 100%;
		}
		.ss-coil-scheme-grid .grid-body,
		.ss-coil-scheme-grid .grid-heading-row {
			overflow-x: visible !important;
		}
		.ss-coil-scheme-grid .form-grid {
			min-width: max-content;
		}
		.ss-coil-scheme-grid .grid-heading-row .grid-static-col,
		.ss-coil-scheme-grid .grid-row .grid-static-col {
			overflow: hidden;
			text-overflow: ellipsis;
			white-space: nowrap;
		}
	`;
	let style = document.getElementById("ss-coil-scheme-grid-style");
	if (!style) {
		style = document.createElement("style");
		style.id = "ss-coil-scheme-grid-style";
		document.head.appendChild(style);
	}
	style.textContent = css;
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
