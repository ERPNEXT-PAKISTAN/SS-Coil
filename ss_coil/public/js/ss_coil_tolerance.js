(() => {
	frappe.provide("ss_coil.tolerance");
	const columns = [
		["Under 630", "tolerance_under_630"],
		["630 or over to and excl. 1,000", "tolerance_630_1000"],
		["1,000 or over to and excl. 1,250", "tolerance_1000_1250"],
		["1,250 or over to and excl. 1,600", "tolerance_1250_1600"],
		["1,600 or over", "tolerance_1600_over"],
	];

	const escape_html = (value) =>
		$('<div>').text(value == null ? "" : String(value)).html();

	const format_tolerance = (value) => {
		if (value == null || value === "") return "—";
		return `±${Number(value).toFixed(2)}`;
	};

	const render_tolerance_table = (frm, data) => {
		const wrapper = frm.fields_dict.tolerance_table_html?.$wrapper;
		if (!wrapper) return;
		wrapper.empty();

		const style = `
			<style>
				.ss-coil-tolerance-meta{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;margin:2px 0 18px}
				.ss-coil-tolerance-meta>div{border:1px solid var(--border-color);border-radius:6px;padding:10px 12px;min-height:58px}
				.ss-coil-tolerance-meta label{display:block;color:var(--text-muted);font-size:11px;margin-bottom:5px}
				.ss-coil-tolerance-table-wrap{overflow-x:auto}
				.ss-coil-tolerance-table{border-collapse:collapse;width:100%;min-width:850px}
				.ss-coil-tolerance-table th,.ss-coil-tolerance-table td{border:1px solid var(--border-color);padding:8px 10px;text-align:center}
				.ss-coil-tolerance-table thead th{background:var(--subtle-fg);font-weight:600}
				.ss-coil-tolerance-table th:first-child,.ss-coil-tolerance-table td:first-child{text-align:left;min-width:250px}
				.ss-coil-tolerance-disabled{color:var(--red-500);font-weight:600}
				@media(max-width:767px){.ss-coil-tolerance-meta{grid-template-columns:1fr}}
			</style>`;
		wrapper.append(style);

		const meta = $('<div class="ss-coil-tolerance-meta"></div>').appendTo(wrapper);
		[
			[__("Process Name"), data?.process_name || frm.doc.operation || "—"],
			[__("Remarks"), data?.remarks || "—"],
			[__("Disabled"), data?.disabled ? __("Yes") : __("No")],
		].forEach(([label, value]) => {
			const cell = $('<div></div>').appendTo(meta);
			$('<label></label>').text(label).appendTo(cell);
			$('<div></div>').toggleClass("ss-coil-tolerance-disabled", label === __("Disabled") && !!data?.disabled)
				.text(value).appendTo(cell);
		});

		if (!data?.rows?.length) {
			$('<p class="text-muted"></p>')
				.text(data?.disabled ? __("This process tolerance table is disabled.") : __("No tolerance table is configured for this process."))
				.appendTo(wrapper);
			return;
		}

		const table_wrap = $('<div class="ss-coil-tolerance-table-wrap"></div>').appendTo(wrapper);
		const table = $('<table class="ss-coil-tolerance-table"></table>').appendTo(table_wrap);
		const thead = $('<thead></thead>').appendTo(table);
		$('<tr></tr>').appendTo(thead)
			.append($('<th rowspan="2"></th>').text(__("Thickness (mm)")))
			.append($('<th colspan="5"></th>').text(__("Width (mm)")));
		const heading = $('<tr></tr>').appendTo(thead);
		columns.forEach(([label]) => $('<th></th>').text(__(label)).appendTo(heading));
		const tbody = $('<tbody></tbody>').appendTo(table);
		data.rows.forEach((row) => {
			const tr = $('<tr></tr>').appendTo(tbody);
			$('<td></td>').text(row.thickness_range || "—").appendTo(tr);
			columns.forEach(([, fieldname]) =>
				$('<td></td>').text(format_tolerance(row[fieldname])).appendTo(tr)
			);
		});
	};

	const refresh_tolerance_table = (frm) => {
		const wrapper = frm.fields_dict.tolerance_table_html?.$wrapper;
		if (!wrapper) return;
		const operation = frm.doc.operation;
		const is_new = frm.is_new?.() || !frm.doc.name || frm.doc.name.startsWith("new-");
		const key = `${is_new ? "new" : frm.doc.name}|${operation || ""}`;
		if (frm._ss_coil_tolerance_key === key) return;
		frm._ss_coil_tolerance_key = key;
		wrapper.empty();
		if (!operation) {
			$('<p class="text-muted"></p>').text(__("Select an Operation to view its tolerance table.")).appendTo(wrapper);
			return;
		}

		frappe.call({
			method: "ss_coil.inspection_setup.get_tolerance_table_for_coil",
			args: {
				ss_coil: is_new ? null : frm.doc.name,
				operation: is_new ? operation : null,
			},
			callback: (response) => {
				if (frm._ss_coil_tolerance_key !== key) return;
				if (response.message) {
					render_tolerance_table(frm, response.message);
				} else {
					render_tolerance_table(frm, {process_name: operation, rows: []});
				}
			},
		});
	};

	ss_coil.tolerance.render = (frm) => {
		frm._ss_coil_tolerance_key = null;
		refresh_tolerance_table(frm);
	};
})();
