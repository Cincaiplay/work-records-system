// src/middleware/permission.js
import db from "../config/db.js";


function isApiRequest(req) {
  return req.originalUrl.startsWith("/api/") || req.headers.accept?.includes("application/json");
}

export function requirePermission(code) {
  return (req, res, next) => {
    const user = req.session?.user;
    if (!user?.id) {
      return isApiRequest(req) ? res.status(401).json({ error: "Unauthorized" }) : res.redirect("/login");
    }

    if (Number(user.is_admin) === 1) return next();

    db.get(
      `
      SELECT 1 AS ok
      FROM users u
      JOIN roles r ON r.id = u.role_id
      JOIN role_permissions rp ON rp.role_id = r.id
      JOIN permissions p ON p.id = rp.permission_id
      WHERE u.id = ?
        AND p.code = ?
        AND p.is_active = 1
      LIMIT 1
      `,
      [user.id, code],
      (err, row) => {
        if (err) {
          console.error("requirePermission error:", err.message);
          return isApiRequest(req)
            ? res.status(500).json({ error: "Server error" })
            : res.status(500).send("Server error");
        }

        if (!row) {
          return isApiRequest(req)
            ? res.status(403).json({ error: "Forbidden", missingPermission: code })
            : res.status(403).render("403", {
                title: "Access denied",
                active: null,
                missingPermission: code,
                message: "Ask an admin to grant you access via Roles & Permissions.",
                path: req.originalUrl,
                method: req.method,
              });
        }

        next();
      }
    );
  };
}

export function hasPermission(userId, code) {
  return new Promise((resolve) => {
    db.get(
      `
      SELECT 1 AS ok
      FROM users u
      JOIN roles r ON r.id = u.role_id
      JOIN role_permissions rp ON rp.role_id = r.id
      JOIN permissions p ON p.id = rp.permission_id
      WHERE u.id = ?
        AND p.code = ?
        AND p.is_active = 1
      LIMIT 1
      `,
      [userId, code],
      (err, row) => {
        if (err) {
          console.error("hasPermission error:", err.message);
          return resolve(false);
        }
        resolve(!!row);
      }
    );
  });
}
