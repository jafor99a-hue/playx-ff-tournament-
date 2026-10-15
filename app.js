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
  setDoc,
  updateDoc,
  doc,
  query,
  where,
  serverTimestamp,
  runTransaction
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";

const ADMIN_EMAIL = "jafor99a@gmail.com";
let currentUser = null;
let authMode = "register";

const $ = id => document.getElementById(id);

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, c => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;",
    '"': "&quot;", "'": "&#39;"
  })[c]);
}

function msg(id, text, type = "") {
  const el = $(id);
  if (!el) return;
  el.textContent = text;
  el.className = "message" + (type ? " " + type : "");
}

function intValue(value, min, max) {
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < min || n > max) {
    throw new Error(`সংখ্যাটি ${min} থেকে ${max} পূর্ণসংখ্যা হতে হবে।`);
  }
  return n;
}

function isAdmin() {
  return !!currentUser &&
    currentUser.email?.toLowerCase() === ADMIN_EMAIL.toLowerCase();
}

function errorText(error) {
  const map = {
    "auth/email-already-in-use": "এই Email দিয়ে অ্যাকাউন্ট আছে।",
    "auth/invalid-email": "Email সঠিক নয়।",
    "auth/weak-password": "Password কমপক্ষে ৬ অক্ষরের হতে হবে।",
    "auth/invalid-credential": "Email বা Password সঠিক নয়।",
    "auth/too-many-requests": "অনেকবার চেষ্টা হয়েছে; পরে চেষ্টা করো।",
    "permission-denied": "Permission Denied: Firestore Rules পরীক্ষা করো।",
    "unavailable": "ইন্টারনেট সংযোগ পরীক্ষা করো।"
  };
  return map[error?.code] || error?.message || "একটি সমস্যা হয়েছে।";
}

function showView(name) {
  document.querySelectorAll(".view").forEach(el => {
    el.classList.toggle("hidden", el.id !== `view-${name}`);
  });
  document.querySelectorAll(".nav-btn").forEach(el => {
    el.classList.toggle("active", el.dataset.view === name);
  });
}

$("show-login").addEventListener("click", () => {
  authMode = "login";
  $("auth-name").classList.add("hidden");
  $("auth-submit").textContent = "Login";
  $("show-login").classList.add("primary");
  $("show-register").classList.remove("primary");
  msg("auth-message", "");
});

$("show-register").addEventListener("click", () => {
  authMode = "register";
  $("auth-name").classList.remove("hidden");
  $("auth-submit").textContent = "Register";
  $("show-register").classList.add("primary");
  $("show-login").classList.remove("primary");
  msg("auth-message", "");
});

$("auth-form").addEventListener("submit", async event => {
  event.preventDefault();
  const email = $("auth-email").value.trim().toLowerCase();
  const password = $("auth-password").value;
  const name = $("auth-name").value.trim();

  $("auth-submit").disabled = true;
  msg("auth-message", "অপেক্ষা করো…");

  try {
    if (authMode === "register") {
      if (name.length < 2) throw new Error("Player Name লিখো।");

      const credential = await createUserWithEmailAndPassword(auth, email, password);
      await updateProfile(credential.user, { displayName: name });

      await setDoc(doc(db, "users", credential.user.uid), {
        uid: credential.user.uid,
        email,
        displayName: name,
        demoBalance: 0,
        createdAt: serverTimestamp(),
        lastLoginAt: serverTimestamp()
      });

      msg("auth-message", "Register সফল হয়েছে।", "success");
    } else {
      await signInWithEmailAndPassword(auth, email, password);
      msg("auth-message", "Login সফল হয়েছে।", "success");
    }
  } catch (error) {
    msg("auth-message", errorText(error), "error");
  } finally {
    $("auth-submit").disabled = false;
  }
});

$("logout-btn").addEventListener("click", async () => {
  try {
    await signOut(auth);
  } catch (error) {
    alert(errorText(error));
  }
});

document.querySelectorAll(".nav-btn").forEach(button => {
  button.addEventListener("click", async () => {
    const view = button.dataset.view;
    if (view === "admin" && !isAdmin()) return;
    showView(view);

    try {
      if (view === "home") {
        await loadProfile();
        await loadJoined();
      }
      if (view === "tournaments") await loadTournaments();
      if (view === "wallet") {
        await loadProfile();
        await loadMyRequests();
      }
      if (view === "joined") await loadJoined();
      if (view === "results") await loadResults();
      if (view === "admin" && isAdmin()) await loadAdminRequests();
    } catch (error) {
      alert(errorText(error));
    }
  });
});

document.querySelectorAll("[data-goto]").forEach(button => {
  button.addEventListener("click", () => showView(button.dataset.goto));
});

async function loadProfile() {
  if (!currentUser) return;
  const snap = await getDoc(doc(db, "users", currentUser.uid));
  if (!snap.exists()) throw new Error("User Profile পাওয়া যায়নি।");

  const data = snap.data();
  const balance = Number(data.demoBalance || 0);
  $("welcome-name").textContent = data.displayName || currentUser.displayName || "Player";
  $("welcome-email").textContent = currentUser.email || "";
  $("wallet-balance").textContent = `৳${balance}`;
  $("home-balance").textContent = `৳${balance}`;
}

async function loadTournaments() {
  const list = $("tournament-list");
  list.textContent = "লোড হচ্ছে…";

  const snap = await getDocs(collection(db, "tournaments"));
  const tournaments = snap.docs.map(d => ({ id: d.id, ...d.data() }));

  if (!tournaments.length) {
    list.textContent = "এখনো Tournament তৈরি হয়নি।";
    return;
  }

  list.innerHTML = tournaments.map(t => {
    const fee = Number(t.entryFee || 0);
    const slots = Number(t.slots || 0);
    const joined = Number(t.joinCount || 0);
    const full = slots > 0 && joined >= slots;

    return `
      <article class="tournament-card">
        <h3>${esc(t.title)}</h3>
        <p class="card-line">Mode: ${esc(t.mode)}</p>
        <p class="card-line">Map: ${esc(t.map)}</p>
        <p class="card-line">Entry Fee (Demo): ৳${fee}</p>
        <p class="card-line">Prize Pool (Demo): ৳${Number(t.prizePool || 0)}</p>
        <p class="card-line">Slots: ${joined}/${slots}</p>
        <p class="card-line">Tournament ID: <code>${esc(t.id)}</code></p>
        <button class="btn primary join-btn" data-id="${esc(t.id)}" ${full ? "disabled" : ""}>
          ${full ? "Slots Full" : "Join Tournament"}
        </button>
      </article>`;
  }).join("");

  list.querySelectorAll(".join-btn").forEach(button => {
    button.addEventListener("click", async () => {
      button.disabled = true;
      msg("tournament-message", "Join যাচাই হচ্ছে…");
      try {
        await joinTournament(button.dataset.id);
        await loadProfile();
        await loadTournaments();
        await loadJoined();
      } catch (error) {
        msg("tournament-message", errorText(error), "error");
      } finally {
        button.disabled = false;
      }
    });
  });
}

/*
 * Balance deduction, Join record and slot count are written
 * in one Firestore transaction. Firestore Rules must validate
 * all three changes before this is safe to publish.
 */
async function joinTournament(tournamentId) {
  if (!currentUser) throw new Error("আগে Login করো।");

  const userRef = doc(db, "users", currentUser.uid);
  const tournamentRef = doc(db, "tournaments", tournamentId);
  const joinId = `${tournamentId}_${currentUser.uid}`;
  const joinRef = doc(db, "tournamentJoins", joinId);

  const result = await runTransaction(db, async transaction => {
    const userSnap = await transaction.get(userRef);
    const tournamentSnap = await transaction.get(tournamentRef);
    const joinSnap = await transaction.get(joinRef);

    if (!userSnap.exists()) throw new Error("User Profile পাওয়া যায়নি।");
    if (!tournamentSnap.exists()) throw new Error("Tournament পাওয়া যায়নি।");
    if (joinSnap.exists()) throw new Error("তুমি আগেই Join করেছ।");

    const user = userSnap.data();
    const tournament = tournamentSnap.data();
    const balance = intValue(user.demoBalance ?? 0, 0, 100000000);
    const fee = intValue(tournament.entryFee ?? 0, 0, 1000);
    const slots = intValue(tournament.slots, 1, 100);
    const joined = intValue(tournament.joinCount ?? 0, 0, 100);

    if (balance < fee) {
      throw new Error(`Demo Balance কম। Entry Fee ৳${fee}, Balance ৳${balance}।`);
    }
    if (joined >= slots) throw new Error("সব Slot পূর্ণ।");

    transaction.update(userRef, {
      demoBalance: balance - fee,
      lastEntryTournamentId: tournamentId
    });

    transaction.set(joinRef, {
      userId: currentUser.uid,
      tournamentId,
      tournamentTitle: tournament.title || "Tournament",
      status: "joined",
      createdAt: serverTimestamp()
    });

    transaction.update(tournamentRef, { joinCount: joined + 1 });

    return { fee, balance: balance - fee };
  });

  msg(
    "tournament-message",
    `Join সফল! Entry Fee ৳${result.fee} Demo; বাকি Balance ৳${result.balance}।`,
    "success"
  );
}

async function loadJoined() {
  if (!currentUser) return;
  const q = query(
    collection(db, "tournamentJoins"),
    where("userId", "==", currentUser.uid)
  );
  const snap = await getDocs(q);
  $("home-joined").textContent = String(snap.size);

  if (snap.empty) {
    $("joined-list").textContent = "এখনো কোনো Tournament-এ Join করোনি।";
    return;
  }

  const rows = await Promise.all(snap.docs.map(async item => {
    const data = item.data();
    let roomHTML = "";

    try {
      const roomSnap = await getDoc(doc(db, "tournamentRooms", data.tournamentId));
      if (roomSnap.exists()) {
        const room = roomSnap.data();
        roomHTML = `<p class="card-line">Room ID: ${esc(room.roomId)}</p>
          <p class="card-line">Room Password: ${esc(room.roomPassword)}</p>`;
      }
    } catch (_) {
      // Room information may not be published or accessible yet.
    }

    return `<article class="tournament-card">
      <h3>${esc(data.tournamentTitle)}</h3>
      <p class="card-line">Status: ${esc(data.status)}</p>
      <p class="card-line">Tournament ID: ${esc(data.tournamentId)}</p>
      ${roomHTML}
    </article>`;
  }));

  $("joined-list").innerHTML = rows.join("");
}

async function submitDemoRequest(type) {
  if (!currentUser) throw new Error("আগে Login করো।");

  const add = type === "add";
  const value = intValue(
    add ? $("demo-add-amount").value : $("demo-withdraw-amount").value,
    1, 1000
  );
  const id = (
    add ? $("demo-add-txn").value : $("demo-withdraw-id").value
  ).trim();
  const pattern = add
    ? /^DEMO-TXN-[A-Za-z0-9-]{5,27}$/
    : /^DEMO-WD-[A-Za-z0-9-]{5,27}$/;

  if (!pattern.test(id)) throw new Error("সঠিক Demo Transaction ID লিখো।");

  await addDoc(collection(db, "demoBalanceRequests"), {
    userId: currentUser.uid,
    type,
    amount: value,
    demoTransactionId: id,
    status: "pending",
    createdAt: serverTimestamp()
  });

  if (add) {
    $("demo-add-form").reset();
    msg("demo-add-message", "Request জমা হয়েছে; Balance বদলায়নি।", "success");
  } else {
    $("demo-withdraw-form").reset();
    msg("demo-withdraw-message", "Demo Withdraw Request জমা হয়েছে; টাকা পাঠানো হয়নি।", "success");
  }

  await loadMyRequests();
}

$("demo-add-form").addEventListener("submit", async event => {
  event.preventDefault();
  try {
    await submitDemoRequest("add");
  } catch (error) {
    msg("demo-add-message", errorText(error), "error");
  }
});

$("demo-withdraw-form").addEventListener("submit", async event => {
  event.preventDefault();
  try {
    await submitDemoRequest("withdraw");
  } catch (error) {
    msg("demo-withdraw-message", errorText(error), "error");
  }
});

async function loadMyRequests() {
  if (!currentUser) return;
  const q = query(
    collection(db, "demoBalanceRequests"),
    where("userId", "==", currentUser.uid)
  );
  const snap = await getDocs(q);

  if (snap.empty) {
    $("demo-requests-list").textContent = "কোনো Demo Request নেই।";
    return;
  }

  $("demo-requests-list").innerHTML = snap.docs.map(item => {
    const r = item.data();
    return `<article class="request-card">
      <strong>${r.type === "add" ? "Add Demo" : "Withdraw Demo"}</strong>
      <p class="card-line">পরিমাণ: ৳${Number(r.amount || 0)}</p>
      <p class="card-line">ID: ${esc(r.demoTransactionId)}</p>
      <p class="card-line">Status: ${esc(r.status)}</p>
    </article>`;
  }).join("");
}

async function loadResults() {
  const snap = await getDocs(collection(db, "tournamentResults"));
  if (snap.empty) {
    $("results-list").textContent = "এখনো Result প্রকাশ করা হয়নি।";
    return;
  }

  $("results-list").innerHTML = snap.docs.map(item => {
    const r = item.data();
    return `<article class="result-card">
      <h3>${esc(r.tournamentTitle)}</h3>
      <p class="card-line">Winner: ${esc(r.winner)}</p>
      <p class="card-line">Position: ${Number(r.position)}</p>
      <p class="card-line">Prize (Demo): ৳${Number(r.prize)}</p>
    </article>`;
  }).join("");
}

$("tournament-form").addEventListener("submit", async event => {
  event.preventDefault();
  if (!isAdmin()) {
    msg("tournament-admin-message", "Admin অনুমতি নেই।", "error");
    return;
  }

  try {
    const title = $("t-title").value.trim();
    if (title.length < 3) throw new Error("Tournament Name লিখো।");

    const slots = intValue($("t-slots").value, 1, 100);
    const fee = intValue($("t-entry-fee").value, 0, 1000);
    const prize = intValue($("t-prize").value, 0, 100000);

    await addDoc(collection(db, "tournaments"), {
      title,
      mode: $("t-mode").value,
      map: $("t-map").value,
      slots,
      entryFee: fee,
      prizePool: prize,
      matchTime: $("t-time").value || "",
      joinCount: 0,
      createdBy: currentUser.uid,
      createdAt: serverTimestamp()
    });

    $("tournament-form").reset();
    $("t-slots").value = "48";
    $("t-entry-fee").value = "0";
    $("t-prize").value = "0";
    msg("tournament-admin-message", "Tournament তৈরি হয়েছে।", "success");
    await loadTournaments();
  } catch (error) {
    msg("tournament-admin-message", errorText(error), "error");
  }
});

$("admin-credit-form").addEventListener("submit", async event => {
  event.preventDefault();
  if (!isAdmin()) {
    msg("credit-message", "Admin অনুমতি নেই।", "error");
    return;
  }

  try {
    const uid = $("credit-uid").value.trim();
    const credit = intValue($("credit-amount").value, 1, 10000);
    const userRef = doc(db, "users", uid);

    await runTransaction(db, async transaction => {
      const snap = await transaction.get(userRef);
      if (!snap.exists()) throw new Error("Player UID পাওয়া যায়নি।");

      const current = intValue(snap.data().demoBalance ?? 0, 0, 100000000);
      if (current + credit > 100000000) throw new Error("Demo Balance সীমা অতিক্রম করবে।");

      transaction.update(userRef, { demoBalance: current + credit });
    });

    $("admin-credit-form").reset();
    msg("credit-message", "Demo Credit যোগ হয়েছে।", "success");
  } catch (error) {
    msg("credit-message", errorText(error), "error");
  }
});

$("room-form").addEventListener("submit", async event => {
  event.preventDefault();
  if (!isAdmin()) {
    msg("room-message", "Admin অনুমতি নেই।", "error");
    return;
  }

  try {
    const tournamentId = $("room-tournament-id").value.trim();
    const tournamentSnap = await getDoc(doc(db, "tournaments", tournamentId));
    if (!tournamentSnap.exists()) throw new Error("Tournament ID সঠিক নয়।");

    await setDoc(doc(db, "tournamentRooms", tournamentId), {
      tournamentId,
      roomId: $("room-id").value.trim(),
      roomPassword: $("room-password").value.trim(),
      updatedAt: serverTimestamp()
    });

    $("room-form").reset();
    msg("room-message", "Room Details সেভ হয়েছে।", "success");
  } catch (error) {
    msg("room-message", errorText(error), "error");
  }
});

$("result-form").addEventListener("submit", async event => {
  event.preventDefault();
  if (!isAdmin()) {
    msg("result-admin-message", "Admin অনুমতি নেই।", "error");
    return;
  }

  try {
    const tournamentId = $("result-tournament-id").value.trim();
    const winner = $("result-winner").value.trim();
    const position = intValue($("result-position").value, 1, 100);
    const prize = intValue($("result-prize").value, 0, 100000);

    const tournamentSnap = await getDoc(doc(db, "tournaments", tournamentId));
    if (!tournamentSnap.exists()) throw new Error("Tournament ID সঠিক নয়।");

    await addDoc(collection(db, "tournamentResults"), {
      tournamentId,
      tournamentTitle: tournamentSnap.data().title,
      winner,
      position,
      prize,
      createdBy: currentUser.uid,
      createdAt: serverTimestamp()
    });

    $("result-form").reset();
    msg("result-admin-message", "Result প্রকাশ হয়েছে।", "success");
  } catch (error) {
    msg("result-admin-message", errorText(error), "error");
  }
});

async function loadAdminRequests() {
  if (!isAdmin()) return;
  const snap = await getDocs(collection(db, "demoBalanceRequests"));

  if (snap.empty) {
    $("admin-requests-list").textContent = "কোনো Demo Request নেই।";
    return;
  }

  $("admin-requests-list").innerHTML = snap.docs.map(item => {
    const r = item.data();
    return `<article class="request-card">
      <strong>${r.type === "add" ? "Add Demo" : "Withdraw Demo"}</strong>
      <p class="card-line">Player UID: ${esc(r.userId)}</p>
      <p class="card-line">Amount: ৳${Number(r.amount)}</p>
      <p class="card-line">ID: ${esc(r.demoTransactionId)}</p>
      <p class="card-line">Status: ${esc(r.status)}</p>
    </article>`;
  }).join("");
}

onAuthStateChanged(auth, async user => {
  currentUser = user;
  $("auth-section").classList.toggle("hidden", !!user);
  $("dashboard-section").classList.toggle("hidden", !user);
  $("logout-btn").classList.toggle("hidden", !user);
  $("admin-nav").classList.toggle("hidden", !isAdmin());

  if (!user) return;

  try {
    await loadProfile();
    await loadTournaments();
    await loadJoined();
    showView("home");
    if (isAdmin()) await loadAdminRequests();
  } catch (error) {
    console.error(error);
    alert("Dashboard লোড হয়নি: " + errorText(error));
  }
});
