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
    if(isSignUp){
      // create auth user
      const cred = await createUserWithEmailAndPassword(auth, email, pass);
      // create Firestore doc for user (email used as docId)
      // We store email doc id as raw email (you can encode if you prefer)
      // 🔥 ensure token refresh so Firestore sees request.auth
      await cred.user.getIdToken(true);

      // now safe to write user document
      await setDoc(doc(db, "users", email), {
        email,
        approved: false,
        role: 'user',
        createdOn: new Date().toISOString()
      });
      alert('Account created! Wait for admin approval before you can log in.');
      await signOut(auth);
    } else {
      // login
      const u = await signInWithEmailAndPassword(auth, email, pass);
      // on success, redirect will be handled by onAuthStateChanged guard in index.html
      window.location.href = 'index.html';
    }
  }catch(err){
    console.error("Auth error:", err);
    alert('Error: ' + err.message);
  }
});

// if already logged in, go to index
onAuthStateChanged(auth, (user)=>{
  if(user) window.location.href = 'index.html';
});
