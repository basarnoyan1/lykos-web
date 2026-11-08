// A paper from one question (owner, 2026-10-22: "from a very simple question to it decided journal, it detected the required formats,
// it made all the necessary files like manuscript tables figures ... and filled all the necessary fields in the app. Of course it should
// ask if it should continue, like any other AI agent assistant").
//
// The run is the app's, not the model's: its stages are fixed here, each a chat turn the person starts. A stage opens its page, and the
// assistant works there with the tools it has (writes in the manuscript as tracked changes, everything else in Proposals); when the turn
// ends the stage waits, and the card over the composer says what the project now holds, read from the project, not from the answer. The
// person continues, does the stage again, skips the next, or stops. Nothing moves to the next stage without them.
import { standingFacts } from './overview-facts.mjs';

const clip = (v, n) => { const t = String(v ?? '').replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export const KINDS = ['systematic review', 'meta-analysis', 'scoping review'];

/** The stages, in order: the page each works in, what it is for, the tool groups it loads, and its brief. */
export const STAGES = [
  { id: 'protocol', page: 'protocol', title: 'Question and protocol', groups: ['changes'],
    brief: 'Turn the question into the protocol with set_protocol, one field at a time: title, population, intervention, comparator, outcome (the primary outcome first, then the secondary ones) and designs. Then the criteria with edit_criterion (a new id each, kind include or exclude): those for Title/abstract and those for Full text, each one testable sentence.' },
  { id: 'search', page: 'search', title: 'Search', groups: ['search', 'literature'],
    brief: 'Build the search from the PICO and run it with run_search for pubmed, then epmc and openalex, each query in that source\'s own syntax (PubMed field tags for pubmed; quoted phrases and AND/OR for epmc and openalex). A source that finds more than 2,000 records needs a narrower query: narrow it and run it again. Check with search_literature that the PubMed query finds the key trials you know of, and name any it misses. For Embase, Scopus and Web of Science, which the person searches, give each its string with translate_query (targets ovid-embase, scopus, wos) and say to import the exports on this page.' },
  { id: 'screening', page: 'screening', title: 'Screening', groups: ['screening', 'library'],
    brief: 'Screen the undecided records on title and abstract against the protocol\'s criteria yourself: read them twenty-five at a time with query_library (decision undecided, stage ta, abstracts true), then propose a screen change for every one (stage ta; decision include, exclude or uncertain; for an exclusion the reason is the criterion it fails), twenty-five to a propose_changes call, until none is undecided or the turn\'s budget ends. Say how many you decided of how many, and how many remain (Do again goes on with them). Full-text screening needs PDFs: name the included records without one.' },
  { id: 'extraction', page: 'extraction', title: 'Extraction', groups: ['extraction', 'app'],
    brief: 'Set up what the outcomes need now, whether or not studies are in yet: the fields with add_field (study design, sample size, age, follow-up, and each outcome\'s numbers per arm, with units and definitions). Then, for included studies with PDFs, set their arms (set_arms) and run the extraction action (values land in Proposals with their quotes). Say which studies could not be read and why.' },
  { id: 'appraisal', page: 'appraisal', title: 'Risk of bias', groups: ['appraisal'], analytic: true,
    brief: 'Appraise each included study with the instrument its design calls for (RoB 2 for randomised trials, ROBINS-I for non-randomised comparisons, JBI for case series), naming it in each appraise change (tool); propose each judgement with the quote it rests on. Where a study has no PDF, appraise what its abstract reports and say what the full text would settle.' },
  { id: 'analysis', page: 'analysis', title: 'Analysis', groups: ['analysis'], analytic: true,
    brief: 'For each outcome with data from two or more studies: set_outcome, then propose_analysis with the measure and model the data call for (a pooled proportion for single-arm data, a ratio or difference for comparisons; random effects unless there is a reason not to). Say which outcomes cannot be pooled and why.' },
  { id: 'journal', page: 'submissions', title: 'Journal and formats', groups: ['web', 'manuscript', 'changes'],
    brief: 'Choose where to send it: three journals whose scope and recent papers fit this question and design, each with its fit; ask the person which with ask_person (the three as choices, each with its fit as the detail, yours recommended). Set the one they choose as the target with set_target_journal (the other two as alternatives, best first). Web lookups are few (five a turn): spend them on the recommended journal\'s instructions for authors. Record what it asks for in a project note (create_project_note): article type, word limit, abstract structure and length, reference style, limits on tables and figures, and the reporting checklist (PRISMA 2020 for a systematic review); say which of these you read on its site and which you could not confirm.' },
  { id: 'manuscript', page: 'manuscript', title: 'Manuscript, tables and figures', groups: ['manuscript', 'outputs'],
    brief: 'The manuscript holds the sections of the paper\'s type: read manuscript_outline for the headings\' ids and insert_paragraph after each heading (each lands as a tracked change). Write now what needs no results: the title, the introduction, and the methods from the protocol and the searches. Write the results and discussion from the screening counts and the analyses when they exist (quantities as result tokens), and add their tables and figures with insert_manuscript_output (the PRISMA flow, the characteristics of included studies, a forest plot per pooled outcome); when they do not exist yet, say what each waits for. Cite only Library records as [@key].' },
];

const RULES = 'Rules for every stage: work only on this stage, in its page, which is open beside the chat. Load the tool groups named. Act now: make every change with its tool in this turn; a field, a criterion or a paragraph described in words is not made. Do not ask whether to go on: the person decides at the check-in after this turn. Write through the tools: a manuscript paragraph is written as a tracked change; everything else waits in Proposals. Each change in propose_changes is {"op": "<name>", ...its fields}, for example {"op": "add_field", "label": "Sample size", "type": "integer"}. Never invent a study, a number or a quote: each comes from a record, a document or a tool result. When the stage needs a decision only the person can make (which journal, which of two plans, whether a borderline record goes in), ask it with ask_person, your recommendation marked, and go on with their answer in this turn. When something else needs the person (a database export, a PDF), say exactly what and where, and stop. End with three short parts: what you did, what waits for the person, and what the next stage needs.';

/** A new run for a question. A scoping review has no risk-of-bias or pooled analysis stage. */
export function newRun({ question, kind = 'systematic review', journal = '' } = {}, now = new Date()) {
  const k = KINDS.includes(kind) ? kind : 'systematic review';
  return { id: `run-${now.getTime().toString(36)}`, question: clip(question, 600), kind: k, journal: clip(journal, 160), at: now.toISOString(), ended: false,
    stages: STAGES.map(st => ({ id: st.id, status: k === 'scoping review' && st.analytic ? 'skipped' : 'pending', note: '' })) };
}

const stageOf = id => STAGES.find(x => x.id === id);
const live = run => run && !run.ended ? run : null;
/** Where the run stands: the stage running or waiting for the person, and the next one to start. */
export function position(run) {
  if (!live(run)) return null;
  const now = run.stages.find(x => x.status === 'running' || x.status === 'waiting') || null;
  const after = run.stages.slice(now ? run.stages.indexOf(now) + 1 : 0).find(x => x.status === 'pending') || null;
  const order = run.stages.filter(x => x.status !== 'skipped');
  return { now, next: after, number: x => order.indexOf(x) + 1, of: order.length };
}

/** What the project holds for a stage, in a line: read from the project, never from the answer. */
export function stageFacts(s, id, today = new Date().toISOString().slice(0, 10)) {
  const f = standingFacts(s, today), p = s.protocol || {};
  switch (id) {
    case 'protocol': { const pico = ['population', 'intervention', 'comparator', 'outcome'].filter(k => String(p.pico?.[k] || '').trim()).length;
      return `PICO ${pico} of 4 parts; ${plural((p.criteria || []).length, 'criterion', 'criteria')}`; }
    case 'search': return `${plural((s.searches || []).length, 'search', 'searches')} logged; ${plural((s.papers || []).length, 'record')} in the Library`;
    case 'screening': return f.screening?.text ? `${f.screening.text}${f.screening.left ? `; ${f.screening.left} undecided` : ''}` : 'No records screened';
    case 'extraction': return f.evidence?.of ? `${plural(f.evidence.values || 0, 'value')} for ${f.evidence.studies || 0} of ${plural(f.evidence.of, 'included study', 'included studies')}` : 'No included studies yet';
    case 'appraisal': { const ins = f.appraisal?.instruments || []; return ins.length ? ins.map(i => `${i.name}: ${i.complete} of ${i.n} complete`).join('; ') : 'No study appraised'; }
    case 'analysis': { const a = f.analyses || {}, rows = a.rows || [], est = rows.filter(r => r.est != null).length; return rows.length ? `${plural(rows.length, 'outcome')}, ${est} with an estimate` : 'No analysis yet'; }
    case 'journal': return f.submission?.target ? `Target: ${f.submission.target}` : 'No target journal';
    case 'manuscript': { const m = f.manuscript || {}; return m.words ? `${m.words.toLocaleString('en')} words in ${plural((m.sections || []).length, 'section')}` : 'The manuscript is empty'; }
    default: return '';
  }
}

/**
 * What a stage needs before it can do its work, said as what to do; '' when it can start. A stage whose need is not met is not offered:
 * a run with an empty Library once went through screening, extraction, appraisal and analysis with nothing to work on (2026-10-22).
 */
export function stageNeed(s, id, today = new Date().toISOString().slice(0, 10)) {
  const included = () => (standingFacts(s, today).screening?.steps || []).find(([w]) => w === 'included')?.[1] || 0;
  switch (id) {
    case 'screening': return (s.papers || []).length ? '' : 'Screening needs records: accept the searches in Proposals, or import on Literature';
    case 'extraction': case 'appraisal': return included() ? '' : `${stageTitle(id)} needs included studies: decide the screening first`;
    case 'analysis': return Object.keys(s.values || {}).length ? '' : 'Analysis needs extracted values: accept the extraction first';
    default: return '';
  }
}

/** The brief a stage's turn carries (with the page's own context, not shown as the person's words). */
export function stageBrief(s, run, id) {
  const st = stageOf(id), pos = position(run), mine = run.stages.find(x => x.id === id);
  const before = run.stages.filter(x => x.status === 'done' && x.note).map(x => `${stageOf(x.id).title}: ${x.note}`);
  return [`Paper run, stage ${pos.number(mine)} of ${pos.of}: ${st.title}.`,
    `The question: ${run.question}`, `The paper: a ${run.kind}${run.journal ? `, for ${run.journal}` : ''}.`,
    `The project now: ${stageFacts(s, id)}.`, before.length ? `Earlier stages:\n${before.join('\n')}` : '',
    `Load these tool groups: ${st.groups.join(', ')}.`, `This stage: ${st.brief}`, RULES].filter(Boolean).join('\n');
}

/** The person's message that starts a stage (what the chat shows as theirs). */
export const stageMessage = (run, id) => { const pos = position(run), mine = run.stages.find(x => x.id === id); return `Paper run, stage ${pos.number(mine)} of ${pos.of}: ${stageOf(id).title}`; };

// ---- the person's choices, each a new run (the caller stores it) ----------------------------------------------------------------------
const set = (run, id, patch) => ({ ...run, stages: run.stages.map(x => x.id === id ? { ...x, ...patch } : x) });
/** A stage starts: one waiting before it is done (the person went on), and it runs. */
export function startStage(run, id) {
  const waiting = run.stages.find(x => x.status === 'waiting');
  return set(waiting && waiting.id !== id ? set(run, waiting.id, { status: 'done' }) : run, id, { status: 'running' });
}
/** The stage's turn ended: it waits for the person, with what the answer said, in short. */
export function stageEnded(run, answer = '') {
  const r = run.stages.find(x => x.status === 'running');
  return r ? set(run, r.id, { status: 'waiting', note: clip(answer, 400) }) : run;
}
export const skipStage = (run, id) => set(run, id, { status: 'skipped' });
/** The last stage, or a stop: the run ends, its stages kept as they were. */
export const endRun = run => { const w = run.stages.find(x => x.status === 'waiting'); return { ...(w ? set(run, w.id, { status: 'done' }) : run), ended: true }; };
export const stageTitle = id => stageOf(id)?.title || id;
export const stagePage = id => stageOf(id)?.page || 'overview';
