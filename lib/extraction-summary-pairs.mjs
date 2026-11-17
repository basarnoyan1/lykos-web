// Two fields that classify the studies the same way (Sham, 13 Nov 2026: "Indication class" with Psychiatric 33 and "Indication (coded)" with
// Psychiatric 26, side by side and unexplained; docs/Sham_Needs_Review_2026-11.md, "The Data summary"). Pure: it reads the summary's fields
// (lib/extraction-summary.mjs summarise) and names no field, level or vocabulary.
//
// Two fields are a pair when their labels share a first word, each holds one level per study, and their levels mostly correspond: each level
// of one is matched to the level of the other that most of its studies hold, both ways. A study whose two levels are matched to each other in
// neither direction is classed differently; those are the studies a reader has to look at.

/** The share of the studies both fields classify that must fall on matched levels for the two to read as one classification. */
export const PAIR_AGREE = 0.6;

const firstWord = label => (String(label || '').match(/^\p{L}[\p{L}\d-]*/u)?.[0] || '').toLowerCase();
/** paperId -> { key, label, cell }: the one level each study holds. */
function levelOf(f) {
  const m = new Map();
  for (const l of f.levels) for (const s of l.studies) if (!m.has(s.paperId)) m.set(s.paperId, { key: l.key, label: l.label, cell: s.cell });
  return m;
}
/** A categorical field of two or more held levels whose studies each hold one of them. */
const isClassing = f => f.kind === 'categorical' && f.levels.filter(l => l.n > 0).length >= 2
  && f.levels.reduce((n, l) => n + l.n, 0) === new Set(f.levels.flatMap(l => l.studies.map(s => s.paperId))).size;
/** Each level of `A` -> the level of `B` most of its studies (among `ids`) hold; a tie goes to the level met first. */
function modal(A, B, ids) {
  const counts = new Map();
  for (const id of ids) { const a = A.get(id).key, b = B.get(id).key; if (!counts.has(a)) counts.set(a, new Map()); counts.get(a).set(b, (counts.get(a).get(b) || 0) + 1); }
  return new Map([...counts].map(([a, m]) => [a, [...m].reduce((best, x) => (x[1] > best[1] ? x : best))[0]]));
}

/**
 * The pairs among `fields` (summary fields): [{ a, b, both, agree, differ: [{ paperId, a: { label, cell }, b: { label, cell } }] }], `a` and
 * `b` the two field ids in the order given, `both` the studies both classify, `differ` the studies classed differently in the order of `a`'s
 * levels. A pair whose levels all correspond is not returned: there is nothing to look at.
 */
export function classPairs(fields, { agreeShare = PAIR_AGREE } = {}) {
  const list = (fields || []).filter(isClassing), out = [];
  for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
    const fa = list[i], fb = list[j], w = firstWord(fa.label);
    if (w.length < 3 || w !== firstWord(fb.label)) continue;
    const A = levelOf(fa), B = levelOf(fb), ids = [...A.keys()].filter(id => B.has(id));
    if (ids.length < 4) continue;
    const ab = modal(A, B, ids), ba = modal(B, A, ids);
    if (new Set(ab.values()).size < 2) continue;   // every level of one matched to a single level of the other: no correspondence
    const differ = ids.filter(id => ab.get(A.get(id).key) !== B.get(id).key && ba.get(B.get(id).key) !== A.get(id).key);
    if (!differ.length || (ids.length - differ.length) / ids.length < agreeShare) continue;
    const order = new Map(fa.levels.map((l, k) => [l.key, k]));
    differ.sort((x, y) => order.get(A.get(x).key) - order.get(A.get(y).key));
    const side = (M, id) => ({ label: M.get(id).label, cell: M.get(id).cell });
    out.push({ a: fa.id, b: fb.id, both: ids.length, agree: ids.length - differ.length, differ: differ.map(id => ({ paperId: id, a: side(A, id), b: side(B, id) })) });
  }
  return out;
}
