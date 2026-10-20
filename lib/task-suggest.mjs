// Suggested tasks: what a model (or the rule parser) proposes as work, before a person makes it a task.
//
// Three flows propose them (Overview › Plan the next steps, the chat's suggested tasks, Tasks › Suggest tasks from text) and all of them
// end in the one op, add_task (lib/change-ops.mjs): the same check against open tasks and against what was dismissed, the same notes
// saying where the task came from, the same Undo. Until accepted a suggestion is only a row (Proposals or the dialog); accepted, it is an
// ordinary task.
import { get, update } from '../store.mjs';
import { makeTask, normaliseTasks, removeTasks, tasksSignature, noteAdded, PRIORITIES } from './tasks.mjs';
import { day } from './dates.mjs';
import { esc } from './html.mjs';
import { uiBar, uiList, uiRow } from './ui-actions.mjs';

/** How many dismissed suggestions are remembered (oldest forgotten first). */
export const DISMISSED_MAX = 200;
/** Where a suggestion came from, as the task's notes say it. */
export const SUGGESTION_SOURCES = Object.freeze({ chat: 'chat', plan: 'Overview · Plan the next steps', text: 'text' });

/** A suggestion's text for comparison: lower case, accents, punctuation and runs of space folded. */
export const normText = s => String(s ?? '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

/** '' when the text may be suggested, else why not: 'Already a task' (an open task says the same) or 'Dismissed'. Pure. */
export function suggestionState(text, s) {
  const n = normText(text);
  if (!n) return '';
  if (normaliseTasks(s?.todos).some(t => !t.done && normText(t.text) === n)) return 'Already a task';
  if ((Array.isArray(s?.dismissedSuggestions) ? s.dismissedSuggestions : []).includes(n)) return 'Dismissed';
  return '';
}

/** Remembers suggestions a person turned down, so the next run does not offer them again. */
export function dismissSuggestions(texts) {
  const add = [...new Set((texts || []).map(normText).filter(Boolean))];
  if (!add.length) return;
  update(s => { const kept = (Array.isArray(s.dismissedSuggestions) ? s.dismissedSuggestions : []).filter(t => !add.includes(t)); s.dismissedSuggestions = [...kept, ...add].slice(-DISMISSED_MAX); return s; });
}
export const dismissedCount = (s = get()) => (Array.isArray(s.dismissedSuggestions) ? s.dismissedSuggestions.length : 0);
export function clearDismissed() { update(s => { delete s.dismissedSuggestions; return s; }); }

const VIEW_LABEL = { overview: 'Overview', protocol: 'Protocol', search: 'Search', library: 'Library', screening: 'Screening', extraction: 'Extraction', patients: 'Patients',
  appraisal: 'Appraisal', analysis: 'Analysis', certainty: 'Certainty', manuscript: 'Manuscript', outputs: 'Outputs', reporting: 'Reporting', notes: 'Notes', workflows: 'Workflows', files: 'Files', tasks: 'Tasks' };
export const linkLabel = link => (link?.view ? link.label || VIEW_LABEL[link.view] || link.view : '');

/** A suggestion checked and cleaned: { text, due, priority, link, why } or { error }. */
export function cleanSuggestion(c = {}) {
  const text = String(c.text ?? '').replace(/\s+/g, ' ').trim();
  if (!text) return { error: 'A suggested task needs text.' };
  if (text.length > 240) return { error: 'Keep a suggested task under 240 characters.' };
  if (c.due != null && c.due !== '' && !/^\d{4}-\d{2}-\d{2}$/.test(String(c.due))) return { error: 'Use a YYYY-MM-DD due date.' };
  if (c.priority != null && !PRIORITIES.some(([k]) => k === c.priority)) return { error: 'Priority is none, low or high.' };
  const view = c.link && typeof c.link === 'object' && typeof c.link.view === 'string' && VIEW_LABEL[c.link.view] ? c.link.view : '';
  const link = view ? { view, ...(c.link.paperId ? { paperId: String(c.link.paperId) } : {}), ...(c.link.label ? { label: String(c.link.label).slice(0, 80) } : {}) } : null;
  return { text, due: c.due ? String(c.due) : '', priority: c.priority || 'none', link, why: String(c.why ?? '').replace(/\s+/g, ' ').trim().slice(0, 240) };
}

/** What a suggestion's second line says: the page it links to, the due day, the priority. */
export const suggestionDetail = x => [linkLabel(x.link), x.due ? `due ${day(x.due)}` : '', x.priority === 'high' ? 'High priority' : x.priority === 'low' ? 'Low priority' : ''].filter(Boolean).join(' · ');

/** The task's notes: who suggested it, from where, on which day, and why. */
export function suggestionNotes({ model = '', source = 'chat', why = '' } = {}, now = new Date()) {
  const from = SUGGESTION_SOURCES[source] || SUGGESTION_SOURCES.chat;
  return `Suggested by ${model || 'the rule parser'} from ${from}, ${day(now, 0)}.${why ? ` ${why}` : ''}`;
}

/** The fingerprint an Undo checks: tasks exactly as the acceptance left them. */
export const tasksKey = () => tasksSignature(get().todos);

/**
 * Writes one suggestion as a task. Returns { done, undo, key } (undo removes the task again while key() is unchanged), or { refused }
 * when an open task already says the same. The only code that turns a suggestion into a task.
 */
export function addSuggested(data, { model = '', source = 'chat', now = new Date() } = {}) {
  const x = cleanSuggestion(data);
  if (x.error) return { refused: x.error };
  if (suggestionState(x.text, { todos: get().todos }) === 'Already a task') return { refused: 'Already a task' };
  const task = makeTask({ text: x.text, due: x.due, priority: x.priority, link: x.link, notes: suggestionNotes({ model, source, why: x.why }, now) });
  const before = tasksSignature(get().todos);
  update(s => { s.todos = [...(s.todos || []), task]; return s; });
  noteAdded(task.id, before, tasksSignature(get().todos));   // the Tasks page offers "n tasks added · Undo" while nothing else changed
  return { done: 'Added', key: tasksKey, undo: () => update(s => { s.todos = removeTasks(s.todos, [task.id]).list; return s; }) };
}

/**
 * The dialog's suggestions (Tasks › Suggest tasks from text): a dense head "Suggested tasks · <origin>" with the one primary "Add n",
 * and a check row per suggestion. A suggestion that is already a task is drawn with a blank check and the reason.
 * `unticked` is the set of indexes a person cleared.
 */
export function suggestedTasksList({ items = [], origin = '', unticked = new Set(), s = get(), id = 'tk-sugg' } = {}) {
  if (!items.length) return '';
  const stale = items.map(x => suggestionState(x.text, s));
  const n = items.filter((x, i) => !stale[i] && !unticked.has(i)).length;
  const head = uiBar({ kind: 'head', density: 'dense', label: 'Suggested tasks', id: `${id}-head`, lead: { title: 'Suggested tasks', level: 'h3' },
    ...(origin ? { status: { id: `${id}-origin`, text: origin, ch: 18 } } : {}),
    actions: [{ id: `${id}-add`, label: `Add ${n}`, role: 'primary', dynamic: true, labelCh: 8, disabled: !n, attrs: { 'data-sugg-add': '' } }] });
  const rows = items.map((x, i) => uiRow({ cls: 'aid-check-row', attrs: { 'data-sugg': i, ...(stale[i] ? { 'data-state': 'stale' } : {}) },
    check: stale[i] ? { checked: false, label: x.text, attrs: { 'data-row-blank': true, disabled: true, 'aria-hidden': 'true', tabindex: '-1' } }
      : { checked: !unticked.has(i), label: `Include: ${x.text}`, attrs: { 'data-sugg-tick': i } },
    main: { html: `<span class="aid-check-text" title="${esc(x.text)}">${esc(x.text)}</span>`, detail: [esc(suggestionDetail(x))] },
    cells: stale[i] ? [{ col: 'state', kind: 'text', html: esc(stale[i]), ch: 14 }] : [] }));
  return `${head}${uiList({ label: 'Suggested tasks', id: `${id}-list`, attrs: { 'data-aid-checklist': '' }, rows })}`;
}
