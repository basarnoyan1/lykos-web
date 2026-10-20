// Literature: known-relevant records used to test a search, to mine terms
// from, and to find related articles (lib/seed-set.mjs, term-mining.mjs,
// related.mjs). PubMed is asked only for PMIDs, DOIs and the search's own query.
import { copyText } from '../lib/clipboard.mjs';
import { get, update } from '../store.mjs';
import { esc, emptyState } from '../lib/html.mjs';
import { run as runJob } from '../lib/jobs.mjs';
import { makeSeeds, enrichSeeds, seedCheck } from '../lib/seed-set.mjs';
import { mineTerms, asQueryTerm } from '../lib/term-mining.mjs';
import { related, against, acceptRelated } from '../lib/related.mjs';
import { pagedItems, wireDataPager, resetPagedList } from '../lib/list-pager.mjs';
import { showMenu } from '../lib/menu.mjs';
import { uiBar, uiList, uiRow, uiSettingsRow } from '../lib/ui-actions.mjs';
import { tableRegion, metadataLine } from '../lib/ui-components.mjs';
import { day, num, plural } from '../lib/dates.mjs';
import { settings } from '../lib/model-settings.mjs';
import { seedPicker, seedChoice, seedReason, pastedText, setPasted } from './seed-picker.mjs';
import { candidateList } from './candidates.mjs';
import { currentQuery, appendToQuery } from './search.mjs';

const TABS = [['check', 'Check searches'], ['terms', 'Terms'], ['related', 'Related articles']];
const TERM_KINDS = [['candidates', 'Candidates'], ['mesh', 'MeSH'], ['keywords', 'Keywords'], ['phrases', 'Phrases'], ['words', 'Words'], ['grid', 'Grid']];
let kind = 'candidates', compare = '__box', ref = null;
let loaded = null, checked = null, mined = null, relatedFound = null, note = '';

const reset = s => { if (ref !== s) { ref = s; loaded = null; checked = null; mined = null; relatedFound = null; note = ''; } };
/** A picker's menu from its button, and the same choices as a submenu when the bar folded it into More (the engine sends ui-pick). */
const choose = (button, entries, onPick) => { if (!button) return; button.onclick = () => showMenu(button, entries(), { align: 'end' }); button.addEventListener('ui-pick', e => onPick(e.detail.value)); };
const STATE_LABEL = { retrieved: 'Retrieved', missed: 'Missed', unchecked: 'Not checked' };

/** The title bar's status while Seed records is open: the seeds loaded ('12 seeds · 3 with MeSH'), or '' before any are. */
export const seedsStatus = () => loaded ? `${plural(loaded.seeds.length, 'seed')} · ${loaded.seeds.filter(x => x.mesh?.length).length} with MeSH${loaded.seeds.some(x => x.notInPubmed) ? ` · ${loaded.seeds.filter(x => x.notInPubmed).length} not in PubMed` : ''}` : '';

export function renderSeeds(el, ctx) {
  reset(get());
  // One short form (Source, then the identifiers with Load after them, on one label column); the seeds feed the three sections below it.
  el.innerHTML = `<section class="lit-tool seeds">
    <div class="lit-form-rows" id="seed-form"><div id="seed-pick"></div>
      ${uiSettingsRow({ id: 'seed-ids-row', label: 'PMIDs or DOIs', controls: { id: 'seed-ids',
        filters: [{ type: 'field', id: 'seed-pasted', label: 'PMIDs or DOIs', placeholder: 'Separated by spaces', value: pastedText(), width: 'flex', attrs: { spellcheck: 'false', autocomplete: 'off' } }],
        actions: [{ id: 'seed-load', label: 'Load seed records', icon: 'import', role: 'primary' }] } })}</div>
    ${loaded ? '' : `<div id="seed-empty">${emptyState({ title: 'No seed records loaded', size: 'inline' })}</div>`}
    ${TABS.map(([k]) => `<div class="panel lit-tool" id="seed-${k}" hidden></div>`).join('')}</section>`;
  const say = text => ctx.say?.(text);
  const hosts = Object.fromEntries(TABS.map(([k]) => [k, el.querySelector(`#seed-${k}`)]));
  const load = el.querySelector('#seed-load');
  let said = '', busy = false;
  // Load waits for seeds: disabled, and the title bar says why
  const ready = () => { const why = seedReason({ pasted: true }); load.disabled = busy || !!why; if (!busy && (why || said)) say(why); said = why; };
  const counts = () => { el.querySelector('#seed-empty')?.toggleAttribute('hidden', !!loaded); ctx.status?.(loaded ? { text: seedsStatus(), ch: 24 } : null); };
  const changed = () => { loaded = null; checked = null; mined = null; relatedFound = null; counts(); paint(); ready(); };
  seedPicker(el.querySelector('#seed-pick'), { onChange: changed });
  el.querySelector('#seed-pasted').addEventListener('input', e => { setPasted(e.target.value); changed(); });

  load.onclick = async () => {
    const choice = seedChoice(), s = get();
    const { seeds, unrecognised } = makeSeeds(s.papers || [], { ids: choice.ids, pasted: choice.pasted });
    if (!seeds.length) { say('No seed records'); return; }
    busy = true; load.disabled = true; say('Reading from PubMed');
    const state = get(); let full = null;
    try {
      await runJob('search', `Seed records · ${seeds.length}`, async h => { full = await enrichSeeds(seeds, { settings: settings(), onProgress: (d, n) => h.progress(`${d} of ${n}`) }); return `${full.length} seeds`; });
      if (get() !== state) return;
      loaded = { seeds: full, unrecognised }; checked = null; mined = null; relatedFound = null;
      say(unrecognised.length ? `Not read as an identifier: ${unrecognised.slice(0, 3).join(', ')}` : '');
    } catch (err) { say(err.message); }
    finally { busy = false; }
    if (el.isConnected) { load.disabled = !!seedReason({ pasted: true }); counts(); paint(); }
  };
  const need = () => { Object.values(hosts).forEach(h => { h.hidden = !loaded; }); return !!loaded; };
  function paint() { if (!need()) return; paintCheck(); paintTerms(); paintRelated(); }

  // ---- which seeds the searches retrieve ----
  function paintCheck() {
    const out = hosts.check;
    out.innerHTML = `${uiBar({ kind: 'head', label: 'Check searches', id: 'check-head', lead: { title: 'Check searches', level: 'h2' }, message: { id: 'check-status', text: checked ? '' : 'PubMed and Europe PMC are asked with your query; other sources use the records they retrieved' }, actions: [{ id: 'check-run', label: 'Check', icon: 'check' }] })}
      <div class="panel-body lit-body" id="check-body"></div>`;
    const body = out.querySelector('#check-body'), st = out.querySelector('#check-status');
    const drawResults = () => {
      body.innerHTML = checked.length ? checked.map((r, i) => `<div class="check-block">${metadataLine([r.search.source, day(r.search.at || Date.now()), `${r.retrieved} retrieved`, `${r.missed} missed`, r.unchecked ? `${r.unchecked} not checked` : '', r.note || ''])}
        <div class="check-rows" data-check-rows="${i}"></div></div>`).join('')
        : '<div class="ov-clear"><span>No searches to check</span></div>';
      body.querySelectorAll('[data-check-rows]').forEach(host => {
        const r = checked[Number(host.dataset.checkRows)], key = `check-${host.dataset.checkRows}`;
        const sorted = [...r.rows].sort((a, b) => ({ missed: 0, unchecked: 1, retrieved: 2 })[a.state] - ({ missed: 0, unchecked: 1, retrieved: 2 })[b.state]);
        const draw = () => {
          const pg = pagedItems(sorted, key, 8);
          host.innerHTML = uiList({ id: `${key}-list`, label: `Seeds checked against ${r.search.source}`, cols: ['state'], rows: pg.items.map(x => uiRow({ cls: 'check-row',
            main: { html: `<span class="cand-title">${esc(x.seed.title || x.seed.label)}</span>`, detail: [x.missing.length ? `Terms the query lacks: ${esc(x.missing.map(t => t.term).join('; '))}` : ''], wrap: true },
            cells: [{ col: 'state', kind: 'text', ch: 12, html: `<span class="check-state s-${x.state}">${STATE_LABEL[x.state]}</span>` }] })) });
          wireDataPager(host.firstElementChild, key, { total: pg.total, size: 8, onChange: draw });
        };
        resetPagedList(key); draw();
      });
    };
    if (checked) drawResults();
    out.querySelector('#check-run').onclick = async e => {
      const s = get(), box = currentQuery();
      const searches = [...(s.searches || []), ...(box.text ? [{ source: box.label, query: box.text, at: new Date().toISOString(), status: 'complete' }] : [])];
      e.currentTarget.disabled = true; st.textContent = 'Checking';
      const state = get(); let res = null;
      try {
        await runJob('search', `Seed check · ${loaded.seeds.length} seeds`, async h => { res = await seedCheck(searches, loaded.seeds, s, { settings: settings(), onProgress: t => h.progress(t) }); return `${res.length} searches`; });
        if (get() !== state) return;
        checked = res; st.textContent = '';
      } catch (err) { st.textContent = err.message; }
      if (out.isConnected) { const b = out.querySelector('#check-run'); if (b) b.disabled = false; if (checked) drawResults(); }
    };
  }

  // ---- terms ----
  function paintTerms() {
    const out = hosts.terms, s = get();
    const runs = [...new Map((s.searches || []).filter(r => r.query && !r.citationSearch && !r.related && r.status !== 'failed').map(r => [`${r.source}::${r.query}`, r])).values()];
    const box = currentQuery();
    const query = compare === '__box' ? box.text : (runs[Number(compare)]?.query || '');
    mined = mineTerms(loaded.seeds.filter(x => x.title || x.abstract || x.mesh?.length), { query });
    const rows = kind === 'grid' ? [] : (mined[kind] || []);
    const compareOptions = [['__box', 'Query in the search box'], ...runs.map((r, i) => [String(i), `${r.source}, ${day(r.at)}`])];
    out.innerHTML = `${uiBar({ kind: 'head', label: 'Terms', id: 'terms-head', lead: { title: 'Terms', level: 'h2' }, message: { id: 'terms-count', text: plural(mined.n, 'record') },
      actions: [{ picker: true, id: 'terms-kind', label: 'Terms shown', icon: 'list-bullet', value: TERM_KINDS.find(([k]) => k === kind)[1], options: TERM_KINDS },
        { picker: true, id: 'terms-compare', label: 'Compared with', icon: 'scale', value: compareOptions.find(([k]) => k === compare)?.[1] || compareOptions[0][1], options: compareOptions },
        { id: 'terms-copy', label: 'Copy as OR group', icon: 'copy', role: 'quiet', disabled: true }, { id: 'terms-box', label: 'Put in search box', icon: 'search', role: 'quiet', disabled: true }] })}
      <div class="panel-body lit-body"><p class="meta" data-ui-help>Terms come from the seeds only. MeSH names are compared as written, not by tree. Place each term in the right concept.</p>
        <div id="terms-body"></div></div>`;
    const body = out.querySelector('#terms-body'), picked = new Set();
    if (kind === 'grid') {
      const g = mined.grid;
      body.innerHTML = g.rows.length ? `${tableRegion({ label: 'Terms by record', sticky: true, html: `<table class="term-grid"><thead><tr><th>Term</th><th class="num">Records</th>${g.columns.map(c => `<th class="cell" scope="col">${esc(c.label)}</th>`).join('')}</tr></thead><tbody>${g.rows.map(r => `<tr><td>${esc(r.term)}${r.inQuery ? ' <span class="meta">in query</span>' : ''}</td><td class="num">${r.docs}</td>${r.cells.map(v => `<td class="cell${v ? ' on' : ''}"></td>`).join('')}</tr>`).join('')}</tbody></table>` })}${mined.n > g.columns.length ? `<div class="meta">${g.columns.length} of ${mined.n} records</div>` : ''}` : '<div class="ov-clear"><span>No MeSH terms or keywords</span></div>';
    } else {
      const shown = rows.slice(0, 400);
      const draw = () => {
        const pg = pagedItems(shown, 'terms', 12);
        body.innerHTML = shown.length ? uiList({ id: 'term-list', label: 'Terms', rows: pg.items.map(t => { const i = shown.indexOf(t); return uiRow({ cls: 'term-row',
          check: { attrs: { 'data-term': i }, checked: picked.has(i), label: `Select ${t.term}` },
          main: { html: `<span class="term-main">${esc(t.term)}</span>`, detail: [`${t.kind && kind === 'candidates' ? `${esc(t.kind === 'mesh' ? 'MeSH' : t.kind === 'keyword' ? 'Keyword' : t.kind === 'phrase' ? 'Phrase' : 'Word')} · ` : ''}${t.docs} of ${mined.n}${t.inQuery && kind !== 'candidates' ? ' · in query' : ''}${t.strength != null && t.kind === 'phrase' ? ` · strength ${t.strength}` : ''}`] } }); }) })
          : '<div class="ov-clear"><span>Nothing to add</span></div>';
        if (shown.length) wireDataPager(body.firstElementChild, 'terms', { total: pg.total, size: 12, onChange: draw });
        body.querySelectorAll('[data-term]').forEach(cb => cb.onchange = () => { cb.checked ? picked.add(Number(cb.dataset.term)) : picked.delete(Number(cb.dataset.term)); sync(); });
      };
      const group = () => `(${[...picked].map(i => asQueryTerm(shown[i])).join(' OR ')})`;
      const sync = () => { out.querySelectorAll('#terms-copy,#terms-box').forEach(b => { b.disabled = !picked.size; }); };
      resetPagedList('terms'); draw();
      out.querySelector('#terms-copy').onclick = async () => { const text = group(); say(await copyText(text) ? 'Copied' : 'Could not copy'); };
      out.querySelector('#terms-box').onclick = () => { appendToQuery(group()); say('Added to the search box'); };
    }
    const pickKind = k => { kind = k; paintTerms(); out.querySelector('#terms-kind')?.focus(); };
    const pickCompare = k => { compare = k; paintTerms(); out.querySelector('#terms-compare')?.focus(); };
    choose(out.querySelector('#terms-kind'), () => TERM_KINDS.map(([k, l]) => ({ label: l, checked: k === kind, run: () => pickKind(k) })), pickKind);
    choose(out.querySelector('#terms-compare'), () => compareOptions.map(([k, l]) => ({ label: l, checked: k === compare, run: () => pickCompare(k) })), pickCompare);
  }

  // ---- related articles ----
  function paintRelated() {
    const out = hosts.related, pm = loaded.seeds.filter(x => x.pmid);
    out.innerHTML = `${uiBar({ kind: 'head', label: 'Related articles', id: 'rel-head', lead: { title: 'Related articles', level: 'h2' }, message: { id: 'rel-status', text: pm.length ? `PubMed · ${plural(pm.length, 'seed')} with a PMID` : 'No seed has a PMID' },
      actions: [{ id: 'rel-run', label: 'Find', icon: 'search', disabled: !pm.length }] })}
      <div class="panel-body lit-body"><p class="meta" data-ui-help>Related articles are an exploration. The run is logged as exploratory and left out of the PRISMA counts.</p></div><div id="rel-result"></div>`;
    const st = out.querySelector('#rel-status');
    const draw = () => {
      if (!relatedFound) return;
      const host = out.querySelector('#rel-result');
      relatedFound.candidates = against(relatedFound.candidates, get().papers);
      candidateList(host, relatedFound, { key: 'related', noun: 'articles', describe: c => `listed by ${c.links} of ${relatedFound.seeds} seeds`,
        onAdd: (ids, destination) => { let n = 0; update(stt => { n = acceptRelated(stt, relatedFound, ids, { destination }); return stt; }); note = `Added ${n}. Logged as an exploratory run`; ctx.refreshCounts(); ctx.rerender(note); return n; } });
    };
    draw();
    out.querySelector('#rel-run').onclick = async e => {
      e.currentTarget.disabled = true; st.textContent = 'Finding';
      const state = get(); let res = null;
      try {
        await runJob('search', `Related articles · ${pm.length} seeds`, async h => { res = await related(pm.map(x => x.pmid), { settings: settings(), onProgress: t => h.progress(t) }); return `${res.retrieved} articles`; });
        if (get() !== state) return;
        relatedFound = res; st.textContent = `${num(res.retrieved)} articles from ${plural(res.seeds, 'seed')}`;
      } catch (err) { st.textContent = err.message; }
      if (out.isConnected) { const b = out.querySelector('#rel-run'); if (b) b.disabled = false; draw(); }
    };
  }
  paint();
  ready();
}
