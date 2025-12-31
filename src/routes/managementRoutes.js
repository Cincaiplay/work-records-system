import { Router } from "express";
import bcrypt from "bcrypt";
import db from "../config/db.js";
import { requireAuth, requireAdmin } from "../middleware/auth.js";
import { requirePermission } from "../middleware/permission.js";

const router = Router();
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

router.get("/management", requireAuth, (req, res) => {
  const activeTab = req.query.tab || "users";

  // pagination (permissions)
  const permPage = clampInt(req.query.permPage, 1, 999999, 1);
  const permPageSize = clampInt(req.query.permPageSize, 5, 100, 10);

  db.all(
    `SELECT id, company_id, role_id, username, email, is_active, created_at
        FROM users
        ORDER BY created_at DESC, id DESC
    `,
    [],
    (err, users = []) => {
      if (err) {
        console.error(err);
        return res.render("management", {
          title: "Management",
          error: "Database error",
          activeTab,
          users: [],
          companies: [],
          roles: [],
          permissions: [],
          rolePerms: [],
        });
      }

      db.all(
        `SELECT id, short_code, name
           FROM companies
          ORDER BY short_code ASC`,
        [],
        (err2, companies = []) => {
          if (err2) console.error(err2);

          db.all(
            `SELECT id, company_id, code, name, description, work_entries_days_limit
               FROM roles
              ORDER BY (company_id IS NOT NULL) DESC, company_id ASC, code ASC`,
            [],
            (err3, roles = []) => {
              if (err3) console.error(err3);

              db.get(
                `SELECT COUNT(*) AS total FROM permissions`,
                [],
                (err4, row) => {
                  const permTotal = err4 ? 0 : Number(row?.total || 0);
                  const permTotalPages = Math.max(
                    1,
                    Math.ceil(permTotal / permPageSize)
                  );
                  const safePermPage = Math.min(permPage, permTotalPages);
                  const permOffset =
                    (safePermPage - 1) * permPageSize;

                  db.all(
                    `SELECT id, code, description, is_active
                        FROM permissions
                        ORDER BY code ASC
                        LIMIT ? OFFSET ?`,
                    [permPageSize, permOffset],
                    (err5, permissionsPage = []) => {
                        if (err5) console.error(err5);

                        // ✅ full list for role permission modal (show only active)
                        db.all(
                        `SELECT id, code, description
                            FROM permissions
                            WHERE is_active = 1
                            ORDER BY code ASC`,
                        [],
                        (errFull, permissionsAll = []) => {
                            if (errFull) console.error(errFull);

                            db.all(
                              `SELECT role_id, permission_id FROM role_permissions`,
                              [],
                              (err6, rolePerms = []) => {
                                if (err6) console.error(err6);

                                // ✅ add wage tiers fetch here
                                db.all(
                                  `SELECT id, company_id, tier_code, tier_name, is_active, sort_order, created_at
                                    FROM wage_tiers
                                    ORDER BY company_id ASC, sort_order ASC, tier_code ASC`,
                                  [],
                                  (err7, wageTiers = []) => {
                                    if (err7) console.error(err7);

                                    res.render("management", {
                                      title: "Management",
                                      error: req.query.error || null,
                                      success: req.query.success || null,
                                      activeTab,

                                      users,
                                      companies,
                                      roles,

                                      permissions: permissionsPage,
                                      permissionsAll,

                                      rolePerms,

                                      // ✅ NEW
                                      wageTiers,

                                      permPage: safePermPage,
                                      permPageSize,
                                      permTotal,
                                      permTotalPages,
                                    });
                                  }
                                );
                              }
                            );

                        }
                        );
                    }
                    );

                }
              );
            }
          );
        }
      );
    }
  );
});

// POST /management/users/:id/role
router.post("/management/users/:id/role", requireAuth, requireAdmin, (req, res) => {
  const userId = Number(req.params.id);
  const roleIdRaw = req.body.role_id;

  const roleId = roleIdRaw === "" || roleIdRaw == null ? null : Number(roleIdRaw);

  if (!Number.isFinite(userId) || userId <= 0) {
    return redirectMgmt(res, "users", { error: "Invalid user id" });
  }
  if (roleId !== null && (!Number.isFinite(roleId) || roleId <= 0)) {
    return redirectMgmt(res, "users", { error: "Invalid role id" });
  }

  db.run(
    `UPDATE users SET role_id = ? WHERE id = ?`,
    [roleId, userId],
    function (err) {
      if (err) return redirectMgmt(res, "users", { error: err.message });
      if (this.changes === 0) return redirectMgmt(res, "users", { error: "User not found" });
      return redirectMgmt(res, "users", { success: "User role updated" });
    }
  );
});


router.post("/management/permissions/:id/toggle", requireAuth, requireAdmin, (req, res) => {
  const id = Number(req.params.id);

  db.run(
    `UPDATE permissions
        SET is_active = CASE WHEN is_active = 1 THEN 0 ELSE 1 END
      WHERE id = ?`,
    [id],
    (err) => {
      if (err) {
        console.error("Toggle permission error:", err.message);
        return res.redirect("/management?tab=perms&error=" + encodeURIComponent("Toggle failed"));
      }
      return res.redirect("/management?tab=perms&success=" + encodeURIComponent("Permission status updated"));
    }
  );
});


/* ---------------- USERS ---------------- */

router.post("/management/users/create", requireAuth, requireAdmin, async (req, res) => {
  const username = (req.body.username || "").trim();
  const password = req.body.password || "";
  const email = (req.body.email || "").trim() || null;
  const company_id = req.body.company_id ? Number(req.body.company_id) : null;

  if (!username || !password) {
    return redirectMgmt(res, "users", { error: "Username & password required" });
  }

  const password_hash = await bcrypt.hash(password, 10);

  db.run(
    `INSERT INTO users (company_id, username, email, password_hash, is_active)
     VALUES (?, ?, ?, ?, 1)`,
    [company_id, username, email, password_hash],
    err => {
      if (err) return redirectMgmt(res, "users", { error: err.message });
      redirectMgmt(res, "users", { success: "User created" });
    }
  );
});

router.post("/management/users/:id/toggle", requireAuth, requireAdmin, (req, res) => {
  db.run(
    `UPDATE users
        SET is_active = CASE WHEN is_active = 1 THEN 0 ELSE 1 END
      WHERE id = ?`,
    [Number(req.params.id)],
    err => {
      if (err) return redirectMgmt(res, "users", { error: "Toggle failed" });
      redirectMgmt(res, "users", { success: "User status updated" });
    }
  );
});

router.post("/management/users/:id/update", requireAuth, requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  const username = (req.body.username || "").trim();
  const email = (req.body.email || "").trim() || null;
  const company_id = req.body.company_id !== "" ? Number(req.body.company_id) : null;
  const is_active = Number(req.body.is_active) === 1 ? 1 : 0;
  const password = req.body.password || "";

  if (!username) {
    return redirectMgmt(res, "users", { error: "Username required" });
  }

  const fields = [`username = ?`, `email = ?`, `company_id = ?`, `is_active = ?`];
  const params = [username, email, company_id, is_active];

  if (password) {
    const hash = await bcrypt.hash(password, 10);
    fields.push("password_hash = ?");
    params.push(hash);
  }

  params.push(id);

  db.run(
    `UPDATE users SET ${fields.join(", ")} WHERE id = ?`,
    params,
    err => {
      if (err) return redirectMgmt(res, "users", { error: err.message });
      redirectMgmt(res, "users", { success: "User updated" });
    }
  );
});

/* ---------------- ROLES ---------------- */

router.post("/management/roles/create", requireAuth, requireAdmin, (req, res) => {
  const code = (req.body.code || "").trim();
  const name = (req.body.name || "").trim();
  const description = (req.body.description || "").trim() || null;
  const company_id = req.body.company_id !== "" ? Number(req.body.company_id) : null;

  if (!code || !name) {
    return redirectMgmt(res, "roles", { error: "Code & name required" });
  }

  db.run(
    `INSERT INTO roles (company_id, code, name, description)
     VALUES (?, ?, ?, ?)`,
    [company_id, code, name, description],
    err => {
      if (err) return redirectMgmt(res, "roles", { error: err.message });
      redirectMgmt(res, "roles", { success: "Role created" });
    }
  );
});

router.post("/management/roles/:id/permissions", requireAuth, requireAdmin, (req, res) => {
  const roleId = Number(req.params.id);
  let permIds = req.body.permissions || [];
  if (!Array.isArray(permIds)) permIds = [permIds];
  permIds = permIds.map(Number);

  db.serialize(() => {
    db.run("BEGIN");
    db.run(`DELETE FROM role_permissions WHERE role_id = ?`, [roleId]);

    const stmt = db.prepare(
      `INSERT INTO role_permissions (role_id, permission_id) VALUES (?, ?)`
    );

    permIds.forEach(pid => stmt.run(roleId, pid));

    stmt.finalize(() => {
      db.run("COMMIT");
      redirectMgmt(res, "roles", { success: "Permissions updated" });
    });
  });
});

// POST /management/roles/:id/delete
router.post("/management/roles/:id/delete", requireAuth, requireAdmin, (req, res) => {
  const roleId = Number(req.params.id);

  if (!Number.isFinite(roleId) || roleId <= 0) {
    return redirectMgmt(res, "roles", { error: "Invalid role id" });
  }

  db.serialize(() => {
    db.run("BEGIN");

    // remove role permissions first (safe even if CASCADE exists)
    db.run(`DELETE FROM role_permissions WHERE role_id = ?`, [roleId], (err1) => {
      if (err1) {
        db.run("ROLLBACK");
        return redirectMgmt(res, "roles", { error: err1.message });
      }

      // now delete role
      db.run(`DELETE FROM roles WHERE id = ?`, [roleId], function (err2) {
        if (err2) {
          db.run("ROLLBACK");
          return redirectMgmt(res, "roles", { error: err2.message });
        }

        // if nothing deleted, role didn't exist
        if (this.changes === 0) {
          db.run("ROLLBACK");
          return redirectMgmt(res, "roles", { error: "Role not found" });
        }

        db.run("COMMIT");
        return redirectMgmt(res, "roles", { success: "Role deleted" });
      });
    });
  });
});


/* ---------------- PERMISSIONS ---------------- */

router.post("/management/permissions/create", requireAuth, requireAdmin, (req, res) => {
  const code = (req.body.code || "").trim();
  const description = (req.body.description || "").trim() || null;

  if (!code) {
    return redirectMgmt(res, "perms", { error: "Permission code required" });
  }

  db.run(
    `INSERT INTO permissions (code, description, is_active) VALUES (?, ?, 1)`,
    [code, description],
    err => {
      if (err) return redirectMgmt(res, "perms", { error: err.message });
      redirectMgmt(res, "perms", { success: "Permission created" });
    }
  );
});


// POST /management/permissions/:id/delete  (hard delete - only if NOT used)
router.post("/management/permissions/:id/delete", requireAuth, requireAdmin, (req, res) => {
  const permId = Number(req.params.id);

  if (!Number.isFinite(permId) || permId <= 0) {
    return redirectMgmt(res, "perms", { error: "Invalid permission id" });
  }

  // block delete if this permission is used by any role
  db.get(
    `SELECT COUNT(*) AS cnt
       FROM role_permissions
      WHERE permission_id = ?`,
    [permId],
    (err, row) => {
      if (err) {
        console.error("Check permission usage error:", err.message);
        return redirectMgmt(res, "perms", { error: "Database error" });
      }

      const usedCount = Number(row?.cnt || 0);
      if (usedCount > 0) {
        return redirectMgmt(res, "perms", {
          error: "Cannot delete: permission is assigned to roles. Deactivate it instead.",
        });
      }

      // safe delete (not used anywhere)
      db.run(`DELETE FROM permissions WHERE id = ?`, [permId], function (err2) {
        if (err2) {
          console.error("Delete permission error:", err2.message);
          return redirectMgmt(res, "perms", { error: err2.message });
        }

        if (this.changes === 0) {
          return redirectMgmt(res, "perms", { error: "Permission not found" });
        }

        return redirectMgmt(res, "perms", { success: "Permission deleted" });
      });
    }
  );
});

// ---------------- WAGE TIERS ----------------

// POST /management/wage-tiers/create
router.post("/management/wage-tiers/create", requireAuth, requireAdmin, (req, res) => {
  const company_id = req.body.company_id !== "" ? Number(req.body.company_id) : null;
  const tier_code = (req.body.tier_code || "").trim();
  const tier_name = (req.body.tier_name || "").trim();
  const sort_order = req.body.sort_order !== "" ? Number(req.body.sort_order) : 0;

  if (!company_id || !tier_code || !tier_name) {
    return redirectMgmt(res, "wage_tiers", { error: "Company, tier code, and tier name are required" });
  }

  db.run(
    `INSERT INTO wage_tiers (company_id, tier_code, tier_name, sort_order, is_active)
     VALUES (?, ?, ?, ?, 1)`,
    [company_id, tier_code, tier_name, Number.isFinite(sort_order) ? sort_order : 0],
    (err) => {
      if (err) {
        // UNIQUE(company_id, tier_code) will trigger this message if duplicate
        return redirectMgmt(res, "wage_tiers", { error: err.message });
      }
      return redirectMgmt(res, "wage_tiers", { success: "Wage tier created" });
    }
  );
});


// TOGGLE active
router.post("/management/wage-tiers/:id/toggle", requireAuth, requireAdmin, (req, res) => {
  const id = Number(req.params.id);

  db.run(
    `UPDATE wage_tiers
        SET is_active = CASE WHEN is_active = 1 THEN 0 ELSE 1 END
      WHERE id = ?`,
    [id],
    (err) => {
      if (err) return redirectMgmt(res, "wage_tiers", { error: "Toggle failed" });
      return redirectMgmt(res, "wage_tiers", { success: "Wage tier updated" });
    }
  );
});

// HARD DELETE (only allow if not referenced)
router.post("/management/wage-tiers/:id/delete", requireAuth, requireAdmin, (req, res) => {
  const id = Number(req.params.id);

  db.get(
    `SELECT COUNT(*) AS cnt FROM workers WHERE wage_tier_id = ?`,
    [id],
    (err, row) => {
      if (err) return redirectMgmt(res, "wage_tiers", { error: err.message });

      if (Number(row?.cnt || 0) > 0) {
        return redirectMgmt(res, "wage_tiers", { error: "Cannot delete: tier is used by workers" });
      }

      db.run(`DELETE FROM wage_tiers WHERE id = ?`, [id], (err2) => {
        if (err2) return redirectMgmt(res, "wage_tiers", { error: err2.message });
        return redirectMgmt(res, "wage_tiers", { success: "Wage tier deleted" });
      });
    }
  );
});


export default router;
