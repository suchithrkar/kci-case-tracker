// firebase-init.js
// Shared Firebase initialization used by other modules.
// Replace the firebaseConfig values below with your project's credentials (I included your current config).
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-auth.js";

export const firebaseConfig = {
  apiKey: "AIzaSyCkVHlYHa8aEbXvOHK0UJmOv5zVx_Kcsx0",
  authDomain: "kci-case-tracker.firebaseapp.com",
  projectId: "kci-case-tracker",
  storageBucket: "kci-case-tracker.appspot.com",
  messagingSenderId: "554993696883",
  appId: "1:554993696883:web:5a0fe904443c7279f7aa06"
};

export const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const auth = getAuth(app);