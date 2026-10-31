// Admin connects their Google account once. Google sends them back here with a code.
import { wrap, send, readJson, query, loadConfig, saveConfig, auth, sign, httpErr, redis, K, bumpRev } from "./_lib.js";
import { SCOPES, driveState, saveDriveState, ensureRoot, shareWithPeople } from "./_drive.js";

const base = (req) => process.env.PUBLIC_URL?.replace(/\/$/, "") || `${req.headers["x-forwarded-proto"] || "https"}://${req.headers["x-forwarded-host"] || req.headers.host}`;
const redirectUri = (req) => `${base(req)}/api/google`;
const back = (res, req, msg) => { res.statusCode = 302; res.setHeader("Location", `${base(req)}/#/more?drive=${encodeURIComponent(msg)}`); res.end(); };

export default wrap(async (req, res) => {
  const q = query(req);

  if (req.method === "GET") {
    if (q.error) return back(res, req, "cancelled");
    if (!q.code || !q.state) return back(res, req, "failed");
    const [ts, sig] = String(q.state).split(".");
    if (!ts || sig !== (await sign("g." + ts)) || Date.now() - Number(ts) > 20 * 60000) return back(res, req, "expired");
    const r = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ code: q.code, client_id: process.env.GOOGLE_CLIENT_ID, client_secret: process.env.GOOGLE_CLIENT_SECRET, redirect_uri: redirectUri(req), grant_type: "authorization_code" }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.refresh_token) { console.error("google token", r.status, j); return back(res, req, "failed"); }
    let email = "";
    try { email = JSON.parse(Buffer.from(j.id_token.split(".")[1], "base64url").toString()).email || ""; } catch {}
    let s = (await driveState()) || {};
    if (s.email && email && s.email.toLowerCase() !== email.toLowerCase()) {
      // A different Google account: start a fresh Kaam folder there.
      s = {}; await redis("DEL", K.folders);
    }
    Object.assign(s, { refresh: j.refresh_token, email, connectedAt: new Date().toISOString(), broken: false });
    await saveDriveState(s);
    await redis("SET", K.gtoken, JSON.stringify({ token: j.access_token, exp: Date.now() + j.expires_in * 1000 }));
    await ensureRoot(s);
    const c = await loadConfig();
    if (await shareWithPeople(c)) await saveConfig(c);
    await bumpRev();
    return back(res, req, "connected");
  }

  if (req.method !== "POST") return send(res, 405, { error: "Use GET or POST" });
  const c = await loadConfig();
  const me = await auth(req, c);
  if (!me.admin) throw httpErr(403, "Only the admin can connect Google Drive.");
  const b = await readJson(req);
  if (b.action === "start") {
    if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) throw httpErr(500, "Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in Vercel's Environment Variables, then redeploy. The README has the steps.");
    const ts = String(Date.now());
    const u = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    u.search = new URLSearchParams({ client_id: process.env.GOOGLE_CLIENT_ID, redirect_uri: redirectUri(req), response_type: "code", scope: SCOPES, access_type: "offline", prompt: "consent", state: `${ts}.${await sign("g." + ts)}` });
    return send(res, 200, { url: u.toString() });
  }
  if (b.action === "disconnect") {
    const s = await driveState();
    if (s) { s.refresh = null; await saveDriveState(s); }
    await redis("DEL", K.gtoken);
    await bumpRev();
    return send(res, 200, { ok: true });
  }
  throw httpErr(400, "Unknown action");
});
