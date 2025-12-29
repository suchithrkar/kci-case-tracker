/* ============================================================
   Firebase Initialization — KCI Case Tracker
   Using Firebase JS SDK v12.x ES Modules
   Compatible with GitHub Pages
   ============================================================ */

import { initializeApp } from "https://www.gstatic.com/firebasejs/12.5.0/firebase-app.js";

import {
  getAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  sendPasswordResetEmail,
  signOut
} from "https://www.gstatic.com/firebasejs/12.5.0/firebase-auth.js";

import {
  getFirestore,
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  onSnapshot,
  increment
} from "https://www.gstatic.com/firebasejs/12.5.0/firebase-firestore.js";


/* ============================================================
   Firebase Config — (Your Real Config)
   ============================================================ */
const firebaseConfig = {
  apiKey: "AIzaSyCkVHlYHa8aEbXvOHK0UJmOv5zVx_Kcsx0",
  authDomain: "kci-case-tracker.firebaseapp.com",
  projectId: "kci-case-tracker",
  storageBucket: "kci-case-tracker.firebasestorage.app",
  messagingSenderId: "554993696883",
  appId: "1:554993696883:web:5a0fe904443c7279f7aa06"
};

/* ============================================================
   Initialize App
   ============================================================ */
export const app = initializeApp(firebaseConfig);

/* ============================================================
   Initialize Auth + Firestore
   ============================================================ */
export const auth = getAuth(app);
export const db = getFirestore(app);

/* ============================================================
   Re-export all Firebase helpers (cleaner imports everywhere)
   ============================================================ */

// AUTH
export {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  sendPasswordResetEmail,
  signOut
};

// FIRESTORE
// FIRESTORE
export {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  onSnapshot,
  increment
};

