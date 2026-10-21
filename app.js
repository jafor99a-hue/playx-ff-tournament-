import { auth, db } from "./firebase-config.js";

import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  updateProfile
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-auth.js";

import {
  collection, doc, getDoc, getDocs, query, where,
  setDoc, updateDoc, addDoc, runTransaction,
  serverTimestamp, orderBy
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";

const ADMIN_EMAIL = "jafor99a@gmail.com";
let currentUser = null;
let isAdmin = false;
let tournaments = [];
let selectedTournamentId = null;
let noticeTimer;

const $ = id => document.getElementById(id);
const money = value => Number(value || 0).toLocaleString("en-US");

function showNotice(message) {
  const box = $("notice");
  box.textContent = message;
  box.classList.add("show");
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => box.classList.remove("show"), 6000);
}

function errorMessage(error) {
  console.error(error);
  const messages = {
    "auth/invalid-credential": "ইমেইল অথবা পাসওয়ার্ড সঠিক নয়।",
    "auth/email-already-in-use": "এই ইমেইলে অ্যাকাউন্ট আছে। Login করো।",
    "auth/weak-password": "পাসওয়ার্ড কমপক্ষে ৬ অক্ষরের দাও।",
    "auth/invalid-email": "সঠিক ইমেইল দাও।",
    "permission-denied": "Firestore Permission Denied। Rules এবং ডেটা পরীক্ষা করতে হবে।",
    "failed-precondition": "Firebase-এর কোনো শর্ত পূরণ হয়নি। Console পরীক্ষা করো।"
  };
  showNotice(messages[error.code] || `সমস্যা হয়েছে: ${error.message || error.code || "অজানা সমস্যা"}`);
}

function safeText(value) {
  return String(value ?? "").replace(/[&<>"']/g, char => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;",
    '"': "&quot;", "'": "&#39;"
  }[char]));
}

function showPage(id) {
  document.querySelectorAll(".page").forEach(page => page.classList.add("hidden"));
  $(id)?.classList.remove("hidden");
}

document.querySelectorAll("[data-target]").forEach(button => {
  button.addEventListener("click", () => showPage(button.dataset.target));
});

async function ensureProfile(user, displayName = "") {
  const userRef = doc(db, "users", user.uid);
  const snap = await getDoc(userRef);

  if (!snap.exists()) {
    await setDoc(userRef, {
      uid: user.uid,
      email: user.email || "",
      displayName: displayName || user.displayName || "Player",
      demoBalance: 0,
      createdAt: serverTimestamp(),
      lastLoginAt: serverTimestamp()
    });
  } else {
    const updates = { lastLoginAt: serverTimestamp() };
    if (!snap.data().email && user.email) updates.email = user.email;
    await updateDoc(userRef, updates);
  }
}

async function refreshBalance() {
  if (!currentUser) return;
  const snap = await getDoc(doc(db, "users", currentUser.uid));
  const balance = snap.exists() ? Number(snap.data().demoBalance || 0) : 0;
  $("balance").textContent = money(balance);
  $("wallet-balance").textContent = money(balance);
}

function renderTournamentCard(t, id) {
  const joined = Number(t.joinCount || 0);
  const slots = Number(t.slots || 48);
  const status = t.status || "open";
  const card = document.createElement("article");
  card.className = "tournament-card";
  card.innerHTML = `
    <h3>${safeText(t.title || "Tournament")}</h3>
    <p class="info">🎟️ Entry Fee: ৳${money(t.entryFee)} Demo Balance</p>
    <p class="info">🏆 Prize Pool: ৳${money(t.prizePool)}</p>
    <p class="info">👥 Joined: ${joined} / ${slots}</p>
    <p class="info">Status: ${safeText(status)}</p>
    <button class="join-btn" type="button"
      ${status !== "open" || joined >= slots ? "disabled" : ""}>
      ${status !== "open" ? "বন্ধ" : joined >= slots ? "স্লট পূর্ণ" : "Join Now"}
    </button>`;
  card.querySelector("button").addEventListener("click", () => openJoinModal(id, t.title));
  return card;
}

async function loadTournaments() {
  const container = $("tournament-list");
  container.textContent = "লোড হচ্ছে...";
  try {
    const snap = await getDocs(collection(db, "tournaments"));
    tournaments = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    container.replaceChildren();

    if (!tournaments.length) {
      container.textContent = "এখনো কোনো Tournament তৈরি হয়নি।";
    } else {
      tournaments.forEach(t => container.appendChild(renderTournamentCard(t, t.id)));
    }

    ["room-tournament", "result-tournament"].forEach(id => {
      const select = $(id);
      select.replaceChildren();
      tournaments.forEach(t => {
        const option = document.createElement("option");
        option.value = t.id;
        option.textContent = t.title || t.id;
        select.appendChild(option);
      });
    });
  } catch (error) {
    container.textContent = "Tournament লোড করা যায়নি।";
    errorMessage(error);
  }
}

function openJoinModal(id, title) {
  selectedTournamentId = id;
  $("join-tournament-name").textContent = title || "";
  $("ff-player-name").value = currentUser?.displayName || "";
  $("ff-player-uid").value = "";
  $("join-modal").classList.remove("hidden");
}

$("join-close").addEventListener("click", () => {
  $("join-modal").classList.add("hidden");
});

$("ff-join-form").addEventListener("submit", async event => {
  event.preventDefault();
  if (!currentUser || !selectedTournamentId) return;

  const playerName = $("ff-player-name").value.trim();
  const freeFireUid = $("ff-player-uid").value.trim();

  if (playerName.length < 2 || playerName.length > 60) {
    return showNotice("সঠিক Free Fire Player Name দাও।");
  }
  if (!/^[0-9]{5,20}$/.test(freeFireUid)) {
    return showNotice("Free Fire UID অবশ্যই ৫–২০ সংখ্যার হতে হবে।");
  }

  const button = $("ff-join-form").querySelector("button[type=submit]");
  button.disabled = true;

  try {
    const uid = currentUser.uid;
    const tournamentId = selectedTournamentId;
    const userRef = doc(db, "users", uid);
    const tournamentRef = doc(db, "tournaments", tournamentId);
    const joinRef = doc(db, "tournamentJoins", `${tournamentId}_${uid}`);

    await runTransaction(db, async transaction => {
      const userSnap = await transaction.get(userRef);
      const tournamentSnap = await transaction.get(tournamentRef);
      const joinSnap = await transaction.get(joinRef);

      if (!userSnap.exists()) throw new Error("Player profile পাওয়া যায়নি।");
      if (!tournamentSnap.exists()) throw new Error("Tournament পাওয়া যায়নি।");
      if (joinSnap.exists()) throw new Error("তুমি এই Tournament-এ আগেই Join করেছ।");

      const userData = userSnap.data();
      const tournament = tournamentSnap.data();
      const balance = Number(userData.demoBalance || 0);
      const fee = Number(tournament.entryFee || 0);
      const joined = Number(tournament.joinCount || 0);
      const slots = Number(tournament.slots || 0);

      if (!Number.isSafeInteger(balance) || balance < 0) {
        throw new Error("Demo Balance সঠিক নয়। Admin-এর সঙ্গে যোগাযোগ করো।");
      }
      if (!Number.isInteger(fee) || fee < 0 || fee > 1000) {
        throw new Error("Tournament Entry Fee সঠিক নয়।");
      }
      if (!Number.isInteger(joined) || !Number.isInteger(slots) ||
          slots < 1 || slots > 100 || joined < 0 || joined >= slots) {
        throw new Error("Tournament-এর স্লট পূর্ণ অথবা সেটিং ভুল।");
      }
      if (tournament.status !== "open") throw new Error("এই Tournament এখন Join করা যাচ্ছে না।");
      if (balance < fee) throw new Error("Demo Balance কম। Admin-এর কাছে Demo Balance চাইতে পারো।");

      transaction.update(userRef, {
        demoBalance: balance - fee,
        lastEntryTournamentId: tournamentId
      });

      transaction.set(joinRef, {
        userId: uid,
        tournamentId,
        tournamentTitle: tournament.title || "",
        playerName,
        freeFireUid,
        status: "joined",
        createdAt: serverTimestamp()
      });

      transaction.update(tournamentRef, { joinCount: joined + 1 });
    });

    $("join-modal").classList.add("hidden");
    showNotice("Tournament Join সফল হয়েছে!");
    await Promise.all([refreshBalance(), loadTournaments(), loadJoined()]);
    showPage("joined-section");
  } catch (error) {
    errorMessage(error);
  } finally {
    button.disabled = false;
  }
});

async function loadJoined() {
  if (!currentUser) return;
  const joinedList = $("joined-list");
  const homeJoined = $("home-joined");
  joinedList.textContent = "লোড হচ্ছে...";
  homeJoined.textContent = "লোড হচ্ছে...";

  try {
    const q = query(
      collection(db, "tournamentJoins"),
      where("userId", "==", currentUser.uid)
    );
    const snap = await getDocs(q);
    joinedList.replaceChildren();
    homeJoined.replaceChildren();

    if (snap.empty) {
      joinedList.textContent = "তুমি এখনো কোনো Tournament Join করোনি।";
      homeJoined.textContent = "কোনো Joined Match নেই।";
      return;
    }

    for (const joinDoc of snap.docs) {
      const j = joinDoc.data();
      const item = document.createElement("div");
      item.className = "item-card";
      item.innerHTML = `
        <h3>${safeText(j.tournamentTitle || "Tournament")}</h3>
        <p class="info">Player Name: ${safeText(j.playerName || "")}</p>
        <p class="info">Free Fire UID: ${safeText(j.freeFireUid || "")}</p>
        <p class="info">Status: ${safeText(j.status || "joined")}</p>`;

      try {
        const roomSnap = await getDoc(doc(db, "tournamentRooms", j.tournamentId));
        if (roomSnap.exists()) {
          const room = roomSnap.data();
          item.innerHTML += `
            <p class="info">Room ID: ${safeText(room.roomId || "")}</p>
            <p class="info">Room Password: ${safeText(room.roomPassword || "")}</p>`;
        }
      } catch (error) {
        console.warn("Room details unavailable", error);
      }

      joinedList.appendChild(item);
      homeJoined.appendChild(item.cloneNode(true));
    }
  } catch (error) {
    joinedList.textContent = "Joined Matches লোড হয়নি।";
    homeJoined.textContent = "Joined Matches লোড হয়নি।";
    errorMessage(error);
  }
}

async function loadResults() {
  const container = $("results-list");
  container.textContent = "লোড হচ্ছে...";
  try {
    const snap = await getDocs(collection(db, "tournamentResults"));
    container.replaceChildren();
    if (snap.empty) {
      container.textContent = "এখনো কোনো Result প্রকাশ করা হয়নি।";
      return;
    }
    snap.forEach(d => {
      const r = d.data();
      const item = document.createElement("div");
      item.className = "item-card";
      item.innerHTML = `
        <h3>${safeText(r.tournamentTitle || "Tournament")}</h3>
        <p>${safeText(r.title || "")}</p>
        <p class="info">Winner: ${safeText(r.winner || "")}</p>
        <p class="info">Position: ${safeText(r.position || "")}</p>
        <p class="info">Prize: ৳${money(r.prize)}</p>`;
      container.appendChild(item);
    });
  } catch (error) {
    container.textContent = "Results লোড করা যায়নি।";
    errorMessage(error);
  }
}

$("auth-form").addEventListener("submit", async event => {
  event.preventDefault();
  const email = $("email").value.trim().toLowerCase();
  const password = $("password").value;
  try {
    const credential = await signInWithEmailAndPassword(auth, email, password);
    await ensureProfile(credential.user);
    showNotice("Login সফল হয়েছে!");
  } catch (error) {
    errorMessage(error);
  }
});

$("register-btn").addEventListener("click", async () => {
  const name = $("display-name").value.trim();
  const email = $("email").value.trim().toLowerCase();
  const password = $("password").value;

  if (name.length < 2) return showNotice("Register করার জন্য তোমার নাম দাও।");
  if (!email || password.length < 6) return showNotice("সঠিক ইমেইল ও কমপক্ষে ৬ অক্ষরের পাসওয়ার্ড দাও।");

  try {
    const credential = await createUserWithEmailAndPassword(auth, email, password);
    await updateProfile(credential.user, { displayName: name });
    await ensureProfile(credential.user, name);
    showNotice("অ্যাকাউন্ট তৈরি হয়েছে!");
  } catch (error) {
    errorMessage(error);
  }
});

$("logout-btn").addEventListener("click", async () => {
  try {
    await signOut(auth);
    showNotice("Logout সফল হয়েছে।");
  } catch (error) {
    errorMessage(error);
  }
});

$("request-form").addEventListener("submit", async event => {
  event.preventDefault();
  if (!currentUser) return;

  const amount = Number($("request-amount").value);
  const type = $("request-type").value;
  const reference = $("demo-reference").value.trim();

  if (!Number.isInteger(amount) || amount < 1 || amount > 100000) {
    return showNotice("১ থেকে ১০০০০০-এর মধ্যে পূর্ণ সংখ্যা দাও।");
  }

  try {
    await addDoc(collection(db, "demoBalanceRequests"), {
      userId: currentUser.uid,
      type,
      amount,
      demoTransactionId: reference,
      status: "pending",
      createdAt: serverTimestamp()
    });
    $("request-form").reset();
    showNotice("Demo Balance Request পাঠানো হয়েছে। Admin পরীক্ষা করবে।");
    if (isAdmin) await loadAdminRequests();
  } catch (error) {
    errorMessage(error);
  }
});

$("tournament-form").addEventListener("submit", async event => {
  event.preventDefault();
  if (!isAdmin) return showNotice("শুধু Admin Tournament তৈরি করতে পারবেন।");

  const title = $("t-title").value.trim();
  const entryFee = Number($("t-fee").value);
  const prizePool = Number($("t-prize").value);
  const slots = Number($("t-slots").value);

  if (!title || !Number.isInteger(entryFee) || entryFee < 0 || entryFee > 1000 ||
      !Number.isInteger(prizePool) || prizePool < 0 || prizePool > 100000 ||
      !Number.isInteger(slots) || slots < 1 || slots > 100) {
    return showNotice("Tournament-এর তথ্য সঠিকভাবে পূরণ করো।");
  }

  try {
    await addDoc(collection(db, "tournaments"), {
      title, entryFee, prizePool, slots,
      joinCount: 0,
      status: "open",
      createdBy: currentUser.uid,
      createdAt: serverTimestamp()
    });
    $("tournament-form").reset();
    showNotice("Tournament তৈরি হয়েছে।");
    await loadTournaments();
  } catch (error) {
    errorMessage(error);
  }
});

$("credit-form").addEventListener("submit", async event => {
  event.preventDefault();
  if (!isAdmin) return showNotice("শুধু Admin Balance পরিবর্তন করতে পারবেন।");

  const uid = $("credit-uid").value.trim();
  const amount = Number($("credit-amount").value);
  if (!uid || !Number.isInteger(amount) || amount < 1 || amount > 100000) {
    return showNotice("Player UID ও সঠিক পরিমাণ দাও।");
  }

  try {
    await runTransaction(db, async transaction => {
      const userRef = doc(db, "users", uid);
      const snap = await transaction.get(userRef);
      if (!snap.exists()) throw new Error("এই UID-এর User Profile নেই।");
      const balance = Number(snap.data().demoBalance || 0);
      if (!Number.isSafeInteger(balance) || balance + amount > 100000000) {
        throw new Error("Balance সীমা ছাড়িয়ে যাবে।");
      }
      transaction.update(userRef, { demoBalance: balance + amount });
    });
    $("credit-form").reset();
    showNotice("Demo Balance যোগ হয়েছে।");
    await refreshBalance();
  } catch (error) {
    errorMessage(error);
  }
});

$("room-form").addEventListener("submit", async event => {
  event.preventDefault();
  if (!isAdmin) return showNotice("শুধু Admin Room Details দিতে পারবেন।");

  const tournamentId = $("room-tournament").value;
  const roomId = $("room-id").value.trim();
  const roomPassword = $("room-password").value.trim();
  if (!tournamentId || !roomId || !roomPassword) return showNotice("সব তথ্য পূরণ করো।");

  try {
    await setDoc(doc(db, "tournamentRooms", tournamentId), {
      tournamentId, roomId, roomPassword,
      updatedAt: serverTimestamp()
    });
    showNotice("Room Details Save হয়েছে। Joined Players দেখতে পারবে।");
    $("room-form").reset();
  } catch (error) {
    errorMessage(error);
  }
});

$("result-form").addEventListener("submit", async event => {
  event.preventDefault();
  if (!isAdmin) return showNotice("শুধু Admin Result প্রকাশ করতে পারবেন।");

  const tournamentId = $("result-tournament").value;
  const tournament = tournaments.find(t => t.id === tournamentId);
  const title = $("result-title").value.trim();
  const winner = $("result-winner").value.trim();
  const position = $("result-position").value.trim();
  const prize = Number($("result-prize").value);

  if (!tournamentId || !title || !winner || !position ||
      !Number.isInteger(prize) || prize < 0 || prize > 100000) {
    return showNotice("Result-এর তথ্য সঠিকভাবে পূরণ করো।");
  }

  try {
    await addDoc(collection(db, "tournamentResults"), {
      tournamentId,
      tournamentTitle: tournament?.title || "",
      title, winner, position, prize,
      createdBy: currentUser.uid,
      createdAt: serverTimestamp()
    });
    $("result-form").reset();
    showNotice("Result প্রকাশ হয়েছে।");
    await loadResults();
  } catch (error) {
    errorMessage(error);
  }
});

async function loadAdminRequests() {
  if (!isAdmin) return;
  const container = $("admin-requests");
  container.textContent = "লোড হচ্ছে...";

  try {
    const snap = await getDocs(query(
      collection(db, "demoBalanceRequests"),
      where("status", "==", "pending")
    ));
    container.replaceChildren();

    if (snap.empty) {
      container.textContent = "কোনো Pending Request নেই।";
      return;
    }

    snap.forEach(requestDoc => {
      const r = requestDoc.data();
      const item = document.createElement("div");
      item.className = "item-card";
      item.innerHTML = `
        <p>User UID: ${safeText(r.userId)}</p>
        <p>Type: ${safeText(r.type)}</p>
        <p>Amount: ৳${money(r.amount)} Demo</p>
        <p>Note: ${safeText(r.demoTransactionId || "")}</p>
        <div class="request-actions">
          <button class="primary approve" type="button">Approve</button>
          <button class="secondary reject" type="button">Reject</button>
        </div>`;

      item.querySelector(".approve").addEventListener("click", () =>
        processRequest(requestDoc.id, r, "approved"));
      item.querySelector(".reject").addEventListener("click", () =>
        processRequest(requestDoc.id, r, "rejected"));
      container.appendChild(item);
    });
  } catch (error) {
    container.textContent = "Requests লোড করা যায়নি।";
    errorMessage(error);
  }
}

async function processRequest(requestId, requestData, status) {
  if (!isAdmin) return;
  try {
    await runTransaction(db, async transaction => {
      const requestRef = doc(db, "demoBalanceRequests", requestId);
      const requestSnap = await transaction.get(requestRef);
      if (!requestSnap.exists()) throw new Error("Request পাওয়া যায়নি।");

      const data = requestSnap.data();
      if (data.status !== "pending") throw new Error("Request আগেই Process হয়েছে।");

      let userRef = null;
      let userSnap = null;

      if (status === "approved" && data.type === "add") {
        userRef = doc(db, "users", data.userId);
        userSnap = await transaction.get(userRef);
        if (!userSnap.exists()) throw new Error("Player Profile পাওয়া যায়নি।");
        const oldBalance = Number(userSnap.data().demoBalance || 0);
        const amount = Number(data.amount);
        if (!Number.isSafeInteger(oldBalance) || !Number.isInteger(amount) ||
            amount < 1 || oldBalance + amount > 100000000) {
          throw new Error("Balance বা Request Amount সঠিক নয়।");
        }
        transaction.update(userRef, { demoBalance: oldBalance + amount });
      }

      transaction.update(requestRef, {
        status,
        processedBy: currentUser.uid,
        processedAt: serverTimestamp()
      });
    });

    showNotice(`Request ${status === "approved" ? "Approve" : "Reject"} হয়েছে।`);
    await loadAdminRequests();
    await refreshBalance();
  } catch (error) {
    errorMessage(error);
  }
}

onAuthStateChanged(auth, async user => {
  currentUser = user;
  if (!user) {
    isAdmin = false;
    $("auth-section").classList.remove("hidden");
    $("app-section").classList.add("hidden");
    $("admin-panel").classList.add("hidden");
    return;
  }
  try {
    await ensureProfile(user);
    isAdmin = (user.email || "").toLowerCase() === ADMIN_EMAIL.toLowerCase();

    $("auth-section").classList.add("hidden");
    $("app-section").classList.remove("hidden");
    $("logout-btn").classList.remove("hidden");
    $("profile-name").textContent = user.displayName || "Player";
    $("profile-email").textContent = user.email || "";
    $("admin-nav").classList.toggle("hidden", !isAdmin);
    $("admin-panel").classList.toggle("hidden", !isAdmin);

    await Promise.all([
      refreshBalance(),loadTournaments(), loadJoined(), loadResults()
    ]);
    if (isAdmin) await loadAdminRequests();
    showPage("home-section");
  } catch (error) {
    errorMessage(error);
  }
});