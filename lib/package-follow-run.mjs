// The views' side of lib/package-follow.mjs: one pass at a time per project, at most every few seconds unless the package changed. A pass
// applies what the file changed in items never edited here, and keeps what it found in items edited here for the item's notice
// ("Use the file's" or "Keep mine"; Undo after Use). Submission › Files and Tables and figures start a pass when they draw.
import { get, update, projectGeneration } from '../store.mjs';
import { followFiles, patchOf, followText, vcsHistory } from './package-follow.mjs';
import { setItem, labels } from './package.mjs';

const AGAIN_MS = 5000;   // a draw after this reads the files again (a document saved in Word meanwhile)
const S = { gen: -1, key: '', at: 0, running: null, asks: new Map(), undo: null };

const keyOf = pkg => JSON.stringify(Object.values(pkg.items).map(it => [it.id, it.title, it.legend, it.notes, it.source, it.imported]));
const fresh = () => { if (S.gen !== projectGeneration()) { S.gen = projectGeneration(); S.key = ''; S.at = 0; S.asks = new Map(); S.undo = null; } };

/** The items edited here whose file changed: Map(item id -> the change, as lib/package-follow.mjs finds it). */
export function followAsks() { fresh(); return S.asks; }
/** The last "Use the file's", while it can be undone: { id, text }. */
export function followUndo() { fresh(); return S.undo && S.undo.gen === projectGeneration() ? S.undo : null; }

/**
 * Reads the items' documents and applies what changed in texts never edited here. Resolves to the labels and fields it changed
 * (["Table S1 title", ...]), or null when it did not run. `onDone(changed)` runs after a pass that found anything.
 */
export function syncFollow(folder, { onDone = () => {} } = {}) {
  fresh();
  const pkg = get().package;
  if (!folder || !pkg?.parts?.length) return Promise.resolve(null);
  const key = keyOf(pkg);
  if (S.running || (key === S.key && Date.now() - S.at < AGAIN_MS)) return S.running || Promise.resolve(null);
  const gen = projectGeneration();
  S.running = (async () => {
    try {
      const found = await followFiles(folder, structuredClone(pkg), { history: path => vcsHistory(folder, path) });
      if (gen !== projectGeneration()) return null;
      const now = get().package, L = labels(now), changed = [];
      const asks = new Map([...found].filter(([id, ch]) => now.items[id] && Object.keys(ch.ask).length));
      const take = [...found].filter(([id]) => now.items[id]);
      if (take.length) {
        update(st => {
          for (const [id, ch] of take) {
            const it = st.package?.items[id]; if (!it) continue;
            setItem(st.package, id, patchOf(it, ch));
            for (const f of Object.keys(ch.auto)) changed.push(`${L.get(id) || 'An item'} ${f}`);
            if (ch.grid) changed.push(`${L.get(id) || 'An item'} table`);
          }
          return st;
        });
      }
      S.asks = asks;
      S.key = keyOf(get().package); S.at = Date.now();
      if (changed.length || asks.size) onDone(changed);
      return changed;
    } catch (err) { console.warn('[package follow]', err?.message || err); return null; }
    finally { S.running = null; }
  })();
  return S.running;
}

/** "Use the file's" (`use`) or "Keep mine" (`keep`) for one item; Use can be undone. */
export function settleFollow(id, { use = false, keep = false } = {}) {
  const ch = S.asks.get(id), it = get().package?.items[id];
  if (!ch || !it) return false;
  const before = structuredClone({ title: it.title, legend: it.legend, notes: it.notes, source: it.source, imported: it.imported });
  update(st => { setItem(st.package, id, patchOf(st.package.items[id], ch, { use, keep })); return st; });
  S.asks.delete(id);
  S.key = keyOf(get().package);
  S.undo = use ? { gen: projectGeneration(), id, before, text: `${Object.keys(ch.ask).map(f => f[0].toUpperCase() + f.slice(1)).join(' and ')} now ${Object.keys(ch.ask).length > 1 ? 'follow' : 'follows'} the file` } : null;
  return true;
}
/** Takes back the last "Use the file's": the item's texts and record as they were, its question asked again. */
export function undoFollow() {
  const u = followUndo();
  if (!u || !get().package?.items[u.id]) return false;
  update(st => { const it = st.package.items[u.id]; Object.assign(it, structuredClone(u.before)); if (u.before.imported === undefined) delete it.imported; return st; });
  S.undo = null; S.key = ''; S.at = 0;
  return true;
}
export { followText };
/** Test hook: forget every pass. */
export function __resetFollow() { S.gen = -1; fresh(); }
