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
  reportTeamSelect: document.getElementById("reportTeamSelect"),
  teamSelectLabel: document.getElementById("teamSelectLabel"),
  teamSelectOptions: document.getElementById("teamSelectOptions"),

  distributionTable: document
    .getElementById("distributionTable")
    .querySelector("tbody"),

  todaySummaryBlock: document.getElementById("todaySummaryBlock"),
  todaySummaryTable: document
    .getElementById("todaySummaryTable")
    .querySelector("tbody"),

  monthlyBlock: document.getElementById("monthlyReportBlock"),

  reportViewSelect: document.getElementById("reportViewSelect"),
  reportViewLabel: document.getElementById("reportViewLabel"),

  metricTabs: document.getElementById("reportMetricTabs")
};

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
     el.reportTeamSelect.classList.remove("hidden");
     await loadTeamsForReport();
   } else {
     el.reportTeamSelect.classList.add("hidden");
   }
   
  await loadLiveCases();
  await loadTodaySummary();

  renderDistributionTable();
  renderTodaySummary();
  setupControls();
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
  el.teamSelectOptions.innerHTML = `
    <div class="custom-option" data-team="TOTAL">TOTAL</div>
  `;

  const snap = await getDocs(collection(db, "teams"));

  snap.forEach(docSnap => {
    const t = docSnap.data();
    el.teamSelectOptions.innerHTML += `
      <div class="custom-option" data-team="${docSnap.id}">
        ${t.name || docSnap.id}
      </div>
    `;
  });

  el.teamSelectOptions.onclick = async (e) => {
    const opt = e.target.closest(".custom-option");
    if (!opt) return;

    el.teamSelectLabel.textContent = opt.textContent;

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
      label: "Parts",
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
  // View dropdown
  el.reportViewSelect.onclick = (e) => {
    const opt = e.target.closest(".custom-option");
    if (!opt || opt.classList.contains("disabled")) return;

    reportState.view = opt.dataset.value;
    reportState.activeMetric = null;

    el.reportViewLabel.textContent =
      opt.textContent;

    updateView();
  };

  // Metric toggles
  el.metricTabs.querySelectorAll(".rfcBtn")
    .forEach(btn => {
      btn.onclick = () => {
        const metric = btn.dataset.metric;

        // toggle off
        if (reportState.activeMetric === metric) {
          reportState.activeMetric = null;
          reportState.view = "today";
          el.reportViewLabel.textContent = "Today";
        } else {
          reportState.activeMetric = metric;
          reportState.view = "month";
          el.reportViewLabel.textContent = "Month";
        }

        updateMetricTabs();
        updateView();
      };
    });

  updateMetricTabs();

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



/* =========================================================
   METRIC TAB STATE
   ========================================================= */

function updateMetricTabs() {
  el.metricTabs.querySelectorAll(".rfcBtn")
    .forEach(b => {
      b.classList.toggle(
        "active",
        b.dataset.metric === reportState.activeMetric
      );
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
  const days = getDaysInMonth(monthKey);

  // ---------- HEADER ----------
  thead.innerHTML = `
    <tr>
      <th>Type</th>
      ${Array.from({ length: days }, (_, i) =>
        `<th>${String(i + 1).padStart(2, "0")}</th>`
      ).join("")}
    </tr>
  `;

  // ---------- DATA MAPPING ----------
  const rows = [
    { label: "Onsite", key: "Onsite" },
    { label: "Offsite", key: "Offsite" },
    { label: "Parts", key: "CSR" },
    { label: "Total", key: "Total" }
  ];

  tbody.innerHTML = rows.map(r => {
    return `
      <tr>
        <td><strong>${r.label}</strong></td>
        ${Array.from({ length: days }, (_, i) => {
          const day = String(i + 1).padStart(2, "0");
          const dateKey = `${monthKey}-${day}`;
          const d =
            reportState.dailyReports[dateKey] || zeroDay();

          const field = `${metric}${r.key}`;
          return `<td>${d[field] || 0}</td>`;
        }).join("")}
      </tr>
    `;
  }).join("");

  renderMonthlyChart(rows, days);
}

/* =========================================================
   LINE CHART (CANVAS)
   ========================================================= */

function renderMonthlyChart(rows, days) {
  const canvas = document.getElementById("monthlyLineChart");
  const ctx = canvas.getContext("2d");

  canvas.width = canvas.parentElement.offsetWidth;
  canvas.height = 260;

  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const metric = reportState.activeMetric;
  const monthKey = reportState.currentMonth;

  const colors = {
    Onsite: "#4F8CF0",
    Offsite: "#38d9a9",
    CSR: "#ffd166",
    Total: "#ff6b6b"
  };

  // Collect max value
  let maxVal = 0;

  const series = rows.map(r => {
    const values = Array.from({ length: days }, (_, i) => {
      const day = String(i + 1).padStart(2, "0");
      const d =
        reportState.dailyReports[`${monthKey}-${day}`] ||
        zeroDay();
      const v = d[`${metric}${r.key}`] || 0;
      maxVal = Math.max(maxVal, v);
      return v;
    });
    return { label: r.key, values };
  });

  if (maxVal === 0) maxVal = 1;

  const padding = 40;
  const w = canvas.width - padding * 2;
  const h = canvas.height - padding * 2;

  // Axes
  ctx.strokeStyle = "#2a2f3a";
  ctx.beginPath();
  ctx.moveTo(padding, padding);
  ctx.lineTo(padding, canvas.height - padding);
  ctx.lineTo(canvas.width - padding, canvas.height - padding);
  ctx.stroke();

  // Lines
  series.forEach(s => {
    ctx.strokeStyle = colors[s.label];
    ctx.lineWidth = 2;
    ctx.beginPath();

    s.values.forEach((v, i) => {
      const x = padding + (i / (days - 1)) * w;
      const y =
        canvas.height -
        padding -
        (v / maxVal) * h;

      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    });

    ctx.stroke();
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




