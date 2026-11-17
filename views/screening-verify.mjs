// Screening › Verify (2 Nov 2026): the verification lists a review's people check before submission (lib/person-checks.mjs), worked as
// queues in the Screening page. A list is picked in the title bar; the list pane holds its items (To check, Checked, All, Disagreements);
// the page shows the item as the record holds it (a screening decision with its reason and the instruction the model was given, or a value
// with its proof), and the foot records the person's own check: their decision (Include, Exclude with a reason, Uncertain) or their verdict
// on a value (Agree, Disagree with the correct value, Unsure). A blinded list hides the other person's check of an item until one's own is
// in; when both are in and differ, the foot reconciles them. The person is the one Settings › Reviewers › Deciding as names (initials or a
// name, matched to the lists' people). Risk of bias is assessed in Appraisal, in the person's own reviewer slot; this page shows how far
// each person is and opens the study there. Nothing here writes for a model: every write is the person's own, through the store.
import { store$get as get, store$update as update } from "../boot.mjs";
import { lib_html$esc as esc, lib_html$emptyState as emptyState, lib_html$abstractHtml as abstractHtml } from "../boot.mjs";
import { authorLine, journalDisplay } from '../lib/bib.mjs';
import { lib_ui_actions$uiBar as uiBar, lib_ui_actions$uiList as uiList, lib_ui_actions$uiRow as uiRow, lib_ui_actions$uiNotice as uiNotice } from "../boot.mjs";
import { lib_ui_components$disclosure as disclosure } from "../boot.mjs";
import { lib_menu$showMenu as showMenu } from "../boot.mjs";
import { lib_model_settings$settings as settings } from "../boot.mjs";
import { openStudy } from '../lib/study.mjs';
import { listsOf, listById, queueOf, recordOf, itemOf, isScreening, personNamed, peopleOf, recordCheck, reconcile, agreementOf, progressOf,
  checksOf, current, listsFromCsv, putLists, setListPeople, reasonCode, listChecks } from '../lib/person-checks.mjs';
import { runsFor, runLine } from '../lib/model-instructions.mjs';
import { drawLists, staleLists, staleText } from '../lib/verification-lists.mjs';

let on = false, listId = '', pick = null, show = 'open';
const SHOWS = [['open', 'To check'], ['done', 'Checked'], ['all', 'All'], ['disagreements', 'Disagreements']];
const drafts = new Map();   // an unsent note or value, by item, kept while moving between items

export const offered = s => listsOf(s).length > 0;
export const isOn = () => on;
export function setOn(v) { on = Boolean(v); pick = null; staleMemo = null; }
// whether the lists are out of date (a draw takes a few hundred ms): worked out once per state read and per visit, not after each check,
// which changes only the checks (a check is recorded into the same state; a reload from disk is a new state)
let staleMemo = null;
function staleNow(s) { if (staleMemo?.s !== s) staleMemo = { s, out: staleLists(s) }; return staleMemo.out; }
/** Opens a list (Screening › Verify from elsewhere, and the tests). */
export function openList(id, view = 'open') { on = true; staleMemo = null; listId = id; pick = null; show = SHOWS.some(([k]) => k === view) ? view : 'open'; }
/** The list another page opens: `id` when the project has it, else the first with checks left, else the first (Extraction's Left, Overview's person checks). */
export function listToOpen(s, id = '') {
  if (id && listById(s, id)) return id;
  const rows = listChecks(s)?.lists || [];
  return (rows.find(l => l.done < l.asked) || rows[0] || listsOf(s)[0])?.id || '';
}
const listOf = s => listById(s, listId) || listsOf(s)[0] || null;
/** The person checking: Settings › Reviewers › Deciding as, matched to a list's people ("ALR" → Ada Lin Rowe). */
export function viewer(s = get()) {
  const cfg = settings();
  return personNamed(s, cfg.reviewerName) || personNamed(s, cfg.reviewerInitials) || String(cfg.reviewerName || '').trim();
}
const paperOf = (s, id) => (s.papers || []).find(p => p.id === id) || null;
const cap = t => String(t || '').replace(/^./, c => c.toUpperCase());
const entryText = e => `${cap(e.decision || e.verdict)}${e.reason ? `, ${e.reason}` : ''}${e.value ? `: ${e.value}` : ''}`;
/** A value's column as its template names it, with the arm ("Funding", "Patients randomized, arm 2"). */
export function fieldName(s, key) {
  const f = key.slice(key.indexOf(':') + 1), [tpl, col] = f.replace(/@.*$/, '').split('.'), arm = (/@arm(\d+)/.exec(f) || [])[1];
  const t = (s.templates || []).find(x => x.id === tpl), cols = [...(t?.columns || t?.fields || []), ...(t?.armColumns || [])];
  const c = cols.find(x => x.id === `${tpl}.${col}` || x.id === col);
  return `${c?.name || c?.label || col || f}${arm ? `, arm ${arm}` : ''}`;
}
/** What the record holds for an item, in words. */
export function recordText(s, id) {
  const it = itemOf(id), r = recordOf(s, id);
  if (!r) return 'Not in the record';
  if (isScreening(it.kind)) return r.decision ? `${cap(r.decision)}${r.reason ? `, ${r.reason}` : ''}` : 'Not decided';
  if (it.kind === 'value') return `${r.value || 'empty'}${r.unit ? ` ${r.unit}` : ''}`;
  if (it.kind === 'rob') { const a = r.answers || {}, t = a.rob2 || a[Object.keys(a)[0]] || {}; return `Overall ${t.overall || 'not judged'}`; }
  return '';
}

const robDone = (s, l, x, me) => (progressOf(s, { ...l, items: [x], people: [me] })[me]?.done || 0) > 0;
/** The queue as the list shows it: the chosen view of the list, then Find's words. */
function rows(s, query = '') {
  const l = listOf(s); if (!l) return [];
  const me = viewer(s), ag = show === 'disagreements' ? new Set(agreementOf(s, l).disagreements.map(d => d.item)) : null;
  let q = queueOf(s, l, me);
  if (show === 'open') q = q.filter(x => (l.kind === 'rob' ? !robDone(s, l, x, me) : !x.mine || x.stale));
  else if (show === 'done') q = q.filter(x => (l.kind === 'rob' ? robDone(s, l, x, me) : x.mine && !x.stale));
  else if (ag) q = q.filter(x => ag.has(x.id));
  const words = String(query || '').trim().toLowerCase();
  if (words) q = q.filter(x => { const p = paperOf(s, x.record); return `${p?.label || ''} ${p?.title || ''} ${x.key}`.toLowerCase().includes(words); });
  return q;
}
let lastQuery = '';
export function selection(s = get()) { const r = rows(s, lastQuery); return r.some(x => x.id === pick) ? pick : r[0]?.id || null; }
export const select = id => { pick = id; };
/** The record of the item on screen, or null. */
export const currentRecord = (s = get()) => { const id = selection(s); return id ? itemOf(id)?.record || null : null; };

// ---- the list pane -------------------------------------------------------------------------------------------------------------------
export const listTitle = () => SHOWS.find(([k]) => k === show)?.[1] || 'To check';
export function titleMenu(b, refresh) {
  showMenu(b, SHOWS.map(([k, l]) => ({ label: l, checked: k === show, checkType: 'radio', run: () => { show = k; pick = null; refresh(); } })), { align: 'start' });
}
export const listEmpty = () => (show === 'open' ? 'Nothing left to check' : show === 'done' ? 'Nothing checked yet' : show === 'disagreements' ? 'No disagreements' : 'No items');
export function items(s, query = '') {
  lastQuery = query;
  return rows(s, query).map(x => {
    const p = paperOf(s, x.record);
    const what = x.kind === 'value' ? `${fieldName(s, x.key)}: ${recordText(s, x.id)}` : recordText(s, x.id);
    const mark = x.reconciled ? 'Reconciled' : x.mine ? (x.stale ? 'Changed since' : cap(x.mine.decision || x.mine.verdict)) : x.hidden ? 'Checked by the other' : Object.keys(x.others).length ? 'Checked by another' : '';
    const tone = x.mine && !x.stale ? (x.mine.decision || (x.mine.verdict === 'agree' ? 'include' : x.mine.verdict === 'disagree' ? 'exclude' : 'uncertain')) : '';
    return { id: x.id, title: p?.label || p?.title || x.record, sub: [what, x.stratum].filter(Boolean).join('; '), meta: '', mark, markTone: tone };
  });
}

// ---- the title bar ---------------------------------------------------------------------------------------------------------------------
let openCur = null;
/** The page's head in Verify: Verify as the title (its menu the stages), the list as a picker, Open; the lists' commands in More. */
export function pageHead(rerender, { stageMenu, go }) {
  const s = get(), l = listOf(s), me = viewer(s);
  const repaint = msg => rerender(msg);
  return {
    title: 'Verify', titleMenu: a => stageMenu(a),
    actions: [
      { id: 'ver-list', label: l ? `${l.id} ${l.name}` : 'No list', icon: 'list', menu: true, run: b => showMenu(b, listsOf(s).map(x => { const p = progressOf(s, x)[me];
        return { label: `${x.id} ${x.name}`, meta: p ? `${p.done.toLocaleString('en')} of ${p.of.toLocaleString('en')}` : x.items.length.toLocaleString('en'), checked: x.id === l?.id, checkType: 'radio', run: () => { listId = x.id; pick = null; repaint(); } }; }), { align: 'start', minWidth: 300 }) },
      ...(me ? [] : [{ id: 'ver-who', label: 'Set who you are', icon: 'user', run: () => go('settings') }]),
      { id: 'ver-open', label: 'Open', icon: 'file-pdf', kbd: 'O', attrs: { 'aria-label': 'Open the record' }, run: () => openCur?.() }],
    overflow: [
      { id: 'ver-load', label: 'Import lists…', run: () => loadCsv(repaint) },
      ...(s.verification?.draw ? [{ id: 'ver-redraw', label: 'Redraw the lists', run: () => repaint(redraw()) }] : []),
      ...(l ? [{ id: 'ver-people', label: `People of ${l.id}…`, run: b => peopleMenu(b, l, repaint) }] : [])] };
}
function loadCsv(done) {
  const input = Object.assign(document.createElement('input'), { type: 'file', accept: '.csv,text/csv' });
  input.onchange = async () => {
    const f = input.files?.[0]; if (!f) return;
    const text = await f.text(), { lists, problems } = listsFromCsv(get(), text, { file: f.name });
    if (!lists.length) { done(problems[0] || 'No lists in the file'); return; }
    update(st => { putLists(st, lists); return st; });
    listId = lists[0].id; pick = null;
    done(`${lists.length} lists loaded${problems.length ? `; ${problems.length} rows left out` : ''}`);
  };
  input.click();
}
/** The lists drawn again with the options of their last draw (lib/verification-lists.mjs); the checks made stay, kept by item. */
export function redraw() {
  const d = get().verification?.draw;
  if (!d) return 'These lists were not drawn by Lykos: import their sheet again';
  const was = staleLists(get());
  staleMemo = null;
  update(st => { const { lists, draw } = drawLists(st, { ...d, at: new Date().toISOString() }); putLists(st, lists, { draw }); return st; });
  return was.length ? `Lists redrawn: ${staleText(was)}` : 'The lists were already current';
}
function peopleMenu(b, l, done) {
  const all = peopleOf(get());
  showMenu(b, [{ heading: `Who checks ${l.id}` }, ...all.map(p => ({ label: p, checked: l.people.includes(p), checkType: 'check',
    run: () => { update(st => { setListPeople(st, l.id, { people: l.people.includes(p) ? l.people.filter(x => x !== p) : [...l.people, p] }); return st; }); done(); } })),
    '-', { label: 'Blinded', checked: Boolean(l.blinded), checkType: 'check', run: () => { update(st => { setListPeople(st, l.id, { blinded: !l.blinded }); return st; }); done(); } }], { align: 'end', minWidth: 240 });
}

// ---- the page ------------------------------------------------------------------------------------------------------------------------
/** The reasons an exclusion can give at a stage: those the record already uses, one per code. */
export function reasonsAt(s, kind) {
  const key = kind === 'ft' ? 'fulltext' : 'screening', seen = new Map();
  for (const d of Object.values(s[key] || {})) if (d?.decision === 'exclude' && d.reason && !seen.has(reasonCode(d.reason))) seen.set(reasonCode(d.reason), d.reason);
  return [...seen.values()].sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
}
/** A value's proof as the value checker settled it (quote and page, derivation or decision), with its note and source. */
export function proofOf(s, x) {
  const v = s.values?.[x.key], field = x.key.slice(x.record.length + 1).replace(/^[^.]+\./, '');
  const settled = s.valueChecks?.studies?.[x.record]?.fields?.[field]?.settled || null;
  const lines = [];
  if (settled) lines.push(['Proof', `${cap(settled.decision)}${settled.page ? `, p. ${settled.page}` : ''}${settled.why ? `: ${settled.why}` : ''}`]);
  if (settled?.quote) lines.push(['Quote', `“${settled.quote}”${settled.found === false ? ' (not found in the text)' : ''}`]);
  if (settled?.how) lines.push(['Derivation', settled.how]);
  if (v?.note) lines.push(['Note', v.note]);
  if (v?.source) lines.push(['Source', v.source]);
  return { lines, page: Number(settled?.page) || null };
}
const props = lines => `<dl class="props">${lines.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>`;
// the record's facts on the page, laid out as Screening lays out a decision's (label, value)
const facts = lines => `<div class="scr-record-decision"><div class="scr-decision-facts">${lines.map(([k, v]) => `<span class="meta">${esc(k)}</span><span>${esc(v)}</span>`).join('')}</div></div>`;

export function render(el, ctx) {
  const s = get(), l = listOf(s), me = viewer(s);
  openCur = null;
  if (!l) { el.innerHTML = emptyState({ icon: 'check', title: 'No verification lists', detail: 'Load a CSV of lists from More in the title bar' }); return; }
  if (!me) {
    el.innerHTML = `<div class="panel scr-rec"><div class="panel-body">${emptyState({ icon: 'user', title: 'Who is checking?', detail: `Set Deciding as in Settings › Reviewers to your initials (${peopleOf(s).join(', ') || 'a person named in the lists'})`, actions: [{ id: 'ver-settings', label: 'Settings', icon: 'settings', primary: true }] })}</div></div>`;
    el.querySelector('#ver-settings').onclick = () => ctx.go('settings');
    return;
  }
  const id = selection(s), x = id ? queueOf(s, { ...l, items: l.items.filter(i => i.id === id) }, me)[0] : null;
  if (!x) { el.innerHTML = `<div class="panel scr-rec"><div class="panel-body">${emptyState({ icon: 'check', title: show === 'open' ? `${l.id}: nothing left to check` : listEmpty() })}</div></div>`; return; }
  const p = paperOf(s, x.record), kind = x.kind;
  const named = l.people.includes(me), all = checksOf(s, x.id);
  const both = Object.keys(all).length >= 2 && Object.values(all).every(e => current(s, x.id, e));
  const differ = both && x.mine && Object.values(x.others).some(e => (e.decision || e.verdict) !== (x.mine.decision || x.mine.verdict) || reasonCode(e.reason) !== reasonCode(x.mine.reason));
  const head = `<h3 class="scr-title">${esc(p?.title || x.record)}</h3><div class="scr-meta">${esc([p?.label, authorLine(p?.authors), journalDisplay(p?.journal), p?.year].filter(Boolean).join('; '))}</div>`;
  let body = '', page = null;
  if (isScreening(kind)) {
    const runs = runsFor(s, kind, x.record);
    body = `${head}${facts([[kind === 'ft' ? 'Full-text decision' : 'Title and abstract decision', recordText(s, x.id)], ...runs.map(r => ['Made with', runLine(r)]), ...(x.stratum ? [['Stratum', x.stratum]] : [])])}
      ${p?.abstract ? `<div class="scr-abs">${abstractHtml(p.abstract)}</div>` : '<div class="scr-abs-none"><span>No abstract saved</span></div>'}`;
  } else if (kind === 'value') {
    const proof = proofOf(s, x); page = proof.page;
    body = `${head}${facts([['Field', fieldName(s, x.key)], ['Value', recordText(s, x.id)], ...(proof.lines.length ? proof.lines : [['Proof', 'None recorded']])])}`;
  } else {
    const pr = progressOf(s, { ...l, items: [{ id: x.id }] });
    body = `${head}${facts([['Recorded', recordText(s, x.id)], ...Object.entries(pr).map(([who, q]) => [who, q.unassigned ? 'Not named as reviewer A or B in Appraisal' : q.done ? 'Assessed' : 'Not assessed yet'])])}`;
  }
  const stale = staleNow(s);
  const notice = stale.length ? `<div class="scr-amend">${uiNotice({ id: 'ver-stale', label: 'Lists out of date', text: `Inclusion or values changed since the lists were drawn (${staleText(stale)})`, actions: [{ id: 'ver-stale-redraw', label: 'Redraw' }] })}</div>`
    : named ? '' : `<div class="scr-amend">${uiNotice({ id: 'ver-not-yours', label: 'Not on this list', text: `${l.id} is for ${l.people.join(' and ') || 'no one yet'}; a check here is kept as ${me}'s` })}</div>`;
  const foot = kind === 'rob' ? uiBar({ kind: 'foot', label: 'Risk of bias', id: 'ver-foot', actions: [{ id: 'ver-appraise', label: 'Assess in Appraisal', icon: 'appraisal', role: 'primary' }] })
    : differ ? reconcileFoot(kind, x) : checkFoot(kind, x);
  el.innerHTML = `<div class="panel scr-rec">${notice}<div class="panel-body scr-body"><div class="scr-record-content">${body}</div></div><div class="scr-footer">${foot}</div></div>`;
  openCur = () => openStudy(ctx, x.record, page ? { page } : null);
  el.querySelector('#ver-stale-redraw')?.addEventListener('click', () => ctx.rerender(redraw()));
  el.querySelector('#ver-appraise')?.addEventListener('click', () => (ctx.openStudyResults ? ctx.openStudyResults('appraisal', x.record) : ctx.go('appraisal')));

  const next = () => { const r = rows(get(), lastQuery), i = r.findIndex(q => q.id === x.id); pick = (r[i + 1] || r[i - 1] || null)?.id || null; };
  const note = () => (el.querySelector('#ver-note')?.value || '').trim(), val = () => (el.querySelector('#ver-value')?.value || '').trim();
  let settled = false;
  const save = (fn, msg) => {
    if (settled) return; settled = true;
    try { update(st => { fn(st); return st; }); } catch (e) { settled = false; ctx.say?.(e.message); return; }
    drafts.delete(x.id); if (show === 'open') next(); ctx.rerender(msg); ctx.refreshCounts?.();
  };
  const check = args => save(st => recordCheck(st, { item: x.id, person: me, list: l.id, note: note(), ...args }));
  const reasons = isScreening(kind) ? reasonsAt(s, kind) : [];
  const askReason = (b, then) => { const at = b.getBoundingClientRect();
    showMenu({ x: at.left, y: at.top - 4 }, [{ heading: 'Reason for exclusion' }, ...reasons.map(r => ({ label: r, run: () => then(r) }))], { minWidth: Math.max(240, at.width) }); };
  const on1 = (sel, fn) => { const b = el.querySelector(sel); if (b) b.onclick = e => fn(e?.currentTarget || b); };
  on1('#ver-include', () => check({ decision: 'include' }));
  on1('#ver-uncertain', () => check({ decision: 'uncertain' }));
  on1('#ver-exclude', b => askReason(b, r => check({ decision: 'exclude', reason: r })));
  on1('#ver-agree', () => check({ verdict: 'agree' }));
  on1('#ver-unsure', () => check({ verdict: 'unsure' }));
  on1('#ver-disagree', () => (val() || note() ? check({ verdict: 'disagree', value: val() }) : (el.querySelector('#ver-value') || el.querySelector('#ver-note'))?.focus()));
  on1('#ver-skip', () => { next(); ctx.rerender(); });
  const keep = () => drafts.set(x.id, { note: el.querySelector('#ver-note')?.value || '', value: el.querySelector('#ver-value')?.value || '' });
  el.querySelectorAll('#ver-note, #ver-value').forEach(i => i.addEventListener('input', keep));
  // reconciliation: the pair's final word, with its reason
  const why = () => (el.querySelector('#ver-why')?.value || '').trim();
  const rec = args => (why() ? save(st => reconcile(st, { item: x.id, by: me, note: why(), ...args }), 'Reconciled') : el.querySelector('#ver-why')?.focus());
  on1('#ver-res-include', () => rec({ decision: 'include' }));
  on1('#ver-res-uncertain', () => rec({ decision: 'uncertain' }));
  on1('#ver-res-exclude', b => (why() ? askReason(b, r => rec({ decision: 'exclude', reason: r })) : el.querySelector('#ver-why')?.focus()));
  on1('#ver-res-agree', () => rec({ verdict: 'agree' }));
  on1('#ver-res-disagree', () => rec({ verdict: 'disagree', value: val() }));
  ctx.onKey?.(e => {
    if (e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
    if (['SELECT', 'INPUT', 'TEXTAREA'].includes(e.target.tagName) || e.target.isContentEditable || e.target.closest?.('.menu')) return;
    const k = e.key.toLowerCase(), press = sel => el.querySelector(sel)?.click();
    if (k === 'o') openCur?.();
    else if (k === 's') press('#ver-skip');
    else if (k === 'n') el.querySelector('#ver-note, #ver-why')?.focus();
    else if (differ) return;
    else if (isScreening(kind) && k === 'i') press('#ver-include');
    else if (isScreening(kind) && k === 'e') press('#ver-exclude');
    else if (isScreening(kind) && k === 'u') press('#ver-uncertain');
    else if (kind === 'value' && k === 'a') press('#ver-agree');
    else if (kind === 'value' && k === 'd') press('#ver-disagree');
    else return;
    e.preventDefault();
  });
}
/** The person's check: their decision on a screening item, their verdict on a value; the one they gave is pressed. */
export function checkFoot(kind, x) {
  const d = drafts.get(x.id) || {}, mine = x.mine && !x.stale ? x.mine : null;
  const noteField = { type: 'field', id: 'ver-note', label: 'Note', placeholder: 'Note', width: 'flex', maxlength: 2000, value: d.note ?? mine?.note ?? '' };
  if (isScreening(kind)) return uiBar({ kind: 'foot', label: 'Your check', id: 'ver-foot', equal: true, filters: [noteField],
    actions: [...[['include', 'Include', 'I', 'check'], ['exclude', 'Exclude', 'E', 'close'], ['uncertain', 'Uncertain', 'U', 'minus']].map(([v, label, kbd, icon]) => ({ id: `ver-${v}`, label, kbd, icon, pressed: mine?.decision === v })),
      { id: 'ver-skip', label: 'Skip', kbd: 'S', role: 'quiet' }] });
  return uiBar({ kind: 'foot', label: 'Your check', id: 'ver-foot', equal: true,
    filters: [{ type: 'field', id: 'ver-value', label: 'Correct value', placeholder: 'Correct value', width: 'md', maxlength: 200, value: d.value ?? mine?.value ?? '' }, noteField],
    actions: [...[['agree', 'Agree', 'A', 'check'], ['disagree', 'Disagree', 'D', 'close'], ['unsure', 'Unsure', '', 'minus']].map(([v, label, kbd, icon]) => ({ id: `ver-${v}`, label, ...(kbd ? { kbd } : {}), icon, pressed: mine?.verdict === v })),
      { id: 'ver-skip', label: 'Skip', kbd: 'S', role: 'quiet' }] });
}
/** Both checked and differ: the final word and its reason. */
export function reconcileFoot(kind, x) {
  const why = { type: 'field', id: 'ver-why', label: 'Reason for the final decision', placeholder: 'Reason for the final decision', width: 'flex', maxlength: 2000, value: x.reconciled?.note || '' };
  const was = x.reconciled ? (x.reconciled.decision || x.reconciled.verdict) : '';
  if (isScreening(kind)) return uiBar({ kind: 'foot', label: 'Reconcile', id: 'ver-foot', filters: [why],
    actions: [...[['include', 'Include'], ['exclude', 'Exclude'], ['uncertain', 'Uncertain']].map(([v, label]) => ({ id: `ver-res-${v}`, label, pressed: was === v })), { id: 'ver-skip', label: 'Skip', role: 'quiet' }] });
  return uiBar({ kind: 'foot', label: 'Reconcile', id: 'ver-foot', filters: [{ type: 'field', id: 'ver-value', label: 'Final value', placeholder: 'Final value', width: 'md', maxlength: 200, value: x.reconciled?.value || '' }, why],
    actions: [{ id: 'ver-res-agree', label: 'Record is right', pressed: was === 'agree' }, { id: 'ver-res-disagree', label: 'Record is wrong', pressed: was === 'disagree' }, { id: 'ver-skip', label: 'Skip', role: 'quiet' }] });
}

// ---- the details pane ------------------------------------------------------------------------------------------------------------------
const num = x => Number(x || 0).toLocaleString('en');
const pctText = x => (x == null ? '—' : `${x.toFixed(1)}%`);
const kText = k => (k == null ? 'κ undefined' : `κ ${k.toFixed(2)}`);
const briefHtml = runs => runs.map(r => disclosure({ title: r.instruction.name, meta: runLine(r).split('; ').slice(1).join('; '), body: `<pre class="ver-brief">${esc(r.instruction.text)}</pre>` })).join('');
export function inspect() {
  const s = get(), l = listOf(s), me = viewer(s), secs = [];
  if (!l) return secs;
  const id = selection(s), x = id ? queueOf(s, { ...l, items: l.items.filter(i => i.id === id) }, me)[0] : null;
  if (x && x.kind !== 'rob') {
    const rowsHtml = [...(x.mine ? [[me, x.mine]] : []), ...Object.entries(x.others)].map(([who, e]) => uiRow({ main: { html: esc(`${who}: ${entryText(e)}`), detail: [String(e.at || '').slice(0, 10), current(s, x.id, e) ? '' : 'the record changed since', e.note || ''].filter(Boolean).map(esc), wrap: true } }));
    if (x.reconciled) rowsHtml.push(uiRow({ main: { html: esc(`Final: ${entryText(x.reconciled)}`), detail: [x.reconciled.by, String(x.reconciled.at || '').slice(0, 10), x.reconciled.note].filter(Boolean).map(esc), wrap: true } }));
    secs.push({ title: 'Checks', meta: x.hidden ? `${x.hidden} hidden` : String(rowsHtml.length || ''),
      html: uiList({ label: 'Checks of this item', rows: rowsHtml, empty: emptyState({ title: x.hidden ? 'The other check shows once yours is in' : 'Not checked yet', size: 'inline' }) }) });
    const runs = runsFor(s, isScreening(x.kind) ? x.kind : 'extraction', x.record);
    if (runs.length) secs.push({ title: 'Model instructions', meta: String(runs.length), html: briefHtml(runs) });
  }
  const pr = progressOf(s, l), ag = agreementOf(s, l);
  secs.push({ title: `${l.id} progress`, meta: `${num(l.items.length)} items`,
    html: props([...Object.entries(pr).map(([who, q]) => [who, `${num(q.done)} of ${num(q.of)}${q.stale ? `, ${num(q.stale)} changed since` : ''}`]), ...(Object.keys(pr).length ? [] : [['People', 'No one named yet']]),
      ...(l.sampleOf ? [['Sample of', `${l.sampleOf}${l.rate ? `, ${Math.round(l.rate * 100)}%` : ''}`]] : []), ['Blinded', l.blinded ? 'Yes' : 'No']]) });
  // in a blinded list the agreement shows to a person once they have checked (it would say how the other decided)
  const mayShow = !l.blinded || (pr[me]?.done || 0) > 0 || !l.people.includes(me);
  secs.push({ title: 'Agreement', meta: ag.n ? `n ${num(ag.n)}` : '',
    html: !ag.n ? emptyState({ title: 'No item checked by both yet', size: 'inline' }) : !mayShow ? emptyState({ title: 'Shown once you have checked', size: 'inline' })
      : props([[ag.people.join(' and '), `${num(ag.agree)} of ${num(ag.n)} ${ag.unit || 'items'} (${pctText(ag.percent)}), ${kText(ag.kappa)}`],
        ...(ag.kappaDecision !== undefined ? [['Decision alone', `${pctText(ag.percentDecision)}, ${kText(ag.kappaDecision)}`]] : []),
        ['Disagreements', `${num(ag.disagreements.length)}, ${num(ag.open)} open`],
        ...Object.entries(ag.vsRecord).map(([who, v]) => [`${who} with the ${ag.model ? 'model' : 'record'}`, `${num(v.agree)} of ${num(v.n)}`])]) });
  return secs;
}

/** The record's decision detail in Screening: what the model was told when it made the decision on screen (lib/model-instructions.mjs). */
export function instructionsSection(s, stage, paperId) {
  const runs = runsFor(s, stage, paperId);
  return runs.length ? { title: 'Model instructions', meta: String(runs.length), html: briefHtml(runs) } : null;
}
