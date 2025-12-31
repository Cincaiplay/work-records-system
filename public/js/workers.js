// public/js/workers.js

let allWorkers = [];
let filteredWorkers = [];
let wageTiers = [];
let currentPage = 1;
const pageSize = 10;
let workerModal;


const companyId =
  (typeof window.getCurrentCompanyId === "function" ? window.getCurrentCompanyId() : null)
  || Number(document.body?.dataset?.companyId || 0)
  || null;

if (!companyId) {
  console.warn("No companyId available yet.");
}

document.addEventListener("DOMContentLoaded", async () => {
  const modalEl = document.getElementById("workerModal");
  workerModal = new bootstrap.Modal(modalEl);

  const searchInput = document.getElementById("searchWorker");
  if (searchInput) {
    searchInput.addEventListener("keyup", function () {
      const q = this.value.toLowerCase().trim();
      if (!q) filteredWorkers = [];
      else {
        filteredWorkers = allWorkers.filter(w =>
          (w.worker_code || "").toLowerCase().includes(q) ||
          (w.worker_name || "").toLowerCase().includes(q) ||
          (w.worker_english_name || "").toLowerCase().includes(q) ||
          (w.passport_no || "").toLowerCase().includes(q)
        );
      }
      currentPage = 1;
      renderWorkersTable();
    });
  }

  await loadWageTiers();   // ✅ NEW (load once)
  loadWorkers();
});

async function loadWageTiers() {
  try {
    const res = await fetch(`/api/wage-tiers?companyId=${companyId}`);
    wageTiers = await res.json();

    const sel = document.getElementById("wageTierId");
    if (!sel) return;

    sel.innerHTML = `<option value="">(Default / None)</option>` +
      (wageTiers || []).filter(t => t.is_active !== 0).map(t =>
        `<option value="${t.id}">${t.tier_name}</option>`
      ).join("");
  } catch (err) {
    console.error("loadWageTiers error:", err);
  }
}

function loadWorkers() {
  fetch(`/api/workers?companyId=${companyId}`)
    .then(res => res.json())
    .then(workers => {
      allWorkers = workers || [];
      filteredWorkers = [];
      currentPage = 1;
      renderWorkersTable();
    })
    .catch(err => console.error("loadWorkers error:", err));
}

function getCurrentData() {
  return (filteredWorkers.length ? filteredWorkers : allWorkers) || [];
}

function renderWorkersTable() {
  const tbody = document.getElementById("workersBody");
  const data = getCurrentData();
  const total = data.length;

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  if (currentPage > totalPages) currentPage = totalPages;

  const start = (currentPage - 1) * pageSize;
  const pageItems = data.slice(start, start + pageSize);

  tbody.innerHTML = "";

  if (!pageItems.length) {
    tbody.innerHTML = `
      <tr>
        <td colspan="10" class="text-center text-muted py-4">No workers found.</td>
      </tr>`;
  } else {
    pageItems.forEach(w => {
      const row = document.createElement("tr");
      row.innerHTML = `
        <td>${w.worker_code}</td>
        <td>${w.worker_name || "-"}</td>
        <td>${w.worker_english_name || "-"}</td>
        <td>${w.passport_no || "-"}</td>
        <td>${w.nationality || "-"}</td>
        <td>${w.employment_start || "-"}</td>
        <td>${w.wage_tier_name || "-"}</td>
        <td>${w.is_active ? "Yes" : "No"}</td>
        <td>${w.field1 || "-"}</td>
        <td class="text-end">
          <button class="btn btn-sm btn-outline-primary me-2" onclick="openEditModal(${w.id})">Edit</button>
          <button class="btn btn-sm btn-outline-danger" onclick="deleteWorker(${w.id})">Delete</button>
        </td>
      `;
      tbody.appendChild(row);
    });
  }

  const end = start + pageItems.length;
  const text = total ? `Showing ${start + 1}-${end} of ${total} workers` : "No workers";

  document.getElementById("workersCountTop").textContent = text;
  document.getElementById("workersCountBottom").textContent = text;

  renderPagination(totalPages);
}

// Edit modal
window.openEditModal = function (id) {
  const workerId = Number(id);
  const w = allWorkers.find(x => Number(x.id) === workerId);
  if (!w) {
    console.warn("Worker not found:", id, allWorkers);
    return;
  }

  document.getElementById("workerId").value = w.id;
  document.getElementById("workerCode").value = w.worker_code || "";
  document.getElementById("workerName").value = w.worker_name || "";
  document.getElementById("workerEnglishName").value = w.worker_english_name || "";
  document.getElementById("passportNo").value = w.passport_no || "";
  document.getElementById("nationality").value = w.nationality || "";
  document.getElementById("employmentStart").value = w.employment_start || "";
  document.getElementById("field1").value = w.field1 || "";

  // Active flag (NEW UI field)
  const isActiveSel = document.getElementById("isActive");
  if (isActiveSel) isActiveSel.value = w.is_active ? "1" : "0";

  // Wage tier
  const sel = document.getElementById("wageTierId");
  if (sel) sel.value = w.wage_tier_id ?? "";

  workerModal.show();
};


window.openCreateModal = function () {
  document.getElementById("workerForm").reset();
  document.getElementById("workerId").value = "";

  const sel = document.getElementById("wageTierId");
  if (sel) sel.value = "";

  workerModal.show();
};

window.saveWorker = function () {
  const id = document.getElementById("workerId").value.trim();

  const wageTierId = document.getElementById("wageTierId")?.value || "";

  const payload = {
    companyId,
    worker_code: document.getElementById("workerCode").value,
    worker_name: document.getElementById("workerName").value,
    worker_english_name: document.getElementById("workerEnglishName").value,
    passport_no: document.getElementById("passportNo").value,
    employment_start: document.getElementById("employmentStart").value,
    nationality: document.getElementById("nationality").value,
    field1: document.getElementById("field1").value,
    is_active: document.getElementById("isActive").value === "1" ? 1 : 0,
    wage_tier_id: wageTierId ? Number(wageTierId) : null,
    };


  if (!payload.worker_code) {
    alert("Worker code is required.");
    return;
  }

  const method = id ? "PUT" : "POST";
  const url = id ? `/api/workers/${id}?companyId=${companyId}` : `/api/workers`;

  fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  })
    .then(res => res.json())
    .then(() => {
      workerModal.hide();
      loadWorkers();
    })
    .catch(err => {
      console.error(err);
      alert("Error saving worker.");
    });
};

function renderPagination(totalPages) {
  renderSinglePagination("workersPaginationTop", totalPages);
  renderSinglePagination("workersPagination", totalPages);
}

function renderSinglePagination(elementId, totalPages) {
  const ul = document.getElementById(elementId);
  if (!ul) return;

  ul.innerHTML = "";

  if (totalPages <= 1) {
    ul.style.display = "none";
    return;
  }
  ul.style.display = "flex";

  const windowSize = 5;
  let start = currentPage - Math.floor(windowSize / 2);
  let end = currentPage + Math.floor(windowSize / 2);

  if (start < 1) { end += 1 - start; start = 1; }
  if (end > totalPages) { start -= end - totalPages; end = totalPages; if (start < 1) start = 1; }

  // Prev
  const prevLi = document.createElement("li");
  prevLi.className = "page-item" + (currentPage === 1 ? " disabled" : "");
  prevLi.innerHTML = `<button class="page-link">&lt;</button>`;
  prevLi.addEventListener("click", () => {
    if (currentPage > 1) {
      currentPage--;
      renderWorkersTable();
    }
  });
  ul.appendChild(prevLi);

  // Numbers
  for (let i = start; i <= end; i++) {
    const li = document.createElement("li");
    li.className = "page-item" + (i === currentPage ? " active" : "");
    li.innerHTML = `<button class="page-link">${i}</button>`;
    li.addEventListener("click", () => {
      currentPage = i;
      renderWorkersTable();
    });
    ul.appendChild(li);
  }

  // Next
  const nextLi = document.createElement("li");
  nextLi.className = "page-item" + (currentPage === totalPages ? " disabled" : "");
  nextLi.innerHTML = `<button class="page-link">&gt;</button>`;
  nextLi.addEventListener("click", () => {
    if (currentPage < totalPages) {
      currentPage++;
      renderWorkersTable();
    }
  });
  ul.appendChild(nextLi);
}

window.deleteWorker = async function (id) {
  const w = allWorkers.find(x => x.id === id);
  const label = w ? `${w.worker_code}${w.worker_name ? " - " + w.worker_name : ""}` : `ID ${id}`;

  if (!confirm(`Are you sure you want to delete worker: ${label}?`)) return;

  try {
    const res = await fetch(`/api/workers/${id}?companyId=${companyId}`, {
      method: "DELETE",
    });

    const data = await res.json();

    if (!res.ok) {
      alert(data?.error || "Failed to delete worker.");
      return;
    }

    // refresh list
    loadWorkers();
  } catch (err) {
    console.error("deleteWorker error:", err);
    alert("Error deleting worker.");
  }
};
