// What a reducer changed in the live project, recorded as it changes it: each write's object, key, the value it replaced and the value it
// put, so the change can be taken back (undo) and put again (redo) without a copy of the project. store.mjs update() runs reducers through
// it. The project's objects are reached through proxies only while the reducer runs; a value written into the project is stored unwrapped,
// so the project never holds a proxy (a proxy cannot be cloned or posted to a worker). Only plain objects and arrays are proxied: the
// project is JSON. Pure: names no store, view or file.
//
//   const r = recordChanges(state, s => { s.notes.push(n); return s; })   →  { result, changes: [{ t, k, had, old, has, now, top }], keys: Set<top-level keys> }
//                                                     (`top`: the top-level key the write is under, what a save needs to stringify after an undo)
//   undoChanges(changes) / redoChanges(changes)   →  how many writes were made; a write is skipped where the value has moved on since (a later
//                                                     change to the same place is never overwritten)
const isPlain = v => {
  if (!v || typeof v !== 'object') return false;
  if (Array.isArray(v)) return true;
  const p = Object.getPrototypeOf(v);
  return p === Object.prototype || p === null;
};

/** Runs fn(proxy of root) and returns what it changed. A throw is rethrown with `changes` attached (the caller decides what to keep).
 *  `outer`: what a value read through `root` stands for, when `root` hands out proxies of its own (store.mjs: a chunked section's proxy
 *  inside update()); no change records one, and none is written into the project. */
export function recordChanges(root, fn, { outer = v => v } = {}) {
  const proxies = new WeakMap(), targets = new WeakMap(), changes = [], keys = new Set();
  let open = true;
  const raw = v => outer((v && typeof v === 'object' && targets.get(v)) || v);
  // A fresh value (built by the reducer) may hold proxies read from the project: they are replaced by what they stand for, in place.
  const unwrap = (v, seen = new Set()) => {
    const t = raw(v);
    if (t !== v || !isPlain(v) || seen.has(v)) return t;
    seen.add(v);
    if (Array.isArray(v)) { for (let i = 0; i < v.length; i++) { const x = v[i]; if (x && typeof x === 'object') { const u = unwrap(x, seen); if (u !== x) v[i] = u; } } }
    else for (const k of Object.keys(v)) { const x = v[k]; if (x && typeof x === 'object') { const u = unwrap(x, seen); if (u !== x) v[k] = u; } }
    return v;
  };
  const top = new WeakMap();   // object -> the top-level key it was reached under (what a save needs to know)
  const wrap = (t, topKey) => {
    let p = proxies.get(t);
    if (p) return p;
    if (topKey != null && !top.has(t)) top.set(t, topKey);
    p = new Proxy(t, handler);
    proxies.set(t, p); targets.set(p, t);
    return p;
  };
  const topOf = (t, k) => { const tk = t === root ? k : top.get(t); return tk == null ? null : String(tk); };   // the top-level key a write is under
  const note = (t, k) => { const tk = t === root ? k : top.get(t); if (tk != null) keys.add(String(tk)); };
  const handler = {
    get(t, k, r) {
      // an array's search by identity finds the project's own objects whether it is given the proxy or the object (a caller may hold either)
      if (open && Array.isArray(t) && (k === 'indexOf' || k === 'includes' || k === 'lastIndexOf')) return (x, ...rest) => Array.prototype[k].call(t, raw(x), ...rest);
      const v = Reflect.get(t, k, t);
      if (!open || typeof k === 'symbol' || !isPlain(v) || !Object.prototype.hasOwnProperty.call(t, k)) return v;
      return wrap(v, t === root ? k : top.get(t));
    },
    set(t, k, v) {
      if (!open) { t[k] = raw(v); return true; }
      const now = unwrap(v), had = Object.prototype.hasOwnProperty.call(t, k), old = raw(t[k]);
      if (had && old === now) return true;
      // An array cut short by its length drops its last elements without a delete of each: they are recorded as deleted first, so an undo
      // puts them back (the length is restored before them, as the changes are taken back last first).
      if (Array.isArray(t) && k === 'length' && now < old) for (let i = old - 1; i >= now; i--) if (Object.prototype.hasOwnProperty.call(t, i)) changes.push({ t, k: String(i), had: true, old: t[i], has: false, now: undefined, top: topOf(t, k) });
      const len = Array.isArray(t) ? t.length : -1;
      t[k] = now;
      changes.push({ t, k, had, old, has: true, now, top: topOf(t, k) });
      // an element written past the end grows the array by itself: the length it had is recorded too
      if (len >= 0 && k !== 'length' && t.length !== len) changes.push({ t, k: 'length', had: true, old: len, has: true, now: t.length, top: topOf(t, k) });
      note(t, k);
      if (isPlain(now) && !top.has(now)) top.set(now, t === root ? k : top.get(t));
      return true;
    },
    deleteProperty(t, k) {
      if (!open || !Object.prototype.hasOwnProperty.call(t, k)) return Reflect.deleteProperty(t, k);
      const old = raw(t[k]);
      delete t[k];
      changes.push({ t, k, had: true, old, has: false, now: undefined, top: topOf(t, k) });
      note(t, k);
      return true;
    },
    defineProperty(t, k, d) {
      if (!open || !('value' in d)) return Reflect.defineProperty(t, k, d);
      return handler.set(t, k, d.value);
    },
  };
  const proxy = wrap(root, null);
  try {
    const result = raw(fn(proxy));
    return { result: result === root ? root : unwrap(result), changes, keys };
  } catch (err) {
    try { err.changes = changes; } catch {}
    throw err;
  } finally { open = false; }
}

/** Takes changes back, last first. A place whose value is no longer the one the change put is left as it is. */
export function undoChanges(changes) {
  let n = 0;
  for (let i = changes.length - 1; i >= 0; i--) {
    const c = changes[i];
    const here = Object.prototype.hasOwnProperty.call(c.t, c.k);
    if (here !== c.has || (here && c.t[c.k] !== c.now)) continue;
    if (c.had) c.t[c.k] = c.old; else delete c.t[c.k];
    n++;
  }
  return n;
}

/** Puts changes again, first first. A place whose value is no longer the one before the change is left as it is. */
export function redoChanges(changes) {
  let n = 0;
  for (const c of changes) {
    const here = Object.prototype.hasOwnProperty.call(c.t, c.k);
    if (here !== c.had || (here && c.t[c.k] !== c.old)) continue;
    if (c.has) c.t[c.k] = c.now; else delete c.t[c.k];
    n++;
  }
  return n;
}
