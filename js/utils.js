// utils.js

// Convert Excel serial date → YYYY-MM-DD
export function excelDateToYMD(v) {
  if (!v) return "";
  if (typeof v === "number") {
    const epoch = new Date(Date.UTC(1899, 11, 30));
    const d = new Date(epoch.getTime() + v * 86400000);
    return d.toISOString().split("T")[0];
  }
  const d2 = new Date(v);
  if (!isNaN(d2)) return d2.toISOString().split("T")[0];
  return "";
}

// Simple popup modal creator (replaces alert)
export function showPopup(msg) {
  const div = document.createElement("div");
  div.className = "popup-message";
  div.innerHTML = msg;

  Object.assign(div.style, {
    position: "fixed",
    bottom: "20px",
    right: "20px",
    background: "var(--panel)",
    border: "1px solid var(--border)",
    padding: "12px 16px",
    borderRadius: "12px",
    zIndex: 999
  });

  document.body.appendChild(div);
  setTimeout(() => div.remove(), 5000);
}

/* ============================================================
   HISTORICAL DATA RETENTION HELPERS
   ============================================================ */

import {
  db,
  collection,
  getDocs,
  deleteDoc,
  doc
} from "./firebase.js";

/**
 * Returns allowed YYYY-MM month keys
 * (current month + last 3 months)
 */
export function getValidMonthKeys(todayISO) {
  const [y, m] = todayISO.split("-").map(Number);
  const months = [];

  for (let i = 0; i < 4; i++) {
    const d = new Date(y, m - 1 - i, 1);
    months.push(
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`
    );
  }

  return months;
}

/**
 * Cleanup closedCasesHistory older than 3 months
 */
export async function cleanupClosedCases(todayISO) {
  const validMonths = getValidMonthKeys(todayISO);
  const snap = await getDocs(collection(db, "closedCasesHistory"));

  for (const d of snap.docs) {
    const data = d.data();
    if (!data.closedDate) continue;

    const monthKey = data.closedDate.slice(0, 7);
    if (!validMonths.includes(monthKey)) {
      await deleteDoc(d.ref);
    }
  }
}

/**
 * Cleanup dailyRepairReports older than 3 months (per team)
 */
export async function cleanupDailyReports(teamId, todayISO) {
  const validMonths = getValidMonthKeys(todayISO);

  const reportsRef = collection(
    db,
    "dailyRepairReports",
    teamId,
    "reports"
  );

  const snap = await getDocs(reportsRef);

  for (const d of snap.docs) {
    const monthKey = d.id.slice(0, 7);
    if (!validMonths.includes(monthKey)) {
      await deleteDoc(d.ref);
    }
  }
}

/* ============================================================
   PHASE 3A — INDEXEDDB READ-THROUGH CACHE (TRACKER)
   ============================================================ */

const TRACKER_DB_NAME = "kci-tracker-cache";
const TRACKER_DB_VERSION = 1;
const TRACKER_STORE = "tracker";

/**
 * Open (or create) IndexedDB
 */
function openTrackerDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(TRACKER_DB_NAME, TRACKER_DB_VERSION);

    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(TRACKER_STORE)) {
        db.createObjectStore(TRACKER_STORE);
      }
    };

    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/**
 * Read value from cache
 */
async function idbGet(key) {
  const db = await openTrackerDB();

  return new Promise((resolve) => {
    const tx = db.transaction(TRACKER_STORE, "readonly");
    const store = tx.objectStore(TRACKER_STORE);
    const req = store.get(key);

    req.onsuccess = () => resolve(req.result ?? null);
    req.onerror = () => resolve(null);
  });
}

/**
 * Write value to cache
 */
async function idbSet(key, value) {
  const db = await openTrackerDB();

  return new Promise((resolve) => {
    const tx = db.transaction(TRACKER_STORE, "readwrite");
    const store = tx.objectStore(TRACKER_STORE);
    store.put(value, key);

    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
  });
}

/**
 * Delete single cache entry
 */
async function idbDelete(key) {
  const db = await openTrackerDB();

  return new Promise((resolve) => {
    const tx = db.transaction(TRACKER_STORE, "readwrite");
    tx.objectStore(TRACKER_STORE).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
  });
}

/**
 * Clear entire tracker cache
 */
async function idbClearAll() {
  const db = await openTrackerDB();

  return new Promise((resolve) => {
    const tx = db.transaction(TRACKER_STORE, "readwrite");
    tx.objectStore(TRACKER_STORE).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
  });
}

/**
 * Public cache API (team-aware keys)
 */
export const trackerCache = {
  get: idbGet,
  set: idbSet,
  delete: idbDelete,
  clearAll: idbClearAll
};
