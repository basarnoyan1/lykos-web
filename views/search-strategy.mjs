// Literature: study-design filters and the PRESS peer-review form for a search
// (lib/filters.mjs, lib/press.mjs).
import { copyText } from '../lib/clipboard.mjs';
import { get, update } from '../store.mjs';
import { esc } from '../lib/html.mjs';
import { showMenu } from '../lib/menu.mjs';
import { INSERTABLE, PUBLISHED, withFilter, filterCopy, setFilterCopy } from '../lib/filters.mjs';
import { askText, confirmAsk } from '../lib/dialog.mjs';
import { openLink } from '../lib/native.mjs';
import { PRESS_DOMAINS, PRESS_CITATION, STATES, reviewOf, setReview, isComplete, revisions, toMarkdown, toBlocks, toCsvRows } from '../lib/press.mjs';
import { dateField, wireDateField } from '../lib/date-picker.mjs';
import { writeDocx } from '../lib/docx-write.mjs';
import { saveFile } from '../lib/save.mjs';
import { downloadCsv } from '../lib/figure.mjs';
import { settings } from '../lib/model-settings.mjs';
import { currentQuery, replaceQuery } from './search.mjs';
import { translateQuery, TARGET_NAMES, CHECK_HEADING } from '../lib/query-translate.mjs';
import { formField, disclosure } from '../lib/ui-components.mjs';
import { uiBar, uiList, uiRow, uiRowEnd } from '../lib/ui-actions.mjs';
import { day } from '../lib/dates.mjs';
import { hasQuerySyntax } from '../lib/query-view.mjs';

let entry = null;   // the log entry under review, by index
let translateSrc = null;   // the PubMed strategy being translated; starts from the search box
// Translations for databases searched outside Lykos (lib/query-translate.mjs), in the order a review usually lists them.
const TRANSLATE_TO = ['ovid-medline', 'ovid-embase', 'cinahl', 'cochrane', 'wos', 'scopus'];
let refState = null;
let translateTarget = TRANSLATE_TO[0];

/** A menu from a picker's button, and the same choices as a submenu when the bar folded it into More (the engine sends ui-pick). */
const choose = (button, entries, onPick) => { if (!button) return; button.onclick = () => showMenu(button, entries(), { align: 'end' }); button.addEventListener('ui-pick', e => onPick(e.detail.value)); };

const pressRows = r => uiList({ id: 'press-domains', label: 'PRESS domains', cls: 'press-domains', cols: ['state', 'comment'], rows: PRESS_DOMAINS.map((d, n) => uiRow({ cls: 'press-domain',
        main: { html: `<span class="press-name"><span class="meta">${n + 1}</span> ${esc(d.name)}</span>`, detail: [esc(d.prompt)], wrap: true },
        cells: [{ col: 'state', kind: 'control', html: `<select data-press-state="${d.id}" aria-label="${esc(d.name)} judgement">${STATES.map(([k, l]) => `<option value="${k}"${(r.domains[d.id].state) === k ? ' selected' : ''}>${l}</option>`).join('')}</select>` },
          { col: 'comment', kind: 'control', html: `<input class="press-comment" data-press-comment="${d.id}" value="${esc(r.domains[d.id].comment)}" placeholder="Comment" aria-label="${esc(d.name)} comment">` }] })) });

// A published filter: its source, what it is for and how to cite it. Its text is not Lykos's to carry (lib/filters.mjs), so a person
// pastes their own copy once (Save my copy…) and adds it from then on; PubMed's Clinical Queries are in Add filter by name instead.
const publishedRow = f => {
  const copy = filterCopy(get(), f.id);
  return uiRow({ cls: 'published-row', attrs: { 'data-published': f.id },
    main: { html: `<a href="${esc(f.url)}" target="_blank" rel="noopener noreferrer">${esc(f.name)}</a>`,
      detail: [esc(f.use), esc(f.citation), ...(f.builtIn ? [esc(f.terms)] : copy ? [`Your copy, saved ${esc(day(copy.at))}`] : [])], wrap: true },
    end: uiRowEnd({ primary: f.builtIn ? null : copy ? { id: `pf-add-${f.id}`, label: 'Add to query', attrs: { 'data-pf-add': f.id } }
      : { id: `pf-save-${f.id}`, label: 'Save my copy…', attrs: { 'data-pf-save': f.id } },
      more: { label: `More for ${f.name}`, attrs: { 'data-pf-more': f.id } } }) });
};

const searchSelect = runs => formField('Search', `<select id="press-search" aria-label="Search under review">${runs.map(([x, i]) => `<option value="${i}"${i === entry ? ' selected' : ''}>${esc(`${x.source || 'PubMed'}, ${day(x.at)}, ${x.query.slice(0, 60)}`)}</option>`).join('')}</select>`);

const targetSelect = () => formField('Translate to', `<select id="tr-target" aria-label="Translation database">${TRANSLATE_TO.map(t => `<option value="${t}"${t === translateTarget ? ' selected' : ''}>${esc(TARGET_NAMES[t])}</option>`).join('')}</select>`);

// One page, three sections: the field filters, the translation to other databases, and the peer review of a logged search.
export function renderStrategy(el, ctx) {
  const s = get();
  if (refState !== s) { refState = s; entry = null; }
  const runs = (s.searches || []).map((r, i) => [r, i]).filter(([r]) => r.query && !r.citationSearch && !r.related && r.status !== 'failed' && (!r.imported || hasQuerySyntax(r.query)));
  if (entry == null || !runs.some(([, i]) => i === entry)) entry = runs.length ? runs.at(-1)[1] : null;
  const groups = [...new Set(INSERTABLE.map(f => f.group))];
  const groupLabel = g => g === 'Limit' ? 'Limits' : g;
  const noEntry = entry == null;
  el.innerHTML = `<div class="panel lit-tool strategy-filters" id="strategy-filters">
      ${uiBar({ kind: 'head', label: 'PubMed field filters', id: 'filters-head', lead: { title: 'PubMed field filters', level: 'h2' }, message: { id: 'filter-status', text: '' } })}
      <div class="panel-body lit-body">
        <div class="strategy-query"><pre class="tr-query" id="strategy-preview">${esc(currentQuery().text || 'No query entered')}</pre></div>
        ${uiBar({ kind: 'tools', label: 'Add a filter', id: 'filter-tools', actions: [{ picker: true, id: 'filter-add', label: 'Add filter', icon: 'filter', value: 'Add filter', options: INSERTABLE.map(f => [f.id, `${groupLabel(f.group)}: ${f.label}`]) }] })}
        ${disclosure({ id: 'published-filters', title: 'Published search filters', count: String(PUBLISHED.length), className: 'published-filters', body: uiList({ id: 'published-list', label: 'Published search filters', rows: PUBLISHED.map(publishedRow) }) })}
      </div></div>
    <div class="panel lit-tool" id="strategy-translate">
      ${uiBar({ kind: 'head', label: 'Translate for other databases', id: 'translate-head', lead: { title: 'Translate for other databases', level: 'h2' }, message: { id: 'translate-note', text: 'From PubMed syntax' },
        actions: [{ id: 'tr-use', label: 'Use current query', icon: 'search', role: 'quiet' }] })}
      <div class="panel-body strategy-translation">
        <label class="field strategy-source"><span>PubMed strategy</span><textarea id="tr-src" rows="3" spellcheck="false" aria-label="PubMed strategy">${esc(translateSrc ?? '')}</textarea></label>
        <div class="strategy-target">${targetSelect()}<div id="tr-out" class="tr-out" aria-live="polite"></div></div>
      </div></div>
    <div class="panel lit-tool" id="strategy-review">
      ${uiBar({ kind: 'head', label: 'Peer review of the search', id: 'press-head', lead: { title: 'Peer review of the search', level: 'h2' }, message: { id: 'press-note', text: 'PRESS 2015' },
        actions: [{ id: 'press-md', label: 'Copy', icon: 'copy', disabled: noEntry }, { id: 'press-export', label: 'Export', icon: 'export', menu: true, disabled: noEntry }] })}
      <div class="panel-body lit-body" id="press-body"></div></div>`;
  const status = el.querySelector('#filter-status');
  const insertFilter = f => {
    const box = currentQuery();
    if (box.source !== 'pubmed') { status.textContent = 'Filters use PubMed syntax; switch the source to PubMed'; return; }
    replaceQuery(withFilter(box.text, f.text));
    el.querySelector('#strategy-preview').textContent = currentQuery().text;
    status.textContent = `${f.label} added to the search box`;
  };
  // One menu, a heading for each kind of filter; the folded form of the picker lists them flat.
  choose(el.querySelector('#filter-add'), () => groups.flatMap(g => [{ heading: groupLabel(g) }, ...INSERTABLE.filter(f => f.group === g).map(f => ({ label: f.label, run: () => insertFilter(f) }))]),
    id => { const f = INSERTABLE.find(x => x.id === id); if (f) insertFilter(f); });
  // Published filters: a saved copy is ANDed on as Add filter does; Save my copy… asks for the text, pasted from the filter's source.
  const askCopy = async f => {
    const text = await askText(`Your copy of ${f.name}`, { value: filterCopy(get(), f.id)?.text || '', placeholder: 'Paste the PubMed version from the source', confirm: 'Save' });
    if (text == null) return;
    update(st => setFilterCopy(st, f.id, text)); ctx.rerender();
  };
  el.querySelectorAll('[data-pf-save]').forEach(b => b.onclick = () => askCopy(PUBLISHED.find(f => f.id === b.dataset.pfSave)));
  el.querySelectorAll('[data-pf-add]').forEach(b => b.onclick = () => { const f = PUBLISHED.find(x => x.id === b.dataset.pfAdd), copy = filterCopy(get(), f.id);
    if (copy) insertFilter({ label: f.name, text: copy.text.includes(' ') && !/^\(.*\)$/s.test(copy.text) ? `(${copy.text})` : copy.text }); });
  el.querySelectorAll('[data-pf-more]').forEach(b => b.onclick = () => {
    const f = PUBLISHED.find(x => x.id === b.dataset.pfMore), copy = filterCopy(get(), f.id);
    showMenu(b, [
      { label: 'Open source', icon: 'open', run: () => openLink(f.url) },
      copy && { label: 'Edit my copy…', icon: 'rename', run: () => askCopy(f) },
      copy && { label: 'Remove my copy', icon: 'trash', danger: true, run: async () => { if (await confirmAsk(`Remove your copy of ${f.name}?`, { confirm: 'Remove', danger: true })) { update(st => setFilterCopy(st, f.id, '')); ctx.rerender(); } } },
    ].filter(Boolean), { align: 'end' });
  });
  wireTranslate(el, runs);
  const body = el.querySelector('#press-body');
  if (entry == null) { body.innerHTML = '<div class="ov-clear"><span>No searches logged</span></div>'; return; }
  const draw = () => {
    const e = (get().searches || [])[entry], r = reviewOf(e);
    body.innerHTML = `${searchSelect(runs)}
      <div class="press-fields">${formField('Reviewer', `<input id="press-reviewer" value="${esc(r.reviewer || settings().reviewerName || '')}" aria-label="Reviewer">`)}
        <label class="field ui-field"><span>Date</span>${dateField('press-date', r.date, 'Review date')}</label></div>
      ${pressRows(r)}
      ${formField('Summary', `<textarea id="press-summary" rows="2" aria-label="Summary of the review">${esc(r.summary)}</textarea>`)}
      <p class="press-cite"><a href="${esc(PRESS_CITATION.url)}" target="_blank" rel="noopener noreferrer">McGowan et al. 2016</a></p>`;
    el.querySelector('#press-note').textContent = `PRESS 2015: ${isComplete(r) ? `Complete, ${revisions(r)} ${revisions(r) === 1 ? 'domain' : 'domains'} with revisions` : 'Not complete'}`;
    wireDateField(body, 'press-date', 'Review date');
    const save = patch => update(st => { setReview(st, entry, patch); return st; });
    body.querySelector('#press-search').onchange = ev => { entry = Number(ev.target.value); draw(); };
    body.querySelector('#press-reviewer').onchange = ev => { save({ reviewer: ev.target.value }); draw(); };
    body.querySelector('#press-date')?.addEventListener('change', ev => { save({ date: ev.target.value }); draw(); });
    body.querySelectorAll('[data-press-state]').forEach(x => x.onchange = () => { save({ domains: { [x.dataset.pressState]: { state: x.value } } }); draw(); });
    body.querySelectorAll('[data-press-comment]').forEach(x => x.onchange = () => save({ domains: { [x.dataset.pressComment]: { comment: x.value } } }));
    body.querySelector('#press-summary').onchange = ev => save({ summary: ev.target.value });
  };
  draw();
  const current = () => (get().searches || [])[entry];
  el.querySelector('#press-md').onclick = async () => { const text = toMarkdown(current()); status.textContent = await copyText(text) ? 'Review copied' : 'Could not copy'; };
  const exportAs = how => how === 'csv' ? downloadCsv(toCsvRows(current()), 'press-review.csv') : writeDocx({ blocks: toBlocks(current()), section: null, styles: null, renderCite: () => '', renderResult: () => null, references: [] })
    .then(blob => saveFile(blob, 'press-review.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'));
  choose(el.querySelector('#press-export'), () => [{ label: 'CSV', icon: 'export', run: () => exportAs('csv') }, { label: 'Word', icon: 'export', run: () => exportAs('docx') }], exportAs);
}

/** The strategy in PubMed syntax, rewritten for each database, each with its notes and a Copy button. */
function translationsHtml(src) {
  if (!src.trim()) return '';
  return [translateTarget].map(t => {
    const r = translateQuery(src, t);
    const text = r.query;
    return `<section class="tr-target" aria-label="${esc(TARGET_NAMES[t])}">
      ${uiBar({ kind: 'tools', label: `${TARGET_NAMES[t]} strategy`, id: `tr-copy-bar-${t}`, actions: [{ id: `tr-copy-${t}`, label: 'Copy', icon: 'copy', disabled: !text, attrs: { 'data-tr-copy': t } }] })}
      ${r.errors.length ? `<p class="tr-errors" role="alert">${esc(`Not translated: ${r.errors.join('; ')}`)}</p>` : ''}
      ${r.lines ? `<ol class="tr-lines">${r.lines.map(l => `<li><code>${esc(l)}</code></li>`).join('')}</ol>` : text ? `<pre class="tr-query"><code>${esc(text)}</code></pre>` : ''}
      ${r.headings?.length ? `<p class="tr-check"><strong>${esc(CHECK_HEADING.replace(/^./, c => c.toUpperCase()))}</strong> ${esc(r.headings.map(h => h.heading).join(', '))} <span class="meta">${esc(r.headings[0].vocabulary)}</span></p>` : ''}
      ${r.notes.length ? `<ul class="tr-notes meta">${r.notes.map(n => `<li>${esc(n)}</li>`).join('')}</ul>` : ''}
    </section>`;
  }).join('');
}

function wireTranslate(el, runs) {
  const src = el.querySelector('#tr-src'), out = el.querySelector('#tr-out'), status = el.querySelector('#filter-status');
  if (translateSrc == null) {
    const box = currentQuery();
    const logged = runs.map(([r]) => r).reverse().find(r => /pubmed/i.test(r.source || 'PubMed'));
    translateSrc = box.text && box.source === 'pubmed' ? box.text : logged?.query || '';
    src.value = translateSrc;
  }
  const draw = () => {
    out.innerHTML = translationsHtml(translateSrc);
    out.querySelectorAll('[data-tr-copy]').forEach(b => b.onclick = async () => {
      const text = translateQuery(translateSrc, b.dataset.trCopy).query;
      status.textContent = await copyText(text) ? `${TARGET_NAMES[b.dataset.trCopy]} strategy copied` : 'Could not copy';
    });
  };
  el.querySelector('#tr-target').onchange = e => { translateTarget = e.target.value; draw(); };
  let t = null;
  src.oninput = () => { translateSrc = src.value; clearTimeout(t); t = setTimeout(draw, 200); };
  el.querySelector('#tr-use').onclick = () => {
    const box = currentQuery();
    if (box.source !== 'pubmed') { status.textContent = 'The search box is not in PubMed syntax; switch the source to PubMed'; return; }
    translateSrc = box.text; src.value = translateSrc; draw();
  };
  draw();
}
