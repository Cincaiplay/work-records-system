// src/routes/wageTierRoutes.js (PostgreSQL)
import { Router } from "express";
import db from "../config/db.js";

const router = Router();

function getCompanyId(req) {
  if (req.query?.companyId) return parseInt(req.query.companyId, 10) || 1;
  if (req.body?.companyId != null) return parseInt(req.body.companyId, 10) || 1;
  if (req.body?.company_id != null) return parseInt(req.body.company_id, 10) || 1;
  return 1;
}

// GET /api/wage-tiers?companyId=1
router.get("/", async (req, res) => {
  const companyId = getCompanyId(req);

  try {
    const r = await db.query(
      `
      SELECT id, tier_code, tier_name, is_active, sort_order
        FROM wage_tiers
       WHERE company_id = $1
       ORDER BY sort_order ASC, id ASC
      `,
      [companyId]
    );

    return res.json(r.rows || []);
  } catch (err) {
    console.error("GET /api/wage-tiers error:", err);
    return res.status(500).json({ error: "Database error" });
  }
});

export default router;
