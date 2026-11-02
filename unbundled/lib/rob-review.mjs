// Risk-of-bias assessments per outcome, by two reviewers, reconciled (plan H3).
//
// RoB 2 judges a result and ROBINS-I an outcome, so an assessment is kept per
// study and level: 'study' (the default, and every assessment made before
// levels existed) or an outcome id. A study assessed only at study level uses
// that assessment for every outcome; an outcome assessed on its own uses its
// own.
//
// With a second reviewer, reviewer A and reviewer B answer independently; a
// domain on which they differ is a discrepancy until a resolved value is
// recorded with its reason; the final judgement of a domain is the agreed or
// resolved one. When every domain has a final judgement and none is open, the
// consensus can be confirmed; any later change clears the confirmation.
//
//   s.robReview = { second: false, records: { [paperId]: { [toolId]: { [level]: {
//     a: { d1: 'Low', … }, b: { … }, resolved: { d1: { value, reason, at } }, consensus: { at } | null } } } } }
//
// `s.assessments[paperId][toolId]` keeps the final study-level judgements,
// the shape every other reader (figures, results, bundle, certainty) knows;
// it is rewritten from these records on every change. With one reviewer it is
// reviewer A's answers, exactly as before.
//
// Pure (no store import): the view, the migration in normalizeProject and the
// tests call it with the state.
export const STUDY = 'study';
export const OVERALL = 'overall';

// Instruments judged per result or outcome; the others appraise a study as a whole.
export const PER_OUTCOME = new Set(['rob2', 'robins-i', 'robins-e', 'rob-me']);

const isInstrument = (k, toolIds) => toolIds.includes(k);
/** A study's answers as stored before reviewers and levels: per instrument, or the flat RoB 2 shape. */
export function legacyAnswers(rec, toolId, toolIds) {
  if (!rec) return {};
  if (rec[toolId]) return { ...rec[toolId] };
  return toolId === 'rob2' ? Object.fromEntries(Object.entries(rec).filter(([k]) => !isInstrument(k, toolIds))) : {};
}

export const secondOn = s => Boolean(s.robReview?.second);
export const recordOf = (s, paperId, toolId, level = STUDY) => s.robReview?.records?.[paperId]?.[toolId]?.[level] || null;
const has = o => o && Object.keys(o).length > 0;

/** The domain ids an instrument asks, with its overall when it has one. */
export const domainIds = tool => [...tool.domains.map(d => d.id), ...(tool.overall ? [OVERALL] : [])];

/** Reviewer A's or B's answers at a level. */
export const answersBy = (s, paperId, toolId, level, who) => ({ ...(recordOf(s, paperId, toolId, level)?.[who === 'b' ? 'b' : 'a'] || {}) });

/**
 * The final judgements at a level: reviewer A's with one reviewer; with two,
 * each domain the reviewers agree on or that has a resolved value.
 */
export function finalAnswers(s, paperId, toolId, level = STUDY) {
  const r = recordOf(s, paperId, toolId, level);
  if (!r) return {};
  if (!secondOn(s)) return { ...(r.a || {}) };
  const out = {}, a = r.a || {}, b = r.b || {}, res = r.resolved || {};
  for (const d of new Set([...Object.keys(a), ...Object.keys(b), ...Object.keys(res)])) {
    if (res[d]?.value) out[d] = res[d].value;
    else if (a[d] && a[d] === b[d]) out[d] = a[d];
  }
  return out;
}

/** Whether a level has an assessment of its own (made its own, or any answer by either reviewer). */
export const assessedAt = (s, paperId, toolId, level) => { const r = recordOf(s, paperId, toolId, level); return Boolean(r?.own) || has(r?.a) || has(r?.b); };

/**
 * The judgements that apply to a study for an outcome: the outcome's own
 * assessment when it has one, else the study-level one. `level` 'study'
 * gives the study level.
 */
export function effectiveAnswers(s, paperId, toolId, level = STUDY) {
  if (level !== STUDY && assessedAt(s, paperId, toolId, level)) return { level, answers: finalAnswers(s, paperId, toolId, level) };
  return { level: STUDY, answers: finalAnswers(s, paperId, toolId, STUDY) };
}

/**
 * The domains the reviewers judged differently at a level:
 * [{ domain, a, b, resolved: { value, reason } | null, state: 'open' | 'resolved' }],
 * and the ones only one reviewer has judged (state 'waiting').
 */
export function discrepancies(s, paperId, tool, level = STUDY) {
  const r = recordOf(s, paperId, tool.id, level) || {}, a = r.a || {}, b = r.b || {}, res = r.resolved || {};
  const out = [];
  for (const d of domainIds(tool)) {
    if (!a[d] && !b[d]) continue;
    if (a[d] && b[d] && a[d] === b[d]) continue;
    const resolved = res[d]?.value ? res[d] : null;
    out.push({ domain: d, a: a[d] || '', b: b[d] || '', resolved, state: a[d] && b[d] ? (resolved ? 'resolved' : 'open') : 'waiting' });
  }
  return out;
}

/**
 * Where a level's reconciliation stands: 'single' (one reviewer), 'empty',
 * 'waiting' (a domain judged by one reviewer only), 'open' (a discrepancy
 * without a resolved value), 'ready' (every domain final, not confirmed),
 * 'agreed' (consensus confirmed).
 */
export function consensusState(s, paperId, tool, level = STUDY) {
  if (!secondOn(s)) return { state: 'single', open: 0 };
  const r = recordOf(s, paperId, tool.id, level);
  if (!has(r?.a) && !has(r?.b)) return { state: 'empty', open: 0 };
  const list = discrepancies(s, paperId, tool, level);
  const open = list.filter(x => x.state === 'open').length, waiting = list.filter(x => x.state === 'waiting').length;
  const final = finalAnswers(s, paperId, tool.id, level);
  const complete = domainIds(tool).every(d => final[d]);
  if (open) return { state: 'open', open };
  if (waiting || !complete) return { state: 'waiting', open: 0, waiting };
  return { state: r.consensus ? 'agreed' : 'ready', open: 0, at: r.consensus?.at || null };
}

// ---- writing (reducers: they change the state passed in and return it) ----------

function ensure(st, paperId, toolId, level) {
  st.robReview = { second: false, records: {}, ...(st.robReview || {}) };
  const rec = st.robReview.records = { ...(st.robReview.records || {}) };
  rec[paperId] = { ...(rec[paperId] || {}) };
  rec[paperId][toolId] = { ...(rec[paperId][toolId] || {}) };
  return rec[paperId][toolId][level] = { a: {}, b: {}, resolved: {}, consensus: null, ...(rec[paperId][toolId][level] || {}) };
}
function tidy(st, paperId, toolId, level) {
  const t = st.robReview.records[paperId]?.[toolId];
  const r = t?.[level];
  if (r && !r.own && !has(r.a) && !has(r.b) && !has(r.resolved) && !r.context) delete t[level];
  if (t && !has(t)) delete st.robReview.records[paperId][toolId];
  if (st.robReview.records[paperId] && !has(st.robReview.records[paperId])) delete st.robReview.records[paperId];
}

/**
 * Keeps `assessments[paperId][toolId]` equal to the final study-level
 * judgements, dropping the flat pre-instrument keys as the view always did.
 */
export function mirror(st, paperId, toolId, toolIds) {
  st.assessments = st.assessments || {};
  const rec = st.assessments[paperId] ? { ...st.assessments[paperId] } : {};
  for (const k of Object.keys(rec)) if (!isInstrument(k, toolIds)) delete rec[k];
  const final = finalAnswers(st, paperId, toolId, STUDY);
  if (has(final)) rec[toolId] = final; else delete rec[toolId];
  if (has(rec)) st.assessments[paperId] = rec; else delete st.assessments[paperId];
  return st;
}

/** One reviewer's judgement of one domain; '' clears it. Clears a confirmed consensus. */
export function setAnswer(st, { paperId, toolId, level = STUDY, who = 'a', domain, value, toolIds }) {
  const r = ensure(st, paperId, toolId, level), side = who === 'b' ? 'b' : 'a';
  r[side] = { ...r[side] };
  if (value) r[side][domain] = value; else delete r[side][domain];
  // a resolution stays only while it settles a difference that still exists
  const other = r[side === 'a' ? 'b' : 'a'][domain];
  if (r.resolved?.[domain] && (!value || !other || value === other)) { r.resolved = { ...r.resolved }; delete r.resolved[domain]; }
  r.consensus = null;
  tidy(st, paperId, toolId, level);
  if (level === STUDY) mirror(st, paperId, toolId, toolIds);
  return st;
}

/** The resolved value of a discrepant domain, with its reason (both required); '' removes it. */
export function resolveDomain(st, { paperId, toolId, level = STUDY, domain, value, reason = '', toolIds }) {
  const why = String(reason || '').trim();
  if (value && !why) return st;
  const r = ensure(st, paperId, toolId, level);
  r.resolved = { ...(r.resolved || {}) };
  if (value) r.resolved[domain] = { value, reason: why, at: new Date().toISOString() };
  else delete r.resolved[domain];
  r.consensus = null;
  tidy(st, paperId, toolId, level);
  if (level === STUDY) mirror(st, paperId, toolId, toolIds);
  return st;
}

/** Confirms (or withdraws) the consensus of a level; only a level whose state is 'ready' can be confirmed. */
/** A level's assessment context: `{ target, scope }`, the result assessed and the scope of the appraisal, as the decision log prints them. */
export const contextOf = (s, paperId, toolId, level = STUDY) => ({ target: '', scope: '', ...(recordOf(s, paperId, toolId, level)?.context || {}) });
/** Sets the context of a level; both blank removes it. */
export function setContext(st, { paperId, toolId, level = STUDY, target = '', scope = '' }) {
  const r = ensure(st, paperId, toolId, level);
  const t = String(target || '').trim(), sc = String(scope || '').trim();
  if (t || sc) r.context = { target: t, scope: sc }; else delete r.context;
  tidy(st, paperId, toolId, level);
  return st;
}

export function confirmConsensus(st, { paperId, tool, level = STUDY, on = true }) {
  if (on && consensusState(st, paperId, tool, level).state !== 'ready') return st;
  const r = ensure(st, paperId, tool.id, level);
  r.consensus = on ? { at: new Date().toISOString() } : null;
  return st;
}

/** Turns the second reviewer on or off; answers are kept, and the study-level mirror follows. */
export function setSecond(st, on, toolIds) {
  st.robReview = { records: {}, ...(st.robReview || {}), second: Boolean(on) };
  for (const [paperId, byTool] of Object.entries(st.robReview.records)) for (const toolId of Object.keys(byTool)) mirror(st, paperId, toolId, toolIds);
  return st;
}

/**
 * Gives an outcome its own assessment, starting from each reviewer's
 * study-level answers (a reviewer then changes what differs for it).
 */
export function startLevel(st, { paperId, toolId, level, toolIds }) {
  if (level === STUDY) return st;
  const start = { a: answersBy(st, paperId, toolId, STUDY, 'a'), b: answersBy(st, paperId, toolId, STUDY, 'b') };
  const r = ensure(st, paperId, toolId, level);
  r.a = { ...start.a, ...r.a }; r.b = { ...start.b, ...r.b }; r.own = true; r.consensus = null;
  return st;
}

/** Removes an outcome-level assessment, so the study level applies again. */
export function clearLevel(st, { paperId, toolId, level }) {
  if (level === STUDY || !st.robReview?.records?.[paperId]?.[toolId]?.[level]) return st;
  delete st.robReview.records[paperId][toolId][level];
  tidy(st, paperId, toolId, STUDY);
  return st;
}

// ---- migration -------------------------------------------------------------------

/**
 * Brings a project to this shape: every study-level judgement in
 * `assessments` becomes reviewer A's answers at study level. With one
 * reviewer, `assessments` is what a person last saw and wins over a stale
 * record (it may have been written by a build before this one); with two,
 * the records are the source and `assessments` is rebuilt from them.
 */
export function migrateAssessments(st, toolIds) {
  const review = st.robReview && typeof st.robReview === 'object' ? st.robReview : {};
  st.robReview = { second: Boolean(review.second), records: review.records && typeof review.records === 'object' ? review.records : {} };
  for (const [paperId, rec] of Object.entries(st.assessments || {})) {
    if (!rec || typeof rec !== 'object') continue;
    for (const toolId of toolIds) {
      const answers = legacyAnswers(rec, toolId, toolIds);
      if (!has(answers)) continue;
      const cur = st.robReview.records[paperId]?.[toolId]?.[STUDY];
      if (cur && (st.robReview.second || JSON.stringify(cur.a || {}) === JSON.stringify(answers))) continue;
      const r = ensure(st, paperId, toolId, STUDY);
      r.a = answers;
    }
  }
  // with two reviewers the records rebuild the mirror; with one, a record the mirror lacks is shown there again
  for (const [paperId, byTool] of Object.entries(st.robReview.records)) for (const toolId of Object.keys(byTool || {})) {
    if (!toolIds.includes(toolId)) continue;
    if (st.robReview.second || !has(legacyAnswers(st.assessments?.[paperId], toolId, toolIds))) mirror(st, paperId, toolId, toolIds);
  }
  return st;
}

// ---- agreement ---------------------------------------------------------------------

/**
 * Cohen's kappa (unweighted) for one domain across studies at one level,
 * from the pairs where both reviewers answered: po the observed agreement,
 * pe the agreement expected from each reviewer's marginal proportions,
 * κ = (po − pe) / (1 − pe). Null with fewer than two pairs; κ is undefined
 * (null) when pe is 1.
 */
export function kappa(pairs) {
  const n = pairs.length;
  if (n < 2) return { n, kappa: null, po: null, pe: null };
  const cats = [...new Set(pairs.flat())];
  const po = pairs.filter(([x, y]) => x === y).length / n;
  const pe = cats.reduce((t, c) => t + (pairs.filter(p => p[0] === c).length / n) * (pairs.filter(p => p[1] === c).length / n), 0);
  return { n, po, pe, kappa: pe === 1 ? null : (po - pe) / (1 - pe) };
}

/** The reviewers' paired answers for a domain across studies at a level. */
export function pairsFor(s, paperIds, toolId, level, domain) {
  const out = [];
  for (const id of paperIds) {
    const r = recordOf(s, id, toolId, level);
    const x = r?.a?.[domain], y = r?.b?.[domain];
    if (x && y) out.push([x, y]);
  }
  return out;
}
