// src/routes/jobRoutes.js (PostgreSQL)
import { Router } from "express";
import db from "../config/db.js";
import multer from "multer";
import { parse } from "csv-parse/sync";

const upload = multer({ storage: multer.memoryStorage() });
const router = Router();

/* =====================================================
   Helpers
===================================================== */

function getCompanyId(req) {
  if (req.query?.companyId) return Number(req.query.companyId) || 1;
  if (req.body?.companyId) return Number(req.body.companyId) || 1;
  if (req.body?.company_id) return Number(req.body.company_id) || 1;
  return 1;
}

function normalizeWageRates(input) {
  if (!Array.isArray(input)) return [];
  return input
    .map((x) => ({
      tier_id: Number(x.tier_id),
      wage_rate: Number(x.wage_rate || 0),
    }))
    .filter((x) => Number.isFinite(x.tier_id));
}

function cleanCell(v) {
  return String(v ?? "").replace(/\u00A0/g, " ").trim();
}

function rowHasAnyValue(obj) {
  if (!obj || typeof obj !== "object") return false;
  return Object.values(obj).some((v) => cleanCell(v) !== "");
}

function csvEscape(v) {
  const s = String(v ?? "");
  if (s.includes('"') || s.includes(",") || s.includes("\n") || s.includes("\r")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function normalizeHeader(h) {
  return String(h ?? "")
    .replace(/^\uFEFF/, "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_");
}

function asTrimOrNull(v) {
  const s = String(v ?? "").trim();
  return s === "" ? null : s;
}

function asNumberOrNull(v) {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  if (s === "") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : "__INVALID__";
}

/* =====================================================
   GET jobs + wages
   GET /api/jobs?companyId=1
===================================================== */
router.get("/", async (req, res) => {
  const companyId = getCompanyId(req);

  try {
    const r = await db.query(
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

      WHERE j.company_id = $1
      ORDER BY j.job_code, wt.sort_order, wt.id
      `,
      [companyId]
    );

    const map = new Map();

    (r.rows || []).forEach((row) => {
      if (!map.has(row.job_id)) {
        map.set(row.job_id, {
          id: row.job_id,
          job_code: row.job_code,
          job_type: row.job_type,
          normal_price: row.normal_price,
          customer_rate: Number(row.customer_rate || 0),
          is_active: row.is_active,
          wage_rates: [],
        });
      }

      if (row.tier_id != null) {
        map.get(row.job_id).wage_rates.push({
          tier_id: row.tier_id,
          tier_name: row.tier_name,
          wage_rate: Number(row.wage_rate || 0),
        });
      }
    });

    return res.json([...map.values()]);
  } catch (err) {
    console.error("GET /api/jobs error:", err);
    return res.status(500).json({ error: "Database error" });
  }
});

/* =====================================================
   CREATE job
   POST /api/jobs
===================================================== */
router.post("/", async (req, res) => {
  const companyId = getCompanyId(req);
  const { job_code, job_type, normal_price, is_active, wage_rates } = req.body;

  if (!job_code || !job_type) {
    return res.status(400).json({ error: "job_code and job_type required" });
  }

  const rates = normalizeWageRates(wage_rates);

  try {
    let createdId = null;

    await db.tx(async (client) => {
      const ins = await client.query(
        `
        INSERT INTO jobs (company_id, job_code, job_type, normal_price, is_active)
        VALUES ($1, $2, $3, $4, $5)
        RETURNING id
        `,
        [companyId, job_code, job_type, Number(normal_price || 0), Number(is_active ?? 1)]
      );

      createdId = ins.rows[0].id;

      for (const r of rates) {
        await client.query(
          `
          INSERT INTO job_wages (company_id, job_id, tier_id, wage_rate)
          VALUES ($1, $2, $3, $4)
          ON CONFLICT (job_id, tier_id)
          DO UPDATE SET wage_rate = EXCLUDED.wage_rate
          `,
          [companyId, createdId, r.tier_id, r.wage_rate]
        );
      }
    });

    return res.status(201).json({ id: createdId });
  } catch (err) {
    // unique_violation (company_id, job_code)
    if (err?.code === "23505") {
      return res.status(409).json({ error: "job_code must be unique for this company." });
    }
    console.error("POST /api/jobs error:", err);
    return res.status(500).json({ error: "Database error" });
  }
});

/* =====================================================
   UPDATE job
   PUT /api/jobs/:id
===================================================== */
router.put("/:id", async (req, res) => {
  const companyId = getCompanyId(req);
  const jobId = Number(req.params.id);
  const { job_code, job_type, normal_price, is_active, wage_rates } = req.body;

  if (!jobId) return res.status(400).json({ error: "Invalid job id" });
  if (!job_code || !job_type) {
    return res.status(400).json({ error: "job_code and job_type required" });
  }

  const rates = normalizeWageRates(wage_rates);

  try {
    await db.tx(async (client) => {
      const upd = await client.query(
        `
        UPDATE jobs
           SET job_code = $1,
               job_type = $2,
               normal_price = $3,
               is_active = $4
         WHERE id = $5
           AND company_id = $6
        `,
        [job_code, job_type, Number(normal_price || 0), Number(is_active ?? 1), jobId, companyId]
      );

      if (upd.rowCount === 0) {
        const e = new Error("NOT_FOUND");
        throw e;
      }

      for (const r of rates) {
        await client.query(
          `
          INSERT INTO job_wages (company_id, job_id, tier_id, wage_rate)
          VALUES ($1, $2, $3, $4)
          ON CONFLICT (job_id, tier_id)
          DO UPDATE SET wage_rate = EXCLUDED.wage_rate
          `,
          [companyId, jobId, r.tier_id, r.wage_rate]
        );
      }
    });

    return res.json({ message: "Job updated" });
  } catch (err) {
    if (err?.message === "NOT_FOUND") {
      return res.status(404).json({ error: "Job not found" });
    }
    if (err?.code === "23505") {
      return res.status(409).json({ error: "job_code must be unique for this company." });
    }
    console.error("PUT /api/jobs error:", err);
    return res.status(500).json({ error: "Database error" });
  }
});

/* =====================================================
   DELETE job
   DELETE /api/jobs/:id
===================================================== */
router.delete("/:id", async (req, res) => {
  const companyId = getCompanyId(req);
  const jobId = Number(req.params.id);

  if (!jobId) return res.status(400).json({ error: "Invalid job id" });

  try {
    const r = await db.query(
      `DELETE FROM jobs WHERE id = $1 AND company_id = $2`,
      [jobId, companyId]
    );

    if (r.rowCount === 0) return res.status(404).json({ error: "Not found" });

    return res.json({ message: "Deleted" });
  } catch (err) {
    // FK violations if work_entry_jobs references this job
    if (err?.code === "23503") {
      return res.status(409).json({ error: "Cannot delete: job is referenced by work entries." });
    }
    console.error("DELETE /api/jobs error:", err);
    return res.status(500).json({ error: "Database error" });
  }
});

/* =====================================================
   EXPORT jobs
   GET /api/jobs/export?companyId=1
===================================================== */
router.get("/export", async (req, res) => {
  try {
    const companyId = Number(req.query.companyId || 1);
    if (!companyId || companyId <= 0) {
      return res.status(400).send("Invalid companyId");
    }

    const c = await db.query(`SELECT name FROM companies WHERE id = $1`, [companyId]);
    const companyName = c.rows[0]?.name || `company_${companyId}`;

    const safeCompanyName = String(companyName)
      .replace(/[^\w\d]+/g, "_")
      .replace(/^_+|_+$/g, "");

    const r = await db.query(
      `
      SELECT job_code, job_type, normal_price
        FROM jobs
       WHERE company_id = $1
       ORDER BY job_code ASC
      `,
      [companyId]
    );

    const rows = r.rows || [];

    const header = ["job_code", "job_type", "normal_price"].join(",");

    const body = rows
      .map((x) =>
        [x.job_code ?? "", x.job_type ?? "", x.normal_price ?? ""].map(csvEscape).join(",")
      )
      .join("\n");

    const csv = "\ufeff" + header + "\n" + body + "\n";

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${safeCompanyName}_jobs.csv"`
    );

    return res.send(csv);
  } catch (err) {
    console.error("jobs export error:", err);
    return res.status(500).send("Failed to export jobs");
  }
});

/* =====================================================
   CSV Template
   GET /api/jobs/template.csv
===================================================== */
router.get("/template.csv", (req, res) => {
  const header = "job_code,job_type,normal_price";
  const sample1 = "JC01,按脚-68,68";
  const sample2 = "JC02,按身-70,70";
  const sample3 = "JC03,前台,1000";

  const csv = "\ufeff" + [header, sample1, sample2, sample3].join("\n") + "\n";

  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="jobs_template.csv"`);
  res.send(csv);
});

/* =====================================================
   IMPORT jobs (Confirm)
   POST /api/jobs/import
===================================================== */
router.post("/import", upload.single("file"), async (req, res) => {
  try {
    const companyId = Number(req.body.companyId || req.query.companyId || 1);
    if (!companyId || companyId <= 0) return res.status(400).json({ error: "Invalid companyId" });
    if (!req.file?.buffer) return res.status(400).json({ error: "Missing file" });

    const text = req.file.buffer.toString("utf8").replace(/^\uFEFF/, "");

    const recordsRaw = parse(text, {
      bom: true,
      columns: (headers) => headers.map(normalizeHeader),
      skip_empty_lines: true,
      trim: true,
    });

    const records = (recordsRaw || []).filter(rowHasAnyValue);

    const errors = [];
    let inserted = 0;
    let updated = 0;

    await db.tx(async (client) => {
      for (let i = 0; i < records.length; i++) {
        const r = records[i];
        const rowNo = i + 2;

        const job_code = asTrimOrNull(r.job_code);
        const job_type = asTrimOrNull(r.job_type);
        const normal_price = asNumberOrNull(r.normal_price);

        if (!job_code) {
          errors.push({ row: rowNo, field: "job_code", error: "Required" });
          continue;
        }
        if (!job_type) {
          errors.push({ row: rowNo, field: "job_type", error: "Required" });
          continue;
        }
        if (normal_price === "__INVALID__") {
          errors.push({ row: rowNo, field: "normal_price", error: "Must be a number" });
          continue;
        }

        const existing = await client.query(
          `
          SELECT id
            FROM jobs
           WHERE company_id = $1
             AND lower(job_code) = lower($2)
           LIMIT 1
          `,
          [companyId, job_code]
        );

        if (existing.rowCount === 0) {
          await client.query(
            `
            INSERT INTO jobs (company_id, job_code, job_type, normal_price)
            VALUES ($1, $2, $3, $4)
            `,
            [companyId, job_code, job_type, normal_price ?? null]
          );
          inserted++;
        } else {
          const id = existing.rows[0].id;

          // dynamic update like your sqlite logic
          const sets = [];
          const values = [];
          let p = 1;

          sets.push(`job_type = $${p++}`); values.push(job_type);

          if (normal_price !== null) {
            sets.push(`normal_price = $${p++}`); values.push(normal_price);
          }

          values.push(id);

          await client.query(
            `UPDATE jobs SET ${sets.join(", ")} WHERE id = $${p}`,
            values
          );
          updated++;
        }
      }

      if (errors.length) {
        const e = new Error("VALIDATION_FAILED");
        e._errors = errors;
        throw e;
      }
    });

    return res.json({ ok: true, inserted, updated, total: records.length });
  } catch (err) {
    if (err?.message === "VALIDATION_FAILED") {
      return res.status(400).json({ error: "Validation failed", errors: err._errors || [] });
    }
    console.error("jobs import error:", err);
    return res.status(500).json({ error: "Failed to import jobs", details: err.message });
  }
});

/* =====================================================
   IMPORT jobs (Preview)
   POST /api/jobs/import/preview
===================================================== */
router.post("/import/preview", upload.single("file"), async (req, res) => {
  try {
    const companyId = Number(req.body.companyId || req.query.companyId || 1);
    if (!companyId || companyId <= 0) return res.status(400).json({ error: "Invalid companyId" });
    if (!req.file?.buffer) return res.status(400).json({ error: "Missing file" });

    const text = req.file.buffer.toString("utf8").replace(/^\uFEFF/, "");

    const rawRecords = parse(text, {
      bom: true,
      columns: (headers) => headers.map(normalizeHeader),
      skip_empty_lines: true,
      trim: true,
    });

    const indexed = (rawRecords || []).map((row, idx) => ({ row, idx }));
    const records = indexed.filter((x) => rowHasAnyValue(x.row));

    const preview = [];
    let willInsert = 0;
    let willUpdate = 0;
    let errors = 0;

    for (const item of records) {
      const r = item.row;
      const rowNo = item.idx + 2;

      const job_code = asTrimOrNull(r.job_code);
      const job_type = asTrimOrNull(r.job_type);
      const normal_price = asNumberOrNull(r.normal_price);

      if (!job_code || !job_type) {
        errors++;
        preview.push({
          row: rowNo,
          action: "ERROR",
          job_code: job_code || "",
          job_type: job_type || "",
          normal_price: normal_price === "__INVALID__" ? "" : normal_price ?? "",
          error: !job_code ? "job_code required" : "job_type required",
        });
        continue;
      }

      if (normal_price === "__INVALID__") {
        errors++;
        preview.push({
          row: rowNo,
          action: "ERROR",
          job_code,
          job_type,
          normal_price: "",
          error: "normal_price must be a number",
        });
        continue;
      }

      const exists = await db.query(
        `
        SELECT 1
          FROM jobs
         WHERE company_id = $1
           AND lower(job_code) = lower($2)
         LIMIT 1
        `,
        [companyId, job_code]
      );

      const action = exists.rowCount > 0 ? "UPDATE" : "INSERT";
      if (action === "INSERT") willInsert++;
      else willUpdate++;

      preview.push({
        row: rowNo,
        action,
        job_code,
        job_type,
        normal_price: normal_price ?? "",
        error: "",
      });
    }

    return res.json({
      ok: true,
      totals: { total: records.length, willInsert, willUpdate, errors },
      rows: preview,
    });
  } catch (err) {
    console.error("jobs import preview error:", err);
    return res.status(500).json({ error: "Failed to preview import", details: err.message });
  }
});

export default router;
