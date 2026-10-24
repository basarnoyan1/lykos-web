// The structured part of a case report (plan §1.1, amended 2026-10-20): what a clinician would otherwise keep in a chart, kept as dated rows
// in five lists beside the CARE narrative: history, imaging, investigations, treatments and outcome measures. The narrative text (CARE
// items 5 to 10) says what happened; these rows say what was done and found, in a form that sorts, exports (lib/case-fhir.mjs) and draws.
//
//   s.caseReport.medicalHistory [{ id, when, category, text, status }]            category: medical | surgical | family | medication | allergy | social
//   s.caseReport.imaging        [{ id, when, modality, region, findings, files }] modality: a DICOM modality code; files: [{ id, name, caption }]
//   s.caseReport.investigations [{ id, when, test, value, flag }]                 value: "9.1 g/dL" (a number and its unit, or text)
//   s.caseReport.treatments     [{ id, when, kind, name, detail }]                kind: drug | procedure | other; detail: dose, route, frequency, duration
//   s.caseReport.measures       [{ id, when, scale, score }]                      a scale scored at a time (mRS, VAS, ODI)
//
// `when` is a calendar date (2026-03-02, 2026-03, 2026) or a time relative to presentation (Day 3, Week 2, 6 months), as in the timeline.
// Nothing is stored twice: the timeline figure draws the free episodes and every dated row of these lists together (`caseEvents`).
import { sortTimeline } from './case-report.mjs';
import { csvSafe } from './csv-safe.mjs';
import { findLab, intervalText } from './lab-reference.mjs';

export const LISTS = ['medicalHistory', 'imaging', 'investigations', 'treatments', 'measures'];

// Option lists: [value, label]. Modality values are DICOM's (PS3.16 CID 29, the codes an ImagingStudy carries).
export const HISTORY_CATEGORIES = [['medical', 'Medical'], ['surgical', 'Surgical'], ['family', 'Family'], ['medication', 'Medication'], ['allergy', 'Allergy'], ['social', 'Social']];
export const HISTORY_STATUS = [['', 'Not stated'], ['active', 'Active'], ['resolved', 'Resolved']];
export const MODALITIES = [['MR', 'MRI'], ['CT', 'CT'], ['DX', 'Radiograph'], ['US', 'Ultrasound'], ['PT', 'PET'], ['NM', 'Nuclear medicine'], ['XA', 'Angiography'], ['XC', 'Photograph'], ['OT', 'Other']];
export const FLAGS = [['', 'No flag'], ['N', 'Normal'], ['H', 'High'], ['L', 'Low'], ['A', 'Abnormal']];
export const TREATMENT_KINDS = [['drug', 'Drug'], ['procedure', 'Procedure'], ['other', 'Other']];

const text = v => String(v ?? '').trim();
const label = (list, v) => list.find(([k]) => k === v)?.[1] || '';
const pick = (list, v, fallback) => (list.some(([k]) => k === v) ? v : fallback);
const files = f => (Array.isArray(f) ? f : []).filter(x => x && x.id).map(x => ({ id: String(x.id), name: text(x.name), caption: text(x.caption) }));

/** The five lists of a case, every row complete. A row with nothing in it is kept (a person is mid-entry). */
export function recordOf(c = {}) {
  const rows = (list, shape) => (Array.isArray(c[list]) ? c[list] : []).map((r, i) => ({ id: r?.id || `${list[0]}${i + 1}`, when: text(r?.when), ...shape(r || {}) }));
  return {
    medicalHistory: rows('medicalHistory', r => ({ category: pick(HISTORY_CATEGORIES, r.category, 'medical'), text: text(r.text), status: pick(HISTORY_STATUS, r.status, '') })),
    imaging: rows('imaging', r => ({ modality: pick(MODALITIES, r.modality, 'MR'), region: text(r.region), findings: text(r.findings), files: files(r.files) })),
    investigations: rows('investigations', r => ({ test: text(r.test), value: text(r.value), flag: pick(FLAGS, r.flag, '') })),
    treatments: rows('treatments', r => ({ kind: pick(TREATMENT_KINDS, r.kind, 'drug'), name: text(r.name), detail: text(r.detail) })),
    measures: rows('measures', r => ({ scale: text(r.scale), score: text(r.score) })),
  };
}

/** The row's main text: what the table shows first, and what is empty when the row is. */
export const headline = {
  medicalHistory: r => r.text,
  imaging: r => [label(MODALITIES, r.modality), r.region].filter(Boolean).join(' ') + (r.findings ? `: ${r.findings}` : ''),
  investigations: r => [r.test, r.value].filter(Boolean).join(' '),
  treatments: r => r.name + (r.detail ? ` (${r.detail})` : ''),
  measures: r => [r.scale, r.score].filter(Boolean).join(' '),
};
const filled = {
  medicalHistory: r => text(r.text), imaging: r => text(r.findings) || text(r.region) || r.files.length, investigations: r => text(r.test),
  treatments: r => text(r.name), measures: r => text(r.scale),
};
export const rowFilled = (list, r) => Boolean(filled[list](r));
export const countFilled = (rec, list) => rec[list].filter(r => rowFilled(list, r)).length;

/** A number as people write it: 9.1, 9,1 (a decimal comma), 14,200 (a thousands comma), −3. */
export const NUMBER = '[+-]?(?:\\d{1,3}(?:,\\d{3})+(?:\\.\\d+)?|\\d+(?:[.,]\\d+)?)';
export const numberOf = s => Number(/^[+-]?\d{1,3}(?:,\d{3})+(?:\.\d+)?$/.test(s) ? s.replace(/,/g, '') : s.replace(',', '.'));
/** A value as a number and a unit: "9.1 g/dL" → { value: 9.1, unit: 'g/dL' }; "<0.5 mg/L" keeps its comparator; anything else is null. */
export function quantityOf(v) {
  const m = new RegExp(`^([<>]=?|≤|≥)?\\s*(${NUMBER})\\s*(.*)$`).exec(text(v));
  if (!m) return null;
  return { comparator: m[1] || '', value: numberOf(m[2]), unit: m[3].trim() };
}

// ---- the timeline: episodes and rows together ------------------------------------------------------------------------------------------
const EVENT_CATEGORY = { medicalHistory: 'history', imaging: 'diagnostic', investigations: 'diagnostic', treatments: 'intervention', measures: 'followup' };
/**
 * Every dated moment of the case: the free episodes, then each row of the lists that has a time and something to say, as the timeline figure and
 * table draw them. Sorted when the times share one scale (dates, or days and weeks); otherwise the episodes as entered, then the rows by list.
 * Each event: { id, when, category, event, source } where source is a list name or 'episode'.
 */
export function caseEvents(c = {}) {
  const rec = recordOf(c), out = (Array.isArray(c.timeline) ? c.timeline : []).map(r => ({ ...r, source: 'episode' }));
  for (const list of LISTS) for (const r of rec[list]) if (r.when && rowFilled(list, r)) out.push({ id: r.id, when: r.when, category: EVENT_CATEGORY[list], event: headline[list](r), source: list });
  const { rows } = sortTimeline(out);
  return rows;
}

// ---- checks ---------------------------------------------------------------------------------------------------------------------------
/** Text in the lists that a person should look at before sharing: [{ list, id, text, where }], for the identifier scan. */
export function recordTexts(c = {}) {
  const rec = recordOf(c), out = [];
  const add = (list, r, where, ...parts) => { const t = parts.filter(Boolean).join('\n'); if (t) out.push({ field: `${list}:${r.id}`, where, text: t }); };
  rec.medicalHistory.forEach((r, i) => add('medicalHistory', r, `History, row ${i + 1}`, r.text, r.when));
  rec.imaging.forEach((r, i) => add('imaging', r, `Imaging, study ${i + 1}`, r.region, r.findings, r.when, ...r.files.map(f => `${f.name}\n${f.caption}`)));
  rec.investigations.forEach((r, i) => add('investigations', r, `Investigations, row ${i + 1}`, r.test, r.value, r.when));
  rec.treatments.forEach((r, i) => add('treatments', r, `Treatment, row ${i + 1}`, r.name, r.detail, r.when));
  rec.measures.forEach((r, i) => add('measures', r, `Outcome measures, row ${i + 1}`, r.scale, r.score, r.when));
  return out;
}

/** How many images are attached; they are never read for names, burned-in text or file headers. */
export const imageCount = c => recordOf(c).imaging.reduce((n, r) => n + r.files.length, 0);

// ---- tables for export ----------------------------------------------------------------------------------------------------------------
export const recordTables = c => {
  const rec = recordOf(c), safe = rows => rows.map((r, i) => (i ? r.map(csvSafe) : r));
  return Object.fromEntries(Object.entries({
    medicalHistory: [['when', 'category', 'text', 'status'], ...rec.medicalHistory.map(r => [r.when, label(HISTORY_CATEGORIES, r.category), r.text, label(HISTORY_STATUS, r.status)])],
    imaging: [['when', 'modality', 'region', 'findings', 'images'], ...rec.imaging.map(r => [r.when, r.modality, r.region, r.findings, r.files.length])],
    investigations: [['when', 'test', 'value', 'flag', 'reference', 'loinc'], ...rec.investigations.map(r => { const lab = findLab(r.test); return [r.when, r.test, r.value, label(FLAGS, r.flag), lab ? intervalText(lab, c.sex) : '', lab?.loinc || '']; })],
    treatments: [['when', 'kind', 'name', 'detail'], ...rec.treatments.map(r => [r.when, label(TREATMENT_KINDS, r.kind), r.name, r.detail])],
    measures: [['when', 'scale', 'score'], ...rec.measures.map(r => [r.when, r.scale, r.score])],
  }).map(([k, rows]) => [k, safe(rows)]));
};

const cellMd = v => String(v ?? '').replace(/\|/g, '\\|').replace(/\s*\n+\s*/g, ' ');
const mdTable = rows => rows.length < 2 ? '' : `| ${rows[0].join(' | ')} |\n| ${rows[0].map(() => '---').join(' | ')} |\n${rows.slice(1).map(r => `| ${r.map(cellMd).join(' | ')} |`).join('\n')}\n`;
/**
 * The case on one page of Markdown, in CARE order: the patient, the history, the timeline, imaging, investigations, treatment and outcomes as
 * tables, with the narrative fields beneath their headings. `sections` and `fields` come from lib/case-report.mjs (passed in: this file is below it).
 */
export function summaryMarkdown(c, { title = 'Case summary', phrase = '', sections = [], consent = '', events = null } = {}) {
  const rec = recordOf(c), t = recordTables(c), out = [`# ${title}\n`];
  if (phrase) out.push(`${phrase}\n`);
  const narrative = sec => sec.fields.filter(f => text(c[f.id]) && !['age', 'sex'].includes(f.id)).map(f => `**${f.label}.** ${text(c[f.id])}`).join('\n\n');
  const lists = { patient: ['medicalHistory', 'Medical history'], diagnosis: ['imaging', 'Imaging'], intervention: ['treatments', 'Treatment'], followup: ['measures', 'Outcome measures'] };
  for (const sec of sections) {
    const body = [];
    if (sec.id === 'timeline') {
      const ev = events || caseEvents(c);
      if (ev.length) body.push(mdTable([['When', 'Category', 'Event'], ...ev.map(e => [e.when, label([['history', 'Past history'], ['presentation', 'Presentation'], ['diagnostic', 'Diagnostic test'], ['intervention', 'Intervention'], ['followup', 'Follow-up'], ['adverse', 'Adverse event']], e.category), e.event])]));
    } else if (sec.id === 'consent') { if (consent) body.push(consent); }
    else {
      const n = narrative(sec); if (n) body.push(n);
      const [list, name] = lists[sec.id] || [];
      if (list && t[list].length > 1) body.push(`**${name}**\n\n${mdTable(t[list])}`);
      if (sec.id === 'diagnosis' && t.investigations.length > 1) body.push(`**Investigations**\n\n${mdTable(t.investigations)}`);
    }
    if (body.length) out.push(`## ${sec.name}\n\n${body.join('\n\n')}`);
  }
  return out.join('\n') + '\n';
}
