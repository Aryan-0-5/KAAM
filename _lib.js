import crypto from "node:crypto";

// ---------- database (Upstash Redis over REST; a local stand-in for testing) ----------
// Works with Vercel's default names, and with a custom prefix if one was chosen when connecting.
function envPair() {
  const e = process.env;
  if (e.KV_REST_API_URL && e.KV_REST_API_TOKEN) return [e.KV_REST_API_URL, e.KV_REST_API_TOKEN];
  if (e.UPSTASH_REDIS_REST_URL && e.UPSTASH_REDIS_REST_TOKEN) return [e.UPSTASH_REDIS_REST_URL, e.UPSTASH_REDIS_REST_TOKEN];
  for (const k of Object.keys(e)) {
    const m = k.match(/^(.*)(KV_REST_API|UPSTASH_REDIS_REST)_URL$/);
    if (m && e[`${m[1]}${m[2]}_TOKEN`]) return [e[k], e[`${m[1]}${m[2]}_TOKEN`]];
  }
  return [];
}
const [URL_, TOKEN] = envPair();

export async function redis(...cmd) {
  if (globalThis.__kaamLocalRedis) return globalThis.__kaamLocalRedis(cmd);
  if (!URL_ || !TOKEN) throw httpErr(500, "Database not connected. In Vercel, open Storage and connect Upstash Redis, then redeploy.");
  const r = await fetch(URL_, {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(cmd.map(String)),
  });
  const j = await r.json();
  if (j.error) throw new Error(j.error);
  return j.result;
}

export const K = {
  config: "kaam:config",
  tasks: "kaam:tasks",
  files: "kaam:files",
  log: "kaam:log",
  logIds: "kaam:logids",
  rev: "kaam:rev",
  secret: "kaam:secret",
  drive: "kaam:drive",
  gtoken: "kaam:gtoken",
  folders: "kaam:folders",
  fail: (id) => `kaam:fail:${id}`,
};

// ---------- small helpers ----------
export function httpErr(status, msg) { const e = new Error(msg); e.status = status; return e; }
export const uid = (n = 10) => crypto.randomBytes(n).toString("base64url").replace(/[-_]/g, "").slice(0, n);

export function send(res, status, obj) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(obj));
}

export async function readRaw(req) {
  let b;
  try { b = req.body; } catch { b = undefined; }
  if (Buffer.isBuffer(b)) return b;
  if (typeof b === "string") return Buffer.from(b);
  if (b && typeof b === "object") return Buffer.from(JSON.stringify(b));
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return Buffer.concat(chunks);
}

export async function readJson(req) {
  let b;
  try { b = req.body; } catch { b = undefined; }
  if (b && typeof b === "object" && !Buffer.isBuffer(b)) return b;
  const raw = await readRaw(req);
  if (!raw.length) return {};
  try { return JSON.parse(raw.toString("utf8")); } catch { throw httpErr(400, "Bad request"); }
}

export function query(req) {
  return Object.fromEntries(new URL(req.url, "http://x").searchParams);
}

export function wrap(fn) {
  return async (req, res) => {
    try { await fn(req, res); }
    catch (e) {
      if (!e.status) console.error(e);
      if (!res.headersSent) send(res, e.status || 500, { error: e.status ? e.message : "Something went wrong on the server. Try again." });
    }
  };
}

// ---------- secrets, PINs, tokens ----------
let secretCache;
export async function secret() {
  if (process.env.SECRET) return process.env.SECRET;
  if (secretCache) return secretCache;
  let s = await redis("GET", K.secret);
  if (!s) {
    s = crypto.randomBytes(32).toString("hex");
    await redis("SET", K.secret, s, "NX");
    s = await redis("GET", K.secret);
  }
  return (secretCache = s);
}

export async function sign(text) {
  return crypto.createHmac("sha256", await secret()).update(text).digest("base64url");
}

export function hashPin(pin, salt) {
  return crypto.scryptSync(String(pin), salt, 32).toString("hex");
}

export async function makeToken(p) {
  const body = Buffer.from(JSON.stringify({ p: p.id, v: p.pinVer || 1, t: Date.now() })).toString("base64url");
  return body + "." + (await sign("tok." + body));
}

export function validPin(pin) { return /^\d{4,8}$/.test(String(pin || "")); }

// ---------- config: people, categories, "for" names ----------
const COLORS = ["#1F4E8C", "#B5522E", "#2E7D4F", "#7A4E8C", "#8C6D1F", "#2C7A87", "#A23B5E", "#4A5A6A"];
export const DEFAULT_CATS = ["Personal", "Family", "MDC", "Property", "Bank", "Tax", "Insurance", "Vehicle", "Other"];

export async function loadConfig(raw) {
  let c = JSON.parse((raw === undefined ? await redis("GET", K.config) : raw) || "null");
  if (!c) {
    const pin = process.env.ADMIN_PIN;
    if (!validPin(pin)) throw httpErr(500, "Set ADMIN_PIN (4 to 8 digits) in Vercel's Environment Variables, then redeploy.");
    const salt = uid(16);
    c = {
      people: [{ id: uid(8), name: ADMIN_NAME(), admin: true, color: "#4A5A6A", salt, pin: hashPin(pin, salt), pinVer: 1 }],
      forNames: [],
      categories: DEFAULT_CATS,
    };
    await redis("SET", K.config, JSON.stringify(c), "NX");
    c = JSON.parse(await redis("GET", K.config));
  }
  return c;
}
export async function saveConfig(c) { await redis("SET", K.config, JSON.stringify(c)); }
export const nextColor = (c) => COLORS.find((x) => !c.people.some((p) => p.color === x)) || COLORS[c.people.length % COLORS.length];

export function publicPeople(c) {
  return c.people.map(({ id, name, admin, color, email }) => ({ id, name, admin: !!admin, color, email: email || "" }));
}

export async function auth(req, c) {
  const tok = req.headers["x-kaam-token"] || "";
  const [body, sig] = String(tok).split(".");
  if (!body || !sig || (await sign("tok." + body)) !== sig) throw httpErr(401, "Please sign in again.");
  let d;
  try { d = JSON.parse(Buffer.from(body, "base64url").toString()); } catch { throw httpErr(401, "Please sign in again."); }
  const p = c.people.find((x) => x.id === d.p);
  if (!p || (p.pinVer || 1) !== d.v) throw httpErr(401, "Please sign in again.");
  return p;
}

export const ADMIN_NAME = () => process.env.ADMIN_NAME || "Admin";
export const istDate = (iso) => new Date(iso || Date.now()).toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
export async function bumpRev() { return Number(await redis("INCR", K.rev)); }
