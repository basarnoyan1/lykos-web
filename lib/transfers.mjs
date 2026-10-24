// Imports and uploads in progress, in one card at the window's bottom corner (above the status bar): a head ("Importing", then what
// happened) with Close once nothing runs, and a row per transfer — its name, the file it is on or what it did, a ring and "12 of 40".
// On the start page as in a project, since importing projects happens with none open (a project's jobs, lib/jobs.mjs, live in the
// project). Neutral: the ring is ink on the rule colour; a failure is said in the failure colour. Loaded on the first transfer.
import { esc } from './html.mjs';
import { icon } from './icons.mjs';
import { uiBar, uiList, uiRow } from './ui-actions.mjs';

const KEEP_DONE = 6000;
const rows = new Map();   // id -> { title, item, done, total, state: 'running' | 'done' | 'failed', text }
let card = null, seq = 0;

/** A ring for a share of 0..1 (an empty ring while the total is unknown), or a check once done. */
const ring = (share, state) => state === 'done' ? icon('check', { size: 16 }) : `<svg class="xfer-ring" width="18" height="18" viewBox="0 0 18 18" aria-hidden="true" focusable="false">
  <circle class="xfer-ring-track" cx="9" cy="9" r="7"/>${share > 0 ? `<circle class="xfer-ring-arc" cx="9" cy="9" r="7" stroke-dasharray="${(44 * share).toFixed(1)} 44" transform="rotate(-90 9 9)"/>` : ''}</svg>`;

function draw() {
  if (!rows.size) { card?.remove(); card = null; return; }
  if (!card) {
    card = document.createElement('section');
    card.className = 'xfer-card'; card.setAttribute('aria-label', 'Imports'); card.setAttribute('aria-live', 'polite');
    card.addEventListener('click', e => { if (e.target.closest('#xfer-close')) { for (const [id, r] of rows) if (r.state !== 'running') rows.delete(id); draw(); } });
    document.body.append(card);
  }
  const all = [...rows.values()], running = all.some(r => r.state === 'running');
  const title = running ? 'Importing' : all.some(r => r.state === 'failed') ? 'Import stopped' : 'Imported';
  const head = uiBar({ kind: 'head', label: 'Imports', id: 'xfer-head', lead: { title, level: 'h2' }, actions: running ? [] : [{ id: 'xfer-close', label: 'Close', icon: 'close', role: 'quiet' }] });
  const list = uiList({ id: 'xfer-list', label: 'Imports', rows: [...rows].map(([id, r]) => {
    const share = r.state === 'done' ? 1 : r.total ? Math.min(1, r.done / r.total) : 0;
    const count = r.state === 'running' && r.total ? `${r.done.toLocaleString('en')} of ${r.total.toLocaleString('en')}` : '';
    const line = r.state === 'running' ? r.item : r.text;
    return uiRow({ cls: 'xfer-item', attrs: { 'data-xfer': id, 'data-state': r.state }, main: { html: esc(r.title), detail: line ? [r.state === 'failed' ? `<span class="xfer-why">${esc(line)}</span>` : esc(line)] : [] },
      // the count and its ring as one cell: two cells would wrap the ring under the count in a card this narrow
      cells: [{ col: 'state', kind: 'visual', html: `<span class="xfer-state" role="progressbar" aria-label="${esc(r.title)}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(share * 100)}"><span class="xfer-count">${esc(count)}</span>${ring(share, r.state)}</span>` }] });
  }) });
  card.innerHTML = head + list;
}

/**
 * A transfer shown in the card, named for its work ("Research Projects", "PDFs from a folder"): `step(done, total, item)` turns its ring
 * and names the file it is on; `finish(text)` says what it did and leaves after a few seconds; `fail(text)` says why it stopped; `settle()`
 * ends a row whose work threw before either. Answers the handles.
 */
export function transfer(title, { total = 0 } = {}) {
  const id = `x${++seq}`;
  rows.set(id, { title: String(title), item: '', done: 0, total, state: 'running', text: '' });
  draw();
  const end = (state, text) => {
    const r = rows.get(id); if (!r || r.state !== 'running') return;
    Object.assign(r, { state, text: String(text || '') }); draw();
    if (state === 'done') setTimeout(() => { if (rows.get(id) === r) { rows.delete(id); draw(); } }, KEEP_DONE);
  };
  return {
    step: (done, all = rows.get(id)?.total || 0, item = '') => { const r = rows.get(id); if (!r || r.state !== 'running') return; Object.assign(r, { done, total: all, item: String(item || '') }); draw(); },
    finish: text => end('done', text),
    fail: text => end('failed', text),
    settle: () => end('failed', 'Stopped before the end'),
  };
}
