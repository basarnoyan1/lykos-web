// Screening decisions: two stages, one log.
//
// A title/abstract decision lives in `screening`, a full-text decision in
// `fulltext`, both keyed by record id. Every change — a decision, an undo, a
// reset — is appended to `screeningLog` and never edited, so what the review
// concluded and how it got there are two different questions with two
// different answers (plan E1, E5). A decision follows the store's short save
// debounce and is flushed when the window hides or closes: a run of quick
// decisions is one write, not a clone of the whole project per keystroke.
import { update, whenSaved } from '../store.mjs';
import { assignedTo, requiredFor } from './screen-assign.mjs';

export const STAGES = [
  { id: 'ta', label: 'Title and abstract', key: 'screening' },
  { id: 'ft', label: 'Full text',          key: 'fulltext' },
];
export const stageOf = id => STAGES.find(s => s.id === id) || STAGES[0];

export const decisionAt = (s, stage, id) => s[stageOf(stage).key]?.[id] || null;

// ---- two reviewers -----------------------------------------------------------
// With dual screening on, each reviewer's decision goes to `dual[stage][id]`
// under their initials, unseen by the other. The consensus — what the rest of
// the review reads from `screening`/`fulltext` — is written only when two
// reviewers agree, or when a conflict is resolved by hand.
export const isDual = s => Boolean(s.settings?.dualScreening);
const own = (s, stage, id) => s.dual?.[stage]?.[id] || {};
export const ownDecision = (s, stage, id, by) => (by && own(s, stage, id)[by]) || null;
export const reviewersOf = (s, stage) => {
  const set = new Set();
  for (const d of Object.values(s.dual?.[stage] || {})) for (const r of Object.keys(d)) set.add(r);
  return [...set].sort();
};

/**
 * Both decided and not the same: the records a pair has to talk about. With
 * `{ resolved: true }` the settled ones follow the open ones, each with the
 * resolution, so a settlement can be read back and reopened (plan E5).
 */
export function conflicts(s, stage, { resolved = false } = {}) {
  const key = stageOf(stage).key; const open = [], settled = [];
  for (const p of s.papers || []) {
    const d = own(s, stage, p.id); const who = Object.keys(d);
    if (who.length < 2) continue;
    const kinds = new Set(who.map(r => d[r].decision));
    if (kinds.size < 2) continue;
    const c = s[key]?.[p.id];
    const item = { paper: p, decisions: who.sort().map(r => ({ by: r, ...d[r] })) };
    if (!c) open.push(item);
    else if (resolved && c.resolved) settled.push({ ...item, resolution: c });
  }
  return resolved ? [...open, ...settled] : open;
}

/**
 * The consensus a record's own decisions make, or null. Without assignments
 * two reviewers must agree; with them, the reviewers assigned to the record
 * must all have decided alike (one, for a record split to one person). An
 * uncertain decision is never a consensus.
 */
export function consensusOf(s, stage, id) {
  const d = own(s, stage, id); const all = Object.entries(d);
  const need = requiredFor(s, stage, id);
  const needed = need ? Math.max(1, need.filter(r => r).length) : 2;
  if (need && !need.every(r => d[r])) return null;
  if (all.length < needed) return null;
  const kinds = new Set(all.map(([, x]) => x.decision));
  if (kinds.size !== 1 || kinds.has('uncertain')) return null;
  const decision = all[0][1].decision;
  return { decision, reason: all.find(([, x]) => x.reason)?.[1].reason || '', note: all.map(([r, x]) => x.note ? `${r}: ${x.note}` : '').filter(Boolean).join(' · '),
    at: new Date().toISOString(), by: all.map(([r]) => r).sort().join('+') };
}

/** Cohen's κ over the records two reviewers both decided (three categories). */
export function agreement(s, stage) {
  const rs = reviewersOf(s, stage); if (rs.length < 2) return { n: 0, kappa: null };
  const [a, b] = rs; const cats = ['include', 'exclude', 'uncertain'];
  let n = 0, agree = 0; const ma = {}, mb = {};
  for (const d of Object.values(s.dual?.[stage] || {})) {
    if (!d[a] || !d[b]) continue; n++;
    if (d[a].decision === d[b].decision) agree++;
    ma[d[a].decision] = (ma[d[a].decision] || 0) + 1; mb[d[b].decision] = (mb[d[b].decision] || 0) + 1;
  }
  if (!n) return { n: 0, kappa: null };
  const po = agree / n; const pe = cats.reduce((acc, c) => acc + ((ma[c] || 0) / n) * ((mb[c] || 0) / n), 0);
  return { n, kappa: pe === 1 ? 1 : (po - pe) / (1 - pe), reviewers: rs };
}

/** What the review concluded about a record: full text if decided, else title/abstract. */
export const finalDecision = (s, id) => s.fulltext?.[id] || s.screening?.[id] || null;
export const isIncluded = (s, id) => finalDecision(s, id)?.decision === 'include';

/**
 * The studies the later stages work on. Once screening has a decision in it,
 * that is the included studies and nothing else: extracting from or
 * appraising a record screening has not let through contradicts the review's
 * own flow. Before any decision the whole library is in scope, because the
 * plan keeps screening optional (§1.1): an ordinary research workspace can
 * compare and appraise papers without a formal eligibility stage.
 */
export const screeningStarted = s => (s.papers || []).some(p => finalDecision(s, p.id));
export const studies = s => screeningStarted(s) ? (s.papers || []).filter(p => isIncluded(s, p.id)) : (s.papers || []);

/** Records a stage still has to decide: undecided or uncertain. */
export function queue(s, stage, by = '') {
  const papers = s.papers || [];
  const pool = stage === 'ft' ? papers.filter(p => s.screening?.[p.id]?.decision === 'include') : papers;
  // dual: what this reviewer has not decided, whatever the other did; with
  // assignments at this stage, only the records assigned to them (plan E4)
  if (isDual(s) && by) {
    const mine = assignedTo(s, stage, by);
    const own = mine ? pool.filter(p => mine.has(p.id)) : pool;
    return { pool: own, open: own.filter(p => { const d = ownDecision(s, stage, p.id, by); return !d || d.decision === 'uncertain' || d.needsCriteriaReview === true; }) };
  }
  return { pool, open: pool.filter(p => { const d = decisionAt(s, stage, p.id); return !d || d.decision === 'uncertain' || d.needsCriteriaReview === true; }) };
}

function log(s, entry) {
  s.screeningLog = s.screeningLog || [];
  s.screeningLog.push({ ...entry, at: new Date().toISOString() });
}

// What a decision carries besides its verdict: the reviewer's note (plan E1)
// and the time the record was on screen before it (E8), in milliseconds.
const extras = ({ via = '', note = '', ms = 0 } = {}) => ({
  ...(via ? { via } : {}), ...(String(note || '').trim() ? { note: String(note).trim().slice(0, 2000) } : {}),
  ...(Number.isFinite(ms) && ms > 0 ? { ms: Math.round(ms) } : {}) });

// One decision applied to the live state (inside an update).
function applyDecision(s, stage, id, decision, { reason = '', by = '', via = '', note = '', ms = 0 } = {}) {
  if (decision === 'exclude' && !reason) throw new Error('An exclusion needs a reason');
  const key = stageOf(stage).key;
  const more = extras({ via, note, ms });
  if (isDual(s)) {
    if (!by) throw new Error('Dual screening needs reviewer initials');
    s.dual = s.dual || {}; s.dual[stage] = s.dual[stage] || {}; s.dual[stage][id] = s.dual[stage][id] || {};
    const prior = s.dual[stage][id][by];
    s.dual[stage][id][by] = { decision, reason: decision === 'exclude' ? reason : '', at: new Date().toISOString(), ...more };
    log(s, { action: prior ? 'change' : 'decide', stage, id, decision, reason: decision === 'exclude' ? reason : '', by, prior: prior?.decision, ...more });
    settleConsensus(s, stage, id);
    return;
  }
  s[key] = s[key] || {};
  const prior = s[key][id];
  s[key][id] = { decision, reason: decision === 'exclude' ? reason : '', at: new Date().toISOString(), by, ...more };
  log(s, { action: prior ? 'change' : 'decide', stage, id, decision, reason: s[key][id].reason, by, prior: prior?.decision, ...more });
}

// The reviewers agree (as assigned): that is the consensus; otherwise it
// waits, in conflicts when they differ. A hand resolution is left alone.
export function settleConsensus(s, stage, id, { quiet = false } = {}) {
  const key = stageOf(stage).key;
  if (s[key]?.[id]?.resolved) return;
  const c = consensusOf(s, stage, id);
  if (c) {
    const had = s[key]?.[id];
    s[key] = s[key] || {}; s[key][id] = c;
    if (!quiet && had?.decision !== c.decision) log(s, { action: 'agree', stage, id, decision: c.decision, by: c.by });
  } else if (s[key]?.[id]) delete s[key][id];
}

export function decide(stage, id, decision, { reason = '', by = '', via = '', note = '', ms = 0 } = {}) {
  if (decision === 'exclude' && !reason) throw new Error('An exclusion needs a reason');
  update(s => { applyDecision(s, stage, id, decision, { reason, by, via, note, ms }); return s; });
  return whenSaved();
}

/**
 * Several decisions as one change and one write: accepting a batch of
 * proposals used to make one store update (and one repaint signal) per
 * record. Every decision is still logged on its own.
 */
export function decideMany(stage, list, { by = '' } = {}) {
  for (const d of list) if (d.decision === 'exclude' && !d.reason) throw new Error('An exclusion needs a reason');
  if (!list.length) return Promise.resolve();
  update(s => { for (const d of list) applyDecision(s, stage, d.id, d.decision, { reason: d.reason || '', by, via: d.via || '' }); return s; });
  return whenSaved();
}

/** What a reviewer's decision on a record is now, to put back with revert(). */
export function priorOf(s, stage, id, by = '') {
  const d = isDual(s) && by ? s.dual?.[stage]?.[id]?.[by] : s[stageOf(stage).key]?.[id];
  return d ? structuredClone(d) : null;
}

/**
 * Takes back the last decision on a record: the decision it replaced comes
 * back as it was (reason, reviewer, time), or the record is undecided again.
 * Logged as an undo, like the inspector's Undo.
 */
export function revert(stage, id, prior, { by = '' } = {}) {
  if (!prior) return undo(stage, id, { by });
  const key = stageOf(stage).key;
  update(s => {
    if (isDual(s) && by) {
      const now = s.dual?.[stage]?.[id]?.[by];
      s.dual = s.dual || {}; s.dual[stage] = s.dual[stage] || {}; s.dual[stage][id] = s.dual[stage][id] || {};
      s.dual[stage][id][by] = prior;
      settleConsensus(s, stage, id, { quiet: true });
      log(s, { action: 'undo', stage, id, prior: now?.decision, decision: prior.decision, by });
      return s;
    }
    const now = s[key]?.[id];
    s[key] = s[key] || {};
    s[key][id] = prior;
    log(s, { action: 'undo', stage, id, prior: now?.decision, decision: prior.decision, by });
    return s;
  });
  return whenSaved();
}

/**
 * A conflict settled (plan E5): the consensus is written and the settlement
 * logged with the reviewers' decisions it settled, whose call was taken
 * (`picked`, or none for a third decision) and why (`why`). The reviewers'
 * own decisions are never changed.
 */
export function resolve(stage, id, decision, { reason = '', by = '', why = '', picked = '', note = '' } = {}) {
  if (decision === 'exclude' && !reason) throw new Error('An exclusion needs a reason');
  const key = stageOf(stage).key;
  update(s => {
    const settled = Object.entries(own(s, stage, id)).map(([r, d]) => `${r} ${d.decision}`).join(', ');
    s[key] = s[key] || {};
    s[key][id] = { decision, reason: decision === 'exclude' ? reason : '', at: new Date().toISOString(), by, resolved: true,
      ...(picked ? { picked } : {}), ...(String(why || '').trim() ? { why: String(why).trim() } : {}), ...(String(note || '').trim() ? { note: String(note).trim() } : {}) };
    log(s, { action: 'resolve', stage, id, decision, reason: s[key][id].reason, by, settled, ...(picked ? { picked } : {}), ...(s[key][id].why ? { why: s[key][id].why } : {}) });
    return s;
  });
  return whenSaved();
}

/**
 * A resolution taken back: logged with who reopened it and why, and the
 * record is a conflict again. It is never removed quietly.
 */
export function reopen(stage, id, { by = '', why = '' } = {}) {
  const key = stageOf(stage).key;
  update(s => {
    const c = s[key]?.[id]; if (!c?.resolved) return s;
    delete s[key][id];
    if (stage === 'ta' && s.fulltext?.[id]) log(s, { action: 'note', stage: 'ft', id, text: 'Title/abstract resolution reopened; full-text decision kept' });
    log(s, { action: 'reopen', stage, id, prior: c.decision, by, ...(String(why || '').trim() ? { why: String(why).trim() } : {}) });
    return s;
  });
  return whenSaved();
}

export function undo(stage, id, { by = '' } = {}) {
  const key = stageOf(stage).key;
  update(s => {
    if (isDual(s) && by) {
      const mine = s.dual?.[stage]?.[id]?.[by]; if (!mine) return s;
      delete s.dual[stage][id][by];
      settleConsensus(s, stage, id, { quiet: true });   // an agreement one side withdrew
      log(s, { action: 'undo', stage, id, prior: mine.decision, by });
      return s;
    }
    const prior = s[key]?.[id]; if (!prior) return s;
    delete s[key][id];
    log(s, { action: 'undo', stage, id, prior: prior.decision, by });
    return s;
  });
  return whenSaved();
}

export function reset(stage, { by = '' } = {}) {
  const key = stageOf(stage).key;
  update(s => {
    const n = Object.keys(s[key] || {}).length;
    s[key] = {};
    if (s.dual?.[stage]) s.dual[stage] = {};
    if (stage === 'ta') { s.fulltext = {}; if (s.dual?.ft) s.dual.ft = {}; }   // a full-text decision presumes a title/abstract inclusion
    log(s, { action: 'reset', stage, count: n, by });
    return s;
  });
  return whenSaved();
}

/** Every decision on record, newest first, for the log table. */
export function decisions(s, { by = '' } = {}) {
  const out = [];
  if (isDual(s) && by) {
    // blinded: a reviewer's log is their own decisions, not the other's
    for (const st of STAGES)
      for (const [id, d] of Object.entries(s.dual?.[st.id] || {})) if (d[by]) out.push({ id, stage: st.id, by, ...d[by] });
  } else {
    for (const st of STAGES)
      for (const [id, d] of Object.entries(s[st.key] || {})) out.push({ id, stage: st.id, ...d });
  }
  return out.sort((a, b) => (b.at || '').localeCompare(a.at || ''));
}
