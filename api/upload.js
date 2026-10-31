// Uploads go straight from the phone to Google Drive when possible (no size limit worth worrying about).
// If the phone can't talk to Drive directly, the file comes through here instead (up to 4 MB).
import { wrap, send, readJson, readRaw, query, loadConfig, auth, redis, K, httpErr, uid } from "./_lib.js";
import { driveState, isConnected, ensureTaskFolder, D, discard } from "./_drive.js";

const MAX_DIRECT = 200 * 1024 * 1024, MAX_RELAY = 4.2 * 1024 * 1024;

async function getMeta(id) { const s = await redis("HGET", K.files, id); return s ? JSON.parse(s) : null; }
async function putMeta(m) { await redis("HSET", K.files, m.id, JSON.stringify(m)); }

function finish(meta, me, f) {
  meta.driveId = f.id;
  meta.size = Number(f.size) || meta.size;
  meta.pending = false;
  meta.name = meta.origName;
  delete meta.session;
  meta.history = [{ at: new Date().toISOString(), by: me.id, text: `Uploaded "${meta.origName}"` }];
  return { id: meta.id, name: meta.origName, type: meta.type, size: meta.size, by: meta.by, at: meta.at };
}

export default wrap(async (req, res) => {
  if (req.method !== "POST") return send(res, 405, { error: "Use POST" });
  const c = await loadConfig();
  const me = await auth(req, c);
  const q = query(req);

  // Relay path: raw file bytes in the body.
  if (q.action === "relay") {
    const meta = await getMeta(q.id);
    if (!meta || !meta.pending) throw httpErr(404, "Upload not found. Try again.");
    const buf = await readRaw(req);
    if (!buf.length) throw httpErr(400, "The file is empty.");
    if (buf.length > MAX_RELAY) throw httpErr(413, "This file is over 4 MB and couldn't go to Drive directly. Take photos of the pages instead.");
    const f = await D.uploadSmall(meta.origName, meta.type, buf, meta.parent);
    const ref = finish(meta, me, { id: f.id, size: f.size || buf.length });
    await putMeta(meta);
    return send(res, 200, { file: ref });
  }

  const b = await readJson(req);

  if (b.action === "start") {
    if (!isConnected(await driveState())) throw httpErr(409, "Google Drive isn't connected yet, so files can't be saved. Ask the admin to connect it in More.");
    const ts = await redis("HGET", K.tasks, String(b.task || ""));
    if (!ts) throw httpErr(404, "Save the task first, then attach files.");
    const task = JSON.parse(ts);
    const size = Number(b.size) || 0;
    if (!size) throw httpErr(400, "The file is empty.");
    if (size > MAX_DIRECT) throw httpErr(413, "That file is over 200 MB.");
    const folder = await ensureTaskFolder(task);
    const name = String(b.name || "File").replace(/[\\/\u0000-\u001f]/g, "_").slice(0, 120);
    const type = String(b.type || "application/octet-stream").slice(0, 100);
    const meta = { id: uid(12), pending: true, origName: name, name, type, size, by: me.id, at: new Date().toISOString(), taskId: task.id, parent: folder.id };
    let session = null;
    try { session = await D.startResumable(name, type, size, folder.id, req.headers.origin || ""); } catch (e) { console.error("resumable", e.message); }
    meta.session = session;
    await putMeta(meta);
    return send(res, 200, { id: meta.id, session, relayMax: MAX_RELAY });
  }

  if (b.action === "finish") {
    const meta = await getMeta(b.id);
    if (!meta) throw httpErr(404, "Upload not found. Try again.");
    if (!meta.pending) return send(res, 200, { file: { id: meta.id, name: meta.origName, type: meta.type, size: meta.size, by: meta.by, at: meta.at } });
    let f = null;
    if (b.driveId) {
      try { const g = await D.getFile(b.driveId); if ((g.parents || []).includes(meta.parent) && !g.trashed) f = g; } catch {}
    }
    if (!f && meta.session) f = await D.sessionResult(meta.session, meta.size).catch(() => null);
    if (!f) throw httpErr(409, "The file didn't reach Google Drive.");
    const ref = finish(meta, me, f);
    await putMeta(meta);
    return send(res, 200, { file: ref });
  }

  // Files picked in a form that was then cancelled: keep them, but out of the way.
  if (b.action === "discard") {
    for (const id of (b.ids || []).slice(0, 50)) {
      const meta = await getMeta(id);
      if (!meta || meta.pending) continue;
      const t = await redis("HGET", K.tasks, meta.taskId);
      const used = t && JSON.stringify(JSON.parse(t)).includes(`"id":"${id}"`);
      if (!used) await discard(meta, me, "Uploaded, but the form was cancelled without saving. Moved to the task's Removed folder in Drive.").catch((e) => console.error(e));
    }
    return send(res, 200, { ok: true });
  }

  throw httpErr(400, "Unknown action");
});
