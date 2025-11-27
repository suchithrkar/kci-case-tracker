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
  setTimeout(() => div.remove(), 2500);
}