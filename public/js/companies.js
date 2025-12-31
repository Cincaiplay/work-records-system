// public/js/companies.js

let allCompanies = [];
let filteredCompanies = [];
let companyPage = 1;
const companyPageSize = 10;
let companyModal = null;

document.addEventListener("DOMContentLoaded", () => {
  const modalEl = document.getElementById("companyModal");
  companyModal = new bootstrap.Modal(modalEl);

  document.getElementById("searchCompanyCode").addEventListener("input", applyCompanyFilters);
  document.getElementById("searchCompanyName").addEventListener("input", applyCompanyFilters);

  loadCompanies();
});

// =================== LOAD COMPANIES ===================
function loadCompanies() {
  fetch("/api/companies")
    .then(res => res.json())
    .then(companies => {
      allCompanies = companies;
      filteredCompanies = [];
      companyPage = 1;
      renderCompanyTable();
    })
    .catch(err => console.error("loadCompanies error:", err));
}

function getCompanyData() {
  return filteredCompanies.length ? filteredCompanies : allCompanies;
}

// =================== FILTER ===================
function applyCompanyFilters() {
  const codeVal = document.getElementById("searchCompanyCode").value.toLowerCase().trim();
  const nameVal = document.getElementById("searchCompanyName").value.toLowerCase().trim();

  filteredCompanies = allCompanies.filter(c => {
    const code = (c.short_code || "").toLowerCase();
    const name = (c.name || "").toLowerCase();

    return (!codeVal || code.includes(codeVal)) &&
           (!nameVal || name.includes(nameVal));
  });

  companyPage = 1;
  renderCompanyTable();
}

// =================== RENDER TABLE ===================
function renderCompanyTable() {
  const tbody = document.getElementById("companiesBody");
  const data = getCompanyData();
  const total = data.length;

  const totalPages = Math.max(1, Math.ceil(total / companyPageSize));
  companyPage = Math.min(companyPage, totalPages);

  const start = (companyPage - 1) * companyPageSize;
  const pageItems = data.slice(start, start + companyPageSize);

  tbody.innerHTML = "";

  if (pageItems.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="5" class="text-center text-muted py-4">No companies found.</td>
      </tr>`;
  } else {
    pageItems.forEach(c => {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${c.short_code || "-"}</td>
        <td>${c.name}</td>
        <td>${c.address || "-"}</td>
        <td>${c.phone || "-"}</td>
        <td class="text-end">
          <button class="btn btn-sm btn-outline-primary me-2" onclick="openEditCompany(${c.id})">Edit</button>
          <button class="btn btn-sm btn-outline-danger" onclick="deleteCompany(${c.id})">Delete</button>
        </td>
      `;
      tbody.appendChild(tr);
    });
  }

  const end = start + pageItems.length;
  const text = total ? `Showing ${start + 1}-${end} of ${total} companies` : "No companies";

  document.getElementById("companiesCountTop").textContent = text;
  document.getElementById("companiesCountBottom").textContent = text;

  renderCompanyPagination(totalPages);
}

// =================== PAGINATION ===================
function renderCompanyPagination(totalPages) {
  renderCompanyPaginationSingle("companiesPaginationTop", totalPages);
  renderCompanyPaginationSingle("companiesPaginationBottom", totalPages);
}

function renderCompanyPaginationSingle(id, totalPages) {
  const ul = document.getElementById(id);
  ul.innerHTML = "";

  if (totalPages <= 1) {
    ul.style.display = "none";
    return;
  }

  ul.style.display = "flex";

  const windowSize = 5;
  let start = companyPage - Math.floor(windowSize / 2);
  let end = companyPage + Math.floor(windowSize / 2);

  if (start < 1) { end += 1 - start; start = 1; }
  if (end > totalPages) { start -= end - totalPages; end = totalPages; }

  // Prev
  const prev = document.createElement("li");
  prev.className = "page-item" + (companyPage === 1 ? " disabled" : "");
  prev.innerHTML = `<button class="page-link">&lt;</button>`;
  prev.onclick = () => { companyPage--; renderCompanyTable(); };
  ul.appendChild(prev);

  // Page numbers
  for (let i = start; i <= end; i++) {
    const li = document.createElement("li");
    li.className = "page-item" + (i === companyPage ? " active" : "");
    li.innerHTML = `<button class="page-link">${i}</button>`;
    li.onclick = () => { companyPage = i; renderCompanyTable(); };
    ul.appendChild(li);
  }

  // Next
  const next = document.createElement("li");
  next.className = "page-item" + (companyPage === totalPages ? " disabled" : "");
  next.innerHTML = `<button class="page-link">&gt;</button>`;
  next.onclick = () => { companyPage++; renderCompanyTable(); };
  ul.appendChild(next);
}

// =================== MODAL FUNCTIONS ===================
async function loadCompanyRulesIntoModal(companyId) {
  const box = document.getElementById("companyRulesBox");
  if (!box) return;

  box.innerHTML = `<div class="text-muted small">Loading rules...</div>`;

  try {
    const res = await fetch(`/api/companies/${companyId}/rules`);
    if (!res.ok) {
      box.innerHTML = `<div class="text-danger small">Failed to load rules (HTTP ${res.status}).</div>`;
      return;
    }

    const rules = await res.json();

    if (!Array.isArray(rules)) {
      box.innerHTML = `<div class="text-danger small">Rules API returned invalid data.</div>`;
      return;
    }

    box.innerHTML = rules.map(r => {
      const disabled = r.is_default ? "disabled" : "";
      const checked = (r.enabled || r.is_default) ? "checked" : "";
      return `
        <div class="form-check mb-2">
          <input class="form-check-input company-rule"
                 type="checkbox"
                 data-rule="${r.code}"
                 id="rule_${r.code}"
                 ${checked} ${disabled}>
          <label class="form-check-label" for="rule_${r.code}">
            <div class="fw-medium">${r.name}</div>
            ${r.description ? `<div class="text-muted small">${r.description}</div>` : ""}
          </label>
        </div>
      `;
    }).join("");
  } catch (err) {
    console.error("loadCompanyRulesIntoModal error:", err);
    box.innerHTML = `<div class="text-danger small">Error loading rules.</div>`;
  }
}

window.openEditCompany = function (id) {
  const c = allCompanies.find(x => x.id === id);
  if (!c) return;

  document.getElementById("companyId").value = c.id;
  document.getElementById("companyName").value = c.name || "";
  document.getElementById("companyShortCode").value = c.short_code || "";
  document.getElementById("companyAddress").value = c.address || "";
  document.getElementById("companyPhone").value = c.phone || "";

  // ✅ Open modal immediately (never blocked by rules loading)
  companyModal.show();

  // ✅ Load rules after modal opens (safe)
  loadCompanyRulesIntoModal(id);
};


window.openCreateCompany = function () {
  document.getElementById("companyForm").reset();
  document.getElementById("companyId").value = "";

  const box = document.getElementById("companyRulesBox");
  if (box) {
    box.innerHTML = `<div class="text-muted small">Save company first, then edit rules.</div>`;
  }

  companyModal.show();
};




window.saveCompany = async function () {
  const idRaw = document.getElementById("companyId").value.trim();

  const payload = {
    name: document.getElementById("companyName").value.trim(),
    short_code: document.getElementById("companyShortCode").value.trim(),
    address: document.getElementById("companyAddress").value.trim(),
    phone: document.getElementById("companyPhone").value.trim(),
  };

  if (!payload.name) {
    alert("Company name is required.");
    return;
  }

  const isEdit = !!idRaw;
  const method = isEdit ? "PUT" : "POST";
  const url = isEdit ? `/api/companies/${idRaw}` : "/api/companies";

  try {
    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const data = await res.json();
    if (!res.ok) {
      alert(data?.error || "Error saving company.");
      return;
    }

    // ✅ Use correct companyId for rules
    const companyId = isEdit ? parseInt(idRaw, 10) : data.id;
    if (!companyId) {
      alert("Saved company but missing company id response.");
      return;
    }

    await saveCompanyRules(companyId);

    companyModal.hide();
    loadCompanies();

    // optional: refresh navbar dropdown
    if (typeof window.refreshCompanyDropdown === "function") {
      window.refreshCompanyDropdown(companyId);
    }
  } catch (err) {
    console.error("saveCompany error:", err);
    alert("Error saving company.");
  }
};


async function saveCompanyRules(companyId) {
  const selected = Array.from(document.querySelectorAll(".company-rule:checked"))
    .map(cb => cb.dataset.rule);

  // base rule always on (safety)
  if (!selected.includes("BASE_NATIONALITY")) selected.push("BASE_NATIONALITY");

  await fetch(`/api/companies/${companyId}/rules`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ rules: selected })
  });
}

window.deleteCompany = function (id) {
  if (!confirm("Delete this company?")) return;

  fetch(`/api/companies/${id}`, { method: "DELETE" })
    .then(res => res.json())
    .then(() => {
      loadCompanies();

      // 🔹 refresh navbar dropdown as well
      if (typeof window.refreshCompanyDropdown === "function") {
        window.refreshCompanyDropdown();
      }
    })
    .catch(err => {
      console.error("deleteCompany error:", err);
      alert("Error deleting company.");
    });
};
