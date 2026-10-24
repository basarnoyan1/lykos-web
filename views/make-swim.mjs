// Make's SWiM (views/summary-make.mjs; Campbell 2020, synthesis without meta-analysis): each study's direction of effect, as an effect
// direction plot (one row per study under its group's band, the mark sized by the study's n), the votes by direction per group with the
// exact sign test (lib/swim-core.mjs), the SWiM items the panel can state, and the harvest plot as Certainty draws it (lib/swim.mjs).
// Its sources, in this order: the project's effect-direction sheets from Syntheses (lib/synth-figures.mjs effectsData: the sheet's studies,
// outcomes, directions and sign test, drawn as Syntheses draws it), the project's defined outcomes with two arms (each study's direction
// from its arms' counts, lib/synth.mjs outcomeIn), then the counted or changing measures of the table's fields (lib/make-swim.mjs). The
// summary's filter narrows each. Added to Certainty's SWiM, whose table and harvest plot Tables and figures then lists.
import { esc, emptyState } from '../lib/html.mjs';
import { plural } from '../lib/dates.mjs';
import { directionChart } from '../lib/charts.mjs';
import { harvestChart } from '../lib/analysis-charts.mjs';
import { signTest, SWIM_ITEMS } from '../lib/swim-core.mjs';
import { leveled, measuresOf, studySizes } from '../lib/make-sources.mjs';
import { directionsOf } from '../lib/make-swim.mjs';
import { fmtP } from '../lib/make-stats.mjs';
import { pairOf, outcomeIn } from '../lib/synth.mjs';
import { effectsData, screenFigureOf } from '../lib/synth-figures.mjs';
import { synthOf } from './make-meta.mjs';

const up = t => String(t).replace(/^./, c => c.toUpperCase());
/** A sheet's name in the pick: what its caption says it synthesizes ("the studies of two-stage surgery"), else its intervention. */
export const sheetName = sh => up(String(sh.name || '').replace(/^synthesis without meta-analysis of\s+(the\s+)?(studies\s+of\s+)?/i, '').replace(/[.\s]+$/, '') || sh.intervention || sh.id);

/** Each study with an intervention and a comparator arm that both give the outcome: { sid, study, e1, n1, e2, n2 }, in the table's order. */
export function armPairs(syn, outcome) {
  const out = [];
  for (const sid of [...new Set(syn.arms.map(a => a.sid))]) {
    const p = pairOf(syn.arms, sid, {}); if (!p) continue;
    const a = outcomeIn(p[0], outcome), b = outcomeIn(p[1], outcome);
    if (a && b && a.n > 0 && b.n > 0) out.push({ sid, study: p[0].study, e1: a.value, n1: a.n, e2: b.value, n2: b.n });
  }
  return out;
}

/**
 * A sheet narrowed to the studies kept: its effectsData over the kept studies' arms, with each comparative study's direction as Make reads
 * one (▲ fewer events with the intervention on every outcome with a difference, ▼ more on every one, mixed otherwise) and whether the
 * sign test counts it (a study at critical risk of bias does not when the settings say so). { data, model, rows } or { error }.
 */
export function sheetSource(syn, sheetId, kept) {
  const model = { ...syn, arms: syn.arms.filter(a => kept.has(a.sid)) }, data = effectsData(model, sheetId);
  if (data.error) return { error: data.error };
  const counted = new Set(data.signed), DIR = { up: 'benefit', down: 'harm', mixed: 'no clear' };
  const rows = data.sections.filter(s => s.comparative).flatMap(s => s.studies.filter(x => x.dir).map(x => ({ paperId: x.sid, label: x.study, group: s.title,
    direction: DIR[x.dir], counted: counted.has(x.sid), n: x.arms.reduce((t, a) => t + (a.n || 0), 0) || null,
    value: x.marks.map(m => (m === 'up' ? '▲' : m === 'down' ? '▼' : m === 'equal' ? '=' : '–')).join(' ') })));
  return { data, model, rows };
}

export function swimHtml(ctx, kit) {
  const mk = ctx.make, fields = ctx.fields, kept = ctx.kept, { pick } = kit;
  const ms = measuresOf(fields, ['tally', 'change']).filter(x => !x.free), syn = synthOf(ctx.st);
  const sheets = syn ? syn.sheets.filter(sh => !effectsData(syn, sh.id).error) : [];
  const defined = syn ? syn.outcomes.filter(o => armPairs(syn, o).length) : [];
  const options = [...sheets.map(sh => [`s:${sh.id}`, sheetName(sh)]), ...defined.map(o => [`d:${o.id}`, o.name]), ...ms.map(x => [x.id, x.label])];
  if (!options.length) {
    return kit.panel('', emptyState({ title: 'Nothing to synthesize', detail: 'SWiM needs an outcome counted in two arms on Syntheses, or a counted measure in this table.', help: true, size: 'inline',
      actions: [{ id: 'mk-syntheses', label: 'Open Syntheses', icon: 'matrix', primary: true, attrs: { 'data-es-go': 'syntheses' } }] }));
  }
  const choice = options.some(o => o[0] === mk.measure) ? mk.measure : options[0][0], source = pick('measure', 'Source', options, choice);
  if (choice.startsWith('s:')) return sheetHtml(ctx, kit, syn, sheets.find(sh => sh.id === choice.slice(2)), source);
  if (choice.startsWith('d:')) return outcomeHtml(ctx, kit, syn, defined.find(o => o.id === choice.slice(2)), source);
  return measureHtml(ctx, kit, ms.find(x => x.id === choice), source);
}

// ---- the parts every source shares ----------------------------------------------------------------------------------------------------
const meter = (n, of) => (of ? `<svg class="mk-meter" width="40" height="6" aria-hidden="true"><rect width="40" height="6" rx="3" class="mk-meter-track"/><rect width="${(40 * n / of).toFixed(1)}" height="6" rx="3" class="mk-meter-on"/></svg>` : '');
const tipOf = n => { const item = SWIM_ITEMS.find(i => i.id === n); return `SWiM item ${n}: ${item.name}. ${item.text}`; };
const itemsOf = (kit, grouping, method, certainty) => kit.cards([kit.card('Grouping', grouping, { tip: tipOf('1') }), kit.card('Standardized metric', 'Direction of effect', { tip: tipOf('2') }),
  kit.card('Synthesis method', method, { tip: tipOf('3') }), kit.card('Certainty', certainty, { tip: tipOf('6') })], 'SWiM items the panel states', 'mk-items');
const harvestOf = (kit, drawn, names, anyN) => kit.chart('harvest', 'Harvest plot', `${plural(drawn.length, 'study', 'studies')}${names.length ? `, ${plural(names.length, 'group')}` : ''}; ${anyN ? 'bar height by n' : 'bars of one height'}`,
  w => harvestChart(drawn, { width: w, groups: names.length ? names : null, sized: anyN, title: 'Harvest plot' }));
const keepOf = (name, drawn) => ({ how: 'swim', name, rows: drawn.map(r => ({ paperId: r.paperId, direction: r.direction, n: r.n })) });

/** The direction plot, votes, items and harvest of rows that each carry a direction: a defined outcome's or a measure's. */
function directionPanel(ctx, kit, { filters, name, rows, rule, group, columns, sizeNote }) {
  const kept = ctx.kept, anyN = rows.some(r => r.n > 0);
  const levels = group ? group.levels : [], levelOf = id => levels.find(l => l.ids.includes(id))?.label || 'Not given';
  const names = group ? [...levels.map(l => l.label).filter(n => rows.some(r => levelOf(r.paperId) === n)), ...(rows.some(r => levelOf(r.paperId) === 'Not given') ? ['Not given'] : [])] : [];
  const drawn = rows.map(r => ({ ...r, group: group ? levelOf(r.paperId) : '', attrs: kit.at([r.paperId]) })).sort((a, b) => (group ? names.indexOf(a.group) - names.indexOf(b.group) : 0) || a.higher - b.higher || (b.n || 0) - (a.n || 0));
  const plot = kit.fitted('direction', w => directionChart(drawn, { width: w, title: `Effect direction: ${name}`, groups: names, columns }), { cls: 'es-hist chart-svg mk-plot', tag: 'div', label: `Effect direction: ${name}`, floor: 320, cap: 760 });
  // vote counting by direction, each group and all, with the exact two-sided sign test on benefit against harm: one line a group
  const voteRow = (label, list) => { const v = { benefit: 0, harm: 0, 'no clear': 0 }; for (const r of list) v[r.direction]++; const p = signTest(v.benefit, v.harm).p;
    return [label, String(list.length), { html: `${v.benefit}${meter(v.benefit, v.benefit + v.harm)}` }, String(v.harm), String(v['no clear']), fmtP(p)]; };
  const votes = kit.table('Votes by direction', ['Group', 'Studies', '▲', '▼', '◄►', 'Sign test p'], [...(group ? names.map(n => voteRow(n, drawn.filter(r => r.group === n))) : []), voteRow(group ? 'All' : name, drawn)], { all: !!group });
  const items = itemsOf(kit, group ? `${group.label}, ${plural(names.length, 'group')}` : 'None', 'Vote counting on direction, sign test', `Direction only, not size; ${plural(rows.length, 'study', 'studies')} of ${kept.size}`);
  const harvest = harvestOf(kit, drawn, names, anyN);
  const note = [kit.count, rule, sizeNote].filter(Boolean).join(', ');
  return kit.panel(kit.tools(filters),
    `<div class="mk-split"><div class="mk-split-main"><figure class="mk-fig"><figcaption>${esc(`Effect direction: ${name}`)}<span class="mk-fig-count">${esc(note)}</span></figcaption>${plot.html}</figure></div><div class="mk-split-aside">${votes}</div></div>${items}${harvest.html}`,
    { keep: keepOf(name, drawn), fits: { direction: plot.fit, harvest: harvest.fit }, primary: kit.primary('Add to Certainty') });
}

/** The groupings a source can take: the table's level fields, then the facets of the intervention arm on Syntheses. */
function groupsOf(ctx, syn) {
  const own = leveled(ctx.fields, ctx);
  if (!syn) return own;
  const facets = syn.facets.map(f => ({ id: `f:${f.id}`, label: `${f.label} (intervention arm)`, levels: f.levels.map(l => ({ key: l.id, label: l.label, ids: [...new Set(syn.arms.filter(a => a.role === 'I' && a.facets?.[f.id] === l.id).map(a => a.sid))] })).filter(l => l.ids.length) })).filter(f => f.levels.length > 1);
  return [...own, ...facets];
}
const groupPick = (kit, groups, group) => kit.pick('group', 'Group', [['', 'No grouping'], ...groups.map(x => [x.id, x.label])], group?.id || '');

// ---- a measure of the table's fields ------------------------------------------------------------------------------------------------
function measureHtml(ctx, kit, m, source) {
  const mk = ctx.make, fields = ctx.fields, kept = ctx.kept;
  const groups = groupsOf(ctx, synthOf(ctx.st)), group = groups.find(x => x.id === mk.group) || null, higherBetter = !!mk.higher;
  const filters = [source, groupPick(kit, groups, group), kit.check('higher', 'Higher is better', higherBetter)];
  const studies = [...kept].map(id => ({ paperId: id, label: ctx.studyLabel(id), text: ctx.valueText(id, m.fieldId) })).filter(s => s.text);
  const { rows, rule } = directionsOf(studies, m, { higherBetter });
  if (rows.length < 2) return kit.empty(filters, 'Fewer than two studies give this measure');
  // each study's size: the measure's own total, else the field that names the size, else a counted measure's largest total
  const sizes = studySizes(fields, ctx), sized = rows.map(r => ({ ...r, n: r.n ?? sizes.of(r.paperId) }));
  return directionPanel(ctx, kit, { filters, name: m.name, rows: sized, rule, group, columns: [m.type === 'tally' ? 'Share' : 'Change', 'n'],
    sizeNote: sized.some(r => r.n > 0) ? `marks sized by n (${sizes.source || 'the measure'})` : 'no sample size in the fields, marks one size' });
}

// ---- a defined outcome with two arms ------------------------------------------------------------------------------------------------
function outcomeHtml(ctx, kit, syn, o, source) {
  const mk = ctx.make, kept = ctx.kept, groups = groupsOf(ctx, syn), group = groups.find(x => x.id === mk.group) || null;
  const filters = [source, groupPick(kit, groups, group)];
  // fewer events in the intervention arm is benefit; the same proportion in both arms gives no direction
  const rows = armPairs(syn, o).filter(r => kept.has(r.sid)).map(r => { const a = r.e1 / r.n1, b = r.e2 / r.n2, higher = a > b ? 1 : a < b ? -1 : 0;
    return { paperId: r.sid, label: r.study, direction: higher < 0 ? 'benefit' : higher > 0 ? 'harm' : 'no clear', higher, value: `${r.e1}/${r.n1} vs ${r.e2}/${r.n2}`, n: r.n1 + r.n2 }; });
  if (rows.length < 2) return kit.empty(filters, 'Fewer than two studies give this outcome in both arms');
  return directionPanel(ctx, kit, { filters, name: o.name, rows, group, columns: ['Events', 'n'], rule: '▲ benefit is fewer events in the intervention arm', sizeNote: 'marks sized by the two arms’ n' });
}

// ---- an effect-direction sheet of Syntheses -------------------------------------------------------------------------------------------
function sheetHtml(ctx, kit, syn, sh, source) {
  const kept = ctx.kept, filters = [source], name = sheetName(sh);
  const src = sheetSource(syn, sh.id, kept);
  if (src.error) return kit.empty(filters, src.error === 'No study matches the sheet' ? 'No study the filter keeps is on this sheet' : src.error);
  const { data, model, rows } = src;
  // the sheet as Syntheses draws it on screen, over the kept studies
  const fig = screenFigureOf(model, 'effects', null, sh.id), groups = [...new Set(rows.map(r => r.group))];
  // the votes as the sheet counts them: a study favors the intervention when every outcome with a difference is lower with it, a mixed one does not
  const voteRow = (label, list) => { const c = list.filter(r => r.counted), fav = c.filter(r => r.direction === 'benefit').length, k = c.length;
    return [label, String(k), { html: `${fav}${meter(fav, k)}` }, String(c.filter(r => r.direction === 'harm').length), String(c.filter(r => r.direction === 'no clear').length), k ? signTest(fav, k - fav).p.toFixed(2) : '–']; };
  const votes = kit.table('Votes by direction', ['Comparison', 'Studies', '▲', '▼', 'Mixed', 'Sign test p'], [...(groups.length > 1 ? groups.map(g => voteRow(g, rows.filter(r => r.group === g))) : []), voteRow('All', rows)], { all: groups.length > 1 });
  // the sheet's own lines (its sign test, the single-arm ranges) are under its table
  const left = rows.filter(r => !r.counted).length, sign = data.sign;
  const certainty = sign ? `Direction only; ${sign.fav} of ${sign.k}, P = ${sign.p.toFixed(2)}` : 'No study gives a direction';
  const items = itemsOf(kit, groups.length ? plural(groups.length, 'comparison') : 'None', 'Vote counting on direction, sign test', certainty);
  const drawn = rows.map(r => ({ ...r, attrs: kit.at([r.paperId]) })), harvest = rows.length ? harvestOf(kit, drawn, groups.length > 1 ? groups : [], rows.some(r => r.n > 0)) : { html: '', fit: null };
  const note = [kit.count, `▲ fewer events with ${data.intervention} on every outcome with a difference`, ...(left ? [`${plural(left, 'study', 'studies')} at critical risk of bias left out of the sign test`] : [])].join(', ');
  const figure = fig.error ? `<p class="meta">${esc(fig.error)}</p>` : `<div class="chart-svg">${fig.svg}</div>`;
  return kit.panel(kit.tools(filters),
    `<figure class="mk-fig syn-figure"><figcaption>${esc(`Effect direction: ${data.intervention}`)}<span class="mk-fig-count">${esc(note)}</span></figcaption>${figure}</figure>${votes}${items}${harvest.html}`,
    { keep: rows.length ? keepOf(name, drawn) : null, fits: harvest.fit ? { harvest: harvest.fit } : {}, primary: kit.primary('Add to Certainty', rows.length > 0) });
}
