// src/routes/jobRoutes.js
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
    .filter((x) => !Number.isNaN(x.tier_id));
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

// ✅ normalize headers so Excel/BOM/spaces won't break keys
function normalizeHeader(h) {
  return String(h ?? "")
    .replace(/^\uFEFF/, "") // strip BOM if any
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
        console.error("GET /api/jobs error:", err);
        return res.status(500).json({ error: "Database error" });
      }

      const map = new Map();

      (rows || []).forEach((r) => {
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

/* =====================================================
   CREATE job
   POST /api/jobs
===================================================== */
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
    [companyId, job_code, job_type, Number(normal_price || 0), Number(is_active ?? 1)],
    function (err) {
      if (err) return res.status(500).json({ error: err.message });

      const jobId = this.lastID;

      const stmt = db.prepare(`
        INSERT INTO job_wages (company_id, job_id, tier_id, wage_rate)
        VALUES (?, ?, ?, ?)
      `);

      rates.forEach((r) => stmt.run(companyId, jobId, r.tier_id, r.wage_rate));
      stmt.finalize();

      res.status(201).json({ id: jobId });
    }
  );
});

/* =====================================================
   UPDATE job
   PUT /api/jobs/:id
===================================================== */
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
    [job_code, job_type, Number(normal_price || 0), Number(is_active ?? 1), jobId, companyId],
    function (err) {
      if (err) return res.status(500).json({ error: err.message });
      if (!this.changes) return res.status(404).json({ error: "Job not found" });

      const stmt = db.prepare(`
        INSERT INTO job_wages (company_id, job_id, tier_id, wage_rate)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(job_id, tier_id)
        DO UPDATE SET wage_rate = excluded.wage_rate
      `);

      rates.forEach((r) => stmt.run(companyId, jobId, r.tier_id, r.wage_rate));
      stmt.finalize();

      res.json({ message: "Job updated" });
    }
  );
});

/* =====================================================
   DELETE job
   DELETE /api/jobs/:id
===================================================== */
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

    // 🔹 1. Get company name
    const company = await new Promise((resolve, reject) => {
      db.get(
        `SELECT name FROM companies WHERE id = ?`,
        [companyId],
        (err, row) => (err ? reject(err) : resolve(row))
      );
    });

    const companyName = company?.name || `company_${companyId}`;

    // 🔹 sanitize filename (remove slashes, spaces → _)
    const safeCompanyName = companyName
      .replace(/[^\w\d]+/g, "_")
      .replace(/^_+|_+$/g, "");

    // 🔹 2. Get jobs
    const rows = await new Promise((resolve, reject) => {
      db.all(
        `SELECT job_code, job_type, normal_price
         FROM jobs
         WHERE company_id = ?
         ORDER BY job_code ASC`,
        [companyId],
        (err, r) => (err ? reject(err) : resolve(r || []))
      );
    });

    const header = ["job_code", "job_type", "normal_price"].join(",");

    const body = rows
      .map((r) =>
        [
          r.job_code ?? "",
          r.job_type ?? "",
          r.normal_price ?? "",
        ].map(csvEscape).join(",")
      )
      .join("\n");

    // 🔹 3. UTF-8 BOM for Excel
    const csv = "\ufeff" + header + "\n" + body + "\n";

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${safeCompanyName}_jobs.csv"`
    );

    res.send(csv);
  } catch (err) {
    console.error("jobs export error:", err);
    res.status(500).send("Failed to export jobs");
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

    // ✅ IMPORTANT: handle BOM in file content so first header doesn't become \ufeffjob_code
    const text = req.file.buffer.toString("utf8").replace(/^\uFEFF/, "");

    const recordsRaw = parse(text, {
      bom: true, // ✅ extra safety (csv-parse supports it)
      columns: (headers) => headers.map(normalizeHeader),
      skip_empty_lines: true,
      trim: true,
    });

    const records = (recordsRaw || []).filter(rowHasAnyValue);

    const errors = [];
    let inserted = 0;
    let updated = 0;

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

      const existing = await new Promise((resolve, reject) => {
        db.get(
          `SELECT id FROM jobs
           WHERE company_id = ? AND lower(job_code) = lower(?)`,
          [companyId, job_code],
          (err, row) => (err ? reject(err) : resolve(row || null))
        );
      });

      if (!existing) {
        await new Promise((resolve, reject) => {
          db.run(
            `INSERT INTO jobs (company_id, job_code, job_type, normal_price)
             VALUES (?, ?, ?, ?)`,
            [companyId, job_code, job_type, normal_price ?? null],
            (err) => (err ? reject(err) : resolve())
          );
        });
        inserted++;
      } else {
        const fields = [];
        const values = [];

        fields.push("job_type = ?");
        values.push(job_type);

        if (normal_price !== null) {
          fields.push("normal_price = ?");
          values.push(normal_price);
        }

        values.push(existing.id);

        await new Promise((resolve, reject) => {
          db.run(`UPDATE jobs SET ${fields.join(", ")} WHERE id = ?`, values, (err) =>
            err ? reject(err) : resolve()
          );
        });
        updated++;
      }
    }

    if (errors.length) {
      return res.status(400).json({ error: "Validation failed", errors });
    }

    res.json({ ok: true, inserted, updated, total: records.length });
  } catch (err) {
    console.error("jobs import error:", err);
    res.status(500).json({ error: "Failed to import jobs", details: err.message });
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

    // ✅ IMPORTANT: handle BOM
    const text = req.file.buffer.toString("utf8").replace(/^\uFEFF/, "");

    const rawRecords = parse(text, {
      bom: true, // ✅ extra safety
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

      const exists = await new Promise((resolve, reject) => {
        db.get(
          `SELECT id FROM jobs
           WHERE company_id = ? AND lower(job_code)=lower(?)`,
          [companyId, job_code],
          (err, row) => (err ? reject(err) : resolve(!!row))
        );
      });

      const action = exists ? "UPDATE" : "INSERT";
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

    res.json({
      ok: true,
      totals: { total: records.length, willInsert, willUpdate, errors },
      rows: preview,
    });
  } catch (err) {
    console.error("jobs import preview error:", err);
    // ✅ return details so frontend can show real reason if still failing
    res.status(500).json({ error: "Failed to preview import", details: err.message });
  }
});

export default router;
