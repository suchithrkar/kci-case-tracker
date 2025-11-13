import { initializeApp } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-app.js";

export const firebaseConfig = {
  apiKey: "AIzaSyCkVHlYHa8aEbXvOHK0UJmOv5zVx_Kcsx0",
  authDomain: "kci-case-tracker.firebaseapp.com",
  projectId: "kci-case-tracker",
  storageBucket: "kci-case-tracker.appspot.com",
  messagingSenderId: "554993696883",
  appId: "1:554993696883:web:5a0fe904443c7279f7aa06"
};

export const app = initializeApp(firebaseConfig);
