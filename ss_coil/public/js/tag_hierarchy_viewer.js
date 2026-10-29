// Shared parent/child tag hierarchy viewer used by Sales Order and Stock Entry.
function open_ss_coil_tag_hierarchy_popup(config) {
	const rows = config.rows || [];
	const groups = (config.tag_groups || []).map((group) => {
		if (group.hierarchy?.tag_no) return group.hierarchy;
		return {
			tag_no: group.root_tag_no || group.root_trace?.tag_no || "-",
			status: group.root_trace?.registry?.status || "Active",
			item_name: group.root_trace?.registry?.item_name || "",
			children: (group.children || []).map((child) => ({
				tag_no: child.tag_no,
				status: child.registry?.status || "Produced",
				item_name: child.registry?.item_name || "",
				parent_tag_no: group.root_tag_no,
				children: [],
			})),
		};
	});
	const esc = (value) => frappe.utils.escape_html(String(value ?? "-"));
	const render_node = (node, query = "", depth = 0) => {
		if (!node?.tag_no) return "";
		const children = (node.children || []).map((child) => render_node(child, query, depth + 1)).filter(Boolean);
		const item = node.item_name || node.item_code || "";
		const current = [node.current_doctype, node.current_docname].filter(Boolean).join(" / ");
		const search_text = [node.tag_no, item, node.status, current, node.parent_tag_no].join(" ").toLowerCase();
		if (query && !search_text.includes(query) && !children.length) return "";
		const accent = depth === 0 ? "#1d4ed8" : depth === 1 ? "#0891b2" : "#7c3aed";
		return `<div style="min-width:0;width:100%;max-width:none;display:flex;flex-direction:column;align-items:stretch;">
		<details open style="width:100%;min-width:0;border:1px solid ${accent}55;border-top:3px solid ${accent};border-radius:12px;background:#fff;box-shadow:0 4px 12px #0f172a12;overflow:hidden;">
				<summary style="list-style:none;cursor:pointer;padding:9px 11px;background:linear-gradient(135deg,${accent}18,#fff);display:flex;align-items:center;justify-content:space-between;gap:8px;">
					<span style="font-size:12px;font-weight:850;color:${accent};overflow-wrap:anywhere;">${esc(node.tag_no)}</span>
					<span style="font-size:9px;font-weight:800;color:${accent};border:1px solid ${accent}55;border-radius:999px;padding:3px 7px;white-space:nowrap;">${esc(node.status || "Active")}</span>
				</summary>
				<div style="padding:8px 10px;color:#475569;font-size:10px;line-height:1.45;">
					${item ? `<div><b>${__("Item")}:</b> ${esc(item)}</div>` : ""}
					${node.parent_tag_no ? `<div><b>${__("Parent")}:</b> ${esc(node.parent_tag_no)}</div>` : depth === 0 ? `<div><b>${__("Type")}:</b> ${__("Parent / Root")}</div>` : ""}
					${current ? `<div style="margin-top:3px;"><b>${__("Current")}:</b> ${esc(current)}</div>` : ""}
				</div>
			${children.length ? `<div style="display:flex;justify-content:center;color:${accent};font-size:18px;font-weight:900;line-height:1;padding:2px 0 7px;">↓</div><div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(min(210px,100%),1fr));align-items:start;gap:12px;border-top:1px solid #dbe5ef;padding:12px 10px 10px;min-width:0;">${children.join("")}</div>` : ""}
			</details>
		</div>`;
	};
	const chart_html = (query = "") => groups.map((root) => render_node(root, query)).filter(Boolean).join('<div style="height:1px;background:#e2e8f0;margin:14px 0;"></div>') || `<div style="padding:28px;text-align:center;color:#64748b;">${__("No tag hierarchy found.")}</div>`;
	const html = `<div style="display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:10px;min-width:0;"><b style="color:#334155;">${rows.length} ${__("tags")} · ${groups.length} ${__("parent groups")}</b><input type="search" class="form-control input-sm ss-coil-tag-tree-search" placeholder="${__("Search tag, item, or status…")}" style="max-width:300px;"></div><div class="ss-coil-tag-tree-scroll" style="width:100%;max-width:100%;max-height:68vh;min-width:0;overflow:auto;overscroll-behavior:contain;box-sizing:border-box;padding:8px;border:1px solid #dbe5ef;border-radius:12px;background:linear-gradient(180deg,#f8fbff,#fff);"><div class="ss-coil-tag-tree-chart" style="display:grid;gap:14px;width:100%;min-width:0;">${chart_html()}</div></div>`;
	const dialog = new frappe.ui.Dialog({ title: config.title, size: "extra-large", fields: [{ fieldtype: "HTML", fieldname: "records" }], primary_action_label: __("Close"), primary_action() { dialog.hide(); } });
	dialog.fields_dict.records.$wrapper.html(html);
	dialog.fields_dict.records.$wrapper.css({ "min-width": 0, width: "100%", "max-width": "100%", overflow: "hidden" });
	dialog.fields_dict.records.$wrapper.on("input.ss_coil_tag_tree", ".ss-coil-tag-tree-search", function () {
		dialog.fields_dict.records.$wrapper.find(".ss-coil-tag-tree-chart").html(chart_html(String(this.value || "").trim().toLowerCase()));
	});
	dialog.show();
	dialog.$wrapper.addClass("ss-coil-tag-hierarchy-dialog");
	dialog.$wrapper.find(".modal-dialog").each(function () {
		this.style.setProperty("width", "min(94vw, 1080px)", "important");
		this.style.setProperty("max-width", "94vw", "important");
		this.style.setProperty("min-width", "0", "important");
	});
}
