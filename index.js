// ===============================
// INDEX.JS — FIRESTORE TRACKER (PART 1)
// ===============================

// ===============================
// FIXED FIREBASE IMPORTS FOR TRACKER
// ===============================
import {
  auth,
  onAuthStateChanged,
  db,
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  where,
  onSnapshot,
  updateDoc,
  setDoc,
  deleteDoc
} from "./js/firebase.js";

// ===============================
// OTHER IMPORTS
// ===============================
import {
  getUserProfile,
  isPrimary,
  isSecondary,
  isGeneral,
  getCurrentTrackerTeam,
  toggleTheme
} from "./js/userProfile.js";

import { showPopup } from "./js/utils.js";
import { listenToTeamCases, updateCase } from "./js/firestore-api.js";


import {
  listenToTeamCases,
  updateCase
} from "./js/firestore-api.js";

import {
  initUserProfile,
  isPrimary,
  isSecondary,
  isGeneral,
  getCurrentTrackerTeam,
  toggleTheme
} from "./js/userProfile.js";

import { showPopup } from "./js/utils.js";

// DOM refs reused from HTML (Section 1)
const el = {
  userFullName: document.getElementById("userFullName"),
  btnTheme: document.getElementById("btnTheme"),
  btnAdmin: document.getElementById("btnAdmin"),
  btnLogout: document.getElementById("btnLogout"),
};

// Global in-memory tracker state
export const trackerState = {
  user: null,
  teamId: null,
  allCases: [],        // Firestore raw cases
  filteredCases: [],   // after applyFilters()
};

// ============================================================================
// AUTH STATE
// ============================================================================
onAuthStateChanged(auth, async (user) => {
  if (!user) {
    // Not logged in → redirect to login
    location.href = "login.html";
    return;
  }

  const userDocRef = doc(db, "users", user.uid);
  const userSnap = await getDoc(userDocRef);

  if (!userSnap.exists()) {
    location.href = "login.html";
    return;
  }

  const data = userSnap.data();

  // Must be approved
  if (data.status !== "approved") {
    alert("Account pending approval.");
    auth.signOut();
    location.href = "login.html";
    return;
  }

  // Store user in global state
  trackerState.user = { uid: user.uid, ...data };

  // Display full name
  el.userFullName.textContent = `${data.firstName} ${data.lastName}`;

  // Theme initial sync
  document.documentElement.dataset.theme = data.theme || "dark";
  el.btnTheme.textContent = (data.theme === "light") ? "🌙" : "☀️";

  // Theme toggle handler
  el.btnTheme.onclick = () => toggleTheme(trackerState.user);

  // Role-based Admin button visibility
  if (isPrimary(data) || isSecondary(data)) {
    el.btnAdmin.style.display = "inline-block";
  } else {
    el.btnAdmin.style.display = "none";
  }

  el.btnAdmin.onclick = () => location.href = "admin.html";

  // Logout
  el.btnLogout.onclick = () => auth.signOut().then(() => {
    location.href = "login.html";
  });

  // ---------------------------------------------------------
  // DETERMINE WHICH TEAM'S CASES TO LOAD
  // ---------------------------------------------------------
  const teamId = getCurrentTrackerTeam(trackerState.user);
  trackerState.teamId = teamId;

  // Start Firestore real-time sync
  setupRealtimeCases(teamId);
});

// ============================================================================
// REAL-TIME CASE LISTENING
// ============================================================================
function setupRealtimeCases(teamId) {
  listenToTeamCases(teamId, (cases) => {

    // Map Firestore docs exactly into your tracker shape
    trackerState.allCases = cases.map(c => ({
      id: c.id,
      customerName: c.customerName || "",
      createdOn: c.createdOn || "",
      createdBy: c.createdBy || "",
      country: c.country || "",
      caseResolutionCode: c.caseResolutionCode || "",
      caseOwner: c.caseOwner || "",
      caGroup: c.caGroup || "",
      tl: c.tl || "",
      sbd: c.sbd || "",
      onsiteRFC: c.onsiteRFC || "",
      csrRFC: c.csrRFC || "",
      benchRFC: c.benchRFC || "",
      status: c.status || "",
      followDate: c.followDate || null,
      flagged: !!c.flagged,
      notes: c.notes || "",
      lastActionedOn: c.lastActionedOn || "",
      lastActionedBy: c.lastActionedBy || ""
    }));

    // After updating allCases, run filters to refresh table
    applyFilters();
  });
}

// ===============================
// SECTION 2A — APPLY FILTERS (FULL ENGINE)
// ===============================

// References to UI elements (same IDs from your HTML)
const txtSearch   = document.getElementById("txtSearch");
const dateFrom    = document.getElementById("dateFrom");
const dateTo      = document.getElementById("dateTo");
const badgeDue    = document.getElementById("badgeDue");
const badgeFlag   = document.getElementById("badgeFlag");

// Multi-status controls
const statusLabel = document.getElementById("statusLabel");
const statusPanel = document.getElementById("statusPanel");

// Sidebar primary filters container
const filtersContainer = document.getElementById("filtersContainer");

// Controls state (same structure as offline version)
const uiState = {
  search: "",
  statusList: [],
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
    country: []
  },
  primaryLocks: {
    caseResolutionCode: false,
    tl: false,
    sbd: false,
    caGroup: false,
    onsiteRFC: false,
    csrRFC: false,
    benchRFC: false,
    country: false
  },
  mode: "normal",
  sortByDateAsc: null
};


// ==========================================================
// HELPER: Check if row matches primary filters
// ==========================================================
function passPrimaryFilters(row) {
  const p = uiState.primaries;

  // AND across all primary filter categories
  for (const key in p) {
    const selected = p[key];
    if (selected.length === 0) continue; // no filter in this category

    // OR match within the category
    if (!selected.includes(row[key])) return false;
  }

  return true;
}


// ==========================================================
// MAIN FILTER FUNCTION
// ==========================================================
export function applyFilters() {
  let rows = [...trackerState.allCases];
  const today = new Date().toISOString().split("T")[0];

  // -----------------------------
  // SEARCH
  // -----------------------------
  if (uiState.search.trim().length > 0) {
    const q = uiState.search.toLowerCase();

    rows = rows.filter(r => {
      return (
        (r.id || "").toLowerCase().includes(q) ||
        (r.customerName || "").toLowerCase().includes(q) ||
        (r.country || "").toLowerCase().includes(q) ||
        (r.caseResolutionCode || "").toLowerCase().includes(q) ||
        (r.caseOwner || "").toLowerCase().includes(q) ||
        (r.caGroup || "").toLowerCase().includes(q) ||
        (r.sbd || "").toLowerCase().includes(q) ||
        (r.tl || "").toLowerCase().includes(q) ||
        (r.onsiteRFC || "").toLowerCase().includes(q) ||
        (r.csrRFC || "").toLowerCase().includes(q) ||
        (r.benchRFC || "").toLowerCase().includes(q) ||
        (r.notes || "").toLowerCase().includes(q)
      );
    });
  }

  // -----------------------------
  // MULTI-STATUS FILTER
  // -----------------------------
  if (uiState.statusList.length > 0) {
    rows = rows.filter(r =>
      r.status && uiState.statusList.includes(r.status)
    );
  }

  // -----------------------------
  // DATE RANGE
  // -----------------------------
  if (uiState.from) {
    rows = rows.filter(r => (r.createdOn || "") >= uiState.from);
  }
  if (uiState.to) {
    rows = rows.filter(r => (r.createdOn || "") <= uiState.to);
  }

  // -----------------------------
  // PRIMARY FILTERS
  // -----------------------------
  rows = rows.filter(passPrimaryFilters);

  // -----------------------------
  // MODES
  // -----------------------------
  if (uiState.mode === "due") {
    rows = rows.filter(r => {
      const fd = r.followDate || "";
      return fd && fd <= today && r.status !== "Closed";
    });
  }
  else if (uiState.mode === "flagged") {
    rows = rows.filter(r => r.flagged === true);
  }
  else if (uiState.mode === "repeat") {
    const count = {};
    rows.forEach(r => {
      const c = r.customerName || "";
      count[c] = (count[c] || 0) + 1;
    });
    rows = rows.filter(r => count[r.customerName] > 1);
  }
  else if (uiState.mode === "unupdated") {
    rows = rows.filter(r => !r.status || r.status.trim() === "");
  }

  // -----------------------------
  // SORT BY DATE (ASC or DESC)
  // -----------------------------
  if (uiState.sortByDateAsc !== null) {
    rows.sort((a, b) => {
      const da = a.createdOn || "";
      const db = b.createdOn || "";
      if (da === db) return 0;
      return uiState.sortByDateAsc
        ? da.localeCompare(db)
        : db.localeCompare(da);
    });
  }

  // Save filtered result
  trackerState.filteredCases = rows;

  // Refresh table
  renderTable();

  // Refresh badges
  updateBadges();
}


// ==========================================================
// BADGE COUNTERS (Due Today & Flagged)
// ==========================================================
function updateBadges() {
  const today = new Date().toISOString().split("T")[0];

  const due = trackerState.allCases.filter(r => {
    const fd = r.followDate || "";
    return fd && fd <= today && r.status !== "Closed";
  }).length;

  const flagged = trackerState.allCases.filter(r => r.flagged).length;

  badgeDue.textContent = due;
  badgeFlag.textContent = flagged;
}
// ===============================
// SECTION 2B — TABLE RENDERING
// ===============================

const tbody = document.getElementById("tbody");

// Render all filtered rows into the table
export function renderTable() {
  const rows = trackerState.filteredCases;
  const today = new Date().toISOString().split("T")[0];

  tbody.innerHTML = "";

  rows.forEach((r, index) => {
    const tr = document.createElement("tr");

    // Same highlighting rules as offline version
    if (r.followDate && r.followDate <= today && r.status !== "Closed") {
      tr.classList.add("due-today");
    } else if (r.flagged) {
      tr.classList.add("flagged");
    } else if (r.notes) {
      tr.classList.add("has-notes");
    }

    tr.innerHTML = `
      <td class="sno">${index + 1}</td>
      <td class="caseid" data-id="${r.id}">${escapeHtml(r.id)}</td>
      <td>${escapeHtml(r.customerName)}</td>
      <td>${escapeHtml(r.country)}</td>
      <td>${escapeHtml(r.caseResolutionCode)}</td>
      <td>${escapeHtml(r.caseOwner)}</td>
      <td>${escapeHtml(r.caGroup)}</td>
      <td>${escapeHtml(r.sbd)}</td>
      <td>${renderStatusSelect(r)}</td>
      <td class="right">
        <span class="gear" data-action="opts" data-id="${r.id}" style="cursor:pointer;">⚙️</span>
      </td>
    `;

    tbody.appendChild(tr);
  });
}

// Status select dropdown (identical to offline UI)
function renderStatusSelect(row) {
  const selected = row.status || "";
  const options = [
    "",
    "Closed",
    "NCM 1",
    "NCM 2",
    "PNS",
    "Service Pending",
    "Monitoring"
  ];

  return `
    <select class="status-select" data-action="status" data-id="${row.id}">
      ${options.map(o => `
        <option value="${o}" ${o === selected ? "selected" : ""}>${o}</option>
      `).join("")}
    </select>
  `;
}

// Escape HTML helper (same as offline)
function escapeHtml(s) {
  return String(s || "").replace(/[&<>"']/g, c => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[c]));
}


// ---------------------------------------------------------
// TABLE EVENTS: status change, gear click, double click
// ---------------------------------------------------------

// Handle status changes (Firestore updates)
tbody.addEventListener("change", (e) => {
  const sel = e.target.closest("select[data-action='status']");
  if (!sel) return;

  const caseId = sel.dataset.id;
  const newStatus = sel.value;

  handleStatusChange(caseId, newStatus);
});

// Handle gear button → open modal
tbody.addEventListener("click", (e) => {
  const gear = e.target.closest("[data-action='opts']");
  if (!gear) return;

  openCaseModal(gear.dataset.id);
});

// Double-click case ID → copy to clipboard
tbody.addEventListener("dblclick", (e) => {
  const cell = e.target.closest(".caseid");
  if (!cell) return;

  const text = cell.textContent.trim();
  navigator.clipboard.writeText(text);

  const toast = document.getElementById("toast");
  toast.classList.add("show");
  setTimeout(() => toast.classList.remove("show"), 800);
});


// ==============================================================
// STATUS CHANGE LOGIC
// (Enforces follow-up date for SP/Monitoring — Firestore version)
// ==============================================================
function handleStatusChange(caseId, newStatus) {
  const today = new Date().toISOString().split("T")[0];

  // Find record
  const row = trackerState.allCases.find(r => r.id === caseId);
  if (!row) return;

  const requiresFollowUp =
    newStatus === "Service Pending" ||
    newStatus === "Monitoring";

  // Update local row state
  row.status = newStatus;
  row.lastActionedOn = today;
  row.lastActionedBy = trackerState.user.uid;

  // If status needs a follow-up date → open modal
  if (requiresFollowUp) {
    // open modal and show warning
    openCaseModal(caseId, true); // "true" = require follow-up
    return;
  }

  // Otherwise update Firestore immediately
  updateCase(caseId, {
    status: newStatus,
    lastActionedOn: row.lastActionedOn,
    lastActionedBy: row.lastActionedBy
  });

  // Refresh
  applyFilters();
}
// ===============================
// SECTION 2C — FILTER UI LOGIC
// ===============================

// ----------------------------------------------
// SEARCH
// ----------------------------------------------
txtSearch.addEventListener("input", () => {
  uiState.search = txtSearch.value.trim();
  applyFilters();
});

// ----------------------------------------------
// DATE RANGE
// ----------------------------------------------
dateFrom.addEventListener("change", () => {
  uiState.from = dateFrom.value;
  applyFilters();
});
dateTo.addEventListener("change", () => {
  uiState.to = dateTo.value;
  applyFilters();
});

// ----------------------------------------------
// MULTI-STATUS DROPDOWN
// ----------------------------------------------
function buildStatusPanel() {
  const statuses = [
    "Closed","NCM 1","NCM 2","PNS","Service Pending","Monitoring"
  ];

  statusPanel.innerHTML = statuses.map(s => {
    const checked = uiState.statusList.includes(s) ? "checked" : "";
    return `
      <label>
        <input type="checkbox" data-status="${s}" ${checked} />
        ${s}
      </label>
    `;
  }).join("");

  updateStatusLabel();
}

function updateStatusLabel() {
  if (uiState.statusList.length === 0) {
    statusLabel.textContent = "All Statuses";
  } else {
    statusLabel.textContent = uiState.statusList.join(", ");
  }
}

statusBox.addEventListener("click", (e) => {
  if (e.target.closest("input")) return;
  statusPanel.style.display =
    statusPanel.style.display === "block" ? "none" : "block";
});

// Close panel when clicking outside
document.addEventListener("click", (e) => {
  if (!statusBox.contains(e.target)) {
    statusPanel.style.display = "none";
  }
});

// Checkbox handler
statusPanel.addEventListener("change", (e) => {
  const cb = e.target.closest("input[type='checkbox']");
  if (!cb) return;

  const status = cb.dataset.status;
  const set = new Set(uiState.statusList);

  if (cb.checked) set.add(status);
  else set.delete(status);

  uiState.statusList = [...set];
  updateStatusLabel();
  applyFilters();
});

// ----------------------------------------------
// APPLY & CLEAR BUTTONS
// ----------------------------------------------
document.getElementById("btnApply").addEventListener("click", () => {
  applyFilters();
});

document.getElementById("btnClear").addEventListener("click", () => {
  uiState.search = "";
  uiState.statusList = [];
  uiState.from = "";
  uiState.to = "";
  uiState.mode = "normal";
  uiState.sortByDateAsc = null;

  txtSearch.value = "";
  dateFrom.value = "";
  dateTo.value = "";

  buildStatusPanel();
  applyFilters();
});

// ----------------------------------------------
// PRIMARY FILTERS SIDEBAR
// ----------------------------------------------
filtersContainer.addEventListener("change", (e) => {
  const checkbox = e.target.closest("input[type='checkbox']");
  if (!checkbox) return;

  const key = checkbox.dataset.key;
  const value = checkbox.value;
  const set = new Set(uiState.primaries[key]);

  if (checkbox.checked) set.add(value);
  else set.delete(value);

  uiState.primaries[key] = [...set];
  applyFilters();
});

// Lock/unlock handling
filtersContainer.addEventListener("click", (e) => {
  const lock = e.target.closest("[data-action='lock']");
  const block = e.target.closest(".filter-block");
  const toggle = e.target.closest("[data-action='toggle']");

  if (!block) return;

  const key = block.dataset.key;

  // Collapse/expand section
  if (toggle) {
    const body = block.querySelector(".filter-body");
    body.classList.toggle("open");
  }

  // Lock/unlock filter category
  if (lock) {
    uiState.primaryLocks[key] = !uiState.primaryLocks[key];
    block.classList.toggle("filter-locked", uiState.primaryLocks[key]);
  }
});

// Sidebar apply/close
document.getElementById("btnSideApply").addEventListener("click", () => {
  applyFilters();
  document.getElementById("sidebar").classList.remove("open");
  document.getElementById("overlay").classList.remove("show");
});

document.getElementById("btnSideClose").addEventListener("click", () => {
  document.getElementById("sidebar").classList.remove("open");
  document.getElementById("overlay").classList.remove("show");
});

// ----------------------------------------------
// MODE BUTTONS
// ----------------------------------------------
document.getElementById("btnDueToday").addEventListener("click", () => {
  uiState.mode = "due";
  applyFilters();
});

document.getElementById("btnFlagged").addEventListener("click", () => {
  uiState.mode = "flagged";
  applyFilters();
});

document.getElementById("btnRepeating").addEventListener("click", () => {
  uiState.mode = "repeat";
  applyFilters();
});

document.getElementById("btnUnupdated").addEventListener("click", () => {
  uiState.mode = "unupdated";
  applyFilters();
});

// ----------------------------------------------
// SORT BUTTON (creation date)
// ----------------------------------------------
document.getElementById("btnSortDate").addEventListener("click", () => {
  if (uiState.sortByDateAsc === null) {
    uiState.sortByDateAsc = false; // first click: newest first
  } else {
    uiState.sortByDateAsc = !uiState.sortByDateAsc; // toggle
  }
  applyFilters();
});

// ----------------------------------------------
// INITIAL BUILD
// ----------------------------------------------
buildStatusPanel();

/* ===============================
   SECTION 3A — OPEN CASE MODAL
   =============================== */

const modal           = document.getElementById("modal");
const modalTitle      = document.getElementById("modalTitle");
const modalWarning    = document.getElementById("modalWarning");
const optDate         = document.getElementById("optDate");
const optFlag         = document.getElementById("optFlag");
const optNotes        = document.getElementById("optNotes");
const optLastActioned = document.getElementById("optLastActioned");
const btnModalClose   = document.getElementById("btnModalClose");
const btnModalSave    = document.getElementById("btnModalSave");

let currentModalCaseId = null;
let requireFollowUp     = false;

// ----------------------------------------
// OPEN MODAL
// ----------------------------------------
export function openCaseModal(caseId, enforceFollowUp = false) {
  requireFollowUp = enforceFollowUp === true;

  const r = trackerState.allCases.find(x => x.id === caseId);
  if (!r) return;

  currentModalCaseId = caseId;

  modalTitle.textContent = `Case Options - ${caseId}`;

  optLastActioned.textContent = r.lastActionedOn
    ? formatDMY(r.lastActionedOn)
    : "—";

  optDate.value = r.followDate || "";
  optNotes.value = r.notes || "";

  // Flag switch
  setFlagUI(r.flagged);

  // If status requires follow-up and missing date → show warning
  if (requireFollowUp && !r.followDate) {
    showModalWarning(`Status "${r.status}" requires a follow-up date.`);
  } else {
    hideModalWarning();
  }

  modal.classList.add("show");
}

// ----------------------------------------
// FLAG VISUAL TOGGLE
// ----------------------------------------
function setFlagUI(on) {
  optFlag.classList.toggle("on", on);
  optFlag.setAttribute("aria-checked", on ? "true" : "false");
}

optFlag.addEventListener("click", () => {
  setFlagUI(!optFlag.classList.contains("on"));
});

// ----------------------------------------
// CLOSE MODAL
// ----------------------------------------
function closeModal() {
  modal.classList.remove("show");
  currentModalCaseId = null;
  requireFollowUp = false;
}

btnModalClose.addEventListener("click", closeModal);

modal.addEventListener("click", (e) => {
  if (e.target === modal) closeModal();
});

// ----------------------------------------
// WARNING CONTROLS
// ----------------------------------------
function showModalWarning(msg) {
  modalWarning.textContent = msg;
  modalWarning.style.display = "block";
}

function hideModalWarning() {
  modalWarning.textContent = "";
  modalWarning.style.display = "none";
}

// Helper reused from offline
function formatDMY(iso) {
  if (!iso) return "";
  const [y, m, d] = iso.split("-");
  return `${d}-${m}-${y}`;
}

/* ===============================
   SECTION 3B — SAVE CASE UPDATES
   =============================== */

btnModalSave.addEventListener("click", async () => {
  if (!currentModalCaseId) return;

  const caseId = currentModalCaseId;
  const row = trackerState.allCases.find(r => r.id === caseId);
  if (!row) return;

  const followDate = optDate.value
    ? new Date(optDate.value).toISOString().split("T")[0]
    : null;

  // If follow-up enforced but missing → warn user
  if (requireFollowUp && !followDate) {
    showModalWarning("Please select a follow-up date before saving.");
    return;
  }

  hideModalWarning();

  // Update local row temporarily
  const today = new Date().toISOString().split("T")[0];
  row.followDate     = followDate;
  row.flagged        = optFlag.classList.contains("on");
  row.notes          = optNotes.value.trim();
  row.lastActionedOn = today;
  row.lastActionedBy = trackerState.user.uid;

  // --- FIRESTORE UPDATE ---
  await updateCase(caseId, {
    followDate: row.followDate,
    flagged: row.flagged,
    notes: row.notes,
    lastActionedOn: row.lastActionedOn,
    lastActionedBy: row.lastActionedBy
  });

  // Refresh interface
  applyFilters();
  closeModal();
});

/* ===============================
   SECTION 3C — INFO SUMMARY MODAL
   =============================== */

const infoModal      = document.getElementById("infoModal");
const infoModalBody  = document.getElementById("infoModalBody");
const btnInfoClose   = document.getElementById("btnInfoClose");
const btnInfoOk      = document.getElementById("btnInfoOk");

// ℹ️ button opens summary
document.getElementById("btnInfo").addEventListener("click", () => {
  computeAndShowInfo();
});

btnInfoClose.addEventListener("click", () => {
  infoModal.classList.remove("show");
});

btnInfoOk.addEventListener("click", () => {
  infoModal.classList.remove("show");
});

infoModal.addEventListener("click", (e) => {
  if (e.target === infoModal) infoModal.classList.remove("show");
});

// --------------------------------------------
// SUMMARY CALCULATION
// --------------------------------------------
function computeAndShowInfo() {
  const uid   = trackerState.user.uid;
  const today = new Date().toISOString().split("T")[0];

  // Only consider cases actioned by THIS USER today
  const rows = trackerState.allCases.filter(r =>
    r.lastActionedBy === uid &&
    r.lastActionedOn === today
  );

  const closed = rows.filter(r => r.status === "Closed");
  const totalClosed = closed.length;

  // Met / Not Met
  let met = 0, notMet = 0;
  closed.forEach(r => {
    const s = (r.sbd || "").toLowerCase();
    if (s === "met") met++;
    if (s === "not met") notMet++;
  });

  const pct = n => totalClosed ? Math.round((n / totalClosed) * 100) : 0;

  // Status counts today
  const statusCounts = {
    "Service Pending": 0,
    "Monitoring": 0,
    "NCM 1": 0,
    "NCM 2": 0,
    "PNS": 0
  };

  rows.forEach(r => {
    if (statusCounts[r.status] != null) {
      statusCounts[r.status]++;
    }
  });

  const totalActioned =
      totalClosed +
      statusCounts["Service Pending"] +
      statusCounts["Monitoring"] +
      statusCounts["NCM 1"] +
      statusCounts["NCM 2"] +
      statusCounts["PNS"];

  infoModalBody.textContent =
`Total Cases Closed Today: ${totalClosed}
Met Cases Closed: ${met} (${pct(met)}%)
Not Met Cases Closed: ${notMet} (${pct(notMet)}%)

Service Pending: ${statusCounts["Service Pending"]}
Monitoring: ${statusCounts["Monitoring"]}
NCM 1: ${statusCounts["NCM 1"]}
NCM 2: ${statusCounts["NCM 2"]}
PNS: ${statusCounts["PNS"]}

Total Actioned Cases Today: ${totalActioned}`;

  infoModal.classList.add("show");
}


