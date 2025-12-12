/* =======================================================================
   PHASE 1 — CORE ENGINE REBUILD
   ======================================================================= */

import {
  auth,
  db,
  onAuthStateChanged,
  collection,
  doc,
  getDoc,
   getDocs,
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

import { listenToTeamCases, updateCase } from "./js/firestore-api.js";
import { showPopup } from "./js/utils.js";

/* =======================================================================
   DOM REFERENCES
   ======================================================================= */
const el = {
  userFullName: document.getElementById("userFullName"),
  btnTheme: document.getElementById("btnTheme"),
  btnAdmin: document.getElementById("btnAdmin"),
  btnLogout: document.getElementById("btnLogout"),
  hamburger: document.getElementById("btnHamburger"),
  sidebar: document.getElementById("sidebar"),
  overlay: document.getElementById("overlay"),

  txtSearch: document.getElementById("txtSearch"),
  dateFrom: document.getElementById("dateFrom"),
  dateTo: document.getElementById("dateTo"),

  statusBox: document.getElementById("statusBox"),
  statusLabel: document.getElementById("statusLabel"),
  statusPanel: document.getElementById("statusPanel"),

  btnApply: document.getElementById("btnApply"),
  btnClear: document.getElementById("btnClear"),

  btnDueToday: document.getElementById("btnDueToday"),
  btnFlagged: document.getElementById("btnFlagged"),
  btnRepeating: document.getElementById("btnRepeating"),
  btnUnupdated: document.getElementById("btnUnupdated"),
  btnSortDate: document.getElementById("btnSortDate"),

  badgeDue: document.getElementById("badgeDue"),
  badgeFlag: document.getElementById("badgeFlag"),
};

/* ============================================================
   TOOLTIP EDGE-PROTECTION — AUTO REALIGN ON SCREEN EDGES
   ============================================================ */
/* ============================================================
   Tooltip Edge Protection — Reposition Without Wrapping Text
   ============================================================ */
document.addEventListener("mouseover", (e) => {
  const btn = e.target.closest(".icon-btn");
  if (!btn) return;

  const tooltip = btn.querySelector(".tooltip");
  if (!tooltip) return;

  // Reset alignment
  tooltip.classList.remove("align-left", "align-right");

  // Force layout to compute size
  const rect = tooltip.getBoundingClientRect();
  const padding = 8; // small buffer from edges

  // If the tooltip goes beyond right boundary
  if (rect.right > window.innerWidth - padding) {
    tooltip.classList.add("align-right");
  }

  // If the tooltip goes beyond left boundary
  else if (rect.left < padding) {
    tooltip.classList.add("align-left");
  }
});



/* =======================================================================
   TRACKER STATE
   ======================================================================= */
export const trackerState = {
  user: null,
  teamId: null,
    teamName: "",
  allCases: [],
  filteredCases: []
};

/* Map UID → Full Name for Excel export */
const userNameMap = {};


/* =======================================================================
   UI STATE (CLEAN REBUILD)
   ======================================================================= */
const uiState = {
  search: "",
  from: "",
  to: "",
  statusList: [],
  mode: "normal",   // normal | due | flagged | repeat | unupdated | total | negative
  sortByDateAsc: null,     // null = off, true = asc, false = desc

  primaries: {
    caseResolutionCode: [],
    tl: [],
    sbd: [],
    caGroup: [],
    onsiteRFC: [],
    csrRFC: [],
    benchRFC: [],
    country: []
  }
};

let unupdatedProtect = false;
// track specific caseIds that are being updated while in Unupdated mode
const pendingUnupdated = new Set();



/* =======================================================================
   AUTH STATE LISTENER
   ======================================================================= */
onAuthStateChanged(auth, async (user) => {
  if (!user) return (location.href = "login.html");

  const userSnap = await getDoc(doc(db, "users", user.uid));
  if (!userSnap.exists()) return (location.href = "login.html");

  const data = userSnap.data();
  if (data.status !== "approved") {
    alert("Account pending approval.");
    auth.signOut();
    return;
  }

  trackerState.user = { uid: user.uid, ...data };
  trackerState.teamId = getCurrentTrackerTeam(trackerState.user);

   /* Load team name for Excel filename */
if (trackerState.teamId) {
  const teamSnap = await getDoc(doc(db, "teams", trackerState.teamId));
  trackerState.teamName = teamSnap.exists() ? teamSnap.data().name : trackerState.teamId;
}

  /* Header Initialization */
  el.userFullName.textContent = `${data.firstName} ${data.lastName}`;

   /* ------------------------------------------------------------------
   LOAD ALL USERS ONCE → Build UID → Full Name map
   ------------------------------------------------------------------ */


/* Load UID → Full Name map (SAFE per team) */
const qUsers = query(
  collection(db, "users"),
  where("teamId", "==", trackerState.teamId)
);

const usersSnap = await getDocs(qUsers);
usersSnap.forEach(d => {
  const u = d.data();
  userNameMap[d.id] = `${u.firstName} ${u.lastName}`;
});

/* Always add current user's own name (allowed by rules) */
userNameMap[trackerState.user.uid] =
  `${trackerState.user.firstName} ${trackerState.user.lastName}`;


  // Theme initialization
document.documentElement.dataset.theme = data.theme || "dark";

// Correct icons: 
// dark theme active → show ☀️ (click to switch to light)
// light theme active → show 🌙 (click to switch to dark)
el.btnTheme.textContent =
  (data.theme || "dark") === "dark" ? "☀️" : "🌙";

el.btnTheme.onclick = () => {
  toggleTheme(trackerState.user);

  const newTheme = trackerState.user.theme;
  el.btnTheme.textContent =
    newTheme === "dark" ? "☀️" : "🌙";
};


  /* Admin button */
  if (isPrimary(data) || isSecondary(data)) {
    el.btnAdmin.style.display = "inline-block";
    el.btnAdmin.onclick = () => (location.href = "admin.html");
  } else {
    el.btnAdmin.style.display = "none";
  }

   // HIDE INFO BUTTON FOR SECONDARY USERS
if (isSecondary(data)) {
  const infoBtn = document.getElementById("btnInfo");
  infoBtn.style.display = "none";     // hide button
  infoBtn.disabled = true;            // disable interaction
}


  el.btnLogout.onclick = () => auth.signOut().then(() => (location.href = "login.html"));

  setupSidebarControls();
  setupFilterControls();
  setupStatusPanel();

  setupRealtimeCases(trackerState.teamId);
});

/* =======================================================================
   REAL-TIME CASE LISTENER (OPTIMIZED)
   - NO redundant re-renders
   - Minimal Firestore reads
   ======================================================================= */
let unsubscribe = null;

function setupRealtimeCases(teamId) {
  if (unsubscribe) unsubscribe();

  unsubscribe = listenToTeamCases(teamId, (cases) => {
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
      followDate: c.followDate || "",
      flagged: !!c.flagged,
      notes: c.notes || "",
      lastActionedOn: c.lastActionedOn || "",
      lastActionedBy: c.lastActionedBy || "",

      // <-- NEW: include the status-change audit fields
     statusChangedOn: c.statusChangedOn || "",
     statusChangedBy: c.statusChangedBy || ""
    }));

    // 🚫 Prevent auto-refresh hiding the row during Unupdated mode
// 🚫 In Unupdated Mode → BLOCK realtime auto-refresh when editing
if (uiState.mode === "unupdated" && unupdatedProtect) {
    return; // completely stop refresh
}

if (uiState.mode !== "unupdated") {
    applyFilters();
} else {
    trackerState.filteredCases = trackerState.allCases.filter(r => {
    // Keep rows that are empty status OR that are currently pending an update
    if (pendingUnupdated.has(r.id)) return true;
    return !r.status || r.status.trim() === "";
});

    renderTable();
    updateBadges();
}


  });
}

/* =======================================================================
   SIDEBAR CONTROLS (FIXED — HAMBURGER WORKS NOW)
   ======================================================================= */
/* =======================================================================
   SIDEBAR CONTROLS + PRIMARY FILTER UI BUILD
   ======================================================================= */
function setupSidebarControls() {
  // Open / close
  el.hamburger.onclick = () => {
    el.sidebar.classList.add("open");
    el.overlay.classList.add("show");
  };

  el.overlay.onclick = closeSidebar;
  document.getElementById("btnSideClose").onclick = closeSidebar;

  function closeSidebar() {

     el.sidebar.classList.remove("open");
     el.overlay.classList.remove("show");

     // Collapse all filter bodies when sidebar closes
     document.querySelectorAll(".filter-body.open").forEach(body => {
       body.classList.remove("open");
     });
   }


  // Build the primary filters UI initially
  buildPrimaryFilters();

  // Sidebar apply (same behavior as page Apply)
  document.getElementById("btnSideApply").onclick = () => {

    // 1) Apply sidebar filters to state
    syncPrimaryFiltersFromUI();
    uiState.search = el.txtSearch.value.trim().toLowerCase();
    uiState.from = el.dateFrom.value;
    uiState.to = el.dateTo.value;

    applyFilters();

    // 2) Enable LOCK automatically if not already locked
    if (!rfcLocked) {
        rfcLocked = true;
        const lockBtn = document.getElementById("rfcLock");
        if (lockBtn) lockBtn.textContent = "🔒";

        // Lock ALL primary filters
        Object.keys(uiState.primaryLocks).forEach(k => {
            uiState.primaryLocks[k] = true;
        });

        buildPrimaryFilters();  // reflect lock visually
    }

    // 3) Close sidebar afterwards
    closeSidebar();

    // 4) Collapse bodies (same behavior as before)
    document.querySelectorAll(".filter-body.open").forEach(body => {
        body.classList.remove("open");
    });
};
   
}

/* =======================================================================
   PRIMARY FILTERS - Data model + UI builder + sync helpers
   - uiState.primaries already exists (object of arrays).
   - We add uiState.primaryLocks to track locked filters.
   ======================================================================= */
if (!uiState.primaryLocks) {
  uiState.primaryLocks = {
    caseResolutionCode: false,
    tl: false,
    sbd: false,
    caGroup: false,
    onsiteRFC: false,
    csrRFC: false,
    benchRFC: false,
    country: false
  };
}

/* Filter options (fixed order & labels) */
const PRIMARY_OPTIONS = {
  caseResolutionCode: ["Onsite Solution", "Offsite Solution", "Parts Shipped"],
  tl: ["Aarthi", "Sandeep", "Ratan"],
  sbd: ["Met", "Not Met", "NA"],
  caGroup: ["0-3 Days","3-5 Days","5-10 Days","10-14 Days","15-30 Days","30-60 Days","60-90 Days","> 90 Days"],
  onsiteRFC: ["Closed - Canceled","Closed - Posted","Open - Completed","Open - In Progress","Open - Scheduled","Open - Unscheduled"],
  csrRFC: ["Cancelled","Closed","POD","New","Order Pending","Ordered","Shipped"],
  benchRFC: ["Possible completed","Repair Pending"],
  country: ["Austria","Belgium","Czech Republic","Denmark","Germany","Hungary","Ireland","Jersey","Netherlands","Nigeria","Norway","South Africa","Sweden","Switzerland","United Kingdom","Luxembourg","Poland"]
};

/* Build sidebar markup for all primary filters and attach handlers */
function buildPrimaryFilters() {
  const container = document.getElementById("filtersContainer");
  container.innerHTML = ""; // reset

  Object.keys(PRIMARY_OPTIONS).forEach(key => {
    const title = keyToLabel(key);

    // top header with title + expand arrow + lock icon
    const block = document.createElement("div");
    block.className = "filter";

    block.innerHTML = `
      <div class="filter-head" data-key="${key}">
        <div class="filter-title">${title}</div>
        <div>
          <span style="margin-left:8px">▾</span>
        </div>
      </div>
      <div class="filter-body" id="filter-body-${key}">
        <div class="chips" id="chips-${key}">
          ${PRIMARY_OPTIONS[key].map(opt => `
            <label style="display:flex;align-items:center;gap:.5rem;margin-bottom:.45rem;">
              <input type="checkbox" data-key="${key}" data-value="${escapeHtml(opt)}"/>
              ${escapeHtml(opt)}
            </label>
          `).join("")}
        </div>
      </div>
    `;

    container.appendChild(block);

    // expand/collapse
    const head = block.querySelector(".filter-head");
    const body = block.querySelector(".filter-body");
    head.onclick = (e) => {
      // clicking lock should not toggle body
      if (e.target.classList.contains("lock")) return;
      body.classList.toggle("open");
    };

    // lock toggle
    // lock removed → skip lock logic entirely
const lockSpan = block.querySelector(".lock");
if (lockSpan) {
  lockSpan.onclick = (e) => {
    e.stopPropagation();
    const k = lockSpan.dataset.key;
    uiState.primaryLocks[k] = !uiState.primaryLocks[k];
    updateFilterLockedUI(k);
  };
}


    // checkbox changes
    block.querySelectorAll("input[type='checkbox']").forEach(cb => {
      cb.onchange = () => {
    const k = cb.dataset.key;
    const val = cb.dataset.value;

    // Normal update
    const set = new Set(uiState.primaries[k] || []);
    cb.checked ? set.add(val) : set.delete(val);
    uiState.primaries[k] = [...set];

    /* =======================================================
       AUTO RFC LOGIC — YOUR 3 SPECIAL RULES
       Applies ONLY when selecting inside:
       onsiteRFC, csrRFC, benchRFC
       ======================================================= */
    /* =======================================================
   AUTO RFC LOGIC — YOUR 3 SPECIAL RULES
   ======================================================= */
const rfcKeys = ["onsiteRFC", "csrRFC", "benchRFC"];

if (rfcKeys.includes(k) && cb.checked) {

    // 1) Remember currently open filter bodies
    const openFilters = Array.from(
        document.querySelectorAll(".filter-body.open")
    ).map(el => el.id.replace("filter-body-", ""));

    // 2) Clear the other RFC filters
    rfcKeys.forEach(rk => {
        if (rk !== k) uiState.primaries[rk] = [];
    });

    // 3) Clear Case Resolution Code completely
    uiState.primaries.caseResolutionCode = [];

    // 4) Apply mapping
    if (k === "onsiteRFC") {
        uiState.primaries.caseResolutionCode = ["Onsite Solution"];
    }
    if (k === "csrRFC") {
        uiState.primaries.caseResolutionCode = ["Parts Shipped"];
    }
    if (k === "benchRFC") {
        uiState.primaries.caseResolutionCode = ["Offsite Solution"];
    }

    // Delay rebuild so the checkbox click completes first
setTimeout(() => {
    // Rebuild filters
    buildPrimaryFilters();

    // Re-open previously open filters
    openFilters.forEach(key => {
        const body = document.getElementById(`filter-body-${key}`);
        if (body) body.classList.add("open");
    });
}, 0);

}

};

    });

    // initialize locks UI & checked state
    updateFilterLockedUI(key);
    // If uiState already has selections for this filter (e.g., after Clear), set checked states
    (uiState.primaries[key] || []).forEach(v => {
      const elCb = block.querySelector(`input[data-value="${cssEscapeAttr(v)}"]`);
      if (elCb) elCb.checked = true;
    });
  });
}

/* ============================================================
   READY FOR CLOSURE FILTER — BUTTON LOGIC
   ============================================================ */

let rfcLocked = false;

// Main lock toggle
document.addEventListener("click", (e) => {
    const lockBtn = e.target.closest("#rfcLock");
    if (!lockBtn) return;

    rfcLocked = !rfcLocked;
    lockBtn.textContent = rfcLocked ? "🔒" : "🔓";

    // Lock ALL primary filters
    Object.keys(uiState.primaryLocks).forEach(k => {
        uiState.primaryLocks[k] = rfcLocked;
    });

    // Remember open filters
const openFilters = Array.from(
    document.querySelectorAll(".filter-body.open")
).map(el => el.id.replace("filter-body-", ""));

buildPrimaryFilters();

// Restore open filters
openFilters.forEach(key => {
    const body = document.getElementById(`filter-body-${key}`);
    if (body) body.classList.add("open");
});


// CLEAR button — clears only primary filters
document.addEventListener("click", (e) => {

   // unlock the three RFC filters
   uiState.primaryLocks.onsiteRFC = false;
   uiState.primaryLocks.csrRFC = false;
   uiState.primaryLocks.benchRFC = false;

   
    const btn = e.target.closest("#rfcClear");
    if (!btn || rfcLocked) return;

   uiState.mode = "normal";

   // Remove RFC highlights
    document.querySelectorAll(".rfcBtn").forEach(b => b.classList.remove("active"));

    Object.keys(uiState.primaries).forEach(k => uiState.primaries[k] = []);

   // Remember open filters
const openFilters = Array.from(
    document.querySelectorAll(".filter-body.open")
).map(el => el.id.replace("filter-body-", ""));

   
    buildPrimaryFilters();

   // Restore open filters
openFilters.forEach(key => {
    const body = document.getElementById(`filter-body-${key}`);
    if (body) body.classList.add("open");
});

   
    applyFilters();
});

// Button Selection Logic
document.addEventListener("click", (e) => {
    const btn = e.target.closest(".rfcBtn");
    if (!btn || rfcLocked) return;

   // Remember which primary filters were open BEFORE RFC button click
const previouslyOpenFilters = Array.from(
    document.querySelectorAll(".filter-body.open")
).map(el => el.id.replace("filter-body-", ""));


    const type = btn.dataset.type;

   // Highlight active RFC button
document.querySelectorAll(".rfcBtn").forEach(b => b.classList.remove("active"));
btn.classList.add("active");


    // Clear all filters first
    Object.keys(uiState.primaries).forEach(k => uiState.primaries[k] = []);

    if (type === "onsite") {

       // unlock the three RFC filters
      uiState.primaryLocks.onsiteRFC = false;
      uiState.primaryLocks.csrRFC = false;
      uiState.primaryLocks.benchRFC = false;

       
       uiState.mode = "normal";
        uiState.primaries.caseResolutionCode = ["Onsite Solution"];
        uiState.primaries.onsiteRFC = [
            "Closed - Canceled",
            "Closed - Posted",
            "Open - Completed"
        ];
        buildPrimaryFilters();

previouslyOpenFilters.forEach(key => {
    const body = document.getElementById(`filter-body-${key}`);
    if (body) body.classList.add("open");
});

applyFilters();
return;
    }

    if (type === "offsite") {

       // unlock the three RFC filters
      uiState.primaryLocks.onsiteRFC = false;
      uiState.primaryLocks.csrRFC = false;
      uiState.primaryLocks.benchRFC = false;

       
       uiState.mode = "normal";
        uiState.primaries.caseResolutionCode = ["Offsite Solution"];
        uiState.primaries.benchRFC = ["Possible completed"];
        buildPrimaryFilters();
previouslyOpenFilters.forEach(key => {
    const body = document.getElementById(`filter-body-${key}`);
    if (body) body.classList.add("open");
});
applyFilters();
return;

    }

    if (type === "csr") {

       // unlock the three RFC filters
      uiState.primaryLocks.onsiteRFC = false;
      uiState.primaryLocks.csrRFC = false;
      uiState.primaryLocks.benchRFC = false;

       
       uiState.mode = "normal";
        uiState.primaries.caseResolutionCode = ["Parts Shipped"];
        uiState.primaries.csrRFC = ["Cancelled","Closed","POD"];
        buildPrimaryFilters();
previouslyOpenFilters.forEach(key => {
    const body = document.getElementById(`filter-body-${key}`);
    if (body) body.classList.add("open");
});
applyFilters();
return;

    }

    if (type === "total") {
    uiState.mode = "total";

    // Disable the 3 RFC filters only
    uiState.primaryLocks.onsiteRFC = true;
    uiState.primaryLocks.csrRFC = true;
    uiState.primaryLocks.benchRFC = true;

    buildPrimaryFilters();

    // restore open filters after rebuild
    previouslyOpenFilters.forEach(key => {
        const body = document.getElementById(`filter-body-${key}`);
        if (body) body.classList.add("open");
    });

    applyFilters();
    return;
}



      if (type === "negative") {
    uiState.mode = "negative";

    // Disable the 3 RFC filters only
    uiState.primaryLocks.onsiteRFC = true;
    uiState.primaryLocks.csrRFC = true;
    uiState.primaryLocks.benchRFC = true;

    buildPrimaryFilters();

    // restore open filters
    previouslyOpenFilters.forEach(key => {
        const body = document.getElementById(`filter-body-${key}`);
        if (body) body.classList.add("open");
    });

    applyFilters();
    return;
}


   
});


/* Helper: update lock UI */
/* Helper: update lock UI */
function updateFilterLockedUI(key) {
  const locked = !!uiState.primaryLocks[key];
  const body = document.getElementById(`filter-body-${key}`);
  if (!body) return;

  if (locked) {
    body.classList.add("filter-locked");
    body.style.opacity = "0.45";
    body.style.pointerEvents = "none";
  } else {
    body.classList.remove("filter-locked");
    body.style.opacity = "";
    body.style.pointerEvents = "";
  }
}


/* Synchronize UI checkboxes → uiState.primaries (called on sidebar apply) */
function syncPrimaryFiltersFromUI() {
  Object.keys(PRIMARY_OPTIONS).forEach(key => {
    const checks = Array.from(document.querySelectorAll(`#filter-body-${key} input[type="checkbox"]`));
    uiState.primaries[key] = checks.filter(c => c.checked).map(c => c.dataset.value);
  });
}

/* Utility: convert key to human label */
function keyToLabel(k) {
  const map = {
    caseResolutionCode: "Case Resolution Code",
    tl: "TL",
    sbd: "SBD",
    caGroup: "CA Group",
    onsiteRFC: "Onsite RFC Status",
    csrRFC: "CSR RFC Status",
    benchRFC: "Bench RFC Status",
    country: "Country"
  };
  return map[k] || k;
}

/* Small helper for selecting checkboxes by value */
function cssEscapeAttr(s) {
  return String(s).replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}


/* =======================================================================
   FILTER CONTROLS — APPLY, CLEAR, SEARCH, DATES
   ======================================================================= */
function setupFilterControls() {
  /* SEARCH — On Enter + On Apply */
  el.txtSearch.onkeydown = (e) => {
    if (e.key === "Enter") {
      uiState.search = el.txtSearch.value.trim().toLowerCase();
      applyFilters();
    }
  };

  /* DATE INPUTS */
  el.dateFrom.onchange = () => (uiState.from = el.dateFrom.value);
  el.dateTo.onchange = () => (uiState.to = el.dateTo.value);

  /* APPLY */
    /* APPLY */
  el.btnApply.onclick = () => {
    uiState.search = el.txtSearch.value.trim().toLowerCase();
    uiState.from = el.dateFrom.value;
    uiState.to = el.dateTo.value;

    // Also sync any primary filter checkboxes currently visible in the sidebar
    syncPrimaryFiltersFromUI();

    applyFilters();
  };


  /* CLEAR */
    /* CLEAR */
  el.btnClear.onclick = () => {

    const totalOrNeg = (uiState.mode === "total" || uiState.mode === "negative");

    if (totalOrNeg && rfcLocked) {
       
        // Sidebar is locked → DO NOT reset mode or primaries
        // Only clear main-page filters (search, dates, status, sort)
        uiState.search = "";
        uiState.from = "";
        uiState.to = "";
        uiState.statusList = [];
        uiState.sortByDateAsc = null;

        el.txtSearch.value = "";
        el.dateFrom.value = "";
        el.dateTo.value = "";

        buildStatusPanel();
        applyFilters();
        return; // ← IMPORTANT
    }

    // NORMAL CLEAR BEHAVIOR (when sidebar not locked or other modes)
    uiState.search = "";
    uiState.from = "";
    uiState.to = "";
    uiState.statusList = [];
    uiState.mode = "normal";
   // remove highlight
   document.querySelectorAll(".rfcBtn").forEach(b => b.classList.remove("active"));
     
    uiState.sortByDateAsc = null;

    el.txtSearch.value = "";
    el.dateFrom.value = "";
    el.dateTo.value = "";

    Object.keys(uiState.primaries).forEach(key => {
        if (!uiState.primaryLocks[key]) {
            uiState.primaries[key] = [];
        }
    });

    pendingUnupdated.clear();
    unupdatedProtect = false;

    buildStatusPanel();
    buildPrimaryFilters();

    el.statusPanel.querySelectorAll("input[type='checkbox']").forEach(cb => cb.checked = false);

    applyFilters();
};



  /* MODE BUTTONS — Direct override (Option A behavior) */
  el.btnDueToday.onclick = () => { uiState.mode = "due"; applyFilters(); };
  el.btnFlagged.onclick = () => { uiState.mode = "flagged"; applyFilters(); };
  el.btnRepeating.onclick = () => { uiState.mode = "repeat"; applyFilters(); };
  el.btnUnupdated.onclick = () => { uiState.mode = "unupdated"; applyFilters(); };

  /* SORT BY DATE BUTTON */
  el.btnSortDate.onclick = () => {
    uiState.sortByDateAsc =
      uiState.sortByDateAsc === null ? false : !uiState.sortByDateAsc;
    applyFilters();
  };
}

/* =======================================================================
   STATUS PANEL (MULTI-SELECT) — APPLY ONLY AFTER CLICK
   ======================================================================= */
function setupStatusPanel() {
  buildStatusPanel();

  el.statusPanel.onclick = (e) => e.stopPropagation();   // << ADD THIS

  /* Clicking the box toggles panel */
  el.statusBox.onclick = (e) => {
    if (!e.target.closest("input"))
      toggleStatusPanel();
  };


  /* Clicking outside closes panel */
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

function buildStatusPanel() {
  const statuses = ["Closed", "NCM 1", "NCM 2", "PNS", "Service Pending", "Monitoring"];

  el.statusPanel.innerHTML = statuses.map(s => `
    <label>
      <input type="checkbox" data-status="${s}"
        ${uiState.statusList.includes(s) ? "checked" : ""}/>
      ${s}
    </label>
  `).join("");

  updateStatusLabel();

  /* Record selections but DO NOT apply yet */
  el.statusPanel.onchange = (e) => {
    const c = e.target.closest("input");
    if (!c) return;
    const set = new Set(uiState.statusList);
    c.checked ? set.add(c.dataset.status) : set.delete(c.dataset.status);
    uiState.statusList = [...set];
    updateStatusLabel();
  };
}

function updateStatusLabel() {
  if (uiState.statusList.length === 0)
    el.statusLabel.textContent = "All Statuses";
  else
    el.statusLabel.textContent = uiState.statusList.join(", ");
}

/* =======================================================================
   FILTER ENGINE (REBUILT CLEANLY)
   ======================================================================= */

function restrictNcmCasesForUser(rows, user) {
  const isPrimary = user.role === "primary";
  const isGeneral = user.role === "general";

  // Secondary admin → no restriction
  if (!isPrimary && !isGeneral) return rows;

  const ncm1Selected = uiState.statusList.includes("NCM 1");
  const ncm2Selected = uiState.statusList.includes("NCM 2");

  // If neither selected → return normally
  if (!ncm1Selected && !ncm2Selected) return rows;

  return rows.filter(r => {
    if (r.status === "NCM 1" && ncm1Selected)
      return r.statusChangedBy === user.uid;

    if (r.status === "NCM 2" && ncm2Selected)
      return r.statusChangedBy === user.uid;

    return true; // all other statuses remain unaffected
  });
}



export function applyFilters() {
  // 🚫 Global protection: do NOT auto-refresh if modal process is happening in Unupdated mode
  // 🚫 Global fail-safe override:
if (uiState.mode === "unupdated" && unupdatedProtect) {
    return;   // BLOCK ALL FILTERING
}


  const today = new Date().toISOString().split("T")[0];
  let rows = [...trackerState.allCases];

  /* ===============================================================
     MODE OVERRIDES (Option A)
     =============================================================== */
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

  if (uiState.mode === "unupdated") {
    rows = rows.filter(r => {
        // Keep pending-updated rows visible
        if (pendingUnupdated.has(r.id)) return true;

        // Keep rows that are actually unupdated
        return !r.status || r.status.trim() === "";
    });

    trackerState.filteredCases = rows;
    updateBadges();
    renderTable();
    return;
}


  if (uiState.mode === "repeat") {
  const count = {};

  rows.forEach(r => {
    const name = (r.customerName || "").trim().toLowerCase();
    if (!name) return;
    count[name] = (count[name] || 0) + 1;
  });

  // keep only repeating customers
  rows = rows.filter(r =>
    count[(r.customerName || "").trim().toLowerCase()] > 1
  );

  // NEW: sort alphabetically by customerName
  rows.sort((a, b) =>
    (a.customerName || "").localeCompare(b.customerName || "")
  );

  trackerState.filteredCases = rows;
  updateBadges();
  renderTable();
  return;
}

  /* ===============================================================
   RFC MODE: TOTAL  (NEW — does NOT return early)
   =============================================================== */
if (uiState.mode === "total") {

    const onsiteList = trackerState.allCases.filter(r =>
        r.caseResolutionCode === "Onsite Solution" &&
        ["Closed - Canceled","Closed - Posted","Open - Completed"].includes(r.onsiteRFC)
    );

    const offsiteList = trackerState.allCases.filter(r =>
        r.caseResolutionCode === "Offsite Solution" &&
        r.benchRFC === "Possible completed"
    );

    const csrList = trackerState.allCases.filter(r =>
        r.caseResolutionCode === "Parts Shipped" &&
        ["Cancelled","Closed","POD"].includes(r.csrRFC)
    );

    rows = [
        ...onsiteList,
        ...offsiteList,
        ...csrList
    ];
}

/* ===============================================================
   RFC MODE: NEGATIVE (NEW — does NOT return early)
   =============================================================== */
if (uiState.mode === "negative") {

    let base = [...trackerState.allCases];

    // TOTAL building (same as total mode)
    const onsiteTotal = trackerState.allCases.filter(r =>
        r.caseResolutionCode === "Onsite Solution" &&
        ["Closed - Canceled", "Closed - Posted", "Open - Completed"]
        .includes(r.onsiteRFC)
    );

    const offsiteTotal = trackerState.allCases.filter(r =>
        r.caseResolutionCode === "Offsite Solution" &&
        r.benchRFC === "Possible completed"
    );

    const csrTotal = trackerState.allCases.filter(r =>
        r.caseResolutionCode === "Parts Shipped" &&
        ["Cancelled", "Closed", "POD"].includes(r.csrRFC)
    );

    const totalCases = [...onsiteTotal, ...offsiteTotal, ...csrTotal]
        .map(c => c.id);

    // Remove TOTAL cases
    base = base.filter(r => !totalCases.includes(r.id));

    // Remove Onsite + CA Group 0-3 / 3-5
    base = base.filter(r => !(
        r.caseResolutionCode === "Onsite Solution" &&
        ["0-3 Days", "3-5 Days"].includes(r.caGroup)
    ));

    // Remove Parts Shipped + CA Group 0-3
    base = base.filter(r => !(
        r.caseResolutionCode === "Parts Shipped" &&
        r.caGroup === "0-3 Days"
    ));

    // Remove Offsite + CA Group 0-3 / 3-5 / 5-10
    base = base.filter(r => !(
        r.caseResolutionCode === "Offsite Solution" &&
        ["0-3 Days","3-5 Days","5-10 Days"].includes(r.caGroup)
    ));

    rows = base;
}





  /* ===============================================================
     NORMAL MODE — APPLY FULL FILTER PIPELINE
     =============================================================== */

  /* SEARCH */
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

  /* DATE RANGE */
  if (uiState.from) rows = rows.filter(r => r.createdOn >= uiState.from);
  if (uiState.to) rows = rows.filter(r => r.createdOn <= uiState.to);

  /* STATUS MULTI-SELECT */
  if (uiState.statusList.length > 0)
    rows = rows.filter(r => uiState.statusList.includes(r.status));

     /* PRIMARY TABLE FILTERS (AND across filters; OR within each filter's options) */
  // For each primary filter, if selection exists, keep rows matching any of its options.
  Object.keys(uiState.primaries).forEach(key => {
    const sel = uiState.primaries[key] || [];
    if (!sel || sel.length === 0) return; // ignore unselected filters

    rows = rows.filter(r => {
      const val = (r[key] || "").toString();
      // For CA Group and similar columns, exact match is used; adjust if needed
      return sel.includes(val);
    });
  });


  /* SORT */
  /* SORT */
if (uiState.sortByDateAsc !== null) {
  rows.sort((a, b) =>
    uiState.sortByDateAsc
      ? a.createdOn.localeCompare(b.createdOn)
      : b.createdOn.localeCompare(a.createdOn)
  );
}

/* APPLY SPECIAL NCM FILTERING */
rows = restrictNcmCasesForUser(rows, trackerState.user);


trackerState.filteredCases = rows;
updateBadges();
renderTable();

}

/* =======================================================================
   BADGE COUNTS (GLOBAL)
   ======================================================================= */
function updateBadges() {
  const today = new Date().toISOString().split("T")[0];

  el.badgeDue.textContent = trackerState.allCases.filter(r =>
    r.lastActionedBy === trackerState.user.uid &&
    r.followDate &&
    r.followDate <= today &&
    r.status !== "Closed"
  ).length;

  el.badgeFlag.textContent = trackerState.allCases.filter(r =>
    r.lastActionedBy === trackerState.user.uid &&
    r.flagged
  ).length;
}

/* =======================================================================
   PHASE 2 — TABLE RENDER + ROW INTERACTIONS
   ======================================================================= */

const tbody = document.getElementById("tbody");

/* Escape HTML safely */
function escapeHtml(s) {
  return String(s || "").replace(/[&<>"']/g, c => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[c]));
}

/* Render Table — Clean, optimized */
export function renderTable() {
  const rows = trackerState.filteredCases;
  const today = new Date().toISOString().split("T")[0];

  tbody.innerHTML = "";

  rows.forEach((r, index) => {
    const tr = document.createElement("tr");

    /* Row Styling Logic */
    if (r.followDate && r.followDate <= today && r.status !== "Closed") {
      tr.classList.add("due-today");
    } 
    else if (r.flagged) {
      tr.classList.add("flagged");
    } 
    else if (r.notes && r.notes.trim() !== "") {
      tr.classList.add("has-notes");
    }

    /* Build row */
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

    tbody.appendChild(tr);
  });
}

/* Gear button now a proper clickable button */
function renderGearButton(caseId) {
  return `
    <button class="icon-btn" style="font-size:16px;padding:4px;margin-left:5px;"
      data-action="opts" data-id="${caseId}">
      ⚙️
    </button>
  `;
}

/* Status dropdown — NO MORE RESET BUG */
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
      ${statuses.map(s => `
        <option value="${s}" ${row.status === s ? "selected" : ""}>
          ${s}
        </option>
      `).join("")}
    </select>
  `;
}

/* =======================================================================
   ROW EVENT HANDLERS
   ======================================================================= */

/* STATUS CHANGE HANDLER */
tbody.addEventListener("change", (e) => {
  const sel = e.target.closest("select[data-action='status']");
  if (!sel) return;

  const cid = sel.dataset.id;
  const newStatus = sel.value;

  handleStatusChange(cid, newStatus);
});

/* GEAR BUTTON → OPEN MODAL */
tbody.addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-action='opts']");
  if (!btn) return;

  openCaseModal(btn.dataset.id);
});

/* DOUBLE CLICK → COPY CASE ID */
tbody.addEventListener("dblclick", (e) => {
  const cell = e.target.closest(".caseid");
  if (!cell) return;

  const text = cell.textContent.trim();
  navigator.clipboard.writeText(text);

  const toast = document.getElementById("toast");
  toast.classList.add("show");
  setTimeout(() => toast.classList.remove("show"), 800);
});

/* =======================================================================
   PHASE 3 — STATUS CHANGE ENGINE + FIRESTORE UPDATE
   ======================================================================= */

/* Modal References (shared with Phase 4) */
const modal = document.getElementById("modal");
const modalTitle = document.getElementById("modalTitle");
const modalWarning = document.getElementById("modalWarning");
const optDate = document.getElementById("optDate");
const optFlag = document.getElementById("optFlag");
const optNotes = document.getElementById("optNotes");
let notesHeightLocked = false;
const optLastActioned = document.getElementById("optLastActioned");
const optLastActionedByName = document.getElementById("optLastActionedByName"); // added for name reveal

const btnModalClose = document.getElementById("btnModalClose");
const btnModalSave = document.getElementById("btnModalSave");
const btnModalClear = document.getElementById("btnModalClear");


modalWarning.style.display = "none";


let currentModalCaseId = null;
let pendingStatusForModal = null;   // temporarily stores status chosen which requires follow-up
let prevStatusBeforeModal = null;   // to revert if modal cancelled
let requireFollowUp = false;

/* =======================================================================
   STATUS CHANGE HANDLER
   ======================================================================= */

function handleStatusChange(caseId, newStatus) {

   // FINAL FIX: protect instantly before UI auto-refresh
  if (uiState.mode === "unupdated") {
      unupdatedProtect = true;
  }

   // If we're in unupdated mode, mark this case as pending so the listener will keep it visible
if (uiState.mode === "unupdated") {
  pendingUnupdated.add(caseId);
}

   
  const today = new Date().toISOString().split("T")[0];
  const row = trackerState.allCases.find(r => r.id === caseId);
  if (!row) return;

  const needsFollow = (newStatus === "Service Pending" || newStatus === "Monitoring");

  // ❗ STORE true previous status BEFORE overwriting
  const previousStatus = row.status;

  // Update local state
  //row.status = newStatus;

  if (needsFollow) {
    prevStatusBeforeModal = previousStatus;   // FIXED
    pendingStatusForModal = newStatus;
     if (uiState.mode === "unupdated") unupdatedProtect = true;

    openCaseModal(caseId, true);
     
    if (uiState.mode !== "unupdated") {
  applyFilters();
}


    return;
  }


  // Normal statuses → update Firestore directly
  // Normal statuses → update Firestore directly
// Update Firestore, then remove pending lock for this case and refresh if needed
firestoreUpdateCase(caseId, {
  status: newStatus,
  lastActionedOn: today,
  lastActionedBy: trackerState.user.uid,
  statusChangedOn: today,
  statusChangedBy: trackerState.user.uid
}).then(() => {
  // Firestore confirmed — remove from pending set
  pendingUnupdated.delete(caseId);

  // If we are still viewing unupdated, let filters re-run (this will hide the case if it now has a status)
  if (uiState.mode === "unupdated") {
    applyFilters();
  } else {
    // otherwise refresh the normal view
    applyFilters();
  }
}).catch(err => {
  // On failure, remove pending and show popup (prevents permanent stuck case)
  pendingUnupdated.delete(caseId);
  showPopup("Failed to update case. Please try again.");
  console.error(err);
});


// CRITICAL FIX: Reset protection after finishing normal update
//if (uiState.mode === "unupdated") {
//    unupdatedProtect = false;
//}


}

/* =======================================================================
   FIRESTORE UPDATE — SAFE FOR GENERAL USERS
   ======================================================================= */

async function firestoreUpdateCase(caseId, fields) {
  try {
    await updateCase(caseId, fields);
  } catch (err) {
    showPopup("Permission restricted: only allowed fields can be updated.");
    console.error(err);
  }
}

/* =======================================================================
   OPEN CASE MODAL
   ======================================================================= */

export function openCaseModal(caseId, enforce = false) {
  requireFollowUp = enforce;
  currentModalCaseId = caseId;

  const r = trackerState.allCases.find(x => x.id === caseId);
  if (!r) return;

  modalTitle.textContent = `Case Options — ${caseId}`;

  /* Last Actioned On */
  optLastActioned.textContent =
    r.lastActionedOn ? formatDMY(r.lastActionedOn) : "—";

  /* Last Actioned By (NAME LOOKUP) */
  loadLastActionedByName(r.lastActionedBy);

  /* Follow Date */
  optDate.value = r.followDate || "";

  /* Flag */
  setFlagUI(r.flagged);

  /* Notes */
  optNotes.value = r.notes || "";

   /* Restore saved notes box height */
   const savedH = localStorage.getItem("notesBoxHeight");
if (savedH) {
  notesHeightLocked = true;       // ← prevent auto-resize overwrite
  optNotes.style.height = savedH;
} else {
  notesHeightLocked = false;      // ← normal auto-resize mode
  resizeNotes();
}



  /* Warning Block */
  if (requireFollowUp && !r.followDate) {
  const displayStatus = pendingStatusForModal || r.status || "";
  showModalWarning(`Status "${displayStatus}" needs a follow-up date.`);
} else {
  hideModalWarning();
}


  modal.classList.add("show");
   animateModalOpen();
   setTimeout(resizeNotes, 60);

}

/* =======================================================================
   LAST ACTIONED BY NAME LOOKUP
   ======================================================================= */

async function loadLastActionedByName(uid) {
  if (!uid) {
    optLastActionedByName.textContent = "—";
    optLastActionedByName.style.opacity = 0.7;
    return;
  }

  const snap = await getDoc(doc(db, "users", uid));
  if (snap.exists()) {
    const u = snap.data();
    optLastActionedByName.textContent = `${u.firstName} ${u.lastName}`;
  } else {
    optLastActionedByName.textContent = "Unknown";
  }
}

/* =======================================================================
   MODAL — FLAG SWITCH
   ======================================================================= */

function setFlagUI(on) {
  optFlag.classList.toggle("on", on);
  optFlag.setAttribute("aria-checked", on ? "true" : "false");
}
optFlag.onclick = () => {
  setFlagUI(!optFlag.classList.contains("on"));
};

/* =======================================================================
   MODAL — SAVE BUTTON
   ======================================================================= */



/* =======================================================================
   MODAL — CLOSE LOGIC
   ======================================================================= */

btnModalClose.onclick = closeModal;
modal.onclick = (e) => { if (e.target === modal) closeModal(); };

/* CLEAR BUTTON — Reset Notes + Follow-up Date */
btnModalClear.onclick = () => {
  optNotes.value = "";
  optDate.value = "";
  resizeNotes();   // keep textarea visually correct
};


function closeModal() {
  // If modal was enforcing follow-up and user cancels → revert status
   /*
  if (requireFollowUp && pendingStatusForModal && currentModalCaseId) {
    const r = trackerState.allCases.find(x => x.id === currentModalCaseId);
    if (r) {
      r.status = prevStatusBeforeModal || "";
    }
    pendingStatusForModal = null;
    prevStatusBeforeModal = null;
  }*/

  requireFollowUp = false;
  currentModalCaseId = null;

  // Animate close, THEN hide modal
  animateModalClose(() => {
    modal.classList.remove("show");
  });
   unupdatedProtect = false;

}



/* =======================================================================
   MODAL WARNINGS
   ======================================================================= */

function showModalWarning(msg) {
  modalWarning.textContent = msg;
  modalWarning.style.display = "block";
}
function hideModalWarning() {
  modalWarning.style.display = "none";
}

/* =======================================================================
   DATE FORMATTER
   ======================================================================= */

function formatDMY(iso) {
  const [y, m, d] = iso.split("-");
  return `${d}-${m}-${y}`;
}


/* =======================================================================
   PHASE 4 — MODAL UI / UX ENHANCEMENTS
   ======================================================================= */

/* Smooth modal open animation */
function animateModalOpen() {
  const card = modal.querySelector(".modal-card");
  card.style.transform = "scale(0.92)";
  card.style.opacity = "0";

  setTimeout(() => {
    card.style.transition = "all 140ms ease-out";
    card.style.transform = "scale(1)";
    card.style.opacity = "1";
  }, 10);
}

/* Smooth modal close animation */
function animateModalClose(callback) {
  const card = modal.querySelector(".modal-card");
  card.style.transition = "all 120ms ease-in";
  card.style.transform = "scale(0.92)";
  card.style.opacity = "0";

  setTimeout(() => {
    callback();
    card.style.transition = "";   // reset transition
    card.style.transform = "";
    card.style.opacity = "";
  }, 120);
}



/* Override modal close to animate */
function closeModalAnimated() {
  animateModalClose(() => modal.classList.remove("show"));
}

/* Replace close handlers */
btnModalClose.onclick = closeModal;
modal.onclick = (e) => { if (e.target === modal) closeModal(); };


/* =======================================================================
   IMPROVED FLAG SWITCH — SMOOTH SLIDE + VISUAL FEEDBACK
   ======================================================================= */



/* Optional subtle highlight for active flag */
function refreshFlagUI() {
  if (optFlag.classList.contains("on")) {
    optFlag.style.boxShadow = "0 0 4px rgba(255,107,107,0.55)";
  } else {
    optFlag.style.boxShadow = "none";
  }
}
setInterval(refreshFlagUI, 300);

/* =======================================================================
   NOTES AREA — AUTO RESIZE + SMOOTH INPUT
   ======================================================================= */

optNotes.addEventListener("input", () => {
  // If height was manually resized → do NOT auto-resize
  if (notesHeightLocked) return;

  optNotes.style.height = "auto";
  optNotes.style.height = (optNotes.scrollHeight + 6) + "px";
});


/* SAVE resized height to localStorage */
optNotes.addEventListener("mouseup", () => {
  const h = optNotes.style.height;
  if (h) {
    localStorage.setItem("notesBoxHeight", h);
    notesHeightLocked = true;   // ← lock the height once resized
  }
});



/* Initial resize when modal opens */
function resizeNotes() {
  if (notesHeightLocked) return;   // ← prevent overwriting saved height
  optNotes.style.height = "auto";
  optNotes.style.height = (optNotes.scrollHeight + 6) + "px";
}

/* FINAL unified openCaseModal override (animation + notes resize) */
// DO NOT override openCaseModal.
// Just add animation after each modal is shown.
document.addEventListener("modal:opened", () => {
  animateModalOpen();
  setTimeout(resizeNotes, 60);
});


/* ============================================================
   EXPORT EXCEL — CURRENT TABLE VIEW ONLY
   ============================================================ */

// Load XLSX if not already available
if (typeof XLSX === "undefined") {
  const script = document.createElement("script");
  script.src = "https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js";
  document.head.appendChild(script);
}

document.getElementById("btnExportExcel").onclick = () => {
  if (!trackerState.filteredCases || trackerState.filteredCases.length === 0) {
    showPopup("No cases to export.");
    return;
  }

  // Build rows for Excel
  const rows = trackerState.filteredCases.map(r => ({
    "Case ID": r.id,
    "Customer Name": r.customerName,
    "Country": r.country,
    "Case Resolution Code": r.caseResolutionCode,
    "Case Owner": r.caseOwner,
    "TL": r.tl,
    "Created On": r.createdOn,
    "CA Group": r.caGroup,
    "SBD": r.sbd,
    "Status": r.status,
    "Follow Up Date": r.followDate,
    "Flagged": r.flagged ? "Yes" : "No",
    "Notes": r.notes,
    "Last Actioned By": userNameMap[r.lastActionedBy] || r.lastActionedBy || "",
     "Last Actioned On": r.lastActionedOn,
   "Status Changed By": userNameMap[r.statusChangedBy] || r.statusChangedBy || "",
    "Status Changed On": r.statusChangedOn
  }));

  // Convert to sheet
  const ws = XLSX.utils.json_to_sheet(rows, { origin: "A1" });
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Cases");

  // Filename: Team + timestamp
  const date = new Date().toISOString().slice(0,10);
const team = trackerState.teamName || "UnknownTeam";

const filename = `KCI_Cases_${team}_${date}.xlsx`;


  XLSX.writeFile(wb, filename);

  showPopup("Excel exported successfully!");
};



/* =======================================================================
   FOLLOW-UP DATE INPUT — QUICK SELECT SHORTCUTS
   ======================================================================= */

optDate.addEventListener("contextmenu", (e) => {
  e.preventDefault();

  const today = new Date();
  const tomorrow = new Date(today.getTime() + 86400000);

  const quick = prompt(
    "Quick Follow-up:\n1 = Today\n2 = Tomorrow\n3 = +7 Days\n\nOr cancel."
  );

  if (quick === "1")
    optDate.value = today.toISOString().split("T")[0];
  else if (quick === "2")
    optDate.value = tomorrow.toISOString().split("T")[0];
  else if (quick === "3") {
    const d7 = new Date(today.getTime() + 7*86400000);
    optDate.value = d7.toISOString().split("T")[0];
  }
});

/* =======================================================================
   WARNING UI — SMALL VIBRATION EFFECT FOR ERROR
   ======================================================================= */

function shakeWarning() {
  modalWarning.style.transition = "transform 0.14s ease";
  modalWarning.style.transform = "translateX(-4px)";

  setTimeout(() => {
    modalWarning.style.transform = "translateX(4px)";
  }, 70);

  setTimeout(() => {
    modalWarning.style.transform = "translateX(0)";
  }, 140);
}

const oldShowModalWarning = showModalWarning;
showModalWarning = function(msg) {
  oldShowModalWarning(msg);
  shakeWarning();
};

/* =======================================================================
   ENHANCED SAVE BUTTON FEEDBACK
   ======================================================================= */

btnModalSave.onclick = async () => {
  btnModalSave.disabled = true;
  btnModalSave.textContent = "Saving...";

  const result = await saveModalData(); // re-route to helper below

  btnModalSave.disabled = false;
  btnModalSave.textContent = "Save";

  if (result) closeModal();
};

/* Refactor main save logic into this helper */
async function saveModalData() {
  if (!currentModalCaseId) return false;

  const caseId = currentModalCaseId;
  const r = trackerState.allCases.find(x => x.id === caseId);
  if (!r) return false;

  const today = new Date().toISOString().split("T")[0];

  const follow = optDate.value
    ? new Date(optDate.value).toISOString().split("T")[0]
    : null;

  /* Follow-up required */
  if (requireFollowUp && !follow) {
    showModalWarning("Please select a follow-up date.");
    return false;
  }
  hideModalWarning();

  r.followDate = follow;
  r.flagged = optFlag.classList.contains("on");
  r.notes = optNotes.value.trim();
  r.lastActionedOn = today;
  r.lastActionedBy = trackerState.user.uid;

    // Build the update object
  const updateObj = {
    followDate: r.followDate,
    flagged: r.flagged,
    notes: r.notes,
    lastActionedOn: today,
    lastActionedBy: trackerState.user.uid
  };

  // If the user selected Service Pending / Monitoring earlier, persist the status now
  if (pendingStatusForModal) {
    updateObj.status = pendingStatusForModal;
    updateObj.statusChangedOn = today;
    updateObj.statusChangedBy = trackerState.user.uid;
  }

  try {
    await firestoreUpdateCase(caseId, updateObj);
     // NEW: Remove pending lock for this case after modal save
pendingUnupdated.delete(caseId);

// You allowed unupdated list to refresh after modal save
if (uiState.mode === "unupdated") {
    applyFilters();
}

  } catch (err) {
    console.error(err);
    showPopup("Error updating case.");
    return false;
  }

  // clear pending vars after successful save
  pendingStatusForModal = null;
  prevStatusBeforeModal = null;


  // 🚫 Prevent auto-refresh while in Unupdated mode
if (uiState.mode !== "unupdated") {
  applyFilters();
}

  requireFollowUp = false;
  currentModalCaseId = null;
unupdatedProtect = false;

  return true;
}

/* ============================================================================
   PHASE 5 — FINAL FILTERS, REPEATING CUSTOMERS, SUMMARY MODAL, SORTING
   ============================================================================ */

/* ====================================================================
   REPEATING CUSTOMERS LOGIC
   --------------------------------------------------------------------
   A case is "repeating" if the SAME CUSTOMER NAME appears 2+ times
   in the CURRENT table (filtered or full set).
   -------------------------------------------------------------------- */

function computeRepeatingCases(rows) {
  const count = {};
  rows.forEach(r => {
    const name = (r.customerName || "").trim().toLowerCase();
    if (!name) return;
    count[name] = (count[name] || 0) + 1;
  });

  return rows.filter(r =>
    count[(r.customerName || "").trim().toLowerCase()] > 1
  );
}

/* ====================================================================
   UNUPDATED CASES (PER YOUR FINAL RULE)
   --------------------------------------------------------------------
   status == "" (EMPTY), nothing else matters.
   -------------------------------------------------------------------- */

/* NOTE:
   Phase 1 already applied this logic inside `applyFilters()` when:
   uiState.mode === "unupdated"

   We re-expose this helper for summary calculations if needed
*/
function computeUnupdated(rows) {
  return rows.filter(r => !r.status || r.status.trim() === "");
}

/* ====================================================================
   SORT BY CREATION DATE BUTTON (ASC/DESC TOGGLE)
   -------------------------------------------------------------------- */

el.btnSortDate.onclick = () => {
  uiState.sortByDateAsc =
    uiState.sortByDateAsc === null ? false : !uiState.sortByDateAsc;

  showPopup(
    uiState.sortByDateAsc === null
      ? "Sorting cleared"
      : uiState.sortByDateAsc
      ? "Sorting by oldest first"
      : "Sorting by newest first"
  );

  applyFilters();
};

/* ====================================================================
   INFO SUMMARY (MATCHES YOUR OFFLINE TRACKER EXACTLY)
   -------------------------------------------------------------------- */

const infoModal = document.getElementById("infoModal");
const infoModalBody = document.getElementById("infoModalBody");

document.getElementById("btnInfo").onclick = showSummaryInfo;
document.getElementById("btnInfoClose").onclick = () =>
  infoModal.classList.remove("show");
document.getElementById("btnInfoOk").onclick = () =>
  infoModal.classList.remove("show");
document.getElementById("btnInfoCopy").onclick = () => {
  const text = infoModalBody.textContent;

  navigator.clipboard.writeText(text)
    .then(() => {
      const toast = document.getElementById("toast");
      toast.textContent = "Copied!";
      toast.classList.add("show");
      setTimeout(() => toast.classList.remove("show"), 900);
    })
    .catch(() => {
      alert("Copy failed. Your browser may block clipboard access.");
    });
};

infoModal.onclick = (e) => {
  if (e.target === infoModal) infoModal.classList.remove("show");
};

function showSummaryInfo() {
  const uid = trackerState.user.uid;
  const today = new Date().toISOString().split("T")[0];

  const todayRows = trackerState.allCases.filter(
    r => r.lastActionedBy === uid && r.lastActionedOn === today
  );

  const closed = todayRows.filter(r => r.status === "Closed");
  const closedCount = closed.length;

  const met = closed.filter(r => (r.sbd || "").toLowerCase() === "met").length;
  const notMet = closed.filter(r => (r.sbd || "").toLowerCase() === "not met").length;

  const pct = (n) =>
    closedCount === 0 ? 0 : Math.round((n / closedCount) * 100);

  const statusBreakdown = {
    "Service Pending": 0,
    "Monitoring": 0,
    "NCM 1": 0,
    "NCM 2": 0,
    "PNS": 0
  };

  todayRows.forEach(r => {
    if (statusBreakdown[r.status] != null) statusBreakdown[r.status]++;
  });

  const totalActioned =
    closedCount +
    statusBreakdown["Service Pending"] +
    statusBreakdown["Monitoring"] +
    statusBreakdown["NCM 1"] +
    statusBreakdown["NCM 2"] +
    statusBreakdown["PNS"];

  infoModalBody.textContent =
`Total Cases Closed Today: ${closedCount}
Met: ${met} (${pct(met)}%)
Not Met: ${notMet} (${pct(notMet)}%)

Service Pending: ${statusBreakdown["Service Pending"]}
Monitoring: ${statusBreakdown["Monitoring"]}
NCM 1: ${statusBreakdown["NCM 1"]}
NCM 2: ${statusBreakdown["NCM 2"]}
PNS: ${statusBreakdown["PNS"]}

Total Actioned Today: ${totalActioned}`;

  infoModal.classList.add("show");
}

/* ====================================================================
   FINAL CONSISTENCY PASS — ENSURE FILTERS NEVER BREAK
   -------------------------------------------------------------------- */

function normalizeDate(v) {
  return v || "";
}



























































