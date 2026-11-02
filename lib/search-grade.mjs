// A search strategy graded on the six PRESS 2015 domains (lib/press.mjs) by rules over its text: what a peer reviewer would check first,
// found before one reads it. No model: each rule is a pattern of the query (an unbalanced bracket, AND and OR at one level, a field tag the
// database does not have, a short truncation, one spelling of a word that has two, a heading with no text words beside it, a limit) and
// says what it found in Lykos's own words. A domain is graded as PRESS grades it: no revision, revision suggested, revision required. The
// grade is a reviewer's starting point, not the review: the PRESS form keeps the person's judgements, and Use suggestions fills only the
// domains the person left empty.
//
// PubMed tags ([tiab], [Mesh], [tiab:~2]) are read by lib/boolean.mjs as they are; a Web of Science field (TS=(…)) and a Scopus one
// (TITLE-ABS-KEY(…)) are rewritten to a bracket around their terms first, and their proximity operators (NEAR/2, W/2, PRE/2) to AND, so
// the structure is read the same way for all three.
import { parseQuery } from './boolean.mjs';
import { PRESS_DOMAINS } from './press.mjs';

export const GRADES = { ok: 'No revision', check: 'Revision suggested', revise: 'Revision required' };
const RANK = { ok: 0, check: 1, revise: 2 };
// the PRESS form's state for a grade (lib/press.mjs STATES)
export const PRESS_STATE = { ok: 'none', check: 'revise', revise: 'required' };

/** The database a search-log entry names, as one of the families the rules know. */
export function familyOf(source = '') {
  const s = String(source).toLowerCase();
  if (/pubmed|medline/.test(s) && !/ovid/.test(s)) return 'pubmed';
  if (/web of science|wos|clarivate/.test(s)) return 'wos';
  if (/scopus/.test(s)) return 'scopus';
  if (/embase/.test(s)) return 'embase';
  if (/cinahl/.test(s)) return 'cinahl';
  if (/cochrane|central/.test(s)) return 'cochrane';
  if (/ovid|psycinfo/.test(s)) return 'ovid';
  return 'other';
}
// databases with a thesaurus of their own: a search there is expected to use it beside the text words
const THESAURUS = { pubmed: 'MeSH', embase: 'Emtree', cinahl: 'CINAHL Subject Headings', cochrane: 'MeSH', ovid: 'subject headings' };

const PUBMED_TAGS = new Set(['tiab', 'ti', 'ab', 'mh', 'mesh', 'mh:noexp', 'mesh:noexp', 'majr', 'majr:noexp', 'sh', 'sh:noexp', 'pt', 'la', 'dp', 'pdat', 'edat',
  'crdt', 'mhda', 'tw', 'ot', 'nm', 'rn', 'au', '1au', 'lastau', 'fau', 'ad', 'ta', 'jour', 'sb', 'filter', 'all', 'all fields', 'text word', 'title', 'title/abstract',
  'mesh terms', 'mesh major topic', 'publication type', 'language', 'subheading', 'pa', 'ps', 'gr', 'si', 'ip', 'vi', 'pg', 'lid', 'aid', 'pmid', 'uid', 'dcom',
  'lr', 'is', 'cois', 'ir', 'jid', 'tt', 'book', 'ed', 'isbn', 'cn', 'mesh:noexp', 'subheading:noexp', 'supplementary concept', 'nm:noexp', 'pubtype', 'lang']);
const WOS_FIELDS = new Set(['TS', 'TI', 'AB', 'AK', 'KP', 'AU', 'AI', 'GP', 'ED', 'SO', 'PY', 'DO', 'LA', 'DT', 'OG', 'OO', 'SG', 'SA', 'CI', 'PS', 'CU', 'ZP',
  'FO', 'FG', 'FT', 'SU', 'WC', 'IS', 'UT', 'PMID', 'ALL', 'FPY', 'DOP', 'TMAC', 'TMSO', 'TMIC']);
const SCOPUS_FIELDS = new Set(['TITLE-ABS-KEY', 'TITLE-ABS-KEY-AUTH', 'TITLE-ABS', 'TITLE', 'ABS', 'KEY', 'AUTHKEY', 'INDEXTERMS', 'INDEX', 'ALL', 'PUBYEAR', 'LANGUAGE',
  'DOCTYPE', 'SRCTITLE', 'SRCTYPE', 'AUTH', 'AUTHOR-NAME', 'AUTHLASTNAME', 'AFFIL', 'AFFILORG', 'AFFILCOUNTRY', 'SUBJAREA', 'LIMIT-TO', 'EXCLUDE', 'DOI', 'PMID',
  'ISSN', 'PUBSTAGE', 'OA', 'CHEMNAME', 'CASREGNUMBER', 'MESH', 'EXACTKEYWORD', 'FUND-SPONSOR', 'REF', 'PUBDATETXT', 'LOAD-DATE', 'ORIG-LOAD-DATE']);

// one spelling of a word that has two: the term's spelling, the pattern of the other
const SPELLINGS = [
  [/(\w{3,})iz(ation|ations|e|ed|es|ing)\b/i, (m, a, b) => `${a}is${b}`], [/(\w{3,})is(ation|ations)\b/i, (m, a, b) => `${a}iz${b}`],
  [/\b(pediatric|orthopedic|anesthe|hematolog|anemia|edema|esophag|fetal|gynecolog|leukemia|hemorrhag|tumor|behavior|color|labor)/i, m => ({
    pediatric: 'paediatric', orthopedic: 'orthopaedic', anesthe: 'anaesthe', hematolog: 'haematolog', anemia: 'anaemia', edema: 'oedema', esophag: 'oesophag',
    fetal: 'foetal', gynecolog: 'gynaecolog', leukemia: 'leukaemia', hemorrhag: 'haemorrhag', tumor: 'tumour', behavior: 'behaviour', color: 'colour', labor: 'labour' })[m.toLowerCase()]],
  [/\b(paediatric|orthopaedic|anaesthe|haematolog|anaemia|oedema|oesophag|foetal|gynaecolog|leukaemia|haemorrhag|tumour|behaviour|colour|labour)/i, m => ({
    paediatric: 'pediatric', orthopaedic: 'orthopedic', anaesthe: 'anesthe', haematolog: 'hematolog', anaemia: 'anemia', oedema: 'edema', oesophag: 'esophag',
    foetal: 'fetal', gynaecolog: 'gynecolog', leukaemia: 'leukemia', haemorrhag: 'hemorrhag', tumour: 'tumor', behaviour: 'behavior', colour: 'color', labour: 'labor' })[m.toLowerCase()]],
];

/**
 * The query as lib/boolean.mjs reads it, for any of the three syntaxes: a Web of Science field (TS=(…)) or a Scopus one (TITLE-ABS-KEY(…))
 * becomes a bracket, its name kept for the field check; a proximity operator becomes AND and is counted. Answers { text, fields, near }.
 */
export function normalize(query, family) {
  const fields = [];
  let near = 0, text = String(query || '');
  if (family === 'wos') text = text.replace(/\b([A-Z]{2,4})\s*=\s*\(/g, (m, f) => { fields.push(f); return '('; });
  if (family === 'scopus') text = text.replace(/\b([A-Z][A-Z-]{1,24}[A-Z])\s*\(/g, (m, f) => { if (/^(AND|OR|NOT)$/.test(f)) return m; fields.push(f); return '('; });
  text = text.replace(/\s(NEAR(?:\/\d+)?|W\/\d+|PRE\/\d+|ADJ\d*|SAME)\s/gi, () => { near++; return ' AND '; });
  return { text, fields, near };
}

const leaves = n => (!n ? [] : n.term != null ? [n] : n.children.flatMap(leaves));
const isHeading = (t, family) => (family === 'pubmed' || family === 'cochrane') ? /^(mh|mesh|majr|sh)(:noexp)?$|^mesh (terms|major topic)$/i.test(t.field || '')
  : family === 'embase' ? /\/(exp|de|mj)$|:(de|exp)$/i.test(t.term) : family === 'cinahl' ? /^MH\b/.test(t.term) : family === 'ovid' ? /\/$/.test(t.term) : false;
const show = t => (t.phrase ? `"${t.term}"` : t.term);
// a limit written as a term (a date range, a language, a publication type): not a concept, so the text-word rules pass it by
const isLimit = t => /^(dp|pdat|edat|crdt|la|lang|language|pt|publication type|pubtype|sb|filter)$/i.test(t.field || '') || /^(PUBYEAR|LANGUAGE|DOCTYPE|PUBSTAGE|SRCTYPE)\b/.test(t.term) || /\b(19|20)\d\d\b/.test(t.term);

/**
 * The grade of one search: { family, domains: [{ id, name, grade, findings: [{ grade, text }] }], grade, counts }. `protocol` (the
 * project's PICO fields) lets the first domain say which part of the question has no term; without it that rule is left out.
 */
export function gradeSearch(entry, { protocol = null } = {}) {
  const family = familyOf(entry?.source), raw = String(entry?.query || '').trim();
  const found = Object.fromEntries(PRESS_DOMAINS.map(d => [d.id, []]));
  const add = (id, grade, text) => { if (!found[id].some(f => f.text === text)) found[id].push({ grade, text }); };
  if (!raw) add('syntax', 'revise', 'No search string is recorded for this search.');
  const { text, fields } = normalize(raw, family);
  const { tree, errors } = raw ? parseQuery(text) : { tree: null, errors: [] };
  const terms = leaves(tree), words = terms.filter(t => !isLimit(t));

  // 1 the question: more than one concept joined by AND, and the population and intervention of the protocol each have a term
  if (tree) {
    const hasAnd = (n => { const w = x => !!x && x.term == null && (x.op === 'AND' || x.children.some(w)); return w(n); })(tree);
    if (!hasAnd && terms.length > 1) add('question', 'check', 'Every term is joined by OR: the search is one concept. Most questions need two or more concepts joined by AND.');
    const words = terms.map(t => t.term.toLowerCase()).join(' ');
    for (const [key, label] of [['population', 'population'], ['intervention', 'intervention']]) {
      const said = String(protocol?.[key] || '').toLowerCase().match(/[a-z][a-z-]{4,}/g) || [];
      const content = said.filter(w => !STOP.has(w));
      if (content.length && !content.some(w => words.includes(w.slice(0, 5)))) add('question', 'check', `No term for the ${label} as the protocol states it ("${String(protocol[key]).slice(0, 60)}").`);
    }
  }

  // 2 operators: what the parser could not read, AND and OR at one level without brackets, NOT, proximity
  for (const e of errors) add('operators', 'revise', `The brackets or operators do not close: ${e}.`);
  const mixed = (n => { let k = 0; const w = x => { if (!x || x.term != null) return; if (x.mixed) k++; x.children.forEach(w); }; w(n); return k; })(tree);
  if (mixed) add('operators', 'revise', `AND and OR are mixed at one level without brackets (${mixed} ${mixed === 1 ? 'place' : 'places'}); each database orders them its own way.`);
  const nots = (n => { const out = []; const w = x => { if (!x || x.term != null) return; if (x.op === 'NOT') out.push(x); x.children.forEach(w); }; w(n); return out; })(tree);
  // the usual way to leave out animal-only records, NOT (animals NOT humans), is not a NOT to question
  const animalsFilter = /NOT\s*\(?\s*animals?\b[^)]*\bNOT\s+humans?\b/i.test(raw);
  const plainNots = nots.filter(x => !(animalsFilter && leaves(x).every(t => /^(animals?|humans?)$/i.test(t.term))));
  if (plainNots.length) add('operators', 'check', `NOT removes every record that mentions ${leaves(plainNots[0]).slice(0, 3).map(show).join(', ')}, relevant ones too; screen them out instead.`);
  if (family === 'pubmed') for (const t of terms) if (t.proximity != null && !t.phrase) { add('operators', 'revise', `Proximity ([${t.field}:~${t.proximity}]) on ${show(t)} needs a quoted phrase.`); break; }

  // 3 subject headings, where the database has a thesaurus
  const thesaurus = THESAURUS[family];
  const headings = terms.filter(t => isHeading(t, family));
  if (thesaurus && terms.length && !headings.length) add('headings', 'check', `No ${thesaurus} terms: records indexed under a heading but worded otherwise are missed.`);
  if (headings.some(t => /majr/i.test(t.field || ''))) add('headings', 'check', 'A heading restricted to major topic narrows the search; check it is meant.');
  const groups = (n => { const out = []; const w = x => { if (!x || x.term != null) return; if (x.op === 'OR') out.push(x); x.children.forEach(w); }; w(n); return out; })(tree);
  if (headings.length && groups.some(g => g.children.every(c => c.term != null && isHeading(c, family)))) add('headings', 'check', 'A concept searched by headings alone misses records not yet indexed; add its text words.');

  // 4 text words: a concept of one word, one spelling of a word that has two, truncation too short, PubMed terms left untagged
  if (tree?.op === 'AND') for (const c of tree.children) if (c.term != null && !isHeading(c, family) && !isLimit(c)) add('textwords', 'check', `One word for a concept (${show(c)}): add its synonyms, spellings and abbreviations.`);
  const all = ' ' + terms.map(t => t.term.toLowerCase()).join(' | ') + ' ';
  const missing = new Set();
  for (const t of words) for (const [re, other] of SPELLINGS) {
    const m = re.exec(t.term); if (!m) continue;
    const alt = other(...m).toLowerCase(), stem = alt.slice(0, Math.max(4, alt.length - 4));
    if (!all.includes(alt.slice(0, Math.min(alt.length, 8))) && !all.includes(` ${stem}*`) && !missing.has(alt)) { missing.add(alt); add('textwords', 'check', `${show(t)} has no "${alt}…" spelling beside it.`); }
  }
  for (const t of terms) { const stem = t.term.split(/\s+/).pop().replace(/[*?$]+$/, ''); if (t.truncated && stem.length <= 3) add('textwords', 'revise', `${show(t)} is cut after ${stem.length} letters and finds unrelated words.`); }
  const untagged = family === 'pubmed' ? words.filter(t => !t.field) : [];
  if (untagged.length) add('textwords', 'check', `${untagged.length} ${untagged.length === 1 ? 'term has' : 'terms have'} no field tag (${untagged.slice(0, 2).map(show).join(', ')}): PubMed maps such terms its own way; tag them [tiab].`);

  // 5 spelling and syntax: typographic quotes, field tags the database does not have, the same term twice in one list
  if (/[“”‘’]/.test(raw)) add('syntax', 'revise', 'Typographic quotation marks: databases read only straight quotes (").');
  if (family === 'pubmed') { const bad = [...new Set(terms.map(t => t.field).filter(f => f && !PUBMED_TAGS.has(f.toLowerCase())))]; if (bad.length) add('syntax', 'revise', `PubMed has no field ${bad.map(f => `[${f}]`).join(', ')}.`); }
  if (family === 'wos') { const bad = [...new Set(fields.filter(f => !WOS_FIELDS.has(f)))]; if (bad.length) add('syntax', 'revise', `Web of Science has no field ${bad.join(', ')}=.`); }
  if (family === 'scopus') { const bad = [...new Set(fields.filter(f => !SCOPUS_FIELDS.has(f)))]; if (bad.length) add('syntax', 'revise', `Scopus has no field ${bad.join(', ')}().`); }
  for (const g of groups) {
    const seen = new Set(), twice = g.children.filter(c => c.term != null).map(c => `${c.term.toLowerCase()}|${c.field}`).find(k => (seen.has(k) ? true : (seen.add(k), false)));
    if (twice) { add('syntax', 'check', `"${twice.split('|')[0]}" is listed twice in one OR list.`); break; }
  }

  // 6 limits and filters: each is found and named, so the methods can say why it is there
  const limit = (re, what) => { if (re.test(raw)) add('limits', 'check', `${what}: state the reason in the methods.`); };
  limit(/\[(dp|pdat|edat|crdt)\]|\bPUBYEAR\b|\bPY\s*=|\b(19|20)\d\d\s*[:-]\s*(19|20)\d\d\b/i, 'A date limit');
  limit(/\[(la|lang|language)\]|\bLANGUAGE\s*\(|\bLA\s*=/i, 'A language limit, a known source of bias');
  limit(/\[(pt|publication type|pubtype)\]|\bDOCTYPE\s*\(|\bDT\s*=/i, 'A publication-type limit');
  if (/\bhumans?\s*\[(mh|mesh)\]/i.test(raw) && !/NOT\s+humans?\b/i.test(raw) && /AND\s+humans?\s*\[/i.test(raw)) add('limits', 'revise', 'AND humans[Mesh] drops records not yet indexed; exclude animal-only records with NOT (animals NOT humans) instead.');

  const domains = PRESS_DOMAINS.map(d => {
    const fs = found[d.id], grade = fs.reduce((g, f) => (RANK[f.grade] > RANK[g] ? f.grade : g), 'ok');
    return { id: d.id, name: d.name, grade, findings: fs };
  });
  const grade = domains.reduce((g, d) => (RANK[d.grade] > RANK[g] ? d.grade : g), 'ok');
  const counts = { ok: 0, check: 0, revise: 0 }; for (const d of domains) counts[d.grade]++;
  return { family, terms: terms.length, domains, grade, counts };
}

/** "No revision in 4 of 6 domains; 2 with suggestions": the grade in a line. */
export function gradeLine(g) {
  if (!g) return '';
  const parts = [`No revision in ${g.counts.ok} of 6 domains`];
  if (g.counts.check) parts.push(`${g.counts.check} with ${g.counts.check === 1 ? 'a suggestion' : 'suggestions'}`);
  if (g.counts.revise) parts.push(`${g.counts.revise} ${g.counts.revise === 1 ? 'needs' : 'need'} revision`);
  return parts.join('; ');
}

const STOP = new Set(['adult', 'adults', 'patients', 'people', 'which', 'their', 'there', 'other', 'study', 'studies', 'using', 'treated', 'undergoing', 'compared',
  'versus', 'without', 'within', 'between', 'after', 'before', 'during', 'those', 'these', 'least', 'years', 'older', 'aged']);
