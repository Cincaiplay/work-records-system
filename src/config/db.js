// src/config/db.js
import sqlite3 from "sqlite3";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// DB file (project-root/data.sqlite)
const dbPath = path.join(__dirname, "../../data.sqlite");

const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error("❌ Failed to connect to SQLite:", err.message);
  } else {
    console.log("✅ Connected to SQLite database:", dbPath);
  }
});

db.serialize(() => {
  db.run("PRAGMA foreign_keys = ON");

  /* =====================================================
     1) Companies
  ===================================================== */
  db.run(`
    CREATE TABLE IF NOT EXISTS companies (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      short_code TEXT NOT NULL UNIQUE,
      address TEXT,
      phone TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);

  /* =====================================================
     2) Users (Authentication)
  ===================================================== */
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      company_id INTEGER,
      username TEXT NOT NULL UNIQUE,
      email TEXT,
      password_hash TEXT NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 1,
      is_admin INTEGER NOT NULL DEFAULT 0,
      role_id INTEGER,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (company_id, email),
      FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE
    )
  `);

  /* =====================================================
     3) Jobs
  ===================================================== */
  db.run(`
    CREATE TABLE IF NOT EXISTS jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      company_id INTEGER NOT NULL,
      job_code TEXT NOT NULL,
      job_type TEXT NOT NULL,
      normal_price REAL NOT NULL DEFAULT 0,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (company_id, job_code),
      FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE
    )
  `);

  /* =====================================================
     4) Wage Tiers (per company)
  ===================================================== */
  db.run(`
    CREATE TABLE IF NOT EXISTS wage_tiers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      company_id INTEGER NOT NULL,
      tier_code TEXT NOT NULL,      -- stable key (T1/T2/T3)
      tier_name TEXT NOT NULL,      -- display name
      is_active INTEGER NOT NULL DEFAULT 1,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (company_id, tier_code),
      FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE
    )
  `);

  /* =====================================================
     5) Job Wages (job × tier rate)
  ===================================================== */
  db.run(`
    CREATE TABLE IF NOT EXISTS job_wages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      company_id INTEGER NOT NULL,
      job_id INTEGER NOT NULL,
      tier_id INTEGER NOT NULL,
      wage_rate REAL NOT NULL DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (job_id, tier_id),
      FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE,
      FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE,
      FOREIGN KEY (tier_id) REFERENCES wage_tiers(id) ON DELETE CASCADE
    )
  `);

  /* =====================================================
     6) Workers
  ===================================================== */
  db.run(`
    CREATE TABLE IF NOT EXISTS workers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      company_id INTEGER NOT NULL,
      legacy_id INTEGER,
      worker_code TEXT NOT NULL,
      worker_name TEXT,
      worker_english_name TEXT,
      passport_no TEXT,
      employment_start TEXT,
      nationality TEXT,
      terminated TEXT,
      field1 TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      wage_tier_id INTEGER,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (company_id, worker_code),
      FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE,
      FOREIGN KEY (wage_tier_id) REFERENCES wage_tiers(id) ON DELETE SET NULL
    )
  `);

  /* =====================================================
     7) Work Entries (core transactional table)
  ===================================================== */
  db.run(`
    CREATE TABLE IF NOT EXISTS work_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      company_id INTEGER NOT NULL,

      worker_id INTEGER NOT NULL,
      job_id INTEGER NOT NULL,

      work_date TEXT NOT NULL,

      job_no1 TEXT NOT NULL,
      job_no2 TEXT,

      amount REAL NOT NULL DEFAULT 0,

      -- legacy compatibility
      rate REAL NOT NULL DEFAULT 0,
      pay REAL NOT NULL DEFAULT 0,

      -- customer snapshot
      customer_rate REAL NOT NULL DEFAULT 0,
      customer_total REAL NOT NULL DEFAULT 0,
      fees_collected REAL,

      -- wage snapshot
      wage_tier_id INTEGER,
      wage_rate REAL NOT NULL DEFAULT 0,
      wage_total REAL NOT NULL DEFAULT 0,

      -- payment type
      is_bank INTEGER NOT NULL DEFAULT 0,

      note TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,

      UNIQUE (company_id, job_no1),

      FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE,
      FOREIGN KEY (worker_id) REFERENCES workers(id) ON DELETE RESTRICT,
      FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE RESTRICT,
      FOREIGN KEY (wage_tier_id) REFERENCES wage_tiers(id) ON DELETE SET NULL
    )
  `);

  /* =====================================================
     8) Rules / Feature Flags
  ===================================================== */
  db.run(`
    CREATE TABLE IF NOT EXISTS rules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      description TEXT,
      is_default INTEGER NOT NULL DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS company_rules (
      company_id INTEGER NOT NULL,
      rule_code TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (company_id, rule_code),
      FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE,
      FOREIGN KEY (rule_code) REFERENCES rules(code) ON DELETE CASCADE
    )
  `);

  /* =====================================================
     9) RBAC
  ===================================================== */
  db.run(`
    CREATE TABLE IF NOT EXISTS roles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      company_id INTEGER,
      code TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      work_entries_days_limit INTEGER,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (company_id, code),
      FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS permissions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT NOT NULL UNIQUE,
      description TEXT,
      is_active INTEGER NOT NULL DEFAULT 1
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS user_roles (
      user_id INTEGER NOT NULL,
      role_id INTEGER NOT NULL,
      PRIMARY KEY (user_id, role_id),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE CASCADE
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS role_permissions (
      role_id INTEGER NOT NULL,
      permission_id INTEGER NOT NULL,
      PRIMARY KEY (role_id, permission_id),
      FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE CASCADE,
      FOREIGN KEY (permission_id) REFERENCES permissions(id) ON DELETE CASCADE
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS user_permissions (
      user_id INTEGER NOT NULL,
      permission_id INTEGER NOT NULL,
      effect TEXT NOT NULL CHECK(effect IN ('ALLOW','DENY')),
      PRIMARY KEY (user_id, permission_id),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (permission_id) REFERENCES permissions(id) ON DELETE CASCADE
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS user_settings (
      user_id INTEGER PRIMARY KEY,
      work_entries_days_limit_override INTEGER,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);

  /* =====================================================
     Indexes
  ===================================================== */
  db.run(`CREATE INDEX IF NOT EXISTS idx_users_company ON users(company_id)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_workers_company ON workers(company_id)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_jobs_company ON jobs(company_id)`);

  db.run(`CREATE INDEX IF NOT EXISTS idx_wage_tiers_company ON wage_tiers(company_id)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_job_wages_job ON job_wages(job_id)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_job_wages_tier ON job_wages(tier_id)`);

  db.run(`CREATE INDEX IF NOT EXISTS idx_work_entries_company_date ON work_entries(company_id, work_date)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_work_entries_worker_date ON work_entries(worker_id, work_date)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_work_entries_job_date ON work_entries(job_id, work_date)`);
});

export default db;
