// Light model assistance, spent carefully.
//
// The configured model is a metered service. Every call here is bounded:
// short instructions, a hard cap on output tokens, temperature 0, and JSON
// out — one request per action, never a loop. The model proposes; nothing it
// returns changes the project until a person accepts it (plan §6).
import { complete, configured } from './ai.mjs';
import { availabilityCounts, pdfRank } from './library-records.mjs';
import { TASKS_DETECT, TEXT_REVISE, SCREEN_ASSESS, fence, detailWords } from './prompts.mjs';
import { clipAbstract } from './text-clip.mjs';
import { quoteFound } from './quotes.mjs';
import { get } from '../store.mjs';

/** The kinds of work the app can act on, with the view that does it. */
export const TASK_KINDS = {
  search:     { label: 'Search for records',      view: 'search' },
  cite:       { label: 'Add a citation',          view: 'manuscript' },
  review:     { label: 'Screen or appraise',      view: 'screening' },
  extract:    { label: 'Extract data',            view: 'extraction' },
  patients:   { label: 'Add patient data',        view: 'patients' },
  analyse:    { label: 'Run an analysis',         view: 'analysis' },
  write:      { label: 'Write or revise text',    view: 'manuscript' },
  report:     { label: 'Reporting',               view: 'reporting' },
  schedule:   { label: 'Schedule a search',       view: 'search' },
  todo:       { label: 'To do',                   view: 'overview' },
};

// ---- local detection: no model, no tokens, instant ------------------------
// Each kind has weighted patterns; a verb at the start of the sentence is
// worth more than a noun in the middle. The best score wins; below the floor
// the sentence is a plain to-do. Study labels ("Brat 1998") in the sentence
// become the task's target; quoted text or the words after "for/on/about"
// become its query.
const KIND_RULES = {
  schedule: [[/^\s*(schedule|set up)\b/i, 2], [/\b(every|each)\s+(day|week|month)\b|\b(daily|weekly|monthly)\b/i, 2]],
  search:   [[/^\s*(search|find|look\s*up|query)\b/i, 2], [/\b(search|pubmed|europe\s*pmc|crossref|openalex)\b/i, 1]],
  cite:     [[/^\s*(cite|reference)\b/i, 2], [/\b(citation|citations|references?|ref)\b/i, 1]],
  patients: [[/^\s*(add|enter|import)\b[^.]*\b(patient|ipd|case|participant)s?\b/i, 2], [/\b(patients?|ipd|cases?|participants?)\b/i, 1]],
  extract:  [[/^\s*extract\b/i, 2], [/\bextract/i, 1]],
  review:   [[/^\s*(screen|appraise|assess)\b/i, 2], [/\b(screen(ing)?|apprais\w*|risk of bias|rob|eligib\w*)\b/i, 1]],
  analyse:  [[/^\s*(run|pool|analy[sz]e|fit)\b/i, 2], [/\b(meta-?analys\w*|forest plot|kaplan|survival|analysis|pooled|regression|hazard)\b/i, 1]],
  write:    [[/^\s*(write|draft|revise|rewrite|edit|proofread|reword)\b/i, 2], [/\b(paragraph|section|abstract|introduction|discussion|methods|results)\b/i, 1]],
  report:   [[/^\s*(check|fill|complete)\b[^.]*\b(prisma|checklist|report)/i, 2], [/\b(prisma|flow ?diagram|checklist|reporting)\b/i, 1]],
};
const FLOOR = 1;

/** Kinds a sentence could be, best first: `[[kind, score], ...]`. */
export function scoreKinds(sentence) {
  const out = [];
  for (const [kind, pats] of Object.entries(KIND_RULES)) {
    const score = pats.reduce((a, [re, w]) => a + (re.test(sentence) ? w : 0), 0);
    if (score) out.push([kind, score]);
  }
  return out.sort((a, b) => b[1] - a[1]);
}
const kindOf = sentence => { const [top] = scoreKinds(sentence); return top && top[1] >= FLOOR ? top[0] : 'todo'; };
const INTERVAL_OF = t => /\b(daily|every day|each day)\b/i.test(t) ? 'daily' : /\b(monthly|every month|each month)\b/i.test(t) ? 'monthly' : 'weekly';

function sentences(note) {
  return String(note || '').split(/\n+|;|(?<=[.!?])\s+|\b(?:and then|then)\b/i)
    .map(s => s.replace(/^[\s\-*•\d.)]+/, '').trim()).filter(s => s.length > 2).slice(0, 12);
}

const NO_INTERVAL = t => t.replace(/\b(every|each)\s+(day|week|month)\b|\b(daily|weekly|monthly)\b/ig, '').replace(/\s+/g, ' ').replace(/[.!?,\s]+$/, '').trim();
function queryOf(sentence) {
  const q = sentence.match(/["“”']([^"“”']{3,})["“”']/);
  if (q) return q[1].trim();
  const m = sentence.match(/\b(?:for|on|about|regarding|of|:)\s+(.{3,})$/i);
  if (m) return NO_INTERVAL(m[1]);
  return sentence.replace(/^(please\s+)?(search|find|look\s*up|query|add|import|get|cite|schedule|run)\b\s*(a|an|the|new|more|some)?\s*(search|papers?|records?|studies|citations?|references?)?\s*(for|on|about|in)?\s*/i, '')
    .replace(/\b(every|each)\s+(day|week|month)\b|\b(daily|weekly|monthly)\b/ig, '').replace(/\s+/g, ' ').replace(/[.!?]+$/, '').trim();
}

const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
/** A due date a sentence names — "by Friday", "tomorrow", "in 3 days", "next week", "on 25 Sep" — as YYYY-MM-DD. */
export function dueOf(sentence, now = new Date()) {
  const t = String(sentence || '').toLowerCase();
  const d = new Date(now); d.setHours(12, 0, 0, 0);
  const iso = x => x.toISOString().slice(0, 10);
  let m;
  if (/\btoday\b/.test(t)) return iso(d);
  if (/\btomorrow\b/.test(t)) { d.setDate(d.getDate() + 1); return iso(d); }
  if ((m = t.match(/\bin\s+(\d{1,2})\s+(day|week)s?\b/))) { d.setDate(d.getDate() + (+m[1]) * (m[2] === 'week' ? 7 : 1)); return iso(d); }
  if (/\bnext week\b/.test(t)) { d.setDate(d.getDate() + ((8 - d.getDay()) % 7 || 7)); return iso(d); }
  if (/\bend of (the )?week\b/.test(t)) { d.setDate(d.getDate() + ((5 - d.getDay() + 7) % 7)); return iso(d); }
  if ((m = t.match(/\b(?:by|on|before|until|till|this|next)?\s*(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/))) {
    let diff = (DAYS.indexOf(m[1]) - d.getDay() + 7) % 7; if (diff === 0 || /\bnext\b/.test(m[0])) diff += 7;
    d.setDate(d.getDate() + diff); return iso(d);
  }
  const MON = 'jan feb mar apr may jun jul aug sep oct nov dec'.split(' ');
  if ((m = t.match(/\b(\d{1,2})\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b/)) || (m = t.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+(\d{1,2})\b/))) {
    const day = +(m[1].length <= 2 ? m[1] : m[2]), mon = MON.indexOf((m[1].length <= 2 ? m[2] : m[1]).slice(0, 3));
    const x = new Date(d.getFullYear(), mon, day, 12); if (x < d) x.setFullYear(x.getFullYear() + 1); return iso(x);
  }
  if ((m = t.match(/\b(20\d{2})-(\d{2})-(\d{2})\b/))) return m[0];
  return '';
}

function taskFrom(sent, kind, target) {
  const t = { kind, text: sent.charAt(0).toUpperCase() + sent.slice(1, 200), query: '', target: target ? { id: target.id, label: target.label } : null };
  if (kind === 'search' || kind === 'schedule' || (kind === 'cite' && !target)) t.query = queryOf(sent).slice(0, 200);
  if (kind === 'schedule') t.interval = INTERVAL_OF(sent);
  const due = dueOf(sent); if (due) t.due = due;
  return t;
}
const labelIn = (papers, sent) => papers.find(p => p.label && sent.toLowerCase().includes(p.label.toLowerCase()));

/** Tasks found by rule, with the project's own studies as targets. */
export function parseTasks(note, s = {}) {
  const papers = s.papers || [];
  const out = [];
  for (const sent of sentences(note)) {
    const t = taskFrom(sent, kindOf(sent), labelIn(papers, sent));
    if (!out.some(x => x.kind === t.kind && x.text === t.text)) out.push(t);
  }
  return out;
}

/** Conservative chat actions: questions and library lookups are answered in chat.
 * Nouns alone never create work, and a classifier cannot override this gate. */
export function assistantTasks(note, state = {}) {
  return sentences(note).flatMap(sentence => {
    if (/^(?:can|could|would|will) you\b/i.test(sentence) && /\b(?:if|when|once)\b/i.test(sentence)) return [];
    const text = sentence.replace(/^(?:(?:can|could|would|will) you\s+|please\s+|I (?:want|need) you to\s+)+/i, '').trim();
    if (/^(?:add|import|save|create)\b.*\b(?:citation|reference|paper|article|publication)\b/i.test(text)) return [];
    if (!/^(search|find|look up|query|schedule|set up|cite|reference|screen|appraise|assess|extract|add|enter|import|run|pool|analy[sz]e|fit|write|draft|revise|rewrite|edit|proofread|reword|check|fill|complete)\b/i.test(text)) return [];
    if (/\b(?:do not|don't|never|not yet|without)\b/i.test(text)) return [];
    const task = parseTasks(text, state)[0];
    if (!task || task.kind === 'todo') return [];
    if (['search', 'schedule'].includes(task.kind)) {
      if (/\b(?:pdfs?|full[ -]?texts?|previews?|duplicates?|missing|lack|unavailable|unresolved|attached|saved|my library|our library|this library)\b/i.test(text)) return [];
      if (!task.query || task.query === text.replace(/[.!?]+$/, '') || /^(?:the )?(?:records?|papers?|studies|articles?)(?: this review still needs)?$/i.test(task.query)) return [];
    }
    return [task];
  });
}

export function paperAccessContext(p) {
  return p.pdf ? 'saved PDF attached' : pdfRank(p) === 2 ? 'PDF preview available (not saved)' : p.pdfRetrieval?.status === 'unavailable' ? 'last PDF retrieval attempt failed; availability unresolved' : 'PDF availability not checked';
}
export function libraryAccessContext(papers = []) {
  const counts = availabilityCounts(papers);
  const attached = papers.filter(p => p.pdf).length;
  const unresolved = papers.filter(p => pdfRank(p) < 2);
  return `Library access (whole library, ${papers.length} records): ${attached} saved PDFs attached; ${counts.available - attached} additional PDF previews available without a saved attachment; ${counts.available} total with known PDF access; ${counts.unresolved} last attempts failed; ${counts.unchecked} not checked. Failed or unchecked does not mean no full text exists.\nRecords without confirmed PDF access (${unresolved.length}; ${Math.min(20, unresolved.length)} listed): ${unresolved.slice(0, 20).map(p => `${p.label || p.title || p.id} [${paperAccessContext(p)}]`).join('; ') || 'none'}`;
}

// ---- Jev: the same sentences, classified in one call -----------------------
const KIND_DESC = {
  search: 'Find or import records from a bibliographic database', schedule: 'Run a search again on a recurring basis',
  cite: 'Insert a citation or reference', review: 'Screen records or appraise a study', extract: 'Extract data from a study',
  patients: 'Add or edit individual patient data', analyse: 'Run a statistical analysis or meta-analysis', write: 'Write or revise manuscript text',
  report: 'Complete reporting items such as PRISMA', todo: 'None of the above',
};
const P_KIND = 0.6, P_ACT = 0.5;

/**
 * Tasks a note implies, classified by the decision model. Kind, whether the
 * sentence asks for anything, and which study it names come from Jev;
 * query, interval and due date from the rules. A weak kind falls back to
 * the rules. Throws only when the call itself fails; the caller then uses
 * parseTasks.
 */
export async function classifyTasks(note, s = {}, cfg, { signal, decideImpl } = {}) {
  const { decide } = await import('./jev.mjs');
  const call = decideImpl || decide;
  const papers = (s.papers || []).filter(p => p.label).slice(0, 40);
  const sents = sentences(note);
  if (!sents.length) return [];
  const questions = {};
  const labels = Object.fromEntries(papers.map(p => [p.label, null]));
  sents.forEach((text, i) => {
    questions[`k${i}`] = { type: 'choice', instructions: `What kind of work does sentence ${i} ask for?`, criteria: KIND_DESC };
    questions[`a${i}`] = { type: 'noul', instructions: `Sentence ${i} asks for something to be done` };
    if (papers.length) questions[`t${i}`] = { type: 'choice', instructions: `Which study does sentence ${i} name?`, criteria: { ...labels, none: 'No study is named' } };
  });
  const a = await call(cfg, { sentences: sents.map((text, i) => ({ i, text })) }, questions, { signal });
  const out = [];
  sents.forEach((sent, i) => {
    const act = Number(a[`a${i}`]?.noul ?? 1); if (act < P_ACT) return;
    const k = a[`k${i}`]; const p = Number(k?.probabilities?.[k?.choice] ?? k?.confidence ?? 0);
    const kind = TASK_KINDS[k?.choice] && p >= P_KIND ? k.choice : kindOf(sent);
    const tl = a[`t${i}`]?.choice; const target = (tl && tl !== 'none' && papers.find(p2 => p2.label === tl)) || labelIn(papers, sent);
    const t = { ...taskFrom(sent, kind, target), p: Math.round(p * 100) / 100, actionable: Math.round(act * 100) / 100 };
    if (!out.some(x => x.kind === t.kind && x.text === t.text)) out.push(t);
  });
  return out;
}

/** Whether a message asks for an action: Jev when there is a profile, else the rules. */
export async function isActionable(text, cfg, { signal, decideImpl } = {}) {
  const { decide, isJev } = await import('./jev.mjs');
  if (!(decideImpl || (isJev(cfg) && configured(cfg)))) return kindOf(String(text || '')) !== 'todo';
  try {
    const a = await (decideImpl || decide)(cfg, { message: String(text || '').slice(0, 2000) }, { act: { type: 'noul', instructions: 'The message asks for something to be done in the review' } }, { signal });
    return Number(a.act?.noul ?? 0) >= P_ACT;
  } catch { return kindOf(String(text || '')) !== 'todo'; }
}

/** What the model is told about the project: a few numbers and the study labels, nothing more. */
export function projectContext(s = {}) {
  const papers = s.papers || [];
  const sc = s.screening || {}, ft = s.fulltext || {};
  const tally = map => { const t = { include: 0, exclude: 0, uncertain: 0 }; for (const d of Object.values(map)) if (d?.decision in t) t[d.decision]++; return t; };
  const ta = tally(sc), fx = tally(ft);
  const finalOf = p => (ft[p.id] || sc[p.id])?.decision;
  const included = papers.filter(p => finalOf(p) === 'include');
  const pr = s.proposals?.ta || {};
  const proposed = Object.values(pr).length;
  const pt = { include: 0, exclude: 0, uncertain: 0 }; for (const x of Object.values(pr)) if (x?.verdict in pt) pt[x.verdict]++;
  const p = s.protocol || {};
  const crit = (p.criteria || []);
  const vals = Object.values(s.values || {});
  const fieldsPer = new Map(); for (const v of vals) fieldsPer.set(v.paper_id, (fieldsPer.get(v.paper_id) || 0) + 1);
  const assessed = Object.keys(s.assessments || {}).length;
  const words = (s.manuscript?.blocks || []).reduce((n, b) => n + String(b.text || '').split(/\s+/).filter(Boolean).length, 0);
  const lines = [
    libraryAccessContext(papers),
    `Project: ${s.project?.name || s.paper?.title || p.title || 'untitled'}; type: ${s.project?.mode || 'systematic review'}`,
    p.population || p.intervention ? `PICO: P ${p.population || '?'}; I ${p.intervention || '?'}; C ${p.comparator || '?'}; O ${p.outcome || '?'}${p.designs ? `; designs ${p.designs}` : ''}` : 'PICO: not written',
    crit.length ? `Criteria (${crit.length}): ${crit.map(c => `${c.id}${c.kind === 'exclude' ? ' excl' : c.kind === 'group' ? ' group' : ''}: ${String(c.text).slice(0, 90)}`).join(' | ')}` : 'Criteria: none yet',
    `Records: ${papers.length}. Title/abstract: ${ta.include} included, ${ta.exclude} excluded, ${ta.uncertain} uncertain, ${papers.filter(p => !sc[p.id]).length} not screened. Full text: ${fx.include} included, ${fx.exclude} excluded, ${fx.uncertain} uncertain.`,
    proposed ? `Decision-model proposals (title/abstract): ${proposed} records — ${pt.include} include, ${pt.uncertain} uncertain, ${pt.exclude} exclude` : '',
    `Included studies (${included.length}): ${included.map(p => p.label).filter(Boolean).slice(0, 40).join(', ') || 'none yet'}`,
    `Extraction: ${vals.length} values over ${fieldsPer.size} studies${included.length ? `; without any value: ${included.filter(p => !fieldsPer.has(p.id)).map(p => p.label).slice(0, 12).join(', ') || 'none'}` : ''}`,
    `Appraisal: ${assessed} studies assessed${s.appraisalTool ? ` (${s.appraisalTool})` : ''}. Analysis: ${s.analysis ? `pooled ${s.analysis.measure} over ${s.analysis.k} studies` : 'none'}. Patients on record: ${(s.participants || s.patients || []).length}.`,
    `Manuscript: ${words} words in ${(s.manuscript?.blocks || []).length} paragraphs. To do open: ${(s.todos || []).filter(t => !t.done).length}.`,
  ];
  return lines.filter(Boolean).join('\n').slice(0, 5000);
}

const VERB = { search: 'Search', schedule: 'Schedule', cite: 'Cite', review: 'Screen', extract: 'Extract', patients: 'Patients', analyse: 'Analyse', write: 'Write', report: 'Report', todo: 'Add' };
/** What a task row's button does, named: "Screen 6", "Search", "Add". */
export function actionLabel(t, s = {}) {
  const v = VERB[t.kind] || VERB.todo;
  if (t.kind === 'review' && s.papers?.length) {
    const n = s.papers.filter(p => { const d = s.screening?.[p.id]; return !d || d.decision === 'uncertain'; }).length;
    return n ? `${v} ${n}` : v;
  }
  return v;
}

// ---- any text model: the note read in one bounded call -----------------
/**
 * Tasks a note implies. Throws when no model is configured, so the caller can
 * say so rather than pretend. Returns [] for a note with nothing actionable.
 */
export async function detectTasks(note, cfg, { signal, state = null } = {}) {
  if (!configured(cfg)) throw new Error('No model configured');
  const text = String(note || '').trim().slice(0, 2000);   // a note, not a manuscript
  if (!text) return [];
  const papers = state?.papers || [];
  const out = await complete(cfg, [
    { role: 'system', content: TASKS_DETECT.text },
    ...(state ? [{ role: 'system', content: `Project context:\n${projectContext(state)}` }] : []),
    { role: 'user', content: fence('note', text) },
  ], { signal, temperature: 0, json: true, prompt: TASKS_DETECT });
  const json = out.match(/\{[\s\S]*\}/)?.[0];
  if (!json) return [];
  let parsed;
  try { parsed = JSON.parse(json); } catch { return []; }
  return (parsed.tasks || [])
    .filter(t => t && TASK_KINDS[t.kind] && t.text)
    .slice(0, 8)
    .map(t => {
      const target = t.target ? papers.find(p => p.label && p.label.toLowerCase() === String(t.target).toLowerCase()) : null;
      return { kind: t.kind, text: String(t.text).slice(0, 200), query: String(t.query || '').slice(0, 200),
        target: target ? { id: target.id, label: target.label } : null,
        interval: ['daily', 'weekly', 'monthly'].includes(t.interval) ? t.interval : 'weekly' };
    });
}

/** Rough size of a call, so the interface can say what it is about to spend. */
export const estimateTokens = text => Math.ceil(String(text || '').length / 4) + 120;


/**
 * A revised paragraph (J3 "Language"). Bounded to the paragraph's own length
 * plus a margin; the caller shows the difference and the person decides.
 */
export async function reviseParagraph(text, cfg, { signal, instructions = '' } = {}) {
  if (!configured(cfg)) throw new Error('No model configured');
  const t = String(text || '').trim();
  if (!t) return '';
  const guide = String(instructions || '').trim().slice(0, 1200);
  const out = await complete(cfg, [
    { role: 'system', content: TEXT_REVISE.text },
    { role: 'user', content: guide ? `Paragraph:\n${fence('paragraph', t.slice(0, 4000))}\n\nAdditional author instructions:\n${guide}` : fence('paragraph', t.slice(0, 4000)) },
  ], { signal, temperature: 0, maxTokens: Math.min(1200, Math.ceil(t.length / 3) + 80), prompt: TEXT_REVISE });
  return out.trim();
}

/** Word-level difference of two texts, for showing what a revision changes. */
export function diffWords(a, b) {
  const A = String(a).split(/(\s+)/), B = String(b).split(/(\s+)/);
  const n = A.length, m = B.length;
  const dp = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--)
    dp[i][j] = A[i] === B[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const out = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (A[i] === B[j]) { out.push({ same: A[i] }); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { out.push({ del: A[i] }); i++; }
    else { out.push({ ins: B[j] }); j++; }
  }
  while (i < n) out.push({ del: A[i++] });
  while (j < m) out.push({ ins: B[j++] });
  return out;
}


/** Title and abstract as a screener sees them, the abstract cut at a sentence end (its background first when it is structured). */
export const recordText = record => `Title: ${record.title || ''}\nAbstract: ${clipAbstract(record.abstract || '', 2500) || '(none)'}`;

/**
 * What the model said, as a screening proposal. The reply lists only the
 * criteria not clearly met; the rest are met. A "no" must quote the record
 * (the source is the title and abstract the model was given) and one that does
 * not is kept as "unclear", so a claim that cannot be checked never excludes.
 * The verdict is then made to agree with what survived: an exclusion needs a
 * checked "no", an inclusion needs no "no" and no "unclear".
 */
export function parseAssessment(reply, criteria, source) {
  const ids = new Set(criteria.map(c => String(c.id)));
  const list = Array.isArray(reply?.issues) ? reply.issues : Array.isArray(reply?.criteria) ? reply.criteria.filter(c => c && c.met !== 'yes') : [];
  const issues = new Map();
  for (const c of list) {
    const id = String(c?.id ?? ''); if (!ids.has(id) || issues.has(id)) continue;
    let met = c.met === 'no' ? 'no' : 'unclear';
    const quote = String(c.quote || '').replace(/\s+/g, ' ').trim().slice(0, 300);
    let note = String(c.note || '').slice(0, 120);
    if (met === 'no' && !(quote && quoteFound(quote, source))) { met = 'unclear'; note = note ? `${note} (no quote in record)` : 'no quote in record'; }
    issues.set(id, { id, met, note, ...(quote && met === 'no' ? { quote } : {}) });
  }
  const said = ['include', 'exclude', 'uncertain'].includes(reply?.verdict) ? reply.verdict : 'uncertain';
  const anyNo = [...issues.values()].some(i => i.met === 'no');
  const verdict = said === 'exclude' ? (anyNo ? 'exclude' : 'uncertain') : said === 'include' ? (issues.size ? 'uncertain' : 'include') : 'uncertain';
  // With every criterion listed only when it is not met, "met" is what the reply left out: stated for an inclusion,
  // and for an exclusion or an uncertain verdict too, since the model examined each criterion.
  const met = criteria.map(c => issues.get(String(c.id)) || { id: String(c.id), met: 'yes', note: '' });
  return { verdict, criteria: met };
}

/**
 * A screening proposal for one record (plan §6: proposals only). One call:
 * the criteria sit in the system prompt, so the request's opening is the same
 * for every record of a batch and a provider's prefix cache can serve it; the
 * record comes last. The abstract is cut at a sentence end, not summarised.
 */
export async function assessRecord(record, criteria, cfg, { signal } = {}) {
  if (!configured(cfg)) throw new Error('No model configured');
  const words = detailWords(get().settings?.aiDetail);
  const crit = criteria.map(c => `${c.id}: ${c.text}`).join('\n');
  const text = recordText(record);
  const out = await complete(cfg, [
    { role: 'system', content: SCREEN_ASSESS.text({ criteria: crit, words }) },
    { role: 'user', content: fence('record', text) },
  ], { signal, temperature: 0, json: true, prompt: SCREEN_ASSESS,
    // the answer lists only what is not met; the cap still leaves room for a reasoning model to think first
    maxTokens: SCREEN_ASSESS.maxTokens + 40 * Math.min(criteria.length, 25) });
  const json = out.match(/\{[\s\S]*\}/)?.[0];
  if (!json) throw new Error('No assessment returned');
  return parseAssessment(JSON.parse(json), criteria, text);
}
