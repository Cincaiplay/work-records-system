// src/routes/workerRoutes.js (PostgreSQL)
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
  if (req.query?.companyId) return parseInt(req.query.companyId, 10) || 1;
  if (req.body?.companyId != null) return parseInt(req.body.companyId, 10) || 1;
  if (req.body?.company_id != null) return parseInt(req.body.company_id, 10) || 1;
  return 1;
}

function csvEscape(v) {
  const s = String(v ?? "");
  if (s.includes('"') || s.includes(",") || s.includes("\n") || s.includes("\r")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function cleanCell(v) {
  return String(v ?? "").replace(/\u00A0/g, " ").trim();
}

function rowHasAnyValue(obj) {
  if (!obj || typeof obj !== "object") return false;
  return Object.values(obj).some((v) => cleanCell(v) !== "");
}

// ✅ normalize headers so Excel/BOM/spaces won't break keys
function normalizeHeader(h) {
  return String(h ?? "")
    .replace(/^\uFEFF/, "") // remove BOM if present
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_");
}

function asTrimOrNull(v) {
  const s = String(v ?? "").trim();
  return s === "" ? null : s;
}

function parseActive(raw) {
  if (raw === undefined) return null;
  const s = String(raw).trim().toLowerCase();
  if (s === "") return null;
  if (["1", "y", "yes", "true"].includes(s)) return 1;
  if (["0", "n", "no", "false"].includes(s)) return 0;
  return "__INVALID__";
}

/* =====================================================
   GET all workers for a company (+ wage tier name)
   GET /api/workers?companyId=1
===================================================== */

router.get("/", async (req, res) => {
  const companyId = getCompanyId(req);

  try {
    const r = await db.query(
      `
      SELECT w.*,
             wt.tier_name AS wage_tier_name
        FROM workers w
        LEFT JOIN wage_tiers wt
          ON wt.id = w.wage_tier_id
         AND wt.company_id = w.company_id
       WHERE w.company_id = $1
       ORDER BY w.worker_code ASC
      `,
      [companyId]
    );

    return res.json(r.rows || []);
  } catch (err) {
    console.error("GET /api/workers error:", err);
    return res.status(500).json({ error: "Database error" });
  }
});

/* =====================================================
   CREATE worker
   POST /api/workers
===================================================== */

router.post("/", async (req, res) => {
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
    is_active,
  } = req.body;

  if (!worker_code) {
    return res.status(400).json({ error: "worker_code is required." });
  }

  const activeVal = is_active === 0 || is_active === "0" ? 0 : 1;
  const wageTierIdVal =
    wage_tier_id != null && wage_tier_id !== "" ? Number(wage_tier_id) : null;

  try {
    const ins = await db.query(
      `
      INSERT INTO workers (
        company_id, worker_code, worker_name, worker_english_name,
        passport_no, employment_start, nationality, field1,
        wage_tier_id, is_active
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
      RETURNING id
      `,
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
        activeVal,
      ]
    );

    return res.status(201).json({ id: ins.rows[0].id });
  } catch (err) {
    if (err?.code === "23505") {
      return res.status(400).json({ error: "worker_code already exists for this company." });
    }
    console.error("POST /api/workers error:", err);
    return res.status(500).json({ error: "Database error" });
  }
});

/* =====================================================
   UPDATE worker
   PUT /api/workers/:id?companyId=1
===================================================== */

router.put("/:id", async (req, res) => {
  const companyId = getCompanyId(req);
  const workerId = Number(req.params.id);

  const {
    worker_code,
    worker_name,
    worker_english_name,
    passport_no,
    employment_start,
    nationality,
    field1,
    wage_tier_id,
    is_active,
  } = req.body;

  if (!workerId) return res.status(400).json({ error: "Invalid worker id." });
  if (!worker_code) return res.status(400).json({ error: "worker_code is required." });

  const activeVal = is_active === 0 || is_active === "0" ? 0 : 1;
  const wageTierIdVal =
    wage_tier_id != null && wage_tier_id !== "" ? Number(wage_tier_id) : null;

  try {
    const r = await db.query(
      `
      UPDATE workers
         SET worker_code = $1,
             worker_name = $2,
             worker_english_name = $3,
             passport_no = $4,
             employment_start = $5,
             nationality = $6,
             field1 = $7,
             wage_tier_id = $8,
             is_active = $9
       WHERE id = $10
         AND company_id = $11
      `,
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
        workerId,
        companyId,
      ]
    );

    if (r.rowCount === 0) {
      return res.status(404).json({ error: "Worker not found for this company." });
    }

    return res.json({ message: "Worker updated", changes: r.rowCount });
  } catch (err) {
    if (err?.code === "23505") {
      return res.status(400).json({ error: "worker_code already exists for this company." });
    }
    console.error("PUT /api/workers error:", err);
    return res.status(500).json({ error: "Database error" });
  }
});

/* =====================================================
   DELETE worker
   DELETE /api/workers/:id?companyId=1
===================================================== */

router.delete("/:id", async (req, res) => {
  const companyId = getCompanyId(req);
  const workerId = Number(req.params.id);

  if (!workerId) return res.status(400).json({ error: "Invalid worker id." });

  try {
    const r = await db.query(
      `DELETE FROM workers WHERE id = $1 AND company_id = $2`,
      [workerId, companyId]
    );

    if (r.rowCount === 0) {
      return res.status(404).json({ error: "Worker not found for this company." });
    }

    return res.json({ message: "Worker deleted", changes: r.rowCount });
  } catch (err) {
    // if worker referenced by work_entries
    if (err?.code === "23503") {
      return res.status(409).json({ error: "Cannot delete: worker is referenced by work entries." });
    }
    console.error("DELETE /api/workers error:", err);
    return res.status(500).json({ error: "Database error" });
  }
});

/* =====================================================
   EXPORT workers
   GET /api/workers/export?companyId=1
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
      .replace(/[\/\\:*?"<>|]+/g, "_")
      .replace(/\s+/g, "_")
      .replace(/^_+|_+$/g, "");

    const r = await db.query(
      `
      SELECT worker_code, worker_name, worker_english_name, passport_no,
             nationality, employment_start, is_active, wage_tier_id, field1
        FROM workers
       WHERE company_id = $1
       ORDER BY worker_code ASC
      `,
      [companyId]
    );

    const rows = r.rows || [];

    const header = [
      "worker_code",
      "worker_name",
      "worker_english_name",
      "passport_no",
      "nationality",
      "employment_start",
      "is_active",
      "wage_tier_id",
      "field1",
    ].join(",");

    const body = rows
      .map((x) =>
        [
          x.worker_code ?? "",
          x.worker_name ?? "",
          x.worker_english_name ?? "",
          x.passport_no ?? "",
          x.nationality ?? "",
          x.employment_start ?? "",
          x.is_active ?? "",
          x.wage_tier_id ?? "",
          x.field1 ?? "",
        ]
          .map(csvEscape)
          .join(",")
      )
      .join("\n");

    const csv = "\ufeff" + header + "\n" + body + "\n";

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${safeCompanyName}_workers.csv"`
    );
    return res.send(csv);
  } catch (err) {
    console.error("workers export error:", err);
    return res.status(500).send("Failed to export workers");
  }
});

/* =====================================================
   IMPORT workers (Confirm)
   POST /api/workers/import
===================================================== */

router.post("/import", upload.single("file"), async (req, res) => {
  try {
    const companyId = Number(req.body.companyId || req.query.companyId || 1);

    if (!companyId || companyId <= 0) return res.status(400).json({ error: "Invalid companyId" });
    if (!req.file?.buffer) return res.status(400).json({ error: "Missing file" });

    const text = req.file.buffer.toString("utf8").replace(/^\uFEFF/, "");

    const recordsRaw = parse(text, {
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

        const worker_code = asTrimOrNull(r.worker_code);
        const worker_name = asTrimOrNull(r.worker_name);

        const worker_english_name = asTrimOrNull(r.worker_english_name);
        const passport_no = asTrimOrNull(r.passport_no);
        const nationality = asTrimOrNull(r.nationality);
        const employment_start = asTrimOrNull(r.employment_start);
        const field1 = asTrimOrNull(r.field1 ?? r.note);

        const wage_tier_id =
          r.wage_tier_id !== undefined && String(r.wage_tier_id).trim() !== ""
            ? Number(r.wage_tier_id)
            : null;

        const is_active = parseActive(r.is_active);

        if (!worker_code) {
          errors.push({ row: rowNo, field: "worker_code", error: "Required" });
          continue;
        }
        if (!worker_name) {
          errors.push({ row: rowNo, field: "worker_name", error: "Required" });
          continue;
        }
        if (is_active === "__INVALID__") {
          errors.push({ row: rowNo, field: "is_active", error: "Invalid (use 1/0, yes/no)" });
          continue;
        }

        const existing = await client.query(
          `
          SELECT id
            FROM workers
           WHERE company_id = $1
             AND lower(worker_code) = lower($2)
           LIMIT 1
          `,
          [companyId, worker_code]
        );

        if (existing.rowCount === 0) {
          await client.query(
            `
            INSERT INTO workers
              (company_id, worker_code, worker_name, worker_english_name, passport_no,
               employment_start, nationality, field1, is_active, wage_tier_id)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
            `,
            [
              companyId,
              worker_code,
              worker_name,
              worker_english_name,
              passport_no,
              employment_start,
              nationality,
              field1,
              is_active ?? 1,
              wage_tier_id,
            ]
          );
          inserted++;
        } else {
          const id = existing.rows[0].id;

          const sets = [];
          const values = [];
          let p = 1;

          sets.push(`worker_name = $${p++}`); values.push(worker_name);

          if (worker_english_name !== null) { sets.push(`worker_english_name = $${p++}`); values.push(worker_english_name); }
          if (passport_no !== null) { sets.push(`passport_no = $${p++}`); values.push(passport_no); }
          if (employment_start !== null) { sets.push(`employment_start = $${p++}`); values.push(employment_start); }
          if (nationality !== null) { sets.push(`nationality = $${p++}`); values.push(nationality); }
          if (field1 !== null) { sets.push(`field1 = $${p++}`); values.push(field1); }
          if (wage_tier_id !== null) { sets.push(`wage_tier_id = $${p++}`); values.push(wage_tier_id); }
          if (is_active !== null) { sets.push(`is_active = $${p++}`); values.push(is_active); }

          values.push(id);

          await client.query(
            `UPDATE workers SET ${sets.join(", ")} WHERE id = $${p}`,
            values
          );

          updated++;
        }
      }

      // abort the tx if validation failed
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
    console.error("workers import error:", err);
    return res.status(500).json({ error: "Failed to import workers", details: err.message });
  }
});


/* =====================================================
   IMPORT workers (Preview)
   POST /api/workers/import/preview
===================================================== */

router.post("/import/preview", upload.single("file"), async (req, res) => {
  try {
    const companyId = Number(req.body.companyId || req.query.companyId || 1);
    if (!companyId || companyId <= 0) return res.status(400).json({ error: "Invalid companyId" });
    if (!req.file?.buffer) return res.status(400).json({ error: "Missing file" });

    const text = req.file.buffer.toString("utf8").replace(/^\uFEFF/, "");

    const rawRecords = parse(text, {
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

      const worker_code = asTrimOrNull(r.worker_code);
      const worker_name = asTrimOrNull(r.worker_name);

      const worker_english_name = asTrimOrNull(r.worker_english_name);
      const passport_no = asTrimOrNull(r.passport_no);
      const nationality = asTrimOrNull(r.nationality);
      const employment_start = asTrimOrNull(r.employment_start);
      const field1 = asTrimOrNull(r.field1 ?? r.note);

      const wage_tier_id =
        r.wage_tier_id !== undefined && String(r.wage_tier_id).trim() !== ""
          ? Number(r.wage_tier_id)
          : null;

      const is_active = parseActive(r.is_active);

      if (!worker_code || !worker_name) {
        errors++;
        preview.push({
          row: rowNo,
          action: "ERROR",
          worker_code: worker_code || "",
          worker_name: worker_name || "",
          worker_english_name: worker_english_name || "",
          passport_no: passport_no || "",
          nationality: nationality || "",
          employment_start: employment_start || "",
          is_active: is_active === "__INVALID__" ? "" : (is_active ?? ""),
          wage_tier_id,
          field1: field1 || "",
          error: !worker_code ? "worker_code required" : "worker_name required",
        });
        continue;
      }

      if (is_active === "__INVALID__") {
        errors++;
        preview.push({
          row: rowNo,
          action: "ERROR",
          worker_code,
          worker_name,
          worker_english_name: worker_english_name || "",
          passport_no: passport_no || "",
          nationality: nationality || "",
          employment_start: employment_start || "",
          is_active: "",
          wage_tier_id,
          field1: field1 || "",
          error: "is_active invalid (use 1/0, yes/no)",
        });
        continue;
      }

      const exists = await db.query(
        `
        SELECT 1
          FROM workers
         WHERE company_id = $1
           AND lower(worker_code) = lower($2)
         LIMIT 1
        `,
        [companyId, worker_code]
      );

      const action = exists.rowCount > 0 ? "UPDATE" : "INSERT";
      if (action === "INSERT") willInsert++;
      else willUpdate++;

      preview.push({
        row: rowNo,
        action,
        worker_code,
        worker_name,
        worker_english_name: worker_english_name || "",
        passport_no: passport_no || "",
        nationality: nationality || "",
        employment_start: employment_start || "",
        is_active: is_active ?? "",
        wage_tier_id,
        field1: field1 || "",
        error: "",
      });
    }

    return res.json({
      ok: true,
      totals: { total: records.length, willInsert, willUpdate, errors },
      rows: preview,
    });
  } catch (err) {
    console.error("workers import preview error:", err);
    return res.status(500).json({ error: "Failed to preview import" });
  }
});

/* =====================================================
   CSV Template
   GET /api/workers/template.csv
===================================================== */

router.get("/template.csv", (req, res) => {
  const header =
    "worker_code,worker_name,worker_english_name,passport_no,nationality,employment_start,is_active,wage_tier_id,field1";

  const sample1 = "W001,张三,Zhang San,A11513,China,,1,1,";
  const sample2 = "W002,李四,Li Si,E15613,China,,1,,";
  const sample3 = "W003,Alice,Ali,K156123,Indo,,1,,";

  const csv = "\ufeff" + [header, sample1, sample2, sample3].join("\n") + "\n";

  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="workers_template.csv"`);
  res.send(csv);
});

export default router;
