// =======================================================
// ADMIN.JS — SECTION 2
// Initialization, Role Checks, Theme, Tabs
// =======================================================

import {
  auth,
  onAuthStateChanged,
  getDoc,
  doc
} from "./js/firebase.js";

import {
  isPrimary,
  isSecondary,
  toggleTheme
} from "./js/userProfile.js";

import { showPopup } from "./js/utils.js";


// =======================================================
// DOM ELEMENTS
// =======================================================
const el = {
  adminUserName:   document.getElementById("adminUserName"),
  adminTheme:      document.getElementById("adminTheme"),
  btnUpdateData:   document.getElementById("btnUpdateData"),
  btnCreateTeam:   document.getElementById("btnCreateTeam"),
  btnGotoTracker:  document.getElementById("btnGotoTracker"),
  btnAdminLogout:  document.getElementById("btnAdminLogout"),

  tabUsers:        document.getElementById("tabUsers"),
  tabStats:        document.getElementById("tabStats"),

  sectionUsers:    document.getElementById("sectionUsers"),
  sectionStats:    document.getElementById("sectionStats"),
};


// =======================================================
// GLOBAL ADMIN STATE
// =======================================================

export const adminState = {
  user: null,
  allTeams: [],
  selectedStatsTeam: "TOTAL", // default for stats tab
};


// =======================================================
// AUTH STATE + ROLE VALIDATION
// =======================================================

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    location.href = "login.html";
    return;
  }

  // Fetch Firestore user document
  const userDocRef = doc(auth.app.firestore, "users", user.uid);
  const snap = await getDoc(userDocRef);

  if (!snap.exists()) {
    location.href = "login.html";
    return;
  }

  const data = snap.data();

  // Block non-approved users
  if (data.status !== "approved") {
    auth.signOut();
    return;
  }

  // General user → redirect to tracker immediately
  if (data.role === "general") {
    location.href = "index.html";
    return;
  }

  // Store user
  adminState.user = { uid: user.uid, ...data };

  // Display full name
  el.adminUserName.textContent = `${data.firstName} ${data.lastName}`;

  // Apply theme
  document.documentElement.dataset.theme = data.theme || "dark";
  el.adminTheme.textContent = data.theme === "light" ? "🌙" : "☀️";

  // Theme toggle
  el.adminTheme.onclick = () => toggleTheme(adminState.user);

  // Role-based header controls
  if (isPrimary(data)) {
    // Primary admin sees everything
    el.btnUpdateData.style.display = "inline-block";
    el.btnCreateTeam.style.display = "inline-block";
  } else if (isSecondary(data)) {
    // Secondary admin hides data/teams modals
    el.btnUpdateData.style.display = "none";
    el.btnCreateTeam.style.display = "none";
  }

  // Header button: Tracker
  el.btnGotoTracker.onclick = () => {
    location.href = "index.html";
  };

  // Logout button
  el.btnAdminLogout.onclick = () => {
    auth.signOut();
  };

  // Tabs
  setupTabs();

  // Load teams (Section 3 will fill logic)
  loadTeamsForAdmin();
});


// =======================================================
// TABS LOGIC
// =======================================================
function setupTabs() {

  el.tabUsers.onclick = () => {
    el.tabUsers.classList.add("active");
    el.tabStats.classList.remove("active");

    el.sectionUsers.style.display = "block";
    el.sectionStats.style.display = "none";
  };

  el.tabStats.onclick = () => {
    el.tabStats.classList.add("active");
    el.tabUsers.classList.remove("active");

    el.sectionStats.style.display = "block";
    el.sectionUsers.style.display = "none";
  };
}


// =======================================================
// TEAM LOADING (PLACEHOLDER)
// Will be implemented fully in Section 3 (Team Management)
// =======================================================
export function loadTeamsForAdmin() {
  // Placeholder – overwritten in Section 3
  console.warn("loadTeamsForAdmin() will be implemented in Section 3.");
}

// =======================================================
// ADMIN.JS — SECTION 3
// TEAM MANAGEMENT (Create / Rename / Delete / Reassign)
// =======================================================

import {
  db,
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  deleteDoc,
  query,
  where
} from "./js/firebase.js";

import { adminState } from "./admin.js";


// DOM elements from admin.html
const modalCreateTeam   = document.getElementById("modalCreateTeam");
const modalUpdateData   = document.getElementById("modalUpdateData");
const modalReassign     = document.getElementById("modalReassign");

const btnCreateTeam     = document.getElementById("btnCreateTeam");
const btnTeamClose      = document.getElementById("btnTeamClose");
const btnTeamDone       = document.getElementById("btnTeamDone");
const btnTeamCreate     = document.getElementById("btnTeamCreate");

const newTeamName       = document.getElementById("newTeamName");
const teamList          = document.getElementById("teamList");

const updateTeamList    = document.getElementById("updateTeamList");

const reassignTeamSelect = document.getElementById("reassignTeamSelect");
const btnReassignConfirm = document.getElementById("btnReassignConfirm");
const btnReassignClose   = document.getElementById("btnReassignClose");
const btnReassignDone    = document.getElementById("btnReassignDone");


// =======================================================
// OPEN/CLOSE CREATE TEAM MODAL
// =======================================================
btnCreateTeam.onclick = () => {
  if (!adminState.user || adminState.user.role !== "primary") return;
  populateTeamList();
  modalCreateTeam.classList.add("show");
};

btnTeamClose.onclick = () => modalCreateTeam.classList.remove("show");
btnTeamDone.onclick  = () => modalCreateTeam.classList.remove("show");

modalCreateTeam.addEventListener("click", (e) => {
  if (e.target === modalCreateTeam) modalCreateTeam.classList.remove("show");
});


// =======================================================
// LOAD TEAMS FOR ADMIN
// (Called by Section 2’s loadTeamsForAdmin placeholder)
// =======================================================
export async function loadTeamsForAdmin() {

  adminState.allTeams = [];

  const snap = await getDocs(collection(db, "teams"));
  snap.forEach((d) => {
    adminState.allTeams.push({
      id: d.id,
      ...d.data()
    });
  });

  // Build UI in modals
  populateTeamList();
  populateUpdateDataTeams();
  populateReassignTeams();
}


// =======================================================
// POPULATE CREATE TEAM MODAL LIST
// =======================================================
function populateTeamList() {
  teamList.innerHTML = "";

  adminState.allTeams
    .sort((a, b) => a.name.localeCompare(b.name))
    .forEach((t) => {

      const row = document.createElement("div");
      row.style.marginBottom = "0.6rem";

      row.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <div><strong>${t.name}</strong></div>
          <div>
            <button class="action-btn" data-action="rename" data-id="${t.id}">Rename</button>
            <button class="action-btn" data-action="delete" data-id="${t.id}">Delete</button>
          </div>
        </div>
      `;

      // Secondary admin cannot rename/delete teams
      if (adminState.user.role === "secondary") {
        row.querySelectorAll("button").forEach((btn) => {
          btn.disabled = true;
          btn.style.opacity = "0.4";
          btn.style.cursor = "not-allowed";
        });
      }

      teamList.appendChild(row);
    });
}


// =======================================================
// CREATE NEW TEAM
// =======================================================
btnTeamCreate.onclick = async () => {
  const name = newTeamName.value.trim();
  if (!name) {
    showPopup("Enter a team name.");
    return;
  }

  const id = name.replace(/\s+/g, "_").toLowerCase();

  await setDoc(doc(db, "teams", id), {
    name,
    createdAt: new Date()
  });

  newTeamName.value = "";
  showPopup("Team created.");

  await loadTeamsForAdmin();
};


// =======================================================
// RENAME OR DELETE TEAM
// =======================================================
teamList.addEventListener("click", async (e) => {
  const btn = e.target.closest("button");
  if (!btn) return;

  const action = btn.dataset.action;
  const teamId = btn.dataset.id;

  if (action === "rename") {
    renameTeam(teamId);
  }
  if (action === "delete") {
    deleteTeam(teamId);
  }
});


// -------------------------------------------------------
// RENAME TEAM
// -------------------------------------------------------
async function renameTeam(teamId) {
  if (!isPrimary(adminState.user)) return;

  const t = adminState.allTeams.find(x => x.id === teamId);
  if (!t) return;

  const newName = prompt("Enter new team name:", t.name);
  if (!newName || newName.trim() === "") return;

  await updateDoc(doc(db, "teams", teamId), {
    name: newName.trim()
  });

  showPopup("Team renamed.");
  await loadTeamsForAdmin();
}


// -------------------------------------------------------
// DELETE TEAM
// -------------------------------------------------------
async function deleteTeam(teamId) {
  if (!isPrimary(adminState.user)) return;

  const usedBy = await getDocs(
    query(collection(db, "users"), where("teamId", "==", teamId))
  );

  // If users exist → reassign modal
  if (!usedBy.empty) {
    openReassignModal(teamId, usedBy);
    return;
  }

  // No users → delete safely
  await deleteDoc(doc(db, "teams", teamId));

  showPopup("Team deleted.");
  await loadTeamsForAdmin();
}


// =======================================================
// REASSIGN TEAM MODAL (Before deleting team)
// =======================================================

let reassignSourceTeam = null;
let reassignUserList = [];

function openReassignModal(teamId, userQuerySnapshot) {
  reassignSourceTeam = teamId;
  reassignUserList = [];

  userQuerySnapshot.forEach((u) => {
    reassignUserList.push(u.id);
  });

  populateReassignTeams();

  modalReassign.classList.add("show");
}

btnReassignClose.onclick = () => modalReassign.classList.remove("show");
btnReassignDone.onclick  = () => modalReassign.classList.remove("show");

modalReassign.addEventListener("click", (e) => {
  if (e.target === modalReassign) modalReassign.classList.remove("show");
});


// -------------------------------------------------------
// Build options for reassign dropdown
// -------------------------------------------------------
function populateReassignTeams() {
  reassignTeamSelect.innerHTML = "";

  adminState.allTeams.forEach((t) => {
    if (t.id === reassignSourceTeam) return;

    const opt = document.createElement("option");
    opt.value = t.id;
    opt.textContent = t.name;
    reassignTeamSelect.appendChild(opt);
  });
}


// -------------------------------------------------------
// CONFIRM REASSIGNMENT
// -------------------------------------------------------
btnReassignConfirm.onclick = async () => {
  const newTeam = reassignTeamSelect.value;
  if (!newTeam) {
    showPopup("Select a new team first.");
    return;
  }

  // Reassign every user from old team → new team
  for (const uid of reassignUserList) {
    await updateDoc(doc(db, "users", uid), {
      teamId: newTeam
    });
  }

  // Delete the old team
  await deleteDoc(doc(db, "teams", reassignSourceTeam));

  showPopup("Users reassigned and team deleted.");

  reassignUserList = [];
  reassignSourceTeam = null;
  modalReassign.classList.remove("show");

  await loadTeamsForAdmin();
};


// =======================================================
// UPDATE DATA MODAL — POPULATE TEAM LIST
// (Excel upload handled later in Section 5)
// =======================================================
function populateUpdateDataTeams() {
  updateTeamList.innerHTML = "";

  adminState.allTeams
    .sort((a, b) => a.name.localeCompare(b.name))
    .forEach((t) => {

      const row = document.createElement("div");
      row.style.marginBottom = "0.4rem";

      row.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;padding:0.4rem 0;">
          <div><strong>${t.name}</strong></div>
          <div style="display:flex;gap:0.4rem;">
            <button class="action-btn" data-action="upload" data-id="${t.id}">Upload Excel</button>
            <button class="action-btn" data-action="export" data-id="${t.id}">Export Backup</button>
            <button class="action-btn" data-action="import" data-id="${t.id}">Import Backup</button>
          </div>
        </div>
      `;

      // Secondary admin cannot use these tools
      if (adminState.user.role === "secondary") {
        row.querySelectorAll("button").forEach((b) => {
          b.disabled = true;
          b.style.opacity = "0.4";
          b.style.cursor = "not-allowed";
        });
      }

      updateTeamList.appendChild(row);
    });
}

// =======================================================
// ADMIN.JS — SECTION 4
// USERS TAB (Approve, Reject, Role, Team, Remove)
// =======================================================

import {
  db,
  collection,
  doc,
  updateDoc,
  deleteDoc,
  onSnapshot,
  query,
  where
} from "./js/firebase.js";

import { adminState } from "./admin.js";
import { showPopup } from "./js/utils.js";
import { isPrimary, isSecondary } from "./js/userProfile.js";

const usersTableWrap = document.getElementById("usersTableWrap");


// =======================================================
// LIVE USERS SNAPSHOT
// =======================================================
function loadUsersForAdmin() {
  let q;

  // Primary admin sees ALL users
  if (isPrimary(adminState.user)) {
    q = query(collection(db, "users"));
  }

  // Secondary admin sees ONLY own team
  else if (isSecondary(adminState.user)) {
    q = query(
      collection(db, "users"),
      where("teamId", "==", adminState.user.teamId)
    );
  }

  onSnapshot(q, (snap) => {
    const users = [];
    snap.forEach((d) => users.push({ id: d.id, ...d.data() }));

    renderUsersTable(users);
  });
}


// =======================================================
// RENDER USERS TABLE
// =======================================================
function renderUsersTable(users) {

  let html = `
    <table>
      <thead>
        <tr>
          <th>Email</th>
          <th>Name</th>
          <th>Role</th>
          <th>Status</th>
          <th>Created</th>
          <th>Team</th>
          <th>Actions</th>
        </tr>
      </thead>
      <tbody>
  `;

  users.sort((a, b) => a.email.localeCompare(b.email));

  users.forEach(u => {

    const fullName = `${u.firstName || ""} ${u.lastName || ""}`;
    const created = u.createdAt?.toDate
      ? u.createdAt.toDate().toLocaleDateString()
      : "—";

    html += `
      <tr>
        <td>${u.email}</td>
        <td>${fullName}</td>

        <td>
          ${renderRoleDropdown(u)}
        </td>

        <td>${u.status}</td>

        <td>${created}</td>

        <td>${renderTeamDropdown(u)}</td>

        <td>${renderUserActions(u)}</td>
      </tr>
    `;
  });

  html += "</tbody></table>";

  usersTableWrap.innerHTML = html;

  // Bind dropdowns and buttons
  bindRoleDropdowns(users);
  bindTeamDropdowns(users);
  bindUserActions(users);
}


// =======================================================
// ROLE DROPDOWN
// =======================================================
function renderRoleDropdown(u) {

  // Primary admin cannot be demoted
  if (u.role === "primary") {
    return `<strong>Primary Admin</strong>`;
  }

  // Secondary admin is read-only → no dropdown
  if (isSecondary(adminState.user)) {
    return u.role;
  }

  return `
    <select data-role-id="${u.id}" class="input" style="min-width:130px;">
      <option value="general" ${u.role === "general" ? "selected" : ""}>General User</option>
      <option value="secondary" ${u.role === "secondary" ? "selected" : ""}>Secondary Admin</option>
    </select>
  `;
}

function bindRoleDropdowns(users) {
  if (!isPrimary(adminState.user)) return; // secondary = no role changes

  document.querySelectorAll("[data-role-id]").forEach(sel => {
    sel.addEventListener("change", async () => {
      const uid = sel.dataset.roleId;
      const newRole = sel.value;

      await updateDoc(doc(db, "users", uid), { role: newRole });
      showPopup("Role updated.");
    });
  });
}


// =======================================================
// TEAM DROPDOWN
// =======================================================
function renderTeamDropdown(u) {

  // Secondary admin = read-only
  if (isSecondary(adminState.user)) return u.teamId;

  // Primary admin only
  const options = adminState.allTeams
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(t => `
      <option value="${t.id}" ${u.teamId === t.id ? "selected" : ""}>
        ${t.name}
      </option>
    `).join("");

  return `<select data-team-id="${u.id}" class="input">${options}</select>`;
}

function bindTeamDropdowns(users) {
  if (!isPrimary(adminState.user)) return;

  document.querySelectorAll("[data-team-id]").forEach(sel => {
    sel.addEventListener("change", async () => {
      const uid = sel.dataset.teamId;
      const newTeam = sel.value;

      await updateDoc(doc(db, "users", uid), { teamId: newTeam });
      showPopup("Team updated.");
    });
  });
}


// =======================================================
// USER ACTION BUTTONS
// =======================================================
function renderUserActions(u) {

  // Secondary admin = no actions
  if (isSecondary(adminState.user)) return "";

  // Pending users → Approve / Reject
  if (u.status === "pending") {
    return `
      <button class="action-btn" data-approve="${u.id}">Approve</button>
      <button class="action-btn" data-reject="${u.id}">Reject</button>
    `;
  }

  // Approved users
  return `
    <button class="action-btn" data-remove="${u.id}">Remove</button>
  `;
}

function bindUserActions(users) {

  // Approve user
  document.querySelectorAll("[data-approve]").forEach(btn => {
    btn.onclick = async () => {
      const uid = btn.dataset.approve;
      await updateDoc(doc(db, "users", uid), { status: "approved" });
      showPopup("User approved.");
    };
  });

  // Reject user
  document.querySelectorAll("[data-reject]").forEach(btn => {
    btn.onclick = async () => {
      const uid = btn.dataset.reject;
      await updateDoc(doc(db, "users", uid), { status: "rejected" });
      showPopup("User rejected.");
    };
  });

  // Remove (delete) user
  document.querySelectorAll("[data-remove]").forEach(btn => {
    btn.onclick = async () => {
      const uid = btn.dataset.remove;

      if (uid === adminState.user.uid) {
        showPopup("Cannot remove yourself.");
        return;
      }

      if (!confirm("Are you sure you want to remove this user?")) return;

      await deleteDoc(doc(db, "users", uid));
      showPopup("User removed.");
    };
  });
}


// =======================================================
// INITIALIZE USERS TAB WHEN ADMIN PAGE LOADS
// =======================================================
setTimeout(() => {
  // Slight delay to allow adminState.user to populate
  if (adminState.user) {
    loadUsersForAdmin();
  }
}, 800);

// =======================================================
// ADMIN.JS — SECTION 5A
// EXCEL PARSING + COLUMN MAPPING
// =======================================================

import {
  db,
  collection,
  getDocs,
  doc,
  getDoc,
  setDoc,
  updateDoc,
  deleteDoc
} from "./js/firebase.js";

import { adminState } from "./admin.js";
import { showPopup } from "./js/utils.js";

const excelInput = document.getElementById("excelInput");
const uploadSummary = document.getElementById("uploadSummary");
const btnProcessExcel = document.getElementById("btnProcessExcel");

let selectedUploadTeam = null;
let excelCases = [];   // parsed Excel case list
let firestoreCases = []; // existing Firestore cases for this team


// =======================================================
// CLICK HANDLING: CHOOSE TEAM FOR EXCEL UPLOAD
// =======================================================
updateTeamList.addEventListener("click", (e) => {
  const btn = e.target.closest("button");
  if (!btn) return;

  const action = btn.dataset.action;
  const teamId = btn.dataset.id;

  if (!isPrimary(adminState.user)) {
    showPopup("Only primary admins can update data.");
    return;
  }

  if (action === "upload") {
    selectedUploadTeam = teamId;
    uploadSummary.innerHTML = `<strong>Selected Team:</strong> ${teamId}`;
  }

  if (action === "export") {
    exportBackup(teamId);
  }

  if (action === "import") {
    importBackupPrompt(teamId);
  }
});


// =======================================================
// EXCEL PARSER (SheetJS)
// =======================================================
function readExcelFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = (e) => {
      const data = new Uint8Array(e.target.result);
      const workbook = XLSX.read(data, { type: "array" });

      const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
      const json = XLSX.utils.sheet_to_json(firstSheet, { header: 1 });

      resolve(json);
    };

    reader.onerror = reject;
    reader.readAsArrayBuffer(file);
  });
}


// =======================================================
// EXCEL DATE SERIAL → YYYY-MM-DD
// =======================================================
function excelToDate(excelNum) {
  if (!excelNum) return "";
  const epoch = new Date(1899, 11, 30);
  const d = new Date(epoch.getTime() + excelNum * 86400000);
  return d.toISOString().split("T")[0];
}


// =======================================================
// PROCESS EXCEL → INTO MAPPED CASE OBJECTS
// =======================================================
btnProcessExcel.onclick = async () => {
  if (!selectedUploadTeam) {
    showPopup("Please choose a team first.");
    return;
  }

  const file = excelInput.files[0];
  if (!file) {
    showPopup("Select an .xlsx file.");
    return;
  }

  showPopup("Reading Excel...");

  const rows = await readExcelFile(file);
  if (rows.length < 2) {
    showPopup("Excel file is empty or invalid.");
    return;
  }

  // Load existing Firestore cases for this team
  firestoreCases = [];
  const snap = await getDocs(collection(db, "cases"));
  snap.forEach(d => {
    const c = d.data();
    if (c.teamId === selectedUploadTeam) {
      firestoreCases.push({ id: d.id, ...c });
    }
  });

  // Build Excel case objects
  excelCases = [];

  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r[0]) continue; // Case ID missing — skip row

    const caseId = String(r[0]).trim();

    // Find existing firestore case (if any)
    const existing = firestoreCases.find(x => x.id === caseId);

    excelCases.push({
      id: caseId,
      customerName: r[1] || "",
      createdOn: excelToDate(r[2]),
      createdBy: r[3] || "",
      country: r[6] || "",
      caseResolutionCode: r[8] || "",
      caseOwner: r[9] || "",
      caGroup: r[17] || "",
      tl: r[20] || "",
      sbd: r[29] || "",             // AD column
      onsiteRFC: r[33] || "",       // AH column
      csrRFC: r[34] || "",          // AI column
      benchRFC: r[35] || "",        // AJ column

      // Manual fields (preserve if existing)
      status: existing?.status || "",
      followDate: existing?.followDate || null,
      flagged: existing?.flagged || false,
      notes: existing?.notes || "",
      lastActionedOn: existing?.lastActionedOn || "",
      lastActionedBy: existing?.lastActionedBy || "",

      // Team link
      teamId: selectedUploadTeam,
    });
  }

  uploadSummary.innerHTML = `
    <strong>Excel Loaded.</strong><br>
    Total rows: ${excelCases.length}<br>
    Team: ${selectedUploadTeam}<br>
    Ready for comparison.
  `;

  showPopup("Excel parsed. Ready to process changes.");
};

// =======================================================
// ADMIN.JS — SECTION 5B
// DIFF ENGINE + FIRESTORE WRITES
// =======================================================


// -------------------------------------------------------
// Compare Excel cases with Firestore cases
// -------------------------------------------------------
async function applyExcelChanges() {
  if (!selectedUploadTeam) {
    showPopup("Team not selected.");
    return;
  }
  if (!excelCases.length) {
    showPopup("No Excel data loaded.");
    return;
  }

  // Create lookup maps for fast compare
  const excelMap = new Map(excelCases.map(c => [c.id, c]));
  const fsMap = new Map(firestoreCases.map(c => [c.id, c]));

  const newCases = [];
  const updatedCases = [];
  const deletedCases = [];

  // -----------------------------------------------------
  // Find NEW and UPDATED cases
  // -----------------------------------------------------
  for (const ex of excelCases) {
    const inFs = fsMap.get(ex.id);

    if (!inFs) {
      newCases.push(ex);
      continue;
    }

    // Check if any Excel fields changed vs Firestore
    const changed =
      ex.customerName !== inFs.customerName ||
      ex.createdOn     !== inFs.createdOn     ||
      ex.createdBy     !== inFs.createdBy     ||
      ex.country       !== inFs.country       ||
      ex.caseResolutionCode !== inFs.caseResolutionCode ||
      ex.caseOwner     !== inFs.caseOwner     ||
      ex.caGroup       !== inFs.caGroup       ||
      ex.tl            !== inFs.tl            ||
      ex.sbd           !== inFs.sbd           ||
      ex.onsiteRFC     !== inFs.onsiteRFC     ||
      ex.csrRFC        !== inFs.csrRFC        ||
      ex.benchRFC      !== inFs.benchRFC;

    if (changed) updatedCases.push(ex);
  }

  // -----------------------------------------------------
  // Find DELETED cases (present in FS but not Excel)
  // -----------------------------------------------------
  for (const fs of firestoreCases) {
    if (!excelMap.has(fs.id)) {
      deletedCases.push(fs);
    }
  }

  // -----------------------------------------------------
  // APPLY CHANGES IN FIRESTORE
  // -----------------------------------------------------

  // ADD NEW CASES
  for (const c of newCases) {
    await setDoc(doc(db, "cases", c.id), c);
  }

  // UPDATE MODIFIED CASES
  for (const c of updatedCases) {
    await updateDoc(doc(db, "cases", c.id), {
      customerName: c.customerName,
      createdOn: c.createdOn,
      createdBy: c.createdBy,
      country: c.country,
      caseResolutionCode: c.caseResolutionCode,
      caseOwner: c.caseOwner,
      caGroup: c.caGroup,
      tl: c.tl,
      sbd: c.sbd,
      onsiteRFC: c.onsiteRFC,
      csrRFC: c.csrRFC,
      benchRFC: c.benchRFC,
      // Manual fields remain untouched
    });
  }

  // DELETE CASES NOT PRESENT IN EXCEL
  for (const c of deletedCases) {
    await deleteDoc(doc(db, "cases", c.id));
  }

  // -----------------------------------------------------
  // DISPLAY SUMMARY
  // -----------------------------------------------------
  uploadSummary.innerHTML = `
    <strong>Update Complete.</strong><br><br>
    <strong>New Cases:</strong> ${newCases.length}<br>
    <strong>Updated:</strong> ${updatedCases.length}<br>
    <strong>Deleted:</strong> ${deletedCases.length}<br>
  `;

  showPopup("Data updated successfully.");
}


// =======================================================
// BIND PROCESS (APPLY) BUTTON
// =======================================================
btnProcessExcel.addEventListener("dblclick", async () => {
  // Double-click protection: only primary admins
  if (!isPrimary(adminState.user)) {
    showPopup("Only primary admins can update data.");
    return;
  }

  showPopup("Applying changes...");
  await applyExcelChanges();
});

// =======================================================
// ADMIN.JS — SECTION 5C
// EXPORT BACKUP + IMPORT BACKUP
// =======================================================


// -------------------------------------------------------
// EXPORT BACKUP (Download JSON)
// -------------------------------------------------------
async function exportBackup(teamId) {
  if (!isPrimary(adminState.user)) {
    showPopup("Only primary admins can export backups.");
    return;
  }

  showPopup("Exporting backup...");

  // Load all cases for this team
  const snap = await getDocs(collection(db, "cases"));
  const cases = [];

  snap.forEach(d => {
    const c = d.data();
    if (c.teamId === teamId) {
      cases.push({ id: d.id, ...c });
    }
  });

  const blob = new Blob([JSON.stringify(cases, null, 2)], {
    type: "application/json",
  });

  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");

  const today = new Date().toISOString().split("T")[0];

  a.href = url;
  a.download = `${teamId}_backup_${today}.json`;
  a.click();

  URL.revokeObjectURL(url);

  showPopup("Backup exported.");
}


// -------------------------------------------------------
// IMPORT BACKUP — Prompt to select JSON file
// -------------------------------------------------------
function importBackupPrompt(teamId) {
  if (!isPrimary(adminState.user)) {
    showPopup("Only primary admins can import backups.");
    return;
  }

  selectedUploadTeam = teamId;

  const input = document.createElement("input");
  input.type = "file";
  input.accept = ".json";

  input.onchange = async () => {
    const file = input.files[0];
    if (!file) return;

    const text = await file.text();
    let backupData;

    try {
      backupData = JSON.parse(text);
    } catch (err) {
      showPopup("Invalid JSON backup file.");
      return;
    }

    // Ask confirmation
    const ok = confirm(
      `Importing backup will OVERWRITE all existing cases for team "${teamId}".\n\nContinue?`
    );
    if (!ok) return;

    await importBackup(teamId, backupData);
  };

  input.click();
}


// -------------------------------------------------------
// IMPORT BACKUP: Overwrite Firestore Data
// -------------------------------------------------------
async function importBackup(teamId, backupCases) {
  showPopup("Importing backup...");

  // STEP 1 — Delete all existing cases for this team
  const snap = await getDocs(collection(db, "cases"));
  snap.forEach(async (d) => {
    const c = d.data();
    if (c.teamId === teamId) {
      await deleteDoc(doc(db, "cases", d.id));
    }
  });

  // STEP 2 — Insert all backup cases
  for (const c of backupCases) {
    await setDoc(doc(db, "cases", c.id), c);
  }

  showPopup("Backup imported successfully.");

  uploadSummary.innerHTML = `
    <strong>Backup Imported.</strong><br>
    Cases restored: ${backupCases.length}<br>
    Team: ${teamId}
  `;
}

// =======================================================
// ADMIN.JS — SECTION 6
// STATS ENGINE
// =======================================================

import {
  db,
  collection,
  onSnapshot,
  query,
  where,
  getDocs
} from "./js/firebase.js";

const statsControls = document.getElementById("statsControls");
const statsTableWrap = document.getElementById("statsTableWrap");

const modalAudit = document.getElementById("modalAudit");
const auditList = document.getElementById("auditList");
const btnAuditClose = document.getElementById("btnAuditClose");
const btnAuditOk = document.getElementById("btnAuditOk");

let statsCases = []; // all cases (filtered by team)
let allUsers = [];   // all users (for name lookup)


// =======================================================
// LOAD USERS FOR NAME LOOKUP
// =======================================================
async function loadAllUsersForStats() {
  const snap = await getDocs(collection(db, "users"));
  allUsers = [];
  snap.forEach(d => allUsers.push({ id: d.id, ...d.data() }));
}


// =======================================================
// BUILD TEAM SELECTOR
// =======================================================
function buildTeamSelector() {
  statsControls.innerHTML = "";

  const sel = document.createElement("select");
  sel.className = "input";
  sel.style.maxWidth = "300px";

  // PRIMARY ADMIN → TOTAL + all teams
  if (isPrimary(adminState.user)) {
    const optTotal = document.createElement("option");
    optTotal.value = "TOTAL";
    optTotal.textContent = "TOTAL";
    sel.appendChild(optTotal);

    adminState.allTeams
      .sort((a, b) => a.name.localeCompare(b.name))
      .forEach(t => {
        const opt = document.createElement("option");
        opt.value = t.id;
        opt.textContent = t.name;
        sel.appendChild(opt);
      });
  }

  // SECONDARY ADMIN → only own team
  if (isSecondary(adminState.user)) {
    const t = adminState.allTeams.find(x => x.id === adminState.user.teamId);
    const opt = document.createElement("option");
    opt.value = t.id;
    opt.textContent = t.name;
    sel.appendChild(opt);
  }

  sel.value = adminState.selectedStatsTeam;
  sel.onchange = () => {
    adminState.selectedStatsTeam = sel.value;
    subscribeStatsCases();
  };

  statsControls.appendChild(sel);
}


// =======================================================
// FIRESTORE REALTIME (CASES FOR SELECTED TEAM)
// =======================================================
function subscribeStatsCases() {
  let q;

  if (adminState.selectedStatsTeam === "TOTAL") {
    q = query(collection(db, "cases"));
  } else {
    q = query(
      collection(db, "cases"),
      where("teamId", "==", adminState.selectedStatsTeam)
    );
  }

  onSnapshot(q, (snap) => {
    statsCases = [];
    snap.forEach(d => statsCases.push({ id: d.id, ...d.data() }));
    renderStatsTable();
  });
}


// =======================================================
// RENDER STATS TABLE
// =======================================================
function renderStatsTable() {
  const today = new Date().toISOString().split("T")[0];

  // Build per-user stats
  const byUser = {};

  statsCases.forEach(c => {
    const uid = c.lastActionedBy || "unknown";

    if (!byUser[uid]) {
      byUser[uid] = {
        userId: uid,
        totalActioned: 0,
        closedToday: 0,
        met: 0,
        notMet: 0,
        spNoFD: 0,      // SP/MON no follow date (all time)
        fdToday: 0,     // followDate == today
        fdPast: 0       // followDate < today
      };
    }

    // Total actioned TODAY only if lastActionedOn = today
    if (c.lastActionedOn === today) {
      const u = byUser[uid];
      u.totalActioned++;

      if (c.status === "Closed") {
        u.closedToday++;

        const sbd = (c.sbd || "").toLowerCase();
        if (sbd === "met") u.met++;
        if (sbd === "not met") u.notMet++;
      }

      // Today follow-ups (SP/MON only)
      if (c.followDate === today) u.fdToday++;
      if (c.followDate && c.followDate < today) u.fdPast++;
    }

    // SP/MON with NO followDate — ALL TIME
    if ((c.status === "Service Pending" || c.status === "Monitoring") &&
        (!c.followDate || c.followDate === "")) {
      byUser[uid].spNoFD++;
    }
  });

  // Prepare rows
  const rows = [];

  // TEAM TOTAL row
  rows.push(computeTotalRow(byUser));

  // USER rows
  for (const uid in byUser) {
    const u = byUser[uid];
    rows.push(buildUserRow(u));
  }

  statsTableWrap.innerHTML = `
    <table>
      <thead>
        <tr>
          <th>User</th>
          <th>Total Actioned Today</th>
          <th>Closed Today</th>
          <th>Met</th>
          <th>Not Met</th>
          <th>SP/MON No Follow Date</th>
          <th>Follow-ups (X/Y)</th>
          <th>Audit</th>
        </tr>
      </thead>
      <tbody>
        ${rows.join("")}
      </tbody>
    </table>
  `;
}


// =======================================================
// HELPER: Build Team Total Row
// =======================================================
function computeTotalRow(byUser) {
  let totalA = 0;
  let closed = 0;
  let met = 0;
  let notMet = 0;
  let spNoFD = 0;
  let fdToday = 0;
  let fdPast = 0;

  for (const uid in byUser) {
    const u = byUser[uid];
    totalA += u.totalActioned;
    closed += u.closedToday;
    met += u.met;
    notMet += u.notMet;
    spNoFD += u.spNoFD;
    fdToday += u.fdToday;
    fdPast += u.fdPast;
  }

  const metPct = closed ? Math.round((met / closed) * 100) : 0;
  const notMetPct = closed ? Math.round((notMet / closed) * 100) : 0;

  return `
    <tr style="background:rgba(255,255,255,0.06);font-weight:700;">
      <td>TEAM TOTAL</td>
      <td>${totalA}</td>
      <td>${closed}</td>
      <td>${met} (${metPct}%)</td>
      <td>${notMet} (${notMetPct}%)</td>
      <td>${spNoFD}</td>
      <td>${fdToday} / ${fdPast}</td>
      <td></td>
    </tr>
  `;
}


// =======================================================
// HELPER: Build USER ROW
// =======================================================
function buildUserRow(u) {
  const user = allUsers.find(x => x.id === u.userId);
  const name = user ? `${user.firstName} ${user.lastName}` : "Unknown";

  const metPct = u.closedToday ? Math.round((u.met / u.closedToday) * 100) : 0;
  const notMetPct = u.closedToday ? Math.round((u.notMet / u.closedToday) * 100) : 0;

  return `
    <tr>
      <td>${name}</td>
      <td>${u.totalActioned}</td>
      <td>${u.closedToday}</td>
      <td>${u.met} (${metPct}%)</td>
      <td>${u.notMet} (${notMetPct}%)</td>
      <td>${u.spNoFD}</td>
      <td>${u.fdToday} / ${u.fdPast}</td>
      <td>
        <button class="action-btn" data-audit="${u.userId}">
          Audit
        </button>
      </td>
    </tr>
  `;
}


// =======================================================
// BIND AUDIT BUTTONS
// =======================================================
statsTableWrap.addEventListener("click", (e) => {
  const btn = e.target.closest("[data-audit]");
  if (!btn) return;

  const uid = btn.dataset.audit;
  openAuditModal(uid);
});


// =======================================================
// AUDIT MODAL (Random 5 cases)
// =======================================================
async function openAuditModal(uid) {
  const today = new Date().toISOString().split("T")[0];

  // Filter cases actioned today by this user
  const pool = statsCases.filter(c =>
    c.lastActionedBy === uid &&
    c.lastActionedOn === today
  );

  // Random 5 (or fewer)
  const selected = pool.sort(() => Math.random() - 0.5).slice(0, 5);

  auditList.innerHTML = selected.length
    ? selected.map(c => `
        <div style="padding:0.4rem 0;border-bottom:1px solid var(--border);">
          <strong>${c.id}</strong><br>
          ${c.status} — ${c.sbd}
        </div>
      `).join("")
    : "<p>No cases actioned today by this user.</p>";

  modalAudit.classList.add("show");
}

btnAuditClose.onclick = () => modalAudit.classList.remove("show");
btnAuditOk.onclick = () => modalAudit.classList.remove("show");

modalAudit.addEventListener("click", (e) => {
  if (e.target === modalAudit) modalAudit.classList.remove("show");
});


// =======================================================
// INITIALIZE STATS ENGINE
// =======================================================
setTimeout(async () => {
  if (adminState.user) {
    await loadAllUsersForStats();
    buildTeamSelector();
    subscribeStatsCases();
  }
}, 1200);
