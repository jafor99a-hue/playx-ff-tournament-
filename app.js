import { app, auth, db } from "./firebase-config.js";

import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  updateProfile
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-auth.js";

import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  addDoc,
  updateDoc,
  query,
  where,
  orderBy,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";

const ADMIN_EMAIL = "jafor99a@gmail.com";

const $ = (id) => document.getElementById(id);

let currentUser = null;
let currentProfile = null;
let currentView = "dashboard";

function isAdmin() {
  return !!currentUser &&
    currentUser.email?.toLowerCase() === ADMIN_EMAIL.toLowerCase();
}

function say(id, message, error = false) {
  const el = $(id);
  if (!el) return;
  el.textContent = message;
  el.classList.toggle("error", error);
}

function globalMessage(message) {
  $("global-message").textContent = message;
}

function escapeHTML(value = "") {
  return String(value).replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[ch]);
}

function numberValue(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function money(value) {
  return numberValue(value).toLocaleString("bn-BD", {
    maximumFractionDigits: 0
  });
}

function showView(view) {
  const allowed = [
    "dashboard", "tournaments", "joined",
    "wallet", "results", "admin"
  ];

  if (!allowed.includes(view)) view = "dashboard";
  if (view === "admin" && !isAdmin()) view = "dashboard";

  currentView = view;

  document.querySelectorAll(".view").forEach((el) => {
    el.hidden = el.id !== `view-${view}`;
  });

  document.querySelectorAll(".nav-btn").forEach((el) => {
    el.classList.toggle("active", el.dataset.view === view);
  });

  if (view === "tournaments") loadTournaments();
  if (view === "joined") loadJoined();
  if (view === "wallet") loadWallet();
  if (view === "results") loadResults();
  if (view === "admin") loadAdminRequests();
}

document.querySelectorAll("[data-view]").forEach((button) => {
  button.addEventListener("click", () => showView(button.dataset.view));
});

document.querySelectorAll("[data-go]").forEach((button) => {
  button.addEventListener("click", () => showView(button.dataset.go));
});

$("brand-home").addEventListener("click", (event) => {
  event.preventDefault();
  if (currentUser) showView("dashboard");
});

$("auth-form").addEventListener("submit", async (event) => {
  event.preventDefault();

  const email = $("auth-email").value.trim().toLowerCase();
  const password = $("auth-password").value;

  say("auth-message", "লগইন হচ্ছে...");

  try {
    await signInWithEmailAndPassword(auth, email, password);
    say("auth-message", "লগইন সফল।");
  } catch (error) {
    say("auth-message", friendlyError(error), true);
  }
});

$("register-btn").addEventListener("click", async () => {
  const name = $("auth-name").value.trim();
  const email = $("auth-email").value.trim().toLowerCase();
  const password = $("auth-password").value;

  if (!name) {
    say("auth-message", "Register করার আগে নাম লেখো।", true);
    return;
  }

  if (password.length < 6) {
    say("auth-message", "পাসওয়ার্ড কমপক্ষে ৬ অক্ষরের হতে হবে।", true);
    return;
  }

  say("auth-message", "অ্যাকাউন্ট তৈরি হচ্ছে...");

  try {
    const credential = await createUserWithEmailAndPassword(
      auth, email, password
    );

    await updateProfile(credential.user, { displayName: name });

    await setDoc(doc(db, "users", credential.user.uid), {
      uid: credential.user.uid,
      displayName: name,
      email,
      demoBalance: 0,
      createdAt: serverTimestamp()
    });

    say("auth-message", "অ্যাকাউন্ট তৈরি হয়েছে।");
  } catch (error) {
    say("auth-message", friendlyError(error), true);
  }
});

$("logout-btn").addEventListener("click", async () => {
  try {
    await signOut(auth);
  } catch (error) {
    globalMessage(friendlyError(error));
  }
});

function friendlyError(error) {
  const code = error?.code || "";

  const messages = {
    "auth/email-already-in-use": "এই ইমেইল দিয়ে অ্যাকাউন্ট আছে। Login করো।",
    "auth/invalid-email": "ইমেইল ঠিক নয়।",
    "auth/weak-password": "আরও শক্তিশালী পাসওয়ার্ড দাও।",
    "auth/invalid-credential": "ইমেইল বা পাসওয়ার্ড ঠিক নয়।",
    "auth/user-not-found": "এই অ্যাকাউন্ট পাওয়া যায়নি।",
    "auth/wrong-password": "পাসওয়ার্ড ঠিক নয়।",
    "permission-denied": "Firestore Rules অনুমতি দেয়নি।",
    "unavailable": "ইন্টারনেট বা Firebase সংযোগ পরীক্ষা করো।"
  };

  return messages[code] || error?.message || "একটি সমস্যা হয়েছে।";
}

onAuthStateChanged(auth, async (user) => {
  currentUser = user;
  currentProfile = null;

  $("auth-view").hidden = !!user;
  $("app-view").hidden = !user;
  $("logout-btn").hidden = !user;
  $("user-label").textContent = user
    ? (user.displayName || user.email || "Player")
    : "Guest";

  document.querySelectorAll(".admin-nav").forEach((el) => {
    el.hidden = !isAdmin();
  });

  if (!user) return;

  try {
    const profileRef = doc(db, "users", user.uid);
    const profileSnap = await getDoc(profileRef);

    if (!profileSnap.exists()) {
      await setDoc(profileRef, {
        uid: user.uid,
        displayName: user.displayName || "Player",
        email: user.email || "",
        demoBalance: 0,
        createdAt: serverTimestamp()
      });
    }

    const refreshed = await getDoc(profileRef);
    currentProfile = refreshed.data() || { demoBalance: 0 };

    await loadDashboard();
    showView("dashboard");
  } catch (error) {
    globalMessage("প্রোফাইল লোড হয়নি: " + friendlyError(error));
  }
});

async function loadDashboard() {
  if (!currentUser) return;

  const snap = await getDoc(doc(db, "users", currentUser.uid));
  currentProfile = snap.exists() ? snap.data() : { demoBalance: 0 };

  $("dashboard-balance").textContent = money(currentProfile.demoBalance);
  $("wallet-balance").textContent = money(currentProfile.demoBalance);

  const joins = await getDocs(query(
    collection(db, "tournamentJoins"),
    where("userId", "==", currentUser.uid)
  ));

  $("dashboard-joined").textContent = joins.size;
}

async function loadTournaments() {
  const host = $("tournament-list");
  host.innerHTML = '<p class="muted">লোড হচ্ছে...</p>';

  try {
    const snap = await getDocs(collection(db, "tournaments"));

    if (snap.empty) {
      host.innerHTML = '<p class="muted">এখনো কোনো টুর্নামেন্ট নেই।</p>';
      return;
    }

    host.innerHTML = snap.docs.map((item) => {
      const t = item.data();
      const id = item.id;
      const joined = numberValue(t.joinedCount);
      const slots = numberValue(t.slots);
      const full = slots > 0 && joined >= slots;
      const dateText = t.matchTime
        ? escapeHTML(t.matchTime)
        : "সময় পরে জানানো হবে";

      return `
        <article class="tournament-card">
          <p class="eyebrow">FREE TOURNAMENT</p>
          <h3>${escapeHTML(t.title || "Tournament")}</h3>
          <p class="meta">
            Game: ${escapeHTML(t.game || "Free Fire")}<br>
            Prize info: ${escapeHTML(t.prize || "ঘোষণা করা হয়নি")}<br>
            Slots: ${joined}/${slots || "—"}<br>
            Time: ${dateText}
          </p>
          <p class="muted">Tournament ID: ${escapeHTML(id)}</p>
          <button class="btn primary full join-btn"
                  data-id="${escapeHTML(id)}"
                  ${full ? "disabled" : ""}>
            ${full ? "Slots Full" : "Join Free Tournament"}
          </button>
        </article>
      `;
    }).join("");

    host.querySelectorAll(".join-btn").forEach((button) => {
      button.addEventListener("click", () => joinTournament(button.dataset.id));
    });
  } catch (error) {
    host.textContent = "Tournament লোড হয়নি: " + friendlyError(error);
  }
}

async function joinTournament(tournamentId) {
  if (!currentUser) return;

  try {
    const tournamentRef = doc(db, "tournaments", tournamentId);
    const tournamentSnap = await getDoc(tournamentRef);

    if (!tournamentSnap.exists()) {
      globalMessage("টুর্নামেন্ট পাওয়া যায়নি।");
      return;
    }

    const tournament = tournamentSnap.data();

    if (numberValue(tournament.entryFee) > 0) {
      globalMessage("এই সংস্করণে শুধু Free Tournament-এ Join করা যায়।");
      return;
    }

    const joinId = `${tournamentId}_${currentUser.uid}`;
    const joinRef = doc(db, "tournamentJoins", joinId);
    const oldJoin = await getDoc(joinRef);

    if (oldJoin.exists()) {
      globalMessage("তুমি আগে থেকেই এই টুর্নামেন্টে যোগ দিয়েছ।");
      return;
    }

    await setDoc(joinRef, {
      tournamentId,
      userId: currentUser.uid,
      email: currentUser.email || "",
      playerName: currentUser.displayName || "Player",
      joinedAt: serverTimestamp()
    });

    globalMessage("Free Tournament-এ Join সফল হয়েছে।");
    await loadTournaments();
    await loadDashboard();
  } catch (error) {
    globalMessage("Join ব্যর্থ: " + friendlyError(error));
  }
}

async function loadJoined() {
  const host = $("joined-list");
  host.innerHTML = '<p class="muted">লোড হচ্ছে...</p>';

  try {
    const snap = await getDocs(query(
      collection(db, "tournamentJoins"),
      where("userId", "==", currentUser.uid)
    ));

    if (snap.empty) {
      host.innerHTML = '<p class="muted">এখনো কোনো ম্যাচে Join করোনি।</p>';
      return;
    }

    const items = await Promise.all(snap.docs.map(async (joinDoc) => {
      const j = joinDoc.data();
      const tSnap = await getDoc(doc(db, "tournaments", j.tournamentId));
      const title = tSnap.exists()
        ? tSnap.data().title
        : j.tournamentId;

      let room = "";
      try {
        const roomSnap = await getDoc(
          doc(db, "tournamentRooms", j.tournamentId)
        );

        if (roomSnap.exists()) {
          const r = roomSnap.data();
          room = `<p class="meta">
            Room ID: ${escapeHTML(r.roomId || "")}<br>
            Password: ${escapeHTML(r.password || "")}
          </p>`;
        }
      } catch (_) {
        room = '<p class="muted">Room details এখনো পাওয়া যায়নি।</p>';
      }

      return `<article class="tournament-card">
        <h3>${escapeHTML(title || "Tournament")}</h3>
        <p class="meta">ID: ${escapeHTML(j.tournamentId)}</p>
        ${room}
      </article>`;
    }));

    host.innerHTML = items.join("");
  } catch (error) {
    host.textContent = "ম্যাচ লোড হয়নি: " + friendlyError(error);
  }
}

async function loadWallet() {
  try {
    await loadDashboard();

    const snap = await getDocs(query(
      collection(db, "demoBalanceRequests"),
      where("userId", "==", currentUser.uid)
    ));

    $("my-demo-requests").innerHTML = snap.empty
      ? '<p class="muted">কোনো অনুরোধ নেই।</p>'
      : snap.docs.map((item) => {
          const r = item.data();
          return `<div class="panel">
            <b>৳${money(r.amount)}</b>
            <p class="meta">Status: ${escapeHTML(r.status || "pending")}</p>
          </div>`;
        }).join("");
  } catch (error) {
    globalMessage("Wallet লোড হয়নি: " + friendlyError(error));
  }
}

$("demo-request-form").addEventListener("submit", async (event) => {
  event.preventDefault();

  const amount = numberValue($("demo-request-amount").value);

  if (!Number.isInteger(amount) || amount < 1 || amount > 1000) {
    say("demo-request-message", "১ থেকে ১০০০-এর মধ্যে পূর্ণ সংখ্যা দাও।", true);
    return;
  }

  try {
    await addDoc(collection(db, "demoBalanceRequests"), {
      userId: currentUser.uid,
      amount,
      status: "pending",
      createdAt: serverTimestamp()
    });

    say("demo-request-message", "ডেমো অনুরোধ জমা হয়েছে।");
    $("demo-request-form").reset();
    await loadWallet();
  } catch (error) {
    say("demo-request-message", friendlyError(error), true);
  }
});

async function loadResults() {
  const host = $("results-list");
  host.innerHTML = '<p class="muted">লোড হচ্ছে...</p>';

  try {
    const snap = await getDocs(collection(db, "tournamentResults"));

    if (snap.empty) {
      host.innerHTML = '<p class="muted">এখনো কোনো ফলাফল প্রকাশিত হয়নি।</p>';
      return;
    }

    host.innerHTML = snap.docs.map((item) => {
      const r = item.data();
      return `<article class="tournament-card">
        <h3>${escapeHTML(r.title || r.tournamentId || "Result")}</h3>
        <p>${escapeHTML(r.details || "")}</p>
      </article>`;
    }).join("");
  } catch (error) {
    host.textContent = "Results লোড হয়নি: " + friendlyError(error);
  }
}

$("create-tournament-form").addEventListener("submit", async (event) => {
  event.preventDefault();

  if (!isAdmin()) return say("create-message", "Admin অনুমতি দরকার।", true);

  const title = $("t-title").value.trim();
  const game = $("t-game").value.trim();
  const prize = $("t-prize").value.trim();
  const slots = numberValue($("t-slots").value);
  const matchTime = $("t-time").value;

  if (!title || !Number.isInteger(slots) || slots < 2 || slots > 100) {
    return say("create-message", "টুর্নামেন্টের তথ্য পরীক্ষা করো।", true);
  }

  try {
    await addDoc(collection(db, "tournaments"), {
      title,
      game,
      prize,
      slots,
      joinedCount: 0,
      entryFee: 0,
      matchTime,
      createdAt: serverTimestamp(),
      createdBy: currentUser.uid
    });

    say("create-message", "Free Tournament তৈরি হয়েছে।");
    $("create-tournament-form").reset();
    await loadTournaments();
  } catch (error) {
    say("create-message", friendlyError(error), true);
  }
});

$("room-form").addEventListener("submit", async (event) => {
  event.preventDefault();

  if (!isAdmin()) return say("room-message", "Admin অনুমতি দরকার।", true);

  const tournamentId = $("room-tournament").value.trim();
  const roomId = $("room-id").value.trim();
  const password = $("room-password").value.trim();

  try {
    const tournamentSnap = await getDoc(doc(db, "tournaments", tournamentId));
    if (!tournamentSnap.exists()) {
      return say("room-message", "Tournament ID পাওয়া যায়নি।", true);
    }

    await setDoc(doc(db, "tournamentRooms", tournamentId), {
      tournamentId,
      roomId,
      password,
      updatedAt: serverTimestamp()
    });

    say("room-message", "Room details সেভ হয়েছে।");
    $("room-form").reset();
  } catch (error) {
    say("room-message", friendlyError(error), true);
  }
});

$("admin-balance-form").addEventListener("submit", async (event) => {
  event.preventDefault();

  if (!isAdmin()) return say("balance-message", "Admin অনুমতি দরকার।", true);

  const uid = $("balance-user-uid").value.trim();
  const action = $("balance-action").value;
  const amount = numberValue($("balance-amount").value);

  if (!Number.isInteger(amount) || amount < 1 || amount > 1000) {
    return say("balance-message", "১ থেকে ১০০০-এর মধ্যে পূর্ণ সংখ্যা দাও।", true);
  }

  try {
    const userRef = doc(db, "users", uid);
    const userSnap = await getDoc(userRef);

    if (!userSnap.exists()) {
      return say("balance-message", "এই UID-এর User নেই।", true);
    }

    const oldBalance = numberValue(userSnap.data().demoBalance);
    const nextBalance = action === "add"
      ? oldBalance + amount
      : oldBalance - amount;

    if (nextBalance < 0) {
      return say("balance-message", "ডেমো ব্যালেন্স শূন্যের নিচে হতে পারবে না।", true);
    }

    await updateDoc(userRef, { demoBalance: nextBalance });

    say("balance-message", "ডেমো ব্যালেন্স আপডেট হয়েছে।");
    $("admin-balance-form").reset();
    await loadDashboard();
    await loadAdminRequests();
  } catch (error) {
    say("balance-message", friendlyError(error), true);
  }
});

async function loadAdminRequests() {
  if (!isAdmin()) return;

  const host = $("admin-demo-requests");
  host.innerHTML = '<p class="muted">লোড হচ্ছে...</p>';

  try {
    const snap = await getDocs(query(
      collection(db, "demoBalanceRequests"),
      where("status", "==", "pending")
    ));

    if (snap.empty) {
      host.innerHTML = '<p class="muted">কোনো Pending request নেই।</p>';
      return;
    }

    host.innerHTML = snap.docs.map((item) => {
      const r = item.data();
      return `<article class="tournament-card">
        <b>৳${money(r.amount)} (Demo)</b>
        <p class="meta">UID: ${escapeHTML(r.userId)}</p>
        <button class="btn primary approve-demo"
                data-id="${escapeHTML(item.id)}"
                data-uid="${escapeHTML(r.userId)}"
                data-amount="${numberValue(r.amount)}">
          Approve Demo
        </button>
      </article>`;
    }).join("");

    host.querySelectorAll(".approve-demo").forEach((button) => {
      button.addEventListener("click", async () => {
        const requestId = button.dataset.id;
        const uid = button.dataset.uid;
        const amount = numberValue(button.dataset.amount);

        if (!confirm("শুধু ডেমো ব্যালেন্স যোগ করতে অনুমোদন করবে?")) return;

        try {
          const requestRef = doc(db, "demoBalanceRequests", requestId);
          const requestSnap = await getDoc(requestRef);

          if (!requestSnap.exists() ||
              requestSnap.data().status !== "pending") {
            throw new Error("এই অনুরোধ ইতিমধ্যে প্রক্রিয়া হয়েছে।");
          }

          const userRef = doc(db, "users", uid);
          const userSnap = await getDoc(userRef);

          if (!userSnap.exists()) throw new Error("User পাওয়া যায়নি।");

          const balance = numberValue(userSnap.data().demoBalance);

          await updateDoc(userRef, { demoBalance: balance + amount });
          await updateDoc(requestRef, {
            status: "approved",
            reviewedAt: serverTimestamp(),
            reviewedBy: currentUser.uid
          });

          globalMessage("ডেমো অনুরোধ অনুমোদিত হয়েছে।");
          await loadAdminRequests();
          await loadDashboard();
        } catch (error) {
          globalMessage("অনুমোদন ব্যর্থ: " + friendlyError(error));
        }
      });
    });
  } catch (error) {
    host.textContent = "Request লোড হয়নি: " + friendlyError(error);
  }
}

$("result-form").addEventListener("submit", async (event) => {
  event.preventDefault();

  if (!isAdmin()) return say("result-message", "Admin অনুমতি দরকার।", true);

  const tournamentId = $("result-tournament").value.trim();
  const details = $("result-text").value.trim();

  try {
    const tSnap = await getDoc(doc(db, "tournaments", tournamentId));
    if (!tSnap.exists()) {
      return say("result-message", "Tournament ID পাওয়া যায়নি।", true);
    }

    await addDoc(collection(db, "tournamentResults"), {
      tournamentId,
      title: tSnap.data().title || "Tournament Result",
      details,
      createdAt: serverTimestamp(),
      createdBy: currentUser.uid
    });

    say("result-message", "Result প্রকাশ হয়েছে।");
    $("result-form").reset();
  } catch (error) {
    say("result-message", friendlyError(error), true);
  }
});

$("refresh-tournaments").addEventListener("click", loadTournaments);
