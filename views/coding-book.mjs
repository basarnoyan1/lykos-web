// The codebook, cases and themes of the coding workspace (views/coding.mjs).
import { get, update } from '../store.mjs';
import { readQual, codeTree, ensureCode, renameCode, setShort, setDescription, setParent, indent, outdent, mergeCodes, splitCode, deleteCodes,
  setMemo, memoOf, pathOf, addQualTheme, setQualMembers, removeQualThemes, renameQualTheme, setQualStatement, casesOfDocument } from '../lib/qual.mjs';
import { addCase, renameCase, removeCases, addAttribute, removeAttribute, setAttributeValue, setDocumentCase, ATTRIBUTE_TYPES } from '../lib/qual-cases.mjs';
import { frequencies, themesTable, themesCsvRows, themesDocxBlocks, themesManuscriptBlocks } from '../lib/qual-analysis.mjs';
import { parseTurns } from '../lib/qual-text.mjs';
import { newId } from '../lib/manuscript.mjs';
import { writeTablesDocx } from '../lib/docx-write.mjs';
import { saveFile } from '../lib/save.mjs';
import { downloadCsv, wireDownload } from '../lib/figure.mjs';
import { formDialog, ask, confirmAsk } from '../lib/dialog.mjs';
import { esc, emptyState, autoGrow } from '../lib/html.mjs';
import { icon } from '../lib/icons.mjs';
import { showMenu } from '../lib/menu.mjs';
import { uiBar, uiGroup, uiList, uiRow, uiRowEnd } from '../lib/ui-actions.mjs';
import { formField, tableRegion } from '../lib/ui-components.mjs';
import { ui, plural, commit, currentCoder, options, cut } from './coding-common.mjs';
import { importAttributesDialog } from './coding-dialogs.mjs';

const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

// ---- the codebook ----------------------------------------------------------------
/** A code's name opens its details in place: the chevron turns, the row beneath it holds its label, description, memo and quotes. */
const openName = (id, label, open, depth) => `<span class="qc-indent ui-indent" style="--depth:${depth}"><button type="button" class="qc-name" data-expand="${esc(id)}" aria-expanded="${open}" title="${esc(label)}">${icon('chevron-right', { size: 12 })}<span>${esc(label)}</span></button></span>`;
const codeRow = (s, { code, depth }, freq) => {
  const f = freq.get(code.id), open = ui.expanded.has(code.id), on = ui.chosenCodes.has(code.id);
  return `<tr draggable="true" data-row="${esc(code.id)}"${on ? ' class="on"' : ''}><td class="qc-key"><span class="qc-first-cell">${codeBox(code, on)}${openName(code.id, code.label, open, depth)}</span></td>
    <td class="qc-short-cell"><span class="qc-short">${esc(code.short || '')}</span></td>
    <td class="num" title="With the codes beneath it: ${f.all.codings}">${f.own.codings}</td><td class="num">${f.all.documents}</td><td class="num">${f.all.cases}</td></tr>
    ${open ? `<tr class="qc-detail"><td colspan="6">${codeDetail(s, code)}</td></tr>` : ''}`;
};
const codeBox = (code, on) => `<input type="checkbox" data-pick="${esc(code.id)}" aria-label="Select ${esc(code.label)}"${on ? ' checked' : ''}>`;
const allBox = on => `<input type="checkbox" data-all aria-label="Select all codes"${on ? ' checked' : ''}>`;
/** The codebook's selection bar: what the chosen codes can become. */
function codeTools(n) {
  const act = (id, label, mark, ok) => ({ id: `qc-code-${id}`, label, icon: mark, disabled: !ok, attrs: { 'data-code-act': id } });
  return uiBar({ kind: 'tools', label: 'Chosen codes', id: 'qc-code-tools', status: { id: 'qc-chosen-n', text: n ? `${n} chosen` : 'None chosen', ch: 12 },
    actions: [uiGroup({ id: 'qc-code-level', label: 'Level', fold: 5, items: [{ id: 'qc-code-outdent', label: 'Outdent', icon: 'outdent', disabled: n < 1, attrs: { 'data-code-act': 'outdent' } }, { id: 'qc-code-indent', label: 'Indent', icon: 'indent', disabled: n < 1, attrs: { 'data-code-act': 'indent' } }] }),
      act('move', 'Move into…', 'folder', n >= 1), act('merge', 'Merge…', 'merge', n >= 2)],
    overflow: [{ id: 'qc-code-theme', label: 'Add to theme…', disabled: n < 1, attrs: { 'data-code-act': 'theme' } }, { id: 'qc-code-split', label: 'Split…', disabled: n !== 1, attrs: { 'data-code-act': 'split' } }, '-', { id: 'qc-code-delete', label: 'Delete', danger: true, disabled: n < 1, attrs: { 'data-code-act': 'delete' } }] });
}
export function renderCodebook(el, ctx) {
  const s = get(), q = readQual(s), tree = codeTree(s), freq = new Map(frequencies(s).map(f => [f.codeId, f]));
  for (const id of ui.chosenCodes) if (!q.codes.some(c => c.id === id)) ui.chosenCodes.delete(id);
  const n = ui.chosenCodes.size;
  const head = uiBar({ kind: 'head', label: 'Codebook', id: 'qc-book-head', lead: { title: 'Codebook' }, message: { text: `${plural(q.codes.length, 'code')} · version ${q.codebookVersion || 0}` },
    actions: [{ id: 'qc-new-code', label: 'New code', icon: 'plus', role: 'primary' }] });
  const table = `<table class="qc-table qc-tree"><thead><tr data-drop-top><th class="qc-key"><span class="qc-first-cell">${allBox(n && n === tree.length)}<span>Code</span></span></th><th>Short</th><th class="num">Codings</th><th class="num">Documents</th><th class="num">Cases</th></tr></thead><tbody>
      ${tree.map(t => codeRow(s, t, freq)).join('')}</tbody></table>`;
  el.innerHTML = `<section class="panel">${head}
    ${tree.length ? `${codeTools(n)}${tableRegion({ label: 'Codebook', sticky: true, html: table })}` : `<div class="panel-body">${emptyState({ title: 'No codes', size: 'inline' })}</div>`}
  </section>`;
  el.querySelector('#qc-new-code').onclick = async () => { const name = await ask('New code', { confirm: 'Add' }); if (name?.trim()) commit(ctx, st => { const id = ensureCode(st, name); ui.expanded.add(id); }); };
  el.querySelectorAll('[data-pick]').forEach(cb => cb.onchange = () => { if (cb.checked) ui.chosenCodes.add(cb.dataset.pick); else ui.chosenCodes.delete(cb.dataset.pick); ctx.rerender(); });
  el.querySelector('[data-all]')?.addEventListener('change', e => { ui.chosenCodes = new Set(e.target.checked ? tree.map(x => x.code.id) : []); ctx.rerender(); });
  el.querySelectorAll('[data-expand]').forEach(b => b.onclick = () => { const id = b.dataset.expand; if (ui.expanded.has(id)) ui.expanded.delete(id); else ui.expanded.add(id); ctx.rerender(); });
  el.querySelectorAll('[data-code-act]').forEach(b => b.onclick = () => codeAction(ctx, b.dataset.codeAct));
  wireCodeDetail(el, ctx);
  // dragging a row onto another nests it there; onto the header, to the top level
  let dragged = null;
  el.querySelectorAll('tr[data-row]').forEach(tr => {
    tr.ondragstart = e => { dragged = tr.dataset.row; e.dataTransfer.setData('text/plain', dragged); e.dataTransfer.effectAllowed = 'move'; };
    tr.ondragend = () => { dragged = null; el.querySelectorAll('.qc-drop').forEach(x => x.classList.remove('qc-drop')); };
  });
  el.querySelectorAll('tr[data-row], tr[data-drop-top]').forEach(tr => {
    tr.ondragover = e => { if (!dragged || tr.dataset.row === dragged) return; e.preventDefault(); tr.classList.add('qc-drop'); };
    tr.ondragleave = () => tr.classList.remove('qc-drop');
    tr.ondrop = e => { e.preventDefault(); const id = dragged; dragged = null; let ok = true; commit(ctx, st => { ok = setParent(st, id, tr.dataset.row || null); }); if (!ok) ctx.rerender('A code cannot move under itself'); };
  });
}

/** A code's details, open in its row: its path, short label and a Rename, its description and memo, and a few of its quotes. */
function codeDetail(s, c) {
  const q = readQual(s), xs = q.codings.filter(x => x.codeIds.includes(c.id)), docs = new Map(q.documents.map(d => [d.id, d]));
  const bar = uiBar({ kind: 'tools', label: `Code ${c.label}`, id: `qc-detail-bar-${c.id}`, ...(pathOf(s, c.id) !== c.label ? { message: { text: pathOf(s, c.id) } } : {}), actions: [{ id: `qc-rename-${c.id}`, label: 'Rename…', attrs: { 'data-rename': c.id } }] });
  return `<div class="qc-code-detail">${bar}
    ${shortField(c)}
    ${formField('Description', descriptionBox(c))}
    ${formField('Memo', memoBox(s, c))}
    ${xs.length ? `<ul class="qc-quotes">${xs.slice(0, 5).map(x => `<li><blockquote class="qc-quote">${esc(cut(docs.get(x.docId).text.slice(x.start, x.end), 240))}</blockquote><span class="meta">${esc([docs.get(x.docId).name, x.coder, x.exemplar ? 'exemplar' : ''].filter(Boolean).join(' · '))}</span></li>`).join('')}</ul>
      ${xs.length > 5 ? `<span class="meta">${plural(xs.length - 5, 'more coding')} in Retrieve</span>` : ''}` : ''}
  </div>`;
}
/** A code's short label: six characters at most, so its field holds six. */
const shortField = c => `<label class="field ui-field qc-short-field"><span>Short label</span><input data-short="${esc(c.id)}" value="${esc(c.short || '')}" maxlength="6" autocomplete="off"></label>`;
const descriptionBox = c => `<textarea rows="2" data-desc="${esc(c.id)}">${esc(c.description || '')}</textarea>`;
const memoBox = (s, c) => `<textarea rows="2" data-memo="${esc(c.id)}">${esc(memoOf(s, 'code', c.id))}</textarea>`;
function wireCodeDetail(el, ctx) {
  el.querySelectorAll('[data-rename]').forEach(b => b.onclick = async () => {
    const c = readQual(get()).codes.find(x => x.id === b.dataset.rename);
    const name = await ask('Rename code', { value: c?.label || '', confirm: 'Rename' });
    if (name?.trim()) commit(ctx, st => renameCode(st, b.dataset.rename, name));
  });
  el.querySelectorAll('[data-short]').forEach(i => i.onchange = () => { let ok = true; commit(ctx, st => { ok = setShort(st, i.dataset.short, i.value); }); if (!ok) ctx.rerender('That short label is taken or empty'); });
  el.querySelectorAll('[data-desc]').forEach(t => { autoGrow(t); t.onchange = () => update(st => { setDescription(st, t.dataset.desc, t.value); return st; }); });
  el.querySelectorAll('[data-memo]').forEach(t => { autoGrow(t); t.onchange = () => update(st => { setMemo(st, 'code', t.dataset.memo, t.value, currentCoder(st)); return st; }); });
}

async function codeAction(ctx, a) {
  const q = readQual(get()), ids = [...ui.chosenCodes], items = q.codes.filter(c => ids.includes(c.id));
  if (!items.length) return;
  if (a === 'indent') return commit(ctx, st => { for (const id of ids) indent(st, id); });
  if (a === 'outdent') return commit(ctx, st => { for (const id of ids) outdent(st, id); });
  if (a === 'delete') {
    const n = q.codings.filter(x => x.codeIds.some(id => ids.includes(id))).length;
    if (!await confirmAsk(`Delete ${plural(items.length, 'code')}?`, { detail: `${items.map(c => c.label).join('; ')}. ${plural(n, 'coding')} lose ${items.length === 1 ? 'it' : 'them'}; codes beneath move up.`, confirm: 'Delete', danger: true })) return;
    ui.chosenCodes.clear();
    return commit(ctx, st => deleteCodes(st, ids));
  }
  if (a === 'move') {
    const others = codeTree(get()).filter(({ code }) => !ids.includes(code.id));
    const to = await pickOne('Move into', 'Parent', [['', 'Top level'], ...others.map(({ code, depth }) => [code.id, `${'– '.repeat(depth)}${code.label}`])], 'Move');
    if (to == null) return;
    let bad = 0; commit(ctx, st => { for (const id of ids) if (!setParent(st, id, to || null)) bad++; });
    if (bad) ctx.rerender(`${plural(bad, 'code')} not moved: a code cannot move under itself`);
    return;
  }
  if (a === 'merge') {
    const into = await pickOne(`Merge ${plural(items.length, 'code')}`, 'Keep', items.map(c => [c.id, c.label]), 'Merge');
    if (!into) return;
    ui.chosenCodes.clear();
    return commit(ctx, st => mergeCodes(st, ids, into), 'Codes merged');
  }
  if (a === 'split') return splitDialog(ctx, items[0]);
  if (a === 'theme') {
    const to = await pickOne('Add to theme', 'Descriptive theme', [...q.descriptive.map(t => [t.id, t.label]), ['+new', 'New theme…']], 'Add');
    if (to == null) return;
    let label = null;
    if (to === '+new') { label = await ask('New descriptive theme', { confirm: 'Add' }); if (!label?.trim()) return; }
    return commit(ctx, st => { if (label) addQualTheme(st, 'descriptive', label, ids); else setQualMembers(st, 'descriptive', to, ids, true); }, 'Added to the theme');
  }
}

/** Chooses one of a few: a code's parent, the code to keep in a merge, the theme to add to. Resolves to the chosen value, or null when cancelled. */
function pickOne(title, label, choices, confirm) {
  return formDialog({ id: 'coding-pick-one', title, tier: 'S', confirm,
    body: formField(label, `<select name="v">${options(choices, choices[0]?.[0])}</select>`),
    submit: f => f.elements.namedItem('v').value });
}

/** A coding the split can move: its box, its document and its text. */
const splitHit = (x, docs) => `<label class="qc-hit"><input type="checkbox" data-x="${esc(x.id)}"><span class="grow"><span class="meta">${esc(docs.get(x.docId).name)}</span> ${esc(cut(docs.get(x.docId).text.slice(x.start, x.end), 220))}</span></label>`;
async function splitDialog(ctx, code) {
  const q = readQual(get()), xs = q.codings.filter(x => x.codeIds.includes(code.id)), docs = new Map(q.documents.map(d => [d.id, d]));
  if (!xs.length) { ctx.rerender('The code has no codings to split'); return; }
  const out = await formDialog({ id: 'coding-split', title: 'Split code', detail: code.label, tier: 'M', confirm: 'Split',
    body: `${formField('New code', '<input name="name" autocomplete="off">')}
      <div class="field ui-field" role="group" aria-label="Codings to move"><span>Codings to move</span><div class="qc-hits">${xs.map(x => splitHit(x, docs)).join('')}</div></div>
      <p class="note" data-dialog-error role="alert" hidden></p>`,
    submit: (f, d) => {
      const name = f.elements.namedItem('name'), picked = [...d.querySelectorAll('[data-x]:checked')].map(i => i.dataset.x);
      const fail = (msg, el) => { const hint = d.querySelector('[data-dialog-error]'); hint.textContent = msg; hint.hidden = false; el.focus(); return undefined; };
      if (!name.value.trim()) return fail('Name the new code.', name);
      if (!picked.length) return fail('Tick the codings that move.', d.querySelector('[data-x]'));
      return { name: name.value.trim(), picked };
    } });
  if (!out) return;
  let id; commit(ctx, st => { id = splitCode(st, code.id, out.picked, out.name); });
  ctx.rerender(id ? `${plural(out.picked.length, 'coding')} moved to ${out.name}` : 'A code of that name already exists');
}

// ---- cases ---------------------------------------------------------------------------
/** A case's one More: rename it, or write its memo. */
const caseEnd = (c, i) => uiRowEnd({ more: { label: `More for ${c.label}`, attrs: { 'data-case-more': c.id } } });
const attrCell = (a, c) => `<td><input class="qc-attr-in" data-av="${esc(c.id)}|${esc(a.id)}" value="${esc(c.attributes[a.id] ?? '')}" aria-label="${esc(a.label)} of ${esc(c.label)}"${a.type === 'number' ? ' inputmode="decimal"' : ''}${a.type === 'category' ? ` list="qc-dl-${esc(a.id)}"` : ''} autocomplete="off"></td>`;
const allCases = on => `<input type="checkbox" data-case-all aria-label="Select all cases"${on ? ' checked' : ''}>`;
const caseBox = (c, on) => `<input type="checkbox" data-case-pick="${esc(c.id)}" aria-label="Select ${esc(c.label)}"${on ? ' checked' : ''}>`;
const caseRow = (c, q, docsOf, i) => `<tr${ui.chosenCases.has(c.id) ? ' class="on"' : ''}><td class="qc-key"><span class="qc-first-cell">${caseBox(c, ui.chosenCases.has(c.id))}<span class="qc-strong">${esc(c.label)}</span></span></td>
  <td class="qc-docs-cell">${esc(docsOf(c.id).map(d => d.name).join('; ')) || '<span class="meta">No documents</span>'}</td>
  ${q.attributes.map(a => attrCell(a, c)).join('')}
  <td class="qc-more">${caseEnd(c, i)}</td></tr>`;
/** An attribute's header: its name and type, and the chevron that opens its menu. */
const attrHead = a => `<th class="qc-attr-h"><span class="qc-attr-line"><span class="qc-attr-text"><span>${esc(a.label)}</span><span class="meta">${esc(ATTRIBUTE_TYPES.find(([t]) => t === a.type)?.[1] || '')}</span></span><button type="button" class="icon qc-attr-menu" data-attr-menu="${esc(a.id)}" aria-haspopup="menu" aria-label="Attribute ${esc(a.label)}" title="Attribute">${icon('chevron-down', { size: 12 })}</button></span></th>`;
const docRow = (d, q) => { const sp = d.kind === 'transcript' ? new Set(parseTurns(d.text).map(t => t.speaker.toLowerCase())).size : 0;
  return `<tr><td class="grow">${esc(d.name)}</td><td><select data-doc-case="${esc(d.id)}" aria-label="Case of ${esc(d.name)}">${options(q.cases.map(c => [c.id, c.label]), d.caseId || '', 'None')}</select></td>
    <td>${sp ? speakersButton(d, sp) : '<span class="meta">No labels</span>'}</td></tr>`; };
const speakersButton = (d, sp) => `<button type="button" data-doc-speakers="${esc(d.id)}" title="Link the speakers to cases in the document">${plural(sp, 'speaker')}</button>`;
/** The memo of the case chosen in its More, edited where the cases are and saved when the field loses focus. */
const caseMemo = (s, c) => `<section class="panel" id="qc-case-memo">${uiBar({ kind: 'head', label: 'Case memo', id: 'qc-case-memo-head', lead: { title: 'Case memo' },
  actions: [{ id: 'qc-case-memo-close', label: 'Close', icon: 'close', role: 'quiet' }] })}
  <div class="panel-body">${formField(c.label, `<textarea id="qc-case-memo-text" rows="4">${esc(memoOf(s, 'case', c.id))}</textarea>`)}</div></section>`;
export function renderCases(el, ctx) {
  const s = get(), q = readQual(s);
  const memoCase = q.cases.find(c => c.id === ui.memoCase) || null;
  if (!memoCase) ui.memoCase = null;
  for (const id of ui.chosenCases) if (!q.cases.some(c => c.id === id)) ui.chosenCases.delete(id);
  const docsOf = id => q.documents.filter(d => casesOfDocument(d).includes(id));
  const valuesOf = a => [...new Set(q.cases.map(c => c.attributes[a.id]).filter(v => v != null).map(String))].sort();
  const head = uiBar({ kind: 'head', label: 'Cases', id: 'qc-cases-head', lead: { title: 'Cases' }, message: { text: `${plural(q.cases.length, 'case')} · ${plural(q.attributes.length, 'attribute')}` },
    actions: [{ id: 'qc-new-case', label: 'New case', icon: 'plus', role: 'primary' }, { id: 'qc-new-attr', label: 'New attribute', icon: 'file-plus' }, { id: 'qc-import-attr', label: 'Attributes from dataset…', icon: 'import' }],
    overflow: [{ id: 'qc-del-case', label: 'Delete chosen cases', danger: true, disabled: !ui.chosenCases.size }] });
  const casesTable = `<table class="qc-table qc-cases"><thead><tr><th class="qc-key"><span class="qc-first-cell">${allCases(ui.chosenCases.size && ui.chosenCases.size === q.cases.length)}<span>Case</span></span></th><th>Documents</th>${q.attributes.map(attrHead).join('')}<th aria-label="Actions"></th></tr></thead><tbody>
      ${q.cases.map((c, i) => caseRow(c, q, docsOf, i)).join('')}
      </tbody></table>${q.attributes.filter(a => a.type === 'category').map(a => `<datalist id="qc-dl-${esc(a.id)}">${valuesOf(a).map(v => `<option value="${esc(v)}"></option>`).join('')}</datalist>`).join('')}`;
  el.innerHTML = `<section class="panel">${head}
    ${q.cases.length ? tableRegion({ label: 'Cases', sticky: true, html: casesTable })
      : `<div class="panel-body">${emptyState({ icon: 'user', title: 'No cases', help: true, detail: 'A participant or site, with its documents, speakers and attributes.' })}</div>`}
  </section>
  <section class="panel">${uiBar({ kind: 'head', label: 'Documents', id: 'qc-cases-docs-head', lead: { title: 'Documents' }, message: { text: plural(q.documents.length, 'document') } })}
    ${q.documents.length ? tableRegion({ label: 'Documents and their cases', html: `<table class="qc-table"><thead><tr><th class="grow">Document</th><th>Case</th><th>Speakers</th></tr></thead><tbody>
      ${q.documents.map(d => docRow(d, q)).join('')}</tbody></table>` }) : ''}
  </section>
  ${memoCase ? caseMemo(s, memoCase) : ''}`;
  el.querySelector('#qc-new-case').onclick = async () => { const n = await ask('New case', { placeholder: 'P01', confirm: 'Add' }); if (n?.trim()) commit(ctx, st => addCase(st, n)); };
  el.querySelector('#qc-new-attr').onclick = () => attributeDialog(ctx);
  el.querySelector('#qc-import-attr').onclick = () => importAttributesDialog(ctx);
  el.querySelector('#qc-del-case').onclick = async () => {
    const ids = [...ui.chosenCases]; if (!ids.length) return;
    if (!await confirmAsk(`Delete ${plural(ids.length, 'case')}?`, { detail: 'Their documents stay, unlinked.', confirm: 'Delete', danger: true })) return;
    ui.chosenCases.clear(); commit(ctx, st => removeCases(st, ids));
  };
  el.querySelector('[data-case-all]')?.addEventListener('change', e => { ui.chosenCases = new Set(e.target.checked ? q.cases.map(c => c.id) : []); ctx.rerender(); });
  el.querySelectorAll('[data-case-pick]').forEach(cb => cb.onchange = () => { if (cb.checked) ui.chosenCases.add(cb.dataset.casePick); else ui.chosenCases.delete(cb.dataset.casePick); ctx.rerender(); });
  el.querySelectorAll('[data-case-more]').forEach(b => b.onclick = () => {
    const id = b.dataset.caseMore;
    showMenu(b, [{ label: 'Rename…', run: async () => {
        const c = readQual(get()).cases.find(x => x.id === id);
        const n = await ask('Rename case', { value: c?.label || '', confirm: 'Rename' }); if (!n?.trim()) return;
        let ok = true; commit(ctx, st => { ok = renameCase(st, id, n); }); if (!ok) ctx.rerender('A case of that name exists');
      } },
      { label: 'Memo', run: () => { ui.memoCase = id; ctx.rerender(); setTimeout(() => document.getElementById('qc-case-memo-text')?.focus()); } }], { align: 'end' });
  });
  el.querySelectorAll('[data-av]').forEach(i => i.onchange = () => {
    const [c, a] = i.dataset.av.split('|'); let ok = true;
    update(st => { ok = setAttributeValue(st, c, a, i.value); return st; });
    if (!ok) ctx.rerender('Not a number'); else i.removeAttribute('aria-invalid');
  });
  el.querySelectorAll('[data-attr-menu]').forEach(b => b.onclick = () => showMenu(b, [{ label: 'Delete attribute…', danger: true, run: () => deleteAttribute(ctx, b.dataset.attrMenu) }], { align: 'end' }));
  el.querySelectorAll('[data-doc-case]').forEach(sel => sel.onchange = () => commit(ctx, st => setDocumentCase(st, sel.dataset.docCase, sel.value || null)));
  // the speakers are linked beside the document (its inspector section Speakers)
  el.querySelectorAll('[data-doc-speakers]').forEach(b => b.onclick = () => { ui.docId = b.dataset.docSpeakers; ui.tab = 'document'; ui.coding = null; ui.focusSpeakers = true; ctx.rerender(); });
  const memoText = el.querySelector('#qc-case-memo-text');
  if (memoText) {
    autoGrow(memoText);
    memoText.onchange = () => update(st => { setMemo(st, 'case', ui.memoCase, memoText.value, currentCoder(st)); return st; });
    el.querySelector('#qc-case-memo-close').onclick = () => { ui.memoCase = null; ctx.rerender(); };
  }
}

async function deleteAttribute(ctx, id) {
  const a = readQual(get()).attributes.find(x => x.id === id); if (!a) return;
  if (await confirmAsk(`Delete ${a.label}?`, { detail: 'Its values on every case are deleted.', confirm: 'Delete', danger: true })) commit(ctx, st => removeAttribute(st, a.id));
}

async function attributeDialog(ctx) {
  const out = await formDialog({ id: 'coding-attribute', title: 'New attribute', tier: 'S', confirm: 'Add',
    body: `${formField('Name', '<input name="name" autocomplete="off">')}${formField('Type', `<select name="type">${options(ATTRIBUTE_TYPES, 'category')}</select>`)}`,
    submit: f => { const n = f.elements.namedItem('name'); if (!n.value.trim()) { n.focus(); return undefined; } return { name: n.value, type: f.elements.namedItem('type').value }; } });
  if (out) commit(ctx, st => addAttribute(st, out.name, out.type));
}

// ---- themes ------------------------------------------------------------------------------
/** A theme's row: its name, what it holds, one inline action to change that, and its One More. */
const themeRow = (lv, t, i, detail) => uiRow({ cls: 'qc-theme', attrs: { 'data-theme': `${lv}|${t.id}` },
  main: { html: `<span class="qc-strong">${esc(t.label)}</span>`, detail: [detail], wrap: true },
  end: uiRowEnd({ inline: { id: `qc-theme-${lv}-edit-${i}`, label: lv === 'analytical' ? `Choose themes of ${t.label}` : `Choose codes of ${t.label}`, icon: 'list-bullet', attrs: { 'data-theme-edit': `${lv}|${t.id}` } },
    more: { label: `More for ${t.label}`, attrs: { 'data-theme-more': `${lv}|${t.id}` } } }) });
const statementRow = t => uiRow({ depth: 1, cls: 'qc-child', main: { html: formField('Statement', `<textarea rows="2" data-statement="${esc(t.id)}">${esc(t.statement || '')}</textarea>`) } });
const exemplarRow = r => `<tr><td class="qc-wrap"><span class="qc-strong">${esc(r.label)}</span>${r.statement ? `<br><span class="meta qc-wrap">${esc(cut(r.statement, 200))}</span>` : ''}</td><td class="qc-wrap">${esc(r.members.join('; '))}</td><td class="num">${r.cases || r.documents}</td>
  <td class="grow qc-wrap">${r.quotes.map(x => `<blockquote class="qc-quote">${esc(cut(x.text, 260))} <span class="meta">(${esc(x.source)})</span></blockquote>`).join('') || '<span class="meta">No coded segments</span>'}</td></tr>`;
export function renderThemes(el, ctx) {
  const s = get(), q = readQual(s), rows = themesTable(s);
  const codeLabel = id => q.codes.find(c => c.id === id)?.label || '';
  const descriptive = q.descriptive.map((t, i) => themeRow('descriptive', t, i, t.codes.map(codeLabel).filter(Boolean).join('; ') || 'No codes'));
  const analytical = q.analytical.flatMap((t, i) => [themeRow('analytical', t, i, t.themes.map(id => q.descriptive.find(x => x.id === id)?.label).filter(Boolean).join('; ') || 'No descriptive themes'), statementRow(t)]);
  const head = (id, title, count, actions, overflow) => uiBar({ kind: 'head', label: title, id, lead: { title }, message: { text: count }, ...(actions ? { actions } : {}), ...(overflow ? { overflow } : {}) });
  el.innerHTML = `<section class="panel">${head('qc-desc-head', 'Descriptive themes', plural(q.descriptive.length, 'theme'), [{ id: 'qc-new-descriptive', label: 'New theme', icon: 'plus', disabled: !q.codes.length, attrs: { 'data-new-theme': 'descriptive' } }])}
    ${q.descriptive.length ? uiList({ id: 'qc-desc-list', label: 'Descriptive themes', rows: descriptive })
      : `<div class="panel-body"><div class="qc-help-host"><p class="meta qc-help" data-ui-help>Group codes into descriptive themes, then interpret those as analytical themes; without themes, top-level codes stand in the table below.</p></div></div>`}
  </section>
  <section class="panel">${head('qc-analytical-head', 'Analytical themes', plural(q.analytical.length, 'theme'), [{ id: 'qc-new-analytical', label: 'New theme', icon: 'plus', disabled: !q.descriptive.length, attrs: { 'data-new-theme': 'analytical' } }])}
    ${q.analytical.length ? uiList({ id: 'qc-analytical-list', label: 'Analytical themes', rows: analytical }) : ''}
  </section>
  <section class="panel">${head('qc-exemplar-head', 'Themes with exemplar quotes', plural(rows.length, 'row'), [{ id: 'qc-themes-dl', label: 'Download', icon: 'download', menu: true, disabled: !rows.length }, { id: 'qc-themes-insert', label: 'Insert in manuscript', icon: 'manuscript', disabled: !rows.length }])}
    ${rows.length ? tableRegion({ label: 'Themes with exemplar quotes', html: `<table class="qc-table qc-themes-table"><thead><tr><th>Theme</th><th>Codes</th><th class="num">Cases</th><th class="grow">Exemplar quotes</th></tr></thead><tbody>
      ${rows.map(exemplarRow).join('')}</tbody></table>` }) : ''}
  </section>`;
  el.querySelectorAll('[data-new-theme]').forEach(b => b.onclick = () => themeDialog(ctx, b.dataset.newTheme));
  el.querySelectorAll('[data-theme-edit]').forEach(b => { const [lv, id] = b.dataset.themeEdit.split('|'); b.onclick = () => themeDialog(ctx, lv, id); });
  el.querySelectorAll('[data-theme-more]').forEach(b => b.onclick = () => {
    const [lv, id] = b.dataset.themeMore.split('|');
    showMenu(b, [{ label: 'Rename…', run: async () => {
        const t = readQual(get())[lv].find(x => x.id === id);
        const n = await ask('Rename theme', { value: t?.label || '', confirm: 'Rename' }); if (n?.trim()) commit(ctx, st => renameQualTheme(st, lv, id, n));
      } },
      '-',
      { label: 'Delete…', danger: true, run: async () => {
        if (await confirmAsk('Delete this theme?', { detail: 'Its codes stay in the codebook.', confirm: 'Delete', danger: true })) commit(ctx, st => removeQualThemes(st, lv, [id]));
      } }], { align: 'end' });
  });
  el.querySelectorAll('[data-statement]').forEach(t => { autoGrow(t); t.onchange = () => update(st => { setQualStatement(st, t.dataset.statement, t.value); return st; }); });
  wireDownload(el.querySelector('#qc-themes-dl'), () => [
    { label: 'CSV', icon: 'table', run: () => downloadCsv(themesCsvRows(themesTable(get())), 'themes.csv') },
    { label: 'Word', icon: 'file', run: async () => saveFile(await writeTablesDocx({ blocks: themesDocxBlocks(themesTable(get())) }), 'themes.docx', DOCX) },
  ]);
  el.querySelector('#qc-themes-insert').onclick = async () => {
    const r = themesTable(get());
    if (!await confirmAsk('Insert the themes table in the manuscript?', { detail: `A table of ${plural(r.length, 'theme')} with exemplar quotes is added at the end.`, confirm: 'Insert' })) return;
    commit(ctx, st => { st.manuscript = st.manuscript || { blocks: [], snapshot: {} }; st.manuscript.blocks = [...(st.manuscript.blocks || []), ...themesManuscriptBlocks(r, newId)]; }, 'Themes table added to the manuscript');
  };
}

/** A member of a theme the dialog offers: its box and its name. */
const memberBox = (v, l, on) => `<label><input type="checkbox" value="${esc(v)}"${on ? ' checked' : ''}><span>${esc(l)}</span></label>`;
async function themeDialog(ctx, level, id = null) {
  const q = readQual(get()), t = id ? q[level].find(x => x.id === id) : null;
  const members = level === 'analytical' ? q.descriptive.map(d => [d.id, d.label]) : codeTree(get()).map(({ code, depth }) => [code.id, `${'– '.repeat(depth)}${code.label}`]);
  const have = new Set(t ? (level === 'analytical' ? t.themes : t.codes) : level === 'descriptive' ? [...ui.chosenCodes] : []);
  const title = t ? t.label : level === 'analytical' ? 'New analytical theme' : 'New descriptive theme';
  const legend = level === 'analytical' ? 'Descriptive themes' : 'Codes';
  const out = await formDialog({ id: 'coding-theme', title, tier: 'M', confirm: t ? 'Save' : 'Add',
    body: `${t ? '' : formField('Name', '<input name="name" autocomplete="off">')}
      <div class="field ui-field" role="group" aria-label="${legend}"><span>${legend}</span><div class="qc-cols qc-cols-list">${members.map(([v, l]) => memberBox(v, l, have.has(v))).join('')}</div></div>`,
    submit: (f, d) => { const n = f.elements.namedItem('name'); if (n && !n.value.trim()) { n.focus(); return undefined; } return { name: n?.value, picked: [...d.querySelectorAll('.qc-cols input:checked')].map(i => i.value) }; } });
  if (!out) return;
  commit(ctx, st => {
    if (!t) { addQualTheme(st, level, out.name, out.picked); return; }
    const cur = level === 'analytical' ? t.themes : t.codes;
    setQualMembers(st, level, t.id, cur.filter(x => !out.picked.includes(x)), false);
    setQualMembers(st, level, t.id, out.picked, true);
  });
}
