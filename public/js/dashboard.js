// public/js/dashboard.js
// ✅ Batch upgraded (nestedRows) WITHOUT changing column order/count:
// Columns remain EXACTLY:
// 0 Date
// 1 Job No1
// 2 Job No2
// 3 Worker Code
// 4 Job Type   ✅ (PARENT: multi-select job_type, CHILD: follows parent, NOT editable)
// 5 Hours      ✅ (Child editable)
// 6 CustRate
// 7 Wage
// 8 Fees Collected
// 9 Bank(y/n)
// 10 Note

let allJobs = [];
let allWorkers = [];
let pendingEntries = [];
// each item:
// {
//   header: { company_id, worker_id, worker_label, work_date, job_no1, job_no2, is_bank, fees_collected, note },
//   jobs:   [ { job_code, job_label, hours, customer_rate, customer_total, wage_rate, wage_total, wage_tier_id, rate, pay } ]
// }

let hotBatch = null;
let enabledCompanyRules = [];
let rulesReady = null;
let isSavingEntries = false;
let batchData = []; // ✅ the real backing array used by Handsontable
let selectedJobCodes = new Set();

// prevents re-entrant rebuild loops when we call loadData() ourselves
let isSyncingNested = false;

const $ = (id) => document.getElementById(id);
const qsa = (sel, root = document) => Array.from(root.querySelectorAll(sel));
const todayISO = () => new Date().toISOString().split("T")[0];
const norm = (v) => String(v ?? "").trim();
const toMoney0 = (v) => (norm(v) === "" || !Number.isFinite(Number(v)) ? 0 : Number(v));
const canSeeRates = () => String(document.body?.dataset?.canSeeRates || "0") === "1";
const isValidWageRate = (v) => Number.isFinite(v) && v !== 0;

function refreshHotBatch() {
  if (!hotBatch) return;
  if (typeof hotBatch.refreshDimensions === "function") {
    hotBatch.refreshDimensions();
  }
  hotBatch.render();
}

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

function applyBatchSwitchVisibility() {
  const row = $("batchModeSwitchRow");
  const sw = $("batchModeSwitch");
  const singleModeDiv = $("singleEntryMode");
  const batchModeDiv = $("batchEntryMode");

  if (!row || !sw || !singleModeDiv || !batchModeDiv) return;

  row.style.display = "";
  sw.disabled = false;
  row.title = "";
}


function getSelectedJobCodes() {
  return Array.from(selectedJobCodes);
}

function renderJobCheckboxes(filterText = "") {
  const wrap = $("jobCheckboxList");
  if (!wrap) return;

  const q = norm(filterText).toLowerCase();

  const jobs = (allJobs || []).filter(j => {
    if (!q) return true;
    const label = `${j.job_code || ""} ${j.job_type || ""}`.toLowerCase();
    return label.includes(q);
  });

  if (!jobs.length) {
    wrap.innerHTML = `<div class="text-muted small fst-italic">No matching jobs.</div>`;
    return;
  }

  wrap.innerHTML = jobs.map((job) => {
    const code = job.job_code;
    const checked = selectedJobCodes.has(code) ? "checked" : "";
    const label = `${job.job_code} – ${job.job_type}`;

    return `
      <label class="d-flex align-items-center gap-2 py-1 px-1 rounded-2 job-tick-row"
             style="cursor:pointer;">
        <input type="checkbox" class="form-check-input m-0"
               data-job-code="${code}" ${checked} />
        <span class="small">${label}</span>
      </label>
    `;
  }).join("");

  // event delegation (one listener)
  wrap.querySelectorAll("input[type=checkbox][data-job-code]").forEach((cb) => {
    cb.addEventListener("change", () => {
      const code = cb.getAttribute("data-job-code");
      if (!code) return;

      if (cb.checked) selectedJobCodes.add(code);
      else selectedJobCodes.delete(code);

      renderJobHourRows();
    });
  });
}

window.selectAllJobs = function (on) {
  if (on) {
    (allJobs || []).forEach(j => j?.job_code && selectedJobCodes.add(j.job_code));
  } else {
    selectedJobCodes.clear();
  }
  renderJobCheckboxes($("jobSearch")?.value || "");
  renderJobHourRows();
};


function renderJobHourRows() {
  const wrap = $("jobHoursContainer");
  if (!wrap) return;

  const codes = getSelectedJobCodes();

  if (!codes.length) {
    wrap.innerHTML = `<div class="text-muted small fst-italic">Select job(s) to enter hours.</div>`;
    return;
  }

  wrap.innerHTML = "";

  codes.forEach((code) => {
    const job = allJobs.find((j) => j.job_code === code);
    const label = job ? `${job.job_code} – ${job.job_type}` : code;

    const row = document.createElement("div");
    row.className = "input-group";

    row.innerHTML = `
      <span class="input-group-text" style="max-width: 260px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">
        ${label}
      </span>
      <input
        type="number"
        class="form-control"
        min="0"
        step="0.5"
        placeholder="Hours"
        data-job-hours="${code}"
      />
    `;

    wrap.appendChild(row);
  });
}

function getHoursByJobCode() {
  const codes = getSelectedJobCodes();
  const map = new Map();

  codes.forEach((code) => {
    const input = document.querySelector(`[data-job-hours="${code}"]`);
    const hours = input ? parseFloat(input.value) : NaN;
    map.set(code, hours);
  });

  return map;
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
  } catch {
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
      .filter((r) => r.enabled === 1 || r.enabled === true || r.is_default === 1 || r.is_default === true)
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

  // ✅ render checkbox list instead of <select multiple>
  selectedJobCodes.clear();
  renderJobCheckboxes($("jobSearch")?.value || "");


  if (hotBatch) {
    hotBatch.updateSettings({ columns: buildBatchColumns() });
    hotBatch.render();
  }

  renderJobHourRows();
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
  if (select) {
    select.innerHTML = `<option value="" disabled selected>Select worker</option>`;
    allWorkers.forEach((w) => {
      const opt = document.createElement("option");
      opt.value = w.id;
      opt.textContent = `${w.worker_code} – ${w.worker_name}`;
      select.appendChild(opt);
    });
  }

  if (hotBatch) {
    hotBatch.updateSettings({ columns: buildBatchColumns() });
    hotBatch.render();
  }
}

// ---------- DOMContentLoaded ----------
document.addEventListener("DOMContentLoaded", async () => {
  if (window.companyReady) await window.companyReady;
  await loadCompanyTitle();

  const companyId = getCompanyId();
  if (!companyId) console.warn("No companyId available yet.");

  rulesReady = loadEnabledCompanyRules();
  await Promise.all([loadJobs(), loadWorkers()]);

  // ✅ multi-job selector events
  const jobSearch = $("jobSearch");
  if (jobSearch) {
    jobSearch.addEventListener("input", () => {
      renderJobCheckboxes(jobSearch.value);
    });
  }


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

  applyBatchSwitchVisibility();

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
        if (!hotBatch) {
          const rowCount = parseInt($("batchRowCount")?.value, 10) || 10;
          initHotBatch(rowCount);
        }
        setTimeout(() => refreshHotBatch(), 0);
      }
    });
  }

  applyRatesVisibility();
});

window.addEventListener("resize", () => refreshHotBatch());

/* =========================
   Batch row count helpers
   ========================= */

window.applyBatchRowCount = function () {
  const rowInput = $("batchRowCount");
  let requested = parseInt(rowInput?.value, 10) || 10;

  if (requested < 1) requested = 1;
  if (requested > 500) requested = 500;
  if (rowInput) rowInput.value = requested;

  if (!hotBatch) return initHotBatch(requested);

  // ✅ ALWAYS work from ROOT parents only (never from getSourceData which may include children)
  const parents = getRootParentsForLoad(); // your helper already filters __type === "PARENT"

  // resize
  const next = parents.slice(0, requested);
  while (next.length < requested) next.push(makeEmptyParent());

  // ✅ keep the backing store in sync
  batchData = next;

  // ✅ reload only parents (nestedRows will read __children from them)
  hotBatch.loadData(batchData);
  refreshNestedRowsUI();
};


window.addBatchRow = function () {
  const rowInput = $("batchRowCount");

  if (!hotBatch) return initHotBatch(parseInt(rowInput?.value, 10) || 10);

  // ✅ root parents only
  const parents = getRootParentsForLoad();
  parents.push(makeEmptyParent());

  batchData = parents;

  hotBatch.loadData(batchData);
  refreshNestedRowsUI();

  if (rowInput) rowInput.value = batchData.length;
};


/* =========================
   SINGLE ENTRY MODE
   (UNCHANGED from your version)
   ========================= */

window.addEntryToTable = async function () {
  await rulesReady;

  const companyId = getCompanyId();

  const workerSelect = $("workerSelect");
  const dateInput = $("workDate");
  const jobNo1Input = $("jobNo1");
  const jobNo2Input = $("jobNo2");

  const useCustomOverride = $("useCustomOverride");
  const customCustomerRateInput = $("customCustomerRate");
  const customWageRateInput = $("customWageRate");

  const worker_id = workerSelect?.value;
  const work_date = norm(dateInput?.value);
  const job_no1 = norm(jobNo1Input?.value);
  const job_no2 = norm(jobNo2Input?.value);

  const note = norm($("note")?.value);
  const fees_collected = toMoney0($("feesCollected")?.value);
  const is_bank = $("isBank")?.checked ? 1 : 0;

  const jobCodes = getSelectedJobCodes();

  if (!worker_id || !work_date) return alert("Please select worker and choose a date.");
  if (!job_no1) return alert("Job No1 is required.");
  if (!jobCodes.length) return alert("Please select at least 1 job.");

  const worker = allWorkers.find((w) => String(w.id) === String(worker_id));
  if (!worker) return alert("Unable to find worker details.");
  if (!worker?.wage_tier_id) {
    return alert("This worker has no wage tier assigned yet. Please edit the worker and set a wage tier.");
  }

  const hoursMap = getHoursByJobCode();
  for (const code of jobCodes) {
    const h = Number(hoursMap.get(code));
    if (!Number.isFinite(h) || h <= 0) return alert(`Invalid hours for job "${code}" (must be > 0).`);
  }

  const lines = jobCodes.map((code) => {
    const job = allJobs.find((j) => j.job_code === code);
    if (!job) throw new Error(`Job not found: ${code}`);

    let customerRate = job.normal_price != null ? Number(job.normal_price) : 0;

    if (useCustomOverride?.checked) {
      const customCustomer = parseFloat(customCustomerRateInput?.value);
      if (!isNaN(customCustomer) && customCustomer > 0) customerRate = customCustomer;
    }

    if (!customerRate || customerRate <= 0) throw new Error(`No valid customer price for job "${code}"`);

    const hours = Number(hoursMap.get(code));
    const customerTotal = customerRate * hours;

    let wageRate = getBaseWageRate(job, worker);
    if (!isValidWageRate(wageRate)) {
      throw new Error(`No valid base wage for job "${code}" (check job wage tiers).`);
    }

    return {
      job_code: job.job_code,
      job_label: `${job.job_code} – ${job.job_type}`,
      hours,
      customer_rate: customerRate,
      customer_total: customerTotal,
      wage_rate: wageRate,
    };
  });

  const monthKey = work_date.slice(0, 7);
  if (enabledCompanyRules.includes("OVER_20K_5050")) {
    const mtdCustomer = await getMonthToDateCustomerTotal(companyId, worker.id, monthKey);
    const entryCustomerTotal = lines.reduce((s, x) => s + (Number(x.customer_total) || 0), 0);

    if (mtdCustomer + entryCustomerTotal >= 20000) {
      lines.forEach((x) => (x.wage_rate = x.customer_rate * 0.5));
    }
  }

  const customWageParsed = Number.parseFloat(customWageRateInput?.value);
  const hasCustomWage = useCustomOverride?.checked && Number.isFinite(customWageParsed) && customWageParsed !== 0;

  if (
    lines.length > 1 &&
    enabledCompanyRules.includes("MULTI_JOB_LOWEST_TIER_OTHERS_5050") &&
    !hasCustomWage
  ) {
    // Apply "others 50/50" + "extra hours of cheapest job also 50/50"
    // We do NOT split lines; we compute blended totals and set avg wage_rate.
    // This matches your example: cheapest job keeps base for first hour only.
    applyMultiJob5050WithExtraHours(lines);
  }


  if (useCustomOverride?.checked) {
    const customWage = Number.parseFloat(customWageRateInput?.value);
    if (Number.isFinite(customWage) && customWage !== 0) {
      lines.forEach((x) => (x.wage_rate = customWage));
    }
  }

  const jobs = lines.map((x) => ({
    ...x,
    wage_total: Number.isFinite(Number(x.wage_total))
      ? Number(x.wage_total)
      : (Number(x.wage_rate) || 0) * (Number(x.hours) || 0),
  }));


  pendingEntries.push({
    header: {
      company_id: companyId,
      worker_id: worker.id,
      worker_label: workerSelect?.options?.[workerSelect.selectedIndex]?.text || "",
      work_date,
      job_no1,
      job_no2,
      is_bank,
      fees_collected,
      note,
    },
    jobs,
  });

  renderPendingEntriesTable();
  clearSingleEntryForm();
};

/* =========================
   BATCH MODE (Handsontable nestedRows)
   ✅ FIX: nestedRows always shows (children are created correctly)
   ✅ FIX: editor Save commits via setDataAtRowProp(..., "msApply")
   ✅ FIX: refresh uses plugin.updatePlugin() (no loadData loops)
   ========================= */

function makeUid() {
  return `${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function makeEmptyParent() {
  const t = todayISO();
  return {
    __uid: makeUid(),
    __type: "PARENT",
    work_date: t,         // col 0
    job_no1: "",          // col 1
    job_no2: "",          // col 2
    worker_code: "",      // col 3
    job_type_cell: "",    // col 4
    hours: null,          // col 5 (unused on parent)
    cust_rate: null,      // col 6 (unused on parent)
    wage_rate: null,      // col 7 (unused on parent)
    fees_collected: null, // col 8
    bank: "",             // col 9
    note: "",             // col 10
    __children: [],       // ✅ nestedRows default children property
  };
}

function makeChild(job_type = "", hours = 0) {
  return {
    __uid: makeUid(),
    __type: "CHILD",
    work_date: "",
    job_no1: "",
    job_no2: "",
    worker_code: "",
    job_type_cell: job_type, // follows parent selection
    hours,                   // ✅ editable
    cust_rate: null,
    wage_rate: null,
    fees_collected: null,
    bank: "",
    note: "",
  };
}

const uniqTypes = (types) => {
  const out = [];
  const seen = new Set();
  (types || [])
    .map((t) => norm(t))
    .filter(Boolean)
    .forEach((t) => {
      const k = t.toLowerCase();
      if (seen.has(k)) return;
      seen.add(k);
      out.push(t);
    });
  return out;
};

function getParentTypes(parentObj) {
  // children already store codes in job_type_cell (we'll store job_code there)
  const fromChildren = (parentObj?.__children || [])
    .map((c) => norm(c?.job_type_cell))
    .filter(Boolean);

  if (fromChildren.length) return fromChildren;

  const fromString = norm(parentObj?.job_type_cell);
  if (!fromString) return [];
  return fromString.split(",").map((x) => x.trim()).filter(Boolean);
}


// ✅ safest refresh for nestedRows
function refreshNestedRowsUI() {
  const plugin = hotBatch.getPlugin("nestedRows");
  plugin?.updatePlugin?.();
  hotBatch.render();
}


function makeChildFromParent(parent, jobType) {
  return {
    __uid: makeUid(),
    __type: "CHILD",
    __parent_uid: parent.__uid,   // ✅ important
    work_date: parent.work_date,
    job_no1: parent.job_no1,
    job_no2: parent.job_no2,
    worker_code: parent.worker_code,
    job_type_cell: jobType, // child shows single job type
    hours: null,
    cust_rate: null,
    wage_rate: null,
    fees_collected: parent.fees_collected,
    bank: parent.bank,
    note: parent.note,
    __children: [] // children of child = none
  };
}

// visualRow is the row you get from afterChange "row"
function syncParentChildren(visualRow, types) {
  if (!hotBatch) return;

  isSyncingNested = true;
  try {
    const nr = hotBatch.getPlugin("nestedRows");
    if (!nr) return;

    const rowObj = hotBatch.getSourceDataAtRow(visualRow);
    if (!rowObj) return;

    const parentUid = rowObj.__type === "PARENT" ? rowObj.__uid : rowObj.__parent_uid;
    const parent = (batchData || []).find(p => p && p.__uid === parentUid);
    if (!parent) return;

    const cleanTypes = [...new Set((types || []).map(x => String(x ?? "").trim()).filter(Boolean))];

    // map existing children (preserve entered hours/rates when reselecting)
    const prevChildren = Array.isArray(parent.__children) ? parent.__children : [];
    const byType = new Map(prevChildren.map(ch => [norm(ch.job_type_cell).toLowerCase(), ch]));

    if (cleanTypes.length <= 1) {
      // ✅ SINGLE JOB => NO CHILD ROW
      // If we previously had children, pull values back into parent
      const first = prevChildren[0];
      if (first) {
        if (parent.hours == null) parent.hours = first.hours ?? null;
        if (parent.cust_rate == null) parent.cust_rate = first.cust_rate ?? null;
        if (parent.wage_rate == null) parent.wage_rate = first.wage_rate ?? null;
      }

      parent.__children = [];
      nr.updatePlugin();
      hotBatch.render();
      return;
    }

    // ✅ MULTI JOB => CHILD ROWS
    parent.hours = null;     // parent unused
    parent.cust_rate = null;
    parent.wage_rate = null;

    parent.__children = cleanTypes.map(t => {
      const prev = byType.get(t.toLowerCase());
      const child = makeChildFromParent(parent, t);

      // ✅ preserve existing inputs if any
      child.hours = prev?.hours ?? null;
      child.cust_rate = prev?.cust_rate ?? null;
      child.wage_rate = prev?.wage_rate ?? null;

      return child;
    });

    nr.updatePlugin();
    nr.expandChildren?.(visualRow);
    hotBatch.render();
  } finally {
    isSyncingNested = false;
  }
}




// Renderer: show selected job types as tags (for parent)
function jobTypesTagRenderer(instance, td, row, col, prop, value) {
  Handsontable.renderers.TextRenderer.apply(this, arguments);
  td.innerHTML = "";

  const s = String(value ?? "").trim();
  if (!s) return;

  const codes = s.split(",").map(x => x.trim()).filter(Boolean);

  codes.forEach((code) => {
    const job = (allJobs || []).find(j => String(j.job_code) === String(code));
    const label = job ? `${job.job_code} – ${job.job_type}` : code;

    const span = document.createElement("span");
    span.className = "tag";
    span.innerText = label;
    td.appendChild(span);
  });
}


// ✅ Multi-select editor (parent col 4)
class JobsMultiSelectEditor extends Handsontable.editors.BaseEditor {
  init() {
    // ✅ create first
    this.container = document.createElement("div");
    this.container.className = "multi-select-editor";
    this.container.style.display = "none";
    this.container.style.position = "absolute";
    this.container.style.zIndex = "99999";
    this.container.style.minWidth = "280px";

    // ✅ make it focusable (Escape handling / reduce aria-hidden spam)
    this.container.tabIndex = -1;

    document.body.appendChild(this.container);

    this.container.addEventListener("mousedown", (e) => e.stopPropagation());
    this.container.addEventListener("click", (e) => e.stopPropagation());

    this._onEsc = (e) => {
      if (e.key === "Escape") this.finishEditing(true);
    };
  }

  open() {
    const hot = this.hot || this.instance;
    if (!hot) return this.finishEditing(true);

    const cell = this.TD;
    if (!cell) return this.finishEditing(true);

    const rowObj = hot.getSourceDataAtRow(this.row);
    if (!rowObj || rowObj.__type !== "PARENT") return this.finishEditing(true);

    // position popup
    const rect = cell.getBoundingClientRect();
    this.container.style.display = "block";
    this.container.style.top = `${rect.bottom + window.scrollY}px`;
    this.container.style.left = `${rect.left + window.scrollX}px`;
    this.container.style.minWidth = `${Math.max(280, rect.width)}px`;

    // ✅ selectedSet persists across searches/renders (source of truth)
    // your cell currently stores job codes in job_type_cell
    const selectedSet = new Set(
      getParentTypes(rowObj)
        .map((x) => norm(x).toLowerCase())
        .filter(Boolean)
    );

    const jobs = (allJobs || [])
      .map((j) => ({
        code: norm(j.job_code),
        type: norm(j.job_type),
        label: `${norm(j.job_code)} – ${norm(j.job_type)}`.trim(),
        key: norm(j.job_code).toLowerCase(), // ✅ store by code
      }))
      .filter((j) => j.code && j.type);

    // UI skeleton
    this.container.innerHTML = `
      <div class="p-2" style="width: 340px;">
        <div class="d-flex gap-2 mb-2">
          <input id="ms-search" class="form-control form-control-sm" placeholder="Search job code / type..." />
          <button type="button" class="btn btn-outline-secondary btn-sm" id="ms-all">All</button>
          <button type="button" class="btn btn-outline-secondary btn-sm" id="ms-none">None</button>
        </div>

        <div id="ms-list" class="border rounded-2" style="max-height: 220px; overflow:auto; background:#fff;"></div>

        <hr class="my-2">
        <div class="d-flex gap-2">
          <button type="button" class="btn btn-sm btn-primary flex-grow-1" id="ms-apply">Save</button>
          <button type="button" class="btn btn-sm btn-outline-secondary" id="ms-cancel">Cancel</button>
        </div>
      </div>
    `;

    const listEl = this.container.querySelector("#ms-list");
    const searchEl = this.container.querySelector("#ms-search");
    const btnAll = this.container.querySelector("#ms-all");
    const btnNone = this.container.querySelector("#ms-none");
    const btnApply = this.container.querySelector("#ms-apply");
    const btnCancel = this.container.querySelector("#ms-cancel");

    const renderList = (q = "") => {
      const query = norm(q).toLowerCase();

      const filtered = !query
        ? jobs
        : jobs.filter((j) => j.label.toLowerCase().includes(query));

      if (!filtered.length) {
        listEl.innerHTML = `<div class="text-muted small fst-italic p-2">No matching jobs.</div>`;
        return;
      }

      listEl.innerHTML = filtered
        .map((j) => {
          const safeId = `ms-${encodeURIComponent(j.code)}`;
          const checked = selectedSet.has(j.key) ? "checked" : "";
          return `
            <label for="${safeId}"
                   class="d-flex align-items-center gap-2 px-2 py-1 rounded-2"
                   style="cursor:pointer;">
              <input type="checkbox" id="${safeId}" data-key="${j.key}" value="${j.code}" ${checked} />
              <span class="small">${j.label}</span>
            </label>
          `;
        })
        .join("");

      // ✅ bind events AFTER rendering
      listEl.querySelectorAll('input[type="checkbox"]').forEach((cb) => {
        cb.addEventListener("change", () => {
          const key = cb.dataset.key;
          if (!key) return;
          if (cb.checked) selectedSet.add(key);
          else selectedSet.delete(key);
        });
      });
    };

    // initial render
    renderList("");

    // search (re-render but preserve selection via selectedSet)
    searchEl.addEventListener("input", () => renderList(searchEl.value));

    // All / None (affects all jobs, then re-render current filter)
    btnAll.onclick = () => {
      selectedSet.clear();
      jobs.forEach((j) => selectedSet.add(j.key));
      renderList(searchEl.value);
    };

    btnNone.onclick = () => {
      selectedSet.clear();
      renderList(searchEl.value);
    };

    // Save
    btnApply.onclick = () => {
      const selectedCodes = Array.from(selectedSet.values())
        .map((codeLower) => {
          // selectedSet stores lower-case code; find original code to preserve casing
          const j = jobs.find((x) => x.key === codeLower);
          return j ? j.code : null;
        })
        .filter(Boolean);

      if (!selectedCodes.length) return alert("Please select at least 1 job.");

      hot.setDataAtRowProp(this.row, "job_type_cell", selectedCodes.join(", "), "msApply");
      this.finishEditing(false);
    };

    btnCancel.onclick = () => this.finishEditing(true);

    document.addEventListener("keydown", this._onEsc);

    // focus search
    setTimeout(() => searchEl.focus(), 0);
  }

  close() {
    if (this.container) this.container.style.display = "none";
    document.removeEventListener("keydown", this._onEsc);
  }

  getValue() {
    return this.value ?? "";
  }

  setValue(v) {
    this.value = v ?? "";
  }

  focus() {}
}

function buildBatchColumns() {
  return [
    { data: "work_date", type: "date", dateFormat: "YYYY-MM-DD", correctFormat: true, allowInvalid: true }, // 0
    { data: "job_no1", type: "text" }, // 1
    { data: "job_no2", type: "text" }, // 2
    {
      data: "worker_code",
      type: "dropdown",
      strict: false,
      allowInvalid: true,
      source: (q, cb) => cb((allWorkers || []).map((w) => w.worker_code)),
    }, // 3
    { data: "job_type_cell", type: "text" }, // 4
    { data: "hours", type: "numeric", numericFormat: { pattern: "0.0" } }, // 5
    { data: "cust_rate", type: "numeric", numericFormat: { pattern: "0.00" } }, // 6
    { data: "wage_rate", type: "numeric", numericFormat: { pattern: "0.00" } }, // 7
    { data: "fees_collected", type: "numeric", numericFormat: { pattern: "0.00" } }, // 8
    {
      data: "bank",
      type: "text",
      validator: (value, cb) => {
        const v = norm(value).toUpperCase();
        cb(v === "" || v === "Y" || v === "N");
      },
    }, // 9
    { data: "note", type: "text" }, // 10
  ];
}

function initHotBatch(rowCount = 10) {
  const container = $("hotBatch");
  if (!container) return;

   // ✅ prevent multiple HOT instances stacking
  if (hotBatch) {
    hotBatch.destroy();
    hotBatch = null;
    container.innerHTML = "";
  }

  batchData = Array.from({ length: rowCount }, () => makeEmptyParent());
  const showRates = canSeeRates();

  hotBatch = new Handsontable(container, {
    data: batchData,
    nestedRows: { childrenProperty: "__children" },
    rowHeaders: true,
    stretchH: "all",
    width: "100%",
    licenseKey: "non-commercial-and-evaluation",
    outsideClickDeselects: false,

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
    columns: buildBatchColumns(),

    hiddenColumns: { columns: showRates ? [] : [6, 7], indicators: true },

    cells: function (row, col) {
      const props = {};
      const r = this.instance.getSourceDataAtRow(row) || {};
      const isChild = r.__type === "CHILD";

      const childCount = Array.isArray(r.__children) ? r.__children.length : 0;
      const isSingleJobParent = !isChild && childCount === 0 && norm(r.job_type_cell) !== "";

      // =========================
      // CHILD ROW RULES
      // =========================
      if (isChild) {
        // Job Type follows parent (not editable)
        if (col === 4) props.readOnly = true;

        // ✅ editable fields on child rows
        if (col === 5 || col === 6 || col === 7) props.readOnly = false;

        // ✅ lock everything else on child rows
        if ([0, 1, 2, 3, 8, 9, 10].includes(col)) props.readOnly = true;
      }

      // =========================
      // PARENT ROW RULES
      // =========================
      if (!isChild) {
        // multi-job parent => these are driven by child rows
        if (!isSingleJobParent) {
          if (col === 5 || col === 6 || col === 7) props.readOnly = true;
        } else {
          // ✅ single-job parent => allow Hours + CustRate + Wage
          if (col === 5 || col === 6 || col === 7) props.readOnly = false;
        }
      }

      // =========================
      // JOB TYPE COLUMN (col 4)
      // =========================
      if (col === 4) {
        if (!isChild) {
          props.editor = JobsMultiSelectEditor;
          props.renderer = jobTypesTagRenderer;
          props.type = "text";
        } else {
          props.type = "text";
          props.readOnly = true;

          // ✅ child job type display: show "JOB_CODE – JOB_TYPE"
          props.renderer = function (instance, td, row, col, prop, value) {
            Handsontable.renderers.TextRenderer.apply(this, arguments);

            const code = norm(value);
            const job = (allJobs || []).find((j) => String(j.job_code) === String(code));

            td.textContent = job ? `${job.job_code} – ${job.job_type}` : code;
          };
        }
      }

      // ---- add these near the end, before `return props;` ----
      props.className = props.className || "";

      if (isChild) props.className += " ht-child-row";
      if (props.readOnly) props.className += " ht-readonly-cell";
      if (!props.readOnly) props.className += " ht-editable-cell";
      if (!props.readOnly && (col === 5 || col === 6 || col === 7)) {
        props.className += " ht-editable-focus";
      }


      return props;
    },


    afterOnCellMouseDown: function (event, coords) {
      if (!coords || coords.row < 0 || coords.col < 0) return;
      if (coords.col !== 4) return;

      const rowObj = this.getSourceDataAtRow(coords.row);
      if (!rowObj || rowObj.__type !== "PARENT") return;

      event?.preventDefault?.();
      event?.stopPropagation?.();

      this.selectCell(coords.row, coords.col);

      setTimeout(() => {
        const ed = this.getActiveEditor();
        if (ed && typeof ed.beginEditing === "function") ed.beginEditing();
      }, 0);
    },

    afterChange: (changes, source) => {
      if (!changes) return;
      if (isSyncingNested) return;
      if (source === "loadData" || source === "bankUpper" || source === "internal") return;

      // ✅ ignore our internal child write
      if (source === "syncChildren") return;

      if (source !== "msApply") return;

      for (const [row, prop, oldVal, newVal] of changes) {
        if (prop === "job_type_cell") {
          const raw = norm(newVal);
          const types = raw ? raw.split(",").map(s => s.trim()).filter(Boolean) : [];
          syncParentChildren(row, types);
        }
      }
    }


  });

  refreshNestedRowsUI();
}

function getRootParentsForLoad() {
  const src = hotBatch.getSourceData() || [];

  // IMPORTANT: only keep real parents in root level
  return src
    .filter(r => r && r.__type === "PARENT")
    .map(p => ({
      ...p,
      __children: Array.isArray(p.__children) ? p.__children : [],
    }));
}


function clearBatchGrid() {
  if (!hotBatch) return;

  const rowCount =
    parseInt($("batchRowCount")?.value, 10) ||
    getRootParentsForLoad().length ||
    10;

  batchData = Array.from({ length: rowCount }, () => makeEmptyParent());
  hotBatch.loadData(batchData);
  refreshNestedRowsUI();
}


/* =========================
   Batch -> Pending (nestedRows)
   ========================= */

window.addBatchRowsToPending = async function () {
  await rulesReady;
  if (!hotBatch) return alert("Batch grid is not ready.");

  const failures = [];
  let addedGroups = 0;

  const isValidDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(norm(s));
  const rowNo = (i) => i + 1; // grid row number (1-based)

  // ✅ iterate over the REAL backing store with real row indexes
  const src = Array.isArray(batchData) ? batchData : [];

  for (let i = 0; i < src.length; i++) {
    const p = src[i];
    if (!p || p.__type !== "PARENT") continue;

    const work_date = norm(p.work_date);
    const job_no1 = norm(p.job_no1);
    const job_no2 = norm(p.job_no2);
    const worker_code = norm(p.worker_code);

    const bankRaw = norm(p.bank).toLowerCase();
    const is_bank = bankRaw === "y" ? 1 : 0;

    const note = norm(p.note) || null;
    const fees_collected = norm(p.fees_collected) === "" ? 0 : toMoney0(p.fees_collected);

    const children = Array.isArray(p.__children) ? p.__children : [];

    // ignore totally empty parent (only date)
    const looksEmpty =
      !job_no1 && !job_no2 && !worker_code && !children.length && norm(p.job_type_cell) === "";
    if (looksEmpty) continue;

    // validate parent
    if (!work_date || !isValidDate(work_date)) {
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
    const parentJob = norm(p.job_type_cell);

    const isSingleJob = !children.length && parentJob !== "";

    if (!children.length && !parentJob) {
      failures.push({ rowIndex: i, reason: "No job lines (select jobs in parent Job Type column)" });
      continue;
    }


    const worker = allWorkers.find(
      (w) => (w.worker_code || "").toLowerCase() === worker_code.toLowerCase()
    );
    if (!worker) {
      failures.push({ rowIndex: i, reason: `Worker not found: "${worker_code}"` });
      continue;
    }
    if (!worker?.wage_tier_id) {
      failures.push({ rowIndex: i, reason: `Worker has no wage tier: "${worker_code}"` });
      continue;
    }

    // ✅ build job lines (single-job from parent OR multi-job from children)
    const jobs = [];
    const seen = new Set();

    if (isSingleJob) {
      // --- SINGLE JOB: build from parent row ---
      const job_input = parentJob;
      const hours = Number(p.hours);

      if (!Number.isFinite(hours) || hours <= 0) {
        failures.push({ rowIndex: i, reason: `Invalid Hours (must be > 0)` });
        jobs.length = 0;
      } else {
        const job =
          allJobs.find((j) => String(j.job_type || "").toLowerCase() === job_input.toLowerCase()) ||
          allJobs.find((j) => String(j.job_code || "").toLowerCase() === job_input.toLowerCase());

        if (!job) {
          failures.push({ rowIndex: i, reason: `Job not found: "${job_input}"` });
        } else {
          // ✅ allow override from parent CustRate / Wage columns if provided
          let customerRate =
            Number(p.cust_rate) > 0
              ? Number(p.cust_rate)
              : (job.normal_price != null && Number(job.normal_price) > 0 ? Number(job.normal_price) : null);

          if (customerRate == null) {
            failures.push({ rowIndex: i, reason: `Missing customer price for "${job.job_type}"` });
          } else {
            let wageRate =
              isValidWageRate(Number(p.wage_rate))
                ? Number(p.wage_rate)
                : getBaseWageRate(job, worker);

            if (!isValidWageRate(wageRate)) {
              failures.push({ rowIndex: i, reason: `Missing wage rate for "${job.job_type}"` });
            } else {
              const customerTotal = customerRate * hours;

              const monthKey = work_date.slice(0, 7);
              if (enabledCompanyRules.includes("OVER_20K_5050")) {
                const mtdCustomer = await getMonthToDateCustomerTotal(getCompanyId(), worker.id, monthKey);
                if (mtdCustomer + customerTotal >= 20000) wageRate = customerRate * 0.5;
              }

              const wageTotal = wageRate * hours;

              jobs.push({
                job_id: job.id,
                job_code: job.job_code,
                job_label: `${job.job_code} – ${job.job_type}`,
                hours,
                customer_rate: customerRate,
                customer_total: customerTotal,
                wage_tier_id: worker.wage_tier_id,
                wage_rate: wageRate,
                wage_total: wageTotal,
                rate: wageRate,
                pay: wageTotal,
              });
            }
          }
        }
      }
    } else {
      // --- MULTI JOB: build from children rows ---
      for (let c = 0; c < children.length; c++) {
        const ch = children[c] || {};
        const job_input = norm(ch.job_type_cell);
        const hours = Number(ch.hours);

        if (!job_input) {
          failures.push({ rowIndex: i, reason: `Child ${c + 1}: Missing Job Type (follows parent)` });
          jobs.length = 0;
          break;
        }
        if (!Number.isFinite(hours) || hours <= 0) {
          failures.push({ rowIndex: i, reason: `Child ${c + 1}: Invalid Hours (must be > 0)` });
          jobs.length = 0;
          break;
        }
        if (seen.has(job_input.toLowerCase())) {
          failures.push({ rowIndex: i, reason: `Duplicate job in same entry: ${job_input}` });
          jobs.length = 0;
          break;
        }
        seen.add(job_input.toLowerCase());

        const job =
          allJobs.find((j) => String(j.job_type || "").toLowerCase() === job_input.toLowerCase()) ||
          allJobs.find((j) => String(j.job_code || "").toLowerCase() === job_input.toLowerCase());

        if (!job) {
          failures.push({ rowIndex: i, reason: `Job not found: "${job_input}"` });
          jobs.length = 0;
          break;
        }

        // ✅ allow override from child CustRate / Wage columns if provided
        let customerRate =
          Number(ch.cust_rate) > 0
            ? Number(ch.cust_rate)
            : (job.normal_price != null && Number(job.normal_price) > 0 ? Number(job.normal_price) : null);

        if (customerRate == null) {
          failures.push({ rowIndex: i, reason: `Missing customer price for "${job.job_type}"` });
          jobs.length = 0;
          break;
        }

        let wageRate =
          isValidWageRate(Number(ch.wage_rate))
            ? Number(ch.wage_rate)
            : getBaseWageRate(job, worker);

        if (!isValidWageRate(wageRate)) {
          failures.push({ rowIndex: i, reason: `Missing wage rate for "${job.job_type}"` });
          jobs.length = 0;
          break;
        }

        const customerTotal = customerRate * hours;

        const monthKey = work_date.slice(0, 7);
        if (enabledCompanyRules.includes("OVER_20K_5050")) {
          const mtdCustomer = await getMonthToDateCustomerTotal(getCompanyId(), worker.id, monthKey);
          if (mtdCustomer + customerTotal >= 20000) wageRate = customerRate * 0.5;
        }

        const wageTotal = wageRate * hours;

        jobs.push({
          job_id: job.id,
          job_code: job.job_code,
          job_label: `${job.job_code} – ${job.job_type}`,
          hours,
          customer_rate: customerRate,
          customer_total: customerTotal,
          wage_tier_id: worker.wage_tier_id,
          wage_rate: wageRate,
          wage_total: wageTotal,
          rate: wageRate,
          pay: wageTotal,
        });
      }
    }

    const hasCustomWageOverride = false; 
    // (batch mode: “custom override” is basically handled by wage_rate/cust_rate cell values already)

    if (
      jobs.length > 1 &&
      enabledCompanyRules.includes("MULTI_JOB_LOWEST_TIER_OTHERS_5050") &&
      !hasCustomWageOverride
    ) {
      applyMultiJob5050WithExtraHours(jobs);
    }


    if (!jobs.length) continue;

    pendingEntries.push({
      header: {
        work_date,
        job_no1,
        job_no2: job_no2 || null,
        worker_id: worker.id,
        worker_label: `${worker.worker_code} – ${worker.worker_name}`,
        is_bank,
        note,
        fees_collected: Number(fees_collected || 0),
      },
      jobs,
    });

    addedGroups++;

    // ✅ clear parent row IN-PLACE
    p.work_date = todayISO();
    p.job_no1 = "";
    p.job_no2 = "";
    p.worker_code = "";
    p.job_type_cell = "";
    p.hours = null;
    p.cust_rate = null;
    p.wage_rate = null;
    p.fees_collected = null;
    p.bank = "";
    p.note = "";
    p.__children = [];
  }

  renderPendingEntriesTable();

  const nr = hotBatch.getPlugin("nestedRows");
  nr?.updatePlugin?.();
  hotBatch.render();

  let msg = `Added ${addedGroups} grouped entry(ies) to pending table.`;
  if (failures.length) {
    msg += `\n\n${failures.length} row(s) NOT added:\n`;
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

function applyMultiJob5050WithExtraHours(jobs) {
  // jobs: [{ hours, customer_rate, wage_rate, wage_total, ... }]
  // Rule:
  // - If multiple jobs:
  //   - Find the lowest BASE wage_rate job (before any 50/50 changes)
  //   - All other jobs => wage_rate = customer_rate * 0.5
  //   - Lowest job:
  //       first 1 hour = base wage_rate
  //       remaining hours (if any) = 50/50
  //     wage_total becomes blended, wage_rate becomes avg = wage_total / hours

  if (!Array.isArray(jobs) || jobs.length <= 1) return;

  // capture original/base wage rates for comparison
  const baseRates = jobs.map((j) => Number(j.wage_rate || 0));
  let minIdx = 0;
  let minRate = Infinity;

  baseRates.forEach((r, idx) => {
    if (Number.isFinite(r) && r > 0 && r < minRate) {
      minRate = r;
      minIdx = idx;
    }
  });

  // if we can't find a valid min rate, do nothing
  if (!Number.isFinite(minRate) || minRate === 0) return;

  for (let i = 0; i < jobs.length; i++) {
    const j = jobs[i];
    const hours = Number(j.hours || 0);
    const cust = Number(j.customer_rate || 0);
    const base = Number(baseRates[i] || 0);

    if (!Number.isFinite(hours) || hours <= 0) continue;
    if (!Number.isFinite(cust) || cust <= 0) continue;

    if (i !== minIdx) {
      // other jobs => 50/50 all hours
      const r5050 = cust * 0.5;
      j.wage_rate = r5050;
      j.wage_total = r5050 * hours;
      j.rate = j.wage_rate;
      j.pay = j.wage_total;
      continue;
    }

    // cheapest job: first 1 hour base, rest 50/50 (if any)
    if (!Number.isFinite(base) || base === 0) continue;

    if (hours <= 1) {
      j.wage_rate = base;
      j.wage_total = base * hours;
      j.rate = j.wage_rate;
      j.pay = j.wage_total;
      continue;
    }

    const extraHours = hours - 1;
    const r5050 = cust * 0.5;
    const blendedTotal = base * 1 + r5050 * extraHours;

    j.wage_total = blendedTotal;

    // show an average wage_rate so UI/exports look consistent
    j.wage_rate = blendedTotal / hours;

    j.rate = j.wage_rate;
    j.pay = j.wage_total;
  }
}


function getBaseWageRate(job, worker) {
  const tierId = worker?.wage_tier_id;
  if (!job || !tierId) return null;

  const match = (job.wage_rates || []).find((x) => Number(x.tier_id) === Number(tierId));
  const rate = Number(match?.wage_rate);

  return Number.isFinite(rate) && rate !== 0 ? rate : null;
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
    .filter(
      (e) =>
        String(e?.header?.worker_id) === String(workerId) && getMonthKey(e?.header?.work_date) === monthKey
    )
    .reduce((sum, e) => {
      const jobs = Array.isArray(e.jobs) ? e.jobs : [];
      return sum + jobs.reduce((s2, j) => s2 + (Number(j.customer_total) || 0), 0);
    }, 0);

  return dbTotal + pendingTotal;
}

/* =========================
   PENDING TABLE + SAVE
   (same as your version)
   ========================= */

function renderPendingEntriesTable() {
  const tbody = $("workEntriesBody");
  const wageTotalCell = $("grandTotalCell");
  const customerTotalCell = $("grandCustomerTotalCell");
  if (!tbody) return;

  tbody.innerHTML = "";

  let grandWageTotal = 0;
  let grandFeesTotal = 0;

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

  let rowIndex = 0;

  pendingEntries.forEach((entry, entryIndex) => {
    const h = entry.header || {};
    const jobs = Array.isArray(entry.jobs) ? entry.jobs : [];
    const payTypeText = h.is_bank ? "Bank" : "Cash";

    const entryWageTotal = jobs.reduce((s, j) => s + (Number(j.wage_total) || 0), 0);
    grandWageTotal += entryWageTotal;
    grandFeesTotal += Number(h.fees_collected || 0);

    if (jobs.length === 1) {
      const j = jobs[0];
      rowIndex += 1;

      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${rowIndex}</td>
        <td data-raw-date="${h.work_date}">${formatDateDMY(h.work_date)}</td>
        <td>${h.job_no1 || "-"}</td>
        <td>${h.job_no2 || "-"}</td>
        <td>${h.worker_label || "-"}</td>
        <td>${j.job_label || j.job_code || "-"}</td>
        <td>${Number(j.hours || 0).toFixed(1)}</td>
        <td>${payTypeText}</td>
        <td>${Number(h.fees_collected || 0).toFixed(2)}</td>

        <td data-col="cust_rate">${Number(j.customer_rate || 0).toFixed(2)}</td>
        <td data-col="cust_total">${Number(j.customer_total || 0).toFixed(2)}</td>
        <td data-col="wage_rate">${Number(j.wage_rate || 0).toFixed(2)}</td>
        <td data-col="wage_total">${Number(j.wage_total || 0).toFixed(2)}</td>

        <td class="text-muted small">${h.note ? h.note : "-"}</td>
        <td>
          <button class="btn btn-sm btn-outline-danger"
            data-action="delete-pending"
            ${isSavingEntries ? "disabled" : ""}
            onclick="removePendingEntry(${entryIndex})">
            Delete
          </button>
        </td>
      `;
      tbody.appendChild(tr);
      return;
    }

    rowIndex += 1;
    const entryCustTotal = jobs.reduce((s, j) => s + (Number(j.customer_total) || 0), 0);

    const trParent = document.createElement("tr");
    trParent.className = "table-light";
    trParent.innerHTML = `
      <td class="fw-bold">${rowIndex}</td>
      <td data-raw-date="${h.work_date}">${formatDateDMY(h.work_date)}</td>
      <td class="fw-bold">${h.job_no1 || "-"}</td>
      <td>${h.job_no2 || "-"}</td>
      <td>${h.worker_label || "-"}</td>
      <td class="fw-bold">ENTRY</td>
      <td></td>
      <td>${payTypeText}</td>
      <td class="fw-bold">${Number(h.fees_collected || 0).toFixed(2)}</td>

      <td data-col="cust_rate"></td>
      <td data-col="cust_total">${entryCustTotal ? entryCustTotal.toFixed(2) : ""}</td>
      <td data-col="wage_rate"></td>
      <td data-col="wage_total">${entryWageTotal ? entryWageTotal.toFixed(2) : ""}</td>

      <td class="text-muted small">${h.note ? h.note : "-"}</td>
      <td>
        <button class="btn btn-sm btn-outline-danger"
          data-action="delete-pending"
          ${isSavingEntries ? "disabled" : ""}
          onclick="removePendingEntry(${entryIndex})">
          Delete
        </button>
      </td>
    `;
    tbody.appendChild(trParent);

    jobs.forEach((j) => {
      const trChild = document.createElement("tr");
      trChild.className = "child-row";
      trChild.innerHTML = `
        <td></td><td></td><td></td><td></td><td></td>
        <td style="padding-left:24px;">${j.job_label || j.job_code || "-"}</td>
        <td>${Number(j.hours || 0).toFixed(1)}</td>
        <td></td>
        <td></td>

        <td data-col="cust_rate">${Number(j.customer_rate || 0).toFixed(2)}</td>
        <td data-col="cust_total">${Number(j.customer_total || 0).toFixed(2)}</td>
        <td data-col="wage_rate">${Number(j.wage_rate || 0).toFixed(2)}</td>
        <td data-col="wage_total">${Number(j.wage_total || 0).toFixed(2)}</td>

        <td></td><td></td>
      `;
      tbody.appendChild(trChild);
    });
  });

  if (wageTotalCell) wageTotalCell.textContent = grandWageTotal.toFixed(2);
  if (customerTotalCell) customerTotalCell.textContent = grandFeesTotal.toFixed(2);

  applyRatesVisibility();
}

window.removePendingEntry = function (index) {
  if (isSavingEntries) return;
  pendingEntries.splice(index, 1);
  renderPendingEntriesTable();
};

function validatePendingEntryGrouped(entry) {
  const errors = [];
  const h = entry?.header || {};
  const jobs = entry?.jobs || [];

  if (!h.worker_id) errors.push("worker_id missing");
  if (!norm(h.job_no1)) errors.push("job_no1 missing");
  if (!h.work_date) errors.push("work_date missing");
  if (!Array.isArray(jobs) || jobs.length < 1) errors.push("jobs[] missing");

  const fees = Number(h.fees_collected || 0);
  if (!Number.isFinite(fees) || fees < 0) errors.push("fees_collected invalid");

  jobs.forEach((j, idx) => {
    if (!j.job_code) errors.push(`job[${idx}] job_code missing`);
    const hrs = Number(j.hours);
    if (!Number.isFinite(hrs) || hrs <= 0) errors.push(`job[${idx}] hours invalid`);
  });

  return errors;
}

window.confirmEntries = async function () {
  const companyId = getCompanyId();

  if (pendingEntries.length === 0) return alert("No entries to save.");
  if (!confirm("Save all entries to the database?")) return;

  setSavingUI(true);

  try {
    const validationFailures = pendingEntries
      .map((e, idx) => ({ row: idx + 1, errors: validatePendingEntryGrouped(e) }))
      .filter((x) => x.errors.length);

    if (validationFailures.length) {
      alert(
        "Fix these entries before saving:\n\n" +
          validationFailures.map((x) => `Entry ${x.row}: ${x.errors.join(", ")}`).join("\n")
      );
      return;
    }

    const results = await Promise.allSettled(
      pendingEntries.map((entry) => {
        const h = entry.header;
        const jobs = entry.jobs;

        return fetch("/api/work-entries", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            company_id: companyId,
            worker_id: h.worker_id,
            work_date: h.work_date,
            job_no1: h.job_no1,
            job_no2: h.job_no2 || null,
            fees_collected: Number(h.fees_collected || 0),
            is_bank: h.is_bank ? 1 : 0,
            note: h.note || null,
            jobs: jobs.map((j) => ({
            job_code: j.job_code,

            // ✅ backend usually expects this
            amount: j.hours,

            // (optional) keep hours too if you want, but amount is the key
            hours: j.hours,

            customer_rate: j.customer_rate,
            customer_total: j.customer_total,
            wage_rate: j.wage_rate,
            wage_total: j.wage_total,

            wage_tier_id: j.wage_tier_id ?? null, // ✅ also good to include
            rate: j.wage_rate,
            pay: j.wage_total,
          })),
          }),
        }).then(async (r) => {
          const data = await r.json().catch(() => ({}));
          if (!r.ok) throw new Error(data?.error || `HTTP ${r.status}`);
          if (data?.error) throw new Error(data.error);
          return data;
        });
      })
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
      `Saved ${succeededCount} entry(s). ${failed.length} entry(s) failed and were kept in Pending:\n\n` +
        failed.map((x) => `Entry ${x.row}: ${x.error}`).join("\n")
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
