// login.js (type=module)
import { app } from "./firebase-init.js";
import { getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword, sendPasswordResetEmail, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-auth.js";
import { getFirestore, doc, setDoc, getDoc } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js";

const auth = getAuth(app);
const db = getFirestore(app);

const emailEl = document.getElementById('email');
const passEl = document.getElementById('password');
const loginBtn = document.getElementById('loginBtn');
const toggleMode = document.getElementById('toggleMode');
const forgotBtn = document.getElementById('forgotBtn');

let isSignUp = false;

toggleMode.addEventListener('click', ()=>{
  isSignUp = !isSignUp;
  loginBtn.textContent = isSignUp ? 'Sign Up' : 'Login';
  toggleMode.textContent = isSignUp ? 'Already have an account? Login' : 'Don’t have an account? Sign up';
});

forgotBtn.addEventListener('click', async ()=>{
  const e = emailEl.value.trim();
  if (!e) return alert('Enter your email to reset password');
  try{
    await sendPasswordResetEmail(auth, e);
    alert('Password reset email sent.');
  }catch(err){ alert('Error: '+err.message); console.error(err); }
});

loginBtn.addEventListener('click', async ()=>{
  const e = emailEl.value.trim();
  const p = passEl.value.trim();
  if (!e || !p) return alert('Please fill both fields');
  try{
    if (isSignUp){
      const userCred = await createUserWithEmailAndPassword(auth, e, p);
      console.log('Auth created:', userCred.user.uid);
      // create user doc in Firestore using email as doc id
      await setDoc(doc(db, "users", e), {
        email: e,
        approved: false,
        role: 'user',
        createdOn: new Date().toISOString()
      });
      alert('Account created! Wait for admin approval.');
      await signOut(auth);
    } else {
      const userCred = await signInWithEmailAndPassword(auth, e, p);
      // check approved flag
      const snap = await getDoc(doc(db, "users", e));
      if (!snap.exists() || !snap.data().approved){
        alert('Access pending admin approval.');
        await signOut(auth);
        return;
      }
      // success
      window.location.href = 'index.html';
    }
  }catch(err){
    console.error('Error in Auth:', err);
    alert('Error: ' + (err.message || err.code));
  }
});

// auto-redirect if already signed in and approved
onAuthStateChanged(auth, async (user)=>{
  if (user){
    try{
      const snap = await getDoc(doc(db, "users", user.email));
      if (snap.exists() && snap.data().approved){
        window.location.href = 'index.html';
      } else {
        // not approved -> sign out keep on login page
        await signOut(auth);
      }
    }catch(e){ console.error(e); }
  }
});
