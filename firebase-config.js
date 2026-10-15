import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-app.js";

import { getAuth } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-auth.js";

// Firebase Configuration
const firebaseConfig = {
  apiKey: "AIzaSyDDweLEqB6C12QS67Ug5U2_s_HHgnreB5s",
  authDomain: "palyx-ff-tournament.firebaseapp.com",
  databaseURL: "https://palyx-ff-tournament-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "palyx-ff-tournament",
  storageBucket: "palyx-ff-tournament.firebasestorage.app",
  messagingSenderId: "809369357695",
  appId: "1:809369357695:web:860377cae1659623815e4a",
  measurementId: "G-E0GMSK7CP9"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);

// Initialize Firebase Authentication
const auth = getAuth(app);

// Export Firebase objects
export { app, auth, firebaseConfig };

export default app;
