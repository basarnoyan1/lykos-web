// A researcher-defined appraisal instrument: the review team names its
// judgement levels, its domains and, under each domain, the questions that
// inform the domain judgement. toTool() gives it the APPRAISAL_TOOLS shape
// (schema.mjs) so the appraisal view, summaries and figures read it like any
// shipped instrument.
//
// {
//   id, name, design,
//   judgements: ['Low', 'Some concerns', 'High'],   // most to least favourable
//   unranked: ['No information'],                   // optional: levels outside that order
//   domains: [{ id, name, questions: [{ id, text, answers: ['Yes', 'No'] }] }],
//   overall: 'worst' | 'manual' | 'none',
// }
//
// "worst" takes the least favourable domain judgement — the order of
// `judgements` is the ranking. "manual" leaves the overall to the reviewer;
// "none" has no overall. Pure; no imports.

export const OVERALL_RULES = ['worst', 'manual', 'none'];
export const FORMAT = 'lykos-appraisal-instrument';
const ID = /^[a-z0-9][a-z0-9-]{0,47}$/;
const str = x => (typeof x === 'string' ? x.trim() : '');

const dupes = list => list.filter((x, i) => list.indexOf(x) !== i);

/**
 * Problems with an instrument definition, as sentences; `ok` when there are
 * none. `reserved` lists ids already taken (the shipped instruments).
 */
export function validate(inst, { reserved = [] } = {}) {
  const errors = [];
  if (!inst || typeof inst !== 'object') return { ok: false, errors: ['Not an instrument definition'] };
  const id = str(inst.id);
  if (!ID.test(id)) errors.push('Id must be lower-case letters, digits and hyphens');
  else if (reserved.includes(id) || reserved.includes(toolId(id))) errors.push(`Id ${id} is already in use`);
  if (!str(inst.name)) errors.push('Name is required');
  const j = Array.isArray(inst.judgements) ? inst.judgements.map(str) : [];
  if (j.length < 2) errors.push('At least two judgement levels are needed');
  if (j.some(x => !x)) errors.push('A judgement level is empty');
  if (dupes(j).length) errors.push(`Judgement level repeated: ${[...new Set(dupes(j))].join(', ')}`);
  const unranked = Array.isArray(inst.unranked) ? inst.unranked.map(str) : [];
  for (const u of unranked) if (!j.includes(u)) errors.push(`Unranked level ${u} is not a judgement level`);
  if (j.length && unranked.length >= j.length - 1) errors.push('At least two judgement levels must be ranked');
  if (!OVERALL_RULES.includes(inst.overall)) errors.push('Overall must be worst, manual or none');
  const domains = Array.isArray(inst.domains) ? inst.domains : [];
  if (!domains.length) errors.push('At least one domain is needed');
  const dids = domains.map(d => str(d?.id));
  if (dids.some(x => !ID.test(x))) errors.push('Each domain needs an id of lower-case letters, digits and hyphens');
  if (dids.includes('overall')) errors.push('A domain cannot be called overall');
  if (dupes(dids).length) errors.push(`Domain id repeated: ${[...new Set(dupes(dids))].join(', ')}`);
  domains.forEach((d, i) => {
    const at = `Domain ${i + 1}`;
    if (!str(d?.name)) errors.push(`${at} needs a name`);
    const qs = d?.questions == null ? [] : d.questions;
    if (!Array.isArray(qs)) { errors.push(`${at}: questions must be a list`); return; }
    const qids = qs.map(q => str(q?.id));
    if (qids.some(x => !ID.test(x))) errors.push(`${at}: each question needs an id of lower-case letters, digits and hyphens`);
    if (dupes(qids).length) errors.push(`${at}: question id repeated: ${[...new Set(dupes(qids))].join(', ')}`);
    qs.forEach((q, k) => {
      if (!str(q?.text)) errors.push(`${at}, question ${k + 1} needs text`);
      const a = Array.isArray(q?.answers) ? q.answers.map(str) : [];
      if (a.length < 2 || a.some(x => !x)) errors.push(`${at}, question ${k + 1} needs at least two answers`);
      else if (dupes(a).length) errors.push(`${at}, question ${k + 1} repeats an answer`);
    });
  });
  return { ok: errors.length === 0, errors };
}

/** The id the app stores assessments under: prefixed so it never meets a shipped instrument's. */
export const toolId = id => (String(id).startsWith('custom-') ? String(id) : `custom-${id}`);

/** The instrument in the APPRAISAL_TOOLS shape. Throws on an invalid definition. */
export function toTool(inst) {
  const v = validate(inst);
  if (!v.ok) throw new Error(`Invalid instrument: ${v.errors[0]}`);
  return {
    id: toolId(str(inst.id)),
    name: str(inst.name),
    design: str(inst.design) || 'Defined by the review',
    judgements: inst.judgements.map(str),
    source: { url: str(inst.source?.url), note: 'Defined by the review team' },
    overall: inst.overall !== 'none',
    overallRule: inst.overall,
    custom: true,
    unranked: (inst.unranked || []).map(str),
    domains: inst.domains.map((d, i) => ({
      id: str(d.id), short: `D${i + 1}`, label: str(d.name),
      ...(d.questions?.length ? {
        signals: d.questions.map(q => str(q.text)),
        questions: d.questions.map(q => ({ id: str(q.id), text: str(q.text), answers: q.answers.map(str) })),
      } : {}),
    })),
  };
}

/**
 * The overall judgement a rule gives. `domainJudgements` is a map
 * { domainId: level } or a list of levels; `inst` supplies the ranking and,
 * for a map, the domains that must all be judged.
 * Returns { value, rule, complete, drivers } — `value` is null for "manual"
 * (the reviewer chooses), for "none", and while any domain is unjudged.
 */
export function overallFrom(domainJudgements, rule, inst = {}) {
  const judgements = (inst.judgements || []).map(str);
  const unranked = new Set((inst.unranked || []).map(str));
  const entries = Array.isArray(domainJudgements)
    ? domainJudgements.map((v, i) => [String(i), v])
    : (inst.domains?.length ? inst.domains.map(d => [str(d.id), domainJudgements?.[str(d.id)]]) : Object.entries(domainJudgements || {}));
  const complete = entries.length > 0 && entries.every(([, v]) => str(v));
  const out = { value: null, rule, complete, drivers: [] };
  if (rule !== 'worst' || !complete) return out;
  let worst = -1;
  for (const [, v] of entries) {
    const r = judgements.indexOf(str(v));
    if (r < 0 && !unranked.has(str(v))) throw new Error(`Unknown judgement: ${v}`);
    if (!unranked.has(str(v))) worst = Math.max(worst, r);
  }
  if (worst < 0) return out;          // every domain unranked: nothing to take the worst of
  out.value = judgements[worst];
  out.drivers = entries.filter(([, v]) => str(v) === out.value).map(([k]) => k);
  return out;
}

/** The definition as a JSON file's text. */
export function exportInstrument(inst) {
  const v = validate(inst);
  if (!v.ok) throw new Error(`Invalid instrument: ${v.errors[0]}`);
  const clean = {
    id: str(inst.id), name: str(inst.name), design: str(inst.design),
    judgements: inst.judgements.map(str),
    ...(inst.unranked?.length ? { unranked: inst.unranked.map(str) } : {}),
    overall: inst.overall,
    domains: inst.domains.map(d => ({ id: str(d.id), name: str(d.name),
      questions: (d.questions || []).map(q => ({ id: str(q.id), text: str(q.text), answers: q.answers.map(str) })) })),
  };
  return JSON.stringify({ format: FORMAT, version: 1, instrument: clean }, null, 2);
}

/** A definition read back from JSON text: { ok, instrument, errors }. A bare instrument object is accepted too. */
export function importInstrument(text, opts) {
  let data;
  try { data = JSON.parse(String(text)); } catch { return { ok: false, instrument: null, errors: ['Not valid JSON'] }; }
  if (data && data.format != null && data.format !== FORMAT) return { ok: false, instrument: null, errors: [`Unknown format: ${data.format}`] };
  if (data?.format === FORMAT && data.version !== 1) return { ok: false, instrument: null, errors: [`Unsupported version: ${data.version}`] };
  const inst = data?.format === FORMAT ? data.instrument : data;
  const v = validate(inst, opts);
  return { ok: v.ok, instrument: v.ok ? inst : null, errors: v.errors };
}
