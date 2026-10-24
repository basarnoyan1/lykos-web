// Make's Swimmer (views/summary-make.mjs): from the studies, one lane per study whose length is any number a field holds (a number field, a
// number written as text, a measure), its marks a measure that names a time, its lanes a level field, in the order of length, group or year;
// from a dataset or the patient table, one lane per patient (lib/survival-fig.mjs swimmerFigure, the house drawing): the length a time
// column, the marks event columns (each its own symbol; an event at a time of its own when the column is a time), a filled end for an
// event and an arrow for follow-up that ended without one, the lanes a category column. Kept as a Tables and figures output.
import { esc } from '../lib/html.mjs';
import { plural } from '../lib/dates.mjs';
import { swimmerChart } from '../lib/charts.mjs';
import { laneChart } from '../lib/analysis-charts.mjs';
import { labelCase } from '../lib/label-case.mjs';
import { leveled, numberSources, measuresOf, monthsIn, yearsPerUnit } from '../lib/make-sources.mjs';
import { partOf } from '../lib/make-swim.mjs';
import { columnsOf, rowsOf, sourcesOf, sourceById } from './make-data.mjs';

const fmt = v => (Number.isInteger(v) ? String(v) : (Math.round(v * 10) / 10).toString());

export function swimmerHtml(ctx, kit) {
  const mk = ctx.make, { pick, figure, count, where } = kit;
  const sources = sourcesOf(ctx), source = sourceById(sources, mk.source);
  const sourcePick = sources.length > 1 ? [pick('source', 'Source', sources.map(s => [s.id, s.label]), source.id)] : [];
  if (source.id !== 'studies') return patientSwimmer(ctx, kit, source, sourcePick);
  const fields = ctx.fields, nums = numberSources(fields, ctx), f = nums.find(x => x.id === mk.field) || nums[0];
  if (!f) return kit.empty(sourcePick, 'No number to draw');
  const marks = measuresOf(fields, ['tally', 'number', 'change', 'nr']), mark = marks.find(x => x.id === mk.marks) || null;
  const groups = leveled(fields, ctx), group = groups.find(x => x.id === mk.group) || null, sort = ['length', 'group', 'year'].includes(mk.sort) ? mk.sort : 'length';
  const filters = [...sourcePick, pick('field', 'Length', nums.map(x => [x.id, x.label]), f.id), pick('marks', 'Marks', [['', 'No marks'], ...marks.map(x => [x.id, x.label])], mark?.id || ''),
    pick('group', 'Group', [['', 'No grouping'], ...groups.map(x => [x.id, x.label])], group?.id || ''), pick('sort', 'Order', [['length', 'By length'], ['group', 'By group'], ['year', 'By year']], sort)];
  const levels = group ? group.levels : [], levelOf = id => levels.find(l => l.ids.includes(id))?.label || (group ? 'Not given' : '');
  const names = group ? [...levels.map(l => l.label), ...(f.values.some(v => !levels.some(l => l.ids.includes(v.paperId))) ? ['Not given'] : [])] : [];
  const perYear = yearsPerUnit(f.unit), timeLike = perYear != null, scale = timeLike ? (1 / 12) / perYear : 1;   // a mark's months into the length's unit
  const rows = f.values.map(v => { const ms = mark ? [partOf(ctx.valueText(v.paperId, mark.fieldId), mark.key)].filter(Boolean).map(p => ({ at: monthsIn(p.text), text: p.text })).filter(x => x.at != null) : [];
    return { paperId: v.paperId, label: ctx.studyLabel(v.paperId), value: v.value, text: `${fmt(v.value)}${f.unit ? ` ${f.unit}` : ''}`, group: levelOf(v.paperId), year: ctx.yearOf?.(v.paperId) ?? null, marks: timeLike ? ms.map(x => ({ at: x.at * scale, text: x.text })) : [], attrs: kit.at([v.paperId]) }; });
  rows.sort(sort === 'year' ? (a, b) => (a.year ?? 0) - (b.year ?? 0) || b.value - a.value : sort === 'group' && group ? (a, b) => names.indexOf(a.group) - names.indexOf(b.group) || b.value - a.value : (a, b) => b.value - a.value);
  if (!rows.length) return kit.empty(filters, 'Nothing to draw for these studies');
  const svg = swimmerChart(rows.slice(0, 60), { width: 560, unit: f.unit, title: `${f.label} by study`, groups: names, bands: sort === 'group' && !!group });
  const marked = rows.filter(r => r.marks.length).length;
  const note = [count, mark ? (timeLike ? `◆ ${mark.name} at the time its text names${marked ? '' : ' (none names one)'}` : 'marks need a length in months or years') : ''].filter(Boolean).join(', ');
  // kept: a field's numbers by study (lib/output-spec.mjs reads a field's column; a measure or a number written in text has no column yet)
  const spec = f.kind === 'numeric' ? { kind: 'chart', title: `${f.label} by study`, query: { from: 'studies', select: ['label', f.label], ...where }, chart: { type: 'bar', x: 'label', y: f.label, sort: '-value' } } : null;
  return kit.panel(kit.tools(filters), figure(`${f.label} by study`, note, svg), { keep: spec ? { how: 'output', spec } : null, primary: kit.primary('Add to Tables and figures', !!spec) });
}

/** One lane per patient of a dataset or the patient table. */
function patientSwimmer(ctx, kit, source, sourcePick) {
  const mk = ctx.make, { pick } = kit, cols = columnsOf(source), rows = rowsOf(source);
  const times = cols.filter(c => c.kind === 'number'), events = cols.filter(c => c.kind === 'boolean' || c.kind === 'number'), cats = cols.filter(c => c.kind === 'category');
  const time = times.find(c => c.id === mk.field) || times.find(c => c.role === 'time') || times[0];
  if (!time) return kit.empty(sourcePick, 'No number column for the length');
  const event = events.find(c => c.id === mk.event) || events.find(c => c.role === 'event') || events.find(c => c.kind === 'boolean' && c.id !== time.id) || null;
  const mark = events.find(c => c.id === mk.marks && c.id !== time.id) || null, group = cats.find(c => c.id === mk.group) || null, sort = mk.sort === 'group' ? 'group' : 'length';
  const filters = [...sourcePick, pick('field', 'Length', times.map(c => [c.id, c.label]), time.id), pick('event', 'Event', [['', 'No event column'], ...events.filter(c => c.id !== time.id).map(c => [c.id, c.label])], event?.id || ''),
    pick('marks', 'Marks', [['', 'No marks'], ...events.filter(c => c.id !== time.id && c.id !== event?.id).map(c => [c.id, c.label])], mark?.id || ''),
    pick('group', 'Group', [['', 'No grouping'], ...cats.map(c => [c.id, c.label])], group?.id || ''), pick('sort', 'Order', [['length', 'By length'], ['group', 'By group']], sort)];
  const people = rows.map((r, i) => { const t = r.num(time.id); if (t == null || t < 0) return null;
    const markers = mark ? (mark.kind === 'number' ? (r.num(mark.id) != null ? [{ t: r.num(mark.id), kind: labelCase(mark.label) }] : []) : r.bool(mark.id) ? [{ t, kind: labelCase(mark.label) }] : []) : [];
    return { label: r.label || `Patient ${i + 1}`, group: group ? (r.text(group.id) || 'Not given') : 'All', time: t, event: event ? !!r.bool(event.id) : false, markers }; }).filter(Boolean);
  if (!people.length) return kit.empty(filters, 'No patient has a length');
  const names = [...new Set(people.map(p => p.group))].sort((a, b) => a.localeCompare(b));
  const ordered = sort === 'group' ? people.sort((a, b) => names.indexOf(a.group) - names.indexOf(b.group) || b.time - a.time) : people.sort((a, b) => b.time - a.time);
  const lanes = ordered.slice(0, 80).map((p, i) => ({ ...p, markers: p.markers.map(m => ({ t: m.t, kind: m.kind })), attrs: p.id ? kit.at ? {} : {} : {} }));
  const plot = kit.chart('swimmer', `${time.label} by patient`, [plural(people.length, 'patient'), event ? `${people.filter(p => p.event).length} with ${labelCase(event.label).toLowerCase()}` : 'no event column', mark ? `${labelCase(mark.label)} marked` : ''].filter(Boolean).join(', '),
    w => laneChart(lanes, { width: w, groups: group ? names : [], unit: time.unit, xLabel: time.unit ? `${time.label}` : time.label, title: `${time.label} by patient` }));
  // kept: the patients' lengths as a bar chart over the dataset's columns (the output engine reads a dataset by name)
  const spec = source.dataset ? { kind: 'chart', title: `${time.label} by patient`, query: { from: 'dataset', dataset: source.dataset.name, select: [source.labelCol, time.label] }, chart: { type: 'bar', x: source.labelCol, y: time.label, sort: '-value' } }
    : { kind: 'chart', title: `${time.label} by patient`, query: { from: 'patients', select: ['label', time.label] }, chart: { type: 'bar', x: 'label', y: time.label, sort: '-value' } };
  return kit.panel(kit.tools(filters), plot.html, { keep: { how: 'output', spec }, fits: { swimmer: plot.fit }, primary: kit.primary('Add to Tables and figures') });
}
