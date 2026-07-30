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
		.coil-mfg-pill {
			display:inline-block; border-radius:999px; padding:2px 8px; font-size:10px; font-weight:700;
		}
		.coil-mfg-pill-ready { background:#ecfdf5; color:#15803d; border:1px solid #86efac; }
		.coil-mfg-pill-next { background:#fffbeb; color:#b45309; border:1px solid #fcd34d; }
		.coil-mfg-pill-done { background:#eff6ff; color:#1d4ed8; border:1px solid #bfdbfe; }
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
	const continuing = preview.continuing_tags || [];
	const mother = preview.mother || {};

	const d = new frappe.ui.Dialog({
		title: __("Coil Manufacture — {0}", [preview.ss_coil || ""]),
		size: "extra-large",
		fields: [{ fieldtype: "HTML", fieldname: "content" }],
		primary_action_label: ready.length
			? __("Create Manufacture Entry")
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
					<div><span class="coil-mfg-pill coil-mfg-pill-ready">${__("Ready")}</span></div>
				</td>
				<td class="coil-mfg-td" style="text-align:right">${flt(r.qty).toFixed(3)}</td>
				<td class="coil-mfg-td">${__("Batch")} = ${frappe.utils.escape_html(r.tag_no)}</td>
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
				${__(
					"Only tags with no Next Process are manufactured. Tags going to the next operation stay out. FG Batch No = Tag No."
				)}
			</div>

			${!preview.fg_item || !mother.item_code
				? `<div class="coil-mfg-notice coil-mfg-warn">${__(
						"Missing Finish Good or mother raw material on Sales Order / Coil Production — fix before creating."
				  )}</div>`
				: ""}

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

			<div class="coil-mfg-section">${__("Job Output tags")}</div>
			<div class="coil-mfg-table-wrap">
				<table class="coil-mfg-table">
					<thead><tr>
						<th class="coil-mfg-th"></th>
						<th class="coil-mfg-th">${__("Tag No")}</th>
						<th class="coil-mfg-th" style="text-align:right">${__("Qty / WT")}</th>
						<th class="coil-mfg-th">${__("Note")}</th>
					</tr></thead>
					<tbody>${rowsHtml || `<tr><td class="coil-mfg-td" colspan="4">${__("No tags")}</td></tr>`}</tbody>
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
		},
		freeze: true,
		freeze_message: __("Creating Manufacture Stock Entry…"),
		callback(r) {
			d.hide();
			const msg = r.message || {};
			frappe.show_alert(
				{
					message: __("Created {0} for tags {1}", [
						msg.stock_entry,
						(msg.tags || []).join(", "),
					]),
					indicator: "green",
				},
				10
			);
			if (msg.stock_entry) {
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
