// Protocol › Scenarios (spec docs/superpowers/specs/2026-11-01-protocol-scenarios-design.md, Goal 4; the design the owner approved on 2 Nov 2026).
// A list of the scenarios, each with what it changes in one line and its studies against main's ("2 → 35 studies", "+33"); scenarios whose flow is
// main's at every step are named in one quiet line under it. Under the list, for the selected scenario: four steps, each with a thin bar for main and
// one for the scenario (square-root widths, so small steps stay visible) and "38 → 37"; then the studies it adds and drops, each opening the record.
// Selecting a row redraws only what is under the list. Every number is lib/scenario-compare.mjs's (prismaData and scenarioPrisma, as Reporting ›
// Flow shows them; studiesDiff from review-counts), none of its own.
import { store$get as get } from "../boot.mjs";
import { lib_html$esc as esc, lib_html$emptyState as emptyState } from "../boot.mjs";
import { lib_ui_actions$uiList as uiList, lib_ui_actions$uiRow as uiRow, lib_ui_actions$uiRowEnd as uiRowEnd, lib_ui_actions$watchWidth as watchWidth } from "../boot.mjs";
import { scenarioFlow, studiesDiff, changeLine } from '../lib/scenario-compare.mjs';
import { scenarioView } from '../lib/scenarios.mjs';
import { scenarioBranch } from '../lib/scenario-prisma.mjs';
import { lib_review_studies$liveVersion as liveVersion } from "../boot.mjs";
import { lib_menu$showMenu as showMenu } from "../boot.mjs";
import { derive } from '../lib/prisma-counts.mjs';
import { scenariosOf, MAIN_PROTOCOL } from '../lib/scenario-runs.mjs';
import { currentScenario, pickScenario } from '../lib/scenario-pick.mjs';

const list = v => Array.isArray(v) ? v : [];
// the four steps the page shows, of scenarioFlow's five
const STEPS = [['identified', 'Identified'], ['screened', 'Screened'], ['eligible', 'Full texts assessed'], ['included', 'Studies included']];
const SHOWN = 10;   // a long list of studies shows this many until Show all
const PAIR = 560;   // the width two lists of studies need side by side (two of the list's text floor and the gap), as Reporting's flow pairs its columns
const fmt = n => Number(n || 0).toLocaleString('en-US');
const both = xs => (xs.length > 1 ? `${xs.slice(0, -1).join(', ')} and ${xs.at(-1)}` : xs[0]);
const signed = d => (d > 0 ? `+${fmt(d)}` : d < 0 ? `−${fmt(-d)}` : '');
const recordOf = (s, id) => [...list(s.papers), ...list(s.scenarioPapers)].find(p => p?.id === id);

let chosen = null;          // the selected scenario, for this window
let all = { adds: false, drops: false };   // Show all, per list, for the selected scenario

/**
 * The scenarios that change something (a step differs from main's, or its own decisions gain or drop studies: final review I2) and those whose
 * result is main's throughout.
 */
function lanesOf(s) {
  const lanes = scenarioFlow(s).lanes.slice(1);
  const differs = l => l.steps.some(t => t.delta) || (d => d.gained.length + d.lost.length > 0)(studiesDiff(s, l.id));
  return { rows: lanes.filter(differs), same: lanes.filter(l => !differs(l)) };
}
/**
 * Before the numbers are worked out (the first open right after a project loads): the rows from the protocol alone. A scenario whose flow
 * never branches (no search, criterion or decision of its own) is main's; every other is a row, its numbers to come.
 */
function lanesAhead(s) {
  const all = scenariosOf(s).map(x => ({ id: x.id, name: x.name || x.id, steps: null })), same = all.filter(l => !scenarioBranch(s, l.id).step);
  return { rows: all.filter(l => !same.includes(l)), same };
}
/** Whether this version's numbers are worked out (warmScenarios finished for it). */
let warmed = { s: null, v: null };
const isWarm = s => warmed.s === s && warmed.v === liveVersion(s) && typeof warmed.v === 'number';
/** The selected row: the one chosen here, else the scenario picked in the title bar, else the first. */
function selectedOf(s, rows) {
  const ids = rows.map(l => l.id), picked = currentScenario(s);
  return ids.includes(chosen) ? chosen : picked !== MAIN_PROTOCOL && ids.includes(picked) ? picked : ids[0] || null;
}

// ---- the list ---------------------------------------------------------------------------------------------------------------------------

function scenarioRow(s, lane, on) {
  // ahead of its numbers (lanesAhead) the cell is drawn empty at its width, filled once they are worked out
  const inc = lane.steps?.find(t => t.step === 'included'), main = inc ? inc.n - inc.delta : 0;
  return uiRow({ cls: 'scn-row', attrs: { 'data-scn-row': lane.id, tabindex: '0', 'aria-current': on ? 'true' : 'false' },
    main: { html: `<span class="scn-name">${esc(lane.name)}</span>`, detail: [changeLine(s, lane.id)], wrap: true },
    cells: [{ col: 'studies', kind: 'text', ch: 16, html: inc ? `<span class="scn-num">${fmt(main)} → ${fmt(inc.n)} ${inc.n === 1 ? 'study' : 'studies'}</span><span class="scn-diff">${inc.delta ? signed(inc.delta) : 'no change'}</span>` : '<span class="scn-num">\u00a0</span><span class="scn-diff">\u00a0</span>' }],
    end: uiRowEnd({ reserve: true }) });
}

// ---- the selected scenario --------------------------------------------------------------------------------------------------------------

function stepRow(t, top) {
  const main = t.n - t.delta, w = n => (top ? Math.sqrt(n / top) : 0).toFixed(4);
  return uiRow({ table: true, attrs: { 'data-scn-step': t.step }, main: { html: esc(STEPS.find(([k]) => k === t.step)[1]) },
    cells: [{ col: 'bars', kind: 'visual', html: `<span class="scn-meters" aria-hidden="true"><span class="scn-meter-main" data-w="${w(main)}"></span><span class="scn-meter-own" data-w="${w(t.n)}"></span></span>` },
      { col: 'n', kind: 'text', ch: 14, html: `<span class="scn-num">${fmt(main)} → ${fmt(t.n)}</span><span class="scn-diff">${t.delta ? signed(t.delta) : 'same'}</span>` }],
    end: uiRowEnd({ reserve: true }) });
}

function studies(s, ids, key, title) {
  const shown = all[key] ? ids : ids.slice(0, SHOWN);
  // a study it adds is extracted from here (spec Settled 7, final review I6): its values go to the one pool, keyed by its id
  const end = (id, p) => (key === 'adds' ? uiRowEnd({ primary: { id: `scn-extract-${id}`, label: 'Extract', attrs: { 'data-scn-extract': id } }, more: { label: `More for ${p?.label || id}`, attrs: { 'data-scn-more': id } } }) : uiRowEnd({ reserve: true }));
  const rows = shown.map(id => { const p = recordOf(s, id); return uiRow({ attrs: { 'data-scn-open': id, tabindex: '0' }, main: { html: esc(p?.label || id) }, end: end(id, p) }); });
  return `<section class="scn-studies" aria-label="${esc(title)}"><h3 class="scn-h">${esc(title)} <span class="scn-count">${fmt(ids.length)}</span></h3>
    ${uiList({ id: `scn-${key}`, label: title, rows, empty: emptyState({ title: 'None', size: 'inline' }) })}
    ${ids.length > SHOWN && !all[key] ? `<button type="button" class="ui-link scn-more" data-scn-all="${key}">Show all ${fmt(ids.length)}</button>` : ''}</section>`;
}

/** What is under the list: the selected scenario's name and change line, its four steps against main's, and the studies it adds and drops. */
export function scenarioSection(s, id) {
  const lane = scenarioFlow(s).lanes.find(l => l.id === id);
  if (!lane) return '';
  const steps = STEPS.map(([k]) => lane.steps.find(t => t.step === k)), top = Math.max(1, ...steps.flatMap(t => [t.n, t.n - t.delta]));
  const d = studiesDiff(s, id);
  // main's numbers here are counted as the scenario's are, from its branch on (final review I3); where main reports another by hand, say so
  const hand = steps.filter(t => t.reported != null && t.base != null && t.reported !== t.base);
  const gap = hand.length ? `<p class="meta scn-gap">Main reports ${both(hand.map(t => `${fmt(t.reported)} ${STEPS.find(([k]) => k === t.step)[1].toLowerCase()}`))}; its records give ${both(hand.map(t => fmt(t.base)))}, the numbers compared here.</p>` : '';
  return `<div class="scn-intro"><h2 class="scn-h">${esc(lane.name)}</h2><p class="meta scn-line">${esc(changeLine(s, id))}</p>
      <p class="meta scn-legend"><span class="scn-key scn-key-main" aria-hidden="true"></span>Main <span class="scn-key scn-key-own" aria-hidden="true"></span>This scenario</p></div>
    ${uiList({ id: 'scn-steps', label: `Steps, ${lane.name} against main`, cols: ['bars'], grow: 1, rows: steps.map(t => stepRow(t, top)) })}${gap}
    <div class="scn-pair">${studies(s, d.gained, 'adds', 'Studies it adds')}${studies(s, d.lost, 'drops', 'Studies it drops')}</div>`;
}

/** The part: the empty state, or the list of scenarios and, under it, the selected one. */
export function scenariosPanel(s) {
  if (!scenariosOf(s).length) return `<div class="panel"><div class="panel-body">${emptyState({ icon: 'branch', title: 'No scenarios', detail: 'A scenario varies the protocol\'s searches or criteria and reuses every decision it can.', help: true })}</div></div>`;
  // the first open right after a project loads, before warmScenarios has worked the numbers out: the list first, its numbers on the next tasks
  const ahead = typeof liveVersion(s) === 'number' && !isWarm(s);
  const { rows, same } = ahead ? lanesAhead(s) : lanesOf(s), on = selectedOf(s, rows);
  return `<div class="panel"><div class="panel-body"${ahead ? ' data-scn-ahead' : ''}>
    ${rows.length ? uiList({ id: 'scn-list', label: 'Scenarios', rows: rows.map(l => scenarioRow(s, l, l.id === on)) }) : ''}
    ${same.length ? `<p class="meta scn-same">Same result as the main protocol: ${esc(same.map(l => l.name).join(', '))}</p>` : ''}
    <div class="scn-detail" data-scn-detail>${on && !ahead ? scenarioSection(s, on) : ''}</div>
  </div></div>`;
}

/** The scenario whose section shows (Rename and Delete scenario on this part act on it), or null. */
export function selectedScenario(s) {
  if (!scenariosOf(s).length) return null;
  return selectedOf(s, (isWarm(s) || typeof liveVersion(s) !== 'number' ? lanesOf(s) : lanesAhead(s)).rows);
}

/**
 * The views and flows the Scenarios part reads, computed ahead one scenario's piece per task (each well under 50 ms on Sham's 30,208 records), so
 * opening the part reads them from the per-version caches: in idle time once a project with scenarios loads (app.mjs) and while another part of
 * Protocol shows. `done` runs once this version's numbers are all worked out. A project without scenarios schedules nothing.
 */
let warming = null, waiting = [];
export function warmScenarios(s, done = null) {
  const ids = scenariosOf(s).map(x => x.id);
  if (!ids.length) return;
  if (done) waiting.push(done);
  if (warming) return;
  const v = liveVersion(s);
  if (isWarm(s)) { const w = waiting; waiting = []; w.forEach(f => f()); return; }
  const steps = [...ids.flatMap(id => [() => scenarioView(get(), id), () => derive(scenarioView(get(), id)), () => studiesDiff(get(), id)]), () => scenarioFlow(get())];
  const next = () => {
    const f = steps.shift();
    // another version: start again from it (the numbers shown must be this version's)
    if (get() !== s || liveVersion(s) !== v) { warming = null; if (waiting.length) warmScenarios(get()); return; }
    if (!f) { warming = null; warmed = { s, v }; const w = waiting; waiting = []; w.forEach(g => g()); return; }
    try { f(); } catch { warming = null; waiting = []; return; }
    warming = setTimeout(next, 0);
  };
  warming = setTimeout(next, 0);
}

let release = null;
/** Wires the part: a row selects its scenario (only what is under the list is drawn again); a study opens in Screening as the scenario sees it. */
export function wireScenarios(el, ctx) {
  // drawn ahead of its numbers: they are worked out on the next tasks, then the panel is drawn again with them (the rows keep their places)
  if (el.querySelector('[data-scn-ahead]')) warmScenarios(get(), () => {
    const part = el.querySelector('[data-part="scenarios"]');
    if (!part?.querySelector('[data-scn-ahead]')) return;   // drawn again since, or another part
    part.innerHTML = scenariosPanel(get()); wireScenarios(el, ctx);
  });
  const listEl = el.querySelector('#scn-list'), detail = el.querySelector('[data-scn-detail]');
  if (!detail) return;
  const bars = () => {
    detail.querySelectorAll('[data-w]').forEach(b => b.style.setProperty('--w', b.dataset.w));   // no inline style (the app's CSP)
    const pair = detail.querySelector('.scn-pair');
    if (pair) pair.dataset.cols = String(Math.min(2, 1 + Math.floor(detail.getBoundingClientRect().width / PAIR)));
  };
  release?.(); release = watchWidth(detail, bars);
  const draw = id => { detail.innerHTML = scenarioSection(get(), id); bars(); };
  const select = id => {
    if (!id) return;
    chosen = id; all = { adds: false, drops: false };
    listEl?.querySelectorAll('[data-scn-row]').forEach(r => r.setAttribute('aria-current', String(r.getAttribute('data-scn-row') === id)));
    draw(id);
  };
  const shown = () => chosen || el.querySelector('#scn-list [aria-current=true]')?.getAttribute('data-scn-row');
  const open = async id => { pickScenario(shown()); (await import('./screening.mjs')).focusRecords([id]); ctx.go('screening'); };
  // Extraction lists the picked scenario's added studies beside main's (views/extraction.mjs), from the study's first cell
  const extract = async id => { pickScenario(shown()); (await import('./extraction.mjs')).focusPaper(id); ctx.go('extraction'); };
  const act = e => {
    const row = e.target.closest('[data-scn-row]'), study = e.target.closest('[data-scn-open]'), more = e.target.closest('[data-scn-all]');
    const ex = e.target.closest('[data-scn-extract]'), menu = e.target.closest('[data-scn-more]');
    if (ex) extract(ex.getAttribute('data-scn-extract'));
    else if (menu) { const id = menu.getAttribute('data-scn-more'); showMenu(menu, [{ label: 'Open in Screening', run: () => open(id) }, { label: 'Extract', run: () => extract(id) }], { align: 'end' }); }
    else if (more) { all[more.getAttribute('data-scn-all')] = true; draw(shown()); }
    else if (study) open(study.getAttribute('data-scn-open'));
    else if (row) select(row.getAttribute('data-scn-row'));
  };
  // once per element: a panel drawn again with its numbers is wired again
  el.__scnAct = act;
  if (!el.__scnWired) {
    el.__scnWired = true;
    el.addEventListener('click', e => el.__scnAct(e));
    el.addEventListener('keydown', e => { if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('[data-scn-row], [data-scn-open]') && !e.target.closest('button')) { e.preventDefault(); el.__scnAct(e); } });
  }
  bars();
}
