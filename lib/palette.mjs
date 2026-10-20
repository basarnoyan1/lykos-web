// The command palette (⌘K): one field reaching every view, command, library record and project file; anything else goes to the assistant.
// Sources are registered functions asked afresh on each open. Matching (search-ranking.mjs; search-smart.mjs once loaded) keeps the best sixty.
import { esc } from './html.mjs';
import { icon } from './icons.mjs';
import { rankItems } from './search-ranking.mjs';
export { score } from './search-ranking.mjs';

const MAX = 60;
/** The groups of a ranked list in the order of their best match, and the rows regrouped under them (matches keep their order inside a group). */
export const groupOrder = items => [...new Set(items.map(it => it.group || ''))];
export const groupRows = items => groupOrder(items).flatMap(g => items.filter(it => (it.group || '') === g));
const sources = [];
let box = null;
let origin = { el: null, selection: '' };
export const openedFrom = () => origin;   // the focus and selection when it opened (its field takes both)

/**
 * A source returns items: { label, run, group, icon?, meta?, keys? (extra text to match) }.
 * A live source is given the query and asked again as it changes; the rest are
 * asked once when the palette opens.
 */
export function addSource(fn, { live = false } = {}) { sources.push(Object.assign(fn, { live })); }

export const isOpen = () => !!box;
export function close() { box?.remove(); box = null; }

export async function open(initial = '') {
  if (box) { box.querySelector('input').select(); return; }
  origin = { el: document.activeElement, selection: String(getSelection?.() || '').trim() };
  box = document.createElement('div');
  const openedBox=box;
  box.className = 'palette-scrim';
  box.innerHTML = `<div class="palette" role="dialog" aria-label="Commands">
    <div class="palette-in">${icon('search')}<input type="text" spellcheck="false" autocomplete="off"
      placeholder="Find papers, notes, tasks, files, or commands" aria-label="Command" role="combobox" aria-expanded="true" aria-controls="palette-list"></div>
    <div class="palette-list" id="palette-list" role="listbox"></div></div>`;
  document.body.append(box);
  const input = box.querySelector('input');
  const list = box.querySelector('.palette-list');
  box.addEventListener('mousedown', e => { if (e.target === box) close(); });

  let all = [];
  let shown = [];
  let sel = 0;
  let ready = false, early = false;   // Enter before the sources answer runs once they do
  let fixed = [], found = [], asked = 0;
  let smart = null;   // search-smart.mjs
  import('./search-smart.mjs').then(m => { smart = m; if (box === openedBox && ready) paint(); });
  const ask = (fns,q=input.value.trim()) => Promise.all(fns.map(f => Promise.resolve().then(() => f(q)).catch(() => []))).then(l => l.flat().filter(Boolean));
  const gather = async () => {
    [fixed, found] = await Promise.all([ask(sources.filter(f => !f.live)), ask(sources.filter(f => f.live))]);
    all = [...fixed, ...found];
  };
  // A live source answers the query as typed; a slower answer to an older query is dropped.
  let liveT = null;
  const refreshLive = () => { const n=++asked,q=input.value.trim();clearTimeout(liveT);liveT = setTimeout(async () => {
    const r = await ask(sources.filter(f => f.live),q);
    if (n !== asked || box!==openedBox) return;
    found = r; all = [...fixed, ...found]; paint();
    list.dataset.answered = q;   // the query last answered
  }, 120); };
  const paint = () => {
    const q = input.value.trim().toLowerCase();
    shown = rankItems(all,q,{limit:MAX,...(smart&&q?smart.hooks(q):{})});
    // Whatever was typed can always go to the assistant, last.
    if (q) shown.push(...all.filter(it => it.fallback).map(it => ({ ...it, label: it.fallback(input.value.trim()) })));
    sel = Math.min(sel, Math.max(0, shown.length - 1));
    const order = groupOrder(shown);
    shown = groupRows(shown);
    const row = (it, i) => `<div class="palette-row${i === sel ? ' on' : ''}" role="option"
        aria-selected="${i === sel}" id="palette-option-${i}" data-i="${i}">
        <span class="palette-ico">${icon(it.icon || 'dot')}</span>
        <span class="palette-label">${smart && q && !it.fallback ? smart.mark(it.label, q) : esc(it.label)}</span>
        ${it.meta ? `<span class="palette-meta">${esc(it.meta)}</span>` : ''}</div>`;
    list.innerHTML = shown.length ? order.map(g => {
      const rows = shown.map((it, i) => (it.group || '') === g ? row(it, i) : '').join('');
      return g ? `<div role="group" aria-label="${esc(g)}"><div class="palette-heading" aria-hidden="true">${esc(g)}</div>${rows}</div>` : rows;
    }).join('')
      : smart?.none(all, q) || '<div class="palette-none">No match</div>';
    selectRow();
  };
  const selectRow=()=>{list.querySelectorAll('.palette-row').forEach((r,i)=>{r.classList.toggle('on',i===sel);r.setAttribute('aria-selected',String(i===sel));});if(shown.length)input.setAttribute('aria-activedescendant',`palette-option-${sel}`);else input.removeAttribute('aria-activedescendant');const on=list.querySelector('.on');(on?.previousElementSibling?.classList.contains('palette-heading')?on.previousElementSibling:on)?.scrollIntoView({block:'nearest'});};
  const run = i => {
    const it = shown[i]; if (!it) return;
    const text = input.value.trim();
    close();
    it.run(text);
  };
  input.addEventListener('input', () => { sel = 0; paint(); if (ready) refreshLive(); });
  input.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown') { e.preventDefault(); sel = Math.min(shown.length - 1, sel + 1); selectRow(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); sel = Math.max(0, sel - 1); selectRow(); }
    else if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); if (ready) run(sel); else early = true; }
    else if (e.key === 'Escape') { e.preventDefault(); close(); }
    e.stopPropagation();
  });
  list.addEventListener('mousemove', e => {
    const r = e.target.closest('.palette-row'); if (!r || +r.dataset.i === sel) return;
    sel = +r.dataset.i; selectRow();
  });
  list.addEventListener('click', e => {
    const tryIt = e.target.closest('[data-try]');
    if (tryIt) { input.value = tryIt.dataset.try; sel = 0; paint(); refreshLive(); return; }
    const r = e.target.closest('.palette-row'); if (r) run(+r.dataset.i);
  });
  input.value = initial;
  input.focus();
  await gather();
  ready = true;
  if (box===openedBox) { paint();refreshLive(); if (early) run(sel); }
}
