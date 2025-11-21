// tracker.js
import { auth, db } from "./firebase-config.js";
import {
  doc, getDoc, collection, onSnapshot, updateDoc
} from "https://www.gstatic.com/firebasejs/12.5.0/firebase-firestore.js";
import {
  onAuthStateChanged, signOut
} from "https://www.gstatic.com/firebasejs/12.5.0/firebase-auth.js";


// ======================================================
// GLOBALS
// ======================================================
let currentUser = null;
let userTeam = "";
let userRole = "";

let cases = [];       // Live Firestore data (raw)
let filtered = [];    // After filters are applied
let sortAscending = true;

let currentModalCase = null;


// ======================================================
// AUTH CHECK + LOAD USER PROFILE
// ======================================================
onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.href = "./login.html";
    return;
  }

  currentUser = user;

  const snap = await getDoc(doc(db, "users", user.email));
  if (!snap.exists()) {
    alert("User profile missing. Contact admin.");
    await signOut(auth);
    return;
  }

  const data = snap.data();

  if (data.status !== "approved") {
    alert("Your account is not approved.");
    await signOut(auth);
    return;
  }

  userTeam = data.team;
  userRole = data.role;

  document.getElementById("userName").innerText =
    `${data.firstName} ${data.lastName}`;

  if (userRole === "primary" || userRole === "secondary") {
    document.getElementById("btnAdmin").style.display = "inline-block";
  } else {
    document.getElementById("btnAdmin").style.display = "none";
  }

  initTracker();
});


// ======================================================
// INITIALIZE TRACKER PAGE
// ======================================================
function initTracker() {
  setupHandlers();
  buildStatusDropdown();
  loadCasesRealtime();
}


// ======================================================
// EVENT HANDLERS
// ======================================================
function setupHandlers() {

  // Logout
  document.getElementById("btnLogout").onclick = () => {
    signOut(auth);
  };

  // Admin Panel
  document.getElementById("btnAdmin").onclick = () => {
    window.location.href = "./admin.html";
  };

  // Hamburger open sidebar
  document.getElementById("btnHamburger").onclick = () => {
    document.getElementById("overlay").classList.add("show");
    document.getElementById("sidebar").classList.add("open");
  };

  // Close sidebar
  document.getElementById("btnSideClose").onclick = () => {
    document.getElementById("overlay").classList.remove("show");
    document.getElementById("sidebar").classList.remove("open");
  };

  // Apply filters from sidebar
  document.getElementById("btnSideApply").onclick = () => {
    document.getElementById("overlay").classList.remove("show");
    document.getElementById("sidebar").classList.remove("open");
    applyFilters();
  };

  // Top filters
  document.getElementById("btnApply").onclick = applyFilters;
  document.getElementById("btnClear").onclick = clearFilters;

  // Search
  document.getElementById("txtSearch").oninput = applyFilters;

  // Due Today
  document.getElementById("btnDueToday").onclick = () => {
    applyFilters("dueToday");
  };

  // Flagged
  document.getElementById("btnFlagged").onclick = () => {
    applyFilters("flagged");
  };

  // Repeating Customers
  document.getElementById("btnRepeating").onclick = () => {
    applyFilters("repeat");
  };

  // Sort date
  document.getElementById("btnSortDate").onclick = () => {
    sortAscending = !sortAscending;
    renderTable();
  };

  // Modal close
  document.getElementById("btnModalClose").onclick = () => {
    document.getElementById("modal").classList.remove("show");
  };

  // Save modal
  document.getElementById("btnModalSave").onclick = saveCaseAction;

  // Flag switch
  document.getElementById("optFlag").onclick = () => {
    const el = document.getElementById("optFlag");
    el.classList.toggle("on");
  };
}


// ======================================================
// REALTIME FIRESTORE LISTENER
// ======================================================
function loadCasesRealtime() {
  const col = collection(db, `cases_${userTeam}`);

  onSnapshot(col, (snap) => {
    cases = [];
    snap.forEach(doc => {
      cases.push({
        id: doc.id,
        ...doc.data()
      });
    });

    applyFilters();
  });
}


// ======================================================
// BUILD STATUS DROPDOWN (with checkboxes)
// ======================================================
function buildStatusDropdown() {
  const statuses = [
    "Service Pending",
    "Monitoring",
    "Customer Action Pending",
    "Awaiting Parts",
    "Awaiting Dispatch",
    "Under Repair",
    "Closed"
  ];

  const panel = document.getElementById("statusPanel");
  panel.innerHTML = "";

  statuses.forEach(st => {
    const div = document.createElement("div");
    div.style.display = "flex";
    div.style.alignItems = "center";
    div.style.gap = ".5rem";
    div.style.marginBottom = ".25rem";

    div.innerHTML = `
      <input type="checkbox" class="status-check" value="${st}">
      <span>${st}</span>
    `;
    panel.appendChild(div);
  });

  document.getElementById("statusBox").onclick = (e) => {
    if (e.target.id !== "statusPanel") {
      panel.style.display = panel.style.display === "block" ? "none" : "block";
    }
  };
}


// ======================================================
// APPLY FILTERS
// ======================================================
function applyFilters(trigger = "") {

  filtered = [...cases];

  const sText = document.getElementById("txtSearch").value.trim().toLowerCase();

  if (sText) {
    filtered = filtered.filter(c =>
      Object.values(c).some(v =>
        String(v).toLowerCase().includes(sText)
      )
    );
  }

  // Status filter
  const checks = [...document.querySelectorAll(".status-check")]
    .filter(c => c.checked)
    .map(c => c.value);

  if (checks.length > 0) {
    filtered = filtered.filter(c => checks.includes(c.status));
    document.getElementById("statusLabel").innerText =
      checks.length === 1 ? checks[0] : `${checks.length} selected`;
  } else {
    document.getElementById("statusLabel").innerText = "All Statuses";
  }

  // Date range
  const df = document.getElementById("dateFrom").value;
  const dt = document.getElementById("dateTo").value;

  if (df) {
    const d1 = new Date(df);
    filtered = filtered.filter(c => new Date(c.ModifiedOn) >= d1);
  }
  if (dt) {
    const d2 = new Date(dt);
    filtered = filtered.filter(c => new Date(c.ModifiedOn) <= d2);
  }

  // Special triggers
  if (trigger === "dueToday") {
    const today = new Date().toISOString().split("T")[0];
    filtered = filtered.filter(c => c.lastActionedBy === currentUser.email &&
      c.followDate === today
    );
  }

  if (trigger === "flagged") {
    filtered = filtered.filter(c =>
      c.lastActionedBy === currentUser.email && c.flagged === true
    );
  }

  if (trigger === "repeat") {
    const map = {};
    cases.forEach(c => {
      let name = c["Customer Name"] || "";
      map[name] = (map[name] || 0) + 1;
    });

    filtered = filtered.filter(c =>
      map[c["Customer Name"]] > 1
    );
  }

  updateBadges();
  renderTable();
}


// ======================================================
// CLEAR FILTERS
// ======================================================
function clearFilters() {
  document.getElementById("txtSearch").value = "";
  document.getElementById("dateFrom").value = "";
  document.getElementById("dateTo").value = "";

  [...document.querySelectorAll(".status-check")].forEach(c => c.checked = false);
  document.getElementById("statusLabel").innerText = "All Statuses";

  filtered = [...cases];
  updateBadges();
  renderTable();
}


// ======================================================
// BADGES — DUE TODAY + FLAGGED
// ======================================================
function updateBadges() {
  const today = new Date().toISOString().split("T")[0];

  const due = cases.filter(c =>
    c.lastActionedBy === currentUser.email &&
    c.followDate === today
  ).length;

  const flagged = cases.filter(c =>
    c.lastActionedBy === currentUser.email &&
    c.flagged === true
  ).length;

  document.getElementById("badgeDue").innerText = due;
  document.getElementById("badgeFlag").innerText = flagged;
}


// ======================================================
// RENDER TABLE
// ======================================================
function renderTable() {

  filtered.sort((a, b) => {
    let da = new Date(a.ModifiedOn);
    let db = new Date(b.ModifiedOn);
    return sortAscending ? (da - db) : (db - da);
  });

  const tb = document.getElementById("tbody");
  tb.innerHTML = "";

  filtered.forEach((c, i) => {
    const tr = document.createElement("tr");

    tr.innerHTML = `
      <td class="sno">${i + 1}</td>
      <td>${c["Case ID"]}</td>
      <td>${c["Customer Name"]}</td>
      <td>${c.Country}</td>
      <td>${c["Case Resolution Code"]}</td>
      <td>${c["Case Owner"]}</td>
      <td>${c["CA Group"]}</td>
      <td>${c.SBD}</td>
      <td>
        <select class="status-select" data-id="${c.id}">
          <option ${c.status === "Service Pending" ? "selected" : ""}>Service Pending</option>
          <option ${c.status === "Monitoring" ? "selected" : ""}>Monitoring</option>
          <option ${c.status === "Customer Action Pending" ? "selected" : ""}>Customer Action Pending</option>
          <option ${c.status === "Awaiting Parts" ? "selected" : ""}>Awaiting Parts</option>
          <option ${c.status === "Awaiting Dispatch" ? "selected" : ""}>Awaiting Dispatch</option>
          <option ${c.status === "Under Repair" ? "selected" : ""}>Under Repair</option>
          <option ${c.status === "Closed" ? "selected" : ""}>Closed</option>
        </select>
      </td>
      <td>
        <button class="btn action-btn" data-id="${c.id}">Action</button>
      </td>
    `;

    tb.appendChild(tr);
  });

  // Status change handler
  document.querySelectorAll(".status-select").forEach(sel => {
    sel.onchange = () => updateStatus(sel.dataset.id, sel.value);
  });

  // Action modal
  document.querySelectorAll(".action-btn").forEach(btn => {
    btn.onclick = () => openCaseOptions(btn.dataset.id);
  });
}


// ======================================================
// UPDATE STATUS
// ======================================================
async function updateStatus(id, newStatus) {
  const ref = doc(db, `cases_${userTeam}`, id);
  await updateDoc(ref, {
    status: newStatus,
    lastActionedOn: new Date().toISOString().split("T")[0],
    lastActionedBy: currentUser.email
  });
}


// ======================================================
// OPEN CASE ACTION MODAL
// ======================================================
function openCaseOptions(id) {

  currentModalCase = cases.find(c => c.id === id);
  if (!currentModalCase) return;

  document.getElementById("modalTitle").innerText =
    `Case ${currentModalCase["Case ID"]}`;

  document.getElementById("optLastActioned").innerText =
    currentModalCase.lastActionedOn || "—";

  document.getElementById("optLastBy").innerText =
    currentModalCase.lastActionedBy || "—";

  document.getElementById("optDate").value =
    currentModalCase.followDate || "";

  document.getElementById("optNotes").value =
    currentModalCase.notes || "";

  const f = document.getElementById("optFlag");
  if (currentModalCase.flagged) f.classList.add("on");
  else f.classList.remove("on");

  document.getElementById("modal").classList.add("show");
}


// ======================================================
// SAVE CASE ACTION
// ======================================================
async function saveCaseAction() {

  const follow = document.getElementById("optDate").value;
  const notes = document.getElementById("optNotes").value.trim();
  const flagged = document.getElementById("optFlag").classList.contains("on");

  const ref = doc(db, `cases_${userTeam}`, currentModalCase.id);

  await updateDoc(ref, {
    followDate: follow || "",
    notes: notes,
    flagged: flagged,
    lastActionedOn: new Date().toISOString().split("T")[0],
    lastActionedBy: currentUser.email
  });

  document.getElementById("modal").classList.remove("show");
}