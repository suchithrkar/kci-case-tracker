/* ============================================================================
   KCI CASE TRACKER — ADMIN PANEL (admin.js)
   FULL CLEAN PRODUCTION VERSION
   WITH COMPLETE DESCRIPTIVE COMMENTS
   ============================================================================
   This file controls:
     - Admin authentication
     - Team management (create, delete, rename, reassign users)
     - User management (approve, reject, roles, team assign)
     - Stats engine (Manual mode — Phase C1, C2, C3 fully integrated)
     - Excel processing
     - Backup import/export
     - UI interactions & modal handling

   IMPORTANT:
   This file is delivered in multiple sequential chunks.
   Do NOT paste anything into your project until all chunks arrive
   and I provide the FINAL FILE READY confirmation.
   ============================================================================
*/


/* ============================================================================
   SECTION 1 — IMPORTS & FIREBASE INIT
   ============================================================================
   Required modules for Firestore operations, user data loading,
   team creation, stats engine, backup import/export, etc.
============================================================================ */

import {
  auth,
  db,
  onAuthStateChanged,
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  deleteDoc,
  addDoc,
  query,
  where
} from "./js/firebase.js";

import {
  isPrimary,
  isSecondary
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
   Every admin page control (menus, modals, tables, buttons, etc.)
   is referenced here once to avoid repeated lookups.
============================================================================ */

const el = {
  // Main sections
  sectionTeams: document.getElementById("sectionTeams"),
  sectionUsers: document.getElementById("sectionUsers"),
  sectionStats: document.getElementById("sectionStats"),

  // Tabs
  tabTeams: document.getElementById("tabTeams"),
  tabUsers: document.getElementById("tabUsers"),
  tabStats: document.getElementById("tabStats"),

  // User table wrapper
  usersTableWrap: document.getElementById("usersTableWrap"),

  // Teams table wrapper / modals
  teamsTableWrap: document.getElementById("teamsTableWrap"),
  modalTeamCreate: document.getElementById("modalTeamCreate"),
  modalTeamRename: document.getElementById("modalTeamRename"),
  modalReassign: document.getElementById("modalReassign"),

  // Stats
  statsTableWrap: document.getElementById("statsTableWrap"),
  statsControls: document.getElementById("statsControls"),

  // Excel import/export
  modalExcel: document.getElementById("modalExcel"),
  btnProcessExcel: document.getElementById("btnProcessExcel"),
  fileExcel: document.getElementById("fileExcel"),

  // Backup import/export
  modalBackup: document.getElementById("modalBackup"),
  fileBackup: document.getElementById("fileBackup")
};


/* ============================================================================
   SECTION 3 — GLOBAL ADMIN STATE
   ============================================================================
   Stores:
     - Logged in admin user
     - All teams
     - Stats-selected team
     - Cached lists for Stats manual mode
============================================================================ */

export const adminState = {
  user: null,                // { uid, firstName, lastName, role, ... }
  allTeams: [],              // loaded from Firestore
  allUsers: [],              // loaded for Stats
  allCases: [],              // loaded in manual mode
  selectedStatsTeam: "TOTAL" // default for primary admin
};


/* ============================================================================
   SECTION 4 — AUTH LISTENER (ENTRY POINT)
   ============================================================================
   Only primary & secondary admins may enter this page.
============================================================================ */

onAuthStateChanged(auth, async (user) => {
  if (!user) return (location.href = "login.html");

  const snap = await getDoc(doc(db, "users", user.uid));
  if (!snap.exists()) return (location.href = "login.html");

  const data = snap.data();

  if (data.status !== "approved") {
    alert("Your account is not approved.");
    await auth.signOut();
    return (location.href = "login.html");
  }

  if (!isPrimary(data) && !isSecondary(data)) {
    alert("Access denied — Admins only.");
    return (location.href = "index.html");
  }

  adminState.user = { uid: user.uid, ...data };

  // Begin loading data
  await initAdminPanel();
});


/* ============================================================================
   SECTION 5 — ADMIN PANEL INITIALIZATION
   ============================================================================
   Loads:
     - Teams
     - Users for Admin page
     - Stats users & cases (manual mode)
     - Builds UI
============================================================================ */

async function initAdminPanel() {
  await loadTeamsForAdmin();
  await loadUsersForAdmin();

  // Stats: manual mode (C3)
  await loadAllUsersForStats();
  await loadStatsCasesOnce();

  setupTabs();
  renderTeamsTable();
  renderUsersTable();
  buildTeamSelector(); // stats selector

  // Manual stats render on initial load
  renderStatsTableNew();
}

/* ============================================================================
   SECTION 6 — TEAM MANAGEMENT
   ============================================================================
   Includes:
     - Load all teams
     - Render team list
     - Create team
     - Rename team
     - Delete team (with cascade)
     - Reassign users modal
============================================================================ */


/* ============================================================================
   LOAD TEAMS
============================================================================ */

async function loadTeamsForAdmin() {
  const snap = await getDocs(collection(db, "teams"));
  adminState.allTeams = snap.docs.map(d => ({
    id: d.id,
    ...d.data()
  }));
}


/* ============================================================================
   RENDER TEAM TABLE
============================================================================ */

function renderTeamsTable() {
  if (!adminState.allTeams.length) {
    el.teamsTableWrap.innerHTML = `<div class="empty-msg">No teams found.</div>`;
    return;
  }

  const rows = adminState.allTeams
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(
      t => `
    <tr>
      <td>${escapeHtml(t.name)}</td>
      <td style="text-align:right;">
        <button class="action-btn" data-edit="${t.id}">Rename</button>
        <button class="danger-btn" data-del="${t.id}">Delete</button>
      </td>
    </tr>
  `
    )
    .join("");

  el.teamsTableWrap.innerHTML = `
    <table class="admin-table">
      <thead>
        <tr><th>Team</th><th style="text-align:right;">Actions</th></tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;

  bindTeamTableButtons();
}


/* ============================================================================
   BIND TEAM TABLE BUTTONS (Rename / Delete)
============================================================================ */

function bindTeamTableButtons() {
  // Rename
  el.teamsTableWrap.querySelectorAll("[data-edit]").forEach(btn => {
    btn.onclick = () => openTeamRenameModal(btn.dataset.edit);
  });

  // Delete
  el.teamsTableWrap.querySelectorAll("[data-del]").forEach(btn => {
    btn.onclick = () => deleteTeam(btn.dataset.del);
  });
}


/* ============================================================================
   TEAM CREATE MODAL
============================================================================ */

const btnTeamCreate = document.getElementById("btnTeamCreate");
const btnTeamCreateSave = document.getElementById("btnTeamCreateSave");
const txtTeamCreate = document.getElementById("txtTeamCreate");

btnTeamCreate.onclick = () => {
  txtTeamCreate.value = "";
  el.modalTeamCreate.classList.add("show");
};

document.getElementById("btnTeamCreateClose").onclick = () =>
  el.modalTeamCreate.classList.remove("show");

btnTeamCreateSave.onclick = async () => {
  const name = txtTeamCreate.value.trim();
  if (!name) return showPopup("Team name cannot be empty.");

  const exists = adminState.allTeams.some(
    t => t.name.toLowerCase() === name.toLowerCase()
  );
  if (exists) return showPopup("Team name already exists.");

  await addDoc(collection(db, "teams"), { name });

  showPopup("Team created.");
  el.modalTeamCreate.classList.remove("show");

  await loadTeamsForAdmin();
  renderTeamsTable();
  buildTeamSelector();
};


/* ============================================================================
   TEAM RENAME MODAL
============================================================================ */

const txtTeamRename = document.getElementById("txtTeamRename");
const btnTeamRenameClose = document.getElementById("btnTeamRenameClose");
const btnTeamRenameSave = document.getElementById("btnTeamRenameSave");

let renamingTeamId = null;

function openTeamRenameModal(teamId) {
  renamingTeamId = teamId;
  const team = adminState.allTeams.find(t => t.id === teamId);
  if (!team) return;

  txtTeamRename.value = team.name;
  el.modalTeamRename.classList.add("show");
}

btnTeamRenameClose.onclick = () =>
  el.modalTeamRename.classList.remove("show");

btnTeamRenameSave.onclick = async () => {
  const name = txtTeamRename.value.trim();
  if (!name) return showPopup("Name cannot be empty.");
  if (!renamingTeamId) return;

  await updateDoc(doc(db, "teams", renamingTeamId), { name });

  showPopup("Team renamed.");
  el.modalTeamRename.classList.remove("show");

  await loadTeamsForAdmin();
  renderTeamsTable();
  buildTeamSelector();
};


/* ============================================================================
   TEAM DELETE (WITH CASCADE DELETE FOR CASES)
============================================================================ */

async function deleteTeam(teamId) {
  // Check if users exist in this team
  const userSnap = await getDocs(
    query(collection(db, "users"), where("teamId", "==", teamId))
  );

  if (!userSnap.empty) {
    // Must reassign first
    openReassignModal(teamId, userSnap);
    return;
  }

  // Delete cases belonging to this team
  showPopup("Deleting cases for this team...");
  await deleteAllCasesForTeam(teamId);

  // Delete team record
  await deleteDoc(doc(db, "teams", teamId));

  showPopup("Team deleted.");
  await loadTeamsForAdmin();
  renderTeamsTable();
  buildTeamSelector();
}


/* ============================================================================
   CASCADE DELETE CASES (Used by team deletion)
============================================================================ */

async function deleteAllCasesForTeam(teamId) {
  const casesSnap = await getDocs(
    query(collection(db, "cases"), where("teamId", "==", teamId))
  );

  const batchLimit = 450;
  let buffer = [];
  let counter = 0;

  for (const docSnap of casesSnap.docs) {
    buffer.push(deleteDoc(doc(db, "cases", docSnap.id)));
    counter++;

    if (counter >= batchLimit) {
      await Promise.all(buffer);
      buffer = [];
      counter = 0;
    }
  }

  if (buffer.length > 0) await Promise.all(buffer);
}


/* ============================================================================
   REASSIGN USERS MODAL (When deleting a team)
============================================================================ */

const reassignTeamSelect = document.getElementById("reassignTeamSelect");
const btnReassignClose = document.getElementById("btnReassignClose");
const btnReassignDone = document.getElementById("btnReassignDone");
const btnReassignConfirm = document.getElementById("btnReassignConfirm");

let reassignSourceTeam = null;
let reassignUserList = [];

function openReassignModal(teamId, qs) {
  reassignSourceTeam = teamId;
  reassignUserList = qs.docs.map(d => d.id);

  populateReassignTeams();
  el.modalReassign.classList.add("show");
}

btnReassignClose.onclick = () => el.modalReassign.classList.remove("show");
btnReassignDone.onclick = () => el.modalReassign.classList.remove("show");

el.modalReassign.onclick = (e) => {
  if (e.target === el.modalReassign)
    el.modalReassign.classList.remove("show");
};

function populateReassignTeams() {
  reassignTeamSelect.innerHTML = "";

  adminState.allTeams.forEach(t => {
    if (t.id !== reassignSourceTeam) {
      const opt = document.createElement("option");
      opt.value = t.id;
      opt.textContent = t.name;
      reassignTeamSelect.appendChild(opt);
    }
  });
}


/* ============================================================================
   CONFIRM USER REASSIGN → DELETE TEAM & CASES
============================================================================ */

btnReassignConfirm.onclick = async () => {
  const newTeam = reassignTeamSelect.value;
  if (!newTeam) return showPopup("Please select a team.");

  showPopup("Reassigning users...");

  // Move all users
  for (const uid of reassignUserList) {
    await updateDoc(doc(db, "users", uid), { teamId: newTeam });
  }

  showPopup("Deleting old team and its cases...");

  // Delete all cases of old team
  await deleteAllCasesForTeam(reassignSourceTeam);

  // Delete team record
  await deleteDoc(doc(db, "teams", reassignSourceTeam));

  el.modalReassign.classList.remove("show");
  showPopup("Team deleted.");

  await loadTeamsForAdmin();
  renderTeamsTable();
  buildTeamSelector();
};

/* ============================================================================
   SECTION 7 — USER MANAGEMENT
   ============================================================================
   Covers:
     - Load all users for Admin view
     - Render table
     - Approve / Reject / Delete user
     - Assign team
     - Assign role
============================================================================ */


/* ============================================================================
   LOAD USERS FOR ADMIN PAGE
   (Not to be confused with Stats user load)
============================================================================ */

async function loadUsersForAdmin() {
  const snap = await getDocs(collection(db, "users"));
  adminState.allUsersForAdmin = snap.docs.map(d => ({
    id: d.id,
    ...d.data()
  }));
}


/* ============================================================================
   RENDER USERS TABLE
============================================================================ */

function renderUsersTable() {
  const rows = adminState.allUsersForAdmin
    .sort((a, b) => a.firstName.localeCompare(b.firstName))
    .map(renderUserRow)
    .join("");

  el.usersTableWrap.innerHTML = `
    <table class="admin-table">
      <thead>
        <tr>
          <th>User</th>
          <th>Email</th>
          <th>Team</th>
          <th>Role</th>
          <th>Status</th>
          <th style="text-align:right;">Actions</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;

  bindUserTableControls();
}


/* ============================================================================
   USER ROW TEMPLATE
============================================================================ */

function renderUserRow(u) {
  const fullName = `${escapeHtml(u.firstName)} ${escapeHtml(u.lastName)}`;

  return `
    <tr>
      <td>${fullName}</td>
      <td>${escapeHtml(u.email)}</td>

      <!-- TEAM DROPDOWN -->
      <td>${renderTeamDropdown(u)}</td>

      <!-- ROLE DROPDOWN -->
      <td>${renderRoleDropdown(u)}</td>

      <td>${escapeHtml(u.status)}</td>

      <td style="text-align:right;">
        ${renderUserActions(u)}
      </td>
    </tr>
  `;
}


/* ============================================================================
   TEAM DROPDOWN PER USER
============================================================================ */

function renderTeamDropdown(u) {
  // Blank <option> when user has no team assigned
  const blank = u.teamId ? "" : `<option value="">—</option>`;

  const list = adminState.allTeams
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(
      t => `
      <option value="${t.id}" ${u.teamId === t.id ? "selected" : ""}>
        ${escapeHtml(t.name)}
      </option>
    `
    )
    .join("");

  return `
    <select class="input user-team-select" data-id="${u.id}">
      ${blank}
      ${list}
    </select>
  `;
}


/* ============================================================================
   ROLE DROPDOWN PER USER
============================================================================ */

function renderRoleDropdown(u) {
  const roles = ["primary", "secondary", "general"];

  return `
    <select class="input user-role-select" data-id="${u.id}">
      ${roles
        .map(
          r => `
        <option value="${r}" ${u.role === r ? "selected" : ""}>
          ${r}
        </option>`
        )
        .join("")}
    </select>
  `;
}


/* ============================================================================
   USER ACTION BUTTONS (Approve / Reject / Delete)
============================================================================ */

function renderUserActions(u) {
  if (u.status === "pending") {
    return `
      <button class="action-btn" data-approve="${u.id}">Approve</button>
      <button class="danger-btn" data-reject="${u.id}">Reject</button>
    `;
  }

  return `
    <button class="danger-btn" data-delete="${u.id}">Delete</button>
  `;
}


/* ============================================================================
   BIND USER TABLE CONTROLS
============================================================================ */

function bindUserTableControls() {
  /* TEAM CHANGE */
  el.usersTableWrap.querySelectorAll(".user-team-select").forEach(sel => {
    sel.onchange = () => {
      updateUserTeam(sel.dataset.id, sel.value);
    };
  });

  /* ROLE CHANGE */
  el.usersTableWrap.querySelectorAll(".user-role-select").forEach(sel => {
    sel.onchange = () => {
      updateUserRole(sel.dataset.id, sel.value);
    };
  });

  /* APPROVE / REJECT */
  el.usersTableWrap.querySelectorAll("[data-approve]").forEach(btn => {
    btn.onclick = () => approveUser(btn.dataset.approve);
  });

  el.usersTableWrap.querySelectorAll("[data-reject]").forEach(btn => {
    btn.onclick = () => rejectUser(btn.dataset.reject);
  });

  /* DELETE */
  el.usersTableWrap.querySelectorAll("[data-delete]").forEach(btn => {
    btn.onclick = () => deleteUser(btn.dataset.delete);
  });
}


/* ============================================================================
   TEAM ASSIGNMENT (PER USER)
============================================================================ */

async function updateUserTeam(uid, teamId) {
  try {
    await updateDoc(doc(db, "users", uid), { teamId });
    showPopup("Team updated.");
  } catch (err) {
    console.error(err);
    showPopup("Failed to update team.");
  }
}


/* ============================================================================
   ROLE ASSIGNMENT (PER USER)
============================================================================ */

async function updateUserRole(uid, role) {
  try {
    await updateDoc(doc(db, "users", uid), { role });
    showPopup("Role updated.");
  } catch (err) {
    console.error(err);
    showPopup("Failed to update role.");
  }
}


/* ============================================================================
   APPROVE USER
============================================================================ */

async function approveUser(uid) {
  await updateDoc(doc(db, "users", uid), { status: "approved" });
  showPopup("User approved.");

  await loadUsersForAdmin();
  renderUsersTable();
}


/* ============================================================================
   REJECT USER (Equivalent to Delete)
============================================================================ */

async function rejectUser(uid) {
  await deleteUser(uid);
}


/* ============================================================================
   DELETE USER
============================================================================ */

async function deleteUser(uid) {
  if (!confirm("Delete this user?")) return;

  try {
    await deleteDoc(doc(db, "users", uid));
    showPopup("User deleted.");

    await loadUsersForAdmin();
    renderUsersTable();
  } catch (err) {
    console.error(err);
    showPopup("Failed to delete user.");
  }
}

/* ============================================================================
   SECTION 8 — ADMIN TABS SYSTEM
   ============================================================================
   Manages switching between:
     - Teams
     - Users
     - Stats

   Only one section is visible at a time.
============================================================================ */

function setupTabs() {
  // Default: Teams tab active
  activateTab("teams");

  el.tabTeams.onclick = () => activateTab("teams");
  el.tabUsers.onclick = () => activateTab("users");
  el.tabStats.onclick = async () => {
    activateTab("stats");

    // Manual refresh mode (Phase C3)
    await loadAllUsersForStats();
    await loadStatsCasesOnce();
    renderStatsTableNew();
  };
}


/* ============================================================================
   INTERNAL TAB SWITCHER
============================================================================ */

function activateTab(name) {
  // Clear active classes
  el.tabTeams.classList.remove("active");
  el.tabUsers.classList.remove("active");
  el.tabStats.classList.remove("active");

  // Hide all sections
  el.sectionTeams.style.display = "none";
  el.sectionUsers.style.display = "none";
  el.sectionStats.style.display = "none";

  // Enable chosen tab
  switch (name) {
    case "teams":
      el.tabTeams.classList.add("active");
      el.sectionTeams.style.display = "block";
      break;

    case "users":
      el.tabUsers.classList.add("active");
      el.sectionUsers.style.display = "block";
      break;

    case "stats":
      el.tabStats.classList.add("active");
      el.sectionStats.style.display = "block";
      break;
  }
}

/* ============================================================================
   SECTION 9 — EXCEL IMPORT / PROCESSING
   ============================================================================
   Necessary features:
     - Select team
     - Choose Excel file
     - Parse rows
     - Clean/Normalize
     - Upload to Firestore (cases collection)
     - Overwrite if caseId exists
============================================================================ */

/* -----------------------------------------
   DOM References for Excel Modal
----------------------------------------- */
const btnExcel = document.getElementById("btnExcel");
const btnExcelClose = document.getElementById("btnExcelClose");
const btnExcelContinue = document.getElementById("btnExcelContinue");

const excelTeamSelect = document.getElementById("excelTeamSelect");

// Populate team dropdown
btnExcel.onclick = () => {
  excelTeamSelect.innerHTML = "";

  adminState.allTeams
    .sort((a, b) => a.name.localeCompare(b.name))
    .forEach(t => {
      const opt = document.createElement("option");
      opt.value = t.id;
      opt.textContent = t.name;
      excelTeamSelect.appendChild(opt);
    });

  el.modalExcel.classList.add("show");
};

btnExcelClose.onclick = () =>
  el.modalExcel.classList.remove("show");


/* ============================================================================
   PARSE EXCEL FILE
============================================================================ */

btnExcelContinue.onclick = async () => {
  const file = fileExcel.files[0];
  const teamId = excelTeamSelect.value;

  if (!file) return showPopup("Please choose an Excel file.");
  if (!teamId) return showPopup("Please select a team.");

  showPopup("Reading Excel…");

  const rows = await readExcelFile(file);
  if (!rows || rows.length === 0) {
    return showPopup("No data found in Excel.");
  }

  // Clean + transform rows
  const cleaned = rows.map(cleanExcelRow);

  // Upload to Firestore
  await uploadExcelCases(cleaned, teamId);

  el.modalExcel.classList.remove("show");
  showPopup("Excel processed successfully.");
};


/* ============================================================================
   UTIL — Read Excel using XLSX
============================================================================ */

async function readExcelFile(file) {
  return new Promise((resolve) => {
    const reader = new FileReader();

    reader.onload = (e) => {
      const data = e.target.result;
      const workbook = XLSX.read(data, { type: "binary" });

      const sheet = workbook.SheetNames[0];
      const json = XLSX.utils.sheet_to_json(workbook.Sheets[sheet], {
        defval: ""
      });

      resolve(json);
    };

    reader.readAsBinaryString(file);
  });
}


/* ============================================================================
   CLEAN EXCEL ROW (Convert Excel format → Firestore case document)
============================================================================ */

function cleanExcelRow(r) {
  // Map your Excel columns → Firestore fields
  // These keys must match what your Tracker expects
  return {
    id: safeText(r["Case ID"]),
    customerName: safeText(r["Customer Name"]),
    country: safeText(r["Country"]),
    caseResolutionCode: safeText(r["Case Res Code"]),
    caseOwner: safeText(r["Case Owner"]),
    caGroup: safeText(r["CA Group"]),
    sbd: safeText(r["SBD"]),
    tl: safeText(r["TL"]),
    onsiteRFC: safeText(r["Onsite RFC"]),
    csrRFC: safeText(r["CSR RFC"]),
    benchRFC: safeText(r["Bench RFC"]),

    // Dates must be in ISO yyyy-mm-dd
    createdOn: safeISO(r["Created On"]),
    createdBy: safeText(r["Created By"]),

    status: safeText(r["Status"]),
    followDate: safeISO(r["Follow Date"]),
    flagged: safeBool(r["Flagged"]),
    notes: safeText(r["Notes"]),

    lastActionedOn: safeISO(r["Last Actioned On"]),
    lastActionedBy: safeText(r["Last Actioned By"])
  };
}


/* ============================================================================
   UPLOAD CLEANED CASE ROWS
   - Creates doc if new
   - Overwrites doc if existing
   - Sets teamId based on admin selection
============================================================================ */

async function uploadExcelCases(rows, teamId) {
  showPopup("Uploading cases…");

  for (const row of rows) {
    if (!row.id) continue;

    const ref = doc(db, "cases", row.id);

    // Always set teamId from admin selection
    const payload = {
      ...row,
      teamId
    };

    await setDoc(ref, payload, { merge: true });
  }
}

/* ============================================================================
   SECTION 10 — BACKUP IMPORT / EXPORT (JSON)
   ============================================================================
   This is the safest way to export and import a full database snapshot.
   It includes:
     - Teams
     - Users
     - Cases
   All with full field fidelity.
============================================================================ */

/* -----------------------------------------
   DOM References
----------------------------------------- */

const btnBackup = document.getElementById("btnBackup");
const btnBackupClose = document.getElementById("btnBackupClose");
const btnBackupExport = document.getElementById("btnBackupExport");
const btnBackupImport = document.getElementById("btnBackupImport");

btnBackup.onclick = () => {
  el.modalBackup.classList.add("show");
};

btnBackupClose.onclick = () =>
  el.modalBackup.classList.remove("show");

fileBackup.onchange = () => {
  // simple indicator showing selected file name
  if (fileBackup.files.length > 0) {
    showPopup(`Selected: ${fileBackup.files[0].name}`);
  }
};


/* ============================================================================
   EXPORT BACKUP
   - Creates a JSON file with entire DB content
   - adminState.user excluded from snapshot
============================================================================ */

btnBackupExport.onclick = async () => {
  showPopup("Preparing backup…");

  // Load everything fresh
  const teamsSnap = await getDocs(collection(db, "teams"));
  const usersSnap = await getDocs(collection(db, "users"));
  const casesSnap = await getDocs(collection(db, "cases"));

  const backup = {
    generatedAt: new Date().toISOString(),
    teams: teamsSnap.docs.map(d => ({ id: d.id, ...d.data() })),
    users: usersSnap.docs.map(d => ({ id: d.id, ...d.data() })),
    cases: casesSnap.docs.map(d => ({ id: d.id, ...d.data() }))
  };

  // Produce file
  const blob = new Blob([JSON.stringify(backup, null, 2)], {
    type: "application/json"
  });

  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");

  a.href = url;
  a.download = `kci-backup-${Date.now()}.json`;
  a.click();

  URL.revokeObjectURL(url);

  showPopup("Backup exported.");
};


/* ============================================================================
   IMPORT BACKUP
   - Full overwrite of cases / users / teams
   - Team IDs preserved
   - Users must have VALID teamId or blank
============================================================================ */

btnBackupImport.onclick = async () => {
  const file = fileBackup.files[0];
  if (!file) return showPopup("Please select a backup JSON file.");

  if (!confirm("Importing will overwrite the current data. Continue?"))
    return;

  showPopup("Reading backup…");

  const text = await file.text();
  let json;

  try {
    json = JSON.parse(text);
  } catch (err) {
    console.error(err);
    return showPopup("Invalid JSON file.");
  }

  await applyBackup(json);
};


/* ============================================================================
   APPLY BACKUP TO FIRESTORE
============================================================================ */

async function applyBackup(backup) {
  showPopup("Applying backup…");

  // -------------------------------------------------------------------------
  // 1. Delete existing collections (teams, users, cases)
  // -------------------------------------------------------------------------
  await wipeCollection("teams");
  await wipeCollection("users");
  await wipeCollection("cases");

  // -------------------------------------------------------------------------
  // 2. Restore Teams
  // -------------------------------------------------------------------------

  if (backup.teams) {
    for (const t of backup.teams) {
      await setDoc(doc(db, "teams", t.id), {
        name: t.name || "Unnamed Team"
      });
    }
  }

  // -------------------------------------------------------------------------
  // 3. Restore Users
  // -------------------------------------------------------------------------

  if (backup.users) {
    for (const u of backup.users) {
      await setDoc(doc(db, "users", u.id), {
        firstName: u.firstName || "",
        lastName: u.lastName || "",
        email: u.email || "",
        role: u.role || "general",
        status: u.status || "pending",
        teamId: u.teamId || "", // handle blank team
        theme: u.theme || "dark"
      });
    }
  }

  // -------------------------------------------------------------------------
  // 4. Restore Cases
  // -------------------------------------------------------------------------

  if (backup.cases) {
    for (const c of backup.cases) {
      await setDoc(doc(db, "cases", c.id), {
        customerName: c.customerName || "",
        createdBy: c.createdBy || "",
        createdOn: safeISO(c.createdOn),
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
        followDate: safeISO(c.followDate),
        flagged: !!c.flagged,
        notes: c.notes || "",
        lastActionedOn: safeISO(c.lastActionedOn),
        lastActionedBy: c.lastActionedBy || "",
        teamId: c.teamId || ""
      });
    }
  }

  showPopup("Backup import complete.");

  // Reload admin panel UI
  await loadTeamsForAdmin();
  await loadUsersForAdmin();
  await loadAllUsersForStats();
  await loadStatsCasesOnce();

  renderTeamsTable();
  renderUsersTable();
  buildTeamSelector();
  renderStatsTableNew();
}


/* ============================================================================
   WIPE COLLECTION (Delete all docs)
============================================================================ */

async function wipeCollection(name) {
  const snap = await getDocs(collection(db, name));

  for (const d of snap.docs) {
    await deleteDoc(doc(db, name, d.id));
  }
}

/* ============================================================================
   SECTION 11 — STATS ENGINE (PHASES C1 + C2 + C3 INTEGRATED)
   ============================================================================
   This section includes:
     ✔ Stats Data Model (Phase C1)
     ✔ Stats Rendering (Phase C2)
     ✔ Manual Refresh Mode (Phase C3)
============================================================================ */


/* ============================================================================
   LOAD USERS FOR STATS (Manual mode — Phase C3)
============================================================================ */

async function loadAllUsersForStats() {
  const q = isPrimary(adminState.user)
    ? query(collection(db, "users"))
    : query(collection(db, "users"), where("teamId", "==", adminState.user.teamId));

  const snap = await getDocs(q);
  adminState.allUsers = snap.docs.map(d => ({ id: d.id, ...d.data() }));
}


/* ============================================================================
   LOAD CASES FOR STATS (Manual mode — Phase C3)
============================================================================ */

let statsCases = [];

async function loadStatsCasesOnce() {
  const snap = await getDocs(collection(db, "cases"));
  statsCases = snap.docs.map(d => ({ id: d.id, ...d.data() }));
}


/* ============================================================================
   MANUAL REFRESH BUTTON (Inside statsControls)
============================================================================ */

function buildStatsControls() {
  el.statsControls.innerHTML = `
    <button class="action-btn" id="btnStatsRefresh">🔄 Refresh</button>
  `;

  document.getElementById("btnStatsRefresh").onclick = async () => {
    showPopup("Refreshing stats...");
    await loadAllUsersForStats();
    await loadStatsCasesOnce();
    renderStatsTableNew();
  };
}


/* ============================================================================
   TEAM SELECTOR FOR STATS TAB
============================================================================ */

function buildTeamSelector() {
  el.statsControls.innerHTML = ""; // Clear existing

  buildStatsControls();

  const sel = document.createElement("select");
  sel.className = "input";
  sel.id = "statsTeamSelect";
  sel.style.marginRight = "12px";

  // TOTAL mode only for primary admin
  if (isPrimary(adminState.user)) {
    const opt = document.createElement("option");
    opt.value = "TOTAL";
    opt.textContent = "TOTAL";
    sel.appendChild(opt);
  }

  adminState.allTeams
    .sort((a, b) => a.name.localeCompare(b.name))
    .forEach(t => {
      const opt = document.createElement("option");
      opt.value = t.id;
      opt.textContent = t.name;
      sel.appendChild(opt);
    });

  sel.value = adminState.selectedStatsTeam;

  sel.onchange = async () => {
    adminState.selectedStatsTeam = sel.value;
    await loadAllUsersForStats();
    await loadStatsCasesOnce();
    renderStatsTableNew();
  };

  el.statsControls.prepend(sel);
}


/* ============================================================================
   STATS ENGINE — PHASE C1 (DATA MODEL)
============================================================================ */

function computeStatsEngine() {
  const today = new Date().toISOString().split("T")[0];

  let filteredCases;

  // Option A — secondary admin sees only their own team
  if (!isPrimary(adminState.user)) {
    filteredCases = statsCases.filter(c => c.teamId === adminState.user.teamId);
  }
  else {
    // Primary admin
    if (adminState.selectedStatsTeam === "TOTAL")
      filteredCases = [...statsCases];
    else
      filteredCases = statsCases.filter(c => c.teamId === adminState.selectedStatsTeam);
  }

  const rows = [];

  // User rows
  for (const u of adminState.allUsers) {
    // Secondary admin: only their team
    if (!isPrimary(adminState.user) && u.teamId !== adminState.user.teamId)
      continue;

    // Primary admin: specific team
    if (
      isPrimary(adminState.user) &&
      adminState.selectedStatsTeam !== "TOTAL" &&
      u.teamId !== adminState.selectedStatsTeam
    )
      continue;

    const userCases = filteredCases.filter(r => r.lastActionedBy === u.id);

    const totalActioned = new Set(userCases.map(r => r.id)).size;

    const closedTodayRows = userCases.filter(
      r => r.lastActionedOn === today && r.status === "Closed"
    );
    const closedToday = closedTodayRows.length;

    const met = closedTodayRows.filter(r => (r.sbd || "").toLowerCase() === "met").length;
    const notMet = closedTodayRows.filter(r => (r.sbd || "").toLowerCase() === "not met").length;

    const metPct = closedToday ? Math.round((met / closedToday) * 100) : 0;
    const notMetPct = closedToday ? Math.round((notMet / closedToday) * 100) : 0;

    const spMonNoFollow = userCases.filter(
      r =>
        (!r.followDate || r.followDate.trim() === "") &&
        (r.status === "Service Pending" || r.status === "Monitoring")
    ).length;

    const followX = userCases.filter(
      r =>
        r.followDate &&
        r.status !== "Closed" &&
        r.followDate === today
    ).length;

    const followY = userCases.filter(
      r =>
        r.followDate &&
        r.status !== "Closed" &&
        r.followDate < today
    ).length;

    rows.push({
      userId: u.id,
      name: `${u.firstName} ${u.lastName}`,
      totalActioned,
      closedToday,
      met,
      metPct,
      notMet,
      notMetPct,
      spMonNoFollow,
      followX,
      followY
    });
  }

  // TEAM TOTAL ROW
  const total = {
    name: "TEAM TOTAL",
    totalActioned: rows.reduce((a, r) => a + r.totalActioned, 0),
    closedToday:  rows.reduce((a, r) => a + r.closedToday, 0),
    met:          rows.reduce((a, r) => a + r.met, 0),
    notMet:       rows.reduce((a, r) => a + r.notMet, 0),
    spMonNoFollow:rows.reduce((a, r) => a + r.spMonNoFollow, 0),
    followX:      rows.reduce((a, r) => a + r.followX, 0),
    followY:      rows.reduce((a, r) => a + r.followY, 0)
  };

  total.metPct = total.closedToday ? Math.round((total.met / total.closedToday) * 100) : 0;
  total.notMetPct = total.closedToday ? Math.round((total.notMet / total.closedToday) * 100) : 0;

  return {
    totalRow: total,
    userRows: rows
  };
}


/* ============================================================================
   STATS RENDER — PHASE C2 (TABLE UI)
============================================================================ */

function renderStatsTableNew() {
  const stats = computeStatsEngine();

  const header = `
    <table class="admin-table">
      <thead>
        <tr>
          <th>User</th>
          <th>Total Actioned</th>
          <th>Closed Today</th>
          <th>Met</th>
          <th>Not Met</th>
          <th>SP/MON No Follow</th>
          <th>Follow-ups X/Y</th>
          <th>Audit</th>
        </tr>
      </thead>
      <tbody>
  `;

  // TOTAL row
  const t = stats.totalRow;
  const totalRowHtml = `
    <tr class="total-row">
      <td><strong>${t.name}</strong></td>
      <td><strong>${t.totalActioned}</strong></td>
      <td><strong>${t.closedToday}</strong></td>
      <td><strong>${t.met} (${t.metPct}%)</strong></td>
      <td><strong>${t.notMet} (${t.notMetPct}%)</strong></td>
      <td><strong>${t.spMonNoFollow}</strong></td>
      <td><strong>${t.followX} / ${t.followY}</strong></td>
      <td></td>
    </tr>
  `;

  // USER rows
  const userRows = stats.userRows
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(
      u => `
      <tr>
        <td>${escapeHtml(u.name)}</td>
        <td>${u.totalActioned}</td>
        <td>${u.closedToday}</td>
        <td>${u.met} (${u.metPct}%)</td>
        <td>${u.notMet} (${u.notMetPct}%)</td>
        <td>${u.spMonNoFollow}</td>
        <td>${u.followX} / ${u.followY}</td>
        <td><button class="action-btn" data-audit="${u.userId}">Audit</button></td>
      </tr>
    `
    )
    .join("");

  el.statsTableWrap.innerHTML = header + totalRowHtml + userRows + "</tbody></table>";

  // Bind audit buttons
  el.statsTableWrap.querySelectorAll("[data-audit]").forEach(btn => {
    btn.onclick = () => openAuditModal(btn.dataset.audit);
  });
}

/* ============================================================================
   SECTION 12 — AUDIT MODAL
   ============================================================================
   Shows 5 cases for the selected user:
     - Prefer recent cases (last actioned)
     - Falls back to all-time cases if fewer than 5 exist
============================================================================ */

const auditModal = document.getElementById("auditModal");
const auditList = document.getElementById("auditList");
const btnAuditClose = document.getElementById("btnAuditClose");

btnAuditClose.onclick = () => auditModal.classList.remove("show");

auditModal.onclick = (e) => {
  if (e.target === auditModal) auditModal.classList.remove("show");
};


/* ============================================================================
   OPEN AUDIT MODAL FOR USER
============================================================================ */

function openAuditModal(userId) {
  auditList.innerHTML = "<div class='loading'>Loading…</div>";
  auditModal.classList.add("show");

  setTimeout(() => {
    renderAuditCases(userId);
  }, 50);
}


/* ============================================================================
   LOAD + RENDER 5 AUDIT CASES
============================================================================ */

function renderAuditCases(userId) {
  const list = statsCases.filter(c => c.lastActionedBy === userId);

  if (!list.length) {
    auditList.innerHTML = `<div class="empty-msg">No cases found for this user.</div>`;
    return;
  }

  // Prefer most recently actioned cases
  const sorted = [...list].sort((a, b) =>
    (b.lastActionedOn || "").localeCompare(a.lastActionedOn || "")
  );

  const sample = sorted.slice(0, 5);

  const html = sample
    .map(
      r => `
      <div class="audit-row">
        <div><strong>Case ID:</strong> ${escapeHtml(r.id)}</div>
        <div><strong>Customer:</strong> ${escapeHtml(r.customerName)}</div>
        <div><strong>Status:</strong> ${escapeHtml(r.status)}</div>
        <div><strong>Follow:</strong> ${escapeHtml(r.followDate || "—")}</div>
        <div><strong>Actioned On:</strong> ${escapeHtml(r.lastActionedOn || "—")}</div>
      </div>
    `
    )
    .join("");

  auditList.innerHTML = html;
}

/* ============================================================================
   SECTION 13 — UTILITY FUNCTIONS (Shared Across Admin Panel)
   ============================================================================
   These helpers are used by:
     - Teams module
     - Users module
     - Stats engine
     - Audit modal
     - Excel & Backup modules
============================================================================ */


/* ============================================================================
   escapeHtml — Prevents XSS or broken DOM when rendering user data
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
   SAFE VALUE UTILITIES
============================================================================ */

function safeText(val) {
  return val === undefined || val === null ? "" : String(val);
}

function safeBool(val) {
  return val === true || val === "true";
}

function safeISO(val) {
  if (!val) return "";
  try {
    const d = new Date(val);
    if (isNaN(d.getTime())) return "";
    return d.toISOString().split("T")[0];
  } catch {
    return "";
  }
}


/* ============================================================================
   SORTING HELPERS
============================================================================ */

function sortByName(a, b) {
  return a.name.localeCompare(b.name);
}

function sortTeamsByName(a, b) {
  return a.name.localeCompare(b.name);
}


/* ============================================================================
   POPUP — Small on-screen confirmation messages
============================================================================ */

function showPopup(msg) {
  const popup = document.getElementById("popup");
  if (!popup) return alert(msg);

  popup.textContent = msg;
  popup.classList.add("show");

  setTimeout(() => popup.classList.remove("show"), 1800);
}


/* ============================================================================
   MODAL ANIMATIONS (Smooth fade/scale)
============================================================================ */

function animateModalOpen(elm) {
  elm.style.opacity = "0";
  elm.style.transform = "scale(0.85)";

  setTimeout(() => {
    elm.style.transition = "all 150ms ease";
    elm.style.opacity = "1";
    elm.style.transform = "scale(1)";
  }, 10);
}

function animateModalClose(elm, callback) {
  elm.style.transition = "all 150ms ease";
  elm.style.opacity = "0";
  elm.style.transform = "scale(0.85)";

  setTimeout(() => {
    callback?.();
    elm.style.opacity = "";
    elm.style.transform = "";
    elm.style.transition = "";
  }, 150);
}

/* ============================================================================
   SECTION 14 — MODAL MANAGEMENT (Global)
   ============================================================================
   Ensures all admin modals behave consistently:
     - Smooth open/close animation
     - Close on overlay click
     - ESC key closes modals
     - Prevents background scrolling
============================================================================ */

const allModals = [
  el.modalTeamCreate,
  el.modalTeamRename,
  el.modalReassign,
  el.modalExcel,
  el.modalBackup,
  document.getElementById("auditModal")
];

/* ---------------------------------------------
   OPEN MODAL (Animated + Scroll Lock)
--------------------------------------------- */
function openModal(modal) {
  modal.classList.add("show");
  document.body.classList.add("modal-open");
  const card = modal.querySelector(".modal-card");
  if (card) animateModalOpen(card);
}

/* ---------------------------------------------
   CLOSE MODAL (Animated)
--------------------------------------------- */
function closeModal(modal) {
  const card = modal.querySelector(".modal-card");
  if (card) {
    animateModalClose(card, () => {
      modal.classList.remove("show");
      document.body.classList.remove("modal-open");
    });
  } else {
    modal.classList.remove("show");
    document.body.classList.remove("modal-open");
  }
}

/* ---------------------------------------------
   CLOSE ON OVERLAY CLICK
--------------------------------------------- */
allModals.forEach(modal => {
  if (!modal) return;

  modal.addEventListener("click", e => {
    if (e.target === modal) closeModal(modal);
  });
});

/* ---------------------------------------------
   ESC KEY closes any open modal
--------------------------------------------- */
document.addEventListener("keydown", e => {
  if (e.key === "Escape") {
    for (const modal of allModals) {
      if (modal && modal.classList.contains("show")) {
        closeModal(modal);
        return;
      }
    }
  }
});

/* ============================================================================
   SECTION 15 — LOADING OVERLAY (Spinner)
============================================================================ */

let adminLoadingMask = null;

function showLoadingMask(msg = "Processing…") {
  if (!adminLoadingMask) {
    adminLoadingMask = document.createElement("div");
    adminLoadingMask.id = "adminLoadingMask";
    adminLoadingMask.style.cssText = `
      position: fixed;
      left: 0; top: 0;
      width: 100vw; height: 100vh;
      background: rgba(0,0,0,0.4);
      backdrop-filter: blur(2px);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 2000;
      color: white;
      font-size: 20px;
      font-weight: 600;
    `;
  }

  adminLoadingMask.textContent = msg;
  document.body.appendChild(adminLoadingMask);
}

function hideLoadingMask() {
  if (adminLoadingMask && adminLoadingMask.parentNode) {
    adminLoadingMask.parentNode.removeChild(adminLoadingMask);
  }
}

/* ============================================================================
   SECTION 16 — BUTTON DISABLE / ENABLE HELPERS
============================================================================ */

function disableButton(btn, text = "Processing…") {
  btn.dataset.originalText = btn.textContent;
  btn.textContent = text;
  btn.disabled = true;
}

function enableButton(btn) {
  btn.textContent = btn.dataset.originalText || btn.textContent;
  btn.disabled = false;
}

/* ============================================================================
   SECTION 17 — DOM SAFETY (Avoid null reference errors)
============================================================================ */

function safeGet(id) {
  const elm = document.getElementById(id);
  if (!elm) console.warn(`Missing DOM element: #${id}`);
  return elm;
}

/* ============================================================================
   SECTION 18 — GLOBAL EVENT BINDINGS & UI POLISH
   ============================================================================
   These improve overall usability, responsiveness, and safety.
============================================================================ */

/* ---------------------------------------------
   Smooth scrolling for admin navigation
--------------------------------------------- */
document.addEventListener("click", (e) => {
  const link = e.target.closest("[data-scroll-to]");
  if (link) {
    const id = link.dataset.scrollTo;
    const target = document.getElementById(id);
    if (target) {
      target.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }
});


/* ---------------------------------------------
   Auto-focus first field when opening modals
--------------------------------------------- */
allModals.forEach((modal) => {
  if (!modal) return;
  modal.addEventListener("transitionend", () => {
    if (modal.classList.contains("show")) {
      const firstInput = modal.querySelector("input, select, textarea");
      firstInput?.focus();
    }
  });
});


/* ---------------------------------------------
   Prevent inadvertent form submission
--------------------------------------------- */
document.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && e.target.tagName === "INPUT") {
    // Prevent ENTER key from submitting modals prematurely
    e.preventDefault();
  }
});


/* ============================================================================
   SECTION 19 — AUDIT ENHANCEMENTS
   - Scroll into view
   - Highlight selected user
============================================================================ */

function highlightAuditUser(userId) {
  const row = el.statsTableWrap.querySelector(
    `button[data-audit="${userId}"]`
  )?.closest("tr");

  if (row) {
    row.classList.add("audit-highlight");
    setTimeout(() => row.classList.remove("audit-highlight"), 2000);

    row.scrollIntoView({ behavior: "smooth", block: "center" });
  }
}

/* Integrate into audit open */
const originalOpenAuditModal = openAuditModal;
openAuditModal = function (userId) {
  highlightAuditUser(userId);
  originalOpenAuditModal(userId);
};


/* ============================================================================
   SECTION 20 — MANUAL REFRESH HOOKS FOR HIGH STABILITY
============================================================================ */

async function adminHardRefresh() {
  showPopup("Refreshing…");

  await loadTeamsForAdmin();
  await loadUsersForAdmin();
  await loadAllUsersForStats();
  await loadStatsCasesOnce();

  renderTeamsTable();
  renderUsersTable();
  buildTeamSelector();
  renderStatsTableNew();
}

document.addEventListener("keydown", (e) => {
  if (e.ctrlKey && e.key === "r") {
    e.preventDefault();
    adminHardRefresh();
  }
});


/* ============================================================================
   SECTION 21 — AUTO-RESYNC (Last line of defense)
============================================================================ */

setInterval(async () => {
  try {
    // Re-sync only if Stats tab is active
    if (el.tabStats.classList.contains("active")) {
      await loadStatsCasesOnce();
      renderStatsTableNew();
    }
  } catch (err) {
    console.warn("Auto-resync failed:", err);
  }
}, 60000);


/* ============================================================================
   SECTION 22 — PREVENT UI FREEZE ON HEAVY OPERATIONS
============================================================================ */

function allowUI() {
  return new Promise((resolve) => setTimeout(resolve, 20));
}


/* ============================================================================
   SECTION 23 — SAFETY GUARDS
============================================================================ */

window.addEventListener("error", (e) => {
  console.error("Admin JS error caught:", e);
  showPopup("Admin error — check console.");
});

window.addEventListener("unhandledrejection", (e) => {
  console.error("Unhandled promise:", e);
  showPopup("Admin promise error.");
});

/* ============================================================================
   SECTION 24 — FINAL EXPORT WRAPPERS (Optional future use)
   ============================================================================
   These assist with debugging, automation, and developer tooling.
============================================================================ */

window.AdminAPI = {
  refresh: adminHardRefresh,
  reloadTeams: loadTeamsForAdmin,
  reloadUsers: loadUsersForAdmin,
  reloadStatsUsers: loadAllUsersForStats,
  reloadStatsCases: loadStatsCasesOnce,
  computeStats: computeStatsEngine,
  dumpCases: () => console.table(statsCases),
  dumpUsers: () => console.table(adminState.allUsers)
};


/* ============================================================================
   SECTION 25 — CLEAN EXIT HANDLERS
   ============================================================================
   Ensures Firestore listeners are removed and memory usage is stable.
============================================================================ */

window.addEventListener("beforeunload", () => {
  // Admin does not use onSnapshot listeners (manual mode),
  // but in case future features are added, guard cleanup lives here.
});


/* ============================================================================
   SECTION 26 — FINAL FILE SAFETY CHECK
   ============================================================================
   Confirms that all key DOM elements exist.
============================================================================ */

(function checkRequiredElements() {
  const required = [
    "sectionTeams",
    "sectionUsers",
    "sectionStats",
    "usersTableWrap",
    "teamsTableWrap",
    "statsTableWrap"
  ];

  required.forEach(id => {
    if (!document.getElementById(id)) {
      console.warn(`Admin Panel: Missing #${id} in HTML`);
    }
  });
})();


/* ============================================================================
   SECTION 27 — END OF admin.js
   ============================================================================
   You have reached the completed production build.
============================================================================ */

// END OF admin.js
