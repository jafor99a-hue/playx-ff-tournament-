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

const $ = (...ids) => {
  for (const id of ids) {
    const element = document.getElementById(id);
    if (element) return element;
  }
  return null;
};

const value = (...ids) => ($(...ids)?.value || "").trim();

const show = (element, visible) => {
  if (element) element.style.display = visible ? "" : "none";
};

const setText = (element, text) => {
  if (element) element.textContent = text;
};

const safe = (text = "") =>
  String(text).replace(/[&<>"']/g, char => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[char]);

let currentUser = null;
let isAdmin = false;
let authMode = "login";
let tournaments = [];
let joinedIds = new Set();
let balance = 0;
let roomCache = {};
let resultCache = {};

function toast(message) {
  const box = $("toast");
  if (box) {
    box.textContent = message;
    box.style.display = "block";
    setTimeout(() => {
      box.style.display = "none";
    }, 3500);
  } else {
    alert(message);
  }
}

function showAuthMessage(message) {
  setText($("auth-message"), message);
}

function formatMoney(amount) {
  return "৳" + Number(amount || 0).toFixed(2);
}

function currentName() {
  return currentUser?.displayName ||
    currentUser?.email?.split("@")[0] ||
    "Player";
}

function switchAuthMode(mode) {
  authMode = mode === "register" ? "register" : "login";

  const register = authMode === "register";
  show($("display-name"), register);
  show($("register-name-field"), register);

  setText(
    $("auth-submit"),
    register ? "Create Account" : "Login"
  );

  setText(
    $("auth-title"),
    register ? "Create Account" : "Welcome Back"
  );

  showAuthMessage("");
}

$("show-login")?.addEventListener("click", event => {
  event.preventDefault();
  switchAuthMode("login");
});

$("show-register")?.addEventListener("click", event => {
  event.preventDefault();
  switchAuthMode("register");
});

// Login / Register
$("auth-form")?.addEventListener("submit", async event => {
  event.preventDefault();

  const email = value("auth-email").toLowerCase();
  const password = value("auth-password");
  const displayName = value("display-name");

  if (!email || !password) {
    showAuthMessage("Email এবং Password দাও।");
    return;
  }

  const button = $("auth-submit");
  if (button) button.disabled = true;

  try {
    if (authMode === "register") {
      if (!displayName) {
        throw new Error("তোমার নাম লিখো।");
      }

      const credential = await createUserWithEmailAndPassword(
        auth,
        email,
        password
      );

      await updateProfile(credential.user, {
        displayName
      });

      showAuthMessage("Account তৈরি হয়েছে।");
    } else {
      await signInWithEmailAndPassword(auth, email, password);
      showAuthMessage("Login সফল হয়েছে।");
    }
  } catch (error) {
    showAuthMessage(error.message || "Login/Register ব্যর্থ হয়েছে।");
  } finally {
    if (button) button.disabled = false;
  }
});

// Logout
$("logout-btn")?.addEventListener("click", async () => {
  try {
    await signOut(auth);
  } catch (error) {
    toast(error.message);
  }
});

$("logout")?.addEventListener("click", async () => {
  try {
    await signOut(auth);
  } catch (error) {
    toast(error.message);
  }
});

// Screen / navigation
function navigate(page) {
  const pageNames = [
    "dashboard",
    "tournaments",
    "joined",
    "wallet",
    "results",
    "admin"
  ];

  for (const name of pageNames) {
    show($(`${name}-page`), name === page);
  }

  document.querySelectorAll("[data-page]").forEach(button => {
    button.classList.toggle(
      "active",
      button.dataset.page === page
    );
  });

  if (page === "tournaments" || page === "dashboard") {
    renderTournaments();
  }

  if (page === "joined") renderJoined();
  if (page === "results") renderResults();
}

document.addEventListener("click", event => {
  const nav = event.target.closest("[data-page]");
  if (nav) {
    event.preventDefault();
    navigate(nav.dataset.page);
  }
});

function isCurrentAdmin() {
  return !!currentUser &&
    currentUser.email?.toLowerCase() === ADMIN_EMAIL;
}

// User profile / Demo Balance
async function loadBalance() {
  if (!currentUser) return;

  const userRef = doc(db, "users", currentUser.uid);
  let userSnap = await getDoc(userRef);

  if (!userSnap.exists()) {
    await setDoc(userRef, {
      uid: currentUser.uid,
      email: currentUser.email || "",
      displayName: currentName(),
      demoBalance: 0,
      createdAt: serverTimestamp()
    });

    userSnap = await getDoc(userRef);
  }

  balance = Number(userSnap.data()?.demoBalance || 0);

  setText($("wallet-balance"), formatMoney(balance));
  setText($("demo-balance"), formatMoney(balance));
  setText($("balance-value"), formatMoney(balance));
}

// Load tournament list
async function loadTournaments() {
  const snapshot = await getDocs(collection(db, "tournaments"));

  tournaments = snapshot.docs.map(item => ({
    id: item.id,
    ...item.data()
  }));

  tournaments.sort((a, b) => {
    const dateA = a.createdAt?.toMillis?.() || 0;
    const dateB = b.createdAt?.toMillis?.() || 0;
    return dateB - dateA;
  });

  setText($("stat-tournaments"), String(tournaments.length));
}

// Load only the signed-in player's tournament joins
async function loadJoined() {
  if (!currentUser) {
    joinedIds = new Set();
    return;
  }

  const snapshot = await getDocs(query(
    collection(db, "tournamentJoins"),
    where("userId", "==", currentUser.uid)
  ));

  joinedIds = new Set(
    snapshot.docs
      .map(item => item.data()?.tournamentId)
      .filter(id => typeof id === "string" && id.length > 0)
  );

  setText($("stat-joined"), String(joinedIds.size));
}

// Tournament card
function tournamentCard(tournament) {
  const joined = joinedIds.has(tournament.id);
  const fee = Number(tournament.entryFee || 0);
  const slots = Number(tournament.slots || 48);
  const count = Number(tournament.joinedCount || 0);
  const open = (tournament.status || "open") === "open";

  let buttonHTML = "";

  if (joined) {
    buttonHTML =
      '<button class="btn" disabled>Already Joined</button>';
  } else if (open) {
    buttonHTML =
      `<button class="btn gold" data-join="${safe(tournament.id)}">Join Now</button>`;
  } else {
    buttonHTML = '<button class="btn" disabled>Closed</button>';
  }

  return `
    <article class="tournament-card">
      <div class="tournament-card-content">
        <h3>${safe(tournament.title || tournament.name || "Free Fire Tournament")}</h3>

        <p>🎮 Mode: ${safe(tournament.mode || "SQUAD")}</p>
        <p>🗺️ Map: ${safe(tournament.map || "Bermuda")}</p>
        <p>🏆 Prize: ${safe(tournament.prize || "৳0")}</p>
        <p>🎟️ Entry Fee: ${safe(fee)} Demo Balance</p>
        <p>👥 Players: ${safe(count)} / ${safe(slots)}</p>
        <p>🕒 Match Time: ${safe(tournament.matchTime || tournament.startTime || tournament.start || "To be announced")}</p>

        ${buttonHTML}
      </div>
    </article>
  `;
}

// Re-render only after both tournaments and joins have loaded.
// This prevents the card from displaying outdated join status.
function renderTournaments() {
  const html = tournaments.map(tournamentCard).join("") ||
    '<div class="panel">এখনও কোনো Tournament তৈরি হয়নি।</div>';

  if ($("all-tournaments")) {
    $("all-tournaments").innerHTML = html;
  }

  if ($("featured-tournaments")) {
    $("featured-tournaments").innerHTML =
      tournaments.slice(0, 3).map(tournamentCard).join("") ||
      '<div class="panel">Featured Tournament এখনো নেই।</div>';
  }
}// Join Tournament
async function joinTournament(tournamentId) {
  if (!currentUser) {
    toast("প্রথমে Login করো।");
    return;
  }

  const tournament = tournaments.find(item => item.id === tournamentId);

  if (!tournament) {
    toast("Tournament পাওয়া যায়নি।");
    return;
  }

  if (joinedIds.has(tournamentId)) {
    toast("তুমি ইতিমধ্যে এই Tournament-এ Joined।");
    return;
  }

  const freeFireUid = prompt("তোমার Free Fire UID লিখো:");
  if (!freeFireUid || !freeFireUid.trim()) return;

  const inGameName = prompt("তোমার Free Fire নাম লিখো:");
  if (!inGameName || !inGameName.trim()) return;

  try {
    const userRef = doc(db, "users", currentUser.uid);
    const tournamentRef = doc(db, "tournaments", tournamentId);
    const joinRef = doc(
      db,
      "tournamentJoins",
      `${tournamentId}_${currentUser.uid}`
    );

    await runTransaction(db, async transaction => {
      const userSnap = await transaction.get(userRef);
      const tournamentSnap = await transaction.get(tournamentRef);
      const joinSnap = await transaction.get(joinRef);

      if (!userSnap.exists()) {
        throw new Error("তোমার User Profile পাওয়া যায়নি। আবার Login করো।");
      }

      if (!tournamentSnap.exists()) {
        throw new Error("Tournament আর উপলভ্য নেই।");
      }

      if (joinSnap.exists()) {
        throw new Error("তুমি ইতিমধ্যে এই Tournament-এ Joined।");
      }

      const userData = userSnap.data();
      const tournamentData = tournamentSnap.data();

      if ((tournamentData.status || "open") !== "open") {
        throw new Error("এই Tournament এখন বন্ধ।");
      }

      const fee = Math.max(0, Number(tournamentData.entryFee || 0));
      const currentBalance = Number(userData.demoBalance || 0);
      const slots = Number(tournamentData.slots || 48);
      const joinedCount = Number(tournamentData.joinedCount || 0);

      if (joinedCount >= slots) {
        throw new Error("এই Tournament-এর সব Slot পূর্ণ।");
      }

      if (currentBalance < fee) {
        throw new Error(
          `Demo Balance যথেষ্ট নেই। Entry Fee ${formatMoney(fee)}।`
        );
      }

      transaction.update(userRef, {
        demoBalance: currentBalance - fee
      });

      transaction.update(tournamentRef, {
        joinedCount: joinedCount + 1
      });

      transaction.set(joinRef, {
        userId: currentUser.uid,
        tournamentId,
        tournamentTitle: tournamentData.title ||
          tournamentData.name || "Free Fire Tournament",
        freeFireUid: freeFireUid.trim(),
        inGameName: inGameName.trim(),
        entryFee: fee,
        status: "joined",
        createdAt: serverTimestamp()
      });
    });

    toast("Tournament-এ Join সফল হয়েছে!");

    await refreshAppData();
    navigate("joined");
  } catch (error) {
    console.error("Tournament Join Error:", error);
    toast("Join ব্যর্থ: " + (error.message || "আবার চেষ্টা করো।"));
  }
}

// Join buttons on tournament cards
document.addEventListener("click", event => {
  const button = event.target.closest("[data-join]");
  if (!button) return;

  const tournamentId = button.dataset.join;
  if (tournamentId) joinTournament(tournamentId);
});

// Joined Tournament list
async function renderJoined() {
  const container = $("joined-tournaments");
  if (!container || !currentUser) return;

  try {
    const snapshot = await getDocs(query(
      collection(db, "tournamentJoins"),
      where("userId", "==", currentUser.uid)
    ));

    if (snapshot.empty) {
      container.innerHTML =
        '<div class="panel">তুমি এখনো কোনো Tournament-এ Join করোনি।</div>';
      setText($("stat-joined"), "0");
      return;
    }

    const rows = await Promise.all(snapshot.docs.map(async item => {
      const data = item.data();
      const tournamentId = data.tournamentId;
      let roomText = "Room Details এখনো প্রকাশ করা হয়নি।";

      if (tournamentId) {
        try {
          const roomSnap = await getDoc(
            doc(db, "tournamentRooms", tournamentId)
          );

          if (roomSnap.exists()) {
            const room = roomSnap.data();
            roomText = `
              <p>Room ID: ${safe(room.roomId || "Not announced")}</p>
              <p>Room Password: ${safe(room.roomPassword || room.password || "Not announced")}</p>
            `;
          }
        } catch (error) {
          console.warn("Room details unavailable:", error);
        }
      }

      return `
        <article class="panel">
          <h3>${safe(data.tournamentTitle || "Tournament")}</h3>
          <p>Player Name: ${safe(data.inGameName || "")}</p>
          <p>Free Fire UID: ${safe(data.freeFireUid || "")}</p>
          <p>Entry Fee: ${formatMoney(data.entryFee || 0)}</p>
          ${roomText}
        </article>
      `;
    }));

    container.innerHTML = rows.join("");
    setText($("stat-joined"), String(snapshot.size));
  } catch (error) {
    console.error(error);
    container.innerHTML =
      '<div class="panel">Joined list লোড হয়নি। Firestore Rules পরীক্ষা করো।</div>';
  }
}

// Admin: Create Tournament
const tournamentForm =
  $("tournament-form") ||
  $("create-tournament-form");

tournamentForm?.addEventListener("submit", async event => {
  event.preventDefault();

  if (!isCurrentAdmin()) {
    toast("শুধু Admin Tournament তৈরি করতে পারবেন।");
    return;
  }

  const title = value("t-title", "tTitle");
  const mode = value("t-mode", "tMode") || "SQUAD";
  const map = value("t-map", "tMap") || "Bermuda";
  const prize = value("t-prize", "tPrize") || "0";
  const matchTime = value("t-start", "tStart", "t-match-time");
  const entryFee = Math.max(
    0,
    Number(value("t-entry-fee", "tEntryFee") || 0)
  );
  const slots = Math.max(
    1,
    Number(value("t-slots", "tSlots") || 48)
  );

  if (!title) {
    toast("Tournament-এর নাম লিখো।");
    return;
  }

  try {
    await addDoc(collection(db, "tournaments"), {
      title,
      mode,
      map,
      prize,
      matchTime,
      entryFee,
      slots,
      joinedCount: 0,
      status: "open",
      createdAt: serverTimestamp(),
      createdBy: currentUser.uid
    });

    tournamentForm.reset();
    toast("Tournament তৈরি হয়েছে।");
    await refreshAppData();
  } catch (error) {
    console.error(error);
    toast("Tournament তৈরি হয়নি: " + error.message);
  }
});

// Admin: Save Room ID and Password
const roomForm =
  $("room-form") ||
  $("room-details-form");

roomForm?.addEventListener("submit", async event => {
  event.preventDefault();

  if (!isCurrentAdmin()) {
    toast("শুধু Admin Room Details প্রকাশ করতে পারবেন।");
    return;
  }

  const tournamentId = value(
    "room-tournament-id",
    "roomTournamentId"
  );
  const roomId = value("room-id", "roomId");
  const roomPassword = value("room-password", "roomPassword");

  if (!tournamentId || !roomId || !roomPassword) {
    toast("Tournament ID, Room ID ও Password পূরণ করো।");
    return;
  }

  try {
    await setDoc(
      doc(db, "tournamentRooms", tournamentId),
      {
        tournamentId,
        roomId,
        roomPassword,
        updatedAt: serverTimestamp()
      }
    );

    toast("Room Details সংরক্ষণ হয়েছে।");
    roomForm.reset();
  } catch (error) {
    console.error(error);
    toast("Room Details সংরক্ষণ হয়নি: " + error.message);
  }
});

// Admin: Add or subtract Demo Balance
const balanceForm =
  $("admin-balance-form") ||
  $("demo-credit-form");

balanceForm?.addEventListener("submit", async event => {
  event.preventDefault();

  if (!isCurrentAdmin()) {
    toast("শুধু Admin Demo Balance পরিবর্তন করতে পারবেন।");
    return;
  }

  const uid = value(
    "balance-player-uid",
    "balancePlayerUid"
  );

  const amount = Number(value(
    "balance-amount",
    "balanceAmount"
  ));

  const action = value(
    "balance-action",
    "balanceAction"
  ) || "add";

  if (!uid || !Number.isFinite(amount) || amount <= 0) {
    toast("Player UID এবং সঠিক Amount লিখো।");
    return;
  }

  try {
    const userRef = doc(db, "users", uid);
    const userSnap = await getDoc(userRef);

    if (!userSnap.exists()) {
      toast("এই UID-এর User Profile পাওয়া যায়নি।");
      return;
    }

    const oldBalance = Number(
      userSnap.data().demoBalance || 0
    );

    const newBalance = action === "subtract"
      ? oldBalance - amount
      : oldBalance + amount;

    if (newBalance < 0) {
      toast("Balance শূন্যের নিচে হতে পারবে না।");
      return;
    }

    await updateDoc(userRef, {
      demoBalance: newBalance
    });

    setText(
      $("balance-admin-message"),
      "Demo Balance আপডেট হয়েছে।"
    );

    toast("Demo Balance আপডেট হয়েছে।");

    if (uid === currentUser.uid) {
      await loadBalance();
    }

    balanceForm.reset();
  } catch (error) {
    console.error(error);
    toast("Balance আপডেট হয়নি: " + error.message);
  }
});

// Results
async function renderResults() {
  const container = $("results-list");
  if (!container) return;

  const completed = tournaments.filter(tournament =>
    ["completed", "finished", "result"].includes(
      String(tournament.status || "").toLowerCase()
    ) || tournament.result
  );

  if (!completed.length) {
    container.innerHTML =
      '<div class="panel">এখনো কোনো Result প্রকাশ করা হয়নি।</div>';
    return;
  }

  container.innerHTML = completed.map(tournament => `
    <article class="panel">
      <h3>${safe(tournament.title || "Tournament Result")}</h3>
      <p>Winner: ${safe(tournament.winner || tournament.result?.winner || "Not announced")}</p>
      <p>Result: ${safe(
        typeof tournament.result === "string"
          ? tournament.result
          : tournament.result?.details || "Not announced"
      )}</p>
    </article>
  `).join("");
}

// Admin: Publish a simple result
const resultForm =
  $("result-form") ||
  $("publish-result-form");

resultForm?.addEventListener("submit", async event => {
  event.preventDefault();

  if (!isCurrentAdmin()) {
    toast("শুধু Admin Result প্রকাশ করতে পারবেন।");
    return;
  }

  const tournamentId = value(
    "result-tournament-id",
    "resultTournamentId"
  );

  const winner = value("result-winner", "resultWinner");
  const details = value("result-details", "resultDetails");

  if (!tournamentId || (!winner && !details)) {
    toast("Tournament ID এবং Result লিখো।");
    return;
  }

  try {
    await updateDoc(doc(db, "tournaments", tournamentId), {
      winner,
      result: details || winner,
      status: "completed",
      resultUpdatedAt: serverTimestamp()
    });

    toast("Result প্রকাশ হয়েছে।");
    resultForm.reset();
    await refreshAppData();
    renderResults();
  } catch (error) {
    console.error(error);
    toast("Result প্রকাশ হয়নি: " + error.message);
  }
});

// Refresh data in the correct order
async function refreshAppData() {
  if (!currentUser) return;

  try {
    await Promise.all([
      loadTournaments(),
      loadJoined(),
      loadBalance()
    ]);

    // Important: render after joinedIds is updated.
    renderTournaments();
    renderJoined();
    renderResults();

    setText($("user-name"), currentName());
    setText($("user-role"), isCurrentAdmin() ? "Admin" : "Player");

    show($("admin-nav"), isCurrentAdmin());
    show($("admin-page"), isCurrentAdmin());
    show($("demo-credit-form"), isCurrentAdmin());
    show($("admin-balance-form"), isCurrentAdmin());
  } catch (error) {
    console.error("App refresh failed:", error);
    toast("তথ্য লোড হয়নি: " + error.message);
  }
}

// Authentication state
onAuthStateChanged(auth, async user => {
  currentUser = user;
  isAdmin = isCurrentAdmin();

  show($("auth-screen"), !user);
  show($("app-shell"), !!user);

  if (!user) {
    joinedIds = new Set();
    tournaments = [];
    balance = 0;

    setText($("user-name"), "");
    setText($("user-role"), "");
    setText($("wallet-balance"), formatMoney(0));
    setText($("demo-balance"), formatMoney(0));

    return;
  }

  setText($("user-name"), currentName());
  setText($("user-role"), isAdmin ? "Admin" : "Player");

  show($("admin-nav"), isAdmin);
  show($("demo-credit-form"), isAdmin);
  show($("admin-balance-form"), isAdmin);

  await refreshAppData();
  navigate("dashboard");
});

// Initial screen
switchAuthMode("login");