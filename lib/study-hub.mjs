// What a study holds, read for its panel (plan §2, "A study in Details"): its extracted values by group, its risk-of-bias judgements, its
// files and where it is used. Pure over the state; the panel draws each part only when it is opened (lib/study.mjs).
import { cellsOf } from './record-index.mjs';
import { templateById, columnsOf } from './templates.mjs';
import { lib_arms$splitCellId as splitCellId } from "../boot.mjs";
import { lib_outcome_ids$splitEntry as splitEntry } from "../boot.mjs";
import { instrumentFor } from './study-instrument.mjs';
import { lib_rob_review$effectiveAnswers as effectiveAnswers, lib_rob_review$STUDY as STUDY, lib_rob_review$OVERALL as OVERALL } from "../boot.mjs";
import { lib_outcomes$outcomes as outcomes, lib_outcomes$shownOutcomes as shownOutcomes, lib_outcomes$timepointsOf as timepointsOf, lib_outcomes$slotId as slotId, lib_outcomes$analysisOf as analysisOf, lib_outcomes$PRIMARY as PRIMARY } from "../boot.mjs";
import { currentSpec } from './output-spec.mjs';
import { renderOutput } from './output-render.mjs';

const textOf = v => (v == null ? '' : v.availability === 'not_found' && v.reported_value == null ? 'NR' : String(v.reported_value ?? v.normalized_value ?? ''));

/**
 * The study's extracted values by group: [{ group, rows: [{ key, field, label, text }] }]. A value sits in the table that holds it (the
 * project's tables by name) or, for a measure of an outcome, under that outcome; `field` is the cell's column as Extraction names it.
 */
export function studyValues(st, p) {
  const cells = cellsOf(st, p.id), cols = new Map(), groups = new Map(), byKey = new Map(cells);
  const colsOf = t => { if (!cols.has(t)) cols.set(t, columnsOf(t, st)); return cols.get(t); };
  for (const [key, v] of cells) {
    const field = key.slice(p.id.length + 1), dot = field.indexOf('.');
    const tpl = dot > 0 && templateById(field.slice(0, dot), st) ? field.slice(0, dot) : 'default', id = tpl === 'default' ? field : field.slice(dot + 1);
    const { columnId, arm: armOf } = splitCellId(id), { column, entry } = splitEntry(columnId);
    const col = colsOf(tpl).find(c => c.id === id) || colsOf(tpl).find(c => c.id === columnId) || (entry ? colsOf(tpl).find(c => c.id === column) : null);
    const arm = !colsOf(tpl).some(c => c.id === id) && armOf;
    // an outcome entry's statistic says what it measures: "End n, HAM-D17, 12 weeks", not its key (owner, 15 Nov 2026)
    const about = entry && !/^out_(instrument|time)$/.test(column) ? ['instrument', 'time'].map(k => textOf(byKey.get(`${p.id}:${tpl === 'default' ? '' : `${tpl}.`}out_${k}~${entry}`))).filter(t => t && t !== 'NR') : [];
    const group = col?.outcome ? outcomes(st).find(o => o.id === col.outcome)?.name || 'Outcomes' : col?.analysis || entry ? 'Outcomes' : templateById(tpl, st)?.name || 'Study data';
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group).push({ key, field, label: `${[spokenLabel(col?.label || (entry ? column : id)), ...about].join(', ')}${arm ? ` (${arm.replace('arm', 'arm ')})` : ''}`, text: textOf(v) });
  }
  return [...groups].map(([group, rows]) => ({ group, rows }));
}

/** A column named by its id ("sham_phase_weeks", "out_end_n") reads as words: "Sham phase weeks", "End n"; any other label as written. */
export const spokenLabel = label => { const t = String(label ?? ''); return /^[a-z0-9]+(?:_[a-z0-9]+)+$/.test(t) ? t.replace(/^out_/, '').replace(/_/g, ' ').replace(/^./, c => c.toUpperCase()) : t; };

/** The study's risk-of-bias judgements: { tool, overall, rows: [{ id, label, level }] }, a domain not judged with an empty level; null without any. */
export function studyRob(st, p) {
  const tool = instrumentFor(st, p.id), a = effectiveAnswers(st, p.id, tool.id, STUDY).answers || {};
  const rows = tool.domains.map(d => ({ id: d.id, label: d.label || d.name || d.id, level: a[d.id] || '' }));
  return rows.some(r => r.level) ? { tool: tool.name, overall: a[OVERALL] || '', rows } : null;
}

/** The analyses with a result, and those that pooled this study (a proportion records its cells, a pooled effect its studies' labels). */
export function analysesOf(st, p) {
  const results = shownOutcomes(st).flatMap(o => timepointsOf(st, o.id).map(t => ({ o, a: analysisOf(st, slotId(o.id, t.id)) }))).filter(r => r.a);
  const label = String(p.label || '');
  const uses = ({ a: r }) => (Array.isArray(r.sources) && r.sources.length ? r.sources.some(k => String(k).startsWith(`${p.id}:`))
    : !!label && (r.labels || []).some(l => l === label || String(l).startsWith(`${label} · `) || String(l).startsWith(`${label}, `)));   // lint-allow-dot: reads labels saved before 2026-10-20
  return { results, used: results.filter(uses) };
}

/** The study's files: its PDF, and the other reports of its trial (the main report's linked reports: Papers/Companions) with theirs. */
export function studyFiles(st, p) {
  const key = x => x.reportOf || x.id, trial = key(p);
  const file = x => ({ id: x.id, label: x.label || x.title || x.id, rel: x.pdfRel || '', pdf: Boolean(x.pdf || x.pdfRel || x.pdfRetrieval?.status === 'preview') });
  const others = (st.papers || []).filter(x => x.id !== p.id && key(x) === trial && (x.id !== trial || p.reportOf));
  return { own: file(p), companions: others.map(file) };
}

/** The saved tables and figures whose rows or points draw on the study: [{ id, title, kind }], in the order they are kept. */
export function outputsOf(st, p) {
  const out = [];
  for (const o of st.outputs || []) {
    const spec = currentSpec(o);
    if (!spec?.query) continue;
    let m; try { m = renderOutput(st, spec); } catch { continue; }
    const refs = (m.groups || []).flatMap(g => g.refs || []).flat(2);
    if (refs.some(r => r === p.id || r?.paperId === p.id || r?.id === p.id)) out.push({ id: o.id, title: spec.title || o.id, kind: spec.kind === 'chart' ? 'figure' : 'table' });
  }
  return out;
}

/** Where the study is used: the analyses that pooled it and the tables and figures that draw on it. */
export function studyUses(st, p) {
  const { results, used } = analysesOf(st, p);
  return { analyses: [...new Map(used.map(({ o }) => [o.id, { id: o.id, name: o.name, item: o.id === PRIMARY ? 'pairwise' : `pairwise:${o.id}` }])).values()], of: results.length, outputs: outputsOf(st, p) };
}
