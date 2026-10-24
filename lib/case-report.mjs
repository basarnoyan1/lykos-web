// A single case report, structured by the CARE guideline (Gagnier et al. 2013;
// plan §1.1). One patient, one episode of care: the case is stored under
// s.caseReport as named text fields, a timeline of dated or relative episodes
// and the informed-consent record. The manuscript and the CARE checklist read
// from it; nothing here is stored twice.
//
// Pure: no store, no DOM. The view (views/case.mjs), the checklist, the
// progress list, the result tokens and the bundle all read through here.
import { sections } from './manuscript.mjs';
import { figureTokens } from './figure-style.mjs';
import { caseToFhir } from './case-fhir.mjs';
import { csvSafe } from './csv-safe.mjs';
import { recordOf, caseEvents, recordTexts, recordTables, countFilled, imageCount, summaryMarkdown, LISTS } from './case-record.mjs';
import { r1, svgRoot, text as draw, wrapText, axisLine, measure, LINE } from './figure-draw.mjs';

// The case's free-text fields, in CARE order. `item` is the CARE checklist
// sub-item the field supports.
export const CASE_SECTIONS = [
  { id: 'patient', name: 'Patient information', item: '5', lists: ['medicalHistory'], fields: [
    { id: 'age', label: 'Age', item: '5a', kind: 'input' },
    { id: 'sex', label: 'Sex', item: '5a', kind: 'select' },
    { id: 'demographics', label: 'Other demographics', item: '5a' },
    { id: 'concerns', label: 'Main concerns and symptoms', item: '5b' },
    { id: 'history', label: 'Medical, family and psychosocial history', item: '5c' },
    { id: 'comorbidities', label: 'Comorbidities', item: '5c' },
    { id: 'pastInterventions', label: 'Past interventions and outcomes', item: '5d' },
  ] },
  { id: 'findings', name: 'Clinical findings', item: '6', fields: [
    { id: 'findings', label: 'Examination and clinical findings', item: '6' },
  ] },
  { id: 'timeline', name: 'Timeline', item: '7', fields: [] },
  { id: 'diagnosis', name: 'Diagnostic assessment', item: '8', lists: ['imaging', 'investigations'], fields: [
    { id: 'tests', label: 'Diagnostic tests and results', item: '8a' },
    { id: 'challenges', label: 'Diagnostic challenges', item: '8b' },
    { id: 'differential', label: 'Differential diagnosis', item: '8c' },
    { id: 'diagnosis', label: 'Final diagnosis', item: '8c' },
    { id: 'reasoning', label: 'Diagnostic reasoning', item: '8c' },
    { id: 'prognosis', label: 'Prognostic characteristics', item: '8d' },
  ] },
  { id: 'intervention', name: 'Therapeutic intervention', item: '9', lists: ['treatments'], fields: [
    { id: 'interventionType', label: 'Type of intervention', item: '9a' },
    { id: 'administration', label: 'Dose, strength and duration', item: '9b' },
    { id: 'changes', label: 'Changes and rationale', item: '9c' },
  ] },
  { id: 'followup', name: 'Follow-up and outcomes', item: '10', lists: ['measures'], fields: [
    { id: 'clinicianOutcomes', label: 'Clinician-assessed outcomes', item: '10a' },
    { id: 'patientOutcomes', label: 'Patient-assessed outcomes', item: '10a' },
    { id: 'followupTests', label: 'Follow-up test results', item: '10b' },
    { id: 'adherence', label: 'Adherence and tolerability', item: '10c' },
    { id: 'adverse', label: 'Adverse and unanticipated events', item: '10d' },
  ] },
  { id: 'perspective', name: 'Patient perspective', item: '12', fields: [
    { id: 'perspective', label: 'In the patient’s words', item: '12' },
  ] },
  { id: 'consent', name: 'Informed consent', item: '13', fields: [] },
];
export const CASE_FIELDS = CASE_SECTIONS.flatMap(x => x.fields);

export const SEXES = [['', 'Not stated'], ['female', 'Female'], ['male', 'Male'], ['other', 'Other']];
export const CATEGORIES = [['history', 'Past history'], ['presentation', 'Presentation'], ['diagnostic', 'Diagnostic test'],
  ['intervention', 'Intervention'], ['followup', 'Follow-up'], ['adverse', 'Adverse event']];
export const CONSENT = [['', 'Not recorded'], ['patient', 'Obtained from the patient'],
  ['proxy', 'Obtained from a parent, guardian or next of kin'], ['waived', 'Waived by an ethics committee'], ['none', 'Not obtained']];

const label = (list, v) => list.find(([k]) => k === (v || ''))?.[1] || '';
const text = v => String(v ?? '').trim();

/** The case, with every field present. */
export function caseOf(s) {
  const c = s?.caseReport || {};
  return { ...c, ...recordOf(c), timeline: Array.isArray(c.timeline) ? c.timeline : [], consent: c.consent || {} };
}

// ---- consent ---------------------------------------------------------------
/** Consent counts as recorded when it was obtained or formally waived. */
export const consentRecorded = c => ['patient', 'proxy', 'waived'].includes(c.consent?.status);
export const consentLine = c => {
  const st = c.consent?.status;
  if (!st) return '';
  return [label(CONSENT, st), c.consent.date].filter(Boolean).join(', ');
};

// ---- de-identification -----------------------------------------------------
// Likely identifiers in free text. A hit is a prompt to look, not a verdict:
// "Mr A" and "Day 3" pass, "Mr Smith", "DOB 03/04/1961" and a phone number do not.
const DATE = String.raw`(?:\d{1,2}[\/.\-]\d{1,2}[\/.\-]\d{2,4}|\d{4}-\d{1,2}-\d{1,2}|\d{1,2}\s+[A-Za-z]{3,9}\.?\s+\d{4}|[A-Za-z]{3,9}\.?\s+\d{1,2},?\s+\d{4})`;
const PATTERNS = [
  ['Date of birth', new RegExp(String.raw`\b(?:DOB|D\.O\.B\.?|date of birth|born(?:\s+on)?)\s*[:\-]?\s*${DATE}`, 'gi')],
  ['Email address', /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g],
  ['Record number', /\b(?:MRN|medical record(?:\s+(?:number|no\.?))?|record\s+(?:number|no\.?|#)|hospital\s+(?:number|no\.?)|patient\s+(?:ID|number|no\.?)|NHS\s*(?:number|no\.?)?|SSN|file\s+(?:number|no\.?))\s*[:#]?\s*[A-Z]*\d[A-Z0-9-]{3,}/gi],
  ['Name', /\b(?:Mr|Mrs|Ms|Miss|Mx)\.?\s+[A-Z][a-z]+(?:[-'][A-Z][a-z]+)?/g],
];
// A phone number: 9 to 15 digits in groups, optionally with a country code.
// Lab values ("140/90", "3.5–4.2") and ISO dates do not have that shape.
const PHONE = /(?<![\w.,/])(?:\+\d{1,3}[\s-]?)?(?:\(\d{2,4}\)[\s-]?)?\d{2,4}(?:[\s-]\d{2,4}){1,4}(?!\w|[.,/]\d)/g;

/** Likely identifiers in one text: [{ kind, match }]. */
export function findIdentifiers(value) {
  const t = String(value ?? '');
  const out = [];
  for (const [kind, re] of PATTERNS) for (const m of t.matchAll(re)) out.push({ kind, match: m[0].trim() });
  for (const m of t.matchAll(PHONE)) {
    const digits = m[0].replace(/\D/g, '').length;
    if (digits >= 9 && digits <= 15 && !out.some(o => o.match.includes(m[0].trim()))) out.push({ kind: 'Phone number', match: m[0].trim() });
  }
  return out;
}

/** Every likely identifier in the case's text, with the field it is in. */
export function caseIdentifiers(s) {
  const c = caseOf(s), out = [];
  for (const f of CASE_FIELDS) for (const h of findIdentifiers(c[f.id])) out.push({ ...h, field: f.id, where: f.label });
  c.timeline.forEach((r, i) => { for (const h of findIdentifiers(`${r.event || ''}\n${r.when || ''}`)) out.push({ ...h, field: `timeline:${r.id}`, where: `Timeline, episode ${i + 1}` }); });
  for (const h of findIdentifiers(c.consent.note)) out.push({ ...h, field: 'consent', where: 'Consent note' });
  for (const r of recordTexts(c)) for (const h of findIdentifiers(r.text)) out.push({ ...h, field: r.field, where: r.where });
  return out;
}

// ---- timeline ---------------------------------------------------------------
const UNIT = { d: 1, day: 1, days: 1, w: 7, wk: 7, week: 7, weeks: 7, m: 30.44, mo: 30.44, month: 30.44, months: 30.44, y: 365.25, yr: 365.25, year: 365.25, years: 365.25 };
/**
 * Where an episode sits in time, as a sortable key: a calendar date, or a
 * relative time ("Day −3", "Week 2", "6 months"), in days. Null when unread.
 */
export function whenKey(when) {
  const t = String(when ?? '').trim().replace(/[−–]/g, '-');
  const iso = t.match(/^(\d{4})-(\d{2})(?:-(\d{2}))?/);
  if (iso) return { kind: 'date', v: Date.UTC(+iso[1], +iso[2] - 1, +(iso[3] || 1)) / 864e5 };
  let m = t.match(/^(day|d|week|wk|w|month|mo|m|year|yr|y)\s*([+-]?\d+(?:\.\d+)?)/i);
  if (m) return { kind: 'rel', v: Number(m[2]) * UNIT[m[1].toLowerCase()] };
  m = t.match(/^([+-]?\d+(?:\.\d+)?)\s*(days?|d|weeks?|wk|w|months?|mo|m|years?|yr|y)\b/i);
  if (m) return { kind: 'rel', v: Number(m[1]) * UNIT[m[2].toLowerCase()] * (/\b(before|ago|earlier|prior)\b/i.test(t) ? -1 : 1) };
  return null;
}
/** The episodes in time order, when they can all be placed on one scale; otherwise as entered. */
export function sortTimeline(rows) {
  const keyed = rows.map(r => ({ r, k: whenKey(r.when) }));
  const kinds = new Set(keyed.map(x => x.k?.kind));
  if (kinds.has(undefined) || kinds.size !== 1) return { rows, sorted: false };
  return { rows: keyed.map((x, i) => ({ ...x, i })).sort((a, b) => a.k.v - b.k.v || a.i - b.i).map(x => x.r), sorted: true };
}

/** The token set a figure is drawn with: the caller's, else the house screen set. */
const tokensOf = style => style || figureTokens(null, { medium: 'screen', profile: 'lykos-house' });

/**
 * The timeline as a self-contained SVG in the house style: when, on the left,
 * wrapped to two lines; a rule with one mark per episode; the category and the
 * event, wrapped, on the right. The classes let the app draw it in the
 * interface's ink; the export keeps the profile's greys on white. `style` is a
 * figureTokens set (the screen set when absent); `width` is in its unit.
 */
export function timelineSvg(rows, { width = null, title = 'Case timeline', style = null } = {}) {
  const t = tokensOf(style), ls = t.size.label, sm = t.size.small, line = ls * LINE, P = Math.max(t.pad, ls);
  const W = Math.max(Math.round(320 * ls / 12), Math.round(width ?? t.width.double));
  const list = (rows || []).filter(r => text(r.event) || text(r.when));
  const whenMax = Math.min(150 * ls / 12, W * 0.28);
  const whens = list.map(r => wrapText(t, text(r.when) || '—', whenMax).slice(0, 2));
  const whenW = Math.max(64 * ls / 12 - 4, ...whens.flat().map(l => measure(t, l))) + 4;
  const axisX = P + whenW + ls * 1.1, textX = axisX + ls * 1.3, textW = W - textX - P;
  const parts = [], marks = [];
  let y = P;
  if (!list.length) {
    parts.push(draw(t, P, y + ls, 'No episodes', { cls: 'c-mute' }));
    y += line + P;
  }
  list.forEach((r, i) => {
    const cat = label(CATEGORIES, r.category), ev = wrapText(t, text(r.event) || '—', textW);
    const top = y, whenLines = whens[i];
    let ly = top + ls;
    whenLines.forEach((l, j) => parts.push(draw(t, P + whenW, top + ls + j * line, l, { anchor: 'end', role: 'head', cls: 'c-ink c-head' })));
    if (cat) { parts.push(draw(t, textX, ly, cat, { role: 'small', cls: 'c-mute' })); ly += line; }
    for (const l of ev) { parts.push(draw(t, textX, ly, l, {})); ly += line; }
    ly = Math.max(ly, top + ls + whenLines.length * line);
    marks.push(top + ls * 0.65);
    y = ly - ls + ls * 1.2;
  });
  if (marks.length) {
    parts.unshift(axisLine(t, axisX, marks[0], axisX, marks.at(-1)));
    for (const m of marks) parts.push(`<circle class="c-dot c-mark" cx="${r1(axisX)}" cy="${r1(m)}" r="${t.dot}" fill="${t.color.ink}"/>`);
  }
  const H = Math.ceil(y + P - ls * 1.2 + (list.length ? 0 : 0));
  return svgRoot(t, W, H, parts.join(''), { title, desc: `${list.length} ${list.length === 1 ? 'episode' : 'episodes'}` });
}

export const timelineCsvRows = s => [['order', 'when', 'category', 'event', 'from'],
  ...caseEvents(caseOf(s)).map((r, i) => [i + 1, csvSafe(r.when || ''), label(CATEGORIES, r.category), csvSafe(r.event || ''), r.source === 'episode' ? 'timeline' : r.source])];

// ---- completeness -------------------------------------------------------------
/** Each CARE section of the case: how many of its parts hold something. */
export function careSections(s) {
  const c = caseOf(s);
  return CASE_SECTIONS.map(sec => {
    if (sec.id === 'timeline') { const n = caseEvents(c).length; return { ...sec, filled: n ? 1 : 0, total: 1, line: `${n} ${n === 1 ? 'event' : 'events'}` }; }
    if (sec.id === 'consent') return { ...sec, filled: consentRecorded(c) ? 1 : 0, total: 1, line: consentLine(c) || 'Not recorded' };
    const lists = sec.lists || [];
    const filled = sec.fields.filter(f => text(c[f.id])).length + lists.filter(l => countFilled(c, l)).length, total = sec.fields.length + lists.length;
    return { ...sec, filled, total, line: `${filled} of ${total}` };
  });
}

// ---- CARE checklist support ---------------------------------------------------
// The manuscript's own sections, by heading, with the h3 subsections under each.
function manuscriptParts(s) {
  const blocks = s?.manuscript?.blocks || [];
  const out = { title: text(blocks.find(b => b.type === 'h1')?.text) };
  for (const sec of sections(blocks)) {
    const name = text(sec.heading?.text).toLowerCase();
    if (!name) continue;
    const sub = {}; let cur = '';
    let body = '';
    for (const b of sec.blocks) {
      if (b.type === 'h3') { cur = text(b.text).toLowerCase(); continue; }
      body += ` ${b.text || ''}`;
      if (cur) sub[cur] = `${sub[cur] || ''} ${b.text || ''}`;
    }
    out[name] = { text: body.trim(), sub };
  }
  return out;
}
const has = (m, name) => m[name]?.text?.trim();

/** CARE items the case record and the manuscript can vouch for, with what vouches. */
export function caseSupported(s) {
  const c = caseOf(s), m = manuscriptParts(s), out = {};
  if (/case report/i.test(m.title || '') && !/^diagnosis or intervention:/i.test(m.title)) out['1'] = 'manuscript title';
  const kw = m.keywords?.text || (s?.manuscript?.blocks || []).map(b => b.text).find(t => /^key\s*words?\s*:/i.test(t || '')) || '';
  if (text(kw).replace(/^key\s*words?\s*:/i, '').replace(/case reports?/gi, '').replace(/[;,.\s]/g, '')) out['2'] = 'keywords';
  const abs = m.abstract?.sub || {};
  if (text(abs.introduction)) out['3a'] = 'abstract introduction';
  if (text(abs['case presentation'])) { out['3b'] = 'abstract case presentation'; out['3c'] = 'abstract case presentation'; }
  if (text(abs.conclusions || abs.conclusion)) out['3d'] = 'abstract conclusions';
  if (has(m, 'introduction')) out['4'] = 'manuscript introduction';
  for (const f of CASE_FIELDS) if (text(c[f.id]) && !out[f.item]) out[f.item] = `case: ${f.label.toLowerCase()}`;
  for (const [list, item, name] of [['medicalHistory', '5c', 'medical history'], ['imaging', '8a', 'imaging'], ['investigations', '8a', 'investigations'], ['treatments', '9a', 'treatments'], ['measures', '10a', 'outcome measures']])
    if (countFilled(c, list) && !out[item]) out[item] = `case: ${name}`;
  if (caseEvents(c).length) out['7'] = `timeline (${caseEvents(c).length} ${caseEvents(c).length === 1 ? 'event' : 'events'})`;
  if (has(m, 'discussion')) {
    out['11a'] = 'manuscript discussion'; out['11c'] = 'manuscript discussion';
    if (/\[@/.test(m.discussion.text)) out['11b'] = 'discussion with citations';
  }
  if (has(m, 'conclusions') || has(m, 'conclusion')) out['11d'] = 'manuscript conclusions';
  if (!out['12'] && has(m, 'patient perspective')) out['12'] = 'manuscript patient perspective';
  if (consentRecorded(c)) out['13'] = `consent: ${consentLine(c).toLowerCase()}`;
  return out;
}

// ---- what still needs a person -----------------------------------------------
export function caseIssues(s) {
  const c = caseOf(s), out = [];
  if (!c.consent.status) out.push({ severity: 'block', text: 'Informed consent not recorded' });
  else if (c.consent.status === 'none') out.push({ severity: 'block', text: 'Informed consent not obtained' });
  else if (consentRecorded(c) && c.consent.status !== 'waived' && !c.consent.date) out.push({ severity: 'gap', text: 'Consent date not recorded' });
  const ids = caseIdentifiers(s).length;
  if (ids) out.push({ severity: 'block', text: `${ids} likely ${ids === 1 ? 'identifier' : 'identifiers'} in case text`, n: ids });
  if (!caseEvents(c).length) out.push({ severity: 'gap', text: 'Timeline has no events' });
  const imgs = imageCount(c);
  if (imgs) out.push({ severity: 'gap', text: `${imgs} ${imgs === 1 ? 'image' : 'images'} attached: check each for a name, number or date in the picture` });
  const empty = careSections(s).filter(x => x.id !== 'consent' && x.id !== 'timeline' && !x.filled).length;
  if (empty) out.push({ severity: 'gap', text: `${empty} case ${empty === 1 ? 'section' : 'sections'} empty`, n: empty });
  return out;
}

// ---- values for the manuscript --------------------------------------------------
/** "54-year-old woman", or the parts that are known. */
export function patientPhrase(c) {
  const age = text(c.age), n = Number(age), sex = c.sex;
  const child = (Number.isFinite(n) && n < 18) || /\b(days?|weeks?|months?)\b/i.test(age);
  const noun = sex === 'female' ? (child ? 'girl' : 'woman') : sex === 'male' ? (child ? 'boy' : 'man') : 'patient';
  if (!age) return sex ? noun : '';
  return /^\d+(\.\d+)?$/.test(age) ? `${age}-year-old ${noun}` : `${noun} aged ${age}`;
}

/** The case's values as linkable results: [key, label, raw, text]. */
export function caseResults(s) {
  const c = caseOf(s);
  const rows = [
    ['case.patient', 'Patient', patientPhrase(c)],
    ['case.age', 'Age', text(c.age)],
    ['case.sex', 'Sex', c.sex ? label(SEXES, c.sex) : ''],
  ];
  for (const f of CASE_FIELDS) if (!['age', 'sex'].includes(f.id)) rows.push([`case.${f.id}`, f.label, text(c[f.id])]);
  const n = caseEvents(c).length;
  rows.push(['case.timeline_n', 'Timeline events', n ? String(n) : '']);
  for (const [l, name] of [['imaging', 'Imaging studies'], ['investigations', 'Investigations'], ['treatments', 'Treatments'], ['medicalHistory', 'History entries'], ['measures', 'Outcome measures']]) { const k = countFilled(c, l); rows.push([`case.${l}_n`, name, k ? String(k) : '']); }
  rows.push(['case.consent', 'Informed consent', consentLine(c)]);
  rows.push(['case.consent_date', 'Consent date', text(c.consent.date)]);
  return rows.filter(([, , v]) => v).map(([key, lab, v]) => [key, lab, v, v]);
}

// ---- export ----------------------------------------------------------------------
/** The case on one page of Markdown, in CARE order (lib/case-record.mjs summaryMarkdown). */
export function caseSummaryMarkdown(s) {
  const c = caseOf(s);
  return summaryMarkdown(c, { title: 'Case summary', phrase: patientPhrase(c), sections: CASE_SECTIONS, consent: consentLine(c), events: caseEvents(c) });
}

/** The case as the bundle carries it: JSON, the timeline as CSV and SVG. */
export function caseBundle(s, csv) {
  const c = caseOf(s), entries = [], missing = [];
  entries.push({ name: 'case/case.json', data: JSON.stringify({
    care: '2013', fields: Object.fromEntries(CASE_FIELDS.map(f => [f.id, c[f.id] || ''])),
    timeline: c.timeline.map(({ when, category, event }) => ({ when: when || '', category: category || '', event: event || '' })),
    ...Object.fromEntries(LISTS.map(l => [l, c[l].map(({ files, ...r }) => (files?.length ? { ...r, images: files.map(f => ({ name: f.name, caption: f.caption })) } : r))])),
    consent: { status: c.consent.status || '', label: label(CONSENT, c.consent.status), date: c.consent.date || '', note: c.consent.note || '' },
  }, null, 2) });
  const events = caseEvents(c);
  if (events.length) entries.push({ name: 'case/timeline.csv', data: csv(timelineCsvRows(s)) }, { name: 'case/timeline.svg', data: timelineSvg(events, { style: figureTokens(null, { medium: 'export' }) }) });
  for (const [l, rows] of Object.entries(recordTables(c))) if (rows.length > 1) entries.push({ name: `case/${l.replace(/[A-Z]/g, m => '-' + m.toLowerCase())}.csv`, data: csv(rows) });
  entries.push({ name: 'case/fhir-bundle.json', data: JSON.stringify(caseToFhir(c), null, 2) + '\n' });
  entries.push({ name: 'case/summary.md', data: caseSummaryMarkdown(s) });
  for (const u of caseIssues(s)) missing.push(`${u.text}.`);
  const ids = caseIdentifiers(s);
  if (ids.length) missing.push(`Check before sharing: ${ids.map(h => `${h.kind.toLowerCase()} in ${h.where.toLowerCase()}`).slice(0, 6).join('; ')}${ids.length > 6 ? '; …' : ''}.`);
  return { entries, missing };
}

/** A few lines for the assistant: each section, briefly. */
export function caseSummary(s) {
  const c = caseOf(s);
  const short = v => { const t = text(v).replace(/\s+/g, ' '); return t.length > 220 ? `${t.slice(0, 220)}…` : t; };
  const lines = [`Case report (CARE). Patient: ${patientPhrase(c) || 'not described'}`];
  for (const sec of CASE_SECTIONS) {
    if (!sec.fields.length) continue;
    const got = sec.fields.filter(f => text(c[f.id]) && !['age', 'sex'].includes(f.id)).map(f => `${f.label}: ${short(c[f.id])}`);
    lines.push(`${sec.name}: ${got.join(' | ') || 'empty'}`);
  }
  const events = caseEvents(c);
  lines.push(`Timeline: ${events.length ? events.slice(0, 12).map(r => `${r.when || '?'} ${short(r.event)}`).join('; ') : 'none'}`);
  for (const [l, name] of [['medicalHistory', 'Medical history'], ['imaging', 'Imaging'], ['investigations', 'Investigations'], ['treatments', 'Treatments'], ['measures', 'Outcome measures']]) if (countFilled(c, l)) lines.push(`${name}: ${c[l].filter(r => r.when || r.id).length} rows`);
  lines.push(`Informed consent: ${consentLine(c) || 'not recorded'}`);
  const ids = caseIdentifiers(s).length;
  if (ids) lines.push(`Likely identifiers in text: ${ids}`);
  return lines.join('\n');
}

/** The house drawings app/lint-figures.mjs checks: a timeline with a long entry, one with a long date, and an empty one. */
export const __fixture = style => [
  { name: 'timelineSvg', svg: timelineSvg([{ when: 'Day 0', category: 'presentation', event: 'Presented with severe back pain radiating to the left leg with numbness and weakness' },
    { when: 'Day 2', category: 'diagnostic', event: 'MRI and nerve conduction studies' }, { when: 'Three months after discharge', category: 'outcome', event: 'Back at work, pain resolved, no further treatment' }], { style }) },
  { name: 'timelineSvg-empty', svg: timelineSvg([], { style }) },
];
