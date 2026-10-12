
import { auth } from "./firebase-config.js";
import {
  onAuthStateChanged,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  updateProfile,
  signOut
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-auth.js";

const $ = id => document.getElementById(id);

let mode = "login";

function showError(message) {
  $("errorMessage").textContent = message;
}

function setMode(nextMode) {
  mode = nextMode;
  const registering = mode === "register";

  $("formTitle").textContent = registering ? "Register" : "Login";
  $("authSubmit").textContent = registering ? "Register" : "Login";
  $("displayName").hidden = !registering;
  $("nameLabel").hidden = !registering;
  $("displayName").required = registering;
  $("password").autocomplete =
    registering ? "new-password" : "current-password";

  $("toggleMode").textContent = registering
    ? "আগে থেকেই অ্যাকাউন্ট আছে? Login"
    : "নতুন অ্যাকাউন্ট তৈরি করো";

  $("authMessage").textContent = registering
    ? "নতুন অ্যাকাউন্ট তৈরি করো।"
    : "ইমেইল ও পাসওয়ার্ড দিয়ে Login করো।";

  showError("");
}

onAuthStateChanged(auth, user => {
  if (user) {
    location.replace("index.html");
  }
});

$("toggleMode").addEventListener("click", () => {
  setMode(mode === "login" ? "register" : "login");
});

$("authForm").addEventListener("submit", async event => {
  event.preventDefault();
  showError("");

  const email = $("email").value.trim();
  const password = $("password").value;
  const name = $("displayName").value.trim();
  const button = $("authSubmit");

  button.disabled = true;

  try {
    if (mode === "register") {
      if (!name) throw new Error("তোমার নাম লিখো।");

      const credential = await createUserWithEmailAndPassword(
        auth, email, password
      );

      await updateProfile(credential.user, {
        displayName: name
      });

      // Profile আপডেটের পর Dashboard-এ যাবে।
    } else {
      await signInWithEmailAndPassword(auth, email, password);
    }

    location.replace("index.html");
  } catch (error) {
    const messages = {
      "auth/email-already-in-use": "এই ইমেইলে অ্যাকাউন্ট আছে। Login করো।",
      "auth/invalid-credential": "ইমেইল বা পাসওয়ার্ড সঠিক নয়।",
      "auth/invalid-email": "সঠিক ইমেইল দাও।",
      "auth/weak-password": "আরও শক্তিশালী পাসওয়ার্ড দাও।",
      "auth/network-request-failed": "ইন্টারনেট সংযোগ পরীক্ষা করো।",
      "auth/too-many-requests": "অনেকবার চেষ্টা হয়েছে। পরে চেষ্টা করো।"
    };

    showError(messages[error.code] || error.message || "সমস্যা হয়েছে।");
  } finally {
    button.disabled = false;
  }
});

setMode("login");
