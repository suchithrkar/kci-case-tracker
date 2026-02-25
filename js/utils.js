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

// ============================================================
// STACKED TOAST SYSTEM (replaces alert-style popup)
// ============================================================

let toastContainer = null;

export function showPopup(message, duration = 5000) {

  // Create container once
  if (!toastContainer) {
    toastContainer = document.createElement("div");
    toastContainer.id = "toastContainer";

    Object.assign(toastContainer.style, {
      position: "fixed",
      bottom: "20px",
      right: "20px",
      display: "flex",
      flexDirection: "column-reverse", // newest at bottom
      gap: "10px",
      zIndex: 9999,
      pointerEvents: "none"
    });

    document.body.appendChild(toastContainer);
  }

  const toast = document.createElement("div");
  toast.className = "popup-message";
  toast.innerHTML = message;

  Object.assign(toast.style, {
    background: "var(--panel)",
    border: "1px solid var(--border)",
    padding: "12px 16px",
    borderRadius: "12px",
    minWidth: "220px",
    maxWidth: "320px",
    boxShadow: "var(--shadow)",
    opacity: "0",
    transform: "translateY(10px)",
    transition: "all 0.25s ease",
    pointerEvents: "auto"
  });

  toastContainer.appendChild(toast);

  // Animate in
  requestAnimationFrame(() => {
    toast.style.opacity = "1";
    toast.style.transform = "translateY(0)";
  });

  // Auto remove
  setTimeout(() => {
    toast.style.opacity = "0";
    toast.style.transform = "translateY(10px)";
    setTimeout(() => toast.remove(), 250);
  }, duration);
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
 * (current month + last 12 months)
 */
export function getValidMonthKeys(todayISO, monthsToKeep = 13) {
  const [y, m] = todayISO.split("-").map(Number);
  const months = [];

  for (let i = 0; i < monthsToKeep; i++) {
    const d = new Date(y, m - 1 - i, 1);
    months.push(
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`
    );
  }

  return months;
}

/**
 * Cleanup closedCasesHistory older than 13 months
 */
export async function cleanupClosedCases(todayISO) {
  const validMonths = getValidMonthKeys(todayISO, 13);
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
    "cases",
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








