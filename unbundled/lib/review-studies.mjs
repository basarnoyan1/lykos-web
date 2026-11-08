// A review's studies, not its records, and what a person checked of them (lib/review-state.mjs says why): light, with no imports, so
// Getting started's count in the sidebar (lib/guide-steps.mjs) and Needs attention (lib/progress.mjs) read them at start-up. Pure.

// ---- once per version of the open project ----------------------------------------------------------------------------------------
// perVersion(fn, keyOf?): fn(s, ...rest) answered from the last call while s is the store's live project at the same version (app.mjs calls
// followStore once; a tool or test never does, and computes). Never inside an update. keyOf names the other arguments (null: not kept).
// Callers must not change what they get. 1 Nov 2026: the studies and steps cost the Overview 120-390 ms a visit at 30,210 records.
let live = null;

export function followStore(store) { live = store && typeof store.get === 'function' && typeof store.version === 'function' ? store : null; }

/** The version to key a cache on when `s` is the live project; undefined inside an update (keep nothing); null for any other object. */
export function liveVersion(s) {
  if (!live || !s || typeof s !== 'object' || s !== live.get()) return null;
  return live.updating?.() ? undefined : live.version();
}

// a protocol scenario's view of the live project (lib/scenarios.mjs), with the version it was made at: kept the same way, one answer per view
const views = new WeakMap();
export const keepView = (view, v) => { views.set(view, v); };
/** Whether `s` is a scenario's view kept at the live project's current version. */
export const keptNow = s => Boolean(live && s && typeof s === 'object' && views.has(s) && !live.updating?.() && views.get(s) === live.version());
// `keep`: answers (by key) one version holds, for a function asked with a few keys in turn (each stage's queue).
export function perVersion(fn, keyOf = null, { keep = 1 } = {}) {
  let at = null, hits = new Map();
  const byView = new WeakMap();
  const held = (h, key, compute) => {
    if (h.has(key)) return h.get(key);
    const out = compute();
    if (h.size >= keep) h.delete(h.keys().next().value);
    h.set(key, out); return out;
  };
  return (s, ...rest) => {
    if (live && s && typeof s === 'object' && views.has(s) && !live.updating?.() && views.get(s) === live.version()) {
      const key = rest.length || keyOf ? (keyOf ? keyOf(...rest) : null) : '';
      if (key == null) return fn(s, ...rest);
      let h = byView.get(s);
      if (!h) byView.set(s, h = new Map());
      return held(h, key, () => fn(s, ...rest));
    }
    if (!live || !s || typeof s !== 'object' || s !== live.get() || live.updating?.()) return fn(s, ...rest);
    const key = rest.length || keyOf ? (keyOf ? keyOf(...rest) : null) : '';
    if (key == null) return fn(s, ...rest);
    const v = live.version();
    if (!at || at.s !== s || at.v !== v) { at = { s, v }; hits = new Map(); }
    return held(hits, key, () => fn(s, ...rest));
  };
}


/** An uncertain decision that is an end of its own: PRISMA 2020's "studies awaiting classification" (a language, a missing report). */
export const AWAITING = /awaiting classification/i;
const awaiting = d => d?.decision === 'uncertain' && AWAITING.test(`${d.note || ''} ${d.reason || ''}`);
const hasPdf = p => Boolean(p.pdf || p.pdfRel);

/**
 * The review's studies: { ftStage, records, studies, reports, provisional, waiting, ftUncertain, awaiting, taOpen }, each a list of records.
 * `records` are the included records; `studies` one per trial (its main report, or its first included report while the main one is not
 * included, as PRISMA counts new studies: lib/prisma-counts.mjs); `reports` the further reports of those trials; `provisional` the studies
 * without a full text (decided on the abstract); `waiting` title/abstract includes with no full-text decision; `ftUncertain` uncertain at
 * full text; `awaiting` uncertain at either stage and awaiting classification; `taOpen` not screened, or uncertain, at title and abstract.
 */
export const reviewStudies = perVersion(studiesOf);
function studiesOf(s) {
  const papers = s.papers || [], ta = s.screening || {}, ft = s.fulltext || {};
  const ftStage = papers.some(p => ft[p.id]?.decision);
  const isIn = p => (ftStage ? ft[p.id]?.decision === 'include' : (ft[p.id] || ta[p.id])?.decision === 'include');
  const records = papers.filter(isIn), inc = new Set(records.map(p => p.id)), trials = new Map();
  for (const p of records) {
    const key = p.reportOf || p.id, was = trials.get(key);
    if (!was || (p.id === key && was.id !== key)) trials.set(key, p);
  }
  const studies = records.filter(p => trials.get(p.reportOf || p.id) === p), lead = new Set(studies.map(p => p.id));
  const finalOf = p => (ft[p.id]?.decision ? ft[p.id] : ta[p.id]);
  const waitAt = p => awaiting(ft[p.id]?.decision ? ft[p.id] : ta[p.id]) || awaiting(ta[p.id]) && !ft[p.id]?.decision;
  return {
    ftStage, records, studies, reports: records.filter(p => !lead.has(p.id)), provisional: studies.filter(p => !hasPdf(p)),
    waiting: ftStage ? papers.filter(p => ta[p.id]?.decision === 'include' && !ft[p.id]?.decision) : [],
    ftUncertain: papers.filter(p => ft[p.id]?.decision === 'uncertain' && !awaiting(ft[p.id])),
    awaiting: papers.filter(p => !inc.has(p.id) && finalOf(p)?.decision === 'uncertain' && waitAt(p)),
    taOpen: papers.filter(p => !ta[p.id]?.decision || (ta[p.id].decision === 'uncertain' && !awaiting(ta[p.id]) && !ft[p.id]?.decision)),
  };
}

// ---- checks by a person ----------------------------------------------------------------------------------------------------------

/** Whether a review entry was recorded by a person: marked `person: true` (lykos review mark --person, run by the person). A model never is. */
export const byPerson = e => Boolean(e && e.person === true && String(e.by || '').trim());
const MODEL = /\b(claude|codex|gpt|chatgpt|openai|deepseek|gemini|llama|mistral|qwen|sonnet|opus|haiku|model|agent)\b/i;

/**
 * What a person has checked of the review's data: { items, checked, data: { n, checked }, rob: { n, checked }, persons, models }. The items
 * are each study with values (its ledger item `study:<id>`) and each appraised study (`rob:<id>`); one counts when a person's entry for it
 * holds without issues. `models` names the model reviewers whose checks are recorded (sweeps, value checks, the ledger): never counted.
 */
export function personChecks(s, studies, { appraised = null } = {}) {
  const items = s.reviewLedger?.items || {}, withValues = new Set();
  for (const k of Object.keys(s.values || {})) { const i = k.indexOf(':'); if (i > 0) withValues.add(k.slice(0, i)); }
  const ok = id => byPerson(items[id]) && items[id].verdict !== 'issue';
  const data = studies.filter(p => withValues.has(p.id)), rob = appraised || studies.filter(p => s.assessments?.[p.id] || s.robReview?.records?.[p.id]);
  const persons = new Set(Object.values(items).filter(byPerson).map(e => String(e.by).trim()));
  const models = new Set();
  for (const e of Object.values(items)) if (!byPerson(e) && e?.by) models.add(String(e.by).trim());
  for (const st of Object.values(s.robSweeps?.studies || {})) for (const tool of Object.values(st || {})) for (const sw of Object.values(tool || {})) if (sw?.by) models.add(String(sw.by).replace(/\s*\(.*\)$/, ''));
  for (const v of Object.values(s.valueChecks?.studies || {})) if (v?.by) models.add(String(v.by).replace(/\s*\(.*\)$/, ''));
  const dataChecked = data.filter(p => ok(`study:${p.id}`)).length, robChecked = rob.filter(p => ok(`rob:${p.id}`)).length;
  return { items: data.length + rob.length, checked: dataChecked + robChecked, data: { n: data.length, checked: dataChecked }, rob: { n: rob.length, checked: robChecked },
    persons: [...persons], models: [...models].filter(m => MODEL.test(m) || !persons.has(m)).sort() };
}
