// Rules for one extracted patient row, checked by the app before any model
// sees the row again (lib/extract-batch.mjs).
//
// A patient-level review is wrong in the same few ways whoever read the
// report: an extent of resection that the postoperative imaging contradicts, a
// follow-up that runs on after the patient died, no follow-up at all, an
// extent of resection with no MRI behind it. Each rule here is a mechanical
// statement over the cells of one row; none of them changes a value. A rule
// that fires puts the row (or the cell) in front of a stronger model or a
// person, with the rule's own sentence, and that is all it does.
//
// Rows are plain objects of cells keyed by patient column id (lib/ipd.mjs):
// `eor`, `time` (follow-up, months), `event`, `outcome` (the status as the
// report words it), `adjuvant`, and the two columns this module adds for the
// checks, `imaging` (what the postoperative imaging showed, as worded) and
// `death` (months from surgery to death, when the report gives it).

export const PATIENT_EXTRA_COLUMNS = [
  { id: 'imaging', name: 'Postoperative imaging', type: 'text' },
  { id: 'death', name: 'Months to death', type: 'number' },
];

/** The project's patient columns plus the ones the rules read, without replacing any the project has. */
export function withPatientColumns(columns = []) {
  const have = new Set(columns.map(c => c.id));
  return [...columns, ...PATIENT_EXTRA_COLUMNS.filter(c => !have.has(c.id))];
}

const blank = v => v == null || /^(|nr|na|n\/a|-|–|not reported|not stated|unknown)$/i.test(String(v).trim());
const fold = s => String(s ?? '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase();
const number = v => {
  if (blank(v)) return null;
  const m = /^\s*([+-]?\d+(?:[.,]\d+)?)\s*(?:months?|mos?\.?|m)?\s*$/i.exec(String(v));
  return m ? Number(m[1].replace(',', '.')) : null;
};
const TO_MONTHS = { week: 12 / 52, month: 1, mo: 1, year: 12, yr: 12 };
const unitOf = u => TO_MONTHS[String(u).toLowerCase().replace(/s$/, '')] ?? 1;

/** Months to death: the `death` cell, else the interval the status text gives ("died 14 months after surgery"). */
export function deathMonths(row) {
  const d = number(row.death);
  if (d != null) return d;
  const t = fold(row.outcome);
  const m = /(?:died|death|dead|deceased|expired|succumbed)[^.;]{0,60}?(\d+(?:[.,]\d+)?)\s*(weeks?|months?|mo|years?|yrs?)\b/.exec(t)
    || /(\d+(?:[.,]\d+)?)\s*(weeks?|months?|mo|years?|yrs?)\b[^.;]{0,40}?(?:died|death|dead|deceased)/.exec(t);
  return m ? Number(m[1].replace(',', '.')) * unitOf(m[2]) : null;
}

const NEGATED_SOURCE = '\\b(?:no|without|absence of|free of|negative for)\\b[^.;,]{0,30}?(?:residual|remnant|remaining|enhanc\\w*|tumou?r|disease|lesion)(?:\\s+(?:enhanc\\w*|tumou?r|disease|lesion|tissue|nodule|mass|lesion))*';
/** What the imaging text says about the resection: 'complete', 'residual', 'both' (it says each) or '' (neither). */
export function imagingSays(text) {
  const t = fold(text);
  if (blank(t)) return '';
  const complete = new RegExp(NEGATED_SOURCE).test(t) || /\b(?:complete|gross[- ]total|total)\s+(?:resection|removal)|\bgtr\b/.test(t);
  const residual = /residual|remnant|remaining (?:tumou?r|lesion|disease)|enhanc|persistent|incomplete|subtotal|partial|debulk/.test(t.replace(new RegExp(NEGATED_SOURCE, 'g'), ' '));
  return complete && residual ? 'both' : complete ? 'complete' : residual ? 'residual' : '';
}

/**
 * The rules, in the order a reviewer reads them. `check(row)` returns the
 * sentence to show, or null. `columns` are the cells the sentence is about, so
 * the report can mark them.
 */
export const PATIENT_RULES = [
  { id: 'p:no-followup', label: 'No follow-up', columns: ['time'],
    explain: 'A patient needs a follow-up time above zero to count in a survival analysis.',
    check: row => { const t = number(row.time); return t == null || t <= 0 ? (blank(row.time) ? 'No follow-up time recorded' : `Follow-up "${row.time}" is not a time above zero`) : null; } },
  { id: 'p:followup-after-death', label: 'Follow-up after death', columns: ['time', 'death'],
    explain: 'Follow-up cannot run past the month of death.',
    check: row => { const t = number(row.time), d = deathMonths(row); return t != null && d != null && t > d + 0.5 ? `Follow-up of ${t} months runs past death at ${Math.round(d * 10) / 10} months` : null; } },
  { id: 'p:eor-imaging', label: 'Extent of resection against imaging', columns: ['eor', 'imaging'],
    explain: 'A gross total resection cannot have residual tumour on imaging; a subtotal or partial one cannot be called complete.',
    check: row => {
      const eor = String(row.eor ?? '').trim().toUpperCase(), says = imagingSays(row.imaging);
      if (!eor || !says) return null;
      if (says === 'both') return `Imaging is worded both as complete and as residual for extent of resection ${eor}`;
      if (eor === 'GTR' && says === 'residual') return 'Extent of resection GTR, but the imaging reports residual tumour';
      if (['STR', 'PR', 'BX'].includes(eor) && says === 'complete') return `Extent of resection ${row.eor}, but the imaging reports no residual tumour`;
      return null;
    } },
  { id: 'p:no-mri', label: 'No MRI behind the extent of resection', columns: ['eor', 'imaging'],
    explain: 'An extent of resection is stated; the postoperative imaging is missing or is not an MRI.',
    check: row => {
      const eor = String(row.eor ?? '').trim();
      if (!eor) return null;
      if (blank(row.imaging) || /^(none|not (done|performed|available))$/i.test(String(row.imaging).trim())) return `Extent of resection ${eor} with no postoperative imaging recorded`;
      const t = fold(row.imaging);
      if (!/\bmri\b|magnetic|\bmr\b|gadolinium|\bt1\b|\bflair\b/.test(t)) return /\bct\b|computed tomograph/.test(t) ? `Extent of resection ${eor} judged on CT, not MRI` : `Extent of resection ${eor} without a postoperative MRI`;
      return null;
    } },
];

/**
 * The conventions: what the extraction prompt is told about how this review reads a report. They are rules for the model, not checks
 * over a row, so each has the sentence the prompt uses (the project may reword it) and an On/Off like a check. Switched off, the
 * sentence is left out of the prompt. The defaults are neutral statements of a common convention; a review words its own.
 */
export const PATIENT_CONVENTIONS = [
  { id: 'c:first-eor', label: 'First resection only', columns: ['eor'],
    explain: 'Which operation the extent of resection belongs to.',
    text: 'Give the extent of resection of the first operation only. Later operations are not separate rows.' },
  { id: 'c:followup-unit', label: 'Follow-up unit', columns: ['time', 'death'],
    explain: 'The unit and the starting point of every time.',
    text: 'Give every time in months from the first operation. Convert weeks and years; do not round a stated value.' },
  { id: 'c:recurrence-words', label: 'Recurrence wording', columns: ['event', 'outcome'],
    explain: 'The words that count as an event.',
    text: 'Progression, recurrence, regrowth, relapse and tumour-attributed death count as an event. Write the outcome in the report\'s own words.' },
];
const RULE_IDS = () => [...PATIENT_RULES, ...PATIENT_CONVENTIONS].map(r => r.id);

/**
 * The project's setting of the rules (`state.patientRules`): `off` lists rule and convention ids that are not applied, `messages` holds a
 * sentence a person wrote in place of a rule's own, `conventions` the text a person wrote for a convention. A rule absent from all
 * is on and says what it says here.
 */
export function patientRulesOf(state) {
  const c = state?.patientRules || {}, ids = RULE_IDS(), clean = o => Object.fromEntries(Object.entries(o && typeof o === 'object' ? o : {}).filter(([id, text]) => ids.includes(id) && String(text ?? '').trim()).map(([id, text]) => [id, String(text).trim()]));
  return { off: Array.isArray(c.off) ? c.off.filter(id => ids.includes(id)) : [], messages: clean(c.messages), conventions: clean(c.conventions) };
}

/** One row against the rules: [{ rule, id, message, columns }]. A rule may be switched off by id; `messages` puts a person's sentence before what was found. */
export function checkPatient(row, { off = [], messages = {} } = {}) {
  const out = [];
  for (const r of PATIENT_RULES) {
    if (off.includes(r.id)) continue;
    const found = r.check(row || {});
    if (found) out.push({ id: r.id, rule: r.label, message: messages[r.id] ? `${messages[r.id]}: ${found}` : found, columns: r.columns });
  }
  return out;
}

/** The conventions the project applies, with the sentence each puts in the prompt: [{ id, label, text, on, custom }]. */
export function conventionRows(state = null) {
  const set = patientRulesOf(state);
  return PATIENT_CONVENTIONS.map(c => ({ id: c.id, label: c.label, statement: c.explain, columns: c.columns, on: !set.off.includes(c.id), text: set.conventions[c.id] || c.text, custom: !!set.conventions[c.id] }));
}

/** The block of the extraction prompt that carries the project's conventions ('' when every one is off). */
export function conventionsPrompt(state = null) {
  const on = conventionRows(state).filter(c => c.on);
  return on.length ? `Conventions of this review (apply them when you fill a cell):\n${on.map(c => `- ${c.text}`).join('\n')}` : '';
}

/** The rule list as text, for a person or another model to review the sheet against. */
export const patientRuleList = (state = null) => {
  const set = patientRulesOf(state);
  return PATIENT_RULES.map(r => ({ id: r.id, label: r.label, statement: r.explain, columns: r.columns.join(', '), on: !set.off.includes(r.id), message: set.messages[r.id] || '' }));
};
