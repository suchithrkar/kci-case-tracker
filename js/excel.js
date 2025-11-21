// excel.js
import { auth, db } from "./firebase-config.js";
import {
  collection, getDocs, doc, setDoc, deleteDoc
} from "https://www.gstatic.com/firebasejs/12.5.0/firebase-firestore.js";

import { populateDataTeams } from "./admin.js";


// ==================================================================
// LOAD XLSX LIBRARY DYNAMICALLY
// ==================================================================
let XLSXLoaded = false;

async function loadXLSX() {
  if (XLSXLoaded) return;

  await import("https://cdn.jsdelivr.net/npm/xlsx/dist/xlsx.full.min.js");
  XLSXLoaded = true;
}


// ==================================================================
// INITIALIZE EXCEL MODULE FOR TEAM LIST
// Called from admin.js when Data tab is opened.
// ==================================================================
export function initExcelModuleForTeams() {
  attachExcelListeners();
}


// ==================================================================
// ATTACH LISTENERS TO FILE INPUTS (UPLOAD + IMPORT)
// ==================================================================
function attachExcelListeners() {

  document.querySelectorAll(".fileExcel").forEach(input => {
    input.onchange = async (e) => {
      const team = input.dataset.team;
      const file = e.target.files[0];

      if (!file) return;
      await handleExcelUpload(team, file);

      input.value = "";
    };
  });

  document.querySelectorAll(".btnExport").forEach(btn => {
    btn.onclick = async () => {
      const team = btn.dataset.team;
      await exportTeamBackup(team);
    };
  });

  document.querySelectorAll(".fileImport").forEach(input => {
    input.onchange = async (e) => {
      const team = input.dataset.team;
      const file = e.target.files[0];

      if (!file) return;
      await importTeamBackup(team, file);

      input.value = "";
    };
  });
}


// ==================================================================
// HANDLE EXCEL UPLOAD FOR A TEAM
// ==================================================================
async function handleExcelUpload(team, file) {

  await loadXLSX();

  const data = await file.arrayBuffer();
  const workbook = XLSX.read(data);
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet);

  if (rows.length === 0) {
    alert("Excel contains no rows.");
    return;
  }

  // Step A: Load current Firestore cases
  const currentSnap = await getDocs(collection(db, `cases_${team}`));
  const currentMap = {};

  currentSnap.forEach(docSnap => {
    currentMap[docSnap.id] = docSnap.data();
  });

  const excelIDs = rows.map(r => String(r["Case ID"]).trim());

  // Step B: Delete missing cases (closed cases)
  for (const oldID of Object.keys(currentMap)) {
    if (!excelIDs.includes(oldID)) {
      await deleteDoc(doc(db, `cases_${team}`, oldID));
    }
  }

  // Step C: Merge rows
  for (const row of rows) {
    const caseID = String(row["Case ID"]).trim();
    const rawData = formatExcelRow(row);

    if (currentMap[caseID]) {
      // Update dynamic fields only
      const prev = currentMap[caseID];
      await setDoc(doc(db, `cases_${team}`, caseID), {
        ...rawData,

        // preserve manual fields
        status: prev.status ?? "Service Pending",
        notes: prev.notes ?? "",
        flagged: prev.flagged ?? false,
        followDate: prev.followDate ?? "",
        lastActionedBy: prev.lastActionedBy ?? "",
        lastActionedOn: prev.lastActionedOn ?? ""
      });
    } else {
      // New case — create with defaults for manual fields
      await setDoc(doc(db, `cases_${team}`, caseID), {
        ...rawData,
        status: "Service Pending",
        notes: "",
        flagged: false,
        followDate: "",
        lastActionedBy: "",
        lastActionedOn: ""
      });
    }
  }

  alert("Excel updated successfully.");
}


// ==================================================================
// FORMAT EXCEL ROW → Firestore format
// ==================================================================
function formatExcelRow(row) {

  // Your Excel headers (must match exactly):
  // Case ID, Customer Name, Country, Case Resolution Code, Case Owner, CA Group, SBD, ModifiedOn

  return {
    "Case ID": String(row["Case ID"] ?? "").trim(),
    "Customer Name": row["Customer Name"] ?? "",
    "Country": row["Country"] ?? "",
    "Case Resolution Code": row["Case Resolution Code"] ?? "",
    "Case Owner": row["Case Owner"] ?? "",
    "CA Group": row["CA Group"] ?? "",
    "SBD": row["SBD"] ?? "",
    "ModifiedOn": excelDateToISO(row["ModifiedOn"])
  };
}


// ==================================================================
// EXCEL DATE → yyyy-mm-dd
// ==================================================================
function excelDateToISO(value) {
  if (!value) return "";

  if (typeof value === "string") {
    if (!isNaN(Date.parse(value))) {
      return new Date(value).toISOString().split("T")[0];
    }
    return "";
  }

  // Excel number format
  if (typeof value === "number") {
    const date = XLSX.SSF.parse_date_code(value);
    const yyyy = String(date.y);
    const mm = String(date.m).padStart(2, "0");
    const dd = String(date.d).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
  }

  return "";
}


// ==================================================================
// EXPORT TEAM BACKUP → .json file
// ==================================================================
async function exportTeamBackup(team) {

  const snap = await getDocs(collection(db, `cases_${team}`));
  const arr = [];

  snap.forEach(docSnap => {
    arr.push({
      id: docSnap.id,
      ...docSnap.data()
    });
  });

  const blob = new Blob([JSON.stringify(arr, null, 2)], {
    type: "application/json"
  });

  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");

  a.href = url;
  a.download = `${team}_backup.json`;
  a.click();

  URL.revokeObjectURL(url);
}


// ==================================================================
// IMPORT TEAM BACKUP → from .json file
// ==================================================================
async function importTeamBackup(team, file) {

  const text = await file.text();
  let arr = [];

  try {
    arr = JSON.parse(text);
  } catch (e) {
    alert("Invalid JSON file.");
    return;
  }

  if (!Array.isArray(arr)) {
    alert("Backup format invalid.");
    return;
  }

  // Delete current
  const snap = await getDocs(collection(db, `cases_${team}`));
  for (const d of snap.docs) {
    await deleteDoc(doc(db, `cases_${team}`, d.id));
  }

  // Restore
  for (const obj of arr) {
    await setDoc(doc(db, `cases_${team}`, obj.id), obj);
  }

  alert("Backup imported successfully.");
}