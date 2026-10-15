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

const auth = getAuth(app);
const db = getFirestore(app);

let currentUser = null;
let selectedTournament = null;
let tournamentsCache = [];

const $ = (selector) => document.querySelector(selector);

function toast(message) {
  const el = $("#toast");
  if (el) {
    el.textContent = message;
    el.hidden = false;
  } else {
    alert(message);
  }
}

function money(value) {
  return "৳" + Number(value || 0).toLocaleString("en-BD");
}

function value(id) {
  return $("#" + id)?.value?.trim() || "";
}

function isAdmin(token) {
  return token?.claims?.admin === true;
}

async function requireAdmin() {
  if (!currentUser) {
    toast("আগে Login করো।");
    return false;
  }

  const token = await currentUser.getIdTokenResult(true);

  if (!isAdmin(token)) {
    toast("তোমার Admin permission নেই।");
    return false;
  }

  return true;
}

// ---------- Login / Register ----------

let authMode = "register";

function setAuthMode(mode) {
  authMode = mode;

  const nameWrap = $("#displayNameWrap");
  const submit = $("#authSubmit");

  if (nameWrap) nameWrap.hidden = mode !== "register";
  if (submit) {
    submit.textContent =
      mode === "register" ? "Register" : "Login";
  }

  const password = $("#password");
  if (password) {
    password.autocomplete =
      mode === "register" ? "new-password" : "current-password";
  }

  $("#account")?.scrollIntoView({ behavior: "smooth" });
}

$("#loginBtn")?.addEventListener("click", () => setAuthMode("login"));
$("#registerBtn")?.addEventListener("click", () => setAuthMode("register"));

$("#authForm")?.addEventListener("submit", async (event) => {
  event.preventDefault();

  const email = value("email");
  const password = $("#password")?.value || "";
  const displayName = value("displayName");
  const message = $("#authMessage");

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
        await updateProfile(credential.user, { displayName });
      }

      if (message) {
        message.textContent = "Registration সফল হয়েছে।";
      }
    } else {
      await signInWithEmailAndPassword(auth, email, password);

      if (message) {
        message.textContent = "Login সফল হয়েছে।";
      }
    }
  } catch (error) {
    console.error("Authentication:", error);

    if (message) {
      message.textContent =
        error.message || "Login/Register সফল হয়নি।";
    }
  }
});

$("#logoutBtn")?.addEventListener("click", async () => {
  try {
    await signOut(auth);
    toast("Logout হয়েছে।");
  } catch (error) {
    toast(error.message);
  }
});

function updateUserUI(user, admin) {
  const status = $("#userStatus");
  const title = $("#accountTitle");
  const authForm = $("#authForm");

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

  if (authForm) authForm.hidden = !!user;

  if ($("#loginBtn")) $("#loginBtn").hidden = !!user;
  if ($("#registerBtn")) $("#registerBtn").hidden = !!user;
  if ($("#logoutBtn")) $("#logoutBtn").hidden = !user;

  const adminPanel = $("#adminPanel");
  if (adminPanel) adminPanel.hidden = !(user && admin);
}

// ---------- Tournament List ----------

async function loadTournaments() {
  const container = $("#tournamentList");
  if (!container) return;

  try {
    const snap = await getDocs(
      query(
        collection(db, "tournaments"),
        orderBy("createdAt", "desc")
      )
    );

    tournamentsCache = snap.docs.map((d) => ({
      id: d.id,
      ...d.data()
    }));

    container.replaceChildren();

    if (!tournamentsCache.length) {
      container.textContent = "এখনো কোনো Tournament নেই।";
    }

    for (const t of tournamentsCache) {
      const card = document.createElement("article");
      card.className = "tournament-card";

      const heading = document.createElement("h3");
      heading.textContent = t.title || "Tournament";

      const info = document.createElement("p");
      info.textContent =
        `Mode: ${t.mode || "—"} · Map: ${t.map || "—"} · Prize: ${t.prizeText || "—"}`;

      const start = document.createElement("p");
      start.textContent =
        "শুরু: " + (t.startTime || "সময় নির্ধারিত নয়");

      const button = document.createElement("button");
      button.className = "btn";
      button.type = "button";
      button.textContent = "Join Now";

      const fee = Number(t.entryFee || 0);
      const feeInfo = document.createElement("p");
      feeInfo.className = "tournament-entry-fee";
      feeInfo.textContent =
        "Entry Fee: " + money(fee) +
        (fee === 0 ? " (Free)" : " (Demo)") +
        (
          t.entryFeeConfirmed === true ||
          !Object.prototype.hasOwnProperty.call(t, "entryFeeConfirmed")
            ? " · নিশ্চিত"
            : " · Admin নিশ্চিত করেননি"
        );

      button.addEventListener("click", () => openJoinModal(t));

      card.append(heading, info, start, feeInfo, button);
      container.append(card);
    }

    await fillTournamentSelects();
  } catch (error) {
    console.error("loadTournaments:", error);
    container.textContent =
      "Tournament লোড হয়নি। Firestore Rules ও createdAt পরীক্ষা করো।";
  }
}

async function fillTournamentSelects() {
  for (const id of [
    "roomTournament",
    "resultTournament",
    "feeTournament"
  ]) {
    const select = $("#" + id);
    if (!select) continue;

    select.replaceChildren();

    const firstOption = document.createElement("option");
    firstOption.value = "";
    firstOption.textContent = "Tournament নির্বাচন করো";
    select.append(firstOption);

    for (const t of tournamentsCache) {
      const option = document.createElement("option");
      option.value = t.id;
      option.textContent = t.title || "Tournament";
      select.append(option);
    }
  }
}

// ---------- Join Modal ----------

function openJoinModal(tournament) {
  if (!currentUser) {
    toast("Join করতে আগে Login করো।");
    setAuthMode("login");
    return;
  }

  selectedTournament = tournament;

  const modal = $("#joinModal");
  if (!modal) {
    toast("Join form পাওয়া যায়নি। index.html পরীক্ষা করো।");
    return;
  }

  const title = $("#joinTournamentTitle");
  if (title) {
    title.textContent = tournament.title || "Tournament";
  }

  const fee = $("#joinEntryFee");
  if (fee) {
    fee.textContent = money(tournament.entryFee || 0);
  }

  modal.hidden = false;
}// ---------- Close Join Modal ----------

$("#closeJoinModal")?.addEventListener("click", () => {
  const modal = $("#joinModal");
  if (modal) modal.hidden = true;
});

$("#cancelJoin")?.addEventListener("click", () => {
  const modal = $("#joinModal");
  if (modal) modal.hidden = true;
});

// ---------- Tournament Join Form ----------

$("#joinForm")?.addEventListener("submit", async (event) => {
  event.preventDefault();

  if (!currentUser) {
    toast("আগে Login করো।");
    return;
  }

  if (!selectedTournament) {
    toast("একটি Tournament নির্বাচন করো।");
    return;
  }

  const playerName = value("playerName");
  const gameUid = value("gameUid");
  const teamName = value("teamName");

  if (!playerName || !gameUid) {
    toast("Player Name এবং Game UID দাও।");
    return;
  }

  const submitButton = $("#joinSubmit");
  if (submitButton) submitButton.disabled = true;

  try {
    const tournamentId = selectedTournament.id;
    const user = currentUser;

    const registrationId = `${tournamentId}_${user.uid}`;
    const registrationRef = doc(
      db,
      "tournamentRegistrations",
      registrationId
    );

    const tournamentRef = doc(db, "tournaments", tournamentId);
    const walletRef = doc(db, "demoWallet", user.uid);

    await runTransaction(db, async (transaction) => {
      const tournamentSnap = await transaction.get(tournamentRef);

      if (!tournamentSnap.exists()) {
        throw new Error("এই Tournament আর পাওয়া যাচ্ছে না।");
      }

      const tournament = tournamentSnap.data();

      if (
        Object.prototype.hasOwnProperty.call(
          tournament,
          "entryFeeConfirmed"
        ) &&
        tournament.entryFeeConfirmed !== true
      ) {
        throw new Error(
          "Admin এখনো Entry Fee নিশ্চিত করেননি।"
        );
      }

      const existingRegistration = await transaction.get(
        registrationRef
      );

      if (existingRegistration.exists()) {
        throw new Error("তুমি ইতিমধ্যে এই Tournament-এ Join করেছ।");
      }

      const fee = Number(tournament.entryFee || 0);// ---------- Admin: Create Tournament ----------

$("#createTournamentForm")?.addEventListener("submit", async (event) => {
  event.preventDefault();

  if (!(await requireAdmin())) return;

  const title = value("tournamentTitle");
  const mode = value("tournamentMode");
  const map = value("tournamentMap");
  const prizeText = value("tournamentPrize");
  const startTime = value("tournamentStart");

  if (!title) {
    toast("Tournament-এর নাম লিখো।");
    return;
  }

  try {
    await addDoc(collection(db, "tournaments"), {
      title,
      mode,
      map,
      prizeText,
      startTime,
      entryFee: 0,
      entryFeeConfirmed: true,
      createdBy: currentUser.uid,
      createdAt: serverTimestamp(),
      status: "open"
    });

    $("#createTournamentForm").reset();
    toast("নতুন Tournament তৈরি হয়েছে।");

    await loadTournaments();
  } catch (error) {
    console.error("Create Tournament:", error);
    toast(error.message || "Tournament তৈরি হয়নি।");
  }
});


// ---------- Admin: Set and Confirm Entry Fee ----------

$("#feeForm")?.addEventListener("submit", async (event) => {
  event.preventDefault();

  if (!(await requireAdmin())) return;

  const tournamentId = value("feeTournament");
  const fee = Number(value("entryFeeAmount"));

  if (!tournamentId) {
    toast("Tournament নির্বাচন করো।");
    return;
  }

  if (!Number.isFinite(fee) || fee < 0) {
    toast("Entry Fee শূন্য বা তার বেশি হতে হবে।");
    return;
  }

  try {
    const tournamentRef = doc(db, "tournaments", tournamentId);

    await setDoc(tournamentRef, {
      entryFee: fee,
      entryFeeConfirmed: true,
      entryFeeConfirmedBy: currentUser.uid,
      entryFeeConfirmedAt: serverTimestamp(),
      paymentMethod: fee > 0 ? "demo-wallet" : "free"
    }, { merge: true });

    toast(
      fee > 0
        ? `Entry Fee ${money(fee)} নির্ধারণ ও নিশ্চিত হয়েছে।`
        : "Tournament Free হিসেবে নিশ্চিত হয়েছে।"
    );

    $("#feeForm").reset();

    await loadTournaments();
  } catch (error) {
    console.error("Set Entry Fee:", error);
    toast(error.message || "Entry Fee সংরক্ষণ হয়নি।");
  }
});


// ---------- Admin: Load Tournament Registrations ----------

async function loadAdminRegistrations() {
  const container = $("#adminRegistrations");
  if (!container) return;

  if (!(await requireAdmin())) return;

  try {
    const snap = await getDocs(
      collection(db, "tournamentRegistrations")
    );

    container.replaceChildren();

    if (snap.empty) {
      container.textContent = "এখনো কোনো Registration নেই।";
      return;
    }

    snap.forEach((registrationDoc) => {
      const data = registrationDoc.data// ---------- Admin: View Demo Payment Requests ----------

async function loadAdminDemoRequests() {
  const container = $("#adminDemoRequests");
  if (!container) return;

  if (!(await requireAdmin())) return;

  try {
    const snap = await getDocs(
      query(
        collection(db, "demoPaymentRequests"),
        orderBy("createdAt", "desc")
      )
    );

    container.replaceChildren();

    if (snap.empty) {
      container.textContent = "কোনো Demo Payment Request নেই।";
      return;
    }

    snap.forEach((requestDoc) => {
      const data = requestDoc.data();

      const card = document.createElement("div");
      card.className = "admin-request-card";

      const details = document.createElement("p");
      details.textContent =
        `${money(data.amount)} | ${data.method || "Demo"} | ` +
        `Transaction ID: ${data.transactionId || "—"} | ` +
        `Status: ${data.status || "pending"}`;

      const user = document.createElement("p");
      user.textContent =
        `User: ${data.email || data.userId || "—"}`;

      card.append(details, user);
      container.append(card);
    });
  } catch (error) {
    console.error("Admin Demo Requests:", error);
    container.textContent =
      "Request লোড হয়নি। Firestore Rules পরীক্ষা করো।";
  }
}


// ---------- Admin: Adjust Demo Wallet Balance ----------
// এটি শুধু পরীক্ষামূলক ব্যালেন্স। বাস্তব টাকা নয়.

$("#adminWalletForm")?.addEventListener("submit", async (event) => {
  event.preventDefault();

  if (!(await requireAdmin())) return;

  const userId = value("walletUserId");
  const amount = Number(value("walletAmount"));
  const action = value("walletAction");

  if (!userId) {
    toast("User UID লিখো।");
    return;
  }

  if (!Number.isFinite(amount) || amount <= 0) {
    toast("সঠিক Amount লিখো।");
    return;
  }

  if (!["add", "subtract"].includes(action)) {
    toast("Add অথবা Subtract নির্বাচন করো।");
    return;
  }

  try {
    const walletRef = doc(db, "demoWallet", userId);

    await runTransaction(db, async (transaction) => {
      const walletSnap = await transaction.get(walletRef);

      const oldBalance = walletSnap.exists()
        ? Number(walletSnap.data().balance || 0)
        : 0;

      const newBalance =
        action === "add"
          ? oldBalance + amount
          : oldBalance - amount;

      if (newBalance < 0) {
        throw new Error("Balance শূন্যের নিচে হতে পারবে না।");
      }

      if (walletSnap.exists()) {
        transaction.update(walletRef, {
          balance: newBalance,
          updatedAt: serverTimestamp