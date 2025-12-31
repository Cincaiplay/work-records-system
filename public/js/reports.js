// public/js/reports.js
let selectedReport = null;

// read permission flag from <body data-can-filter-paytype="1|0">
window.CAN_FILTER_PAYTYPE = document.body?.dataset?.canFilterPaytype === "1";

// Which reports support pay type filter?
const PAY_FILTER_REPORTS = new Set([
  "worker-monthly-pays",
  "sales-listing",
  "account-worker-job-listing",
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

/* -----------------------------
   Report selection
------------------------------ */
function selectReport(key, label) {
  selectedReport = key;

  showOrHidePayFilters(key);

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

  const title = `
    <div class="mb-3">
      <div class="fw-bold">Worker Monthly Pays 技师的提成</div>
      <div class="text-muted small">${meta.startDate} to ${meta.endDate}</div>
    </div>
  `;

  const table = `
    <div class="table-responsive">
      <table class="table table-sm table-hover align-middle">
        <thead class="table-primary small text-uppercase">
          <tr>
            <th>#</th>
            <th>Worker Code</th>
            <th>Worker Name</th>
            <th class="text-end">Hours</th>
            <th class="text-end">Customer Total</th>
            <th class="text-end">%</th>
            <th class="text-end">Wage Total</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map((r, i) => {
            const pct = totalCustomer > 0
              ? (Number(r.total_customer || 0) / totalCustomer) * 100
              : 0;
            return `
              <tr>
                <td>${i + 1}</td>
                <td>${r.worker_code || "-"}</td>
                <td>${r.worker_name || "-"}</td>
                <td class="text-end">${fmt(r.total_hours)}</td>
                <td class="text-end">${fmt(r.total_customer)}</td>
                <td class="text-end">${pct.toFixed(0)}%</td>
                <td class="text-end fw-semibold">${fmt(r.total_wage)}</td>
              </tr>
            `;
          }).join("")}
        </tbody>
        <tfoot>
          <tr class="fw-bold">
            <td colspan="3" class="text-end">TOTAL</td>
            <td class="text-end">${fmt(totalHours)}</td>
            <td class="text-end">${fmt(totalCustomer)}</td>
            <td class="text-end">100%</td>
            <td class="text-end">${fmt(totalWage)}</td>
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
    alert("This report is not implemented yet.");
  });

  document.getElementById("btnPdf")?.addEventListener("click", () => {
    if (selectedReport === "worker-monthly-pays") return exportWorkerMonthlyPaysPdf();
    if (selectedReport === "sales-listing") return exportSalesListingPdf();
    if (selectedReport === "account-worker-job-listing") return exportWorkerJobListingPdf();
    alert("This report is not implemented yet.");
  });

  // wirePayFilterAutoPreview();
});
