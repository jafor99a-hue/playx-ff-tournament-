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

// ===============================
// PlayX FF Tournament
// Main JavaScript - Part 1 of 2
// ===============================

const ADMIN_EMAIL = "jafor99a@gmail.com";

let currentUser = null;
let isAdminUser = false;
let tournamentsCache = [];
let joinedCache = [];
let currentJoinTournament = null;

const $ = (id) => document.getElementById(id);

function showNotice(message, isError = false) {
  const el = $("notice");
  if (!el) {
    alert(message);
    return;
  }

  el.textContent = message;
  el.style.display = "block";
  el.style.color = isError ? "#ff7777" : "#f5c542";

  window.clearTimeout(showNotice.timer);
  showNotice.timer = window.setTimeout(() => {
    el.style.display = "none";
  }, 5000);
}

function escapeHTML(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[char]);
}

function money(value) {
  return "৳" + Number(value || 0).toLocaleString("en-BD");
}

function showElement(id, show = true) {
  const el = $(id);
  if (el) el.style.display = show ? "" : "none";
}

function setText(id, value) {
  const el = $(id);
  if (el) el.textContent = value ?? "";
}

function setHTML(id, value) {
  const el = $(id);
  if (el) el.innerHTML = value;
}

function valueOf(id) {
  return $(id)?.value?.trim() || "";
}

function showPage(pageName) {
  document.querySelectorAll("[data-page]").forEach((page) => {
    page.style.display =
      page.dataset.page === pageName ? "" : "none";
  });

  document.querySelectorAll("[data-nav]").forEach((button) => {
    button.classList.toggle(
      "active",
      button.dataset.nav === pageName
    );
  });
}

function navigate(pageName) {
  if (pageName === "admin" && !isAdminUser) {
    showNotice("শুধু Admin এই পেজ দেখতে পারবেন।", true);
    return;
  }

  showPage(pageName);

  if (pageName === "tournaments") loadTournaments();
  if (pageName === "joined") loadJoined();
  if (pageName === "results") loadResults();
  if (pageName === "wallet") loadBalance();
  if (pageName === "admin" && isAdminUser) {
    loadAdminRequests();
    loadAdminTournamentOptions();
  }
}

document.querySelectorAll("[data-nav]").forEach((button) => {
  button.addEventListener("click", () => {
    navigate(button.dataset.nav);
  });
});

// ===============================
// Authentication
// ===============================

async function ensureProfile(user) {
  const userRef = doc(db, "users", user.uid);
  const snap = await getDoc(userRef);

  if (!snap.exists()) {
    await setDoc(userRef, {
      uid: user.uid,
      email: user.email || "",
      displayName: user.displayName || "Player",
      demoBalance: 0,
      createdAt: serverTimestamp(),
      lastLoginAt: serverTimestamp()
    });
  } else {
    await updateDoc(userRef, {
      email: user.email || "",
      lastLoginAt: serverTimestamp()
    });
  }
}

function setAuthMode(mode) {
  const isRegister = mode === "register";

  setText("auth-heading", isRegister ? "Create Account" : "Login");
  setText("auth-submit", isRegister ? "Register" : "Login");
  showElement("register-name-wrap", isRegister);
}

$("show-register")?.addEventListener("click", () => {
  setAuthMode("register");
});

$("show-login")?.addEventListener("click", () => {
  setAuthMode("login");
});

$("auth-form")?.addEventListener("submit", async (event) => {
  event.preventDefault();

  const email = valueOf("email").toLowerCase();
  const password = valueOf("password");
  const displayName = valueOf("display-name");
  const isRegister =
    $("auth-heading")?.textContent?.toLowerCase().includes("create");

  if (!email || !password) {
    showNotice("Email এবং Password লিখুন।", true);
    return;
  }

  if (password.length < 6) {
    showNotice("Password কমপক্ষে ৬ অক্ষরের হতে হবে।", true);
    return;
  }

  try {
    const submit = $("auth-submit");
    if (submit) submit.disabled = true;

    if (isRegister) {
      if (displayName.length < 2) {
        showNotice("আপনার নাম কমপক্ষে ২ অক্ষরের দিন।", true);
        return;
      }

      const credential = await createUserWithEmailAndPassword(
        auth,
        email,
        password
      );

      await updateProfile(credential.user, { displayName });
      await ensureProfile(credential.user);
      showNotice("Registration সফল হয়েছে!");
    } else {
      await signInWithEmailAndPassword(auth, email, password);
      showNotice("Login সফল হয়েছে!");
    }
  } catch (error) {
    console.error("Authentication error:", error);
    showNotice(authErrorMessage(error), true);
  } finally {
    if ($("auth-submit")) $("auth-submit").disabled = false;
  }
});

function authErrorMessage(error) {
  const code = error?.code || "";

  if (code.includes("email-already-in-use")) {
    return "এই Email দিয়ে আগে Account খোলা হয়েছে। Login করুন।";
  }
  if (code.includes("invalid-email")) return "Email সঠিক নয়।";
  if (code.includes("invalid-credential") ||
      code.includes("wrong-password") ||
      code.includes("user-not-found")) {
    return "Email অথবা Password ভুল।";
  }
  if (code.includes("weak-password")) {
    return "আরও শক্তিশালী Password দিন।";
  }
  if (code.includes("network-request-failed")) {
    return "ইন্টারনেট সংযোগ পরীক্ষা করুন।";
  }

  return error?.message || "Login/Register ব্যর্থ হয়েছে।";
}

$("logout-btn")?.addEventListener("click", async () => {
  try {
    await signOut(auth);
    showNotice("Logout হয়েছে।");
  } catch (error) {
    console.error(error);
    showNotice("Logout করা যায়নি।", true);
  }
});

onAuthStateChanged(auth, async (user) => {
  currentUser = user;
  isAdminUser = Boolean(
    user?.email &&
    user.email.toLowerCase() === ADMIN_EMAIL.toLowerCase()
  );

  showElement("auth-section", !user);
  showElement("app-section", Boolean(user));
  showElement("admin-nav", isAdminUser);

  if (!user) return;

  try {
    await ensureProfile(user);

    setText("profile-name", user.displayName || "Player");
    setText("profile-email", user.email || "");
    await loadBalance();
    await loadTournaments();
    await loadJoined();
    await loadResults();

    if (isAdminUser) {
      await loadAdminRequests();
      await loadAdminTournamentOptions();
    }
  } catch (error) {
    console.error("App initialization error:", error);
    showNotice(
      "প্রোফাইল লোড করা যায়নি। Firestore Rules পরীক্ষা করুন।",
      true
    );
  }
});

// ===============================
// Demo Balance
// ===============================

async function loadBalance() {
  if (!currentUser) return;

  try {
    const snap = await getDoc(doc(db, "users", currentUser.uid));
    const balance = snap.exists()
      ? Number(snap.data().demoBalance || 0)
      : 0;

    setText("balance", money(balance));
    setText("wallet-balance", money(balance));
  } catch (error) {
    console.error("Balance load error:", error);
    showNotice("Demo Balance লোড করা যায়নি।", true);
  }
}

// ===============================
// Tournament List
// ===============================

async function loadTournaments() {
  if (!currentUser) return;

  try {
    const snap = await getDocs(collection(db, "tournaments"));

    tournamentsCache = snap.docs.map((item) => ({
      id: item.id,
      ...item.data()
    }));

    tournamentsCache.sort((a, b) => {
      const aTime = a.createdAt?.seconds || 0;
      const bTime = b.createdAt?.seconds || 0;
      return bTime - aTime;
    });

    renderTournaments();
  } catch (error) {
    console.error("Tournament load error:", error);
    showNotice("Tournament লোড হয়নি।", true);
  }
}

function tournamentCard(t) {
  const joined = Number(t.joinCount || 0);
  const slots = Number(t.slots || 48);
  const fee = Number(t.entryFee || 0);
  const status = t.status || "open";

  return `
    <article class="tournament-card">
      <div class="tournament-card-top">
        <span class="tournament-mode">${escapeHTML(t.mode || "SOLO")}</span>
        <span class="tournament-status">${escapeHTML(status)}</span>
      </div>

      <h3>${escapeHTML(t.title || "Free Fire Tournament")}</h3>

      <p>🗺️ Map: ${escapeHTML(t.map || "Bermuda")}</p>
      <p>🎟️ Entry Fee: ${money(fee)} Demo Balance</p>
      <p>🏆 Prize Pool: ${money(t.prizePool || 0)}</p>
      <p>👥 Slots: ${joined}/${slots}</p>
      <p>🕒 Match Time: ${escapeHTML(t.matchTime || "To be announced")}</p>

      <button
        type="button"
        class="primary-btn"
        data-join-tournament="${escapeHTML(t.id)}"
        ${status !== "open" || joined >= slots ? "disabled" : ""}
      >
        ${status !== "open" ? "Closed" : joined >= slots ? "Full" : "Join Now"}
      </button>
    </article>
  `;
}

function renderTournaments() {
  const html = tournamentsCache.map(tournamentCard).join("");

  setHTML(
    "tournament-list",
    html || "<p>এখনো কোনো Tournament তৈরি হয়নি।</p>"
  );

  setHTML(
    "home-tournaments",
    tournamentsCache.slice(0, 3).map(tournamentCard).join("") ||
      "<p>এখনো কোনো Tournament নেই।</p>"
  );

  document.querySelectorAll("[data-join-tournament]").forEach((button) => {
    button.addEventListener("click", () => {
      openJoinModal(button.dataset.joinTournament);
    });
  });
}

// ===============================
// Admin: Create Tournament
// ===============================

$("tournament-form")?.addEventListener("submit", async (event) => {
  event.preventDefault();

  if (!isAdminUser || !currentUser) {
    showNotice("এই কাজ শুধু Admin করতে পারবেন।", true);
    return;
  }

  const title = valueOf("t-title");
  const mode = valueOf("t-mode");
  const map = valueOf("t-map") || "Bermuda";
  const entryFee = Number(valueOf("t-fee"));
  const prizePool = Number(valueOf("t-prize"));
  const slots = Number(valueOf("t-slots"));
  const matchTime = valueOf("t-time");

  if (!title || !["SOLO", "DUO", "SQUAD"].includes(mode)) {
    showNotice("Tournament-এর নাম এবং Mode ঠিকভাবে দিন।", true);
    return;
  }

  if (
    !Number.isInteger(entryFee) || entryFee < 0 || entryFee > 1000 ||
    !Number.isInteger(prizePool) || prizePool < 0 || prizePool > 100000 ||
    !Number.isInteger(slots) || slots < 1 || slots > 100
  ) {
    showNotice("Entry Fee, Prize অথবা Slots-এর মান সঠিক নয়।", true);
    return;
  }

  try {
    await addDoc(collection(db, "tournaments"), {
      title,
      mode,
      map,
      entryFee,
      prizePool,
      slots,
      matchTime,
      joinCount: 0,
      status: "open",
      createdBy: currentUser.uid,
      createdAt: serverTimestamp()
    });

    $("tournament-form").reset();
    showNotice("Tournament তৈরি হয়েছে!");
    await loadTournaments();
    await loadAdminTournamentOptions();
  } catch (error) {
    console.error("Create tournament error:", error);
    showNotice("Tournament তৈরি হয়নি। Rules পরীক্ষা করুন।", true);
  }
});

// ===============================
// Tournament Join
// ===============================

function openJoinModal(tournamentId) {
  const tournament = tournamentsCache.find(
    (item) => item.id === tournamentId
  );

  if (!tournament) {
    showNotice("Tournament পাওয়া যায়নি।", true);
    return;
  }

  if (tournament.status !== "open") {
    showNotice("এই Tournament-এ Join বন্ধ আছে।", true);
    return;
  }

  currentJoinTournament = tournament;

  setText("join-tournament-name", tournament.title);
  showElement("join-modal", true);
}

function closeJoinModal() {
  currentJoinTournament = null;
  showElement("join-modal", false);
  $("ff-join-form")?.reset();
}

$("join-close")?.addEventListener("click", closeJoinModal);

$("join-modal")?.addEventListener("click", (event) => {
  if (event.target.id === "join-modal") {
    closeJoinModal();
  }
});

$("ff-join-form")?.addEventListener("submit", async (event) => {
  event.preventDefault();

  if (!currentUser || !currentJoinTournament) {
    showNotice("আগে Login করুন এবং Tournament নির্বাচন করুন।", true);
    return;
  }

  const playerName = valueOf("ff-player-name");
  const freeFireUid = valueOf("ff-player-uid");
  const tournament = currentJoinTournament;
  const tournamentId = tournament.id;

  if (playerName.length < 2 || playerName.length > 60) {
    showNotice("Player Name ২ থেকে ৬০ অক্ষরের মধ্যে দিন।", true);
    return;
  }

  if (!/^[0-9]{5,20}$/.test(freeFireUid)) {
    showNotice("সঠিক Free Fire UID দিন (৫–২০টি সংখ্যা)।", true);
    return;
  }

  const button = $("ff-join-form")?.querySelector(
    'button[type="submit"]'
  );

  try {
    if (button) button.disabled = true;

    const userRef = doc(db, "users", currentUser.uid);
    const tournamentRef = doc(db, "tournaments", tournamentId);
    const joinRef = doc(
      db,
      "tournamentJoins",
      `${tournamentId}_${currentUser.uid}`
    );

    await runTransaction(db, async (transaction) => {
      // সব read, write-এর আগে করতে হবে।
      const userSnap = await transaction.get(userRef);
      const tournamentSnap = await transaction.get(tournamentRef);
      const joinSnap = await transaction.get(joinRef);

      if (!userSnap.exists()) {
        throw new Error("PROFILE_MISSING");
      }

      if (!tournamentSnap.exists()) {
        throw new Error("TOURNAMENT_MISSING");
      }

      if (joinSnap.exists()) {
        throw new Error("ALREADY_JOINED");
      }

      const userData = userSnap.data();
      const tournamentData = tournamentSnap.data();

      const balance = Number(userData.demoBalance || 0);
      const fee = Number(tournamentData.entryFee || 0);
      const joinedCount = Number(tournamentData.joinCount || 0);
      const slots = Number(tournamentData.slots || 48);

      if (tournamentData.status !== "open") {
        throw new Error("TOURNAMENT_CLOSED");
      }

      if (balance < fee) {
        throw new Error("LOW_BALANCE");
      }

      if (joinedCount >= slots) {
        throw new Error("TOURNAMENT_FULL");
      }

      if (
        !Number.isInteger(fee) ||
        fee < 0 ||
        fee > 1000
      ) {
        throw new Error("INVALID_ENTRY_FEE");
      }

      // Demo Balance কাটবে এবং Join record তৈরি করবে।
      transaction.update(userRef, {
        demoBalance: balance - fee,
        lastEntryTournamentId: tournamentId
      });

      transaction.update(tournamentRef, {
        joinCount: joinedCount + 1
      });

      transaction.set(joinRef, {
        userId: currentUser.uid,
        tournamentId,
        tournamentTitle: tournamentData.title || "",
        playerName,
        freeFireUid,
        status: "joined",
        createdAt: serverTimestamp()
      });
    });

    closeJoinModal();
    showNotice("Tournament-এ সফলভাবে Join হয়েছে!");

    await Promise.all([
      loadBalance(),
      loadTournaments(),
      loadJoined()
    ]);
  } catch (error) {
    console.error("Tournament join error:", error);

    const messages = {
      PROFILE_MISSING: "Player Profile পাওয়া যায়নি। আবার Login করুন।",
      TOURNAMENT_MISSING: "Tournament আর পাওয়া যাচ্ছে না।",
      ALREADY_JOINED: "তুমি এই Tournament-এ আগেই Join করেছ।",
      TOURNAMENT_CLOSED: "Tournament-এ Join বন্ধ আছে।",
      LOW_BALANCE: "তোমার Demo Balance পর্যাপ্ত নয়।",
      TOURNAMENT_FULL: "Tournament-এর সব Slot পূর্ণ হয়েছে।",
      INVALID_ENTRY_FEE: "Tournament Entry Fee সঠিক নয়।"
    };

    showNotice(
      messages[error.message] ||
        "Join ব্যর্থ হয়েছে। Firestore Rules এবং Console Error পরীক্ষা করতে হবে।",
      true
    );
  } finally {
    if (button) button.disabled = false;
  }
});

// ===============================
// Joined Matches
// ===============================

async function loadJoined() {
  if (!currentUser) return;

  try {
    const joinsQuery = query(
      collection(db, "tournamentJoins"),
      where("userId", "==", currentUser.uid)
    );

    const snap = await getDocs(joinsQuery);

    joinedCache = snap.docs.map((item) => ({
      id: item.id,
      ...item.data()
    }));

    renderJoined();
  } catch (error) {
    console.error("Joined matches error:", error);
    setHTML("joined-list", "<p>Joined Matches লোড করা যায়নি।</p>");
  }
}

async function renderJoined() {
  if (!currentUser) return;

  const container = $("joined-list");
  if (!container) return;

  if (joinedCache.length === 0) {
    container.innerHTML = "<p>তুমি এখনো কোনো Tournament-এ Join করোনি।</p>";
    setText("home-joined", "0");
    return;
  }

  setText("home-joined", String(joinedCache.length));

  const cards = await Promise.all(
    joinedCache.map(async (item) => {
      let roomHTML = "<p>Room Details এখনো প্রকাশ করা হয়নি।</p>";

      try {
        const roomSnap = await getDoc(
          doc(db, "tournamentRooms", item.tournamentId)
        );

        if (roomSnap.exists()) {
          const room = roomSnap.data();

          roomHTML = `
            <div class="room-details">
              <p>Room ID: <strong>${escapeHTML(room.roomId)}</strong></p>
              <p>Room Password: <strong>${escapeHTML(room.roomPassword)}</strong></p>
            </div>
          `;
        }
      } catch (error) {
        console.error("Room read error:", error);
      }

      return `
        <article class="tournament-card">
          <h3>${escapeHTML(item.tournamentTitle || "Tournament")}</h3>
          <p>Player: ${escapeHTML(item.playerName || "")}</p>
          <p>Free Fire UID: ${escapeHTML(item.freeFireUid || "")}</p>
          <p>Status: ${escapeHTML(item.status || "joined")}</p>
          ${roomHTML}
        </article>
      `;
    })
  );

  container.innerHTML = cards.join("");
}

// ===============================
// Demo Balance Request
// ===============================

$("request-form")?.addEventListener("submit", async (event) => {
  event.preventDefault();

  if (!currentUser) {
    showNotice("আগে Login করুন।", true);
    return;
  }

  const amount = Number(valueOf("request-amount"));
  const reference = valueOf("demo-reference");

  if (!Number.isInteger(amount) || amount < 1 || amount > 100000) {
    showNotice("১ থেকে ১০০০০০-এর মধ্যে Demo Amount দিন।", true);
    return;
  }

  try {
    await addDoc(collection(db, "demoBalanceRequests"), {
      userId: currentUser.uid,
      type: "add",
      amount,
      demoTransactionId: reference,
      status: "pending",
      createdAt: serverTimestamp()
    });

    $("request-form").reset();
    showNotice("Demo Balance Request Admin-এর কাছে পাঠানো হয়েছে।");
    await loadAdminRequests();
  } catch (error) {
    console.error("Balance request error:", error);
    showNotice("Request পাঠানো যায়নি। Rules পরীক্ষা করুন।", true);
  }
});

// ===============================
// Admin: Add Demo Balance
// ===============================

$("credit-form")?.addEventListener("submit", async (event) => {
  event.preventDefault();

  if (!isAdminUser) {
    showNotice("শুধু Admin এই কাজ করতে পারবেন।", true);
    return;
  }

  const uid = valueOf("credit-uid");
  const amount = Number(valueOf("credit-amount"));

  if (!uid) {
    showNotice("Player-এর Firebase UID দিন।", true);
    return;
  }

  if (!Number.isInteger(amount) || amount < 1 || amount > 100000) {
    showNotice("১ থেকে ১০০০০০-এর মধ্যে Amount দিন।", true);
    return;
  }

  try {
    const userRef = doc(db, "users", uid);
    const userSnap = await getDoc(userRef);

    if (!userSnap.exists()) {
      showNotice("এই UID-এর Player Profile পাওয়া যায়নি।", true);
      return;
    }

    await updateDoc(userRef, {
      demoBalance: Number(userSnap.data().demoBalance || 0) + amount
    });

    $("credit-form").reset();
    showNotice("Demo Balance যোগ হয়েছে!");
    await loadBalance();
  } catch (error) {
    console.error("Admin credit error:", error);
    showNotice("Balance যোগ হয়নি। Admin Rules পরীক্ষা করুন।", true);
  }
});

// ===============================
// Admin: Room Details
// ===============================

async function loadAdminTournamentOptions() {
  if (!isAdminUser) return;

  try {
    if (tournamentsCache.length === 0) {
      await loadTournaments();
    }

    const options = tournamentsCache.map((t) => `
      <option value="${escapeHTML(t.id)}">
        ${escapeHTML(t.title || t.id)}
      </option>
    `).join("");

    ["room-tournament", "result-tournament"].forEach((id) => {
      const select = $(id);
      if (select) {
        select.innerHTML =
          '<option value="">Tournament নির্বাচন করুন</option>' + options;
      }
    });
  } catch (error) {
    console.error("Admin tournament options error:", error);
  }
}

$("room-form")?.addEventListener("submit", async (event) => {
  event.preventDefault();

  if (!isAdminUser || !currentUser) {
    showNotice("শুধু Admin Room Details প্রকাশ করতে পারবেন।", true);
    return;
  }

  const tournamentId = valueOf("room-tournament");
  const roomId = valueOf("room-id");
  const roomPassword = valueOf("room-password");

  if (!tournamentId || !roomId || !roomPassword) {
    showNotice("সব Room Details পূরণ করুন।", true);
    return;
  }

  try {
    await setDoc(doc(db, "tournamentRooms", tournamentId), {
      tournamentId,
      roomId,
      roomPassword,
      updatedAt: serverTimestamp()
    });

    showNotice("Room Details প্রকাশ হয়েছে।");
  } catch (error) {
    console.error("Room save error:", error);
    showNotice("Room Details সেভ হয়নি।", true);
  }
});

// ===============================
// Results
// ===============================

async function loadResults() {
  if (!currentUser) return;

  try {
    const snap = await getDocs(collection(db, "tournamentResults"));

    const results = snap.docs.map((item) => ({
      id: item.id,
      ...item.data()
    }));

    results.sort((a, b) =>
      (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0)
    );

    setHTML(
      "results-list",
      results.map((result) => `
        <article class="tournament-card">
          <h3>${escapeHTML(result.title || "Tournament Result")}</h3>
          <p>Tournament: ${escapeHTML(result.tournamentTitle || "")}</p>
          <p>Winner: ${escapeHTML(result.winner || "")}</p>
          <p>Position: ${escapeHTML(result.position || "")}</p>
          <p>Prize: ${money(result.prize || 0)}</p>
        </article>
      `).join("") || "<p>এখনো কোনো Result প্রকাশ করা হয়নি।</p>"
    );
  } catch (error) {
    console.error("Results load error:", error);
    setHTML("results-list", "<p>Results লোড করা যায়নি।</p>");
  }
}

$("result-form")?.addEventListener("submit", async (event) => {
  event.preventDefault();

  if (!isAdminUser || !currentUser) {
    showNotice("শুধু Admin Result প্রকাশ করতে পারবেন।", true);
    return;
  }

  const tournamentId = valueOf("result-tournament");
  const title = valueOf("result-title");
  const winner = valueOf("result-winner");
  const position = valueOf("result-position");
  const prize = Number(valueOf("result-prize"));

  if (!tournamentId || !title || !winner || !position) {
    showNotice("Result-এর সব তথ্য পূরণ করুন।", true);
    return;
  }

  if (!Number.isInteger(prize) || prize < 0 || prize > 100000) {
    showNotice("Prize সঠিকভাবে লিখুন।", true);
    return;
  }

  const tournament = tournamentsCache.find(
    (item) => item.id === tournamentId
  );

  try {
    await addDoc(collection(db, "tournamentResults"), {
      tournamentId,
      tournamentTitle: tournament?.title || "",
      title,
      winner,
      position,
      prize,
      createdBy: currentUser.uid,
      createdAt: serverTimestamp()
    });

    $("result-form").reset();
    showNotice("Result প্রকাশ হয়েছে!");
    await loadResults();
  } catch (error) {
    console.error("Publish result error:", error);
    showNotice("Result প্রকাশ হয়নি।", true);
  }
});

// ===============================
// Admin: Balance Requests
// ===============================

async function loadAdminRequests() {
  if (!isAdminUser) return;

  const container = $("admin-requests");
  if (!container) return;

  try {
    const snap = await getDocs(
      query(
        collection(db, "demoBalanceRequests"),
        where("status", "==", "pending")
      )
    );

    if (snap.empty) {
      container.innerHTML = "<p>কোনো Pending Request নেই।</p>";
      return;
    }

    container.innerHTML = snap.docs.map((item) => {
      const request = item.data();

      return `
        <article class="tournament-card">
          <p>Player UID: ${escapeHTML(request.userId)}</p>
          <p>Amount: ${money(request.amount)}</p>
          <p>Demo Reference: ${escapeHTML(request.demoTransactionId || "N/A")}</p>
          <p>Status: ${escapeHTML(request.status)}</p>

          <button
            type="button"
            class="primary-btn"
            data-request-approve="${escapeHTML(item.id)}"
          >Approve</button>

          <button
            type="button"
            class="secondary-btn"
            data-request-reject="${escapeHTML(item.id)}"
          >Reject</button>
        </article>
      `;
    }).join("");

    container.querySelectorAll("[data-request-approve]").forEach((button) => {
      button.addEventListener("click", () => {
        processBalanceRequest(button.dataset.requestApprove, true);
      });
    });

    container.querySelectorAll("[data-request-reject]").forEach((button) => {
      button.addEventListener("click", () => {
        processBalanceRequest(button.dataset.requestReject, false);
      });
    });
  } catch (error) {
    console.error("Admin requests error:", error);
    container.innerHTML = "<p>Requests লোড করা যায়নি।</p>";
  }
}

async function processBalanceRequest(requestId, approve) {
  if (!isAdminUser || !currentUser) return;

  try {
    await runTransaction(db, async (transaction) => {
      const requestRef = doc(db, "demoBalanceRequests", requestId);
      const requestSnap = await transaction.get(requestRef);

      if (!requestSnap.exists()) {
        throw new Error("REQUEST_NOT_FOUND");
      }

      const request = requestSnap.data();

      if (request.status !== "pending") {
        throw new Error("ALREADY_PROCESSED");
      }

      let userRef = null;
      let userSnap = null;

      if (approve) {
        userRef = doc(db, "users", request.userId);
        userSnap = await transaction.get(userRef);

        if (!userSnap.exists()) {
          throw new Error("USER_NOT_FOUND");
        }
      }

      if (approve && userRef && userSnap) {
        transaction.update(userRef, {
          demoBalance:
            Number(userSnap.data().demoBalance || 0) +
            Number(request.amount)
        });
      }

      transaction.update(requestRef, {
        status: approve ? "approved" : "rejected",
        processedBy: currentUser.uid,
        processedAt: serverTimestamp()
      });
    });

    showNotice(approve ? "Request Approve হয়েছে।" : "Request Reject হয়েছে।");

    await Promise.all([
      loadAdminRequests(),
      loadBalance()
    ]);
  } catch (error) {
    console.error("Process request error:", error);

    const messages = {
      REQUEST_NOT_FOUND: "Request পাওয়া যায়নি।",
      ALREADY_PROCESSED: "এই Request আগেই প্রক্রিয়া করা হয়েছে।",
      USER_NOT_FOUND: "Player Profile পাওয়া যায়নি।"
    };

    showNotice(
      messages[error.message] || "Request প্রক্রিয়া করা যায়নি।",
      true
    );
  }
}

// ===============================
// Initial page setup
// ===============================

setAuthMode("login");
showElement("join-modal", false);

// End of app.js