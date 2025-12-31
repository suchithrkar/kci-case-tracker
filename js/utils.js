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
  setTimeout(() => div.remove(), 10000);
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



