// src/routes/wageTierRoutes.js
import { Router } from "express";
import db from "../config/db.js";

const router = Router();

function getCompanyId(req) {
  if (req.query?.companyId) return parseInt(req.query.companyId, 10);
  if (req.body?.companyId != null) return parseInt(req.body.companyId, 10);
  if (req.body?.company_id != null) return parseInt(req.body.company_id, 10);
  return 1;
}

// GET /api/wage-tiers?companyId=1
router.get("/", (req, res) => {
  const companyId = getCompanyId(req);

  db.all(
    `SELECT id, tier_code, tier_name, is_active, sort_order
       FROM wage_tiers
      WHERE company_id = ?
      ORDER BY sort_order ASC, id ASC`,
    [companyId],
    (err, rows) => {
      if (err) {
        console.error("GET /api/wage-tiers error:", err.message);
        return res.status(500).json({ error: "Database error" });
      }
      res.json(rows || []);
    }
  );
});

export default router;
