const $ = s => document.querySelector(s);
const content = $("#content");
let me = null, currentView = "home", tournaments = [];
const taka = n => "৳" + Number(n || 0).toLocaleString("bn-BD", { maximumFractionDigits: 2 });
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
function toast(msg, error=false){const el=$("#toast");el.textContent=msg;el.classList.toggle("error",error);el.hidden=false;setTimeout(()=>el.hidden=true,3500)}
async function api(url, opts={}) {
  const r=await fetch(url,{credentials:"same-origin",headers:{"Content-Type":"application/json",...(opts.headers||{})},...opts});
  const data=await r.json().catch(()=>({error:"Server response could not be read."}));
  if(!r.ok) throw new Error(data.error||"Request failed");
  return data;
}
function formData(form){return Object.fromEntries(new FormData(form).entries())}
function setIdentity(){
  $("#identity").innerHTML = me
    ? `<span class="muted">${esc(me.username)} · ${taka(me.balance||0)}</span><button class="btn ghost" id="logout">লগআউট</button>`
    : `<span class="muted">লগইন করলে Join ও Wallet ব্যবহার করতে পারবেন</span>`;
  $("#adminTab").hidden = !me || me.role!=="admin";
  $("#auth").hidden=!!me;
}
async function refreshMe(){const d=await api("/api/me");me=d.user;setIdentity()}
function tournamentCard(t){
  const full=t.filled>=t.slots;
  const action=!me?`<button class="btn" data-login>লগইন করুন</button>`:t.joined?`<span class="status">Joined ✓</span>`:full?`<button class="btn ghost" disabled>স্লট শেষ</button>`:`<button class="btn" data-join="${esc(t.id)}">Join Tournament</button>`;
  return `<article class="card"><div class="row"><span class="badge">${esc(t.mode.toUpperCase())}</span><span class="muted">${new Date(t.startsAt).toLocaleString("bn-BD")}</span></div><h3>${esc(t.title)}</h3><dl class="facts"><dt>ম্যাপ</dt><dd>${esc(t.map)}</dd><dt>প্রাইজ পুল</dt><dd>${taka(t.prize)}</dd><dt>এন্ট্রি ফি</dt><dd style="color:var(--yellow)">${taka(t.fee)}</dd><dt>স্লট</dt><dd>${t.filled}/${t.slots}</dd><dt>স্ট্যাটাস</dt><dd>${esc(t.status)}</dd></dl><div class="row">${action}</div></article>`;
}
async function loadTournaments(){tournaments=await api("/api/tournaments")}
async function render(){
  document.querySelectorAll("[data-view]").forEach(b=>b.classList.toggle("active",b.dataset.view===currentView));
  if(currentView==="home"){
    await loadTournaments();
    content.innerHTML=`<div><h2>আসন্ন টুর্নামেন্ট</h2><p class="muted">পছন্দের ম্যাচে Join করুন। এন্ট্রি ফি আপনার Wallet থেকে কাটা হবে।</p></div><div class="tgrid">${tournaments.length?tournaments.map(tournamentCard).join(""):'<div class="panel muted">এখনো কোনো টুর্নামেন্ট যোগ করা হয়নি।</div>'}</div>`;
  } else if(currentView==="wallet"){
    if(!me){content.innerHTML='<div class="panel">ওয়ালেট ব্যবহার করতে লগইন করুন।</div>';return}
    const [ledger,requests]=await Promise.all([api("/api/wallet/ledger"),api("/api/wallet/requests")]);
    content.innerHTML=`<div class="card"><div class="muted">ওয়ালেট ব্যালেন্স</div><div class="big">${taka(me.balance)}</div></div>
    <div class="grid"><form id="deposit" class="panel form"><h3>টাকা Deposit</h3><p class="muted">Send Money করার পরে TrxID জমা দিন। Admin যাচাই করে approve করবেন।</p><label>পেমেন্ট মাধ্যম<select name="method"><option value="bkash">bKash</option><option value="nagad">Nagad</option><option value="rocket">Rocket</option></select></label><label>পরিমাণ (৳)<input name="amount" type="number" min="20" max="50000" step="0.01" required></label><label>যে নম্বর থেকে পাঠিয়েছেন<input name="sender" inputmode="numeric" placeholder="01XXXXXXXXX" required></label><label>Transaction ID<input name="trxId" minlength="6" maxlength="80" required></label><button class="btn yellow">Deposit Request</button></form>
    <form id="withdraw" class="panel form"><h3>টাকা Withdraw</h3><p class="muted">সর্বনিম্ন ৳১০০। অনুরোধে টাকা সাময়িকভাবে আটকে রাখা হবে।</p><label>পেমেন্ট মাধ্যম<select name="method"><option value="bkash">bKash</option><option value="nagad">Nagad</option><option value="rocket">Rocket</option></select></label><label>পরিমাণ (৳)<input name="amount" type="number" min="100" step="0.01" required></label><label>প্রাপকের নম্বর<input name="receiver" inputmode="numeric" placeholder="01XXXXXXXXX" required></label><button class="btn">Withdraw Request</button></form></div>
    <div class="panel"><h3>আমার Payment Request</h3><div class="list">${requests.length?requests.map(r=>`<div class="item"><div><b>${esc(r.kind)} · ${taka(r.amount)}</b><small>${esc(r.method)} · ${esc(r.trx_id||r.sender_or_receiver)} · ${new Date(r.created_at).toLocaleString("bn-BD")}</small></div><span class="status">${esc(r.status)}</span></div>`).join(""):'<div class="muted">কোনো অনুরোধ নেই।</div>'}</div></div>
    <div class="panel"><h3>Wallet Transaction History</h3><div class="list">${ledger.length?ledger.map(l=>`<div class="item"><div><b>${esc(l.type)}</b><small>${esc(l.note)} · ${new Date(l.created_at).toLocaleString("bn-BD")}</small></div><div>${Number(l.amount)<0?'−':'+'}${taka(Math.abs(Number(l.amount)))}<small>ব্যালেন্স ${taka(l.balanceAfter)}</small></div></div>`).join(""):'<div class="muted">লেনদেন নেই।</div>'}</div></div>`;
  } else if(currentView==="mine"){
    if(!me){content.innerHTML='<div class="panel">আপনার ম্যাচ দেখতে লগইন করুন।</div>';return}
    await loadTournaments();
    const mine=tournaments.filter(t=>t.joined);
    content.innerHTML=`<div class="panel"><h2>আমার টুর্নামেন্ট</h2><div class="tgrid">${mine.length?mine.map(tournamentCard).join(""):'<p class="muted">আপনি এখনো কোনো ম্যাচে Join করেননি।</p>'}</div></div>`;
  } else if(currentView==="admin"){
    if(!me||me.role!=="admin"){content.innerHTML='<div class="panel">এই পেজ শুধু Admin-এর জন্য।</div>';return}
    const [requests,users]=await Promise.all([api("/api/admin/requests"),api("/api/admin/users")]);
    content.innerHTML=`<div class="panel"><h2>Admin Dashboard</h2><p class="muted">Deposit approve করার আগে অফিসিয়াল provider app/portal-এ TrxID ও পরিমাণ যাচাই করুন।</p><div class="list">${requests.map(r=>`<div class="item"><div><b>${esc(r.username)} · ${esc(r.kind)} · ${taka(r.amount)}</b><small>${esc(r.method)} · নম্বর ${esc(r.sender_or_receiver)} · TrxID ${esc(r.trx_id||"—")} · ${new Date(r.created_at).toLocaleString("bn-BD")}</small><small>Status: ${esc(r.status)}</small></div>${r.status==="pending"?`<div class="actions">${r.kind==="deposit"?`<button class="btn green" data-review="${esc(r.id)}" data-decision="approve">Approve</button>`:`<button class="btn green" data-review="${esc(r.id)}" data-decision="paid">Paid</button>`}<button class="btn red" data-review="${esc(r.id)}" data-decision="reject">Reject / Refund</button></div>`:""}</div>`).join("")||'<p class="muted">কোনো request নেই।</p>'}</div></div>
    <form id="newTournament" class="panel form"><h2>নতুন Tournament তৈরি</h2><label>টুর্নামেন্ট নাম<input name="title" required minlength="3" maxlength="120"></label><div class="fieldrow"><label>Mode<select name="mode"><option>solo</option><option>duo</option><option>squad</option></select></label><label>Map<input name="map" value="Bermuda" required></label></div><div class="fieldrow"><label>Prize ৳<input name="prize" type="number" min="0" step=".01" required></label><label>Entry Fee ৳<input name="fee" type="number" min="0" step=".01" required></label><label>Slots<input name="slots" type="number" min="1" max="1000" required></label></div><label>শুরুর সময়<input name="startsAt" type="datetime-local" required></label><button class="btn yellow">Tournament Create</button></form>
    <div class="panel"><h3>Users (সর্বশেষ ৩০০)</h3><div class="list">${users.map(u=>`<div class="item"><div><b>${esc(u.username)}</b><small>${esc(u.role)} · ${new Date(u.created_at).toLocaleDateString("bn-BD")}</small></div><b>${taka(u.balance)}</b></div>`).join("")}</div></div>`;
  }
}
document.addEventListener("click",async e=>{
  const view=e.target.closest("[data-view]");if(view){currentView=view.dataset.view;try{await render()}catch(err){toast(err.message,true)}return}
  if(e.target.closest("#logout")){try{await api("/api/logout",{method:"POST",body:"{}"});me=null;setIdentity();currentView="home";await render();toast("লগআউট হয়েছে")}catch(err){toast(err.message,true)}return}
  const join=e.target.closest("[data-join]");if(join){try{await api(`/api/tournaments/${join.dataset.join}/join`,{method:"POST",body:"{}"});await refreshMe();await render();toast("Tournament join successful")}catch(err){toast(err.message,true)}return}
  const review=e.target.closest("[data-review]");if(review){const decision=review.dataset.decision;const msg=decision==="approve"?"TrxID ও টাকা অফিসিয়ালি যাচাই করেছেন? Approve করবেন?":decision==="paid"?"Withdraw টাকা পাঠানো হয়েছে নিশ্চিত?":"Request reject করে refund করবেন?";if(!confirm(msg))return;try{await api(`/api/admin/requests/${review.dataset.review}/review`,{method:"POST",body:JSON.stringify({decision})});await refreshMe();await render();toast("Request আপডেট হয়েছে")}catch(err){toast(err.message,true)}return}
  if(e.target.closest("[data-login]")){currentView="home";$("#auth").scrollIntoView({behavior:"smooth"});}
});
$("#loginForm").addEventListener("submit",async e=>{e.preventDefault();try{await api("/api/login",{method:"POST",body:JSON.stringify(formData(e.target))});await refreshMe();await render();toast("লগইন সফল")}catch(err){toast(err.message,true)}});
$("#registerForm").addEventListener("submit",async e=>{e.preventDefault();try{await api("/api/register",{method:"POST",body:JSON.stringify(formData(e.target))});await refreshMe();await render();toast("অ্যাকাউন্ট তৈরি হয়েছে")}catch(err){toast(err.message,true)}});
$("#content").addEventListener("submit",async e=>{
  e.preventDefault();const form=e.target;
  try{
    if(form.id==="deposit"){await api("/api/wallet/deposit",{method:"POST",body:JSON.stringify(formData(form))});toast("Deposit request জমা হয়েছে");}
    else if(form.id==="withdraw"){await api("/api/wallet/withdraw",{method:"POST",body:JSON.stringify(formData(form))});await refreshMe();toast("Withdraw request জমা হয়েছে");}
    else if(form.id==="newTournament"){const data=formData(form);data.startsAt=new Date(data.startsAt).toISOString();await api("/api/admin/tournaments",{method:"POST",body:JSON.stringify(data)});toast("Tournament তৈরি হয়েছে");}
    else return;
    await refreshMe();await render();
  }catch(err){toast(err.message,true)}
});
(async()=>{try{await refreshMe();await render()}catch(err){toast(err.message,true)}})();
