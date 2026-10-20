// "Where the paper stands" drawn (plan §2, Home page): the review's stages as one unboxed line of work, as the workflows draw a run and
// Dependencies draws its layers: each stage a node ringed in its state's colour, its headline figure, a small chart that answers the
// stage's question and at most one action. lib/overview-stages.mjs says what each stage holds; this draws it and wires it. It loads with
// the Overview of a review (views/overview.mjs `prepare`), never at start-up.
//
// Layout (2026-10-18): the stages are rows of one vertical run, its line through their nodes, each row's words, chart and action in columns
// every row shares; the page splits in two beside Submission readiness, Needs attention, Tasks and Recent when wide enough (pageSplit), and a
// narrow run puts each chart under its words (RUN_ROW_MIN); each chosen by measuring, never by a breakpoint. The charts are SVG in the house figure
// style (lib/figure-style.mjs tokens; colours from the --fig-* variables through the c-* classes): marks only, placed in percent of their
// track so they are drawn crisp at any width and scale with no measuring; their words are HTML text in the interface's type scale.
import { uiLink } from './ui-components.mjs';
import { uiBar } from './ui-actions.mjs';
import { esc } from './html.mjs';
import { glyph } from './status-marks.mjs';
import { icon } from './icons.mjs';
import { figureTokens } from './figure-style.mjs';
import { STAGE_MARK, stageCards } from './overview-stages.mjs';
import { standingFacts, readinessFacts } from './overview-facts.mjs';
import { update } from '../store.mjs';
import { standingOf, standingNeeded, fetchStanding } from './journal-standing.mjs';

export { standingFacts, stageCards, readinessFacts };

/** A stage's row holds its node, its words, its chart and its action side by side when the run is at least this wide; narrower, the chart goes under the words. */
export const RUN_ROW_MIN = 600;   // a chart's track is then at least about 100 px beside the words
/** Whether a run `width` pixels wide holds each stage's chart beside its words. */
export const runRow = width => width >= RUN_ROW_MIN;
/** The page splits into the run and a column for readiness and what needs a person when it is at least this wide (pageSplit). */
export const SPLIT_MIN = 760;   // the grade and what needs a person stay in view from a 980 px window; a narrow run stacks each chart under its words
/** Whether a page `width` pixels wide holds the run beside the column. */
export const pageSplit = width => width >= SPLIT_MIN;

const T = figureTokens(null, { medium: 'screen' });
const DOT = T?.dot ?? 3.5, CI = T?.line?.ci ?? 1.25, AXIS = T?.line?.axis ?? 1;
const p = x => `${(Math.max(0, Math.min(1, x)) * 100).toFixed(2)}%`;
const BAR_H = 8;
/** A track of a chart row: an SVG as wide as its cell, holding marks only. */
const track = (inner, h = BAR_H + 2) => `<svg class="ov-mk" width="100%" height="${h}" aria-hidden="true" focusable="false">${inner}</svg>`;
const bg = `<rect class="c-band" x="0" y="1" width="100%" height="${BAR_H}" rx="1"/>`;
const SHADE = ['c-cat1', 'c-cat3', 'c-cat2', 'c-cat4', 'c-cat0'];
const segClass = s => s.tone ? `c-rob-${s.tone === 'critical' ? 'bad ov-critical' : s.tone}` : s.shade === 'filled' ? 'c-bar' : s.shade === 'nr' ? 'c-cat3' : s.shade === 'none' ? 'ov-empty' : SHADE[s.shade] || 'c-cat2';
const segs = list => { let x = 0; return list.map(s => { const r = `<rect class="${segClass(s)}" x="${p(x)}" y="1" width="${p(s.share)}" height="${BAR_H}" shape-rendering="crispEdges"/>`; x += s.share; return r; }).join(''); };
const row = (r, mark, cls = '') => `<div class="ov-cr${cls}"${r.tip ? ` title="${esc(r.tip)}"` : ''}><span class="ov-cl">${esc(r.label)}</span>${mark}<span class="ov-cv">${esc(r.value ?? '')}</span></div>`;
const more = n => (n ? `<p class="ov-chart-more">${n} more</p>` : '');
const swatch = s => `<svg class="ov-sw" width="8" height="8" aria-hidden="true" focusable="false"><rect class="${segClass(s)}" x="0" y="0" width="8" height="8"/></svg>`;
const key = r => (r.key ? `<p class="ov-key">${r.segments.map((s, i) => `<span class="ov-key-i">${swatch(s)}${esc(r.key[i] || '')}</span>`).join(' ')}</p>` : '');
const diamond = (x, cls) => `<svg x="${p(x)}" y="0" width="1" height="16" overflow="visible"><polygon class="${cls}" points="${-DOT - 1},8 0,${7 - DOT} ${DOT + 1},8 0,${9 + DOT}"/></svg>`;

/** The chart of one card, or ''. */
function chartHtml(c, label) {
  if (!c) return '';
  const wrap = (rows, cls = '') => `<div class="ov-chart chart-svg${cls}" role="img" aria-label="${esc(label)}">${rows}</div>`;
  if (c.kind === 'funnel' || c.kind === 'bars') return wrap(c.rows.map(r => row(r, track(`${bg}<rect class="${r.last ? 'c-ink' : 'c-bar'}" x="0" y="1" width="${p(r.share)}" height="${BAR_H}" rx="1" shape-rendering="crispEdges"/>`))).join(''));
  if (c.kind === 'stack') return wrap(c.rows.map(r => row(r, track(segs(r.segments)))).join(''));
  if (c.kind === 'segments') return wrap(c.rows.map(r => row(r, track(`${bg}${segs(r.segments)}`), r.gap ? ' ov-cr-gap' : '') + key(r)).join('')) + more(c.more);
  if (c.kind === 'gauge') return wrap(row(c, track(`${bg}<rect class="${c.over ? 'ov-over' : 'c-bar'}" x="0" y="1" width="${p(c.share)}" height="${BAR_H}" shape-rendering="crispEdges"/><svg x="100%" y="0" width="1" height="${BAR_H + 2}" overflow="visible"><rect class="c-ink" x="-1" y="0" width="1" height="${BAR_H + 2}"/></svg>`)));
  if (c.kind === 'forest') {
    const line = r => (r.ref != null ? `<line class="c-grid" x1="${p(r.ref)}" x2="${p(r.ref)}" y1="0" y2="16" stroke-width="${AXIS}"/>` : '');
    const rows = c.rows.map(r => row(r, track(r.est == null ? line(r) : `${line(r)}<line class="${r.stale ? 'ov-stale' : 'c-line'}" x1="${p(r.lo)}" x2="${p(r.hi)}" y1="8" y2="8" stroke-width="${CI}"/>${diamond(r.est, r.stale ? 'ov-stale-mark' : 'c-dot')}`, 16), r.stale ? ' ov-cr-stale' : '')).join('');
    const axis = c.axis ? `<div class="ov-cr ov-axis" aria-hidden="true"><span class="ov-cl"></span><span class="ov-ticks"><span>${esc(c.axis.ticks[0])}</span><span>${esc(c.axis.ticks[1])}</span></span><span class="ov-cv"></span></div>` : '';
    return wrap(rows + axis, ' ov-forest') + more(c.more);
  }
  if (c.kind === 'grade') {
    const marks = r => `<svg class="ov-grade" width="${4 * 12}" height="12" aria-hidden="true" focusable="false">${[0, 1, 2, 3].map(i => `<circle class="${i < r.filled ? 'c-dot' : 'ov-ring'}" cx="${6 + i * 12}" cy="6" r="4.5"/>`).join('')}</svg>`;
    return wrap(c.rows.map(r => row(r, marks(r), r.none ? ' ov-cr-none' : '')).join(''), ' ov-chart-grade') + more(c.more);
  }
  if (c.kind === 'marks') return wrap(c.rows.map(r => `<div class="ov-cr"${r.tip ? ` title="${esc(r.tip)}"` : ''}><span class="pipe-dot ov-mark" data-mark="${esc(r.mark)}" aria-hidden="true">${glyph(r.mark)}</span><span class="ov-cw">${esc(r.label)}&ensp;<span class="ov-cs">${esc(r.value)}</span></span></div>`).join(''), ' ov-chart-marks') + more(c.more);
  return '';
}

/** What a chart says, for a screen reader: its rows' tips, or label and value. */
const chartWords = c => !c ? '' : c.kind === 'gauge' ? c.tip : (c.rows || []).map(r => r.tip || `${r.label} ${r.value ?? ''}`.trim()).join('; ');

/** Each stage's node holds the icon of the page it opens, as the sidebar draws it. */
const PAGE_ICON = { screening: 'screening', extraction: 'extraction', appraisal: 'appraisal', analysis: 'analysis', certainty: 'certainty', outputs: 'outputs', manuscript: 'manuscript', submissions: 'send' };
const actHtml = c => (c.action ? uiLink({ id: `ov-st-${c.id}-act`, label: c.action.label, icon: 'chevron-right', attrs: { 'data-stage-act': c.id } }) : '');
const dataOf = c => `data-stage="${esc(c.id)}" data-mark="${esc(c.mark)}" data-stage-go="${esc(c.go)}"${c.show ? ` data-stage-show="${esc(c.show)}"` : ''}${c.action?.slot ? ` data-stage-slot="${esc(c.action.slot)}"` : ''}`;

/**
 * One stage of the run (2026-10-18; the owner: "could be cleaner, maybe whole new design, the paddings and placements suck"): its node on the
 * run's one line, ringed in its state; its name, headline figure and what qualifies it in one column; the chart that answers its question in
 * the next, its labels, tracks and values on the same edges as every other stage's; the action due there last.
 */
function stepHtml(c) {
  const words = [c.label, STAGE_MARK[c.mark], c.figure, c.sub].filter(Boolean).join(' · ');
  return `<li class="ov-st ov-step" ${dataOf(c)}>
    <button type="button" class="ov-st-go ov-st-dot" data-mark="${esc(c.mark)}" aria-label="${esc(`${words}: open ${c.label}`)}" title="${esc(words)}">${icon(PAGE_ICON[c.go] || 'file', { size: 14 })}</button>
    <div class="ov-step-words"><span class="ov-step-name">${esc(c.label)}</span><span class="ov-step-fig">${esc(c.figure)}</span>${c.sub ? `<span class="ov-step-sub">${esc(c.sub)}</span>` : ''}${c.action ? `<span class="ov-step-act">${actHtml(c)}</span>` : ''}</div>
    <div class="ov-step-body">${chartHtml(c.chart, chartWords(c.chart) || c.label)}${c.note ? `<p class="ov-st-note"${c.noteTip ? ` title="${esc(c.noteTip)}"` : ''}>${esc(c.note)}</p>` : ''}</div>
  </li>`;
}

/** The run: every stage in the order the work happens, one row each on one line; a paper with a journal (`lead: 'submission'`) leads with its submission. */
export function runHtml(cards, { lead = '' } = {}) {
  const shown = [...cards].sort((a, b) => (b.id === lead) - (a.id === lead));
  return shown.length ? `<ol class="ov-run" id="ov-pipeline" aria-label="Where the paper stands" data-wrap="row">${shown.map(stepHtml).join('')}</ol>` : '';
}

const BAND = { A: 'good', B: 'good', C: 'unclear', D: 'bad', F: 'bad' };
const num1 = v => (Math.round(Number(v) * 10) / 10).toLocaleString('en');
/**
 * The journal on its line, then what is known of its standing as label and value rows, never one line of parts: the impact factor a person
 * gave (Change), or OpenAlex's 2-year citedness and an Impact factor row to add one; then the tier the figure puts it in.
 */
const standingHtml = r => {
  if (!r.journal) return '<span class="ov-ready-for">No target journal</span>';
  const t = r.tier, own = t?.from === 'impact factor';
  const set = label => `<button type="button" class="link" id="ov-ready-if">${label}</button>`;
  const sj = r.sjr;   // SCImago's rank, from the file imported in Settings > Sources (lib/sjr.mjs), cited in its label
  const rows = [
    ...(t && !own ? [['2-year citedness', esc(num1(t.value))]] : []),
    ...(sj?.sjr != null ? [[`SJR (SCImago${sj.year ? ` ${esc(sj.year)}` : ''})`, esc(sj.sjr.toLocaleString('en', { maximumFractionDigits: 3 }))]] : []),
    ...(sj?.quartile ? [['Quartile', esc(sj.quartile)]] : []),
    ['Impact factor', own ? `${esc(num1(t.value))} ${set('Change')}` : set('Add…')],
    ...(t ? [['Tier', esc(t.label)]] : r.standing?.error ? [['Standing', 'Not found']] : []),
  ];
  // what OpenAlex says of the journal (lib/journal-standing.mjs): its publisher, whether it is open access, its APC
  const o = r.standing || {};
  if (o.publisher) rows.push(['Publisher', esc(o.publisher)]);
  if (o.v >= 2) rows.push(['Open access', o.oa ? (o.doaj ? 'Yes, in DOAJ' : 'Yes') : 'No']);
  if (o.apc != null) rows.push(['APC', `USD ${esc(o.apc.toLocaleString('en'))}`]);
  // the journal site's own icon (fetched by its domain from DuckDuckGo's icon service, the domain alone sent), sized before it loads
  let host = ''; try { host = o.homepage ? new URL(o.homepage).hostname.replace(/^www\./, '') : ''; } catch {}
  const icon = host ? `<img class="ov-ready-icon" src="https://icons.duckduckgo.com/ip3/${esc(host)}.ico" alt="" width="16" height="16" loading="lazy" referrerpolicy="no-referrer">` : '';
  return `<span class="ov-ready-for">${icon}${esc(r.journal)}</span><dl class="ov-ready-facts"${o.v >= 2 ? ' title="Publisher, open access and APC: OpenAlex"' : ''}>${rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')}</dl>`;
};
/**
 * Submission readiness (lib/readiness-score.mjs): the grade in a ring whose arc is the score; the score and its word, or "Not graded" with
 * the points it could assess; the journal with its standing and tier; why the grade is held, and a manuscript that is not the review; then a
 * row per part, its label, its points on a bar and its value ("—" when not assessed), as the stages' charts draw theirs; what it lacks is
 * the row's tip; a row opens its page.
 */
export function readinessHtml(r) {
  if (!r) return '';
  const R = 26, C = 2 * Math.PI * R, band = BAND[r.letter] || 'unclear';
  const ring = `<svg class="ov-ready-ring" width="64" height="64" viewBox="0 0 64 64" role="img" aria-label="${esc(r.graded ? `Grade ${r.letter}, ${r.score} of 100` : `Not graded: ${r.assessed} of 100 points assessed`)}">
    <circle class="ov-ready-track" cx="32" cy="32" r="${R}"/>${r.graded ? `<circle class="ov-ready-arc" data-band="${band}" cx="32" cy="32" r="${R}" stroke-dasharray="${(C * r.score / 100).toFixed(2)} ${C.toFixed(2)}" transform="rotate(-90 32 32)"/>` : ''}
    <text class="ov-ready-letter" x="32" y="32" text-anchor="middle" dominant-baseline="central" font-size="22" font-weight="600">${esc(r.graded ? r.letter : '–')}</text></svg>`;
  const part = x => `<li class="ov-ready-line${x.assessed ? '' : ' is-na'}"><button type="button" class="ov-ready-part" data-ready-go="${esc(x.go)}" title="${esc(`${x.label}: ${x.detail}`)}">
      <span class="ov-ready-label">${esc(x.label)}</span>
      <svg class="ov-mk ov-ready-meter" width="100%" height="6" aria-hidden="true" focusable="false"><rect class="c-band" x="0" y="0" width="100%" height="6" rx="1"/>${x.assessed ? `<rect class="c-bar" x="0" y="0" width="${p(x.got / x.max)}" height="6" rx="1"/>` : ''}</svg>
      <span class="ov-ready-pts">${x.assessed ? `${esc(String(Math.round(x.got)))}<span class="ov-ready-max">/${x.max}</span>` : '—'}</span></button></li>`;
  const expected = r.expectations?.length ? ` · Expected of a ${r.tier.label.toLowerCase()} journal: ${r.expectations.map(e => `${e.label} (${e.met ? 'met' : 'not met'})`).join(', ')}` : '';
  const tip = `Scored from what the app can check against this journal and the review; it does not predict the editors' decision${expected}`;
  const said = r.graded ? `<span class="ov-ready-score">${r.score}<span class="ov-ready-max">/100</span><span class="ov-ready-word">${esc(r.word)}</span></span>`
    : `<span class="ov-ready-score">Not graded<span class="ov-ready-word">${r.assessed} of 100 points assessed</span></span>`;
  const notes = [...(r.caps || []).map(c => `Held at ${c.at}: ${c.why}`),
    ...(r.fit && !r.fit.ok ? [`Not the review: ${r.fit.name || 'the manuscript in the app'}`] : [])];
  return `<div class="ov-ready-top" title="${esc(tip)}">${ring}<div class="ov-ready-said">${said}
      ${standingHtml(r)}${notes.map(n => `<span class="ov-ready-cap">${esc(n)}</span>`).join('')}</div></div>
    <ul class="ov-ready-parts">${r.parts.map(part).join('')}</ul>`;
}

let readyMemo = { key: null, value: null }, standingAsked = '', sjrMemo = { key: null, value: null };
/**
 * The Submission readiness section of the Overview: its head (with the journal's impact factor, which a person can give) and the block above,
 * scored once per change of the project (`key` says the project's version and the checks' state). The journal's citedness is looked up once
 * when none is kept (lib/journal-standing.mjs); `rerender` draws the page again when it arrives. Here, not in views/overview.mjs, so the score
 * loads with the stages and not at start-up.
 */
export function readinessSection(s, facts, key, rerender) {
  if (readyMemo.key !== key) readyMemo = { key, value: readinessFacts(s, facts) };
  if (standingNeeded(s) && standingAsked !== readyMemo.value.journal) {
    standingAsked = readyMemo.value.journal;
    fetchStanding(standingAsked).then(got => { update(st => { st.journalStanding = { ...(standingOf(st) || {}), ...got }; return st; }); rerender?.(); }, () => {});
  }
  // SCImago's rank for the journal, once the kept table is read (none imported: no rows); a found rank draws the page again
  const journal = readyMemo.value.journal, issns = standingOf(s)?.issns || [], sk = journal ? `${journal}|${issns.join(',')}` : '';
  if (sk && sjrMemo.key !== sk) { sjrMemo = { key: sk, value: null }; import('./sjr.mjs').then(m => m.loadSjr().then(ix => { const v = m.lookupSjr(ix, { journal, issns }); if (v && sjrMemo.key === sk) { sjrMemo.value = v; rerender?.(); } })).catch(() => {}); }
  readyMemo.value.sjr = sk ? sjrMemo.value : null;
  return `<section class="ov-ready" aria-label="Submission readiness">${uiBar({ kind: 'head', label: 'Submission readiness', id: 'ov-ready-head', cls: 'panel-head',
    lead: { title: 'Submission readiness', level: 'h2' }, actions: [] })}${readinessHtml(readyMemo.value)}</section>`;
}

/** Wires the section: a part opens its page; the Impact factor row's Add… or Change keeps the journal's own figure, which then decides its tier (empty: OpenAlex's again). */
export function wireReadiness(root, ctx) {
  root.querySelectorAll('[data-ready-go]').forEach(b => b.onclick = () => ctx.go(b.dataset.readyGo));
  const btn = root.querySelector('#ov-ready-if');
  if (btn) btn.onclick = async () => {
    const { askText } = await import('./dialog.mjs'), { get } = await import('../store.mjs');
    const s = get(), was = standingOf(s), journal = readyMemo.value?.journal;
    const text = await askText(`Impact factor of ${journal}`, { value: was?.impactFactor ?? '', placeholder: 'For example 2.6; empty to use OpenAlex\'s citedness' });
    if (text == null) return;
    const v = String(text).trim().replace(',', '.'), n = Number(v);
    if (v && !(Number.isFinite(n) && n >= 0)) return;
    update(st => { const keep = { ...(standingOf(st) || {}), journal }; if (v) keep.impactFactor = n; else delete keep.impactFactor; st.journalStanding = keep; return st; });
    ctx.rerender();
  };
}

/** Lays the page out for its width now: split or stacked, and the run's rows side by side or stacked. The Overview calls it again whenever the width engine says the run changed width. */
export function fitStages(list) {
  if (!list?.isConnected) return;
  const page = list.closest('.ov');
  if (page) { const lay = pageSplit(page.clientWidth) ? 'split' : 'stack'; if (page.dataset.layout !== lay) page.dataset.layout = lay; }
  const wrap = runRow(list.clientWidth) ? 'row' : 'stack';
  if (list.dataset.wrap !== wrap) list.dataset.wrap = wrap;
}

/**
 * Wires the cards: a press anywhere on a card, or Enter on its mark, opens its page; a card's action does what it names. `pages` loads
 * the pages the cards open into ({ outputs, analysis }); `ctx` is the view's.
 */
export function wireStagePanel(root, ctx, pages) {
  const open = async card => {
    if (card.dataset.stageShow) { const o = await pages.outputs(); o.openList(); o.selectShow(card.dataset.stageShow); }
    ctx.go(card.dataset.stageGo);
  };
  root.querySelectorAll('.ov-st').forEach(card => card.addEventListener('click', e => {
    if (e.target.closest('button') && !e.target.closest('.ov-st-go')) return;   // the card's own action and its More
    open(card);
  }));
  root.querySelectorAll('[data-stage-act]').forEach(b => b.addEventListener('click', async () => {
    const card = b.closest('.ov-st'), id = b.dataset.stageAct;
    if (id === 'certainty') { const { rateAnalysed } = await import('./grade-link.mjs'); update(st => { rateAnalysed(st); return st; }); ctx.go('certainty'); return; }
    if (id === 'analyses') { (await pages.analysis()).selectOutcome(card.dataset.stageSlot); ctx.go('analysis'); return; }
    open(card);
  }));
}
