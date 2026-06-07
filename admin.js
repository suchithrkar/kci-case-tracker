/* ======================================================
   ADMIN.JS — CLEAN FINAL VERSION
   Contains:
   - Initialization & Roles
   - Team Management
   - Users Tab
   - Excel Upload + Backup
   ===================================================== */

/* =====================================================
   SINGLE IMPORT BLOCK (Do NOT add any more imports)
   ===================================================== */
import {
  auth,
  onAuthStateChanged,
  db,
  collection,
  addDoc,
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
  closedCases: [],
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
  adminUserName: document.getElementById("adminUserName"),
  adminTheme: document.getElementById("adminTheme"),
  btnUpdateData: document.getElementById("btnUpdateData"),
  btnCreateTeam: document.getElementById("btnCreateTeam"),
  btnGotoTracker: document.getElementById("btnGotoTracker"),
  btnAdminLogout: document.getElementById("btnAdminLogout"),

  tabUsers: document.getElementById("tabUsers"),
  tabManage: document.getElementById("tabManage"),

  sectionUsers: document.getElementById("sectionUsers"),
  sectionManage: document.getElementById("sectionManage"),

  tabManageUpdateData: document.getElementById("tabManageUpdateData"),
  tabManageTeams: document.getElementById("tabManageTeams"),

  manageUpdateDataSection: document.getElementById("manageUpdateDataSection"),
  manageTeamsSection: document.getElementById("manageTeamsSection")
};

const teamList            = document.getElementById("teamList");
const newTeamName         = document.getElementById("newTeamName");
const btnTeamCreate       = document.getElementById("btnTeamCreate");
const btnTeamClose        = document.getElementById("btnTeamClose");
const btnTeamDone         = document.getElementById("btnTeamDone");
const modalCreateTeam     = document.getElementById("modalCreateTeam");
const teamModalTitle      = document.getElementById("teamManagementTitle");

// Team reset settings inputs
const newTeamTimezone = document.getElementById("newTeamTimezone");
const newTeamResetHour = document.getElementById("newTeamResetHour");
const btnTeamCancel = document.getElementById("btnTeamCancel");

const updateTeamList      = document.getElementById("updateTeamList");

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

      // ==========================================
      // Read required sheets by NAME
      // ==========================================
      const repairSheet = wb.Sheets["Repair Cases"];
      const closedSheet = wb.Sheets["Closed Cases Data"];
      
      if (!repairSheet) {
        alert("Repair Cases sheet not found.");
        resolve();
        return;
      }
      
      const rows = XLSX.utils.sheet_to_json(repairSheet, { header: 1 });

      // ======================================================
      // OPTIONAL SAFETY GUARD — EXCEL HEADER VALIDATION
      // ======================================================
      
      // Expected headers by position (0-based index)
      // We only check for KEY PHRASES, not full header text
      const expectedHeaders = {
        0: "case id",
        1: "customer name",
        2: "created on",
        3: "created by",
        4: "country",
        5: "resolution",
        6: "owner",
        7: "otc",
        8: "ca group",
        9: "tl",
        10: "sbd",
        11: "onsite",
        12: "csr",
        13: "bench",
        14: "market",
        15: "closure",
        16: "tracking",
        17: "part number",
        18: "part name",
        19: "serial",
        20: "product",
        21: "email",
        22: "dnap"
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
           id: String(r[0] || "").trim(),              // A
           customerName: String(r[1] || "").trim(),   // B
           createdOn: excelToDate(r[2]),              // C
           createdBy: String(r[3] || "").trim(),      // D
           country: String(r[4] || "").trim(),        // E
           caseResolutionCode: String(r[5] || "").trim(), // F
           caseOwner: String(r[6] || "").trim(),      // G
           otcCode: String(r[7] || "").trim(),        // H
           caGroup: String(r[8] || "").trim(),        // I
           tl: String(r[9] || "").trim(),             // J
           sbd: String(r[10] || "").trim(),           // K
           onsiteRFC: String(r[11] || "").trim(),     // L
           csrRFC: String(r[12] || "").trim(),        // M
           benchRFC: String(r[13] || "").trim(),      // N
           market: String(r[14] || "").trim(),        // O
         
           // ==========================
           // NEW FIELDS
           // ==========================
           woClosureNotes: String(r[15] || "").trim(), // P
           trackingStatus: String(r[16] || "").trim(), // Q
           partNumber: String(r[17] || "").trim(),     // R
           partName: String(r[18] || "").trim(),       // S
           serialNumber: String(r[19] || "").trim(),   // T
           productName: String(r[20] || "").trim(),    // U
           emailStatus: String(r[21] || "").trim(),    // V
           dnap: String(r[22] || "").trim(),           // W         
           excelOrder: i
         });
      }

      excelState.excelCases = parsed;

       // ==========================================
      // Parse Closed Cases Data sheet (archival)
      // ==========================================
      excelState.closedCases = [];
      
      if (closedSheet) {
        const closedRows = XLSX.utils.sheet_to_json(closedSheet, { header: 1 });
      
        for (let i = 1; i < closedRows.length; i++) {
          const r = closedRows[i];
          if (!r || !r[0]) continue;
      
          excelState.closedCases.push({
            id: String(r[0] || "").trim(),
            customerName: String(r[1] || "").trim(),
            createdOn: excelToDate(r[2]),
            createdBy: String(r[3] || "").trim(),
            modifiedBy: String(r[4] || "").trim(),
            modifiedOn: excelToDate(r[5]),
            caseClosedDate: excelToDateTime(r[6]),
            closedBy: String(r[7] || "").trim(),
            country: String(r[8] || "").trim(),
            caseResolutionCode: String(r[9] || "").trim(),
            caseOwner: String(r[10] || "").trim(),
            otcCode: String(r[11] || "").trim(),
            tl: String(r[12] || "").trim(),
            sbd: String(r[13] || "").trim(),
            market: String(r[14] || "").trim()
          });
        }
      }

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
   else if (data.version === 3 && data.casesList) {
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
   updateProgress(`Open Cases: ${backup.casesList?.length || 0}`);
   updateProgress(`Closed Cases: ${backup.closedCases?.length || 0}`);
   updateProgress(`Reports: ${backup.reports?.length || 0}`);

  // Normalize to Excel engine
   excelState.fullBackupData = backup;
   excelState.isFullRestore = true;
  // 🔧 Backup import needs full overwrite capability.
  // Mark backup imports so we can force-update cases later.
  excelState.isBackupImport = true;
}

// ======================================================
// ENABLE/DISABLE PREVIEW BUTTON BASED ON STATE
// ======================================================
function validateReadyState() {
  let ready = false;

  // Backup restore mode
  if (excelState.isFullRestore && excelState.fullBackupData) {
    ready = true;
  }

  // Excel upload mode
  else {
    ready =
      excelState.teamId &&
      excelState.file &&
      excelState.excelCases.length > 0;
  }

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
       ex.excelOrder !== fs.excelOrder ||
       ex.woClosureNotes !== fs.woClosureNotes ||
       ex.trackingStatus !== fs.trackingStatus ||
       ex.partNumber !== fs.partNumber ||
       ex.partName !== fs.partName ||
       ex.serialNumber !== fs.serialNumber ||
       ex.productName !== fs.productName ||
       ex.emailStatus !== fs.emailStatus ||
       ex.dnap !== fs.dnap;
   
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

     try {
       const colRef = collection(db, "cases", teamId, "casesList");
       const snap = await getDocs(colRef);
   
       excelState.firestoreCases = snap.docs.map(d => ({
         id: d.id,
         ...d.data()
       }));
   
     } catch (err) {
       console.error("Firestore read failed:", err);
       showPopup("Could not load Firestore cases. Try again in 1–2 seconds.");
     }
}



// ======================================================
// PREVIEW CHANGES MODAL
// ======================================================
async function openPreviewModal() {
  const d = excelState.diff;

  $("previewCounts").innerHTML = `
    <strong>New Cases:</strong> ${d.new.length}<br>
    <strong>Updated Cases:</strong> ${d.updated.length}<br>
    <strong>Deleted Cases:</strong> ${d.deleted.length}
  `;

  // show preview section
  $("previewSection").style.display = "block";

   // ==========================================
   // Auto-toggle Daily Report checkbox
   // ==========================================
   try {
     const teamSnap = await getDoc(doc(db, "teams", excelState.teamId));
     const teamCfg = teamSnap.exists()
       ? {
           resetTimezone: teamSnap.data().resetTimezone,
           resetHour: teamSnap.data().resetHour
         }
       : { resetTimezone: "UTC", resetHour: 0 };
   
     const todayISO = getTeamToday(teamCfg);
   
      const reportRef = doc(
        db,
        "cases",
        excelState.teamId,
        "reports",
        todayISO
      );
   
     const reportSnap = await getDoc(reportRef);
   
     // First upload of the day → checked
     if (!reportSnap.exists()) {
       $("updateDailyReport").checked = true;
     } else {
       // Already generated today → unchecked
       $("updateDailyReport").checked = false;
     }
   
   } catch (err) {
     console.warn("Could not determine daily report state:", err);
     $("updateDailyReport").checked = false;
   }

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
  if (processing) {
    showPopup("Update already in progress. Please wait.");
    return;
  }

  processing = true;

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

   if (excelState.isFullRestore) {
     await applyFullRestore();
   } else {
     await applyExcelChanges();
   }  // main engine

  updateProgress("\nDONE.\nYou may close this window.");

};

// ======================================================
// MAIN ENGINE — APPLY EXCEL CHANGES (batch write + progress)
// ======================================================
async function applyExcelChanges() {
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

  try {
     // ======================================================
     // NEW CASES → setDoc
     // ======================================================
     updateProgress("\nCreating NEW cases...");
     await runBatches(
     newCases.map(ex =>
       setDoc(doc(db, "cases", excelState.teamId, "casesList", ex.id),{
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
         woClosureNotes: ex.woClosureNotes,
         trackingStatus: ex.trackingStatus,
         partNumber: ex.partNumber,
         partName: ex.partName,
         serialNumber: ex.serialNumber,
         productName: ex.productName,
         emailStatus: ex.emailStatus,
         dnap: ex.dnap,
   
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
        const overwrite =
          excelState.isBackupImport &&
          $("overwriteUserActions")?.checked;
      
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
      
         return setDoc(
           doc(db, "cases", excelState.teamId, "casesList", ex.id),
           data,
           { merge: true }
         );
      }),
     "Updated"
   );
   
   
     // ======================================================
     // DELETED CASES → deleteDoc
     // ======================================================
     if (deleted.length > 0) {
       updateProgress("\nDeleting missing cases...");
       await runBatches(
         deleted.map(c => deleteDoc(doc(db, "cases", excelState.teamId, "casesList", c.id))),
         "Deleted"
       );
     }
   } catch (err) {
     console.error("Case update failed:", err);
     showPopup("❌ Case update failed. Report was NOT generated.");
     processing = false;
     return; // ⛔ STOP HERE
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

   // 🔒 Always fetch correct team config for Excel upload
   const teamSnap = await getDoc(doc(db, "teams", excelState.teamId));
   const teamCfg = teamSnap.exists()
     ? {
         resetTimezone: teamSnap.data().resetTimezone,
         resetHour: teamSnap.data().resetHour
       }
     : { resetTimezone: "UTC", resetHour: 0 };
   
   const todayISO = getTeamToday(teamCfg);
   
   if ($("updateDailyReport")?.checked) {
   
     updateProgress("\nGenerating Daily Repair Report...");
   
     await generateDailyRepairReport({
       teamId: excelState.teamId,
       cases: excelState.excelCases,
       todayISO,
       generatedBy: adminState.user.uid,

       newCasesCount: newCases.length,
       deletedCasesCount: deleted.length
     });
   
     updateProgress("Daily report updated.");
   
   } else {
     updateProgress("\nDaily report update skipped.");
   }

   // ==========================================
   // Sync Closed Cases (Batched + Cleanup)
   // ==========================================
   updateProgress("\n-----------------------------------");
   updateProgress("SYNCING CLOSED CASES ARCHIVE");
   updateProgress("-----------------------------------");
   
   const closedColRef = collection(
     db,
     "cases",
     excelState.teamId,
     "closedCases"
   );
   
   // 1️⃣ Load existing closed cases from Firestore
   updateProgress("Loading existing closed cases from Firestore...");
   const closedSnap = await getDocs(closedColRef);
   
   const existingClosedMap = new Map();
   closedSnap.forEach(d => {
     existingClosedMap.set(d.id, d.data());
   });
   
   const excelClosedMap = new Map();
   excelState.closedCases.forEach(c => {
     excelClosedMap.set(c.id, c);
   });
   
   // 2️⃣ Detect NEW + DELETE
   const toCreate = [];
   const toDelete = [];
   
   for (const c of excelState.closedCases) {
     if (!existingClosedMap.has(c.id)) {
       toCreate.push(c);
     }
   }
   
   for (const d of closedSnap.docs) {
     if (!excelClosedMap.has(d.id)) {
       toDelete.push(d.id);
     }
   }
   
   updateProgress(`New Closed Cases: ${toCreate.length}`);
   updateProgress(`Removed Closed Cases: ${toDelete.length}`);
   
   // Utility batch runner
   async function runClosedBatches(tasks, label) {
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
   
   // 3️⃣ CREATE NEW
   if (toCreate.length > 0) {
     updateProgress("\nCreating new closed cases...");
     await runClosedBatches(
       toCreate.map(c =>
         setDoc(
           doc(db, "cases", excelState.teamId, "closedCases", c.id),
           {
             ...c,
             teamId: excelState.teamId,
             archivedAt: new Date()
           }
         )
       ),
       "Closed Create"
     );
   }
   
   // 4️⃣ DELETE MISSING
   if (toDelete.length > 0) {
     updateProgress("\nRemoving missing closed cases...");
     await runClosedBatches(
       toDelete.map(id =>
         deleteDoc(
           doc(db, "cases", excelState.teamId, "closedCases", id)
         )
       ),
       "Closed Delete"
     );
   }
   
   updateProgress("\nClosed Cases Sync Complete.");
   
   showPopup("Excel update complete!");
   processing = false;
}

async function applyFullRestore() {
  const teamId = excelState.teamId;
  const data = excelState.fullBackupData;

  updateProgress("Starting FULL RESTORE...");

  const batchLimit = 400;

  async function wipeCollection(colRef, label) {
    const snap = await getDocs(colRef);

    let batch = [];
    let count = 0;

    for (const d of snap.docs) {
      batch.push(deleteDoc(d.ref));
      count++;

      if (batch.length >= batchLimit) {
        await Promise.all(batch);
        batch = [];
      }
    }

    if (batch.length) await Promise.all(batch);

    updateProgress(`${label} wiped (${count})`);
  }

  async function writeCollection(colPath, docs, label) {
    let batch = [];
    let count = 0;

    for (const d of docs) {
      const ref = doc(db, ...colPath, d.id);
      batch.push(setDoc(ref, d));
      count++;

      if (batch.length >= batchLimit) {
        await Promise.all(batch);
        batch = [];
      }
    }

    if (batch.length) await Promise.all(batch);

    updateProgress(`${label} restored (${count})`);
  }

  try {
    // WIPE EXISTING DATA
    await wipeCollection(
      collection(db, "cases", teamId, "casesList"),
      "casesList"
    );

    await wipeCollection(
      collection(db, "cases", teamId, "closedCases"),
      "closedCases"
    );

    await wipeCollection(
      collection(db, "cases", teamId, "reports"),
      "reports"
    );

    // RESTORE
    await writeCollection(
      ["cases", teamId, "casesList"],
      data.casesList || [],
      "casesList"
    );

    await writeCollection(
      ["cases", teamId, "closedCases"],
      data.closedCases || [],
      "closedCases"
    );

    await writeCollection(
      ["cases", teamId, "reports"],
      data.reports || [],
      "reports"
    );

    showPopup("Full backup restore completed.");
  } catch (err) {
    console.error("Full restore failed:", err);
    showPopup("Full restore failed.");
  }

  processing = false;
}

async function generateDailyRepairReport({
     teamId,
     cases,
     todayISO,
     generatedBy,
     newCasesCount,
     deletedCasesCount
   }) {
     // ===============================
     // TOTAL OPEN
     // ===============================
     const onsiteAll = cases.filter(
       c => c.caseResolutionCode === "Onsite Solution"
     );
     const offsiteAll = cases.filter(
       c => c.caseResolutionCode === "Offsite Solution"
     );
     const csrAll = cases.filter(
       c => c.caseResolutionCode === "Parts Shipped"
     );
   
     // ===============================
     // READY FOR CLOSURE
     // ===============================
     const onsiteRFC = onsiteAll.filter(c =>
       ["Closed - Canceled", "Closed - Posted", "Open - Completed"]
         .includes(c.onsiteRFC)
     );
   
     const offsiteRFC = offsiteAll.filter(c =>
       ["Delivered", "Order cancelled, not to be reopened"].includes(c.benchRFC)
     );
   
     const csrRFC = csrAll.filter(c =>
       ["Cancelled", "Closed", "POD"].includes(c.csrRFC)
     );
   
     const rfcIds = new Set(
       [...onsiteRFC, ...offsiteRFC, ...csrRFC].map(c => c.id)
     );
   
     // ===============================
     // OVERDUE (NEGATIVE LOGIC)
     // ===============================
     let overdue = cases.filter(c => !rfcIds.has(c.id));
   
     overdue = overdue.filter(c => !(
       c.caseResolutionCode === "Onsite Solution" &&
       ["0-3 Days", "3-5 Days"].includes(c.caGroup)
     ));
   
     overdue = overdue.filter(c => !(
       c.caseResolutionCode === "Offsite Solution" &&
       ["0-3 Days", "3-5 Days", "5-10 Days"].includes(c.caGroup)
     ));
   
     overdue = overdue.filter(c => !(
       c.caseResolutionCode === "Parts Shipped" &&
       c.caGroup === "0-3 Days"
     ));
   
     // ===============================
     // WRITE REPORT
     // ===============================
   
      // ===============================
      // CA GROUP DISTRIBUTION (ALL CASES)
      // ===============================
      const caGroups = {
        "0-3 Days": 0,
        "3-5 Days": 0,
        "5-10 Days": 0,
        "10-15 Days": 0,
        "15-30 Days": 0,
        "30-60 Days": 0,
        "60-90 Days": 0,
        "> 90 Days": 0
      };
      
      cases.forEach(c => {
        if (caGroups[c.caGroup] !== undefined) {
          caGroups[c.caGroup]++;
        }
      });
      
      // Total cases > 30 days
      const caAbove30Total =
        caGroups["30-60 Days"] +
        caGroups["60-90 Days"] +
        caGroups["> 90 Days"];
      
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
          // TOTAL OPEN
          totalOpen: cases.length,
          totalOpenOnsite: onsiteAll.length,
          totalOpenOffsite: offsiteAll.length,
          totalOpenCSR: csrAll.length,
      
          // READY FOR CLOSURE
          readyForClosureTotal: rfcIds.size,
          readyForClosureOnsite: onsiteRFC.length,
          readyForClosureOffsite: offsiteRFC.length,
          readyForClosureCSR: csrRFC.length,
      
          // OVERDUE
          overdueTotal: overdue.length,
          overdueOnsite: overdue.filter(c =>
            c.caseResolutionCode === "Onsite Solution"
          ).length,
          overdueOffsite: overdue.filter(c =>
            c.caseResolutionCode === "Offsite Solution"
          ).length,
          overdueCSR: overdue.filter(c =>
            c.caseResolutionCode === "Parts Shipped"
          ).length,
      
          // CA GROUP
          ca_0_3: caGroups["0-3 Days"],
          ca_3_5: caGroups["3-5 Days"],
          ca_5_10: caGroups["5-10 Days"],
          ca_10_15: caGroups["10-15 Days"],
          ca_15_30: caGroups["15-30 Days"],
          ca_30_60: caGroups["30-60 Days"],
          ca_60_90: caGroups["60-90 Days"],
          ca_gt_90: caGroups["> 90 Days"],
          ca_gt_30_total: caAbove30Total,

          newCasesCount: newCasesCount || 0,
          deletedCasesCount: deletedCasesCount || 0,
           
          generatedAt: new Date(),
          generatedBy
        },
        { merge: true }
      );
      
      await cleanupDailyReports(teamId, todayISO);
      
      showPopup(`Daily repair report generated for ${todayISO}`);
}

/* ============================================================
   FIX — Enable Update Data Modal
   ============================================================ */
el.btnUpdateData.onclick = () => {
  el.tabManage.click();
  resetExcelUI();
};



const modalReassign       = document.getElementById("modalReassign");
const reassignTeamSelect  = document.getElementById("reassignTeamSelect");
const btnReassignClose    = document.getElementById("btnReassignClose");
const btnReassignDone     = document.getElementById("btnReassignDone");
const btnReassignConfirm  = document.getElementById("btnReassignConfirm");

const usersTableWrap      = document.getElementById("usersTableWrap");


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

  await openPreviewModal();
};


/* ============================================================
   GLOBAL ADMIN STATE
   ============================================================ */
export const adminState = {
  user: null,
  allTeams: []
};

// ================================================
// GLOBAL TEAM CONFIG FOR STATS (Admin)
// ================================================
let teamConfig = {
  resetTimezone: "UTC",
  resetHour: 0
};

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
  
});



/* ============================================================
   SECTION 2 — TAB SWITCHING
   ============================================================ */
function setupTabs() {

  // Main tabs

  el.tabUsers.onclick = () => {

    el.tabUsers.classList.add("active");
    el.tabManage.classList.remove("active");

    el.sectionUsers.style.display = "block";
    el.sectionManage.style.display = "none";
  };

  el.tabManage.onclick = () => {

    el.tabManage.classList.add("active");
    el.tabUsers.classList.remove("active");

    el.sectionManage.style.display = "block";
    el.sectionUsers.style.display = "none";

    activateManageUpdateData();
  };

  // Manage subtabs

  el.tabManageUpdateData.onclick = () => {
    activateManageUpdateData();
  };

  el.tabManageTeams.onclick = () => {
    activateManageTeams();
  };

  activateManageUpdateData();
}

function activateManageUpdateData() {

  el.tabManageUpdateData.classList.add("active");
  el.tabManageTeams.classList.remove("active");

  el.manageUpdateDataSection.style.display = "block";
  el.manageTeamsSection.style.display = "none";
}

function activateManageTeams() {

  el.tabManageTeams.classList.add("active");
  el.tabManageUpdateData.classList.remove("active");

  el.manageTeamsSection.style.display = "block";
  el.manageUpdateDataSection.style.display = "none";
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

  el.tabManage.click();
  activateManageTeams();
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

  const teamId = name
    .toUpperCase()
    .replace(/\s+/g, "_")
    .replace(/[^A-Z0-9_]/g, "");

  try {
    const teamRef = doc(db, "teams", teamId);

    const existing = await getDoc(teamRef);
    if (existing.exists()) {
      return showPopup("A team with this name already exists.");
    }

    await setDoc(teamRef, {
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
    showPopup(`Failed to create team.\n${err.message}`);
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
     const updatedTimezone = newTeamTimezone.dataset.value;
     const updatedResetHour = newTeamResetHour.dataset.value;
   
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
   CASCADE DELETE — FULL TEAM DATA CLEANUP
   Deletes:
   - casesList
   - closedCases
   - reports
   - closedCasesHistory (by teamId match)
   ======================================================================= */
async function deleteAllCasesForTeam(teamId) {

  const batchLimit = 400;

  async function deleteCollection(colRef, label) {
    const snap = await getDocs(colRef);

    let batch = [];
    let count = 0;

    for (const d of snap.docs) {
      batch.push(deleteDoc(d.ref));
      count++;

      if (batch.length >= batchLimit) {
        await Promise.all(batch);
        batch = [];
      }
    }

    if (batch.length > 0) {
      await Promise.all(batch);
    }

    console.log(`${label} deleted: ${count}`);
  }

  try {

    // ======================================================
    // 1️⃣ Delete OPEN CASES
    // ======================================================
    await deleteCollection(
      collection(db, "cases", teamId, "casesList"),
      "casesList"
    );

    // ======================================================
    // 2️⃣ Delete CLOSED CASES
    // ======================================================
    await deleteCollection(
      collection(db, "cases", teamId, "closedCases"),
      "closedCases"
    );

    // ======================================================
    // 3️⃣ Delete REPORTS
    // ======================================================
    await deleteCollection(
      collection(db, "cases", teamId, "reports"),
      "reports"
    );

    // ======================================================
    // 4️⃣ Delete CLOSED CASES HISTORY (GLOBAL COLLECTION)
    // ======================================================
    const historyQuery = query(
      collection(db, "closedCasesHistory"),
      where("teamId", "==", teamId)
    );

    const historySnap = await getDocs(historyQuery);

    let historyBatch = [];
    let historyCount = 0;

    for (const d of historySnap.docs) {
      historyBatch.push(deleteDoc(d.ref));
      historyCount++;

      if (historyBatch.length >= batchLimit) {
        await Promise.all(historyBatch);
        historyBatch = [];
      }
    }

    if (historyBatch.length > 0) {
      await Promise.all(historyBatch);
    }

    console.log(`closedCasesHistory deleted: ${historyCount}`);

  } catch (err) {
    console.error("Full cascade delete failed:", err);
    throw err;
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
  if ($("allowDeletion"))
    $("allowDeletion").checked = false;
   
  if ($("updateDailyReport"))
    $("updateDailyReport").checked = false;

  clearProgress();

  // Reset modal preview buttons if preview modal was opened
  if ($("btnConfirmImport"))
    $("btnConfirmImport").disabled = false;
   
  if ($("allowDeletion"))
    $("allowDeletion").disabled = false;

   $("previewSection").style.display = "none";
   $("previewCounts").innerHTML = "";
   excelState.isBackupImport = false;

   // Hide overwrite option by default (Excel upload)
   const overwriteWrap = document.getElementById("overwriteWrap");
   if (overwriteWrap) {
     overwriteWrap.style.display = "none";
   }
   excelState.fullBackupData = null;
   excelState.isFullRestore = false;
}

function excelToDate(value) {
  if (!value) return "";

  try {
    // If already a Date object
    if (value instanceof Date && !isNaN(value)) {
      return value.toISOString().split("T")[0];
    }

    // If numeric Excel serial date
    if (typeof value === "number") {
      const epoch = new Date(Date.UTC(1899, 11, 30));
      const d = new Date(epoch.getTime() + value * 86400000);
      if (!isNaN(d)) {
        return d.toISOString().split("T")[0];
      }
    }

    // If string date
    if (typeof value === "string") {
      const parsed = new Date(value);
      if (!isNaN(parsed)) {
        return parsed.toISOString().split("T")[0];
      }
    }

    // If none of the above
    return "";
  } catch (err) {
    console.warn("Invalid date encountered in Excel:", value);
    return "";
  }
}

function excelToDateTime(value) {
  if (!value) return null;

  try {
    // If already Date
    if (value instanceof Date && !isNaN(value)) {
      return value;
    }

    // Excel numeric date-time
    if (typeof value === "number") {
      const epoch = new Date(Date.UTC(1899, 11, 30));
      const ms = value * 86400000;
      const date = new Date(epoch.getTime() + ms);

      return isNaN(date) ? null : date;
    }

    // String date-time
    if (typeof value === "string") {
      const parsed = new Date(value);
      return isNaN(parsed) ? null : parsed;
    }

    return null;
  } catch (err) {
    console.warn("Invalid datetime:", value);
    return null;
  }
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
  try {
    showPopup("Preparing full backup...");

    // Load casesList
    const casesSnap = await getDocs(
      collection(db, "cases", teamId, "casesList")
    );
    const casesList = casesSnap.docs.map(d => ({
      id: d.id,
      ...d.data()
    }));

    // Load closedCases
    const closedSnap = await getDocs(
      collection(db, "cases", teamId, "closedCases")
    );
    const closedCases = closedSnap.docs.map(d => ({
      id: d.id,
      ...d.data()
    }));

    // Load reports
    const reportsSnap = await getDocs(
      collection(db, "cases", teamId, "reports")
    );
    const reports = reportsSnap.docs.map(d => ({
      id: d.id,
      ...d.data()
    }));

    const today = getTeamToday(teamConfig);

    const backup = {
      version: 3,
      app: "KCI Case Tracker",
      exportedAt: new Date().toISOString(),
      teamId,
      casesList,
      closedCases,
      reports
    };

    const blob = new Blob(
      [JSON.stringify(backup, null, 2)],
      { type: "application/json" }
    );

    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");

    a.href = url;
    a.download = `${teamId}_backup_v3_${today}.json`;
    a.click();

    URL.revokeObjectURL(url);

    showPopup("Full backup exported.");
  } catch (err) {
    console.error("Backup export failed:", err);
    showPopup("Backup export failed.");
  }
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

   // ✅ Import backup mode
   excelState.isBackupImport = true;
   
   // Show overwrite checkbox ONLY for import
   const overwriteWrap = document.getElementById("overwriteWrap");
   if (overwriteWrap) {
     overwriteWrap.style.display = "block";
     $("overwriteUserActions").checked = true; // sensible default for restore
   }

    clearProgress();
    updateProgress("Reading backup file...");

    const text = await file.text();
    const data = JSON.parse(text);

    await parseBackupFile(data);  // NEW

    updateProgress("Import mode: Backup restore");
     
    validateReadyState();
  };

  input.click();
}


/* small helper to escape HTML (reused from index.js) */
function escapeHtml(s) {
  return String(s || "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c]));
}


// TEMP DEBUG FUNCTION
window.moveReports = async function () {

  const teams = [
    "EMEA_ACS",
    "EMEA_ADX",
    "EMEA_PRIORITY",
    "EMEA_TRADE",
    "EMEA_OTHERS"
  ];

  const oldDate = "2026-05-28";
  const newDate = "2026-05-27";

  for (const teamId of teams) {

    try {

      const oldRef = doc(
        db,
        "cases",
        teamId,
        "reports",
        oldDate
      );

      const newRef = doc(
        db,
        "cases",
        teamId,
        "reports",
        newDate
      );

      const snap = await getDoc(oldRef);

      if (!snap.exists()) {
        console.log(`❌ Missing report for ${teamId}`);
        continue;
      }

      const data = snap.data();

      // Create/overwrite new doc
      await setDoc(newRef, data);

      // Delete old doc
      await deleteDoc(oldRef);

      console.log(`✅ Moved ${teamId}: ${oldDate} → ${newDate}`);

    } catch (err) {

      console.error(`❌ Failed for ${teamId}`, err);

    }
  }

  console.log("🎉 Done");
};












