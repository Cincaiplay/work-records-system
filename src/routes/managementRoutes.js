// src/routes/managementRoutes.js (PostgreSQL)
import { Router } from "express";
import bcrypt from "bcrypt";
import db from "../config/db.js";
import { requireAuth, requireAdmin } from "../middleware/auth.js";
import { requirePermission } from "../middleware/permission.js";

const router = Router();

// Apply auth + permission for ALL /management routes
router.use("/management", requireAuth, requirePermission("PAGE_MANAGEMENT"));

/* ---------------- helpers ---------------- */

function clampInt(v, min, max, fallback) {
  const n = Number.parseInt(v, 10);
  if (Number.isNaN(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function redirectMgmt(res, tab = "users", params = {}) {
  const qs = new URLSearchParams({ tab, ...params });
  return res.redirect(`/management?${qs.toString()}`);
}

/* ---------------- GET /management ---------------- */

router.get("/management", async (req, res) => {
  const activeTab = req.query.tab || "users";

  const permPage = clampInt(req.query.permPage, 1, 999999, 1);
  const permPageSize = clampInt(req.query.permPageSize, 5, 100, 10);

  try {
    const usersR = await db.query(
      `
      SELECT id, company_id, role_id, username, email, is_active, created_at
      FROM users
      ORDER BY created_at DESC, id DESC
      `
    );

    const companiesR = await db.query(
      `
      SELECT id, short_code, name
      FROM companies
      ORDER BY short_code ASC
      `
    );

    const rolesR = await db.query(
      `
      SELECT id, company_id, code, name, description, work_entries_days_limit
      FROM roles
      ORDER BY (company_id IS NOT NULL) DESC, company_id ASC, code ASC
      `
    );

    const permTotalR = await db.query(`SELECT COUNT(*)::int AS total FROM permissions`);
    const permTotal = Number(permTotalR.rows?.[0]?.total || 0);

    const permTotalPages = Math.max(1, Math.ceil(permTotal / permPageSize));
    const safePermPage = Math.min(permPage, permTotalPages);
    const permOffset = (safePermPage - 1) * permPageSize;

    const permissionsPageR = await db.query(
      `
      SELECT id, code, description, is_active
      FROM permissions
      ORDER BY code ASC
      LIMIT $1 OFFSET $2
      `,
      [permPageSize, permOffset]
    );

    const permissionsAllR = await db.query(
      `
      SELECT id, code, description
      FROM permissions
      WHERE is_active = 1
      ORDER BY code ASC
      `
    );

    const rolePermsR = await db.query(
      `SELECT role_id, permission_id FROM role_permissions`
    );

    const wageTiersR = await db.query(
      `
      SELECT id, company_id, tier_code, tier_name, is_active, sort_order, created_at
      FROM wage_tiers
      ORDER BY company_id ASC, sort_order ASC, tier_code ASC
      `
    );

    return res.render("management", {
      title: "Management",
      error: req.query.error || null,
      success: req.query.success || null,
      activeTab,

      users: usersR.rows || [],
      companies: companiesR.rows || [],
      roles: rolesR.rows || [],

      permissions: permissionsPageR.rows || [],
      permissionsAll: permissionsAllR.rows || [],

      rolePerms: rolePermsR.rows || [],

      wageTiers: wageTiersR.rows || [],

      permPage: safePermPage,
      permPageSize,
      permTotal,
      permTotalPages,
    });
  } catch (err) {
    console.error("GET /management error:", err);
    return res.render("management", {
      title: "Management",
      error: "Database error",
      activeTab,
      users: [],
      companies: [],
      roles: [],
      permissions: [],
      permissionsAll: [],
      rolePerms: [],
      wageTiers: [],
      permPage: 1,
      permPageSize,
      permTotal: 0,
      permTotalPages: 1,
    });
  }
});

/* ---------------- USERS ---------------- */

// POST /management/users/:id/role
router.post("/management/users/:id/role", requireAdmin, async (req, res) => {
  const userId = Number(req.params.id);
  const roleIdRaw = req.body.role_id;
  const roleId = roleIdRaw === "" || roleIdRaw == null ? null : Number(roleIdRaw);

  if (!Number.isFinite(userId) || userId <= 0) {
    return redirectMgmt(res, "users", { error: "Invalid user id" });
  }
  if (roleId !== null && (!Number.isFinite(roleId) || roleId <= 0)) {
    return redirectMgmt(res, "users", { error: "Invalid role id" });
  }

  try {
    const r = await db.query(
      `UPDATE users SET role_id = $1 WHERE id = $2`,
      [roleId, userId]
    );
    if (r.rowCount === 0) return redirectMgmt(res, "users", { error: "User not found" });
    return redirectMgmt(res, "users", { success: "User role updated" });
  } catch (err) {
    return redirectMgmt(res, "users", { error: err.message });
  }
});

router.post("/management/permissions/:id/toggle", requireAdmin, async (req, res) => {
  const id = Number(req.params.id);

  try {
    await db.query(
      `
      UPDATE permissions
      SET is_active = CASE WHEN is_active = 1 THEN 0 ELSE 1 END
      WHERE id = $1
      `,
      [id]
    );
    return res.redirect("/management?tab=perms&success=" + encodeURIComponent("Permission status updated"));
  } catch (err) {
    console.error("Toggle permission error:", err);
    return res.redirect("/management?tab=perms&error=" + encodeURIComponent("Toggle failed"));
  }
});

router.post("/management/users/create", requireAdmin, async (req, res) => {
  const username = (req.body.username || "").trim();
  const password = req.body.password || "";
  const email = (req.body.email || "").trim() || null;
  const company_id = req.body.company_id ? Number(req.body.company_id) : null;

  if (!username || !password) {
    return redirectMgmt(res, "users", { error: "Username & password required" });
  }

  try {
    const password_hash = await bcrypt.hash(password, 10);

    await db.query(
      `
      INSERT INTO users (company_id, username, email, password_hash, is_active)
      VALUES ($1, $2, $3, $4, 1)
      `,
      [company_id, username, email, password_hash]
    );

    return redirectMgmt(res, "users", { success: "User created" });
  } catch (err) {
    return redirectMgmt(res, "users", { error: err.message });
  }
});

router.post("/management/users/:id/toggle", requireAdmin, async (req, res) => {
  const id = Number(req.params.id);

  try {
    await db.query(
      `
      UPDATE users
      SET is_active = CASE WHEN is_active = 1 THEN 0 ELSE 1 END
      WHERE id = $1
      `,
      [id]
    );
    return redirectMgmt(res, "users", { success: "User status updated" });
  } catch (err) {
    return redirectMgmt(res, "users", { error: "Toggle failed" });
  }
});

router.post("/management/users/:id/update", requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  const username = (req.body.username || "").trim();
  const email = (req.body.email || "").trim() || null;
  const company_id = req.body.company_id !== "" ? Number(req.body.company_id) : null;
  const is_active = Number(req.body.is_active) === 1 ? 1 : 0;
  const password = req.body.password || "";

  if (!username) {
    return redirectMgmt(res, "users", { error: "Username required" });
  }

  try {
    const sets = ["username = $1", "email = $2", "company_id = $3", "is_active = $4"];
    const values = [username, email, company_id, is_active];

    let idx = 5;
    if (password) {
      const hash = await bcrypt.hash(password, 10);
      sets.push(`password_hash = $${idx++}`);
      values.push(hash);
    }

    values.push(id);

    const q = `UPDATE users SET ${sets.join(", ")} WHERE id = $${idx}`;
    await db.query(q, values);

    return redirectMgmt(res, "users", { success: "User updated" });
  } catch (err) {
    return redirectMgmt(res, "users", { error: err.message });
  }
});

/* ---------------- ROLES ---------------- */

router.post("/management/roles/create", requireAdmin, async (req, res) => {
  const code = (req.body.code || "").trim();
  const name = (req.body.name || "").trim();
  const description = (req.body.description || "").trim() || null;
  const company_id = req.body.company_id !== "" ? Number(req.body.company_id) : null;
  const limitRaw = req.body.work_entries_days_limit;
  const work_entries_days_limit =
    limitRaw === "" || limitRaw == null ? null : Number(limitRaw);

  if (!code || !name) {
    return redirectMgmt(res, "roles", { error: "Code & name required" });
  }
  if (work_entries_days_limit != null && (!Number.isFinite(work_entries_days_limit) || work_entries_days_limit <= 0)) {
    return redirectMgmt(res, "roles", { error: "Days limit must be a positive number" });
  }

  try {
    await db.query(
      `
      INSERT INTO roles (company_id, code, name, description, work_entries_days_limit)
      VALUES ($1, $2, $3, $4, $5)
      `,
      [company_id, code, name, description, work_entries_days_limit]
    );
    return redirectMgmt(res, "roles", { success: "Role created" });
  } catch (err) {
    return redirectMgmt(res, "roles", { error: err.message });
  }
});

router.post("/management/roles/:id/limit", requireAdmin, async (req, res) => {
  const roleId = Number(req.params.id);
  const limitRaw = req.body.work_entries_days_limit;
  const work_entries_days_limit =
    limitRaw === "" || limitRaw == null ? null : Number(limitRaw);

  if (!Number.isFinite(roleId) || roleId <= 0) {
    return redirectMgmt(res, "roles", { error: "Invalid role id" });
  }
  if (work_entries_days_limit != null && (!Number.isFinite(work_entries_days_limit) || work_entries_days_limit <= 0)) {
    return redirectMgmt(res, "roles", { error: "Days limit must be a positive number" });
  }

  try {
    await db.query(
      `UPDATE roles SET work_entries_days_limit = $1 WHERE id = $2`,
      [work_entries_days_limit, roleId]
    );
    return redirectMgmt(res, "roles", { success: "Days limit updated" });
  } catch (err) {
    return redirectMgmt(res, "roles", { error: err.message });
  }
});

router.post("/management/roles/:id/permissions", requireAdmin, async (req, res) => {
  const roleId = Number(req.params.id);
  let permIds = req.body.permissions || [];
  if (!Array.isArray(permIds)) permIds = [permIds];
  permIds = permIds.map(Number).filter((x) => Number.isFinite(x));

  try {
    await db.tx(async (client) => {
      await client.query(`DELETE FROM role_permissions WHERE role_id = $1`, [roleId]);

      for (const pid of permIds) {
        await client.query(
          `INSERT INTO role_permissions (role_id, permission_id) VALUES ($1, $2)`,
          [roleId, pid]
        );
      }
    });

    return redirectMgmt(res, "roles", { success: "Permissions updated" });
  } catch (err) {
    return redirectMgmt(res, "roles", { error: err.message });
  }
});

router.post("/management/roles/:id/delete", requireAdmin, async (req, res) => {
  const roleId = Number(req.params.id);

  if (!Number.isFinite(roleId) || roleId <= 0) {
    return redirectMgmt(res, "roles", { error: "Invalid role id" });
  }

  try {
    await db.tx(async (client) => {
      await client.query(`DELETE FROM role_permissions WHERE role_id = $1`, [roleId]);
      const del = await client.query(`DELETE FROM roles WHERE id = $1`, [roleId]);
      if (del.rowCount === 0) {
        throw Object.assign(new Error("ROLE_NOT_FOUND"), { _kind: "user" });
      }
    });

    return redirectMgmt(res, "roles", { success: "Role deleted" });
  } catch (err) {
    if (err?._kind === "user" && err.message === "ROLE_NOT_FOUND") {
      return redirectMgmt(res, "roles", { error: "Role not found" });
    }
    return redirectMgmt(res, "roles", { error: err.message });
  }
});

/* ---------------- PERMISSIONS ---------------- */

router.post("/management/permissions/create", requireAdmin, async (req, res) => {
  const code = (req.body.code || "").trim();
  const description = (req.body.description || "").trim() || null;

  if (!code) {
    return redirectMgmt(res, "perms", { error: "Permission code required" });
  }

  try {
    await db.query(
      `INSERT INTO permissions (code, description, is_active) VALUES ($1, $2, 1)`,
      [code, description]
    );
    return redirectMgmt(res, "perms", { success: "Permission created" });
  } catch (err) {
    return redirectMgmt(res, "perms", { error: err.message });
  }
});

router.post("/management/permissions/:id/delete", requireAdmin, async (req, res) => {
  const permId = Number(req.params.id);

  if (!Number.isFinite(permId) || permId <= 0) {
    return redirectMgmt(res, "perms", { error: "Invalid permission id" });
  }

  try {
    const used = await db.query(
      `SELECT COUNT(*)::int AS cnt FROM role_permissions WHERE permission_id = $1`,
      [permId]
    );

    const usedCount = Number(used.rows?.[0]?.cnt || 0);
    if (usedCount > 0) {
      return redirectMgmt(res, "perms", {
        error: "Cannot delete: permission is assigned to roles. Deactivate it instead.",
      });
    }

    const del = await db.query(`DELETE FROM permissions WHERE id = $1`, [permId]);
    if (del.rowCount === 0) return redirectMgmt(res, "perms", { error: "Permission not found" });

    return redirectMgmt(res, "perms", { success: "Permission deleted" });
  } catch (err) {
    return redirectMgmt(res, "perms", { error: err.message });
  }
});

/* ---------------- WAGE TIERS ---------------- */

router.post("/management/wage-tiers/create", requireAdmin, async (req, res) => {
  const company_id = req.body.company_id !== "" ? Number(req.body.company_id) : null;
  const tier_code = (req.body.tier_code || "").trim();
  const tier_name = (req.body.tier_name || "").trim();
  const sort_order = req.body.sort_order !== "" ? Number(req.body.sort_order) : 0;

  if (!company_id || !tier_code || !tier_name) {
    return redirectMgmt(res, "wage_tiers", { error: "Company, tier code, and tier name are required" });
  }

  try {
    await db.query(
      `
      INSERT INTO wage_tiers (company_id, tier_code, tier_name, sort_order, is_active)
      VALUES ($1, $2, $3, $4, 1)
      `,
      [company_id, tier_code, tier_name, Number.isFinite(sort_order) ? sort_order : 0]
    );

    return redirectMgmt(res, "wage_tiers", { success: "Wage tier created" });
  } catch (err) {
    return redirectMgmt(res, "wage_tiers", { error: err.message });
  }
});

router.post("/management/wage-tiers/:id/toggle", requireAdmin, async (req, res) => {
  const id = Number(req.params.id);

  try {
    await db.query(
      `
      UPDATE wage_tiers
      SET is_active = CASE WHEN is_active = 1 THEN 0 ELSE 1 END
      WHERE id = $1
      `,
      [id]
    );
    return redirectMgmt(res, "wage_tiers", { success: "Wage tier updated" });
  } catch (err) {
    return redirectMgmt(res, "wage_tiers", { error: "Toggle failed" });
  }
});

router.post("/management/wage-tiers/:id/delete", requireAdmin, async (req, res) => {
  const id = Number(req.params.id);

  try {
    const used = await db.query(
      `SELECT COUNT(*)::int AS cnt FROM workers WHERE wage_tier_id = $1`,
      [id]
    );

    if (Number(used.rows?.[0]?.cnt || 0) > 0) {
      return redirectMgmt(res, "wage_tiers", { error: "Cannot delete: tier is used by workers" });
    }

    await db.query(`DELETE FROM wage_tiers WHERE id = $1`, [id]);
    return redirectMgmt(res, "wage_tiers", { success: "Wage tier deleted" });
  } catch (err) {
    return redirectMgmt(res, "wage_tiers", { error: err.message });
  }
});

export default router;
