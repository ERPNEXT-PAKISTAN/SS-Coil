frappe.provide("ss_coil");

const SCF_STEP_CONFIG = {
	"Stock Entry": {
		step: "01",
		save_label: __("Save Stock Entry"),
		next_label: __("Save & Create Sales Order"),
		open_label: __("Open Stock Entry"),
		create_actions: [{ id: "create_so", label: __("Create Sales Order"), accent: true }],
	},
	"Purchase Receipt": {
		step: "01",
		save_label: __("Save Purchase Receipt"),
		open_label: __("Open Purchase Receipt"),
		create_actions: [],
	},
	"Sales Order": {
		step: "02",
		save_label: __("Save Sales Order"),
		next_label: __("Save & Create SS Coil"),
		open_label: __("Open Sales Order"),
		create_actions: [
			{ id: "create_ss_coil", label: __("Create SS Coil"), accent: true },
			{ id: "create_stock_entry", label: __("Create Stock Entry") },
			{ id: "create_delivery_note", label: __("Create Delivery Note") },
		],
	},
	"SS Coil": {
		step: "03",
		save_label: __("Save SS Coil"),
		open_label: __("Open SS Coil"),
		create_actions: [
			{ id: "open_sales_order", label: __("Open Sales Order") },
			{ id: "create_ss_coil_from_so", label: __("Create SS Coil from SO") },
			{ id: "create_delivery_note", label: __("Create Delivery Note"), accent: true },
		],
	},
	"Delivery Note": {
		step: "04",
		save_label: __("Save Delivery Note"),
		next_label: __("Save & Create Sales Invoice"),
		open_label: __("Open Delivery Note"),
		create_actions: [{ id: "create_sales_invoice", label: __("Create Sales Invoice"), accent: true }],
	},
	"Sales Invoice": {
		step: "05",
		save_label: __("Save Sales Invoice"),
		open_label: __("Open Sales Invoice"),
		create_actions: [],
	},
};

frappe.pages["ss-coil-flow"].on_page_load = function (wrapper) {
	frappe.ui.make_app_page({
		parent: wrapper,
		title: __("SS Coil Flow"),
		single_column: true,
	});

	frappe.require("/assets/ss_coil/js/stock_entry.js?v=17", () => {
		frappe.require("/assets/ss_coil/js/flow_forms.js", () => {
			wrapper.ss_coil_flow = new ss_coil.SSCoilFlowPage(wrapper);
		});
	});

	frappe.breadcrumbs.add({ module: "SS Coil", type: "Page", name: "ss-coil-flow" });
};

ss_coil.SSCoilFlowPage = class SSCoilFlowPage {
	constructor(wrapper) {
		this.wrapper = wrapper;
		this.page = wrapper.page;
		this.$main = $(this.wrapper).find(".layout-main-section");
		this.active_doctype = "Stock Entry";
		this.saved_docs = {};
		this.render();
		this.load_stats();
		this.switch_form("Stock Entry");
	}

	render() {
		this.$main.html(`
			<div class="ss-coil-flow-page">
				<div class="scf-shell">
					<div class="scf-header">
						<div class="scf-title-row">
							<h3 class="scf-title">${__("SS Coil Process")}</h3>
							<span class="scf-badge"><span class="scf-badge-dot"></span>${__("Data entry workspace")}</span>
						</div>
						<button type="button" class="btn btn-default btn-sm scf-refresh">
							${frappe.utils.icon("refresh", "xs")} ${__("Refresh")}
						</button>
					</div>

					<div class="scf-track-wrap">
						<div class="scf-diagram">${this.get_diagram_html()}</div>
					</div>

					<div class="scf-work-panel ss-coil-data-entry-dialog">
						<div class="scf-panel-head ss-coil-de-block-title">
							<div class="scf-panel-head-left">
								<span class="ss-coil-de-block-icon">${frappe.utils.icon("edit", "sm")}</span>
								<div>
									<div class="scf-panel-step">${__("Step 01")}</div>
									<div class="scf-panel-title">${__("Stock Entry — Data Entry")}</div>
								</div>
							</div>
							<div class="scf-panel-meta">
								<span class="scf-saved-label">${__("Saved")}:</span>
								<span class="scf-saved-name">—</span>
							</div>
						</div>
						<div class="scf-data-entry-host"></div>
						<div class="scf-panel-actions">
							<div class="scf-panel-actions-main">
								<button type="button" class="btn btn-default btn-sm scf-btn-load">
									${frappe.utils.icon("search", "xs")} ${__("Load Saved")}
								</button>
								<button type="button" class="btn btn-default btn-sm scf-btn-reset">
									${frappe.utils.icon("reload", "xs")} ${__("Clear Form")}
								</button>
								<button type="button" class="btn btn-primary scf-btn-save">
									${frappe.utils.icon("save", "xs")} ${__("Save Stock Entry")}
								</button>
								<button type="button" class="btn scf-btn-next scf-btn-accent">
									${__("Save & Create Sales Order")} ${frappe.utils.icon("right", "xs")}
								</button>
								<button type="button" class="btn btn-default btn-sm scf-btn-open" disabled>
									${__("Open Stock Entry")}
								</button>
							</div>
							<div class="scf-panel-actions-create"></div>
						</div>
					</div>
				</div>
			</div>
		`);

		this.$panel_step = this.$main.find(".scf-panel-step");
		this.$panel_title = this.$main.find(".scf-panel-title");
		this.$saved_name = this.$main.find(".scf-saved-name");
		this.$data_host = this.$main.find(".scf-data-entry-host");
		this.$btn_save = this.$main.find(".scf-btn-save");
		this.$btn_next = this.$main.find(".scf-btn-next");
		this.$btn_open = this.$main.find(".scf-btn-open");
		this.$actions_create = this.$main.find(".scf-panel-actions-create");

		this.$main.find(".scf-refresh").on("click", () => this.load_stats());
		this.$main.find(".scf-btn-load").on("click", () => this.load_form());
		this.$main.find(".scf-btn-save").on("click", () => this.save_form(false));
		this.$main.find(".scf-btn-next").on("click", () => this.save_form(true));
		this.$main.find(".scf-btn-reset").on("click", () => this.reset_form());
		this.$main.find(".scf-btn-open").on("click", () => this.open_saved_doc());
		this.bind_step_actions();
	}

	get_diagram_html() {
		const steps = [
			{
				type: "branch",
				cards: [
					{ step: "01", title: __("Stock Entry"), doctype: "Stock Entry", icon: "stock", count_key: "stock_entry", color: "blue" },
					{ step: "01", title: __("Purchase Receipt"), doctype: "Purchase Receipt", icon: "buying", count_key: "purchase_receipt", color: "teal" },
				],
			},
			{ step: "02", title: __("Sales Order"), doctype: "Sales Order", icon: "sell", count_key: "sales_order", color: "orange" },
			{ step: "03", title: __("SS Coil"), doctype: "SS Coil", icon: "layers", count_key: "ss_coil", color: "purple" },
			{ step: "04", title: __("Delivery Note"), doctype: "Delivery Note", icon: "move", count_key: "delivery_note", color: "green" },
			{ step: "05", title: __("Sales Invoice"), doctype: "Sales Invoice", icon: "accounting", count_key: "sales_invoice", color: "navy" },
		];

		let html = "";
		steps.forEach((step, index) => {
			if (index) html += `<div class="scf-h-arrow" aria-hidden="true"></div>`;
			if (step.type === "branch") {
				html += `<div class="scf-start-branch">${step.cards
					.map((card, card_index) => {
						const or_pill = card_index === 0 ? `<div class="scf-or-pill">${__("OR")}</div>` : "";
						return `${this.step_card(card)}${or_pill}`;
					})
					.join("")}<div class="scf-branch-merge"></div></div>`;
				return;
			}
			html += this.step_card(step);
		});
		return html;
	}

	step_card({ step, title, icon, count_key, doctype, color }) {
		return `
			<div class="scf-step scf-step-${color || "blue"}" data-doctype="${frappe.utils.escape_html(doctype)}">
				<div class="scf-step-top">
					<span class="scf-step-icon">${frappe.utils.icon(icon, "sm")}</span>
					<div class="scf-step-heading">
						<div class="scf-step-label">${__("Step")} ${step}</div>
						<h4 class="scf-step-title">${title}</h4>
					</div>
					<div class="scf-step-open-wrap">
						<span class="scf-step-open-label">${__("open")}</span>
						<div class="scf-step-count" data-count-key="${count_key || ""}">—</div>
					</div>
				</div>
				<div class="scf-step-links">
					<button type="button" class="btn btn-xs scf-btn-list scf-step-list" data-doctype="${frappe.utils.escape_html(doctype)}">${__("List")}</button>
					<button type="button" class="btn btn-xs scf-btn-new scf-step-new" data-doctype="${frappe.utils.escape_html(doctype)}">${__("New")}</button>
				</div>
			</div>
		`;
	}

	bind_step_actions() {
		this.$main.on("click", ".scf-step-list", (e) => {
			e.stopPropagation();
			frappe.set_route("List", $(e.currentTarget).data("doctype"));
		});
		this.$main.on("click", ".scf-step-new", (e) => {
			e.stopPropagation();
			this.switch_form($(e.currentTarget).data("doctype"));
		});
		this.$main.on("click", ".scf-step", (e) => {
			if ($(e.target).closest(".scf-step-list, .scf-step-new").length) return;
			this.switch_form($(e.currentTarget).data("doctype"));
		});
		this.$main.on("click", ".scf-create-action", (e) => {
			const action = $(e.currentTarget).data("action");
			this.run_create_action(action);
		});
	}

	render_create_actions(doctype) {
		const config = SCF_STEP_CONFIG[doctype] || {};
		const actions = config.create_actions || [];
		if (!actions.length) {
			this.$actions_create.empty();
			return;
		}
		this.$actions_create.html(
			actions
				.map(
					(a) =>
						`<button type="button" class="btn btn-sm scf-create-action ${
							a.accent ? "scf-btn-accent" : "btn-default"
						}" data-action="${a.id}">${a.label}</button>`
				)
				.join("")
		);
	}

	switch_form(doctype) {
		this.active_doctype = doctype;
		this.$main.find(".scf-step").removeClass("scf-step-active");
		this.$main.find(`.scf-step[data-doctype="${doctype}"]`).addClass("scf-step-active");

		const config = SCF_STEP_CONFIG[doctype] || {};
		this.$panel_step.text(`${__("Step")} ${config.step || ""}`);
		this.$panel_title.text(`${doctype} — ${__("Data Entry")}`);
		this.$btn_save.html(`${frappe.utils.icon("save", "xs")} ${config.save_label || __("Save")}`);

		if (config.next_label) {
			this.$btn_next.show().html(`${config.next_label} ${frappe.utils.icon("right", "xs")}`);
		} else {
			this.$btn_next.hide();
		}

		this.$btn_open.text(config.open_label || __("Open Document"));
		this.render_create_actions(doctype);
		this.update_saved_state(this.saved_docs[doctype]);

		ss_coil.flow_forms.mount(this.$data_host, doctype);
	}

	get_saved_or_warn() {
		const name = this.saved_docs[this.active_doctype];
		if (!name) {
			frappe.msgprint(__("Save {0} first, then use create actions.", [this.active_doctype]));
			return null;
		}
		return name;
	}

	run_create_action(action_id) {
		if (action_id === "create_ss_coil_from_so") {
			const ss_coil_name = this.get_saved_or_warn();
			if (!ss_coil_name) return;
			this.run_create_action_impl(action_id, ss_coil_name);
			return;
		}
		const saved = this.get_saved_or_warn();
		if (!saved) return;
		this.run_create_action_impl(action_id, saved);
	}

	run_create_action_impl(action_id, saved) {
		const handlers = {
			on_created: (doc) => this.on_mapped_doc_created(doc),
		};

		switch (action_id) {
			case "create_so":
				ss_coil.flow_forms.create_sales_order_from_stock_entry(saved, handlers);
				break;
			case "create_ss_coil":
				ss_coil.flow_forms.open_create_ss_coil_dialog(saved, handlers);
				break;
			case "create_ss_coil_from_so":
				ss_coil.flow_forms.get_linked_sales_order(saved, (so) => {
					if (!so) {
						frappe.msgprint(__("No Sales Order linked on this SS Coil."));
						return;
					}
					ss_coil.flow_forms.open_create_ss_coil_dialog(so, handlers);
				});
				break;
			case "create_stock_entry":
				ss_coil.flow_forms.create_stock_entry_from_sales_order(saved, handlers);
				break;
			case "create_delivery_note":
				if (this.active_doctype === "SS Coil") {
					ss_coil.flow_forms.get_linked_sales_order(saved, (so) => {
						if (!so) {
							frappe.msgprint(__("No Sales Order linked on this SS Coil."));
							return;
						}
						ss_coil.flow_forms.create_delivery_note_from_sales_order(so, handlers);
					});
				} else {
					ss_coil.flow_forms.create_delivery_note_from_sales_order(saved, handlers);
				}
				break;
			case "create_sales_invoice":
				ss_coil.flow_forms.create_sales_invoice_from_delivery_note(saved, handlers);
				break;
			case "open_sales_order":
				ss_coil.flow_forms.get_linked_sales_order(saved, (so) => {
					if (so) frappe.set_route("Form", "Sales Order", so);
					else frappe.msgprint(__("No Sales Order linked on this SS Coil."));
				});
				break;
		}
	}

	on_mapped_doc_created(doc) {
		if (!doc || !doc.doctype) return;
		ss_coil.flow_forms.sync_mapped_doc(doc.doctype, doc, {
			on_created: (synced) => {
				frappe.show_alert({
					message: __("{0} prepared — review and save", [synced.doctype]),
					indicator: "green",
				});
			},
		});
	}

	reset_form() {
		delete this.saved_docs[this.active_doctype];
		this.update_saved_state(null);
		ss_coil.flow_forms.reset(this.$data_host, this.active_doctype);
	}

	load_form() {
		ss_coil.flow_forms.prompt_load_document(this.active_doctype, (name) => {
			ss_coil.flow_forms.load(this.$data_host, this.active_doctype, name, {
				on_loaded: (loaded_name) => {
					this.saved_docs[this.active_doctype] = loaded_name;
					this.update_saved_state(loaded_name);
					frappe.show_alert({
						message: __("{0} {1} loaded", [this.active_doctype, loaded_name]),
						indicator: "blue",
					});
				},
			});
		});
	}

	save_form(and_next) {
		ss_coil.flow_forms.save(this.$data_host, {
			on_saved: (name) => {
				this.saved_docs[this.active_doctype] = name;
				this.update_saved_state(name);
				frappe.show_alert({
					message: __("{0} {1} saved", [this.active_doctype, name]),
					indicator: "green",
				});
				this.load_stats();
				if (and_next) this.run_next_step(name);
			},
		});
	}

	run_next_step(saved_name) {
		if (this.active_doctype === "Stock Entry") {
			ss_coil.flow_forms.create_sales_order_from_stock_entry(saved_name, {
				on_created: (doc) => {
					this.saved_docs["Sales Order"] = doc.name;
					this.on_mapped_doc_created(doc);
				},
			});
			return;
		}
		if (this.active_doctype === "Sales Order") {
			ss_coil.flow_forms.open_create_ss_coil_dialog(saved_name, {
				on_created: (doc) => {
					this.saved_docs["SS Coil"] = doc.name;
					this.on_mapped_doc_created(doc);
				},
			});
			return;
		}
		if (this.active_doctype === "Delivery Note") {
			ss_coil.flow_forms.create_sales_invoice_from_delivery_note(saved_name, {
				on_created: (doc) => {
					this.saved_docs["Sales Invoice"] = doc.name;
					this.on_mapped_doc_created(doc);
				},
			});
		}
	}

	update_saved_state(name) {
		this.$saved_name.text(name || "—");
		this.$btn_open.prop("disabled", !name);
	}

	open_saved_doc() {
		ss_coil.flow_forms.open_document(this.active_doctype, this.saved_docs[this.active_doctype]);
	}

	load_stats() {
		frappe.call({
			method: "ss_coil.ss_coil.page.ss_coil_flow.ss_coil_flow.get_ss_coil_flow_stats",
			callback: (r) => {
				const stats = r.message || {};
				this.$main.find(".scf-step-count[data-count-key]").each(function () {
					const key = $(this).data("count-key");
					const value = stats[key];
					$(this).text(value === undefined || value === null ? "—" : String(parseInt(value, 10) || 0));
				});
			},
		});
	}
};
