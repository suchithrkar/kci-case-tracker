// login.js (module)
import { app, db, auth } from "./firebase-init.js";
import { 
  createUserWithEmailAndPassword, 
  signInWithEmailAndPassword, 
  sendPasswordResetEmail, 
  signOut, 
  onAuthStateChanged 
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-auth.js";

import { doc, setDoc } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js";

const emailEl = document.getElementById('email');
const passEl = document.getElementById('password');
const loginBtn = document.getElementById('loginBtn');
const toggleMode = document.getElementById('toggleMode');
const forgotBtn = document.getElementById('forgot');

let isSignUp = false;

// toggle login/signup mode
toggleMode.addEventListener('click', ()=>{
  isSignUp = !isSignUp;
  loginBtn.textContent = isSignUp ? 'Sign Up' : 'Login';
  toggleMode.textContent = isSignUp ? 'Already have an account? Login' : "Don't have an account? Sign up";
});

// forgot password
forgotBtn.addEventListener('click', async ()=>{
  const em = emailEl.value.trim();
  if(!em){ alert('Type your email then click Forgot'); return; }
  try{
    await sendPasswordResetEmail(auth, em);
    alert('Password reset email sent.');
  }catch(err){
    console.error(err);
    alert('Error: ' + err.message);
  }
});

// login / sign up
loginBtn.addEventListener('click', async ()=>{
  const email = emailEl.value.trim();
  const pass = passEl.value.trim();
  if(!email || !pass){
    alert('Please fill both fields.');
    return;
  }

  try{
    if(isSignUp){

      // create auth user
      const cred = await createUserWithEmailAndPassword(auth, email, pass);

      // ensure fresh token for rules
      await cred.user.getIdToken(true);

      // 🔥 Use lowercase email as Firestore doc ID
      const userId = email.toLowerCase();

      // create user document
      await setDoc(doc(db, "users", userId), {
        email,
        approved: false,
        role: "user",
        createdOn: new Date().toISOString()
      });

      alert("Account created! Wait for admin approval before logging in.");

      await signOut(auth);
      return;
    }

    // Login
    await signInWithEmailAndPassword(auth, email, pass);
    window.location.href = "index.html";

  }catch(err){
    console.error("Auth error:", err);
    alert("Error: " + err.message);
  }
});

// if already logged in → redirect
onAuthStateChanged(auth, (user)=>{
  if(user) window.location.href = "index.html";
});
