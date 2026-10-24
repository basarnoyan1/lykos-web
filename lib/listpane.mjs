// The list pane's rows: a virtual list of fixed-height rows.
//
// A library can hold ten thousand records. Drawing every row costs seconds
// and memory the desktop app should not spend, so only the rows in view (and
// a margin either side) exist in the page; a spacer gives the list its full
// height, so the scrollbar tells the truth. Rows are one height, which is what
// makes the arithmetic exact and keeps anything from moving when a row's
// content changes.
//
// Selection never redraws the list: the selected row's class changes in place.
// New items (a decision made, a record added) redraw only the rows in view.
import { esc } from './html.mjs';
import { icon } from './icons.mjs';

export const ROW = 72;          // px; the .pl-row height in workspace.css: one row anatomy for every list pane (three lines: a title of up to two, a detail line or two, an end cell)
export const GROUP = 28;        // px; a group label row ({ group: true, title }): it names the rows after it and is never selected
const OVERSCAN = 6;
// A risk-of-bias judgement's light (`dot`), drawn as the traffic light and the Appraisal fields draw it: the colour and a symbol that carries it.
const DOT_ICON = { good: 'check', unclear: 'minus', bad: 'close', critical: 'warn' };
// a verdict's word is led by its icon, which alone carries the verdict's colour (views/screening-bars.mjs VERDICT_ICON)
const TONE_ICON = { include: 'check', exclude: 'close', uncertain: 'minus' };
// a word's width at the list's small size (the marks and quiet words are 12px); measured once per word, without a layout
let pen = null;
const widths = new Map();
function textWidth(text) {
  if (widths.has(text)) return widths.get(text);
  if (!pen && typeof document !== 'undefined' && typeof getComputedStyle === 'function') {
    const css = getComputedStyle(document.documentElement);
    pen = document.createElement('canvas').getContext('2d');
    if (pen) pen.font = `400 ${css.getPropertyValue('--fs-sm').trim() || '12px'} ${css.getPropertyValue('--font').trim() || 'sans-serif'}`;
  }
  const w = pen ? pen.measureText(text).width : text.length * 7;
  if (pen && document.fonts?.check(pen.font) !== false) widths.set(text, w);   // a width taken before the face loaded is not kept
  return w;
}

/**
 * item: { id, title, sub?, meta?, mark?, markTone? ('include'|'exclude'|'uncertain'|'late'), dot? ('good'|'unclear'|'bad'|'critical'|'none'), icon? }
 * `dot` draws a judgement's light before the mark's word, which then stays neutral.
 * A record is one row like any other: its title, one detail line (authors, then what else the page needs), the year or date as the end cell, the state under it.
 * An item with an icon is a navigation row (one line: the icon, the name, a count); markTone 'late' sets its count heavier.
 * An item with `group: true` is a label row (GROUP px tall, no selection, skipped by the arrow keys): a view groups its rows under it.
 * setItems(list, selected, rowHeight): rows are rowHeight px tall (default ROW); under ROW a row is one line (.pl-line): title, mark, meta.
 */
export function createList({ body, space, onSelect, onOpen, onPreview }) {
  let items = [], selected = null, first = -1, last = -1, rowHeight = ROW, tops = [0];
  const indexOf = id => items.findIndex(x => x.id === id);
  const heightOf = i => items[i]?.group ? GROUP : rowHeight;
  // tops[i] is where row i starts; the last entry is the list's height. Rows are one height except group labels, so the sums are exact.
  const layout = () => { tops = [0]; for (let i = 0; i < items.length; i++) tops.push(tops[i] + heightOf(i)); };
  const rowAt = y => { let lo = 0, hi = items.length - 1; while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (tops[mid] <= y) lo = mid; else hi = mid - 1; } return lo; };
  const pickable = i => items[i] && !items[i].group;

  function row(it, i) {
    if (it.group) return `<div class="pl-row${' pl-group'}" role="presentation" data-id="${esc(it.id)}" data-i="${i}"><span class="pl-title">${esc(it.title || '')}</span></div>`;
    const dot = it.dot ? `<span class="rob-mark" data-tone="${esc(it.dot)}" aria-hidden="true">${DOT_ICON[it.dot] ? icon(DOT_ICON[it.dot], { size: 10 }) : ''}</span>` : '';
    const mark = it.mark ? `<span class="pl-mark${dot ? ' pl-dot' : it.markTone ? ` v-${esc(it.markTone)}` : ''}">${dot}${!dot && TONE_ICON[it.markTone] ? icon(TONE_ICON[it.markTone], { size: 12 }) : ''}<span>${esc(it.mark)}</span></span>` : '';
    const content = `${it.icon ? icon(it.icon, { size: 16 }) : ''}<span class="pl-title" title="${esc(it.title || '')}">${esc(it.title || '')}</span>${it.meta && !(/^\d{4}$/.test(it.meta) && String(it.title || '').endsWith(` ${it.meta}`)) ? `<span class="pl-meta">${esc(it.meta)}</span>` : ''}${it.sub ? `<span class="pl-sub" title="${esc(it.sub)}">${esc(it.sub)}</span>` : ''}${mark}`;
    return `<div class="pl-row${it.icon ? ' pl-nav' : rowHeight < ROW ? ' pl-line' : ''}${it.icon && it.markTone === 'late' ? ' late' : ''}${it.id === selected ? ' sel' : ''}" role="option" aria-selected="${it.id === selected}"
      data-id="${esc(it.id)}" data-i="${i}">${content}</div>`;
  }

  function draw(force = false) {
    const top = body.scrollTop, h = body.clientHeight || 600;
    const a = items.length ? Math.max(0, rowAt(top) - OVERSCAN) : 0;
    const b = Math.min(items.length - 1, (items.length ? rowAt(top + h) : 0) + OVERSCAN);
    if (!force && a === first && b === last) return;
    first = a; last = b;
    space.style.height = `${tops[items.length]}px`;
    let html = '';
    for (let i = a; i <= b; i++) html += row(items[i], i);
    space.innerHTML = html;
    // Positions are set as properties: the desktop app's style policy drops inline style attributes.
    for (const r of space.children) { const i = Number(r.dataset.i); r.style.setProperty('top', `${tops[i]}px`); r.style.setProperty('height', `${heightOf(i)}px`); }
    fitSub();
  }
  // A row is three lines tall: a title of one line leaves its detail two (data-sub2), so the detail wraps instead of ending in an ellipsis
  // on its first line (owner, 2026-10-17). Measured on the rows in view only, after they are drawn; the row's height never changes.
  function fitSub() {
    if (rowHeight < ROW) return;
    const rows = [...space.children].filter(r => r.querySelector(':scope > .pl-sub'));
    const one = rows.map(r => { const t = r.querySelector(':scope > .pl-title'); return t && t.getClientRects().length && t.offsetHeight < 1.75 * parseFloat(getComputedStyle(t).lineHeight); });
    rows.forEach((r, k) => r.toggleAttribute('data-sub2', !!one[k]));
  }

  function markSelected() {
    for (const r of space.children) {
      const on = r.dataset.id === selected;
      r.classList.toggle('sel', on); r.setAttribute('aria-selected', String(on));
    }
  }

  function scrollTo(id) {
    const i = indexOf(id); if (i < 0) return;
    const top = tops[i], bottom = tops[i + 1];
    if (top < body.scrollTop) body.scrollTop = top;
    else if (bottom > body.scrollTop + body.clientHeight) body.scrollTop = bottom - body.clientHeight;
  }

  body.addEventListener('scroll', () => draw());
  new ResizeObserver(() => draw(true)).observe(body);
  body.addEventListener('click', e => {
    const r = e.target.closest('.pl-row'); if (!r || r.classList.contains('pl-group')) return;
    body.focus({ preventScroll: true });
    onSelect(r.dataset.id);
  });
  body.addEventListener('keydown', e => {
    if (!items.length) return;
    const i = Math.max(0, indexOf(selected));
    // the nearest item that is not a group label, from `from` in direction `step`
    const step = (from, d) => { for (let k = from; k >= 0 && k < items.length; k += d) if (pickable(k)) return items[k]; return null; };
    let next = null;
    if (e.key === 'ArrowDown') next = selected == null ? step(0, 1) : step(i + 1, 1) || (pickable(i) ? items[i] : null);
    else if (e.key === 'ArrowUp') next = step(i - 1, -1) || (pickable(i) ? items[i] : null);
    else if (e.key === 'Home') next = step(0, 1);
    else if (e.key === 'End') next = step(items.length - 1, -1);
    else if (e.key === 'Enter' || e.key === 'ArrowRight') { e.preventDefault(); onOpen?.(selected); return; }
    // Space previews the selected item's document, as Quick Look does in the Finder.
    else if (e.key === ' ' && onPreview && selected != null) { e.preventDefault(); onPreview(selected); return; }
    if (!next) return;
    e.preventDefault(); e.stopPropagation();
    onSelect(next.id);
  });

  return {
    /** New items; the scroll position and the selection are kept. */
    setItems(list, sel = selected, height = 0) {
      items = list || []; selected = sel; rowHeight = height > 0 ? height : ROW;
      // judgements with a light are a column: every mark is as wide as the longest word of the list, so the lights stand on one edge
      space.style.setProperty('--pl-mark-ch', String(Math.max(0, ...items.filter(x => x.dot && x.mark).map(x => String(x.mark).length))));
      // on one-line rows the mark and the quiet word are columns of the list, not of each row: as wide as the widest of the list, so a
      // short word ("RoB 2") does not pull its row's mark off the edge the others stand on (owner, 2026-10-24: "alignment review")
      const widest = (key, extra) => { const w = Math.max(0, ...items.filter(x => x[key]).map(x => textWidth(String(x[key])))); return w ? `${Math.ceil(w + extra(w))}px` : ''; };
      const markW = widest('mark', () => (items.some(x => x.dot && x.mark) ? 16 + 4 : items.some(x => TONE_ICON[x.markTone]) ? 12 + 4 : 0)), metaW = widest('meta', () => 0);
      if (rowHeight < ROW && markW) space.style.setProperty('--pl-mark-w', markW); else space.style.removeProperty('--pl-mark-w');
      if (rowHeight < ROW && metaW) space.style.setProperty('--pl-meta-w', metaW); else space.style.removeProperty('--pl-meta-w');
      layout(); draw(true);
    },
    setSelected(id) { selected = id; markSelected(); scrollTo(id); },
    items: () => items,
    focus() { body.focus({ preventScroll: true }); },
  };
}
