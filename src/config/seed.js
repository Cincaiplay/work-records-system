// src/db/seed.js
import db from "../config/db.js";

/**
 * Run: node src/db/seed.js
 * (Or add npm script: "seed": "node src/db/seed.js")
 *
 * Seeds:
 * - companies (default)
 * - wage_tiers (T1/T2/T3 per company)
 * - rules + company_rules (enable defaults)
 * - permissions
 * - roles (global)
 * - role_permissions (super_admin = all, manager/staff curated)
 * - users (default admin + sample manager/staff) + user_roles
 */

function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) return reject(err);
      resolve(this);
    });
  });
}

function get(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) return reject(err);
      resolve(row);
    });
  });
}

function all(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) return reject(err);
      resolve(rows || []);
    });
  });
}

async function ensureDefaultCompany() {
  const row = await get(`SELECT id FROM companies ORDER BY id LIMIT 1`);
  if (row?.id) return row.id;

  const r = await run(
    `INSERT INTO companies (name, short_code, address, phone)
     VALUES (?, ?, ?, ?)`,
    ["Default Company", "DEFAULT", "", ""]
  );
  return r.lastID;
}

async function ensureWageTiers(companyId) {
  // tier_code is the stable key
  const tiers = [
    ["T1", "Tier 1", 10],
    ["T2", "Tier 2", 20],
    ["T3", "Tier 3", 30],
  ];

  for (const [tier_code, tier_name, sort_order] of tiers) {
    await run(
      `INSERT OR IGNORE INTO wage_tiers (company_id, tier_code, tier_name, sort_order, is_active)
       VALUES (?, ?, ?, ?, 1)`,
      [companyId, tier_code, tier_name, sort_order]
    );
  }
}

async function seedRules() {
  const rules = [
    [
      "BASE_NATIONALITY",
      "Base rule: wage by nationality tier",
      "Uses worker nationality (e.g. china1/2/3) to pick job wage tier",
      1,
    ],
    [
      "OVER_20K_5050",
      "Over 20k/month => 50/50 job price",
      "If monthly customer total reaches/exceeds 20k, wage_rate becomes 50% of customer_rate",
      0,
    ],
  ];

  for (const [code, name, description, is_default] of rules) {
    await run(
      `INSERT OR IGNORE INTO rules (code, name, description, is_default)
       VALUES (?, ?, ?, ?)`,
      [code, name, description, is_default]
    );
  }
}

async function ensureCompanyRules(companyId) {
  // Enable default rules for the company (and keep existing untouched)
  await run(
    `
    INSERT OR IGNORE INTO company_rules (company_id, rule_code, enabled)
    SELECT ?, r.code, 1
    FROM rules r
    WHERE COALESCE(r.is_default, 0) = 1
    `,
    [companyId]
  );
}

async function seedPermissions() {
  // Keep permission codes stable (used in code checks)
  const permissions = [
    // Navigation / page visibility
    ["PAGE_DASHBOARD", "Can access Dashboard page"],
    ["PAGE_WORKERS", "Can access Workers page"],
    ["PAGE_JOBS", "Can access Jobs page"],
    ["PAGE_RECORDS", "Can access Records page"],
    ["PAGE_REPORTS", "Can access Reports page"],
    ["PAGE_COMPANIES", "Can access Companies page (admin)"],
    ["PAGE_USERS", "Can access Users/Accounts page (admin)"],
    ["PAGE_ROLES", "Can access Roles/Permissions page (admin)"],

    // CRUD Workers
    ["WORKER_CREATE", "Can create workers"],
    ["WORKER_EDIT", "Can edit workers"],
    ["WORKER_DELETE", "Can delete workers"],

    // CRUD Jobs
    ["JOB_CREATE", "Can create jobs"],
    ["JOB_EDIT", "Can edit jobs"],
    ["JOB_DELETE", "Can delete jobs"],

    // Work entries
    ["WORK_ENTRY_CREATE", "Can create work entries"],
    ["WORK_ENTRY_EDIT", "Can edit work entries"],
    ["WORK_ENTRY_DELETE", "Can delete work entries"],
    ["WORK_ENTRY_VIEW_ALL_DATES", "Can view work entries without date limit"],

    // Reports
    ["REPORT_EXPORT_PDF", "Can export reports as PDF"],
    ["REPORT_EXPORT_EXCEL", "Can export reports as Excel"],

    // Report filters
    ["REPORT_FILTER_PAYTYPE", "Can filter reports by Cash/Bank"],

    // User admin
    ["USER_CREATE", "Can create users"],
    ["USER_EDIT", "Can edit users"],
    ["USER_DEACTIVATE", "Can activate/deactivate users"],

    // Role admin
    ["ROLE_CREATE", "Can create roles"],
    ["ROLE_EDIT", "Can edit roles"],
    ["ROLE_ASSIGN", "Can assign roles to users"],
    ["PERMISSION_ASSIGN", "Can assign permissions to roles/users"],

    // Company admin
    ["COMPANY_CREATE", "Can create companies"],
    ["COMPANY_EDIT", "Can edit companies"],
  ];

  for (const [code, description] of permissions) {
    await run(
      `INSERT OR IGNORE INTO permissions (code, description)
       VALUES (?, ?)`,
      [code, description]
    );
  }
}

async function seedRoles() {
  // company_id NULL = global/system roles
  const roles = [
    [null, "super_admin", "Super Admin", "System owner: full access across companies", null],
    [null, "manager", "Manager", "Company manager: manage data within their company", null],
    [null, "staff", "Staff", "Standard staff: limited actions within their company", 30],
  ];

  for (const [company_id, code, name, description, daysLimit] of roles) {
    await run(
      `INSERT OR IGNORE INTO roles (company_id, code, name, description, work_entries_days_limit)
       VALUES (?, ?, ?, ?, ?)`,
      [company_id, code, name, description, daysLimit]
    );
  }
}

async function roleIdByCode(code) {
  const row = await get(`SELECT id FROM roles WHERE company_id IS NULL AND code = ?`, [code]);
  return row?.id || null;
}

async function permissionIdByCode(code) {
  const row = await get(`SELECT id FROM permissions WHERE code = ?`, [code]);
  return row?.id || null;
}

async function grant(roleCode, permissionCodes) {
  const roleId = await roleIdByCode(roleCode);
  if (!roleId) throw new Error(`Role not found: ${roleCode}`);

  for (const pCode of permissionCodes) {
    const permId = await permissionIdByCode(pCode);
    if (!permId) throw new Error(`Permission not found: ${pCode}`);

    await run(
      `INSERT OR IGNORE INTO role_permissions (role_id, permission_id)
       VALUES (?, ?)`,
      [roleId, permId]
    );
  }
}

async function seedRolePermissions() {
  // super_admin gets everything
  const superRoleId = await roleIdByCode("super_admin");
  if (superRoleId) {
    await run(
      `
      INSERT OR IGNORE INTO role_permissions (role_id, permission_id)
      SELECT ?, p.id FROM permissions p
      `,
      [superRoleId]
    );
  }

  // manager
  await grant("manager", [
    "PAGE_DASHBOARD",
    "PAGE_WORKERS",
    "PAGE_JOBS",
    "PAGE_RECORDS",
    "PAGE_REPORTS",

    "WORKER_CREATE",
    "WORKER_EDIT",
    "WORKER_DELETE",

    "JOB_CREATE",
    "JOB_EDIT",
    "JOB_DELETE",

    "WORK_ENTRY_CREATE",
    "WORK_ENTRY_EDIT",
    "WORK_ENTRY_DELETE",

    "REPORT_EXPORT_PDF",
    "REPORT_FILTER_PAYTYPE",

    "USER_CREATE",
    "USER_EDIT",
    "USER_DEACTIVATE",
  ]);

  // staff
  await grant("staff", [
    "PAGE_DASHBOARD",
    "PAGE_WORKERS",
    "PAGE_JOBS",
    "PAGE_RECORDS",
    "PAGE_REPORTS",

    "WORK_ENTRY_CREATE",
    "REPORT_EXPORT_PDF",
  ]);
}

async function ensureUser({
  companyId,
  username,
  email,
  password_hash,
  is_admin = 0,
  is_active = 1,
}) {
  // If exists, return id
  const row = await get(`SELECT id FROM users WHERE username = ?`, [username]);
  if (row?.id) return row.id;

  // IMPORTANT: this expects you store password_hash already (bcrypt hash)
  // For dev seeding, you can store a placeholder and change it later.
  const r = await run(
    `INSERT INTO users (company_id, username, email, password_hash, is_active, is_admin)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [companyId, username, email, password_hash, is_active, is_admin]
  );
  return r.lastID;
}

async function assignRoleToUser(userId, roleCode) {
  const roleId = await roleIdByCode(roleCode);
  if (!roleId) throw new Error(`Role not found: ${roleCode}`);

  await run(
    `INSERT OR IGNORE INTO user_roles (user_id, role_id)
     VALUES (?, ?)`,
    [userId, roleId]
  );
}

async function seedDefaultUsers(companyId) {
  // NOTE: Replace these hashes with real bcrypt hashes from your auth flow.
  // Example (bcrypt hash for "admin123" etc). Put real hashes here.
  const DEV_HASH = "$2b$10$CwTycUXWue0Thq9StjUM0uJ8bV3k1QdQp8m6cQwNqf1wQfYb3l2mK"; // placeholder

  const adminId = await ensureUser({
    companyId,
    username: "admin",
    email: "admin@example.com",
    password_hash: DEV_HASH,
    is_admin: 1,
  });

  const managerId = await ensureUser({
    companyId,
    username: "manager",
    email: "manager@example.com",
    password_hash: DEV_HASH,
    is_admin: 0,
  });

  const staffId = await ensureUser({
    companyId,
    username: "staff",
    email: "staff@example.com",
    password_hash: DEV_HASH,
    is_admin: 0,
  });

  // Role mapping
  await assignRoleToUser(adminId, "super_admin");
  await assignRoleToUser(managerId, "manager");
  await assignRoleToUser(staffId, "staff");
}

async function main() {
  try {
    const companyId = await ensureDefaultCompany();

    await ensureWageTiers(companyId);

    await seedRules();
    await ensureCompanyRules(companyId);

    await seedPermissions();
    await seedRoles();
    await seedRolePermissions();

    await seedDefaultUsers(companyId);

    console.log("✅ Seed complete.");
  } catch (err) {
    console.error("❌ Seed failed:", err);
    process.exitCode = 1;
  } finally {
    db.close();
  }
}

main();
