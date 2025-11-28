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



/* ============================================================
   GLOBAL ADMIN STATE
   ============================================================ */
export const adminState = {
  user: null,
  allTeams: [],
  selectedStatsTeam: "TOTAL",
};



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
  loadAllUsersForStats();
  buildTeamSelector();
  subscribeStatsCases();
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

  el.tabStats.onclick = () => {
    el.tabStats.classList.add("active");
    el.tabUsers.classList.remove("active");
    el.sectionUsers.style.display = "none";
    el.sectionStats.style.display = "block";
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

async function deleteTeam(teamId) {
  const userSnap = await getDocs(query(collection(db, "users"), where("teamId", "==", teamId)));

  if (!userSnap.empty) {
    openReassignModal(teamId, userSnap);
    return;
  }

  await deleteDoc(doc(db, "teams", teamId));
  showPopup("Team deleted.");
  await loadTeamsForAdmin();
}


/* ---------- REASSIGN USERS ---------- */
let reassignSourceTeam = null;
let reassignUserList = [];

function openReassignModal(teamId, qs) {
  reassignSourceTeam = teamId;
  reassignUserList = [];
  qs.forEach(u => reassignUserList.push(u.id));
  populateReassignTeams();
  modalReassign.classList.add("show");
}

btnReassignClose.onclick = () => modalReassign.classList.remove("show");
btnReassignDone.onclick  = () => modalReassign.classList.remove("show");

modalReassign.addEventListener("click", (e) => {
  if (e.target === modalReassign) modalReassign.classList.remove("show");
});

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

btnReassignConfirm.onclick = async () => {
  const newTeam = reassignTeamSelect.value;
  for (const uid of reassignUserList) {
    await updateDoc(doc(db, "users", uid), { teamId: newTeam });
  }
  await deleteDoc(doc(db, "teams", reassignSourceTeam));
  showPopup("Users reassigned and team deleted.");
  modalReassign.classList.remove("show");
  await loadTeamsForAdmin();
};



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
    const created = u.createdAt?.toDate ? u.createdAt.toDate().toLocaleDateString() : "—";
    const name = `${u.firstName} ${u.lastName}`;

    html += `
      <tr>
        <td>${u.email}</td>
        <td>${name}</td>
        <td>${renderRoleDropdown(u)}</td>
        <td>${u.status}</td>
        <td>${created}</td>
        <td>${renderTeamDropdown(u)}</td>
        <td>${renderUserActions(u)}</td>
      </tr>
    `;
  });

  html += "</tbody></table>";
  usersTableWrap.innerHTML = html;

  bindRoleDropdowns();
  bindTeamDropdowns();
  bindUserActions();
}

function renderRoleDropdown(u) {
  if (u.role === "primary") return `<strong>Primary Admin</strong>`;
  if (!isPrimary(adminState.user)) return u.role;

  return `
    <select data-role-id="${u.id}" class="input">
      <option value="general"   ${u.role === "general"   ? "selected" : ""}>General User</option>
      <option value="secondary" ${u.role === "secondary" ? "selected" : ""}>Secondary Admin</option>
    </select>
  `;
}

function bindRoleDropdowns() {
  if (!isPrimary(adminState.user)) return;

  document.querySelectorAll("[data-role-id]").forEach(sel => {
    sel.onchange = async () => {
      const uid = sel.dataset.roleId;
      const role = sel.value;
      await updateDoc(doc(db, "users", uid), { role });
      showPopup("Role updated.");
    };
  });
}

function renderTeamDropdown(u) {
  if (!isPrimary(adminState.user)) return u.teamId;

  const options = adminState.allTeams
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(t => `<option value="${t.id}" ${u.teamId === t.id ? "selected" : ""}>${t.name}</option>`)
    .join("");

  return `<select data-team-id="${u.id}" class="input">${options}</select>`;
}

function bindTeamDropdowns() {
  if (!isPrimary(adminState.user)) return;

  document.querySelectorAll("[data-team-id]").forEach(sel => {
    sel.onchange = async () => {
      const uid = sel.dataset.teamId;
      const newTeam = sel.value;
      await updateDoc(doc(db, "users", uid), { teamId: newTeam });
      showPopup("Team updated.");
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

function bindUserActions() {
  document.querySelectorAll("[data-approve]").forEach(btn => {
    btn.onclick = async () => {
      await updateDoc(doc(db, "users", btn.dataset.approve), { status: "approved" });
      showPopup("User approved.");
    };
  });

  document.querySelectorAll("[data-reject]").forEach(btn => {
    btn.onclick = async () => {
      await updateDoc(doc(db, "users", btn.dataset.reject), { status: "rejected" });
      showPopup("User rejected.");
    };
  });

  document.querySelectorAll("[data-remove]").forEach(btn => {
    btn.onclick = async () => {
      const uid = btn.dataset.remove;
      if (uid === adminState.user.uid) return showPopup("Cannot remove yourself.");
      if (!confirm("Remove user?")) return;
      await deleteDoc(doc(db, "users", uid));
      showPopup("User removed.");
    };
  });
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
let statsCases = [];
let allUsers = [];

async function loadAllUsersForStats() {
  const snap = await getDocs(collection(db, "users"));
  allUsers = [];
  snap.forEach(d => allUsers.push({ id: d.id, ...d.data() }));
}

function buildTeamSelector() {
  statsControls.innerHTML = "";

  const sel = document.createElement("select");
  sel.className = "input";

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

function subscribeStatsCases() {
  let q;
  if (adminState.selectedStatsTeam === "TOTAL")
    q = query(collection(db, "cases"));
  else
    q = query(collection(db, "cases"), where("teamId", "==", adminState.selectedStatsTeam));

  onSnapshot(q, (snap) => {
    statsCases = [];
    snap.forEach(d => statsCases.push({ id: d.id, ...d.data() }));
    renderStatsTable();
  });
}

function renderStatsTable() {
  const today = new Date().toISOString().split("T")[0];
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
        spNoFD: 0,
        fdToday: 0,
        fdPast: 0
      };
    }

    const u = byUser[uid];

    if (c.lastActionedOn === today) {
      u.totalActioned++;

      if (c.status === "Closed") {
        u.closedToday++;
        const sb = (c.sbd || "").toLowerCase();
        if (sb === "met") u.met++;
        if (sb === "not met") u.notMet++;
      }

      if (c.followDate === today) u.fdToday++;
      if (c.followDate && c.followDate < today) u.fdPast++;
    }

    if ((c.status === "Service Pending" || c.status === "Monitoring") &&
        (!c.followDate || c.followDate === ""))
      u.spNoFD++;
  });

  const rows = [];
  rows.push(buildTotalRow(byUser));

  for (const uid in byUser)
    rows.push(buildUserRow(byUser[uid]));

  statsTableWrap.innerHTML = `
    <table>
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
      <tbody>${rows.join("")}</tbody>
    </table>
  `;
}


function buildTotalRow(byUser) {
  let totalA = 0, closed = 0, met = 0, notMet = 0, spNoFD = 0, fdToday = 0, fdPast = 0;

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

  const mPct = closed ? Math.round((met / closed) * 100) : 0;
  const nPct = closed ? Math.round((notMet / closed) * 100) : 0;

  return `
    <tr style="font-weight:700;background:rgba(255,255,255,0.07);">
      <td>TEAM TOTAL</td>
      <td>${totalA}</td>
      <td>${closed}</td>
      <td>${met} (${mPct}%)</td>
      <td>${notMet} (${nPct}%)</td>
      <td>${spNoFD}</td>
      <td>${fdToday} / ${fdPast}</td>
      <td></td>
    </tr>
  `;
}

function buildUserRow(u) {
  const usr = allUsers.find(x => x.id === u.userId);
  const name = usr ? `${usr.firstName} ${usr.lastName}` : "Unknown";

  const mPct = u.closedToday ? Math.round((u.met / u.closedToday) * 100) : 0;
  const nPct = u.closedToday ? Math.round((u.notMet / u.closedToday) * 100) : 0;

  return `
    <tr>
      <td>${name}</td>
      <td>${u.totalActioned}</td>
      <td>${u.closedToday}</td>
      <td>${u.met} (${mPct}%)</td>
      <td>${u.notMet} (${nPct}%)</td>
      <td>${u.spNoFD}</td>
      <td>${u.fdToday} / ${u.fdPast}</td>
      <td><button class="action-btn" data-audit="${u.userId}">Audit</button></td>
    </tr>
  `;
}


statsTableWrap.addEventListener("click", (e) => {
  const btn = e.target.closest("[data-audit]");
  if (!btn) return;
  openAuditModal(btn.dataset.audit);
});


function openAuditModal(uid) {
  const today = new Date().toISOString().split("T")[0];

  const pool = statsCases.filter(c =>
    c.lastActionedBy === uid &&
    c.lastActionedOn === today
  );

  const list = pool.sort(() => Math.random() - 0.5).slice(0, 5);

  auditList.innerHTML = list.length
    ? list.map(c => `
        <div style="padding:0.4rem;border-bottom:1px solid var(--border);">
          <strong>${c.id}</strong> — ${c.status} (${c.sbd})
        </div>
      `).join("")
    : "<p>No cases to audit.</p>";

  modalAudit.classList.add("show");
}

btnAuditClose.onclick = () => modalAudit.classList.remove("show");
btnAuditOk.onclick    = () => modalAudit.classList.remove("show");

modalAudit.addEventListener("click", (e) => {
  if (e.target === modalAudit) modalAudit.classList.remove("show");
});
