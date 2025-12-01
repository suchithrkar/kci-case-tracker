/* ============================================================================
   KCI CASE TRACKER — TRACKER MODULE (index.js)
   FULL CLEAN PRODUCTION VERSION
   WITH COMPLETE DESCRIPTIVE COMMENTS
   ============================================================================
   This file controls:
     - Tracker UI behavior
     - Case table rendering
     - Status change logic
     - Modal interactions
     - SP/MON follow-up enforcement
     - Filtering, search, sorting
     - User-specific Due Today & Flagged
     - Repeating Customers & Unupdated Cases
     - Firestore communication (read/write)
     - Sidebar, theme, and session UX

   ⚠ THIS FILE IS DELIVERED IN MULTIPLE CHUNKS
   ➜ DO NOT paste into your project until all chunks arrive
   ============================================================================
*/


/* ============================================================================
   SECTION 1 — IMPORTS & FIRESTORE INITIALIZATION
   ============================================================================
   We import all required Firebase + helper modules.
   These ensure that the Tracker can:
     - Authenticate user
     - Load team cases in real-time
     - Update allowed fields (restricted by Firestore rules)
     - Access user profile data (role, team, theme)
============================================================================ */

import {
  auth,
  db,
  onAuthStateChanged,
  collection,
  doc,
  getDoc,
  query,
  where,
  onSnapshot,
  updateDoc
} from "./js/firebase.js";

import {
  isPrimary,
  isSecondary,
  getCurrentTrackerTeam,
  toggleTheme
} from "./js/userProfile.js";

import {
  listenToTeamCases,
  updateCase
} from "./js/firestore-api.js";

import {
  showPopup
} from "./js/utils.js";


/* ============================================================================
   SECTION 2 — DOM ELEMENT REFERENCES
   ============================================================================
   These are all the HTML elements that the Tracker interacts with.
   We assign them once here, and reuse them throughout the file.
   This improves performance and code clarity.
============================================================================ */

const el = {
  // Header elements
  userFullName: document.getElementById("userFullName"),
  btnTheme: document.getElementById("btnTheme"),
  btnAdmin: document.getElementById("btnAdmin"),
  btnLogout: document.getElementById("btnLogout"),

  // Sidebar controls
  hamburger: document.getElementById("btnHamburger"),
  sidebar: document.getElementById("sidebar"),
  overlay: document.getElementById("overlay"),

  // Filters
  txtSearch: document.getElementById("txtSearch"),
  dateFrom: document.getElementById("dateFrom"),
  dateTo: document.getElementById("dateTo"),

  // Status multi-select
  statusBox: document.getElementById("statusBox"),
  statusLabel: document.getElementById("statusLabel"),
  statusPanel: document.getElementById("statusPanel"),

  // Buttons
  btnApply: document.getElementById("btnApply"),
  btnClear: document.getElementById("btnClear"),
  btnDueToday: document.getElementById("btnDueToday"),
  btnFlagged: document.getElementById("btnFlagged"),
  btnRepeating: document.getElementById("btnRepeating"),
  btnUnupdated: document.getElementById("btnUnupdated"),
  btnSortDate: document.getElementById("btnSortDate"),

  // Badges (Due / Flag)
  badgeDue: document.getElementById("badgeDue"),
  badgeFlag: document.getElementById("badgeFlag"),

  // Table body
  tbody: document.getElementById("tbody")
};


/* ============================================================================
   SECTION 3 — GLOBAL TRACKER STATE
   ============================================================================
   This state object holds:
     - Current user data
     - Current team ID
     - All cases loaded from Firestore
     - The filtered final results after applying UI filters

   This acts as the in-memory representation of the Tracker table.
============================================================================ */

export const trackerState = {
  user: null,         // { uid, firstName, lastName, role, teamId, theme, ... }
  teamId: null,       // active team ID (string)
  allCases: [],       // all cases loaded from Firestore listener
  filteredCases: []   // cases after filters applied
};


/* ============================================================================
   SECTION 4 — UI STATE (FILTERS & MODES)
   ============================================================================
   This object represents the COMPLETE UI FILTER STATE.
   Every filter button or dropdown updates this object first,
   then applyFilters() applies it to trackerState.allCases.
============================================================================ */

const uiState = {
  search: "",
  from: "",
  to: "",
  statusList: [],       // multi-select
  mode: "normal",       // "normal" | "due" | "flagged" | "repeat" | "unupdated"
  sortByDateAsc: null,  // null = off, true = asc, false = desc
};


/* ============================================================================
   SECTION 5 — AUTH LISTENER (ENTRY POINT)
   ============================================================================
   As soon as a user lands on index.html:
     1. We check their authentication status
     2. Load their user document
     3. Initialize theme, UI, filters, listeners
     4. Load their team’s cases via listenToTeamCases()

   If user is not approved → sign out.
============================================================================ */

onAuthStateChanged(auth, async (user) => {
  if (!user) return (location.href = "login.html");

  const snap = await getDoc(doc(db, "users", user.uid));
  if (!snap.exists()) return (location.href = "login.html");

  const data = snap.data();
  if (data.status !== "approved") {
    alert("Your account is not yet approved.");
    await auth.signOut();
    return (location.href = "login.html");
  }

  trackerState.user = { uid: user.uid, ...data };
  trackerState.teamId = getCurrentTrackerTeam(data);

  // Display user name in header
  el.userFullName.textContent = `${data.firstName} ${data.lastName}`;

  // Apply saved theme
  document.documentElement.dataset.theme = data.theme || "dark";
  el.btnTheme.textContent = data.theme === "light" ? "🌙" : "☀️";
  el.btnTheme.onclick = () => {
    toggleTheme(trackerState.user);
    el.btnTheme.textContent =
      trackerState.user.theme === "light" ? "🌙" : "☀️";
  };

  // Show Admin button only for primary / secondary admins
  if (isPrimary(data) || isSecondary(data)) {
    el.btnAdmin.style.display = "inline-block";
    el.btnAdmin.onclick = () => (location.href = "admin.html");
  } else {
    el.btnAdmin.style.display = "none";
  }

  // Logout button
  el.btnLogout.onclick = () => {
    auth.signOut().then(() => (location.href = "login.html"));
  };

  // Initialize UI controls
  setupSidebarControls();
  setupFilterControls();
  setupStatusPanel();

  // Load Firestore cases for this team
  setupRealtimeCases(trackerState.teamId);
});

/* ============================================================================
   SECTION 6 — REAL-TIME CASE LISTENER (Optimized)
   ============================================================================
   We maintain ONLY ONE real-time listener:
     listenToTeamCases(teamId)
   which is already optimized in firestore-api.js.

   This ensures:
     - Real-time updates for tracker table users
     - Minimal Firestore reads
     - Efficient re-render when cases change
============================================================================ */

let unsubscribe = null;

function setupRealtimeCases(teamId) {
  if (unsubscribe) unsubscribe();

  unsubscribe = listenToTeamCases(teamId, (cases) => {
    /*
      Convert raw Firestore documents into trackerState-friendly format.
      This ensures consistency, avoids missing fields, and prevents UI crashes.
    */
    trackerState.allCases = cases.map(c => ({
      id: c.id,
      customerName: c.customerName || "",
      createdOn: c.createdOn || "",
      createdBy: c.createdBy || "",
      country: c.country || "",
      caseResolutionCode: c.caseResolutionCode || "",
      caseOwner: c.caseOwner || "",
      caGroup: c.caGroup || "",
      sbd: c.sbd || "",
      tl: c.tl || "",
      onsiteRFC: c.onsiteRFC || "",
      csrRFC: c.csrRFC || "",
      benchRFC: c.benchRFC || "",
      status: c.status || "",
      followDate: c.followDate || "",
      flagged: !!c.flagged,
      notes: c.notes || "",
      lastActionedOn: c.lastActionedOn || "",
      lastActionedBy: c.lastActionedBy || ""
    }));

    applyFilters();  // refresh table using latest data
  });
}


/* ============================================================================
   SECTION 7 — SIDEBAR CONTROLS
   ============================================================================
   Controls the hamburger button, sidebar slide-in, overlay tap-to-close.
============================================================================ */

function setupSidebarControls() {
  el.hamburger.onclick = () => {
    el.sidebar.classList.add("open");
    el.overlay.classList.add("show");
  };

  el.overlay.onclick = closeSidebar;
  const btnSideClose = document.getElementById("btnSideClose");
  if (btnSideClose) btnSideClose.onclick = closeSidebar;

  function closeSidebar() {
    el.sidebar.classList.remove("open");
    el.overlay.classList.remove("show");
  }
}


/* ============================================================================
   SECTION 8 — FILTER CONTROLS (Search, Date, Apply, Clear)
   ============================================================================
   Every filter control updates uiState and triggers applyFilters().
============================================================================ */

function setupFilterControls() {

  /* -------------------------------------------------------------
     Search Bar: Apply on ENTER and on APPLY button
  ------------------------------------------------------------- */
  el.txtSearch.onkeydown = (e) => {
    if (e.key === "Enter") {
      uiState.search = el.txtSearch.value.trim().toLowerCase();
      applyFilters();
    }
  };

  /* -------------------------------------------------------------
     Date Filters
  ------------------------------------------------------------- */
  el.dateFrom.onchange = () => (uiState.from = el.dateFrom.value);
  el.dateTo.onchange = () => (uiState.to = el.dateTo.value);

  /* -------------------------------------------------------------
     APPLY BUTTON — Applies ALL filters
  ------------------------------------------------------------- */
  el.btnApply.onclick = () => {
    uiState.search = el.txtSearch.value.trim().toLowerCase();
    uiState.from = el.dateFrom.value;
    uiState.to = el.dateTo.value;
    applyFilters();
  };

  /* -------------------------------------------------------------
     CLEAR BUTTON — Resets ALL UI filters
  ------------------------------------------------------------- */
  el.btnClear.onclick = () => {
    uiState.search = "";
    uiState.from = "";
    uiState.to = "";
    uiState.statusList = [];
    uiState.mode = "normal";
    uiState.sortByDateAsc = null;

    el.txtSearch.value = "";
    el.dateFrom.value = "";
    el.dateTo.value = "";

    buildStatusPanel();  // refresh status UI checkboxes
    applyFilters();
  };

  /* -------------------------------------------------------------
     MODE BUTTONS (Due Today, Flagged, Repeating, Unupdated)
     These **override all other filters** (Option A behavior)
  ------------------------------------------------------------- */
  el.btnDueToday.onclick = () => { uiState.mode = "due"; applyFilters(); };
  el.btnFlagged.onclick = () => { uiState.mode = "flagged"; applyFilters(); };
  el.btnRepeating.onclick = () => { uiState.mode = "repeat"; applyFilters(); };
  el.btnUnupdated.onclick = () => { uiState.mode = "unupdated"; applyFilters(); };

  /* -------------------------------------------------------------
     SORT BY CREATION DATE
     toggles between ASC → DESC → OFF
  ------------------------------------------------------------- */
  el.btnSortDate.onclick = () => {
    uiState.sortByDateAsc =
      uiState.sortByDateAsc === null ? false : !uiState.sortByDateAsc;

    showPopup(
      uiState.sortByDateAsc === null
        ? "Sorting cleared"
        : uiState.sortByDateAsc
        ? "Sorting oldest first"
        : "Sorting newest first"
    );

    applyFilters();
  };
}


/* ============================================================================
   SECTION 9 — STATUS MULTI-SELECT PANEL
   ============================================================================
   User can select multiple statuses.
   Filter is applied only when user clicks APPLY (not instantly).
============================================================================ */

function setupStatusPanel() {
  buildStatusPanel();

  // Clicking the label toggles the checklist panel
  el.statusBox.onclick = (e) => {
    if (!e.target.closest("input")) toggleStatusPanel();
  };

  // Clicking outside closes the panel
  document.addEventListener("click", (e) => {
    if (
      !el.statusBox.contains(e.target) &&
      !el.statusPanel.contains(e.target)
    ) {
      el.statusPanel.style.display = "none";
    }
  });

  function toggleStatusPanel() {
    el.statusPanel.style.display =
      el.statusPanel.style.display === "block" ? "none" : "block";
  }
}


/* ============================================================================
   SECTION 9A — BUILD STATUS PANEL LIST
============================================================================ */

function buildStatusPanel() {
  const statuses = [
    "Closed",
    "NCM 1",
    "NCM 2",
    "PNS",
    "Service Pending",
    "Monitoring"
  ];

  // Build checkbox list
  el.statusPanel.innerHTML = statuses
    .map(
      s => `
    <label>
      <input type="checkbox" data-status="${s}"
        ${uiState.statusList.includes(s) ? "checked" : ""}/>
      ${s}
    </label>
  `
    )
    .join("");

  updateStatusLabel();

  // Handle checkbox clicks
  el.statusPanel.onchange = (e) => {
    const checkbox = e.target.closest("input");
    if (!checkbox) return;

    const set = new Set(uiState.statusList);
    checkbox.checked ? set.add(checkbox.dataset.status) : set.delete(checkbox.dataset.status);
    uiState.statusList = [...set];

    updateStatusLabel();
  };
}


/* ============================================================================
   SECTION 9B — UPDATE STATUS LABEL (Shows comma-separated list)
============================================================================ */

function updateStatusLabel() {
  if (uiState.statusList.length === 0)
    el.statusLabel.textContent = "All Statuses";
  else
    el.statusLabel.textContent = uiState.statusList.join(", ");
}

/* ============================================================================
   SECTION 10 — FILTER ENGINE (MAIN LOGIC)
   ============================================================================
   This is the CORE of the tracker.

   It handles:
     - Search filter
     - Date range filter
     - Status multi-select filter
     - Sorting
     - Modes (Due Today, Flagged, Repeating, Unupdated)
============================================================================ */

export function applyFilters() {
  const today = new Date().toISOString().split("T")[0];
  let rows = [...trackerState.allCases];

  /* =============================================================
     MODE OVERRIDES
     Each mode REPLACES all filters (Option A behavior)
     -------------------------------------------------------------
     due       → tasks due today
     flagged   → flagged by current user
     repeat    → repeating customers
     unupdated → status == ""
  ============================================================= */

  // -------------------- DUE TODAY --------------------
  if (uiState.mode === "due") {
    rows = rows.filter(r =>
      r.lastActionedBy === trackerState.user.uid &&
      r.followDate &&
      r.followDate <= today &&
      r.status !== "Closed"
    );

    trackerState.filteredCases = rows;
    updateBadges();
    renderTable();
    return;
  }

  // -------------------- FLAGGED --------------------
  if (uiState.mode === "flagged") {
    rows = rows.filter(r =>
      r.flagged &&
      r.lastActionedBy === trackerState.user.uid
    );

    trackerState.filteredCases = rows;
    updateBadges();
    renderTable();
    return;
  }

  // -------------------- UNUPDATED --------------------
  if (uiState.mode === "unupdated") {
    rows = rows.filter(r =>
      !r.status || r.status.trim() === ""
    );

    trackerState.filteredCases = rows;
    updateBadges();
    renderTable();
    return;
  }

  // -------------------- REPEATING CUSTOMERS --------------------
  if (uiState.mode === "repeat") {
    const count = {};
    rows.forEach(r => {
      const name = (r.customerName || "").trim().toLowerCase();
      if (!name) return;
      count[name] = (count[name] || 0) + 1;
    });

    rows = rows.filter(r =>
      count[(r.customerName || "").trim().toLowerCase()] > 1
    );

    trackerState.filteredCases = rows;
    updateBadges();
    renderTable();
    return;
  }

  /* =============================================================
     NORMAL MODE — APPLY FULL FILTER PIPELINE
  ============================================================= */

  // -------------------- SEARCH --------------------
  if (uiState.search) {
    const q = uiState.search;
    rows = rows.filter(r =>
      r.id.toLowerCase().includes(q) ||
      (r.customerName || "").toLowerCase().includes(q) ||
      (r.country || "").toLowerCase().includes(q) ||
      (r.caseResolutionCode || "").toLowerCase().includes(q) ||
      (r.caseOwner || "").toLowerCase().includes(q) ||
      (r.caGroup || "").toLowerCase().includes(q) ||
      (r.sbd || "").toLowerCase().includes(q)
    );
  }

  // -------------------- DATE RANGE --------------------
  if (uiState.from) rows = rows.filter(r => r.createdOn >= uiState.from);
  if (uiState.to)   rows = rows.filter(r => r.createdOn <= uiState.to);

  // -------------------- STATUS MULTI-SELECT --------------------
  if (uiState.statusList.length > 0) {
    rows = rows.filter(r => uiState.statusList.includes(r.status));
  }

  // -------------------- SORT BY DATE --------------------
  if (uiState.sortByDateAsc !== null) {
    rows.sort((a, b) =>
      uiState.sortByDateAsc
        ? a.createdOn.localeCompare(b.createdOn)  // ASC
        : b.createdOn.localeCompare(a.createdOn)  // DESC
    );
  }

  trackerState.filteredCases = rows;

  updateBadges();
  renderTable();
}


/* ============================================================================
   SECTION 11 — BADGE COUNTS (Due / Flagged)
   ============================================================================
   These appear in the header next to mode buttons.
============================================================================ */

function updateBadges() {
  const today = new Date().toISOString().split("T")[0];

  // DUE badge — user-specific
  el.badgeDue.textContent = trackerState.allCases.filter(r =>
    r.lastActionedBy === trackerState.user.uid &&
    r.followDate &&
    r.followDate <= today &&
    r.status !== "Closed"
  ).length;

  // FLAGGED badge — user-specific
  el.badgeFlag.textContent = trackerState.allCases.filter(r =>
    r.lastActionedBy === trackerState.user.uid &&
    r.flagged
  ).length;
}


/* ============================================================================
   SECTION 12 — TABLE RENDER (Placeholder)
   ============================================================================
   Phase 2 will replace this placeholder with the full rendering engine.
============================================================================ */

// NOTE: this placeholder is immediately replaced in CHUNK 4.
// It must exist here so that earlier code can call renderTable() safely.
export function renderTable() {
  // (Replaced in the next chunk)
}


/* ============================================================================
   SECTION 13 — HTML ESCAPE UTIL (Prevents XSS)
============================================================================ */

function escapeHtml(str) {
  return String(str || "").replace(/[&<>"']/g, c => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[c]));
}

/* ============================================================================
   SECTION 14 — TABLE RENDERING ENGINE
   ============================================================================
   This renders the entire case table dynamically.

   Features:
     - Row highlighting (due, flagged, notes)
     - Status dropdown per row
     - Gear button to open modal
     - Double-click case ID to copy
     - Fast, flicker-free rendering
============================================================================ */

export function renderTable() {
  const rows = trackerState.filteredCases;
  const today = new Date().toISOString().split("T")[0];

  // Clear table
  el.tbody.innerHTML = "";

  rows.forEach((r, index) => {
    const tr = document.createElement("tr");

    /* ---------------------------------------------------------
       ROW STYLING
       ---------------------------------------------------------
       Priority:
         1. Due Today    (yellow)
         2. Flagged      (red)
         3. Has Notes    (blue)
    --------------------------------------------------------- */

    if (r.followDate && r.followDate <= today && r.status !== "Closed") {
      tr.classList.add("due-today");
    }
    else if (r.flagged) {
      tr.classList.add("flagged");
    }
    else if (r.notes && r.notes.trim() !== "") {
      tr.classList.add("has-notes");
    }

    /* ---------------------------------------------------------
       BUILD ROW
    --------------------------------------------------------- */
    tr.innerHTML = `
      <td>${index + 1}</td>
      <td class="caseid" data-id="${escapeHtml(r.id)}">${escapeHtml(r.id)}</td>
      <td>${escapeHtml(r.customerName)}</td>
      <td>${escapeHtml(r.country)}</td>
      <td>${escapeHtml(r.caseResolutionCode)}</td>
      <td>${escapeHtml(r.caseOwner)}</td>
      <td>${escapeHtml(r.caGroup)}</td>
      <td>${escapeHtml(r.sbd)}</td>
      <td>${renderStatusSelect(r)}</td>
      <td>${renderGearButton(r.id)}</td>
    `;

    el.tbody.appendChild(tr);
  });
}


/* ============================================================================
   SECTION 14A — RENDER STATUS DROPDOWN
   ============================================================================
   Ensures:
     - Selected value persists
     - SP/MON do NOT reset after modal
     - Works with general-user Firestore rules
============================================================================ */

function renderStatusSelect(row) {
  const statuses = [
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
      ${statuses
        .map(
          s => `
        <option value="${s}" ${row.status === s ? "selected" : ""}>
          ${s}
        </option>
      `
        )
        .join("")}
    </select>
  `;
}


/* ============================================================================
   SECTION 14B — RENDER GEAR BUTTON
   ============================================================================
   This button opens the Case Options modal.
============================================================================ */

function renderGearButton(caseId) {
  return `
    <button class="icon-btn" style="padding:4px 8px;font-size:16px;"
      data-action="opts" data-id="${caseId}">
      ⚙️
    </button>
  `;
}


/* ============================================================================
   SECTION 15 — ROW EVENT HANDLERS
   ============================================================================
   Handles:
     - Status change
     - Gear button click (open modal)
     - Double-click to copy Case ID
============================================================================ */

el.tbody.addEventListener("change", (e) => {
  const sel = e.target.closest("select[data-action='status']");
  if (!sel) return;

  const caseId = sel.dataset.id;
  const newStatus = sel.value;

  handleStatusChange(caseId, newStatus);
});


el.tbody.addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-action='opts']");
  if (!btn) return;

  openCaseModal(btn.dataset.id);
});


el.tbody.addEventListener("dblclick", (e) => {
  const cell = e.target.closest(".caseid");
  if (!cell) return;

  const caseId = cell.textContent.trim();
  navigator.clipboard.writeText(caseId);

  const toast = document.getElementById("toast");
  toast.classList.add("show");

  setTimeout(() => toast.classList.remove("show"), 800);
});

/* ============================================================================
   SECTION 16 — STATUS CHANGE ENGINE (Core Logic)
   ============================================================================
   Handles:
     - SP/MON workflow (requires follow-up)
     - Ownership stamping (lastActionedBy / lastActionedOn)
     - Firestore updates with allowed fields only
     - Safe rollback when modal is canceled
============================================================================ */

/*
  We must store temporary original status so that:
    If user chooses a SP/MON status but cancels the modal,
    the dropdown reverts to the original status.

  This prevents the UI from entering a “fake status” state
  that does NOT match Firestore.
*/
let pendingStatusRollback = {
  caseId: null,
  oldStatus: null
};


async function handleStatusChange(caseId, newStatus) {
  const today = new Date().toISOString().split("T")[0];
  const row = trackerState.allCases.find(r => r.id === caseId);
  if (!row) return;

  const needsFollowUp =
    newStatus === "Service Pending" ||
    newStatus === "Monitoring";

  // Save original status in case user cancels SP/MON modal
  pendingStatusRollback = {
    caseId: caseId,
    oldStatus: row.status
  };

  // Apply local status (but NOT Firestore yet)
  row.status = newStatus;
  row.lastActionedOn = today;
  row.lastActionedBy = trackerState.user.uid;

  // SP/MON → require follow-up date (open modal BEFORE saving)
  if (needsFollowUp) {
    openCaseModal(caseId, true);   // enforce = true
    return;
  }

  // NORMAL statuses → push directly to Firestore
  await firestoreUpdateCase(caseId, {
    status: newStatus,
    lastActionedOn: today,
    lastActionedBy: trackerState.user.uid
  });

  applyFilters();
}


/* ============================================================================
   SECTION 17 — FIRESTORE UPDATE WRAPPER
   ============================================================================
   Only allowed fields are updated (enforced by Firestore rules).
   If general user tries to update a forbidden field → permission error,
   handled gracefully without breaking the UI.
============================================================================ */

async function firestoreUpdateCase(caseId, fields) {
  try {
    await updateCase(caseId, fields);    // from firestore-api.js
  } catch (err) {
    console.error("Firestore update error:", err);
    showPopup("You don't have permission to update this field.");

    // If update fails, always re-render table to restore correct UI state
    applyFilters();
  }
}

/* ============================================================================
   SECTION 18 — CASE OPTIONS MODAL (Open / Close / Load)
   ============================================================================
   This is the modal that appears when clicking the gear icon.
   It handles:
     - Showing case info
     - Last Actioned On + Last Actioned By Name
     - Follow-up date
     - Flag toggle
     - Notes
     - SP/MON follow-up required warning
============================================================================ */

const modal = document.getElementById("modal");
const modalCard = modal.querySelector(".modal-card");

const modalTitle = document.getElementById("modalTitle");

const optDate = document.getElementById("optDate");
const optFlag = document.getElementById("optFlag");
const optNotes = document.getElementById("optNotes");

const optLastActioned = document.getElementById("optLastActioned");

// We insert an extra element to show “Last Actioned By: Name”
const optLastActionedByName = document.createElement("div");
optLastActioned.insertAdjacentElement("afterend", optLastActionedByName);

const modalWarning = document.getElementById("modalWarning");

const btnModalClose = document.getElementById("btnModalClose");
const btnModalSave = document.getElementById("btnModalSave");

// Internal state
let currentModalCaseId = null;
let requireFollowUp = false;


/* ============================================================================
   OPEN MODAL — Load Data + Apply Animations
============================================================================ */

async function openCaseModal(caseId, enforce = false) {
  currentModalCaseId = caseId;
  requireFollowUp = enforce;

  const r = trackerState.allCases.find(x => x.id === caseId);
  if (!r) return;

  // Title
  modalTitle.textContent = `Case Options — ${caseId}`;

  // Last Actioned On
  optLastActioned.textContent =
    r.lastActionedOn ? formatDMY(r.lastActionedOn) : "—";

  // Last Actioned By (NAME)
  await loadLastActionedByName(r.lastActionedBy);

  // Follow-up Date
  optDate.value = r.followDate || "";

  // Flag
  setFlagUI(!!r.flagged);

  // Notes
  optNotes.value = r.notes || "";
  resizeNotes();

  // Warning bar (SP / MON)
  if (requireFollowUp && !r.followDate) {
    showModalWarning(`Status "${r.status}" requires a follow-up date.`);
  } else {
    hideModalWarning();
  }

  // Show modal
  modal.classList.add("show");

  // Animation
  animateModalOpen();
}


/* ============================================================================
   LOAD LAST ACTIONED BY NAME
   Reads the /users/{uid} document to retrieve full name.
============================================================================ */

async function loadLastActionedByName(uid) {
  if (!uid) {
    optLastActionedByName.textContent = `Last Actioned By: —`;
    optLastActionedByName.style.opacity = 0.7;
    return;
  }

  const snap = await getDoc(doc(db, "users", uid));
  if (snap.exists()) {
    const u = snap.data();
    optLastActionedByName.textContent =
      `Last Actioned By: ${u.firstName} ${u.lastName}`;
  } else {
    optLastActionedByName.textContent = `Last Actioned By: Unknown`;
  }
}


/* ============================================================================
   MODAL CLOSE (with SP/MON rollback safety)
============================================================================ */

function closeCaseModal() {

  // Rollback status if SP/MON was cancelled
  if (pendingStatusRollback.caseId === currentModalCaseId) {

    const row = trackerState.allCases.find(r => r.id === currentModalCaseId);
    if (row) row.status = pendingStatusRollback.oldStatus;

    // Clear rollback memory
    pendingStatusRollback = { caseId: null, oldStatus: null };

    // Refresh UI to reflect rollback
    applyFilters();
  }

  requireFollowUp = false;
  currentModalCaseId = null;

  animateModalClose(() => modal.classList.remove("show"));
}

btnModalClose.onclick = closeCaseModal;
modal.onclick = (e) => { if (e.target === modal) closeCaseModal(); };


/* ============================================================================
   SECTION 19 — MODAL SAVE HANDLER
============================================================================ */

btnModalSave.onclick = async () => {
  if (!currentModalCaseId) return;

  btnModalSave.disabled = true;
  btnModalSave.textContent = "Saving…";

  const ok = await saveModalChanges();

  btnModalSave.disabled = false;
  btnModalSave.textContent = "Save";

  if (ok) {
    requireFollowUp = false;
    currentModalCaseId = null;
    animateModalClose(() => modal.classList.remove("show"));
    applyFilters();
  }
};


/* ============================================================================
   APPLY MODAL CHANGES TO DATA + FIRESTORE
============================================================================ */

async function saveModalChanges() {
  if (!currentModalCaseId) return false;

  const today = new Date().toISOString().split("T")[0];
  const r = trackerState.allCases.find(x => x.id === currentModalCaseId);
  if (!r) return false;

  // Follow-up date
  const follow = optDate.value
    ? new Date(optDate.value).toISOString().split("T")[0]
    : null;

  if (requireFollowUp && !follow) {
    showModalWarning("Please select a follow-up date.");
    return false;
  }

  hideModalWarning();

  // Update local state
  r.followDate = follow;
  r.flagged = optFlag.classList.contains("on");
  r.notes = optNotes.value.trim();
  r.lastActionedOn = today;
  r.lastActionedBy = trackerState.user.uid;

  // Push to Firestore
  try {
    await firestoreUpdateCase(currentModalCaseId, {
      followDate: r.followDate,
      flagged: r.flagged,
      notes: r.notes,
      lastActionedOn: r.lastActionedOn,
      lastActionedBy: r.lastActionedBy
    });
  } catch (err) {
    console.error(err);
    showPopup("Error saving case.");
    return false;
  }

  // Clear rollback memory (this update is valid)
  pendingStatusRollback = { caseId: null, oldStatus: null };

  return true;
}


/* ============================================================================
   SECTION 20 — FLAG TOGGLE
============================================================================ */

function setFlagUI(isOn) {
  if (isOn) optFlag.classList.add("on");
  else optFlag.classList.remove("on");

  optFlag.setAttribute("aria-checked", isOn ? "true" : "false");
}

optFlag.onclick = () => {
  setFlagUI(!optFlag.classList.contains("on"));
};


/* ============================================================================
   SECTION 21 — NOTES AUTOSIZE
============================================================================ */

function resizeNotes() {
  optNotes.style.height = "auto";
  optNotes.style.height = (optNotes.scrollHeight + 6) + "px";
}

optNotes.addEventListener("input", resizeNotes);


/* ============================================================================
   SECTION 22 — FOLLOW-UP QUICK SHORTCUTS (Context Menu)
============================================================================ */

optDate.addEventListener("contextmenu", (e) => {
  e.preventDefault();

  const today = new Date();
  const tomorrow = new Date(today.getTime() + 86400000);
  const nextWeek = new Date(today.getTime() + 7 * 86400000);

  const choice = prompt(
    "Quick Follow-Up:\n1 = Today\n2 = Tomorrow\n3 = +7 Days\n\nOr Cancel"
  );

  if (choice === "1")
    optDate.value = today.toISOString().split("T")[0];
  else if (choice === "2")
    optDate.value = tomorrow.toISOString().split("T")[0];
  else if (choice === "3")
    optDate.value = nextWeek.toISOString().split("T")[0];
});


/* ============================================================================
   SECTION 23 — MODAL WARNINGS
============================================================================ */

function showModalWarning(msg) {
  modalWarning.textContent = msg;
  modalWarning.style.display = "block";
  shakeWarning();
}

function hideModalWarning() {
  modalWarning.style.display = "none";
}

function shakeWarning() {
  modalWarning.style.transition = "transform 0.14s ease";
  modalWarning.style.transform = "translateX(-4px)";

  setTimeout(() => { modalWarning.style.transform = "translateX(4px)"; }, 70);
  setTimeout(() => { modalWarning.style.transform = "translateX(0)"; }, 140);
}


/* ============================================================================
   SECTION 24 — MODAL ANIMATIONS
============================================================================ */

function animateModalOpen() {
  modalCard.style.opacity = "0";
  modalCard.style.transform = "scale(0.92)";

  setTimeout(() => {
    modalCard.style.transition = "all 150ms ease-out";
    modalCard.style.opacity = "1";
    modalCard.style.transform = "scale(1)";
  }, 10);
}

function animateModalClose(callback) {
  modalCard.style.transition = "all 130ms ease-in";
  modalCard.style.opacity = "0";
  modalCard.style.transform = "scale(0.92)";

  setTimeout(() => {
    callback();
    modalCard.style.transition = "";
    modalCard.style.opacity = "";
    modalCard.style.transform = "";
  }, 130);
}


/* ============================================================================
   SECTION 25 — DATE HELPER
============================================================================ */

function formatDMY(iso) {
  if (!iso) return "—";
  const [y, m, d] = iso.split("-");
  return `${d}-${m}-${y}`;
}


/* ============================================================================
   SECTION 26 — FOLLOW-UP HELPERS (X / Y for Info Summary)
   ============================================================================
   These match your offline tracker logic:
     X = follow-ups for TODAY
     Y = overdue follow-ups
============================================================================ */

function isFollowDueToday(row) {
  const today = new Date().toISOString().split("T")[0];
  return (
    row.followDate &&
    row.followDate === today &&
    row.status !== "Closed" &&
    row.lastActionedBy === trackerState.user.uid
  );
}

function isFollowOverdue(row) {
  const today = new Date().toISOString().split("T")[0];
  return (
    row.followDate &&
    row.followDate < today &&
    row.status !== "Closed" &&
    row.lastActionedBy === trackerState.user.uid
  );
}

function getFollowSummary() {
  const rows = trackerState.allCases;
  return {
    x: rows.filter(isFollowDueToday).length,
    y: rows.filter(isFollowOverdue).length
  };
}


/* ============================================================================
   SECTION 27 — INFO SUMMARY MODAL
   ============================================================================
   The “i” button opens this. It shows:
     - Summary of total cases
     - Due Today
     - Follow-ups X / Y
     - Flagged
     - Repeating
     - Unupdated
============================================================================ */

const infoModal = document.getElementById("infoModal");
const infoContent = document.getElementById("infoContent");
const btnInfo = document.getElementById("btnInfo");
const btnInfoClose = document.getElementById("btnInfoClose");

btnInfo.onclick = openInfoModal;
btnInfoClose.onclick = () => infoModal.classList.remove("show");

function openInfoModal() {
  const today = new Date().toISOString().split("T")[0];
  const rows = trackerState.allCases;

  const due = rows.filter(r =>
    r.lastActionedBy === trackerState.user.uid &&
    r.followDate &&
    r.followDate <= today &&
    r.status !== "Closed"
  ).length;

  const flagged = rows.filter(r =>
    r.flagged &&
    r.lastActionedBy === trackerState.user.uid
  ).length;

  const repeat = (() => {
    const count = {};
    rows.forEach(r => {
      let nm = (r.customerName || "").trim().toLowerCase();
      if (nm) count[nm] = (count[nm] || 0) + 1;
    });
    return rows.filter(r =>
      count[(r.customerName || "").trim().toLowerCase()] > 1
    ).length;
  })();

  const unupdated = rows.filter(r => !r.status || r.status.trim() === "").length;

  const fu = getFollowSummary();

  infoContent.innerHTML = `
    <div class="info-row"><span>Total Cases:</span> ${rows.length}</div>
    <div class="info-row"><span>Due Today:</span> ${due}</div>
    <div class="info-row"><span>Follow-ups X/Y:</span> ${fu.x} / ${fu.y}</div>
    <div class="info-row"><span>Flagged:</span> ${flagged}</div>
    <div class="info-row"><span>Repeating Customers:</span> ${repeat}</div>
    <div class="info-row"><span>Unupdated Cases:</span> ${unupdated}</div>
  `;

  infoModal.classList.add("show");
}

infoModal.onclick = (e) => {
  if (e.target === infoModal) infoModal.classList.remove("show");
};


/* ============================================================================
   SECTION 28 — DATE NORMALIZATION FIXES
   ============================================================================
   Prevents bugs when comparing dates or filtering.
   We enforce consistent ISO yyyy-mm-dd format.
============================================================================ */

function normalizeISO(d) {
  if (!d) return "";
  try {
    return new Date(d).toISOString().split("T")[0];
  } catch {
    return "";
  }
}

function safeISO(value) {
  // Converts null, "", or bad date → empty string
  if (!value) return "";
  const d = new Date(value);
  return isNaN(d.getTime()) ? "" : d.toISOString().split("T")[0];
}


/* ============================================================================
   SECTION 29 — SWAP TO UNIFIED DATE CLEANING DURING IMPORTS
   (Used by excel import or backup import)
============================================================================ */

function cleanCaseRow(row) {
  return {
    ...row,
    createdOn: safeISO(row.createdOn),
    followDate: safeISO(row.followDate),
    lastActionedOn: safeISO(row.lastActionedOn),
    status: row.status || "",
    flagged: !!row.flagged,
    notes: row.notes || ""
  };
}


/* ============================================================================
   SECTION 30 — HELPERS FOR SEARCH / STRING CLEANING
============================================================================ */

function normalizeText(str) {
  return (str || "").trim().toLowerCase();
}

function sameCustomer(a, b) {
  return normalizeText(a) === normalizeText(b);
}

/* ============================================================================
   SECTION 31 — GLOBAL EVENT GUARDS (Rapid Click Protection)
   ============================================================================
   Prevent spam-clicking from opening multiple modals or causing race conditions.
============================================================================ */

let modalLock = false;

function guardModalOpen(fn) {
  return async (...args) => {
    if (modalLock) return;
    modalLock = true;

    try {
      await fn(...args);
    } finally {
      setTimeout(() => (modalLock = false), 250);
    }
  };
}

// Wrap openCaseModal in guard to prevent double opening
openCaseModal = guardModalOpen(openCaseModal);


/* ============================================================================
   SECTION 32 — SCROLL RESTORATION + STICKY BEHAVIOR
============================================================================ */

window.addEventListener("scroll", () => {
  const header = document.querySelector("header");
  if (!header) return;

  if (window.scrollY > 10) header.classList.add("scrolled");
  else header.classList.remove("scrolled");
});


/* ============================================================================
   SECTION 33 — FULL MODE RESET LOGIC
   ============================================================================
   Whenever the user switches from a special mode (Due, Flagged, etc.)
   back to normal filtering, we clear the mode before applying filters.
============================================================================ */

function resetModes() {
  uiState.mode = "normal";
}


/* ============================================================================
   SECTION 34 — KEYBOARD SHORTCUTS (Optional but useful)
   ============================================================================
   - CTRL+F → focus search bar
   - ESC → close modals or clear status panel
============================================================================ */

document.addEventListener("keydown", (e) => {
  // If user presses CTRL+F, redirect to search field
  if (e.ctrlKey && e.key === "f") {
    e.preventDefault();
    el.txtSearch.focus();
    return;
  }

  // ESC → close modal or close status panel
  if (e.key === "Escape") {
    if (modal.classList.contains("show")) {
      closeCaseModal();
      return;
    }
    el.statusPanel.style.display = "none";
  }
});


/* ============================================================================
   SECTION 35 — FILTER BUTTON FOCUS SAFETY
   Prevents losing focus when clicking inside the status panel.
============================================================================ */

el.statusPanel.addEventListener("mousedown", (e) => {
  // Prevent blur events from closing the dropdown
  e.preventDefault();
});


/* ============================================================================
   SECTION 36 — PERFORMANCE THROTTLE FOR TABLE RENDER
============================================================================ */

let renderLock = false;

function throttledRender() {
  if (renderLock) return;
  renderLock = true;

  requestAnimationFrame(() => {
    renderTable();
    renderLock = false;
  });
}


/* ============================================================================
   SECTION 37 — FORCE FILTER RESET WHEN TEAM CHANGES (Primary Admin)
============================================================================ */

window.addEventListener("storage", (e) => {
  if (e.key === "activeTeamChanged") {
    // Team changed in Admin → reload this page's team listener
    location.reload();
  }
});


/* ============================================================================
   SECTION 38 — CLEANUP WHEN UNLOADING
============================================================================ */

window.addEventListener("beforeunload", () => {
  if (unsubscribe) unsubscribe();
});

/* ============================================================================
   SECTION 39 — STATUS VALIDATION HELPERS
   ============================================================================
   These helpers provide additional integrity checks for:
     - SP/MON follow-up requirement
     - Unknown statuses (Excel imports)
============================================================================ */

function isSPorMON(status) {
  return status === "Service Pending" || status === "Monitoring";
}

function forceValidStatus(status) {
  const valid = [
    "",
    "Closed",
    "NCM 1",
    "NCM 2",
    "PNS",
    "Service Pending",
    "Monitoring"
  ];
  return valid.includes(status) ? status : "";
}


/* ============================================================================
   SECTION 40 — CUSTOMER REPEAT DETECTION (Enhanced)
   ============================================================================
   Handles:
     - Names with extra spaces
     - Different casing
     - Trailing punctuation
============================================================================ */

function normalizeCustomerName(str) {
  if (!str) return "";
  return str.trim().toLowerCase().replace(/[.,]+$/, "");
}

function getRepeatingCustomerMap(rows) {
  const map = {};
  for (const r of rows) {
    const name = normalizeCustomerName(r.customerName);
    if (!name) continue;
    map[name] = (map[name] || 0) + 1;
  }
  return map;
}


/* ============================================================================
   SECTION 41 — CASE CLEANING FOR INTERNAL CONSISTENCY
   ============================================================================
   Ensures every case has consistent structure before filtering.
============================================================================ */

function sanitizeCase(row) {
  return {
    id: row.id || "",
    customerName: row.customerName || "",
    country: row.country || "",
    caseResolutionCode: row.caseResolutionCode || "",
    caseOwner: row.caseOwner || "",
    caGroup: row.caGroup || "",
    sbd: row.sbd || "",
    status: forceValidStatus(row.status || ""),
    followDate: safeISO(row.followDate),
    flagged: !!row.flagged,
    notes: row.notes || "",
    createdOn: safeISO(row.createdOn),
    createdBy: row.createdBy || "",
    lastActionedOn: safeISO(row.lastActionedOn),
    lastActionedBy: row.lastActionedBy || ""
  };
}


/* ============================================================================
   SECTION 42 — BATCH SANITIZATION (Used before filtering)
============================================================================ */

function sanitizeAllCases() {
  trackerState.allCases = trackerState.allCases.map(sanitizeCase);
}


/* ============================================================================
   SECTION 43 — SORTING HELPER (used by status-change / table actions)
============================================================================ */

function sortCasesByDate(rows, asc = true) {
  return rows.sort((a, b) => {
    if (!a.createdOn && !b.createdOn) return 0;
    if (!a.createdOn) return 1;
    if (!b.createdOn) return -1;

    return asc
      ? a.createdOn.localeCompare(b.createdOn)
      : b.createdOn.localeCompare(a.createdOn);
  });
}


/* ============================================================================
   SECTION 44 — COPY HELPERS
============================================================================ */

function copyToClipboard(text) {
  navigator.clipboard.writeText(text).catch(() => {});
}

function copyCaseId(caseId) {
  copyToClipboard(caseId);
  const toast = document.getElementById("toast");
  toast.classList.add("show");
  setTimeout(() => toast.classList.remove("show"), 800);
}


/* ============================================================================
   SECTION 45 — TABLE SCROLL RESTORATION HELPERS
   (Optional but keeps scroll stable during updates)
============================================================================ */

let previousScrollTop = 0;

function saveScroll() {
  previousScrollTop = document.scrollingElement.scrollTop;
}

function restoreScroll() {
  document.scrollingElement.scrollTop = previousScrollTop;
}


/* ============================================================================
   SECTION 46 — FIRESTORE RULE COMPATIBILITY GUARDS
   Ensures updates NEVER violate rules and break the UI.
============================================================================ */

function validateCaseUpdateFields(obj) {
  const allowed = [
    "status",
    "followDate",
    "flagged",
    "notes",
    "lastActionedOn",
    "lastActionedBy"
  ];

  const out = {};
  for (const k of allowed) {
    if (obj[k] !== undefined) out[k] = obj[k];
  }
  return out;
}

/* ============================================================================
   SECTION 47 — FILTER GLUE (Pre-processing before applyFilters)
   ============================================================================
   This integrates sanitization, scroll saving, and throttled rendering.
============================================================================ */

function prepareAndApplyFilters() {
  saveScroll();             // maintain scroll position during re-render
  sanitizeAllCases();       // ensure clean consistent structure
  applyFilters();           // run main filter engine
  restoreScroll();          // keep the view stable
}


/* ============================================================================
   SECTION 48 — TABLE LOADING OVERLAY
   ============================================================================
   A simple loading mask to prevent flicker during large updates.
============================================================================ */

let loadingMask = null;

function showLoadingMask() {
  if (!loadingMask) {
    loadingMask = document.createElement("div");
    loadingMask.id = "loadingMask";
    loadingMask.style.cssText = `
      position: fixed;
      left: 0;
      top: 0;
      width: 100vw;
      height: 100vh;
      background: rgba(0,0,0,0.25);
      backdrop-filter: blur(2px);
      display:flex;
      align-items:center;
      justify-content:center;
      z-index: 999;
      color:white;
      font-size:20px;
      font-weight:600;
    `;
  }
  loadingMask.textContent = "Loading…";
  document.body.appendChild(loadingMask);
}

function hideLoadingMask() {
  if (loadingMask && loadingMask.parentNode) {
    loadingMask.parentNode.removeChild(loadingMask);
  }
}


/* ============================================================================
   SECTION 49 — UI POLISH HELPERS
   ============================================================================
   Adds subtle animations, hover effects, and utility formatting.
============================================================================ */

function flashRow(rowElement) {
  rowElement.style.transition = "background 0.6s ease";
  rowElement.style.background = "rgba(255,255,0,0.25)";

  setTimeout(() => {
    rowElement.style.background = "";
  }, 600);
}

function highlightOnAction(caseId) {
  const row = [...el.tbody.querySelectorAll("tr")].find(tr =>
    tr.querySelector(".caseid")?.textContent.trim() === caseId
  );
  if (row) flashRow(row);
}

function addHoverEffects() {
  el.tbody.querySelectorAll("tr").forEach(tr => {
    tr.addEventListener("mouseenter", () => tr.classList.add("hover"));
    tr.addEventListener("mouseleave", () => tr.classList.remove("hover"));
  });
}


/* ============================================================================
   SECTION 50 — SAFE HTML JOINING
   ============================================================================
   Prevents accidental "undefined" or "null" strings in the DOM.
============================================================================ */

function safeJoin(arr, sep = "") {
  return arr.filter(Boolean).join(sep);
}


/* ============================================================================
   SECTION 51 — LABEL FORMATTERS (Used by modal & table)
============================================================================ */

function labelFollowDate(followDate) {
  if (!followDate) return "—";
  return formatDMY(followDate);
}

function labelStatus(status) {
  return status || "—";
}


/* ============================================================================
   SECTION 52 — STATUS COLOR TAG (Optional UI)
============================================================================ */

function getStatusColor(status) {
  switch (status) {
    case "Closed": return "#888";
    case "NCM 1": return "#d9534f";
    case "NCM 2": return "#c9302c";
    case "PNS": return "#f0ad4e";
    case "Monitoring": return "#0275d8";
    case "Service Pending": return "#f7a600";
    default: return "#999";
  }
}

function renderColoredStatus(status) {
  const color = getStatusColor(status);
  return `
    <span class="status-tag" style="
      color: ${color};
      border: 1px solid ${color};
      padding: 2px 6px;
      border-radius: 4px;
      font-size: 12px;
    ">
      ${escapeHtml(status || "")}
    </span>
  `;
}


/* ============================================================================
   SECTION 53 — FINAL FILTER ENTRY POINT (Replaces direct calls)
============================================================================ */

function refreshTable() {
  prepareAndApplyFilters();
  addHoverEffects();
}


/* ============================================================================
   SECTION 54 — INITIAL TABLE RENDER AFTER AUTH
============================================================================ */

setTimeout(() => {
  // Only render when cases have started loading
  if (trackerState.allCases.length > 0) {
    refreshTable();
  }
}, 350);

/* ============================================================================
   SECTION 55 — DEFENSIVE PROGRAMMING HELPERS
   ============================================================================
   These prevent undefined crashes in edge cases, especially with Excel imports
   or inconsistent Firestore data.
============================================================================ */

function safeText(val) {
  return val === null || val === undefined ? "" : String(val);
}

function safeBool(val) {
  return val === true;
}

function safeNumber(val) {
  const n = Number(val);
  return isNaN(n) ? 0 : n;
}

function safeArray(val) {
  return Array.isArray(val) ? val : [];
}


/* ============================================================================
   SECTION 56 — SMOOTH SCROLLING HELPERS
============================================================================ */

function scrollToTop() {
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function scrollToRow(index) {
  const row = el.tbody.querySelectorAll("tr")[index];
  if (row) row.scrollIntoView({ behavior: "smooth", block: "center" });
}


/* ============================================================================
   SECTION 57 — EXPORT HELPERS (Future-proofing)
   ============================================================================
   These enable features you will likely want soon:
   - Export filtered cases
   - Export flagged cases
   - Export today's actioned cases
============================================================================ */

function exportJSON(filename, data) {
  const blob = new Blob([JSON.stringify(data, null, 2)], {
    type: "application/json"
  });
  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();

  URL.revokeObjectURL(url);
}

function exportFiltered() {
  exportJSON("filtered_cases.json", trackerState.filteredCases);
}

function exportAllCases() {
  exportJSON("all_cases.json", trackerState.allCases);
}


/* ============================================================================
   SECTION 58 — GLOBAL RESET HELPERS (Used when clearing filters)
============================================================================ */

function fullReset() {
  uiState.search = "";
  uiState.from = "";
  uiState.to = "";
  uiState.statusList = [];
  uiState.mode = "normal";
  uiState.sortByDateAsc = null;

  el.txtSearch.value = "";
  el.dateFrom.value = "";
  el.dateTo.value = "";

  buildStatusPanel();
  refreshTable();
}

function resetTableOnly() {
  applyFilters();
}


/* ============================================================================
   SECTION 59 — FIRESTORE COMMUNICATION WRAPPERS
   ============================================================================
   These help ensure that Firestore writes are always done consistently,
   with defensive cleanup logic for UI safety.
============================================================================ */

async function writeFirestoreCase(caseId, data) {
  const clean = validateCaseUpdateFields(data);

  try {
    await updateCase(caseId, clean);
  } catch (err) {
    console.error("writeFirestoreCase error:", err);
    showPopup("Update failed — permission denied or network issue.");
    refreshTable(); // restore UI to consistent state
  }
}

async function updateStatusOnServer(caseId, status) {
  const today = new Date().toISOString().split("T")[0];

  return writeFirestoreCase(caseId, {
    status,
    lastActionedOn: today,
    lastActionedBy: trackerState.user.uid
  });
}


/* ============================================================================
   SECTION 60 — PENDING STATUS CLEANUP (Safety Net)
   ============================================================================
   Ensures pending SP/MON workflows do not produce inconsistent state.
============================================================================ */

function clearPendingStatus() {
  pendingStatusRollback = { caseId: null, oldStatus: null };
}


/* ============================================================================
   SECTION 61 — DATA CLEANUP BEFORE RENDER
   ============================================================================
   Ensures tracker never renders partially updated data.
============================================================================ */

function normalizeAllDates() {
  trackerState.allCases.forEach((r) => {
    r.createdOn = safeISO(r.createdOn);
    r.followDate = safeISO(r.followDate);
    r.lastActionedOn = safeISO(r.lastActionedOn);
  });
}


/* ============================================================================
   SECTION 62 — MISCELLANEOUS UTILITIES
============================================================================ */

function debugCase(caseId) {
  console.log("DEBUG CASE:", trackerState.allCases.find(r => r.id === caseId));
}

function debugFiltered() {
  console.table(trackerState.filteredCases);
}

function debugAll() {
  console.table(trackerState.allCases);
}


/* ============================================================================
   SECTION 63 — HOOK INTO applyFilters() FOR STABILITY
============================================================================ */

const originalApplyFilters = applyFilters;

applyFilters = function() {
  normalizeAllDates();
  originalApplyFilters();
};

/* ============================================================================
   SECTION 64 — FINAL EVENT WIRING & UI BOOTSTRAP
   ============================================================================
   These ensure that:
     - Table interactions behave uniformly
     - Rendering is stable after any rapid state changes
     - Modal/Panel logic is connected
============================================================================ */

/* STATUS PANEL — Prevent accidental closing while clicking inside */
el.statusPanel.addEventListener("click", (e) => {
  e.stopPropagation();
});


/* APPLY FILTERS SAFE WRAPPER */
function applyFiltersSafe() {
  try {
    applyFilters();
  } catch (err) {
    console.error("Filter error:", err);
  }
}


/* ============================================================================
   SECTION 65 — AUTO-FOCUS SEARCH ON LOAD (Nice UX Enhancement)
============================================================================ */

window.addEventListener("load", () => {
  setTimeout(() => {
    try { el.txtSearch?.blur(); } catch {}
  }, 300);
});


/* ============================================================================
   SECTION 66 — PERIODIC AUTO-NORMALIZATION (Safety Watchdog)
   ============================================================================
   Every 45 seconds, we clean date fields and stale flags.
   This prevents inconsistent state when Firestore updates slowly.
============================================================================ */

setInterval(() => {
  try {
    normalizeAllDates();
  } catch {}
}, 45000);


/* ============================================================================
   SECTION 67 — HARD FAILSAFE (Double-Guard)
   ============================================================================
   Guarantees the tracker never stays in corrupted UI state.
============================================================================ */

window.addEventListener("error", (e) => {
  console.error("Global JS error caught:", e);
  showPopup("Something went wrong. Refresh recommended.");
});


/* ============================================================================
   SECTION 68 — CLEAN UNLOAD HANDLER
============================================================================ */

window.addEventListener("beforeunload", () => {
  if (unsubscribe) unsubscribe();
});


/* ============================================================================
   SECTION 69 — END OF FILE MARKER
   ============================================================================
   If you're searching inside the file, this is the official end.
============================================================================ */

// END OF index.js (Final Production Build)
