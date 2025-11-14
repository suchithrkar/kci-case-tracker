// login.js
import { app, db, auth } from "./firebase-init.js";
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  sendPasswordResetEmail,
  signOut,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-auth.js";
import { doc, setDoc, getDoc } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js";

const emailEl = document.getElementById("email");
const passEl = document.getElementById("password");
const loginBtn = document.getElementById("loginBtn");
const toggleModeBtn = document.getElementById("toggleMode");
const forgotLink = document.getElementById("forgotLink");
const statusSpan = document.getElementById("status");

let isSignUp = false;

toggleModeBtn.addEventListener("click", () => {
  isSignUp = !isSignUp;
  loginBtn.textContent = isSignUp ? "Sign Up" : "Login";
  toggleModeBtn.textContent = isSignUp ? "Already have an account? Login" : "Don’t have an account? Sign up";
});

loginBtn.addEventListener("click", async () => {
  const email = emailEl.value.trim();
  const pass = passEl.value.trim();
  if (!email || !pass) return alert("Fill both fields");

  try {
    if (isSignUp) {
      statusSpan.textContent = "Creating account...";
      const cred = await createUserWithEmailAndPassword(auth, email, pass);
      // write a Firestore users doc (email used as ID). Use email as doc id (safe)
      await setDoc(doc(db, "users", email), {
        email,
        approved: false,
        role: "user",
        createdOn: new Date().toISOString()
      });
      alert("✅ Account created! Wait for admin approval.");
      await signOut(auth);
      statusSpan.textContent = "";
    } else {
      statusSpan.textContent = "Signing in...";
      const cred = await signInWithEmailAndPassword(auth, email, pass);
      // check approval
      const udoc = await getDoc(doc(db, "users", email));
      if (!udoc.exists() || !udoc.data().approved) {
        alert("Access pending admin approval.");
        await signOut(auth);
        statusSpan.textContent = "";
        return;
      }
      // success
      window.location.href = "index.html";
    }
  } catch (err) {
    console.error(err);
    alert("Error: " + (err?.message || err));
    statusSpan.textContent = "";
  }
});

// forgot password
forgotLink.addEventListener("click", async (e)=> {
  e.preventDefault();
  const email = emailEl.value.trim();
  if (!email) return alert("Type email then click 'Forgot password'");
  try {
    await sendPasswordResetEmail(auth, email);
    alert("Password reset email sent (check spam).");
  } catch (err) {
    console.error(err);
    alert("Error: " + err.message);
  }
});

// If already logged in (approved) redirect to index
onAuthStateChanged(auth, async (user) => {
  if (user) {
    try {
      const udoc = await getDoc(doc(db, "users", user.email));
      if (udoc.exists() && udoc.data().approved) window.location.href = "index.html";
      else {
        await signOut(auth);
      }
    } catch (err) {
      console.error(err);
    }
  }
});
