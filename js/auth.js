import { auth, db } from "./firebase-config.js";

import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  sendPasswordResetEmail,
  onAuthStateChanged,
  signOut
} from "https://www.gstatic.com/firebasejs/12.5.0/firebase-auth.js";

import {
  doc, setDoc, getDoc
} from "https://www.gstatic.com/firebasejs/12.5.0/firebase-firestore.js";


// --------------------------------------------
// AUTO-REDIRECT IF USER ALREADY LOGGED IN
// --------------------------------------------
onAuthStateChanged(auth, async (user) => {
  if (!user) return;

  const snap = await getDoc(doc(db, "users", user.email));
  if (!snap.exists()) return;

  const data = snap.data();

  if (data.status === "approved") {
    window.location.href = "./index.html";
  }
});


// -----------------------------------------------------
// LOGIN
// -----------------------------------------------------
document.getElementById("btnLogin").addEventListener("click", async () => {
  const email = document.getElementById("loginEmail").value.trim();
  const password = document.getElementById("loginPassword").value.trim();

  if (!email || !password) return alert("Please enter email and password.");

  try {
    const cred = await signInWithEmailAndPassword(auth, email, password);

    const userDoc = await getDoc(doc(db, "users", email));

    if (!userDoc.exists()) {
      alert("User profile missing — contact admin.");
      return;
    }

    const user = userDoc.data();

    if (user.status === "pending") {
      await signOut(auth);
      return alert("Your account is pending admin approval.");
    }

    if (user.status === "rejected") {
      await signOut(auth);
      return alert("Your account has been rejected.");
    }

    // Approved → move to tracker
    window.location.href = "./index.html";

  } catch (err) {
    alert(err.message);
  }
});


// -----------------------------------------------------
// SIGNUP MODAL
// -----------------------------------------------------
document.getElementById("openSignup").onclick = () =>
  document.getElementById("signupModal").classList.add("show");

document.getElementById("closeSignup").onclick = () =>
  document.getElementById("signupModal").classList.remove("show");

document.getElementById("btnSignup").addEventListener("click", async () => {
  const first = document.getElementById("signupFirst").value.trim();
  const last = document.getElementById("signupLast").value.trim();
  const email = document.getElementById("signupEmail").value.trim();
  const pass = document.getElementById("signupPassword").value.trim();

  if (!first || !last || !email || !pass)
    return alert("Please fill all fields.");

  try {
    const cred = await createUserWithEmailAndPassword(auth, email, pass);

    await setDoc(doc(db, "users", email), {
      firstName: first,
      lastName: last,
      email: email,
      role: "general",
      status: "pending",
      team: "",
      createdOn: new Date().toISOString()
    });

    alert("Account created! Waiting for admin approval.");
    document.getElementById("signupModal").classList.remove("show");

  } catch (err) {
    alert(err.message);
  }
});


// -----------------------------------------------------
// RESET PASSWORD
// -----------------------------------------------------
document.getElementById("openReset").onclick = () =>
  document.getElementById("resetModal").classList.add("show");

document.getElementById("closeReset").onclick = () =>
  document.getElementById("resetModal").classList.remove("show");

document.getElementById("btnReset").addEventListener("click", async () => {
  const email = document.getElementById("resetEmail").value.trim();

  if (!email) return alert("Enter your email.");

  try {
    await sendPasswordResetEmail(auth, email);
    alert("Password reset link sent.");
    document.getElementById("resetModal").classList.remove("show");

  } catch (err) {
    alert(err.message);
  }
});