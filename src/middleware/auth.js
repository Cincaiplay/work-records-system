// src/middleware/auth.js
import db from "../config/db.js";

export function requireAuth(req, res, next) {
  // ✅ DEV MODE BYPASS
  if (process.env.NODE_ENV === "development") {
    req.session.user = { id: 1, username: "admin" };
    return next();
  }

  if (!req.session?.user) return res.redirect("/login");
  next();
}

/**
 * Admin by Role Code (ADMIN)
 * Assumes: users.role_id -> roles.id, and roles.code exists.
 */
export function requireAdmin(req, res, next) {
  // ✅ DEV MODE = always admin
  if (process.env.NODE_ENV === "development") return next();

  const userId = Number(req.session?.user?.id);
  if (!Number.isFinite(userId) || userId <= 0) return res.redirect("/login");

  db.get(
    `SELECT r.code AS role_code
       FROM users u
       LEFT JOIN roles r ON r.id = u.role_id
      WHERE u.id = ?`,
    [userId],
    (err, row) => {
      if (err) {
        console.error("requireAdmin db error:", err.message);
        return res.status(500).send("Server error");
      }

      const roleCode = String(row?.role_code || "").toUpperCase();
      if (roleCode !== "ADMIN") {
        return res.status(403).render("403", { title: "Forbidden" });
      }

      return next();
    }
  );
}

