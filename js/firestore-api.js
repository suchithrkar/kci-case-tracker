// firestore-api.js
import {
  db,
  collection, doc, getDoc, setDoc, updateDoc,
  query, where, onSnapshot
} from "./firebase.js";

// ======================================
// REAL-TIME CASE LISTENER
// ======================================
export function listenToTeamCases(teamId, callback) {
  const colRef = collection(db, "cases", teamId, "casesList");

  return onSnapshot(colRef, (snap) => {
    const rows = [];
    snap.forEach((d) => rows.push({ id: d.id, ...d.data() }));
    callback(rows);
  });
}

// ======================================
// UPDATE CASE MANUAL FIELDS
// (rules restrict what general users can update)
// ======================================
export async function updateCase(teamId, caseId, fields) {
  return updateDoc(
    doc(db, "cases", teamId, "casesList", caseId),
    fields
  );
}

// ======================================
// ADMIN: CREATE/UPDATE CASE FROM EXCEL
// ======================================
export async function adminUpsertCase(teamId, caseId, data) {
  await setDoc(
    doc(db, "cases", teamId, "casesList", caseId),
    data,
    { merge: true }
  );
}

// ======================================
// ADMIN: DELETE CASE
// ======================================
export function adminDeleteCase(teamId, caseId) {
  return updateDoc(
    doc(db, "cases", teamId, "casesList", caseId),
    { _deleted: true }
  );
}

// ======================================
// GET SINGLE USER DOC
// ======================================
export function getUser(uid) {
  return getDoc(doc(db, "users", uid));
}

// ======================================
// GET SINGLE CASE DOC
// ======================================
export function getCase(teamId, caseId) {
  return getDoc(
    doc(db, "cases", teamId, "casesList", caseId)
  );
}

