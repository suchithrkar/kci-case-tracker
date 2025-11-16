// login.js (module)
import { app, db, auth } from "./firebase-init.js";
import { createUserWithEmailAndPassword, signInWithEmailAndPassword, sendPasswordResetEmail, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-auth.js";
import { doc, setDoc, getDoc } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js";

const emailEl = document.getElementById('email');
const passEl = document.getElementById('password');
const loginBtn = document.getElementById('loginBtn');
const toggleMode = document.getElementById('toggleMode');
const forgotBtn = document.getElementById('forgot');

let isSignUp = false;
toggleMode.addEventListener('click', ()=>{
  isSignUp = !isSignUp;
  loginBtn.textContent = isSignUp ? 'Sign Up' : 'Login';
  toggleMode.textContent = isSignUp ? 'Already have an account? Login' : "Don't have an account? Sign up";
});

forgotBtn.addEventListener('click', async ()=>{
  const em = emailEl.value.trim();
  if(!em){ alert('Type your email then click Forgot'); return; }
  try{
    await sendPasswordResetEmail(auth, em);
    alert('Password reset email sent (check spam).');
  }catch(err){ console.error(err); alert('Error: ' + err.message); }
});

loginBtn.addEventListener('click', async ()=>{
  const email = emailEl.value.trim();
  const pass = passEl.value.trim();
  if(!email || !pass){ alert('Please fill both'); return; }
  try{
    if (isSignUp) {
  try {
    // Create Auth user
    const cred = await createUserWithEmailAndPassword(auth, email, pass);
    console.log("✅ Auth user created:", cred.user.uid, cred.user.email);

    // IMPORTANT: refresh ID token so Firestore sees request.auth for this write
    try {
      await cred.user.getIdToken(true);
      console.log("✅ ID token refreshed for new user");
    } catch (tokErr) {
      console.warn("⚠️ Token refresh failed (continuing):", tokErr);
      // still try to write the doc — we'll catch permission errors below
    }

    // Write Firestore user doc using the raw email as doc ID (rules expect this)
    const userDocRef = doc(db, "users", email);
    const userData = {
      email,
      approved: false,
      role: "user",
      createdOn: new Date().toISOString()
    };

    try {
      await setDoc(userDocRef, userData);
      console.log("✅ Firestore user doc created for:", email);
      alert("Account created! Wait for admin approval before you can log in.");
      // sign out so user must wait for approval
      await signOut(auth);
    } catch (fsErr) {
      // Clear, explicit error for troubleshooting
      console.error("❌ Firestore setDoc failed:", fsErr);
      // If a permission error, explain what to check
      if (fsErr.code && fsErr.code.includes("permission")) {
        alert("Account created in Auth but failed to create user record in Firestore due to permissions. Check Firestore rules and logs (console).");
      } else {
        alert("Account created in Auth but failed creating user record in Firestore: " + fsErr.message);
      }
      // Optional: sign the user out to avoid half-signed-in state
      try { await signOut(auth); } catch(e){ console.warn("Sign-out after failure:", e); }
    }

  } catch (err) {
    console.error("❌ createUserWithEmailAndPassword error:", err);
    alert("Error creating account: " + err.message);
  }
}
});

// if already logged in, go to index
onAuthStateChanged(auth, (user)=>{
  if(user) window.location.href = 'index.html';
});

