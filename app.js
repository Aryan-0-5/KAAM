import { diff, isEmpty } from "./diff.js";

const VERSION = "31 Oct · 4";

// ================= helpers =================
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const clone = (v) => JSON.parse(JSON.stringify(v));
const rid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-3);
const store = {
  get(k, d) { try { const v = localStorage.getItem("kaam." + k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem("kaam." + k, JSON.stringify(v)); } catch {} },
  del(k) { try { localStorage.removeItem("kaam." + k); } catch {} },
};

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const today = () => new Date().toLocaleDateString("en-CA");
const localDate = (iso) => (iso ? new Date(iso).toLocaleDateString("en-CA") : "");
const dayDiff = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 864e5);
const addDays = (d, n) => { const x = new Date(d + "T00:00:00"); x.setDate(x.getDate() + n); return x.toLocaleDateString("en-CA"); };
function fmtD(s) {
  if (!s) return "";
  const d = new Date(s.length === 10 ? s + "T00:00:00" : s);
  return `${d.getDate()} ${MON[d.getMonth()]}${d.getFullYear() !== new Date().getFullYear() ? " " + d.getFullYear() : ""}`;
}
function fmtTime(iso) {
  const d = new Date(iso);
  let h = d.getHours(), m = String(d.getMinutes()).padStart(2, "0");
  const ap = h >= 12 ? "pm" : "am"; h = h % 12 || 12;
  return `${h}:${m} ${ap}`;
}
function ago(d) {
  const n = dayDiff(d, today());
  if (n <= 0) return "today";
  if (n === 1) return "yesterday";
  return `${n} days ago`;
}
function until(d) {
  const n = dayDiff(today(), d);
  if (n < -1) return `${-n} days late`;
  if (n === -1) return "1 day late";
  if (n === 0) return "today";
  if (n === 1) return "tomorrow";
  return `in ${n} days`;
}
const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;

const ICON = {
  check: '<path d="M4 12.5l5 5L20 6.5"/>',
  list: '<path d="M8 6h12M8 12h12M8 18h12"/><circle cx="4" cy="6" r=".6"/><circle cx="4" cy="12" r=".6"/><circle cx="4" cy="18" r=".6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  box: '<path d="M4 7h16v13H4zM3 4h18v3H3zM10 11h4"/>',
  more: '<circle cx="5" cy="12" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="19" cy="12" r="1.2"/>',
  back: '<path d="M15 5l-7 7 7 7"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  clip: '<path d="M20 11.5l-7.8 7.8a5 5 0 01-7.1-7.1l8.2-8.2a3.4 3.4 0 014.8 4.8l-8.2 8.2a1.7 1.7 0 01-2.4-2.4l7.6-7.6"/>',
  camera: '<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>',
  lock: '<rect x="5" y="11" width="14" height="9" rx="1.5"/><path d="M8 11V8a4 4 0 018 0v3"/>',
  doc: '<path d="M6 3h8l5 5v13H6z"/><path d="M14 3v5h5M9 13h7M9 17h7"/>',
  filter: '<path d="M4 6h16M7 12h10M10 18h4"/>',
  grid: '<rect x="4" y="4" width="7" height="7" rx="1"/><rect x="13" y="4" width="7" height="7" rx="1"/><rect x="4" y="13" width="7" height="7" rx="1"/><rect x="13" y="13" width="7" height="7" rx="1"/>',
};
const ico = (n) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[n]}</svg>`;
const LOGO = `<svg viewBox="0 0 100 100" aria-hidden="true"><rect width="100" height="100" rx="23" fill="#F2ECE0"/><g transform="translate(2.5 2.5) scale(.95)"><polygon points="17,24 31,24 31,76 17,76" fill="#173A5E"/><polygon points="28,53 53,24 71,24 39,60" fill="#173A5E"/><polygon points="36,47 72,76 54,76 28,55" fill="#173A5E"/><polygon points="75,64 87,64 87,76 75,76" fill="#E2A02B"/></g></svg>`;

const STATUS = [
  ["todo", "To do"], ["progress", "In progress"], ["waiting", "Waiting"], ["done", "Done"], ["dropped", "Dropped"], ["other", "Other"],
];
const statusLabel = (t) => (t.status === "other" ? t.statusText || "Other" : (STATUS.find((s) => s[0] === t.status) || STATUS[0])[1]);
const stamp = (t, big) => `<span class="stamp st-${esc(t.status || "todo")}${big ? " big" : ""}">${esc(statusLabel(t))}</span>`;
const isOpen = (t) => t.status !== "done" && t.status !== "dropped";
const PRI = { high: "High", normal: "Normal", low: "Low" };
const priRank = { high: 0, normal: 1, low: 2 };

// ================= state =================
const S = {
  token: store.get("token", null),
  me: store.get("me", null),
  people: [], categories: [], forNames: [], tasks: [], rev: 0, win: 0,
  loaded: false, saving: 0, saveSeq: 0, offline: false,
};
const person = (id) => S.people.find((p) => p.id === id);
const family = () => S.people.filter((p) => !p.admin);
const pname = (id) => person(id)?.name || "Former member";
const meP = () => person(S.me) || { id: S.me, name: "", admin: false };
const initials = (n) => (n || "?").trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase();
const avatar = (id, lg) => { const p = person(id); return `<span class="avatar${lg ? " lg" : ""}" style="background:${p?.color || "#56626D"}">${esc(initials(p?.name || "?"))}</span>`; };
const taskById = (id) => S.tasks.find((t) => t.id === id);
const namesList = (ids) => (ids || []).map(pname).join(", ");

function lastAction(t) {
  const ds = (t.entries || []).map((e) => e.date).filter(Boolean).sort();
  return ds.length ? ds[ds.length - 1] : localDate(t.createdAt) || today();
}
function latestEntry(t) {
  return [...(t.entries || [])].sort((a, b) => (a.date + a.at < b.date + b.at ? 1 : -1))[0];
}
function reqCounts(t) {
  const r = t.reqs || [];
  return { total: r.length, given: r.filter((x) => x.state === "given").length, have: r.filter((x) => x.state === "have").length, need: r.filter((x) => x.state !== "given" && x.state !== "have").length };
}
function allFiles(t) {
  const out = (t.files || []).map((f) => ({ f, from: "General" }));
  for (const e of t.entries || []) for (const f of e.files || []) out.push({ f, from: `Update, ${fmtD(e.date)}` });
  for (const r of t.reqs || []) for (const f of r.files || []) out.push({ f, from: r.text });
  return out;
}

// ================= server =================
async function api(path, opts = {}) {
  const headers = { ...(opts.headers || {}) };
  if (S.token) headers["x-kaam-token"] = S.token;
  if (opts.json !== undefined) { headers["Content-Type"] = "application/json"; opts.body = JSON.stringify(opts.json); }
  let r;
  try { r = await fetch(path, { method: opts.method || (opts.body ? "POST" : "GET"), headers, body: opts.body }); }
  catch { throw new Error("No internet connection. Check your network and try again."); }
  let j = {};
  try { j = await r.json(); } catch {}
  if (r.status === 401 && path !== "/api/auth") { signOut(); throw new Error(j.error || "Please sign in again."); }
  if (!r.ok) throw new Error(j.error || `Server error (${r.status}). Try again.`);
  return j;
}

function absorb(j) {
  S.rev = j.rev; S.win = j.win; S.people = j.people; S.categories = j.categories || []; S.forNames = j.forNames || [];
  S.tasks = j.tasks || []; S.me = j.me; S.files = j.files || {}; S.drive = j.drive || {}; S.folders = j.folders || {}; S.loaded = true;
}

async function refresh(force) {
  if (!S.token) return;
  const seq = S.saveSeq;
  try {
    const q = force || !S.loaded ? "" : `?since=${S.rev}&win=${S.win}`;
    const j = await api("/api/data" + q);
    S.offline = false;
    if (S.saving || seq !== S.saveSeq) return; // a save started meanwhile; its result wins
    if (j.same) return syncBadge();
    absorb(j);
    if (!$(".overlay")) render(); else S.pendingRender = true;
  } catch (e) {
    S.offline = true;
    if (!S.loaded) renderError(e.message);
  }
  syncBadge();
}

function syncBadge() {
  const el = $("#sync");
  if (!el) return;
  if (S.saving) { el.textContent = "Saving…"; el.className = "sync"; }
  else if (S.offline) { el.textContent = "Offline"; el.className = "sync bad"; }
  else el.textContent = "";
}

// Change a task: edit a copy, send only what changed, show it straight away.
async function commit(taskId, mutate, summary) {
  const cur = taskById(taskId);
  if (!cur) return;
  const next = clone(cur);
  mutate(next);
  const d = diff(cur, next);
  if (isEmpty(d)) return;
  const i = S.tasks.indexOf(cur);
  S.tasks[i] = next;
  S.saving++; S.saveSeq++; syncBadge(); render();
  try {
    const j = await api("/api/data", { json: { op: "change", taskId, diff: d, summary } });
    const k = S.tasks.findIndex((t) => t.id === taskId);
    if (j.task && k >= 0) S.tasks[k] = j.task;
    Object.assign(S.files, j.files || {});
    if (j.folder) S.folders[taskId] = j.folder;
    S.rev = j.rev;
  } catch (e) {
    const k = S.tasks.findIndex((t) => t.id === taskId);
    if (k >= 0) S.tasks[k] = cur;
    toast(e.message, true);
  } finally {
    S.saving--; syncBadge(); render();
  }
}

async function post(json) {
  S.saving++; S.saveSeq++; syncBadge();
  try { const j = await api("/api/data", { json }); return j; }
  finally { S.saving--; syncBadge(); }
}

// ================= files =================
async function shrinkImage(file) {
  if (!/^image\/(jpeg|png|webp|heic|heif)$/i.test(file.type)) return file;
  try {
    const bmp = await createImageBitmap(file);
    const max = 2000, k = Math.min(1, max / Math.max(bmp.width, bmp.height));
    const c = document.createElement("canvas");
    c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
    c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height);
    const blob = await new Promise((res) => c.toBlob(res, "image/jpeg", 0.82));
    if (!blob || blob.size >= file.size) return file;
    const name = file.name.replace(/\.(png|webp|heic|heif|jpe?g)$/i, "") + ".jpg";
    return new File([blob], name, { type: "image/jpeg" });
  } catch { return file; }
}

// Send a file to Google Drive: straight from the phone if possible, otherwise through Kaam (up to 4 MB).
async function uploadFile(file, taskId) {
  const f = await shrinkImage(file);
  const name = f.name || (f.type.startsWith("image/") ? `Photo ${fmtD(today())}.jpg` : "File");
  const type = f.type || "application/octet-stream";
  const st = await api("/api/upload", { json: { action: "start", task: taskId, name, type, size: f.size } });
  if (st.session) {
    let driveId = null, sent = false;
    try {
      const r = await fetch(st.session, { method: "PUT", body: f, headers: { "Content-Type": type } });
      if (r.ok) { sent = true; driveId = (await r.json().catch(() => ({}))).id || null; }
    } catch {}
    try { return (await api("/api/upload", { json: { action: "finish", id: st.id, driveId } })).file; }
    catch (e) { if (sent) throw e; }
  }
  if (f.size > st.relayMax) throw new Error(`"${name}" couldn't go to Google Drive directly, and it's too big to send another way (over 4 MB). Try again on Wi-Fi, or take photos of the pages.`);
  const j = await api(`/api/upload?action=relay&id=${encodeURIComponent(st.id)}`, { method: "POST", body: f, headers: { "Content-Type": "application/octet-stream" } });
  return j.file;
}

const fmeta = (ref) => (S.files && S.files[ref.id]) || null;
const fname = (ref) => fmeta(ref)?.name || ref.name || "File";
const ftype = (ref) => fmeta(ref)?.type || ref.type || "";

function fileChip(ref, opts = {}) {
  const isImg = ftype(ref).startsWith("image/");
  const thumb = opts.preview ? `<img src="${esc(opts.preview)}" alt="">` : `<span class="ficon">${ico(isImg ? "camera" : "doc")}</span>`;
  if (opts.uploading) return `<span class="file up">${thumb}<span class="fname">Uploading ${esc(opts.label || "")}…</span></span>`;
  if (opts.remove) return `<span class="file">${thumb}<span class="fname">${esc(fname(ref))}</span><button type="button" class="rm" data-rm="${esc(ref.id)}" aria-label="Remove ${esc(fname(ref))}">Remove</button></span>`;
  return `<a class="file" href="#/file/${esc(ref.id)}">${thumb}<span class="fname">${esc(fname(ref))}</span></a>`;
}
const fileChips = (files) => (files && files.length ? `<div class="files">${files.map((f) => fileChip(f)).join("")}</div>` : "");

// A small file picker used inside forms: photo, any file, list with remove.
function filePicker(host, taskId, initial = []) {
  const st = { files: [...initial], busy: 0 };
  const fresh = new Set(), previews = {};
  let kept = initial.map((f) => f.id); // what the form saved; anything else uploaded here gets tidied away
  const sh = host.closest(".sheet");
  if (sh) (sh.__cleanups ||= []).push(() => {
    const ids = [...fresh].filter((id) => !kept.includes(id));
    if (ids.length) api("/api/upload", { json: { action: "discard", ids } }).catch(() => {});
  });
  if (!S.drive?.connected) {
    host.innerHTML = `<p class="muted small" style="margin:0">Google Drive isn't connected yet, so files can't be attached. ${meP().admin ? "Connect it in your profile (the round button at the top right)." : "Ask the admin to connect it."}</p>`;
    return { get files() { return st.files; }, get busy() { return false; } };
  }
  host.innerHTML = `
    <div class="chips">
      <label class="btn quiet small">${ico("camera")} Take photo<input type="file" accept="image/*" capture="environment" hidden data-in></label>
      <label class="btn quiet small">${ico("clip")} Attach file<input type="file" accept="image/*,application/pdf,.pdf,.doc,.docx,.xls,.xlsx" multiple hidden data-in></label>
    </div>
    <div class="files" data-list></div>`;
  const list = $("[data-list]", host);
  const pending = [];
  const draw = () => {
    list.innerHTML = st.files.map((f) => fileChip(f, { remove: true, preview: previews[f.id] })).join("") +
      pending.map((p) => fileChip({ id: "", name: p }, { uploading: true, label: p })).join("");
  };
  list.addEventListener("click", (e) => {
    const b = e.target.closest("[data-rm]");
    if (b) { st.files = st.files.filter((f) => f.id !== b.dataset.rm); draw(); }
  });
  $$("[data-in]", host).forEach((inp) => inp.addEventListener("change", async () => {
    const chosen = [...inp.files]; inp.value = "";
    for (const file of chosen) {
      pending.push(file.name); st.busy++; draw();
      try {
        const ref = await uploadFile(file, taskId);
        if ((file.type || "").startsWith("image/")) previews[ref.id] = URL.createObjectURL(file);
        fresh.add(ref.id);
        st.files.push(ref);
      } catch (e) { toast(e.message, true); }
      pending.splice(pending.indexOf(file.name), 1); st.busy--; draw();
    }
  }));
  draw();
  return {
    // Reading the list means the form is saving it.
    get files() { kept = st.files.map((f) => f.id); return st.files.map((f) => ({ ...f })); },
    get busy() { return st.busy > 0; },
  };
}

// ================= UI plumbing =================
let toastTimer;
function toast(msg, bad, action) {
  const el = $("#toast");
  el.innerHTML = esc(msg) + (action ? ` <button type="button">${esc(action.label)}</button>` : "");
  el.className = "show" + (bad ? " bad" : "");
  if (action) $("button", el).onclick = () => { el.className = ""; action.run(); };
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.className = ""), bad ? 6000 : action ? 6000 : 2400);
}

const openSheets = new Set();
function sheet({ title, body, foot, onMount, onClose, wide }) {
  const root = $("#sheet-root");
  const ov = document.createElement("div");
  ov.className = "overlay";
  ov.innerHTML = `<div class="sheet" role="dialog" aria-modal="true" aria-label="${esc(title)}"${wide ? ' style="max-width:760px"' : ""}>
    <div class="sheet-head"><h2>${esc(title)}</h2><button type="button" class="x" data-close aria-label="Close">${ico("x")}</button></div>
    <div class="sheet-body">${body}</div>
    ${foot ? `<div class="sheet-foot">${foot}</div>` : ""}</div>`;
  root.appendChild(ov);
  document.body.style.overflow = "hidden";
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true; openSheets.delete(close);
    ov.remove();
    try { onClose && onClose(); } catch {}
    for (const fn of el.__cleanups || []) { try { fn(); } catch {} }
    if (!$(".overlay")) { document.body.style.overflow = ""; if (S.pendingRender) { S.pendingRender = false; render(); } }
  };
  ov.addEventListener("click", (e) => { if (e.target === ov || e.target.closest("[data-close]")) close(); });
  ov.addEventListener("keydown", (e) => { if (e.key === "Escape") close(); });
  const el = $(".sheet", ov);
  openSheets.add(close);
  onMount && onMount(el, close);
  const first = $("input:not([type=hidden]):not([hidden]),textarea,select", el);
  if (first && matchMedia("(min-width: 700px)").matches) first.focus();
  return { el, close };
}

function confirmBox(title, text, okLabel, danger) {
  return new Promise((resolve) => {
    sheet({
      title, body: `<p style="margin:0">${esc(text)}</p>`,
      foot: `<button class="btn quiet" data-close>Cancel</button><button class="btn ${danger ? "danger" : "primary"}" data-ok>${esc(okLabel)}</button>`,
      onMount(el, close) { $("[data-ok]", el).onclick = () => { close(); resolve(true); }; el.closest(".overlay").addEventListener("click", (e) => { if (e.target.closest("[data-close]") || e.target === el.parentElement) resolve(false); }); },
    });
  });
}

function askText(title, label, value = "", allowEmpty = false) {
  return new Promise((resolve) => {
    let done = false;
    sheet({
      title, body: `<label class="f"><span>${esc(label)}</span><input type="text" data-v value="${esc(value)}"></label>`,
      foot: `<button class="btn quiet" data-close>Cancel</button><button class="btn primary" data-ok>Save</button>`,
      onMount(el, close) {
        const go = () => { done = true; const v = $("[data-v]", el).value.trim(); close(); resolve(v || (allowEmpty ? "" : null)); };
        $("[data-ok]", el).onclick = go;
        $("[data-v]", el).addEventListener("keydown", (e) => { if (e.key === "Enter") go(); });
        $("[data-v]", el).focus();
        el.closest(".overlay").addEventListener("click", (e) => { if (!done && (e.target.closest("[data-close]") || e.target === el.parentElement)) resolve(null); });
      },
    });
  });
}

// ================= routing & shell =================
const route = () => (location.hash.replace(/^#\/?/, "").split("?")[0] || "home").split("/");
const hashParam = (k) => new URLSearchParams(location.hash.split("?")[1] || "").get(k);

function shell(active, inner) {
  const nav = [["home", "Dashboard", "grid"], ["todo", "To-do", "check"], ["new", "New task", "plus"], ["all", "All tasks", "list"], ["history", "History", "box"]];
  return `
  <header class="top"><div class="top-in">
    <a class="brand" href="#/home">${LOGO}Kaam</a>
    <nav class="topnav">${nav.map(([k, l]) => `<a href="#/${k}" class="${k === active ? "on" : ""}${k === "new" ? " new" : ""}">${l}</a>`).join("")}</nav>
    <a class="who${active === "me" ? " on" : ""}" href="#/me" aria-label="Your profile and settings"><span class="sync" id="sync"></span>${avatar(S.me)}</a>
  </div></header>
  <main id="main">${inner}</main>
  <nav class="botnav">${nav.map(([k, l, i]) => k === "new"
    ? `<a href="#/new" class="new${k === active ? " on" : ""}"><span class="plus">${ico(i)}</span>New</a>`
    : `<a href="#/${k}" class="${k === active ? "on" : ""}">${ico(i)}${l}</a>`).join("")}</nav>`;
}

function render() {
  const app = $("#app");
  if (!S.token) return renderLogin();
  if (!S.loaded) { app.innerHTML = `<div class="login"><div class="brand">${LOGO}Kaam</div><p class="tag">Loading…</p></div>`; return; }
  const [r, a] = route();
  const y = window.scrollY, same = S.lastRoute === location.hash;
  let html, active = r, after;
  if (r === "task") {
    const t = taskById(a);
    active = t && !isOpen(t) ? "history" : "all";
    html = t ? taskPage(t) : `<div class="empty"><h2>This task isn't here any more</h2><p>Someone may have deleted it. Deleted tasks can be brought back from the change log.</p><a class="btn" href="#/all">See all tasks</a></div>`;
    after = t && (() => bindTask(t));
  } else if (r === "all") { html = allPage(); after = bindAll; }
  else if (r === "history") { html = historyPage(); after = bindHistory; }
  else if (r === "new") { html = newPage(); after = bindNew; }
  else if (r === "me" || r === "more") { active = "me"; html = morePage(); after = bindMore; }
  else if (r === "todo") { html = todoPage(); after = bindTodo; }
  else if (r === "file") { const f = S.files[a]; active = f && taskById(f.taskId) && !isOpen(taskById(f.taskId)) ? "history" : "all"; html = filePage(a); after = () => bindFile(a); }
  else if (r === "log") { active = "me"; html = `<div id="logwrap"><div class="empty">Loading changes…</div></div>`; after = loadLog; }
  else { active = "home"; html = dashPage(); after = bindDash; }
  if (r === "new" && same && $("#newform")) { syncBadge(); return; } // don't wipe a half-filled form
  app.innerHTML = shell(active, html);
  syncBadge();
  after && after();
  if (same) window.scrollTo(0, y); else window.scrollTo(0, 0);
  S.lastRoute = location.hash;
}

function renderError(msg) {
  $("#app").innerHTML = `<div class="login"><div class="brand">${LOGO}Kaam</div><div class="card pad" style="max-width:380px"><p class="err">${esc(msg)}</p><button class="btn primary wide" id="retry">Try again</button></div></div>`;
  $("#retry").onclick = () => refresh(true);
}

// ================= login =================
async function renderLogin(pick) {
  const app = $("#app");
  app.innerHTML = `<div class="login"><div class="brand">${LOGO}Kaam</div><p class="tag">The family's pending work, in one place.</p><div class="card" id="lc"><p class="muted" style="text-align:center">Loading…</p></div></div>`;
  let people;
  try { people = (await api("/api/auth", { json: { action: "people" } })).people; }
  catch (e) { $("#lc").innerHTML = `<p class="err">${esc(e.message)}</p><button class="btn primary wide" onclick="location.reload()">Try again</button>`; return; }
  people.sort((a, b) => (a.admin ? 1 : 0) - (b.admin ? 1 : 0));
  S.people = people;
  const lc = $("#lc");
  const showNames = () => {
    lc.innerHTML = `<h2>Who are you?</h2><div class="names">${people.map((p) => `<button data-p="${p.id}">${avatar(p.id, true)}${esc(p.name)}</button>`).join("")}</div>`;
    $$("[data-p]", lc).forEach((b) => (b.onclick = () => showPin(b.dataset.p)));
  };
  const showPin = (pid) => {
    let pin = "";
    lc.innerHTML = `<button class="linkbtn" data-back>${"‹"} Not ${esc(pname(pid))}?</button>
      <h2 style="margin-top:6px">Hi ${esc(pname(pid))}, enter your PIN</h2>
      <div class="pinshow" data-dots></div><p class="err" data-err hidden></p>
      <input type="password" inputmode="numeric" autocomplete="current-password" aria-label="PIN" data-pin style="position:absolute;opacity:0;width:1px;height:1px">
      <div class="pad3">${[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => `<button data-k="${n}">${n}</button>`).join("")}<button data-k="del" aria-label="Delete">⌫</button><button data-k="0">0</button><button data-k="ok" class="ok">Open</button></div>`;
    const dots = () => ($("[data-dots]", lc).innerHTML = Array.from({ length: Math.max(4, pin.length) }, (_, i) => `<i class="${i < pin.length ? "on" : ""}"></i>`).join(""));
    const err = (m) => { const e = $("[data-err]", lc); e.textContent = m; e.hidden = !m; };
    const go = async () => {
      if (pin.length < 4) return err("PIN is at least 4 digits.");
      try {
        const j = await api("/api/auth", { json: { action: "login", person: pid, pin } });
        S.token = j.token; S.me = j.me; store.set("token", j.token); store.set("me", j.me);
        S.loaded = false; render(); refresh(true);
      } catch (e) { pin = ""; dots(); err(e.message); }
    };
    $$("[data-k]", lc).forEach((b) => (b.onclick = () => {
      const k = b.dataset.k;
      if (k === "ok") return go();
      if (k === "del") pin = pin.slice(0, -1); else if (pin.length < 8) pin += k;
      err(""); dots();
    }));
    const inp = $("[data-pin]", lc);
    document.onkeydown = (e) => {
      if (!$("[data-pin]")) return (document.onkeydown = null);
      if (/^\d$/.test(e.key) && pin.length < 8) { pin += e.key; err(""); dots(); }
      else if (e.key === "Backspace") { pin = pin.slice(0, -1); dots(); }
      else if (e.key === "Enter") go();
    };
    inp.blur();
    $("[data-back]", lc).onclick = showNames;
    dots();
  };
  if (people.length === 1) showPin(people[0].id);
  else if (pick) showPin(pick);
  else showNames();
}

function signOut() {
  S.token = null; S.loaded = false; S.tasks = [];
  store.del("token");
  location.hash = "#/home";
  render();
}

// ================= dashboard =================
const dueOf = (t) => t.target || t.deadline || "";
const isOverdue = (t) => isOpen(t) && dueOf(t) && dueOf(t) < today();
const isParked = (t) => t.status === "waiting" && t.followUp && t.followUp > today();

// Scorecard: on time (last 90 days), keeping open tasks moving, updates this week, streak.
function scorecard() {
  const t0 = today(), from = addDays(t0, -90), wk = Date.now() - 7 * 864e5;
  return family().map((p) => {
    const mine = S.tasks.filter((t) => (t.assignees || []).includes(p.id));
    const closed = mine.filter((t) => t.status === "done" && t.closedAt && localDate(t.closedAt) >= from && dueOf(t));
    const ontime = closed.filter((t) => localDate(t.closedAt) <= dueOf(t)).length;
    const open = mine.filter(isOpen);
    const moving = open.filter((t) => dayDiff(lastAction(t), t0) <= 7 || isParked(t)).length;
    const ents = S.tasks.flatMap((t) => (t.entries || []).filter((e) => e.by === p.id && e.at));
    const week = ents.filter((e) => Date.parse(e.at) >= wk).length;
    const days = new Set(ents.map((e) => localDate(e.at)));
    let streak = 0, d = days.has(t0) ? t0 : addDays(t0, -1);
    while (days.has(d)) { streak++; d = addDays(d, -1); }
    const parts = [];
    if (closed.length) parts.push(ontime / closed.length);
    if (open.length) parts.push(moving / open.length);
    const score = parts.length ? parts.reduce((a, b) => a + b, 0) / parts.length : null;
    const label = score === null ? ["Just started", "grey"] : score >= 0.8 ? ["On top of it", "green"] : score >= 0.5 ? ["Steady", "amber"] : ["Needs a nudge", "red"];
    return { p, closed: closed.length, ontime, open: open.length, moving, week, streak, score, label };
  }).sort((a, b) => (b.score ?? -1) - (a.score ?? -1) || b.week - a.week || b.streak - a.streak);
}

function dashPage() {
  const t0 = today(), month = t0.slice(0, 7);
  const open = S.tasks.filter(isOpen);
  const waiting = open.filter((t) => t.status === "waiting");
  const overdue = open.filter(isOverdue);
  const follow = open.filter((t) => t.followUp && t.followUp <= t0);
  const doneMonth = S.tasks.filter((t) => t.status === "done" && t.closedAt && localDate(t.closedAt).startsWith(month));
  const tile = (n, label, go, tone) => `<button class="tile${n && tone ? " " + tone : ""}" data-go='${esc(JSON.stringify(go))}'><b>${n}</b><span>${label}</span></button>`;

  // setup checklist for the admin while things are incomplete
  let setup = "";
  if (meP().admin && (!S.drive?.connected || !family().length)) {
    setup = `<section class="card sec setup"><header><h2>Finish setting up</h2></header><ol class="steps">
      <li class="${S.drive?.connected ? "done" : ""}">${S.drive?.connected ? "Google Drive connected" : `<a href="#/me">Connect Google Drive</a> so documents can be saved`}</li>
      <li class="${family().length ? "done" : ""}">${family().length ? `${plural(family().length, "family member")} added` : `<a href="#/me">Add family members</a> with their PIN and Gmail`}</li></ol></section>`;
  }

  const groups = todoItems();
  const people = family().map((p) => {
    const mine = open.filter((t) => (t.assignees || []).includes(p.id));
    const need = [...(groups.get(p.id)?.values() || [])].flat().filter((i) => i.kind === "need").length;
    return { p, n: mine.length, need, late: mine.filter(isOverdue).length };
  });
  const unassigned = open.filter((t) => !(t.assignees || []).some((id) => person(id) && !person(id).admin)).length;

  const push = open.filter((t) => dayDiff(lastAction(t), t0) >= 14 && !isParked(t)).sort((a, b) => lastAction(a).localeCompare(lastAction(b)));
  const waitLong = [...waiting].sort((a, b) => (a.waitingSince || "9").localeCompare(b.waitingSince || "9"));
  const soon = open.filter((t) => dueOf(t) && dueOf(t) >= t0 && dayDiff(t0, dueOf(t)) <= 14).sort((a, b) => dueOf(a).localeCompare(dueOf(b)));
  const row = (t, right, sub) => `<li><a href="#/task/${t.id}"><span class="dl-main"><b>${esc(t.title)}</b>${sub ? `<span class="muted small">${sub}</span>` : ""}</span><span class="dl-right">${right}</span></a></li>`;
  const more = (n, go) => (n > 5 ? `<button class="linkbtn small" data-go='${esc(JSON.stringify(go))}'>See all ${n}</button>` : "");
  const sc = scorecard();

  return `<div class="pagehead"><div><h1>Dashboard</h1><div class="sub">${fmtD(t0)}, ${new Date().toLocaleDateString("en-IN", { weekday: "long" })}</div></div></div>
  ${setup}
  <div class="tiles">
    ${tile(open.length, "Open tasks", { status: "open" })}
    ${tile(waiting.length, "Waiting on others", { status: "waiting" }, "amber")}
    ${tile(overdue.length, "Overdue", { status: "open", target: "late" }, "red")}
    ${tile(follow.length, "Follow-ups due", { status: "open", follow: "due" }, "amber")}
    ${tile(doneMonth.length, "Done this month", { page: "history" }, "green")}
  </div>

  <div class="dash">
    <section class="card sec">
      <header><h2>How everyone's doing</h2></header>
      ${sc.length ? `<ol class="score">${sc.map((r, i) => `<li>
        <span class="rank">${i + 1}</span>${avatar(r.p.id)}
        <div class="sc-main"><div class="sc-top"><b>${esc(r.p.id === S.me ? r.p.name + " (you)" : r.p.name)}</b><span class="badge ${r.label[1]}">${r.label[0]}</span></div>
          <div class="bar"><i style="width:${r.score === null ? 0 : Math.round(r.score * 100)}%" class="${r.label[1]}"></i></div>
          <div class="sc-facts">
            <span>${r.closed ? `On time <b>${r.ontime} of ${r.closed}</b>` : `<span class="muted">No finished tasks with dates yet</span>`}</span>
            <span>${r.open ? `Moving <b>${r.moving} of ${r.open}</b>` : `<span class="muted">No open tasks</span>`}</span>
            <span><b>${r.week}</b> ${r.week === 1 ? "update" : "updates"} this week</span>
            <span>${r.streak ? `<b>${r.streak}-day</b> streak` : `<span class="muted">No streak</span>`}</span>
          </div></div></li>`).join("")}</ol>
        <details class="how"><summary>How this is worked out</summary>
          <p><b>On time:</b> tasks they finished in the last 90 days that had a target or deadline, and how many were done by that date.</p>
          <p><b>Moving:</b> their open tasks updated in the last 7 days. Tasks waiting on someone with a future follow-up date count as moving.</p>
          <p><b>Updates and streak:</b> counted for whoever added the update, even on someone else's task. A streak is days in a row with at least one update.</p>
          <p>The label comes from On time and Moving together: 80% and up is On top of it, 50 to 79% is Steady, below 50% is Needs a nudge.</p></details>`
      : `<p class="muted" style="margin:0">Add family members to see this.</p>`}
    </section>

    <section class="card sec">
      <header><h2>By person</h2></header>
      <ul class="dlist">${people.map((x) => `<li><a href="#" data-go='${esc(JSON.stringify({ status: "open", who: x.p.id }))}'><span class="dl-main" style="flex-direction:row;align-items:center;gap:10px">${avatar(x.p.id)}<b>${esc(x.p.name)}</b></span>
        <span class="dl-right">${plural(x.n, "task")}${x.need ? `, ${x.need} to get` : ""}${x.late ? `, <span class="flag red">${x.late} overdue</span>` : ""}</span></a></li>`).join("")}
        ${unassigned ? `<li><a href="#" data-go='${esc(JSON.stringify({ status: "open", who: "none" }))}'><span class="dl-main"><b>Not assigned</b></span><span class="dl-right">${plural(unassigned, "task")}</span></a></li>` : ""}</ul>
    </section>

    <section class="card sec">
      <header><h2>Needs a push</h2><span class="muted small">No update for 14+ days</span></header>
      ${push.length ? `<ul class="dlist">${push.slice(0, 5).map((t) => row(t, `<span class="flag red">${dayDiff(lastAction(t), t0)} days</span>`, (t.assignees || []).length ? esc(namesList(t.assignees)) : "Not assigned")).join("")}</ul>${more(push.length, { status: "open", idle: "14" })}`
        : `<p class="muted" style="margin:0">Nothing stuck. Every open task has moved in the last two weeks.</p>`}
    </section>

    <section class="card sec">
      <header><h2>Waiting longest</h2></header>
      ${waitLong.length ? `<ul class="dlist">${waitLong.slice(0, 5).map((t) => row(t, t.waitingSince ? `<span class="flag amber">${dayDiff(t.waitingSince, t0)} days</span>` : "", `Waiting on ${esc(t.waitingOn || "someone")}`)).join("")}</ul>${more(waitLong.length, { status: "waiting" })}`
        : `<p class="muted" style="margin:0">Not waiting on anyone right now.</p>`}
    </section>

    <section class="card sec">
      <header><h2>Coming up</h2><span class="muted small">Next 14 days</span></header>
      ${soon.length ? `<ul class="dlist">${soon.slice(0, 6).map((t) => row(t, `<span class="flag ${dayDiff(t0, dueOf(t)) <= 3 ? "amber" : ""}">${fmtD(dueOf(t))}</span>`, `${t.target ? "Target" : "Deadline"} ${until(dueOf(t))}`)).join("")}</ul>${more(soon.length, { status: "open", target: "30", sort: "target" })}`
        : `<p class="muted" style="margin:0">No target dates in the next two weeks.</p>`}
    </section>
  </div>
  ${!S.tasks.length ? `<div class="card empty" style="margin-top:16px"><h2>No tasks yet</h2><p>Add the first thing the family needs to get done.</p><a class="btn primary" href="#/new">${ico("plus")} New task</a></div>` : ""}`;
}

function bindDash() {
  $$("[data-go]").forEach((b) => (b.onclick = (e) => {
    e.preventDefault();
    const go = JSON.parse(b.dataset.go);
    if (go.page) { location.hash = "#/" + go.page; return; }
    store.set("filters", { ...F_DEFAULT, ...go });
    location.hash = "#/all";
  }));
}

// ================= to-do =================
function todoItems() {
  const t0 = today();
  const byPerson = new Map(); // personId|'none' -> Map(taskId -> items[])
  const add = (who, t, item) => {
    if (!byPerson.has(who)) byPerson.set(who, new Map());
    const m = byPerson.get(who);
    if (!m.has(t.id)) m.set(t.id, []);
    m.get(t.id).push(item);
  };
  for (const t of S.tasks) {
    if (!isOpen(t)) continue;
    const team = (t.assignees || []).filter((id) => person(id) && !person(id).admin).length ? t.assignees.filter((id) => person(id) && !person(id).admin) : ["none"];
    const forTeam = (item) => team.forEach((p) => add(p, t, item));
    const ready = [];
    for (const r of t.reqs || []) {
      const owners = r.owner && person(r.owner) && !person(r.owner).admin ? [r.owner] : team;
      if (r.state === "have") ready.push(r.text);
      else if (r.state !== "given") owners.forEach((p) => add(p, t, { kind: "need", label: "Get", text: r.text, req: r.id, note: r.note }));
    }
    if (ready.length) forTeam({ kind: "ready", label: "Ready to hand over", text: ready.join(", ") });
    if (t.followUp && t.followUp <= t0) forTeam({ kind: "follow", label: t.followUp < t0 ? `Follow-up was due ${fmtD(t.followUp)}` : "Follow up today", text: t.waitingOn ? `Check with ${t.waitingOn}` : "Follow up on this" });
    for (const [k, l] of [["deadline", "Deadline"], ["target", "Target date"]]) {
      if (!t[k]) continue;
      const n = dayDiff(t0, t[k]);
      if (n < 0) forTeam({ kind: "late", label: `${l} passed`, text: `${l} was ${fmtD(t[k])}, ${until(t[k])}` });
      else if (n <= 3) forTeam({ kind: "late", label: `${l} close`, text: `${l} is ${until(t[k])} (${fmtD(t[k])})` });
    }
    const since = dayDiff(lastAction(t), t0);
    const parked = t.status === "waiting" && t.followUp && t.followUp > t0;
    if (t.status === "todo" && !(t.entries || []).length) forTeam({ kind: "start", label: "Not started", text: "Nothing done on this yet" });
    else if (since >= 14 && !parked) forTeam({ kind: "stale", label: "No update", text: `Last update ${since} days ago` });
  }
  return byPerson;
}

function todoPage() {
  const groups = todoItems();
  const filt = store.get("todoWho", "all");
  const famIds = family().map((p) => p.id);
  const mine = famIds.includes(S.me) ? [S.me] : [];
  const order = [...mine, ...famIds.filter((id) => id !== S.me), "none"].filter((id) => groups.has(id));
  const shown = filt === "all" ? order : order.filter((id) => id === filt);
  const openCount = S.tasks.filter(isOpen).length;
  const waitCount = S.tasks.filter((t) => t.status === "waiting").length;
  const urgency = (items, t) => Math.min(...items.map((i) => ({ late: 0, follow: 1, need: 2, ready: 3, start: 4, stale: 5 }[i.kind]))) * 3 + (priRank[t.priority || "normal"]);
  const chips = `<div class="chips todo-filter" role="group" aria-label="Show to-dos for">
    <button class="chip" data-who="all" aria-pressed="${filt === "all"}">Everyone</button>
    ${[...mine, ...famIds.filter((id) => id !== S.me)].map((id) => `<button class="chip" data-who="${id}" aria-pressed="${filt === id}">${esc(id === S.me ? "Me" : pname(id))}</button>`).join("")}
  </div>`;
  let body = "";
  for (const who of shown) {
    const tasks = [...groups.get(who).entries()].map(([id, items]) => [taskById(id), items]).sort((a, b) => urgency(a[1], a[0]) - urgency(b[1], b[0]));
    const n = tasks.reduce((s, [, i]) => s + i.length, 0);
    body += `<div class="personhead">${who === "none" ? `<span class="avatar">?</span>` : avatar(who)}<h2>${who === "none" ? "Not assigned to anyone" : who === S.me ? "You" : esc(pname(who))}</h2><span class="count">${plural(n, "thing")}</span></div>`;
    for (const [t, items] of tasks) {
      body += `<div class="card todo-task"><a href="#/task/${t.id}"><h3>${esc(t.title)}</h3>${stamp(t)}</a><ul class="todo-items">${items.map((i) => `
        <li class="k-${i.kind}"><div class="what"><span class="kind">${esc(i.label)}</span>${esc(i.text)}${i.note ? `<span class="req-sub">${esc(i.note)}</span>` : ""}</div>
        ${i.kind === "need" ? `<button class="btn small" data-got="${t.id}:${i.req}">Got it</button>` : i.kind === "follow" || i.kind === "ready" || i.kind === "stale" || i.kind === "start" ? `<button class="btn small quiet" data-upd="${t.id}">Add update</button>` : ""}</li>`).join("")}</ul></div>`;
    }
  }
  if (!shown.length) body = `<div class="card empty"><h2>Nothing pending ${filt === "all" ? "right now" : "for " + esc(filt === S.me ? "you" : pname(filt))}</h2><p>${openCount ? "Open tasks are all waiting on someone else, with follow-up dates set." : "Add a task to start tracking it."}</p><a class="btn primary" href="#/new">${ico("plus")} New task</a></div>`;
  return `<div class="pagehead"><div><h1>What's left to do</h1><div class="sub">${plural(openCount, "open task")}, ${waitCount} waiting on others</div></div></div>${chips}${body}`;
}

function bindTodo() {
  $$("[data-who]").forEach((b) => (b.onclick = () => { store.set("todoWho", b.dataset.who); render(); }));
  $$("[data-got]").forEach((b) => (b.onclick = () => {
    const [tid, rq] = b.dataset.got.split(":");
    const r = (taskById(tid).reqs || []).find((x) => x.id === rq);
    commit(tid, (t) => { t.reqs.find((x) => x.id === rq).state = "have"; }, `Got: ${r?.text}`);
    toast(`Marked "${r?.text}" as got`);
  }));
  $$("[data-upd]").forEach((b) => (b.onclick = () => updateSheet(taskById(b.dataset.upd))));
}

// ================= all tasks =================
const F_DEFAULT = { q: "", status: "open", who: "", forn: "", cat: "", pri: "", idle: "", target: "", follow: "", sort: "idle" };
function filtered(f) {
  const t0 = today();
  let list = S.tasks.filter((t) => {
    if (f.status === "open" && !isOpen(t)) return false;
    if (f.status && f.status !== "open" && f.status !== "any" && t.status !== f.status) return false;
    if (f.who === "none" && (t.assignees || []).length) return false;
    if (f.who && f.who !== "none" && !(t.assignees || []).includes(f.who)) return false;
    if (f.forn && !(t.for || []).includes(f.forn)) return false;
    if (f.cat && t.category !== f.cat) return false;
    if (f.pri && (t.priority || "normal") !== f.pri) return false;
    if (f.idle && dayDiff(lastAction(t), t0) < Number(f.idle)) return false;
    if (f.follow === "due" && !(t.followUp && t.followUp <= t0)) return false;
    if (f.target) {
      const d = t.target || t.deadline;
      if (f.target === "none") { if (d) return false; }
      else if (!d) return false;
      else if (f.target === "late" && d >= t0) return false;
      else if (f.target !== "late" && (d < t0 || dayDiff(t0, d) > Number(f.target))) return false;
    }
    if (f.q) {
      const hay = [t.title, t.category, t.notes, t.waitingOn, ...(t.for || []), ...(t.reqs || []).map((r) => r.text), ...(t.entries || []).map((e) => e.text)].join(" ").toLowerCase();
      if (!f.q.toLowerCase().split(/\s+/).every((w) => hay.includes(w))) return false;
    }
    return true;
  });
  const tgt = (t) => t.target || t.deadline || "9999";
  const sorts = {
    idle: (a, b) => lastAction(a).localeCompare(lastAction(b)),
    target: (a, b) => tgt(a).localeCompare(tgt(b)),
    pri: (a, b) => priRank[a.priority || "normal"] - priRank[b.priority || "normal"] || tgt(a).localeCompare(tgt(b)),
    newest: (a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""),
    az: (a, b) => a.title.localeCompare(b.title),
  };
  return list.sort(sorts[f.sort] || sorts.idle);
}

function taskRow(t) {
  const t0 = today();
  const la = lastAction(t), idle = dayDiff(la, t0);
  const d = t.target || t.deadline;
  const rc = reqCounts(t);
  const tgtTxt = d ? `<span class="flag ${d < t0 ? "red" : dayDiff(t0, d) <= 7 ? "amber" : ""}">${d < t0 ? until(d) : fmtD(d)}</span>` : `<span class="muted">No date</span>`;
  const wait = t.status === "waiting" && t.waitingOn ? `<span class="t-wait">Waiting on ${esc(t.waitingOn)}</span>` : "";
  return `<li><a class="trow" href="#/task/${t.id}">
    <div class="t-title t-titlewrap">${t.priority === "high" ? `<span class="pri-high">High: </span>` : ""}${esc(t.title)}${wait}</div>
    <div class="t-st">${stamp(t)}</div>
    <div class="t-meta">${[t.for?.length ? "For " + esc(t.for.join(", ")) : "", (t.assignees || []).length ? "With " + esc(namesList(t.assignees)) : "Not assigned"].filter(Boolean).join("; ")}</div>
    <div class="t-facts">
      <span class="${idle >= 14 ? "flag red" : idle >= 7 ? "flag amber" : ""}"><span class="lbl">Updated </span>${ago(la)}</span>
      <span><span class="lbl">Target </span>${tgtTxt}</span>
      <span class="muted">${rc.total ? `${rc.given}/${rc.total} handed over` : "Nothing listed"}</span>
    </div></a></li>`;
}

function allPage() {
  const f = { ...F_DEFAULT, ...store.get("filters", {}) };
  const list = filtered(f);
  const nActive = ["who", "forn", "cat", "pri", "idle", "target", "follow"].filter((k) => f[k]).length + (f.status !== "open" ? 1 : 0);
  const open = store.get("filtersOpen", false);
  const sel = (k, label, opts) => `<label>${label}<select data-f="${k}">${opts.map(([v, l]) => `<option value="${esc(v)}"${String(f[k]) === String(v) ? " selected" : ""}>${esc(l)}</option>`).join("")}</select></label>`;
  const forOpts = [...new Set([...family().map((p) => p.name), ...S.forNames])];
  return `<div class="pagehead"><div><h1>All tasks</h1><div class="sub">${plural(list.length, "task")} shown</div></div></div>
  <div class="filterbar">
    <input type="search" placeholder="Search tasks, notes, documents needed" data-f="q" value="${esc(f.q)}" aria-label="Search">
    <button class="btn quiet" data-toggle aria-expanded="${open}">${ico("filter")} Filters${nActive ? ` (${nActive})` : ""}</button>
    ${nActive || f.q ? `<button class="linkbtn" data-reset>Clear</button>` : ""}
  </div>
  <div class="card filters" ${open ? "" : "hidden"}>
    ${sel("status", "Status", [["open", "Open tasks"], ["todo", "To do"], ["progress", "In progress"], ["waiting", "Waiting"], ["other", "Other"], ["done", "Done"], ["dropped", "Dropped"], ["any", "Everything"]])}
    ${sel("who", "Assigned to", [["", "Anyone"], ...family().map((p) => [p.id, p.name]), ["none", "Not assigned"]])}
    ${sel("forn", "For", [["", "Anyone"], ...forOpts.map((n) => [n, n])])}
    ${sel("cat", "Category", [["", "Any"], ...S.categories.map((c) => [c, c])])}
    ${sel("pri", "Priority", [["", "Any"], ["high", "High"], ["normal", "Normal"], ["low", "Low"]])}
    ${sel("idle", "Last update", [["", "Any time"], ["3", "3+ days ago"], ["7", "7+ days ago"], ["14", "14+ days ago"], ["30", "30+ days ago"]])}
    ${sel("follow", "Follow-up", [["", "Any"], ["due", "Due today or earlier"]])}
    ${sel("target", "Target date", [["", "Any"], ["late", "Already passed"], ["7", "Within 7 days"], ["30", "Within 30 days"], ["none", "No date set"]])}
    ${sel("sort", "Sort by", [["idle", "Longest without update"], ["target", "Target date, soonest"], ["pri", "Priority"], ["newest", "Newest first"], ["az", "Name, A to Z"]])}
  </div>
  ${list.length ? `<div class="card"><div class="thead"><span>Task</span><span>Status</span><span>People</span><span>Last update</span><span>Target</span><span>Needed</span></div><ul class="tlist">${list.map(taskRow).join("")}</ul></div>`
    : `<div class="card empty"><h2>No tasks match</h2><p>Try clearing the filters or the search.</p></div>`}`;
}

function bindAll() {
  const f = { ...F_DEFAULT, ...store.get("filters", {}) };
  $$("select[data-f]").forEach((s) => (s.onchange = () => { f[s.dataset.f] = s.value; store.set("filters", f); render(); }));
  const q = $("input[data-f=q]");
  let tm;
  q.oninput = () => { clearTimeout(tm); tm = setTimeout(() => { f.q = q.value; store.set("filters", f); render(); const n = $("input[data-f=q]"); n.focus(); n.setSelectionRange(n.value.length, n.value.length); }, 250); };
  $("[data-toggle]").onclick = () => { store.set("filtersOpen", !store.get("filtersOpen", false)); render(); };
  const r = $("[data-reset]");
  if (r) r.onclick = () => { store.set("filters", { sort: f.sort }); render(); };
}

// ================= history =================
function historyPage() {
  const h = store.get("hist", { q: "", cat: "" });
  const list = S.tasks.filter((t) => !isOpen(t))
    .filter((t) => !h.cat || t.category === h.cat)
    .filter((t) => !h.q || [t.title, t.notes, ...(t.for || []), ...(t.entries || []).map((e) => e.text)].join(" ").toLowerCase().includes(h.q.toLowerCase()))
    .sort((a, b) => (b.closedAt || "").localeCompare(a.closedAt || ""));
  return `<div class="pagehead"><div><h1>History</h1><div class="sub">Finished and dropped tasks, with all their updates and documents</div></div></div>
  <div class="filterbar"><input type="search" placeholder="Search old tasks" data-h="q" value="${esc(h.q)}" aria-label="Search old tasks">
    <select data-h="cat" style="width:auto;min-width:160px" aria-label="Category"><option value="">All categories</option>${S.categories.map((c) => `<option${c === h.cat ? " selected" : ""}>${esc(c)}</option>`).join("")}</select></div>
  ${list.length ? `<div class="card"><ul class="tlist">${list.map((t) => `<li><a class="trow" href="#/task/${t.id}">
      <div class="t-title">${esc(t.title)}</div><div class="t-st">${stamp(t)}</div>
      <div class="t-meta">${t.closedAt ? `Closed ${fmtD(t.closedAt)}` : ""}${t.for?.length ? `; for ${esc(t.for.join(", "))}` : ""}${t.category ? `; ${esc(t.category)}` : ""}</div>
      <div class="t-facts muted">${plural((t.entries || []).length, "update")}, ${plural(allFiles(t).length, "document")}</div></a></li>`).join("")}</ul></div>`
    : `<div class="card empty"><h2>No finished tasks yet</h2><p>When a task is marked done or dropped, it moves here.</p></div>`}`;
}
function bindHistory() {
  const h = store.get("hist", { q: "", cat: "" });
  const q = $("[data-h=q]");
  let tm;
  q.oninput = () => { clearTimeout(tm); tm = setTimeout(() => { h.q = q.value; store.set("hist", h); render(); const n = $("[data-h=q]"); n.focus(); n.setSelectionRange(n.value.length, n.value.length); }, 250); };
  $("[data-h=cat]").onchange = (e) => { h.cat = e.target.value; store.set("hist", h); render(); };
}

// ================= task form (new + edit) =================
function taskFields(t, isNew) {
  const forOpts = [...new Set([...family().map((p) => p.name), ...S.forNames, ...(t.for || [])])];
  return `
  <label class="f"><span>What needs doing?</span><input type="text" name="title" value="${esc(t.title || "")}" placeholder="e.g. Re-KYC for Dad's HDFC account" maxlength="140"></label>
  <div class="f"><span class="f-label">Who is it for?</span><span class="f-hint">Whose account, document or work it is. Pick one or more.</span>
    <div class="chips" data-chips="for">${forOpts.map((n) => `<button type="button" class="chip" data-v="${esc(n)}" aria-pressed="${(t.for || []).includes(n)}">${esc(n)}</button>`).join("")}<button type="button" class="chip add" data-addfor>+ Someone else</button></div></div>
  <div class="f"><span class="f-label">Who will handle it?</span>
    <div class="chips" data-chips="assignees">${family().map((p) => `<button type="button" class="chip" data-v="${p.id}" aria-pressed="${(t.assignees || []).includes(p.id)}">${avatar(p.id)}${esc(p.id === S.me ? p.name + " (me)" : p.name)}</button>`).join("")}</div></div>
  <div class="row2 wrap">
    <label class="f"><span>Category</span><select name="category"><option value="">None</option>${[...new Set([...S.categories, ...(t.category ? [t.category] : [])])].map((c) => `<option${c === t.category ? " selected" : ""}>${esc(c)}</option>`).join("")}<option value="__new">+ New category…</option></select></label>
    <div class="f"><span class="f-label">Priority</span><div class="seg" data-seg="priority">${["high", "normal", "low"].map((p) => `<button type="button" class="s-plain" data-v="${p}" aria-pressed="${(t.priority || "normal") === p}">${PRI[p]}</button>`).join("")}</div></div>
  </div>
  <div class="row2 wrap">
    <label class="f"><span>Target date</span><span class="f-hint">When we want it finished</span><input type="date" name="target" value="${esc(t.target || "")}"></label>
    <label class="f"><span>Deadline</span><span class="f-hint">Hard last date, if there is one</span><input type="date" name="deadline" value="${esc(t.deadline || "")}"></label>
  </div>
  ${isNew ? `<label class="f"><span>What's needed for this?</span><span class="f-hint">Documents, forms, items, anything. One per line. You can add more later.</span><textarea name="reqs" placeholder="Aadhaar copy\nPAN copy\n2 passport photos\nKYC form, signed"></textarea></label>` : ""}
  <label class="f"><span>Notes</span><textarea name="notes" placeholder="Branch address, contact person, account number hint…">${esc(t.notes || "")}</textarea></label>
`;
}

function bindTaskFields(root) {
  $$("[data-chips] .chip:not(.add)", root).forEach((c) => (c.onclick = () => c.setAttribute("aria-pressed", c.getAttribute("aria-pressed") !== "true")));
  $$("[data-seg] button", root).forEach((b) => (b.onclick = () => { $$("button", b.parentElement).forEach((x) => x.setAttribute("aria-pressed", x === b)); }));
  $("[data-addfor]", root).onclick = async () => {
    const n = await askText("Add a name", "Name of the person");
    if (!n) return;
    const box = $("[data-chips=for]", root);
    let c = $$(".chip", box).find((x) => x.dataset.v === n);
    if (!c) {
      box.querySelector(".add").insertAdjacentHTML("beforebegin", `<button type="button" class="chip" data-v="${esc(n)}" aria-pressed="true">${esc(n)}</button>`);
      c = $$(".chip", box).find((x) => x.dataset.v === n);
      c.onclick = () => c.setAttribute("aria-pressed", c.getAttribute("aria-pressed") !== "true");
      post({ op: "addFor", name: n }).catch(() => {});
      if (!S.forNames.includes(n)) S.forNames.push(n);
    } else c.setAttribute("aria-pressed", "true");
  };
  const cat = $("select[name=category]", root);
  let prev = cat.value;
  cat.onchange = async () => {
    if (cat.value !== "__new") { prev = cat.value; return; }
    const n = await askText("New category", "Category name");
    if (!n) { cat.value = prev; return; }
    if (!S.categories.includes(n)) { S.categories.push(n); post({ op: "addCategory", name: n }).catch(() => {}); }
    cat.insertAdjacentHTML("afterbegin", "");
    const o = document.createElement("option"); o.textContent = n;
    cat.insertBefore(o, cat.querySelector("option[value=__new]"));
    cat.value = n; prev = n;
  };
}

function readTaskFields(root) {
  const v = (n) => $(`[name=${n}]`, root)?.value.trim() || "";
  const chips = (k) => $$(`[data-chips=${k}] .chip[aria-pressed=true]`, root).map((c) => c.dataset.v);
  const out = {
    title: v("title"), for: chips("for"), assignees: chips("assignees"),
    category: v("category") === "__new" ? "" : v("category"),
    priority: $("[data-seg=priority] [aria-pressed=true]", root)?.dataset.v || "normal",
    target: v("target"), deadline: v("deadline"), notes: v("notes"),
  };
  return out;
}

function newPage() {
  return `<div class="pagehead"><h1>New task</h1></div><form class="card pad" id="newform" autocomplete="off">${taskFields({ assignees: meP().admin ? [] : [S.me] }, true)}
    <p class="err" data-err hidden></p><button class="btn primary wide" type="submit">${ico("plus")} Add task</button></form>`;
}
function bindNew() {
  const form = $("#newform");
  bindTaskFields(form);
  form.onsubmit = async (e) => {
    e.preventDefault();
    const fields = readTaskFields(form);
    const err = $("[data-err]", form);
    if (!fields.title) { err.textContent = "Write what needs doing."; err.hidden = false; $("[name=title]", form).focus(); return; }
    const reqs = $("[name=reqs]", form).value.split("\n").map((s) => s.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, "").trim()).filter(Boolean)
      .map((text) => ({ id: rid(), text, state: "need", owner: "" }));
    const task = { id: rid(), ...fields, status: "todo", reqs, entries: [], files: [] };
    for (const k of ["target", "deadline", "category", "notes"]) if (!task[k]) delete task[k];
    const btn = $("button[type=submit]", form);
    btn.disabled = true; btn.textContent = "Adding…";
    try {
      const j = await post({ op: "create", task, summary: "Created task" });
      S.tasks.push(j.task); S.rev = j.rev;
      S.lastRoute = null;
      location.hash = `#/task/${j.task.id}`;
      toast("Task added");
    } catch (ex) { err.textContent = ex.message; err.hidden = false; btn.disabled = false; btn.innerHTML = `${ico("plus")} Add task`; }
  };
}

function editSheet(t) {
  sheet({
    title: "Edit details", body: `<form data-form autocomplete="off">${taskFields(t, false)}<p class="err" data-err hidden></p></form>`,
    foot: `<button class="btn quiet" data-close>Cancel</button><button class="btn primary" data-save>Save</button>`,
    onMount(el, close) {
      const form = $("[data-form]", el);
      bindTaskFields(form);
      $("[data-save]", el).onclick = () => {
        const f = readTaskFields(form);
        if (!f.title) { const e = $("[data-err]", el); e.textContent = "The task needs a name."; e.hidden = false; return; }
        close();
        commit(t.id, (x) => { Object.assign(x, f); for (const k of ["target", "deadline", "category", "notes"]) if (!x[k]) delete x[k]; }, "Edited details");
      };
    },
  });
}

// ================= task page =================
function taskPage(t) {
  const t0 = today();
  const rc = reqCounts(t);
  const le = latestEntry(t);
  const dateFact = (k, l) => t[k] ? `<dt>${l}</dt><dd>${fmtD(t[k])} <span class="${t[k] < t0 ? "flag red" : dayDiff(t0, t[k]) <= 3 ? "flag amber" : "muted"}" style="font-weight:${t[k] < t0 ? 700 : 400}">(${until(t[k])})</span></dd>` : "";
  const open = isOpen(t);
  const files = allFiles(t);
  const entries = [...(t.entries || [])].sort((a, b) => (a.date + a.at < b.date + b.at ? 1 : -1));
  return `
  <a class="back" href="#/${open ? "all" : "history"}">${ico("back")}${open ? "All tasks" : "History"}</a>
  <section class="card task-head">
    ${stamp(t, true)}
    <h1>${esc(t.title)}</h1>
    <dl class="facts">
      ${t.for?.length ? `<dt>For</dt><dd>${esc(t.for.join(", "))}</dd>` : ""}
      <dt>Handled by</dt><dd>${(t.assignees || []).length ? esc(namesList(t.assignees)) : `<span class="muted">Nobody yet</span>`}</dd>
      ${t.category ? `<dt>Category</dt><dd>${esc(t.category)}</dd>` : ""}
      ${(t.priority || "normal") !== "normal" ? `<dt>Priority</dt><dd class="${t.priority === "high" ? "pri-high" : ""}">${PRI[t.priority]}</dd>` : ""}
      ${open ? dateFact("target", "Target") + dateFact("deadline", "Deadline") + dateFact("followUp", "Follow up") : ""}
      ${!open && t.closedAt ? `<dt>Closed</dt><dd>${fmtD(t.closedAt)}</dd>` : ""}
      <dt>Last update</dt><dd>${ago(lastAction(t))}</dd>
    </dl>
    ${t.status === "waiting" ? `<div class="waitbox"><b>Waiting on ${esc(t.waitingOn || "someone")}</b>${t.waitingSince ? ` since ${fmtD(t.waitingSince)}, ${dayDiff(t.waitingSince, t0)} days` : ""}${le ? `<div class="small" style="margin-top:4px">Last step, ${fmtD(le.date)}: ${esc(le.text || describeStatus(le) || "")}</div>` : ""}</div>` : ""}
    <div class="actions">
      ${open ? `<button class="btn primary" data-update>${ico("plus")} Add update</button><button class="btn" data-done>${ico("check")} Mark done</button>`
             : `<button class="btn primary" data-reopen>Reopen task</button>`}
      <button class="btn quiet" data-edit>Edit details</button>
    </div>
  </section>

  <div class="layout">
    <section class="card sec">
      <header><h2>What's needed</h2><span class="muted small">${rc.total ? `${rc.given} of ${rc.total} handed over` : ""}</span></header>
      ${rc.total ? `<div class="progress" aria-hidden="true"><i style="width:${(100 * (rc.given + rc.have * 0.5)) / rc.total}%"></i></div>` : `<p class="muted" style="margin:0">Nothing listed yet. Add documents, forms or items needed for this task.</p>`}
      <ul class="reqs">${(t.reqs || []).map((r) => `
        <li class="req ${r.state || "need"}">
          <div class="req-top"><button class="req-name" data-req="${r.id}">${esc(r.text)}${r.owner && person(r.owner) ? `<span class="req-sub">${esc(pname(r.owner))} to arrange</span>` : ""}${r.note ? `<span class="req-sub">${esc(r.note)}</span>` : ""}</button></div>
          <div class="seg" role="group" aria-label="State of ${esc(r.text)}">${[["need", "Need"], ["have", "Have it"], ["given", "Handed over"]].map(([k, l]) => `<button class="s-${k}" data-state="${r.id}:${k}" aria-pressed="${(r.state || "need") === k}">${l}</button>`).join("")}</div>
          ${fileChips(r.files)}
        </li>`).join("")}</ul>
      <form class="addline" data-addreq><input type="text" placeholder="Add something needed" aria-label="Add something needed" maxlength="140"><button class="btn" type="submit">Add</button></form>
    </section>

    <section class="card sec">
      <header><h2>Documents</h2><button class="btn small quiet" data-attach>${ico("clip")} Attach</button></header>
      ${files.length ? `<ul class="doclist">${files.map(({ f, from }) => `<li><a class="docrow" href="#/file/${esc(f.id)}"><b>${esc(fname(f))}</b><span class="from">${f.desc ? esc(f.desc) + "<br>" : ""}${esc(from)}${f.by ? `, added by ${esc(pname(f.by))}` : ""}</span></a>${fmeta(f)?.link ? `<a class="btn small" href="${esc(fmeta(f).link)}" target="_blank" rel="noopener">Open</a>` : ""}</li>`).join("")}</ul>`
        : `<p class="muted" style="margin:0">${S.drive?.connected ? "No documents yet. Attach acknowledgements, receipts, forms or photos here or with an update." : "Documents are saved in Google Drive, which isn't connected yet." + (meP().admin ? " Connect it in your profile (the round button at the top right)." : " Ask the admin to connect it.")}</p>`}
      ${S.folders[t.id] ? `<p class="small" style="margin:12px 0 0"><a href="${esc(S.folders[t.id])}" target="_blank" rel="noopener">Open this task's folder in Google Drive</a></p>` : ""}
      ${removedFiles(t).length ? `<details class="removed"><summary>Removed documents (${removedFiles(t).length})</summary><ul class="doclist">${removedFiles(t).map((m) => `<li><a class="file" href="#/file/${esc(m.id)}"><span class="ficon">${ico("doc")}</span><span class="fname">${esc(m.name)}</span></a><button class="btn small quiet" data-putback="${esc(m.id)}">Put back</button></li>`).join("")}</ul></details>` : ""}
    </section>

    <section class="card sec span2">
      <header><h2>Updates</h2></header>
      ${entries.length ? `<ol class="timeline">${entries.map((e) => entryHtml(t, e)).join("")}</ol>` : `<p class="muted" style="margin:0">No updates yet. Use "Add update" each time something happens, like documents handed over or a call made.</p>`}
      <p class="small muted" style="margin:8px 0 0">Created by ${esc(pname(t.createdBy))} on ${fmtD(t.createdAt)}</p>
    </section>

    ${t.notes ? `<section class="card sec span2"><header><h2>Notes</h2></header><div class="notes">${esc(t.notes)}</div></section>` : ""}
  </div>
  ${meP().admin ? `<p style="margin-top:20px"><button class="linkbtn" style="color:var(--red)" data-delete>Delete this task</button></p>` : ""}`;
}

function describeStatus(e) {
  if (!e.status) return "";
  const s = e.status;
  if (s.to === "waiting") return `Now waiting on ${s.waitingOn || "someone"}`;
  const l = s.to === "other" ? s.text || "Other" : (STATUS.find((x) => x[0] === s.to) || [, s.to])[1];
  return `Status changed to ${l}`;
}

function entryHtml(t, e) {
  const st = describeStatus(e);
  const given = (e.given || []).map((id) => (t.reqs || []).find((r) => r.id === id)?.text).filter(Boolean);
  return `<li class="entry${e.text ? "" : " sys"}">
    <div class="entry-head"><b>${fmtD(e.date)}</b><span class="muted small">${esc(pname(e.by))}${e.at ? `, added ${fmtD(e.at)} ${fmtTime(e.at)}` : ""}</span>
      <button class="linkbtn small entry-edit" data-entry="${e.id}">Edit</button></div>
    ${e.text ? `<p class="entry-text">${esc(e.text)}</p>` : ""}
    ${given.length ? `<div class="entry-note"><b class="flag green">Handed over:</b> ${esc(given.join(", "))}</div>` : ""}
    ${st ? `<div class="entry-note"><b>${esc(st)}</b>${e.status?.followUp ? `. Follow up on ${fmtD(e.status.followUp)}` : ""}</div>` : ""}
    ${fileChips(e.files)}
  </li>`;
}

function bindTask(t) {
  const id = t.id;
  const on = (sel, fn) => { const el = $(sel); if (el) el.onclick = fn; };
  on("[data-update]", () => updateSheet(taskById(id)));
  on("[data-done]", () => updateSheet(taskById(id), "done"));
  on("[data-reopen]", () => updateSheet(taskById(id), "progress"));
  on("[data-edit]", () => editSheet(taskById(id)));
  on("[data-attach]", () => attachSheet(taskById(id)));
  on("[data-delete]", async () => {
    if (!(await confirmBox("Delete this task?", "It disappears for everyone. You can bring it back from the change log in your profile (the round button at the top right).", "Delete task", true))) return;
    try {
      const j = await post({ op: "delete", taskId: id });
      S.tasks = S.tasks.filter((x) => x.id !== id); S.rev = j.rev;
      location.hash = "#/all";
      toast("Task deleted");
    } catch (e) { toast(e.message, true); }
  });
  $$("[data-state]").forEach((b) => (b.onclick = () => {
    const [rq, st] = b.dataset.state.split(":");
    const r = taskById(id).reqs.find((x) => x.id === rq);
    if (r.state === st) return;
    commit(id, (x) => { x.reqs.find((y) => y.id === rq).state = st; }, `${r.text}: ${{ need: "Need", have: "Have it", given: "Handed over" }[st]}`);
  }));
  $$("[data-req]").forEach((b) => (b.onclick = () => reqSheet(taskById(id), b.dataset.req)));
  $$("[data-entry]").forEach((b) => (b.onclick = () => entrySheet(taskById(id), b.dataset.entry)));
  $$("[data-putback]").forEach((b) => (b.onclick = () => {
    const m = S.files[b.dataset.putback];
    commit(id, (x) => putBack(x, m), `Put back: ${m.name}`);
  }));
  const f = $("[data-addreq]");
  f.onsubmit = (e) => {
    e.preventDefault();
    const inp = $("input", f), text = inp.value.trim();
    if (!text) return inp.focus();
    commit(id, (x) => { x.reqs.push({ id: rid(), text, state: "need", owner: "" }); }, `Added needed: ${text}`);
    setTimeout(() => { const n = $("[data-addreq] input"); n && n.focus(); }, 0);
  };
}

// ---------- add update / change status ----------
function updateSheet(t, preset) {
  const status = preset || t.status || "todo";
  const pend = (t.reqs || []).filter((r) => r.state !== "given");
  const titles = { done: "Mark as done", progress: t && !isOpen(t) ? "Reopen task" : "Add update" };
  sheet({
    title: titles[preset] || "Add update",
    body: `
      <label class="f"><span>What happened?</span><textarea name="text" placeholder="${preset === "done" ? "Anything to note? (optional)" : "e.g. Handed KYC form and 4 documents to the branch. Got an acknowledgement."}"></textarea></label>
      <label class="f"><span>When?</span><input type="date" name="date" value="${today()}" max="${today()}"></label>
      <div class="f"><span class="f-label">Documents or photos</span><span class="f-hint">Acknowledgement, receipt, form copy</span><div data-files></div></div>
      ${pend.length ? `<div class="f"><span class="f-label">Handed over with this update</span><div class="chips">${pend.map((r) => `<button type="button" class="chip" data-give="${r.id}" aria-pressed="false">${esc(r.text)}</button>`).join("")}</div></div>` : ""}
      <label class="f"><span>Status now</span><select name="status">${STATUS.map(([k, l]) => `<option value="${k}"${k === status ? " selected" : ""}>${l}</option>`).join("")}</select></label>
      <label class="f" data-show="waiting"><span>Waiting on whom?</span><input type="text" name="waitingOn" value="${esc(t.waitingOn || "")}" placeholder="e.g. HDFC Anna Nagar branch, CA, Registrar office"></label>
      <label class="f" data-show="other"><span>Describe the status</span><input type="text" name="statusText" value="${esc(t.statusText || "")}" placeholder="e.g. On hold till Diwali"></label>
      <div class="f" data-show="open"><label><span class="f-label">Follow up on</span><input type="date" name="followUp" value="${esc(t.followUp || "")}"></label>
        <div class="quickdates"><button type="button" class="chip" data-fu="2">In 2 days</button><button type="button" class="chip" data-fu="7">In a week</button><button type="button" class="chip" data-fu="14">In 2 weeks</button><button type="button" class="chip" data-fu="">No date</button></div></div>
      <p class="err" data-err hidden></p>`,
    foot: `<button class="btn quiet" data-close>Cancel</button><button class="btn primary" data-save>Save update</button>`,
    onMount(el, close) {
      const picker = filePicker($("[data-files]", el), t.id);
      const sel = $("[name=status]", el);
      const show = () => {
        const v = sel.value;
        $("[data-show=waiting]", el).hidden = v !== "waiting";
        $("[data-show=other]", el).hidden = v !== "other";
        $("[data-show=open]", el).hidden = v === "done" || v === "dropped";
      };
      sel.onchange = show; show();
      $$("[data-give]", el).forEach((c) => (c.onclick = () => c.setAttribute("aria-pressed", c.getAttribute("aria-pressed") !== "true")));
      $$("[data-fu]", el).forEach((c) => (c.onclick = () => { $("[name=followUp]", el).value = c.dataset.fu ? addDays(today(), +c.dataset.fu) : ""; }));
      $("[data-save]", el).onclick = () => {
        const err = (m) => { const e = $("[data-err]", el); e.textContent = m; e.hidden = false; e.scrollIntoView({ block: "nearest" }); };
        if (picker.busy) return err("Wait for the files to finish uploading.");
        const text = $("[name=text]", el).value.trim();
        const date = $("[name=date]", el).value || today();
        const to = sel.value;
        const waitingOn = $("[name=waitingOn]", el).value.trim();
        const statusText = $("[name=statusText]", el).value.trim();
        const followUp = to === "done" || to === "dropped" ? "" : $("[name=followUp]", el).value;
        const given = $$("[data-give][aria-pressed=true]", el).map((c) => c.dataset.give);
        const files = picker.files;
        const changed = to !== (t.status || "todo") || (to === "waiting" && waitingOn !== (t.waitingOn || "")) || (to === "other" && statusText !== (t.statusText || ""));
        if (to === "waiting" && !waitingOn) return err("Say who you're waiting on.");
        if (to === "waiting" && !text && !(t.entries || []).length) return err("Write what was done, so everyone knows what you're waiting for.");
        if (to === "other" && !statusText) return err("Describe the status.");
        if (!text && !changed && !files.length && !given.length && followUp === (t.followUp || "")) return err("Write what happened, or change something.");
        close();
        const entry = { id: rid(), date, at: new Date().toISOString(), by: S.me, text, files };
        if (changed) entry.status = { to, ...(to === "waiting" ? { waitingOn } : {}), ...(to === "other" ? { text: statusText } : {}), ...(followUp ? { followUp } : {}) };
        if (given.length) entry.given = given;
        const sum = [text && `Update: ${text.slice(0, 80)}`, changed && describeStatus(entry), given.length && `handed over ${given.length}`, files.length && plural(files.length, "file")].filter(Boolean).join("; ");
        commit(t.id, (x) => {
          x.entries.push(entry);
          for (const r of x.reqs) if (given.includes(r.id)) r.state = "given";
          if (changed) {
            if (to === "waiting" && (x.status !== "waiting" || x.waitingOn !== waitingOn)) x.waitingSince = date;
            x.status = to;
          }
          if (to === "waiting") x.waitingOn = waitingOn; else { delete x.waitingOn; delete x.waitingSince; }
          if (to === "other") x.statusText = statusText; else delete x.statusText;
          if (followUp) x.followUp = followUp; else delete x.followUp;
          if (to === "done" || to === "dropped") x.closedAt = x.closedAt && !changed ? x.closedAt : new Date().toISOString(); else delete x.closedAt;
        }, sum || "Added update");
        if (to === "done") toast("Marked done. It's now in History.");
      };
    },
  });
}

function attachSheet(t) {
  sheet({
    title: "Attach documents", body: `<p class="muted" style="margin-top:0">These go in the task's general documents. To record that something was handed over, use "Add update" instead.</p><div data-files></div><p class="err" data-err hidden></p>`,
    foot: `<button class="btn quiet" data-close>Cancel</button><button class="btn primary" data-save>Save</button>`,
    onMount(el, close) {
      const picker = filePicker($("[data-files]", el), t.id);
      $("[data-save]", el).onclick = () => {
        if (picker.busy) { const e = $("[data-err]", el); e.textContent = "Wait for the files to finish uploading."; e.hidden = false; return; }
        const files = picker.files;
        close();
        if (files.length) commit(t.id, (x) => { x.files.push(...files); }, `Attached ${files.map((f) => f.name).join(", ")}`);
      };
    },
  });
}

function reqSheet(t, rq) {
  const r = (t.reqs || []).find((x) => x.id === rq);
  if (!r) return;
  sheet({
    title: "Needed item",
    body: `<label class="f"><span>What is needed</span><input type="text" name="text" value="${esc(r.text)}" maxlength="140"></label>
      <label class="f"><span>Who will arrange it?</span><select name="owner"><option value="">Whoever is handling the task</option>${family().map((p) => `<option value="${p.id}"${p.id === r.owner ? " selected" : ""}>${esc(p.name)}</option>`).join("")}</select></label>
      <label class="f"><span>Note</span><input type="text" name="note" value="${esc(r.note || "")}" placeholder="e.g. Self-attested, 2 copies"></label>
      <div class="f"><span class="f-label">Copy or photo of it</span><div data-files></div></div>
      <p style="margin:6px 0 0"><button type="button" class="linkbtn" style="color:var(--red)" data-del>Remove this item</button></p><p class="err" data-err hidden></p>`,
    foot: `<button class="btn quiet" data-close>Cancel</button><button class="btn primary" data-save>Save</button>`,
    onMount(el, close) {
      const picker = filePicker($("[data-files]", el), t.id, r.files || []);
      $("[data-save]", el).onclick = () => {
        if (picker.busy) { const e = $("[data-err]", el); e.textContent = "Wait for the files to finish uploading."; e.hidden = false; return; }
        const text = $("[name=text]", el).value.trim() || r.text, owner = $("[name=owner]", el).value, note = $("[name=note]", el).value.trim(), files = picker.files;
        close();
        commit(t.id, (x) => { const y = x.reqs.find((z) => z.id === rq); Object.assign(y, { text, owner, note, files }); if (!note) delete y.note; if (!files.length) delete y.files; }, `Edited needed item: ${text}`);
      };
      $("[data-del]", el).onclick = () => { close(); commit(t.id, (x) => { x.reqs = x.reqs.filter((z) => z.id !== rq); }, `Removed needed item: ${r.text}`); };
    },
  });
}

function entrySheet(t, eid) {
  const e = (t.entries || []).find((x) => x.id === eid);
  if (!e) return;
  sheet({
    title: "Edit update",
    body: `<label class="f"><span>What happened?</span><textarea name="text">${esc(e.text || "")}</textarea></label>
      <label class="f"><span>When?</span><input type="date" name="date" value="${esc(e.date)}" max="${today()}"></label>
      <div class="f"><span class="f-label">Documents or photos</span><div data-files></div></div>
      ${e.status ? `<p class="small muted">${esc(describeStatus(e))}. To change the status, add a new update.</p>` : ""}
      <p style="margin:6px 0 0"><button type="button" class="linkbtn" style="color:var(--red)" data-del>Delete this update</button></p><p class="err" data-err hidden></p>`,
    foot: `<button class="btn quiet" data-close>Cancel</button><button class="btn primary" data-save>Save</button>`,
    onMount(el, close) {
      const picker = filePicker($("[data-files]", el), t.id, e.files || []);
      $("[data-save]", el).onclick = () => {
        if (picker.busy) { const x = $("[data-err]", el); x.textContent = "Wait for the files to finish uploading."; x.hidden = false; return; }
        const text = $("[name=text]", el).value.trim(), date = $("[name=date]", el).value || e.date, files = picker.files;
        close();
        commit(t.id, (x) => { Object.assign(x.entries.find((z) => z.id === eid), { text, date, files }); }, `Edited update from ${fmtD(e.date)}`);
      };
      $("[data-del]", el).onclick = async () => {
        close();
        if (!(await confirmBox("Delete this update?", "You can undo this from the change log.", "Delete update", true))) return;
        commit(t.id, (x) => { x.entries = x.entries.filter((z) => z.id !== eid); }, `Deleted update from ${fmtD(e.date)}: ${(e.text || "").slice(0, 60)}`);
      };
    },
  });
}

// ================= file page =================
// Return a removed document to where it was (its update or needed item), or to general documents.
function putBack(x, m) {
  const lp = m.lastPlace || {};
  const ref = lp.ref ? { ...lp.ref } : { id: m.id, name: m.origName || m.name, type: m.type, size: m.size, by: m.by, at: m.at };
  const home = lp.kind === "entry" ? (x.entries || []).find((e) => e.id === lp.id) : lp.kind === "req" ? (x.reqs || []).find((r) => r.id === lp.id) : null;
  if (home) (home.files ||= []).push(ref); else x.files.push(ref);
}

function removedFiles(t) {
  return Object.values(S.files || {}).filter((m) => m.taskId === t.id && m.removed).sort((a, b) => (b.at || "").localeCompare(a.at || ""));
}
function locateRef(t, id) {
  if (!t) return null;
  for (const e of t.entries || []) { const ref = (e.files || []).find((f) => f.id === id); if (ref) return { kind: "entry", e, ref }; }
  for (const r of t.reqs || []) { const ref = (r.files || []).find((f) => f.id === id); if (ref) return { kind: "req", r, ref }; }
  const ref = (t.files || []).find((f) => f.id === id);
  return ref ? { kind: "general", ref } : null;
}
function placeText(loc) {
  if (!loc) return "Not attached to the task any more";
  if (loc.kind === "entry") return `The update on ${fmtD(loc.e.date)}`;
  if (loc.kind === "req") return `Needed item: ${loc.r.text} (${{ need: "still needed", have: "have it", given: "handed over" }[loc.r.state || "need"]})`;
  return "The task's general documents";
}
const statusWords = (o) => o ? (o.status === "waiting" ? `Waiting on ${o.waitingOn || "someone"}` : o.status === "other" ? o.statusText || "Other" : (STATUS.find((x) => x[0] === o.status) || [, o.status])[1]) : "";
const kb = (n) => (n >= 1048576 ? (n / 1048576).toFixed(1) + " MB" : Math.max(1, Math.round(n / 1024)) + " KB");

function filePage(id) {
  const m = S.files[id];
  if (!m) return `<div class="empty"><h2>This document isn't here</h2><p>It may still be uploading, or it was never saved.</p><a class="btn" href="#/all">See all tasks</a></div>`;
  const t = taskById(m.taskId);
  const loc = locateRef(t, id);
  const ref = loc?.ref || {};
  const driveId = (m.link || "").match(/\/d\/([^/]+)/)?.[1];
  const isImg = (m.type || "").startsWith("image/");
  const folderName = t ? t.title : "a deleted task";
  return `
  <a class="back" href="${t ? `#/task/${t.id}` : "#/all"}">${ico("back")}${t ? esc(t.title) : "All tasks"}</a>
  <section class="card task-head">
    ${m.removed ? `<span class="stamp st-dropped">Removed</span>` : ""}
    <h1 style="overflow-wrap:anywhere">${esc(m.name)}</h1>
    ${isImg && driveId ? `<img class="preview" src="https://drive.google.com/thumbnail?id=${esc(driveId)}&sz=w1000" alt="" onerror="this.remove()">` : ""}
    <div class="actions" style="margin-top:4px">${m.link ? `<a class="btn primary" href="${esc(m.link)}" target="_blank" rel="noopener">${ico(isImg ? "camera" : "doc")} Open in Google Drive</a>` : ""}</div>
  </section>

  <div class="layout">
    <section class="card sec">
      <header><h2>About this document</h2></header>
      ${loc ? `
      <label class="f"><span>What is this document?</span><textarea name="desc" rows="3" placeholder="e.g. Bank's acknowledgement for the KYC form and 4 documents">${esc(ref.desc || "")}</textarea></label>
      <label class="f"><span>Notes</span><textarea name="note" rows="3" placeholder="e.g. Original is in the blue file at home">${esc(ref.note || "")}</textarea></label>
      <button class="btn" data-savedesc>Save</button>`
      : `${ref.desc ? `<p>${esc(ref.desc)}</p>` : ""}<p class="muted" style="margin:0">This document was removed from the task. Put it back to edit its description.</p>`}
    </section>

    <section class="card sec">
      <header><h2>Details</h2></header>
      <dl class="facts">
        <dt>Task</dt><dd>${t ? `<a href="#/task/${t.id}">${esc(t.title)}</a>` : "Deleted"}</dd>
        <dt>Attached to</dt><dd>${esc(placeText(loc))}</dd>
        ${t ? `<dt>Task now</dt><dd>${esc(statusWords(t))}</dd>` : ""}
        ${m.attached ? `<dt>When attached</dt><dd>${fmtD(m.attached.at)}. Task was: ${esc(statusWords(m.attached))}</dd>` : ""}
        <dt>Uploaded by</dt><dd>${esc(pname(m.by))}, ${fmtD(m.at)} ${fmtTime(m.at)}</dd>
        <dt>Original file</dt><dd style="overflow-wrap:anywhere">${esc(m.origName || "")}${m.size ? ` <span class="muted">(${kb(m.size)})</span>` : ""}</dd>
        <dt>In Google Drive</dt><dd style="overflow-wrap:anywhere">Kaam / ${esc(folderName)}${m.removed ? " / Removed" : ""}</dd>
      </dl>
      ${loc?.kind === "entry" && loc.e.text ? `<div class="quote"><div class="small muted">The update, ${fmtD(loc.e.date)}, by ${esc(pname(loc.e.by))}</div>${esc(loc.e.text)}</div>` : ""}
    </section>

    <section class="card sec span2">
      <header><h2>History</h2></header>
      <ol class="hist">${[...(m.history || [])].reverse().map((h) => `<li><b>${fmtD(h.at)} ${fmtTime(h.at)}</b> <span class="muted">${esc(pname(h.by))}</span><div>${esc(h.text)}</div></li>`).join("") || `<li class="muted">Nothing yet.</li>`}</ol>
      <div class="actions">${loc ? `<button class="btn danger" data-rmfile>Remove from task</button>` : t ? `<button class="btn" data-putback="${esc(id)}">Put back in task</button>` : ""}</div>
    </section>
  </div>`;
}

function bindFile(id) {
  const m = S.files[id];
  if (!m) return;
  const t = taskById(m.taskId);
  const findRef = (x) => locateRef(x, id)?.ref;
  const sv = $("[data-savedesc]");
  if (sv) sv.onclick = () => {
    const desc = $("[name=desc]").value.trim(), note = $("[name=note]").value.trim();
    commit(t.id, (x) => { const r = findRef(x); if (!r) return; if (desc) r.desc = desc; else delete r.desc; if (note) r.note = note; else delete r.note; }, `Described document: ${m.name}`);
    toast("Saved");
  };
  const rm = $("[data-rmfile]");
  if (rm) rm.onclick = async () => {
    if (!(await confirmBox("Remove this document?", "It moves to the task's Removed folder in Google Drive. You can put it back any time.", "Remove", true))) return;
    commit(t.id, (x) => {
      x.files = (x.files || []).filter((f) => f.id !== id);
      for (const r of x.reqs || []) if (r.files) r.files = r.files.filter((f) => f.id !== id);
      for (const e of x.entries || []) if (e.files) e.files = e.files.filter((f) => f.id !== id);
    }, `Removed document: ${m.name}`);
  };
  const pb = $("[data-putback]");
  if (pb) pb.onclick = () => commit(t.id, (x) => putBack(x, m), `Put back: ${m.name}`);
}

// ================= more / settings =================
function driveCard() {
  const d = S.drive || {};
  if (meP().admin) {
    const status = d.connected
      ? `<span class="ok-dot"></span><span>Connected to <b>${esc(d.email || "Google")}</b></span>`
      : d.broken ? `<span class="bad-dot"></span><span><b>Connection stopped working.</b> Reconnect to keep saving documents.</span>`
      : `<span class="bad-dot"></span><span><b>Not connected.</b> Documents can't be attached until you connect.</span>`;
    return `<h2 style="margin:26px 4px 10px;font-size:1.2rem">Google Drive</h2>
    <div class="card pad"><div class="drivebox">${status}</div>
      <p class="small muted">All documents are saved in a Kaam folder in this Google account. Family members you've added with a Gmail address can view the folder.</p>
      <div class="actions" style="margin-top:8px">
        <button class="btn ${d.connected ? "quiet" : "primary"}" data-gconnect>${d.connected ? "Reconnect" : "Connect Google Drive"}</button>
        ${d.folder ? `<a class="btn quiet" href="${esc(d.folder)}" target="_blank" rel="noopener">Open Kaam folder</a>` : ""}
        ${d.connected ? `<button class="linkbtn" style="color:var(--red)" data-gdisconnect>Disconnect</button>` : ""}
      </div></div>`;
  }
  return d.folder ? `<div class="card" style="margin-top:16px"><ul class="menu"><li><a href="${esc(d.folder)}" target="_blank" rel="noopener">All documents in Google Drive<span class="chev">›</span></a></li></ul></div>` : "";
}

function morePage() {
  const me = meP();
  const shareLine = (p) => !p.email ? `<span class="muted">No Gmail added, so they can't open documents</span>`
    : p.shareError ? `<span class="flag red">${esc(p.email)}: couldn't share the folder</span>`
    : p.shared ? `<span>${esc(p.email)}</span>` : `<span>${esc(p.email)}</span> <span class="muted">(shares once Drive is connected)</span>`;
  return `<div class="pagehead"><h1>Profile and settings</h1></div>
  <div class="card pad" style="display:flex;align-items:center;gap:14px;margin-bottom:16px">${avatar(me.id, true)}<div><b style="font-size:1.15rem">${esc(me.name)}</b><div class="muted small">${me.admin ? "Admin" : "Family member"}</div></div></div>
  <div class="card"><ul class="menu">
    <li><a href="#/log">Change log and undo<span class="chev">›</span></a></li>
    <li><button class="m" data-mypin>Change my PIN<span class="chev">›</span></button></li>
    <li><button class="m" data-install>Put Kaam on your home screen<span class="chev">›</span></button></li>
    <li><button class="m" data-signout style="color:var(--red)">Sign out</button></li>
  </ul></div>
  ${driveCard()}
  ${me.admin ? `
  <h2 style="margin:26px 4px 10px;font-size:1.2rem">People</h2>
  <div class="card pad"><ul class="people">${S.people.map((p) => `<li>${avatar(p.id)}<div class="nm">${esc(p.name)}${p.admin ? ` <span class="muted small">(admin)</span>` : `<div class="small" style="font-weight:400">${shareLine(p)}</div>`}</div>
    <div class="chips"><button class="btn small quiet" data-pp="rename:${p.id}">Rename</button><button class="btn small quiet" data-pp="pin:${p.id}">Set PIN</button>${p.admin ? "" : `<button class="btn small quiet" data-pp="email:${p.id}">Gmail</button><button class="btn small danger" data-pp="remove:${p.id}">Remove</button>`}</div></li>`).join("")}</ul>
    <button class="btn wide" style="margin-top:12px" data-addperson>${ico("plus")} Add a person</button>
    ${S.people.some((p) => p.shareError) ? `<button class="linkbtn" data-reshare>Try sharing the folder again</button>` : ""}</div>
  <h2 style="margin:26px 4px 10px;font-size:1.2rem">Lists</h2>
  <div class="card pad">
    <label class="f"><span>Categories</span><span class="f-hint">One per line. Anyone can also add one while creating a task.</span><textarea data-list="categories" rows="6">${esc(S.categories.join("\n"))}</textarea></label>
    <label class="f"><span>Other names for "Who is it for?"</span><span class="f-hint">People who don't use the app, like grandparents. Family members are always included. One per line.</span><textarea data-list="forNames" rows="4">${esc(S.forNames.join("\n"))}</textarea></label>
    <button class="btn" data-savelists>Save lists</button>
  </div>` : ""}
  <p class="small muted" style="text-align:center;margin-top:24px">Kaam version ${VERSION}</p>`;
}

function bindMore() {
  $("[data-signout]").onclick = async () => { if (await confirmBox("Sign out?", "You'll need your PIN to open Kaam again on this phone.", "Sign out")) signOut(); };
  $("[data-install]").onclick = () => sheet({ title: "Add to home screen", body: `<p style="margin-top:0"><b>iPhone:</b> open this link in Safari, tap the Share button (square with an arrow), then "Add to Home Screen".</p><p><b>Android:</b> open in Chrome, tap the three dots at the top right, then "Add to Home screen" or "Install app".</p><p class="muted">Kaam then opens like a normal app, and stays signed in.</p>` });
  $("[data-mypin]").onclick = () => sheet({
    title: "Change my PIN",
    body: `<label class="f"><span>Current PIN</span><input type="password" inputmode="numeric" name="old" autocomplete="current-password"></label><label class="f"><span>New PIN</span><span class="f-hint">4 to 8 digits</span><input type="password" inputmode="numeric" name="pin" autocomplete="new-password"></label><p class="err" data-err hidden></p>`,
    foot: `<button class="btn quiet" data-close>Cancel</button><button class="btn primary" data-ok>Change PIN</button>`,
    onMount(el, close) {
      $("[data-ok]", el).onclick = async () => {
        try {
          const j = await api("/api/auth", { json: { action: "mypin", old: $("[name=old]", el).value, pin: $("[name=pin]", el).value } });
          S.token = j.token; store.set("token", j.token); close(); toast("PIN changed");
        } catch (e) { const x = $("[data-err]", el); x.textContent = e.message; x.hidden = false; }
      };
    },
  });
  if (!meP().admin) return;
  const adminOp = async (json, okMsg) => { try { const j = await post(json); S.rev = j.rev; await refresh(true); toast(okMsg); } catch (e) { toast(e.message, true); } };
  $("[data-gconnect]").onclick = async () => {
    try { const j = await api("/api/google", { json: { action: "start" } }); location.href = j.url; }
    catch (e) { toast(e.message, true); }
  };
  const gd = $("[data-gdisconnect]");
  if (gd) gd.onclick = async () => {
    if (!(await confirmBox("Disconnect Google Drive?", "Documents already saved stay in Drive. New documents can't be attached until you connect again with the same Google account.", "Disconnect", true))) return;
    try { await api("/api/google", { json: { action: "disconnect" } }); await refresh(true); toast("Disconnected"); } catch (e) { toast(e.message, true); }
  };
  const rs = $("[data-reshare]");
  if (rs) rs.onclick = () => adminOp({ op: "reshare" }, "Tried sharing again");
  const pinSheet = (title, withName, run) => sheet({
    title, body: `${withName ? `<label class="f"><span>Name</span><input type="text" name="name" maxlength="40"></label><label class="f"><span>Gmail address</span><span class="f-hint">So they can open documents in Google Drive. You can add it later.</span><input type="text" inputmode="email" autocomplete="off" name="email" placeholder="name@gmail.com"></label>` : ""}<label class="f"><span>PIN</span><span class="f-hint">4 to 8 digits. Tell them this PIN.</span><input type="tel" inputmode="numeric" name="pin" maxlength="8"></label><p class="err" data-err hidden></p>`,
    foot: `<button class="btn quiet" data-close>Cancel</button><button class="btn primary" data-ok>Save</button>`,
    onMount(el, close) {
      $("[data-ok]", el).onclick = async () => {
        const pin = $("[name=pin]", el).value.trim(), name = withName ? $("[name=name]", el).value.trim() : "", email = withName ? $("[name=email]", el).value.trim() : "";
        const e = $("[data-err]", el);
        if (withName && !name) { e.textContent = "Type their name."; e.hidden = false; return; }
        if (!/^\d{4,8}$/.test(pin)) { e.textContent = "PIN must be 4 to 8 digits."; e.hidden = false; return; }
        close(); run(name, pin, email);
      };
    },
  });
  $("[data-addperson]").onclick = () => pinSheet("Add a person", true, (name, pin, email) => adminOp({ op: "addPerson", name, pin, email }, `${name} added`));
  $$("[data-pp]").forEach((b) => (b.onclick = async () => {
    const [act, id] = b.dataset.pp.split(":");
    const nm = pname(id);
    if (act === "email") {
      const v = await askText(`Gmail for ${nm}`, "Gmail address (leave empty to stop sharing)", S.people.find((p) => p.id === id)?.email || "", true);
      if (v !== null) adminOp({ op: "setEmail", id, email: v }, v ? `Saved. ${nm} can open documents once Drive shares the folder.` : "Removed");
    }
    if (act === "rename") { const n = await askText(`Rename ${nm}`, "Name", nm); if (n) adminOp({ op: "renamePerson", id, name: n }, "Renamed"); }
    if (act === "pin") pinSheet(`New PIN for ${nm}`, false, (_, pin) => adminOp({ op: "resetPin", id, pin }, `${nm}'s PIN changed. They'll need to sign in again.`));
    if (act === "remove" && (await confirmBox(`Remove ${nm}?`, "They won't be able to sign in. Their tasks and updates stay.", "Remove", true))) adminOp({ op: "removePerson", id }, `${nm} removed`);
  }));
  $("[data-savelists]").onclick = () => {
    const get = (k) => [...new Set($(`[data-list=${k}]`).value.split("\n").map((s) => s.trim()).filter(Boolean))];
    adminOp({ op: "setLists", categories: get("categories"), forNames: get("forNames") }, "Lists saved");
  };
}

// ---------- change log ----------
async function loadLog() {
  const wrap = $("#logwrap");
  try {
    const { log } = await api("/api/data?log=1&limit=300");
    if (!$("#logwrap")) return;
    let html = `<a class="back" href="#/me">${ico("back")}Profile and settings</a><div class="pagehead"><div><h1>Change log</h1><div class="sub">Every change anyone made. Undo reverses just that one change.</div></div></div>`;
    if (!log.length) html += `<div class="card empty"><h2>No changes yet</h2></div>`;
    let day = "";
    for (const e of log) {
      const d = localDate(e.at);
      if (d !== day) { if (day) html += `</ul></div>`; day = d; html += `<div class="daylabel">${d === today() ? "Today" : d === addDays(today(), -1) ? "Yesterday" : fmtD(d)}</div><div class="card"><ul class="loglist">`; }
      const t = taskById(e.taskId);
      html += `<li class="${e.undone ? "undone" : ""}">${avatar(e.by)}<div class="what"><div><b>${esc(pname(e.by))}</b> <span class="muted small">${fmtTime(e.at)}</span></div>
        <div>${t ? `<a href="#/task/${t.id}">${esc(e.title)}</a>` : `<b>${esc(e.title)}</b>`}</div><div class="sum">${esc(e.summary)}</div>
        ${e.undone ? `<div class="small muted">Undone by ${esc(pname(e.undone.by))}, ${fmtD(e.undone.at)} ${fmtTime(e.undone.at)}</div>` : ""}</div>
        ${e.canUndo ? `<button class="btn small quiet" data-undo="${e.id}">Undo</button>` : ""}</li>`;
    }
    if (day) html += `</ul></div>`;
    wrap.innerHTML = html;
    $$("[data-undo]").forEach((b) => (b.onclick = async () => {
      b.disabled = true; b.textContent = "Undoing…";
      try {
        const j = await post({ op: "undo", logId: b.dataset.undo });
        S.rev = j.rev;
        if (j.deleted) S.tasks = S.tasks.filter((x) => x.id !== j.deleted);
        else if (j.task) { const k = S.tasks.findIndex((x) => x.id === j.task.id); if (k >= 0) S.tasks[k] = j.task; else S.tasks.push(j.task); }
        Object.assign(S.files, j.files || {});
        toast("Undone");
        loadLog();
      } catch (e) { toast(e.message, true); b.disabled = false; b.textContent = "Undo"; }
    }));
  } catch (e) { wrap.innerHTML = `<div class="card empty"><p class="err">${esc(e.message)}</p></div>`; }
}

// ================= start =================
window.addEventListener("hashchange", () => { [...openSheets].forEach((c) => c()); document.querySelectorAll(".overlay").forEach((o) => o.remove()); document.body.style.overflow = ""; render(); });
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") refresh(); });
// Refresh every 45 seconds while someone is using Kaam; pause when it's left idle (saves database usage).
let lastTouch = Date.now();
const wake = () => { const idle = Date.now() - lastTouch > 10 * 60000; lastTouch = Date.now(); if (idle) refresh(); };
["pointerdown", "keydown", "scroll", "focus"].forEach((ev) => window.addEventListener(ev, wake, { passive: true }));
setInterval(() => { if (document.visibilityState === "visible" && Date.now() - lastTouch < 10 * 60000) refresh(); }, 45000);
const back = hashParam("drive");
if (back) {
  history.replaceState(null, "", "#/me");
  const msg = { connected: ["Google Drive connected", false], cancelled: ["Google Drive wasn't connected: you cancelled on Google's page.", true], expired: ["That took too long. Tap Connect Google Drive again.", true], failed: ["Google Drive couldn't be connected. Check the Google setup steps and try again.", true] }[back];
  if (msg) setTimeout(() => toast(msg[0], msg[1]), 600);
}
render();
if (S.token) refresh(true);
