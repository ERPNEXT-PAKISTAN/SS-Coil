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
- SS Coil workspace for ERPNext v16

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
  - `SS Coil`

- Report:
  - `Tag Registry Trace`

- Print Format:
  - `Tag Trace`

---

## Screenshots

### Workspace

![SS Coil Workspace](docs/screenshots/coil1.avif)

### Sales Order Dashboard

![Sales Order Dashboard](docs/screenshots/coil2.avif)

### SS Coil Operations

![SS Coil Operations](docs/screenshots/coil3.avif)

### Cutting Scheme and Planning

![Cutting Scheme and Planning](docs/screenshots/coil4.avif)

### Production and Output Tracking

![Production and Output Tracking](docs/screenshots/coil5.avif)

### Tag Registry and Traceability

![Tag Registry and Traceability](docs/screenshots/coil6.avif)

### Stock and Dispatch Flow

![Stock and Dispatch Flow](docs/screenshots/coil7.jpeg)

### Purchase and Inward Tracking

![Purchase and Inward Tracking](docs/screenshots/coil8.jpeg)

### Packing and Reporting

![Packing and Reporting](docs/screenshots/coil9.jpeg)

### Extended Dashboard Views

![Extended Dashboard Views](docs/screenshots/coil10.jpg)

### Additional Operational Screen

![Additional Operational Screen](docs/screenshots/coil11.jpeg)

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

```bash
cd /home/frappe/frappe-bench
bench get-app https://github.com/ERPNEXT-PAKISTAN/SS-Coil.git --branch main
bench --site your-site-name install-app ss_coil
bench --site your-site-name migrate
bench --site your-site-name clear-cache
bench build --app ss_coil
```

If you manage processes manually, restart after installation:

```bash
bench restart
```

### Install on an Existing Bench

```bash
cd /home/frappe/frappe-bench
bench get-app https://github.com/ERPNEXT-PAKISTAN/SS-Coil.git --branch main
bench --site your-site-name install-app ss_coil
bench --site your-site-name migrate
bench --site your-site-name clear-cache
bench build --app ss_coil
```

---

## Update on an Already Installed Server

If `ss_coil` is already installed and you want to pull the latest app code:

```bash
cd /home/frappe/frappe-bench/apps/ss_coil
git pull origin main
```

Then return to bench and run:

```bash
cd /home/frappe/frappe-bench
bench --site your-site-name migrate
bench --site your-site-name clear-cache
bench build --app ss_coil
```

If needed:

```bash
bench restart
```

### One-Line Update Flow

```bash
cd /home/frappe/frappe-bench/apps/ss_coil && git pull origin main && cd /home/frappe/frappe-bench && bench --site your-site-name migrate && bench --site your-site-name clear-cache && bench build --app ss_coil
```

---

## Workspace Access

After installation, open:

- `/app/ss-coil`
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

For another server:

1. Install app
2. Run migration
3. Build assets
4. Clear cache
5. Open `SS Coil` workspace

Commands:

```bash
cd /home/frappe/frappe-bench
bench get-app https://github.com/ERPNEXT-PAKISTAN/SS-Coil.git --branch main
bench --site your-site-name install-app ss_coil
bench --site your-site-name migrate
bench --site your-site-name clear-cache
bench build --app ss_coil
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
- Sales Order, Stock Entry, Purchase documents, Delivery Note, and Sales Invoice integrations are included
- Workspace and desktop launcher setup are part of the app
- Tag tracking and parent-child production trace are part of the app

---

## License

MIT
