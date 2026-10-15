import { auth, db } from "./firebase-config.js";

import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-auth.js";

import {
  collection, doc, getDoc, getDocs, query, where,
  setDoc, updateDoc, addDoc, runTransaction, serverTimestamp
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";

const ADMIN_EMAIL = "jafor99a@gmail.com";
let currentUser = null;
let isAdminUser = false;

const $ = id => document.getElementById(id);

function msg(message, type = "") {
  const el = $("notice");
  el.textContent = message;
  el.className = "notice " + type;
}

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, char => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;",
    '"': "&quot;", "'": "&#39;"
  })[char]);
}

function numberField(value, min, max, label) {
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < min || n > max) {
    throw new Error(`${label}: ${min} থেকে ${max} পর্যন্ত পূর্ণ সংখ্যা দাও।`);
  }
  return n;
}

function requireUser() {
  if (!currentUser) throw new Error("আগে Login করো।");
}

function showSignedInUI(user) {
  $("auth-section").hidden = !!user;
  $("app-section").hidden = !user;
  $("logout-btn").hidden = !user;
  $("admin-panel").hidden = !isAdminUser;
}

async function ensureProfile(user, displayName = "") {
  const ref = doc(db, "users", user.uid);
  const snap = await getDoc(ref);

  if (!snap.exists()) {
    await setDoc(ref, {
      uid: user.uid,
      email: user.email,
      displayName: displayName || user.displayName || "Player",
      demoBalance: 0,
      createdAt: serverTimestamp(),
      lastLoginAt: serverTimestamp()
    });
  } else {
    await updateDoc(ref, {
      lastLoginAt: serverTimestamp()
    });
  }
}

$("auth-form").addEventListener("submit", async event => {
  event.preventDefault();
  try {
    const email = $("email").value.trim().toLowerCase();
    const password = $("password").value;
    await signInWithEmailAndPassword(auth, email, password);
    msg("Login সফল।", "success");
  } catch (error) {
    msg("Login ব্যর্থ: " + error.message, "error");
  }
});

$("register-btn").addEventListener("click", async () => {
  try {
    const email = $("email").value.trim().toLowerCase();
    const password = $("password").value;
    const name = $("display-name").value.trim();

    if (!email || password.length < 6) {
      throw new Error("Email দাও এবং Password কমপক্ষে ৬ অক্ষরের রাখো।");
    }
    if (!name) throw new Error("Register করার জন্য নাম দাও।");

    const credential = await createUserWithEmailAndPassword(
      auth, email, password
    );
    await ensureProfile(credential.user, name);
    msg("Register সফল।", "success");
  } catch (error) {
    msg("Register ব্যর্থ: " + error.message, "error");
  }
});

$("logout-btn").addEventListener("click", async () => {
  try {
    await signOut(auth);
    msg("Logout সফল।", "success");
  } catch (error) {
    msg(error.message, "error");
  }
});

onAuthStateChanged(auth, async user => {
  currentUser = user;
  isAdminUser = !!user && user.email?.toLowerCase() === ADMIN_EMAIL;

  showSignedInUI(user);
  if (!user) return;

  try {
    await ensureProfile(user);
    await refreshApp();
  } catch (error) {
    msg("তথ্য লোড করতে সমস্যা: " + error.message, "error");
  }
});

async function refreshApp() {
  requireUser();
  await Promise.all([
    loadProfile(),
    loadTournaments(),
    loadJoined(),
    loadResults()
  ]);

  if (isAdminUser) await loadAdminRequests();
}

async function loadProfile() {
  const snap = await getDoc(doc(db, "users", currentUser.uid));
  if (!snap.exists()) throw new Error("User Profile পাওয়া যায়নি।");

  const data = snap.data();
  $("profile-name").textContent = data.displayName || "Player";
  $("profile-email").textContent = data.email || currentUser.email || "";
  $("balance").textContent = String(data.demoBalance ?? 0);
}

async function loadTournaments() {
  const host = $("tournament-list");
  host.textContent = "লোড হচ্ছে...";

  const snap = await getDocs(collection(db, "tournaments"));
  if (snap.empty) {
    host.textContent = "এখনো কোনো Tournament তৈরি হয়নি।";
    return;
  }

  host.innerHTML = snap.docs.map(item => {
    const t = item.data();
    const fee = Number.isInteger(t.entryFee) ? t.entryFee : "তথ্য অসম্পূর্ণ";
    const slots = Number.isInteger(t.slots) ? t.slots : "?";
    const joined = Number.isInteger(t.joinCount) ? t.joinCount : "?";
    return `<article class="card">
      <h3>${esc(t.title || "Tournament")}</h3>
      <p>Entry Fee: ${esc(fee)} Demo Points</p>
      <p>Prize Pool: ${esc(t.prizePool ?? 0)} Demo Points</p>
      <p>Slots: ${esc(joined)} / ${esc(slots)}</p>
      <p class="muted">Tournament ID: ${esc(item.id)}</p>
      <button data-join="${esc(item.id)}">Join Now</button>
    </article>`;
  }).join("");

  host.querySelectorAll("[data-join]").forEach(button => {
    button.addEventListener("click", async () => {
      button.disabled = true;
      try {
        await joinTournament(button.dataset.join);
        await refreshApp();
      } catch (error) {
        msg("Join ব্যর্থ: " + error.message, "error");
      } finally {
        button.disabled = false;
      }
    });
  });
}

/*
 * Entry Fee transaction:
 * 1. User balance update
 * 2. Join record create
 * 3. Tournament joinCount increment
 * All three writes succeed together or none do.
 */
async function joinTournament(tournamentId) {
  requireUser();

  const userRef = doc(db, "users", currentUser.uid);
  const tournamentRef = doc(db, "tournaments", tournamentId);
  const joinId = `${tournamentId}_${currentUser.uid}`;
  const joinRef = doc(db, "tournamentJoins", joinId);

  const result = await runTransaction(db, async transaction => {
    // All reads happen before any writes.
    const userSnap = await transaction.get(userRef);
    const tournamentSnap = await transaction.get(tournamentRef);
    const joinSnap = await transaction.get(joinRef);

    if (!userSnap.exists()) throw new Error("User Profile পাওয়া যায়নি।");
    if (!tournamentSnap.exists()) throw new Error("Tournament পাওয়া যায়নি।");
    if (joinSnap.exists()) throw new Error("তুমি আগেই Join করেছ।");

    const user = userSnap.data();
    const tournament = tournamentSnap.data();

    const balance = numberField(
      user.demoBalance, 0, 100000000, "Demo Balance"
    );
    const fee = numberField(
      tournament.entryFee, 0, 1000, "Entry Fee"
    );
    const slots = numberField(tournament.slots, 1, 100, "Slots");
    const joined = numberField(tournament.joinCount, 0, 100, "joinCount");

    if (joined >= slots) throw new Error("সব Slot পূর্ণ।");
    if (balance < fee) {
      throw new Error(
        `Demo Balance কম। Entry Fee ${fee}, Balance ${balance}।`
      );
    }

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

    transaction.update(tournamentRef, {
      joinCount: joined + 1
    });

    return { fee, balance: balance - fee };
  });

  msg(
    `Join সফল! ${result.fee} Demo Points কাটা হয়েছে। অবশিষ্ট: ${result.balance}।`,
    "success"
  );
}

async function loadJoined() {
  requireUser();

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
      const roomSnap = await getDoc(
        doc(db, "tournamentRooms", data.tournamentId)
      );
      if (roomSnap.exists()) {
        const room = roomSnap.data();
        roomHTML = `<p>Room ID: ${esc(room.roomId)}</p>
          <p>Room Password: ${esc(room.roomPassword)}</p>`;
      }
    } catch {
      roomHTML = '<p class="muted">Room details এখনো পাওয়া যায়নি।</p>';
    }

    return `<article class="card">
      <h3>${esc(data.tournamentTitle || "Tournament")}</h3>
      <p>Status: ${esc(data.status || "joined")}</p>
      <p class="muted">ID: ${esc(data.tournamentId)}</p>
      ${roomHTML}
    </article>`;
  }));

  $("joined-list").innerHTML = rows.join("");
}

async function loadResults() {
  const snap = await getDocs(collection(db, "tournamentResults"));
  if (snap.empty) {
    $("results-list").textContent = "এখনো কোনো Result প্রকাশিত হয়নি।";
    return;
  }

  $("results-list").innerHTML = snap.docs.map(item => {
    const r = item.data();
    return `<article class="card">
      <h3>${esc(r.tournamentTitle || "Tournament")}</h3>
      <p>Winner: ${esc(r.winner)}</p>
      <p>Position: ${esc(r.position)}</p>
      <p>Prize: ${esc(r.prize)} Demo Points</p>
    </article>`;
  }).join("");
}

$("request-form").addEventListener("submit", async event => {
  event.preventDefault();
  try {
    requireUser();
    const amount = numberField(
      $("request-amount").value, 1, 1000, "Amount"
    );
    const reference = $("demo-reference").value.trim();

    if (reference.length < 8 || reference.length > 40) {
      throw new Error("Demo Reference ৮–৪০ অক্ষরের হতে হবে।");
    }

    await addDoc(collection(db, "demoBalanceRequests"), {
      userId: currentUser.uid,
      type: $("request-type").value,
      amount,
      demoTransactionId: reference,
      status: "pending",
      createdAt: serverTimestamp()
    });

    $("request-form").reset();
    msg("Demo Request পাঠানো হয়েছে। Balance এখনো পরিবর্তন হয়নি।", "success");
    if (isAdminUser) await loadAdminRequests();
  } catch (error) {
    msg("Request ব্যর্থ: " + error.message, "error");
  }
});

$("tournament-form").addEventListener("submit", async event => {
  event.preventDefault();
  try {
    if (!isAdminUser) throw new Error("Admin অনুমতি প্রয়োজন।");

    const title = $("t-title").value.trim();
    if (title.length < 3 || title.length > 80) {
      throw new Error("Tournament Name ৩–৮০ অক্ষরের হতে হবে।");
    }

    const entryFee = numberField($("t-fee").value, 0, 1000, "Entry Fee");
    const prizePool = numberField($("t-prize").value, 0, 100000, "Prize Pool");
    const slots = numberField($("t-slots").value, 1, 100, "Slots");

    await addDoc(collection(db, "tournaments"), {
      title,
      entryFee,
      prizePool,
      slots,
      joinCount: 0,
      createdBy: currentUser.uid,
      createdAt: serverTimestamp()
    });

    $("tournament-form").reset();
    msg("Tournament তৈরি হয়েছে।", "success");
    await loadTournaments();
  } catch (error) {
    msg("Tournament তৈরি ব্যর্থ: " + error.message, "error");
  }
});

$("credit-form").addEventListener("submit", async event => {
  event.preventDefault();
  try {
    if (!isAdminUser) throw new Error("Admin অনুমতি প্রয়োজন।");

    const uid = $("credit-uid").value.trim();
    const amount = numberField(
      $("credit-amount").value, 1, 100000, "Demo Credit"
    );
    const userRef = doc(db, "users", uid);

    await runTransaction(db, async transaction => {
      const snap = await transaction.get(userRef);
      if (!snap.exists()) throw new Error("এই UID-এর User নেই.");

      const current = numberField(
        snap.data().demoBalance, 0, 100000000, "বর্তমান Balance"
      );
      if (current + amount > 100000000) {
        throw new Error("Balance সর্বোচ্চ সীমা ছাড়িয়ে যাবে।");
      }
      transaction.update(userRef, { demoBalance: current + amount });
    });

    $("credit-form").reset();
    msg("Demo Credit যোগ হয়েছে।", "success");
    await loadProfile();
  } catch (error) {
    msg("Demo Credit ব্যর্থ: " + error.message, "error");
  }
});

$("room-form").addEventListener("submit", async event => {
  event.preventDefault();
  try {
    if (!isAdminUser) throw new Error("Admin অনুমতি প্রয়োজন।");

    const tournamentId = $("room-tournament").value.trim();
    const roomId = $("room-id").value.trim();
    const roomPassword = $("room-password").value;

    if (!tournamentId || !roomId || !roomPassword) {
      throw new Error("সব Room ফিল্ড পূরণ করো।");
    }

    const tournamentSnap = await getDoc(doc(db, "tournaments", tournamentId));
    if (!tournamentSnap.exists()) throw new Error("Tournament ID পাওয়া যায়নি।");

    await setDoc(doc(db, "tournamentRooms", tournamentId), {
      tournamentId,
      roomId,
      roomPassword,
      updatedAt: serverTimestamp()
    });

    $("room-form").reset();
    msg("Room Details সংরক্ষিত হয়েছে।", "success");
  } catch (error) {
    msg("Room Details ব্যর্থ: " + error.message, "error");
  }
});

$("result-form").addEventListener("submit", async event => {
  event.preventDefault();
  try {
    if (!isAdminUser) throw new Error("Admin অনুমতি প্রয়োজন।");

    const tournamentId = $("result-tournament").value.trim();
    const tournamentTitle = $("result-title").value.trim();
    const winner = $("result-winner").value.trim();
    const position = numberField($("result-position").value, 1, 100, "Position");
    const prize = numberField($("result-prize").value, 0, 100000, "Prize");

    const tournamentSnap = await getDoc(doc(db, "tournaments", tournamentId));
    if (!tournamentSnap.exists()) throw new Error("Tournament ID পাওয়া যায়নি।");

    await addDoc(collection(db, "tournamentResults"), {
      tournamentId,
      tournamentTitle,
      winner,
      position,
      prize,
      createdBy: currentUser.uid,
      createdAt: serverTimestamp()
    });

    $("result-form").reset();
    msg("Result প্রকাশিত হয়েছে।", "success");
    await loadResults();
  } catch (error) {
    msg("Result প্রকাশ ব্যর্থ: " + error.message, "error");
  }
});

async function loadAdminRequests() {
  if (!isAdminUser) return;

  const snap = await getDocs(collection(db, "demoBalanceRequests"));
  const pending = snap.docs.filter(item => item.data().status === "pending");

  if (!pending.length) {
    $("admin-requests").textContent = "কোনো Pending Request নেই।";
    return;
  }

  $("admin-requests").innerHTML = pending.map(item => {
    const r = item.data();
    return `<article class="card">
      <p>Type: ${esc(r.type)}</p>
      <p>Amount: ${esc(r.amount)} Demo Points</p>
      <p>Player UID: ${esc(r.userId)}</p>
      <p>Reference: ${esc(r.demoTransactionId)}</p>
      <p>Status: Pending</p>
    </article>`;
  }).join("");
      }
