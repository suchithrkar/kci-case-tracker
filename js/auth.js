// auth.js
import {
  auth, db,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  sendPasswordResetEmail,
  signOut,
  onAuthStateChanged,
  doc, getDoc, setDoc, updateDoc
} from "./firebase.js";

// ===============================
// SIGN UP
// ===============================
export async function signup(firstName, lastName, email, password) {
  const userCred = await createUserWithEmailAndPassword(auth, email, password);
  const uid = userCred.user.uid;

  await setDoc(doc(db, "users", uid), {
    firstName,
    lastName,
    email,
    role: "general",
    teamId: "",
    status: "pending",
    createdAt: new Date(),
    theme: "dark"
  });

  return uid;
}

// ===============================
// LOGIN
// ===============================
export async function login(email, password) {
  const userCred = await signInWithEmailAndPassword(auth, email, password);
  const uid = userCred.user.uid;

  const userDoc = await getDoc(doc(db, "users", uid));
  if (!userDoc.exists()) throw new Error("User record missing");

  const data = userDoc.data();

  if (data.status !== "approved") {
    throw new Error("Your account is pending approval.");
  }

  return data;
}

// ===============================
// PASSWORD RESET
// ===============================
export function resetPassword(email) {
  return sendPasswordResetEmail(auth, email);
}

// ===============================
// LOGOUT
// ===============================
export function logout() {
  return signOut(auth);
}

// ===============================
// AUTH STATE LISTENER
// ===============================
export function watchAuth(callback) {
  onAuthStateChanged(auth, async (user) => {
    if (!user) {
      callback(null);
      return;
    }

    const userDoc = await getDoc(doc(db, "users", user.uid));
    callback({ uid: user.uid, ...userDoc.data() });
  });
}

// ===============================
// UPDATE THEME FOR USER
// ===============================
export async function updateTheme(uid, theme) {
  await updateDoc(doc(db, "users", uid), { theme });
}

// ===============================
// SET ACTIVE TEAM (PRIMARY ADMIN)
// ===============================
export async function setActiveTeam(uid, teamId) {
  await updateDoc(doc(db, "users", uid), { activeTeam: teamId });
}