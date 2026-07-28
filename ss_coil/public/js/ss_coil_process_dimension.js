frappe.provide("ss_coil.process");

ss_coil.process.PROCESS_KEYS = ["slitter", "leveler", "reshearing"];

ss_coil.process.PROCESS_LABELS = {
	slitter: "Slitter",
	leveler: "Leveler",
	reshearing: "Reshearing",
};

/** Leveler/Reshearing: total_sheets holds order qty; strip is 1 (one scheme line). */
ss_coil.process.schemeSheetCount = function (row, processKey) {
	if (!row) {
		return 0;
	}
	if (ss_coil.process.usesNumericLength(processKey)) {
		return flt(row.total_sheets) || (flt(row.strip) > 1 ? flt(row.strip) : 0);
	}
	return flt(row.strip);
};

/** Slitter uses length_c (C); leveler & reshearing use numeric custom_length / length. */
ss_coil.process.usesNumericLength = function (processKey) {
	return processKey === "leveler" || processKey === "reshearing";
};

ss_coil.process.formatDimensionPart = function (value) {
	if (value === undefined || value === null || value === "") {
		return "";
	}
	const text = String(value).trim();
	if (!text) {
		return "";
	}
	const num = Number(text);
	if (!Number.isNaN(num) && /^-?\d+(\.\d+)?$/.test(text)) {
		return num % 1 === 0 ? String(parseInt(num, 10)) : String(num);
	}
	return text;
};

ss_coil.process.buildDimensionString = function (parts) {
	return (parts || [])
		.map((p) => ss_coil.process.formatDimensionPart(p))
		.filter(Boolean)
		.join(" x ");
};

ss_coil.process.soRowField = function (so_row, fieldname) {
	if (!so_row) {
		return undefined;
	}
	if (so_row[fieldname] !== undefined && so_row[fieldname] !== null && so_row[fieldname] !== "") {
		return so_row[fieldname];
	}
	const custom = so_row[`custom_${fieldname}`];
	if (custom !== undefined && custom !== null && custom !== "") {
		return custom;
	}
	return undefined;
};

ss_coil.process.dimensionPartsFromSoRow = function (so_row, processKey) {
	const thickness = ss_coil.process.soRowField(so_row, "thickness");
	const width = ss_coil.process.soRowField(so_row, "width");
	if (ss_coil.process.usesNumericLength(processKey)) {
		const length = ss_coil.process.numericLengthFromSoRow(so_row);
		return [thickness, width, length];
	}
	const length_c = ss_coil.process.soRowField(so_row, "length_c") || "C";
	return [thickness, width, length_c];
};

ss_coil.process.numericLengthFromSoRow = function (so_row) {
	const from_length = flt(ss_coil.process.soRowField(so_row, "length"));
	if (from_length) {
		return from_length;
	}
	return 0;
};

ss_coil.process.resolveProcessKey = function (frm) {
	const so_row = (frm.doc.so_item || [])[0] || {};
	const hint = frm.doc.operation;
	if (typeof resolveProcessKeyFromOperationHint === "function") {
		const key = resolveProcessKeyFromOperationHint(so_row, hint);
		if (key) {
			return key;
		}
	}
	const configured = ss_coil.process.PROCESS_KEYS.filter((key) => so_row[key] || so_row[`custom_${key}`]);
	return configured[0] || "slitter";
};

ss_coil.process.weightFormulaLength = function (so_row) {
	if (!so_row) {
		return 0;
	}
	const qty = flt(ss_coil.process.soRowField(so_row, "qty"));
	const thickness = flt(ss_coil.process.soRowField(so_row, "thickness"));
	const width = flt(ss_coil.process.soRowField(so_row, "width"));
	const denominator = thickness * width * 0.00000785 * 1000;
	return denominator ? qty / denominator : 0;
};

ss_coil.process.effectiveInputCoilLength = function (frm) {
	const so_row = (frm.doc.so_item || [])[0];
	if (!so_row) {
		return 0;
	}
	const processKey = ss_coil.process.resolveProcessKey(frm);
	if (ss_coil.process.usesNumericLength(processKey)) {
		const numeric = ss_coil.process.numericLengthFromSoRow(so_row);
		if (numeric) {
			return numeric;
		}
		return 0;
	}
	return ss_coil.process.weightFormulaLength(so_row);
};

ss_coil.process.syncSoItemDisplayDimension = function (frm) {
	const so_row = (frm.doc.so_item || [])[0];
	if (!so_row || !frm.fields_dict.so_item) {
		return;
	}
	const processKey = ss_coil.process.resolveProcessKey(frm);
	const dimension = ss_coil.process.buildDimensionString(
		ss_coil.process.dimensionPartsFromSoRow(so_row, processKey),
	);
	if ((so_row.dimension || "") !== dimension) {
		so_row.dimension = dimension;
		frm.refresh_field("so_item");
	}
};

ss_coil.process.processLabel = function (processKey) {
	return ss_coil.process.PROCESS_LABELS[processKey] || processKey || "Process";
};
