/* =========================================================
   INDEX.JS — CLEAN FINAL VERSION
   Tracker Page Logic
   ========================================================= */

/* ============================================================
   FIREBASE IMPORTS (from firebase.js only)
   ============================================================ */
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

/* ============================================================
   OTHER MODULE IMPORTS
   ============================================================ */
import {
  getUserProfile,
  isPrimary,
  isSecondary,
  isGeneral,
  getCurrentTrackerTeam,
  toggleTheme
} from "./js/userProfile.js";

import { showPopup } from "./js/utils.js";

import {
  listenToTeamCases,
  updateCase
} from "./js/firestore-api.js";

/* ============================================================
   DOM ELEMENTS
   ============================================================ */
const dom = {
  userName: document.getElementById("userName"),
  themeToggle: document.getElementById("themeToggle"),
  btnLogout: document.getElementById("btnLogout"),
  btnAdmin: document.getElementById("btnAdmin"),

  tableBody: document.getElementById("tableBody"),

  // modal
  modal: document.getElementById("modal"),
  modalClose: document.getElementById("modalClose"),
  modalCaseId: document.getElementById("modalCaseId"),
  modalCustomer: document.getElementById("modalCustomer"),
  modalStatus: document.getElementById("modalStatus"),
  modalFollowDate: document.getElementById("modalFollowDate"),
  modalNotes: document.getElementById("modalNotes"),
  modalFlag: document.getElementById("modalFlag"),
  modalSave: document.getElementById("modalSave")
};

/* ============================================================
   TRACKER STATE
   ============================================================ */
const trackerState = {
  user: null,
  teamId: null,
  unsubscribeCases: null,
  cases: [],
  selectedCaseId: null
};

/* ============================================================
   AUTH STATE LISTENER
   ============================================================ */
onAuthStateChanged(auth, async (user) => {
  if (!user) {
    location.href = "login.html";
    return;
  }

  const userDoc = await getUserProfile(user.uid);
  if (!userDoc || userDoc.status !== "approved") {
    await auth.signOut();
    return;
  }

  trackerState.user = userDoc;
  trackerState.teamId = userDoc.teamId;

  // Display name
  dom.userName.textContent = `${userDoc.firstName} ${userDoc.lastName}`;

  // Theme
  document.documentElement.dataset.theme = userDoc.theme || "dark";
  dom.themeToggle.textContent = userDoc.theme === "light" ? "🌙" : "☀️";
  dom.themeToggle.onclick = () => toggleTheme(userDoc);

  // Admin button
  dom.btnAdmin.style.display = isPrimary(userDoc) || isSecondary(userDoc)
    ? "inline-block"
    : "none";
  dom.btnAdmin.onclick = () => (location.href = "admin.html");

  // Logout
  dom.btnLogout.onclick = () => auth.signOut();

  // Begin loading cases
  startCaseListener();
});

/* ============================================================
   CASES LISTENER
   ============================================================ */
function startCaseListener() {
  if (!trackerState.teamId) return;

  if (trackerState.unsubscribeCases) {
    trackerState.unsubscribeCases();
  }

  trackerState.unsubscribeCases = onSnapshot(
    query(collection(db, "cases"), where("teamId", "==", trackerState.teamId)),
    (snap) => {
      trackerState.cases = [];
      snap.forEach((d) => trackerState.cases.push({ id: d.id, ...d.data() }));
      renderCases();
    },
    (err) => console.error("Snapshot error:", err)
  );
}

/* ============================================================
   RENDER TABLE
   ============================================================ */
function renderCases() {
  if (!dom.tableBody) return;

  dom.tableBody.innerHTML = trackerState.cases
    .map((c) => {
      return `
        <tr data-id="${c.id}">
          <td>${c.id}</td>
          <td>${c.customerName || ""}</td>
          <td>${c.status || ""}</td>
          <td>${c.followDate || ""}</td>
          <td>${c.lastActionedOn || ""}</td>
        </tr>
      `;
    })
    .join("");

  bindCaseRowClicks();
}

/* ============================================================
   BIND ROW CLICKS → OPEN MODAL
   ============================================================ */
function bindCaseRowClicks() {
  document.querySelectorAll("[data-id]").forEach((row) => {
    row.onclick = () => openCaseModal(row.dataset.id);
  });
}

/* ============================================================
   OPEN CASE MODAL
   ============================================================ */
function openCaseModal(caseId) {
  const c = trackerState.cases.find((x) => x.id === caseId);
  if (!c) return;

  trackerState.selectedCaseId = caseId;

  dom.modalCaseId.textContent = c.id;
  dom.modalCustomer.textContent = c.customerName || "";
  dom.modalStatus.value = c.status || "";
  dom.modalFollowDate.value = c.followDate || "";
  dom.modalNotes.value = c.notes || "";
  dom.modalFlag.checked = !!c.flagged;

  dom.modal.classList.add("show");
}

/* CLOSE MODAL */
dom.modalClose.onclick = () => dom.modal.classList.remove("show");
dom.modal.onclick = (e) => {
  if (e.target === dom.modal) dom.modal.classList.remove("show");
};

/* ============================================================
   SAVE CASE UPDATES
   ============================================================ */
dom.modalSave.onclick = async () => {
  if (!trackerState.selectedCaseId) return;

  const id = trackerState.selectedCaseId;
  const c = trackerState.cases.find((x) => x.id === id);
  if (!c) return;

  const updatedFields = {
    status: dom.modalStatus.value,
    followDate: dom.modalFollowDate.value,
    notes: dom.modalNotes.value,
    flagged: dom.modalFlag.checked,
    lastActionedOn: new Date().toISOString().split("T")[0],
    lastActionedBy: trackerState.user.uid
  };

  try {
    await updateCase(id, updatedFields);
    showPopup("Case updated.");
  } catch (err) {
    console.error(err);
    showPopup("Update failed.");
  }

  dom.modal.classList.remove("show");
};

/* ============================================================
   END FILE
   ============================================================ */

