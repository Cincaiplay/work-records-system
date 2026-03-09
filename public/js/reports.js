// public/js/reports.js
let selectedReport = null;
const t = (key, vars = {}) => window.AppI18n?.t(key, vars) ?? key;
const applyTranslations = () => window.AppI18n?.apply?.();
const initLangSwitch = () => window.AppI18n?.initLangSwitch?.();
const onLangChange = (cb) => window.AppI18n?.onChange?.(cb);
const getLang = () => window.AppI18n?.getLang?.() || "en";

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
  if (window.CAN_FILTER_PAYTYPE !== true) return "";

  const cash = document.getElementById("filterCash")?.checked ? 1 : 0;
  const bank = document.getElementById("filterBank")?.checked ? 1 : 0;
  return `&cash=${cash}&bank=${bank}`;
}

// JobNo filter query
function getJobNoQuery() {
  const restrictJobNo2 = document.body?.dataset?.restrictJobno2 === "1";
  if (restrictJobNo2) return "&jobno1=0&jobno2=1";
  const j1El = document.getElementById("filterJobNo1");
  const j2El = document.getElementById("filterJobNo2");
  if (!j1El || !j2El) return "";

  const j1 = j1El.checked ? 1 : 0;
  const j2 = j2El.checked ? 1 : 0;
  return `&jobno1=${j1}&jobno2=${j2}`;
}

function getLangQuery() {
  const lang = document.getElementById("reportLang")?.value || "en";
  return `&lang=${encodeURIComponent(lang)}`;
}

function wireJobNoFilterRules() {
  const j1 = document.getElementById("filterJobNo1");
  const j2 = document.getElementById("filterJobNo2");
  if (!j1 || !j2) return;

  const restrictJobNo2 = document.body?.dataset?.restrictJobno2 === "1";
  if (restrictJobNo2) {
    j1.checked = false;
    j2.checked = true;
    j1.disabled = true;
    j2.disabled = true;
    return;
  }

  const normalize = () => {
    if (!j1.checked && !j2.checked) {
      j1.checked = true;
      j2.checked = true;
    }
  };

  normalize();
  j1.addEventListener("change", normalize);
  j2.addEventListener("change", normalize);
}

/* =====================================================
   Worker Picker (multi-select dropdown)
   - Keeps original <select id="reportWorkerId"> (hidden)
   - Dropdown reflects select options + selection
===================================================== */

let _workerPicker = { selected: new Set() };

function escapeHtml(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function getSelectedWorkerIds() {
  const sel = document.getElementById("reportWorkerId");
  if (!sel) return [];
  return Array.from(sel.selectedOptions || [])
    .map((o) => Number(o.value))
    .filter((n) => Number.isFinite(n) && n > 0);
}

function syncWorkerPickerToSelect() {
  const sel = document.getElementById("reportWorkerId");
  if (!sel) return;

  Array.from(sel.options || []).forEach((o) => {
    const val = String(o.value || "").trim();
    o.selected = val ? _workerPicker.selected.has(val) : false;
  });
}

function updateWorkerPickerButtonText() {
  const sel = document.getElementById("reportWorkerId");
  const btn = document.getElementById("workerPickerBtn");
  if (!sel || !btn) return;

  const selectedOpts = Array.from(sel.options || []).filter(
    (o) => o.selected && String(o.value || "").trim()
  );

  if (selectedOpts.length === 0) return (btn.textContent = t("reports.workerPicker.select"));
  if (selectedOpts.length === 1) return (btn.textContent = selectedOpts[0].text.trim() || t("reports.workerPicker.selectedOne"));
  btn.textContent = t("reports.workerPicker.selectedMany", { count: selectedOpts.length });
}

function renderWorkerPickerList() {
  const sel = document.getElementById("reportWorkerId");
  const menu = document.getElementById("workerPickerMenu");
  const listEl = menu?.querySelector("#workerPickerList");
  const searchEl = menu?.querySelector("#workerPickerSearch");
  if (!sel || !listEl) return;

  const q = String(searchEl?.value || "").trim().toLowerCase();

  const opts = Array.from(sel.options || []).filter((o) => {
    const val = String(o.value || "").trim();
    if (!val) return false;
    const label = String(o.text || "").trim();
    if (!q) return true;
    return label.toLowerCase().includes(q) || val.toLowerCase().includes(q);
  });

  if (!opts.length) {
    listEl.innerHTML = `<div class="text-muted small">${t("reports.noData")}</div>`;
    updateWorkerPickerButtonText();
    return;
  }

  listEl.innerHTML = opts
    .map((o) => {
      const val = String(o.value);
      const label = String(o.text || "").trim();
      const checked = _workerPicker.selected.has(val) ? "checked" : "";
      const id = `wk_${val.replace(/[^a-zA-Z0-9_-]/g, "_")}`;

      return `
        <div class="form-check mb-1">
          <input class="form-check-input" type="checkbox" id="${id}" data-value="${val}" ${checked}>
          <label class="form-check-label" for="${id}">${escapeHtml(label)}</label>
        </div>
      `;
    })
    .join("");

  updateWorkerPickerButtonText();
}

function initWorkerMultiSelectDropdown() {
  const sel = document.getElementById("reportWorkerId");
  if (!sel) return;

  // already initialized
  if (document.getElementById("workerPickerWrap")) return;

  // hide original select
  sel.classList.add("d-none");

  const wrap = document.createElement("div");
  wrap.id = "workerPickerWrap";
  wrap.className = "dropdown";

  const btn = document.createElement("button");
  btn.id = "workerPickerBtn";
  btn.type = "button";
  btn.className = "btn btn-outline-secondary w-100 text-start dropdown-toggle";
  btn.setAttribute("data-bs-toggle", "dropdown");
  btn.setAttribute("aria-expanded", "false");
  btn.textContent = t("reports.workerPicker.select");

  const menu = document.createElement("div");
  menu.id = "workerPickerMenu";
  menu.className = "dropdown-menu p-2 shadow";
  menu.style.width = "100%";
  menu.style.maxHeight = "320px";
  menu.style.overflow = "auto";

  menu.innerHTML = `
    <div class="d-flex gap-2 mb-2">
      <input id="workerPickerSearch" class="form-control form-control-sm" placeholder="Search worker..." />
      <button id="workerPickerAll" type="button" class="btn btn-sm btn-light">All</button>
      <button id="workerPickerNone" type="button" class="btn btn-sm btn-light">Clear</button>
    </div>
    <div id="workerPickerList" class="small"></div>
    <div class="border-top mt-2 pt-2 text-muted small">
      Tip: you can select multiple workers.
    </div>
  `;

  sel.parentElement.insertBefore(wrap, sel.nextSibling);
  wrap.appendChild(btn);
  wrap.appendChild(menu);

  // mirror initial selections
  _workerPicker.selected = new Set(
    Array.from(sel.options || [])
      .filter((o) => o.selected && o.value)
      .map((o) => String(o.value))
  );

  renderWorkerPickerList();

  const searchEl = menu.querySelector("#workerPickerSearch");
  const allBtn = menu.querySelector("#workerPickerAll");
  const noneBtn = menu.querySelector("#workerPickerNone");
  const listEl = menu.querySelector("#workerPickerList");

  searchEl.addEventListener("input", () => renderWorkerPickerList());

  allBtn.addEventListener("click", (e) => {
    e.preventDefault();
    Array.from(sel.options || []).forEach((o) => {
      if (String(o.value || "").trim()) _workerPicker.selected.add(String(o.value));
    });
    syncWorkerPickerToSelect();
    renderWorkerPickerList();
  });

  noneBtn.addEventListener("click", (e) => {
    e.preventDefault();
    _workerPicker.selected.clear();
    syncWorkerPickerToSelect();
    renderWorkerPickerList();
  });

  listEl.addEventListener("change", (e) => {
    const t = e.target;
    if (!t || t.type !== "checkbox") return;

    const val = String(t.getAttribute("data-value") || "");
    if (!val) return;

    if (t.checked) _workerPicker.selected.add(val);
    else _workerPicker.selected.delete(val);

    syncWorkerPickerToSelect();
    updateWorkerPickerButtonText();
  });

  // keep dropdown open while clicking inside
  menu.addEventListener("click", (e) => e.stopPropagation());

  updateWorkerPickerButtonText();
}

async function loadWorkersIntoSelect() {
  const sel = document.getElementById("reportWorkerId");
  if (!sel) return;

  const companyId = getCompanyIdSafe();
  const res = await fetch(`/api/workers?companyId=${companyId}`);
  const data = await res.json().catch(() => ({}));

  const list = Array.isArray(data) ? data : (data.workers || data.rows || []);
  sel.innerHTML = `<option value="">${t("reports.filters.workerPlaceholder")}</option>`;

  list.forEach((w) => {
    const id = w.id;
    const code = w.worker_code || "";
    const name = w.worker_name || w.worker_english_name || "";
    const label = `${code} ${name}`.trim() || `Worker ${id}`;

    const opt = document.createElement("option");
    opt.value = String(id);
    opt.textContent = label;
    sel.appendChild(opt);
  });

  // if dropdown already exists, refresh it
  if (document.getElementById("workerPickerWrap")) {
    // keep previous selection if possible
    const prev = new Set(_workerPicker.selected);
    _workerPicker.selected = new Set(
      Array.from(sel.options || [])
        .map((o) => String(o.value || "").trim())
        .filter((v) => v && prev.has(v))
    );
    syncWorkerPickerToSelect();
    renderWorkerPickerList();
  }
}

function showOrHideWorkerPicker(reportKey) {
  const box = document.getElementById("workerPickerBox");
  if (!box) return;

  const show = reportKey === "worker-payslip" || reportKey === "account-worker-job-listing";
  box.style.display = show ? "" : "none";
  if (!show) return;

  loadWorkersIntoSelect()
    .then(() => {
      initWorkerMultiSelectDropdown(); // create once
      renderWorkerPickerList();        // refresh list after options updated
    })
    .catch((e) => console.error("loadWorkersIntoSelect failed:", e));
}

function buildWorkerIdsQueryParam(workerIds) {
  // repeated params: &workerId=1&workerId=2
  return (workerIds || []).map((id) => `&workerId=${encodeURIComponent(id)}`).join("");
}

function parseWorkerIdsFromQuery(req) {
  // supports: &workerId=1&workerId=2 OR &workerIds=1,2
  const list = [];

  const repeated = req.query.workerId;
  if (Array.isArray(repeated)) {
    for (const x of repeated) list.push(Number(x));
  } else if (repeated != null && repeated !== "") {
    list.push(Number(repeated));
  }

  const csv = req.query.workerIds;
  if (csv) {
    String(csv)
      .split(",")
      .map((s) => Number(String(s).trim()))
      .forEach((n) => list.push(n));
  }

  // unique + valid
  return Array.from(new Set(list)).filter((n) => Number.isFinite(n) && n > 0);
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
  if (subEl) subEl.textContent = t("reports.selectedSubtitle");
  if (controlsEl) controlsEl.style.display = "";

  setDefaultDates();

  if (contentEl) {
    contentEl.innerHTML =
      `<div class="text-muted small">${t("reports.selectedHint")}</div>`;
  }
}

function syncReportLangToUi() {
  const sel = document.getElementById("reportLang");
  if (!sel) return;
  const lang = getLang();
  if (lang === "zh") sel.value = "zh";
  else sel.value = "en";
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
    return `<div class="text-muted">${t("reports.noData")}</div>`;

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
  if (!rows.length) return `<div class="text-muted">${t("reports.noData")}</div>`;

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
  if (!workers.length) return `<div class="text-muted">${t("reports.noData")}</div>`;

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
              <td class="text-end"></td>
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
  if (!startDate || !endDate) return alert(t("reports.err.selectDates"));

  document.getElementById("reportContent").innerHTML =
    `<div class="text-muted small">${t("reports.loading")}</div>`;

  const qs = getPayTypeQuery() + getJobNoQuery();
  const url = `/api/reports/worker-monthly-pays?companyId=${companyId}&start=${startDate}&end=${endDate}${qs}`;

  const res = await fetch(url);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return alert(data?.error || t("reports.err.failed"));

  document.getElementById("reportContent").innerHTML =
    renderWorkerMonthlyPaysTable(data.rows || [], { startDate, endDate });
}

function exportWorkerMonthlyPaysPdf() {
  const companyId = getCompanyIdSafe();
  const startDate = document.getElementById("reportStartDate")?.value || "";
  const endDate = document.getElementById("reportEndDate")?.value || "";
  if (!startDate || !endDate) return alert(t("reports.err.selectDates"));

  const workerIds = getSelectedWorkerIds();
  const wq = workerIds.length ? buildWorkerIdsQueryParam(workerIds) : "";
  const qs = getPayTypeQuery() + getJobNoQuery() + getLangQuery() + wq;
  window.open(
    `/api/reports/worker-monthly-pays/pdf?companyId=${companyId}&start=${startDate}&end=${endDate}${qs}`,
    "_blank"
  );
}

async function previewSalesListing() {
  const companyId = getCompanyIdSafe();
  const startDate = document.getElementById("reportStartDate")?.value || "";
  const endDate = document.getElementById("reportEndDate")?.value || "";
  if (!startDate || !endDate) return alert(t("reports.err.selectDates"));

  document.getElementById("reportContent").innerHTML =
    `<div class="text-muted small">${t("reports.loading")}</div>`;

  const qs = getPayTypeQuery() + getJobNoQuery();
  const url = `/api/reports/sales-listing?companyId=${companyId}&start=${startDate}&end=${endDate}${qs}`;

  const res = await fetch(url);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return alert(data?.error || t("reports.err.failed"));

  document.getElementById("reportContent").innerHTML =
    renderSalesListingHtml(data, { startDate, endDate });
}

function exportSalesListingPdf() {
  const companyId = getCompanyIdSafe();
  const startDate = document.getElementById("reportStartDate")?.value || "";
  const endDate = document.getElementById("reportEndDate")?.value || "";
  if (!startDate || !endDate) return alert(t("reports.err.selectDates"));

  const qs = getPayTypeQuery() + getJobNoQuery() + getLangQuery();
  window.open(
    `/api/reports/sales-listing/pdf?companyId=${companyId}&start=${startDate}&end=${endDate}${qs}`,
    "_blank"
  );
}

async function previewWorkerJobListing() {
  const companyId = getCompanyIdSafe();
  const startDate = document.getElementById("reportStartDate")?.value || "";
  const endDate = document.getElementById("reportEndDate")?.value || "";
  if (!startDate || !endDate) return alert(t("reports.err.selectDates"));

  document.getElementById("reportContent").innerHTML =
    `<div class="text-muted small">${t("reports.loading")}</div>`;

  const workerIds = getSelectedWorkerIds();
  const wq = workerIds.length ? buildWorkerIdsQueryParam(workerIds) : "";
  const qs = getPayTypeQuery() + getJobNoQuery() + wq;
  const url = `/api/reports/account-worker-job-listing?companyId=${companyId}&start=${startDate}&end=${endDate}${qs}`;

  const res = await fetch(url);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return alert(data?.error || t("reports.err.failed"));

  document.getElementById("reportContent").innerHTML =
    renderWorkerJobListingHtml(data, { startDate, endDate });
}

function exportWorkerJobListingPdf() {
  const companyId = getCompanyIdSafe();
  const startDate = document.getElementById("reportStartDate")?.value || "";
  const endDate = document.getElementById("reportEndDate")?.value || "";
  if (!startDate || !endDate) return alert(t("reports.err.selectDates"));

  const workerIds = getSelectedWorkerIds();
  const wq = workerIds.length ? buildWorkerIdsQueryParam(workerIds) : "";
  const qs = getPayTypeQuery() + getJobNoQuery() + getLangQuery() + wq;
  window.open(
    `/api/reports/account-worker-job-listing/pdf?companyId=${companyId}&start=${startDate}&end=${endDate}${qs}`,
    "_blank"
  );
}

function renderMonthlySummaryHtml(rows, totals) {
  if (!rows || rows.length === 0) {
    return `<div class="text-muted">${t("reports.noData")}</div>`;
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
    </tr>
  `;

  return `
    <div class="table-responsive">
      <table class="table table-sm align-middle">
        <thead class="table-light">
          <tr>
            <th>Month 月份</th>

            <th class="text-end">Total Sales 总销售</th>
            <th class="text-end">Bank Sales 银行销售</th>
            <th class="text-end">Cash Sales 现金销售</th>

            <th class="text-end">Total Wages 总工资</th>
            <th class="text-end">Bank Wages 银行工资</th>
            <th class="text-end">Cash Wages 现金工资</th>
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
  if (!startDate || !endDate) return alert(t("reports.err.selectDates"));

  const contentEl = document.getElementById("reportContent");
  if (contentEl) contentEl.innerHTML = `<div class="text-muted small">${t("reports.loading")}</div>`;

  const qs = getPayTypeQuery() + getJobNoQuery();
  const url = `/api/reports/monthly-summary?companyId=${companyId}&start=${startDate}&end=${endDate}${qs}`;

  const res = await fetch(url);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (contentEl) contentEl.innerHTML = `<div class="text-danger">${data?.error || t("reports.err.failed")}</div>`;
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
  if (!startDate || !endDate) return alert(t("reports.err.selectDates"));

  const qs = getPayTypeQuery() + getJobNoQuery() + getLangQuery();
  window.open(
    `/api/reports/monthly-summary/pdf?companyId=${companyId}&start=${startDate}&end=${endDate}${qs}`,
    "_blank"
  );
}

async function previewWorkerPayslip() {
  const companyId = getCompanyIdSafe();
  const workerIds = getSelectedWorkerIds(); // ✅ MULTI
  const startDate = document.getElementById("reportStartDate")?.value || "";
  const endDate = document.getElementById("reportEndDate")?.value || "";

  if (!workerIds.length) return alert(t("reports.err.selectWorker"));
  if (!startDate || !endDate) return alert(t("reports.err.selectDates"));

  document.getElementById("reportContent").innerHTML =
    `<div class="text-muted small">${t("reports.loading")}</div>`;

  const qs = getPayTypeQuery() + getJobNoQuery();

  let html = "";

  // 🔁 ONE REQUEST PER WORKER
  for (const workerId of workerIds) {
    const url =
      `/api/reports/worker-payslip?companyId=${companyId}` +
      `&workerId=${workerId}&start=${startDate}&end=${endDate}${qs}`;

    const res = await fetch(url);
    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      html += `<div class="text-danger mb-3">
        ${t("reports.err.loadWorker", { id: workerId })}
      </div>`;
      continue;
    }

    const rows = data.rows || [];
    const w = data.worker || {};
    const t = data.totals || {};
    const title = data.title || "Worker Payslip";

    html += `
      <div class="border rounded p-3 mb-4 bg-white">
        <div class="mb-2">
          <div class="fw-bold">${title}</div>
          <div class="text-muted small">
            ${w.worker_code || ""} ${w.worker_name || ""}
          </div>
          <div class="text-muted small">
            ${startDate} to ${endDate}
          </div>
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
                <td class="text-end"></td>
                <td class="text-end">${fmt(t.total_wage)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    `;
  }

  html += `<div class="text-muted small">
    For official layout, use PDF export.
  </div>`;

  document.getElementById("reportContent").innerHTML = html;
}

function exportWorkerPayslipPdf() {
  const companyId = getCompanyIdSafe();
  const workerIds = getSelectedWorkerIds();
  const startDate = document.getElementById("reportStartDate")?.value || "";
  const endDate = document.getElementById("reportEndDate")?.value || "";

  if (!workerIds.length) return alert(t("reports.err.selectWorker"));
  if (!startDate || !endDate) return alert(t("reports.err.selectDates"));

  const qs = getPayTypeQuery() + getJobNoQuery() + getLangQuery();
  const wq = buildWorkerIdsQueryParam(workerIds);

  window.open(
    `/api/reports/worker-payslip/pdf?companyId=${encodeURIComponent(companyId)}` +
      `${wq}` +
      `&start=${encodeURIComponent(startDate)}` +
      `&end=${encodeURIComponent(endDate)}` +
      `${qs}`,
    "_blank"
  );
}


/* -----------------------------
   Boot
------------------------------ */
document.addEventListener("DOMContentLoaded", () => {
  applyTranslations();
  initLangSwitch();
  syncReportLangToUi();
  onLangChange(() => {
    applyTranslations();
    syncReportLangToUi();
    updateWorkerPickerButtonText();
    if (selectedReport) {
      const btn = document.querySelector(`.report-btn[data-report="${selectedReport}"]`);
      const label = btn?.textContent?.trim() || "";
      const titleEl = document.getElementById("reportTitle");
      if (titleEl && label) titleEl.textContent = label;
      const subEl = document.getElementById("reportSubtitle");
      if (subEl) subEl.textContent = t("reports.selectedSubtitle");
    }
  });

  // default date range to last month (start/end) if not already set
  const startEl = document.getElementById("reportStartDate");
  const endEl = document.getElementById("reportEndDate");
  if (startEl && endEl && !startEl.value && !endEl.value) {
    const now = new Date();
    const startLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const endLastMonth = new Date(now.getFullYear(), now.getMonth(), 0);
    const toLocalYMD = (d) => {
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, "0");
      const day = String(d.getDate()).padStart(2, "0");
      return `${y}-${m}-${day}`;
    };
    startEl.value = toLocalYMD(startLastMonth);
    endEl.value = toLocalYMD(endLastMonth);
  }

  // ✅ Wire jobno filters (normalize only, NO auto preview)
  wireJobNoFilterRules();

  const restrictJobNo2 = document.body?.dataset?.restrictJobno2 === "1";
  const jobNoFilters = document.getElementById("jobNoFilters");
  if (jobNoFilters && restrictJobNo2) jobNoFilters.style.display = "none";

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
    alert(t("reports.err.failed"));
  });

  document.getElementById("btnPdf")?.addEventListener("click", () => {
    if (selectedReport === "worker-monthly-pays") return exportWorkerMonthlyPaysPdf();
    if (selectedReport === "sales-listing") return exportSalesListingPdf();
    if (selectedReport === "account-worker-job-listing") return exportWorkerJobListingPdf();
    if (selectedReport === "monthly-summary") return exportMonthlySummaryPdf();
    if (selectedReport === "worker-payslip") return exportWorkerPayslipPdf();
    alert(t("reports.err.failed"));
  });


  // wirePayFilterAutoPreview();
});
