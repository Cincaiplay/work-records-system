// public/js/importExport.js

let currentImportType = null; // "workers" | "jobs" | "work_entries"
let lastPreviewHadErrors = true;

function getCompanyIdSafe() {
  return typeof window.getCurrentCompanyId === "function"
    ? (window.getCurrentCompanyId() || 1)
    : (Number(document.body?.dataset?.companyId || 1) || 1);
}

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[c]));
}

function badge(action) {
  const a = String(action || "").toUpperCase();
  const cls =
    a === "INSERT" ? "bg-success" :
    a === "UPDATE" ? "bg-primary" :
    a === "ERROR"  ? "bg-danger" :
    "bg-secondary";
  return `<span class="badge ${cls}">${esc(a || "-")}</span>`;
}

function cell(v) {
  const s = String(v ?? "").trim();
  return s ? esc(s) : "-";
}

function setPreviewTableHeaders(type) {
  const thead = document.getElementById("importPreviewHead");
  if (!thead) return;

  if (type === "workers") {
    thead.innerHTML = `
      <tr class="small text-uppercase">
        <th style="width:70px;">Row</th>
        <th style="width:90px;">Action</th>
        <th>Worker Code</th>
        <th>Worker Name</th>
        <th>English Name</th>
        <th>Passport No</th>
        <th>Nationality</th>
        <th>Start Date</th>
        <th style="width:80px;" class="text-center">Active</th>
        <th style="width:90px;" class="text-end">Wage Tier</th>
        <th>Note</th>
        <th style="width:220px;">Error</th>
      </tr>
    `;
    return;
  }

  if (type === "jobs") {
    // keep your existing jobs header or adjust later
    thead.innerHTML = `
      <tr class="small text-uppercase">
        <th style="width:70px;">Row</th>
        <th style="width:90px;">Action</th>
        <th>Job Code</th>
        <th>Job Type</th>
        <th class="text-end">Normal Price</th>
        <th style="width:220px;">Error</th>
      </tr>
    `;
    return;
  }

  if (type === "work_entries") {
    thead.innerHTML = `
      <tr class="small text-uppercase">
        <th style="width:70px;">Row</th>
        <th style="width:90px;">Action</th>
        <th>Date</th>
        <th>Job No1</th>
        <th>Job No2</th>
        <th>Worker Code</th>
        <th>Job Code</th>
        <th class="text-end">Hours</th>
        <th class="text-end">Fees</th>
        <th>Pay Type</th>
        <th class="text-end">Cust Rate</th>
        <th class="text-end">Wage Rate</th>
        <th>Note</th>
        <th style="width:240px;">Error</th>
      </tr>
    `;
    return;
  }

  thead.innerHTML = "";
}



window.downloadTemplate = function (type) {
  const companyId = getCompanyIdSafe(); // not required, but ok to keep
  if (type === "workers") return window.open(`/api/workers/template.csv?companyId=${companyId}`, "_blank");
  if (type === "jobs") return window.open(`/api/jobs/template.csv?companyId=${companyId}`, "_blank");
  alert("Unknown template type");
};

window.exportCsv = function (type) {
  const companyId = getCompanyIdSafe();

  const url =
    type === "workers"
      ? `/api/workers/export?companyId=${encodeURIComponent(companyId)}`
      : type === "jobs"
      ? `/api/jobs/export?companyId=${encodeURIComponent(companyId)}`
      : null;

  if (!url) return alert("Unknown export type.");

  // simple download (opens in new tab / triggers download headers)
  window.open(url, "_blank");
};


window.openImportModal = function (type) {
  currentImportType = type;

  setPreviewTableHeaders(currentImportType);

  document.getElementById("importModalTitle").textContent =
    type === "workers" ? "Import Workers (CSV) - Preview" :
    type === "jobs" ? "Import Jobs (CSV) - Preview" :
    type === "work_entries" ? "Import Work Entries (CSV) - Preview" :
    "Import Preview";

  // reset UI
  document.getElementById("importFile").value = "";
  document.getElementById("importPreviewMsg").textContent = "Choose a CSV file and click Preview.";
  document.getElementById("importSummary").style.display = "none";
  document.getElementById("importPreviewTable").style.display = "none";
  document.getElementById("importPreviewBody").innerHTML = "";
  document.getElementById("btnConfirmImport").disabled = true;
  lastPreviewHadErrors = true;

  const modal = new bootstrap.Modal(document.getElementById("importModal"));
  modal.show();
};

window.previewImport = async function () {
  const fileEl = document.getElementById("importFile");
  const msgEl = document.getElementById("importPreviewMsg");
  const btnConfirm = document.getElementById("btnConfirmImport");

  if (!currentImportType) return alert("No import type selected.");
  const file = fileEl?.files?.[0];
  if (!file) return alert("Please choose a CSV file.");

  msgEl.textContent = "Previewing...";
  btnConfirm.disabled = true;

  const companyId = getCompanyIdSafe();
  const fd = new FormData();
  fd.append("file", file);
  fd.append("companyId", String(companyId));

  const url =
    currentImportType === "workers"
      ? "/api/workers/import/preview"
      : currentImportType === "jobs"
      ? "/api/jobs/import/preview"
      : currentImportType === "work_entries"
      ? "/api/work-entries/import/preview"
      : null;

  if (!url) return alert("Unknown import type.");

  const res = await fetch(url, { method: "POST", body: fd });
  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    msgEl.textContent = data?.error || "Failed to preview import.";
    return;
  }

  // ✅ set the preview table headers for this import type
  setPreviewTableHeaders(currentImportType);

  // summary
  const t = data?.totals || {};
  document.getElementById("sumTotal").textContent = t.total ?? 0;
  document.getElementById("sumInsert").textContent = t.willInsert ?? 0;
  document.getElementById("sumUpdate").textContent = t.willUpdate ?? 0;
  document.getElementById("sumErrors").textContent = t.errors ?? 0;

  document.getElementById("importSummary").style.display = "";
  document.getElementById("importPreviewTable").style.display = "";

  // render rows
  const body = document.getElementById("importPreviewBody");
  body.innerHTML = "";

  const rows = data?.rows || [];

  if (currentImportType === "workers") {
    rows.forEach((r) => {
      const action = String(r.action || "").toUpperCase();
      const isError = action === "ERROR";

      const tr = document.createElement("tr");
      if (isError) tr.className = "table-danger";

      tr.innerHTML = `
        <td>${cell(r.row)}</td>
        <td>${badge(r.action)}</td>

        <td>${cell(r.worker_code)}</td>
        <td>${cell(r.worker_name)}</td>
        <td>${cell(r.worker_english_name)}</td>
        <td>${cell(r.passport_no)}</td>
        <td>${cell(r.nationality)}</td>
        <td>${cell(r.employment_start)}</td>

        <td class="text-center">${cell(r.is_active)}</td>
        <td class="text-end">${cell(r.wage_tier_id)}</td>

        <td>${cell(r.field1)}</td>
        <td class="text-danger small">${cell(r.error)}</td>
      `;
      body.appendChild(tr);
    });
  } else if (currentImportType === "jobs") {
    // keep jobs preview simple for now (matches your current backend preview output)
    rows.forEach((r) => {
      const action = String(r.action || "").toUpperCase();
      const isError = action === "ERROR";

      const tr = document.createElement("tr");
      if (isError) tr.className = "table-danger";

      tr.innerHTML = `
        <td>${cell(r.row)}</td>
        <td>${badge(r.action)}</td>
        <td>${cell(r.job_code)}</td>
        <td>${cell(r.job_type)}</td>
        <td class="text-end">${cell(r.normal_price)}</td>
        <td class="text-danger small">${cell(r.error)}</td>
      `;
      body.appendChild(tr);
    });
  } else if (currentImportType === "work_entries") {
    rows.forEach((r) => {
      const action = String(r.action || "").toUpperCase();
      const isError = action === "ERROR";

      const tr = document.createElement("tr");
      if (isError) tr.className = "table-danger";

      tr.innerHTML = `
        <td>${cell(r.row)}</td>
        <td>${badge(r.action)}</td>
        <td>${cell(r.work_date)}</td>
        <td>${cell(r.job_no1)}</td>
        <td>${cell(r.job_no2)}</td>
        <td>${cell(r.worker_code)}</td>
        <td>${cell(r.job_code)}</td>
        <td class="text-end">${cell(r.hours)}</td>
        <td class="text-end">${cell(r.fees_collected)}</td>
        <td>${cell(r.pay_type)}</td>
        <td class="text-end">${cell(r.customer_rate)}</td>
        <td class="text-end">${cell(r.wage_rate)}</td>
        <td>${cell(r.note)}</td>
        <td class="text-danger small">${cell(r.error)}</td>
      `;
      body.appendChild(tr);
    });
  }

  lastPreviewHadErrors = (t.errors ?? 0) > 0;

  msgEl.textContent = lastPreviewHadErrors
    ? "Preview completed. Fix errors before confirming."
    : "Preview completed. Ready to import.";

  btnConfirm.disabled = lastPreviewHadErrors;
};

window.confirmImport = async function () {
  if (!currentImportType) return alert("No import type selected.");
  if (lastPreviewHadErrors) return alert("Please fix preview errors first.");

  const fileEl = document.getElementById("importFile");
  const file = fileEl?.files?.[0];
  if (!file) return alert("Please choose a CSV file.");

  const companyId = getCompanyIdSafe();

  const fd = new FormData();
  fd.append("file", file);
  fd.append("companyId", String(companyId));

  const url =
    currentImportType === "workers"
      ? "/api/workers/import"
      : currentImportType === "jobs"
      ? "/api/jobs/import"
      : currentImportType === "work_entries"
      ? "/api/work-entries/import"
      : null;

  if (!url) return alert("Unknown import type.");

  const btn = document.getElementById("btnConfirmImport");
  btn.disabled = true;
  btn.innerHTML = `<span class="spinner-border spinner-border-sm me-2"></span> Importing...`;

  const res = await fetch(url, { method: "POST", body: fd });
  const data = await res.json().catch(() => ({}));

  btn.innerHTML = `<i class="bi bi-check2-circle"></i> Confirm Import`;

  if (!res.ok) {
    btn.disabled = false;
    return alert(data?.error || "Import failed.");
  }

  alert(`Import success!\nInserted: ${data.inserted || 0}\nUpdated: ${data.updated || 0}`);

  // close modal
  bootstrap.Modal.getInstance(document.getElementById("importModal"))?.hide();

  // refresh workers table if your workers.js has a reload function
  if (typeof window.loadWorkersTable === "function") window.loadWorkersTable();
  else window.location.reload();
};

function escapeHtml(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
