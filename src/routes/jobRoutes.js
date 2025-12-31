// src/routes/jobRoutes.js
import { Router } from "express";
import db from "../config/db.js";

const router = Router();

// ------------------ helpers ------------------
function getCompanyId(req) {
  if (req.query?.companyId) return Number(req.query.companyId);
  if (req.body?.companyId) return Number(req.body.companyId);
  if (req.body?.company_id) return Number(req.body.company_id);
  return 1;
}

function normalizeWageRates(input) {
  if (!Array.isArray(input)) return [];
  return input
    .map(x => ({
      tier_id: Number(x.tier_id),
      wage_rate: Number(x.wage_rate || 0),
    }))
    .filter(x => !Number.isNaN(x.tier_id));
}

// ------------------ GET jobs + wages ------------------
router.get("/", (req, res) => {
  const companyId = getCompanyId(req);

  db.all(
    `
    SELECT
      j.id AS job_id,
      j.job_code,
      j.job_type,
      j.normal_price,
      j.normal_price AS customer_rate,
      j.is_active,

      wt.id AS tier_id,
      wt.tier_name,
      COALESCE(jw.wage_rate, 0) AS wage_rate

    FROM jobs j
    LEFT JOIN wage_tiers wt
      ON wt.company_id = j.company_id
    LEFT JOIN job_wages jw
      ON jw.job_id = j.id
     AND jw.tier_id = wt.id

    WHERE j.company_id = ?
    ORDER BY j.job_code, wt.sort_order, wt.id
    `,
    [companyId],
    (err, rows) => {
      if (err) {
        console.error(err);
        return res.status(500).json({ error: "Database error" });
      }

      const map = new Map();

      rows.forEach(r => {
        if (!map.has(r.job_id)) {
          map.set(r.job_id, {
            id: r.job_id,
            job_code: r.job_code,
            job_type: r.job_type,
            normal_price: r.normal_price,
            customer_rate: Number(r.customer_rate || 0),
            is_active: r.is_active,
            wage_rates: [],
          });
        }

        if (r.tier_id != null) {
          map.get(r.job_id).wage_rates.push({
            tier_id: r.tier_id,
            tier_name: r.tier_name,
            wage_rate: Number(r.wage_rate),
          });
        }
      });

      res.json([...map.values()]);
    }
  );
});

// ------------------ CREATE job ------------------
router.post("/", (req, res) => {
  const companyId = getCompanyId(req);
  const { job_code, job_type, normal_price, is_active, wage_rates } = req.body;

  if (!job_code || !job_type) {
    return res.status(400).json({ error: "job_code and job_type required" });
  }

  const rates = normalizeWageRates(wage_rates);

  db.run(
    `
    INSERT INTO jobs (company_id, job_code, job_type, normal_price, is_active)
    VALUES (?, ?, ?, ?, ?)
    `,
    [
      companyId,
      job_code,
      job_type,
      Number(normal_price || 0),
      Number(is_active ?? 1),
    ],
    function (err) {
      if (err) return res.status(500).json({ error: err.message });

      const jobId = this.lastID;

      const stmt = db.prepare(`
        INSERT INTO job_wages (company_id, job_id, tier_id, wage_rate)
        VALUES (?, ?, ?, ?)
      `);

      rates.forEach(r =>
        stmt.run(companyId, jobId, r.tier_id, r.wage_rate)
      );

      stmt.finalize();
      res.status(201).json({ id: jobId });
    }
  );
});

// ------------------ UPDATE job ------------------
router.put("/:id", (req, res) => {
  const companyId = getCompanyId(req);
  const jobId = Number(req.params.id);
  const { job_code, job_type, normal_price, is_active, wage_rates } = req.body;

  const rates = normalizeWageRates(wage_rates);

  db.run(
    `
    UPDATE jobs SET
      job_code = ?, job_type = ?, normal_price = ?, is_active = ?
    WHERE id = ? AND company_id = ?
    `,
    [
      job_code,
      job_type,
      Number(normal_price || 0),
      Number(is_active ?? 1),
      jobId,
      companyId,
    ],
    function (err) {
      if (err) return res.status(500).json({ error: err.message });
      if (!this.changes) return res.status(404).json({ error: "Job not found" });

      const stmt = db.prepare(`
        INSERT INTO job_wages (company_id, job_id, tier_id, wage_rate)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(job_id, tier_id)
        DO UPDATE SET wage_rate = excluded.wage_rate
      `);

      rates.forEach(r =>
        stmt.run(companyId, jobId, r.tier_id, r.wage_rate)
      );

      stmt.finalize();
      res.json({ message: "Job updated" });
    }
  );
});

// ------------------ DELETE job ------------------
router.delete("/:id", (req, res) => {
  const companyId = getCompanyId(req);
  const jobId = Number(req.params.id);

  db.run(
    `DELETE FROM jobs WHERE id = ? AND company_id = ?`,
    [jobId, companyId],
    function (err) {
      if (err) return res.status(500).json({ error: err.message });
      if (!this.changes) return res.status(404).json({ error: "Not found" });
      res.json({ message: "Deleted" });
    }
  );
});

export default router;
