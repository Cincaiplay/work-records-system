// src/routes/reportRoutes.js
import express from "express";
import PDFDocument from "pdfkit";
import db from "../config/db.js";
import path from "path";
import { fileURLToPath } from "url";
import { requireAuth } from "../middleware/auth.js";
import { requirePermission, hasPermission } from "../middleware/permission.js";

const router = express.Router();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

router.use(requireAuth, requirePermission("PAGE_Reports"));

/**
 * payFilter rules:
 * - If user has REPORT_FILTER_PAYTYPE (or is admin): allow bank/cash toggles from query
 * - Else: force BANK_ONLY and hide toggles on UI
 */
async function resolvePayFilter(req) {
  const user = req.session?.user;
  const userId = Number(user?.id);

  const canFilterPayType =
    Number(user?.is_admin) === 1 ? true : await hasPermission(userId, "REPORT_FILTER_PAYTYPE");

  let payFilter = "BANK_ONLY"; // default if no permission

  if (canFilterPayType) {
    const cash = Number(req.query.cash ?? 1) === 1;
    const bank = Number(req.query.bank ?? 1) === 1;

    if (cash && bank) payFilter = "BOTH";
    else if (cash && !bank) payFilter = "CASH_ONLY";
    else if (!cash && bank) payFilter = "BANK_ONLY";
    else payFilter = "NONE";
  }

  return { canFilterPayType, payFilter };
}

/**
 * JobNo filter rules:
 * - jobno1=1 & jobno2=1 => ALL
 * - jobno1=0 & jobno2=1 => only rows that HAVE job_no2
 * - jobno1=1 & jobno2=0 => only rows that DO NOT HAVE job_no2
 * - jobno1=0 & jobno2=0 => ALL (fallback)
 */
function resolveJobNoFilter(req) {
  const j1 = Number(req.query.jobno1 ?? 1) === 1;
  const j2 = Number(req.query.jobno2 ?? 1) === 1;

  if (j1 && j2) return "ALL";
  if (!j1 && j2) return "HAS_JOBNO2";
  if (j1 && !j2) return "NO_JOBNO2";
  return "ALL";
}

function jobNoWhereSql(jobNoFilter) {
  // assumes table alias: we
  // treat NULL and spaces as empty
  if (jobNoFilter === "HAS_JOBNO2") return "AND TRIM(COALESCE(we.job_no2,'')) <> ''";
  if (jobNoFilter === "NO_JOBNO2") return "AND TRIM(COALESCE(we.job_no2,'')) = ''";
  return ""; // ALL
}

function isValidISODate(s) {
  return typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
}

function formatDMY(iso) {
  if (!iso) return "";
  const [y, m, d] = String(iso).split("-");
  if (!y || !m || !d) return String(iso);
  return `${d}/${m}/${y}`;
}

function num(n) {
  const x = Number(n);
  return Number.isFinite(x) ? x : 0;
}

function payWhereSql(payFilter) {
  // assumes table alias: we
  if (payFilter === "BANK_ONLY") return "AND COALESCE(we.is_bank,0) = 1";
  if (payFilter === "CASH_ONLY") return "AND COALESCE(we.is_bank,0) = 0";
  if (payFilter === "NONE") return "AND 1=0";
  return ""; // BOTH
}

function baseFromJoinSql() {
  return `
    FROM work_entries we
    JOIN workers w ON w.id = we.worker_id
    JOIN work_entry_jobs wej ON wej.work_entry_id = we.id
  `;
}

function jobsLeftJoinSql() {
  return `
    LEFT JOIN jobs j ON j.id = wej.job_id AND j.company_id = we.company_id
  `;
}


/* -----------------------------
   Worker Monthly Pays (FIXED for your schema)
   - cash_wage = sum wages where we.is_bank = 0
   - bank_wage = sum wages where we.is_bank = 1
------------------------------ */
function queryWorkerMonthlyPays({ companyId, start, end, payFilter, jobNoFilter }) {
  return new Promise((resolve, reject) => {
    const paySql = payWhereSql(payFilter);
    const jobNoSql = jobNoWhereSql(jobNoFilter);

    const sql = `
      SELECT
        w.worker_code AS worker_code,
        COALESCE(w.worker_name, w.worker_english_name, '') AS worker_name,

        SUM(COALESCE(wej.hours, 0)) AS total_hours,
        SUM(COALESCE(wej.customer_total, 0)) AS total_customer,
        SUM(COALESCE(wej.wage_total, wej.pay, 0)) AS total_wage,

        -- ✅ cash out wage (is_bank = 0)
        SUM(
          CASE WHEN COALESCE(we.is_bank,0) = 0
            THEN COALESCE(wej.wage_total, wej.pay, 0)
            ELSE 0
          END
        ) AS cash_wage,

        -- ✅ bank out wage (is_bank = 1)
        SUM(
          CASE WHEN COALESCE(we.is_bank,0) = 1
            THEN COALESCE(wej.wage_total, wej.pay, 0)
            ELSE 0
          END
        ) AS bank_wage

      ${baseFromJoinSql()}
      WHERE we.company_id = ?
        AND date(we.work_date) >= date(?)
        AND date(we.work_date) <= date(?)
        ${paySql}
        ${jobNoSql}
      GROUP BY w.worker_code, w.worker_name, w.worker_english_name
      ORDER BY CAST(w.worker_code AS INTEGER), w.worker_code
    `;

    db.all(sql, [companyId, start, end], (err, rows) => {
      if (err) return reject(err);
      resolve(rows || []);
    });
  });
}

router.get("/worker-monthly-pays", async (req, res) => {
  try {
    const companyId = Number(req.query.companyId || 1);
    const start = req.query.start;
    const end = req.query.end;

    const { canFilterPayType, payFilter } = await resolvePayFilter(req);
    const jobNoFilter = resolveJobNoFilter(req);

    if (!companyId || companyId <= 0) return res.status(400).json({ error: "Invalid companyId" });
    if (!isValidISODate(start) || !isValidISODate(end))
      return res.status(400).json({ error: "Invalid start/end date (use YYYY-MM-DD)" });
    if (start > end) return res.status(400).json({ error: "Start date cannot be after end date" });

    const rows = await queryWorkerMonthlyPays({ companyId, start, end, payFilter, jobNoFilter });

    res.json({
      canFilterPayType,
      rows: rows.map((r) => ({
        worker_code: r.worker_code,
        worker_name: r.worker_name,
        total_hours: num(r.total_hours),
        total_customer: num(r.total_customer),
        total_wage: num(r.total_wage),
        cash_wage: num(r.cash_wage),
        bank_wage: num(r.bank_wage),
      })),
    });
  } catch (err) {
    console.error("worker-monthly-pays error:", err);
    res.status(500).json({ error: "Failed to generate report" });
  }
});


// ==============================
// Worker Monthly Pays (PDF)
// GET /api/reports/worker-monthly-pays/pdf?companyId=1&start=YYYY-MM-DD&end=YYYY-MM-DD&cash=1&bank=1&jobno1=1&jobno2=1
// Optional: &showVouchers=1 (only if your queryWorkerMonthlyPays returns voucher1_wage/voucher2_wage)
// ==============================
router.get("/worker-monthly-pays/pdf", async (req, res) => {
  try {
    const companyId = Number(req.query.companyId || 1);
    const start = req.query.start;
    const end = req.query.end;

    const showVouchers = String(req.query.showVouchers || "") === "1";
    const { payFilter } = await resolvePayFilter(req);
    const jobNoFilter = resolveJobNoFilter(req);

    if (!companyId || companyId <= 0) return res.status(400).send("Invalid companyId");
    if (!isValidISODate(start) || !isValidISODate(end))
      return res.status(400).send("Invalid start/end date (use YYYY-MM-DD)");
    if (start > end) return res.status(400).send("Start date cannot be after end date");

    const companyName = await new Promise((resolve) => {
      db.get("SELECT name FROM companies WHERE id = ?", [companyId], (err, row) => {
        if (err) return resolve("");
        resolve(String(row?.name || "").trim());
      });
    });

    const rows = await queryWorkerMonthlyPays({ companyId, start, end, payFilter, jobNoFilter });

    const filename = `Worker_Monthly_Pays_${companyName || companyId}_${start}_to_${end}.pdf`;
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="${filename}"`);

    const doc = new PDFDocument({ size: "A4", margin: 40 });
    doc.pipe(res);

    const fontPath = path.join(__dirname, "../../fonts/NotoSansSC-Regular.ttf");
    doc.registerFont("NotoSC", fontPath);
    doc.font("NotoSC");

    const fmt2 = (v) => num(v).toFixed(2);

    /* ================= Header ================= */
    doc.fontSize(16).text("Worker Monthly Pays 工资结单", { align: "center" });
    doc.moveDown(0.35);

    doc.fontSize(10).fillColor("#555").text(
      `${companyName ? `Company: ${companyName}` : `Company ID: ${companyId}`}    Date: ${formatDMY(
        start
      )} - ${formatDMY(end)}`,
      { align: "center" }
    );
    doc.fillColor("#000");
    doc.moveDown(1);

    /* ================= Table layout ================= */
    const pageW = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    const x0 = doc.page.margins.left;
    let y = doc.y;
    const rowH = 16;

    let col = showVouchers
      ? {
          code: 70,
          name: 160,
          hours: 60,
          cust: 90,
          wage: 80,
          cash: 90,
          bank: 110,
          v1: 60,
          v2: 60,
        }
      : {
          code: 75,
          name: 190,
          hours: 60,
          cust: 95,
          wage: 85,
          cash: 95,
          bank: 120,
        };

    // auto-scale columns to fit page width
    const sumW = Object.values(col).reduce((s, w) => s + w, 0);
    if (sumW > pageW) {
      const scale = pageW / sumW;
      Object.keys(col).forEach((k) => {
        col[k] = Math.max(22, Math.floor(col[k] * scale));
      });
    }

    const diff = pageW - Object.values(col).reduce((s, w) => s + w, 0);
    col.name += diff; // absorb rounding error

    const bottomLimit = () => doc.page.height - doc.page.margins.bottom - 30;
    const ensureRow = () => {
      if (y + rowH > bottomLimit()) {
        doc.addPage();
        y = doc.page.margins.top;
        drawHeader();
      }
    };

    const drawCell = ({ text, x, y0, w, align = "left", bg = null, fontSize = 9 }) => {
      if (bg) {
        doc.save();
        doc.rect(x, y0, w, rowH).fill(bg);
        doc.restore();
      }
      doc.save();
      doc.lineWidth(0.6).strokeColor("#999");
      doc.rect(x, y0, w, rowH).stroke();
      doc.restore();

      doc.font("NotoSC").fontSize(fontSize);
      doc.text(String(text ?? ""), x + 4, y0 + 3, {
        width: w - 8,
        align,
        ellipsis: true,
      });
    };

    const drawHeader = () => {
      const bg = "#E9F2FF";
      const hf = 8;
      let x = x0;

      drawCell({ text: "工号", x, y0: y, w: col.code, align: "center", bg, fontSize: hf }); x += col.code;
      drawCell({ text: "技师名", x, y0: y, w: col.name, align: "center", bg, fontSize: hf }); x += col.name;
      drawCell({ text: "钟点", x, y0: y, w: col.hours, align: "center", bg, fontSize: hf }); x += col.hours;
      drawCell({ text: "收费", x, y0: y, w: col.cust, align: "center", bg, fontSize: hf }); x += col.cust;
      drawCell({ text: "总工钱", x, y0: y, w: col.wage, align: "center", bg, fontSize: hf }); x += col.wage;
      drawCell({ text: "现金出工钱", x, y0: y, w: col.cash, align: "center", bg, fontSize: hf }); x += col.cash;
      drawCell({ text: "支票/转账工钱", x, y0: y, w: col.bank, align: "center", bg, fontSize: hf }); x += col.bank;

      if (showVouchers) {
        drawCell({ text: "支票1", x, y0: y, w: col.v1, align: "center", bg, fontSize: hf }); x += col.v1;
        drawCell({ text: "支票2报杂费", x, y0: y, w: col.v2, align: "center", bg, fontSize: hf });
      }

      y += rowH;
    };

    drawHeader();

    /* ================= Rows ================= */
    let totalHours = 0,
      totalCustomer = 0,
      totalWage = 0,
      totalCash = 0,
      totalBank = 0,
      totalV1 = 0,
      totalV2 = 0;

    rows.forEach((r) => {
      ensureRow();

      const h = num(r.total_hours);
      const c = num(r.total_customer);
      const w = num(r.total_wage);
      const cash = num(r.cash_wage);
      const bank = num(r.bank_wage);
      const v1 = showVouchers ? num(r.voucher1_wage) : 0;
      const v2 = showVouchers ? num(r.voucher2_wage) : 0;

      totalHours += h;
      totalCustomer += c;
      totalWage += w;
      totalCash += cash;
      totalBank += bank;
      totalV1 += v1;
      totalV2 += v2;

      let x = x0;
      drawCell({ text: r.worker_code || "-", x, y0: y, w: col.code }); x += col.code;
      drawCell({ text: r.worker_name || "-", x, y0: y, w: col.name }); x += col.name;
      drawCell({ text: fmt2(h), x, y0: y, w: col.hours, align: "right" }); x += col.hours;
      drawCell({ text: fmt2(c), x, y0: y, w: col.cust, align: "right" }); x += col.cust;
      drawCell({ text: fmt2(w), x, y0: y, w: col.wage, align: "right" }); x += col.wage;
      drawCell({ text: fmt2(cash), x, y0: y, w: col.cash, align: "right" }); x += col.cash;
      drawCell({ text: fmt2(bank), x, y0: y, w: col.bank, align: "right" }); x += col.bank;

      if (showVouchers) {
        drawCell({ text: fmt2(v1), x, y0: y, w: col.v1, align: "right" }); x += col.v1;
        drawCell({ text: fmt2(v2), x, y0: y, w: col.v2, align: "right" });
      }

      y += rowH;
    });

    /* ================= Total row ================= */
    ensureRow();
    const bg = "#FFF3CD";
    let x = x0;

    drawCell({
      text: "本月份总数",
      x,
      y0: y,
      w: col.code + col.name,
      bg,
    });
    x += col.code + col.name;

    drawCell({ text: fmt2(totalHours), x, y0: y, w: col.hours, align: "right", bg }); x += col.hours;
    drawCell({ text: fmt2(totalCustomer), x, y0: y, w: col.cust, align: "right", bg }); x += col.cust;
    drawCell({ text: fmt2(totalWage), x, y0: y, w: col.wage, align: "right", bg }); x += col.wage;
    drawCell({ text: fmt2(totalCash), x, y0: y, w: col.cash, align: "right", bg }); x += col.cash;
    drawCell({ text: fmt2(totalBank), x, y0: y, w: col.bank, align: "right", bg }); x += col.bank;

    if (showVouchers) {
      drawCell({ text: fmt2(totalV1), x, y0: y, w: col.v1, align: "right", bg }); x += col.v1;
      drawCell({ text: fmt2(totalV2), x, y0: y, w: col.v2, align: "right", bg });
    }

    doc.end();
  } catch (err) {
    console.error("worker-monthly-pays pdf error:", err);
    res.status(500).send("Failed to generate PDF");
  }
});

/* -----------------------------
   Sales Listing
------------------------------ */
function querySalesListing({ companyId, start, end, payFilter, jobNoFilter }) {
  return new Promise((resolve, reject) => {
    const paySql = payWhereSql(payFilter);
    const jobNoSql = jobNoWhereSql(jobNoFilter);

    const detailSql = `
      SELECT
        we.work_date AS work_date,
        we.job_no1 AS bill_no,
        (j.job_code || ' - ' || COALESCE(j.job_type, '')) AS job_desc,
        COALESCE(wej.hours, 0) AS hours,
        COALESCE(wej.customer_total, 0) AS fee
      FROM work_entries we
      JOIN work_entry_jobs wej ON wej.work_entry_id = we.id
      ${jobsLeftJoinSql()}
      WHERE we.company_id = ?
        AND date(we.work_date) >= date(?)
        AND date(we.work_date) <= date(?)
        ${paySql}
        ${jobNoSql}
      ORDER BY date(we.work_date), CAST(we.job_no1 AS INTEGER), we.job_no1
    `;

    const daySql = `
      SELECT
        we.work_date AS work_date,
        SUM(COALESCE(wej.customer_total, 0)) AS daily_sales
      FROM work_entries we
      JOIN work_entry_jobs wej ON wej.work_entry_id = we.id
      WHERE we.company_id = ?
        AND date(we.work_date) >= date(?)
        AND date(we.work_date) <= date(?)
        ${paySql}
        ${jobNoSql}
      GROUP BY we.work_date
      ORDER BY date(we.work_date)
    `;

    db.all(detailSql, [companyId, start, end], (e1, rows) => {
      if (e1) return reject(e1);
      db.all(daySql, [companyId, start, end], (e2, days) => {
        if (e2) return reject(e2);
        resolve({ rows: rows || [], days: days || [] });
      });
    });
  });
}

router.get("/sales-listing", async (req, res) => {
  try {
    const companyId = Number(req.query.companyId || 1);
    const start = req.query.start;
    const end = req.query.end;

    const { canFilterPayType, payFilter } = await resolvePayFilter(req);
    const jobNoFilter = resolveJobNoFilter(req);

    if (!companyId || companyId <= 0) return res.status(400).json({ error: "Invalid companyId" });
    if (!isValidISODate(start) || !isValidISODate(end)) return res.status(400).json({ error: "Invalid start/end date" });
    if (start > end) return res.status(400).json({ error: "Start date cannot be after end date" });

    const data = await querySalesListing({ companyId, start, end, payFilter, jobNoFilter });

    res.json({
      canFilterPayType,
      rows: (data.rows || []).map((r) => ({
        work_date: r.work_date,
        bill_no: r.bill_no,
        job_desc: r.job_desc,
        hours: num(r.hours),
        fee: num(r.fee),
      })),
      days: (data.days || []).map((d) => ({
        work_date: d.work_date,
        daily_sales: num(d.daily_sales),
      })),
    });
  } catch (err) {
    console.error("sales-listing error:", err);
    res.status(500).json({ error: "Failed to generate report" });
  }
});

router.get("/sales-listing/pdf", async (req, res) => {
  try {
    const companyId = Number(req.query.companyId || 1);
    const start = req.query.start;
    const end = req.query.end;

    const { payFilter } = await resolvePayFilter(req);
    const jobNoFilter = resolveJobNoFilter(req);

    if (!companyId || companyId <= 0) return res.status(400).send("Invalid companyId");
    if (!isValidISODate(start) || !isValidISODate(end)) return res.status(400).send("Invalid start/end date");
    if (start > end) return res.status(400).send("Start date cannot be after end date");

    const { rows, days } = await querySalesListing({ companyId, start, end, payFilter, jobNoFilter });

    const filename = `Daily_Sales_Report_${companyId}_${start}_to_${end}.pdf`;
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="${filename}"`);

    const doc = new PDFDocument({ size: "A4", margin: 40 });
    doc.pipe(res);

    const fontPath = path.join(__dirname, "../../fonts/NotoSansSC-Regular.ttf");
    doc.registerFont("NotoSC", fontPath);
    doc.font("NotoSC");

    doc.fontSize(14).text("TWIN REFLEXOLOGY HEALING SDN BHD", { align: "center" });
    doc.moveDown(0.2);
    doc.fontSize(12).text("Daily Sales Report 每天生意记录", { align: "center" });
    doc.moveDown(0.4);
    doc.fontSize(10).fillColor("#555").text(`Date: ${formatDMY(start)} - ${formatDMY(end)}`, { align: "center" });
    doc.fillColor("#000");
    doc.moveDown(1);

    const byDate = new Map();
    (rows || []).forEach((r) => {
      const k = r.work_date;
      if (!byDate.has(k)) byDate.set(k, []);
      byDate.get(k).push(r);
    });

    const pageW = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    const startX = doc.page.margins.left;
    let y = doc.y;

    const col = { date: 70, bill: 70, job: 220, hours: 60, fee: 70 };
    const rowH = 16;
    const fmt2 = (v) => num(v).toFixed(2);

    const ensureSpace = (need = 30) => {
      if (y > doc.page.height - doc.page.margins.bottom - need) {
        doc.addPage();
        y = doc.page.margins.top;
      }
    };

    const drawHeader = () => {
      ensureSpace(30);
      doc.save();
      doc.rect(startX, y - 2, pageW, rowH + 4).fill("#E9F2FF");
      doc.restore();

      doc.font("NotoSC").fontSize(9).fillColor("#000");
      let x = startX;
      doc.text("Date日期", x, y, { width: col.date }); x += col.date;
      doc.text("Bill No单号", x, y, { width: col.bill }); x += col.bill;
      doc.text("Job Descriptions项目", x, y, { width: col.job }); x += col.job;
      doc.text("Hour钟点", x, y, { width: col.hours, align: "right" }); x += col.hours;
      doc.text("Fee收费", x, y, { width: col.fee, align: "right" });
      y += rowH;
    };

    const drawRow = (r, showDate) => {
      ensureSpace(25);
      doc.font("NotoSC").fontSize(9).fillColor("#000");

      let x = startX;
      doc.text(showDate ? formatDMY(r.work_date) : "", x, y, { width: col.date }); x += col.date;
      doc.text(String(r.bill_no || "-"), x, y, { width: col.bill }); x += col.bill;
      doc.text(String(r.job_desc || "-"), x, y, { width: col.job }); x += col.job;
      doc.text(fmt2(r.hours), x, y, { width: col.hours, align: "right" }); x += col.hours;
      doc.text(fmt2(r.fee), x, y, { width: col.fee, align: "right" });
      y += rowH;
    };

    const drawDailyTotal = (total) => {
      ensureSpace(25);
      doc.font("NotoSC").fontSize(9).fillColor("red");
      doc.text(fmt2(total), startX, y, { width: pageW, align: "right" });
      doc.fillColor("#000");
      y += rowH;
    };

    drawHeader();

    let grand = 0;
    (days || []).forEach((d) => {
      const list = byDate.get(d.work_date) || [];
      const dayTotal = num(d.daily_sales);
      grand += dayTotal;

      list.forEach((r, idx) => drawRow(r, idx === 0));
      drawDailyTotal(dayTotal);

      y += 4;
      ensureSpace(30);
    });

    ensureSpace(30);
    doc.moveDown(0.5);
    doc.font("NotoSC").fontSize(10).text(`Grand Total: ${fmt2(grand)}`, { align: "right" });

    doc.end();
  } catch (err) {
    console.error("sales-listing pdf error:", err);
    res.status(500).send("Failed to generate PDF");
  }
});

/* -----------------------------
   Worker Job Listing
------------------------------ */
function queryWorkerJobListing({ companyId, start, end, payFilter, jobNoFilter }) {
  return new Promise((resolve, reject) => {
    const paySql = payWhereSql(payFilter);
    const jobNoSql = jobNoWhereSql(jobNoFilter);

    const sql = `
      SELECT
        w.id AS worker_id,
        w.worker_code AS worker_code,
        COALESCE(w.worker_name, w.worker_english_name, '') AS worker_name,

        we.work_date AS work_date,
        we.job_no1 AS bill_no,
        (j.job_code || ' - ' || COALESCE(j.job_type, '')) AS job_desc,

        COALESCE(wej.hours, 0) AS hours,
        COALESCE(wej.customer_total, 0) AS fee,
        COALESCE(wej.wage_total, wej.pay, 0) AS wage

      FROM work_entries we
      JOIN workers w ON w.id = we.worker_id
      JOIN work_entry_jobs wej ON wej.work_entry_id = we.id
      ${jobsLeftJoinSql()}
      WHERE we.company_id = ?
        AND date(we.work_date) >= date(?)
        AND date(we.work_date) <= date(?)
        ${paySql}
        ${jobNoSql}
      ORDER BY
        CAST(w.worker_code AS INTEGER), w.worker_code,
        date(we.work_date),
        CAST(we.job_no1 AS INTEGER), we.job_no1
    `;

    db.all(sql, [companyId, start, end], (err, rows) => {
      if (err) return reject(err);
      resolve(rows || []);
    });
  });
}

router.get("/account-worker-job-listing", async (req, res) => {
  try {
    const companyId = Number(req.query.companyId || 1);
    const start = req.query.start;
    const end = req.query.end;

    const { canFilterPayType, payFilter } = await resolvePayFilter(req);
    const jobNoFilter = resolveJobNoFilter(req);

    if (!companyId || companyId <= 0) return res.status(400).json({ error: "Invalid companyId" });
    if (!isValidISODate(start) || !isValidISODate(end))
      return res.status(400).json({ error: "Invalid start/end date (use YYYY-MM-DD)" });
    if (start > end) return res.status(400).json({ error: "Start date cannot be after end date" });

    const rows = await queryWorkerJobListing({ companyId, start, end, payFilter, jobNoFilter });

    const map = new Map();
    rows.forEach((r) => {
      const key = r.worker_id;
      if (!map.has(key)) {
        map.set(key, {
          worker_id: r.worker_id,
          worker_code: r.worker_code,
          worker_name: r.worker_name,
          total_hours: 0,
          total_fee: 0,
          total_wage: 0,
          rows: [],
        });
      }
      const w = map.get(key);

      const hours = num(r.hours);
      const fee = num(r.fee);
      const wage = num(r.wage);

      w.total_hours += hours;
      w.total_fee += fee;
      w.total_wage += wage;

      w.rows.push({
        work_date: r.work_date,
        bill_no: r.bill_no,
        job_desc: r.job_desc,
        hours,
        fee,
        wage,
      });
    });

    res.json({ canFilterPayType, workers: Array.from(map.values()) });
  } catch (err) {
    console.error("account-worker-job-listing error:", err);
    res.status(500).json({ error: "Failed to generate report" });
  }
});

router.get("/account-worker-job-listing/pdf", async (req, res) => {
  try {
    const companyId = Number(req.query.companyId || 1);
    const start = req.query.start;
    const end = req.query.end;

    const { payFilter } = await resolvePayFilter(req);
    const jobNoFilter = resolveJobNoFilter(req);

    if (!companyId || companyId <= 0) return res.status(400).send("Invalid companyId");
    if (!isValidISODate(start) || !isValidISODate(end)) return res.status(400).send("Invalid start/end date");
    if (start > end) return res.status(400).send("Start date cannot be after end date");

    const rows = await queryWorkerJobListing({ companyId, start, end, payFilter, jobNoFilter });

    // group by worker
    const workers = [];
    const map = new Map();
    rows.forEach((r) => {
      const key = r.worker_id;
      if (!map.has(key)) {
        const obj = {
          worker_code: r.worker_code,
          worker_name: r.worker_name,
          total_hours: 0,
          total_fee: 0,
          total_wage: 0,
          rows: [],
        };
        map.set(key, obj);
        workers.push(obj);
      }

      const w = map.get(key);
      const hours = num(r.hours);
      const fee = num(r.fee);
      const wage = num(r.wage);

      w.total_hours += hours;
      w.total_fee += fee;
      w.total_wage += wage;

      w.rows.push({
        work_date: r.work_date,
        bill_no: r.bill_no,
        job_desc: r.job_desc,
        hours,
        fee,
        wage,
      });
    });

    const filename = `Worker_Job_Listing_${companyId}_${start}_to_${end}.pdf`;
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="${filename}"`);

    const doc = new PDFDocument({ size: "A4", margin: 40 });
    doc.pipe(res);

    const fontPath = path.join(__dirname, "../../fonts/NotoSansSC-Regular.ttf");
    doc.registerFont("NotoSC", fontPath);
    doc.font("NotoSC");

    doc.fontSize(14).text("Worker Job Listing 技师工作记录", { align: "center" });
    doc.moveDown(0.3);
    doc.fontSize(10).fillColor("#555").text(
      `Company ID: ${companyId}    Date: ${formatDMY(start)} - ${formatDMY(end)}`,
      { align: "center" }
    );
    doc.fillColor("#000");
    doc.moveDown(1);

    const pageW = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    const startX = doc.page.margins.left;
    let y = doc.y;

    const col = { date: 70, bill: 70, job: 230, hours: 50, fee: 65, wage: 65 };
    const rowH = 16;
    const fmt2 = (v) => num(v).toFixed(2);

    const ensureSpace = (need = 30) => {
      if (y > doc.page.height - doc.page.margins.bottom - need) {
        doc.addPage();
        y = doc.page.margins.top;
      }
    };

    const drawTableHeader = () => {
      ensureSpace(30);
      doc.save();
      doc.rect(startX, y - 2, pageW, rowH + 4).fill("#F2F2F2");
      doc.restore();

      doc.font("NotoSC").fontSize(9).fillColor("#000");
      let x = startX;
      doc.text("日期", x, y, { width: col.date }); x += col.date;
      doc.text("单号", x, y, { width: col.bill }); x += col.bill;
      doc.text("工作项目", x, y, { width: col.job }); x += col.job;
      doc.text("钟点", x, y, { width: col.hours, align: "right" }); x += col.hours;
      doc.text("收费", x, y, { width: col.fee, align: "right" }); x += col.fee;
      doc.text("工资", x, y, { width: col.wage, align: "right" });
      y += rowH;
    };

    const drawRow = (r) => {
      ensureSpace(25);
      doc.font("NotoSC").fontSize(9).fillColor("#000");
      let x = startX;
      doc.text(formatDMY(r.work_date), x, y, { width: col.date }); x += col.date;
      doc.text(String(r.bill_no || "-"), x, y, { width: col.bill }); x += col.bill;
      doc.text(String(r.job_desc || "-"), x, y, { width: col.job }); x += col.job;
      doc.text(fmt2(r.hours), x, y, { width: col.hours, align: "right" }); x += col.hours;
      doc.text(fmt2(r.fee), x, y, { width: col.fee, align: "right" }); x += col.fee;
      doc.text(fmt2(r.wage), x, y, { width: col.wage, align: "right" });
      y += rowH;
    };

    const drawWorkerTotal = (w) => {
      ensureSpace(25);
      doc.font("NotoSC").fontSize(9).fillColor("#000");
      doc.text(
        `From ${formatDMY(start)} till ${formatDMY(end)}   ${w.worker_name || ""} 工资次数额`,
        startX,
        y,
        { width: pageW - 150, align: "left" }
      );
      doc.text(fmt2(w.total_hours), startX + pageW - 150, y, { width: 50, align: "right" });
      doc.text(fmt2(w.total_fee), startX + pageW - 100, y, { width: 65, align: "right" });
      doc.text(fmt2(w.total_wage), startX + pageW - 35, y, { width: 35, align: "right" });
      y += rowH + 6;
    };

    workers.forEach((w, idx) => {
      ensureSpace(60);

      doc.font("NotoSC").fontSize(11).fillColor("#000")
        .text(`${w.worker_code || ""}    ${w.worker_name || ""}`, startX, y);
      y += 18;

      drawTableHeader();
      w.rows.forEach((r) => drawRow(r));
      drawWorkerTotal(w);

      if (idx !== workers.length - 1) ensureSpace(30);
    });

    doc.end();
  } catch (err) {
    console.error("account-worker-job-listing pdf error:", err);
    res.status(500).send("Failed to generate PDF");
  }
});


/* -----------------------------
   Monthly Summary (NEW)
   - Group by month (YYYY-MM)
   - Fees split by bank/cash using we.is_bank (header)
   - Wages split by bank/cash using we.is_bank (header)
   - Totals from work_entry_jobs (lines)
------------------------------ */

function queryMonthlySummary({ companyId, start, end, payFilter, jobNoFilter }) {
  return new Promise((resolve, reject) => {
    const paySql = payWhereSql(payFilter);     // uses alias we
    const jobNoSql = jobNoWhereSql(jobNoFilter); // uses alias we

    const sql = `
      SELECT
        strftime('%Y-%m', we.work_date) AS ym,

        SUM(CASE WHEN COALESCE(we.is_bank,0) = 1 THEN COALESCE(wej.customer_total,0) ELSE 0 END) AS bank_fee,
        SUM(CASE WHEN COALESCE(we.is_bank,0) = 0 THEN COALESCE(wej.customer_total,0) ELSE 0 END) AS cash_fee,
        SUM(COALESCE(wej.customer_total,0)) AS total_fee,

        SUM(CASE WHEN COALESCE(we.is_bank,0) = 1 THEN COALESCE(wej.wage_total, wej.pay, 0) ELSE 0 END) AS bank_wage,
        SUM(CASE WHEN COALESCE(we.is_bank,0) = 0 THEN COALESCE(wej.wage_total, wej.pay, 0) ELSE 0 END) AS cash_wage,
        SUM(COALESCE(wej.wage_total, wej.pay, 0)) AS total_wage,

        SUM(COALESCE(wej.hours,0)) AS total_hours

      FROM work_entries we
      JOIN work_entry_jobs wej ON wej.work_entry_id = we.id
      WHERE we.company_id = ?
        AND date(we.work_date) >= date(?)
        AND date(we.work_date) <= date(?)
        ${paySql}
        ${jobNoSql}
      GROUP BY strftime('%Y-%m', we.work_date)
      ORDER BY strftime('%Y-%m', we.work_date)
    `;

    db.all(sql, [companyId, start, end], (err, rows) => {
      if (err) return reject(err);
      resolve(rows || []);
    });
  });
}

router.get("/monthly-summary", async (req, res) => {
  try {
    const companyId = Number(req.query.companyId || 1);
    const start = req.query.start;
    const end = req.query.end;

    const { canFilterPayType, payFilter } = await resolvePayFilter(req);
    const jobNoFilter = resolveJobNoFilter(req);

    if (!companyId || companyId <= 0) return res.status(400).json({ error: "Invalid companyId" });
    if (!isValidISODate(start) || !isValidISODate(end))
      return res.status(400).json({ error: "Invalid start/end date (use YYYY-MM-DD)" });
    if (start > end) return res.status(400).json({ error: "Start date cannot be after end date" });

    const rows = await queryMonthlySummary({ companyId, start, end, payFilter, jobNoFilter });

    // compute derived columns in JS
    const out = rows.map(r => {
      const hours = num(r.total_hours);
      const totalFee = num(r.total_fee);
      const totalWage = num(r.total_wage);

      const feeRate = hours > 0 ? (totalFee / hours) : 0;
      const wageRate = hours > 0 ? (totalWage / hours) : 0;
      const pct = totalFee > 0 ? (totalWage / totalFee) * 100 : 0;

      return {
        ym: r.ym,
        bank_fee: num(r.bank_fee),
        cash_fee: num(r.cash_fee),
        total_fee: totalFee,

        bank_wage: num(r.bank_wage),
        cash_wage: num(r.cash_wage),
        total_wage: totalWage,

        total_hours: hours,
        fee_rate: feeRate,
        wage_rate: wageRate,
        pct: pct,
      };
    });

    // totals row
    const totals = out.reduce((acc, r) => {
      acc.bank_fee += r.bank_fee;
      acc.cash_fee += r.cash_fee;
      acc.total_fee += r.total_fee;

      acc.bank_wage += r.bank_wage;
      acc.cash_wage += r.cash_wage;
      acc.total_wage += r.total_wage;

      acc.total_hours += r.total_hours;
      return acc;
    }, {
      bank_fee: 0, cash_fee: 0, total_fee: 0,
      bank_wage: 0, cash_wage: 0, total_wage: 0,
      total_hours: 0
    });

    totals.fee_rate = totals.total_hours > 0 ? totals.total_fee / totals.total_hours : 0;
    totals.wage_rate = totals.total_hours > 0 ? totals.total_wage / totals.total_hours : 0;
    totals.pct = totals.total_fee > 0 ? (totals.total_wage / totals.total_fee) * 100 : 0;

    res.json({ canFilterPayType, rows: out, totals });
  } catch (err) {
    console.error("monthly-summary error:", err);
    res.status(500).json({ error: "Failed to generate report" });
  }
});

router.get("/monthly-summary/pdf", async (req, res) => {
  try {
    const companyId = Number(req.query.companyId || 1);
    const start = req.query.start;
    const end = req.query.end;

    const { payFilter } = await resolvePayFilter(req);
    const jobNoFilter = resolveJobNoFilter(req);

    if (!companyId || companyId <= 0) return res.status(400).send("Invalid companyId");
    if (!isValidISODate(start) || !isValidISODate(end))
      return res.status(400).send("Invalid start/end date (use YYYY-MM-DD)");
    if (start > end) return res.status(400).send("Start date cannot be after end date");

    const rowsRaw = await queryMonthlySummary({ companyId, start, end, payFilter, jobNoFilter });

    const rows = rowsRaw.map(r => {
      const hours = num(r.total_hours);
      const totalFee = num(r.total_fee);
      const totalWage = num(r.total_wage);
      return {
        ym: r.ym,
        bank_fee: num(r.bank_fee),
        cash_fee: num(r.cash_fee),
        total_fee: totalFee,
        bank_wage: num(r.bank_wage),
        cash_wage: num(r.cash_wage),
        total_wage: totalWage,
        total_hours: hours,
        fee_rate: hours > 0 ? totalFee / hours : 0,
        wage_rate: hours > 0 ? totalWage / hours : 0,
        pct: totalFee > 0 ? (totalWage / totalFee) * 100 : 0,
      };
    });

    const totals = rows.reduce((acc, r) => {
      acc.bank_fee += r.bank_fee;
      acc.cash_fee += r.cash_fee;
      acc.total_fee += r.total_fee;
      acc.bank_wage += r.bank_wage;
      acc.cash_wage += r.cash_wage;
      acc.total_wage += r.total_wage;
      acc.total_hours += r.total_hours;
      return acc;
    }, { bank_fee:0,cash_fee:0,total_fee:0,bank_wage:0,cash_wage:0,total_wage:0,total_hours:0 });

    totals.fee_rate = totals.total_hours > 0 ? totals.total_fee / totals.total_hours : 0;
    totals.wage_rate = totals.total_hours > 0 ? totals.total_wage / totals.total_hours : 0;
    totals.pct = totals.total_fee > 0 ? (totals.total_wage / totals.total_fee) * 100 : 0;

    const filename = `Monthly_Summary_${companyId}_${start}_to_${end}.pdf`;
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="${filename}"`);

    const companyName = await new Promise((resolve) => {
      db.get(
        "SELECT name FROM companies WHERE id = ?",
        [companyId],
        (err, row) => {
          if (err) {
            console.error("[Monthly Summary PDF] company lookup error:", err);
            return resolve("");
          }
          resolve(String(row?.name || "").trim());
        }
      );
    });



    const doc = new PDFDocument({ size: "A4", margin: 36 });
    doc.pipe(res);

    // font
    const fontPath = path.join(__dirname, "../../fonts/NotoSansSC-Regular.ttf");
    doc.registerFont("NotoSC", fontPath);
    doc.font("NotoSC");

    // title
    doc.fontSize(16).text(`${companyName || "Company"} - MONTHLY REPORTS`, { align: "center" });
    doc.moveDown(0.4);
    doc.fontSize(10).fillColor("#555").text(
      `Company ID: ${companyId}    Date: ${formatDMY(start)} - ${formatDMY(end)}`,
      { align: "center" }
    );
    doc.fillColor("#000");
    doc.moveDown(1);

    const fmt2 = (v) => num(v).toFixed(2);

    // column widths (fit A4)
    const pageW = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    const x0 = doc.page.margins.left;

    const col = {
      month: 90,
      bankFee: 72,
      cashFee: 72,
      totalFee: 78,
      bankWage: 72,
      cashWage: 72,
      totalWage: 78,
      hours: 58,
      feeRate: 60,
      wageRate: 60,
      pct: 46,
    };

    // if too wide, squeeze a bit automatically
    const totalW = Object.values(col).reduce((s, n) => s + n, 0);
    const scale = totalW > pageW ? (pageW / totalW) : 1;
    Object.keys(col).forEach(k => col[k] = Math.floor(col[k] * scale));

    let y = doc.y;
    const rowH = 18;

    const ensure = () => {
      if (y > doc.page.height - doc.page.margins.bottom - 40) {
        doc.addPage();
        y = doc.page.margins.top;
      }
    };

    const drawHeader = () => {
      ensure();
      doc.save();
      doc.rect(x0, y - 2, pageW, rowH + 4).fill("#E9F2FF");
      doc.restore();

      doc.fontSize(9).fillColor("#000");
      let x = x0;
      doc.text("月份", x, y, { width: col.month }); x += col.month;
      doc.text("银行户口", x, y, { width: col.bankFee, align: "right" }); x += col.bankFee;
      doc.text("现金户口", x, y, { width: col.cashFee, align: "right" }); x += col.cashFee;
      doc.text("总收费", x, y, { width: col.totalFee, align: "right" }); x += col.totalFee;

      doc.text("银行工资", x, y, { width: col.bankWage, align: "right" }); x += col.bankWage;
      doc.text("现金工资", x, y, { width: col.cashWage, align: "right" }); x += col.cashWage;
      doc.text("总工资", x, y, { width: col.totalWage, align: "right" }); x += col.totalWage;

      doc.text("总钟点", x, y, { width: col.hours, align: "right" }); x += col.hours;
      doc.text("收费钟价", x, y, { width: col.feeRate, align: "right" }); x += col.feeRate;
      doc.text("工资钟价", x, y, { width: col.wageRate, align: "right" }); x += col.wageRate;
      doc.text("%", x, y, { width: col.pct, align: "right" });

      y += rowH;
    };

    const monthLabel = (ym) => {
      // ym = "YYYY-MM"
      const [Y, M] = String(ym).split("-");
      const map = {
        "01":"January","02":"February","03":"March","04":"April","05":"May","06":"June",
        "07":"July","08":"August","09":"September","10":"October","11":"November","12":"December",
      };
      return `${map[M] || ym} ${Y || ""}`.trim();
    };

    const drawRow = (r, isTotal = false) => {
      ensure();

      if (isTotal) {
        doc.save();
        doc.rect(x0, y - 2, pageW, rowH + 4).fill("#FFF3CD");
        doc.restore();
      }

      doc.fontSize(9).fillColor("#000");
      let x = x0;
      doc.text(isTotal ? "TOTAL 总数" : monthLabel(r.ym), x, y, { width: col.month }); x += col.month;

      doc.fillColor(isTotal ? "#B00000" : "#C00000");
      doc.text(fmt2(r.bank_fee), x, y, { width: col.bankFee, align: "right" }); x += col.bankFee;
      doc.fillColor(isTotal ? "#006400" : "#008000");
      doc.text(fmt2(r.cash_fee), x, y, { width: col.cashFee, align: "right" }); x += col.cashFee;
      doc.fillColor("#000");
      doc.text(fmt2(r.total_fee), x, y, { width: col.totalFee, align: "right" }); x += col.totalFee;

      doc.fillColor(isTotal ? "#B00000" : "#C00000");
      doc.text(fmt2(r.bank_wage), x, y, { width: col.bankWage, align: "right" }); x += col.bankWage;
      doc.fillColor(isTotal ? "#006400" : "#008000");
      doc.text(fmt2(r.cash_wage), x, y, { width: col.cashWage, align: "right" }); x += col.cashWage;
      doc.fillColor("#000");
      doc.text(fmt2(r.total_wage), x, y, { width: col.totalWage, align: "right" }); x += col.totalWage;

      doc.fillColor("#A05000");
      doc.text(fmt2(r.total_hours), x, y, { width: col.hours, align: "right" }); x += col.hours;

      doc.fillColor("#A05000");
      doc.text(fmt2(r.fee_rate), x, y, { width: col.feeRate, align: "right" }); x += col.feeRate;
      doc.text(fmt2(r.wage_rate), x, y, { width: col.wageRate, align: "right" }); x += col.wageRate;

      doc.fillColor("#1E5AA8");
      doc.text(fmt2(r.pct), x, y, { width: col.pct, align: "right" });

      doc.fillColor("#000");
      y += rowH;
    };

    drawHeader();
    rows.forEach(r => drawRow(r, false));
    drawRow({ ym:"", ...totals, bank_wage: totals.bank_wage, cash_wage: totals.cash_wage }, true);

    doc.end();
  } catch (err) {
    console.error("monthly-summary pdf error:", err);
    res.status(500).send("Failed to generate PDF");
  }
});


/* -----------------------------
   Worker Payslip (NEW)
   - One worker, date range (typically one month)
   - Lists each job line: 项目 / 时钟 / 收费 / 工资
   - Uses work_entries + work_entry_jobs (new schema)
------------------------------ */

function queryWorkerPayslipLines({ companyId, workerId, start, end, payFilter, jobNoFilter }) {
  return new Promise((resolve, reject) => {
    const paySql = payWhereSql(payFilter);       // uses alias we
    const jobNoSql = jobNoWhereSql(jobNoFilter); // uses alias we

    const sql = `
      SELECT
        we.work_date AS work_date,
        we.job_no1 AS bill_no,

        COALESCE(j.job_code, '') AS job_code,
        COALESCE(j.job_type, '') AS job_type,

        COALESCE(wej.hours, 0) AS hours,
        COALESCE(wej.customer_total, 0) AS fee,
        COALESCE(wej.wage_total, wej.pay, 0) AS wage

      FROM work_entries we
      JOIN work_entry_jobs wej ON wej.work_entry_id = we.id
      LEFT JOIN jobs j ON j.id = wej.job_id AND j.company_id = we.company_id

      WHERE we.company_id = ?
        AND we.worker_id = ?
        AND date(we.work_date) >= date(?)
        AND date(we.work_date) <= date(?)
        ${paySql}
        ${jobNoSql}

      ORDER BY date(we.work_date), CAST(we.job_no1 AS INTEGER), we.job_no1, COALESCE(j.job_code,'')
    `;

    db.all(sql, [companyId, workerId, start, end], (err, rows) => {
      if (err) return reject(err);
      resolve(rows || []);
    });
  });
}

function getWorkerById({ companyId, workerId }) {
  return new Promise((resolve) => {
    db.get(
      `SELECT id, worker_code, COALESCE(worker_name, worker_english_name, '') AS worker_name
       FROM workers
       WHERE id = ? AND company_id = ?`,
      [workerId, companyId],
      (err, row) => {
        if (err) return resolve(null);
        resolve(row || null);
      }
    );
  });
}



function monthTitleFromRange(start, end) {
  // If range spans multiple months, still show end month like Access printouts commonly do.
  const m = String(end || start || "").slice(5, 7);
  const map = { "01":"1","02":"2","03":"3","04":"4","05":"5","06":"6","07":"7","08":"8","09":"9","10":"10","11":"11","12":"12" };
  return `${map[m] || m} 月份工资结单`;
}

router.get("/worker-payslip", async (req, res) => {
  try {
    const companyId = Number(req.query.companyId || 1);
    const workerId = Number(req.query.workerId || 0);
    const start = req.query.start;
    const end = req.query.end;

    const { canFilterPayType, payFilter } = await resolvePayFilter(req);
    const jobNoFilter = resolveJobNoFilter(req);

    if (!companyId || companyId <= 0) return res.status(400).json({ error: "Invalid companyId" });
    if (!workerId || workerId <= 0) return res.status(400).json({ error: "Please select a worker." });
    if (!isValidISODate(start) || !isValidISODate(end))
      return res.status(400).json({ error: "Invalid start/end date (use YYYY-MM-DD)" });
    if (start > end) return res.status(400).json({ error: "Start date cannot be after end date" });

    const worker = await getWorkerById({ companyId, workerId });
    if (!worker) return res.status(404).json({ error: "Worker not found." });

    const rows = await queryWorkerPayslipLines({ companyId, workerId, start, end, payFilter, jobNoFilter });

    const totals = rows.reduce(
      (acc, r) => {
        acc.total_hours += num(r.hours);
        acc.total_fee += num(r.fee);
        acc.total_wage += num(r.wage);
        return acc;
      },
      { total_hours: 0, total_fee: 0, total_wage: 0 }
    );

    res.json({
      canFilterPayType,
      worker: { id: worker.id, worker_code: worker.worker_code, worker_name: worker.worker_name },
      title: monthTitleFromRange(start, end),
      rows: rows.map(r => ({
        work_date: r.work_date,
        bill_no: r.bill_no,
        job_desc: `${String(r.job_code || "").trim()}${r.job_type ? " - " + String(r.job_type).trim() : ""}`.trim() || "-",
        hours: num(r.hours),
        fee: num(r.fee),
        wage: num(r.wage),
      })),
      totals
    });
  } catch (err) {
    console.error("worker-payslip error:", err);
    res.status(500).json({ error: "Failed to generate report" });
  }
});

router.get("/worker-payslip/pdf", async (req, res) => {
  try {
    const companyId = Number(req.query.companyId || 1);
    const workerId = Number(req.query.workerId || 0);
    const start = req.query.start;
    const end = req.query.end;

    const { payFilter } = await resolvePayFilter(req);
    const jobNoFilter = resolveJobNoFilter(req);

    if (!companyId || companyId <= 0) return res.status(400).send("Invalid companyId");
    if (!workerId || workerId <= 0) return res.status(400).send("Please select a worker.");
    if (!isValidISODate(start) || !isValidISODate(end))
      return res.status(400).send("Invalid start/end date (use YYYY-MM-DD)");
    if (start > end) return res.status(400).send("Start date cannot be after end date");

    const worker = await getWorkerById({ companyId, workerId });
    if (!worker) return res.status(404).send("Worker not found.");

    const companyName = await new Promise((resolve) => {
      db.get("SELECT name FROM companies WHERE id = ?", [companyId], (err, row) => {
        if (err) return resolve("");
        resolve(String(row?.name || "").trim());
      });
    });

    const rowsRaw = await queryWorkerPayslipLines({
      companyId,
      workerId,
      start,
      end,
      payFilter,
      jobNoFilter,
    });

    const rows = rowsRaw.map((r) => ({
      job_desc:
        `${String(r.job_code || "").trim()}${r.job_type ? " - " + String(r.job_type).trim() : ""}`.trim() || "-",
      hours: num(r.hours),
      fee: num(r.fee),
      wage: num(r.wage),
    }));

    const totals = rows.reduce(
      (acc, r) => {
        acc.total_hours += num(r.hours);
        acc.total_fee += num(r.fee);
        acc.total_wage += num(r.wage);
        return acc;
      },
      { total_hours: 0, total_fee: 0, total_wage: 0 }
    );

    // Month label like Access footer: "August 2025"
    const monthYearLabel = (isoDate) => {
      const m = String(isoDate || "").slice(5, 7);
      const y = String(isoDate || "").slice(0, 4);
      const map = {
        "01": "January",
        "02": "February",
        "03": "March",
        "04": "April",
        "05": "May",
        "06": "June",
        "07": "July",
        "08": "August",
        "09": "September",
        "10": "October",
        "11": "November",
        "12": "December",
      };
      return `${map[m] || m} ${y || ""}`.trim();
    };

    // Title like Access: "11月份工资结单"
    const titleCn = monthTitleFromRange(start, end);

    const filename = `Worker_Payslip_${workerId}_${start}_to_${end}.pdf`;
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="${filename}"`);

    const doc = new PDFDocument({ size: "A4", margin: 50 });
    doc.pipe(res);

    const fontPath = path.join(__dirname, "../../fonts/NotoSansSC-Regular.ttf");
    doc.registerFont("NotoSC", fontPath);
    doc.font("NotoSC");

    const fmt2 = (v) => num(v).toFixed(2);

    // =====================================================
    // Header (Access-like)
    // =====================================================
    doc.fontSize(14).text(titleCn, { align: "center" });
    doc.moveDown(0.6);

    // worker line: "3 马素平" like Access
    doc.fontSize(10).text(`${worker.worker_code || ""}    ${worker.worker_name || ""}`, { align: "left" });
    doc.moveDown(0.4);

    // =====================================================
    // Table with borders (Access-like)
    // =====================================================
    const pageW = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    const x0 = doc.page.margins.left;
    let y = doc.y;

    const rowH = 16;

    // columns similar to Access screenshot
    const col = {
      job: Math.floor(pageW * 0.60),
      hours: Math.floor(pageW * 0.13),
      fee: Math.floor(pageW * 0.14),
      wage: Math.floor(pageW * 0.13),
    };

    const tableRight = x0 + pageW;
    const tableBottomLimit = () => doc.page.height - doc.page.margins.bottom - 230; // keep space for footer

    const ensureSpaceForRow = () => {
      if (y + rowH > tableBottomLimit()) {
        doc.addPage();
        y = doc.page.margins.top;
      }
    };

    const drawCell = (text, x, y0, w, align = "left", bold = false) => {
      doc.save();
      doc.lineWidth(0.6).strokeColor("#999");
      doc.rect(x, y0, w, rowH).stroke();
      doc.restore();

      doc.fontSize(9);
      doc.fillColor("#000");
      doc.font("NotoSC");

      // padding inside cell
      const padX = 4;
      const padY = 4;

      doc.text(String(text ?? ""), x + padX, y0 + padY, {
        width: w - padX * 2,
        align,
        ellipsis: true,
      });
    };

    // Header row background
    doc.save();
    doc.rect(x0, y, pageW, rowH).fill("#F3D7B5"); // Access-like light orange header
    doc.restore();

    // Header cells
    let x = x0;
    drawCell("项目", x, y, col.job, "center"); x += col.job;
    drawCell("时钟", x, y, col.hours, "center"); x += col.hours;
    drawCell("收费", x, y, col.fee, "center"); x += col.fee;
    drawCell("工资", x, y, col.wage, "center");
    y += rowH;

    // Rows
    rows.forEach((r) => {
      ensureSpaceForRow();
      let cx = x0;
      drawCell(r.job_desc, cx, y, col.job, "left"); cx += col.job;
      drawCell(fmt2(r.hours), cx, y, col.hours, "right"); cx += col.hours;
      drawCell(fmt2(r.fee), cx, y, col.fee, "right"); cx += col.fee;
      drawCell(fmt2(r.wage), cx, y, col.wage, "right");
      y += rowH;
    });

    // TOTAL row (highlight)
    ensureSpaceForRow();
    doc.save();
    doc.rect(x0, y, pageW, rowH).fill("#FFF3CD");
    doc.restore();

    let tx = x0;
    drawCell("TOTAL", tx, y, col.job, "left"); tx += col.job;
    drawCell(fmt2(totals.total_hours), tx, y, col.hours, "right"); tx += col.hours;
    drawCell(fmt2(totals.total_fee), tx, y, col.fee, "right"); tx += col.fee;
    drawCell(fmt2(totals.total_wage), tx, y, col.wage, "right");
    y += rowH;

    // =====================================================
    // Blue dotted divider like Access
    // =====================================================
    const dividerY = Math.max(y + 18, doc.page.height - doc.page.margins.bottom - 210);
    doc.save();
    doc.strokeColor("#2C7BE5");
    doc.lineWidth(1);
    doc.dash(2, { space: 2 });
    doc.moveTo(x0, dividerY).lineTo(tableRight, dividerY).stroke();
    doc.undash();
    doc.restore();

    // =====================================================
    // Footer layout (Access-like)
    // =====================================================
    // Company title centered (big)
    const footerTop = dividerY + 20;

    doc.fontSize(12).fillColor("#000");
    doc.text((companyName || "DEFAULT COMPANY").toUpperCase(), x0, footerTop, { width: pageW, align: "center" });

    // Date line centered (underlined look)
    doc.fontSize(9);
    doc.text(`${formatDMY(start)}   till   ${formatDMY(end)}`, x0, footerTop + 18, { width: pageW, align: "center" });

    // Left paragraph block + Right signature block
    const leftX = x0;
    const rightX = x0 + Math.floor(pageW * 0.58);
    const blockY = footerTop + 55;

    const leftW = Math.floor(pageW * 0.56);
    const rightW = pageW - (rightX - x0);

    const monthOf = monthYearLabel(end);

    doc.fontSize(9).fillColor("#000");
    doc.text(`Worker wages for the month of  :    ${monthOf}`, leftX, blockY, { width: leftW, align: "left" });
    doc.text(`I am hereby acknowledging the receipts of my wages`, leftX, blockY + 14, { width: leftW, align: "left" });
    doc.text(`amounting to RM ${fmt2(totals.total_wage)}`, leftX, blockY + 28, { width: leftW, align: "left" });

    // signature right
    doc.text(`签名：  ______________________________`, rightX, blockY + 28, { width: rightW, align: "left" });

    // worker id + name on right-bottom
    doc.text(`编号： ${worker.worker_code || ""}    ${worker.worker_name || ""}`, rightX, blockY + 55, {
      width: rightW,
      align: "left",
    });

    doc.end();
  } catch (err) {
    console.error("worker-payslip pdf error:", err);
    res.status(500).send("Failed to generate PDF");
  }
});


export default router;
