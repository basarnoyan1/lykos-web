// Make's Survival (views/summary-make.mjs): Kaplan–Meier from a dataset or the patient table (reconstructed curves among its rows): a time
// column, an event column, a group column if wanted. The estimate is the dataset analyses' own (lib/dataset-analysis.mjs kmRun, on
// lib/km-js.mjs: the product-limit estimate, log-log bands, the number at risk, each group's median, the log-rank test, checked against
// R's survival), drawn by the house figure (lib/survival-fig.mjs), and kept as a dataset analysis of kind 'km', as the Datasets page keeps one.
import { esc } from '../lib/html.mjs';
import { plural } from '../lib/dates.mjs';
import { kmRun } from '../lib/dataset-analysis.mjs';
import { kmChart } from '../lib/analysis-charts.mjs';
import { fmtP } from '../lib/make-stats.mjs';
import { labelCase } from '../lib/label-case.mjs';
import { columnsOf, sourcesOf, sourceById } from './make-data.mjs';

const f1 = v => (v == null ? 'Not reached' : Number.isInteger(v) ? String(v) : v.toFixed(1));

export function survivalHtml(ctx, kit) {
  const mk = ctx.make, { pick, card, cards, table } = kit;
  const sources = sourcesOf(ctx).filter(s => s.dataset), source = sourceById(sources, mk.source);
  if (!source) return kit.empty([], 'No dataset or patient table');
  const d = source.dataset, cols = columnsOf(source);
  const times = cols.filter(c => c.kind === 'number'), events = cols.filter(c => c.kind === 'boolean' || c.kind === 'category'), cats = cols.filter(c => c.kind === 'category' || c.kind === 'boolean');
  const time = times.find(c => c.id === mk.time) || times.find(c => c.role === 'time') || times[0];
  const event = events.find(c => c.id === mk.event && c.id !== time?.id) || events.find(c => c.role === 'event') || events.find(c => c.id !== time?.id) || null;
  const group = cats.find(c => c.id === mk.group && c.id !== event?.id) || null;
  const filters = [...(sources.length > 1 ? [pick('source', 'Source', sources.map(s => [s.id, s.label]), source.id)] : []),
    ...(time ? [pick('time', 'Time', times.map(c => [c.id, c.label]), time.id)] : []), ...(event ? [pick('event', 'Event', events.filter(c => c.id !== time?.id).map(c => [c.id, c.label]), event.id)] : []),
    pick('group', 'Group', [['', 'One curve'], ...cats.filter(c => c.id !== event?.id).map(c => [c.id, c.label])], group?.id || '')];
  if (!time || !event) return kit.empty(filters, 'A Kaplan–Meier needs a time column and an event column');
  const inputs = { time: time.id, event: event.id, eventLevel: '', group: group?.id || null };
  let r;
  try { r = kmRun(d, inputs); } catch (e) { return kit.empty(filters, e.message); }
  const { km, logrank: lr, rows, events: ev } = r, unit = time.unit || 'months', maxT = Math.max(...rows.map(x => x.time));
  const plot = kit.chart('km', r.plot.title, `${plural(rows.length, 'patient')}, ${ev} events${group ? `; log-rank p ${fmtP(lr.p)}` : ''}`, w => kmChart(r.plot.km, { width: w, times: r.plot.atRiskTimes, xLabel: time.unit ? `${labelCase(time.label)}` : `${labelCase(time.label)} (months)`, p: lr.p, title: r.plot.title }));
  const per = table('Per group', r.tables[0].header, r.tables[0].rows);
  const score = (v, cuts) => (v >= cuts[0] ? 3 : v >= cuts[1] ? 2 : v >= cuts[2] ? 1 : 0);
  const g = { rows: [{ label: 'Patients', value: String(rows.length), score: score(rows.length, [30, 15, 5]) }, { label: 'Events', value: String(ev), score: score(ev, [20, 10, 3]) },
    { label: 'Groups', value: group ? `${plural(km.by.length, 'group')}, log-rank p ${fmtP(lr.p)}` : 'One curve', score: group ? (Math.min(...km.by.map(x => x.n)) >= 10 ? 3 : Math.min(...km.by.map(x => x.n)) >= 5 ? 2 : 1) : 3 },
    { label: 'Follow-up', value: `${f1(maxT)} ${unit} at most`, score: 3 }] };
  const mean = g.rows.reduce((a, x) => a + x.score, 0) / g.rows.length, red = g.rows.some(x => x.score <= 1);
  const verdict = { verdict: mean >= 2.3 && !red ? 'Makes sense' : mean >= 1.5 ? 'Possible, with care' : 'Weak', tone: mean >= 2.3 && !red ? 'good' : mean >= 1.5 ? 'unclear' : 'bad' };
  const est = group ? `${km.by.map(x => `${x.group} median ${f1(x.median.est)}`).join(', ')} ${unit}; log-rank p ${fmtP(lr.p)}` : `Median ${f1(km.overall.median.est)} ${unit}, ${ev} events in ${rows.length} patients`;
  const keep = { how: 'survival', dataset: d, inputs, result: { kind: 'km', title: r.plot.title, warnings: [], ...r, columns: [time.id, event.id, ...(group ? [group.id] : [])] } };
  const view = `${kit.verdictHtml(verdict, est)}${cards(g.rows.map(x => card(x.label, x.value, { score: x.score })), 'Whether it makes sense')}${plot.html}${per}<p class="meta mk-note">${esc(r.method)}</p>`;
  return kit.panel(kit.tools(filters), view, { keep, fits: { km: plot.fit }, primary: kit.primary('Keep with the dataset', true, { icon: 'save' }) });
}
