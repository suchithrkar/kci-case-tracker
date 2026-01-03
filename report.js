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
  todaySummaryTable: document
    .getElementById("todaySummaryTable")
    .querySelector("tbody"),

  monthlyBlock: document.getElementById("monthlyReportBlock"),
  monthlyChartWrap: document.querySelector("#monthlyReportBlock .chart-wrap"),

  reportViewSelect: document.getElementById("reportViewSelect"),
};

const reportTeamControls =
  document.getElementById("reportTeamControls");

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
  reportState.teamId = getCurrentTrackerTeam(data);

  /* Load team config */
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
  let q;

  if (reportState.teamId === "TOTAL") {
    q = query(collection(db, "cases"));
  } else {
    q = query(
      collection(db, "cases"),
      where("teamId", "==", reportState.teamId)
    );
  }

  const snap = await getDocs(q);
  reportState.liveCases = snap.docs.map(d => d.data());
}

async function loadTodaySummary() {
  const ref = doc(
    db,
    "dailyRepairReports",
    reportState.teamId,
    "reports",
    reportState.todayISO
  );

  const snap = await getDoc(ref);
  reportState.todayReport = snap.exists() ? snap.data() : {};
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

  snap.forEach(docSnap => {
    const t = docSnap.data();
    html += `
      <div class="custom-option" data-team="${docSnap.id}">
        ${t.name || docSnap.id}
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
    renderDistributionTable();
  };
}

/* =========================================================
   RENDER — DISTRIBUTION TABLE
   ========================================================= */

const CA_BUCKETS = [
  "0-3 Days",
  "3-5 Days",
  "5-10 Days",
  "10-14 Days",
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

  el.todaySummaryTable.innerHTML = rows
    .map(r => `
      <tr>
        <td><strong>${r.label}</strong></td>
        <td>${r.total}</td>
        <td>${r.rfc}</td>
        <td>${r.overdue}</td>
      </tr>
    `)
    .join("");
}

/* =========================================================
   CONTROLS — VIEW + METRICS
   ========================================================= */

function setupControls() {
  if (setupControls._initialized) return;
  setupControls._initialized = true;
  // View dropdown — option selection only
   el.reportViewSelect
     .querySelector(".custom-options")
     .addEventListener("click", (e) => {
       const opt = e.target.closest(".custom-option");
       if (!opt || opt.classList.contains("disabled")) return;
   
         reportState.view = opt.dataset.value;
         
         // 🔑 UPDATE DROPDOWN LABEL VISUALLY (MISSING)
         const viewTrigger =
           el.reportViewSelect.querySelector(".custom-select-trigger");
         if (viewTrigger) {
           viewTrigger.textContent = opt.textContent;
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
      reportState.view = "month";

      // 🔑 sync view dropdown label to Month
      const viewTrigger =
        el.reportViewSelect.querySelector(".custom-select-trigger");
      if (viewTrigger) viewTrigger.textContent = "Month";

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
   MONTHLY DATA LOADER
   ========================================================= */

async function loadMonthlyReports(monthKey) {
  reportState.dailyReports = {};

  const reportsRef = collection(
    db,
    "dailyRepairReports",
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
   const steps = 5;
   const niceStep = getNiceStep(rawMaxVal, steps);
   const scaledMaxVal =
     Math.ceil(rawMaxVal / niceStep) * niceStep;

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

   // ---- WEEK LABEL DIVIDERS (X-AXIS ONLY, MIDPOINT) ----
   ctx.strokeStyle = "#2a2f3a";
   ctx.lineWidth = 1;
   
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















