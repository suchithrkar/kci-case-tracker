// script.js
// Firestore-backed Phase-1 tracker logic (ES module)
// Expects firebase-init.js to export `app` (initialized firebase app).
// Expects SheetJS loaded globally via <script src="https://cdn.../xlsx.full.min.js"></script>

import {
  getFirestore,
  collection,
  doc,
  onSnapshot,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  deleteDoc,
  writeBatch,
  query,
  orderBy
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js";

import { getAuth } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-auth.js";
import { app } from "./firebase-init.js";

const db = getFirestore(app);
const auth = getAuth(app);

// ------------------- Constants & DOM refs -------------------
const CASES_COLLECTION = "cases";
const SETTINGS_COLLECTION = "settings";
const SETTINGS_DOC = "access";

const el = {
  // header + upload
  btnHamburger: document.getElementById("btnHamburger"),
  btnTheme: document.getElementById("btnTheme"),
  btnUpload: document.getElementById("btnUpload"),
  fileInput: document.getElementById("fileInput"),
  btnExport: document.getElementById("btnExport"),
  btnImport: document.getElementById("btnImport"),
  importInput: document.getElementById("importBackupInput"),
  btnLogout: document.getElementById("btnLogout"),

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

  // table/modal
  tbody: document.getElementById("tbody"),
  modal: document.getElementById("modal"),
  modalTitle: document.getElementById("modalTitle"),
  optLastActioned: document.getElementById("optLastActioned"),
  optDate: document.getElementById("optDate"),
  optFlag: document.getElementById("optFlag"),
  optNotes: document.getElementById("optNotes"),
  btnModalSave: document.getElementById("btnModalSave"),
  btnModalClose: document.getElementById("btnModalClose"),

  toast: document.getElementById("toast"),
  appBody: document.getElementById("appBody"),
  loading: document.getElementById("loading")
};

// status options (same as original)
const STATUS_OPTIONS = ["Closed", "NCM 1", "NCM 2", "PNS", "Service Pending", "Monitoring"];

// Primary specs (same list you used earlier)
const PRIMARY_SPECS = [
  { key: "caseResolutionCode", label: "Case Resolution Code" },
  { key: "tl", label: "TL" },
  { key: "sbd", label: "SBD" },
  { key: "caGroup", label: "CA Group" },
  { key: "onsiteRFC", label: "Onsite RFC Status" },
  { key: "csrRFC", label: "CSR RFC Status" },
  { key: "benchRFC", label: "Bench RFC Status" },
  { key: "country", label: "Country" }
];

// local runtime state
let allCases = []; // array of case objects { id, ... }
let adminEmail = null;
let unsubscribeCases = null;
let currentUserEmail = null;
let modalCaseId = null;

// Per-user filter key in localStorage: include user email so filters are independent
function filtersStorageKeyForUser(email) {
  return `KCI_FILTERS_${email || "anon"}`;
}

// default filters
function defaultFilters() {
  return {
    search: "",
    status: "",
    from: "",
    to: "",
    primaries: PRIMARY_SPECS.reduce((acc, s) => { acc[s.key] = []; return acc; }, {}),
    primaryLocks: PRIMARY_SPECS.reduce((acc, s) => { acc[s.key] = false; return acc; }, {}),
    mode: "normal", // normal|due|flagged|repeat|unupdated
    sortByDateAsc: null
  };
}

// load saved filters for current user
function loadFiltersForUser(email) {
  const raw = localStorage.getItem(filtersStorageKeyForUser(email));
  if (!raw) return defaultFilters();
  try { return JSON.parse(raw); } catch { return defaultFilters(); }
}
function saveFiltersForUser(email, filters) {
  localStorage.setItem(filtersStorageKeyForUser(email), JSON.stringify(filters));
}

// ------------------- Helpers: Date formatting -------------------
// target format: DD-MM-YYYY
function toDDMMYYYYFromExcel(v) {
  // Excel numeric serial -> date:
  // Excel's serial 1 = 1900-01-01 (but JS uses 1970). We'll use the typical conversion used earlier.
  if (v == null || v === "") return "";
  if (typeof v === "number") {
    // handle Excel serial -> Date
    const epoch = Date.UTC(1899, 11, 30); // Excel epoch
    const ms = Math.round(v * 86400 * 1000);
    const d = new Date(epoch + ms);
    return formatDDMMYYYY(d);
  }
  // string:
  const s = String(v).trim();
  // If ISO-like already or "30-09-2025 20:26:45"
  const isoCandidate = s.replace(/\s+/g, " ");
  // detect dd-mm-yyyy or dd/mm/yyyy
  const m = isoCandidate.match(/^(\d{2})[\/\-](\d{2})[\/\-](\d{4})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  // try Date parse
  const d2 = new Date(isoCandidate);
  if (!isNaN(d2)) return formatDDMMYYYY(d2);
  return s;
}
function formatDDMMYYYY(dateObj) {
  const d = dateObj.getDate().toString().padStart(2, "0");
  const m = (dateObj.getMonth() + 1).toString().padStart(2, "0");
  const y = dateObj.getFullYear();
  return `${d}-${m}-${y}`;
}
function isoFromDDMMYYYY(ddmmyyyy) {
  if (!ddmmyyyy) return null;
  const m = ddmmyyyy.match(/^(\d{2})-(\d{2})-(\d{4})$/);
  if (!m) return null;
  const [_, dd, mm, yyyy] = m;
  return `${yyyy}-${mm}-${dd}`; // ISO date-like string for comparisons (YYYY-MM-DD)
}
function todayDDMMYYYY() {
  return formatDDMMYYYY(new Date());
}

// ------------------- UI helpers -------------------
function showToast(msg = "Saved") {
  if (!el.toast) return;
  el.toast.textContent = msg;
  el.toast.classList.add("show");
  setTimeout(() => el.toast.classList.remove("show"), 1200);
}

function escapeHtml(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c]));
}

// ------------------- Render / Filters -------------------
let filters = defaultFilters();

function buildPrimaryFiltersUI() {
  if (!el.filtersContainer) return;
  el.filtersContainer.innerHTML = "";
  PRIMARY_SPECS.forEach(spec => {
    const block = document.createElement("div");
    block.className = "filter-block";
    block.dataset.key = spec.key;

    const locked = filters.primaryLocks[spec.key];

    const head = document.createElement("div");
    head.className = "filter-head";
    head.innerHTML = `<div class="filter-title">${spec.label}</div>
      <div class="flex"><span class="lock" data-action="lock">${locked ? "🔒" : "🔓"}</span><span>▾</span></div>`;
    head.dataset.action = "toggle";

    const body = document.createElement("div");
    body.className = "filter-body";
    if (locked) block.classList.add("filter-locked");

    // create dynamic options from actual data present in allCases (so filters reflect data)
    const values = Array.from(new Set(allCases.map(c => String(c[spec.key] || "").trim()).filter(v => v))).sort();
    const chips = document.createElement("div");
    chips.className = "chips";
    if (values.length === 0) chips.innerHTML = `<div style="font-size:13px;color:var(--muted);padding:.5rem">No values</div>`;
    else {
      values.forEach(v => {
        const checked = filters.primaries[spec.key]?.includes(v);
        const lab = document.createElement("label");
        lab.className = "chip";
        lab.innerHTML = `<input type="checkbox" data-key="${spec.key}" value="${escapeHtml(v)}" ${checked ? "checked" : ""}/> ${escapeHtml(v)}`;
        chips.appendChild(lab);
      });
    }
    body.appendChild(chips);

    block.appendChild(head);
    block.appendChild(body);
    el.filtersContainer.appendChild(block);
  });
}

// event delegation for filters UI
if (el.filtersContainer) {
  el.filtersContainer.addEventListener("click", (ev) => {
    const lock = ev.target.closest("[data-action='lock']");
    const blk = ev.target.closest(".filter-block");
    if (!blk) return;
    const key = blk.dataset.key;
    if (lock) {
      filters.primaryLocks[key] = !filters.primaryLocks[key];
      buildPrimaryFiltersUI();
      saveFiltersForUser(currentUserEmail, filters);
      return;
    }
    const head = ev.target.closest("[data-action='toggle']");
    if (head) {
      const body = blk.querySelector(".filter-body");
      if (body) body.classList.toggle("open");
    }
  });

  el.filtersContainer.addEventListener("change", (ev) => {
    const cb = ev.target.closest("input[type='checkbox']");
    if (!cb) return;
    const key = cb.dataset.key;
    const val = cb.value;
    const set = new Set(filters.primaries[key] || []);
    if (cb.checked) set.add(val); else set.delete(val);
    filters.primaries[key] = Array.from(set);
    saveFiltersForUser(currentUserEmail, filters);
  });
}

// filter application
function applyFiltersAndRender() {
  // apply filters to allCases
  let rows = [...allCases];
  const f = filters;

  if (f.search) {
    const q = f.search.toLowerCase();
    rows = rows.filter(r => {
      return Object.values({
        id: r.id,
        customerName: r.customerName,
        country: r.country,
        caseResolutionCode: r.caseResolutionCode,
        caseOwner: r.caseOwner,
        caGroup: r.caGroup,
        sbd: r.sbd,
        tl: r.tl,
        onsiteRFC: r.onsiteRFC,
        csrRFC: r.csrRFC,
        benchRFC: r.benchRFC,
        notes: r.notes
      }).some(v => String(v || "").toLowerCase().includes(q));
    });
  }
  if (f.status) rows = rows.filter(r => (r.status || "") === f.status);
  if (f.from) rows = rows.filter(r => {
    if (!r.createdOn) return false;
    const iso = isoFromDDMMYYYY(r.createdOn); if (!iso) return false;
    return iso >= f.from;
  });
  if (f.to) rows = rows.filter(r => {
    if (!r.createdOn) return false;
    const iso = isoFromDDMMYYYY(r.createdOn); if (!iso) return false;
    return iso <= f.to;
  });

  // primary filters OR within each key
  const applyPrimary = (arr, key) => {
    const sel = (f.primaries[key] || []);
    if (!sel.length) return arr;
    return arr.filter(r => sel.includes(String(r[key] || "")));
  };
  for (const spec of PRIMARY_SPECS) rows = applyPrimary(rows, spec.key);

  // modes
  if (f.mode === "due") {
    const todayISO = isoFromDDMMYYYY(toDDMMYYYYFromISODate(new Date()));
    rows = rows.filter(r => (r.followDate || "") === todayDDMMYYYY() && r.status && r.status !== "Closed");
  } else if (f.mode === "flagged") {
    rows = rows.filter(r => !!r.flagged);
  } else if (f.mode === "repeat") {
    const counts = new Map();
    rows.forEach(r => counts.set(r.customerName, (counts.get(r.customerName) || 0) + 1));
    rows = rows.filter(r => (counts.get(r.customerName) || 0) > 1).sort((a, b) => (a.customerName || "").localeCompare(b.customerName || ""));
  } else if (f.mode === "unupdated") {
    rows = rows.filter(r => !r.status || r.status.trim() === "");
  }

  // sort by date
  if (f.sortByDateAsc !== null) {
    rows.sort((a, b) => {
      const da = isoFromDDMMYYYY(a.createdOn) || "";
      const db = isoFromDDMMYYYY(b.createdOn) || "";
      if (da === db) return 0;
      return f.sortByDateAsc ? (da < db ? -1 : 1) : (da > db ? -1 : 1);
    });
  }

  renderTable(rows);
  refreshBadges();
  saveFiltersForUser(currentUserEmail, filters);
}

function toDDMMYYYYFromISODateString(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d)) return "";
  return formatDDMMYYYY(d);
}
function toDDMMYYYYFromISODate(dateObj) {
  return formatDDMMYYYY(dateObj);
}
function toDDMMYYYYFromISODate_local(isoStr) {
  if (!isoStr) return "";
  const d = new Date(isoStr);
  if (isNaN(d)) return "";
  return formatDDMMYYYY(d);
}
function toDDMMYYYYFromISODateWrapper(iso) { return toDDMMYYYYFromISODateString(iso); }

// render table
function renderTable(rows) {
  const tb = el.tbody;
  if (!tb) return;
  tb.innerHTML = "";
  if (!rows || rows.length === 0) {
    tb.innerHTML = `<tr><td colspan="10" style="text-align:center;">No cases found</td></tr>`;
    return;
  }

  rows.forEach((r, idx) => {
    const tr = document.createElement("tr");

    // highlight priority: due today > flagged > notes
    if ((r.followDate || "") === todayDDMMYYYY()) tr.classList.add("due-today");
    else if (r.flagged) tr.classList.add("flagged");
    else if (r.notes && r.notes.trim()) tr.classList.add("has-notes");

    const createdOn = r.createdOn || "";
    tr.innerHTML = `
      <td class="sno">${idx + 1}</td>
      <td class="caseid" data-id="${escapeHtml(r.id)}">${escapeHtml(r.id)}</td>
      <td>${escapeHtml(r.customerName)}</td>
      <td>${escapeHtml(r.country)}</td>
      <td>${escapeHtml(r.caseResolutionCode)}</td>
      <td>${escapeHtml(r.caseOwner)}</td>
      <td>${escapeHtml(r.caGroup)}</td>
      <td>${escapeHtml(r.sbd)}</td>
      <td>
        <select class="status-select" data-id="${escapeHtml(r.id)}">
          <option value=""></option>
          ${STATUS_OPTIONS.map(o => `<option ${r.status === o ? "selected" : ""}>${o}</option>`).join("")}
        </select>
      </td>
      <td class="right">
        <button class="gear-btn" data-id="${escapeHtml(r.id)}" title="Case Options">⚙️</button>
      </td>
    `;
    tb.appendChild(tr);
  });

  // attach listeners to selects and gear buttons (delegation below handles, but reattach for direct controls)
}

// ------------------- Row events (delegation) -------------------
document.addEventListener("click", async (ev) => {
  const gear = ev.target.closest(".gear-btn");
  if (gear) {
    const id = gear.dataset.id;
    openCaseModal(id);
  }
});

el.tbody.addEventListener("change", async (ev) => {
  const sel = ev.target.closest(".status-select");
  if (!sel) return;
  const id = sel.dataset.id;
  const newStatus = sel.value;
  try {
    await updateDoc(doc(db, CASES_COLLECTION, id), {
      status: newStatus,
      lastActionedOn: new Date().toISOString().split("T")[0],
      updatedBy: currentUserEmail || "unknown"
    });
    showToast("Status saved");
  } catch (err) {
    console.error("Error updating status:", err);
    alert("Failed to update status: " + err.message);
  }
});

// double-click to copy case id
document.addEventListener("dblclick", (e) => {
  const cell = e.target.closest(".caseid");
  if (!cell) return;
  const text = cell.textContent.trim();
  navigator.clipboard.writeText(text).then(() => showToast("Copied!"));
});

// ------------------- Modal (Case Options) -------------------
function openCaseModal(caseId) {
  modalCaseId = caseId;
  const c = allCases.find(x => x.id === caseId);
  if (!c) return;
  el.modalTitle.textContent = `Case Options - ${caseId}`;
  el.optLastActioned.textContent = c.lastActionedOn ? c.lastActionedOn : "—";
  // followDate stored as DD-MM-YYYY -> convert to yyyy-mm-dd for <input type=date>
  el.optDate.value = c.followDate ? isoFromDDMMYYYY(c.followDate) : "";
  el.optFlag.setAttribute("aria-checked", c.flagged ? "true" : "false");
  if (c.flagged) el.optFlag.classList.add("on"); else el.optFlag.classList.remove("on");
  el.optNotes.value = c.notes || "";
  el.modal.classList.add("show");
}

el.optFlag.addEventListener("click", () => {
  const on = !el.optFlag.classList.contains("on");
  el.optFlag.classList.toggle("on", on);
  el.optFlag.setAttribute("aria-checked", on ? "true" : "false");
});

el.btnModalClose.addEventListener("click", () => {
  el.modal.classList.remove("show");
  modalCaseId = null;
});

el.modal.addEventListener("click", (ev) => {
  if (ev.target === el.modal) {
    el.modal.classList.remove("show");
    modalCaseId = null;
  }
});

el.btnModalSave.addEventListener("click", async () => {
  if (!modalCaseId) return;
  const followDateIso = el.optDate.value ? el.optDate.value : "";
  const followDateDD = followDateIso ? (() => {
    // followDateIso is yyyy-mm-dd -> convert to DD-MM-YYYY
    const [y, m, d] = followDateIso.split("-");
    return `${d}-${m}-${y}`;
  })() : null;

  const flagged = el.optFlag.classList.contains("on");
  const notes = el.optNotes.value.trim();

  try {
    await updateDoc(doc(db, CASES_COLLECTION, modalCaseId), {
      followDate: followDateDD,
      flagged: flagged,
      notes: notes,
      lastActionedOn: new Date().toISOString().split("T")[0],
      updatedBy: currentUserEmail || "unknown"
    });
    el.modal.classList.remove("show");
    modalCaseId = null;
    showToast("Saved");
  } catch (err) {
    console.error("Error saving modal data:", err);
    alert("Failed to save: " + err.message);
  }
});

// ------------------- Firestore sync -------------------
async function loadAdminEmail() {
  try {
    const snap = await getDoc(doc(db, SETTINGS_COLLECTION, SETTINGS_DOC));
    if (snap.exists()) adminEmail = snap.data().adminEmail || null;
    console.log("Admin email loaded:", adminEmail);
  } catch (err) {
    console.error("Error reading admin email:", err);
  }
}

function subscribeToCasesRealtime() {
  // unsubscribe previous if any
  if (unsubscribeCases) unsubscribeCases();

  const colRef = collection(db, CASES_COLLECTION);
  // keep ordering stable by id or createdOn - not required but helpful
  const q = query(colRef, orderBy("id"));
  unsubscribeCases = onSnapshot(q, (snapshot) => {
    const arr = [];
    snapshot.forEach(d => {
      const data = d.data();
      arr.push({
        id: d.id,
        ...data
      });
    });
    allCases = arr;
    // rebuild UI parts that rely on allCases
    buildPrimaryFiltersUI();
    applyFiltersAndRender();
  }, (err) => {
    console.error("Cases snapshot error:", err);
  });
}

// ------------------- Excel upload (admin only) -------------------
if (el.btnUpload && el.fileInput) {
  el.btnUpload.addEventListener("click", () => {
    // admin check done elsewhere, but double-check:
    if (!currentUserEmail) return alert("Not signed in");
    if (currentUserEmail !== adminEmail) return alert("Only admin can upload Excel.");
    el.fileInput.click();
  });

  el.fileInput.addEventListener("change", async (ev) => {
    const f = ev.target.files[0];
    if (!f) return;
    try {
      if (f.name.toLowerCase().endsWith(".xlsx") || f.name.toLowerCase().endsWith(".xls")) {
        if (typeof window.XLSX === "undefined") {
          alert("SheetJS not found. Make sure xlsx.full.min.js is loaded in the page.");
          return;
        }
        const buf = await f.arrayBuffer();
        const wb = window.XLSX.read(buf, { type: "array" });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const rows = window.XLSX.utils.sheet_to_json(ws, { header: 1, raw: true });
        await importExcelGrid(rows);
      } else if (f.name.toLowerCase().endsWith(".csv")) {
        const text = await f.text();
        const rows = text.split(/\r?\n/).map(r => r.split(","));
        await importExcelGrid(rows);
      } else {
        alert("Unsupported file type. Please upload .xlsx or .csv");
      }
    } catch (err) {
      console.error("Error importing Excel:", err);
      alert("Error importing Excel: " + (err.message || err));
    } finally {
      ev.target.value = "";
    }
  });
}

async function importExcelGrid(grid) {
  // grid: array of rows arrays. row0 = headers exactly as user specified.
  if (!Array.isArray(grid) || grid.length < 2) {
    alert("Empty or invalid file.");
    return;
  }

  // mapping per user's column description earlier:
  // Column A -> index 0: Case ID
  // B -> 1: Full Name (Primary Contact) (Contact)
  // C -> 2: Created On
  // D -> 3: Created By
  // G -> 6: Country
  // I -> 8: Case Resolution Code
  // J -> 9: Full Name (Owning User) (User)
  // R -> 17: CA Group
  // U -> 20: TL
  // AD -> 29: SBD
  // AH -> 33: Onsite RFC Status
  // AI -> 34: CSR RFC Status
  // AJ -> 35: Bench RFC Status

  const hdr = grid[0].map(h => String(h || "").trim());
  const rows = [];
  for (let r = 1; r < grid.length; r++) {
    const row = grid[r];
    if (!row || row.length === 0) continue;
    const id = String(row[0] || "").trim();
    if (!id) continue;
    const rec = {
      id,
      customerName: String(row[1] || "").trim(),
      createdOn: toDDMMYYYYFromExcel(row[2]),
      createdBy: String(row[3] || "").trim(),
      country: String(row[6] || "").trim(),
      caseResolutionCode: String(row[8] || "").trim(),
      caseOwner: String(row[9] || "").trim(),
      caGroup: String(row[17] || "").trim(),
      tl: String(row[20] || "").trim(),
      sbd: String(row[29] || "").trim(),
      onsiteRFC: String(row[33] || "").trim(),
      csrRFC: String(row[34] || "").trim(),
      benchRFC: String(row[35] || "").trim(),
      status: "",
      followDate: null,
      flagged: false,
      notes: "",
      lastActionedOn: null,
      updatedBy: ""
    };
    rows.push(rec);
  }

  if (!rows.length) {
    alert("No valid rows found.");
    return;
  }

  // Write to Firestore: we'll upsert each doc, and delete any old documents not present in uploaded sheet.
  try {
    // fetch existing case IDs
    const snap = await getDocs(collection(db, CASES_COLLECTION));
    const existingIds = new Set();
    snap.forEach(s => existingIds.add(s.id));

    // batch writes (be mindful of limits — if thousands of rows you'll need chunking)
    // We'll do simple loop setDoc with merge: true so any existing status, followDate etc are preserved if present.
    for (const rec of rows) {
      const docRef = doc(db, CASES_COLLECTION, rec.id);
      // preserve existing status/followDate/flagged/notes if present in existing doc
      // use setDoc(..., { merge: true })
      await setDoc(docRef, rec, { merge: true });
      existingIds.delete(rec.id);
    }

    // delete any remaining old ids not in the new excel
    let deletedCount = 0;
    for (const oldId of existingIds) {
      await deleteDoc(doc(db, CASES_COLLECTION, oldId));
      deletedCount++;
    }

    alert(`Import complete. ${rows.length} processed. ${deletedCount} removed.`);
    // realtime snapshot will refresh UI
  } catch (err) {
    console.error("Error writing cases:", err);
    alert("Error saving to Firestore: " + err.message);
  }
}

// ------------------- Backup / Restore (JSON) -------------------
if (el.btnExport) {
  el.btnExport.addEventListener("click", async () => {
    if (!currentUserEmail) return alert("Not signed in");
    if (currentUserEmail !== adminEmail) return alert("Only admin can export backup.");
    try {
      const snap = await getDocs(collection(db, CASES_COLLECTION));
      const arr = [];
      snap.forEach(d => arr.push({ id: d.id, ...d.data() }));
      const meta = { exportedOn: new Date().toISOString(), count: arr.length };
      const full = { meta, cases: arr };
      const blob = new Blob([JSON.stringify(full, null, 2)], { type: "application/json" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `kci_cases_backup_${new Date().toISOString().slice(0,10)}.json`;
      a.click();
      URL.revokeObjectURL(a.href);
      showToast("Backup exported");
    } catch (err) {
      console.error("Export failed:", err);
      alert("Export failed: " + err.message);
    }
  });
}

if (el.btnImport && el.importInput) {
  el.btnImport.addEventListener("click", () => {
    if (!currentUserEmail) return alert("Not signed in");
    if (currentUserEmail !== adminEmail) return alert("Only admin can import backup.");
    el.importInput.click();
  });

  el.importInput.addEventListener("change", async (ev) => {
    const f = ev.target.files[0]; if (!f) return;
    try {
      const txt = await f.text();
      const parsed = JSON.parse(txt);
      if (!parsed || !Array.isArray(parsed.cases)) {
        alert("Invalid backup file");
        return;
      }
      // confirm
      if (!confirm(`This will overwrite current cases in Firestore. Continue?`)) return;

      // Write: best to delete all existing then batch set new docs.
      // Read existing
      const existingSnap = await getDocs(collection(db, CASES_COLLECTION));
      // delete each (could optimize with batch)
      for (const s of existingSnap.docs) {
        await deleteDoc(doc(db, CASES_COLLECTION, s.id));
      }
      // set new
      for (const c of parsed.cases) {
        const id = c.id || c.caseId || c.caseID;
        if (!id) continue;
        // remove id from body
        const body = { ...c }; delete body.id;
        await setDoc(doc(db, CASES_COLLECTION, id), body, { merge: true });
      }
      alert("Import complete.");
    } catch (err) {
      console.error("Import failed:", err);
      alert("Import failed: " + err.message);
    } finally {
      ev.target.value = "";
    }
  });
}

// ------------------- UI controls: filters, sidebar, theme, export etc -------------------
if (el.btnHamburger) el.btnHamburger.addEventListener("click", () => { el.sidebar.classList.add("open"); el.overlay.classList.add("show"); });
if (el.overlay) el.overlay.addEventListener("click", () => { el.sidebar.classList.remove("open"); el.overlay.classList.remove("show"); });
if (el.btnSideClose) el.btnSideClose.addEventListener("click", () => { el.sidebar.classList.remove("open"); el.overlay.classList.remove("show"); });
if (el.btnSideApply) el.btnSideApply.addEventListener("click", () => { el.sidebar.classList.remove("open"); el.overlay.classList.remove("show"); applyFiltersAndRender(); });

if (el.btnTheme) {
  el.btnTheme.addEventListener("click", () => {
    const next = (document.documentElement.dataset.theme === "light") ? "dark" : "light";
    document.documentElement.dataset.theme = next;
    el.btnTheme.textContent = next === "light" ? "🌙" : "☀️";
    localStorage.setItem("KCI_THEME_V1", next);
  });
}

// set filter control events
if (el.txtSearch) {
  el.txtSearch.addEventListener("input", (e) => { filters.search = e.target.value.trim(); });
  el.txtSearch.addEventListener("keydown", (e) => { if (e.key === "Enter") { applyFiltersAndRender(); } });
}
if (el.ddlStatusFilter) el.ddlStatusFilter.addEventListener("change", (e) => { filters.status = e.target.value; });
if (el.dateFrom) el.dateFrom.addEventListener("change", (e) => { filters.from = e.target.value; });
if (el.dateTo) el.dateTo.addEventListener("change", (e) => { filters.to = e.target.value; });

if (el.btnApply) el.btnApply.addEventListener("click", applyFiltersAndRender);
if (el.btnClear) el.btnClear.addEventListener("click", () => {
  filters = defaultFilters();
  // restore UI
  el.txtSearch.value = "";
  el.ddlStatusFilter.value = "";
  el.dateFrom.value = "";
  el.dateTo.value = "";
  buildPrimaryFiltersUI();
  applyFiltersAndRender();
});

if (el.btnDueToday) el.btnDueToday.addEventListener("click", () => { filters.mode = "due"; applyFiltersAndRender(); });
if (el.btnFlagged) el.btnFlagged.addEventListener("click", () => { filters.mode = "flagged"; applyFiltersAndRender(); });
if (el.btnRepeating) el.btnRepeating.addEventListener("click", () => { filters.mode = "repeat"; applyFiltersAndRender(); });
if (el.btnSortDate) el.btnSortDate.addEventListener("click", () => {
  if (filters.sortByDateAsc === null) filters.sortByDateAsc = false;
  else filters.sortByDateAsc = !filters.sortByDateAsc;
  applyFiltersAndRender();
});
if (el.btnUnupdated) el.btnUnupdated.addEventListener("click", () => { filters.mode = "unupdated"; applyFiltersAndRender(); });

// ------------------- Badges -------------------
function refreshBadges() {
  const all = allCases;
  const due = all.filter(r => (r.followDate || "") === todayDDMMYYYY() && r.status && r.status !== "Closed").length;
  const flagged = all.filter(r => !!r.flagged).length;
  if (el.badgeDue) el.badgeDue.textContent = String(due);
  if (el.badgeFlag) el.badgeFlag.textContent = String(flagged);
}

// ------------------- Auth state handling & init -------------------
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-auth.js";

onAuthStateChanged(auth, async (user) => {
  try {
    if (!user) {
      // no user -> redirect to login
      console.log("No user -> redirecting to login");
      // If you want to redirect: window.location.replace("login.html");
      // But we just hide UI to avoid flash:
      if (el.loading) el.loading.style.display = "flex";
      if (el.appBody) el.appBody.style.display = "none";
      // stop subscription
      if (unsubscribeCases) { unsubscribeCases(); unsubscribeCases = null; }
      currentUserEmail = null;
      return;
    }

    currentUserEmail = user.email;
    // load admin email
    await loadAdminEmail();

    // load per-user filters
    filters = loadFiltersForUser(currentUserEmail);

    // show UI
    if (el.loading) el.loading.remove();
    if (el.appBody) el.appBody.style.display = "block";

    // mount admin button if admin
    if (currentUserEmail === adminEmail) {
      // add Admin Dashboard button if not present
      const header = document.querySelector(".header");
      if (header && !document.getElementById("adminNavBtn")) {
        const adminBtn = document.createElement("button");
        adminBtn.id = "adminNavBtn";
        adminBtn.className = "upload-btn";
        adminBtn.textContent = "Admin Dashboard";
        adminBtn.addEventListener("click", () => window.location.href = "admin.html");
        // insert before theme toggle
        const themeBtn = document.getElementById("btnTheme");
        header.insertBefore(adminBtn, themeBtn);
      }
    }

    // hide admin-only controls for non-admin
    if (currentUserEmail !== adminEmail) {
      [el.btnUpload, el.btnExport, el.btnImport].forEach(b => {
        if (!b) return;
        b.style.display = "none";
      });
    } else {
      // admin: ensure controls visible
      [el.btnUpload, el.btnExport, el.btnImport].forEach(b => { if (b) b.style.display = ""; });
    }

    // hook logout
    if (el.btnLogout) {
      el.btnLogout.addEventListener("click", async () => {
        await signOut(auth);
        localStorage.clear(); // optionally keep theme? We'll clear for now
        window.location.replace("login.html");
      });
    }

    // Subscribe to cases
    subscribeToCasesRealtime();

    // initial UI build
    buildPrimaryFiltersUI();

    // populate filters UI input values
    if (el.txtSearch) el.txtSearch.value = filters.search || "";
    if (el.ddlStatusFilter) el.ddlStatusFilter.value = filters.status || "";
    if (el.dateFrom) el.dateFrom.value = filters.from || "";
    if (el.dateTo) el.dateTo.value = filters.to || "";

    applyFiltersAndRender();

  } catch (err) {
    console.error("Auth state handler error:", err);
    if (el.loading) el.loading.style.display = "none";
    if (el.appBody) el.appBody.style.display = "block";
  }
});

// ------------------- Utilities -------------------
function toDDMMYYYYFromISODate_localWrapper(dateObj) {
  return formatDDMMYYYY(dateObj);
}

// small helper used above
function toDDMMYYYYFromISODateString_local(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  return isNaN(d) ? "" : formatDDMMYYYY(d);
}

// helper to produce ISO y-m-d from Date
function isoFromDDMMYYYY_local(ddmmyyyy) {
  if (!ddmmyyyy) return "";
  const parts = ddmmyyyy.split("-");
  if (parts.length !== 3) return "";
  return `${parts[2]}-${parts[1]}-${parts[0]}`;
}

// tiny wrapper function naming collision safe
function toDDMMYYYYFromISODateWrapper(isoStr) {
  if (!isoStr) return "";
  const d = new Date(isoStr);
  if (isNaN(d)) return "";
  return `${String(d.getDate()).padStart(2,"0")}-${String(d.getMonth()+1).padStart(2,"0")}-${d.getFullYear()}`;
}

// ------------------- End of script -------------------
console.log("Tracker script loaded.");
