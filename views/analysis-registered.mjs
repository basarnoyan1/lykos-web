// An analysis run made outside Lykos by the project's own scripts and registered (tools/lykos-register.mjs analysis, change op
// register_output; lib/review-state.mjs externalOutputs): the Analysis page lists it first and shows it as read. 1 Nov 2026: the sham review's
// Overview said "6 analyses" from the registered run while the Analysis page said "Pooled effect, Not set up". A reading page on one text
// edge (views/manuscript-registered.mjs has the same rows): the run's date and file, whether the data changed since, its analyses, its
// figures and its scripts.
import { lib_html$esc as esc } from "../boot.mjs";
import { lib_icons$icon as icon } from "../boot.mjs";
import { lib_ui_components$hangRow as hangRow } from "../boot.mjs";
import { lib_dates$when as when, lib_dates$plural as plural } from "../boot.mjs";
import { externalOutputs } from '../lib/review-state.mjs';
import { lib_ui_actions$uiList as uiList, lib_ui_actions$uiRow as uiRow } from "../boot.mjs";
import { lib_ui_components$uiLink as uiLink } from "../boot.mjs";
import { headlines } from '../lib/analysis-headlines.mjs';
import { outputsOfRun } from '../lib/trace-links.mjs';
import { lib_projects$activeFolder as activeFolder } from "../boot.mjs";

/** The registered analysis run with what changed after it was built, or null. */
export const registeredAnalysis = (s, now = Date.now()) => externalOutputs(s, undefined, now).analysis || null;

const base = f => String(f || '').split('/').pop();
const section = (id, title, body) => body ? `<section class="msr-sec" aria-labelledby="anr-${id}-h"><h3 class="msr-h" id="anr-${id}-h">${esc(title)}</h3>${body}</section>` : '';
// a path in the folder opens in Files; a table or figure opens in Tables and figures (wired by mountRegisteredAnalysis)
const fileLink = (label, path, attr, title, find = '') => uiLink({ label, title, attrs: { [attr]: true, 'data-path': path, 'data-find': find } });
const outputRow = o => uiRow({ depth: 1, attrs: { 'data-an-of': o.id }, main: { html: uiLink({ label: o.title, title: `Open the ${o.kind}`, attrs: { 'data-an-output': o.id } }) } });

/**
 * The page for a registered run `e` (registeredAnalysis), on the day `now`. `text` is the results file's text (the rows then carry what
 * each analysis found, lib/analysis-headlines.mjs); `outputs` the tables and figures made from the run (lib/trace-links.mjs outputsOfRun).
 */
export function registeredAnalysisHtml(e, now = Date.now(), { text = null, outputs = null } = {}) {
  if (!e) return '';
  const folder = String(e.file || '').split('/').slice(0, -1).join('/');
  const facts = [['Run', e.ran ? when(e.ran, now) : ''], ['Results', e.file ? fileLink(e.file, e.file, 'data-an-file', 'Open the results in Files') : ''],
    ['Folder', folder ? fileLink(folder, folder, 'data-an-dir', 'Open the folder in Files') : ''], ['Scripts', e.scripts ? `${e.scripts}${e.scriptFiles ? `, ${plural(e.scriptFiles, 'file')}` : ''}` : '']].filter(([, v]) => v);
  const status = e.stale
    ? hangRow({ tag: 'p', cls: 'msr-status', attrs: 'data-tone="working"', mark: icon('clock', { size: 12 }), body: esc(`Data changed since the run: ${e.after.text}`) })
    : hangRow({ tag: 'p', cls: 'msr-status', attrs: 'data-tone="finished"', mark: icon('check', { size: 12 }), body: 'Run on the data as it is now' });   // as the manuscript's registered page draws it: the mark in its own column, not against the words
  const head = `<header class="msr-intro">${hangRow({ tag: 'h2', cls: 'msr-title', mark: icon('analysis', { size: 14 }), body: esc(`Analysis run of ${e.ran ? when(e.ran, now) : base(e.file)}`) })}
    <dl class="msr-facts">${facts.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${k === 'Results' || k === 'Folder' ? v : esc(v)}</dd></div>`).join('')}</dl>${status}</header>`;
  const found = text ? headlines(text, e.sections) : {};
  const analyses = (e.sections || []).flatMap(name => {
    const h = found[name], made = outputs?.bySection?.[name] || [];
    return [uiRow({ attrs: { 'data-an-section': name, 'data-path': e.file, 'data-find': h?.heading || name },
      main: { html: fileLink(name, e.file, 'data-an-file', 'Open this section of the results in Files', h?.heading || name), detail: h ? [esc(h.text), esc(h.trials)] : [] } }), ...made.map(outputRow)];
  });
  const analysesList = analyses.length ? uiList({ id: 'anr-analyses', label: 'Analyses', rows: analyses }) : '';
  const other = (outputs?.other || []).map(outputRow);
  const otherList = other.length ? uiList({ id: 'anr-other', label: 'Also made from this run', rows: other }) : '';
  const figures = (e.figures || []).length ? uiList({ id: 'anr-figures', label: 'Figures', rows: e.figures.map(f => uiRow({ attrs: { 'data-an-figure': f }, main: { html: fileLink(base(f), f, 'data-an-file', `Open ${f} in Files`) } })) }) : '';
  return `<div class="msr ui-hang">${head}${section('analyses', 'Analyses', analysesList)}${section('other', 'Also made from this run', otherList)}${section('figures', 'Figures', figures)}</div>`;
}

const dec = new TextDecoder();
let last = null;   // the results text read last: { file, size, text }, so a second visit draws its rows whole at once

/** Draws the page on `el` for the project state `s`, reads the results file from the folder to put each analysis's headline on its row, and wires the links. */
export function mountRegisteredAnalysis(el, ctx, s) {
  const e = registeredAnalysis(s);
  if (!e) { el.innerHTML = ''; return; }
  const outputs = outputsOfRun(s, e.file, e.sections || []);
  const draw = text => { el.innerHTML = registeredAnalysisHtml(e, Date.now(), { text, outputs }); };
  draw(last?.file === e.file && last.size === e.size ? last.text : null);
  const folder = activeFolder();
  if (folder?.read && e.file) folder.read(e.file).then(bytes => {
    const text = dec.decode(bytes);
    if (last?.file === e.file && last.text === text) return;
    last = { file: e.file, size: e.size, text };
    if (el.isConnected) draw(text);
  }).catch(() => {});
  el.onclick = async ev => {
    const hit = ev.target.closest?.('[data-an-output], [data-an-file], [data-an-dir], [data-an-section]');
    if (!hit || !el.contains(hit)) return;
    if (hit.dataset.anOutput) { const m = await import('./outputs.mjs'); m.openResult(hit.dataset.anOutput); ctx.go?.('outputs'); return; }
    const row = hit.closest('[data-an-section]'), path = hit.dataset.path || row?.dataset.path, find = hit.dataset.find || row?.dataset.find || '';
    if (!path) return;
    const files = await import('./files.mjs');
    ctx.go?.('files');
    files.show(path, hit.dataset.anDir !== undefined ? { dir: true } : find ? { find } : {});
  };
}
