// The numbers a table's title states about its studies ("Non-fusion dynamic stabilization (n = 35)", "Characteristics and outcomes of the
// 48 included studies"), checked against the studies the table holds (plan §2, "Tables and figures: a title's count"). A title written for an
// earlier set of studies is flagged on the table's page with its correction; the app corrects the package's title, never a printed file.

const STUDIES = /\b(\d[\d,]*)\s+(?:included\s+|eligible\s+|primary\s+)?(?:studies|articles|reports|trials|papers|sources(?: of evidence)?)\b/gi;
const N_EQUALS = /\(\s*n\s*=\s*(\d[\d,]*)\s*\)/gi;

/** The counts a title states: `[{ n, at, len }]`, `at` the number's place in the title. An "(n = …)" far above the studies counts patients. */
export function titleCounts(title, studies = null) {
  const t = String(title || ''), out = [];
  for (const re of [STUDIES, N_EQUALS]) for (const m of t.matchAll(re)) {
    const n = Number(m[1].replace(/,/g, ''));
    if (re === N_EQUALS && studies != null && n > Math.max(10, studies * 5)) continue;   // "(n = 1,411)": its patients, not its studies
    out.push({ n, at: m.index + m[0].indexOf(m[1]), len: m[1].length });
  }
  return out.sort((a, b) => a.at - b.at);
}

/**
 * A title whose count is not the table's: `{ stated, studies, fixed }` (`fixed` the title with the table's count), else null. `of` is the
 * review's included studies when the table holds a part of them, said beside the table's own count.
 */
export function staleTitle(title, studies, { of = null } = {}) {
  if (!Number.isFinite(studies)) return null;
  const wrong = titleCounts(title, studies).filter(x => x.n !== studies);
  if (!wrong.length) return null;
  let fixed = String(title);
  for (const x of wrong.slice().reverse()) fixed = `${fixed.slice(0, x.at)}${studies}${fixed.slice(x.at + x.len)}`;
  const part = of != null && of !== studies ? `, of the review's ${of} included` : '';
  return { stated: wrong[0].n, studies, fixed, text: `The title says ${wrong[0].n} ${wrong[0].n === 1 ? 'study' : 'studies'}; the table holds ${studies}${part}` };
}
