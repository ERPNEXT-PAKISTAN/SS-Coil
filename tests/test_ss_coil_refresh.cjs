const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const source = fs.readFileSync(path.join(__dirname, "../ss_coil/ss_coil/doctype/ss_coil/ss_coil.js"), "utf8");
const sandbox = {
  flt: (v, p) => p == null ? Number(v) || 0 : Number((Number(v) || 0).toFixed(p)),
  precision: () => 9,
  ss_coil: { process: {}, formulas: {} },
  frappe: { provide() {} },
  render_ss_coil_formulas() {},
};
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(__dirname, "../ss_coil/public/js/ss_coil_process_dimension.js"), "utf8"), sandbox);
function load(name) {
  const start = source.indexOf(`function ${name}(`);
  const end = source.indexOf("\nfunction ", start + 1);
  vm.runInContext(source.slice(start, end < 0 ? undefined : end), sandbox);
}
for (const name of ["set_ss_coil_calculated_value", "update_grand_totals", "update_calc_ratio", "update_remaining_width", "sync_linked_stock_entry_field"]) load(name);
sandbox.ss_coil.formulas.calc_ratio_value = (frm) => frm.doc.grand_estimated_wt / frm.doc.input_coil[0].estimated_wt * 100;
const writes = [];
const frm = { doc: {
  operation: "Slitter", calc_ratio: 90.237899918, grand_estimated_wt: 8671.862182116,
  grand_total_width: 1100, remaining_width: 119,
  so_item: [{ width: 1219 }], input_coil: [{ estimated_wt: 9610 }],
  cutting_detail: [{ width: 500, strip: 1 }, { width: 600, strip: 1 }],
  job_output: [{ estimated_wt: 3941.755537326 }, { estimated_wt: 4730.106644791 }],
  order_no: "SAL-ORD-2026-00001", stock_entry: "MAT-STE-2026-00005",
}, set_value(name, value) { writes.push(name); this.doc[name] = value; } };
for (let i = 0; i < 5; i++) sandbox.update_grand_totals(frm);
assert.deepEqual(writes, [], "Repeated refresh must not dirty saved rounded calculations");
frm.doc.cutting_detail[0].width = 450;
sandbox.update_grand_totals(frm);
assert.equal(frm.doc.grand_total_width, 1050);
assert.equal(frm.doc.remaining_width, 169);
assert(writes.includes("grand_total_width"));
writes.length = 0;
sandbox.set_stock_entry_field_description = () => {};
for (const entries of [[], [{ name: "OTHER-ENTRY" }]]) {
  sandbox.frappe.call = ({ callback }) => callback({ message: entries });
  sandbox.sync_linked_stock_entry_field(frm, true);
  assert.equal(frm.doc.stock_entry, "MAT-STE-2026-00005");
}
assert.deepEqual(writes, [], "Description refresh must preserve the saved Stock Entry");
console.log("PASS: saved SS Coil calculations stay clean across refreshes; real edits calculate; source link preserved");
