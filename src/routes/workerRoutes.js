// src/routes/workerRoutes.js
import { Router } from "express";
import db from "../config/db.js";

const router = Router();

function getCompanyId(req) {
  if (req.query?.companyId) return parseInt(req.query.companyId, 10) || 1;
  if (req.body?.companyId != null) return parseInt(req.body.companyId, 10) || 1;
  if (req.body?.company_id != null) return parseInt(req.body.company_id, 10) || 1;
  return 1;
}

// =======================
// GET all workers for a company (+ wage tier name)
// GET /api/workers?companyId=1
// =======================
router.get("/", (req, res) => {
  const companyId = getCompanyId(req);

  db.all(
    `SELECT w.*,
            wt.tier_name AS wage_tier_name
       FROM workers w
       LEFT JOIN wage_tiers wt
         ON wt.id = w.wage_tier_id
        AND wt.company_id = w.company_id
      WHERE w.company_id = ?
      ORDER BY w.worker_code ASC`,
    [companyId],
    (err, rows) => {
      if (err) {
        console.error("GET /api/workers error:", err.message);
        return res.status(500).json({ error: "Database error" });
      }
      res.json(rows || []);
    }
  );
});

// =======================
// CREATE worker
// POST /api/workers
// =======================
router.post("/", (req, res) => {
  const companyId = getCompanyId(req);

  const {
    worker_code,
    worker_name,
    worker_english_name,
    passport_no,
    employment_start,
    nationality,
    field1,
    wage_tier_id,
    is_active
  } = req.body;

  if (!worker_code) {
    return res.status(400).json({ error: "worker_code is required." });
  }

  const activeVal = (is_active === 0 || is_active === "0") ? 0 : 1;
  const wageTierIdVal = wage_tier_id != null && wage_tier_id !== "" ? Number(wage_tier_id) : null;

  db.run(
    `INSERT INTO workers (
       company_id, worker_code, worker_name, worker_english_name,
       passport_no, employment_start, nationality, field1,
       wage_tier_id, is_active
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      companyId,
      worker_code,
      worker_name || null,
      worker_english_name || null,
      passport_no || null,
      employment_start || null,
      nationality || null,
      field1 || null,
      wageTierIdVal,
      activeVal
    ],
    function (err) {
      if (err) {
        console.error("POST /api/workers error:", err.message);
        return res.status(500).json({ error: "Database error" });
      }
      res.status(201).json({ id: this.lastID });
    }
  );
});

// =======================
// UPDATE worker
// PUT /api/workers/:id?companyId=1
// =======================
router.put("/:id", (req, res) => {
  const companyId = getCompanyId(req);

  const {
    worker_code,
    worker_name,
    worker_english_name,
    passport_no,
    employment_start,
    nationality,
    field1,
    wage_tier_id,
    is_active
  } = req.body;

  if (!worker_code) {
    return res.status(400).json({ error: "worker_code is required." });
  }

  const activeVal = (is_active === 0 || is_active === "0") ? 0 : 1;
  const wageTierIdVal = wage_tier_id != null && wage_tier_id !== "" ? Number(wage_tier_id) : null;

  db.run(
    `UPDATE workers SET
       worker_code = ?,
       worker_name = ?,
       worker_english_name = ?,
       passport_no = ?,
       employment_start = ?,
       nationality = ?,
       field1 = ?,
       wage_tier_id = ?,
       is_active = ?
     WHERE id = ?
       AND company_id = ?`,
    [
      worker_code,
      worker_name || null,
      worker_english_name || null,
      passport_no || null,
      employment_start || null,
      nationality || null,
      field1 || null,
      wageTierIdVal,
      activeVal,
      req.params.id,
      companyId
    ],
    function (err) {
      if (err) {
        console.error("PUT /api/workers error:", err.message);
        return res.status(500).json({ error: "Database error" });
      }
      if (this.changes === 0) {
        return res.status(404).json({ error: "Worker not found for this company." });
      }
      res.json({ message: "Worker updated", changes: this.changes });
    }
  );
});

// =======================
// DELETE worker
// =======================
router.delete("/:id", (req, res) => {
  const companyId = getCompanyId(req);

  db.run(
    "DELETE FROM workers WHERE id = ? AND company_id = ?",
    [req.params.id, companyId],
    function (err) {
      if (err) {
        console.error("DELETE /api/workers error:", err.message);
        return res.status(500).json({ error: "Database error" });
      }
      if (this.changes === 0) {
        return res.status(404).json({ error: "Worker not found for this company." });
      }
      res.json({ message: "Worker deleted", changes: this.changes });
    }
  );
});

export default router;
