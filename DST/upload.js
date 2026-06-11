/* ======================================================
   DST Upload Engine
   ====================================================== */

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

export function initializeUploadModule() {
  const btnUpdateData =
    document.getElementById("btnUpdateData");

  const btnUpdateDone =
     document.getElementById("btnUpdateDone"); 

  const modalUpdateData =
    document.getElementById("modalUpdateData");

  const btnUpdateClose =
    document.getElementById("btnUpdateClose");

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
   
}
