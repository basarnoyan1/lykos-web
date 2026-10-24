// Reporting: the Search Summary Table (lib/search-summary.mjs) as a section
// with Word, CSV and Markdown exports.
import { copyText } from '../lib/clipboard.mjs';
import { searchSummary, summaryRows, toCsvRows, toMarkdown, toBlocks } from '../lib/search-summary.mjs';
import { writeDocx } from '../lib/docx-write.mjs';
import { saveFile } from '../lib/save.mjs';
import { downloadCsv } from '../lib/figure.mjs';
import { uiBar } from '../lib/ui-actions.mjs';
import { tableRegion } from '../lib/ui-components.mjs';
import { esc } from '../lib/html.mjs';
import { get } from '../store.mjs';
import { showMenu } from '../lib/menu.mjs';

const title = s => s.paper?.title || s.protocol?.title || '';

/** Why the summary has nothing to show, or '' when it has rows. */
export function summaryEmpty(s) { const t = searchSummary(s); return !t.started ? 'No inclusion decisions yet' : !t.rows.length ? 'No searches logged' : ''; }

/** The summary's table, without a head (Tables and figures' item page heads it with its title bar). */
export function summaryBody(s) { return summaryTable(s, summaryEmpty(s)); }

export function summaryPanel(s, hidden = '') {
  const empty = summaryEmpty(s);
  return `<div class="panel prisma-search" data-rp="summary"${hidden}>
    ${uiBar({ kind: 'head', cls: 'rp-head', label: 'Search summary', id: 'sum-head', lead: { title: 'Search summary', level: 'h2' },
      actions: [{ id: 'sum-download', label: 'Download', icon: 'download', menu: true, disabled: !!empty }] })}
    ${summaryTable(s, empty)}
  </div>`;
}
function summaryTable(s, empty) {
  const t = searchSummary(s), r = summaryRows(t);
  return `<div class="panel-body tight">${empty ? `<div class="ov-clear"><span>${empty}</span></div>` : `${tableRegion({ label: 'Search summary', html: `<table class="cl sum-table">
      <thead><tr><th class="grow">${esc(r.head[0])}</th>${r.head.slice(1).map(h => `<th class="num">${esc(h)}</th>`).join('')}</tr></thead>
      <tbody>${[...r.body, ...r.foot].map((row, i) => `<tr${i >= r.body.length ? ' class="strong"' : ''}><td class="grow${i >= r.body.length ? ' strong' : ''}">${esc(row[0])}</td>${row.slice(1).map(c => `<td class="num">${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>` })}
      ${t.unattributed.length ? `<div class="meta sum-total">${t.unattributed.length} included ${t.unattributed.length === 1 ? 'study has' : 'studies have'} no source recorded</div>` : ''}`}</div>`;
}

export function wireSummary(el) {
  const note = text => { const n = el.querySelector('#rp-note'); if (n) n.textContent = text; };
  const button = el.querySelector('#sum-download');
  button?.addEventListener('click', () => showMenu(button, summaryMenu(note)));
}

/** The summary's downloads: CSV, the Word appendix and a copy as Markdown; `note(text)` says what was done. */
export function summaryMenu(note = () => {}) {
  const rep = () => searchSummary(get());
  const word = async () => {
    const blob = await writeDocx({ blocks: toBlocks(rep(), title(get())), section: null, styles: null, renderCite: () => '', renderResult: () => null, references: [] });
    await saveFile(blob, 'search-summary.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  };
  return [
    { label: 'CSV', icon: 'download', run: () => downloadCsv(toCsvRows(rep()), 'search-summary.csv') },
    { label: 'Word appendix', icon: 'download', run: word },
    '-', { label: 'Copy summary', icon: 'copy', run: async () => note(await copyText(toMarkdown(rep(), title(get()))) ? 'Search summary copied' : 'Could not copy') },
  ];
}
