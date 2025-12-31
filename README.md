# Work Records & Payroll Management System

A multi-company work records, payroll, and reporting system built with **Node.js**, **Express**, and **SQLite**, designed for service-based businesses (e.g. reflexology, massage, salons).

This system supports:
- Worker job recording
- Tier-based wage calculation
- Cash / bank payment tracking
- Role-based access control (RBAC)
- Detailed reports with PDF export

---

## 🚀 Features

### Core
- Multi-company support
- User authentication & authorization
- Role-based permissions (Admin / Manager / Staff)
- Company-level data isolation

### Workers & Jobs
- Worker management with wage tier assignment
- Job management per company
- Job-specific wage rates by tier

### Work Entries
- Record daily work entries
- Supports:
  - Job No 1 / Job No 2
  - Cash / Bank payment type
  - Customer rate & total
  - Wage tier snapshot & wage total
  - Fees collected (tips / extra charges)
  - Notes
- Historical data preserved even if rates change

### Reports
- Worker Monthly Pays
- Daily Sales Listing
- Worker Job Listing
- Filters:
  - Date range
  - Cash / Bank (permission-based)
  - Job No 1 / Job No 2
- PDF export supported

### Security & Permissions
- RBAC system (roles + permissions)
- Fine-grained permission overrides
- Company & user-specific access rules

---

## 🧱 Tech Stack

| Layer | Technology |
|-----|-----------|
| Backend | Node.js, Express |
| Database | SQLite |
| Auth | Session-based |
| PDF | PDFKit |
| Frontend | EJS, Bootstrap 5 |
| ORM | Raw SQLite (sqlite3) |

---

## 🗄️ Database Overview

Main tables:

- `companies`
- `users`
- `roles`, `permissions`, `role_permissions`
- `workers`
- `jobs`
- `wage_tiers`
- `job_wages`
- `work_entries`
- `rules`, `company_rules`

Key design principles:
- Snapshot-based accounting (rates stored at entry time)
- Strict foreign keys
- Multi-company safe by default

