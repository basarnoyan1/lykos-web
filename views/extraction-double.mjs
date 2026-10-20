// Double extraction in the Extraction view (plan G4; lib/double-extraction.mjs).
//
// With double extraction on, a bar under the table's head chooses whose
// entries the table shows — Extractor A, Extractor B — or Compare. As A or B
// a person sees and enters only their own entries (and the final values
// already chosen), never the other's; Compare shows both per cell, and the
// inspector takes a final value from them with its reason. Final values can
// then be locked (lib/fields.mjs lockValues); a locked value changes only by
// an amendment with a reason, which is logged. Kept apart from
// extraction.mjs, which calls in at a few marked places.
import { get } from '../store.mjs';
import { esc } from '../lib/html.mjs';
import { uiBar, inspectorActions } from '../lib/ui-actions.mjs';
import { ask, confirmAsk } from '../lib/dialog.mjs';
import { evidenceLabel } from '../lib/evidence.mjs';
import { lockValues } from '../lib/fields.mjs';
import { doubleOn, entriesOf, setEntry, compareCell, compareTable, agreementSummary, resolveCell, acceptAgreed } from '../lib/double-extraction.mjs';
import { proposalFor } from '../lib/proposals.mjs';

let mode = 'A';   // 'A' | 'B' | 'compare'
export const doubleMode = () => (doubleOn(get()) ? mode : null);

const short = (t, n = 40) => { t = String(t ?? ''); return t.length > n ? `${t.slice(0, n)}…` : t; };

/**
 * A cell of the grid in double extraction: `{ text, cls, title }`. As an
 * extractor: that extractor's entry, else the final value, else a proposal.
 * In Compare: "A · B", classed by agreement, or the final value once chosen.
 */
export function doubleCell(s, key, column) {
  const e = entriesOf(s, key), v = s.values?.[key];
  const shown = x => (x.availability === 'not_found' ? 'NR' : String(x.reported_value ?? ''));
  if (mode !== 'compare') {
    const own = e[mode];
    if (own) return { text: short(own.value), cls: 'entry', title: own.value };
    if (v) return { text: short(shown(v)), cls: 'final', title: shown(v) };
    const pr = proposalFor(key.slice(0, key.indexOf(':')), key.slice(key.indexOf(':') + 1));
    return pr ? { text: short(pr.value), cls: 'proposal', title: pr.value } : { text: '', cls: '', title: '' };
  }
  const c = compareCell(s, key, column);
  if (c.final === 'resolved' || c.final === 'locked' || (v && c.state === 'none')) return { text: short(shown(v)), cls: 'final', title: shown(v) };
  if (c.state === 'none') return { text: '', cls: '', title: '' };
  const text = `${short(c.a ?? '—', 18)} · ${short(c.b ?? '—', 18)}`;
  return { text, cls: c.state === 'differ' ? 'differ' : c.state === 'one' ? 'one' : 'agree', title: `A: ${c.a ?? '—'}\nB: ${c.b ?? '—'}` };
}

/** The agreement as one short line for the bar's status slot (the full count is in the inspector's comparison). */
function agreementBrief(sum) {
  if (!sum.both) return sum.one ? `${sum.one} ${sum.one === 1 ? 'cell has' : 'cells have'} one entry` : 'No entries';
  return `${Math.round(100 * sum.agree / sum.both)}% agree · ${sum.differ} differ`;
}

/** The bar under the table's head: whose entries, the agreement, and the bulk actions. */
export function doubleBarHtml(s, papers, cellIds) {
  if (!doubleOn(s)) return '';
  const sum = agreementSummary(compareTable(s, papers, cellIds));
  return uiBar({ kind: 'tools', label: 'Double extraction', id: 'ext-double-bar', cls: 'ext-double',
    view: { id: 'dx-mode', label: 'Entries shown', attr: 'data-dx-mode', kind: 'segmented', value: mode, items: [['A', 'Extractor A'], ['B', 'Extractor B'], ['compare', 'Compare']] },
    status: { id: 'dx-summary', text: mode === 'compare' ? agreementBrief(sum) : `${sum.open} open`, ch: 24 },
    actions: [{ id: 'dx-agreed', label: 'Accept agreed', icon: 'check', presence: 'reserve', hidden: mode !== 'compare', disabled: !sum.agree }] });
}

export function wireDoubleBar(el, ctx, { papers, cellIds, columnOf }) {
  el.querySelectorAll('[data-dx-mode]').forEach(b => b.onclick = () => { mode = b.dataset.dxMode; ctx.rerender(); });
  el.querySelector('#dx-agreed')?.addEventListener('click', () => {
    const n = acceptAgreed(compareTable(get(), papers, cellIds), columnOf);
    if (n) { ctx.rerender(); ctx.refreshCounts?.(); }
  });
}

/** The extractor's own entry for a cell, as the in-place editor starts it (views/extraction.mjs). */
export const ownEntry = key => entriesOf(get(), key)[mode]?.value ?? '';
export const entryLabel = () => `Extractor ${mode}`;

const evidenceItems = (list = []) => list.map((e, i) => `<div class="ev-item"><button class="link" data-ev="${i}">${esc(evidenceLabel(e))}</button>${e.quote ? `<div class="ev-quote">${esc(e.quote)}</div>` : ''}</div>`).join('');
const wireEvidence = (host, list, ctx, paperId) => host.querySelectorAll('[data-ev]').forEach(b => b.onclick = () => {
  const e = list[+b.dataset.ev];
  if (e.kind === 'file') ctx.openDocument(paperId, { file: e.path, locator: e.locator, quote: e.quote });
  else ctx.openDocument(e.doc_id || paperId, { page: e.page, rects: e.rects || [], quote: e.quote || '', kind: e.kind, region: e.region || null });
});

const evHead = (id, title, meta = '') => uiBar({ kind: 'head', label: title, id, lead: { title }, message: { text: meta } });

/** The inspector as one extractor: the proposal to take, their own entry, and the final value once chosen. */
export function renderEntryPanel(host, { paperId, cellId, column, ctx, onChange, onEdit = () => false }) {
  const s = get(), key = `${paperId}:${cellId}`, paper = s.papers.find(p => p.id === paperId);
  const own = entriesOf(s, key)[mode], pr = proposalFor(paperId, cellId), v = s.values?.[key];
  host.hidden = false;
  host.innerHTML = `<div class="ev-title"><span>${esc(paper?.label || '')}</span><span class="meta">${esc(column.label)}</span></div>
    ${column.guidance ? `<div class="ev-guidance">${esc(column.guidance)}</div>` : ''}
    ${pr ? `<div class="ev-block">${evHead('ev-head-proposed', 'Proposed', pr.model ? `model:${pr.model}` : pr.origin || '')}
      <div class="ev-value">${esc(pr.value)}</div>${pr.rationale ? `<div class="ev-rationale">${esc(pr.rationale)}</div>` : ''}${evidenceItems(pr.evidence)}</div>` : ''}
    <div class="ev-block">${evHead('ev-head-own', `Extractor ${mode}`, own ? String(own.at || '').slice(0, 10) : 'No entry')}
      ${own ? `<div class="ev-value">${esc(own.value)}</div>` : ''}</div>
    ${v ? `<div class="ev-block">${evHead('ev-head-final', 'Final', v.locked ? 'Locked' : 'Accepted')}<div class="ev-value">${esc(v.availability === 'not_found' ? 'NR' : v.reported_value ?? '')}</div></div>` : ''}
    ${inspectorActions({ label: 'Enter this cell', id: 'ev-foot', actions: [{ id: 'dx-edit', label: own ? 'Edit' : 'Enter' }, ...(pr ? [{ id: 'dx-take', label: 'Use proposal', role: 'primary' }] : [])],
      overflow: [{ id: 'dx-nr', label: 'Not reported' }, ...(own ? [{ id: 'dx-clear', label: 'Clear' }] : []), { id: 'ev-open', label: 'Open PDF', disabled: !paper?.pdf }] })}`;
  wireEvidence(host, pr?.evidence || [], ctx, paperId);
  host.querySelector('#dx-take')?.addEventListener('click', () => { setEntry(key, mode, pr.value, { evidence: pr.evidence || [], from: 'proposal' }); onChange(); });
  host.querySelector('#dx-edit').onclick = async () => {
    if (onEdit()) return;
    const t = await ask(`${column.label} · Extractor ${mode}`, { value: own?.value ?? '', confirm: 'Save' });
    if (t != null) { setEntry(key, mode, t, { evidence: own?.evidence || [] }); onChange(); }
  };
  host.querySelector('#dx-nr').onclick = () => { setEntry(key, mode, 'NR'); onChange(); };
  host.querySelector('#dx-clear')?.addEventListener('click', () => { setEntry(key, mode, ''); onChange(); });
  host.querySelector('#ev-open')?.addEventListener('click', () => ctx.openDocument(paperId, null));
}

/** The inspector in Compare: A against B, and the final value with its reason. */
export function renderComparePanel(host, { paperId, cellId, column, ctx, onChange }) {
  const s = get(), key = `${paperId}:${cellId}`, paper = s.papers.find(p => p.id === paperId);
  const c = compareCell(s, key, column), e = entriesOf(s, key), v = c.value;
  const STATE = { agree: 'Agree', differ: 'Differ', one: 'One entry', none: 'No entries' };
  const FINAL = { open: 'Open', resolved: 'Resolved', changed: 'Entries changed after resolution', locked: 'Locked' };
  const side = who => `<div class="dx-side"><span class="meta">Extractor ${who}</span><div class="ev-value">${esc(e[who]?.value ?? '—')}</div>${evidenceItems(e[who]?.evidence)}</div>`;
  const needsReason = c.state !== 'agree';
  host.hidden = false;
  host.innerHTML = `<div class="ev-title"><span>${esc(paper?.label || '')}</span><span class="meta">${esc(column.label)}</span></div>
    <div class="dx-compare">${side('A')}${side('B')}</div>
    <dl class="props"><dt>Agreement</dt><dd>${STATE[c.state]}</dd><dt>Final</dt><dd>${esc(FINAL[c.final])}</dd>
      ${v?.resolution?.reason ? `<dt>Reason</dt><dd>${esc(v.resolution.reason)}</dd>` : ''}
      ${v ? `<dt>Value</dt><dd>${esc(v.availability === 'not_found' ? 'NR' : v.reported_value ?? '')}</dd>` : ''}</dl>
    ${v?.locked ? '' : `<label class="dx-reason"><span>Reason</span><textarea id="dx-reason" rows="2" aria-label="Reason">${esc(v?.resolution?.reason || '')}</textarea></label>
    <div class="cr-error meta" id="dx-error" hidden></div>`}
    ${v?.locked ? '' : inspectorActions({ label: 'Resolve this cell', id: 'ev-foot',
      actions: [{ id: 'dx-pick-edit', label: 'Edit', attrs: { 'data-pick': 'edit' } }, ...(c.b != null && c.state !== 'agree' ? [{ id: 'dx-pick-b', label: 'Use B', attrs: { 'data-pick': 'B' } }] : []),
        ...(c.a != null ? [{ id: 'dx-pick-a', label: c.state === 'agree' ? 'Accept' : 'Use A', role: c.state === 'agree' ? 'primary' : 'secondary', attrs: { 'data-pick': 'A' } }] : [])],
      overflow: v ? [{ id: 'dx-lock', label: 'Lock' }] : [] })}`;
  host.querySelectorAll('.dx-side').forEach((node, i) => wireEvidence(node, e[i ? 'B' : 'A']?.evidence || [], ctx, paperId));
  const say = t => { const n = host.querySelector('#dx-error'); if (n) { n.hidden = !t; n.textContent = t; } };
  host.querySelectorAll('[data-pick]').forEach(b => b.onclick = async () => {
    const pick = b.dataset.pick, reason = host.querySelector('#dx-reason')?.value || '';
    let text = null;
    if (pick === 'edit') { text = await ask(column.label, { value: v?.reported_value ?? c.a ?? c.b ?? '', confirm: 'Use' }); if (text == null) return; }
    if ((needsReason || pick === 'edit') && !reason.trim()) { say('A reason is needed'); host.querySelector('#dx-reason')?.focus(); return; }
    if (!resolveCell(paperId, cellId, column, { pick, text, reason })) { say('Not saved'); return; }
    onChange();
  });
  host.querySelector('#dx-lock')?.addEventListener('click', async () => {
    if (!await confirmAsk(`Lock ${column.label}?`, { detail: 'A locked value changes only by an amendment with a reason.', confirm: 'Lock' })) return;
    lockValues([key], 'reviewer'); onChange();
  });
}
