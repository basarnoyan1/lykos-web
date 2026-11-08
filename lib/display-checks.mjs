// Display-item checks: the tables and figures of a manuscript checked before they go out (display-item checks amendment, 2 Nov 2026).
//
// Five areas, each check a plain sentence with where to fix it:
//   accuracy     every number a rendered file shows is what the record gives now, at the precision shown (the file's CSV against the
//                output rendered again; a figure's drawn "estimate (lower to upper)" against its rows); intervals in order (lower ≤ estimate ≤
//                upper, a prediction interval around its confidence interval); a pooled row's "(k trials, n outcomes)" equal to the rows it
//                pools; a percent equal to its count over its denominator; units and direction consistent with the values; a value drawn at
//                the axis edge named in the legend
//   place        which items earn the main text: the journal's display-item limit and each item's role (flow, primary forest, characteristics,
//                benchmark or summary of findings, risk of bias first; a subgroup or moderator item with nothing meeting the protocol's
//                association rule to the supplement; listings always there); items whose numbers repeat another's
//   statistics   pooled with fewer than 3 studies, a prediction interval with fewer than 3, a subgroup level of 1 study, a CR2 test on fewer than 4
//                df presented as significant, Egger with fewer than 10 studies, percentages of tiny denominators, studies of one overlap group
//                drawn as separate rows
//   size         the journal's page box (Neurology 6.8 × 8.5 in), the smallest text after scaling, rows per page, an axis stretched by
//                outliers, a table wider or longer than its page, raster resolution
//   readability  one font, no decorative colour, no subtitle in a title, no dot-separated strings
//
// A check is { key, id, place, area, check, state: pass | fail | warn | proposal, message, fix, autofix? }. An autofix is only what is safe
// and deterministic: a spec change (axis limits, rows per page) saved as a new version of the output. Placement is a proposal; nothing here
// moves or changes an item. Pure over the project state and the items' files: the MCP server, the build and the views share it.
import { renderOutput, chartSvg, outputCsv } from './output-render.mjs';
import { figureTokens } from './figure-style.mjs';
import { figureContent, lowerCaseLabels, lowerCaseStart, hyphenMinus, mixedDecimals, mixedColumnDecimals } from './figure-lint.mjs';
import { runQuery } from './project-query.mjs';
import { niceTicks } from './output-charts.mjs';

export const RULES = Object.freeze({ minPool: 3, minPI: 3, minSubgroup: 2, minDf: 4, eggerK: 10, minDenominator: 10, minPt: 7, minDpi: 300,
  stretch: 2.5, mainTableRows: 40, tableChars: 110, overlapShare: 0.8, alpha: 0.05 });
export const AREAS = ['accuracy', 'place', 'statistics', 'size', 'readability'];
export const AREA_LABEL = { accuracy: 'Accuracy', place: 'Place', statistics: 'Statistics', size: 'Size and layout', readability: 'Readability' };

const num = v => (v == null || v === '' ? null : Number.isFinite(Number(v)) ? Number(v) : null);
const clean = s => String(s ?? '').replace(/\s+/g, ' ').trim();
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
/** Notes with a sentence added before their closing "Source: …" sentence, else at the end. */
const withSentence = (notes, sentence) => { const t = String(notes || '').trim(), i = t.search(/\s+Source:\s/); return !t ? sentence : i < 0 ? `${t} ${sentence}` : `${t.slice(0, i)} ${sentence}${t.slice(i)}`; };
const listed = a => (a.length < 2 ? a.join('') : `${a.slice(0, -1).join('; ')} and ${a.at(-1)}`);
const CASE_FIX = 'Write category labels in sentence case, acronyms kept (one label map for the figures and tables)', DECIMALS_FIX = 'Print the same number of decimals down a column (set decimals in the spec)';
const decimals = s => (String(s).split('.')[1] || '').length;
const roundTo = (x, d) => { const r = Math.round(x * 10 ** d) / 10 ** d; return Object.is(r, -0) ? 0 : r; };
const sameAt = (shown, value) => value != null && Math.abs(roundTo(value, decimals(shown)) - Number(shown)) < 10 ** -decimals(shown) / 2 + 1e-9;

// ---- places and roles ---------------------------------------------------------------------------------------------------------------
/** "Figure 2", "eTable 3", "Figure S1." from a place or a title: { label, kind: table | figure, main, n }; null when it names none. */
export function parsePlace(text) {
  const m = /^\s*(e|supplementa(?:l|ry)\s+)?(table|figure|fig\.?)\s*(S)?\s*(\d+)/i.exec(String(text || ''));
  if (!m) return null;
  const kind = /^t/i.test(m[2]) ? 'table' : 'figure', main = !m[1] && !m[3];
  return { label: `${main ? '' : 'e'}${kind === 'table' ? 'Table' : 'Figure'} ${m[4]}`, kind, main, n: Number(m[4]) };
}
const synthCode = spec => (/Synthesis\s*(?:=|in)\s*([A-Za-z0-9:|_-]+)/.exec(spec?.query?.where || '')?.[1] || '').split('|')[0];
/**
 * What an item is for: flow, primary, characteristics, benchmark, sof, rob, secondary, subgroup, moderator, sensitivity, funnel, listing, other.
 * Read from the spec (its source, its synthesis, its chart type) and its title; `primary` names the synthesis codes of the review's primary
 * question (default the change synthesis's primary pool, SMCR, and its one-row-per-trial form).
 */
export function itemRole(item, { primary = ['SMCR', 'SMCR-TRIAL'] } = {}) {
  if (item.kind === 'flow') return 'flow';
  const spec = item.spec || {}, t = String(spec.title || item.title || ''), type = spec.chart?.type, from = spec.query?.from, code = synthCode(spec);
  if (type === 'traffic-light' || type === 'rob-summary' || from === 'assessments' || /risk of bias/i.test(t)) return 'rob';
  if (type === 'funnel' || code === 'FUNNEL' || /funnel/i.test(t)) return 'funnel';
  if (/excluded|awaiting|not retrieved/i.test(t) || from === 'screening' || (from === 'records' && /full.?text/i.test(t))) return 'listing';
  if (from === 'certainty' || /summary of findings|GRADE/i.test(t)) return 'sof';
  if (from === 'effects' || from === 'syntheses') {
    if (primary.includes(code)) return 'primary';
    if (/^(SUBGROUPS|G:)/.test(code) || /subgroup/i.test(t)) return 'subgroup';
    if (/^MR/.test(code) || /meta-regression|moderator/i.test(t)) return 'moderator';
    if (code === 'BENCH' || /benchmark/i.test(t)) return 'benchmark';
    if (/^(SENS|LOO|P)$/.test(code) || /sensitivity|leave-one/i.test(t)) return 'sensitivity';
    return 'secondary';
  }
  if (/meta-regression|moderator/i.test(t)) return 'moderator';
  if (/subgroup/i.test(t)) return 'subgroup';
  if (/sensitivity|leave-one/i.test(t)) return 'sensitivity';
  if (from === 'studies' || from === 'arms' || !from) return spec.kind === 'table' || /characteristic|included (trials|studies)/i.test(t) ? 'characteristics' : 'other';
  return 'other';
}
// The main text's order of need: what a reader of a systematic review expects first (PRISMA 2020 items 16a, 17, 20, 18, 22).
const NEED = { flow: 1, primary: 1, characteristics: 2, benchmark: 2, sof: 3, rob: 4, secondary: 5, other: 6, moderator: 7, subgroup: 7, sensitivity: 8, funnel: 9, listing: 99 };
const ROLE_WORDS = { flow: 'the study flow (PRISMA 2020 item 16a)', primary: 'the primary synthesis', characteristics: 'the included studies (item 17)',
  benchmark: 'the result by class', sof: 'the summary of findings (item 22)', rob: 'risk of bias (item 18)', secondary: 'a secondary synthesis', moderator: 'meta-regression',
  subgroup: 'subgroup analyses', sensitivity: 'sensitivity analyses', funnel: 'small-study effects', other: 'a descriptive item', listing: 'a listing of records' };

// ---- the journal --------------------------------------------------------------------------------------------------------------------
/** "Each figure legible within 6.8 × 8.5 inches" -> { w: 6.8, h: 8.5 } (inches; mm and cm converted). */
export function pageBoxOf(text) {
  const m = /(\d+(?:\.\d+)?)\s*(?:in(?:ches)?\s*)?[×x]\s*(\d+(?:\.\d+)?)\s*(in|inch|inches|mm|cm)\b/i.exec(String(text || ''));
  if (!m) return null;
  const k = /mm/i.test(m[3]) ? 1 / 25.4 : /cm/i.test(m[3]) ? 1 / 2.54 : 1;
  return { w: Math.round(Number(m[1]) * k * 100) / 100, h: Math.round(Number(m[2]) * k * 100) / 100 };
}
/** The journal's display limits from its preset and profile (lib/journal-context.mjs journalContext): { name, limit, page, minDpi, minPt }. */
export function journalLimits(ctx = {}) {
  const p = ctx.preset || null, prof = ctx.profile || null, f = p?.figures || {};
  return { name: ctx.journal || p?.label || '', limit: prof?.figureTableLimit ?? null, page: f.page || pageBoxOf(f.size) || null, minDpi: f.minDpi ?? null, minPt: f.minPt ?? null };
}

// ---- reading what an item shows -----------------------------------------------------------------------------------------------------
export const csvRows = text => {
  const out = []; let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') q = false; else cell += c; continue; }
    if (c === '"') q = true; else if (c === ',') { row.push(cell); cell = ''; } else if (c === '\n') { row.push(cell); out.push(row); row = []; cell = ''; } else if (c !== '\r') cell += c;
  }
  if (cell || row.length) { row.push(cell); out.push(row); }
  return out;
};
const TRIPLE = /(-?\d+(?:\.\d+)?)\s*\((-?\d+(?:\.\d+)?)\s*(?:to|,|–)\s*(-?\d+(?:\.\d+)?)\)/;
const decode = s => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
/** The drawn marks of a house chart: [{ label, est, lo, hi }] from each mark's title ("Lozano 2016: -2.03 (-2.77 to -1.28)"). */
export function drawnTriples(svg) {
  const out = [];
  for (const m of String(svg || '').matchAll(/<g[^>]*data-chart-mark="([^"]*)"[^>]*>\s*<title>([\s\S]*?)<\/title>/g)) {
    const t = TRIPLE.exec(decode(m[2])); if (t) out.push({ label: decode(m[1]), est: t[1], lo: t[2], hi: t[3] });
  }
  return out;
}
export const svgInches = svg => { const w = /<svg[^>]*\swidth="([\d.]+)in"/.exec(svg || ''), h = /<svg[^>]*\sheight="([\d.]+)in"/.exec(svg || ''); return { w: w ? Number(w[1]) : null, h: h ? Number(h[1]) : null }; };
const fontsOf = svg => new Set([...String(svg || '').matchAll(/font-family="([^"]+)"/g)].map(m => m[1].split(',')[0].trim().replace(/['"]/g, '').toLowerCase()));

/** The export drawing of a chart spec, as the folder writer makes it. */
export function exportSvg(s, spec, m = null) {
  return chartSvg(m || renderOutput(s, spec), { style: figureTokens(null, { medium: 'export' }) });
}

// ---- the checks ---------------------------------------------------------------------------------------------------------------------
/**
 * Checks each item and the set. `items`: [{ id, place?, title?, kind: 'output' | 'flow', spec?, svg? (a flow's drawing), files?: { csv?, svg?,
 * rasters?: [{ path, dpi }] }, renderedAt? }]. `journal`: journalLimits(). `primary`: the primary synthesis codes. `rules`: RULES overrides.
 * `association`: associationOf(model) (null when the review has no moderators).
 * Returns { items: [{ id, place, title, role, main, checks }], set: [checks], proposal: { main, supplement, reasons }, summary }.
 */
export function displayChecks(s, items, { journal = {}, primary, rules = {}, association = null } = {}) {
  const ctx = checkContext({ journal, primary, rules, association }), models = new Map(), out = [], all = [];
  for (const it of items) { const r = checkItem(s, it, ctx, models); out.push(r.row); all.push(...r.checks); }
  return assemble(out, all, models, ctx);
}
/**
 * The same checks as `displayChecks`, an item at a time with `await tick()` between them, so the page between them is free to draw and answer
 * (each item renders its output from the record, which for a fitted synthesis takes seconds on a large review). Items whose source is a fitted
 * synthesis are checked last; the result keeps the items' own order, so it equals displayChecks' exactly.
 */
export async function displayChecksAsync(s, items, { journal = {}, primary, rules = {}, association = null } = {}, tick = () => {}) {
  const ctx = checkContext({ journal, primary, rules, association }), models = new Map();
  const heavy = it => /^(syntheses|effects)$/.test(it.spec?.query?.from || '');
  const order = items.map((it, i) => i).sort((a, b) => (heavy(items[a]) ? 1 : 0) - (heavy(items[b]) ? 1 : 0) || a - b), made = new Array(items.length);
  // tick(done, total, item): the item about to be checked, for a page that shows the run's progress
  let done = 0;
  for (const i of order) { await tick(done++, items.length, items[i]); made[i] = checkItem(s, items[i], ctx, models); }
  // the models were kept in the order checked; the set checks read them by item id, so their order is the items' own
  const byId = new Map(models); models.clear();
  for (const it of items) if (byId.has(it.id)) models.set(it.id, byId.get(it.id));
  await tick();
  return assemble(made.map(r => r.row), made.flatMap(r => r.checks), models, ctx);
}
const checkContext = ({ journal, primary, rules, association }) => ({ R: { ...RULES, ...rules }, journal, primary, association });
function checkItem(s, it, { R, journal, primary }, models) {
  const checks = [], spec = it.spec || null, place = parsePlace(it.place) || parsePlace(spec?.title || it.title);
  const role = itemRole(it, primary ? { primary } : {});
  const where = place?.label || it.place || spec?.title || it.id;
  const add = (area, check, state, message, fix = '', extra = {}) => checks.push({ key: `${it.id}:${check}`, id: it.id, place: place?.label || it.place || '', area, check, state, message, fix, ...extra });
  let m = null; const flags = {};
  if (spec) { try { m = renderOutput(s, spec); models.set(it.id, m); } catch (e) { add('accuracy', 'renders', 'fail', `${where} does not render from the record: ${e.message}`, 'Fix the spec in Tables and figures'); } }
  if (m) itemChecks({ s, it, spec, m, role, place, add, R, journal, where, flags });
  if (it.kind === 'flow' && it.svg) { sizeChecks({ svg: it.svg, place, add, R, journal, where }); rasterChecks(it, add, R, journal); }
  return { row: { id: it.id, place: place?.label || it.place || '', title: spec?.title || it.title || it.id, role, main: place ? place.main : null, oversized: !!flags.oversized, checks }, checks };
}
function assemble(out, all, models, { R, journal, association }) {
  const set = setChecks(out, models, { R, journal, association });
  const every = [...all, ...set.checks], count = st => every.filter(c => c.state === st).length;
  return { items: out, set: set.checks, proposal: set.proposal, summary: { pass: count('pass'), fail: count('fail'), warn: count('warn'), proposal: count('proposal'), checks: every.length } };
}

function itemChecks({ s, it, spec, m, role, place, add, R, journal, where, flags }) {
  const chart = spec.kind === 'chart' ? spec.chart : null;
  // accuracy: the rendered file against the record now, cell by cell as shown
  if (it.files?.csv != null) {
    const now = csvRows(outputCsv(m)), was = csvRows(it.files.csv), diffs = [];
    for (let r = 0; r < Math.max(now.length, was.length); r++) for (let c = 0; c < Math.max(now[r]?.length || 0, was[r]?.length || 0); c++)
      if ((now[r]?.[c] ?? '') !== (was[r]?.[c] ?? '')) diffs.push({ r, now: now[r]?.[c] ?? '', was: was[r]?.[c] ?? '', col: now[0]?.[c] ?? was[0]?.[c] ?? `column ${c + 1}` });
    if (!diffs.length) add('accuracy', 'traces', 'pass', `${where}: every cell of the rendered file is what the record gives now`);
    else {
      const d = diffs[0], rows = now.length !== was.length ? `; ${plural(Math.abs(now.length - was.length), 'row')} ${now.length > was.length ? 'added' : 'gone'}` : '';
      add('accuracy', 'traces', 'fail', `${where} is stale: ${plural(diffs.length, 'cell')} differ from the record${rows} (row ${d.r}, ${d.col}: file "${clean(d.was).slice(0, 40)}", record "${clean(d.now).slice(0, 40)}")`,
        `Render it again (save_output with render)${it.renderedAt ? `; last rendered ${String(it.renderedAt).slice(0, 16).replace('T', ' ')}` : ''}`);
    }
  } else if (it.files) add('accuracy', 'traces', 'warn', `${where} has no rendered CSV to compare with the record`, 'Render it with csv among its formats');
  if (chart && it.files?.svg) {
    const drawn = drawnTriples(it.files.svg), rows = m.chart?.rows || [];
    const bad = drawn.filter(d => !rows.some(r => clean(r.label) === clean(d.label) && sameAt(d.est, r.value) && sameAt(d.lo, r.lo) && sameAt(d.hi, r.hi)));
    if (drawn.length) add('accuracy', 'drawn', bad.length ? 'fail' : 'pass', bad.length ? `${where} draws ${plural(bad.length, 'value')} the record no longer gives: ${bad.slice(0, 3).map(b => `${b.label} ${b.est} (${b.lo} to ${b.hi})`).join('; ')}`
      : `${where}: all ${drawn.length} drawn estimates match their rows at the precision shown`, bad.length ? 'Render it again' : '');
  }
  if (chart?.type === 'forest') forestChecks({ s, spec, m, role, add, R, where });
  if (spec.kind === 'table') tableChecks({ m, add, R, where, place, flags });
  if (spec.query?.from === 'syntheses') synthesisRowChecks({ s, spec, add, R, where });
  if (chart) {
    let svg = it.files?.svg || null;
    try { svg = exportSvg(s, spec, m); } catch { /* the file's own drawing stands */ }
    if (svg) sizeChecks({ svg, place, add, R, journal, where, spec, m, flags });
  }
  rasterChecks(it, add, R, journal);
  // readability: a plain title, no dot-separated strings
  const title = clean(spec.title).replace(/^(e?(table|figure)\s*S?\d+\.?\s*)/i, '');
  if (/:\s+\S/.test(title) || /\s[—–]\s/.test(title)) add('readability', 'subtitle', 'warn', `${where}'s title carries a subtitle ("${title.slice(0, 70)}")`, 'One plain title; the detail goes in the legend or notes');
  else add('readability', 'subtitle', 'pass', `${where}: a plain title`);
  const dots = [spec.title, spec.notes, ...m.groups.flatMap(g => g.cells.flat())].map(x => String(x ?? '')).filter(x => /·/.test(x));
  add('readability', 'dots', dots.length ? 'warn' : 'pass', dots.length ? `${where} has dot-separated strings ("${clean(dots[0]).slice(0, 50)}")` : `${where}: no dot-separated strings`, dots.length ? 'Write them as a sentence or as separate columns' : '');
}

/** The resolution of each PNG the item was exported as. */
function rasterChecks(it, add, R, journal) {
  for (const r of it.files?.rasters || []) {
    const need = journal.minDpi || R.minDpi, name = String(r.path).split('/').pop();
    if (r.dpi == null) add('size', 'dpi', 'warn', `${name} records no resolution`, 'Export it again at 600 dpi (the house export writes pHYs)');
    else add('size', 'dpi', r.dpi >= need ? 'pass' : 'fail', `${name}: ${r.dpi} dpi${r.dpi >= need ? '' : `, below the ${need} dpi needed`}`, r.dpi >= need ? '' : 'Export it again at 600 dpi');
  }
}

const kOf = label => { const t = /\((\d+)\s+(?:trials?|studies)(?:,\s*(\d+)\s+outcomes?)?\)/i.exec(label) || /\((\d+)\/(\d+)\)/.exec(label); return t ? { k: Number(t[1]), n: t[2] != null ? Number(t[2]) : null } : null; };
const trialOf = label => clean(String(label).split(',')[0]);

/** A forest's rows: CI order, PI around CI, k in labels, k too small, subgroup levels, overlap groups, the axis, units. */
function forestChecks({ s, spec, m, role, add, R, where }) {
  const rows = m.chart.rows, c = spec.chart;
  const order = rows.filter(r => r.value != null && r.lo != null && r.hi != null && !(r.lo <= r.value + 1e-9 && r.value <= r.hi + 1e-9));
  add('accuracy', 'ci-order', order.length ? 'fail' : 'pass', order.length ? `${where}: ${plural(order.length, 'row')} with the estimate outside its interval (${order.slice(0, 3).map(r => r.label).join(', ')})` : `${where}: every interval holds its estimate`,
    order.length ? 'Check the spec\'s lower and upper columns (swapped, or another scale)' : '');
  // a row that is itself a pool: marked pooled, or labelled with its k ("Primary (46/99)", a sensitivity or subgroup forest)
  const effects = rows.filter(r => !r.pooled && !r.interval);
  const poolsOnly = effects.some(r => kOf(r.label) || /^without\b/i.test(r.label));
  const groups = [...new Set(rows.map(r => r.group ?? ''))], overall = groups.find(g => /^(all\b|overall)/i.test(g || '')) ?? null;
  const piBad = [], kBad = [], small = [], smallPI = [];
  for (const g of groups) {
    const gr = rows.filter(r => (r.group ?? '') === g), mine = gr.filter(r => !r.pooled && !r.interval);
    gr.forEach((r, i) => {
      const k = kOf(r.label), pi = gr[i + 1]?.interval ? gr[i + 1] : null;
      if (!r.pooled && !(poolsOnly && k)) return;
      const name = `${g && g !== overall ? `${g}: ` : ''}${r.label}`;
      if (pi && r.lo != null && pi.lo != null && !(pi.lo <= r.lo + 1e-9 && pi.hi >= r.hi - 1e-9)) piBad.push(name);
      const pool = g === overall && overall != null ? effects : mine;
      if (r.pooled && k && pool.length && !poolsOnly) {
        const trials = new Set(pool.map(x => trialOf(x.label))).size;
        // a forest of one row per trial names the outcomes its trials combine ("46 trials, 99 outcomes" over 46 rows)
        const ok = k.k === trials && (k.n == null || k.n === pool.length || (pool.length === trials && k.n >= trials));
        if (!ok) kBad.push(`${name}: ${k.k}${k.n != null ? `/${k.n}` : ''} named, ${trials}${k.n != null ? `/${pool.length}` : ''} drawn`);
      }
      const kk = k?.k ?? (!poolsOnly && pool.length ? new Set(pool.map(x => trialOf(x.label))).size : null);
      if (kk != null && kk < R.minPool) small.push(name);
      if (pi && kk != null && kk < R.minPI) smallPI.push(name);
    });
  }
  add('accuracy', 'pi-order', piBad.length ? 'fail' : 'pass', piBad.length ? `${where}: a prediction interval narrower than its confidence interval (${piBad.slice(0, 3).join('; ')})` : `${where}: every prediction interval holds its confidence interval`, piBad.length ? 'Check the synthesis: a PI is never narrower than its CI' : '');
  if (!poolsOnly) add('accuracy', 'counts', kBad.length ? 'fail' : 'pass', kBad.length ? `${where}: pooled labels do not count the rows they pool (${kBad.slice(0, 3).join('; ')})` : `${where}: each pooled row counts the rows it pools`,
    kBad.length ? 'The rows and the synthesis differ: render it again, or check the spec\'s filter' : '');
  add('statistics', 'pool-k', small.length ? 'fail' : 'pass', small.length ? `${where} shows a pooled estimate from fewer than ${R.minPool} studies (${small.slice(0, 3).join('; ')})` : `${where}: every pooled estimate rests on ${R.minPool} or more studies`,
    small.length ? `Leave these unpooled (fewer than ${R.minPool} studies)` : '');
  add('statistics', 'pi-k', smallPI.length ? 'fail' : 'pass', smallPI.length ? `${where} shows a prediction interval from fewer than ${R.minPI} studies (${smallPI.slice(0, 3).join('; ')})` : `${where}: prediction intervals only with ${R.minPI} or more studies`, smallPI.length ? 'Drop these PI rows' : '');
  if (role === 'subgroup') {
    const thin = rows.filter(r => { const k = kOf(r.label); return k && k.k < R.minSubgroup; });
    add('statistics', 'subgroup-k', thin.length ? 'fail' : 'pass', thin.length ? `${where}: subgroup levels with fewer than ${R.minSubgroup} studies (${thin.slice(0, 3).map(r => r.label).join('; ')})` : `${where}: every subgroup level has ${R.minSubgroup} or more studies`, thin.length ? 'Leave these levels out or merge them' : '');
  }
  // studies that share patients (synthesis.overlap) drawn as separate rows
  const label = id => (s.papers || []).find(p => p.id === id)?.label;
  const overlap = (s.synthesis?.overlap || []).map(g => g.studies.map(label).filter(Boolean));
  const drawn = new Set(effects.map(r => trialOf(r.label)));
  const twice = overlap.filter(g => g.filter(l => drawn.has(l)).length > 1);
  if (overlap.length && !poolsOnly) add('statistics', 'overlap', twice.length ? 'fail' : 'pass', twice.length ? `${where} draws studies that share patients as separate rows: ${twice.map(g => g.join(' and ')).join('; ')}` : `${where}: no overlap group drawn twice`,
    twice.length ? 'Keep one study of each overlap group (change op set_overlap with keep)' : '');
  // the axis: stretched by a few intervals, or limited with an estimate drawn at the edge the legend does not name
  const vals = rows.filter(r => !r.interval).flatMap(r => [r.lo, r.hi]).filter(v => v != null);
  if (!c.log && vals.length >= 6) {
    if (c.xMin == null && c.xMax == null && poolsOnly) add('size', 'axis', 'pass', `${where}: every row is a pooled estimate; the axis shows each whole`);
    else if (c.xMin == null && c.xMax == null) {
      // the core: the interval ends within three interquartile ranges of the middle half, every pooled interval and the line of no effect
      const ends = rows.filter(r => !r.interval).flatMap(r => [r.lo, r.hi]).filter(v => v != null).sort((a, b) => a - b);
      const q = p => ends[Math.min(ends.length - 1, Math.max(0, Math.round(p * (ends.length - 1))))], iqr = q(0.75) - q(0.25);
      const core = ends.filter(v => v >= q(0.25) - 3 * iqr && v <= q(0.75) + 3 * iqr), pooled = rows.filter(r => r.pooled && r.lo != null);
      const lo = Math.min(core[0], ...pooled.map(r => r.lo), c.ref ?? Infinity), hi = Math.max(core.at(-1), ...pooled.map(r => r.hi), c.ref ?? -Infinity);
      const span = Math.max(...vals) - Math.min(...vals), coreSpan = hi - lo;
      if (coreSpan > 0 && span / coreSpan > R.stretch) {
        const t = niceTicks(lo, hi, 5), past = rows.filter(r => !r.interval && ((r.lo ?? 0) < t.lo || (r.hi ?? 0) > t.hi));
        add('size', 'axis', 'proposal', `${where}'s axis is stretched by ${plural(past.length, 'interval')} (${past.slice(0, 3).map(r => r.label).join(', ')}): it runs ${roundTo(Math.min(...vals), 2)} to ${roundTo(Math.max(...vals), 2)}, most intervals lie within ${t.lo} to ${t.hi}`,
          `Set the axis to ${t.lo} to ${t.hi}: longer intervals get arrows, and the legend names an estimate drawn at the edge`, { autofix: { chart: { xMin: t.lo, xMax: t.hi } } });
      } else add('size', 'axis', 'pass', `${where}: no interval stretches the axis`);
    } else {
      const atEdge = effects.concat(rows.filter(r => r.pooled)).filter(r => r.value != null && ((c.xMin != null && r.value < c.xMin) || (c.xMax != null && r.value > c.xMax)));
      const unnamed = atEdge.filter(r => !String(spec.notes || '').includes(trialOf(r.label)));
      add('accuracy', 'edge', unnamed.length ? 'fail' : 'pass', unnamed.length ? `${where} draws ${plural(unnamed.length, 'estimate')} at the axis edge that the legend does not name: ${unnamed.slice(0, 3).map(r => `${r.label} (${roundTo(r.value, 2)})`).join('; ')}`
        : `${where}: ${atEdge.length ? 'the legend names every estimate drawn at the axis edge' : 'every estimate lies within the axis'}`,
        unnamed.length ? `Name them in the notes: "${unnamed[0].label} (${roundTo(unnamed[0].value, 2)}) is drawn at the axis edge"` : '',
        unnamed.length ? { autofix: { notes: withSentence(spec.notes, `${listed(unnamed.map(r => `${r.label} (${roundTo(r.value, 2)})`))} ${unnamed.length === 1 ? 'is' : 'are'} drawn at the axis edge.`) } } : {});
    }
  }
  const xl = String(c.xLabel || '');
  if (/%/.test(xl) && vals.length && vals.every(v => Math.abs(v) <= 1)) add('accuracy', 'units', 'fail', `${where}: the axis says percent and every value lies between −1 and 1`, 'Multiply by 100, or label the axis as a proportion');
  else if (/\b(ratio|OR|RR|HR)\b/.test(xl) && !c.log) add('accuracy', 'units', 'warn', `${where}: a ratio drawn on a linear axis`, 'Set chart.log, with ref 1');
  else if (c.log && c.ref != null && c.ref !== 1) add('accuracy', 'units', 'warn', `${where}: a log axis with its line of no effect at ${c.ref}`, 'A ratio\'s line of no effect is 1');
  else add('accuracy', 'units', 'pass', `${where}: axis label and scale agree with the values`);
}

/** A table's cells: percentages against their counts, tiny denominators, width and length on a page. */
function tableChecks({ m, add, R, where, place, flags = {} }) {
  const merged = m.spec.query?.from === 'syntheses' ? '; the syntheses source has each estimate with its interval as one text column (Estimate (95% CI), PI, Responders % (95% CI), Sham/active ratio (Fieller 95% CI))' : '';
  const cells = m.groups.flatMap(g => g.cells.flat()).map(x => String(x ?? ''));
  const bad = [], tiny = [];
  for (const t of cells) for (const x of t.matchAll(/(\d+)\s*(?:\/|of)\s*(\d+)\s*\((\d+(?:\.\d+)?)\s*%\)/g)) {
    const k = Number(x[1]), n = Number(x[2]);
    if (n > 0 && !sameAt(x[3], 100 * k / n)) bad.push(x[0]);
    if (n > 0 && n < R.minDenominator) tiny.push(x[0]);
  }
  add('accuracy', 'percent', bad.length ? 'fail' : 'pass', bad.length ? `${where}: ${plural(bad.length, 'percentage')} not equal to the count over its denominator (${bad.slice(0, 3).join('; ')})` : `${where}: every "k/n (%)" adds up`, bad.length ? 'Recompute them from the counts' : '');
  if (tiny.length) add('statistics', 'denominator', 'warn', `${where}: percentages of fewer than ${R.minDenominator} (${tiny.slice(0, 3).join('; ')})`, 'Give the counts alone for these');
  // readability: category labels in sentence case, one number of decimals down a column
  const rowsOf = m.groups.flatMap(g => g.cells), labels = [...new Set([...(m.grouped ? m.groups.map(g => String(g.label ?? '')) : []), ...rowsOf.map(r => String(r[0] ?? ''))].filter(Boolean))], low = labels.filter(l => lowerCaseStart(l));
  add('readability', 'label-case', low.length ? 'warn' : 'pass', low.length ? `${where} has ${plural(low.length, 'label')} starting with a lower-case letter (${low.slice(0, 3).map(l => `"${clean(l).slice(0, 30)}"`).join('; ')})` : `${where}: labels start with a capital`, low.length ? CASE_FIX : '');
  const mixed = mixedColumnDecimals(m.columns.map(c => c.label), rowsOf);
  add('readability', 'decimals', mixed.length ? 'warn' : 'pass', mixed.length ? `${where} mixes decimal places within ${listed(mixed.slice(0, 3).map(x => `${x.column} (${x.samples.slice(0, 3).join(', ')})`))}` : `${where}: one number of decimals in each column`, mixed.length ? DECIMALS_FIX : '');
  // a printed page: a cell wraps, but not below its longest word; a row needs at least those widths (with a little padding each)
  const need = m.columns.map((c, i) => 2 + Math.max(4, ...[c.label, ...m.groups.flatMap(g => g.cells.map(r => r[i]))].flatMap(x => String(x ?? '').split(/\s+/)).map(w => w.length)));
  const wide = need.reduce((a, b) => a + b, 0), rows = m.groups.reduce((a, g) => a + g.cells.length, 0), over = m.columns.length > 9 || wide > R.tableChars;
  if (rows > R.mainTableRows) flags.oversized = true;
  if (!place?.main) return;
  add('size', 'table-width', over ? 'warn' : 'pass', over ? `${where} has ${m.columns.length} columns needing at least ${wide} characters a row; a portrait page holds about ${R.tableChars}` : `${where}: ${m.columns.length} columns fit a page`,
    over ? `Merge columns (an estimate with its interval in one)${merged}, or move it to the supplement` : '');
  add('size', 'table-rows', rows > R.mainTableRows ? 'warn' : 'pass', rows > R.mainTableRows ? `${where} has ${rows} rows, more than a printed page holds (${R.mainTableRows})` : `${where}: ${rows} rows fit a page`,
    rows > R.mainTableRows ? 'Summarise it by group in the main text and move the full table to the supplement' : '');
}

/** The change-synthesis rows an item shows (its filter over every column): CR2 tests on few df presented as significant, Egger's k. */
function synthesisRowChecks({ s, spec, add, R, where }) {
  let rows = [];
  try {
    const r = runQuery(s, { from: 'syntheses', ...(spec.query.where ? { where: spec.query.where } : {}) }, { all: true }), ix = l => r.columns.findIndex(c => c.label === l);
    rows = r.rows.map(x => Object.fromEntries(['Synthesis', 'Analysis', 'Level', 'Trials', 'df', 'p', 'p, CR2', 'F (df), CR2'].map(l => [l, ix(l) >= 0 ? x[ix(l)] : null])));
  } catch { return; }
  const weak = rows.filter(r => {
    const cr2 = /,\s*([\d.]+)\)\s*$/.exec(String(r['F (df), CR2'] || ''))?.[1], pc = num(String(r['p, CR2'] ?? '').replace('<', ''));
    // a CR2 F test (its denominator df), or a pooled estimate's CR2 t test (df)
    return cr2 != null ? Number(cr2) < R.minDf && pc != null && pc < R.alpha : num(r.df) != null && num(r.df) < R.minDf && num(r.p) != null && num(r.p) < R.alpha;
  });
  add('statistics', 'cr2-df', weak.length ? 'warn' : 'pass', weak.length ? `${where} shows ${plural(weak.length, 'test')} significant on fewer than ${R.minDf} CR2 df (${weak.slice(0, 3).map(r => `${r.Analysis}${r.Level && r.Level !== 'All' ? `, ${r.Level}` : ''}`).join('; ')}); such p values are unreliable`
    : `${where}: no significant test rests on fewer than ${R.minDf} CR2 df`, weak.length ? 'Mark them "not interpretable (df < 4)", and give the model-based and permutation p' : '');
  const egger = rows.filter(r => /^EGGER/.test(r.Synthesis || ''));
  if (egger.length) { const few = egger.filter(r => num(r.Trials) != null && num(r.Trials) < R.eggerK);
    add('statistics', 'egger-k', few.length ? 'warn' : 'pass', few.length ? `${where}: Egger's test with fewer than ${R.eggerK} studies` : `${where}: Egger's test on ${R.eggerK} or more studies`, few.length ? 'Report it as underpowered, or leave it out' : ''); }
}

/** Page box, smallest text after scaling, rows per page, one font, colour. */
function sizeChecks({ svg, place, add, R, journal, where, spec = null, m = null, flags = {} }) {
  const { w, h } = svgInches(svg), box = journal.page;
  if (box && w != null && h != null) {
    const fits = w <= box.w + 1e-6 && h <= box.h + 1e-6;
    add('size', 'page', fits ? 'pass' : place?.main ? 'fail' : 'warn', `${where} is ${w} × ${h} in${fits ? `, within the ${box.w} × ${box.h} in page box` : `; ${journal.name || 'the journal'}'s page box is ${box.w} × ${box.h} in`}`,
      fits ? '' : spec?.chart ? `Set chart.widthIn ${box.w} and heightIn ${box.h} (rows and type are fitted to it)` : 'Draw it in the portrait layout', fits || spec?.chart?.type !== 'forest' ? {} : { autofix: { chart: { widthIn: box.w, heightIn: box.h } } });
  } else if (!box) add('size', 'page', 'warn', `${where}: no page box known for the target journal`, 'Set the target journal (Manuscript › Submission), or state its figure size');
  const min = journal.minPt || R.minPt, content = figureContent(svg, { widthIn: w }), got = content.minPt;
  if (got != null) add('size', 'min-text', got + 1e-6 >= min ? 'pass' : 'fail', `${where}: smallest text ${got} pt${got + 1e-6 >= min ? '' : `, below ${min} pt`}`, got + 1e-6 >= min ? '' : 'Split the figure or widen its box');
  if (spec?.chart?.type === 'forest' && m && box && h != null) {
    // the drawing fitted to the box (chart.widthIn, heightIn) says whether its rows fit; else a page holds about this many rows at the minimum size
    const rows = m.chart.rows.length + new Set(m.chart.rows.map(r => r.group ?? '')).size, perPage = Math.floor((box.h * 72 - 40) / (min * 1.25 * 1.1));
    const fits = h <= box.h + 1e-6 && w <= box.w + 1e-6 && (got == null || got + 1e-6 >= min) && (!spec.chart.widthIn || spec.chart.widthIn <= box.w + 1e-6);
    if (!fits && rows > perPage) flags.oversized = true;
    add('size', 'rows', fits || rows <= perPage ? 'pass' : 'proposal', fits ? `${where}: its ${rows} rows fit the page at ${got ?? min} pt` : rows <= perPage ? `${where}: ${rows} rows would fit one page fitted to the box` : `${where} has ${rows} rows; a ${box.h} in page holds about ${perPage} at ${min} pt`,
      fits || rows <= perPage ? '' : `Split it into ${Math.ceil(rows / perPage)} pages (rows per page ${perPage}), by group`, fits || rows <= perPage ? {} : { autofix: { chart: { page: Math.max(5, Math.min(200, perPage)) } } });
  }
  const fonts = fontsOf(svg);
  add('readability', 'one-font', fonts.size <= 1 ? 'pass' : 'fail', fonts.size <= 1 ? `${where}: one font` : `${where} uses ${fonts.size} fonts (${[...fonts].join(', ')})`, fonts.size <= 1 ? '' : 'Draw it in the house style');
  const low = lowerCaseLabels(svg), hy = hyphenMinus(svg), mix = mixedDecimals(svg);
  add('readability', 'label-case', low.length ? 'warn' : 'pass', low.length ? `${where} has ${plural(low.length, 'label')} starting with a lower-case letter (${low.slice(0, 3).map(l => `"${clean(l).slice(0, 30)}"`).join('; ')})` : `${where}: labels start with a capital`, low.length ? CASE_FIX : '');
  add('readability', 'minus', hy.length ? 'warn' : 'pass', hy.length ? `${where} writes negative numbers with a hyphen, not a minus sign (${hy.slice(0, 3).map(l => `"${clean(l).slice(0, 30)}"`).join('; ')})` : `${where}: negative numbers use the minus sign`, hy.length ? 'Print them with a true minus (U+2212); the hover title and the CSV keep the plain hyphen' : '');
  add('readability', 'decimals', mix.length ? 'warn' : 'pass', mix.length ? `${where} mixes decimal places within one ${mix[0].where} (${mix[0].samples.slice(0, 4).join(', ')})` : `${where}: one number of decimals in each column and axis`, mix.length ? DECIMALS_FIX : '');
  const rob = /traffic|rob-summary/.test(spec?.chart?.type || '') || /risk of bias/i.test(spec?.title || '');
  add('readability', 'colour', !content.hues || rob ? 'pass' : 'warn', !content.hues || rob ? `${where}: ${rob && content.hues ? 'colour only for the risk-of-bias judgements' : 'no colour'}` : `${where} uses ${plural(content.hues, 'colour')} beyond the greys`,
    !content.hues || rob ? '' : 'Draw it in greys; hue only where the reader already reads it (risk of bias)');
}

/** The estimates an item shows, as "estimate|lower|upper" at two decimals: what "the same numbers" means between items. */
function triplesOf(m) {
  const set = new Set(), put = (a, b, c) => { const v = [a, b, c].map(num); if (v.every(x => x != null)) set.add(v.map(x => roundTo(x, 2)).join('|')); };
  if (m.chart?.rows) for (const r of m.chart.rows) put(r.value, r.lo, r.hi);
  else {
    const ix = ['Estimate', 'Lower 95% CI', 'Upper 95% CI'].map(l => m.result.columns.findIndex(c => c.label === l));
    if (ix.every(i => i >= 0)) for (const row of m.result.rows) put(...ix.map(i => row[i]));
    for (const t of m.groups.flatMap(g => g.cells.flat())) { const x = TRIPLE.exec(String(t ?? '')); if (x) put(x[1], x[2], x[3]); }
  }
  return set;
}
/** Every non-integer number an item shows, at two decimals (its estimates and everything else it reports). */
function numbersOf(m) {
  const set = new Set(), put = v => { const x = num(v); if (x != null && !Number.isInteger(x)) set.add(roundTo(x, 2)); };
  if (m.chart?.rows) for (const r of m.chart.rows) { put(r.value); put(r.lo); put(r.hi); }
  else for (const row of m.result.rows) for (const v of row) put(v);
  return set;
}
/** The set: the journal's limit, numbers repeated across items, and the proposed main text and supplement with a reason for each item. */
function setChecks(out, models, { R, journal, association }) {
  const checks = [], add = (area, check, state, message, fix = '', extra = {}) => checks.push({ key: `set:${check}${extra.item ? `:${extra.item}` : ''}`, id: extra.item || 'set', place: '', area, check, state, message, fix, ...extra });
  const main = out.filter(x => x.main), limit = journal.limit, name = x => (x.place && out.filter(o => o.place === x.place).length === 1 ? x.place : `${x.place ? `${x.place} ` : ''}(${x.id})`);
  if (limit != null) add('place', 'limit', main.length <= limit ? 'pass' : 'fail', `${main.length} display items in the main text${main.length <= limit ? `, within ${journal.name || 'the journal'}'s ${limit}` : `; ${journal.name || 'the journal'} allows ${limit}`}`,
    main.length <= limit ? '' : 'Move the items the proposal leaves out to the supplement');
  // numbers repeated: most of an item's estimates shown again by another item
  // repeated: most of an item's estimates, and most of all its numbers, are shown by another item (Table 2's pooled classes are Figure 2's
  // subtotals, but its responders and ratios are its own: not a repeat)
  const nums = new Map([...models].map(([id, m]) => [id, triplesOf(m)]).filter(([, v]) => v.size >= 3)), every = new Map([...models].map(([id, m]) => [id, numbersOf(m)])), dupOf = new Map();
  for (const [a, A] of nums) for (const [b, B] of nums) {
    if (a === b || A.size > B.size || (A.size === B.size && a > b)) continue;
    const shared = [...A].filter(x => B.has(x)).length;
    // and the estimates are most of what it shows (its other numbers, a table's responders or ratios, are its own)
    if (shared / A.size < R.overlapShare || 3 * A.size < 0.6 * every.get(a).size) continue;
    const x = out.find(o => o.id === a), y = out.find(o => o.id === b);
    if (!dupOf.has(a)) dupOf.set(a, b);
    add('place', 'duplicate', 'proposal', `${name(x)} repeats ${Math.round(100 * shared / A.size)}% of its estimates in ${name(y)}`, x.main && y.main ? 'Keep one of them in the main text' : 'Keep both only if each answers its own question; otherwise drop one', { item: a, other: b });
  }
  // the proposal: by need, then by what fits a page, repeated roles and repeated numbers; ties keep the current main text and order
  const met = association?.met || null, seen = new Map();
  const order = (a, b) => a.r - b.r || (b.x.main === true) - (a.x.main === true) || a.i - b.i;
  const ranked = out.map((x, i) => ({ x, i, r: NEED[x.role] ?? 6, why: [] }));
  for (const e of ranked) {
    const { x } = e;
    if ((x.role === 'moderator' || x.role === 'subgroup') && met?.length) e.r = 5;
    if (x.oversized) { e.r += 3; e.why.push('too large for a printed page'); }
    const d = dupOf.get(x.id), partner = d && out.find(o => o.id === d);
    if (partner?.main) { e.r += 3; e.why.push(`its estimates are in ${name(partner)}`); }
    if (models.get(x.id)?.chart?.type === 'traffic-light') e.r += 1;   // the summary bars say it in less space
  }
  // a second item of one role (two risk-of-bias figures) after the first, in the order so far
  ranked.sort(order);
  for (const e of ranked) { const n = seen.get(e.x.role) || 0; seen.set(e.x.role, n + 1);
    if (n && !['secondary', 'other', 'listing'].includes(e.x.role)) { e.r += 2; e.why.push(`another item already shows ${ROLE_WORDS[e.x.role]}`); } }
  ranked.sort(order);
  const cap = limit ?? ranked.length, chosen = new Set(), reasons = {};
  for (const { x, r, why } of ranked) {
    const noRule = (x.role === 'moderator' || x.role === 'subgroup') && met && !met.length;
    if (chosen.size < cap && !noRule && r < 9) { chosen.add(x.id); reasons[x.id] = `main text: ${ROLE_WORDS[x.role]}`; continue; }
    reasons[x.id] = `supplement: ${noRule ? `${ROLE_WORDS[x.role]}, and no moderator meets ${association?.rule || 'the protocol\'s association rule'}` : x.role === 'listing' ? ROLE_WORDS.listing : why.length ? why.join('; ') : `${ROLE_WORDS[x.role]}, after ${cap} items of greater need`}`;
  }
  const drop = out.filter(x => !chosen.has(x.id) && dupOf.has(x.id) && !chosen.has(dupOf.get(x.id))).map(x => x.id);
  for (const id of drop) reasons[id] += `; it could be dropped, since ${name(out.find(o => o.id === dupOf.get(id)))} shows its numbers`;
  for (const x of out) {
    if (x.main == null) continue;
    const want = chosen.has(x.id);
    if (want === x.main) add('place', 'placement', 'pass', `${name(x)}: ${reasons[x.id]}`, '', { item: x.id });
    else add('place', 'placement', 'proposal', `${name(x)} would go to the ${want ? 'main text' : 'supplement'} (${reasons[x.id].replace(/^[\w ]+: /, '')})`, 'A proposal: the authors decide, then the manuscript build places it', { item: x.id });
  }
  return { checks, proposal: { main: out.filter(x => chosen.has(x.id)).map(x => x.id), supplement: out.filter(x => !chosen.has(x.id)).map(x => x.id), drop, reasons } };
}

// the association rule itself is in lib/change-tables.mjs (a worker makes it beside the model, lib/change-run.mjs); read here as before
export { associationOf } from './change-tables.mjs';

/** Applies an autofix (a chart patch) to a spec: the spec saved as the item's next version. */
export const withAutofix = (spec, fix) => ({ ...spec, ...(fix?.chart ? { chart: { ...spec.chart, ...fix.chart } } : {}), ...(fix?.notes != null ? { notes: fix.notes } : {}) });

/** The checks as plain lines: failures, then warnings and proposals, passes counted (or listed with `passes`). */
export function checksText(r, { passes = false } = {}) {
  const lines = [`display item checks: ${r.summary.pass} pass, ${r.summary.fail} fail, ${r.summary.warn} warn, ${r.summary.proposal} proposals`];
  const all = [...r.items.flatMap(i => i.checks), ...r.set];
  for (const st of ['fail', 'warn', 'proposal', ...(passes ? ['pass'] : [])]) for (const c of all.filter(x => x.state === st)) lines.push(`  ${st.toUpperCase()} ${c.area}: ${c.message}${c.fix ? `. Fix: ${c.fix}` : ''}`);
  return lines.join('\n');
}
