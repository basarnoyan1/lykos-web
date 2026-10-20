// What the Overview shows, as plain data (plan §2, "Progress").
//
// The page answers two questions: where the paper stands (lib/overview-stages.mjs, loaded with the
// page) and what to do next (attentionGroups, nextStep). Everything here is a pure
// function of values the view already read from lib/progress.mjs and
// lib/research-workflow.mjs, so it can be tested without a document and cannot
// disagree with the pages it points to. Nothing is stored.

import { arriveOf, arrivalTitle } from './arrive.mjs';

/** The label of the view an item opens, as the page names it. */
export const VIEW_LABELS = Object.freeze({
  protocol: 'Protocol', search: 'Literature', library: 'Library', screening: 'Screening', extraction: 'Extraction',
  patients: 'Patient data', datasets: 'Datasets', appraisal: 'Appraisal', analysis: 'Analysis', advancedAnalysis: 'Advanced analysis',
  certainty: 'Certainty', manuscript: 'Manuscript', reporting: 'Reporting', trialOperations: 'Trial operations',
  settings: 'Settings', notes: 'Notes', overview: 'Overview', case: 'Case', outputs: 'Tables and figures', figures: 'Figures', submissions: 'Submission',
});
export const viewLabel = view => VIEW_LABELS[view] || (view ? String(view).charAt(0).toUpperCase() + String(view).slice(1) : 'Open');

/** The order groups take when none is blocked: the order the work happens in. */
const ORDER = ['protocol', 'search', 'library', 'screening', 'extraction', 'patients', 'datasets', 'appraisal', 'analysis', 'advancedAnalysis',
  'certainty', 'case', 'manuscript', 'figures', 'outputs', 'reporting', 'submissions', 'trialOperations', 'notes', 'overview', 'settings'];
const rank = id => { const i = ORDER.indexOf(id); return i < 0 ? ORDER.length : i; };

/** Items that open a part of Settings or a Library check open that part, not the page. */
export const goKeyOf = item => item.go ? item.go
  : item.view === 'protocol' && /criteri/i.test(item.text || '') ? 'protocol:criteria'
  : item.view === 'library' && /quality|malformed|missing/i.test(item.text || '') ? 'library:quality'
  : item.view;

const num = n => Number(n || 0).toLocaleString('en');
const plural = (n, one, many) => `${num(n)} ${n === 1 ? one : many}`;

/** How many cells a model proposed and in how many papers; only the given papers when a list is passed. */
export function proposalTotals(proposals, includedIds = null) {
  const only = includedIds ? new Set(includedIds) : null, papers = new Set();
  let cells = 0;
  for (const [key, rec] of Object.entries(proposals || {})) {
    if (!rec || typeof rec !== 'object') continue;
    const id = typeof rec.paper_id === 'string' ? rec.paper_id : key.includes(':') ? key.slice(0, key.indexOf(':')) : '';
    if (!id || (only && !only.has(id))) continue;
    cells++; papers.add(id);
  }
  return { cells, papers: papers.size };
}

/**
 * Recent activity, newest first, with consecutive entries of one `group` key ({ key, verb, many, subject? }) read as one line ("Extracted
 * 26 values · Akgun 2024", "Included 10 records") at the newest time; an entry with no group is never merged.
 */
export function groupRecent(entries = []) {
  const out = [];
  for (const r of entries || []) {
    const g = r?.group, last = out.at(-1);
    if (g && last?.group?.key === g.key) { last.n++; last.text = `${g.verb} ${num(last.n)} ${g.many}${g.subject ? ` · ${g.subject}` : ''}`; continue; }
    if (r) out.push(g ? { ...r, n: 1 } : r);
  }
  return out.map(({ group: _g, n: _n, ...r }) => r);
}

/**
 * What still needs a person, as one row per part of the work. The same stage is never listed twice: the many cells a model
 * proposed become "24 proposals in 5 papers", a library with several checks becomes its first and "+N more". Groups that
 * stop a claim come first, then the order the work happens in.
 *   next       lib/research-workflow.mjs nextResearchActions()
 *   open       lib/progress.mjs unresolved(), already limited to the views the project shows
 *   proposals  proposalTotals() of the included papers
 *   fullTexts  included studies with no full text attached
 * A group is { id, title, summary, parts, count, block, go, action, figure } where `action` is the next action to
 * perform ({ type: 'cell' | 'run' | 'paper' | 'go', ... }).
 */
export function attentionGroups({ next = [], open = [], proposals = { cells: 0, papers: 0 }, fullTexts = 0 } = {}) {
  const groups = new Map();
  const group = (id, title) => { if (!groups.has(id)) groups.set(id, { id, title, items: [] }); return groups.get(id); };
  const hasOpen = (view, re) => open.some(u => u.view === view && re.test(u.text || ''));
  const proposalAction = next.find(a => a.kind === 'review'), fillAction = next.find(a => a.kind === 'fill' || a.kind === 'complete');
  const fillPapers = new Set(next.filter(a => a.kind === 'fill' || a.kind === 'complete').map(a => a.paperId)).size;
  let proposalDone = false, fillDone = false, textDone = false;

  for (const u of open) {
    // A row about an adopted file leads to that file (go 'files:<rule>:<path>'), one group for each file, named by the file.
    const driftFile = typeof u.go === 'string' && /^files:D[1-5]:/.test(u.go) ? u.go.slice(9) : '';
    // An integration check (lib/coverage-needs.mjs) is a stage's own row, not a figure check.
    const fig = u.key !== undefined && !driftFile && u.kind !== 'coverage';
    const g = driftFile ? group(`file:${driftFile}`, driftFile.slice(driftFile.lastIndexOf('/') + 1)) : fig ? group('figures', VIEW_LABELS.figures) : group(u.view, viewLabel(u.view));
    g.items.push({ text: u.text, block: u.severity === 'block', action: withArrive({ type: 'go', go: goKeyOf(u) }, arriveOf(u)), figure: fig, key: u.key, folder: u.kind === 'coverage' });
  }
  for (const a of next) {
    const g = group(a.view, viewLabel(a.view));
    if (a.kind === 'review') {
      if (proposalDone) continue; proposalDone = true;
      const t = proposals.cells ? proposals : { cells: a.count || 1, papers: 1 };
      const text = `${plural(t.cells, 'proposal', 'proposals')} · ${plural(t.papers, 'paper', 'papers')}`;
      g.items.push({ text, block: false, action: withArrive(cellAction(proposalAction), arriveOf({ ...a, text }, { next: true })) });
    } else if (a.kind === 'fill' || a.kind === 'complete') {
      if (fillDone) continue; fillDone = true;
      // The next actions list at most three papers: a full list says "3 or more", never a total it did not count.
      const text = `Empty cells · ${fillPapers >= 3 ? '3+' : fillPapers} ${fillPapers === 1 ? 'paper' : 'papers'}`;
      g.items.push({ text, block: false, action: withArrive(cellAction(fillAction), arriveOf({ ...a, text }, { next: true })) });
    } else if (a.kind === 'full_text') {
      if (textDone || hasOpen('library', /PDF|full text/i)) continue; textDone = true;
      const text = `${plural(fullTexts || 1, 'full text', 'full texts')} missing`;
      g.items.push({ text, block: false, action: withArrive({ type: 'paper', paperId: a.paperId, go: 'library' }, arriveOf({ ...a, text }, { next: true })) });
    } else if (a.kind === 'screening' && hasOpen('screening', /not screened/i)) continue;
    else if (a.kind === 'appraisal' && hasOpen('appraisal', /not appraised/i)) continue;
    else if (a.kind === 'reporting' && hasOpen('reporting', /blank/i)) continue;
    else g.items.push({ text: a.text, block: false, action: withArrive({ type: 'go', go: goKeyOf(a) }, arriveOf(a, { next: true })) });
  }

  const list = [...groups.values()].filter(g => g.items.length).map(g => {
    // Blocking items lead; the rest keep the order they were found in (the work's own order for next actions, then the checks).
    const items = [...g.items.filter(i => i.block), ...g.items.filter(i => !i.block)];
    const figure = g.id === 'figures';
    const more = figure ? figureMore(items) : 0;
    // Each part is one check, except a figure group's "N more figure checks", which is N.
    const parts = figure ? figureParts(items) : items.map(i => i.text);
    const weight = (_, i) => figure && more && i === parts.length - 1 ? more : 1;
    const shown = parts.slice(0, 2);
    const rest = parts.slice(2).reduce((n, p, i) => n + weight(p, i + 2), 0);
    return {
      id: g.id, title: g.title, parts, figure,
      count: figure ? items.filter(i => i.key !== 'more').length + more : items.length,
      summary: shown.join(' · ') + (rest > 0 ? ` · ${rest} more` : ''),
      block: items.some(i => i.block), folder: items.some(i => i.folder), go: items[0].action.go, action: items[0].action,
      // the row's hover title: each part as a full sentence, what is wrong and what to do there
      tip: items.map(i => i.action.arrive ? arrivalTitle(i.action.arrive) : `${i.text}.`).join(' '),
    };
  });
  return list.sort((a, b) => (b.block - a.block) || (rank(a.id) - rank(b.id)));
}

/** The next action's arrival, counted as its group counts it ("3 included studies need a full text", not "Attach full text · Lee 2020"). */
function arrivalFor(a, groups) {
  const own = arriveOf(a, { next: true });
  const g = own && groups.find(x => x.action?.arrive?.kind === own.kind);
  return g ? g.action.arrive : own;
}
/** An action that lands on its page with the arrival notice (lib/arrive.mjs); an item of no known kind lands as before. */
const withArrive = (action, arrive) => (arrive ? { ...action, arrive } : action);
const cellAction = a => a ? { type: a.kind === 'fill' ? 'run' : 'cell', paperId: a.paperId, columnId: a.columnId, templateId: a.templateId, go: a.view } : { type: 'go', go: 'extraction' };

/** Figure checks arrive as up to three rows and one "N more figure checks" row (lib/figure-watch.mjs). */
function figureMore(items) {
  const row = items.find(i => i.key === 'more'), n = Number(/^(\d+)/.exec(row?.text || '')?.[1]);
  return Number.isFinite(n) ? n : 0;
}
function figureParts(items) {
  const rows = items.filter(i => i.key !== 'more'), more = figureMore(items);
  const parts = rows.map(r => r.text);
  if (more) parts.push(`${plural(more, 'more figure check', 'more figure checks')}`);
  return parts;
}

/**
 * The one thing to do next: the first of the review's own next actions, else the first group. Null when nothing is
 * outstanding. `label` is the page it opens, for the primary button.
 */
export function nextStep(next = [], groups = []) {
  const a = next[0];
  if (a) {
    const action = withArrive(a.kind === 'review' || a.kind === 'complete' || a.kind === 'fill' ? cellAction(a)
      : a.kind === 'full_text' ? { type: 'paper', paperId: a.paperId, go: 'library' } : { type: 'go', go: goKeyOf(a) }, arrivalFor(a, groups));
    return { label: viewLabel(a.view), action, text: a.text };
  }
  const g = groups[0];
  return g ? { label: g.title, action: g.action, text: g.summary } : null;
}

/** Rows the home page's Tasks block draws, and the recent rows beside it. */
export const HOME_ROWS = 6;
export const RECENT_LIMIT = 5;
/** What a dated row that is not a task is called: the kinds lib/project-summary.mjs gives its due items. */
export const DATED_KIND = Object.freeze({ milestone: 'Milestone', ethics: 'Ethics', registration: 'Registration' });

/**
 * The rows of the home page's Tasks block, as `[{ task } | { dated }]`, at most `limit`: what is dated first, in date order (an overdue
 * date leads because it is the earliest; a task before a milestone on the same day), then the undated open tasks in the order they
 * arrive. `tasks` are normalised tasks in lib/tasks.mjs sortTasks order (a done task is never a row); `dated` is the due items of
 * lib/project-summary.mjs summarizeProject that are not tasks (`{ date, text, kind, view }`), already within its horizon.
 */
export function homeRows({ tasks = [], dated = [], limit = HOME_ROWS } = {}) {
  const open = (tasks || []).filter(t => t && !t.done);
  const timeline = [...open.filter(t => t.due).map(task => ({ key: task.due, task })),
    ...(dated || []).filter(d => d && d.date).map((d, i) => ({ key: d.date, dated: { ...d, id: d.id || `${d.kind}:${d.date}:${i}` } }))]
    .sort((a, b) => a.key.localeCompare(b.key));
  return [...timeline, ...open.filter(t => !t.due).map(task => ({ task }))].slice(0, Math.max(0, limit)).map(({ key, ...row }) => row);
}
