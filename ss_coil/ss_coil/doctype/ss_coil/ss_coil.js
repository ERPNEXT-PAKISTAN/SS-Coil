// Copyright (c) 2026, Taimoor and contributors
// For license information, please see license.txt

frappe.ui.form.on("SS Coil", {
	setup(frm) {
		frm.set_query("sales_order_item", function () {
			if (!frm.doc.order_no) {
				return { filters: { name: "" } };
			}

			return {
				query: "ss_coil.api.sales_order_item_query",
				filters: {
					parent: frm.doc.order_no,
				},
			};
		});
		frm.set_query("stock_entry_items", function () {
			if (!frm.doc.stock_entry) {
				return { filters: { name: "" } };
			}

			return {
				query: "ss_coil.api.stock_entry_item_query",
				filters: {
					parent: frm.doc.stock_entry,
				},
			};
		});
	},
	refresh(frm) {
		add_ss_coil_tag_buttons(frm);
		update_grand_totals(frm);
		update_calc_ratio(frm);
		update_remaining_width(frm);
		update_input_coil_length(frm);
	},
	estimated_wt(frm) {
		update_calc_ratio(frm);
	},
	grand_estimated_wt(frm) {
		update_calc_ratio(frm);
	},
	cutting_detail_add(frm) {
		update_grand_totals(frm);
	},
	cutting_detail_remove(frm) {
		update_grand_totals(frm);
	},
	job_output_add(frm) {
		update_grand_totals(frm);
	},
	job_output_remove(frm) {
		update_grand_totals(frm);
	},
	order_no(frm) {
		if (!frm.doc.order_no) {
			frm.set_value("sales_order_item", "");
			frm.clear_table("so_item");
			frm.refresh_field("so_item");
			frm.clear_table("cutting_detail");
			frm.refresh_field("cutting_detail");
			clear_sales_order_item_mapped_fields(frm);
			update_grand_totals(frm);
			return;
		}
		frm.set_value("sales_order_item", "");
		frm.clear_table("so_item");
		frm.refresh_field("so_item");
		frm.clear_table("cutting_detail");
		frm.refresh_field("cutting_detail");
		clear_sales_order_item_mapped_fields(frm);
		update_grand_totals(frm);
	},
	stock_entry(frm) {
		if (!frm.doc.stock_entry) {
			frm.set_value("stock_entry_items", "");
			frm.clear_table("input_coil");
			frm.refresh_field("input_coil");
			return;
		}
		frm.set_value("stock_entry_items", "");
		frm.clear_table("input_coil");
		frm.refresh_field("input_coil");
	},
	sales_order_item(frm) {
		if (!frm.doc.order_no || !frm.doc.sales_order_item) {
			frm.clear_table("so_item");
			frm.refresh_field("so_item");
			frm.clear_table("cutting_detail");
			frm.refresh_field("cutting_detail");
			clear_sales_order_item_mapped_fields(frm);
			update_grand_totals(frm);
			return;
		}

		frappe.call({
			method: "frappe.client.get",
			args: {
				doctype: "Sales Order Item",
				name: frm.doc.sales_order_item,
			},
			freeze: true,
			freeze_message: __("Loading Selected Sales Order Item..."),
			callback: function (r) {
				const item = r.message;
				if (!item) return;

				const target_fields = (frappe.meta.get_docfields("Coil SO") || [])
					.filter(
						(df) =>
							df.fieldname &&
							![
								"Section Break",
								"Column Break",
								"Tab Break",
								"HTML",
								"Button",
								"Table",
								"Table MultiSelect",
							].includes(df.fieldtype),
					)
					.map((df) => df.fieldname);

				frm.clear_table("so_item");
				const row = frm.add_child("so_item");

				target_fields.forEach((fieldname) => {
					if (fieldname === "so_number") {
						row.so_number = frm.doc.order_no;
						return;
					}

					if (fieldname === "length_c") {
						row.length_c = item.custom_length_c || "";
						return;
					}

					if (fieldname === "dimension") {
						row.dimension = item.custom_dimension || item.custom_dimensin || "";
						return;
					}

					const direct_value = item[fieldname];
					const custom_value = item[`custom_${fieldname}`];

					if (direct_value !== undefined && direct_value !== null) {
						row[fieldname] = direct_value;
					} else if (custom_value !== undefined && custom_value !== null) {
						row[fieldname] = custom_value;
					}
				});

				if (!row.item_name && item.item_code) {
					row.item_name = item.item_name || item.item_code;
				}

				frm.set_value("machine", item.custom_machine || "");
				frm.set_value("calc_ratio", flt(item.custom_calc_ratio));
				frm.set_value("calc_ratio_2", flt(item.custom_calc_ratio_2));
				frm.set_value("actual_ratio", flt(item.custom_actual_ratio));
				frm.set_value("remaining_width", flt(item.custom_remaining_width));

				frm.refresh_field("so_item");
				update_input_coil_length(frm);

				frappe.call({
					method: "ss_coil.api.get_so_production_plan_rows",
					args: {
						sales_order_item: item.name,
					},
					callback: function (scheme_response) {
						load_cutting_scheme_from_so_item(frm, scheme_response.message || []);
					},
				});
			},
		});
	},
	stock_entry_items(frm) {
		if (!frm.doc.stock_entry || !frm.doc.stock_entry_items) {
			frm.clear_table("input_coil");
			frm.refresh_field("input_coil");
			return;
		}

		frappe.call({
			method: "frappe.client.get",
			args: {
				doctype: "Stock Entry Detail",
				name: frm.doc.stock_entry_items,
			},
			freeze: true,
			freeze_message: __("Loading Selected Stock Entry Item..."),
			callback: function (r) {
				const item = r.message;
				if (!item) return;

				const target_fields = (frappe.meta.get_docfields("Coil Input") || [])
					.filter(
						(df) =>
							df.fieldname &&
							![
								"Section Break",
								"Column Break",
								"Tab Break",
								"HTML",
								"Button",
								"Table",
								"Table MultiSelect",
							].includes(df.fieldtype),
					)
					.map((df) => df.fieldname);

				const special_map = {
					class: item.item_name || item.item_code,
					tag_no: item.custom_tag_no,
					dimension: item.custom_dimension,
					estimated_wt: item.custom_estimated_wt,
					location: item.custom_location,
					estimated_qty: item.qty,
					actual_qty: item.transfer_qty,
				};

				frm.clear_table("input_coil");
				const row = frm.add_child("input_coil");

				target_fields.forEach((fieldname) => {
					if (special_map[fieldname] !== undefined) {
						row[fieldname] = special_map[fieldname];
						return;
					}

					if (fieldname === "length") {
						return;
					}

					const direct_value = item[fieldname];
					const custom_value = item[`custom_${fieldname}`];

					if (direct_value !== undefined && direct_value !== null) {
						row[fieldname] = direct_value;
					} else if (custom_value !== undefined && custom_value !== null) {
						row[fieldname] = custom_value;
					}
				});

				update_input_coil_length(frm, row);
				frm.refresh_field("input_coil");
			},
		});
	},
});

function add_ss_coil_tag_buttons(frm) {
	if (!frm.doc.name || (frm.is_new && frm.is_new())) return;

	const inputTags = [...new Set((frm.doc.input_coil || []).map((row) => row.tag_no).filter(Boolean))];
	const outputTags = [...new Set((frm.doc.job_output || []).map((row) => row.tag_no).filter(Boolean))];
	const allTags = [...new Set([...inputTags, ...outputTags])];

	frm.add_custom_button(__("Tag Registry"), function () {
		if (frm.doc.order_no) {
			frappe.set_route("List", "Tag Registry", { sales_order: frm.doc.order_no });
			return;
		}
		if (inputTags.length === 1) {
			frappe.set_route("List", "Tag Registry", { root_tag_no: inputTags[0] });
			return;
		}
		frappe.set_route("List", "Tag Registry");
	}, __("Tags"));

	if (inputTags.length === 1) {
		frm.add_custom_button(__("Open Parent Tag"), function () {
			frappe.set_route("Form", "Tag Registry", inputTags[0]);
		}, __("Tags"));
	}

	if (outputTags.length === 1) {
		frm.add_custom_button(__("Open Output Tag"), function () {
			frappe.set_route("Form", "Tag Registry", outputTags[0]);
		}, __("Tags"));
	} else if (outputTags.length > 1 || allTags.length > 1) {
		frm.add_custom_button(__("Open Related Tags"), function () {
			if (inputTags.length === 1) {
				frappe.set_route("List", "Tag Registry", { root_tag_no: inputTags[0] });
				return;
			}
			if (frm.doc.order_no) {
				frappe.set_route("List", "Tag Registry", { sales_order: frm.doc.order_no });
				return;
			}
			frappe.set_route("List", "Tag Registry");
		}, __("Tags"));
	}
}

frappe.ui.form.on("Cutting Scheme", {
	width(frm, cdt, cdn) {
		update_cutting_total_width(cdt, cdn);
	},
	strip(frm, cdt, cdn) {
		update_cutting_total_width(cdt, cdn);
	},
	total_width(frm) {
		update_grand_totals(frm);
	},
});

frappe.ui.form.on("Coil Output", {
	estimated_wt(frm) {
		update_grand_totals(frm);
	},
});

frappe.ui.form.on("Coil SO", {
	qty(frm) {
		update_input_coil_length(frm);
	},
	thickness(frm) {
		update_input_coil_length(frm);
	},
	width(frm) {
		update_remaining_width(frm);
		update_input_coil_length(frm);
	},
});

function update_grand_totals(frm) {
	const total_width_sum = (frm.doc.cutting_detail || []).reduce(
		(sum, row) => sum + flt(row.total_width),
		0,
	);
	const estimated_wt_sum = (frm.doc.job_output || []).reduce(
		(sum, row) => sum + flt(row.estimated_wt),
		0,
	);

	frm.set_value("grand_total_width", total_width_sum);
	frm.set_value("grand_estimated_wt", estimated_wt_sum);
	update_remaining_width(frm);
}

function update_cutting_total_width(cdt, cdn) {
	const row = locals[cdt] && locals[cdt][cdn];
	if (!row) return;

	frappe.model.set_value(cdt, cdn, "total_width", flt(row.width) * flt(row.strip));
}

function update_calc_ratio(frm) {
	const estimated = flt(frm.doc.estimated_wt);
	const grand = flt(frm.doc.grand_estimated_wt);

	if (!estimated) {
		frm.set_value("calc_ratio", 0);
		return;
	}

	frm.set_value("calc_ratio", (grand / estimated) * 100);
}

function update_remaining_width(frm) {
	const so_width = flt((frm.doc.so_item || [])[0]?.width);
	const grand_total_width = flt(frm.doc.grand_total_width);
	frm.set_value("remaining_width", so_width - grand_total_width);
}

function update_input_coil_length(frm, target_row = null) {
	const so_row = (frm.doc.so_item || [])[0];
	if (!so_row) return;

	const qty = flt(so_row.qty);
	const thickness = flt(so_row.thickness);
	const width = flt(so_row.width);
	const denominator = thickness * width * 0.00000785 * 1000;
	const length = denominator ? qty / denominator : 0;

	const rows = target_row ? [target_row] : frm.doc.input_coil || [];
	rows.forEach((row) => {
		if (row) {
			row.length = length;
		}
	});

	frm.refresh_field("input_coil");
}

function load_cutting_scheme_from_so_item(frm, rows) {
	const target_fields = (frappe.meta.get_docfields("Cutting Scheme") || [])
		.filter(
			(df) =>
				df.fieldname &&
				![
					"Section Break",
					"Column Break",
					"Tab Break",
					"HTML",
					"Button",
					"Table",
					"Table MultiSelect",
				].includes(df.fieldtype),
		)
		.map((df) => df.fieldname);

	frm.clear_table("cutting_detail");

	(rows || []).forEach((source_row) => {
		const row = frm.add_child("cutting_detail");
		target_fields.forEach((fieldname) => {
			if (source_row[fieldname] !== undefined && source_row[fieldname] !== null) {
				row[fieldname] = source_row[fieldname];
			}
		});
	});

	frm.refresh_field("cutting_detail");
	update_grand_totals(frm);
}

function clear_sales_order_item_mapped_fields(frm) {
	frm.set_value("machine", "");
	frm.set_value("calc_ratio", 0);
	frm.set_value("calc_ratio_2", 0);
	frm.set_value("actual_ratio", 0);
	frm.set_value("remaining_width", 0);
}
