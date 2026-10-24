// What every model call is told, whoever makes it.
//
// Lives apart from lib/aid.mjs so lib/ai.mjs can use it without a cycle:
// complete() adds the guard and the project brief to any call that does not
// already carry them, so a helper or an action written later cannot forget
// either (plan §6: documents are untrusted; the user asked that the model
// always know the context).
import { get } from '../store.mjs';
import { GUARDS, SYSTEM_GUARD, hasGuard } from './prompts.mjs';
export { SYSTEM_GUARD };

/** The first sentence of a note, at most n characters. */
const first = (t, n) => { const x = String(t || '').replace(/\s+/g, ' ').trim(); const m = /^(.+?[.!?])(\s|$)/.exec(x); const y = m && m[1].length <= n ? m[1] : x; return y.length > n ? `${y.slice(0, n - 1)}…` : y; };

/**
 * What the team has decided about how the tables are written, for a model that
 * proposes cells or text: each table's notes (first sentence), the general cell
 * rules, and where the folder's own guide is. Bounded; the full rules stay in
 * the guide file and the rules editor, and the model is told where.
 */
export function conventionsBrief(s = get(), { max = 1100 } = {}) {
  const lines = [];
  for (const t of (s.templates || []).slice(0, 2))
    for (const c of (t.conventions || []).slice(0, 6)) lines.push(`- ${first(c, 170)}`);
  const general = (s.templates || []).flatMap(t => t.rules?.general || []).filter(r => r.message).slice(0, 5);
  for (const r of general) lines.push(`- Rule: ${first(r.message, 90)}`);
  const guide = s.folderInit?.files?.guide;
  const out = lines.length || guide ? [`Team conventions (data):`, ...lines, guide ? `Folder guide: ${guide} (read_file for the full rules before changing tables or files).` : ''].filter(Boolean).join('\n') : '';
  return out.length > max ? `${out.slice(0, max - 1)}…` : out;
}

/**
 * The project in a few lines: what it asks, how it decides, where it stands.
 * `counts: false` leaves out the progress line, which changes with every
 * decision, so the brief can sit in a request prefix a provider can cache.
 * `conventions: true` adds the team's table conventions (conventionsBrief).
 */
export function projectBrief(s = get(), { counts = true, criteria = true, conventions = false, pico: withPico = true } = {}) {
  const papers = s.papers || [];
  const pico = s.protocol?.pico || {};
  const crit = (s.protocol?.criteria || []).filter(c => c.text);
  const decided = papers.filter(p => s.screening?.[p.id]).length;
  const included = papers.filter(p => (s.fulltext?.[p.id] || s.screening?.[p.id])?.decision === 'include');
  return [
    `Review: ${s.paper?.title || s.protocol?.title || 'untitled'}`,
    ...['population', 'intervention', 'comparator', 'outcome', 'designs'].filter(k => withPico && pico[k]).map(k => `${k[0].toUpperCase()}${k.slice(1)}: ${pico[k]}`),
    !criteria ? '' : crit.length ? `Eligibility criteria:\n${crit.map((c, i) => `  ${c.id || `c${i + 1}`} (${c.stage || 'any stage'}): ${c.text}`).join('\n')}` : 'Eligibility criteria: none written',
    conventions && conventionsBrief(s),
    counts && `Records ${papers.length}; screened ${decided}; included ${included.length}${included.length ? ` (${included.slice(0, 30).map(p => p.label).join(', ')})` : ''}`,
  ].filter(Boolean).join('\n').slice(0, conventions ? 3600 : 2400);
}

/** Chat keeps detailed criteria and table conventions out of unrelated requests. */
export function chatBrief(s=get(), text='', focus=null) {
  const eligibility=/\b(screen|screening|eligible|eligibility|criteria|protocol|include|exclude)\b/i.test(text);
  const table=/\b(extract|extraction|cell|column|table|chart|patient)\b/i.test(text);
  return projectBrief(s,{counts:false,criteria:eligibility,conventions:table}) +
    (!eligibility ? `\nProtocol details: ${(s.protocol?.criteria||[]).length} criteria; read_project {section:"protocol"} when needed.` : '');
}

/** The brief a prompt asks for: 'full' | 'lean' (no counts) | 'pico' (no criteria either) | 'title' (the review's title only) | 'none'. */
export const BRIEF_LEVELS = { full: {}, lean: { counts: false }, pico: { counts: false, criteria: false }, title: { counts: false, criteria: false, pico: false } };

/**
 * Messages with the guard and the project brief, added only where missing:
 * the guard at the head of the first system message, the brief as a system
 * message after it. A call that already sends a brief (it starts "Review:")
 * is left as it is; `{ context: false }` in complete()'s options opts out, and
 * `{ context: { counts: false, criteria: false } }` sends a leaner brief to a
 * call that states the criteria itself or does not need the progress line.
 */
export function withContext(messages, s = get(), brief = {}, { guard = 'standard', withBrief = true } = {}) {
  const list = messages.map(m => ({ ...m }));
  const text = list.map(m => String(m.content || '')).join('\n');
  if (guard !== 'none' && !hasGuard(text)) {
    const sys = list.find(m => m.role === 'system');
    if (sys) sys.content = `${GUARDS[guard] || SYSTEM_GUARD}\n\n${sys.content}`;
    else list.unshift({ role: 'system', content: GUARDS[guard] || SYSTEM_GUARD });
  }
  if (withBrief && !/^Review: /m.test(text)) {
    const at = list.findIndex(m => m.role === 'system');
    list.splice(at + 1, 0, { role: 'system', content: `The project this concerns:\n${projectBrief(s, brief)}` });
  }
  return list;
}
