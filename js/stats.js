// stats.js
import { auth, db } from "./firebase-config.js";
import {
  collection, getDocs, doc, getDoc, query, where
} from "https://www.gstatic.com/firebasejs/12.5.0/firebase-firestore.js";

import { loadTeamsList } from "./teams.js";


// ==================================================================
// REFRESH STATISTICS (ENTRY POINT)
// Called when:
//  • Stats tab opens
//  • Admin clicks "Refresh"
// ==================================================================
export async function refreshStatistics() {
  const teamSelection = document.getElementById("statsTeam");
  await populateTeamDropdown(teamSelection);

  const selected = teamSelection.value;
  await generateStats(selected);
}


// ==================================================================
// POPULATE TEAM DROPDOWN
// ==================================================================
async function populateTeamDropdown(dropdown) {

  dropdown.innerHTML = `<option value="ALL">ALL TEAMS</option>`;

  const snap = await getDocs(collection(db, "teams"));

  snap.forEach(t => {
    const name = t.data().name;
    const opt = document.createElement("option");
    opt.value = name;
    opt.innerText = name;
    dropdown.appendChild(opt);
  });
}


// ==================================================================
// GENERATE FULL STAT TABLE
// ==================================================================
async function generateStats(teamOrAll) {

  const statsBody = document.getElementById("statsBody");
  statsBody.innerHTML = "";

  // Get all users
  const usersSnap = await getDocs(collection(db, "users"));
  const users = [];

  usersSnap.forEach(u => {
    const d = u.data();
    if (d.status === "approved" && d.team) {
      users.push(d);
    }
  });

  // Filter users by team selection
  const filteredUsers =
    teamOrAll === "ALL"
      ? users
      : users.filter(u => u.team === teamOrAll);

  // Today's date
  const today = new Date().toISOString().split("T")[0];

  // Prepare stats for each user
  for (const user of filteredUsers) {
    const rowData = await computeUserStats(user, today);
    statsBody.appendChild(renderStatsRow(rowData));
  }
}


// ==================================================================
// COMPUTE ALL STATS FOR ONE USER
// ==================================================================
async function computeUserStats(user, today) {
  
  const team = user.team;
  const email = user.email;

  // Load all cases for this team
  const snap = await getDocs(collection(db, `cases_${team}`));
  const cases = [];

  snap.forEach(c => {
    cases.push({ id: c.id, ...c.data() });
  });

  // Filter cases last-actioned by this user
  const myCases = cases.filter(c => c.lastActionedBy === email);

  // Total Actioned Today
  const actionedToday = myCases.filter(
    c => c.lastActionedOn === today
  ).length;

  // Closed Today
  const closedToday = myCases.filter(
    c => c.lastActionedOn === today && c.status === "Closed"
  ).length;

  // MET vs NOT MET
  // MET = followDate >= today OR empty
  let met = 0;
  let notMet = 0;

  myCases.forEach(c => {
    if (!c.followDate) {
      met++;
    } else {
      const fd = new Date(c.followDate);
      const td = new Date(today);
      if (fd >= td) met++;
      else notMet++;
    }
  });

  const total = met + notMet;
  const metPct = total ? ((met / total) * 100).toFixed(1) : "0.0";
  const notMetPct = total ? ((notMet / total) * 100).toFixed(1) : "0.0";

  // Pending with no follow-up
  const missingFollowup = myCases.filter(
    c => !c.followDate && c.status !== "Closed"
  ).length;

  // DueToday or Overdue
  const dueOver = myCases.filter(c => {
    if (!c.followDate) return false;
    const f = new Date(c.followDate);
    const t = new Date(today);
    return f <= t;
  }).length;

  // Audit (pick 5 random)
  const shuffled = [...myCases].sort(() => 0.5 - Math.random());
  const audit = shuffled.slice(0, 5);


  return {
    user,
    actionedToday,
    closedToday,
    metPct,
    notMetPct,
    missingFollowup,
    dueOver,
    audit
  };
}


// ==================================================================
// RENDER ONE STATS ROW
// ==================================================================
function renderStatsRow(stat) {

  const tr = document.createElement("tr");

  tr.innerHTML = `
    <td>${stat.user.firstName} ${stat.user.lastName}</td>
    <td>${stat.actionedToday}</td>
    <td>${stat.closedToday}</td>
    <td>${stat.metPct}%</td>
    <td>${stat.notMetPct}%</td>
    <td>${stat.missingFollowup}</td>
    <td>${stat.dueOver}</td>
    <td>
      <button class="btn showAudit">View</button>
    </td>
  `;

  // Attach audit modal handler
  tr.querySelector(".showAudit").onclick = () => {
    openAuditModal(stat.audit);
  };

  return tr;
}


// ==================================================================
// AUDIT MODAL
// ==================================================================
function openAuditModal(auditList) {

  const body = document.getElementById("auditBody");
  body.innerHTML = "";

  auditList.forEach(c => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${c["Case ID"]}</td>
      <td>${c.status}</td>
      <td>${c.lastActionedOn || "-"}</td>
    `;
    body.appendChild(tr);
  });

  document.getElementById("auditModal").classList.add("show");
}


// ==================================================================
// CLOSE AUDIT MODAL
// ==================================================================
document.getElementById("auditClose").onclick = () => {
  document.getElementById("auditModal").classList.remove("show");
};