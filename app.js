
import app, { firebaseConfig } from "./firebase-config.js";

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

// ---------- Firebase Setup ----------

const auth = getAuth(app);
const db = getFirestore(app);

let currentUser = null;
let selectedTournament = null;

const $ = (selector, root = document) =>
  root.querySelector(selector);

const $$ = (selector, root = document) =>
  [...root.querySelectorAll(selector)];

const first = (...selectors) => {
  for (const selector of selectors) {
    const element = $(selector);
    if (element) return element;
  }
  return null;
};

const configured =
  !!firebaseConfig?.apiKey &&
  !!firebaseConfig?.projectId;

function toast(message) {
  const box = first("#toast", "#message", "#authMessage");
  if (box) {
    box.textContent = message;
    box.hidden = false;
  } else {
    alert(message);
  }
}

function escapeHTML(value = "") {
  return String(value).replace(/[&<>"']/g, char => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[char]);
}

function getValue(root, names) {
  for (const name of names) {
    const el =
      root?.querySelector?.(`#${CSS.escape(name)}`) ||
      root?.querySelector?.(`[name="${name}"]`);

    if (el && typeof el.value === "string") {
      return el.value.trim();
    }
  }
  return "";
}

function money(value) {
  const amount = Number(value || 0);
  return "৳" + amount.toLocaleString("en-BD");
}

function isAdminClaim(token) {
  return token?.claims?.admin === true;
}

async function requireAdmin() {
  if (!currentUser) {
    toast("আগে Login করো।");
    return false;
  }

  const token = await currentUser.getIdTokenResult(true);

  if (!isAdminClaim(token)) {
    toast("তোমার Admin permission নেই।");
    return false;
  }

  return true;
}

// ---------- Authentication ----------

const authForm = first("#auth-form", "#authForm", "#loginForm");
const emailInput = first("#email");
const passwordInput = first("#password");
const nameInput = first("#displayName", "#display-name");
const authMessage = first("#authMessage", "#auth-message");

let authMode = "login";

function showAuthMessage(message) {
  if (authMessage) {
    authMessage.textContent = message;
  } else {
    toast(message);
  }
}

function friendlyError(error) {
  const code = error?.code || "";

  const messages = {
    "auth/invalid-email": "সঠিক Email দাও।",
    "auth/user-not-found": "এই Email-এ Account নেই।",
    "auth/wrong-password": "Password সঠিক নয়।",
    "auth/invalid-credential": "Email অথবা Password ভুল।",
    "auth/email-already-in-use": "এই Email দিয়ে Account আছে।",
    "auth/weak-password": "কমপক্ষে ৬ অক্ষরের Password দাও।",
    "auth/network-request-failed": "Internet সংযোগ পরীক্ষা করো।",
    "permission-denied": "Firebase Rules অনুমতি দেয়নি।"
  };

  return messages[code] || error?.message || "কাজটি সম্পন্ন হয়নি।";
}

function setAuthMode(mode) {
  authMode = mode;

  const registerMode = mode === "register";
  const nameWrap = first("#displayNameWrap", "#display-name-wrap");

  if (nameWrap) nameWrap.hidden = !registerMode;

  const submit = first("#authSubmit", "#auth-submit", "#login-btn");
  if (submit) {
    submit.textContent = registerMode ? "Register" : "Login";
  }
}

first("#loginMode", "#showLogin")?.addEventListener("click", () => {
  setAuthMode("login");
});

first("#registerMode", "#showRegister")?.addEventListener("click", () => {
  setAuthMode("register");
});

first("#register-btn")?.addEventListener("click", () => {
  setAuthMode("register");
});

first("#login-btn")?.addEventListener("click", () => {
  setAuthMode("login");
});

if (authForm) {
  authForm.addEventListener("submit", async event => {
    event.preventDefault();

    if (!configured) {
      showAuthMessage("Firebase Configuration পরীক্ষা করো।");
      return;
    }

    const email = emailInput?.value.trim() || "";
    const password = passwordInput?.value || "";
    const displayName = nameInput?.value.trim() || "";

    if (!email || !password) {
      showAuthMessage("Email ও Password দাও।");
      return;
    }

    const submit = first("#authSubmit", "#auth-submit", "#login-btn");
    if (submit) submit.disabled = true;

    try {
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

        showAuthMessage("Registration সফল হয়েছে।");
      } else {
        await signInWithEmailAndPassword(auth, email, password);
        showAuthMessage("Login সফল হয়েছে।");
      }
    } catch (error) {
      showAuthMessage(friendlyError(error));
    } finally {
      if (submit) submit.disabled = false;
    }
  });
}

first("#logoutBtn", "#logout-btn", "#signOutBtn")
  ?.addEventListener("click", async () => {
    try {
      await signOut(auth);
      location.href = "login.html";
    } catch (error) {
      toast(friendlyError(error));
    }
  });

// ---------- Page Navigation ----------

function setVisible(selectors, visible) {
  for (const selector of selectors) {
    const el = $(selector);
    if (el) el.hidden = !visible;
  }
}

function updateUserUI(user, admin = false) {
  const userName = user?.displayName || user?.email || "";

  for (const selector of [
    "#userEmail",
    "#user-email",
    "#profileEmail"
  ]) {
    const el = $(selector);
    if (el) el.textContent = user?.email || "";
  }

  for (const selector of ["#userName", "#user-name"]) {
    const el = $(selector);
    if (el) el.textContent = userName;
  }

  setVisible(
    ["#adminPanel", "#admin-panel", "#adminSection"],
    !!user && admin
  );

  setVisible(
    ["#loginSection", "#login-section"],
    !user
  );

  setVisible(
    ["#dashboard", "#dashboardSection", "#dashboard-section"],
    !!user
  );
}

// ---------- Tournament List ----------

async function loadTournaments() {
  const container = first(
    "#tournamentList",
    "#tournament-list",
    "#tournaments",
    "#tournamentContainer"
  );

  if (!container) return;

  container.textContent = "Tournament লোড হচ্ছে...";

  try {
    const snapshot = await getDocs(
      query(collection(db, "tournaments"), orderBy("createdAt", "desc"))
    );

    if (snapshot.empty) {
      container.textContent = "এখনো কোনো Tournament নেই।";
      return;
    }

    container.innerHTML = "";

    snapshot.forEach(item => {
      const tournament = item.data();
      const id = item.id;
      const title = tournament.title || tournament.name || "Tournament";
      const fee = Number(tournament.entryFee || 0);
      const prize = Number(tournament.prizePool || 0);

      const card = document.createElement("article");
      card.className = "tournament-card";

      const heading = document.createElement("h3");
      heading.textContent = title;

      const details = document.createElement("p");
      details.textContent =
        `Entry Fee: ${money(fee)} · Prize Pool: ${money(prize)}`;

      const status = document.createElement("p");
      status.textContent = tournament.status || "Open";

      const join = document.createElement("button");
      join.type = "button";
      join.textContent = "Join Now";

      join.addEventListener("click", () => joinTournament(id, tournament));

      card.append(heading, details, status, join);
      container.append(card);
    });
  } catch (error) {
    console.error("loadTournaments:", error);
    container.textContent =
      "Tournament লোড হয়নি। Firestore Rules ও createdAt পরীক্ষা করো।";
  }
}

async function joinTournament(tournamentId, tournament) {
  if (!currentUser) {
    toast("Tournament Join করতে আগে Login করো।");
    return;
  }

  try {
    const registrationId = `${currentUser.uid}_${tournamentId}`;
    const registrationRef = doc(db, "registrations", registrationId);

    const existing = await getDoc(registrationRef);

    if (existing.exists()) {
      toast("তুমি ইতিমধ্যে এই Tournament-এ Join করেছ।");
      return;
    }

    await setDoc(registrationRef, {
      uid: currentUser.uid,
      userId: currentUser.uid,
      tournamentId,
      tournamentName: tournament.title || tournament.name || "Tournament",
      status: "joined",
      createdAt: serverTimestamp()
    });

    toast("Tournament Join Request সফল হয়েছে।");
    await loadRooms();
  } catch (error) {
    console.error("joinTournament:", error);
    toast("Join করা যায়নি: " + friendlyError(error));
  }
}

// ---------- Room ID ----------

async function loadRooms() {
  const container = first(
    "#roomList",
    "#room-list",
    "#myRooms",
    "#my-rooms"
  );

  if (!container || !currentUser) return;

  container.textContent = "Room তথ্য লোড হচ্ছে...";

  try {
    const registrations = await getDocs(
      query(
        collection(db, "registrations"),
        where("uid", "==", currentUser.uid)
      )
    );

    if (registrations.empty) {
      container.textContent = "তুমি এখনো কোনো Tournament-এ Join করোনি।";
      return;
    }

    container.innerHTML = "";

    for (const registration of registrations.docs) {
      const data = registration.data();
      const tournamentId = data.tournamentId;

      if (!tournamentId) continue;

      let roomData = {};

      const roomSnap = await getDoc(
        doc(db, "roomDetails", tournamentId)
      );

      if (roomSnap.exists()) {
        roomData = roomSnap.data();
      }

      const card = document.createElement("article");
      card.className = "room-card";

      const heading = document.createElement("h3");
      heading.textContent =
        data.tournamentName || "Tournament";

      const room = document.createElement("p");
      room.textContent = "Room ID: " + (roomData.roomId || "এখনো প্রকাশিত হয়নি");

      const password = document.createElement("p");
      password.textContent =
        "Room Password: " + (roomData.roomPassword || "এখনো প্রকাশিত হয়নি");

      card.append(heading, room, password);
      container.append(card);
    }
  } catch (error) {
    console.error("loadRooms:", error);
    container.textContent = "Room তথ্য লোড করা যায়নি।";
  }
}

// ---------- Results ----------

async function loadResults() {
  const container = first(
    "#resultList",
    "#result-list",
    "#results",
    "#resultsContainer"
  );

  if (!container) return;

  container.textContent = "Results লোড হচ্ছে...";

  try {
    const snapshot = await getDocs(
      query(collection(db, "results"), orderBy("publishedAt", "desc"))
    );

    if (snapshot.empty) {
      container.textContent = "এখনো কোনো Result প্রকাশিত হয়নি।";
      return;
    }

    container.innerHTML = "";

    snapshot.forEach(item => {
      const result = item.data();
      const card = document.createElement("article");
      card.className = "result-card";

      const heading = document.createElement("h3");
      heading.textContent =
        result.tournamentName || result.title || "Tournament Result";

      const details = document.createElement("p");
      details.textContent =
        result.description || result.winner || "Result প্রকাশিত হয়েছে।";

      card.append(heading, details);
      container.append(card);
    });
  } catch (error) {
    console.error("loadResults:", error);
    container.textContent = "Result লোড করা যায়নি।";
  }
}

// ---------- Admin: Create Tournament ----------

const tournamentForm = first("#tournamentForm", "#tournament-form");

if (tournamentForm) {
  tournamentForm.addEventListener("submit", async event => {
    event.preventDefault();

    try {
      if (!(await requireAdmin())) return;

      const title = getValue(tournamentForm, [
        "title", "name", "tournamentName", "tournamentTitle"
      ]);

      const entryFee = Number(getValue(tournamentForm, [
        "entryFee", "entry-fee", "fee"
      ]) || 0);

      const prizePool = Number(getValue(tournamentForm, [
        "prizePool", "prize-pool", "prize"
      ]) || 0);

      const status = getValue(tournamentForm, ["status"]) || "Open";

      if (!title) {
        toast("Tournament-এর নাম দাও।");
        return;
      }

      if (
        !Number.isFinite(entryFee) ||
        entryFee < 0 ||
        !Number.isFinite(prizePool) ||
        prizePool < 0
      ) {
        toast("Entry Fee ও Prize Pool সঠিকভাবে দাও।");
        return;
      }

      await addDoc(collection(db, "tournaments"), {
        title,
        name: title,
        entryFee,
        prizePool,
        status,
        createdAt: serverTimestamp()
      });

      tournamentForm.reset();
      toast("Tournament তৈরি হয়েছে।");
      await loadTournaments();
    } catch (error) {
      console.error("Create tournament:", error);
      toast("Tournament তৈরি হয়নি: " + friendlyError(error));
    }
  });
}

// ---------- Admin: Room Details ----------

const roomForm = first("#roomForm", "#room-form");

if (roomForm) {
  roomForm.addEventListener("submit", async event => {
    event.preventDefault();

    try {
      if (!(await requireAdmin())) return;

      const tournamentId = getValue(roomForm, [
        "tournamentId", "tournament-id", "roomTournamentId"
      ]);

      const roomId = getValue(roomForm, ["roomId", "room-id"]);
      const roomPassword = getValue(roomForm, [
        "roomPassword", "room-password"
      ]);

      if (!tournamentId || !roomId) {
        toast("Tournament ID ও Room ID দাও।");
        return;
      }

      await setDoc(
        doc(db, "roomDetails", tournamentId),
        {
          tournamentId,
          roomId,
          roomPassword,
          updatedAt: serverTimestamp()
        },
        { merge: true }
      );

      roomForm.reset();
      toast("Room Details সংরক্ষিত হয়েছে।");
      await loadRooms();
    } catch (error) {
      console.error("Save room:", error);
      toast("Room Details সংরক্ষণ হয়নি: " + friendlyError(error));
    }
  });
}

// ---------- Admin: Publish Result ----------

const resultForm = first("#resultForm", "#result-form");

if (resultForm) {
  resultForm.addEventListener("submit", async event => {
    event.preventDefault();

    try {
      if (!(await requireAdmin())) return;

      const tournamentName = getValue(resultForm, [
        "tournamentName", "tournament-name", "title"
      ]);

      const winner = getValue(resultForm, ["winner"]);
      const description = getValue(resultForm, [
        "description", "result", "details"
      ]);

      if (!tournamentName || (!winner && !description)) {
        toast("Tournament-এর নাম এবং Result দাও।");
        return;
      }

      await addDoc(collection(db, "results"), {
        tournamentName,
        winner,
        description,
        publishedAt: serverTimestamp()
      });

      resultForm.reset();
      toast("Result প্রকাশিত হয়েছে।");
      await loadResults();
    } catch (error) {
      console.error("Publish result:", error);
      toast("Result প্রকাশিত হয়নি: " + friendlyError(error));
    }
  });
}

// ---------- Admin: Load Registrations ----------

async function loadAdminData() {
  const container = first(
    "#registrationList",
    "#registration-list",
    "#adminRegistrations"
  );

  if (!container || !currentUser) return;

  try {
    if (!(await requireAdmin())) return;

    const snapshot = await getDocs(collection(db, "registrations"));
    container.innerHTML = "";

    if (snapshot.empty) {
      container.textContent = "এখনো কোনো Registration নেই।";
      return;
    }

    snapshot.forEach(item => {
      const data = item.data();
      const row = document.createElement("p");

      row.textContent =
        `UID: ${data.uid || data.userId || "—"} | Tournament: ${data.tournamentName || data.tournamentId || "—"}`;

      container.append(row);
    });
  } catch (error) {
    console.error("loadAdminData:", error);
    container.textContent = "Admin Data লোড করা যায়নি।";
  }
}

// ---------- Demo Wallet Display ----------

async function loadDemoWallet() {
  const balanceEl = first(
    "#walletBalance",
    "#wallet-balance",
    "#demoBalance",
    "#demo-balance"
  );

  if (!balanceEl || !currentUser) return;

  try {
    const snapshot = await getDoc(
      doc(db, "demoWallet", currentUser.uid)
    );

    if (!snapshot.exists()) {
      balanceEl.textContent = money(0) + " (Demo)";
      return;
    }

    balanceEl.textContent =
      money(snapshot.data().balance || 0) + " (Demo)";
  } catch (error) {
    console.error("loadDemoWallet:", error);
    balanceEl.textContent = "Demo Balance লোড হয়নি";
  }
}

// ---------- Admin: Demo Wallet Controls ----------

function setupDemoWalletControls() {
  const uidInput = first("#walletUid", "#wallet-uid");
  const amountInput = first("#walletAmount", "#wallet-amount");
  const checkButton = first("#walletCheck", "#wallet-check");
  const addButton = first("#walletAdd", "#wallet-add");
  const subtractButton = first("#walletSubtract", "#wallet-subtract");
  const result = first("#walletResult", "#wallet-result");

  if (!uidInput || !amountInput) return;

  async function updateDemoBalance(direction) {
    try {
      if (!(await requireAdmin())) return;

      const uid = uidInput.value.trim();
      const amount = Number(amountInput.value);

      if (!uid || !Number.isFinite(amount) || amount <= 0) {
        toast("সঠিক UID ও Amount দাও।");
        return;
      }

      if (amount > 1000000) {
        toast("Demo Amount সীমার বাইরে।");
        return;
      }

      const walletRef = doc(db, "demoWallet", uid);

      await runTransaction(db, async transaction => {
        const wallet = await transaction.get(walletRef);

        if (!wallet.exists()) {
          throw new Error(
            "এই UID-এর Demo Wallet নেই। আগে নিরাপদভাবে Wallet তৈরি করো।"
          );
        }

        const oldBalance = Number(wallet.data().balance || 0);
        const newBalance = oldBalance + direction * amount;

        if (!Number.isFinite(oldBalance) || newBalance < 0) {
          throw new Error("Demo Balance শূন্যের নিচে হতে পারবে না।");
        }

        transaction.update(walletRef, {
          balance: newBalance,
          updatedAt: serverTimestamp()
        });
      });

      if (result) result.textContent = "Demo Wallet আপডেট হয়েছে।";

      toast("Demo Balance আপডেট হয়েছে।");
      await loadDemoWallet();
    } catch (error) {
      console.error("Demo wallet update:", error);
      const message = friendlyError(error);
      if (result) result.textContent = message;
      toast(message);
    }
  }

  checkButton?.addEventListener("click", async () => {
    try {
      if (!(await requireAdmin())) return;

      const uid = uidInput.value.trim();
      if (!uid) {
        toast("User UID দাও।");
        return;
      }

      const wallet = await getDoc(doc(db, "demoWallet", uid));

      if (!result) return;

      result.textContent = wallet.exists()
        ? `Demo Balance: ${money(wallet.data().balance || 0)}`
        : "এই UID-এর Demo Wallet নেই।";
    } catch (error) {
      toast(friendlyError(error));
    }
  });

  addButton?.addEventListener("click", () => updateDemoBalance(1));
  subtractButton?.addEventListener("click", () => updateDemoBalance(-1));
}

// ---------- Demo Payment Request ----------

const demoPaymentForm = first(
  "#demo-payment-form",
  "#demoPaymentForm"
);

if (demoPaymentForm) {
  demoPaymentForm.addEventListener("submit", async event => {
    event.preventDefault();

    const message = first(
      "#d