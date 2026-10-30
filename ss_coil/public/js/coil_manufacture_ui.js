/**
 * Coil Manufacture (Tags) — light UI for SS Coil + Sales Order.
 * Creates Manufacture Stock Entry from finished Job Output tags
 * (no next_process). Tag No = Batch No on FG rows.
 */

function inject_coil_mfg_styles() {
	if (document.getElementById("coil-mfg-styles")) return;
	const s = document.createElement("style");
	s.id = "coil-mfg-styles";
	s.textContent = `
		.coil-mfg-wrap { padding:2px 0; color:#0f172a; }
		.coil-mfg-header {
			display:flex; gap:14px; align-items:center;
			background:linear-gradient(135deg,#ecfdf5,#f0f9ff);
			border:1px solid #a7f3d0; border-radius:12px;
			padding:14px 18px; margin-bottom:14px;
		}
		.coil-mfg-icon {
			width:42px; height:42px; border-radius:10px;
			background:linear-gradient(135deg,#059669,#0d9488);
			color:#fff; font-weight:800; font-size:11px;
			display:flex; align-items:center; justify-content:center;
		}
		.coil-mfg-title { font-size:15px; font-weight:800; color:#064e3b; }
		.coil-mfg-sub { font-size:12px; color:#64748b; margin-top:2px; }
		.coil-mfg-section { font-size:11px; font-weight:700; text-transform:uppercase;
			letter-spacing:.06em; color:#64748b; margin:12px 0 8px; }
		.coil-mfg-grid-2 { display:grid; grid-template-columns:1fr 1fr; gap:12px; margin-bottom:12px; }
		.coil-mfg-label { font-size:12px; font-weight:600; color:#475569; margin-bottom:4px; display:block; }
		.coil-mfg-table-wrap { border:1px solid #e2e8f0; border-radius:10px; overflow:hidden; background:#fff; max-height:320px; overflow-y:auto; }
		.coil-mfg-table { width:100%; border-collapse:collapse; }
		.coil-mfg-th { padding:8px 10px; font-size:11px; font-weight:700; text-transform:uppercase;
			color:#475569; background:#f1f5f9; border-bottom:1px solid #e2e8f0; position:sticky; top:0; }
		.coil-mfg-td { padding:8px 10px; font-size:13px; border-bottom:1px solid #f1f5f9; vertical-align:middle; }
		.coil-mfg-row-ready { background:#fff; }
		.coil-mfg-row-next { background:#fffbeb; }
		.coil-mfg-row-done { background:#f8fafc; opacity:.75; }
		.coil-mfg-row-blocked { background:#fef2f2; }
		.coil-mfg-pill {
			display:inline-block; border-radius:999px; padding:2px 8px; font-size:10px; font-weight:700;
		}
		.coil-mfg-pill-ready { background:#ecfdf5; color:#15803d; border:1px solid #86efac; }
		.coil-mfg-pill-next { background:#fffbeb; color:#b45309; border:1px solid #fcd34d; }
		.coil-mfg-pill-done { background:#eff6ff; color:#1d4ed8; border:1px solid #bfdbfe; }
		.coil-mfg-pill-blocked { background:#fef2f2; color:#b91c1c; border:1px solid #fecaca; }
		.coil-mfg-tab-toolbar { display:flex; align-items:center; justify-content:space-between; gap:12px; margin:10px 0; }
		.coil-mfg-tab-table-wrap { border:1px solid #cbd5e1; border-radius:8px; overflow:auto; max-height:62vh; background:#fff; }
		.coil-mfg-tab-grid { width:100%; min-width:920px; border-collapse:separate; border-spacing:0; font-size:12px; }
		.coil-mfg-tab-grid th { position:sticky; top:0; z-index:2; padding:9px 10px; background:#eaf0f6; color:#334155; border-right:1px solid #cbd5e1; border-bottom:2px solid #94a3b8; text-align:left; white-space:nowrap; font-weight:700; }
		.coil-mfg-tab-grid td { padding:8px 10px; border-right:1px solid #dbe2ea; border-bottom:1px solid #dbe2ea; vertical-align:middle; }
		.coil-mfg-tab-grid th:last-child, .coil-mfg-tab-grid td:last-child { border-right:0; }
		.coil-mfg-tab-grid tbody tr:nth-child(even) { background:#f8fafc; }
		.coil-mfg-tab-grid tbody tr:hover { background:#eef6ff; }
		.coil-mfg-tab-grid .coil-mfg-row-blocked { background:#fff7f7; }
		.coil-mfg-tab-grid .coil-mfg-row-next { background:#fffbeb; }
		.coil-mfg-tab-grid .coil-mfg-row-done { color:#475569; }
		.coil-mfg-tab-grid .coil-mfg-tab-create { min-width:94px; }
		.coil-mfg-notice { border-radius:8px; padding:8px 12px; font-size:12px; margin-bottom:10px;
			background:#eff6ff; border:1px solid #bfdbfe; color:#1e40af; }
		.coil-mfg-warn { background:#fffbeb; border-color:#fcd34d; color:#92400e; }
		.coil-mfg-meta { display:grid; grid-template-columns:1fr 1fr; gap:10px; margin-bottom:12px; }
		.coil-mfg-meta-card { background:#fff; border:1px solid #e2e8f0; border-radius:10px; padding:10px 12px; }
		.coil-mfg-meta-k { font-size:10px; font-weight:700; text-transform:uppercase; color:#64748b; }
		.coil-mfg-meta-v { font-size:13px; font-weight:700; color:#0f172a; margin-top:2px; word-break:break-word; }
		#coil-mfg-src-wh label, #coil-mfg-tgt-wh label { display:none !important; }
		#coil-mfg-src-wh .form-control, #coil-mfg-tgt-wh .form-control {
			background:#fff !important; border:1px solid #cbd5e1 !important; border-radius:8px !important;
			color:#0f172a !important; box-shadow:none !important;
		}
		.coil-mfg-remarks {
			width:100%; min-height:56px; border:1px solid #cbd5e1; border-radius:8px;
			padding:8px 10px; font-size:13px; color:#0f172a; background:#fff;
		}
	`;
	document.head.appendChild(s);
}

function open_coil_manufacture_from_ss_coil(frm) {
	if (!frm.doc.name || frm.is_new()) {
		frappe.msgprint(__("Save the SS Coil first."));
		return;
	}
	inject_coil_mfg_styles();
	frappe.call({
		method: "ss_coil.coil_manufacture.get_ss_coil_manufacture_preview",
		args: { ss_coil: frm.doc.name },
		freeze: true,
		callback(r) {
			coil_mfg_open_dialog(frm, r.message || {}, "ss_coil");
		},
	});
}

function coil_mfg_render_manufacturing_tab(frm) {
	const field = frm.fields_dict && frm.fields_dict.manufacturing_html;
	if (!field) return;
	const $wrap = field.$wrapper;
	if (!frm.doc.name || frm.is_new()) {
		$wrap.html(`<div class="coil-mfg-notice">${__("Save the SS Coil to load manufacturing details.")}</div>`);
		return;
	}
	inject_coil_mfg_styles();
	const requestId = (frm._coil_mfg_tab_request_id || 0) + 1;
	frm._coil_mfg_tab_request_id = requestId;
	$wrap.html(`<div class="text-muted">${__("Loading output-tag manufacturing status…")}</div>`);
	frappe.call({
		method: "ss_coil.coil_manufacture.get_ss_coil_manufacture_preview",
		args: { ss_coil: frm.doc.name },
		callback(r) {
			if (frm._coil_mfg_tab_request_id !== requestId) return;
			coil_mfg_render_manufacturing_tab_content(frm, r.message || {});
		},
		error() {
			if (frm._coil_mfg_tab_request_id === requestId) {
				$wrap.html(`<div class="coil-mfg-notice coil-mfg-warn">${__("Could not load manufacturing details. Refresh the form and try again.")}</div>`);
			}
		},
	});
}

function coil_mfg_render_manufacturing_tab_content(frm, preview) {
	const field = frm.fields_dict && frm.fields_dict.manufacturing_html;
	if (!field) return;
	const $wrap = field.$wrapper;
	const ready = preview.ready_tags || [];
	const already = preview.already_tags || [];
	const blocked = preview.blocked_tags || [];
	const continuing = preview.continuing_tags || [];
	const mother = preview.mother || {};
	const esc = (value) => frappe.utils.escape_html(String(value == null || value === "" ? "—" : value));

	const rows = [
		...ready.map((row) => ({ ...row, status_label: __("Ready"), status_class: "ready", action: true })),
		...already.map((row) => ({ ...row, status_label: __("Manufactured"), status_class: "done", entry: row.already_se })),
		...blocked.map((row) => ({ ...row, status_label: __("Blocked"), status_class: "blocked", note: row.blocked_reason })),
		...continuing.map((row) => ({ ...row, status_label: row.next_process || __("Next Process"), status_class: "next", note: __("Waiting for the next process") })),
	];
	const tableRows = rows.map((row) => {
		const qty = row.actual_wt != null ? row.actual_wt : row.qty;
		const entry = row.entry
			? `<a href="/app/stock-entry/${encodeURIComponent(row.entry)}" target="_blank">${esc(row.entry)}</a>`
			: esc(row.note || "—");
		const action = row.action
			? `<button type="button" class="btn btn-xs btn-primary coil-mfg-tab-create" data-tag="${esc(row.tag_no)}">${__("Create Entry")}</button>`
			: entry;
		return `<tr class="coil-mfg-row-${row.status_class}">
			<td class="coil-mfg-td"><b>${esc(row.tag_no)}</b></td>
			<td class="coil-mfg-td">${esc(row.fg_item || preview.fg_item)}<div class="text-muted" style="font-size:10px">${__("BOM")}: ${esc(row.bom_no)}</div></td>
			<td class="coil-mfg-td" style="text-align:right">${flt(qty).toFixed(3)}</td>
			<td class="coil-mfg-td">${esc(row.tag_no)}</td>
			<td class="coil-mfg-td"><span class="coil-mfg-pill coil-mfg-pill-${row.status_class}">${esc(row.status_label)}</span></td>
			<td class="coil-mfg-td">${action}</td>
		</tr>`;
	}).join("");

	$wrap.html(`
		<div class="coil-mfg-wrap">
			<div class="coil-mfg-header">
				<div class="coil-mfg-icon">MFG</div>
				<div>
					<div class="coil-mfg-title">${__("Manufacturing by Output Tag")}</div>
					<div class="coil-mfg-sub">${__("SS Coil")}: <b>${esc(preview.ss_coil)}</b> · ${__("Sales Order")}: <b>${esc(preview.sales_order)}</b> · ${__("Status")}: <b>${esc(preview.order_status)}</b></div>
				</div>
			</div>
			<div class="coil-mfg-notice">${__("Each output tag creates its own BOM-based Manufacture Stock Entry. The source mother batch is consumed and the finished-good batch uses the output tag.")}</div>
			<div class="coil-mfg-meta">
				<div class="coil-mfg-meta-card"><div class="coil-mfg-meta-k">${__("Mother / Raw Item")}</div><div class="coil-mfg-meta-v">${esc(mother.item_code)}<div style="font-size:11px;color:#64748b;font-weight:600;margin-top:2px">${__("Source Tag / Batch")}: ${esc(mother.tag_no || mother.batch_no)}</div></div></div>
				<div class="coil-mfg-meta-card"><div class="coil-mfg-meta-k">${__("Finished Good")}</div><div class="coil-mfg-meta-v">${esc(preview.fg_item)}</div></div>
			</div>
			<div class="coil-mfg-section">${__("Stock Entry Warehouses")}</div>
			<div class="coil-mfg-grid-2">
				<div><label class="coil-mfg-label">${__("Source Warehouse")} *</label><div id="coil-mfg-tab-src-wh"></div></div>
				<div><label class="coil-mfg-label">${__("Finished Goods Warehouse")} *</label><div id="coil-mfg-tab-tgt-wh"></div></div>
			</div>
			<div style="max-width:260px;margin-top:12px"><label class="coil-mfg-label">${__("Posting Date")}</label><input type="date" class="form-control" id="coil-mfg-tab-posting-date" value="${frappe.datetime.get_today()}" title="${esc(__("Choose a backdated posting date when required."))}"></div>
			<div class="coil-mfg-tab-toolbar">
				<div><b>${__("Output Tags")}</b><span class="text-muted" style="margin-left:8px">${__("{0} ready", [ready.length])}</span></div>
				<button type="button" class="btn btn-primary coil-mfg-tab-create-all" ${ready.length ? "" : "disabled"}>${__("Create All Ready ({0})", [ready.length])}</button>
			</div>
			<div class="coil-mfg-tab-table-wrap"><table class="coil-mfg-table coil-mfg-tab-grid"><thead><tr>
				<th class="coil-mfg-th">${__("Output Tag")}</th><th class="coil-mfg-th">${__("Finished Good / BOM")}</th>
				<th class="coil-mfg-th" style="text-align:right">${__("Actual WT")}</th><th class="coil-mfg-th">${__("FG Batch No")}</th>
				<th class="coil-mfg-th">${__("Status")}</th><th class="coil-mfg-th">${__("Manufacture Entry / Action")}</th>
			</tr></thead><tbody>${tableRows || `<tr><td class="coil-mfg-td" colspan="6">${__("No output tags found.")}</td></tr>`}</tbody></table></div>
			<div class="coil-mfg-section">${__("Remarks (optional)")}</div>
			<textarea class="coil-mfg-remarks" id="coil-mfg-tab-remarks" placeholder="${esc(__("Manufactured from {0}", [preview.ss_coil || ""]))}"></textarea>
		</div>`);

	function makeWarehouseControl(id) {
		const parent = $wrap.find(`#${id}`)[0];
		if (!parent) return null;
		const control = frappe.ui.form.make_control({
			parent,
			df: { fieldtype: "Link", options: "Warehouse", fieldname: id },
			render_input: true,
		});
		control.refresh();
		return control;
	}
	const source = makeWarehouseControl("coil-mfg-tab-src-wh");
	const target = makeWarehouseControl("coil-mfg-tab-tgt-wh");
	if (preview.default_warehouse && target) target.set_value(preview.default_warehouse);
	frm._coil_mfg_tab_controls = { source, target, preview };

	$wrap.off("click.coil_mfg_tab", ".coil-mfg-tab-create").on("click.coil_mfg_tab", ".coil-mfg-tab-create", function () {
		coil_mfg_create_single_from_tab(frm, preview, this.getAttribute("data-tag"), this);
	});
	$wrap.off("click.coil_mfg_tab_all", ".coil-mfg-tab-create-all").on("click.coil_mfg_tab_all", ".coil-mfg-tab-create-all", function () {
		coil_mfg_create_all_from_tab(frm, preview, this);
	});
}

function coil_mfg_create_all_from_tab(frm, preview, button) {
	const tags = (preview.ready_tags || []).map((row) => row.tag_no).filter(Boolean);
	if (!tags.length) return;
	const controls = frm._coil_mfg_tab_controls || {};
	const source = controls.source && controls.source.get_value();
	const target = controls.target && controls.target.get_value();
	if (!source || !target) {
		frappe.msgprint({ title: __("Warehouses Required"), message: __("Select Source and Finished Goods warehouses."), indicator: "orange" });
		return;
	}
	if (frm.is_dirty && frm.is_dirty()) {
		frappe.msgprint({ title: __("Save Required"), message: __("Save the SS Coil changes before creating Manufacture Stock Entries."), indicator: "orange" });
		return;
	}
	frappe.confirm(
		__("Create and submit one Manufacture Stock Entry for each of the {0} ready tags?", [tags.length]),
		() => {
			button.disabled = true;
			button.textContent = __("Creating Entries…");
			frappe.call({
				method: "ss_coil.coil_manufacture.create_manufacture_stock_entry_from_ss_coil",
				args: {
					ss_coil: preview.ss_coil,
					tags: JSON.stringify(tags),
					source_warehouse: source,
					target_warehouse: target,
					submit: 1,
					remarks: (frm.fields_dict.manufacturing_html.$wrapper.find("#coil-mfg-tab-remarks").val() || "").trim() || undefined,
					posting_date: frm.fields_dict.manufacturing_html.$wrapper.find("#coil-mfg-tab-posting-date").val() || undefined,
				},
				freeze: true,
				freeze_message: __("Creating Manufacture Stock Entries…"),
				callback(r) {
					const entries = (r.message || {}).stock_entries || [];
					const rows = entries.map((entry) => `<tr><td>${frappe.utils.escape_html(entry.tag_no || "")}</td><td><a href="/app/stock-entry/${encodeURIComponent(entry.stock_entry)}" target="_blank">${frappe.utils.escape_html(entry.stock_entry || "")}</a></td></tr>`).join("");
					frappe.msgprint({
						title: __("Manufacture Entries Created"),
						indicator: "green",
						message: `<p>${__("Created one submitted Manufacture Stock Entry per ready tag.")}</p><table class="table table-bordered"><thead><tr><th>${__("Output Tag")}</th><th>${__("Manufacture Entry")}</th></tr></thead><tbody>${rows}</tbody></table>`,
					});
					frm.reload_doc();
				},
				error() {
					button.disabled = false;
					button.textContent = __("Create All Ready ({0})", [tags.length]);
				},
			});
		}
	);
}

function coil_mfg_create_single_from_tab(frm, preview, tag, button) {
	const controls = frm._coil_mfg_tab_controls || {};
	const source = controls.source && controls.source.get_value();
	const target = controls.target && controls.target.get_value();
	if (!source || !target) {
		frappe.msgprint({ title: __("Warehouses Required"), message: __("Select Source and Finished Goods warehouses."), indicator: "orange" });
		return;
	}
	if (frm.is_dirty && frm.is_dirty()) {
		frappe.msgprint({ title: __("Save Required"), message: __("Save the SS Coil changes before creating a Manufacture Stock Entry."), indicator: "orange" });
		return;
	}
	button.disabled = true;
	button.textContent = __("Creating…");
	frappe.call({
		method: "ss_coil.coil_manufacture.create_manufacture_stock_entry_from_ss_coil",
		args: {
			ss_coil: preview.ss_coil,
			tags: JSON.stringify([tag]),
			source_warehouse: source,
			target_warehouse: target,
			submit: 1,
			remarks: ($wrap_value("coil-mfg-tab-remarks") || "").trim() || undefined,
			posting_date: $wrap_value("coil-mfg-tab-posting-date") || undefined,
		},
		freeze: true,
		freeze_message: __("Creating Manufacture Stock Entry for {0}…", [tag]),
		callback(r) {
			const entry = ((r.message || {}).stock_entries || [])[0];
			if (entry) frappe.show_alert({ message: __("Created {0} for tag {1}", [entry.stock_entry, tag]), indicator: "green" });
			frm.reload_doc();
		},
		error() {
			button.disabled = false;
			button.textContent = __("Create Entry");
		},
	});

	function $wrap_value(id) {
		return frm.fields_dict.manufacturing_html.$wrapper.find(`#${id}`).val();
	}
}

function open_coil_manufacture_from_sales_order(frm) {
	if (!frm.doc.name || frm.is_new()) {
		frappe.msgprint(__("Save the Sales Order first."));
		return;
	}
	inject_coil_mfg_styles();
	frappe.call({
		method: "ss_coil.coil_manufacture.get_sales_order_coil_manufacture_preview",
		args: { sales_order: frm.doc.name },
		freeze: true,
		callback(r) {
			const data = r.message || {};
			const groups = data.groups || [];
			if (!groups.length) {
				frappe.msgprint({
					title: __("No SS Coil tags"),
					message: __(
						"No SS Coil Job Output tags found for this Sales Order. Complete process entries first."
					),
					indicator: "orange",
				});
				return;
			}
			coil_mfg_open_so_picker(frm, groups);
		},
	});
}

function coil_mfg_open_so_picker(frm, groups) {
	const options = groups.map((g) => ({
		label: `${g.ss_coil} · ${g.operation || "-"} · ready ${ (g.ready_tags || []).length }`,
		value: g.ss_coil,
	}));
	const d = new frappe.ui.Dialog({
		title: __("Coil Manufacture — pick SS Coil"),
		fields: [
			{
				fieldtype: "HTML",
				options: `<div class="coil-mfg-notice">${__(
					"Choose an SS Coil that has finished tags (no next process). Tags still going to the next operation stay out of manufacture."
				)}</div>`,
			},
			{
				fieldname: "ss_coil",
				label: __("SS Coil"),
				fieldtype: "Select",
				options: options.map((o) => o.value).join("\n"),
				reqd: 1,
				default: options[0] && options[0].value,
			},
		],
		primary_action_label: __("Open Tags"),
		primary_action(values) {
			d.hide();
			const preview = groups.find((g) => g.ss_coil === values.ss_coil);
			coil_mfg_open_dialog(frm, preview || {}, "sales_order");
		},
	});
	inject_coil_mfg_styles();
	d.show();
}

function coil_mfg_open_dialog(frm, preview, source) {
	inject_coil_mfg_styles();
	const ready = preview.ready_tags || [];
	const already = preview.already_tags || [];
	const blocked = preview.blocked_tags || [];
	const continuing = preview.continuing_tags || [];
	const mother = preview.mother || {};

	const d = new frappe.ui.Dialog({
		title: __("Coil Manufacture — {0}", [preview.ss_coil || ""]),
		size: "extra-large",
		fields: [{ fieldtype: "HTML", fieldname: "content" }],
		primary_action_label: ready.length
			? __("Create {0} Manufacture Entries", [ready.length])
			: __("Close"),
		primary_action() {
			if (!ready.length) {
				d.hide();
				return;
			}
			coil_mfg_create(d, frm, preview);
		},
	});
	d.show();

	const $w = d.fields_dict.content.$wrapper;
	const rowsHtml = [
		...ready.map(
			(r) => `
			<tr class="coil-mfg-row-ready">
				<td class="coil-mfg-td" style="text-align:center;width:36px">
					<input type="checkbox" class="coil-mfg-chk" data-tag="${frappe.utils.escape_html(r.tag_no)}" checked>
				</td>
				<td class="coil-mfg-td"><b>${frappe.utils.escape_html(r.tag_no)}</b>
					<div><span class="coil-mfg-pill coil-mfg-pill-ready">${__("Ready · separate entry")}</span></div>
				</td>
				<td class="coil-mfg-td">${frappe.utils.escape_html(r.fg_item || "—")}<div style="font-size:10px;color:#64748b">${__("BOM")}: ${frappe.utils.escape_html(r.bom_no || "—")}</div></td>
				<td class="coil-mfg-td" style="text-align:right">${flt(r.qty).toFixed(3)}</td>
				<td class="coil-mfg-td">${__("Batch")} = ${frappe.utils.escape_html(r.tag_no)}</td>
			</tr>`
		),
		...blocked.map(
			(r) => `
			<tr class="coil-mfg-row-blocked">
				<td class="coil-mfg-td"></td>
				<td class="coil-mfg-td"><b>${frappe.utils.escape_html(r.tag_no)}</b><div><span class="coil-mfg-pill coil-mfg-pill-next">${__("Blocked")}</span></div></td>
				<td class="coil-mfg-td">${frappe.utils.escape_html(r.fg_item || "—")}<div style="font-size:10px;color:#64748b">${__("BOM")}: ${frappe.utils.escape_html(r.bom_no || "—")}</div></td>
				<td class="coil-mfg-td" style="text-align:right">${flt(r.actual_wt || 0).toFixed(3)}</td>
				<td class="coil-mfg-td">${frappe.utils.escape_html(r.blocked_reason || "")}</td>
			</tr>`
		),
		...continuing.map(
			(r) => `
			<tr class="coil-mfg-row-next">
				<td class="coil-mfg-td"></td>
				<td class="coil-mfg-td"><b>${frappe.utils.escape_html(r.tag_no)}</b>
					<div><span class="coil-mfg-pill coil-mfg-pill-next">${__("Next")}: ${frappe.utils.escape_html(
						r.next_process || ""
					)}</span></div>
				</td>
				<td class="coil-mfg-td">—</td>
				<td class="coil-mfg-td" style="text-align:right">${flt(r.qty).toFixed(3)}</td>
				<td class="coil-mfg-td">${__("Skipped — still in process chain")}</td>
			</tr>`
		),
		...already.map(
			(r) => `
			<tr class="coil-mfg-row-done">
				<td class="coil-mfg-td"></td>
				<td class="coil-mfg-td"><b>${frappe.utils.escape_html(r.tag_no)}</b>
					<div><span class="coil-mfg-pill coil-mfg-pill-done">${__("Already made")}</span></div>
				</td>
				<td class="coil-mfg-td">${frappe.utils.escape_html(r.fg_item || "—")}</td>
				<td class="coil-mfg-td" style="text-align:right">${flt(r.qty).toFixed(3)}</td>
				<td class="coil-mfg-td"><a class="so-mfg-link" href="/app/stock-entry/${encodeURIComponent(
					r.already_se || ""
				)}" target="_blank">${frappe.utils.escape_html(r.already_se || "")}</a></td>
			</tr>`
		),
	].join("");

	$w.html(`
		<div class="coil-mfg-wrap">
			<div class="coil-mfg-header">
				<div class="coil-mfg-icon">TAG</div>
				<div>
					<div class="coil-mfg-title">${__("Manufacture finished coil tags")}</div>
					<div class="coil-mfg-sub">
						${__("SS Coil")}: <b>${frappe.utils.escape_html(preview.ss_coil || "")}</b>
						· ${__("Status")}: <b>${frappe.utils.escape_html(preview.order_status || "")}</b>
						· ${__("Op")}: <b>${frappe.utils.escape_html(preview.operation || "")}</b>
					</div>
				</div>
			</div>

			<div class="coil-mfg-notice">
				${__("Each selected tag creates its own BOM-based Manufacture Stock Entry. Quantity comes from that tag’s Actual WT; FG Batch No = Tag No.")}
			</div>

			<div class="coil-mfg-meta">
				<div class="coil-mfg-meta-card">
					<div class="coil-mfg-meta-k">${__("Finish Good")}</div>
					<div class="coil-mfg-meta-v">${frappe.utils.escape_html(preview.fg_item || "—")}</div>
				</div>
				<div class="coil-mfg-meta-card">
					<div class="coil-mfg-meta-k">${__("Mother / Raw")}</div>
					<div class="coil-mfg-meta-v">${frappe.utils.escape_html(mother.item_code || "—")}
						<div style="font-size:11px;color:#64748b;font-weight:600;margin-top:2px">
							${__("Tag/Batch")}: ${frappe.utils.escape_html(mother.tag_no || mother.batch_no || "—")}
						</div>
					</div>
				</div>
			</div>

			<div class="coil-mfg-section">${__("Warehouses")}</div>
			<div class="coil-mfg-grid-2">
				<div>
					<label class="coil-mfg-label">${__("Source Warehouse")} *</label>
					<div id="coil-mfg-src-wh"></div>
				</div>
				<div>
					<label class="coil-mfg-label">${__("Finished Goods Warehouse")} *</label>
					<div id="coil-mfg-tgt-wh"></div>
				</div>
			</div>
			<div style="max-width:260px;margin-top:12px"><label class="coil-mfg-label">${__("Posting Date")}</label><input type="date" class="form-control" id="coil-mfg-posting-date" value="${frappe.datetime.get_today()}" title="${frappe.utils.escape_html(__("Choose a backdated posting date when required."))}"></div>

			<div class="coil-mfg-section">${__("Job Output tags")}</div>
			<div class="coil-mfg-table-wrap">
				<table class="coil-mfg-table">
					<thead><tr>
						<th class="coil-mfg-th"></th>
						<th class="coil-mfg-th">${__("Tag No")}</th>
						<th class="coil-mfg-th">${__("Finish Good / BOM")}</th>
						<th class="coil-mfg-th" style="text-align:right">${__("Actual WT")}</th>
						<th class="coil-mfg-th">${__("Note")}</th>
					</tr></thead>
					<tbody>${rowsHtml || `<tr><td class="coil-mfg-td" colspan="5">${__("No tags")}</td></tr>`}</tbody>
				</table>
			</div>

			<div class="coil-mfg-section">${__("Remarks")}</div>
			<textarea class="coil-mfg-remarks" id="coil-mfg-remarks"
				placeholder="${frappe.utils.escape_html(
					__("Manufactured from {0}", [preview.ss_coil || ""])
				)}"></textarea>
		</div>
	`);

	function make_wh(id) {
		const el = $w.find("#" + id)[0];
		if (!el) return null;
		const ctrl = frappe.ui.form.make_control({
			parent: el,
			df: { fieldtype: "Link", options: "Warehouse", fieldname: id },
			render_input: true,
		});
		ctrl.refresh();
		return ctrl;
	}
	const src = make_wh("coil-mfg-src-wh");
	const tgt = make_wh("coil-mfg-tgt-wh");
	if (preview.default_warehouse && tgt) tgt.set_value(preview.default_warehouse);
	d._coil_mfg = { src, tgt, preview, source };
}

function coil_mfg_create(d, frm, preview) {
	const ctrls = d._coil_mfg || {};
	const src = ctrls.src ? ctrls.src.get_value() : "";
	const tgt = ctrls.tgt ? ctrls.tgt.get_value() : "";
	if (!src || !tgt) {
		frappe.msgprint({
			title: __("Warehouses Required"),
			message: __("Select Source and Finished Goods warehouses."),
			indicator: "orange",
		});
		return;
	}
	const tags = [];
	d.$wrapper.find(".coil-mfg-chk:checked").each(function () {
		tags.push(this.getAttribute("data-tag"));
	});
	if (!tags.length) {
		frappe.msgprint(__("Select at least one ready tag."));
		return;
	}
	const remarks = (d.$wrapper.find("#coil-mfg-remarks").val() || "").trim();

	d.set_primary_action(__("Creating…"), null);
	frappe.call({
		method: "ss_coil.coil_manufacture.create_manufacture_stock_entry_from_ss_coil",
		args: {
			ss_coil: preview.ss_coil,
			tags: tags,
			source_warehouse: src,
			target_warehouse: tgt,
			submit: 1,
			remarks: remarks || undefined,
			posting_date: d.$wrapper.find("#coil-mfg-posting-date").val() || undefined,
		},
		freeze: true,
		freeze_message: __("Creating Manufacture Stock Entry…"),
		callback(r) {
			d.hide();
			const msg = r.message || {};
			const entries = msg.stock_entries || [];
			const links = entries.map((entry) =>
				`<tr><td>${frappe.utils.escape_html(entry.tag_no || "")}</td><td>${flt(entry.qty).toFixed(3)}</td><td><a href="/app/stock-entry/${encodeURIComponent(entry.stock_entry)}">${frappe.utils.escape_html(entry.stock_entry)}</a></td></tr>`
			).join("");
			frappe.msgprint({
				title: __("Manufacture Entries Created"),
				indicator: "green",
				message: `<p>${__("Created one Manufacture Stock Entry per output tag.")}</p><table class="table table-bordered"><thead><tr><th>${__("Tag")}</th><th>${__("Actual WT")}</th><th>${__("Stock Entry")}</th></tr></thead><tbody>${links}</tbody></table>`,
			});
			if (entries.length === 1 && msg.stock_entry) {
				frappe.set_route("Form", "Stock Entry", msg.stock_entry);
			}
			frm.reload_doc && frm.reload_doc();
		},
		error() {
			d.set_primary_action(__("Create Manufacture Entry"), () => coil_mfg_create(d, frm, preview));
		},
	});
}

function flt(v) {
	const n = parseFloat(v);
	return isNaN(n) ? 0 : n;
}
