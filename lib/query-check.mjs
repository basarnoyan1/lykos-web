// A search strategy checked as it is typed or imported (31 Oct 2026): the problems a database will not report, each said plainly
// with where it is and what to write instead. Read with lib/query-syntax.mjs, so each check is the database's own rule:
// - brackets and quotes that do not close, curly quotes, empty brackets or lines, an operator with nothing on one side;
// - AND and OR at one level without brackets, with the order the database applies (or that its help gives none);
// - a wildcard inside a quoted phrase where the database ignores it (the Cochrane Library: "Do NOT use wildcards in quoted phrases",
//   Cochrane Library search help, read 31 Oct 2026), and PubMed proximity on a wildcard or a single word;
// - a field tag or proximity operator from another database's syntax, or a field the database does not have;
// - NOT used on a subject concept rather than an animal or publication-type filter;
// - a concept with no controlled vocabulary in a database that has it (MeSH, Emtree);
// - a numbered line referred to but not there, referred to before it is written, or never used;
// - terms in one database's translation and in none of the others (concept drift);
// - a count far from the last run of the same database.
// Each problem is { id, level: 'error' | 'warn' | 'note', text }: an error makes the search wrong, a warning probably does, a note is
// worth a look.
// - a MeSH heading NLM does not have, or an entry term written where its descriptor belongs (lib/mesh-check.mjs; from the project's
//   cached check, given as `mesh`), and the headings never checked.
import { parseQuery, parseStrategy, leaves, orderWords, fieldKnown, DIALECT_NAMES } from './query-syntax.mjs';
import { meshProblems } from './mesh-check.mjs';

const fmt = n => Number(n).toLocaleString('en-US');
const clip = (t, n = 60) => { const s = String(t).replace(/\s+/g, ' ').trim(); return s.length > n ? `${s.slice(0, n - 1)}…` : s; };
const nameOf = d => DIALECT_NAMES[d] || 'this database';
const listOf = (xs, n = 8) => xs.length > n ? `${xs.slice(0, n).join(', ')} and ${xs.length - n} more` : xs.join(', ');
const VOCAB = { pubmed: 'MeSH', cochrane: 'MeSH', ovid: 'subject heading', embase: 'Emtree' };
const PROXIMITY = { scopus: n => `W/${n}`, wos: n => `NEAR/${n}`, cochrane: n => `NEAR/${n}`, embase: n => `NEAR/${n}`, ovid: n => `adj${n}`,
  pubmed: n => `"a b"[tiab:~${n}]`, epmc: n => `"a b"~${n}` };
// what each database calls its title-abstract field, for a message that names the right one
const TOPIC = { pubmed: '[tiab]', scopus: 'TITLE-ABS-KEY( )', wos: 'TS=( )', cochrane: ':ti,ab,kw', ovid: '.ti,ab.', epmc: 'TITLE_ABS:( )', embase: ':ti,ab,kw', ctgov: 'AREA[…]' };
const SYNTAX_OF = { pubmed: 'PubMed', scopus: 'Scopus', wos: 'Web of Science', cochrane: 'Cochrane Library', ovid: 'Ovid', epmc: 'Europe PMC', ctgov: 'ClinicalTrials.gov' };

// words that make a NOT a filter rather than a subject: animal-only records and publication types
const FILTER_WORDS = /^(animals?|humans?|rats?|mice|mouse|murine|rodents?|monkeys?|macaques?|pigs?|swine|dogs?|canine|cats?|feline|rabbits?|sheep|ovine|primates?|nonhuman|non-human|animal experiment|animal models?|animal studies|in vitro|reviews?|systematic reviews?|meta-analys[ie]s|editorials?|letters?|comments?|news|errat[au]m?|published erratum|case reports?|retracted publication|conference abstracts?|books?|book chapters?|editorial material|corrections?|preprints?|re|bk|ch|er|ed|le|no|cp|sh)$/i;
const FILTER_FIELDS = /^(pt|publication type|DT|DOCTYPE|PUB_TYPE|SRC|la|language|LA|LANGUAGE|sb|filter|SRCTYPE|PUBSTAGE|StudyType|mh|mesh|INDEXTERMS)$/i;

/** The problems of a strategy as its database will read it: [{ id, level, text }]. `last`: { count, date } of the database's previous run;
 * `count`: this run's; `others`: [{ name, date?, query }] the same review's strategies for other databases; `mesh`: the project's MeSH
 * check (lib/mesh-check.mjs meshCache), null when the project never ran one; `explosions` adds what each exploded heading searches. */
export function checkQuery(src, { source = '', count = null, last = null, others = [], mesh = null, explosions = false } = {}) {
  const text = String(src ?? '');
  if (!text.trim()) return [];
  const st = parseStrategy(text, { source }), d = st.dialect, out = [];
  const add = (id, level, raw) => { const msg = raw.charAt(0).toUpperCase() + raw.slice(1); if (!out.some(p => p.text === msg)) out.push({ id, level, text: msg }); };
  const where = l => (st.numbered ? `Line ${l.n}: ` : '');

  // each line on its own: its brackets, quotes, operators and syntax
  for (const l of st.lines) {
    if (!l.text.trim()) { add('empty', 'error', `${where(l)}the line is empty.`); continue; }
    balance(l.text, msg => add('brackets', 'error', `${where(l)}${msg}`));
    const r = parseQuery(l.text, { dialect: d || 'pubmed' });
    for (const p of r.problems) problemText(p, l.text, d, (id, level, msg) => add(id, level, `${where(l)}${msg}`));
    syntaxChecks(r.tokens, d, (id, level, msg) => add(id, level, `${where(l)}${msg}`));
    if (r.tree) {
      const ls = leaves(r.tree), say = (id, level, msg) => add(id, level, `${where(l)}${msg}`);
      wildcardPhrases(ls, d, say);
      for (const leaf of ls) leafChecks(leaf, d, say);
    }
  }
  for (const p of st.problems) {
    if (p.kind === 'undefined-line') add('lines', 'error', `Line ${p.line} uses #${p.n}, which is not a line of this strategy.`);
    if (p.kind === 'forward-line') add('lines', 'error', `Line ${p.line} uses #${p.n}, which comes after it.`);
    if (p.kind === 'unused-line') add('lines', 'note', `Line ${p.n} is not used by the final line (#${p.line}).`);
  }

  // the search as run: its concepts, its exclusions and its controlled vocabulary
  const whole = parseQuery(st.query, { dialect: d || 'pubmed' }).tree;
  if (whole) {
    for (const x of exclusions(whole)) {
      const words = kept(x).filter(t => !t.ref);
      if (words.length < 3 || words.every(isFilter)) continue;
      add('not', 'note', `NOT removes every record that mentions ${listOf(words.map(t => t.term), 4)}: a relevant record that also mentions one is lost. NOT is safest for animal-only and publication-type filters.`);
    }
    const word = VOCAB[d];
    if (word) concepts(whole).forEach((c, i, all) => {
      if (all.length < 2) return;
      const ls = leaves(c);
      if (ls.length < 3 || ls.some(t => t.controlled || /^(pt|publication type)$/i.test(t.field))) return;
      add('vocabulary', 'note', `Concept ${i + 1} (${listOf(ls.slice(0, 3).map(t => t.term), 3)}…) has no ${word} term: add its ${word} heading if ${nameOf(d)} has one.`);
    });
  }

  // terms in this translation and in none of the other databases', and the other way round
  const mine = wordsOf(whole), theirs = others.map(o => ({ ...o, words: wordsOf(parseQuery(parseStrategy(o.query, { source: o.name }).query, { source: o.name }).tree) })).filter(o => o.words.size);
  if (mine.size && theirs.length) {
    const names = listOf(theirs.map(o => `${o.name}${o.date ? ` (${o.date})` : ''}`), 4);
    const only = [...mine].filter(w => !theirs.some(o => has(o.words, w)));
    const missing = theirs.length > 1 ? [...theirs[0].words].filter(w => theirs.every(o => has(o.words, w)) && !has(mine, w)) : [];
    if (only.length) add('drift', 'warn', `Only in this strategy, not in ${names}: ${listOf(only, 10)}.`);
    if (missing.length) add('drift', 'warn', `In ${names}, not in this strategy: ${listOf(missing, 10)}.`);
  }

  // the count beside the database's last run
  if (count != null && Number(count) === 0) add('count', 'warn', `The search found no records${d === 'cochrane' ? ': a wildcard inside quotes is the usual cause in the Cochrane Library' : ''}.`);
  else if (count != null && last?.count) {
    const r = Number(count) / Number(last.count);
    if (r >= 3 || r <= 1 / 3) add('count', 'warn', `${fmt(count)} records against ${fmt(last.count)} in the last run${last.date ? ` (${last.date})` : ''}: ${r > 1 ? `${r.toFixed(1)} times as many` : `${Math.round(r * 100)}% as many`}. Check that the change to the strategy explains it.`);
  }
  // the headings against NLM, as the project's last check found them
  if (mesh) for (const p of meshProblems(text, mesh, { source, explosions })) add(p.id, p.level, p.text);
  const rank = { error: 0, warn: 1, note: 2 };
  return out.sort((a, b) => rank[a.level] - rank[b.level]);
}

// brackets and quotes counted outside quoted phrases, with where the first unmatched one is
function balance(t, say) {
  let depth = 0, quote = -1, firstOpen = [], extraClose = -1;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (quote >= 0) { if (c === '"' || c === '”') quote = -1; continue; }
    if (c === '"' || c === '“') { quote = i; continue; }
    if (c === '(') { depth++; firstOpen.push(i); }
    else if (c === ')') { if (depth) { depth--; firstOpen.pop(); } else if (extraClose < 0) extraClose = i; }
  }
  if (quote >= 0) say(`a quote is not closed: ${clip(t.slice(quote), 40)}`);
  if (depth) say(`${depth} bracket${depth === 1 ? '' : 's'} opened and not closed, the first at ${clip(t.slice(firstOpen[0]), 40)}`);
  if (extraClose >= 0) say(`a bracket is closed that was not opened: …${clip(t.slice(Math.max(0, extraClose - 30), extraClose + 1), 40)}`);
}

function problemText(p, text, d, add) {
  const near = p.at != null ? clip(text.slice(Math.max(0, p.at - 20), p.at + 30), 50) : '';
  if (p.kind === 'curly') add('quotes', 'error', `curly quotes in ${clip(p.text, 40)}: databases read only straight quotes (").`);
  else if (p.kind === 'empty') add('empty', 'error', `empty ${p.text === '""' ? 'quotes' : 'brackets'}${p.text && p.text !== '""' && p.text !== '()' ? ` in ${p.text}` : ''}: a concept with no terms.`);
  else if (p.kind === 'operator') add('operator', 'error', `${p.text ? `${p.text} ` : 'an operator '}has nothing on one side${near ? `, near “${near}”` : ''}.`);
  else if (p.kind === 'tag') add('operator', 'error', `the field ${p.text} has no term before it.`);
  else if (p.kind === 'bracket') add('brackets', 'error', `a square bracket ${p.text} is not matched.`);
  else if (p.kind === 'mixed') {
    const span = p.at != null ? clip(text.slice(Math.max(0, p.at - 25), (p.to ?? p.at) + 30), 70) : '';
    const how = p.ordered ? `${orderWords(p.dialect)}, so the grouping may not be the one meant` : `${nameOf(p.dialect)} does not document which comes first`;
    add('mixed', p.ordered && p.dialect === 'pubmed' ? 'warn' : p.ordered ? 'warn' : 'error', `AND and OR at one level without brackets${span ? ` (“${span}”)` : ''}: ${how}. Add brackets.`);
  } else if (p.kind === 'proximity-form') add('proximity', 'error', `in ${clip(p.text, 50)}: PubMed proximity needs a quoted phrase of two or more words, with no wildcard and no brackets.`);
  else if (p.kind === 'group-tag') add('fields', 'error', `${p.text} after brackets: PubMed applies a tag to one term or phrase, not to a group.`);
  else if (p.kind === 'unknown-field') add('fields', 'error', `${p.text}( is not a ${nameOf(d)} field.`);
}

// another database's syntax, or a field this database does not have
function syntaxChecks(tokens = [], d, add) {
  if (!d) return;
  const own = d === 'embase' ? new Set(['cochrane', 'embase']) : new Set([d]);
  for (const t of tokens) {
    if (t.t === 'tag' && d !== 'pubmed' && d !== '') add('fields', 'error', `[${t.raw}] is PubMed syntax; ${nameOf(d)} searches title and abstract with ${TOPIC[d] || 'its own field codes'}.`);
    else if (t.t === 'tag' && d === 'pubmed' && !fieldKnown('pubmed', t.v) && t.proximity == null) add('fields', 'error', `[${t.raw}] is not a PubMed field tag.`);
    if ((t.t === 'field' || t.t === 'fieldp') && t.syntax && t.syntax !== 'unknown' && !own.has(t.syntax) && !(d === 'ovid' && t.syntax === 'cochrane'))
      add('fields', 'error', `${t.raw || t.v}${t.syntax === 'wos' ? '=' : t.syntax === 'epmc' ? ':' : t.syntax === 'ctgov' ? '' : '('} is ${SYNTAX_OF[t.syntax]} syntax; ${nameOf(d)} does not read it${TOPIC[d] ? ` (title and abstract: ${TOPIC[d]})` : ''}.`);
    else if ((t.t === 'field' || t.t === 'fieldp') && own.has(t.syntax) && !fieldKnown(d, t.v)) add('fields', 'error', `${t.raw || t.v} is not a ${nameOf(d)} field.`);
    if (t.t === 'suffix' && !own.has(t.syntax) && !(t.syntax === 'cochrane' && d === 'ovid'))
      add('fields', 'error', `${t.syntax === 'ovid' ? `.${t.v}.` : `:${t.v}`} is ${SYNTAX_OF[t.syntax]} syntax; ${nameOf(d)} does not read it${TOPIC[d] ? ` (title and abstract: ${TOPIC[d]})` : ''}.`);
    else if (t.t === 'suffix' && own.has(t.syntax) && !fieldKnown(d, t.v)) add('fields', 'error', `:${t.v} holds a field code ${nameOf(d)} does not have.`);
    if (t.t === 'term' && t.syntax === 'ovid' && !t.controlled && t.field && d !== 'ovid') add('fields', 'error', `${t.v}.${t.field}. is Ovid syntax; ${nameOf(d)} does not read it${TOPIC[d] ? ` (title and abstract: ${TOPIC[d]})` : ''}.`);
    if (t.t === 'term' && t.syntax && t.syntax !== d && t.controlled && !own.has(t.syntax)) add('fields', 'error', `${t.syntax === 'cochrane' ? `[mh "${t.v}"]` : `${t.v}/`} is ${SYNTAX_OF[t.syntax]} syntax for a subject heading; ${nameOf(d)} does not read it.`);
    if (t.t === 'op' && t.v === 'NEAR') {
      const ok = { W: ['scopus'], PRE: ['scopus'], NEAR: ['wos', 'cochrane', 'embase'], NEXT: ['cochrane', 'embase'], ADJ: ['ovid'] }[t.kind] || [];
      if (!ok.includes(d)) {
        const n = t.n ?? (t.kind === 'NEXT' ? 0 : '');
        const instead = d === 'pubmed' ? `PubMed has no proximity operator; write the words as a quoted phrase with [tiab:~${n || 'n'}]`
          : PROXIMITY[d] ? `${nameOf(d)} writes ${PROXIMITY[d](n === '' ? 'n' : n)}` : `${nameOf(d)} has no proximity operator`;
        add('proximity', 'error', `${t.raw} is ${t.kind === 'W' || t.kind === 'PRE' ? 'Scopus' : t.kind === 'ADJ' ? 'Ovid' : t.kind === 'NEXT' ? 'Cochrane Library' : 'Web of Science or Cochrane Library'} proximity: ${instead}.`);
      } else if (t.kind === 'NEAR' && t.n == null) add('proximity', 'note', `NEAR without a distance means ${d === 'wos' ? 'within 15 words in Web of Science' : 'within 6 words in the Cochrane Library'}; write NEAR/n to say how close.`);
    }
    if (t.t === 'op' && t.v === 'SAME' && d !== 'wos') add('proximity', 'error', `SAME is Web of Science syntax; ${nameOf(d)} does not read it.`);
    if (t.t === 'op' && t.lower && d === 'pubmed') add('operator', 'error', `“${t.raw}” in lower case: PubMed reads it as a word to search, not an operator. Write ${t.raw.toUpperCase()}.`);
  }
}

// phrases with a wildcard inside quotes, in a database that does not search them, said once per line with their rewrite
function wildcardPhrases(ls, d, add) {
  if (d !== 'cochrane' && d !== 'embase') return;
  const bad = ls.filter(t => t.quoted && /[*?]/.test(String(t.term || '')));
  if (!bad.length) return;
  const fix = t => { const words = String(t.term).trim().split(/\s+/); return `"${t.term}" → ${words.length > 1 ? `(${words.join(' NEXT ')})` : t.term}`; };
  add('truncation', 'error', `${bad.length === 1 ? 'a phrase holds' : `${bad.length} phrases hold`} a wildcard inside quotes, which the ${d === 'embase' ? 'database' : 'Cochrane Library'} does not search, so ${bad.length === 1 ? 'it finds' : 'they find'} nothing. Write each with NEXT: ${listOf(bad.map(fix), 3)}.`);
}
function leafChecks(t, d, add) {
  const term = String(t.term || '');
  if (t.proximity != null && t.proxSyntax === 'epmc' && d !== 'epmc') add('proximity', 'error', `"${term}"~${t.proximity} is Europe PMC proximity; ${nameOf(d)} does not read it.`);
}

const isFilter = t => FILTER_FIELDS.test(t.field || '') || FILTER_WORDS.test(String(t.term || '').replace(/[*"]/g, '').trim());
// what each NOT removes; a NOT inside what another NOT removes puts records back (reviews indexed as trials kept), so it is not one
function exclusions(n, out = [], inside = false) {
  if (!n || n.term != null) return out;
  n.children.forEach((c, i) => {
    const removed = n.op === 'AND' && i > 0 && n.nots?.[i - 1] === 'NOT';
    if (removed && !inside) out.push(c);
    exclusions(c, out, inside || removed);
  });
  return out;
}
// the terms a group searches for, without those it removes
function kept(n) {
  if (!n) return [];
  if (n.term != null) return leaves(n);
  return n.children.flatMap((c, i) => (n.op === 'AND' && i > 0 && n.nots?.[i - 1] === 'NOT' ? [] : kept(n.field && !c.field ? { ...c, field: n.field } : c)));
}
// the concepts a search combines with AND (an AND of ANDs is one list), leaving out what NOT removes
function concepts(n) {
  if (!n || n.term != null || n.op !== 'AND') return n ? [n] : [];
  return n.children.flatMap((c, i) => (i && n.nots?.[i - 1] === 'NOT' ? [] : c.op === 'AND' && !c.field ? concepts(c) : [c]));
}

// the free-text words of a strategy, for comparing translations: subject headings, filters and line numbers left out
const STOP = new Set(['of', 'the', 'a', 'an', 'in', 'on', 'for', 'to', 'with', 'by', 'and', 'or', 'not', 'at', 'from']);
function wordsOf(tree) {
  const out = new Set();
  for (const t of leaves(tree)) {
    if (t.controlled || t.ref || t.combo || isFilter(t) || FILTER_FIELDS.test(t.field || '')) continue;
    for (const w of String(t.term).toLowerCase().replace(/["“”]/g, '').split(/[\s/-]+/)) {
      const x = w.replace(/^[^a-z0-9*]+|[^a-z0-9*]+$/g, '');
      if (x.length > 1 && !STOP.has(x) && !/^\d+$/.test(x)) out.add(x);
    }
  }
  return out;
}
// a word is in a set when written the same, or when a truncated form covers it (stimulat* covers stimulation)
function has(set, w) {
  if (set.has(w)) return true;
  const stem = w.endsWith('*') ? w.slice(0, -1) : null;
  for (const x of set) {
    if (stem && x.replace(/\*$/, '').startsWith(stem)) return true;
    if (x.endsWith('*') && w.replace(/\*$/, '').startsWith(x.slice(0, -1))) return true;
    if (x.replace(/-/g, '') === w.replace(/-/g, '')) return true;
  }
  return false;
}
