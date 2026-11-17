// Reporting: the Search Summary Table (lib/search-summary.mjs) as a section
// with Word, CSV and Markdown exports.
import { copyText } from '../lib/clipboard.mjs';
import { searchSummary, summaryRows, toCsvRows, toMarkdown, toBlocks, dayText, COUNTING, NOT_COUNTED } from '../lib/search-summary.mjs';
import { lib_icons$icon as icon } from "../boot.mjs";
import { writeDocx } from '../lib/docx-write.mjs';
import { lib_save$saveFile as saveFile } from "../boot.mjs";
import { downloadCsv } from '../lib/figure.mjs';
import { lib_ui_actions$uiBar as uiBar } from "../boot.mjs";
import { lib_ui_components$tableRegion as tableRegion } from "../boot.mjs";
import { lib_html$esc as esc } from "../boot.mjs";
import { store$get as get } from "../boot.mjs";
import { lib_menu$showMenu as showMenu } from "../boot.mjs";

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
const pct = v => v == null ? '' : `${(v * 100).toFixed(1)}%`;
const num = v => v == null || v === '' ? '' : esc(v);
const dash = why => `<span title="${esc(why)}">—</span>`;
/**
 * A database's runs under its row, behind its opener (16 Nov 2026, the owner: "why use code name style things", "some were retired
 * searches"): the live runs, then the exploratory, then the retired, each read as its topic and date; only the database's row is counted.
 */
function runRows(x, i) {
  const live = (x.runList || []).filter(u => !u.exploratory), expl = (x.runList || []).filter(u => u.exploratory), gone = x.retired || [];
  const line = (name, cells, cls = '') => `<tr class="sum-run${cls}" data-sum-of="${i}" hidden><td class="grow"><span class="sum-run-name">${name}</span></td>${cells.map(c => `<td class="num">${c}</td>`).join('')}</tr>`;
  const runCells = u => [num(u.retrieved), u.found == null ? dash(u.why || 'not known') : esc(u.found), '', '', u.precision == null ? (u.found == null ? dash(u.why || 'not known') : '') : esc(pct(u.precision))];
  return [
    ...live.map(u => line(esc(u.short), runCells(u))),
    ...expl.map(u => line(`${esc(u.short)}, <span class="meta">exploratory, not counted</span>`, runCells(u), ' is-quiet')),
    ...gone.map(u => line(`${esc(u.short)}, <span class="meta">${u.previous ? 'the previous version\'s search, not counted' : `retired ${esc(dayText(u.at))}${u.scenario ? ` (scenario ${esc(u.scenario)})` : ''}`}</span>`, [num(u.retrieved), '', '', '', ''], ' is-quiet')),
  ].join('');
}
function summaryTable(s, empty) {
  const t = searchSummary(s), r = summaryRows(t);
  if (empty) return `<div class="panel-body tight"><div class="ov-clear"><span>${empty}</span></div></div>`;
  const body = t.rows.map((x, i) => {
    const row = r.body[i], n = (x.runList || []).length + (x.retired || []).length;
    const apart = (x.retired || []).filter(u => !u.previous).length, prev = (x.retired || []).length - apart;
    const what = [x.runList?.length ? `${x.runList.length} ${x.runList.length === 1 ? 'run' : 'runs'}` : '', apart ? `${apart} retired` : '', prev ? `${prev} of the previous version` : ''].filter(Boolean).join(', ');
    const opener = n > 1 || x.retired?.length ? `<button type="button" class="icon ui-edit-open" data-sum-open="${i}" aria-expanded="false" aria-label="${esc(`Show the runs of ${x.source}: ${what}`)}" title="${esc(`${what}; the database counts its live runs' records added up`)}">${icon('chevron-right', { size: 14 })}</button>` : '<span class="sum-open-space"></span>';
    return `<tr><td class="grow"><div class="ui-edit-lead">${opener}<div class="ui-edit-lead-text">${esc(row[0])}${n > 1 || x.retired?.length ? ` <span class="meta">${esc(what)}</span>` : ''}</div></div></td>${row.slice(1).map(c => `<td class="num">${esc(c)}</td>`).join('')}</tr>${n > 1 || x.retired?.length ? runRows(x, i) : ''}`;
  }).join('');
  const foot = r.foot.map(row => `<tr class="strong"><td class="grow strong">${esc(row[0])}</td>${row.slice(1).map(c => `<td class="num">${esc(c)}</td>`).join('')}</tr>`).join('');
  const retiredAlone = (t.retired || []).length ? `<div class="meta sum-total">Retired, not counted: ${(t.retired).map(u => `${esc(u.label)} (retired ${esc(dayText(u.at))}${u.scenario ? `, scenario ${esc(u.scenario)}` : ''})`).join('; ')}</div>` : '';
  return `<div class="panel-body tight">${tableRegion({ label: 'Search summary', html: `<table class="cl sum-table">
      <thead><tr><th class="grow">${esc(r.head[0])}</th>${r.head.slice(1).map(h => `<th class="num">${esc(h)}</th>`).join('')}</tr></thead>
      <tbody>${body}${foot}</tbody></table>` })}
      <div class="meta sum-total">${esc(COUNTING)}${r.retiredFound ? ` ${esc(NOT_COUNTED)}: ${r.retiredFound}.` : ''}${t.unattributed.length ? ` ${t.unattributed.length} included ${t.unattributed.length === 1 ? 'study has' : 'studies have'} no source recorded.` : ''}</div>${retiredAlone}</div>`;
}

/** Opens and closes a database's runs (the table in Reporting and in Tables and figures). */
export function wireSummaryRuns(root) {
  root.querySelectorAll('[data-sum-open]').forEach(b => b.onclick = () => {
    const open = b.getAttribute('aria-expanded') !== 'true';
    b.setAttribute('aria-expanded', String(open));
    b.innerHTML = icon(open ? 'chevron-down' : 'chevron-right', { size: 14 });
    root.querySelectorAll(`[data-sum-of="${b.dataset.sumOpen}"]`).forEach(tr => { tr.hidden = !open; });
  });
}

export function wireSummary(el, opts = {}) {
  wireSummaryRuns(el);
  const note = text => { const n = el.querySelector('#rp-note'); if (n) n.textContent = text; };
  const button = el.querySelector('#sum-download');
  button?.addEventListener('click', () => showMenu(button, summaryMenu(note, opts)));
}

/**
 * The summary's downloads: CSV, the Word appendix and a copy as Markdown; `note(text)` says what was done. `source` is the project it
 * reads (a protocol scenario's view, lib/scenarios.mjs), and `suffix` ends each file's name (the scenario's).
 */
export function summaryMenu(note = () => {}, { source = get, suffix = '' } = {}) {
  const rep = () => searchSummary(source());
  const word = async () => {
    const blob = await writeDocx({ blocks: toBlocks(rep(), title(source())), section: null, styles: null, renderCite: () => '', renderResult: () => null, references: [] });
    await saveFile(blob, `search-summary${suffix}.docx`, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  };
  return [
    { label: 'CSV', icon: 'download', run: () => downloadCsv(toCsvRows(rep()), `search-summary${suffix}.csv`) },
    { label: 'Word appendix', icon: 'download', run: word },
    '-', { label: 'Copy summary', icon: 'copy', run: async () => note(await copyText(toMarkdown(rep(), title(source()))) ? 'Search summary copied' : 'Could not copy') },
  ];
}
