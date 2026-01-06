// public/js/dashboard.js
// Same behavior, shorter + less repetition (kept logic intact)
// ✅ NEW: wait for company-switcher (admin) before loading rules/jobs/workers
// ✅ NEW: never cache companyId; always read latest selected company via getCompanyId()

let allJobs = [];
let allWorkers = [];
let pendingEntries = [];
let hotBatch = null;
let enabledCompanyRules = [];
let rulesReady = null;
let isSavingEntries = false;

const $ = (id) => document.getElementById(id);
const qsa = (sel, root = document) => Array.from(root.querySelectorAll(sel));
const todayISO = () => new Date().toISOString().split("T")[0];
const norm = (v) => String(v ?? "").trim();
const toMoney0 = (v) => (norm(v) === "" || !Number.isFinite(Number(v)) ? 0 : Number(v));
const canSeeRates = () => String(document.body?.dataset?.canSeeRates || "0") === "1";

// ✅ companyId must be dynamic (admin can change company on first load)
const getCompanyId = () =>
  (typeof window.getCurrentCompanyId === "function" ? window.getCurrentCompanyId() : null) ||
  Number(document.body?.dataset?.companyId || 0) ||
  null;

// ---------- UI helpers ----------
function applyRatesVisibility() {
  const showRates = canSeeRates();

  ["cust_rate", "cust_total", "wage_rate", "wage_total"].forEach((k) => {
    qsa(`[data-col='${k}']`).forEach((el) => (el.style.display = showRates ? "" : "none"));
  });

  const switchRow = $("customOverrideSwitchRow");
  const optionsRow = $("customOverrideOptions");
  const toggle = $("useCustomOverride");

  if (!showRates) {
    if (switchRow) switchRow.style.display = "none";
    if (optionsRow) optionsRow.style.display = "none";
    if (toggle) toggle.checked = false;
  } else {
    if (switchRow) switchRow.style.display = "";
  }

  if (hotBatch) {
    const existing = hotBatch.getSettings().hiddenColumns || {};
    hotBatch.updateSettings({
      hiddenColumns: { ...existing, columns: showRates ? [] : [6, 7], indicators: true },
    });
    hotBatch.render();
  }

  fixColspans();
}

async function loadCompanyTitle() {
  const companyId = getCompanyId();
  const el = $("companyTitle");
  if (!el) return;

  if (!companyId) {
    el.textContent = "Dashboard";
    return;
  }

  try {
    const res = await fetch(`/api/companies/${companyId}`);
    const c = await res.json().catch(() => ({}));
    el.textContent = c?.name || "Dashboard";
  } catch (e) {
    el.textContent = "Dashboard";
  }
}


function fixColspans() {
  const tbody = $("workEntriesBody");
  const table = tbody?.closest("table");
  const ths = table ? qsa("thead th", table) : [];

  const visibleCols =
    ths.filter((th) => window.getComputedStyle(th).display !== "none").length || ths.length || 1;

  const emptyCell = document.querySelector("#workEntriesBody tr td[colspan]");
  if (emptyCell) emptyCell.colSpan = visibleCols;

  const labelCell = $("grandTotalLabelCell");
  if (labelCell) labelCell.colSpan = Math.max(1, visibleCols - 2);
}

const formatDateDMY = (dateStr) => {
  const s = norm(dateStr);
  if (!s) return "-";
  const [y, m, d] = s.split("-");
  return y && m && d ? `${d}/${m}/${y}` : s;
};

// ---------- data loaders ----------
async function loadEnabledCompanyRules() {
  const companyId = getCompanyId();
  if (!companyId) {
    console.warn("No companyId available for rules.");
    enabledCompanyRules = [];
    return;
  }

  try {
    const res = await fetch(`/api/companies/${companyId}/rules`);
    const rules = await res.json();
    enabledCompanyRules = (rules || [])
      .filter(
        (r) =>
          r.enabled === 1 ||
          r.enabled === true ||
          r.is_default === 1 ||
          r.is_default === true
      )
      .map((r) => r.code);
  } catch (err) {
    console.error("loadEnabledCompanyRules error:", err);
    enabledCompanyRules = [];
  }
}

async function loadJobs() {
  const companyId = getCompanyId();
  if (!companyId) {
    console.warn("No companyId available for jobs.");
    allJobs = [];
    return;
  }

  const jobs = await fetch(`/api/jobs?companyId=${companyId}`).then((r) => r.json());
  allJobs = jobs || [];

  const select = $("jobCode");
  if (select) {
    select.innerHTML = `<option value="" disabled selected>Select job</option>`;
    allJobs.forEach((job) => {
      const opt = document.createElement("option");
      opt.value = job.job_code;
      opt.textContent = `${job.job_code} – ${job.job_type}`;
      select.appendChild(opt);
    });
  }

  // if batch grid already exists, refresh its job dropdown source
  if (hotBatch) {
    const cols = hotBatch.getSettings().columns || [];
    const jobCol = cols[4] || {};
    hotBatch.updateSettings({
      columns: cols.map((c, i) =>
        i === 4
          ? {
              ...jobCol,
              type: "dropdown",
              strict: false,
              allowInvalid: true,
              source: (q, cb) => cb((allJobs || []).map((j) => j.job_type)),
            }
          : c
      ),
    });
    hotBatch.render();
  }
}

async function loadWorkers() {
  const companyId = getCompanyId();
  if (!companyId) {
    console.warn("No companyId available for workers.");
    allWorkers = [];
    return;
  }

  const workers = await fetch(`/api/workers?companyId=${companyId}`).then((r) => r.json());
  allWorkers = workers || [];

  const select = $("workerSelect");
  if (!select) return;

  select.innerHTML = `<option value="" disabled selected>Select worker</option>`;
  allWorkers.forEach((w) => {
    const opt = document.createElement("option");
    opt.value = w.id;
    opt.textContent = `${w.worker_code} – ${w.worker_name}`;
    select.appendChild(opt);
  });

  if (hotBatch) {
    const cols = hotBatch.getSettings().columns || [];
    const workerCol = cols[3] || {};
    hotBatch.updateSettings({
      columns: cols.map((c, i) =>
        i === 3
          ? {
              ...workerCol,
              type: "dropdown",
              strict: false,
              allowInvalid: true,
              source: (q, cb) => cb((allWorkers || []).map((w) => w.worker_code)),
            }
          : c
      ),
    });
    hotBatch.render();
  }
}

// ---------- DOMContentLoaded ----------
document.addEventListener("DOMContentLoaded", async () => {
  // ✅ IMPORTANT: wait for admin company-switcher to set localStorage + session
  if (window.companyReady) await window.companyReady;
  await loadCompanyTitle();

  const companyId = getCompanyId();
  if (!companyId) console.warn("No companyId available yet.");

  // ✅ load rules/jobs/workers AFTER companyReady
  rulesReady = loadEnabledCompanyRules();
  await Promise.all([loadJobs(), loadWorkers()]);

  const dateInput = $("workDate");
  if (dateInput && !dateInput.value) dateInput.value = todayISO();

  // custom override toggle
  const useCustomOverride = $("useCustomOverride");
  const customOverrideOptions = $("customOverrideOptions");
  if (useCustomOverride && customOverrideOptions) {
    useCustomOverride.addEventListener("change", () => {
      customOverrideOptions.style.display = useCustomOverride.checked ? "" : "none";
    });
  }

  // bank card UI
  const isBank = $("isBank");
  const isBankCard = $("isBankCard");
  if (isBank && isBankCard) {
    const sync = () => isBankCard.classList.toggle("is-selected", !!isBank.checked);
    isBank.addEventListener("change", sync);
    sync();
  }

  // batch switch
  const batchSwitch = $("batchModeSwitch");
  const singleModeDiv = $("singleEntryMode");
  const batchModeDiv = $("batchEntryMode");
  if (batchSwitch && singleModeDiv && batchModeDiv) {
    batchSwitch.addEventListener("change", () => {
      const useBatch = batchSwitch.checked;

      singleModeDiv.style.display = useBatch ? "none" : "";
      batchModeDiv.style.display = useBatch ? "" : "none";

      if (useBatch) {
        // ✅ ensure Handsontable layout recalculates properly when shown
        if (!hotBatch) {
          const rowCount = parseInt($("batchRowCount")?.value, 10) || 10;
          initHotBatch(rowCount);
        } else {
          setTimeout(() => hotBatch?.render(), 0);
        }
      }
    });
  }

  applyRatesVisibility();
});

window.addEventListener("resize", () => hotBatch?.render());

/* =========================
   Batch row count helpers
   ========================= */

window.applyBatchRowCount = function () {
  const rowInput = $("batchRowCount");
  const requested = parseInt(rowInput?.value, 10) || 10;

  if (!hotBatch) return initHotBatch(requested);

  let newRows = requested;
  if (newRows < 1) newRows = 1;
  if (newRows > 500) newRows = 500;
  if (rowInput) rowInput.value = newRows;

  const oldData = hotBatch.getData();
  const cols = oldData[0]?.length || hotBatch.countCols() || 11;
  const newData = Handsontable.helper.createEmptySpreadsheetData(newRows, cols);

  for (let r = 0; r < Math.min(oldData.length, newRows); r++) {
    for (let c = 0; c < cols; c++) newData[r][c] = oldData[r][c];
  }

  hotBatch.loadData(newData);
};

window.addBatchRow = function () {
  const rowInput = $("batchRowCount");
  if (!hotBatch) return initHotBatch(parseInt(rowInput?.value, 10) || 10);

  const currentRows = hotBatch.countRows();
  hotBatch.alter("insert_row", currentRows);

  if (rowInput) rowInput.value = currentRows + 1;
};

/* =========================
   SINGLE ENTRY MODE
   ========================= */

window.addEntryToTable = async function () {
  await rulesReady;

  const workerSelect = $("workerSelect");
  const jobSelect = $("jobCode");
  const amountInput = $("amount");
  const jobNo1Input = $("jobNo1");
  const jobNo2Input = $("jobNo2");
  const dateInput = $("workDate");

  const useCustomOverride = $("useCustomOverride");
  const customCustomerRateInput = $("customCustomerRate");
  const customWageRateInput = $("customWageRate");

  const worker_id = workerSelect?.value;
  const job_code = jobSelect?.value;
  const amount = parseFloat(amountInput?.value);
  const job_no1 = norm(jobNo1Input?.value);
  const job_no2 = norm(jobNo2Input?.value);
  const work_date = norm(dateInput?.value);

  const note = norm($("note")?.value);
  const fees_collected = toMoney0($("feesCollected")?.value);

  if (!worker_id || !job_code || !amount || !work_date) {
    alert("Please select worker, job, enter amount, and choose a date.");
    return;
  }
  if (!job_no1) {
    alert("Job No1 is required.");
    return;
  }

  const worker = allWorkers.find((w) => String(w.id) === String(worker_id));
  const job = allJobs.find((j) => j.job_code === job_code);
  if (!worker || !job) {
    alert("Unable to find worker or job details.");
    return;
  }

  // customer rate
  let customerRate = job.normal_price != null ? Number(job.normal_price) : 0;
  if (useCustomOverride?.checked) {
    const customCustomer = parseFloat(customCustomerRateInput?.value);
    if (!isNaN(customCustomer) && customCustomer > 0) customerRate = customCustomer;
  }
  if (!customerRate || customerRate <= 0) {
    alert("No valid customer price (normal price missing and no custom entered).");
    return;
  }
  const customerTotal = customerRate * amount;

  // wage rate
  if (!worker?.wage_tier_id) {
    alert("This worker has no wage tier assigned yet. Please edit the worker and set a wage tier.");
    return;
  }

  let wageRate = getBaseWageRate(job, worker);
  const monthKey = work_date.slice(0, 7);

  if (enabledCompanyRules.includes("OVER_20K_5050")) {
    const mtdCustomer = await getMonthToDateCustomerTotal(getCompanyId(), worker.id, monthKey);
    if (mtdCustomer + customerTotal >= 20000) wageRate = customerRate * 0.5;
  }

  if (useCustomOverride?.checked) {
    const customWage = parseFloat(customWageRateInput?.value);
    if (!isNaN(customWage) && customWage > 0) wageRate = customWage;
  }

  if (!wageRate || wageRate <= 0) {
    alert("No valid wage rate (base wage missing and no custom entered).");
    return;
  }

  const is_bank = $("isBank")?.checked ? 1 : 0;

  pendingEntries.push({
    worker_id: worker.id,
    worker_label: workerSelect?.options?.[workerSelect.selectedIndex]?.text || "",
    job_code: job.job_code,
    job_label: jobSelect?.options?.[jobSelect.selectedIndex]?.text || "",
    amount,
    is_bank,
    note,
    fees_collected,
    customerRate,
    customerTotal,
    rate: wageRate,
    pay: wageRate * amount,
    job_no1,
    job_no2,
    work_date,
  });

  renderPendingEntriesTable();
  clearSingleEntryForm();
};

/* =========================
   BATCH MODE (Handsontable)
   ========================= */

function initHotBatch(rowCount = 10) {
  const container = $("hotBatch");
  if (!container) return;

  const cols = 11;
  const data = Handsontable.helper.createEmptySpreadsheetData(rowCount, cols);
  const t = todayISO();
  for (let r = 0; r < rowCount; r++) data[r][0] = t;

  const showRates = canSeeRates();

  hotBatch = new Handsontable(container, {
    data,
    rowHeaders: true,
    colWidths: [110, 60, 60, 160, 180, 50, 70, 70, 90, 70, 230],
    colHeaders: [
      "Date",
      "Job No1",
      "Job No2",
      "Worker Code",
      "Job Type",
      "Hours",
      "CustRate",
      "Wage",
      "Fees Collected",
      "Bank(y/n)",
      "Note",
    ],
    columns: [
      { data: 0, type: "date", dateFormat: "YYYY-MM-DD", correctFormat: true, allowInvalid: true },
      { data: 1, type: "text" },
      { data: 2, type: "text" },
      {
        data: 3,
        type: "dropdown",
        strict: false,
        allowInvalid: true,
        source: (q, cb) => cb((allWorkers || []).map((w) => w.worker_code)),
      },
      {
        data: 4,
        type: "dropdown",
        strict: false,
        allowInvalid: true,
        source: (q, cb) => cb((allJobs || []).map((j) => j.job_type)),
      },
      { data: 5, type: "numeric", numericFormat: { pattern: "0.0" } },
      { data: 6, type: "numeric", numericFormat: { pattern: "0.00" } },
      { data: 7, type: "numeric", numericFormat: { pattern: "0.00" } },
      { data: 8, type: "numeric", numericFormat: { pattern: "0.00" } },
      {
        data: 9,
        type: "text",
        validator: (value, cb) => {
          const v = norm(value).toUpperCase();
          cb(v === "" || v === "Y" || v === "N");
        },
      },
      { data: 10, type: "text" },
    ],
    afterChange: (changes, source) => {
      if (!changes || source === "bankUpper") return;
      for (const [row, prop, , newVal] of changes) {
        if (prop === 9 || prop === "9") {
          const v = norm(newVal).toUpperCase();
          if (v !== newVal) hotBatch.setDataAtCell(row, 9, v, "bankUpper");
        }
      }
    },
    stretchH: "all",
    width: "100%",
    hiddenColumns: { columns: showRates ? [] : [6, 7], indicators: true },
    licenseKey: "non-commercial-and-evaluation",
  });

  setTimeout(() => hotBatch.render(), 0);
}

function clearBatchGrid() {
  if (!hotBatch) return;

  const rowCount = parseInt($("batchRowCount")?.value, 10) || hotBatch.countRows();
  const emptyData = Handsontable.helper.createEmptySpreadsheetData(rowCount, hotBatch.countCols());
  hotBatch.loadData(emptyData);
}

// Treat row as empty if ONLY Date has value and the rest is blank
function isEmptyBatchRow(rowArr) {
  if (!rowArr) return true;
  for (let i = 1; i < rowArr.length; i++) if (norm(rowArr[i]) !== "") return false;
  return true;
}

// Read Handsontable data and push valid rows into pendingEntries[]
window.addBatchRowsToPending = async function () {
  await rulesReady;
  if (!hotBatch) return alert("Batch grid is not ready.");

  const data = hotBatch.getData();
  const successes = [];
  const failures = [];
  const rowNo = (i) => i + 1;

  for (let i = 0; i < data.length; i++) {
    const row = data[i];
    if (isEmptyBatchRow(row)) continue;

    const work_date = norm(row[0]);
    const job_no1 = norm(row[1]);
    const job_no2 = norm(row[2]);
    const worker_code = norm(row[3]);
    const job_input = norm(row[4]);
    const amount = parseFloat(row[5]);

    const customCustomerRate = parseFloat(row[6]);
    const customWageRate = parseFloat(row[7]);
    const fees_collected = toMoney0(row[8]);

    const bankRaw = norm(row[9]).toLowerCase();
    const is_bank = bankRaw === "y" ? 1 : 0;

    const note = norm(row[10]);

    if (!work_date || !/^\d{4}-\d{2}-\d{2}$/.test(work_date)) {
      failures.push({ rowIndex: i, reason: "Invalid Date (must be YYYY-MM-DD)" });
      continue;
    }
    if (!job_no1) {
      failures.push({ rowIndex: i, reason: "Missing Job No1" });
      continue;
    }
    if (!worker_code) {
      failures.push({ rowIndex: i, reason: "Missing Worker Code" });
      continue;
    }
    if (!job_input) {
      failures.push({ rowIndex: i, reason: "Missing Job Type" });
      continue;
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      failures.push({ rowIndex: i, reason: "Invalid Hours (must be > 0)" });
      continue;
    }

    const worker = allWorkers.find(
      (w) => (w.worker_code || "").toLowerCase() === worker_code.toLowerCase()
    );
    if (!worker) {
      failures.push({ rowIndex: i, reason: `Worker not found: "${worker_code}"` });
      continue;
    }

    const job =
      allJobs.find((j) => (j.job_code || "").toLowerCase() === job_input.toLowerCase()) ||
      allJobs.find((j) => (j.job_type || "").toLowerCase() === job_input.toLowerCase());

    if (!job) {
      failures.push({ rowIndex: i, reason: `Job not found: "${job_input}"` });
      continue;
    }

    let customerRate =
      !isNaN(customCustomerRate) && customCustomerRate > 0
        ? customCustomerRate
        : job.normal_price != null && Number(job.normal_price) > 0
        ? Number(job.normal_price)
        : null;

    if (customerRate == null) {
      failures.push({ rowIndex: i, reason: "Missing customer price (no normal_price and no custom)" });
      continue;
    }

    const customerTotal = customerRate * amount;

    let wageRate = getBaseWageRate(job, worker);
    const monthKey = work_date.slice(0, 7);

    if (enabledCompanyRules.includes("OVER_20K_5050")) {
      const mtdCustomer = await getMonthToDateCustomerTotal(getCompanyId(), worker.id, monthKey);
      if (mtdCustomer + customerTotal >= 20000) wageRate = customerRate * 0.5;
    }

    if (!isNaN(customWageRate) && customWageRate > 0) wageRate = customWageRate;

    if (!wageRate || wageRate <= 0) {
      failures.push({ rowIndex: i, reason: "Missing wage (no base wage & no custom wage)" });
      continue;
    }

    successes.push({
      rowIndex: i,
      entry: {
        worker_id: worker.id,
        worker_label: `${worker.worker_code} – ${worker.worker_name}`,
        job_code: job.job_code,
        job_label: `${job.job_code} – ${job.job_type}`,
        amount,
        is_bank,
        note,
        fees_collected,
        customerRate,
        customerTotal,
        rate: wageRate,
        pay: wageRate * amount,
        job_no1,
        job_no2,
        work_date,
      },
    });
  }

  successes.forEach((s) => pendingEntries.push(s.entry));
  renderPendingEntriesTable();

  if (successes.length) {
    const okSet = new Set(successes.map((s) => s.rowIndex));
    const blank = () => new Array(hotBatch.countCols()).fill(null);
    hotBatch.loadData(data.map((row, idx) => (okSet.has(idx) ? blank() : row)));
  }

  failures.forEach((f) => {
    for (let c = 0; c < hotBatch.countCols(); c++) {
      hotBatch.setCellMeta(f.rowIndex, c, "className", "htInvalidRow");
    }
  });
  hotBatch.render();

  const addedCount = successes.length;
  const failedCount = failures.length;

  let msg = `Added ${addedCount} row(s) to pending table.`;
  if (failedCount) {
    msg += `\n\n${failedCount} row(s) NOT added (left in Excel grid):\n`;
    msg += failures
      .slice(0, 12)
      .map((x) => `Row ${rowNo(x.rowIndex)}: ${x.reason}`)
      .join("\n");
    if (failures.length > 12) msg += `\n...and ${failures.length - 12} more.`;
  }
  alert(msg);
};

/* =========================
   BASE WAGE HELPERS
   ========================= */

function getBaseWageRate(job, worker) {
  const tierId = worker?.wage_tier_id;
  if (!job || !tierId) return null;

  const match = (job.wage_rates || []).find((x) => Number(x.tier_id) === Number(tierId));
  const rate = Number(match?.wage_rate);

  return Number.isFinite(rate) && rate > 0 ? rate : null;
}

const getMonthKey = (yyyy_mm_dd) => String(yyyy_mm_dd || "").slice(0, 7);

async function getMonthToDateCustomerTotal(companyId, workerId, monthKey) {
  if (!companyId) companyId = getCompanyId();

  const res = await fetch(
    `/api/work-entries/worker-month-customer-total?companyId=${companyId}&workerId=${workerId}&month=${monthKey}`
  );
  const data = await res.json();
  const dbTotal = Number(data.total || 0);

  const pendingTotal = pendingEntries
    .filter((e) => String(e.worker_id) === String(workerId) && getMonthKey(e.work_date) === monthKey)
    .reduce((sum, e) => sum + (Number(e.customerTotal) || 0), 0);

  return dbTotal + pendingTotal;
}

/* =========================
   PENDING TABLE + SAVE
   ========================= */

function renderPendingEntriesTable() {
  const tbody = $("workEntriesBody");
  const wageTotalCell = $("grandTotalCell");
  const customerTotalCell = $("grandCustomerTotalCell");
  if (!tbody) return;

  tbody.innerHTML = "";
  let grandWageTotal = 0;
  let grandCustomerTotal = 0;

  if (pendingEntries.length === 0) {
    tbody.innerHTML = `
      <tr class="text-muted">
        <td colspan="16" class="text-center fst-italic py-3">No work entries recorded yet.</td>
      </tr>`;
    if (wageTotalCell) wageTotalCell.textContent = "0.00";
    if (customerTotalCell) customerTotalCell.textContent = "0.00";
    applyRatesVisibility();
    return;
  }

  pendingEntries.forEach((e, index) => {
    grandWageTotal += Number(e.pay || 0);
    grandCustomerTotal += Number(e.fees_collected || 0);

    const payTypeText = e.is_bank ? "Bank" : "Cash";

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${index + 1}</td>
      <td data-raw-date="${e.work_date}">${formatDateDMY(e.work_date)}</td>
      <td>${e.job_no1 || "-"}</td>
      <td>${e.job_no2 || "-"}</td>
      <td>${e.worker_label}</td>
      <td>${e.job_label}</td>
      <td>${e.amount}</td>
      <td>${payTypeText}</td>
      <td>${Number(e.fees_collected || 0).toFixed(2)}</td>
      <td data-col="cust_rate">${Number(e.customerRate).toFixed(2)}</td>
      <td data-col="cust_total">${Number(e.customerTotal).toFixed(2)}</td>
      <td data-col="wage_rate">${Number(e.rate).toFixed(2)}</td>
      <td data-col="wage_total">${Number(e.pay).toFixed(2)}</td>
      <td class="text-muted small">${e.note ? e.note : "-"}</td>
      <td>
        <button class="btn btn-sm btn-outline-danger"
          data-action="delete-pending"
          ${isSavingEntries ? "disabled" : ""}
          onclick="removePendingEntry(${index})">
          Delete
        </button>
      </td>`;
    tbody.appendChild(tr);
  });

  if (wageTotalCell) wageTotalCell.textContent = grandWageTotal.toFixed(2);
  if (customerTotalCell) customerTotalCell.textContent = grandCustomerTotal.toFixed(2);

  applyRatesVisibility();
}

window.removePendingEntry = function (index) {
  if (isSavingEntries) return;
  pendingEntries.splice(index, 1);
  renderPendingEntriesTable();
};

function validatePendingEntry(e) {
  const errors = [];
  if (!e.worker_id) errors.push("worker_id missing");
  if (!e.job_code) errors.push("job_code missing");
  if (!norm(e.job_no1)) errors.push("job_no1 missing");
  if (!e.work_date) errors.push("work_date missing");

  const amount = Number(e.amount);
  if (!Number.isFinite(amount) || amount <= 0) errors.push("amount invalid");

  const cr = Number(e.customerRate);
  const ct = Number(e.customerTotal);
  const wr = Number(e.rate);
  const wt = Number(e.pay);

  if (!Number.isFinite(cr) || cr <= 0) errors.push("customer rate missing/invalid");
  if (!Number.isFinite(ct) || ct <= 0) errors.push("customer total missing/invalid");
  if (!Number.isFinite(wr) || wr <= 0) errors.push("wage rate missing/invalid");
  if (!Number.isFinite(wt) || wt <= 0) errors.push("wage total missing/invalid");

  return errors;
}

window.confirmEntries = async function () {
  const companyId = getCompanyId();

  if (pendingEntries.length === 0) return alert("No entries to save.");
  if (!confirm("Save all entries to the database?")) return;

  setSavingUI(true);

  try {
    const validationFailures = pendingEntries
      .map((e, idx) => ({ row: idx + 1, errors: validatePendingEntry(e) }))
      .filter((x) => x.errors.length);

    if (validationFailures.length) {
      alert(
        "Fix these rows before saving:\n\n" +
          validationFailures.map((x) => `Row ${x.row}: ${x.errors.join(", ")}`).join("\n")
      );
      return;
    }

    const results = await Promise.allSettled(
      pendingEntries.map((e) =>
        fetch("/api/work-entries", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            company_id: companyId,
            worker_id: e.worker_id,
            job_code: e.job_code,
            amount: e.amount,
            is_bank: e.is_bank ? 1 : 0,
            note: e.note || null,
            customer_rate: e.customerRate,
            customer_total: e.customerTotal,
            wage_rate: e.rate,
            wage_total: e.pay,
            rate: e.rate,
            pay: e.pay,
            job_no1: e.job_no1,
            job_no2: e.job_no2,
            work_date: e.work_date,
            fees_collected: e.fees_collected || 0,
          }),
        }).then(async (r) => {
          const data = await r.json().catch(() => ({}));
          if (!r.ok) throw new Error(data?.error || `HTTP ${r.status}`);
          if (data?.error) throw new Error(data.error);
          return data;
        })
      )
    );

    const failed = [];
    let succeededCount = 0;

    results.forEach((r, idx) => {
      if (r.status === "fulfilled") succeededCount++;
      else {
        failed.push({
          row: idx + 1,
          entry: pendingEntries[idx],
          error: r.reason?.message || String(r.reason),
        });
      }
    });

    if (!failed.length) {
      alert(`Entries saved successfully. (${succeededCount})`);
      pendingEntries = [];
      renderPendingEntriesTable();
      return;
    }

    pendingEntries = failed.map((x) => x.entry);
    renderPendingEntriesTable();

    alert(
      `Saved ${succeededCount} row(s). ${failed.length} row(s) failed and were kept in Pending:\n\n` +
        failed.map((x) => `Row ${x.row}: ${x.error}`).join("\n")
    );
  } finally {
    setSavingUI(false);
  }
};

// ---------- form helpers ----------
function clearSingleEntryForm() {
  if ($("jobNo1")) $("jobNo1").value = "";
  if ($("jobNo2")) $("jobNo2").value = "";
  if ($("amount")) $("amount").value = "";

  const workerSelect = $("workerSelect");
  const jobSelect = $("jobCode");
  if (workerSelect) workerSelect.selectedIndex = 0;
  if (jobSelect) jobSelect.selectedIndex = 0;

  const useCustomOverride = $("useCustomOverride");
  const customOverrideOptions = $("customOverrideOptions");
  if (useCustomOverride) useCustomOverride.checked = false;
  if ($("customCustomerRate")) $("customCustomerRate").value = "";
  if ($("customWageRate")) $("customWageRate").value = "";
  if (customOverrideOptions) customOverrideOptions.style.display = "none";

  const isBankCheckbox = $("isBank");
  const isBankCard = $("isBankCard");
  if (isBankCheckbox) isBankCheckbox.checked = false;
  if (isBankCard) isBankCard.classList.remove("is-selected");

  if ($("feesCollected")) $("feesCollected").value = "";
  if ($("note")) $("note").value = "";
}

function setSavingUI(isSaving) {
  isSavingEntries = isSaving;

  const btn = $("confirmSaveBtn");
  if (btn) {
    if (isSaving) {
      btn.disabled = true;
      btn.dataset.originalText = btn.innerHTML;
      btn.innerHTML = `
        <span class="spinner-border spinner-border-sm me-2" role="status" aria-hidden="true"></span>
        Saving...
      `;
    } else {
      btn.disabled = false;
      btn.innerHTML = btn.dataset.originalText || "Confirm & Save";
    }
  }

  qsa("#workEntriesBody button[data-action='delete-pending']").forEach((b) => (b.disabled = isSaving));
}
