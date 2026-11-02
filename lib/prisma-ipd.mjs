// PRISMA-IPD flow: the counts a patient-level review reports, which of them the
// project can derive, and the diagram (plan §3.K, §PRISMA-IPD).
//
// PRISMA 2020's flow (lib/prisma-flow.mjs) has no place for what an IPD review
// must say: how many eligible studies gave patient data, how many patients
// came with them, how many were left out and why. The PRISMA-IPD diagram
// (Stewart et al. 2015) adds that: identification, screening, eligibility,
// obtaining data, analysed data.
//
// What can be counted from the project is counted: the searches in the log,
// the decisions on the reports, and the patients on record with the study
// each came from. What cannot (the patients in a study that reported only
// aggregates, patients left out by the review's own rule) is entered by hand
// with its explanation, exactly as PRISMA 2020's counts are (plan K1); a count
// entered by hand that differs from the project's own is shown beside it.
//
// The reasons a report was excluded are the review's own words, so which of
// them mean "eligible but no patient data" (a box of its own) and which mean
// "the study gave data but some patients were left out" (another) is a rule the
// review states, kept in `s.prismaIpd.rules` as patterns; the defaults read the
// common wordings.
import { figureTokens } from './figure-style.mjs';
import { svgRoot, measure, esc } from './figure-draw.mjs';
import { flowGeometry, flowLines, flowBox, flowBand, flowArrow, flowPath, flowMarker } from './flow-draw.mjs';
import { survivalInputStatus } from './survival-run.mjs';
import { ownRun } from './reviews.mjs';
import { sourceName } from './prisma-counts.mjs';

export const DEFAULT_RULES = {
  notProvided: ['no individual patient data', 'aggregate (data )?only', 'no ipd'],
  participantsExcluded: ['brachytherapy'],
};
const anyOf = (patterns, text) => patterns.some(p => { try { return new RegExp(p, 'i').test(text); } catch { return false; } });
export const rulesOf = s => ({ ...DEFAULT_RULES, ...(s.prismaIpd?.rules || {}) });

/** Counts each field means, in the diagram's order, with the label the box carries. */
export const IPD_FIELDS = [
  { id: 'identified_db', label: 'Studies identified through database searching', phase: 'Identification' },
  { id: 'identified_other', label: 'Additional studies identified through other sources', phase: 'Identification' },
  { id: 'after_duplicates', label: 'Studies after duplicates removed', phase: 'Identification' },
  { id: 'screened', label: 'Studies screened for eligibility', phase: 'Screening' },
  { id: 'excluded', label: 'Studies excluded', phase: 'Screening' },
  { id: 'sought', label: 'Studies for which IPD were sought', phase: 'Eligibility' },
  { id: 'not_sought', label: 'Eligible studies for which IPD were not sought', phase: 'Eligibility' },
  { id: 'provided_studies', label: 'Studies for which IPD were provided', phase: 'Obtaining data' },
  { id: 'provided_participants', label: 'Participants for whom data were provided', phase: 'Obtaining data' },
  { id: 'no_data_participants', label: 'Participants for whom no data were provided', phase: 'Obtaining data' },
  { id: 'notprovided_studies', label: 'Studies for which IPD were not provided', phase: 'Obtaining data' },
  { id: 'notprovided_participants', label: 'Participants in studies for which IPD were not provided', phase: 'Obtaining data' },
  { id: 'aggregate_studies', label: 'Studies for which aggregate data were available', phase: 'Obtaining data' },
  { id: 'aggregate_participants', label: 'Participants in studies with aggregate data', phase: 'Obtaining data' },
  { id: 'analysed_studies', label: 'IPD: studies included in analysis', phase: 'Analysed data' },
  { id: 'analysed_participants', label: 'IPD: participants included in analysis', phase: 'Analysed data' },
  { id: 'excluded_participants', label: 'IPD: participants excluded', phase: 'Analysed data' },
  { id: 'agg_analysed_studies', label: 'Aggregate data: studies included in analysis', phase: 'Analysed data' },
  { id: 'agg_analysed_participants', label: 'Aggregate data: participants included in analysis', phase: 'Analysed data' },
];
/** Counts a person can enter (the others are derived and shown as they are, unless entered over). */
export const HAND_FIELDS = ['identified_other', 'not_sought', 'no_data_participants', 'notprovided_participants', 'aggregate_studies', 'aggregate_participants',
  'excluded_participants', 'agg_analysed_studies', 'agg_analysed_participants'];

const isSourced = r => ownRun(r) && (r.kind ?? 'database') === 'database' && r.status !== 'failed' && !r.exploratory;

/**
 * Counts derived from the project. `excludedBy` lists each exclusion reason with
 * its number and where it sits in the diagram, so the box can name them.
 */
export function deriveIpd(s) {
  const out = {}, rules = rulesOf(s);
  const papers = s.papers || [], ft = s.fulltext || {}, sc = s.screening || {};
  const runs = (s.searches || []).filter(isSourced);
  const db = runs.reduce((a, r) => a + (Number(r.retrieved) || 0), 0);
  if (db) out.identified_db = db;
  // each database by name under the total, as PRISMA 2020 names them (lib/prisma-counts.mjs perSource)
  if (runs.length) { const by = new Map(); for (const r of runs) { const k = sourceName(r.source); by.set(k, (by.get(k) || 0) + (Number(r.retrieved) || 0)); }
    out.identifiedBy = [...by].map(([reason, n]) => ({ reason, n })); }
  // Every report with a decision is a study screened; a report with none has not been reached.
  const decided = papers.filter(p => ft[p.id]?.decision || sc[p.id]?.decision === 'exclude');
  const reason = p => String((ft[p.id] || sc[p.id])?.reason || '');
  const excluded = decided.filter(p => (ft[p.id]?.decision || sc[p.id]?.decision) === 'exclude');
  const noIpd = excluded.filter(p => anyOf(rules.notProvided, reason(p)));
  const partEx = excluded.filter(p => !noIpd.includes(p) && anyOf(rules.participantsExcluded, reason(p)));
  const plain = excluded.filter(p => !noIpd.includes(p) && !partEx.includes(p));
  if (decided.length) {
    out.screened = decided.length;
    out.after_duplicates = decided.length;
    out.excluded = plain.length;
    out.sought = decided.length - plain.length;
    out.notprovided_studies = noIpd.length;
  }
  // patients rebuilt from a published curve are aggregate data, not individual participant data (lib/km-ipd.mjs)
  const people = (s.participants || []).filter(x => x.study_id && !x.reconstructed);
  const inStudies = people.filter(x => papers.find(p => p.id === x.study_id && !p.institutional));
  const published = new Set(inStudies.map(x => x.study_id));
  const ext = s.survival?.ext, analysisStatus = survivalInputStatus(s);
  // Obtaining data and analysing data are distinct. Only a tracked run establishes an analysed population.
  const population = ['current', 'stale'].includes(analysisStatus) && ext?.population ? ext.population : null;
  const analysed = (population?.participants || []).filter(x => x.study_id && !x.reconstructed);
  const isPublished = x => x.institutional === undefined ? !!papers.find(p => p.id === x.study_id && !p.institutional) : !x.institutional;
  const analysedPublished = analysed.filter(isPublished);
  const excludedKnown = (population?.excluded || []).filter(x => x.study_id && !x.reconstructed && isPublished(x));
  const inst = analysed.length - analysedPublished.length;
  const handExcluded = Number(s.prismaIpd?.excluded_participants) || 0;
  if (people.length) {
    out.provided_studies = published.size + partEx.length;
    // A manually recorded exclusion total may include patients not retained in the local table.
    out.provided_participants = inStudies.length + Math.max(0, handExcluded - excludedKnown.length);
  }
  if (population) {
    out.analysed_studies = new Set(analysedPublished.map(x => x.study_id)).size;
    out.analysed_participants = analysed.length;
    out.excluded_participants = excludedKnown.length;
    const by = new Map();
    for (const x of excludedKnown) by.set(x.why, (by.get(x.why) || 0) + 1);
    out.analysisExcludedBy = [...by].map(([reason, n]) => ({ reason, n }));
  }
  if (people.length || s.survival) out.analysisStatus = population ? analysisStatus : analysisStatus === 'none' ? 'none' : 'untracked';
  const reasonRows = list => {
    const by = new Map();
    for (const p of list) by.set(reason(p) || 'No reason recorded', (by.get(reason(p) || 'No reason recorded') || 0) + 1);
    return [...by].map(([r, n]) => ({ reason: r, n })).sort((a, b) => b.n - a.n);
  };
  out.excludedBy = reasonRows(plain);
  out.notProvidedBy = reasonRows(noIpd);
  out.participantsExcludedBy = reasonRows(partEx);
  out.institutional = inst;
  return out;
}

/** What every page shows: derived, then entered by hand over it. */
export const prismaIpdData = s => {
  const d = deriveIpd(s), hand = Object.fromEntries(Object.entries(s.prismaIpd || {}).filter(([k, v]) => k !== 'rules' && v !== '' && v != null));
  return { ...d, ...hand };
};
/**
 * Every count of the diagram as it stands now, with where it comes from. Read from the
 * project each time it is asked for: no derived count is kept, so a report, a figure or a
 * manuscript link made from it follows the patients and decisions on record.
 */
export function ipdCountRows(s) {
  const d = deriveIpd(s), data = prismaIpdData(s), notes = s.prismaNotes || {};
  return IPD_FIELDS.filter(f => data[f.id] !== undefined && data[f.id] !== null).map(f => {
    const hand = s.prismaIpd?.[f.id] !== undefined && s.prismaIpd[f.id] !== '' && s.prismaIpd[f.id] !== null && d[f.id] !== s.prismaIpd[f.id];
    return { id: f.id, label: f.label, phase: f.phase, count: data[f.id], source: hand ? 'Entered' : 'Project', project: d[f.id] ?? null, explanation: hand ? notes[`ipd:${f.id}`] || '' : '' };
  });
}

/** Fields entered by hand whose value differs from the project's own, or that the project cannot derive. */
export function handEntered(s) {
  const d = deriveIpd(s), out = [];
  for (const [k, v] of Object.entries(s.prismaIpd || {})) {
    if (k === 'rules' || v === '' || v == null) continue;
    if (d[k] !== v) out.push({ id: k, value: v, derived: d[k] ?? null, note: (s.prismaNotes || {})[`ipd:${k}`] || '' });
  }
  return out;
}

/**
 * Checks the diagram must satisfy, as sentences: what does not add up, and
 * which counts are missing. Empty when the flow is consistent.
 */
export function reconcile(d) {
  const out = [], has = k => Number.isFinite(Number(d[k]));
  const n = k => Number(d[k]);
  if (d.analysisStatus === 'none') out.push('No patient analysis has been run. Run the analysis before claiming analysed study and participant counts.');
  if (d.analysisStatus === 'untracked') out.push('The saved patient analysis has no verified input snapshot or population. Run it again before claiming analysed counts.');
  if (d.analysisStatus === 'stale') out.push('Patient data changed since the saved analysis. The analysed counts describe that earlier run; run it again before reporting them.');
  if (has('screened') && has('excluded') && has('sought') && has('not_sought') === false && n('screened') - n('excluded') !== n('sought'))
    out.push(`Screened ${n('screened')} less excluded ${n('excluded')} is ${n('screened') - n('excluded')}, not the ${n('sought')} for which IPD were sought.`);
  if (has('screened') && has('excluded') && has('sought') && has('not_sought') && n('screened') - n('excluded') - n('not_sought') !== n('sought'))
    out.push(`Screened ${n('screened')} less excluded ${n('excluded')} and not sought ${n('not_sought')} is ${n('screened') - n('excluded') - n('not_sought')}, not the ${n('sought')} for which IPD were sought.`);
  if (has('sought') && has('provided_studies') && has('notprovided_studies') && n('provided_studies') + n('notprovided_studies') !== n('sought'))
    out.push(`Studies with IPD provided (${n('provided_studies')}) and not provided (${n('notprovided_studies')}) make ${n('provided_studies') + n('notprovided_studies')}, not the ${n('sought')} sought.`);
  if (has('provided_participants') && has('analysed_participants') && has('excluded_participants')) {
    const inst = Number(d.institutional) || 0;
    const from = n('analysed_participants') - inst + n('excluded_participants') + (has('no_data_participants') ? n('no_data_participants') : 0);
    if (from !== n('provided_participants')) out.push(`Participants analysed${inst ? ` from studies (${n('analysed_participants') - inst})` : ` (${n('analysed_participants')})`}, excluded (${n('excluded_participants')}) and without data (${has('no_data_participants') ? n('no_data_participants') : 0}) make ${from}, not the ${n('provided_participants')} for whom data were provided.`);
  }
  if (has('identified_db') && has('after_duplicates')) {
    const total = n('identified_db') + (has('identified_other') ? n('identified_other') : 0);
    if (total < n('after_duplicates')) out.push(`More studies remain after duplicates (${n('after_duplicates')}) than were identified (${total}).`);
  }
  return out;
}

// ---- reading counts from a filled diagram -----------------------------------------
const BOX = [
  ['identified_db', /number of studies identified through database searching\s*\(n\s*=\s*([\d,]+)\)/i],
  ['identified_other', /number of additional studies identified through other sources[^()]*\(n\s*=\s*([\d,]+)\)/i],
  ['after_duplicates', /number of studies after duplicates removed\s*\(n\s*=\s*([\d,]+)\)/i],
  ['screened', /number of studies screened for eligibility\s*\(n\s*=\s*([\d,]+)\)/i],
  ['excluded', /number of studies excluded\s*\(n\s*=\s*([\d,]+)\)/i],
  ['sought', /number of studies for which ipd were sought\s*\(n\s*=\s*([\d,]+)\)/i],
  ['not_sought', /number of eligible studies for which ipd were not sought\s*\(n\s*=\s*([\d,]+)\)/i],
  ['provided_studies', /number of studies for which ipd were provided\s*\(n\s*=\s*([\d,]+)\)/i],
  ['provided_participants', /number of participants for whom data were provided\s*\(n\s*=\s*([\d,]+)\)/i],
  ['no_data_participants', /number of participants for whom no data were provided\s*\(n\s*=\s*([\d,]+)\)/i],
  ['notprovided_studies', /number of studies for which ipd were not provided\s*\(n\s*=\s*([\d,]+)\)/i],
  ['notprovided_participants', /number of studies for which ipd were not provided[^\n]*?number of participants\s*\(n\s*=\s*([\d,]+)\)/is],
  ['aggregate_studies', /number of studies for which aggregate data were available\s*\(n\s*=\s*([\d,]+)\)/i],
];
/**
 * The counts a filled PRISMA-IPD diagram (a Word file's text) states, by the
 * box each is in: `{ field: { n, phrase } }`. Nothing is interpreted: a box
 * the text does not carry is absent.
 */
export function ipdFromText(text) {
  const t = String(text || '').replace(/\s+/g, ' ');
  const out = {};
  for (const [k, re] of BOX) { const m = re.exec(t); if (m) out[k] = { n: Number(m[1].replace(/,/g, '')), phrase: m[0].slice(0, 140) }; }
  const ex = /participants excluded\s*\(n\s*=\s*(\d+)/i.exec(t);
  if (ex) out.excluded_participants = { n: Number(ex[1]), phrase: ex[0].slice(0, 140) };
  return out;
}

// ---- the diagram -----------------------------------------------------------------------
// The layout in px at 11 px type; the house style scales it to its own label size (flow-draw.mjs flowGeometry).
const LAYOUT = { PADX: 8, PADY: 9, GAP_X: 26, GAP_Y: 24, PAD: 20, W: 250, SIDE: 30, SIDE_GAP: 14, TITLE_H: 30, MIN_H: 38 };
const nn = v => `(n = ${v == null || v === '' || (typeof v === 'number' && !Number.isFinite(v)) ? 'NA' : v})`;
const reasonLines = list => (list || []).map(x => `${x.reason} ${nn(x.n)}`);

/**
 * The PRISMA-IPD flow as a self-contained SVG: identification, screening,
 * eligibility, obtaining data and analysed data, with the reasons under the
 * boxes that carry them. A count the project has not got reads "NA", never
 * a guess. It is drawn in the house style, like the PRISMA 2020 diagram: monochrome boxes and bands, no title in the figure
 * (the caption names it; `title` goes to <title>), sized in the unit of `style` (figureTokens; the print copy without one).
 */
export function prismaIpdFlow(d = {}, { title = 'PRISMA-IPD flow diagram', style = null } = {}) {
  d = d || {};
  const ts = style || figureTokens(null, { medium: 'export' });
  const G = flowGeometry(ts, LAYOUT);
  const { GAP_X, PAD, W, SIDE } = G;
  const box = (width, heading, lines) => {
    // a count "(n = 38)" is one word: it moves to the next line whole, never split after "(n ="
    const keep = x => (x == null ? x : String(x).replace(/\(n = ([^)]*)\)/g, (m, v) => `(n\u0001=\u0001${v})`));
    const all = flowLines(ts, width, G.PADX, keep(heading), lines.map(keep)).map(l => ({ ...l, t: l.t.replace(/\u0001/g, ' ') }));
    return { width, lines: all, height: Math.max(G.MIN_H, all.length * G.LH + 2 * G.PADY) };
  };
  const b = {};
  b.db = box(W, null, ['Number of studies identified through database searching', nn(d.identified_db), ...reasonLines(d.identifiedBy)]);
  b.other = box(W, null, ['Number of additional studies identified through other sources', nn(d.identified_other)]);
  b.dedup = box(W, null, ['Number of studies after duplicates removed', nn(d.after_duplicates)]);
  b.screened = box(W, null, ['Number of studies screened for eligibility', nn(d.screened)]);
  b.excluded = box(W, `Number of studies excluded ${nn(d.excluded)}`, reasonLines(d.excludedBy));
  b.sought = box(W, null, ['Number of studies for which IPD were sought', nn(d.sought)]);
  b.notSought = box(W, null, ['Number of eligible studies for which IPD were not sought', nn(d.not_sought)]);
  b.provided = box(W, null, ['Number of studies for which IPD were provided', nn(d.provided_studies),
    'Number of participants for whom data were provided', nn(d.provided_participants), 'Number of participants for whom no data were provided', nn(d.no_data_participants)]);
  b.notProvided = box(W, `Number of studies for which IPD were not provided ${nn(d.notprovided_studies)}`,
    [...reasonLines(d.notProvidedBy), `Number of participants ${nn(d.notprovided_participants)}`]);
  b.agg = box(W, null, ['Number of studies for which aggregate data were available', nn(d.aggregate_studies), 'Number of participants', nn(d.aggregate_participants)]);
  b.ipd = box(W, 'IPD', [`Number of studies included in analysis ${nn(d.analysed_studies)}`,
    `Number of participants included in analysis ${nn(d.analysed_participants)}${d.institutional ? `, of whom ${d.institutional} not from a study` : ''}`,
    `Participants excluded ${nn(d.excluded_participants)}`, ...reasonLines(d.participantsExcludedBy).map(x => `  ${x}`), `No data provided ${nn(d.no_data_participants)}`]);
  b.aggData = box(W, 'Aggregate data', [`Number of studies included in analysis ${nn(d.agg_analysed_studies)}`, `Number of participants included in analysis ${nn(d.agg_analysed_participants)}`]);

  const xA = PAD + SIDE + G.SIDE_GAP, xB = xA + W + GAP_X;
  const rows = [[b.db, b.other], [b.dedup], [b.screened, b.excluded], [b.sought, b.notSought], [b.provided, b.notProvided], [b.ipd, b.agg], [null, b.aggData]];
  const rowH = r => Math.max(...r.filter(Boolean).map(x => x.height));
  // the phase bands (first row, last row); a band is read bottom to top, so it must be as tall as its name is wide
  const phases = [['Identification', 0, 1], ['Screening', 2, 2], ['Eligibility', 3, 3], ['Obtaining data', 4, 4], ['Analysed data', 5, 6]];
  const gaps = rows.map(() => G.GAP_Y);
  for (const [name, a, z] of phases) {
    const own = rows.slice(a, z + 1).reduce((sum, r, i) => sum + rowH(r) + (a + i < z ? gaps[a + i] : 0), 0);
    const room = own + (a > 0 ? gaps[a - 1] / 2 : 0) + (z < rows.length - 1 ? gaps[z] / 2 : 0);
    const need = measure(ts, name, 'label') * 1.1 + 2 * G.PADX;
    if (need > room && z < rows.length - 1) gaps[z] += (need - room) * 2;
  }
  let y = PAD;
  const ys = rows.map((r, i) => { const top = y; y += rowH(r) + gaps[i]; return top; });
  const at = (bx, x, i) => { if (bx) { bx.x = x; bx.y = ys[i]; } };
  at(b.db, xA, 0); at(b.other, xB, 0); at(b.dedup, xA, 1); at(b.screened, xA, 2); at(b.excluded, xB, 2); at(b.sought, xA, 3); at(b.notSought, xB, 3);
  at(b.provided, xA, 4); at(b.notProvided, xB, 4); at(b.ipd, xA, 5); at(b.agg, xB, 5); at(b.aggData, xB, 6);
  // the aggregate box under "not provided" feeds "aggregate data"; IPD feeds the IPD analysis
  const lastGap = gaps.at(-1);
  const canvasW = xB + W + PAD, canvasH = y - lastGap + PAD;

  const out = [];
  const body = bx => flowBox(ts, bx, { padY: G.PADY, lh: G.LH });
  const draw = (bx, aria) => bx ? `<g role="group" aria-label="${esc(aria)}">${body(bx)}</g>` : '';
  const A = [], AH = 'ah-ipd', gap1 = ts.line.box;
  const line = (x1, y1, x2, y2) => A.push(flowArrow(ts, AH, x1, y1, x2, y2));
  const cx = bx => bx.x + bx.width / 2, bottom = bx => bx.y + bx.height, mid = bx => bx.y + bx.height / 2;
  line(cx(b.db), bottom(b.db), cx(b.dedup), b.dedup.y - gap1);
  const elbow = `M ${cx(b.other)} ${bottom(b.other)} V ${mid(b.dedup)} H ${b.dedup.x + b.dedup.width + gap1}`;
  A.push(flowPath(ts, AH, elbow));
  line(cx(b.dedup), bottom(b.dedup), cx(b.screened), b.screened.y - gap1);
  line(b.screened.x + W, mid(b.screened), b.excluded.x - gap1, mid(b.screened));
  line(cx(b.screened), bottom(b.screened), cx(b.sought), b.sought.y - gap1);
  line(b.sought.x + W, mid(b.sought), b.notSought.x - gap1, mid(b.sought));
  line(cx(b.sought), bottom(b.sought), cx(b.provided), b.provided.y - gap1);
  line(b.provided.x + W, mid(b.provided), b.notProvided.x - gap1, mid(b.provided));
  line(cx(b.provided), bottom(b.provided), cx(b.ipd), b.ipd.y - gap1);
  line(cx(b.notProvided), bottom(b.notProvided), cx(b.agg), b.agg.y - gap1);
  line(cx(b.agg), bottom(b.agg), cx(b.aggData), b.aggData.y - gap1);
  const band = (text, top, bottomY) => flowBand(ts, PAD, top, SIDE, bottomY - top, text);
  const end = i => ys[i] + rowH(rows[i]);
  // each band runs to the middle of the gap beside it, so bands tile the column without touching
  for (const [name, a, z] of phases) out.push(band(name, a === 0 ? ys[0] : ys[a] - gaps[a - 1] / 2 + gap1, z === rows.length - 1 ? end(z) : end(z) + gaps[z] / 2 - gap1));
  out.push(...A);
  out.push(draw(b.db, 'Studies identified through database searching'), draw(b.other, 'Studies identified through other sources'), draw(b.dedup, 'Studies after duplicates removed'),
    draw(b.screened, 'Studies screened for eligibility'), draw(b.excluded, 'Studies excluded'), draw(b.sought, 'Studies for which IPD were sought'),
    draw(b.notSought, 'Eligible studies for which IPD were not sought'), draw(b.provided, 'Studies for which IPD were provided'),
    draw(b.notProvided, 'Studies for which IPD were not provided'), draw(b.agg, 'Studies for which aggregate data were available'),
    draw(b.ipd, 'IPD analysed'), draw(b.aggData, 'Aggregate data analysed'));
  return svgRoot(ts, canvasW, canvasH, out.join(''), { title, desc: 'PRISMA-IPD: identification, screening, eligibility, obtaining data, analysed data', defs: flowMarker(ts, AH) });
}

/** The house drawings app/lint-figures.mjs checks: the diagram with reasons under the excluded boxes and a participant note. */
export const __fixture = style => [{ name: 'prismaIpdFlow', svg: prismaIpdFlow({ identified_db: 519, identified_other: 275, after_duplicates: 612, screened: 612, excluded: 540,
  excludedBy: [{ reason: 'Not a randomised comparison of the review question', n: 402 }, { reason: 'Wrong population', n: 138 }], sought: 72, not_sought: 4,
  provided_studies: 38, provided_participants: 5120, no_data_participants: 210, notprovided_studies: 30, notProvidedBy: [{ reason: 'Aggregate data only', n: 22 }, { reason: 'No reply', n: 8 }], notprovided_participants: 4410,
  aggregate_studies: 22, aggregate_participants: 3100, analysed_studies: 38, analysed_participants: 4910, institutional: 120, excluded_participants: 210,
  participantsExcludedBy: [{ reason: 'Prior brachytherapy', n: 210 }], agg_analysed_studies: 22, agg_analysed_participants: 3100 }, { style }) }];
