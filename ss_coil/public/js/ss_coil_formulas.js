frappe.provide("ss_coil.formulas");

/** Plain numeric text — never use frappe.format here (it injects HTML divs). */
ss_coil.formulas.num = function (value, precision) {
	if (value === null || value === undefined || value === "") {
		return "-";
	}
	const n = flt(value);
	const p = precision == null ? 4 : precision;
	if (typeof frappe.utils.format_number === "function") {
		return frappe.utils.format_number(n, p);
	}
	const fixed = n.toFixed(p).replace(/0+$/, "").replace(/\.$/, "");
	const parts = fixed.split(".");
	parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ",");
	return parts.join(".");
};

ss_coil.formulas.esc = function (value) {
	return frappe.utils.escape_html(value == null ? "" : String(value));
};

ss_coil.formulas.val_chip = function (value, precision) {
	const text = ss_coil.formulas.num(value, precision);
	return `<span style="display:inline-block;background:#dbeafe;color:#1e3a8a;font-weight:700;padding:3px 10px;border-radius:8px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:13px;line-height:1.3;border:1px solid #93c5fd;">${ss_coil.formulas.esc(
		text,
	)}</span>`;
};

ss_coil.formulas.const_chip = function (text) {
	return `<span style="display:inline-block;background:#f1f5f9;color:#475569;font-weight:600;padding:3px 8px;border-radius:8px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;border:1px solid #cbd5e1;">${ss_coil.formulas.esc(
		text,
	)}</span>`;
};

ss_coil.formulas.op = function (symbol) {
	return `<span style="display:inline-block;color:#64748b;font-weight:700;font-size:14px;margin:0 6px;vertical-align:middle;">${ss_coil.formulas.esc(
		symbol,
	)}</span>`;
};

ss_coil.formulas.calc_line = function (parts) {
	return `<div style="display:flex;flex-wrap:wrap;align-items:center;gap:4px;line-height:2;">${parts.join("")}</div>`;
};

ss_coil.formulas.job_output_estimated_wt = function (input_row, so_row, output_width) {
	const input_wt = flt(input_row?.estimated_wt);
	const so_width = flt(so_row?.width);
	const row_width = flt(output_width);
	if (!so_width) {
		return input_wt;
	}
	return (input_wt / so_width) * row_width;
};

ss_coil.formulas.input_coil_length = function (so_row) {
	if (!so_row) {
		return 0;
	}
	const qty = flt(so_row.qty);
	const thickness = flt(so_row.thickness);
	const width = flt(so_row.width);
	const denominator = thickness * width * 0.00000785 * 1000;
	return denominator ? qty / denominator : 0;
};

/** calc_ratio = (grand_estimated_wt ÷ input_coil.estimated_wt) × 100 */
ss_coil.formulas.calc_ratio_value = function (frm) {
	const input_wt = flt((frm.doc.input_coil || [])[0]?.estimated_wt);
	const grand = flt(frm.doc.grand_estimated_wt);
	if (!input_wt) {
		return 0;
	}
	return (grand / input_wt) * 100;
};

ss_coil.formulas.formula_block = function ({ title, syntax, calc_html, result_text, note, accent }) {
	const bar = accent || "#2563eb";
	return `
		<div style="border:1px solid #e2e8f0;border-radius:14px;padding:0;background:#fff;margin-bottom:14px;overflow:hidden;box-shadow:0 1px 2px rgba(15,23,42,.04);">
			<div style="display:flex;align-items:center;gap:10px;padding:12px 16px;background:linear-gradient(90deg, ${bar}14, transparent);border-bottom:1px solid #e2e8f0;">
				<div style="width:4px;height:28px;border-radius:4px;background:${bar};flex-shrink:0;"></div>
				<div style="font-size:14px;font-weight:800;color:#0f172a;">${ss_coil.formulas.esc(title)}</div>
			</div>
			<div style="padding:14px 16px 16px;">
				<div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#64748b;margin-bottom:6px;">${__(
					"Syntax",
				)}</div>
				<div style="font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;color:#334155;background:#f8fafc;border:1px dashed #cbd5e1;border-radius:10px;padding:10px 12px;">${ss_coil.formulas.esc(
					syntax,
				)}</div>
				${
					calc_html
						? `<div style="margin-top:12px;">
					<div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#b45309;margin-bottom:8px;">${__(
						"Calculation",
					)}</div>
					<div style="background:#fffbeb;border:1px solid #fcd34d;border-radius:12px;padding:12px 14px;">${calc_html}</div>
				</div>`
						: ""
				}
				<div style="margin-top:12px;display:flex;align-items:center;flex-wrap:wrap;gap:10px;">
					<div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#047857;">${__(
						"Result",
					)}</div>
					<div style="font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:16px;font-weight:800;color:#065f46;background:#d1fae5;border:1px solid #6ee7b7;border-radius:10px;padding:8px 16px;">${ss_coil.formulas.esc(
						result_text,
					)}</div>
				</div>
				${
					note
						? `<div style="font-size:11px;color:#64748b;margin-top:10px;padding-top:10px;border-top:1px solid #f1f5f9;">${ss_coil.formulas.esc(
								note,
							)}</div>`
						: ""
				}
			</div>
		</div>`;
};

ss_coil.formulas.build_html = function (frm) {
	const so_row = (frm.doc.so_item || [])[0];
	const input_row = (frm.doc.input_coil || [])[0];
	const cutting_rows = frm.doc.cutting_detail || [];
	const output_rows = frm.doc.job_output || [];

	const grand_total_width = ss_coil.process.grandTotalWidth(frm);
	const grand_estimated_wt = output_rows.reduce((sum, row) => sum + flt(row.estimated_wt), 0);
	const so_width = flt(so_row?.width);
	const remaining_width = ss_coil.process.remainingWidthValue(frm);
	const grand_wt = flt(frm.doc.grand_estimated_wt != null ? frm.doc.grand_estimated_wt : grand_estimated_wt);
	const input_estimated_wt = flt(input_row?.estimated_wt);
	const calc_ratio_computed = ss_coil.formulas.calc_ratio_value(frm);
	const processKey = ss_coil.process.resolveProcessKey(frm);
	const processLabel = ss_coil.process.processLabel(processKey);
	const usesNumericLength = ss_coil.process.usesNumericLength(processKey);
	const usesSlitterWidth = ss_coil.process.usesSlitterWidthMetrics(processKey);
	const totalStripsOrSheets = ss_coil.process.totalStripsOrSheets(frm);
	const coil_length = ss_coil.process.effectiveInputCoilLength(frm);
	const weight_formula_length = ss_coil.process.weightFormulaLength(so_row);
	const slitter_dim = ss_coil.process.buildDimensionString(
		ss_coil.process.dimensionPartsFromSoRow(so_row, "slitter"),
	);
	const numeric_dim = ss_coil.process.buildDimensionString(
		ss_coil.process.dimensionPartsFromSoRow(so_row, "leveler"),
	);
	const active_dim = ss_coil.process.buildDimensionString(
		ss_coil.process.dimensionPartsFromSoRow(so_row, processKey),
	);

	const blocks = [];
	const chip = ss_coil.formulas.val_chip;
	const op = ss_coil.formulas.op;
	const cst = ss_coil.formulas.const_chip;
	const line = ss_coil.formulas.calc_line;

	blocks.push(
		ss_coil.formulas.formula_block({
			title: __("Dimension — Slitter (Length C)"),
			syntax: "dimension = thickness × width × length_c  (length_c defaults to C)",
			calc_html: so_row
				? line([
						chip(ss_coil.process.soRowField(so_row, "thickness")),
						op("×"),
						chip(ss_coil.process.soRowField(so_row, "width")),
						op("×"),
						cst(String(ss_coil.process.soRowField(so_row, "length_c") || "C")),
					])
				: `<span style="color:#78716c;font-size:13px;">${__("SO item row required")}</span>`,
			result_text: slitter_dim || "-",
			note: __(
				"Sales Order / Stock Entry keep custom_dimension as this C-style string. SS Coil Coil SO row updates to match when operation is Slitter.",
			),
			accent: "#0369a1",
		}),
	);

	blocks.push(
		ss_coil.formulas.formula_block({
			title: __("Dimension — Leveler / Reshearing (Length)"),
			syntax: "dimension = thickness × width × length  (numeric custom_length / length)",
			calc_html: so_row
				? line([
						chip(ss_coil.process.soRowField(so_row, "thickness")),
						op("×"),
						chip(ss_coil.process.soRowField(so_row, "width")),
						op("×"),
						chip(ss_coil.process.numericLengthFromSoRow(so_row)),
					])
				: `<span style="color:#78716c;font-size:13px;">${__("SO item row required")}</span>`,
			result_text: numeric_dim || "-",
			note: __("No separate custom_dimension_calc field on SO — computed here and on Coil SO for display."),
			accent: "#0f766e",
		}),
	);

	blocks.push(
		ss_coil.formulas.formula_block({
			title: __("Active dimension (current operation)"),
			syntax: `operation → ${processLabel} → ${usesNumericLength ? "numeric length" : "length_c (C)"}`,
			calc_html: so_row
				? `<div style="font-size:13px;color:#334155;margin-bottom:8px;">${ss_coil.formulas.esc(
						frm.doc.operation || processLabel,
					)}</div>${line([
						chip(ss_coil.process.soRowField(so_row, "thickness")),
						op("×"),
						chip(ss_coil.process.soRowField(so_row, "width")),
						op("×"),
						usesNumericLength
							? chip(ss_coil.process.numericLengthFromSoRow(so_row))
							: cst(String(ss_coil.process.soRowField(so_row, "length_c") || "C")),
					])}`
				: `<span style="color:#78716c;font-size:13px;">${__("SO item row required")}</span>`,
			result_text: active_dim || "-",
			accent: "#4338ca",
		}),
	);

	if (cutting_rows.length) {
		const calc_html = usesSlitterWidth
			? cutting_rows
					.map((row, idx) => {
						const w = flt(row.width);
						const s = flt(row.strip);
						const tw = ss_coil.process.cuttingRowTotalWidth(row, processKey);
						return `<div style="margin-bottom:${idx < cutting_rows.length - 1 ? "10px" : "0"};">
					<span style="font-size:11px;font-weight:700;color:#92400e;margin-right:8px;">Row ${idx + 1}</span>
					${line([chip(w), op("×"), chip(s), op("="), chip(tw)])}
				</div>`;
					})
					.join("")
			: cutting_rows
					.map((row, idx) => {
						const w = flt(row.width);
						const len = flt(row.length);
						const sheets = ss_coil.process.schemeSheetCount(row, processKey);
						return `<div style="margin-bottom:${idx < cutting_rows.length - 1 ? "10px" : "0"};">
					<span style="font-size:11px;font-weight:700;color:#92400e;margin-right:8px;">Row ${idx + 1}</span>
					${line([
						cst(__("Width")),
						chip(w),
						cst("|"),
						cst(__("Length")),
						chip(len),
						cst("|"),
						cst(__("Total sheets")),
						chip(sheets),
					])}
				</div>`;
					})
					.join("");
		blocks.push(
			ss_coil.formulas.formula_block({
				title: usesSlitterWidth ? __("Cutting row — Total Width (Slitter)") : __("Cutting row — Sheet plan (Leveler / Reshearing)"),
				syntax: usesSlitterWidth
					? "total_width = width × strip  →  grand_total_width = Σ total_width"
					: "Use width, length, total_sheets (strip = 1). grand_total_width = Σ row width (not × sheets).",
				calc_html,
				result_text: usesSlitterWidth
					? `${ss_coil.formulas.num(grand_total_width)} (Σ → grand_total_width)`
					: `${__("Sheets")}: ${ss_coil.formulas.num(totalStripsOrSheets, 0)} · ${__("Σ width")}: ${ss_coil.formulas.num(
							grand_total_width,
						)}`,
				accent: "#7c3aed",
			}),
		);
	} else {
		blocks.push(
			ss_coil.formulas.formula_block({
				title: usesSlitterWidth ? __("Cutting row — Total Width (Slitter)") : __("Cutting row — Sheet plan"),
				syntax: usesSlitterWidth ? "total_width = width × strip" : "width, length, total_sheets",
				calc_html: `<span style="color:#78716c;font-size:13px;">${__("No cutting rows")}</span>`,
				result_text: ss_coil.formulas.num(0),
				accent: "#7c3aed",
			}),
		);
	}

	if (usesSlitterWidth) {
		blocks.push(
			ss_coil.formulas.formula_block({
				title: __("Remaining Width (Slitter only)"),
				syntax: "remaining_width = so_item.width − grand_total_width",
				calc_html: line([chip(so_width), op("−"), chip(grand_total_width)]),
				result_text: ss_coil.formulas.num(
					frm.doc.remaining_width != null ? frm.doc.remaining_width : remaining_width,
				),
				note: __("Not used for Leveler / Reshearing — sheet qty is in total_sheets, not strip."),
				accent: "#db2777",
			}),
		);
	} else {
		blocks.push(
			ss_coil.formulas.formula_block({
				title: __("Remaining Width"),
				syntax: __("N/A for {0}", [processLabel]),
				calc_html: `<span style="color:#78716c;font-size:13px;">${__(
					"Slitter remaining width uses strip × width. This process uses total_sheets and length instead.",
				)}</span>`,
				result_text: "0",
				accent: "#db2777",
			}),
		);
	}

	blocks.push(
		ss_coil.formulas.formula_block({
			title: __("Calc Ratio (all processes)"),
			syntax: "calc_ratio = (grand_estimated_wt ÷ input_coil.estimated_wt) × 100",
			calc_html: input_estimated_wt
				? line([
						cst("("),
						chip(grand_wt),
						op("÷"),
						chip(input_estimated_wt),
						cst(")"),
						op("×"),
						chip(100, 0),
					])
				: `<span style="color:#78716c;font-size:13px;">${__(
						"input_coil.estimated_wt is zero — ratio set to 0",
					)}</span>`,
			result_text: ss_coil.formulas.num(calc_ratio_computed),
			accent: "#ea580c",
		}),
	);

	blocks.push(
		ss_coil.formulas.formula_block({
			title: "Calc Ratio 2 & Actual Ratio",
			syntax: "From Sales Order Item (custom_calc_ratio_2, custom_actual_ratio)",
			calc_html: line([
				cst("calc_ratio_2"),
				op("="),
				chip(frm.doc.calc_ratio_2),
				cst("|"),
				cst("actual_ratio"),
				op("="),
				chip(frm.doc.actual_ratio),
			]),
			result_text: __("Not recalculated on SS Coil"),
			accent: "#64748b",
		}),
	);

	const length_result = input_row
		? input_row.length != null
			? input_row.length
			: coil_length
		: coil_length;

	blocks.push(
		ss_coil.formulas.formula_block({
			title: usesNumericLength ? __("Input Coil — Length (from SO Length)") : __("Input Coil — Length (weight formula)"),
			syntax: usesNumericLength
				? "length = so_item.length (from custom_length on Sales Order)"
				: "length = qty ÷ (thickness × width × 0.00000785 × 1000)",
			calc_html: so_row
				? usesNumericLength
					? line([cst("length"), op("="), chip(ss_coil.process.numericLengthFromSoRow(so_row))])
					: line([
							chip(so_row.qty),
							op("÷"),
							cst("("),
							chip(so_row.thickness),
							op("×"),
							chip(so_row.width),
							op("×"),
							cst("0.00000785"),
							op("×"),
							chip(1000, 0),
							cst(")"),
						])
				: `<span style="color:#78716c;font-size:13px;">${__("SO item row required")}</span>`,
			result_text: ss_coil.formulas.num(length_result),
			note: usesNumericLength
				? __("Leveler / Reshearing use entered length; Slitter would use weight formula → {0}", [
						ss_coil.formulas.num(weight_formula_length),
					])
				: __("Leveler / Reshearing would use SO Length when set."),
			accent: "#0891b2",
		}),
	);

	blocks.push(
		ss_coil.formulas.formula_block({
			title: "Input Coil — Quantities from SO Item",
			syntax: "estimated_wt = so_item.qty | estimated_qty & actual_qty = so_item.qty_of_coil",
			calc_html: so_row
				? `<div style="display:flex;flex-direction:column;gap:8px;">
					${line([cst("estimated_wt"), op("←"), chip(so_row.qty)])}
					${line([cst("qty_of_coil"), op("←"), chip(so_row.qty_of_coil)])}
				</div>`
				: `<span style="color:#78716c;font-size:13px;">${__("SO item row required")}</span>`,
			result_text: input_row
				? `WT ${ss_coil.formulas.num(input_row.estimated_wt)} · Est Qty ${ss_coil.formulas.num(
						input_row.estimated_qty,
					)} · Act Qty ${ss_coil.formulas.num(input_row.actual_qty)}`
				: "-",
			accent: "#0d9488",
		}),
	);

	output_rows.forEach((row, idx) => {
		const computed = ss_coil.formulas.job_output_estimated_wt(input_row, so_row, row.width);
		const input_wt = flt(input_row?.estimated_wt);
		blocks.push(
			ss_coil.formulas.formula_block({
				title: `Job Output row ${idx + 1} — Estimated WT`,
				syntax: "estimated_wt = (input_coil.estimated_wt ÷ so_item.width) × job_output.width",
				calc_html: so_width
					? line([
							cst("("),
							chip(input_wt),
							op("÷"),
							chip(so_width),
							cst(")"),
							op("×"),
							chip(row.width),
						])
					: line([cst("input_wt"), op("="), chip(input_wt)]),
				result_text: ss_coil.formulas.num(row.estimated_wt != null ? row.estimated_wt : computed),
				accent: "#4f46e5",
			}),
		);
	});

	blocks.push(
		ss_coil.formulas.formula_block({
			title: "Grand Estimated WT",
			syntax: "grand_estimated_wt = Σ job_output.estimated_wt",
			calc_html: output_rows.length
				? output_rows
						.map((row, idx) => {
							const plus =
								idx > 0
									? `<span style="color:#92400e;font-weight:800;margin:0 4px;">+</span>`
									: "";
							return `${plus}${chip(row.estimated_wt)}`;
						})
						.join("")
				: `<span style="color:#78716c;font-size:13px;">${__("No job output rows")}</span>`,
			result_text: ss_coil.formulas.num(
				frm.doc.grand_estimated_wt != null ? frm.doc.grand_estimated_wt : grand_estimated_wt,
			),
			accent: "#15803d",
		}),
	);

	return `
		<div class="ss-coil-formulas" style="max-width:960px;padding:4px 0 24px;">
			<div style="font-size:18px;font-weight:800;color:#102a43;margin-bottom:4px;">${__("SS Coil formulas")}</div>
			<div style="font-size:12px;color:#64748b;margin-bottom:16px;line-height:1.5;">
				<span style="display:inline-block;background:#dbeafe;color:#1e40af;font-size:11px;font-weight:700;padding:2px 8px;border-radius:6px;margin-right:6px;">${__(
					"Values",
				)}</span>
				${__("Blue chips = numbers from this document. Yellow box = step-by-step calculation. Green = final result.")}
			</div>
			${blocks.join("")}
		</div>`;
};

ss_coil.formulas.render = function (frm) {
	const field = frm.fields_dict.formulas;
	if (!field || !field.$wrapper) {
		return;
	}
	field.$wrapper.html(ss_coil.formulas.build_html(frm));
};
