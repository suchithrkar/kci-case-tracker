let kciFile = null;
let csoFile = null;
let trackingFile = null;
let workbookCache = null;
let invalidCSOEntries = [];
let validCSOOutput = "";
let showingInvalidCSOs = false;
let tablesMap = {};
let currentTeam = null;
let isAddingTeamInline = false;
const dataTablesMap = {};
const TEAM_STORE = "teams";
const lastTeam = localStorage.getItem("kci-last-team");
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

const RESOLUTION_TYPES = [
  "Onsite Solution",
  "Parts Shipped",
  "Offsite Solution"
];

const TABLE_SCHEMAS = {
  "Dump": [
    "Case ID",
    "Full Name (Primary Contact) (Contact)",
    "Created On",
    "Created By",
    "Modified On",
    "Business Segment",
    "Country",
    "Incoming Channel",
    "Case Resolution Code",
    "Full Name (Owning User) (User)",
    "Email Status",
    "Case Ready for Closure",
    "Requires Auto-Close",
    "Is Order Created",
    "Queue",
    "OTC Code",
    "Product Serial Number",
    "ProductName",
    "Workgroup (Owning User) (User)"
  ],

  "WO": [
    "Case ID",
    "Work Order Number",
    "Business Segment",
    "Service Account",
    "Case Status (Case ID) (Case)",
    "System Status",
    "Created On",
    "Workgroup (Created By) (User)",
    "Country",
    "Resolution Notes/ Diagnostics"
  ],

  "MO": [
    "Order Number",
    "Case ID",
    "Created On",
    "Order Status",
    "Order Type",
    "Ready For Closure Date"
  ],

  "MO Items": [
    "Material Order",
    "MO Line Items Name",
    "Part Number",
    "Description",
    "Tracking Number",
    "Created On",
    "Tracking Url"
  ],

  "SO": [
    "Case ID",
    "Service Status",
    "Date and Time Submitted",
    "Name",
    "Order Reference ID"
  ],

  "Closed Cases": [
    "Case ID",
    " Full Name (Primary Contact) (Contact)",
    "Created On",
    "Modified By",
    "Modified On",
    "Case Closed Date",
    "Case Resolution Code",
    "Created By",
    "Incoming Channel",
    "Owner",
    "Country",
    "OTC Code",
    "Workgroup (Owning User) (User)"
  ],

  "Sorted": [
    "Case ID",
    "Case Resolution Code",
    "Latest Order",
    "Order Status",
    "Workgroup",
    "Team"
  ],

  "CSO Status": [
    "Case ID",
    "CSO",
    "Status",
    "Tracking Number",
    "Repair Status"
  ],
  
  "Delivery Details": [
    "CaseID",
    "OrderID",
    "Tracking URL",
    "CurrentStatus"
  ],

  "Repair Cases": [
    "Case ID",
    "Customer Name",
    "Created On",
    "Created By",
    "Country",
    "Case Resolution Code",
    "Case Owner",
    "OTC Code",
    "CA Group",
    "TL",
    "SBD",
    "Onsite RFC",
    "CSR RFC",
    "Bench RFC",
    "Market",
    "WO Closure Notes",
    "Tracking Status",
    "Part Number",
    "Part Name",
    "Serial Number",
    "Product Name",
    "Email Status",
    "DNAP",
    "Workgroup",
    "Team"
  ],

  "Closed Cases Data": [
    "Case ID",
    "Customer Name",
    "Created On",
    "Created By",
    "Modified By",
    "Modified On",
    "Case Closed Date",
    "Closed By",
    "Country",
    "Case Resolution Code",
    "Case Owner",
    "OTC Code",
    "TL",
    "SBD",
    "Market",
    "Workgroup",
    "Team"
  ]
};

function resetInlineTeamAdd() {
  if (isAddingTeamInline) {
    isAddingTeamInline = false;
    renderTeamDropdown();   // rebuild dropdown in normal state --
  }
}

function isRepairResolution(resolution) {
  return RESOLUTION_TYPES
    .map(r => r.toLowerCase())
    .includes(normalizeText(resolution));
}

function requireTeamSelected() {
  if (!currentTeam) {
    alert("Please select a team before continuing.");
    return false;
  }
  return true;
}

// Dump sheet header display overrides (UI only) --
const DUMP_HEADER_DISPLAY_MAP = {
  "Full Name (Primary Contact) (Contact)": "Customer Name",
  "Full Name (Owning User) (User)": "Case Owner",
  "ProductName": "Product Name",
  "Product Serial Number": "Serial Number",
  "Workgroup (Owning User) (User)": "Workgroup"
};

const DB_NAME = "KCI_CASE_TRACKER_DB";
const DB_VERSION = 3;
const STORE_NAME = "sheets";

let db = null;

function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = function (e) {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(TEAM_STORE)) {
        db.createObjectStore(TEAM_STORE, { keyPath: "name" });
      }
    };

    request.onsuccess = function (e) {
      db = e.target.result;
      resolve(db);
    };

    request.onerror = function () {
      reject("Failed to open IndexedDB");
    };
  });
}

async function loadTeams() {
  const tx = db.transaction(TEAM_STORE, "readonly");
  const store = tx.objectStore(TEAM_STORE);
  return new Promise(res => {
    const req = store.getAll();
    req.onsuccess = () => res(req.result || []);
  });
}

async function setCurrentTeam(team) {
  isAddingTeamInline = false;
  currentTeam = team;                                   // 🔥 single source of truth
  localStorage.setItem("kci-last-team", team);

  // Update toggle label
  const toggle = document.getElementById("teamToggle");
  if (toggle) {
    toggle.textContent = team;
  }

  // 🔥 Close team dropdown after selection
  const dropdown = document.getElementById("teamDropdown");
  if (dropdown) {
    dropdown.style.display = "none";
  }

  /* 🔥 RE-RENDER DROPDOWN SO ACTIVE CLASS APPLIES */
  await renderTeamDropdown();

  /* 🔥 CLEAR ALL TABLES FIRST */
  Object.values(dataTablesMap).forEach(dt => {
    dt.clear().draw(false);
  });

  /* 🔥 NOW LOAD TEAM DATA */
  await loadDataFromDB();

  updateProcessButtonState();
  // ✅ ENABLE action bar buttons once team is selected
  document.querySelectorAll(
    ".action-bar button, #workgroupBtn"
  ).forEach(btn => {
    btn.disabled = false;
  });
}

async function renderTeamDropdown() {
  const dropdown = document.getElementById("teamDropdown");
  dropdown.innerHTML = "";

  const teams = await loadTeams();

  teams.forEach(t => {
    const row = document.createElement("div");
    row.className = "team-row" + (t.name === currentTeam ? " active" : "");

    const name = document.createElement("span");
    name.textContent = t.name;
    name.onclick = () => setCurrentTeam(t.name);
    
    const sep = document.createElement("span");
    sep.className = "team-sep";
    sep.textContent = "|";
    
    const delWrap = document.createElement("span");
    delWrap.className = "team-del";
    
    const del = document.createElement("span");
    del.textContent = "✕";
    
    delWrap.appendChild(del);
    
    delWrap.onclick = async (e) => {
      e.stopPropagation();
      if (!confirm(`Delete team "${t.name}" and ALL its data?`)) return;
      await deleteTeam(t.name);
    };
    
    row.appendChild(name);
    row.appendChild(sep);       // visual only
    row.appendChild(delWrap);  // clickable till edge
    
    dropdown.appendChild(row);
  });

  // ----- INLINE ADD TEAM ROW -----
  if (isAddingTeamInline) {
    const row = document.createElement("div");
    row.className = "team-row team-add-inline";
  
    const input = document.createElement("input");
    input.type = "text";
    input.placeholder = "New team name";
    input.autofocus = true;

    input.addEventListener("click", (e) => {
      e.stopPropagation();              // 🔥 allow typing
    });
  
    const sep = document.createElement("span");
    sep.className = "team-sep";
    sep.textContent = "|";
    
    const confirmWrap = document.createElement("span");
    confirmWrap.className = "team-del team-confirm-inline";
    
    const confirm = document.createElement("span");
    confirm.textContent = "✔";
    
    confirmWrap.appendChild(confirm);
    
    confirmWrap.onclick = async (e) => {
      e.stopPropagation();
    
      const name = input.value.trim();
      if (!name) return;
    
      isAddingTeamInline = false;
    
      const tx = db.transaction(TEAM_STORE, "readwrite");
      tx.objectStore(TEAM_STORE).put({ name });
    
      await setCurrentTeam(name);
    };
  
    input.onkeydown = (e) => {
      if (e.key === "Enter") confirm.click();
      if (e.key === "Escape") {
        isAddingTeamInline = false;
        renderTeamDropdown();
      }
    };
  
    const nameWrap = document.createElement("span");
    nameWrap.appendChild(input);
    row.appendChild(nameWrap);   // ← same position as team name span
    row.appendChild(sep);        // |
    row.appendChild(confirmWrap); // ✔ (same hit-zone as ✕)
    dropdown.appendChild(row);
  }
  const add = document.createElement("div");
  add.className = "team-add";
  add.textContent = "+ Add Team";
  add.onclick = (e) => {
    e.stopPropagation();              // 🔥 CRITICAL
    isAddingTeamInline = true;
    renderTeamDropdown();
  };
  
  dropdown.appendChild(add);
}

document.getElementById("teamToggle").onclick = (e) => {
  e.stopPropagation();

  const box = document.getElementById("teamDropdown");
  const isOpen = box.style.display === "block";

  if (isOpen) {
    box.style.display = "none";

    // 🔥 RESET INLINE ADD STATE IF DROPDOWN IS CLOSED
    if (isAddingTeamInline) {
      isAddingTeamInline = false;
      renderTeamDropdown();
    }

  } else {
    box.style.display = "block";
  }
};

// 🔥 Prevent clicks inside team dropdown from closing it
document.getElementById("teamDropdown").addEventListener("click", (e) => {
  e.stopPropagation();
});

document.addEventListener("click", (e) => {
  const dropdown = document.getElementById("teamDropdown");
  const toggle = document.getElementById("teamToggle");

  if (!dropdown.contains(e.target) && !toggle.contains(e.target)) {
    dropdown.style.display = "none";
    resetInlineTeamAdd();   // 🔥 reset inline input when closing
  }
});

async function deleteTeam(team) {
  // 1️⃣ Delete all team data from sheets store
  const tx = db.transaction(STORE_NAME, "readwrite");
  const store = tx.objectStore(STORE_NAME);

  const keysReq = store.getAllKeys();
  keysReq.onsuccess = async () => {
    keysReq.result
      .filter(k => k.startsWith(team + "|"))
      .forEach(k => store.delete(k));

    // 2️⃣ Delete team from TEAM_STORE
    await new Promise(res => {
      const ttx = db.transaction(TEAM_STORE, "readwrite");
      ttx.objectStore(TEAM_STORE).delete(team).onsuccess = res;
    });

    // 3️⃣ Load remaining teams
    const teams = await loadTeams();

    // 4️⃣ Decide next team to auto-select
    let nextTeam = null;

    if (teams.length) {
      // Prefer first team in the remaining list
      nextTeam = teams[0].name;
    }

    // 5️⃣ Update UI + state
    if (nextTeam) {
      // setCurrentTeam handles dropdown render internally
      await setCurrentTeam(nextTeam);
    } else {
      // No teams left → reset app state
      currentTeam = null;
      localStorage.removeItem("kci-last-team");
      document.getElementById("teamToggle").textContent = "Select Team";
    
      Object.values(dataTablesMap).forEach(dt =>
        dt.clear().draw(false)
      );
    
      document.querySelectorAll(
        ".action-bar button, #processBtn, #workgroupBtn"
      ).forEach(btn => btn.disabled = true);
    
      // Explicitly refresh dropdown (now empty)
      await renderTeamDropdown();
    }
  };
}

function openModal(id) {
  document.getElementById(id).style.display = 'flex';
}

function closeModal(id) {
  document.getElementById(id).style.display = 'none';
}

function getTeamKey(sheetName) {
  return `${currentTeam}|${sheetName}`;
}

function getStore(mode = "readonly") {
  const tx = db.transaction(STORE_NAME, mode);
  return tx.objectStore(STORE_NAME);
}

function getColumnIndex(sheetName, columnName) {
  const headers = TABLE_SCHEMAS[sheetName];
  return headers ? headers.indexOf(columnName) + 1 : -1;
  // +1 because DataTables has S.No as column 0
}

function initEmptyTables() {
  const container = document.getElementById('tablesContainer');
  container.innerHTML = '';

  const tabsDiv = document.createElement('div');
  tabsDiv.className = 'sheet-tabs';
  container.appendChild(tabsDiv);
  
  const leftTabsDiv = document.createElement('div');
  leftTabsDiv.className = 'sheet-tabs-left';
  
  const rightTabsDiv = document.createElement('div');
  rightTabsDiv.className = 'sheet-tabs-right';
  
  tabsDiv.appendChild(leftTabsDiv);
  tabsDiv.appendChild(rightTabsDiv);

  let first = true;

  Object.keys(TABLE_SCHEMAS).forEach(sheetName => {
    const headers = TABLE_SCHEMAS[sheetName];

    const tableWrapper = document.createElement('div');
    tableWrapper.className = 'table-scroll-wrapper';
    tableWrapper.style.display = first ? 'block' : 'none';
    tableWrapper.dataset.sheet = sheetName;

    const table = document.createElement('table');
    table.className = 'display';

    const thead = document.createElement('thead');
    const tr = document.createElement('tr');
    
    // Serial number column
    const snTh = document.createElement('th');
    snTh.textContent = "S.No";
    tr.appendChild(snTh);
    
    // Actual headers
    headers.forEach(h => {
      const th = document.createElement('th');
    
      // UI-only header rename for Dump sheet
      if (sheetName === "Dump" && DUMP_HEADER_DISPLAY_MAP[h]) {
        th.textContent = DUMP_HEADER_DISPLAY_MAP[h];
      } else {
        th.textContent = h;
      }
    
      tr.appendChild(th);
    });

    thead.appendChild(tr);
    table.appendChild(thead);

    const tbody = document.createElement('tbody');
    table.appendChild(tbody);

    tableWrapper.appendChild(table);
    container.appendChild(tableWrapper);

    const columnDefs = [
      {
        targets: 0,
        searchable: false,
        orderable: false
      }
    ];
    
    // Apply fixed width for diagnostics / notes columns
    if (sheetName === "WO") {
      const idx = getColumnIndex(sheetName, "Resolution Notes/ Diagnostics");
      if (idx !== -1) {
        columnDefs.push({
          targets: idx,
          width: "300px",
          className: "fixed-notes-col"
        });
      }
    }
    
    if (sheetName === "Repair Cases") {
      const idx = getColumnIndex(sheetName, "WO Closure Notes");
      if (idx !== -1) {
        columnDefs.push({
          targets: idx,
          width: "300px",
          className: "fixed-notes-col"
        });
      }
    }
    
    const dt = $(table).DataTable({
      pageLength: 10,
      autoWidth: false,
      columnDefs,
      order: [[1, 'asc']],
    
      fixedHeader: {
        header: true,
        headerOffset: 96.6   // sheet-tabs (48) + dt-top (50)
      },
    
      dom:
        "<'dt-top'l f>" +
        "<'dt-middle't>" +
        "<'dt-bottom'i p>"
    });
    
    attachSerialNumber(dt);

    dataTablesMap[sheetName] = dt;

    tablesMap[sheetName] = tableWrapper;

    const tab = document.createElement('div');
    tab.className = 'sheet-tab' + (first ? ' active' : '');
    tab.textContent = sheetName;
    tab.onclick = () => switchSheet(sheetName);
    
    // Right-aligned tabs
    if (sheetName === "Repair Cases" || sheetName === "Closed Cases Data") {
      rightTabsDiv.appendChild(tab);
    } else {
      leftTabsDiv.appendChild(tab);
    }

    first = false;
  });
}

function attachSerialNumber(dt) {
  dt.on('order.dt search.dt draw.dt', function () {
    dt.column(0, { search: 'applied', order: 'applied' })
      .nodes()
      .each((cell, i) => {
        cell.innerHTML = i + 1;
      });
  });
}

function cleanCell(value) {
  if (value === null || value === undefined) return "";

  let str = String(value);

  // Remove non-breaking spaces
  str = str.replace(/\u00A0/g, ' ');

  // Remove hidden control characters (SAP / Excel junk)
  // Preserve line breaks, remove only unwanted control chars
  str = str.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '');

  return str.trim();
}

function normalizeText(val) {
  return String(val || "")
    .trim()
    .toLowerCase();
}

async function removeRepairCasesByCountry(targetCountry) {
  if (!targetCountry) return;

  const store = getStore("readonly");
  const all = await new Promise(res => {
    const req = store.getAll();
    req.onsuccess = () => res(req.result);
  });

  const teamData = all.filter(r => r.team === currentTeam);
  const repairRecord = teamData.find(r => r.sheetName === "Repair Cases");

  if (!repairRecord) {
    console.log("No Repair Cases found");
    return;
  }

  const countryIdx = TABLE_SCHEMAS["Repair Cases"].indexOf("Country");

  const before = repairRecord.rows.length;

  const filteredRows = repairRecord.rows.filter(r =>
    normalizeText(r[countryIdx]) !== normalizeText(targetCountry)
  );

  const removed = before - filteredRows.length;

  console.log(`Removed ${removed} rows for country: ${targetCountry}`);

  // UI update
  const dt = dataTablesMap["Repair Cases"];
  dt.clear();
  filteredRows.forEach(r => dt.row.add(["", ...r]));
  dt.draw(false);

  // DB update
  getStore("readwrite").put({
    id: getTeamKey("Repair Cases"),
    team: currentTeam,
    sheetName: "Repair Cases",
    rows: filteredRows,
    lastUpdated: new Date().toISOString()
  });
}

function buildDumpCaseMap(dump, caseIdx) {
  const map = Object.create(null);
  dump.forEach(r => {
    const id = r[caseIdx];
    if (id) map[id] = r;
  });
  return map;
}

function createEmptyMatrix() {
  const matrix = {};

  RESOLUTION_TYPES.forEach(r => {
    matrix[r] = {};
    CA_BUCKETS.forEach(ca => matrix[r][ca] = 0);
    matrix[r].Total = 0;
  });

  matrix.Total = {};
  CA_BUCKETS.forEach(ca => matrix.Total[ca] = 0);
  matrix.Total.Total = 0;

  return matrix;
}

function buildOpenRepairCasesListFromTeamData(teamData) {
  const dump =
    teamData.find(x => x.sheetName === "Dump")?.rows || [];

  const caseIdx = TABLE_SCHEMAS["Dump"].indexOf("Case ID");
  const resIdx =
    TABLE_SCHEMAS["Dump"].indexOf("Case Resolution Code");

  return [
    ...new Set(
      dump
        .filter(r =>
          ["onsite solution", "parts shipped", "offsite solution"]
            .includes(normalizeText(r[resIdx]))
        )
        .map(r => r[caseIdx])
    )
  ];
}

function buildMatrixFromCases(caseIds, repairRows) {
  const matrix = createEmptyMatrix();

  const caseIdx = TABLE_SCHEMAS["Repair Cases"].indexOf("Case ID");
  const resIdx =
    TABLE_SCHEMAS["Repair Cases"].indexOf("Case Resolution Code");
  const caIdx =
    TABLE_SCHEMAS["Repair Cases"].indexOf("CA Group");

  caseIds.forEach(id => {
    const row = repairRows.find(r => r[caseIdx] === id);
    if (!row) return; // confirmed skip

    const res = row[resIdx];
    const ca = row[caIdx];

    if (!matrix[res] || !(ca in matrix[res])) return;

    matrix[res][ca]++;
    matrix[res].Total++;
    matrix.Total[ca]++;
    matrix.Total.Total++;
  });

  return matrix;
}

function buildReadyForClosureList(caseIds, repairRows) {
  const caseIdx = TABLE_SCHEMAS["Repair Cases"].indexOf("Case ID");
  const resIdx =
    TABLE_SCHEMAS["Repair Cases"].indexOf("Case Resolution Code");

  const onsiteIdx =
    TABLE_SCHEMAS["Repair Cases"].indexOf("Onsite RFC");
  const csrIdx =
    TABLE_SCHEMAS["Repair Cases"].indexOf("CSR RFC");
  const benchIdx =
    TABLE_SCHEMAS["Repair Cases"].indexOf("Bench RFC");

  return caseIds.filter(id => {
    const row = repairRows.find(r => r[caseIdx] === id);
    if (!row) return false;

    const res = row[resIdx];
    const onsite = normalizeText(row[onsiteIdx]);
    const csr = normalizeText(row[csrIdx]);
    const bench = normalizeText(row[benchIdx]);

    if (
      res === "Onsite Solution" &&
      ["closed - canceled", "closed - posted", "open - completed"]
        .includes(onsite)
    ) return true;

    if (
      res === "Parts Shipped" &&
      ["cancelled", "pod", "closed"].includes(csr)
    ) return true;

    if (
      res === "Offsite Solution" &&
      ["delivered", "order cancelled, not to be reopened"]
        .includes(bench)
    ) return true;

    return false;
  });
}

function renderOrcTable(containerId, matrix) {
  let html = `<table class="orc-table"><thead><tr><th></th>`;

  CA_BUCKETS.forEach(ca => html += `<th>${ca}</th>`);
  html += `<th>Total</th></tr></thead><tbody>`;

  RESOLUTION_TYPES.forEach(r => {
    html += `<tr><td class="row-header">${r}</td>`;
    CA_BUCKETS.forEach(ca => html += `<td>${matrix[r][ca]}</td>`);
    html += `<td>${matrix[r].Total}</td></tr>`;
  });

  html += `<tr class="total-row"><td class="row-header">Total</td>`;
  CA_BUCKETS.forEach(ca => html += `<td>${matrix.Total[ca]}</td>`);
  html += `<td>${matrix.Total.Total}</td></tr></tbody></table>`;

  document.getElementById(containerId).innerHTML = html;
}

function toYYYYMM(dateStr) {
  const d = new Date(dateStr);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function toDateKey(dateStr) {
  const d = new Date(dateStr);
  return d.toISOString().split("T")[0];
}

function formatDayDisplay(dateStr) {
  const d = new Date(dateStr);
  return d.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "long"
  });
}

function formatMonthDisplay(yyyyMM) {
  const [y, m] = yyyyMM.split("-");
  const d = new Date(y, m - 1, 1);
  return d.toLocaleDateString("en-GB", {
    month: "short",
    year: "numeric"
  }).replace(" ", " - ");
}

function excelDateToJSDate(serial) {
  const utc_days = Math.floor(serial - 25569);
  const utc_value = utc_days * 86400;
  const date_info = new Date(utc_value * 1000);

  const fractional_day = serial - Math.floor(serial) + 0.0000001;
  let total_seconds = Math.floor(86400 * fractional_day);

  const seconds = total_seconds % 60;
  total_seconds -= seconds;
  const hours = Math.floor(total_seconds / 3600);
  const minutes = Math.floor(total_seconds / 60) % 60;

  date_info.setHours(hours);
  date_info.setMinutes(minutes);
  date_info.setSeconds(seconds);

  return date_info;
}

function formatDate(date) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function normalizeTrackingStatus(value) {
  if (value === null || value === undefined) return "";

  let str = String(value).trim();

  // 1️⃣ Remove exact trailing ", Last Update:"
  if (str.endsWith(", Last Update:")) {
    str = str.replace(/, Last Update:$/, "");
  }

  // 2️⃣ Excel date serial → formatted date
  if (/^\d{5}\.\d+$/.test(str)) {
    const serial = Number(str);
    if (!isNaN(serial)) {
      try {
        const d = excelDateToJSDate(serial);

        const pad = n => String(n).padStart(2, "0");
        str =
          `${pad(d.getDate())}-${pad(d.getMonth() + 1)}-${d.getFullYear()} ` +
          `${pad(d.getHours())}:${pad(d.getMinutes())}`;
      } catch {
        // fallback: keep original string
      }
    }
  }

  return str;
}

function normalizeRowToSchema(row, sheetName) {
  const headers = TABLE_SCHEMAS[sheetName];
  const normalized = new Array(headers.length).fill("");

  for (let i = 0; i < headers.length; i++) {
    if (row && row[i] !== undefined) {
      normalized[i] = row[i];
    }
  }

  return normalized;
}

document.getElementById('kciInput').addEventListener('change', e => {
  const file = e.target.files[0];
  if (!file) return;

  if (!file.name.startsWith("KCI - Open Repair Case Data")) {
    alert("Invalid file. Please upload 'KCI - Open Repair Case Data' file.");
    e.target.value = "";
    return;
  }

  kciFile = file;
  updateProcessButtonState();
});

document.getElementById('csoInput').addEventListener('change', e => {
  const file = e.target.files[0];
  if (!file) return;

  if (!/^GNPro_Case_CSO_Status_\d{4}-\d{2}-\d{2}/.test(file.name)) {
    alert("Invalid GNPro CSO file name.");
    e.target.value = "";
    return;
  }

  csoFile = file;
  updateProcessButtonState();
});

document.getElementById('trackingInput').addEventListener('change', e => {
  const file = e.target.files[0];
  if (!file) return;

  if (!/^Tracking_Results_\d{4}-\d{2}-\d{2}/.test(file.name)) {
    alert("Invalid Tracking Results file name.");
    e.target.value = "";
    return;
  }

  trackingFile = file;
  updateProcessButtonState();
});

document.getElementById('processBtn').addEventListener('click', async () => {
  if (!requireTeamSelected()) return;

  document.getElementById("processBtn").disabled = true;

  if (kciFile) {
    startProgressContext("Processing KCI Excel...");
  
    // ✅ FULL overwrite ONLY for KCI Excel
    const store = getStore("readwrite");

    // Read old Sorted FIRST and Store old Sorted rows in memory
    const existingSorted = await new Promise(res => {
        const req = store.get(getTeamKey("Sorted"));
        req.onsuccess = () =>
          res(req.result?.rows || []);
      });
    window.previousSortedRows = existingSorted;
    
    // 🔥 HARD DELETE old KCI sheets from IndexedDB
    ["Dump", "WO", "MO", "MO Items", "SO", "Closed Cases", "Sorted"].forEach(sheet => {
      store.delete(getTeamKey(sheet));
      dataTablesMap[sheet]?.clear().draw(false);
    });
    
    await processExcelFile(kciFile, [
      "Dump", "WO", "MO", "MO Items", "SO", "Closed Cases"
    ]);
  
    kciFile = null;
    document.getElementById('kciInput').value = "";
    updateProcessButtonState();
    endProgressContext("KCI Excel processed");
    return;
  }

  if (csoFile) {
    startProgressContext("Processing GNPro CSO file...");
    await processGNProCSOFile(csoFile);
    csoFile = null;
    document.getElementById('csoInput').value = "";
    updateProcessButtonState();
    endProgressContext("GNPro CSO processed");
    return;
  }

  if (trackingFile) {
    startProgressContext("Processing Tracking Results...");
    await processTrackingResultsFile(trackingFile);
    trackingFile = null;
    document.getElementById('trackingInput').value = "";
    updateProcessButtonState();
    endProgressContext("Tracking Results processed");
    return;
  }

});

function updateProcessButtonState() {
  const btn = document.getElementById("processBtn");

  btn.disabled = !(
    currentTeam &&
    (kciFile || csoFile || trackingFile)
  );
}

let progressContext = null;
let displayedProgress = 0;
let progressAnimFrame = null;

function showProgressOverlay() {
  document.getElementById("progressOverlay").style.display = "flex";
}

function hideProgressOverlay() {
  const overlay = document.getElementById("progressOverlay");
  overlay.style.display = "none";
  overlay.classList.remove("progress-complete");

  document.getElementById("overlayConfirmBtn").style.display = "none";
  document.getElementById("overlayProgressBar").style.width = "0%";
  document.getElementById("overlayProgressText").textContent = "0%";
}

function startProgressContext(label) {
  progressContext = { label, value: 0 };
  displayedProgress = 0;

  showProgressOverlay();

  document.getElementById("overlayStatusText").textContent = label;
  document.getElementById("overlayProgressBar").style.width = "0%";
  document.getElementById("overlayProgressText").textContent = "0%";
}

function animateProgressTo(targetPercent, duration = 280) {
  const bar = document.getElementById("overlayProgressBar");

  if (progressAnimFrame) {
    cancelAnimationFrame(progressAnimFrame);
    progressAnimFrame = null;
  }

  const start = performance.now();
  const startPercent = displayedProgress;
  const delta = targetPercent - startPercent;

  function step(now) {
    const elapsed = now - start;
    const progress = Math.min(elapsed / duration, 1);

    // Ease-out curve (feels natural)
    const eased = 1 - Math.pow(1 - progress, 3);
    const current = startPercent + delta * eased;

    displayedProgress = current;
    bar.style.width = current.toFixed(2) + "%";
    document.getElementById("overlayProgressText").textContent =
      Math.round(current) + "%";

    if (progress < 1) {
      progressAnimFrame = requestAnimationFrame(step);
    } else {
      displayedProgress = targetPercent;
      bar.style.width = targetPercent + "%";
      document.getElementById("overlayProgressText").textContent =
        targetPercent + "%";
      progressAnimFrame = null;
    }
  }

  progressAnimFrame = requestAnimationFrame(step);
}

function updateProgressContext(current, total, text) {
  if (!progressContext || total === 0) return;

  const percent = Math.min(
    100,
    Math.round((current / total) * 100)
  );

  animateProgressTo(percent);

  if (text) {
    document.getElementById("overlayStatusText").textContent = text;
  }
}

function endProgressContext(text = "Completed") {
  const bar = document.getElementById("overlayProgressBar");
  const status = document.getElementById("overlayStatusText");
  const confirmBtn = document.getElementById("overlayConfirmBtn");
  const overlay = document.getElementById("progressOverlay");

  animateProgressTo(100, 200);
  status.textContent = text;

  overlay.classList.add("progress-complete");
  confirmBtn.style.display = "inline-block";

  confirmBtn.onclick = () => {
    hideProgressOverlay();
    progressContext = null;
  };
}

function buildSheetTables(workbook) {
  return new Promise(async resolve => {

    const sheetNames = workbook.SheetNames;

    let processedRows = 0;
    const totalRows = sheetNames.reduce((sum, s) => {
      const sheet = workbook.Sheets[s];
      return sum + (sheet ? XLSX.utils.sheet_to_json(sheet, { header: 1 }).length : 0);
    }, 0);

    for (let index = 0; index < sheetNames.length; index++) {
      const sheetName = sheetNames[index];
      await new Promise(requestAnimationFrame);

      const sheet = workbook.Sheets[sheetName];
      const json = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true });
      if (!json.length) continue;

      const headers = TABLE_SCHEMAS[sheetName];
      if (!headers) continue;

      const rows = json
        .slice(1)
        .map(row => {
          const excelRow = row.slice(3); // Column D onward
      
          // ✅ Skip empty Excel rows (fixes ghost rows)
          if (!excelRow.some(cell => String(cell || "").trim() !== "")) {
            return null;
          }
      
          const cleanedRow = [];
      
          for (let i = 0; i < headers.length; i++) {
            let cell = excelRow[i];
      
            if (typeof cell === "number" && cell > 40000 && cell < 60000) {
              try {
                cleanedRow.push(formatDate(excelDateToJSDate(cell)));
              } catch {
                cleanedRow.push(cleanCell(cell));
              }
            } else {
              cleanedRow.push(cleanCell(cell));
            }
          }
      
          return cleanedRow;
        })
        .filter(Boolean); // 🔥 removes null rows

      const dataTable = dataTablesMap[sheetName];
      dataTable.clear();

      rows.forEach(r => {
        dataTable.row.add(["", ...r]);
        processedRows++;
        updateProgressContext(
          processedRows,
          totalRows,
          `Processing ${sheetName} (${processedRows}/${totalRows})`
        );
      });

      dataTable.draw(false);

      getStore("readwrite").put({
        id: getTeamKey(sheetName),
        team: currentTeam,
        sheetName,
        rows: rows.map(r => normalizeRowToSchema(r, sheetName)),
        lastUpdated: new Date().toISOString()
      });
    }

    resolve();
  });
}

function processExcelFile(file, allowedSheets) {
  return new Promise(resolve => {
    const reader = new FileReader();

    reader.onload = async function (evt) {
      const data = new Uint8Array(evt.target.result);
      const workbook = XLSX.read(data, { type: 'array' });

      const filteredWorkbook = {
        SheetNames: workbook.SheetNames.filter(s => allowedSheets.includes(s)),
        Sheets: workbook.Sheets
      };

    await buildSheetTables(filteredWorkbook);
    await buildSortedTable();
    await syncCSOStatusTable();
    resolve();
    };

    reader.readAsArrayBuffer(file);
  });
}

function formatSentenceCase(value) {
  if (!value) return "";
  const str = String(value).trim().toLowerCase();
  return str.charAt(0).toUpperCase() + str.slice(1);
}

function processCsvFile(file, targetSheetName) {
  return new Promise(resolve => {
    const reader = new FileReader();

    reader.onload = function (e) {
      const text = e.target.result;

      // Parse CSV to rows
      const rows = XLSX.utils.sheet_to_json(
        XLSX.read(text, { type: "string" }).Sheets.Sheet1,
        { header: 1, raw: true }
      );

      if (!rows.length) {
        resolve();
        return;
      }

      const headers = TABLE_SCHEMAS[targetSheetName];
      const colCount = headers.length;
      const dataRows = rows.slice(1).map(r => {
        const cleaned = [];
      
        for (let i = 0; i < headers.length; i++) {
          let cellValue = cleanCell(r[i]);
      
          // ✅ Apply sentence case ONLY for CSO Status → Status column
          if (targetSheetName === "CSO Status" && headers[i] === "Status") {
            cellValue = formatSentenceCase(cellValue);
          }
      
          cleaned.push(cellValue);
        }
      
        return cleaned;
      });

      // Update UI
      const dt = dataTablesMap[targetSheetName];
      dt.clear();
      dataRows.forEach(r => dt.row.add(["", ...r])); // S.No placeholder
      dt.draw(false);

      // Save to IndexedDB
      const store = getStore("readwrite");
      store.put({
        id: getTeamKey(targetSheetName),
        team: currentTeam,
        sheetName: targetSheetName,
        rows: dataRows,
        lastUpdated: new Date().toISOString()
      });

      resolve();
    };

    reader.readAsText(file);
  });
}

function parseGNProCSV(text) {
  const rows = XLSX.utils.sheet_to_json(
    XLSX.read(text, { type: "string" }).Sheets.Sheet1,
    { header: 1, raw: true }
  );

  const map = new Map();
  rows.slice(1).forEach(r => {
    const caseId = cleanCell(r[0]);
    if (!caseId) return;

    map.set(caseId, {
      status: formatSentenceCase(cleanCell(r[2])),
      tracking: cleanCell(r[3]),
      repairStatus: cleanCell(r[4])
    });
  });

  return map;
}

function stripOrderSuffix(orderId) {

  let cleaned =
    String(orderId || "").trim();

  // REMOVE LINE ITEM SUFFIX
  cleaned =
    cleaned.replace(/-\d+$/, "");

  // REMOVE LEADING/TRAILING
  // SPECIAL CHARACTERS & SPACES
  cleaned =
    cleaned.replace(/^[^a-zA-Z0-9]+|[^a-zA-Z0-9]+$/g, "");

  return cleaned;
}

async function processGNProCSOFile(file) {

  // =====================================
  // LOAD EXISTING DATA
  // =====================================

  const store = getStore("readonly");

  const allData = await new Promise(res => {
    const req = store.getAll();
    req.onsuccess = () => res(req.result);
  });

  const teamData =
    allData.filter(r => r.team === currentTeam);

  let csoRows =
    teamData.find(r => r.sheetName === "CSO Status")?.rows || [];

  let sortedRows =
    teamData.find(r => r.sheetName === "Sorted")?.rows || [];

  // =====================================
  // PARSE GNPRO CSV
  // =====================================

  const csvText = await file.text();

  const gnproMap =
    parseGNProCSV(csvText);

  // =====================================
  // COLUMN INDEXES
  // =====================================

  const csoCaseIdx =
    TABLE_SCHEMAS["CSO Status"].indexOf("Case ID");

  const csoStatusIdx =
    TABLE_SCHEMAS["CSO Status"].indexOf("Status");

  const csoTrackingIdx =
    TABLE_SCHEMAS["CSO Status"].indexOf("Tracking Number");

  const csoRepairIdx =
    TABLE_SCHEMAS["CSO Status"].indexOf("Repair Status");

  const sortedCaseIdx =
    TABLE_SCHEMAS["Sorted"].indexOf("Case ID");

  const sortedOrderStatusIdx =
    TABLE_SCHEMAS["Sorted"].indexOf("Order Status");

  // =====================================
  // BUILD FAST SORTED LOOKUP
  // =====================================

  const sortedMap = new Map();

  sortedRows.forEach(row => {

    const caseId = row[sortedCaseIdx];

    if (!caseId) return;

    sortedMap.set(caseId, row);
  });

  // =====================================
  // UPDATE EXISTING CSO ROWS
  // =====================================

  let processed = 0;
  const total = csoRows.length;

  csoRows.forEach(csoRow => {

    processed++;

    updateProgressContext(
      processed,
      total,
      `Updating CSO Status (${processed}/${total})`
    );

    const caseId =
      csoRow[csoCaseIdx];

    if (!caseId) return;

    // CSV ENTRY NOT FOUND
    const csvRow =
      gnproMap.get(caseId);

    if (!csvRow) {
      return;
    }

    // =====================================
    // UPDATE CSO STATUS TABLE
    // =====================================

    csoRow[csoStatusIdx] =
      csvRow.status || "";

    csoRow[csoTrackingIdx] =
      csvRow.tracking || "";

    csoRow[csoRepairIdx] =
      csvRow.repairStatus || "";

    // =====================================
    // UPDATE SORTED TABLE
    // =====================================

    const sortedRow =
      sortedMap.get(caseId);

    if (sortedRow) {

      sortedRow[sortedOrderStatusIdx] =
        csvRow.status || "";
    }
  });

  // =====================================
  // UPDATE CSO STATUS UI
  // =====================================

  const csoDT =
    dataTablesMap["CSO Status"];

  csoDT.clear();

  csoRows.forEach(r => {
    csoDT.row.add(["", ...r]);
  });

  csoDT.draw(false);

  // =====================================
  // UPDATE SORTED UI
  // =====================================

  const sortedDT =
    dataTablesMap["Sorted"];

  sortedDT.clear();

  sortedRows.forEach(r => {
    sortedDT.row.add(["", ...r]);
  });

  sortedDT.draw(false);

  // =====================================
  // SAVE CSO STATUS
  // =====================================

  const writeStore =
    getStore("readwrite");

  writeStore.put({
    id: getTeamKey("CSO Status"),
    team: currentTeam,
    sheetName: "CSO Status",
    rows: csoRows,
    lastUpdated: new Date().toISOString()
  });

  // =====================================
  // SAVE SORTED
  // =====================================

  writeStore.put({
    id: getTeamKey("Sorted"),
    team: currentTeam,
    sheetName: "Sorted",
    rows: sortedRows,
    lastUpdated: new Date().toISOString()
  });

  // =====================================
  // SYNC DELIVERY DETAILS
  // =====================================
  
  await syncDeliveryDetailsTable();
}

function loadDataFromDB() {
  if (!currentTeam) return;

  const store = getStore("readonly");
  const req = store.getAll();

  req.onsuccess = () => {
    req.result
      .filter(r => r.team === currentTeam)
      .forEach(record => {
        const dt = dataTablesMap[record.sheetName];
        if (!dt) return;

        dt.clear();
        record.rows.forEach(row =>
          dt.row.add(["", ...normalizeRowToSchema(row, record.sheetName)])
        );
        dt.draw(false);
      });
  };
}

document.getElementById("ccDrillTotalBtn").onclick = () => {
  const store = getStore("readonly");
  store.get(getTeamKey("Closed Cases Data")).onsuccess = e => {
    buildDrilldownTotal(e.target.result.rows || []);
  };
};

async function openClosedCasesReport() {
  const store = getStore("readonly");
  const all = await new Promise(r => {
    const q = store.getAll();
    q.onsuccess = () => r(q.result);
  });
  
  // 🔒 TEAM FILTER
  const teamData = all.filter(r => r.team === currentTeam);
  
  const closed =
    teamData.find(x => x.sheetName === "Closed Cases Data")?.rows || [];

  if (!closed.length) {
    alert("No Closed Cases Data available.");
    return;
  }

  buildClosedCasesMonthFilter(closed);
  await buildClosedCasesAgentFilter(closed);
  buildClosedCasesSummary(closed);
  
  // 🔥 DEFAULT: show monthly total drilldown
  buildDrilldownTotal(closed);
  
  openModal("closedCasesReportModal");
}

async function openOpenRepairCasesReport() {
  const store = getStore("readonly");
  const all = await new Promise(r => {
    const q = store.getAll();
    q.onsuccess = () => r(q.result);
  });
  
  // 🔒 TEAM FILTER
  const teamData = all.filter(r => r.team === currentTeam);
  
  const repair =
    teamData.find(x => x.sheetName === "Repair Cases")?.rows || [];

  if (!repair.length) {
    alert("Repair Cases data not available.");
    return;
  }

  const openCases = buildOpenRepairCasesListFromTeamData(teamData);
  const openMatrix =
    buildMatrixFromCases(openCases, repair);

  const readyCases =
    buildReadyForClosureList(openCases, repair);
  const readyMatrix =
    buildMatrixFromCases(readyCases, repair);

  renderOrcTable("openRepairCasesTable", openMatrix);
  renderOrcTable("readyForClosureTable", readyMatrix);

  // ===== SBD SUMMARY CALCULATION =====
  const sbdIdx = TABLE_SCHEMAS["Repair Cases"].indexOf("SBD");
  
  let met = 0;
  let notMet = 0;
  let na = 0;
  
  openCases.forEach(caseId => {
    const row = repair.find(r => r[0] === caseId);
    if (!row) return;
  
    const sbd = normalizeText(row[sbdIdx]);
  
    if (sbd === "met") met++;
    else if (sbd === "not met") notMet++;
    else na++;
  });
  
  const total = met + notMet + na;
  
  const pct = (v) =>
    total ? Math.round((v / total) * 100) : 0;
  
    document.getElementById("orcSbdSummary").innerHTML = `
      <span class="sbd-label">SBD</span>
      <span class="sbd-pill sbd-met">Met - ${met} • ${pct(met)}%</span>
      <span class="sbd-pill sbd-not-met">Not Met - ${notMet} • ${pct(notMet)}%</span>
      <span class="sbd-pill sbd-na">NA - ${na} • ${pct(na)}%</span>
    `;
  
  openModal("openRepairCasesReportModal");
}

function buildClosedCasesMonthFilter(rows) {
  const select = document.getElementById("ccMonthSelect");
  select.innerHTML = "";

  const months = [...new Set(
    rows.map(r => toYYYYMM(r[6]))   // Case Closed Date
  )].sort().reverse().slice(0, 7);

  months.forEach(m => {
    const opt = document.createElement("option");
    opt.value = m;
    opt.textContent = formatMonthDisplay(m);
    select.appendChild(opt);
  });

  // Ensure latest month is selected by default
  if (select.options.length) {
    select.selectedIndex = 0;
  }

  select.onchange = () => buildClosedCasesSummary(rows);
}

async function saveSelectedKciAgents(agents) {
  getStore("readwrite").put({
    id: getTeamKey("KCI_AGENT_PREFS"),
    team: currentTeam,
    sheetName: "KCI_AGENT_PREFS",
    agents
  });
}

async function loadSelectedKciAgents() {
  const req = getStore("readonly").get(getTeamKey("KCI_AGENT_PREFS"));
  return new Promise(res => {
    req.onsuccess = () => res(req.result?.agents || []);
  });
}

async function buildClosedCasesAgentFilter(rows) {
  const box = document.getElementById("ccAgentBox");
  const selectedDiv = document.getElementById("ccAgentSelected");

  box.innerHTML = "";
  selectedDiv.innerHTML = "";

  // 🔥 Load previously saved KCI agents (if any)
  const savedAgents = await loadSelectedKciAgents();

  const agents = [...new Set(
    rows.map(r => r[7]).filter(v => v && v !== "CRM Auto Closed")
  )].sort();

  agents.forEach(name => {
    const label = document.createElement("label");

    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.value = name;
    cb.checked = savedAgents.includes(name);

    cb.onchange = async () => {
      updateSelectedAgents();
      buildClosedCasesSummary(rows);
    
      const selected =
        [...box.querySelectorAll("input:checked")]
          .map(i => i.value);
    
      await saveSelectedKciAgents(selected);
    };

    label.appendChild(cb);
    label.appendChild(document.createTextNode(name));
    box.appendChild(label);
  });

  function updateSelectedAgents() {
    const selected = [...box.querySelectorAll("input:checked")]
      .map(i => i.value);

    selectedDiv.innerHTML = "";
    
    selected.forEach(name => {
      const div = document.createElement("div");
      div.textContent = `– ${name}`;
      div.className = "cc-agent-name";
      selectedDiv.appendChild(div);
    });
  }

  updateSelectedAgents();

  // ---------- DROPDOWN OPEN / CLOSE LOGIC ----------
  const toggle = document.getElementById("ccAgentToggle");
  
  // Toggle dropdown on click
  toggle.onclick = (e) => {
    e.stopPropagation(); // prevent document click from firing
    box.style.display =
      box.style.display === "block" ? "none" : "block";
  };
  
  // Prevent clicks inside dropdown from closing it
  box.onclick = (e) => {
    e.stopPropagation();
  };
  
  // Close dropdown when clicking outside
  document.addEventListener("click", () => {
    box.style.display = "none";
  });
}

function buildClosedCasesSummary(rows) {
  const month = document.getElementById("ccMonthSelect").value;

  const selectedAgents =
    [...document.querySelectorAll("#ccAgentBox input:checked")]
      .map(cb => cb.value);

  const filtered = rows.filter(r =>
    toYYYYMM(r[6]) === month
  );

  const byDate = {};

  filtered.forEach(r => {
    const dateKey = toDateKey(r[6]);
    const closedBy = r[7];

    if (!byDate[dateKey]) {
      byDate[dateKey] = {
        total: 0,
        kci: 0,
        crm: 0
      };
    }

    byDate[dateKey].total++;

    if (closedBy === "CRM Auto Closed") {
      byDate[dateKey].crm++;
    } else if (selectedAgents.includes(closedBy)) {
      byDate[dateKey].kci++;
    }
  });

  const table = $("#ccSummaryTable").DataTable();
  table.clear();

  Object.keys(byDate).sort().forEach(date => {
    const d = byDate[date];
    const agentRC = d.total - d.kci - d.crm;
  
    const day = new Date(date).getDay(); // 0 = Sun, 6 = Sat
    const isWeekend = day === 0 || day === 6;
  
    const rowNode = table.row.add([
      formatDayDisplay(date),
      d.total,
      `<div class="cc-kci" data-date="${date}">${d.kci}</div>`,
      d.crm,
      agentRC
    ]).node();
  
    if (isWeekend) {
      rowNode.classList.add("cc-weekend");
    }
  });

  let totalAll = 0;
  let totalKci = 0;
  let totalCrm = 0;
  let totalRc = 0;
  
  Object.values(byDate).forEach(d => {
    totalAll += d.total;
    totalKci += d.kci;
    totalCrm += d.crm;
    totalRc += (d.total - d.kci - d.crm);
  });
  
  table.row.add([
    "<strong>Total</strong>",
    `<strong>${totalAll}</strong>`,
    `<strong>${totalKci}</strong>`,
    `<strong>${totalCrm}</strong>`,
    `<strong>${totalRc}</strong>`
  ]);

  table.draw(false);

  attachDrilldownClicks(filtered);

  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const yKey = toDateKey(yesterday);
  
  if (byDate[yKey]) {
    buildDrilldown(filtered, yKey);
  }

}

function attachDrilldownClicks(rows) {
  document.querySelectorAll(".cc-kci").forEach(el => {
    el.onclick = () => {
      const date = el.dataset.date;
      if (!date) return;   // 🔥 ignore Total row
      buildDrilldown(rows, date);
    };
  });
}

function buildDrilldown(rows, date) {
  const selectedAgents =
    [...document.querySelectorAll("#ccAgentBox input:checked")]
      .map(cb => cb.value);

  const map = {};

const selectedMonth =
  document.getElementById("ccMonthSelect").value;

  rows.forEach(r => {
    if (
      toYYYYMM(r[6]) === selectedMonth &&
      toDateKey(r[6]) === date &&
      selectedAgents.includes(r[7])
    ) {
      map[r[7]] = (map[r[7]] || 0) + 1;
    }
  });

  const table = $("#ccDrillTable").DataTable();
  table.clear();

  let total = 0;
  
  selectedAgents.forEach(agent => {
    const count = map[agent] || 0;
    total += count;
    table.row.add([agent, count]);
  });
  
  // 🔥 Grand Total row
  table.row.add([
    "<strong>Total</strong>",
    `<strong>${total}</strong>`
  ]);

  table.draw(false);

  document.getElementById("ccDrillTitle").textContent =
    `KCI Closures – ${formatDayDisplay(date)}`;
}

function buildDrilldownTotal(rows) {
  const selectedMonth =
    document.getElementById("ccMonthSelect").value;

  const selectedAgents =
    [...document.querySelectorAll("#ccAgentBox input:checked")]
      .map(cb => cb.value);

  const map = {};

  rows.forEach(r => {
    if (
      toYYYYMM(r[6]) === selectedMonth &&
      selectedAgents.includes(r[7])
    ) {
      map[r[7]] = (map[r[7]] || 0) + 1;
    }
  });

  const table = $("#ccDrillTable").DataTable();
  table.clear();

  let total = 0;

  selectedAgents.forEach(agent => {
    const count = map[agent] || 0;
    total += count;
    table.row.add([agent, count]);
  });

  table.row.add([
    "<strong>Total</strong>",
    `<strong>${total}</strong>`
  ]);

  table.draw(false);

  document.getElementById("ccDrillTitle").textContent =
    "KCI Closures – Monthly Total";
}

function switchSheet(sheetName) {
  document.querySelectorAll('.sheet-tab').forEach(tab => {
    tab.classList.toggle('active', tab.textContent === sheetName);
  });

  Object.keys(tablesMap).forEach(name => {
    const wrapper = tablesMap[name];
    const isActive = name === sheetName;

    wrapper.style.display = isActive ? 'block' : 'none';

    if (isActive) {
      const table = wrapper.querySelector('table');
      const dataTable = dataTablesMap[sheetName];

      // CRITICAL: force DataTables to recalc columns
      dataTable.columns.adjust().draw(false);
    }
  });
}

function toDateOnly(d) {
  const x = new Date(d);
  return new Date(x.getFullYear(), x.getMonth(), x.getDate());
}

function diffCalendarDays(from, to = new Date()) {
  const a = toDateOnly(from);
  const b = toDateOnly(to);
  return Math.floor((b - a) / (24 * 60 * 60 * 1000));
}

function getCAGroup(createdOn) {
  const d = new Date(createdOn);
  if (isNaN(d)) return "NA";
  const days = diffCalendarDays(d);

  if (days <= 3) return "0-3 Days";
  if (days <= 5) return "3-5 Days";
  if (days <= 10) return "5-10 Days";
  if (days <= 15) return "10-15 Days";
  if (days <= 30) return "15-30 Days";
  if (days <= 60) return "30-60 Days";
  if (days <= 90) return "60-90 Days";
  return "> 90 Days";
}

function getMOStatusPriority(status) {
  const s = normalizeText(status);

  if (s === "closed") return 1;
  if (s === "pod") return 2;
  if (s === "shipped") return 3;
  if (s === "ordered") return 4;
  if (s === "partially ordered") return 5;
  if (s === "order pending") return 6;
  if (s === "new") return 7;
  if (s === "cancelled") return 8;

  return 9; // unknown / future statuses
}

function getLatestMO(caseId, mo) {
  const caseMOs = mo.filter(r => r[1] === caseId);
  if (!caseMOs.length) return null;

  // Sort by Created On DESC
  caseMOs.sort((a, b) => new Date(b[2]) - new Date(a[2]));
  const latestTime = new Date(caseMOs[0][2]);

  // 5-minute window
  const windowMOs = caseMOs.filter(r =>
    Math.abs(new Date(r[2]) - latestTime) <= 5 * 60 * 1000
  );

  // Priority sort
  windowMOs.sort(
    (a, b) =>
      getMOStatusPriority(a[3]) - getMOStatusPriority(b[3])
  );

  return windowMOs[0];
}

function getFirstOrderDate(caseId, wo, mo, so) {
  const dates = [];

  wo.forEach(r => r[0] === caseId && r[6] && dates.push(new Date(r[6])));
  mo.forEach(r => r[1] === caseId && r[2] && dates.push(new Date(r[2])));
  so.forEach(r => r[0] === caseId && r[2] && dates.push(new Date(r[2])));

  if (!dates.length) return null;
  return new Date(Math.min(...dates));
}

function calculateSBD(caseRow, firstOrderDate, sbdConfig) {
  if (!sbdConfig || !Array.isArray(sbdConfig.periods)) return "NA";
  if (!firstOrderDate) return "NA";

  const caseCreated = new Date(caseRow.createdOn);
  const caseDateOnly = toDateOnly(caseCreated);

  const period = sbdConfig.periods.find(p =>
    p.startDate && p.endDate &&
    caseDateOnly >= new Date(p.startDate) &&
    caseDateOnly <= new Date(p.endDate)
  );

  if (!period) return "NA";

  const countryRow = period.rows.find(
    r => normalizeText(r.country) === normalizeText(caseRow.country)
  );

  if (!countryRow) return "NA";

  const cutOff = countryRow.time;
  if (!cutOff) return "NA";

  const cutOffDate = new Date(caseDateOnly);
  const [hh, mm] = cutOff.split(":");
  cutOffDate.setHours(hh, mm, 0, 0);

  if (caseCreated > cutOffDate) {
    cutOffDate.setDate(cutOffDate.getDate() + 1);
  }

  return firstOrderDate <= cutOffDate ? "Met" : "Not Met";
}

function getCalculatedResolution(caseId, wo, so, mo, dumpResolution) {
  let latest = null;

  // WO
  wo.forEach(r => {
    if (r[0] === caseId && r[6]) {
      const d = new Date(r[6]);
      if (!latest || d > latest.date) {
        latest = { type: "WO", date: d };
      }
    }
  });

  // SO
  so.forEach(r => {
    if (r[0] === caseId && r[2]) {
      const d = new Date(r[2]);
      if (!latest || d > latest.date) {
        latest = { type: "SO", date: d };
      }
    }
  });

  // MO
  mo.forEach(r => {
    if (r[1] === caseId && r[2]) {
      const d = new Date(r[2]);
      if (!latest || d > latest.date) {
        latest = { type: "MO", date: d };
      }
    }
  });

  // ✅ Decision
  if (!latest) {
    // fallback → dump
    return dumpResolution;
  }

  if (latest.type === "WO") return "Onsite Solution";
  if (latest.type === "SO") return "Offsite Solution";
  if (latest.type === "MO") return "Parts Shipped";

  return dumpResolution;
}

async function buildSortedTable() {

  const store = getStore("readonly");

  const all = await new Promise(res => {
    const req = store.getAll();
    req.onsuccess = () => res(req.result);
  });

  const teamData = all.filter(r => r.team === currentTeam);

  const dump =
    teamData.find(r => r.sheetName === "Dump")?.rows || [];

  const wo =
    teamData.find(r => r.sheetName === "WO")?.rows || [];

  const so =
    teamData.find(r => r.sheetName === "SO")?.rows || [];

  const mo =
    teamData.find(r => r.sheetName === "MO")?.rows || [];

  const existingSorted =
    window.previousSortedRows || [];

  const workgroupMap =
    teamData.find(r => r.sheetName === "WORKGROUP_MAP")
      ?.data || [];

  const dumpCaseIdx =
    TABLE_SCHEMAS["Dump"].indexOf("Case ID");

  const dumpResolutionIdx =
    TABLE_SCHEMAS["Dump"].indexOf("Case Resolution Code");

  const dumpWorkgroupIdx =
    TABLE_SCHEMAS["Dump"].indexOf(
      "Workgroup (Owning User) (User)"
    );

  const moOrderIdx =
    TABLE_SCHEMAS["MO"].indexOf("Order Number");
  
  const moStatusIdx =
    TABLE_SCHEMAS["MO"].indexOf("Order Status");

  const sortedCaseIdx =
    TABLE_SCHEMAS["Sorted"].indexOf("Case ID");
  
  const sortedStatusIdx =
    TABLE_SCHEMAS["Sorted"].indexOf("Order Status");

  const validResolutions = [
    "onsite solution",
    "offsite solution",
    "parts shipped"
  ];

  const existingSortedMap = new Map();
  
  existingSorted.forEach(row => {
  
    const caseId =
      row[sortedCaseIdx];
  
    if (!caseId) return;
  
    existingSortedMap.set(caseId, {
      orderStatus:
        row[sortedStatusIdx] || ""
    });
  });

  const finalRows = [];
  
  dump.forEach(row => {
  
    const caseId = row[dumpCaseIdx];
    const dumpResolution = row[dumpResolutionIdx];
  
    if (
      !validResolutions.includes(
        normalizeText(dumpResolution)
      )
    ) {
      return;
    }
  
    const calculatedResolution =
      getCalculatedResolution(
        caseId,
        wo,
        so,
        mo,
        dumpResolution
      );

    const workgroup =
      row[dumpWorkgroupIdx] || "";
    
    const assignedTeam =
      workgroupMap.find(team =>
        team.workgroups.some(w =>
          normalizeText(w) === normalizeText(workgroup)
        )
      )?.name || "";
  
    let latestOrder = "";
    let orderStatus = "";
  
    // =====================================
    // ONSITE SOLUTION → WO
    // =====================================
  
    if (calculatedResolution === "Onsite Solution") {
  
      const validWOs = wo.filter(r =>
        r[0] === caseId &&
        r[1] &&
        r[6]
      );
  
      if (validWOs.length) {
  
        validWOs.sort((a, b) =>
          new Date(b[6]) - new Date(a[6])
        );
  
        const latestWO = validWOs[0];
  
        latestOrder = latestWO[1] || "";
        orderStatus = latestWO[5] || "";
      }
    }
  
    // =====================================
    // OFFSITE SOLUTION → SO
    // =====================================
  
    else if (calculatedResolution === "Offsite Solution") {
  
      const validSOs = so.filter(r =>
        r[0] === caseId &&
        r[4] &&
        r[2]
      );
  
      if (validSOs.length) {
  
        validSOs.sort((a, b) =>
          new Date(b[2]) - new Date(a[2])
        );
  
        const latestSO = validSOs[0];
  
        latestOrder = latestSO[4] || "";
        
        const existing =
          existingSortedMap.get(caseId);
        
        orderStatus =
          existing?.orderStatus || "";
      }
    }
  
    // =====================================
    // PARTS SHIPPED → MO
    // =====================================
  
    else if (calculatedResolution === "Parts Shipped") {
  
      const latestMO = getLatestMO(caseId, mo);
  
      if (latestMO) {
        latestOrder = latestMO[moOrderIdx] || "";
        orderStatus = latestMO[moStatusIdx] || "";
      }
    }
  
    finalRows.push([
      caseId,
      calculatedResolution,
      latestOrder,
      orderStatus,
      workgroup,
      assignedTeam
    ]);
  });

  // ===== UI UPDATE =====

  const dt = dataTablesMap["Sorted"];

  dt.clear();

  finalRows.forEach(r => {
    dt.row.add(["", ...r]);
  });

  dt.draw(false);

  // ===== DB SAVE =====

  getStore("readwrite").put({
    id: getTeamKey("Sorted"),
    team: currentTeam,
    sheetName: "Sorted",
    rows: finalRows,
    lastUpdated: new Date().toISOString()
  });
}

async function syncCSOStatusTable() {

  const readStore = getStore("readonly");

  const allData = await new Promise(res => {
    const req = readStore.getAll();
    req.onsuccess = () => res(req.result);
  });

  const teamData =
    allData.filter(r => r.team === currentTeam);

  // =====================================
  // LOAD DATA
  // =====================================

  const sorted =
    teamData.find(r => r.sheetName === "Sorted")?.rows || [];

  let cso =
    teamData.find(r => r.sheetName === "CSO Status")?.rows || [];

  // =====================================
  // COLUMN INDEXES
  // =====================================

  const sortedCaseIdx =
    TABLE_SCHEMAS["Sorted"].indexOf("Case ID");

  const sortedResolutionIdx =
    TABLE_SCHEMAS["Sorted"].indexOf("Case Resolution Code");

  const sortedOrderIdx =
    TABLE_SCHEMAS["Sorted"].indexOf("Latest Order");

  const csoCaseIdx =
    TABLE_SCHEMAS["CSO Status"].indexOf("Case ID");

  const csoOrderIdx =
    TABLE_SCHEMAS["CSO Status"].indexOf("CSO");

  const csoStatusIdx =
    TABLE_SCHEMAS["CSO Status"].indexOf("Status");

  const csoTrackingIdx =
    TABLE_SCHEMAS["CSO Status"].indexOf("Tracking Number");

  const csoRepairIdx =
    TABLE_SCHEMAS["CSO Status"].indexOf("Repair Status");

  // =====================================
  // BUILD OFFSITE CASE MAP FROM SORTED
  // =====================================

  const offsiteMap = new Map();

  sorted.forEach(row => {

    const resolution =
      normalizeText(row[sortedResolutionIdx]);

    if (resolution !== "offsite solution") {
      return;
    }

    const caseId =
      row[sortedCaseIdx];

    const latestOrder =
      stripOrderSuffix(row[sortedOrderIdx]);

    if (!caseId || !latestOrder) {
      return;
    }

    offsiteMap.set(caseId, latestOrder);
  });

  // =====================================
  // REMOVE DUPLICATE CSO ROWS
  // =====================================

  const uniqueMap = new Map();

  cso.forEach(row => {

    const caseId = row[csoCaseIdx];

    if (!caseId) return;

    if (!uniqueMap.has(caseId)) {
      uniqueMap.set(caseId, row);
    }
  });

  cso = [...uniqueMap.values()];

  // =====================================
  // BUILD FAST CSO LOOKUP MAP
  // =====================================

  const csoMap = new Map();

  cso.forEach(row => {

    const caseId = row[csoCaseIdx];

    if (!caseId) return;

    csoMap.set(caseId, row);
  });

  // =====================================
  // SYNC CSO TABLE WITH SORTED
  // =====================================

  let csoUpdated = false;

  offsiteMap.forEach((latestOrder, caseId) => {

    let csoRow = csoMap.get(caseId);

    // NEW CASE
    if (!csoRow) {

      cso.push([
        caseId,
        latestOrder,
        "",
        "",
        ""
      ]);

      csoUpdated = true;
      return;
    }

    const existingOrder =
      stripOrderSuffix(csoRow[csoOrderIdx]);

    // SAME ORDER
    if (existingOrder === latestOrder) {
      return;
    }

    // ORDER CHANGED → RESET
    csoRow[csoOrderIdx] = latestOrder;

    csoRow[csoStatusIdx] = "";
    csoRow[csoTrackingIdx] = "";
    csoRow[csoRepairIdx] = "";

    csoUpdated = true;
  });

  // =====================================
  // REMOVE OBSOLETE CASES
  // =====================================

  const beforeCount = cso.length;

  cso = cso.filter(row => {

    const caseId = row[csoCaseIdx];

    return offsiteMap.has(caseId);
  });

  if (cso.length !== beforeCount) {
    csoUpdated = true;
  }

  // =====================================
  // SAVE UPDATED CSO TABLE
  // =====================================

  if (csoUpdated) {

    const writeStore = getStore("readwrite");

    writeStore.put({
      id: getTeamKey("CSO Status"),
      team: currentTeam,
      sheetName: "CSO Status",
      rows: cso,
      lastUpdated: new Date().toISOString()
    });

    // UI refresh
    const dt = dataTablesMap["CSO Status"];

    dt.clear();

    cso.forEach(r => {
      dt.row.add(["", ...r]);
    });

    dt.draw(false);
  }
}

async function syncDeliveryDetailsTable() {

  const store = getStore("readonly");

  const allData = await new Promise(res => {
    const req = store.getAll();
    req.onsuccess = () => res(req.result);
  });

  const teamData =
    allData.filter(r => r.team === currentTeam);

  // =====================================
  // LOAD TABLES
  // =====================================

  const sorted =
    teamData.find(r => r.sheetName === "Sorted")?.rows || [];

  const moItems =
    teamData.find(r => r.sheetName === "MO Items")?.rows || [];

  const cso =
    teamData.find(r => r.sheetName === "CSO Status")?.rows || [];

  let delivery =
    teamData.find(r => r.sheetName === "Delivery Details")?.rows || [];

  // =====================================
  // COLUMN INDEXES
  // =====================================

  const sortedCaseIdx =
    TABLE_SCHEMAS["Sorted"].indexOf("Case ID");

  const sortedResolutionIdx =
    TABLE_SCHEMAS["Sorted"].indexOf("Case Resolution Code");

  const sortedOrderIdx =
    TABLE_SCHEMAS["Sorted"].indexOf("Latest Order");

  const sortedStatusIdx =
    TABLE_SCHEMAS["Sorted"].indexOf("Order Status");

  const moItemOrderIdx =
    TABLE_SCHEMAS["MO Items"].indexOf("Material Order");

  const moItemNameIdx =
    TABLE_SCHEMAS["MO Items"].indexOf("MO Line Items Name");

  const moItemUrlIdx =
    TABLE_SCHEMAS["MO Items"].indexOf("Tracking Url");

  const csoCaseIdx =
    TABLE_SCHEMAS["CSO Status"].indexOf("Case ID");

  const csoTrackingIdx =
    TABLE_SCHEMAS["CSO Status"].indexOf("Tracking Number");

  const delCaseIdx =
    TABLE_SCHEMAS["Delivery Details"].indexOf("CaseID");

  const delOrderIdx =
    TABLE_SCHEMAS["Delivery Details"].indexOf("OrderID");

  const delTrackingIdx =
    TABLE_SCHEMAS["Delivery Details"].indexOf("Tracking URL");

  const delStatusIdx =
    TABLE_SCHEMAS["Delivery Details"].indexOf("CurrentStatus");

  // =====================================
  // BUILD DESIRED LIST
  // =====================================

  const desiredMap = new Map();

  sorted.forEach(row => {

    const caseId =
      row[sortedCaseIdx];

    const resolution =
      normalizeText(row[sortedResolutionIdx]);

    const latestOrder =
      row[sortedOrderIdx] || "";

    const orderStatus =
      normalizeText(row[sortedStatusIdx]);

    if (!caseId || !latestOrder) {
      return;
    }

    const isEligible =
      (
        resolution === "offsite solution" &&
        orderStatus === "delivered"
      )
      ||
      (
        resolution === "parts shipped" &&
        (
          orderStatus === "closed" ||
          orderStatus === "pod"
        )
      );

    if (!isEligible) {
      return;
    }

    desiredMap.set(caseId, {
      resolution,
      latestOrder
    });
  });

  // =====================================
  // BUILD DELIVERY MAP
  // =====================================

  const deliveryMap = new Map();

  delivery.forEach(row => {

    const caseId =
      row[delCaseIdx];

    if (!caseId) return;

    deliveryMap.set(caseId, {
      orderId:
        row[delOrderIdx] || "",

      trackingUrl:
        row[delTrackingIdx] || "",

      status:
        row[delStatusIdx] || ""
    });
  });

  // =====================================
  // PROCESS DESIRED CASES
  // =====================================

  desiredMap.forEach((data, caseId) => {

    const existing =
      deliveryMap.get(caseId);

    // =====================================
    // SAME ORDER → DO NOTHING
    // =====================================

    if (
      existing &&
      existing.orderId === data.latestOrder &&
      existing.trackingUrl
    ) {
      return;
    }

    let trackingUrl = "";

    // =====================================
    // PARTS SHIPPED
    // =====================================
    
    if (data.resolution === "parts shipped") {
    
      const matchingItems =
        moItems.filter(row =>
          row[moItemOrderIdx] === data.latestOrder
        );
    
      const moItemWithUrl =
        matchingItems.find(row =>
          row[moItemUrlIdx]
        );
    
      trackingUrl =
        moItemWithUrl?.[moItemUrlIdx] || "";
    }

    // =====================================
    // OFFSITE SOLUTION
    // =====================================

    else if (
      data.resolution === "offsite solution"
    ) {

      const csoRow =
        cso.find(r =>
          r[csoCaseIdx] === caseId
        );

      const trackingNumber =
        csoRow?.[csoTrackingIdx] || "";

      if (trackingNumber) {

        trackingUrl =
          "http://wwwapps.ups.com/WebTracking/processInputRequest" +
          "?TypeOfInquiryNumber=T&InquiryNumber1=" +
          trackingNumber;
      }
    }

    // =====================================
    // UPSERT / REBUILD
    // =====================================

    deliveryMap.set(caseId, {
      orderId: data.latestOrder,
      trackingUrl,
      status: ""
    });
  });

  // =====================================
  // REMOVE OBSOLETE CASES
  // =====================================

  [...deliveryMap.keys()].forEach(caseId => {

    if (!desiredMap.has(caseId)) {
      deliveryMap.delete(caseId);
    }
  });

  // =====================================
  // BUILD FINAL ROWS
  // =====================================

  const finalRows =
    [...deliveryMap.entries()]
      .map(([caseId, data]) => [
        caseId,
        data.orderId,
        data.trackingUrl,
        data.status
      ]);

  // =====================================
  // UI UPDATE
  // =====================================

  const dt =
    dataTablesMap["Delivery Details"];

  dt.clear();

  finalRows.forEach(r => {
    dt.row.add(["", ...r]);
  });

  dt.draw(false);

  // =====================================
  // SAVE TO DB
  // =====================================

  const writeStore =
    getStore("readwrite");

  writeStore.put({
    id: getTeamKey("Delivery Details"),
    team: currentTeam,
    sheetName: "Delivery Details",
    rows: finalRows,
    lastUpdated: new Date().toISOString()
  });
}

async function buildCopySOOrders() {

  const readStore = getStore("readonly");

  const allData = await new Promise(res => {
    const req = readStore.getAll();
    req.onsuccess = () => res(req.result);
  });

  const teamData =
    allData.filter(r => r.team === currentTeam);

  // =====================================
  // LOAD DATA
  // =====================================

  let cso =
    teamData.find(r => r.sheetName === "CSO Status")?.rows || [];

  // =====================================
  // RESET INVALID CACHE
  // =====================================

  invalidCSOEntries = [];

  // =====================================
  // COLUMN INDEXES
  // =====================================

  const csoCaseIdx =
    TABLE_SCHEMAS["CSO Status"].indexOf("Case ID");

  const csoOrderIdx =
    TABLE_SCHEMAS["CSO Status"].indexOf("CSO");

  const csoStatusIdx =
    TABLE_SCHEMAS["CSO Status"].indexOf("Status");

  // =====================================
  // BUILD FINAL OUTPUT
  // =====================================

  const result = [];

  cso.forEach(row => {

    const caseId =
      row[csoCaseIdx];

    const orderId =
      stripOrderSuffix(row[csoOrderIdx]);

    const status =
      normalizeText(row[csoStatusIdx]);

    // EXCLUDE DELIVERED / CANCELLED
    if (
      status === "delivered" ||
      status === "order cancelled, not to be reopened"
    ) {
      return;
    }

    // =====================================
    // INVALID CSO CHECK
    // =====================================

    if (orderId.length !== 8) {

      invalidCSOEntries.push({
        caseId,
        cso: orderId
      });

      return;
    }

    result.push(
      `${caseId},${orderId}`
    );
  });

  return result.join("\n");
}

async function buildCopyTrackingURLs() {

  const store = getStore("readonly");

  const allData = await new Promise(res => {
    const req = store.getAll();
    req.onsuccess = () => res(req.result);
  });

  const teamData =
    allData.filter(r => r.team === currentTeam);

  // =====================================
  // LOAD DELIVERY DETAILS
  // =====================================

  const delivery =
    teamData.find(r => r.sheetName === "Delivery Details")?.rows || [];

  // =====================================
  // COLUMN INDEXES
  // =====================================

  const delCaseIdx =
    TABLE_SCHEMAS["Delivery Details"].indexOf("CaseID");

  const delTrackingIdx =
    TABLE_SCHEMAS["Delivery Details"].indexOf("Tracking URL");

  const delStatusIdx =
    TABLE_SCHEMAS["Delivery Details"].indexOf("CurrentStatus");

  // =====================================
  // BUILD OUTPUT
  // =====================================

  const result = [];

  delivery.forEach(row => {

    const caseId =
      row[delCaseIdx];

    const trackingUrl =
      row[delTrackingIdx];

    const status =
      normalizeText(row[delStatusIdx]);

    // SKIP INVALID
    if (!caseId || !trackingUrl) {
      return;
    }

    // INCLUDE ONLY:
    // 1. blank status
    // 2. no status found

    const isEligible =
      !status ||
      status === "no status found";

    if (!isEligible) {
      return;
    }

    result.push(
      `${caseId} | ${trackingUrl}`
    );
  });

  return result.join("\n");
}

function parseTrackingResultsCSV(text) {
  const rows = XLSX.utils.sheet_to_json(
    XLSX.read(text, { type: "string" }).Sheets.Sheet1,
    { header: 1, raw: true }
  );

  const map = new Map();

  // Skip header
  rows.slice(1).forEach(r => {
    const caseId = cleanCell(r[0]);   // Column A
    const status = cleanCell(r[1]);   // Column B (CurrentStatus)
    if (!caseId) return;
    map.set(caseId, status);
  });

  return map;
}

async function processTrackingResultsFile(file) {

  // =====================================
  // LOAD EXISTING DATA
  // =====================================

  const store = getStore("readonly");

  const allData = await new Promise(res => {
    const req = store.getAll();
    req.onsuccess = () => res(req.result);
  });

  const teamData =
    allData.filter(r => r.team === currentTeam);

  const oldDelivery =
    teamData.find(r => r.sheetName === "Delivery Details")?.rows || [];

  // =====================================
  // COLUMN INDEXES
  // =====================================

  const delCaseIdx =
    TABLE_SCHEMAS["Delivery Details"].indexOf("CaseID");

  const delStatusIdx =
    TABLE_SCHEMAS["Delivery Details"].indexOf("CurrentStatus");

  // =====================================
  // PARSE TRACKING RESULTS CSV
  // =====================================

  const csvText =
    await file.text();

  const trackingCSVMap =
    parseTrackingResultsCSV(csvText);

  // =====================================
  // CLONE EXISTING DELIVERY DETAILS
  // =====================================

  const finalRows =
    oldDelivery.map(r => [...r]);

  // =====================================
  // UPDATE MATCHING CASES ONLY
  // =====================================

  let processed = 0;

  const total =
    finalRows.length;

  finalRows.forEach(row => {

    processed++;

    updateProgressContext(
      processed,
      total,
      `Updating Delivery Details (${processed}/${total})`
    );

    const caseId =
      row[delCaseIdx];

    if (!caseId) {
      return;
    }

    // CASE NOT FOUND IN CSV
    if (!trackingCSVMap.has(caseId)) {
      return;
    }

    const csvStatus =
      normalizeTrackingStatus(
        trackingCSVMap.get(caseId)
      );

    // SKIP BLANK CSV STATUS
    if (!csvStatus) {
      return;
    }

    // UPDATE CURRENT STATUS
    row[delStatusIdx] =
      csvStatus;
  });

  // =====================================
  // UPDATE UI TABLE
  // =====================================

  const dt =
    dataTablesMap["Delivery Details"];

  dt.clear();

  finalRows.forEach(r => {
    dt.row.add(["", ...r]);
  });

  dt.draw(false);

  // =====================================
  // SAVE TO INDEXEDDB
  // =====================================

  const writeStore =
    getStore("readwrite");

  writeStore.put({
    id: getTeamKey("Delivery Details"),
    team: currentTeam,
    sheetName: "Delivery Details",
    rows: finalRows,
    lastUpdated: new Date().toISOString()
  });
}

function createEmptySbdData() {
  return {
    sheetName: "SBD Cut Off Times",
    periods: Array.from({ length: 3 }, () => ({
      startDate: "",
      endDate: "",
      rows: []
    }))
  };
}

function datesOverlap(aStart, aEnd, bStart, bEnd) {
  return aStart && aEnd && bStart && bEnd &&
    !(aEnd < bStart || bEnd < aStart);
}

function renderSbdModal(data) {
  const container = document.querySelector(".sbd-periods");
  container.innerHTML = "";

  data.periods.forEach((p, idx) => {
    const div = document.createElement("div");
    div.className = "sbd-period";

    div.innerHTML = `
      <h4>Date Period ${idx + 1}</h4>
      <div class="sbd-dates">
        <input type="date" class="sbd-start" value="${p.startDate}">
        <input type="date" class="sbd-end" value="${p.endDate}">
      </div>
      <table class="sbd-table">
        <thead>
          <tr><th>Country</th><th>Cut Off Time</th><th></th></tr>
        </thead>
      </table>
      
      <div class="sbd-tbody-scroll">
        <table class="sbd-table">
          <tbody></tbody>
        </table>
      </div>
      <div class="sbd-add">+ Add Row</div>
    `;

    const tbody = div.querySelector("tbody");

    function addRow(row = { country: "", time: "" }) {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td><input value="${row.country}"></td>
        <td>
          <input
            type="text"
            value="${row.time}"
            placeholder="HH:MM"
            pattern="^([01][0-9]|2[0-3]):[0-5][0-9]$"
            title="24-hour format (HH:MM)"
          >
        </td>
        <td><button class="del">✕</button></td>
      `;
      tr.querySelector(".del").onclick = () => tr.remove();
      tbody.appendChild(tr);
    }

    p.rows.forEach(addRow);
    div.querySelector(".sbd-add").onclick = () => addRow();

    container.appendChild(div);
  });
}

async function saveSbdData() {
  const periods = [];
  const blocks = document.querySelectorAll(".sbd-period");

  blocks.forEach(b => {
    const startDate = b.querySelector(".sbd-start").value;
    const endDate = b.querySelector(".sbd-end").value;

    const rows = [];
    b.querySelectorAll("tbody tr").forEach(tr => {
      const country = tr.children[0].querySelector("input").value.trim();
      const time = tr.children[1].querySelector("input").value;
      if (country && time) rows.push({ country, time });
    });

    periods.push({ startDate, endDate, rows });
  });

  // Date overlap validation
  for (let i = 0; i < periods.length; i++) {
    for (let j = i + 1; j < periods.length; j++) {
      if (datesOverlap(
        periods[i].startDate,
        periods[i].endDate,
        periods[j].startDate,
        periods[j].endDate
      )) {
        alert("Date ranges cannot overlap between periods.");
        return;
      }
    }
  }

  const store = getStore("readwrite");
  store.put({
    id: getTeamKey("SBD Cut Off Times"),
    team: currentTeam,
    sheetName: "SBD Cut Off Times",
    periods,
    lastUpdated: new Date().toISOString()
  });

  document.getElementById("sbdModal").style.display = "none";
}

document.getElementById("sbdBtn").onclick = async () => {
  if (!requireTeamSelected()) return;
  const store = getStore("readonly");
  const req = store.get(getTeamKey("SBD Cut Off Times"));

  req.onsuccess = () => {
    const data = req.result || createEmptySbdData();
    renderSbdModal(data);
    document.getElementById("sbdModal").style.display = "flex";
  };
};

document.getElementById("saveSbdBtn").onclick = saveSbdData;
document.getElementById("closeSbdBtn").onclick =
  () => document.getElementById("sbdModal").style.display = "none";

function adjustMappingModalWidth(containerId, modalId) {
  const container = document.getElementById(containerId);
  const modal = document.querySelector(`#${modalId} .modal`);

  const blocks = container.querySelectorAll(".mapping-block:not(.placeholder)");
  const count = Math.max(1, Math.min(blocks.length, 3)); // 1–3 per row

  const blockWidth = 320;
  const gap = 12;

  const width = count * blockWidth + (count - 1) * gap + 32;
  modal.style.width = width + "px";
}

function renderTLModal(data = []) {
  const container = document.getElementById("tlContainer");
  container.innerHTML = "";

  if (!data.length) {
    addTLBlock();
    container.firstChild.classList.add("placeholder");
  } else {
    data.forEach(tl => addTLBlock(tl.name, tl.agents));
  }

  adjustMappingModalWidth("tlContainer", "tlModal");
}

function addTLBlock(name = "", agents = []) {
  const container = document.getElementById("tlContainer");

  const block = document.createElement("div");
  block.className = "mapping-block";

  block.innerHTML = `
    <h4>
      TL: <input value="${name}">
      <button onclick="this.closest('.mapping-block').remove()">✕</button>
    </h4>
    <div class="agents"></div>
    <button class="add-btn">+ Add Agent</button>
  `;

  const agentsDiv = block.querySelector(".agents");
  const addAgentBtn = block.querySelector(".add-btn");

  function addAgent(val = "") {
    const row = document.createElement("div");
    row.className = "mapping-row";
    row.innerHTML = `
      <input value="${val}">
      <button onclick="this.parentElement.remove()">✕</button>
    `;
    agentsDiv.appendChild(row);
  }

  agents.forEach(addAgent);
  addAgentBtn.onclick = () => addAgent();

  container.appendChild(block);
  adjustMappingModalWidth("tlContainer", "tlModal");
}

function renderMarketModal(data = []) {
  const container = document.getElementById("marketContainer");
  container.innerHTML = "";

  if (!data.length) {
    addMarketBlock();                   // real empty block
    container.firstChild.classList.add("placeholder");
  } else {
    data.forEach(m => addMarketBlock(m.name, m.countries));
  }
  adjustMappingModalWidth("marketContainer", "marketModal");
}

function addMarketBlock(name = "", countries = []) {
  const container = document.getElementById("marketContainer");

  const block = document.createElement("div");
  block.className = "mapping-block";

  block.innerHTML = `
    <h4>
      Market: <input value="${name}">
      <button onclick="this.closest('.mapping-block').remove()">✕</button>
    </h4>
    <div class="countries"></div>
    <button class="add-btn">+ Add Country</button>
  `;

  const div = block.querySelector(".countries");
  const addBtn = block.querySelector(".add-btn");

  function addCountry(val = "") {
    const row = document.createElement("div");
    row.className = "mapping-row";
    row.innerHTML = `
      <input value="${val}">
      <button onclick="this.parentElement.remove()">✕</button>
    `;
    div.appendChild(row);
  }

  countries.forEach(addCountry);
  addBtn.onclick = () => addCountry();

  container.appendChild(block);
  adjustMappingModalWidth("marketContainer", "marketModal");
}

function renderWorkgroupModal(data = []) {
  const container = document.getElementById("workgroupContainer");

  container.innerHTML = "";

  if (!data.length) {
    addWorkgroupBlock();
  } else {
    data.forEach(w =>
      addWorkgroupBlock(
        w.name,
        w.workgroups
      )
    );
  }
}

function addWorkgroupBlock(name = "", workgroups = []) {

  const container =
    document.getElementById("workgroupContainer");

  const card = document.createElement("div");
  card.className = "workgroup-team-card";

  card.innerHTML = `
    <div class="workgroup-col workgroup-team-name">
      <input
        type="text"
        placeholder="Workgroup Team Name"
        value="${name}"
      >
    </div>
  
    <div class="workgroup-col">
      <div class="workgroup-list"></div>
    </div>
  
    <div class="workgroup-col workgroup-actions">
  
      <button
        class="workgroup-add-btn"
        title="Add Workgroup"
      >
        +
      </button>
      
      <button
        class="workgroup-download-btn"
        title="Download Upload File"
      >
        ⭳
      </button>
      
      <button
        class="workgroup-delete-team-btn"
        title="Delete Team"
      >
        🗑
      </button>
  
    </div>
  `;

  const workgroupList =
    card.querySelector(".workgroup-list");

  const addBtn =
    card.querySelector(".workgroup-add-btn");
  
  const downloadBtn =
    card.querySelector(".workgroup-download-btn");
  
  const deleteBtn =
    card.querySelector(".workgroup-delete-team-btn");

  function addWorkgroupRow(value = "") {

    const row = document.createElement("div");
    row.className = "workgroup-item";

    row.innerHTML = `
      <input
        type="text"
        value="${value}"
        placeholder="Workgroup Name"
      >

      <button class="workgroup-remove-btn">
        ✕
      </button>
    `;

    row.querySelector(".workgroup-remove-btn")
      .onclick = () => {
        row.remove();
      };

    workgroupList.appendChild(row);
  }

  if (workgroups.length) {
    workgroups.forEach(addWorkgroupRow);
  } else {
    addWorkgroupRow();
  }

  addBtn.onclick = () => {
    addWorkgroupRow();
  };

  downloadBtn.onclick = async () => {
  
    const teamName =
      card.querySelector(
        ".workgroup-team-name input"
      ).value.trim();
  
    if (!teamName) {
      alert("Workgroup Team Name is blank.");
      return;
    }
  
    await downloadWorkgroupUploadExcel(teamName);
  };

  deleteBtn.onclick = () => {
    card.remove();
  };

  container.appendChild(card);
}

document.getElementById("saveTlBtn").onclick = () => {
  const blocks = document.querySelectorAll("#tlContainer .mapping-block");
  const data = [];

  blocks.forEach(b => {
    const name = b.querySelector("h4 input").value.trim();
    if (!name) return;

    const agents = [...b.querySelectorAll(".mapping-row input")]
      .map(i => i.value.trim())
      .filter(Boolean);

    data.push({ name, agents });
  });

  getStore("readwrite").put({
    id: getTeamKey("TL_MAP"),
    team: currentTeam,
    sheetName: "TL_MAP",
    data,
    lastUpdated: new Date().toISOString()
  });
  closeModal("tlModal");
};

document.getElementById("saveMarketBtn").onclick = () => {
  const blocks = document.querySelectorAll("#marketContainer .mapping-block");
  const data = [];

  blocks.forEach(b => {
    const name = b.querySelector("h4 input").value.trim();
    if (!name) return;

    const countries = [...b.querySelectorAll(".mapping-row input")]
      .map(i => i.value.trim())
      .filter(Boolean);

    data.push({ name, countries });
  });

  getStore("readwrite").put({
    id: getTeamKey("MARKET_MAP"),
    team: currentTeam,
    sheetName: "MARKET_MAP",
    data,
    lastUpdated: new Date().toISOString()
  });
  closeModal("marketModal");
};

document.getElementById("saveWorkgroupBtn").onclick = () => {

  const cards =
    document.querySelectorAll(
      "#workgroupContainer .workgroup-team-card"
    );

  const data = [];

  cards.forEach(card => {

    const name =
      card.querySelector(
        ".workgroup-team-name input"
      ).value.trim();

    if (!name) return;

    const workgroups =
      [...card.querySelectorAll(".workgroup-item input")]
        .map(i => i.value.trim())
        .filter(Boolean);

    data.push({
      name,
      workgroups
    });

  });

  getStore("readwrite").put({
    id: getTeamKey("WORKGROUP_MAP"),
    team: currentTeam,
    sheetName: "WORKGROUP_MAP",
    data,
    lastUpdated: new Date().toISOString()
  });

  closeModal("workgroupModal");
};

document.getElementById("tlBtn").onclick = async () => {
  if (!requireTeamSelected()) return;
  const req = getStore().get(getTeamKey("TL_MAP"));
  req.onsuccess = () => {
    renderTLModal(req.result?.data || []);
    openModal("tlModal");
  };
};

document.getElementById("marketBtn").onclick = async () => {
  if (!requireTeamSelected()) return;
  const req = getStore().get(getTeamKey("MARKET_MAP"));
  req.onsuccess = () => {
    renderMarketModal(req.result?.data || []);
    openModal("marketModal");
  };
};

document.getElementById("addTlBtn").onclick = () => {
  const container = document.getElementById("tlContainer");
  container.querySelector(".placeholder")?.remove();
  addTLBlock();
};

document.getElementById("addMarketBtn").onclick = () => {
  const container = document.getElementById("marketContainer");
  container.querySelector(".placeholder")?.remove();
  addMarketBlock();
};

document.getElementById("addWorkgroupBtn").onclick = () => {
  addWorkgroupBlock();
};

document.getElementById("closedCasesReportBtn")
  .addEventListener("click", () => {
    if (!requireTeamSelected()) return;
    openClosedCasesReport();
  });

document.getElementById("openRepairCasesReportBtn")
  .addEventListener("click", () => {
    if (!requireTeamSelected()) return;
    openOpenRepairCasesReport();
  });

document.getElementById("copySoBtn").addEventListener("click", async () => {

  if (!requireTeamSelected()) return;

  const output = await buildCopySOOrders();

  const lines = output
    ? output.split("\n").filter(l => l.trim() !== "")
    : [];

  // =====================================
  // CACHE VALID OUTPUT
  // =====================================

  validCSOOutput =
    lines.length
      ? lines.join("\n")
      : "No eligible cases found.";

  showingInvalidCSOs = false;

  // =====================================
  // DEFAULT VIEW = VALID CSOs
  // =====================================

  document.getElementById("soOutput").value =
    validCSOOutput;

  document.getElementById("soCount").textContent =
    `Total cases: ${lines.length}`;

  document.getElementById("soModalTitle").textContent =
    "Copy SO Orders Preview";

  // =====================================
  // INVALID BUTTON
  // =====================================

  const invalidBtn =
    document.getElementById("invalidCsoBtn");

  invalidBtn.style.display =
    invalidCSOEntries.length
      ? "inline-block"
      : "none";

  invalidBtn.textContent = "Invalid CSOs";
  invalidBtn.classList.remove("invalid-active");

  document.getElementById("soModal").style.display =
    "flex";
});

document.getElementById("copyTrackingBtn").addEventListener("click", async () => {
  if (!requireTeamSelected()) return;
  const output = await buildCopyTrackingURLs();

  const lines = output
    ? output.split("\n").filter(l => l.trim())
    : [];

  showingInvalidCSOs = false;

  document.getElementById("invalidCsoBtn")
    .style.display = "none";
  document.getElementById("invalidCsoBtn")
    .textContent = "Invalid CSOs";
  document.getElementById("invalidCsoBtn")
    .classList.remove("invalid-active");

  document.getElementById("soOutput").value =
    lines.length ? lines.join("\n") : "No eligible tracking URLs found.";

  document.getElementById("soCount").textContent =
    `Total cases: ${lines.length}`;

  document.getElementById("soModalTitle").textContent =
    "Copy Tracking URLs Preview";

  document.getElementById("soModal").style.display = "flex";
});

document.getElementById("closeModalBtn").addEventListener("click", () => {
  document.getElementById("soModal").style.display = "none";
});

document.getElementById("invalidCsoBtn")
  .addEventListener("click", () => {

    const btn =
      document.getElementById("invalidCsoBtn");

    // =====================================
    // SHOW INVALID CSOs
    // =====================================

    if (!showingInvalidCSOs) {

      const output = invalidCSOEntries.length
        ? invalidCSOEntries
            .map(x =>
              `${x.caseId},${x.cso || "Blank"}`
            )
            .join("\n")
        : "No invalid CSOs found.";

      document.getElementById("soOutput").value =
        output;

      document.getElementById("soCount").textContent =
        `Invalid CSOs: ${invalidCSOEntries.length}`;

      document.getElementById("soModalTitle").textContent =
        "Invalid CSO Cases";

      btn.textContent = "Valid CSOs";
      btn.classList.add("invalid-active");

      showingInvalidCSOs = true;

      return;
    }

    // =====================================
    // SHOW VALID CSOs
    // =====================================

    const validLines =
      validCSOOutput
        .split("\n")
        .filter(x => x.trim() !== "");

    document.getElementById("soOutput").value =
      validCSOOutput;

    document.getElementById("soCount").textContent =
      `Total cases: ${validLines.length}`;

    document.getElementById("soModalTitle").textContent =
      "Copy SO Orders Preview";

    btn.textContent = "Invalid CSOs";
    btn.classList.remove("invalid-active");

    showingInvalidCSOs = false;
  });

document.getElementById("copyToClipboardBtn").addEventListener("click", async () => {
  const text = document.getElementById("soOutput").value;
  await navigator.clipboard.writeText(text);
  alert("Copied to clipboard");
});

async function buildRepairCases() {
  const store = getStore("readonly");
  const all = await new Promise(r => {
    const q = store.getAll();
    q.onsuccess = () => r(q.result);
  });

  // 🔒 TEAM FILTER
  const teamData = all.filter(r => r.team === currentTeam);

  // 🔥 Load Closed Cases Data to exclude closed cases from Repair
  const closedData =
    teamData.find(x => x.sheetName === "Closed Cases Data")?.rows || [];
  
  const closedIds = new Set(
    closedData.map(r => r[0])   // Case ID
  );

  const existingRepair =
    teamData.find(x => x.sheetName === "Repair Cases")?.rows || [];
  
  const repairMap = new Map();
  // Key = Case ID, Value = row array
  existingRepair.forEach(r => {
    repairMap.set(r[0], r);
  });

  const dump = teamData.find(x => x.sheetName === "Dump")?.rows || [];
  const wo = teamData.find(x => x.sheetName === "WO")?.rows || [];
  const mo = teamData.find(x => x.sheetName === "MO")?.rows || [];
  const moItems = teamData.find(x => x.sheetName === "MO Items")?.rows || [];
  const so = teamData.find(x => x.sheetName === "SO")?.rows || [];
  const cso = teamData.find(x => x.sheetName === "CSO Status")?.rows || [];
  const delivery = teamData.find(x => x.sheetName === "Delivery Details")?.rows || [];
  const sorted = teamData.find(x => x.sheetName === "Sorted")?.rows || [];

  const tlMap = teamData.find(x => x.sheetName === "TL_MAP")?.data || [];
  const marketMap = teamData.find(x => x.sheetName === "MARKET_MAP")?.data || [];
  const sbdConfig =
    teamData.find(x => x.sheetName === "SBD Cut Off Times")?.periods
      ? teamData.find(x => x.sheetName === "SBD Cut Off Times")
      : null;

  const sortedTeamMap = new Map();
  const sortedWorkgroupMap = new Map();
  
  sorted.forEach(row => {
    const caseId = row[0];
  
    if (!caseId) return;
  
    sortedWorkgroupMap.set(caseId, row[4] || "");
    sortedTeamMap.set(caseId, row[5] || "");
  });

  const validCases = dump.filter(r =>
    ["parts shipped", "onsite solution", "offsite solution"]
      .includes(normalizeText(r[8])) &&
    !closedIds.has(r[0])        // 🚫 exclude already-closed cases
  );

  validCases.forEach(d => {
    const caseId = d[0];
    const calculatedResolution = getCalculatedResolution(
      caseId,
      wo,
      so,
      mo,
      d[8]   // fallback only if no orders exist
    );

    const firstOrder = getFirstOrderDate(caseId, wo, mo, so);

    const tl =
      tlMap.find(t =>
        t.agents.some(a => normalizeText(a) === normalizeText(d[9]))
      )?.name || "";

    const market =
      marketMap.find(m =>
        m.countries.some(c => normalizeText(c) === normalizeText(d[6]))
      )?.name || "";

    const assignedTeam = sortedTeamMap.get(caseId) || "";
    const assignedWorkgroup = sortedWorkgroupMap.get(caseId) || "";

    const onsiteRFC =
      calculatedResolution === "Onsite Solution"
        ? (wo.filter(w => w[0] === caseId)
            .sort((a, b) => new Date(b[6]) - new Date(a[6]))[0]?.[5] || "")
        : "Not Found";

    const csrRFC =
      calculatedResolution === "Parts Shipped"
        ? (getLatestMO(caseId, mo)?.[3] || "")
        : "Not Found";

    const benchRFC =
      calculatedResolution === "Offsite Solution"
        ? (cso.find(c => c[0] === caseId)?.[2] || "")
        : "Not Found";

    const dnap =
      calculatedResolution === "Offsite Solution" &&
      normalizeText(cso.find(c => c[0] === caseId)?.[4])
        .includes("product returned unrepaired to customer")
        ? "Yes"
        : "";

    let partNumber = "";
    let partName = "";
    
    if (calculatedResolution === "Parts Shipped") {
      const latestMO = getLatestMO(caseId, mo);
    
      if (latestMO) {
        const moNumber = latestMO[0];
    
        const item = moItems.find(r =>
          r[0] === moNumber &&
          normalizeText(r[1]).endsWith("- 1")
        );
    
        if (item) {
          partNumber = item[2] || "";
    
          if (item[3]) {
            partName = String(item[3] || "").trim();
          }
        }
      }
    }

    const newRow = [
      caseId,
      d[1], d[2], d[3], d[6], calculatedResolution, d[9], d[15],
      getCAGroup(d[2]),
      tl,
      calculateSBD(
        { createdOn: d[2], country: d[6] },
        firstOrder,
        sbdConfig
      ),
      onsiteRFC,
      csrRFC,
      benchRFC,
      market,
      onsiteRFC !== "Not Found"
        ? (
            wo.filter(w => w[0] === caseId)
              .sort((a, b) => new Date(b[6]) - new Date(a[6]))[0]
              ?.[9] || ""
          )
        : "",
      delivery.find(x => x[0] === caseId)?.[3] || "",
      partNumber,
      partName,
      d[16],
      d[17],
      d[10],
      dnap,
      assignedWorkgroup,
      assignedTeam
    ];
    
    // 🔥 UPSERT: overwrite if exists, else add
    repairMap.set(caseId, newRow);
  });

  const finalRows = [...repairMap.values()];
  
  // Update UI
  const dt = dataTablesMap["Repair Cases"];
  dt.clear();
  finalRows.forEach(r => dt.row.add(["", ...r]));
  dt.draw(false);
  
  // Save to DB
  getStore("readwrite").put({
    id: getTeamKey("Repair Cases"),
    team: currentTeam,
    sheetName: "Repair Cases",
    rows: finalRows,
    lastUpdated: new Date().toISOString()
  });
  
}

async function buildClosedCasesReport() {
  const store = getStore("readonly");
  const all = await new Promise(r => {
    const q = store.getAll();
    q.onsuccess = () => r(q.result);
  });

  // 🔒 TEAM FILTER
  const teamData = all.filter(r => r.team === currentTeam);

  const existingClosed =
    teamData.find(x => x.sheetName === "Closed Cases Data")?.rows || [];
  
  const closedMap = new Map();
  // Key = Case ID, Value = row
  existingClosed.forEach(r => {
    closedMap.set(r[0], r);
  });

  const newlyClosedIds = new Set();

  const closed = teamData.find(x => x.sheetName === "Closed Cases")?.rows || [];
  const repair = teamData.find(x => x.sheetName === "Repair Cases")?.rows || [];
  const tlMap = teamData.find(x => x.sheetName === "TL_MAP")?.data || [];
  const marketMap = teamData.find(x => x.sheetName === "MARKET_MAP")?.data || [];
  const workgroupMap = teamData.find(x => x.sheetName === "WORKGROUP_MAP")?.data || [];

  const rows = [];

  closed.forEach(c => {

    const repairRow = repair.find(r => r[0] === c[0]);

    let closedBy = c[3];
    if (closedBy === "# CrmWebJobUser-Prod") closedBy = "CRM Auto Closed";
    else if (
      ["# MSFT-ServiceSystemAdmin",
       "# CrmEEGUser-Prod",
       "# MSFT-ServiceSystemAdminDev",
       "SYSTEM"].includes(closedBy)
    ) closedBy = c[9];

    // 🔥 Skip if already exists (immutable)
    if (closedMap.has(c[0])) return;

    const caseOwner = c[9];   // Owner
    const country = c[10];     // Country
    const ownerNorm = normalizeText(caseOwner);
    
    const tl =
      tlMap.find(t =>
        t.agents.some(a => normalizeText(a) === ownerNorm)
      )?.name || "Unassigned";
    
    const market =
      marketMap.find(m =>
        m.countries.some(cn =>
          normalizeText(cn) === normalizeText(country)
        )
      )?.name || "Unassigned";

    const workgroup = c[12] || "";

    const assignedTeam =
      workgroupMap.find(team =>
        team.workgroups.some(w =>
          normalizeText(w) === normalizeText(workgroup)
        )
      )?.name || "";  

    closedMap.set(c[0], [
      c[0],
      c[1],          // ✅ Customer Name (Primary Contact)
      c[2],          // Created On
      c[7],          // Created By
      c[3],          // Modified By
      c[4],          // Modified On
      c[5],          // Case Closed Date
      closedBy,
      c[10],          // Country
      c[6],          // Case Resolution Code
      c[9],          // Case Owner
      c[11],         // OTC Code
      tl,            // ✅ TL (from TL modal)
      repairRow?.[10] || "",   // SBD (unchanged)
      market,        // ✅ Market (from Market modal)
      workgroup,     // Workgroup
      assignedTeam   // Team assignment as per Workgroup
    ]);
    
    newlyClosedIds.add(c[0]);
  });

  // ===== Retention cleanup: keep only last 6 months =====
  const now = new Date();
  const cutoff = new Date(now.getFullYear(), now.getMonth() - 6, 1);
  
  closedMap.forEach((row, caseId) => {
    const closedDate = new Date(row[6]); // Case Closed Date
    if (closedDate < cutoff) {
      closedMap.delete(caseId);
    }
  });

  const finalClosedRows = [...closedMap.values()];

  // Update UI
  const dt = dataTablesMap["Closed Cases Data"];
  dt.clear();
  finalClosedRows.forEach(r => dt.row.add(["", ...r]));
  dt.draw(false);
  
  // Save to DB
  const write = getStore("readwrite");
  write.put({
    id: getTeamKey("Closed Cases Data"),
    team: currentTeam,
    sheetName: "Closed Cases Data",
    rows: finalClosedRows,
    lastUpdated: new Date().toISOString()
  });

  const remaining = repair.filter(
    r => !newlyClosedIds.has(r[0])
  );
  
  write.put({
    id: getTeamKey("Repair Cases"),
    team: currentTeam,
    sheetName: "Repair Cases",
    rows: remaining,
    lastUpdated: new Date().toISOString()
  });
}

document.getElementById("processRepairBtn")
  .addEventListener("click", async () => {

    if (!requireTeamSelected()) return;

    startProgressContext("Building Repair Cases...");

    const store = getStore("readonly");
    const all = await new Promise(r => {
      const q = store.getAll();
      q.onsuccess = () => r(q.result);
    });

    const teamData = all.filter(r => r.team === currentTeam);

    const dump = teamData.find(x => x.sheetName === "Dump")?.rows || [];
    const validCases = dump.filter(r =>
      ["parts shipped", "onsite solution", "offsite solution"]
        .includes(normalizeText(r[8]))
    );

    let processed = 0;
    const total = validCases.length;

    for (const _ of validCases) {
      processed++;
      updateProgressContext(
        processed,
        total,
        `Processing Repair Cases (${processed}/${total})`
      );
      await new Promise(requestAnimationFrame);
    }

    await buildRepairCases();
    await buildClosedCasesReport();

    endProgressContext("Repair & Closed Case processing completed");
  });

document.addEventListener('DOMContentLoaded', async () => {
  await openDB();
  initEmptyTables();
  await renderTeamDropdown();
  
  if (lastTeam) {
    await setCurrentTeam(lastTeam);   // 🔥 handles dropdown render internally
  } else {
    await renderTeamDropdown();
    document.getElementById("teamToggle").textContent = "Select Team";
  }
  if (!lastTeam) {
    document.querySelectorAll(
      ".action-bar button, #processBtn, #workgroupBtn"
    ).forEach(btn => btn.disabled = true);
  }
  

  // IMPORTANT: wait for DataTables to fully initialize
  requestAnimationFrame(() => {
    $('#ccSummaryTable').DataTable({
      paging: false,
      searching: false,
      info: false,
      ordering: false,
      dom: 't',
    
      // 🔥 THIS LINE STOPS odd/even CLASSES COMPLETELY
      stripeClasses: []
    });
    
    $('#ccDrillTable').DataTable({
      paging: false,
      searching: false,
      info: false,
      ordering: false,
      dom: 't'
    });
  });
  updateProcessButtonState();
});

document.getElementById("downloadUploadExcelBtn")
  .addEventListener("click", downloadUploadExcel);

document.getElementById("downloadActiveSheetBtn")
  .addEventListener("click", downloadActiveSheet);

document.getElementById("workgroupBtn").onclick = async () => {
  if (!requireTeamSelected()) return;

  const req = getStore().get(getTeamKey("WORKGROUP_MAP"));

  req.onsuccess = () => {
    renderWorkgroupModal(req.result?.data || []);
    openModal("workgroupModal");
  };
};

document.addEventListener("keydown", (e) => {
  if (e.key !== "Enter") return;

  const overlay = document.getElementById("progressOverlay");
  const confirmBtn = document.getElementById("overlayConfirmBtn");

  if (
    overlay.style.display === "flex" &&
    confirmBtn.style.display !== "none"
  ) {
    e.preventDefault();
    confirmBtn.click();
  }
});

// ===============================
// IMPORT PROGRESS OVERLAY HELPERS
// ===============================

function showImportOverlay(status = "Processing...") {
  const overlay = document.getElementById("progressOverlay");
  const statusText = document.getElementById("overlayStatusText");
  const bar = document.getElementById("overlayProgressBar");
  const percentText = document.getElementById("overlayProgressText");
  const confirmBtn = document.getElementById("overlayConfirmBtn");

  overlay.style.display = "flex";
  overlay.classList.remove("progress-complete");

  statusText.textContent = status;
  bar.style.width = "0%";
  percentText.textContent = "0%";
  confirmBtn.style.display = "none";
}

function updateImportProgress(percent, status) {
  const bar = document.getElementById("overlayProgressBar");
  const percentText = document.getElementById("overlayProgressText");
  const statusText = document.getElementById("overlayStatusText");

  bar.style.width = percent + "%";
  percentText.textContent = percent + "%";

  if (status) {
    statusText.textContent = status;
  }
}

function completeImportOverlay(message = "Import Complete") {
  const overlay = document.getElementById("progressOverlay");
  const confirmBtn = document.getElementById("overlayConfirmBtn");
  const statusText = document.getElementById("overlayStatusText");

  overlay.classList.add("progress-complete");
  statusText.textContent = message;
  confirmBtn.style.display = "inline-block";

  confirmBtn.onclick = () => {
    overlay.style.display = "none";
  };
}

// ===============================
// EXPORT BACKUP
// ===============================

document.getElementById("exportBackupBtn").addEventListener("click", async () => {
  if (!requireTeamSelected()) return;

  const store = getStore("readonly");
  const all = await new Promise(res => {
    const req = store.getAll();
    req.onsuccess = () => res(req.result);
  });

  const teamData = all.filter(r => r.team === currentTeam);

  const backup = {
    team: currentTeam,
    exportedAt: new Date().toISOString(),
    data: teamData
  };

  const today = new Date();
  const dd = String(today.getDate()).padStart(2, "0");
  const mm = String(today.getMonth() + 1).padStart(2, "0");
  const yyyy = today.getFullYear();

  const fileName = `${currentTeam}_Backup_${dd}-${mm}-${yyyy}.json`;

  const blob = new Blob(
    [JSON.stringify(backup, null, 2)],
    { type: "application/json" }
  );

  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = fileName;
  a.click();

  URL.revokeObjectURL(a.href);
});

async function putRecord(record) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);

    const req = store.put(record);

    req.onsuccess = () => resolve();
    req.onerror = (e) => reject(e.target.error);
  });
}

// ===============================
// IMPORT BACKUP (STRICT REPLACE)
// ===============================

document.getElementById("importBackupBtn").addEventListener("click", () => {
  document.getElementById("importBackupInput").click();
});

document.getElementById("importBackupInput")
  .addEventListener("change", async (e) => {

  if (!requireTeamSelected()) {
    e.target.value = "";
    return;
  }

  const file = e.target.files[0];
  if (!file) return;

  try {
    const text = await file.text();
    const parsed = JSON.parse(text);

    // 1️⃣ Validate structure
    if (!parsed.team || !Array.isArray(parsed.data)) {
      alert("Invalid backup file.");
      e.target.value = "";
      return;
    }

    // 2️⃣ Validate team match
    if (parsed.team !== currentTeam) {
      alert(`Backup belongs to team "${parsed.team}".\n\nSelect correct team before importing.`);
      e.target.value = "";
      return;
    }

    if (!confirm(`This will FULLY REPLACE all data for team "${currentTeam}". Continue?`)) {
      e.target.value = "";
      return;
    }

    // ===============================
    // SIMPLE IMPORT WITH OVERLAY
    // ===============================
    
    showImportOverlay("Restoring backup...");
    
    const totalRecords = parsed.data.length;
    let processedRecords = 0;
    
    // Restore all records (sheet-level progress)
    for (const record of parsed.data) {
    
      if (!record.sheetName) continue;
    
      await putRecord({
        ...record,
        id: getTeamKey(record.sheetName),
        team: currentTeam,
        lastUpdated: record.lastUpdated || new Date().toISOString()
      });
    
      processedRecords++;
    
      const percent = Math.round((processedRecords / totalRecords) * 100);
    
      updateImportProgress(
        percent,
        `Restoring ${record.sheetName} (${processedRecords}/${totalRecords})`
      );
    }
    
    // Finish
    completeImportOverlay("Backup imported successfully");
    
    // Refresh UI
    await renderTeamDropdown();
    
    Object.values(dataTablesMap).forEach(dt => {
      dt.clear().draw(false);
    });
    
    loadDataFromDB();

  } catch (err) {
    console.error("Import failed:", err);
    alert("Import failed. Check console for details.");
  }

  e.target.value = "";
});

/* =========================================================
   DOWNLOAD UPLOAD EXCEL (CORRECTED FOR YOUR ARCHITECTURE)
========================================================= */

async function downloadUploadExcel() {
  if (!requireTeamSelected()) return;

  try {
    const store = getStore("readonly");
    const allData = await new Promise(res => {
      const req = store.getAll();
      req.onsuccess = () => res(req.result);
    });

    const teamData = allData.filter(r => r.team === currentTeam);

    const dump =
      teamData.find(r => r.sheetName === "Dump")?.rows || [];

    const repairCases =
      teamData.find(r => r.sheetName === "Repair Cases")?.rows || [];

    const closedCases =
      teamData.find(r => r.sheetName === "Closed Cases Data")?.rows || [];

    if (!dump.length) {
      alert("Dump sheet data not available.");
      return;
    }

    /* -----------------------------------------
       STEP 1 — Build Repair Case ID List
    ------------------------------------------*/

    const caseIdx =
      TABLE_SCHEMAS["Dump"].indexOf("Case ID");

    const resolutionIdx =
      TABLE_SCHEMAS["Dump"].indexOf("Case Resolution Code");

    const repairCaseIds = new Set();

    dump.forEach(row => {
      const resolution = row[resolutionIdx];
      if (isRepairResolution(resolution)) {
        repairCaseIds.add(row[caseIdx]);
      }
    });

    /* -----------------------------------------
       STEP 2 — Filter Repair Cases
    ------------------------------------------*/

    const repairCaseIdIdx =
      TABLE_SCHEMAS["Repair Cases"].indexOf("Case ID");

    const filteredRepairCases =
      repairCases.filter(row =>
        repairCaseIds.has(row[repairCaseIdIdx])
      );

    /* -----------------------------------------
       STEP 3 — Build Excel
    ------------------------------------------*/

    const wb = XLSX.utils.book_new();

    // Sheet 1 — Repair Cases
    const repairSheet = [
      TABLE_SCHEMAS["Repair Cases"],
      ...filteredRepairCases
    ];

    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet(repairSheet),
      "Repair Cases"
    );

    // Sheet 2 — Closed Cases Data
    const closedSheet = [
      TABLE_SCHEMAS["Closed Cases Data"],
      ...closedCases
    ];

    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet(closedSheet),
      "Closed Cases Data"
    );

    /* -----------------------------------------
       STEP 4 — File Name
    ------------------------------------------*/

    const today = new Date();
    const dd = String(today.getDate()).padStart(2, "0");
    const mm = String(today.getMonth() + 1).padStart(2, "0");
    const yyyy = today.getFullYear();

    const fileName =
      `KCI_Upload_File_${currentTeam}_${dd}-${mm}-${yyyy}.xlsx`;

    XLSX.writeFile(wb, fileName);

  } catch (err) {
    console.error("Download Upload Excel failed:", err);
    alert("Failed to generate Excel file.");
  }
}

async function downloadWorkgroupUploadExcel(teamName) {

  try {

    const store = getStore("readonly");

    const allData = await new Promise(res => {
      const req = store.getAll();
      req.onsuccess = () => res(req.result);
    });

    const teamData =
      allData.filter(r => r.team === currentTeam);

    const sorted =
      teamData.find(r => r.sheetName === "Sorted")?.rows || [];

    const repairCases =
      teamData.find(r => r.sheetName === "Repair Cases")?.rows || [];

    const closedCases =
      teamData.find(r => r.sheetName === "Closed Cases Data")?.rows || [];

    const sortedCaseIdx =
      TABLE_SCHEMAS["Sorted"].indexOf("Case ID");

    const sortedTeamIdx =
      TABLE_SCHEMAS["Sorted"].indexOf("Team");

    const repairCaseIdIdx =
      TABLE_SCHEMAS["Repair Cases"].indexOf("Case ID");

    const closedTeamIdx =
      TABLE_SCHEMAS["Closed Cases Data"].indexOf("Team");

    const matchingCaseIds = new Set();

    sorted.forEach(row => {

      if (
        normalizeText(row[sortedTeamIdx]) ===
        normalizeText(teamName)
      ) {
        matchingCaseIds.add(
          row[sortedCaseIdx]
        );
      }

    });

    const filteredRepairCases =
      repairCases.filter(row =>
        matchingCaseIds.has(
          row[repairCaseIdIdx]
        )
      );

    const filteredClosedCases =
      closedCases.filter(row =>
        normalizeText(
          row[closedTeamIdx]
        ) === normalizeText(teamName)
      );

    const wb = XLSX.utils.book_new();

    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet([
        TABLE_SCHEMAS["Repair Cases"],
        ...filteredRepairCases
      ]),
      "Repair Cases"
    );

    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet([
        TABLE_SCHEMAS["Closed Cases Data"],
        ...filteredClosedCases
      ]),
      "Closed Cases Data"
    );

    const today = new Date();

    const dd =
      String(today.getDate()).padStart(2, "0");

    const mm =
      String(today.getMonth() + 1).padStart(2, "0");

    const yyyy =
      today.getFullYear();

    const safeTeamName =
      teamName.replace(
        /[\\/:*?"<>|]/g,
        "_"
      );

    XLSX.writeFile(
      wb,
      `KCI_Upload_File_${safeTeamName}_${dd}-${mm}-${yyyy}.xlsx`
    );

  } catch (err) {

    console.error(err);

    alert(
      "Failed to generate workgroup upload file."
    );

  }
}

async function downloadActiveSheet() {

  if (!requireTeamSelected()) return;

  try {

    // ----------------------------------
    // Find active sheet tab
    // ----------------------------------

    const activeTab =
      document.querySelector(".sheet-tab.active");

    if (!activeTab) {
      alert("No active sheet selected.");
      return;
    }

    const sheetName =
      activeTab.textContent.trim();

    // ----------------------------------
    // Load sheet data from IndexedDB
    // ----------------------------------

    const record = await new Promise(resolve => {

      const req =
        getStore("readonly")
          .get(getTeamKey(sheetName));

      req.onsuccess = () =>
        resolve(req.result);

      req.onerror = () =>
        resolve(null);

    });

    if (!record) {
      alert(`No data found for "${sheetName}"`);
      return;
    }

    const rows = record.rows || [];

    // ----------------------------------
    // Create workbook
    // ----------------------------------

    const wb = XLSX.utils.book_new();

    const sheetData = [
      TABLE_SCHEMAS[sheetName],
      ...rows
    ];

    const ws =
      XLSX.utils.aoa_to_sheet(sheetData);

    XLSX.utils.book_append_sheet(
      wb,
      ws,
      sheetName
    );

    // ----------------------------------
    // Build filename
    // ----------------------------------

    const today = new Date();

    const dd =
      String(today.getDate()).padStart(2, "0");

    const mm =
      String(today.getMonth() + 1).padStart(2, "0");

    const yyyy =
      today.getFullYear();

    const safeSheetName =
      sheetName.replace(/[\\/:*?"<>|]/g, "_");

    const fileName =
      `${currentTeam}_${safeSheetName}_${dd}-${mm}-${yyyy}.xlsx`;

    // ----------------------------------
    // Download
    // ----------------------------------

    XLSX.writeFile(wb, fileName);

  } catch (err) {

    console.error(err);

    alert(
      "Failed to download active sheet."
    );
  }
}
