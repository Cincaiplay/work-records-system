let allJobs = [];
let wageTiers = [];
let currentPage = 1;
const pageSize = 10;
let jobModal;

const companyId = getCurrentCompanyId() || 1;

// bulk select (across pages)
let selectedJobIds = new Set();

document.addEventListener("DOMContentLoaded", async () => {
  jobModal = new bootstrap.Modal(document.getElementById("jobModal"));

  const search = document.getElementById("searchJobCode");
  if (search) {
    search.addEventListener("input", () => {
      currentPage = 1;
      renderTable();
    });
  }

  const selectAll = document.getElementById("selectAllJobs");
  if (selectAll) {
    selectAll.addEventListener("change", (e) => {
      toggleSelectAllOnCurrentPage(e.target.checked);
    });
  }

  await loadWageTiers();
  await loadJobs();
});

async function loadWageTiers() {
  const res = await fetch(`/api/wage-tiers?companyId=${companyId}`);
  wageTiers = await res.json();
  buildTableHeader();
}

async function loadJobs() {
  const res = await fetch(`/api/jobs?companyId=${companyId}`);
  allJobs = await res.json();

  // remove selections that no longer exist
  const ids = new Set(allJobs.map(j => Number(j.id)));
  selectedJobIds = new Set([...selectedJobIds].filter(id => ids.has(id)));

  renderTable();
}

function buildTableHeader() {
  const row = document.getElementById("jobsHeadRow");

  row.innerHTML = `
    <th style="width: 42px;" class="text-center">
      <input class="form-check-input" type="checkbox" id="selectAllJobs" />
    </th>
    <th>Code</th>
    <th>Job Type</th>
    <th>Normal</th>
    ${wageTiers.map(t => `<th>${escapeHtml(t.tier_name)}</th>`).join("")}
    <th class="text-end">Actions</th>
  `;

  // re-bind select-all because we replaced the header HTML
  const selectAll = document.getElementById("selectAllJobs");
  if (selectAll) {
    selectAll.addEventListener("change", (e) => {
      toggleSelectAllOnCurrentPage(e.target.checked);
    });
  }
}

function getFilteredJobs() {
  const q = (document.getElementById("searchJobCode")?.value || "").toLowerCase().trim();
  if (!q) return allJobs;

  return allJobs.filter(j =>
    String(j.job_code || "").toLowerCase().includes(q) ||
    String(j.job_type || "").toLowerCase().includes(q)
  );
}

function renderTable() {
  const tbody = document.getElementById("jobsBody");
  tbody.innerHTML = "";

  const data = getFilteredJobs();

  const totalPages = Math.max(1, Math.ceil(data.length / pageSize));
  if (currentPage > totalPages) currentPage = totalPages;

  const start = (currentPage - 1) * pageSize;
  const page = data.slice(start, start + pageSize);

  const colCount = 5 + wageTiers.length; // checkbox + Code + Type + Normal + tiers + Actions

  if (!page.length) {
    tbody.innerHTML = `
      <tr>
        <td colspan="${colCount}" class="text-center text-muted py-4">No jobs found.</td>
      </tr>
    `;
    renderPagination(data.length, totalPages);
    updateSelectAllCheckbox();
    updateBulkDeleteButton();
    return;
  }

  page.forEach(j => {
    const rates = new Map((j.wage_rates || []).map(r => [r.tier_id, r.wage_rate]));
    const checked = selectedJobIds.has(Number(j.id)) ? "checked" : "";

    tbody.innerHTML += `
      <tr>
        <td class="text-center align-middle">
          <input class="form-check-input job-row-checkbox"
                 type="checkbox"
                 data-id="${j.id}"
                 ${checked} />
        </td>
        <td>${escapeHtml(j.job_code)}</td>
        <td>${escapeHtml(j.job_type)}</td>
        <td>${Number(j.normal_price || 0).toFixed(2)}</td>
        ${wageTiers.map(t => `<td>${(rates.get(t.id) != null) ? Number(rates.get(t.id)).toFixed(2) : "-"}</td>`).join("")}
        <td class="text-end">
          <button class="btn btn-sm btn-outline-primary me-2" onclick="editJob(${j.id})">Edit</button>
          <button class="btn btn-sm btn-outline-danger" onclick="deleteJob(${j.id})">Delete</button>
        </td>
      </tr>
    `;
  });

  // bind row checkbox handlers
  document.querySelectorAll(".job-row-checkbox").forEach(cb => {
    cb.addEventListener("change", (e) => {
      const id = Number(e.target.dataset.id);
      if (e.target.checked) selectedJobIds.add(id);
      else selectedJobIds.delete(id);

      updateSelectAllCheckbox();
      updateBulkDeleteButton();
    });
  });

  renderPagination(data.length, totalPages);
  updateSelectAllCheckbox();
  updateBulkDeleteButton();
}

function renderPagination(total, totalPages) {
  const text = total
    ? `Showing ${(currentPage - 1) * pageSize + 1}-${Math.min(currentPage * pageSize, total)} of ${total} jobs`
    : "No jobs";

  const topCount = document.getElementById("jobsCountTop");
  const bottomCount = document.getElementById("jobsCountBottom");
  if (topCount) topCount.textContent = text;
  if (bottomCount) bottomCount.textContent = text;

  renderOnePager("jobsPaginationTop", totalPages);
  renderOnePager("jobsPagination", totalPages);
}

function renderOnePager(elementId, totalPages) {
  const ul = document.getElementById(elementId);
  if (!ul) return;

  ul.innerHTML = "";

  if (totalPages <= 1) {
    ul.style.display = "none";
    return;
  }
  ul.style.display = "flex";

  const windowSize = 5;
  let s = currentPage - Math.floor(windowSize / 2);
  let e = currentPage + Math.floor(windowSize / 2);

  if (s < 1) { e += 1 - s; s = 1; }
  if (e > totalPages) { s -= e - totalPages; e = totalPages; if (s < 1) s = 1; }

  const prev = document.createElement("li");
  prev.className = "page-item" + (currentPage === 1 ? " disabled" : "");
  prev.innerHTML = `<button class="page-link">&lt;</button>`;
  prev.addEventListener("click", () => {
    if (currentPage > 1) { currentPage--; renderTable(); }
  });
  ul.appendChild(prev);

  for (let i = s; i <= e; i++) {
    const li = document.createElement("li");
    li.className = "page-item" + (i === currentPage ? " active" : "");
    li.innerHTML = `<button class="page-link">${i}</button>`;
    li.addEventListener("click", () => {
      currentPage = i;
      renderTable();
    });
    ul.appendChild(li);
  }

  const next = document.createElement("li");
  next.className = "page-item" + (currentPage === totalPages ? " disabled" : "");
  next.innerHTML = `<button class="page-link">&gt;</button>`;
  next.addEventListener("click", () => {
    if (currentPage < totalPages) { currentPage++; renderTable(); }
  });
  ul.appendChild(next);
}

// -------- bulk selection helpers --------

function toggleSelectAllOnCurrentPage(checked) {
  const filtered = getFilteredJobs();

  filtered.forEach(j => {
    const id = Number(j.id);
    if (checked) selectedJobIds.add(id);
    else selectedJobIds.delete(id);
  });

  // update visible checkboxes only
  document.querySelectorAll(".job-row-checkbox").forEach(cb => {
    cb.checked = checked;
  });

  updateBulkDeleteButton();
}


function updateSelectAllCheckbox() {
  const selectAll = document.getElementById("selectAllJobs");
  if (!selectAll) return;

  const filtered = getFilteredJobs();

  if (!filtered.length) {
    selectAll.checked = false;
    selectAll.indeterminate = false;
    return;
  }

  const selectedCount = filtered.filter(j =>
    selectedJobIds.has(Number(j.id))
  ).length;

  if (selectedCount === 0) {
    selectAll.checked = false;
    selectAll.indeterminate = false;
  } else if (selectedCount === filtered.length) {
    selectAll.checked = true;
    selectAll.indeterminate = false;
  } else {
    selectAll.checked = false;
    selectAll.indeterminate = true;
  }
}


function updateBulkDeleteButton() {
  const btn = document.getElementById("bulkDeleteJobsBtn");
  if (!btn) return;

  const count = selectedJobIds.size;
  btn.disabled = count === 0;
  btn.innerHTML = count === 0
    ? `<i class="bi bi-trash me-1"></i> Delete Selected`
    : `<i class="bi bi-trash me-1"></i> Delete Selected (${count})`;
}

// -------- modal --------

function buildWageInputs(job) {
  const box = document.getElementById("wageRatesContainer");
  const map = new Map(job?.wage_rates?.map(r => [r.tier_id, r.wage_rate]) || []);

  box.innerHTML = wageTiers.map(t => `
    <div class="col-md-3">
      <label class="form-label">${escapeHtml(t.tier_name)}</label>
      <input type="number" step="0.01"
             class="form-control wage-input"
             data-tier-id="${t.id}"
             value="${map.get(t.id) ?? ""}">
    </div>
  `).join("");
}

window.openCreateJobModal = () => {
  document.getElementById("jobForm").reset();
  document.getElementById("jobId").value = "";
  buildWageInputs(null);
  jobModal.show();
};

window.editJob = id => {
  const j = allJobs.find(x => x.id === id);
  if (!j) return;

  document.getElementById("jobId").value = j.id;
  document.getElementById("jobCode").value = j.job_code;
  document.getElementById("jobType").value = j.job_type;
  document.getElementById("normalPrice").value = j.normal_price;
  document.getElementById("isActive").value = j.is_active;
  buildWageInputs(j);
  jobModal.show();
};

window.saveJob = async () => {
  const id = document.getElementById("jobId").value;

  const wage_rates = [...document.querySelectorAll(".wage-input")].map(i => ({
    tier_id: Number(i.dataset.tierId),
    wage_rate: Number(i.value || 0),
  }));

  const payload = {
    companyId,
    job_code: jobCode.value.trim(),
    job_type: jobType.value.trim(),
    normal_price: Number(normalPrice.value || 0),
    is_active: Number(isActive.value || 1),
    wage_rates,
  };

  const method = id ? "PUT" : "POST";
  const url = id ? `/api/jobs/${id}?companyId=${companyId}` : `/api/jobs`;

  const res = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    alert(data?.error || "Save failed");
    return;
  }

  jobModal.hide();
  await loadJobs();
};

window.deleteJob = async (id) => {
  const j = allJobs.find(x => x.id === id);
  const label = j ? `${j.job_code} – ${j.job_type}` : `Job ID ${id}`;

  if (!confirm(`Delete this job?\n\n${label}`)) return;

  const res = await fetch(`/api/jobs/${id}?companyId=${companyId}`, { method: "DELETE" });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    alert(data?.error || "Delete failed");
    return;
  }

  selectedJobIds.delete(Number(id));
  await loadJobs();
};

window.bulkDeleteJobs = async () => {
  const ids = [...selectedJobIds];
  if (ids.length === 0) return;

  const msg =
    `Delete ${ids.length} selected job(s)?\n\n` +
    `This will remove the job(s) and their wage rows.\n` +
    `If any job is used by Work Entries, delete may fail (FK restriction).`;

  if (!confirm(msg)) return;

  // sequential delete (simpler + clearer errors)
  for (const id of ids) {
    const res = await fetch(`/api/jobs/${id}?companyId=${companyId}`, { method: "DELETE" });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      alert(`Failed deleting Job ID ${id}: ${data?.error || "Delete failed"}`);
      break;
    }
    selectedJobIds.delete(Number(id));
  }

  await loadJobs();
};

// basic escape for tier names / job text
function escapeHtml(str) {
  return String(str ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
