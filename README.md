# SS Coil

<div align="center">

<img src="ss_coil/public/images/ss-coil-logo.svg" alt="SS Coil Logo" width="140">

### Coil Planning, Production Tracking, Tag Traceability, and Operations Control for ERPNext

`SS Coil` is a custom ERPNext app for managing coil-based operations from order planning to stock movement, production split, dispatch, invoicing, and tag-level traceability.

![ERPNext](https://img.shields.io/badge/ERPNext-v16-blue)
![Frappe](https://img.shields.io/badge/Frappe-Framework-green)
![License](https://img.shields.io/badge/License-MIT-orange)

</div>

---

## Overview

`SS Coil` extends ERPNext for businesses working with mother coils, slitting, multi-size production planning, inward/outward tracking, and tag-based control.

It is designed to support real operational flow across:

- Sales Order planning
- Coil input and output tracking
- Stock Entry linkage
- Parent-to-child production tags
- Dispatch and invoice traceability
- Packing, expense, BOM, and order dashboard visibility

This app keeps customizations in the app itself so they can be deployed cleanly to other servers.

---

## Main Capabilities

### Sales Order Planning

- Sales Order item-wise cutting scheme planning
- Production planning popup for multiple cutting rows
- Live item dashboard on Sales Order
- Packing detail tracking
- Tag generation on Sales Order Item

### SS Coil Production

- Load one Sales Order item into `SS Coil`
- Load one Stock Entry item into `SS Coil`
- Cutting detail and production detail management
- Parent coil to child coil output handling
- Width, ratio, and estimated weight calculations

### Tag Traceability

- Unique tag generation and registry
- Parent tag and child tag tree
- Tag flow across:
  - Sales Order
  - Purchase Receipt
  - Purchase Invoice
  - Stock Entry
  - SS Coil
  - Delivery Note
  - Sales Invoice

### Dashboard and Reporting

- Sales Order dashboard with multiple operational sections
- Tag Registry Trace report
- Tag Trace print format
- SS Coil Space workspace for ERPNext v16

---

## Included Modules and Records

This app currently includes:

- App-owned DocTypes
  - `SS Coil`
  - `Coil Output`
  - `Coil Input`
  - `Cutting Scheme`
  - `Cutting Scheme SO`
  - `Coil SO`
  - `For Customer`
  - `SO Production Plan`
  - `Tag Number Settings`
  - `Tag Registry`

- App fixtures for:
  - `Custom Field`
  - `Property Setter`
  - `Client Script`
  - `Server Script`

- Workspace:
  - `SS Coil Space`

- Report:
  - `Tag Registry Trace`

- Print Format:
  - `Tag Trace`

---

## Screenshots

<table>
  <tr>
    <td align="center"><b>Workspace</b><br><img src="docs/screenshots/coil1.avif" alt="SS Coil Workspace" width="100%"></td>
    <td align="center"><b>Sales Order Dashboard</b><br><img src="docs/screenshots/coil2.avif" alt="Sales Order Dashboard" width="100%"></td>
  </tr>
  <tr>
    <td align="center"><b>SS Coil Operations</b><br><img src="docs/screenshots/coil3.avif" alt="SS Coil Operations" width="100%"></td>
    <td align="center"><b>Cutting Scheme and Planning</b><br><img src="docs/screenshots/coil4.avif" alt="Cutting Scheme and Planning" width="100%"></td>
  </tr>
  <tr>
    <td align="center"><b>Production and Output Tracking</b><br><img src="docs/screenshots/coil5.avif" alt="Production and Output Tracking" width="100%"></td>
    <td align="center"><b>Tag Registry and Traceability</b><br><img src="docs/screenshots/coil6.avif" alt="Tag Registry and Traceability" width="100%"></td>
  </tr>
  <tr>
    <td align="center"><b>Stock and Dispatch Flow</b><br><img src="docs/screenshots/coil7.jpeg" alt="Stock and Dispatch Flow" width="100%"></td>
    <td align="center"><b>Purchase and Inward Tracking</b><br><img src="docs/screenshots/coil8.jpeg" alt="Purchase and Inward Tracking" width="100%"></td>
  </tr>
  <tr>
    <td align="center"><b>Packing and Reporting</b><br><img src="docs/screenshots/coil9.jpeg" alt="Packing and Reporting" width="100%"></td>
    <td align="center"><b>Extended Dashboard Views</b><br><img src="docs/screenshots/coil10.jpg" alt="Extended Dashboard Views" width="100%"></td>
  </tr>
  <tr>
    <td align="center"><b>Additional Operational Screen</b><br><img src="docs/screenshots/coil11.jpeg" alt="Additional Operational Screen" width="100%"></td>
    <td align="center"><b>Additional Reference</b><br><img src="docs/screenshots/nut1.avif" alt="Additional Reference" width="100%"></td>
  </tr>
</table>

---

## How To Add Images

### Option 1: Add screenshots to this repository

Put image files here:

```text
apps/ss_coil/docs/screenshots/
```

Then reference them in `README.md` like:

```md
![Workspace](docs/screenshots/workspace.png)
```

### Option 2: Use external image URLs

If you host images elsewhere, use:

```md
![Workspace](https://your-domain.com/path/workspace.png)
```

For this app, keeping screenshots inside `docs/screenshots/` is the best option because the README remains portable with the repository.

---

## Installation

### Fresh Install on a New Server

Use this only when `ss_coil` is **not** already in `apps/`.

```bash
cd /home/frappe/frappe-bench
bench get-app https://github.com/ERPNEXT-PAKISTAN/SS-Coil.git --branch main
bench --site your-site-name install-app ss_coil
bench --site your-site-name migrate
bench build --app ss_coil
bench --site your-site-name clear-cache
```

Tag-related custom fields are created automatically during `install-app` and `migrate` via the app install hook.

If you manage processes manually, restart after installation:

```bash
bench restart
```

### Install on a Bench That Already Has `ss_coil`

Do **not** run `bench get-app` again. That causes this error:

```text
OSError: [Errno 39] Directory not empty: '.../apps/SS-Coil' -> '.../apps/ss_coil'
```

Use the [Update on an Already Installed Server](#update-on-an-already-installed-server) steps below instead.

---

## Update on an Already Installed Server

Use this when `ss_coil` is already installed and you only want the latest code.

### Standard update

```bash
cd /home/frappe/frappe-bench

# Remove failed clone folder if a previous get-app attempt left it behind
rm -rf apps/SS-Coil

# Pull latest app code
cd apps/ss_coil
git fetch origin
git checkout main
git pull origin main

# Apply updates on site
cd /home/frappe/frappe-bench
bench --site your-site-name migrate
bench build --app ss_coil
bench --site your-site-name clear-cache
```

Replace `your-site-name` with your site, for example `ss.frappe.my`.

### One-line update

```bash
cd /home/frappe/frappe-bench && rm -rf apps/SS-Coil && cd apps/ss_coil && git fetch origin && git checkout main && git pull origin main && cd /home/frappe/frappe-bench && bench --site your-site-name migrate && bench build --app ss_coil && bench --site your-site-name clear-cache
```

### Verify latest code

```bash
cd /home/frappe/frappe-bench/apps/ss_coil
git log -1 --oneline
```

You should see the latest commit from `main`, for example:

```text
782a025 Add tag-origin fixtures and auto-setup on install/migrate.
```

### If tag fields are still missing after update

Run the setup command once, then clear cache:

```bash
bench --site your-site-name execute ss_coil.api.setup_tag_origin_fields
bench --site your-site-name clear-cache
```

This ensures fields such as these exist:

- Item: `Create Tag on Receipt`
- Purchase Receipt / Stock Entry: `Create Tag Numbers`
- Purchase Receipt Item / Stock Entry Detail: `Create Tag No`
- Sales Order Item: raw material tag linking fields

Then hard-refresh the browser (`Ctrl+Shift+R`).

### If `apps/ss_coil` is not a git repository

Only then reinstall the app folder:

```bash
cd /home/frappe/frappe-bench
bench --site your-site-name uninstall-app ss_coil
rm -rf apps/ss_coil apps/SS-Coil
bench get-app https://github.com/ERPNEXT-PAKISTAN/SS-Coil.git --branch main
bench --site your-site-name install-app ss_coil
bench --site your-site-name migrate
bench build --app ss_coil
bench --site your-site-name clear-cache
```

If needed after update:

```bash
bench restart
```

---

## Cloud Server Example

For site `ss.frappe.my`:

```bash
cd /home/frappe/frappe-bench
rm -rf apps/SS-Coil
cd apps/ss_coil
git fetch origin
git checkout main
git pull origin main
cd /home/frappe/frappe-bench
bench --site ss.frappe.my migrate
bench build --app ss_coil
bench --site ss.frappe.my clear-cache
bench --site ss.frappe.my execute ss_coil.api.setup_tag_origin_fields
bench --site ss.frappe.my clear-cache
```

---

## Workspace Access

After installation, open:

- `/app/ss-coil-space`
- or search `SS Coil` from the Awesome Bar

The workspace includes quick access to:

- `SS Coil`
- `SO Production Plan`
- `Tag Number Settings`
- `Tag Registry`
- `Tag Registry Trace`
- `Sales Order`
- `Stock Entry`
- `Purchase Receipt`
- `Purchase Invoice`
- `Delivery Note`
- `Sales Invoice`

---

## Tag System

The app includes a built-in tag control system.

### Core Components

- `Tag Number Settings`
  - controls prefix, numbering, and next tag sequence

- `Tag Registry`
  - stores each tag and its source/current document flow

- `Tag Registry Trace`
  - grouped reporting for root tags and child tags

### Tag Flow Example

```text
SSCC-04545-000   -> Parent Tag
SSCC-04545-001   -> Child Output 1
SSCC-04545-002   -> Child Output 2
SSCC-04545-003   -> Child Output 3
```

This is useful when one input coil is converted into one or more production output pieces.

---

## Recommended Deployment Flow

### New server

1. Install app
2. Run migration
3. Build assets
4. Clear cache
5. Open `SS Coil Space` workspace

```bash
cd /home/frappe/frappe-bench
bench get-app https://github.com/ERPNEXT-PAKISTAN/SS-Coil.git --branch main
bench --site your-site-name install-app ss_coil
bench --site your-site-name migrate
bench build --app ss_coil
bench --site your-site-name clear-cache
```

### Existing server

1. Pull latest code from `apps/ss_coil`
2. Run migration
3. Build assets
4. Clear cache
5. Run tag setup if needed

```bash
cd /home/frappe/frappe-bench/apps/ss_coil && git pull origin main
cd /home/frappe/frappe-bench
bench --site your-site-name migrate
bench build --app ss_coil
bench --site your-site-name clear-cache
bench --site your-site-name execute ss_coil.api.setup_tag_origin_fields
bench --site your-site-name clear-cache
```

---

## Repository Structure

```text
ss_coil/
├── config/
├── desktop_icon/
├── docs/
│   └── screenshots/
├── ss_coil/
│   ├── doctype/
│   ├── print_format/
│   ├── report/
│   └── workspace/
├── fixtures/
├── public/
│   ├── images/
│   └── js/
├── pyproject.toml
└── README.md
```

---

## Development Notes

- This app keeps operational customizations in code and fixtures
- Tag-origin custom fields are exported in fixtures and also applied by `after_install` / `after_migrate`
- Sales Order, Stock Entry, Purchase documents, Delivery Note, and Sales Invoice integrations are included
- Workspace and desktop launcher setup are part of the app
- Tag tracking and parent-child production trace are part of the app

---

## License

MIT
