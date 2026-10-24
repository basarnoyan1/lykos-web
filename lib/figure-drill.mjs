// The studies behind a figure's mark, and the study rows every list of studies on the item pages shares (plan §2, "Submission files,
// structured: details", 2026-10-24). A screen drawing marks what stands for studies with `data-studies` (paper ids, space separated) and
// `data-drill-label` (what the mark is: "Titanium rod, Cosmic, No fusion"); a press on it lists those studies under the drawing, each opening
// its record, as the Data summary's drill does; its tooltip names them. A mark of one study (`data-idt-study`, a forest's row) opens it at
// once. Print and export drawings carry none of this.
//
// A study row (studyRow) is one compact row of the shared list builder: its label and its title on one line (the title clamped, whole in
// the tooltip), its journal and year muted under it, the whole row the press that opens it, its More at the first line's end.
import { get } from '../store.mjs';
import { esc } from './html.mjs';
import { uiBar, uiList, uiRow, uiRowEnd } from './ui-actions.mjs';
import { showMenu } from './menu.mjs';
import { pageOf, pager, wirePager } from './paging.mjs';

const papersBy = () => { const m = new Map(); for (const p of get().papers || []) { m.set(p.id, p); if (p.key) m.set(p.key, p); } return m; };
/** The ids a mark carries. */
export const idsOf = el => String(el?.getAttribute?.('data-studies') || '').split(/\s+/).filter(Boolean);
/** A study's short name: its label, else its first author and year, else its id. */
export const nameOf = (p, id = '') => (p ? p.label || `${String(p.authors?.[0] || '').split(',')[0]} ${p.year || ''}`.trim() || p.title || id : id);
/** The names of the studies behind a mark, for its tooltip: all of them up to eight, then how many more. */
export function namesOf(ids) {
  const by = papersBy(), names = [...new Set(ids)].map(id => nameOf(by.get(id), id));
  return names.length > 8 ? `${names.slice(0, 8).join(', ')} and ${names.length - 8} more` : names.join(', ');
}

/**
 * One study as a compact row: `p` the paper (null for a label the library does not answer), `id` what a press opens, `detail` the muted
 * second line (its journal and year by default), `note` a word after them (a reason, a state).
 */
export function studyRow(p, { id = p?.id || '', label = '', detail = null, note = '', more = true } = {}) {
  const name = label || nameOf(p, id), title = p?.title && p.title !== name ? p.title : '';
  const facts = detail ?? [p?.journalAbbr || p?.journal, p?.year].filter(Boolean).map(x => esc(String(x)));
  const main = p ? `<button type="button" class="fd-open" data-fd-open="${esc(id)}" title="${esc([name, title].filter(Boolean).join(': '))}"><span class="fd-name">${esc(name)}</span>${title ? `<span class="fd-title">${esc(title)}</span>` : ''}</button>`
    : `<span class="fd-name">${esc(name)}</span>`;
  return uiRow({ cls: 'fd-row', attrs: { ...(p ? { 'data-fd-row': id } : {}) }, main: { html: main, detail: [...facts, ...(note ? [esc(note)] : [])] },
    end: p && more ? uiRowEnd({ more: { label: `More for ${name}`, attrs: { 'data-fd-more': id } } }) : uiRowEnd({ reserve: true }) });
}
/** A list of study rows (uiList), its rows already drawn. */
export const studyList = ({ id, label, rows, empty = '' }) => uiList({ id, label, cls: 'fd-list', rows, empty });

/**
 * Makes the study rows under `root` answer: a press anywhere on a row but its More opens the study (`open(id)`); More offers Open PDF and
 * Show in Library (`library(id)`).
 */
export function wireStudyRows(root, { open, library }) {
  if (!root || root._fdWired) return;
  root._fdWired = true;
  root.addEventListener('click', e => {
    const more = e.target.closest?.('[data-fd-more]');
    if (more && root.contains(more)) {
      e.preventDefault();
      const p = papersBy().get(more.dataset.fdMore);
      showMenu(more, [{ label: 'Open PDF', disabled: !(p?.pdf || p?.pdfRel), run: () => open(more.dataset.fdMore, { pdf: true }) }, { label: 'Show in Library', run: () => library(more.dataset.fdMore) }]);
      return;
    }
    const row = e.target.closest?.('[data-fd-row]');
    if (row && root.contains(row) && !e.target.closest('.ui-row-end')) open(row.dataset.fdRow);
  });
}

// ---- the drill: the studies behind a mark, under its drawing --------------------------------------------------------------------------
const drillPage = new Map();   // drill host -> page
/** The studies behind a mark as a section: a head with its name and a Close, the rows, the pager. */
export function drillHtml(id, title, ids, { notes = new Map(), noun = ['study', 'studies'] } = {}) {
  const by = papersBy(), list = [...new Set(ids)], shown = pageOf(list, drillPage.get(id) || 1, 8);
  const rows = shown.items.map(k => studyRow(by.get(k) || null, { id: k, note: notes.get(k) || '' }));
  return `<section class="fd-drill" aria-label="${esc(`Studies: ${title}`)}">${uiBar({ kind: 'head', id: `${id}-head`, label: `Studies: ${title}`, lead: { title: `${title}: ${list.length} ${noun[list.length === 1 ? 0 : 1]}`, level: 'h3' },
    actions: [{ id: `${id}-close`, label: 'Close', role: 'quiet', attrs: { 'data-fd-close': id } }] })}
    ${studyList({ id: `${id}-list`, label: `Studies: ${title}`, rows })}${pager({ id: `${id}-pages`, page: shown.page, pages: shown.pages, total: list.length, label: noun[1], size: 8 })}</section>`;
}

/**
 * Wires the marks of a drawing in `host` (an element holding the drawing, and room after it for the drill): each `[data-studies]` mark
 * names its studies in its tooltip and, pressed, lists them in `slot` (made after `host` when not given); each `[data-idt-study]` mark opens
 * its study. `open(id)` opens a study, `library(id)` shows it in the Library. `notesOf(el)` may give a note per study (a box's reasons).
 */
export function wireDrill(host, { open, library, slot = null, id = 'fd', notesOf = null } = {}) {
  if (!host) return;
  for (const el of host.querySelectorAll('[data-studies]')) {
    // a mark that says its own words (data-chart-tip, lib/chart-interact.mjs shows them at once) gets no <title> over them
    if (el.hasAttribute('data-chart-tip')) { if (!el.hasAttribute('tabindex')) el.setAttribute('tabindex', '0'); if (!el.hasAttribute('role')) el.setAttribute('role', 'button'); continue; }
    const names = namesOf(idsOf(el)), what = el.getAttribute('data-drill-label') || '';
    const tip = `${what ? `${what}: ` : ''}${names}`;
    if (el.namespaceURI === 'http://www.w3.org/2000/svg') {
      const t = el.querySelector(':scope > title') || el.ownerDocument.createElementNS('http://www.w3.org/2000/svg', 'title');
      t.textContent = t.textContent && !t.textContent.includes(names) ? `${t.textContent}\n${names}` : tip;
      if (!t.parentNode) el.prepend(t);
    } else el.title = tip;
    if (!el.hasAttribute('tabindex')) el.setAttribute('tabindex', '0');
    if (!el.hasAttribute('role')) el.setAttribute('role', 'button');
    el.setAttribute('aria-label', tip);
  }
  for (const el of host.querySelectorAll('[data-idt-study]')) if (!el.hasAttribute('tabindex')) el.setAttribute('tabindex', '0');
  const place = () => {
    if (slot) return slot;
    let s = host.nextElementSibling;
    if (!s || !s.matches('[data-fd-slot]')) { s = document.createElement('div'); s.setAttribute('data-fd-slot', ''); host.after(s); }
    return s;
  };
  const show = el => {
    const target = place(), draw = () => {
      target.innerHTML = drillHtml(id, el.getAttribute('data-drill-label') || 'Studies', idsOf(el), { notes: notesOf ? notesOf(el) : new Map(), ...(el.getAttribute('data-drill-noun') === 'records' ? { noun: ['record', 'records'] } : {}) });
      target.querySelector(`[data-fd-close="${id}"]`)?.addEventListener('click', () => { target.innerHTML = ''; drillPage.delete(id); host.querySelectorAll('[data-fd-on]').forEach(x => x.removeAttribute('data-fd-on')); });
      wirePager(target, `${id}-pages`, n => { drillPage.set(id, n); draw(); });
      wireStudyRows(target, { open, library });
    };
    drillPage.set(id, 1);
    host.querySelectorAll('[data-fd-on]').forEach(x => x.removeAttribute('data-fd-on'));
    el.setAttribute('data-fd-on', '');
    draw();
    target.scrollIntoView?.({ block: 'nearest' });
  };
  const act = e => {
    const one = e.target.closest?.('[data-idt-study]');
    if (one && host.contains(one)) { e.preventDefault?.(); open(one.getAttribute('data-idt-study')); return; }
    const el = e.target.closest?.('[data-studies]');
    if (el && host.contains(el)) { e.preventDefault?.(); show(el); }
  };
  // drawn again into the same host (a resize, a switch): one listener pair, the last drawing's
  if (host._fdAct) { host.removeEventListener('click', host._fdAct.click); host.removeEventListener('keydown', host._fdAct.key); }
  host._fdAct = { click: act, key: e => { if (e.key === 'Enter' || e.key === ' ') act(e); } };
  host.addEventListener('click', host._fdAct.click);
  host.addEventListener('keydown', host._fdAct.key);
}
