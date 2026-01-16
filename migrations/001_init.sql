-- migrations/001_init.sql
-- Schema converted from src/config/db.js (SQLite) to PostgreSQL

BEGIN;

-- =====================================================
-- 1) Companies
-- =====================================================
CREATE TABLE IF NOT EXISTS companies (
  id            INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name          TEXT NOT NULL,
  short_code    TEXT NOT NULL UNIQUE,
  address       TEXT,
  phone         TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- =====================================================
-- 2) Users (Authentication)
-- Note: keep is_active/is_admin as INTEGER (0/1) to reduce app changes for now
-- =====================================================
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  company_id    INTEGER,
  username      TEXT NOT NULL UNIQUE,
  email         TEXT,
  password_hash TEXT NOT NULL,
  is_active     INTEGER NOT NULL DEFAULT 1,
  is_admin      INTEGER NOT NULL DEFAULT 0,
  role_id       INTEGER,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_users_company_email UNIQUE (company_id, email),
  CONSTRAINT fk_users_company
    FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE
);

-- =====================================================
-- 3) Jobs
-- =====================================================
CREATE TABLE IF NOT EXISTS jobs (
  id            INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  company_id    INTEGER NOT NULL,
  job_code      TEXT NOT NULL,
  job_type      TEXT NOT NULL,
  normal_price  NUMERIC NOT NULL DEFAULT 0,
  is_active     INTEGER NOT NULL DEFAULT 1,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_jobs_company_job_code UNIQUE (company_id, job_code),
  CONSTRAINT fk_jobs_company
    FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE
);

-- =====================================================
-- 4) Wage Tiers (per company)
-- =====================================================
CREATE TABLE IF NOT EXISTS wage_tiers (
  id            INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  company_id    INTEGER NOT NULL,
  tier_code     TEXT NOT NULL,   -- stable key (T1/T2/T3)
  tier_name     TEXT NOT NULL,   -- display name
  is_active     INTEGER NOT NULL DEFAULT 1,
  sort_order    INTEGER NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_wage_tiers_company_tier_code UNIQUE (company_id, tier_code),
  CONSTRAINT fk_wage_tiers_company
    FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE
);

-- =====================================================
-- 5) Job Wages (job × tier rate)
-- SQLite had UNIQUE(job_id, tier_id). Keep same for now.
-- =====================================================
CREATE TABLE IF NOT EXISTS job_wages (
  id            INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  company_id    INTEGER NOT NULL,
  job_id        INTEGER NOT NULL,
  tier_id       INTEGER NOT NULL,
  wage_rate     NUMERIC NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_job_wages_job_tier UNIQUE (job_id, tier_id),
  CONSTRAINT fk_job_wages_company
    FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE,
  CONSTRAINT fk_job_wages_job
    FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE,
  CONSTRAINT fk_job_wages_tier
    FOREIGN KEY (tier_id) REFERENCES wage_tiers(id) ON DELETE CASCADE
);

-- =====================================================
-- 6) Workers
-- Dates stored as DATE to make reporting/filtering easier
-- =====================================================
CREATE TABLE IF NOT EXISTS workers (
  id                  INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  company_id           INTEGER NOT NULL,
  legacy_id            INTEGER,
  worker_code          TEXT NOT NULL,
  worker_name          TEXT,
  worker_english_name  TEXT,
  passport_no          TEXT,
  employment_start     DATE,
  nationality          TEXT,
  terminated           DATE,
  field1               TEXT,
  is_active            INTEGER NOT NULL DEFAULT 1,
  wage_tier_id         INTEGER,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_workers_company_worker_code UNIQUE (company_id, worker_code),
  CONSTRAINT fk_workers_company
    FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE,
  CONSTRAINT fk_workers_wage_tier
    FOREIGN KEY (wage_tier_id) REFERENCES wage_tiers(id) ON DELETE SET NULL
);

-- =====================================================
-- 7) Work Entries (HEADER) + Work Entry Jobs (LINES)
-- work_date stored as DATE
-- =====================================================

-- HEADER
CREATE TABLE IF NOT EXISTS work_entries (
  id            INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  company_id    INTEGER NOT NULL,
  worker_id     INTEGER NOT NULL,
  work_date     DATE NOT NULL,
  job_no1       TEXT NOT NULL,
  job_no2       TEXT,
  fees_collected NUMERIC,
  is_bank       INTEGER NOT NULL DEFAULT 0,
  note          TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_work_entries_company_jobno1 UNIQUE (company_id, job_no1),
  CONSTRAINT fk_work_entries_company
    FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE,
  CONSTRAINT fk_work_entries_worker
    FOREIGN KEY (worker_id) REFERENCES workers(id) ON DELETE RESTRICT
);

-- LINES
CREATE TABLE IF NOT EXISTS work_entry_jobs (
  id              INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  work_entry_id   INTEGER NOT NULL,
  job_id          INTEGER NOT NULL,
  hours           NUMERIC NOT NULL DEFAULT 0,

  -- legacy compatibility (optional)
  rate            NUMERIC NOT NULL DEFAULT 0,
  pay             NUMERIC NOT NULL DEFAULT 0,

  -- customer snapshot (per job line)
  customer_rate   NUMERIC NOT NULL DEFAULT 0,
  customer_total  NUMERIC NOT NULL DEFAULT 0,

  -- wage snapshot (per job line)
  wage_tier_id    INTEGER,
  wage_rate       NUMERIC NOT NULL DEFAULT 0,
  wage_total      NUMERIC NOT NULL DEFAULT 0,

  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT uq_work_entry_jobs_entry_job UNIQUE (work_entry_id, job_id),
  CONSTRAINT fk_work_entry_jobs_entry
    FOREIGN KEY (work_entry_id) REFERENCES work_entries(id) ON DELETE CASCADE,
  CONSTRAINT fk_work_entry_jobs_job
    FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE RESTRICT,
  CONSTRAINT fk_work_entry_jobs_wage_tier
    FOREIGN KEY (wage_tier_id) REFERENCES wage_tiers(id) ON DELETE SET NULL
);

-- =====================================================
-- 8) Rules / Feature Flags
-- =====================================================
CREATE TABLE IF NOT EXISTS rules (
  id          INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  code        TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  description TEXT,
  is_default  INTEGER NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS company_rules (
  company_id  INTEGER NOT NULL,
  rule_code   TEXT NOT NULL,
  enabled     INTEGER NOT NULL DEFAULT 1,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (company_id, rule_code),
  CONSTRAINT fk_company_rules_company
    FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE,
  CONSTRAINT fk_company_rules_rule
    FOREIGN KEY (rule_code) REFERENCES rules(code) ON DELETE CASCADE
);

-- =====================================================
-- 9) RBAC
-- =====================================================
CREATE TABLE IF NOT EXISTS roles (
  id                      INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  company_id               INTEGER,
  code                    TEXT NOT NULL,
  name                    TEXT NOT NULL,
  description             TEXT,
  work_entries_days_limit INTEGER,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_roles_company_code UNIQUE (company_id, code),
  CONSTRAINT fk_roles_company
    FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS permissions (
  id          INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  code        TEXT NOT NULL UNIQUE,
  description TEXT,
  is_active   INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS user_roles (
  user_id INTEGER NOT NULL,
  role_id INTEGER NOT NULL,
  PRIMARY KEY (user_id, role_id),
  CONSTRAINT fk_user_roles_user
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_user_roles_role
    FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS role_permissions (
  role_id       INTEGER NOT NULL,
  permission_id INTEGER NOT NULL,
  PRIMARY KEY (role_id, permission_id),
  CONSTRAINT fk_role_permissions_role
    FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE CASCADE,
  CONSTRAINT fk_role_permissions_permission
    FOREIGN KEY (permission_id) REFERENCES permissions(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS user_permissions (
  user_id       INTEGER NOT NULL,
  permission_id INTEGER NOT NULL,
  effect        TEXT NOT NULL,
  PRIMARY KEY (user_id, permission_id),
  CONSTRAINT ck_user_permissions_effect CHECK (effect IN ('ALLOW','DENY')),
  CONSTRAINT fk_user_permissions_user
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_user_permissions_permission
    FOREIGN KEY (permission_id) REFERENCES permissions(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS user_settings (
  user_id                        INTEGER PRIMARY KEY,
  work_entries_days_limit_override INTEGER,
  CONSTRAINT fk_user_settings_user
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- =====================================================
-- Indexes (same intent as SQLite)
-- =====================================================
CREATE INDEX IF NOT EXISTS idx_users_company ON users(company_id);
CREATE INDEX IF NOT EXISTS idx_workers_company ON workers(company_id);
CREATE INDEX IF NOT EXISTS idx_jobs_company ON jobs(company_id);

CREATE INDEX IF NOT EXISTS idx_wage_tiers_company ON wage_tiers(company_id);
CREATE INDEX IF NOT EXISTS idx_job_wages_job ON job_wages(job_id);
CREATE INDEX IF NOT EXISTS idx_job_wages_tier ON job_wages(tier_id);

CREATE INDEX IF NOT EXISTS idx_work_entries_company_date ON work_entries(company_id, work_date);
CREATE INDEX IF NOT EXISTS idx_work_entries_worker_date ON work_entries(worker_id, work_date);

CREATE INDEX IF NOT EXISTS idx_work_entry_jobs_entry ON work_entry_jobs(work_entry_id);
CREATE INDEX IF NOT EXISTS idx_work_entry_jobs_job ON work_entry_jobs(job_id);

COMMIT;
