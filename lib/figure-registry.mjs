// The figure registry document (`.lykos/figure-registry.json`, schema 1): which
// script or Lykos output makes which figure, where the manuscript of record
// is, and the decisions a researcher took on figure findings. Pure: documents
// in, documents out; figure-sidecar.mjs reads and writes the file.
//
// The registry holds only what a person decided or a fact that was recorded
// (producers adopted, baselines marked, findings dismissed). Nothing derived
// is stored here, and no function here writes anything: a detector reads it,
// and only an explicit user action in a later package saves a changed copy.
//
// Unknown fields survive normalise at every level, so a registry saved by a
// later Lykos keeps what this one does not know. A newer schema, or a registry
// of another project, opens read-only (`open`).
export const SCHEMA = 1;
export const PLACEMENTS = ['main', 'supplement', 'response', 'none'];
export const EXCEPTIONS = ['declared-style', 'supplied-image'];
export const INPUT_KINDS = ['bytes', 'cells', 'text', 'state'];
/** How an input edge was learned, strongest first; the weakest tag on a finding's evidence labels the finding. */
export const VIAS = ['declared', 'inferred-write', 'inferred-input', 'inferred-import'];
/** A baseline is `verified` by the user (Mark as current) or `assumed` by an accepted adoption; never anything else. */
export const BASES = ['verified', 'assumed'];
export const DECISION_STATES = ['dismiss', 'current', 'restored'];

const isObj = v => v != null && typeof v === 'object' && !Array.isArray(v);
const str = v => typeof v === 'string' ? v : '';
const strings = v => Array.isArray(v) ? v.filter(x => typeof x === 'string' && x) : [];
const clone = v => structuredClone(v);
/** JSON with object keys sorted at every depth: equal documents give equal text whatever the key order. */
const canon = v => JSON.stringify(v, (_, x) => isObj(x) ? Object.fromEntries(Object.keys(x).sort().map(k => [k, x[k]])) : x);
const same = (a, b) => canon(a) === canon(b);
const ms = v => v instanceof Date ? v.getTime() : typeof v === 'number' ? v : Date.parse(String(v ?? ''));
const iso = v => new Date(Number.isFinite(ms(v)) ? ms(v) : Date.now()).toISOString();
const sortedMap = obj => Object.fromEntries(Object.keys(obj).sort().map(k => [k, obj[k]]));

/** A registry with nothing in it, for a project that has none yet. */
export function emptyRegistry(projectId = '') {
  return { schema: SCHEMA, projectId: String(projectId || ''), updatedAt: '', manuscript: null, outputDir: null, alias: {}, producers: [], figures: {}, decisions: {} };
}

// ---- normalise -------------------------------------------------------------------
function inputOf(raw, dropped, where) {
  if (!isObj(raw) || (typeof raw.path !== 'string' && typeof raw.state !== 'string') || !(raw.path || raw.state)) { dropped.push(`${where}: an input with no path or state`); return null; }
  const out = { ...clone(raw) };
  out.kind = INPUT_KINDS.includes(raw.kind) ? raw.kind : (raw.state ? 'state' : 'bytes');
  out.via = VIAS.includes(raw.via) ? raw.via : 'inferred-input';
  out.resolved = raw.resolved === true;
  if (raw.sheet != null && typeof raw.sheet !== 'string') delete out.sheet;
  return out;
}

function baselineOf(raw) {
  if (!isObj(raw) || !BASES.includes(raw.basis) || typeof raw.at !== 'string' || !raw.at) return null;
  const strMap = m => isObj(m) ? Object.fromEntries(Object.entries(m).filter(([, v]) => typeof v === 'string')) : {};
  return { ...clone(raw), at: raw.at, basis: raw.basis, inputs: strMap(raw.inputs), outputs: strMap(raw.outputs) };
}

/** One producer as stored; null (with a reason in `dropped`) when it has no id. */
export function normaliseProducer(raw, dropped = [], where = 'producer') {
  if (!isObj(raw) || typeof raw.id !== 'string' || !raw.id.trim()) { dropped.push(`${where}: a producer with no id`); return null; }
  const out = { ...clone(raw) };
  out.id = raw.id.trim();
  out.label = str(raw.label) || out.id;
  out.kind = typeof raw.kind === 'string' && raw.kind ? raw.kind : (typeof raw.script === 'string' && raw.script ? 'script' : 'supplied');
  if (typeof raw.script === 'string' && raw.script) out.script = raw.script; else delete out.script;
  out.imports = strings(raw.imports);
  out.inputs = (Array.isArray(raw.inputs) ? raw.inputs : []).map((x, i) => inputOf(x, dropped, `${out.id}.inputs[${i}]`)).filter(Boolean);
  out.outputs = strings(raw.outputs);
  out.profile = typeof raw.profile === 'string' && raw.profile ? raw.profile : 'none';
  if (isObj(raw.run) && typeof raw.run.text === 'string') out.run = { ...clone(raw.run), text: raw.run.text, source: str(raw.run.source) }; else delete out.run;
  const baseline = baselineOf(raw.baseline);
  if (baseline) out.baseline = baseline; else delete out.baseline;
  return out;
}

function figureOf(raw) {
  const out = isObj(raw) ? clone(raw) : {};
  if (out.placement != null && !PLACEMENTS.includes(out.placement)) delete out.placement;
  if (out.exception != null && !EXCEPTIONS.includes(out.exception)) delete out.exception;
  for (const k of ['label', 'role']) if (out[k] != null && typeof out[k] !== 'string') delete out[k];
  if (out.link != null && !(isObj(out.link) && typeof out.link.doc === 'string')) delete out.link;
  return out;
}

function decisionOf(key, raw) {
  if (!isObj(raw) || !DECISION_STATES.includes(raw.state) || !Number.isFinite(ms(raw.at))) return null;
  return { ...clone(raw), key, stamp: String(raw.stamp ?? ''), at: String(raw.at), state: raw.state };
}

function build(raw) {
  const dropped = [];
  const r = isObj(raw) ? raw : {};
  const out = { ...clone(r) };
  out.schema = Number.isInteger(r.schema) && r.schema > SCHEMA ? r.schema : SCHEMA;
  out.projectId = str(r.projectId);
  out.updatedAt = str(r.updatedAt);
  out.manuscript = isObj(r.manuscript) && typeof r.manuscript.path === 'string' && r.manuscript.path
    ? { ...clone(r.manuscript), path: r.manuscript.path, chosenAt: str(r.manuscript.chosenAt) } : null;
  out.outputDir = typeof r.outputDir === 'string' && r.outputDir ? r.outputDir : null;
  out.alias = sortedMap(Object.fromEntries(Object.entries(isObj(r.alias) ? r.alias : {}).filter(([k, v]) => k && typeof v === 'string')));
  const seen = new Set();
  out.producers = [];
  (Array.isArray(r.producers) ? r.producers : []).forEach((p, i) => {
    const n = normaliseProducer(p, dropped, `producers[${i}]`);
    if (!n) return;
    if (seen.has(n.id)) { dropped.push(`producers[${i}]: ${n.id} is listed twice; the first is kept`); return; }
    seen.add(n.id); out.producers.push(n);
  });
  out.figures = sortedMap(Object.fromEntries(Object.entries(isObj(r.figures) ? r.figures : {}).filter(([k, v]) => k && isObj(v)).map(([k, v]) => [k, figureOf(v)])));
  const decisions = {};
  for (const [key, d] of Object.entries(isObj(r.decisions) ? r.decisions : {})) {
    const n = decisionOf(key, d);
    if (n) decisions[key] = n; else dropped.push(`decisions.${key}: not a decision`);
  }
  out.decisions = sortedMap(decisions);
  return { registry: out, dropped };
}

/** The registry as a well-formed document; unknown fields are kept. Idempotent. */
export const normalise = raw => build(raw).registry;

/**
 * Opens a stored registry for use. Answers `{ registry, readOnly, notice, reason, dropped }`:
 * a newer schema, and a registry whose `projectId` is not this project's, open read-only with a notice
 * and are never saved over; a registry without a project id takes this one.
 */
export function open(raw, { projectId = '' } = {}) {
  const { registry, dropped } = build(raw);
  const result = { registry, readOnly: false, notice: '', reason: '', dropped };
  if (isObj(raw) && Number.isInteger(raw.schema) && raw.schema > SCHEMA) {
    return { ...result, readOnly: true, reason: 'newer', notice: `This registry was saved by a newer Lykos (schema ${raw.schema}); it opens read-only.` };
  }
  if (registry.projectId && projectId && registry.projectId !== projectId) {
    return { ...result, readOnly: true, reason: 'project', notice: 'This registry belongs to another project; it opens read-only.' };
  }
  if (!registry.projectId) registry.projectId = String(projectId || '');
  return result;
}

/** The registry as file text: two-space JSON, maps sorted, one trailing newline. */
export const registryText = registry => `${JSON.stringify(normalise(registry), null, 2)}\n`;

/** The same registry stamped as changed now. */
export const touch = (registry, now = new Date()) => ({ ...registry, updatedAt: iso(now) });

// ---- baselines ---------------------------------------------------------------------
/**
 * The baseline stored for a producer, or null. With `output` and `stamp` (the output's `size:mtime` now),
 * `current` says whether the baseline was taken for exactly that output: a baseline of another build proves nothing.
 */
export function baselineFor(registry, producerId, { output = null, stamp = null } = {}) {
  const p = (registry?.producers || []).find(x => x.id === producerId);
  const b = baselineOf(p?.baseline);
  if (!b) return null;
  return { ...b, current: output == null || stamp == null ? null : b.outputs[output] === String(stamp) };
}

/** Marks a producer's figures as current: the user's action, so the basis is `verified`. */
export function markCurrent(registry, producerId, { inputs = {}, outputs = {} } = {}, now = new Date()) {
  if (!(registry?.producers || []).some(p => p.id === producerId)) throw new Error(`No producer ${producerId} in the registry`);
  const baseline = { at: iso(now), basis: 'verified', inputs: { ...inputs }, outputs: { ...outputs } };
  return touch({ ...registry, producers: registry.producers.map(p => p.id === producerId ? { ...p, baseline } : p) }, now);
}

/** The weakest of a list of `via` tags (declared is the strongest); null when none is known. */
export function weakestVia(tags) {
  let worst = -1;
  for (const t of tags || []) worst = Math.max(worst, VIAS.indexOf(t));
  return worst < 0 ? null : VIAS[worst];
}

// ---- decisions ---------------------------------------------------------------------
/**
 * Records a decision on a finding `key` at the evidence `stamp` it was taken on: `dismiss` (not needed),
 * `current` (marked as current) or `restored` (the decision was taken back). The entry is stamped later
 * than the one it replaces, so a restore always beats the dismissal it undoes, also across a merge.
 */
export function decide(registry, key, stamp, kind, now = new Date()) {
  if (!DECISION_STATES.includes(kind)) throw new Error(`A decision is one of ${DECISION_STATES.join(', ')}, not ${JSON.stringify(kind)}`);
  if (typeof key !== 'string' || !key) throw new Error('A decision needs the key of a finding');
  const prev = registry?.decisions?.[key];
  let t = ms(now);
  if (!Number.isFinite(t)) t = Date.now();
  const before = prev ? ms(prev.at) : NaN;
  if (Number.isFinite(before) && t <= before) t = before + 1;
  const entry = { ...(prev || {}), key, stamp: String(stamp ?? ''), at: new Date(t).toISOString(), state: kind };
  return { ...registry, updatedAt: entry.at, decisions: sortedMap({ ...(registry?.decisions || {}), [key]: entry }) };
}

/**
 * The decision that holds for a finding now, or null: a dismissal or `current` mark holds only while the
 * evidence stamp is the one it was taken on (it re-arms when the evidence changes), and a restored entry holds nothing.
 */
export function decisionFor(registry, key, stamp) {
  const d = registry?.decisions?.[key];
  if (!d || d.state === 'restored' || d.stamp !== String(stamp ?? '')) return null;
  return { state: d.state, at: d.at, stamp: d.stamp };
}

/** Decisions that still hold something, newest first, for a "Decided" list with Restore. */
export const decidedList = registry => Object.values(registry?.decisions || {}).filter(d => d.state !== 'restored').sort((a, b) => ms(b.at) - ms(a.at) || (a.key < b.key ? -1 : 1));

const RANK = { restored: 2, dismiss: 1, current: 0 };
const newerDecision = (a, b) => {
  const d = ms(a.at) - ms(b.at);
  return d !== 0 ? d : (RANK[a.state] - RANK[b.state]) || (a.stamp < b.stamp ? -1 : a.stamp > b.stamp ? 1 : 0);
};
/** Two decision maps merged per key: the later `at` wins, ties settled the same way on every machine. */
export function mergeDecisions(a = {}, b = {}) {
  const out = {};
  for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
    const x = a[key], y = b[key];
    out[key] = !x ? y : !y ? x : newerDecision(x, y) >= 0 ? x : y;
  }
  return sortedMap(out);
}

// ---- merge -------------------------------------------------------------------------
/**
 * Merges the entries of a keyed collection three ways. `base` is what both sides started from (null: nothing),
 * `mine` and `theirs` the two edited copies. An entry only one side changed takes that side's version; one side
 * deleting what the other left alone deletes it; an edit beats a delete. An entry both sides changed differently
 * goes to the side `prefer(mine, theirs)` names ('mine', 'theirs', or null when they cannot be ordered, which
 * keeps theirs and lists the key in `conflicts`). Answers `{ entries, conflicts }` over a Map of key to value.
 */
export function mergeKeyed(base, mine, theirs, prefer = () => null) {
  const b = base || new Map();
  const entries = new Map(), conflicts = [];
  for (const key of new Set([...mine.keys(), ...theirs.keys()])) {
    const m = mine.get(key), t = theirs.get(key), o = b.get(key);
    if (m !== undefined && t !== undefined) {
      if (same(m, t)) entries.set(key, m);
      else if (o !== undefined && same(m, o)) entries.set(key, t);
      else if (o !== undefined && same(t, o)) entries.set(key, m);
      else {
        const side = prefer(m, t);
        if (!side) conflicts.push(key);
        entries.set(key, side === 'mine' ? m : t);
      }
    } else if (m !== undefined) {
      if (o === undefined || !same(m, o)) entries.set(key, m);
    } else if (o === undefined || !same(t, o)) entries.set(key, t);
  }
  return { entries, conflicts };
}

const asMap = o => new Map(Object.entries(o || {}));
const byId = list => new Map((list || []).map(p => [p.id, p]));
const later = (a, b) => ms(a) > ms(b) ? 'mine' : ms(b) > ms(a) ? 'theirs' : null;

/**
 * Merges two copies of one registry after a conflicting save: producers by id, figures and aliases by key,
 * decisions per key by `at`, and the manuscript of record by the time it was chosen. An entry both sides changed
 * goes to the side whose registry was saved later (`updatedAt`); equal times keep `theirs`, the committed file.
 * `base` (the copy both started from) lets a deletion survive; without it nothing is deleted. Answers
 * `{ registry, conflicts }`.
 */
export function merge(mine, theirs, base = null) {
  const m = normalise(mine), t = normalise(theirs), o = base ? normalise(base) : null;
  const side = later(m.updatedAt, t.updatedAt);
  const prefer = (x, y) => {
    const s = later(x?.updatedAt, y?.updatedAt);
    return s || side;
  };
  const conflicts = [];
  const take = (name, result) => { for (const k of result.conflicts) conflicts.push(`${name}:${k}`); return result.entries; };
  const producers = take('producer', mergeKeyed(o && byId(o.producers), byId(m.producers), byId(t.producers), prefer));
  const order = [...t.producers.map(p => p.id), ...m.producers.map(p => p.id)];
  const ids = [...new Set(order)].filter(id => producers.has(id));
  const out = {
    ...clone(t), ...clone(m),
    schema: SCHEMA, projectId: t.projectId || m.projectId,
    updatedAt: ms(m.updatedAt) > ms(t.updatedAt) ? m.updatedAt : t.updatedAt,
    producers: ids.map(id => producers.get(id)),
    figures: sortedMap(Object.fromEntries(take('figure', mergeKeyed(o && asMap(o.figures), asMap(m.figures), asMap(t.figures), prefer)))),
    alias: sortedMap(Object.fromEntries(take('alias', mergeKeyed(o && asMap(o.alias), asMap(m.alias), asMap(t.alias), prefer)))),
    decisions: mergeDecisions(m.decisions, t.decisions),
  };
  const scalar = (name, get, chosen) => {
    const x = get(m), y = get(t), z = o ? get(o) : undefined;
    if (same(x, y)) return x;
    if (o && same(x, z)) return y;
    if (o && same(y, z)) return x;
    const s = chosen(x, y) || side;
    if (!s) conflicts.push(name);
    return s === 'mine' ? x : y;
  };
  out.manuscript = scalar('manuscript', r => r.manuscript, (x, y) => later(x?.chosenAt, y?.chosenAt));
  out.outputDir = scalar('outputDir', r => r.outputDir, () => null);
  return { registry: out, conflicts };
}

// ---- adoption (a ledger proposal, plan §4.15c.3) -------------------------------------------
const slug = s => String(s || '').toLowerCase().replace(/\.[a-z0-9]+$/, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48);
const stem = p => String(p || '').split('/').pop();
const unique = (a, b) => [...new Set([...a, ...b])];

function candidateOf(raw, dropped, i) {
  if (!isObj(raw)) { dropped.push(`candidate ${i}: not a producer`); return null; }
  const id = typeof raw.id === 'string' && raw.id.trim() ? raw.id.trim() : slug(stem(raw.script) || raw.label || (strings(raw.outputs)[0] ? stem(strings(raw.outputs)[0]) : ''));
  if (!id) { dropped.push(`candidate ${i}: no id, script, label or output to name it by`); return null; }
  const p = normaliseProducer({ ...raw, id }, dropped, `candidate ${i}`);
  // Adoption can only assume a baseline; `verified` is the user's own mark.
  if (p?.baseline) p.baseline = { ...p.baseline, basis: 'assumed' };
  return p;
}

const withoutBaseline = ({ baseline, ...rest }) => rest;
const fieldsDiffering = (a, b) => [...new Set([...Object.keys(a), ...Object.keys(b)])].filter(k => k !== 'baseline' && !same(a[k], b[k])).sort();

/**
 * What accepting a list of producer candidates would change, as data and without writing anything: the
 * producers it adds, the ones it changes (with the fields), the ones already there, and the inputs that
 * did not resolve (listed, never used by a detector). Candidates with the same id are one producer (twins:
 * their outputs, imports and inputs are joined). Adoption never removes a producer, and a candidate baseline is
 * always `assumed`. Answers `{ add, changed, same, unresolved, dropped, counts }`.
 */
export function adoptDelta(candidates, registry = null) {
  const dropped = [];
  const merged = new Map();
  (Array.isArray(candidates) ? candidates : []).forEach((raw, i) => {
    const c = candidateOf(raw, dropped, i);
    if (!c) return;
    const prev = merged.get(c.id);
    if (!prev) { merged.set(c.id, c); return; }
    const inputs = [...prev.inputs];
    for (const x of c.inputs) if (!inputs.some(y => (y.path || y.state) === (x.path || x.state) && y.sheet === x.sheet)) inputs.push(x);
    merged.set(c.id, { ...prev, outputs: unique(prev.outputs, c.outputs), imports: unique(prev.imports, c.imports), inputs, baseline: prev.baseline || c.baseline });
    if (!merged.get(c.id).baseline) delete merged.get(c.id).baseline;
  });
  const have = byId(normalise(registry || emptyRegistry()).producers);
  const add = [], changed = [], unchanged = [];
  for (const c of merged.values()) {
    const old = have.get(c.id);
    if (!old) add.push(c);
    else {
      const fields = fieldsDiffering(old, c);
      if (fields.length) changed.push({ id: c.id, fields, producer: c }); else unchanged.push(c.id);
    }
  }
  const touched = [...add, ...changed.map(x => x.producer)];
  const unresolved = touched.flatMap(p => p.inputs.filter(x => !x.resolved).map(x => ({ producer: p.id, path: x.path || x.state, kind: x.kind })));
  return {
    add, changed, same: unchanged, unresolved, dropped,
    counts: {
      producers: touched.length,
      outputs: touched.reduce((n, p) => n + p.outputs.length, 0),
      inputs: touched.reduce((n, p) => n + p.inputs.filter(x => x.resolved).length, 0),
      unresolved: unresolved.length,
    },
  };
}

/**
 * The registry after the user accepts (part of) a delta: `only` names the producer ids of one family. A changed
 * producer takes the candidate's description but keeps the baseline it had, because a baseline is written only by
 * the user's Mark as current and by an accepted adoption for a producer that has none.
 */
export function applyDelta(registry, delta, { only = null, now = new Date() } = {}) {
  const base = normalise(registry || emptyRegistry());
  const wanted = id => !only || only.includes(id);
  const replace = new Map(delta.changed.filter(x => wanted(x.id)).map(x => [x.id, x.producer]));
  const producers = base.producers.map(p => {
    const c = replace.get(p.id);
    if (!c) return p;
    const next = { ...withoutBaseline(c) };
    const baseline = p.baseline || c.baseline;
    if (baseline) next.baseline = baseline;
    return next;
  });
  for (const c of delta.add) if (wanted(c.id)) producers.push(c);
  return touch({ ...base, producers }, now);
}
