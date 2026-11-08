// Text an author has still to fill in a manuscript, supplement or letter: a bracketed blank or instruction ("[Department]", "[name, postal
// address, email]", "[Authors: funding source …]", "[n]"), and TBD, TODO, XXX. A bracket is a blank when it names what goes there (an author,
// a date, a DOI, an affiliation …) or asks the authors to do something (confirm, complete, insert …); a citation, an interval, a translated
// title in a reference ("[Primary generalized dystonia and …]") and a search strategy's syntax ("[tiab]", "[mh Radiosurgery]", "#3 AND #4")
// are not. 2 Nov 2026: the Sham paper's completion review found these places by reading each Word file whole.
// Pure: paragraphs in, places out (tools/lykos-completeness.mjs reads the built files; the app can read its own blocks).

const BRACKETED = /\[([^[\]]{1,160})\]/g;
const MARKER = /\b(TBD|TODO|XXX+)\b/g;
// what a blank names or asks for
const CUE = /\b(authors?|names?|date|doi|degrees?|affiliations?|department|address|e-?mail|correspondence|signature|confirm|complete|insert|add|replace|state|fill|funding|disclosures?|acknowledg\w*|contributions?|reviewers?|registration|preprint)\b/i;
// a blank that stands for a number or a word not yet known
const MARK = /^(x+|n|#|\?+)$/i;
// a database's field tag ("[Mesh]", "[tiab:~3]", "[mh ^]", "[Mesh:NoExp]"), as PubMed, Cochrane and Embase write them
const FIELD_TAG = /^(mesh|mh|majr|tiab|ti|ab|tw|pt|sh|all|all fields|au|la|dp|nm|kw|ot|rn|sb|ta|ad|jour|filter|sa|ti,ab,kw|lang|de|ft)(:noexp|:~\d+)?( \^)?$/i;

/** Whether the text inside a pair of brackets is a blank: it names what goes there or asks the authors for it. */
export function isBlank(inside) {
  const t = String(inside).trim();
  return !FIELD_TAG.test(t) && (MARK.test(t) || CUE.test(t));
}

/**
 * Whether a paragraph is a line of a search strategy ("#3 AND #4", "\"deep brain stimulation\"[tiab] OR …", "[mh Radiosurgery]"): its
 * brackets are the database's syntax and its named sets ("Smith J[Author]"), so only an instruction to the authors counts there.
 */
export const isSearchLine = p => /(^|\s)#\d+\b/.test(p) || (String(p).match(/\b(AND|OR|NOT)\b/g) || []).length >= 2 || /\[(mh|mesh|majr|tiab|ti|ab|tw|pt)\b/i.test(p);
const TO_AUTHORS = /^authors?\s*(:|to\b)/i;

/**
 * The places in `paragraphs` (strings) still to fill: [{ text, n, first, context }], one per distinct text, in order of first use; `first`
 * is the paragraph's index and `context` the words around the first one.
 */
export function placeholdersIn(paragraphs) {
  const found = new Map();
  (paragraphs || []).forEach((p, i) => {
    const t = String(p ?? '');
    const add = (text, at) => {
      const hit = found.get(text);
      if (hit) { hit.n++; return; }
      found.set(text, { text, n: 1, first: i, context: t.slice(Math.max(0, at - 40), at + text.length + 40).replace(/\s+/g, ' ').trim() });
    };
    const search = isSearchLine(t);
    for (const m of t.matchAll(BRACKETED)) if (search ? TO_AUTHORS.test(m[1].trim()) : isBlank(m[1])) add(m[0], m.index);
    for (const m of t.matchAll(MARKER)) add(m[0], m.index);
  });
  return [...found.values()];
}
