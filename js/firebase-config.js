// firebase-config.js
// Firebase initialization (modular SDK)

import { initializeApp } from "https://www.gstatic.com/firebasejs/12.5.0/firebase-app.js";
import {
  getAuth
} from "https://www.gstatic.com/firebasejs/12.5.0/firebase-auth.js";

import {
  getFirestore
} from "https://www.gstatic.com/firebasejs/12.5.0/firebase-firestore.js";

// -----------------------------------------------------
// IMPORTANT:
// Your admin email is NOT hard-coded anywhere.
// Admin privilege is read ONLY from Firestore user.role.
// -----------------------------------------------------

// Your Firebase project configuration
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

// Export reusable services
const auth = getAuth(app);
const db = getFirestore(app);

export { auth, db };