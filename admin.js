// admin.js — Admin Panel Logic
import { db, auth } from "./firebase-init.js";
import {
  collection,
  getDocs,
  updateDoc,
  deleteDoc,
  doc
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js";

import {
  onAuthStateChanged,
  signOut,
  sendPasswordResetEmail
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-auth.js";

let ADMIN_EMAIL = null;

// Load admin email from Firestore
async function loadAdminEmail() {
  const snap = await getDocs(collection(db, "settings"));
  snap.forEach(s => {
    if (s.id === "access") ADMIN_EMAIL = s.data().adminEmail;
  });
}

// redirect to login if not admin
onAuthStateChanged(auth, async (user) => {
  await loadAdminEmail();

  if (!user || user.email.toLowerCase() !== ADMIN_EMAIL.toLowerCase()) {
    alert("Access denied. Admins only.");
    window.location.href = "login.html";
    return;
  }

  loadUsers();
});

// ---------------------------
// Load users list
// ---------------------------
async function loadUsers(filter = "all") {
  const tbody = document.getElementById("adminUsersBody");
  tbody.innerHTML = "<tr><td colspan='5'>Loading...</td></tr>";

  const snap = await getDocs(collection(db, "users"));
  const list = [];

  snap.forEach((docSnap) => {
    const d = docSnap.data();
    list.push({
      id: docSnap.id,
      email: d.email,
      approved: d.approved,
      role: d.role,
      createdOn: d.createdOn
    });
  });

  let filtered = list;
  if (filter === "approved") filtered = list.filter(u => u.approved);
  if (filter === "pending") filtered = list.filter(u => !u.approved);

  renderUsers(filtered);
}

// ---------------------------
// Render table
// ---------------------------
function renderUsers(users) {
  const tbody = document.getElementById("adminUsersBody");
  tbody.innerHTML = "";

  if (!users.length) {
    tbody.innerHTML = "<tr><td colspan='5'>No users found.</td></tr>";
    return;
  }

  users.forEach(u => {
    const tr = document.createElement("tr");

    tr.innerHTML = `
      <td>${u.email}</td>
      <td>
        <span class="tag ${u.approved ? "approved" : "pending"}">
          ${u.approved ? "Approved" : "Pending"}
        </span>
      </td>
      <td>${u.role || "user"}</td>
      <td>${formatDate(u.createdOn)}</td>
      <td>
        ${!u.approved ? `<button class="admin-btn approve" data-act="approve" data-id="${u.id}">Approve</button>` : ""}
        ${u.approved ? `<button class="admin-btn reject" data-act="reject" data-id="${u.id}">Reject</button>` : ""}
        <button class="admin-btn reset" data-act="reset" data-email="${u.email}">Reset PW</button>
        <button class="admin-btn delete" data-act="delete" data-id="${u.id}">Delete</button>
      </td>
    `;

    tbody.appendChild(tr);
  });
}

// Simple date formatter
function formatDate(iso) {
  if (!iso) return "";
  return iso.split("T")[0];
}

// ---------------------------
// Handle buttons (approve / reject / reset / delete)
// ---------------------------
document.getElementById("adminUsersBody").addEventListener("click", async (e) => {
  const btn = e.target.closest("button");
  if (!btn) return;

  const action = btn.dataset.act;
  const id = btn.dataset.id;
  const email = btn.dataset.email;

  if (action === "approve") {
    await updateDoc(doc(db, "users", id), { approved: true });
    loadUsers();
  }

  if (action === "reject") {
    await updateDoc(doc(db, "users", id), { approved: false });
    loadUsers();
  }

  if (action === "reset") {
    await sendPasswordResetEmail(auth, email);
    alert("Password reset email sent.");
  }

  if (action === "delete") {
    if (confirm("Delete this user?")) {
      await deleteDoc(doc(db, "users", id));
      loadUsers();
    }
  }
});

// ---------------------------
// Filters
// ---------------------------
document.getElementById("filterAll").onclick = () => loadUsers("all");
document.getElementById("filterApproved").onclick = () => loadUsers("approved");
document.getElementById("filterPending").onclick = () => loadUsers("pending");

// ---------------------------
// Navigation buttons
// ---------------------------
document.getElementById("btnBackTracker").onclick = () =>
  window.location.href = "index.html";

document.getElementById("btnLogout").onclick = async () => {
  await signOut(auth);
  window.location.href = "login.html";
};
