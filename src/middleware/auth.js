// src/middleware/auth.js
import db from "../config/db.js";

export function requireAuth(req, res, next) {
  if (!req.session?.user) return res.redirect("/login");
  next();
}

export function requireAdmin(req, res, next) {
  const userId = Number(req.session?.user?.id);
  if (!Number.isFinite(userId) || userId <= 0) return res.redirect("/login");

  db.get(
    `SELECT u.is_admin, r.code AS role_code
       FROM users u
       LEFT JOIN roles r ON r.id = u.role_id
      WHERE u.id = ?`,
    [userId],
    (err, row) => {
      if (err) {
        console.error("requireAdmin db error:", err.message);
        return res.status(500).send("Server error");
      }

      const isAdmin = Number(row?.is_admin) === 1;
      const roleCode = String(row?.role_code || "").toUpperCase();

      if (isAdmin || roleCode === "ADMIN" || roleCode === "SUPER_ADMIN") {
        return next();
      }

      return res.status(403).render("403", {
        title: "Access denied",
        active: null,
        missingPermission: "ADMIN_ONLY",
        message: "This page is restricted to admin users.",
        path: req.originalUrl,
        method: req.method,
      });
    }
  );
}
