import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-app.js";

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
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";

import { firebaseConfig } from "./firebase-config.js";

// ---------- Firebase Setup ----------

const configured =
  !!firebaseConfig.apiKey &&
  firebaseConfig.apiKey !== "PASTE_YOUR_API_KEY" &&
  !!firebaseConfig.projectId &&
  firebaseConfig.projectId !== "PASTE_YOUR_PROJECT_ID";

let auth;
let db;
let currentUser = null;
let authMode = "register";
let selectedTournament = null;

const $ = (selector) => document.querySelector(selector);

function toast(message) {
  const el = $("#toast");
  if (!el) {
    alert(message);
    return;
  }

  el.textContent = message;
  el.classList.add("show");
  setTimeout(() => el.classList.remove("show"), 4000);
}

function esc(value = "") {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[char]);
}

function friendlyError(code) {
  const errors = {
    "auth/email-already-in-use":
      "এই ইমেইল দিয়ে আগে থেকেই অ্যাকাউন্ট আছে। Login করো।",
    "auth/invalid-credential":
      "ইমেইল বা পাসওয়ার্ড সঠিক নয়।",
    "auth/invalid-email":
      "সঠিক ইমেইল ঠিকানা দাও।",
    "auth/weak-password":
      "আরও শক্তিশালী পাসওয়ার্ড দাও।",
    "auth/too-many-requests":
      "অনেকবার চেষ্টা হয়েছে। কিছুক্ষণ পরে চেষ্টা করো।",
    "auth/network-request-failed":
      "ইন্টারনেট সংযোগ পরীক্ষা করো।",
    "auth/operation-not-allowed":
      "Firebase Console-এ Email/Password sign-in চালু করো।",
    "permission-denied":
      "Firestore Rules অনুমতি দিচ্ছে না।",
    "unavailable":
      "Firebase সার্ভারে সংযোগ হচ্ছে না। আবার চেষ্টা করো।"
  };

  return errors[code] ||
    `সমস্যা হয়েছে (${code || "unknown"}). Console পরীক্ষা করো।`;
}

function showAuthMessage(message) {
  const el = $("#authMessage");
  if (el) el.textContent = message;
}

function setAuthMode(mode) {
  authMode = mode;

  $("#displayNameWrap").hidden = mode === "login";
  $("#displayName").required = mode === "register";
  $("#authSubmit").textContent =
    mode === "login" ? "Login" : "Register";

  showAuthMessage(
    mode === "login"
      ? "ইমেইল ও পাসওয়ার্ড দিয়ে Login করো।"
      : "নতুন অ্যাকাউন্ট তৈরি করতে তথ্য দাও।"
  );
}

// ---------- Firebase Initialization ----------

if (!configured) {
  showAuthMessage(
    "firebase-config.js-এ সঠিক Firebase Config বসাও।"
  );

  $("#tournamentList").innerHTML =
    '<p class="muted">Firebase Config সেট করা হয়নি।</p>';
} else {
  try {
    const app = initializeApp(firebaseConfig);
    auth = getAuth(app);
    db = getFirestore(app);

    onAuthStateChanged(auth, async (user) => {
      currentUser = user;

      $("#userStatus").textContent = user
        ? `লগইন: ${user.displayName || user.email}`
        : "লগইন করা হয়নি";

      $("#loginBtn").hidden = !!user;
      $("#registerBtn").hidden = !!user;
      $("#logoutBtn").hidden = !user;

      $("#accountTitle").textContent = user
        ? "তোমার অ্যাকাউন্ট"
        : "Welcome to PlayX";

      $("#adminPanel").hidden = true;
      $("#authForm").hidden = !!user;
      $("#displayNameWrap").hidden = !!user;

      if (user) {
        try {
          const token = await user.getIdTokenResult(true);
          $("#adminPanel").hidden = token.claims.admin !== true;
        } catch (error) {
          console.error("Admin claim check:", error);
        }
      } else {
        setAuthMode("register");
      }

      await Promise.allSettled([
        loadTournaments(),
        loadResults(),
        loadRooms(),
        user ? loadAdminData() : Promise.resolve()
      ]);
    });
  } catch (error) {
    console.error("Firebase initialization error:", error);
    showAuthMessage("Firebase চালু হয়নি। Config পরীক্ষা করো।");
    toast("Firebase initialization error");
  }
}

// ---------- Login / Register ----------

$("#loginBtn").addEventListener("click", () => {
  setAuthMode("login");
  $("#account").scrollIntoView({ behavior: "smooth" });
});

$("#registerBtn").addEventListener("click", () => {
  setAuthMode("register");
  $("#account").scrollIntoView({ behavior: "smooth" });
});

$("#logoutBtn").addEventListener("click", async () => {
  if (!auth) return toast("Firebase Config পরীক্ষা করো।");

  try {
    await signOut(auth);
    toast("Logout সফল হয়েছে।");
  } catch (error) {
    console.error(error);
    toast(friendlyError(error.code));
  }
});

$("#authForm").addEventListener("submit", async (event) => {
  event.preventDefault();

  if (!auth || !db) {
    return toast("Firebase Config ঠিক করা হয়নি।");
  }

  const email = $("#email").value.trim();
  const password = $("#password").value;
  const name = $("#displayName").value.trim();

  $("#authSubmit").disabled = true;

  try {
    if (authMode === "register") {
      const credential =
        await createUserWithEmailAndPassword(
          auth,
          email,
          password
        );

      if (name) {
        await updateProfile(credential.user, {
          displayName: name
        });
      }

      await setDoc(doc(db, "users", credential.user.uid), {
        displayName: name,
        email: email,
        createdAt: serverTimestamp()
      });

      toast("অ্যাকাউন্ট তৈরি হয়েছে!");
    } else {
      await signInWithEmailAndPassword(
        auth,
        email,
        password
      );

      toast("Login সফল হয়েছে!");
    }
  } catch (error) {
    console.error("Authentication error:", error);
    toast(friendlyError(error.code));
  } finally {
    $("#authSubmit").disabled = false;
  }
});

// ---------- Tournament List ----------

async function loadTournaments() {
  try {
    const snapshot = await getDocs(
      query(
        collection(db, "tournaments"),
        orderBy("createdAt", "desc")
      )
    );

    const tournaments = snapshot.docs.map((item) => ({
      id: item.id,
      ...item.data()
    }));

    if (!tournaments.length) {
      $("#tournamentList").innerHTML =
        '<p class="muted">এখনো কোনো Tournament তৈরি হয়নি।</p>';
    } else {
      $("#tournamentList").innerHTML = tournaments.map((t) => `
        <article class="t-card">
          <span class="tag">${esc(t.mode || "MATCH")}</span>
          <h3>${esc(t.title || "Tournament")}</h3>
          <p>🎮 ${esc(t.mode || "")} · 🗺️ ${esc(t.map || "")}</p>
          <p>🗓️ ${esc(t.startAt || "তারিখ পরে জানানো হবে")}</p>
          <p class="muted">${esc(t.status || "open")}</p>
          <div class="card-foot">
            <div>
              <small class="muted">Prize pool</small>
              <div class="prize">${esc(t.prize || "—")}</div>
            </div>
            <button
              class="btn join-btn"
              data-id="${esc(t.id)}"
              data-title="${esc(t.title || "Tournament")}"
            >Join Now</button>
          </div>
        </article>
      `).join("");
    }

    document.querySelectorAll(".join-btn").forEach((button) => {
      button.addEventListener("click", () => {
        openJoin(button.dataset.id, button.dataset.title);
      });
    });

    fillTournamentSelects(tournaments);
  } catch (error) {
    console.error("Tournament loading error:", error);
    toast("Tournament Error: " + error.code);
    $("#tournamentList").innerHTML =
      '<p class="muted">Tournament লোড হয়নি। Firestore Rules পরীক্ষা করো।</p>';
  }
}

function fillTournamentSelects(tournaments) {
  ["#roomTournament", "#resultTournament"].forEach((selector) => {
    const select = $(selector);

    select.innerHTML = tournaments.map((t) => `
      <option value="${esc(t.id)}">${esc(t.title || "Tournament")}</option>
    `).join("");
  });
}

// ---------- Join Tournament ----------

function openJoin(id, title) {
  if (!currentUser) {
    setAuthMode("login");
    $("#account").scrollIntoView({ behavior: "smooth" });
    return toast("Tournament Join করতে আগে Login করো।");
  }

  selectedTournament = id;
  $("#joinTitle").textContent = `Join: ${title}`;
  $("#joinModal").hidden = false;
}

$("#joinClose").addEventListener("click", () => {
  $("#joinModal").hidden = true;
});

$("#joinModal").addEventListener("click", (event) => {
  if (event.target.id === "joinModal") {
    $("#joinModal").hidden = true;
  }
});

$("#joinForm").addEventListener("submit", async (event) => {
  event.preventDefault();

  if (!currentUser || !selectedTournament) {
    return toast("আগে Login করে Tournament বেছে নাও।");
  }

  const registrationId =
    `${currentUser.uid}_${selectedTournament}`;

  try {
    const reference = doc(db, "registrations", registrationId);
    const existing = await getDoc(reference);

    if (existing.exists()) {
      return toast("তুমি ইতিমধ্যে এই Tournament-এ Join করেছ।");
    }

    await setDoc(reference, {
      uid: currentUser.uid,
      tournamentId: selectedTournament,
      inGameName: $("#ign").value.trim(),
      freeFireUid: $("#ffuid").value.trim(),
      teamName: $("#teamName").value.trim(),
      status: "registered",
      createdAt: serverTimestamp()
    });

    $("#joinModal").hidden = true;
    $("#joinForm").reset();

    toast("Tournament Join সফল হয়েছে!");

    await loadRooms();

    if (!$("#adminPanel").hidden) {
      await loadAdminData();
    }
  } catch (error) {
    console.error("Tournament join error:", error);
    toast(friendlyError(error.code));
  }
});

// ---------- Results ----------

async function loadResults() {
  try {
    const snapshot = await getDocs(
      query(
        collection(db, "results"),
        orderBy("publishedAt", "desc")
      )
    );

    $("#resultsList").innerHTML = snapshot.empty
      ? '<tr><td colspan="3">এখনো ফলাফল প্রকাশ হয়নি।</td></tr>'
      : snapshot.docs.map((item) => {
          const result = item.data();

          return `
            <tr>
              <td>${esc(result.tournamentTitle || result.tournamentId)}</td>
              <td>${esc(result.winner || result.details || "—")}</td>
              <td class="status">প্রকাশিত</td>
            </tr>
          `;
        }).join("");
  } catch (error) {
    console.error("Results loading error:", error);

    $("#resultsList").innerHTML =
      '<tr><td colspan="3">ফলাফল লোড হয়নি। Firestore Rules পরীক্ষা করো।</td></tr>';
  }
}

// ---------- Player Room Details ----------

async function loadRooms() {
  if (!currentUser) {
    $("#roomList").innerHTML =
      '<p class="muted">Room details দেখতে Login করো।</p>';
    return;
  }

  try {
    const registrations = await getDocs(
      query(
        collection(db, "registrations"),
        where("uid", "==", currentUser.uid)
      )
    );

    if (registrations.empty) {
      $("#roomList").innerHTML =
        '<p class="muted">তুমি এখনো কোনো Tournament-এ Join করোনি।</p>';
      return;
    }

    let html = "";

    for (const registration of registrations.docs) {
      const data = registration.data();

      const tournament = await getDoc(
        doc(db, "tournaments", data.tournamentId)
      );

      const room = await getDoc(
        doc(db, "roomDetails", data.tournamentId)
      );

      html += `
        <div class="t-card">
          <h3>${esc(
            tournament.exists()
              ? tournament.data().title
              : "Tournament"
          )}</h3>
          ${
            room.exists()
              ? `
                <p>Room ID: <b>${esc(room.data().roomId)}</b></p>
                <p>Password: <b>${esc(room.data().password)}</b></p>
              `
              : '<p class="muted">অ্যাডমিন এখনো Room details প্রকাশ করেননি।</p>'
          }
        </div>
      `;
    }

    $("#roomList").innerHTML = html;
  } catch (error) {
    console.error("Room loading error:", error);
    $("#roomList").innerHTML =
      '<p class="muted">Room details লোড হয়নি। Rules পরীক্ষা করো।</p>';
  }
}

// ---------- Admin Data ----------

async function loadAdminData() {
  if (!currentUser) return;

  try {
    const token = await currentUser.getIdTokenResult();

    if (token.claims.admin !== true) return;

    const snapshot = await getDocs(
      collection(db, "registrations")
    );

    $("#registrationsList").innerHTML = snapshot.empty
      ? '<tr><td colspan="4">এখনো Registration নেই।</td></tr>'
      : snapshot.docs.map((item) => {
          const data = item.data();

          return `
            <tr>
              <td>${esc(data.uid)}</td>
              <td>${esc(data.inGameName)}</td>
              <td>${esc(data.freeFireUid)}</td>
              <td>${esc(data.tournamentId)}</td>
            </tr>
          `;
        }).join("");
  } catch (error) {
    console.error("Admin data error:", error);
    toast("Admin data লোড হয়নি। Rules ও Admin claim পরীক্ষা করো।");
  }
}

// ---------- Create Tournament ----------

$("#tournamentForm").addEventListener("submit", async (event) => {
  event.preventDefault();

  if (!currentUser) return toast("আগে Admin হিসেবে Login করো।");

  try {
    const token = await currentUser.getIdTokenResult(true);

    console.log("Admin claim:", token.claims.admin);
    if (token.claims.admin !== true) {
      return toast("তোমার Admin permission নেই।");
    }

    await addDoc(collection(db, "tournaments"), {
      title: $("#tTitle").value.trim(),
      mode: $("#tMode").value,
      map: $("#tMap").value.trim(),
      prize: $("#tPrize").value.trim(),
      startAt: $("#tStart").value,
      status: "open",
      createdAt: serverTimestamp(),
      createdBy: currentUser.uid
    });

    $("#tournamentForm").reset();
    toast("Tournament তৈরি হয়েছে!");

    await loadTournaments();
  } catch (error) {
    console.error("Create tournament error:", error);
    toast(friendlyError(error.code));
  }
});

// ---------- Publish Room Details ----------

$("#roomForm").addEventListener("submit", async (event) => {
  event.preventDefault();

  if (!currentUser) return toast("আগে Admin হিসেবে Login করো।");

  try {
    const token = await currentUser.getIdTokenResult(true);

    if (token.claims.admin !== true) {
      return toast("তোমার Admin permission নেই।");
    }

    const id = $("#roomTournament").value;

    if (!id) return toast("Tournament বেছে নাও।");

    await setDoc(doc(db, "roomDetails", id), {
      tournamentId: id,
      roomId: $("#roomId").value.trim(),
      password: $("#roomPassword").value.trim(),
      updatedAt: serverTimestamp()
    });

    $("#roomForm").reset();
    toast("Room details সংরক্ষিত হয়েছে!");

    await loadRooms();
  } catch (error) {
    console.error("Room save error:", error);
    toast(friendlyError(error.code));
  }
});

// ---------- Publish Results ----------

$("#resultForm").addEventListener("submit", async (event) => {
  event.preventDefault();

  if (!currentUser) return toast("আগে Admin হিসেবে Login করো।");

  try {
    const token = await currentUser.getIdTokenResult();

    if (token.claims.admin !== true) {
      return toast("তোমার Admin permission নেই।");
    }

    const id = $("#resultTournament").value;

    if (!id) return toast("Tournament বেছে নাও।");

    const tournament = await getDoc(
      doc(db, "tournaments", id)
    );

    await addDoc(collection(db, "results"), {
      tournamentId: id,
      tournamentTitle: tournament.exists()
        ? tournament.data().title
        : "Tournament",
      winner: $("#winner").value.trim(),
      details: $("#resultDetails").value.trim(),
      publishedAt: serverTimestamp(),
      publishedBy: currentUser.uid
    });

    $("#resultForm").reset();
    toast("Result প্রকাশ হয়েছে!");

    await loadResults();
  } catch (error) {
    console.error("Publish result error:", error);
    toast(friendlyError(error.code));
  }
});

// ---------- Mobile Navigation ----------

$("#menuBtn").addEventListener("click", () => {
  $("#nav").classList.toggle("open");
});

$("#nav").querySelectorAll("a").forEach((link) => {
  link.addEventListener("click", () => {
    $("#nav").classList.remove("open");
  });
});
