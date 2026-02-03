// src/routes/workEntryRoutes.js (PostgreSQL)
import { Router } from "express";
import db from "../config/db.js";
import { requirePermission, hasPermission } from "../middleware/permission.js";

const router = Router();

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

async function getDaysLimitForUser(req) {
  const user = req.session?.user;
  const userId = user?.id;
  const isAdmin = Number(user?.is_admin) === 1;

  if (!userId || isAdmin) return null;

  // ✅ Permission override (Option A)
  if (user?.permissions?.includes("VIEW_FULL_HISTORY")) {
    return null;
  }

  const r = await db.query(
    `
    SELECT
      us.work_entries_days_limit_override AS override_limit,
      r.work_entries_days_limit AS role_limit
    FROM users u
    LEFT JOIN user_settings us ON us.user_id = u.id
    LEFT JOIN roles r ON r.id = u.role_id
    WHERE u.id = $1
    `,
    [userId]
  );

  const row = r.rows?.[0];

  const limit =
    row?.override_limit != null
      ? Number(row.override_limit)
      : row?.role_limit != null
      ? Number(row.role_limit)
      : null;

  if (!Number.isFinite(limit) || limit <= 0) return null;
  return limit;
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

function csvEscape(v) {
  if (v == null) return "";
  let s = String(v);
  if (s.includes('"')) s = s.replace(/"/g, '""');
  if (/[",\n\r]/.test(s)) s = `"${s}"`;
  return s;
}

/* =========================
   GET /api/work-entries
   GROUPED: header + child lines
   ========================= */
router.get("/", async (req, res) => {
  const companyId = getCompanyId(req);

  try {
    const daysLimit = await getDaysLimitForUser(req);

    const params = [companyId];
    let dateFilterSql = "";
    if (daysLimit != null) {
      params.push(daysLimit);
      // work_date is DATE in Postgres
      dateFilterSql = ` AND we.work_date >= (CURRENT_DATE - ($2 * INTERVAL '1 day')) `;
    }

    const r = await db.query(
      `
      SELECT
        we.id AS work_entry_id,
        we.company_id,
        we.worker_id,
        wk.worker_code,
        wk.worker_name,
        we.work_date::text AS work_date,
        we.job_no1,
        we.job_no2,
        we.fees_collected,   -- header only
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
      WHERE we.company_id = $1
      ${dateFilterSql}
      ORDER BY we.work_date DESC, we.id DESC, wej.id ASC
      `,
      params
    );

    const rows = r.rows || [];
    const map = new Map();

    for (const row of rows) {
      const workEntryId = row.work_entry_id;

      if (!map.has(workEntryId)) {
        map.set(workEntryId, {
          id: workEntryId,
          company_id: row.company_id,
          worker_id: row.worker_id,
          worker_code: row.worker_code,
          worker_name: row.worker_name,
          work_date: row.work_date,
          job_no1: row.job_no1,
          job_no2: row.job_no2,
          fees_collected: row.fees_collected,
          is_bank: row.is_bank,
          note: row.note,
          created_at: row.created_at,
          jobs: [],
        });
      }

      if (row.line_id) {
        map.get(workEntryId).jobs.push({
          id: row.line_id,
          job_code: row.job_code,
          job_type: row.job_type,
          hours: row.hours,
          customer_rate: row.customer_rate,
          customer_total: row.customer_total,
          wage_rate: row.wage_rate,
          wage_total: row.wage_total,
        });
      }
    }

    return res.json(Array.from(map.values()));
  } catch (err) {
    console.error("GET /api/work-entries error:", err);
    return res.status(500).json({ error: "Database error" });
  }
});

/* =========================
   EXPORT /api/work-entries/export
   CSV export (flat rows)
   ========================= */
router.get("/export", async (req, res) => {
  const companyId = getCompanyId(req);

  try {
    const user = req.session?.user;
    const userId = Number(user?.id);
    const canSeeRates =
      Number(user?.is_admin) === 1 ? true : await hasPermission(userId, "WORK_ENTRY_EDIT_RATES");

    const daysLimit = await getDaysLimitForUser(req);

    const params = [companyId];
    let whereSql = "";

    if (daysLimit != null) {
      params.push(daysLimit);
      whereSql += ` AND we.work_date >= (CURRENT_DATE - ($${params.length} * INTERVAL '1 day')) `;
    }

    const dateFrom = (req.query.dateFrom || "").trim();
    const dateTo = (req.query.dateTo || "").trim();
    const jobNo = (req.query.jobNo || "").trim().toLowerCase();
    const worker = (req.query.worker || "").trim().toLowerCase();
    const job = (req.query.job || "").trim().toLowerCase();
    const note = (req.query.note || "").trim().toLowerCase();

    if (dateFrom) {
      params.push(dateFrom);
      whereSql += ` AND we.work_date >= $${params.length}::date `;
    }
    if (dateTo) {
      params.push(dateTo);
      whereSql += ` AND we.work_date <= $${params.length}::date `;
    }
    if (jobNo) {
      params.push(`%${jobNo}%`);
      whereSql += ` AND (LOWER(COALESCE(we.job_no1,'')) LIKE $${params.length} OR LOWER(COALESCE(we.job_no2,'')) LIKE $${params.length}) `;
    }
    if (worker) {
      params.push(`%${worker}%`);
      whereSql += ` AND (LOWER(COALESCE(wk.worker_code,'')) LIKE $${params.length} OR LOWER(COALESCE(wk.worker_name,'')) LIKE $${params.length}) `;
    }
    if (job) {
      params.push(`%${job}%`);
      whereSql += ` AND (LOWER(COALESCE(j.job_code,'')) LIKE $${params.length} OR LOWER(COALESCE(j.job_type,'')) LIKE $${params.length}) `;
    }
    if (note) {
      params.push(`%${note}%`);
      whereSql += ` AND LOWER(COALESCE(we.note,'')) LIKE $${params.length} `;
    }

    const r = await db.query(
      `
      SELECT
        we.work_date::text AS work_date,
        we.job_no1,
        we.job_no2,
        we.fees_collected,
        we.is_bank,
        we.note,
        wk.worker_code,
        wk.worker_name,
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
      WHERE we.company_id = $1
      ${whereSql}
      ORDER BY we.work_date DESC, we.id DESC, wej.id ASC
      `,
      params
    );

    const rows = r.rows || [];

    const headers = [
      "Work Date",
      "Job No1",
      "Job No2",
      "Worker Code",
      "Worker Name",
      "Job Code",
      "Job Type",
      "Hours",
      "Fees Collected",
      "Pay Type",
    ];

    if (canSeeRates) {
      headers.push("Customer Rate", "Customer Total", "Wage Rate", "Wage Total");
    }

    headers.push("Note");

    const body = rows.map((x) => {
      const base = [
        x.work_date || "",
        x.job_no1 || "",
        x.job_no2 || "",
        x.worker_code || "",
        x.worker_name || "",
        x.job_code || "",
        x.job_type || "",
        x.hours ?? "",
        x.fees_collected ?? "",
        Number(x.is_bank) === 1 ? "Bank" : "Cash",
      ];

      if (canSeeRates) {
        base.push(x.customer_rate ?? "", x.customer_total ?? "", x.wage_rate ?? "", x.wage_total ?? "");
      }

      base.push(x.note || "");

      return base.map(csvEscape).join(",");
    });

    const csv = "\ufeff" + headers.map(csvEscape).join(",") + "\n" + body.join("\n") + "\n";
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="work_entries_export.csv"`);
    return res.send(csv);
  } catch (err) {
    console.error("work-entries export error:", err);
    return res.status(500).send("Failed to export records");
  }
});

/* =========================
   POST /api/work-entries
   ONE header + many jobs
   fees_collected stays ONLY on header (no splitting)
   ========================= */
router.post("/", async (req, res) => {
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

  try {
    const headerId = await db.tx(async (client) => {
      // 1) insert header (job_no1 unique by company)
      let hid;
      try {
        const ins = await client.query(
          `
          INSERT INTO work_entries (
            company_id, worker_id, work_date, job_no1, job_no2,
            fees_collected, is_bank, note
          ) VALUES ($1, $2, $3::date, $4, $5, $6, $7, $8)
          RETURNING id
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
        hid = ins.rows[0].id;
      } catch (e) {
        // unique_violation
        if (e?.code === "23505") {
          // could be job_no1 unique, or something else; message kept generic
          throw Object.assign(new Error("DUP_JOBNO1"), { _kind: "user" });
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
          throw Object.assign(new Error("INVALID_LINE"), { _kind: "user" });
        }

        const jobRow = await client.query(
          `SELECT id FROM jobs WHERE company_id = $1 AND job_code = $2`,
          [finalCompanyId, job_code]
        );

        if (jobRow.rowCount === 0) {
          throw Object.assign(new Error(`INVALID_JOB:${job_code}`), { _kind: "user" });
        }

        try {
          await client.query(
            `
            INSERT INTO work_entry_jobs (
              work_entry_id, job_id, hours,
              customer_rate, customer_total,
              wage_tier_id, wage_rate, wage_total,
              rate, pay
            ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
            `,
            [
              hid,
              jobRow.rows[0].id,
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
          if (e?.code === "23505") {
            // uq_work_entry_jobs_entry_job
            throw Object.assign(new Error(`DUP_JOB_IN_ENTRY:${job_code}`), { _kind: "user" });
          }
          throw e;
        }
      }

      return hid;
    });

    return res.status(201).json({ ok: true, id: headerId });
  } catch (e) {
    if (e?._kind === "user") {
      const msg = String(e.message || "");
      if (msg === "DUP_JOBNO1") {
        return res.status(400).json({ error: "Job No1 already exists for this company." });
      }
      if (msg.startsWith("INVALID_JOB:")) {
        return res.status(400).json({ error: `Invalid job_code: ${msg.split(":")[1]}` });
      }
      if (msg === "INVALID_LINE") {
        return res.status(400).json({ error: "Each job line needs job_code + hours > 0." });
      }
      if (msg.startsWith("DUP_JOB_IN_ENTRY:")) {
        return res.status(400).json({
          error: `Duplicate job in the same entry: ${msg.split(":")[1]}`,
        });
      }
    }

    console.error("POST /api/work-entries error:", e);
    return res.status(500).json({ error: "Database error" });
  }
});

/* =========================
   Month-to-date customer total
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
    const r = await db.query(
      `
      SELECT COALESCE(SUM(wej.customer_total), 0) AS total
      FROM work_entries we
      JOIN work_entry_jobs wej ON wej.work_entry_id = we.id
      WHERE we.company_id = $1
        AND we.worker_id = $2
        AND we.work_date >= $3::date
        AND we.work_date < $4::date
      `,
      [companyId, workerId, start, endStr]
    );

    return res.json({ total: Number(r.rows?.[0]?.total || 0) });
  } catch (e) {
    console.error("GET worker-month-customer-total error:", e);
    return res.status(500).json({ error: "Database error" });
  }
});

/* =========================
   PUT /api/work-entries/:id
   Update ONE job line
   (id = work_entry_jobs.id)
   ========================= */
router.put("/:id", requirePermission("WORK_ENTRY_EDIT"), async (req, res) => {
  const companyId = getCompanyId(req);
  const lineId = Number(req.params.id);

  const {
    worker_id,
    job_code,
    amount, // frontend uses "amount"
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

  if (!lineId) return res.status(400).json({ error: "Invalid line id." });

  try {
    await db.tx(async (client) => {
      // 1) Find line + header
      const found = await client.query(
        `
        SELECT
          wej.id AS line_id,
          wej.work_entry_id,
          we.company_id
        FROM work_entry_jobs wej
        JOIN work_entries we ON we.id = wej.work_entry_id
        WHERE wej.id = $1 AND we.company_id = $2
        `,
        [lineId, companyId]
      );

      if (found.rowCount === 0) {
        throw Object.assign(new Error("NOT_FOUND"), { _kind: "user" });
      }

      const workEntryId = found.rows[0].work_entry_id;

      // 2) Resolve job_id from job_code
      const jobRow = await client.query(
        `SELECT id FROM jobs WHERE company_id = $1 AND job_code = $2`,
        [companyId, job_code]
      );

      if (jobRow.rowCount === 0) {
        throw Object.assign(new Error("BAD_JOB_CODE"), { _kind: "user" });
      }

      const hours = Number(amount);
      if (!Number.isFinite(hours) || hours <= 0) {
        throw Object.assign(new Error("BAD_HOURS"), { _kind: "user" });
      }

      // 3) Update LINE
      try {
        await client.query(
          `
          UPDATE work_entry_jobs
          SET
            job_id = $1,
            hours = $2,
            customer_rate = $3,
            customer_total = $4,
            wage_tier_id = $5,
            wage_rate = $6,
            wage_total = $7,
            rate = $8,
            pay = $9
          WHERE id = $10
          `,
          [
            jobRow.rows[0].id,
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
      } catch (e) {
        if (e?.code === "23505") {
          // uq_work_entry_jobs_entry_job might be hit if job changed to existing job in same entry
          throw Object.assign(new Error("DUP_JOB_IN_ENTRY"), { _kind: "user" });
        }
        throw e;
      }

      // 4) Update HEADER (shared fields)
      // also guard the job_no1 unique (company_id, job_no1)
      try {
        await client.query(
          `
          UPDATE work_entries
          SET
            worker_id = $1,
            work_date = $2::date,
            job_no1 = $3,
            job_no2 = $4,
            note = $5,
            is_bank = $6
          WHERE id = $7
          `,
          [
            worker_id,
            work_date,
            job_no1,
            job_no2 || null,
            note || null,
            Number(is_bank) === 1 ? 1 : 0,
            workEntryId,
          ]
        );
      } catch (e) {
        if (e?.code === "23505") {
          throw Object.assign(new Error("DUP_JOBNO1"), { _kind: "user" });
        }
        throw e;
      }
    });

    return res.json({ ok: true });
  } catch (e) {
    if (e?._kind === "user") {
      if (e.message === "NOT_FOUND") return res.status(404).json({ error: "Record not found." });
      if (e.message === "BAD_JOB_CODE") return res.status(400).json({ error: "Invalid job_code." });
      if (e.message === "BAD_HOURS") return res.status(400).json({ error: "Invalid hours." });
      if (e.message === "DUP_JOB_IN_ENTRY") {
        return res.status(400).json({ error: "Duplicate job in the same entry." });
      }
      if (e.message === "DUP_JOBNO1") {
        return res.status(400).json({ error: "Job No1 already exists for this company." });
      }
    }

    console.error("PUT /api/work-entries/:id error:", e);
    return res.status(500).json({ error: "Database error" });
  }
});

/* =========================
   DELETE a line
   DELETE /api/work-entries/:id
   (id = work_entry_jobs.id)
   ========================= */
router.delete("/:id", requirePermission("WORK_ENTRY_DELETE"), async (req, res) => {
  const companyId = getCompanyId(req);
  const lineId = Number(req.params.id);

  if (!lineId) return res.status(400).json({ error: "Invalid id." });

  try {
    await db.tx(async (client) => {
      const row = await client.query(
        `
        SELECT
          wej.id,
          wej.work_entry_id,
          we.company_id
        FROM work_entry_jobs wej
        JOIN work_entries we ON we.id = wej.work_entry_id
        WHERE wej.id = $1 AND we.company_id = $2
        LIMIT 1
        `,
        [lineId, companyId]
      );

      if (row.rowCount === 0) {
        throw Object.assign(new Error("NOT_FOUND"), { _kind: "user" });
      }

      const workEntryId = row.rows[0].work_entry_id;

      // delete the line
      await client.query(`DELETE FROM work_entry_jobs WHERE id = $1`, [lineId]);

      // if no more lines, delete header
      const left = await client.query(
        `SELECT COUNT(*)::int AS cnt FROM work_entry_jobs WHERE work_entry_id = $1`,
        [workEntryId]
      );

      if (Number(left.rows[0]?.cnt || 0) === 0) {
        await client.query(`DELETE FROM work_entries WHERE id = $1 AND company_id = $2`, [
          workEntryId,
          companyId,
        ]);
      }
    });

    return res.json({ ok: true });
  } catch (e) {
    if (e?._kind === "user" && e.message === "NOT_FOUND") {
      return res.status(404).json({ error: "Not found" });
    }

    console.error("DELETE /api/work-entries/:id error:", e);
    return res.status(500).json({ error: "Database error" });
  }
});



export default router;
