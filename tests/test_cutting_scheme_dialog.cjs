const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const js = path.join(__dirname, "../ss_coil/public/js");
const sandbox = {
  flt: (v) => Number.parseFloat(v) || 0,
  cint: (v) => Number.parseInt(v) || 0,
  ss_coil: { process: {} },
  frappe: { provide() {} },
};
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(js, "ss_coil_process_dimension.js"), "utf8"), sandbox);
const source = fs.readFileSync(path.join(js, "sales_order_form_v4.js"), "utf8");
function load(name) {
  const start = source.indexOf(`function ${name}(`);
  assert(start >= 0);
  const end = source.indexOf("\nfunction ", start + 1);
  vm.runInContext(source.slice(start, end < 0 ? undefined : end), sandbox);
}
for (const name of ["default_cutting_scheme_row_for_process", "sanitize_process_plan_rows",
  "carry_forward_row_to_process", "normalize_cutting_scheme_rows"]) load(name);
const coil = { qty: 9610, custom_thickness: 0.6, custom_width: 1219, custom_length: 0 };
const sheets = sandbox.ss_coil.process.cuttingSchemeTotalSheets;
assert.equal(sheets(coil, 1060), 1579);
assert.equal(sheets(coil, 0), 0);
assert.equal(sheets(coil, -1060), 0);
assert.equal(sheets({ ...coil, custom_thickness: 0 }, 1060), 0);
const saved = [{ width: 500, length: 1060, total_sheets: 0, strip: 1 }];
assert.equal(sandbox.sanitize_process_plan_rows(saved, "leveler", coil)[0].total_sheets, 1579);
assert.equal(sandbox.sanitize_process_plan_rows([{ ...saved[0], total_sheets: 1200 }], "leveler", coil)[0].total_sheets, 1200);
const carried = sandbox.carry_forward_row_to_process({ width: 500, strip: 3 }, "leveler", coil);
assert.equal(carried.width, 500);
assert.equal(carried.total_sheets, undefined, "Slitter strips must not become sheets without a length");
const withLength = sandbox.carry_forward_row_to_process({ width: 500, length: 1060 }, "leveler", coil);
assert.equal(withLength.total_sheets, 1579);
assert.equal(sheets(coil, 530), 3158, "Changing Length must recalculate the count");
console.log("PASS: cutting sheet formula, missing-count backfill, manual counts, and next-process carry");

// Reproduce a dialog row that is absent from document locals.
load("cutting_scheme_fieldname");
load("get_cutting_scheme_field");
load("bind_cutting_scheme_dialog_events");
const callbacks = [];
sandbox.setTimeout = (fn) => callbacks.push(fn);
let lengthHandler;
const wrapper = {
  find() { return { length: 0, css() {} }; },
  off() {},
  on(event, selector, handler) {
    if (selector.includes('[data-fieldname="length"]')) lengthHandler = handler;
  },
};
const gridDoc = { name: "scheme-row", width: 500, length: 1060, total_sheets: 0 };
let refreshed = false;
const grid = { wrapper, get_data: () => [gridDoc], grid_rows_by_docname: {
  "scheme-row": { doc: gridDoc, refresh_field(name) { refreshed = name === "total_sheets"; } },
} };
sandbox.$ = () => ({
  attr: (name) => name === "data-name" ? "scheme-row" : undefined,
  closest: () => ({ attr: () => "length" }),
});
sandbox.update_cutting_scheme_totals = () => {};
const dialog = { __processes: ["leveler"], __active_process: "leveler", __so_item_row: coil,
  fields_dict: { cutting_scheme_leveler: { grid } } };
sandbox.bind_cutting_scheme_dialog_events(dialog);
lengthHandler.call({});
assert.equal(gridDoc.total_sheets, 0, "Calculation waits for the control model update");
while (callbacks.length) callbacks.shift()();
assert.equal(gridDoc.total_sheets, 1579);
assert.equal(refreshed, true);
console.log("PASS: grid Length event recalculates Sheets without Dialog Table locals");
