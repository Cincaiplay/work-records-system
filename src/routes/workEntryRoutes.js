// src/routes/workEntriesRoutes.js
import { Router } from "express";
import db from "../config/db.js";
import { requirePermission } from "../middleware/permission.js";

const router = Router();

/* =========================
   SQLite helpers (Promise)
   ========================= */
const run = (sql, params = []) =>
  new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) return reject(err);
      resolve(this);
    });
  });

const get = (sql, params = []) =>
  new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) return reject(err);
      resolve(row);
    });
  });

const all = (sql, params = []) =>
  new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) return reject(err);
      resolve(rows);
    });
  });

const exec = (sql) =>
  new Promise((resolve, reject) => {
    db.exec(sql, (err) => {
      if (err) return reject(err);
      resolve();
    });
  });

/* =========================
   Write queue (IMPORTANT)
   Prevents "BEGIN within BEGIN"
   ========================= */
let writeChain = Promise.resolve();
function enqueueWrite(fn) {
  const next = writeChain.then(fn);
  writeChain = next.catch(() => {}); // keep chain alive
  return next;
}

/* =========================
   Company helpers
   ========================= */
function getCompanyId(req) {
  if (req.query?.companyId) return parseInt(req.query.companyId, 10);
  if (req.body?.company_id) return parseInt(req.body.company_id, 10);

  const sess = req.session || {};
  if (sess.activeCompanyId) return Number(sess.activeCompanyId);

  const userCompanyId = sess.user?.company_id;
  if (userCompanyId) return Number(userCompanyId);

  return 1;
}

function getDaysLimitForUser(req, cb) {
  const userId = req.session?.user?.id;
  const isAdmin = Number(req.session?.user?.is_admin) === 1;
  if (!userId || isAdmin) return cb(null, null);

  db.get(
    `
    SELECT
      us.work_entries_days_limit_override AS override_limit,
      r.work_entries_days_limit AS role_limit
    FROM users u
    LEFT JOIN user_settings us ON us.user_id = u.id
    LEFT JOIN roles r ON r.id = u.role_id
    WHERE u.id = ?
    `,
    [userId],
    (err, row) => {
      if (err) return cb(err);

      const limit =
        row?.override_limit != null
          ? Number(row.override_limit)
          : row?.role_limit != null
          ? Number(row.role_limit)
          : null;

      if (!Number.isFinite(limit) || limit <= 0) return cb(null, null);
      cb(null, limit);
    }
  );
}

/* =========================
   Small utils
   ========================= */
const norm = (v) => String(v ?? "").trim();
const toNum = (v) => {
  if (v === "" || v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/* =========================
   GET /api/work-entries
   GROUPED: header + child lines
   ========================= */
router.get("/", (req, res) => {
  const companyId = getCompanyId(req);

  getDaysLimitForUser(req, (err, daysLimit) => {
    if (err) return res.status(500).json({ error: "Database error" });

    let dateFilterSql = "";
    const params = [companyId];

    if (daysLimit != null) {
      dateFilterSql = ` AND we.work_date >= date('now', ?) `;
      params.push(`-${daysLimit} days`);
    }

    db.all(
      `
      SELECT
        we.id AS work_entry_id,
        we.company_id,
        we.worker_id,
        wk.worker_code,
        wk.worker_name,
        we.work_date,
        we.job_no1,
        we.job_no2,
        we.fees_collected,   -- ✅ header only
        we.is_bank,
        we.note,
        we.created_at,

        wej.id AS line_id,
        j.job_code,
        j.job_type,
        wej.hours,
        wej.customer_rate,
        wej.customer_total,
        wej.wage_rate,
        wej.wage_total
      FROM work_entries we
      LEFT JOIN workers wk
        ON wk.id = we.worker_id AND wk.company_id = we.company_id
      LEFT JOIN work_entry_jobs wej
        ON wej.work_entry_id = we.id
      LEFT JOIN jobs j
        ON j.id = wej.job_id
      WHERE we.company_id = ?
      ${dateFilterSql}
      ORDER BY we.work_date DESC, we.id DESC, wej.id ASC
      `,
      params,
      (qErr, rows) => {
        if (qErr) {
          console.error("GET /api/work-entries error:", qErr.message);
          return res.status(500).json({ error: "Database error" });
        }

        const map = new Map();

        for (const r of rows || []) {
          if (!map.has(r.work_entry_id)) {
            map.set(r.work_entry_id, {
              id: r.work_entry_id,
              company_id: r.company_id,
              worker_id: r.worker_id,
              worker_code: r.worker_code,
              worker_name: r.worker_name,
              work_date: r.work_date,
              job_no1: r.job_no1,
              job_no2: r.job_no2,
              fees_collected: r.fees_collected, // ✅ header only
              is_bank: r.is_bank,
              note: r.note,
              created_at: r.created_at,
              jobs: [],
            });
          }

          if (r.line_id) {
            map.get(r.work_entry_id).jobs.push({
              id: r.line_id,
              job_code: r.job_code,
              job_type: r.job_type,
              hours: r.hours,
              customer_rate: r.customer_rate,
              customer_total: r.customer_total,
              wage_rate: r.wage_rate,
              wage_total: r.wage_total,
            });
          }
        }

        res.json(Array.from(map.values()));
      }
    );
  });
});

/* =========================
   POST /api/work-entries
   ONE header + many jobs
   fees_collected stays ONLY on header (no splitting)
   ========================= */
router.post("/", (req, res) => {
  const companyId = getCompanyId(req);
  const finalCompanyId = Number(req.body.company_id || companyId || 1);

  const worker_id = toNum(req.body.worker_id);
  const work_date = norm(req.body.work_date);
  const job_no1 = norm(req.body.job_no1);
  const job_no2 = norm(req.body.job_no2) || null;

  const fees_collected = toNum(req.body.fees_collected) ?? 0;
  const is_bank = Number(req.body.is_bank) === 1 ? 1 : 0;
  const note = norm(req.body.note) || null;

  const jobs = req.body.jobs;

  if (!finalCompanyId || !worker_id || !work_date || !job_no1) {
    return res.status(400).json({ error: "Missing required header fields." });
  }
  if (!Array.isArray(jobs) || jobs.length < 1) {
    return res.status(400).json({ error: "jobs[] is required." });
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(work_date)) {
    return res.status(400).json({ error: "work_date must be YYYY-MM-DD." });
  }
  if (fees_collected < 0) {
    return res.status(400).json({ error: "fees_collected cannot be negative." });
  }

  enqueueWrite(async () => {
    try {
      await exec("BEGIN IMMEDIATE;");

      // 1) insert header (job_no1 unique by company)
      let headerId;
      try {
        const ins = await run(
          `
          INSERT INTO work_entries (
            company_id, worker_id, work_date, job_no1, job_no2,
            fees_collected, is_bank, note
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          `,
          [
            finalCompanyId,
            worker_id,
            work_date,
            job_no1,
            job_no2,
            fees_collected,
            is_bank,
            note,
          ]
        );
        headerId = ins.lastID;
      } catch (e) {
        const msg = String(e.message || "");
        if (msg.includes("UNIQUE constraint failed: work_entries.company_id, work_entries.job_no1")) {
          await exec("ROLLBACK;");
          return res.status(400).json({ error: "Job No1 already exists for this company." });
        }
        throw e;
      }

      // 2) insert lines
      for (const line of jobs) {
        const job_code = norm(line?.job_code);
        const hours = toNum(line?.hours);
        const customer_rate = toNum(line?.customer_rate) ?? 0;
        const customer_total = toNum(line?.customer_total) ?? 0;
        const wage_tier_id = toNum(line?.wage_tier_id);
        const wage_rate = toNum(line?.wage_rate) ?? 0;
        const wage_total = toNum(line?.wage_total) ?? 0;
        const rate = toNum(line?.rate);
        const pay = toNum(line?.pay);

        if (!job_code || !hours || hours <= 0) {
          await exec("ROLLBACK;");
          return res.status(400).json({ error: "Each job line needs job_code + hours > 0." });
        }

        const jobRow = await get(
          `SELECT id FROM jobs WHERE company_id = ? AND job_code = ?`,
          [finalCompanyId, job_code]
        );
        if (!jobRow) {
          await exec("ROLLBACK;");
          return res.status(400).json({ error: `Invalid job_code: ${job_code}` });
        }

        try {
          await run(
            `
            INSERT INTO work_entry_jobs (
              work_entry_id, job_id, hours,
              customer_rate, customer_total,
              wage_tier_id, wage_rate, wage_total,
              rate, pay
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `,
            [
              headerId,
              jobRow.id,
              hours,
              customer_rate,
              customer_total,
              wage_tier_id ?? null,
              wage_rate,
              wage_total,
              rate ?? wage_rate ?? 0,
              pay ?? wage_total ?? 0,
            ]
          );
        } catch (e) {
          const msg = String(e.message || "");
          // UNIQUE(work_entry_id, job_id) => no duplicate same job in one entry
          if (msg.includes("UNIQUE constraint failed: work_entry_jobs.work_entry_id, work_entry_jobs.job_id")) {
            await exec("ROLLBACK;");
            return res.status(400).json({
              error: `Duplicate job in the same entry: ${job_code}`,
            });
          }
          throw e;
        }
      }

      await exec("COMMIT;");
      return res.status(201).json({ ok: true, id: headerId });
    } catch (e) {
      console.error("POST /api/work-entries error:", e);
      try {
        await exec("ROLLBACK;");
      } catch {}
      return res.status(500).json({ error: "Database error" });
    }
  });
});

/* =========================
   PUT /api/work-entries/:id
   Update ONE job line
   (id = work_entry_jobs.id)
   ========================= */
router.put("/:id", requirePermission("WORK_ENTRY_EDIT"), (req, res) => {
  const companyId = getCompanyId(req);
  const lineId = Number(req.params.id);

  const {
    worker_id,
    job_code,
    amount,           // frontend uses "amount"
    customer_rate,
    customer_total,
    wage_tier_id,
    wage_rate,
    wage_total,
    job_no1,
    job_no2,
    work_date,
    note,
    is_bank,
  } = req.body;

  if (!lineId) {
    return res.status(400).json({ error: "Invalid line id." });
  }

  enqueueWrite(async () => {
    try {
      await exec("BEGIN IMMEDIATE;");

      // 1️⃣ Find line + header
      const row = await get(
        `
        SELECT
          wej.id AS line_id,
          wej.work_entry_id,
          we.company_id
        FROM work_entry_jobs wej
        JOIN work_entries we ON we.id = wej.work_entry_id
        WHERE wej.id = ? AND we.company_id = ?
        `,
        [lineId, companyId]
      );

      if (!row) {
        await exec("ROLLBACK;");
        return res.status(404).json({ error: "Record not found." });
      }

      // 2️⃣ Resolve job_id from job_code
      const jobRow = await get(
        `SELECT id FROM jobs WHERE company_id = ? AND job_code = ?`,
        [companyId, job_code]
      );

      if (!jobRow) {
        await exec("ROLLBACK;");
        return res.status(400).json({ error: "Invalid job_code." });
      }

      const hours = Number(amount);
      if (!Number.isFinite(hours) || hours <= 0) {
        await exec("ROLLBACK;");
        return res.status(400).json({ error: "Invalid hours." });
      }

      // 3️⃣ Update LINE
      await run(
        `
        UPDATE work_entry_jobs
        SET
          job_id = ?,
          hours = ?,
          customer_rate = ?,
          customer_total = ?,
          wage_tier_id = ?,
          wage_rate = ?,
          wage_total = ?,
          rate = ?,
          pay = ?
        WHERE id = ?
        `,
        [
          jobRow.id,
          hours,
          customer_rate ?? 0,
          customer_total ?? 0,
          wage_tier_id ?? null,
          wage_rate ?? 0,
          wage_total ?? 0,
          wage_rate ?? 0,
          wage_total ?? 0,
          lineId,
        ]
      );

      // 4️⃣ Update HEADER (shared fields)
      await run(
        `
        UPDATE work_entries
        SET
          worker_id = ?,
          work_date = ?,
          job_no1 = ?,
          job_no2 = ?,
          note = ?,
          is_bank = ?
        WHERE id = ?
        `,
        [
          worker_id,
          work_date,
          job_no1,
          job_no2 || null,
          note || null,
          Number(is_bank) === 1 ? 1 : 0,
          row.work_entry_id,
        ]
      );

      await exec("COMMIT;");
      return res.json({ ok: true });
    } catch (e) {
      console.error("PUT /api/work-entries/:id error:", e);
      try {
        await exec("ROLLBACK;");
      } catch {}
      return res.status(500).json({ error: "Database error" });
    }
  });
});

/* =========================
   DELETE a line
   DELETE /api/work-entries/:id
   (id = work_entry_jobs.id)
   ✅ IMPORTANT: DO NOT touch fees_collected on header
   ========================= */
router.delete("/:id", requirePermission("WORK_ENTRY_DELETE"), (req, res) => {
  const companyId = getCompanyId(req);
  const lineId = Number(req.params.id);

  if (!lineId) return res.status(400).json({ error: "Invalid id." });

  enqueueWrite(async () => {
    try {
      await exec("BEGIN IMMEDIATE;");

      // find line + header
      const row = await get(
        `
        SELECT
          wej.id,
          wej.work_entry_id,
          we.company_id
        FROM work_entry_jobs wej
        JOIN work_entries we ON we.id = wej.work_entry_id
        WHERE wej.id = ? AND we.company_id = ?
        LIMIT 1
        `,
        [lineId, companyId]
      );

      if (!row) {
        await exec("ROLLBACK;");
        return res.status(404).json({ error: "Not found" });
      }

      // delete the line
      await run(`DELETE FROM work_entry_jobs WHERE id = ?`, [lineId]);

      // if no more lines, delete header (still keeps job_no1 uniqueness behavior)
      const left = await get(
        `SELECT COUNT(*) AS cnt FROM work_entry_jobs WHERE work_entry_id = ?`,
        [row.work_entry_id]
      );

      if (Number(left?.cnt || 0) === 0) {
        await run(`DELETE FROM work_entries WHERE id = ? AND company_id = ?`, [
          row.work_entry_id,
          companyId,
        ]);
      }

      await exec("COMMIT;");
      return res.json({ ok: true });
    } catch (e) {
      console.error("DELETE /api/work-entries/:id error:", e);
      try {
        await exec("ROLLBACK;");
      } catch {}
      return res.status(500).json({ error: "Database error" });
    }
  });
});

/* =========================
   Month-to-date customer total
   (sum of line customer_total)
   GET /api/work-entries/worker-month-customer-total?companyId=1&workerId=2&month=YYYY-MM
   ========================= */
router.get("/worker-month-customer-total", async (req, res) => {
  const companyId = parseInt(req.query.companyId, 10) || 1;
  const workerId = parseInt(req.query.workerId, 10);
  const month = (req.query.month || "").trim();

  if (!workerId || !month || !/^\d{4}-\d{2}$/.test(month)) {
    return res.status(400).json({
      error: "companyId, workerId, and month(YYYY-MM) are required.",
    });
  }

  const start = `${month}-01`;
  const end = new Date(`${month}-01T00:00:00`);
  end.setMonth(end.getMonth() + 1);
  const endStr = end.toISOString().slice(0, 10);

  try {
    const row = await get(
      `
      SELECT COALESCE(SUM(wej.customer_total), 0) AS total
      FROM work_entries we
      JOIN work_entry_jobs wej ON wej.work_entry_id = we.id
      WHERE we.company_id = ?
        AND we.worker_id = ?
        AND we.work_date >= ?
        AND we.work_date < ?
      `,
      [companyId, workerId, start, endStr]
    );

    res.json({ total: Number(row?.total || 0) });
  } catch (e) {
    console.error("GET worker-month-customer-total error:", e);
    res.status(500).json({ error: "Database error" });
  }
});

export default router;
