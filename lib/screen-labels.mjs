// Screening labels (plan E1, as Rayyan has them): words a review team puts on
// records ("Conference abstract", "Ask the second reviewer", "Paediatric subgroup"), several
// per record, that are not decisions. They filter the screening list and the
// Library, are listed in the decision log and exported with it.
//
// State: `screeningLabels = { list: [{ id, name }], of: { paperId: { labelId: by } } }`.
// Who put a label on is kept with it, so under blind dual screening a
// reviewer sees only their own (plan E3: labels are reviewer-specific and
// concealed too). Every change is appended to the screening log.
import { update, persist } from '../store.mjs';

const empty = () => ({ list: [], of: {} });
export const labelState = s => s.screeningLabels || empty();
export const labelList = s => labelState(s).list;

/** Normalised for storage (normalizeProject calls this). */
export function normalizeLabels(v) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return empty();
  const list = Array.isArray(v.list) ? v.list.filter(l => l && typeof l.id === 'string' && typeof l.name === 'string') : [];
  const ids = new Set(list.map(l => l.id));
  const of = {};
  for (const [pid, m] of Object.entries(v.of && typeof v.of === 'object' ? v.of : {})) {
    const keep = Object.fromEntries(Object.entries(m || {}).filter(([id]) => ids.has(id)).map(([id, by]) => [id, String(by || '')]));
    if (Object.keys(keep).length) of[pid] = keep;
  }
  return { list, of };
}

/**
 * Labels on a record, as `[{ id, name, by }]`. `by` limits them to one
 * reviewer's (blind dual screening); '' shows every label.
 */
export function labelsOf(s, paperId, by = '') {
  const st = labelState(s), on = st.of[paperId] || {};
  return st.list.filter(l => l.id in on && (!by || on[l.id] === by)).map(l => ({ ...l, by: on[l.id] }));
}
export const labelNames = (s, paperId, by = '') => labelsOf(s, paperId, by).map(l => l.name);

/** Records carrying each label (all reviewers'), for counts and filters. */
export function labelCounts(s, ids = null) {
  const st = labelState(s), n = Object.fromEntries(st.list.map(l => [l.id, 0]));
  for (const [pid, m] of Object.entries(st.of)) { if (ids && !ids.has(pid)) continue; for (const id in m) if (id in n) n[id]++; }
  return n;
}

const slug = name => `l-${String(name).toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '').slice(0, 40) || 'label'}`;
const log = (s, entry) => { s.screeningLog = s.screeningLog || []; s.screeningLog.push({ ...entry, at: new Date().toISOString() }); };

/** A new project label; an existing name (ignoring case) is returned instead of doubled. */
export function addLabel(name, { by = '' } = {}) {
  const n = String(name || '').trim().replace(/\s+/g, ' ').slice(0, 60);
  if (!n) return null;
  let made = null;
  update(s => {
    const st = s.screeningLabels = normalizeLabels(s.screeningLabels);
    const had = st.list.find(l => l.name.toLowerCase() === n.toLowerCase());
    if (had) { made = had; return s; }
    let id = slug(n), k = 2; while (st.list.some(l => l.id === id)) id = `${slug(n)}-${k++}`;
    made = { id, name: n }; st.list.push(made);
    log(s, { action: 'label-create', label: n, by });
    return s;
  });
  persist();
  return made;
}

export function renameLabel(id, name, { by = '' } = {}) {
  const n = String(name || '').trim().replace(/\s+/g, ' ').slice(0, 60);
  if (!n) return;
  update(s => {
    const l = labelState(s).list.find(x => x.id === id); if (!l || l.name === n) return s;
    log(s, { action: 'label-rename', label: n, prior: l.name, by }); l.name = n; return s;
  });
  persist();
}

/** A label removed from the project and from every record; logged with how many records carried it. */
export function removeLabel(id, { by = '' } = {}) {
  update(s => {
    const st = s.screeningLabels = normalizeLabels(s.screeningLabels);
    const l = st.list.find(x => x.id === id); if (!l) return s;
    let n = 0;
    for (const m of Object.values(st.of)) if (id in m) { delete m[id]; n++; }
    for (const [pid, m] of Object.entries(st.of)) if (!Object.keys(m).length) delete st.of[pid];
    st.list = st.list.filter(x => x.id !== id);
    log(s, { action: 'label-delete', label: l.name, count: n, by });
    return s;
  });
  persist();
}

/** A label put on a record or taken off it. */
export function setLabel(paperId, labelId, on, { by = '' } = {}) {
  update(s => {
    const st = s.screeningLabels = normalizeLabels(s.screeningLabels);
    const l = st.list.find(x => x.id === labelId); if (!l) return s;
    const m = st.of[paperId] || {};
    if (on === (labelId in m)) return s;
    if (on) m[labelId] = by; else delete m[labelId];
    if (Object.keys(m).length) st.of[paperId] = m; else delete st.of[paperId];
    log(s, { action: on ? 'label' : 'unlabel', id: paperId, label: l.name, by });
    return s;
  });
  return persist();
}
