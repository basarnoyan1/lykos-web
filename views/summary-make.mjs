// Make, on the Data summary (owner, 2026-10-22: "there is no place to make a fresh figure or analysis freely and easily, a pie chart of
// fusion types, a swim of deformities, a meta-analysis of two-stage, and it should tell me dynamically, especially for the meta-analyses,
// whether they make sense, with colours and a grading like bars"; 2026-10-23: "make it a full implementation"). One panel over the fields:
// the head holds the mode (Chart, Swimmer, Meta-analysis, SWiM, Survival) and the mode's one primary action, what the result becomes; a
// tools bar holds every pick as a select drawn from the fields, nothing typed; the result stands under it at its own size, drawn as the
// picks change, over the studies the filter keeps. Each mode is its own module (views/make-*.mjs); the statistics are the app's own
// (lib/make-stats.mjs, lib/km-js.mjs, lib/make-swim.mjs) and the keeping lib/make-save.mjs's. The shell here: the head, the tools bar,
// the panel, a figure drawn again at the width its box has, the cards and the picks every mode shares.
import { esc } from '../lib/html.mjs';
import { plural } from '../lib/dates.mjs';
import { uiBar } from '../lib/ui-actions.mjs';
import { icon } from '../lib/icons.mjs';
import { chartHtml } from './make-chart.mjs';
import { swimmerHtml } from './make-swimmer.mjs';
import { metaHtml } from './make-meta.mjs';
import { swimHtml } from './make-swim.mjs';
import { survivalHtml } from './make-survival.mjs';
export { keep } from '../lib/make-save.mjs';
export { robOf } from '../lib/swim-state.mjs';
export { assessmentRows } from '../lib/appraisal-summary.mjs';

/** A screen chart fills the width its box has (lib/analysis-charts.mjs); these bound a measured width before the box has one. */
export const FOREST_WIDTH = 1400;
export const FOREST_MIN = 280;

// the cards and their bars are shared with Submission › Files (lib/grade-cards.mjs)
import { card, cards } from '../lib/grade-cards.mjs';
export { card, cards };
/** The verdict banner of a graded synthesis. */
export const verdictHtml = (g, text) => `<div class="mk-verdict" data-tone="${g.tone}">${icon(g.tone === 'good' ? 'check' : g.tone === 'unclear' ? 'warn' : 'close', { size: 14 })}<strong>${esc(g.verdict)}</strong><span>${esc(text)}</span></div>`;
/**
 * A compact table: `head` the column names, `rows` arrays of cells (the first a row head), the last row bold when `all`. Every cell is
 * text and escaped here (labels come from spreadsheets); a cell that carries markup of its own is `{ html }`.
 */
const cell = c => (c && typeof c === 'object' && 'html' in c ? c.html : esc(c ?? ''));
export const table = (label, head, rows, { all = false } = {}) => `<table class="mk-table" aria-label="${esc(label)}"><thead><tr>${head.map(h => `<th scope="col">${cell(h)}</th>`).join('')}</tr></thead><tbody>${rows.map((r, i) =>
  `<tr${all && i === rows.length - 1 ? ' data-all' : ''}><th scope="row">${cell(r[0])}</th>${r.slice(1).map(c => `<td>${cell(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;

// an option reads in its first words: five selects at their natural widths stand on one row of a wide pane, the engine stacking them only in a narrow one
const short = t => (String(t).length > 26 ? `${String(t).slice(0, 25)}…` : String(t));
/** A pick of the tools bar: a select named by what it chooses, its value the current choice. */
export const pick = (key, label, options, value) => ({ type: 'select', id: `mk-${key}`, label, options: options.map(([v, l]) => [v, short(l)]), value: String(value ?? '') });
/** A yes-or-no pick. */
export const check = (key, label, on) => ({ type: 'check', id: `mk-${key}`, label, value: !!on });

/**
 * The panel. `ctx`: { make (its state), fields (the summary over the studies kept), kept (their ids, or every study), total, studyLabel(id),
 * yearOf(id), choicesOf(field), valueText(paperId, fieldId), drill(label, paperIds), st (the project), templateOf(fieldId), robOf(paperId),
 * datasets, participants, ipdColumns }. Answers { html, keep, fits }: `keep` what the primary action files (lib/make-save.mjs keep), `fits`
 * the drawings to redo at a measured width (the view measures each [data-mk-fit] box and calls fits[key](width)).
 */
export function makeHtml(ctx) {
  const mk = ctx.make, kept = ctx.kept;
  const hasData = (ctx.datasets || []).length > 0 || (ctx.participants || []).length > 0;
  const modes = [['chart', 'Chart'], ['swimmer', 'Swimmer'], ['meta', 'Meta-analysis'], ['swim', 'SWiM'], ...(hasData ? [['survival', 'Survival']] : [])];
  if (!modes.some(m => m[0] === mk.what)) mk.what = 'chart';
  // the head: the mode, the one primary action of the mode (what the result becomes), Close
  const head = primary => uiBar({ kind: 'head', label: 'Make', id: 'mk-head', lead: { title: 'Make', level: 'h3' },
    view: { id: 'mk-what', label: 'What to make', attr: 'data-mk-what', value: mk.what, items: modes },
    actions: [...(primary ? [primary] : []), { id: 'mk-close', label: 'Close', icon: 'close', role: 'quiet', iconOnly: true }] });
  const count = kept.size < ctx.total ? `${plural(kept.size, 'study', 'studies')} of ${ctx.total}` : plural(kept.size, 'study', 'studies');
  const none = { keep: null, fits: {} };
  const kit = {
    count, card, cards, table, pick, check, verdictHtml,
    // `extra.menus` the entries of a tools bar's menu button ([data-mk-menu]), each with what it `set`s on the mode's state
    panel: (tools, view, extra = {}) => ({ ...none, html: `<section class="mk" aria-label="Make">${head(extra.primary)}${tools}<div class="mk-body"><div class="mk-view">${view}</div></div></section>`, ...extra, primary: undefined }),
    tools: (filters, actions = []) => uiBar({ kind: 'tools', label: 'Make from', id: 'mk-picks', filters, actions }),
    empty: (filters, words) => kit.panel(filters.length ? kit.tools(filters) : '', `<p class="meta mk-empty">${esc(words)}</p>`),
    // the primary act: what the result becomes (an output, an analysis, a domain of Certainty, a record)
    primary: (label, on = true, { id = 'mk-keep', icon: ico = 'plus', attrs } = {}) => ({ id, label, icon: ico, role: 'primary', disabled: !on, ...(attrs ? { attrs } : {}) }),
    figure: (title, note, svg) => `<figure class="es-hist chart-svg mk-fig"><figcaption>${esc(title)}<span class="mk-fig-count">${esc(note)}</span></figcaption>${svg}</figure>`,
    // a chart drawn again at its box's width, under a title row: the name and a one-line summary in muted text
    chart: (key, title, note, draw, opts = {}) => { const f = kit.fitted(key, draw, opts); return { html: `<figure class="mk-fig mk-sub"><figcaption>${esc(title)}<span class="mk-fig-count">${esc(note)}</span></figcaption>${f.html}</figure>`, fit: f.fit }; },
    // a figure drawn again at the width its box has (data-mk-fit names the drawing in `fits`; the view measures and calls it)
    fitted: (key, draw, { cls = 'es-hist chart-svg mk-plot', tag = 'div', label = key, floor = 280, cap = 1400 } = {}) => { const at = w => draw(Math.max(floor, Math.min(cap, Math.round(w)))); return { html: `<${tag} class="${cls}" data-mk-fit="${key}" aria-label="${esc(label)}">${at(cap)}</${tag}>`, fit: at }; },
    where: kept.size < ctx.total ? { where: [{ col: 'id', op: 'in', value: [...kept] }] } : {},
    at: ids => (ctx.drill ? { 'data-es-drill': ctx.drill(ids.length === 1 ? ctx.studyLabel(ids[0]) : plural(ids.length, 'study', 'studies'), ids) } : {}),
  };
  if (mk.what === 'chart') return chartHtml(ctx, kit);
  if (mk.what === 'swimmer') return swimmerHtml(ctx, kit);
  if (mk.what === 'swim') return swimHtml(ctx, kit);
  if (mk.what === 'survival') return survivalHtml(ctx, kit);
  return metaHtml(ctx, kit);
}
