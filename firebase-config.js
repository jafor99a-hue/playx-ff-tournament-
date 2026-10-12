
import { initializeApp } from "https://www.gstatic.com/firebasejs/13.0.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/13.0.0/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/13.0.0/firebase-firestore.js";

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

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getFirestore(app);
