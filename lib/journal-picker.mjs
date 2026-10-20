import { esc } from './html.mjs';
import { icon } from './icons.mjs';
import { pagerBar, wirePager } from './paging.mjs';
import { pickerDialog, pickerRows } from './dialog.mjs';
import { formField } from './ui-components.mjs';
import { num } from './dates.mjs';
import { withPresets } from './journal-presets.mjs';
import { mergeDirectory, rankJournals, byName } from './journal-directory.mjs';

// The journal directory (lib/journal-directory.mjs): the style catalog and NLM's list, read when a journal search first needs it.
let catalog;
const asset = name => fetch(new URL(`../assets/journals/${name}`, import.meta.url)).then(r => { if (!r.ok) throw new Error('Journal catalog unavailable'); return r.json(); });
export const loadJournalCatalog = () => catalog ||= Promise.all([asset('zotero-catalog.json'), asset('nlm-journals.json')])
  .then(([styles, nlm]) => byName(withPresets(mergeDirectory(styles.entries, nlm.entries)))).catch(err => { catalog = null; throw err; });

/** The entries matching `query`, best first (lib/journal-directory.mjs). */
export const filterJournals = rankJournals;

let suggestionId = 0;
/** Inline catalogue lookup; a typed journal remains valid without a selection. */
export function suggestJournals(input, { selector = false, journals = [] } = {}) {
  const host = document.createElement('div'); host.className = 'journal-autocomplete';
  input.before(host); host.append(input);
  input.autocomplete = 'off'; input.spellcheck = false;
  let toggle;
  if (selector) {
    host.classList.add('journal-selector');
    input.setAttribute('aria-label', input.labels?.[0]?.querySelector('span')?.textContent || 'Journal');
    host.insertAdjacentHTML('beforeend', `<button type="button" class="icon quiet journal-toggle" aria-label="Show journals">${icon('chevron-down')}</button>`);
    toggle = host.lastElementChild;
  }
  const list = document.createElement('div'); list.className = 'journal-suggestions';
  list.id = `journal-suggestions-${++suggestionId}`; list.setAttribute('role', 'listbox');
  list.setAttribute('aria-label', 'Journal suggestions'); list.hidden = true; host.append(list);
  input.setAttribute('role', 'combobox'); input.setAttribute('aria-autocomplete', 'list');
  input.setAttribute('aria-controls', list.id); input.setAttribute('aria-expanded', 'false');
  let revision = 0, active = -1, choices = [];
  const close = () => {
    revision++; list.hidden = true; active = -1;
    input.setAttribute('aria-expanded', 'false'); input.removeAttribute('aria-activedescendant');
  };
  const highlight = index => {
    active = index;
    [...list.children].forEach((b, i) => b.setAttribute('aria-selected', String(i === active)));
    if (active >= 0) {
      input.setAttribute('aria-activedescendant', list.children[active].id);
      list.children[active].scrollIntoView({ block: 'nearest' });
    } else input.removeAttribute('aria-activedescendant');
  };
  const choose = index => {
    input.value = choices[index]; close();
    // Preserve the setup form's normal draft saving without reopening this list.
    input.dispatchEvent(new Event('input', { bubbles: true })); close();
    input.dispatchEvent(new Event('change', { bubbles: true })); input.focus();
  };
  const suggest = async () => {
    const query = input.value.trim(); close();
    if ((!selector && [...query].length < 3) || input.matches(':disabled')) return;
    const request = revision;
    let entries;
    try { entries = await loadJournalCatalog(); } catch { entries = []; }
    if (request !== revision || !input.isConnected || document.activeElement !== input) return;
    const known = [...new Set(journals.map(name => String(name || '').trim()).filter(Boolean))].map(label => ({ label, id: label }));
    const matches = filterJournals([...known, ...entries], query);
    const prefix = query.toLocaleLowerCase();
    const names = [...new Set([
      ...matches.filter(j => j.label.toLocaleLowerCase().startsWith(prefix)),
      ...matches.filter(j => !j.label.toLocaleLowerCase().startsWith(prefix)),
    ].map(j => j.label))].slice(0, 8);
    const custom = query && !names.some(name => name.toLocaleLowerCase() === query.toLocaleLowerCase());
    choices = custom ? [...names, query] : names;
    if (!choices.length) return;
    list.innerHTML = choices.map((name, i) => `<button type="button" role="option" tabindex="-1" aria-selected="false" id="${list.id}-${i}" data-choice="${i}"${i === names.length ? ' class="journal-custom"' : ''}>${i === names.length ? `Use “${esc(name)}”` : esc(name)}</button>`).join('');
    list.hidden = false; input.setAttribute('aria-expanded', 'true');
    const viewport = host.closest('.paper-sheet-scroll');
    if (viewport) {
      const bounds = host.getBoundingClientRect(), view = viewport.getBoundingClientRect();
      list.classList.toggle('journal-suggestions-above', view.bottom - bounds.bottom < list.offsetHeight + 6 && bounds.top - view.top > view.bottom - bounds.bottom);
    }
  };
  input.addEventListener('input', suggest);
  input.addEventListener('focus', suggest);
  input.addEventListener('blur', close);
  if (toggle) {
    toggle.onmousedown = e => e.preventDefault();
    toggle.onclick = () => { if (!list.hidden) close(); else { input.focus(); suggest(); } };
  }
  input.addEventListener('keydown', e => {
    if (e.isComposing) return;
    if (list.hidden) { if (selector && e.key === 'ArrowDown') { e.preventDefault(); suggest(); } return; }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault(); highlight((active + (e.key === 'ArrowDown' ? 1 : active < 0 ? 0 : -1) + choices.length) % choices.length);
    } else if (e.key === 'Enter' && active >= 0) {
      e.preventDefault(); choose(active);
    } else if (e.key === 'Escape') {
      e.preventDefault(); e.stopPropagation(); close();
    }
  });
  list.onmousedown = e => e.preventDefault();
  list.onclick = e => { const b = e.target.closest('[data-choice]'); if (b) { e.preventDefault(); choose(Number(b.dataset.choice)); } };
}

/** Choose the target journal from the catalogue, or name one that is not in it. Resolves to `{ id, label, style }`, or null when cancelled. */
export function chooseJournal({ current = '' } = {}) {
  const other = formField('Journal name', `<input id="journal-other-name" placeholder="Enter a journal name" value="${esc(current)}" maxlength="200">`);
  return pickerDialog({ id: 'journal-picker', title: 'Choose target journal', search: 'Search journals', confirm: 'Use journal', confirmDisabled: true,
    start: { id: 'other', label: 'Other journal' }, body: `<div class="journal-other" hidden>${other}</div>`, onMount: (d, close) => {
      const input = d.querySelector('[type=search]'), results = d.querySelector('.ask-picker-list'), apply = d.querySelector('[type=submit]');
      const otherBox = d.querySelector('.journal-other'), otherName = d.querySelector('#journal-other-name');
      const pagerHost = document.createElement('div'); pagerHost.className = 'pager'; pagerHost.id = 'journal-pager'; pagerHost.hidden = true; results.after(pagerHost);
      results.setAttribute('role', 'group'); results.setAttribute('aria-label', 'Journals');
      let entries = [], filtered = [], selected = null, page = 0;
      const pageSize = 30;
      const render = () => {
        const pages = Math.max(1, Math.ceil(filtered.length / pageSize)), from = page * pageSize + 1, to = Math.min((page + 1) * pageSize, filtered.length);
        results.innerHTML = pickerRows(filtered.slice(page * pageSize, (page + 1) * pageSize).map((j, i) => ({ value: page * pageSize + i, title: j.label, detail: [j.format, j.fields?.join(', '), j.format ? '' : j.abbr].filter(Boolean).join(' · ') })),
          { id: 'journal-list', label: 'Journals', selected: selected ? filtered.indexOf(selected) : null, empty: '<p class="meta" role="status">No match. Choose Other journal to enter a name.</p>' });
        pagerHost.hidden = pages <= 1;
        pagerHost.innerHTML = pages <= 1 ? '' : pagerBar({ id: 'journal-pager', label: 'Journal pages', text: `${num(from)}–${num(to)} of ${num(filtered.length)} matches`,
          steps: [{ key: 'prev', disabled: page === 0, attrs: { 'data-page': page - 1 } }, { key: 'next', disabled: page + 1 >= pages, attrs: { 'data-page': page + 1 } }],
          jumps: [{ key: 'first', disabled: page === 0, attrs: { 'data-page': 0 } }, { key: 'last', disabled: page + 1 >= pages, attrs: { 'data-page': pages - 1 } }] });
        wirePager(d, 'journal-pager', p => { page = p; render(); results.scrollTop = 0; });
        results.querySelectorAll('[data-pick]').forEach(button => button.onclick = () => {
          selected = filtered[Number(button.dataset.pick)];
          apply.disabled = false; otherBox.hidden = true;
          results.querySelectorAll('[data-pick]').forEach(b => b.setAttribute('aria-pressed', String(b === button)));
        });
      };
      input.oninput = () => { page = 0; filtered = filterJournals(entries, input.value); render(); };
      d.querySelector('[data-start]').onclick = e => {
        e.preventDefault(); otherBox.hidden = false;
        otherName.value = input.value.trim() || current;
        otherName.dispatchEvent(new Event('input')); otherName.focus();
      };
      otherName.oninput = () => {
        selected = { id: 'other', label: otherName.value.trim() };
        apply.disabled = !selected.label;
        results.querySelectorAll('[data-pick]').forEach(b => b.setAttribute('aria-pressed', 'false'));
      };
      // The catalogue entry says the style, never a default of the caller's.
      apply.onclick = e => { e.preventDefault(); if (selected?.label) close({ ...selected, style: selected.style }); };
      results.innerHTML = '<p class="meta" role="status">Loading journal catalog…</p>';
      loadJournalCatalog().then(list => { if (!d.isConnected) return; entries = list; filtered = filterJournals(entries, input.value); render(); })
        .catch(() => { if (d.isConnected) results.innerHTML = '<p class="meta" role="status">Catalog unavailable. Choose Other journal to enter a name.</p>'; });
    } });
}

/** The target-journal control, the same wherever a page offers it; `name` is its accessible name (a submission's journal is not the target). */
export const journalButton = (id, current, name = 'Target journal') => `<button type="button" class="journal-select" id="${esc(id)}" aria-label="${esc(name)}" aria-haspopup="dialog"${current ? ` title="${esc(current)}"` : ''}><span>${esc(current || 'Choose a journal')}</span>${icon('chevron-down', { size: 14 })}</button>`;

/** Opens the picker from that control; `save(choice)` stores what was chosen. */
export function wireJournalButton(button, current, save) {
  if (!button) return;
  button.onclick = async () => {
    const choice = await chooseJournal({ current: current() });
    if (!button.isConnected) return;
    if (choice?.label) {
      save(choice);
      button.querySelector('span').textContent = choice.label;
      button.title = choice.label;
    }
    button.focus();
  };
}
