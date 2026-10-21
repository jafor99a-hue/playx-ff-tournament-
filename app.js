
import { auth, db } from "./firebase-config.js";

import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-auth.js";

import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  where,
  setDoc,
  updateDoc,
  addDoc,
  runTransaction,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";

const ADMIN_EMAIL = "jafor99a@gmail.com";

let currentUser = null;
let isAdminUser = false;

const $ = id => document.getElementById(id);

function msg(message, type = "") {
  const el = $("notice");
  if (!el) return;
  el.textContent = message;
  el.className = "notice " + type;
}

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, c => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[c]);
}

function numberField(value, min, max, label) {
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < min || n > max) {
    throw new Error(
      `${label}: ${min} থেকে ${max} পর্যন্ত পূর্ণ সংখ্যা দাও।`
    );
  }
  return n;
}

function requireUser() {
  if (!currentUser) throw new Error("আগে Login করো।");
}

function requireAdmin() {
  requireUser();
  if (!isAdminUser) throw new Error("শুধু Admin এই কাজ করতে পারবেন।");
}

function showSignedInUI(user) {
  $("auth-section").hidden = !!user;
  $("app-section").hidden = !user;
  $("logout-btn").hidden = !user;
  $("admin-panel").hidden = !isAdminUser;
}

async function ensureProfile(user, name = "") {
  const ref = doc(db, "users", user.uid);
  const snap = await getDoc(ref);

  if (!snap.exists()) {
    await setDoc(ref, {
      uid: user.uid,
      email: user.email || "",
      displayName: name || user.displayName || "Player",
      demoBalance: 0,
      createdAt: serverTimestamp(),
      lastLoginAt: serverTimestamp()
    });
  } else {
    const data = snap.data();
    const changes = { lastLoginAt: serverTimestamp() };

    if (!Number.isSafeInteger(data.demoBalance)) {
      changes.demoBalance = 0;
    }

    if (!data.email && user.email) {
      changes.email = user.email;
    }

    await updateDoc(ref, changes);
  }
}

/* LOGIN */
$("auth-form").addEventListener("submit", async event => {
  event.preventDefault();

  try {
    const email = $("email").value.trim().toLowerCase();
    const password = $("password").value;

    await signInWithEmailAndPassword(auth, email, password);
    msg("Login সফল হয়েছে।", "success");
  } catch (error) {
    msg("Login ব্যর্থ: " + error.message, "error");
  }
});

/* REGISTER */
$("register-btn").addEventListener("click", async () => {
  try {
    const email = $("email").value.trim().toLowerCase();
    const password = $("password").value;
    const name = $("display-name").value.trim();

    if (!email || password.length < 6) {
      throw new Error("Email দাও এবং Password কমপক্ষে ৬ অক্ষর রাখো।");
    }

    if (!name) {
      throw new Error("Register করার জন্য নাম দাও।");
    }

    const credential = await createUserWithEmailAndPassword(
      auth, email, password
    );

    await ensureProfile(credential.user, name);
    msg("Register সফল হয়েছে।", "success");
  } catch (error) {
    msg("Register ব্যর্থ: " + error.message, "error");
  }
});

/* LOGOUT */
$("logout-btn").addEventListener("click", async () => {
  try {
    await signOut(auth);
    msg("Logout সফল হয়েছে।", "success");
  } catch (error) {
    msg(error.message, "error");
  }
});

/* LOGIN STATE */
onAuthStateChanged(auth, async user => {
  currentUser = user;
  isAdminUser =
    !!user && user.email?.toLowerCase() === ADMIN_EMAIL;

  showSignedInUI(user);

  if (!user) return;

  try {
    await ensureProfile(user);
    await refreshApp();
  } catch (error) {
    msg("তথ্য লোড করতে সমস্যা: " + error.message, "error");
  }
});

/* REFRESH */
async function refreshApp() {
  requireUser();

  await Promise.all([
    loadProfile(),
    loadTournaments(),
    loadJoined(),
    loadResults()
  ]);

  if (isAdminUser) {
    await loadAdminRequests();
  }
}

/* PROFILE + DEMO BALANCE */
async function loadProfile() {
  const snap = await getDoc(doc(db, "users", currentUser.uid));

  if (!snap.exists()) {
    throw new Error("User Profile পাওয়া যায়নি।");
  }

  const data = snap.data();

  $("profile-name").textContent = data.displayName || "Player";
  $("profile-email").textContent = data.email || currentUser.email || "";
  $("balance").textContent = String(data.demoBalance ?? 0);
}

/* TOURNAMENT LIST */
async function loadTournaments() {
  const host = $("tournament-list");
  host.textContent = "Tournament লোড হচ্ছে...";

  const snap = await getDocs(collection(db, "tournaments"));

  if (snap.empty) {
    host.textContent = "এখনো কোনো Tournament তৈরি হয়নি।";
    return;
  }

  host.innerHTML = snap.docs.map(item => {
    const t = item.data();
    const fee = Number.isSafeInteger(t.entryFee) ? t.entryFee : 0;
    const prize = Number.isSafeInteger(t.prizePool) ? t.prizePool : 0;
    const slots = Number.isSafeInteger(t.slots) ? t.slots : 48;
    const joined = Number.isSafeInteger(t.joinCount) ? t.joinCount : 0;

    return `
      <article class="card">
        <h3>${esc(t.title || "PlayX Tournament")}</h3>
        <p>🎟️ Entry Fee: ${fee} Demo Points</p>
        <p>🏆 Prize Pool: ${prize} Demo Points</p>
        <p>👥 Slots: ${joined} / ${slots}</p>
        <p class="muted">Tournament ID: ${esc(item.id)}</p>
        <button type="button" data-join="${esc(item.id)}">
          Join Now
        </button>
      </article>
    `;
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

/* SAFE TRANSACTION: BALANCE CUT + JOIN */
async function joinTournament(tournamentId) {
  requireUser();

  const userRef = doc(db, "users", currentUser.uid);
  const tournamentRef = doc(db, "tournaments", tournamentId);
  const joinId = `${tournamentId}_${currentUser.uid}`;
  const joinRef = doc(db, "tournamentJoins", joinId);

  const result = await runTransaction(db, async transaction => {
    const userSnap = await transaction.get(userRef);
    const tournamentSnap = await transaction.get(tournamentRef);
    const joinSnap = await transaction.get(joinRef);

    if (!userSnap.exists()) throw new Error("User Profile নেই।");
    if (!tournamentSnap.exists()) throw new Error("Tournament পাওয়া যায়নি।");
    if (joinSnap.exists()) throw new Error("তুমি আগেই Join করেছ।");

    const user = userSnap.data();
    const t = tournamentSnap.data();

    const balance = numberField(
      user.demoBalance ?? 0, 0, 100000000, "Demo Balance"
    );
    const fee = numberField(t.entryFee ?? 0, 0, 1000, "Entry Fee");
    const slots = numberField(t.slots, 1, 100, "Slots");
    const joined = numberField(t.joinCount ?? 0, 0, 100, "Join Count");

    if (t.status === "closed") {
      throw new Error("এই Tournament বন্ধ।");
    }

    if (joined >= slots) throw new Error("সব Slot পূর্ণ হয়ে গেছে।");

    if (balance < fee) {
      throw new Error(
        `Demo Balance কম। Entry Fee ${fee}, তোমার Balance ${balance}।`
      );
    }

    transaction.update(userRef, {
      demoBalance: balance - fee
    });

    transaction.set(joinRef, {
      userId: currentUser.uid,
      tournamentId,
      tournamentTitle: t.title || "Tournament",
      status: "joined",
      createdAt: serverTimestamp()
    });

    transaction.update(tournamentRef, {
      joinCount: joined + 1
    });

    return { fee, balance: balance - fee };
  });

  msg(
    `Join সফল! ${result.fee} Demo Points কাটা হয়েছে। অবশিষ্ট ${result.balance}।`,
    "success"
  );
}

/* MY JOINED MATCHES */
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
        roomHTML = `
          <p>Room ID: ${esc(room.roomId)}</p>
          <p>Room Password: ${esc(room.roomPassword)}</p>
        `;
      }
    } catch {
      roomHTML = '<p class="muted">Room Details এখনো পাওয়া যায়নি।</p>';
    }

    return `
      <article class="card">
        <h3>${esc(data.tournamentTitle || "Tournament")}</h3>
        <p>Status: ${esc(data.status || "joined")}</p>
        <p class="muted">ID: ${esc(data.tournamentId)}</p>
        ${roomHTML}
      </article>
    `;
  }));

  $("joined-list").innerHTML = rows.join("");
}

/* RESULTS */
async function loadResults() {
  const snap = await getDocs(collection(db, "tournamentResults"));

  if (snap.empty) {
    $("results-list").textContent = "এখনো কোনো Result প্রকাশিত হয়নি।";
    return;
  }

  $("results-list").innerHTML = snap.docs.map(item => {
    const r = item.data();

    return `
      <article class="card">
        <h3>${esc(r.tournamentTitle || "Tournament")}</h3>
        <p>Winner: ${esc(r.winner)}</p>
        <p>Position: ${esc(r.position)}</p>
        <p>Prize: ${esc(r.prize)} Demo Points</p>
      </article>
    `;
  }).join("");
}

/* PLAYER DEMO BALANCE REQUEST */
$("request-form").addEventListener("submit", async event => {
  event.preventDefault();

  try {
    requireUser();

    const amount = numberField(
      $("request-amount").value, 1, 1000, "Amount"
    );

    const type = $("request-type").value;
    const reference = $("demo-reference").value.trim();

    if (!["add", "withdraw"].includes(type)) {
      throw new Error("Request Type সঠিক নয়।");
    }

    if (reference.length < 8 || reference.length > 40) {
      throw new Error("Demo Reference ৮–৪০ অক্ষরের হতে হবে।");
    }

    await addDoc(collection(db, "demoBalanceRequests"), {
      userId: currentUser.uid,
      type,
      amount,
      demoTransactionId: reference,
      status: "pending",
      createdAt: serverTimestamp()
    });

    $("request-form").reset();

    msg(
      "Request পাঠানো হয়েছে। Admin অনুমোদন না করা পর্যন্ত Balance বদলাবে না।",
      "success"
    );

    if (isAdminUser) await loadAdminRequests();
  } catch (error) {
    msg("Request ব্যর্থ: " + error.message, "error");
  }
});

/* ADMIN: CREATE TOURNAMENT */
$("tournament-form").addEventListener("submit", async event => {
  event.preventDefault();

  try {
    requireAdmin();

    const title = $("t-title").value.trim();
    if (title.length < 3 || title.length > 80) {
      throw new Error("Tournament Name ৩–৮০ অক্ষরের হতে হবে।");
    }

    const entryFee = numberField($("t-fee").value, 0, 1000, "Entry Fee");
    const prizePool = numberField(
      $("t-prize").value, 0, 100000, "Prize Pool"
    );
    const slots = numberField($("t-slots").value, 1, 100, "Slots");

    await addDoc(collection(db, "tournaments"), {
      title,
      entryFee,
      prizePool,
      slots,
      joinCount: 0,
      status: "open",
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

/* ADMIN: ADD DEMO BALANCE */
$("credit-form").addEventListener("submit", async event => {
  event.preventDefault();

  try {
    requireAdmin();

    const uid = $("credit-uid").value.trim();
    const amount = numberField(
      $("credit-amount").value, 1, 100000, "Demo Credit"
    );

    const userRef = doc(db, "users", uid);

    await runTransaction(db, async transaction => {
      const snap = await transaction.get(userRef);
      if (!snap.exists()) throw new Error("এই UID-এর User নেই।");

      const current = numberField(
        snap.data().demoBalance ?? 0,
        0,
        100000000,
        "বর্তমান Balance"
      );

      if (current + amount > 100000000) {
        throw new Error("Balance সর্বোচ্চ সীমা ছাড়িয়ে যাবে।");
      }

      transaction.update(userRef, {
        demoBalance: current + amount
      });
    });

    $("credit-form").reset();
    msg("Demo Balance যোগ হয়েছে।", "success");
    await loadProfile();
  } catch (error) {
    msg("Demo Credit ব্যর্থ: " + error.message, "error");
  }
});

/* ADMIN: SAVE ROOM DETAILS */
$("room-form").addEventListener("submit", async event => {
  event.preventDefault();

  try {
    requireAdmin();

    const tournamentId = $("room-tournament").value.trim();
    const roomId = $("room-id").value.trim();
    const roomPassword = $("room-password").value;

    if (!tournamentId || !roomId || !roomPassword) {
      throw new Error("সব Room ফিল্ড পূরণ করো।");
    }

    const tournamentSnap = await getDoc(
      doc(db, "tournaments", tournamentId)
    );

    if (!tournamentSnap.exists()) {
      throw new Error("Tournament ID পাওয়া যায়নি।");
    }

    await setDoc(doc(db, "tournamentRooms", tournamentId), {
      tournamentId,
      roomId,
      roomPassword,
      updatedAt: serverTimestamp()
    });

    $("room-form").reset();
    msg("Room Details Save হয়েছে।", "success");
  } catch (error) {
    msg("Room Details ব্যর্থ: " + error.message, "error");
  }
});

/* ADMIN: PUBLISH RESULT */
$("result-form").addEventListener("submit", async event => {
  event.preventDefault();

  try {
    requireAdmin();

    const tournamentId = $("result-tournament").value.trim();
    const tournamentTitle = $("result-title").value.trim();
    const winner = $("result-winner").value.trim();
    const position = numberField(
      $("result-position").value, 1, 100, "Position"
    );
    const prize = numberField(
      $("result-prize").value, 0, 100000, "Prize"
    );

    const tournamentSnap = await getDoc(
      doc(db, "tournaments", tournamentId)
    );

    if (!tournamentSnap.exists()) {
      throw new Error("Tournament ID পাওয়া যায়নি।");
    }

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

/* ADMIN: PENDING REQUESTS + APPROVE/REJECT */
async function loadAdminRequests() {
  if (!isAdminUser) return;

  const host = $("admin-requests");
  host.textContent = "Request লোড হচ্ছে...";

  const snap = await getDocs(
    collection(db, "demoBalanceRequests")
  );

  const pending = snap.docs.filter(
    item => item.data().status === "pending"
  );

  if (!pending.length) {
    host.textContent = "কোনো Pending Request নেই।";
    return;
  }

  host.innerHTML = pending.map(item => {
    const r = item.data();

    return `
      <article class="card">
        <p>Type: ${r.type === "add" ? "Balance যোগ" : "Balance কমানো"}</p>
        <p>Amount: ${esc(r.amount)} Demo Points</p>
        <p>Player UID: ${esc(r.userId)}</p>
        <p>Reference: ${esc(r.demoTransactionId)}</p>
        <p>Status: Pending</p>
        <button type="button" data-approve="${esc(item.id)}">
          Approve
        </button>
        <button type="button" class="secondary"
          data-reject="${esc(item.id)}">
          Reject
        </button>
      </article>
    `;
  }).join("");

  host.querySelectorAll("[data-approve]").forEach(button => {
    button.addEventListener("click", async () => {
      button.disabled = true;

      try {
        await decideRequest(button.dataset.approve, true);
        msg("Request Approve হয়েছে।", "success");
        await loadAdminRequests();
      } catch (error) {
        msg("Approve ব্যর্থ: " + error.message, "error");
        button.disabled = false;
      }
    });
  });

  host.querySelectorAll("[data-reject]").forEach(button => {
    button.addEventListener("click", async () => {
      button.disabled = true;

      try {
        await decideRequest(button.dataset.reject, false);
        msg("Request Reject হয়েছে।", "success");
        await loadAdminRequests();
      } catch (error) {
        msg("Reject ব্যর্থ: " + error.message, "error");
        button.disabled = false;
      }
    });
  });
}

/* ADMIN: PROCESS REQUEST ONCE */
async function decideRequest(requestId, approve) {
  requireAdmin();

  const requestRef = doc(db, "demoBalanceRequests", requestId);

  await runTransaction(db, async transaction => {
    const requestSnap = await transaction.get(requestRef);

    if (!requestSnap.exists()) {
      throw new Error("Request পাওয়া যায়নি।");
    }

    const request = requestSnap.data();

    if (request.status !== "pending") {
      throw new Error("এই Request আগে থেকেই প্রক্রিয়া করা হয়েছে।");
    }

    let userRef = null;
    let userSnap = null;
    let newBalance = null;

    if (approve) {
      userRef = doc(db, "users", request.userId);
      userSnap = await transaction.get(userRef);

      if (!userSnap.exists()) {
        throw new Error("Player Profile পাওয়া যায়নি।");
      }

      const balance = numberField(
        userSnap.data().demoBalance ?? 0,
        0,
        100000000,
        "বর্তমান Balance"
      );

      const amount = numberField(
        request.amount, 1, 1000, "Request Amount"
      );

      if (request.type === "add") {
        newBalance = balance + amount;

        if (newBalance > 100000000) {
          throw new Error("Balance সর্বোচ্চ সীমা ছাড়িয়ে যাবে।");
        }
      } else if (request.type === "withdraw") {
        if (balance < amount) {
          throw new Error("Player-এর Demo Balance যথেষ্ট নয়।");
        }

        newBalance = balance - amount;
      } else {
        throw new Error("Request Type ভুল।");
      }
    }

    if (approve && userRef) {
      transaction.update(userRef, {
        demoBalance: newBalance
      });
    }

    transaction.update(requestRef, {
      status: approve ? "approved" : "rejected",
      processedBy: currentUser.uid,
      processedAt: serverTimestamp()
    });
  });
}
