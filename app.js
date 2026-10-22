import { auth, db } from "./firebase-config.js";

import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  updateProfile
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-auth.js";

import {
  collection,
  addDoc,
  getDocs,
  getDoc,
  doc,
  setDoc,
  updateDoc,
  query,
  where,
  runTransaction,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";

const ADMIN_EMAIL = "jafor99a@gmail.com";

const $ = id => document.getElementById(id);

let currentUser = null;
let authMode = "login";
let tournaments = [];
let joinedIds = new Set();
let joinTournamentId = null;

function isAdmin() {
  return !!currentUser &&
    (currentUser.email || "").toLowerCase() === ADMIN_EMAIL;
}

function safe(value) {
  return String(value ?? "").replace(/[&<>"']/g, ch => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[ch]);
}

function toast(message) {
  $("toast").textContent = message;
  $("toast").hidden = false;
  setTimeout(() => $("toast").hidden = true, 3500);
}

function errorMessage(error) {
  console.error(error);
  const messages = {
    "auth/invalid-credential": "ইমেইল বা পাসওয়ার্ড ভুল।",
    "auth/email-already-in-use": "এই ইমেইলে অ্যাকাউন্ট আছে।",
    "auth/weak-password": "পাসওয়ার্ড কমপক্ষে ৬ অক্ষরের দিন।",
    "permission-denied": "Firestore Rules অনুমতি দিচ্ছে না।",
    "unavailable": "ইন্টারনেট বা Firebase সংযোগ পরীক্ষা করুন।"
  };
  return messages[error?.code] ||
    error?.message ||
    "সমস্যা হয়েছে। আবার চেষ্টা করুন।";
}

function showAuthMode(mode) {
  authMode = mode;
  $("name-label").hidden = mode !== "register";
  $("display-name").hidden = mode !== "register";
  $("display-name").required = mode === "register";
  $("auth-submit").textContent =
    mode === "register" ? "অ্যাকাউন্ট তৈরি করুন" : "লগইন করুন";
  $("auth-message").textContent = "";
}

$("show-login").addEventListener("click", () => showAuthMode("login"));
$("show-register").addEventListener("click", () => showAuthMode("register"));

$("auth-form").addEventListener("submit", async event => {
  event.preventDefault();
  const button = $("auth-submit");
  button.disabled = true;

  try {
    const email = $("auth-email").value.trim().toLowerCase();
    const password = $("auth-password").value;
    const name = $("display-name").value.trim();

    if (authMode === "register") {
      const credential = await createUserWithEmailAndPassword(
        auth, email, password
      );

      if (name) {
        await updateProfile(credential.user, { displayName: name });
      }

      await setDoc(doc(db, "users", credential.user.uid), {
        uid: credential.user.uid,
        email,
        displayName: name || "Player",
        demoBalance: 0,
        createdAt: serverTimestamp(),
        lastLoginAt: serverTimestamp()
      });

      toast("রেজিস্ট্রেশন সফল হয়েছে।");
    } else {
      await signInWithEmailAndPassword(auth, email, password);
      toast("লগইন সফল হয়েছে।");
    }
  } catch (error) {
    $("auth-message").textContent = errorMessage(error);
  } finally {
    button.disabled = false;
  }
});

$("logout-btn").addEventListener("click", async () => {
  try {
    await signOut(auth);
    toast("Logout হয়েছে।");
  } catch (error) {
    toast(errorMessage(error));
  }
});

function navigate(view) {
  if (view === "admin" && !isAdmin()) {
    toast("Admin অনুমতি নেই।");
    return;
  }

  document.querySelectorAll(".view").forEach(section => {
    section.hidden = section.id !== `view-${view}`;
  });

  document.querySelectorAll("[data-view]").forEach(button => {
    button.classList.toggle("active", button.dataset.view === view);
  });

  if (view === "admin") renderAdmin();
  if (view === "joined") renderJoined();
  if (view === "results") renderResults();
  if (view === "wallet") refreshBalance();
}

document.querySelectorAll("[data-view]").forEach(button => {
  button.addEventListener("click", () => navigate(button.dataset.view));
});

document.querySelectorAll("[data-goto]").forEach(button => {
  button.addEventListener("click", () => navigate(button.dataset.goto));
});

async function ensureProfile(user) {
  const ref = doc(db, "users", user.uid);
  const snap = await getDoc(ref);

  if (!snap.exists()) {
    await setDoc(ref, {
      uid: user.uid,
      email: user.email || "",
      displayName: user.displayName || "Player",
      demoBalance: 0,
      createdAt: serverTimestamp(),
      lastLoginAt: serverTimestamp()
    });
  } else {
    await updateDoc(ref, {
      displayName: user.displayName || "Player",
      email: user.email || "",
      lastLoginAt: serverTimestamp()
    });
  }
}

onAuthStateChanged(auth, async user => {
  currentUser = user;
  $("auth-screen").hidden = !!user;
  $("app-shell").hidden = !user;

  if (!user) return;

  $("user-name").textContent =
    user.displayName || (user.email || "Player").split("@")[0];

  $("user-role").textContent = isAdmin() ? "Admin" : "Player";
  $("welcome-title").textContent =
    `Welcome back, ${user.displayName || "Player"}`;

  $("admin-nav").hidden = !isAdmin();
  $("demo-credit-form").hidden = !isAdmin();
  $("admin-balance-form").hidden = !isAdmin();

  try {
    await ensureProfile(user);
    await Promise.all([
      loadTournaments(),
      loadJoined(),
      refreshBalance()
    ]);
    navigate("dashboard");
  } catch (error) {
    toast(errorMessage(error));
  }
});

async function loadTournaments() {
  const snap = await getDocs(collection(db, "tournaments"));

  tournaments = snap.docs.map(item => ({
    id: item.id,
    ...item.data()
  }));

  tournaments.sort((a, b) => {
    const dateA = a.createdAt?.toMillis?.() || 0;
    const dateB = b.createdAt?.toMillis?.() || 0;
    return dateB - dateA;
  });

  $("stat-tournaments").textContent = String(tournaments.length);
  renderTournaments();
}

async function loadJoined() {
  const snap = await getDocs(query(
    collection(db, "tournamentJoins"),
    where("userId", "==", currentUser.uid)
  ));

  joinedIds = new Set(snap.docs.map(item => item.data().tournamentId));
  $("stat-joined").textContent = String(joinedIds.size);
}

async function refreshBalance() {
  if (!currentUser) return;
  const snap = await getDoc(doc(db, "users", currentUser.uid));
  const balance = Number(snap.data()?.demoBalance || 0);
  $("demo-balance").textContent = String(balance);
  $("wallet-balance").textContent = String(balance);
}

function tournamentCard(tournament) {
  const joined = joinedIds.has(tournament.id);
  const fee = Number(tournament.entryFee || 0);
  const slots = Number(tournament.slots || 48);

  return `
    <article class="tournament-card">
      <p class="eyebrow">${safe(tournament.mode || "SQUAD")} MATCH</p>
      <h3>${safe(tournament.title)}</h3>
      <dl class="facts">
        <dt>Map</dt><dd>${safe(tournament.map || "Bermuda")}</dd>
        <dt>Entry Fee</dt><dd>৳${fee} Demo</dd>
        <dt>Prize Pool</dt><dd>৳${Number(tournament.prizePool || 0)}</dd>
        <dt>Slots</dt><dd>${Number(tournament.joinCount || 0)}/${slots}</dd>
        <dt>Status</dt><dd>${safe(tournament.status || "open")}</dd>
      </dl>
      ${
        joined
          ? '<button class="btn" disabled>Already Joined</button>'
          : tournament.status === "open"
            ? `<button class="btn gold" data-join="${safe(tournament.id)}">Join Now</button>`
            : '<button class="btn" disabled>Closed</button>'
      }
    </article>`;
}

function renderTournaments() {
  const html = tournaments.map(tournamentCard).join("") ||
    '<div class="panel">এখনও কোনো Tournament তৈরি হয়নি। Admin Panel থেকে তৈরি করো।</div>';

  $("all-tournaments").innerHTML = html;
  $("featured-tournaments").innerHTML =
    tournaments.slice(0, 3).map(tournamentCard).join("") ||
    '<div class="panel">Featured Tournament এখনো নেই।</div>';

  if ($("admin-tournaments")) {
    $("admin-tournaments").innerHTML = tournaments.map(t => `
      <div class="list-item">
        <b>${safe(t.title)}</b>
        <p>Tournament ID: ${safe(t.id)}</p>
        <button class="btn" data-copy-id="${safe(t.id)}">Copy ID</button>
      </div>
    `).join("") || '<div class="panel">কোনো Tournament নেই।</div>';
  }
}

document.addEventListener("click", async event => {
  const joinButton = event.target.closest("[data-join]");
  if (joinButton) {
    joinTournamentId = joinButton.dataset.join;
    const tournament = tournaments.find(t => t.id === joinTournamentId);
    $("join-tournament-name").textContent = tournament?.title || "";
    $("join-modal").hidden = false;
  }

  const copyButton = event.target.closest("[data-copy-id]");
  if (copyButton) {
    try {
      await navigator.clipboard.writeText(copyButton.dataset.copyId);
      toast("Tournament ID কপি হয়েছে।");
    } catch {
      toast("ID: " + copyButton.dataset.copyId);
    }
  }
});

$("join-close").addEventListener("click", () => {
  $("join-modal").hidden = true;
});

$("ff-join-form").addEventListener("submit", async event => {
  event.preventDefault();
  if (!currentUser || !joinTournamentId) return;

  const playerName = $("ff-player-name").value.trim();
  const freeFireUid = $("ff-player-uid").value.trim();
  if (!/^[0-9]{5,20}$/.test(freeFireUid)) {
    toast("সঠিক Free Fire UID লিখো।");
    return;
  }

  try {
    await runTransaction(db, async transaction => {
      const userRef = doc(db, "users", currentUser.uid);
      const tournamentRef = doc(db, "tournaments", joinTournamentId);
      const joinRef = doc(
        db, "tournamentJoins", `${joinTournamentId}_${currentUser.uid}`
      );

      const [userSnap, tournamentSnap, joinSnap] = await Promise.all([
        transaction.get(userRef),
        transaction.get(tournamentRef),
        transaction.get(joinRef)
      ]);

      if (!userSnap.exists() || !tournamentSnap.exists()) {
        throw new Error("User বা Tournament পাওয়া যায়নি।");
      }
      if (joinSnap.exists()) throw new Error("তুমি ইতিমধ্যে Join করেছ।");

      const user = userSnap.data();
      const tournament = tournamentSnap.data();
      const fee = Number(tournament.entryFee || 0);
      const balance = Number(user.demoBalance || 0);

      if (tournament.status !== "open") {
        throw new Error("Tournament বন্ধ।");
      }
      if (Number(tournament.joinCount || 0) >= Number(tournament.slots || 48)) {
        throw new Error("Tournament-এর সব Slot পূর্ণ।");
      }
      if (balance < fee) throw new Error("Demo Balance যথেষ্ট নয়।");

      transaction.update(userRef, {
        demoBalance: balance - fee,
        lastEntryTournamentId: joinTournamentId
      });

      transaction.update(tournamentRef, {
        joinCount: Number(tournament.joinCount || 0) + 1
      });

      transaction.set(joinRef, {
        userId: currentUser.uid,
        tournamentId: joinTournamentId,
        tournamentTitle: tournament.title,
        playerName,
        freeFireUid,
        status: "joined",
        createdAt: serverTimestamp()
      });
    });

    $("join-modal").hidden = true;
    $("ff-join-form").reset();
    await Promise.all([loadTournaments(), loadJoined(), refreshBalance()]);
    toast("Tournament Join সফল হয়েছে।");
  } catch (error) {
    toast(errorMessage(error));
  }
});

$("demo-credit-form").addEventListener("submit", async event => {
  event.preventDefault();
  if (!isAdmin()) return;

  const amount = Number($("demo-amount").value);
  if (!Number.isInteger(amount) || amount < 1 || amount > 100000) {
    toast("সঠিক পরিমাণ লিখো।");
    return;
  }

  try {
    await runTransaction(db, async transaction => {
      const ref = doc(db, "users", currentUser.uid);
      const snap = await transaction.get(ref);
      if (!snap.exists()) throw new Error("User profile পাওয়া যায়নি।");

      transaction.update(ref, {
        demoBalance: Number(snap.data().demoBalance || 0) + amount
      });
    });

    $("demo-credit-form").reset();
    await refreshBalance();
    toast("Demo Balance যোগ হয়েছে।");
  } catch (error) {
    toast(errorMessage(error));
  }
});

$("admin-balance-form").addEventListener("submit", async event => {
  event.preventDefault();
  if (!isAdmin()) return;

  const uid = $("balance-player-uid").value.trim();
  const amount = Number($("balance-amount").value);
  const action = $("balance-action").value;

  if (!uid || !Number.isInteger(amount) || amount < 1 || amount > 100000) {
    toast("Player UID ও সঠিক পরিমাণ দাও।");
    return;
  }

  try {
    await runTransaction(db, async transaction => {
      const ref = doc(db, "users", uid);
      const snap = await transaction.get(ref);
      if (!snap.exists()) throw new Error("Player পাওয়া যায়নি।");

      const oldBalance = Number(snap.data().demoBalance || 0);
      const newBalance = action === "add"
        ? oldBalance + amount
        : oldBalance - amount;

      if (newBalance < 0) throw new Error("Balance শূন্যের নিচে হতে পারে না.");

      transaction.update(ref, { demoBalance: newBalance });
    });

    $("balance-admin-message").textContent = "Balance আপডেট হয়েছে।";
    $("admin-balance-form").reset();
    await refreshBalance();
  } catch (error) {
    $("balance-admin-message").textContent = errorMessage(error);
  }
});

$("tournament-form").addEventListener("submit", async event => {
  event.preventDefault();
  if (!isAdmin()) return;

  const entryFee = Number($("t-fee").value);
  const prizePool = Number($("t-prize").value);
  const slots = Number($("t-slots").value);

  if (
    !Number.isInteger(entryFee) || entryFee < 0 || entryFee > 1000 ||
    !Number.isInteger(prizePool) || prizePool < 0 || prizePool > 100000 ||
    !Number.isInteger(slots) || slots < 1 || slots > 100
  ) {
    toast("Entry Fee, Prize বা Slots-এর মান পরীক্ষা করো।");
    return;
  }

  try {
    await addDoc(collection(db, "tournaments"), {
      title: $("t-title").value.trim(),
      mode: $("t-mode").value,
      map: $("t-map").value.trim(),
      entryFee,
      prizePool,
      slots,
      matchTime: $("t-time").value,
      joinCount: 0,
      status: "open",
      createdBy: currentUser.uid,
      createdAt: serverTimestamp()
    });

    $("tournament-form").reset();
    await loadTournaments();
    toast("Tournament তৈরি হয়েছে।");
  } catch (error) {
    toast(errorMessage(error));
  }
});

async function renderJoined() {
  const snap = await getDocs(query(
    collection(db, "tournamentJoins"),
    where("userId", "==", currentUser.uid)
  ));

  const matches = await Promise.all(snap.docs.map(async item => {
    const data = item.data();
    const roomSnap = await getDoc(doc(db, "tournamentRooms", data.tournamentId));
    return { ...data, id: item.id, room: roomSnap.exists() ? roomSnap.data() : null };
  }));

  const html = matches.map(match => `
    <div class="list-item">
      <h3>${safe(match.tournamentTitle || "Tournament")}</h3>
      <p>Player: ${safe(match.playerName)}</p>
      <p>Free Fire UID: ${safe(match.freeFireUid)}</p>
      ${
        match.room
          ? `<p>Room ID: ${safe(match.room.roomId)}</p>
             <p>Room Password: ${safe(match.room.roomPassword)}</p>`
          : '<p>Room Details এখনো প্রকাশ করা হয়নি।</p>'
      }
    </div>
  `).join("");

  $("joined-list").innerHTML = html ||
    '<div class="panel">তুমি এখনো কোনো ম্যাচে Join করোনি।</div>';
  $("home-joined").innerHTML = html ||
    '<div class="panel">কোনো Recent Match নেই।</div>';
}

async function renderResults() {
  const snap = await getDocs(collection(db, "tournamentResults"));
  const results = snap.docs.map(item => ({ id: item.id, ...item.data() }));

  $("results-list").innerHTML = results.map(result => `
    <div class="list-item">
      <h3>${safe(result.title || result.tournamentTitle || "Match Result")}</h3>
      <p>Winner: ${safe(result.winner)}</p>
      <p>Position: ${safe(result.position)}</p>
      <p>Prize: ৳${Number(result.prize || 0)}</p>
    </div>
  `).join("") || '<div class="panel">এখনো কোনো Result প্রকাশিত হয়নি।</div>';
}

$("room-form").addEventListener("submit", async event => {
  event.preventDefault();
  if (!isAdmin()) return;

  const tournamentId = $("room-tournament").value.trim();

  try {
    await setDoc(doc(db, "tournamentRooms", tournamentId), {
      tournamentId,
      roomId: $("room-id").value.trim(),
      roomPassword: $("room-password").value.trim(),
      updatedAt: serverTimestamp()
    });

    $("room-form").reset();
    toast("Room Details সেভ হয়েছে।");
  } catch (error) {
    toast(errorMessage(error));
  }
});

$("result-form").addEventListener("submit", async event => {
  event.preventDefault();
  if (!isAdmin()) return;

  const tournamentId = $("result-tournament").value.trim();
  const tournament = tournaments.find(t => t.id === tournamentId);
  const prize = Number($("result-prize").value);

  if (!Number.isInteger(prize) || prize < 0 || prize > 100000) {
    toast("সঠিক Prize লিখো।");
    return;
  }

  try {
    await addDoc(collection(db, "tournamentResults"), {
      tournamentId,
      tournamentTitle: tournament?.title || "",
      title: $("result-title").value.trim(),
      winner: $("result-winner").value.trim(),
      position: $("result-position").value.trim(),
      prize,
      createdBy: currentUser.uid,
      createdAt: serverTimestamp()
    });

    $("result-form").reset();
    await renderResults();
    toast("Result প্রকাশ হয়েছে।");
  } catch (error) {
    toast(errorMessage(error));
  }
});

async function renderAdmin() {
  if (!isAdmin()) return;

  $("admin-tournaments").innerHTML = tournaments.map(t => `
    <div class="list-item">
      <b>${safe(t.title)}</b>
      <p>Tournament ID: ${safe(t.id)}</p>
      <button class="btn" data-copy-id="${safe(t.id)}">Copy ID</button>
    </div>
  `).join("") || '<div class="panel">এখনো কোনো Tournament নেই।</div>';
}