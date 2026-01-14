// records.js (UPDATED: clearer single vs multi, + collapse/expand for child rows)

let recordsCache = [];
let filteredRecords = [];
let recordsPage = 1;
let recordsPageSize = 10;
let recordsFilterActive = false;

let jobsCache = [];      // [{id, job_code, job_type, customer_rate, wage_rates:[...]}]
let tiersCache = [];     // [{id, tier_name}]
let workersCache = [];

function norm(v) { return String(v ?? "").trim(); }

// ---------- small UI helpers ----------
function injectRecordsStylesOnce() {
  if (document.getElementById("recordsStyles")) return;

  const style = document.createElement("style");
  style.id = "recordsStyles";
  style.textContent = `
    /* parent / child visuals */
    #recordsBody tr.record-parent { background: #f8f9fa; }
    #recordsBody tr.record-child td { background: #fff; }
    #recordsBody tr.record-child td.child-job { padding-left: 28px; position: relative; }
    #recordsBody tr.record-child td.child-job:before {
      content: "↳";
      position: absolute;
      left: 10px;
      opacity: .6;
    }

    /* badges */
    .badge-single, .badge-multi {
      display: inline-block;
      font-size: 11px;
      line-height: 1;
      padding: 4px 6px;
      border-radius: 999px;
      margin-left: 8px;
      border: 1px solid rgba(0,0,0,.15);
      opacity: .85;
      vertical-align: middle;
      user-select: none;
    }
    .badge-single { background: rgba(25,135,84,.08); }  /* bootstrap "success" tint */
    .badge-multi { background: rgba(13,110,253,.08); }  /* bootstrap "primary" tint */

    /* toggle button */
    .record-toggle {
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
      width: 30px;
      text-align: center;
    }
  `;
  document.head.appendChild(style);
}

function isRowVisible(tr) {
  if (!tr) return false;
  // if collapsed, we set style.display="none"
  return tr.style.display !== "none";
}

// ---------- workers ----------
async function loadWorkersForCompany(companyId) {
  const res = await fetch(`/api/workers?companyId=${companyId}`);
  const data = await res.json().catch(() => []);
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  workersCache = Array.isArray(data) ? data : [];
  return workersCache;
}

function buildWorkerOptions(selectEl, workers, selectedWorkerId) {
  if (!selectEl) return;
  selectEl.innerHTML = "";

  workers
    .filter(w => Number(w.is_active ?? 1) === 1)
    .forEach(w => {
      const opt = document.createElement("option");
      opt.value = String(w.id);
      opt.textContent =
        `${w.worker_code || ""}${w.worker_name ? " - " + w.worker_name : ""}`.trim() || `Worker #${w.id}`;
      if (Number(w.id) === Number(selectedWorkerId)) opt.selected = true;
      selectEl.appendChild(opt);
    });

  if (selectedWorkerId && !workers.some(w => Number(w.id) === Number(selectedWorkerId))) {
    const opt = document.createElement("option");
    opt.value = String(selectedWorkerId);
    opt.textContent = `Worker #${selectedWorkerId} (missing)`;
    opt.selected = true;
    selectEl.insertBefore(opt, selectEl.firstChild);
  }
}

// ---------- grouping ----------
function entryGroupKey(e) {
  return [
    norm(e.work_date),
    norm(e.job_no1).toLowerCase(),
    norm(e.job_no2).toLowerCase(),
    String(e.worker_id ?? ""),
    String(e.is_bank ?? ""),
    String(Number(e.fees_collected ?? 0) || 0),
    norm(e.note).toLowerCase(),
  ].join("|");
}

function getVisibleFlatRows() {
  return recordsFilterActive ? filteredRecords : recordsCache;
}

function buildGroupedEntries(flatRows) {
  const map = new Map();

  (flatRows || []).forEach((r) => {
    const key = entryGroupKey(r);
    if (!map.has(key)) {
      map.set(key, {
        __key: key,
        header: {
          work_date: r.work_date,
          job_no1: r.job_no1,
          job_no2: r.job_no2,
          worker_id: r.worker_id,
          worker_code: r.worker_code,
          worker_name: r.worker_name,
          is_bank: Number(r.is_bank) === 1 ? 1 : 0,
          fees_collected: Number(r.fees_collected ?? 0) || 0,
          note: r.note || "",
        },
        lines: [],
      });
    }

    map.get(key).lines.push({
      id: r.id,
      job_code: r.job_code,
      job_type: r.job_type,
      amount: Number(r.amount ?? 0) || 0,
      customer_rate: Number(r.customer_rate ?? 0) || 0,
      customer_total: Number(r.customer_total ?? 0) || 0,
      wage_rate: Number(r.wage_rate ?? r.rate ?? 0) || 0,
      wage_total: Number(r.wage_total ?? r.pay ?? 0) || 0,
      note: r.note || "",
      wage_tier_id: r.wage_tier_id ?? null,
      is_bank: Number(r.is_bank) === 1 ? 1 : 0, // for editing convenience
      worker_id: r.worker_id ?? null,           // for editing convenience
      work_date: r.work_date,
      job_no1: r.job_no1,
      job_no2: r.job_no2,
      worker_code: r.worker_code,
      worker_name: r.worker_name,
      fees_collected: r.fees_collected,
    });
  });

  const groups = Array.from(map.values());
  groups.sort((a, b) => {
    const da = a.header.work_date || "";
    const db = b.header.work_date || "";
    if (da !== db) return da.localeCompare(db);
    const ja = (a.header.job_no1 || "").localeCompare(b.header.job_no1 || "");
    if (ja !== 0) return ja;
    return String(a.header.worker_id || "").localeCompare(String(b.header.worker_id || ""));
  });

  return groups;
}

function getVisibleGroups() {
  return buildGroupedEntries(getVisibleFlatRows());
}

function getVisibleRecords() {
  return getVisibleGroups();
}

function groupWorkerLabel(h) {
  const code = h.worker_code || "";
  const name = h.worker_name || "";
  const t = `${code}${name ? " - " + name : ""}`.trim();
  return t || "-";
}

function groupJobLabel(line) {
  if (!line?.job_code) return "-";
  return line.job_type ? `${line.job_code} – ${line.job_type}` : line.job_code;
}

function formatDateDMY(dateStr) {
  if (!dateStr) return "-";
  const [y, m, d] = String(dateStr).split("-");
  if (!y || !m || !d) return dateStr;
  return `${d}/${m}/${y}`;
}

// ---------- jobs / tiers ----------
async function loadJobsForCompany(companyId) {
  const res = await fetch(`/api/jobs?companyId=${companyId}`);
  const data = await res.json().catch(() => []);
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  jobsCache = Array.isArray(data) ? data : [];
  return jobsCache;
}

function deriveTiersFromJobs(jobs) {
  const first = jobs.find(j => Array.isArray(j.wage_rates) && j.wage_rates.length);
  if (!first) return [];
  return first.wage_rates.map(w => ({ id: w.tier_id, tier_name: w.tier_name }));
}

function getWorkerDefaultTierId(workerId) {
  const w = workersCache.find(x => Number(x.id) === Number(workerId));
  const tier = Number(w?.wage_tier_id);
  return Number.isFinite(tier) ? tier : null;
}

function buildJobOptions(selectEl, jobs, selectedJobCode) {
  if (!selectEl) return;

  selectEl.innerHTML = "";

  jobs.forEach(j => {
    const opt = document.createElement("option");
    opt.value = j.job_code;
    opt.textContent = j.job_type ? `${j.job_code} – ${j.job_type}` : j.job_code;
    if (String(j.job_code) === String(selectedJobCode)) opt.selected = true;
    selectEl.appendChild(opt);
  });

  if (selectedJobCode && !jobs.some(j => String(j.job_code) === String(selectedJobCode))) {
    const opt = document.createElement("option");
    opt.value = selectedJobCode;
    opt.textContent = `${selectedJobCode} (missing)`;
    opt.selected = true;
    selectEl.insertBefore(opt, selectEl.firstChild);
  }
}

function buildTierOptions(selectEl, tiers, selectedTierId) {
  if (!selectEl) return;
  selectEl.innerHTML = "";

  tiers.forEach(t => {
    const opt = document.createElement("option");
    opt.value = String(t.id);
    opt.textContent = t.tier_name;
    if (Number(t.id) === Number(selectedTierId)) opt.selected = true;
    selectEl.appendChild(opt);
  });

  if (selectedTierId == null) {
    const opt = document.createElement("option");
    opt.value = "";
    opt.textContent = "— Select Tier —";
    opt.selected = true;
    selectEl.insertBefore(opt, selectEl.firstChild);
  }
}

// ---------- company id ----------
function getCurrentCompanyIdSafe() {
  return typeof getCurrentCompanyId === "function" ? (getCurrentCompanyId() || 1) : 1;
}

// ---------- load records ----------
function loadRecords() {
  const companyId = getCurrentCompanyIdSafe();
  jobsCache = [];
  tiersCache = [];
  workersCache = [];

  fetch(`/api/work-entries?companyId=${companyId}`)
    .then(res => res.json())
    .then(entries => {
      // backend returns GROUPED; flatten for filters/sort; then regroup for render
      const flat = [];

      (entries || []).forEach(h => {
        const header = h || {};
        const jobs = Array.isArray(header.jobs) ? header.jobs : [];

        jobs.forEach(j => {
          flat.push({
            id: j.id,
            work_entry_id: header.id,

            company_id: header.company_id,
            worker_id: header.worker_id,
            worker_code: header.worker_code,
            worker_name: header.worker_name,
            work_date: header.work_date,
            job_no1: header.job_no1,
            job_no2: header.job_no2,
            fees_collected: header.fees_collected,
            is_bank: header.is_bank,
            note: header.note,
            created_at: header.created_at,

            job_code: j.job_code,
            job_type: j.job_type,

            amount: Number(j.hours ?? 0) || 0,

            customer_rate: Number(j.customer_rate ?? 0) || 0,
            customer_total: Number(j.customer_total ?? 0) || 0,
            wage_rate: Number(j.wage_rate ?? 0) || 0,
            wage_total: Number(j.wage_total ?? 0) || 0,

            wage_tier_id: j.wage_tier_id ?? null,
          });
        });
      });

      recordsCache = flat;
      filteredRecords = [];
      recordsPage = 1;

      if (recordsFilterActive) applyRecordFilters();
      else renderRecordsTable();

      document.querySelectorAll(".record-select").forEach(cb => {
        cb.addEventListener("change", syncHeaderCheckbox);
      });

      syncHeaderCheckbox();
    })
    .catch(err => {
      console.error(err);
      const tbody = document.getElementById("recordsBody");
      tbody.innerHTML = `
        <tr>
          <td colspan="1" class="text-center text-danger py-4">
            Failed to load records.
          </td>
        </tr>
      `;
      applyRatesVisibility();

      const wageTotalCell = document.getElementById("recordsGrandTotalWage");
      const customerTotalCell = document.getElementById("recordsGrandTotalCustomer");
      const feesTotalCell = document.getElementById("recordsGrandTotalFees");
      if (feesTotalCell) feesTotalCell.textContent = "0.00";
      if (wageTotalCell) wageTotalCell.textContent = "0.00";
      if (customerTotalCell) customerTotalCell.textContent = "0.00";

      syncHeaderCheckbox();
    });
}

// ---------- collapse state (remember while on page) ----------
window.__recordsCollapsed = window.__recordsCollapsed || new Set();
function isCollapsed(key) { return window.__recordsCollapsed.has(key); }
function setCollapsed(key, val) {
  if (val) window.__recordsCollapsed.add(key);
  else window.__recordsCollapsed.delete(key);
}

function toggleGroup(groupId) {
  const collapsed = isCollapsed(groupId);
  setCollapsed(groupId, !collapsed);

  // update rows
  document.querySelectorAll(`tr.record-child[data-group="${groupId}"]`)
    .forEach(tr => { tr.style.display = collapsed ? "" : "none"; });

  // update toggle buttons (all matching)
  document.querySelectorAll(`button.record-toggle[data-group="${groupId}"]`)
    .forEach(btn => { btn.textContent = collapsed ? "−" : "+"; });

  // after hide/show, selection header state changes (visible rows changed)
  syncHeaderCheckbox();
}

function applyCollapsedStateForGroup(groupId) {
  const collapsed = isCollapsed(groupId);

  document.querySelectorAll(`tr.record-child[data-group="${groupId}"]`)
    .forEach(tr => { tr.style.display = collapsed ? "none" : ""; });

  document.querySelectorAll(`button.record-toggle[data-group="${groupId}"]`)
    .forEach(btn => { btn.textContent = collapsed ? "+" : "−"; });
}

function bindGroupToggles() {
  document.querySelectorAll("button.record-toggle").forEach(btn => {
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const groupId = btn.dataset.group;
      if (!groupId) return;
      toggleGroup(groupId);
    });
  });

  // optional: click parent row (except inputs/buttons) also toggles
  document.querySelectorAll("tr.record-parent").forEach(tr => {
    tr.addEventListener("click", (e) => {
      const tag = (e.target?.tagName || "").toLowerCase();
      if (tag === "input" || tag === "button" || tag === "a" || tag === "label") return;

      const groupId = tr.dataset.group;
      if (!groupId) return;
      toggleGroup(groupId);
    });
  });
}


// ---------- render table (UPDATED) ----------
function renderRecordsTable() {
  const tbody = document.getElementById("recordsBody");
  const wageTotalCell = document.getElementById("recordsGrandTotalWage");
  const customerTotalCell = document.getElementById("recordsGrandTotalCustomer");
  const feesTotalCell = document.getElementById("recordsGrandTotalFees");

  const groups = getVisibleRecords();
  const total = groups.length;

  const totalPages = Math.max(1, Math.ceil(total / recordsPageSize));
  if (recordsPage > totalPages) recordsPage = totalPages;

  const start = (recordsPage - 1) * recordsPageSize;
  const pageGroups = groups.slice(start, start + recordsPageSize);
  const end = Math.min(total, start + pageGroups.length);

  tbody.innerHTML = "";


  updateRecordsCount(start, end, total);
  renderRecordsPagination(totalPages);


  let grandFees = 0;
  let grandWage = 0;
  let grandCustomer = 0;

  groups.forEach(g => {
    grandFees += Number(g.header?.fees_collected || 0);
    g.lines.forEach(l => {
      grandWage += Number(l.wage_total || 0);
      grandCustomer += Number(l.customer_total || 0);
    });
  });

  if (!pageGroups.length) {
    updateRecordsCount(0, 0, 0);
    renderRecordsPagination(1);
    tbody.innerHTML = `
      <tr>
        <td class="text-center text-muted py-4" colspan="99">No records found.</td>
      </tr>`;
    return;
  }

  pageGroups.forEach((g, idx) => {
    const h = g.header;
    const lines = g.lines || [];
    const payTypeText = h.is_bank ? "Bank" : "Cash";

    const entryWageTotal = lines.reduce((s, x) => s + (x.wage_total || 0), 0);
    const entryCustTotal = lines.reduce((s, x) => s + (x.customer_total || 0), 0);
    const entryHoursTotal = lines.reduce((s, x) => s + (x.amount || 0), 0);

    /* ============================
       SINGLE JOB ENTRY
       ============================ */
    if (lines.length === 1) {
      const e = lines[0];

      const tr = document.createElement("tr");
      tr.className = "record-single";
      tr.innerHTML = `
        <td class="text-center">
          <input type="checkbox" class="record-select" value="${e.id}">
        </td>
        <td>${start + idx + 1}</td>
        <td>${formatDateDMY(h.work_date)}</td>
        <td>${h.job_no1 || "-"}</td>
        <td>${h.job_no2 || "-"}</td>
        <td>${groupWorkerLabel(h)}</td>
        <td>${groupJobLabel(e)} <span class="badge-single">Single</span></td>
        <td class="text-end">${e.amount.toFixed(1)}</td>
        <td class="text-end">${Number(h.fees_collected || 0).toFixed(2)}</td>
        <td class="text-end" data-col="cust_rate">${e.customer_rate.toFixed(2)}</td>
        <td class="text-end" data-col="cust_total">${e.customer_total.toFixed(2)}</td>
        <td class="text-end" data-col="wage_rate">${e.wage_rate.toFixed(2)}</td>
        <td class="text-end" data-col="wage_total">${e.wage_total.toFixed(2)}</td>
        <td>${escapeHtml(h.note || "-")}</td>
        <td class="text-end">
          <button class="btn btn-sm btn-outline-primary me-2" onclick="openEditEntry(${e.id})">Edit</button>
          <button class="btn btn-sm btn-outline-danger" onclick="deleteSingleRecord(${e.id})">Delete</button>
        </td>
      `;
      tbody.appendChild(tr);
      return;
    }

    /* ============================
       MULTI JOB ENTRY (PARENT)
       ============================ */
    const parentId = `grp-${start + idx}`;

    const trParent = document.createElement("tr");
    trParent.className = "record-parent";
    trParent.dataset.group = parentId;

    trParent.innerHTML = `
      <td class="text-center">
        <input type="checkbox" class="record-parent-select" data-group="${parentId}">
      </td>
      <td class="fw-bold">${start + idx + 1}</td>
      <td>${formatDateDMY(h.work_date)}</td>
      <td class="fw-bold">${h.job_no1 || "-"}</td>
      <td>${h.job_no2 || "-"}</td>
      <td>${groupWorkerLabel(h)}</td>

      <td class="fw-bold">
        <button type="button" class="btn btn-sm btn-outline-secondary record-toggle"
          data-group="${parentId}" aria-label="Toggle jobs">
          −
        </button>
        ENTRY
        <span class="badge-multi">${lines.length} jobs</span>
      </td>

      <td class="text-end">${entryHoursTotal.toFixed(1)}</td>
      <td class="text-end fw-bold">${Number(h.fees_collected || 0).toFixed(2)}</td>

      <td></td>
      <td class="text-end fw-bold">${entryCustTotal.toFixed(2)}</td>

      <td></td>
      <td class="text-end fw-bold">${entryWageTotal.toFixed(2)}</td>

      <td class="text-muted small">${escapeHtml(h.note || "-")}</td>
      <td class="text-end text-muted">${payTypeText}</td>
    `;
    tbody.appendChild(trParent);


    /* ============================
       CHILD ROWS
       ============================ */
    lines.forEach(e => {
      const trChild = document.createElement("tr");
      trChild.className = "record-child";
      trChild.dataset.group = parentId;
      trChild.innerHTML = `
        <td class="text-center">
          <input type="checkbox" class="record-select" value="${e.id}">
        </td>
        <td></td><td></td><td></td><td></td><td></td>
        <td class="child-job">${groupJobLabel(e)}</td>
        <td class="text-end">${e.amount.toFixed(1)}</td>
        <td></td>
        <td class="text-end" data-col="cust_rate">${e.customer_rate.toFixed(2)}</td>
        <td class="text-end" data-col="cust_total">${e.customer_total.toFixed(2)}</td>
        <td class="text-end" data-col="wage_rate">${e.wage_rate.toFixed(2)}</td>
        <td class="text-end" data-col="wage_total">${e.wage_total.toFixed(2)}</td>
        <td></td>
        <td class="text-end">
          <button class="btn btn-sm btn-outline-primary me-2" onclick="openEditEntry(${e.id})">Edit</button>
          <button class="btn btn-sm btn-outline-danger" onclick="deleteSingleRecord(${e.id})">Delete</button>
        </td>
      `;
      tbody.appendChild(trChild);
    });
    applyCollapsedStateForGroup(parentId);
  });


  if (feesTotalCell) feesTotalCell.textContent = grandFees.toFixed(2);
  if (wageTotalCell) wageTotalCell.textContent = grandWage.toFixed(2);
  if (customerTotalCell) customerTotalCell.textContent = grandCustomer.toFixed(2);

  bindParentCheckboxes();
  bindGroupToggles();
  syncHeaderCheckbox();
  applyRatesVisibility();

}

function bindParentCheckboxes() {
  document.querySelectorAll(".record-parent-select").forEach(parentCb => {
    parentCb.addEventListener("change", () => {
      const group = parentCb.dataset.group;
      document
        .querySelectorAll(`.record-child[data-group="${group}"] .record-select`)
        .forEach(cb => cb.checked = parentCb.checked);
      syncHeaderCheckbox();
    });
  });
}


// ---------- count / pagination ----------
function updateRecordsCount(start, end, total) {
  const text = total ? `Showing ${start + 1}-${end} of ${total} records` : "No records";
  const top = document.getElementById("recordsCountTop");
  const bottom = document.getElementById("recordsCountBottom");
  if (top) top.textContent = text;
  if (bottom) bottom.textContent = text;
}

function renderRecordsPagination(totalPages) {
  renderRecordsPaginationSingle("recordsPaginationTop", totalPages);
  renderRecordsPaginationSingle("recordsPaginationBottom", totalPages);
}

function renderRecordsPaginationSingle(elementId, totalPages) {
  const ul = document.getElementById(elementId);
  if (!ul) return;

  ul.innerHTML = "";

  if (totalPages <= 1) {
    ul.style.display = "none";
    return;
  }
  ul.style.display = "flex";

  const windowSize = 5;
  let start = recordsPage - Math.floor(windowSize / 2);
  let end = recordsPage + Math.floor(windowSize / 2);

  if (start < 1) { end += 1 - start; start = 1; }
  if (end > totalPages) { start -= end - totalPages; end = totalPages; if (start < 1) start = 1; }

  const prevLi = document.createElement("li");
  prevLi.className = "page-item" + (recordsPage === 1 ? " disabled" : "");
  prevLi.innerHTML = `<button class="page-link">&lt;</button>`;
  prevLi.addEventListener("click", () => {
    if (recordsPage > 1) {
      recordsPage--;
      renderRecordsTable();
    }
  });
  ul.appendChild(prevLi);

  for (let i = start; i <= end; i++) {
    const li = document.createElement("li");
    li.className = "page-item" + (i === recordsPage ? " active" : "");
    li.innerHTML = `<button class="page-link">${i}</button>`;
    li.addEventListener("click", () => {
      recordsPage = i;
      renderRecordsTable();
    });
    ul.appendChild(li);
  }

  const nextLi = document.createElement("li");
  nextLi.className = "page-item" + (recordsPage === totalPages ? " disabled" : "");
  nextLi.innerHTML = `<button class="page-link">&gt;</button>`;
  nextLi.addEventListener("click", () => {
    if (recordsPage < totalPages) {
      recordsPage++;
      renderRecordsTable();
    }
  });
  ul.appendChild(nextLi);
}

// ---------- selection / header checkbox ----------
function getSelectedRecordIds() {
  return Array.from(document.querySelectorAll(".record-select:checked"))
    .map(cb => parseInt(cb.value, 10))
    .filter(n => Number.isFinite(n));
}

function syncHeaderCheckbox() {
  const headerCb = document.getElementById("selectAllRecords");
  const deleteBtn = document.getElementById("deleteSelectedBtn");
  if (!headerCb || !deleteBtn) return;

  const enabled = Array.from(document.querySelectorAll(".record-select:not(:disabled)"))
    // count only visible rows so collapse doesn't mess the "select all" state
    .filter(cb => isRowVisible(cb.closest("tr")));

  const checked = enabled.filter(cb => cb.checked);

  if (!enabled.length) {
    headerCb.checked = false;
    headerCb.indeterminate = false;
    headerCb.disabled = true;
    deleteBtn.disabled = true;
    return;
  }

  headerCb.disabled = false;

  if (checked.length === 0) {
    headerCb.checked = false;
    headerCb.indeterminate = false;
  } else if (checked.length === enabled.length) {
    headerCb.checked = true;
    headerCb.indeterminate = false;
  } else {
    headerCb.checked = false;
    headerCb.indeterminate = true;
  }

  deleteBtn.disabled = checked.length === 0;
}

async function deleteSelectedRecords() {
  const ids = getSelectedRecordIds();
  const companyId = getCurrentCompanyIdSafe();

  if (window.CAN_DELETE_ENTRY !== true) {
    alert("No permission to delete records.");
    return;
  }
  if (!ids.length) return;

  if (!confirm(`Delete ${ids.length} selected entr${ids.length > 1 ? "ies" : "y"}?`)) return;

  try {
    await Promise.all(
      ids.map(id =>
        fetch(`/api/work-entries/${id}?companyId=${companyId}`, { method: "DELETE" })
      )
    );
    loadRecords();
  } catch (err) {
    console.error(err);
    alert("Error deleting selected records.");
  }
}

// ---------- sorting / filtering ----------
function sortRecords(type) {
  const data = getVisibleFlatRows();

  data.sort((a, b) => {
    const da = a.work_date || "";
    const db = b.work_date || "";

    const jobA = `${a.job_code || ""} ${a.job_type || ""}`.trim();
    const jobB = `${b.job_code || ""} ${b.job_type || ""}`.trim();

    const wageA = Number(a.wage_total ?? a.pay ?? 0) || 0;
    const wageB = Number(b.wage_total ?? b.pay ?? 0) || 0;

    const custA = Number(a.customer_total ?? 0) || 0;
    const custB = Number(b.customer_total ?? 0) || 0;

    switch (type) {
      case "date_asc": return da.localeCompare(db);
      case "date_desc": return db.localeCompare(da);
      case "job_asc": return jobA.localeCompare(jobB);
      case "job_desc": return jobB.localeCompare(jobA);
      case "wage_asc": return wageA - wageB;
      case "wage_desc": return wageB - wageA;
      case "customer_asc": return custA - custB;
      case "customer_desc": return custB - custA;
      default: return 0;
    }
  });

  if (recordsFilterActive) filteredRecords = data;
  else recordsCache = data;

  recordsPage = 1;
  renderRecordsTable();
}

function applyRecordFilters() {
  const dateFrom = document.getElementById("filterDateFrom")?.value || "";
  const dateTo = document.getElementById("filterDateTo")?.value || "";
  const jobNoVal = (document.getElementById("filterJobNo")?.value || "").toLowerCase().trim();
  const workerVal = (document.getElementById("filterWorker")?.value || "").toLowerCase().trim();
  const jobVal = (document.getElementById("filterJob")?.value || "").toLowerCase().trim();
  const noteVal = (document.getElementById("filterNote")?.value || "").toLowerCase().trim();

  recordsFilterActive = !!(dateFrom || dateTo || jobNoVal || workerVal || jobVal || noteVal);

  filteredRecords = recordsCache.filter(e => {
    const dateText = (e.work_date || "").trim();
    const jobNo1Text = (e.job_no1 || "").toLowerCase();
    const jobNo2Text = (e.job_no2 || "").toLowerCase();

    const workerText = `${e.worker_code || ""} ${e.worker_name || ""}`.toLowerCase();
    const jobText = `${e.job_code || ""} ${e.job_type || ""}`.toLowerCase();
    const noteText = (e.note || "").toLowerCase();

    if (dateFrom && dateText && dateText < dateFrom) return false;
    if (dateTo && dateText && dateText > dateTo) return false;

    if (jobNoVal && !(jobNo1Text.includes(jobNoVal) || jobNo2Text.includes(jobNoVal))) return false;

    if (workerVal) {
      const exact = workerVal.startsWith("=");
      const needle = exact ? workerVal.slice(1) : workerVal;
      if (exact ? workerText.trim() !== needle : !workerText.includes(needle)) return false;
    }

    if (jobVal && !jobText.includes(jobVal)) return false;
    if (noteVal && !noteText.includes(noteVal)) return false;

    return true;
  });

  recordsPage = 1;
  renderRecordsTable();
}

// very small helper so note doesn't break HTML
function escapeHtml(str) {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

// ---------- permissions + visibility ----------
function canEditRates() {
  return window.CAN_EDIT_RATES === true;
}

function canSeeRates() {
  return !!window.CAN_EDIT_RATES;
}

function applyRatesFieldsVisibility() {
  const el = document.getElementById("ratesFields");
  if (el) el.style.display = canSeeRates() ? "" : "none";
}

function applyRatesVisibility() {
  const showRates = canSeeRates();

  const selectors = [
    "[data-col='cust_rate']",
    "[data-col='cust_total']",
    "[data-col='wage_rate']",
    "[data-col='wage_total']",
  ];

  selectors.forEach(sel => {
    document.querySelectorAll(sel).forEach(el => {
      el.style.display = showRates ? "" : "none";
    });
  });

  const wageTotalRow = document.getElementById("recordsWageTotalRow");
  if (wageTotalRow) wageTotalRow.style.display = showRates ? "" : "none";

  const custTotalRow = document.getElementById("recordsCustomerTotalRow");
  if (custTotalRow) custTotalRow.style.display = showRates ? "" : "none";

  fixRecordsColspans();
}

function getVisibleRecordsColCount() {
  const ths = document.querySelectorAll("#recordsTable thead th");
  let count = 0;
  ths.forEach(th => {
    if (window.getComputedStyle(th).display !== "none") count++;
  });
  return count || ths.length || 1;
}

function fixRecordsColspans() {
  const visibleCols = getVisibleRecordsColCount();

  const loadingCell = document.getElementById("recordsLoadingCell");
  if (loadingCell) loadingCell.colSpan = visibleCols;

  document.querySelectorAll("#recordsBody td[colspan]").forEach(td => td.colSpan = visibleCols);

  const feesLabel = document.getElementById("recordsFeesLabelCell");
  const wageLabel = document.getElementById("recordsWageLabelCell");
  const custLabel = document.getElementById("recordsCustomerLabelCell");

  const labelSpan = Math.max(1, visibleCols - 1);

  if (feesLabel) feesLabel.colSpan = labelSpan;
  if (wageLabel) wageLabel.colSpan = labelSpan;
  if (custLabel) custLabel.colSpan = labelSpan;
}

// ---------- edit modal ----------
let editModal = null;

function findRecordById(id) {
  const flat = getVisibleFlatRows();
  return flat.find(x => Number(x.id) === Number(id)) || null;
}

function numOrNull(v) {
  const s = String(v ?? "").trim();
  if (s === "") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function recalcEditTotals() {
  const hrs = numOrNull(document.getElementById("editAmount")?.value);
  const cr  = numOrNull(document.getElementById("editCustomerRate")?.value);
  const wr  = numOrNull(document.getElementById("editWageRate")?.value);

  const cTotEl = document.getElementById("editCustomerTotal");
  const wTotEl = document.getElementById("editWageTotal");

  if (hrs == null || cr == null || wr == null) {
    if (cTotEl) cTotEl.value = "";
    if (wTotEl) wTotEl.value = "";
    return;
  }

  if (cTotEl) cTotEl.value = (cr * hrs).toFixed(2);
  if (wTotEl) wTotEl.value = (wr * hrs).toFixed(2);
}

function applyRatesFromJobAndTier() {
  const job_code = (document.getElementById("editJobCode")?.value || "").trim();
  const tierVal = document.getElementById("editWageTierId")?.value;
  const tier_id = tierVal === "" ? null : Number(tierVal);

  const job = jobsCache.find(j => String(j.job_code) === String(job_code));
  if (!job) return;

  const customerRateRaw = Number(job.normal_price ?? job.customer_rate ?? 0);
  const customerRate = Number.isFinite(customerRateRaw) ? customerRateRaw : 0;

  let wageRate = 0;
  if (tier_id != null && Array.isArray(job.wage_rates)) {
    const rateRow = job.wage_rates.find(r => Number(r.tier_id) === Number(tier_id));
    const wr = Number(rateRow?.wage_rate ?? 0);
    wageRate = Number.isFinite(wr) ? wr : 0;
  }

  const crEl = document.getElementById("editCustomerRate");
  const wrEl = document.getElementById("editWageRate");

  if (crEl) {
    crEl.value = customerRate > 0 ? customerRate.toFixed(2) : "";
    crEl.disabled = !canEditRates();
  }

  if (wrEl) {
    wrEl.value = wageRate > 0 ? wageRate.toFixed(2) : "";
    wrEl.disabled = !canEditRates();
  }

  recalcEditTotals();
}

window.openEditEntry = async function (id) {
  const rec = findRecordById(id);
  if (!rec) return alert("Record not found. Please reload.");

  if (!editModal) {
    const el = document.getElementById("editEntryModal");
    if (!el) return alert("Edit modal not found in HTML.");
    editModal = new bootstrap.Modal(el);
  }

  document.getElementById("editEntryId").value = rec.id;
  document.getElementById("editWorkDate").value = rec.work_date || "";
  document.getElementById("editJobNo1").value = rec.job_no1 || "";
  document.getElementById("editJobNo2").value = rec.job_no2 || "";
  document.getElementById("editAmount").value = rec.amount ?? "";
  document.getElementById("editIsBank").value = Number(rec.is_bank) === 1 ? "1" : "0";
  document.getElementById("editNote").value = rec.note || "";

  try {
    const companyId = getCurrentCompanyIdSafe();

    if (!jobsCache.length) jobsCache = await loadJobsForCompany(companyId);
    if (!tiersCache.length) tiersCache = deriveTiersFromJobs(jobsCache);
    if (!workersCache.length) workersCache = await loadWorkersForCompany(companyId);

    const workerTierId = getWorkerDefaultTierId(rec.worker_id);
    const initialTierId = rec.wage_tier_id != null ? Number(rec.wage_tier_id) : workerTierId;

    buildWorkerOptions(document.getElementById("editWorkerId"), workersCache, rec.worker_id);
    buildJobOptions(document.getElementById("editJobCode"), jobsCache, rec.job_code);
    buildTierOptions(document.getElementById("editWageTierId"), tiersCache, initialTierId);

    const jobSel = document.getElementById("editJobCode");
    const tierSel = document.getElementById("editWageTierId");
    const workerSel = document.getElementById("editWorkerId");

    // prevent stacking listeners
    if (workerSel?._onChangeEditWorker) workerSel.removeEventListener("change", workerSel._onChangeEditWorker);
    if (jobSel?._onChangeEditJob) jobSel.removeEventListener("change", jobSel._onChangeEditJob);
    if (tierSel?._onChangeEditTier) tierSel.removeEventListener("change", tierSel._onChangeEditTier);

    jobSel._onChangeEditJob = () => applyRatesFromJobAndTier();
    tierSel._onChangeEditTier = () => applyRatesFromJobAndTier();

    workerSel._onChangeEditWorker = () => {
      const newWorkerId = Number(workerSel.value) || null;
      const tierId = getWorkerDefaultTierId(newWorkerId);
      const ts = document.getElementById("editWageTierId");
      if (ts) ts.value = tierId != null ? String(tierId) : "";
      applyRatesFromJobAndTier();
    };

    jobSel.addEventListener("change", jobSel._onChangeEditJob);
    tierSel.addEventListener("change", tierSel._onChangeEditTier);
    workerSel.addEventListener("change", workerSel._onChangeEditWorker);

    // recalc listeners
    document.getElementById("editAmount")?.removeEventListener("input", recalcEditTotals);
    document.getElementById("editCustomerRate")?.removeEventListener("input", recalcEditTotals);
    document.getElementById("editWageRate")?.removeEventListener("input", recalcEditTotals);

    document.getElementById("editAmount")?.addEventListener("input", recalcEditTotals);
    document.getElementById("editCustomerRate")?.addEventListener("input", recalcEditTotals);
    document.getElementById("editWageRate")?.addEventListener("input", recalcEditTotals);

    applyRatesFromJobAndTier();
  } catch (e) {
    console.error(e);
    return alert("Failed to load jobs / wage tiers / workers.");
  }

  const hint = document.getElementById("editEntryHint");
  if (hint) hint.textContent = `Editing #${rec.id} (${rec.job_code || ""}) • ${rec.worker_code || ""}`;

  editModal.show();
};

window.deleteSingleRecord = async function (id) {
  const companyId = getCurrentCompanyIdSafe();

  if (window.CAN_DELETE_ENTRY !== true) {
    alert("No permission to delete records.");
    return;
  }

  if (!confirm(`Delete record #${id}?`)) return;

  try {
    const res = await fetch(`/api/work-entries/${id}?companyId=${companyId}`, { method: "DELETE" });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    loadRecords();
  } catch (e) {
    alert(e.message || "Failed to delete.");
  }
};

async function saveEditEntry() {
  const companyId = getCurrentCompanyIdSafe();

  const id = Number(document.getElementById("editEntryId").value);
  const work_date = document.getElementById("editWorkDate").value.trim();
  const job_no1 = document.getElementById("editJobNo1").value.trim();
  const job_no2 = document.getElementById("editJobNo2").value.trim();
  const amount = Number(document.getElementById("editAmount").value);
  const is_bank = Number(document.getElementById("editIsBank").value) === 1 ? 1 : 0;
  const note = document.getElementById("editNote").value.trim();

  const job_code = document.getElementById("editJobCode").value.trim();
  const wage_tier_id = Number(document.getElementById("editWageTierId")?.value) || null;
  const worker_id = Number(document.getElementById("editWorkerId")?.value) || null;

  if (!id || !work_date || !job_no1 || !worker_id || !Number.isFinite(amount) || amount <= 0 || !job_code) {
    alert("Date, Job No1, Worker, Job Code, and Hours are required.");
    return;
  }

  const rec = findRecordById(id);
  if (!rec) {
    alert("Record not found in cache. Please reload.");
    return;
  }

  const existingCustomerRate = Number(rec.customer_rate ?? 0);
  const existingWageRate = Number(rec.wage_rate ?? rec.rate ?? 0);

  const inputCustomerRate = numOrNull(document.getElementById("editCustomerRate")?.value);
  const inputWageRate = numOrNull(document.getElementById("editWageRate")?.value);

  const customer_rate = canEditRates() ? inputCustomerRate : existingCustomerRate;
  const wage_rate = canEditRates() ? inputWageRate : existingWageRate;

  if (!customer_rate || !wage_rate) {
    alert("Customer Rate and Wage Rate are required.");
    return;
  }

  const customer_total = customer_rate * amount;
  const wage_total = wage_rate * amount;

  try {
    const res = await fetch(`/api/work-entries/${id}?companyId=${companyId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        company_id: companyId,
        worker_id,
        job_code,
        amount,
        is_bank,
        customer_rate,
        customer_total,
        wage_tier_id,
        wage_rate,
        wage_total,
        job_no1,
        job_no2,
        work_date,
        note
      })
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);

    editModal?.hide();
    loadRecords();
  } catch (e) {
    alert(e.message || "Failed to update record.");
  }
}

// ---------- misc ----------
document.addEventListener("DOMContentLoaded", () => {
  injectRecordsStylesOnce();
  loadRecords();
  applyRatesVisibility();
  applyRatesFieldsVisibility();

  document.getElementById("saveEditEntryBtn")?.addEventListener("click", saveEditEntry);

  const pageSizeEl = document.getElementById("recordsPageSize");
  if (pageSizeEl) {
    recordsPageSize = parseInt(pageSizeEl.value, 10) || 10;
    pageSizeEl.addEventListener("change", () => {
      recordsPageSize = parseInt(pageSizeEl.value, 10) || 10;
      recordsPage = 1;
      renderRecordsTable();
    });
  }

  ["filterDateFrom", "filterDateTo", "filterJobNo", "filterWorker", "filterJob", "filterNote"]
    .forEach(id => {
      const el = document.getElementById(id);
      if (el) el.addEventListener("input", applyRecordFilters);
    });

  // Select all (ONLY visible rows, so collapse doesn’t accidentally select hidden children)
  document.getElementById("selectAllRecords")?.addEventListener("change", function () {
    const checked = this.checked;
    Array.from(document.querySelectorAll(".record-select:not(:disabled)"))
      .filter(cb => isRowVisible(cb.closest("tr")))
      .forEach(cb => { cb.checked = checked; });

    syncHeaderCheckbox();
  });

  if (window.CAN_DELETE_ENTRY !== true) {
    const delBtn = document.getElementById("deleteSelectedBtn");
    if (delBtn) delBtn.disabled = true;

    const headerCb = document.getElementById("selectAllRecords");
    if (headerCb) headerCb.disabled = true;
  }

  document.getElementById("deleteSelectedBtn")?.addEventListener("click", deleteSelectedRecords);

  document.querySelectorAll(".sort-option").forEach(item => {
    item.addEventListener("click", function (e) {
      e.preventDefault();
      const sortType = this.dataset.sort;
      sortRecords(sortType);
    });
  });
});
