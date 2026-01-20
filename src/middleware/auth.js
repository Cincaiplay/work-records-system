// src/middleware/auth.js (PostgreSQL)
import db from "../config/db.js";

function isApiRequest(req) {
  return (
    req.originalUrl.startsWith("/api/") ||
    req.headers.accept?.includes("application/json")
  );
}

export function requireAuth(req, res, next) {
  if (!req.session?.user) {
    return isApiRequest(req)
      ? res.status(401).json({ error: "Unauthorized" })
      : res.redirect("/login");
  }
  next();
}

export async function requireAdmin(req, res, next) {
  const userId = Number(req.session?.user?.id);
  if (!Number.isFinite(userId) || userId <= 0) {
    return isApiRequest(req)
      ? res.status(401).json({ error: "Unauthorized" })
      : res.redirect("/login");
  }

  try {
    const r = await db.query(
      `
      SELECT u.is_admin, r.code AS role_code
        FROM users u
        LEFT JOIN roles r ON r.id = u.role_id
       WHERE u.id = $1
      `,
      [userId]
    );

    const row = r.rows?.[0];
    const isAdmin = Number(row?.is_admin) === 1;
    const roleCode = String(row?.role_code || "").toUpperCase();

    if (isAdmin || roleCode === "ADMIN" || roleCode === "SUPER_ADMIN") {
      return next();
    }

    return isApiRequest(req)
      ? res.status(403).json({ error: "Forbidden", missingPermission: "ADMIN_ONLY" })
      : res.status(403).render("403", {
          title: "Access denied",
          active: null,
          missingPermission: "ADMIN_ONLY",
          message: "This page is restricted to admin users.",
          path: req.originalUrl,
          method: req.method,
        });
  } catch (err) {
    console.error("requireAdmin db error:", err);
    return isApiRequest(req)
      ? res.status(500).json({ error: "Server error" })
      : res.status(500).send("Server error");
  }
}
