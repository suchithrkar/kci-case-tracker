/* ===============================================================
   PHASE 1 — CORE ENGINE REBUILD
   =============================================================== */

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
  statusBox: document.getElementById("statusBox"),
  statusLabel: document.getElementById("statusLabel"),
  statusPanel: document.getElementById("statusPanel"),

  btnApply: document.getElementById("btnApply"),
  btnClear: document.getElementById("btnClear"),

  btnDueToday: document.getElementById("btnDueToday"),
  btnFlagged: document.getElementById("btnFlagged"),
  btnPNS: document.getElementById("btnPNS"),
  btnRepeating: document.getElementById("btnRepeating"),
  btnUnupdated: document.getElementById("btnUnupdated"),
  btnSortDate: document.getElementById("btnSortDate"),

  badgeDue: document.getElementById("badgeDue"),
  badgeFlag: document.getElementById("badgeFlag"),
   badgePNS: document.getElementById("badgePNS"),
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

/* ============================================================
   TEAM-AWARE "TODAY" CALCULATION
   ============================================================ */
function getTeamToday(teamConfig) {
  // Backward compatibility
  const timezone = teamConfig?.resetTimezone || "UTC";
  const resetHour =
    typeof teamConfig?.resetHour === "number"
      ? teamConfig.resetHour
      : 0;

  const now = new Date();

  // Convert current moment into team timezone
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hour12: false
  });

  const parts = Object.fromEntries(
    formatter.formatToParts(now).map(p => [p.type, p.value])
  );

  let teamDate = `${parts.year}-${parts.month}-${parts.day}`;
  const teamHour = Number(parts.hour);

  // If before reset hour → still previous day
  if (teamHour < resetHour) {
    const d = new Date(`${teamDate}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() - 1);
    teamDate = d.toISOString().split("T")[0];
  }

  return teamDate;
}

function scheduleFollowUpReminder(r) {
  if (!r.followDate || !r.followTime) return;

  // Build exact timestamp
  const reminderTs = new Date(
    `${r.followDate}T${r.followTime}:00`
  ).getTime();

  const now = Date.now();
  if (reminderTs <= now) return; // past → ignore

  const delay = reminderTs - now;

   const timerId = setTimeout(() => {
     openFollowUpReminderModal(r);
   }, delay);

  followUpTimers.set(r.id, timerId);
}

function openFollowUpReminderModal(r) {
  activeReminderCase = r;

  const body = document.getElementById("followUpReminderBody");
  body.innerHTML = `
    <div><strong>Case ID:</strong> ${r.caseId || r.id}</div>
    <div><strong>Customer:</strong> ${r.customerName || "—"}</div>
    <div><strong>Follow-up scheduled:</strong>
      ${r.followDate} ${r.followTime}
    </div>
  `;

  document
    .getElementById("followUpReminderModal")
    .classList.add("show");
}

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
  statusList: [],
  mode: "normal",   // normal | due | flagged | total | negative
  unupdatedActive: false,
  repeatActive: false,
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

/* =========================================================
   FOLLOW-UP REMINDER ENGINE (PHASE 2)
   ========================================================= */

const followUpTimers = new Map(); // caseId → timeoutId

/* =========================================================
   FOLLOW-UP REMINDER MODAL (PHASE 3A)
   ========================================================= */

let activeReminderCase = null;


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

  if (teamSnap.exists()) {
    const teamData = teamSnap.data();

    trackerState.teamName = teamData.name;
    trackerState.teamConfig = {
      resetTimezone: teamData.resetTimezone || "UTC",
      resetHour:
        typeof teamData.resetHour === "number"
          ? teamData.resetHour
          : 0
    };
  } else {
    trackerState.teamName = trackerState.teamId;
    trackerState.teamConfig = { resetTimezone: "UTC", resetHour: 0 };
  }
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

      excelOrder: typeof c.excelOrder === "number" ? c.excelOrder : 999999,
       
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
      followTime: c.followTime || "",
      flagged: !!c.flagged,
      PNS: !!c.PNS,

      surveyPrediction: typeof c.surveyPrediction === "number"
        ? c.surveyPrediction
        : null,
      
      predictionComment: c.predictionComment || "",
       
      notes: c.notes || "",
      lastActionedOn: c.lastActionedOn || "",
      lastActionedBy: c.lastActionedBy || "",

      // <-- NEW: include the status-change audit fields
     statusChangedOn: c.statusChangedOn || "",
     statusChangedBy: c.statusChangedBy || ""
    }));

    // 🚫 Prevent auto-refresh hiding the row during Unupdated mode
if (uiState.unupdatedActive && unupdatedProtect) {
  return;
}

// Normal realtime refresh
applyFilters();


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

       // Close RFC Report modal if open
     const reportOverlay = document.getElementById("rfcReportOverlay");
        if (reportOverlay) {
          reportOverlay.classList.remove("show");
        }   
   }


  // Build the primary filters UI initially
  buildPrimaryFilters();

  // Sidebar apply (same behavior as page Apply)
  document.getElementById("btnSideApply").onclick = () => {

    // 1) Apply sidebar filters to state
    syncPrimaryFiltersFromUI();
    uiState.search = el.txtSearch.value.trim().toLowerCase();

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
let lastRfcMode = null;
let preventRfcHighlightReset = false;


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

});



// CLEAR button — clears only primary filters
document.addEventListener("click", (e) => {
    const btn = e.target.closest("#rfcClear");
    if (!btn) return;   // Prevents accidental unlocks on ANY other click
    if (rfcLocked) return;

    // Unlock the three RFC filters ONLY when RFC Clear is clicked
    uiState.primaryLocks.onsiteRFC = false;
    uiState.primaryLocks.csrRFC = false;
    uiState.primaryLocks.benchRFC = false;

    uiState.mode = "normal";

    if (!preventRfcHighlightReset) {
    document.querySelectorAll(".rfcBtn").forEach(b => b.classList.remove("active"));
}

    Object.keys(uiState.primaries).forEach(k => uiState.primaries[k] = []);

    const openFilters = Array.from(
        document.querySelectorAll(".filter-body.open")
    ).map(el => el.id.replace("filter-body-", ""));

    buildPrimaryFilters();

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
   lastRfcMode = type;   // remember which RFC mode is active


   // Highlight active RFC button
if (!preventRfcHighlightReset) {
    document.querySelectorAll(".rfcBtn").forEach(b => b.classList.remove("active"));
}

btn.classList.add("active");


    // Clear all filters first
    Object.keys(uiState.primaries).forEach(k => uiState.primaries[k] = []);

    if (type === "onsite") {

       // unlock the three RFC filters
      uiState.primaryLocks.onsiteRFC = false;
      uiState.primaryLocks.csrRFC = false;
      uiState.primaryLocks.benchRFC = false;

       
       uiState.mode = "onsite";
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

       
       uiState.mode = "offsite";
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

       
       uiState.mode = "csr";
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
   /* SEARCH — Enter to apply, Esc to clear & exit */
   el.txtSearch.onkeydown = (e) => {
   
     // ENTER → apply search
     if (e.key === "Enter") {
       uiState.search = el.txtSearch.value.trim().toLowerCase();
       applyFilters();
     }
   
     // ESC → clear search & exit
     if (e.key === "Escape") {
       e.preventDefault();
   
       el.txtSearch.value = "";
       uiState.search = "";
   
       applyFilters();
   
       el.txtSearch.blur();   // exit search bar
     }
   };

    /* APPLY */
  el.btnApply.onclick = () => {
    uiState.search = el.txtSearch.value.trim().toLowerCase();

    // Also sync any primary filter checkboxes currently visible in the sidebar
    syncPrimaryFiltersFromUI();

    applyFilters();
  };

    /* CLEAR */
  el.btnClear.onclick = () => {

    const rfcModes = ["onsite","offsite","csr","total","negative"];
    const set2Modes = ["due","flagged","repeat","unupdated"];
    const isRfcMode = rfcModes.includes(uiState.mode);
    const isSet2 = set2Modes.includes(uiState.mode);

    // ========== CASE 1: RFC ACTIVE + SIDEBAR LOCKED ==========
    if (rfcLocked && (isRfcMode || isSet2)) {

        // restore last known RFC mode
        if (lastRfcMode) {
            uiState.mode = lastRfcMode;
        }

        // clear ONLY main filters
        uiState.search = "";
        uiState.statusList = [];
        uiState.sortByDateAsc = null;
        updateSortIcon();

        uiState.repeatActive = false;
        uiState.unupdatedActive = false;

        el.txtSearch.value = "";

        buildStatusPanel();
        applyFilters();

        // restore highlight AFTER DOM updates
        setTimeout(() => {
            document.querySelectorAll(".rfcBtn").forEach(b => {
                b.classList.toggle("active", b.dataset.type === uiState.mode);
            });
        }, 0);

        return;
    }

    // ========== CASE 2: NOT LOCKED — NORMAL CLEAR ==========
    // normal reset
    lastRfcMode = null;
    uiState.mode = "normal";
    uiState.repeatActive = false;
    uiState.unupdatedActive = false;

    document.querySelectorAll(".rfcBtn").forEach(b => b.classList.remove("active"));

    uiState.search = "";
    uiState.statusList = [];
    uiState.sortByDateAsc = null;
    updateSortIcon();

    el.txtSearch.value = "";

    // clear primaries only if not locked
    Object.keys(uiState.primaries).forEach(key => {
        if (!uiState.primaryLocks[key]) {
            uiState.primaries[key] = [];
        }
    });

    pendingUnupdated.clear();
    unupdatedProtect = false;

    buildStatusPanel();
    buildPrimaryFilters();
    applyFilters();
};




  /* MODE BUTTONS — Direct override (Option A behavior) */
  el.btnDueToday.onclick = () => { uiState.mode = "due"; applyFilters(); };
  el.btnFlagged.onclick = () => { uiState.mode = "flagged"; applyFilters(); };
  el.btnPNS.onclick = () => {
     uiState.mode = "pns";
     applyFilters();
   };
  el.btnRepeating.onclick = () => {
     uiState.repeatActive = !uiState.repeatActive;
     applyFilters();
   };
  el.btnUnupdated.onclick = () => {
     uiState.unupdatedActive = !uiState.unupdatedActive;
     applyFilters();
   };


  /* SORT BY DATE BUTTON */
  el.btnSortDate.onclick = () => {
     if (uiState.repeatActive) return; // ⛔ ignore during repeat
  // Toggle only between DESC ↔ ASC
  uiState.sortByDateAsc =
    uiState.sortByDateAsc === true ? false : true;

  updateSortIcon();
  applyFilters();
};

}

document.addEventListener("keydown", (e) => {
  const isMac = navigator.platform.toUpperCase().includes("MAC");
  const isFind = (isMac ? e.metaKey : e.ctrlKey) && e.key.toLowerCase() === "f";

  if (isFind) {
    e.preventDefault();
    el.txtSearch.focus();
    el.txtSearch.select();
  }
});


function updateSortIcon() {
  const arrow = document.getElementById("sortArrow");
  if (!arrow) return;

  // Sorting OFF → hide badge completely
  if (uiState.sortByDateAsc === null) {
    arrow.style.display = "none";
    arrow.textContent = "";
    return;
  }

  // Sorting ON → show direction
  arrow.style.display = "inline-block";
  arrow.textContent = uiState.sortByDateAsc ? "⬆️" : "⬇️";
}


function updateSet2Highlights() {
  el.btnDueToday.classList.toggle("active", uiState.mode === "due");
  el.btnFlagged.classList.toggle("active", uiState.mode === "flagged");
  el.btnPNS.classList.toggle("active", uiState.mode === "pns");
  el.btnRepeating.classList.toggle("active", uiState.repeatActive);
  el.btnUnupdated.classList.toggle("active", uiState.unupdatedActive);
  el.btnSortDate.classList.toggle(
    "active",
    uiState.sortByDateAsc !== null
  );
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
if (uiState.unupdatedActive && unupdatedProtect) {
  return;
}


  const today = getTeamToday(trackerState.teamConfig);
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
}


  if (uiState.mode === "flagged") {
    rows = rows.filter(r =>
      r.flagged &&
      r.lastActionedBy === trackerState.user.uid
    );
  }

   if (uiState.mode === "pns") {
     rows = rows.filter(r =>
       r.PNS === true &&
       r.lastActionedBy === trackerState.user.uid
     );
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

/* ===============================================================
   REPEAT CUSTOMERS — OVERLAY FILTER
   Applies on CURRENT filtered table view
   =============================================================== */
if (uiState.repeatActive) {

  const freq = {};

  rows.forEach(r => {
    const key = normalizeCustomerName(r.customerName);
    if (!key) return;
    freq[key] = (freq[key] || 0) + 1;
  });

  rows = rows.filter(r => {
    const key = normalizeCustomerName(r.customerName);
    return key && freq[key] > 1;
  });

  // Always sort A → Z for repeat view
  rows.sort((a, b) =>
    (a.customerName || "").localeCompare(
      b.customerName || "",
      undefined,
      { sensitivity: "base" }
    )
  );
}

/* ===============================================================
   UNUPDATED CASES — OVERLAY FILTER
   Applies on CURRENT filtered table view
   =============================================================== */
if (uiState.unupdatedActive) {
  rows = rows.filter(r => {
    // Keep rows currently being edited in Unupdated mode
    if (pendingUnupdated.has(r.id)) return true;

    // True unupdated cases
    return !r.status || r.status.trim() === "";
  });
}


/* SORT */

// ⛔ Repeat view owns its sorting (Customer A → Z)
if (uiState.repeatActive) {
  // already sorted in repeat overlay — do nothing
}

// Explicit date sort (🕑 button)
else if (uiState.sortByDateAsc !== null) {
  rows.sort((a, b) =>
    uiState.sortByDateAsc
      ? a.createdOn.localeCompare(b.createdOn)
      : b.createdOn.localeCompare(a.createdOn)
  );
}

// DEFAULT — Excel row order
else {
  rows.sort((a, b) => a.excelOrder - b.excelOrder);
}




/* APPLY SPECIAL NCM FILTERING */
rows = restrictNcmCasesForUser(rows, trackerState.user);


trackerState.filteredCases = rows;
updateBadges();

updateSet2Highlights();

renderTable();

}

/* =======================================================================
   BADGE COUNTS (GLOBAL)
   ======================================================================= */
function updateBadges() {
  const today = getTeamToday(trackerState.teamConfig);

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

   el.badgePNS.textContent = trackerState.allCases.filter(r =>
     r.PNS === true &&
     r.lastActionedBy === trackerState.user.uid
   ).length;


  // RFC — Total Open Repair Cases (team-wide)
  const rfcTotalEl = document.getElementById("rfcTotalCount");
  if (rfcTotalEl) {
    rfcTotalEl.textContent = trackerState.allCases.length;
  }

}

/* =========================================================
   RFC REPORT — OPEN MODAL
   ========================================================= */

document.getElementById("rfcReportBtn")?.addEventListener("click", () => {
  buildRfcReport();
  document.getElementById("rfcReportOverlay").classList.add("show");
});

document.getElementById("btnRfcReportClose")?.addEventListener("click", () => {
  document.getElementById("rfcReportOverlay").classList.remove("show");
});

function buildRfcReport() {
  const body = document.getElementById("rfcReportBody");
  if (!body) return;

  const all = trackerState.allCases;

  /* ---------------------------------------
     TOTAL OPEN REPAIR CASES
     --------------------------------------- */
  const onsiteAll = all.filter(r => r.caseResolutionCode === "Onsite Solution");
  const offsiteAll = all.filter(r => r.caseResolutionCode === "Offsite Solution");
  const csrAll = all.filter(r => r.caseResolutionCode === "Parts Shipped");

  /* ---------------------------------------
     READY FOR CLOSURE (RFC TOTAL LOGIC)
     --------------------------------------- */
  const onsiteRFC = onsiteAll.filter(r =>
    ["Closed - Canceled","Closed - Posted","Open - Completed"].includes(r.onsiteRFC)
  );

  const offsiteRFC = offsiteAll.filter(r =>
    r.benchRFC === "Possible completed"
  );

  const csrRFC = csrAll.filter(r =>
    ["Cancelled","Closed","POD"].includes(r.csrRFC)
  );

  const totalRFC = [...onsiteRFC, ...offsiteRFC, ...csrRFC];

  /* ---------------------------------------
     OVERDUE (NEGATIVE LOGIC — SAME AS FILTER)
     --------------------------------------- */
  let overdue = [...all];

  const rfcIds = new Set(totalRFC.map(r => r.id));
  overdue = overdue.filter(r => !rfcIds.has(r.id));

  overdue = overdue.filter(r => !(
    r.caseResolutionCode === "Onsite Solution" &&
    ["0-3 Days","3-5 Days"].includes(r.caGroup)
  ));

  overdue = overdue.filter(r => !(
    r.caseResolutionCode === "Parts Shipped" &&
    r.caGroup === "0-3 Days"
  ));

  overdue = overdue.filter(r => !(
    r.caseResolutionCode === "Offsite Solution" &&
    ["0-3 Days","3-5 Days","5-10 Days"].includes(r.caGroup)
  ));

  /* ---------------------------------------
     SBD METRICS (FROM TOTAL OPEN)
     --------------------------------------- */
   const sbdMet = all.filter(
     r => (r.sbd || "").toLowerCase() === "met"
   ).length;
   
   const sbdNotMet = all.filter(
     r => (r.sbd || "").toLowerCase() === "not met"
   ).length;
   
   // NA = everything else
   const sbdNA = all.length - sbdMet - sbdNotMet;
   
   // Percentages are based on TOTAL open repair cases
   const sbdTotal = all.length;
   
   const pct = (n) =>
     sbdTotal ? ((n / sbdTotal) * 100).toFixed(1) : "0.0";

  /* ---------------------------------------
     RENDER
     --------------------------------------- */
  body.innerHTML = `

  <!-- 1. TOTAL OPEN REPAIR CASES -->
  <div class="rfc-report-card">
    <h4>Total Open Repair Cases</h4>
    <div class="rfc-report-total">${all.length}</div>

    <div class="rfc-report-line"><span>Onsite</span><span>${onsiteAll.length}</span></div>
    <div class="rfc-report-line"><span>Offsite</span><span>${offsiteAll.length}</span></div>
    <div class="rfc-report-line"><span>CSR</span><span>${csrAll.length}</span></div>
  </div>

  <!-- 2. READY FOR CLOSURE -->
  <div class="rfc-report-card">
    <h4>Total Ready for Closure</h4>
    <div class="rfc-report-total">${totalRFC.length}</div>

    <div class="rfc-report-line"><span>Onsite</span><span>${onsiteRFC.length}</span></div>
    <div class="rfc-report-line"><span>Offsite</span><span>${offsiteRFC.length}</span></div>
    <div class="rfc-report-line"><span>CSR</span><span>${csrRFC.length}</span></div>
  </div>

  <!-- 3. OVERDUE CASES -->
  <div class="rfc-report-card">
    <h4>Overdue Cases</h4>
    <div class="rfc-report-total">${overdue.length}</div>

    <div class="rfc-report-line"><span>Onsite</span>
      <span>${overdue.filter(r => r.caseResolutionCode === "Onsite Solution").length}</span>
    </div>
    <div class="rfc-report-line"><span>Offsite</span>
      <span>${overdue.filter(r => r.caseResolutionCode === "Offsite Solution").length}</span>
    </div>
    <div class="rfc-report-line"><span>CSR</span>
      <span>${overdue.filter(r => r.caseResolutionCode === "Parts Shipped").length}</span>
    </div>
  </div>

  <!-- 4. SBD -->
  <div class="rfc-report-card">
    <h4>SBD Data</h4>

    <div class="rfc-report-line">
      <span>Met</span>
      <span>${sbdMet} (${pct(sbdMet)}%)</span>
    </div>
    <div class="rfc-report-line">
      <span>Not Met</span>
      <span>${sbdNotMet} (${pct(sbdNotMet)}%)</span>
    </div>
    <div class="rfc-report-line">
     <span>NA</span>
     <span>${sbdNA} (${pct(sbdNA)}%)</span>
   </div>
  </div>

`;

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

let activeRow = null;

function setActiveRow(tr) {
  if (activeRow === tr) {
    tr.classList.remove("active-row");
    activeRow = null;
    return;
  }

  if (activeRow) activeRow.classList.remove("active-row");
  tr.classList.add("active-row");
  activeRow = tr;
}


/* Render Table — Clean, optimized */
export function renderTable() {
  const rows = trackerState.filteredCases;
  const today = getTeamToday(trackerState.teamConfig);

  // 🔁 Clear existing follow-up timers before re-render
  followUpTimers.forEach(clearTimeout);
  followUpTimers.clear();

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
    // ⏰ Schedule follow-up reminder (Phase 2)
    scheduleFollowUpReminder(r);
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
    <div class="custom-select" data-id="${row.id}">
      <div class="custom-select-trigger">
        <span>${row.status || "&nbsp;"}</span>
      </div>
      <div class="custom-options">
        ${statuses.map(s => `
           <div class="custom-option" data-value="${s}">
             ${s || "&nbsp;"}
           </div>
         `).join("")}
      </div>
    </div>
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

tbody.addEventListener("click", (e) => {
  const select = e.target.closest(".custom-select");
  if (!select) return;

  select.classList.toggle("open");

  const option = e.target.closest(".custom-option");
  if (!option) return;

  const caseId = select.dataset.id;
  const value = option.dataset.value;

  handleStatusChange(caseId, value);

  select.classList.remove("open");
});

/* Close on outside click */
document.addEventListener("click", (e) => {
  document.querySelectorAll(".custom-select.open").forEach(sel => {
    if (!sel.contains(e.target)) sel.classList.remove("open");
  });
});


/* GEAR BUTTON → OPEN MODAL */
tbody.addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-action='opts']");
  if (!btn) return;

  openCaseModal(btn.dataset.id);
});

tbody.addEventListener("click", (e) => {
  const tr = e.target.closest("tr");
  if (!tr) return;

  setActiveRow(tr);
});


/* DOUBLE CLICK → COPY CASE ID */
tbody.addEventListener("dblclick", (e) => {
  const cell = e.target.closest(".caseid");
  if (!cell) return;

  const tr = cell.closest("tr");
  if (tr) setActiveRow(tr);

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
const pnsBlock = document.getElementById("pnsResolutionBlock");
const modalTitle = document.getElementById("modalTitle");
const modalWarning = document.getElementById("modalWarning");
const optDate = document.getElementById("optDate");
const optFlag = document.getElementById("optFlag");
const optPNS = document.getElementById("optPNS");
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

/* =========================================================
   CUSTOM CALENDAR — CLICK TO OPEN
   ========================================================= */

let calendarMonth = new Date();

optDate.addEventListener("click", (e) => {
  e.stopPropagation();

  // ✅ Jump calendar to selected date's month (if exists)
  if (optDate.dataset.iso) {
    const [y, m] = optDate.dataset.iso.split("-");
    calendarMonth = new Date(Number(y), Number(m) - 1, 1);
  } else {
    calendarMonth = new Date(); // fallback to today
  }

  renderCalendar();
});

document.addEventListener("click", () => {
  closeCalendar();
});

function closeCalendar() {
  const c = document.getElementById("calendarContainer");
  c.innerHTML = "";
}

function renderCalendar() {
  const container = document.getElementById("calendarContainer");
  const today = new Date();

  const year = calendarMonth.getFullYear();
  const month = calendarMonth.getMonth();

  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const selected = optDate.dataset.iso || "";

  container.innerHTML = `
    <div class="calendar" onclick="event.stopPropagation()">
      <div class="calendar-header">
        <span class="calendar-nav" id="prevMonth">‹</span>
        <span>${calendarMonth.toLocaleString("default", { month: "long" })} ${year}</span>
        <span class="calendar-nav" id="nextMonth">›</span>
      </div>

      <div class="calendar-weekdays">
        ${["Sun","Mon","Tue","Wed","Thu","Fri","Sat"]
        .map((d, i) =>
          `<div class="${i === 0 || i === 6 ? "weekend" : ""}">${d}</div>`
        ).join("")}
      </div>

      <div class="calendar-grid">
        ${Array(firstDay).fill("").map(() => `<div></div>`).join("")}
        ${Array.from({ length: daysInMonth }, (_, i) => {
          const day = i + 1;
          const iso =
            `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;

          const isToday =
            day === today.getDate() &&
            month === today.getMonth() &&
            year === today.getFullYear();

         const weekday = new Date(iso).getDay(); // 0 = Sun, 6 = Sat
         const isWeekend = weekday === 0 || weekday === 6;
         
         return `
           <div class="calendar-day
             ${isToday ? "today" : ""}
             ${iso === selected ? "selected" : ""}
             ${isWeekend ? "weekend" : ""}"
             data-date="${iso}">
             ${day}
           </div>`;
        }).join("")}
      </div>
    </div>
  `;

  container.querySelector("#prevMonth").onclick = () => {
    calendarMonth.setMonth(calendarMonth.getMonth() - 1);
    renderCalendar();
  };

  container.querySelector("#nextMonth").onclick = () => {
    calendarMonth.setMonth(calendarMonth.getMonth() + 1);
    renderCalendar();
  };

  container.querySelectorAll(".calendar-day").forEach(d => {
    d.onclick = () => {
     const iso = d.dataset.date;      // YYYY-MM-DD
     optDate.dataset.iso = iso;       // store internally
     optDate.value = formatDMY(iso);  // show DD-MM-YYYY
     closeCalendar();
   };
  });
}


// =====================================================
// CLOSURE SURVEY — STAR RATING STATE
// =====================================================

let selectedStars = 0;

const starContainer = document.getElementById("starRating");

if (starContainer) {
  starContainer.querySelectorAll("span").forEach(star => {
    star.onclick = () => {
      selectedStars = Number(star.dataset.star);

      starContainer.querySelectorAll("span").forEach(s => {
        s.classList.toggle(
          "active",
          Number(s.dataset.star) <= selectedStars
        );
      });
    };
  });
}



/* =======================================================================
   STATUS CHANGE HANDLER
   ======================================================================= */

function handleStatusChange(caseId, newStatus) {

   // FINAL FIX: protect instantly before UI auto-refresh
if (uiState.unupdatedActive) {
  unupdatedProtect = true;
  pendingUnupdated.add(caseId);
}


   
  const today = getTeamToday(trackerState.teamConfig);
  const row = trackerState.allCases.find(r => r.id === caseId);
  if (!row) return;

  const needsFollow = (newStatus === "Service Pending" || newStatus === "Monitoring");

   // ✅ AUTO-PNS: If status is set to PNS, auto-enable PNS flag
   if (newStatus === "PNS") {
     row.PNS = true;   // ✅ immediate local update 
     firestoreUpdateCase(caseId, {
       status: "PNS",
       PNS: true,
       lastActionedOn: today,
       lastActionedBy: trackerState.user.uid,
       statusChangedOn: today,
       statusChangedBy: trackerState.user.uid
     }).then(() => {
       pendingUnupdated.delete(caseId);
       applyFilters();
     }).catch(err => {
       pendingUnupdated.delete(caseId);
       showPopup("Failed to update case.");
       console.error(err);
     });
   
     return; // ⛔ stop further processing
   }

   if (newStatus === "Closed") {
   
     // store previous status so UI can revert if modal is cancelled
     prevStatusBeforeModal = row.status || "";
   
     // mark pending "Closed" (same concept as SP / Monitoring)
     pendingStatusForModal = "Closed";
   
     openClosureModal(row);
     return;
   }

  // ❗ STORE true previous status BEFORE overwriting
  const previousStatus = row.status;

  // Update local state
  //row.status = newStatus;

if (needsFollow) {
  prevStatusBeforeModal = previousStatus;
  pendingStatusForModal = newStatus;

  openCaseModal(caseId, true);

  // Only auto-refresh if NOT in Unupdated overlay
  if (!uiState.unupdatedActive) {
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
  pendingUnupdated.delete(caseId);

  applyFilters();
}).catch(err => {
  // On failure, remove pending and show popup (prevents permanent stuck case)
  pendingUnupdated.delete(caseId);
  showPopup("Failed to update case. Please try again.");
  console.error(err);
});


}

/* =======================================================================
   FIRESTORE UPDATE — SAFE FOR GENERAL USERS
   ======================================================================= */

async function firestoreUpdateCase(caseId, fields) {
  try {
    await updateCase(caseId, fields);
  } catch (err) {
     if (err.code === "permission-denied") {
       showPopup("Permission restricted: Read-only access on tracker page.");
     } else {
       showPopup("Unable to save changes. Read-only access allowed.");
     }
   }
}

// =====================================================
// SUBMIT CASE CLOSURE (MANDATORY SURVEY)
// =====================================================
async function submitClosure(caseId, hadPNS) {

   const submitBtn = document.getElementById("btnClosureSubmit");
   submitBtn.disabled = true;
   submitBtn.textContent = "Submitting...";

   
  const comment =
    document.getElementById("predictionComment").value.trim();

  if (!selectedStars || !comment) {
    alert("Survey prediction and comment are mandatory.");
     submitBtn.disabled = false;
      submitBtn.textContent = "Submit";
    return;
  }

  const today = getTeamToday(trackerState.teamConfig);

  const update = {
    status: "Closed",
    surveyPrediction: selectedStars,
    predictionComment: comment,
    lastActionedOn: today,
    lastActionedBy: trackerState.user.uid,
    statusChangedOn: today,
    statusChangedBy: trackerState.user.uid
  };

  // Conditional PNS resolution
  if (hadPNS === true) {
    const resolved =
      document.querySelector(
        'input[name="pnsResolved"]:checked'
      );

    if (!resolved) {
      alert("Please confirm if the PNS issue was resolved.");
       submitBtn.disabled = false;
submitBtn.textContent = "Submit";
      return;
    }

    if (resolved.value === "yes") {
      update.PNS = false;
    }
  }

  await firestoreUpdateCase(caseId, update);

   submitBtn.disabled = false;
submitBtn.textContent = "Submit";


  document
    .getElementById("closureModal")
    .classList.remove("show");

  applyFilters();
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
  if (r.followDate) {
     optDate.dataset.iso = r.followDate;
     optDate.value = formatDMY(r.followDate);
   } else {
     optDate.dataset.iso = "";
     optDate.value = "";
   }

  /* Flag */
  setFlagUI(r.flagged);
  /* PNS */
  setPNSUI(!!r.PNS);


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

// =====================================================
// CLOSURE SURVEY MODAL
// =====================================================
function openClosureModal(row) {
  const modal = document.getElementById("closureModal");
  modal.classList.add("show");

  // reset state
  selectedStars = 0;

  selectedStars = 0;
   document
     .querySelectorAll("#starRating span")
     .forEach(s => s.classList.remove("active"));


  document.getElementById("predictionComment").value = "";

  // Conditional PNS block
   if (row.PNS === true) {
     pnsBlock.classList.remove("hidden-force");
   } else {
     pnsBlock.classList.add("hidden-force");
   }

  // reset PNS radios
   document
     .querySelectorAll('input[name="pnsResolved"]')
     .forEach(r => r.checked = false);

  document.getElementById("btnClosureSubmit").onclick = () =>
    submitClosure(row.id, row.PNS);
}

const btnClosureClose = document.getElementById("btnClosureClose");

if (btnClosureClose) {
  btnClosureClose.onclick = () => {
    document.getElementById("closureModal")
      .classList.remove("show");
  };
}


/* =======================================================================
   LAST ACTIONED BY NAME LOOKUP
   ======================================================================= */

async function loadLastActionedByName(uid) {
  if (!uid) {
    optLastActionedByName.textContent = "—";
    optLastActionedByName.style.opacity = 1;
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

function setPNSUI(on) {
  optPNS.classList.toggle("on", on);
  optPNS.setAttribute("aria-checked", on ? "true" : "false");
}
optPNS.onclick = () => {
  setPNSUI(!optPNS.classList.contains("on"));
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
   if (pendingStatusForModal && currentModalCaseId) {
     const r = trackerState.allCases.find(x => x.id === currentModalCaseId);
     if (r) {
       r.status = prevStatusBeforeModal || "";
     }
     pendingStatusForModal = null;
     prevStatusBeforeModal = null;
   
     // refresh UI so dropdown reverts visually
     applyFilters();
   }

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
/* function refreshFlagUI() {
  if (optFlag.classList.contains("on")) {
    optFlag.style.boxShadow = "0 0 4px rgba(255,107,107,0.55)";
  } else {
    optFlag.style.boxShadow = "none";
  }
}
setInterval(refreshFlagUI, 300); */

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
    "Status Changed On": r.statusChangedOn,
     "Survey Prediction": r.surveyPrediction ?? "",
      "Prediction Comment": r.predictionComment ?? "",
      "PNS": r.PNS ? "Yes" : "No"
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

  const today = getTeamToday(trackerState.teamConfig);

  const follow = optDate.dataset.iso || null;

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

   r.PNS = optPNS.classList.contains("on");
   
   const updateObj = {
     followDate: r.followDate,
     followTime: r.followTime || null,
     flagged: r.flagged,
     PNS: r.PNS,
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
if (uiState.unupdatedActive) {
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
if (!uiState.unupdatedActive) {
  applyFilters();
}

  requireFollowUp = false;
  currentModalCaseId = null;
unupdatedProtect = false;

  return true;
}

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
   Phase 1 already applies this logic inside `applyFilters()`
   using `uiState.unupdatedActive` overlay.

   We re-expose this helper for summary calculations if needed
*/
function computeUnupdated(rows) {
  return rows.filter(r => !r.status || r.status.trim() === "");
}


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
  const today = getTeamToday(trackerState.teamConfig);

  /* ---------------------------------------------
     1️⃣ STATUS CHANGED TODAY (FOLLOWED UP CASES)
     --------------------------------------------- */
  const statusChangedToday = trackerState.allCases.filter(r =>
    r.statusChangedBy === uid &&
    r.statusChangedOn === today
  );

  // Closed
  const closedCases = statusChangedToday.filter(r => r.status === "Closed");
  const closedCount = closedCases.length;

  const met = closedCases.filter(
    r => (r.sbd || "").toLowerCase() === "met"
  ).length;

  const notMet = closedCases.filter(
    r => (r.sbd || "").toLowerCase() === "not met"
  ).length;

  const pct = (n) =>
    closedCount === 0 ? 0 : Math.round((n / closedCount) * 100);

  // Other status breakdowns
  const statusBreakdown = {
    "Service Pending": 0,
    "Monitoring": 0,
    "NCM 1": 0,
    "NCM 2": 0,
    "PNS": 0
  };

  statusChangedToday.forEach(r => {
    if (statusBreakdown[r.status] !== undefined) {
      statusBreakdown[r.status]++;
    }
  });

  const totalFollowedUp = statusChangedToday.length;

  /* ---------------------------------------------
     2️⃣ TOTAL ACTIONED CASES (ANY ACTION TODAY)
     --------------------------------------------- */
  const actionedToday = trackerState.allCases.filter(r =>
    r.lastActionedBy === uid &&
    r.lastActionedOn === today
  );

  const totalActioned = actionedToday.length;

  /* ---------------------------------------------
     3️⃣ UPDATED CASES (NON-STATUS UPDATES)
     --------------------------------------------- */
  const totalUpdated = totalActioned - totalFollowedUp;

  /* ---------------------------------------------
     4️⃣ RENDER SUMMARY
     --------------------------------------------- */
  infoModalBody.textContent =
`Total Cases Closed: ${closedCount}
Met: ${met} (${pct(met)}%)
Not Met: ${notMet} (${pct(notMet)}%)

Service Pending: ${statusBreakdown["Service Pending"]}
Monitoring: ${statusBreakdown["Monitoring"]}
NCM 1: ${statusBreakdown["NCM 1"]}
NCM 2: ${statusBreakdown["NCM 2"]}
PNS: ${statusBreakdown["PNS"]}

Total Followed Up Cases: ${totalFollowedUp}
Total Updated Cases: ${totalUpdated}

Total Actioned Cases: ${totalActioned}`;

  infoModal.classList.add("show");
}



/* ====================================================================
   FINAL CONSISTENCY PASS — ENSURE FILTERS NEVER BREAK
   -------------------------------------------------------------------- */

function normalizeDate(v) {
  return v || "";
}

// Normalize customer name for repeat detection
function normalizeCustomerName(name) {
  return (name || "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "") // remove spaces & special characters
    .trim();
}

// GLOBAL tooltip container
const globalTooltip = document.getElementById("globalTooltip");

// Tooltip text for Overdue Cases button
const negativeTooltipText = `
<b>Overdue Cases = Total Open Repair Cases</b><br>
EXCLUDING:<br>
• Ready for Closure Cases (Onsite + Offsite + CSR)<br>
• Onsite Cases ≤ 5 Days<br>
• Offsite Cases ≤ 10 Days<br>
• CSR Cases ≤ 3 Days
`;
;

// SIMPLE hover: show/hide only (no positioning)
const negBtn = document.getElementById("rfcNegativeBtn");

negBtn.addEventListener("mouseenter", () => {
    globalTooltip.innerHTML = negativeTooltipText;
    globalTooltip.classList.add("show-tooltip");
});

negBtn.addEventListener("mouseleave", () => {
    globalTooltip.classList.remove("show-tooltip");
});

















































