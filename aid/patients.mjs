import { durableAction } from '../lib/aid-proposals.mjs';
// Model actions for the patient data view (lib/aid.mjs).
//
// Patient rows are data an analysis will pool, so a model-read row carries
// only numbers the text it was read from contains, and is marked model-read
// when a person adds it. Checking the rows is mostly arithmetic and lookup,
// done here in code; the model is asked only about what rules cannot see.
import { register, SYSTEM_GUARD, jsonOf, quoteIn } from '../lib/aid.mjs';
import { complete } from '../lib/ai.mjs';
import { promptRef } from '../lib/prompts.mjs';
import * as P from '../lib/prompts-views.mjs';
import { parsePatients } from '../lib/helpers.mjs';
import { get } from '../store.mjs';
import * as ipd from '../lib/ipd.mjs';
import { unsupported } from '../lib/numbers.mjs';

const labelOf = (s, id) => (s.papers || []).find(p => p.id === id)?.label || '';
const rowName = (s, p) => [labelOf(s, p.study_id), p.label || p.id].filter(Boolean).join(', ');

/**
 * The study rows read from a selection belong to. The view's own "Parse text"
 * asks, defaulting to the first included study; here the context answers
 * first: the document the text was selected in, then the study of the row in
 * focus, then that same default.
 */
export function studyFor(s, context = {}) {
  const has = id => id && (s.papers || []).some(p => p.id === id);
  if (has(context.document?.paperId)) return context.document.paperId;
  if (has(context.focus?.paperId)) return context.focus.paperId;
  const included = (s.papers || []).filter(p => (s.fulltext?.[p.id] || s.screening?.[p.id])?.decision === 'include');
  return (included[0] || (s.papers || [])[0])?.id ?? null;
}

/** The line of the source that names a row's patient, when one does. */
function lineFor(values, source) {
  if (!values.label) return '';
  const line = String(source).split(/\n/).map(l => l.trim()).find(l => l.toLowerCase().includes(String(values.label).toLowerCase()));
  return line && quoteIn(line, source) ? line.slice(0, 300) : '';
}

// Words that state an event, or its absence, in a case description. An
// event flag no such word in the row's text supports is a guess.
const EVENT_WORDS = /\b(?:died|death|dead|deceased|recurr\w*|relaps\w*|progress\w*|event|failure|failed|metasta\w*)\b/i;
const CENSOR_WORDS = /\b(?:alive|censored|event[- ]free|disease[- ]free|progression[- ]free|recurrence[- ]free|stable|no evidence of (?:disease|recurrence|progression)|(?:no|without|free of)\s+(?:\w+\s+){0,2}(?:recurr\w*|relaps\w*|progress\w*|event|death|disease))\b/i;

/** Whether the text for a row states the event value the model gave it. */
export function eventSupported(value, text) {
  const t = String(text || ''), v = String(value).trim();
  if (/^(?:1|yes|y|true)$/i.test(v)) return EVENT_WORDS.test(t.replace(new RegExp(CENSOR_WORDS.source, 'gi'), ' '));
  if (/^(?:0|no|n|false)$/i.test(v)) return CENSOR_WORDS.test(t);
  return false;
}

/**
 * Rows as they will be stored: booleans as the 1/0 the table's selects use,
 * everything else as text. A row holding a number the source text does not is
 * rejected whole, since a patient with one invented value is a wrong patient.
 * An event flag the row's text does not state is left empty, the row kept,
 * and counted in `unstated`.
 */
export function vetRows(rows, cols, source) {
  const kept = [];
  let dropped = 0, unstated = 0;
  for (const r of rows) {
    const values = {};
    for (const c of cols) {
      const v = r[c.id];
      if (v == null || String(v).trim() === '') continue;
      values[c.id] = c.type === 'boolean' && typeof v === 'boolean' ? (v ? '1' : '0') : String(v).trim();
    }
    const nums = cols.filter(c => c.type !== 'boolean' && values[c.id] != null).map(c => values[c.id]).join(' ');
    if (!Object.keys(values).length || unsupported(nums, source).length) { dropped++; continue; }
    // The row's own line when the label finds one; otherwise the whole source.
    const text = lineFor(values, source) || source;
    for (const c of cols.filter(c => c.type === 'boolean' && c.role === 'event' && values[c.id] != null)) {
      if (!eventSupported(values[c.id], text)) { delete values[c.id]; unstated++; }
    }
    kept.push(values);
  }
  return { kept, dropped, unstated };
}

const isAge = c => c.type === 'number' && (/^age$/i.test(c.id) || /\bage\b/i.test(c.name));
// A second time column (to progression, to death) cannot exceed follow-up.
const isEventTime = (c, time) => c !== time && c.type === 'number' && /time|months? to|interval/i.test(`${c.id} ${c.name}`) && !/follow/i.test(c.name);

/** Impossible or conflicting values the rules can find, each naming its row. */
export function mechanicalFindings(s, rows = ipd.participants(), cols = ipd.columns()) {
  const out = [];
  const time = cols.find(c => c.role === 'time');
  const add = (p, problem, detail) => out.push({ label: `${rowName(s, p)}: ${problem}`, detail: `Row ${p.id}${detail ? `: ${detail}` : ''}`,
    ...(p.study_id && labelOf(s, p.study_id) ? { where: { paperId: p.study_id, label: labelOf(s, p.study_id) } } : {}) });
  const seen = new Map();
  for (const p of rows) {
    for (const c of cols) {
      const raw = p[c.id];
      if (raw == null || String(raw).trim() === '') continue;
      const n = ipd.numeric(p, c.id);
      if (c.type === 'number' && (n == null || !/^\s*[-+]?\d/.test(String(raw)))) add(p, `${c.name} not a number`, `"${raw}"`);
      else if (c.type === 'number' && n < 0 && (c === time || isAge(c) || isEventTime(c, time))) add(p, `${c.name} negative`, String(raw));
      else if (isAge(c) && n > 120) add(p, `${c.name} out of range`, String(raw));
      if (c.type === 'category' && c.levels?.length && !c.levels.includes(String(raw).trim())) add(p, `${c.name} not a listed level`, `"${raw}"; levels ${c.levels.join(', ')}`);
      if (c.type === 'boolean' && ipd.boolish(p, c.id) == null) add(p, `${c.name} not yes or no`, `"${raw}"`);
    }
    if (time) {
      const fu = ipd.numeric(p, time.id);
      for (const c of cols.filter(c => isEventTime(c, time))) {
        const t = ipd.numeric(p, c.id);
        if (fu != null && t != null && t > fu) add(p, `${c.name} longer than ${time.name}`, `${p[c.id]} against ${p[time.id]}`);
      }
    }
    if (p.label) {
      const key = `${p.study_id}|${String(p.label).trim().toLowerCase()}`;
      if (seen.has(key)) add(p, 'same patient label twice in one study', `also row ${seen.get(key)}`);
      else seen.set(key, p.id);
    }
  }
  return out;
}

/** The rows as a compact table for a prompt. */
function tableOf(s, rows, cols) {
  return [['row', 'study', ...cols.map(c => c.id)].join('\t'),
    ...rows.map(p => [p.id, labelOf(s, p.study_id), ...cols.map(c => String(p[c.id] ?? '').replace(/\s+/g, ' '))].join('\t'))].join('\n');
}

/** Keeps the model's findings that name a real row, column and the value it holds. */
export function vetFindings(list, s, rows, cols, material) {
  const byId = new Map(rows.map(p => [p.id, p]));
  const colIds = new Set(cols.map(c => c.id));
  const kept = [];
  let dropped = 0;
  for (const f of list || []) {
    const p = byId.get(String(f?.row || ''));
    const ok = p && colIds.has(f.column) && String(p[f.column] ?? '').trim().toLowerCase() === String(f.value ?? '').trim().toLowerCase()
      && f.problem && !unsupported(String(f.problem), material).length;
    if (!ok) { dropped++; continue; }
    const c = cols.find(x => x.id === f.column);
    kept.push({ label: `${rowName(s, p)}: ${String(f.problem).slice(0, 160)}`, detail: `Row ${p.id}: ${c.name} ${p[c.id]}`,
      ...(p.study_id && labelOf(s, p.study_id) ? { where: { paperId: p.study_id, label: labelOf(s, p.study_id) } } : {}) });
  }
  return { kept, dropped };
}

const proposePatient = durableAction('patient', ({ study, studyLabel, values, extractor }) => {
  // Marked model-read, as extraction marks a value read from an abstract.
  ipd.addParticipant(study, { ...values, extractor, verification: 'accepted', at: new Date().toISOString() });
  return studyLabel ? `Added to ${studyLabel}` : 'Added';
});

register('patients', [
  {
    id: 'read-selection',
    label: 'Read patients from selection',
    icon: 'patients',
    task: 'extract',
    when: (s, ctx) => !!String(ctx?.selection || '').trim(),
    async run({ cfg, signal, brief, selection, context }) {
      const s = get();
      const cols = ipd.columns();
      const rows = await parsePatients(selection, cols, cfg, { signal, guard: SYSTEM_GUARD, brief });
      const { kept, dropped, unstated } = vetRows(rows, cols, selection);
      // The page the selection sits on, which may not be the page in view.
      const page = context?.document?.selectionPage ?? context?.document?.page;
      const study = studyFor(s, context);
      const studyLabel = labelOf(s, study);
      const extractor = `model:${cfg.model || 'unknown'}`;
      return {
        title: 'Patients from selection',
        note: [!rows.length && 'No patients in the selection', dropped && `${dropped} dropped for numbers not in the selection`,
          unstated && `${unstated} event ${unstated === 1 ? 'value' : 'values'} left empty: not stated in the selection`].filter(Boolean).join('; '),
        items: kept.map(values => ({
          label: [values.label, ...cols.filter(c => c.id !== 'label' && values[c.id] != null)
            .map(c => `${c.name} ${c.type === 'boolean' ? (values[c.id] === '1' ? 'yes' : 'no') : values[c.id]}`)].filter(Boolean).join(', '),
          detail: studyLabel ? `To ${studyLabel}` : 'No study',
          ...(lineFor(values, selection) ? { quote: lineFor(values, selection) } : {}),
          ...(study && context?.document?.paperId === study ? { where: { paperId: study, ...(page != null ? { locator: { page } } : {}), label: page != null ? `${studyLabel}, p. ${page}` : studyLabel } } : {}),
          acceptLabel: 'Add patient',
          ...proposePatient({ study, studyLabel, values, extractor }),
        })),
      };
    },
  },
  {
    id: 'check-rows',
    label: 'Check rows for inconsistencies',
    icon: 'patients',
    task: 'assist',
    when: () => ipd.participants().length > 0,
    async run({ cfg, signal, brief }) {
      const s = get();
      const rows = ipd.participants().slice(0, 300);
      const cols = ipd.columns();
      const found = mechanicalFindings(s, rows, cols);
      const table = tableOf(s, rows, cols).slice(0, 30000);
      const out = await complete(cfg, P.messagesOf(P.patientsCheck, { brief, table,
        columns: cols.map(c => `${c.id}: ${c.name} (${c.type}${c.levels ? `: ${c.levels.join(' | ')}` : ''}${c.role ? `; ${c.role}` : ''})`).join('\n'),
        found: found.map(f => `- ${f.label}`).join('\n') }),
      { prompt: P.patientsCheck, signal, temperature: 0, json: true });
      const { kept, dropped } = vetFindings(jsonOf(out).findings, s, rows, cols, table);
      const items = [...found, ...kept];
      return {
        title: 'Row checks',
        prompt: promptRef(P.patientsCheck),
        items,
        note: [ipd.participants().length > rows.length && `First ${rows.length} rows checked`, dropped && `${dropped} dropped for naming no real cell`,
          !items.length && 'No inconsistencies'].filter(Boolean).join('; '),
      };
    },
  },
]);
