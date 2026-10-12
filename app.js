
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-app.js";

import {
  getAuth,
  signOut,
  onAuthStateChanged,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
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

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

let currentUser = null;
let selectedTournament = null;
let isAdmin = false;
let authMode = "register";

const $ = selector => document.querySelector(selector);

function on(selector, event, callback) {
  $(selector)?.addEventListener(event, callback);
}

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
  return String(value).replace(/[&<>"']/g, char => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[char]);
}

function setAuthMode(mode) {
  authMode = mode;

  if ($("#displayNameWrap")) {
    $("#displayNameWrap").hidden = mode === "login";
  }

  if ($("#displayName")) {
    $("#displayName").required = mode === "register";
  }

  if ($("#authSubmit")) {
    $("#authSubmit").textContent =
      mode === "login" ? "Login" : "Register";
  }

  if ($("#authMessage")) {
    $("#authMessage").textContent =
      mode === "login"
        ? "তোমার ইমেইল ও পাসওয়ার্ড দিয়ে Login করো।"
        : "নতুন অ্যাকাউন্ট তৈরি করতে তথ্য দাও।";
  }
}

function friendlyError(code) {
  const errors = {
    "auth/email-already-in-use":
      "এই ইমেইলে অ্যাকাউন্ট আছে। Login করো।",
    "auth/invalid-credential":
      "ইমেইল বা পাসওয়ার্ড সঠিক নয়।",
    "auth/weak-password":
      "আরও শক্তিশালী পাসওয়ার্ড দাও।",
    "auth/invalid-email":
      "সঠিক ইমেইল দাও।",
    "auth/too-many-requests":
      "অনেকবার চেষ্টা হয়েছে। পরে চেষ্টা করো।",
    "auth/network-request-failed":
      "ইন্টারনেট সংযোগ পরীক্ষা করো।"
  };

  return errors[code] ||
    "সমস্যা হয়েছে। আবার চেষ্টা করো।";
}

// Login / Register: এই ফর্ম শুধু সেই HTML-এ কাজ করবে যেখানে আছে।
on("#loginBtn", "click", () => {
  setAuthMode("login");
  $("#account")?.scrollIntoView({ behavior: "smooth" });
});

on("#registerBtn", "click", () => {
  setAuthMode("register");
  $("#account")?.scrollIntoView({ behavior: "smooth" });
});

on("#authForm", "submit", async event => {
  event.preventDefault();

  const email = $("#email")?.value.trim();
  const password = $("#password")?.value;

  if (!email || !password) {
    return toast("ইমেইল ও পাসওয়ার্ড দাও।");
  }

  try {
    if (authMode === "register") {
      const name = $("#displayName")?.value.trim();

      if (!name) return toast("তোমার নাম লিখো।");

      const credential =
        await createUserWithEmailAndPassword(
          auth, email, password
        );

      await updateProfile(credential.user, {
        displayName: name
      });

      await setDoc(
        doc(db, "users", credential.user.uid),
        {
          displayName: name,
          email,
          createdAt: serverTimestamp()
        }
      );

      toast("অ্যাকাউন্ট তৈরি হয়েছে!");
    } else {
      await signInWithEmailAndPassword(
        auth, email, password
      );

      toast("লগইন সফল!");
    }

    location.replace("index.html");
  } catch (error) {
    console.error(error);
    toast(friendlyError(error.code));
  }
});

// Logout
on("#logoutBtn", "click", async () => {
  try {
    await signOut(auth);
    location.replace("login.html");
  } catch (error) {
    console.error(error);
    toast("Logout হয়নি। আবার চেষ্টা করো।");
  }
});

// Authentication guard:
// Dashboard-এ Login ছাড়া প্রবেশ করা যাবে না।
onAuthStateChanged(auth, async user => {
  currentUser = user;

  if (!user) {
    if (location.pathname.endsWith("/index.html") ||
        location.pathname === "/" ||
        !location.pathname.endsWith("/login.html")) {
      location.replace("login.html");
    }
    return;
  }

  // Login পেজে ইতিমধ্যে Login করা user এলে Dashboard-এ পাঠাও।
  if (location.pathname.endsWith("/login.html")) {
    location.replace("index.html");
    return;
  }

  if ($("#userStatus")) {
    $("#userStatus").textContent =
      `লগইন: ${user.displayName || user.email}`;
  }

  if ($("#loginBtn")) $("#loginBtn").hidden = true;
  if ($("#registerBtn")) $("#registerBtn").hidden = true;
  if ($("#logoutBtn")) $("#logoutBtn").hidden = false;

  if ($("#accountTitle")) {
    $("#accountTitle").textContent =
      user.displayName || "তোমার অ্যাকাউন্ট";
  }

  try {
    const token = await user.getIdTokenResult(true);
    isAdmin = token.claims.admin === true;

    if ($("#adminPanel")) {
      $("#adminPanel").hidden = !isAdmin;
    }
  } catch (error) {
    console.error(error);
    isAdmin = false;
    if ($("#adminPanel")) $("#adminPanel").hidden = true;
  }

  await Promise.all([
    loadTournaments(),
    loadResults(),
    loadRooms(),
    isAdmin ? loadAdminData() : Promise.resolve()
  ]);
});

// Tournament list
async function loadTournaments() {
  if (!$("#tournamentList")) return;

  try {
    const snapshot = await getDocs(
      query(
        collection(db, "tournaments"),
        orderBy("createdAt", "desc")
      )
    );

    const items = snapshot.docs.map(item => ({
      id: item.id,
      ...item.data()
    }));

    $("#tournamentList").innerHTML = items.length
      ? items.map(t => `
        <article class="t-card">
          <span class="tag">${esc(t.mode || "MATCH")}</span>
          <h3>${esc(t.title)}</h3>
          <p>🎮 ${esc(t.mode || "")} · 🗺️ ${esc(t.map || "")}</p>
          <p>🗓️ ${esc(t.startAt || "তারিখ পরে জানানো হবে")}</p>
          <p class="muted">${esc(t.status || "open")}</p>
          <div class="card-foot">
            <div>
              <small class="muted">Prize pool</small>
              <div class="prize">${esc(t.prize || "—")}</div>
            </div>
            <button class="btn join-btn"
              data-id="${esc(t.id)}"
              data-title="${esc(t.title)}">
              Join Now
            </button>
          </div>
        </article>
      `).join("")
      : '<p class="muted">এখনো টুর্নামেন্ট নেই।</p>';

    document.querySelectorAll(".join-btn").forEach(button => {
      button.addEventListener("click", () => {
        openJoin(button.dataset.id, button.dataset.title);
      });
    });

    fillTournamentSelects(items);
  } catch (error) {
    console.error(error);
    $("#tournamentList").innerHTML =
      '<p class="muted">Tournament লোড হয়নি। Firestore Rules পরীক্ষা করো।</p>';
  }
}

function fillTournamentSelects(items) {
  ["#roomTournament", "#resultTournament"].forEach(selector => {
    const select = $(selector);
    if (!select) return;

    select.innerHTML = items.map(t =>
      `<option value="${esc(t.id)}">${esc(t.title)}</option>`
    ).join("");
  });
}

// Join Now
function openJoin(id, title) {
  if (!currentUser) {
    location.replace("login.html");
    return;
  }

  selectedTournament = id;

  if ($("#joinTitle")) {
    $("#joinTitle").textContent = "Join: " + title;
  }

  if ($("#joinModal")) {
    $("#joinModal").hidden = false;
  }
}

on("#joinClose", "click", () => {
  if ($("#joinModal")) $("#joinModal").hidden = true;
});

on("#joinModal", "click", event => {
  if (event.target.id === "joinModal") {
    $("#joinModal").hidden = true;
  }
});

on("#joinForm", "submit", async event => {
  event.preventDefault();

  if (!currentUser || !selectedTournament) {
    return toast("আগে Login করে Tournament বেছে নাও।");
  }

  const name = $("#ign")?.value.trim();
  const uid = $("#ffuid")?.value.trim();
  const team = $("#teamName")?.value.trim();

  if (!name || !uid) {
    return toast("In-Game Name ও Free Fire UID দাও।");
  }

  const registrationId =
    `${currentUser.uid}_${selectedTournament}`;

  try {
    const ref = doc(db, "registrations", registrationId);
    const existing = await getDoc(ref);

    if (existing.exists()) {
      return toast("তুমি ইতিমধ্যে Join করেছ।");
    }

    await setDoc(ref, {
      uid: currentUser.uid,
      tournamentId: selectedTournament,
      inGameName: name,
      freeFireUid: uid,
      teamName: team || "",
      status: "registered",
      createdAt: serverTimestamp()
    });

    $("#joinModal").hidden = true;
    $("#joinForm").reset();

    toast("Tournament Join সফল!");

    await loadRooms();

    if (isAdmin) await loadAdminData();
  } catch (error) {
    console.error(error);
    toast("Join হয়নি। Firestore Rules পরীক্ষা করো।");
  }
});

// Results
async function loadResults() {
  if (!$("#resultsList")) return;

  try {
    const snapshot = await getDocs(
      query(
        collection(db, "results"),
        orderBy("publishedAt", "desc")
      )
    );

    $("#resultsList").innerHTML = snapshot.empty
      ? '<tr><td colspan="3">এখনো ফলাফল প্রকাশ হয়নি।</td></tr>'
      : snapshot.docs.map(item => {
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
    console.error(error);
    $("#resultsList").innerHTML =
      '<tr><td colspan="3">ফলাফল লোড হয়নি।</td></tr>';
  }
}

// User's joined tournaments and room details
async function loadRooms() {
  if (!$("#roomList")) return;

  if (!currentUser) {
    $("#roomList").textContent = "Room details দেখতে Login করো।";
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
              ? `<p>Room ID: <b>${esc(room.data().roomId)}</b></p>
                 <p>Password: <b>${esc(room.data().password)}</b></p>`
              : '<p class="muted">অ্যাডমিন এখনো Room details প্রকাশ করেননি।</p>'
          }
        </div>
      `;
    }

    $("#roomList").innerHTML = html;
  } catch (error) {
    console.error(error);
    $("#roomList").innerHTML =
      '<p class="muted">Room details লোড হয়নি।</p>';
  }
}

// Admin registration list
async function loadAdminData() {
  if (!currentUser || !isAdmin || !$("#registrationsList")) return;

  try {
    const snapshot = await getDocs(
      collection(db, "registrations")
    );

    $("#registrationsList").innerHTML = snapshot.empty
      ? '<tr><td colspan="4">এখনো Registration নেই।</td></tr>'
      : snapshot.docs.map(item => {
          const r = item.data();

          return `
            <tr>
              <td>${esc(r.uid)}</td>
              <td>${esc(r.inGameName)}</td>
              <td>${esc(r.freeFireUid)}</td>
              <td>${esc(r.tournamentId)}</td>
            </tr>
          `;
        }).join("");
  } catch (error) {
    console.error(error);
    toast("Registration তালিকা লোড হয়নি।");
  }
}

// Create Tournament: Admin only
on("#tournamentForm", "submit", async event => {
  event.preventDefault();

  if (!currentUser || !isAdmin) {
    return toast("এই কাজের জন্য Admin অনুমতি দরকার।");
  }

  try {
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
    toast("Tournament তৈরি হয়েছে।");
    await loadTournaments();
  } catch (error) {
    console.error(error);
    toast("Tournament তৈরি হয়নি। Admin ও Rules পরীক্ষা করো।");
  }
});

// Publish Room Details: Admin only
on("#roomForm", "submit", async event => {
  event.preventDefault();

  if (!currentUser || !isAdmin) {
    return toast("এই কাজের জন্য Admin অনুমতি দরকার।");
  }

  try {
    const id = $("#roomTournament")?.value;
    if (!id) return toast("Tournament বেছে নাও।");

    await setDoc(doc(db, "roomDetails", id), {
      tournamentId: id,
      roomId: $("#roomId").value.trim(),
      password: $("#roomPassword").value.trim(),
      updatedAt: serverTimestamp()
    });

    toast("Room details সংরক্ষিত।");
    $("#roomForm").reset();
    await loadRooms();
  } catch (error) {
    console.error(error);
    toast("Room details সংরক্ষণ হয়নি। Rules পরীক্ষা করো।");
  }
});

// Publish Results: Admin only
on("#resultForm", "submit", async event => {
  event.preventDefault();

  if (!currentUser || !isAdmin) {
    return toast("এই কাজের জন্য Admin অনুমতি দরকার।");
  }

  try {
    const id = $("#resultTournament")?.value;
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
    toast("Result প্রকাশ হয়েছে।");
    await loadResults();
  } catch (error) {
    console.error(error);
    toast("Result প্রকাশ হয়নি। Admin ও Rules পরীক্ষা করো।");
  }
});

// Mobile menu
on("#menuBtn", "click", () => {
  $("#nav")?.classList.toggle("open");
});

$("#nav")?.querySelectorAll("a").forEach(link => {
  link.addEventListener("click", () => {
    $("#nav")?.classList.remove("open");
  });
});
