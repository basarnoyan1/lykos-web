// Cross-citations within the library (plan B7): which records cite which other
// records, read from the OpenAlex reference lists that lib/citation-chase.mjs
// already fetches for a chase. The lists are kept on the records as
// `p.openalex = { id, refs, at }`, so the graph, the figure and the CSV are
// rebuilt offline from the records alone; nothing here reaches the network
// except fetchReferences, which reuses resolveSeeds rather than asking again.
//
// The figure is an arc diagram drawn as a self-contained SVG in the manner of
// lib/output-charts.mjs: records on one axis by year, arcs above it from the
// citing to the cited record, grey and black with the c-* classes so the app's
// theme applies on screen and the download stays a publication figure.
import { resolveSeeds } from './citation-chase.mjs';
import { figureTokens } from './figure-style.mjs';
import { esc, r1, svgRoot, text, axisLine, measure, sourceBlock, keyLines } from './figure-draw.mjs';

const PER_BAND = 40;
const f1 = r1;
const labelOf = p => p.label || p.title || p.id;
const yearOf = p => { const y = Number(p.year); return Number.isFinite(y) && y > 0 ? y : null; };
const chunks = (list, n) => { const out = []; for (let i = 0; i < list.length; i += n) out.push(list.slice(i, i + n)); return out; };
const byYearThenLabel = (a, b) => (a.year ?? Infinity) - (b.year ?? Infinity) || a.label.localeCompare(b.label);
/** The token set a figure is drawn with: the caller's, else the house screen set. */
const tokensOf = style => style || figureTokens(null, { medium: 'screen', profile: 'lykos-house' });

/**
 * Finds the records in OpenAlex and reads their reference lists. Answers
 * `{ found: [{ paperId, id, refs }], missing: [paperId] }`. `resolve` defaults
 * to resolveSeeds and exists so a test can pass a fake.
 */
export async function fetchReferences(papers, { settings, signal, onProgress, resolve = resolveSeeds } = {}) {
  const { found, missing } = await resolve(papers, { settings, signal, onProgress });
  return { found: found.map(f => ({ paperId: f.paper.id, id: f.id, refs: [...f.refs] })), missing: missing.map(p => p.id) };
}

/** Writes each found record's `openalex = { id, refs, at }` onto the state's records (in place, inside an update); answers the state. */
export function saveReferences(state, found, at = new Date().toISOString()) {
  const by = new Map(found.map(f => [f.paperId, f]));
  for (const p of state.papers || []) {
    const f = by.get(p.id);
    if (f) p.openalex = { id: f.id, refs: [...new Set(f.refs)], at };
  }
  return state;
}

/**
 * The citation graph among the records, from `p.openalex` alone. Nodes are
 * the resolved records ordered by year then label; an edge runs from the
 * citing to the cited record. `components` holds the connected groups of two
 * or more, largest first; `mostCited` counts citations received within the
 * library, descending, ties by label; `isolated` records are resolved but
 * cite nothing here and are cited by nothing; `unresolved` have no OpenAlex id.
 */
export function crossCitations(papers) {
  const resolved = papers.filter(p => p.openalex?.id);
  const nodes = resolved.map(p => ({ id: p.id, oa: p.openalex.id, year: yearOf(p), label: labelOf(p), cites: [], citedBy: [] })).sort(byYearThenLabel);
  const byId = new Map(nodes.map(n => [n.id, n]));
  const byOa = new Map(nodes.map(n => [n.oa, n.id]));
  const edges = [];
  for (const p of resolved) {
    const from = byId.get(p.id);
    for (const ref of new Set(p.openalex.refs || [])) {
      const to = byOa.get(ref);
      if (!to || to === p.id) continue;
      edges.push({ from: p.id, to });
      from.cites.push(to); byId.get(to).citedBy.push(p.id);
    }
  }
  // Connected components by union-find over the edges.
  const parent = new Map(nodes.map(n => [n.id, n.id]));
  const root = id => { while (parent.get(id) !== id) { parent.set(id, parent.get(parent.get(id))); id = parent.get(id); } return id; };
  for (const e of edges) parent.set(root(e.from), root(e.to));
  const groups = new Map();
  for (const n of nodes) { const r = root(n.id); if (!groups.has(r)) groups.set(r, []); groups.get(r).push(n.id); }
  const order = new Map(nodes.map((n, i) => [n.id, i]));
  const components = [...groups.values()].filter(g => g.length > 1).sort((a, b) => b.length - a.length || order.get(a[0]) - order.get(b[0]));
  const mostCited = nodes.filter(n => n.citedBy.length).sort((a, b) => b.citedBy.length - a.citedBy.length || a.label.localeCompare(b.label)).map(n => ({ id: n.id, n: n.citedBy.length }));
  return { nodes, edges, isolated: nodes.filter(n => !n.cites.length && !n.citedBy.length).map(n => n.id),
    unresolved: papers.filter(p => !p.openalex?.id).map(p => p.id), components, mostCited };
}

/**
 * An arc diagram of the graph: records on a horizontal axis by year then
 * label, each a circle with its label beside it, arcs above the axis from citing
 * to cited record ending in an arrowhead. More than 40 records are paged into
 * bands of 40, one row each, arcs drawn within a band only; the footer says
 * so and counts the records left out for want of an OpenAlex id. A label wider
 * than its slot is drawn as a number and listed in the footer, never cut. Every
 * circle and label carries data-study with the record's id. `style` is a
 * figureTokens set (the screen set when absent); `width` is in its unit.
 */
export function citationArcSvg(graph, papers, { width = null, style = null } = {}) {
  const t = tokensOf(style), ls = t.size.label, k = ls / 12, PAD = Math.max(t.pad, ls), R = t.dot;
  const LABEL_MAX = 160 * k, nodes = graph.nodes, bands = chunks(nodes, PER_BAND), byId = new Map(nodes.map(n => [n.id, n]));
  // a label that does not fit its slot is keyed
  const keys = [], shown = new Map();
  for (const n of nodes) {
    if (measure(t, n.label) <= LABEL_MAX) { shown.set(n.id, n.label); continue; }
    keys.push({ key: String(keys.length + 1), label: n.label }); shown.set(n.id, String(keys.length));
  }
  const longest = Math.max(0, ...nodes.map(n => measure(t, shown.get(n.id))));
  // Spacing: the axis shares one step across bands; a narrow figure widens so
  // labels stay apart. Labels lean 45° when the step allows, else stand upright.
  // A leaning label reaches 0.707 × its width left of its anchor, so the first
  // node moves right by that much (less the half step it already has) and the
  // step shrinks to keep the axis inside the width.
  const perBand = Math.max(1, ...bands.map(b => b.length));
  const minW = Math.max(320 * k, width ?? t.width.double), avail = minW - 2 * PAD - 2 * R, minStep = ls + 4 * k;
  const leans = s => s * 0.707 >= ls + 2 * k;
  let step = Math.max(avail / perBand, minStep), leftPad = 0, lean = leans(step);
  if (lean) {
    leftPad = Math.ceil(longest * 0.707);
    const fitted = Math.max(leftPad <= step / 2 ? step : (avail - leftPad) / (perBand - 0.5), minStep);
    if (leans(fitted)) step = fitted; else { leftPad = 0; lean = false; }
  }
  const lead = Math.max(step / 2, leftPad);
  const w = Math.max(minW, Math.ceil(2 * PAD + 2 * R + lead + (perBand - 0.5) * step));
  const labelH = Math.ceil(lean ? longest * 0.707 + ls + 6 * k : longest + 8 * k);
  const x0 = PAD + R + lead, X = i => x0 + i * step;
  const parts = [];
  let y = PAD * 0.7, arcs = 0;
  for (const band of bands) {
    const at = new Map(band.map((n, i) => [n.id, i]));
    const within = graph.edges.filter(e => at.has(e.from) && at.has(e.to));
    const span = Math.max(0, ...within.map(e => Math.abs(at.get(e.from) - at.get(e.to)) * step));
    const arcH = Math.ceil(span * 0.3) + 12 * k;
    const ay = y + arcH;
    parts.push(axisLine(t, X(0) - R, ay, X(band.length - 1) + R, ay));
    for (const e of within) {
      const x1 = X(at.get(e.from)), x2 = X(at.get(e.to)), rx = Math.abs(x2 - x1) / 2, ry = rx * 0.6, top = ay - R - 1;
      const from = byId.get(e.from), to = byId.get(e.to), head = 3 * k;
      parts.push(`<g class="c-arc" data-from="${esc(e.from)}" data-to="${esc(e.to)}"><title>${esc(from.label)} cites ${esc(to.label)}</title>` +
        `<path d="M${f1(x1)},${f1(top)} A${f1(rx)},${f1(ry)} 0 0 ${x1 < x2 ? 1 : 0} ${f1(x2)},${f1(top)}" fill="none" stroke="${t.color.axis}" stroke-width="${t.line.ci}" class="c-axis"/>` +
        `<polygon points="${f1(x2)},${f1(top)} ${f1(x2 - head)},${f1(top - 2 * head)} ${f1(x2 + head)},${f1(top - 2 * head)}" fill="${t.color.ink2}" class="c-mute"/></g>`);
      arcs++;
    }
    band.forEach((n, i) => {
      const x = X(i), label = shown.get(n.id), full = label === n.label ? '' : `<title>${esc(n.label)}</title>`;
      parts.push(`<circle data-study="${esc(n.id)}" cx="${f1(x)}" cy="${f1(ay)}" r="${R}" class="c-dot" fill="${t.color.ink}"><title>${esc(n.label)}${n.year ? ` (${n.year})` : ''}</title></circle>`);
      const turn = lean ? `translate(${f1(x + 3 * k)},${f1(ay + R + 8 * k)}) rotate(-45)` : `translate(${f1(x + 4 * k)},${f1(ay + R + 6 * k)}) rotate(-90)`;
      parts.push(text(t, 0, 0, label, { anchor: 'end', attrs: `data-study="${esc(n.id)}" transform="${turn}"`, inner: full }).replace(' x="0" y="0"', ''));
    });
    y = ay + R + labelH + 18 * k;
  }
  if (!nodes.length) { parts.push(text(t, PAD, y + ls, 'No record has an OpenAlex id yet, so there is nothing to draw.', { cls: 'c-mute' })); y += ls * 1.6; }
  // Footer: the counts of the whole graph (arcs across rows are not drawn but
  // are still citations), then the key to the numbered labels, wrapped to the figure.
  const n = nodes.length, m = graph.edges.length, u = graph.unresolved.length, iso = graph.isolated.length;
  const counts = [`${n} ${n === 1 ? 'record' : 'records'} on the axis`, `${m} ${m === 1 ? 'citation' : 'citations'} within the library`, `${iso} isolated`];
  if (u) counts.push(`${u} not found in OpenAlex, left out`);
  const notes = [counts.join(' · ')];
  if (bands.length > 1) notes.push(`Records in ${bands.length} rows of up to ${PER_BAND}, by year; arcs are drawn within a row only (${arcs} of ${m} shown).`);
  const foot = sourceBlock(t, PAD, y, w - 2 * PAD, [...notes, ...keyLines(keys)]);
  parts.push(foot.svg);
  const h = Math.ceil(y + foot.h + PAD * 0.7);
  return svgRoot(t, w, h, parts.join(''), { title: 'Citations within the library', desc: counts.join(', ') });
}

/** Rows for a CSV: a header, then one row per edge with the citing and cited record's label (fallback title) and year. */
export function crossCitationCsv(graph, papers) {
  const byId = new Map(papers.map(p => [p.id, p]));
  const node = new Map(graph.nodes.map(n => [n.id, n]));
  const label = id => { const p = byId.get(id); return p ? labelOf(p) : node.get(id)?.label ?? id; };
  const year = id => { const p = byId.get(id); return (p ? yearOf(p) : node.get(id)?.year) ?? ''; };
  return [['citing', 'citing_year', 'cited', 'cited_year'], ...graph.edges.map(e => [label(e.from), year(e.from), label(e.to), year(e.to)])];
}

/** The house drawings app/lint-figures.mjs checks: a small graph, and a paged one with a label too long for its slot. */
export const __fixture = style => {
  const rec = (id, year, oa, refs, label) => ({ id, label: label || `${id.toUpperCase()} ${year}`, year, ...(oa ? { openalex: { id: oa, refs, at: '2026-09-29T00:00:00.000Z' } } : {}) });
  const small = [rec('a', 2010, 'W1', []), rec('b', 2015, 'W2', ['W1']), rec('c', 2018, 'W3', ['W1', 'W2']), rec('d', 2012, 'W4', []), rec('e', 2019, 'W5', ['W4']), rec('f', 2016, 'W6', ['W7']), rec('g', 2017, null)];
  const keyed = small.map(p => p.id === 'c' ? { ...p, label: 'Outcomes after early intervention in a population-based cohort with long follow-up, 2018' } : p);
  const paged = Array.from({ length: 52 }, (_, i) => rec(`p${i}`, 1980 + i, `W${100 + i}`, i ? ['W100', `W${100 + (i >> 1)}`] : []));
  const draw = ps => citationArcSvg(crossCitations(ps), ps, { style });
  return [{ name: 'citationArcSvg', svg: draw(small) }, { name: 'citationArcSvg-keyed', svg: draw(keyed) }, { name: 'citationArcSvg-paged', svg: draw(paged) },
    { name: 'citationArcSvg-empty', svg: draw([{ id: 'x', label: 'X' }]) }];
};
