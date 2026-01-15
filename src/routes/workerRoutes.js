// src/routes/workerRoutes.js
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

/* =====================================================
   CREATE worker
   POST /api/workers
===================================================== */

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
    is_active,
  } = req.body;

  if (!worker_code) {
    return res.status(400).json({ error: "worker_code is required." });
  }

  const activeVal = is_active === 0 || is_active === "0" ? 0 : 1;
  const wageTierIdVal =
    wage_tier_id != null && wage_tier_id !== "" ? Number(wage_tier_id) : null;

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
      activeVal,
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

/* =====================================================
   UPDATE worker
   PUT /api/workers/:id?companyId=1
===================================================== */

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
    is_active,
  } = req.body;

  if (!worker_code) {
    return res.status(400).json({ error: "worker_code is required." });
  }

  const activeVal = is_active === 0 || is_active === "0" ? 0 : 1;
  const wageTierIdVal =
    wage_tier_id != null && wage_tier_id !== "" ? Number(wage_tier_id) : null;

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
      companyId,
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

/* =====================================================
   DELETE worker
   DELETE /api/workers/:id?companyId=1
===================================================== */

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

    // 1) Get company name for filename
    const company = await new Promise((resolve, reject) => {
      db.get(
        `SELECT name FROM companies WHERE id = ?`,
        [companyId],
        (err, row) => (err ? reject(err) : resolve(row))
      );
    });

    const companyName = company?.name || `company_${companyId}`;

    // sanitize filename: keep letters/numbers/_ and also keep CJK chars
    // (remove characters that break filenames like / \ : * ? " < > |)
    const safeCompanyName = String(companyName)
      .replace(/[\/\\:*?"<>|]+/g, "_")
      .replace(/\s+/g, "_")
      .replace(/^_+|_+$/g, "");

    // 2) Query workers (include Chinese name field worker_name)
    const rows = await new Promise((resolve, reject) => {
      db.all(
        `SELECT worker_code, worker_name, worker_english_name, passport_no,
                nationality, employment_start, is_active, wage_tier_id, field1
           FROM workers
          WHERE company_id = ?
          ORDER BY worker_code ASC`,
        [companyId],
        (err, r) => (err ? reject(err) : resolve(r || []))
      );
    });

    // 3) Build CSV
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
      .map((r) =>
        [
          r.worker_code ?? "",
          r.worker_name ?? "", // ✅ Chinese name lives here
          r.worker_english_name ?? "",
          r.passport_no ?? "",
          r.nationality ?? "",
          r.employment_start ?? "",
          r.is_active ?? "",
          r.wage_tier_id ?? "",
          r.field1 ?? "",
        ]
          .map(csvEscape)
          .join(",")
      )
      .join("\n");

    // ✅ BOM makes Excel recognize UTF-8 (Chinese)
    const csv = "\ufeff" + header + "\n" + body + "\n";

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${safeCompanyName}_workers.csv"`
    );
    res.send(csv);
  } catch (err) {
    console.error("workers export error:", err);
    res.status(500).send("Failed to export workers");
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

    const text = req.file.buffer.toString("utf8");

    // ✅ normalize headers so BOM/spaces won't break worker_code
    const recordsRaw = parse(text, {
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

      // ✅ keys are normalized to snake_case lower
      const worker_code = asTrimOrNull(r.worker_code);
      const worker_name = asTrimOrNull(r.worker_name);

      const worker_english_name = asTrimOrNull(r.worker_english_name);
      const passport_no = asTrimOrNull(r.passport_no);
      const nationality = asTrimOrNull(r.nationality);
      const employment_start = asTrimOrNull(r.employment_start);

      // accept "note" too (template or user)
      const field1 = asTrimOrNull(r.field1 ?? r.note);

      const wage_tier_id =
        r.wage_tier_id !== undefined && String(r.wage_tier_id).trim() !== ""
          ? Number(r.wage_tier_id)
          : null;

      const is_active = parseActive(r.is_active);

      // REQUIRED
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

      const existing = await new Promise((resolve, reject) => {
        db.get(
          `SELECT id FROM workers
           WHERE company_id = ? AND lower(worker_code) = lower(?)`,
          [companyId, worker_code],
          (err, row) => (err ? reject(err) : resolve(row || null))
        );
      });

      if (!existing) {
        await new Promise((resolve, reject) => {
          db.run(
            `INSERT INTO workers
             (company_id, worker_code, worker_name, worker_english_name, passport_no,
              employment_start, nationality, field1, is_active, wage_tier_id)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
            ],
            (err) => (err ? reject(err) : resolve())
          );
        });
        inserted++;
      } else {
        const fields = [];
        const values = [];

        // always update required name
        fields.push("worker_name = ?");
        values.push(worker_name);

        if (worker_english_name !== null) { fields.push("worker_english_name = ?"); values.push(worker_english_name); }
        if (passport_no !== null) { fields.push("passport_no = ?"); values.push(passport_no); }
        if (employment_start !== null) { fields.push("employment_start = ?"); values.push(employment_start); }
        if (nationality !== null) { fields.push("nationality = ?"); values.push(nationality); }
        if (field1 !== null) { fields.push("field1 = ?"); values.push(field1); }
        if (wage_tier_id !== null) { fields.push("wage_tier_id = ?"); values.push(wage_tier_id); }
        if (is_active !== null) { fields.push("is_active = ?"); values.push(is_active); }

        values.push(existing.id);

        await new Promise((resolve, reject) => {
          db.run(
            `UPDATE workers SET ${fields.join(", ")} WHERE id = ?`,
            values,
            (err) => (err ? reject(err) : resolve())
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
    console.error("workers import error:", err);
    res.status(500).json({ error: "Failed to import workers", details: err.message });
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

    const text = req.file.buffer.toString("utf8");

    // ✅ normalize headers so BOM/spaces won't break worker_code
    const rawRecords = parse(text, {
      columns: (headers) => headers.map(normalizeHeader),
      skip_empty_lines: true,
      trim: true,
    });

    // keep original CSV row numbers
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

      const exists = await new Promise((resolve, reject) => {
        db.get(
          `SELECT id FROM workers
           WHERE company_id = ? AND lower(worker_code)=lower(?)`,
          [companyId, worker_code],
          (err, row) => (err ? reject(err) : resolve(!!row))
        );
      });

      const action = exists ? "UPDATE" : "INSERT";
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

    res.json({
      ok: true,
      totals: { total: records.length, willInsert, willUpdate, errors },
      rows: preview,
    });
  } catch (err) {
    console.error("workers import preview error:", err);
    res.status(500).json({ error: "Failed to preview import" });
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

  // ✅ BOM so Excel opens UTF-8 correctly
  const csv = "\ufeff" + [header, sample1, sample2, sample3].join("\n") + "\n";

  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="workers_template.csv"`);
  res.send(csv);
});

export default router;
