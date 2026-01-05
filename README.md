# Work Records & Payroll Management System

A full-stack web application designed to manage **daily work records, payroll calculation, and reporting** for small service-based businesses.

This project focuses on **real-world business workflows** such as tier-based wages, cash vs bank payments, multi-company support, and role-based access control.

---

## Key Features

- Worker & job management
- Tier-based wage calculation (per job & per worker)
- Daily work entry recording with customer fees tracking
- Cash / bank payment separation
- Monthly payroll and sales records
- PDF report export
- Role-based access control (RBAC)
- Multi-company support

---

## Why This Project

This system was built to solve common issues in small service businesses:
- Manual payroll calculation errors
- Lack of transparency between collected fees and wages
- No clear separation of cash and bank transactions
- Difficulty generating monthly summaries for management

The application emphasizes **data consistency**, **auditability**, and **permission-based access**.

---

## Tech Stack

- **Backend:** Node.js, Express
- **Database:** SQLite (relational schema with migrations)
- **Frontend:** EJS, Bootstrap 5
- **Auth & Security:** Session-based auth, RBAC
- **Reporting:** PDF generation

---

## Architecture Highlights

- Relational database design with foreign key constraints
- Snapshot-based wage calculation (historical accuracy)
- Centralized permission middleware
- Company-scoped data access
- Separation between business rules and presentation logic

---

## Getting Started

```bash
npm install
node src/db/db.js
node src/db/seed.js
npm start
```

---

## Demo Accounts

After running the seed script, you can log in with these default accounts (password: `123123`):

- **Admin (system-wide)**
  - Username: `admin`
  - Email: `admin@example.com`
  - Access: Full access across the system (super admin)

- **Manager (company-scoped)**
  - Username: `manager`
  - Email: `manager@example.com`
  - Access: Manage workers, jobs, work records, reports, and users within the default company

- **Staff (company-scoped)**
  - Username: `staff`
  - Email: `staff@example.com`
  - Access: Record work entries, view operational pages, export PDF reports (limited permissions)

