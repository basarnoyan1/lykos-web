// The Screening page as declarations: what each bar IS, with no DOM and no store (as views/library-bars.mjs does for the Library).
// screening.mjs builds the model from its state and renders these with the shared builders (lib/ui-actions.mjs); the tests render
// them under Node, where a bad spec throws. Nothing here places a control: placement is the builders' and ui-actions.css's.
import { CH_STEPS } from '../lib/ui-actions.mjs';

/** The three verdicts, in the order the decision bar and the keys give them: id, label, key. */
export const VERDICTS = Object.freeze([['include', 'Include', 'I'], ['exclude', 'Exclude', 'E'], ['uncertain', 'Uncertain', 'U']]);
/** A verdict's mark: an icon in the verdict's conventional colour beside a neutral word (the traffic light of plan §2, carried by the icon). */
export const VERDICT_ICON = Object.freeze({ include: 'check', exclude: 'close', uncertain: 'minus' });

// ---- the record page --------------------------------------------------------------------------------------------------------
const chOf = text => CH_STEPS.find(c => c >= String(text).length) ?? CH_STEPS.at(-1);

/**
 * The page's status words (the title bar's): how many records of the stage are decided. They hold one slot as wide as the longest the
 * stage can say (every record decided), so the bar is the same width for every record and every count. `amended` counts only the
 * decisions that stand under the current criteria.
 */
export function statusOf({ decided, total, dual = false, me = '', amended = false }) {
  const tail = dual && me ? `by ${String(me).slice(0, 6)}` : amended ? 'resolved' : 'decided';
  // "12 of 40 decided"; a very large review reads "100000/100000 by ABCDEF", so the words always fit the slot
  const say = (d, t) => { const full = `${d} of ${t} ${tail}`; return full.length <= CH_STEPS.at(-1) ? full : `${d}/${t} ${tail}`; };
  return { text: say(decided, total), ch: chOf(say(total, total)) };
}

/** The status of the Disagreements view: how many of its records are still open, in a slot as wide as the count of all of them. */
export function disagreementStatus(open, all = open) {
  const say = n => `${n} open`;
  return { text: say(open), ch: chOf(say(Math.max(all, 10))) };
}

/**
 * The page's head, which the title bar draws (lib/topbar.mjs): the stage as the title, a picker whose menu holds the stages (Title &
 * abstract, Full text) with what each has open (a picker and not a switch beside the title: the bar then fits a 320px window), the status
 * words, and the record's commands: Set initials when dual screening has none yet, Undo (always drawn, disabled until this session has a
 * decision to take back) and Open (the PDF, or the record: its label holds a six-character slot). More holds the model tools of the
 * record and the queue, then the page's commands: Import reviewer sheet…, Re-screen excluded…, the decision log, Proposals… and, last
 * and destructive, Clear. `model`: { stages: [id, label, count], stage, status, record: bool, openLabel, canUndo, needInitials,
 * tools: { criteria, assess, propose, proposeModel, stop }, rescreen, proposals, decisions, clearLabel }. `run` maps an id to its handler
 * (`pick` opens the stage menu under its anchor).
 */
export function pageSpec(m, run = {}) {
  const on = id => run[id] || (() => {}), tools = m.tools || {};
  const record = tools.criteria ? [{ id: 'assess-criteria', label: 'Add eligibility criteria', run: on('assess-criteria') }] : tools.assess ? [{ id: 'assess', label: 'Assess this record', run: on('assess') }] : [];
  const queue = tools.stop ? [{ id: 'assess-stop', label: 'Stop proposals', run: on('assess-stop') }]
    : tools.propose ? [{ id: 'scr-propose', label: tools.propose, attrs: tools.proposeModel ? { title: tools.proposeModel } : undefined, run: on('scr-propose') }] : [];
  const pageCmds = [{ id: 'scr-import-sheet', label: 'Import reviewer sheet…', run: on('scr-import-sheet') },
    ...(m.rescreen != null ? [{ id: 'scr-rescreen', label: 'Re-screen excluded…', disabled: !m.rescreen, run: on('scr-rescreen') }] : []),
    ...(m.decisions ? [{ id: 'scr-log', label: 'Decision log', run: on('scr-log') }] : []),
    ...(m.proposals ? [{ id: 'scr-proposals', label: 'Proposals…', run: on('scr-proposals') }] : []),
    ...(m.decisions ? [{ id: 'scr-clear', label: m.clearLabel, danger: true, run: on('scr-clear') }] : [])];
  const groups = [record, queue, pageCmds].filter(g => g.length);
  const current = (m.stages || []).find(x => x[0] === m.stage);
  return { title: current?.[1] || 'Screening',
    // Find: the list's search row, closed until asked for (the title bar draws it beside the panel toggles)
    ...(run.find ? { find: { pressed: !!m.finding, run: run.find } } : {}),
    ...(m.stages ? { titleMenu: on('pick') } : {}),
    // no count beside the title ("460 of 460 decided"): the list pane's groups say how far the stage is (Component review 2026-10-21, item 1)
    actions: [
      ...(m.needInitials ? [{ id: 'to-initials', label: 'Set initials', icon: 'user', run: on('to-initials') }] : []),
      ...(m.undo ? [{ id: 'undo-last', label: 'Undo', icon: 'undo', kbd: 'Z', disabled: !m.canUndo, fold: 4, run: on('undo-last') }] : []),
      // one word that never changes width; the icon and the tooltip say whether it opens the PDF or the record
      ...(m.openLabel ? [{ id: 'open-doc', label: 'Open', icon: /PDF/.test(m.openLabel) ? 'file-pdf' : 'file', kbd: 'O', attrs: { 'aria-label': m.openLabel }, run: on('open-doc') }] : [])],
    overflow: groups.flatMap((g, k) => (k ? ['-', ...g] : g)) };
}

/** The notice over the record when the protocol changed after decisions were made. */
export const amendedNotice = () => ({ id: 'scr-amend', label: 'Protocol amended', text: 'Protocol amended. Prior decisions need review', actions: [{ id: 'protocol-changes', label: 'View criteria' }] });

/**
 * The decision bar: the note, the three verdicts and Skip as equal columns that never fold. `mine` is this reviewer's decision on
 * the record, shown as the pressed verdict. Pressing Exclude opens the reasons as a menu, so nothing is drawn above the bar.
 */
export function footSpec({ mine = null, note = '' } = {}) {
  return { kind: 'foot', label: 'Screening decision', id: 'scr-foot', equal: true,
    filters: [{ type: 'field', id: 'scr-note', label: 'Decision note', placeholder: 'Decision note', width: 'flex', maxlength: 2000, value: note, attrs: { title: 'Decision note (N)' } }],
    actions: [
      ...VERDICTS.map(([id, label, kbd]) => ({ id: `scr-${id}`, label, kbd, icon: VERDICT_ICON[id], pressed: mine?.decision === id, attrs: { 'data-d': id } })),
      { id: 'skip', label: 'Skip', kbd: 'S', role: 'quiet' }] };
}

// ---- the list pane ----------------------------------------------------------------------------------------------------------
// ---- the conflict page (its head is pageSpec's: the stage, how many conflicts are open, Open) ---------------------------------------
/** An unresolved conflict: how it is settled, why, and Resolve. Settling by an exclusion asks for its reason in a menu under Resolve. */
export function resolveFootSpec(m) {
  return { kind: 'foot', label: 'Resolve conflict', id: 'scr-resolve',
    filters: [
      { type: 'select', id: 'res-take', label: 'Resolution', options: m.takes },
      { type: 'field', id: 'res-why', label: 'Reason for the resolution', placeholder: 'Reason for the resolution', width: 'flex', maxlength: 500 }],
    actions: [{ id: 'res-go', label: 'Resolve', role: 'primary', disabled: true }] };
}
/** A resolved conflict: who settled it and the way to reopen it. */
export function resolvedFootSpec(m) {
  return { kind: 'foot', label: 'Conflict resolved', id: 'scr-resolve', start: [{ message: m.message }], actions: [{ id: 'res-reopen', label: 'Reopen', icon: 'undo' }] };
}

// ---- sub-pages ----------------------------------------------------------------------------------------------------------------
/**
 * The head of a sub-page of Screening, the decision log (`kind: 'log'`) or the proposal matrix (`'matrix'`): Back to Screening, its name,
 * how many rows it holds, and Export (a menu for the log: the decisions or the whole log). Nothing here is a decision: a row opens its
 * record on the Screening page. `run` maps 'back' and 'export' to their handlers.
 */
export function subPageSpec({ kind, count = 0 }, run = {}) {
  const on = id => run[id] || (() => {}), log = kind === 'log';
  const say = n => `${n} ${log ? (n === 1 ? 'decision' : 'decisions') : (n === 1 ? 'record' : 'records')}`;
  return { title: log ? 'Decision log' : 'Proposal matrix', back: { label: 'Back to Screening', run: on('back') },
    actions: [{ id: log ? 'scr-log-export' : 'scr-mx-export', label: 'Export', icon: 'export', ...(log ? { menu: true } : {}), disabled: !count, run: on('export') }],
    overflow: [] };
}
