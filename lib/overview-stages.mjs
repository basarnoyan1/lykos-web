// "Where the paper stands" as stage cards (plan §2, Home page): one card per stage of a review, in the order the work happens, each
// with the workflow pipeline's status mark (lib/status-marks.mjs), one headline figure, what its chart draws, and at most one action
// when something is due there. Pure: it reads only the facts lib/overview-facts.mjs gives, so it can be tested without a document and
// cannot disagree with the pages the cards open. Nothing is stored. lib/overview-panel.mjs draws the cards.

const num = n => Number(n || 0).toLocaleString('en');
const plural = (n, one, many) => `${num(n)} ${n === 1 ? one : many}`;
const lower = t => `${t.charAt(0).toLowerCase()}${t.slice(1)}`;

/** The stages in the order the work happens: [id, name, the page a card opens, the view that page is]. */
export const STAGES = Object.freeze([
  ['screening', 'Screening', 'screening'], ['evidence', 'Evidence table', 'extraction'], ['appraisal', 'Risk of bias', 'appraisal'],
  ['analyses', 'Analyses', 'analysis'], ['certainty', 'Certainty', 'certainty'], ['package', 'Package', 'outputs'],
  ['manuscript', 'Manuscript', 'manuscript'], ['submission', 'Submission', 'submissions'],
]);
/** What a card's mark says, as its words (the pipeline's marks: done, needs attention, stale or failed, not started, under way). */
export const STAGE_MARK = Object.freeze({ passed: 'Done', warning: 'Needs attention', failed: 'Failed or missing', pending: 'Not started', running: 'Under way' });
/** How many rows a chart lists before it counts the rest. */
export const CHART_ROWS = 4;   // 4 since 2026-10-17 (was 5): the rest is one "N more" line

// ---- the funnel ----------------------------------------------------------------------------------------------------------------

/** The screening funnel: a bar per step, each a share of what was identified; the full-text step's tip names the commonest exclusion reasons. */
export function funnelChart(screening) {
  const steps = screening?.steps || [], top = Math.max(1, ...steps.map(([, n]) => n));
  const reasons = screening?.reasons || [];
  const tip = reasons.length ? `Excluded at full text: ${reasons.slice(0, 3).map(r => `${r.reason} ${num(r.n)}`).join(', ')}${reasons.length > 3 ? `, ${plural(reasons.length - 3, 'more reason', 'more reasons')}` : ''}` : '';
  return { kind: 'funnel', rows: steps.map(([w, n], i) => ({ label: `${w.charAt(0).toUpperCase()}${w.slice(1)}`, n, value: num(n), share: n / top, last: i === steps.length - 1, ids: screening?.ids?.[w], tip: w === 'full text' && tip ? tip : '' })) };
}

// ---- the forest ----------------------------------------------------------------------------------------------------------------

const sig = x => String(Number(Number(x).toPrecision(3))).replace(/^-/, '−');
const pct = x => `${(x * 100).toFixed(1)}%`;
const STEPS = [0.5, 1, 2, 2.5, 5, 10, 20, 25, 50, 100];
const LOGS = [0.01, 0.02, 0.05, 0.1, 0.2, 0.25, 0.5, 1, 2, 4, 5, 10, 20, 50, 100];
/** The smallest round step that reaches `v` in at most four of it. */
const roundUp = v => { const s = STEPS.find(x => v / x <= 4) ?? 100; return Math.max(s, Math.ceil(v / s) * s); };

/**
 * The scale one kind of result is drawn on: a proportion in percent from 0, a ratio on a log scale through 1, a difference on a linear
 * scale through 0; `at(x)` is where a result's own number falls, 0 to 1; `ref` the line of no effect (none for a proportion).
 */
export function forestScale(kind, rows) {
  const v = rows.flatMap(r => [r.lo, r.est, r.hi]).filter(Number.isFinite);
  if (kind === 'percent') {
    const max = Math.min(100, roundUp(Math.max(1, ...v.map(x => x * 100))));
    return { kind, min: 0, max, ref: null, at: x => clamp(x * 100 / max), ticks: [`0%`, `${max}%`] };
  }
  if (kind === 'ratio') {
    const pos = v.filter(x => x > 0), lo = LOGS.filter(x => x <= Math.min(1, ...pos)).at(-1) ?? LOGS[0], hi = LOGS.find(x => x >= Math.max(1, ...pos)) ?? LOGS.at(-1);
    const f = x => Math.log(x), span = f(hi) - f(lo);
    return { kind, min: lo, max: hi, ref: clamp((f(1) - f(lo)) / span), at: x => (x > 0 ? clamp((f(x) - f(lo)) / span) : 0), ticks: [sig(lo), sig(hi)] };
  }
  const m = roundUp(Math.max(0.5, ...v.map(Math.abs))), lo = Math.min(0, ...v) < 0 ? -m : 0, hi = Math.max(0, ...v) > 0 ? m : 0;
  const span = hi - lo || 1;
  return { kind, min: lo, max: hi, ref: clamp(-lo / span), at: x => clamp((x - lo) / span), ticks: [sig(lo), sig(hi)] };
}
const clamp = x => Math.max(0, Math.min(1, Number.isFinite(x) ? x : 0));

/**
 * The analyses as a small forest: one row per analysis, the estimate and its interval placed on the scale of its kind, the analyses
 * the paper uses whose data changed since they ran marked `stale` (one it does not use is said so in its tip, not marked). The axis is drawn only when every row shares one kind. At most CHART_ROWS rows.
 */
export function forestChart(rows = []) {
  const kinds = [...new Set(rows.map(r => r.kind))], scales = Object.fromEntries(kinds.map(k => [k, forestScale(k, rows.filter(r => r.kind === k))]));
  const shown = rows.slice(0, CHART_ROWS);
  return {
    kind: 'forest', axis: kinds.length === 1 ? { ticks: scales[kinds[0]].ticks, ref: scales[kinds[0]].ref, label: kinds[0] === 'percent' ? 'Proportion' : rows[0].measure } : null,
    more: rows.length - shown.length,
    rows: shown.map(r => {
      const sc = scales[r.kind], stale = r.used !== false && (r.status === 'stale' || r.status === 'untracked'), ok = [r.est, r.lo, r.hi].every(Number.isFinite);
      const value = !ok ? '' : r.kind === 'percent' ? pct(r.est) : sig(r.est);
      const ci = !ok ? '' : r.kind === 'percent' ? `${pct(r.est)} (95% CI ${pct(r.lo)} to ${pct(r.hi)})` : `${r.measure} ${sig(r.est)} (95% CI ${sig(r.lo)} to ${sig(r.hi)})`;
      const state = r.status === 'stale' ? 'changed since it ran' : r.status === 'untracked' ? 'no input record' : '';
      return { id: r.id, label: r.name, value, stale, ref: sc.ref, ...(ok ? { lo: sc.at(r.lo), est: sc.at(r.est), hi: sc.at(r.hi) } : {}),
        tip: [`${r.name}: ${ci || 'no estimate'}`, r.k ? plural(r.k, 'study', 'studies') : '', state, r.used === false ? 'not used in the paper' : ''].filter(Boolean).join('; ') };
    }),
  };
}

// ---- risk of bias, evidence, certainty, manuscript --------------------------------------------------------------------------------

/** One stacked bar per instrument (robvis's summary), its segments in traffic-light order with their share; the counts are the row's tip. */
export function robChart(appraisal) {
  return { kind: 'stack', rows: (appraisal?.instruments || []).map(i => {
    const total = i.segments.reduce((n, x) => n + x.n, 0) || 1;
    return { label: i.name, value: num(i.n), go: 'appraisal', segments: i.segments.map(x => ({ tone: x.tone, share: x.n / total, level: x.level, n: x.n, ids: i.unit === 'studies' ? x.ids : undefined, tip: `${i.name}, ${x.level}: ${num(x.n)} ${i.unit === 'items' ? (x.n === 1 ? 'item' : 'items') : (x.n === 1 ? 'study' : 'studies')}` })),
      tip: `${i.name}, ${plural(i.n, 'study', 'studies')}: ${i.segments.map(x => `${x.level} ${num(x.n)}`).join(', ')}${i.unit === 'items' ? ` (${plural(total, 'item', 'items')})` : ''}` };
  }) };
}

/**
 * The evidence table: a bar per table (collection) with its studies, on the scale of the studies the evidence table holds, as the screening
 * funnel draws its counts; then its cells, with a value, not reported, and empty (as Extraction counts them). At most CHART_ROWS table rows.
 */
export function evidenceChart(ev) {
  const parts = [...ev.collections.map(c => ({ label: c.name, n: c.n, ids: c.ids })), ...(ev.unfiled ? [{ label: 'In no table', n: ev.unfiled, none: true }] : [])];
  const scale = Math.max(ev.studies || 0, ...parts.map(x => x.n), 1), shown = parts.slice(0, CHART_ROWS);
  const rows = shown.map(x => ({ label: x.label, value: num(x.n), ids: x.ids, segments: [{ shade: x.none ? 'nr' : 'filled', share: x.n / scale, level: x.label, n: x.n }],
    tip: `${x.label}: ${plural(x.n, 'study', 'studies')}` }));
  const c = ev.cells, all = c.total || 1;
  if (c.total) rows.push({ label: 'Cells with a value', value: `${Math.round(100 * c.filled / all)}%`, gap: rows.length > 0, go: 'extraction', segments: [{ shade: 'filled', share: c.filled / all, level: 'Filled', n: c.filled },
    { shade: 'nr', share: c.nr / all, level: 'Not reported', n: c.nr }, { shade: 'none', share: c.empty / all, level: 'Empty', n: c.empty }].filter(x => x.n),
    tip: `${num(c.total)} cells: with a value ${num(c.filled)}, not reported ${num(c.nr)}, empty ${num(c.empty)}` });
  return { kind: 'segments', rows, more: parts.length - shown.length };
}

const LEVELS = ['Very low', 'Low', 'Moderate', 'High'];
/** Certainty per rated outcome as GRADE's four marks (⊕⊕◯◯ is Low); outcomes analysed and not rated are rows of four empty marks. */
export function certaintyChart(c) {
  // a row nobody rated yet (made when its outcome was named) is four empty marks, never GRADE's starting level
  const rated = c.rows.filter(r => r.rated !== false).map(r => ({ label: r.name, filled: LEVELS.indexOf(r.level) + 1, value: r.level, tip: `${r.name}: ${r.level} certainty` }));
  const empty = c.rows.filter(r => r.rated === false).map(r => ({ label: r.name, filled: 0, value: 'Not rated', none: true, tip: `${r.name}: not rated` }));
  const waiting = c.toRate.map(name => ({ label: name, filled: 0, value: rated.length || empty.length ? 'Not rated' : '', none: true, tip: `${name}: analysed, not rated` }));
  const all = [...rated, ...empty, ...waiting];
  return { kind: 'grade', rows: all.slice(0, CHART_ROWS), more: Math.max(0, all.length - CHART_ROWS) };
}

/** The manuscript: its main text against the journal's word limit when the profile states one, else the main text by section. */
export function manuscriptChart(ms) {
  if (ms.limit) return { kind: 'gauge', label: 'Main text', value: `${num(ms.main)} of ${num(ms.limit)}`, share: Math.min(1, ms.main / ms.limit), over: ms.main > ms.limit,
    tip: `Main text ${num(ms.main)} words, the journal's limit ${num(ms.limit)}` };
  if (!ms.sections?.length) return null;
  // the longest sections in the order they are written; the rest counted as one row
  const top = new Set([...ms.sections].sort((a, b) => b.words - a.words).slice(0, ms.sections.length > CHART_ROWS ? CHART_ROWS - 1 : CHART_ROWS));
  const rest = ms.sections.filter(x => !top.has(x)), rows = ms.sections.filter(x => top.has(x)).map(x => ({ label: x.name, words: x.words }));
  if (rest.length) rows.push({ label: plural(rest.length, 'more section', 'more sections'), words: rest.reduce((n, x) => n + x.words, 0), tip: rest.map(x => `${x.name}: ${num(x.words)}`).join('\n') });
  const most = Math.max(1, ...rows.map(r => r.words));
  return { kind: 'bars', rows: rows.map(r => ({ label: r.label, value: num(r.words), share: r.words / most, tip: r.tip || `${r.label}: ${plural(r.words, 'word', 'words')}` })) };
}

// ---- marks of a part, an attempt ----------------------------------------------------------------------------------------------

/** A package part's state (lib/package-state.mjs partState) as a mark. */
export const partMark = state => /^Built/.test(state) ? 'passed' : /^Cannot/.test(state) ? 'failed' : /^Changed/.test(state) ? 'warning' : 'pending';
/** A journal attempt's last event as a mark: accepted or published done, a revision asked for needs a person, sent is under way, an end needs the next journal. */
export const attemptMark = kind => (['accepted', 'published'].includes(kind) ? 'passed' : kind === 'revise' ? 'warning' : ['submitted', 'revised'].includes(kind) ? 'running'
  : ['rejected', 'withdrawn'].includes(kind) ? 'warning' : 'pending');

// ---- the cards ---------------------------------------------------------------------------------------------------------------

/**
 * The cards of "Where the paper stands", from lib/overview-facts.mjs standingFacts(); a card whose page `visible` hides is left out.
 * A card is { id, label, go, show?, mark, figure, sub, note, chart, action }: `mark` one of STAGE_MARK's keys, `figure` the headline,
 * `sub` what qualifies it, `note` a line under the chart, `chart` what lib/overview-panel.mjs draws (or null), `action` at most one
 * { id, label, kind, slot? } when something is due there.
 */
export function stageCards(f = {}, visible = null) {
  const shows = v => !visible || visible.has(v);
  const out = [];
  const add = (id, card) => { const [, label, go] = STAGES.find(x => x[0] === id); if (shows(go)) out.push({ id, label, go, sub: '', note: '', chart: null, action: null, ...card }); };

  const sc = f.screening;
  if (sc) {
    const [ident, , , incl] = sc.steps.map(([, n]) => n);
    add('screening', !ident ? { mark: 'pending', figure: 'No records yet', share: 0 }
      : { mark: sc.left ? 'warning' : incl ? 'passed' : 'warning', figure: `${num(incl)} included`, share: (ident - (sc.left || 0)) / ident, sub: sc.left ? `${num(sc.left)} to screen` : 'all screened', chart: funnelChart(sc) });
  }
  const ev = f.evidence;
  if (f.screening || ev) add('evidence', !ev ? { mark: 'pending', figure: 'No included studies' } : !ev.values ? { mark: 'pending', figure: 'No values yet' }
    : { mark: ev.studies < ev.of ? 'warning' : 'passed', share: ev.of ? ev.studies / ev.of : null, figure: ev.studies < ev.of ? `${num(ev.studies)} of ${plural(ev.of, 'study', 'studies')}` : plural(ev.studies, 'study', 'studies'),
      sub: plural(ev.values, 'value', 'values'), chart: evidenceChart(ev) });
  const rob = f.appraisal;
  if (f.screening || rob) add('appraisal', !rob ? { mark: 'pending', figure: 'No included studies' }
    : { share: rob.of ? rob.complete / rob.of : null, mark: rob.complete === rob.of ? 'passed' : rob.complete || rob.instruments.some(i => i.segments.some(x => x.level !== 'Not judged')) ? 'warning' : 'pending',
      figure: plural(rob.of, 'study', 'studies'), sub: rob.complete === rob.of ? 'all complete' : `${num(rob.complete)} of ${num(rob.of)} complete`, chart: robChart(rob) });
  const an = f.analyses;
  if (an) {
    // changed and untracked count only the analyses the paper uses: one it does not use is said as that, and nothing asks to run it again
    const unused = an.unused || 0, n = an.rows?.length ?? an.current + an.changed + an.untracked + an.unknown + unused, stale = an.changed + an.untracked;
    const firstStale = an.rows?.find(r => r.used !== false && (r.status === 'stale' || r.status === 'untracked'));
    add('analyses', !n ? { mark: 'pending', figure: 'No analyses yet', sub: an.notRun ? plural(an.notRun, 'outcome set up', 'outcomes set up') : '' }
      : { share: n / (n + (an.notRun || 0)), mark: stale ? 'warning' : an.unknown ? 'pending' : an.notRun ? 'warning' : unused === n ? 'pending' : 'passed', figure: plural(n, 'analysis', 'analyses'),
        sub: an.changed ? `${num(an.changed)} changed` : an.untracked ? `${num(an.untracked)} untracked`
          : an.unknown ? 'unchecked' : an.notRun ? plural(an.notRun, 'outcome not run', 'outcomes not run') : unused ? `${num(unused)} unused` : 'current',
        chart: an.rows?.length ? forestChart(an.rows) : null,
        action: firstStale ? { id: 'analyses-rebuild', label: 'Rebuild changed', icon: 'refresh', kind: 'analysis', slot: firstStale.id } : null });
  }
  const ce = f.certainty;
  if (ce) {
    const n = ce.toRate.length, rated = ce.rows.filter(r => r.rated !== false).length, open = ce.rows.length - rated;
    add('certainty', !rated && !open ? { mark: 'pending', figure: 'Not rated', sub: n ? `${plural(n, 'outcome', 'outcomes')} analysed` : '', chart: n ? certaintyChart(ce) : null,
      action: n ? { id: 'certainty', label: n === 1 ? 'Rate 1 outcome' : `Rate ${num(n)} outcomes`, icon: 'certainty', kind: 'rate' } : null }
      : !rated ? { mark: 'pending', figure: 'Not rated', sub: plural(open + n, 'outcome', 'outcomes'), chart: certaintyChart(ce) }
      : { share: rated / (rated + n + open), mark: n || open ? 'warning' : 'passed', figure: plural(rated, 'outcome rated', 'outcomes rated'), sub: n || open ? `${num(n + open)} not rated` : '', chart: certaintyChart(ce) });
  }
  if (f.package) {
    const parts = f.package, built = parts.filter(p => partMark(p.state) === 'passed').length, marks = parts.map(p => partMark(p.state));
    add('package', !parts.length ? { mark: 'pending', figure: 'No package yet', show: 'package', action: { id: 'package', label: 'Set up package', icon: 'outputs', kind: 'package' } }
      : { share: built / parts.length, mark: marks.includes('failed') ? 'failed' : marks.every(m => m === 'passed') ? 'passed' : 'warning', show: 'package', figure: plural(parts.length, 'part', 'parts'),
        sub: `${num(built)} of ${num(parts.length)} built`,
        chart: { kind: 'marks', rows: parts.slice(0, CHART_ROWS).map(p => ({ label: p.name, mark: partMark(p.state), value: p.state, tip: `${p.name}: ${lower(p.state)}` })), more: Math.max(0, parts.length - CHART_ROWS) } });
  }
  const ms = f.manuscript;
  if (ms) {
    const said = [ms.errors ? plural(ms.errors, 'error', 'errors') : '', ms.warnings ? plural(ms.warnings, 'warning', 'warnings') : ''].filter(Boolean).join(', ');
    const over = ms.limit && ms.main > ms.limit;
    add('manuscript', !ms.words ? { mark: 'pending', figure: 'Not started' }
      : { mark: ms.errors ? 'failed' : ms.warnings || over ? 'warning' : ms.warnings === 0 ? 'passed' : 'pending', figure: plural(ms.words, 'word', 'words'),
        sub: said || (ms.warnings === 0 ? 'no warnings' : ''), chart: manuscriptChart(ms) });
  }
  const sub = f.submission;
  if (sub) {
    const at = sub.attempts || [], now = at.find(a => !['rejected', 'withdrawn'].includes(a.kind)) || at[0];
    add('submission', !at.length ? { mark: 'pending', figure: sub.target || 'No target journal', sub: 'not submitted' }
      : { mark: attemptMark(now.kind), figure: now.journal, sub: sub.line ? lower(sub.line.split(/ · |: |, /)[0]) : '',   // lint-allow-dot: reads labels saved before 2026-10-20
        chart: { kind: 'marks', rows: at.map(a => ({ label: a.journal, mark: attemptMark(a.kind), value: a.word || 'Planned', tip: `${a.journal}: ${a.word ? lower(a.word) : 'planned'}` })), more: 0 } });
  }
  return out;
}
