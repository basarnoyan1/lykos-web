// The graded cards of Make (views/summary-make.mjs) and Submission › Files' quality strip: a name, a value and, for a graded criterion, three
// bars whose fill is the grade (0 to 3) and whose tone follows it (.mk-bars in research-views.css: 3 good, 2 caution, 1 and 0 bad). Light,
// so a page shows them without loading Make.
import { esc } from './html.mjs';

/** Three bars for a grade of 0 to 3 (null: none filled, as for a value not assessed). */
export const bars = score => `<span class="mk-bars" data-score="${score ?? 0}" aria-label="${score == null ? 'Not assessed' : `${score} of 3`}">${[1, 2, 3].map(i => `<span${score != null && i <= score ? ' data-on' : ''}></span>`).join('')}</span>`;
/**
 * One card of a grid: its name, its value and, for a graded criterion, its three bars. `press` makes the card a button with those attributes
 * (Submission's tiles open their checks), `pressed` its state.
 */
export function card(name, value, { score = null, tip = '', press = null, pressed = false, verdict = null } = {}) {
  // `verdict`: { word, tone } a word in its tone (good, unclear, bad), as a metric tile says its state
  // a verdict sits on the number's line, baseline-aligned, so every card keeps three rows: name, number, bars
  const number = `<span class="mk-grade-value" title="${esc(value)}">${esc(value)}</span>`;
  const line = verdict ? `<span class="mk-grade-line">${number}<span class="mk-grade-verdict" data-tone="${esc(verdict.tone || '')}">${esc(verdict.word)}</span></span>` : number;
  const inner = `<span class="mk-grade-name">${esc(name)}</span>${line}${score != null || press ? bars(score) : ''}`;
  const common = `class="mk-grade${press ? ' mk-grade-press' : ''}"${score != null ? ` data-score="${score}"` : ''}${tip ? ` title="${esc(tip)}"` : ''}`;
  if (!press) return `<div ${common} role="listitem">${inner}</div>`;
  const attrs = Object.entries(press).map(([k, v]) => ` ${k}="${esc(v)}"`).join('');
  return `<div role="listitem" class="mk-grade-cell"><button type="button" ${common}${attrs} aria-expanded="${pressed}">${inner}</button></div>`;
}
/** A grid of cards; `n` chooses the columns that leave no orphan. */
export const cards = (list, label, cls = '') => `<div class="mk-grades${cls ? ` ${cls}` : ''}" role="list" data-n="${list.length}" aria-label="${esc(label)}">${list.join('')}</div>`;
