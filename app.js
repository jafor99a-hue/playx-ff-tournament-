
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
  if (submit) submit.textContent =
    mode === "register" ? "Register" : "Login";

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
        auth, email, password
      );

      if (displayName) {
        await updateProfile(credential.user, { displayName });
      }

      if (message) message.textContent = "Registration সফল হয়েছে।";
    } else {
      await signInWithEmailAndPassword(auth, email, password);
      if (message) message.textContent = "Login সফল হয়েছে।";
    }
  } catch (error) {
    console.error("Authentication:", error);
    if (message) {
      message.textContent = error.message || "Login/Register সফল হয়নি।";
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
      query(collection(db, "tournaments"), orderBy("createdAt", "desc"))
    );

    tournamentsCache = snap.docs.map(d => ({
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
      start.textContent = "শুরু: " + (t.startTime || "সময় নির্ধারিত নয়");

      const button = document.createElement("button");
      button.className = "btn";
      button.type = "button";
      button.textContent = "Join Now";
      button.addEventListener("click", () => joinTournament(t.id, t));

      card.append(heading, info, start, button);
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
  for (const id of ["roomTournament", "resultTournament"]) {
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
  if ($("#joinTitle")) {
    $("#joinTitle").textContent = tournament.title || "Join Tournament";
  }

  if (modal) modal.hidden = false;
}

$("#joinClose")?.addEventListener("click", () => {
  $("#joinModal").hidden = true;
});

$("#joinForm")?.addEventListener("submit", async (event) => {
  event.preventDefault();

  if (!currentUser || !selectedTournament) {
    toast("আগে Login করে Tournament নির্বাচন করো।");
    return;
  }

  const ign = value("ign");
  const ffuid = value("ffuid");
  const teamName = value("teamName");

  if (!/^[0-9]{5,20}$/.test(ffuid)) {
    toast("সঠিক Free Fire UID দাও।");
    return;
  }

  try {
    const id = `${currentUser.uid}_${selectedTournament.id}`;
    const ref = doc(db, "registrations", id);
    const existing = await getDoc(ref);

    if (existing.exists()) {
      toast("তুমি ইতিমধ্যে Join করেছ।");
      return;
    }

    await setDoc(ref, {
      uid: currentUser.uid,
      userId: currentUser.uid,
      tournamentId: selectedTournament.id,
      tournamentName: selectedTournament.title || "Tournament",
      ign,
      ffuid,
      teamName,
      status: "joined",
      createdAt: serverTimestamp()
    });

    $("#joinModal").hidden = true;
    $("#joinForm").reset();

    toast("Tournament-এ Join সফল হয়েছে।");
    await loadRooms();
    await loadAdminData();
  } catch (error) {
    console.error("Join:", error);
    toast("Join করা যায়নি: " + error.message);
  }
});

// ---------- Room Details ----------

async function loadRooms() {
  const container = $("#roomList");
  if (!container) return;

  if (!currentUser) {
    container.textContent = "Room দেখতে Login করো।";
    return;
  }

  try {
    const registrations = await getDocs(
      query(
        collection(db, "registrations"),
        where("uid", "==", currentUser.uid)
      )
    );

    container.replaceChildren();

    if (registrations.empty) {
      container.textContent = "তুমি এখনো কোনো Tournament-এ Join করোনি।";
      return;
    }

    for (const registration of registrations.docs) {
      const data = registration.data();
      const roomSnap = await getDoc(
        doc(db, "roomDetails", data.tournamentId)
      );

      const card = document.createElement("article");
      card.className = "room-card";

      const heading = document.createElement("h3");
      heading.textContent = data.tournamentName || "Tournament";

      const room = document.createElement("p");
      const roomData = roomSnap.exists() ? roomSnap.data() : {};
      room.textContent = "Room ID: " +
        (roomData.roomId || "এখনো প্রকাশিত হয়নি");

      const pass = document.createElement("p");
      pass.textContent = "Room Password: " +
        (roomData.roomPassword || "এখনো প্রকাশিত হয়নি");

      card.append(heading, room, pass);
      container.append(card);
    }
  } catch (error) {
    console.error("loadRooms:", error);
    container.textContent =
      "Room লোড হয়নি। Firestore Rules পরীক্ষা করো।";
  }
}

// ---------- Admin: Create Tournament ----------

$("#tournamentForm")?.addEventListener("submit", async (event) => {
  event.preventDefault();

  try {
    if (!(await requireAdmin())) return;

    const title = value("tTitle");
    const mode = value("tMode");
    const map = value("tMap");
    const prizeText = value("tPrize");
    const startTime = value("tStart");

    if (!title || !map || !prizeText || !startTime) {
      toast("সব Tournament তথ্য পূরণ করো।");
      return;
    }

    await addDoc(collection(db, "tournaments"), {
      title,
      mode,
      map,
      prizeText,
      startTime,
      status: "Open",
      createdAt: serverTimestamp()
    });

    $("#tournamentForm").reset();
    toast("Tournament তৈরি হয়েছে।");
    await loadTournaments();
  } catch (error) {
    console.error("Create tournament:", error);
    toast("Tournament তৈরি হয়নি: " + error.message);
  }
});

// ---------- Admin: Publish Room ----------

$("#roomForm")?.addEventListener("submit", async (event) => {
  event.preventDefault();

  try {
    if (!(await requireAdmin())) return;

    const tournamentId = value("roomTournament");
    const roomId = value("roomId");
    const roomPassword = value("roomPassword");

    if (!tournamentId || !roomId || !roomPassword) {
      toast("সব Room তথ্য পূরণ করো।");
      return;
    }

    await setDoc(doc(db, "roomDetails", tournamentId), {
      tournamentId,
      roomId,
      roomPassword,
      updatedAt: serverTimestamp()
    });

    $("#roomForm").reset();
    toast("Room Details প্রকাশিত হয়েছে।");
    await loadRooms();
  } catch (error) {
    console.error("Save room:", error);
    toast("Room প্রকাশ হয়নি: " + error.message);
  }
});

// ---------- Admin: Publish Result ----------

$("#resultForm")?.addEventListener("submit", async (event) => {
  event.preventDefault();

  try {
    if (!(await requireAdmin())) return;

    const tournamentId = value("resultTournament");
    const tournament = tournamentsCache.find(t => t.id === tournamentId);
    const winner = value("winner");
    const description = value("resultDetails");

    if (!tournamentId || !winner) {
      toast("Tournament ও Winner/Result দাও।");
      return;
    }

    await addDoc(collection(db, "results"), {
      tournamentId,
      tournamentName: tournament?.title || "Tournament",
      winner,
      description,
      publishedAt: serverTimestamp()
    });

    $("#resultForm").reset();
    toast("Result প্রকাশিত হয়েছে।");
    await loadResults();
  } catch (error) {
    console.error("Publish result:", error);
    toast("Result প্রকাশ হয়নি: " + error.message);
  }
});

// ---------- Results ----------

async function loadResults() {
  const body = $("#resultsList");
  if (!body) return;

  try {
    const snap = await getDocs(
      query(collection(db, "results"), orderBy("publishedAt", "desc"))
    );

    body.replaceChildren();

    if (snap.empty) {
      const row = body.insertRow();
      row.insertCell().colSpan = 3;
      row.cells[0].textContent = "এখনো কোনো Result নেই।";
      return;
    }

    for (const item of snap.docs) {
      const data = item.data();
      const row = body.insertRow();

      row.insertCell().textContent = data.tournamentName || "Tournament";
      row.insertCell().textContent =
        [data.winner, data.description].filter(Boolean).join(" — ");

      const date = data.publishedAt?.toDate?.();
      row.insertCell().textContent =
        date ? date.toLocaleString("bn-BD") : "—";
    }
  } catch (error) {
    console.error("loadResults:", error);
    body.textContent = "Result লোড করা যায়নি।";
  }
}

// ---------- Admin: Registrations ----------

async function loadAdminData() {
  const body = $("#registrationsList");
  if (!body || !currentUser) return;

  try {
    if (!(await requireAdmin())) return;

    const snap = await getDocs(collection(db, "registrations"));
    body.replaceChildren();

    if (snap.empty) {
      const row = body.insertRow();
      row.insertCell().colSpan = 4;
      row.cells[0].textContent = "এখনো কোনো Registration নেই।";
      return;
    }

    for (const item of snap.docs) {
      const data = item.data();
      const row = body.insertRow();

      row.insertCell().textContent = data.uid || "—";
      row.insertCell().textContent = data.ign || "—";
      row.insertCell().textContent = data.ffuid || "—";
      row.insertCell().textContent =
        data.tournamentName || data.tournamentId || "—";
    }
  } catch (error) {
    console.error("Admin registrations:", error);
    body.textContent = "Registration লোড করা যায়নি।";
  }
}

// ---------- Demo Wallet Display ----------

async function loadDemoWallet() {
  const balance = $("#demoBalance");
  if (!balance) return;

  if (!currentUser) {
    balance.textContent = "Login করো";
    return;
  }

  try {
    const snap = await getDoc(doc(db, "demoWallet", currentUser.uid));

    balance.textContent = snap.exists()
      ? money(snap.data().balance) + " (Demo)"
      : money(0) + " (Demo)";
  } catch (error) {
    console.error("Demo Wallet:", error);
    balance.textContent = "Demo Balance লোড হয়নি";
  }
}

// ---------- Admin Demo Wallet Controls ----------

function setupDemoWalletControls() {
  const uidInput = $("#walletUid");
  const amountInput = $("#walletAmount");
  const result = $("#walletResult");

  async function changeBalance(direction) {
    try {
      if (!(await requireAdmin())) return;

      const uid = uidInput?.value.trim() || "";
      const amount = Number(amountInput?.value);

      if (!uid || !Number.isFinite(amount) || amount <= 0) {
        toast("সঠিক UID ও Amount দাও।");
        return;
      }

      if (amount > 1000000) {
        toast("Demo Amount সীমার বাইরে।");
        return;
      }

      const ref = doc(db, "demoWallet", uid);

      await runTransaction(db, async (transaction) => {
        const snap = await transaction.get(ref);
        const oldBalance = snap.exists()
          ? Number(snap.data().balance || 0)
          : 0;

        if (!snap.exists() && direction < 0) {
          throw new Error("Wallet নেই; Balance কমানো যাবে না।");
        }

        const newBalance = oldBalance + direction * amount;

        if (!Number.isFinite(newBalance) || newBalance < 0) {
          throw new Error("Demo Balance শূন্যের নিচে হতে পারবে না।");
        }

        transaction.set(ref, {
          uid,
          balance: newBalance,
          updatedAt: serverTimestamp()
        }, { merge: true });
      });

      if (result) result.textContent = "Demo Balance আপডেট হয়েছে।";
      toast("Demo Balance আপডেট হয়েছে।");
      await loadDemoWallet();
    } catch (error) {
      console.error("Wallet update:", error);
      if (result) result.textContent = error.message;
      toast(error.message || "Demo Wallet আপডেট হয়নি।");
    }
  }

  $("#walletCheck")?.addEventListener("click", async () => {
    try {
      if (!(await requireAdmin())) return;

      const uid = uidInput?.value.trim() || "";
      if (!uid) {
        toast("User UID দাও।");
        return;
      }

      const snap = await getDoc(doc(db, "demoWallet", uid));

      if (result) {
        result.textContent = snap.exists()
          ? "Demo Balance: " + money(snap.data().balance)
          : "এই UID-এর Demo Wallet নেই।";
      }
    } catch (error) {
      toast(error.message);
    }
  });

  $("#walletAdd")?.addEventListener("click", () => changeBalance(1));
  $("#walletSubtract")?.addEventListener("click", () => changeBalance(-1));
}

setupDemoWalletControls();

// ---------- Demo Payment Request ----------
// এটি শুধু পরীক্ষামূলক Request জমা করে।
// এটি কোনো পেমেন্ট যাচাই করে না এবং Balance বাড়ায় না।

$("#demo-payment-form")?.addEventListener("submit", async (event) => {
  event.preventDefault();

  const message = $("#payment-message");

  try {
    if (!currentUser) {
      throw new Error("Request জমা দিতে আগে Login করো।");
    }

    const method = value("method");
    const amount = Number(value("amount"));
    const txid = value("txid");

    if (!Number.isFinite(amount) || amount < 1 || amount > 10000) {
      throw new Error("Demo Amount ১ থেকে ১০,০০০-এর মধ্যে হতে হবে।");
    }

    if (!txid || txid.length > 80) {
      throw new Error("Demo Transaction ID দাও।");
    }

    await addDoc(collection(db, "demoPaymentRequests"), {
      uid: currentUser.uid,
      method,
      amount,
      transactionId: txid,
      status: "demo-pending",
      createdAt: serverTimestamp()
    });

    if (message) {
      message.textContent =
        "Demo Request জমা হয়েছে। কোনো বাস্তব পেমেন্ট বা Balance পরিবর্তন হয়নি।";
    }

    $("#demo-payment-form").reset();
  } catch (error) {
    console.error("Demo Request:", error);
    if (message) message.textContent = error.message;
  }
});

// ---------- Admin: Demo Requests ----------

async function loadDemoPaymentRequests() {
  const body = $("#demoPaymentRequestsList");
  if (!body || !currentUser) return;

  try {
    if (!(await requireAdmin())) return;

    const snap = await getDocs(
      query(
        collection(db, "demoPaymentRequests"),
        orderBy("createdAt", "desc")
      )
    );

    body.replaceChildren();

    if (snap.empty) {
      const row = body.insertRow();
      row.insertCell().colSpan = 6;
      row.cells[0].textContent = "কোনো Demo Request নেই।";
      return;
    }

    for (const item of snap.docs) {
      const data = item.data();
      const row = body.insertRow();

      row.insertCell().textContent = item.id;
      row.insertCell().textContent = data.uid || "—";
      row.insertCell().textContent = data.method || "—";
      row.insertCell().textContent = money(data.amount);
      row.insertCell().textContent = data.transactionId || "—";
      row.insertCell().textContent = data.status || "—";
    }
  } catch (error) {
    console.error("Demo requests:", error);
    body.textContent = "Demo Requests লোড করা যায়নি।";
  }
}

// ---------- Mobile Menu ----------

$("#menuBtn")?.addEventListener("click", () => {
  $("#nav")?.classList.toggle("open");
});

// ---------- Startup ----------

setAuthMode("register");

onAuthStateChanged(auth, async (user) => {
  currentUser = user;

  let admin = false;

  if (user) {
    try {
      admin = isAdmin(await user.getIdTokenResult(true));
    } catch (error) {
      console.error("Admin claim:", error);
    }
  }

  updateUserUI(user, admin);

  await loadTournaments();
  await loadResults();
  await loadRooms();
  await loadDemoWallet();

  if (user && admin) {
    await loadAdminData();
    await loadDemoPaymentRequests();
  }
});
