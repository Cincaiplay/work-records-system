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

/* -----------------------------
   Worker Monthly Pays
------------------------------ */
function queryWorkerMonthlyPays({ companyId, start, end, payFilter, jobNoFilter }) {
  return new Promise((resolve, reject) => {
    const paySql = payWhereSql(payFilter);
    const jobNoSql = jobNoWhereSql(jobNoFilter);

    const sql = `
      SELECT
        w.worker_code AS worker_code,
        COALESCE(w.worker_name, w.worker_english_name, '') AS worker_name,
        SUM(COALESCE(we.amount, 0)) AS total_hours,
        SUM(COALESCE(we.customer_total, (COALESCE(we.customer_rate, 0) * COALESCE(we.amount, 0)), 0)) AS total_customer,
        SUM(COALESCE(we.wage_total, we.pay, 0)) AS total_wage
      FROM work_entries we
      JOIN workers w ON w.id = we.worker_id
      WHERE we.company_id = ?
        AND we.work_date >= ?
        AND we.work_date <= ?
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
      })),
    });
  } catch (err) {
    console.error("worker-monthly-pays error:", err);
    res.status(500).json({ error: "Failed to generate report" });
  }
});

router.get("/worker-monthly-pays/pdf", async (req, res) => {
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

    const rows = await queryWorkerMonthlyPays({ companyId, start, end, payFilter, jobNoFilter });

    const filename = `Worker_Monthly_Pays_${companyId}_${start}_to_${end}.pdf`;
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="${filename}"`);

    const doc = new PDFDocument({ size: "A4", margin: 40 });
    doc.pipe(res);

    const fontPath = path.join(__dirname, "../../fonts/NotoSansSC-Regular.ttf");
    doc.registerFont("NotoSC", fontPath);
    doc.font("NotoSC");

    doc.fontSize(16).text("Worker Monthly Pays 技师的提成", { align: "left" });
    doc.moveDown(0.3);
    doc.fontSize(10).fillColor("#555").text(
      `Company ID: ${companyId}    Date: ${formatDMY(start)} - ${formatDMY(end)}`
    );
    doc.fillColor("#000");
    doc.moveDown(1);

    const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    const col = { no: 30, code: 70, name: 180, hours: 70, cust: 90, wage: 90 };
    const startX = doc.page.margins.left;
    let y = doc.y;

    const drawRow = (cells, isHeader = false) => {
      const rowH = 18;
      const fontSize = isHeader ? 10 : 9;

      if (isHeader) {
        doc.save();
        doc.rect(startX, y - 2, pageWidth, rowH + 4).fill("#E9F2FF");
        doc.restore();
      }

      doc.font("NotoSC").fontSize(fontSize).fillColor("#000");

      let x = startX;
      doc.text(cells[0], x, y, { width: col.no, align: "left" }); x += col.no;
      doc.text(cells[1], x, y, { width: col.code, align: "left" }); x += col.code;
      doc.text(cells[2], x, y, { width: col.name, align: "left" }); x += col.name;
      doc.text(cells[3], x, y, { width: col.hours, align: "right" }); x += col.hours;
      doc.text(cells[4], x, y, { width: col.cust, align: "right" }); x += col.cust;
      doc.text(cells[5], x, y, { width: col.wage, align: "right" });

      y += rowH;
    };

    const fmt2 = (v) => num(v).toFixed(2);

    drawRow(["#", "Worker", "Name", "Hours", "Customer", "Wage"], true);

    let totalHours = 0, totalCustomer = 0, totalWage = 0;

    rows.forEach((r, idx) => {
      const h = num(r.total_hours);
      const c = num(r.total_customer);
      const w = num(r.total_wage);

      totalHours += h;
      totalCustomer += c;
      totalWage += w;

      if (y > doc.page.height - doc.page.margins.bottom - 40) {
        doc.addPage();
        y = doc.page.margins.top;
        drawRow(["#", "Worker", "Name", "Hours", "Customer", "Wage"], true);
      }

      drawRow([String(idx + 1), String(r.worker_code || "-"), String(r.worker_name || "-"), fmt2(h), fmt2(c), fmt2(w)]);
    });

    doc.moveDown(1);
    doc.font("NotoSC").fontSize(10).text(
      `TOTAL Hours: ${fmt2(totalHours)}    TOTAL Customer: ${fmt2(totalCustomer)}    TOTAL Wage: ${fmt2(totalWage)}`,
      { align: "right" }
    );

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
        COALESCE(we.amount, 0) AS hours,
        COALESCE(we.customer_total, (COALESCE(we.customer_rate, 0) * COALESCE(we.amount, 0)), 0) AS fee
      FROM work_entries we
      LEFT JOIN jobs j ON j.id = we.job_id AND j.company_id = we.company_id
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
        SUM(COALESCE(we.customer_total, (COALESCE(we.customer_rate, 0) * COALESCE(we.amount, 0)), 0)) AS daily_sales
      FROM work_entries we
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

        COALESCE(we.amount, 0) AS hours,
        COALESCE(we.customer_total, (COALESCE(we.customer_rate, 0) * COALESCE(we.amount, 0)), 0) AS fee,
        COALESCE(we.wage_total, we.pay, 0) AS wage

      FROM work_entries we
      JOIN workers w ON w.id = we.worker_id
      LEFT JOIN jobs j ON j.id = we.job_id AND j.company_id = we.company_id
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

export default router;
