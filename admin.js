/* ============================================================
   ADMIN.JS — CLEAN FINAL VERSION
   Contains:
   - Initialization & Roles
   - Team Management
   - Users Tab
   - Excel Upload + Backup
   - Stats Engine
   - Audit Modal
   ============================================================ */

/* ============================================================
   SINGLE IMPORT BLOCK (Do NOT add any more imports)
   ============================================================ */
import {
  auth,
  onAuthStateChanged,

  db,
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  onSnapshot
} from "./js/firebase.js";

import { isPrimary, isSecondary, toggleTheme } from "./js/userProfile.js";
import { showPopup } from "./js/utils.js";



/* ============================================================
   GLOBAL DOM REFERENCES
   ============================================================ */
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

const teamList            = document.getElementById("teamList");
const newTeamName         = document.getElementById("newTeamName");
const btnTeamCreate       = document.getElementById("btnTeamCreate");
const btnTeamClose        = document.getElementById("btnTeamClose");
const btnTeamDone         = document.getElementById("btnTeamDone");
const modalCreateTeam     = document.getElementById("modalCreateTeam");

const updateTeamList      = document.getElementById("updateTeamList");
const modalUpdateData     = document.getElementById("modalUpdateData");
const btnUpdateClose      = document.getElementById("btnUpdateClose");
const btnUpdateDone       = document.getElementById("btnUpdateDone");

/* ============================================================
   FIX — Enable Update Data Modal
   ============================================================ */
el.btnUpdateData.onclick = () => {
  modalUpdateData.classList.add("show");
};

btnUpdateClose.onclick = () => {
  modalUpdateData.classList.remove("show");
};

btnUpdateDone.onclick = () => {
  modalUpdateData.classList.remove("show");
};


const excelInput          = document.getElementById("excelInput");
const uploadSummary       = document.getElementById("uploadSummary");
const btnProcessExcel     = document.getElementById("btnProcessExcel");

const modalReassign       = document.getElementById("modalReassign");
const reassignTeamSelect  = document.getElementById("reassignTeamSelect");
const btnReassignClose    = document.getElementById("btnReassignClose");
const btnReassignDone     = document.getElementById("btnReassignDone");
const btnReassignConfirm  = document.getElementById("btnReassignConfirm");

const usersTableWrap      = document.getElementById("usersTableWrap");

const statsControls       = document.getElementById("statsControls");
const statsTableWrap      = document.getElementById("statsTableWrap");

const modalAudit          = document.getElementById("modalAudit");
const auditList           = document.getElementById("auditList");
const btnAuditClose       = document.getElementById("btnAuditClose");
const btnAuditOk          = document.getElementById("btnAuditOk");

function openAuditModal(userId) {
  const today = new Date().toISOString().split("T")[0];

  // Get cases actioned today by this user (only status updates)
  const userTodayCases = statsCases.filter(r =>
    r.statusChangedOn === today && r.statusChangedBy === userId
  );

  // Pick 5 random cases
  const five = userTodayCases
    .sort(() => Math.random() - 0.5)
    .slice(0, 5);

  auditList.innerHTML = five.length
    ? five.map(c => `<div style="margin-bottom:8px;">${c.id}</div>`).join("")
    : "<div>No cases available for audit today.</div>";

  modalAudit.classList.add("show");
}

// Buttons to close modal
btnAuditClose.onclick = () => modalAudit.classList.remove("show");
btnAuditOk.onclick = () => modalAudit.classList.remove("show");



/* ============================================================
   GLOBAL ADMIN STATE
   ============================================================ */
export const adminState = {
  user: null,
  allTeams: [],
  selectedStatsTeam: "TOTAL",
};

let statsCases = [];
let allUsers = [];



/* ============================================================
   SECTION 1 — AUTH + INITIALIZATION + ROLE PROTECTION
   ============================================================ */
onAuthStateChanged(auth, async (user) => {
  if (!user) {
    location.href = "login.html";
    return;
  }

  const snap = await getDoc(doc(db, "users", user.uid));
  if (!snap.exists()) {
    location.href = "login.html";
    return;
  }

  const data = snap.data();
  if (data.status !== "approved") {
    await auth.signOut();
    return;
  }

  // General users cannot access admin page
  if (data.role === "general") {
    location.href = "index.html";
    return;
  }

  adminState.user = { uid: user.uid, ...data };

  // Display user name
  el.adminUserName.textContent = `${data.firstName} ${data.lastName}`;

  // Theme
  document.documentElement.dataset.theme = data.theme || "dark";
  el.adminTheme.textContent = data.theme === "light" ? "🌙" : "☀️";
  el.adminTheme.onclick = () => toggleTheme(adminState.user);

  // Role-based visibility
  if (isPrimary(data)) {
    el.btnUpdateData.style.display = "inline-block";
    el.btnCreateTeam.style.display = "inline-block";
  } else {
    el.btnUpdateData.style.display = "none";
    el.btnCreateTeam.style.display = "none";
  }

  // Navigation
  el.btnGotoTracker.onclick = () => location.href = "index.html";
  el.btnAdminLogout.onclick = () => auth.signOut();

  // Tabs
  setupTabs();

  // Load Teams + Stats + Users
  await loadTeamsForAdmin();
  loadUsersForAdmin();
  
  buildTeamSelector();
  
});



/* ============================================================
   SECTION 2 — TAB SWITCHING
   ============================================================ */
function setupTabs() {
  el.tabUsers.onclick = () => {
    el.tabUsers.classList.add("active");
    el.tabStats.classList.remove("active");
    el.sectionUsers.style.display = "block";
    el.sectionStats.style.display = "none";
  };

  el.tabStats.onclick = async () => {
  el.tabStats.classList.add("active");
  el.tabUsers.classList.remove("active");
  el.sectionUsers.style.display = "none";
  el.sectionStats.style.display = "block";

  // Load data ONLY when entering stats (manual mode)
statsTableWrap.innerHTML = "Loading...";

  await loadAllUsersForStats();
  await loadStatsCasesOnce();
  renderStatsTableNew();
};

}



/* ============================================================
   SECTION 3 — TEAM MANAGEMENT
   ============================================================ */
export async function loadTeamsForAdmin() {
  adminState.allTeams = [];

  const snap = await getDocs(collection(db, "teams"));
  snap.forEach(d => adminState.allTeams.push({ id: d.id, ...d.data() }));

  populateTeamList();
  populateUpdateDataTeams();
  populateReassignTeams();
}


/* ---------- CREATE TEAM ---------- */
btnCreateTeam.onclick = () => {
  if (!isPrimary(adminState.user)) return;
  modalCreateTeam.classList.add("show");
};

btnTeamClose.onclick = () => modalCreateTeam.classList.remove("show");
btnTeamDone.onclick  = () => modalCreateTeam.classList.remove("show");

modalCreateTeam.addEventListener("click", (e) => {
  if (e.target === modalCreateTeam) modalCreateTeam.classList.remove("show");
});

btnTeamCreate.onclick = async () => {
  const name = newTeamName.value.trim();
  if (!name) return showPopup("Enter a team name.");
  const id = name.replace(/\s+/g, "_").toLowerCase();

  await setDoc(doc(db, "teams", id), { name, createdAt: new Date() });
  newTeamName.value = "";
  showPopup("Team created.");
  await loadTeamsForAdmin();
};


/* ---------- TEAM LIST ---------- */
function populateTeamList() {
  teamList.innerHTML = "";

  adminState.allTeams
    .sort((a, b) => a.name.localeCompare(b.name))
    .forEach(t => {
      const row = document.createElement("div");
      row.style.marginBottom = "0.6rem";

      row.innerHTML = `
        <div style="display:flex;justify-content:space-between;">
          <div><strong>${t.name}</strong></div>
          <div>
            <button class="action-btn" data-action="rename" data-id="${t.id}">Rename</button>
            <button class="action-btn" data-action="delete" data-id="${t.id}">Delete</button>
          </div>
        </div>
      `;

      if (isSecondary(adminState.user)) {
        row.querySelectorAll("button").forEach(b => {
          b.disabled = true;
          b.style.opacity = "0.4";
        });
      }

      teamList.appendChild(row);
    });
}


/* ---------- RENAME / DELETE TEAM ---------- */
teamList.addEventListener("click", async (e) => {
  const btn = e.target.closest("button");
  if (!btn || isSecondary(adminState.user)) return;

  const action = btn.dataset.action;
  const teamId = btn.dataset.id;

  if (action === "rename") renameTeam(teamId);
  if (action === "delete") deleteTeam(teamId);
});

async function renameTeam(teamId) {
  const t = adminState.allTeams.find(x => x.id === teamId);
  const newName = prompt("Enter new team name:", t.name);
  if (!newName) return;

  await updateDoc(doc(db, "teams", teamId), { name: newName.trim() });
  showPopup("Team renamed.");
  await loadTeamsForAdmin();
}

/* =======================================================================
   DELETE TEAM — WITH FULL CASE CASCADE DELETE
   ======================================================================= */
async function deleteTeam(teamId) {
  // 1. Check if team still has users
  const userSnap = await getDocs(
    query(collection(db, "users"), where("teamId", "==", teamId))
  );

  if (!userSnap.empty) {
    // Reassign required
    openReassignModal(teamId, userSnap);
    return;
  }

  // 2. Delete cases for this team
  showPopup("Deleting cases for this team...");
  await deleteAllCasesForTeam(teamId);

  // 3. Delete the team record itself
  await deleteDoc(doc(db, "teams", teamId));

  showPopup("Team deleted successfully.");
  await loadTeamsForAdmin();
}


/* =======================================================================
   REASSIGN USERS MODAL — CLEAN & RELIABLE VERSION
   ======================================================================= */

let reassignSourceTeam = null;
let reassignUserList = [];

function openReassignModal(teamId, qs) {
  reassignSourceTeam = teamId;
  reassignUserList = qs.docs.map(d => d.id);

  populateReassignTeams();
  modalReassign.classList.add("show");
}

btnReassignClose.onclick = () => modalReassign.classList.remove("show");
btnReassignDone.onclick  = () => modalReassign.classList.remove("show");

modalReassign.onclick = (e) => {
  if (e.target === modalReassign) modalReassign.classList.remove("show");
};

/* Populate dropdown (exclude the team being deleted) */
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

/* CONFIRM BUTTON — Reassign Users THEN Delete Team */
btnReassignConfirm.onclick = async () => {
  const newTeam = reassignTeamSelect.value;
  if (!newTeam) return showPopup("Please select a team.");

  showPopup("Reassigning users...");

  for (const uid of reassignUserList) {
    await updateDoc(doc(db, "users", uid), { teamId: newTeam });
  }

  showPopup("Deleting old team and its cases...");

  // Delete cases
  await deleteAllCasesForTeam(reassignSourceTeam);

  // Delete team
  await deleteDoc(doc(db, "teams", reassignSourceTeam));

  modalReassign.classList.remove("show");
  showPopup("Team deleted successfully.");

  await loadTeamsForAdmin();
};



function populateUpdateDataTeams() {
  updateTeamList.innerHTML = "";

  adminState.allTeams
    .sort((a, b) => a.name.localeCompare(b.name))
    .forEach(t => {
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

      // Secondary admin cannot use these
      if (isSecondary(adminState.user)) {
        row.querySelectorAll("button").forEach(b => {
          b.disabled = true;
          b.style.opacity = "0.4";
          b.style.cursor = "not-allowed";
        });
      }

      updateTeamList.appendChild(row);
    });
}




/* ============================================================
   SECTION 4 — USERS TAB
   ============================================================ */
function loadUsersForAdmin() {
  let q;

  if (isPrimary(adminState.user)) {
    q = query(collection(db, "users"));
  } else {
    q = query(collection(db, "users"), where("teamId", "==", adminState.user.teamId));
  }

  onSnapshot(q, (snap) => {
    const users = [];
    snap.forEach(d => users.push({ id: d.id, ...d.data() }));
    renderUsersTable(users);
  });
}

/* =======================================================================
   PHASE A — USERS TAB FIXES
   ======================================================================= */

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
    const created = u.createdAt?.toDate
      ? u.createdAt.toDate().toLocaleDateString()
      : "—";

    const fullName = `${u.firstName} ${u.lastName}`;

    html += `
      <tr>
        <td>${u.email}</td>
        <td>${fullName}</td>
        <td>${renderRoleDropdown(u)}</td>
        <td>${u.status}</td>
        <td>${created}</td>
        <td>${renderTeamDropdown(u)}</td>
        <td>${renderUserActions(u)}</td>
      </tr>
    `;
  });

  html += `</tbody></table>`;
  usersTableWrap.innerHTML = html;

  bindRoleDropdowns();
  bindTeamDropdowns();
  bindUserActions();
}

/* -----------------------------------------------------------------------
   FIXED ROLE DROPDOWN
   ----------------------------------------------------------------------- */
function renderRoleDropdown(u) {
  if (u.role === "primary") return `<strong>Primary Admin</strong>`;
  if (!isPrimary(adminState.user)) return u.role;

  return `
    <select class="input user-role-dd" data-uid="${u.id}">
      <option value="general"   ${u.role === "general"   ? "selected" : ""}>General User</option>
      <option value="secondary" ${u.role === "secondary" ? "selected" : ""}>Secondary Admin</option>
    </select>
  `;
}

function bindRoleDropdowns() {
  if (!isPrimary(adminState.user)) return;

  document.querySelectorAll(".user-role-dd").forEach(sel => {
    sel.onchange = async () => {
      const uid = sel.dataset.uid;
      const newRole = sel.value;

      await updateDoc(doc(db, "users", uid), { role: newRole });
      showPopup("Role updated.");
    };
  });
}

/* -----------------------------------------------------------------------
   FIXED TEAM DROPDOWN
   ----------------------------------------------------------------------- */
function renderTeamDropdown(u) {
  if (!isPrimary(adminState.user)) return u.teamId || "—";

  const teams = adminState.allTeams.sort((a, b) =>
    a.name.localeCompare(b.name)
  );

  const blankOption = u.teamId === "" ? "selected" : "";

  let html = `<select class="input user-team-dd" data-uid="${u.id}">`;
  html += `<option value="" ${blankOption}>— No Team —</option>`;

  teams.forEach(t => {
    html += `
      <option value="${t.id}" 
        ${u.teamId === t.id ? "selected" : ""}>
        ${t.name}
      </option>`;
  });

  html += `</select>`;
  return html;
}

function bindTeamDropdowns() {
  if (!isPrimary(adminState.user)) return;

  document.querySelectorAll(".user-team-dd").forEach(sel => {
    sel.onchange = async () => {
      const uid = sel.dataset.uid;
      const newTeam = sel.value;

      await updateDoc(doc(db, "users", uid), { teamId: newTeam });

      showPopup(`Team updated${newTeam ? "" : " (removed)"}.`);
    };
  });
}



/* ---------- USER ACTIONS ---------- */
function renderUserActions(u) {
  if (!isPrimary(adminState.user)) return "";

  if (u.status === "pending") {
    return `
      <button class="action-btn" data-approve="${u.id}">Approve</button>
      <button class="action-btn" data-reject="${u.id}">Reject</button>
    `;
  }

  return `<button class="action-btn" data-remove="${u.id}">Remove</button>`;
}

/* -----------------------------------------------------------------------
   USER ACTION BUTTONS (Approve / Reject / Remove)
   ----------------------------------------------------------------------- */
function bindUserActions() {
  document.querySelectorAll("[data-approve]").forEach(btn => {
    btn.onclick = async () => {
      await updateDoc(doc(db, "users", btn.dataset.approve), {
        status: "approved"
      });
      showPopup("User approved.");
    };
  });

  document.querySelectorAll("[data-reject]").forEach(btn => {
    btn.onclick = async () => {
      await updateDoc(doc(db, "users", btn.dataset.reject), {
        status: "rejected"
      });
      showPopup("User rejected.");
    };
  });

  document.querySelectorAll("[data-remove]").forEach(btn => {
    btn.onclick = async () => {
      const uid = btn.dataset.remove;
      if (uid === adminState.user.uid)
        return showPopup("You cannot remove yourself.");

      if (!confirm("Remove user permanently?")) return;

      await deleteDoc(doc(db, "users", uid));
      showPopup("User removed.");
    };
  });
}

/* =======================================================================
   CASCADE DELETE — DELETE ALL CASES FOR A TEAM
   ======================================================================= */
async function deleteAllCasesForTeam(teamId) {
  const casesSnap = await getDocs(
    query(collection(db, "cases"), where("teamId", "==", teamId))
  );

  const batchLimit = 450;  // Firestore batch limit safe-zone
  let batch = [];
  let counter = 0;

  for (const docSnap of casesSnap.docs) {
    batch.push(deleteDoc(doc(db, "cases", docSnap.id)));
    counter++;

    // Execute in chunks to avoid failures
    if (counter >= batchLimit) {
      await Promise.all(batch);
      batch = [];
      counter = 0;
    }
  }

  if (batch.length > 0) {
    await Promise.all(batch);
  }
}




/* ============================================================
   SECTION 5 — UPDATE DATA ENGINE (Excel + Backup)
   ============================================================ */

// Excel parsing (SheetJS available globally)
function readExcelFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const wb = XLSX.read(new Uint8Array(e.target.result), { type: "array" });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      resolve(XLSX.utils.sheet_to_json(sheet, { header: 1 }));
    };
    reader.onerror = reject;
    reader.readAsArrayBuffer(file);
  });
}

function excelToDate(num) {
  if (!num) return "";
  const epoch = new Date(1899, 11, 30);
  const d = new Date(epoch.getTime() + num * 86400000);
  return d.toISOString().split("T")[0];
}

let selectedUploadTeam = null;
let excelCases = [];
let firestoreCases = [];

updateTeamList.addEventListener("click", async (e) => {
  const btn = e.target.closest("button");
  if (!btn) return;

  const action = btn.dataset.action;
  const teamId = btn.dataset.id;

  if (!isPrimary(adminState.user)) {
    showPopup("Only primary admin can update data.");
    return;
  }

  if (action === "upload") {
    selectedUploadTeam = teamId;
    uploadSummary.innerHTML = `<strong>Selected Team:</strong> ${teamId}`;
  }

  if (action === "export") exportBackup(teamId);
  if (action === "import") importBackupPrompt(teamId);
});

btnProcessExcel.onclick = async () => {
  if (!selectedUploadTeam) return showPopup("Choose a team.");
  const file = excelInput.files[0];
  if (!file) return showPopup("Select an Excel file.");

  uploadSummary.innerHTML = "Reading file...";
  const rows = await readExcelFile(file);

  firestoreCases = [];
  const snap = await getDocs(collection(db, "cases"));
  snap.forEach(d => {
    if (d.data().teamId === selectedUploadTeam)
      firestoreCases.push({ id: d.id, ...d.data() });
  });

  excelCases = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r[0]) continue;

    const id = String(r[0]).trim();
    const existing = firestoreCases.find(x => x.id === id);

    excelCases.push({
      id,
      customerName: r[1] || "",
      createdOn: excelToDate(r[2]),
      createdBy: r[3] || "",
      country: r[6] || "",
      caseResolutionCode: r[8] || "",
      caseOwner: r[9] || "",
      caGroup: r[17] || "",
      tl: r[20] || "",
      sbd: r[29] || "",
      onsiteRFC: r[33] || "",
      csrRFC: r[34] || "",
      benchRFC: r[35] || "",
      status: existing?.status || "",
      followDate: existing?.followDate || null,
      flagged: existing?.flagged || false,
      notes: existing?.notes || "",
      lastActionedOn: existing?.lastActionedOn || "",
      lastActionedBy: existing?.lastActionedBy || "",
      teamId: selectedUploadTeam,
    });
  }

  uploadSummary.innerHTML = `
    Excel loaded.<br>
    Total rows: ${excelCases.length}
  `;
};

btnProcessExcel.addEventListener("dblclick", async () => {
  if (!isPrimary(adminState.user)) return;
  await applyExcelChanges();
});

async function applyExcelChanges() {
  const excelMap = new Map(excelCases.map(c => [c.id, c]));
  const fsMap = new Map(firestoreCases.map(c => [c.id, c]));

  const newCases = [];
  const updated = [];
  const deleted = [];

  for (const ex of excelCases) {
    const fs = fsMap.get(ex.id);
    if (!fs) newCases.push(ex);
    else {
      const changed =
        ex.customerName !== fs.customerName ||
        ex.createdOn !== fs.createdOn ||
        ex.createdBy !== fs.createdBy ||
        ex.country !== fs.country ||
        ex.caseResolutionCode !== fs.caseResolutionCode ||
        ex.caseOwner !== fs.caseOwner ||
        ex.caGroup !== fs.caGroup ||
        ex.tl !== fs.tl ||
        ex.sbd !== fs.sbd ||
        ex.onsiteRFC !== fs.onsiteRFC ||
        ex.csrRFC !== fs.csrRFC ||
        ex.benchRFC !== fs.benchRFC;

      if (changed) updated.push(ex);
    }
  }

  for (const fs of firestoreCases)
    if (!excelMap.has(fs.id)) deleted.push(fs);

  for (const c of newCases)
    await setDoc(doc(db, "cases", c.id), c);

  for (const c of updated)
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
    });

  for (const c of deleted)
    await deleteDoc(doc(db, "cases", c.id));

  uploadSummary.innerHTML = `
    <strong>Update Complete</strong><br>
    New: ${newCases.length}<br>
    Updated: ${updated.length}<br>
    Deleted: ${deleted.length}<br>
  `;
}



/* ============================================================
   BACKUP EXPORT / IMPORT
   ============================================================ */
async function exportBackup(teamId) {
  const snap = await getDocs(collection(db, "cases"));
  const cases = [];

  snap.forEach(d => {
    if (d.data().teamId === teamId)
      cases.push({ id: d.id, ...d.data() });
  });

  const blob = new Blob([JSON.stringify(cases, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const today = new Date().toISOString().split("T")[0];
  a.href = url;
  a.download = `${teamId}_backup_${today}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

function importBackupPrompt(teamId) {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = ".json";

  input.onchange = async () => {
    const file = input.files[0];
    if (!file) return;

    const text = await file.text();
    const data = JSON.parse(text);

    if (!confirm("This will overwrite ALL cases for this team. Continue?"))
      return;

    await importBackup(teamId, data);
  };

  input.click();
}

async function importBackup(teamId, cases) {
  const snap = await getDocs(collection(db, "cases"));
  snap.forEach(async d => {
    if (d.data().teamId === teamId)
      await deleteDoc(doc(db, "cases", d.id));
  });

  for (const c of cases)
    await setDoc(doc(db, "cases", c.id), c);

  uploadSummary.innerHTML = `
    <strong>Backup Imported</strong><br>
    Cases: ${cases.length}
  `;
}



/* ============================================================
   SECTION 6 — STATS ENGINE
   ============================================================ */
/* ============================================================================
   ADMIN PHASE C1 — STATS ENGINE (DATA MODEL)
   ============================================================================ */

/*
  INPUT:
    - adminState.allCases = ALL cases from Firestore (admin-level access)
    - adminState.allUsers = all users
    - adminState.selectedTeam = team selected in dropdown ("TOTAL" or teamId)
    - adminState.user = logged-in admin (primary/secondary)

  OUTPUT:
    {
      totalRow: {...},     // TEAM TOTAL
      userRows: [ {...} ]  // one per user
    }
*/

async function computeStatsEngine() {
  const cases = adminState.allCases;
  const users = adminState.allUsers;
  const today = new Date().toISOString().split("T")[0];

  let filteredCases;

  /* =============================================================
     TEAM FILTERING
     -------------------------------------------------------------
     Option A: 
       Secondary admin sees only their own team.
       Primary admin sees selected team only.

     Option B (Primary Admin TOTAL mode):
       Team = "TOTAL" → show all cases.
     ============================================================= */
  if (!isPrimary(adminState.user)) {
    // NON-PRIMARY → force their own team only
    filteredCases = cases.filter(c => c.teamId === adminState.user.teamId);
  } else {
    if (adminState.selectedTeam === "TOTAL") {
      filteredCases = [...cases]; // All cases across all teams
    } else {
      filteredCases = cases.filter(c => c.teamId === adminState.selectedTeam);
    }
  }

  /* =============================================================
     Build stats for each user
     ============================================================= */
  const rows = [];

  for (const u of users) {
    // Secondary/general users only show their own team rows
    if (!isPrimary(adminState.user)) {
      if (u.teamId !== adminState.user.teamId) continue;
    }

    // Primary admin (team mode) → include only users of that team
    if (isPrimary(adminState.user) && adminState.selectedTeam !== "TOTAL") {
      if (u.teamId !== adminState.selectedTeam) continue;
    }

    // Compute metrics
    const userCases = filteredCases.filter(r => r.lastActionedBy === u.id);

    // Total Actioned = Unique case count
    const totalActioned = new Set(userCases.map(r => r.id)).size;

    // Closed Today
    const closedToday = userCases.filter(
      r => r.lastActionedOn === today && r.status === "Closed"
    );

    const closedTodayCount = closedToday.length;

    // Met / Not Met
    const met = closedToday.filter(r => (r.sbd || "").toLowerCase() === "met").length;
    const notMet = closedToday.filter(r => (r.sbd || "").toLowerCase() === "not met").length;

    const metPct = closedTodayCount ? Math.round((met / closedTodayCount) * 100) : 0;
    const notMetPct = closedTodayCount ? Math.round((notMet / closedTodayCount) * 100) : 0;

    // SP/MON No Follow (ALL-TIME)
    const spMonNoFollow = userCases.filter(
      r =>
        (!r.followDate || r.followDate.trim() === "") &&
        (r.status === "Service Pending" || r.status === "Monitoring")
    ).length;

    // Follow-ups X (follow today), Y (follow overdue)
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
      closedToday: closedTodayCount,
      met,
      metPct,
      notMet,
      notMetPct,
      spMonNoFollow,
      followX,
      followY
    });
  }

  /* =============================================================
     TEAM TOTAL ROW
     (sum of all user rows currently displayed)
     ============================================================= */
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

  // Recompute percentages for TOTAL row
  total.metPct = total.closedToday ? Math.round((total.met / total.closedToday) * 100) : 0;
  total.notMetPct = total.closedToday ? Math.round((total.notMet / total.closedToday) * 100) : 0;

  /* =============================================================
     RETURN FINAL STATS OBJECT
     ============================================================= */
  return {
    totalRow: total,
    userRows: rows
  };
}

/* ============================================================================
   ADMIN PHASE C2 — STATS RENDERING + BINDINGS
   (Drop this in place of the old SECTION 6 block you removed)
   ============================================================================ */

/*
  This block expects the following globals (already present earlier in your file):
    - statsCases  (keeps latest cases from onSnapshot)
    - allUsers    (loaded by loadAllUsersForStats())
    - adminState.selectedStatsTeam
    - adminState.user
    - isPrimary() helper
    - isSecondary() helper
    - showPopup() helper
*/

function computeStatsEngineAdaptive(casesList, usersList) {
  const today = new Date().toISOString().split("T")[0];

  // TEAM FILTERING
  let filteredCases;
  if (!isPrimary(adminState.user)) {
    filteredCases = casesList.filter(c => c.teamId === adminState.user.teamId);
  } else {
    if (adminState.selectedStatsTeam === "TOTAL") {
      filteredCases = [...casesList];
    } else {
      filteredCases = casesList.filter(c => c.teamId === adminState.selectedStatsTeam);
    }
  }

  // Prepare rows per user (only include users matching team visibility)
  const rows = [];

  for (const u of usersList) {
    // enforce visibility rules
    if (!isPrimary(adminState.user)) {
      if (u.teamId !== adminState.user.teamId) continue;
    } else {
      if (adminState.selectedStatsTeam !== "TOTAL" && u.teamId !== adminState.selectedStatsTeam) continue;
    }

         // Cases owned by this user (needed for other metrics)
    const userCases = filteredCases.filter(r => r.lastActionedBy === u.id);


    // STATUS UPDATED TODAY (only statusChangedOn matters, not lastActionedOn)
const todayCases = filteredCases.filter(r =>
  r.statusChangedOn === today && r.statusChangedBy === u.id
);

// Unique case IDs only
const totalActioned = new Set(todayCases.map(r => r.id)).size;


    // Closed Today
    const closedTodayList = userCases.filter(r => r.lastActionedOn === today && r.status === "Closed");
    const closedToday = closedTodayList.length;

    // Met / Not Met (from closedTodayList)
    const met = closedTodayList.filter(r => (r.sbd || "").toLowerCase() === "met").length;
    const notMet = closedTodayList.filter(r => (r.sbd || "").toLowerCase() === "not met").length;
    const metPct = closedToday ? Math.round((met / closedToday) * 100) : 0;
    const notMetPct = closedToday ? Math.round((notMet / closedToday) * 100) : 0;

    // SP/MON No Follow (ALL-TIME)
    const spMonNoFollow = userCases.filter(r =>
      (r.status === "Service Pending" || r.status === "Monitoring") &&
      (!r.followDate || r.followDate.trim() === "")
    ).length;

    // Follow-ups X / Y (only non-Closed)
    const followX = userCases.filter(r => r.followDate && r.status !== "Closed" && r.followDate === today).length;
    const followY = userCases.filter(r => r.followDate && r.status !== "Closed" && r.followDate < today).length;

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

  // TEAM TOTAL = sums of rows
  const total = {
    name: "TEAM TOTAL",
    totalActioned: rows.reduce((s, r) => s + r.totalActioned, 0),
    closedToday: rows.reduce((s, r) => s + r.closedToday, 0),
    met: rows.reduce((s, r) => s + r.met, 0),
    notMet: rows.reduce((s, r) => s + r.notMet, 0),
    spMonNoFollow: rows.reduce((s, r) => s + r.spMonNoFollow, 0),
    followX: rows.reduce((s, r) => s + r.followX, 0),
    followY: rows.reduce((s, r) => s + r.followY, 0)
  };

  total.metPct = total.closedToday ? Math.round((total.met / total.closedToday) * 100) : 0;
  total.notMetPct = total.closedToday ? Math.round((total.notMet / total.closedToday) * 100) : 0;

  return { totalRow: total, userRows: rows };
}

/* RENDERING — HTML markup exactly matching your screenshot columns */
function renderStatsTableNew() {
  // compute
  const stats = computeStatsEngineAdaptive(statsCases, allUsers);

  // build table header
  const header = `
    <table style="width:100%;border-collapse:collapse;">
      <thead>
        <tr style="text-align:left;border-bottom:1px solid var(--border);">
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

  // total row first
  const t = stats.totalRow;
  const totalRowHtml = `
    <tr style="font-weight:700;background:rgba(255,255,255,0.03);">
      <td>${t.name}</td>
      <td>${t.totalActioned}</td>
      <td>${t.closedToday}</td>
      <td>${t.met} (${t.metPct}%)</td>
      <td>${t.notMet} (${t.notMetPct}%)</td>
      <td>${t.spMonNoFollow}</td>
      <td>${t.followX} / ${t.followY}</td>
      <td></td>
    </tr>
  `;

  // user rows
  const userRowsHtml = stats.userRows.map(u => `
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
  `).join("");

  const footer = `</tbody></table>`;

  statsTableWrap.innerHTML = header + totalRowHtml + userRowsHtml + footer;

  // bind audit buttons
  statsTableWrap.querySelectorAll("[data-audit]").forEach(btn => {
    btn.onclick = () => openAuditModal(btn.dataset.audit);
  });
}

/* small helper to escape HTML (reused from index.js) */
function escapeHtml(s) {
  return String(s || "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c]));
}

/* Ensure stats refresh whenever cases or users update */
function setupStatsAutoRefresh() {
  // statsCases is updated by your existing onSnapshot in subscribeStatsCases()
  // allUsers is updated by loadAllUsersForStats()
  // selected team is handled by buildTeamSelector()
  // Hook into those updates by calling renderStatsTableNew() after each update point

  // Replace previous onSnapshot callback to call renderStatsTableNew()
  // (Your existing subscribeStatsCases() already calls renderStatsTable; just replace that call with this)
}



/* ============================================================================
   ADMIN PHASE C3 — FIRESTORE OPTIMIZATION (MANUAL REFRESH MODE)
   ============================================================================ */

/*
  Replace REALTIME LISTENER with:
  - manual refresh
  - manual load on tab open
  - single read per refresh
*/



/* ------------------------------------------------------------
   Load users ONCE for stats tab
------------------------------------------------------------ */
async function loadAllUsersForStats() {
  const q = isPrimary(adminState.user)
    ? query(collection(db, "users"))
    : query(collection(db, "users"), where("teamId", "==", adminState.user.teamId));

  const snap = await getDocs(q);
  allUsers = snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

/* ------------------------------------------------------------
   Load cases ONCE for stats tab (NO realtime)
------------------------------------------------------------ */
async function loadStatsCasesOnce() {
  const snap = await getDocs(collection(db, "cases"));
  statsCases = snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

/* ------------------------------------------------------------
   Manual REFRESH button for stats tab
------------------------------------------------------------ */
function buildStatsControls() {
  statsControls.innerHTML = `
    <button class="action-btn" id="btnStatsRefresh" title="Refresh">
      🔄
    </button>
`;


  document.getElementById("btnStatsRefresh").onclick = async () => {
    showPopup("Refreshing stats...");
    await loadStatsCasesOnce();
    await loadAllUsersForStats();
    renderStatsTableNew();
  };
}

/* ------------------------------------------------------------
   Modified team selector for stats
------------------------------------------------------------ */
function buildTeamSelector() {
  statsControls.innerHTML = ""; // reset
  buildStatsControls();

  const sel = document.createElement("select");
  sel.className = "input";
sel.style.width = "auto";

  sel.id = "statsTeamSelect";
  sel.style.marginRight = "12px";

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
    await loadStatsCasesOnce();
    renderStatsTableNew();
  };

  statsControls.prepend(sel);

}

/* ------------------------------------------------------------
   Disable the old real-time stats subscription
------------------------------------------------------------ */
function subscribeStatsCases() {
  // DISABLED — realtime disabled for Option B
  // (We only load on demand using loadStatsCasesOnce)
  return;
}





