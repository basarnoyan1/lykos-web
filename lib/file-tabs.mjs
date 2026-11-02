// The open documents of the Files view, as data: groups of tabs, the focused group, a stack of closed tabs.
//
// Pure: no DOM, no storage, no clock. The view draws it (views/files.mjs) and decides what a tab costs (which hosts stay mounted comes
// from `mounted`, below). A path is open at most once across the model, so a document is never decoded twice and "Open to the side"
// moves a file instead of copying it. Two groups at most: a second one is the split.
//
//   show(rel, { preview, side, dir })   open or activate (`dir`: the path is a folder, drawn as a page of its files); a preview replaces the group's preview tab; `side` opens in the other group
//   close(rel)                      the next active tab is the most recently used one of the group; an emptied second group goes
//   pin, move, reorder, closeOthers, closeSaved, closeAll, reopen, next/prev (strip order), cycle (most recently used order)
//   rename(from, to)                follows a rename or move made while the app runs (a folder carries what is under it); `to` null closes
//   serialize() / restore(json, exists)   paths only, never contents; a path `exists` denies is dropped and listed in `dropped`

const MAX_GROUPS = 2, CLOSED_MAX = 20;
const text = v => typeof v === 'string' && v !== '';

export function createTabs() {
  let clock = 0;
  const m = {
    groups: [{ id: 'a', tabs: [], active: '' }],
    focus: 'a',
    closed: [],
    dropped: [],
  };

  const group = id => m.groups.find(g => g.id === id) || null;
  const find = rel => { for (const g of m.groups) { const tab = g.tabs.find(t => t.rel === rel); if (tab) return { g, tab }; } return null; };
  const stamp = tab => { tab.mru = ++clock; };
  const focused = () => group(m.focus) || m.groups[0];
  const otherThan = g => m.groups.find(x => x !== g) || null;
  const lastUsed = g => g.tabs.reduce((best, t) => (!best || t.mru > best.mru ? t : best), null);

  function dropGroupIfEmpty(g) {
    if (g.tabs.length || m.groups.length < 2) return;
    m.groups = m.groups.filter(x => x !== g);
    if (m.focus === g.id) m.focus = m.groups[0].id;
  }

  m.group = group;
  m.has = rel => !!find(rel);
  m.paths = () => m.groups.flatMap(g => g.tabs.map(t => t.rel));
  m.isPreview = rel => !!find(rel)?.tab.preview;
  m.isDir = rel => !!find(rel)?.tab.dir;
  m.groupOf = rel => find(rel)?.g.id || '';
  /** The path shown in the focused group, or ''. */
  m.active = () => focused().active;
  m.count = () => m.paths().length;

  m.show = (rel, { preview = false, side = false, dir = false } = {}) => {
    if (!text(rel)) return null;
    const existing = find(rel);
    let g = focused();
    if (side) {
      if (m.groups.length < MAX_GROUPS && (g.tabs.length > 1 || !existing)) {
        const id = m.groups.some(x => x.id === 'b') ? 'c' : 'b';
        const created = { id, tabs: [], active: '' };
        m.groups.push(created); g = created;
      } else g = otherThan(g) || g;
    }
    if (existing && !side) g = existing.g;
    if (existing) {
      if (existing.g !== g) {                       // a file lives in one group: it moves
        existing.g.tabs = existing.g.tabs.filter(t => t !== existing.tab);
        if (existing.g.active === rel) existing.g.active = lastUsed(existing.g)?.rel || '';
        g.tabs.push(existing.tab);
        dropGroupIfEmpty(existing.g);
      }
      if (!preview) existing.tab.preview = false;
      stamp(existing.tab); g.active = rel; m.focus = g.id;
      return existing.tab;
    }
    const tab = { rel, preview: !!preview, mru: 0, dir: !!dir }; stamp(tab);
    const held = preview ? g.tabs.findIndex(t => t.preview) : -1;
    if (held >= 0) g.tabs[held] = tab;
    else g.tabs.push(tab);
    g.active = rel; m.focus = g.id;
    return tab;
  };

  m.activate = rel => { const hit = find(rel); if (!hit) return false; hit.g.active = rel; stamp(hit.tab); m.focus = hit.g.id; return true; };
  m.focusGroup = id => { if (group(id)) m.focus = id; };
  m.pin = rel => { const hit = find(rel); if (hit) hit.tab.preview = false; };

  m.close = rel => {
    const hit = find(rel); if (!hit) return false;
    const { g, tab } = hit;
    g.tabs = g.tabs.filter(t => t !== tab);
    if (!tab.preview) { m.closed = [rel, ...m.closed.filter(x => x !== rel)].slice(0, CLOSED_MAX); }
    if (g.active === rel) g.active = lastUsed(g)?.rel || '';
    dropGroupIfEmpty(g);
    return true;
  };
  m.closeAll = () => { for (const rel of m.paths()) m.close(rel); };
  m.closeOthers = rel => { for (const x of m.paths()) if (x !== rel) m.close(x); };
  m.closeSaved = dirty => { for (const rel of m.paths()) if (!dirty(rel)) m.close(rel); };
  /** Reopens the most recently closed tab that is not open now. */
  m.reopen = () => {
    while (m.closed.length) { const rel = m.closed.shift(); if (!m.has(rel)) { m.show(rel); return rel; } }
    return '';
  };

  /** Moves a tab to a group (created when it is the second) at an index. A move to an unknown group is a no-op. */
  m.move = (rel, toId, index = Infinity) => {
    const hit = find(rel); if (!hit) return false;
    let to = group(toId);
    if (!to && toId && m.groups.length < MAX_GROUPS) { to = { id: toId, tabs: [], active: '' }; m.groups.push(to); }
    if (!to) return false;
    const from = hit.g;
    from.tabs = from.tabs.filter(t => t !== hit.tab);
    if (from.active === rel) from.active = lastUsed(from)?.rel || '';
    const at = Math.max(0, Math.min(to.tabs.length, Number.isFinite(index) ? index : to.tabs.length));
    to.tabs.splice(at, 0, hit.tab); to.active = rel; stamp(hit.tab); m.focus = to.id;
    if (from !== to) dropGroupIfEmpty(from);
    return true;
  };
  m.reorder = (rel, index) => { const hit = find(rel); return hit ? m.move(rel, hit.g.id, index) : false; };

  /** The tab after or before the active one in strip order, wrapping. */
  m.step = (delta, g = focused()) => {
    if (g.tabs.length < 2) return g.active;
    const i = Math.max(0, g.tabs.findIndex(t => t.rel === g.active));
    return g.tabs[(i + delta + g.tabs.length) % g.tabs.length].rel;
  };
  /** The tab after or before the active one in most recently used order (⌃Tab). */
  m.cycle = (delta = 1, g = focused()) => {
    const order = [...g.tabs].sort((a, b) => b.mru - a.mru);
    if (order.length < 2) return g.active;
    const i = Math.max(0, order.findIndex(t => t.rel === g.active));
    return order[(i + delta + order.length) % order.length].rel;
  };

  /** The tab for `from` now shows `to` (a folder tab going into a subfolder), in the same place; if `to` is open already it is activated and `from` closes. */
  m.replace = (from, to, { dir = false } = {}) => {
    const hit = find(from); if (!hit || !text(to)) return false;
    if (from === to) return true;
    const other = find(to);
    if (other) { m.close(from); m.activate(to); return true; }
    hit.tab.rel = to; hit.tab.dir = !!dir; stamp(hit.tab);
    if (hit.g.active === from) hit.g.active = to;
    m.closed = m.closed.filter(x => x !== from);
    return true;
  };

  /** Follows a rename or move; `to` null closes what was under `from`. */
  m.rename = (from, to) => {
    for (const rel of m.paths()) {
      const under = rel === from || rel.startsWith(`${from}/`);
      if (!under) continue;
      if (!to) { m.close(rel); continue; }
      const next = to + rel.slice(from.length), hit = find(rel);
      hit.tab.rel = next;
      if (hit.g.active === rel) hit.g.active = next;
      m.closed = m.closed.map(x => (x === rel ? next : x));
    }
  };

  /** Fills an empty model from restored groups: one preview tab at most per group, the active tab the most recently used. */
  m.seed = (groups, focus = 0) => {
    m.groups = []; m.closed = [];
    groups.filter(g => g.tabs.length).slice(0, MAX_GROUPS).forEach((g, i) => {
      const group = { id: i ? 'b' : 'a', tabs: [], active: '' };
      let held = false;
      for (const t of g.tabs) { const preview = !!t.preview && !held; held ||= preview; group.tabs.push({ rel: t.rel, preview, mru: 0, dir: !!t.dir }); }
      group.active = group.tabs.some(t => t.rel === g.active) ? g.active : group.tabs[0].rel;
      group.tabs.forEach(t => { if (t.rel !== group.active) stamp(t); });
      stamp(group.tabs.find(t => t.rel === group.active));
      m.groups.push(group);
    });
    if (!m.groups.length) m.groups = [{ id: 'a', tabs: [], active: '' }];
    m.focus = (Number.isInteger(focus) && m.groups[focus] ? m.groups[focus] : m.groups[0]).id;
  };

  m.serialize = () => ({
    v: 1,
    focus: Math.max(0, m.groups.findIndex(g => g.id === m.focus)),
    groups: m.groups.map(g => ({ active: g.active, tabs: g.tabs.map(t => ({ rel: t.rel, preview: t.preview, ...(t.dir ? { dir: true } : {}) })) })),
  });

  return m;
}

/** A model from stored JSON. Anything malformed gives the empty model; a path `exists` denies is dropped and listed in `dropped`. */
export function restoreTabs(json, exists = () => true) {
  const m = createTabs();
  let data = json;
  if (typeof data === 'string') { try { data = JSON.parse(data); } catch { return m; } }
  if (!data || typeof data !== 'object' || data.v !== 1 || !Array.isArray(data.groups)) return m;
  const seen = new Set();
  const groups = data.groups.slice(0, MAX_GROUPS).filter(g => g && typeof g === 'object' && Array.isArray(g.tabs)).map(g => {
    const tabs = [];
    for (const t of g.tabs) {
      if (!t || !text(t.rel) || seen.has(t.rel)) continue;
      seen.add(t.rel);
      if (!exists(t.rel)) { m.dropped.push(t.rel); continue; }
      tabs.push({ rel: t.rel, preview: t.preview === true, dir: t.dir === true });
    }
    return { tabs, active: g.active };
  });
  m.seed(groups, data.focus);
  return m;
}

/**
 * Which tabs keep a decoded document: the active tab of each group, every tab with unsaved edits (never released), and the two most recently
 * used clean tabs besides. Everything else is released and read from disk again when it is chosen. A policy, not a byte count.
 */
export function mountedTabs(model, dirty = () => false, keep = 2) {
  const isDirty = typeof dirty === 'function' ? dirty : rel => dirty.has?.(rel);
  const out = new Set();
  const tabs = model.groups.flatMap(g => g.tabs.map(t => ({ ...t, group: g })));
  for (const g of model.groups) if (g.active) out.add(g.active);
  for (const t of tabs) if (isDirty(t.rel)) out.add(t.rel);
  tabs.filter(t => !out.has(t.rel)).sort((a, b) => b.mru - a.mru).slice(0, keep).forEach(t => out.add(t.rel));
  return out;
}
