/* ======================================================
   DST Upload Engine
   ====================================================== */

import {
  db,
  collection,
  getDocs,
  doc,
  getDoc
} from "../js/firebase.js";

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

          <div>
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
          </div>
        </div>
      `;

      updateTeamList.appendChild(row);
    });
}

async function loadUploadTeams() {
  uploadTeams = [];

  const snap =
    await getDocs(collection(db, "teams"));

  snap.forEach(d => {
    uploadTeams.push({
      id: d.id,
      ...d.data()
    });
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

      if (action !== "upload") return;

      excelState.teamId = teamId;

      $("uploadSummary").innerHTML =
        `<strong>Selected Team:</strong> ${teamId}`;

      validateReadyState();
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
        "cases",
        teamId,
        "casesList"
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

export function initializeUploadModule() {
  const btnUpdateData = document.getElementById("btnUpdateData");
  const btnUpdateDone = document.getElementById("btnUpdateDone"); 
  const modalUpdateData = document.getElementById("modalUpdateData");
  const btnUpdateClose = document.getElementById("btnUpdateClose");
  const excelInput = document.getElementById("excelInput");

  loadUploadTeams();
  bindUploadTeamSelection(); 

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
