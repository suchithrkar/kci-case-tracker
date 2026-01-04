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
  const q = query(collection(db, "cases"), where("teamId", "==", teamId));

  return onSnapshot(
    q,
    { includeMetadataChanges: true },
    (snap) => {
      callback(snap);
    }
  );
}

// ======================================
// UPDATE CASE MANUAL FIELDS
// (rules restrict what general users can update)
// ======================================
export async function updateCase(caseId, fields) {
  return updateDoc(doc(db, "cases", caseId), fields);
}

// ======================================
// ADMIN: CREATE/UPDATE CASE FROM EXCEL
// ======================================
export async function adminUpsertCase(caseId, data) {
  await setDoc(doc(db, "cases", caseId), data, { merge: true });
}

// ======================================
// ADMIN: DELETE CASE
// ======================================
export function adminDeleteCase(caseId) {
  return updateDoc(doc(db, "cases", caseId), {
    _deleted: true
  });
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
export function getCase(caseId) {
  return getDoc(doc(db, "cases", caseId));

}
