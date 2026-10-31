import { wrap, send, readJson, query, loadConfig, saveConfig, publicPeople, auth, redis, K, httpErr, uid, hashPin, validPin, nextColor, bumpRev } from "./_lib.js";
import { diff, apply, invert, isEmpty } from "../diff.js";
import { driveState, isConnected, syncTask, shareWithPeople, viewLink, folderLink, getFolder } from "./_drive.js";

const pairs = (arr) => { const o = {}; for (let i = 0; i < (arr || []).length; i += 2) o[arr[i]] = arr[i + 1]; return o; };
const LOG_KEEP = 2000;
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

async function allTasks() {
  return Object.values(pairs(await redis("HGETALL", K.tasks))).map((s) => JSON.parse(s));
}
async function getTask(id) {
  const s = await redis("HGET", K.tasks, id);
  return s ? JSON.parse(s) : null;
}

function eachRef(t, fn) {
  for (const f of t.files || []) fn(f);
  for (const r of t.reqs || []) for (const f of r.files || []) fn(f);
  for (const e of t.entries || []) for (const f of e.files || []) fn(f);
}

function clean(t) {
  if (!t || typeof t !== "object") throw httpErr(400, "Bad task");
  if (!String(t.title || "").trim()) throw httpErr(400, "Give the task a name.");
  delete t.private;
  eachRef(t, (f) => { delete f.link; delete f.locked; });
  for (const L of ["files", "reqs", "entries"]) if (!Array.isArray(t[L])) t[L] = [];
  if (JSON.stringify(t).length > 400000) throw httpErr(400, "This task has too much text. Split it into two tasks.");
  return t;
}

// Keep Drive in step, but never let a Drive hiccup lose the change itself.
async function sync(before, after, me) {
  try { await syncTask(before, after, me); } catch (e) { console.error("drive sync", e.message); }
}

async function addLog(me, task, d, summary, extra = {}) {
  const e = { id: Date.now().toString(36) + uid(4), at: new Date().toISOString(), by: me.id, taskId: task.id, title: task.title, summary: String(summary || "Changed task").slice(0, 300), d, ...extra };
  await redis("HSET", K.log, e.id, JSON.stringify(e));
  await redis("LPUSH", K.logIds, e.id);
  const extraIds = await redis("LRANGE", K.logIds, LOG_KEEP, -1);
  if (extraIds && extraIds.length) {
    await redis("LTRIM", K.logIds, 0, LOG_KEEP - 1);
    await redis("HDEL", K.log, ...extraIds);
  }
  return e;
}

async function create(t) {
  if (await getTask(t.id)) throw httpErr(409, "That task already exists.");
  await redis("HSET", K.tasks, t.id, JSON.stringify(clean(t)));
  return t;
}
async function remove(id) {
  const cur = await getTask(id);
  if (!cur) throw httpErr(409, "That task is already deleted.");
  await redis("HDEL", K.tasks, id);
  return cur;
}

function fileView(m) {
  return {
    id: m.id, name: m.name, origName: m.origName, type: m.type, size: m.size, by: m.by, at: m.at, taskId: m.taskId,
    removed: !!m.removed, history: m.history || [], attached: m.attached || null, lastPlace: m.lastPlace || null,
    link: m.driveId ? viewLink(m.driveId) : null,
  };
}

export default wrap(async (req, res) => {
  // One database command for the common case (a refresh where nothing changed).
  const [cfgRaw, revRaw] = await redis("MGET", K.config, K.rev);
  const c = await loadConfig(cfgRaw);
  const me = await auth(req, c);

  if (req.method === "GET") {
    const q = query(req);
    if (q.log) {
      const ids = (await redis("LRANGE", K.logIds, 0, Math.min(Number(q.limit) || 300, LOG_KEEP) - 1)) || [];
      const rows = ids.length ? await redis("HMGET", K.log, ...ids) : [];
      const log = rows.filter(Boolean).map((s) => {
        const e = JSON.parse(s);
        return { id: e.id, at: e.at, by: e.by, taskId: e.taskId, title: e.title, summary: e.summary, undone: e.undone || null, undoOf: e.undoOf || null, canUndo: !e.undone && (me.admin || e.by === me.id) };
      });
      return send(res, 200, { log });
    }
    const rev = Number(revRaw) || 0;
    if (q.since && Number(q.since) === rev) return send(res, 200, { same: true, rev });
    const [tasks, metas, ds, folders] = await Promise.all([allTasks(), redis("HGETALL", K.files), driveState(), redis("HGETALL", K.folders)]);
    const files = {};
    for (const [id, s] of Object.entries(pairs(metas))) { const m = JSON.parse(s); if (!m.pending && m.driveId) files[id] = fileView(m); }
    const fold = {};
    for (const [tid, s] of Object.entries(pairs(folders))) fold[tid] = folderLink(JSON.parse(s).id);
    const people = publicPeople(c).map((p) => {
      if (!me.admin) { delete p.email; return p; }
      const full = c.people.find((x) => x.id === p.id);
      return { ...p, shared: !!full.sharedWith, shareError: full.shareError || "" };
    });
    return send(res, 200, {
      rev, me: me.id, people,
      categories: c.categories, forNames: c.forNames || [],
      drive: { connected: isConnected(ds), email: ds?.email || "", broken: !!ds?.broken, folder: ds?.root ? folderLink(ds.root) : "", configured: !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) || !!globalThis.__kaamLocalDrive },
      tasks, files, folders: fold,
    });
  }

  if (req.method !== "POST") return send(res, 405, { error: "Use GET or POST" });
  const b = await readJson(req);
  // Send back the task plus the file details it touches, so the app shows new names straight away.
  const reply = async (task, rev, extra = {}, also = []) => {
    const files = {};
    const ids = [...also]; if (task) eachRef(task, (f) => ids.push(f.id));
    const rows = ids.length ? await redis("HMGET", K.files, ...ids) : [];
    rows.forEach((s) => { if (s) { const m = JSON.parse(s); if (m.driveId) files[m.id] = fileView(m); } });
    const f = task ? await getFolder(task.id) : null;
    send(res, 200, { rev, task, files, folder: f ? folderLink(f.id) : "", ...extra });
  };
  const refIds = (t) => { const a = []; if (t) eachRef(t, (f) => a.push(f.id)); return a; };

  if (b.op === "create") {
    const t = clean(b.task);
    t.id = t.id || uid(10);
    t.createdBy = me.id; t.createdAt = new Date().toISOString();
    await create(t);
    await addLog(me, t, { create: t }, b.summary || "Created task");
    return reply(t, await bumpRev());
  }

  if (b.op === "change") {
    const cur = await getTask(b.taskId);
    if (!cur) throw httpErr(404, "This task was deleted by someone. Go back to All tasks.");
    const before = JSON.parse(JSON.stringify(cur));
    const next = clean(apply(cur, b.diff || {}));
    next.id = cur.id;
    const real = diff(before, next);
    if (isEmpty(real)) return reply(before, Number(revRaw) || 0);
    await redis("HSET", K.tasks, next.id, JSON.stringify(next));
    await addLog(me, next, real, b.summary);
    const rev = await bumpRev();
    await sync(before, next, me);
    return reply(next, rev, {}, refIds(before));
  }

  if (b.op === "delete") {
    if (!me.admin) throw httpErr(403, "Only the admin can delete tasks.");
    const cur = await remove(b.taskId);
    await addLog(me, cur, { del: cur }, "Deleted task");
    const rev = await bumpRev();
    await sync(cur, null, me);
    return reply(null, rev, { deleted: cur.id });
  }

  if (b.op === "undo") {
    const s = await redis("HGET", K.log, b.logId);
    if (!s) throw httpErr(404, "That change is too old to undo.");
    const e = JSON.parse(s);
    if (e.undone) throw httpErr(409, "That change was already undone.");
    if (!me.admin && e.by !== me.id) throw httpErr(403, "You can only undo your own changes.");
    let before = null, after = null, done;
    if (e.d.create) {
      before = await remove(e.d.create.id); done = { del: before };
    } else if (e.d.del) {
      after = await create(JSON.parse(JSON.stringify(e.d.del))); done = { create: after };
    } else {
      const cur = await getTask(e.taskId);
      if (!cur) throw httpErr(409, "This task has been deleted. Undo the delete first.");
      before = JSON.parse(JSON.stringify(cur));
      after = clean(apply(cur, invert(e.d)));
      after.id = cur.id;
      done = diff(before, after);
      if (isEmpty(done)) throw httpErr(409, "Nothing to undo: this was already changed back.");
      await redis("HSET", K.tasks, after.id, JSON.stringify(after));
    }
    e.undone = { by: me.id, at: new Date().toISOString() };
    await redis("HSET", K.log, e.id, JSON.stringify(e));
    await addLog(me, after || before, done, `Undid: ${e.summary}`, { undoOf: e.id });
    const rev = await bumpRev();
    await sync(before, after, me);
    return after ? reply(after, rev, {}, refIds(before)) : reply(null, rev, { deleted: before.id });
  }

  // ----- lists (anyone can add) -----
  const name = String(b.name || "").trim().slice(0, 40);
  if (b.op === "addCategory" || b.op === "addFor") {
    if (!name) throw httpErr(400, "Type a name.");
    const key = b.op === "addCategory" ? "categories" : "forNames";
    c[key] = c[key] || [];
    if (!c[key].some((x) => x.toLowerCase() === name.toLowerCase())) c[key].push(name);
    await saveConfig(c);
    return send(res, 200, { rev: await bumpRev() });
  }

  // ----- admin only -----
  if (!me.admin) throw httpErr(403, "Only the admin can do this.");
  const share = async () => { try { await shareWithPeople(c); } catch (e) { console.error("share", e.message); } };

  if (b.op === "setLists") {
    if (Array.isArray(b.categories)) c.categories = b.categories.map((x) => String(x).trim()).filter(Boolean);
    if (Array.isArray(b.forNames)) c.forNames = b.forNames.map((x) => String(x).trim()).filter(Boolean);
    await saveConfig(c);
    return send(res, 200, { rev: await bumpRev() });
  }
  if (b.op === "addPerson") {
    if (!name) throw httpErr(400, "Type their name.");
    if (!validPin(b.pin)) throw httpErr(400, "PIN must be 4 to 8 digits.");
    if (c.people.length >= 12) throw httpErr(400, "That's the maximum number of people.");
    const email = String(b.email || "").trim().toLowerCase();
    if (email && !EMAIL.test(email)) throw httpErr(400, "That email address doesn't look right.");
    const salt = uid(16);
    c.people.push({ id: uid(8), name, admin: false, color: nextColor(c), salt, pin: hashPin(b.pin, salt), pinVer: 1, email });
    await share();
    await saveConfig(c);
    return send(res, 200, { rev: await bumpRev() });
  }
  if (b.op === "reshare") {
    c.people.forEach((p) => delete p.shareError);
    await share();
    await saveConfig(c);
    return send(res, 200, { rev: await bumpRev() });
  }
  const p = c.people.find((x) => x.id === b.id);
  if (!p) throw httpErr(404, "Person not found.");
  if (b.op === "renamePerson") {
    if (!name) throw httpErr(400, "Type their name.");
    p.name = name;
  } else if (b.op === "setEmail") {
    const email = String(b.email || "").trim().toLowerCase();
    if (email && !EMAIL.test(email)) throw httpErr(400, "That email address doesn't look right.");
    p.email = email; delete p.shareError;
    await share();
  } else if (b.op === "resetPin") {
    if (!validPin(b.pin)) throw httpErr(400, "PIN must be 4 to 8 digits.");
    p.salt = uid(16); p.pin = hashPin(b.pin, p.salt); p.pinVer = (p.pinVer || 1) + 1;
    await redis("DEL", K.fail(p.id));
  } else if (b.op === "removePerson") {
    if (p.admin) throw httpErr(400, "The admin can't be removed.");
    p.email = "";
    await share();
    c.people = c.people.filter((x) => x.id !== p.id);
  } else throw httpErr(400, "Unknown action");
  await saveConfig(c);
  return send(res, 200, { rev: await bumpRev() });
});
