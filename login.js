// ============ Firebase imports ============
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-app.js";
import { 
  getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword, onAuthStateChanged, signOut 
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-auth.js";
import { 
  getFirestore, doc, getDoc, setDoc 
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js";

// Your web app's Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyCkVHlYHa8aEbXvOHK0UJmOv5zVx_Kcsx0",
  authDomain: "kci-case-tracker.firebaseapp.com",
  projectId: "kci-case-tracker",
  storageBucket: "kci-case-tracker.firebasestorage.app",
  messagingSenderId: "554993696883",
  appId: "1:554993696883:web:5a0fe904443c7279f7aa06"
};

// Initialize Firebase
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

  try {
    let userCred;
    if (isSignUp) {
  try {
    // New user signup
    userCred = await createUserWithEmailAndPassword(auth, emailVal, passVal);

    // Firestore document key: user.uid instead of raw email
    const uid = userCred.user.uid;
    await setDoc(doc(db, "users", uid), {
      email: emailVal,
      approved: false,
      role: "user",
      createdOn: new Date().toISOString()
    });

    alert("✅ Account created! Wait for admin approval before you can log in.");
    console.log("User record written to Firestore:", uid, emailVal);

    await signOut(auth);
  } catch (err) {
    console.error("Firestore write failed:", err);
    alert("Firestore write failed: " + err.message);
  }
} else {
      // Existing user login
      userCred = await signInWithEmailAndPassword(auth, emailVal, passVal);
      const ref = doc(db, "users", emailVal);
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

      // ✅ Approved user → redirect
      window.location.href = "index.html";
    }
  } catch (err) {
    alert(err.message);
  }
});

// ============ Auto redirect if logged in ============
onAuthStateChanged(auth, async (user) => {
  if (user) {
    const ref = doc(db, "users", user.email);
    const snap = await getDoc(ref);
    if (snap.exists() && snap.data().approved) {
      window.location.href = "index.html";
    } else {
      await signOut(auth);
    }
  }
});

