import { initializeApp } from "https://www.gstatic.com/firebasejs/13.4.0/firebase-app.js";
import {
  getAuth, onAuthStateChanged, GoogleAuthProvider, signInWithPopup, signInWithRedirect,
  getRedirectResult, signOut
} from "https://www.gstatic.com/firebasejs/13.4.0/firebase-auth.js";
import {
  getFirestore, doc, getDoc, setDoc, addDoc, updateDoc, deleteDoc, collection, query, where,
  onSnapshot, getDocs, writeBatch, serverTimestamp, arrayUnion
} from "https://www.gstatic.com/firebasejs/13.4.0/firebase-firestore.js";
import { getAI, getGenerativeModel, GoogleAIBackend } from "https://www.gstatic.com/firebasejs/13.4.0/firebase-ai.js";
import {
  firebaseConfig, AI_MODELS, DEFAULT_PERSONAL_CATEGORIES, DEFAULT_SHARED_CATEGORIES
} from "./config.js";
import { normKey, computeBalance, computeShare, monthLabel, shiftMonth, currentMonth } from "./logic.js";

const fbApp = initializeApp(firebaseConfig);
const auth = getAuth(fbApp);
const db = getFirestore(fbApp);
const ai = getAI(fbApp, { backend: new GoogleAIBackend() });

// Membri della casa: ordine di primo accesso (M1 = il primo, a cui si riferisce la percentuale).
let M1 = null, M2 = null;

const S = {
  user: null, email: null, tab: "personali", month: currentMonth(),
  settings: null, household: null, personal: [], shared: [], unsub: []
};

const $app = document.getElementById("app");
const eur = new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR" });
const fmt = n => eur.format(n || 0);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const today = () => { const d = new Date(); return `${currentMonth()}-${String(d.getDate()).padStart(2, "0")}`; };

function toast(msg, ms = 2600) {
  const t = document.getElementById("toast");
  t.textContent = msg; t.classList.remove("hidden");
  clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.add("hidden"), ms);
}

// ---------- Riferimenti Firestore ----------
const settingsRef = () => doc(db, "users", S.user.uid, "meta", "settings");
const personalCol = () => collection(db, "users", S.user.uid, "expenses");
const householdRef = () => doc(db, "household", "main");
const sharedCol = () => collection(db, "household", "main", "expenses");

const memberName = email => email ? (S.household?.members?.[email] || email.split("@")[0]) : "(in attesa)";

// ---------- Autenticazione ----------
getRedirectResult(auth).catch(() => {});

onAuthStateChanged(auth, async user => {
  S.unsub.forEach(u => u()); S.unsub = [];
  if (!user) { S.user = null; return renderLogin(); }
  const email = (user.email || "").toLowerCase();
  S.user = user; S.email = email;
  $app.innerHTML = `<div class="center muted"><span class="spinner"></span>Caricamento dati…</div>`;
  try { await ensureDocs(); }
  catch (e) {
    console.error(e);
    if (e.code === "permission-denied") {
      $app.innerHTML = `<div class="login"><h1>Accesso negato</h1>
        <p class="muted">L'account ${esc(email)} non è autorizzato a usare questa app.</p>
        <button class="btn" id="out">Esci</button></div>`;
      document.getElementById("out").onclick = () => signOut(auth);
      return;
    }
    return renderError(e);
  }
  S.unsub.push(onSnapshot(settingsRef(), s => { S.settings = s.data(); render(); }));
  S.unsub.push(onSnapshot(householdRef(), s => {
    S.household = s.data();
    const order = S.household?.order || Object.keys(S.household?.members || {});
    M1 = order[0] || null; M2 = order[1] || null;
    render();
  }));
  subscribeMonth();
});

function renderLogin() {
  $app.innerHTML = `<div class="login"><h1>💶 Spese</h1>
    <p class="muted">Spese personali e spese di casa condivise.</p>
    <button class="btn primary" id="login" style="width:100%">Accedi con Google</button></div>`;
  document.getElementById("login").onclick = async () => {
    const provider = new GoogleAuthProvider();
    try { await signInWithPopup(auth, provider); }
    catch (e) {
      if (["auth/popup-blocked", "auth/operation-not-supported-in-this-environment"].includes(e.code))
        return signInWithRedirect(auth, provider);
      if (e.code !== "auth/popup-closed-by-user" && e.code !== "auth/cancelled-popup-request")
        toast("Accesso non riuscito: " + e.code);
    }
  };
}

function renderError(e) {
  $app.innerHTML = `<div class="login"><h1>Errore</h1><p class="muted">${esc(e.message || e)}</p>
    <p class="small muted">Controlla di aver pubblicato le regole di Firestore con i vostri indirizzi email.</p>
    <button class="btn" id="out">Esci</button></div>`;
  document.getElementById("out").onclick = () => signOut(auth);
}

async function ensureDocs() {
  const s = await getDoc(settingsRef());
  if (!s.exists()) await setDoc(settingsRef(), { categories: DEFAULT_PERSONAL_CATEGORIES, rules: {} });
  const h = await getDoc(householdRef());
  const first = (S.user.displayName || S.email.split("@")[0]).split(" ")[0];
  if (!h.exists()) {
    await setDoc(householdRef(), {
      categories: DEFAULT_SHARED_CATEGORIES, members: { [S.email]: first }, order: [S.email],
      splitDefault: 50, splitByCategory: {}, rules: {}, fixed: []
    });
  } else {
    const d = h.data();
    if (!(d.order || []).includes(S.email)) await updateDoc(householdRef(), { order: arrayUnion(S.email) });
    if (!d.members?.[S.email]) await setDoc(householdRef(), { members: { [S.email]: first } }, { merge: true });
  }
}

function subscribeMonth() {
  S.unsub.filter(u => u._month).forEach(u => u());
  S.unsub = S.unsub.filter(u => !u._month);
  const u1 = onSnapshot(query(personalCol(), where("month", "==", S.month)), snap => {
    S.personal = snap.docs.map(d => ({ id: d.id, ...d.data() })); render();
  });
  const u2 = onSnapshot(query(sharedCol(), where("month", "==", S.month)), snap => {
    S.shared = snap.docs.map(d => ({ id: d.id, ...d.data() })); render();
  });
  u1._month = u2._month = true;
  S.unsub.push(u1, u2);
}

// ---------- Render principale ----------
function render() {
  if (!S.user || !S.settings || !S.household) return;
  const title = { personali: "Le mie spese", condivise: "Spese di casa", impostazioni: "Impostazioni" }[S.tab];
  const monthNav = S.tab === "impostazioni" ? "" : `<div class="month">
      <button class="icon-btn" data-m="-1">‹</button><span>${monthLabel(S.month)}</span>
      <button class="icon-btn" data-m="1">›</button></div>`;
  let body = "";
  if (S.tab === "personali") body = viewPersonal();
  else if (S.tab === "condivise") body = viewShared();
  else body = viewSettings();
  $app.innerHTML = `<header class="top"><h1>${title}</h1>${monthNav}</header>
    <main>${body}</main>
    <nav class="tabs">
      <button data-tab="personali" class="${S.tab === "personali" ? "on" : ""}"><span class="ico">👤</span>Personali</button>
      <button data-tab="condivise" class="${S.tab === "condivise" ? "on" : ""}"><span class="ico">🏠</span>Condivise</button>
      <button data-tab="impostazioni" class="${S.tab === "impostazioni" ? "on" : ""}"><span class="ico">⚙️</span>Impostazioni</button>
    </nav>`;
  $app.querySelectorAll("[data-tab]").forEach(b => b.onclick = () => { S.tab = b.dataset.tab; render(); window.scrollTo(0, 0); });
  $app.querySelectorAll("[data-m]").forEach(b => b.onclick = () => { S.month = shiftMonth(S.month, +b.dataset.m); subscribeMonth(); render(); });
  bindView();
}

function categoryBars(items, cats) {
  const tot = {};
  items.forEach(x => { tot[x.category] = (tot[x.category] || 0) + x.amount; });
  const rows = Object.entries(tot).sort((a, b) => b[1] - a[1]);
  if (!rows.length) return `<p class="muted small">Nessuna spesa in questo mese.</p>`;
  const max = rows[0][1];
  return rows.map(([c, v]) => `<div class="bar-row"><div class="top"><span>${esc(c)}${cats.includes(c) ? "" : " <span class='muted small'>(eliminata)</span>"}</span><b>${fmt(v)}</b></div>
    <div class="bar"><div style="width:${Math.max(2, v / max * 100)}%"></div></div></div>`).join("");
}

function listHtml(items, kind) {
  if (!items.length) return "";
  const sorted = [...items].sort((a, b) => (b.date || "").localeCompare(a.date || "") || (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
  let out = "", lastDay = "";
  for (const x of sorted) {
    if (x.date !== lastDay) {
      lastDay = x.date;
      const d = new Date(x.date + "T12:00:00");
      out += `<div class="day">${d.toLocaleDateString("it-IT", { weekday: "long", day: "numeric", month: "long" })}</div>`;
    }
    const isIn = x.type === "in";
    const sub = kind === "shared"
      ? `<span class="chip">${esc(x.category)}</span> pagato da ${esc(memberName(x.paidBy))}`
      : `<span class="chip">${esc(isIn ? "Entrata" : x.category)}</span>`;
    out += `<div class="item" data-edit="${kind}:${x.id}"><div class="main"><div class="desc">${esc(x.description)}</div>
      <div class="sub">${sub}</div></div><div class="amt ${isIn ? "pos" : ""}">${isIn ? "+" : "−"}${fmt(x.amount)}</div></div>`;
  }
  return `<div class="card list">${out}</div>`;
}

function viewPersonal() {
  const outs = S.personal.filter(x => x.type !== "in");
  const ins = S.personal.filter(x => x.type === "in");
  const totOut = outs.reduce((a, x) => a + x.amount, 0);
  const totIn = ins.reduce((a, x) => a + x.amount, 0);
  const rest = totIn - totOut;
  return `<div class="card"><div class="stats">
      <div class="stat"><div class="lbl">Entrate</div><div class="val pos">${fmt(totIn)}</div></div>
      <div class="stat"><div class="lbl">Uscite</div><div class="val">${fmt(totOut)}</div></div>
      <div class="stat"><div class="lbl">Rimanenti</div><div class="val ${rest >= 0 ? "pos" : "neg"}">${fmt(rest)}</div></div>
    </div></div>
    <div class="actions"><button class="btn primary" data-act="import-personal">📷 Importa</button>
      <button class="btn" data-act="add-personal">＋ Aggiungi</button></div>
    <div class="card"><h2>Per categoria</h2>${categoryBars(outs, S.settings.categories)}</div>
    ${listHtml(S.personal, "personal")}`;
}

function viewShared() {
  const H = S.household;
  const total = S.shared.reduce((a, x) => a + x.amount, 0);
  const bal = computeBalance(S.shared, H, M1, M2);
  let balTxt = "Siete in pari 👍";
  if (Math.abs(bal.net1) >= 0.01) {
    balTxt = bal.net1 > 0
      ? `${esc(memberName(M2))} deve ${fmt(bal.net1)} a ${esc(memberName(M1))}`
      : `${esc(memberName(M1))} deve ${fmt(-bal.net1)} a ${esc(memberName(M2))}`;
  }
  const fixedMissing = (H.fixed || []).length > 0;
  return `<div class="card"><div class="stats" style="grid-template-columns:1fr 1fr">
      <div class="stat"><div class="lbl">Totale del mese</div><div class="val">${fmt(total)}</div></div>
      <div class="stat"><div class="lbl">Quote</div><div class="small">${esc(memberName(M1))}: <b>${fmt(bal.share1)}</b><br>${esc(memberName(M2))}: <b>${fmt(bal.share2)}</b></div></div>
    </div></div>
    <div class="card"><h2>Saldo del mese</h2><div class="balance">${balTxt}</div>
      <div class="small muted" style="margin-top:4px">Pagato: ${esc(memberName(M1))} ${fmt(bal.paid1)} · ${esc(memberName(M2))} ${fmt(bal.paid2)}</div></div>
    <div class="actions"><button class="btn primary" data-act="import-shared">📷 Importa</button>
      <button class="btn" data-act="add-shared">＋ Aggiungi</button></div>
    ${fixedMissing ? `<div class="actions"><button class="btn" data-act="add-fixed">📌 Aggiungi spese fisse del mese</button></div>` : ""}
    <div class="card"><h2>Per categoria</h2>${categoryBars(S.shared, H.categories)}</div>
    ${listHtml(S.shared, "shared")}`;
}

function catListEditor(cats, scope) {
  return cats.map((c, i) => `<div class="cat-edit"><span>${esc(c)}</span>
    <button data-cat="${scope}:rename:${i}" title="Rinomina">✏️</button>
    ${c === "Altro" ? "" : `<button data-cat="${scope}:delete:${i}" title="Elimina">🗑️</button>`}</div>`).join("") +
    `<button class="btn" style="width:100%;margin-top:10px" data-cat="${scope}:add">＋ Nuova categoria</button>`;
}

function viewSettings() {
  const H = S.household;
  const n1 = memberName(M1), n2 = memberName(M2);
  const catSplits = Object.entries(H.splitByCategory || {});
  return `<div class="card"><h2>Account</h2><div>${esc(S.user.displayName || "")}</div>
      <div class="small muted">${esc(S.email)}</div>
      <button class="btn" style="width:100%;margin-top:10px" data-act="logout">Esci</button></div>
    <div class="card"><h2>Nomi</h2>
      <div class="row"><div class="field"><label>${esc(M1)}</label><input id="n1" value="${esc(n1)}"></div>
      ${M2 ? `<div class="field"><label>${esc(M2)}</label><input id="n2" value="${esc(n2)}"></div>` : `<div class="small muted">Il secondo nome comparirà dopo il primo accesso dell'altra persona.</div>`}</div>
      <button class="btn" style="width:100%" data-act="save-names">Salva nomi</button></div>
    <div class="card"><h2>Divisione spese condivise</h2>
      <div class="field"><label>Quota predefinita di ${esc(n1)} (%) — ${esc(n2)} paga il resto</label>
      <input id="splitDef" type="number" min="0" max="100" step="1" value="${H.splitDefault ?? 50}"></div>
      <button class="btn" style="width:100%" data-act="save-split">Salva quota predefinita</button>
      <p class="small muted" style="margin:12px 0 4px">Quote diverse per categoria:</p>
      ${catSplits.length ? catSplits.map(([c, p]) => `<div class="cat-edit"><span>${esc(c)}: ${esc(n1)} ${p}% · ${esc(n2)} ${100 - p}%</span>
        <button data-act="del-catsplit" data-c="${esc(c)}">🗑️</button></div>`).join("") : `<p class="small muted">Nessuna.</p>`}
      <button class="btn" style="width:100%;margin-top:8px" data-act="add-catsplit">＋ Quota per categoria</button></div>
    <div class="card"><h2>Spese fisse condivise</h2>
      <p class="small muted" style="margin-top:0">Voci da aggiungere ogni mese con un tocco (mutuo, assicurazione…).</p>
      ${(H.fixed || []).map((f, i) => `<div class="cat-edit"><span>${esc(f.description)} · ${fmt(f.amount)}<br><span class="small muted">${esc(f.category)} · paga ${esc(memberName(f.paidBy))}</span></span>
        <button data-act="del-fixed" data-i="${i}">🗑️</button></div>`).join("")}
      <button class="btn" style="width:100%;margin-top:8px" data-act="new-fixed">＋ Nuova spesa fissa</button></div>
    <div class="card"><h2>Categorie personali</h2>${catListEditor(S.settings.categories, "p")}</div>
    <div class="card"><h2>Categorie condivise</h2>${catListEditor(H.categories, "s")}</div>
    <div class="card"><h2>Smistamento appreso</h2>
      <p class="small muted" style="margin-top:0">Quando correggi una categoria, l'app se lo ricorda per le volte successive.</p>
      <div class="small">Personali: ${Object.keys(S.settings.rules || {}).length} regole · Condivise: ${Object.keys(H.rules || {}).length} regole</div>
      <button class="btn danger" style="width:100%;margin-top:8px" data-act="reset-rules">Azzera regole apprese</button></div>`;
}

// ---------- Eventi ----------
function bindView() {
  $app.querySelectorAll("[data-act]").forEach(b => b.onclick = () => ACT[b.dataset.act]?.(b));
  $app.querySelectorAll("[data-edit]").forEach(b => b.onclick = () => {
    const [kind, id] = b.dataset.edit.split(":");
    const list = kind === "shared" ? S.shared : S.personal;
    openEditor(kind, list.find(x => x.id === id));
  });
  $app.querySelectorAll("[data-cat]").forEach(b => b.onclick = () => catAction(b.dataset.cat));
}

const ACT = {
  "add-personal": () => openEditor("personal", null),
  "add-shared": () => openEditor("shared", null),
  "import-personal": () => openImport("personal"),
  "import-shared": () => openImport("shared"),
  "add-fixed": addFixedForMonth,
  logout: () => signOut(auth),
  "save-names": async () => {
    const members = { [M1]: document.getElementById("n1").value.trim() || memberName(M1) };
    if (M2) members[M2] = document.getElementById("n2").value.trim() || memberName(M2);
    await setDoc(householdRef(), { members }, { merge: true });
    toast("Nomi salvati");
  },
  "save-split": async () => {
    const v = clampPct(document.getElementById("splitDef").value);
    await updateDoc(householdRef(), { splitDefault: v }); toast("Quota salvata");
  },
  "add-catsplit": () => {
    const H = S.household;
    openSheet(`<h3>Quota per categoria</h3>
      <div class="field"><label>Categoria</label><select id="cs-c">${H.categories.map(c => `<option>${esc(c)}</option>`).join("")}</select></div>
      <div class="field"><label>Quota di ${esc(memberName(M1))} (%)</label><input id="cs-p" type="number" min="0" max="100" value="50"></div>
      <div class="row"><button class="btn" data-x="close">Annulla</button><button class="btn primary" data-x="ok">Salva</button></div>`, {
      ok: async () => {
        const c = val("cs-c"), p = clampPct(val("cs-p"));
        await setDoc(householdRef(), { splitByCategory: { [c]: p } }, { merge: true });
        closeSheet(); toast("Salvato");
      }
    });
  },
  "del-catsplit": async b => {
    const m = { ...(S.household.splitByCategory || {}) }; delete m[b.dataset.c];
    await updateDoc(householdRef(), { splitByCategory: m });
  },
  "new-fixed": () => {
    const H = S.household;
    openSheet(`<h3>Nuova spesa fissa</h3>
      <div class="field"><label>Descrizione</label><input id="f-d" placeholder="es. Rata mutuo"></div>
      <div class="field"><label>Importo (€)</label><input id="f-a" type="number" inputmode="decimal" step="0.01"></div>
      <div class="field"><label>Categoria</label><select id="f-c">${H.categories.map(c => `<option>${esc(c)}</option>`).join("")}</select></div>
      <div class="field"><label>Chi paga di solito</label><select id="f-p">${payerOptions(S.email)}</select></div>
      <div class="row"><button class="btn" data-x="close">Annulla</button><button class="btn primary" data-x="ok">Salva</button></div>`, {
      ok: async () => {
        const amount = parseAmount(val("f-a")), description = val("f-d").trim();
        if (!description || !amount) return toast("Inserisci descrizione e importo");
        const fixed = [...(S.household.fixed || []), { description, amount, category: val("f-c"), paidBy: val("f-p") }];
        await updateDoc(householdRef(), { fixed }); closeSheet(); toast("Spesa fissa aggiunta");
      }
    });
  },
  "del-fixed": async b => {
    const fixed = [...(S.household.fixed || [])]; fixed.splice(+b.dataset.i, 1);
    await updateDoc(householdRef(), { fixed });
  },
  "reset-rules": async () => {
    if (!confirm("Azzerare tutte le regole di smistamento apprese?")) return;
    await updateDoc(settingsRef(), { rules: {} });
    await updateDoc(householdRef(), { rules: {} });
    toast("Regole azzerate");
  }
};

const val = id => document.getElementById(id).value;
const clampPct = v => Math.min(100, Math.max(0, Math.round(+v || 0)));
const parseAmount = v => Math.round(Math.abs(parseFloat(String(v).replace(",", "."))) * 100) / 100 || 0;
const payerOptions = sel => [M1, M2].filter(Boolean).map(e => `<option value="${esc(e)}" ${e === sel ? "selected" : ""}>${esc(memberName(e))}</option>`).join("");

async function addFixedForMonth() {
  const fixed = S.household.fixed || [];
  const existing = new Set(S.shared.filter(x => x.fixedKey).map(x => x.fixedKey));
  const toAdd = fixed.filter(f => !existing.has(normKey(f.description)));
  if (!toAdd.length) return toast("Le spese fisse di questo mese ci sono già");
  const batch = writeBatch(db);
  const date = S.month === currentMonth() ? today() : S.month + "-01";
  toAdd.forEach(f => batch.set(doc(sharedCol()), {
    description: f.description, amount: f.amount, category: f.category, paidBy: f.paidBy,
    date, month: S.month, fixedKey: normKey(f.description), createdBy: S.email, createdAt: serverTimestamp()
  }));
  await batch.commit();
  toast(`Aggiunte ${toAdd.length} spese fisse`);
}

// ---------- Categorie ----------
async function catAction(code) {
  const [scope, op, idx] = code.split(":");
  const isShared = scope === "s";
  const ref = isShared ? householdRef() : settingsRef();
  const col = isShared ? sharedCol() : personalCol();
  const cats = [...(isShared ? S.household.categories : S.settings.categories)];
  if (op === "add") {
    const name = prompt("Nome della nuova categoria")?.trim();
    if (!name) return;
    if (cats.includes(name)) return toast("Esiste già");
    cats.splice(Math.max(0, cats.indexOf("Altro")), 0, name);
    await updateDoc(ref, { categories: cats }); return toast("Categoria aggiunta");
  }
  const old = cats[+idx];
  if (op === "rename") {
    const name = prompt("Nuovo nome", old)?.trim();
    if (!name || name === old) return;
    if (cats.includes(name)) return toast("Esiste già");
    cats[+idx] = name;
    await updateDoc(ref, { categories: cats });
    await recategorize(col, old, name, ref, isShared);
    return toast("Categoria rinominata");
  }
  if (op === "delete") {
    if (!confirm(`Eliminare "${old}"? Le spese già registrate passeranno in "Altro".`)) return;
    cats.splice(+idx, 1);
    if (!cats.includes("Altro")) cats.push("Altro");
    await updateDoc(ref, { categories: cats });
    await recategorize(col, old, "Altro", ref, isShared);
    toast("Categoria eliminata");
  }
}

async function recategorize(col, from, to, ref, isShared) {
  const snap = await getDocs(query(col, where("category", "==", from)));
  let batch = writeBatch(db), n = 0;
  for (const d of snap.docs) {
    batch.update(d.ref, { category: to });
    if (++n % 400 === 0) { await batch.commit(); batch = writeBatch(db); }
  }
  await batch.commit();
  const src = isShared ? S.household : S.settings;
  const rules = { ...(src.rules || {}) };
  let changed = false;
  for (const k in rules) if (rules[k] === from) { rules[k] = to; changed = true; }
  const extra = {};
  if (isShared && S.household.splitByCategory?.[from] !== undefined) {
    const m = { ...S.household.splitByCategory }; m[to] = m[from]; delete m[from]; extra.splitByCategory = m;
  }
  if (isShared && (S.household.fixed || []).some(f => f.category === from)) {
    extra.fixed = S.household.fixed.map(f => f.category === from ? { ...f, category: to } : f);
  }
  if (changed || Object.keys(extra).length) await updateDoc(ref, { ...(changed ? { rules } : {}), ...extra });
}

// ---------- Bottom sheet ----------
function openSheet(html, handlers = {}) {
  const sh = document.getElementById("sheet"), bd = document.getElementById("sheet-backdrop");
  sh.innerHTML = html; sh.classList.remove("hidden"); bd.classList.remove("hidden");
  bd.onclick = closeSheet;
  sh.querySelectorAll("[data-x]").forEach(b => b.onclick = () => b.dataset.x === "close" ? closeSheet() : handlers[b.dataset.x]?.(b));
  return sh;
}
function closeSheet() {
  document.getElementById("sheet").classList.add("hidden");
  document.getElementById("sheet-backdrop").classList.add("hidden");
}

// ---------- Aggiungi / modifica ----------
function openEditor(kind, item) {
  const shared = kind === "shared";
  const cats = shared ? S.household.categories : S.settings.categories;
  const x = item || { date: S.month === currentMonth() ? today() : S.month + "-01", type: "out", category: cats[0], paidBy: S.email };
  let type = x.type || "out";
  const catOpts = c => [...new Set([...cats, c])].map(k => `<option ${k === c ? "selected" : ""}>${esc(k)}</option>`).join("");
  const splitVal = x.split ?? "";
  const sh = openSheet(`<h3>${item ? "Modifica" : "Nuova"} ${shared ? "spesa condivisa" : "voce"}</h3>
    ${shared ? "" : `<div class="seg"><button data-t="out" class="${type === "out" ? "on" : ""}">Uscita</button><button data-t="in" class="${type === "in" ? "on" : ""}">Entrata</button></div>`}
    <div class="field"><label>Descrizione</label><input id="e-d" value="${esc(x.description || "")}" placeholder="es. Esselunga"></div>
    <div class="row"><div class="field"><label>Importo (€)</label><input id="e-a" type="number" inputmode="decimal" step="0.01" value="${x.amount ?? ""}"></div>
    <div class="field"><label>Data</label><input id="e-dt" type="date" value="${esc(x.date)}"></div></div>
    <div class="field" id="e-cat-wrap"><label>Categoria</label><select id="e-c">${catOpts(x.category)}</select></div>
    ${shared ? `<div class="field"><label>Pagato da</label><select id="e-p">${payerOptions(x.paidBy)}</select></div>
      <div class="field"><label>Quota di ${esc(memberName(M1))} (%) — vuoto = quota normale</label>
      <input id="e-s" type="number" min="0" max="100" value="${splitVal}" placeholder="${computeShare({ category: x.category }, S.household)}"></div>` : ""}
    <div class="row">${item ? `<button class="btn danger" data-x="del">Elimina</button>` : `<button class="btn" data-x="close">Annulla</button>`}
      <button class="btn primary" data-x="save">Salva</button></div>`, {
    del: async () => {
      if (!confirm("Eliminare questa voce?")) return;
      await deleteDoc(doc(shared ? sharedCol() : personalCol(), item.id)); closeSheet(); toast("Eliminata");
    },
    save: async () => {
      const description = val("e-d").trim(), amount = parseAmount(val("e-a")), date = val("e-dt");
      if (!description || !amount || !date) return toast("Compila descrizione, importo e data");
      const data = { description, amount, date, month: date.slice(0, 7), category: type === "in" ? "Entrate" : val("e-c") };
      if (!shared) data.type = type;
      if (shared) {
        data.paidBy = val("e-p");
        const s = val("e-s"); data.split = s === "" ? null : clampPct(s);
      }
      if (item) await updateDoc(doc(shared ? sharedCol() : personalCol(), item.id), data);
      else await addDoc(shared ? sharedCol() : personalCol(), { ...data, createdBy: S.email, createdAt: serverTimestamp() });
      if (type !== "in" && (!item || item.category !== data.category)) await learnRules(shared, [{ description, category: data.category }]);
      closeSheet(); toast("Salvato");
      if (data.month !== S.month) toast("Salvato in " + monthLabel(data.month));
    }
  });
  sh.querySelectorAll("[data-t]").forEach(b => b.onclick = () => {
    type = b.dataset.t;
    sh.querySelectorAll("[data-t]").forEach(o => o.classList.toggle("on", o === b));
    document.getElementById("e-cat-wrap").classList.toggle("hidden", type === "in");
  });
  if (type === "in") document.getElementById("e-cat-wrap").classList.add("hidden");
}

async function learnRules(shared, entries) {
  const src = shared ? S.household : S.settings;
  const rules = {};
  for (const e of entries) {
    const k = normKey(e.description);
    if (k && src.rules?.[k] !== e.category) rules[k] = e.category;
  }
  if (Object.keys(rules).length) await setDoc(shared ? householdRef() : settingsRef(), { rules }, { merge: true });
}

// ---------- Import con AI ----------
function openImport(kind) {
  const shared = kind === "shared";
  const sh = openSheet(`<h3>Importa movimenti</h3>
    <p class="small muted" style="margin-top:0">Carica uno o più screenshot della banca, oppure incolla il testo dei movimenti.</p>
    <div class="field"><label>Screenshot</label><input id="i-f" type="file" accept="image/*" multiple></div>
    <div class="field"><label>Oppure incolla il testo</label><textarea id="i-t" placeholder="12/11 POS ESSELUNGA MACERATA -45,20&#10;13/11 BONIFICO DA … +1.500,00"></textarea></div>
    <p class="small muted">Prima di inviarlo all'AI, cancella dal testo IBAN e numeri di carta: servono solo data, descrizione e importo.</p>
    <div class="row"><button class="btn" data-x="close">Annulla</button><button class="btn primary" data-x="go">Analizza</button></div>`, {
    go: async b => {
      const files = [...document.getElementById("i-f").files];
      const text = val("i-t").trim();
      if (!files.length && !text) return toast("Carica uno screenshot o incolla del testo");
      b.disabled = true; b.innerHTML = `<span class="spinner"></span>Analizzo…`;
      try {
        const items = await extractWithAI(shared, files, text);
        if (!items.length) { toast("Nessun movimento trovato"); b.disabled = false; b.textContent = "Analizza"; return; }
        openReview(shared, items);
      } catch (e) {
        console.error(e);
        b.disabled = false; b.textContent = "Analizza";
        showAiError(e);
      }
    }
  });
  return sh;
}

async function fileToPart(file) {
  const img = await createImageBitmap(file);
  const scale = Math.min(1, 1600 / Math.max(img.width, img.height));
  const c = document.createElement("canvas");
  c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale);
  c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
  const data = c.toDataURL("image/jpeg", 0.85).split(",")[1];
  return { inlineData: { data, mimeType: "image/jpeg" } };
}

const AI_SCHEMA = {
  type: "object",
  properties: {
    movimenti: {
      type: "array",
      items: {
        type: "object",
        properties: {
          data: { type: "string", description: "YYYY-MM-DD" },
          descrizione: { type: "string" },
          importo: { type: "number" },
          tipo: { type: "string", enum: ["uscita", "entrata"] },
          categoria: { type: "string" }
        },
        required: ["data", "descrizione", "importo", "tipo", "categoria"]
      }
    }
  },
  required: ["movimenti"]
};

async function extractWithAI(shared, files, text) {
  const cats = shared ? S.household.categories : S.settings.categories;
  const rules = (shared ? S.household.rules : S.settings.rules) || {};
  const ruleLines = Object.entries(rules).slice(0, 200).map(([k, v]) => `- "${k}" → ${v}`).join("\n");
  const prompt = `Sei un assistente che legge movimenti bancari italiani (screenshot dell'app della banca o testo copiato).
Estrai OGNI singolo movimento. Per ciascuno restituisci:
- data in formato YYYY-MM-DD (se manca l'anno usa ${S.month.slice(0, 4)}; se manca del tutto usa ${today()})
- descrizione: nome dell'esercente o causale, breve e leggibile (es. "Esselunga Macerata", "Netflix", "Bonifico da Mario Rossi"). Non includere IBAN, numeri di carta o codici.
- importo: numero positivo in euro (usa il punto come separatore decimale)
- tipo: "uscita" per pagamenti/addebiti, "entrata" per accrediti/stipendi/rimborsi
- categoria: scegli SOLO tra queste: ${cats.join(", ")}. Per le entrate scrivi "Entrate". Se non sei sicuro usa "Altro".
${ruleLines ? `Preferenze dell'utente da rispettare (parole della descrizione → categoria):\n${ruleLines}\n` : ""}Ignora saldi, totali, intestazioni, pubblicità e movimenti "in attesa" duplicati. Se non trovi movimenti restituisci una lista vuota.`;
  const parts = [prompt];
  if (text) parts.push("TESTO DEI MOVIMENTI:\n" + text);
  for (const f of files) parts.push(await fileToPart(f));

  const errors = [];
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  for (const name of AI_MODELS) for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const model = getGenerativeModel(ai, {
        model: name,
        generationConfig: { responseMimeType: "application/json", responseJsonSchema: AI_SCHEMA, temperature: 0 }
      });
      const res = await model.generateContent(parts);
      const json = JSON.parse(res.response.text());
      return (json.movimenti || []).map(m => {
        const tipo = m.tipo === "entrata" ? "in" : "out";
        const key = normKey(m.descrizione);
        let cat = rules[key] || m.categoria;
        if (tipo === "out" && !cats.includes(cat)) cat = "Altro";
        return {
          date: /^\d{4}-\d{2}-\d{2}$/.test(m.data) ? m.data : today(),
          description: m.descrizione, amount: Math.round(Math.abs(+m.importo) * 100) / 100,
          type: tipo, category: tipo === "in" ? "Entrate" : cat, aiCategory: cat
        };
      }).filter(m => m.amount > 0);
    } catch (e) {
      console.warn("Modello", name, "non riuscito:", e);
      const msg = String(e?.message || e);
      errors.push(`${name}: ${msg.replace(/^.*?\[/, "[")}`);
      // Sovraccarico o limite momentaneo: riprova lo stesso modello dopo una pausa, poi passa al successivo.
      if (attempt === 0 && /\[(500|503|429)/.test(msg)) { await sleep(2500); continue; }
      break;
    }
  }
  throw new Error(errors.join("\n\n"));
}

function openReview(shared, items) {
  const cats = shared ? S.household.categories : S.settings.categories;
  // Nelle spese condivise le entrate non hanno senso: deselezionate di default.
  items.forEach(it => { it.on = !(it.type === "in" && shared); });
  const html = items.map((it, i) => `<div class="review-item">
      <div class="head"><input type="checkbox" data-i="${i}" ${it.on ? "checked" : ""}>
        <div class="d"><div class="desc">${esc(it.description)}</div><div class="small muted">${esc(it.date)}${it.type === "in" ? " · entrata" : ""}</div></div>
        <b class="${it.type === "in" ? "pos" : ""}">${it.type === "in" ? "+" : "−"}${fmt(it.amount)}</b></div>
      ${it.type === "in" ? "" : `<select data-c="${i}">${cats.map(c => `<option ${c === it.category ? "selected" : ""}>${esc(c)}</option>`).join("")}</select>`}
    </div>`).join("");
  const sh = openSheet(`<h3>Controlla e conferma</h3>
    <p class="small muted" style="margin-top:0">Togli la spunta a quello che non vuoi salvare e correggi le categorie se serve.</p>
    ${shared ? `<div class="field"><label>Pagato da</label><select id="r-p">${payerOptions(S.email)}</select></div>` : ""}
    ${html}
    <div class="row" style="margin-top:12px"><button class="btn" data-x="close">Annulla</button>
    <button class="btn primary" data-x="save">Salva ${items.filter(x => x.on).length} voci</button></div>`, {
    save: async b => {
      const chosen = items.filter(x => x.on);
      if (!chosen.length) return toast("Nessuna voce selezionata");
      b.disabled = true;
      const paidBy = shared ? val("r-p") : null;
      const col = shared ? sharedCol() : personalCol();
      let batch = writeBatch(db), n = 0;
      for (const it of chosen) {
        const data = { description: it.description, amount: it.amount, date: it.date, month: it.date.slice(0, 7),
          category: it.category, createdBy: S.email, createdAt: serverTimestamp(), source: "ai" };
        if (shared) { data.paidBy = paidBy; data.split = null; } else data.type = it.type;
        batch.set(doc(col), data);
        if (++n % 400 === 0) { await batch.commit(); batch = writeBatch(db); }
      }
      await batch.commit();
      const corrected = chosen.filter(it => it.type !== "in" && it.category !== it.aiCategory);
      await learnRules(shared, corrected);
      closeSheet();
      const other = chosen.filter(it => it.date.slice(0, 7) !== S.month).length;
      toast(`Salvate ${chosen.length} voci` + (other ? ` (${other} in altri mesi)` : ""), 3500);
    }
  });
  const saveBtn = sh.querySelector('[data-x="save"]');
  sh.querySelectorAll("input[data-i]").forEach(cb => cb.onchange = () => {
    items[+cb.dataset.i].on = cb.checked;
    saveBtn.textContent = `Salva ${items.filter(x => x.on).length} voci`;
  });
  sh.querySelectorAll("select[data-c]").forEach(s => s.onchange = () => { items[+s.dataset.c].category = s.value; });
}

function showAiError(e) {
  const msg = String(e?.message || e);
  let hint = "Fai uno screenshot di questo messaggio e mandalo a chi ti ha preparato l'app.";
  if (/high demand|\[50[03]/i.test(msg) && !/\[(403|404)/.test(msg))
    hint = "I server di Gemini sono sovraccarichi in questo momento. Riprova tra qualche minuto.";
  else if (/403|PERMISSION_DENIED|not been used|disabled|SERVICE_DISABLED|API_DISABLED/i.test(msg))
    hint = "Sembra che Firebase AI Logic (Gemini Developer API) non sia ancora attivo: console Firebase → AI Logic → Inizia → Gemini Developer API.";
  else if (/429|RESOURCE_EXHAUSTED|quota/i.test(msg))
    hint = "Limite gratuito raggiunto per ora: riprova tra qualche minuto.";
  else if (/404|not found/i.test(msg))
    hint = "Il modello AI indicato non è disponibile: va aggiornato in config.js.";
  openSheet(`<h3>Errore AI</h3><p>${esc(hint)}</p>
    <div class="field"><label>Dettagli</label><textarea readonly style="min-height:180px;font-size:13px">${esc(msg)}</textarea></div>
    <button class="btn" style="width:100%" data-x="close">Chiudi</button>`);
}
