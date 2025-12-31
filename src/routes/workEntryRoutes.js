import { Router } from "express";
import db from "../config/db.js";
import { requirePermission } from "../middleware/permission.js"; 

const router = Router();

/**
 * Prefer:
 * - query.companyId (frontend passes it)
 * - body.company_id
 * - session.activeCompanyId (admin switcher)
 * - user's company_id
 * - fallback 1 (only as last resort)
 */
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

  if (!userId || isAdmin) return cb(null, null); // unlimited

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

function hasPermission(req, code, cb) {
  const user = req.session?.user;
  if (!user?.id) return cb(null, false);

  if (Number(user.is_admin) === 1) return cb(null, true);

  db.get(
    `
    SELECT 1 AS ok
      FROM users u
      JOIN roles r ON r.id = u.role_id
      JOIN role_permissions rp ON rp.role_id = r.id
      JOIN permissions p ON p.id = rp.permission_id
     WHERE u.id = ?
       AND p.code = ?
       AND p.is_active = 1
     LIMIT 1
    `,
    [user.id, code],
    (err, row) => {
      if (err) return cb(err);
      cb(null, !!row);
    }
  );
}


/**
 * Helper: check if a record is editable/deletable by daysLimit.
 * If daysLimit = null => allowed
 */
function ensureRowWithinLimit({ id, companyId, daysLimit }, cb) {
  const dateClause = daysLimit != null ? `AND we.work_date >= date('now', ?)` : "";
  const params = daysLimit != null ? [id, companyId, `-${daysLimit} days`] : [id, companyId];

  db.get(
    `SELECT we.id FROM work_entries we WHERE we.id = ? AND we.company_id = ? ${dateClause} LIMIT 1`,
    params,
    (err, row) => {
      if (err) return cb(err);
      cb(null, !!row);
    }
  );
}

/* ===========================
   GET all work entries
   GET /api/work-entries?companyId=1
   =========================== */
router.get("/", (req, res) => {
  const companyId = getCompanyId(req);

  getDaysLimitForUser(req, (err, daysLimit) => {
    if (err) {
      console.error("getDaysLimitForUser error:", err.message);
      return res.status(500).json({ error: "Database error" });
    }

    let dateFilterSql = "";
    const params = [companyId];

    if (daysLimit != null) {
      dateFilterSql = ` AND we.work_date >= date('now', ?) `;
      params.push(`-${daysLimit} days`);
    }

    db.all(
      `
      SELECT
        we.id,
        we.company_id,

        we.worker_id,
        wk.worker_code,
        wk.worker_name,

        we.job_id,
        j.job_code,
        j.job_type,

        we.amount,
        we.is_bank,

        we.customer_rate,
        we.customer_total,

        we.wage_tier_id,
        wt.tier_name AS wage_tier_name,
        we.wage_rate,
        we.wage_total,

        we.job_no1,
        we.job_no2,
        we.work_date,
        we.note,
        we.fees_collected,
        we.created_at
      FROM work_entries we
      LEFT JOIN workers wk
        ON wk.id = we.worker_id AND wk.company_id = we.company_id
      LEFT JOIN jobs j
        ON j.id = we.job_id AND j.company_id = we.company_id
      LEFT JOIN wage_tiers wt
        ON wt.id = we.wage_tier_id AND wt.company_id = we.company_id
      WHERE we.company_id = ?
      ${dateFilterSql}
      ORDER BY we.work_date DESC, we.id DESC
      `,
      params,
      (qErr, rows) => {
        if (qErr) {
          console.error("GET /api/work-entries error:", qErr.message);
          return res.status(500).json({ error: "Database error" });
        }
        res.json(rows || []);
      }
    );
  });
});

/* ===========================
   CREATE work entry
   POST /api/work-entries
   =========================== */
router.post("/", (req, res) => {
  const companyId = getCompanyId(req);

  const {
    company_id,
    worker_id,
    job_code,
    amount,
    is_bank,

    customer_rate,
    customer_total,

    wage_tier_id,
    wage_rate,
    wage_total,

    // legacy (optional)
    rate,
    pay,

    job_no1,
    job_no2,
    work_date,

    // ✅ new
    fees_collected,

    note
  } = req.body;

  const finalCompanyId = Number(company_id || companyId || 1);

  // required checks
  if (!finalCompanyId || !worker_id || !job_code || !amount || !job_no1 || !work_date) {
    return res.status(400).json({ error: "Missing required fields." });
  }

  if (customer_rate == null || customer_total == null || wage_rate == null || wage_total == null) {
    return res.status(400).json({
      error: "customer_rate/customer_total/wage_rate/wage_total are required."
    });
  }

  // ---- normalize numbers safely ----
  const n = (v) => {
    if (v === "" || v == null) return null;
    const x = Number(v);
    return Number.isFinite(x) ? x : null;
  };

  const amountNum = n(amount);
  const customerRateNum = n(customer_rate);
  const customerTotalNum = n(customer_total);
  const wageRateNum = n(wage_rate);
  const wageTotalNum = n(wage_total);

  if (amountNum == null || customerRateNum == null || customerTotalNum == null || wageRateNum == null || wageTotalNum == null) {
    return res.status(400).json({ error: "Invalid numeric value in amount/rates/totals." });
  }

  // ✅ Fees Collected:
  // - if user provides it: use it
  // - else default to customer_total (recommended)
  const feesCollectedNum = n(fees_collected);
  const finalFeesCollected = feesCollectedNum == null ? customerTotalNum : feesCollectedNum;

  // resolve job_id
  db.get(
    `SELECT id FROM jobs WHERE company_id = ? AND job_code = ?`,
    [finalCompanyId, String(job_code).trim()],
    (err, jobRow) => {
      if (err) {
        console.error("Resolve job_id error:", err.message);
        return res.status(500).json({ error: "Database error" });
      }
      if (!jobRow) {
        return res.status(400).json({ error: `Invalid job_code: ${job_code}` });
      }

      const jobId = jobRow.id;

      db.run(
        `INSERT INTO work_entries (
           company_id, worker_id, job_id, amount,
           is_bank,
           customer_rate, customer_total,
           wage_tier_id, wage_rate, wage_total,
           rate, pay,
           job_no1, job_no2, work_date,
           note, fees_collected
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          finalCompanyId,
          Number(worker_id),
          jobId,
          amountNum,

          Number(is_bank) === 1 ? 1 : 0,

          customerRateNum,
          customerTotalNum,

          wage_tier_id != null && wage_tier_id !== "" ? Number(wage_tier_id) : null,
          wageRateNum,
          wageTotalNum,

          n(rate) ?? wageRateNum ?? 0,
          n(pay) ?? wageTotalNum ?? 0,

          String(job_no1).trim(),
          (job_no2 || "").trim() || null,
          work_date,

          (note || "").trim() || null,
          finalFeesCollected
        ],
        function (insertErr) {
          if (insertErr) {
            if (insertErr.message.includes("UNIQUE constraint failed: work_entries.company_id, work_entries.job_no1")) {
              return res.status(400).json({ error: "Job No1 already exists for this company." });
            }
            console.error("INSERT work_entries error:", insertErr.message);
            return res.status(500).json({ error: "Database error" });
          }

          // return the inserted id + collected so UI can update immediately
          res.status(201).json({ id: this.lastID, fees_collected: finalFeesCollected });
        }
      );
    }
  );
});


/* ===========================
   UPDATE work entry (protected by daysLimit)
   PUT /api/work-entries/:id?companyId=1
   =========================== */
router.put("/:id", requirePermission("WORK_ENTRY_EDIT"), (req, res) => {
  const companyId = getCompanyId(req);
  const id = Number(req.params.id);

  const user = req.session?.user;
  const userId = Number(user?.id);

  const {
    worker_id,
    job_code,
    amount,
    is_bank,
    customer_rate,
    wage_tier_id,
    wage_rate,
    job_no1,
    job_no2,
    work_date,
    note,
    fees_collected
  } = req.body;

  if (!id || !companyId) return res.status(400).json({ error: "Invalid id/company." });

  if (!worker_id) {
    return res.status(400).json({ error: "worker_id is required." });
  }

  // required fields
  if (!job_code || amount == null || !job_no1 || !work_date) {
    return res.status(400).json({ error: "Missing required fields." });
  }

  const hrs = Number(amount);
  if (!Number.isFinite(hrs) || hrs <= 0) {
    return res.status(400).json({ error: "Invalid amount (hours)." });
  }

  // normalize optional numeric input (allow empty -> null)
  const toNumOrNull = (v) => {
    if (v === "" || v == null) return null;
    const x = Number(v);
    return Number.isFinite(x) ? x : null;
  };

  getDaysLimitForUser(req, (err, daysLimit) => {
    if (err) return res.status(500).json({ error: "Database error" });

    // enforce daysLimit
    const dateClause = daysLimit != null ? `AND we.work_date >= date('now', ?)` : "";
    const params = daysLimit != null ? [id, companyId, `-${daysLimit} days`] : [id, companyId];

    db.get(
      `SELECT we.* FROM work_entries we WHERE we.id = ? AND we.company_id = ? ${dateClause} LIMIT 1`,
      params,
      (e2, existing) => {
        if (e2) return res.status(500).json({ error: "Database error" });
        if (!existing) {
          return res
            .status(403)
            .json({ error: "You cannot edit this record (out of allowed date range)." });
        }

        // resolve job_id from job_code
        db.get(
          `SELECT id FROM jobs WHERE company_id = ? AND job_code = ?`,
          [companyId, String(job_code).trim()],
          async (jErr, jobRow) => {
            if (jErr) return res.status(500).json({ error: "Database error" });
            if (!jobRow) return res.status(400).json({ error: `Invalid job_code: ${job_code}` });

            const jobId = jobRow.id;

            // permission: can edit rates?
            let canEditRates = false;

            try {
              canEditRates = await new Promise((resolve, reject) => {
                hasPermission(req, "WORK_ENTRY_EDIT_RATES", (err, ok) => {
                  if (err) return reject(err);
                  resolve(ok);
                });
              });
            } catch (pErr) {
              console.error("hasPermission error:", pErr);
              return res.status(500).json({ error: "Database error" });
            }


            // detect rate change attempt
            const wantsRateChange =
              (customer_rate != null && Number(customer_rate) !== Number(existing.customer_rate)) ||
              (wage_rate != null && Number(wage_rate) !== Number(existing.wage_rate));

            if (wantsRateChange && !canEditRates) {
              return res.status(403).json({ error: "No permission to edit rates." });
            }

            const finalTierId =
              wage_tier_id != null && wage_tier_id !== ""
                ? Number(wage_tier_id)
                : (existing.wage_tier_id ?? null);

            const requestedFees = toNumOrNull(fees_collected);
            // NOTE: final fees will be decided after we know finalCustomerTotal
            if (requestedFees != null && requestedFees < 0) {
              return res.status(400).json({ error: "fees_collected cannot be negative." });
            }

            function doUpdate(finalCustomerRate, finalCustomerTotal, finalWageRate, finalWageTotal) {
              // fees_collected:
              // - if user typed a number -> use it
              // - else default to customer_total (finalCustomerTotal)
              const finalFeesCollected = requestedFees == null ? finalCustomerTotal : requestedFees;

              db.run(
                `
                UPDATE work_entries
                  SET job_id = ?,
                      amount = ?,
                      is_bank = ?,
                      worker_id = ?,

                      customer_rate = ?,
                      customer_total = ?,

                      wage_tier_id = ?,
                      wage_rate = ?,
                      wage_total = ?,

                      rate = ?,
                      pay = ?,

                      job_no1 = ?,
                      job_no2 = ?,
                      work_date = ?,
                      note = ?,
                      fees_collected = ?
                WHERE id = ?
                  AND company_id = ?
                `,
                [
                  jobId,
                  hrs,
                  Number(is_bank) === 1 ? 1 : 0,
                  Number(worker_id),

                  finalCustomerRate,
                  finalCustomerTotal,

                  finalTierId,
                  finalWageRate,
                  finalWageTotal,

                  finalWageRate,   // legacy rate
                  finalWageTotal,  // legacy pay

                  String(job_no1).trim(),
                  (job_no2 || "").trim() || null,
                  work_date,
                  (note || "").trim() || null,
                  finalFeesCollected,

                  id,
                  companyId
                ],
                function (updateErr) {
                  if (updateErr) {
                    if (updateErr.message.includes("UNIQUE constraint failed: work_entries.company_id, work_entries.job_no1")) {
                      return res.status(400).json({ error: "Job No1 already exists for this company." });
                    }
                    console.error("UPDATE work_entries error:", updateErr.message);
                    return res.status(500).json({ error: "Database error" });
                  }

                  if (this.changes === 0) return res.status(404).json({ error: "Work entry not found." });

                  res.json({
                    message: "Updated",
                    changes: this.changes,
                    canEditRates,
                    fees_collected: finalFeesCollected
                  });
                }
              );
            }

            // ✅ If user can't edit rates: recalc from DB for job+tier
            if (!canEditRates) {
              db.get(
                `
                SELECT
                  j.normal_price AS customer_rate,
                  COALESCE(jw.wage_rate, 0) AS wage_rate
                FROM jobs j
                LEFT JOIN job_wages jw
                  ON jw.job_id = j.id
                 AND jw.tier_id = ?
                 AND jw.company_id = j.company_id
                WHERE j.id = ?
                  AND j.company_id = ?
                LIMIT 1
                `,
                [finalTierId, jobId, companyId],
                (rErr, rateRow) => {
                  if (rErr) return res.status(500).json({ error: "Database error" });
                  if (!rateRow) return res.status(400).json({ error: "Failed to resolve rates for selected job/tier." });

                  const finalCustomerRate = Number(rateRow.customer_rate || 0);
                  const finalWageRate = Number(rateRow.wage_rate || 0);

                  if (!Number.isFinite(finalCustomerRate) || finalCustomerRate <= 0) {
                    return res.status(400).json({ error: "Invalid customer rate for this job." });
                  }
                  if (!Number.isFinite(finalWageRate) || finalWageRate <= 0) {
                    return res.status(400).json({ error: "Invalid wage rate for this wage tier." });
                  }

                  const finalCustomerTotal = finalCustomerRate * hrs;
                  const finalWageTotal = finalWageRate * hrs;

                  doUpdate(finalCustomerRate, finalCustomerTotal, finalWageRate, finalWageTotal);
                }
              );
              return;
            }

            // ✅ canEditRates: accept request values
            const finalCustomerRate = Number(customer_rate);
            const finalWageRate = Number(wage_rate);

            if (!Number.isFinite(finalCustomerRate) || finalCustomerRate <= 0) {
              return res.status(400).json({ error: "Invalid customer_rate." });
            }
            if (!Number.isFinite(finalWageRate) || finalWageRate <= 0) {
              return res.status(400).json({ error: "Invalid wage_rate." });
            }

            const finalCustomerTotal = finalCustomerRate * hrs;
            const finalWageTotal = finalWageRate * hrs;

            doUpdate(finalCustomerRate, finalCustomerTotal, finalWageRate, finalWageTotal);
          }
        );
      }
    );
  });
});


/* ===========================
   DELETE work entry (protected by daysLimit)
   DELETE /api/work-entries/:id?companyId=1
   =========================== */
router.delete("/:id", requirePermission("WORK_ENTRY_DELETE"), (req, res) => {
  const companyId = getCompanyId(req);
  const id = parseInt(req.params.id, 10);

  getDaysLimitForUser(req, (err, daysLimit) => {
    if (err) return res.status(500).json({ error: "Database error" });

    ensureRowWithinLimit({ id, companyId, daysLimit }, (checkErr, ok) => {
      if (checkErr) return res.status(500).json({ error: "Database error" });
      if (!ok) {
        return res.status(403).json({
          error: "You cannot delete this record (out of allowed date range)."
        });
      }

      db.run(
        "DELETE FROM work_entries WHERE id = ? AND company_id = ?",
        [id, companyId],
        function (delErr) {
          if (delErr) return res.status(500).json({ error: "Database error" });
          if (this.changes === 0) return res.status(404).json({ error: "Not found" });
          res.json({ message: "Deleted", changes: this.changes });
        }
      );
    });
  });
});

/* ===========================
   GET worker month customer total
   GET /api/work-entries/worker-month-customer-total?companyId=1&workerId=2&month=YYYY-MM
   =========================== */
router.get("/worker-month-customer-total", (req, res) => {
  const companyId = parseInt(req.query.companyId, 10) || 1;
  const workerId = parseInt(req.query.workerId, 10);
  const month = (req.query.month || "").trim();

  if (!workerId || !month || !/^\d{4}-\d{2}$/.test(month)) {
    return res.status(400).json({ error: "companyId, workerId, and month(YYYY-MM) are required." });
  }

  const start = `${month}-01`;
  const end = new Date(`${month}-01T00:00:00`);
  end.setMonth(end.getMonth() + 1);
  const endStr = end.toISOString().slice(0, 10);

  db.get(
    `SELECT COALESCE(SUM(customer_total), 0) AS total
       FROM work_entries
      WHERE company_id = ?
        AND worker_id = ?
        AND work_date >= ?
        AND work_date < ?`,
    [companyId, workerId, start, endStr],
    (err, row) => {
      if (err) return res.status(500).json({ error: "Database error" });
      res.json({ total: Number(row?.total || 0) });
    }
  );
});

export default router;
