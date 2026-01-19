// src/db/seed.js (PostgreSQL)
import "dotenv/config";
import db from "../config/db.js";
import bcrypt from "bcrypt";

/**
 * Run: node src/config/seed.js
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

async function ensureDefaultCompany() {
  const existing = await db.query(`SELECT id FROM companies ORDER BY id LIMIT 1`);
  if (existing.rows[0]?.id) return existing.rows[0].id;

  const ins = await db.query(
    `
    INSERT INTO companies (name, short_code, address, phone)
    VALUES ($1, $2, $3, $4)
    RETURNING id
    `,
    ["Default Company", "DEFAULT", "", ""]
  );

  return ins.rows[0].id;
}

async function ensureWageTiers(companyId) {
  const tiers = [
    ["T1", "Tier 1", 10],
    ["T2", "Tier 2", 20],
    ["T3", "Tier 3", 30],
  ];

  for (const [tier_code, tier_name, sort_order] of tiers) {
    await db.query(
      `
      INSERT INTO wage_tiers (company_id, tier_code, tier_name, sort_order, is_active)
      VALUES ($1, $2, $3, $4, 1)
      ON CONFLICT (company_id, tier_code) DO NOTHING
      `,
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
    [
      "MULTI_JOB_LOWEST_TIER_OTHERS_5050",
      "Multi-job rule: lowest wage uses tier, others 50/50",
      "When a work entry has multiple jobs, only the lowest wage job uses wage tier. All other jobs use 50% of customer_rate.",
      0,
    ],
  ];

  for (const [code, name, description, is_default] of rules) {
    await db.query(
      `
      INSERT INTO rules (code, name, description, is_default)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (code) DO NOTHING
      `,
      [code, name, description, is_default]
    );
  }
}

async function ensureCompanyRules(companyId) {
  // enable default rules for the company
  await db.query(
    `
    INSERT INTO company_rules (company_id, rule_code, enabled)
    SELECT $1, r.code, 1
    FROM rules r
    WHERE COALESCE(r.is_default, 0) = 1
    ON CONFLICT (company_id, rule_code) DO NOTHING
    `,
    [companyId]
  );
}

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
    await db.query(
      `
      INSERT INTO permissions (code, description)
      VALUES ($1, $2)
      ON CONFLICT (code) DO NOTHING
      `,
      [code, description]
    );
  }
}

async function seedRoles() {
  const roles = [
    [null, "super_admin", "Super Admin", "System owner: full access across companies", null],
    [null, "manager", "Manager", "Company manager: manage data within their company", null],
    [null, "staff", "Staff", "Standard staff: limited actions within their company", 30],
  ];

  for (const [company_id, code, name, description, daysLimit] of roles) {
    await db.query(
      `
      INSERT INTO roles (company_id, code, name, description, work_entries_days_limit)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (company_id, code) DO NOTHING
      `,
      [company_id, code, name, description, daysLimit]
    );
  }
}

async function roleIdByCode(code) {
  const r = await db.query(
    `SELECT id FROM roles WHERE company_id IS NULL AND code = $1 LIMIT 1`,
    [code]
  );
  return r.rows[0]?.id || null;
}

async function permissionIdByCode(code) {
  const r = await db.query(`SELECT id FROM permissions WHERE code = $1 LIMIT 1`, [code]);
  return r.rows[0]?.id || null;
}

async function grant(roleCode, permissionCodes) {
  const roleId = await roleIdByCode(roleCode);
  if (!roleId) throw new Error(`Role not found: ${roleCode}`);

  for (const pCode of permissionCodes) {
    const permId = await permissionIdByCode(pCode);
    if (!permId) throw new Error(`Permission not found: ${pCode}`);

    await db.query(
      `
      INSERT INTO role_permissions (role_id, permission_id)
      VALUES ($1, $2)
      ON CONFLICT (role_id, permission_id) DO NOTHING
      `,
      [roleId, permId]
    );
  }
}

async function seedRolePermissions() {
  const superRoleId = await roleIdByCode("super_admin");
  if (superRoleId) {
    await db.query(
      `
      INSERT INTO role_permissions (role_id, permission_id)
      SELECT $1, p.id
      FROM permissions p
      ON CONFLICT (role_id, permission_id) DO NOTHING
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

async function ensureUser({
  companyId = null,
  username,
  email,
  password_hash,
  is_admin = 0,
  is_active = 1,
  roleCode = null,
}) {
  const roleId = roleCode ? await roleIdByCode(roleCode) : null;

  // upsert by username
  const up = await db.query(
    `
    INSERT INTO users (company_id, username, email, password_hash, is_active, is_admin, role_id)
    VALUES ($1, $2, $3, $4, $5, $6, $7)
    ON CONFLICT (username)
    DO UPDATE SET
      company_id = EXCLUDED.company_id,
      email = EXCLUDED.email,
      password_hash = EXCLUDED.password_hash,
      is_active = EXCLUDED.is_active,
      is_admin = EXCLUDED.is_admin,
      role_id = EXCLUDED.role_id
    RETURNING id
    `,
    [companyId, username, email, password_hash, is_active, is_admin, roleId]
  );

  return up.rows[0].id;
}

async function assignRoleToUser(userId, roleCode) {
  const roleId = await roleIdByCode(roleCode);
  if (!roleId) throw new Error(`Role not found: ${roleCode}`);

  // sync for permission.js (uses users.role_id)
  await db.query(`UPDATE users SET role_id = $1 WHERE id = $2`, [roleId, userId]);

  // mapping table
  await db.query(
    `
    INSERT INTO user_roles (user_id, role_id)
    VALUES ($1, $2)
    ON CONFLICT (user_id, role_id) DO NOTHING
    `,
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
    // close postgres pool
    await db.pool.end();
  }
}

main();
