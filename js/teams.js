// teams.js
import { auth, db } from "./firebase-config.js";
import {
  collection, addDoc, doc, updateDoc, deleteDoc,
  getDocs, onSnapshot
} from "https://www.gstatic.com/firebasejs/12.5.0/firebase-firestore.js";

import { populateDataTeams } from "./admin.js";

// ==============================================================
// GLOBALS
// ==============================================================
let teamToEdit = null;        // For rename
let teamToDelete = null;      // For delete confirm


// ==============================================================
// EXPORT — LOAD TEAMS (Real time)
// ==============================================================
export function loadTeamsList() {

  const body = document.getElementById("teamsBody");

  onSnapshot(collection(db, "teams"), (snap) => {

    body.innerHTML = "";

    snap.forEach(tDoc => {
      const t = tDoc.data();
      const name = t.name;
      const created = t.createdOn || "";

      const tr = document.createElement("tr");

      tr.innerHTML = `
        <td>${name}</td>
        <td>${created}</td>
        <td>
          <button class="btn teamRename" data-team="${name}">Rename</button>
          <button class="btn teamDelete" data-team="${name}">Delete</button>
        </td>
      `;

      body.appendChild(tr);
    });

    attachRowEvents();
    populateDataTeams();   // Refresh "Update Data" tab also
  });
}


// ==============================================================
// OPEN CREATE TEAM MODAL
// ==============================================================
export function openTeamCreateModal() {
  teamToEdit = null;

  document.getElementById("teamModalTitle").innerText = "Create Team";
  document.getElementById("teamNameInput").value = "";

  document.getElementById("teamModal").classList.add("show");

  setupSaveHandler();
}


// ==============================================================
// OPEN RENAME TEAM MODAL
// ==============================================================
export function openTeamRenameModal(teamName) {
  teamToEdit = teamName;

  document.getElementById("teamModalTitle").innerText = "Rename Team";
  document.getElementById("teamNameInput").value = teamName;

  document.getElementById("teamModal").classList.add("show");

  setupSaveHandler();
}


// ==============================================================
// SETUP SAVE HANDLER (shared for create / rename)
// ==============================================================
function setupSaveHandler() {

  document.getElementById("teamSave").onclick = async () => {

    const newName = document.getElementById("teamNameInput").value.trim();
    if (!newName) return alert("Enter team name.");

    // Close modal
    document.getElementById("teamModal").classList.remove("show");

    if (teamToEdit === null) {
      await createTeam(newName);
    } else {
      await renameTeam(teamToEdit, newName);
    }
  };

  document.getElementById("teamCancel").onclick = () => {
    document.getElementById("teamModal").classList.remove("show");
  };
}


// ==============================================================
// CREATE TEAM
// ==============================================================
async function createTeam(name) {

  // Ensure no duplicate
  const snap = await getDocs(collection(db, "teams"));
  for (const t of snap.docs) {
    if (t.data().name.toLowerCase() === name.toLowerCase()) {
      return alert("Team already exists.");
    }
  }

  await addDoc(collection(db, "teams"), {
    name: name,
    createdOn: new Date().toISOString()
  });

  alert("Team created.");
}


// ==============================================================
// RENAME TEAM
// ==============================================================
async function renameTeam(oldName, newName) {

  // Prevent duplicate names
  const snap = await getDocs(collection(db, "teams"));
  for (const t of snap.docs) {
    if (t.data().name.toLowerCase() === newName.toLowerCase() &&
        t.data().name !== oldName) {
      return alert("Team name already exists.");
    }
  }

  // Update team document
  let teamDocRef = null;

  snap.forEach(d => {
    if (d.data().name === oldName) {
      teamDocRef = doc(db, "teams", d.id);
    }
  });

  if (!teamDocRef) {
    return alert("Team not found.");
  }

  await updateDoc(teamDocRef, { name: newName });

  // Update all users belonging to the team
  const users = await getDocs(collection(db, "users"));
  users.forEach(async u => {
    if (u.data().team === oldName) {
      await updateDoc(doc(db, "users", u.id), { team: newName });
    }
  });

  // Rename case collection:
  // Firestore does NOT support "rename collection" → must copy + delete
  await renameCaseCollection(oldName, newName);

  alert("Team renamed.");
}


// ==============================================================
// RENAME CASE COLLECTION (copy → delete)
// ==============================================================
async function renameCaseCollection(oldName, newName) {
  const oldCol = `cases_${oldName}`;
  const newCol = `cases_${newName}`;

  const snap = await getDocs(collection(db, oldCol));

  // Copy
  for (const docSnap of snap.docs) {
    const ref = doc(db, newCol, docSnap.id);
    await updateDoc(ref, docSnap.data()).catch(async () => {
      // If doc doesn't exist, create it:
      await addDoc(collection(db, newCol), docSnap.data());
    });
  }

  // Delete old collection docs
  for (const docSnap of snap.docs) {
    await deleteDoc(doc(db, oldCol, docSnap.id));
  }
}


// ==============================================================
// DELETE TEAM — OPEN CONFIRM MODAL
// ==============================================================
export function openTeamDeleteConfirm(teamName) {
  teamToDelete = teamName;
  document.getElementById("confirmTeamDelete").classList.add("show");
}


// EXPORTED to admin.js:
export function setTeamDeleteId(teamName) {
  teamToDelete = teamName;
}


// ==============================================================
// DELETE TEAM (Confirm Handler)
// ==============================================================
document.getElementById("teamDeleteConfirm").onclick = async () => {

  if (!teamToDelete) return;

  const tName = teamToDelete;

  // 1) Check if any users in this team
  const usersSnap = await getDocs(collection(db, "users"));
  for (const u of usersSnap.docs) {
    if (u.data().team === tName) {
      alert("Cannot delete: Users still assigned to this team.");
      document.getElementById("confirmTeamDelete").classList.remove("show");
      return;
    }
  }

  // 2) Delete team doc
  const teamSnap = await getDocs(collection(db, "teams"));
  let delId = null;

  teamSnap.forEach(t => {
    if (t.data().name === tName) delId = t.id;
  });

  if (delId) await deleteDoc(doc(db, "teams", delId));

  // 3) Delete all cases for this team
  const caseCol = `cases_${tName}`;
  const casesSnap = await getDocs(collection(db, caseCol));

  for (const c of casesSnap.docs) {
    await deleteDoc(doc(db, caseCol, c.id));
  }

  document.getElementById("confirmTeamDelete").classList.remove("show");
  alert("Team and all case data deleted.");
};


// ==============================================================
// CANCEL DELETE TEAM MODAL
// ==============================================================
document.getElementById("teamDeleteCancel").onclick = () => {
  document.getElementById("confirmTeamDelete").classList.remove("show");
};


// ==============================================================
// ATTACH ACTION BUTTON EVENTS TO TEAM TABLE
// ==============================================================
function attachRowEvents() {
  document.querySelectorAll(".teamRename").forEach(btn => {
    btn.onclick = () => openTeamRenameModal(btn.dataset.team);
  });

  document.querySelectorAll(".teamDelete").forEach(btn => {
    btn.onclick = () => openTeamDeleteConfirm(btn.dataset.team);
  });
}