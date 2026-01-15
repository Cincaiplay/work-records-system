// public/js/reports.js
let selectedReport = null;

// read permission flag from <body data-can-filter-paytype="1|0">
window.CAN_FILTER_PAYTYPE = document.body?.dataset?.canFilterPaytype === "1";

// Which reports support pay type filter?
const PAY_FILTER_REPORTS = new Set([
  "worker-monthly-pays",
  "sales-listing",
  "account-worker-job-listing",
  "monthly-summary", // ✅ add this
  "worker-payslip",
]);

/* -----------------------------
   Helpers
------------------------------ */
function getCompanyIdSafe() {
  return typeof getCurrentCompanyId === "function"
    ? (getCurrentCompanyId() || 1)
    : 1;
}

function setDefaultDates() {
  const startEl = document.getElementById("reportStartDate");
  const endEl = document.getElementById("reportEndDate");
  if (!startEl || !endEl) return;

  const today = new Date();
  const yyyy = today.getFullYear();
  const mm = String(today.getMonth() + 1).padStart(2, "0");

  const first = `${yyyy}-${mm}-01`;
  const last = new Date(yyyy, today.getMonth() + 1, 0);
  const lastStr = `${yyyy}-${mm}-${String(last.getDate()).padStart(2, "0")}`;

  if (!startEl.value) startEl.value = first;
  if (!endEl.value) endEl.value = lastStr;
}

function showOrHidePayFilters(reportKey) {
  const payBox = document.getElementById("payTypeFilters");
  if (!payBox) return;

  const can = window.CAN_FILTER_PAYTYPE === true;
  const shouldShow = can && PAY_FILTER_REPORTS.has(reportKey);
  payBox.style.display = shouldShow ? "" : "none";
}

function getPayTypeQuery() {
  // If no permission -> don’t send (backend will force BANK_ONLY)
  if (window.CAN_FILTER_PAYTYPE !== true) return "";

  const cash = document.getElementById("filterCash")?.checked ? 1 : 0;
  const bank = document.getElementById("filterBank")?.checked ? 1 : 0;
  return `&cash=${cash}&bank=${bank}`;
}

// ✅ JobNo filter query:
// - both checked => &jobno1=1&jobno2=1 (backend returns all)
// - only jobno2 => &jobno1=0&jobno2=1 (must have job_no2)
// - only jobno1 => &jobno1=1&jobno2=0 (must have NO job_no2)
function getJobNoQuery() {
  const j1El = document.getElementById("filterJobNo1");
  const j2El = document.getElementById("filterJobNo2");

  // If your HTML is not added / ids mismatch, DO NOT break reports
  if (!j1El || !j2El) return "";

  const j1 = j1El.checked ? 1 : 0;
  const j2 = j2El.checked ? 1 : 0;
  return `&jobno1=${j1}&jobno2=${j2}`;
}

// ✅ No auto preview (only normalize to prevent both unchecked)
function wireJobNoFilterRules() {
  const j1 = document.getElementById("filterJobNo1");
  const j2 = document.getElementById("filterJobNo2");
  if (!j1 || !j2) return;

  const normalize = () => {
    // If none checked, force BOTH (show all)
    if (!j1.checked && !j2.checked) {
      j1.checked = true;
      j2.checked = true;
    }
  };

  // normalize once on load so query is never 0/0
  normalize();

  j1.addEventListener("change", normalize);
  j2.addEventListener("change", normalize);
}

async function loadWorkersIntoSelect() {
  const sel = document.getElementById("reportWorkerId");
  if (!sel) return;

  const companyId = getCompanyIdSafe();
  const res = await fetch(`/api/workers?companyId=${companyId}`);
  const data = await res.json().catch(() => ({}));

  const list = Array.isArray(data) ? data : (data.workers || data.rows || []);
  sel.innerHTML = `<option value="">-- Select Worker --</option>`;

  list.forEach(w => {
    const id = w.id;
    const code = w.worker_code || "";
    const name = w.worker_name || w.worker_english_name || "";
    const label = `${code} ${name}`.trim() || `Worker ${id}`;
    const opt = document.createElement("option");
    opt.value = String(id);
    opt.textContent = label;
    sel.appendChild(opt);
  });
}

function showOrHideWorkerPicker(reportKey) {
  const box = document.getElementById("workerPickerBox");
  if (!box) return;
  const show = reportKey === "worker-payslip";
  box.style.display = show ? "" : "none";
  if (show) loadWorkersIntoSelect();
}


/* -----------------------------
   Report selection
------------------------------ */
function selectReport(key, label) {
  selectedReport = key;

  showOrHidePayFilters(key);
  showOrHideWorkerPicker(key);

  const titleEl = document.getElementById("reportTitle");
  const subEl = document.getElementById("reportSubtitle");
  const controlsEl = document.getElementById("reportControls");
  const contentEl = document.getElementById("reportContent");

  if (titleEl) titleEl.textContent = label;
  if (subEl) subEl.textContent = "Select date range, preview, or export PDF.";
  if (controlsEl) controlsEl.style.display = "";

  setDefaultDates();

  if (contentEl) {
    contentEl.innerHTML =
      `<div class="text-muted small">Click <strong>Preview</strong> to generate the report.</div>`;
  }
}

function monthLabel(ym) {
  // ym = "YYYY-MM"
  const [Y, M] = String(ym || "").split("-");
  const map = {
    "01":"January","02":"February","03":"March","04":"April","05":"May","06":"June",
    "07":"July","08":"August","09":"September","10":"October","11":"November","12":"December",
  };
  return `${map[M] || ym} ${Y || ""}`.trim();
}

/* -----------------------------
   Render helpers
------------------------------ */
function fmt(n) {
  return Number(n || 0).toFixed(2);
}

function renderWorkerMonthlyPaysTable(rows, meta) {
  if (!rows || rows.length === 0)
    return `<div class="text-muted">No data found for selected date range.</div>`;

  const totalHours = rows.reduce((s, r) => s + Number(r.total_hours || 0), 0);
  const totalCustomer = rows.reduce((s, r) => s + Number(r.total_customer || 0), 0);
  const totalWage = rows.reduce((s, r) => s + Number(r.total_wage || 0), 0);
  const totalCash = rows.reduce((s, r) => s + Number(r.cash_wage || 0), 0);
  const totalBank = rows.reduce((s, r) => s + Number(r.bank_wage || 0), 0);

  const title = `
    <div class="mb-3">
      <div class="fw-bold">Worker Monthly Pays 工资结单</div>
      <div class="text-muted small">${meta.startDate} to ${meta.endDate}</div>
    </div>
  `;

  const table = `
    <div class="table-responsive">
      <table class="table table-sm table-hover align-middle">
        <thead class="table-primary small text-uppercase">
          <tr>
            <th style="width:50px;">#</th>
            <th style="width:110px;">Worker Code</th>
            <th>Worker Name</th>
            <th class="text-end" style="width:110px;">Hours</th>
            <th class="text-end" style="width:140px;">Customer Total</th>
            <th class="text-end" style="width:90px;">Wage Total</th>
            <th class="text-end" style="width:130px;">Cash Wage</th>
            <th class="text-end" style="width:150px;">Bank/Transfer Wage</th>
          </tr>
        </thead>

        <tbody>
          ${rows.map((r, i) => `
            <tr>
              <td>${i + 1}</td>
              <td>${r.worker_code || "-"}</td>
              <td>${r.worker_name || "-"}</td>
              <td class="text-end">${fmt(r.total_hours)}</td>
              <td class="text-end">${fmt(r.total_customer)}</td>
              <td class="text-end fw-semibold">${fmt(r.total_wage)}</td>
              <td class="text-end">${fmt(r.cash_wage)}</td>
              <td class="text-end">${fmt(r.bank_wage)}</td>
            </tr>
          `).join("")}
        </tbody>

        <tfoot>
          <tr class="fw-bold">
            <td colspan="3" class="text-end">TOTAL</td>
            <td class="text-end">${fmt(totalHours)}</td>
            <td class="text-end">${fmt(totalCustomer)}</td>
            <td class="text-end">${fmt(totalWage)}</td>
            <td class="text-end">${fmt(totalCash)}</td>
            <td class="text-end">${fmt(totalBank)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  `;

  return title + table;
}


function renderSalesListingHtml(data, meta) {
  const rows = data?.rows || [];
  const days = data?.days || [];
  if (!rows.length) return `<div class="text-muted">No data found for selected date range.</div>`;

  const byDate = new Map();
  rows.forEach((r) => {
    const k = r.work_date;
    if (!byDate.has(k)) byDate.set(k, []);
    byDate.get(k).push(r);
  });

  let html = `
    <div class="mb-3">
      <div class="fw-bold">Daily Sales Report 每天生意记录</div>
      <div class="text-muted small">${meta.startDate} to ${meta.endDate}</div>
    </div>
  `;

  days.forEach((d) => {
    const list = byDate.get(d.work_date) || [];
    const dayTotal = Number(d.daily_sales || 0);

    html += `
      <div class="d-flex justify-content-between align-items-center mt-3 mb-1">
        <div class="fw-semibold">${d.work_date}</div>
        <div class="text-danger fw-semibold">Daily Sales: ${fmt(dayTotal)}</div>
      </div>

      <div class="table-responsive">
        <table class="table table-sm table-hover align-middle">
          <thead class="table-primary small text-uppercase">
            <tr>
              <th style="width:110px;">Bill No</th>
              <th>Job</th>
              <th class="text-end" style="width:90px;">Hour</th>
              <th class="text-end" style="width:110px;">Fee</th>
            </tr>
          </thead>
          <tbody>
            ${list.map((r) => `
              <tr>
                <td>${r.bill_no || "-"}</td>
                <td>${r.job_desc || "-"}</td>
                <td class="text-end">${fmt(r.hours)}</td>
                <td class="text-end">${fmt(r.fee)}</td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>
    `;
  });

  const grand = days.reduce((s, x) => s + Number(x.daily_sales || 0), 0);
  html += `<div class="text-end fw-bold mt-3">Grand Total: ${fmt(grand)}</div>`;
  return html;
}

function renderWorkerJobListingHtml(data, meta) {
  const workers = data?.workers || [];
  if (!workers.length) return `<div class="text-muted">No data found for selected date range.</div>`;

  let html = `
    <div class="mb-3">
      <div class="fw-bold">Worker Job Listing 技师工作记录</div>
      <div class="text-muted small">${meta.startDate} to ${meta.endDate}</div>
    </div>
  `;

  workers.forEach((w) => {
    const rows = w.rows || [];
    html += `
      <div class="mt-4 mb-2">
        <div class="fw-semibold">
          ${w.worker_code || "-"} ${w.worker_name ? " - " + w.worker_name : ""}
        </div>
      </div>

      <div class="table-responsive">
        <table class="table table-sm table-hover align-middle">
          <thead class="table-light small text-uppercase">
            <tr>
              <th style="width:110px;">Date</th>
              <th style="width:110px;">Bill No</th>
              <th>Job</th>
              <th class="text-end" style="width:90px;">Hours</th>
              <th class="text-end" style="width:110px;">Fee</th>
              <th class="text-end" style="width:110px;">Wage</th>
            </tr>
          </thead>
          <tbody>
            ${rows.map((r) => `
              <tr>
                <td>${r.work_date || "-"}</td>
                <td>${r.bill_no || "-"}</td>
                <td>${r.job_desc || "-"}</td>
                <td class="text-end">${fmt(r.hours)}</td>
                <td class="text-end">${fmt(r.fee)}</td>
                <td class="text-end">${fmt(r.wage)}</td>
              </tr>
            `).join("")}
          </tbody>
          <tfoot>
            <tr class="fw-bold">
              <td colspan="3" class="text-end">TOTAL</td>
              <td class="text-end">${fmt(w.total_hours)}</td>
              <td class="text-end">${fmt(w.total_fee)}</td>
              <td class="text-end">${fmt(w.total_wage)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    `;
  });

  return html;
}


/* -----------------------------
   API calls
------------------------------ */
async function previewWorkerMonthlyPays() {
  const companyId = getCompanyIdSafe();
  const startDate = document.getElementById("reportStartDate")?.value || "";
  const endDate = document.getElementById("reportEndDate")?.value || "";
  if (!startDate || !endDate) return alert("Please select start and end date.");

  document.getElementById("reportContent").innerHTML =
    `<div class="text-muted small">Loading...</div>`;

  const qs = getPayTypeQuery() + getJobNoQuery();
  const url = `/api/reports/worker-monthly-pays?companyId=${companyId}&start=${startDate}&end=${endDate}${qs}`;

  const res = await fetch(url);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return alert(data?.error || "Failed to generate report.");

  document.getElementById("reportContent").innerHTML =
    renderWorkerMonthlyPaysTable(data.rows || [], { startDate, endDate });
}

function exportWorkerMonthlyPaysPdf() {
  const companyId = getCompanyIdSafe();
  const startDate = document.getElementById("reportStartDate")?.value || "";
  const endDate = document.getElementById("reportEndDate")?.value || "";
  if (!startDate || !endDate) return alert("Please select start and end date.");

  const qs = getPayTypeQuery() + getJobNoQuery();
  window.open(
    `/api/reports/worker-monthly-pays/pdf?companyId=${companyId}&start=${startDate}&end=${endDate}${qs}`,
    "_blank"
  );
}

async function previewSalesListing() {
  const companyId = getCompanyIdSafe();
  const startDate = document.getElementById("reportStartDate")?.value || "";
  const endDate = document.getElementById("reportEndDate")?.value || "";
  if (!startDate || !endDate) return alert("Please select start and end date.");

  document.getElementById("reportContent").innerHTML =
    `<div class="text-muted small">Loading...</div>`;

  const qs = getPayTypeQuery() + getJobNoQuery();
  const url = `/api/reports/sales-listing?companyId=${companyId}&start=${startDate}&end=${endDate}${qs}`;

  const res = await fetch(url);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return alert(data?.error || "Failed to generate report.");

  document.getElementById("reportContent").innerHTML =
    renderSalesListingHtml(data, { startDate, endDate });
}

function exportSalesListingPdf() {
  const companyId = getCompanyIdSafe();
  const startDate = document.getElementById("reportStartDate")?.value || "";
  const endDate = document.getElementById("reportEndDate")?.value || "";
  if (!startDate || !endDate) return alert("Please select start and end date.");

  const qs = getPayTypeQuery() + getJobNoQuery();
  window.open(
    `/api/reports/sales-listing/pdf?companyId=${companyId}&start=${startDate}&end=${endDate}${qs}`,
    "_blank"
  );
}

async function previewWorkerJobListing() {
  const companyId = getCompanyIdSafe();
  const startDate = document.getElementById("reportStartDate")?.value || "";
  const endDate = document.getElementById("reportEndDate")?.value || "";
  if (!startDate || !endDate) return alert("Please select start and end date.");

  document.getElementById("reportContent").innerHTML =
    `<div class="text-muted small">Loading...</div>`;

  const qs = getPayTypeQuery() + getJobNoQuery();
  const url = `/api/reports/account-worker-job-listing?companyId=${companyId}&start=${startDate}&end=${endDate}${qs}`;

  const res = await fetch(url);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return alert(data?.error || "Failed to generate report.");

  document.getElementById("reportContent").innerHTML =
    renderWorkerJobListingHtml(data, { startDate, endDate });
}

function exportWorkerJobListingPdf() {
  const companyId = getCompanyIdSafe();
  const startDate = document.getElementById("reportStartDate")?.value || "";
  const endDate = document.getElementById("reportEndDate")?.value || "";
  if (!startDate || !endDate) return alert("Please select start and end date.");

  const qs = getPayTypeQuery() + getJobNoQuery();
  window.open(
    `/api/reports/account-worker-job-listing/pdf?companyId=${companyId}&start=${startDate}&end=${endDate}${qs}`,
    "_blank"
  );
}

function renderMonthlySummaryHtml(rows, totals) {
  if (!rows || rows.length === 0) {
    return `<div class="text-muted">No data found for selected date range.</div>`;
  }

  const t = totals || {};
  const fmt2 = (n) => Number(n || 0).toFixed(2);

  const rowHtml = rows.map(r => `
    <tr>
      <td class="text-primary">${monthLabel(r.ym)}</td>

      <td class="text-end text-danger">${fmt2(r.bank_fee)}</td>
      <td class="text-end text-success">${fmt2(r.cash_fee)}</td>
      <td class="text-end fw-semibold">${fmt2(r.total_fee)}</td>

      <td class="text-end text-danger">${fmt2(r.bank_wage)}</td>
      <td class="text-end text-success">${fmt2(r.cash_wage)}</td>
      <td class="text-end fw-semibold">${fmt2(r.total_wage)}</td>

      <td class="text-end" style="color:#a85b00;">${fmt2(r.total_hours)}</td>
      <td class="text-end" style="color:#a85b00;">${fmt2(r.fee_rate)}</td>
      <td class="text-end" style="color:#a85b00;">${fmt2(r.wage_rate)}</td>
      <td class="text-end text-primary">${fmt2(r.pct)}</td>
    </tr>
  `).join("");

  const totalHtml = `
    <tr class="table-warning">
      <td class="fw-bold">TOTAL 总数</td>

      <td class="text-end fw-bold text-danger">${fmt2(t.bank_fee)}</td>
      <td class="text-end fw-bold text-success">${fmt2(t.cash_fee)}</td>
      <td class="text-end fw-bold">${fmt2(t.total_fee)}</td>

      <td class="text-end fw-bold text-danger">${fmt2(t.bank_wage)}</td>
      <td class="text-end fw-bold text-success">${fmt2(t.cash_wage)}</td>
      <td class="text-end fw-bold">${fmt2(t.total_wage)}</td>

      <td class="text-end fw-bold" style="color:#a85b00;">${fmt2(t.total_hours)}</td>
      <td class="text-end fw-bold" style="color:#a85b00;">${fmt2(t.fee_rate)}</td>
      <td class="text-end fw-bold" style="color:#a85b00;">${fmt2(t.wage_rate)}</td>
      <td class="text-end fw-bold text-primary">${fmt2(t.pct)}</td>
    </tr>
  `;

  return `
    <div class="table-responsive">
      <table class="table table-sm align-middle">
        <thead class="table-light">
          <tr>
            <th>月份</th>

            <th class="text-end">收费 银行户口</th>
            <th class="text-end">收费 现金户口</th>
            <th class="text-end">收费 总收费</th>

            <th class="text-end">工资 银行工资</th>
            <th class="text-end">工资 现金工资</th>
            <th class="text-end">工资 总工资</th>

            <th class="text-end">总钟点</th>
            <th class="text-end">收费钟价</th>
            <th class="text-end">工资钟价</th>
            <th class="text-end">%</th>
          </tr>
        </thead>
        <tbody>
          ${rowHtml}
          ${totalHtml}
        </tbody>
      </table>
    </div>
  `;
}

async function previewMonthlySummary() {
  const companyId = getCompanyIdSafe();
  const startDate = document.getElementById("reportStartDate")?.value || "";
  const endDate = document.getElementById("reportEndDate")?.value || "";
  if (!startDate || !endDate) return alert("Please select start and end date.");

  const contentEl = document.getElementById("reportContent");
  if (contentEl) contentEl.innerHTML = `<div class="text-muted small">Loading...</div>`;

  const qs = getPayTypeQuery() + getJobNoQuery();
  const url = `/api/reports/monthly-summary?companyId=${companyId}&start=${startDate}&end=${endDate}${qs}`;

  const res = await fetch(url);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (contentEl) contentEl.innerHTML = `<div class="text-danger">${data?.error || "Failed to load report"}</div>`;
    return;
  }

  // ✅ same behavior as others: use existing UI permission flag
  showOrHidePayFilters("monthly-summary");

  if (contentEl) contentEl.innerHTML = renderMonthlySummaryHtml(data.rows, data.totals);
}

function exportMonthlySummaryPdf() {
  const companyId = getCompanyIdSafe();
  const startDate = document.getElementById("reportStartDate")?.value || "";
  const endDate = document.getElementById("reportEndDate")?.value || "";
  if (!startDate || !endDate) return alert("Please select start and end date.");

  const qs = getPayTypeQuery() + getJobNoQuery();
  window.open(
    `/api/reports/monthly-summary/pdf?companyId=${companyId}&start=${startDate}&end=${endDate}${qs}`,
    "_blank"
  );
}

async function previewWorkerPayslip() {
  const companyId = getCompanyIdSafe();
  const workerId = document.getElementById("reportWorkerId")?.value || "";
  const startDate = document.getElementById("reportStartDate")?.value || "";
  const endDate = document.getElementById("reportEndDate")?.value || "";

  if (!workerId) return alert("Please select a worker.");
  if (!startDate || !endDate) return alert("Please select start and end date.");

  document.getElementById("reportContent").innerHTML =
    `<div class="text-muted small">Loading...</div>`;

  const qs = getPayTypeQuery() + getJobNoQuery();
  const url = `/api/reports/worker-payslip?companyId=${companyId}&workerId=${workerId}&start=${startDate}&end=${endDate}${qs}`;

  const res = await fetch(url);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return alert(data?.error || "Failed to generate report.");

  // Simple HTML preview (PDF is the real output)
  const rows = data.rows || [];
  const w = data.worker || {};
  const t = data.totals || {};
  const title = data.title || "Worker Payslip";

  const html = `
    <div class="mb-2">
      <div class="fw-bold">${title}</div>
      <div class="text-muted small">${w.worker_code || ""} ${w.worker_name || ""}</div>
      <div class="text-muted small">${startDate} to ${endDate}</div>
    </div>

    <div class="table-responsive">
      <table class="table table-sm align-middle">
        <thead class="table-light">
          <tr>
            <th>项目</th>
            <th class="text-end">时钟</th>
            <th class="text-end">收费</th>
            <th class="text-end">工资</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map(r => `
            <tr>
              <td>${r.job_desc || "-"}</td>
              <td class="text-end">${fmt(r.hours)}</td>
              <td class="text-end">${fmt(r.fee)}</td>
              <td class="text-end">${fmt(r.wage)}</td>
            </tr>
          `).join("")}
        </tbody>
        <tfoot>
          <tr class="fw-bold table-warning">
            <td>TOTAL</td>
            <td class="text-end">${fmt(t.total_hours)}</td>
            <td class="text-end">${fmt(t.total_fee)}</td>
            <td class="text-end">${fmt(t.total_wage)}</td>
          </tr>
        </tfoot>
      </table>
    </div>

    <div class="text-muted small">For official layout, use PDF export.</div>
  `;

  document.getElementById("reportContent").innerHTML = html;
}

function exportWorkerPayslipPdf() {
  const companyId = getCompanyIdSafe();
  const workerId = document.getElementById("reportWorkerId")?.value || "";
  const startDate = document.getElementById("reportStartDate")?.value || "";
  const endDate = document.getElementById("reportEndDate")?.value || "";

  if (!workerId) return alert("Please select a worker.");
  if (!startDate || !endDate) return alert("Please select start and end date.");

  const qs = getPayTypeQuery() + getJobNoQuery();
  window.open(
    `/api/reports/worker-payslip/pdf?companyId=${companyId}&workerId=${workerId}&start=${startDate}&end=${endDate}${qs}`,
    "_blank"
  );
}


/* -----------------------------
   Boot
------------------------------ */
document.addEventListener("DOMContentLoaded", () => {
  // ✅ Wire jobno filters (normalize only, NO auto preview)
  wireJobNoFilterRules();

  document.querySelectorAll(".report-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const key = btn.dataset.report;
      const label = btn.dataset.label || btn.textContent.trim();
      if (btn.disabled) return;
      selectReport(key, label);
    });
  });

  document.getElementById("btnPreview")?.addEventListener("click", () => {
    if (selectedReport === "worker-monthly-pays") return previewWorkerMonthlyPays();
    if (selectedReport === "sales-listing") return previewSalesListing();
    if (selectedReport === "account-worker-job-listing") return previewWorkerJobListing();
    if (selectedReport === "monthly-summary") return previewMonthlySummary();
    if (selectedReport === "worker-payslip") return previewWorkerPayslip();
    alert("This report is not implemented yet.");
  });

  document.getElementById("btnPdf")?.addEventListener("click", () => {
    if (selectedReport === "worker-monthly-pays") return exportWorkerMonthlyPaysPdf();
    if (selectedReport === "sales-listing") return exportSalesListingPdf();
    if (selectedReport === "account-worker-job-listing") return exportWorkerJobListingPdf();
    if (selectedReport === "monthly-summary") return exportMonthlySummaryPdf();
    if (selectedReport === "worker-payslip") return exportWorkerPayslipPdf();
    alert("This report is not implemented yet.");
  });


  // wirePayFilterAutoPreview();
});
