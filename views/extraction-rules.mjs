// Cell rules in the Extraction view: the check of the table in view, the
// header summary and its filter, the rules of the selected cell in the
// inspector, the rule editor, the assistant context and Suggest fixes
// (lib/cell-rules.mjs; plan G5, amendment of 2026-09-28). Kept apart from
// extraction.mjs, which calls in at a few marked places.
import { get, update, getVersion } from '../store.mjs';
import { esc } from '../lib/html.mjs';
import { disclosure, formField } from '../lib/ui-components.mjs';
import { inspectorActions, uiBar, uiList, uiRow, uiRowEnd } from '../lib/ui-actions.mjs';
import { icon } from '../lib/icons.mjs';
import { KINDS, SCOPES, kindLabel, rulesOf, checkValue, rulesFor, summaryText, active, newRuleId, validPattern, ruleDetail, fixMessages, parseFixes, parseCellKey, EMPTY_RULES, requiredMissing, REQUIRED_RULE, withoutFieldRules, checkTable } from '../lib/cell-rules.mjs';
import { propose, proposalFor } from '../lib/proposals.mjs';
import { complete, configured } from '../lib/ai.mjs';
import { CELLS_FIX } from '../lib/prompts.mjs';
import { modelFor } from '../lib/model-settings.mjs';
import { confirmAsk } from '../lib/dialog.mjs';
import { showMenu } from '../lib/menu.mjs';
import { rerenderForm } from '../lib/form-rerender.mjs';

let result = null;       // the last check of the table in view
let rulesOnly = false;   // the header filter: studies with a broken rule
let editor = null;       // { templateId, columnId | null, editing: rule id | 'new' | null, kind }
let fixRun = null;       // { templateId, done, total, status, error }
let rulesBoxOpen = null; // the inspector's rules box: null follows what is broken, true or false is the reader's choice

const DEFAULT_SCOPE = { allowed: 'line', pattern: 'line', forbidden: 'cell', 'max-words': 'line', number: 'line', capital: 'line', parentheses: 'cell', terms: 'item', 'standard-phrase': 'item' };
const textOf = v => v == null ? '' : v.availability === 'not_found' && v.reported_value == null ? 'NR' : String(v.reported_value ?? '');

/**
 * Checks the table in view; called once per render, before cells are drawn.
 * `papers`, when given, are the table's studies: a required field (plan G1)
 * with no value in one of them is a broken rule of its own.
 */
let checked = null;   // what the last check was of: the project's version, the table and its studies; the same again is not checked again
export function checkRules(template, state = get(), papers = null) {
  const key = state === get() ? `${getVersion()}|${template?.id}|${papers ? papers.map(p => p.id).join(',') : '-'}` : null;
  if (key && key === checked) { if (!result?.count) rulesOnly = false; if (editor && editor.templateId !== template?.id) editor = null; return result; }
  checked = key;
  const rules = rulesOf(template, state);
  result = rules ? { ...checkTable(state.values, template, rules), all: rules, template } : null;
  const missing = papers ? requiredMissing(state.values, papers, template.columns) : [];
  if (missing.length) {
    result ||= { cells: new Map(), rules: new Map(), papers: new Set(), count: 0, all: rules || EMPTY_RULES(), template };
    const e = { rule: REQUIRED_RULE, column: null, cells: new Set() };
    for (const m of missing) { result.cells.set(m.key, [...(result.cells.get(m.key) || []), { rule: REQUIRED_RULE, message: 'Required', hint: 'No value' }]); result.papers.add(m.paperId); e.cells.add(m.key); }
    e.count = e.cells.size; result.rules.set(REQUIRED_RULE.id, e); result.count = result.cells.size;
  }
  if (!result?.count) rulesOnly = false;
  if (editor && editor.templateId !== template?.id) editor = null;
  return result;
}
/** The class a cell carries when its value breaks a rule. */
export const ruleClass = (paperId, columnId) => result?.cells.has(`${paperId}:${columnId}`) ? 'rule-broken' : '';
/** How many rules the cell's value breaks, for its Details panel. */
export const brokenCount = (paperId, columnId) => result?.cells.get(`${paperId}:${columnId}`)?.length || 0;
/** The studies the header filter keeps. */
export const rulesFilter = papers => rulesOnly && result?.count ? papers.filter(p => result.papers.has(p.id)) : papers;

/** The Show menu's rule entry while something is broken ("17 cells break 7 rules"), as [value, label]; null when nothing is. */
export const rulesChoice = () => (result?.count ? ['rules', summaryText(result)] : null);
/** Whether the table shows only the studies with a broken rule, and the way to say so (the Show menu: views/extraction.mjs). */
export const rulesShown = () => rulesOnly && !!result?.count;
export function showRules(on) { rulesOnly = !!on; }
/** What Suggest fixes is doing, for the tools row's message ('' when nothing runs for this table). */
export function rulesMessage() {
  const run = fixRun && result && fixRun.templateId === result.template.id ? fixRun : null;
  if (!run) return '';
  return run.status === 'running' ? `Suggesting fixes (${run.done} of ${run.total})` : run.status === 'failed' ? `Fixes failed: ${run.error}` : `${run.proposed} ${run.proposed === 1 ? 'fix' : 'fixes'} proposed`;
}

/** The table's rules and Suggest fixes: the source of the head's overflow entries and of what they do. */
export function rulesMenu(ctx, template) {
  const cfg = modelFor('extract');
  const running = fixRun?.status === 'running';
  return [
    { label: 'Table rules', run: () => { editor = { templateId: template.id, columnId: null, editing: null }; ctx.rerender(); ctx.openDetails?.(); } },
    { label: running ? 'Suggesting fixes' : 'Suggest fixes', disabled: !result?.count || !configured(cfg) || running, run: () => suggestFixes(ctx, template, cfg) },
  ];
}
const RULE_IDS = ['ext-rules-table', 'ext-rules-fix'];
/** The same entries as overflow declarations of the title bar's More, each with its run. */
export const rulesOverflow = (ctx, template) => rulesMenu(ctx, template).map((e, i) => ({ id: RULE_IDS[i], label: e.label, disabled: !!e.disabled, run: e.run }));

/** After the view is drawn: the layout says when only the studies with a broken rule are shown (the title bar's More holds Table rules and Suggest fixes). The rules themselves live in the inspector (ruleEditorSections, cellRulesBox). */
export function wireRules(el) {
  el.querySelector('.ext-layout')?.classList.toggle('ext-rules-only', rulesOnly && !!result?.count);
}

/**
 * The inspector's sections while the rule editor is open for this table. The
 * editor replaces the selected cell's evidence until it is closed, as it did
 * when the evidence panel was part of the view.
 */
export function ruleEditorSections(ctx, template) {
  if (!editor || editor.templateId !== template?.id) return null;
  return [{ html: '<div class="evidence-detail"></div>', wire: host => drawEditor(host.closest('#assist-log') || host, host.querySelector('.evidence-detail'), ctx, template) }];
}

/** The selected cell's rules, above its actions in the evidence panel drawn in `host`. */
export function cellRulesBox(host, ctx, template, sel) {
  if (result && sel) cellRules(host, ctx, template, sel);
}

// ---- the selected cell ----------------------------------------------------------

function cellRules(host, ctx, template, sel) {
  const key = `${sel.paperId}:${sel.columnId}`;
  const base = parseCellKey(key)?.columnId;
  const column = (template.columns || []).find(c => c.id === base);
  if (!column) return;
  const rules = result?.all || rulesOf(template, get());
  const own = active(rulesFor(rules, column));
  const broken = result?.cells.get(key) || [];
  const pr = proposalFor(sel.paperId, sel.columnId);
  const prBroken = pr ? checkValue(pr.value, rules, column) : [];
  const line = f => `<div class="ev-rule"><span>${esc(f.message)}</span>${f.found || f.hint ? `<span class="meta">${esc([f.found ? `“${f.found}”` : '', f.hint || ''].filter(Boolean).join('; '))}</span>` : ''}</div>`;
  const box = document.createElement('div');
  box.className = 'ev-rules';
  const count = broken.length + prBroken.length;
  // a rule is a row only when the value breaks it; the summary line already says Met or None
  const body = `${broken.map(line).join('')}
    ${prBroken.length ? `<div class="meta">Proposed value</div>${prBroken.map(line).join('')}` : ''}
    ${inspectorActions({ label: 'Rules actions', id: 'ev-rules-acts', actions: [{ id: 'ev-rules-edit', label: own.length ? 'Edit rules' : 'Add rules' }] })}`;
  box.innerHTML = disclosure({ id: 'ev-rules-box', title: 'Rules', meta: count ? `${count} broken` : own.length ? 'Met' : 'None', open: rulesBoxOpen ?? count > 0, body });
  const foot = host.querySelector(':scope > #ev-foot');
  if (foot) host.insertBefore(box, foot); else host.append(box);
  box.querySelector('summary').onclick = () => { rulesBoxOpen = !box.querySelector('#ev-rules-box').open; };   // the click comes before the toggle, so the new state is the opposite
  box.querySelector('#ev-rules-edit').onclick = () => { editor = { templateId: template.id, columnId: column.id, editing: null }; ctx.rerender(); };
}

// ---- the editor -------------------------------------------------------------------

function saveRules(templateId, next) {
  next = withoutFieldRules(next);   // a field's own checks are edited with the field (lib/fields.mjs)
  update(s => {
    if (templateId === 'default') { s.extractionRules = next; return s; }
    const t = (s.templates || []).find(x => x.id === templateId);
    if (t) t.rules = next;
    return s;
  });
}
const listOf = (rules, columnId) => columnId ? (rules.columns[columnId] || []) : rules.general;
const withList = (rules, columnId, list) => columnId ? { ...rules, columns: { ...rules.columns, [columnId]: list } } : { ...rules, general: list };
const lines = v => String(v || '').split('\n').map(x => x.trim()).filter(Boolean);

const field = formField;
function check(name, label, on) { return `<label class="cr-check"><input type="checkbox" name="${name}"${on ? ' checked' : ''}><span>${label}</span></label>`; }

function formHtml(r) {
  const scope = r.kind in DEFAULT_SCOPE ? field('Applies to', `<select name="scope">${SCOPES.map(([v, l]) => `<option value="${v}"${(r.scope || DEFAULT_SCOPE[r.kind]) === v ? ' selected' : ''}>${l}</option>`).join('')}</select>`) : '';
  const msg = r.kind === 'note' ? field('Note', `<textarea name="message" rows="4">${esc(r.message)}</textarea>`) : field('Message', `<input name="message" value="${esc(r.message)}" spellcheck="false">`);
  const nr = check('nr', 'NR passes', r.nr);
  const body = {
    allowed: () => field('Values', `<textarea name="values" rows="5" spellcheck="false">${esc((r.values || []).join('\n'))}</textarea>`) + check('caseInsensitive', 'Ignore case', r.caseInsensitive) + nr,
    pattern: () => field('Pattern', `<input name="pattern" value="${esc(r.pattern || '')}" spellcheck="false">`) + check('ignoreCase', 'Ignore case', (r.flags || '').includes('i')) + nr,
    forbidden: () => field('Phrases', `<textarea name="phrases" rows="5" spellcheck="false">${esc((r.phrases || []).map(p => `${p.regex ? `/${p.text}/` : p.text}${p.replacement ? ` → ${p.replacement}` : ''}`).join('\n'))}</textarea>`),
    'max-words': () => field('Words', `<input name="max" inputmode="numeric" value="${esc(r.max ?? 20)}">`),
    number: () => check('whole', 'Whole percentages', r.percent === 'whole') + field('After label', `<input name="after" value="${esc(r.after || '')}" spellcheck="false">`) + field('Decimals', `<input name="decimals" inputmode="numeric" value="${esc(r.decimals ?? '')}">`) + check('counts', 'n/N and % agree', r.counts) + check('nonzero', 'Counts above zero have a %', r.percent === 'nonzero'),
    capital: () => field('Exceptions', `<textarea name="except" rows="2" spellcheck="false">${esc((r.except || []).join('\n'))}</textarea>`),
    parentheses: () => field('Allowed', `<textarea name="allow" rows="3" spellcheck="false">${esc((r.allow || []).join('\n'))}</textarea>`),
    terms: () => field('Terms', `<textarea name="terms" rows="4" spellcheck="false">${esc((r.terms || []).join('\n'))}</textarea>`),
    'standard-phrase': () => field('Also allowed', `<textarea name="allow" rows="2" spellcheck="false">${esc((r.allow || []).join('\n'))}</textarea>`),
  }[r.kind]?.() || '';
  return `<form class="cr-form" data-form="${esc(r.id)}"><div class="cr-form-kind">${esc(kindLabel(r.kind))}</div><div class="an-settings">${msg}${body}${scope}</div>
    <div class="cr-error meta" hidden></div>
    ${inspectorActions({ label: 'Save the rule', id: 'cr-form-foot', actions: [{ id: 'cr-cancel', label: 'Cancel', attrs: { 'data-cancel': '' } }, { id: 'cr-save', label: 'Save', type: 'submit' }] })}</form>`;
}

function readForm(form, r) {
  const v = n => form.elements[n]?.value ?? '';
  const on = n => !!form.elements[n]?.checked;
  const next = { ...r, message: v('message').trim() };
  if (form.elements.scope) next.scope = v('scope');
  if ('nr' in form.elements) next.nr = on('nr');
  switch (r.kind) {
    case 'allowed': Object.assign(next, { values: lines(v('values')), caseInsensitive: on('caseInsensitive') }); break;   // a rule's value list, not accepted values
    case 'pattern': next.pattern = v('pattern').trim(); next.flags = on('ignoreCase') ? 'i' : ''; if (!validPattern(next.pattern, next.flags)) return { error: 'Pattern does not compile' }; break;
    case 'forbidden': next.phrases = lines(v('phrases')).map(l => {
      const [text, replacement] = l.split(/\s*→\s*/);
      const re = /^\/(.+)\/$/.exec(text);
      return { text: re ? re[1] : text, ...(re ? { regex: true } : {}), ...(replacement ? { replacement } : {}) };
    });
      if (next.phrases.some(p => p.regex && !validPattern(p.text))) return { error: 'A phrase pattern does not compile' };
      break;
    case 'max-words': next.max = Math.max(1, Math.round(Number(v('max')) || 20)); break;
    case 'number': {
      next.percent = on('whole') ? 'whole' : on('nonzero') ? 'nonzero' : undefined;
      next.after = v('after').trim() || undefined;
      next.decimals = v('decimals') === '' ? undefined : Number(v('decimals'));
      next.counts = on('counts') || on('nonzero');
      break;
    }
    case 'capital': next.except = lines(v('except')); break;
    case 'parentheses': next.allow = lines(v('allow')); if (next.allow.some(a => !validPattern(a))) return { error: 'An allowed pattern does not compile' }; break;
    case 'terms': next.terms = lines(v('terms')); break;
    case 'standard-phrase': next.allow = lines(v('allow')); break;
  }
  if (!next.message) next.message = kindLabel(r.kind);
  return { rule: next };
}

const BLANK = { allowed: { values: [], nr: true }, pattern: { pattern: '', nr: true }, forbidden: { phrases: [] }, 'max-words': { max: 20 }, number: { percent: 'whole' },
  capital: {}, parentheses: { allow: ['\\(n=\\d+\\)'] }, terms: { terms: [] }, 'standard-phrase': { minRows: 2, minStudies: 10 }, spelling: {}, unique: {}, note: {} };

function drawEditor(el, host, ctx, template) {
  const all = rulesOf(template, get()) || EMPTY_RULES();
  const column = editor.columnId ? (template.columns || []).find(c => c.id === editor.columnId) : null;
  if (editor.columnId && !column) { editor = null; return; }
  const list = listOf(all, editor.columnId);
  const counts = new Map([...(result?.rules || new Map()).entries()].map(([id, e]) => [id, e.count]));
  if (editor.editing && editor.draftId !== editor.editing) {
    editor.draftId = editor.editing;
    editor.draft = editor.editing === 'new' ? { id: newRuleId(), kind: editor.kind, message: '', ...structuredClone(BLANK[editor.kind] || {}) }
      : structuredClone(list.find(r => r.id === editor.editing));
    editor.formValues = {};
  }
  const draft = editor.editing === 'new' ? editor.draft : null;
  const ruleRow = r => uiRow({ cls: `cr-rule${r.off ? ' off' : ''}`, attrs: { 'data-rule': r.id },
    ...(r.field || r.kind === 'note' ? {} : { check: { checked: !r.off, label: `Check ${r.message}`, attrs: { 'data-on': r.id, 'data-form-key': `rule:${r.id}:enabled` } } }),
    main: { html: `<span class="cr-msg">${esc(r.message)}</span>`, wrap: true,
      detail: [kindLabel(r.kind), ruleDetail(r), counts.get(r.id) ? `${counts.get(r.id)} ${counts.get(r.id) === 1 ? 'cell' : 'cells'}` : '', r.field ? 'From the field' : ''].map(x => x && esc(x)) },
    ...(r.field ? {} : { end: uiRowEnd({ inline: { id: `cr-edit-${r.id}`, label: 'Edit rule', icon: 'rename', attrs: { 'data-edit': r.id } }, more: { label: 'More for this rule', attrs: { 'data-rule-more': r.id } } }) }) });
  // consecutive rules are one list; the open form sits between lists
  const parts = []; let run = [];
  const flush = () => { if (run.length) parts.push(uiList({ id: `cr-list-${parts.length}`, label: 'Rules', rows: run })); run = []; };
  for (const r of list) { if (editor.editing === r.id) { flush(); parts.push(formHtml(editor.draft || r)); } else run.push(ruleRow(r)); }
  flush();
  if (draft) parts.push(formHtml(draft));
  host.innerHTML = `${uiBar({ kind: 'head', label: 'Rules', id: 'cr-head', lead: { title: 'Rules' }, message: { text: column ? column.label : 'All text columns' },
      actions: [{ id: 'cr-close', label: 'Close', icon: 'close', role: 'quiet' }] })}
    <div class="cr-list">${parts.join('') || '<div class="meta">No rules</div>'}</div>
    ${uiBar({ kind: 'tools', label: 'Add a rule', id: 'cr-add-bar', cls: 'cr-add',
      filters: [{ type: 'select', id: 'cr-kind', label: 'Rule kind', value: editor.kind, options: KINDS.filter(([k]) => (column || !['unique'].includes(k)) && k !== 'range').map(([k, l]) => [k, l]) }],
      actions: [{ id: 'cr-add', label: 'Add rule', icon: 'plus', disabled: !!editor.editing }] })}
    ${column ? '' : `<div class="an-settings">${field('Annotations', `<textarea id="cr-qualifiers" rows="2" spellcheck="false">${esc((all.qualifiers || []).join('\n'))}</textarea>`)}</div>`}
    ${column ? inspectorActions({ label: 'Table rules', id: 'cr-foot', actions: [{ id: 'cr-general', label: 'Table rules' }] }) : ''}`;
  const save = next => { saveRules(template.id, next); rerenderForm(el, ctx); };
  host.querySelector('#cr-close').onclick = () => { editor = null; ctx.rerender(); };
  host.querySelector('#cr-general')?.addEventListener('click', () => { editor = { templateId: template.id, columnId: null, editing: null }; ctx.rerender(); });
  host.querySelector('#cr-kind').onchange = e => { editor.kind = e.target.value; };
  host.querySelector('#cr-add').onclick = () => { editor.kind = host.querySelector('#cr-kind').value; editor.editing = 'new'; ctx.rerender(); };
  host.querySelector('#cr-qualifiers')?.addEventListener('change', e => save({ ...all, qualifiers: lines(e.target.value) }));
  host.querySelectorAll('[data-on]').forEach(b => b.onchange = () => save(withList(all, editor.columnId, list.map(r => r.id === b.dataset.on ? { ...r, off: !b.checked } : r))));
  host.querySelectorAll('[data-edit]').forEach(b => b.onclick = () => { editor.editing = b.dataset.edit; ctx.rerender(); });
  host.querySelectorAll('[data-rule-more]').forEach(b => b.onclick = () => showMenu(b, [{ label: 'Remove rule', danger: true, run: async () => {
    const r = list.find(x => x.id === b.dataset.ruleMore);
    if (!await confirmAsk(`Remove “${r.message}”?`, { confirm: 'Remove', danger: true })) return;
    save(withList(all, editor.columnId, list.filter(x => x.id !== r.id)));
  } }], { align: 'end' }));
  host.querySelectorAll('.cr-form').forEach(form => {
    const original = editor.draft || list.find(x => x.id === form.dataset.form) || draft;
    for (const input of form.elements) if (input.name && input.name in editor.formValues) {
      const value = editor.formValues[input.name]; if (input.type === 'checkbox') input.checked = value; else input.value = value;
    }
    for (const input of form.elements) if (input.name) input.setAttribute('data-form-key', `rule:${original.id}:${input.name}`);
    form.oninput = form.onchange = e => { const input = e.target; if (input.name) editor.formValues[input.name] = input.type === 'checkbox' ? input.checked : input.value; };
    form.querySelector('[data-cancel]').onclick = () => { editor.editing = null; editor.draftId = null; editor.draft = null; editor.formValues = {}; ctx.rerender(); };
    form.onsubmit = e => {
      e.preventDefault();
      const got = readForm(form, original);
      if (got.error) { const err = form.querySelector('.cr-error'); err.hidden = false; err.textContent = got.error; return; }
      editor.editing = null;
      editor.draftId = null; editor.draft = null; editor.formValues = {};
      save(withList(all, editor.columnId, list.some(x => x.id === original.id) ? list.map(x => x.id === original.id ? got.rule : x) : [...list, got.rule]));
    };
  });
  host.querySelector('.cr-form input, .cr-form textarea')?.focus();
}

// ---- the assistant ------------------------------------------------------------------

/** What the assistant is told about the rules: the selected cell's, or the table's offenders. */
export function rulesContext(sel = null) {
  if (!result) return '';
  const st = get();
  const label = id => st.papers.find(p => p.id === id)?.label || id;
  const colLabel = id => (result.template.columns || []).find(c => c.id === parseCellKey(`x:${id}`).columnId)?.label || id;
  // a finding that is the whole value is not repeated
  const say = (f, value = '') => `${f.message}${f.found && f.found !== value.trim() ? ` (found “${f.found}”)` : ''}${f.hint ? ` — ${f.hint}` : ''}`;
  if (sel) {
    const found = result.cells.get(`${sel.paperId}:${sel.columnId}`) || [];
    const value = textOf(st.values[`${sel.paperId}:${sel.columnId}`]);
    return found.length ? `Cell rules broken in this cell: ${found.map(f => say(f, value)).join('; ')}.` : '';
  }
  if (!result.count) return 'Cell rules: every value meets the rules.';
  const rows = [...result.cells].slice(0, 15).map(([k, fs]) => {
    const p = parseCellKey(k);
    const value = textOf(st.values[k]);
    return `- ${label(p.paperId)}, ${colLabel(p.columnId)}${p.arm ? `, ${p.arm}` : ''}: ${fs.map(f => say(f, value)).join('; ')}; value “${value.slice(0, 200)}”`;
  });
  return `Cell rules: ${summaryText(result)}.${result.count > rows.length ? ` First ${rows.length}:` : ''}\n${rows.join('\n')}`.slice(0, 3000);
}

// ---- suggest fixes ----------------------------------------------------------------

const BATCH = 12, LIMIT = 60;

async function suggestFixes(ctx, template, cfg) {
  if (!result?.count || !configured(cfg) || fixRun?.status === 'running') return;
  const st = get();
  const items = [...result.cells].filter(([k]) => !proposalFor(parseCellKey(k).paperId, k.slice(k.indexOf(':') + 1))).slice(0, LIMIT).map(([key, findings]) => {
    const p = parseCellKey(key);
    const column = (template.columns || []).find(c => c.id === p.columnId);
    return { key, paperId: p.paperId, cellId: key.slice(key.indexOf(':') + 1), column: column?.label || p.columnId, value: textOf(st.values[key]), findings, rules: active(rulesFor(result.all, column)), col: column };
  }).filter(x => x.value);
  if (!items.length) return;
  const run = fixRun = { templateId: template.id, done: 0, total: Math.ceil(items.length / BATCH), status: 'running', proposed: 0, error: '' };
  ctx.rerender();
  try {
    for (let i = 0; i < items.length; i += BATCH) {
      const batch = items.slice(i, i + BATCH);
      const reply = await complete(cfg, fixMessages(batch, { conventions: template.conventions || [] }), { temperature: 0, json: true, prompt: CELLS_FIX });
      for (const f of parseFixes(reply, batch)) {
        const x = batch.find(b => b.key === f.key);
        // a rewording that breaks as many single-value rules as before is not offered
        const after = checkValue(f.value, result.all, x.col).length;
        const before = x.findings.filter(y => !['unique', 'spelling', 'standard-phrase'].includes(y.rule.kind)).length;
        if (before && after >= before) continue;
        const v = get().values[x.key];
        propose(x.paperId, { column_id: x.cellId, value: f.value, availability: 'present', evidence: v?.evidence || [],
          rationale: `Reworded for the cell rules${f.why ? `: ${f.why}` : ''}. Was “${x.value}”.`, origin: 'rules', model: cfg.model || cfg.provider });
        run.proposed++;
      }
      run.done++;
      if (fixRun === run) ctx.rerender();
    }
    run.status = 'done';
  } catch (err) {
    run.status = 'failed'; run.error = String(err?.message || err).slice(0, 120);
  }
  if (fixRun === run) { ctx.rerender(); ctx.refreshCounts?.(); }
}
