// Literature › Strategy › Search sets (6 Nov 2026; plan §B, "Search sets"): a review's search made of shared blocks and one block per stratum
// (indication, population, procedure), each stratum run and counted on its own (lib/search-sets.mjs). One row per stratum: its
// records, the day it was searched, its MeSH headings as NLM has them (lib/mesh-check.mjs) and its records the registered search
// lacks. The set's commands are in the head; a stratum's in its row's More.
import { store$get as get, store$update as update } from "../boot.mjs";
import { lib_html$esc as esc, lib_html$emptyState as emptyState } from "../boot.mjs";
import { lib_menu$showMenu as showMenu } from "../boot.mjs";
import { copyText } from '../lib/clipboard.mjs';
import { lib_jobs$run as runJob } from "../boot.mjs";
import { lib_ui_actions$uiBar as uiBar, lib_ui_actions$uiList as uiList, lib_ui_actions$uiRow as uiRow, lib_ui_actions$uiRowEnd as uiRowEnd } from "../boot.mjs";
import { lib_ui_components$tableRegion as tableRegion, lib_ui_components$metadataLine as metadataLine, lib_ui_components$formField as formField } from "../boot.mjs";
import { lib_dialog$confirmAsk as confirmAsk, lib_dialog$formDialog as formDialog } from "../boot.mjs";
import { removeWithUndo } from '../lib/undo-removal.mjs';
import { lib_model_settings$settings as settings } from "../boot.mjs";
import { lib_dates$plural as plural, lib_dates$num as num, lib_dates$day as day } from "../boot.mjs";
import { parseStrategy } from '../lib/query-syntax.mjs';
import { strategyOutline, outlineHtml as outlineList, countOf } from '../lib/query-outline.mjs';
import { checkQuery } from '../lib/query-check.mjs';
import { lookupMesh, nlmEutils, storeMesh, meshCache, meshState, meshPhrase } from '../lib/mesh-check.mjs';
import { searchSets, setById, newSet, addStratum, setFromStrategyFile, stratumQuery, baselineQuery, baselineTemplate, templateProblems, recordRun, setRows,
  setHeadings, coverage, overlap, gapsToImport, gapSource, setDocument, setToFile, blockText, latestRun, runIsCurrent } from '../lib/search-sets.mjs';
import { warningsOf } from '../lib/search-runs.mjs';
import { vocabularies } from '../lib/vocabularies.mjs';
import { pick } from './library.mjs';

let current = null, open = null, busy = false;
const clip = (t, n) => { const s = String(t || '').replace(/\s+/g, ' ').trim(); return s.length > n ? `${s.slice(0, n - 1)}…` : s; };
const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

const chosen = s => { const all = searchSets(s); return all.find(x => x.id === current) || all[0] || null; };
const save = fn => update(s => { const set = setById(s, current); if (set) fn(set, s); return s; });

// ---- rows -------------------------------------------------------------------------------------------------------------------------

const meshText = m => (m.terms.length ? `MeSH: ${m.phrase}${m.at && !m.counts.unchecked ? `, ${day(m.at)}` : ''}` : '');
const gapText = r => (r.gaps == null ? '' : r.gaps ? `${num(r.gaps)} not in the registered search${r.sameDay ? '' : ', searched on another day'}` : 'All in the registered search');
function stratumRow(r) {
  const st = r.stratum, id = st.id;
  return uiRow({ cls: 'sets-row', attrs: { 'data-stratum': id },
    main: { html: `<button type="button" class="tk-text" data-open="${esc(id)}" aria-expanded="${open === id}">${esc(st.name)}</button>`,
      detail: [st.covers?.length ? esc(st.covers.join('; ')) : '', st.term?.label ? esc(st.term.label) : '', esc(meshText(r.mesh)), esc(gapText(r)),
        r.total != null && !r.current ? 'Changed since its run' : '', r.error ? esc(r.error) : ''] },
    cells: [{ col: 'records', kind: 'text', ch: 14, html: r.total == null ? 'Not run' : `${num(r.total)} records` }, { col: 'date', kind: 'text', ch: 12, html: esc(day(r.at)) }],
    end: uiRowEnd({ more: { label: `More for ${st.name}`, attrs: { 'data-st-more': id } } }) });
}
/**
 * A stratum's search as a numbered strategy the outline reads (lib/query-outline.mjs): the strategy's lines, a block of the set's own
 * text as a line after them, the stratum's block, and the template with each block key and {stratum} written as its line. Answers
 * { text, own, search }: the strategy file's JSON and the numbers of the stratum's line and the search's.
 */
export function stratumStrategy(set, st) {
  const lines = (set.strategy?.lines || []).map(l => ({ n: Number(l.n), q: String(l.text ?? ''), block: String(l.label || '') }));
  let next = Math.max(0, ...lines.map(l => l.n)) + 1;
  const lineOf = {};
  for (const b of set.blocks || []) {
    if (b.line != null) lineOf[b.key] = Number(b.line);
    else { lineOf[b.key] = next; lines.push({ n: next++, q: String(b.text ?? ''), block: `${b.key} ${b.label || ''}`.trim() }); }
  }
  const own = next++, search = next;
  lines.push({ n: own, q: String(st.block || ''), block: st.name });
  // a key is a word of the template outside quotes and before no tag; AND, OR and NOT are not keys
  const template = String(set.template || '').replace(/"[^"]*"|\{stratum\}|\b[A-Za-z][A-Za-z0-9]*\b(?!\[)/gi, m => (m.toLowerCase() === '{stratum}' ? `#${own}` : lineOf[m] != null ? `#${lineOf[m]}` : m));
  lines.push({ n: search, q: template, block: 'Search' });
  return { text: JSON.stringify({ database: set.database || 'PubMed', lines }), own, search };
}
function stratumDetail(set, st, cache) {
  const q = stratumQuery(set, st), problems = [...q.problems.filter(p => !p.id), ...checkQuery(q.query, { source: 'PubMed', mesh: cache, explosions: true })];
  const said = warningsOf(latestRun(st)) || [];   // what PubMed said beside its count at the newest run, as the search log shows it
  // the search's count is the stratum's newest run while its query stands; a block's, a count of its line kept in the project
  const run = latestRun(st), s = get(), plan = stratumStrategy(set, st);
  const model = strategyOutline(plan.text, { mesh: cache, count: l => (l.n === plan.search ? (run && runIsCurrent(set, st) && run.total != null ? { total: run.total, at: run.at } : null) : countOf(s, 'pubmed', l.query)) });
  return `<div class="log-detail sets-detail" role="listitem" data-detail="${esc(st.id)}">
    ${outlineList(model, { id: `sets-outline-${st.id}`, label: `Structure of ${st.name}`, only: [plan.search, plan.own], numbers: false, summary: false })}
    ${said.length ? `<p class="meta">PubMed said</p><ul class="qc-list" aria-label="PubMed warnings">${said.map(t => `<li class="qc-item qc-note"><span>${esc(t)}</span></li>`).join('')}</ul>` : ''}
    ${problems.length ? `<ul class="qc-list" aria-label="Strategy check">${problems.map(p => `<li class="qc-item qc-${p.level}"><span>${esc(p.text)}</span></li>`).join('')}</ul>` : ''}</div>`;
}
// a shared block's row: its key and label, where it comes from, its MeSH headings as checked, and its text cut short
const blockRows = (set, cache) => uiList({ id: 'sets-blocks', label: 'Shared blocks', cls: 'sets-blocks', rows: (set.blocks || []).map(b => {
  const text = blockText(set, b.key) || '', mesh = meshState(text, cache, { source: set.database });
  return uiRow({ attrs: { 'data-block': b.key },
    main: { html: `<span class="sets-block-name"><span class="sets-key">${esc(b.key)}</span> ${esc(b.label || '')}</span>`,
      detail: [b.line != null ? `Line ${b.line} of ${esc(set.strategy?.label || 'the strategy')}` : 'Own text', esc(meshText({ ...mesh, phrase: meshPhrase(mesh) })), esc(clip(text, 140))] } });
}), empty: emptyState({ title: 'No shared blocks', size: 'inline' }) });

// the overlap between strata: each stratum's records in each other's, the diagonal its own
function overlapTable(set) {
  const ov = overlap(set);
  if (ov.union == null || ov.names.length < 2) return '';
  const head = `<tr><th scope="col">Stratum</th>${ov.names.map(n => `<th scope="col">${esc(n)}</th>`).join('')}</tr>`;
  const rows = ov.cells.map((row, i) => `<tr><th scope="row">${esc(ov.names[i])}</th>${row.map((n, j) => `<td${i === j ? ' class="sets-own"' : ''}>${n == null ? '' : num(n)}</td>`).join('')}</tr>`).join('');
  return tableRegion({ label: 'Records shared by strata', sticky: true, html: `<table class="sets-overlap"><thead>${head}</thead><tbody>${rows}</tbody></table>` });
}

// ---- the page ---------------------------------------------------------------------------------------------------------------------

/** The Strategy tool's first panel (`el`, a .panel): the chosen search set, or a line saying there is none with its two ways to make one. */
export function renderSets(el, ctx) {
  const s = get(), all = searchSets(s), set = chosen(s), say = t => ctx.say?.(t);
  if (set) current = set.id;
  if (!set) {
    el.innerHTML = `${uiBar({ kind: 'head', label: 'Search sets', id: 'sets-head', lead: { title: 'Search sets', level: 'h2' },
      actions: [{ id: 'sets-import', label: 'Import strategy file', icon: 'import', role: 'quiet' }, { id: 'sets-new', label: 'New search set', icon: 'plus' }] })}
      <div class="panel-body lit-body">${emptyState({ title: 'No search sets', size: 'inline', help: true,
        detail: 'A search set runs one block per indication, population or procedure inside shared blocks of a strategy, each counted on its own.' })}</div>`;
    wireMaking(el, ctx);
    return;
  }
  const cache = meshCache(s), rows = setRows(set, cache), cov = coverage(set), gaps = gapsToImport(set, s.papers);
  const base = baselineQuery(set), br = cov.baseline?.run, tp = templateProblems(set);
  el.innerHTML = `
      ${uiBar({ kind: 'head', label: 'Search set', id: 'sets-head', lead: { title: set.name, level: 'h2', id: 'sets-pick', ...(all.length > 1 ? { menu: true } : {}) },
        message: { id: 'sets-kind', text: set.registered ? 'Registered search set' : 'Supplementary search set' },
        actions: [{ id: 'sets-mesh', label: 'Check MeSH', icon: 'check-query', disabled: busy }, { id: 'sets-run', label: 'Run all', icon: 'run', role: 'primary', disabled: busy || !rows.length || tp.some(p => p.level === 'error') }],
        overflow: [{ id: 'sets-add', label: 'Add stratum…' }, { id: 'sets-edit', label: 'Edit search set…' }, '-',
          { id: 'sets-gaps', label: gaps.length ? `Import ${plural(gaps.length, 'gap record')}` : 'Import gap records', disabled: busy || !gaps.length },
          { id: 'sets-export', label: 'Export strategy (Word)' }, { id: 'sets-file', label: 'Save strategy file' }, '-',
          { id: 'sets-new', label: 'New search set…' }, { id: 'sets-import', label: 'Import strategy file…' }, { id: 'sets-remove', label: 'Remove search set', danger: true }] })}
      <div class="panel-body lit-body sets-body" id="sets-panel">
        ${blockRows(set, cache)}
        <p class="meta sets-template">Each stratum: ${esc(set.template)}${tp.length ? ` (${esc(tp.map(p => p.text).join(' '))})` : ''}</p>
        ${base ? `<p class="meta sets-template">Registered search: ${esc(baselineTemplate(set))}${br ? `, ${num(br.total)} records on ${esc(day(br.at))}` : ', not run'}</p>` : ''}
        ${uiList({ id: 'sets-strata', label: 'Strata', cols: ['records', 'date'], cls: 'sets-strata', rows: rows.map(stratumRow),
          empty: emptyState({ title: 'No strata', size: 'inline', actions: [{ id: 'sets-add-first', label: 'Add stratum', icon: 'plus', primary: true }] }) })}
        ${cov.baseline || overlap(set).union != null ? `<div class="sets-coverage">${metadataLine([overlap(set).union != null ? `${num(overlap(set).union)} records in all strata together` : '',
          cov.baseline ? `${num(cov.gapIds.length)} not in the registered search` : 'Registered search not run', gaps.length ? `${num(gaps.length)} not in the library` : ''])}${overlapTable(set)}</div>` : ''}
      </div>`;

  // a stratum's detail opens under its row: its block, its search written out, and what the check finds in it
  const list = el.querySelector('#sets-strata');
  const drawOpen = () => {
    list.querySelectorAll('.sets-detail').forEach(d => d.remove());
    list.querySelectorAll('[data-open]').forEach(b => b.setAttribute('aria-expanded', String(b.dataset.open === open)));
    const row = open && list.querySelector(`[data-stratum="${CSS.escape(open)}"]`), st = set.strata.find(x => x.id === open);
    if (row && st) row.insertAdjacentHTML('afterend', stratumDetail(set, st, cache));
  };
  list.querySelectorAll('[data-open]').forEach(b => b.onclick = () => { open = open === b.dataset.open ? null : b.dataset.open; drawOpen(); });
  drawOpen();
  list.querySelectorAll('[data-st-more]').forEach(b => b.onclick = () => {
    const st = set.strata.find(x => x.id === b.dataset.stMore);
    if (st) showMenu(b, [{ label: 'Run', disabled: busy, run: () => runStrata(ctx, [st.id], false) }, { label: 'Edit…', run: () => stratumDialog(ctx, st) },
      { label: 'Copy search', run: () => copyText(stratumQuery(set, st).query).then(() => say('Search copied')) },
      { label: 'Remove', danger: true, run: () => removeStratum(ctx, st) }], { align: 'end' });
  });
  const on = (id, fn) => { const b = el.querySelector(`#${id}`); if (b) b.onclick = fn; };
  on('sets-run', () => runStrata(ctx, set.strata.map(x => x.id), true));
  on('sets-mesh', () => checkMesh(ctx));
  on('sets-add', () => stratumDialog(ctx, null));
  on('sets-add-first', () => stratumDialog(ctx, null));
  on('sets-edit', () => setDialog(ctx, set));
  on('sets-gaps', () => importGaps(ctx));
  on('sets-export', async () => { const { writeDocx } = await import('../lib/docx-write.mjs'); const { saveFile } = await import('../lib/save.mjs');
    const blob = await writeDocx({ blocks: setDocument(set, { cache: meshCache(get()) }), section: null, styles: null, renderCite: () => '', renderResult: () => null, references: [] });
    await saveFile(blob, `${set.name} search strategies.docx`, DOCX); });
  on('sets-file', async () => { const { saveFile } = await import('../lib/save.mjs'); await saveFile(`${JSON.stringify(setToFile(set), null, 2)}\n`, `${set.name} strata.json`, 'application/json'); });
  on('sets-remove', async () => {
    // done at once and offered back (lib/undo-removal.mjs; W13 usability review, finding 2); records already imported stay in the library
    const id = set.id;
    await removeWithUndo(`Removed the search set ${set.name}`, () => update(x => { x.searchSets = searchSets(x).filter(y => y.id !== id); return x; }),
      () => { current = id; open = null; ctx.rerender(); });
    current = null; open = null; ctx.rerender();
  });
  if (all.length > 1) on('sets-pick', () => showMenu(el.querySelector('#sets-pick'), all.map(x => ({ label: x.name, checked: x.id === set.id, run: () => { current = x.id; open = null; ctx.rerender(); } })), { align: 'start' }));
  wireMaking(el, ctx);
}

function wireMaking(el, ctx) {
  const on = (id, fn) => { const b = el.querySelector(`#${id}`); if (b) b.onclick = fn; };
  on('sets-new', () => setDialog(ctx, null));
  on('sets-import', () => pick({ accept: '.json,application/json' }, async files => {
    try {
      const doc = JSON.parse(await files[0].text()), s = get();
      const set = setFromStrategyFile(doc, { file: files[0].name, taken: searchSets(s).map(x => x.id) });
      update(x => { x.searchSets = [...searchSets(x), set]; return x; }); current = set.id; open = null;
      ctx.say?.(`${set.name}: ${plural(set.strata.length, 'stratum', 'strata')}`); ctx.rerender();
    } catch (err) { ctx.say?.(err.message); }
  }));
}

// ---- running, checking, importing -----------------------------------------------------------------------------------------------

/** Runs strata in PubMed (lib/sources.mjs pubmedIds, posted, up to 9,999 PMIDs each), and the registered search with `baseline`. */
async function runStrata(ctx, ids, baseline) {
  const set0 = chosen(get());
  if (!set0 || busy) return;
  const { pubmedIds } = await import('../lib/sources.mjs');
  busy = true; ctx.rerender();
  try {
    await runJob('search', `Search set ${set0.name}`, async h => {
      const jobs = [...ids.map(id => ({ id })), ...(baseline && baselineQuery(set0) ? [{ id: null }] : [])];
      let done = 0;
      for (const j of jobs) {
        const set = setById(get(), set0.id), st = j.id && set?.strata.find(x => x.id === j.id);
        if (!set || (j.id && !st)) continue;
        const q = st ? stratumQuery(set, st) : baselineQuery(set), at = new Date().toISOString();
        let run;
        if (q.problems.some(p => p.level === 'error')) run = { at, query: q.query, error: q.problems.find(p => p.level === 'error').text };
        else {
          try { const r = await pubmedIds(q.query, { settings: settings(), max: 9999 }); run = { at, total: r.total, pmids: r.ids, query: q.query, warnings: r.warnings, error: r.error }; }
          catch (err) { run = { at, query: q.query, error: `PubMed: ${err.message}` }; }
        }
        // into the set the run began on, whichever set is shown by then
        update(s => { const x = setById(s, set0.id), target = x && (j.id ? x.strata.find(y => y.id === j.id) : x); if (target) recordRun(target, run, { baseline: !j.id }); return s; });
        h.progress(`${++done} of ${jobs.length}`);
      }
      return `${plural(done, 'search', 'searches')} run`;
    });
  } catch (err) { ctx.say?.(err.message); }
  finally { busy = false; ctx.rerender(); }
}

/** Looks the set's MeSH headings up at NLM and keeps the answers in the project (lib/mesh-check.mjs). */
async function checkMesh(ctx) {
  const set = chosen(get());
  if (!set || busy) return;
  const headings = setHeadings(set);
  if (!headings.length) { ctx.say?.('No MeSH headings in this set'); return; }
  busy = true; ctx.rerender();
  try {
    await runJob('search', `MeSH check (${headings.length})`, async () => {
      const res = await lookupMesh(headings, { eutils: nlmEutils({ settings: settings() }) });
      update(x => storeMesh(x, res));
      const n = k => res.filter(r => r.status === k).length;
      const said = n('unchecked') === res.length ? `Not checked: ${res[0]?.error || 'NLM did not answer'}` : [n('descriptor') && plural(n('descriptor'), 'descriptor'), n('entry') && plural(n('entry'), 'entry term'), n('missing') && `${n('missing')} not found`, n('unchecked') && `${n('unchecked')} not checked`].filter(Boolean).join(', ');
      ctx.say?.(said);
      return said;
    });
  } catch (err) { ctx.say?.(err.message); }
  finally { busy = false; ctx.rerender(); }
}

/** The gap records into the library as found by other methods (PRISMA 2020), duplicates removed by lib/search-import.mjs importInto. */
async function importGaps(ctx) {
  const set = chosen(get()), ids = set ? gapsToImport(set, get().papers) : [];
  if (!ids.length || busy) return;
  if (!await confirmAsk(`Import ${plural(ids.length, 'record')} the registered search does not find?`, { detail: `They are added to the library as identified by other methods: ${gapSource(set)}.`, confirm: 'Import' })) return;
  const { runSearch } = await import('../lib/sources.mjs'), { importInto } = await import('../lib/search-import.mjs');
  busy = true; ctx.rerender();
  try {
    await runJob('search', `Gap records (${ids.length})`, async h => {
      const records = [];
      for (let i = 0; i < ids.length; i += 200) {
        const part = ids.slice(i, i + 200), r = await runSearch('pubmed', part.map(x => `${x}[uid]`).join(' OR '), { limit: part.length, settings: settings() });
        records.push(...r.records); h.progress(`${records.length} of ${ids.length}`);
      }
      let n = null;
      update(x => { n = importInto(x, records, `${gapSource(set)}.json`, { at: new Date().toISOString(), kind: 'other' }); const run = x.searches?.at(-1); if (run && n.added + n.duplicates) run.searchSet = set.id; return x; });
      const said = `${plural(n.added, 'record')} added, ${plural(n.duplicates, 'duplicate')} removed`;
      ctx.say?.(said); ctx.refreshCounts?.();
      return said;
    });
  } catch (err) { ctx.say?.(err.message); }
  finally { busy = false; ctx.rerender(); }
}

async function removeStratum(ctx, st) {
  await removeWithUndo(`Removed the stratum ${st.name}`, () => save(set => { set.strata = set.strata.filter(x => x.id !== st.id); }), () => ctx.rerender());
  if (open === st.id) open = null;
  ctx.rerender();
}

// ---- dialogs ----------------------------------------------------------------------------------------------------------------------

// shared blocks are written one to a line: "A = #12 intracranial procedure" (a line of the strategy) or "D = animals[mh] NOT humans[mh]"
const blocksText = set => (set?.blocks || []).map(b => (b.line != null ? `${b.key} = #${b.line}${b.label ? ` ${b.label}` : ''}` : `${b.key} = ${b.text}`)).join('\n');
function readBlocks(text) {
  return String(text || '').split(/\r?\n/).map(l => l.trim()).filter(Boolean).map(l => {
    const m = /^([A-Z][A-Z0-9]?)\s*[=:]\s*(.*)$/.exec(l);
    if (!m) throw new Error(`"${clip(l, 40)}" is not a block: write A = #12 label, or A = its text`);
    const ref = /^#(\d+)\b\s*(.*)$/.exec(m[2]);
    return ref ? { key: m[1], line: Number(ref[1]), label: ref[2].trim() } : { key: m[1], label: '', text: m[2].trim() };
  });
}
const strategyLines = text => { const st = parseStrategy(text); return st.lines.map((l, i) => ({ n: l.n ?? i + 1, text: l.text, label: '' })); };
const strategySource = set => (set?.strategy?.lines || []).map(l => `#${l.n}\t${l.text}`).join('\n');

async function setDialog(ctx, set) {
  const v = await formDialog({ id: 'sets-dialog', title: set ? 'Edit search set' : 'New search set', tier: 'L', confirm: set ? 'Save' : 'Create search set',
    body: `${formField('Name', `<input name="name" required value="${esc(set?.name || '')}" autocomplete="off">`)}
      ${formField('Strategy lines', `<textarea name="strategy" rows="6" spellcheck="false" placeholder="#1&#9;&quot;Deep Brain Stimulation&quot;[Mesh] OR …">${esc(strategySource(set))}</textarea>`)}
      ${formField('Shared blocks', `<textarea name="blocks" rows="4" spellcheck="false" placeholder="A = #12 intracranial procedure">${esc(blocksText(set))}</textarea>`)}
      ${formField('Each stratum', `<input name="template" required spellcheck="false" value="${esc(set?.template || '(A) AND ({stratum})')}" autocomplete="off">`)}
      <label class="ui-check"><input type="checkbox" name="registered"${set?.registered ? ' checked' : ''}><span>Registered search</span></label>` });
  if (!v) return;
  try {
    const lines = String(v.strategy || '').trim() ? strategyLines(v.strategy) : [], blocks = readBlocks(v.blocks);
    const draft = { ...(set || {}), name: String(v.name).trim(), template: String(v.template).trim(), registered: !!v.registered, blocks,
      strategy: lines.length ? { ...(set?.strategy || {}), label: set?.strategy?.label || 'Strategy', lines } : null };
    const bad = templateProblems(draft).filter(p => p.level === 'error');
    if (bad.length) { ctx.say?.(bad[0].text); return; }
    if (set) update(x => { const i = searchSets(x).findIndex(y => y.id === set.id); if (i >= 0) x.searchSets[i] = { ...x.searchSets[i], ...draft }; return x; });
    else { const made = newSet(draft, searchSets(get()).map(x => x.id)); update(x => { x.searchSets = [...searchSets(x), made]; return x; }); current = made.id; }
    ctx.rerender();
  } catch (err) { ctx.say?.(err.message); }
}

// a stratum's term, from a project vocabulary (an indication, an instrument): "vocabulary::code"
const termOptions = (s, term) => vocabularies(s).flatMap(v => (v.terms || []).map(t => [`${v.id}::${t.code}`, `${v.name || v.id}: ${t.label || t.code}`]))
  .map(([val, label]) => `<option value="${esc(val)}"${term && `${term.vocabulary}::${term.code}` === val ? ' selected' : ''}>${esc(label)}</option>`).join('');
async function stratumDialog(ctx, st) {
  const s = get(), opts = termOptions(s, st?.term);
  const v = await formDialog({ id: 'sets-stratum', title: st ? `Edit ${st.name}` : 'Add stratum', tier: 'L', confirm: st ? 'Save' : 'Add stratum',
    body: `${formField('Name', `<input name="name" required value="${esc(st?.name || '')}" autocomplete="off">`)}
      ${formField('Stratum block', `<textarea name="block" rows="5" required spellcheck="false" placeholder="&quot;Parkinson Disease&quot;[Mesh] OR parkinson*[tiab]">${esc(st?.block || '')}</textarea>`)}
      ${formField('Covers', `<input name="covers" value="${esc((st?.covers || []).join('; '))}" placeholder="Separated by semicolons" autocomplete="off">`)}
      ${opts ? formField('Term', `<select name="term"><option value="">None</option>${opts}</select>`) : ''}` });
  if (!v) return;
  const [vocabulary, code] = String(v.term || '').split('::');
  const vocab = vocabulary && vocabularies(get()).find(x => x.id === vocabulary), t = vocab?.terms?.find(x => x.code === code);
  const fields = { name: String(v.name).trim(), block: String(v.block).trim(), covers: String(v.covers || '').split(';').map(x => x.trim()).filter(Boolean),
    term: t ? { vocabulary, code, label: t.label || code } : null };
  save(set => {
    if (st) { const x = set.strata.find(y => y.id === st.id); if (x) Object.assign(x, fields); }
    else addStratum(set, fields);
  });
  ctx.rerender();
}
