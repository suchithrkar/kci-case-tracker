/* =======================================================================
   INDEX.JS — COMPLETE CLEAN REBUILD (FINAL VERSION)
   ======================================================================= */

/* ================================
   FIREBASE IMPORTS
   ================================ */
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

/* ================================
   APP IMPORTS
   ================================ */
import {
  isPrimary,
  isSecondary,
  isGeneral,
  getCurrentTrackerTeam,
  toggleTheme
} from "./js/userProfile.js";

import { listenToTeamCases, updateCase } from "./js/firestore-api.js";
import { showPopup } from "./js/utils.js";

/* ================================
   DOM REFERENCES
   ================================ */
const el = {
  userFullName: document.getElementById("userFullName"),
  btnTheme: document.getElementById("btnTheme"),
  btnAdmin: document.getElementById("btnAdmin"),
  btnLogout: document.getElementById("btnLogout"),
};

/* ================================
   TRACKER STATE
   ================================ */
export const trackerState = {
  user: null,
  teamId: null,
  allCases: [],
  filteredCases: []
};

/* ======================================================================
   AUTH STATE
   ====================================================================== */
onAuthStateChanged(auth, async (user) => {
  if (!user) {
    location.href = "login.html";
    return;
  }

  const userSnap = await getDoc(doc(db, "users", user.uid));
  if (!userSnap.exists()) {
    location.href = "login.html";
    return;
  }

  const data = userSnap.data();

  if (data.status !== "approved") {
    alert("Account pending approval.");
    auth.signOut();
    return;
  }

  trackerState.user = { uid: user.uid, ...data };

  /* Header setup */
  el.userFullName.textContent = `${data.firstName} ${data.lastName}`;
  document.documentElement.dataset.theme = data.theme || "dark";
  el.btnTheme.textContent = data.theme === "light" ? "🌙" : "☀️";
  el.btnTheme.onclick = () => toggleTheme(trackerState.user);

  if (isPrimary(data) || isSecondary(data)) {
    el.btnAdmin.style.display = "inline-block";
    el.btnAdmin.onclick = () => (location.href = "admin.html");
  } else {
    el.btnAdmin.style.display = "none";
  }

  el.btnLogout.onclick = () => auth.signOut().then(() => (location.href = "login.html"));

  /* Determine team */
  const tid = getCurrentTrackerTeam(trackerState.user);
  trackerState.teamId = tid;

  /* Start listening */
  setupRealtimeCases(tid);
});

/* ======================================================================
   REAL-TIME CASE LISTENER
   ====================================================================== */
function setupRealtimeCases(teamId) {
  listenToTeamCases(teamId, (cases) => {
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

    applyFilters();
  });
}

/* ======================================================================
   FILTER ENGINE (UNCHANGED FROM YOUR VERSION)
   ====================================================================== */

const txtSearch   = document.getElementById("txtSearch");
const dateFrom    = document.getElementById("dateFrom");
const dateTo      = document.getElementById("dateTo");
const statusBox   = document.getElementById("statusBox");
const statusLabel = document.getElementById("statusLabel");
const statusPanel = document.getElementById("statusPanel");
const badgeDue    = document.getElementById("badgeDue");
const badgeFlag   = document.getElementById("badgeFlag");

const filtersContainer = document.getElementById("filtersContainer");

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
  primaryLocks: {},
  mode: "normal",
  sortByDateAsc: null
};

function passPrimaryFilters(row) {
  const p = uiState.primaries;
  for (const key in p) {
    if (p[key].length === 0) continue;
    if (!p[key].includes(row[key])) return false;
  }
  return true;
}

export function applyFilters() {
  let rows = [...trackerState.allCases];
  const today = new Date().toISOString().split("T")[0];

  /* SEARCH */
  if (uiState.search.trim().length > 0) {
    const q = uiState.search.toLowerCase();
    rows = rows.filter(r =>
      (r.id || "").toLowerCase().includes(q) ||
      (r.customerName || "").toLowerCase().includes(q) ||
      (r.country || "").toLowerCase().includes(q) ||
      (r.caseResolutionCode || "").toLowerCase().includes(q) ||
      (r.caseOwner || "").toLowerCase().includes(q) ||
      (r.caGroup || "").toLowerCase().includes(q) ||
      (r.sbd || "").toLowerCase().includes(q)
    );
  }

  /* STATUS FILTER */
  if (uiState.statusList.length > 0) {
    rows = rows.filter(r => r.status && uiState.statusList.includes(r.status));
  }

  /* DATE RANGE */
  if (uiState.from) rows = rows.filter(r => r.createdOn >= uiState.from);
  if (uiState.to)   rows = rows.filter(r => r.createdOn <= uiState.to);

  /* PRIMARY FILTERS */
  rows = rows.filter(passPrimaryFilters);

  /* MODE FILTERS */
  if (uiState.mode === "due") {
    rows = rows.filter(r => r.followDate && r.followDate <= today && r.status !== "Closed");
  }
  if (uiState.mode === "flagged") {
    rows = rows.filter(r => r.flagged);
  }

  /* SORT */
  if (uiState.sortByDateAsc !== null) {
    rows.sort((a, b) => uiState.sortByDateAsc
      ? a.createdOn.localeCompare(b.createdOn)
      : b.createdOn.localeCompare(a.createdOn));
  }

  trackerState.filteredCases = rows;
  renderTable();
  updateBadges();
}

/* ======================================================================
   BADGES
   ====================================================================== */
function updateBadges() {
  const today = new Date().toISOString().split("T")[0];

  badgeDue.textContent = trackerState.allCases.filter(r =>
    r.followDate && r.followDate <= today && r.status !== "Closed"
  ).length;

  badgeFlag.textContent = trackerState.allCases.filter(r => r.flagged).length;
}

/* ======================================================================
   TABLE RENDERING
   ====================================================================== */
const tbody = document.getElementById("tbody");

export function renderTable() {
  const rows = trackerState.filteredCases;
  const today = new Date().toISOString().split("T")[0];
  tbody.innerHTML = "";

  rows.forEach((r, index) => {
    const tr = document.createElement("tr");

    if (r.followDate && r.followDate <= today && r.status !== "Closed") tr.classList.add("due-today");
    else if (r.flagged) tr.classList.add("flagged");
    else if (r.notes) tr.classList.add("has-notes");

    tr.innerHTML = `
      <td>${index + 1}</td>
      <td class="caseid" data-id="${r.id}">${escapeHtml(r.id)}</td>
      <td>${escapeHtml(r.customerName)}</td>
      <td>${escapeHtml(r.country)}</td>
      <td>${escapeHtml(r.caseResolutionCode)}</td>
      <td>${escapeHtml(r.caseOwner)}</td>
      <td>${escapeHtml(r.caGroup)}</td>
      <td>${escapeHtml(r.sbd)}</td>
      <td>${renderStatusSelect(r)}</td>
      <td><span class="gear" data-action="opts" data-id="${r.id}">⚙️</span></td>
    `;

    tbody.appendChild(tr);
  });
}

function escapeHtml(s) {
  return String(s || "").replace(/[&<>"']/g, c => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;",
    '"': "&quot;", "'": "&#39;"
  }[c]));
}

function renderStatusSelect(row) {
  const statuses = ["", "Closed", "NCM 1", "NCM 2", "PNS", "Service Pending", "Monitoring"];
  return `
    <select class="status-select" data-action="status" data-id="${row.id}">
      ${statuses.map(s => `<option ${s === row.status ? "selected" : ""}>${s}</option>`).join("")}
    </select>
  `;
}

/* ======================================================================
   STATUS CHANGE
   ====================================================================== */
tbody.addEventListener("change", (e) => {
  const sel = e.target.closest("select[data-action='status']");
  if (!sel) return;

  const cid = sel.dataset.id;
  const newStatus = sel.value;
  handleStatusChange(cid, newStatus);
});

function handleStatusChange(caseId, newStatus) {
  const today = new Date().toISOString().split("T")[0];
  const row = trackerState.allCases.find(r => r.id === caseId);
  if (!row) return;

  const needsFollow = newStatus === "Service Pending" || newStatus === "Monitoring";

  row.status = newStatus;
  row.lastActionedOn = today;
  row.lastActionedBy = trackerState.user.uid;

  if (needsFollow) {
    openCaseModal(caseId, true);
    return;
  }

  updateCase(caseId, {
    status: newStatus,
    lastActionedOn: today,
    lastActionedBy: trackerState.user.uid
  });

  applyFilters();
}

/* ======================================================================
   ROW EVENTS (Gear + Copy)
   ====================================================================== */
tbody.addEventListener("click", (e) => {
  const gear = e.target.closest("[data-action='opts']");
  if (!gear) return;

  openCaseModal(gear.dataset.id);
});

tbody.addEventListener("dblclick", (e) => {
  const cell = e.target.closest(".caseid");
  if (!cell) return;

  navigator.clipboard.writeText(cell.textContent.trim());
  const toast = document.getElementById("toast");
  toast.classList.add("show");
  setTimeout(() => toast.classList.remove("show"), 800);
});

/* ======================================================================
   CASE MODAL
   ====================================================================== */
const modal = document.getElementById("modal");
const modalTitle = document.getElementById("modalTitle");
const modalWarning = document.getElementById("modalWarning");
const optDate = document.getElementById("optDate");
const optFlag = document.getElementById("optFlag");
const optNotes = document.getElementById("optNotes");
const optLastActioned = document.getElementById("optLastActioned");
const btnModalClose = document.getElementById("btnModalClose");
const btnModalSave = document.getElementById("btnModalSave");

let currentModalCaseId = null;
let requireFollowUp = false;

export function openCaseModal(caseId, enforce = false) {
  requireFollowUp = enforce;
  const r = trackerState.allCases.find(x => x.id === caseId);
  if (!r) return;

  currentModalCaseId = caseId;
  modalTitle.textContent = `Case Options — ${caseId}`;

  optLastActioned.textContent = r.lastActionedOn ? formatDMY(r.lastActionedOn) : "—";
  optDate.value = r.followDate || "";
  optNotes.value = r.notes || "";

  setFlagUI(r.flagged);

  if (requireFollowUp && !r.followDate) showModalWarning(`Status "${r.status}" needs follow-up date`);
  else hideModalWarning();

  modal.classList.add("show");
}

function setFlagUI(on) {
  optFlag.classList.toggle("on", on);
  optFlag.setAttribute("aria-checked", on ? "true" : "false");
}
optFlag.onclick = () => setFlagUI(!optFlag.classList.contains("on"));

function closeModal() {
  modal.classList.remove("show");
  currentModalCaseId = null;
  requireFollowUp = false;
}
btnModalClose.onclick = closeModal;
modal.onclick = (e) => { if (e.target === modal) closeModal(); };

function showModalWarning(msg) {
  modalWarning.style.display = "block";
  modalWarning.textContent = msg;
}
function hideModalWarning() {
  modalWarning.style.display = "none";
}

function formatDMY(iso) {
  const [y, m, d] = iso.split("-");
  return `${d}-${m}-${y}`;
}

btnModalSave.onclick = async () => {
  if (!currentModalCaseId) return;

  const caseId = currentModalCaseId;
  const row = trackerState.allCases.find(r => r.id === caseId);

  const follow = optDate.value ? new Date(optDate.value).toISOString().split("T")[0] : null;

  if (requireFollowUp && !follow) {
    showModalWarning("Please select follow-up date");
    return;
  }

  hideModalWarning();

  const today = new Date().toISOString().split("T")[0];
  row.followDate = follow;
  row.flagged = optFlag.classList.contains("on");
  row.notes = optNotes.value.trim();
  row.lastActionedOn = today;
  row.lastActionedBy = trackerState.user.uid;

  await updateCase(caseId, {
    followDate: row.followDate,
    flagged: row.flagged,
    notes: row.notes,
    lastActionedOn: today,
    lastActionedBy: trackerState.user.uid
  });

  applyFilters();
  closeModal();
};

/* ======================================================================
   STATUS DROPDOWN MULTI-SELECT
   ====================================================================== */

function buildStatusPanel() {
  const statuses = ["Closed", "NCM 1", "NCM 2", "PNS", "Service Pending", "Monitoring"];

  statusPanel.innerHTML = statuses.map(s => `
    <label>
      <input type="checkbox" data-status="${s}" ${uiState.statusList.includes(s) ? "checked" : ""} />
      ${s}
    </label>
  `).join("");

  updateStatusLabel();
}

function updateStatusLabel() {
  if (uiState.statusList.length === 0) statusLabel.textContent = "All Statuses";
  else statusLabel.textContent = uiState.statusList.join(", ");
}

statusBox.onclick = (e) => {
  if (!e.target.closest("input"))
    statusPanel.style.display = statusPanel.style.display === "block" ? "none" : "block";
};

document.addEventListener("click", (e) => {
  if (!statusBox.contains(e.target)) statusPanel.style.display = "none";
});

statusPanel.onchange = (e) => {
  const c = e.target.closest("input[type=checkbox]");
  if (!c) return;

  const set = new Set(uiState.statusList);
  c.checked ? set.add(c.dataset.status) : set.delete(c.dataset.status);

  uiState.statusList = [...set];
  updateStatusLabel();
  applyFilters();
};

/* ======================================================================
   APPLY & CLEAR BUTTONS
   ====================================================================== */
document.getElementById("btnApply").onclick = applyFilters;

document.getElementById("btnClear").onclick = () => {
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
};

/* ======================================================================
   MODES
   ====================================================================== */
document.getElementById("btnDueToday").onclick = () => { uiState.mode = "due"; applyFilters(); };
document.getElementById("btnFlagged").onclick = () => { uiState.mode = "flagged"; applyFilters(); };
document.getElementById("btnRepeating").onclick = () => { uiState.mode = "repeat"; applyFilters(); };
document.getElementById("btnUnupdated").onclick = () => { uiState.mode = "unupdated"; applyFilters(); };

/* ======================================================================
   SORT BUTTON
   ====================================================================== */
document.getElementById("btnSortDate").onclick = () => {
  uiState.sortByDateAsc =
    uiState.sortByDateAsc === null ? false : !uiState.sortByDateAsc;
  applyFilters();
};

/* ======================================================================
   INFO MODAL (SUMMARY)
   ====================================================================== */
document.getElementById("btnInfo").onclick = () => computeAndShowInfo();

const infoModal = document.getElementById("infoModal");
const infoModalBody = document.getElementById("infoModalBody");
document.getElementById("btnInfoClose").onclick = () => infoModal.classList.remove("show");
document.getElementById("btnInfoOk").onclick = () => infoModal.classList.remove("show");
infoModal.onclick = (e) => { if (e.target === infoModal) infoModal.classList.remove("show"); };

function computeAndShowInfo() {
  const uid = trackerState.user.uid;
  const today = new Date().toISOString().split("T")[0];

  const rows = trackerState.allCases.filter(r =>
    r.lastActionedBy === uid &&
    r.lastActionedOn === today
  );

  const closed = rows.filter(r => r.status === "Closed");
  const met = closed.filter(r => (r.sbd || "").toLowerCase() === "met").length;
  const notMet = closed.filter(r => (r.sbd || "").toLowerCase() === "not met").length;

  const pct = (n) => closed.length ? Math.round((n / closed.length) * 100) : 0;

  const statusCounts = {
    "Service Pending": 0,
    "Monitoring": 0,
    "NCM 1": 0,
    "NCM 2": 0,
    "PNS": 0
  };

  rows.forEach(r => {
    if (statusCounts[r.status] != null) statusCounts[r.status]++;
  });

  const totalActioned = closed.length +
    statusCounts["Service Pending"] +
    statusCounts["Monitoring"] +
    statusCounts["NCM 1"] +
    statusCounts["NCM 2"] +
    statusCounts["PNS"];

  infoModalBody.textContent =
`Total Cases Closed Today: ${closed.length}
Met: ${met} (${pct(met)}%)
Not Met: ${notMet} (${pct(notMet)}%)

Service Pending: ${statusCounts["Service Pending"]}
Monitoring: ${statusCounts["Monitoring"]}
NCM 1: ${statusCounts["NCM 1"]}
NCM 2: ${statusCounts["NCM 2"]}
PNS: ${statusCounts["PNS"]}

Total Actioned Cases Today: ${totalActioned}`;

  infoModal.classList.add("show");
}

/* ======================================================================
   INITIALIZE UI
   ====================================================================== */
buildStatusPanel();
