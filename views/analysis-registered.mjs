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

/** The registered analysis run with what changed after it was built, or null. */
export const registeredAnalysis = (s, now = Date.now()) => externalOutputs(s, undefined, now).analysis || null;

const base = f => String(f || '').split('/').pop();
const row = (name, value = '', tip = '') => hangRow({ tag: 'li', cls: 'msr-row', attrs: tip ? `title="${esc(tip)}"` : '',
  body: `<span class="msr-name">${esc(name)}</span>${value ? `<span class="msr-value">${esc(value)}</span>` : ''}` });
const section = (id, title, rows) => rows.length
  ? `<section class="msr-sec" aria-labelledby="anr-${id}-h"><h3 class="msr-h" id="anr-${id}-h">${esc(title)}</h3><ul class="msr-list">${rows.join('')}</ul></section>` : '';

/** The page for a registered run `e` (registeredAnalysis), on the day `now`. */
export function registeredAnalysisHtml(e, now = Date.now()) {
  if (!e) return '';
  const folder = String(e.file || '').split('/').slice(0, -1).join('/');
  const facts = [['Run', e.ran ? when(e.ran, now) : ''], ['Results', e.file], ['Folder', folder], ['Scripts', e.scripts ? `${e.scripts}${e.scriptFiles ? `, ${plural(e.scriptFiles, 'file')}` : ''}` : '']].filter(([, v]) => v);
  const status = e.stale
    ? `<p class="msr-status" data-tone="working">${icon('clock', { size: 12 })}<span>${esc(`Data changed since the run: ${e.after.text}`)}</span></p>`
    : `<p class="msr-status" data-tone="finished">${icon('check', { size: 12 })}<span>Run on the data as it is now</span></p>`;
  const head = `<header class="msr-intro">${hangRow({ tag: 'h2', cls: 'msr-title', mark: icon('analysis', { size: 14 }), body: esc(`Analysis run of ${e.ran ? when(e.ran, now) : base(e.file)}`) })}
    <dl class="msr-facts">${facts.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>${status}</header>`;
  return `<div class="msr ui-hang">${head}${section('analyses', 'Analyses', (e.sections || []).map(x => row(x)))}${section('figures', 'Figures', (e.figures || []).map(f => row(base(f), '', f)))}</div>`;
}
