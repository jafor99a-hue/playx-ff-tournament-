import app from "./firebase-config.js";
import {
  getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword,
  signOut, onAuthStateChanged, updateProfile
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-auth.js";
import {
  getFirestore, collection, addDoc, getDocs, getDoc, doc, setDoc,
  updateDoc, deleteDoc, query, where, serverTimestamp
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";

const auth = getAuth(app);
const db = getFirestore(app);

// IMPORTANT: এখানে আপনার Firebase অ্যাকাউন্টের Admin email লিখুন।
// Firestore Rules ফাইলেও একই email বসাতে হবে।
const ADMIN_EMAILS = ["jafor99a@gmail.com"];

const $ = (id) => document.getElementById(id);
let currentUser = null;
let authMode = "login";
let tournaments = [];
let joinedIds = new Set();
let currentView = "dashboard";
let toastTimer;

function toast(message) {
  const el = $("toast");
  el.textContent = message;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 3200);
}
function isAdmin() {
  return !!currentUser && ADMIN_EMAILS.map(e => e.toLowerCase()).includes((currentUser.email || "").toLowerCase());
}
function safe(value) {
  return String(value ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
}
function formatDate(value) {
  if (!value) return "সময় পরে জানানো হবে";
  const d = value?.toDate ? value.toDate() : new Date(value);
  if (Number.isNaN(d.getTime())) return "সময় পরে জানানো হবে";
  return d.toLocaleString("bn-BD", { dateStyle:"medium", timeStyle:"short" });
}
function showAuthMode(mode) {
  authMode = mode;
  $("show-login").classList.toggle("active", mode === "login");
  $("show-register").classList.toggle("active", mode === "register");
  $("auth-submit").textContent = mode === "login" ? "লগইন করুন" : "অ্যাকাউন্ট তৈরি করুন";
  $("name-label").hidden = mode === "login";
  $("display-name").hidden = mode === "login";
  $("display-name").required = mode === "register";
  $("auth-password").autocomplete = mode === "login" ? "current-password" : "new-password";
  $("auth-message").textContent = "";
}
$("show-login").addEventListener("click", () => showAuthMode("login"));
$("show-register").addEventListener("click", () => showAuthMode("register"));

$("auth-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const email = $("auth-email").value.trim();
  const password = $("auth-password").value;
  const name = $("display-name").value.trim();
  $("auth-submit").disabled = true;
  $("auth-message").textContent = "একটু অপেক্ষা করুন…";
  try {
    if (authMode === "register") {
      const credential = await createUserWithEmailAndPassword(auth, email, password);
      if (name) await updateProfile(credential.user, { displayName: name });
      await setDoc(doc(db, "users", credential.user.uid), {
        displayName: name || "Player",
        email: credential.user.email,
        createdAt: serverTimestamp()
      }, { merge: true });
      toast("রেজিস্ট্রেশন সফল!");
    } else {
      await signInWithEmailAndPassword(auth, email, password);
      toast("লগইন সফল!");
    }
  } catch (error) {
    $("auth-message").textContent = authError(error);
  } finally {
    $("auth-submit").disabled = false;
  }
});
function authError(error) {
  const code = error?.code || "";
  const messages = {
    "auth/email-already-in-use":"এই ইমেইল দিয়ে আগে থেকেই অ্যাকাউন্ট আছে।",
    "auth/invalid-email":"সঠিক ইমেইল দিন।",
    "auth/weak-password":"পাসওয়ার্ড কমপক্ষে ৬ অক্ষরের দিন।",
    "auth/invalid-credential":"ইমেইল বা পাসওয়ার্ড সঠিক নয়।",
    "auth/network-request-failed":"ইন্টারনেট সংযোগ পরীক্ষা করুন।",
    "permission-denied":"Firestore Rules অনুমতি দিচ্ছে না। Firebase Rules সেটিং দেখুন।"
  };
  return messages[code] || `সমস্যা হয়েছে: ${error?.message || code || "আবার চেষ্টা করুন"}`;
}
$("logout-btn").addEventListener("click", async () => {
  try { await signOut(auth); toast("লগআউট হয়েছে।"); } catch (e) { toast(authError(e)); }
});

document.querySelectorAll("[data-view]").forEach(btn => btn.addEventListener("click", () => navigate(btn.dataset.view)));
document.querySelectorAll("[data-goto]").forEach(btn => btn.addEventListener("click", () => navigate(btn.dataset.goto)));
$("menu-btn").addEventListener("click", () => $("sidebar").classList.toggle("open"));

function navigate(view) {
  if (view === "admin" && !isAdmin()) { toast("এই প্যানেল শুধু অনুমোদিত Admin-এর জন্য।"); return; }
  currentView = view;
  document.querySelectorAll(".view").forEach(el => el.hidden = el.id !== `view-${view}`);
  document.querySelectorAll(".nav-link[data-view]").forEach(el => el.classList.toggle("active", el.dataset.view === view));
  $("sidebar").classList.remove("open");
  if (view === "admin") renderAdmin();
  if (view === "joined") renderJoined();
  if (view === "results") renderResults();
  if (view === "wallet") refreshBalance();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

onAuthStateChanged(auth, async user => {
  currentUser = user;
  $("auth-screen").hidden = !!user;
  $("app-shell").hidden = !user;
  if (!user) return;
  $("user-name").textContent = user.displayName || (user.email || "Player").split("@")[0];
  $("user-role").textContent = isAdmin() ? "Admin" : "Player";
  $("admin-nav").hidden = !isAdmin();
  $("welcome-title").textContent = `স্বাগতম, ${user.displayName || "Player"}`;
  try {
    await setDoc(doc(db, "users", user.uid), {
      displayName: user.displayName || "Player", email: user.email || "", lastLoginAt: serverTimestamp()
    }, { merge: true });
    await loadTournaments();
    await loadJoined();
    await refreshBalance();
    navigate("dashboard");
  } catch (error) {
    console.error(error);
    toast(authError(error));
  }
});

async function loadTournaments() {
  const snap = await getDocs(collection(db, "tournaments"));
  tournaments = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  tournaments.sort((a,b) => {
    const aa = a.createdAt?.toMillis?.() || 0, bb = b.createdAt?.toMillis?.() || 0;
    return bb-aa;
  });
  renderTournaments();
  fillRoomTournamentSelect();
}
async function loadJoined() {
  const snap = await getDocs(query(collection(db, "tournamentJoins"), where("userId", "==", currentUser.uid)));
  joinedIds = new Set(snap.docs.map(d => d.data().tournamentId));
  $("stat-joined").textContent = String(joinedIds.size);
}
function tournamentCard(t) {
  const joined = joinedIds.has(t.id);
  const count = Number(t.joinedCount || 0), slots = Number(t.slots || 48);
  return `<article class="tournament-card">
    <div class="card-banner"><div><div class="mode">${safe((t.mode || "SQUAD").toUpperCase())} MATCH</div><h3>${safe(t.map || "Bermuda")}</h3></div><div class="emblem">⚡</div></div>
    <div class="card-body"><h3>${safe(t.name || "PlayX Tournament")}</h3>
      <div class="meta-row"><span>🏆 প্রাইজ পুল</span><strong class="prize">৳${Number(t.prize || 0).toLocaleString("en-US")}</strong></div>
      <div class="meta-row"><span>🗺️ ম্যাপ</span><strong>${safe(t.map || "Bermuda")}</strong></div>
      <div class="meta-row"><span>👥 স্লট</span><strong>${count}/${slots}</strong></div>
      <div class="meta-row"><span>🕒 সময়</span><strong>${safe(formatDate(t.matchTime))}</strong></div>
      <div class="progress"><span style="width:${Math.min(100, slots ? count/slots*100 : 0)}%"></span></div>
      <div class="card-actions">${joined ? `<button class="btn outline" disabled>✓ যোগ দিয়েছেন</button>` : `<button class="btn primary" data-join="${safe(t.id)}">Join Now</button>`}<button class="btn outline" data-info="${safe(t.id)}">বিস্তারিত</button></div>
    </div></article>`;
}
function renderTournaments() {
  $("stat-tournaments").textContent = String(tournaments.filter(t => t.status !== "finished").length);
  const html = tournaments.filter(t => t.status !== "finished").map(tournamentCard).join("") || `<div class="panel muted">এখনো কোনো টুর্নামেন্ট নেই। Admin নতুন টুর্নামেন্ট তৈরি করতে পারবেন।</div>`;
  $("featured-tournaments").innerHTML = html;
  $("all-tournaments").innerHTML = html;
  document.querySelectorAll("[data-join]").forEach(btn => btn.addEventListener("click", () => joinTournament(btn.dataset.join)));
  document.querySelectorAll("[data-info]").forEach(btn => btn.addEventListener("click", () => showTournamentInfo(btn.dataset.info)));
}
async function joinTournament(id) {
  if (!currentUser) return;
  if (joinedIds.has(id)) { toast("আপনি ইতিমধ্যে যোগ দিয়েছেন।"); return; }
  const t = tournaments.find(x => x.id === id);
  if (!t) return;
  if (Number(t.joinedCount || 0) >= Number(t.slots || 48)) { toast("এই টুর্নামেন্টের সব স্লট পূর্ণ।"); return; }
  try {
    const joinRef = doc(db, "tournamentJoins", `${id}_${currentUser.uid}`);
    const existing = await getDoc(joinRef);
    if (existing.exists()) { joinedIds.add(id); renderTournaments(); toast("আপনি ইতিমধ্যে যোগ দিয়েছেন।"); return; }
    await setDoc(joinRef, {
      tournamentId: id, userId: currentUser.uid, email: currentUser.email || "",
      playerName: currentUser.displayName || (currentUser.email || "Player").split("@")[0],
      joinedAt: serverTimestamp()
    });
    await updateDoc(doc(db, "tournaments", id), { joinedCount: Number(t.joinedCount || 0) + 1 });
    joinedIds.add(id);
    t.joinedCount = Number(t.joinedCount || 0) + 1;
    renderTournaments(); renderJoined();
    $("stat-joined").textContent = String(joinedIds.size);
    toast("টুর্নামেন্টে সফলভাবে যোগ দিয়েছেন!");
  } catch (error) { console.error(error); toast(authError(error)); }
}
async function showTournamentInfo(id) {
  const t = tournaments.find(x => x.id === id);
  if (!t) return;
  const joined = joinedIds.has(id);
  if (!joined) { toast("রুম আইডি দেখতে আগে টুর্নামেন্টে Join Now করুন।"); return; }
  try {
    const roomSnap = await getDoc(doc(db, "tournamentRooms", id));
    if (!roomSnap.exists()) { toast("Admin এখনো রুম আইডি ও পাসওয়ার্ড প্রকাশ করেননি।"); return; }
    const room = roomSnap.data();
    alert(`${t.name}\nRoom ID: ${room.roomId}\nPassword: ${room.roomPassword}\nম্যাচের সময়: ${formatDate(t.matchTime)}`);
  } catch (e) { console.error(e); toast("রুম তথ্য পড়া যায়নি। আপনি ম্যাচে যোগ দিয়েছেন কি না এবং Firestore Rules দেখুন।"); }
}
function renderJoined() {
  const mine = tournaments.filter(t => joinedIds.has(t.id));
  $("joined-list").innerHTML = mine.map(t => `<div class="list-card"><div class="emblem">🎮</div><div class="grow"><h3>${safe(t.name)}</h3><div class="muted">${safe(t.mode || "Squad")} · ${safe(formatDate(t.matchTime))}</div></div><button class="btn primary" data-info="${safe(t.id)}">রুম তথ্য</button></div>`).join("") || `<div class="panel muted">আপনি এখনো কোনো টুর্নামেন্টে যোগ দেননি।</div>`;
  $("joined-list").querySelectorAll("[data-info]").forEach(btn => btn.addEventListener("click", () => showTournamentInfo(btn.dataset.info)));
}
function renderResults() {
  const finished = tournaments.filter(t => t.status === "finished" || t.result);
  $("results-list").innerHTML = finished.map(t => `<div class="list-card"><div class="grow"><h3>🏆 ${safe(t.name)}</h3><div class="muted">${safe(t.result || "রেজাল্ট প্রকাশিত")}</div></div><b class="prize">৳${Number(t.prize || 0).toLocaleString("en-US")}</b></div>`).join("") || `<div class="panel muted">এখনো কোনো রেজাল্ট প্রকাশ করা হয়নি।</div>`;
}
async function refreshBalance() {
  if (!currentUser) return;
  try {
    const snap = await getDoc(doc(db, "users", currentUser.uid));
    const balance = Number(snap.exists() ? snap.data().demoBalance || 0 : 0);
    $("demo-balance").textContent = String(balance);
    $("wallet-balance").textContent = String(balance);
  } catch (e) { console.error(e); }
}
$("demo-credit-form").addEventListener("submit", async event => {
  event.preventDefault();
  const amount = Number($("demo-amount").value);
  if (!Number.isFinite(amount) || amount < 1 || amount > 1000) { toast("১ থেকে ১০০০-এর মধ্যে পরিমাণ দিন।"); return; }
  try {
    const ref = doc(db, "users", currentUser.uid);
    const snap = await getDoc(ref);
    const balance = Number(snap.exists() ? snap.data().demoBalance || 0 : 0);
    await setDoc(ref, { demoBalance: balance + amount }, { merge: true });
    $("demo-amount").value = "";
    await refreshBalance();
    toast("ডেমো ব্যালেন্স যোগ হয়েছে (বাস্তব টাকা নয়)।");
  } catch (e) { toast(authError(e)); }
});

function fillRoomTournamentSelect() {
  const select = $("room-tournament");
  const old = select.value;
  select.innerHTML = `<option value="">টুর্নামেন্ট বেছে নিন</option>` + tournaments.map(t => `<option value="${safe(t.id)}">${safe(t.name)}</option>`).join("");
  if (tournaments.some(t => t.id === old)) select.value = old;
}
$("tournament-form").addEventListener("submit", async event => {
  event.preventDefault();
  if (!isAdmin()) return toast("Admin অনুমতি নেই।");
  const name = $("t-name").value.trim();
  const matchTime = $("t-time").value ? new Date($("t-time").value) : null;
  try {
    await addDoc(collection(db, "tournaments"), {
      name, mode: $("t-mode").value, map: $("t-map").value,
      prize: Math.max(0, Number($("t-prize").value || 0)),
      slots: Math.max(1, Math.min(100, Number($("t-slots").value || 48))),
      joinedCount: 0, status: "open", matchTime, createdBy: currentUser.uid,
      createdAt: serverTimestamp()
    });
    $("tournament-form").reset();
    $("t-prize").value = "0"; $("t-slots").value = "48";
    await loadTournaments(); renderAdmin(); toast("নতুন টুর্নামেন্ট প্রকাশিত হয়েছে।");
  } catch (e) { console.error(e); toast(authError(e)); }
});
$("room-form").addEventListener("submit", async event => {
  event.preventDefault();
  if (!isAdmin()) return toast("Admin অনুমতি নেই।");
  const id = $("room-tournament").value;
  const roomId = $("room-id").value.trim();
  const roomPassword = $("room-password").value.trim();
  if (!id) return toast("একটি টুর্নামেন্ট নির্বাচন করুন।");
  try {
    await setDoc(doc(db, "tournamentRooms", id), { tournamentId: id, roomId, roomPassword, updatedAt: serverTimestamp() });
    const t = tournaments.find(x => x.id === id);
    if (t) { t.roomSet = true; }
    $("room-id").value = ""; $("room-password").value = "";
    renderAdmin(); toast("রুম আইডি ও পাসওয়ার্ড সেভ হয়েছে।");
  } catch (e) { console.error(e); toast(authError(e)); }
});
$("clear-room-btn").addEventListener("click", async () => {
  if (!isAdmin()) return toast("Admin অনুমতি নেই।");
  const id = $("room-tournament").value;
  if (!id) return toast("একটি টুর্নামেন্ট নির্বাচন করুন।");
  try {
    await deleteDoc(doc(db, "tournamentRooms", id));
    const t = tournaments.find(x => x.id === id);
    if (t) { t.roomSet = false; }
    renderAdmin(); toast("রুমের তথ্য মুছে ফেলা হয়েছে।");
  } catch (e) { console.error(e); toast(authError(e)); }
});
$("refresh-admin").addEventListener("click", async () => {
  try { await loadTournaments(); await renderAdmin(); toast("তথ্য রিফ্রেশ হয়েছে।"); } catch(e) { toast(authError(e)); }
});
async function renderAdmin() {
  if (!isAdmin()) return;
  fillRoomTournamentSelect();
  for (const t of tournaments) {
    try { t.roomSet = (await getDoc(doc(db, "tournamentRooms", t.id))).exists(); }
    catch (_) { t.roomSet = false; }
  }
  $("admin-tournaments").innerHTML = tournaments.map(t => `<div class="list-card"><div class="grow"><h3>${safe(t.name)}</h3><div class="muted">${safe(t.mode)} · ${safe(t.map)} · ${Number(t.joinedCount||0)}/${Number(t.slots||48)} joined</div><div class="muted">${t.roomSet ? "🔑 Room set" : "⏳ Room not set"}</div></div><button class="btn outline" data-edit-room="${safe(t.id)}">রুম সেট করুন</button><button class="btn outline" data-finish="${safe(t.id)}">রেজাল্ট/শেষ</button></div>`).join("") || `<div class="muted">কোনো টুর্নামেন্ট নেই।</div>`;
  $("admin-tournaments").querySelectorAll("[data-edit-room]").forEach(btn => btn.addEventListener("click", () => {
    $("room-tournament").value = btn.dataset.editRoom;
    $("room-id").focus();
    window.scrollTo({top:0,behavior:"smooth"});
  }));
  $("admin-tournaments").querySelectorAll("[data-finish]").forEach(btn => btn.addEventListener("click", async () => {
    const result = prompt("রেজাল্ট/বিজয়ীর তথ্য লিখুন (Cancel করলে কিছু হবে না):");
    if (result === null) return;
    try {
      await updateDoc(doc(db, "tournaments", btn.dataset.finish), { status:"finished", result });
      await loadTournaments(); renderResults(); renderAdmin(); toast("রেজাল্ট সেভ হয়েছে।");
    } catch(e) { toast(authError(e)); }
  }));
}
showAuthMode("login");
