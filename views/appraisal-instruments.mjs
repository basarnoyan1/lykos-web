// The review team's own appraisal instruments (lib/custom-instrument.mjs): a sub-page of Appraisal with Back in the title bar (DIALOGS plan
// #32, #33). It lists them (editorRows) and the one opened is edited in place beneath its row: its name and design, its judgement levels in
// order (any marked unranked), its domains with their questions and answers, and the rule for the overall. Duplicate, Export and Delete are
// the open instrument's More. Problems are listed as they arise and Save waits for none. The draft lives here, in the module, so a repaint of
// the page never loses it. Everything is a native control, so the page is used from the keyboard.
import { get, update } from '../store.mjs';
import { confirmAsk } from '../lib/dialog.mjs';
import { download } from '../lib/figure.mjs';
import { esc, emptyState } from '../lib/html.mjs';
import { uiBar, uiList, uiRow, uiRowEnd } from '../lib/ui-actions.mjs';
import { editorRows, wireEditorRows, formField } from '../lib/ui-components.mjs';
import { showMenu } from '../lib/menu.mjs';
import { plural } from '../lib/dates.mjs';
import { exportInstrument, importInstrument, OVERALL_RULES } from '../lib/custom-instrument.mjs';
import { blankInstrument, duplicateInstrument, checkInstrument, saveInstrument, removeInstrument, studiesUsing, normalizeInstruments, reservedIds, freeId } from '../lib/appraisal-custom.mjs';

const RULE_LABEL = { worst: 'Worst domain', manual: 'Reviewer decides', none: 'No overall' };
const list = () => normalizeInstruments(get().customInstruments);

/** Reads a JSON file the person picks; resolves to its text, or null. */
function pickFile() {
  return new Promise(resolve => {
    const input = document.createElement('input');
    input.type = 'file'; input.accept = '.json,application/json';
    input.onchange = async () => resolve(input.files?.[0] ? await input.files[0].text() : null);
    input.oncancel = () => resolve(null);
    input.click();
  });
}

function exportOne(inst) {
  try { download(exportInstrument(inst), `${inst.id}.instrument.json`, 'application/json'); } catch { /* an invalid definition has nothing to export */ }
}

/** An imported definition: taken as a draft in the editor, under a free id when its own is in use. */
async function importOne() {
  const text = await pickFile();
  if (text == null) return null;
  const r = importInstrument(text);
  if (!r.instrument) {
    // a definition that fails only on its id is still worth reading
    let raw = null; try { const d = JSON.parse(text); raw = d?.instrument || d; } catch { /* not JSON */ }
    if (raw && typeof raw === 'object' && Array.isArray(raw.domains)) return structuredClone(raw);
    await confirmAsk('Not imported', { detail: r.errors.join('; '), confirm: 'Close' });
    return null;
  }
  const inst = structuredClone(r.instrument);
  if (reservedIds(get()).includes(inst.id)) inst.id = freeId(get(), inst.name);
  return inst;
}


// ---- the sub-page ----------------------------------------------------------------

let open = false;          // the sub-page is the page shown
let editing = null;        // { draft, own, levels, shown, idTouched }: the instrument opened in place; own is the id it is saved under, '' for a new one
let listPage = 1;
const NEW = '__new';

/** Whether the sub-page is the page shown; Appraisal draws it in place of its studies. */
export const instrumentsOpen = () => open;
export function openInstruments() { open = true; editing = null; listPage = 1; }
/** Back, or leaving Appraisal: the page comes back on its studies and an open draft is dropped. */
export function closeInstruments() { open = false; editing = null; }
/** The title bar of the sub-page: Back to Appraisal, its name and how many instruments there are. */
export function instrumentsSpec(run = {}) {
  const n = list().length;
  return { title: 'Instruments', back: { label: 'Back to Appraisal', run: run.back || (() => {}) }, status: { text: plural(n, 'instrument'), ch: 16 }, actions: [], overflow: [] };
}

const nextId = (taken, prefix) => { for (let n = 1; ; n++) if (!taken.includes(`${prefix}${n}`)) return `${prefix}${n}`; };
const move = (arr, i, by) => { const j = i + by; if (j < 0 || j >= arr.length) return; [arr[i], arr[j]] = [arr[j], arr[i]]; };
const answersText = q => (q.answers || []).join(', ');
const readAnswers = t => String(t).split(',').map(x => x.trim()).filter(Boolean);

/** Starts editing a definition; `own` is the id it is saved under, '' for a new one. */
function begin(start, own = '') {
  const draft = structuredClone(start);
  draft.judgements = Array.isArray(draft.judgements) ? draft.judgements : [];
  draft.unranked = Array.isArray(draft.unranked) ? draft.unranked : [];
  draft.domains = Array.isArray(draft.domains) ? draft.domains : [];
  for (const dm of draft.domains) dm.questions = Array.isArray(dm.questions) ? dm.questions : [];
  // levels are edited by position; the unranked flags follow their level
  editing = { draft, own, shown: false, idTouched: false, levels: draft.judgements.map(j => ({ text: j, unranked: draft.unranked.includes(j) })) };
}
const sync = e => { e.draft.judgements = e.levels.map(l => l.text.trim()); e.draft.unranked = e.levels.filter(l => l.unranked).map(l => l.text.trim()); };

// a row of the editor: its field, and (in More) the moves and the removal; nothing is drawn per row but the field (no number: the order is the list's)
const moreEnd = (kind, label, i, k) => uiRowEnd({ more: { label: `More for ${label}`, attrs: { 'data-more': kind, 'data-i': i, ...(k != null ? { 'data-k': k } : {}) } } });
const levelRows = e => uiList({ id: 'ci-levels', label: 'Judgement levels', rows: e.levels.map((l, i) => uiRow({
  main: { html: `<input type="text" data-level="${i}" value="${esc(l.text)}" aria-label="Level ${i + 1}" placeholder="Judgement level" spellcheck="false">`, detail: l.unranked ? ['Unranked'] : [] },
  end: moreEnd('level', `level ${i + 1}`, i) })) });
// a question is two rows: its text with its More, and its answers beneath it, so every More stands level with the field it belongs to
const questionRows = (dm, i) => uiList({ id: `ci-questions-${i}`, label: `Questions of domain ${i + 1}`, rows: dm.questions.flatMap((q, k) => [
  uiRow({ depth: 1, main: { html: `<input type="text" data-qtext="${i}.${k}" value="${esc(q.text || '')}" aria-label="Question ${i + 1}.${k + 1}" placeholder="Question" spellcheck="false">` },
    end: moreEnd('question', `question ${i + 1}.${k + 1}`, i, k) }),
  uiRow({ depth: 1, main: { html: `<input type="text" data-qans="${i}.${k}" value="${esc(answersText(q))}" aria-label="Answers to question ${i + 1}.${k + 1}" placeholder="Yes, No, Unclear" spellcheck="false">` },
    end: uiRowEnd({ reserve: true }) })]) });
const addBar = (id, label, act, i) => uiBar({ kind: 'foot', label, id: `ci-bar-${id}`, actions: [{ id: `ci-${id}`, label, icon: 'plus', attrs: { 'data-e': act, ...(i != null ? { 'data-i': i } : {}) } }] });
const domainRows = e => e.draft.domains.map((dm, i) => `<section class="ci-domain">
    ${uiList({ id: `ci-domain-${i}`, label: `Domain ${i + 1}`, rows: [uiRow({ main: { html: `<input type="text" data-dname="${i}" value="${esc(dm.name || '')}" aria-label="Domain ${i + 1} name" placeholder="Domain name" spellcheck="false">` }, end: moreEnd('domain', `domain ${i + 1}`, i) })] })}
    ${dm.questions.length ? questionRows(dm, i) : ''}${addBar(`qadd-${i}`, 'Add question', 'qadd', i)}</section>`).join('');
const section = (id, title, message) => uiBar({ kind: 'head', label: title, id, lead: { title, level: 'h3' }, ...(message ? { message: { text: message } } : {}) });

const textField = (label, key, value, extra = '') => formField(label, `<input type="text" data-k="${key}" value="${esc(value || '')}" aria-label="${label}" spellcheck="false"${extra}>`);
const overallField = value => formField('Overall', `<select data-k="overall" aria-label="Overall">${OVERALL_RULES.map(r => `<option value="${r}"${value === r ? ' selected' : ''}>${esc(RULE_LABEL[r])}</option>`).join('')}</select>`);

/** The editor beneath the open instrument's row. */
function panelHtml(e) {
  const { draft, own } = e;
  return `<div class="ci-edit" data-ci-edit>
    <div class="an-settings">
      ${textField('Name', 'name', draft.name)}
      ${textField('Design', 'design', draft.design, ' placeholder="Study designs it appraises"')}
      ${textField('Id', 'id', draft.id, own ? ' disabled' : '')}
      ${overallField(draft.overall)}
    </div>
    ${section('ci-levels-head', 'Judgement levels', 'Most to least favourable')}
    <div data-levels>${levelRows(e)}</div>
    ${addBar('ladd', 'Add level', 'ladd')}
    ${section('ci-domains-head', 'Domains')}
    <div data-domains>${domainRows(e)}</div>
    ${addBar('dadd', 'Add domain', 'dadd')}
    <ul class="ci-errors" role="alert" aria-live="polite"></ul>
    ${uiBar({ kind: 'foot', label: 'Instrument', id: 'ci-edit-foot', start: [{ id: 'ci-export', label: 'Export', icon: 'export', attrs: { 'data-e': 'export' } }],
      actions: [{ id: 'ci-cancel', label: 'Cancel', keep: true }, { id: 'ci-save', label: 'Save', role: 'primary' }],
      overflow: own ? [{ id: 'ci-dup', label: 'Duplicate' }, { id: 'ci-del', label: 'Delete instrument', danger: true }] : [] })}
  </div>`;
}

/** Wires the open editor. Typing changes the draft in place and nothing is redrawn, so focus stays; a structural change redraws the two lists. */
function wirePanel(panel, e, { draw, done }) {
  const { draft, own } = e, errorsEl = panel.querySelector('.ci-errors'), save = panel.querySelector('#ci-save');
  const check = (force = false) => {
    sync(e);
    e.shown = e.shown || force;   // problems are listed after the first edit or save, not on an untouched new form
    const v = checkInstrument(get(), draft, own);
    errorsEl.innerHTML = e.shown ? v.errors.map(x => `<li>${esc(x)}</li>`).join('') : '';
    save.setAttribute('aria-disabled', String(!v.ok));
    return v;
  };
  const redraw = focusSel => {
    panel.querySelector('[data-levels]').innerHTML = levelRows(e);
    panel.querySelector('[data-domains]').innerHTML = domainRows(e);
    check();
    if (focusSel) panel.querySelector(focusSel)?.focus();
  };
  panel.addEventListener('input', ev => {
    const t = ev.target, ds = t.dataset;
    if (ds.k) {
      draft[ds.k] = t.value;
      if (ds.k === 'id') e.idTouched = true;
      // a new instrument's id follows its name until the id is typed
      if (ds.k === 'name' && !own && !e.idTouched) { draft.id = freeId(get(), t.value); panel.querySelector('[data-k="id"]').value = draft.id; }
    }
    else if (ds.level != null) e.levels[+ds.level].text = t.value;
    else if (ds.dname != null) draft.domains[+ds.dname].name = t.value;
    else if (ds.qtext != null) { const [i, k] = ds.qtext.split('.').map(Number); draft.domains[i].questions[k].text = t.value; }
    else if (ds.qans != null) { const [i, k] = ds.qans.split('.').map(Number); draft.domains[i].questions[k].answers = readAnswers(t.value); }
    e.shown = true; check();
  });
  panel.addEventListener('change', ev => { if (ev.target.dataset.k === 'overall') { draft.overall = ev.target.value; check(); } });
  const edit = (name, i, k) => {
    switch (name) {
      case 'ladd': e.levels.push({ text: '', unranked: false }); return redraw(`[data-level="${e.levels.length - 1}"]`);
      case 'lup': move(e.levels, i, -1); return redraw(`[data-more="level"][data-i="${Math.max(0, i - 1)}"]`);
      case 'ldown': move(e.levels, i, 1); return redraw(`[data-more="level"][data-i="${Math.min(e.levels.length - 1, i + 1)}"]`);
      case 'ldel': e.levels.splice(i, 1); return redraw('[data-e="ladd"]');
      case 'dadd': draft.domains.push({ id: nextId(draft.domains.map(x => x.id), 'd'), name: '', questions: [] }); return redraw(`[data-dname="${draft.domains.length - 1}"]`);
      case 'dup': move(draft.domains, i, -1); return redraw(`[data-more="domain"][data-i="${Math.max(0, i - 1)}"]`);
      case 'ddown': move(draft.domains, i, 1); return redraw(`[data-more="domain"][data-i="${Math.min(draft.domains.length - 1, i + 1)}"]`);
      case 'ddel': draft.domains.splice(i, 1); return redraw('[data-e="dadd"]');
      case 'qadd': { const qs = draft.domains[i].questions; qs.push({ id: nextId(qs.map(q => q.id), 'q'), text: '', answers: ['Yes', 'No', 'Unclear'] }); return redraw(`[data-qtext="${i}.${qs.length - 1}"]`); }
      case 'qdel': draft.domains[i].questions.splice(k, 1); return redraw(`[data-e="qadd"][data-i="${i}"]`);
      case 'export': if (check(true).ok) exportOne(draft); return;
    }
  };
  // the moves and the removal of a row are its More menu
  const rowMenu = (b, kind, i, k) => {
    const last = kind === 'level' ? e.levels.length - 1 : draft.domains.length - 1, c = kind[0];
    showMenu(b, [...(kind === 'question' ? [] : [{ label: 'Move up', icon: 'arrow-up', disabled: i === 0, run: () => edit(`${c}up`, i) }, { label: 'Move down', icon: 'arrow-down', disabled: i >= last, run: () => edit(`${c}down`, i) }, '-']),
      ...(kind === 'level' ? [{ label: 'Unranked', checked: !!e.levels[i].unranked, checkType: 'checkbox', run: () => { e.levels[i].unranked = !e.levels[i].unranked; redraw(`[data-more="level"][data-i="${i}"]`); } }, '-'] : []),
      { label: `Remove ${kind}`, icon: 'trash', danger: true, run: () => edit(`${c}del`, i, k) }], { align: 'end' });
  };
  panel.addEventListener('click', ev => {
    const more = ev.target.closest('[data-more]');
    if (more) return rowMenu(more, more.dataset.more, Number(more.dataset.i), Number(more.dataset.k));
    const b = ev.target.closest('[data-e]'); if (!b) return;
    edit(b.dataset.e, Number(b.dataset.i), Number(b.dataset.k));
  });
  const submit = () => {
    if (!check(true).ok) { if (errorsEl.querySelector('li')) errorsEl.scrollIntoView?.({ block: 'nearest' }); return; }
    const out = structuredClone(draft);
    out.name = String(out.name || '').trim(); out.design = String(out.design || '').trim(); out.id = String(out.id || '').trim();
    if (!out.unranked.length) delete out.unranked;
    update(st => saveInstrument(st, out, own));
    editing = null; done(own || out.id);
  };
  save.onclick = submit;
  // Enter in a field saves, as the dialog's form did
  panel.addEventListener('keydown', ev => { if (ev.key === 'Enter' && ev.target.matches?.('input[type=text]') && !ev.defaultPrevented) { ev.preventDefault(); submit(); } });
  panel.querySelector('#ci-cancel').onclick = () => { const id = own || NEW; editing = null; draw(id); };
  panel.querySelector('#ci-dup')?.addEventListener('click', () => { const src = list().find(x => x.id === own); if (src) { begin(duplicateInstrument(get(), src), ''); draw(null, true); } });
  panel.querySelector('#ci-del')?.addEventListener('click', () => removeOne(own, { draw, done }));
  check();
}

async function removeOne(id, { done }) {
  const inst = list().find(x => x.id === id); if (!inst) return;
  const n = studiesUsing(get(), inst.id).length;
  if (!await confirmAsk(`Delete ${inst.name || inst.id}?`, { detail: n ? `Judgements for ${n} ${n === 1 ? 'study' : 'studies'} are deleted with it.` : '', confirm: 'Delete', danger: true })) return;
  update(st => removeInstrument(st, inst.id));
  editing = null; done('');
}

/**
 * The sub-page under Appraisal's title bar: the tools row (Import, New instrument) and the instruments, the open one with its editor beneath.
 * `ctx.rerender` repaints the title bar as well (its count follows the list); `ctx.refreshCounts` follows a change to what is appraised.
 */
export function renderInstruments(el, ctx) {
  const items = list();
  // after a change the page is drawn again; `focusId` names the control to give the keyboard back
  const draw = (focusId, intoEditor = false) => {
    renderInstruments(el, ctx);
    (intoEditor ? el.querySelector('[data-ci-edit] [data-k="name"]') : focusId && el.querySelector(`[data-edit-row="${CSS.escape(focusId)}"]`))?.focus();
  };
  const done = focusId => { ctx.rerender(); ctx.refreshCounts?.(); if (focusId) document.querySelector(`#view [data-edit-row="${CSS.escape(focusId)}"]`)?.focus(); };
  const rows = [...(editing && !editing.own ? [{ __new: true, ...editing.draft }] : []), ...items];
  const body = rows.length ? editorRows({ id: 'ci-rows', label: 'Instruments', items: rows, key: x => (x.__new ? NEW : x.id), title: x => x.name || x.id || 'New instrument', noun: 'instruments',
    selected: editing ? (editing.own || NEW) : null, page: editing ? undefined : listPage,
    columns: [{ head: 'Instrument', cell: x => `<span class="ci-name">${esc(x.name || x.id || 'New instrument')}</span>` }, { head: 'Design', cell: x => esc(x.design || 'Any design') },
      { head: 'Domains', num: true, cell: x => String((x.domains || []).length) }, { head: 'Overall', cell: x => esc(RULE_LABEL[x.overall] || '') }],
    editor: () => panelHtml(editing) })
    : emptyState({ icon: 'appraisal', title: 'No custom instruments', size: 'inline' });
  el.innerHTML = `<section class="ci-page" aria-label="Instruments">
    ${uiBar({ kind: 'tools', label: 'Instruments', id: 'ci-tools',
      actions: [{ id: 'ci-import', label: 'Import', icon: 'import', role: 'secondary' }, { id: 'ci-new', label: 'New instrument', icon: 'plus', role: 'primary' }] })}
    ${body}
    ${items.length || editing ? '' : '<p class="meta" data-ui-help>Define domains, questions and judgement levels when no shipped instrument fits the review.</p>'}
  </section>`;
  el.querySelector('#ci-new').onclick = () => { begin(blankInstrument(get()), ''); draw(null, true); };
  el.querySelector('#ci-import').onclick = async () => { const draft = await importOne(); if (draft) { begin(draft, ''); draw(null, true); } };
  wireEditorRows(el, 'ci-rows', {
    onSelect: k => { const inst = k ? list().find(x => x.id === k) : null; if (inst) begin(inst, inst.id); else editing = null; draw(); },
    onPage: n => { listPage = n; editing = null; draw(); } });
  const panel = el.querySelector('[data-ci-edit]');
  if (panel && editing) wirePanel(panel, editing, { draw, done });
}
