let recordsCache = [];
let filteredRecords = [];
let recordsPage = 1;
let recordsPageSize = 10;
let recordsFilterActive = false;
let jobsCache = [];      // [{id, job_code, job_type, customer_rate}]
let tiersCache = [];     // [{id, tier_name, wage_rate}]

let workersCache = [];

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
    .filter(w => Number(w.is_active ?? 1) === 1) // if you have is_active, otherwise keep all
    .forEach(w => {
      const opt = document.createElement("option");
      opt.value = String(w.id);
      opt.textContent = `${w.worker_code || ""}${w.worker_name ? " - " + w.worker_name : ""}`.trim() || `Worker #${w.id}`;
      if (Number(w.id) === Number(selectedWorkerId)) opt.selected = true;
      selectEl.appendChild(opt);
    });

  // fallback if missing worker
  if (selectedWorkerId && !workers.some(w => Number(w.id) === Number(selectedWorkerId))) {
    const opt = document.createElement("option");
    opt.value = String(selectedWorkerId);
    opt.textContent = `Worker #${selectedWorkerId} (missing)`;
    opt.selected = true;
    selectEl.insertBefore(opt, selectEl.firstChild);
  }
}

function formatDateDMY(dateStr) {
  if (!dateStr) return "-";
  const [y, m, d] = dateStr.split("-");
  if (!y || !m || !d) return dateStr;
  return `${d}/${m}/${y}`;
}

async function loadJobsForCompany(companyId) {
  const res = await fetch(`/api/jobs?companyId=${companyId}`);
  const data = await res.json().catch(() => []);
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  jobsCache = Array.isArray(data) ? data : [];
  return jobsCache;
}
function buildJobDropdown(selectedJobCode) {
  const sel = document.getElementById("editJobCode");
  if (!sel) return;

  sel.innerHTML = "";

  jobsCache
    .filter(j => Number(j.is_active) === 1) // optional
    .forEach(j => {
      const opt = document.createElement("option");
      opt.value = j.job_code; // keep as job_code
      opt.textContent = `${j.job_code} - ${j.job_type}`;
      if (String(j.job_code) === String(selectedJobCode)) opt.selected = true;
      sel.appendChild(opt);
    });
}
function getAllTiersFromJobs() {
  const first = jobsCache.find(j => Array.isArray(j.wage_rates) && j.wage_rates.length);
  if (!first) return [];
  return first.wage_rates.map(w => ({
    tier_id: w.tier_id,
    tier_name: w.tier_name,
  }));
}

function getWorkerDefaultTierId(workerId) {
  const w = workersCache.find(x => Number(x.id) === Number(workerId));
  const tier = Number(w?.wage_tier_id);
  return Number.isFinite(tier) ? tier : null;
}

function applyRatesFieldsVisibility() {
  const el = document.getElementById("ratesFields");
  if (el) el.style.display = canSeeRates() ? "" : "none";
}

function buildTierDropdown(selectedTierId) {
  const sel = document.getElementById("editWageTierId");
  if (!sel) return;

  sel.innerHTML = "";

  const tiers = getAllTiersFromJobs();

  tiers.forEach(t => {
    const opt = document.createElement("option");
    opt.value = String(t.tier_id);
    opt.textContent = t.tier_name;
    if (Number(t.tier_id) === Number(selectedTierId)) opt.selected = true;
    sel.appendChild(opt);
  });

  if (selectedTierId == null) {
    const opt = document.createElement("option");
    opt.value = "";
    opt.textContent = "— Select Tier —";
    opt.selected = true;
    sel.insertBefore(opt, sel.firstChild);
  }
}


function getCurrentCompanyIdSafe() {
  return typeof getCurrentCompanyId === "function"
    ? (getCurrentCompanyId() || 1)
    : 1;
}

function fmt2(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n.toFixed(2) : "-";
}

function loadRecords() {
  const companyId = getCurrentCompanyIdSafe();
  jobsCache = []; // so dropdown reloads jobs for the new company
  tiersCache = [];
  workersCache = [];

  fetch(`/api/work-entries?companyId=${companyId}`)
    .then(res => res.json())
    .then(entries => {
      recordsCache = entries || [];
      filteredRecords = [];
      recordsPage = 1;

      // keep current filters if active, otherwise show all
      if (recordsFilterActive) applyRecordFilters();
      else renderRecordsTable();

      // rebind checkbox listeners
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
      applyRatesVisibility(); // ✅ will compute correct colspan via fixRecordsColspans()

      const wageTotalCell = document.getElementById("recordsGrandTotalWage");
      const customerTotalCell = document.getElementById("recordsGrandTotalCustomer");
      if (wageTotalCell) wageTotalCell.textContent = "0.00";
      if (customerTotalCell) customerTotalCell.textContent = "0.00";
      syncHeaderCheckbox();
    });
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

  // If record has null tier, add a blank option at top
  if (selectedTierId == null) {
    const opt = document.createElement("option");
    opt.value = "";
    opt.textContent = "— Select Tier —";
    opt.selected = true;
    selectEl.insertBefore(opt, selectEl.firstChild);
  }
}


function getVisibleRecords() {
  return recordsFilterActive ? filteredRecords : recordsCache;
}

function renderRecordsTable() {
  const tbody = document.getElementById("recordsBody");
  const wageTotalCell = document.getElementById("recordsGrandTotalWage");
  const customerTotalCell = document.getElementById("recordsGrandTotalCustomer");
  const feesTotalCell = document.getElementById("recordsGrandTotalFees");

  const data = getVisibleRecords();
  const total = data.length;
  let grandFees = 0;

  const totalPages = Math.max(1, Math.ceil(total / recordsPageSize));
  if (recordsPage > totalPages) recordsPage = totalPages;

  const start = (recordsPage - 1) * recordsPageSize;
  const pageItems = data.slice(start, start + recordsPageSize);

  tbody.innerHTML = "";

  let grandWage = 0;
  let grandCustomer = 0;

  data.forEach(e => {
    grandFees += Number(e.fees_collected ?? 0) || 0;
    grandWage += Number(e.wage_total ?? e.pay ?? 0) || 0;
    grandCustomer += Number(e.customer_total ?? 0) || 0;
  });

  if (!pageItems.length) {
    tbody.innerHTML = `
      <tr>
        <td class="text-center text-muted py-4">No records found.</td>
      </tr>`;

    if (wageTotalCell) wageTotalCell.textContent = "0.00";
    if (customerTotalCell) customerTotalCell.textContent = "0.00";
    if (feesTotalCell) feesTotalCell.textContent = "0.00";


    renderRecordsPagination(totalPages);
    updateRecordsCount(start, start, total);
    syncHeaderCheckbox();

    // ✅ IMPORTANT: hide/show cols + fix colspan AFTER rendering
    applyRatesVisibility();
    return;
  }

  pageItems.forEach((e, idx) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td class="text-center">
        <input type="checkbox" class="record-select" value="${e.id}" ${window.CAN_DELETE_ENTRY ? "" : "disabled"}>
      </td>
      <td>${start + idx + 1}</td>
      <td>${formatDateDMY(e.work_date)}</td>
      <td>${e.job_no1 || "-"}</td>
      <td>${e.job_no2 || "-"}</td>
      <td>${(e.worker_code || e.worker_name) ? `${e.worker_code || ""}${e.worker_name ? " - " + e.worker_name : ""}` : "-"}</td>
      <td>${e.job_code ? (e.job_type ? `${e.job_code} – ${e.job_type}` : e.job_code) : "-"}</td>
      <td class="text-end">${Number(e.amount || 0).toFixed(1)}</td>
      <td class="text-end">${Number(e.fees_collected || 0).toFixed(2)}</td>

      <td class="text-end" data-col="cust_rate">${Number(e.customer_rate || 0).toFixed(2)}</td>
      <td class="text-end" data-col="cust_total">${Number(e.customer_total || 0).toFixed(2)}</td>

      <td class="text-end" data-col="wage_rate">${Number(e.wage_rate || 0).toFixed(2)}</td>
      <td class="text-end" data-col="wage_total">${Number(e.wage_total || 0).toFixed(2)}</td>

      <td>${(e.note || "").trim() ? escapeHtml(e.note.trim()) : "-"}</td>
      <td class="text-end">
        ${(window.CAN_EDIT_ENTRY === true) ? `<button class="btn btn-sm btn-outline-primary me-2" onclick="openEditEntry(${e.id})">Edit</button>` : ""}
        ${(window.CAN_DELETE_ENTRY === true) ? `<button class="btn btn-sm btn-outline-danger" onclick="deleteSingleRecord(${e.id})">Delete</button>` : ""}
      </td>
    `;
    tbody.appendChild(tr);
  });

  if (feesTotalCell) feesTotalCell.textContent = grandFees.toFixed(2);
  if (wageTotalCell) wageTotalCell.textContent = grandWage.toFixed(2);
  if (customerTotalCell) customerTotalCell.textContent = grandCustomer.toFixed(2);


  renderRecordsPagination(totalPages);
  updateRecordsCount(start, start + pageItems.length, total);
  syncHeaderCheckbox();

  // ✅ THIS is the missing piece:
  applyRatesVisibility();
}


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

  // Prev
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

  // Numbers
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

  // Next
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

function getSelectedRecordIds() {
  return Array.from(document.querySelectorAll(".record-select:checked")).map(cb =>
    parseInt(cb.value, 10)
  );
}

function syncHeaderCheckbox() {
  const headerCb = document.getElementById("selectAllRecords");
  const deleteBtn = document.getElementById("deleteSelectedBtn");
  const checkboxes = document.querySelectorAll(".record-select:not(:disabled)");
  const checked = document.querySelectorAll(".record-select:not(:disabled):checked");

  if (!checkboxes.length) {
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
  } else if (checked.length === checkboxes.length) {
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

function sortRecords(type) {
  const data = getVisibleRecords();

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

      // updated keys to match dropdown
      case "wage_asc": return wageA - wageB;
      case "wage_desc": return wageB - wageA;

      case "customer_asc": return custA - custB;
      case "customer_desc": return custB - custA;

      default: return 0;
    }
  });

  if (recordsFilterActive) filteredRecords = data;
  else recordsCache = data;

  renderRecordsTable();
}

function applyRecordFilters() {
  const dateFrom = document.getElementById("filterDateFrom")?.value || "";
  const dateTo = document.getElementById("filterDateTo")?.value || "";
  const jobNoVal = (document.getElementById("filterJobNo")?.value || "").toLowerCase().trim();
  const workerVal = (document.getElementById("filterWorker")?.value || "").toLowerCase().trim();
  const jobVal = (document.getElementById("filterJob")?.value || "").toLowerCase().trim();
  const noteVal = (document.getElementById("filterNote")?.value || "").toLowerCase().trim();

  // active if any filter has value
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

document.addEventListener("DOMContentLoaded", () => {
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

  // Select all
  document.getElementById("selectAllRecords")?.addEventListener("change", function () {
    const checked = this.checked;
    document.querySelectorAll(".record-select").forEach(cb => {
      cb.checked = checked;
    });
    syncHeaderCheckbox();
  });

  // If no delete permission, lock delete UI
  if (window.CAN_DELETE_ENTRY !== true) {
    const delBtn = document.getElementById("deleteSelectedBtn");
    if (delBtn) delBtn.disabled = true;

    const headerCb = document.getElementById("selectAllRecords");
    if (headerCb) headerCb.disabled = true;
  }


  // Mass delete
  document.getElementById("deleteSelectedBtn")?.addEventListener("click", deleteSelectedRecords);

  // Sort menu
  document.querySelectorAll(".sort-option").forEach(item => {
    item.addEventListener("click", function (e) {
      e.preventDefault();
      const sortType = this.dataset.sort;
      sortRecords(sortType);
    });
  });
});


let editModal = null;

function findRecordById(id) {
  const data = getVisibleRecords();
  return data.find(x => Number(x.id) === Number(id)) || null;
}

window.openEditEntry = async function (id) {
  const rec = findRecordById(id);
  const workerTierId = getWorkerDefaultTierId(rec.worker_id);

  if (!rec) return alert("Record not found. Please reload.");

  if (!editModal) {
    const el = document.getElementById("editEntryModal");
    if (!el) return alert("Edit modal not found in HTML.");
    editModal = new bootstrap.Modal(el);
  }

  // ✅ if the record has a tier, use it; otherwise follow worker tier
  const initialTierId =
    rec.wage_tier_id != null ? Number(rec.wage_tier_id) : workerTierId;

  // fill form
  document.getElementById("editEntryId").value = rec.id;
  document.getElementById("editWorkDate").value = rec.work_date || "";
  document.getElementById("editJobNo1").value = rec.job_no1 || "";
  document.getElementById("editJobNo2").value = rec.job_no2 || "";
  document.getElementById("editAmount").value = rec.amount ?? "";
  document.getElementById("editIsBank").value = Number(rec.is_bank) === 1 ? "1" : "0";
  document.getElementById("editNote").value = rec.note || "";

  try {
    const companyId = getCurrentCompanyIdSafe();

    // load once per company (if company switcher, you may want to clear caches when company changes)
    if (!jobsCache.length) jobsCache = await loadJobsForCompany(companyId);

    // If you don't have /api/wage-tiers, derive tiers from jobsCache. Otherwise keep your loadWageTiersForCompany.
    if (!tiersCache.length) tiersCache = deriveTiersFromJobs(jobsCache); // <-- recommended

    if (!workersCache.length) workersCache = await loadWorkersForCompany(companyId);
    buildWorkerOptions(document.getElementById("editWorkerId"), workersCache, rec.worker_id);

    // build dropdowns
    buildJobOptions(document.getElementById("editJobCode"), jobsCache, rec.job_code);
    buildTierOptions(document.getElementById("editWageTierId"), tiersCache, initialTierId);

    // bind change events (no stacking)
    const jobSel = document.getElementById("editJobCode");
    const tierSel = document.getElementById("editWageTierId");
    const workerSel = document.getElementById("editWorkerId");


    if (workerSel) workerSel.value = String(rec.worker_id || "");

    jobSel?.removeEventListener("change", applyRatesFromJobAndTier);
    tierSel?.removeEventListener("change", applyRatesFromJobAndTier);

    jobSel?.addEventListener("change", () => {
      console.log("job changed to:", jobSel.value);
      applyRatesFromJobAndTier();
    });
    tierSel?.addEventListener("change", applyRatesFromJobAndTier);

    workerSel?.addEventListener("change", () => {
      const newWorkerId = Number(workerSel.value) || null;
      const tierId = getWorkerDefaultTierId(newWorkerId);

      const tierSel = document.getElementById("editWageTierId");
      if (tierSel) tierSel.value = tierId != null ? String(tierId) : "";

      applyRatesFromJobAndTier(); // recalculates wage_rate based on job+tier
    });


    // initial apply
    applyRatesFromJobAndTier();

    // bind recalc (no stacking)
    document.getElementById("editAmount")?.removeEventListener("input", recalcEditTotals);
    document.getElementById("editCustomerRate")?.removeEventListener("input", recalcEditTotals);
    document.getElementById("editWageRate")?.removeEventListener("input", recalcEditTotals);

    document.getElementById("editAmount")?.addEventListener("input", recalcEditTotals);
    document.getElementById("editCustomerRate")?.addEventListener("input", recalcEditTotals);
    document.getElementById("editWageRate")?.addEventListener("input", recalcEditTotals);

    applyRatesFromJobAndTier();

  } catch (e) {
    console.error(e);
    return alert("Failed to load jobs / wage tiers.");
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

  // job code: allow change, but default to existing
  const job_code = document.getElementById("editJobCode").value.trim();
  const wage_tier_id = Number(document.getElementById("editWageTierId")?.value) || null;
  const worker_id = Number(document.getElementById("editWorkerId")?.value) || null;


  if (!id || !work_date || !job_no1 || !Number.isFinite(amount) || amount <= 0 || !job_code) {
    alert("Date, Job No1, Job Code, and Hours are required.");
    return;
  }

  if (!id || !work_date || !job_no1 || !Number.isFinite(amount) || amount <= 0 || !job_code || !worker_id) {
    alert("Date, Job No1, Worker, Job Code, and Hours are required.");
    return;
  }

  // use existing record rates; only recompute totals by new amount
  const rec = findRecordById(id);
  if (!rec) {
    alert("Record not found in cache. Please reload.");
    return;
  }

  // If user can edit rates, take from modal; otherwise force from record
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

function canEditRates() {
  return window.CAN_EDIT_RATES === true;
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

  // If current record job_code not found (deleted job), add a fallback option
  if (selectedJobCode && !jobs.some(j => String(j.job_code) === String(selectedJobCode))) {
    const opt = document.createElement("option");
    opt.value = selectedJobCode;
    opt.textContent = `${selectedJobCode} (missing)`;
    opt.selected = true;
    selectEl.insertBefore(opt, selectEl.firstChild);
  }
}

function getSelectedJob() {
  const jobCode = document.getElementById("editJobCode")?.value;
  return jobsCache.find(j => String(j.job_code) === String(jobCode)) || null;
}

function getSelectedTierId() {
  const v = document.getElementById("editWageTierId")?.value;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
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


// -------- helpers for dropdown + auto rates --------

// derive tiers list from jobs response (your /api/jobs already has wage_rates with tier_id/tier_name)
function deriveTiersFromJobs(jobs) {
  const first = jobs.find(j => Array.isArray(j.wage_rates) && j.wage_rates.length);
  if (!first) return [];
  return first.wage_rates.map(w => ({
    id: w.tier_id,          // ✅ IMPORTANT
    tier_name: w.tier_name
  }));
}


function applyRatesFromSelections() {
  const jobCode = document.getElementById("editJobCode")?.value;
  const tierId = Number(document.getElementById("editWageTierId")?.value);

  const job = jobsCache.find(j => String(j.job_code) === String(jobCode));
  if (!job) return;

  const customerRate = Number(job.normal_price ?? job.customer_rate ?? 0);

  let wageRate = 0;
  if (Number.isFinite(tierId) && Array.isArray(job.wage_rates)) {
    wageRate = Number(job.wage_rates.find(x => Number(x.tier_id) === tierId)?.wage_rate ?? 0) || 0;
  }

  const crEl = document.getElementById("editCustomerRate");
  const wrEl = document.getElementById("editWageRate");

  if (crEl) {
    crEl.value = customerRate ? customerRate.toFixed(2) : "";
    crEl.disabled = !canEditRates(); // allow manual override only if permitted
  }
  if (wrEl) {
    wrEl.value = wageRate ? wageRate.toFixed(2) : "";
    wrEl.disabled = !canEditRates();
  }

  recalcEditTotals();
}

function canSeeRates() {
  return !!window.CAN_EDIT_RATES; // from pagePerms
}

function applyRatesVisibility() {
  const showRates = canSeeRates();

  // Hide/show rate-related columns
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

  // ✅ Hide/show WAGE GRAND TOTAL ROW
  const wageTotalRow = document.getElementById("recordsWageTotalRow");
  if (wageTotalRow) {
    wageTotalRow.style.display = showRates ? "" : "none";
  }
  const CustTotalRow = document.getElementById("recordsCustomerTotalRow");
  if (CustTotalRow) {
    CustTotalRow.style.display = showRates ? "" : "none";
  }

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

  document.querySelectorAll("#recordsBody td[colspan]")
    .forEach(td => td.colSpan = visibleCols);

  const feesLabel = document.getElementById("recordsFeesLabelCell");
  const wageLabel = document.getElementById("recordsWageLabelCell");
  const custLabel = document.getElementById("recordsCustomerLabelCell");

  const labelSpan = Math.max(1, visibleCols - 1);

  if (feesLabel) feesLabel.colSpan = labelSpan;
  if (wageLabel) wageLabel.colSpan = labelSpan;
  if (custLabel) custLabel.colSpan = labelSpan;
}

