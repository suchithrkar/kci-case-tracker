// =================== LOGIN / SIGNUP / RESET ===================
import { app } from "./firebase-init.js";
import {
  getAuth,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  sendPasswordResetEmail,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-auth.js";
import {
  getFirestore,
  doc,
  setDoc,
  getDoc
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js";

const auth = getAuth(app);
const db = getFirestore(app);

const emailField = document.getElementById("email");
const passwordField = document.getElementById("password");
const btnLogin = document.getElementById("btnLogin");
const btnSignup = document.getElementById("btnSignup");
const btnForgot = document.getElementById("btnForgot");

// --- Sign In ---
btnLogin?.addEventListener("click", async () => {
  const email = emailField.value.trim();
  const password = passwordField.value.trim();
  if (!email || !password) return alert("Please enter email and password.");

  try {
    await signInWithEmailAndPassword(auth, email, password);
    window.location.replace("index.html");
  } catch (err) {
    alert("Login failed: " + err.message);
  }
});

// --- Sign Up ---
btnSignup?.addEventListener("click", async () => {
  const email = emailField.value.trim();
  const password = passwordField.value.trim();
  if (!email || !password) return alert("Please enter email and password.");

  try {
    console.log("Attempting to create account in Firebase Auth...");
    await createUserWithEmailAndPassword(auth, email, password);

    // Add user record to Firestore (pending approval)
    await setDoc(doc(db, "users", email), {
      email,
      approved: false,
      createdAt: new Date().toISOString()
    });

    alert("Account created successfully. Please wait for admin approval.");
    await auth.signOut();
    window.location.replace("login.html");
  } catch (err) {
    console.error("Error creating user:", err);
    alert("Error: " + err.message);
  }
});

// --- Forgot Password ---
btnForgot?.addEventListener("click", async () => {
  const email = prompt("Enter your registered email:");
  if (!email) return;
  try {
    await sendPasswordResetEmail(auth, email);
    alert("Password reset email sent! Please check your inbox.");
  } catch (err) {
    alert("Error sending reset email: " + err.message);
  }
});

// --- Auto Redirect if Logged In ---
onAuthStateChanged(auth, async (user) => {
  if (user) {
    // Check if approved
    const userDoc = await getDoc(doc(db, "users", user.email));
    if (userDoc.exists() && userDoc.data().approved) {
      window.location.replace("index.html");
    } else {
      await auth.signOut();
    }
  }
});
