// Make's Meta-analysis (views/summary-make.mjs): a counted measure pooled as a proportion or, with a follow-up, as events per 100
// person-years; a composite of counted measures under the review's overlap rule; two arms compared (RR, OR, RD, MD, SMD) from an outcome
// that holds them; subgroups by any level field with the test for their difference; a meta-regression on any number (follow-up, year, age)
// with its bubble plot; Bucher's indirect comparison of two contrasts through their common comparator; leave-one-out, Egger and the funnel
// from enough studies; studies left out by risk of bias or by a level. Each carries the graded verdict (lib/make-stats.mjs grade) and the
// forest as Analysis draws it (lib/forest-page.mjs). A proportion, a composite or a contrast is kept as an analysis through the path
// Analysis uses (lib/make-save.mjs); Open Analysis stays beside it.
import { esc } from '../lib/html.mjs';
import { plural } from '../lib/dates.mjs';
import { scatterChart, funnelChart } from '../lib/charts.mjs';
import { forestTable, forestRows, looChart } from '../lib/analysis-charts.mjs';
import { poolGeneral } from '../lib/meta-general.mjs';
import { pooledInputs } from '../lib/analysis-inputs.mjs';
import { isContrast } from '../lib/contrast-counts.mjs';
import { measureOf } from '../lib/effect-measures.mjs';
import { MIN_K } from '../lib/small-study.mjs';
import { leveled, numberSources, measuresOf, yearsPerUnit, tallyFor } from '../lib/make-sources.mjs';
import { grade, pooledChecks, funnelData, proportionFit, poolRate, compositeRows, contrastFit, bucher, regress, pct, fmtP, CONTRAST_MEASURES, isRatioMeasure } from '../lib/make-stats.mjs';
import { readMeasures } from '../lib/extraction-measures.mjs';
import { labelCase } from '../lib/label-case.mjs';
import { synthesisModel } from '../lib/synth-project.mjs';
import { outcomeDefinition } from '../lib/synth-figures.mjs';
import { forestOptions, storedOptions, favoursOf, ratioAxis, RATIO_AXES } from '../lib/forest-options.mjs';

const f2 = v => (Number.isFinite(v) ? (Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(2)) : '');

const ilogit = x => 1 / (1 + Math.exp(-x));

export function metaHtml(ctx, kit) {
  const mk = ctx.make, fields = ctx.fields, kept = ctx.kept, st = ctx.st || {}, { pick, check, card, cards, table, count } = kit;
  const tallies = measuresOf(fields, ['tally']), nums = numberSources(fields, ctx), splits = leveled(fields, ctx);
  // the outcomes that hold two arms: a comparison read from the table's text, or an outcome with inputs per arm
  const armed = (st.outcomes || []).filter(o => isContrast(o.derived) || (!o.derived && ['binary', 'continuous'].includes(measureOf(o.measure).family) && (pooledInputs(st, '', o.measure, o.id).units || []).length >= 2));
  const contrasts = armed.filter(o => isContrast(o.derived) && o.derived.arms?.control);
  // the project's defined outcomes (Syntheses and Analysis: composites such as Any failure, and the outcomes they are made of), read from the arms
  const syn = synthOf(st), defined = syn ? syn.outcomes : [];
  const options = [...defined.map(o => [`d:${o.id}`, o.name]), ...tallies.map(m => [m.id, m.label]), ...(tallies.length >= 2 ? [['composite', 'Composite of counted measures']] : []),
    ...armed.map(o => [`o:${o.id}`, armedLabel(o, armed, defined)]), ...(contrasts.length >= 2 ? [['bucher', 'Compare indirectly (Bucher)']] : [])];
  if (!options.length) return kit.empty([], 'No counts to pool');
  const choice = options.some(o => o[0] === mk.measure) ? mk.measure : options[0][0];
  const filters = [pick('measure', 'Measure', options, choice)];
  const split = splits.find(f => f.id === mk.split) || null, levels = split ? split.levels : [], levelOf = id => levels.find(l => l.ids.includes(id))?.label ?? null;
  const fu = nums.find(x => x.id === mk.fu) || null, fuOf = new Map((fu?.values || []).map(v => [v.paperId, v.value]));
  const rated = [...kept].some(id => ctx.robOf?.(id)), outs = [...(rated ? [['rob', 'High risk of bias']] : []), ...levels.map(l => [`l:${l.key}`, `Level: ${l.label}`])];
  const leaveOut = outs.some(o => o[0] === mk.out) ? mk.out : '';
  const omit = id => (leaveOut === 'rob' ? ctx.robOf?.(id) === 'high' : leaveOut.startsWith('l:') ? !!levels.find(l => l.key === leaveOut.slice(2))?.ids.includes(id) : false);
  const common = () => [pick('split', 'Compare by', [['', 'No subgroups'], ...splits.map(f => [f.id, f.label])], split?.id || ''), pick('fu', 'Regress on', [['', 'No follow-up'], ...nums.map(x => [x.id, x.label])], fu?.id || ''),
    ...(outs.length ? [pick('out', 'Leave out', [['', 'Leave none out'], ...outs], leaveOut)] : [])];
  const open = { id: 'mk-analysis', label: 'Open Analysis', icon: 'analysis', attrs: { 'data-es-go': 'analysis' } };
  const left = ids => (leaveOut ? `${plural(ids.filter(omit).length, 'study', 'studies')} left out (${outs.find(o => o[0] === leaveOut)[1].toLowerCase()})` : '');

  if (choice === 'bucher') return bucherHtml(ctx, kit, { filters, contrasts, open });

  // ---- the rows of the chosen measure --------------------------------------------------------------------------------------------------
  let rows = [], name = '', parts = null, rule = null, contrast = null, measure = 'PR', ratio = false, events = true, treated = '', control = '', synthRec = null, measures = [];
  if (choice === 'composite') {
    const picked = tallies.filter((m, i) => mk[`part-${i}`] !== false && (mk[`part-${i}`] === true || i < 2));
    rule = mk.rule === 'max' ? 'max' : 'sum';
    filters.push(...tallies.map((m, i) => check(`part-${i}`, m.name, picked.includes(m))), pick('rule', 'Overlap', [['sum', 'Summed, capped at n (overlap not stated)'], ['max', 'Largest part (each patient once)']], rule));
    name = `Any of ${picked.map(m => m.name).join(', ')}`;
    parts = picked.map(m => ({ name: m.name, template: ctx.templateOf?.(m.fieldId), column: m.fieldId, items: [m.rawName] }));
    const perStudy = [...kept].map(id => ({ id, list: picked.map(m => tallyFor(ctx.valueText(id, m.fieldId), m, readMeasures)) }));
    rows = compositeRows(perStudy.map(s => s.list), rule).map((r, i) => (r ? { study: perStudy[i].id, label: ctx.studyLabel(perStudy[i].id), ...r } : null)).filter(Boolean);
  } else if (choice.startsWith('d:')) {
    // a defined outcome: each intervention arm's count, pooled as a proportion, or the two arms of a Syntheses comparison as a contrast
    const out = defined.find(o => `d:${o.id}` === choice), recs = syn.records.filter(r => r.outcomeId === out.id);
    const pairs = recs.filter(r => r.method.startsWith('Meta') && r.rows.filter(x => kept.has(x.sid)).length >= 2);
    const arm = pairs.find(r => r.code === mk.arms) || null;
    filters.push(pick('arms', 'Arms', [['', 'Intervention arms'], ...pairs.map(r => [r.code, r.grouping])], arm?.code || ''));
    name = out.name;
    if (arm) {
      synthRec = arm; measure = ['RR', 'OR', 'RD'].includes(mk.cm) ? mk.cm : 'RR'; ratio = isRatioMeasure(measure); events = true;
      measures = CONTRAST_MEASURES.filter(([id]) => ['RR', 'OR', 'RD'].includes(id));
      [treated, control] = sidesOfRec(syn, arm);
      contrast = { id: out.id, name: out.name, measure, synth: true };
      name = `${out.name}: ${arm.grouping}`;
      const fuText = r => { const a = Math.round(r.fu1 || 0), b = Math.round(r.fu2 || 0); return !a && !b ? '' : !b || a === b ? String(a || b) : `${a} / ${b}`; };
      rows = arm.rows.filter(x => kept.has(x.sid)).map(x => ({ study: x.sid, label: x.study, values: [x.e1, x.n1, x.e2, x.n2], events: x.e1 + x.e2, n: x.n1 + x.n2, fu: fuText(x), sources: [] }));
    } else {
      const all = recs.find(r => r.code === 'all:I' && r.family === 'Proportions'), arms = (all?.subgroups || []).flatMap(g => g.rows).filter(x => kept.has(x.sid));
      const many = new Set(arms.filter((x, i) => arms.findIndex(y => y.sid === x.sid) !== i).map(x => x.sid));
      rows = arms.map(x => ({ study: x.sid, label: many.has(x.sid) ? `${x.study}, ${x.label || x.arm || ''}`.replace(/, $/, '') : x.study, events: x.e, n: x.n }));
    }
  } else if (choice.startsWith('o:')) {
    contrast = armed.find(o => `o:${o.id}` === choice);
    const fam = measureOf(contrast.measure).family === 'continuous' ? 'continuous' : 'binary';
    const ms = CONTRAST_MEASURES.filter(([id]) => (fam === 'binary' ? ['RR', 'OR', 'RD'] : ['MD', 'SMD']).includes(id));
    measure = ms.some(([id]) => id === mk.cm) ? mk.cm : ms.some(([id]) => id === contrast.measure) ? contrast.measure : ms[0][0];
    measures = ms;
    ratio = isRatioMeasure(measure); events = fam === 'binary';
    treated = contrast.derived?.arms?.treated || 'Treated'; control = contrast.derived?.arms?.control || 'Control';
    name = `${contrast.name}: ${treated} vs ${control}`;
    rows = (pooledInputs(st, '', measure, contrast.id).units || []).filter(u => kept.has(u.paperId || u.paper?.id || u.id)).map(u => ({ study: u.paperId || u.paper?.id || u.id, label: u.label || u.paper?.label || u.id, values: u.values, events: events ? u.values[0] + u.values[2] : 1, n: events ? u.values[1] + u.values[3] : u.values[2] + u.values[5], sources: u.treated ? [u.treated.key, u.control.key] : [] }));
  } else {
    const m = tallies.find(x => x.id === choice);
    name = m.name; parts = [{ name: m.name, template: ctx.templateOf?.(m.fieldId), column: m.fieldId, items: [m.rawName] }];
    rows = [...kept].map(id => { const t = tallyFor(ctx.valueText(id, m.fieldId), m, readMeasures); return t ? { study: id, label: ctx.studyLabel(id), ...t } : null; }).filter(Boolean);
  }
  const perYear = fu ? yearsPerUnit(fu.unit) : null, rateOK = !contrast && !!perYear;
  const scale = rateOK && mk.scale === 'rate' ? 'rate' : 'pr';
  if (!contrast) filters.push(pick('scale', 'Scale', [['pr', 'Proportion'], ...(rateOK ? [['rate', 'Per 100 person-years']] : [])], scale));
  filters.push(...common());
  // the forest's own options (lib/forest-options.mjs): pooled or not, subtotals, the arms' events and the follow-up as columns, the axis
  const fo = forestOptions({ pool: mk.pool !== 'no', subtotals: mk.subtotals !== false, events: mk.events !== false, fu: mk.fuCol !== false, axis: mk.axis || '' });
  // one menu holds them, so the picks keep their row: each entry names what it sets (views/extraction-summary.mjs applies it)
  // the effect measure of a comparison is the forest's scale, so it stands in the same menu (the picks of a comparison of Syntheses' arms then keep one row)
  const forestMenu = [...(contrast && measures.length > 1 ? [{ label: 'Effect measure', submenu: measures.map(([id, l]) => ({ label: l, checked: id === measure, set: { cm: id } })) }] : []), { label: 'Pooled', checked: fo.pool, set: { pool: fo.pool ? 'no' : 'yes' } },
    ...(split ? [{ label: 'Subtotals', checked: fo.subtotals, disabled: !fo.pool, set: { subtotals: !fo.subtotals } }] : []),
    ...(contrast && events ? [{ label: 'Events in each arm', checked: fo.events, set: { events: !fo.events } }] : []),
    ...(rows.some(r => r.fu) ? [{ label: 'Follow-up', checked: fo.fu, set: { fuCol: !fo.fu } }] : []),
    ...(contrast && ratio ? [{ label: 'Axis', submenu: RATIO_AXES.map(([k, l]) => ({ label: l, checked: fo.axis === k, set: { axis: k } })) }] : [])];
  const forestAct = { id: 'mk-forest', label: 'Forest', icon: 'settings', menu: true, attrs: { 'data-mk-menu': 'forest' } };
  // with subgroups, a study in none of the field's levels is left out of the pool (it has no side to stand on); it is counted in the note
  rows = rows.map(r => ({ ...r, level: split ? levelOf(r.study) : null, x: fuOf.get(r.study) ?? null })).filter(r => !omit(r.study));
  const unlevelled = split ? rows.filter(r => r.level == null).length : 0;
  if (split) rows = rows.filter(r => r.level != null);
  const omitted = [...kept].filter(omit).length;
  if (rows.length < 2) return kit.empty(filters, rows.length ? 'One study gives this measure: nothing to pool' : 'No study gives this measure');

  // ---- the pool: by subgroup when a level field is picked ------------------------------------------------------------------------------------
  const order = split ? levels.map(l => l.label).filter(l => rows.some(r => r.level === l)) : [], sub = split && order.length >= 2;
  const sides = sub ? order.map(l => ({ label: l, k: rows.filter(r => r.level === l).length })) : null;
  let fit = null, show = v => v, text = v => pct(v), unitText = '', shownLabel = '';
  if (contrast) {
    const values = rows.map(r => r.values);
    fit = sub ? poolGeneral({ measure, method: 'REML', values, mod: { kind: 'group', values: rows.map(r => r.level), levels: order, unassigned: true } }) : contrastFit(values, measure);
    if (fit) { fit.kind = ratio ? 'ratio' : 'difference'; fit.measure = measure; }
    show = v => v; text = v => f2(v); shownLabel = measureOf(measure).label;
  } else if (scale === 'rate') {
    const rr = rows.filter(r => r.x > 0).map(r => ({ ...r, years: r.x * perYear }));
    fit = poolRate(rr); rows = rr; show = v => v; text = v => `${f2(v)}`; unitText = ' per 100 person-years'; shownLabel = `${name} per 100 person-years`;
  } else {
    fit = proportionFit(rows, sub ? { subgroups: true, order } : {});
    show = v => 100 * v; text = v => pct(v); shownLabel = `${name} (%)`;
  }
  // subgroups need two levels with two studies or more (lib/meta-pool.mjs usedLevels): with fewer the pool is one, and the sides are not graded
  const split1 = sub && fit && !fit.mod_kind;
  if (split1) sides.length = 0;
  const checksArgs = fit ? { refit: contrast ? r => contrastFit(r.map(x => x.values), measure) : scale === 'rate' ? r => poolRate(r) : r => proportionFit(r), yi: fit.yi, vi: fit.vi, show, text } : {};
  const { checks, loo, egger } = fit ? pooledChecks(rows, fit, checksArgs) : { checks: [], loo: null, egger: null };
  // the meta-regression: the effects on the model scale against the number, the line and its band drawn on the shown scale
  const withX = fit ? rows.map((r, i) => ({ r, i })).filter(({ r }) => Number.isFinite(r.x)) : [];
  const reg = fit && withX.length >= 3 && scale !== 'rate' ? regress(withX.map(p => fit.yi[p.i]), withX.map(p => fit.vi[p.i]), withX.map(p => p.r.x)) : null;
  if (reg) checks.push({ label: `${fu.label} explains`, value: `${Math.round(reg.r2)}% of τ², slope p ${fmtP(reg.p)}`, score: reg.r2 >= 50 ? 3 : 2 });
  const fitText = fit ? { ...fit, text: contrast ? `${text(fit.lo)} to ${text(fit.hi)}` : scale === 'rate' ? `${text(fit.lo)} to ${text(fit.hi)}${unitText}` : `${pct(fit.lo)} to ${pct(fit.hi)}` } : null;
  const g = grade({ rows, kept: kept.size - omitted, fit: fitText, sides: sides?.length ? sides : null, checks, ratio, events });
  const est = !fit ? 'Too few studies to pool'
    : sub && fit.mod_levels ? `${fit.mod_levels.map((l, i) => `${l} ${contrast ? text(fit.mod_est[i]) : scale === 'rate' ? text(fit.mod_est[i]) : pct(fit.mod_est[i])}`).join(' vs ')}${Number.isFinite(fit.qmp) ? `, difference p ${fmtP(fit.qmp)}` : ''}`
    : contrast ? `${measure} ${text(fit.estimate)} (${text(fit.lo)} to ${text(fit.hi)}), I² ${Math.round(fit.i2 ?? 0)}%${mk.pool === 'no' ? '; drawn without pooling' : ''}`
    : `${text(fit.estimate)}${unitText} (${text(fit.lo)} to ${text(fit.hi)}), I² ${Math.round(fit.i2 ?? 0)}%`;
  const extra = [];
  if (sub && fit && Number.isFinite(fit.qmp)) extra.push(card('Subgroup difference', `p ${fmtP(fit.qmp)}, ${plural(order.length, 'group')}`));
  if (split1) extra.push(card('Subgroups', `${split.label}: one level with two studies or more, pooled as one`));
  if (omitted) extra.push(card('Left out', left([...kept])));
  if (unlevelled) extra.push(card('In no level', `${plural(unlevelled, 'study', 'studies')} of ${split.label}`));

  // ---- the figures on screen (lib/analysis-charts.mjs): the forest as an analysis table, the bubble plot, the funnel, leave-one-out -----------
  const fits = {}, figs = [];
  if (fit) {
    const back = contrast ? (ratio ? Math.exp : v => v) : scale === 'rate' ? v => 100 * Math.exp(v) : v => 100 * ilogit(v);
    const het = `I² ${Math.round(fit.i2 ?? 0)}%, τ² ${f2(fit.tau2 ?? 0)}, Q ${f2(fit.q ?? 0)} (p ${fmtP(fit.qp)})${sub && fit.mod_kind ? `; subgroups p ${fmtP(fit.qmp)}` : ''}`;
    // a contrast's arms as columns (events over the total of each), the follow-up where the arms give it; drawn without pooling, no diamond and no heterogeneity
    const binary = contrast && events, up = t => String(t).replace(/^./, c => c.toUpperCase()), cols = [...(fo.fu && rows.some(r => r.fu) ? [{ key: 'fu', head: 'Follow-up (mo)', keep: 1 }] : []), ...(binary && fo.events ? [{ key: 'a', head: up(treated), keep: 2 }, { key: 'b', head: up(control), keep: 2 }] : [])];
    const fr = forestRows(fit, rows.map(r => r.label), { scale: v => v, pooledScale: contrast || scale === 'rate' ? v => v : v => 100 * v, groups: sub ? rows.map(r => r.level) : null, order: sub ? order : null, attrs: i => kit.at([rows[i].study]), overallLabel: 'REML model',
      pool: fo.pool, subtotals: fo.subtotals, cells: i => ({ ...(binary ? { a: `${rows[i].values[0]}/${rows[i].values[1]}`, b: `${rows[i].values[2]}/${rows[i].values[3]}` } : {}), ...(rows[i].fu ? { fu: rows[i].fu } : {}) }) });
    const forest = kit.chart('forest', 'Forest plot', `${plural(rows.length, 'study', 'studies')}, ${fo.pool ? het : 'not pooled'}`, w => forestTable(fr, { width: w, log: contrast ? ratio : scale === 'rate', ref: contrast ? (ratio ? 1 : 0) : null, fmt: v => (contrast ? f2(v) : scale === 'rate' ? f2(v) : `${f2(v)}%`), xLabel: contrast ? measure : scale === 'rate' ? 'Per 100 person-years' : `${name} (%)`,
      favours: contrast ? favoursOf(treated, control) : null, cols, axis: ratio ? ratioAxis(fo.axis) : null, title: `Forest plot: ${name}` }));
    figs.push(forest.html); fits.forest = forest.fit;
    if (reg) {
      const wMax = Math.max(...withX.map(p => fit.weights?.[p.i] || 1));
      const points = withX.map(p => ({ x: p.r.x, y: back(fit.yi[p.i]), label: p.r.label, weight: (fit.weights?.[p.i] || 1) / wMax, attrs: kit.at([p.r.study]), text: `${p.r.label}: ${fu.label} ${p.r.x}${fu.unit ? ` ${fu.unit}` : ''}, ${text(contrast ? back(fit.yi[p.i]) : ilogit(fit.yi[p.i]))}` }));
      const xs = withX.map(p => p.r.x), line = { at: x => back(reg.line(x)), band: x => reg.band(x).map(back), from: Math.min(...xs), to: Math.max(...xs) };
      const bubble = kit.chart('bubble', `${name} by ${fu.label}`, `${plural(withX.length, 'study', 'studies')}, slope ${f2(reg.slope)} per ${fu.unit || 'unit'} (${f2(reg.lo)} to ${f2(reg.hi)}), p ${fmtP(reg.p)}, R² ${Math.round(reg.r2)}%; bubbles sized by weight`,
        w => scatterChart(points, { width: w, height: Math.max(220, Math.min(360, Math.round(w * 0.5))), title: `${name} by ${fu.label}`, xLabel: fu.unit ? `${fu.label}, ${fu.unit}` : fu.label, yLabel: shownLabel, line, fmtY: v => (contrast ? f2(v) : `${f2(v)}%`) }));
      figs.push(bubble.html); fits.bubble = bubble.fit;
    }
    if (rows.length >= 5) {
      const fd = funnelData(fit.yi, fit.vi, fit.mu);
      const funnel = kit.chart('funnel', 'Funnel plot', egger ? `Egger t ${f2(egger.z)}, p ${fmtP(egger.p)}` : `Egger's test from ${MIN_K} studies`,
        w => funnelChart(fd, { width: Math.min(w, 640), height: Math.max(220, Math.min(420, Math.round(Math.min(w, 640) * 0.7))), title: 'Funnel plot', xLabel: shownLabel, labels: rows.map(r => r.label), show: back, fmtX: v => (contrast ? f2(v) : `${f2(v)}${scale === 'rate' ? '' : '%'}`), attrsOf: i => kit.at([rows[i].study]) }));
      figs.push(funnel.html); fits.funnel = funnel.fit;
    }
    if (loo) {
      const lr = rows.map((r, i) => ({ label: r.label, est: loo.est[i], lo: loo.lo[i], hi: loo.hi[i], attrs: kit.at([r.study]) })), full = { est: show(fit.estimate), lo: show(fit.lo), hi: show(fit.hi) };
      const outs = lr.filter(r => r.est < full.lo || r.est > full.hi).length;
      const lf = kit.chart('loo', 'Leave-one-out', `pooled ${text(fit.estimate)} without each study; ${outs ? `${plural(outs, 'omission')} move${outs === 1 ? 's' : ''} it outside the interval` : 'none moves it outside the interval'}`,
        w => looChart(lr, { width: w, full, log: contrast ? ratio : scale === 'rate', fmt: v => (contrast ? f2(v) : scale === 'rate' ? f2(v) : `${f2(v)}%`), xLabel: shownLabel, title: 'Leave-one-out' }));
      figs.push(lf.html); fits.loo = lf.fit;
    }
  }
  // a comparison read from the table's text says how it reads its arms and counts, and where it parts from the same comparison on Syntheses
  const about = contrast && !synthRec ? [contrastWords(contrast, st), syn ? versusSyntheses(rows, contrast, syn, kept, measure) : ''].filter(Boolean) : [];
  const view = `${kit.verdictHtml(g, est)}${about.map(t => `<p class="meta mk-note" data-mk-about>${esc(t)}</p>`).join('')}${cards([...g.rows.map(r => card(r.label, r.value, { score: r.score })), ...extra], 'Whether it makes sense')}${figs.join('')}`;
  // what the primary keeps: a proportion or a composite as an outcome read from the text with its result; a contrast as its outcome's result
  // the forest's options go with what is kept, so the kept figure draws as it was made
  const forestKept = storedOptions(fo);
  const keep = !fit ? null : synthRec ? { how: 'synth-forest', code: synthRec.code, outcomeId: contrast.id, options: forestKept, title: `${synthRec.grouping}: ${synthRec.outcome}` }
    : contrast ? { how: 'contrast', outcomeId: contrast.id, measure, fit, rows, treated, control, moderator: split?.id || '', moderatorLabel: split?.label || '', forest: forestKept }
    : scale === 'rate' ? null : { how: 'proportion', name, parts, rule, fit, rows, moderator: split?.id || '', moderatorLabel: split?.label || '', levels: order, forest: forestKept, ...(choice.startsWith('d:') ? { outcomeId: choice.slice(2) } : {}) };
  const note = scale === 'rate' ? 'A rate has no outcome measure of its own yet: open Analysis to pool it there' : '';
  return kit.panel(kit.tools(filters, [forestAct, open]), `${view}${note ? `<p class="meta mk-note">${esc(note)}</p>` : ''}`, { keep, fits, menus: { forest: forestMenu }, primary: synthRec ? kit.primary('Add to package', !!keep, { icon: 'plus' }) : kit.primary('Keep as analysis', !!keep, { icon: 'save' }) });
}

/** The synthesis model of the project (lib/synth-project.mjs), or null where it has no arms. */
export function synthOf(st) {
  try { const m = st?.templates?.length ? synthesisModel(st) : null; return m?.arms?.length ? m : null; } catch { return null; }
}
/** A Syntheses comparison's two sides by name: its definition's levels, else its title's sides. */
function sidesOfRec(syn, rec) {
  const def = syn.comparisons.find(d => d.code === rec.code), lv = sel => { const [f, ls] = Object.entries(sel?.facets || {})[0] || []; return ls?.length === 1 ? syn.facets.find(x => x.id === f)?.levels.find(l => l.id === ls[0])?.label : null; };
  const a = lv(def?.a), b = lv(def?.b);
  if (a && b) return [a, b];
  const m = /^(.+?)\s+versus\s+(.+)$/i.exec(String(rec.grouping).split(/[,;:]/)[0]);
  return m ? [m[1].trim(), m[2].trim().split(/\s+/)[0]] : ['Intervention', 'Comparator'];
}
const lower = t => (/^[A-Z][A-Z0-9]/.test(t) ? t : String(t).replace(/^./, c => c.toLowerCase()));
/**
 * A comparison's option in the Measure list. Two outcomes of one name (two comparisons of the same arms read for different counts) are
 * told apart by what differs, leading so it stays when the option is cut: the defined outcome their definition names, the source they were
 * read as, their arms, or their field.
 */
export function armedLabel(o, armed, defined) {
  const same = armed.filter(x => x.name === o.name);
  if (same.length < 2) return `Compare arms: ${o.name}`;
  const text = String(o.definition || ''), named = [...defined].sort((a, b) => b.name.length - a.name.length).find(d => text.toLowerCase().includes(d.name.toLowerCase()));
  const arms = o.derived?.arms, armsText = arms ? `${arms.treated} vs ${lower(arms.control)}` : '';
  const differs = (f, mine) => same.some(x => x !== o && f(x) !== mine);
  const lead = named && differs(x => [...defined].sort((a, b) => b.name.length - a.name.length).find(d => String(x.definition || '').toLowerCase().includes(d.name.toLowerCase()))?.id, named.id) ? named.name
    : o.derived?.from?.label && differs(x => x.derived?.from?.label, o.derived.from.label) ? o.derived.from.label
    : armsText && differs(x => `${x.derived?.arms?.treated} vs ${lower(x.derived?.arms?.control || '')}`, armsText) ? armsText
    : o.id;
  return `${lead}: ${lower(o.name)}`;
}
/** How a comparison read from the table's text reads its arms and its counts: the arms' names and the field that defines them, the phrases counted. */
function contrastWords(contrast, st) {
  const d = contrast.derived || {}, t = (st.templates || []).find(x => x.id === d.template), col = id => t?.columns?.find(c => c.id === id)?.label || String(id || '').split('.').pop();
  const arms = d.arms ? `${d.arms.treated} (“${d.arms.treatedTerm || d.arms.treated}”) against ${d.arms.control} (“${d.arms.controlTerm || d.arms.control}”) in ${col(d.arms.column)}` : '';
  const items = (d.items || []).length ? `; counts of ${d.items.join(', ')} in ${(d.columns || []).map(col).join(' and ')}` : (d.columns || []).length ? `; counts in ${(d.columns || []).map(col).join(' and ')}` : '';
  return arms ? `${contrast.definition ? `${contrast.definition}. ` : ''}Arms: ${arms}${items}.` : '';
}
/**
 * Where a comparison read from the table's text parts from the same comparison on Syntheses: the Syntheses outcome its definition names (or
 * its own name), the comparison of most studies in common, and each study whose counts differ or that only one of them has. '' when they agree
 * or nothing on Syntheses matches.
 */
function versusSyntheses(rows, contrast, syn, kept, measure) {
  const text = `${contrast.definition || ''} ${contrast.name || ''}`.toLowerCase(), out = [...syn.outcomes].sort((a, b) => b.name.length - a.name.length).find(o => text.includes(o.name.toLowerCase()));
  if (!out) return '';
  const mine = new Set(rows.map(r => r.study));
  const recs = syn.records.filter(r => r.outcomeId === out.id && r.method.startsWith('Meta')).map(r => ({ r, both: r.rows.filter(x => mine.has(x.sid) && kept.has(x.sid)).length })).filter(x => x.both);
  if (!recs.length) return '';
  const best = recs.sort((a, b) => b.both - a.both || (b.r.named ? 1 : 0) - (a.r.named ? 1 : 0) || a.r.rows.length - b.r.rows.length)[0].r;
  const theirs = new Map(best.rows.filter(x => kept.has(x.sid)).map(x => [x.sid, x])), diffs = [];
  for (const r of rows) {
    const x = theirs.get(r.study); if (!x) { diffs.push(`${r.label} is in this comparison only`); continue; }
    const a = `${r.values[0]}/${r.values[1]} against ${r.values[2]}/${r.values[3]}`, b = `${x.e1}/${x.n1} against ${x.e2}/${x.n2}`;
    if (a === b) continue;
    // the arm whose count differs, with its cells in the columns this comparison reads, so the phrase it misses can be seen
    const side = r.values[0] !== x.e1 || r.values[1] !== x.n1 ? x.arm1 : x.arm2, arm = syn.arms.find(y => y.sid === x.sid && y.label === side);
    const cells = (contrast.derived?.columns || []).map(c => arm?.cells?.[c]).filter(Boolean).map(t => `“${t}”`).join(' and ');
    diffs.push(`${r.label} counts ${a} here and ${b} there${cells ? ` (its ${lower(side)} arm reads ${cells})` : ''}`);
  }
  for (const [sid, x] of theirs) if (!mine.has(sid)) diffs.push(`${x.study} is on Syntheses only`);
  if (!diffs.length) return '';
  const def = outcomeDefinition(out, id => syn.outcomes.find(o => o.id === id)?.name || id);
  return `Not the result of Syntheses’ ${best.grouping} on ${out.name}${best.pool && measure === 'RR' ? ` (RR ${best.pool.rr.toFixed(2)}, ${best.pool.lo.toFixed(2)} to ${best.pool.hi.toFixed(2)})` : ''}: ${diffs.join('; ')}.${def ? ` ${def}` : ''} Choose ${out.name} under Measure and ${best.grouping} under Arms for the Syntheses counts.`;
}

/** Two contrasts through their common comparator: A vs C and B vs C give A vs B (Bucher); a direct A vs B, when the project holds one, beside it. */
function bucherHtml(ctx, kit, { filters, contrasts, open }) {
  const mk = ctx.make, st = ctx.st, { pick, card, cards, table } = kit;
  const label = o => `${o.derived.arms.treated || 'Treated'} vs ${o.derived.arms.control || 'Control'} (${o.name})`;
  const a = contrasts.find(o => o.id === mk.ba) || contrasts[0], b = contrasts.find(o => o.id === mk.bb && o.id !== a.id) || contrasts.find(o => o.id !== a.id);
  const ms = CONTRAST_MEASURES.filter(([id]) => ['RR', 'OR', 'RD'].includes(id)), measure = ms.some(([id]) => id === mk.cm) ? mk.cm : 'RR';
  filters.push(pick('ba', 'A vs C', contrasts.map(o => [o.id, label(o)]), a.id), pick('bb', 'B vs C', contrasts.filter(o => o.id !== a.id).map(o => [o.id, label(o)]), b?.id || ''), pick('cm', 'Effect measure', ms, measure));
  if (!b) return kit.empty(filters, 'Two comparisons are needed');
  const fitOf = o => { const rows = (pooledInputs(st, '', measure, o.id).units || []).map(u => u.values); return rows.length >= 2 ? contrastFit(rows, measure) : null; };
  const fa = fitOf(a), fb = fitOf(b);
  if (!fa || !fb) return kit.empty(filters, 'Each comparison needs two or more studies');
  const ca = a.derived.arms.control, cb = b.derived.arms.control, same = String(ca).trim().toLowerCase() === String(cb).trim().toLowerCase();
  const ta = a.derived.arms.treated, tb = b.derived.arms.treated;
  const direct = contrasts.find(o => o.id !== a.id && o.id !== b.id && [o.derived.arms.treated, o.derived.arms.control].map(x => String(x).toLowerCase()).sort().join('|') === [ta, tb].map(x => String(x).toLowerCase()).sort().join('|'));
  const fd = direct ? fitOf(direct) : null;
  const r = bucher(fa, fb, { ratio: isRatioMeasure(measure), direct: fd });
  const txt = v => f2(v), est = `${ta} vs ${tb}: ${measure} ${txt(r.estimate)} (${txt(r.lo)} to ${txt(r.hi)}), p ${fmtP(r.p)}`;
  const g = grade({ rows: Array(Math.min(fa.k, fb.k)).fill({ events: 1 }), kept: Math.min(fa.k, fb.k), fit: { ...r, i2: Math.max(fa.i2, fb.i2), text: `${txt(r.lo)} to ${txt(r.hi)}` }, ratio: isRatioMeasure(measure), events: false,
    checks: [{ label: 'Common comparator', value: same ? ca : `${ca} and ${cb} differ`, score: same ? 3 : 0 }, ...(r.inconsistency ? [{ label: 'Direct agrees', value: `ratio ${txt(r.inconsistency.diff)}, p ${fmtP(r.inconsistency.p)}`, score: r.inconsistency.p >= 0.1 ? 3 : r.inconsistency.p >= 0.05 ? 2 : 1 }] : [])] });
  const rows = [[`${ta} vs ${ca}`, String(fa.k), txt(fa.estimate), `${txt(fa.lo)} to ${txt(fa.hi)}`], [`${tb} vs ${cb}`, String(fb.k), txt(fb.estimate), `${txt(fb.lo)} to ${txt(fb.hi)}`],
    [`${ta} vs ${tb}, indirect`, '—', txt(r.estimate), `${txt(r.lo)} to ${txt(r.hi)}`], ...(fd ? [[`${ta} vs ${tb}, direct`, String(fd.k), txt(fd.estimate), `${txt(fd.lo)} to ${txt(fd.hi)}`]] : [])];
  const view = `${kit.verdictHtml(g, est)}${cards(g.rows.map(x => card(x.label, x.value, { score: x.score })), 'Whether it makes sense')}${table('Bucher indirect comparison', ['Comparison', 'Studies', measure, '95% interval'], rows, { all: true })}
    <p class="meta mk-note">${esc('The indirect estimate is the difference of the two log contrasts; its SE the root of their summed squares (Bucher 1997). It is not kept: pool it in Analysis as a network when the project needs it.')}</p>`;
  return kit.panel(kit.tools(filters, [open]), view, { keep: null, primary: kit.primary('Keep as analysis', false, { icon: 'save' }) });
}
