// What Make (views/summary-make.mjs) can draw from the Data summary's fields: the fields with levels, every source of one number per study
// (a number field, a number written as text, a measure), every measure of a kind, and each study's sample size. Pure: the summary's fields
// come in (lib/extraction-summary.mjs summaryOf), a `ctx` gives the studies kept and a study's text in a field.
import { labelCase } from './label-case.mjs';
import { readableLabel } from './label-text.mjs';
import { readPart } from './extraction-parts.mjs';

/** A field's label as a reader says it: "Age; sex" → "Age and sex". */
export const fieldLabel = f => readableLabel(f.label);
const keyOf = t => String(t ?? '').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim();

const fmt = v => (Number.isInteger(v) ? String(v) : (Math.round(v * 10) / 10).toString());

/** The fields a choice can draw: those with levels, numbers or measures. */
export const chartable = fields => fields.filter(f => ['categorical', 'multi', 'numeric', 'measures'].includes(f.kind));
/**
 * The fields with levels, each with them: a pie or bars, a comparison's sides, a swimmer's lanes, a SWiM's groups. A level field's levels
 * are the summary's choices (`ctx.choicesOf`, grouped and unread ones left out); a free text field whose cells have parts gives its leading
 * parts as levels (lib/extraction-parts.mjs: "Dynesys; 3–7 levels" leads with Dynesys). [{ id, label, field, levels: [{ key, label, ids }] }].
 */
export function leveled(fields, ctx) {
  const out = [];
  for (const f of fields) {
    if (f.kind === 'categorical' || f.kind === 'multi') { const levels = (ctx?.choicesOf ? ctx.choicesOf(f) : []).filter(c => c.ids.length && !c.key.startsWith('g:') && !c.key.startsWith('u:')); if (levels.length) out.push({ id: f.id, label: fieldLabel(f), field: f, levels }); continue; }
    const leads = (f.parts?.leads || []).filter(l => l.k >= 2);
    if (f.kind === 'free' && leads.length >= 2 && leads.length <= 12) out.push({ id: f.id, label: fieldLabel(f), field: f, levels: leads.map(l => ({ key: `p:${keyOf(l.label)}`, label: l.label, ids: l.studies.map(s => s.paperId) })) });
  }
  return out;
}
/**
 * Every measure of every measures field of the `types` asked, and the counts a free text field's parts name ("extension to S1 in 25/57"),
 * as { id: field|key, label, fieldId, key, name, rawName, type, free? }; the name in sentence case.
 */
export const measuresOf = (fields, types = ['tally']) => [
  ...fields.filter(f => f.kind === 'measures').flatMap(f => f.measures.measures.filter(m => types.includes(m.type)).map(m => ({ id: `${f.id}|${m.key}`, label: `${labelCase(m.name)} (${fieldLabel(f)})`, fieldId: f.id, key: m.key, name: labelCase(m.name), rawName: m.name, type: m.type }))),
  ...(types.includes('tally') ? fields.filter(f => f.kind === 'free' && f.parts?.tallies?.length).flatMap(f => f.parts.tallies.map(t => ({ id: `${f.id}|p:${keyOf(t.name)}`, label: `${labelCase(t.name)} (${fieldLabel(f)})`, fieldId: f.id, key: keyOf(t.name), name: labelCase(t.name), rawName: t.name, type: 'tally', free: true }))) : [])];
/** A study's count for a measure: a measures field's part with the key (lib/extraction-measures.mjs), or the free text's part naming it. */
export function tallyFor(text, m, readMeasures) {
  if (m.free) { for (const part of String(text ?? '').split(/\s*[;\n]\s*/)) { const r = readPart(part); if (r.type === 'tally' && keyOf(r.name) === m.key) return { events: r.n, n: r.N }; } return null; }
  const p = (readMeasures(text) || []).find(x => x.key === m.key && x.value.type === 'tally');
  return p ? { events: p.value.n, n: p.value.N } : null;
}

/** The first number written in a text ("24 (12–60)" is 24, "mean 36.5" is 36.5), or null. */
export const firstNumber = text => { const m = /-?\d+(?:[.,]\d+)?/.exec(String(text ?? '')); return m ? Number(m[0].replace(',', '.')) : null; };
/** A unit named in a field's label, in parentheses or after a comma ("Follow-up (mo)", "Age, years"), or ''. */
export const unitOf = (label, unit = '') => unit || (/\(([^)]{1,12})\)\s*$/.exec(String(label || '')) || /,\s*([a-z]{1,10})\s*$/i.exec(String(label || '')))?.[1] || '';
/** A time written in a measure's text ("revision at 24 months", "2 yr"), in months, or null. */
export const monthsIn = text => { const m = /(\d+(?:[.,]\d+)?)\s*(?:[-–]|to)?\s*(?:\d+(?:[.,]\d+)?)?\s*(mo\b|months?|wk\b|weeks?|yr?s?\b|years?|d\b|days?)/i.exec(String(text ?? '')); if (!m) return null;
  const v = Number(m[1].replace(',', '.')), u = m[2].toLowerCase(); return /^(y|yr|yrs|year|years)$/.test(u) ? v * 12 : /^(wk|week|weeks)$/.test(u) ? v / 4.33 : /^(d|day|days)$/.test(u) ? v / 30.4 : v; };
/** Whether a unit names a span of time, and what one of it is in years (months 1/12, years 1); null for a unit that is not time. */
export const yearsPerUnit = unit => (/^(mo|mos|months?)$/i.test(unit) ? 1 / 12 : /^(yr?s?|years?)$/i.test(unit) ? 1 : /^(wk|wks|weeks?)$/i.test(unit) ? 1 / 52.18 : /^(d|days?)$/i.test(unit) ? 1 / 365.25 : null);

/**
 * Every source of one number per study, for a histogram, a swimmer's length, a scatter or a meta-regression: the fields read as numbers, the
 * fields whose values are written as text with a number first (a median with its range), and the measures (a number, a change's end, a
 * count's share). [{ id, label, unit, kind, fieldId, values: [{ paperId, value, text }] }], each with two or more studies, number fields first.
 */
export function numberSources(fields, ctx) {
  const out = [], rank = { numeric: 0, measure: 1, text: 2 };
  for (const f of fields) {
    if (f.kind === 'numeric') { const values = (f.numeric?.values || []).map(x => ({ paperId: x.paperId, value: x.value, text: fmt(x.value) })); if (values.length >= 2) out.push({ id: `n:${f.id}`, label: fieldLabel(f), unit: unitOf(f.label, f.unit), kind: 'numeric', fieldId: f.id, values }); continue; }
    if (f.kind === 'measures') {
      for (const m of f.measures.measures) {
        const of = m.studies.filter(s => ['number', 'change', 'tally'].includes(s.value.type));
        const values = of.map(s => ({ paperId: s.paperId, text: s.text, value: s.value.type === 'number' ? s.value.value : s.value.type === 'change' ? s.value.to : s.value.N ? 100 * s.value.n / s.value.N : null })).filter(v => Number.isFinite(v.value));
        if (values.length >= 2) out.push({ id: `m:${f.id}|${m.key}`, label: `${labelCase(m.name)} (${fieldLabel(f)})`, unit: of[0].value.type === 'tally' ? '%' : of[0].value.unit || '', kind: 'measure', fieldId: f.id, values });
      }
      continue;
    }
    if (f.kind !== 'free' && f.kind !== 'categorical' && f.kind !== 'multi') continue;
    // numbers written as text: offered when they are what the field holds (a number first in at least half its values)
    const texts = [...ctx.kept].map(id => ({ paperId: id, text: ctx.valueText(id, f.id) })).filter(x => x.text);
    const values = texts.map(x => ({ ...x, value: firstNumber(x.text) })).filter(x => x.value != null && /^\s*[^a-z]*\d/i.test(x.text.replace(/^(?:mean|median|n|about|~)\s*/i, '')));
    if (texts.length && values.length >= 2 && values.length >= texts.length / 2) out.push({ id: `t:${f.id}`, label: fieldLabel(f), unit: unitOf(f.label, f.unit), kind: 'text', fieldId: f.id, values });
  }
  return out.sort((a, b) => rank[a.kind] - rank[b.kind]);
}

/**
 * Each study's sample size, for a mark sized by n and a harvest bar's height: a field whose label names the size (n, sample, patients,
 * participants), read as a number (arms named in it are added up), else the largest total a counted measure gives the study.
 * Answers { of(paperId) → n | null, source: the field or measure read, or '' }.
 */
export function studySizes(fields, ctx) {
  const SIZE = /(^|[^a-z])(n|sample size|sample|patients|participants|size)([^a-z]|$)/i, ints = t => (String(t).match(/\d+(?:[.,]\d+)?/g) || []).map(x => Number(x.replace(',', '.')));
  const sizes = new Map();
  const field = fields.find(f => SIZE.test(f.label) && ['numeric', 'free', 'categorical', 'multi'].includes(f.kind));
  if (field) {
    const arms = /\b(arm|group)s?\b/i.test(field.label);
    for (const id of ctx.kept) { const t = ctx.valueText(id, field.id), ns = ints(t); if (ns.length) sizes.set(id, arms ? ns.reduce((a, b) => a + b, 0) : ns[0]); }
    if (sizes.size) return { of: id => sizes.get(id) ?? null, source: fieldLabel(field) };
  }
  for (const f of fields.filter(x => x.kind === 'measures')) for (const m of f.measures.measures.filter(x => x.type === 'tally'))
    for (const st of m.studies) if (st.value.type === 'tally' && st.value.N > (sizes.get(st.paperId) || 0)) sizes.set(st.paperId, st.value.N);
  return { of: id => sizes.get(id) ?? null, source: sizes.size ? 'the largest total of a counted measure' : '' };
}

