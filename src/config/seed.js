// src/db/seed.js
import db from "../config/db.js";
import bcrypt from "bcrypt";

/**
 * Run: node src/db/seed.js
 *
 * Seeds:
 * - companies (default)
 * - wage_tiers (T1/T2/T3 per company)
 * - rules + company_rules (enable defaults)
 * - permissions
 * - roles (global)
 * - role_permissions (super_admin = all, manager/staff curated)
 * - users (admin + manager/staff) + user_roles + users.role_id sync
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

/* -----------------------------
   Company
------------------------------ */
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

/* -----------------------------
   Wage tiers
------------------------------ */
async function ensureWageTiers(companyId) {
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

/* -----------------------------
   Rules
------------------------------ */
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

/* -----------------------------
   Permissions
------------------------------ */
async function seedPermissions() {
  const permissions = [
    ["PAGE_DASHBOARD", "Can access Dashboard page"],
    ["PAGE_WORKERS", "Can access Workers page"],
    ["PAGE_JOBS", "Can access Jobs page"],
    ["PAGE_RECORDS", "Can access Records page"],
    ["PAGE_REPORTS", "Can access Reports page"],
    ["PAGE_COMPANIES", "Can access Companies page (admin)"],
    ["PAGE_USERS", "Can access Users/Accounts page (admin)"],
    ["PAGE_ROLES", "Can access Roles/Permissions page (admin)"],

    ["WORKER_CREATE", "Can create workers"],
    ["WORKER_EDIT", "Can edit workers"],
    ["WORKER_DELETE", "Can delete workers"],

    ["JOB_CREATE", "Can create jobs"],
    ["JOB_EDIT", "Can edit jobs"],
    ["JOB_DELETE", "Can delete jobs"],

    ["WORK_ENTRY_CREATE", "Can create work entries"],
    ["WORK_ENTRY_EDIT", "Can edit work entries"],
    ["WORK_ENTRY_DELETE", "Can delete work entries"],
    ["WORK_ENTRY_VIEW_ALL_DATES", "Can view work entries without date limit"],

    ["REPORT_EXPORT_PDF", "Can export reports as PDF"],
    ["REPORT_EXPORT_EXCEL", "Can export reports as Excel"],
    ["REPORT_FILTER_PAYTYPE", "Can filter reports by Cash/Bank"],

    ["USER_CREATE", "Can create users"],
    ["USER_EDIT", "Can edit users"],
    ["USER_DEACTIVATE", "Can activate/deactivate users"],

    ["ROLE_CREATE", "Can create roles"],
    ["ROLE_EDIT", "Can edit roles"],
    ["ROLE_ASSIGN", "Can assign roles to users"],
    ["PERMISSION_ASSIGN", "Can assign permissions to roles/users"],

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

/* -----------------------------
   Roles
------------------------------ */
async function seedRoles() {
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
  const superRoleId = await roleIdByCode("super_admin");
  if (superRoleId) {
    await run(
      `
      INSERT OR IGNORE INTO role_permissions (role_id, permission_id)
      SELECT ?, p.id
      FROM permissions p
      `,
      [superRoleId]
    );
  }

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

/* -----------------------------
   Users + role assignment
   IMPORTANT: permission.js uses users.role_id
------------------------------ */
async function ensureUser({
  companyId = null,
  username,
  email,
  password_hash,
  is_admin = 0,
  is_active = 1,
  roleCode = null,
}) {
  const existing = await get(`SELECT id FROM users WHERE username = ?`, [username]);
  const roleId = roleCode ? await roleIdByCode(roleCode) : null;

  if (existing?.id) {
    // keep role_id synced
    if (roleId) await run(`UPDATE users SET role_id = ? WHERE id = ?`, [roleId, existing.id]);
    // keep company_id synced if you changed it
    await run(`UPDATE users SET company_id = ? WHERE id = ?`, [companyId, existing.id]);
    return existing.id;
  }

  const r = await run(
    `INSERT INTO users (company_id, username, email, password_hash, is_active, is_admin, role_id)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [companyId, username, email, password_hash, is_active, is_admin, roleId]
  );

  return r.lastID;
}

async function assignRoleToUser(userId, roleCode) {
  const roleId = await roleIdByCode(roleCode);
  if (!roleId) throw new Error(`Role not found: ${roleCode}`);

  // legacy sync for permission.js
  await run(`UPDATE users SET role_id = ? WHERE id = ?`, [roleId, userId]);

  // mapping table for future RBAC upgrade
  await run(
    `INSERT OR IGNORE INTO user_roles (user_id, role_id)
     VALUES (?, ?)`,
    [userId, roleId]
  );
}

async function seedDefaultUsers(defaultCompanyId) {
  const DEV_HASH = await bcrypt.hash("123123", 10);

  // ✅ admin has NO company
  const adminId = await ensureUser({
    companyId: null,
    username: "admin",
    email: "admin@example.com",
    password_hash: DEV_HASH,
    is_admin: 1,
    roleCode: "super_admin",
  });

  const managerId = await ensureUser({
    companyId: defaultCompanyId,
    username: "manager",
    email: "manager@example.com",
    password_hash: DEV_HASH,
    is_admin: 0,
    roleCode: "manager",
  });

  const staffId = await ensureUser({
    companyId: defaultCompanyId,
    username: "staff",
    email: "staff@example.com",
    password_hash: DEV_HASH,
    is_admin: 0,
    roleCode: "staff",
  });

  await assignRoleToUser(adminId, "super_admin");
  await assignRoleToUser(managerId, "manager");
  await assignRoleToUser(staffId, "staff");
}

/* -----------------------------
   Main
------------------------------ */
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
