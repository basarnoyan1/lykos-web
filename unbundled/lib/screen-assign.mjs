// Assignments and calibration batches (plan E4).
//
// A batch is a set of record ids, the reviewers who screen them and the stage
// they are screened at. A calibration batch is drawn at random (or stratified
// by source database) and screened by everyone; the rest can then be split
// between reviewers, with an optional overlap screened by two. Under dual
// screening, once a stage has batches a reviewer's queue is the records
// assigned to them, and a record's consensus needs the reviewers assigned to
// it (one for a record split to one person, two for calibration) rather than
// "any two". Reassigning a batch keeps its history; every change is logged.
//
// State: `screeningAssignments = [{ id, name, stage, kind, ids, reviewers,
// seed, strata, at, by, history: [{ at, by, action, from, to }] }]`.
// Batch state per reviewer (not started, in progress, complete) is read from
// the decisions, never stored, so it cannot drift from them.
import { update, persist } from '../store.mjs';

export const batchesOf = (s, stage = null) => (Array.isArray(s.screeningAssignments) ? s.screeningAssignments : []).filter(b => !stage || b.stage === stage);
// A random check sample (kind 'check', for the stopping estimate) is kept with
// the batches but assigns nothing: it never narrows a queue.
const assigning = (s, stage) => batchesOf(s, stage).filter(b => b.kind !== 'check');
/** The stage's random check sample, the latest drawn, or null. */
export const checkSample = (s, stage) => batchesOf(s, stage).filter(b => b.kind === 'check').at(-1) || null;

/** Normalised for storage (normalizeProject calls this). */
export function normalizeAssignments(v) {
  if (!Array.isArray(v)) return [];
  return v.filter(b => b && typeof b.id === 'string' && Array.isArray(b.ids) && Array.isArray(b.reviewers))
    .map(b => ({ ...b, stage: b.stage === 'ft' ? 'ft' : 'ta', ids: b.ids.map(String), reviewers: b.reviewers.map(r => String(r).trim()).filter(Boolean), history: Array.isArray(b.history) ? b.history : [] }));
}

/** The records assigned to a reviewer at a stage; null when the stage has no batches (everyone screens everything). */
export function assignedTo(s, stage, by) {
  const bs = assigning(s, stage); if (!bs.length) return null;
  const out = new Set();
  for (const b of bs) if (b.reviewers.includes(by)) for (const id of b.ids) out.add(id);
  return out;
}

/** The reviewers a record needs at a stage, from its batches; null when none assigns it. */
export function requiredFor(s, stage, id) {
  let out = null;
  for (const b of assigning(s, stage)) if (b.ids.includes(id)) { out ||= new Set(); for (const r of b.reviewers) out.add(r); }
  return out ? [...out] : null;
}

/** Record ids no batch of the stage holds, among `pool`. */
export function unassigned(s, stage, pool) {
  const held = new Set(assigning(s, stage).flatMap(b => b.ids));
  return pool.filter(id => !held.has(id));
}

// ---- random draws ----------------------------------------------------------
/** mulberry32: a small seeded generator, so a draw can be repeated from its seed. */
export function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
export function shuffle(list, rand) {
  const a = list.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

/**
 * n ids drawn from `pool` (ids), at random or stratified: `strataOf(id)`
 * names each record's stratum and every stratum gives its share (largest
 * remainders), so a 40-record sample of a 70/30 PubMed/Scopus pool has 28
 * and 12. Deterministic for a seed.
 */
export function drawSample(pool, n, { seed = 1, strataOf = null } = {}) {
  const rand = rng(seed); n = Math.min(n, pool.length);
  if (!strataOf) return shuffle(pool, rand).slice(0, n);
  const groups = new Map();
  for (const id of pool) { const k = strataOf(id) || ''; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(id); }
  const keys = [...groups.keys()].sort();
  const exact = keys.map(k => groups.get(k).length * n / pool.length);
  const take = exact.map(Math.floor);
  let left = n - take.reduce((a, b) => a + b, 0);
  for (const i of exact.map((x, i) => [x - Math.floor(x), i]).sort((a, b) => b[0] - a[0] || a[1] - b[1]).map(x => x[1])) { if (left <= 0) break; take[i]++; left--; }
  return shuffle(keys.flatMap((k, i) => shuffle(groups.get(k), rand).slice(0, take[i])), rand);
}

/**
 * The records left after the calibration batch split between reviewers:
 * shuffled, dealt in turn, and a share `overlap` (0–1) of them also given to
 * the next reviewer, so some records are screened twice outside calibration.
 * Returns one batch per reviewer: `[{ reviewer, ids, overlap }]`.
 */
export function splitIds(ids, reviewers, { seed = 1, overlap = 0 } = {}) {
  const rand = rng(seed), order = shuffle(ids, rand), k = reviewers.length;
  const out = reviewers.map(r => ({ reviewer: r, ids: [], overlap: [] }));
  const twice = k > 1 ? Math.round(order.length * Math.max(0, Math.min(1, overlap))) : 0;
  order.forEach((id, i) => {
    out[i % k].ids.push(id);
    if (i < twice) { const second = out[(i + 1) % k]; second.ids.push(id); second.overlap.push(id); }
  });
  return out;
}

// ---- changes -----------------------------------------------------------------
const newId = () => `b-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const log = (s, entry) => { s.screeningLog = s.screeningLog || []; s.screeningLog.push({ ...entry, at: new Date().toISOString() }); };

/** Adds batches; each is logged. Returns their ids. */
export function addBatches(list, { by = '' } = {}) {
  const ids = [];
  update(s => {
    s.screeningAssignments = normalizeAssignments(s.screeningAssignments);
    for (const b of list) {
      const batch = { id: newId() + ids.length, name: b.name, stage: b.stage || 'ta', kind: b.kind || 'manual', ids: [...new Set(b.ids)], reviewers: [...new Set(b.reviewers)],
        ...(b.seed != null ? { seed: b.seed } : {}), ...(b.strata ? { strata: b.strata } : {}), ...(b.pool != null ? { pool: b.pool } : {}), at: new Date().toISOString(), by, history: [] };
      s.screeningAssignments.push(batch); ids.push(batch.id);
      log(s, { action: 'assign', stage: batch.stage, batch: batch.name, kind: batch.kind, count: batch.ids.length, reviewers: batch.reviewers.join(', '), by });
    }
    return s;
  });
  persist();
  return ids;
}

/** A batch handed from one reviewer to another; the change is kept in the batch's history and the log. */
export function reassign(batchId, from, to, { by = '' } = {}) {
  to = String(to || '').trim();
  if (!to) return;
  update(s => {
    const b = batchesOf(s).find(x => x.id === batchId); if (!b || !b.reviewers.includes(from) || from === to) return s;
    b.reviewers = [...new Set(b.reviewers.map(r => r === from ? to : r))];
    b.history = [...(b.history || []), { at: new Date().toISOString(), by, action: 'reassign', from, to }];
    log(s, { action: 'reassign', stage: b.stage, batch: b.name, from, to, by });
    return s;
  });
  persist();
}

/** A batch removed; decisions made in it stay. */
export function removeBatch(batchId, { by = '' } = {}) {
  update(s => {
    const b = batchesOf(s).find(x => x.id === batchId); if (!b) return s;
    s.screeningAssignments = batchesOf(s).filter(x => x.id !== batchId);
    log(s, { action: 'unassign', stage: b.stage, batch: b.name, count: b.ids.length, by });
    return s;
  });
  persist();
}

// ---- progress and agreement --------------------------------------------------
const own = (s, stage, id) => s.dual?.[stage]?.[id] || {};

/** Per reviewer of a batch: assigned, decided, and the state that follows. */
export function batchProgress(s, b) {
  return b.reviewers.map(r => {
    let decided = 0;
    for (const id of b.ids) { const d = own(s, b.stage, id)[r]; if (d && d.decision !== 'uncertain') decided++; }
    return { reviewer: r, assigned: b.ids.length, decided, state: !decided ? 'Not started' : decided >= b.ids.length ? 'Complete' : 'In progress' };
  });
}

/**
 * Cohen's kappa from paired ratings: `pairs` is `[[a, b], …]`, `cats` the
 * categories. Returns `{ n, po, pe, kappa }`; kappa is null with no pairs,
 * and 1 when both raters used a single identical category throughout.
 */
export function cohenKappa(pairs, cats = ['include', 'exclude', 'uncertain']) {
  const n = pairs.length; if (!n) return { n: 0, po: null, pe: null, kappa: null };
  const ma = Object.fromEntries(cats.map(c => [c, 0])), mb = { ...ma };
  let agree = 0;
  for (const [a, b] of pairs) { if (a === b) agree++; ma[a] = (ma[a] || 0) + 1; mb[b] = (mb[b] || 0) + 1; }
  const po = agree / n;
  const pe = Object.keys({ ...ma, ...mb }).reduce((acc, c) => acc + ((ma[c] || 0) / n) * ((mb[c] || 0) / n), 0);
  return { n, po, pe, kappa: pe === 1 ? (po === 1 ? 1 : 0) : (po - pe) / (1 - pe) };
}

/** Kappa between two reviewers over a set of records (those both decided). */
export function pairKappa(s, stage, ids, a, b) {
  const pairs = [];
  for (const id of ids) { const d = own(s, stage, id); if (d[a] && d[b]) pairs.push([d[a].decision, d[b].decision]); }
  return cohenKappa(pairs);
}

/**
 * Per reviewer, for the stage: records assigned and decided across batches,
 * and agreement on the calibration batches with each other reviewer.
 */
export function reviewerSummary(s, stage) {
  const bs = assigning(s, stage);
  const people = [...new Set(bs.flatMap(b => b.reviewers))].sort();
  const calib = bs.filter(b => b.kind === 'calibration').flatMap(b => b.ids);
  return people.map(r => {
    const ids = new Set(bs.filter(b => b.reviewers.includes(r)).flatMap(b => b.ids));
    let decided = 0; for (const id of ids) { const d = own(s, stage, id)[r]; if (d && d.decision !== 'uncertain') decided++; }
    const agreement = people.filter(o => o !== r).map(o => ({ with: o, ...pairKappa(s, stage, calib, r, o) }));
    return { reviewer: r, assigned: ids.size, decided, agreement };
  });
}
