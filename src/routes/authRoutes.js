// src/routes/authRoutes.js
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
router.post("/login", (req, res) => {
  const username = (req.body?.username || "").trim();
  const password = req.body?.password || "";

  if (!username || !password) {
    return res.status(400).render("login", {
      title: "Login",
      error: "Username and password are required.",
      username,
    });
  }

  db.get(
    `SELECT id, company_id, role_id, username, email, password_hash, is_active, is_admin
       FROM users
      WHERE username = ?`,
    [username],
    async (err, user) => {
      if (err) {
        console.error("Login DB error:", err.message);
        return res.status(500).render("login", {
          title: "Login",
          error: "Database error.",
          username,
        });
      }

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
      db.all(
        `
        SELECT DISTINCT p.code
          FROM users u
          JOIN roles r ON r.id = u.role_id
          JOIN role_permissions rp ON rp.role_id = r.id
          JOIN permissions p ON p.id = rp.permission_id
         WHERE u.id = ?
           AND p.is_active = 1
        `,
        [user.id],
        (permErr, rows = []) => {
          if (permErr) {
            console.error("Permission load error:", permErr.message);
            return res.status(500).render("login", {
              title: "Login",
              error: "Database error.",
              username,
            });
          }

          const permissions = rows.map(x => x.code);

          // ✅ Save session
          req.session.user = {
            id: user.id,
            company_id: user.company_id,
            username: user.username,
            email: user.email,
            is_admin: Number(user.is_admin) || 0,
            role_id: user.role_id,
            permissions, // ✅ IMPORTANT
          };

          res.redirect("/dashboard");
        }
      );
    }
  );
});



// POST /logout (safer than GET)
router.post("/logout", (req, res) => {
  req.session.destroy(() => {
    res.redirect("/login");
  });
});

export default router;
