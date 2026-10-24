import { esc } from './html.mjs';
import { icon } from './icons.mjs';
import { pickerDialog } from './dialog.mjs';

let activePicker = null;
const PAGE_SIZE = 60;

/** Choose a loaded model or enter a custom ID without changing the profile on cancel. */
export function chooseModel({ models = [], current = '', labels = {}, allowCustom = true, load = null, title = 'Choose model' } = {}) {
  if (activePicker?.isConnected) { activePicker.querySelector('input')?.focus(); return Promise.resolve(null); }
  let names = [...new Set([...(allowCustom ? [current] : []), ...models].filter(Boolean))];
  const label = allowCustom ? 'Search models or enter an ID' : 'Search models';
  return pickerDialog({ id: 'model-picker', title, search: label, body: '<p class="meta" role="status"></p>', onMount: (dialog, finish) => {
    activePicker = dialog;
    const input = dialog.querySelector('input'), list = dialog.querySelector('.ask-picker-list'), status = dialog.querySelector('[role=status]');
    list.setAttribute('role', 'listbox'); list.setAttribute('aria-label', 'Models');
    let choices = [], active = -1, loading = !!load, loadError = '', closed = false;
    let searchIndex = names.map(name => ({ name, search: `${name} ${labels[name] || ''}`.toLowerCase() }));
    const close = value => { if (closed) return; closed = true; if (activePicker === dialog) activePicker = null; finish(value); };
    const highlight = index => {
      active = index;
      [...list.children].forEach((item, i) => item.classList.toggle('active', i === active));
      const item = list.children[active];
      if (item) { input.setAttribute('aria-activedescendant', item.id); item.scrollIntoView({ block: 'nearest' }); }
      else input.removeAttribute('aria-activedescendant');
    };
    const render = () => {
      const query = input.value.trim(), tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
      const matches = searchIndex.filter(row => tokens.every(token => row.search.includes(token))).map(row => row.name);
      choices = matches.slice(0, PAGE_SIZE);
      const custom = allowCustom && query && !names.includes(query);
      if (custom) choices.push(query);
      list.innerHTML = choices.map((name, i) => `<button type="button" role="option" tabindex="-1" id="model-choice-${i}" data-choice="${i}" aria-selected="${name === current}"${custom && i === choices.length - 1 ? ' class="model-picker-custom"' : ''}><span>${custom && i === choices.length - 1 ? `Use “${esc(name)}”` : esc(labels[name] || name)}</span>${name === current ? icon('check') : ''}</button>`).join('');
      if (!choices.length) list.innerHTML = `<p class="meta">${loading ? 'Loading models…' : allowCustom ? 'Enter a model ID' : 'No matching models'}</p>`;
      status.textContent = loadError || (loading ? 'Updating models…' : `${matches.length > PAGE_SIZE ? `${PAGE_SIZE} of ` : ''}${matches.length} ${matches.length === 1 ? 'model' : 'models'}${matches.length > PAGE_SIZE ? '; search to narrow' : ''}`);
      active = -1; input.removeAttribute('aria-activedescendant'); list.scrollTop = 0;
    };
    input.oninput = render;
    input.onkeydown = e => {
      if (e.isComposing) return;
      // WebKit consumes Escape in a search input before the dialog's cancel event. Handle it here so one press also closes an empty search.
      if (e.key === 'Escape') {
        e.preventDefault(); e.stopPropagation(); close(null);
      } else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key) && choices.length) {
        if (['Home', 'End'].includes(e.key) && active < 0) return;
        e.preventDefault();
        highlight(e.key === 'Home' ? 0 : e.key === 'End' ? choices.length - 1 : (active + (e.key === 'ArrowDown' ? 1 : active < 0 ? 0 : -1) + choices.length) % choices.length);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (active >= 0) close(choices[active]);
        else if (allowCustom && input.value.trim()) close(input.value.trim());
        else if (choices.length === 1) close(choices[0]);
      }
    };
    list.onmousedown = e => e.preventDefault();
    list.onclick = e => { const button = e.target.closest('[data-choice]'); if (button) close(choices[+button.dataset.choice]); };
    dialog.querySelector('[data-no]').onclick = () => close(null);
    dialog.addEventListener('close', () => { closed = true; if (activePicker === dialog) activePicker = null; });
    render();
    if (load) Promise.resolve().then(load).then(rows => {
      if (closed) return;
      names = [...new Set([...(allowCustom ? [current] : []), ...rows.map(row => typeof row === 'string' ? row : row.id)].filter(Boolean))];
      for (const row of rows) if (typeof row === 'object') labels[row.id] = row.label || row.id;
      searchIndex = names.map(name => ({ name, search: `${name} ${labels[name] || ''}`.toLowerCase() }));
    }).catch(err => { loadError = String(err.message || err).slice(0, 160); }).finally(() => { loading = false; if (!closed) render(); });
  } });
}
