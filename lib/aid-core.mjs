// The part of the model actions (lib/aid.mjs) the shell reads before any action has loaded: the change listeners, a task's model, the context text a prompt
// starts from, and the one memoised import of the actions themselves (lib/aid.mjs re-exports it; the registry and proposals load on first use).
import { get } from '../store.mjs';
import { configured, declare } from './ai.mjs';
import { projectBrief } from './context.mjs';

export const listeners = new Set();
export const onChange = fn => { listeners.add(fn); return () => listeners.delete(fn); };
let lookup = () => null;         // set by the shell: task -> model profile
export function setModelLookup(fn) { lookup = fn; }
export const modelLookup = task => lookup(task);
export const hasModel = task => task === 'local' || configured(lookup(task) || {});
export const modelOf = task => lookup(task) || {};

// The views' actions (aid/*.mjs) load on first use. Every reader of the registry awaits ensureAid(); `aidReady()` says whether that is done, and
// `aidNeeded()` whether a saved proposal needs the handlers. A failed import is not kept. `aidNow()` is lib/aid.mjs itself, for a reader that has checked.
let aidLoading = null, aid = null;
export const aidReady = () => aid !== null;
export const aidNeeded = (state = get()) => aid === null && (state.aiProposalLedger || []).length > 0;
export function ensureAid() {
  return aidLoading ||= Promise.all([import('./aid.mjs'), import('../aid/index.mjs')]).then(([m]) => { aid = m; }, err => { aidLoading = null; throw err; });
}
export function aidNow() { if (!aid) throw new Error('The assistant actions are not loaded yet'); return aid; }
/** The proposals waiting for a person: none until the actions are here (a saved proposal makes `aidNeeded` true, and the shell waits for them). */
export const openCount = () => aid ? aid.openCount() : 0;

/** One record, as a model should see it. */
export function recordBrief(p) {
  if (!p) return '';
  return [`Study: ${p.label || ''}`, p.title && `Title: ${p.title}`,
    (p.authors || []).length && `Authors: ${(p.authors || []).slice(0, 6).map(a => a.name || a).join(', ')}`,
    [p.journal, p.year].filter(Boolean).join(', '), p.doi && `DOI: ${p.doi}`,
    p.abstract && `Abstract: ${p.abstract}`].filter(Boolean).join('\n').slice(0, 5000);
}

/**
 * The context as text for a prompt: project, view, focus, document, selection.
 * An action that sends the focused record itself passes `record: false`, and
 * one that lists the criteria itself `criteria: false`: the same abstract or
 * rule list twice in one request is paid for twice and read no better.
 */
export function describe(context = {}, s = get(), { record = true, criteria = true } = {}) {
  const f = context.focus || {};
  const focusPaper = f.paperId ? (s.papers || []).find(p => p.id === f.paperId) : null;
  const doc = context.document, text = doc ? 'fulltext' : 'metadata';   // text from a page beside an open file is that file's (declared for the send: lib/egress.mjs)
  return [
    declare(projectBrief(s, { criteria, counts: false }), 'metadata'),   // the progress line changes with every decision; an action that needs the counts states them itself
    `Open view: ${context.viewTitle || context.view || ''}`,
    f.kind && `In focus (${f.kind}): ${[f.label, f.detail].filter(Boolean).join(' — ')}`,
    f.text && declare(`Focused text:\n"""\n${String(f.text).slice(0, 3000)}\n"""`, f.dataClass || text),
    focusPaper && (record ? declare(`Focused record:\n${recordBrief(focusPaper)}`, 'metadata') : `Focused record: ${focusPaper.label || focusPaper.title || ''}`),
    doc && `Document open beside the view: ${doc.label || doc.paperId}, page ${doc.page} of ${doc.pages}`,
    context.selection && declare(`Selected text:\n"""\n${String(context.selection).slice(0, 3000)}\n"""`, text),
  ].filter(Boolean).join('\n\n');
}
