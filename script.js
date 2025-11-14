// script.js
// Module for KCI Case Tracker (cloud-synced, real-time)
// Assumes index.html included SheetJS <script> (xlsx.full.min.js) and firebase-init.js exists (exports `app`)

import { app } from "./firebase-init.js";
import {
  getFirestore,
  collection,
  doc,
  setDoc,
  updateDoc,
  deleteDoc,
  onSnapshot,
  getDocs,
  query,
  orderBy,
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-auth.js";

const db = getFirestore(app);
const auth = getAuth(app);

// ---------- CONSTANTS / STATE ----------
const CASES_COLLECTION = "cases";
const SETTINGS_DOC = ["settings", "access"]; // settings/access doc for admin email

const LS_FILTERS = "KCI_FILTERS_V1";
const LS_THEME = "KCI_THEME_V1";

let ADMIN_EMAIL = null;
let currentUserEmail = null;

let allCases = []; // local cache of cases (kept in sync via onSnapshot)
let currentFilters = {
  search: "",
  status: "",
  from: "",
  to: "",
  primaries: {
    caseResolutionCode: [],
    tl: [],
    sbd: [],
    caGroup: [],
    onsiteRFC: [],
    csrRFC: [],
    benchRFC: [],
    country: [],
  },
  primaryLocks: {
    caseResolutionCode: false,
    tl: false,
    sbd: false,
    caGroup: false,
    onsiteRFC: false,
    csrRFC: false,
    benchRFC: false,
    country: false,
  },
  mode: "normal", // normal | due | flagged | repeat | unupdated
  sortByDateAsc: null,
};

// Primary filter specs (same as original)
const PRIMARY_SPECS = [
  { key: "caseResolutionCode", label: "Case Resolution Code" },
  { key: "tl", label: "TL" },
  { key: "sbd", label: "SBD" },
  { key: "caGroup", label: "CA Group" },
  { key: "onsiteRFC", label: "Onsite RFC Status" },
  { key: "csrRFC", label: "CSR RFC Status" },
  { key: "benchRFC", label: "Bench RFC Status" },
  { key: "country", label: "Country" },
];

const STATUS_OPTIONS = [
  "Closed",
  "NCM 1",
  "NCM 2",
  "PNS",
  "Service Pending",
  "Monitoring",
];

// ---------- DOM REFS ----------
const el = {
  // header + upload
  btnHamburger: document.getElementById("btnHamburger"),
  btnTheme: document.getElementById("btnTheme"),
  btnUpload: document.getElementById("btnUpload"),
  fileInput: document.getElementById("fileInput"),

  // export/import
  btnExport: document.getElementById("btnExport"),
  btnImport: document.getElementById("btnImport"),
  importBackupInput: document.getElementById("importBackupInput"),

  // controls
  txtSearch: document.getElementById("txtSearch"),
  ddlStatusFilter: document.getElementById("ddlStatusFilter"),
  dateFrom: document.getElementById("dateFrom"),
  dateTo: document.getElementById("dateTo"),
  btnApply: document.getElementById("btnApply"),
  btnClear: document.getElementById("btnClear"),

  // set2
  btnDueToday: document.getElementById("btnDueToday"),
  btnFlagged: document.getElementById("btnFlagged"),
  btnRepeating: document.getElementById("btnRepeating"),
  btnSortDate: document.getElementById("btnSortDate"),
  btnUnupdated: document.getElementById("btnUnupdated"),
  badgeDue: document.getElementById("badgeDue"),
  badgeFlag: document.getElementById("badgeFlag"),

  // sidebar
  overlay: document.getElementById("overlay"),
  sidebar: document.getElementById("sidebar"),
  filtersContainer: document.getElementById("filtersContainer"),
  btnSideApply: document.getElementById("btnSideApply"),
  btnSideClose: document.getElementById("btnSideClose"),

  // table
  tbody: document.getElementById("tbody"),

  // modal
  modal: document.getElementById("modal"),
  modalTitle: document.getElementById("modalTitle"),
  optLastActioned: document.getElementById("optLastActioned"),
  optDate: document.getElementById("optDate"),
  optFlag: document.getElementById("optFlag"),
  optNotes: document.getElementById("optNotes"),
  btnModalSave: document.getElementById("btnModalSave"),
  btnModalClose: document.getElementById("btnModalClose"),

  // other
  toast: document.getElementById("toast"),
  loading: document.getElementById("loading"),
  appBody: document.getElementById("appBody"),
};

// ---------- UTIL: Date conversions (DD-MM-YYYY) ----------
function dmyToDateObj(dmy) {
  // Accepts "DD-MM-YYYY" or "YYYY-MM-DD" as fallback
  if (!dmy) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(dmy)) {
    return new Date(dmy + "T00:00:00");
  }
  const m = dmy.match(/^(\d{2})-(\d{2})-(\d{4})$/);
  if (!m) return new Date(dmy); // try JS parse
  return new Date(`${m[3]}-${m[2]}-${m[1]}T00:00:00`);
}
function dateObjToDMY(dateObj) {
  if (!dateObj) return "";
  const d = dateObj instanceof Date ? dateObj : new Date(dateObj);
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yy = d.getFullYear();
  return `${dd}-${mm}-${yy}`;
}
function todayDMY() {
  return dateObjToDMY(new Date());
}
// Excel serial number to DD-MM-YYYY
function excelSerialToDMY(serial) {
  if (serial == null || serial === "") return "";
  // If number-like: convert
  if (typeof serial === "number" || /^\d+(\.\d+)?$/.test(String(serial))) {
    // Excel's epoch: 1899-12-30
    const excelEpoch = Date.UTC(1899, 11, 30);
    const ms = Math.round(Number(serial) * 86400000);
    const d = new Date(excelEpoch + ms);
    return dateObjToDMY(d);
  }
  // if it's string with a datetime
  const s = String(serial).trim();
  // If like "30-09-2025 20:26:45" or "30/09/2025 20:..."
  const m = s.match(/^(\d{2})[-\/](\d{2})[-\/](\d{4})/);
  if (m) {
    return `${m[1]}-${m[2]}-${m[3]}`;
  }
  // ISO parse fallback
  const d = new Date(s);
  if (!isNaN(d)) return dateObjToDMY(d);
  return "";
}

// ---------- HELPERS ----------
function showToast(text = "Copied!") {
  el.toast.textContent = text;
  el.toast.classList.add("show");
  setTimeout(() => el.toast.classList.remove("show"), 1100);
}

function escapeHtml(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// ---------- FIRESTORE: real-time sync ----------
function attachRealtimeListener() {
  // Listen to the whole collection ordered by case id (or createdOn)
  const q = query(collection(db, CASES_COLLECTION), orderBy("__name__"));
  return onSnapshot(
    q,
    (snap) => {
      allCases = [];
      snap.forEach((d) => {
        const data = d.data();
        // ensure id is present
        const id = d.id;
        allCases.push({ id, ...data });
      });
      // sort client-side by id for consistent display
      allCases.sort((a, b) => String(a.id).localeCompare(String(b.id)));
      buildPrimaryFilters(); // rebuild primary filter options from data
      applyFilters(); // re-apply and render
      refreshBadges();
    },
    (err) => {
      console.error("Realtime listener error:", err);
    }
  );
}

// ---------- RENDERING ----------
function renderTable(rows) {
  el.tbody.innerHTML = "";
  if (!rows || rows.length === 0) {
    el.tbody.innerHTML =
      '<tr><td colspan="10" style="text-align:center;">No cases found</td></tr>';
    return;
  }

  const tdy = todayDMY();

  rows.forEach((r, idx) => {
    const tr = document.createElement("tr");

    // highlight priority: due today > flagged > notes
    if ((r.followDate || "") === tdy) tr.classList.add("due-today");
    else if (r.flagged) tr.classList.add("flagged");
    else if (r.notes && r.notes.trim()) tr.classList.add("has-notes");

    tr.innerHTML = `
      <td class="sno">${idx + 1}</td>
      <td class="caseid">${escapeHtml(r.id)}</td>
      <td>${escapeHtml(r.customerName)}</td>
      <td>${escapeHtml(r.country)}</td>
      <td>${escapeHtml(r.caseResolutionCode)}</td>
      <td>${escapeHtml(r.caseOwner)}</td>
      <td>${escapeHtml(r.caGroup)}</td>
      <td>${escapeHtml(r.sbd)}</td>
      <td>${renderStatusSelect(r.id, r.status || "")}</td>
      <td class="right"><span class="gear" title="Case Options" data-action="opts" data-id="${r.id}">⚙️</span></td>
    `;
    el.tbody.appendChild(tr);
  });

  // Attach event listeners (delegation used for bigger lists)
  // status select change handled by change event on tbody (delegation below)
  // gear click handled by click event on tbody (delegation below)
}

// produce status <select>
function renderStatusSelect(id, val) {
  const opts = STATUS_OPTIONS.map(
    (o) => `<option ${o === val ? "selected" : ""}>${o}</option>`
  ).join("");
  return `<select class="status-select" data-action="status" data-id="${escapeHtml(
    id
  )}"><option value=""></option>${opts}</select>`;
}

// ---------- FILTERS UI ----------
function buildPrimaryFilters() {
  // Build options dynamically from data (unique values present)
  const fc = el.filtersContainer;
  fc.innerHTML = "";

  // compute unique values from allCases
  const unique = {};
  for (const spec of PRIMARY_SPECS) unique[spec.key] = new Set();
  allCases.forEach((c) => {
    for (const spec of PRIMARY_SPECS) {
      const v = c[spec.key];
      if (v != null && String(v).trim() !== "") unique[spec.key].add(String(v).trim());
    }
  });

  for (const spec of PRIMARY_SPECS) {
    const opts = Array.from(unique[spec.key]).sort();
    const isLocked = currentFilters.primaryLocks[spec.key];
    const optionsHtml = opts
      .map((opt) => {
        const checked = currentFilters.primaries[spec.key]?.includes(opt) ? "checked" : "";
        return `<label class="chip"><input type="checkbox" data-key="${spec.key}" value="${escapeHtml(
          opt
        )}" ${checked} /> ${escapeHtml(opt)}</label>`;
      })
      .join("");

    const blk = document.createElement("div");
    blk.className = "filter-block";
    if (isLocked) blk.classList.add("filter-locked");
    blk.dataset.key = spec.key;

    blk.innerHTML = `
      <div class="filter-head" data-action="toggle">
        <div class="filter-title">${spec.label}</div>
        <div class="flex">
          <span class="lock" data-action="lock" title="Lock/Unlock">${isLocked ? "🔒" : "🔓"}</span>
          <span>▾</span>
        </div>
      </div>
      <div class="filter-body"><div class="chips">${optionsHtml}</div></div>
    `;

    fc.appendChild(blk);
  }
}

// click handlers for filter container (toggle & lock)
el.filtersContainer.addEventListener("click", (e) => {
  const head = e.target.closest("[data-action]");
  const blk = e.target.closest(".filter-block");
  if (!blk) return;
  const key = blk.dataset.key;
  if (head && head.dataset.action === "toggle") {
    blk.querySelector(".filter-body").classList.toggle("open");
  } else if (head && head.dataset.action === "lock") {
    currentFilters.primaryLocks[key] = !currentFilters.primaryLocks[key];
    saveLocalFilters();
    buildPrimaryFilters();
  }
});

el.filtersContainer.addEventListener("change", (e) => {
  const cb = e.target.closest('input[type="checkbox"]');
  if (!cb) return;
  const key = cb.dataset.key;
  const val = cb.value;
  const set = new Set(currentFilters.primaries[key] || []);
  if (cb.checked) set.add(val);
  else set.delete(val);
  currentFilters.primaries[key] = Array.from(set);
  saveLocalFilters();
});

// ---------- APPLY FILTERS / RENDER ----------
function applyFilters() {
  // persist filters
  saveLocalFilters();

  const f = currentFilters;
  let rows = [...allCases];

  // Set1 filters
  if (f.search) {
    const q = f.search.toLowerCase();
    rows = rows.filter((r) =>
      [
        r.id,
        r.customerName,
        r.country,
        r.caseResolutionCode,
        r.caseOwner,
        r.caGroup,
        r.sbd,
        r.tl,
        r.onsiteRFC,
        r.csrRFC,
        r.benchRFC,
        r.notes,
      ].some((v) => String(v || "").toLowerCase().includes(q))
    );
  }
  if (f.status) rows = rows.filter((r) => (r.status || "") === f.status);
  if (f.from)
    rows = rows.filter((r) => {
      const c = r.createdOn || "";
      if (!c) return false;
      const d = dmyToDateObj(c);
      return d && d >= dmyToDateObj(f.from);
    });
  if (f.to)
    rows = rows.filter((r) => {
      const c = r.createdOn || "";
      if (!c) return false;
      const d = dmyToDateObj(c);
      return d && d <= dmyToDateObj(f.to);
    });

  // Primary filters: OR within each primary, AND across primaries
  for (const spec of PRIMARY_SPECS) {
    const sel = f.primaries[spec.key] || [];
    if (sel.length === 0) continue;
    rows = rows.filter((r) => sel.includes(String(r[spec.key] || "")));
  }

  // Modes
  const tdy = todayDMY();
  if (f.mode === "due") {
    rows = rows.filter((r) => (r.followDate || "") === tdy && r.status && r.status !== "Closed");
  } else if (f.mode === "flagged") {
    rows = rows.filter((r) => !!r.flagged);
  } else if (f.mode === "repeat") {
    const counts = new Map();
    rows.forEach((r) => counts.set(r.customerName, (counts.get(r.customerName) || 0) + 1));
    rows = rows.filter((r) => (counts.get(r.customerName) || 0) > 1);
  } else if (f.mode === "unupdated") {
    rows = rows.filter((r) => !r.status || r.status.trim() === "");
  }

  // Sort by creation date if requested
  if (f.sortByDateAsc !== null) {
    rows.sort((a, b) => {
      const da = a.createdOn || "";
      const db = b.createdOn || "";
      if (!da && !db) return 0;
      if (!da) return f.sortByDateAsc ? 1 : -1;
      if (!db) return f.sortByDateAsc ? -1 : 1;
      const dA = dmyToDateObj(da).getTime();
      const dB = dmyToDateObj(db).getTime();
      return f.sortByDateAsc ? dA - dB : dB - dA;
    });
  }

  renderTable(rows);
  refreshBadges();
}

function refreshBadges() {
  const all = allCases;
  const tdy = todayDMY();
  const due = all.filter((r) => (r.followDate || "") === tdy && r.status && r.status !== "Closed").length;
  const flagged = all.filter((r) => !!r.flagged).length;
  el.badgeDue.textContent = String(due);
  el.badgeFlag.textContent = String(flagged);
}

// ---------- LOCAL FILTERS persistence ----------
function saveLocalFilters() {
  try {
    localStorage.setItem(LS_FILTERS, JSON.stringify(currentFilters));
  } catch (e) {
    console.warn("Failed to save filters locally:", e);
  }
}
function loadLocalFilters() {
  try {
    const raw = localStorage.getItem(LS_FILTERS);
    if (raw) {
      const parsed = JSON.parse(raw);
      Object.assign(currentFilters, parsed);
    }
  } catch (e) {
    console.warn("Failed to load local filters:", e);
  }
}

// ---------- UI wiring for header / controls / modal ----------
function wireHeaderAndControls() {
  // Theme toggle (persist)
  const savedTheme = localStorage.getItem(LS_THEME) || "dark";
  document.documentElement.dataset.theme = savedTheme;
  el.btnTheme.textContent = savedTheme === "light" ? "🌙" : "☀️";

  el.btnTheme.addEventListener("click", () => {
    const next = document.documentElement.dataset.theme === "light" ? "dark" : "light";
    document.documentElement.dataset.theme = next;
    localStorage.setItem(LS_THEME, next);
    el.btnTheme.textContent = next === "light" ? "🌙" : "☀️";
  });

  // Sidebar toggles
  el.btnHamburger.addEventListener("click", () => {
    el.sidebar.classList.add("open");
    el.overlay.classList.add("show");
  });
  el.overlay.addEventListener("click", closeSidebar);
  el.btnSideClose.addEventListener("click", closeSidebar);
  el.btnSideApply.addEventListener("click", () => {
    applyFilters();
    closeSidebar();
  });
  function closeSidebar() {
    el.sidebar.classList.remove("open");
    el.overlay.classList.remove("show");
  }

  // Set1 controls
  el.btnApply.addEventListener("click", () => {
    currentFilters.search = el.txtSearch.value.trim();
    currentFilters.status = el.ddlStatusFilter.value;
    currentFilters.from = el.dateFrom.value ? formatISOToDMY(el.dateFrom.value) : "";
    currentFilters.to = el.dateTo.value ? formatISOToDMY(el.dateTo.value) : "";
    applyFilters();
  });
  el.btnClear.addEventListener("click", () => {
    currentFilters.search = "";
    currentFilters.status = "";
    currentFilters.from = "";
    currentFilters.to = "";
    currentFilters.mode = "normal";
    currentFilters.sortByDateAsc = null;
    for (const spec of PRIMARY_SPECS) {
      if (!currentFilters.primaryLocks[spec.key]) currentFilters.primaries[spec.key] = [];
    }
    // reset UI
    el.txtSearch.value = "";
    el.ddlStatusFilter.value = "";
    el.dateFrom.value = "";
    el.dateTo.value = "";
    buildPrimaryFilters();
    applyFilters();
  });

  // set2
  el.btnDueToday.addEventListener("click", () => {
    currentFilters.mode = "due";
    applyFilters();
  });
  el.btnFlagged.addEventListener("click", () => {
    currentFilters.mode = "flagged";
    applyFilters();
  });
  el.btnRepeating.addEventListener("click", () => {
    currentFilters.mode = "repeat";
    applyFilters();
  });
  el.btnUnupdated.addEventListener("click", () => {
    currentFilters.mode = "unupdated";
    applyFilters();
  });
  el.btnSortDate.addEventListener("click", () => {
    if (currentFilters.sortByDateAsc === null) currentFilters.sortByDateAsc = false;
    else currentFilters.sortByDateAsc = !currentFilters.sortByDateAsc;
    applyFilters();
  });

  // live quick handlers
  el.txtSearch.addEventListener("input", (e) => {
    currentFilters.search = e.target.value.trim();
  });
  el.txtSearch.addEventListener("keydown", (e) => {
    if (e.key === "Enter") applyFilters();
  });
  el.ddlStatusFilter.addEventListener("change", (e) => (currentFilters.status = e.target.value));

  // table events (delegation)
  el.tbody.addEventListener("change", async (e) => {
    const sel = e.target.closest('select[data-action="status"]');
    if (!sel) return;
    const id = sel.dataset.id;
    const val = sel.value;
    try {
      await updateDoc(doc(db, CASES_COLLECTION, id), {
        status: val,
        lastActionedOn: todayDMY(),
        updatedBy: currentUserEmail || "unknown",
      });
    } catch (err) {
      console.error("Error updating status:", err);
      alert("Update failed: " + err.message);
    }
  });

  el.tbody.addEventListener("click", (e) => {
    const gear = e.target.closest('[data-action="opts"]');
    if (!gear) return;
    openModalFor(gear.dataset.id);
  });

  // double click copy case id
  document.addEventListener("dblclick", (e) => {
    const cell = e.target.closest(".caseid");
    if (!cell) return;
    const text = cell.textContent.trim();
    navigator.clipboard.writeText(text).then(() => showToast("Copied!"));
  });

  // Modal handling
  el.btnModalClose.addEventListener("click", () => closeModal());
  el.modal.addEventListener("click", (e) => {
    if (e.target === el.modal) closeModal();
  });
  el.optFlag.addEventListener("click", () => {
    const on = el.optFlag.classList.toggle("on");
    el.optFlag.setAttribute("aria-checked", on ? "true" : "false");
  });

  el.btnModalSave.addEventListener("click", async () => {
    if (!el.modal.dataset.caseId) return;
    const id = el.modal.dataset.caseId;
    const updates = {
      followDate: el.optDate.value ? formatISOToDMY(el.optDate.value) : null,
      flagged: el.optFlag.classList.contains("on"),
      notes: (el.optNotes.value || "").trim(),
      lastActionedOn: todayDMY(),
      updatedBy: currentUserEmail || "unknown",
    };
    try {
      await updateDoc(doc(db, CASES_COLLECTION, id), updates);
      showToast("Saved");
      closeModal();
    } catch (err) {
      console.error("Error saving modal:", err);
      alert("Save failed: " + err.message);
    }
  });

  // File input wiring (upload handled separately)
  el.btnUpload.addEventListener("click", () => el.fileInput.click());
}

// open modal for a case
function openModalFor(id) {
  const c = allCases.find((x) => String(x.id) === String(id));
  if (!c) return;
  el.modal.dataset.caseId = id;
  el.modalTitle.textContent = `Case Options - ${id}`;
  el.optLastActioned.textContent = c.lastActionedOn ? c.lastActionedOn : "—";
  el.optDate.value = c.followDate ? formatDMYToISO(c.followDate) : "";
  el.optFlag.classList.toggle("on", !!c.flagged);
  el.optFlag.setAttribute("aria-checked", c.flagged ? "true" : "false");
  el.optNotes.value = c.notes || "";
  el.modal.classList.add("show");
}
function closeModal() {
  delete el.modal.dataset.caseId;
  el.modal.classList.remove("show");
}

// ---------- Excel import (admin-only) ----------
async function handleExcelUpload(e) {
  const file = e.target.files[0];
  if (!file) return;
  e.target.value = ""; // reset

  // check admin
  if (currentUserEmail !== ADMIN_EMAIL) {
    alert("Only admin can upload Excel files.");
    return;
  }

  const name = file.name.toLowerCase();
  try {
    if (name.endsWith(".xlsx") || name.endsWith(".xls")) {
      if (typeof window.XLSX === "undefined") {
        alert(
          "SheetJS library not available. Add xlsx.full.min.js to the page (index.html already includes it)."
        );
        return;
      }
      const buf = await file.arrayBuffer();
      // read workbook with SheetJS
      const wb = window.XLSX.read(buf, { type: "array" });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = window.XLSX.utils.sheet_to_json(ws, { defval: "" });
      await importRowsToFirestore(rows);
    } else if (name.endsWith(".csv")) {
      const text = await file.text();
      // simple csv parser to objects using header row
      const rows = csvToObjects(text);
      await importRowsToFirestore(rows);
    } else {
      alert("Unsupported file type. Use .xlsx or .csv");
    }
  } catch (err) {
    console.error("Error importing Excel:", err);
    alert("Error importing file: " + err.message);
  }
}

// CSV -> objects (uses header row)
function csvToObjects(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== "");
  if (lines.length < 2) return [];
  const headers = lines[0].split(",").map((h) => h.trim());
  return lines.slice(1).map((ln) => {
    const parts = ln.split(",");
    const obj = {};
    headers.forEach((h, i) => (obj[h] = parts[i] === undefined ? "" : parts[i]));
    return obj;
  });
}

// Map Excel row to Firestore case doc fields (based on your column list)
// expects rows as array of objects where keys are exactly header text in file
async function importRowsToFirestore(rows) {
  if (!Array.isArray(rows) || rows.length === 0) {
    alert("No rows to import.");
    return;
  }

  // We'll iterate and setDoc for each case ID with merge:true to preserve existing status/notes
  const processed = [];
  for (const r of rows) {
    // Column names taken from your earlier message:
    // Column A: Case ID
    // Column B: Full Name (Primary Contact) (Contact)
    // Column C: Created On
    // Column D: Created By
    // Column G: Country
    // Column I: Case Resolution Code
    // Column J: Full Name (Owning User) (User)
    // Column R: CA Group
    // Column U: TL
    // Column AD: SBD
    // Column AH: Onsite RFC Status
    // Column AI: CSR RFC Status
    // Column AJ: Bench RFC Status
    // Use safe access (header keys) - try common header forms if some have different whitespace
    const id = String(r["Case ID"] || r["CaseID"] || r["case id"] || r["caseid"] || "").trim();
    if (!id) continue;

    // createdOn: convert Excel serial or date-string to DD-MM-YYYY
    const createdOnRaw =
      r["Created On"] || r["CreatedOn"] || r["Created_Date"] || r["Created Date"] || "";
    const createdOn = excelSerialToDMY(createdOnRaw);

    const docData = {
      id,
      customerName:
        r["Full Name (Primary Contact) (Contact)"] ||
        r["Full Name (Primary Contact)"] ||
        r["Customer Name"] ||
        "",
      createdOn: createdOn || "",
      createdBy: r["Created By"] || r["CreatedBy"] || "",
      country: r["Country"] || r["country"] || "",
      caseResolutionCode:
        r["Case Resolution Code"] || r["Case Resolution"] || r["Case Resolution (Code)"] || "",
      caseOwner:
        r["Full Name (Owning User) (User)"] ||
        r["Full Name (Owning User)"] ||
        r["Case Owner"] ||
        "",
      caGroup: r["CA Group"] || r["CA_Group"] || r["CAGroup"] || "",
      tl: r["TL"] || r["tl"] || "",
      sbd: r["SBD"] || "",
      onsiteRFC: r["Onsite RFC Status"] || "",
      csrRFC: r["CSR RFC Status"] || "",
      benchRFC: r["Bench RFC Status"] || "",
      // preserved fields if already exist in firestore: status, followDate, flagged, notes, lastActionedOn, updatedBy
    };

    // merge into Firestore document with same id
    try {
      await setDoc(doc(db, CASES_COLLECTION, id), docData, { merge: true });
      processed.push(id);
    } catch (err) {
      console.error("Error writing case:", id, err);
      // continue to next
    }
  }

  // Optionally delete cases that no longer exist in Excel? (you asked earlier to remove closed)
  // We'll NOT auto-delete unless you explicitly want that — safer.
  alert(`Import complete — processed ${processed.length} rows.`);
}

// Helper: convert "DD-MM-YYYY" to "YYYY-MM-DD" for setting input[type=date] values
function formatDMYToISO(dmy) {
  if (!dmy) return "";
  const m = dmy.match(/^(\d{2})-(\d{2})-(\d{4})$/);
  if (!m) return dmy;
  return `${m[3]}-${m[2]}-${m[1]}`;
}
function formatISOToDMY(iso) {
  if (!iso) return "";
  // iso might be "YYYY-MM-DD"
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) {
    const [y, m, d] = iso.split("-");
    return `${d}-${m}-${y}`;
  }
  const dt = new Date(iso);
  if (!isNaN(dt)) return dateObjToDMY(dt);
  return iso;
}

// ---------- Export / Import backup (admin only) ----------
async function exportBackupToJson() {
  if (currentUserEmail !== ADMIN_EMAIL) return alert("Admin only.");

  try {
    // fetch latest from Firestore (we already have allCases from snapshot, but ensure)
    const snapshot = await getDocs(collection(db, CASES_COLLECTION));
    const out = [];
    snapshot.forEach((d) => {
      out.push({ id: d.id, ...d.data() });
    });

    const filters = JSON.parse(localStorage.getItem(LS_FILTERS) || "{}");
    const theme = localStorage.getItem(LS_THEME) || "dark";

    const payload = {
      exportedOn: new Date().toISOString(),
      version: 1,
      cases: out,
      filters,
      theme,
    };

    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    const stamp = new Date().toISOString().slice(0, 10);
    a.download = `KCI_FullBackup_${stamp}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
    alert("Export completed.");
  } catch (err) {
    console.error("Export failed:", err);
    alert("Export failed: " + err.message);
  }
}

async function importBackupFromJsonFile(file) {
  if (!file) return;
  if (currentUserEmail !== ADMIN_EMAIL) return alert("Admin only.");

  try {
    const text = await file.text();
    const parsed = JSON.parse(text);
    if (!parsed || !Array.isArray(parsed.cases)) {
      alert("Invalid backup file.");
      return;
    }

    const proceed = confirm(
      `This will overwrite/add ${parsed.cases.length} cases to Firestore. Continue?`
    );
    if (!proceed) return;

    // write each case doc (set overwrite)
    for (const c of parsed.cases) {
      const id = c.id || c.caseId || c.caseID;
      if (!id) continue;
      // ensure createdOn and followDate are DD-MM-YYYY formats
      if (c.createdOn) c.createdOn = excelSerialToDMY(c.createdOn) || c.createdOn;
      if (c.followDate) c.followDate = excelSerialToDMY(c.followDate) || c.followDate;
      await setDoc(doc(db, CASES_COLLECTION, id), c, { merge: true });
    }

    // optionally restore filters & theme locally
    if (parsed.filters) localStorage.setItem(LS_FILTERS, JSON.stringify(parsed.filters));
    if (parsed.theme) localStorage.setItem(LS_THEME, parsed.theme);

    alert("Import to Firestore completed.");
  } catch (err) {
    console.error("Import failed:", err);
    alert("Import failed: " + err.message);
  }
}

// ---------- init ----------
async function init() {
  // load local filters
  loadLocalFilters();

  // get admin email from settings doc if present
  try {
    const settingsRef = doc(db, SETTINGS_DOC[0], SETTINGS_DOC[1]);
    const snap = await getDocs(collection(db, SETTINGS_DOC[0])); // not used - safe fallback
    // Prefer reading doc directly via getDoc (but we used getDocs above just in case of rules)
    // We'll attempt a getDoc (but wrapped)
    try {
      // dynamic import of getDoc to avoid redeclaring imports elsewhere (we already imported getDocs above)
      const { getDoc } = await import("https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js");
      const s = await getDoc(settingsRef);
      if (s.exists()) {
        const data = s.data();
        ADMIN_EMAIL = data?.adminEmail || ADMIN_EMAIL;
      }
    } catch (readErr) {
      // ignore — we may lack permissions; admin fallback via settings doc in admin.html will still work
      console.warn("Could not fetch settings/access doc directly:", readErr);
    }
  } catch (err) {
    console.warn("Settings doc read attempt error:", err);
  }

  // Auth state: set current user + attach realtime
  auth.onAuthStateChanged(async (user) => {
    if (!user) {
      // no user — redirect to login page
      window.location.replace("login.html");
      return;
    }
    currentUserEmail = user.email;
    // if ADMIN_EMAIL still null, try to fetch again from Firestore with getDoc
    if (!ADMIN_EMAIL) {
      try {
        const { getDoc } = await import("https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js");
        const s = await getDoc(doc(db, "settings", "access"));
        if (s.exists()) ADMIN_EMAIL = s.data()?.adminEmail;
      } catch (err) {
        console.warn("Could not read admin settings:", err);
      }
    }

    // Show/hide admin-only buttons
    const isAdmin = currentUserEmail === ADMIN_EMAIL;
    ["btnUpload", "btnExport", "btnImport"].forEach((id) => {
      const elBtn = document.getElementById(id);
      if (!elBtn) return;
      elBtn.style.display = isAdmin ? "inline-block" : "none";
    });

    // attach handlers (only once)
    wireHeaderAndControls();

    // Attach file change handler
    el.fileInput.addEventListener("change", handleExcelUpload);
    el.importBackupInput.addEventListener("change", async (ev) => {
      const file = ev.target.files[0];
      if (file) await importBackupFromJsonFile(file);
      ev.target.value = "";
    });

    el.btnExport.addEventListener("click", exportBackupToJson);

    // Start real-time listener for cases
    attachRealtimeListener();

    // show app
    if (el.loading) el.loading.remove();
    if (el.appBody) el.appBody.style.display = "block";
  });
}

// ---------- small helpers ----------
function formatISOToDMY(iso) {
  // iso like YYYY-MM-DD or Date string
  if (!iso) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) {
    const [y, m, d] = iso.split("-");
    return `${d}-${m}-${y}`;
  }
  const dObj = new Date(iso);
  if (!isNaN(dObj)) return dateObjToDMY(dObj);
  return iso;
}

// ---------- run init ----------
init().catch((err) => {
  console.error("Init error:", err);
  // show page anyway for debugging
  if (el.loading) el.loading.remove();
  if (el.appBody) el.appBody.style.display = "block";
});
