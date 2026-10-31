// Shared by the app and the server: works out what changed in a task,
// applies a change, and reverses one (for single-step undo).

export const LISTS = ["reqs", "entries", "files"];

const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

export function diff(before, after) {
  const d = { f: {}, l: {} };
  const keys = new Set([...Object.keys(before || {}), ...Object.keys(after || {})]);
  for (const k of keys) {
    if (LISTS.includes(k) || k === "id") continue;
    if (!same(before[k], after[k])) d.f[k] = [clone(before[k]) ?? null, clone(after[k]) ?? null];
  }
  for (const L of LISTS) {
    const a = before[L] || [], b = after[L] || [];
    const ai = new Map(a.map((x, i) => [x.id, [x, i]]));
    const bi = new Map(b.map((x, i) => [x.id, [x, i]]));
    const added = [], removed = [], changed = [];
    b.forEach((x, i) => { if (!ai.has(x.id)) added.push({ i, item: clone(x) }); });
    a.forEach((x, i) => {
      if (!bi.has(x.id)) removed.push({ i, item: clone(x) });
      else if (!same(x, bi.get(x.id)[0])) changed.push({ o: clone(x), n: clone(bi.get(x.id)[0]) });
    });
    if (added.length || removed.length || changed.length) d.l[L] = { added, removed, changed };
  }
  return d;
}

export function isEmpty(d) {
  return !d || (!Object.keys(d.f || {}).length && !Object.keys(d.l || {}).length);
}

export function apply(task, d) {
  const t = clone(task);
  for (const [k, [, n]] of Object.entries(d.f || {})) {
    if (n === null || n === undefined) delete t[k]; else t[k] = clone(n);
  }
  for (const [L, ch] of Object.entries(d.l || {})) {
    let arr = t[L] || [];
    const gone = new Set((ch.removed || []).map((r) => r.item.id));
    arr = arr.filter((x) => !gone.has(x.id));
    for (const c of ch.changed || []) {
      const i = arr.findIndex((x) => x.id === c.n.id);
      if (i >= 0) arr[i] = clone(c.n);
    }
    for (const a of [...(ch.added || [])].sort((x, y) => x.i - y.i)) {
      if (arr.some((x) => x.id === a.item.id)) continue;
      arr.splice(Math.min(a.i, arr.length), 0, clone(a.item));
    }
    t[L] = arr;
  }
  return t;
}

export function invert(d) {
  const f = {};
  for (const [k, [o, n]] of Object.entries(d.f || {})) f[k] = [n, o];
  const l = {};
  for (const [L, ch] of Object.entries(d.l || {})) {
    l[L] = {
      added: clone(ch.removed || []),
      removed: clone(ch.added || []),
      changed: (ch.changed || []).map((c) => ({ o: clone(c.n), n: clone(c.o) })),
    };
  }
  return { f, l };
}
