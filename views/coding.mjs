// Coding: the qualitative coding workspace of a primary study (lib/qual.mjs).
// The rail lists the corpus (transcripts, documents, survey answers); the
// work area has the document being coded or, picked in the title bar's title, the codebook, cases,
// retrieval, matrices, intercoder agreement and themes.
//
// A document is its text; selecting a passage and choosing codes (the Code…
// picker, typed to filter, or a recent code's number key) records a coding
// as a character range. Codings are drawn as a quiet fill, deeper where they
// overlap, and as stripes in the margin carrying each code's short label:
// codes are told apart by label and position, never by hue (CLAUDE.md).
import { REGISTRY } from './registry.mjs';
import { get, update } from '../store.mjs';
import { readQual, docById, ensureCode, addCoding, uncode, deleteCodings, setExemplar, setWeight, recentCodes, setMemo, memoOf, inVivoLabel,
  removeDocuments, renameDocument, codeTree, pathOf, editText } from '../lib/qual.mjs';
import { paragraphs, parseTurns, timestamps, segments, speakersOf } from '../lib/qual-text.mjs';
import { setDocumentCase, setSpeakerCase, addCase } from '../lib/qual-cases.mjs';
import { coders } from '../lib/qual-analysis.mjs';
import { esc, emptyState, autoGrow } from '../lib/html.mjs';
import { icon } from '../lib/icons.mjs';
import { showMenu } from '../lib/menu.mjs';
import { ask } from '../lib/dialog.mjs';
import { uiBar, uiList, uiRow, uiRowEnd, uiStatusLine } from '../lib/ui-actions.mjs';
import { formField } from '../lib/ui-components.mjs';
import { day } from '../lib/dates.mjs';
import { ui, plural, commit, currentCoder, options, cut } from './coding-common.mjs';
import { renderCodebook, renderCases, renderThemes } from './coding-book.mjs';
import { renderRetrieve, renderMatrices, renderAgreement } from './coding-reports.mjs';
import { importFiles, importSurvey, pasteText, autoCode, pseudonymise, renderAutoCode, renderPseudonymise, moreMenu } from './coding-dialogs.mjs';
import { undoPoint, offerUndo } from '../lib/undo-removal.mjs';

export const meta = { title: 'Coding', icon: 'coding' };
export const count = (...a) => REGISTRY.coding.count(...a);
export function assistContext() {
  const q = readQual(get());
  return `Qualitative coding: ${plural(q.documents.length, 'document')}, ${plural(q.codes.length, 'code')}, ${plural(q.codings.length, 'coding')}, ${plural(q.cases.length, 'case')}`;
}

const KIND = { transcript: 'Transcript', document: 'Document', survey: 'Survey answer' };
const SUB = { auto: 'Auto-code', pseudo: 'Pseudonymise' };   // the sub-pages (ui.sub), opened from the title bar and the Coding menu
const TABS = [['document', 'Document'], ['codebook', 'Codebook'], ['cases', 'Cases'], ['retrieve', 'Retrieve'], ['matrices', 'Matrices'], ['agreement', 'Agreement'], ['themes', 'Themes']];

export const list = {
  title: 'Documents',
  get empty() { return 'No documents'; },
  items(s) {
    const q = readQual(s), n = new Map();
    for (const x of q.codings) n.set(x.docId, (n.get(x.docId) || 0) + 1);
    return q.documents.map(d => ({ id: d.id, title: d.name, sub: `${KIND[d.kind] || 'Document'}, ${plural(n.get(d.id) || 0, 'coding')}`,
      meta: q.cases.find(c => c.id === d.caseId)?.label || '' }));
  },
};
export function select(id) { if (id !== ui.docId) { ui.docId = id; ui.coding = null; sel = null; } ui.tab = 'document'; ui.sub = null; }
export function selected() { return ui.docId; }

function addMenu(anchor, ctx) {
  showMenu(anchor, [
    { label: 'Files…', icon: 'import', run: () => importFiles(ctx, id => { ui.docId = id; ui.tab = 'document'; }) },
    { label: 'Survey free text…', icon: 'table', run: () => importSurvey(ctx) },
    { label: 'Paste text…', icon: 'note', run: () => pasteText(ctx, id => { ui.docId = id; ui.tab = 'document'; }) },
  ]);
}

/**
 * The title bar (lib/topbar.mjs): the title is the part of the work on show, a picker of the seven (more than a view switch holds), and the
 * page's commands. Before anything is added the page is its empty state and the title is the page's name.
 */
export function pageSpec({ tab, sub = null, empty = false, docs = 0 }, { onShow = () => {}, add = () => {}, auto = () => {}, more = () => {} } = {}) {
  const acts = [{ id: 'qc-menu-add', label: 'Add', icon: 'import', menu: true, run: add },
    { id: 'qc-tb-auto', label: 'Auto-code', icon: 'auto-code', disabled: !docs, run: auto },
    { id: 'qc-menu-coding', label: 'Coding', icon: 'coding', menu: true, run: more }];
  if (empty) return { title: 'Coding', actions: acts };
  const on = TABS.find(([k]) => k === tab) || TABS[0];
  return { title: SUB[sub] || on[1], titleMenu: anchor => showMenu(anchor, TABS.map(([k, label]) => ({ label, checked: !sub && k === on[0], run: () => onShow(k) })), { align: 'start', minWidth: 180 }), actions: acts };
}
export function page(rerender) {
  const ctx = { rerender, refreshCounts: () => {} }, q = readQual(get());
  return pageSpec({ tab: ui.tab, sub: ui.sub, empty: !q.documents.length && !q.codes.length, docs: q.documents.length },
    { onShow: k => { ui.tab = k; ui.sub = null; rerender(); }, add: a => addMenu(a, ctx), auto: () => autoCode(ctx), more: a => moreMenu(a, ctx) });
}

// ---- the view ------------------------------------------------------------------
let sel = null;   // the passage selected in the document: { start, end }
const drafts = new Map();   // a document's text being edited in place, by document id: kept while the person looks elsewhere, dropped by Save and Cancel
let selHook = null;
document.addEventListener('selectionchange', () => selHook?.());
export function render(el, ctx) {
  const s = get(), q = readQual(s);
  ctx.onKey?.(e => onKey(e, ctx));
  if (!q.documents.length && !q.codes.length) {
    el.innerHTML = `${emptyState({ icon: 'align-left', title: 'No documents', help: true, detail: 'Add interview or focus-group transcripts, documents, or a dataset\'s open answers, then select a passage to code it.', actions: [
      { id: 'qc-files', label: 'Add files', icon: 'import', primary: true }, { id: 'qc-survey', label: 'Survey free text', icon: 'table' }, { id: 'qc-paste', label: 'Paste text', icon: 'note' }] })}`;
    el.querySelector('#qc-files').onclick = () => importFiles(ctx, id => { ui.docId = id; });
    el.querySelector('#qc-survey').onclick = () => importSurvey(ctx);
    el.querySelector('#qc-paste').onclick = () => pasteText(ctx, id => { ui.docId = id; });
    return;
  }
  if (!q.documents.some(d => d.id === ui.docId)) ui.docId = q.documents[0]?.id || null;
  el.innerHTML = `<div class="qc"><div class="qc-body" id="qc-body"></div></div>`;
  const body = el.querySelector('.qc-body');
  if (ui.sub) { (ui.sub === 'pseudo' ? renderPseudonymise : renderAutoCode)(body, ctx); return; }
  const panes = { document: renderDocument, codebook: renderCodebook, cases: renderCases, retrieve: renderRetrieve, matrices: renderMatrices, agreement: renderAgreement, themes: renderThemes };
  (panes[ui.tab] || renderDocument)(body, ctx);
}

// ---- the document -----------------------------------------------------------------
/** The stripes beside one paragraph: a button for each code of each coding that touches it, the code's short label on the paragraph the coding starts in. */
function gutterHtml(p, codings, byCode) {
  const here = codings.filter(x => x.start < p.end && x.end > p.start).sort((a, b) => a.start - b.start);
  return here.flatMap(x => x.codeIds.map(id => byCode.get(id)).filter(Boolean).map(c => {
    const first = x.start >= p.start;
    return `<div role="listitem"><button type="button" class="qc-stripe${x.id === ui.coding ? ' qc-on' : ''}${first ? '' : ' qc-cont'}" data-g="${esc(x.id)}" title="${esc(c.label)}" aria-label="${esc(c.label)}"><span>${first ? esc(c.short || '') : ''}</span></button></div>`;
  })).join('');
}
function docHtml(d, codings, byCode) {
  const text = d.text, turns = parseTurns(text), stamps = timestamps(text);
  const deco = [...turns.map((t, i) => ({ id: `s${i}`, start: t.labelStart, end: t.labelEnd })), ...stamps.map((t, i) => ({ id: `t${i}`, start: t.start, end: t.end }))];
  const ranges = codings.map(x => ({ id: x.id, start: x.start, end: x.end }));
  return paragraphs(text).map(p => {
    const inner = segments([...ranges, ...deco], p.start, p.end).map(g => {
      const codes = g.ids.filter(id => !/^[st]\d+$/.test(id)), cls = [];
      if (codes.length) cls.push('qc-seg', codes.length > 1 ? 'qc-d2' : 'qc-d1');
      if (codes.includes(ui.coding)) cls.push('qc-on');
      if (g.ids.some(id => /^s\d+$/.test(id))) cls.push('qc-spk');
      if (g.ids.some(id => /^t\d+$/.test(id))) cls.push('qc-time');
      const t = esc(text.slice(g.start, g.end));
      return cls.length ? `<span class="${cls.join(' ')}"${codes.length ? ` data-c="${codes.join(' ')}"` : ''}>${t}</span>` : t;
    }).join('');
    return `<p class="qc-p" data-at="${p.start}">${inner || '<br>'}</p><div class="qc-gutter" role="list" aria-label="Codes of this passage">${gutterHtml(p, codings, byCode)}</div>`;
  }).join('');
}

function renderDocument(el, ctx) {
  const s = get(), q = readQual(s), d = q.documents.find(x => x.id === ui.docId);
  if (!d) { el.innerHTML = emptyState({ icon: 'align-left', title: 'No document selected' }); return; }
  const codings = q.codings.filter(x => x.docId === d.id && (!ui.coderView || (x.coder || '') === ui.coderView));
  const who = coders(s), recent = recentCodes(s, 9).map(id => q.codes.find(c => c.id === id)).filter(Boolean);
  const words = d.text.split(/\s+/).filter(Boolean).length;
  const speakers = d.kind === 'transcript' ? parseTurns(d.text).length : 0;
  const head = uiBar({ kind: 'head', label: 'Document', id: 'qc-doc-head', lead: { title: d.name },
    overflow: [{ id: 'qc-doc-rename', label: 'Rename…' }, { id: 'qc-doc-pseudo', label: 'Pseudonymise…' }, { id: 'qc-doc-delete', label: 'Delete document…', danger: true }] });
  const facts = uiStatusLine({ id: 'qc-doc-facts', label: 'Document facts', parts: [{ id: 'qc-doc-kind', text: KIND[d.kind] || 'Document', drop: 3 }, { id: 'qc-doc-words', text: plural(words, 'word'), drop: 6 },
    { id: 'qc-doc-codings', text: plural(codings.length, 'coding'), drop: 4 }, ...(d.pseudonymised ? [{ id: 'qc-doc-pseudo-state', text: 'pseudonymised', drop: 5 }] : [])] });
  const editing = drafts.has(d.id);
  const strip = editing ? uiBar({ kind: 'tools', label: 'Edit text', id: 'qc-edit-bar', actions: [{ id: 'qc-edit-cancel', label: 'Cancel' }, { id: 'qc-edit-save', label: 'Save', role: 'primary' }] })
    : uiBar({ kind: 'tools', label: 'Code the selection', id: 'qc-sel',
    filters: who.length > 1 ? [{ type: 'select', id: 'qc-coder-view', label: 'Coder', options: [['', 'All coders'], ...who.map(w => [w, w || 'No coder'])], value: ui.coderView }] : [],
    actions: [{ id: 'qc-code', label: 'Code…', icon: 'plus', role: 'primary', kbd: 'C', disabled: !sel }, { id: 'qc-invivo', label: 'In vivo', icon: 'quote', kbd: 'V', disabled: !sel },
      { id: 'qc-doc-edit', label: 'Edit text', icon: 'criteria-edit' },
      ...(recent.length ? [{ id: 'qc-recent', label: 'Recent', icon: 'clock', menu: true, disabled: !sel }] : [])] });
  el.innerHTML = `<div class="qc-doc-grid">
    <section class="panel qc-doc-panel">
      ${head}
      ${facts}
      ${strip}
      ${editing ? `<div class="qc-doc" id="qc-doc"><textarea id="qc-edit-text" class="qc-big" rows="18" aria-label="Text of ${esc(d.name)}" spellcheck="false">${esc(drafts.get(d.id))}</textarea></div>`
        : `<div class="qc-doc" id="qc-doc"><div class="qc-text" id="qc-text">${docHtml(d, codings, new Map(q.codes.map(c => [c.id, c])))}</div></div>`}
    </section>
    <aside class="qc-side">${sideHtml(s, d, codings, speakers)}</aside></div>`;
  wireDocument(el, ctx, d, codings);
}

/** One code of the selected passage: its short label and path, and its one More. */
const chipRow = (s, c) => uiRow({ cls: 'qc-chip',
  main: { html: `<span class="qc-chip-text"><span class="qc-short">${esc(c.short || '')}</span> ${esc(pathOf(s, c.id))}</span>` },
  end: uiRowEnd({ more: { label: `More for ${c.label}`, attrs: { 'data-code-more': c.id } } }) });
const weightBox = x => `<input id="qc-x-weight" inputmode="decimal" value="${esc(x.weight ?? '')}" autocomplete="off">`;
const passageMemo = memo => `<textarea id="qc-x-memo" rows="2">${esc(memo)}</textarea>`;
const passagePanel = (s, q, d, x) => `<div class="panel qc-coding">
    ${uiBar({ kind: 'head', label: 'Selected passage', id: 'qc-passage-head', lead: { title: 'Selected passage' }, message: { text: [x.coder, day(x.at)].filter(Boolean).join(', ') },
      actions: [{ id: 'qc-x-close', label: 'Close', icon: 'close', role: 'quiet' }], overflow: [{ id: 'qc-x-del', label: 'Delete coding', danger: true }] })}
    <div class="panel-body qc-coding-body">
      <blockquote class="qc-quote">${esc(cut(d.text.slice(x.start, x.end), 600))}</blockquote>
      ${uiList({ id: 'qc-chips', label: 'Codes of the passage', rows: x.codeIds.map(id => q.codes.find(c => c.id === id)).filter(Boolean).map(c => chipRow(s, c)), empty: '<span class="meta">No codes</span>' })}
      ${uiBar({ kind: 'tools', label: 'Passage', id: 'qc-x-tools', actions: [{ id: 'qc-x-add', label: 'Add code…', icon: 'plus' }, { id: 'qc-x-ex', label: 'Exemplar', icon: 'check', pressed: !!x.exemplar }] })}
      ${formField('Weight', weightBox(x))}
      ${formField('Memo', passageMemo(memoOf(s, 'coding', x.id)))}
    </div></div>`;

const casePick = (q, d) => `<select id="qc-case">${options(q.cases.map(c => [c.id, c.label]), d.caseId || '', 'None')}</select>`;
const documentMemo = memo => `<textarea id="qc-doc-memo" rows="3">${esc(memo)}</textarea>`;
/** The speakers of a transcript, each linked to a case: a select for each, saved as it changes. */
const speakerPick = (q, d, n, i) => {
  const map = d.speakers || {}, now = Object.entries(map).find(([k]) => k.toLowerCase() === n.toLowerCase())?.[1] || '';
  return formField(n, `<select id="qc-spk-${i}" data-spk="${i}" aria-label="Case of ${esc(n)}">${options([...q.cases.map(c => [c.id, c.label]), ['+new', `New case “${cut(n, 30)}”`]], now, 'None')}</select>`);
};
const speakersPanel = (q, d, names) => `<div class="panel" id="qc-speakers-panel">${uiBar({ kind: 'head', label: 'Speakers', id: 'qc-speakers-head', lead: { title: 'Speakers' }, message: { text: plural(names.length, 'speaker') } })}
  <div class="panel-body qc-coding-body">${names.map((n, i) => speakerPick(q, d, n, i)).join('')}</div></div>`;
function sideHtml(s, d, codings, speakers) {
  const q = readQual(s), x = codings.find(c => c.id === ui.coding) || q.codings.find(c => c.id === ui.coding && c.docId === d.id);
  const memo = memoOf(s, 'document', d.id);
  const count = new Map(); for (const c of codings) for (const id of c.codeIds) count.set(id, (count.get(id) || 0) + 1);
  const inDoc = codeTree(s).filter(({ code }) => count.has(code.id));
  const names = speakers ? speakersOf(d.text) : [];
  return `${x ? passagePanel(s, q, d, x) : ''}
    <div class="panel">${uiBar({ kind: 'head', label: 'Codes here', id: 'qc-here-head', lead: { title: 'Codes here' }, message: { text: plural(inDoc.length, 'code') } })}
      ${inDoc.length ? `<ul class="qc-here">${inDoc.map(({ code, depth }) => `<li class="ui-indent" style="--depth:${depth};--ui-indent-base:var(--s3)"><span class="qc-short">${esc(code.short || '')}</span><span class="grow">${esc(code.label)}</span><span class="meta">${count.get(code.id)}</span></li>`).join('')}</ul>`
        : '<div class="panel-body"><span class="meta">Nothing coded yet</span></div>'}</div>
    <div class="panel">${uiBar({ kind: 'head', label: 'Document details', id: 'qc-details-head', lead: { title: 'Document' } })}<div class="panel-body qc-coding-body">
      ${formField('Case', casePick(q, d))}
      ${formField('Memo', documentMemo(memo))}</div></div>
    ${names.length ? speakersPanel(q, d, names) : ''}`;
}

/** Saves a document's edited text: the codings move with it, the ones inside deleted text are removed. */
function saveText(ctx, d, next) {
  if (next === d.text) { ctx.rerender(); return; }
  let r; update(s => { r = editText(s, d.id, next); return s; });
  ctx.rerender(r?.dropped ? `${plural(r.dropped, 'coding')} removed with the deleted text` : 'Codings moved with the edit');
  ctx.refreshCounts?.();
}
function wireDocument(el, ctx, d, codings) {
  const text = el.querySelector('#qc-text');
  const selButtons = () => el.querySelectorAll('#qc-code, #qc-invivo, #qc-recent');
  const syncSel = () => { sel = selectionIn(text); selButtons().forEach(b => { b.disabled = !sel; }); };
  selHook = () => { if (text && document.body.contains(text)) syncSel(); else selHook = null; };
  if (sel) selButtons().forEach(b => { b.disabled = false; });
  // the text edited in place
  const area = el.querySelector('#qc-edit-text');
  if (area) {
    area.oninput = () => drafts.set(d.id, area.value);
    area.onkeydown = e => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); drafts.delete(d.id); ctx.rerender(); } };
    el.querySelector('#qc-edit-cancel').onclick = () => { drafts.delete(d.id); ctx.rerender(); };
    el.querySelector('#qc-edit-save').onclick = () => { const next = area.value; drafts.delete(d.id); saveText(ctx, d, next); };
  }
  el.querySelector('#qc-doc-edit')?.addEventListener('click', () => { drafts.set(d.id, d.text); sel = null; ui.coding = null; ctx.rerender(); setTimeout(() => document.getElementById('qc-edit-text')?.focus()); });
  // the speakers, each linked to a case
  const names = speakersOf(d.text);
  el.querySelectorAll('[data-spk]').forEach(pick => pick.onchange = () => {
    const n = names[Number(pick.dataset.spk)], v = pick.value;
    commit(ctx, st => { setSpeakerCase(st, d.id, n, v === '+new' ? addCase(st, n) : v || null); }, 'Speakers linked');
  });
  if (ui.focusSpeakers) { ui.focusSpeakers = false; setTimeout(() => { const p = document.getElementById('qc-spk-0'); p?.scrollIntoView({ block: 'nearest' }); p?.focus(); }); }
  el.querySelector('#qc-case').onchange = e => commit(ctx, st => setDocumentCase(st, d.id, e.target.value || null));
  el.querySelector('#qc-doc-rename').onclick = async () => { const n = await ask('Rename document', { value: d.name, confirm: 'Rename' }); if (n?.trim()) commit(ctx, st => renameDocument(st, d.id, n)); };
  el.querySelector('#qc-doc-pseudo').onclick = () => pseudonymise(ctx, d.id);
  el.querySelector('#qc-doc-delete').onclick = async () => {
    const point = undoPoint(), n = readQual(get()).codings.filter(x => x.docId === d.id).length;
    commit(ctx, st => removeDocuments(st, [d.id]));
    offerUndo(point, `Deleted ${d.name}${n ? ` and its ${plural(n, 'coding')}` : ''}`, () => ctx.rerender());
  };
  const codeBtn = el.querySelector('#qc-code');
  if (codeBtn) codeBtn.onclick = e => { if (sel) openPicker(e.currentTarget, ctx, d.id, { ...sel }); };
  const vivo = el.querySelector('#qc-invivo');
  if (vivo) vivo.onclick = () => inVivo(ctx, d);
  // the codes used last, in the order the number keys take them
  el.querySelector('#qc-recent')?.addEventListener('click', e => {
    const q = readQual(get()), codes = recentCodes(get(), 9).map(id => q.codes.find(c => c.id === id)).filter(Boolean);
    showMenu(e.currentTarget, codes.map((c, i) => ({ label: c.label, meta: String(i + 1), run: () => applyCodes(ctx, d.id, sel, [c.id]) })));
  });
  el.querySelector('#qc-coder-view')?.addEventListener('change', e => { ui.coderView = e.target.value; ctx.rerender(); });
  // the selected coding
  el.querySelector('#qc-x-close')?.addEventListener('click', () => { ui.coding = null; ctx.rerender(); });
  el.querySelectorAll('[data-code-more]').forEach(b => b.onclick = () => showMenu(b, [{ label: 'Remove from the passage', run: () => commit(ctx, st => uncode(st, ui.coding, [b.dataset.codeMore])) }], { align: 'end' }));
  el.querySelector('#qc-x-add')?.addEventListener('click', e => { const x = readQual(get()).codings.find(c => c.id === ui.coding); if (x) openPicker(e.currentTarget, ctx, d.id, { start: x.start, end: x.end }, x.coder); });
  el.querySelector('#qc-x-ex')?.addEventListener('click', () => { const x = readQual(get()).codings.find(c => c.id === ui.coding); commit(ctx, st => setExemplar(st, ui.coding, !x?.exemplar)); });
  const w = el.querySelector('#qc-x-weight');
  if (w) w.onchange = () => { let ok = true; commit(ctx, st => { ok = setWeight(st, ui.coding, w.value.trim()); }, ''); if (!ok) ctx.rerender('Weight must be a number'); };
  const memo = el.querySelector('#qc-x-memo');
  if (memo) { autoGrow(memo); memo.onchange = () => commit(ctx, st => setMemo(st, 'coding', ui.coding, memo.value, currentCoder(st))); }
  el.querySelector('#qc-x-del')?.addEventListener('click', () => { const id = ui.coding; ui.coding = null; commit(ctx, st => deleteCodings(st, [id])); });
  const dm = el.querySelector('#qc-doc-memo'); autoGrow(dm);
  dm.onchange = () => commit(ctx, st => setMemo(st, 'document', d.id, dm.value, currentCoder(st)));
  if (!text) return;
  // clicking a coded passage opens its (innermost) coding
  text.addEventListener('click', e => {
    const span = e.target.closest('[data-c]'); if (!span || !document.getSelection().isCollapsed) return;
    const ids = span.dataset.c.split(' '), xs = codings.filter(x => ids.includes(x.id)).sort((a, b) => (a.end - a.start) - (b.end - b.start));
    if (xs[0]) { ui.coding = xs[0].id; ctx.rerender(); }
  });
  text.addEventListener('mouseover', e => { const span = e.target.closest('[data-c], .qc-stripe'); light(el, span ? (span.dataset.c ? span.dataset.c.split(' ') : [span.dataset.g]) : []); });
  text.addEventListener('mouseleave', () => light(el, []));
  // a stripe in the gutter opens the coding it names
  el.querySelectorAll('.qc-stripe').forEach(b => b.onclick = () => { ui.coding = b.dataset.g; ctx.rerender(); });
}

/** The document selection as offsets in the text, or null when nothing (or something outside) is selected. */
function selectionIn(root) {
  const g = document.getSelection();
  if (!g || g.isCollapsed || !g.rangeCount) return null;
  const r = g.getRangeAt(0);
  if (!root.contains(r.startContainer) || !root.contains(r.endContainer)) return null;
  const a = offsetAt(root, r.startContainer, r.startOffset), b = offsetAt(root, r.endContainer, r.endOffset);
  return a != null && b != null && b > a ? { start: a, end: b } : null;
}
function offsetAt(root, node, off) {
  if (node === root) {
    // a boundary between the root's children: a paragraph's gutter follows it, so the boundary before a child is the start of the next paragraph, or the end of the last
    const paras = [...root.querySelectorAll(':scope > .qc-p')], next = [...root.children].slice(off).find(c => c.classList.contains('qc-p')), last = paras.at(-1);
    return next ? Number(next.dataset.at) : last ? Number(last.dataset.at) + last.textContent.length : 0;
  }
  const el = node.nodeType === 1 ? node : node.parentElement, p = el?.closest('.qc-p');
  if (!p || !root.contains(p)) return null;
  const r = document.createRange(); r.setStart(p, 0); r.setEnd(node, off);
  return Number(p.dataset.at) + r.toString().length;
}

/** Highlights the passages and stripes of the given codings. */
function light(el, ids) {
  el.querySelectorAll('.qc-lit').forEach(x => x.classList.remove('qc-lit'));
  for (const id of ids) el.querySelectorAll(`[data-c~="${CSS.escape(id)}"], .qc-stripe[data-g="${CSS.escape(id)}"]`).forEach(x => x.classList.add('qc-lit'));
}

function applyCodes(ctx, docId, range, codeIds, newLabel = '', coder = null) {
  if (!range) return;
  let id = null;
  commit(ctx, st => {
    const ids = [...codeIds];
    if (newLabel) ids.push(ensureCode(st, newLabel));
    id = addCoding(st, { docId, start: range.start, end: range.end, codeIds: ids.filter(Boolean), coder: coder ?? currentCoder(st) });
  });
  if (id) { ui.coding = id; sel = null; document.getSelection()?.removeAllRanges(); ctx.rerender(); }
}
function inVivo(ctx, d) {
  if (!sel) return;
  const label = inVivoLabel(d.text.slice(sel.start, sel.end));
  if (label) applyCodes(ctx, d.id, sel, [], label);
}

function onKey(e, ctx) {
  if (ui.tab !== 'document' || ui.sub) return;
  const d = docById(get(), ui.docId); if (!d || drafts.has(d.id)) return;
  const k = e.key.toLowerCase();
  if (k === 'escape' && ui.coding) { ui.coding = null; ctx.rerender(); return; }
  if (!sel) return;
  if (k === 'c') { e.preventDefault(); const b = document.getElementById('qc-code'); if (b) openPicker(b, ctx, d.id, { ...sel }); }
  else if (k === 'v') { e.preventDefault(); inVivo(ctx, d); }
  else if (/^[1-9]$/.test(k)) { const id = recentCodes(get(), 9)[Number(k) - 1]; if (id) { e.preventDefault(); applyCodes(ctx, d.id, sel, [id]); } }
}

// ---- the code picker ---------------------------------------------------------------
let picker = null;
function closePicker() { picker?.remove(); picker = null; document.removeEventListener('pointerdown', outside, true); }
function outside(e) { if (picker && !picker.contains(e.target)) closePicker(); }
/**
 * Codes for a passage, chosen from the keyboard: type to filter, arrows to
 * move, Space to tick, Enter to apply the ticked codes (or the highlighted
 * one, or a new code named by what was typed). Recent codes come first.
 */
function openPicker(anchor, ctx, docId, range, coder = null) {
  closePicker();
  const s = get(), q = readQual(s), recent = recentCodes(s, 9);
  const all = codeTree(s).map(({ code, depth }) => ({ code, depth, path: pathOf(s, code.id) }));
  const ticked = new Set(); let active = 0, filter = '';
  const m = document.createElement('div');
  m.className = 'qc-picker'; m.setAttribute('role', 'dialog'); m.setAttribute('aria-label', 'Choose codes');
  m.innerHTML = `<input type="search" class="qc-pick-in" placeholder="Filter or name a new code" aria-label="Filter codes" autocomplete="off" spellcheck="false">
    <div class="qc-pick-list" role="listbox" aria-multiselectable="true" tabindex="0" aria-label="Codes"></div>
    ${uiBar({ kind: 'foot', label: 'Choose codes', id: 'qc-pick-bar', message: { id: 'qc-pick-n', text: '⇧↩ tick, ↩ apply' },
      actions: [{ id: 'qc-pick-no', label: 'Cancel', keep: true, attrs: { 'data-no': true } }, { id: 'qc-pick-ok', label: 'Apply', role: 'primary', attrs: { 'data-ok': true } }] })}`;
  document.body.append(m); picker = m;
  const input = m.querySelector('input'), listEl = m.querySelector('.qc-pick-list'), msg = m.querySelector('#qc-pick-n'), hint = msg.textContent;
  const rows = () => {
    const f = filter.trim().toLowerCase();
    const hit = all.filter(x => !f || x.path.toLowerCase().includes(f) || String(x.code.short || '').toLowerCase() === f);
    const rec = f ? [] : recent.map(id => hit.find(x => x.code.id === id)).filter(Boolean);
    const exact = all.some(x => x.code.label.toLowerCase() === f);
    // a new code comes last when the text also matches codes, so Enter takes the first match
    return [...rec.map(x => ({ ...x, recent: true })), ...hit.filter(x => !rec.includes(x)), ...(f && !exact ? [{ create: filter.trim() }] : [])];
  };
  const draw = () => {
    const r = rows(); active = Math.min(active, Math.max(0, r.length - 1));
    listEl.innerHTML = r.map((x, i) => x.create
      ? `<div class="qc-opt${i === active ? ' act' : ''}" role="option" data-i="${i}" aria-selected="false"><span class="qc-short">${icon('plus')}</span><span class="grow">New code “${esc(x.create)}”</span></div>`
      : `<div class="qc-opt${i === active ? ' act' : ''}" role="option" data-i="${i}" aria-selected="${ticked.has(x.code.id)}"><input type="checkbox" tabindex="-1" aria-label="${esc(x.code.label)}"${ticked.has(x.code.id) ? ' checked' : ''}>
        <span class="qc-short">${esc(x.code.short || '')}</span><span class="grow ui-indent" style="--depth:${x.recent ? 0 : x.depth}">${esc(x.recent ? x.path : x.code.label)}</span>${x.recent ? `<span class="meta">${recent.indexOf(x.code.id) + 1}</span>` : ''}</div>`).join('')
      || emptyState({ title: 'No codes', size: 'inline' });
    msg.textContent = `${ticked.size ? `${ticked.size} ticked, ` : ''}${hint}`;
    listEl.querySelector('.act')?.scrollIntoView({ block: 'nearest' });
  };
  // Enter applies the ticked codes, and the highlighted one when something is typed (or nothing is ticked)
  const apply = () => {
    const r = rows(), cur = r[active], take = filter.trim() || !ticked.size;
    const ids = [...ticked, ...(take && cur?.code ? [cur.code.id] : [])];
    const label = take && cur?.create ? cur.create : '';
    if (!ids.length && !label) return;
    closePicker(); applyCodes(ctx, docId, range, ids, label, coder);
  };
  const toggle = i => { const x = rows()[i]; if (!x) return; if (x.create) { active = i; apply(); return; } if (ticked.has(x.code.id)) ticked.delete(x.code.id); else ticked.add(x.code.id); active = i; draw(); };
  input.oninput = () => { filter = input.value; active = 0; draw(); };
  m.onkeydown = e => {
    const n = rows().length;
    if (e.key === 'ArrowDown') { e.preventDefault(); active = (active + 1) % Math.max(1, n); draw(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); active = (active - 1 + n) % Math.max(1, n); draw(); }
    else if (e.key === ' ' && (!input.value || e.target !== input)) { e.preventDefault(); toggle(active); }
    else if (e.key === 'Enter' && e.shiftKey) { e.preventDefault(); const x = rows()[active]; if (x?.code) { ticked.add(x.code.id); filter = input.value = ''; active = 0; draw(); input.focus(); } }
    else if (e.key === 'Enter') { e.preventDefault(); apply(); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closePicker(); anchor.focus?.(); }
  };
  listEl.onclick = e => { const o = e.target.closest('[data-i]'); if (o) toggle(Number(o.dataset.i)); };
  m.querySelector('[data-ok]').onclick = apply;
  m.querySelector('[data-no]').onclick = () => closePicker();
  draw();
  // under the anchor, inside the window, never taller than it: the sheet reads where it goes from these properties
  const r = anchor.getBoundingClientRect(), w = Math.min(360, innerWidth - 16);
  const below = innerHeight - r.bottom - 12, above = r.top - 12, room = Math.max(below, above);
  m.style.setProperty('--pick-w', `${w}px`);
  m.style.setProperty('--pick-x', `${Math.max(8, Math.min(r.left, innerWidth - w - 8))}px`);
  m.style.setProperty('--pick-max', `${Math.max(160, Math.min(420, room))}px`);
  m.style.setProperty('--pick-y', below >= Math.min(300, above) ? `${r.bottom + 4}px` : `${Math.max(8, r.top - 4 - Math.min(m.offsetHeight, room))}px`);
  input.focus();
  setTimeout(() => document.addEventListener('pointerdown', outside, true));
}
