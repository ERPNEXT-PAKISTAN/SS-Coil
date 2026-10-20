frappe.query_reports["SS Coil Sales Report"] = {
 filters: [
  {fieldname: "company", label: __("Company"), fieldtype: "Link", options: "Company", reqd: 1, default: frappe.defaults.get_user_default("Company")},
  {fieldname: "from_date", label: __("From Date"), fieldtype: "Date"},
  {fieldname: "to_date", label: __("To Date"), fieldtype: "Date", default: frappe.datetime.get_today()},
  {fieldname: "customer", label: __("Customer"), fieldtype: "Link", options: "Customer"},
  {fieldname: "scrap_item", label: __("Scrap Item"), fieldtype: "Link", options: "Item"},
  {fieldname: "scrap_item_group", label: __("Scrap Item Group"), fieldtype: "Link", options: "Item Group"}
 ]
};
