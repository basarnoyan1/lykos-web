// GRADE rows from a file kept beside the app (Batch 13 item 5; plan §4.15e): a `grade.json` of the shape a review's scripts write, one
// `outcomes[]` entry per outcome with its design, the five domains' judgements, the counts, the effects, the certainty and the
// explanations, read into the Certainty page's rows (each explanation on the row's `explanations`, the design's words as `designText`, the summary as `summary`). Pure: nothing here reads a file or the store; the page hands in the parsed
// document and writes what comes back. A judgement word the table does not know is kept in the comment, never guessed.
import { blankOutcome, certainty, isRated, DOWNGRADE, DOWNGRADE_RATINGS, UPGRADE_RATINGS } from './grade.mjs';

const str = v => (v == null ? '' : String(v)).trim();
const isObj = v => v != null && typeof v === 'object' && !Array.isArray(v);
const fold = v => str(v).toLowerCase().replace(/[\s_-]+/g, ' ');

/** The file's domain keys, in the order the rows read them; several spellings for each. */
const DOMAIN_KEYS = { rob: ['risk_of_bias', 'risk of bias', 'rob'], inconsistency: ['inconsistency'], indirectness: ['indirectness'], imprecision: ['imprecision'], publication: ['publication_bias', 'publication bias', 'other', 'other considerations'] };
const UPGRADE_KEYS = ['upgrading', 'upgrade', 'large_effect', 'large effect'];

/** The rating value of a judgement word, or null when the word is not one the table knows. */
export function ratingOf(word) {
  const w = fold(word);
  if (!w) return null;
  if (/^(not serious|none|no|undetected|not detected|not suspected|no serious|unlikely)\b/.test(w)) return 'none';
  if (/^very serious|^extremely serious/.test(w)) return 'veryserious';
  if (/^serious|^suspected|^strongly suspected|^likely|^detected/.test(w)) return 'serious';
  return null;
}
/** The upgrade value of a file's upgrading field: '+1' or '+2' or a word, else 'none'; null when it is not one the table knows. */
export function upgradeOf(word) {
  const w = fold(word);
  if (!w || /^(not applied|none|no|not applicable|n\/a)\b/.test(w)) return 'none';
  if (/\+?\s*2\b|two|very large/.test(w)) return 'two';
  if (/\+?\s*1\b|one|large/.test(w)) return 'one';
  return null;
}
/** "8 (902 patients)" or "8 (902)" → { studies: '8', participants: '902' }; a bare number is the studies. */
export function countsOf(text) {
  const t = str(text);
  const m = /^(\d[\d,]*)\s*(?:\((\d[\d,]*)[^)]*\))?/.exec(t);
  return m ? { studies: m[1].replace(/,/g, ''), participants: (m[2] || '').replace(/,/g, '') } : { studies: '', participants: '' };
}
const designOf = text => (/random/i.test(str(text)) && !/non[\s-]?random/i.test(str(text)) ? 'rct' : 'observational');
const first = (o, keys) => { for (const k of keys) { const v = o[k]; if (v != null && str(v)) return v; } return ''; };

/**
 * The outcomes of a parsed grade file as rows the Certainty page keeps (`lib/grade.mjs blankOutcome` shape), with what could not be
 * read: `{ rows, skipped: [{ name, why }], comparison }`. The file's stated certainty becomes an override, with the reason, when it
 * differs from what the ratings give; the explanations become the row's comment, one line per domain.
 */
export function outcomesFromGrade(doc, { ids = () => blankOutcome().id } = {}) {
  const list = Array.isArray(doc?.outcomes) ? doc.outcomes : Array.isArray(doc) ? doc : [];
  const rows = [], skipped = [];
  for (const o of list) {
    if (!isObj(o)) { skipped.push({ name: '', why: 'not an outcome' }); continue; }
    const name = str(first(o, ['outcome_label', 'outcome', 'name', 'label']));
    if (!name) { skipped.push({ name: '', why: 'no outcome name' }); continue; }
    const row = { ...blankOutcome(name), id: ids() };
    row.design = designOf(first(o, ['design', 'study_design']));
    const unknown = [];
    for (const d of DOWNGRADE) {
      const word = str(first(o, DOMAIN_KEYS[d.id]));
      const r = ratingOf(word);
      if (r) row.ratings[d.id] = r; else if (word) unknown.push(`${d.label}: ${word}`);
    }
    const up = str(first(o, UPGRADE_KEYS));
    const u = upgradeOf(up);
    if (u && u !== 'none') row.ratings.large = u; else if (up && !u) unknown.push(`Upgrading: ${up}`);
    const counts = countsOf(first(o, ['studies_patients', 'studies']));
    row.studies = counts.studies; row.participants = counts.participants || str(o.participants || o.patients || '');
    row.effect = str(first(o, ['relative', 'effect', 'relative_effect']));
    row.absolute = str(first(o, ['absolute', 'absolute_effect']));
    // each explanation on the row's own field (the GRADE table reads them there; lib/sof.mjs falls back to the comment for older rows)
    const explanations = {}, unplaced = [];
    for (const [k, v] of Object.entries(isObj(o.explanations) ? o.explanations : {})) {
      if (!str(v)) continue;
      const id = DOWNGRADE.find(d => DOMAIN_KEYS[d.id].includes(fold(k)))?.id || (UPGRADE_KEYS.includes(fold(k)) ? 'upgrading' : '');
      if (id) explanations[id] = str(v); else unplaced.push(`${fold(k).replace(/^\w/, c => c.toUpperCase())}: ${str(v)}`);
    }
    if (Object.keys(explanations).length) row.explanations = explanations;
    const designText = str(first(o, ['design', 'study_design']));
    if (designText) row.designText = designText;
    if (str(o.summary)) row.summary = str(o.summary);
    row.comment = [...unplaced, ...unknown.map(x => `Not read: ${x}`)].filter(Boolean).join('\n');
    const stated = str(o.certainty);
    if (stated) {
      const level = ['High', 'Moderate', 'Low', 'Very low'].find(l => fold(l) === fold(stated).replace(/^⊕+○*\s*/, '')) || '';
      if (level && (!isRated(row) || certainty(row).level !== level)) { row.override = level; row.overrideReason = 'Stated in the imported file'; }
      else if (!level) row.comment = [row.comment, `Not read: Certainty: ${stated}`].filter(Boolean).join('\n');
    }
    rows.push(row);
  }
  return { rows, skipped, comparison: str(doc?.comparison) };
}

/**
 * Adds the file's outcomes to the project: a row whose name matches an existing row (case and spacing aside) replaces that row's
 * ratings, counts, effects, comment and override and keeps its id and analysis link; the rest are appended. Returns the state and
 * `{ added, replaced }`.
 */
export function importGrade(st, doc, opts) {
  const { rows } = outcomesFromGrade(doc, opts);
  const grade = [...(st.grade || [])];
  let added = 0, replaced = 0;
  for (const row of rows) {
    const i = grade.findIndex(g => fold(g?.name) === fold(row.name));
    if (i >= 0) { grade[i] = { ...grade[i], ...row, id: grade[i].id, analysisOutcome: grade[i].analysisOutcome || '' }; replaced++; }
    else { grade.push(row); added++; }
  }
  st.grade = grade;
  return { state: st, added, replaced };
}
