// ============ Firebase imports ============
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-app.js";
import {
  getAuth,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  onAuthStateChanged,
  signOut
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-auth.js";
import {
  getFirestore,
  doc,
  getDoc,
  setDoc
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js";

// ============ Firebase Config ============
const firebaseConfig = {
  apiKey: "AIzaSyCkVHlYHa8aEbXvOHK0UJmOv5zVx_Kcsx0",
  authDomain: "kci-case-tracker.firebaseapp.com",
  projectId: "kci-case-tracker",
  storageBucket: "kci-case-tracker.appspot.com",
  messagingSenderId: "554993696883",
  appId: "1:554993696883:web:5a0fe904443c7279f7aa06"
};

// ============ Initialize Firebase ============
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// ============ DOM refs ============
const email = document.getElementById("email");
const password = document.getElementById("password");
const loginBtn = document.getElementById("loginBtn");
const toggleMode = document.getElementById("toggleMode");

let isSignUp = false;

// ============ Toggle Login / Signup ============
toggleMode.addEventListener("click", () => {
  isSignUp = !isSignUp;
  loginBtn.textContent = isSignUp ? "Sign Up" : "Login";
  toggleMode.textContent = isSignUp
    ? "Already have an account? Login"
    : "Don’t have an account? Sign up";
});

// ============ Login / Signup ============
loginBtn.addEventListener("click", async () => {
  const emailVal = email.value.trim();
  const passVal = password.value.trim();

  if (!emailVal || !passVal) {
    alert("Please fill in both fields");
    return;
  }

  console.log("Button clicked. Mode:", isSignUp ? "SignUp" : "Login");

  try {
    if (isSignUp) {
      console.log("Attempting to create account in Firebase Auth...");

      // ✅ Create new Auth account
      const userCred = await createUserWithEmailAndPassword(auth, emailVal, passVal);
      const user = userCred.user;

      console.log("✅ Auth account created:", user.email);

      // ✅ Create Firestore user record (same email ID)
      await setDoc(doc(db, "users", user.email), {
        email: user.email,
        approved: false,
        role: "user",
        createdOn: new Date().toISOString()
      });

      console.log("✅ Firestore doc created for:", user.email);

      alert("✅ Account created! Wait for admin approval before you can log in.");
      await signOut(auth);
      console.log("Signed out after registration.");
    } else {
      console.log("Attempting login...");

      // ✅ Login existing user
      const userCred = await signInWithEmailAndPassword(auth, emailVal, passVal);
      const user = userCred.user;

      const ref = doc(db, "users", user.email);
      const snap = await getDoc(ref);

      if (!snap.exists()) {
        alert("No user record found. Contact admin.");
        await signOut(auth);
        return;
      }

      const data = snap.data();
      if (!data.approved) {
        alert("Access pending admin approval.");
        await signOut(auth);
        return;
      }

      console.log("✅ Login success. Redirecting...");
      window.location.href = "index.html";
    }
  } catch (err) {
    console.error("❌ Error in Auth or Firestore:", err);
    alert("Error: " + err.message);
  }
});

// ============ Auto redirect if logged in ============
onAuthStateChanged(auth, async (user) => {
  if (user) {
    try {
      const ref = doc(db, "users", user.email);
      const snap = await getDoc(ref);
      if (snap.exists() && snap.data().approved) {
        window.location.href = "index.html";
      } else {
        await signOut(auth);
      }
    } catch (err) {
      console.error("Error verifying session:", err);
    }
  }
});
