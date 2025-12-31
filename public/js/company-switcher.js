// public/js/company-switcher.js
const STORAGE_KEY = "companyId";

// ---- companyReady: create ONCE, resolve later (admin or non-admin) ----
let _companyReadyResolve;
window.companyReady =
  window.companyReady ||
  new Promise((res) => {
    _companyReadyResolve = res;
  });

function resolveCompanyReady(companyId) {
  try {
    _companyReadyResolve?.(companyId ?? null);
  } catch {}
  // in case something else is waiting on event instead of promise
  window.dispatchEvent(new CustomEvent("company:ready", { detail: { companyId: companyId ?? null } }));
}

function getUserCompanyId() {
  const raw = document.body?.dataset?.companyId;
  const n = raw ? parseInt(raw, 10) : null;
  return Number.isFinite(n) ? n : null;
}

window.getCurrentCompanyId = function () {
  const stored = localStorage.getItem(STORAGE_KEY);
  const n = stored ? parseInt(stored, 10) : null;
  return Number.isFinite(n) ? n : null;
};

// ---- Non-admin: set companyId immediately from server-rendered user.company_id ----
// IMPORTANT: This is safe even if DOM isn't ready (no DOM needed).
(function initCompanyForNonAdmin() {
  // Admin pages have #companySelect; non-admin pages do not.
  // But don't rely on DOM existing yet; just use userCompanyId as fallback.
  const userCompanyId = getUserCompanyId();
  if (userCompanyId) {
    // for non-admin, force localStorage to their own company
    // (admin will overwrite later after loading /api/companies)
    localStorage.setItem(STORAGE_KEY, String(userCompanyId));
  }
})();

async function postActiveCompanyToSession(companyId) {
  if (!companyId) return;
  await fetch("/context/company", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ company_id: companyId }),
  });
}

async function loadCompanySelect() {
  const select = document.getElementById("companySelect");

  // ---- Non-admin: no selector, just resolve and finish ----
  if (!select) {
    const userCompanyId = getUserCompanyId() || window.getCurrentCompanyId();
    // optional: ensure session matches (usually already correct for non-admin)
    // await postActiveCompanyToSession(userCompanyId).catch(() => {});
    resolveCompanyReady(userCompanyId);
    return;
  }

  // ---- Admin: populate selector from API ----
  try {
    const companies = await fetch("/api/companies").then((r) => r.json());

    // build options
    select.innerHTML = "";
    (companies || []).forEach((c) => {
      const opt = document.createElement("option");
      opt.value = String(c.id);
      opt.textContent = c.name;
      select.appendChild(opt);
    });

    // choose initial value from localStorage or first company
    const stored = localStorage.getItem(STORAGE_KEY);
    const storedId = stored ? parseInt(stored, 10) : null;
    const exists = storedId && (companies || []).some((c) => Number(c.id) === Number(storedId));
    const valueToUse = exists ? storedId : companies?.[0]?.id || null;

    if (valueToUse) {
      select.value = String(valueToUse);
      localStorage.setItem(STORAGE_KEY, String(valueToUse));

      // ✅ wait until session sync finishes before telling dashboard "ready"
      await postActiveCompanyToSession(valueToUse).catch(() => {});
    }

    // resolve ready
    resolveCompanyReady(valueToUse);

    // bind change once
    if (!select.dataset.boundChange) {
      select.addEventListener("change", async function () {
        const newId = Number(this.value);
        if (!newId) return;

        localStorage.setItem(STORAGE_KEY, String(newId));

        // update SESSION active company then reload
        await postActiveCompanyToSession(newId).catch(() => {});
        window.location.reload();
      });
      select.dataset.boundChange = "1";
    }
  } catch (err) {
    console.error("loadCompanySelect failed:", err);

    // still resolve so dashboard doesn't hang
    resolveCompanyReady(window.getCurrentCompanyId() || getUserCompanyId() || null);
  }
}

document.addEventListener("DOMContentLoaded", loadCompanySelect);
