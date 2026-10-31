import { wrap, send, readJson, loadConfig, saveConfig, publicPeople, hashPin, makeToken, redis, K, auth, httpErr, validPin, uid } from "./_lib.js";

const MAX_TRIES = 5, LOCK_SECONDS = 15 * 60;

export default wrap(async (req, res) => {
  if (req.method !== "POST") return send(res, 405, { error: "Use POST" });
  const b = await readJson(req);
  const c = await loadConfig();

  if (b.action === "people") return send(res, 200, { people: publicPeople(c) });

  if (b.action === "login") {
    const p = c.people.find((x) => x.id === b.person);
    if (!p) throw httpErr(400, "Pick your name first.");
    const tries = Number(await redis("GET", K.fail(p.id))) || 0;
    if (tries >= MAX_TRIES) throw httpErr(429, "Too many wrong PINs. Wait 15 minutes, or ask the admin to reset your PIN.");
    if (hashPin(String(b.pin || ""), p.salt) !== p.pin) {
      await redis("INCR", K.fail(p.id));
      await redis("EXPIRE", K.fail(p.id), LOCK_SECONDS);
      const left = MAX_TRIES - tries - 1;
      throw httpErr(401, left > 0 ? `Wrong PIN. ${left} ${left === 1 ? "try" : "tries"} left.` : "Wrong PIN. Locked for 15 minutes.");
    }
    await redis("DEL", K.fail(p.id));
    return send(res, 200, { token: await makeToken(p), me: p.id });
  }

  if (b.action === "mypin") {
    const me = await auth(req, c);
    const p = c.people.find((x) => x.id === me.id);
    if (hashPin(String(b.old || ""), p.salt) !== p.pin) throw httpErr(400, "Your current PIN is wrong.");
    if (!validPin(b.pin)) throw httpErr(400, "New PIN must be 4 to 8 digits.");
    p.salt = uid(16); p.pin = hashPin(b.pin, p.salt); p.pinVer = (p.pinVer || 1) + 1;
    await saveConfig(c);
    return send(res, 200, { token: await makeToken(p) });
  }

  throw httpErr(400, "Unknown action");
});
