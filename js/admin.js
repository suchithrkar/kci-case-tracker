// admin.js
import { auth, db } from "./firebase-config.js";
import {
  onAuthStateChanged,
  signOut
} from "https://www.gstatic.com/firebasejs/12.5.0/firebase-auth.js";

import {
  collection, getDocs, doc, updateDoc, deleteDoc, onSnapshot
} from "https://www.gstatic.com/firebasejs/12.5.0/firebase-firestore.js";

// Imported module functions
import {
  openTeamCreateModal,
  openTeamRenameModal,
  openTeamDeleteConfirm,
  setTeamDeleteId,
  loadTeamsList
} from "./teams.js";

import {
  initExcelModuleForTeams
} from "./excel.js";

import {
  refreshStatistics
} from "./stats.js";


// ======================================================
// USER AUTH CHECK
// ======================================================
let currentUser = null;
let role = "";
let team = "";

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.href = "./login.html";
    return;
  }

  currentUser = user;

  // Load user profile
  const snap = await getDocs(collection(db, "users"));
  let profile = null;
  snap.forEach(doc => {
    if (doc.id === user.email) profile = doc.data();
  });

  if (!profile) {
    alert("User profile missing.");
    await signOut(auth);
    return;
  }

  if (profile.status !== "approved") {
    alert("Your account is not approved.");
    await signOut(auth);
    return;
  }

  role = profile.role;
  team = profile.team;

  // Secondary admin restrictions
  if (role === "secondary") {
    document.getElementById("tabData").style.display = "none";
    document.getElementById("btnNewTeam").style.display = "none";
  }

  loadTeamsList();
  loadUsers();
  setupTabs();
  setupHeaderButtons();
});


// ======================================================
// HEADER BUTTONS
// ======================================================
function setupHeaderButtons() {
  document.getElementById("btnLogout").onclick = () => signOut(auth);
  document.getElementById("btnTracker").onclick = () => {
    window.location.href = "./index.html";
  };
}


// ======================================================
// TAB SWITCHING
// ======================================================
function setupTabs() {
  const tabs = [
    { tab: "tabTeams", sec: "sectionTeams" },
    { tab: "tabUsers", sec: "sectionUsers" },
    { tab: "tabData", sec: "sectionData" },
    { tab: "tabStats", sec: "sectionStats" }
  ];

  tabs.forEach(t => {
    document.getElementById(t.tab).onclick = () => {
      tabs.forEach(x => {
        document.getElementById(x.tab).classList.remove("active");
        document.getElementById(x.sec).style.display = "none";
      });

      document.getElementById(t.tab).classList.add("active");
      document.getElementById(t.sec).style.display = "block";

      if (t.tab === "tabData") initExcelModuleForTeams();
      if (t.tab === "tabStats") refreshStatistics();
    };
  });
}


// ======================================================
// LOAD USERS (Real-Time)
// ======================================================
async function loadUsers() {
  const usersBody = document.getElementById("usersBody");

  onSnapshot(collection(db, "users"), (snap) => {
    usersBody.innerHTML = "";

    const teamsDropdownCache = {};

    // Real-time user list render
    snap.forEach(uDoc => {
      const u = uDoc.data();
      const email = u.email;

      // Name
      const fullName = `${u.firstName} ${u.lastName}`;

      const tr = document.createElement("tr");

      tr.innerHTML = `
        <td>${email}</td>
        <td>${fullName}</td>
        <td>
          <select class="input user-role" data-email="${email}">
            <option value="general" ${u.role === "general" ? "selected" : ""}>General</option>
            <option value="secondary" ${u.role === "secondary" ? "selected" : ""}>Secondary Admin</option>
            <option value="primary" ${u.role === "primary" ? "selected" : ""}>Primary Admin</option>
          </select>
        </td>
        <td>${u.status}</td>
        <td>
          <select class="input user-team" data-email="${email}">
            <option value="">None</option>
          </select>
        </td>
        <td>${u.createdOn}</td>
        <td>
          <button class="btn user-approve" data-email="${email}">Approve</button>
          <button class="btn user-reject" data-email="${email}">Reject</button>
          <button class="btn user-remove" data-email="${email}">Remove</button>
        </td>
      `;

      usersBody.appendChild(tr);

      // Populate teams into team dropdowns
      onSnapshot(collection(db, "teams"), (teamSnap) => {
        const teamSelect = tr.querySelector(".user-team");
        teamSelect.innerHTML = `<option value="">None</option>`;

        teamSnap.forEach(tDoc => {
          const t = tDoc.data().name;
          const opt = document.createElement("option");
          opt.value = t;
          opt.textContent = t;
          if (u.team === t) opt.selected = true;
          teamSelect.appendChild(opt);
        });
      });
    });

    attachUserEvents();
  });
}


// ======================================================
// ATTACH EVENTS TO USER TABLE
// ======================================================
function attachUserEvents() {

  // Approve
  document.querySelectorAll(".user-approve").forEach(btn => {
    btn.onclick = async () => {
      await updateUser(btn.dataset.email, { status: "approved" });
    };
  });

  // Reject
  document.querySelectorAll(".user-reject").forEach(btn => {
    btn.onclick = async () => {
      await updateUser(btn.dataset.email, { status: "rejected" });
    };
  });

  // Remove
  document.querySelectorAll(".user-remove").forEach(btn => {
    btn.onclick = async () => {
      if (!confirm("Remove this user?")) return;
      await deleteDoc(doc(db, "users", btn.dataset.email));
    };
  });

  // Change role
  document.querySelectorAll(".user-role").forEach(sel => {
    sel.onchange = async () => {
      const email = sel.dataset.email;

      // Secondary admin cannot assign roles
      if (role !== "primary") {
        alert("Only primary admin can change roles.");
        return;
      }

      await updateUser(email, { role: sel.value });
    };
  });

  // Assign team
  document.querySelectorAll(".user-team").forEach(sel => {
    sel.onchange = async () => {
      const email = sel.dataset.email;
      await updateUser(email, { team: sel.value });
    };
  });
}


// ======================================================
// UPDATE USER DOC
// ======================================================
async function updateUser(email, fields) {
  await updateDoc(doc(db, "users", email), fields);
}


// ======================================================
// TEAM BUTTON EVENTS
// ======================================================
document.getElementById("btnNewTeam").onclick = () => {
  openTeamCreateModal();
};


// ======================================================
// DATA TAB – POPULATE TEAMS
// ======================================================
export async function populateDataTeams() {
  const body = document.getElementById("dataBody");
  body.innerHTML = "";

  const snap = await getDocs(collection(db, "teams"));
  snap.forEach(tDoc => {
    const t = tDoc.data();

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${t.name}</td>
      <td>
        <input type="file" class="fileExcel" data-team="${t.name}">
      </td>
      <td>
        <button class="btn btnExport" data-team="${t.name}">Export</button>
      </td>
      <td>
        <input type="file" class="fileImport" data-team="${t.name}">
      </td>
    `;

    body.appendChild(tr);
  });
}


// ======================================================
// STATS
// ======================================================
document.getElementById("btnStatsRefresh").onclick = () => {
  refreshStatistics();
};