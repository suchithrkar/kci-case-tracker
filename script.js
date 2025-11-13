// ======================= FIRESTORE-SYNCED TRACKER LOGIC =======================

// --- Firebase imports ---
import {
  getFirestore, collection, getDocs, getDoc, doc, setDoc, updateDoc, deleteDoc
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-auth.js";
import * as XLSX from "https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js";
import { app } from "./firebase-init.js";

// --- Firebase init ---
const db = getFirestore(app);
const auth = getAuth(app);

// --- Constants ---
const CASES_COLLECTION = "cases";
const tableBody = document.getElementById("tbody");
const modal = document.getElementById("modal");
const modalTitle = document.getElementById("modalTitle");
const optDate = document.getElementById("optDate");
const optFlag = document.getElementById("optFlag");
const optNotes = document.getElementById("optNotes");
const optLastActioned = document.getElementById("optLastActioned");
const btnModalSave = document.getElementById("btnModalSave");
const btnModalClose = document.getElementById("btnModalClose");
let currentCaseId = null;
let allCases = [];

// ==================== LOAD DATA FROM FIRESTORE ====================

async function loadAllCases() {
  try {
    console.log("📥 Loading all cases from Firestore...");
    const snap = await getDocs(collection(db, CASES_COLLECTION));
    allCases = [];
    snap.forEach(docSnap => {
      const data = docSnap.data();
      allCases.push({ id: docSnap.id, ...data });
    });
    console.log(`✅ Loaded ${allCases.length} cases from Firestore.`);
    renderTable(allCases);
  } catch (err) {
    console.error("❌ Error loading cases:", err);
  }
}

// ==================== RENDER TABLE ====================

function renderTable(cases) {
  tableBody.innerHTML = "";

  if (!cases || cases.length === 0) {
    tableBody.innerHTML = `<tr><td colspan="10" style="text-align:center;">No cases found</td></tr>`;
    return;
  }

  cases.forEach((c, i) => {
    const tr = document.createElement("tr");

    // row highlight rules
    if (c.followDate && isToday(c.followDate)) tr.style.backgroundColor = "#fff4c2"; // due today
    else if (c.flagged) tr.style.backgroundColor = "#ffe0e0"; // flagged
    else if (c.notes && c.notes.trim()) tr.style.backgroundColor = "#e9f6ff"; // notes present

    tr.innerHTML = `
      <td>${i + 1}</td>
      <td>${c.id}</td>
      <td>${c.customerName || ""}</td>
      <td>${c.country || ""}</td>
      <td>${c.caseResolutionCode || ""}</td>
      <td>${c.caseOwner || ""}</td>
      <td>${c.caGroup || ""}</td>
      <td>${c.sbd || ""}</td>
      <td>
        <select data-id="${c.id}" class="status-select">
          <option value="">--Select--</option>
          <option ${c.status === "Closed" ? "selected" : ""}>Closed</option>
          <option ${c.status === "NCM 1" ? "selected" : ""}>NCM 1</option>
          <option ${c.status === "NCM 2" ? "selected" : ""}>NCM 2</option>
          <option ${c.status === "PNS" ? "selected" : ""}>PNS</option>
          <option ${c.status === "Service Pending" ? "selected" : ""}>Service Pending</option>
          <option ${c.status === "Monitoring" ? "selected" : ""}>Monitoring</option>
        </select>
      </td>
      <td class="right">
        <button class="gear-btn" data-id="${c.id}" title="Case Options">⚙️</button>
      </td>
    `;
    tableBody.appendChild(tr);
  });

  // attach listeners
  document.querySelectorAll(".status-select").forEach(sel => {
    sel.addEventListener("change", async (e) => {
      const id = e.target.getAttribute("data-id");
      const newStatus = e.target.value;
      await updateCase(id, {
        status: newStatus,
        lastActionedOn: getToday(),
        updatedBy: auth.currentUser?.email || "unknown"
      });
    });
  });

  document.querySelectorAll(".gear-btn").forEach(btn => {
    btn.addEventListener("click", (e) => openCaseOptions(e.target.getAttribute("data-id")));
  });
}

// ==================== CASE OPTION MODAL ====================

function openCaseOptions(caseId) {
  currentCaseId = caseId;
  const caseData = allCases.find(c => c.id === caseId);
  if (!caseData) return;

  modalTitle.textContent = `Case Options - ${caseId}`;
  optDate.value = caseData.followDate || "";
  optFlag.setAttribute("aria-checked", caseData.flagged ? "true" : "false");
  optNotes.value = caseData.notes || "";
  optLastActioned.textContent = caseData.lastActionedOn || "—";

  modal.style.display = "flex";
}

btnModalClose.addEventListener("click", () => (modal.style.display = "none"));
optFlag.addEventListener("click", () => {
  const checked = optFlag.getAttribute("aria-checked") === "true";
  optFlag.setAttribute("aria-checked", checked ? "false" : "true");
});

btnModalSave.addEventListener("click", async () => {
  if (!currentCaseId) return;
  const updates = {
    followDate: optDate.value || null,
    flagged: optFlag.getAttribute("aria-checked") === "true",
    notes: optNotes.value.trim(),
    lastActionedOn: getToday(),
    updatedBy: auth.currentUser?.email || "unknown"
  };
  await updateCase(currentCaseId, updates);
  modal.style.display = "none";
});

// ==================== FIRESTORE WRITE ====================

async function updateCase(caseId, updates) {
  try {
    const ref = doc(db, CASES_COLLECTION, caseId);
    await updateDoc(ref, updates);
    console.log(`✅ Updated case ${caseId}`, updates);

    // update locally for instant UI refresh
    const idx = allCases.findIndex(c => c.id === caseId);
    if (idx !== -1) Object.assign(allCases[idx], updates);
    renderTable(allCases);
  } catch (err) {
    console.error("❌ Error updating case:", err);
  }
}

// ==================== HELPERS ====================

function isToday(dateStr) {
  const today = new Date();
  const d = new Date(dateStr);
  return (
    d.getDate() === today.getDate() &&
    d.getMonth() === today.getMonth() &&
    d.getFullYear() === today.getFullYear()
  );
}

function getToday() {
  const d = new Date();
  return d.toISOString().split("T")[0];
}

// ==================== INITIAL LOAD ====================
loadAllCases();

// ==================== ADMIN EXCEL → FIRESTORE SYNC ====================

const fileInput = document.getElementById("fileInput");
const uploadBtn = document.getElementById("btnUpload");

if (uploadBtn && fileInput) {
  uploadBtn.addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", handleExcelUpload);
}

async function handleExcelUpload(e) {
  const file = e.target.files[0];
  if (!file) return;

  const user = auth.currentUser;
  if (!user) return alert("Please log in first.");
  if (user.email !== "suchith.raichurkar@hp.com") {
    return alert("Only the admin can upload Excel files.");
  }

  try {
    const data = await file.arrayBuffer();
    const workbook = XLSX.read(data);
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet, { defval: "" });
    console.log(`📘 Parsed ${rows.length} rows from Excel.`);

    const excelIds = new Set();

    // Fetch existing case IDs
    const existingSnap = await getDocs(collection(db, CASES_COLLECTION));
    const existingIds = new Set();
    existingSnap.forEach((d) => existingIds.add(d.id));

    // Upload/update each case
    for (const r of rows) {
      const id = String(r["Case ID"]).trim();
      if (!id) continue;
      excelIds.add(id);

      const caseDoc = {
        id,
        customerName: r["Full Name (Primary Contact) (Contact)"] || "",
        createdOn: formatExcelDate(r["Created On"]),
        createdBy: r["Created By"] || "",
        country: r["Country"] || "",
        caseResolutionCode: r["Case Resolution Code"] || "",
        caseOwner: r["Full Name (Owning User) (User)"] || "",
        caGroup: r["CA Group"] || "",
        sbd: r["SBD"] || "",
        onsiteRFC: r["Onsite RFC Status"] || "",
        csrRFC: r["CSR RFC Status"] || "",
        benchRFC: r["Bench RFC Status"] || "",
        status: "",
        followDate: null,
        flagged: false,
        notes: "",
        lastActionedOn: null,
        updatedBy: "",
      };

      await setDoc(doc(db, CASES_COLLECTION, id), caseDoc, { merge: true });
    }

    // Delete old cases missing in Excel
    let deletedCount = 0;
    for (const oldId of existingIds) {
      if (!excelIds.has(oldId)) {
        await deleteDoc(doc(db, CASES_COLLECTION, oldId));
        deletedCount++;
      }
    }

    alert(`✅ Import complete!\n${rows.length} total cases processed.\n${deletedCount} removed (closed).`);
    await loadAllCases();
  } catch (err) {
    console.error("❌ Error importing Excel:", err);
    alert("Error importing Excel: " + err.message);
  } finally {
    fileInput.value = "";
  }
}

// ==================== Helper: Excel → ISO date ====================
function formatExcelDate(val) {
  if (!val) return "";
  if (typeof val === "number") {
    const date = new Date((val - 25569) * 86400 * 1000);
    return date.toISOString().split("T")[0];
  }
  if (typeof val === "string" && val.includes("-")) return val.split(" ")[0];
  return "";
}
