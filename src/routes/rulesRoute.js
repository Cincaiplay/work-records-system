// src/routes/rulesRoutes.js
import { Router } from "express";
import db from "../config/db.js";

const router = Router();

/**
 * GET all available rules
 * GET /api/rules
 */
router.get("/rules", (req, res) => {
  db.all(
    `
    SELECT code, name, description, is_default
    FROM rules
    ORDER BY is_default DESC, name ASC
    `,
    [],
    (err, rows) => {
      if (err) {
        console.error("GET /rules error:", err);
        return res.status(500).json({ error: "Database error" });
      }
      res.json(rows);
    }
  );
});

/**
 * GET rules for a specific company
 * GET /api/companies/:id/rules
 */
router.get("/companies/:id/rules", (req, res) => {
  const companyId = parseInt(req.params.id, 10);

  db.all(
    `
    SELECT
      r.code,
      r.name,
      r.description,
      r.is_default,
      CASE WHEN cr.enabled = 1 THEN 1 ELSE 0 END AS enabled
    FROM rules r
    LEFT JOIN company_rules cr
      ON cr.rule_code = r.code
     AND cr.company_id = ?
    ORDER BY r.is_default DESC, r.name ASC
    `,
    [companyId],
    (err, rows) => {
      if (err) {
        console.error("GET company rules error:", err);
        return res.status(500).json({ error: "Database error" });
      }
      res.json(rows);
    }
  );
});

/**
 * UPDATE company rules
 * PUT /api/companies/:id/rules
 */
router.put("/companies/:id/rules", (req, res) => {
  const companyId = parseInt(req.params.id, 10);
  const enabledRules = Array.isArray(req.body.rules) ? req.body.rules : [];

  // Base rule must ALWAYS be enabled
  if (!enabledRules.includes("BASE_NATIONALITY")) {
    enabledRules.push("BASE_NATIONALITY");
  }

  db.serialize(() => {
    db.run(
      "DELETE FROM company_rules WHERE company_id = ?",
      [companyId],
      (delErr) => {
        if (delErr) {
          console.error("DELETE company_rules error:", delErr);
          return res.status(500).json({ error: "Database error" });
        }

        const stmt = db.prepare(`
          INSERT INTO company_rules (company_id, rule_code, enabled)
          VALUES (?, ?, 1)
        `);

        enabledRules.forEach(code => {
          stmt.run(companyId, code);
        });

        stmt.finalize((finErr) => {
          if (finErr) {
            console.error("INSERT company_rules error:", finErr);
            return res.status(500).json({ error: "Database error" });
          }

          res.json({
            message: "Company rules updated",
            rules: enabledRules
          });
        });
      }
    );
  });
});

export default router;
