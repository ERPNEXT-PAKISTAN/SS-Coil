frappe.query_reports["Production Planning SS Coil"] = {
	filters: [
		{
			fieldname: "ss_coil",
			label: __("SS Coil"),
			fieldtype: "Link",
			options: "SS Coil",
			reqd: 1,
		},
	],
	formatter(value, row, column, data, default_formatter) {
		value = default_formatter(value, row, column, data);
		if (!data) {
			return value;
		}

		if (column.fieldname === "color" && data.color) {
			const safe = frappe.utils.escape_html(data.color);
			return `<span style="display:inline-flex;align-items:center;gap:6px;">
				<span style="width:16px;height:16px;border-radius:4px;background:${safe};border:1px solid #94a3b8;display:inline-block;"></span>
				<span>${safe}</span>
			</span>`;
		}

		if (data.row_type === "section" && column.fieldname === "section_title") {
			return `<div style="font-weight:800;font-size:13px;color:#0f172a;padding:10px 0 4px;border-bottom:2px solid #334155;margin-top:8px;">
				${frappe.utils.escape_html(data.section_title || value || "")}
			</div>`;
		}

		if (data.row_type === "table_header") {
			return `<span style="font-weight:700;color:#1e3a5f;">${frappe.utils.escape_html(value || "")}</span>`;
		}

		if (data.row_type === "cutting_row" && column.fieldname === "label") {
			const safe = frappe.utils.escape_html(data.color || "");
			return `<span style="display:inline-flex;align-items:center;gap:6px;">
				<span style="width:10px;height:10px;border-radius:2px;background:${safe};border:1px solid #64748b;"></span>
				<strong>${frappe.utils.escape_html(value || "")}</strong>
			</span>`;
		}

		if (data.row_type === "blank") {
			return "";
		}

		return value;
	},
};
