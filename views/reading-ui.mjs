// The Library's ways onto the reading list (lib/reading.mjs): a Reading list
// submenu in each record row's More menu, and a Reading list part in the
// paper's details. Kept apart from views/library.mjs, which only places and wires them.
import { get, update } from '../store.mjs';
import { esc } from '../lib/html.mjs';
import { inspectorActions } from '../lib/ui-actions.mjs';
import { disclosure } from '../lib/ui-components.mjs';
import { READING_STATUSES, READING_PRIORITIES, readingOf, setReading, statusLabel } from '../lib/reading.mjs';
import { literatureNote } from './notes.mjs';

const set = (id, patch) => update(s => { setReading(s, id, patch); return s; });
const nameOf = p => p?.label || p?.title || 'record';

/** The Reading menu's entries for one record: status, priority, a literature note, removal. */
export function readingMenuItems(id, ctx) {
  const cur = readingOf(get(), id), paper = (get().papers || []).find(p => p.id === id);
  const done = msg => ctx.rerender(msg);
  return [
    ...READING_STATUSES.map(([k, l]) => ({ label: l, checked: cur?.status === k, run: () => { set(id, { status: k }); done(`${nameOf(paper)}: ${l}`); } })),
    '-',
    ...READING_PRIORITIES.filter(([k]) => k !== 'none').map(([k, l]) => ({ label: `${l} priority`, checked: cur?.priority === k,
      run: () => { set(id, { priority: cur?.priority === k ? 'none' : k }); done(`${nameOf(paper)}: ${cur?.priority === k ? 'no priority' : `${l.toLowerCase()} priority`}`); } })),
    '-',
    { label: 'Literature note', icon: 'note', run: () => { if (paper) { literatureNote(paper); ctx.go('notes'); } } },
    cur && { label: 'Remove from reading list', icon: 'close', run: () => { set(id, { status: '' }); done(`${nameOf(paper)} removed from the reading list`); } },
  ].filter(Boolean);
}

/** The paper's details: its place on the reading list, folded under its title with the status beside it; open when the paper is on the list unless the person chose. */
export function readingPanel(paperId, { open } = {}) {
  const e = readingOf(get(), paperId);
  const opt = (pairs, v) => pairs.map(([k, l]) => `<option value="${k}"${k === v ? ' selected' : ''}>${esc(l)}</option>`).join('');
  return disclosure({ id: 'rd-panel', className: 'rd-panel', title: 'Reading list', meta: e ? statusLabel(e.status) : 'Not on the list', open: open ?? !!e,
    body: `<div class="rd-panel-body">
      <label class="field"><span>Status</span><select id="rd-status" aria-label="Reading status"><option value=""${e ? '' : ' selected'}>Not on the list</option>${opt(READING_STATUSES, e?.status)}</select></label>
      <label class="field"><span>Priority</span><select id="rd-prio" aria-label="Reading priority">${opt(READING_PRIORITIES, e?.priority || 'none')}</select></label>
      <label class="field"><span>Reason</span><input id="rd-why" maxlength="280" value="${esc(e?.reason || '')}" placeholder="Why read it" aria-label="Reason to read"></label>
      ${inspectorActions({ id: 'rd-actions', label: 'Reading list actions', actions: [{ id: 'rd-litnote', label: 'Literature note', icon: 'note' }] })}
    </div>` });
}

export function wireReadingPanel(root, paperId, ctx) {
  const box = root.querySelector('.rd-panel'); if (!box || !paperId) return;
  box.querySelector('#rd-status').onchange = e => { set(paperId, { status: e.target.value }); ctx.rerender(); };
  box.querySelector('#rd-prio').onchange = e => { set(paperId, { priority: e.target.value }); ctx.rerender(); };
  box.querySelector('#rd-why').onchange = e => set(paperId, { reason: e.target.value.trim() });
  box.querySelector('#rd-litnote').onclick = () => { const p = (get().papers || []).find(x => x.id === paperId); if (p) { literatureNote(p); ctx.go('notes'); } };
}
