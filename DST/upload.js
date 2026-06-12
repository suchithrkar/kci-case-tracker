/* =======================================================
   DST Upload Engine
   ======================================================= */

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
} from "../js/firebase.js";

import { isPrimary, isSecondary, toggleTheme } from "../js/userProfile.js";
import { showPopup } from "../js/utils.js";
import { cleanupDailyReports } from "../js/utils.js";

console.log("DST upload.js loaded");

export const excelState = {
  teamId: null,
  file: null,
  rawRows: [],
  excelCases: [],
  firestoreCases: [],
  closedCases: [],
  diff: { new: [], updated: [], deleted: [] }
};

let processing = false;
let uploadTeams = [];
let adminUserId = null;

export function setUploadUser(uid) { 
  adminUserId = uid;
  console.log("SET USER =", uid); 
}

const $ = (id) => document.getElementById(id);

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

function excelColLetter(index) {
  let col = "";
  let n = index + 1;

  while (n > 0) {
    const rem = (n - 1) % 26;
    col = String.fromCharCode(65 + rem) + col;
    n = Math.floor((n - 1) / 26);
  }

  return col;
}

function getTeamToday(teamConfig) {
  const timezone =
    teamConfig?.resetTimezone || "UTC";

  const resetHour =
    typeof teamConfig?.resetHour === "number"
      ? teamConfig.resetHour
      : 0;

  const now = new Date();

  const formatter =
    new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      hour12: false
    });

  const parts = Object.fromEntries(
    formatter.formatToParts(now)
      .map(p => [p.type, p.value])
  );

  let teamDate =
    `${parts.year}-${parts.month}-${parts.day}`;

  const teamHour =
    Number(parts.hour);

  if (teamHour < resetHour) {
    const d =
      new Date(`${teamDate}T00:00:00Z`);

    d.setUTCDate(
      d.getUTCDate() - 1
    );

    teamDate =
      d.toISOString().split("T")[0];
  }

  return teamDate;
}

function validateReadyState() {
  let ready = false;

  if (excelState.isFullRestore && excelState.fullBackupData) {
    ready = true;
  } else {
    ready =
      excelState.teamId &&
      excelState.file &&
      excelState.excelCases.length > 0;
  }

  $("btnPreviewChanges").disabled = !ready;
}

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
  $("updateDailyReport").checked = false;

  clearProgress();

  // Reset modal preview buttons if preview modal was opened
  $("btnConfirmImport").disabled = false;
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
    if (value instanceof Date && !isNaN(value)) {
      return value.toISOString().split("T")[0];
    }

    if (typeof value === "number") {
      const epoch = new Date(Date.UTC(1899, 11, 30));
      const d = new Date(epoch.getTime() + value * 86400000);

      if (!isNaN(d)) {
        return d.toISOString().split("T")[0];
      }
    }

    if (typeof value === "string") {
      const parsed = new Date(value);

      if (!isNaN(parsed)) {
        return parsed.toISOString().split("T")[0];
      }
    }

    return "";
  } catch {
    return "";
  }
}

function excelToDateTime(value) {
  if (!value) return null;

  try {
    if (value instanceof Date && !isNaN(value)) {
      return value;
    }

    if (typeof value === "number") {
      const epoch = new Date(Date.UTC(1899, 11, 30));
      const ms = value * 86400000;
      const date = new Date(epoch.getTime() + ms);

      return isNaN(date) ? null : date;
    }

    if (typeof value === "string") {
      const parsed = new Date(value);
      return isNaN(parsed) ? null : parsed;
    }

    return null;
  } catch {
    return null;
  }
}

async function parseBackupFile(data) {
  let backup;

  if (Array.isArray(data)) {
    backup = {
      version: 1,
      teamId: null,
      cases: data
    };
  } else if (data.version === 3 && data.casesList) {
    backup = data;
  } else {
    alert("Invalid backup format.");
    return;
  }

  if (backup.teamId && backup.teamId !== excelState.teamId) {
    alert(
      `This backup belongs to another team.\n\nBackup Team: ${backup.teamId}`
    );
    return;
  }

  updateProgress(`Backup loaded (v${backup.version}).`);
  updateProgress(`Open Cases: ${backup.casesList?.length || 0}`);
  updateProgress(`Closed Cases: ${backup.closedCases?.length || 0}`);
  updateProgress(`Reports: ${backup.reports?.length || 0}`);

  excelState.fullBackupData = backup;
  excelState.isFullRestore = true;
  excelState.isBackupImport = true;
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

async function populateUpdateDataTeams() {
  const updateTeamList =
    document.getElementById("updateTeamList");

  if (!updateTeamList) return;

  updateTeamList.innerHTML = "";

  uploadTeams
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name))
    .forEach(t => {
      const row = document.createElement("div");

      row.style.marginBottom = "0.4rem";

      row.innerHTML = `
        <div style="
          display:flex;
          justify-content:space-between;
          align-items:center;
          padding:0.4rem 0;
        ">
          <div><strong>${t.name}</strong></div>

          <div style="display:flex; gap:0.4rem;">

              <button
                class="action-btn btn-boxed"
                data-action="upload"
                data-id="${t.id}"
                style="
                  padding:0.35rem 0.6rem;
                  font-size:13px;
                  height:32px;
                "
              >
                Upload Excel
              </button>
            
              <button
                class="action-btn btn-boxed"
                data-action="export"
                data-id="${t.id}"
                style="
                  padding:0.35rem 0.6rem;
                  font-size:13px;
                  height:32px;
                "
              >
                Export Backup
              </button>
            
              <button
                class="action-btn btn-boxed"
                data-action="import"
                data-id="${t.id}"
                style="
                  padding:0.35rem 0.6rem;
                  font-size:13px;
                  height:32px;
                "
              >
                Import Backup
              </button>
            
            </div>
        </div>
      `;

      updateTeamList.appendChild(row);
    });
}

async function loadUploadTeams() {
  uploadTeams = [];

  const snap = await getDocs(collection(db, "teams"));
   
  snap.forEach(d => {
    const team = {
      id: d.id,
      ...d.data()
    };
   
    // Only DST teams
    if (team.groupId === "DST") {
      uploadTeams.push(team);
    }
   });

  await populateUpdateDataTeams();
}

function bindUploadTeamSelection() {
  const updateTeamList =
    document.getElementById("updateTeamList");

  if (!updateTeamList) return;

  updateTeamList.addEventListener(
    "click",
    async (e) => {
      const btn =
        e.target.closest("button");

      if (!btn) return;

      const action =
        btn.dataset.action;

      const teamId =
        btn.dataset.id;

      if (action === "upload") {
      
        excelState.teamId = teamId;
      
        $("uploadSummary").innerHTML =
          `<strong>Selected Team:</strong> ${teamId}`;
      
        validateReadyState();
        return;
      }
       
      if (action === "export") {
        exportBackup(teamId);
        return;
      }
      
      if (action === "import") {
        importBackupPrompt(teamId);
        return;
      } 
    }
  );
}

async function loadFirestoreCasesForTeam(teamId) {
  updateProgress(
    "Loading existing Firestore cases..."
  );

  try {
    const colRef =
      collection(
        db,
        "DST",
        teamId,
        "3wList"
      );

    const snap =
      await getDocs(colRef);

    excelState.firestoreCases =
      snap.docs.map(d => ({
        id: d.id,
        ...d.data()
      }));

  } catch (err) {
    console.error(
      "Firestore read failed:",
      err
    );

    alert(
      "Could not load Firestore cases."
    );
  }
}

// ======================================================
// COMPARE EXCEL CASES vs FIRESTORE CASES
// ======================================================
function stripUserFields(obj) {
  const clone = { ...obj };

  delete clone.status;
  delete clone.followDate;
  delete clone.followTime;
  delete clone.flagged;
  delete clone.pns;
  delete clone.surveyPrediction;
  delete clone.predictionComment;
  delete clone.notes;
  delete clone.lastActionedOn;
  delete clone.lastActionedBy;
  delete clone.statusChangedOn;
  delete clone.statusChangedBy;

  return clone;
}

function computeDiff() {
  const excelMap = new Map();
  excelState.excelCases.forEach(c =>
    excelMap.set(c.id, c)
  );

  const fsMap = new Map();
  excelState.firestoreCases.forEach(c =>
    fsMap.set(c.id, c)
  );

  const diff = {
    new: [],
    updated: [],
    deleted: []
  };

  for (const ex of excelState.excelCases) {
    const fs = fsMap.get(ex.id);

    if (!fs) {
      diff.new.push(ex);
      continue;
    }

    // Full backup restore mode
    if (
      excelState.isBackupImport &&
      $("overwriteUserActions")?.checked
    ) {
      diff.updated.push(ex);
      continue;
    }

    const changed =
      JSON.stringify(
        stripUserFields(ex)
      ) !==
      JSON.stringify(
        stripUserFields(fs)
      );

    if (changed) {
      diff.updated.push(ex);
    }
  }

  for (const fs of excelState.firestoreCases) {
    if (!excelMap.has(fs.id)) {
      diff.deleted.push(fs);
    }
  }

  excelState.diff = diff;
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
  $("previewSection").style.display =
    "none";

  clearProgress();

  excelState.diff = {
    new: [],
    updated: [],
    deleted: []
  };
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

     console.log("REPORT USER =", adminUserId); 
     await generateDailyRepairReport({
       teamId: excelState.teamId,
       cases: excelState.excelCases,
       todayISO,
       generatedBy: adminUserId, 

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

export function initializeUploadModule() {
  console.log("initializeUploadModule started"); 
  const btnUpdateData = document.getElementById("btnUpdateData");
  const btnUpdateDone = document.getElementById("btnUpdateDone"); 
  const modalUpdateData = document.getElementById("modalUpdateData");
  const btnUpdateClose = document.getElementById("btnUpdateClose");
  const excelInput = document.getElementById("excelInput");

  loadUploadTeams();
  bindUploadTeamSelection(); 

  console.log("btnUpdateData found:", !!btnUpdateData); 
  if (btnUpdateData) {
    btnUpdateData.addEventListener("click", () => {
      resetExcelUI();
      modalUpdateData.classList.add("show");
    });
  }

  if (btnUpdateClose) {
    btnUpdateClose.addEventListener("click", () => {
      resetExcelUI();
      modalUpdateData.classList.remove("show");
    });
  }

  if (btnUpdateDone) {
    btnUpdateDone.addEventListener("click", () => {
      resetExcelUI();
      modalUpdateData.classList.remove("show");
    });
  }

  if (excelInput) {
     excelInput.onchange = async (e) => {
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
   
       await parseExcelFile(file);
   
       validateReadyState();
     };
   }

   const btnPreviewChanges = document.getElementById("btnPreviewChanges");
   
   if (btnPreviewChanges) {
     btnPreviewChanges.onclick =
       async () => {
   
         clearProgress();
   
         updateProgress(
           "Preparing preview..."
         );
   
         if (!excelState.teamId) {
           return alert(
             "Select a team."
           );
         }
   
         if (!excelState.file) {
           return alert(
             "Select an Excel file."
           );
         }
   
         await loadFirestoreCasesForTeam(
           excelState.teamId
         );
   
         updateProgress(
           "Comparing Excel → Firestore..."
         );
   
         computeDiff();
   
         await openPreviewModal();
       };
   }
   
}
