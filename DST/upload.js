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
  if ($("updateDailyReport")) {
    $("updateDailyReport").checked = false;
  }

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

  if (
    data.version === 4 &&
    data.casesList
  ) {
    backup = data;
  } else {
    alert("Invalid DST backup format.");
    return;
  }

  if (
    backup.teamId &&
    backup.teamId !==
      excelState.teamId
  ) {
    alert(`This backup belongs to another team.\n\nBackup Team: ${backup.teamId}`);
    return;
  }

  updateProgress(`Backup loaded (v${backup.version}).`);
  updateProgress(`Cases: ${backup.casesList.length}`);

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

      const sheetName = wb.SheetNames[0];

      const dstSheet =
        wb.Sheets[sheetName];

      if (!dstSheet) {
        alert("DST worksheet not found.");
        resolve();
        return;
      }

      const rows = XLSX.utils.sheet_to_json(dstSheet, { header: 1 });

      const expectedHeaders = {
        3: "Ticket Number",
        15: "Case ID",
        40: "Status",
        48: "Notes History",
        49: "Product Name"
      };

      const headerRow = rows[0] || [];
      const headerErrors = [];

      Object.entries(expectedHeaders).forEach(
        ([index, expected]) => {

          const actual =
            String(
              headerRow[index] || ""
            ).trim();

          if (
            !actual ||
            !actual
              .toLowerCase()
              .includes(
                expected.toLowerCase()
              )
          ) {
            headerErrors.push(
              `Column ${excelColLetter(Number(index))}: expected "${expected}", found "${actual || "EMPTY"}"`
            );
          }
        }
      );

      if (headerErrors.length > 0) {

        clearProgress();

        alert("DST Excel format validation failed.\n\n" + headerErrors.join("\n"));

        excelState.excelCases = [];
        excelState.rawRows = [];

        resolve();
        return;
      }

      excelState.rawRows = rows;

      updateProgress("Excel loaded. Processing rows...");

      const parsed = [];

      for (let i = 1; i < rows.length; i++) {
        const r = rows[i];
        if (!r) continue;
        const id = String(r[15] || "").trim();
        if (!id) continue;
        parsed.push({
          id,
          ticketNumber: String(r[3] || "").trim(),
          createdOn: excelToDate(r[4]),
          category: String(r[5] || "").trim(),
          subCategory: String(r[6] || "").trim(),
          ticketStatus: String(r[7] || "").trim(),
          ticketUrl: String(r[8] || "").trim(),
          threeWNotes: String(r[9] || "").trim(),
          createdBy: String(r[10] || "").trim(),
          materialOrder: String(r[11] || "").trim(),
          materialOrderLineItem: String(r[12] || "").trim(),
          owner: String(r[13] || "").trim(),
          owningBusinessUnit: String(r[14] || "").trim(),
          caseIdMaterialOrder: String(r[15] || "").trim(),
          countryMaterialOrder: String(r[16] || "").trim(),
          materialOrderCreatedOn: excelToDate(r[17]),
          orderStatus: String(r[18] || "").trim(),
          orderType: String(r[19] || "").trim(),
          salesOrderNumber: String(r[20] || "").trim(),
          materialOrderStatus: String(r[21] || "").trim(),
          materialOrderStatusReason: String(r[22] || "").trim(),
          modifiedOn: excelToDateTime(r[23]),
          atpStatus: String(r[24] || "").trim(),
          lineItemCreatedOn: excelToDate(r[25]),
          expectedDeliveryDate: excelToDate(r[26]),
          expectedShipDate: excelToDate(r[27]),
          promisedDateDifferent: String(r[28] || "").trim(),
          isEscalated: String(r[29] || "").trim(),
          lineNumber: String(r[30] || "").trim(),
          lineItemMaterialOrder: String(r[31] || "").trim(),
          moLineItemsName: String(r[32] || "").trim(),
          lineItemModifiedOn: excelToDateTime(r[33]),
          promisedDate: excelToDate(r[34]),
          shipPlant: String(r[35] || "").trim(),
          lineItemStatus: String(r[36] || "").trim(),
          lineItemStatusReason: String(r[37] || "").trim(),
          trackingNumber: String(r[38] || "").trim(),
          workOrder: String(r[39] || "").trim(),
          statusExcel: String(r[40] || "").trim(),
          statusReasonExcel: String(r[41] || "").trim(),
          workgroup: String(r[42] || "").trim(),
          queue: String(r[43] || "").trim(),
          ticketOwner3W: String(r[44] || "").trim(),
          is3WComment: String(r[45] || "").trim(),
          latest3WStatusChangeDateTime: excelToDateTime(r[46]),
          latestNotesUpdateDateTime: excelToDateTime(r[47]),
          notesHistory: String(r[48] || "").trim(),
          productName: String(r[49] || "").trim(),

          excelOrder: i
        });
      }

      // =====================================================
      // GROUP ROWS BY CASE ID
      // =====================================================
      
      const caseMap = new Map();
       
      parsed.forEach(row => {
        if (!caseMap.has(row.id)) {
          caseMap.set(row.id, {
            id: row.id,
            rowCount: 1,
            hasMultipleRows: false,
            rows: [row]
          });
        } else {
          const existing = caseMap.get(row.id);
          existing.rows.push(row);
          existing.rowCount = existing.rows.length;
          existing.hasMultipleRows = existing.rows.length > 1;
        }
      });
      
      excelState.excelCases = Array.from(caseMap.values());
      
      updateProgress(`Unique Cases: ${excelState.excelCases.length}`);
      
      const multiCases =
        excelState.excelCases.filter(
          c => c.hasMultipleRows
        ).length;
      
      updateProgress(`Cases With Multiple Rows: ${multiCases}`);

      const maxRows =
        Math.max(
          ...excelState.excelCases.map(
            c => c.rowCount
          )
        );
      
      updateProgress(
        `Maximum Rows In Single Case: ${maxRows}`
      ); 

      // DST has no closed cases sheet
      excelState.closedCases = [];
      updateProgress(`Excel loaded.\nTotal valid rows: ${parsed.length}`);
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
    showPopup("Preparing DST backup...");

    const snap =
      await getDocs(
        collection(
          db,
          "DST",
          teamId,
          "3wList"
        )
      );

    const casesList =
      snap.docs.map(d => ({
        id: d.id,
        ...d.data()
      }));

    const today =
      new Date()
        .toISOString()
        .split("T")[0];

    const backup = {
      version: 4,
      app: "DST Tracker",
      exportedAt:
        new Date().toISOString(),
      teamId,
      casesList
    };

    const blob =
      new Blob(
        [
          JSON.stringify(
            backup,
            null,
            2
          )
        ],
        {
          type: "application/json"
        }
      );

    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");

    a.href = url;
    a.download = `${teamId}_DST_Backup_${today}.json`;
    a.click();

    URL.revokeObjectURL(url);

    showPopup("DST backup exported.");

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
      snap.docs.map(d => {
        const data = d.data();
        return {
          id: d.id,
          ...data,
          rowCount: data.rowCount || 1,
          hasMultipleRows: data.hasMultipleRows || false,
          rows:
            Array.isArray(data.rows)
              ? data.rows
              : []
        };
      });
     
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
  delete clone.notes;
  delete clone.lastActionedOn;
  delete clone.lastActionedBy;
  delete clone.statusChangedOn;
  delete clone.statusChangedBy;

  delete clone.teamId; 
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

  $("previewSection").style.display = "block";

  $("deleteCheckboxWrap").style.display =
    d.deleted.length > 0
      ? "block"
      : "none";

  $("allowDeletion").checked = false;

  $("btnConfirmImport").disabled =
    d.deleted.length > 0;

  if (d.deleted.length > 0) {
    $("allowDeletion").onchange = () => {
      $("btnConfirmImport").disabled =
        !$("allowDeletion").checked;
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

  const d = excelState.diff;
   
  // Safety: deletions require checkbox
  if (d.deleted.length > 0 && !$("allowDeletion").checked) {
    return showPopup("Enable 'Allow deletion' to continue.");
  }
   
  processing = true;

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
  const {
    new: newCases,
    updated,
    deleted
  } = excelState.diff;

  updateProgress(`Preparing to write data...`);
  updateProgress(`New: ${newCases.length}`);
  updateProgress(`Updated: ${updated.length}`);
  updateProgress(`Deleted: ${deleted.length}`);

  const batchLimit = 400;

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
    // NEW CASES
    // ======================================================
    updateProgress("\nCreating NEW cases...");

    await runBatches(
      newCases.map(ex =>
        setDoc(
          doc(
            db,
            "DST",
            excelState.teamId,
            "3wList",
            ex.id
          ),
          {
            id: ex.id,
          
            rowCount: ex.rowCount || 1,
         
            hasMultipleRows: ex.hasMultipleRows || false,
         
            rows: ex.rows || [],
         
            teamId: excelState.teamId,
         
            status: "",
            followDate: "",
            followTime: "",
            flagged: false,
            notes: "",
            lastActionedOn: "",
            lastActionedBy: "",
            statusChangedOn: "",
            statusChangedBy: ""
          }
        )
      ),
      "New"
    );

    // ======================================================
    // UPDATED CASES
    // ======================================================
    updateProgress("\nUpdating existing cases...");

    await runBatches(
      updated.map(ex => {

        const existing =
          excelState.firestoreCases.find(
            c => c.id === ex.id
          );

        const overwrite =
          excelState.isBackupImport &&
          $("overwriteUserActions")
            ?.checked;

        let data = {
          id: ex.id,
          rowCount: ex.rowCount || 1,
          hasMultipleRows: ex.hasMultipleRows || false,
          rows: ex.rows || [],
          teamId: excelState.teamId
        };

        if (
          !overwrite &&
          existing
        ) {

          const preserve = [
            "status",
            "followDate",
            "followTime",
            "flagged",
            "notes",
            "lastActionedOn",
            "lastActionedBy",
            "statusChangedOn",
            "statusChangedBy"
          ];

          preserve.forEach(f => {
            if (
              existing[f] !== undefined
            ) {
              data[f] =
                existing[f];
            }
          });
        }

        return setDoc(
          doc(
            db,
            "DST",
            excelState.teamId,
            "3wList",
            ex.id
          ),
          data,
          { merge: true }
        );
      }),
      "Updated"
    );

    // ======================================================
    // DELETED CASES
    // ======================================================
    if (deleted.length > 0) {
      updateProgress("\nDeleting missing cases...");

      await runBatches(
        deleted.map(c =>
          deleteDoc(
            doc(
              db,
              "DST",
              excelState.teamId,
              "3wList",
              c.id
            )
          )
        ),
        "Deleted"
      );
    }

  } catch (err) {
    console.error("Case update failed:",err);
    showPopup("❌ Case update failed.");
    processing = false;
    return;
  }

  // ======================================================
  // SUMMARY
  // ======================================================
  updateProgress("\n-----------------------------------");
  updateProgress("UPDATE COMPLETE");
  updateProgress(`New: ${newCases.length}`);
  updateProgress(`Updated: ${updated.length}`);
  updateProgress(`Deleted: ${deleted.length}`);

   // ======================================================
   // VERIFY ACTUAL FIRESTORE DOCUMENT COUNT
   // ======================================================
   
   const verifySnap = await getDocs(
     collection(
       db,
       "DST",
       excelState.teamId,
       "3wList"
     )
   );
   
   updateProgress(
     `Firestore Documents: ${verifySnap.size}`
   );
   
   console.log(
     "POST-UPLOAD FIRESTORE COUNT:",
     verifySnap.size
   );
   
  updateProgress("-----------------------------------");
  showPopup("Excel update complete!");

  processing = false;
}

async function applyFullRestore() {
  const teamId = excelState.teamId;
  const data = excelState.fullBackupData;

  updateProgress("Starting FULL DST RESTORE...");

  const batchLimit = 400;

  async function wipeCollection(colRef, label) {
    const snap = await getDocs(colRef);

    let batch = [];
    let count = 0;

    for (const d of snap.docs) {
      batch.push(deleteDoc(d.ref));
      count++;

      if (
        batch.length >=
        batchLimit
      ) {
        await Promise.all(batch);
        batch = [];
      }
    }

    if (batch.length) {
      await Promise.all(batch);
    }
    updateProgress(`${label} wiped (${count})`);
  }

  async function writeCollection(colPath, docs, label) {
    let batch = [];
    let count = 0;

    for (const d of docs) {
      const ref =
        doc(
          db,
          ...colPath,
          d.id
        );

      batch.push(setDoc(ref, d));
      count++;

      if (
        batch.length >= batchLimit
      ) {
        await Promise.all(batch);
        batch = [];
      }
    }

    if (batch.length) {
      await Promise.all(batch);
    }
     
    updateProgress(`${label} restored (${count})`);
  }

  try {

    await wipeCollection(
      collection(
        db,
        "DST",
        teamId,
        "3wList"
      ),
      "3wList"
    );

    await writeCollection(
      [
        "DST",
        teamId,
        "3wList"
      ],
      data.casesList || [],
      "3wList"
    );

    showPopup("DST backup restore completed.");
  } catch (err) {
    console.error("Full restore failed:", err);
    showPopup("Full restore failed.");
  }

  processing = false;
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
