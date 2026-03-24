/* =======================================================
   PHASE 1 — CORE ENGINE REBUILD
   ======================================================= */

import {
  auth,
  db,
  onAuthStateChanged,
  collection,
  doc,
  getDoc,
  getDocs,
  addDoc,
  query,
  where,
  onSnapshot,
  updateDoc,
  setDoc,
  increment
} from "./js/firebase.js";

import {
  isPrimary,
  isSecondary,
  getCurrentTrackerTeam,
  toggleTheme
} from "./js/userProfile.js";

import { listenToTeamCases, updateCase } from "./js/firestore-api.js";
import { showPopup } from "./js/utils.js";
import { cleanupClosedCases } from "./js/utils.js";
import { templates } from "./templates.js";

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

// ================================
// CONTACT DATA STORE (LOCAL ONLY)
// ================================
let contactDataStore = {};

// Load from localStorage on startup
try {
  const stored = localStorage.getItem("kciContactData");
  if (stored) {
    contactDataStore = JSON.parse(stored);
  }
} catch (e) {
  console.error("Failed to load contact data", e);
}

/* =========================================================
   HEADER HEIGHT → MODAL OFFSET
   ========================================================= */

function updateHeaderHeight() {
  const header = document.querySelector(".header");
  if (!header) return;

  const height = header.offsetHeight;

  document.documentElement.style.setProperty(
    "--header-height",
    height + "px"
  );
}

function updateSidebarWidth() {
  const sidebar = document.getElementById("sidebar");
  if (!sidebar) return;

  const width = sidebar.offsetWidth;

  document.documentElement.style.setProperty(
    "--sidebar-width",
    width + "px"
  );
}

// Run once when page loads
window.addEventListener("load", () => {
  updateHeaderHeight();
  updateSidebarWidth();
});

// Update if window resizes
window.addEventListener("resize", () => {
  updateHeaderHeight();
  updateSidebarWidth();
});

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

async function incrementDailyClosedCount(teamId, todayISO) {
   const reportRef = doc(
     db,
     "cases",
     teamId,
     "reports",
     todayISO
   );

  await setDoc(
    reportRef,
    {
      closedCount: increment(1)
    },
    { merge: true }
  );
}

function scheduleFollowUpReminder(r) {

  // ⛔ 1️⃣ Only schedule if current user is the lastActionedBy
  if (r.lastActionedBy !== trackerState.user?.uid) return;

  // ⛔ 2️⃣ Must have both follow date and time
  if (!r.followDate || !r.followTime) return;

  // ⛔ 3️⃣ If case is already Closed → do not schedule
  if (r.status === "Closed") return;

  // Build exact timestamp
  const reminderTs = new Date(
    `${r.followDate}T${r.followTime}:00`
  ).getTime();

  const now = Date.now();
  if (reminderTs <= now) return;

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
    <div><strong>Scheduled:</strong>
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
  rfcMode: "normal",     // RFC buttons only
  set2Mode: "normal",    // Due / Flagged / PNS only
  unupdatedActive: false,
  repeatActive: false,
  sortByDateAsc: null,

  primaries: {
    caseResolutionCode: [],
    tl: [],
    sbd: [],
    caGroup: [],
    onsiteRFC: [],
    csrRFC: [],
    benchRFC: [],
    country: []
  },

  countryInvert: false
};

let unupdatedProtect = false;
// track specific caseIds that are being updated while in Unupdated mode
const pendingUnupdated = new Set();

// ✅ Holds rows temporarily when Status filter is active
const pendingStatusOverride = new Set();

/* =========================================================
   FOLLOW-UP REMINDER ENGINE (PHASE 2)
   ========================================================= */

const followUpTimers = new Map(); // caseId → timeoutId

/* =========================================================
   FOLLOW-UP REMINDER MODAL (PHASE 3A)
   ========================================================= */

let activeReminderCase = null;

/* =========================================================
   FOLLOW-UP REMINDER MODAL — BUTTON HANDLERS (PHASE 3A)
   ========================================================= */

const btnReminderClose = document.getElementById("btnReminderClose");
const btnReminderFollowUp = document.getElementById("btnReminderFollowUp");

if (btnReminderFollowUp) {
  btnReminderFollowUp.onclick = () => {
    const r = activeReminderCase;
    if (!r) return;

    // ⛔ stop this reminder from firing again
    if (followUpTimers.has(r.id)) {
      clearTimeout(followUpTimers.get(r.id));
      followUpTimers.delete(r.id);
    }

    document
      .getElementById("followUpReminderModal")
      .classList.remove("show");

    // ✅ IMPORTANT: mark context FIRST
    window.__fromReminder = true;

    // 🔗 Now open Case Options modal
    openCaseModal(r.id);

    activeReminderCase = null;
  };
}

// =====================================================
// SNOOZE HANDLERS (PHASE 4A)
// =====================================================

document
  .getElementById("followUpReminderModal")
  .addEventListener("click", (e) => {
    const btn = e.target.closest("[data-snooze]");
    if (!btn || !activeReminderCase) return;

    const minutes = Number(btn.dataset.snooze);
    const r = activeReminderCase;

    // ⛔ cancel existing timer
    if (followUpTimers.has(r.id)) {
      clearTimeout(followUpTimers.get(r.id));
      followUpTimers.delete(r.id);
    }

    // ⏱ schedule new reminder
    const delay = minutes * 60 * 1000;

    const timerId = setTimeout(() => {
      openFollowUpReminderModal(r);
    }, delay);

    followUpTimers.set(r.id, timerId);

    // close modal
    document
      .getElementById("followUpReminderModal")
      .classList.remove("show");

    activeReminderCase = null;
  });


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

   /* =====================================================
      RFC REPORT → VIEW DETAILED REPORT BUTTON (ADMINS ONLY)
      ===================================================== */
   
   const btnViewDetailedReport =
     document.getElementById("btnViewDetailedReport");
   
   if (btnViewDetailedReport) {
     if (isPrimary(data) || isSecondary(data)) {
       // Show for Primary & Secondary Admins
       btnViewDetailedReport.style.display = "inline-block";
   
       btnViewDetailedReport.onclick = () => {
         // Close the RFC modal first (clean UX)
         document
           .getElementById("rfcReportOverlay")
           ?.classList.remove("show");
   
         // Redirect to full report page
         window.location.href = "report.html";
       };
     } else {
       // General users → completely hidden
       btnViewDetailedReport.style.display = "none";
       btnViewDetailedReport.disabled = true;
     }
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
    const incoming = cases.map(c => ({
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
        surveyPrediction: typeof c.surveyPrediction === "number" ? c.surveyPrediction : null,
        predictionComment: c.predictionComment || "",
        otcCode: c.otcCode || "",
        market: c.market || "",
        notes: c.notes || "",
        lastActionedOn: c.lastActionedOn || "",
        lastActionedBy: c.lastActionedBy || "",
        statusChangedOn: c.statusChangedOn || "",
        statusChangedBy: c.statusChangedBy || "",

        // NEW TEMPLATE FIELDS
        woClosureNotes: c.woClosureNotes || "",
        trackingStatus: c.trackingStatus || "",
        partNumber: c.partNumber || "",
        partName: c.partName || "",
        serialNumber: c.serialNumber || "",
        productName: c.productName || "",
        emailStatus: c.emailStatus || "",
        dnap: c.dnap || ""
      }));
      
      // 🔥 Preserve protected rows during status override
      trackerState.allCases = incoming.map(newRow => {
        if (pendingStatusOverride.has(newRow.id)) {
          const existing = trackerState.allCases.find(r => r.id === newRow.id);
         
          // ✅ Merge new data into existing row (preserve UI stability + update fields)
          return existing ? { ...existing, ...newRow } : newRow;
        }
        return newRow;
      });

      const prevTL = JSON.stringify(PRIMARY_OPTIONS.tl);
      const prevCountry = JSON.stringify(PRIMARY_OPTIONS.country);
      
      updateDynamicPrimaryOptions();
      
      const newTL = JSON.stringify(PRIMARY_OPTIONS.tl);
      const newCountry = JSON.stringify(PRIMARY_OPTIONS.country);
      
      // 🔥 Only rebuild if options actually changed
      if (prevTL !== newTL || prevCountry !== newCountry) {
        buildPrimaryFilters();
      }

    // 🚫 Prevent auto-refresh hiding the row during Unupdated mode
    if (uiState.unupdatedActive && unupdatedProtect) {
      return;
    }
   
    // Normal realtime refresh
      requestAnimationFrame(() => {
        applyFilters();
      });
     
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
   
      // 🔒 If any modal is open → close it first
      
      // Case Options modal
      if (modal.classList.contains("show")) {
        closeModal();
      }

      // Email Preview modal
      const emailPreviewModal = document.getElementById("emailPreviewModal");
      if (emailPreviewModal?.classList.contains("show")) {
        emailPreviewModal.classList.remove("show");
      }
      
      // Tracker Summary modal
      const infoModal = document.getElementById("infoModal");
      if (infoModal?.classList.contains("show")) {
        infoModal.classList.remove("show");
      }
      
      // Case Closure Survey modal
      const closureModal = document.getElementById("closureModal");
      if (closureModal?.classList.contains("show")) {
        closureModal.classList.remove("show");
      }
      
      /* Follow-up reminder modal
      const reminderModal = document.getElementById("followUpReminderModal");
      if (reminderModal?.classList.contains("show")) {
        reminderModal.classList.remove("show");
      } */
   
     // Then open sidebar
     el.sidebar.classList.add("open");
     el.overlay.classList.add("show");

     // 🔥 ensure width variable updates
     updateSidebarWidth();
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
     updateSidebarWidth();
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

function getUniqueValues(data, key) {
  const set = new Set();

  data.forEach(row => {
    const val = (row[key] || "").toString().trim();
    if (val) set.add(val);
  });

  return Array.from(set).sort((a, b) =>
    a.localeCompare(b, undefined, { sensitivity: "base" })
  );
}

function updateDynamicPrimaryOptions() {
  const data = trackerState.allCases || [];

  // 🔥 Dynamic TL
  PRIMARY_OPTIONS.tl = getUniqueValues(data, "tl");

  // 🔥 Dynamic Country
  PRIMARY_OPTIONS.country = getUniqueValues(data, "country");
}

/* Filter options (fixed order & labels) */
const PRIMARY_OPTIONS = {
  caseResolutionCode: ["Onsite Solution", "Offsite Solution", "Parts Shipped"],
  tl: [],         // ✅ dynamic
  sbd: ["Met", "Not Met", "NA"],
  caGroup: ["0-3 Days","3-5 Days","5-10 Days","10-15 Days","15-30 Days","30-60 Days","60-90 Days","> 90 Days"],
  onsiteRFC: ["Closed - Canceled","Closed - Posted","Open - Completed","Open - In Progress","Open - Scheduled","Open - Unscheduled"],
  csrRFC: ["Cancelled","Closed","POD","New","Order Pending","Ordered","Shipped"],
  benchRFC: ["Delivered","Repair pending","Order cancelled, not to be reopened","Order processing hold","Parts shortage","Pick up needed by courier","Defective collected","Ship complete"],
  country: []    // ✅ dynamic
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
        <div style="display:flex;align-items:center;gap:.5rem;">
        
          ${key === "country" ? `
            <div 
              class="switch ${uiState.countryInvert ? "on" : ""}" 
              id="countryInvertToggle"
              title="Exclude selected countries"
            ></div>
          ` : ""}
        
          <span style="margin-left:8px;">▾</span>
        
        </div>
      </div>
      <div class="filter-body" id="filter-body-${key}">
        <div class="chips ${key === "benchRFC" ? "single-column" : ""}" id="chips-${key}">
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

      // COUNTRY INVERT TOGGLE
      if (key === "country") {
        const toggle = block.querySelector("#countryInvertToggle");
      
        if (toggle) {   // ✅ safety check (recommended)
          toggle.onclick = (e) => {
           e.stopPropagation();
         
           uiState.countryInvert = !uiState.countryInvert;
         
           // ✅ UI first (instant)
           toggle.classList.toggle("on", uiState.countryInvert);
         
           // ✅ Defer heavy work (smooth animation)
           requestAnimationFrame(() => {
             applyFilters();
           });
         };
        }
      }
      
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

// Deselect row when click in not inside any row
document.addEventListener("click", (e) => {
  const clickedRow = e.target.closest("#tbody tr");

  // ❗ Ignore clicks inside modal or important UI
  if (
    e.target.closest(".modal") ||
    e.target.closest(".custom-select") ||
    e.target.closest(".icon-btn")
  ) {
    return;
  }

  // If click is NOT inside any row → deselect
  if (!clickedRow && activeRow) {
    activeRow.classList.remove("active-row");
    activeRow = null;
  }
});

// Deselect any row by clicking ESC button
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && activeRow) {
    activeRow.classList.remove("active-row");
    activeRow = null;
  }
});


// CLEAR button — clears only primary filters
document.addEventListener("click", (e) => {
    const btn = e.target.closest("#rfcClear");
    if (!btn) return;   // Prevents accidental unlocks on ANY other click
    if (rfcLocked) return;

    resetAllFilters({
     clearPrimaries: true,
     clearRFC: true,
     clearSet1: true,
     clearSet2: true
   });
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

       
       uiState.rfcMode = "onsite";
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

       
       uiState.rfcMode = "offsite";
        uiState.primaries.caseResolutionCode = ["Offsite Solution"];
        uiState.primaries.benchRFC = ["Delivered","Order cancelled, not to be reopened"];
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

       
       uiState.rfcMode = "csr";
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
    uiState.rfcMode = "total";

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
    uiState.rfcMode = "negative";

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
    const checks = Array.from(
      document.querySelectorAll(`#filter-body-${key} input[type="checkbox"]`)
    );

    uiState.primaries[key] =
      checks.filter(c => c.checked).map(c => c.dataset.value);
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
   
     // Clear working-set overrides
     pendingStatusOverride.clear();
   
     // 🔒 If locked → preserve sidebar filters
     if (rfcLocked) {
   
       resetAllFilters({
         clearPrimaries: false,  // preserve sidebar
         clearRFC: false,        // preserve RFC selection
         clearSet1: true,
         clearSet2: true         // 🔥 fixes your bug
       });
   
       // Restore RFC highlight
       setTimeout(() => {
         document.querySelectorAll(".rfcBtn").forEach(b => {
           b.classList.toggle(
             "active",
             b.dataset.type === uiState.rfcMode
           );
         });
       }, 0);
   
       return;
     }
   
     // 🔓 Not locked → full reset
     resetAllFilters({
       clearPrimaries: true,
       clearRFC: true,
       clearSet1: true,
       clearSet2: true
     });
   
   };

  /* MODE BUTTONS — Direct override (Option A behavior) */
  el.btnDueToday.onclick = () => { uiState.set2Mode = "due"; applyFilters(); };
  el.btnFlagged.onclick = () => { uiState.set2Mode = "flagged"; applyFilters(); };
  el.btnPNS.onclick = () => { uiState.set2Mode = "pns"; applyFilters(); };
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
  el.btnDueToday.classList.toggle("active", uiState.set2Mode === "due");
  el.btnFlagged.classList.toggle("active", uiState.set2Mode === "flagged");
  el.btnPNS.classList.toggle("active", uiState.set2Mode === "pns");
  el.btnRepeating.classList.toggle("active", uiState.repeatActive);
  el.btnUnupdated.classList.toggle("active", uiState.unupdatedActive);
  el.btnSortDate.classList.toggle(
    "active",
    uiState.sortByDateAsc !== null
  );
}

/* =========================================================
   GLOBAL FILTER RESET ENGINE
   ========================================================= */

function resetAllFilters({
  clearPrimaries = true,
  clearRFC = true,
  clearSet1 = true,
  clearSet2 = true
} = {}) {

  // 1️⃣ RFC
  if (clearRFC) {
    lastRfcMode = null;
    uiState.rfcMode = "normal";
    document.querySelectorAll(".rfcBtn")
      .forEach(b => b.classList.remove("active"));
  }

  // 2️⃣ Primary filters
  if (clearPrimaries) {
    Object.keys(uiState.primaries).forEach(k => {
      uiState.primaries[k] = [];
      uiState.primaryLocks[k] = false;
    });
  }

  // 3️⃣ Set 1 (Search + Status)
  if (clearSet1) {
    uiState.search = "";
    uiState.statusList = [];
    el.txtSearch.value = "";
    buildStatusPanel();
  }

  // 4️⃣ Set 2 (Mode buttons)
  if (clearSet2) {
    uiState.set2Mode = "normal";
    uiState.repeatActive = false;
    uiState.unupdatedActive = false;
    uiState.sortByDateAsc = null;
    updateSortIcon();
  }

  // 5️⃣ Safety clears
  pendingUnupdated.clear();
  pendingStatusOverride.clear();
  unupdatedProtect = false;

  buildPrimaryFilters();
  applyFilters();
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

   el.statusPanel.innerHTML = statuses.map(s => {
   
     if (s === "NCM 1" || s === "NCM 2") {
       return `
         <label style="display:flex;align-items:center;">
           <input type="checkbox" data-status="${s}"
             ${uiState.statusList.includes(s) ? "checked" : ""}/>
           <span style="flex:1">${s}</span>
           <span class="ncm-own-tag" style="font-size:11px;opacity:0.6;">Own</span>
         </label>
       `;
     }
   
     return `
       <label>
         <input type="checkbox" data-status="${s}"
           ${uiState.statusList.includes(s) ? "checked" : ""}/>
         ${s}
       </label>
     `;
   }).join("");

   // ✅ Divider
   el.statusPanel.innerHTML += `
     <div style="border-top:1px solid var(--border); margin:6px 0;"></div>
   `;
   
   // ✅ Show All NCM Cases option (override flag)
   el.statusPanel.innerHTML += `
     <label>
       <input type="checkbox" data-status="SHOW_ALL_NCM"
         ${uiState.statusList.includes("SHOW_ALL_NCM") ? "checked" : ""}/>
       Show All NCM Cases
     </label>
   `;

   // ✅ Email Status New filter
   el.statusPanel.innerHTML += `
     <label>
       <input type="checkbox" data-status="EMAIL_NEW"
         ${uiState.statusList.includes("EMAIL_NEW") ? "checked" : ""}/>
       Email Status New
     </label>
   `;

   // ✅ Divider before DNAP
   el.statusPanel.innerHTML += `
     <div style="border-top:1px solid var(--border); margin:6px 0;"></div>
   `;
   
   // ✅ Offsite DNAP Cases (exclusive filter)
   el.statusPanel.innerHTML += `
     <label>
       <input type="checkbox" data-status="DNAP_ONLY"
         ${uiState.statusList.includes("DNAP_ONLY") ? "checked" : ""}/>
       Offsite DNAP Cases
     </label>
   `;

   updateStatusLabel();

   const showAllNcm = uiState.statusList.includes("SHOW_ALL_NCM");

   el.statusPanel.querySelectorAll(".ncm-own-tag").forEach(tag => {
     tag.style.display = showAllNcm ? "none" : "inline";
   });

   const isDnapActive = uiState.statusList.includes("DNAP_ONLY");

   el.statusPanel.querySelectorAll("input[type='checkbox']").forEach(input => {
     if (input.dataset.status !== "DNAP_ONLY") {
       input.disabled = isDnapActive;
     }
   });

  /* Record selections but DO NOT apply yet */
   el.statusPanel.onchange = (e) => {
     const c = e.target.closest("input");
     if (!c) return;
   
     const val = c.dataset.status;
   
     // ✅ DNAP_ONLY → exclusive behavior
     if (val === "DNAP_ONLY") {
   
       if (c.checked) {
         uiState.statusList = ["DNAP_ONLY"];
       } else {
         uiState.statusList = [];
       }
   
     } else {
   
       // ❌ If DNAP is active → block all other selections
       if (uiState.statusList.includes("DNAP_ONLY")) {
         return;
       }
   
       const set = new Set(uiState.statusList);
       c.checked ? set.add(val) : set.delete(val);
       uiState.statusList = [...set];
     }
   
     // ✅ Disable/enable other checkboxes
      const isDnapActive = uiState.statusList.includes("DNAP_ONLY");
      
      el.statusPanel.querySelectorAll("input[type='checkbox']").forEach(input => {
        if (input.dataset.status !== "DNAP_ONLY") {
          input.disabled = isDnapActive;
      
          // ✅ Reset checked state only when activating DNAP
          if (isDnapActive) {
            input.checked = false;
          }
        }
      });

      const showAllNcm = uiState.statusList.includes("SHOW_ALL_NCM");

      el.statusPanel.querySelectorAll(".ncm-own-tag").forEach(tag => {
        tag.style.display = showAllNcm ? "none" : "inline";
      });
   
     updateStatusLabel();
   };
}

function updateStatusLabel() {

  if (uiState.statusList.length === 0) {
    el.statusLabel.textContent = "All Statuses";
    return;
  }

  const displayList = uiState.statusList
    .filter(s => s !== "SHOW_ALL_NCM" && s !== "EMAIL_NEW" && s !== "DNAP_ONLY");

  if (uiState.statusList.includes("SHOW_ALL_NCM")) {
    displayList.push("All NCM");
  }

  if (uiState.statusList.includes("EMAIL_NEW")) {
    displayList.push("Email New");
  }

  if (uiState.statusList.includes("DNAP_ONLY")) {
    displayList.push("DNAP");
  }

  el.statusLabel.textContent = displayList.join(", ");
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

   // ✅ NEW: Override — Show all NCM cases
   if (uiState.statusList.includes("SHOW_ALL_NCM")) {
     return rows;
   }

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

   // ✅ DNAP_ONLY override (exclusive filter)
   if (uiState.statusList.includes("DNAP_ONLY")) {
     rows = rows.filter(r => Boolean(r.dnap));
   
     trackerState.filteredCases = rows;
     updateBadges();
   
     // ✅ ADD THIS LINE (CRITICAL)
     renderTable();
   
     return;
   }

  /* ===============================================================
   RFC MODE: TOTAL  (NEW — does NOT return early)
   =============================================================== */
if (uiState.rfcMode === "total") {

    const onsiteList = trackerState.allCases.filter(r =>
        r.caseResolutionCode === "Onsite Solution" &&
        ["Closed - Canceled","Closed - Posted","Open - Completed"].includes(r.onsiteRFC)
    );

    const offsiteList = trackerState.allCases.filter(r =>
        r.caseResolutionCode === "Offsite Solution" &&
        ["Delivered","Order cancelled, not to be reopened"].includes(r.benchRFC)
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
if (uiState.rfcMode === "negative") {

    let base = [...trackerState.allCases];

    // TOTAL building (same as total mode)
    const onsiteTotal = trackerState.allCases.filter(r =>
        r.caseResolutionCode === "Onsite Solution" &&
        ["Closed - Canceled", "Closed - Posted", "Open - Completed"]
        .includes(r.onsiteRFC)
    );

    const offsiteTotal = trackerState.allCases.filter(r =>
        r.caseResolutionCode === "Offsite Solution" &&
        ["Delivered", "Order cancelled, not to be reopened"].includes(r.benchRFC)
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
     MODE OVERRIDES (Option A)
     =============================================================== */
  if (uiState.set2Mode === "due") {
  rows = rows.filter(r =>
    r.lastActionedBy === trackerState.user.uid &&
    r.followDate &&
    r.followDate <= today &&
    r.status !== "Closed"
  );
}


  if (uiState.set2Mode === "flagged") {
    rows = rows.filter(r =>
      r.flagged &&
      r.lastActionedBy === trackerState.user.uid
    );
  }

   if (uiState.set2Mode === "pns") {
     rows = rows.filter(r =>
       r.PNS === true &&
       r.lastActionedBy === trackerState.user.uid
     );
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
   const selectedStatuses = uiState.statusList.filter(
     s => s !== "SHOW_ALL_NCM" && s !== "EMAIL_NEW"
   );
   
   if (selectedStatuses.length > 0) {
     rows = rows.filter(r => {
   
       // ✅ Keep rows currently being edited
       if (pendingStatusOverride.has(r.id)) return true;
   
       return selectedStatuses.includes(r.status);
     });
   }

   /* PRIMARY TABLE FILTERS (AND across filters; OR within each filter's options) */
   // For each primary filter, if selection exists, keep rows matching any of its options.
   Object.keys(uiState.primaries).forEach(key => {
     const sel = uiState.primaries[key] || [];
     if (!sel || sel.length === 0) return;
   
     if (key === "country" && uiState.countryInvert) {
       // EXCLUDE MODE
       rows = rows.filter(r => {
         const val = (r[key] || "").toString().trim();
         return !sel.includes(val);
       });
     } else {
       // NORMAL MODE
       rows = rows.filter(r => {
         const val = (r[key] || "").toString().trim();
         return sel.includes(val);
       });
     }
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

// ✅ Email Status New filter (AND condition)
if (uiState.statusList.includes("EMAIL_NEW")) {
  rows = rows.filter(r => r.emailStatus === "New");
}

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
    ["Delivered","Order cancelled, not to be reopened"].includes(r.benchRFC)
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
  if (!tr) return;

  // If already active → DO NOTHING (critical fix)
  if (activeRow === tr) return;

  if (activeRow) activeRow.classList.remove("active-row");

  tr.classList.add("active-row");
  activeRow = tr;
}

function setActiveRowByCaseId(caseId) {
  if (!caseId) return;

  const row = tbody.querySelector(`tr td.caseid[data-id="${caseId}"]`);
  if (!row) return;

  const tr = row.closest("tr");
  if (!tr) return;

  setActiveRow(tr);

  // Optional: scroll into view
  tr.scrollIntoView({
    behavior: "smooth",
    block: "center"
  });
}

function renderEmptyState(message) {
  const tbody = document.getElementById("tbody");

  tbody.innerHTML = `
    <tr>
      <td colspan="10" style="
        text-align:center;
        padding:24px;
        color:var(--muted);
        font-size:14px;
      ">
        ${message}
      </td>
    </tr>
  `;
}

function getEmptyStateMessage() {
  const { user } = trackerState;

  // ❌ Case 1: No team assigned
  if (!user || !user.team) {
    return "⚠️ No team assigned to your account. Please contact admin.";
  }

  // 🔍 Case 2: Filters active
  const filtersActive =
    uiState.search ||
    (uiState.statusList && uiState.statusList.length > 0) ||
    uiState.unupdatedActive ||
    uiState.dueTodayActive ||
    uiState.flaggedActive ||
    uiState.PNSActive ||
    uiState.repeatingActive;

  if (filtersActive) {
    return "🔍 No cases match the current filters.";
  }

  // 📂 Case 3: No data for team
  return "📭 No cases available for your team.";
}


/* Render Table — Clean, optimized */
export function renderTable() {
  const rows = trackerState.filteredCases;
  const today = getTeamToday(trackerState.teamConfig);

  if (!rows || rows.length === 0) {
    renderEmptyState(getEmptyStateMessage());
    return;
  }

  // 🔁 Clear existing follow-up timers before re-render
  followUpTimers.forEach(clearTimeout);
  followUpTimers.clear();

  tbody.innerHTML = "";

  rows.forEach((r, index) => {
    const tr = document.createElement("tr");

   /* Row Styling Logic */
   if (r.followDate && r.followDate <= today && r.status !== "Closed") {
     tr.classList.add("due-today");
   
     // ⏰ Subtle emphasis if follow-up time is set for today
     if (r.followTime && r.followDate === today) {
       tr.classList.add("due-today-time");
     }
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

  // Close other dropdowns first
  document.querySelectorAll(".custom-select").forEach(s => {
    if (s !== select) {
      s.classList.remove("open", "open-up");
    }
  });

  select.classList.toggle("open");

  if (select.classList.contains("open")) {
    const dropdown = select.querySelector(".custom-options");
    const rect = select.getBoundingClientRect();
    const dropdownHeight = dropdown.offsetHeight;
    const spaceBelow = window.innerHeight - rect.bottom;

    // If not enough space below → open upward
    if (spaceBelow < dropdownHeight + 10) {
      select.classList.add("open-up");
    } else {
      select.classList.remove("open-up");
    }
  }

  const option = e.target.closest(".custom-option");
  if (!option) return;

  const caseId = select.dataset.id;
  const value = option.dataset.value;

  const label = select.querySelector(".custom-select-trigger span");
  if (label) {
    label.innerHTML = value || "&nbsp;";
  }

  handleStatusChange(caseId, value);

  select.classList.remove("open", "open-up");
});

/* Close on outside click */
document.addEventListener("click", (e) => {
  document.querySelectorAll(".custom-select.open").forEach(sel => {
    if (!sel.contains(e.target)) {
      sel.classList.remove("open", "open-up");
    }
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

// ✅ RIGHT-CLICK → COPY KCI NOTES
tbody.addEventListener("contextmenu", async (e) => {

  const cell = e.target.closest(".caseid");
  if (!cell) return;

  e.preventDefault(); // 🚫 disable default right-click menu

  try {
    // 🔍 Get row
    const caseId = cell.textContent.trim();

      if (!caseId) {
        showPopup("Invalid case ID");
        return;
      }
      
      const caseData = trackerState.allCases.find(
        c => String(c.id) === String(caseId)
      );
      
      if (!caseData) {
        showPopup("Unable to fetch case data");
        return;
      }
      
      // ✅ FIXED TEMPLATE ACCESS
      const tplDef = templates["kci"];
      
      if (!tplDef || typeof tplDef.getTemplate !== "function") {
        showPopup("Template not available");
        return;
      }
      
      const template = tplDef.getTemplate(caseData);
      
      if (!template || !template.body) {
        showPopup("Template not available");
        return;
      }
      
      // ✅ APPLY VARIABLES (IMPORTANT)
      const notes = applyTemplateVariables(template.body, caseData, "kci");
      
      await navigator.clipboard.writeText(notes);
      
      showPopup("KCI Notes copied");

  } catch (err) {
    console.error(err);
    showPopup("Failed to copy KCI Notes");
  }

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

/* =========================================================
   EMAIL PREVIEW MODAL ELEMENTS
   ========================================================= */

const emailPreviewModal = document.getElementById("emailPreviewModal");
const emailPreviewTitle = document.getElementById("emailPreviewTitle");
const emailPreviewToolbar = document.getElementById("emailPreviewToolbar");

const emailPreviewSubject = document.getElementById("emailPreviewSubject");
const emailPreviewBody = document.getElementById("emailPreviewBody");

const btnEmailPreviewBack = document.getElementById("btnEmailPreviewBack");
const btnEmailPreviewClose = document.getElementById("btnEmailPreviewClose");

const btnCopyEmailSubject = document.getElementById("btnCopyEmailSubject");
const btnCopyEmailBody = document.getElementById("btnCopyEmailBody");

const btnUploadExcel = document.getElementById("btnUploadExcel");
const excelFileInput = document.getElementById("excelFileInput");

if (btnUploadExcel && excelFileInput) {
  btnUploadExcel.addEventListener("click", () => {
    excelFileInput.click();
  });

  excelFileInput.addEventListener("change", handleExcelUpload);
}

modalWarning.style.display = "none";


let currentModalCaseId = null;
let pendingStatusForModal = null;   // temporarily stores status chosen which requires follow-up
let prevStatusBeforeModal = null;   // to revert if modal cancelled
let requireFollowUp = false;
let closureSurveyCompleted = false;

/* Holds the full case object for template engine */
let currentCase = null;

function handleExcelUpload(event) {
  const file = event.target.files[0];
  if (!file) return;

  // FILE TYPE VALIDATION
  if (!file.name.match(/\.(xlsx|xls)$/i)) {
    showPopup("Please upload a valid Excel file");
    event.target.value = ""; // reset input
    return;
  }

  const reader = new FileReader();

  reader.onload = function (e) {
    try {
      const data = new Uint8Array(e.target.result);
      const workbook = XLSX.read(data, { type: "array" });

      const sheetName = workbook.SheetNames[0];
      const sheet = workbook.Sheets[sheetName];

      const json = XLSX.utils.sheet_to_json(sheet, { defval: "" });

      // ================================
      // VALIDATE REQUIRED COLUMNS
      // ================================
      const requiredColumns = [
        "Case ID",
        "Phone",
        "Mobile Phone",
        "Phone (Primary Contact) (Contact)",
        "Mobile Phone (Primary Contact) (Contact)",
        "Other Phone (Primary Contact) (Contact)",
        "Work (Primary Contact) (Contact)",
        "Email Address (Primary Contact) (Contact)"
      ];
      
      // Get headers from first row
      const sheetHeaders = XLSX.utils.sheet_to_json(sheet, { header: 1 })[0] || [];
      
      // Check missing columns
      const missingColumns = requiredColumns.filter(
        col => !sheetHeaders.includes(col)
      );
      
      if (missingColumns.length > 0) {
        showPopup(
          "Invalid Excel format.\nMissing columns:\n" +
          missingColumns.join(", ")
        );
        return;
      }

      const newStore = {};

      json.forEach(row => {
        let caseId = (row["Case ID"] || "").toString().trim().toUpperCase();
        if (!caseId) return;

        // Collect all phone fields
        const rawPhones = [
          row["Phone"],
          row["Mobile Phone"],
          row["Phone (Primary Contact) (Contact)"],
          row["Mobile Phone (Primary Contact) (Contact)"],
          row["Other Phone (Primary Contact) (Contact)"],
          row["Work (Primary Contact) (Contact)"]
        ];

        // Clean + normalize phones
        const cleanedPhones = rawPhones
          .filter(p => p !== null && p !== undefined)
          .map(p => p.toString().trim())
          .filter(p =>
            p &&
            !["na", "n/a", "-", "--", "null"].includes(p.toLowerCase())
          )
          .map(p =>
            p.replace(/[^\d]/g, "") // keep only digits
          )
          .filter(p => p.length > 0);

        // Deduplicate phones
        const uniquePhones = [...new Set(cleanedPhones)];

        // Clean email
        let email = (row["Email Address (Primary Contact) (Contact)"] || "")
          .toString()
          .trim();

        newStore[caseId] = {
          phones: uniquePhones,
          email: email || ""
        };
      });

      // Merge with existing (overwrite same caseId)
      contactDataStore = {
        ...contactDataStore,
        ...newStore
      };

      // Save locally
      localStorage.setItem(
        "kciContactData",
        JSON.stringify(contactDataStore)
      );

      console.log("Processed contacts:", newStore);

      showPopup("Excel uploaded successfully");

      console.log("Contact Data Store:", contactDataStore);

    } catch (err) {
      console.error("Excel processing failed:", err);
      showPopup("Failed to process Excel");
    }
  };

  reader.readAsArrayBuffer(file);

  // Reset input so same file can be uploaded again
  event.target.value = "";
}

function getContactByCaseId(caseId) {
  if (!caseId) return null;
  return contactDataStore[caseId.toString().trim().toUpperCase()] || null;
}

/* =========================================================
   CUSTOM CALENDAR — CLICK TO OPEN (SEGMENTED FIX)
   ========================================================= */

let calendarMonth = new Date();

const dateSegment = optDate.closest(".segmented-input");

dateSegment.addEventListener("click", (e) => {
  e.stopPropagation();
  closeTimeDropdowns();
  // Focus input for accessibility
  optDate.focus();

  // Jump calendar to selected month if exists
  if (optDate.dataset.iso) {
    const [y, m] = optDate.dataset.iso.split("-");
    calendarMonth = new Date(Number(y), Number(m) - 1, 1);
  } else {
    calendarMonth = new Date();
  }

  renderCalendar();
});

document.addEventListener("click", () => {
  closeCalendar();
});

function closeCalendar() {
  const c = document.getElementById("calendarContainer");
  c.innerHTML = "";
  c.removeAttribute("style");
}

function renderCalendar() {
  const container = document.getElementById("calendarContainer");
  const today = new Date();

   const segment = optDate.closest(".segmented-input");
   
   // Reset any previous inline styles
   container.style.position = "absolute";
   container.style.left = "0";
   container.style.top = "100%";
   container.style.zIndex = "500";

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
      
          const weekday = new Date(iso).getDay();
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
      
      <!-- ✅ NEW CLEAR OPTION -->
      <div class="calendar-clear"
           style="margin-top:8px;text-align:center;">
        <button id="calendarClearBtn"
                style="
                  border:1px solid var(--border);
                  background:var(--panel-2);
                  padding:6px 14px;
                  border-radius:8px;
                  cursor:pointer;
                  font-size:12px;">
          Clear
        </button>
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
     updateSaveButtonState();
   };
  });
   
   // ✅ CLEAR DATE + TIME
   const clearBtn = container.querySelector("#calendarClearBtn");
   if (clearBtn) {
     clearBtn.onclick = (e) => {
       e.stopPropagation();
   
       // Clear date
       optDate.dataset.iso = "";
       optDate.value = "";
   
       // Reset time picker
       timeState.hh = null;
       timeState.mm = null;
       timeState.ampm = "AM";
   
       timeHH.textContent = "HH";
       timeMM.textContent = "MM";
       timeAMPM.textContent = "AM";
   
       document.getElementById("optTime").dataset.value = "";
       document.getElementById("optTime").dataset.display = "";
       updateSaveButtonState();
   
       closeCalendar();
     };
   }
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
   
   // ✅ Protect row if Status filter is active
   if (uiState.statusList && uiState.statusList.length > 0) {
     pendingStatusOverride.add(caseId);
   }

   
  const today = getTeamToday(trackerState.teamConfig);
  const row = trackerState.allCases.find(r => r.id === caseId);
  if (!row) return;

  const needsFollow = (newStatus === "Service Pending" || newStatus === "Monitoring");

   // ✅ AUTO-PNS: If status is set to PNS, auto-enable PNS flag
   if (newStatus === "PNS") {
     row.status = "PNS";   // 🔥 CRITICAL FIX
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
       pendingStatusOverride.delete(caseId);
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
     row.status = "Closed";  // 🔥 ensure dropdown reflects change
     // 🔹 Track current case for revert logic
     currentModalCaseId = caseId;
     // mark pending "Closed" (same concept as SP / Monitoring)
     pendingStatusForModal = "Closed";
     closureSurveyCompleted = false; // 🔒 reset until survey submits
   
     openClosureModal(row);
     return;
   }

  // ❗ STORE true previous status BEFORE overwriting
  const previousStatus = row.status;

  // Update local state
  row.status = newStatus;

   if (needsFollow) {
     prevStatusBeforeModal = previousStatus;
     pendingStatusForModal = newStatus;
     requireFollowUp = true;
   
     // 🔑 DIFFERENT BEHAVIOR BASED ON CONTEXT
     if (window.__fromReminder) {
       // Already inside Case Options modal → just warn
       showModalWarning(`Status "${newStatus}" needs a follow-up date.`);
     } else {
       // Status selected from table → open modal as usual
       openCaseModal(caseId, true);
     }
   
     return;
   }


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
     pendingStatusOverride.delete(caseId);
     applyFilters();
   }).catch(err => {
     // On failure, remove pending and show popup (prevents permanent stuck case)
     pendingUnupdated.delete(caseId);
     showPopup("Failed to update case. Please try again.");
     console.error(err);
   });
}

// Status selector inside Case Options modal (reminder flow)
document.addEventListener("click", (e) => {
  const select = e.target.closest(".reminder-status-select");
  if (!select) return;

  select.classList.toggle("open");

  const option = e.target.closest(".custom-option");
  if (!option) return;

  const caseId = select.dataset.id;
  const value = option.dataset.value;

   // ✅ VISUAL UPDATE FIRST
   const label = select.querySelector(".custom-select-trigger span");
   label.innerHTML = value || "&nbsp;";
   
   // 🔄 If switching to NON follow-up status, clear enforcement
   if (value !== "Service Pending" && value !== "Monitoring") {
     pendingStatusForModal = null;
     requireFollowUp = false;
     hideModalWarning();
   }
   
   // Then process logic
   handleStatusChange(caseId, value);
   setTimeout(updateSaveButtonState, 0);
   
   select.classList.remove("open");
});

/* =======================================================================
   FIRESTORE UPDATE — SAFE FOR GENERAL USERS
   ======================================================================= */

async function firestoreUpdateCase(caseId, fields) {
  try {
    if (!trackerState.teamId) {
      throw new Error("Team ID not available");
    }

    await updateCase(trackerState.teamId, caseId, fields);

  } catch (err) {

    console.error("Firestore update failed:", err);

    if (err.code === "permission-denied") {
      showPopup("Permission restricted: Read-only access on tracker page.");
    } else {
      showPopup("Failed to update case. Please try again.");
    }

    throw err;
  }
}

async function handleClosedCaseArchival(caseId) {
  // 1️⃣ Read final case state (ALLOWED — cases read is permitted)
  const caseRef = doc(db, "cases", caseId);
  const snap = await getDoc(caseRef);
  if (!snap.exists()) return;

  const caseData = snap.data();

  // 2️⃣ Team-aware closed date
  const todayISO = getTeamToday(trackerState.teamConfig);

  // 3️⃣ Archive snapshot (WRITE-ONLY for general users)
  const historyRef = doc(db, "closedCasesHistory", caseId);

  await setDoc(historyRef, {
    ...caseData,
    teamId: caseData.teamId,
    closedDate: todayISO,
    archivedAt: new Date().toISOString(),
    archivedBy: trackerState.user.uid
  });

  // 4️⃣ Cleanup (primary admin only)
  if (trackerState.user.role === "primary") {
    await cleanupClosedCases(todayISO);
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

   try {
     await firestoreUpdateCase(caseId, update);
   
     const todayISO = getTeamToday(trackerState.teamConfig);
   
     await incrementDailyClosedCount(
       trackerState.teamId,
       todayISO
     );
   
     try {
        await handleClosedCaseArchival(caseId);
      } catch (err) {
        console.warn(
          "Closed case archival failed, closure still succeeded:",
          err
        );
      }
   
     // ✅ Clear closure warning after successful submission
     const warn = document.getElementById("closureWarning");
     if (warn) warn.remove();
   
     closureSurveyCompleted = true;
     pendingStatusForModal = null;
   
     document
       .getElementById("closureModal")
       .classList.remove("show");
   
     applyFilters();
   
   } catch (err) {
     console.error("Case closure failed:", err);
     showPopup("Case closure failed. Please try again.");
   
   } finally {
     // 🔐 ALWAYS reset button
     submitBtn.disabled = false;
     submitBtn.textContent = "Submit";
   }


  document
    .getElementById("closureModal")
    .classList.remove("show");

  applyFilters();
}


/* =======================================================================
   OPEN CASE MODAL
   ======================================================================= */

export function openCaseModal(caseId, enforce = false) {
  hideModalWarning();   // ✅ reset leftover warning
   
  requireFollowUp = enforce;
  currentModalCaseId = caseId;

  const r = trackerState.allCases.find(x => x.id === caseId);
  if (!r) return;

  currentCase = r;

  modalTitle.textContent = `Case Options — ${caseId}`;

  /* Last Actioned On */
  optLastActioned.textContent =
    r.lastActionedOn ? formatDMY(r.lastActionedOn) : "—";

  /* Last Actioned By (NAME LOOKUP) */
  loadLastActionedByName(r.lastActionedBy);

   /* ===============================
      STATUS (REMINDER CONTEXT ONLY)
      =============================== */
   
   const statusRowId = "reminderStatusRow";
   document.getElementById(statusRowId)?.remove();

   if (window.__fromReminder) {
     const statusRowId = "reminderStatusRow";
     document.getElementById(statusRowId)?.remove();
   
     const row = document.createElement("div");
     row.className = "row";
     row.id = statusRowId;
   
     row.innerHTML = `
       <div>Status</div>
       <div>
         <div class="custom-select reminder-status-select"
              style="margin:0;"
              data-id="${r.id}">
           <div class="custom-select-trigger">
             <span>${r.status || "&nbsp;"}</span>
           </div>
           <div class="custom-options">
             ${[
               "",
               "Closed",
               "NCM 1",
               "NCM 2",
               "PNS",
               "Service Pending",
               "Monitoring"
             ].map(s => `
               <div class="custom-option" data-value="${s}">
                 ${s || "&nbsp;"}
               </div>
             `).join("")}
           </div>
         </div>
       </div>
     `;
   
     document
       .querySelector("#modal .modal-body")
       .insertBefore(
         row,
         document.querySelector("#optNotes").closest(".row")
       );
   }

   /* Follow Date & Time */
   const optTime = document.getElementById("optTime");
   
      if (window.__fromReminder) {
        optDate.dataset.iso = "";
        optDate.value = "";
         timeState.hh = null;
         timeState.mm = null;
         timeState.ampm = "AM";
         
         timeHH.textContent = "HH";
         timeMM.textContent = "MM";
         timeAMPM.textContent = "AM";
         
         document.getElementById("optTime").dataset.value = "";
      } else if (!window.__fromReminder) {
        if (r.followDate) {
          optDate.dataset.iso = r.followDate;
          optDate.value = formatDMY(r.followDate);
        } else {
          optDate.dataset.iso = "";
          optDate.value = "";
        }
      
         const t = r.followTime || "";
         if (t) {
           let [h, m] = t.split(":").map(Number);
         
           timeState.ampm = h >= 12 ? "PM" : "AM";
           if (h === 0) h = 12;
           else if (h > 12) h -= 12;
         
           timeState.hh = h;
           timeState.mm = m;
         
           timeHH.textContent = String(h).padStart(2, "0");
           timeMM.textContent = String(m).padStart(2, "0");
           timeAMPM.textContent = timeState.ampm;
         
           document.getElementById("optTime").dataset.value = t;
         } else {
           timeHH.textContent = "HH";
           timeMM.textContent = "MM";
           timeAMPM.textContent = "AM";
           document.getElementById("optTime").dataset.value = "";
         } 
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
     notesHeightLocked = true;
   
     // ⛔ Clamp saved height to max 400px
     const clampedH = Math.min(parseInt(savedH, 10), 300);
     optNotes.style.height = clampedH + "px";
   } else {
     notesHeightLocked = false;
     resizeNotes();
   }



  /* Warning Block */
   if (requireFollowUp && !optDate.dataset.iso) {
     const displayStatus = pendingStatusForModal || r.status || "";
     showModalWarning(`Status "${displayStatus}" needs a follow-up date.`);
   }

  modal.classList.add("show");
   animateModalOpen();
   setTimeout(resizeNotes, 60);
   updateSaveButtonState();

}

// =====================================================
// CLOSURE SURVEY MODAL
// =====================================================
function openClosureModal(row) {
  const modal = document.getElementById("closureModal");
  modal.classList.add("show");

  // 🔹 Update modal title with Case ID
  document.getElementById("closureModalTitle").textContent =
    `Case Closure Survey — ${row.id}`;

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

    const modalEl = document.getElementById("closureModal");

    // 🧹 Clear closure warning if present
    const warn = document.getElementById("closureWarning");
    if (warn) warn.remove();

    // 🔒 REVERT LOGIC (only if survey NOT completed)
    if (!closureSurveyCompleted && pendingStatusForModal === "Closed") {

      const row = trackerState.allCases.find(
        r => r.id === currentModalCaseId
      );

      if (row) {
        row.status = prevStatusBeforeModal || "";
      }

      pendingStatusForModal = null;
      prevStatusBeforeModal = null;

      applyFilters(); // refresh dropdown UI
    }

    modalEl.classList.remove("show");
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

/* CLEAR BUTTON — Reset Notes + Follow-up Date */
btnModalClear.onclick = () => {
  optNotes.value = "";
  optDate.value = "";
  optDate.dataset.iso = "";

  // Reset custom time picker
  timeState.hh = null;
  timeState.mm = null;
  timeState.ampm = "AM";

  timeHH.textContent = "HH";
  timeMM.textContent = "MM";
  timeAMPM.textContent = "AM";

  document.getElementById("optTime").dataset.value = "";

  resizeNotes();
};

function closeModal() {

  if (pendingStatusForModal && currentModalCaseId) {
    const r = trackerState.allCases.find(x => x.id === currentModalCaseId);
    if (r) {
      r.status = prevStatusBeforeModal || "";
    }
    pendingStatusForModal = null;
    prevStatusBeforeModal = null;

    applyFilters();
  }

  requireFollowUp = false;

  // ✅ Clean protection BEFORE resetting case ID
  if (currentModalCaseId) {
    pendingUnupdated.delete(currentModalCaseId);
  }

  // ✅ Set active row back after modal closes
  if (currentModalCaseId) {
    setActiveRowByCaseId(currentModalCaseId);
  } 

  unupdatedProtect = false;
  currentModalCaseId = null;

  hideModalWarning();

  animateModalClose(() => {
    modal.classList.remove("show");
  });



  window.__fromReminder = false;
  closureSurveyCompleted = false;
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

// =====================================================
// SAVE BUTTON AUTO-DISABLE LOGIC
// =====================================================

function updateSaveButtonState() {
  if (!btnModalSave) return;

  const follow = optDate.dataset.iso || "";
  const effectiveStatus =
    pendingStatusForModal !== null
      ? pendingStatusForModal
      : (
          trackerState.allCases.find(
            c => c.id === currentModalCaseId
          )?.status || ""
        );

  const needsFollow =
    effectiveStatus === "Service Pending" ||
    effectiveStatus === "Monitoring";

   if (needsFollow && !follow) {
     btnModalSave.disabled = true;
     btnModalSave.style.opacity = "0.6";
     btnModalSave.style.cursor = "not-allowed";
   
     // ✅ UX enhancement — hover explanation
     btnModalSave.title = "Follow-up date required for this status";
   
   } else {
     btnModalSave.disabled = false;
     btnModalSave.style.opacity = "";
     btnModalSave.style.cursor = "";
   
     // ✅ Remove tooltip when enabled
     btnModalSave.title = "";
   }
}

function showClosureWarning(msg) {
  let warn = document.getElementById("closureWarning");
  if (!warn) {
    warn = document.createElement("div");
    warn.id = "closureWarning";
    warn.style.cssText = `
      background: rgba(255,107,107,0.2);
      border: 1px solid var(--danger);
      padding: .5rem;
      border-radius: 10px;
      color: var(--danger);
      font-weight: 600;
      margin-bottom: .5rem;
    `;
    const body = document.querySelector("#closureModal .modal-body");
    body.prepend(warn);
  }
  warn.textContent = msg;
}

/* =======================================================================
   DATE FORMATTER
   ======================================================================= */

function formatDMY(iso) {
  const [y, m, d] = iso.split("-");
  return `${d}-${m}-${y}`;
}

/* =========================================================
   CUSTOM TIME PICKER — SEPARATE HH / MM DROPDOWNS
   ========================================================= */

const timeHH = document.getElementById("timeHH");
const timeMM = document.getElementById("timeMM");
const timeAMPM = document.getElementById("timeAMPM");

const hhDropdown = document.getElementById("hhDropdown");
const mmDropdown = document.getElementById("mmDropdown");

let timeState = {
  hh: null,
  mm: null,
  ampm: "AM"
};

/* ---------- helpers ---------- */

function closeTimeDropdowns() {
  hhDropdown.style.display = "none";
  mmDropdown.style.display = "none";
}

function syncTimeValue() {
  if (timeState.hh !== null && timeState.mm !== null) {

    // Convert to 24h for storage (CRITICAL)
    const time24h = convert12hTo24h(
      timeState.hh,
      timeState.mm,
      timeState.ampm
    );

    // Store ONLY 24h internally
    document.getElementById("optTime").dataset.value = time24h;

    // Optional: store display value if ever needed
    document.getElementById("optTime").dataset.display =
      `${String(timeState.hh).padStart(2, "0")}:${String(timeState.mm).padStart(2, "0")} ${timeState.ampm}`;
  }
}

/* ---------- HH dropdown ---------- */

timeHH.onclick = (e) => {
  e.stopPropagation();
  closeCalendar();
  closeTimeDropdowns();

  hhDropdown.innerHTML = `
    <div class="time-dropdown">
      ${[1,2,3,4,5,6,7,8,9,10,11,12]
        .map(h => `<div data-hh="${h}">${String(h).padStart(2,"0")}</div>`)
        .join("")}
    </div>
  `;

  hhDropdown.style.display = "block";
};

hhDropdown.onclick = (e) => {
  const opt = e.target.closest("[data-hh]");
  if (!opt) return;

  timeState.hh = Number(opt.dataset.hh);
  timeHH.textContent = String(timeState.hh).padStart(2, "0");

  syncTimeValue();
  closeTimeDropdowns();
};

/* ---------- MM dropdown ---------- */

timeMM.onclick = (e) => {
  e.stopPropagation();
  closeCalendar();
  closeTimeDropdowns();

   mmDropdown.innerHTML = `
     <div class="time-dropdown">
       ${[0,5,10,15,20,25,30,35,40,45,50,55]
         .map(m => `<div data-mm="${m}">${String(m).padStart(2,"0")}</div>`)
         .join("")}
     </div>
   `;

  mmDropdown.style.display = "block";
};

mmDropdown.onclick = (e) => {
  const opt = e.target.closest("[data-mm]");
  if (!opt) return;

  timeState.mm = Number(opt.dataset.mm);
  timeMM.textContent = String(timeState.mm).padStart(2, "0");

  syncTimeValue();
  closeTimeDropdowns();
};

/* ---------- AM / PM toggle ---------- */

timeAMPM.onclick = () => {
  closeCalendar();
  timeState.ampm = timeState.ampm === "AM" ? "PM" : "AM";
  timeAMPM.textContent = timeState.ampm;
  syncTimeValue();
};

/* ---------- global close ---------- */

document.addEventListener("click", closeTimeDropdowns);

/* =========================================================
   TIME FORMAT HELPERS
   ========================================================= */

function convert12hTo24h(hh, mm, ampm) {
  let h = Number(hh);
  const m = Number(mm);

  if (ampm === "PM" && h !== 12) h += 12;
  if (ampm === "AM" && h === 12) h = 0;

  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
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

/* Replace close handlers */
btnModalClose.onclick = closeModal;


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
  if (notesHeightLocked) return;

  optNotes.style.height = "auto";

  // ⛔ Clamp auto-grow to max 400px
  const newH = Math.min(optNotes.scrollHeight + 6, 300);
  optNotes.style.height = newH + "px";
});


/* SAVE resized height to localStorage */
optNotes.addEventListener("mouseup", () => {
  let h = parseInt(optNotes.style.height, 10);
  if (!h) return;

  // ⛔ Clamp to max 400px
  h = Math.min(h, 300);

  optNotes.style.height = h + "px";
  localStorage.setItem("notesBoxHeight", h + "px");
  notesHeightLocked = true;
});



/* Initial resize when modal opens */
function resizeNotes() {
  if (notesHeightLocked) return;

  optNotes.style.height = "auto";
  const newH = Math.min(optNotes.scrollHeight + 6, 300);
  optNotes.style.height = newH + "px";
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
     "Team ID": trackerState.teamId,
   
     "Customer Name": r.customerName,
     "Created On": r.createdOn,
     "Created By": r.createdBy || "",
     "Country": r.country,
     "Case Resolution Code": r.caseResolutionCode,
     "Case Owner": r.caseOwner,
   
     "OTC Code": r.otcCode || "",
     "CA Group": r.caGroup,
     "TL": r.tl,
     "SBD": r.sbd,
     "Market": r.market || "",
   
     "Status": r.status || "",
     "Follow Date": r.followDate || "",
     "Follow Time": r.followTime || "",
   
     "Flagged": r.flagged ? "Yes" : "No",
     "PNS": r.PNS ? "Yes" : "No",
   
     "Survey Prediction": r.surveyPrediction ?? "",
     "Prediction Comment": r.predictionComment ?? "",
     "Notes": r.notes || "",
   
     "Last Actioned On": r.lastActionedOn || "",
     "Last Actioned By": userNameMap[r.lastActionedBy] || r.lastActionedBy || "",
     "Status Changed On": r.statusChangedOn || "",
     "Status Changed By": userNameMap[r.statusChangedBy] || r.statusChangedBy || ""
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
   const optTime = document.getElementById("optTime");
   r.followTime = optTime?.dataset.value || "";

   /* =====================================================
      FOLLOW-UP VALIDATION (TABLE + REMINDER FLOWS)
      ===================================================== */
   
   const effectiveStatus =
     pendingStatusForModal !== null
       ? pendingStatusForModal
       : r.status || "";
   
   const needsFollowUpEnforced =
     requireFollowUp ||
     (
       window.__fromReminder &&
       (effectiveStatus === "Service Pending" ||
        effectiveStatus === "Monitoring")
     );
   
   if (needsFollowUpEnforced && !follow) {
     showModalWarning(
       `Status "${effectiveStatus}" requires a follow-up date.`
     );
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
   // ⛔ BLOCK Closed unless survey was submitted
   if (pendingStatusForModal === "Closed" && !closureSurveyCompleted) {
     const row = trackerState.allCases.find(
       c => c.id === currentModalCaseId
     );
   
     if (row) {
       openClosureModal(row);
     }
   
     showClosureWarning(
       "Please complete the Case Closure Survey before closing this case."
     );
   
     return false;
   }
   
   // Persist pending status (SP / Monitoring / Closed-after-survey)
   if (pendingStatusForModal) {
     updateObj.status = pendingStatusForModal;
     updateObj.statusChangedOn = today;
     updateObj.statusChangedBy = trackerState.user.uid;
   }

  try {
    await firestoreUpdateCase(caseId, updateObj);
     // NEW: Remove pending lock for this case after modal save
    pendingUnupdated.delete(caseId);

    pendingStatusOverride.delete(caseId);

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
  currentCase = null;
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
      setTimeout(() => toast.classList.remove("show"), 5000);
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
     r.statusChangedOn === today &&
     r.status && r.status.trim() !== ""   // ❌ ignore status changed to blank
   );

   // Prevent double counting when the same case status
   // is changed multiple times in the same day
   const uniqueFollowedCases = new Map();
   
   statusChangedToday.forEach(r => {
     uniqueFollowedCases.set(r.id, r);
   });
   
   const followedUpCases = Array.from(uniqueFollowedCases.values());

  // Closed
  const closedCases = followedUpCases.filter(r => r.status === "Closed");
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

  followedUpCases.forEach(r => {
    if (statusBreakdown[r.status] !== undefined) {
      statusBreakdown[r.status]++;
    }
  });

  const totalFollowedUp = followedUpCases.length;

   /* ---------------------------------------------
      2️⃣ TOTAL ACTIONED CASES (ANY ACTION TODAY)
      --------------------------------------------- */
   const actionedToday = trackerState.allCases.filter(r =>
     r.lastActionedBy === uid &&
     r.lastActionedOn === today &&
     r.status && r.status.trim() !== ""   // ❌ ignore status changed to blank
   );
   
   // Prevent double counting when the same case
   // is updated multiple times in the same day
   const uniqueActionedCases = new Map();
   
   actionedToday.forEach(r => {
     uniqueActionedCases.set(r.id, r);
   });
   
   const actionedCases = Array.from(uniqueActionedCases.values());
   
   const totalActioned = actionedCases.length;

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

   // If sidebar is open → close it using the official sidebar close logic
   if (el.sidebar.classList.contains("open")) {
     document.getElementById("btnSideClose").click();
   }
   
   // Close Case Options modal if open
   if (modal.classList.contains("show")) {
     closeModal();
   }
   
   // Close Email Preview modal if open
   const emailPreviewModal = document.getElementById("emailPreviewModal");
   if (emailPreviewModal?.classList.contains("show")) {
     emailPreviewModal.classList.remove("show");
   }
   
   // Then open Tracker Summary modal
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

/* =========================================================
   TEMPLATE TOOLBAR BUTTONS
   ========================================================= */

function formatPartName(partName) {
  if (!partName || typeof partName !== "string") return partName;

  const index = partName.indexOf("-");
  if (index === -1) return partName;

  return partName.substring(index + 1).trim();
}

function applyTemplateVariables(text, caseData, templateKey = "") {

  const agentFullName =
    document.getElementById("userFullName")?.textContent || "";

  const agentFirstName = agentFullName.split(" ")[0] || "";

   console.log("Template caseData:", caseData);

   const vars = {
     customerName: (() => {
       let name = caseData.customerName || "";
      
       // 🚫 Special case: Return Label Request → FULL NAME
       if (templateKey === "returnLabelRequest") {
         return name
           .split(" ")
           .filter(Boolean)
           .map(word => {
             const clean = word.replace(/[^a-zA-Z-]/g, "");
             if (!clean) return "";
             return clean.charAt(0).toUpperCase() +
                    clean.slice(1).toLowerCase();
           })
           .join(" ");
       }
      
       // ✅ Default → FIRST NAME ONLY
       let first = name.split(" ")[0] || "";
       first = first.replace(/[^a-zA-Z]/g, "");
       if (!first) return "";
      
       return first.charAt(0).toUpperCase() +
              first.slice(1).toLowerCase();
     })(),
     caseId: caseData.id ?? "",
     productName: caseData.productName ?? "",
     serialNumber: caseData.serialNumber ?? "",
     trackingStatus: caseData.trackingStatus ?? "",
     partName: (() => {
       // 🚫 Skip formatting for Return Label Request templates
       if (templateKey === "returnLabelRequest") {
         return caseData.partName ?? "";
       }
      
       return formatPartName(caseData.partName ?? "");
     })(),
     partNumber: caseData.partNumber ?? "",
     agentFirstName: agentFirstName ?? "",
   
     /* KCI Notes variables */
     onsiteRFC: caseData.onsiteRFC ?? "",
     benchRFC: caseData.benchRFC ?? "",
     csrRFC: caseData.csrRFC ?? "",
     woClosureNotes: caseData.woClosureNotes ?? ""
   };

  Object.keys(vars).forEach(key => {
    text = text.replaceAll(`{{${key}}}`, vars[key]);
  });

   /* Remove lines where template values are empty */
   text = text
     .split("\n")
     .filter(line => {
       if (line.includes("Product Name:") && !vars.productName) return false;
       if (line.includes("Serial Number:") && !vars.serialNumber) return false;
       if (line.includes("Part Name:") && !vars.partName) return false;
       if (line.includes("Part Number:") && !vars.partNumber) return false;
       if (line.includes("Delivery Details:") && !vars.trackingStatus) return false;
       return true;
     })
     .join("\n");

   /* Remove Product Details section only if it contains no values */
   text = text.replace(
     /Product Details:\n((?:.*\n)*?)(?:\n|$)/,
     (match, section) => {
       const hasValue = section.match(/:\s*\S+/);
       return hasValue ? match : "";
     }
   );
   
   /* Remove Part Details section only if it contains no values */
   text = text.replace(
     /Part Details:\n((?:.*\n)*?)(?:\n|$)/,
     (match, section) => {
       const hasValue = section.match(/:\s*\S+/);
       return hasValue ? match : "";
     }
   );

   /* Clean extra blank lines */
   text = text.replace(/\n{2,}/g, "\n\n");

  if (vars.trackingStatus === "No status found") {
    text = text.replace(/• Delivery Details:.*\n?/g, "");
  }

  return text;
}

async function copyTemplateRich(text) {

  const html = `<div style="font-family:Arial;font-size:15px;line-height:1.4;">${text.replace(/\n/g,"<br>")}</div>`;

  const blobHtml = new Blob([html], { type: "text/html" });
  const blobText = new Blob([text], { type: "text/plain" });

  const clipboardItem = new ClipboardItem({
    "text/html": blobHtml,
    "text/plain": blobText
  });

  await navigator.clipboard.write([clipboardItem]);
}

document.addEventListener("click", (e) => {

  const btn = e.target.closest(".tpl-btn");
  if (!btn) return;

  const key = btn.dataset.template;
  if (!key) return;

  // 🚫 Prevent template copy if no case modal is active
  if (!currentCase) {
    showPopup("Open a case before copying a template");
    return;
  }

  const tplDef = templates[key];
  if (!tplDef) return;

  /* Get currently opened case */
  const caseData = currentCase || {};

  /* Get template (static or dynamic) */
  let tpl = tplDef;

  if (typeof tplDef.getTemplate === "function") {
    tpl = tplDef.getTemplate(caseData);
  }

  if (!tpl) {
    showPopup("Template not available for this case");
    return;
  }

   /* =========================
      KCI NOTES TEMPLATE
   ========================= */
   
   if (key === "kci") {
   
     let notes = applyTemplateVariables(tpl.body, caseData, key);
   
     navigator.clipboard.writeText(notes)
       .then(() => {
   
         showPopup("KCI Notes Copied");
   
         btn.classList.add("flash-success");
   
         setTimeout(() => {
           btn.classList.remove("flash-success");
         }, 900);
   
       })
       .catch(() => showPopup("Copy Failed"));
   
     return;
   }
   
   /* =========================
      EMAIL TEMPLATES
   ========================= */
   
   let body = applyTemplateVariables(tpl.body, caseData, key);
   
   copyTemplateRich(body)
     .then(() => {
   
       showPopup("Template Body Copied");
   
       btn.classList.add("flash-success");
   
       setTimeout(() => {
         btn.classList.remove("flash-success");
       }, 900);
   
     })
     .catch(() => showPopup("Copy Failed"));

});

document.addEventListener("contextmenu", (e) => {

  const btn = e.target.closest(".tpl-btn");
  if (!btn) return;

  const key = btn.dataset.template;
  if (!key) return;

  /* Disable right-click for KCI Notes */
  if (key === "kci") {
    e.preventDefault();
    return;
  }

  // 🚫 Prevent template copy if no case modal is active
  if (!currentCase) {
    showPopup("Open a case before copying a template");
    return;
  }

  const tplDef = templates[key];
  if (!tplDef) return;

  e.preventDefault();

  const caseData = currentCase || {};

  let tpl = tplDef;

  if (typeof tplDef.getTemplate === "function") {
    tpl = tplDef.getTemplate(caseData);
  }

  if (!tpl) {
    showPopup("Template not available for this case");
    return;
  }

  let subject = applyTemplateVariables(tpl.subject, caseData, key);

   navigator.clipboard.writeText(subject)
     .then(() => {
   
       showPopup("Template Subject Copied");
   
       // Success flash animation (right click)
       btn.classList.add("flash-success");
   
       setTimeout(() => {
         btn.classList.remove("flash-success");
       }, 900);
   
     })
     .catch(() => showPopup("Copy Failed"));

});

/* =========================================================
   TEMPLATE TOOLBAR — MORE BUTTON
   ========================================================= */

const tplMoreBtn = document.getElementById("tplMoreBtn");

tplMoreBtn.addEventListener("click", () => {

  if (!currentCase) return;

  openEmailPreviewModal(currentCase);

});

/* =========================================================
   EMAIL PREVIEW MODAL
   ========================================================= */

function openEmailPreviewModal(caseData) {

  const caseId = caseData.id || "";

  emailPreviewTitle.textContent =
     "Email Templates Preview – " + (caseData.id || "Unknown Case");

  renderEmailPreviewToolbar(caseData);

  emailPreviewSubject.value = "";
  emailPreviewBody.value = "";

  // 🔒 Reset return label email row
  document.getElementById("returnLabelEmails").style.display = "none";

  document.getElementById("modal").classList.remove("show");
  emailPreviewModal.classList.add("show");

}

function renderEmailPreviewToolbar(caseData) {

  emailPreviewToolbar.innerHTML = "";

  const resolution = caseData.caseResolutionCode;

  const buttons = [
    "ncm1",
    "ncm2",
    "closure",
    "confirmation",
    "unresolved",
    "resolved"
  ];

  if (resolution === "Offsite Solution" ||
      resolution === "Parts Shipped") {
    buttons.push("pod");
  }

  buttons.push("oooClosure");

  if (resolution === "Parts Shipped") {
    buttons.push("returnLabelUpdate");
    buttons.push("returnLabelRequest");
  }

  buttons.forEach(type => {

    const btn = document.createElement("button");

    btn.className = "tpl-btn";

    const labelMap = {
      ncm1: "NCM 1",
      ncm2: "NCM 2",
      closure: "NCM Closure",
      confirmation: "Confirmation",
      unresolved: "Unresolved",
      resolved: "Resolved",
      pod: "POD",
      oooClosure: "OOO Closure",
      returnLabelUpdate: "Return Label Update",
      returnLabelRequest: "Return Label Request"
    };
   
    btn.textContent = labelMap[type] || type;

    btn.addEventListener("click", () => {
   
      // Remove highlight from all toolbar buttons
      document.querySelectorAll("#emailPreviewToolbar .tpl-btn")
        .forEach(b => b.classList.remove("active"));
   
      // Highlight the clicked button
      btn.classList.add("active");
   
      // Load the selected email template
      loadEmailTemplate(type, caseData);
   
    });

    emailPreviewToolbar.appendChild(btn);

  });

}

function loadEmailTemplate(type, caseData) {

  const template = templates[type];

  const emailRow = document.getElementById("returnLabelEmails");
   
  if (type === "returnLabelRequest") {
    emailRow.style.display = "flex";
  } else {
    emailRow.style.display = "none";
  }

  if (!template) return;

  const tpl =
    template.getTemplate
      ? template.getTemplate(caseData)
      : template;

  if (!tpl) return;

  const subject =
    applyTemplateVariables(tpl.subject, caseData, type);
   
  const body =
    applyTemplateVariables(tpl.body, caseData, type);

  emailPreviewSubject.value = subject;
  emailPreviewBody.value = body;

}

document.addEventListener("click", e => {

  const btn = e.target.closest(".email-copy-btn");
  if (!btn) return;

  const email = btn.dataset.email;
  if (!email) return;

  navigator.clipboard.writeText(email);

  // ✅ FLASH BUTTON
  btn.classList.add("flash-success");

  const input = btn.nextElementSibling;
  if (input && input.classList.contains("email-field")) {
    input.classList.add("flash-success");
  }

  // ✅ Helper function
  const applyAutoRemove = (el) => {
    const remove = () => {
      el.classList.remove("flash-success");
    };
    el.addEventListener("animationend", remove, { once: true });
  };

  // ✅ Apply safely
  applyAutoRemove(btn);

  if (input && input.classList.contains("email-field")) {
    applyAutoRemove(input);
  }

  // ✅ Toast
  showPopup("Returns Email Address Copied");

});

btnCopyEmailSubject.addEventListener("click", () => {

  navigator.clipboard.writeText(emailPreviewSubject.value);

  btnCopyEmailSubject.classList.add("flash-success");

  btnCopyEmailSubject.addEventListener("animationend", () => {
    btnCopyEmailSubject.classList.remove("flash-success");
  }, { once: true });

  showPopup("Email Subject Copied");

});

btnCopyEmailBody.addEventListener("click", () => {

  const body = emailPreviewBody.value || "";

  copyTemplateRich(body)
    .then(() => {

      btnCopyEmailBody.classList.add("flash-success");

      btnCopyEmailBody.addEventListener("animationend", () => {
        btnCopyEmailBody.classList.remove("flash-success");
      }, { once: true });

      showPopup("Email Body Copied");

    })
    .catch(() => {
      showPopup("Copy Failed");
    });

});

btnEmailPreviewBack.addEventListener("click", () => {

  emailPreviewModal.classList.remove("show");

  document.getElementById("modal").classList.add("show");

});

btnEmailPreviewClose.addEventListener("click", () => {

  emailPreviewModal.classList.remove("show");
  document.getElementById("modal").classList.remove("show");

});





























































































































































































