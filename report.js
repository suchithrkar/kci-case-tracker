/* =========================================================
   REPORT PAGE — CORE LOGIC
   ========================================================= */

import {
  auth,
  db,
  onAuthStateChanged,
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  where
} from "./js/firebase.js";

import {
  isPrimary,
  isSecondary,
  getCurrentTrackerTeam,
  toggleTheme
} from "./js/userProfile.js";

import { showPopup } from "./js/utils.js";

/* =========================================================
   STATE
   ========================================================= */

const reportState = {
  user: null,
  teamId: null,
  teamConfig: null,

  view: "today",
  activeMetric: null,

  todayISO: "",
  currentMonth: "",

  liveCases: [],
  dailyReports: {}
};

/* =========================================================
   DOM REFERENCES
   ========================================================= */

const el = {
  userFullName: document.getElementById("userFullName"),
  btnTheme: document.getElementById("btnTheme"),
  btnAdmin: document.getElementById("btnAdmin"),
  btnLogout: document.getElementById("btnLogout"),
  btnTracker: document.getElementById("btnTracker"),

  distributionTable: document
    .getElementById("distributionTable")
    .querySelector("tbody"),

  todaySummaryBlock: document.getElementById("todaySummaryBlock"),
  todaySummaryContainer:
     document.getElementById("todaySummaryContainer"),

  monthlyBlock: document.getElementById("monthlyReportBlock"),
  monthlyChartWrap: document.querySelector("#monthlyReportBlock .chart-wrap"),

  reportViewSelect: document.getElementById("reportViewSelect"),

   /* TOP PAGE TABS */
   tabReports: document.getElementById("tabReports"),
   tabAgentStats: document.getElementById("tabAgentStats"),
   
   sectionReports: document.getElementById("sectionReports"),
   sectionAgentStats: document.getElementById("sectionAgentStats"),
};

const reportTeamControls =
  document.getElementById("reportTeamControls");

const statsControls =
  document.getElementById("statsControls");

const statsTableWrap =
  document.getElementById("statsTableWrap");


// ---------------- USER STATS MODAL ---------------- //

const modalUserStats = document.getElementById("modalUserStats");
const userStatsBody  = document.getElementById("userStatsBody");
const userStatsTitle = document.getElementById("userStatsTitle");
const btnUserStatsClose = document.getElementById("btnUserStatsClose");
const btnUserStatsOk = document.getElementById("btnUserStatsOk");

btnUserStatsClose.onclick = () => modalUserStats.classList.remove("show");
btnUserStatsOk.onclick    = () => modalUserStats.classList.remove("show");


// Audit modal refs
const modalAudit = document.getElementById("modalAudit");
const auditList = document.getElementById("auditList");
const btnAuditClose = document.getElementById("btnAuditClose");
const btnAuditOk = document.getElementById("btnAuditOk");

btnAuditClose.onclick = () => modalAudit.classList.remove("show");
btnAuditOk.onclick = () => modalAudit.classList.remove("show");


// No follow modal refs
const modalNoFollow = document.getElementById("modalNoFollow");
const noFollowList = document.getElementById("noFollowList");
const btnNoFollowClose = document.getElementById("btnNoFollowClose");
const btnNoFollowOk = document.getElementById("btnNoFollowOk");

btnNoFollowClose.onclick = () => modalNoFollow.classList.remove("show");
btnNoFollowOk.onclick = () => modalNoFollow.classList.remove("show");

/* =========================================================
   TEAM-AWARE TODAY CALCULATION (REUSED)
   ========================================================= */

function getTeamToday(teamConfig) {
  const timezone = teamConfig?.resetTimezone || "UTC";
  const resetHour =
    typeof teamConfig?.resetHour === "number"
      ? teamConfig.resetHour
      : 0;

  const now = new Date();

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

  if (teamHour < resetHour) {
    const d = new Date(`${teamDate}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() - 1);
    teamDate = d.toISOString().split("T")[0];
  }

  return teamDate;
}

/* =========================================================
   AUTH + INIT
   ========================================================= */

onAuthStateChanged(auth, async (user) => {
  if (!user) return (location.href = "login.html");

  const snap = await getDoc(doc(db, "users", user.uid));
  if (!snap.exists()) return (location.href = "login.html");

  const data = snap.data();
  if (data.status !== "approved") {
    showPopup("Account pending approval.");
    return auth.signOut();
  }

  // ❌ Block general users
  if (!isPrimary(data) && !isSecondary(data)) {
    return (location.href = "index.html");
  }

  reportState.user = { uid: user.uid, ...data };
  reportState.teamId = isPrimary(data)
     ? "TOTAL"
     : getCurrentTrackerTeam(data);

  /* Load team config */
  if (reportState.teamId !== "TOTAL") {
   
     const teamSnap = await getDoc(
       doc(db, "teams", reportState.teamId)
     );
   
     reportState.teamConfig = teamSnap.exists()
       ? {
           resetTimezone: teamSnap.data().resetTimezone || "UTC",
           resetHour:
             typeof teamSnap.data().resetHour === "number"
               ? teamSnap.data().resetHour
               : 0
         }
       : { resetTimezone: "UTC", resetHour: 0 };
   
   } else {
   
     // TOTAL → no team-specific config
     reportState.teamConfig = {
       resetTimezone: "UTC",
       resetHour: 0
     };
   
   }

  reportState.todayISO = getTeamToday(reportState.teamConfig);
  reportState.currentMonth = reportState.todayISO.slice(0, 7);

  initHeader(data);

   if (isPrimary(data)) {
     reportTeamControls.classList.remove("hidden");
     await loadTeamsForReport();
   } else {
     reportTeamControls.classList.add("hidden");
   }
   
  await loadLiveCases();
  await loadTodaySummary();

  renderDistributionTable();
   renderTodaySummary();
   
   setupControls();
   setupReportTabs();
   setupPageTabs();
});

/* =========================================================
   HEADER
   ========================================================= */

function initHeader(user) {
  el.userFullName.textContent =
    `${user.firstName} ${user.lastName}`;

  document.documentElement.dataset.theme =
    user.theme || "dark";

  el.btnTheme.textContent =
    (user.theme || "dark") === "dark" ? "☀️" : "🌙";

  el.btnTheme.onclick = () => {
    toggleTheme(user);
    el.btnTheme.textContent =
      user.theme === "dark" ? "☀️" : "🌙";
  };

   el.btnAdmin.style.display = "inline-block";
   el.btnAdmin.onclick = () => (location.href = "admin.html");
   
   el.btnTracker.onclick = () => (location.href = "index.html");
   
   el.btnLogout.onclick = () =>
     auth.signOut().then(() => (location.href = "login.html"));
}

/* =========================================================
   DATA LOADERS
   ========================================================= */

async function loadLiveCases() {

  if (reportState.teamId === "TOTAL") {

    // Load all teams separately
    const teamsSnap = await getDocs(collection(db, "teams"));

    let allCases = [];

    for (const teamDoc of teamsSnap.docs) {

      const teamId = teamDoc.id;

      const colRef = collection(
        db,
        "cases",
        teamId,
        "casesList"
      );

      const snap = await getDocs(colRef);

      snap.forEach(d => {
        allCases.push(d.data());
      });
    }

    reportState.liveCases = allCases;

  } else {

    const colRef = collection(
      db,
      "cases",
      reportState.teamId,
      "casesList"
    );

    const snap = await getDocs(colRef);

    reportState.liveCases = snap.docs.map(d => d.data());
  }
}

async function loadTodaySummary() {

  // =====================================================
  // TOTAL MODE
  // =====================================================

  if (reportState.teamId === "TOTAL") {

    const teamsSnap = await getDocs(
      collection(db, "teams")
    );
   
    const sortedTeams = teamsSnap.docs
      .map(docSnap => ({
        id: docSnap.id,
        ...docSnap.data()
      }))
      .sort((a, b) => {
        const aTime = a.createdAt?.seconds || 0;
        const bTime = b.createdAt?.seconds || 0;
   
        return aTime - bTime; // oldest → newest
      });
   
    const teamReports = [];

    const grandTotal = {
      totalOpenOnsite: 0,
      totalOpenOffsite: 0,
      totalOpenCSR: 0,
      totalOpen: 0,

      readyForClosureOnsite: 0,
      readyForClosureOffsite: 0,
      readyForClosureCSR: 0,
      readyForClosureTotal: 0,

      overdueOnsite: 0,
      overdueOffsite: 0,
      overdueCSR: 0,
      overdueTotal: 0
    };

    for (const teamDoc of sortedTeams) {

      const ref = doc(
        db,
        "cases",
        teamDoc.id,
        "reports",
        reportState.todayISO
      );

      const snap = await getDoc(ref);

      const data = snap.exists()
        ? snap.data()
        : {};

      // Store team report
      teamReports.push({
        teamId: teamDoc.id,
        teamName:
          teamDoc.name || teamDoc.id,
        report: data
      });

      // Accumulate grand total
      grandTotal.totalOpenOnsite +=
        data.totalOpenOnsite || 0;

      grandTotal.totalOpenOffsite +=
        data.totalOpenOffsite || 0;

      grandTotal.totalOpenCSR +=
        data.totalOpenCSR || 0;

      grandTotal.totalOpen +=
        data.totalOpen || 0;

      grandTotal.readyForClosureOnsite +=
        data.readyForClosureOnsite || 0;

      grandTotal.readyForClosureOffsite +=
        data.readyForClosureOffsite || 0;

      grandTotal.readyForClosureCSR +=
        data.readyForClosureCSR || 0;

      grandTotal.readyForClosureTotal +=
        data.readyForClosureTotal || 0;

      grandTotal.overdueOnsite +=
        data.overdueOnsite || 0;

      grandTotal.overdueOffsite +=
        data.overdueOffsite || 0;

      grandTotal.overdueCSR +=
        data.overdueCSR || 0;

      grandTotal.overdueTotal +=
        data.overdueTotal || 0;
    }

    reportState.todayReport = {
      teams: teamReports,
      grandTotal
    };

    return;
  }

  // =====================================================
  // SINGLE TEAM MODE
  // =====================================================

  const ref = doc(
    db,
    "cases",
    reportState.teamId,
    "reports",
    reportState.todayISO
  );

  const snap = await getDoc(ref);

  reportState.todayReport = snap.exists()
    ? snap.data()
    : {};
}

async function loadTeamsForReport() {
  // Inject dropdown skeleton (same pattern as Admin)
  reportTeamControls.innerHTML = `
    <div class="custom-select" id="reportTeamSelect">
      <div class="custom-select-trigger">
        <span id="reportTeamLabel">TOTAL</span>
      </div>
      <div class="custom-options" id="reportTeamOptions"></div>
    </div>
  `;

  const labelEl =
    document.getElementById("reportTeamLabel");
  const optionsEl =
    document.getElementById("reportTeamOptions");

  // Add TOTAL option
  let html = `
    <div class="custom-option" data-team="TOTAL">TOTAL</div>
  `;

  const snap = await getDocs(collection(db, "teams"));
   
   const teams = snap.docs
     .map(docSnap => ({
       id: docSnap.id,
       ...docSnap.data()
     }))
     .sort((a, b) => {
       const aTime = a.createdAt?.seconds || 0;
       const bTime = b.createdAt?.seconds || 0;
   
       return aTime - bTime; // oldest → newest
     });
   
   teams.forEach(t => {
   
     html += `
       <div class="custom-option" data-team="${t.id}">
         ${t.name || t.id}
       </div>
     `;
   });

  optionsEl.innerHTML = html;

  // Handle selection
  optionsEl.onclick = async (e) => {
    const opt = e.target.closest(".custom-option");
    if (!opt) return;

    labelEl.textContent = opt.textContent;

    reportState.teamId =
      opt.dataset.team === "TOTAL"
        ? "TOTAL"
        : opt.dataset.team;

    await loadLiveCases();
    await loadTodaySummary();
   
    renderDistributionTable();
    renderTodaySummary();

     // ✅ Refresh month options based on selected team
      const optionsElView =
        el.reportViewSelect.querySelector(".custom-options");
      
      const months = await loadAvailableMonths();
      
      let html = `
        <div class="custom-option" data-value="today">
          Today
        </div>
      
        <div style="border-top:1px solid var(--border); margin:6px 0;"></div>
      `;
      
      months.forEach(m => {
        html += `
          <div class="custom-option" data-value="month" data-month="${m}">
            ${(() => {
              const { month, year } = formatMonthLabel(m);
              return `
                <div class="month-option">
                  <span class="month-name">${month}</span>
                  <span class="month-year">${year}</span>
                </div>
              `;
            })()}
          </div>
        `;
      });
      
      html += `
        <div style="border-top:1px solid var(--border); margin:6px 0;"></div>
      
        <div class="custom-option" data-value="quarterly">
          Quarterly
        </div>
      `;
      
      optionsElView.innerHTML = html;

      // ✅ Ensure currentMonth is valid for new team
      if (!months.includes(reportState.currentMonth)) {
        reportState.currentMonth = months[0] || reportState.todayISO.slice(0, 7);
      }
      
      // ✅ Update dropdown label
      const viewTrigger =
        el.reportViewSelect.querySelector(".custom-select-trigger");
      
      if (viewTrigger && reportState.view === "month") {
        const { month, year } = formatMonthLabel(reportState.currentMonth);
        viewTrigger.textContent = `${month} ${year}`;
      }
  };
}

/* =========================================================
   RENDER — DISTRIBUTION TABLE
   ========================================================= */

const CA_BUCKETS = [
  "0-3 Days",
  "3-5 Days",
  "5-10 Days",
  "10-15 Days",
  "15-30 Days",
  "30-60 Days",
  "60-90 Days",
  "> 90 Days"
];

const CRS_TYPES = [
  "Onsite Solution",
  "Offsite Solution",
  "Parts Shipped"
];

function renderDistributionTable() {
  el.distributionTable.innerHTML = "";

  // ---------- Individual CRS rows ----------
  CRS_TYPES.forEach(type => {
    const tr = document.createElement("tr");
    let rowTotal = 0;

    const cells = CA_BUCKETS.map(bucket => {
      const count = reportState.liveCases.filter(c =>
        String(c.caseResolutionCode).trim() === type &&
        String(c.caGroup).trim() === bucket
      ).length;

      rowTotal += count;
      return `<td>${count}</td>`;
    }).join("");

    tr.innerHTML = `
      <td><strong>${type}</strong></td>
      ${cells}
      <td><strong>${rowTotal}</strong></td>
    `;

    el.distributionTable.appendChild(tr);
  });

  // ---------- GRAND TOTAL ROW ----------
  const totalRow = document.createElement("tr");
  let grandTotal = 0;

  const totalCells = CA_BUCKETS.map(bucket => {
    const count = reportState.liveCases.filter(c =>
      String(c.caGroup).trim() === bucket
    ).length;

    grandTotal += count;
    return `<td><strong>${count}</strong></td>`;
  }).join("");

  totalRow.innerHTML = `
    <td><strong>Total</strong></td>
    ${totalCells}
    <td><strong>${grandTotal}</strong></td>
  `;

  el.distributionTable.appendChild(totalRow);
}

/* =========================================================
   RENDER — TODAY SUMMARY
   ========================================================= */

function renderTodaySummary() {

  const container =
    el.todaySummaryContainer;

  // =====================================================
  // SINGLE TEAM MODE
  // =====================================================

  if (reportState.teamId !== "TOTAL") {

    const d = reportState.todayReport || {};

    const rows = [
     {
       label: "Onsite",
       total: d.totalOpenOnsite || 0,
       rfc: d.readyForClosureOnsite || 0,
       overdue: d.overdueOnsite || 0
     },
     {
       label: "Offsite",
       total: d.totalOpenOffsite || 0,
       rfc: d.readyForClosureOffsite || 0,
       overdue: d.overdueOffsite || 0
     },
     {
       label: "CSR",
       total: d.totalOpenCSR || 0,
       rfc: d.readyForClosureCSR || 0,
       overdue: d.overdueCSR || 0
     },
     {
        label: "Total",
        total: d.totalOpen || 0,
        rfc: d.readyForClosureTotal || 0,
        overdue: d.overdueTotal || 0
      }
   ];

    container.innerHTML = `
      <table class="today-summary-table">

        <thead>
          <tr>
            <th>Type</th>
            <th>Total Open</th>
            <th>Ready for Closure</th>
            <th>Overdue</th>
          </tr>
        </thead>

        <tbody>
          ${rows.map(r => `
            <tr>
              <td class="type-cell">${r.label}</td>
              <td>${r.total}</td>
              <td>${r.rfc}</td>
              <td>${r.overdue}</td>
            </tr>
          `).join("")}
        </tbody>

      </table>
    `;

    return;
  }

  // =====================================================
  // TOTAL MODE
  // =====================================================

  const teams =
    reportState.todayReport?.teams || [];

  const grandTotal =
    reportState.todayReport?.grandTotal || {};

  let html = `
    <table class="today-summary-table">

      <thead>
        <tr>
          <th>Team</th>
          <th>Type</th>
          <th>Total Open</th>
          <th>Ready for Closure</th>
          <th>Overdue</th>
        </tr>
      </thead>

      <tbody>
  `;

  teams.forEach(team => {

    const d = team.report || {};

    const rows = [
      {
        label: "Onsite",
        total: d.totalOpenOnsite || 0,
        rfc: d.readyForClosureOnsite || 0,
        overdue: d.overdueOnsite || 0
      },
      {
        label: "Offsite",
        total: d.totalOpenOffsite || 0,
        rfc: d.readyForClosureOffsite || 0,
        overdue: d.overdueOffsite || 0
      },
      {
        label: "CSR",
        total: d.totalOpenCSR || 0,
        rfc: d.readyForClosureCSR || 0,
        overdue: d.overdueCSR || 0
      }
    ];

    rows.forEach((r, index) => {
   
     html += `
       <tr class="${teams.indexOf(team) !== 0 && index === 0
         ? "team-section-start"
         : ""}">
   
         ${
           index === 0
             ? `
               <td class="team-cell" rowspan="3">
                 ${team.teamName}
               </td>
             `
             : ""
         }
   
         <td class="type-cell">
           ${r.label}
         </td>
   
         <td>${r.total}</td>
         <td>${r.rfc}</td>
         <td>${r.overdue}</td>
   
       </tr>
     `;
   });

   html += `
     <tr class="team-total-row">
   
       <td class="team-total-label"
           colspan="2">
   
         ${team.teamName} Total
   
       </td>
   
       <td>${d.totalOpen || 0}</td>
   
       <td>
         ${d.readyForClosureTotal || 0}
       </td>
   
       <td>${d.overdueTotal || 0}</td>
   
     </tr>
   `;
  });

  // =====================================================
  // GRAND TOTAL
  // =====================================================

  const grandRows = [
     {
       label: "Onsite",
       total: grandTotal.totalOpenOnsite || 0,
       rfc: grandTotal.readyForClosureOnsite || 0,
       overdue: grandTotal.overdueOnsite || 0
     },
     {
       label: "Offsite",
       total: grandTotal.totalOpenOffsite || 0,
       rfc: grandTotal.readyForClosureOffsite || 0,
       overdue: grandTotal.overdueOffsite || 0
     },
     {
       label: "CSR",
       total: grandTotal.totalOpenCSR || 0,
       rfc: grandTotal.readyForClosureCSR || 0,
       overdue: grandTotal.overdueCSR || 0
     }
   ];

  grandRows.forEach((r, index) => {
   
     html += `
       <tr class="
         grand-total-row
         ${index === 0 ? "team-section-start" : ""}
       ">
   
         ${
           index === 0
             ? `
               <td class="team-cell grand-total-label"
                   rowspan="3">
                 Grand Total
               </td>
             `
             : ""
         }
   
         <td class="type-cell">
           ${r.label}
         </td>
   
         <td>${r.total}</td>
         <td>${r.rfc}</td>
         <td>${r.overdue}</td>
   
       </tr>
     `;
   });

   html += `
     <tr class="grand-total-row overall-grand-total-row">
   
       <td class="team-total-label grand-total-label"
           colspan="2">
   
         Overall Grand Total
   
       </td>
   
       <td>${grandTotal.totalOpen || 0}</td>
   
       <td>
         ${grandTotal.readyForClosureTotal || 0}
       </td>
   
       <td>${grandTotal.overdueTotal || 0}</td>
   
     </tr>
   `;

  html += `
      </tbody>
    </table>
  `;

  container.innerHTML = html;
}

/* =========================================================
   CONTROLS — VIEW + METRICS
   ========================================================= */

function setupControls() {
  if (setupControls._initialized) return;
  setupControls._initialized = true;

   (async function initViewOptions() {
   
     const optionsEl =
       el.reportViewSelect.querySelector(".custom-options");
   
     const months = await loadAvailableMonths();
   
     let html = `
        <div class="custom-option" data-value="today">
          Today
        </div>
      
        <div style="border-top:1px solid var(--border); margin:6px 0;"></div>
      `;
   
     // ✅ Dynamic months
     months.forEach(m => {
       html += `
         <div class="custom-option" data-value="month" data-month="${m}">
           ${(() => {
             const { month, year } = formatMonthLabel(m);
             return `
               <div class="month-option">
                 <span class="month-name">${month}</span>
                 <span class="month-year">${year}</span>
               </div>
             `;
           })()}
         </div>
       `;
     });
   
     html += `
       <div style="border-top:1px solid var(--border); margin:6px 0;"></div>
   
       <div class="custom-option" data-value="quarterly">
         Quarterly
       </div>
     `;
   
     optionsEl.innerHTML = html;

     const viewTrigger =
        el.reportViewSelect.querySelector(".custom-select-trigger");
      
      if (viewTrigger) {
        viewTrigger.textContent = "Today";
      }
   
   })();
   
  // View dropdown — option selection only
   el.reportViewSelect
     .querySelector(".custom-options")
     .addEventListener("click", (e) => {
       const opt = e.target.closest(".custom-option");
       if (!opt || opt.classList.contains("disabled")) return;
   
         reportState.view = opt.dataset.value;
         
         // ✅ If month option selected
         if (opt.dataset.month) {
           reportState.currentMonth = opt.dataset.month;
         }
         
         // 🔑 UPDATE DROPDOWN LABEL VISUALLY (MISSING)
         const viewTrigger =
           el.reportViewSelect.querySelector(".custom-select-trigger");
         if (viewTrigger) {
           if (opt.dataset.month) {
             const { month, year } = formatMonthLabel(opt.dataset.month);
             viewTrigger.textContent = `${month} ${year}`;
           } else {
             viewTrigger.textContent = opt.textContent;
           }
         }
         
         // clear all tabs first
         const tabs = document.querySelectorAll("#reportTabBar .tab");
         tabs.forEach(t => t.classList.remove("active"));
         
         if (reportState.view === "month") {
           // default to Total Open
           const firstTab = document.querySelector(
             '#reportTabBar .tab[data-metric="totalOpen"]'
           );
         
           if (firstTab) {
             firstTab.classList.add("active");
             reportState.activeMetric = "totalOpen";
           }
         } else {
           // Today view → no active metric
           reportState.activeMetric = null;
         }
         
         updateView();

     });

  /* ================================
     CUSTOM DROPDOWN BEHAVIOR
     (Copied from index.js logic)
     ================================ */

  document.querySelectorAll(".custom-select").forEach(select => {
    const trigger = select.querySelector(".custom-select-trigger");

    if (!trigger) return;

    trigger.addEventListener("click", (e) => {
      e.stopPropagation();

      // Close other open dropdowns
      document
        .querySelectorAll(".custom-select.open")
        .forEach(s => {
          if (s !== select) s.classList.remove("open");
        });

      // Toggle this one
      select.classList.toggle("open");
    });
  });

  // Close all dropdowns on outside click
  document.addEventListener("click", () => {
    document
      .querySelectorAll(".custom-select.open")
      .forEach(s => s.classList.remove("open"));
  });
   
}

function setupReportTabs() {
  const tabs = document.querySelectorAll("#reportTabBar .tab");

  tabs.forEach(tab => {
    tab.addEventListener("click", () => {
      // deactivate all
      tabs.forEach(t => t.classList.remove("active"));

      // activate clicked
      tab.classList.add("active");

      // update state
      reportState.activeMetric = tab.dataset.metric;
      
      // ✅ Only reset month if coming from non-month view
      if (reportState.view !== "month") {
        reportState.currentMonth =
          reportState.todayISO.slice(0, 7);
      }
      
      reportState.view = "month";

      // 🔑 sync view dropdown label to Month
      const viewTrigger = el.reportViewSelect.querySelector(".custom-select-trigger");
       
      if (viewTrigger) {
        const { month, year } = formatMonthLabel(reportState.currentMonth);
        viewTrigger.textContent = `${month} ${year}`;
      }

      // re-render content
      updateView();
      
      // ⬇️ Auto-scroll to chart (after DOM updates)
      setTimeout(() => {
        el.monthlyChartWrap?.scrollIntoView({
          behavior: "smooth",
          block: "start"
        });
      }, 100);
    });
  });
}

/* =========================================================
   TOP LEVEL PAGE TAB SWITCHING
   ========================================================= */

function setupPageTabs() {

  el.tabReports.onclick = () => {

    el.tabReports.classList.add("active");
    el.tabAgentStats.classList.remove("active");

    el.sectionReports.style.display = "block";
    el.sectionAgentStats.style.display = "none";
  };

  el.tabAgentStats.onclick = async () => {
   
     el.tabAgentStats.classList.add("active");
     el.tabReports.classList.remove("active");
   
     el.sectionAgentStats.style.display = "block";
     el.sectionReports.style.display = "none";
   
     statsTableWrap.innerHTML = "Loading...";
   
     await loadAllUsersForStats();
     await loadStatsCasesOnce();
   
     buildStatsControls();
     renderStatsTableNew();
   };

}

/* =========================================================
   MONTHLY DATA LOADER
   ========================================================= */

async function loadMonthlyReports(monthKey) {
  reportState.dailyReports = {};

  // ✅ TOTAL MODE
  if (reportState.teamId === "TOTAL") {

    const teamsSnap = await getDocs(collection(db, "teams"));

    for (const teamDoc of teamsSnap.docs) {

      const reportsRef = collection(
        db,
        "cases",
        teamDoc.id,
        "reports"
      );

      const q = query(
        reportsRef,
        where("__name__", ">=", `${monthKey}-01`),
        where("__name__", "<=", `${monthKey}-31`)
      );

      const snap = await getDocs(q);

      snap.forEach(docSnap => {
        const dateKey = docSnap.id;
        const d = docSnap.data();

        // Initialize if not exists
        if (!reportState.dailyReports[dateKey]) {
          reportState.dailyReports[dateKey] = {
            totalOpenOnsite: 0,
            totalOpenOffsite: 0,
            totalOpenCSR: 0,
            totalOpen: 0,

            readyForClosureOnsite: 0,
            readyForClosureOffsite: 0,
            readyForClosureCSR: 0,
            readyForClosureTotal: 0,

            overdueOnsite: 0,
            overdueOffsite: 0,
            overdueCSR: 0,
            overdueTotal: 0
          };
        }

        const target = reportState.dailyReports[dateKey];

        target.totalOpenOnsite += d.totalOpenOnsite || 0;
        target.totalOpenOffsite += d.totalOpenOffsite || 0;
        target.totalOpenCSR += d.totalOpenCSR || 0;
        target.totalOpen += d.totalOpen || 0;

        target.readyForClosureOnsite += d.readyForClosureOnsite || 0;
        target.readyForClosureOffsite += d.readyForClosureOffsite || 0;
        target.readyForClosureCSR += d.readyForClosureCSR || 0;
        target.readyForClosureTotal += d.readyForClosureTotal || 0;

        target.overdueOnsite += d.overdueOnsite || 0;
        target.overdueOffsite += d.overdueOffsite || 0;
        target.overdueCSR += d.overdueCSR || 0;
        target.overdueTotal += d.overdueTotal || 0;
      });
    }

  } else {

    // ✅ SINGLE TEAM MODE (existing logic)
    const reportsRef = collection(
      db,
      "cases",
      reportState.teamId,
      "reports"
    );

    const q = query(
      reportsRef,
      where("__name__", ">=", `${monthKey}-01`),
      where("__name__", "<=", `${monthKey}-31`)
    );

    const snap = await getDocs(q);

    snap.forEach(docSnap => {
      reportState.dailyReports[docSnap.id] = docSnap.data();
    });
  }
}

async function loadAvailableMonths() {
  const monthsSet = new Set();

  // ✅ TOTAL MODE → scan all teams
  if (reportState.teamId === "TOTAL") {

    const teamsSnap = await getDocs(collection(db, "teams"));

    for (const teamDoc of teamsSnap.docs) {

      const reportsRef = collection(
        db,
        "cases",
        teamDoc.id,
        "reports"
      );

      const snap = await getDocs(reportsRef);

      snap.forEach(docSnap => {
        const date = docSnap.id; // YYYY-MM-DD
        const month = date.slice(0, 7); // YYYY-MM
        monthsSet.add(month);
      });
    }

  } else {

    // ✅ SINGLE TEAM MODE
    const reportsRef = collection(
      db,
      "cases",
      reportState.teamId,
      "reports"
    );

    const snap = await getDocs(reportsRef);

    snap.forEach(docSnap => {
      const date = docSnap.id;
      const month = date.slice(0, 7);
      monthsSet.add(month);
    });
  }

  // Convert to array + sort (NEWEST FIRST)
  return Array.from(monthsSet).sort().reverse();
}

function formatMonthLabel(monthKey) {
  const [year] = monthKey.split("-");
  const date = new Date(`${monthKey}-01`);

  return {
    month: date.toLocaleString("en-US", { month: "long" }),
    year
  };
}

function getDaysInMonth(monthKey) {
  const [y, m] = monthKey.split("-").map(Number);
  return new Date(y, m, 0).getDate();
}

function getBusinessDaysOfMonth(monthKey, timezone) {
  const [y, m] = monthKey.split("-").map(Number);
  const daysInMonth = new Date(y, m, 0).getDate();

  const formatter = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    weekday: "short"
  });

  const result = [];

  for (let d = 1; d <= daysInMonth; d++) {
    const iso = `${monthKey}-${String(d).padStart(2, "0")}`;
    const dateObj = new Date(`${iso}T00:00:00Z`);
    const weekday = formatter.format(dateObj);

    if (weekday === "Sat" || weekday === "Sun") continue;

    result.push({
      day: d,
      iso,
      weekday,
      isWeekStart: weekday === "Mon"
    });
  }

  return result;
}

function getWeekNumber(dateISO) {
  const d = new Date(dateISO + "T00:00:00Z");
  const jan4 = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  const weekStart =
    jan4.getTime() -
    (jan4.getUTCDay() || 7) * 86400000;

  return Math.ceil(
    ((d.getTime() - weekStart) / 86400000 + 1) / 7
  );
}

function zeroDay() {
  return {
    totalOpenOnsite: 0,
    totalOpenOffsite: 0,
    totalOpenCSR: 0,
    totalOpen: 0,

    readyForClosureOnsite: 0,
    readyForClosureOffsite: 0,
    readyForClosureCSR: 0,
    readyForClosureTotal: 0,

    overdueOnsite: 0,
    overdueOffsite: 0,
    overdueCSR: 0,
    overdueTotal: 0
  };
}

/* =========================================================
   RENDER — MONTHLY TABLE
   ========================================================= */

function renderMonthlyTable() {
  const table = document.getElementById("monthlyReportTable");
  const thead = table.querySelector("thead");
  const tbody = table.querySelector("tbody");

  const metric = reportState.activeMetric;
  const monthKey = reportState.currentMonth;
   const timezone =
     reportState.teamId === "TOTAL"
       ? "UTC"
       : reportState.teamConfig?.resetTimezone || "UTC";
   
   const businessDays =
     getBusinessDaysOfMonth(monthKey, timezone);

   // ---------- HEADER ----------
   // ---- GROUP DAYS BY WEEK ----
   const weeks = [];
   let currentWeek = null;
   
   businessDays.forEach(d => {
     const weekNo = getWeekNumber(d.iso);
   
     if (!currentWeek || currentWeek.week !== weekNo) {
       currentWeek = { week: weekNo, days: [] };
       weeks.push(currentWeek);
     }
   
     currentWeek.days.push(d);
   });
   
   // ---- HEADER HTML ----
   thead.innerHTML = `
     <!-- WEEK NUMBER ROW -->
     <tr>
       <th rowspan="3" class="type-col">Type</th>
         ${weeks.map(w =>
           `<th colspan="${w.days.length}" class="week-group">
              Week ${w.week}
            </th>`
         ).join("")}
     </tr>
   
     <!-- WEEKDAY ROW -->
     <tr>
       ${weeks.flatMap(w =>
         w.days.map(d =>
           `<th class="${d.isWeekStart ? "week-start" : ""}">
             ${d.weekday}
           </th>`
         )
       ).join("")}
     </tr>
   
     <!-- DATE ROW -->
     <tr>
       ${weeks.flatMap(w =>
         w.days.map(d =>
           `<th class="${d.isWeekStart ? "week-start" : ""}">
             ${String(d.day).padStart(2, "0")}
           </th>`
         )
       ).join("")}
     </tr>
   `;

  // ---------- DATA MAPPING ----------
  const rows = [
    { label: "Onsite", key: "Onsite" },
    { label: "Offsite", key: "Offsite" },
    { label: "CSR", key: "CSR" },
    { label: "Total", key: "Total" }
  ];

  tbody.innerHTML = rows.map(r => {
    return `
      <tr>
        <td><strong>${r.label}</strong></td>
        ${businessDays.map(d => {
           const dateKey = d.iso;
           const data =
             reportState.dailyReports[dateKey] || zeroDay();
         
           let field;
           if (r.key === "Total") {
             field =
               metric === "totalOpen"
                 ? "totalOpen"
                 : `${metric}Total`;
           } else {
             field = `${metric}${r.key}`;
           }
         
           return `
             <td class="${d.isWeekStart ? "week-start" : ""}">
               ${data[field] || 0}
             </td>
           `;
         }).join("")}
      </tr>
    `;
  }).join("");

  renderMonthlyChart(rows, businessDays);
}

function getNiceStep(maxValue, steps) {
  const roughStep = maxValue / steps;
  const magnitude = Math.pow(10, Math.floor(Math.log10(roughStep)));
  const residual = roughStep / magnitude;

  let niceResidual;
  if (residual >= 5) niceResidual = 5;
  else if (residual >= 2) niceResidual = 2;
  else niceResidual = 1;

  return niceResidual * magnitude;
}

/* =========================================================
   LINE CHART (CANVAS)
   ========================================================= */

function renderMonthlyChart(rows, businessDays) {
  const canvas = document.getElementById("monthlyLineChart");
  const ctx = canvas.getContext("2d");

   const dpr = window.devicePixelRatio || 1;
   
   const cssWidth = canvas.parentElement.offsetWidth;
   const cssHeight = 320;
   
   canvas.width = cssWidth * dpr;
   canvas.height = cssHeight * dpr;
   
   canvas.style.width = cssWidth + "px";
   canvas.style.height = cssHeight + "px";
   
   ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
   ctx.clearRect(0, 0, canvas.width, canvas.height);

  const metric = reportState.activeMetric;
  const monthKey = reportState.currentMonth;

  const colors = {
    Onsite: "#4F8CF0",
    Offsite: "#38d9a9",
    CSR: "#ffd166",
    Total: "#ff6b6b"
  };

  /* ---------------------------
     DATA PREP
     --------------------------- */

  let maxVal = 0;

  const series = rows.map(r => {
     const values = businessDays.map(d => {
       const dayData =
         reportState.dailyReports[d.iso] || null;
   
       let field;
       if (r.key === "Total") {
         field =
           metric === "totalOpen"
             ? "totalOpen"
             : `${metric}Total`;
       } else {
         field = `${metric}${r.key}`;
       }
   
       const v =
         dayData && typeof dayData[field] === "number"
           ? dayData[field]
           : null;
   
       if (v !== null) {
         maxVal = Math.max(maxVal, v);
       }
   
       return v;
     });
   
     return { label: r.key, values };
   });

   // ---- GROUP DAYS BY WEEK FOR X LABELS ----
   const chartWeeks = [];
   let currentWeek = null;
   
   businessDays.forEach((d, i) => {
     const weekNo = getWeekNumber(d.iso);
   
     if (!currentWeek || currentWeek.week !== weekNo) {
       currentWeek = {
         week: weekNo,
         startIndex: i,
         endIndex: i
       };
       chartWeeks.push(currentWeek);
     } else {
       currentWeek.endIndex = i;
     }
   });
   
   /* ---------------------------
   CHART LEGEND
   --------------------------- */

   const legend = document.getElementById("monthlyChartLegend");
   if (legend) {
     legend.innerHTML = series
       .map(s => `
         <div class="chart-legend-item">
           <span
             class="chart-legend-color"
             style="background:${colors[s.label]}"
           ></span>
           ${s.label}
         </div>
       `)
       .join("");
   }

  if (maxVal === 0) maxVal = 1;

   // Add headroom above highest value (Y-axis breathing space)
   const yHeadroomRatio = 0.1; // 10% extra space
   const rawMaxVal = maxVal * (1 + yHeadroomRatio);
   
   // Calculate nice Y-axis step
   const niceStep = getNiceStep(rawMaxVal, 5);
   
   // Round top value to clean multiple
   const scaledMaxVal =
     Math.ceil(rawMaxVal / niceStep) * niceStep;
   
   // Number of grid steps derived from rounded range
   const steps = Math.round(scaledMaxVal / niceStep);

  /* ---------------------------
     LAYOUT
     --------------------------- */

   const padding = 60;
   const w = cssWidth - padding * 2;
   const h = cssHeight - padding * 2;

   // Effective drawable width (full width initially)
   let plotW = w;
   
   // Distance between adjacent dates
   const step =
     businessDays.length > 1
       ? plotW / (businessDays.length - 1)
       : plotW;
   
   // Dynamic inset = half step
   const xInset = step / 2;
   
   // Final drawable width after inset
   plotW = w - xInset * 2;

   // ---- COMPUTE WEEK DIVIDER X POSITIONS ----
   const weekDividerXs = [];
   
   // Leftmost divider (full edge)
   weekDividerXs.push(padding);
   
   // Mid dividers
   for (let i = 1; i < chartWeeks.length; i++) {
     const prev = chartWeeks[i - 1];
     const curr = chartWeeks[i];
   
     const midIndex =
       (prev.endIndex + curr.startIndex) / 2;
   
     const x =
       padding +
       xInset +
       (midIndex / (businessDays.length - 1)) *
         plotW;
   
     weekDividerXs.push(x);
   }
   
   // Rightmost divider (full edge)
   weekDividerXs.push(cssWidth - padding);

  /* ---------------------------
     AXES
     --------------------------- */

  ctx.strokeStyle = "#2a2f3a";
  ctx.lineWidth = 1;

   ctx.beginPath();
   ctx.moveTo(padding, padding);
   ctx.lineTo(padding, cssHeight - padding);
   ctx.lineTo(padding + xInset + plotW, cssHeight - padding);
   ctx.stroke();

  /* ---------------------------
     Y GRID + LABELS
     --------------------------- */

  ctx.font = "12px system-ui";
  ctx.fillStyle = "#9aa4b2";

   for (let i = 0; i <= steps; i++) {
   
     // ❌ Skip every alternate grid line (remove 2nd, 4th, etc.)
     if (i % 2 !== 0) continue;
   
     const y = padding + (h / steps) * i;
     const val = scaledMaxVal - niceStep * i;
   
     ctx.strokeStyle = "#2a2f3a";
     ctx.beginPath();
     ctx.moveTo(padding, y);
     ctx.lineTo(cssWidth - padding, y);
     ctx.stroke();
   
     ctx.fillText(
       val,
       padding - 40,
       y + 4
     );
   }

  /* ---------------------------
     X LABELS (DAYS)
     --------------------------- */

   // ---- DAY LABELS ----
   ctx.font = "12px system-ui";
   ctx.fillStyle = "#9aa4b2";
   
   businessDays.forEach((d, i) => {
   const x =
     padding +
     xInset +
     (i / (businessDays.length - 1)) * plotW;
   
     ctx.fillText(
       String(d.day),
       x - 6,
       cssHeight - padding + 20
     );
   });
   
   // ---- WEEK LABELS (CENTERED BETWEEN DIVIDERS) ----
   ctx.font = "12px system-ui";
   ctx.fillStyle = "#9aa4b2";
   
   chartWeeks.forEach((wk, i) => {
     const leftX = weekDividerXs[i];
     const rightX = weekDividerXs[i + 1];
   
     const x = (leftX + rightX) / 2;
   
     ctx.fillText(
       `Week ${wk.week}`,
       x - 18,
       cssHeight - padding + 38
     );
   });
   
   // ---- WEEK LABEL DIVIDERS (X-AXIS ONLY, FULL SET) ----
   ctx.strokeStyle = "#2a2f3a";
   ctx.lineWidth = 1;
   
   // Divider BEFORE first week — FULL EDGE
   {
     const x = padding; // full left edge
   
     ctx.beginPath();
     ctx.moveTo(x, cssHeight - padding);
     ctx.lineTo(x, cssHeight - padding + 48);
     ctx.stroke();
   }
   
   // Dividers BETWEEN weeks
   for (let i = 1; i < chartWeeks.length; i++) {
     const prev = chartWeeks[i - 1];
     const curr = chartWeeks[i];
   
     const midIndex =
       (prev.endIndex + curr.startIndex) / 2;
   
     const x =
       padding +
       xInset +
       (midIndex / (businessDays.length - 1)) *
         plotW;
   
     ctx.beginPath();
     ctx.moveTo(x, cssHeight - padding);
     ctx.lineTo(x, cssHeight - padding + 48);
     ctx.stroke();
   }
   
   // Divider AFTER last week — FULL EDGE
   {
     const x = cssWidth - padding; // full right edge
   
     ctx.beginPath();
     ctx.moveTo(x, cssHeight - padding);
     ctx.lineTo(x, cssHeight - padding + 48);
     ctx.stroke();
   }

  /* ---------------------------
     LINES + POINTS
     --------------------------- */

  series.forEach(s => {
    ctx.strokeStyle = colors[s.label];
    ctx.lineWidth = 2;
    ctx.beginPath();

      s.values.forEach((v, i) => {
      const x =
        padding +
        xInset +
        (i / (businessDays.length - 1)) * plotW;
      
        if (v === null) {
          // break the line — do NOT draw
          return;
        }
      
        const y =
          cssHeight -
          padding -
          (v / scaledMaxVal) * h;
      
        if (i === 0 || s.values[i - 1] === null) {
          ctx.moveTo(x, y);
        } else {
          ctx.lineTo(x, y);
        }
      });

    ctx.stroke();

    // points
    s.values.forEach((v, i) => {
      const x =
        padding +
        xInset +
        (i / (businessDays.length - 1)) * plotW;
         if (v === null) return;
         
         const y =
           cssHeight -
           padding -
           (v / scaledMaxVal) * h;
         
         ctx.fillStyle = colors[s.label];
      
      ctx.beginPath();
      ctx.arc(x, y, 3.5, 0, Math.PI * 2);
      ctx.fill();
    });
  });
}

async function updateView() {
  if (reportState.view === "today" &&
      !reportState.activeMetric) {
    el.todaySummaryBlock.classList.remove("hidden");
    el.monthlyBlock.classList.add("hidden");
    return;
  }

  el.todaySummaryBlock.classList.add("hidden");
  el.monthlyBlock.classList.remove("hidden");

  await loadMonthlyReports(reportState.currentMonth);
  renderMonthlyTable();

}

function openAuditModal(userId) {
   
     // Lookup user name for title
  const user = allUsers.find(u => u.id === userId);
  const userName = user ? `${user.firstName} ${user.lastName}` : userId;

  // Update modal title dynamically
  document.querySelector("#modalAudit .modal-title").textContent =
    `Audit — ${userName}`;
   
  const today = getTeamToday(teamConfig);

  // Get cases actioned today by this user (only status updates)
  const userTodayCases = statsCases.filter(r =>
    r.statusChangedOn === today && r.statusChangedBy === userId
  );

  // Pick 5 random cases
  const five = userTodayCases
    .sort(() => Math.random() - 0.5)
    .slice(0, 5);

  auditList.innerHTML = five.length
  ? five.map(c => `
      <div style="margin-bottom:8px;">
        ${c.id} — ${c.status || "No Selected Status"}
      </div>
    `).join("")
  : "<div>No cases available for audit today.</div>";


  modalAudit.classList.add("show");
}

// Buttons to close modal
btnAuditClose.onclick = () => modalAudit.classList.remove("show");
btnAuditOk.onclick = () => modalAudit.classList.remove("show");

// SP/MON No Follow modal close handlers
btnNoFollowClose.onclick = () => modalNoFollow.classList.remove("show");
btnNoFollowOk.onclick = () => modalNoFollow.classList.remove("show");


function openNoFollowModal(userId) {

  // Title
  const user = allUsers.find(u => u.id === userId);
  const userName = user ? `${user.firstName} ${user.lastName}` : userId;
  document.getElementById("noFollowTitle").textContent =
    `SP/MON No Follow — ${userName}`;

  // Filter cases for this user
  const cases = statsCases.filter(r =>
    r.lastActionedBy === userId &&
    (r.status === "Service Pending" || r.status === "Monitoring") &&
    (!r.followDate || r.followDate.trim() === "")
  );

  if (!cases.length) {
    noFollowList.innerHTML = "<div>No matching cases.</div>";
  } else {
    noFollowList.innerHTML = cases
      .map(c => `
        <div style="margin-bottom:8px; padding:4px 0;">
          <strong>${c.id}</strong> — ${c.status || "Unknown Status"}
        </div>
      `)
      .join("");
  }

  modalNoFollow.classList.add("show");
}



/* ============================================================
   GLOBAL ADMIN STATE
   ============================================================ */
export const adminState = {
  user: null,
  allTeams: [],
  selectedStatsTeam: "TOTAL",
};

// ================================================
// GLOBAL TEAM CONFIG FOR STATS (Admin)
// ================================================
let teamConfig = {
  resetTimezone: "UTC",
  resetHour: 0
};


let statsCases = [];
let allUsers = [];




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

  // --------------------------------------------------
// Initialize teamConfig for first Stats render
// --------------------------------------------------
const initialTeam =
  adminState.selectedStatsTeam === "TOTAL"
    ? null
    : adminState.allTeams.find(
        t => t.id === adminState.selectedStatsTeam
      );

teamConfig = {
  resetTimezone: initialTeam?.resetTimezone || "UTC",
  resetHour:
    typeof initialTeam?.resetHour === "number"
      ? initialTeam.resetHour
      : 0
};

     
  renderStatsTableNew();
};

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
  const today = getTeamToday(teamConfig);

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

     // Compute X / Y / Z counts
const X_lastActionedToday = filteredCases.filter(r =>
  r.lastActionedBy === u.id && r.lastActionedOn === today
).length;

const Y_statusChangedToday = totalActioned;  // already computed

const Z_difference = X_lastActionedToday - Y_statusChangedToday;

    rows.push({
  userId: u.id,
  name: `${u.firstName} ${u.lastName}`,

  // Replace totalActioned with Y only (status changes)
  totalActionedY: totalActioned,

  // New fields
  lastActionedX: X_lastActionedToday,
  diffZ: Z_difference,

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

  /* =============================================================
     TEAM TOTAL ROW
     (sum of all user rows currently displayed)
     ============================================================= */
  const total = {
  name: "TEAM TOTAL",

  lastActionedX: rows.reduce((s, r) => s + r.lastActionedX, 0),
  totalActionedY: rows.reduce((s, r) => s + r.totalActionedY, 0),
  diffZ: rows.reduce((s, r) => s + r.lastActionedX, 0) -
        rows.reduce((s, r) => s + r.totalActionedY, 0),

  closedToday: rows.reduce((s, r) => s + r.closedToday, 0),
  met: rows.reduce((s, r) => s + r.met, 0),
  notMet: rows.reduce((s, r) => s + r.notMet, 0),
  spMonNoFollow: rows.reduce((s, r) => s + r.spMonNoFollow, 0),
  followX: rows.reduce((s, r) => s + r.followX, 0),
  followY: rows.reduce((s, r) => s + r.followY, 0)
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
  const today = getTeamToday(teamConfig);

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
         // ❌ Hide secondary admins from stats table
    if (u.role === "secondary") continue;

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
   
   
   // Closed Today — based on STATUS CHANGED today (no duplicates)
   const closedTodayMap = new Map();
   
   filteredCases.forEach(r => {
     if (
       r.statusChangedBy === u.id &&
       r.statusChangedOn === today &&
       r.status === "Closed"
     ) {
       if (!closedTodayMap.has(r.id)) {
         closedTodayMap.set(r.id, r);
       }
     }
   });
   
   const closedTodayList = Array.from(closedTodayMap.values());
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

    // NEW — X = lastActionedToday
const X_lastActionedToday = filteredCases.filter(r =>
  r.lastActionedBy === u.id && r.lastActionedOn === today
).length;

// Y = statusChangedToday (already computed)
const Y_statusChangedToday = totalActioned;

// Z = difference
const Z_difference = X_lastActionedToday - Y_statusChangedToday;

rows.push({
  userId: u.id,
  name: `${u.firstName} ${u.lastName}`,

  // NEW FIELDS
  lastActionedX: X_lastActionedToday,
  totalActionedY: Y_statusChangedToday,
  diffZ: Z_difference,

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

  lastActionedX: rows.reduce((s, r) => s + (r.lastActionedX || 0), 0),
  totalActionedY: rows.reduce((s, r) => s + (r.totalActionedY || 0), 0),
  diffZ:
    rows.reduce((s, r) => s + (r.lastActionedX || 0), 0) -
    rows.reduce((s, r) => s + (r.totalActionedY || 0), 0),

  closedToday: rows.reduce((s, r) => s + r.closedToday, 0),
  met: rows.reduce((s, r) => s + r.met, 0),
  notMet: rows.reduce((s, r) => s + r.notMet, 0),
  spMonNoFollow: rows.reduce((s, r) => s + r.spMonNoFollow, 0),
  followX: rows.reduce((s, r) => s + r.followX, 0),
  followY: rows.reduce((s, r) => s + r.followY, 0)
};


  total.metPct = total.closedToday ? Math.round((total.met / total.closedToday) * 100) : 0;
  total.notMetPct = total.closedToday ? Math.round((total.notMet / total.closedToday) * 100) : 0;

   // Sort stats rows by user account creation date (oldest → newest)
rows.sort((a, b) => {
  const ua = allUsers.find(u => u.id === a.userId);
  const ub = allUsers.find(u => u.id === b.userId);

  const da = ua?.createdAt?.toDate ? ua.createdAt.toDate() : new Date(0);
  const db = ub?.createdAt?.toDate ? ub.createdAt.toDate() : new Date(0);

  return da - db; // oldest → newest
});

   
  return { totalRow: total, userRows: rows };
}

/* RENDERING — HTML markup exactly matching your screenshot columns */
function renderStatsTableNew() {
  // compute
  const stats = computeStatsEngineAdaptive(statsCases, allUsers);

  // build table header
  const header = `
  <table class="admin-stats-table">
    <thead>
      <tr style="text-align:left;border-bottom:1px solid var(--border);">
        <th>Agent</th>
        <th>Total Followed Up Today</th>
        <th>Closed Today</th>
        <th>Met</th>
        <th>Not Met</th>

        <th style="position:relative;">
          SP/MON No Follow Up
          <span class="tooltip">
            Service Pending and Monitoring Cases<br>
            without Follow-Up date marked.
          </span>
        </th>

        <th style="position:relative;">
          Scheduled Follow-ups
          <span class="tooltip">
            Cases Due to be followed up today.<br>
            X - Total Due Today Cases.<br>
            Y - Missed Follow Up Cases.
          </span>
        </th>

        <th>Audit</th>
      </tr>
    </thead>
`;



  // total row first
  const t = stats.totalRow;
  const totalRowHtml = `
    <tr style="font-weight:700;background:rgba(255,255,255,0.03);">
      <td>${t.name}</td>
      <td>${t.totalActionedY}</td>
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
      <td class="stats-user-link" data-userid="${u.userId}">
          ${escapeHtml(u.name)}
      </td>
      <td>${u.totalActionedY}</td>
      <td>${u.closedToday}</td>
      <td>${u.met} (${u.metPct}%)</td>
      <td>${u.notMet} (${u.notMetPct}%)</td>
      <td>
  ${
    u.spMonNoFollow > 0
      ? `<span class="no-follow-link" data-userid="${u.userId}" style="color:#4F8CF0;cursor:pointer;font-weight:700;">
           ${u.spMonNoFollow}
         </span>`
      : u.spMonNoFollow
  }
</td>
      <td>${u.followX} / ${u.followY}</td>
      <td><button class="action-btn btn-boxed" style="padding: 0.35rem 0.6rem; border-radius: 8px;" data-audit="${u.userId}">Audit</button></td>
    </tr>
  `).join("");

  const footer = `</tbody></table>`;

  statsTableWrap.innerHTML = header + totalRowHtml + userRowsHtml + footer;

  // bind audit buttons
  statsTableWrap.querySelectorAll("[data-audit]").forEach(btn => {
    btn.onclick = () => openAuditModal(btn.dataset.audit);
  });

   // Bind No-Follow clickable numbers
statsTableWrap.querySelectorAll(".no-follow-link").forEach(el => {
  el.onclick = () => openNoFollowModal(el.dataset.userid);
});
   
}

// ---------------- USER STATS MODAL ---------------- //


// Calculate user summary (same logic as user Info modal)
function computeUserSummary(userId) {
  const today = getTeamToday(teamConfig);

  // -------------------------------
  // 1. ALL STATUS CHANGES DONE TODAY BY USER (NO DUPLICATES)
  // -------------------------------
  const todayStatusChanges = statsCases.filter(r =>
    r.statusChangedBy === userId &&
    r.statusChangedOn === today
  );

  // Unique cases only
  const uniqueCasesMap = new Map();
  todayStatusChanges.forEach(r => {
    if (!uniqueCasesMap.has(r.id)) {
      uniqueCasesMap.set(r.id, r);
    }
  });

  const uniqueCases = Array.from(uniqueCasesMap.values());

  // -------------------------------
  // 2. CLOSED CASES (TODAY)
  // -------------------------------
  const closedCases = uniqueCases.filter(r => r.status === "Closed");
  const closedCount = closedCases.length;

  const met = closedCases.filter(
    r => (r.sbd || "").toLowerCase() === "met"
  ).length;

  const notMet = closedCases.filter(
    r => (r.sbd || "").toLowerCase() === "not met"
  ).length;

  const pct = (n) =>
    closedCount === 0 ? 0 : Math.round((n / closedCount) * 100);

  // -------------------------------
  // 3. STATUS BREAKDOWN (TODAY)
  // -------------------------------
  const statusBreakdown = {
    "Service Pending": 0,
    "Monitoring": 0,
    "NCM 1": 0,
    "NCM 2": 0,
    "PNS": 0
  };

  uniqueCases.forEach(r => {
    if (statusBreakdown[r.status] != null) {
      statusBreakdown[r.status]++;
    }
  });

  // -------------------------------
  // 4. TOTAL FOLLOWED UP / ACTIONED / UPDATED
  // -------------------------------
  const totalFollowedUp = uniqueCases.length;

  const totalActioned = new Set(
    statsCases.filter(r =>
      r.lastActionedBy === userId &&
      r.lastActionedOn === today
    ).map(r => r.id)
  ).size;

  const totalUpdated = totalActioned - totalFollowedUp;

  // -------------------------------
  // 5. FINAL TEXT OUTPUT
  // -------------------------------
  return `Total Cases Closed: ${closedCount}
Met: ${met} (${pct(met)}%)
Not Met: ${notMet} (${pct(notMet)}%)

Service Pending: ${statusBreakdown["Service Pending"]}
Monitoring: ${statusBreakdown["Monitoring"]}
NCM 1: ${statusBreakdown["NCM 1"]}
NCM 2: ${statusBreakdown["NCM 2"]}
PNS: ${statusBreakdown["PNS"]}

Total Followed Up Cases: ${totalFollowedUp}
Total Updated Cases: ${totalUpdated}

Total Actioned Cases: ${totalActioned}
`;
}


// Bind click on usernames
statsTableWrap.addEventListener("click", (e) => {
  const link = e.target.closest(".stats-user-link");
  if (!link) return;

  const uid = link.dataset.userid;
  const user = allUsers.find(u => u.id === uid);
  
  if (!user) return;

  userStatsTitle.textContent = `${user.firstName} ${user.lastName} — Today Summary`;
  userStatsBody.textContent = computeUserSummary(uid);

  modalUserStats.classList.add("show");
});


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
  try {
    let allCases = [];

    // SECONDARY → only their team
    if (!isPrimary(adminState.user)) {
      const colRef = collection(
        db,
        "cases",
        adminState.user.teamId,
        "casesList"
      );

      const snap = await getDocs(colRef);
      allCases = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    }

    // PRIMARY
    else {
      const selectedTeam = adminState.selectedStatsTeam;

      // TOTAL mode → loop all teams
      if (selectedTeam === "TOTAL") {
        for (const t of adminState.allTeams) {
          const colRef = collection(db, "cases", t.id, "casesList");
          const snap = await getDocs(colRef);
          snap.forEach(d => {
            allCases.push({ id: d.id, ...d.data() });
          });
        }
      }

      // Specific team
      else {
        const colRef = collection(db, "cases", selectedTeam, "casesList");
        const snap = await getDocs(colRef);
        allCases = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      }
    }

    statsCases = allCases;

  } catch (err) {
    console.error("Failed to load stats cases:", err);
    showPopup("Unable to load cases for stats.");
    statsCases = [];
  }
}


/* ------------------------------------------------------------
   Manual REFRESH button for stats tab
------------------------------------------------------------ */
function buildStatsControls() {
  statsControls.innerHTML = `
    <!-- Cases Report button -->
    <button
      class="btn-cases-report"
      id="btnCasesReport"
      title="Open Cases Report"
    >
      Cases Report
    </button>

    <!-- Refresh button -->
    <button
      class="action-btn btn-boxed"
      style="padding:0.55rem 0.65rem;font-size:18px;"
      id="btnStatsRefresh"
      title="Refresh"
    >
      🔄
    </button>
  `;

  // Refresh stats
  document.getElementById("btnStatsRefresh").onclick = async () => {
    showPopup("Refreshing stats...");
    await loadStatsCasesOnce();
    await loadAllUsersForStats();
    renderStatsTableNew();
  };

  // Navigate to report page
  document.getElementById("btnCasesReport").onclick = () => {
    location.href = "report.html";
  };
}

/* ------------------------------------------------------------
   Modified team selector for stats
------------------------------------------------------------ */
function buildTeamSelector() {
  statsControls.innerHTML = ""; // reset
  buildStatsControls();

  /* =====================================================
     🔒 SECONDARY ADMIN / NON-PRIMARY — LOCKED TO OWN TEAM
     ===================================================== */
  if (!isPrimary(adminState.user)) {
    // force selected team
    adminState.selectedStatsTeam = adminState.user.teamId;

    const myTeam =
      adminState.allTeams.find(t => t.id === adminState.user.teamId);

    const label = myTeam ? myTeam.name : adminState.user.teamId;

    const locked = document.createElement("div");
    locked.className = "custom-select stats-team-select";
    locked.dataset.value = adminState.user.teamId;

    locked.innerHTML = `
      <div class="custom-select-trigger" style="opacity:0.7; cursor:not-allowed;">
        ${label}
      </div>
    `;

    // ❌ no options
    // ❌ no initCustomSelect
    // ❌ no change handler

    statsControls.prepend(locked);
    return; // 🔴 IMPORTANT: stop here exactly like original
  }

  /* =====================================================
     🟢 PRIMARY ADMIN — FULL TEAM SELECTOR
     ===================================================== */

  let optionsHtml = `
    <div class="custom-option" data-value="TOTAL">TOTAL</div>
  `;

  adminState.allTeams
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name))
    .forEach(t => {
      optionsHtml += `
        <div class="custom-option" data-value="${t.id}">
          ${t.name}
        </div>
      `;
    });

  const currentLabel =
    adminState.selectedStatsTeam === "TOTAL"
      ? "TOTAL"
      : adminState.allTeams.find(t => t.id === adminState.selectedStatsTeam)?.name
        || "TOTAL";

  const wrapper = document.createElement("div");
  wrapper.className = "custom-select stats-team-select";
  wrapper.dataset.value = adminState.selectedStatsTeam || "TOTAL";

  wrapper.innerHTML = `
    <div class="custom-select-trigger">${currentLabel}</div>
    <div class="custom-options">
      ${optionsHtml}
    </div>
  `;

   const refreshBtn = document.getElementById("btnStatsRefresh");
   
   if (refreshBtn) {
     statsControls.insertBefore(wrapper, refreshBtn);
   } else {
     statsControls.appendChild(wrapper);
   }

  initCustomSelect(wrapper);

  wrapper.addEventListener("change", () => {
    const val = wrapper.dataset.value || "TOTAL";
    adminState.selectedStatsTeam = val;

    const team =
      val === "TOTAL"
        ? null
        : adminState.allTeams.find(t => t.id === val);

    teamConfig = {
      resetTimezone: team?.resetTimezone || "UTC",
      resetHour:
        typeof team?.resetHour === "number" ? team.resetHour : 0
    };

    renderStatsTableNew();
  });
}

adminState.selectedStatsTeam = "TOTAL";

/* ------------------------------------------------------------
   Disable the old real-time stats subscription
------------------------------------------------------------ */
function subscribeStatsCases() {
  // DISABLED — realtime disabled for Option B
  // (We only load on demand using loadStatsCasesOnce)
  return;
}





















