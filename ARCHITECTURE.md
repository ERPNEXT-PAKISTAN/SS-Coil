# SS Coil — Architecture & Flow

This file exists so a developer (human or AI assistant like Codex/Cursor/Claude)
can understand this app's moving parts without reading all of `api.py` (4000+
lines) top to bottom. Start here, then jump to the referenced
functions/line-ranges.

## Keeping this file current (read this if you're an AI agent editing this repo)

**This file is not auto-generated — nothing rebuilds it for you.** It stays
accurate only because whoever changes the code also updates the relevant
section here, in the *same* change. Follow this rule:

> If your change alters a **flow** described below (not just styling/wording),
> update the matching section of this file before you finish the task —
> same commit, no separate follow-up.

Concretely, update this file when you:
- Add/remove/rename a doc_event hook in `hooks.py` → update the wiring table
  under "Doc-event wiring".
- Change what triggers a Tag Registry entry, batch creation, or how tag
  lineage is computed → update "Tag Registry" / "Batch auto-creation".
- Add/remove a field the Data Entry dialog shows, or change how it
  loads/saves rows → update "Stock Entry Data Entry dialog".
- Change sticker/print fields, or add a new print format → update
  "Sticker / QR printing", and check all three pieces listed there stay in
  sync (payload function, HTML builder, print format template).
- Add a new doctype, a new cross-doctype sync, or a new setup/migration
  function → add it to the relevant section or the "File map" table.
- Discover and fix a non-obvious bug (a silent-failure gotcha, an ordering
  dependency, a caching trap) → add a short "Gotcha" note near the relevant
  section, the way the `ignore_links` and `__islocal` notes below are
  written. These notes are the highest-value content in this file — they
  save the next person (or agent) from re-discovering the same bug the hard
  way.

Do **not** update this file for pure refactors, formatting, or anything that
doesn't change behavior/flow — keep the noise-to-signal ratio low so it stays
worth reading.

## What this app does

SS Coil adds steel-coil-specific tracking on top of ERPNext Stock/Selling:
buying/receiving raw coils, cutting/processing them into outputs, and
delivering to customers — while keeping a full paper-trail ("tag lineage")
from the raw material through every intermediate cut down to what's shipped.

## The core concept: Tag Registry (traceability backbone)

Every physical unit of material (a coil, a cut piece, a slit strip...) gets a
**Tag No** (e.g. `SSCC-0455-000`). The `Tag Registry` doctype is the single
source of truth for "where did this tag come from, and where did it go":

- `tag_no` — the physical tag/sticker number.
- `parent_tag_no` / `root_tag_no` / `lineage_path` — when a tag is cut/split
  into children, the children point back to the parent, and `lineage_path` is
  a human-readable breadcrumb (`SSCC-0455-000 > SSCC-0455-001`).
- `source_doctype` / `source_docname` / `source_child_doctype` /
  `source_child_name` — where the tag was **first created** (e.g. a Stock
  Entry Detail row on a Material Receipt).
- `current_doctype` / `current_docname` / ... — where the tag **currently
  lives** (updated as it moves through Sales Order → Stock Entry → SS Coil
  processing → Delivery Note).
- `batch_no` — see "Batch auto-creation" below.

Key functions in `api.py` (all prefixed so they're greppable):
- `_register_tag(...)` — the low-level upsert into Tag Registry. Called by
  everything else below.
- `_create_origin_tag(doc, row, source_doctype, ...)` — called when a tag is
  first created (e.g. on a Material Receipt row). Generates a new Tag No if
  the row doesn't have one (`_next_tag_number()`), creates its Tag Registry
  entry, and optionally creates a matching Batch (see below).
- `_update_tag_location(...)` — called as a tag moves through later documents
  (Delivery Note, Sales Invoice, SS Coil processing) to update
  `current_doctype`/`current_docname` without touching the origin fields.
- `_get_or_create_tag(...)`, `_next_sub_tag(...)` — child/sub-tag generation
  when a parent tag is split (e.g. SS Coil cutting produces multiple output
  tags from one input tag).
- `get_tag_trace(tag_no)` (whitelisted) — walks the full lineage tree for the
  UI (used by the Tag Registry detail views / dashboards).

### Doc-event wiring (who calls what, and when)

Registered in `hooks.py` under `doc_events`. The important ones for tag flow:

| Doctype | Event | Function | What it does |
|---|---|---|---|
| Stock Entry | `before_validate`, `before_save` | `prepare_stock_entry_links` → `assign_stock_entry_detail_tags` | Creates/updates origin tags for Material Receipt rows |
| Sales Order | `before_validate`, `before_save` | `assign_sales_order_item_tags`, `sync_sales_order_item_dimensions` | Assigns/validates tags on SO items |
| Purchase Receipt / Purchase Invoice | `before_validate` | `assign_purchase_receipt_item_tags` / `assign_purchase_invoice_item_tags` | Same idea for purchase-side raw material intake |
| Delivery Note | `before_validate` | `assign_delivery_note_item_tags` | Updates tag location to "shipped" |
| SS Coil | `before_validate`, `before_save`, `on_submit`, `on_cancel` | `sync_ss_coil_process_tracking` | Drives the cutting/processing workflow and creates output tags |

**Important gotcha (see `_register_tag`)**: these hooks mostly run at
`before_validate`/`before_save` time — i.e. *before* the parent document
(Stock Entry, SS Coil, ...) is actually committed to the database, even
though its `name` has already been assigned. If `_register_tag` tries to
`insert()` a Tag Registry row that links back to that not-yet-committed
parent, Frappe's link validation will fail with `LinkValidationError:
Could not find <Doctype>: <name>`. That's why `_register_tag` sets
`doc.flags.ignore_links = True` before inserting/saving — the reference is
logically valid, just not committed yet in the same transaction.

## Batch auto-creation (Tag No **is** the Batch ID, by default)

`_ensure_batch_for_tag_row(row, tag_no)` (called from `_create_origin_tag`):

```
if Item.has_batch_no is enabled
   AND Item.custom_use_tag_as_batch_no is enabled (default: on)
   AND row.batch_no is empty:
    create a Batch doc with batch_id = tag_no (if one doesn't already exist)
    row.batch_no = tag_no
```

The default design: Batch ID always equals the Tag No, so scanning/reading
the printed tag *is* the batch identifier — no separate lookup needed.
Consequences and per-item override:

- **Item.has_batch_no must be enabled** for a given Item, or no Batch gets
  created at all (the row just has no `batch_no`, which is fine — see next
  point).
- **`Item.custom_use_tag_as_batch_no`** (Check, default `1`) is the per-item
  opt-out. Set it to `0` on an item to skip this function entirely for that
  item, freeing up ERPNext's own batch handling to take over:
  - **Automatic ERPNext-series batching**: also enable
    `Item.create_new_batch` and set `Item.batch_number_series` (e.g.
    `BATCH-.YYYY.-`). With `custom_use_tag_as_batch_no` off, this hook no
    longer pre-fills `row.batch_no`, so ERPNext's own core validation is free
    to auto-generate the next batch from the series when the Stock Entry is
    saved.
  - **Manual batching**: leave `create_new_batch` off. The row's `batch_no`
    must then be picked/created by hand (in the Data Entry dialog or the
    standard grid) before saving — this hook always backs off if
    `row.batch_no` is already set, regardless of the flag above.
  - While `custom_use_tag_as_batch_no` stays at its default (`1`), enabling
    `Item.create_new_batch` is dead config: this hook runs first (before
    ERPNext's own batch-creation logic) and already fills `row.batch_no`, so
    the series-based auto-batch never gets a chance to fire.
- Never fall back to using `tag_no` as a fake `batch_no` value when no real
  Batch was created (this was a real bug — see git history "Could not find
  Batch No" fix). Only set `batch_no` on Tag Registry /
  `custom_raw_material_batch_no` when a real Batch record exists.

## Stock Entry "Data Entry" dialog (bulk item entry UI)

A custom full-screen dialog (not the standard Frappe grid) for quickly
entering many Stock Entry item rows at once — built because the standard
child-table grid is too cramped for coil data entry (many custom fields per
row: thickness/width/length, mill, spec, tags, etc).

- **Backend**: `ss_coil/stock_entry_data_entry.py`
  - `get_stock_entry_data_entry_meta()` — returns the parent field
    definitions (grouped) and child field definitions the dialog should
    render, pulled live from DocType meta (so field labels/options stay in
    sync with the DocType without duplicating them in JS).
  - `save_stock_entry_data_entry(stock_entry, data)` — applies the dialog's
    parent + item values back onto the real Stock Entry doc and saves it.
- **Frontend**: `ss_coil/public/js/stock_entry.js`
  - `add_stock_entry_data_entry_button` → `open_stock_entry_data_entry_dialog`
    → `show_stock_entry_data_entry_dialog` is the entry point.
  - Parent fields render as a 6-column grid (`STOCK_ENTRY_DATA_ENTRY_PARENT_FIELDS`).
  - Item rows render as a spreadsheet-style `<table>` (not Frappe's grid),
    grouped into columns via `STOCK_ENTRY_DATA_ENTRY_CHILD_GROUPS`.
  - **Gotcha**: rows added via "+ Add Row" get a client-side placeholder
    `name` (`frappe.utils.get_random(10)`, with `__islocal: 1`). On save,
    that fake name must be stripped before sending to the server — otherwise
    the server-side save function (which matches rows by `name` to decide
    "update existing" vs "append new") mistakes it for an existing row,
    finds no match, and silently drops it. See `save_stock_entry_data_entry_from_dialog`.

## Sticker / QR printing

Three related pieces work together — **when changing sticker fields/layout,
all three need updating or they drift out of sync** (this happened before):

1. `build_stock_entry_sticker_payload(doc, row)` (api.py) — the single
   source of truth for what fields a sticker shows and in what order.
2. `build_stock_entry_sticker_body_html` / `_combo_html` / `_footer_html`
   (api.py) — turn that payload into HTML. Exposed to Jinja via
   `jinja_methods.py` so...
3. ...the print format templates
   (`ss_coil/ss_coil/print_format/stock_entry_sticker*/*.html`) can call
   them directly instead of re-implementing the same field list in Jinja.
   Each print format has a **fallback** inline Jinja loop used only when
   `sticker_print_html` isn't pre-populated (see `print_utils.py`).

`print_utils.py` hooks into `pdf_body_html` to pre-render the full sticker
sheet server-side (`build_stock_entry_sticker_sheet_html`) and inject it as
`sticker_print_html`, so both the PDF and the browser print-preview path
render identically.

**QR payload** (`build_stock_entry_sticker_qr_payload`) is a separate,
shorter/full data set from what's shown on the sticker body — kept
deliberately compact-vs-full based on product requirements at the time; check
this function if the QR code stops scanning (over-stuffing it with data makes
the code too dense to scan reliably at sticker print size).

## Create Sales Order from Stock Entry

A "Create Sales Order" button on the Stock Entry form (`stock_entry.js` >
`add_stock_entry_create_sales_order_button`) builds a new, unsaved Sales
Order pre-filled from the Stock Entry via
`create_sales_order_from_stock_entry(source_name)` in `api.py`, using the
standard `frappe.model.open_mapped_doc` pattern (same mechanism ERPNext's own
"Make Sales Invoice"-style buttons use) — the user reviews/edits and saves it
themselves, nothing is inserted server-side.

Field transfer is **generic, not a hand-written mapping list**:
`_copyable_fieldnames(source_doctype, target_doctype)` copies any field that
exists with the *same fieldname* on both doctypes (skipping layout/system
fields), for both the parent (Stock Entry → Sales Order) and the child rows
(Stock Entry Detail → Sales Order Item). This is why so many `custom_*` coil
fields (tag no, thickness/width/length, mill, spec, ...) transfer without any
explicit per-field code — they happen to share fieldnames between the two
doctypes. `customer`/`transaction_date`/`company` get explicit fallbacks
since Stock Entry's equivalent fields use different names
(`custom_customer`, `posting_date`).

**Gotcha**: if a future field gets added to Sales Order (or Sales Order Item)
with the *same fieldname* as an unrelated Stock Entry field but a different
meaning, it will silently start being copied. Check `_copyable_fieldnames`'s
skip lists if that ever causes an unwanted transfer.

### The link back (many-to-many, tracked at item level)

One Stock Entry can spawn several Sales Orders over repeated button clicks,
and one Sales Order's items can come from different source Stock Entries -
so this is **not** a single Link field on either side (that was considered
and rejected: it would also collide with `Stock Entry.custom_sales_order`,
which already means something else — see "Batch auto-creation" section's
neighbor, `_infer_custom_sales_order`, which auto-fills it from a linked SS
Coil's `order_no`).

Fields (`setup_stock_entry_sales_order_link_fields`):
- `Sales Order Item.custom_source_stock_entry` (Link) +
  `custom_source_stock_entry_detail` (Data, the source child row name) — set
  once, per row, at creation time in `create_sales_order_from_stock_entry`.
  Exact, since each item states its own source.
- `Sales Order.custom_source_stock_entries` (Small Text, read-only) — a
  de-duplicated list of every distinct source Stock Entry among the items.
- `Stock Entry.custom_linked_sales_orders` (Small Text, read-only,
  append-only) — every Sales Order ever created from this Stock Entry.

`sync_stock_entry_sales_order_links` (hooked on Sales Order `before_save`)
recomputes the Sales Order summary and appends to the Stock Entry side on
*every* save, not just at creation — so it stays correct if items are added,
removed, or re-sourced later. It writes to the Stock Entry side via
`frappe.db.set_value(..., update_modified=False)` (a direct update, not
`doc.save()`) since the Stock Entry is a separate, already-saved document at
that point — no need to run its full validate/save cycle just to append one
value.

**Manual sync buttons** (for cases where the auto-sync on save doesn't cover
it — e.g. a Sales Order Item's source link was cleared, or data drifted):
- Stock Entry → "Sync Sales Orders" button → `sync_stock_entry_links_from_source`
  — rebuilds `custom_linked_sales_orders` **from scratch** by querying every
  Sales Order Item that currently points at this Stock Entry (unlike the
  append-only save hook, this also drops stale names).
- Sales Order → "Sync Stock Entry Links" button → `sync_sales_order_stock_entry_links`
  — re-runs the same recompute the save hook does, useful to trigger it
  without making an unrelated edit just to force a save.

**Reverse creation**: Sales Order also gets a "Create Stock Entry" button
(`create_stock_entry_from_sales_order`), mirroring
`create_sales_order_from_stock_entry` with source/target swapped — same
generic same-fieldname copy approach. It does **not** populate the
`custom_source_stock_entry`/`custom_linked_sales_orders` fields above, since
those specifically model "a Sales Order was created from this Stock Entry" —
the reverse case (a Stock Entry created from a Sales Order) is a different
relationship and isn't tracked by those fields. If you need that tracked too,
say so explicitly — it wasn't asked for and would need its own field pair to
stay unambiguous.

## SO → Manufacture Items (BOM-based, unrelated to the tag/coil system)

`ss_coil/public/js/sales_order_manufacture.js` — migrated from a DB-stored
Client Script ("SO Manufacture") into the app codebase so it's
version-controlled like everything else here. **Behavior is unchanged from
the original script; only its location moved.** If it needs edits, edit this
file (then `bench build` + reload the workers), not a Client Script record.
The old Client Script record still exists but is disabled (`enabled = 0`) to
prevent double-execution — safe to delete outright once you've confirmed the
app-based version works for you.

This is a genuinely separate feature from the coil/tag system above: it lets
a Sales Order explode its items' default BOMs, check raw material stock, and
create+submit one `Stock Entry Type: Manufacture` per finished item — plain
ERPNext manufacturing, nothing tag/batch related. It reads/writes
`Stock Entry.custom_sales_order` (the field explicitly *not* reused by the
create/sync system above, since it already has this different meaning here).
Registered in `hooks.py`'s `doctype_js["Sales Order"]` as a second file
alongside `sales_order.js` (Frappe supports a list of files per doctype).

## Other former Client Scripts

While auditing DB-stored Client Scripts for this app's doctypes, three more
turned up (2026-07):
- **"SS Coil Sales Order Dimension Auto"** and **"SS Coil Stock Entry
  Dimension Auto"** — both recomputed `custom_dimension` from
  thickness/width/length on the item child tables. Deleted: this app's own
  `sales_order.js`/`stock_entry.js` already do the same job (the Sales Order
  one was actually a live conflict — it used `custom_length` while the app
  uses `custom_length_c`, a different field, so both were fighting over
  `custom_dimension` on every keystroke).
- **"Production Plan-Client"** — defaults "Create Work Orders After Submit"
  to checked on new Production Plans. Unrelated to the coil/tag system
  (standard ERPNext doctype), but migrated into
  `ss_coil/public/js/production_plan.js` (wired via `hooks.py`
  `doctype_js["Production Plan"]`) for the same version-control reasons as
  the SO Manufacture migration above. The original Client Script record is
  disabled, not deleted.

## SS Coil processing (cutting workflow)

`SS Coil` doctype represents one processing operation (slitting, leveling,
cutting, etc). `sync_ss_coil_process_tracking` and `create_next_ss_coil_entry`
drive a chain: each SS Coil's output tags (`Coil Output` child rows) can
become the *input* tags of the next SS Coil in the chain, via
`_build_child_tag`/`_next_sub_tag`, until the material reaches final delivery
form. Not submittable — its lifecycle is tracked entirely via the
`order_status` Select field (Not Started/In Process/Partially
Completed/Completed/Closed) driven by the Start/Partial/Complete/Close
buttons in `ss_coil.js`, gated by a `process_control_enabled` safety
checkbox that auto-locks itself after every transition.

**Hook wiring is deliberately asymmetric** (`hooks.py` `doc_events["SS
Coil"]`) — used to fire `prepare_ss_coil_output_tags` and
`sync_ss_coil_process_tracking` up to 6 times per save (before_validate +
before_save + after_insert + on_update + dead on_submit/on_cancel, since the
doctype isn't submittable); trimmed 2026-07 to:
- `before_validate`: both functions, once — mutates the doc's own fields
  (job_output rows, tag assignment, next_process) before the DB write.
- `on_update`: `sync_ss_coil_process_tracking` only, once more — its tail end
  rolls up this SS Coil's status onto the linked Sales Order Item via
  `_update_sales_order_item_process_status`, which queries `SS Coil` by
  `sales_order_item` and would miss the current document entirely if it only
  ran pre-commit (the row isn't in the DB yet at `before_validate` time). So
  this one genuinely needs to run twice — once for its own-field mutations,
  once post-commit for the cross-document rollup to see accurate state —
  don't "fix" this into a single call without preserving that.

The `field_order` Property Setter for this doctype also had a stray
`stock_entry_items` entry referencing a field that doesn't exist anywhere in
`ss_coil.json` (removed, both live and in the fixture file) — leftover from
a deleted field.

### Further improvements (2026-07)

- **Interactive flow banner at the top of the form**, replacing the separate
  Start/Partial/Complete/Close buttons. `render_ss_coil_flow_banner` (called
  from `refresh`, `operation`, `order_status`, `process_control_enabled`, and
  again from `load_and_render_ss_coil_dashboards` once server data arrives)
  renders, right below the page header:
  - **Header row**: a digital-clock elapsed-time readout (`.ss-coil-flow-clock`,
    the same dark monospace styling `renderElapsedTimeField` always had, just
    relocated here instead of buried in the field layout - the raw
    `elapsed_time` field is now hidden via `frm.toggle_display`) and a
    **Process Control ON/OFF toggle pill** (`toggle_ss_coil_process_control`,
    click to flip `process_control_enabled` and save immediately - the raw
    checkbox field is hidden the same way).
  - **Process row**: the item's configured process chain (Slitter → Leveler →
    Reshearing, filtered to whichever are actually enabled via `so_item[0]`,
    reusing `getConfiguredProcesses`/`formatProcessLabel`) with the current
    `operation` highlighted, read-only (advancing this happens via
    `create_next_ss_coil_entry`/the "Create Next Process" button, a distinct
    document-creating action, not a simple status flip).
  - **Status row**: `order_status` lifecycle steps, and **this row is
    clickable** — clicking "In Process"/"Partially Completed"/"Completed"/
    "Closed" runs the same transition the old buttons used to
    (`run_ss_coil_status_action` → `save_ss_coil_process_state`, still gated
    by `ensure_ss_coil_process_control`). "Not Started" isn't clickable -
    there's no defined action for reverting to it.
  - **Item Demand row**: renders the server's `process_checklist` (see
    below) as a *connected* flow (`build_ss_coil_checklist_flow_html`),
    reusing the same step+connector visual as the Process/Status rows -
    for a multi-process item this reads as one sequence
    (Slitter → Leveler → Reshearing) with each step's own state
    (done/current/in-progress/pending) and a connector between two steps
    lit up once the earlier one is done, so "what's previous/next" is
    visually obvious, not just a flat list. Steps with a linked SS Coil
    document are clickable and jump straight to it.
  - **Elapsed-time clock**: redesigned as a small stat card (dark solid
    background, muted "ELAPSED TIME" label above the monospace digits, a
    left accent bar that turns green while actively counting) instead of
    the earlier neon-glow terminal look, which read as gamer-styling
    rather than a professional shop-floor dashboard.
  - Renamed the "Item Demand" row label to **"Processes"**.
  - The Status row's "Not Started" step no longer renders as checked-off
    green once passed (a checkmarked "Not Started" read as confusing/
    contradictory) - it now shows as a muted strikethrough "passed" state
    instead, via a `neverDoneIndexes` option on `build_ss_coil_stepper_html`.

### `create_next_ss_coil_entry` no longer hard-errors on a normal end state

If an item's configured chain ends at the current stage (e.g. only
Slitter+Leveler are required - Reshearing was never enabled on the Sales
Order Item), completing the last stage has nothing to advance to. That's a
normal, valid state, but the endpoint used `frappe.throw("No next process
found in Job Output.")`, which surfaced as a hard error to the user
immediately after successfully completing a stage - confirmed by triggering
it against a real document. Fixed two ways:
- Server: returns `{"created_docs": [], "skipped_docs": [], "count": 0,
  "skipped_count": 0, "no_next_process": True}` instead of throwing.
- Client: `run_ss_coil_status_action`'s "Completed" branch now checks
  `getNextProcessLabelFromOutputs(frm)` before calling
  `createNextProcessEntries` at all, so the no-op case doesn't even round-trip.

### Child tag generation now survives a blank input tag

`_sync_job_output_rows_from_cutting_detail` derives each output row's tag
from `input_coil[0].tag_no` (the "parent tag"). If that field is blank
(confirmed on a real document - the input tag had been cleared at some
point after earlier output rows were already tagged), any output row
*without* a pre-existing tag of its own got left permanently blank, since
`_build_child_tag` returns `""` for a blank parent and there was no
fallback. `resolve_parent_tag_base()` now falls back to inferring the same
parent base from any sibling output row that still has a tag (stripping its
trailing `-NNN` suffix via regex), so new rows keep getting properly
numbered child tags even when the source input tag is gone. Verified fixing
a real document: two previously-blank output row tags were correctly
backfilled as `...-002`/`...-003` after a resave.

  `add_process_action_buttons` now only adds the "Create Next Process"
  button; `ensure_ss_coil_process_control`/`save_ss_coil_process_state`/
  `run_ss_coil_status_action` are top-level functions (not closures inside
  the old button-adding function anymore) so both the stepper and that
  button can call them.

- **`process_checklist` in `get_ss_coil_detail_dashboard`** (built by
  `_build_ss_coil_process_checklist`): answers "which of the processes this
  customer's Sales Order Item actually asked for (`so_item.slitter`/
  `leveler`/`reshearing`) are Completed / In Progress / Pending, across
  *every* SS Coil document for that same `sales_order_item`" - not just this
  one. Since `create_next_ss_coil_entry` makes each stage a child of the
  previous one in the chain, this doubles as "how far along the full chain
  is this item overall," derived by grouping all SS Coil docs sharing
  `sales_order_item` by `operation` and taking the most-recently-modified
  one per stage. Delivered as part of the same dashboard payload the two
  dashboard tabs already fetch - no extra round trip.
- **Delivery/invoice details missed rows fulfilled from a different tag
  lineage.** `delivery_details`/`invoice_details` in
  `get_ss_coil_detail_dashboard` only matched `Delivery Note Item`/`Sales
  Invoice Item` rows by exact `custom_tag_no in (this doc's input+output
  tags)`. A Sales Order Item can be fulfilled by a *different* physical tag
  than the one this particular SS Coil document produced (confirmed on a
  real case: SS Coil `JS26-.00004.-SL`'s own tags were
  `SSCC-0455-000/001/002/003`, but the Delivery Note/Sales Invoice that
  fulfilled its Sales Order Item carried tag `SSCC-05541-000` - a completely
  separate lineage, linked only via the shared `so_detail`). The Sales
  Order's own dashboard didn't have this problem because it isn't filtering
  by tag at all. Fixed by also matching `child.so_detail = doc.sales_order_item`
  (`OR`'d with the existing tag match) in both queries.
- **Dashboard fetched twice per render.** `refresh` and the `order_status`
  change handler both used to call `render_ss_coil_dashboard(frm)` *and*
  `render_ss_coil_diagrams(frm)` separately, each independently hitting
  `get_ss_coil_detail_dashboard` (several joined queries + a recursive tag
  walk) even though both tabs render from the identical payload. Consolidated
  into `load_and_render_ss_coil_dashboards(frm)`, which fetches once and
  hands the same `data` to both `render_ss_coil_dashboard(frm, data)` and
  `render_ss_coil_diagrams(frm, data)` — one server round-trip instead of two.
- **"Repair Tags" button added** (Tags button group) — wires the previously
  console-only `sync_ss_coil_output_tags` to the form, scoped to just the
  current document (`ss_coil: frm.doc.name`), with a confirm prompt and a
  reload on success.
- **Naming series now reflects the actual Operation.** `ss_coil.py`'s
  `autoname()` picks a suffix from `SS_COIL_OPERATION_NAME_SUFFIXES`
  (`Slitter→SL`, `Leveler→LV`, `Reshearing→RS`, unmapped→`SL`) instead of the
  JSON's fixed `-SL` for every document. Implemented via `_format_autoname`
  (not `make_autoname` directly — the latter rejects the `{YY}`/`{#####}`
  brace syntax outside the `"format:"` prefix path, confirmed by testing).
  The counter is keyed by the literal prefix *before* `#####` (`"JS26-"`,
  once `{YY}` resolves) — the suffix doesn't factor into the series key, so
  all three operations continue sharing one counter; nothing forked or reset.
- **Permissions**: added `Stock User` (read/write/create) and `Stock Manager`
  (+ delete) roles alongside the existing `System Manager`-only permission —
  previously only System Managers could open this doctype at all.
- **Lightweight edit lock after Completed/Closed.** `ss_coil.py`'s
  `validate()` blocks further saves once `order_status` is `Completed` or
  `Closed`, unless the user is a System Manager or has `process_control_enabled`
  checked (reusing the existing safety-toggle semantics rather than adding a
  new one). Deliberately **not** a full submittable/docstatus workflow — the
  Start/Partial/Complete/Close buttons already model the lifecycle via
  `order_status`, and going submittable would mean also reworking permissions,
  `amended_from` handling, and the existing button flow. The check compares
  against the value **already in the DB** (`frappe.db.get_value`, not the
  in-memory doc), so the save that transitions a document *into*
  Completed/Closed is never blocked by its own transition — only saves made
  *after* it's already in that state.

## Sales Order raw-material planning

Separate from the tag/batch system: `get_available_raw_material_tags`,
`assign_raw_material_tag_to_sales_order_item`,
`get_sales_order_items_pending_raw_material_tags`, and the
`so_production_plan` functions (`get_so_production_plan`,
`save_so_production_plan`) implement a planning UI where a Sales Order Item
gets matched against available raw-material tags in stock before production
starts.

## One-time setup/migration functions

Functions named `setup_*` or `_migrate_*`/`_update_*_field_order` (e.g.
`setup_tag_origin_fields`, `setup_tag_tracking_fields`,
`setup_sales_order_cutting_scheme_fields`) create Custom Fields / Property
Setters idempotently. They're called from `install.py`'s `after_install`/
`after_migrate` hooks, **not** on every request — safe to re-run, but not
meant to run per-document.

## File map

| File | Role |
|---|---|
| `ss_coil/api.py` | Everything: tag lifecycle, batch creation, sticker/QR printing, SS Coil processing, Sales Order planning, one-time setup functions. Grep by the section names above. |
| `ss_coil/stock_entry_data_entry.py` | Backend for the custom Data Entry dialog. |
| `ss_coil/print_utils.py` | `pdf_body_html` hook — injects pre-rendered sticker HTML for print/PDF. |
| `ss_coil/jinja_methods.py` | Whitelists Python functions for direct use in print format Jinja templates. |
| `ss_coil/hooks.py` | All wiring: doc_events, doctype_js, fixtures, print hooks. Read this first to see what's connected to what. |
| `ss_coil/public/js/stock_entry.js` | Stock Entry form JS: Data Entry dialog, sticker print dialog, dimension auto-calc, tag buttons. |
| `ss_coil/public/js/sales_order.js`, `delivery_note.js`, `sales_invoice.js`, `purchase_receipt.js`, `purchase_invoice.js` | Per-doctype form JS, mostly thin (dimension sync, tag display). |
| `ss_coil/public/js/sales_order_manufacture.js` | "Manufacture Items" button/dialog (BOM-based), migrated from the "SO Manufacture" Client Script. Unrelated to the tag/coil system - see its own ARCHITECTURE.md section. |
| `ss_coil/ss_coil/print_format/*/` | Print formats (Stock Entry Coil, Stock Entry Sticker, Stock Entry Sticker Thermal). |
