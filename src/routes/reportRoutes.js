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
    Number(user?.is_admin) === 1
      ? true
      : await hasPermission(userId, "REPORT_FILTER_PAYTYPE");

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

function formatDMYFromAny(v) {
  if (!v) return "";

  // If already a Date object
  if (v instanceof Date) {
    const d = String(v.getDate()).padStart(2, "0");
    const m = String(v.getMonth() + 1).padStart(2, "0");
    const y = v.getFullYear();
    return `${d}/${m}/${y}`;
  }

  // Convert to string
  const s = String(v);

  // ISO format: YYYY-MM-DD or YYYY-MM-DDTHH:mm:ss
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
    const [y, m, d] = s.slice(0, 10).split("-");
    return `${d}/${m}/${y}`;
  }

  // Fallback: return as-is
  return s;
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
    JOIN workers w ON w.id = we.worker_id AND w.company_id = we.company_id
    JOIN work_entry_jobs wej ON wej.work_entry_id = we.id
    LEFT JOIN jobs j ON j.id = wej.job_id AND j.company_id = we.company_id
  `;
}


function jobsLeftJoinSql() {
  return `
    LEFT JOIN jobs j ON j.id = wej.job_id AND j.company_id = we.company_id
  `;
}

async function getWorkerById({ companyId, workerId }) {
  try {
    const r = await db.query(
      `
      SELECT
        id,
        worker_code,
        COALESCE(worker_name, worker_english_name, '') AS worker_name
      FROM workers
      WHERE id = $1 AND company_id = $2
      `,
      [workerId, companyId]
    );

    return r.rows?.[0] || null;
  } catch (err) {
    console.error("getWorkerById error:", err);
    return null;
  }
}


function monthTitleFromRange(start, end) {
  // If range spans multiple months, still show end month like Access printouts commonly do.
  const m = String(end || start || "").slice(5, 7);
  const map = {
    "01": "1",
    "02": "2",
    "03": "3",
    "04": "4",
    "05": "5",
    "06": "6",
    "07": "7",
    "08": "8",
    "09": "9",
    "10": "10",
    "11": "11",
    "12": "12",
  };
  return `${map[m] || m} 月份工资结单`;
}

function isoKey(v) {
  if (!v) return "";
  if (v instanceof Date) return v.toISOString().slice(0, 10); // YYYY-MM-DD
  const s = String(v);
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  return s;
}


/* -----------------------------
   Worker Monthly Pays
------------------------------ */
async function queryWorkerMonthlyPays({ companyId, start, end, payFilter, jobNoFilter }) {
  const paySql = payWhereSql(payFilter);       // must use alias we
  const jobNoSql = jobNoWhereSql(jobNoFilter); // must use alias we

  // Safer numeric sort: if worker_code isn't a pure number, it won't crash
  const orderSql = `
    ORDER BY
      NULLIF(regexp_replace(w.worker_code, '\\D', '', 'g'), '')::int NULLS LAST,
      w.worker_code
  `;

  const sql = `
    SELECT
      w.worker_code AS worker_code,
      COALESCE(w.worker_name, w.worker_english_name, '') AS worker_name,

      SUM(COALESCE(wej.hours, 0)) AS total_hours,
      SUM(COALESCE(wej.customer_total, 0)) AS total_customer,
      SUM(COALESCE(wej.wage_total, wej.pay, 0)) AS total_wage,

      SUM(
        CASE WHEN COALESCE(we.is_bank,0) = 0
          THEN COALESCE(wej.wage_total, wej.pay, 0)
          ELSE 0
        END
      ) AS cash_wage,

      SUM(
        CASE WHEN COALESCE(we.is_bank,0) = 1
          THEN COALESCE(wej.wage_total, wej.pay, 0)
          ELSE 0
        END
      ) AS bank_wage

    ${baseFromJoinSql()}
    WHERE we.company_id = $1
      AND we.work_date >= $2::date
      AND we.work_date <= $3::date
      ${paySql}
      ${jobNoSql}
    GROUP BY w.worker_code, w.worker_name, w.worker_english_name
    ${orderSql}
  `;

  const r = await db.query(sql, [companyId, start, end]);
  return r.rows || [];
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

    // ✅ PostgreSQL: get company name
    let companyName = "";
    try {
      const r = await db.query("SELECT name FROM companies WHERE id = $1", [companyId]);
      companyName = String(r.rows?.[0]?.name || "").trim();
    } catch (e) {
      companyName = "";
    }

    // ✅ PostgreSQL: queryWorkerMonthlyPays must be the Postgres version (db.query + $1..)
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

    doc
      .fontSize(10)
      .fillColor("#555")
      .text(
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
      ? { code: 70, name: 160, hours: 60, cust: 90, wage: 80, cash: 90, bank: 110, v1: 60, v2: 60 }
      : { code: 75, name: 190, hours: 60, cust: 95, wage: 85, cash: 95, bank: 120 };

    const sumW = Object.values(col).reduce((s, w) => s + w, 0);
    if (sumW > pageW) {
      const scale = pageW / sumW;
      Object.keys(col).forEach((k) => {
        col[k] = Math.max(22, Math.floor(col[k] * scale));
      });
    }
    const diff = pageW - Object.values(col).reduce((s, w) => s + w, 0);
    col.name += diff;

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
      doc.text(String(text ?? ""), x + 4, y0 + 3, { width: w - 8, align, ellipsis: true });
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
    let totalHours = 0, totalCustomer = 0, totalWage = 0, totalCash = 0, totalBank = 0, totalV1 = 0, totalV2 = 0;

    rows.forEach((r) => {
      ensureRow();

      const h = num(r.total_hours);
      const c = num(r.total_customer);
      const w = num(r.total_wage);
      const cash = num(r.cash_wage);
      const bank = num(r.bank_wage);
      const v1 = showVouchers ? num(r.voucher1_wage) : 0;
      const v2 = showVouchers ? num(r.voucher2_wage) : 0;

      totalHours += h; totalCustomer += c; totalWage += w;
      totalCash += cash; totalBank += bank;
      totalV1 += v1; totalV2 += v2;

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

    drawCell({ text: "本月份总数", x, y0: y, w: col.code + col.name, bg }); x += col.code + col.name;
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
async function querySalesListing({ companyId, start, end, payFilter, jobNoFilter }) {
  const paySql = payWhereSql(payFilter); // uses alias we
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
    WHERE we.company_id = $1
      AND we.work_date >= $2::date
      AND we.work_date <= $3::date
      ${paySql}
      ${jobNoSql}
    ORDER BY
      we.work_date,
      NULLIF(we.job_no1,'')::int NULLS LAST,
      we.job_no1
  `;

  const daySql = `
    SELECT
      we.work_date AS work_date,
      SUM(COALESCE(wej.customer_total, 0)) AS daily_sales
    FROM work_entries we
    JOIN work_entry_jobs wej ON wej.work_entry_id = we.id
    WHERE we.company_id = $1
      AND we.work_date >= $2::date
      AND we.work_date <= $3::date
      ${paySql}
      ${jobNoSql}
    GROUP BY we.work_date
    ORDER BY we.work_date
  `;

  const [detail, days] = await Promise.all([
    db.query(detailSql, [companyId, start, end]),
    db.query(daySql, [companyId, start, end]),
  ]);

  return { rows: detail.rows || [], days: days.rows || [] };
}

router.get("/sales-listing", async (req, res) => {
  try {
    const companyId = Number(req.query.companyId || 1);
    const start = req.query.start;
    const end = req.query.end;

    const { canFilterPayType, payFilter } = await resolvePayFilter(req);
    const jobNoFilter = resolveJobNoFilter(req);

    if (!companyId || companyId <= 0) return res.status(400).json({ error: "Invalid companyId" });
    if (!isValidISODate(start) || !isValidISODate(end))
      return res.status(400).json({ error: "Invalid start/end date" });
    if (start > end) return res.status(400).json({ error: "Start date cannot be after end date" });

    const data = await querySalesListing({ companyId, start, end, payFilter, jobNoFilter });

    res.json({
      canFilterPayType,
      rows: (data.rows || []).map((r) => ({
        work_date: formatDMYFromAny(r.work_date), // DD/MM/YYYY
        bill_no: r.bill_no,
        job_desc: r.job_desc,
        hours: num(r.hours),
        fee: num(r.fee),
      })),
      days: (data.days || []).map((d) => ({
        work_date: formatDMYFromAny(d.work_date), // DD/MM/YYYY
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

    // ===== Title =====
    doc.fontSize(14).text("TWIN REFLEXOLOGY HEALING SDN BHD", { align: "center" });
    doc.moveDown(0.2);
    doc.fontSize(12).text("Daily Sales Report 每天生意记录", { align: "center" });
    doc.moveDown(0.4);
    doc.fontSize(10).fillColor("#555").text(`Date: ${formatDMY(start)} - ${formatDMY(end)}`, { align: "center" });
    doc.fillColor("#000");
    doc.moveDown(1);

    // ===== Group detail rows by day (IMPORTANT FIX: use isoKey) =====
    const byDate = new Map(); // key: YYYY-MM-DD
    (rows || []).forEach((r) => {
      const k = isoKey(r.work_date);
      if (!byDate.has(k)) byDate.set(k, []);
      byDate.get(k).push(r);
    });

    // ===== Layout =====
    const pageW = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    const startX = doc.page.margins.left;
    let y = doc.y;

    const col = { date: 80, bill: 70, job: 220, hours: 60, fee: 70 };
    const rowH = 16;
    const fmt2 = (v) => num(v).toFixed(2);

    const drawHeader = () => {
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

    const ensureSpace = (need = 30) => {
      if (y > doc.page.height - doc.page.margins.bottom - need) {
        doc.addPage();
        y = doc.page.margins.top;
        drawHeader(); // re-draw header on new page
      }
    };

    const drawRow = (r, showDate) => {
      ensureSpace(25);
      doc.font("NotoSC").fontSize(9).fillColor("#000");

      let x = startX;
      doc.text(showDate ? formatDMYFromAny(r.work_date) : "", x, y, { width: col.date }); x += col.date;
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

    // ===== Render =====
    drawHeader();

    let grand = 0;
    (days || []).forEach((d) => {
      const k = isoKey(d.work_date);
      const list = byDate.get(k) || [];
      const dayTotal = num(d.daily_sales);
      grand += dayTotal;

      list.forEach((r, idx) => drawRow(r, idx === 0));
      drawDailyTotal(dayTotal);

      y += 4;
      ensureSpace(30);
    });

    ensureSpace(30);
    doc.moveDown(0.5);
    doc.font("NotoSC").fontSize(10).fillColor("#000").text(`Grand Total: ${fmt2(grand)}`, { align: "right" });

    doc.end();
  } catch (err) {
    console.error("sales-listing pdf error:", err);
    res.status(500).send("Failed to generate PDF");
  }
});

// =============================
// Worker Job Listing (Postgres) + PDF 
// =============================

async function queryWorkerJobListing({ companyId, start, end, payFilter, jobNoFilter }) {
  const paySql = payWhereSql(payFilter);           // must use alias "we"
  const jobNoSql = jobNoWhereSql(jobNoFilter);     // must use alias "we"

  const sql = `
    SELECT
      w.id AS worker_id,
      w.worker_code AS worker_code,
      COALESCE(w.worker_name, w.worker_english_name, '') AS worker_name,

      we.work_date::date AS work_date,
      we.job_no1 AS bill_no,
      (COALESCE(j.job_code,'') || ' - ' || COALESCE(j.job_type,'')) AS job_desc,

      COALESCE(wej.hours, 0) AS hours,
      COALESCE(wej.customer_total, 0) AS fee,
      COALESCE(wej.wage_total, wej.pay, 0) AS wage
    FROM work_entries we
    JOIN workers w ON w.id = we.worker_id AND w.company_id = we.company_id
    JOIN work_entry_jobs wej ON wej.work_entry_id = we.id
    ${jobsLeftJoinSql()}
    WHERE we.company_id = $1
      AND we.work_date::date >= $2::date
      AND we.work_date::date <= $3::date
      ${paySql}
      ${jobNoSql}
    ORDER BY
      NULLIF(regexp_replace(COALESCE(w.worker_code,''), '\\D', '', 'g'), '')::int NULLS LAST,
      w.worker_code,
      we.work_date::date,
      NULLIF(regexp_replace(COALESCE(we.job_no1,''), '\\D', '', 'g'), '')::int NULLS LAST,
      we.job_no1,
      COALESCE(j.job_code,''),
      COALESCE(j.job_type,'')
  `;

  const r = await db.query(sql, [companyId, start, end]);
  return r.rows || [];
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
    (rows || []).forEach((r) => {
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
        work_date: formatDMYFromAny(r.work_date), // ✅ DD/MM/YYYY
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

    // group by worker (keep SQL order)
    const workers = [];
    const map = new Map();
    (rows || []).forEach((r) => {
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

    const fmt2 = (v) => num(v).toFixed(2);

    const drawReportTitle = () => {
      doc.font("NotoSC").fontSize(14).fillColor("#000").text("Worker Job Listing 技师工作记录", { align: "center" });
      doc.moveDown(0.2);
      doc
        .fontSize(10)
        .fillColor("#555")
        .text(`Company ID: ${companyId}    Date: ${formatDMY(start)} - ${formatDMY(end)}`, { align: "center" });
      doc.fillColor("#000");
      doc.moveDown(0.8);
    };

    const pageW = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    const x0 = doc.page.margins.left;

    // Columns (auto-fit)
    const col = { date: 70, bill: 70, job: 0, hours: 55, fee: 70, wage: 70 };
    col.job = pageW - (col.date + col.bill + col.hours + col.fee + col.wage);

    const bottomY = () => doc.page.height - doc.page.margins.bottom;

    const drawTableHeader = (y, fontSize, rowH) => {
      doc.save();
      doc.rect(x0, y - 2, pageW, rowH + 4).fill("#F2F2F2");
      doc.restore();

      doc.font("NotoSC").fontSize(fontSize).fillColor("#000");
      let x = x0;
      doc.text("日期", x, y, { width: col.date }); x += col.date;
      doc.text("单号", x, y, { width: col.bill }); x += col.bill;
      doc.text("工作项目", x, y, { width: col.job }); x += col.job;
      doc.text("钟点", x, y, { width: col.hours, align: "right" }); x += col.hours;
      doc.text("收费", x, y, { width: col.fee, align: "right" }); x += col.fee;
      doc.text("工资", x, y, { width: col.wage, align: "right" });

      return y + rowH;
    };

    const drawRow = (r, y, fontSize, rowH) => {
      doc.font("NotoSC").fontSize(fontSize).fillColor("#000");
      let x = x0;

      doc.text(formatDMYFromAny(r.work_date), x, y, { width: col.date }); x += col.date;
      doc.text(String(r.bill_no || "-"), x, y, { width: col.bill }); x += col.bill;
      doc.text(String(r.job_desc || "-"), x, y, { width: col.job, ellipsis: true }); x += col.job;
      doc.text(fmt2(r.hours), x, y, { width: col.hours, align: "right" }); x += col.hours;
      doc.text(fmt2(r.fee), x, y, { width: col.fee, align: "right" }); x += col.fee;
      doc.text(fmt2(r.wage), x, y, { width: col.wage, align: "right" });

      return y + rowH;
    };

    const drawWorkerTotal = (w, y, fontSize, rowH) => {
      doc.font("NotoSC").fontSize(fontSize).fillColor("#000");

      const leftW = col.date + col.bill + col.job;
      const xText = x0;
      const xHours = x0 + leftW;
      const xFee = xHours + col.hours;
      const xWage = xFee + col.fee;

      doc.text(
        `From ${formatDMY(start)} till ${formatDMY(end)}   ${w.worker_name || ""} 工资次数额`,
        xText,
        y,
        { width: leftW, align: "left", ellipsis: true }
      );
      doc.text(fmt2(w.total_hours), xHours, y, { width: col.hours, align: "right" });
      doc.text("", xFee, y, { width: col.fee, align: "right" });
      doc.text(fmt2(w.total_wage), xWage, y, { width: col.wage, align: "right" });

      return y + rowH;
    };

    const renderWorkerOnePage = (w, isFirst) => {
      if (!isFirst) doc.addPage();

      // Reset cursor to top area
      doc.font("NotoSC").fillColor("#000");
      let y = doc.page.margins.top;

      // Optional: show report title on every page (looks nicer)
      drawReportTitle();
      y = doc.y;

      // Worker header
      doc.font("NotoSC").fontSize(11).fillColor("#000").text(`${w.worker_code || ""}    ${w.worker_name || ""}`, x0, y);
      y += 18;

      // Auto-shrink to fit ONE page
      let rowH = 16;
      let fontSize = 9;

      const available =
        bottomY() -
        y -               // current y
        10 -              // breathing
        (rowH + 6);       // total row space

      const maxRowsAtCurrent = Math.floor(available / rowH) - 1; // -1 for header row
      const totalRowsNeeded = (w.rows || []).length;

      // shrink if too many
      while (totalRowsNeeded > maxRowsAtCurrent && rowH > 12) {
        rowH -= 1;
      }
      while (totalRowsNeeded > Math.floor(available / rowH) - 1 && fontSize > 7) {
        fontSize -= 1;
      }

      // Recompute after shrink
      const maxRows = Math.floor(available / rowH) - 1;

      // Table header
      y = drawTableHeader(y, fontSize, rowH);

      // Rows (truncate if still too many)
      const list = w.rows || [];
      const showList = list.slice(0, Math.max(0, maxRows));

      showList.forEach((r) => {
        y = drawRow(r, y, fontSize, rowH);
      });

      // If truncated, show note
      if (list.length > showList.length) {
        doc.font("NotoSC").fontSize(8).fillColor("#B00000");
        doc.text(`(More rows not shown: ${list.length - showList.length})`, x0, y + 2, {
          width: pageW,
          align: "left",
        });
        doc.fillColor("#000");
        y += 12;
      }

      // Total row
      y += 4;
      y = drawWorkerTotal(w, y, fontSize, rowH);
    };

    // Render
    workers.forEach((w, idx) => renderWorkerOnePage(w, idx === 0));

    doc.end();
  } catch (err) {
    console.error("account-worker-job-listing pdf error:", err);
    res.status(500).send("Failed to generate PDF");
  }
});



// =============================
// Monthly Summary (Postgres) + PDF
// =============================

async function queryMonthlySummary({ companyId, start, end, payFilter, jobNoFilter }) {
  const paySql = payWhereSql(payFilter);       // uses alias we
  const jobNoSql = jobNoWhereSql(jobNoFilter); // uses alias we

  const sql = `
    SELECT
      to_char(we.work_date::date, 'YYYY-MM') AS ym,

      SUM(CASE WHEN COALESCE(we.is_bank,0) = 1 THEN COALESCE(wej.customer_total,0) ELSE 0 END) AS bank_fee,
      SUM(CASE WHEN COALESCE(we.is_bank,0) = 0 THEN COALESCE(wej.customer_total,0) ELSE 0 END) AS cash_fee,
      SUM(COALESCE(wej.customer_total,0)) AS total_fee,

      SUM(CASE WHEN COALESCE(we.is_bank,0) = 1 THEN COALESCE(wej.wage_total, wej.pay, 0) ELSE 0 END) AS bank_wage,
      SUM(CASE WHEN COALESCE(we.is_bank,0) = 0 THEN COALESCE(wej.wage_total, wej.pay, 0) ELSE 0 END) AS cash_wage,
      SUM(COALESCE(wej.wage_total, wej.pay, 0)) AS total_wage,

      SUM(COALESCE(wej.hours,0)) AS total_hours
    FROM work_entries we
    JOIN work_entry_jobs wej ON wej.work_entry_id = we.id
    WHERE we.company_id = $1
      AND we.work_date::date >= $2::date
      AND we.work_date::date <= $3::date
      ${paySql}
      ${jobNoSql}
    GROUP BY to_char(we.work_date::date, 'YYYY-MM')
    ORDER BY to_char(we.work_date::date, 'YYYY-MM')
  `;

  const r = await db.query(sql, [companyId, start, end]);
  return r.rows || [];
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

    const out = rows.map((r) => {
      const hours = num(r.total_hours);
      const totalFee = num(r.total_fee);
      const totalWage = num(r.total_wage);

      const feeRate = hours > 0 ? totalFee / hours : 0;
      const wageRate = hours > 0 ? totalWage / hours : 0;
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
        pct,
      };
    });

    const totals = out.reduce(
      (acc, r) => {
        acc.bank_fee += r.bank_fee;
        acc.cash_fee += r.cash_fee;
        acc.total_fee += r.total_fee;

        acc.bank_wage += r.bank_wage;
        acc.cash_wage += r.cash_wage;
        acc.total_wage += r.total_wage;

        acc.total_hours += r.total_hours;
        return acc;
      },
      {
        bank_fee: 0,
        cash_fee: 0,
        total_fee: 0,
        bank_wage: 0,
        cash_wage: 0,
        total_wage: 0,
        total_hours: 0,
      }
    );

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

    const rows = rowsRaw.map((r) => {
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

    const totals = rows.reduce(
      (acc, r) => {
        acc.bank_fee += r.bank_fee;
        acc.cash_fee += r.cash_fee;
        acc.total_fee += r.total_fee;
        acc.bank_wage += r.bank_wage;
        acc.cash_wage += r.cash_wage;
        acc.total_wage += r.total_wage;
        acc.total_hours += r.total_hours;
        return acc;
      },
      {
        bank_fee: 0,
        cash_fee: 0,
        total_fee: 0,
        bank_wage: 0,
        cash_wage: 0,
        total_wage: 0,
        total_hours: 0,
      }
    );

    totals.fee_rate = totals.total_hours > 0 ? totals.total_fee / totals.total_hours : 0;
    totals.wage_rate = totals.total_hours > 0 ? totals.total_wage / totals.total_hours : 0;
    totals.pct = totals.total_fee > 0 ? (totals.total_wage / totals.total_fee) * 100 : 0;

    const filename = `Monthly_Summary_${companyId}_${start}_to_${end}.pdf`;
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="${filename}"`);

    // company name (pg)
    let companyName = "";
    try {
      const c = await db.query(`SELECT name FROM companies WHERE id = $1`, [companyId]);
      companyName = String(c.rows?.[0]?.name || "").trim();
    } catch (e) {
      companyName = "";
    }

    const doc = new PDFDocument({ size: "A4", margin: 36 });
    doc.pipe(res);

    const fontPath = path.join(__dirname, "../../fonts/NotoSansSC-Regular.ttf");
    doc.registerFont("NotoSC", fontPath);
    doc.font("NotoSC");

    // ===== Title =====
    doc.fontSize(16).text(`${companyName || "Company"} - MONTHLY REPORTS`, { align: "center" });
    doc.moveDown(0.4);
    doc
      .fontSize(10)
      .fillColor("#555")
      .text(`Company ID: ${companyId}    Date: ${formatDMY(start)} - ${formatDMY(end)}`, {
        align: "center",
      });
    doc.fillColor("#000");
    doc.moveDown(1);

    const fmt2 = (v) => num(v).toFixed(2);

    // ===== Columns =====
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

    const totalW = Object.values(col).reduce((s, n) => s + n, 0);
    const scale = totalW > pageW ? pageW / totalW : 1;
    Object.keys(col).forEach((k) => (col[k] = Math.floor(col[k] * scale)));

    let y = doc.y;
    const rowH = 18;

    const monthLabel = (ym) => {
      const [Y, M] = String(ym).split("-");
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
      return `${map[M] || ym} ${Y || ""}`.trim();
    };

    const drawHeader = () => {
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

    const ensureSpace = (need = 40) => {
      if (y > doc.page.height - doc.page.margins.bottom - need) {
        doc.addPage();
        y = doc.page.margins.top;
        drawHeader(); // IMPORTANT: header per page
      }
    };

    const drawRow = (r, isTotal = false) => {
      ensureSpace(40);

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

    // ===== Render =====
    drawHeader();
    rows.forEach((r) => drawRow(r, false));
    drawRow({ ym: "", ...totals }, true);

    doc.end();
  } catch (err) {
    console.error("monthly-summary pdf error:", err);
    res.status(500).send("Failed to generate PDF");
  }
});


// =============================
// Worker Payslip (Postgres) + PDFs
// =============================

async function queryWorkerPayslipLines({ companyId, workerId, start, end, payFilter, jobNoFilter }) {
  const paySql = payWhereSql(payFilter);         // uses alias we
  const jobNoSql = jobNoWhereSql(jobNoFilter);   // uses alias we

  const sql = `
    SELECT
      we.work_date::date AS work_date,
      we.job_no1 AS bill_no,

      COALESCE(j.job_code, '') AS job_code,
      COALESCE(j.job_type, '') AS job_type,

      COALESCE(wej.hours, 0) AS hours,
      COALESCE(wej.customer_total, 0) AS fee,
      COALESCE(wej.wage_total, wej.pay, 0) AS wage
    FROM work_entries we
    JOIN work_entry_jobs wej ON wej.work_entry_id = we.id
    LEFT JOIN jobs j ON j.id = wej.job_id AND j.company_id = we.company_id
    WHERE we.company_id = $1
      AND we.worker_id = $2
      AND we.work_date::date >= $3::date
      AND we.work_date::date <= $4::date
      ${paySql}
      ${jobNoSql}
    ORDER BY
      we.work_date::date,
      (NULLIF(TRIM(we.job_no1), '')::int) NULLS LAST,
      we.job_no1,
      COALESCE(j.job_code,''),
      COALESCE(j.job_type,'')
  `;

  const r = await db.query(sql, [companyId, workerId, start, end]);
  return r.rows || [];
}

async function queryWorkerPayslipLinesGrouped({
  companyId,
  workerId,
  start,
  end,
  payFilter,
  jobNoFilter,
}) {
  const paySql = payWhereSql(payFilter);       // uses alias we
  const jobNoSql = jobNoWhereSql(jobNoFilter); // uses alias we

  const sql = `
    SELECT
      wej.job_id AS job_id,
      COALESCE(j.job_code, '') AS job_code,
      COALESCE(j.job_type, '') AS job_type,
      SUM(COALESCE(wej.hours, 0)) AS hours,
      SUM(COALESCE(wej.customer_total, 0)) AS fee,
      SUM(COALESCE(wej.wage_total, wej.pay, 0)) AS wage
    FROM work_entries we
    JOIN work_entry_jobs wej ON wej.work_entry_id = we.id
    LEFT JOIN jobs j ON j.id = wej.job_id AND j.company_id = we.company_id
    WHERE we.company_id = $1
      AND we.worker_id = $2
      AND we.work_date::date >= $3::date
      AND we.work_date::date <= $4::date
      ${paySql}
      ${jobNoSql}
    GROUP BY
      wej.job_id,
      j.job_code,
      j.job_type
    ORDER BY
      COALESCE(j.job_code,''),
      COALESCE(j.job_type,''),
      COALESCE(wej.job_id, 0)
  `;

  const r = await db.query(sql, [companyId, workerId, start, end]);
  return r.rows || [];
}

async function getWorkerByIdPg({ companyId, workerId }) {
  try {
    const r = await db.query(
      `SELECT id, worker_code,
              COALESCE(worker_name, worker_english_name, '') AS worker_name
       FROM workers
       WHERE id = $1 AND company_id = $2`,
      [workerId, companyId]
    );
    return r.rows?.[0] || null;
  } catch {
    return null;
  }
}

function parseWorkerIdsFromQuery(req) {
  // Accept:
  // - workerId=3
  // - workerIds=1,2,3
  // - workerIds[]=1&workerIds[]=2 (optional)
  const one = String(req.query.workerId || "").trim();
  const listRaw =
    req.query.workerIds ??
    req.query["workerIds[]"] ??
    (one ? one : "");

  const arr = Array.isArray(listRaw) ? listRaw : String(listRaw).split(",");
  const ids = arr
    .map((x) => Number(String(x).trim()))
    .filter((n) => Number.isFinite(n) && n > 0);

  // de-dupe keep order
  const out = [];
  const seen = new Set();
  for (const id of ids) {
    if (!seen.has(id)) {
      seen.add(id);
      out.push(id);
    }
  }
  return out;
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

    const worker = await getWorkerByIdPg({ companyId, workerId });
    if (!worker) return res.status(404).json({ error: "Worker not found." });

    // ✅ Preview uses grouped rows (same as PDF)
    const rowsRaw = await queryWorkerPayslipLinesGrouped({
      companyId,
      workerId,
      start,
      end,
      payFilter,
      jobNoFilter,
    });

    const rows = (rowsRaw || []).map((r) => ({
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

    res.json({
      canFilterPayType,
      worker: { id: worker.id, worker_code: worker.worker_code, worker_name: worker.worker_name },
      title: monthTitleFromRange(start, end),
      rows,
      totals,
    });
  } catch (err) {
    console.error("worker-payslip error:", err);
    res.status(500).json({ error: "Failed to generate report" });
  }
});

router.get("/worker-payslip/pdf", async (req, res) => {
  try {
    const companyId = Number(req.query.companyId || 1);
    const start = req.query.start;
    const end = req.query.end;

    const workerIds = parseWorkerIdsFromQuery(req);

    const { payFilter } = await resolvePayFilter(req);
    const jobNoFilter = resolveJobNoFilter(req);

    if (!companyId || companyId <= 0) return res.status(400).send("Invalid companyId");
    if (!workerIds.length) return res.status(400).send("Please select at least one worker.");
    if (!isValidISODate(start) || !isValidISODate(end))
      return res.status(400).send("Invalid start/end date (use YYYY-MM-DD)");
    if (start > end) return res.status(400).send("Start date cannot be after end date");

    // company name
    let companyName = "";
    try {
      const c = await db.query(`SELECT name FROM companies WHERE id = $1`, [companyId]);
      companyName = String(c.rows?.[0]?.name || "").trim();
    } catch {
      companyName = "";
    }

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

    const titleCn = monthTitleFromRange(start, end);

    const filename = `Worker_Payslip_${workerIds.join("-")}_${start}_to_${end}.pdf`;
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="${filename}"`);

    const doc = new PDFDocument({ size: "A4", margin: 50 });
    doc.pipe(res);

    const fontPath = path.join(__dirname, "../../fonts/NotoSansSC-Regular.ttf");
    doc.registerFont("NotoSC", fontPath);
    doc.font("NotoSC");

    const fmt2 = (v) => num(v).toFixed(2);

    const renderOneWorker = async (workerId, isFirstPage) => {
      const worker = await getWorkerByIdPg({ companyId, workerId });
      if (!worker) return; // skip missing worker id silently

      const grouped = await queryWorkerPayslipLinesGrouped({
        companyId,
        workerId,
        start,
        end,
        payFilter,
        jobNoFilter,
      });

      const rows = (grouped || []).map((r) => ({
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

      if (!isFirstPage) doc.addPage();

      // ===== Header =====
      doc.font("NotoSC").fontSize(14).fillColor("#000").text(titleCn, { align: "center" });
      doc.moveDown(0.6);

      doc.fontSize(10).text(`${worker.worker_code || ""}    ${worker.worker_name || ""}`, { align: "left" });
      doc.moveDown(0.4);

      // ===== Table =====
      const pageW = doc.page.width - doc.page.margins.left - doc.page.margins.right;
      const x0 = doc.page.margins.left;
      let y = doc.y;

      const rowH = 16;

      const col = {
        job: Math.floor(pageW * 0.60),
        hours: Math.floor(pageW * 0.13),
        fee: Math.floor(pageW * 0.14),
        wage: Math.floor(pageW * 0.13),
      };

      const tableRight = x0 + pageW;
      const tableBottomLimit = () => doc.page.height - doc.page.margins.bottom - 230; // footer space

      const drawCell = (text, x, y0, w, align = "left") => {
        doc.save();
        doc.lineWidth(0.6).strokeColor("#999");
        doc.rect(x, y0, w, rowH).stroke();
        doc.restore();

        doc.font("NotoSC").fontSize(9).fillColor("#000");
        const padX = 4;
        const padY = 4;

        doc.text(String(text ?? ""), x + padX, y0 + padY, {
          width: w - padX * 2,
          align,
          ellipsis: true,
        });
      };

      const drawTableHeader = () => {
        doc.save();
        doc.rect(x0, y, pageW, rowH).fill("#F3D7B5");
        doc.restore();

        let x = x0;
        drawCell("项目", x, y, col.job, "center"); x += col.job;
        drawCell("时钟", x, y, col.hours, "center"); x += col.hours;
        drawCell("收费", x, y, col.fee, "center"); x += col.fee;
        drawCell("工资", x, y, col.wage, "center");
        y += rowH;
      };

      const ensureRowSpace = () => {
        if (y + rowH > tableBottomLimit()) {
          doc.addPage();
          y = doc.page.margins.top;
          // re-print title + worker line on continued pages (optional, looks nicer)
          doc.font("NotoSC").fontSize(12).fillColor("#000").text(titleCn, { align: "center" });
          doc.moveDown(0.3);
          doc.fontSize(10).text(`${worker.worker_code || ""}    ${worker.worker_name || ""}`, { align: "left" });
          doc.moveDown(0.4);
          y = doc.y;
          drawTableHeader();
        }
      };

      drawTableHeader();

      rows.forEach((r) => {
        ensureRowSpace();
        let x = x0;
        drawCell(r.job_desc, x, y, col.job, "left"); x += col.job;
        drawCell(fmt2(r.hours), x, y, col.hours, "right"); x += col.hours;
        drawCell(fmt2(r.fee), x, y, col.fee, "right"); x += col.fee;
        drawCell(fmt2(r.wage), x, y, col.wage, "right");
        y += rowH;
      });

      // TOTAL row
      ensureRowSpace();
      doc.save();
      doc.rect(x0, y, pageW, rowH).fill("#FFF3CD");
      doc.restore();

      let x = x0;
      drawCell("TOTAL", x, y, col.job, "left"); x += col.job;
      drawCell(fmt2(totals.total_hours), x, y, col.hours, "right"); x += col.hours;
      drawCell("", x, y, col.fee, "right"); x += col.fee;
      drawCell(fmt2(totals.total_wage), x, y, col.wage, "right");
      y += rowH;

      // ===== Divider =====
      const dividerY = Math.max(y + 18, doc.page.height - doc.page.margins.bottom - 210);
      doc.save();
      doc.strokeColor("#2C7BE5");
      doc.lineWidth(1);
      doc.dash(2, { space: 2 });
      doc.moveTo(x0, dividerY).lineTo(tableRight, dividerY).stroke();
      doc.undash();
      doc.restore();

      // ===== Footer =====
      const footerTop = dividerY + 20;

      doc.fontSize(12).fillColor("#000");
      doc.text((companyName || "DEFAULT COMPANY").toUpperCase(), x0, footerTop, {
        width: pageW,
        align: "center",
      });

      doc.fontSize(9).fillColor("#000");
      doc.text(`${formatDMY(start)}   till   ${formatDMY(end)}`, x0, footerTop + 18, {
        width: pageW,
        align: "center",
      });

      const leftX = x0;
      const rightX = x0 + Math.floor(pageW * 0.58);
      const blockY = footerTop + 55;

      const leftW = Math.floor(pageW * 0.56);
      const rightW = pageW - (rightX - x0);

      const monthOf = monthYearLabel(end);

      doc.fontSize(9).fillColor("#000");
      doc.text(`Worker wages for the month of  :    ${monthOf}`, leftX, blockY, {
        width: leftW,
        align: "left",
      });
      doc.text(`I am hereby acknowledging the receipts of my wages`, leftX, blockY + 14, {
        width: leftW,
        align: "left",
      });
      doc.text(`amounting to RM ${fmt2(totals.total_wage)}`, leftX, blockY + 28, {
        width: leftW,
        align: "left",
      });

      doc.text(`签名：  ______________________________`, rightX, blockY + 28, {
        width: rightW,
        align: "left",
      });

      doc.text(`编号： ${worker.worker_code || ""}    ${worker.worker_name || ""}`, rightX, blockY + 55, {
        width: rightW,
        align: "left",
      });
    };

    // render in order, one worker per page
    let printed = 0;
    for (const wid of workerIds) {
      await renderOneWorker(wid, printed === 0);
      printed += 1;
    }

    doc.end();
  } catch (err) {
    console.error("worker-payslip pdf error:", err);
    res.status(500).send("Failed to generate PDF");
  }
});


export default router;
