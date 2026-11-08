// Which saved output draws a printed table or figure (Tables and figures, 3 Nov 2026: "why still many of them are file only???"). A printed
// item of the paper (a caption's "Figure 5", a file's "Figure S1") is File only until the app can draw it; when the project holds an output
// (lib/output-spec.mjs) that is that item, the output is its drawing. Pure: item facts and output facts in, matches out.
//
// An output is named by (strongest first)
//   place   where the build put it in the manuscript (the map build/lykos-outputs.json: id -> { place: "eFigure 5" }), or the label its title
//           begins with ("eFigure 6. Leave-one-trial-out …"); the supplement's style is kept ("eFigure 5", "Figure S5" and "Supplementary
//           Figure 5" are one place; the main text's "Figure 5" is another, never merged with them);
//   id      the label its id begins with ("figureS1-funnel" is "Figure S1"), for an output the build has not placed;
//   title   the words of an item's title all found in the output's title ("Funnel" in "Funnel plot of the sham SMCR").
// An item and an output are of one kind (a table or a figure). Several outputs may name one item (two outputs placed
// at one number): the one whose title is closest wins, and an output draws one item at a time.

const LEAD = /^\s*(supplementary\s+|e)?(table|fig(?:ure)?\.?)\s*(s?)(\d+)/i;
/**
 * The label of a caption, keeping the document's own supplement style: "eFigure 3" and "Supplementary Figure 3" stay what they are, "Figure S3"
 * has its S, and a main-text "Figure 3" is another item from all of them (the Sham review's main Figure 3 and its supplement's eFigure 3).
 */
export function labelOf(kind, n, { prefix = '', style = '' } = {}) {
  const word = kind === 'table' ? 'Table' : 'Figure';
  if (!prefix && style === 'e') return `e${word} ${n}`;
  if (!prefix && style === 'supplementary') return `Supplementary ${word} ${n}`;
  return `${word} ${prefix}${n}`;
}
const PARTS = /^(?:(e)|supplementary\s+)?(table|figure)\s+(s?)(\d+)$/i;
/** `{ kind, supp, n }` of a label this module made ("eTable 2", "Figure S1", "Table 3"); null for any other text. */
export function labelParts(label) {
  const m = PARTS.exec(String(label || '').trim());
  if (!m) return null;
  const full = /^supplementary/i.test(String(label).trim());
  return { kind: /^t/i.test(m[2]) ? 'table' : 'figure', supp: !!(m[1] || m[3] || full), n: Number(m[4]) };
}
/** The label's identity across supplement styles: "eFigure 3", "Supplementary Figure 3" and "Figure S3" are one place, "Figure 3" another. */
export function labelKey(label) {
  const p = labelParts(label);
  return p ? `${p.kind} ${p.supp ? 'S' : ''}${p.n}` : String(label || '');
}
/** "Figure 5" from "Figure 5. Sham SMCR …", "eFigure 5" from "eFigure 5. …", "Table S1" from "Supplementary Table S1", "" when the text begins with no label. */
export function placeLabel(text) {
  const m = LEAD.exec(String(text || ''));
  return m ? labelOf(/^t/i.test(m[2]) ? 'table' : 'figure', Number(m[4]), { prefix: m[3].toUpperCase(), style: m[1] ? (/^e$/i.test(m[1]) ? 'e' : 'supplementary') : '' }) : '';
}
const ID_LEAD = /^(table|fig(?:ure)?)[-_ ]?(s?)(\d+)(?![a-z0-9])/i;
/** The label an output id begins with ("figureS1-funnel" -> "Figure S1"), "" when it begins with none. */
export function idLabel(id) {
  const m = ID_LEAD.exec(String(id || ''));
  return m ? `${/^t/i.test(m[1]) ? 'Table' : 'Figure'} ${m[2].toUpperCase()}${Number(m[3])}` : '';
}
const STOP = new Set(['the', 'of', 'a', 'an', 'and', 'by', 'in', 'on', 'for', 'to', 'with', 'at', 'from', 'each', 'all', 'analysis', 'analyses']);
/** The words of a title that tell it from another: lower case, hyphens as spaces, without the label it begins with. */
export function titleWords(text) {
  return wordSet(String(text || '').replace(LEAD, '').replace(/^[\s.:–-]+/, ''));
}
/** The telling words of any text (a file name, an id, a title): lower case, hyphens and underscores as spaces, stop words dropped. */
export function wordSet(text) {
  const t = String(text || '').toLowerCase().replace(/[-–/_]/g, ' ');
  return new Set((t.match(/[a-z0-9]+/g) || []).filter(w => w.length > 1 && !STOP.has(w)));
}
const jaccard = (a, b) => { let n = 0; for (const w of a) if (b.has(w)) n++; return a.size + b.size - n ? n / (a.size + b.size - n) : 0; };
const within = (a, b) => a.size > 0 && [...a].every(w => b.has(w));

/**
 * What the matching needs of a saved output: `{ id, kind: 'table' | 'figure', title, place, strong: [labels], weak: [labels], words }`.
 * `place` is the build map's place for it (a string) or ''.
 */
export function outputFacts(o, spec, place = '') {
  const strong = [placeLabel(place), placeLabel(spec?.title)].filter(Boolean);
  // an id's number is the output's name, not its place: once the build says where an output is, the id never places it elsewhere
  // (figure3-subgroups is the supplement's eFigure 5, not the main text's Figure 3)
  const own = idLabel(o.id), weak = own && !strong.length ? [own] : [];
  return { id: o.id, kind: spec?.kind === 'chart' ? 'figure' : 'table', title: String(spec?.title || o.id), place: String(place || ''), strong, weak, idLabel: own, words: titleWords(spec?.title) };
}

/**
 * The output that draws each item: `targets` are `{ key, label, kind, title }`, `outputs` the facts above. Answers Map(key -> { output, rule }).
 * A target with `exact` (an item only a file's name made, "Figure S2" from FigureS2_leave_one_out.png) is placed by a label of its own style only: an earlier
 * numbering's "Figure S2" is not the supplement's eFigure 2.
 * Pairs are taken best first (place, then id, then title; the closer title first); an output draws one item unless `reuse` (the prints of an
 * earlier numbering are other items of the same drawing).
 */
export function matchOutputs(targets, outputs, { reuse = false, taken = new Set() } = {}) {
  const pairs = [];
  for (const t of targets) {
    const words = titleWords(t.title);
    for (const o of outputs) {
      if (o.kind !== t.kind) continue;
      const sim = jaccard(words, o.words);
      if (t.label && o.strong.some(l => (t.exact ? l === t.label : labelKey(l) === labelKey(t.label)))) pairs.push({ t, o, rank: 0, sim });
      else if (t.label && o.weak.includes(t.label)) pairs.push({ t, o, rank: 1, sim });
      else if (within(words, o.words)) pairs.push({ t, o, rank: 2, sim });
    }
  }
  // two candidates with no word in common are not told apart by their title: the item waits for a rule that can
  const groups = new Map();
  for (const p of pairs) (groups.get(`${p.t.key}|${p.rank}`) || groups.set(`${p.t.key}|${p.rank}`, []).get(`${p.t.key}|${p.rank}`)).push(p);
  const usable = pairs.filter(p => groups.get(`${p.t.key}|${p.rank}`).length === 1 || p.sim > 0);
  usable.sort((a, b) => a.rank - b.rank || b.sim - a.sim || String(a.o.id).localeCompare(String(b.o.id)));
  const out = new Map(), used = new Set(taken);
  for (const p of usable) {
    if (out.has(p.t.key) || (!reuse && used.has(p.o.id))) continue;
    out.set(p.t.key, { output: p.o, rule: ['place', 'id', 'title'][p.rank] });
    used.add(p.o.id);
  }
  return out;
}

/** The build map's path in the project folder (build/lykos-outputs.json beside the manuscript's number check, or the registered one); '' for none. */
export function outputsMapPath(s) {
  const e = s?.externalOutputs?.manuscript, nc = e?.numberCheck?.file;
  return e?.outputsFile || (nc ? `${String(nc).slice(0, Math.max(0, String(nc).lastIndexOf('/')))}/build/lykos-outputs.json`.replace(/^\//, '') : '');
}
