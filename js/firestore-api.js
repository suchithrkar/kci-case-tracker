/* ============================================================================
   KCI CASE TRACKER — FIRESTORE API MODULE (firestore-api.js)
   FULL CLEAN PRODUCTION VERSION
   ============================================================================
   This module provides:

   ✔ listenToTeamCases(teamId, callback)
       - The ONLY real-time listener in the entire application.
       - Used by index.js for live case updates for the user's team.
       - Optimized: unsubscribable, no nested listeners, no excess reads.

   ✔ updateCase(caseId, payload)
       - Only updates allowed fields.
       - Complies with Firestore Security Rules:
           status, followDate, flagged, notes,
           lastActionedOn, lastActionedBy

   ✔ getCasesByTeam(teamId)
       - Non-realtime fetch (Admin Stats Manual Mode — Phase C3)
       - Used for one-time loads when clicking Stats tab.

   ✔ getAllUsers()
       - One-time fetch for Stats → Admin

   👉 All functions here are used both by:
        - index.js  (Tracker UI)
        - admin.js  (Admin Panel)
   ----------------------------------------------------------------------------
   IMPORTANT:
   - This file is kept deliberately SMALL and CLEAN.
   - All heavy logic stays inside index.js or admin.js.
   - This module focuses ONLY on Firestore communication.
   ============================================================================ */

import {
  db,
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  where,
  onSnapshot,
  updateDoc
} from "./firebase.js";

/* ============================================================================
   SECTION 1 — SINGLE TEAM REAL-TIME LISTENER
   ============================================================================
   This is the ONLY place where onSnapshot is used in the entire app.

   It listens to cases for ONE TEAM at a time, and returns:
     [
       { id: "...", status: "...", followDate: "yyyy-mm-dd", ... },
       ...
     ]
   ============================================================================
*/

export function listenToTeamCases(teamId, callback) {
  if (!teamId) {
    console.warn("[listenToTeamCases] Missing teamId");
    return () => {};
  }

  const qTeamCases = query(
    collection(db, "cases"),
    where("teamId", "==", teamId)
  );

  const unsubscribe = onSnapshot(qTeamCases, (snap) => {
    const cases = snap.docs.map((d) => ({
      id: d.id,
      ...d.data()
    }));

    callback(cases);
  });

  return unsubscribe;
}

/* ============================================================================
   SECTION 2 — SAFE UPDATE WRAPPER (updateCase)
   ============================================================================
   Firestore Security Rules only allow GENERAL users to modify:

     • status  
     • followDate  
     • flagged  
     • notes  
     • lastActionedOn  
     • lastActionedBy  

   Admin users (primary) can modify ANY field — but we still restrict here to
   prevent accidental data corruption and to maintain clean data integrity.

   updateCase(caseId, payload):
     - Automatically strips forbidden fields
     - Logs warnings if unexpected fields are provided
     - Sends only allowed keys to Firestore
============================================================================ */

const ALLOWED_UPDATE_FIELDS = [
  "status",
  "followDate",
  "flagged",
  "notes",
  "lastActionedOn",
  "lastActionedBy"
];

// Filter the payload before sending
function sanitizeUpdatePayload(payload) {
  const clean = {};
  for (const key of ALLOWED_UPDATE_FIELDS) {
    if (payload[key] !== undefined) {
      clean[key] = payload[key];
    }
  }

  // Developer safety: warn if non-allowed fields were attempted
  Object.keys(payload).forEach((k) => {
    if (!ALLOWED_UPDATE_FIELDS.includes(k)) {
      console.warn(
        `[updateCase] BLOCKED field "${k}" — not allowed by security rules`
      );
    }
  });

  return clean;
}

export async function updateCase(caseId, payload) {
  if (!caseId) {
    console.error("[updateCase] Missing caseId");
    return;
  }

  const ref = doc(db, "cases", caseId);
  const cleanPayload = sanitizeUpdatePayload(payload);

  try {
    await updateDoc(ref, cleanPayload);
  } catch (err) {
    console.error("[updateCase] Firestore update failed:", err);
    throw err;
  }
}

/* ============================================================================
   SECTION 3 — ONE-TIME FIRESTORE FETCHES (NO REALTIME LISTENERS)
   ============================================================================
   These are used for:
     ✔ Admin Stats (manual mode — Phase C3)
     ✔ Audit Modal
     ✔ Backup Export
     ✔ Admin tools that need stable snapshots
============================================================================ */


/* ---------------------------------------------------------
   Fetch ALL cases once (non-realtime)
--------------------------------------------------------- */
export async function getAllCases() {
  const snap = await getDocs(collection(db, "cases"));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}


/* ---------------------------------------------------------
   Fetch cases for ONE TEAM (non-realtime)
   Used when primary admin selects a specific team in Stats tab.
--------------------------------------------------------- */
export async function getCasesByTeam(teamId) {
  if (!teamId) return [];

  const qTeam = query(collection(db, "cases"), where("teamId", "==", teamId));
  const snap = await getDocs(qTeam);

  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}


/* ---------------------------------------------------------
   Fetch cases for ONE USER (non-realtime)
   Used by the Audit modal (if needed).
--------------------------------------------------------- */
export async function getCasesByUser(userId) {
  if (!userId) return [];

  const qUser = query(
    collection(db, "cases"),
    where("lastActionedBy", "==", userId)
  );

  const snap = await getDocs(qUser);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

/* ============================================================================
   SECTION 4 — USER FETCH UTILITIES
   ============================================================================
   Used for:
     ✔ Admin Users table
     ✔ Admin Stats (Phase C3)
     ✔ Team deletion → reassign users
     ✔ Name resolution (Last Actioned By → display name)
============================================================================ */


/* ---------------------------------------------------------
   Fetch ALL users once
--------------------------------------------------------- */
export async function getAllUsers() {
  const snap = await getDocs(collection(db, "users"));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}


/* ---------------------------------------------------------
   Fetch users in a specific team
--------------------------------------------------------- */
export async function getTeamUsers(teamId) {
  if (!teamId) return [];

  const qTeamUsers = query(
    collection(db, "users"),
    where("teamId", "==", teamId)
  );

  const snap = await getDocs(qTeamUsers);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}


/* ---------------------------------------------------------
   Fetch ONE user doc from Firestore
   (Used mainly for audit or reference)
--------------------------------------------------------- */
export async function getUserDoc(uid) {
  if (!uid) return null;

  const ref = doc(db, "users", uid);
  const snap = await getDoc(ref);

  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

/* ============================================================================
   SECTION 5 — TEAM FETCH + ADMIN HELPERS
   ============================================================================
   Used primarily by admin.js for:
     ✔ Teams Table
     ✔ Team Rename
     ✔ Team Delete
     ✔ Team Reassign Dialog
============================================================================ */


/* ---------------------------------------------------------
   Fetch ALL teams
--------------------------------------------------------- */
export async function getAllTeams() {
  const snap = await getDocs(collection(db, "teams"));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}


/* ---------------------------------------------------------
   Fetch ONE team
--------------------------------------------------------- */
export async function getTeam(teamId) {
  if (!teamId) return null;

  const ref = doc(db, "teams", teamId);
  const snap = await getDoc(ref);

  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}


/* ---------------------------------------------------------
   Delete ONE team
   (Admin only — validated by Firestore rules)
--------------------------------------------------------- */
export async function deleteTeam(teamId) {
  if (!teamId) return;

  const ref = doc(db, "teams", teamId);
  try {
    await deleteDoc(ref);
  } catch (err) {
    console.error("[deleteTeam] Failed:", err);
    throw err;
  }
}


/* ---------------------------------------------------------
   CASCADE DELETE — ADMIN ONLY OPERATION
   Used when deleting a team that has cases/users.
   (admin.js handles the UI and reassign logic)
--------------------------------------------------------- */

export async function deleteTeamCases(teamId) {
  if (!teamId) return;

  const snap = await getDocs(
    query(collection(db, "cases"), where("teamId", "==", teamId))
  );

  for (const d of snap.docs) {
    try {
      await deleteDoc(doc(db, "cases", d.id));
    } catch (err) {
      console.error(`[deleteTeamCases] Failed to delete case ${d.id}`, err);
    }
  }
}

export async function deleteTeamUsers(teamId) {
  if (!teamId) return;

  const snap = await getDocs(
    query(collection(db, "users"), where("teamId", "==", teamId))
  );

  for (const d of snap.docs) {
    try {
      await deleteDoc(doc(db, "users", d.id));
    } catch (err) {
      console.error(`[deleteTeamUsers] Failed to delete user ${d.id}`, err);
    }
  }
}

/* ============================================================================
   SECTION 6 — BULK SNAPSHOT LOADER (Optional Convenience Wrapper)
   ============================================================================
   This function is helpful for:
     ✔ Backup export
     ✔ Pre-computing team or user totals
     ✔ Debugging Firestore state
   It loads teams, users, and cases in parallel.
============================================================================ */

export async function loadEverythingSnapshot() {
  const [teams, users, cases] = await Promise.all([
    getAllTeams(),
    getAllUsers(),
    getAllCases()
  ]);

  return { teams, users, cases };
}


/* ============================================================================
   SECTION 7 — OPTIONAL EXPORT MAP FOR DEBUGGING
   ============================================================================
   Not required by index.js or admin.js, but useful during development.

   Access via browser console:
   > window.FS.dump()
============================================================================ */

export const FS = {
  getAllCases,
  getCasesByTeam,
  getCasesByUser,
  getAllUsers,
  getTeamUsers,
  getUserDoc,
  getAllTeams,
  getTeam,
  listenToTeamCases,
  updateCase,
  deleteTeam,
  deleteTeamCases,
  deleteTeamUsers,
  loadEverythingSnapshot,
  dump: async () => {
    console.table(await getAllCases());
  }
};

// For quick dev-console access:
window.FS = FS;


/* ============================================================================
   END OF firestore-api.js
   ============================================================================
   All Firestore access for KCI Case Tracker is fully encapsulated.
   This file intentionally avoids heavy logic and focuses on clean,
   safe, rule-compatible data operations.
============================================================================ */
