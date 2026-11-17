// The accepted counts and study decisions that produced a pooled analysis.
// A snapshot is kept with the result so later edits cannot silently leave a
// manuscript using an estimate computed from different inputs.
import { lib_screen$isIncluded as isIncluded } from "../boot.mjs";
import { lib_effect_measures$measureOf as measureOf, lib_effect_measures$inputFields as inputFields } from "../boot.mjs";
import { usesPrePostR, PREPOST_R } from './change-measures.mjs';
import { lib_outcomes$PRIMARY as PRIMARY, lib_outcomes$fieldFor as fieldFor } from "../boot.mjs";
import { derivedInputs } from './derived-counts.mjs';
import { contrastInputs, isContrast } from './contrast-counts.mjs';
import { lib_multi_arm$contrastRows as contrastRows, lib_multi_arm$multiArmOf as multiArmOf, lib_multi_arm$contrastLabel as contrastLabel } from "../boot.mjs";
import { reportedEffect, reportedMix } from './reported-effects.mjs';

// A value marked not reported is missing, never zero and never an unreadable
// number (plan F3): the study is incomplete, not invalid.
const notReported = value => value?.availability === 'not_found';

export const acceptedCount = value => {
  if (notReported(value)) return null;
  const raw = value?.normalized_value ?? value?.reported_value;
  if (raw == null || String(raw).trim() === '') return null;
  const n = Number(raw);
  return Number.isSafeInteger(n) && n >= 0 ? n : NaN;
};

/** A measured value (a mean or SD): any finite number; null when empty. */
export const acceptedNumber = value => {
  if (notReported(value)) return null;
  const raw = value?.normalized_value ?? value?.reported_value;
  if (raw == null || String(raw).trim() === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : NaN;
};

/** A study's inputs for a measure and outcome (or slot), in inputFields order; null where missing, NaN where unreadable. */
export function studyInputs(s, paperId, measure, outcomeId = PRIMARY) {
  if (measureOf(measure).family === 'reported') return reportedEffect(s, paperId, measure, outcomeId).values;
  return inputFields(measure).map(f => (/^(n|events)(_|$)/.test(f) ? acceptedCount : acceptedNumber)(s.values?.[`${paperId}:${fieldFor(f, outcomeId)}`]));
}

/**
 * The rows a study contributes for a measure and slot (plan G3: study ×
 * outcome × timepoint × contrast): one for a two-arm study; for a study with
 * several treated arms, the chosen comparison or one row per arm with the
 * shared control split (lib/multi-arm.mjs). Each row: { id, contrast, split,
 * label, values }; a two-arm study's id is its paper id, as before.
 */
export function studyRows(s, paper, measure, slot = PRIMARY, { assumedR = PREPOST_R } = {}) {
  if (measureOf(measure).family === 'reported') {
    const r = reportedEffect(s, paper.id, measure, slot);
    return [{ ...r, id: paper.id, contrast: r.identity.contrast, split: false,
      label: `${paper.label || paper.id}${r.identity.contrast ? `, ${r.identity.contrast}` : ''}`, values: r.values,
      snap: `${paper.label || paper.id}${r.identity.contrast ? ` · ${r.identity.contrast}` : ''}` }];   // lint-allow-dot: the snapshot's form (pooledInputs)
  }
  const bases = inputFields(measure), fields = bases.map(f => fieldFor(f, slot));
  const read = id => (/^(n|events)(_|$)/.test(id.replace(/__.*|#.*|@.*/g, '')) ? acceptedCount : acceptedNumber)(s.values?.[`${paper.id}:${id}`]);
  const m = multiArmOf(s, paper.id);
  // SMCR: a baseline–follow-up correlation the study does not report is assumed (PREPOST_R), and the row says so; an unreadable one stays invalid
  const ri = usesPrePostR(measure) ? bases.indexOf('r_prepost') : -1;
  const withR = r => (ri < 0 || r.values[ri] !== null ? r : { ...r, values: r.values.map((x, i) => (i === ri ? assumedR : x)), assumedR: true });
  return contrastRows(s, paper.id, measure, fields, bases, read).map(withR).map(r => ({ ...r,
    id: r.contrast && m ? `${paper.id}@${r.contrast}` : paper.id,
    label: r.contrast && m ? contrastLabel(paper, m, r.contrast, r.split) : paper.label || '',
    snap: r.contrast && m ? contrastLabel(paper, m, r.contrast, r.split, ' · ') : paper.label || '' }));   // lint-allow-dot: the snapshot's form
}

// Inputs a measure cannot use: an arm of fewer than two for a mean and SD,
// a negative or zero SD, or more events than participants.
function invalidInputs(measure, v) {
  if (v.some(n => !Number.isFinite(n))) return true;
  const family = measureOf(measure).family;
  if (family === 'reported') return !(v[1] > 0) || measureOf(measure).ratio && !(v[0] > 0);
  if (family === 'proportion') { const [x, n] = v; return n < 1 || x > n; }
  if (family === 'single-mean') { const [, sd, n] = v; return n < 2 || sd <= 0; }
  // Fisher's z needs n > 3 (its variance is 1/(n − 3)) and |r| < 1.
  if (family === 'correlation') { const [r, n] = v; return n < 4 || !(r > -1 && r < 1); }
  if (family === 'rate') { const [x1, t1, x2, t2] = v; return !(t1 > 0 && t2 > 0) || x1 < 0 || x2 < 0; }
  if (measureOf(measure).family === 'generic') {
    const [est, lo, hi] = v;   // a ratio and its CI: positive, and the estimate inside its interval
    return !(lo > 0 && est > 0 && hi > lo && lo <= est && est <= hi);
  }
  // a within-arm change: J(n − 1) needs n ≥ 3; an SD above 0; a correlation within [−1, 1], as escalc requires
  if (family === 'change') { const [n, , , sd, r = 0] = v; return n < 3 || sd <= 0 || !(r >= -1 && r <= 1); }
  if (measureOf(measure).family === 'continuous') {
    const [, sdT, nT, , sdC, nC] = v;
    return nT < 2 || nC < 2 || sdT <= 0 || sdC <= 0;
  }
  const [eventsT, nT, eventsC, nC] = v;
  return nT < 1 || nC < 1 || eventsT > nT || eventsC > nC;
}

/** The rule an outcome reads its counts by, when it reads them from a table's text (lib/derived-counts.mjs). */
export const derivedOf = (s, outcomeId = PRIMARY) => (s.outcomes || []).find(o => o.id === outcomeId)?.derived || null;

// The page asks several times a draw (the inputs, the grid, whether it can be entered), each a pass over every record (20 ms on 30,000):
// the app's pages hand a project's version (cacheEligibleBy, views/analysis.mjs), and the list is kept while it holds. This module also runs
// in a worker, without the store: there nothing is kept.
let versionOf = () => null, eligibleMemo = null;
export function cacheEligibleBy(fn) { versionOf = fn; eligibleMemo = null; }
/** The studies a pooled effect is run on: the included studies once screening has a decision, every record before. */
export function poolEligible(s) {
  const version = versionOf(s);
  if (version == null) return eligibleOnce(s);
  if (eligibleMemo?.s !== s || eligibleMemo.version !== version) eligibleMemo = { s, version, list: eligibleOnce(s) };
  return eligibleMemo.list;
}
function eligibleOnce(s) {
  const papers = s.papers || [];
  const decided = papers.some(p => s.screening?.[p.id] || s.fulltext?.[p.id]);
  return decided ? papers.filter(p => isIncluded(s, p.id)) : papers;
}

export function pooledInputs(s, moderator = '', measure = s.analysis?.measure || s.settings?.measure || 'RR', outcomeId = PRIMARY, { assumedR = PREPOST_R } = {}) {
  // Counts read from a table's text: one row per arm, whatever measure was asked for.
  const derived = derivedOf(s, outcomeId);
  // two arms of a study compared, from the same text (lib/contrast-counts.mjs): one row per study, as pairwise rows
  if (isContrast(derived)) return contrastInputs(s, derived, moderator, measure);
  if (derived) return derivedInputs(s, derived, moderator);
  const eligible = poolEligible(s);
  const ready = [], incomplete = [], invalid = [], units = [];
  for (const paper of eligible) {
    // one row per comparison: a study with several treated arms may give two (lib/multi-arm.mjs)
    const rows = studyRows(s, paper, measure, outcomeId, { assumedR });
    if (rows.some(r => r.invalid)) { invalid.push(paper); continue; }
    if (rows.some(r => r.incomplete || r.values.some(n => n === null))) { incomplete.push(paper); continue; }
    if (rows.some(r => invalidInputs(measure, r.values))) { invalid.push(paper); continue; }
    ready.push(paper);
    for (const r of rows) units.push({ ...r, paper });
  }
  // a number by its value; any other value by its reported text, so a code or a list (lib/field-kinds.mjs) groups by its label
  const modText = p => { if (!moderator) return ''; const v = s.values?.[`${p.id}:${moderator}`];
    return String(typeof v?.normalized_value === 'number' ? v.normalized_value : v?.reported_value ?? v?.normalized_value ?? ''); };
  // Sort the snapshot, not the display order: moving a row in the library
  // does not change the scientific inputs. A two-arm study's row is exactly
  // what it was before contrasts existed, so earlier results stay current.
  units.sort((a, b) => a.id.localeCompare(b.id));
  // a contrast row's label as analyses before 2026-10-20 recorded it (" · "), not as it is shown now, so they stay current
  const rows = units.map(u => [u.id, u.contrast ? (u.snap ?? u.label) : (u.paper.label || ''), ...u.values, modText(u.paper)]);
  const pending = [...incomplete.map(p => [p.id, 'incomplete']), ...invalid.map(p => [p.id, 'invalid'])]
    .sort((a, b) => a[0].localeCompare(b[0]));
  // A binary snapshot keeps its old shape, so analyses run before continuous
  // measures existed are still recognised as current.
  const family = measureOf(measure).family;
  const identity = family === 'reported' ? { measure, identities: units.map(u => [u.id, u.identity, u.raw]), mix: reportedMix(s, units, outcomeId) } : {};
  // the rows whose baseline–follow-up correlation was assumed, and the value assumed (SMCR)
  const assumed = usesPrePostR(measure) ? { assumedR: units.filter(u => u.assumedR).map(u => u.id), assumedRValue: assumedR } : {};
  return { ready, incomplete, invalid, units, measure, ...identity, ...assumed,
    snapshot: JSON.stringify(family === 'binary' ? { moderator, rows, pending } : { family, moderator, rows, pending, ...identity, ...assumed }) };
}

/**
 * A snapshot with each row's study name left out: the row's unit id names the study, and its name is how it is shown (28 Oct 2026: "Aygun
 * 2017" relabelled "Aygün 2017" marked 7 of the ASD review's 8 analyses as changed, and the readiness score fell for it).
 */
function withoutNames(text) {
  try { const o = JSON.parse(text); if (Array.isArray(o.rows)) o.rows = o.rows.map(r => (Array.isArray(r) ? [r[0], ...r.slice(2)] : r)); return JSON.stringify(o); } catch { return null; }
}
export function pooledInputStatus(s, analysis = s.analysis, outcomeId = analysis?.outcomeId || PRIMARY) {
  if (!analysis) return 'none';
  if (!analysis.inputSnapshot) return 'untracked';
  const now = pooledInputs(s, analysis.moderator || '', analysis.measure, outcomeId).snapshot;
  if (now === analysis.inputSnapshot) return 'current';
  const a = withoutNames(now);
  return a != null && a === withoutNames(analysis.inputSnapshot) ? 'current' : 'stale';
}

/**
 * How a pooled analysis handles studies with zero events (plan I4: recorded
 * explicitly). metafor's escalc adds 0.5 to every cell of a study that has a
 * zero cell (add = 1/2, to = "only0") and to no other study. A study with no
 * events in either arm carries no information about a ratio (Cochrane
 * Handbook 10.4.4.2, RevMan and meta's default): it is not estimable for a
 * risk ratio, odds ratio or rate ratio and is left out, and named. For an odds
 * ratio the same holds when every participant in both arms had the event. A
 * risk difference keeps such studies. `rows` are the studies' inputs in
 * inputFields order; returns the indices used, corrected and left out.
 */
export function zeroEvents(measure, rows) {
  const family = measureOf(measure).family, id = measureOf(measure).id;
  const used = [], corrected = [], excluded = [];
  rows.forEach((v, i) => {
    let zero = false, none = false;
    if (family === 'binary') {
      const [a, n1, c, n2] = v;
      zero = [a, n1 - a, c, n2 - c].some(x => x === 0);
      none = (id === 'RR' || id === 'OR') && a === 0 && c === 0 || id === 'OR' && a === n1 && c === n2;
    } else if (family === 'rate') {
      const [x1, , x2] = v;
      zero = x1 === 0 || x2 === 0; none = x1 === 0 && x2 === 0;
    } else if (family === 'proportion') {
      // the double arcsine has no zero cell: nothing is added for it
      const [x, n] = v;
      zero = id !== 'PFT' && (x === 0 || x === n);
    }
    if (none) { excluded.push(i); return; }
    used.push(i);
    if (zero) corrected.push(i);
  });
  return { used, corrected, excluded };
}

/** The sentence a result records for its zero-event handling; '' when no study had a zero cell. */
export function zeroEventsText(measure, labels, { corrected = [], excluded = [] } = {}) {
  const name = i => labels[i] || `Study ${i + 1}`, list = ix => ix.map(name).join(', ');
  const parts = [];
  if (corrected.length) parts.push(`0.5 added to each cell of ${corrected.length} ${corrected.length === 1 ? 'study' : 'studies'} with a zero cell (${list(corrected)})`);
  if (excluded.length) parts.push(`${excluded.length} ${excluded.length === 1 ? 'study' : 'studies'} with no events in either arm not estimable for ${measureOf(measure).id} and left out (${list(excluded)})`);
  return parts.join('; ');
}
