import { esc } from './html.mjs';
import { pickerDialog, pickerRows } from './dialog.mjs';
import { pager, wirePager, pageOf } from './paging.mjs';

const labelOf = r => String(r.label || r.title || r.id);
const searchOf = r => [r.label, r.title, r.doi, r.pmid, r.year, r.journal].join(' ').toLowerCase();
export function recordPage(records, query, page = 1, size = 25) {
  const terms = String(query || '').trim().toLowerCase().split(/\s+/).filter(Boolean);
  const matched = terms.length ? records.filter(r => terms.every(t => searchOf(r).includes(t))) : records;
  return { ...pageOf(matched, page, size), total: matched.length };
}

export function recordPicker({ id, label, value = '', records = [] }) {
  const selected = records.find(r => r.id === value);
  return `<span class="record-picker"><input type="hidden" id="${esc(id)}" value="${esc(selected ? value : '')}"><button type="button" data-record-picker="${esc(id)}" aria-haspopup="dialog" aria-label="${esc(label)}">${esc(selected ? labelOf(selected) : `Choose ${label.toLowerCase()}`)}</button></span>`;
}

export function wireRecordPicker(root, { id, label, records, onSelect, onError, onCancel }) {
  const button = root.querySelector(`[data-record-picker="${id}"]`); if (!button) return;
  button.onclick = async () => {
    try {
    button.parentElement?.querySelector('[data-record-error]')?.remove();
    const items = typeof records === 'function' ? records() : records;
    const selected = root.querySelector(`#${id}`).value;
    const value = await pickerDialog({ id: 'record-picker', title: label, search: `Search ${label.toLowerCase()}`, onMount: (dialog, close) => {
      let page = 1; const query = dialog.querySelector('[type=search]'), host = dialog.querySelector('.ask-picker-list');
      const pages = document.createElement('div'); host.after(pages);   // the pager stays under the list, out of its scroll
      const draw = () => {
        const shown = recordPage(items, query.value, page); page = shown.page;
        host.innerHTML = pickerRows(shown.items.map(r => ({ value: r.id, title: labelOf(r), detail: [r.title !== r.label && r.title, r.year, r.doi || r.pmid].filter(Boolean).join(' · ') })),
          { id: 'record-list', label: 'Matching records', selected, empty: '<p class="meta" role="status">No records match</p>' });
        pages.innerHTML = pager({ id: 'record-picker-pages', page, pages: shown.pages, total: shown.total, size: 25 });
        host.querySelectorAll('[data-pick]').forEach(b => b.onclick = () => close(b.dataset.pick));
        wirePager(pages, 'record-picker-pages', next => { page = next; draw(); host.scrollTop = 0; host.querySelector('[data-pick]')?.focus(); });
      };
      query.oninput = () => { page = 1; draw(); }; draw();
    } });
    if (value == null || !button.isConnected) { onCancel?.(); return; }
    const latest = typeof records === 'function' ? records() : items;
    const item = latest.find(r => r.id === value); if (!item) throw new Error('This record is no longer available');
    root.querySelector(`#${id}`).value = value; button.textContent = labelOf(item); onSelect?.(value);
    } catch (error) {
      if (onError) onError(error);
      else if (button.isConnected) {
        let notice = button.parentElement.querySelector('[data-record-error]');
        if (!notice) { notice = document.createElement('span'); notice.dataset.recordError = ''; notice.className = 'meta'; notice.setAttribute('role', 'alert'); button.after(notice); }
        notice.textContent = String(error.message || error);
      }
    }
  };
}

/** The records dialog on its own, for a caller with no field to hold the choice (a template asking for its paper): the chosen record's id, or null when dismissed. */
export function askRecord(label, { records = [] } = {}) {
  return new Promise(resolve => {
    const host = document.createElement('div'); host.hidden = true; host.innerHTML = recordPicker({ id: 'ask-record', label, records });
    document.body.append(host);
    const finish = value => { host.remove(); resolve(value); };
    wireRecordPicker(host, { id: 'ask-record', label, records, onSelect: finish, onCancel: () => finish(null), onError: () => finish(null) });
    host.querySelector('[data-record-picker]').click();
  });
}
