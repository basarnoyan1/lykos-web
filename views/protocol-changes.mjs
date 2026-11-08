// Protocol › Protocol changes (plan W9b): every change to the protocol in one place. Pending: an agent's change held in .lykos/inbox/held/
// (lib/held-changes.mjs) and the owner's own edits since the last version; each reads as a field diff against the protocol now, with what
// follows from it, and can be edited before it is accepted. Accepted: the versions, newest first, and the amendments no version recorded;
// any version compares side by side with the one before or with the protocol now. Declined: the changes the owner turned down.
// Only the person at the window accepts here; an agent's change never applies itself (lib/change-file.mjs ownerOnly).
import { store$get as get, store$update as update } from "../boot.mjs";
import { lib_projects$$ns as projects } from "../boot.mjs";
import { lib_html$esc as esc, lib_html$emptyState as emptyState, lib_html$autoGrow as autoGrow } from "../boot.mjs";
import { lib_ui_actions$uiBar as uiBar, lib_ui_actions$uiList as uiList, lib_ui_actions$uiRow as uiRow, lib_ui_actions$uiRowEnd as uiRowEnd, lib_ui_actions$uiReview as uiReview, lib_ui_actions$uiReviewList as uiReviewList } from "../boot.mjs";
import { lib_ui_components$formField as formField, lib_ui_components$tableRegion as tableRegion } from "../boot.mjs";
import { lib_menu$showMenu as showMenu } from "../boot.mjs";
import { lib_dialog$askText as askText, lib_dialog$confirmAsk as confirmAsk } from "../boot.mjs";
import { lib_dates$plural as plural, lib_dates$day as day, lib_dates$when as when } from "../boot.mjs";
import { applyChanges, changeFileWhat } from '../lib/change-file.mjs';
import { listHeld, listDeclined, saveEdit, acceptHeld, declineHeld, heldAt, changeLine } from '../lib/held-changes.mjs';
import { setHeld, heldNow } from '../lib/protocol-fields.mjs';
import { changePreview, consequences, editableFields, editChange, acceptInPlace, ownerDraft, recordDraft, revertDraft, recordVersion,
  compareVersions, acceptedHistory, wordRuns } from '../lib/protocol-changes.mjs';
import { lib_app_settings$currentPerson as currentPerson } from "../boot.mjs";
import { exportProject } from '../lib/project-exports.mjs';
import { lib_save$saveFile as saveFile } from "../boot.mjs";
import { sectionHead } from './protocol-parts.mjs';

let declined = [];           // the declined changes last read
let editing = '';            // the held change whose words are being edited
let comparing = null;        // { a, b }: version numbers, 0 for the protocol now
let reading = null;          // the folder read under way
const opened = new Set();    // review items the person opened (the first pending one opens by itself)
const person = () => currentPerson(get()).name || 'You';
const folder = () => (projects.isNone?.() ? null : projects.activeFolder?.());

// ---- a field's change, its words marked -------------------------------------------------------------------------------------------------

/** One text with the words it lost and gained, in reading order (lib/vcs-diff.mjs wordParts through wordRuns). */
function inlineDiff(before, after) {
  const { before: B, after: A } = wordRuns(before, after), out = [];
  const del = t => `<del><span class="ui-diff-cue">deleted: </span>${esc(t)}</del>`, ins = t => `<ins><span class="ui-diff-cue">inserted: </span>${esc(t)}</ins>`;
  let i = 0, j = 0, bo = 0, ao = 0;
  while (i < B.length || j < A.length) {
    if (i < B.length && B[i].x) { out.push(del(B[i].t)); i++; continue; }
    if (j < A.length && A[j].x) { out.push(ins(A[j].t)); j++; continue; }
    if (i >= B.length) { out.push(esc(A[j].t.slice(ao))); j++; ao = 0; continue; }
    if (j >= A.length) { out.push(esc(B[i].t.slice(bo))); i++; bo = 0; continue; }
    // the shared words are the same text on both sides, cut into runs differently: take the shorter run's rest
    const b = B[i].t.slice(bo), a = A[j].t.slice(ao), k = Math.min(a.length, b.length);
    out.push(esc(b.slice(0, k))); bo += k; ao += k;
    if (bo >= B[i].t.length) { i++; bo = 0; }
    if (ao >= A[j].t.length) { j++; ao = 0; }
  }
  return out.join('');
}
const OP = { add: 'added', del: 'removed', change: 'changed' };
const diffHtml = rows => rows.map(r => `<div class="ui-diff pc-field"><p class="ui-diff-heading">${esc(r.label)} <span class="pc-op">${OP[r.op]}</span></p>
  <p class="ui-diff-block pc-text">${inlineDiff(r.before, r.after)}</p></div>`).join('');
const followsHtml = items => (items.length ? `<div class="pc-follows" role="group" aria-label="What follows"><p class="ui-diff-heading">What follows</p>
  <ul>${items.map(c => `<li><span class="pc-where">${esc(c.where)}</span><span>${esc(c.text)}</span></li>`).join('')}</ul></div>` : '');

// ---- pending ------------------------------------------------------------------------------------------------------------------------------

function heldBody(s, h, k) {
  if (editing === h.name) {
    const fields = editableFields(h.cf);
    return `<div class="pc-edit">${fields.map(f => formField(f.label, `<textarea class="autogrow" rows="2" data-edit-i="${f.i}" data-edit-field="${esc(f.field)}">${esc(f.value)}</textarea>`)).join('')}
      ${uiBar({ kind: 'foot', label: 'Edit the change', id: `pc-${k}-edit-foot`, actions: [{ id: `pc-${k}-cancel`, label: 'Cancel', attrs: { 'data-pc-cancel': h.name } },
        { id: `pc-${k}-save`, label: 'Save edit', role: 'primary', attrs: { 'data-pc-save': h.name } }] })}</div>`;
  }
  const p = changePreview(s, h.cf), why = String(h.cf.why || h.cf.reason || '').trim(), edits = h.cf.edited || [];
  return `${p.errors.length ? `<p class="note">The protocol no longer takes this change: ${esc(p.errors[0])}</p><ul class="pc-lines">${h.cf.changes.map(c => `<li>${esc(changeLine(c))}</li>`).join('')}</ul>` : diffHtml(p.rows)}
    ${p.other ? `<p class="meta">It also makes ${esc(plural(p.other, 'change'))} outside the protocol</p>` : ''}
    ${why ? `<p class="pc-why"><span class="pc-op">Reason</span> ${esc(why)}</p>` : ''}
    ${edits.length ? `<p class="meta">Edited by ${esc(edits.at(-1).by)}, ${esc(when(edits.at(-1).at))}</p>` : ''}
    ${followsHtml(consequences(s, p.rows))}
    ${editableFields(h.cf).length ? uiBar({ kind: 'tools', label: 'Change', id: `pc-${k}-tools`, actions: [{ id: `pc-${k}-edit`, label: 'Edit', icon: 'note', attrs: { 'data-pc-edit': h.name } }] }) : ''}`;
}

function pendingPanel(s, held, draft) {
  const items = held.map((h, k) => {
    const at = heldAt(h.name), first = k === 0 && !opened.size;
    return uiReview({ id: `pc-held-${k}`, kind: changeFileWhat(h.cf), where: [String(h.cf.by || 'An agent'), at ? when(at) : ''].filter(Boolean).join(', '),
      acceptLabel: 'Accept', dismissLabel: 'Decline', open: first || opened.has(h.name) || editing === h.name, body: heldBody(s, h, k), attrs: { 'data-pc-held': h.name } });
  });
  if (draft) items.push(uiReview({ id: 'pc-draft', kind: `Your edits since version ${draft.since}`, where: plural(draft.rows.length, 'field'), acceptLabel: 'Record',
    dismissLabel: 'Discard edits', open: opened.has('draft') || !held.length, body: `${diffHtml(draft.rows)}${followsHtml(consequences(s, draft.rows))}`, attrs: { 'data-pc-draft': '' } }));
  return `<div class="panel" id="pc-pending">${sectionHead({ id: 'pc-pending-head', title: 'Pending', status: { id: 'pc-pending-count', text: String(items.length), ch: 6 } })}
    <div class="panel-body tight">${items.length ? uiReviewList({ label: 'Pending protocol changes', items }) : emptyState({ title: 'Nothing waiting', size: 'inline' })}</div></div>`;
}

// ---- accepted and declined ------------------------------------------------------------------------------------------------------------

const versionName = v => (v === 0 ? 'Protocol now' : `Version ${v}`);
function acceptedRows(s) {
  const versions = s.protocolVersions || [];
  return acceptedHistory(s).map((h, k) => {
    if (h.kind === 'amendment') {
      return uiRow({ main: { html: `Amendment of ${esc(day(h.at))}`, detail: [esc(h.amendment.note || '')] }, end: uiRowEnd({ reserve: true }) });
    }
    const v = h.version, labels = (v.changes || []).map(c => c.label);
    const who = v.auto ? 'The protocol as it stood before the first change accepted here' : [v.by ? `Proposed by ${v.by}` : '', v.accepted?.by && v.accepted.by !== v.by ? `accepted by ${v.accepted.by}` : ''].filter(Boolean).join(', ');
    return uiRow({ attrs: { 'data-pc-version': String(v.v) },
      main: { html: `Version ${v.v} <span class="meta">${esc(when(v.at))}</span>`, detail: [v.note ? esc(v.note) : '', who ? esc(who) : '', v.edited?.length ? 'Edited before it was accepted' : '', labels.length ? esc(labels.join(', ')) : ''] },
      end: uiRowEnd({ more: { label: `More: version ${v.v}`, attrs: { 'data-pc-more': String(v.v) } } }) });
  });
}
function comparePanel(s) {
  const versions = s.protocolVersions || [], pick = v => (v === 0 ? { current: s } : versions.find(x => x.v === v));
  const a = pick(comparing.a), b = pick(comparing.b);
  if (!a || !b) return '';
  const rows = compareVersions(a, b), changed = rows.filter(r => r.op !== 'same'), same = rows.length - changed.length;
  const mark = (runs, tag) => runs.map(r => (r.x ? `<${tag}>${esc(r.t)}</${tag}>` : esc(r.t))).join('');
  const body = changed.map(r => { const w = wordRuns(r.before, r.after); return `<tr><th scope="row">${esc(r.label)}</th><td class="pc-before">${mark(w.before, 'del')}</td><td class="pc-after">${mark(w.after, 'ins')}</td></tr>`; }).join('');
  const title = `${versionName(comparing.a)} and ${versionName(comparing.b)}`;
  return `<div class="pc-compare" id="pc-compare">${uiBar({ kind: 'head', label: 'Comparison', id: 'pc-compare-head', lead: { title, level: 'h3' }, status: { id: 'pc-compare-count', text: same ? `${plural(same, 'field')} unchanged` : '', ch: 24 },
      actions: [{ id: 'pc-compare-close', label: 'Close comparison', icon: 'close', role: 'quiet' }] })}
    ${changed.length ? tableRegion({ label: title, html: `<table class="pc-side"><thead><tr><th scope="col">Field</th><th scope="col">${esc(versionName(comparing.a))}</th><th scope="col">${esc(versionName(comparing.b))}</th></tr></thead><tbody>${body}</tbody></table>` })
      : '<p class="meta">The two hold the same protocol</p>'}</div>`;
}
function acceptedPanel(s) {
  const versions = s.protocolVersions || [], rows = acceptedRows(s);
  return `<div class="panel" id="pc-accepted">${sectionHead({ id: 'pc-accepted-head', title: 'Accepted', status: { id: 'pc-accepted-count', text: String(rows.length), ch: 6 },
      actions: [{ id: 'pc-freeze', label: versions.length ? 'Record amendment' : 'Freeze version', icon: 'check' }, { id: 'p-reg', label: 'Registration draft', icon: 'download' }] })}
    <div class="panel-body tight">${comparing ? comparePanel(s) : ''}${rows.length ? uiList({ id: 'pc-accepted-list', label: 'Accepted protocol changes', rows }) : emptyState({ title: 'Not frozen', size: 'inline' })}</div></div>`;
}
function declinedPanel() {
  const rows = declined.slice().reverse().map(d => uiRow({ main: { html: esc(changeFileWhat(d.cf)), detail: [esc(String(d.cf.by || 'An agent')), d.why ? esc(d.why) : ''] } }));
  return `<div class="panel" id="pc-declined">${sectionHead({ id: 'pc-declined-head', title: 'Declined', status: { id: 'pc-declined-count', text: String(rows.length), ch: 6 } })}
    <div class="panel-body tight">${rows.length ? uiList({ id: 'pc-declined-list', label: 'Declined protocol changes', rows }) : emptyState({ title: 'None declined', size: 'inline' })}</div></div>`;
}

// ---- the part ---------------------------------------------------------------------------------------------------------------------------

/** Reads the held and declined changes from the folder; answers whether they differ from what is drawn. */
async function readFolder() {
  const f = folder();
  if (!f) { const was = heldNow().length + declined.length; setHeld([]); declined = []; return was > 0; }
  const [held, dec] = await Promise.all([listHeld(f).catch(() => []), listDeclined(f).catch(() => [])]);
  const key = l => l.map(h => `${h.name}:${JSON.stringify(h.cf.edited || [])}`).join('|');
  const changed = key(held) !== key(heldNow()) || key(dec) !== key(declined);
  setHeld(held); declined = dec;
  return changed;
}

export function renderChanges(el, ctx) {
  const s = get(), held = heldNow(), draft = ownerDraft(s);
  el.innerHTML = `<div class="protocol-page protocol-part" data-part="changes">${pendingPanel(s, held, draft)}${acceptedPanel(s)}${declinedPanel()}</div>`;
  const grows = [...el.querySelectorAll('textarea.autogrow')].map(t => autoGrow(t));
  wire(el, ctx);
  reading ||= readFolder().then(changed => { reading = null; if (changed && el.isConnected) { grows.forEach(g => g?.release?.()); ctx.rerender(); ctx.refreshCounts?.(); } }, () => { reading = null; });
}

function wire(el, ctx) {
  const redraw = msg => { ctx.rerender(msg); ctx.refreshCounts?.(); };
  const heldOf = name => heldNow().find(h => h.name === name);
  const settle = async msg => { await readFolder(); redraw(msg); };
  // a review item opened or closed by its head is remembered across redraws
  for (const item of el.querySelectorAll('.ui-review')) item.querySelector('[data-more]')?.addEventListener('click', () => {
    const key = item.dataset.pcHeld || (item.hasAttribute('data-pc-draft') ? 'draft' : '');
    if (key) { if (item.querySelector('[data-more]').getAttribute('aria-expanded') === 'true') opened.add(key); else opened.delete(key); }
  });
  for (const item of el.querySelectorAll('[data-pc-held]')) {
    const name = item.dataset.pcHeld;
    item.querySelector('[data-accept]')?.addEventListener('click', async () => {
      const h = heldOf(name), f = folder();
      if (!h || !f) return;
      const at = new Date().toISOString();
      const r = await acceptHeld(f, name, { cf: h.cf, person: person(), apply: cf => {
        // the protocol part checked on its own copy; a file that also changes records is checked on a copy of the project
        const p = changePreview(get(), cf);
        if (p.errors.length) return { error: p.errors.join('; ') };
        if (p.other) { const full = applyChanges(get(), cf); if (full.errors) return { error: full.errors.join('; ') }; }
        let out = null;
        update(st => { out = acceptInPlace(st, cf, { person: person(), at, file: name }); return st; }, { label: 'Accept protocol change' });
        return out;
      } }).catch(e => ({ error: e.message }));
      opened.delete(name);
      await settle(r.error ? `Not accepted: ${r.error}` : r.version ? `Accepted as version ${r.version}` : 'Accepted');
    });
    item.querySelector('[data-discard]')?.addEventListener('click', async () => {
      const why = await askText('Decline this change?', { placeholder: 'Why (optional)', confirm: 'Decline' });
      if (why === null || !folder()) return;
      await declineHeld(folder(), name, { person: person(), why }).catch(() => null);
      opened.delete(name);
      await settle('Declined');
    });
  }
  for (const b of el.querySelectorAll('[data-pc-edit]')) b.addEventListener('click', () => { editing = b.dataset.pcEdit; opened.add(editing); ctx.rerender(); });
  for (const b of el.querySelectorAll('[data-pc-cancel]')) b.addEventListener('click', () => { editing = ''; ctx.rerender(); });
  for (const b of el.querySelectorAll('[data-pc-save]')) b.addEventListener('click', async () => {
    const h = heldOf(b.dataset.pcSave), box = b.closest('.pc-edit');
    if (!h || !box || !folder()) return;
    const edits = [...box.querySelectorAll('textarea[data-edit-i]')].map(t => ({ i: Number(t.dataset.editI), field: t.dataset.editField, value: t.value }));
    const next = editChange(h.cf, edits, { by: person() });
    editing = '';
    if (next !== h.cf) await saveEdit(folder(), h.name, next).catch(() => null);
    await settle(next !== h.cf ? 'Edit saved' : undefined);
  });
  const draft = el.querySelector('[data-pc-draft]');
  draft?.querySelector('[data-accept]')?.addEventListener('click', async () => {
    const d = ownerDraft(get());
    const note = await askText('Record amendment', { placeholder: 'What changed and why…', confirm: 'Record' });
    if (!d || !note?.trim()) return;
    let v = null;
    update(st => { v = recordDraft(st, { note, person: person() }); return st; }, { label: 'Record protocol amendment' });
    opened.delete('draft'); redraw(`Recorded as version ${v.v}`);
  });
  draft?.querySelector('[data-discard]')?.addEventListener('click', async () => {
    const d = ownerDraft(get());
    if (!d || !(await confirmAsk(`Discard your edits since version ${d.since}?`, { detail: `${plural(d.rows.length, 'field')} go back to how version ${d.since} has them.`, confirm: 'Discard', danger: true }))) return;
    update(st => { revertDraft(st); return st; }, { label: 'Discard protocol edits' });
    redraw('Edits discarded');
  });
  el.querySelector('#pc-freeze')?.addEventListener('click', async () => {
    const versions = get().protocolVersions || [];
    if (!versions.length) { update(st => { recordVersion(st, { note: '' }); return st; }, { label: 'Freeze protocol' }); redraw('Version 1 frozen'); return; }
    const note = await askText('Record amendment', { placeholder: 'What changed and why…', confirm: 'Record' });
    if (!note?.trim()) return;
    let v = null;
    update(st => { v = recordDraft(st, { note, person: person() }); return st; }, { label: 'Record protocol amendment' });
    redraw(`Recorded as version ${v.v}`);
  });
  el.querySelector('#p-reg')?.addEventListener('click', async () => {
    await saveFile((await exportProject(get(), 'protocol-draft')).bytes, 'protocol-registration-draft.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  });
  for (const b of el.querySelectorAll('[data-pc-more]')) b.addEventListener('click', () => {
    const v = Number(b.dataset.pcMore), has = (get().protocolVersions || []).some(x => x.v === v - 1);
    showMenu(b, [...(has ? [{ label: 'Compare with the version before', run: () => { comparing = { a: v - 1, b: v }; ctx.rerender(); } }] : []),
      { label: 'Compare with the protocol now', run: () => { comparing = { a: v, b: 0 }; ctx.rerender(); } }]);
  });
  el.querySelector('#pc-compare-close')?.addEventListener('click', () => { comparing = null; ctx.rerender(); });
}

/** For tests: forget what the part remembers between draws. */
export function resetChanges() { declined = []; editing = ''; comparing = null; reading = null; opened.clear(); setHeld([]); }
