// src/routes/rulesRoutes.js (PostgreSQL)
import { Router } from "express";
import db from "../config/db.js";

const router = Router();

/**
 * GET all available rules
 * GET /api/rules   (depends how you mount this router)
 */
router.get("/rules", async (req, res) => {
  try {
    const r = await db.query(
      `
      SELECT code, name, description, is_default
      FROM rules
      ORDER BY is_default DESC, name ASC
      `
    );
    return res.json(r.rows || []);
  } catch (err) {
    console.error("GET /rules error:", err);
    return res.status(500).json({ error: "Database error" });
  }
});

/**
 * GET rules for a specific company
 * GET /api/companies/:id/rules
 */
router.get("/companies/:id/rules", async (req, res) => {
  const companyId = parseInt(req.params.id, 10);
  if (!Number.isFinite(companyId) || companyId <= 0) {
    return res.status(400).json({ error: "Invalid company id" });
  }

  try {
    const r = await db.query(
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
       AND cr.company_id = $1
      ORDER BY r.is_default DESC, r.name ASC
      `,
      [companyId]
    );

    return res.json(r.rows || []);
  } catch (err) {
    console.error("GET company rules error:", err);
    return res.status(500).json({ error: "Database error" });
  }
});

/**
 * UPDATE company rules
 * PUT /api/companies/:id/rules
 */
router.put("/companies/:id/rules", async (req, res) => {
  const companyId = parseInt(req.params.id, 10);
  if (!Number.isFinite(companyId) || companyId <= 0) {
    return res.status(400).json({ error: "Invalid company id" });
  }

  const enabledRules = Array.isArray(req.body.rules) ? req.body.rules : [];

  // Base rule must ALWAYS be enabled
  if (!enabledRules.includes("BASE_NATIONALITY")) {
    enabledRules.push("BASE_NATIONALITY");
  }

  try {
    await db.tx(async (client) => {
      // remove existing rules
      await client.query(`DELETE FROM company_rules WHERE company_id = $1`, [companyId]);

      // insert new enabled rules
      for (const code of enabledRules) {
        await client.query(
          `
          INSERT INTO company_rules (company_id, rule_code, enabled)
          VALUES ($1, $2, 1)
          `,
          [companyId, code]
        );
      }
    });

    return res.json({
      message: "Company rules updated",
      rules: enabledRules,
    });
  } catch (err) {
    console.error("UPDATE company rules error:", err);
    return res.status(500).json({ error: "Database error" });
  }
});

export default router;
