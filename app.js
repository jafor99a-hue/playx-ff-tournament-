// ============================================
// PlayX FF Tournament - app.js
// Firebase SDK 11.6.0
// ============================================

import app from "./firebase-config.js";

import {
  getAuth,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  updateProfile
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-auth.js";

import {
  getFirestore,
  collection,
  addDoc,
  getDocs,
  getDoc,
  doc,
  setDoc,
  query,
  where,
  orderBy,
  runTransaction,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";

// ---------- Firebase ----------

const auth = getAuth(app);
const db = getFirestore(app);

let currentUser = null;
let selectedTournament = null;
let tournamentsCache = [];
let authMode = "register";

// ---------- Helpers ----------

const $ = (selector) => document.querySelector(selector);

function byId(...ids) {
  for (const id of ids) {
    const element = document.getElementById(id);
    if (element) return element;
  }
  return null;
}

function field(...ids) {
  for (const id of ids) {
    const element = document.getElementById(id);
    if (element) return element.value?.trim() || "";
  }
  return "";
}

function toast(message) {
  const element = byId("toast", "message", "authMessage");

  if (element) {
    element.textContent = message;
    element.hidden = false;
  } else {
    alert(message);
  }
}

function money(amount) {
  return "৳" + Number(amount || 0).toLocaleString("en-BD");
}

function showError(error, fallback = "কাজটি সম্পন্ন হয়নি।") {
  console.error(error);
  toast(error?.message || fallback);
}

function escapeText(value) {
  return String(value ?? "");
}

function isAdmin(token) {
  return token?.claims?.admin === true;
}

async function requireAdmin() {
  if (!currentUser) {
    toast("আগে Login করো।");
    return false;
  }

  try {
    const token = await currentUser.getIdTokenResult(true);

    if (!isAdmin(token)) {
      toast("তোমার Admin permission নেই।");
      return false;
    }

    return true;
  } catch (error) {
    showError(error, "Admin permission যাচাই করা যায়নি।");
    return false;
  }
}

// ============================================
// LOGIN / REGISTER
// ============================================

function setAuthMode(mode) {
  authMode = mode;

  const nameWrap = byId("displayNameWrap", "nameWrap");
  const submit = byId("authSubmit", "auth-submit");
  const nameInput = byId("displayName", "name");

  if (nameWrap) {
    nameWrap.hidden = mode !== "register";
  }

  if (nameInput) {
    nameInput.required = mode === "register";
  }

  if (submit) {
    submit.textContent = mode === "register" ? "Register" : "Login";
  }

  const password = byId("password");

  if (password) {
    password.autocomplete =
      mode === "register" ? "new-password" : "current-password";
  }
}

byId("loginBtn", "login-btn")?.addEventListener("click", () => {
  setAuthMode("login");
});

byId("registerBtn", "register-btn")?.addEventListener("click", () => {
  setAuthMode("register");
});

// Form ID: camelCase এবং kebab-case দুইটিই সমর্থিত
const authForm = byId("authForm", "auth-form");

if (authForm) {
  authForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    const email = field("email");
    const password = byId("password")?.value || "";
    const displayName = field("displayName", "name");
    const message = byId("authMessage", "message");

    const submitButton = byId(
      "authSubmit",
      "auth-submit",
      "register-btn",
      "login-btn"
    );

    if (!email || !password) {
      toast("Email ও Password পূরণ করো।");
      return;
    }

    if (submitButton) submitButton.disabled = true;

    try {
      if (message) message.textContent = "অপেক্ষা করো...";

      if (authMode === "register") {
        if (password.length < 6) {
          throw new Error("Password কমপক্ষে ৬ অক্ষরের হতে হবে।");
        }

        const credential = await createUserWithEmailAndPassword(
          auth,
          email,
          password
        );

        if (displayName) {
          await updateProfile(credential.user, {
            displayName
          });
        }

        if (message) {
          message.textContent = "Registration সফল হয়েছে!";
        }
      } else {
        await signInWithEmailAndPassword(
          auth,
          email,
          password
        );

        if (message) {
          message.textContent = "Login সফল হয়েছে!";
        }
      }
    } catch (error) {
      console.error("Login/Register error:", error);

      if (message) {
        message.textContent = friendlyAuthError(error);
      } else {
        toast(friendlyAuthError(error));
      }
    } finally {
      if (submitButton) submitButton.disabled = false;
    }
  });
} else {
  console.error(
    "Login/Register form পাওয়া যায়নি। HTML-এ auth-form বা authForm ID পরীক্ষা করো।"
  );
}

function friendlyAuthError(error) {
  const messages = {
    "auth/email-already-in-use": "এই Email দিয়ে আগে Account খোলা হয়েছে।",
    "auth/invalid-email": "সঠিক Email লিখো।",
    "auth/weak-password": "Password কমপক্ষে ৬ অক্ষরের হতে হবে।",
    "auth/invalid-credential": "Email অথবা Password ভুল হয়েছে।",
    "auth/user-not-found": "এই Email দিয়ে Account পাওয়া যায়নি।",
    "auth/wrong-password": "Password ভুল হয়েছে।",
    "auth/network-request-failed": "ইন্টারনেট সংযোগ পরীক্ষা করো।",
    "auth/operation-not-allowed": "Firebase-এ Email/Password Login চালু করো।"
  };

  return messages[error?.code] ||
    error?.message ||
    "Login/Register করা যায়নি।";
}

// Login/Register mode buttons না থাকলে Submit-এর default mode Register।
setAuthMode("register");

// ---------- Logout ----------

byId("logoutBtn", "logout-btn")?.addEventListener(
  "click",
  async () => {
    try {
      await signOut(auth);
      toast("Logout হয়েছে।");
    } catch (error) {
      showError(error, "Logout করা যায়নি।");
    }
  }
);

// ---------- Update User Interface ----------

function updateUserUI(user, admin) {
  const status = byId("userStatus", "user-status");
  const title = byId("accountTitle", "account-title");
  const form = byId("authForm", "auth-form");

  if (status) {
    status.textContent = user
      ? `Login: ${user.email || ""}${admin ? " (Admin)" : ""}`
      : "লগইন করা হয়নি";
  }

  if (title) {
    title.textContent = user
      ? `স্বাগতম ${user.displayName || user.email || ""}`
      : "Welcome to PlayX";
  }

  if (form) form.hidden = !!user;

  const login = byId("loginBtn", "login-btn");
  const register = byId("registerBtn", "register-btn");
  const logout = byId("logoutBtn", "logout-btn");
  const adminPanel = byId("adminPanel", "admin-panel");

  if (login) login.hidden = !!user;
  if (register) register.hidden = !!user;
  if (logout) logout.hidden = !user;
  if (adminPanel) adminPanel.hidden = !(user && admin);
}

// ============================================
// TOURNAMENT LIST
// ============================================

async function loadTournaments() {
  const container = byId("tournamentList", "tournament-list");
  if (!container) return;

  try {
    let snapshot;

    try {
      snapshot = await getDocs(
        query(
          collection(db, "tournaments"),
          orderBy("createdAt", "desc")
        )
      );
    } catch {
      // পুরোনো Tournament-এ createdAt না থাকলে fallback
      snapshot = await getDocs(collection(db, "tournaments"));
    }

    tournamentsCache = snapshot.docs.map((item) => ({
      id: item.id,
      ...item.data()
    }));

    container.replaceChildren();

    if (!tournamentsCache.length) {
      container.textContent = "এখনো কোনো Tournament নেই।";
    }

    for (const tournament of tournamentsCache) {
      const card = document.createElement("article");
      card.className = "tournament-card";

      const heading = document.createElement("h3");
      heading.textContent = tournament.title || "Tournament";

      const info = document.createElement("p");
      info.textContent =
        `Mode: ${tournament.mode || "—"} · ` +
        `Map: ${tournament.map || "—"} · ` +
        `Prize: ${tournament.prizeText || "—"}`;

      const start = document.createElement("p");
      start.textContent =
        "শুরু: " + (tournament.startTime || "সময় নির্ধারিত নয়");

      const fee = Number(tournament.entryFee || 0);
      const feeInfo = document.createElement("p");

      feeInfo.className = "tournament-entry-fee";
      feeInfo.textContent =
        `Entry Fee: ${money(fee)} ` +
        (fee === 0 ? "(Free)" : "(Demo Wallet)") +
        (
          tournament.entryFeeConfirmed === false
            ? " · Admin নিশ্চিত করেননি"
            : " · নিশ্চিত"
        );

      const button = document.createElement("button");
      button.type = "button";
      button.className = "btn";
      button.textContent = "Join Now";

      button.addEventListener("click", () => {
        openJoinModal(tournament);
      });

      card.append(heading, info, start, feeInfo, button);
      container.append(card);
    }

    fillTournamentSelects();
  } catch (error) {
    console.error("Tournament loading error:", error);
    container.textContent =
      "Tournament লোড হয়নি। Firebase সংযোগ ও Firestore Rules পরীক্ষা করো।";
  }
}

function fillTournamentSelects() {
  const ids = [
    "roomTournament",
    "resultTournament",
    "feeTournament"
  ];

  for (const id of ids) {
    const select = document.getElementById(id);
    if (!select) continue;

    const previousValue = select.value;
    select.replaceChildren();

    const first = document.createElement("option");
    first.value = "";
    first.textContent = "Tournament নির্বাচন করো";
    select.append(first);

    for (const tournament of tournamentsCache) {
      const option = document.createElement("option");
      option.value = tournament.id;
      option.textContent = tournament.title || "Tournament";
      select.append(option);
    }

    if (previousValue) select.value = previousValue;
  }
}

// ============================================
// TOURNAMENT JOIN
// ============================================

function openJoinModal(tournament) {
  if (!currentUser) {
    toast("Tournament-এ Join করতে আগে Login করো।");
    setAuthMode("login");
    return;
  }

  selectedTournament = tournament;

  const modal = byId("joinModal", "join-modal");

  if (!modal) {
    toast("Join form পাওয়া যায়নি। index.html পরীক্ষা করতে হবে।");
    return;
  }

  const title = byId("joinTournamentTitle", "join-tournament-title");
  const fee = byId("joinEntryFee", "join-entry-fee");

  if (title) title.textContent = tournament.title || "Tournament";
  if (fee) fee.textContent = money(tournament.entryFee || 0);

  modal.hidden = false;
}

byId("closeJoinModal", "close-join-modal")?.addEventListener(
  "click",
  () => {
    const modal = byId("joinModal", "join-modal");
    if (modal) modal.hidden = true;
  }
);

byId("cancelJoin", "cancel-join")?.addEventListener("click", () => {
  const modal = byId("joinModal", "join-modal");
  if (modal) modal.hidden = true;
});

const joinForm =