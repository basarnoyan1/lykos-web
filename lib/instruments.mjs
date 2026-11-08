// Outcome instruments: the rating scales and counts a trial measures its outcome with (data-model plan S3; plan G3a). Not the appraisal
// instruments of §H (lib/custom-instrument.mjs): these name what a value measures, so rows can be pooled by scale and mapped.
//
// An instrument is { code, label, name, aliases, domain, min, max, higher, rater, indications }: `higher` is 'worse' or 'better' (which
// way a higher score points), `rater` 'clinician', 'patient' or 'observer', `indications` the indication codes it usually serves
// (INDICATIONS). A range or direction is stated only where the scale defines it; an empty field is unknown, not zero. The built-in list
// is fixed here; a project adds its own or extends a built-in one (more aliases, a missing range) in s.instruments. The registry is
// also a vocabulary (id 'instruments', resolved by lib/vocabularies.mjs vocabularyById) so an outcome-name column can be a category
// field whose values are instrument codes, read through the ordinary retype proposals. Pure: no store.
const str = v => String(v ?? '').trim();
const fold = t => str(t).normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').toLowerCase();
export const INSTRUMENTS_VOCAB = 'instruments';

/** Indications the registry names, with the labels and aliases a project's own indication terms are matched by. */
export const INDICATIONS = Object.freeze([
  { code: 'parkinsons', label: "Parkinson's disease", aliases: ['Parkinson disease', 'Parkinson', 'PD'] },
  { code: 'depression', label: 'Depression', aliases: ['Major depressive disorder', 'MDD', 'Treatment-resistant depression', 'TRD'] },
  { code: 'ocd', label: 'Obsessive-compulsive disorder', aliases: ['OCD'] },
  { code: 'tourette', label: 'Tourette syndrome', aliases: ['Tourette', "Tourette's syndrome", 'TS'] },
  { code: 'dystonia', label: 'Dystonia', aliases: ['Generalized dystonia', 'Generalised dystonia'] },
  { code: 'cervical_dystonia', label: 'Cervical dystonia', aliases: ['Spasmodic torticollis'] },
  { code: 'essential_tremor', label: 'Essential tremor', aliases: ['ET'] },
  { code: 'alzheimers', label: "Alzheimer's disease", aliases: ['Alzheimer disease', 'Alzheimer', 'AD'] },
  { code: 'doc', label: 'Disorders of consciousness', aliases: ['DOC', 'Minimally conscious state', 'MCS', 'Vegetative state', 'Unresponsive wakefulness syndrome'] },
  { code: 'tbi', label: 'Traumatic brain injury', aliases: ['TBI'] },
  { code: 'schizophrenia', label: 'Schizophrenia', aliases: [] },
  { code: 'pain', label: 'Chronic pain', aliases: ['Pain'] },
  { code: 'neuropathic_pain', label: 'Neuropathic pain', aliases: [] },
  { code: 'trigeminal_neuralgia', label: 'Trigeminal neuralgia', aliases: ['TN'] },
  { code: 'epilepsy', label: 'Epilepsy', aliases: ['Drug-resistant epilepsy', 'Refractory epilepsy', 'DRE'] },
]);

const I = (code, label, name, aliases, domain, min, max, higher, rater, indications) => Object.freeze({ code, label, name, aliases, domain, min, max, higher, rater, indications });
const PAIN = ['pain', 'neuropathic_pain'];
/** The built-in instruments. Ranges and directions are the published totals of the version named; null where a version varies or is not sure. */
export const BUILT_IN_INSTRUMENTS = Object.freeze([
  I('UPDRS-III', 'UPDRS-III', "Unified Parkinson's Disease Rating Scale, part III (motor examination)", ['UPDRS III', 'UPDRS-III motor', 'UPDRS motor', 'UPDRS part III', 'UPDRS-III total', 'UPDRS motor score'], 'motor', 0, 108, 'worse', 'clinician', ['parkinsons']),
  I('MDS-UPDRS-III', 'MDS-UPDRS-III', 'MDS revision of the UPDRS, part III (motor examination)', ['MDS-UPDRS III', 'MDS-UPDRS part III', 'MDS-UPDRS-III total', 'MDS-UPDRS motor'], 'motor', 0, 132, 'worse', 'clinician', ['parkinsons']),
  I('HAM-D17', 'HAM-D17', 'Hamilton Depression Rating Scale, 17 items', ['HAMD-17', 'HAMD17', 'HAM-D-17', 'HDRS-17', 'HDRS17', 'HRSD-17', 'HAMD-17 total', 'HAM-D17 total', 'HDRS-17 total'], 'mood', 0, 52, 'worse', 'clinician', ['depression']),
  I('HAM-D24', 'HAM-D24', 'Hamilton Depression Rating Scale, 24 items', ['HAMD-24', 'HAMD24', 'HAM-D-24', 'HDRS-24', 'HRSD-24', 'HAMD-24 total', 'HDRS-24 total'], 'mood', null, null, 'worse', 'clinician', ['depression']),
  I('MADRS', 'MADRS', 'Montgomery–Åsberg Depression Rating Scale', ['MADRS total', 'Montgomery-Asberg Depression Rating Scale'], 'mood', 0, 60, 'worse', 'clinician', ['depression']),
  I('Y-BOCS', 'Y-BOCS', 'Yale–Brown Obsessive Compulsive Scale', ['YBOCS', 'Y-BOCS total', 'YBOCS total', 'Yale-Brown Obsessive Compulsive Scale'], 'obsessive-compulsive', 0, 40, 'worse', 'clinician', ['ocd']),
  I('YGTSS', 'YGTSS', 'Yale Global Tic Severity Scale, global score (total tic score plus impairment)', ['YGTSS global', 'YGTSS global score'], 'tics', 0, 100, 'worse', 'clinician', ['tourette']),
  I('YGTSS-TTS', 'YGTSS-TTS', 'Yale Global Tic Severity Scale, total tic score (motor plus phonic)', ['YGTSS total tic score', 'YGTSS TTS', 'YGTSS tic score'], 'tics', 0, 50, 'worse', 'clinician', ['tourette']),
  I('YGTSS-M', 'YGTSS-M', 'Yale Global Tic Severity Scale, motor tic score', ['YGTSS motor', 'YGTSS motor tic score', 'YGTSS motor tics'], 'tics', 0, 25, 'worse', 'clinician', ['tourette']),
  I('BFMDRS-M', 'BFMDRS-M', 'Burke–Fahn–Marsden Dystonia Rating Scale, movement scale', ['BFMDRS movement', 'BFMDRS motor', 'BFMDRS-M total', 'BFMDRS movement score', 'BFM movement'], 'motor', 0, 120, 'worse', 'clinician', ['dystonia']),
  I('TWSTRS', 'TWSTRS', 'Toronto Western Spasmodic Torticollis Rating Scale, total (original version)', ['TWSTRS total'], 'motor', 0, 85, 'worse', 'clinician', ['cervical_dystonia']),
  I('CRST', 'CRST', 'Fahn–Tolosa–Marín Clinical Rating Scale for Tremor', ['FTM', 'FTM-TRS', 'CRST total', 'Fahn-Tolosa-Marin', 'Fahn-Tolosa-Marin tremor rating scale'], 'motor', null, null, 'worse', '', ['essential_tremor']),
  I('QUEST', 'QUEST', 'Quality of Life in Essential Tremor Questionnaire', ['QUEST total'], 'quality of life', null, null, 'worse', 'patient', ['essential_tremor']),
  I('ADAS-Cog', 'ADAS-Cog', "Alzheimer's Disease Assessment Scale, cognitive subscale (11 items)", ['ADAS-Cog11', 'ADAS-Cog 11', 'ADAS-cog total'], 'cognition', 0, 70, 'worse', 'clinician', ['alzheimers']),
  I('CDR-SB', 'CDR-SB', 'Clinical Dementia Rating, sum of boxes', ['CDR-SOB', 'CDR sum of boxes', 'CDR-SB total'], 'cognition', 0, 18, 'worse', 'clinician', ['alzheimers']),
  I('CRS-R', 'CRS-R', 'Coma Recovery Scale–Revised', ['CRS-R total', 'Coma Recovery Scale Revised'], 'consciousness', 0, 23, 'better', 'clinician', ['doc']),
  I('GOS-E', 'GOS-E', 'Extended Glasgow Outcome Scale', ['GOSE', 'GOS-E score', 'Glasgow Outcome Scale-Extended', 'Glasgow Outcome Scale Extended'], 'global outcome', 1, 8, 'better', 'clinician', ['tbi']),
  I('PANSS', 'PANSS', 'Positive and Negative Syndrome Scale', ['PANSS total'], 'psychosis', 30, 210, 'worse', 'clinician', ['schizophrenia']),
  I('NPRS', 'NPRS 0–10', 'Numeric pain rating scale, 0 to 10', ['NPRS 0-10', 'NPRS', 'Numeric pain rating scale', 'Pain NRS', 'Pain NRS 0-10'], 'pain', 0, 10, 'worse', 'patient', PAIN),
  I('VAS-pain', 'VAS pain 0–100', 'Visual analogue scale for pain, 0 to 100 mm', ['VAS pain 0-100', 'VAS pain', 'Pain VAS'], 'pain', 0, 100, 'worse', 'patient', PAIN),
  I('NRS', 'NRS 0–10', 'Numeric rating scale, 0 to 10 (what is rated is named in the outcome)', ['NRS 0-10', 'NRS', 'Numeric rating scale'], '', 0, 10, null, 'patient', PAIN),
  I('BPI', 'BPI', 'Brief Pain Inventory (severity or interference score)', ['BPI severity', 'BPI interference', 'Brief Pain Inventory'], 'pain', 0, 10, 'worse', 'patient', PAIN),
  I('MPQ', 'MPQ', 'McGill Pain Questionnaire', ['McGill Pain Questionnaire', 'MPQ total', 'SF-MPQ', 'Short-form McGill Pain Questionnaire'], 'pain', null, null, 'worse', 'patient', PAIN),
  I('NPSI', 'NPSI', 'Neuropathic Pain Symptom Inventory, total', ['NPSI total', 'Neuropathic Pain Symptom Inventory'], 'pain', 0, 100, 'worse', 'patient', ['neuropathic_pain']),
  I('BNI-pain', 'BNI pain score', 'Barrow Neurological Institute pain intensity score (I to V)', ['BNI pain', 'BNI', 'BNI pain intensity score', 'Barrow Neurological Institute pain score'], 'pain', 1, 5, 'worse', '', ['trigeminal_neuralgia']),
  I('seizure-frequency', 'Seizure frequency', 'Seizure frequency (count per period)', ['Seizures per month', 'Monthly seizure frequency', 'Seizure count'], 'seizures', null, null, 'worse', 'patient', ['epilepsy']),
  I('responder-50', '≥50% responder rate', 'Share of patients with at least a 50% reduction', ['>=50% responder rate', '50% responder rate', '≥50% responders', '50% responders'], 'response', 0, 100, 'better', '', ['epilepsy']),
  // Added 6 Nov 2026 from the outcome texts of the sham-response review; each range and direction is the original publication's
  I('PDQ-39-SI', 'PDQ-39 SI', "Parkinson's Disease Questionnaire, 39 items, summary index (mean of the eight dimension scores; Jenkinson 1997)", ['PDQ-39 summary index', 'PDQ-39-SI', 'PDQ-39 SI', 'PDQ39-SI', 'PDQ-39 single index', 'PDQ-39 summary index score', 'PDQ-39 single index score'], 'quality of life', 0, 100, 'worse', 'patient', ['parkinsons']),
  I('UPDRS-II', 'UPDRS-II', "Unified Parkinson's Disease Rating Scale, part II (activities of daily living; Fahn and Elton 1987)", ['UPDRS II', 'UPDRS part II', 'UPDRS-II total', 'UPDRS ADL', 'UPDRS activities of daily living'], 'activities of daily living', 0, 52, 'worse', '', ['parkinsons']),
  I('MDS-UPDRS-II', 'MDS-UPDRS-II', 'MDS revision of the UPDRS, part II (motor aspects of experiences of daily living; Goetz 2008)', ['MDS-UPDRS II', 'MDS-UPDRS part II', 'MDS-UPDRS-II total'], 'activities of daily living', 0, 52, 'worse', 'patient', ['parkinsons']),
  I('MMSE', 'MMSE', 'Mini-Mental State Examination (Folstein 1975)', ['Mini-Mental State Examination', 'MMSE total', 'MMS', 'Mini-Mental State'], 'cognition', 0, 30, 'better', 'clinician', ['alzheimers']),
  I('BDI-II', 'BDI-II', 'Beck Depression Inventory, second edition (Beck 1996)', ['BDI II', 'BDI-II total', 'Beck Depression Inventory-II', 'Beck Depression Inventory II'], 'mood', 0, 63, 'worse', 'patient', ['depression']),
  I('QIDS-SR16', 'QIDS-SR16', 'Quick Inventory of Depressive Symptomatology, self-report, 16 items (Rush 2003)', ['QIDS-SR', 'QIDS-SR 16', 'QIDS-SR-16', 'QIDS-SR16 total', 'Quick Inventory of Depressive Symptomatology, self-report'], 'mood', 0, 27, 'worse', 'patient', ['depression']),
  I('NPI', 'NPI', 'Neuropsychiatric Inventory, 12 domains, total (frequency × severity summed; Cummings 1994, 12-domain version 1997)', ['NPI total', 'NPI-12', 'Neuropsychiatric Inventory'], 'behaviour', 0, 144, 'worse', 'observer', ['alzheimers']),
  I('ADCS-ADL23', 'ADCS-ADL23', "Alzheimer's Disease Cooperative Study Activities of Daily Living inventory, 23 items (Galasko 1997)", ['ADCS-ADL-23', 'ADCS-ADL 23', 'ADCS-ADL23 total'], 'activities of daily living', 0, 78, 'better', 'observer', ['alzheimers']),
  I('ADAS-Cog13', 'ADAS-Cog13', "Alzheimer's Disease Assessment Scale, cognitive subscale, 13 items (Mohs 1997)", ['ADAS-Cog 13', 'ADAS-Cog-13', 'ADAS-Cog13 total'], 'cognition', 0, 85, 'worse', 'clinician', ['alzheimers']),
  I('HAM-A', 'HAM-A', 'Hamilton Anxiety Rating Scale, 14 items (Hamilton 1959)', ['HAMA', 'HAM-A total', 'Hamilton Anxiety Scale', 'Hamilton Anxiety Rating Scale', 'HARS'], 'anxiety', 0, 56, 'worse', 'clinician', []),
  I('mRVRS', 'mRVRS', 'Modified Rush Video-Based Tic Rating Scale, total of five domains each 0 to 4 (Goetz 1999)', ['Modified Rush Video-Based Rating Scale', 'Modified Rush Video Rating Scale', 'Modified Rush Video-based Tic Rating Scale', 'MRVS', 'MRVRS'], 'tics', 0, 20, 'worse', 'clinician', ['tourette']),
  I('GAF', 'GAF', 'Global Assessment of Functioning (DSM-IV axis V)', ['Global Assessment of Functioning', 'GAF score'], 'global functioning', 1, 100, 'better', 'clinician', []),
  I('SARA', 'SARA', 'Scale for the Assessment and Rating of Ataxia (Schmitz-Hübsch 2006)', ['SARA total', 'Scale for the Assessment and Rating of Ataxia'], 'motor', 0, 40, 'worse', 'clinician', []),
  I('FOG-Q', 'FOG-Q', 'Freezing of Gait Questionnaire, 6 items (Giladi 2000)', ['FOGQ', 'FOG-Q total', 'Freezing of Gait Questionnaire'], 'gait', 0, 24, 'worse', 'patient', ['parkinsons']),
  I('POMA', 'Tinetti POMA', 'Tinetti Performance-Oriented Mobility Assessment, gait and balance total (Tinetti 1986)', ['Tinetti POMA', 'Tinetti Performance-Oriented Mobility Assessment', 'Tinetti gait and balance', 'POMA total'], 'gait', 0, 28, 'better', 'clinician', []),
  I('TUG', 'TUG (s)', 'Timed Up and Go test, time in seconds (Podsiadlo and Richardson 1991)', ['Timed Up and Go', 'Timed Up and Go test', 'TUG time'], 'gait', 0, null, 'worse', 'clinician', []),
  I('PD-diary-OFF', 'PD diary OFF time (h/day)', "Parkinson's disease home diary, OFF time in hours per day (Hauser 2000)", ['PD diary OFF time', 'Home diary OFF time', 'Diary OFF time'], 'motor fluctuations', 0, 24, 'worse', 'patient', ['parkinsons']),
  I('PD-diary-ON-noTD', 'PD diary ON time without troublesome dyskinesia (h/day)', "Parkinson's disease home diary, ON time without troublesome dyskinesia in hours per day (Hauser 2000)", ['Diary ON time without troublesome dyskinesia', 'Good ON time'], 'motor fluctuations', 0, 24, 'better', 'patient', ['parkinsons']),
]);

const list = x => (Array.isArray(x) ? x : []).map(str).filter(Boolean);
const bound = x => (x === null || x === undefined || x === '' || !Number.isFinite(Number(x)) ? null : Number(x));
/** An instrument as stored: trimmed strings, known keys only, numbers or null for the range. Does not validate (see instrumentProblems). */
export function normalizeInstrument(x = {}) {
  return { code: str(x.code), label: str(x.label).slice(0, 80), name: str(x.name).slice(0, 200), aliases: [...new Set(list(x.aliases))].slice(0, 40),
    domain: str(x.domain).slice(0, 60), min: bound(x.min), max: bound(x.max), higher: ['worse', 'better'].includes(x.higher) ? x.higher : null,
    rater: ['clinician', 'patient', 'observer'].includes(x.rater) ? x.rater : '', indications: [...new Set(list(x.indications))] };
}
/** What is wrong with a project instrument, as sentences; [] when it can be saved. */
export function instrumentProblems(x) {
  const out = [];
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,39}$/.test(x.code || '')) out.push('The instrument needs a code of letters, digits, “_”, “.” or “-”.');
  if (x.min != null && x.max != null && !(x.min < x.max)) out.push(`${x.code}: the lowest score must be below the highest.`);
  return out;
}

const cache = new WeakMap(), NONE = [];
const BUILT = new Map(BUILT_IN_INSTRUMENTS.map(x => [x.code, x]));
/** A project entry over the built-in one of its code (if any): stated fields replace, aliases and indications are added. */
function merged(b, p) {
  if (!b) return { ...p, label: p.label || p.code, builtIn: false };
  return { ...b, label: p.label || b.label, name: p.name || b.name, domain: p.domain || b.domain, min: p.min ?? b.min, max: p.max ?? b.max,
    higher: p.higher ?? b.higher, rater: p.rater || b.rater, aliases: [...new Set([...b.aliases, ...p.aliases])],
    indications: [...new Set([...b.indications, ...p.indications])], builtIn: true, extended: true };
}
/**
 * The registry of a project: the built-in list with the project's own entries (s.instruments). A project entry with a built-in code
 * extends it: the fields it states replace the built-in ones, its aliases and indications are added. Entries with problems are skipped.
 */
export function registry(s) {
  const own = Array.isArray(s?.instruments) ? s.instruments : NONE;
  if (cache.has(own)) return cache.get(own);
  const map = new Map(BUILT_IN_INSTRUMENTS.map(x => [x.code, { ...x, aliases: [...x.aliases], indications: [...x.indications], builtIn: true }]));
  // a later entry of the same code extends the built-in one, not an earlier extension
  for (const p of own.map(normalizeInstrument)) {
    const m = merged(map.get(p.code), p);
    if (!instrumentProblems(m).length) map.set(p.code, m);   // an extension that leaves the range out of order is skipped
  }
  const out = [...map.values()];
  cache.set(own, out);
  return out;
}
export const instrumentOf = (s, code) => (code ? registry(s).find(x => x.code === code) || null : null);

/**
 * The registry as a vocabulary ({ id: 'instruments', label, terms, builtIn }), the shape lib/vocabularies.mjs reads: a term's label is
 * the instrument's short name, its aliases the long name and the aliases. A name two instruments share stays with the first only.
 */
export function instrumentVocabulary(s) {
  const seen = new Set(), terms = [];
  for (const x of registry(s)) {
    const aliases = [];
    for (const n of [x.label, x.code, x.name, ...x.aliases].filter(Boolean)) {
      const k = fold(n); if (seen.has(k)) continue; seen.add(k);
      if (n !== x.label && n !== x.code) aliases.push(n);
    }
    terms.push({ code: x.code, label: x.label, ...(aliases.length ? { aliases } : {}) });
  }
  return { id: INSTRUMENTS_VOCAB, label: 'Outcome instruments', terms, builtIn: true };
}

/** Adds or replaces a project instrument. Reducer. Returns '' or why it was refused. */
export function putInstrument(s, input) {
  const x = normalizeInstrument(input), problems = instrumentProblems(merged(BUILT.get(x.code), x));   // checked as it will be read
  if (problems.length) return problems[0];
  const cur = Array.isArray(s.instruments) ? s.instruments : [];
  s.instruments = cur.some(y => str(y.code) === x.code) ? cur.map(y => (str(y.code) === x.code ? x : y)) : [...cur, x];
  return '';
}

/**
 * The registry indication a project's indication term stands for: by code, label or alias, else by its parents' (nearest first).
 * `term` is { code, label, aliases? } or a text. Returns an INDICATIONS code or null.
 */
export function registryIndication(term, parents = []) {
  const names = t => (typeof t === 'string' ? [t] : [t?.code, t?.label, ...(t?.aliases || [])]).map(fold).filter(Boolean);
  for (const t of [term, ...parents]) {
    const ns = names(t);
    const hit = INDICATIONS.find(i => ns.includes(fold(i.code)) || ns.includes(fold(i.label)) || i.aliases.some(a => ns.includes(fold(a))));
    if (hit) return hit.code;
  }
  return null;
}
/** The instruments that usually serve a registry indication. */
export const usualInstruments = (s, indication) => (indication ? registry(s).filter(x => x.indications.includes(indication)) : []);

