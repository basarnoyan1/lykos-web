// The author list as the views and the registration use it (plan W9a). state.paper.authors is the one list; its record and the
// migration the store runs on load are lib/declarations.mjs (normalizeAuthors). This module loads on first use: Protocol › Research
// team, the Manuscript, the registered Word manuscript's check and tools/lykos-register.mjs.
//
// A placeholder (`{ name: '[Further authors]', placeholder: true }`) prints as its text, in its place; it is never a person (no
// initials, ORCID, email, affiliation, corresponding-author or declaration checks).
import { lib_declarations$isPlaceholder as isPlaceholder, lib_declarations$printable as printable, lib_declarations$people as people, lib_declarations$affiliationsOf as affiliationsOf, lib_declarations$newAuthorId as newAuthorId, lib_declarations$titlePage as titlePage } from "../boot.mjs";
export { isPlaceholder, printable, people, affiliationsOf };

const clean = s => String(s ?? '').trim();
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const nameOf = a => clean(typeof a === 'string' ? a : a?.name);

/** The byline: names and placeholder text in list order. */
export const bylineNames = authors => printable(authors).map(nameOf);

/** `[Further authors]` for a new placeholder; a placeholder's text stays bracketed. */
export const bracketed = text => { const t = clean(text).replace(/^\[+|\]+$/g, '').trim(); return t ? `[${t}]` : ''; };

/** Counts for the panel status, e.g. "2 authors, 2 placeholders". */
export function teamSummary(authors) {
  const list = authors || [], ph = list.filter(isPlaceholder).length, n = list.length - ph;
  return ph ? `${plural(n, 'author')}, ${plural(ph, 'placeholder')}` : plural(n, 'author');
}

/** The list with author `idx` the one corresponding author (none when `on` is false). */
export const withCorresponding = (authors, idx, on) => authors.map((a, j) => { const { corresponding, ...x } = a; return j === idx && on ? { ...x, corresponding: true } : x; });
/** The list with author `idx` marked senior or not. */
export const withSenior = (authors, idx, on) => authors.map((a, j) => { if (j !== idx) return a; const { senior, ...x } = a; return on ? { ...x, senior: true } : x; });
/** A form field's value as the record keeps it: affiliations, one a line, become a list. */
export const fieldValue = (k, value) => (k === 'affiliations' ? String(value ?? '').split('\n').map(x => x.trim()).filter(Boolean) : value);

/** The declarations with what is kept under an author's name moved to the new name (ICMJE criteria, competing interests and CRediT roles
 *  from before W9a); a name another author already holds is left alone. Never mutates. */
export function renamedDeclarations(decl, from, to) {
  if (!decl || !from || !to || from === to) return decl;
  const move = obj => (obj && obj[from] !== undefined && obj[to] === undefined ? Object.fromEntries(Object.entries(obj).map(([k, v]) => [k === from ? to : k, v])) : obj);
  const taken = (decl.conflicts || []).some(c => c?.author === to);
  return { ...decl, icmje: move(decl.icmje), contributions: move(decl.contributions),
    conflicts: taken ? decl.conflicts : (decl.conflicts || []).map(c => (c?.author === from ? { ...c, author: to } : c)) };
}

export const newAuthor = () => ({ id: newAuthorId(), name: '', degrees: '', affiliations: [], roles: [] });
export const newPlaceholder = text => ({ id: newAuthorId(), name: bracketed(text), placeholder: true });

// ---- the app's own manuscript: a title page generated from the list ------------------------------------------------------------

export const TITLE_GEN = 'title-page';

/** The byline (degrees, affiliation numbers, symbols), the numbered affiliations, the notes and the correspondence, as manuscript
 *  blocks marked `gen: 'title-page'`; the manuscript keeps its own title above them. */
export function titlePageBlocks(paper = {}) {
  return titlePage({ paper }).blocks.slice(1).map(b => ({ ...b, gen: TITLE_GEN }));
}

/**
 * The blocks with the title page put back from the list: in place of the generated blocks, else of the blocks the structure reads as
 * authors and affiliations (`roles`, lib/manuscript-structure.mjs blockRoles), else after the title. A replaced block's id is kept, so
 * comments on it stay. null when the page already matches the list.
 */
export function syncTitlePage(blocks = [], paper = {}, roles = null) {
  const fresh = titlePageBlocks(paper);
  let at = blocks.flatMap((b, i) => (b.gen === TITLE_GEN ? [i] : []));
  if (!at.length && roles) at = roles.flatMap((r, i) => (r === 'authors' || r === 'affiliations' ? [i] : []));
  const start = at.length ? at[0] : Math.min(1, blocks.length), end = at.length ? at.at(-1) + 1 : start;
  const old = blocks.slice(start, end);
  if (old.length === fresh.length && old.every((b, i) => b.gen === TITLE_GEN && b.type === fresh[i].type && b.text === fresh[i].text
    && JSON.stringify(b.runs || null) === JSON.stringify(fresh[i].runs || null))) return null;
  fresh.forEach((b, i) => { if (old[i]?.id) b.id = old[i].id; });
  return [...blocks.slice(0, start), ...fresh, ...blocks.slice(end)];
}

/** Whether a generated title page no longer matches the list (a manuscript with none is not stale). */
export const titlePageStale = (blocks = [], paper = {}) => blocks.some(b => b.gen === TITLE_GEN) && !!syncTitlePage(blocks, paper);

// ---- a Word file's title page, read and checked against the list -----------------------------------------------------------------

const SUP = '⁰¹²³⁴⁵⁶⁷⁸⁹';
const SUP_RUN = new RegExp(`[${SUP}]+(?:[,˒][${SUP}]+)*`, 'g');
// A superscript (a superscript run, or Unicode superscript digits) as \u0001…\u0002.
function marked(b) {
  const runs = Array.isArray(b?.runs) && b.runs.length ? b.runs : [{ t: b?.text || '' }];
  return runs.map(r => (r.sup && clean(r.t) ? `\u0001${r.t}\u0002` : String(r.t ?? ''))).join('')
    .replace(SUP_RUN, m => `\u0001${[...m].map(c => (SUP.includes(c) ? SUP.indexOf(c) : c === '˒' ? ',' : c)).join('')}\u0002`)
    .replace(/\u0002\u0001/g, '');
}
// "MD", "PhD", "MBBS", "FRCS(SN)", "[degree]": a word with two capitals and no space, or a blank that names a degree.
const isDegree = p => /^\[\s*(degrees?|qualifications?|credentials?)\s*\]$/i.test(p) || (!/\s/.test(p) && /^[A-Z][A-Za-z.()]{1,11}$/.test(p) && (p.match(/[A-Z]/g) || []).length >= 2);
// split on commas and on "and" outside brackets; a part after "and" starts an author
function parts(text) {
  const out = []; let depth = 0, cur = '';
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '[' || c === '(') depth++;
    if ((c === ']' || c === ')') && depth) depth--;
    const and = !depth && /^\s(and|&)\s/i.exec(text.slice(i, i + 6));
    if (!depth && (c === ',' || c === ';')) { out.push(cur); cur = ''; continue; }
    if (and) { out.push(cur); cur = '\u0003'; i += and[0].length - 2; continue; }
    cur += c;
  }
  out.push(cur);
  return out.map(p => ({ and: /^\u0003|^\s*(and|&)\s/i.test(p), p: p.replace(/^\u0003/, '').replace(/^\s*(and|&)\s+/i, '').trim() })).filter(x => x.p);
}
const numbersOf = sup => clean(sup).split(/\s*,\s*/).flatMap(x => { const r = /^(\d+)\s*[–-]\s*(\d+)$/.exec(x); return r ? Array.from({ length: Math.max(0, r[2] - r[1] + 1) }, (_, k) => Number(r[1]) + k) : (x.match(/\d+/g) || []).map(Number); });

/** The byline's authors: [{ name, degrees[], numbers[], marks, placeholder }]; the superscript after an author is theirs. */
export function bylineEntries(text) {
  const out = [], re = /([^\u0001]*)\u0001([^\u0002]*)\u0002/g;
  let m, last = 0;
  const segments = [];
  while ((m = re.exec(text))) { segments.push({ text: m[1], sup: m[2] }); last = re.lastIndex; }
  if (clean(text.slice(last))) segments.push({ text: text.slice(last), sup: '' });
  for (const seg of segments) {
    const entries = [];
    for (const { p, and } of parts(seg.text)) {
      if (entries.length && !and && isDegree(p)) entries.at(-1).degrees.push(p);
      else entries.push({ name: p, degrees: [], numbers: [], marks: '', placeholder: /^\[.*\]$/.test(p) });
    }
    if (!entries.length) { if (out.length) out.at(-1).numbers.push(...numbersOf(seg.sup)); continue; }
    entries.at(-1).numbers = numbersOf(seg.sup);
    entries.at(-1).marks = seg.sup.replace(/[\d\s,–-]/g, '');
    out.push(...entries);
  }
  return out;
}

const LABEL = /^\s*[A-Z][A-Za-z ]{2,40}:/;
function affiliationLine(b) {
  const s = marked(b).trim();
  const m = /^\u0001([^\u0002]+)\u0002\s*(.+)$/.exec(s) || /^(\d{1,2})[.)]?\s+(\D.*)$/.exec(s);
  return m && /\d/.test(m[1]) ? { n: Number(m[1].replace(/\D.*$/, '')), text: clean(m[2]) } : null;
}

/** What a Word file's title page says of its authors, from lib/docx.mjs parseDocx blocks: { byline: bylineEntries, affiliations:
 *  [{ n, text }], correspondence }. The byline is the first paragraph after the title that is not a labelled line ("Running head:");
 *  null when there is none before the abstract. */
export function wordTitlePage(blocks = []) {
  const end = blocks.findIndex(b => /^abstract\b/i.test(clean(b.text)));
  const front = blocks.slice(0, end > 0 ? end : Math.min(blocks.length, 30));
  const first = front.findIndex(b => clean(b.text));
  let byline = null, correspondence = '';
  const affiliations = [];
  for (const b of front.slice(first + 1)) {
    const t = clean(b.text);
    if (!t) continue;
    const corr = /^(?:correspondence(?: to)?|corresponding author|address correspondence to)\s*:\s*(.*)$/i.exec(t);
    if (corr) { correspondence = clean(corr[1]); continue; }
    const aff = affiliationLine(b);
    if (aff) { if (byline) affiliations.push(aff); continue; }
    if (!byline && !LABEL.test(t)) byline = b;
  }
  return byline ? { byline: bylineEntries(marked(byline)), affiliations, correspondence } : null;
}

const fold = s => clean(s).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ı/g, 'i').toLowerCase().replace(/[.’'`]/g, '').replace(/\s+/g, ' ');
// a [bracketed] blank says nothing: "[Department], Koç University" is compared as "Koç University"
const foldText = s => fold(String(s ?? '').replace(/\[[^\]]*\]/g, ' ')).replace(/\s*([,;])\s*/g, '$1').replace(/([,;])+/g, '$1').replace(/^[\s,;]+|[\s,;]+$/g, '');
const degreeKey = s => foldText(Array.isArray(s) ? s.join(', ') : s).split(/[,\s]+/).filter(Boolean).join(',');
const listOf = xs => xs.map(x => `“${clean(x)}”`).join(' and ');

/**
 * Every difference between a Word title page (wordTitlePage) and the author list: [{ kind, text, author? }], kind one of byline,
 * missing, extra, order, degrees, affiliations, placeholders, corresponding. A [bracketed] blank in the Word file counts as nothing.
 */
export function authorMismatches(word, authors = []) {
  const out = [], push = (kind, text, author) => out.push({ kind, text, ...(author ? { author } : {}) });
  if (!word?.byline?.length) return [{ kind: 'byline', text: 'The Word file has no author line before the abstract' }];
  const listed = printable(authors), persons = listed.filter(a => !isPlaceholder(a)), real = word.byline.filter(e => !e.placeholder);
  const affText = new Map((word.affiliations || []).map(a => [a.n, a.text]));
  const matched = [];
  for (const a of persons) {
    const name = nameOf(a), e = real.find(x => fold(x.name) === fold(name));
    if (!e) { push('missing', `${name} is in the author list but not on the Word title page`, name); continue; }
    matched.push([a, e]);
    if (degreeKey(a.degrees) !== degreeKey(e.degrees)) push('degrees', `${name}: the list has ${clean(a.degrees) || 'no degrees'}; the Word file has ${e.degrees.join(', ') || 'none'}`, name);
    const mine = affiliationsOf(a), theirs = e.numbers.map(n => affText.get(n) ?? `[no affiliation ${n}]`);
    if (mine.map(foldText).sort().join('|') !== theirs.map(foldText).sort().join('|'))
      push('affiliations', `${name}: the list has ${listOf(mine) || 'no affiliation'}; the Word file has ${listOf(theirs) || 'none'}`, name);
  }
  for (const e of real) if (!persons.some(a => fold(nameOf(a)) === fold(e.name))) push('extra', `${e.name} is on the Word title page but not in the author list`, e.name);
  const inList = matched.map(([a]) => fold(nameOf(a))), inWord = real.map(e => fold(e.name)).filter(n => inList.includes(n));
  if (inList.join('|') !== inWord.join('|')) push('order', `The order differs: the list has ${matched.map(([a]) => nameOf(a)).join(', ')}; the Word file has ${inWord.map(n => matched.find(([a]) => fold(nameOf(a)) === n)[1].name).join(', ')}`);
  const lp = listed.filter(isPlaceholder).length, wp = word.byline.length - real.length;
  if (lp !== wp) push('placeholders', `The list has ${plural(lp, 'placeholder')}; the Word title page has ${plural(wp, 'bracketed author')}`);
  const c = persons.find(a => a.corresponding), wc = clean(word.correspondence);
  if (c && !fold(wc).startsWith(fold(nameOf(c)))) push('corresponding', `The corresponding author is ${nameOf(c)} in the list; the Word file has ${wc ? `“${wc.slice(0, 80)}”` : 'no correspondence line'}`, nameOf(c));
  else if (!c && persons.length) push('corresponding', 'The author list marks no corresponding author');
  return out;
}
