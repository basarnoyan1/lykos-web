// Adding to the coding workspace (views/coding.mjs): documents from files, a dataset's free text or pasted text (dialogs: a short
// decision), attributes from a dataset, the workspace menu; and the two sub-pages that need the person to see what a scan found,
// Auto-code and Pseudonymise (DIALOGS plan #39, #40).
import { get, update } from '../store.mjs';
import { qualOf, readQual, addDocument, ensureCode, addCoding, codeTree } from '../lib/qual.mjs';
import { findHits, UNITS, HIT_CAP } from '../lib/qual-text.mjs';
import { surveyToCorpus, importAttributes } from '../lib/qual-cases.mjs';
import { exportCodings, importCodings } from '../lib/qual-analysis.mjs';
import { writeQdc, readQdc, ensureGuids } from '../lib/qual-refi.mjs';
import { scanText, planPseudonyms, replacementsFor, pseudonymiseDocument, mappingCsvRows, kindLabel } from '../lib/qual-pseudo.mjs';
import { fileText, extOf } from '../lib/filetext.mjs';
import { formDialog, ask, confirmAsk } from '../lib/dialog.mjs';
import { showMenu } from '../lib/menu.mjs';
import { download, downloadCsv } from '../lib/figure.mjs';
import { esc } from '../lib/html.mjs';
import { uiBar, uiList, uiRow } from '../lib/ui-actions.mjs';
import { formField, tableRegion } from '../lib/ui-components.mjs';
import { num } from '../lib/dates.mjs';
import { ui, plural, commit, currentCoder, options, pickFiles, cut, fileBase } from './coding-common.mjs';

const ACCEPT = '.docx,.odt,.rtf,.txt,.md,.pdf';

// ---- adding documents -------------------------------------------------------------
/** Word, OpenDocument, RTF, text, Markdown and PDF files as documents; transcripts are recognised by their speaker labels. */
export function importFiles(ctx, opened = () => {}) {
  pickFiles({ accept: ACCEPT, multiple: true }, async files => {
    const failed = []; let first = null, n = 0;
    for (const f of files) {
      try {
        const { text } = await fileText(f.name, new Uint8Array(await f.arrayBuffer()));
        if (!text.trim()) { failed.push(`${f.name} has no text`); continue; }
        update(s => { const id = addDocument(s, { name: f.name.replace(/\.\w+$/, ''), text, source: { file: f.name, ext: extOf(f.name) } }); first ||= id; return s; });
        n++;
      } catch (e) { failed.push(`${f.name}: ${e.message || e}`); }
    }
    if (first) opened(first);
    ctx.rerender([n ? `${plural(n, 'document')} added` : '', ...failed].filter(Boolean).join('; '));
    ctx.refreshCounts?.();
  });
}

export async function pasteText(ctx, opened = () => {}) {
  const out = await formDialog({ id: 'coding-paste', title: 'Paste text', tier: 'M', confirm: 'Add',
    body: `${formField('Name', '<input name="name" autocomplete="off" placeholder="Pasted text">')}${formField('Text', '<textarea name="text" rows="10" spellcheck="false"></textarea>')}
      <p class="note" data-dialog-error role="alert" hidden></p>`,
    submit: (f, d) => {
      const text = f.elements.namedItem('text');
      if (!text.value.trim()) { const hint = d.querySelector('[data-dialog-error]'); hint.textContent = 'Paste the text to add.'; hint.hidden = false; text.focus(); return undefined; }
      return { name: f.elements.namedItem('name').value.trim() || 'Pasted text', text: text.value };
    } });
  if (!out) return;
  let id; commit(ctx, s => { id = addDocument(s, out); }, 'Document added');
  opened(id); ctx.rerender();
}

const datasetsOf = s => (s.datasets || []).filter(d => d.columns?.length);
/** A dataset's open answers: one case per respondent, one document per answer, the other columns as attributes. */
export async function importSurvey(ctx) {
  const list = datasetsOf(get());
  if (!list.length) { ctx.rerender('No dataset to read: import one in Datasets first'); return; }
  const out = await datasetDialog('Survey free text', list, { texts: true, confirm: 'Add' });
  if (!out) return;
  let r; commit(ctx, s => { r = surveyToCorpus(s, out.dataset, { key: out.key, textColumns: out.texts, attributeColumns: out.attrs }); });
  ctx.rerender([`${plural(r.documents, 'answer')} added`, r.updated ? `${plural(r.updated, 'answer')} updated` : '', `${plural(r.cases, 'new case')}`, ...r.skipped.slice(0, 3)].filter(Boolean).join('; '));
}
/** Case attributes from a dataset matched by a key column. */
export async function importAttributesDialog(ctx) {
  const list = datasetsOf(get());
  if (!list.length) { ctx.rerender('No dataset to read: import one in Datasets first'); return; }
  const out = await datasetDialog('Attributes from a dataset', list, { texts: false, confirm: 'Import', create: true });
  if (!out) return;
  let r; commit(ctx, s => { r = importAttributes(s, out.dataset, out.key, { columns: out.attrs, createCases: out.create }); });
  ctx.rerender(`${plural(r.matched, 'case')} matched${r.created ? `, ${r.created} created` : ''}; ${plural(r.attributes, 'attribute')}${r.unmatched.length ? `; not matched: ${r.unmatched.slice(0, 4).join(', ')}${r.unmatched.length > 4 ? '…' : ''}` : ''}`);
}
const datasetPick = list => `<select name="ds">${options(list.map(d => [d.id, d.name]), list[0].id)}</select>`;
const keyPick = () => '<select name="key"></select>';
const createBox = () => '<label class="qc-check"><input type="checkbox" name="create"><span>Create cases for rows without one</span></label>';
function datasetDialog(title, list, { texts, confirm, create = false }) {
  const colsHtml = (d, key) => {
    const longText = c => c.type === 'text' && d.rows.some(r => String(r[c.id] ?? '').trim().split(/\s+/).length > 4);
    return `${texts ? `<fieldset class="qc-cols"><legend>Text columns</legend>${d.columns.filter(c => c.id !== key).map(c => `<label><input type="checkbox" name="text" value="${esc(c.id)}"${longText(c) ? ' checked' : ''}><span>${esc(c.label)}</span></label>`).join('')}</fieldset>` : ''}
      <fieldset class="qc-cols"><legend>Attributes</legend>${d.columns.filter(c => c.id !== key).map(c => `<label><input type="checkbox" name="attr" value="${esc(c.id)}"${longText(c) ? '' : ' checked'}><span>${esc(c.label)}</span></label>`).join('')}</fieldset>`;
  };
  return formDialog({ id: 'coding-import', title, tier: 'M', confirm,
    body: `${formField('Dataset', datasetPick(list))}${formField('Case column', keyPick())}<div class="qc-ds-cols qc-ds"></div>${create ? createBox() : ''}`,
    onMount: dlg => {
      const f = dlg.querySelector('form'), dsSel = f.elements.namedItem('ds'), keySel = f.elements.namedItem('key');
      const cur = () => list.find(d => d.id === dsSel.value);
      const fillKeys = () => { const d = cur(); const guess = d.columns.find(c => /id|participant|respondent|case|name/i.test(c.label)) || d.columns[0]; keySel.innerHTML = options(d.columns.map(c => [c.id, c.label]), guess.id); fillCols(); };
      const fillCols = () => { dlg.querySelector('.qc-ds-cols').innerHTML = colsHtml(cur(), keySel.value); };
      dsSel.onchange = fillKeys; keySel.onchange = fillCols; fillKeys();
    },
    submit: (f, dlg) => {
      const dsSel = f.elements.namedItem('ds'), keySel = f.elements.namedItem('key');
      const pickedOf = n => [...f.querySelectorAll(`input[name="${n}"]:checked`)].map(i => i.value);
      if (texts && !pickedOf('text').length) { f.querySelector('input[name="text"]')?.focus(); return undefined; }
      return { dataset: list.find(d => d.id === dsSel.value), key: keySel.value, texts: pickedOf('text'), attrs: pickedOf('attr'), create: !!f.elements.namedItem('create')?.checked };
    } });
}

/** The head of a sub-page of the workspace: Back to what it was opened from, and its title. */
const subHead = (id, title) => uiBar({ kind: 'head', label: title, id, lead: { title, level: 'h2', back: { id: `${id}-back`, label: 'Back' } } });
/** Leaves a sub-page: the workspace shows the part it was opened from. */
function leaveSub(ctx, msg) { ui.sub = null; ctx.rerender(msg); }

// ---- auto-code -------------------------------------------------------------------------
// The state of the sub-page lives here, so a repaint of the workspace never loses the pattern or the ticks.
const autoNew = () => ({ pattern: '', unit: 'sentence', scope: 'all', regex: false, caseSensitive: false, wholeWord: false, code: '', hits: [], ticked: new Set(), msg: '' });
let auto = autoNew();
const HITS_SHOWN = 300;

/** Opens the Auto-code sub-page: finds text or a pattern across the corpus, shows each hit in its unit to review, and codes the ticked ones. */
export function autoCode(ctx) { auto = autoNew(); ui.sub = 'auto'; ctx.rerender(); }

const hitRow = (h, i, name) => {
  const at = h.text.indexOf(h.match);
  const body = at >= 0 ? `${esc(cut(h.text.slice(0, at), 120))}${/\s$/.test(h.text.slice(0, at)) ? ' ' : ''}<strong>${esc(h.match)}</strong>${/^\s/.test(h.text.slice(at + h.match.length)) ? ' ' : ''}${esc(cut(h.text.slice(at + h.match.length), 200))}` : esc(cut(h.text, 300));
  return uiRow({ cls: 'qc-hit-row', check: { label: `Code this hit in ${name}`, checked: auto.ticked.has(i), attrs: { 'data-h': i } }, main: { html: `<span class="qc-hit-text">${body}</span>`, detail: [esc(name)] } });
};
const hitCount = () => (auto.hits.length ? `${plural(auto.hits.length, 'hit')}, ${auto.ticked.size} ticked` : auto.msg);

export function renderAutoCode(el, ctx) {
  const s = get(), q = readQual(s), name = new Map(q.documents.map(d => [d.id, d.name]));
  const shown = auto.hits.slice(0, HITS_SHOWN);
  el.innerHTML = `<section class="panel qc-sub qc-auto" aria-label="Auto-code">
    ${subHead('qc-auto-top', 'Auto-code')}
    <div class="panel-body qc-coding-body">
      ${uiBar({ kind: 'tools', label: 'Find text', id: 'qc-auto-find', filters: [
        { type: 'search', id: 'qc-auto-pattern', label: 'Find', placeholder: 'Text or pattern', width: 'flex', value: auto.pattern, attrs: { spellcheck: 'false' } },
        { type: 'select', id: 'qc-auto-unit', label: 'Unit', options: UNITS, value: auto.unit },
        { type: 'select', id: 'qc-auto-scope', label: 'Documents', options: [['all', 'All documents'], ['doc', 'This document']], value: auto.scope }],
        actions: [{ id: 'qc-auto-go', label: 'Find', icon: 'search', keep: true }] })}
      ${uiBar({ kind: 'tools', label: 'Match options', id: 'qc-auto-opts', filters: [
        { type: 'check', id: 'qc-auto-regex', label: 'Regular expression', value: auto.regex }, { type: 'check', id: 'qc-auto-case', label: 'Match case', value: auto.caseSensitive },
        { type: 'check', id: 'qc-auto-word', label: 'Whole word', value: auto.wholeWord }] })}
      ${uiBar({ kind: 'tools', label: 'Hits', id: 'qc-auto-head', message: { id: 'qc-auto-n', text: hitCount() },
        actions: [{ id: 'qc-auto-all', label: 'Tick all', icon: 'check', disabled: !auto.hits.length }, { id: 'qc-auto-none', label: 'Tick none', icon: 'minus', disabled: !auto.hits.length }] })}
      ${auto.hits.length ? `<div class="qc-hits" id="qc-hits">${uiList({ id: 'qc-hit-list', label: 'Hits', rows: shown.map((h, i) => hitRow(h, i, name.get(h.docId) || '')) })}${auto.hits.length > shown.length ? `<div class="meta qc-more">${plural(auto.hits.length - shown.length, 'more hit')} not shown; ticked with the rest</div>` : ''}</div>` : '<div class="qc-hits" id="qc-hits"></div>'}
      ${formField('Code', `<input id="qc-auto-code" name="code" list="qc-codes" autocomplete="off" placeholder="Existing or new code" value="${esc(auto.code)}">`)}
      <datalist id="qc-codes">${codeTree(s).map(({ code }) => `<option value="${esc(code.label)}"></option>`).join('')}</datalist>
    </div>
    ${uiBar({ kind: 'foot', label: 'Auto-code', id: 'qc-auto-foot', actions: [{ id: 'qc-auto-apply', label: 'Code ticked hits', role: 'primary' }] })}
  </section>`;
  const $ = id => el.querySelector(`#${id}`), nEl = $('qc-auto-n');
  const docs = () => (auto.scope === 'doc' ? q.documents.filter(d => d.id === ui.docId) : q.documents);
  $('qc-auto-top-back').onclick = () => leaveSub(ctx);
  $('qc-auto-pattern').oninput = e => { auto.pattern = e.target.value; };
  $('qc-auto-unit').onchange = e => { auto.unit = e.target.value; };
  $('qc-auto-scope').onchange = e => { auto.scope = e.target.value; };
  $('qc-auto-regex').onchange = e => { auto.regex = e.target.checked; };
  $('qc-auto-case').onchange = e => { auto.caseSensitive = e.target.checked; };
  $('qc-auto-word').onchange = e => { auto.wholeWord = e.target.checked; };
  $('qc-auto-code').oninput = e => { auto.code = e.target.value; };
  const find = () => {
    const r = findHits(docs(), { pattern: auto.pattern, regex: auto.regex, caseSensitive: auto.caseSensitive, wholeWord: auto.wholeWord, unit: auto.unit });
    auto.hits = r.hits; auto.ticked = new Set(auto.hits.map((_, i) => i));
    auto.msg = r.error || (auto.hits.length ? '' : 'No hits');
    if (r.truncated) auto.msg = `First ${num(HIT_CAP)} hits`;
    ctx.rerender();
  };
  $('qc-auto-go').onclick = find;
  $('qc-auto-pattern').onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); find(); } };
  const boxes = () => el.querySelectorAll('[data-h]');
  boxes().forEach(cb => cb.onchange = () => { const i = Number(cb.dataset.h); if (cb.checked) auto.ticked.add(i); else auto.ticked.delete(i); nEl.textContent = hitCount(); });
  const tickAll = on => { auto.ticked = on ? new Set(auto.hits.map((_, i) => i)) : new Set(); boxes().forEach(cb => { cb.checked = on; }); nEl.textContent = hitCount(); };
  $('qc-auto-all').onclick = () => tickAll(true);
  $('qc-auto-none').onclick = () => tickAll(false);
  $('qc-auto-apply').onclick = () => {
    if (!auto.ticked.size) { nEl.textContent = 'Tick at least one hit'; return; }
    if (!auto.code.trim()) { $('qc-auto-code').focus(); return; }
    const label = auto.code, chosen = [...auto.ticked].map(i => auto.hits[i]);
    let n = 0;
    ui.sub = null;
    commit(ctx, st => { const k = ensureCode(st, label), who = currentCoder(st); for (const h of chosen) if (addCoding(st, { docId: h.docId, start: h.start, end: h.end, codeIds: [k], coder: who })) n++; }, `${plural(chosen.length, 'passage')} coded “${label.trim()}”`);
  };
}

// ---- pseudonymisation -----------------------------------------------------------------------
const pseudoNew = (docId = null) => ({ docId, scope: docId ? 'doc' : 'all', names: '', rows: [], mapping: {}, msg: '' });
let pseudo = pseudoNew();

/** Scans the documents in scope for names, places and contact details; each found passage starts ticked, with a pseudonym of its kind. */
function scanPseudo() {
  const q = readQual(get()), scope = pseudo.scope === 'doc' ? q.documents.filter(d => d.id === (pseudo.docId || ui.docId)) : q.documents;
  const names = pseudo.names.split(',').map(x => x.trim()).filter(Boolean);
  pseudo.rows = scope.flatMap(d => scanText(d.text, { names }).map(h => ({ ...h, docId: d.id, doc: d.name, context: d.text.slice(Math.max(0, h.start - 40), Math.min(d.text.length, h.end + 40)), keep: true })));
  pseudo.mapping = planPseudonyms(pseudo.rows);
  pseudo.msg = pseudo.rows.length ? `${plural(pseudo.rows.length, 'passage')} in ${plural(new Set(pseudo.rows.map(r => r.docId)).size, 'document')}` : 'Nothing found';
}
/**
 * Opens the Pseudonymise sub-page: finds names, places and contact details in one document or all of them, lets each be kept or replaced
 * with an editable pseudonym, and writes the result as the documents' next version. The mapping is downloaded, not kept.
 */
export function pseudonymise(ctx, docId = null) { pseudo = pseudoNew(docId); scanPseudo(); ui.sub = 'pseudo'; ctx.rerender(); }

export function renderPseudonymise(el, ctx) {
  const { rows, mapping } = pseudo, key = t => Object.keys(mapping).find(k => k.toLowerCase() === t.toLowerCase());
  const table = rows.length ? `<table class="qc-table"><thead><tr><th class="qc-pick" aria-label="Replace"></th><th>Found</th><th>Kind</th><th>Pseudonym</th><th class="grow">Context</th></tr></thead><tbody>
    ${rows.map((r, i) => `<tr><td class="qc-pick"><input type="checkbox" data-r="${i}"${r.keep ? ' checked' : ''} aria-label="Replace ${esc(r.text)}"></td><td>${esc(r.text)}</td><td class="meta">${esc(kindLabel(r.kind))}</td>
      <td><input class="qc-ps-in" data-p="${esc(key(r.text))}" value="${esc(mapping[key(r.text)])}" aria-label="Pseudonym for ${esc(r.text)}" autocomplete="off"></td><td class="grow qc-ctx">${esc(cut(r.context, 120))}</td></tr>`).join('')}</tbody></table>` : '';
  el.innerHTML = `<section class="panel qc-sub qc-pseudo" aria-label="Pseudonymise">
    ${subHead('qc-ps-top', 'Pseudonymise')}
    <div class="panel-body qc-coding-body">
      ${uiBar({ kind: 'tools', label: 'Find names', id: 'qc-ps-find', filters: [
        { type: 'select', id: 'qc-ps-scope', label: 'Documents', options: [['doc', 'This document'], ['all', 'All documents']], value: pseudo.scope },
        { type: 'field', id: 'qc-ps-names', label: 'Other names', placeholder: 'Other names, comma separated', width: 'flex', value: pseudo.names, attrs: { spellcheck: 'false', autocomplete: 'off' } }],
        actions: [{ id: 'qc-ps-scan', label: 'Scan', icon: 'search', keep: true }] })}
      ${uiBar({ kind: 'tools', label: 'Found', id: 'qc-ps-head', message: { id: 'qc-ps-n', text: pseudo.msg } })}
      ${table ? `<div class="qc-ps" id="qc-ps">${tableRegion({ label: 'Passages found', html: table })}</div>` : '<div class="qc-ps" id="qc-ps"></div>'}
      <p class="meta" data-ui-help>The scan is a prompt, not a guarantee. The mapping file is downloaded and never kept in the project.</p>
    </div>
    ${uiBar({ kind: 'foot', label: 'Pseudonymise', id: 'qc-ps-foot', actions: [{ id: 'qc-ps-apply', label: 'Replace ticked', role: 'primary' }] })}
  </section>`;
  const $ = id => el.querySelector(`#${id}`), nEl = $('qc-ps-n');
  $('qc-ps-top-back').onclick = () => leaveSub(ctx);
  $('qc-ps-scope').onchange = e => { pseudo.scope = e.target.value; };
  $('qc-ps-names').oninput = e => { pseudo.names = e.target.value; };
  const scan = () => { scanPseudo(); ctx.rerender(); };
  $('qc-ps-scan').onclick = scan;
  $('qc-ps-names').onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); scan(); } };
  el.querySelectorAll('[data-r]').forEach(cb => cb.onchange = () => { rows[Number(cb.dataset.r)].keep = cb.checked; });
  el.querySelectorAll('[data-p]').forEach(inp => inp.oninput = () => { mapping[inp.dataset.p] = inp.value; el.querySelectorAll(`[data-p="${CSS.escape(inp.dataset.p)}"]`).forEach(o => { if (o !== inp) o.value = inp.value; }); });
  $('qc-ps-apply').onclick = async () => {
    const chosen = rows.filter(r => r.keep); if (!chosen.length) { nEl.textContent = 'Tick at least one passage'; return; }
    const byDoc = new Map(); for (const r of chosen) { if (!byDoc.has(r.docId)) byDoc.set(r.docId, []); byDoc.get(r.docId).push(r); }
    if (!await confirmAsk(`Replace ${plural(chosen.length, 'passage')} in ${plural(byDoc.size, 'document')}?`, { detail: 'The text in the project becomes the pseudonymised version; the original is not kept here. Save the mapping file somewhere safe.', confirm: 'Replace' })) return;
    let dropped = 0;
    ui.sub = null;
    commit(ctx, st => { for (const [id, list] of byDoc) dropped += pseudonymiseDocument(st, id, replacementsFor(list, mapping), mapping).dropped; });
    downloadCsv(mappingCsvRows(mapping, new Set(chosen.map(r => r.text.toLowerCase()))), 'pseudonym-mapping.csv');
    ctx.rerender(`${plural(chosen.length, 'passage')} replaced; mapping downloaded${dropped ? `; ${plural(dropped, 'coding')} removed` : ''}`);
  };
}

// ---- the workspace menu ---------------------------------------------------------------------
export function moreMenu(anchor, ctx) {
  const q = readQual(get()), me = currentCoder();
  showMenu(anchor, [
    { label: `Coding as ${me || 'no one'}…`, icon: 'user', run: async () => { const v = await ask('Coding as', { value: me, placeholder: 'Initials', confirm: 'Save' }); if (v != null) commit(ctx, s => { qualOf(s).coder = v.trim().slice(0, 32); }); } },
    { label: 'Pseudonymise…', icon: 'scan', disabled: !q.documents.length, run: () => pseudonymise(ctx, ui.docId) },
    '-',
    { heading: 'Codebook' },
    { label: 'Export REFI-QDA codebook', icon: 'export', disabled: !q.codes.length, run: () => { update(s => { ensureGuids(s); return s; }); download(writeQdc(get()), 'codebook.qdc', 'application/xml'); } },
    { label: 'Import REFI-QDA codebook…', icon: 'import', run: () => pickFiles({ accept: '.qdc,.xml' }, async files => {
      const xml = await files[0].text(); let r; commit(ctx, s => { r = readQdc(s, xml); });
      ctx.rerender(r.error || `${plural(r.created, 'code')} added, ${r.matched} matched${r.themes ? `, ${plural(r.themes, 'theme')}` : ''}`); }) },
    { heading: 'Codings' },
    { label: `Export ${me ? `${me}’s` : 'my'} codings`, icon: 'download', disabled: !q.codings.length, run: () => download(JSON.stringify(exportCodings(get(), me), null, 1), `${fileBase(me || 'codings')}-codings.json`, 'application/json') },
    { label: 'Export all codings', icon: 'export', disabled: !q.codings.length, run: () => download(JSON.stringify(exportCodings(get(), null), null, 1), 'codings.json', 'application/json') },
    { label: 'Import a colleague’s codings…', icon: 'import', disabled: !q.documents.length, run: () => pickFiles({ accept: '.json' }, async files => {
      try {
        const data = JSON.parse(await files[0].text()); let r; commit(ctx, s => { r = importCodings(s, data); });
        ctx.rerender(`${plural(r.added, 'coding')} added${r.duplicates ? `, ${r.duplicates} already here` : ''}${r.createdCodes ? `, ${plural(r.createdCodes, 'new code')}` : ''}${r.unmatchedDocuments.length ? `; documents not found: ${r.unmatchedDocuments.slice(0, 3).join(', ')}` : ''}`);
      } catch (e) { ctx.rerender(String(e.message || e)); }
    }) },
  ]);
}
