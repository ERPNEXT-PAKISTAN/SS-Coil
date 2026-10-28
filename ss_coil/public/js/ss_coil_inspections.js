/* HTML inspection worksheets backed by the existing document and child rows. */
frappe.provide("ss_coil.inspections");

// Each numbered Form 2 column is one existing Inspection Measurements 2 record.
ss_coil.inspections.form2_checkpoints = [
 ['Thickness', [['thickness_ds', 'DS'], ['thickness_c', 'C'], ['thickness_ws', 'WS']]],
 ['Width', [['width_head', 'Head'], ['width_tail', 'Tail']]],
 ['Length', [['length_l1', 'L1'], ['length_l2', 'L2']]],
 ['Diagonal', [['diagonal_a', 'A'], ['diagonal_b', 'B'], ['diagonal_difference', 'A−B']]],
 ['Flatness', [['flatness_ds', 'DS'], ['flatness_c', 'C'], ['flatness_ws', 'WS']]],
 ['Camber', [['camber', 'C']]],
 ['Burr', [['burr_thickness', 'Thick (T)'], ['burr_cut', 'Cut (C)'], ['burr_difference', 'B=C−T']]],
 ['Appearance', ['dent', 'pimple', 'dimple', 'bump', 'scratch', 'rust', 'abrasion', 'dirty', 'stain', 'passed', 'reject'].map(name => [`appearance_${name}`, name[0].toUpperCase() + name.slice(1)])],
];

ss_coil.inspections.render = function (frm) {
 const panels = [
  ["custom_inspection_form1", "custom_slitter_inspection_sheet_1", "inspection_report_tab", "Slitter", "Head, centre and tail measurements"],
  ["custom_inspection_form2", "slitter_inspection_sheet_2", "inspection_report_2_tab", "Leveler", "Dimensional ranges and surface quality"],
  ["custom_reshearing_inspection_form", "reshearing_inspection_sheet", "inspection_report_3_tab", "Reshearing", "Dimensional ranges and surface quality"],
 ];
 const outputTags = [...new Set((frm.doc.job_output || []).map(row => row.tag_no).filter(Boolean))];
 const inspectionTable = {Slitter: "custom_slitter_inspection_sheet_1", Leveler: "slitter_inspection_sheet_2", Reshearing: "reshearing_inspection_sheet"}[frm.doc.operation];
 frm.__inspection_active_tags = frm.__inspection_active_tags || {};
 const inspectionTag = frm.__inspection_active_tags[inspectionTable] || outputTags[0] || "";
 const outputRow = (frm.doc.job_output || []).find(row => row.tag_no === inspectionTag);
 const inspectionWidth = outputRow?.width || "";
 const contextKey = `${frm.doc.name}|${frm.doc.order_no || ""}|${frm.doc.sales_order_item || ""}|${frm.doc.operation || ""}|${inspectionTag}|${inspectionWidth}`;
 if (frm.__inspection_context_key !== contextKey) {
  frm.__inspection_context_key = contextKey;
  frm.__inspection_context = {};
  frappe.call({
   method: "ss_coil.inspection_setup.get_inspection_context",
   args: frm.is_new()
    ? {sales_order: frm.doc.order_no, sales_order_item: frm.doc.sales_order_item, operation: frm.doc.operation, inspection_tag: inspectionTag, output_width: inspectionWidth}
    : {ss_coil: frm.doc.name, inspection_tag: inspectionTag},
   callback: response => {
    if (frm.__inspection_context_key !== contextKey) return;
    frm.__inspection_context = response.message || {};
    ss_coil.inspections.render(frm);
   },
  });
 }
 const locked = ["Completed", "Closed"].includes(frm.doc.order_status) &&
  !frappe.user.has_role("System Manager") && !frm.doc.process_control_enabled;
 const writable = !!frm.perm?.some(p => p.write || (frm.is_new() && p.create)) && frm.doc.docstatus === 0 && !locked;
 const style = `<style>
 .ss-inspection.ss-coil-data-entry-dialog{color:var(--text-color);padding:0;gap:0}
 .ss-inspection .inspection-muted{color:var(--text-muted);font-size:11px;margin:0;padding:4px 8px}
 .ss-inspection.ss-coil-data-entry-dialog .ss-coil-de-parent-block,
 .ss-inspection.ss-coil-data-entry-dialog .ss-coil-de-items-block{padding:0;margin:0;border-radius:0;box-shadow:none;background:var(--fg-color)}
 .ss-inspection .inspection-heading>summary{display:flex;align-items:center;gap:6px;padding:5px 8px;cursor:pointer;font-size:12px;font-weight:600;list-style:none;line-height:20px}
 .ss-inspection .inspection-heading>summary::-webkit-details-marker{display:none}
 .ss-inspection .inspection-heading>summary:before{content:'▸'}
 .ss-inspection .inspection-heading[open]>summary:before{content:'▾'}
 .ss-inspection .inspection-heading-fields{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:6px 12px;padding:8px}
 .ss-inspection .inspection-heading-fields label{font-size:11px;font-weight:600;margin:0 0 2px;display:block}
 .ss-inspection .inspection-heading-fields .inspection-cell{border:1px solid var(--border-color);border-radius:3px;height:26px}
 .ss-inspection .ss-coil-de-items-block>.ss-coil-de-block-title{margin:0;padding:4px 8px;border-bottom:1px solid var(--border-color);line-height:20px}
 .ss-inspection .inspection-output-tabs{display:flex;flex-wrap:wrap;gap:4px;padding:6px 8px;border-bottom:1px solid var(--border-color);background:var(--subtle-fg)}
 .ss-inspection .inspection-output-tab{border:1px solid var(--border-color);border-radius:4px;background:var(--fg-color);color:var(--text-color);padding:4px 10px;font-size:12px;cursor:pointer}
 .ss-inspection .inspection-output-tab.active{border-color:var(--primary);background:var(--primary);color:#fff;font-weight:600}
 .ss-inspection .inspection-scroll.ss-coil-de-table-wrap{overflow:auto;max-height:520px;border:0;border-radius:0;margin:0}
 .ss-inspection table.ss-coil-de-table{border-collapse:separate;border-spacing:0;width:100%;font-size:11px;background:var(--fg-color)}
 .ss-inspection .ss-coil-de-table th,.ss-inspection .ss-coil-de-table td{border-right:1px solid var(--border-color);border-bottom:1px solid var(--border-color);padding:0}
 .ss-inspection .ss-coil-de-table tbody tr,.ss-inspection .ss-coil-de-table tbody td{height:24px;max-height:24px}
 .ss-inspection .ss-coil-de-table thead th{position:sticky;min-width:72px;text-align:center;white-space:nowrap;z-index:2;padding:3px 4px}
 .ss-inspection .ss-coil-de-table .inspection-group-row th{top:0;height:24px;background:var(--subtle-fg);font-size:11px;letter-spacing:0;text-transform:none;padding:2px 4px}
 .ss-inspection .ss-coil-de-table .inspection-field-row th{top:24px;height:24px;font-size:11px;background:var(--subtle-fg)}
 .ss-inspection .inspection-cell{display:block;box-sizing:border-box;width:100%;min-width:72px;border:0;border-radius:0;background:var(--fg-color);color:var(--text-color);padding:2px 4px;height:23px;font-size:11px;line-height:19px;outline:none}
 .ss-inspection input[type=number]{appearance:textfield;-moz-appearance:textfield}
 .ss-inspection input[type=number]::-webkit-inner-spin-button,.ss-inspection input[type=number]::-webkit-outer-spin-button{appearance:none;margin:0}
 .ss-inspection .inspection-cell:focus{box-shadow:inset 0 0 0 2px var(--primary)}
 .ss-inspection .inspection-cell:disabled{opacity:1;color:var(--text-muted)}
 .ss-inspection .ss-coil-de-table .inspection-row-number{min-width:28px;width:28px;text-align:center;background:var(--subtle-fg);padding:0}
 .ss-inspection .ss-coil-de-table .inspection-row-action{position:sticky;right:0;min-width:28px;width:28px;text-align:center;background:var(--fg-color);padding:0;z-index:3}
 .ss-inspection .ss-coil-de-table thead .inspection-row-action{z-index:4;background:var(--subtle-fg)}
 .ss-inspection .inspection-remove{display:block;width:100%;height:23px;padding:0;border:0;background:transparent;color:var(--text-muted);font-size:16px;line-height:23px;cursor:pointer}
 .ss-inspection .ss-coil-de-table .inspection-checkpoint-group{position:sticky;left:0;min-width:100px;width:100px;z-index:1;text-align:center;vertical-align:middle;font-weight:600;padding:3px 8px}
 .ss-inspection .ss-coil-de-table .inspection-checkpoint-label{position:sticky;left:100px;min-width:72px;width:72px;background:var(--fg-color);z-index:1;padding:2px 6px;text-align:center;font-weight:500}
 .ss-inspection .ss-coil-de-table .inspection-checkpoint-head{top:0;z-index:4;background:var(--subtle-fg);height:24px}
 .ss-inspection .inspection-column-number{display:inline-block;line-height:23px;vertical-align:middle}
 .ss-inspection .inspection-column-remove{display:inline-block;width:18px;margin-left:4px;vertical-align:middle}
 .ss-inspection .inspection-footer{border-top:1px solid var(--border-color)}
 .ss-inspection .inspection-footer{grid-template-columns:minmax(220px,2fr) repeat(4,minmax(130px,1fr));align-items:start}
 .ss-inspection .inspection-footer>div{display:flex;flex-direction:column;min-width:0;align-self:start}
 .ss-inspection .inspection-footer>div>label{min-height:17px;line-height:17px}
 .ss-inspection .inspection-footer .frappe-control,.ss-inspection .inspection-footer .form-group{width:100%;min-width:0;margin:0!important;padding:0!important}
 .ss-inspection .inspection-footer .frappe-control .control-input{width:100%;max-width:none}
 .ss-inspection .inspection-footer .frappe-control input.form-control{height:26px;min-height:26px}
 .ss-inspection .inspection-footer textarea.inspection-cell{height:52px;resize:vertical}
 .ss-inspection .inspection-checkpoint-scroll.ss-coil-de-table-wrap{max-height:none}
 .ss-inspection .inspection-header-tables{display:grid;grid-template-columns:minmax(240px,1fr) minmax(560px,2fr);gap:0;overflow-x:auto;border-top:1px solid var(--border-color)}
 .ss-inspection .inspection-details-table th,.ss-inspection .inspection-details-table td{border:1px solid var(--border-color);padding:3px 6px;font-size:11px;text-align:left}
 .ss-inspection .inspection-details-table th{background:var(--subtle-fg);width:110px;font-weight:600}
 .ss-inspection .inspection-tolerance-table{align-self:start}
 .ss-inspection .inspection-tolerance-table th,.ss-inspection .inspection-tolerance-table td{border:1px solid var(--border-color);text-align:center;font-size:11px;padding:0}
 .ss-inspection .inspection-tolerance-table th{background:var(--subtle-fg);padding:4px}
 .ss-inspection .inspection-tolerance-table .inspection-cell{min-width:60px;height:26px}
 .ss-inspection .inspection-company-line{display:flex;flex-wrap:wrap;gap:4px 18px;padding:4px 8px;font-size:11px}
 .ss-inspection .inspection-header-tables table{border-collapse:collapse}
 .ss-inspection .inspection-details-table th,.ss-inspection .inspection-details-table td,
 .ss-inspection .inspection-tolerance-table th,.ss-inspection .inspection-tolerance-table td{border-color:#94a3b8}
 .ss-inspection .inspection-details-table th{background:#e2e8f0;color:#334155}
 .ss-inspection .inspection-tolerance-table .inspection-tolerance-title{background:#1e3a5f;color:#fff;border-color:#64748b;letter-spacing:.04em}
 .ss-inspection .inspection-tolerance-table thead th{border-color:#94a3b8}
 .ss-inspection .ss-coil-de-table thead th{border-right-color:#94a3b8;border-bottom-color:#94a3b8}
 .ss-inspection .ss-coil-de-table .inspection-checkpoint-head{background:#dbeafe;color:#1e3a5f;border-color:#94a3b8}
 .ss-inspection .ss-coil-de-table .inspection-checkpoint-group,
 .ss-inspection .ss-coil-de-table .inspection-checkpoint-label{border-right-color:#94a3b8;border-bottom-color:#94a3b8}
 .ss-inspection .inspection-remove:hover{color:var(--red-500);background:var(--subtle-fg)}
 </style>`;
 // Plain HTML inputs keep the worksheet compact, without form labels in every cell.
 const makeCell = (parent, field, value, save) => {
  let input;
  if (field.fieldtype === "Link") {
   let control;
   control = frappe.ui.form.make_control({
    parent: parent[0], only_input: true,
    df: {...field, only_input: true, label: ""}, render_input: true,
   });
   control.$wrapper.find(".tooltip-content").remove();
   control.set_value(value || "").then(() => {
    control.df.change = () => save(control.get_value());
   });
   control.$input.prop('disabled', !writable || !!field.read_only);
   return;
  } else if (field.fieldtype === "Select") {
   input = $('<select></select>');
   const options = Array.isArray(field.options) ? field.options : (field.options || "").split("\n");
   options.forEach(option => $('<option></option>').val(option).text(option).appendTo(input));
  } else {
   const type = field.fieldtype === "Date" ? "date" : ["Float", "Int", "Currency", "Percent"].includes(field.fieldtype) ? "number" : "text";
   input = field.fieldtype === "Small Text" ? $('<textarea rows="2"></textarea>') : $('<input>').attr('type', type);
   if (type === "number") input.attr('step', field.fieldtype === "Int" ? "1" : "any");
  }
  input.addClass('inspection-cell').attr('aria-label', __(field.label || field.fieldname))
   .val(value ?? "").prop('disabled', !writable || !!field.read_only).appendTo(parent);
  input.on('input change', () => {
   if (!writable || field.read_only || !input[0].checkValidity()) return;
   let next = input.val();
   if (["Float", "Int", "Currency", "Percent"].includes(field.fieldtype)) next = next === "" ? 0 : Number(next);
   save(next);
  });
  input.on('keydown', event => {
   if (event.key !== 'Enter' && !['ArrowUp', 'ArrowDown'].includes(event.key)) return;
   const cell = input.closest('td');
   const direction = event.key === 'ArrowUp' || (event.key === 'Enter' && event.shiftKey) ? 'prev' : 'next';
   const inputs = cell.parent().find('td .inspection-cell');
   const target = cell.parent()[direction]('tr').find('td .inspection-cell').eq(inputs.index(input));
   if (target.length) { event.preventDefault(); target.trigger('focus'); }
  });
 };
 const groupName = field => {
  const name = field.fieldname;
  if (name.startsWith('appearance_')) return 'Appearance';
  if (name.startsWith('thickness_')) return 'Thickness';
  if (name.startsWith('width_')) return 'Width';
  if (name.startsWith('length_') || name.startsWith('length1_')) return 'Length';
  if (name.startsWith('diagonal_')) return 'Diagonal';
  if (name.startsWith('flatness_')) return 'Flatness';
  if (name.startsWith('burr_')) return 'Burr';
  if (name === 'camber') return 'Camber';
  if (name === 'api_st') return 'API';
  return 'Other measurements';
 };
 const groupColors = {
  'Thickness': ['#dbeafe', '#1e40af'],
  'Width': ['#dcfce7', '#166534'],
  'Length': ['#fef3c7', '#92400e'],
  'Weight': ['#e0f2fe', '#075985'],
  'Edge Wave': ['#cffafe', '#155e75'],
  'Diagonal': ['#ede9fe', '#5b21b6'],
  'Flatness': ['#cffafe', '#155e75'],
  'Burr': ['#ffedd5', '#9a3412'],
  'Appearance': ['#fce7f3', '#9d174d'],
  'Camber': ['#e0e7ff', '#3730a3'],
  'API': ['#ccfbf1', '#115e59'],
  'Other measurements': ['#e2e8f0', '#334155'],
 };
 const tableCamberLabel = fields => fields.some(field => field.fieldname === 'thickness_ds') ? 'C' : 'Camber';
 const makeSheet = (root, fields) => {
  const scroll = $('<div class="inspection-scroll ss-coil-de-table-wrap"></div>').appendTo(root);
  const sheet = $('<table class="ss-coil-de-table"></table>').appendTo(scroll);
  const thead = $('<thead></thead>').appendTo(sheet);
  const groups = $('<tr class="inspection-group-row ss-coil-de-group-row"></tr>').appendTo(thead);
  const head = $('<tr class="inspection-field-row ss-coil-de-field-row"></tr>').appendTo(thead);
  $('<th class="inspection-row-number"></th>').appendTo(groups);
  $('<th class="inspection-row-number">#</th>').appendTo(head);
  let previous, groupHeader;
  fields.forEach(field => {
   const name = groupName(field);
   const [background, color] = groupColors[name];
   if (name !== previous) {
    groupHeader = $('<th class="ss-coil-de-group-head"></th>').text(__(name)).attr('colspan', 1).css({background, color}).appendTo(groups);
    previous = name;
   } else groupHeader.attr('colspan', Number(groupHeader.attr('colspan')) + 1);
   const displayLabels = {api_st: 'St', camber: tableCamberLabel(fields), burr_thickness: 'Thick (T)', burr_cut: 'Cut (C)', burr_difference: 'B=C−T', diagonal_difference: 'A−B'};
   const label = displayLabels[field.fieldname] || (field.label || field.fieldname).replace(/^(Thickness|Width|Length|Diagonal|Flatness|Burr|Appearance) /, '');
   $('<th></th>').attr('title', __(field.label || field.fieldname)).text(__(label)).css({background, color}).appendTo(head);
  });
  $('<th class="inspection-row-action"></th>').appendTo(groups);
  $('<th class="inspection-row-action"></th>').text(__("Remove")).appendTo(head);
  return $('<tbody></tbody>').appendTo(sheet);
 };
 panels.forEach(([html, table, tab, process, subtitle]) => {
  const active = frm.doc.operation === process;
  frm.toggle_display(tab, active);
  if (!active) return;
  const wrapper = frm.fields_dict[html]?.$wrapper;
  const df = frappe.meta.get_docfield(frm.doctype, table, frm.doc.name);
  if (!wrapper || !df) return;
  if (!outputTags.length) {
   wrapper.empty().append($('<p class="inspection-muted"></p>').text(__("Add output tags to Job Output before recording inspections.")));
   return;
  }
  const render = () => {
   // Display eight empty slots without making a saved document dirty on refresh.
   // Materialize all eight child records when the user edits the first cell.
   const savedRows = frm.doc[table] || [];
   frm.__inspection_active_tags = frm.__inspection_active_tags || {};
   const selectedTag = frm.__inspection_active_tags[table] || outputTags[0] || "";
   const rowsForSelectedTag = () => savedRows.filter(row => row.tag_no === selectedTag ||
    (!row.tag_no && selectedTag && selectedTag === outputTags[0]));
   let rows = rowsForSelectedTag();
   if (!rows.length) rows = Array.from({length: 8}, () => ({tag_no: selectedTag}));
   const materializeRows = () => {
    let currentRows = frm.doc[table] || [];
    if (selectedTag === outputTags[0]) {
     currentRows.filter(row => !row.tag_no).forEach(row => { row.tag_no = selectedTag; });
    }
    if (!currentRows.some(row => row.tag_no === selectedTag)) {
     for (let index = 0; index < 8; index++) {
      const row = frm.add_child(table);
      row.tag_no = selectedTag;
     }
    }
    frm.dirty();
    return (frm.doc[table] || []).filter(row => row.tag_no === selectedTag);
   };
   const details = frm.__inspection_context || {};
   const is_slitter = table === "custom_slitter_inspection_sheet_1";
   const size = [details.thickness, details.output_width || details.width,
    is_slitter ? details.length_c : details.length].map(value => value ?? '').join(' × ');
   const context = [[__("Company"), details.company_name],
    [__("Customer"), details.customer || frm.doc.customer_name || frm.doc.for_customer],
    [__("P/O No."), details.po_no], [__("Specs"), details.specs],
    [__("Size (mm)"), size],
    [__("Coil/Tag No."), selectedTag],
    [__("Company Address"), details.company_address], [__("Phone"), details.company_phone],
    [__("Sales Order No."), frm.doc.order_no], [__("Operation"), frm.doc.operation],
    [__("J/S No."), frm.doc.name]];
   wrapper.empty().append(style);
   const root = $('<div class="ss-inspection ss-coil-data-entry-dialog ss-coil-de-shell"></div>').appendTo(wrapper);
   const heading = $('<details class="inspection-heading ss-coil-de-parent-block"></details>').appendTo(root);
   frm.__inspection_heading_open = frm.__inspection_heading_open || {};
   heading.prop('open', frm.__inspection_heading_open[table] ?? true).on('toggle', () => {
    frm.__inspection_heading_open[table] = heading.prop('open');
   });
   $('<summary></summary>').text(__(subtitle)).appendTo(heading);
   const prefix = table === "custom_slitter_inspection_sheet_1" ? "inspection_1_"
    : table === "slitter_inspection_sheet_2" ? "inspection_2_" : "inspection_3_";
   const inspectionFields = frm.meta.fields.filter(field => field.fieldname.startsWith(prefix));
   const signoffTable = {"custom_slitter_inspection_sheet_1": "inspection_1_signoffs",
    "slitter_inspection_sheet_2": "inspection_2_signoffs", "reshearing_inspection_sheet": "inspection_3_signoffs"}[table];
   const signoffFields = [
    {fieldname: "remarks", label: __("Remarks"), fieldtype: "Small Text"},
    {fieldname: "inspected_by", label: __("Inspected By"), fieldtype: "Link", options: "Employee"},
    {fieldname: "inspected_date", label: __("Inspection Date"), fieldtype: "Date"},
    {fieldname: "checked_by", label: __("Checked By"), fieldtype: "Link", options: "Employee"},
    {fieldname: "checked_date", label: __("Check Date"), fieldtype: "Date"},
   ];
   const currentSignoff = (frm.doc[signoffTable] || []).find(row => row.tag_no === selectedTag) || {};
   {
    const companyLine = $('<div class="inspection-company-line"></div>').appendTo(heading);
    context.filter(([label]) => [__("Company"), __("Company Address"), __("Phone")].includes(label)).forEach(([label, value]) => {
     $('<span></span>').text(`${label}: ${value || ''}`).appendTo(companyLine);
    });
    const tables = $('<div class="inspection-header-tables"></div>').appendTo(heading);
    const orderTable = $('<table class="inspection-details-table"></table>').appendTo(tables);
    const orderBody = $('<tbody></tbody>').appendTo(orderTable);
    [__("Customer"), __("Specs"), __("Size (mm)"), __("P/O No."), __("Sales Order No."), __("J/S No."), __("Coil/Tag No.")].forEach(label => {
     const value = context.find(entry => entry[0] === label)?.[1];
     const tr = $('<tr></tr>').appendTo(orderBody);
     $('<th scope="row"></th>').text(label).appendTo(tr);
     $('<td></td>').text(value ?? '').appendTo(tr);
    });
    const toleranceTable = $('<table class="inspection-tolerance-table"></table>').appendTo(tables);
    const head = $('<thead></thead>').appendTo(toleranceTable);
    const titleRow = $('<tr></tr>').appendTo(head);
    const groups = $('<tr></tr>').appendTo(head);
    const limits = $('<tr></tr>').appendTo(head);
    const values = $('<tr></tr>').appendTo($('<tbody></tbody>').appendTo(toleranceTable));
    const toleranceGroups = table !== "custom_slitter_inspection_sheet_1" ? [
     ['Thickness (mm)', ['thickness_min', 'thickness_max'], 'Thickness'],
     ['Width (mm)', ['width_min', 'width_max'], 'Width'],
     ['Length (mm)', ['length_min', 'length_max'], 'Length'],
     ['Burr Height (mm)', ['burr_max'], 'Burr'],
     ['Edge Wave', ['edge_wave_max'], 'Edge Wave'], ['Camber (mm)', ['camber_max'], 'Camber'],
    ] : [
     ['Thickness (mm)', ['thickness_min', 'thickness_max'], 'Thickness'],
     ['Width (mm)', ['width_min', 'width_max'], 'Width'],
     ['Weight (kg)', ['weight_min', 'weight_max'], 'Weight'],
     ['Burr Height (mm)', ['burr_max'], 'Burr'],
    ];
   const selectedWidth = details.output_width || outputRow?.width;
   const widthToleranceRow = (frm.doc.cutting_detail || []).find(row =>
    selectedWidth != null && selectedWidth !== "" && row.width != null && row.width !== "" && Number(row.width) === Number(selectedWidth)
   );
   const widthTolerances = {
    width_min: widthToleranceRow?.tolerance_minus,
    width_max: widthToleranceRow?.tolerance_plus,
   };
    $('<th class="inspection-tolerance-title"></th>').attr('colspan', toleranceGroups.reduce((count, group) => count + group[1].length, 0))
     .text(__("Tolerances")).appendTo(titleRow);
    const fieldMap = Object.fromEntries(inspectionFields.map(field => [field.fieldname, field]));
    toleranceGroups.forEach(([label, suffixes, group]) => {
     const [background, color] = groupColors[group];
     $('<th></th>').attr('colspan', suffixes.length).text(__(label)).css({background, color}).appendTo(groups);
     suffixes.forEach((suffix, index) => {
      $('<th></th>').text(__(suffixes.length === 2 ? (index === 0 ? 'Min.' : 'Max.') : 'Max.')).css({background, color}).appendTo(limits);
      const field = fieldMap[prefix + suffix];
      const cell = $('<td></td>').appendTo(values);
      if (field) {
       const automaticLimit = ["thickness_min", "thickness_max"].includes(suffix) ? details.tolerances?.[suffix]
        : ["width_min", "width_max"].includes(suffix) ? widthTolerances[suffix] : null;
       const isWidthLimit = ["width_min", "width_max"].includes(suffix);
       const hasAutomaticLimit = (automaticLimit != null && automaticLimit !== "") || (isWidthLimit && !!widthToleranceRow);
       const fieldForCell = hasAutomaticLimit ? {...field, read_only: 1} : field;
       const cellValue = hasAutomaticLimit ? (automaticLimit ?? "") : frm.doc[field.fieldname];
       makeCell(cell, fieldForCell, cellValue, value => frm.set_value(field.fieldname, value));
      }
     });
    });
   }
   const child = $('<div class="ss-coil-de-items-block"></div>').appendTo(root);
   if (outputTags.length > 1) {
    const outputTabs = $('<div class="inspection-output-tabs" role="tablist"></div>').prependTo(root);
    outputTags.forEach(tag => {
     const active = tag === selectedTag;
     $('<button type="button" role="tab" class="inspection-output-tab"></button>')
      .text(tag).toggleClass('active', active).attr('aria-selected', active ? 'true' : 'false')
      .appendTo(outputTabs).on('click', () => {
       frm.__inspection_active_tags[table] = tag;
       ss_coil.inspections.render(frm);
      });
    });
   }
   const toolbar = $('<div class="ss-coil-de-block-title"></div>').appendTo(child);
   $('<span class="ss-coil-de-block-title-text"></span>').text(`${__("Output Tag")}: ${selectedTag}`).appendTo(toolbar);
   $('<span class="ss-coil-de-block-title-text"></span>').text(__(table === "slitter_inspection_sheet_2" ? "Check Point Measurements" : "Measurement Rows")).appendTo(toolbar)
    .append($('<span class="badge"></span>').text(rows.length));
   if (writable) $('<button type="button" class="btn btn-primary btn-sm"></button>').text(__(table === "slitter_inspection_sheet_2" ? "Add Measurement Column" : "Add Row")).appendTo(toolbar).on('click', () => {
    materializeRows();
    const row = frm.add_child(table);
    row.tag_no = selectedTag;
    frm.dirty(); frm.refresh_field(table); render();
   });
   let fields = frappe.meta.get_docfields(df.options).filter(field => !['Section Break', 'Column Break', 'Tab Break', 'HTML', 'Heading', 'Table', 'Table MultiSelect', 'Button'].includes(field.fieldtype) && !field.hidden);
   if (table === "custom_slitter_inspection_sheet_1") {
    const order = ['thickness_head_ds', 'thickness_head_c', 'thickness_head_ws', 'thickness_tail_ds', 'thickness_tail_c', 'thickness_tail_ws', 'width_head_end', 'width_center', 'width_tail_end', 'burr_head_ds_1', 'burr_tail_ws_1', 'burr_head_ds_2', 'burr_tail_ws_2', 'camber', 'api_st'];
    fields.sort((a, b) => (order.indexOf(a.fieldname) < 0 ? 999 : order.indexOf(a.fieldname)) - (order.indexOf(b.fieldname) < 0 ? 999 : order.indexOf(b.fieldname)));
   }
   const saveMeasurement = (index, field, value) => {
    const actual = materializeRows()[index];
    return frappe.model.set_value(actual.doctype, actual.name, field.fieldname, value).then(() => frm.dirty());
   };
   const removeMeasurement = index => {
    frappe.confirm(__("Remove measurement {0}?", [index + 1]), () => {
     const actual = materializeRows()[index];
     frappe.model.clear_doc(actual.doctype, actual.name);
     frm.dirty(); frm.refresh_field(table); render();
    });
   };
   if (table === "slitter_inspection_sheet_2") {
    // Tolerances belong to the heading, not to the checkpoint measurements.
    // Legacy tolerance columns remain stored, but are not repeated in this grid.
    const fieldMap = Object.fromEntries(fields.map(field => [field.fieldname, field]));
    const scroll = $('<div class="inspection-scroll inspection-checkpoint-scroll ss-coil-de-table-wrap"></div>').appendTo(child);
    const sheet = $('<table class="ss-coil-de-table inspection-vertical-sheet"></table>').appendTo(scroll);
    const head = $('<tr></tr>').appendTo($('<thead></thead>').appendTo(sheet));
    $('<th class="inspection-checkpoint-head inspection-checkpoint-group"></th>').text(__("Check Point")).appendTo(head);
    $('<th class="inspection-checkpoint-head inspection-checkpoint-label"></th>').text(__("Position")).appendTo(head);
    rows.forEach((row, index) => {
     const column = $('<th class="inspection-checkpoint-head"></th>').appendTo(head);
     $('<span class="inspection-column-number"></span>').text(index + 1).appendTo(column);
     if (writable) $('<button type="button" class="inspection-remove inspection-column-remove"></button>').text('×')
      .attr('aria-label', __("Remove measurement {0}", [index + 1])).appendTo(column).on('click', () => removeMeasurement(index));
    });
    const body = $('<tbody></tbody>').appendTo(sheet);
    ss_coil.inspections.form2_checkpoints.forEach(([group, checkpoints]) => {
     const [background, color] = groupColors[group];
     checkpoints.forEach(([fieldname, label], position) => {
      const field = fieldMap[fieldname];
      if (!field) return;
      const tr = $('<tr></tr>').appendTo(body);
      if (position === 0) $('<th scope="rowgroup" class="inspection-checkpoint-group"></th>').attr('rowspan', checkpoints.length)
       .text(__(group === 'Appearance' ? 'Appearance OK/NG' : `${group} (mm)`)).css({background, color}).appendTo(tr);
      $('<th scope="row" class="inspection-checkpoint-label"></th>').text(__(label)).css({background, color}).appendTo(tr);
      rows.forEach((row, index) => {
       const cell = $('<td></td>').appendTo(tr);
       makeCell(cell, {...field, label: `${group} ${label} — ${index + 1}`}, row[fieldname], value => saveMeasurement(index, field, value));
      });
     });
    });
   } else {
    const body = makeSheet(child, fields);
    rows.forEach((row, index) => {
     const tr = $('<tr></tr>').appendTo(body);
     $('<td class="inspection-row-number"></td>').text(index + 1).appendTo(tr);
     fields.forEach(field => makeCell($('<td></td>').appendTo(tr), field, row[field.fieldname], value => saveMeasurement(index, field, value)));
     const action = $('<td class="inspection-row-action"></td>').appendTo(tr);
     if (writable) $('<button type="button" class="inspection-remove"></button>').text('×')
      .attr('aria-label', __("Remove measurement {0}", [index + 1])).appendTo(action).on('click', () => removeMeasurement(index));
    });
   }
   const footer = $('<div class="inspection-footer inspection-heading-fields"></div>').appendTo(child);
   signoffFields.forEach(field => {
    const cell = $('<div></div>').appendTo(footer);
    $('<label></label>').text(__(field.label)).appendTo(cell);
    const savedValue = currentSignoff[field.fieldname];
    const defaultValue = field.fieldtype === "Date" ? (savedValue || frappe.datetime.get_today()) : savedValue;
    makeCell(cell, field, defaultValue, value => {
     let signoff = (frm.doc[signoffTable] || []).find(row => row.tag_no === selectedTag);
     if (!signoff) {
      signoff = frm.add_child(signoffTable);
      signoff.tag_no = selectedTag;
      signoff.inspected_date = frappe.datetime.get_today();
      signoff.checked_date = frappe.datetime.get_today();
     } else {
      if (!signoff.inspected_date) signoff.inspected_date = frappe.datetime.get_today();
      if (!signoff.checked_date) signoff.checked_date = frappe.datetime.get_today();
     }
     return frappe.model.set_value(signoff.doctype, signoff.name, field.fieldname, value).then(() => frm.dirty());
    });
   });
   $('<p class="inspection-muted"></p>').text(writable ? __("Enter measurements in the rows above, then Save the document.") : __("This inspection is read only.")).appendTo(child);
  };
  frappe.model.with_doctype(df.options, render);
 });
};

frappe.ui.form.on("SS Coil", {
	operation(frm) {
		ss_coil.inspections.render(frm);
	},
	job_output_add(frm) {
		ss_coil.inspections.render(frm);
	},
	job_output_remove(frm) {
		ss_coil.inspections.render(frm);
	},
});
