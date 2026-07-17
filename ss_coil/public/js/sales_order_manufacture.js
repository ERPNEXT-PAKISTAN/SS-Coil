// ═══════════════════════════════════════════════════════════════════════════════
// SO → Manufacture Items  —  Sales Order client script  v2.0
//
// Migrated from the DB-stored Client Script "SO Manufacture" into the app
// codebase (same file location convention as sales_order.js) so it's
// version-controlled and reviewable like the rest of ss_coil. Behavior is
// unchanged from the original Client Script - only the location moved. If
// this needs edits going forward, edit this file (then `bench build` +
// reload), not a Client Script record.
//
// WHAT IT DOES:
//   1. Adds a "Manufacture Items" button to the Sales Order toolbar (Tools menu)
//   2. Opens a dialog: Source WH + FG WH, then a table of SO items with
//      editable quantities (defaulting to ordered qty).
//      Items already manufactured from this SO show a "✓ Already Made" badge
//      and are pre-deselected to prevent duplicates.
//   3. Creates one Manufacture Stock Entry per selected item (fetches default
//      active BOM automatically), stamps custom_sales_order on every SE.
//   4. After creation: shows a status banner on the SO + green badges per item.
//
// REQUIRED CUSTOM FIELD ON Stock Entry:
//   • custom_sales_order  (Link → Sales Order, optional)
//
// DUPLICATE PREVENTION:
//   On dialog open, queries Stock Entries where:
//     custom_sales_order = <this SO> AND docstatus != 2 (not cancelled)
//   Items found in those SEs → pre-deselected + badged.
//   User can still force-re-manufacture by manually ticking the checkbox.
// ═══════════════════════════════════════════════════════════════════════════════

frappe.ui.form.on('Sales Order', {
    refresh(frm) {
        if (frm.doc.docstatus === 2) return;
        frm.add_custom_button('Manufacture Items', () => so_mfg_open_dialog(frm), 'Tools');
        so_mfg_render_banner(frm);
    }
});

// ═══════════════════════════════════════════════════════════════════════════════
//  STATUS BANNER
// ═══════════════════════════════════════════════════════════════════════════════
function so_mfg_render_banner(frm) {
    frm.dashboard.clear_headline();
    const old = document.getElementById('so-mfg-banner');
    if (old) old.remove();

    const so_name = frm.doc.name;
    if (!so_name || so_name === 'new-sales-order-1') return;

    frappe.call({
        method: 'frappe.client.get_list',
        args: {
            doctype: 'Stock Entry',
            filters: [
                ['custom_sales_order', '=', so_name],
                ['docstatus', '!=', 2]
            ],
            fields: ['name'],
            limit: 200
        },
        callback(r) {
            const se_names = (r.message || []).map(s => s.name);
            if (!se_names.length) return;

            let pending_se = se_names.length;
                    const item_map = {};

                    se_names.forEach(se_name => {
                        frappe.call({
                            method: 'frappe.client.get',
                            args: { doctype: 'Stock Entry', name: se_name },
                            callback(r2) {
                                const doc = r2.message || {};
                                (doc.items || []).forEach(row => {
                                    if (!row.is_finished_item) return;
                                    const ic = row.item_code;
                                    if (!item_map[ic]) item_map[ic] = { qty: 0, se_count: 0 };
                                    item_map[ic].qty += parseFloat(row.qty) || 0;
                                    item_map[ic].se_count += 1;
                                });
                                if (--pending_se === 0) render_banner(item_map);
                            },
                            error() {
                                if (--pending_se === 0) render_banner(item_map);
                            }
                        });
                    });

                    function render_banner(item_map) {
                        if (!Object.keys(item_map).length) return;
                        inject_so_mfg_styles();

                        const so_items   = (frm.doc.items || []).map(i => i.item_code);
                        const made_items = Object.keys(item_map);
                        const all_done   = so_items.every(ic => made_items.includes(ic));

                        const pill_color = all_done ? '#5ecf8e' : '#f5c26a';
                        const bg_color   = all_done ? '#0a2010' : '#1e1408';
                        const border_col = all_done ? '#1a5a3a' : '#5a3f0e';
                        const label      = all_done
                            ? '✓ All items manufactured'
                            : `⚡ Partial — ${made_items.length} of ${so_items.length} items manufactured`;

                        const badge_list = Object.entries(item_map).map(([ic, data]) =>
                            `<span class="so-mfg-item-pill">${frappe.utils.escape_html(ic)} <b>${data.qty.toFixed(2)}</b></span>`
                        ).join('');

                        const se_links = se_names.map(n =>
                            `<a href="/app/stock-entry/${encodeURIComponent(n)}" target="_blank" class="so-mfg-link">${frappe.utils.escape_html(n)}</a>`
                        ).join(', ');

                        const banner = document.createElement('div');
                        banner.id = 'so-mfg-banner';
                        banner.innerHTML = `
                            <div class="so-mfg-banner" style="background:${bg_color};border-color:${border_col}">
                                <div class="so-mfg-banner-left">
                                    <span class="so-mfg-status-dot" style="background:${pill_color}"></span>
                                    <span class="so-mfg-banner-label" style="color:${pill_color}">${label}</span>
                                    <div class="so-mfg-badge-row">${badge_list}</div>
                                </div>
                                <div class="so-mfg-banner-right">
                                    <span class="so-mfg-dim">${se_names.length} Stock Entr${se_names.length !== 1 ? 'ies' : 'y'}:</span>
                                    <span>${se_links}</span>
                                    <button class="so-mfg-btn-refresh" onclick="so_mfg_refresh_banner()">↻</button>
                                </div>
                            </div>`;

                        const form_page =
                            document.querySelector('.page-head') ||
                            document.querySelector('.form-page') ||
                            document.querySelector('.layout-main-section');

                        if (form_page) form_page.parentNode.insertBefore(banner, form_page.nextSibling);
                    }
        }
    });
}

window.so_mfg_refresh_banner = function () {
    if (cur_frm && cur_frm.doctype === 'Sales Order') so_mfg_render_banner(cur_frm);
};

// ═══════════════════════════════════════════════════════════════════════════════
//  MAIN DIALOG
// ═══════════════════════════════════════════════════════════════════════════════
function so_mfg_open_dialog(frm) {
    inject_so_mfg_styles();

    const so_name  = frm.doc.name;
    const so_items = (frm.doc.items || []).filter(i => i.item_code && i.qty > 0);

    if (!so_items.length) {
        frappe.msgprint({ title: 'No Items', message: 'This Sales Order has no items.', indicator: 'orange' });
        return;
    }

    const d = new frappe.ui.Dialog({
        title: `Manufacture Items — ${so_name}`,
        size: 'extra-large',
        fields: [{ fieldtype: 'HTML', fieldname: 'content' }],
        primary_action_label: 'Review BOMs & Check Stock →',
        primary_action() { so_mfg_collect_and_preview(d, frm); }
    });
    d.show();

    // Check which items already have manufacture entries on this SO
    frappe.call({
        method: 'frappe.client.get_list',
        args: {
            doctype: 'Stock Entry',
            filters: [['custom_sales_order', '=', so_name], ['docstatus', '!=', 2]],
            fields: ['name'],
            limit: 200
        },
        callback(r) {
            const se_names = (r.message || []).map(s => s.name);
            if (!se_names.length) {
                so_mfg_render_dialog(d, frm, so_items, {});
                return;
            }
            let pending_se = se_names.length;
            const made_map = {};

            se_names.forEach(se_name => {
                frappe.call({
                    method: 'frappe.client.get',
                    args: { doctype: 'Stock Entry', name: se_name },
                    callback(r2) {
                        const doc = r2.message || {};
                        (doc.items || []).forEach(row => {
                            if (!row.is_finished_item) return;
                            const ic = row.item_code;
                            if (!made_map[ic]) made_map[ic] = { qty: 0, ses: [] };
                            made_map[ic].qty += parseFloat(row.qty) || 0;
                            if (!made_map[ic].ses.includes(se_name))
                                made_map[ic].ses.push(se_name);
                        });
                        if (--pending_se === 0) so_mfg_render_dialog(d, frm, so_items, made_map);
                    },
                    error() {
                        if (--pending_se === 0) so_mfg_render_dialog(d, frm, so_items, made_map);
                    }
                });
            });
        },
        error() { so_mfg_render_dialog(d, frm, so_items, {}); }
    });
}

// ─── Render dialog content ───────────────────────────────────────────────────
function so_mfg_render_dialog(d, frm, so_items, made_map) {
    const $w = d.fields_dict.content.$wrapper;
    const already_count = Object.keys(made_map).length;

    $w.html(`
        <div class="so-mfg-wrap">
            <div class="so-mfg-header-card">
                <div class="so-mfg-icon">MFG</div>
                <div>
                    <div class="so-mfg-title">Manufacture from Sales Order</div>
                    <div class="so-mfg-sub">SO: <b>${frappe.utils.escape_html(frm.doc.name)}</b>
                        &nbsp;·&nbsp; Customer: <b>${frappe.utils.escape_html(frm.doc.customer || '—')}</b>
                        &nbsp;·&nbsp; ${so_items.length} item${so_items.length !== 1 ? 's' : ''}
                    </div>
                </div>
            </div>

            ${already_count ? `
            <div class="so-mfg-notice so-mfg-notice-warn">
                ⚠ <b>${already_count} item${already_count !== 1 ? 's' : ''}</b> already have manufacture entries linked
                to this SO. They are pre-deselected — tick them again only if you need to re-manufacture.
            </div>` : ''}

            <div class="so-mfg-section-label">Warehouses</div>
            <div class="so-mfg-grid-2 so-mfg-mb">
                <div class="so-mfg-field-wrap">
                    <label class="so-mfg-label">Source Warehouse <span style="color:#f56a6a">*</span>
                        <span class="so-mfg-label-note">(raw materials drawn from)</span></label>
                    <div id="so-mfg-src-wh-wrap"></div>
                </div>
                <div class="so-mfg-field-wrap">
                    <label class="so-mfg-label">Finished Goods Warehouse <span style="color:#f56a6a">*</span>
                        <span class="so-mfg-label-note">(manufactured items go here)</span></label>
                    <div id="so-mfg-tgt-wh-wrap"></div>
                </div>
            </div>

            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
                <div class="so-mfg-section-label" style="margin-bottom:0">Items to Manufacture</div>
                <div style="display:flex;gap:8px">
                    <button class="so-mfg-btn-ghost" onclick="so_mfg_select_all(true)">Select All</button>
                    <button class="so-mfg-btn-ghost" onclick="so_mfg_select_all(false)">Deselect All</button>
                </div>
            </div>

            <div class="so-mfg-table-wrap" id="so-mfg-items-table">
                ${so_mfg_build_items_table(so_items, made_map)}
            </div>

            <div class="so-mfg-footer-hint">
                Edit quantities if needed, then click "Review BOMs &amp; Check Stock →".
            </div>
        </div>
    `);

    function make_wh_ctrl(wrapper_id, placeholder) {
        const el = $w.find('#' + wrapper_id)[0];
        if (!el) return null;
        const ctrl = frappe.ui.form.make_control({
            parent: el,
            df: { fieldtype: 'Link', fieldname: wrapper_id, options: 'Warehouse', placeholder, reqd: 0 },
            render_input: true
        });
        ctrl.refresh();
        return ctrl;
    }

    const src_ctrl = make_wh_ctrl('so-mfg-src-wh-wrap', 'e.g. Stores - ATC');
    const tgt_ctrl = make_wh_ctrl('so-mfg-tgt-wh-wrap', 'e.g. Finished Goods - ATC');

    // Prefill FG warehouse from Stock Settings default
    frappe.call({
        method: 'frappe.client.get_value',
        args: { doctype: 'Stock Settings', fieldname: ['default_warehouse'] },
        callback(r) {
            const val = (r.message || {}).default_warehouse;
            if (val && tgt_ctrl) tgt_ctrl.set_value(val);
        }
    });

    window._so_mfg_ctrls    = { src_ctrl, tgt_ctrl };
    window._so_mfg_so_items = so_items;
    window._so_mfg_made_map = made_map;
    window._so_mfg_frm      = frm;
}

function so_mfg_build_items_table(so_items, made_map) {
    const rows = so_items.map(item => {
        const already = made_map[item.item_code];
        const checked = !already;

        const already_badge = already
            ? `<span class="so-mfg-made-badge">✓ ${already.qty.toFixed(2)} already made —
                ${already.ses.map(s =>
                    `<a href="/app/stock-entry/${encodeURIComponent(s)}" target="_blank"
                        class="so-mfg-link" style="font-size:10px">${frappe.utils.escape_html(s)}</a>`
                ).join(' ')}
               </span>`
            : '';

        return `<tr class="so-mfg-row ${already ? 'so-mfg-row-done' : ''}">
            <td class="so-mfg-td" style="width:36px;text-align:center">
                <input type="checkbox" class="so-mfg-chk"
                    data-item="${frappe.utils.escape_html(item.item_code)}"
                    ${checked ? 'checked' : ''}
                    style="width:15px;height:15px;cursor:pointer">
            </td>
            <td class="so-mfg-td">
                <div class="so-mfg-item-code">${frappe.utils.escape_html(item.item_code)}</div>
                ${item.item_name && item.item_name !== item.item_code
                    ? `<div class="so-mfg-item-name">${frappe.utils.escape_html(item.item_name)}</div>` : ''}
                ${already_badge}
            </td>
            <td class="so-mfg-td" style="width:130px">
                <input class="so-mfg-qty-input" type="number" min="0.001" step="any"
                    value="${item.qty}"
                    data-item="${frappe.utils.escape_html(item.item_code)}"
                    style="width:110px;text-align:right">
            </td>
            <td class="so-mfg-td so-mfg-td-uom">${frappe.utils.escape_html(item.uom || item.stock_uom || '')}</td>
        </tr>`;
    }).join('');

    return `<table class="so-mfg-table">
        <thead><tr>
            <th class="so-mfg-th" style="width:36px"></th>
            <th class="so-mfg-th">Finished Item</th>
            <th class="so-mfg-th" style="width:130px">Qty to Manufacture</th>
            <th class="so-mfg-th so-mfg-td-uom">UOM</th>
        </tr></thead>
        <tbody>${rows}</tbody>
    </table>`;
}

window.so_mfg_select_all = function (state) {
    document.querySelectorAll('.so-mfg-chk').forEach(chk => { chk.checked = state; });
};

// ═══════════════════════════════════════════════════════════════════════════════
//  COLLECT SELECTIONS → FETCH BOMs → CHECK STOCK → SHOW PREVIEW
// ═══════════════════════════════════════════════════════════════════════════════
function so_mfg_collect_and_preview(d, frm) {
    const ctrls = window._so_mfg_ctrls || {};
    const src   = ctrls.src_ctrl ? ctrls.src_ctrl.get_value() : '';
    const tgt   = ctrls.tgt_ctrl ? ctrls.tgt_ctrl.get_value() : '';

    if (!src || !tgt) {
        frappe.msgprint({ title: 'Warehouses Required', message: 'Please select both Source and Finished Goods warehouses.', indicator: 'orange' });
        return;
    }

    const selected = [];
    document.querySelectorAll('.so-mfg-chk:checked').forEach(chk => {
        const item_code = chk.dataset.item;
        // Find matching qty input by iterating instead of CSS selector
        let qty = 0;
        document.querySelectorAll('.so-mfg-qty-input').forEach(input => {
            if (input.dataset.item === item_code) qty = parseFloat(input.value) || 0;
        });
        if (item_code && qty > 0) selected.push({ item_code, qty });
    });

    if (!selected.length) {
        frappe.msgprint({ title: 'Nothing Selected', message: 'Please select at least one item and set a quantity > 0.', indicator: 'orange' });
        return;
    }

    window._so_mfg_state = { src, tgt, company: frm.doc.company || '', so_name: frm.doc.name };
    d.set_primary_action('Fetching BOMs…', null);

    let pending       = selected.length;
    const bom_results = {};

    selected.forEach(row => {
        frappe.call({
            method: 'frappe.client.get_list',
            args: {
                doctype: 'BOM',
                filters: [['item', '=', row.item_code], ['is_active', '=', 1], ['is_default', '=', 1]],
                fields: ['name', 'quantity'],
                limit: 1
            },
            callback(r) {
                const bom = r.message && r.message[0];
                if (bom) {
                    frappe.call({
                        method: 'frappe.client.get',
                        args: { doctype: 'BOM', name: bom.name },
                        callback(r2) {
                            const doc = r2.message;
                            bom_results[row.item_code] = {
                                bom_name: doc.name,
                                bom_qty:  parseFloat(doc.quantity) || 1,
                                items:    doc.items || []
                            };
                            if (--pending === 0) so_mfg_build_preview(d, frm, selected, bom_results, src, tgt);
                        },
                        error() {
                            bom_results[row.item_code] = null;
                            if (--pending === 0) so_mfg_build_preview(d, frm, selected, bom_results, src, tgt);
                        }
                    });
                } else {
                    bom_results[row.item_code] = null;
                    if (--pending === 0) so_mfg_build_preview(d, frm, selected, bom_results, src, tgt);
                }
            },
            error() {
                bom_results[row.item_code] = null;
                if (--pending === 0) so_mfg_build_preview(d, frm, selected, bom_results, src, tgt);
            }
        });
    });
}

function so_mfg_build_preview(d, frm, selected, bom_results, src, tgt) {
    const missing_bom  = [];
    const entry_plans  = [];
    const combined_raw = {};

    selected.forEach(row => {
        const bom = bom_results[row.item_code];
        if (!bom) { missing_bom.push(row.item_code); return; }

        const mult    = row.qty / (bom.bom_qty || 1);
        const raw_map = {};
        (bom.items || []).forEach(raw => {
            const rc = raw.item_code || raw.item;
            if (!rc) return;
            if (!raw_map[rc]) raw_map[rc] = { item_code: rc, qty: 0, uom: raw.stock_uom || raw.uom || '', item_group: raw.item_group || '' };
            raw_map[rc].qty += (parseFloat(raw.qty) || 0) * mult;
        });

        entry_plans.push({ item_code: row.item_code, qty: row.qty, bom_name: bom.bom_name, raw_lines: Object.values(raw_map) });

        Object.values(raw_map).forEach(r => {
            if (!combined_raw[r.item_code]) combined_raw[r.item_code] = { total_required: 0, uom: r.uom, item_group: r.item_group || '' };
            combined_raw[r.item_code].total_required += r.qty;
        });
    });

    const all_items = Object.keys(combined_raw);

    if (!all_items.length) {
        so_mfg_show_preview(d, frm, entry_plans, missing_bom, src, tgt, {});
        return;
    }

    d.set_primary_action('Checking stock…', null);

    const needs_group = all_items.filter(ic => !combined_raw[ic].item_group);

    const fetch_bins = () => {
    frappe.call({
        method: 'frappe.desk.reportview.get',
        args: {
            doctype: 'Bin',
            filters: JSON.stringify([
                ['item_code', 'in', all_items],
                ['warehouse', '=', src]
            ]),
            fields: JSON.stringify(['item_code', 'actual_qty']),
            limit_page_length: 500,
            limit_start: 0
        },
        callback(r) {
            const bin_map = {};
            const rows = (r.message && r.message.values) ? r.message.values : [];
            const keys = (r.message && r.message.keys) ? r.message.keys : [];
            const ic_idx  = keys.indexOf('item_code');
            const qty_idx = keys.indexOf('actual_qty');

            rows.forEach(row => {
                bin_map[row[ic_idx]] = parseFloat(row[qty_idx]) || 0;
            });

            const stock_data = {};
            all_items.forEach(ic => {
                const available = bin_map[ic] !== undefined ? bin_map[ic] : 0;
                const required  = combined_raw[ic].total_required;
                stock_data[ic]  = { available, required, shortage: Math.max(0, required - available), uom: combined_raw[ic].uom };
            });
            so_mfg_show_preview(d, frm, entry_plans, missing_bom, src, tgt, stock_data);
        },
        error() { so_mfg_show_preview(d, frm, entry_plans, missing_bom, src, tgt, {}); }
    });
};

    if (needs_group.length) {
        frappe.call({
            method: 'frappe.desk.reportview.get',
            args: {
                doctype: 'Item',
                filters: JSON.stringify([['name', 'in', needs_group]]),
                fields: JSON.stringify(['name', 'item_group']),
                limit_page_length: 500,
                limit_start: 0
            },
            callback(r) {
                const rows = (r.message && r.message.values) ? r.message.values : [];
                const keys = (r.message && r.message.keys) ? r.message.keys : [];
                const n_idx = keys.indexOf('name');
                const g_idx = keys.indexOf('item_group');
                rows.forEach(row => {
                    const name = row[n_idx];
                    const grp  = row[g_idx] || 'Other';
                    if (combined_raw[name]) combined_raw[name].item_group = grp;
                    entry_plans.forEach(plan => plan.raw_lines.forEach(r => {
                        if (r.item_code === name && !r.item_group) r.item_group = grp;
                    }));
                });
                fetch_bins();
            },
            error() { fetch_bins(); }
        });
    } else {
        fetch_bins();
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
//  PREVIEW SCREEN
// ═══════════════════════════════════════════════════════════════════════════════
function so_mfg_show_preview(d, frm, entry_plans, missing_bom, src, tgt, stock_data) {
    window._so_mfg_entry_plans = entry_plans;

    const global_raw = {};
    const all_raw    = [];
    entry_plans.forEach(plan => {
        plan.raw_lines.forEach(r => {
            if (!global_raw[r.item_code]) {
                global_raw[r.item_code] = { item_code: r.item_code, total_qty: 0, uom: r.uom, item_group: r.item_group || 'Other' };
                all_raw.push(global_raw[r.item_code]);
            }
            global_raw[r.item_code].total_qty += r.qty;
        });
    });

    const shortage_count = all_raw.filter(r => (stock_data[r.item_code] || {}).shortage > 0).length;

    const groups = {};
    all_raw.forEach(r => {
        const g = r.item_group || 'Other';
        if (!groups[g]) groups[g] = [];
        groups[g].push(r);
    });

    const group_html = Object.keys(groups).sort().map(group => {
        const grp    = groups[group];
        const shorts = grp.filter(r => (stock_data[r.item_code] || {}).shortage > 0);

        const rows = grp.map(r => {
            const sd       = stock_data[r.item_code] || {};
            const avail    = sd.available !== undefined ? sd.available : null;
            const short    = sd.shortage  || 0;
            const is_short = short > 0;

            const avail_cell = avail !== null
                ? `<span class="so-mfg-stock-badge ${is_short ? 'so-mfg-stock-low' : 'so-mfg-stock-ok'}">${avail.toFixed(3)}</span>`
                : `<span class="so-mfg-stock-badge so-mfg-stock-na">—</span>`;

            const short_cell = avail !== null
                ? (is_short ? `<span class="so-mfg-shortage-badge">▼ ${short.toFixed(3)}</span>` : `<span class="so-mfg-ok-badge">✓ OK</span>`)
                : '—';

            return `<tr class="so-mfg-row ${is_short ? 'so-mfg-row-short' : ''}">
                <td class="so-mfg-td"><div class="so-mfg-item-code">${frappe.utils.escape_html(r.item_code)}</div></td>
                <td class="so-mfg-td" style="font-weight:600">${r.total_qty.toFixed(3)}</td>
                <td class="so-mfg-td so-mfg-td-uom">${frappe.utils.escape_html(r.uom)}</td>
                <td class="so-mfg-td" style="text-align:center">${avail_cell}</td>
                <td class="so-mfg-td" style="text-align:center">${short_cell}</td>
            </tr>`;
        }).join('');

        return `<div class="so-mfg-group-section">
            <div class="so-mfg-group-header ${shorts.length ? 'so-mfg-group-warn' : ''}"
                 onclick="so_mfg_toggle_group(this)" style="cursor:pointer">
                <span class="so-mfg-chevron">▶</span>
                <span class="so-mfg-group-name">${frappe.utils.escape_html(group)}</span>
                <span class="so-mfg-group-count">${grp.length} material${grp.length !== 1 ? 's' : ''}</span>
                ${shorts.length
                    ? `<span class="so-mfg-group-short-badge">⚠ ${shorts.length} short</span>`
                    : `<span class="so-mfg-group-ok-badge">✓ In stock</span>`}
            </div>
            <div class="so-mfg-group-body" style="display:none">
                <table class="so-mfg-table"><thead><tr>
                    <th class="so-mfg-th">Raw Material</th>
                    <th class="so-mfg-th" style="width:110px">Required</th>
                    <th class="so-mfg-th so-mfg-td-uom">UOM</th>
                    <th class="so-mfg-th" style="width:110px;text-align:center">Available</th>
                    <th class="so-mfg-th" style="width:110px;text-align:center">Shortage</th>
                </tr></thead><tbody>${rows}</tbody></table>
            </div>
        </div>`;
    }).join('');

    const missing_html = missing_bom.length
        ? `<div class="so-mfg-notice so-mfg-notice-warn">
               ⚠ No active default BOM found for: <b>${missing_bom.map(x => frappe.utils.escape_html(x)).join(', ')}</b> — these items will be skipped.
           </div>` : '';

    const plan_rows = entry_plans.map((p, i) => `
        <div class="so-mfg-plan-row">
            <span class="so-mfg-plan-badge">Entry ${i + 1}</span>
            <span class="so-mfg-plan-item">${frappe.utils.escape_html(p.item_code)}</span>
            <span class="so-mfg-plan-qty">→ ${p.qty} units</span>
            <span class="so-mfg-tag">${frappe.utils.escape_html(p.bom_name)}</span>
            <span style="font-size:11px;color:#666">${p.raw_lines.length} raw material${p.raw_lines.length !== 1 ? 's' : ''}</span>
        </div>`).join('');

    d.fields_dict.content.$wrapper.html(`
        <div class="so-mfg-wrap">
            <div class="so-mfg-header-card">
                <div class="so-mfg-icon">MFG</div>
                <div>
                    <div class="so-mfg-title">Preview — ${entry_plans.length} Manufacture Entr${entry_plans.length !== 1 ? 'ies' : 'y'}</div>
                    <div class="so-mfg-sub">SO: <b>${frappe.utils.escape_html(frm.doc.name)}</b>
                        &nbsp;·&nbsp; ${frappe.utils.escape_html(src)} → ${frappe.utils.escape_html(tgt)}</div>
                </div>
            </div>

            ${missing_html}

            <div class="so-mfg-stat-row so-mfg-mb">
                <div class="so-mfg-stat">
                    <div class="so-mfg-stat-num" style="color:#6ab0f5">${entry_plans.length}</div>
                    <div class="so-mfg-stat-lbl">Stock Entries</div>
                </div>
                <div class="so-mfg-stat">
                    <div class="so-mfg-stat-num" style="color:#f5c26a">${all_raw.length}</div>
                    <div class="so-mfg-stat-lbl">Raw Materials</div>
                </div>
                <div class="so-mfg-stat">
                    <div class="so-mfg-stat-num" style="color:${shortage_count > 0 ? '#f56a6a' : '#5ecf8e'}">${shortage_count}</div>
                    <div class="so-mfg-stat-lbl">Items Short</div>
                </div>
            </div>

            <div class="so-mfg-collapsible so-mfg-mb">
                <div class="so-mfg-collapsible-header" onclick="so_mfg_toggle_collapsible(this)">
                    ▶ Production Plan (${entry_plans.length} ${entry_plans.length !== 1 ? 'entries' : 'entry'})
                </div>
                <div class="so-mfg-collapsible-body" style="display:none">${plan_rows}</div>
            </div>

            <div class="so-mfg-section-label so-mfg-mb">Raw Materials — by Item Group</div>
            <div class="so-mfg-groups-wrap">
                ${group_html || '<div class="so-mfg-empty">No raw materials found in BOMs.</div>'}
            </div>

            <div style="margin-top:14px;display:flex;flex-direction:column;gap:8px">
                <label class="so-mfg-label">Remarks <span style="color:#f56a6a">*</span>
                    <span class="so-mfg-label-note">(added to all Stock Entries)</span></label>
                <textarea id="so-mfg-remarks" rows="2"
                    style="width:100%;background:#16161c;border:1px solid #3a3a48;border-radius:6px;
                           padding:7px 10px;font-size:13px;color:#e2e2e8;resize:vertical;outline:none;"
                    placeholder="e.g. Manufactured against SAL-ORD-2026-00030"></textarea>
                <button class="so-mfg-btn-ghost" onclick="so_mfg_go_back()">← Back</button>
            </div>
        </div>
    `);

    d.set_primary_action(
        entry_plans.length > 0
            ? `🏭 Create ${entry_plans.length} Manufacture Entr${entry_plans.length !== 1 ? 'ies' : 'y'}`
            : '← Back',
        entry_plans.length > 0
            ? () => so_mfg_create_entries(d, frm)
            : () => so_mfg_go_back()
    );
}

window.so_mfg_toggle_group = function (header) {
    const body    = header.nextElementSibling;
    const chevron = header.querySelector('.so-mfg-chevron');
    const isOpen  = body.style.display !== 'none';
    body.style.display  = isOpen ? 'none' : 'block';
    if (chevron) chevron.textContent = isOpen ? '▶' : '▼';
};

window.so_mfg_toggle_collapsible = function (header) {
    const body   = header.nextElementSibling;
    const isOpen = body.style.display !== 'none';
    body.style.display = isOpen ? 'none' : 'block';
    header.textContent = header.textContent.replace(isOpen ? '▼' : '▶', isOpen ? '▶' : '▼');
};

window.so_mfg_go_back = function () {
    if (window._so_mfg_frm) so_mfg_open_dialog(window._so_mfg_frm);
};

// ═══════════════════════════════════════════════════════════════════════════════
//  CREATE MANUFACTURE STOCK ENTRIES
// ═══════════════════════════════════════════════════════════════════════════════
function so_mfg_create_entries(d, frm) {
    const { src, tgt, company, so_name } = window._so_mfg_state;
    const remarks_el = d.fields_dict.content.$wrapper.find('#so-mfg-remarks')[0];
    const remarks = (remarks_el ? remarks_el.value : '') || '';
    if (!remarks.trim()) {
        frappe.msgprint({ title: 'Remarks Required', message: 'Please enter remarks before creating entries.', indicator: 'orange' });
        return;
    }
    const entry_plans = window._so_mfg_entry_plans || [];
    const se_names    = [];
    let index         = 0;

    function do_next() {
        if (index >= entry_plans.length) {
            d.hide();
            const count = se_names.length;
            if (!count) {
                frappe.msgprint({ title: 'Nothing Created', message: 'No Stock Entries were created.', indicator: 'orange' });
                return;
            }
            if (count === 1) {
                frappe.show_alert({ message: `✓ <b>${se_names[0]}</b> created & submitted.`, indicator: 'green' }, 8);
                frappe.set_route('Form', 'Stock Entry', se_names[0]);
            } else {
                frappe.show_alert({ message: `✓ ${count} Manufacture entries submitted for SO <b>${so_name}</b>`, indicator: 'green' }, 10);
            }
            frm.reload_doc();
            return;
        }

        const plan = entry_plans[index];
        d.set_primary_action(`Creating (${index + 1}/${entry_plans.length}) ${plan.item_code}…`, null);

        frappe.call({
            method: 'frappe.client.get_value',
            args: { doctype: 'Item', filters: plan.item_code, fieldname: ['stock_uom'] },
            callback(r_meta) {
                const stock_uom = (r_meta.message || {}).stock_uom || '';

                const se_items = [
                    {
                        item_code:        plan.item_code,
                        qty:              plan.qty,
                        transfer_qty:     plan.qty,
                        uom:              stock_uom,
                        stock_uom:        stock_uom,
                        s_warehouse:      '',
                        t_warehouse:      tgt,
                        is_finished_item: 1
                    },
                    ...plan.raw_lines.map(r => ({
                        item_code:    r.item_code,
                        qty:          parseFloat(r.qty.toFixed(6)),
                        transfer_qty: parseFloat(r.qty.toFixed(6)),
                        uom:          r.uom,
                        stock_uom:    r.uom,
                        s_warehouse:  src,
                        t_warehouse:  ''
                    }))
                ];

                frappe.call({
                    method: 'frappe.client.insert',
                    args: {
                        doc: {
                            doctype:            'Stock Entry',
                            stock_entry_type:   'Manufacture',
                            purpose:            'Manufacture',
                            company:            company,
                            fg_completed_qty:   plan.qty,
                            bom_no:             plan.bom_name,
                            custom_sales_order: so_name,
                            remarks:            remarks,
                            from_warehouse:     src,
                            to_warehouse:       tgt,
                            items:              se_items
                        }
                    },
                    freeze: true,
                    freeze_message: `Creating Stock Entry for ${plan.item_code}…`,
                    callback(r_se) {
                        if (!r_se.message) {
                            frappe.msgprint({ title: 'Error', message: `Failed to create Stock Entry for <b>${plan.item_code}</b>.`, indicator: 'red' });
                            d.set_primary_action('Retry', () => so_mfg_create_entries(d, frm));
                            return;
                        }

                        frappe.call({
                            method: 'frappe.client.submit',
                            args: { doc: r_se.message },
                            freeze: true,
                            freeze_message: `Submitting ${r_se.message.name}…`,
                            callback() {
                                se_names.push(r_se.message.name);
                                index++;
                                do_next();
                            },
                            error() {
                                frappe.msgprint({
                                    title: 'Submit Warning',
                                    message: `<b>${r_se.message.name}</b> was saved but could not be submitted automatically. Please submit it manually.`,
                                    indicator: 'orange'
                                });
                                se_names.push(r_se.message.name);
                                index++;
                                do_next();
                            }
                        });
                    },
                    error() {
                        frappe.msgprint({ title: 'Error', message: `Failed to insert Stock Entry for <b>${plan.item_code}</b>.`, indicator: 'red' });
                        d.set_primary_action('Retry', () => so_mfg_create_entries(d, frm));
                    }
                });
            },
            error() {
                frappe.msgprint({ title: 'Warning', message: `Could not fetch metadata for ${plan.item_code}. Skipping.`, indicator: 'orange' });
                index++;
                do_next();
            }
        });
    }

    do_next();
}

// ═══════════════════════════════════════════════════════════════════════════════
//  STYLES  (scoped with so-mfg- prefix, dark theme)
// ═══════════════════════════════════════════════════════════════════════════════
function inject_so_mfg_styles() {
    if (document.getElementById('so-mfg-styles')) return;
    const s = document.createElement('style');
    s.id = 'so-mfg-styles';
    s.textContent = `
        .so-mfg-wrap  { padding:2px 0 4px; font-family:inherit; }
        .so-mfg-mb    { margin-bottom:14px; }
        .so-mfg-grid-2 { display:grid; grid-template-columns:1fr 1fr; gap:12px; }
        .so-mfg-field-wrap { display:flex; flex-direction:column; gap:5px; }
        .so-mfg-label { font-size:12px; color:#888898; }
        .so-mfg-label-note { font-weight:400; color:#505060; }

        .so-mfg-header-card {
            display:flex; align-items:center; gap:14px;
            background:#23232a; border:1px solid #2e2e38; border-radius:10px;
            padding:14px 18px; margin-bottom:16px;
        }
        .so-mfg-icon {
            width:40px; height:40px; border-radius:10px; flex-shrink:0;
            background:linear-gradient(135deg,#1a3a5a,#0e2038);
            border:1px solid #2a5a7a;
            display:flex; align-items:center; justify-content:center;
            font-size:11px; font-weight:700; color:#6ab0f5; letter-spacing:.05em;
        }
        .so-mfg-title { font-size:15px; font-weight:600; color:#e2e2e8; }
        .so-mfg-sub   { font-size:12px; color:#888898; margin-top:2px; }

        .so-mfg-section-label {
            font-size:11px; font-weight:600; text-transform:uppercase;
            letter-spacing:.08em; color:#888898; margin-bottom:8px;
        }

        .so-mfg-notice       { border-radius:6px; padding:8px 12px; font-size:12px; margin-bottom:10px; }
        .so-mfg-notice-warn  { background:#241a06; border:1px solid #5a3f0e; color:#f5c26a; }

        #so-mfg-src-wh-wrap label, #so-mfg-tgt-wh-wrap label { display:none !important; }
        #so-mfg-src-wh-wrap .form-control,
        #so-mfg-tgt-wh-wrap .form-control {
            background:#16161c !important; border:1px solid #3a3a48 !important;
            border-radius:6px !important; padding:7px 10px !important;
            font-size:13px !important; color:#e2e2e8 !important;
            box-shadow:none !important; height:auto !important; width:100%;
        }
        #so-mfg-src-wh-wrap .form-control:focus,
        #so-mfg-tgt-wh-wrap .form-control:focus { border-color:#6ab0f5 !important; outline:none !important; }

        .so-mfg-table-wrap {
            border:1px solid #2e2e38; border-radius:8px; overflow:hidden;
            max-height:340px; overflow-y:auto; margin-bottom:8px;
        }
        .so-mfg-table { width:100%; border-collapse:collapse; }
        .so-mfg-th {
            padding:8px 10px; font-size:11px; font-weight:600;
            text-transform:uppercase; letter-spacing:.06em;
            color:#888898; background:#1c1c24; border-bottom:1px solid #2e2e38;
            position:sticky; top:0; z-index:2;
        }
        .so-mfg-td {
            padding:8px 10px; font-size:13px; color:#e2e2e8;
            border-bottom:1px solid #2e2e38; vertical-align:middle;
        }
        .so-mfg-td-uom { font-size:11px; color:#888898; }
        .so-mfg-row:hover { background:#1c1c2a; }
        .so-mfg-row-done  { opacity:.65; }
        .so-mfg-row-short { background:#1e1010 !important; }
        .so-mfg-item-code { font-weight:600; font-size:13px; }
        .so-mfg-item-name { font-size:11px; color:#888898; margin-top:1px; }

        .so-mfg-qty-input {
            background:#16161c; border:1px solid #3a3a48; border-radius:5px;
            padding:5px 8px; font-size:13px; color:#e2e2e8;
            box-shadow:none; outline:none;
        }
        .so-mfg-qty-input:focus { border-color:#6ab0f5; }

        .so-mfg-made-badge {
            display:inline-block; margin-top:4px;
            background:#0a2010; border:1px solid #1a5a3a;
            color:#5ecf8e; border-radius:4px;
            padding:2px 7px; font-size:10px; font-weight:600;
        }

        .so-mfg-btn-ghost {
            background:transparent; border:1px solid #3a3a48; border-radius:5px;
            padding:4px 10px; font-size:12px; color:#888898; cursor:pointer;
            transition:border-color .15s, color .15s;
        }
        .so-mfg-btn-ghost:hover { border-color:#6ab0f5; color:#6ab0f5; }

        .so-mfg-footer-hint { font-size:11px; color:#505060; margin-top:6px; }

        .so-mfg-stat-row { display:grid; grid-template-columns:repeat(3,1fr); gap:10px; }
        .so-mfg-stat {
            background:#1c1c24; border:1px solid #2e2e38; border-radius:8px;
            padding:12px 14px; text-align:center;
        }
        .so-mfg-stat-num { font-size:22px; font-weight:700; line-height:1; }
        .so-mfg-stat-lbl { font-size:11px; color:#888898; margin-top:4px; }

        .so-mfg-collapsible { border:1px solid #2e2e38; border-radius:8px; overflow:hidden; }
        .so-mfg-collapsible-header {
            padding:10px 14px; background:#1c1c24; font-size:13px;
            font-weight:600; color:#b8b8c8; cursor:pointer; user-select:none;
        }
        .so-mfg-collapsible-header:hover { background:#22222e; }
        .so-mfg-collapsible-body { padding:10px 14px; }
        .so-mfg-plan-row {
            display:flex; align-items:center; gap:10px; padding:6px 0;
            border-bottom:1px solid #2a2a34; flex-wrap:wrap;
        }
        .so-mfg-plan-row:last-child { border-bottom:none; }
        .so-mfg-plan-badge {
            background:#1a2a3a; border:1px solid #2a4a6a;
            color:#6ab0f5; border-radius:4px; padding:2px 7px;
            font-size:11px; font-weight:700; white-space:nowrap;
        }
        .so-mfg-plan-item { font-size:13px; font-weight:600; color:#e2e2e8; }
        .so-mfg-plan-qty  { font-size:12px; color:#888898; }
        .so-mfg-tag {
            background:#201828; border:1px solid #3a2a4a;
            color:#b898d8; border-radius:4px; padding:2px 7px;
            font-size:11px; white-space:nowrap;
        }

        .so-mfg-groups-wrap { display:flex; flex-direction:column; gap:6px; }
        .so-mfg-group-section { border:1px solid #2e2e38; border-radius:8px; overflow:hidden; }
        .so-mfg-group-header {
            display:flex; align-items:center; gap:10px; flex-wrap:wrap;
            padding:9px 12px; background:#1c1c24; user-select:none;
        }
        .so-mfg-group-header:hover { background:#22222e; }
        .so-mfg-group-warn { background:#1e1808 !important; border-bottom:1px solid #5a3f0e; }
        .so-mfg-chevron      { font-size:10px; color:#888898; }
        .so-mfg-group-name   { font-size:13px; font-weight:600; color:#e2e2e8; flex:1; }
        .so-mfg-group-count  { font-size:11px; color:#888898; }
        .so-mfg-group-short-badge {
            background:#2a0e0e; border:1px solid #6a2a2a;
            color:#f56a6a; border-radius:4px; padding:2px 7px; font-size:11px;
        }
        .so-mfg-group-ok-badge {
            background:#0a2010; border:1px solid #1a5a3a;
            color:#5ecf8e; border-radius:4px; padding:2px 7px; font-size:11px;
        }
        .so-mfg-group-body { padding:0; }

        .so-mfg-stock-badge {
            display:inline-block; border-radius:4px; padding:2px 8px; font-size:12px; font-weight:600;
        }
        .so-mfg-stock-ok  { background:#0a2010; color:#5ecf8e; border:1px solid #1a5a3a; }
        .so-mfg-stock-low { background:#2a0e0e; color:#f56a6a; border:1px solid #6a2a2a; }
        .so-mfg-stock-na  { background:#1c1c24; color:#888898; border:1px solid #2e2e38; }
        .so-mfg-shortage-badge {
            display:inline-block; background:#2a0e0e; border:1px solid #6a2a2a;
            color:#f56a6a; border-radius:4px; padding:2px 8px; font-size:12px; font-weight:600;
        }
        .so-mfg-ok-badge {
            display:inline-block; background:#0a2010; border:1px solid #1a5a3a;
            color:#5ecf8e; border-radius:4px; padding:2px 8px; font-size:12px; font-weight:600;
        }

        .so-mfg-empty { padding:20px; text-align:center; color:#505060; font-size:13px; }

        .so-mfg-link { color:#6ab0f5; text-decoration:none; font-size:11px; }
        .so-mfg-link:hover { text-decoration:underline; }

        .so-mfg-banner {
            display:flex; align-items:flex-start; justify-content:space-between;
            flex-wrap:wrap; gap:10px;
            border:1px solid; border-radius:8px; padding:10px 14px;
            margin-bottom:10px; font-size:12px;
        }
        .so-mfg-banner-left  { display:flex; align-items:flex-start; gap:10px; flex-wrap:wrap; }
        .so-mfg-banner-right { display:flex; align-items:center; gap:8px; flex-wrap:wrap; }
        .so-mfg-status-dot   { width:9px; height:9px; border-radius:50%; flex-shrink:0; margin-top:3px; }
        .so-mfg-banner-label { font-weight:600; }
        .so-mfg-badge-row    { display:flex; gap:5px; flex-wrap:wrap; margin-top:4px; }
        .so-mfg-item-pill {
            background:#1c2030; border:1px solid #2a3a5a;
            color:#a0b8d8; border-radius:4px; padding:2px 8px; font-size:11px;
        }
        .so-mfg-dim { color:#505060; }
        .so-mfg-btn-refresh {
            background:transparent; border:1px solid #3a3a48; border-radius:4px;
            padding:2px 7px; font-size:12px; color:#888898; cursor:pointer;
        }
        .so-mfg-btn-refresh:hover { border-color:#6ab0f5; color:#6ab0f5; }
    `;
    document.head.appendChild(s);
}
