// Where the Files view has been: Back, Forward and Up one folder, as data.
//
// Pure: no DOM, no storage. A path is a folder of the project ('' is the top: what the folder lists first). `go` is a navigation: it forgets what Forward
// held and is a no-op for the folder already shown. A document shown is a step too (`visit`), and its entry keeps the page being read (`mark`), so Back
// or Forward to a PDF returns to that page and not to the first. `drop` and `rename` follow what the explorer deletes or moves, so Back never leads to a
// path that is gone.
const MAX = 60;
const above = rel => (rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : rel ? '' : null);
const under = (rel, prefix) => rel === prefix || rel.startsWith(`${prefix}/`);
// An entry is a folder (a string) or a document visit ({ file, page? }): Back to a document returns to the page that was being read (a PDF's page).
const isDoc = e => !!e && typeof e === 'object';
const relOf = e => (isDoc(e) ? e.file : e);
const same = (a, b) => (isDoc(a) && isDoc(b) ? a.file === b.file : a === b);
const copy = e => (isDoc(e) ? { ...e } : e);
const pageOk = p => Number.isInteger(p) && p >= 1 && p <= 100000;
const entry = (file, page) => (pageOk(page) ? { file, page } : { file });

export function createHistory({ start = '', parent = above, max = MAX } = {}) {
  const m = { at: String(start || ''), folder: String(start || ''), back: [], forward: [] };
  const push = (stack, e) => { if (!same(stack.at(-1), e)) stack.push(copy(e)); if (stack.length > max) stack.shift(); };
  const settle = e => { m.at = e; if (!isDoc(e)) m.folder = e; return copy(e); };

  /** The folder the folder page lists: the last folder shown, whether or not a document is shown now. */
  m.current = () => m.folder;
  /** Where the history stands: a folder (string) or a document visit ({ file, page? }). */
  m.entry = () => copy(m.at);
  m.canBack = () => m.back.length > 0;
  m.canForward = () => m.forward.length > 0;
  /** The folder Up goes to, or null at the top. */
  m.upTarget = () => parent(m.folder);
  m.canUp = () => m.upTarget() !== null;

  m.go = rel => {
    rel = String(rel || '');
    if (rel === m.at) return false;
    push(m.back, m.at); m.forward = []; settle(rel);
    return true;
  };
  /** A document is shown: a step like a folder's. The same document again changes nothing (use `mark` for its page). */
  m.visit = (file, page) => {
    file = String(file || '');
    if (!file || (isDoc(m.at) && m.at.file === file)) return false;
    push(m.back, m.at); m.forward = []; settle(entry(file, page));
    return true;
  };
  /** The page the document shown is on, kept in its entry so Back and Forward return to it. */
  m.mark = (page, file) => {
    if (!isDoc(m.at) || !pageOk(page) || (file !== undefined && m.at.file !== file)) return false;
    m.at.page = page; return true;
  };
  m.goBack = () => { if (!m.back.length) return null; push(m.forward, m.at); return settle(m.back.pop()); };
  m.goForward = () => { if (!m.forward.length) return null; push(m.back, m.at); return settle(m.forward.pop()); };
  m.goUp = () => { const up = m.upTarget(); if (up === null) return null; m.go(up); return m.at; };

  /** A folder or file (and everything under it) is gone: its entries leave both stacks and, if it is shown, the parent is. Returns whether the shown folder changed. */
  m.drop = prefix => {
    const keep = stack => { const out = []; for (const e of stack) if (!under(relOf(e), prefix) && !same(out.at(-1), e)) out.push(e); return out; };
    m.back = keep(m.back); m.forward = keep(m.forward);
    const gone = under(relOf(m.at), prefix), folderGone = under(m.folder, prefix);
    if (folderGone) { let to = parent(prefix); while (to !== null && under(to, prefix)) to = parent(to); m.folder = to ?? ''; }
    if (gone || !isDoc(m.at)) m.at = m.folder;
    if (same(m.back.at(-1), m.at)) m.back.pop();
    if ((gone || folderGone) && same(m.forward.at(-1), m.at)) m.forward.pop();
    return folderGone;
  };
  /** A folder was renamed or moved: every path under it follows. */
  m.rename = (from, to) => {
    const fix = r => (under(r, from) ? to + r.slice(from.length) : r);
    const fixE = e => (isDoc(e) ? { ...e, file: fix(e.file) } : fix(e));
    m.back = m.back.map(fixE); m.forward = m.forward.map(fixE); m.at = fixE(m.at); m.folder = fix(m.folder);
  };
  m.serialize = () => ({ v: 1, at: copy(m.at), folder: m.folder, back: m.back.slice(-max).map(copy), forward: m.forward.slice(-max).map(copy) });
  /** Every path the history names (the restore checks they still exist). */
  m.rels = () => [m.folder, relOf(m.at), ...m.back.map(relOf), ...m.forward.map(relOf)].filter(Boolean);
  return m;
}

/** A history from stored JSON; malformed input gives a fresh one at `start`, and a path `exists` denies is dropped from both stacks and from the place. */
export function restoreHistory(json, { exists = () => true, parent = above, start = '' } = {}) {
  const m = createHistory({ start, parent });
  let d = json;
  if (typeof d === 'string') { try { d = JSON.parse(d); } catch { return m; } }
  const okEntry = e => (typeof e === 'string' ? e : e && typeof e === 'object' && typeof e.file === 'string' && e.file ? entry(e.file, e.page) : null);
  if (!d || typeof d !== 'object' || d.v !== 1) return m;
  const at = okEntry(d.at); if (at === null) return m;
  const clean = a => (Array.isArray(a) ? a.map(okEntry).filter(x => x !== null && exists(relOf(x))) : []);
  m.back = clean(d.back); m.forward = clean(d.forward);
  let folder = typeof d.folder === 'string' ? d.folder : isDoc(at) ? '' : at; while (folder && !exists(folder)) folder = parent(folder) ?? '';
  m.folder = folder;
  m.at = isDoc(at) ? (exists(at.file) ? at : folder) : folder;
  return m;
}
