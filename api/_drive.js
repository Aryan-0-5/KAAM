// Google Drive: the admin's Drive holds every document, in Kaam/<task>/.
// Removed files go to Kaam/<task>/Removed; deleted tasks go to Kaam/Deleted tasks.
import { redis, K, httpErr, istDate } from "./_lib.js";

const API = "https://www.googleapis.com";
const FOLDER = "application/vnd.google-apps.folder";
export const SCOPES = "https://www.googleapis.com/auth/drive.file openid email";

export async function driveState() { return JSON.parse((await redis("GET", K.drive)) || "null"); }
export async function saveDriveState(s) { await redis("SET", K.drive, JSON.stringify(s)); }
export const isConnected = (s) => !!(s && s.root && s.refresh && !s.broken);

// ---------- low-level calls (real Google, or a local fake for testing) ----------
async function accessToken() {
  const s = await driveState();
  if (!s || !s.refresh) throw httpErr(409, "Google Drive isn't connected yet. Ask the admin to connect it in their profile settings.");
  const c = JSON.parse((await redis("GET", K.gtoken)) || "null");
  if (c && c.exp > Date.now() + 60000) return c.token;
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: process.env.GOOGLE_CLIENT_ID, client_secret: process.env.GOOGLE_CLIENT_SECRET, refresh_token: s.refresh, grant_type: "refresh_token" }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    if (j.error === "invalid_grant") { s.broken = true; await saveDriveState(s); }
    throw httpErr(502, "The Google Drive connection stopped working. Ask the admin to reconnect it in their profile settings.");
  }
  await redis("SET", K.gtoken, JSON.stringify({ token: j.access_token, exp: Date.now() + j.expires_in * 1000 }));
  return j.access_token;
}

async function gfetch(method, url, { json, body, headers = {}, raw } = {}) {
  const tok = await accessToken();
  const h = { Authorization: `Bearer ${tok}`, ...headers };
  if (json !== undefined) { h["Content-Type"] = "application/json; charset=UTF-8"; body = JSON.stringify(json); }
  const r = await fetch(url, { method, headers: h, body });
  if (raw) return r;
  const text = await r.text();
  let j = {};
  try { j = text ? JSON.parse(text) : {}; } catch {}
  if (!r.ok) {
    console.error("Drive error", method, url, r.status, text.slice(0, 500));
    throw httpErr(502, `Google Drive said no (${r.status}): ${j.error?.message || "unknown error"}`);
  }
  return j;
}

const real = {
  async createFolder(name, parent) {
    const j = await gfetch("POST", `${API}/drive/v3/files?fields=id`, { json: { name, mimeType: FOLDER, ...(parent ? { parents: [parent] } : {}) } });
    return j.id;
  },
  async rename(id, name) { await gfetch("PATCH", `${API}/drive/v3/files/${id}?fields=id`, { json: { name } }); },
  async move(id, to, from) { await gfetch("PATCH", `${API}/drive/v3/files/${id}?addParents=${to}&removeParents=${from}&fields=id`, { json: {} }); },
  async trash(id) { await gfetch("PATCH", `${API}/drive/v3/files/${id}?fields=id`, { json: { trashed: true } }); },
  async getFile(id) { return gfetch("GET", `${API}/drive/v3/files/${id}?fields=id,name,size,mimeType,parents,trashed`); },
  async uploadSmall(name, type, buf, parent) {
    const b = "kaam" + Math.random().toString(36).slice(2);
    const meta = JSON.stringify({ name, parents: [parent] });
    const body = Buffer.concat([
      Buffer.from(`--${b}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n--${b}\r\nContent-Type: ${type}\r\n\r\n`),
      buf, Buffer.from(`\r\n--${b}--`),
    ]);
    return gfetch("POST", `${API}/upload/drive/v3/files?uploadType=multipart&fields=id,size`, { body, headers: { "Content-Type": `multipart/related; boundary=${b}` } });
  },
  // A resumable session lets the phone send the file straight to Drive (no 4 MB limit).
  async startResumable(name, type, size, parent, origin) {
    const r = await gfetch("POST", `${API}/upload/drive/v3/files?uploadType=resumable&fields=id,size`, {
      json: { name, parents: [parent] }, raw: true,
      headers: { "X-Upload-Content-Type": type, "X-Upload-Content-Length": String(size), ...(origin ? { Origin: origin } : {}) },
    });
    if (!r.ok) { console.error("Drive resumable", r.status, await r.text()); throw httpErr(502, "Couldn't start the upload to Google Drive."); }
    return r.headers.get("location");
  },
  async sessionResult(session, size) {
    const r = await fetch(session, { method: "PUT", headers: { "Content-Range": `bytes */${size}` } });
    if (r.status === 200 || r.status === 201) return r.json();
    return null;
  },
  async share(fileId, email) {
    const j = await gfetch("POST", `${API}/drive/v3/files/${fileId}/permissions?sendNotificationEmail=true&fields=id`, { json: { role: "reader", type: "user", emailAddress: email } });
    return j.id;
  },
  async unshare(fileId, permId) { await gfetch("DELETE", `${API}/drive/v3/files/${fileId}/permissions/${permId}`).catch(() => {}); },
};
export const D = new Proxy({}, { get: (_, k) => (globalThis.__kaamLocalDrive || real)[k] });

export const viewLink = (id) => `https://drive.google.com/file/d/${id}/view`;
export const folderLink = (id) => `https://drive.google.com/drive/folders/${id}`;

// ---------- folders ----------
const clean = (s, n = 110) => String(s || "").replace(/[\\/\u0000-\u001f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, n).trim();
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function folderName(t) {
  let n = clean(t.title) || "Untitled task";
  if (t.status === "done" || t.status === "dropped") {
    const d = new Date(t.closedAt || Date.now());
    n += ` (${t.status === "done" ? "Done" : "Dropped"} ${MON[d.getMonth()]} ${d.getFullYear()})`;
  }
  return n;
}

export async function ensureRoot(s) {
  s = s || (await driveState());
  if (!s.root) { s.root = await D.createFolder("Kaam"); await saveDriveState(s); }
  return s;
}
async function deletedFolder(s) {
  if (!s.deleted) { s.deleted = await D.createFolder("Deleted tasks", s.root); await saveDriveState(s); }
  return s.deleted;
}
export async function getFolder(taskId) { return JSON.parse((await redis("HGET", K.folders, taskId)) || "null"); }
async function setFolder(taskId, f) { await redis("HSET", K.folders, taskId, JSON.stringify(f)); }

export async function ensureTaskFolder(task) {
  const s = await ensureRoot();
  let f = await getFolder(task.id);
  if (f) return f;
  const id = await D.createFolder(folderName(task), s.root);
  f = { id, name: folderName(task), parent: s.root };
  const won = await redis("HSETNX", K.folders, task.id, JSON.stringify(f));
  if (!Number(won)) { await D.trash(id).catch(() => {}); return getFolder(task.id); }
  return f;
}
async function ensureRemoved(taskId) {
  const f = await getFolder(taskId);
  if (!f.removed) { f.removed = await D.createFolder("Removed", f.id); await setFolder(taskId, f); }
  return f.removed;
}

// ---------- file names & where a file sits in a task ----------
function extOf(meta) {
  const m = String(meta.origName || "").match(/\.([a-z0-9]{1,5})$/i);
  if (m) return "." + m[1].toLowerCase();
  return { "image/jpeg": ".jpg", "image/png": ".png", "application/pdf": ".pdf" }[meta.type] || "";
}
export function locate(t, id) {
  if (!t) return null;
  for (const e of t.entries || []) { const i = (e.files || []).findIndex((f) => f.id === id); if (i >= 0) return { kind: "entry", e, i, n: e.files.length, ref: e.files[i] }; }
  for (const r of t.reqs || []) { const i = (r.files || []).findIndex((f) => f.id === id); if (i >= 0) return { kind: "req", r, i, n: r.files.length, ref: r.files[i] }; }
  const i = (t.files || []).findIndex((f) => f.id === id);
  if (i >= 0) return { kind: "general", i, ref: t.files[i] };
  return null;
}
const fmt = (d) => { const x = new Date(d + "T00:00:00"); return `${x.getDate()} ${MON[x.getMonth()]} ${x.getFullYear()}`; };
export function placeLabel(loc) {
  if (!loc) return "Not attached";
  if (loc.kind === "entry") return `Update on ${fmt(loc.e.date)}`;
  if (loc.kind === "req") return `Needed item: ${loc.r.text}`;
  return "General documents";
}
function firstWords(s, n = 7) { return clean(String(s || "").split(/\s+/).slice(0, n).join(" ").replace(/[.,;:]+$/, ""), 70); }
export function fileName(t, loc, meta) {
  const num = loc.n > 1 ? ` (${loc.i + 1})` : "";
  let base;
  if (loc.kind === "entry") base = `${loc.e.date} ${firstWords(loc.e.text) || "Update"}${num}`;
  else if (loc.kind === "req") base = `${clean(loc.r.text, 90)}${num}`;
  else base = `${istDate(meta.at)} ${clean(String(meta.origName || "File").replace(/\.[a-z0-9]{1,5}$/i, ""), 90)}`;
  return base + extOf(meta);
}

const refsOf = (t) => {
  const m = new Map();
  if (!t) return m;
  for (const f of t.files || []) m.set(f.id, f);
  for (const r of t.reqs || []) for (const f of r.files || []) m.set(f.id, f);
  for (const e of t.entries || []) for (const f of e.files || []) m.set(f.id, f);
  return m;
};

// ---------- keep Drive in step with a task change ----------
// before/after are the task before and after a change (null = didn't exist / deleted).
export async function syncTask(before, after, me) {
  const s = await driveState();
  if (!isConnected(s)) return;
  const tid = (after || before).id;
  const folder = await getFolder(tid);
  const now = new Date().toISOString();
  const ev = (text) => ({ at: now, by: me.id, text });

  if (folder) {
    if (!after && folder.parent !== (await deletedFolder(s))) {
      await D.move(folder.id, s.deleted, folder.parent); folder.parent = s.deleted; await setFolder(tid, folder);
    } else if (after && folder.parent !== s.root) {
      await D.move(folder.id, s.root, folder.parent); folder.parent = s.root; await setFolder(tid, folder);
    }
    if (after && folderName(after) !== folder.name) {
      await D.rename(folder.id, folderName(after)); folder.name = folderName(after); await setFolder(tid, folder);
    }
  }
  if (!after) return;

  const rb = refsOf(before), ra = refsOf(after);
  const ids = [...new Set([...rb.keys(), ...ra.keys()])];
  if (!ids.length) return;
  const rows = await redis("HMGET", K.files, ...ids);
  for (let k = 0; k < ids.length; k++) {
    if (!rows[k]) continue;
    const id = ids[k], meta = JSON.parse(rows[k]);
    if (!meta.driveId || meta.pending) continue;
    const hist = meta.history || (meta.history = []);
    const a = ra.get(id), b = rb.get(id);
    let dirty = false;
    try {
      if (a) {
        const loc = locate(after, id);
        if (meta.removed) {
          const home = (await getFolder(tid))?.id;
          if (home && meta.parent !== home) { await D.move(meta.driveId, home, meta.parent); meta.parent = home; }
          meta.removed = false;
          hist.push(ev(meta.attached ? `Put back: ${placeLabel(loc)}` : `Attached to ${placeLabel(loc)}`));
          dirty = true;
        } else if (!b) {
          hist.push(ev(`Attached to ${placeLabel(loc)}`)); dirty = true;
        } else if (placeLabel(locate(before, id)) !== placeLabel(loc)) {
          hist.push(ev(`Now under ${placeLabel(loc)}`)); dirty = true;
        }
        if (!meta.attached) {
          meta.attached = { at: now, where: placeLabel(loc), text: loc.kind === "entry" ? loc.e.text || "" : "", status: after.status, waitingOn: after.waitingOn || "", statusText: after.statusText || "" };
          dirty = true;
        }
        const want = fileName(after, loc, meta);
        if (want !== meta.name) {
          await D.rename(meta.driveId, want);
          hist.push(ev(meta.name === meta.origName ? `Saved in Drive as "${want}"` : `Renamed in Drive to "${want}"`));
          meta.name = want; dirty = true;
        }
        if (b && (a.desc || "") !== (b.desc || "")) { hist.push(ev(a.desc ? "Description changed" : "Description cleared")); dirty = true; }
        if (b && (a.note || "") !== (b.note || "")) { hist.push(ev(a.note ? "Notes changed" : "Notes cleared")); dirty = true; }
      } else if (b && !meta.removed) {
        const rem = await ensureRemoved(tid);
        if (meta.parent !== rem) { await D.move(meta.driveId, rem, meta.parent); meta.parent = rem; }
        meta.removed = true;
        const was = locate(before, id);
        meta.lastPlace = { kind: was.kind, id: was.kind === "entry" ? was.e.id : was.kind === "req" ? was.r.id : "", ref: b };
        hist.push(ev(`Removed from ${placeLabel(was)}. Moved to the task's Removed folder in Drive.`));
        dirty = true;
      }
    } catch (e) { console.error("sync file", id, e.message); }
    if (dirty) await redis("HSET", K.files, id, JSON.stringify(meta));
  }
}

export async function discard(meta, me, why) {
  if (!meta.driveId || meta.removed) return meta;
  const rem = await ensureRemoved(meta.taskId);
  if (meta.parent !== rem) { await D.move(meta.driveId, rem, meta.parent); meta.parent = rem; }
  meta.removed = true;
  (meta.history ||= []).push({ at: new Date().toISOString(), by: me.id, text: why });
  await redis("HSET", K.files, meta.id, JSON.stringify(meta));
  return meta;
}

// Give each family member with a Gmail view access to the Kaam folder.
export async function shareWithPeople(c) {
  const s = await driveState();
  if (!isConnected(s)) return false;
  let changed = false;
  for (const p of c.people) {
    const email = (p.email || "").toLowerCase();
    if (p.sharedWith && p.sharedWith !== email) { if (p.permId) await D.unshare(s.root, p.permId); delete p.permId; delete p.sharedWith; changed = true; }
    if (email && !p.sharedWith && email !== (s.email || "").toLowerCase()) {
      try { p.permId = await D.share(s.root, email); p.sharedWith = email; delete p.shareError; changed = true; }
      catch (e) { console.error("share", email, e.message); p.shareError = e.message; changed = true; }
    }
    if (email && email === (s.email || "").toLowerCase() && !p.sharedWith) { p.sharedWith = email; changed = true; }
  }
  return changed;
}
