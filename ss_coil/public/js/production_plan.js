// Migrated from the DB-stored Client Script "Production Plan-Client" into
// the app codebase so it's version-controlled like everything else here.
// Behavior unchanged - only the location moved. Unrelated to the coil/tag
// system (standard ERPNext Production Plan), kept here for consistency with
// the other client-script-to-app migrations (see ARCHITECTURE.md).

frappe.ui.form.on("Production Plan", {
	onload(frm) {
		if (frm.is_new() && frm.doc.create_work_orders_after_submit !== 1) {
			frm.set_value("create_work_orders_after_submit", 1);
		}
	},
});
