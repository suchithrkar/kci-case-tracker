/* ======================================================
   ADMIN.JS — CLEAN FINAL VERSION
   Contains:
   - Initialization & Roles
   - Team Management
   - Users Tab
   - Excel Upload + Backup
   - Stats Engine
   - Audit Modal
   ===================================================== */

/* =====================================================
   SINGLE IMPORT BLOCK (Do NOT add any more imports)
   ===================================================== */
import {
  auth,
  onAuthStateChanged,
  db,
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  onSnapshot
} from "./js/firebase.js";

import { isPrimary, isSecondary, toggleTheme } from "./js/userProfile.js";
import { showPopup } from "./js/utils.js";
import { cleanupDailyReports } from "./js/utils.js";

// Tooltip edge protection for admin page
document.addEventListener("mouseover", (e) => {
  const cell = e.target.closest("th");
  if (!cell) return;

  const tooltip = cell.querySelector(".tooltip");
  if (!tooltip) return;

  tooltip.classList.remove("align-left", "align-right");

  const rect = tooltip.getBoundingClientRect();
  const padding = 8;

  if (rect.right > window.innerWidth - padding) {
    tooltip.classList.add("align-right");
  } else if (rect.left < padding) {
    tooltip.classList.add("align-left");
  }
});


// ================================================
// GLOBAL STATE FOR EXCEL IMPORT
// ================================================
const excelState = {
  teamId: null,
  file: null,
  rawRows: [],
  excelCases: [],
  firestoreCases: [],
  diff: { new: [], updated: [], deleted: [] }
};

let processing = false;


// Quick DOM helpers
const $ = (id) => document.getElementById(id);

/* =========================================================
   ADMIN — CUSTOM SELECT ENGINE (Tracker-aligned)
   ========================================================= */
function initCustomSelect(root) {
  const trigger = root.querySelector(".custom-select-trigger");
  const options = root.querySelector(".custom-options");

  if (!trigger || !options) return;

  let portal = null;

  trigger.addEventListener("click", (e) => {
    e.stopPropagation();
    closeAllCustomSelects();

    const rect = trigger.getBoundingClientRect();

    portal = options;
    portal.dataset.portalFor = root.id;

      // ✅ Mark dropdowns for scroll styling (portal-safe)
      portal.classList.remove(
        "team-modal-dropdown",
        "admin-team-dropdown"
      );
      
      // Create / Manage Team modal selects
      if (root.id === "newTeamTimezone" || root.id === "newTeamResetHour") {
        portal.classList.add("team-modal-dropdown");
      }
      
      // Admin Users → Team dropdown
      if (root.classList.contains("user-team-dd")) {
        portal.classList.add("admin-team-dropdown");
      }
      
      // Admin Stats → Team selector
      if (root.classList.contains("stats-team-select")) {
        portal.classList.add("admin-team-dropdown");
      }
   
    portal.style.position = "fixed";
    portal.style.top = `${rect.bottom}px`;
    portal.style.left = `${rect.left}px`;
    portal.style.width = `${rect.width}px`;
    portal.style.zIndex = 5000;
    portal.style.display = "block";

    document.body.appendChild(portal);
    root.classList.add("open");
  });

  options.querySelectorAll(".custom-option").forEach(opt => {
    opt.addEventListener("click", () => {
      trigger.textContent = opt.textContent;
      root.dataset.value = opt.dataset.value;

      closePortal();
      root.dispatchEvent(new Event("change"));
    });
  });

  function closePortal() {
    if (portal) {
      portal.style.display = "none";
      root.appendChild(portal);
      portal = null;
    }
    root.classList.remove("open");
  }

  document.addEventListener("click", closePortal);
}

function closeAllCustomSelects() {
  document.querySelectorAll(".custom-select.open").forEach(root => {
    const options = document.querySelector(
      ".custom-options[data-portal-for='" + root.id + "']"
    );

    if (options) {
      options.style.display = "none";
      root.appendChild(options);
      options.removeAttribute("data-portal-for");
    }

    root.classList.remove("open");
  });
}

// Close dropdowns when clicking outside
document.addEventListener("click", closeAllCustomSelects);


// Update text in the progress box
function updateProgress(msg) {
  const box = $("excelProgress");
  box.style.display = "block";
  box.textContent += msg + "\n";
   box.scrollTop = box.scrollHeight;
}
function clearProgress() {
  const box = $("excelProgress");
  box.style.display = "none";
  box.textContent = "";
}



/* ============================================================
   GLOBAL DOM REFERENCES
   ============================================================ */
const el = {
  adminUserName:   document.getElementById("adminUserName"),
  adminTheme:      document.getElementById("adminTheme"),
  btnUpdateData:   document.getElementById("btnUpdateData"),
  btnCreateTeam:   document.getElementById("btnCreateTeam"),
  btnGotoTracker:  document.getElementById("btnGotoTracker"),
  btnAdminLogout:  document.getElementById("btnAdminLogout"),

  tabUsers:        document.getElementById("tabUsers"),
  tabStats:        document.getElementById("tabStats"),

  sectionUsers:    document.getElementById("sectionUsers"),
  sectionStats:    document.getElementById("sectionStats"),
};

const teamList            = document.getElementById("teamList");
const newTeamName         = document.getElementById("newTeamName");
const btnTeamCreate       = document.getElementById("btnTeamCreate");
const btnTeamClose        = document.getElementById("btnTeamClose");
const btnTeamDone         = document.getElementById("btnTeamDone");
const modalCreateTeam     = document.getElementById("modalCreateTeam");
const teamModalTitle = document.getElementById("teamModalTitle");

// Team reset settings inputs
const newTeamTimezone = document.getElementById("newTeamTimezone");
const newTeamResetHour = document.getElementById("newTeamResetHour");
const btnTeamCancel = document.getElementById("btnTeamCancel");

const updateTeamList      = document.getElementById("updateTeamList");
const modalUpdateData     = document.getElementById("modalUpdateData");
const btnUpdateClose      = document.getElementById("btnUpdateClose");
const btnUpdateDone       = document.getElementById("btnUpdateDone");

$("excelInput").onchange = async (e) => {
  const file = e.target.files[0];
  excelState.file = file;

  if (!file) {
    $("selectedFileName").textContent = "No file selected";
    return;
  }

  $("selectedFileName").textContent = file.name;
   $("btnPreviewChanges").disabled = true;
  clearProgress();
  updateProgress("Reading file...");

  // PARSE FILE
  await parseExcelFile(file);

  validateReadyState();
};

// ============================================================
// RESET CREATE / UPDATE TEAM MODAL STATE
// ============================================================
function resetTeamModalState() {
  // Clear inputs
  newTeamName.value = "";
   newTeamTimezone.dataset.value = "";
   newTeamTimezone.querySelector(".custom-select-trigger").textContent =
     "Select Team Timezone";
   
   newTeamResetHour.dataset.value = "";
   newTeamResetHour.querySelector(".custom-select-trigger").textContent =
     "Reset Time";

  // Restore title
  teamModalTitle.textContent = "Create New Team";

  // Restore button state
  btnTeamCreate.textContent = "Create Team";

  // Restore default handler
  btnTeamCreate.onclick = createTeamHandler;
}


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

// ======================================================
// Helper — Convert 0-based column index to Excel letter
// Example: 0 → A, 25 → Z, 26 → AA, 27 → AB, 37 → AL
// ======================================================
function excelColLetter(index) {
  let col = "";
  let n = index + 1; // convert 0-based to 1-based

  while (n > 0) {
    const rem = (n - 1) % 26;
    col = String.fromCharCode(65 + rem) + col;
    n = Math.floor((n - 1) / 26);
  }

  return col;
}

// ======================================================
// PARSE EXCEL FILE (fixed + improved)
// ======================================================
async function parseExcelFile(file) {
  return new Promise((resolve) => {
    const reader = new FileReader();

    reader.onload = (evt) => {
      const data = evt.target.result;
      const wb = XLSX.read(data, { type: "binary" });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 });

      // ======================================================
      // OPTIONAL SAFETY GUARD — EXCEL HEADER VALIDATION
      // ======================================================
      
      // Expected headers by position (0-based index)
      // We only check for KEY PHRASES, not full header text
      const expectedHeaders = {
        0: "case id",
        1: "full name",                 // matches "Full Name (Primary Contact)"
        2: "created",                   // matches "Created On"
        3: "created by",
        6: "country",
        8: "resolution",                // matches "Case Resolution Code"
        9: "owning user",               // ✅ matches "Full Name (Owning User) (User)"
        15: "otc",                      // OTC Code
        18: "ca group",
        21: "tl",
        30: "sbd",
        34: "onsite",
        35: "csr",
        36: "bench",
        37: "market"
      };

      const headerRow = rows[0] || [];
      const headerErrors = [];
      
      Object.entries(expectedHeaders).forEach(([index, expected]) => {
        const actual = String(headerRow[index] || "").trim();
      
        if (!actual || !actual.toLowerCase().includes(expected.toLowerCase())) {
          headerErrors.push(
            `Column ${excelColLetter(Number(index))}: expected "${expected}", found "${actual || "EMPTY"}"`
          );
        }
      });
      
      if (headerErrors.length > 0) {
        clearProgress();
      
         alert(
           "Excel format validation failed.\n\n" +
           headerErrors.join("\n") +
           "\n\nPlease upload the correct Excel template."
         );
      
        excelState.excelCases = [];
        excelState.rawRows = [];
      
        resolve(); // stop parsing
        return;
      }
       
      excelState.rawRows = rows;

      updateProgress("Excel loaded. Processing rows...");

      const parsed = [];

      for (let i = 1; i < rows.length; i++) {
        const r = rows[i];
        if (!r || !r[0]) continue;

        const id = String(r[0]).trim();
        if (!id) continue;

        parsed.push({
           id,                                                   // Col A
           customerName: String(r[1] || "").trim(),              // Col B
           createdOn: excelToDate(r[2]),                         // Col C
           createdBy: String(r[3] || "").trim(),                 // Col D
           country: String(r[6] || "").trim(),                   // Col G
           caseResolutionCode: String(r[8] || "").trim(),        // Col I
           caseOwner: String(r[9] || "").trim(),                 // Col J

           // ✅ NEW COLUMN — OTC Code
           otcCode: String(r[15] || "").trim(),                  // Col P

           // ⬇️ ALL BELOW SHIFTED BY +1
           caGroup: String(r[18] || "").trim(),                  // Col S
           tl: String(r[21] || "").trim(),                       // Col V
           sbd: String(r[30] || "").trim(),                      // Col AE
         
           onsiteRFC: String(r[34] || "").trim(),                // Col AI
           csrRFC:    String(r[35] || "").trim(),                // Col AJ
           benchRFC:  String(r[36] || "").trim(),                // Col AK

           // ✅ NEW LAST COLUMN — Market
           market: String(r[37] || "").trim(),                   // Col AL
         
           excelOrder: i
         });
      }

      excelState.excelCases = parsed;

      updateProgress(`Excel loaded.\nTotal valid rows: ${parsed.length}`);
// Do NOT call validateReadyState() here.
// It is called AFTER parseExcelFile() in the onchange handler.


      resolve();
    };

    reader.readAsBinaryString(file);
  });
}

async function parseBackupFile(data) {
  let backup;

  // v1 backup (array)
  if (Array.isArray(data)) {
    backup = {
      version: 1,
      teamId: null,
      cases: data
    };
  }
  // v2 backup (object)
  else if (data.version === 2 && Array.isArray(data.cases)) {
    backup = data;
  }
  else {
    showPopup("Invalid backup format.");
    return;
  }

  // 🔒 TEAM SAFETY CHECK
  if (backup.teamId && backup.teamId !== excelState.teamId) {
    showPopup(
      `This backup belongs to another team.\n\nBackup Team: ${backup.teamId}`
    );
    return;
  }

  updateProgress(`Backup loaded (v${backup.version}).`);
  updateProgress(`Cases in backup: ${backup.cases.length}`);

  // Normalize to Excel engine
  excelState.excelCases = backup.cases;
  // 🔧 Backup import needs full overwrite capability.
  // Mark backup imports so we can force-update cases later.
  excelState.isBackupImport = true;
}

// ======================================================
// ENABLE/DISABLE PREVIEW BUTTON BASED ON STATE
// ======================================================
function validateReadyState() {
  const ready =
    excelState.teamId &&
    excelState.file &&
    excelState.excelCases.length > 0;

  $("btnPreviewChanges").disabled = !ready;
}


// ======================================================
// COMPARE EXCEL CASES vs FIRESTORE CASES
// ======================================================
function computeDiff() {
  const excelMap = new Map();
  excelState.excelCases.forEach(c => excelMap.set(c.id, c));

  const fsMap = new Map();
  excelState.firestoreCases.forEach(c => fsMap.set(c.id, c));

  const diff = {
    new: [],
    updated: [],
    deleted: []
  };

  // Detect new + updated
  for (const ex of excelState.excelCases) {
     const fs = fsMap.get(ex.id);
   
     if (!fs) {
       diff.new.push(ex);
       continue;
     }
   
     // 🔥 BACKUP FULL RESTORE MODE:
     // Treat ALL existing cases as updated
     if (excelState.isBackupImport && $("overwriteUserActions")?.checked) {
       diff.updated.push(ex);
       continue;
     }
   
     const changed =
       ex.customerName !== fs.customerName ||
       ex.createdOn !== fs.createdOn ||
       ex.createdBy !== fs.createdBy ||
       ex.country !== fs.country ||
       ex.caseResolutionCode !== fs.caseResolutionCode ||
       ex.caseOwner !== fs.caseOwner ||
       ex.otcCode !== fs.otcCode ||
       ex.caGroup !== fs.caGroup ||
       ex.tl !== fs.tl ||
       ex.sbd !== fs.sbd ||
       ex.onsiteRFC !== fs.onsiteRFC ||
       ex.csrRFC !== fs.csrRFC ||
       ex.benchRFC !== fs.benchRFC ||
       ex.market !== fs.market ||
       ex.excelOrder !== fs.excelOrder;
   
     if (changed) diff.updated.push(ex);
   }

  // Detect deleted
  for (const fs of excelState.firestoreCases) {
    if (!excelMap.has(fs.id)) diff.deleted.push(fs);
  }

  excelState.diff = diff;
}

async function loadFirestoreCasesForTeam(teamId) {
  updateProgress("Loading existing Firestore cases...");

  const q = query(
    collection(db, "cases"),
    where("teamId", "==", teamId)
  );

  let snap;
try {
  snap = await getDocs(q);
} catch (err) {
  console.error("Firestore read failed:", err);
  showPopup("Could not load Firestore cases. Try again in 1–2 seconds.");
  return;
}


  excelState.firestoreCases = snap.docs.map(d => ({
    id: d.id,
    ...d.data()
  }));
}



// ======================================================
// PREVIEW CHANGES MODAL
// ======================================================
function openPreviewModal() {
  const d = excelState.diff;

  $("previewCounts").innerHTML = `
    <strong>New Cases:</strong> ${d.new.length}<br>
    <strong>Updated Cases:</strong> ${d.updated.length}<br>
    <strong>Deleted Cases:</strong> ${d.deleted.length}
  `;

  // show preview section
  $("previewSection").style.display = "block";

  // show checkbox only when needed
  $("deleteCheckboxWrap").style.display = d.deleted.length > 0 ? "block" : "none";

  $("allowDeletion").checked = false;
  $("btnConfirmImport").disabled = (d.deleted.length > 0);

  if (d.deleted.length > 0) {
    $("allowDeletion").onchange = () => {
      $("btnConfirmImport").disabled = !$("allowDeletion").checked;
    };
  } else {
    $("btnConfirmImport").disabled = false;
  }
}

$("btnPreviewCancel").onclick = () => {
  $("previewSection").style.display = "none";
  clearProgress();
  excelState.diff = { new: [], updated: [], deleted: [] };
};


// ======================================================
// CONFIRM IMPORT BUTTON → START FIRESTORE WRITE PROCESS
// ======================================================


$("btnConfirmImport").onclick = async () => {
  const d = excelState.diff;

  // Safety: deletions require checkbox
  if (d.deleted.length > 0 && !$("allowDeletion").checked) {
    return showPopup("Enable 'Allow deletion' to continue.");
  }

  // Disable UI while processing
  $("btnConfirmImport").disabled = true;
  $("allowDeletion").disabled = true;

   


  clearProgress();
  updateProgress("Starting update…");

  await applyExcelChanges();  // main engine

  updateProgress("\nDONE.\nYou may close this window.");

};

// ======================================================
// MAIN ENGINE — APPLY EXCEL CHANGES (batch write + progress)
// ======================================================
async function applyExcelChanges() {
   processing = true;
  const { new: newCases, updated, deleted } = excelState.diff;

  updateProgress(`Preparing to write data...`);
  updateProgress(`New: ${newCases.length}`);
  updateProgress(`Updated: ${updated.length}`);
  updateProgress(`Deleted: ${deleted.length}`);

  const batchLimit = 400; // Safe threshold below Firestore 500 limit

  // Utility to run batches safely
  async function runBatches(tasks, label) {
    let batch = [];
    let processed = 0;

    for (const t of tasks) {
      batch.push(t);
      processed++;

      if (batch.length >= batchLimit) {
        updateProgress(`${label}: writing batch (${processed - batch.length} to ${processed})...`);
        await Promise.all(batch);
        batch = [];
      }
    }

    if (batch.length > 0) {
      updateProgress(`${label}: writing final batch...`);
      await Promise.all(batch);
    }

    updateProgress(`${label}: ✔ completed (${processed})`);
  }

  // ======================================================
  // NEW CASES → setDoc
  // ======================================================
  updateProgress("\nCreating NEW cases...");
  await runBatches(
  newCases.map(ex =>
    setDoc(doc(db, "cases", ex.id), {
      id: ex.id,
      teamId: excelState.teamId,

      excelOrder: ex.excelOrder, 

      customerName: ex.customerName,
      createdOn: ex.createdOn,
      createdBy: ex.createdBy,
      country: ex.country,
      caseResolutionCode: ex.caseResolutionCode,
      caseOwner: ex.caseOwner,
      otcCode: ex.otcCode,
      caGroup: ex.caGroup,
      tl: ex.tl,
      sbd: ex.sbd,
      onsiteRFC: ex.onsiteRFC,
      csrRFC: ex.csrRFC,
      benchRFC: ex.benchRFC,
      market: ex.market,

      // default fields
      status: "",
      followDate: "",
      followTime: "",                 // ✅ NEW
      flagged: false,
      pns: false,                     // ✅ NEW
      surveyPrediction: "",           // ✅ NEW
      predictionComment: "",          // ✅ NEW
      notes: "",
      lastActionedOn: "",
      lastActionedBy: "",
      statusChangedOn: "",
      statusChangedBy: ""
    })
  ),
  "New"
);


  // ======================================================
  // UPDATED CASES → updateDoc (only changed fields)
  // ======================================================
  updateProgress("\nUpdating existing cases...");

  await runBatches(
  updated.map(ex => {
     const existing = excelState.firestoreCases.find(c => c.id === ex.id);
     const overwrite = $("overwriteUserActions")?.checked;
   
     let data = { ...ex, teamId: excelState.teamId };
   
     if (!overwrite && existing) {
       const preserve = [
         "status",
         "followDate",
         "followTime",
         "flagged",
         "notes",
         "pns",
         "surveyPrediction",
         "predictionComment",
         "lastActionedOn",
         "lastActionedBy",
         "statusChangedOn",
         "statusChangedBy"
       ];
   
       preserve.forEach(f => {
         if (existing[f] !== undefined) data[f] = existing[f];
       });
     }
   
     return setDoc(doc(db, "cases", ex.id), data);
   }),
  "Updated"
);


  // ======================================================
  // DELETED CASES → deleteDoc
  // ======================================================
  if (deleted.length > 0) {
    updateProgress("\nDeleting missing cases...");
    await runBatches(
      deleted.map(c => deleteDoc(doc(db, "cases", c.id))),
      "Deleted"
    );
  }

  // ======================================================
  // SUMMARY
  // ======================================================
  updateProgress("\n-----------------------------------");
  updateProgress("UPDATE COMPLETE");
  updateProgress(`New: ${newCases.length}`);
  updateProgress(`Updated: ${updated.length}`);
  updateProgress(`Deleted: ${deleted.length}`);
  updateProgress("-----------------------------------");

   await writeDailyRepairReportSnapshot();

  showPopup("Excel update complete!");
   processing = false;

}

async function writeDailyRepairReportSnapshot() {
  const teamId = excelState.teamId;
  const todayISO = getTeamToday(teamConfig);

  // ===============================
  // RFC VALUES (already computed)
  // ===============================
  const reportData = {
    // OPEN CASES
    open_total: rfcState.open.total,
    open_onsite: rfcState.open.onsite,
    open_offsite: rfcState.open.offsite,
    open_csr: rfcState.open.csr,

    // READY FOR CLOSURE
    rfc_total: rfcState.rfc.total,
    rfc_onsite: rfcState.rfc.onsite,
    rfc_offsite: rfcState.rfc.offsite,
    rfc_csr: rfcState.rfc.csr,

    // OVERDUE
    overdue_total: rfcState.overdue.total,
    overdue_onsite: rfcState.overdue.onsite,
    overdue_offsite: rfcState.overdue.offsite,
    overdue_csr: rfcState.overdue.csr
  };

  const reportRef = doc(
    db,
    "dailyRepairReports",
    teamId,
    "reports",
    todayISO
  );

  // Preserve closedCount
  const snap = await getDoc(reportRef);
  const closedCount =
    snap.exists() && typeof snap.data().closedCount === "number"
      ? snap.data().closedCount
      : 0;

  await setDoc(
    reportRef,
    {
      ...reportData,
      closedCount
    },
    { merge: true }
  );

  // Retention cleanup
  await cleanupDailyReports(teamId, todayISO);
}


/* ============================================================
   FIX — Enable Update Data Modal
   ============================================================ */
el.btnUpdateData.onclick = () => {
  resetExcelUI();
  modalUpdateData.classList.add("show");
};


btnUpdateClose.onclick = () => {
  resetExcelUI();
  modalUpdateData.classList.remove("show");
};
btnUpdateDone.onclick = () => {
  resetExcelUI();
  modalUpdateData.classList.remove("show");
};



const modalReassign       = document.getElementById("modalReassign");
const reassignTeamSelect  = document.getElementById("reassignTeamSelect");
const btnReassignClose    = document.getElementById("btnReassignClose");
const btnReassignDone     = document.getElementById("btnReassignDone");
const btnReassignConfirm  = document.getElementById("btnReassignConfirm");

const usersTableWrap      = document.getElementById("usersTableWrap");

const statsControls       = document.getElementById("statsControls");
const statsTableWrap      = document.getElementById("statsTableWrap");

const modalAudit          = document.getElementById("modalAudit");
const auditList           = document.getElementById("auditList");
const btnAuditClose       = document.getElementById("btnAuditClose");
const btnAuditOk          = document.getElementById("btnAuditOk");

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


// ================================================
// NEW: PREVIEW CHANGES BUTTON (replaces Process Excel)
// ================================================
$("btnPreviewChanges").onclick = async () => {

  // Prevent running before auth is ready
  if (!document.body.dataset.authready) {
    return showPopup("Please wait... authentication still loading.");
  }

  clearProgress();
  updateProgress("Preparing preview...");

  if (!excelState.teamId) return showPopup("Select a team.");
  if (!excelState.file) return showPopup("Select an Excel file.");

  // Load existing firestore cases for this team
  await loadFirestoreCasesForTeam(excelState.teamId);

  updateProgress("Comparing Excel → Firestore...");
  computeDiff();

  openPreviewModal();
};

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
   SECTION 1 — AUTH + INITIALIZATION + ROLE PROTECTION
   ============================================================ */
onAuthStateChanged(auth, async (user) => {
  if (!user) {
    location.href = "login.html";
    return;
  }

  const snap = await getDoc(doc(db, "users", user.uid));
  if (!snap.exists()) {
    location.href = "login.html";
    return;
  }

  const data = snap.data();
  if (data.status !== "approved") {
    await auth.signOut();
    return;
  }

  // General users cannot access admin page
  if (data.role === "general") {
    location.href = "index.html";
    return;
  }

  adminState.user = { uid: user.uid, ...data };
   // EXCEL IMPORT is disabled until Auth is ready
document.body.dataset.authready = "true";

   document.body.dataset.role = data.role;


  // Display user name
  el.adminUserName.textContent = `${data.firstName} ${data.lastName}`;

  // Theme
  document.documentElement.dataset.theme = data.theme || "dark";
  el.adminTheme.textContent = data.theme === "light" ? "🌙" : "☀️";
  el.adminTheme.onclick = () => toggleTheme(adminState.user);

  // Role-based visibility
  if (isPrimary(data)) {
    el.btnUpdateData.style.display = "inline-block";
    el.btnCreateTeam.style.display = "inline-block";
  } else {
    el.btnUpdateData.style.display = "none";
    el.btnCreateTeam.style.display = "none";
  }

  // Navigation
  el.btnGotoTracker.onclick = () => location.href = "index.html";
  el.btnAdminLogout.onclick = () => auth.signOut();

  // Tabs
  setupTabs();

  // Load Teams + Stats + Users
  await loadTeamsForAdmin();
   // --------------------------------------------------
   // Init custom selects in Create / Manage Team modal
   // --------------------------------------------------
   const tzSelect = document.getElementById("newTeamTimezone");
   const resetSelect = document.getElementById("newTeamResetHour");
   
   if (tzSelect) initCustomSelect(tzSelect);
   if (resetSelect) initCustomSelect(resetSelect);

  loadUsersForAdmin();
  
  buildTeamSelector();
  
});



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
   SECTION 3 — TEAM MANAGEMENT
   ============================================================ */
export async function loadTeamsForAdmin() {
  adminState.allTeams = [];

  const snap = await getDocs(collection(db, "teams"));
  snap.forEach(d => adminState.allTeams.push({ id: d.id, ...d.data() }));

  populateTeamList();
  populateUpdateDataTeams();
  populateReassignTeams();
}


/* ---------- CREATE TEAM ---------- */
btnCreateTeam.onclick = () => {
  if (!isPrimary(adminState.user)) return;
  modalCreateTeam.classList.add("show");
};

btnTeamClose.onclick = () => {
  resetTeamModalState();
  modalCreateTeam.classList.remove("show");
};

btnTeamDone.onclick = () => {
  resetTeamModalState();
  modalCreateTeam.classList.remove("show");
};

modalCreateTeam.addEventListener("click", (e) => {
  if (e.target === modalCreateTeam) {
    resetTeamModalState();
    modalCreateTeam.classList.remove("show");
  }
});

btnTeamCancel.onclick = () => {
  resetTeamModalState();
  modalCreateTeam.classList.remove("show");
};


// ============================================================
// CREATE TEAM HANDLER (DEFAULT MODE)
// ============================================================
async function createTeamHandler() {
  const name = newTeamName.value.trim();
   const timezone = newTeamTimezone.dataset.value;
   const resetHour = newTeamResetHour.dataset.value;

  if (!name) return alert("Please enter a team name.");
  if (!timezone) return alert("Please select a team timezone.");
  if (resetHour === "") return alert("Please select a daily reset time.");

  try {
    await addDoc(collection(db, "teams"), {
      name,
      resetTimezone: timezone,
      resetHour: Number(resetHour),
      createdAt: new Date()
    });

    resetTeamModalState();
    await loadTeamsForAdmin();
    showPopup("Team created successfully.");
  } catch (err) {
    console.error(err);
    alert("Failed to create team.");
  }
}

// Bind default create behavior
btnTeamCreate.onclick = createTeamHandler;



/* ---------- TEAM LIST ---------- */
function populateTeamList() {
  teamList.innerHTML = "";

  adminState.allTeams
    .sort((a, b) => a.name.localeCompare(b.name))
    .forEach(t => {
      const row = document.createElement("div");
      row.style.marginBottom = "0.6rem";

      row.innerHTML = `
        <div style="display:flex;justify-content:space-between;">
          <div style="display:flex;align-items:center;"><strong>${t.name}</strong></div>
          <div>
            <button class="action-btn btnUpdateTeam btn-boxed" style="border-radius:8px;padding:0.35rem 0.6rem;" data-action="rename" data-id="${t.id}">Update</button>
            <button class="action-btn btn-boxed" style="border-radius:8px;padding:0.35rem 0.6rem;" data-action="delete" data-id="${t.id}">Delete</button>
          </div>
        </div>
      `;

      if (isSecondary(adminState.user)) {
        row.querySelectorAll("button").forEach(b => {
          b.disabled = true;
          b.style.opacity = "0.4";
        });
      }

      teamList.appendChild(row);
    });
}

document.addEventListener("click", async (e) => {
  const btn = e.target.closest(".btnUpdateTeam");
  if (!btn) return;

  const teamId = btn.dataset.id;

  const teamSnap = await getDoc(doc(db, "teams", teamId));

   
   
  if (!teamSnap.exists()) return;

  const team = teamSnap.data();

  // Pre-fill inputs
  newTeamName.value = team.name || "";
  newTeamTimezone.dataset.value = team.resetTimezone || "";
   newTeamTimezone.querySelector(".custom-select-trigger").textContent =
     team.resetTimezone || "Select Team Timezone";
   
   newTeamResetHour.dataset.value =
     typeof team.resetHour === "number" ? String(team.resetHour) : "";
   newTeamResetHour.querySelector(".custom-select-trigger").textContent =
     typeof team.resetHour === "number"
       ? `${team.resetHour}:00`
       : "Reset Time";


  // Switch Create → Update mode
  btnTeamCreate.textContent = "Update Team";
  teamModalTitle.textContent = "Update Team";

  btnTeamCreate.onclick = async () => {
  const updatedName = newTeamName.value.trim();
  const updatedTimezone = newTeamTimezone.value;
  const updatedResetHour = newTeamResetHour.value;

  if (!updatedName || !updatedTimezone || updatedResetHour === "") {
    alert("Please fill all team fields.");
    return;
  }

  try {
    await updateDoc(doc(db, "teams", teamId), {
      name: updatedName,
      resetTimezone: updatedTimezone,
      resetHour: Number(updatedResetHour)
    });

    resetTeamModalState();
    await loadTeamsForAdmin();
    showPopup("Team updated successfully.");
  } catch (err) {
    console.error(err);
    alert("Failed to update team.");
  }
};

});


/* ---------- DELETE TEAM ONLY (Rename removed) ---------- */
teamList.addEventListener("click", async (e) => {
  const btn = e.target.closest("button");
  if (!btn || isSecondary(adminState.user)) return;

  const action = btn.dataset.action;
  const teamId = btn.dataset.id;

  if (action === "delete") deleteTeam(teamId);
});

/* =======================================================================
   DELETE TEAM — WITH FULL CASE CASCADE DELETE
   ======================================================================= */
async function deleteTeam(teamId) {
  // 1. Check if team still has users
  const userSnap = await getDocs(
    query(collection(db, "users"), where("teamId", "==", teamId))
  );

  if (!userSnap.empty) {
    // Reassign required
    openReassignModal(teamId, userSnap);
    return;
  }

  // 2. Delete cases for this team
  showPopup("Deleting cases for this team...");
  await deleteAllCasesForTeam(teamId);

  // 3. Delete the team record itself
  await deleteDoc(doc(db, "teams", teamId));

  showPopup("Team deleted successfully.");
  await loadTeamsForAdmin();
}


/* =======================================================================
   REASSIGN USERS MODAL — CLEAN & RELIABLE VERSION
   ======================================================================= */

let reassignSourceTeam = null;
let reassignUserList = [];

function openReassignModal(teamId, qs) {
  reassignSourceTeam = teamId;
  reassignUserList = qs.docs.map(d => d.id);

  populateReassignTeams();
  modalReassign.classList.add("show");
}

btnReassignClose.onclick = () => modalReassign.classList.remove("show");
btnReassignDone.onclick  = () => modalReassign.classList.remove("show");

modalReassign.onclick = (e) => {
  if (e.target === modalReassign) modalReassign.classList.remove("show");
};

/* Populate dropdown (exclude the team being deleted) */
function populateReassignTeams() {
  reassignTeamSelect.innerHTML = "";

  adminState.allTeams.forEach(t => {
    if (t.id !== reassignSourceTeam) {
      const opt = document.createElement("option");
      opt.value = t.id;
      opt.textContent = t.name;
      reassignTeamSelect.appendChild(opt);
    }
  });
}

/* CONFIRM BUTTON — Reassign Users THEN Delete Team */
btnReassignConfirm.onclick = async () => {
  const newTeam = reassignTeamSelect.value;
  if (!newTeam) return showPopup("Please select a team.");

  showPopup("Reassigning users...");

  for (const uid of reassignUserList) {
    await updateDoc(doc(db, "users", uid), { teamId: newTeam });
  }

  showPopup("Deleting old team and its cases...");

  // Delete cases
  await deleteAllCasesForTeam(reassignSourceTeam);

  // Delete team
  await deleteDoc(doc(db, "teams", reassignSourceTeam));

  modalReassign.classList.remove("show");
  showPopup("Team deleted successfully.");

  await loadTeamsForAdmin();
};



function populateUpdateDataTeams() {
  updateTeamList.innerHTML = "";

  adminState.allTeams
    .sort((a, b) => a.name.localeCompare(b.name))
    .forEach(t => {
      const row = document.createElement("div");
      row.style.marginBottom = "0.4rem";

      row.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;padding:0.4rem 0;">
          <div><strong>${t.name}</strong></div>
          <div style="display:flex;gap:0.4rem;">
            <button class="action-btn btn-boxed" data-action="upload" 
               style="padding: 0.35rem 0.6rem;font-size: 13px;height: 32px;" 
               data-id="${t.id}">Upload Excel</button>
            <button class="action-btn btn-boxed" data-action="export" 
               style="padding: 0.35rem 0.6rem;font-size: 13px;height: 32px;" 
               data-id="${t.id}">Export Backup</button>
            <button class="action-btn btn-boxed" data-action="import" 
               style="padding: 0.35rem 0.6rem;font-size: 13px;height: 32px;" 
               data-id="${t.id}">Import Backup</button>
          </div>
        </div>
      `;

      // Secondary admin cannot use these
      if (isSecondary(adminState.user)) {
        row.querySelectorAll("button").forEach(b => {
          b.disabled = true;
          b.style.opacity = "0.4";
          b.style.cursor = "not-allowed";
        });
      }

      updateTeamList.appendChild(row);
    });
}




/* ============================================================
   SECTION 4 — USERS TAB
   ============================================================ */
function loadUsersForAdmin() {
  let q;

  if (isPrimary(adminState.user)) {
    q = query(collection(db, "users"));
  } else {
    q = query(collection(db, "users"), where("teamId", "==", adminState.user.teamId));
  }

  onSnapshot(q, (snap) => {
  const users = [];
  snap.forEach(d => users.push({ id: d.id, ...d.data() }));

  // FIX: store users globally so Remove button can see them
  allUsers = users;

  renderUsersTable(users);
});

}

/* =======================================================================
   PHASE A — USERS TAB FIXES
   ======================================================================= */

function renderUsersTable(users) {
  let html = `<table><thead><tr>`;

  if (isSecondary(adminState.user)) {
    // SECONDARY USER — ONLY FOUR COLUMNS
    html += `
      <th>Email</th>
      <th>Name</th>
      <th>Created</th>
      <th>Team</th>
    `;
  } else {
    // PRIMARY ADMIN — FULL COLUMNS
    html += `
      <th>Email</th>
      <th>Name</th>
      <th>Role</th>
      <th>Status</th>
      <th>Created</th>
      <th>Team</th>
      <th>Actions</th>
    `;
  }

  html += `</tr></thead><tbody>`;

  // Sort by creation date
  users.sort((a, b) => {
    const da = a.createdAt?.toDate ? a.createdAt.toDate() : new Date(0);
    const db = b.createdAt?.toDate ? b.createdAt.toDate() : new Date(0);
    return da - db; // oldest → newest
  });

  users.forEach(u => {
    const created = u.createdAt?.toDate
      ? u.createdAt.toDate().toLocaleDateString()
      : "—";

    const name = `${capitalize(u.firstName)} ${capitalize(u.lastName)}`;
    const teamName = (u.teamId || "—").toUpperCase();

    if (isSecondary(adminState.user)) {
      // SECONDARY ADMIN ROW
      html += `
        <tr>
          <td>${u.email}</td>
          <td>${name}</td>
          <td>${created}</td>
          <td>${teamName}</td>
        </tr>
      `;
    } else {
      // PRIMARY ADMIN ROW
      html += `
        <tr>
          <td>${u.email}</td>
          <td>${name}</td>
          <td>${renderRoleDropdown(u)}</td>
          <td>${capitalize(u.status)}</td>
          <td>${created}</td>
          <td>${renderTeamDropdown(u)}</td>
          <td>${renderUserActions(u)}</td>
        </tr>
      `;
    }
  });

  html += `</tbody></table>`;
  usersTableWrap.innerHTML = html;

   if (isPrimary(adminState.user)) {
     bindUserRoleCustomSelects();
     bindUserTeamCustomSelects(); // (we add this next)
     bindUserActions();
   }
}

// Helper function for capitalization
function capitalize(str) {
  if (!str) return "";
  return str[0].toUpperCase() + str.slice(1).toLowerCase();
}

/* -----------------------------------------------------------------------
   FIXED ROLE DROPDOWN
   ----------------------------------------------------------------------- */
function renderRoleDropdown(u) {
  // Primary admin role should not be editable
  if (u.role === "primary") {
    return `<strong>Primary Admin</strong>`;
  }

  // Secondary admins cannot edit roles
  if (!isPrimary(adminState.user)) {
    return capitalize(u.role);
  }

  const currentLabel =
    u.role === "secondary" ? "Secondary Admin" : "General User";

  return `
    <div class="custom-select user-role-dd" data-uid="${u.id}" data-value="${u.role}">
      <div class="custom-select-trigger">${currentLabel}</div>
      <div class="custom-options">
        <div class="custom-option" data-value="general">General User</div>
        <div class="custom-option" data-value="secondary">Secondary Admin</div>
      </div>
    </div>
  `;
}

function bindUserRoleCustomSelects() {
  if (!isPrimary(adminState.user)) return;

  document.querySelectorAll(".custom-select.user-role-dd").forEach(cs => {
    initCustomSelect(cs);

    cs.addEventListener("change", async () => {
      const uid = cs.dataset.uid;
      const newRole = cs.dataset.value;

      if (!uid || !newRole) return;

      try {
        await updateDoc(doc(db, "users", uid), { role: newRole });
        showPopup("Role updated.");
      } catch (err) {
        console.error(err);
        showPopup("Failed to update role.");
      }
    });
  });
}

function bindUserTeamCustomSelects() {
  if (!isPrimary(adminState.user)) return;

  document.querySelectorAll(".custom-select.user-team-dd").forEach(cs => {
    initCustomSelect(cs);

    cs.addEventListener("change", async () => {
      const uid = cs.dataset.uid;
      const newTeam = cs.dataset.value || "";

      if (!uid) return;

      try {
        await updateDoc(doc(db, "users", uid), { teamId: newTeam });
        showPopup(`Team updated${newTeam ? "" : " (removed)"}.`);
      } catch (err) {
        console.error(err);
        showPopup("Failed to update team.");
      }
    });
  });
}



/* -----------------------------------------------------------------------
   FIXED TEAM DROPDOWN
   ----------------------------------------------------------------------- */
function renderTeamDropdown(u) {
  if (!isPrimary(adminState.user)) {
    return u.teamId || "—";
  }

  const teams = adminState.allTeams
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name));

  const currentTeam =
    teams.find(t => t.id === u.teamId)?.name || "— No Team —";

  let optionsHtml = `<div class="custom-option" data-value="">— No Team —</div>`;

  teams.forEach(t => {
    optionsHtml += `
      <div class="custom-option" data-value="${t.id}">
        ${t.name}
      </div>
    `;
  });

  return `
    <div class="custom-select user-team-dd"
         data-uid="${u.id}"
         data-value="${u.teamId || ""}">
      <div class="custom-select-trigger">${currentTeam}</div>
      <div class="custom-options">
        ${optionsHtml}
      </div>
    </div>
  `;
}

function bindTeamDropdowns() {
  if (!isPrimary(adminState.user)) return;

  document.querySelectorAll(".user-team-dd").forEach(sel => {
    sel.onchange = async () => {
      const uid = sel.dataset.uid;
      const newTeam = sel.value;

      await updateDoc(doc(db, "users", uid), { teamId: newTeam });

      showPopup(`Team updated${newTeam ? "" : " (removed)"}.`);
    };
  });
}



/* ---------- USER ACTIONS ---------- */
function renderUserActions(u) {
  if (!isPrimary(adminState.user)) return "";

  if (u.status === "pending") {
    return `
      <button class="action-btn" data-approve="${u.id}">Approve</button>
      <button class="action-btn" data-reject="${u.id}">Reject</button>
    `;
  }

  // Do NOT allow removing the Primary Admin
if (u.role === "primary") {
  return `<span style="opacity:0.6;">—</span>`; // or return "" to show nothing
}

return `<button class="action-btn btn-boxed" style="padding: 0.35rem 0.6rem; border-radius: 8px;" data-remove="${u.id}">Remove</button>`;

}

/* -----------------------------------------------------------------------
   USER ACTION BUTTONS (Approve / Reject / Remove)
   ----------------------------------------------------------------------- */
function bindUserActions() {
  document.querySelectorAll("[data-approve]").forEach(btn => {
    btn.onclick = async () => {
      await updateDoc(doc(db, "users", btn.dataset.approve), {
        status: "approved"
      });
      showPopup("User approved.");
    };
  });

  document.querySelectorAll("[data-reject]").forEach(btn => {
    btn.onclick = async () => {
      await updateDoc(doc(db, "users", btn.dataset.reject), {
        status: "rejected"
      });
      showPopup("User rejected.");
    };
  });

  document.querySelectorAll("[data-remove]").forEach(btn => {
  btn.onclick = async () => {
    const uid = btn.dataset.remove;

    // Get the user object so we can check role safely
    const userObj = allUsers.find(u => u.id === uid);

    // Safety check
    if (!userObj) {
      return showPopup("User not found.");
    }

    // Prevent removing primary admin
    if (userObj.role === "primary") {
      return showPopup("Primary Admin cannot be removed.");
    }

    if (!confirm("Remove user permanently?")) return;

    await deleteDoc(doc(db, "users", uid));
    showPopup("User removed.");
  };
});
}


/* =======================================================================
   CASCADE DELETE — DELETE ALL CASES FOR A TEAM
   ======================================================================= */
async function deleteAllCasesForTeam(teamId) {
  const casesSnap = await getDocs(
    query(collection(db, "cases"), where("teamId", "==", teamId))
  );

  const batchLimit = 450;  // Firestore batch limit safe-zone
  let batch = [];
  let counter = 0;

  for (const docSnap of casesSnap.docs) {
    batch.push(deleteDoc(doc(db, "cases", docSnap.id)));
    counter++;

    // Execute in chunks to avoid failures
    if (counter >= batchLimit) {
      await Promise.all(batch);
      batch = [];
      counter = 0;
    }
  }

  if (batch.length > 0) {
    await Promise.all(batch);
  }
}




/* ============================================================
   SECTION 5 — UPDATE DATA ENGINE (Excel + Backup)
   ============================================================ */

// ======================================================
// RESET EXCEL UI STATE
// ======================================================
function resetExcelUI() {
  excelState.teamId = null;
  excelState.file = null;
  excelState.rawRows = [];
  excelState.excelCases = [];
  excelState.firestoreCases = [];
  excelState.diff = { new: [], updated: [], deleted: [] };

  $("selectedFileName").textContent = "No file selected";
  $("uploadSummary").innerHTML = `<strong>Selected Team:</strong> -`;
  $("btnPreviewChanges").disabled = true;
  $("allowDeletion").checked = false;

  clearProgress();

  // Reset modal preview buttons if preview modal was opened
  $("btnConfirmImport").disabled = false;
  $("allowDeletion").disabled = false;

   $("previewSection").style.display = "none";
   $("previewCounts").innerHTML = "";
   excelState.isBackupImport = false;
}




function excelToDate(num) {
  if (!num) return "";
  const epoch = new Date(1899, 11, 30);
  const d = new Date(epoch.getTime() + num * 86400000);
  return d.toISOString().split("T")[0];
}



updateTeamList.addEventListener("click", async (e) => {
  const btn = e.target.closest("button");
  if (!btn) return;

  const action = btn.dataset.action;
  const teamId = btn.dataset.id;

  if (!isPrimary(adminState.user)) {
    showPopup("Only primary admin can update data.");
    return;
  }

  if (action === "upload") {
  excelState.teamId = teamId;
  $("uploadSummary").innerHTML = `<strong>Selected Team:</strong> ${teamId}`;
  validateReadyState();
}


  if (action === "export") exportBackup(teamId);
  if (action === "import") importBackupPrompt(teamId);
});

// -----------------------------
// Prevent file picker when no team selected
// -----------------------------
const fileLabel = document.querySelector(".file-input-label");
const excelInputEl = $("excelInput");

if (fileLabel && excelInputEl) {
  // clicking the styled label
  fileLabel.addEventListener("click", (ev) => {
    if (!excelState.teamId) {
      ev.preventDefault(); // stop label from forwarding click to input
      showPopup("Please select a team before choosing a file.");
      // gently bring the teams list into view so user sees where to click
      if (updateTeamList) updateTeamList.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    // otherwise allow normal behaviour
  });

  // also guard direct clicks on the hidden input (extra safety)
  excelInputEl.addEventListener("click", (ev) => {
    if (!excelState.teamId) {
      ev.preventDefault();
      showPopup("Please select a team before choosing a file.");
      if (updateTeamList) updateTeamList.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, { capture: true });
}






/* ============================================================
   BACKUP EXPORT / IMPORT
   ============================================================ */
async function exportBackup(teamId) {
  const snap = await getDocs(
    query(collection(db, "cases"), where("teamId", "==", teamId))
  );

  const cases = snap.docs.map(d => ({
    id: d.id,
    ...d.data()
  }));

  const backup = {
    version: 2,
    app: "KCI Case Tracker",
    exportedAt: new Date().toISOString(),
    teamId,
    caseCount: cases.length,
    cases
  };

  const blob = new Blob(
    [JSON.stringify(backup, null, 2)],
    { type: "application/json" }
  );

  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const today = getTeamToday(teamConfig);

  a.href = url;
  a.download = `${teamId}_backup_v2_${today}.json`;
  a.click();

  URL.revokeObjectURL(url);
}

function importBackupPrompt(teamId) {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = ".json";

  input.onchange = async () => {
    const file = input.files[0];
    if (!file) return;

    resetExcelUI();               // 🔁 reuse Excel UI
    excelState.teamId = teamId;
    $("uploadSummary").innerHTML = `<strong>Selected Team:</strong> ${teamId}`;
    excelState.file = file;

    clearProgress();
    updateProgress("Reading backup file...");

    const text = await file.text();
    const data = JSON.parse(text);

    await parseBackupFile(data);  // NEW
    validateReadyState();
  };

  input.click();
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
        <th>User</th>
        <th>Total Followed Up</th>
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
          Follow-ups
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

const modalUserStats = document.getElementById("modalUserStats");
const userStatsBody  = document.getElementById("userStatsBody");
const userStatsTitle = document.getElementById("userStatsTitle");
const btnUserStatsClose = document.getElementById("btnUserStatsClose");
const btnUserStatsOk = document.getElementById("btnUserStatsOk");

btnUserStatsClose.onclick = () => modalUserStats.classList.remove("show");
btnUserStatsOk.onclick    = () => modalUserStats.classList.remove("show");

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
  // Load cases using a team-scoped query for non-primary users
  try {
    let snap;

    if (!isPrimary(adminState.user)) {
      // Secondary → only read cases for their team
      const q = query(collection(db, "cases"), where("teamId", "==", adminState.user.teamId));
      snap = await getDocs(q);
    } else {
      // Primary → can read all cases (TOTAL mode or specific team selected elsewhere)
      snap = await getDocs(collection(db, "cases"));
    }

    statsCases = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch (err) {
    console.error("Failed to load stats cases:", err);
    showPopup("Unable to load cases for stats (permission or network issue).");
    statsCases = []; // safe fallback
  }
}


/* ------------------------------------------------------------
   Manual REFRESH button for stats tab
------------------------------------------------------------ */
function buildStatsControls() {
  statsControls.innerHTML = `
    <button class="action-btn btn-boxed" style="padding:0.55rem 0.65rem;font-size:18px;" id="btnStatsRefresh" title="Refresh">
      🔄
    </button>
`;


  document.getElementById("btnStatsRefresh").onclick = async () => {
    showPopup("Refreshing stats...");
    await loadStatsCasesOnce();
    await loadAllUsersForStats();
    renderStatsTableNew();
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

  statsControls.prepend(wrapper);

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

/* ------------------------------------------------------------
   Disable the old real-time stats subscription
------------------------------------------------------------ */
function subscribeStatsCases() {
  // DISABLED — realtime disabled for Option B
  // (We only load on demand using loadStatsCasesOnce)
  return;
}





























