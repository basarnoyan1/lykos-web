// Cross-checks of a manuscript's numbers (plan W9c 4; spec "Proven links", 2026-11-07): what its numbers say against each other and
// against the app, beside the check of each number against its source (lib/number-check.mjs). Run when the structured check is built and
// kept in it, `cross: [{ kind, rows: [n], text, place }]`, shown as the reader's cards (lib/manuscript-comments.mjs, kind 'cross') and by
// `lykos completeness`. Each kind reports only a disagreement it can name:
//   run      a number the check could not match, beside two or more numbers of its sentence or cell that one run output prints
//   total    a table's Total, All or Overall row against the sum of the other rows, column by column, when the rows partition it (another
//            count column of the same table adds up)
//   percent  "n/N (x%)", "n of N (x%)" and "x% (n/N)": x is n/N as printed, to its own decimals
//   prisma   a number the text names as records identified or screened, reports assessed in full text, or studies or reports included,
//            against the app's flow (flowFacts: lib/prisma-counts.mjs prismaData and lib/review-counts.mjs reviewCounts)
//   grade    a summary-of-findings table's certainty and its trials (participants) against the certainty record (gradeFacts: s.grade,
//            lib/grade.mjs certainty)
// Pure: the caller gives the check's rows, the files' checked units (number-check.mjs checkedUnits), the run and the facts.

export const CROSS_KINDS = Object.freeze(['run', 'total', 'percent', 'prisma', 'grade']);

const intOf = t => { const s = String(t ?? '').trim(); return /^(?:\d{1,3}(?:,\d{3})+|\d+)$/.test(s) ? Number(s.replace(/,/g, '')) : null; };
const num = x => (x == null || x === '' || !Number.isFinite(Number(x)) ? null : Number(x));
const clean = t => String(t ?? '').replace(/[   ]/g, ' ').replace(/\s+/g, ' ').trim();
const dec = s => (String(s).split('.')[1] || '').length;

/** A cell that holds counts only: "115", "3,053", "46/747", "46 (747)" give their integers; null for anything else (a mean, a range, a word). */
export function cellCounts(text) {
  const t = clean(text);
  if (!/^\d[\d,]*(?:\s*\/\s*\d[\d,]*|\s*\(\s*\d[\d,]*\s*\))*$/.test(t)) return null;
  const parts = t.match(/\d[\d,]*/g).map(intOf);
  return parts.every(x => x != null) ? parts : null;
}
// the counts written in the shape of a cell ("46 (747)" with 46 and 750 is "46 (750)")
const shaped = (text, nums) => { let i = 0; return clean(text).replace(/\d[\d,]*/g, () => String(nums[i++] ?? '?')); };

/** The flow's counts by what a text calls them, each the values it may be given as (an arm's box, the arms together, the review's count). */
export function flowFacts(P = {}, c = {}) {
  const add = (...xs) => { const v = xs.map(num).filter(x => x != null); return v.length ? v.reduce((a, b) => a + b, 0) : null; };
  const other = add(P.citations_results, P.website_results, P.organisation_results, P.other_sources_results);
  const uniq = xs => [...new Set(xs.filter(x => x != null && x > 0))];
  return {
    // a text names the arms too ("25,237 database records, 1,984 registry records, 12,845 citation-search records")
    identified: uniq([add(P.database_results, P.register_results), add(P.database_results, P.register_results, other), num(c.records), add(c.records, c.merged),
      num(P.database_results), num(P.register_results), num(P.citations_results), num(P.website_results), num(P.organisation_results), num(P.other_sources_results), other]),
    screened: uniq([num(P.records_screened), num(c.ta?.records)]),
    fullText: uniq([num(P.dbr_assessed), add(P.dbr_assessed, P.other_assessed), num(c.ft?.records), num(c.ft?.decided)]),
    studies: uniq([num(P.new_studies), num(P.total_studies), num(c.studies)]),
    reports: uniq([num(P.new_reports), num(P.total_reports), num(c.included)]),
  };
}
/** The certainty record's rows as a summary of findings is checked against them: [{ name, certainty, studies, participants }]. */
export function gradeFacts(rows = [], certaintyOf = null) {
  return (rows || []).filter(o => o && typeof o === 'object' && o.name).map(o => {
    const c = certaintyOf ? certaintyOf(o) : null;
    return { name: String(o.name), certainty: c?.rated ? c.final : null, studies: num(o.studies), participants: num(o.participants) };
  });
}

// ---- run: an unmatched number among numbers of one run output --------------------------------------------------------------------
function runNeighbours(rows, run) {
  if (!run?.outputs?.length) return [];
  const byId = new Map(run.outputs.map(o => [o.id, o])), groups = new Map(), out = [];
  for (const r of rows) {
    const p = r.place;
    if (!p) continue;
    const key = p.cell ? `${p.file}:${p.block}:${p.cell.row}:${p.cell.col}` : `${p.file}:${p.block}:${p.sentence}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  }
  // An estimate stands with estimates: the number and its two neighbours carry the same decimals (counts, a df or a threshold beside an
  // estimate are other quantities), and the output prints a number near it (within a quarter, or two units of its last decimal), which
  // it is then most likely a copy of from before the data changed. The sham review's text: "-0.20" beside "-1.00 to 1.46" is GRADE's
  // threshold, 0.24 from the nearest number of that output, and in an eTable's cell "both 0 and -0.20" stands 30 characters and more
  // from the estimate: neither is a finding.
  for (const g of groups.values()) {
    const lost = g.filter(r => r.status === 'unmatched' && dec(r.number) > 0);
    if (!lost.length) continue;
    const said = new Set();
    for (const r of lost) {
      const tally = new Map();
      for (const x of g) if (x.status !== 'unmatched' && dec(x.number) === dec(r.number)) for (const id of x.source?.outputs || []) tally.set(id, [...(tally.get(id) || []), x]);
      // an estimate's bounds are printed beside it: the nearest neighbour within 30 characters ("0.23 (95% CI 0.04 to 0.44)")
      for (const [id, rs] of tally) if (!rs.some(x => Math.abs(x.place.at - r.place.at) <= 30)) tally.delete(id);
      let best = null;
      for (const [id, rs] of tally) {
        const nums = [...new Set(rs.map(x => x.number))];
        if (nums.length >= 2 && byId.has(id) && (!best || nums.length > best.nums.length)) best = { id, rows: rs, nums };
      }
      if (!best) continue;
      const o = byId.get(best.id), seen = new Set(best.nums), d = dec(r.number), x0 = Number(r.number);
      const near = (o.nums || []).filter(x => !seen.has(x) && dec(x) === d && Number.isFinite(Number(x))).sort((a, b) => Math.abs(a - x0) - Math.abs(b - x0))[0];
      if (near == null || near === r.number || Math.abs(near - x0) > Math.max(0.25 * Math.max(Math.abs(x0), Math.abs(near)), 2 * 10 ** -d) + 1e-9) continue;
      const name = `${o.title || o.id}${o.level ? `, ${o.level}` : ''}`, text = `${r.number} stands with ${best.nums[0]} and ${best.nums[1]} of ${name}, which prints ${near}.`;
      if (said.has(text)) continue;
      said.add(text);
      out.push({ kind: 'run', rows: [r.n, ...best.rows.map(x => x.n)], place: r.place, text });
    }
  }
  return out;
}

// ---- tables: totals and the summary of findings ----------------------------------------------------------------------------------
const TOTAL = /^(?:total|overall|all)\b/i;
const COUNT_HEAD = /\b(?:n|no|number|trials?|studies|study|participants|patients|subjects|records|reports|events|k|randomi[sz]ed|count)\b/i;
const NOT_COUNT = /\b(?:median|mean|sd|iqr|age|df)\b|%/i;
const isCount = h => COUNT_HEAD.test(clean(h)) && !NOT_COUNT.test(clean(h));
const STUDY_HEAD = /\b(?:trials?|studies|study|RCTs?|reports?|k)\b/i, PEOPLE_HEAD = /\b(?:participants|patients|subjects|people|n)\b/i;
// a table by its caption ("Table 2, "), or nothing when it has none
const where = u => (/^e?(?:Table|Figure)\s/.test(u.part || '') ? `${u.part}, ` : '');

function totals(u, f, rowsAt) {
  const g = u.grid;
  if (!g || g.length < 4) return [];
  const head = g[0] || [], at = g.map((r, i) => (i > 0 && TOTAL.test(clean(r[0])) ? i : -1)).filter(i => i > 0);
  // one total row: a table with two (All, and All at low risk of bias) does not partition one way
  if (at.length !== 1) return [];
  // a merged header cell leaves the header shorter than the rows: its columns are not known, so the table is not read
  if (g.some(r => r.length !== head.length)) return [];
  const T = at[0], body = g.map((_, i) => i).filter(i => i > 0 && i !== T), cols = [];
  for (let c = 1; c < head.length; c++) {
    if (!isCount(head[c])) continue;
    const tot = cellCounts(g[T][c]), parts = body.map(r => cellCounts(g[r]?.[c]));
    if (!tot || parts.some(p => !p || p.length !== tot.length)) continue;
    const sums = tot.map((_, k) => parts.reduce((s, p) => s + p[k], 0));
    cols.push({ c, tot, sums, ok: sums.every((x, k) => x === tot[k]) });
  }
  // the rows partition the total when another count column adds up; a column that then does not is a finding
  if (!cols.some(x => x.ok)) return [];
  // a study can stand in two rows (two arms, two classes) while each participant stands in one: a count of studies that adds up to more
  // than its total is that, not a slip
  const overlap = x => STUDY_HEAD.test(clean(head[x.c])) && x.sums.every((v, k) => v >= x.tot[k]);
  return cols.filter(x => !x.ok && !overlap(x)).map(x => ({ kind: 'total', rows: rowsAt(f, u.i, T, x.c), place: { file: f, block: u.i, part: u.part, cell: { row: T, col: x.c } },
    text: `${where(u)}${clean(g[T][0])}, ${clean(head[x.c])}: ${clean(g[T][x.c])}; the other rows add up to ${shaped(g[T][x.c], x.sums)}.` }));
}

const CERTAINTY_HEAD = /certainty|quality of (?:the )?evidence|\bGRADE\b/i;
const LEVELS = ['Very low', 'Low', 'Moderate', 'High'];
// the level a cell gives: its first level word ("Low (downgraded: high risk of bias)" is Low), else its ⊕ marks
const levelOf = t => {
  const s = clean(t), m = /\b(very\s+low|high|moderate|low)\b/i.exec(s);
  if (m) return /^very/i.test(m[1]) ? 'Very low' : m[1].charAt(0).toUpperCase() + m[1].slice(1).toLowerCase();
  const plus = (s.match(/⊕/g) || []).length;
  return plus ? LEVELS[Math.min(plus, 4) - 1] : null;
};
const words = t => clean(t).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
function outcomeFor(label, grade) {
  const l = words(label);
  if (!l) return null;
  const exact = grade.filter(o => words(o.name) === l);
  if (exact.length) return exact.length === 1 ? exact[0] : null;
  // "Pain" beside "Pain at 6 months" and "Pain at 12 months" names neither: a row is read only when one outcome is meant
  const near = grade.filter(o => { const n = words(o.name); return n && (l.includes(n) || n.includes(l)); });
  return near.length === 1 ? near[0] : null;
}
function summaryOfFindings(u, f, grade, rowsAt) {
  const g = u.grid;
  if (!g || g.length < 2 || !grade?.length) return [];
  const head = g[0] || [], cc = head.findIndex((h, i) => i > 0 && CERTAINTY_HEAD.test(clean(h)));
  if (cc < 1) return [];
  const kc = head.findIndex((h, i) => i > 0 && i !== cc && (STUDY_HEAD.test(clean(h)) || PEOPLE_HEAD.test(clean(h))) && !/\bCI\b|%|effect|estimate/i.test(clean(h)));
  // what the column's counts are, in the header's order: "Trials (n)" studies then participants, "No of participants (studies)" the other way
  const kh = kc > 0 ? clean(head[kc]) : '', ks = kh.search(STUDY_HEAD), kp = kh.search(PEOPLE_HEAD);
  const order = ks < 0 ? ['participants'] : kp < 0 ? ['studies'] : ks < kp ? ['studies', 'participants'] : ['participants', 'studies'];
  const out = [];
  for (let r = 1; r < g.length; r++) {
    const label = clean(g[r][0]), o = outcomeFor(label, grade);
    if (!o) continue;
    const place = { file: f, block: u.i, part: u.part, cell: { row: r, col: cc } }, lv = levelOf(g[r][cc]);
    const rows = kc > 0 ? rowsAt(f, u.i, r, kc) : rowsAt(f, u.i, r, null);
    if (lv && o.certainty && lv !== o.certainty) out.push({ kind: 'grade', rows, place, text: `${where(u)}${label}: certainty ${lv}; the certainty record rates it ${o.certainty}.` });
    const k = kc > 0 ? cellCounts(g[r][kc]) : null;
    if (k && k.length <= order.length && k.some((x, i) => o[order[i]] != null && x !== o[order[i]])) {
      out.push({ kind: 'grade', rows, place: { ...place, cell: { row: r, col: kc } },
        text: `${where(u)}${label}: ${clean(head[kc])} ${clean(g[r][kc])}; the certainty record has ${shaped(g[r][kc], k.map((x, i) => o[order[i]] ?? x))}.` });
    }
  }
  return out;
}

// ---- text: percentages and the flow ---------------------------------------------------------------------------------------------
const FRACTION = [
  [/(\d[\d,]*)\s*(?:\/|of)\s*(\d[\d,]*)\s*\(\s*(\d+(?:\.\d+)?)\s*%\s*\)/g, m => [m[1], m[2], m[3]]],   // n/N (x%), n of N (x%)
  [/(\d+(?:\.\d+)?)\s*%\s*\(\s*(\d[\d,]*)\s*(?:\/|of)\s*(\d[\d,]*)\s*\)/g, m => [m[2], m[3], m[1]]],   // x% (n/N)
];
function percents(u, f, rowsIn) {
  const out = [];
  for (const [re, parts] of FRACTION) for (const m of u.t.matchAll(re)) {
    const [a, b, x] = parts(m), n = intOf(a), N = intOf(b), pct = Number(x);
    if (n == null || !N || n > N) continue;
    const want = (100 * n) / N, d = dec(x);
    if (Math.abs(pct - want) <= 0.5 * 10 ** -d + 1e-9) continue;
    out.push({ kind: 'percent', rows: rowsIn(f, u.i, m.index, m.index + m[0].length), place: { file: f, block: u.i, part: u.part, at: m.index, len: m[0].length },
      text: `${clean(m[0])}: ${n} of ${N} is ${want.toFixed(d)}%.` });
  }
  return out;
}

// what a number counts in the flow, by the words after it (and before it): the box, its words, the patterns
const FLOW = [
  // "4493 records found" is a search strategy's count of one database (a supplement's eMethods), not a box: "found" is not read
  ['identified', 'records identified', [/^\s*(?:(?:unique|deduplicated)\s+)?records?\s+(?:were\s+)?identified\b/i, /^\s*(?:were\s+)?identified\b/i], [/\b(?:searches|search)\s+(?:identified|returned|yielded)\s+$/i]],
  ['screened', 'records screened', [/^\s*(?:(?:unique|deduplicated|database|databases|and|registry|register|registers)\s+){0,4}(?:records?|titles?(?:\s+and\s+abstracts?)?)\s+(?:were\s+)?screened\b/i, /^\s*screened\s+records?\b/i], [/\bwe\s+screened\s+$/i]],
  ['fullText', 'reports assessed in full text', [/^\s*full[- ]text\s+(?:reports?|articles?|records?|papers?)\b/i, /^\s*(?:reports?|articles?|records?|papers?)\s+(?:were\s+)?(?:assessed|reviewed|read)\s+(?:in|at|as)\s+full[- ]?text\b/i], []],
  ['studies', 'studies included', [/^\s*(?:randomi[sz]ed\s+)?(?:trials|studies|RCTs)\s+were\s+included\b/i, /^\s*included\s+(?:trials|studies|RCTs)\b/i], []],
  ['reports', 'reports included', [/^\s*reports?\s+(?:of\s+\d[\d,]*\s+(?:trials|studies)\s+)?were\s+included\b/i], []],
];
// what follows a box's words and makes it a subset or a method, not the box: "were included in the primary analysis", "were screened by
// a single reviewer", "studies included patients with"
const NOT_BOX = /^\s*(?:by\b|in\s+duplicate|independently|twice|again|in\s+(?:the|a|an|each)\s+(?!(?:systematic\s+)?review\b)|in\s+(?:primary|meta|pooled|sensitivity|subgroup)|for\s+(?:the\s+)?(?:primary|meta|pooled|analysis))/i;
function flowNumbers(rows, unitAt, flow) {
  const out = [];
  if (!flow) return out;
  for (const r of rows) {
    const p = r.place, n = intOf(r.number);
    if (!p || p.cell || n == null) continue;
    const t = unitAt(p.file, p.block)?.t || '';
    if (!t) continue;
    const after = t.slice(p.at + p.len, p.at + p.len + 60), before = t.slice(Math.max(0, p.at - 30), p.at);
    const hit = FLOW.find(([, , a, b]) => a.some(re => { const m = re.exec(after); return m && !NOT_BOX.test(after.slice(m.index + m[0].length)); }) || b.some(re => re.test(before)));
    const want = hit && flow[hit[0]];
    if (!want?.length || want.includes(n)) continue;
    out.push({ kind: 'prisma', rows: [r.n], place: p, text: `${r.number} ${hit[1]} in the text; the flow in Lykos has ${want.slice(0, 3).join(' or ')}.` });
  }
  return out;
}

/**
 * The cross-checks of a built check: `rows` its rows (with place and status), `units` per file the checked units (checkedUnits(blocks), a
 * table's with `grid`), `run` the recorded run, `flow` flowFacts(...), `grade` gradeFacts(...). [{ kind, rows, text, place }] in the order
 * of the files.
 */
export function crossChecks({ rows = [], units = [], run = null, flow = null, grade = null } = {}) {
  const at = new Map();
  units.forEach((us, f) => { for (const u of us || []) at.set(`${f}:${u.i}`, u); });
  const unitAt = (f, i) => at.get(`${f}:${i}`) || null;
  const placed = rows.filter(r => r.place);
  const rowsAt = (f, block, row, col) => placed.filter(r => r.place.file === f && r.place.block === block && r.place.cell?.row === row && (col == null || r.place.cell.col === col)).map(r => r.n);
  const rowsIn = (f, block, a, z) => placed.filter(r => r.place.file === f && r.place.block === block && r.place.at >= a && r.place.at < z).map(r => r.n);
  const out = [...runNeighbours(rows, run), ...flowNumbers(placed, unitAt, flow)];
  units.forEach((us, f) => {
    for (const u of us || []) {
      if (u.grid) out.push(...totals(u, f, rowsAt), ...summaryOfFindings(u, f, grade, rowsAt));
      out.push(...percents(u, f, rowsIn));
    }
  });
  const key = x => [x.place?.file ?? 0, x.place?.block ?? 0, x.place?.cell?.row ?? 0, x.place?.at ?? x.place?.cell?.col ?? 0];
  return out.sort((a, b) => { const p = key(a), q = key(b); for (let i = 0; i < p.length; i++) if (p[i] !== q[i]) return p[i] - q[i]; return 0; });
}

/** "2 cross-checks disagree: …" for a check, or '' when it has none (or was built before cross-checks: `cross` absent). */
export function crossText(check, { max = 3 } = {}) {
  const c = check?.cross || [];
  if (!c.length) return '';
  return `${c.length === 1 ? '1 cross-check disagrees' : `${c.length} cross-checks disagree`}: ${c.slice(0, max).map(x => x.text).join(' | ')}${c.length > max ? ` | and ${c.length - max} more` : ''}`;
}
