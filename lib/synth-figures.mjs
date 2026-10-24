// The figures of the synthesis explorer, drawn from a record of lib/synth.mjs in one call each (plan §4.15g):
//   forest      a comparison pooled by meta-analysis, in RevMan Web's layout (lib/revman-forest.mjs)
//   swim        a comparison without pooling: the direction of each study's effect on each outcome and the sign test
//   proportions a grouping: each arm's proportion with its exact interval, the pooled proportion per subgroup, the test for their difference
// and the formal legend each is placed with. Every number is the record's, which is the table's: nothing is typed. The house style (one font, no gradients, no
// footnote naming a study) is the profile's; the drawings are vector. Pure.
import { figureTokens } from './figure-style.mjs';
import { r1, svgRoot, text as draw, measure, axisLine, hairLine, LINE, wrapText } from './figure-draw.mjs';
import { niceTicks } from './output-charts.mjs';
import { revmanForest } from './revman-forest.mjs';
import { forestData, forestPageSvg } from './forest-page.mjs';
import { heterogeneityLine } from './figure-house-render.mjs';
import { clopperPearson } from './dta.mjs';
import { rrStudy, poolRr, subgroupQ, fmtP, signP, fixed } from './synth-stats.mjs';
import { forestOptions, favoursOf, sidesOfTitle, ratioAxis } from './forest-options.mjs';
import { forestTable } from './analysis-charts.mjs';

const print = () => figureTokens(null, { medium: 'export' });
const up = t => String(t).replace(/^./, c => c.toUpperCase());
const one = (n, d = 1) => (Math.round(n * 10 ** d) / 10 ** d).toFixed(d);

// ---- forest -------------------------------------------------------------------------------------------------------------------------
/** The revmanForest spec of a comparative meta-analysis record: study effects and weights from the REML fit, the pooled result, the heterogeneity. */
const resultOf = pool => (pool ? { k: pool.k, mu: pool.mu, lo: pool.mu - 1.96 * pool.se, hi: pool.mu + 1.96 * pool.se, tau2: pool.tau2, Q: pool.Q, df: pool.df, pQ: pool.pQ, I2: pool.I2, stat: pool.mu / pool.se, p: pool.p, stat_name: 'Z' } : null);
const studiesOf = (rows, pool) => {
  const est = rows.map(r => rrStudy(r.e1, r.n1, r.e2, r.n2)), w = est.map(e => (e && pool ? 1 / (e[1] + pool.tau2) : 0)), sw = w.reduce((s, x) => s + x, 0);
  return rows.map((r, i) => ({ sid: r.sid, study: r.study, e1: r.e1, n1: r.n1, e2: r.e2, n2: r.n2, est: est[i] ? { y: est[i][0], v: est[i][1] } : null, weight: est[i] && sw > 0 ? (100 * w[i]) / sw : null }));
};
/** A comparison's two sides as its arms are named: the facet levels of its definition, else the sides its title names. */
export function sidesOf(model, rec) {
  const def = [...(model?.comparisons || [])].find(d => d.code === rec.code);
  const level = sel => { const [f, ls] = Object.entries(sel?.facets || {})[0] || []; const facet = model?.facets?.find(x => x.id === f); return ls?.length === 1 ? facet?.levels.find(l => l.id === ls[0])?.label || null : null; };
  const a = level(def?.a), b = level(def?.b);
  return a && b ? [a, b] : sidesOfTitle(rec.grouping) || ['Intervention', 'Comparator'];
}
/** The forest's options of one comparison on one outcome (s.synthesis.forests, lib/forest-options.mjs), a `forest/<key>` kind's subgroups over them. */
export const forestKey = (code, outcomeId) => `${code}|${outcomeId}`;
export function optionsOf(model, rec, by = null) {
  const o = forestOptions(model?.forests?.[forestKey(rec.code, rec.outcomeId)]);
  return by != null && by !== '' ? { ...o, by } : o;
}
/**
 * The revmanForest spec of a comparative record. Without a pool (fewer than two estimable studies, or `opts.pool` false, as the review's
 * Figure 3 is drawn) the study estimates stand alone: no diamond, no weights. `groups` ([{ name, rows }], from subgroupsOf) splits the
 * studies; with subtotals each subgroup is pooled on its own with the test for subgroup differences and no overall pool, without them the
 * subgroups are headings over one overall pool. `opts` (lib/forest-options.mjs): the events and follow-up columns, the favours labels, the
 * axis.
 */
export function forestSpec(rec, { groups = null, rob = null, opts = null, sides = null } = {}) {
  const o = forestOptions(opts), [sa, sb] = sides || sidesOfTitle(rec.grouping) || ['intervention', 'comparator'], ax = ratioAxis(o.axis);
  const base = { measure: 'RR', method: 'IV', model: 'random', tau2: 'REML', ci: 'Wald', experimental: sides ? up(sa) : 'Intervention', control: sides ? up(sb) : 'Comparator',
    favours: favoursOf(sa, sb, o), footnotes: [], decimals: 2, title: `Forest plot: ${rec.grouping}, ${rec.outcome}`, ...(o.events ? {} : { armColumns: false }), ...(ax ? { scale: Number(o.axis), ticks: ax.ticks } : {}) };
  // each study's overall risk of bias, where its assessment is complete (model.rob), in a column of its own, the instruments named in a footnote
  const judged = rob ? rec.rows.map(r => rob.get(r.sid)).filter(Boolean) : [];
  // each study's follow-up in months (one number where both arms share it), and its overall risk of bias where its assessment is complete
  const fuOf = r => { const a = Math.round(r.fu1 || 0), b = Math.round(r.fu2 || 0); return !a && !b ? 'NR' : !b || a === b ? String(a || b) : `${a} / ${b}`; };
  const hasFu = o.fu && rec.rows.some(r => r.fu1 > 0 || r.fu2 > 0);
  base.extraColumns = [...(hasFu ? [{ key: 'fu', header: ['Follow-up', '(mo)'] }] : []), ...(judged.length ? [{ key: 'rob', header: ['Risk of', 'bias'] }] : [])];
  if (judged.length) base.footnotes = [`Risk of bias: overall judgement, ${[...new Set(judged.map(j => j.tool))].join(', ')}.`];
  const fuBy = new Map(rec.rows.map(r => [r.sid, fuOf(r)]));
  const withRob = list => list.map(x => ({ ...x, ...(hasFu ? { fu: fuBy.get(x.sid) } : {}), ...(judged.length ? { rob: rob.get(x.sid)?.overall || 'Not assessed' } : {}) }));
  const pool = o.pool ? rec.pool : null;
  if (groups) {
    if (!o.pool) return { ...base, pooled: false, overall: false, total: null, groups: groups.map(g => ({ name: g.name, studies: withRob(studiesOf(g.rows, null)), result: null, weight: 100 })), subgroupTest: null };
    if (!o.subtotals) {
      // one pool over every study: the weights are shares of it, the subgroups only headings
      const all = new Map(studiesOf(rec.rows, pool).map(x => [x.sid, x]));
      return { ...base, pooled: Boolean(pool), overall: Boolean(pool), total: resultOf(pool), groups: groups.map(g => ({ name: g.name, studies: withRob(g.rows.map(r => all.get(r.sid))), result: null, weight: 0 })), subgroupTest: null, subtotalRows: false };
    }
    const pools = groups.map(g => poolRr(g.rows)), sq = subgroupQ(pools);
    return { ...base, pooled: pools.some(Boolean), overall: false, total: null,
      groups: groups.map((g, i) => ({ name: g.name, studies: withRob(studiesOf(g.rows, pools[i])), result: resultOf(pools[i]), weight: 100 })),
      subgroupTest: sq ? { ...sq, I2: sq.Q > 0 ? Math.max(0, (sq.Q - sq.df) / sq.Q) * 100 : 0 } : null };
  }
  return { ...base, pooled: Boolean(pool), overall: Boolean(pool), groups: [{ name: null, studies: withRob(studiesOf(rec.rows, pool)), result: null, weight: 100 }], total: resultOf(pool), subgroupTest: null };
}
/**
 * The ways the studies of a comparative record can be split: by the level of a field (a facet) of each study's intervention arm, by whether
 * its two arms share that level ("Same intervention type", "Different intervention type"), or by the text of one of the table's columns in
 * the intervention arm. Only the splits that give two subgroups or more: [[key, label]].
 */
export function subgroupChoices(model, rec) {
  const contrasted = String(rec.code).split(/[:|=/]/)[0], out = [];
  for (const f of model.facets || []) {
    if (f.derive) continue;
    if (f.id !== contrasted) out.push([f.id, `By ${f.label.toLowerCase()}`]);
    out.push([`same:${f.id}`, `By whether the arms share the ${f.label.toLowerCase()}`]);
  }
  const lower = t => (/^[A-Z][A-Z0-9]/.test(t) ? t : t.replace(/^./, x => x.toLowerCase()));
  for (const c of model.columns || []) if (!out.some(([, l]) => l === `By ${lower(c.label)}`)) out.push([`col:${c.id}`, `By ${lower(c.label)}`]);
  return out.filter(([k]) => subgroupsOf(model, rec, k));
}
/**
 * The studies of a comparative record split by `key` (subgroupChoices): a facet's id (the intervention arm's level, unset last), `same:<facet>`
 * (both arms at one level, or not) or `col:<column>` (the intervention arm's text in the column, two to six values). [{ name, rows }] or null.
 */
export function subgroupsOf(model, rec, key) {
  const k = String(key || ''), armOf = (r, label) => model.arms?.find(a => a.sid === r.sid && a.label === label);
  if (k.startsWith('same:')) {
    const f = model.facets?.find(x => x.id === k.slice(5)); if (!f) return null;
    const same = r => { const a = armOf(r, r.arm1)?.facets?.[f.id], b = armOf(r, r.arm2)?.facets?.[f.id]; return a != null && b != null ? a === b : null; };
    const word = f.label.replace(/^./, c => c.toLowerCase());
    const out = [[true, `Same ${word}`], [false, `Different ${word}`], [null, `${f.label} not set`]].map(([v, name]) => ({ name, rows: rec.rows.filter(r => same(r) === v) })).filter(g => g.rows.length);
    return out.length > 1 ? out : null;
  }
  if (k.startsWith('col:')) {
    const col = k.slice(4), text = r => String(armOf(r, r.arm1)?.cells?.[col] ?? '').replace(/\s+/g, ' ').trim() || 'Not reported';
    const values = [...new Set(rec.rows.map(text))];
    // a split is worth drawing when some value is shared by two studies or more: a column whose every study has its own text names the studies again
    if (values.length < 2 || values.length > 6 || values.length >= rec.rows.length || values.some(v => v.length > 48)) return null;
    return values.map(v => ({ name: v, rows: rec.rows.filter(r => text(r) === v) }));
  }
  const f = model.facets?.find(x => x.id === k);
  if (!f) return null;
  const levelOf = r => armOf(r, r.arm1)?.facets?.[k], name = id => f.levels.find(l => l.id === id)?.label || 'Not set';
  const order = [...f.levels.map(l => l.id), undefined], out = order.map(id => ({ name: name(id), rows: rec.rows.filter(r => levelOf(r) === id || (id === undefined && !f.levels.some(l => l.id === levelOf(r)))) })).filter(g => g.rows.length);
  return out.length > 1 ? out : null;
}
/** What a subgroup key splits by, in words: "Intervention type", "whether the arms share the intervention type", a column's name. */
export function subgroupLabel(model, key) {
  const k = String(key || ''), f = id => model.facets?.find(x => x.id === id);
  if (k.startsWith('same:')) return `whether the arms share the ${(f(k.slice(5))?.label || k.slice(5)).toLowerCase()}`;
  if (k.startsWith('col:')) return model.columns?.find(c => c.id === k.slice(4))?.label || k.slice(4);
  return f(k)?.label || k;
}
export const forestSvg = (rec, opts) => revmanForest(forestSpec(rec, opts));

// ---- effect direction ---------------------------------------------------------------------------------------------------------------
/** The mark of one study's direction on one outcome: up (fewer events with the intervention), down, equal, or NR. */
function directionMark(t, cx, cy, kind, { filled = false } = {}) {
  const ls = t.size.label, sm = t.size.small, a = ls * 0.55;
  if (kind === 'up') return `<polygon class="c-mark" points="${r1(cx)},${r1(cy - a)} ${r1(cx - a)},${r1(cy + a * 0.8)} ${r1(cx + a)},${r1(cy + a * 0.8)}" fill="${t.color.ink}"/>`;
  if (kind === 'down') return `<polygon class="c-mark" points="${r1(cx)},${r1(cy + a)} ${r1(cx - a)},${r1(cy - a * 0.8)} ${r1(cx + a)},${r1(cy - a * 0.8)}" fill="${filled ? t.color.ink : t.color.page}" stroke="${t.color.ink}" stroke-width="${t.line.ci}"/>`;
  if (kind === 'equal') return `<line x1="${r1(cx - a)}" y1="${r1(cy)}" x2="${r1(cx + a)}" y2="${r1(cy)}" stroke="${t.color.ink}" stroke-width="${t.line.ci}"/><line x1="${r1(cx - a)}" y1="${r1(cy - a * 0.5)}" x2="${r1(cx + a)}" y2="${r1(cy - a * 0.5)}" stroke="${t.color.ink}" stroke-width="${t.line.ci}"/>`;
  if (kind === 'none') return draw(t, cx, cy + ls * 0.35, '–', { anchor: 'middle' });
  return draw(t, cx, cy + sm * 0.35, 'NR', { anchor: 'middle', role: 'small', cls: 'c-mute' });
}
/** The effect-direction table of one comparison: `records` are its SWiM records, one per outcome, in the order to draw. */
export function swimSvg(records, { style = null } = {}) {
  const t = style || print(), ls = t.size.label, sm = t.size.small, pad = Math.max(t.pad, ls), row = ls * 3.1;
  const outs = records.map(r => r.outcome), studies = [...new Set(records.flatMap(r => r.rows.map(x => x.study)).concat(records.flatMap(r => r.notReported)))];
  const lab = Math.max(measure(t, 'Study', 'label'), ...studies.map(s => measure(t, s))) + ls;
  const colW = Math.max(ls * 7.5, ...outs.map(o => Math.min(measure(t, o) + ls, ls * 12))), W = pad * 2 + lab + colW * outs.length;
  const parts = [], head = ls * 2.6;
  parts.push(draw(t, pad, head - ls * 0.6, 'Study', { role: 'head', cls: 'c-ink c-head' }));
  outs.forEach((o, i) => { const ls2 = wrapText(t, o, colW - ls * 0.6); ls2.slice(0, 2).forEach((l, j) => parts.push(draw(t, pad + lab + colW * i + colW / 2, head - ls * 0.6 - (Math.min(ls2.length, 2) - 1 - j) * ls * LINE, l, { anchor: 'middle', role: 'head', cls: 'c-ink c-head' }))); });
  parts.push(axisLine(t, pad, head, W - pad, head));
  const dir = (cx, cy, kind) => directionMark(t, cx, cy, kind);
  let y = head;
  for (const s of studies) {
    y += row;
    parts.push(draw(t, pad, y - row * 0.45, s));
    records.forEach((r, i) => {
      const x = r.rows.find(q => q.study === s), cx = pad + lab + colW * i + colW / 2;
      if (!x) { parts.push(dir(cx, y - row * 0.55, 'nr')); return; }
      const a = x.e1 / x.n1, b = x.e2 / x.n2;
      parts.push(dir(cx, y - row * 0.62, a < b ? 'up' : a > b ? 'down' : 'equal'), draw(t, cx, y - row * 0.12, `${x.e1}/${x.n1} and ${x.e2}/${x.n2}`, { anchor: 'middle', role: 'small', cls: 'c-mute' }));
    });
    parts.push(hairLine(t, pad, y, W - pad, y));
  }
  y += row * 0.9;
  parts.push(draw(t, pad, y - row * 0.2, 'Favor intervention', { role: 'head', cls: 'c-ink c-head' }));
  records.forEach((r, i) => { const k = r.fav + r.unf; parts.push(draw(t, pad + lab + colW * i + colW / 2, y - row * 0.2, k ? `${r.fav}/${k}` : 'NR', { anchor: 'middle', role: 'head', cls: 'c-ink c-head' })); });
  y += row * 0.55;
  parts.push(draw(t, pad, y - row * 0.2, 'Sign test'));
  records.forEach((r, i) => parts.push(draw(t, pad + lab + colW * i + colW / 2, y - row * 0.2, r.signP == null ? 'NR' : fmtP(r.signP), { anchor: 'middle' })));
  return svgRoot(t, W, y + pad, parts.join(''), { title: `Effect direction: ${records[0]?.grouping || ''}`, desc: `${studies.length} studies, ${outs.length} outcomes` });
}

// ---- effect-direction sheet ------------------------------------------------------------------------------------------------------------
// Several comparisons and single-arm groups of one intervention on one page: for each study its arms (patients, follow-up, the events on each outcome),
// and for a comparison the direction of effect per outcome, then the sign test across its studies and the range of the single-arm cohorts. A sheet is
// `{ id, name, intervention, outcomes: [outcome id], sections: [{ title, arms: { facet: [level] }, versus?: { facet: [level] } }] }` (s.synthesis.sheets);
// a section with `versus` takes the studies whose intervention arm and comparator arm have those levels, one without it the studies with a single arm,
// each study once, in the table's order. Every number is an arm's count.
const inLevels = (a, want) => Object.entries(want || {}).every(([f, ls]) => ls.includes(a.facets?.[f]));
const pct = (e, n) => Math.round((100 * e) / n);
/** The cell of one arm on one outcome: "2/19 (11%)", "0/32", a bound "≤9/26 (≤35%)", or NR. */
function armCell(a, o) {
  const e = a.counts[o], n = a.ns[o], b = a.bounds?.[o];
  if (Number.isFinite(e) && n > 0) return { text: e ? `${e}/${n} (${pct(e, n)}%)` : `0/${n}`, p: e / n };
  if (b) return { text: `≤${b.e}/${b.n} (≤${pct(b.e, b.n)}%)`, p: null };
  return { text: 'NR', p: null };
}
const studyDirection = marks => {
  // an outcome with the same proportion in both arms gives no direction (as the review's SWiM: "=" is not counted)
  const used = marks.filter(m => m !== 'none' && m !== 'equal');
  return !used.length ? null : used.every(m => m === 'up') ? 'up' : used.every(m => m === 'down') ? 'down' : 'mixed';
};
const followUpOf = a => {
  if (!Number.isFinite(a.fu)) return 'NR';
  const cell = Object.entries(a.cells || {}).find(([k]) => /follow_up/.test(k))?.[1] || '';
  // "(cohort)": the value is the whole cohort's (said so in the cell, or an arm with no follow-up of its own)
  return `${/^\s*(≥|>=|at least|min)/i.test(cell) ? '≥' : ''}${Math.round(a.fu)}${a.fuShared || /whole cohort/i.test(cell) ? ' (cohort)' : ''}`;
};
/** The rows of a sheet: { outcomes, sections: [{ title, comparative, studies: [{ study, arms: [{ name, n, fu, cells }], marks }] }], lines } or { error }. */
export function effectsData(model, sheetId) {
  const sheet = (model.sheets || []).find(x => x.id === sheetId);
  if (!sheet) return { error: 'The sheet no longer exists' };
  const outs = (sheet.outcomes || []).map(id => model.outcomes.find(o => o.id === id)).filter(Boolean);
  if (!outs.length) return { error: 'The sheet has no outcome' };
  const levelName = (f, id) => model.facets.find(x => x.id === f)?.levels.find(l => l.id === id)?.label || id;
  // `order` (study labels) puts those studies first, in that order, the rest after them in the table's order; `labels` ({ study: [intervention arm,
  // comparator arm] }) names a study's arms as the figure prints them (a short device name for the table's description)
  const table = [...new Set(model.arms.map(a => a.sid))], labelOf = sid => model.arms.find(a => a.sid === sid)?.study;
  const rank = sid => { const k = (sheet.order || []).indexOf(labelOf(sid)); return k < 0 ? Infinity : k; };
  const order = table.map((sid, k) => [sid, k]).sort((x, y) => rank(x[0]) - rank(y[0]) || x[1] - y[1]).map(x => x[0]);
  const by = new Map(order.map(sid => [sid, model.arms.filter(a => a.sid === sid)]));
  const used = new Set(), sections = [];
  for (const sec of sheet.sections || []) {
    const studies = [];
    for (const sid of order) {
      if (used.has(sid)) continue;
      const arms = by.get(sid), i = arms.find(a => a.role === 'I'), c = arms.find(a => a.role === 'C');
      if (!i || !inLevels(i, sec.arms) || Boolean(c) !== Boolean(sec.versus) || (c && !inLevels(c, sec.versus))) continue;
      used.add(sid);
      const own = sheet.labels?.[i.study];
      const nameOf = (a, k) => (Array.isArray(own) && own[k] ? own[k] : a.armId || a.label !== a.study ? a.label : levelName('device', a.facets?.device) || a.label);
      const cells = a => outs.map(o => armCell(a, o.id));
      const ci = cells(i), cc = c ? cells(c) : null;
      const marks = cc ? ci.map((x, k) => (x.p == null || cc[k].p == null ? 'none' : x.p < cc[k].p ? 'up' : x.p > cc[k].p ? 'down' : 'equal')) : null;
      studies.push({ sid, study: i.study, arms: [i, ...(c ? [c] : [])].map((a, k) => ({ name: nameOf(a, k), n: a.n, fu: followUpOf(a), cells: k ? cc : ci })), marks, dir: marks ? studyDirection(marks) : null });
    }
    if (studies.length) sections.push({ title: sec.title, comparative: Boolean(sec.versus), studies });
  }
  if (!sections.length) return { error: 'No study matches the sheet' };
  // a study at critical overall risk of bias is shown but left out of the sign test when the settings say so (ROBINS-I V2: not for synthesis)
  const critical = sid => model.settings?.signExcludeCritical && /critical/i.test(String(model.rob?.get?.(sid)?.overall ?? model.rob?.get?.(sid) ?? ''));
  const lines = [], cmp = sections.filter(s => s.comparative).flatMap(s => s.studies).filter(s => s.dir && !critical(s.sid));
  if (cmp.length) {
    const fav = cmp.filter(s => s.dir === 'up').length;
    lines.push(`Comparative studies: fewer events with ${sheet.intervention || 'the intervention'} in ${fav} of ${cmp.length} studies with an outcome reported in both arms (sign test P = ${fixed(signP(fav, cmp.length), 2)})`);
  }
  for (const s of sections.filter(x => !x.comparative && x.studies.length > 1)) {
    const parts = outs.map((o, k) => {
      const v = s.studies.map(x => x.arms[0].cells[k].p).filter(p => p != null).map(p => 100 * p);
      if (!v.length) return '';
      const lo = Math.round(Math.min(...v)), hi = Math.round(Math.max(...v));
      return `${k === 0 || /^[A-Z]{2,}/.test(o.name) ? o.name : o.name.replace(/^./, c => c.toLowerCase())} ${lo === hi ? `${lo}%` : `${lo}–${hi}%`} (${v.length} ${v.length === 1 ? 'cohort' : 'cohorts'})`;
    }).filter(Boolean);
    if (parts.length) lines.push(`${s.title}, range: ${parts.join('; ')}`);
  }
  // `signed` the studies the sign test counts (Make's SWiM states the same test, views/make-swim.mjs)
  return { outcomes: outs.map(o => o.name), sections, lines, intervention: sheet.intervention || 'the intervention', name: sheet.name, signed: cmp.map(s => s.sid), filled: sheet.marks === 'filled',
    sign: cmp.length ? { fav: cmp.filter(s => s.dir === 'up').length, k: cmp.length, p: signP(cmp.filter(s => s.dir === 'up').length, cmp.length) } : null };
}

/** The sheet's cells as rows (the header first), for a thumbnail or a data download: study, arm, patients, follow-up, then each outcome's cell. */
export const effectsRows = data => [['Study', 'Arm', 'Patients', 'Follow-up (mo)', ...data.outcomes],
  ...data.sections.flatMap(s => [[s.title], ...s.studies.flatMap(st => st.arms.map((a, i) => [i ? '' : st.study, a.name, String(a.n), a.fu, ...a.cells.map(c => c.text)]))])];

/** The sheet as the table the review prints: study, arm, patients, follow-up, then the outcomes. */
export function effectsSvg(data, { style = null } = {}) {
  const t = style || print(), ls = t.size.label, pad = Math.max(t.pad, ls), row = ls * 2.1, outs = data.outcomes;
  const all = data.sections.flatMap(s => s.studies), arms = all.flatMap(s => s.arms);
  const studyW = Math.max(measure(t, 'Study', 'head'), ...all.map(s => measure(t, s.study))) + ls * 2.2;
  const armW = Math.max(measure(t, 'Arm', 'head'), ...arms.map(a => measure(t, a.name))) + ls * 1.2;
  const nW = Math.max(measure(t, 'Patients', 'head'), ...arms.map(a => measure(t, String(a.n)))) + ls * 1.2;
  const fuW = Math.max(measure(t, 'Follow-up', 'head'), ...arms.map(a => measure(t, a.fu))) + ls * 1.2;
  const colW = outs.map((o, k) => Math.max(...wrapText(t, o, ls * 8, 'head').map(l => measure(t, l, 'head')), ...arms.map(a => measure(t, a.cells[k].text))) + ls * 1.4);
  const x0 = pad, xArm = x0 + studyW, xN = xArm + armW + nW, xFu = xN + fuW, xOut = xFu + ls * 1.8, W = xOut + colW.reduce((a, b) => a + b, 0) + pad;
  const cx = k => xOut + colW.slice(0, k).reduce((a, b) => a + b, 0) + colW[k] / 2;
  // the head is as tall as its longest label (two lines at most) and every label stands on one baseline above the rule, its lines growing
  // upward: a second line no longer falls on the rule (owner, 2026-10-23)
  const wrapped = outs.map((o, k) => wrapText(t, o, colW[k] - ls * 0.4, 'head').slice(0, 2)), lines = Math.max(2, ...wrapped.map(w => w.length));
  const parts = [], head = ls * (1.2 * lines + 1.5), base = head - ls * 0.9, at = (n, j) => base - (n - 1 - j) * ls * 1.2;
  const H = { role: 'head', cls: 'c-ink c-head' };
  parts.push(draw(t, x0, base, 'Study', H), draw(t, xArm, base, 'Arm', H), draw(t, xN, base, 'Patients', { ...H, anchor: 'end' }),
    draw(t, xFu, at(2, 0), 'Follow-up', { ...H, anchor: 'end' }), draw(t, xFu, at(2, 1), '(mo)', { ...H, anchor: 'end' }));
  wrapped.forEach((wl, k) => wl.forEach((l, j) => parts.push(draw(t, cx(k), at(wl.length, j), l, { ...H, anchor: 'middle' }))));
  parts.push(axisLine(t, x0, head, W - pad, head));
  let y = head;
  for (const s of data.sections) {
    y += row; parts.push(draw(t, x0, y - row * 0.3, s.title, { role: 'head', cls: 'c-ink c-head' }));
    for (const st of s.studies) {
      st.arms.forEach((a, i) => {
        y += row; const by = y - row * 0.3;
        if (!i) parts.push(draw(t, x0 + ls * 1.2, by, st.study));
        parts.push(draw(t, xArm, by, a.name), draw(t, xN - ls * 0.6, by, String(a.n), { anchor: 'end' }), draw(t, xFu - ls * 0.6, by, a.fu, { anchor: 'end' }));
        a.cells.forEach((c, k) => parts.push(draw(t, cx(k), by, c.text, { anchor: 'middle' })));
      });
      if (st.marks) {
        y += row; parts.push(draw(t, xArm, y - row * 0.3, 'Direction of effect', { cls: 'c-mute', attrs: ' font-style="italic"' }));
        // sheet.marks 'filled': "more events" a filled ▼, as a legend that names ▲ and ▼ reads (else an open triangle)
        st.marks.forEach((m, k) => parts.push(directionMark(t, cx(k), y - row * 0.45, m, { filled: data.filled })));
      }
    }
  }
  parts.push(axisLine(t, x0, y + row * 0.35, W - pad, y + row * 0.35));
  y += row * 1.1;
  for (const l of data.lines) for (const w of wrapText(t, l, W - pad * 2)) { parts.push(draw(t, x0, y, w)); y += row * 0.75; }
  return svgRoot(t, W, y + pad * 0.5, parts.join(''), { title: data.name || 'Effect direction', desc: `${all.length} studies, ${outs.length} outcomes` });
}

// ---- proportions ---------------------------------------------------------------------------------------------------------------------
/** The proportion forest of one grouping on one outcome: each subgroup's arms with exact intervals, its pooled proportion, then the test for the difference. */
export function proportionSvg(rec, { style = null, width = null } = {}) {
  const t = style || print(), ls = t.size.label, sm = t.size.small, pad = Math.max(t.pad, ls), rowH = ls * 1.9;
  const W = width || t.width.double;
  const subs = rec.subgroups.filter(s => s.rows.length), rows = [];
  for (const [si, s] of subs.entries()) {
    if (subs.length > 1 || s.name) rows.push({ k: 'head', label: s.name });
    s.rows.forEach((r, i) => {
      const [lo, hi] = clopperPearson(r.e, r.n), pool = s.pool;
      rows.push({ k: 'arm', label: `${r.study}${r.role === 'C' ? ', comparator' : ''}`, e: r.e, n: r.n, p: (100 * r.e) / r.n, lo: 100 * lo, hi: 100 * hi, w: pool ? pool.weights[i] : null });
    });
    if (s.pool) rows.push({ k: 'pool', label: subs.length > 1 ? 'Subtotal' : 'Pooled proportion', e: s.rows.reduce((a, x) => a + x.e, 0), n: s.rows.reduce((a, x) => a + x.n, 0), p: s.pool.p, lo: s.pool.lo, hi: s.pool.hi, pool: s.pool });
    if (s.pool) rows.push({ k: 'het', label: `Heterogeneity: Tau² = ${one(s.pool.tau2, 2)}; Chi² = ${one(s.pool.Q, 2)}, df = ${s.pool.df} (${s.pool.df > 0 ? fmtP(1 - chiSf(s.pool.Q, s.pool.df)) : 'NA'}); I² = ${one(s.pool.I2, 0)}%` });
    if (si < subs.length - 1) rows.push({ k: 'gap' });
  }
  if (rec.subgroupTest) rows.push({ k: 'gap' }, { k: 'het', label: `Test for subgroup differences: Chi² = ${one(rec.subgroupTest.Q, 2)}, df = ${rec.subgroupTest.df} (${fmtP(rec.subgroupTest.p)})` });
  const maxCi = Math.max(5, ...rows.filter(r => r.hi != null).map(r => r.hi)), nice = niceTicks(0, maxCi, 5), ticks = nice.ticks, top = nice.hi > 0 ? nice.hi : maxCi;
  const labW = Math.min(W * 0.34, Math.max(...rows.filter(r => r.label).map(r => measure(t, r.label))) + ls), cntW = Math.max(measure(t, 'Events/total', 'head'), measure(t, '000/0000')) + ls * 1.5, effW = Math.max(measure(t, 'Proportion, % [95% CI]', 'head'), measure(t, '00.0 [00.0, 00.0]')) + ls * 1.5;
  const plotL = pad + labW + cntW + effW + ls * 1.2, plotR = W - pad, X = v => plotL + (v / top) * (plotR - plotL);
  const parts = [], head = ls * 2.2;
  parts.push(draw(t, pad, head - ls * 0.5, 'Study or subgroup', { role: 'head', cls: 'c-ink c-head' }), draw(t, pad + labW + cntW, head - ls * 0.5, 'Events/total', { anchor: 'end', role: 'head', cls: 'c-ink c-head' }),
    draw(t, pad + labW + cntW + effW, head - ls * 0.5, 'Proportion, % [95% CI]', { anchor: 'end', role: 'head', cls: 'c-ink c-head' }), axisLine(t, pad, head, W - pad, head));
  let y = head;
  for (const r of rows) {
    if (r.k === 'gap') { y += rowH * 0.5; continue; }
    y += rowH; const cy = y - rowH * 0.38;
    if (r.k === 'head') { parts.push(draw(t, pad, cy + sm * 0.35, r.label, { role: 'head', cls: 'c-ink c-head' })); continue; }
    if (r.k === 'het') { parts.push(draw(t, pad, cy + sm * 0.35, r.label, { role: 'small', cls: 'c-mute' })); continue; }
    const bold = r.k === 'pool', opt = { role: bold ? 'head' : 'label', cls: bold ? 'c-ink c-head' : 'c-ink' };
    parts.push(draw(t, pad, cy + sm * 0.35, r.label, opt), draw(t, pad + labW + cntW, cy + sm * 0.35, `${r.e}/${r.n}`, { ...opt, anchor: 'end' }), draw(t, pad + labW + cntW + effW, cy + sm * 0.35, `${one(r.p)} [${one(r.lo)}, ${one(r.hi)}]`, { ...opt, anchor: 'end' }));
    if (r.k === 'pool') parts.push(`<polygon class="c-mark" points="${r1(X(r.lo))},${r1(cy)} ${r1(X(r.p))},${r1(cy - ls * 0.5)} ${r1(X(r.hi))},${r1(cy)} ${r1(X(r.p))},${r1(cy + ls * 0.5)}" fill="${t.color.ink}"/>`);
    else {
      const side = ls * (0.45 + 0.5 * Math.sqrt((r.w ?? 100 / 5) / 100) * 1.6);
      parts.push(`<line class="c-ci" x1="${r1(X(r.lo))}" y1="${r1(cy)}" x2="${r1(X(r.hi))}" y2="${r1(cy)}" stroke="${t.color.ink}" stroke-width="${t.line.ci}"/><rect class="c-mark" x="${r1(X(r.p) - side / 2)}" y="${r1(cy - side / 2)}" width="${r1(side)}" height="${r1(side)}" fill="${t.color.ink}"/>`);
    }
  }
  y += rowH * 0.6;
  parts.unshift(axisLine(t, plotL, head, plotL, y));
  parts.push(axisLine(t, plotL, y, plotR, y));
  for (const v of ticks) if (v <= top) parts.push(axisLine(t, X(v), y, X(v), y + sm * 0.4), draw(t, X(v), y + sm * 1.6, String(v), { anchor: 'middle', role: 'small', cls: 'c-mute' }));
  parts.push(draw(t, (plotL + plotR) / 2, y + sm * 3.1, 'Proportion with the event, %', { anchor: 'middle', role: 'small', cls: 'c-mute' }));
  return svgRoot(t, W, y + sm * 4.2 + pad * 0.5, parts.join(''), { title: `${rec.grouping}, ${rec.outcome}`, desc: rec.method });
}
import { chi2Sf as chiSf } from './synth-stats.mjs';

// ---- legends -------------------------------------------------------------------------------------------------------------------------
const cap = s => s.replace(/^./, c => c.toUpperCase());
// lower case for the middle of a sentence, except an abbreviation (ASD, PJK) or a name
const lc = s => (/^[A-Z][A-Z0-9]/.test(s) ? s : s.replace(/^./, c => c.toLowerCase()));
/** What an outcome is, in words: its parts and the rule that joins them (the same phrase every time it means the same thing). */
export function outcomeDefinition(outcome, nameOf = id => id) {
  if (!outcome || outcome.rule === 'reported') return '';
  const parts = outcome.parts.map(p => (typeof p === 'string' ? lc(nameOf(p)) : lc(p.name || 'a component'))), join = parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}` : parts[0];
  return `${cap(outcome.name)} was defined as ${outcome.rule === 'sum' ? `the sum of the numbers of patients with ${join}, not exceeding the number of patients` : `the larger of the numbers of patients with ${join}, because the overlap between them was not reported`}.`;
}
const ABBR = { CI: 'confidence interval', REML: 'restricted maximum likelihood', RR: 'risk ratio', SWiM: 'synthesis without meta-analysis' };
/** The formal legend of a figure: what it shows, how it was computed, the outcome's definition, the abbreviations used. No study is named. */
export function legendFor(kind, rec, { outcome = null, nameOf, by = '', pooled = true, subtotals = true } = {}) {
  const def = outcomeDefinition(outcome, nameOf), used = [];
  const abbr = list => { for (const a of list) if (!used.includes(a)) used.push(a); };
  let body;
  if (kind === 'forest') {
    const grouped = by ? ` Studies are grouped by ${lc(by)}.` : '';
    body = !pooled ? `Risk ratios of ${lc(rec.outcome)} for ${lc(rec.grouping)} in each study, not pooled.${grouped} Confidence intervals are Wald-type. A study with a zero cell had 0.5 added to every cell; a study without events in either arm was not estimable.`
      : !rec.pool && !by ? `Risk ratios of ${lc(rec.outcome)} for ${lc(rec.grouping)} in each study, not pooled because fewer than two studies were estimable. Confidence intervals are Wald-type. A study with a zero cell had 0.5 added to every cell; a study without events in either arm was not estimable.`
      : `Risk ratios of ${lc(rec.outcome)} for ${lc(rec.grouping)}, pooled by inverse-variance random-effects meta-analysis${by && subtotals ? ` within each subgroup of ${lc(by)}` : ''}.${by && !subtotals ? grouped : ''} The between-study variance was estimated by restricted maximum likelihood and confidence intervals are Wald-type. A study with a zero cell had 0.5 added to every cell; a study without events in either arm was not estimable.${by && subtotals ? ' The test for subgroup differences is a chi-squared test on the pooled subgroup estimates.' : ''} Square size is proportional to the study's weight and the diamond is the pooled risk ratio.`;
    abbr(pooled ? ['CI', 'REML'] : ['CI']);
  } else if (kind === 'effects') {
    body = `Events on each outcome in each arm of the studies of ${rec.intervention}, as the number of patients with the event over the number analysed (percent); NR marks an outcome not reported in an arm, and a bound is shown as reported. For comparative studies an upward triangle marks a lower proportion with the event in the intervention arm, a hollow downward triangle a higher proportion, two bars an equal proportion and a dash an outcome not reported in both arms. Results were not pooled. The sign test is a two-sided exact binomial test of the studies with a direction, a study counting as favoring the intervention when every outcome with a difference between the arms is lower with it; an equal proportion gives no direction. Follow-up is in months; a lower bound is marked ≥. For single-arm cohorts the range of the event proportions is given.`;
    abbr(['NR']);
  } else if (kind === 'swim') {
    body = `Direction of effect on ${lc(rec.grouping)} for each outcome. An upward triangle marks a lower proportion of patients with the event in the intervention arm, a hollow downward triangle a higher proportion, and two bars an equal proportion; NR marks an outcome not reported in both arms. Events are given as the number of patients with the event over the number analysed in the intervention and the comparator arm. The sign test is a two-sided exact binomial test of the studies that give a direction.`;
    abbr(['NR', 'SWiM']);
  } else {
    body = `Proportion of patients with ${lc(rec.outcome)} in ${lc(rec.grouping)}. Intervals for single arms are exact (Clopper–Pearson). ${rec.method.includes('logit') ? 'Proportions were pooled on the logit scale by random-effects meta-analysis with restricted maximum likelihood, with a multilevel model where a study contributed two arms; 0.5 was added to the events and non-events of an arm with no events or all events' : 'Proportions were pooled on the Freeman–Tukey double arcsine scale by random-effects meta-analysis with restricted maximum likelihood, and back-transformed with the harmonic mean of the sample sizes'}${rec.subgroups.length > 1 ? '; the test for subgroup differences is a chi-squared test on the pooled subgroup estimates' : ''}. Square size is proportional to the arm's weight and the diamond is the pooled proportion.`;
    abbr(['CI', 'REML']);
  }
  const names = used.map(a => `${a}, ${ABBR[a] || (a === 'NR' ? 'not reported' : a)}`);
  return [body, def, names.length ? `${names.join('; ')}.` : ''].filter(Boolean).join(' ');
}

/** One figure of a record for a package or a download: { svg, title, legend }, or { error }. */
export function figureOf(model, kind, outcomeId, code) {
  if (kind === 'effects') {
    const d = effectsData(model, code);
    return d.error ? d : { svg: effectsSvg(d), title: d.name || 'Effect direction', legend: legendFor('effects', d, {}) };
  }
  const recs = model.records.filter(r => r.code === code);
  if (!recs.length) return { error: 'The combination no longer exists' };
  const o = model.outcomes.find(x => x.id === outcomeId);
  const nameOf = id => model.outcomes.find(x => x.id === id)?.name || id;
  const [base, byId] = String(kind).split('/');
  if (base === 'forest') {
    const r = recs.find(x => x.outcomeId === outcomeId && x.method.startsWith('Meta'));
    if (!r?.rows.some(x => rrStudy(x.e1, x.n1, x.e2, x.n2))) return { error: 'No study of this comparison is estimable' };
    // the forest's own options (s.synthesis.forests); a `forest/<key>` kind asks for those subgroups over them
    // `names` prints a subgroup under the review's own heading ("Same construct type" for "Same intervention type")
    const fo = optionsOf(model, r, byId), made = fo.by ? subgroupsOf(model, r, fo.by) : null, by = made ? subgroupLabel(model, fo.by) : '';
    const groups = made && fo.names ? made.map(g => ({ ...g, name: fo.names[g.name] || g.name })) : made;
    if (byId && !made) return { error: 'Every study of this comparison has the same level' };
    const robNote = `${fo.fu && r.rows.some(x => x.fu1 > 0 || x.fu2 > 0) ? ' Follow-up is in months, intervention and comparator arms where they differ.' : ''}${fo.rob && r.rows.some(x => model.rob?.has(x.sid)) ? ' The overall risk of bias of each study is given beside it.' : ''}`;
    const legend = legendFor('forest', r, { outcome: o, nameOf, by, pooled: fo.pool, subtotals: fo.subtotals });
    return { svg: forestSvg(r, { groups, rob: fo.rob ? model.rob : null, opts: fo, sides: fo.sides || sidesOf(model, r) }), title: `${r.grouping}: ${r.outcome}${by ? `, by ${lc(by)}` : ''}`, options: fo, subgroups: groups,
      legend: (fo.pool ? legend.replace(/(Square size)/, `${robNote.trim()} $1`.trimStart()) : `${legend}${robNote}`).replace(/\s+/g, ' ').trim() };
  }
  if (kind === 'swim') {
    const list = recs.filter(x => x.method.startsWith('SWiM') && (!outcomeId || outcomeId === '*' || x.outcomeId === outcomeId) && x.rows.length);
    if (!list.length) return { error: 'No study reports this outcome in both arms' };
    return { svg: swimSvg(list), title: `${list[0].grouping}: effect direction`, legend: legendFor('swim', list[0], { outcome: o, nameOf }) };
  }
  const r = recs.find(x => x.outcomeId === outcomeId && x.family === 'Proportions');
  if (!r?.subgroups.some(s => s.rows.length)) return { error: 'No arm reports this outcome' };
  return { svg: proportionSvg(r), title: `${r.grouping}: ${r.outcome}`, legend: legendFor('proportions', r, { outcome: o, nameOf }) };
}

// ---- the app's own drawing, for the screen ------------------------------------------------------------------------------------------
const screen = () => figureTokens(null, { medium: 'screen', profile: 'lykos-house' });
/** A grouping's record in the shape of a saved proportion, so the house forest of Analysis draws it (lib/forest-page.mjs). */
function analysisShape(rec) {
  const subs = rec.subgroups.filter(s => s.rows.length), arms = subs.flatMap(s => s.rows.map((r, i) => ({ ...r, sub: s.name, w: s.pool?.weights[i] ?? null }))), ci = arms.map(r => clopperPearson(r.e, r.n));
  const one = subs.length === 1 ? subs[0].pool : null;
  // a saved proportion gives each arm in percent and its pooled values as fractions (lib/pooled-r.mjs); the same here, so arms and totals read alike
  return { derived: true, method: 'Freeman–Tukey', outcomeName: rec.outcome, labels: arms.map(r => `${r.study}${r.role === 'C' ? ', comparator' : ''}`), study_est: arms.map(r => (100 * r.e) / r.n), study_lo: ci.map(c => 100 * c[0]), study_hi: ci.map(c => 100 * c[1]),
    weights: arms.map(r => r.w), ...(one ? { estimate: one.p / 100, lo: one.lo / 100, hi: one.hi / 100, i2: one.I2, tau2: one.tau2, q: one.Q } : {}),
    ...(subs.length > 1 ? { mod_kind: 'group', modValues: arms.map(r => r.sub), mod_levels: subs.map(s => s.name), mod_k: subs.map(s => s.rows.length),
      mod_est: subs.map(s => (s.pool ? s.pool.p / 100 : NaN)), mod_lo: subs.map(s => (s.pool ? s.pool.lo / 100 : NaN)), mod_hi: subs.map(s => (s.pool ? s.pool.hi / 100 : NaN)) } : {}) };
}

/** The figure as the app draws it on screen (the house style in the interface's colours): { svg } or { error }. Downloads and the package use figureOf. */
export function screenFigureOf(model, kind, outcomeId, code, { width = 640 } = {}) {
  const f = figureOf(model, kind, outcomeId, code);
  if (f.error) return f;
  const recs = model.records.filter(r => r.code === code);
  // a comparison's forest on screen is the analysis table of lib/analysis-charts.mjs, drawn from the same spec as the print, its options and all
  if (kind.split('/')[0] === 'forest') {
    const rec = recs.find(x => x.outcomeId === outcomeId && x.method.startsWith('Meta')), o = f.options, sides = sidesOf(model, rec);
    const spec = forestSpec(rec, { groups: f.subgroups, opts: o, sides }), Z = 1.959963984540054, ex = Math.exp;
    const study = x => ({ label: x.study, ...(x.est ? { est: ex(x.est.y), lo: ex(x.est.y - Z * Math.sqrt(x.est.v)), hi: ex(x.est.y + Z * Math.sqrt(x.est.v)) } : { est: NaN, lo: NaN, hi: NaN, tip: `${x.study}: not estimable` }),
      ...(spec.pooled && x.weight != null ? { weight: x.weight } : {}), cells: { a: `${x.e1}/${x.n1}`, b: `${x.e2}/${x.n2}`, ...(x.fu ? { fu: x.fu } : {}) }, attrs: { 'data-study': x.study } });
    const diamond = (label, r) => (r ? [{ pooled: true, label, est: ex(r.mu), lo: ex(r.lo), hi: ex(r.hi) }] : []);
    const rows = spec.groups.flatMap(g => [...(g.name != null ? [{ heading: g.name }] : []), ...g.studies.map(study), ...(spec.pooled && g.result ? diamond(`Subtotal (k = ${g.studies.length})`, g.result) : [])]);
    if (spec.overall && spec.total) rows.push(...diamond('Total (REML model)', spec.total));
    const cols = [...(o.fu && spec.extraColumns.some(c => c.key === 'fu') ? [{ key: 'fu', head: 'Follow-up (mo)', keep: 1 }] : []), ...(o.events ? [{ key: 'a', head: up(sides[0]), keep: 2 }, { key: 'b', head: up(sides[1]), keep: 2 }] : [])];
    const svg = forestTable(rows, { width, log: true, ref: 1, xLabel: 'Risk ratio', favours: spec.favours, cols, axis: ratioAxis(o.axis), title: f.title });
    const p = spec.overall ? rec.pool : null;
    return { ...f, svg, het: p ? `I² ${Math.round(p.I2)}%, τ² ${p.tau2.toFixed(2)}, Q ${p.Q.toFixed(2)} (df ${p.df}, ${fmtP(p.pQ)})` : spec.subgroupTest ? `Subgroup difference: Chi² ${spec.subgroupTest.Q.toFixed(2)}, df ${spec.subgroupTest.df}, ${fmtP(spec.subgroupTest.p)}` : '' };
  }
  if (kind.includes('/')) return f;
  if (kind === 'effects') return { ...f, svg: effectsSvg(effectsData(model, code), { style: screen() }) };
  if (kind === 'swim') return { ...f, svg: swimSvg(recs.filter(x => x.method.startsWith('SWiM') && x.rows.length), { style: screen() }) };
  const rec = recs.find(x => x.outcomeId === outcomeId && x.family === 'Proportions');
  const a = analysisShape(rec), data = forestData(a);
  if (!data) return f;
  if (!a.estimate) data.overall = null;  // unpooled: the studies alone
  const all = data.rows.length + data.groups.length + 1;
  return { ...f, svg: forestPageSvg(data, { page: 1, size: all, width, style: screen(), het: a.estimate ? heterogeneityLine(a) : '', weights: a.weights, title: f.title }).svg };
}

// ---- the figure sheet ---------------------------------------------------------------------------------------------------------------------
const SHEET_FLOOR = ['Usable', 'Usable with caveat', 'Usable, descriptive', 'Exploratory only'];
/**
 * Every combination of `records` in one document (lib/svg-pdf.mjs documentPdf items): a table of them all (combination, outcome, method, verdict,
 * result), then the figure of each at Exploratory only or better that can be drawn (a forest plot, a comparison's effect-direction table once, a
 * proportion forest), each with its formal legend. Numbers are those of the records; nothing is added to the package.
 */
export function figureSheet(model, records) {
  const rows = [{ cells: ['Combination', 'Outcome', 'Method', 'Verdict', 'Result'] }, ...records.map(r => ({ cells: [r.grouping, r.outcome, r.method.split(' (')[0], r.verdict, r.result || ''] }))];
  const items = [{ caption: 'Table 1. Combinations, verdicts and results.', grid: { rows } }], seenSwim = new Set();
  let n = 0;
  for (const r of records) {
    if (!SHEET_FLOOR.includes(r.verdict)) continue;
    const kind = r.method.startsWith('Meta') ? 'forest' : r.method.startsWith('SWiM') ? 'swim' : 'proportions';
    if (kind === 'swim') { if (seenSwim.has(r.code)) continue; seenSwim.add(r.code); }
    const f = figureOf(model, kind, kind === 'swim' ? '*' : r.outcomeId, r.code);
    if (f.error) continue;
    items.push({ caption: `Figure ${++n}. ${f.title}.`, legend: f.legend, svg: f.svg });
  }
  return items;
}
