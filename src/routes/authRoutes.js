// src/routes/authRoutes.js (PostgreSQL)
import { Router } from "express";
import bcrypt from "bcrypt";
import db from "../config/db.js";

const router = Router();

// GET /login
router.get("/login", (req, res) => {
  if (req.session?.user) return res.redirect("/dashboard");
  res.render("login", { title: "Login", error: null, username: "" });
});

// POST /login
router.post("/login", async (req, res) => {
  const username = (req.body?.username || "").trim();
  const password = req.body?.password || "";

  if (!username || !password) {
    return res.status(400).render("login", {
      title: "Login",
      error: "Username and password are required.",
      username,
    });
  }

  try {
    const ur = await db.query(
      `
      SELECT id, company_id, role_id, username, email, password_hash, is_active, is_admin
        FROM users
       WHERE username = $1
       LIMIT 1
      `,
      [username]
    );

    const user = ur.rows[0] || null;

    if (!user) {
      return res.status(401).render("login", {
        title: "Login",
        error: "Invalid username or password.",
        username,
      });
    }

    if (Number(user.is_active) !== 1) {
      return res.status(403).render("login", {
        title: "Login",
        error: "Account is disabled.",
        username,
      });
    }

    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) {
      return res.status(401).render("login", {
        title: "Login",
        error: "Invalid username or password.",
        username,
      });
    }

    // ✅ Load permissions for this user (via role)
    // Keep JOIN style, but make it resilient if role_id is null.
    const pr = await db.query(
      `
      SELECT DISTINCT p.code
        FROM users u
        JOIN roles r ON r.id = u.role_id
        JOIN role_permissions rp ON rp.role_id = r.id
        JOIN permissions p ON p.id = rp.permission_id
       WHERE u.id = $1
         AND p.is_active = 1
      `,
      [user.id]
    );

    const permissions = (pr.rows || []).map((x) => x.code);

    // ✅ Save session (same shape as before)
    req.session.user = {
      id: user.id,
      company_id: user.company_id,
      username: user.username,
      email: user.email,
      is_admin: Number(user.is_admin) || 0,
      role_id: user.role_id,
      permissions,
    };

    // Optional: if your app uses activeCompanyId elsewhere, set it
    if (!req.session.activeCompanyId && user.company_id) {
      req.session.activeCompanyId = user.company_id;
    }

    return res.redirect("/dashboard");
  } catch (err) {
    console.error("Login DB error:", err);
    return res.status(500).render("login", {
      title: "Login",
      error: "Database error.",
      username,
    });
  }
});

// POST /logout (safer than GET)
router.post("/logout", (req, res) => {
  req.session.destroy(() => {
    res.redirect("/login");
  });
});

export default router;
// 

