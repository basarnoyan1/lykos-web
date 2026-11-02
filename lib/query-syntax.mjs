// A database's search syntax, read (31 Oct 2026). One reader for every database a review searches, so a strategy is drawn, checked
// and translated as that database will run it: PubMed (term[tiab], [Mesh], [tiab:~3]), Scopus (TITLE-ABS-KEY(…), W/n, PRE/n,
// AND NOT), Web of Science (TS=(…), NEAR/x, SAME), Cochrane CENTRAL (#1 … lines, [mh "…"], (…):ti,ab,kw, NEXT, NEAR/n), Ovid
// (exp Heading/, term.ti,ab., adjN, numbered lines), Europe PMC (TITLE:(…), KW:"…", SRC:MED) and ClinicalTrials.gov (AREA[Field]…).
//
// Operators are combined in each database's own order, from its help (read 31 Oct 2026): PubMed left to right; Scopus OR, then the
// proximity operators, then AND, then AND NOT (Elsevier, Scopus search tips and advanced search help); Web of Science NEAR/x, SAME,
// NOT, AND, OR (Clarivate, Search operators); the Cochrane Library NOT, then AND, then OR, with NEAR and NEXT first (Cochrane Library
// search help). For a database whose help gives no order (Europe PMC, Ovid, ClinicalTrials.gov) AND and OR mixed at one level is read
// left to right and marked `ambiguous`: the result cannot be known, and the check (lib/query-check.mjs) says to add brackets.
//
// Nodes are those lib/query-view.mjs draws: { term, field?, proximity?, quoted?, controlled?, explode?, ref? } and
// { op: 'AND' | 'OR' | 'NEAR', n?, kind?, field?, children, nots?, mixed?, ambiguous? } (a NOT is an AND whose `nots[i]` is 'NOT').
// Nothing here rewrites a query: the text sent is the text written.

export const DIALECT_NAMES = Object.freeze({ pubmed: 'PubMed', scopus: 'Scopus', wos: 'Web of Science', cochrane: 'Cochrane CENTRAL', ovid: 'Ovid',
  embase: 'Embase', epmc: 'Europe PMC', ctgov: 'ClinicalTrials.gov', ictrp: 'WHO ICTRP', openalex: 'OpenAlex' });

/** The syntax a database's queries are written in, from its name, else from the query's own syntax; '' when neither tells. */
export function dialectOf(source = '', text = '') {
  const s = String(source || '').toLowerCase().trim();
  if (s) {
    if (/ovid/.test(s)) return 'ovid';
    if (/europe.?pmc|^epmc/.test(s)) return 'epmc';
    if (/pubmed|medline/.test(s)) return 'pubmed';
    if (/scopus/.test(s)) return 'scopus';
    if (/web.?of.?science|^wos\b/.test(s)) return 'wos';
    if (/cochrane|central/.test(s)) return 'cochrane';
    if (/europe.?pmc|^epmc/.test(s)) return 'epmc';
    if (/clinicaltrials|^ctgov/.test(s)) return 'ctgov';
    if (/ictrp/.test(s)) return 'ictrp';
    if (/openalex/.test(s)) return 'openalex';
    if (/embase|psycinfo|cinahl/.test(s)) return syntaxDialect(text) === 'ovid' ? 'ovid' : /embase/.test(s) ? 'embase' : '';
  }
  return syntaxDialect(text);
}
/** The dialect the query's own syntax shows, by its first unmistakable mark; ''. */
export function syntaxDialect(text) {
  const t = String(text || '');
  if (/\[(?:tiab|ti|ab|mh|mesh|majr|pt|la|tw|all|sh|title\/abstract|mesh terms|text word)(?::[^\]]*)?\]/i.test(t)) return 'pubmed';
  if (/\b(?:TITLE-ABS-KEY|TITLE-ABS|INDEXTERMS|AUTHKEY|DOCTYPE|SRCTITLE|PUBYEAR|SUBJAREA)\s*\(|\s(?:W|PRE)\/\d/i.test(t)) return 'scopus';
  if (/\b(?:TS|TI|AB|AK|KP|DT|SU|WC|PY|LA|AU|SO)\s*=/.test(t)) return 'wos';
  if (/\[mh\s|\)\s*:\s*(?:ti|ab|kw)\b|\bNEXT\b/i.test(t)) return 'cochrane';
  if (/\.(?:ti|ab|tw|kw|mp|sh|kf)(?:,(?:ti|ab|tw|kw|mp|kf|sh))*\.|\badj\d*\b/i.test(t) || /^\s*\d*\.?\s*exp\s/im.test(t)) return 'ovid';
  if (/\bAREA\[/.test(t)) return 'ctgov';
  if (/\b(?:TITLE|ABSTRACT|KW|PUB_TYPE|SRC|AUTH|TITLE_ABS|MESH|LANG|HAS_[A-Z]+|IN_EPMC|OPEN_ACCESS):/.test(t)) return 'epmc';
  return '';
}

// Each database's order of operators (a higher number binds tighter); `ordered: false` when its help gives none.
const ORDER = {
  pubmed: { ordered: true, OR: 1, AND: 1, NOT: 1, NEAR: 5, SAME: 5 },
  scopus: { ordered: true, OR: 4, NEAR: 3, AND: 2, NOT: 1, SAME: 3 },
  wos: { ordered: true, NEAR: 5, SAME: 4, NOT: 3, AND: 2, OR: 1 },
  cochrane: { ordered: true, NEAR: 5, SAME: 5, NOT: 3, AND: 2, OR: 1 },
};
const orderOf = d => ORDER[d] || { ordered: false, OR: 1, AND: 1, NOT: 1, NEAR: 5, SAME: 5 };
/** How a database combines AND and OR written at one level without brackets, in words; '' when its help does not say. */
export function orderWords(d) {
  return { pubmed: 'PubMed reads the operators left to right', scopus: 'Scopus combines OR first, then AND, then AND NOT',
    wos: 'Web of Science combines NOT first, then AND, then OR', cochrane: 'the Cochrane Library combines NOT first, then AND, then OR' }[d] || '';
}

// The fields each database knows. A field outside its set is another database's, or misspelt.
const PUBMED_TAGS = new Set(['tiab', 'ti', 'ab', 'mh', 'mesh', 'mesh terms', 'majr', 'mesh major topic', 'sh', 'subheading', 'pt', 'publication type', 'la', 'language',
  'tw', 'text word', 'text words', 'all', 'all fields', 'au', 'author', 'fau', '1au', 'lastau', 'ta', 'journal', 'dp', 'pdat', 'edat', 'crdt', 'mhda', 'lr', 'sb', 'filter',
  'nm', 'ot', 'ad', 'affiliation', 'title', 'title/abstract', 'pmid', 'uid', 'vi', 'ip', 'pg', 'si', 'gr', 'ps', 'ir', 'auid', 'cois', 'tt', 'rn', 'ec', 'pa', 'book', 'ed',
  'is', 'jid', 'lid', 'aid', 'doi', 'pmcid', 'cn', 'jour', 'dcom', 'supplementary concept', 'ptyp', 'publication date', 'date - publication', 'mesh subheading',
  'pharmacological action', 'tiab:noexp']);
const SCOPUS_FIELDS = new Set(['ALL', 'ABS', 'TITLE', 'TITLE-ABS', 'TITLE-ABS-KEY', 'TITLE-ABS-KEY-AUTH', 'KEY', 'AUTHKEY', 'INDEXTERMS', 'AF-ID', 'AFFIL', 'AFFILCITY',
  'AFFILCOUNTRY', 'AFFILORG', 'AUTH', 'AUTHOR-NAME', 'AUTHFIRST', 'AUTHLASTNAME', 'AUTHCOLLAB', 'AU-ID', 'FIRSTAUTH', 'EDITOR', 'DOCTYPE', 'PUBSTAGE', 'SRCTYPE',
  'OPENACCESS', 'LANGUAGE', 'SRCTITLE', 'EXACTSRCTITLE', 'CONF', 'CONFNAME', 'CONFLOC', 'PUBLISHER', 'CODEN', 'ISSN', 'ISSNP', 'EISSN', 'ISBN', 'ISSUE', 'VOLUME',
  'PAGES', 'PAGEFIRST', 'PAGELAST', 'ARTNUM', 'DOI', 'PMID', 'CHEM', 'CHEMNAME', 'CASREGNUMBER', 'TRADENAME', 'MANUFACTURER', 'PUBYEAR', 'REF', 'REFTITLE',
  'REFSRCTITLE', 'REFPUBYEAR', 'WEBSITE', 'FUND-SPONSOR', 'FUND-ACR', 'FUND-NO', 'SUBJAREA', 'MESH', 'EXACTKEYWORD', 'EXACTAUTHKEY', 'SEQBANK', 'SEQNUMBER']);
const WOS_FIELDS = new Set(['TS', 'TI', 'AB', 'AK', 'KP', 'AU', 'AI', 'GP', 'ED', 'SO', 'DO', 'PY', 'CF', 'AD', 'OG', 'OO', 'SG', 'SA', 'CI', 'ZP', 'FO', 'FG', 'FD', 'FT', 'SU',
  'WC', 'IS', 'UT', 'PMID', 'DT', 'PUBL', 'LA', 'ALL', 'TMSO', 'TMIC', 'TMAC', 'DOP', 'LD', 'PRF', 'TOPIC']);
const COCHRANE_CODES = new Set(['ti', 'ab', 'kw', 'au', 'so', 'pt', 'doi', 'an', 'la', 'cc', 'dt', 'yr', 'emt', 'sh', 'mh']);
const OVID_CODES = new Set(['ti', 'ab', 'tw', 'kw', 'kf', 'mp', 'sh', 'hw', 'fs', 'pt', 'jn', 'au', 'ui', 'ot', 'nm', 'rn', 'dq', 'dv', 'tn', 'px', 'fx', 'tm', 'lg', 'yr', 'ed', 'ep', 'id', 'cc', 'md']);
/** Whether `field` is one the database knows (true when the reader keeps no list for it). */
export function fieldKnown(dialect, field) {
  const f = String(field || '');
  if (!f) return true;
  if (dialect === 'pubmed') return PUBMED_TAGS.has(f.toLowerCase().replace(/\s+/g, ' ')) || /^[a-z ]+:noexp$/i.test(f) || /^\d{4}(\/\d{2}(\/\d{2})?)?(\s*:\s*\d{4}(\/\d{2}(\/\d{2})?)?)?$/.test(f);
  if (dialect === 'scopus') return SCOPUS_FIELDS.has(f.toUpperCase());
  if (dialect === 'wos') return WOS_FIELDS.has(f.toUpperCase());
  if (dialect === 'cochrane') return f === 'mh' || f.split(',').every(c => COCHRANE_CODES.has(c.trim().toLowerCase()));
  if (dialect === 'ovid') return f === 'mh' || f.split(',').every(c => OVID_CODES.has(c.trim().toLowerCase()) || /^\d+$/.test(c));
  return true;
}

const OPENER = /^([A-Za-z][A-Za-z0-9]*(?:-[A-Za-z0-9]+)*)\s*=?\s*\(/;
const WOS_OPENER = /^([A-Za-z]{2,5})\s*=\s*/;
const BOOL_OVID = /^[\d\s()]+(?:\s(?:and|or|not)\s[\d\s()]+)+$/i;

/**
 * The query's tokens: '(' ')', terms (quoted or bare, with a field from a tag, prefix or suffix), operators and proximity, field
 * openers, PubMed tags, line references (#3) and the syntax each came in (`syntax`), so another database's form can be named.
 * Answers { tokens, problems } where problems are { kind, text, at }.
 */
export function tokenize(src, dialect = '') {
  const s = String(src ?? ''), out = [], problems = [];
  let i = 0;
  const prev = () => out[out.length - 1];
  const push = t => { out.push(t); return t; };
  while (i < s.length) {
    const c = s[i], rest = s.slice(i);
    if (/\s/.test(c)) { i++; continue; }
    if (c === '(' || c === ')') { push({ t: c, at: i }); i++; continue; }
    if (c === '"' || c === '“' || c === '”') {
      const j = s.slice(i + 1).search(/["”“]/);
      if (j < 0) { problems.push({ kind: 'quote', text: s.slice(i, i + 40), at: i }); i = s.length; continue; }
      const v = s.slice(i + 1, i + 1 + j);
      if (c !== '"' || s[i + 1 + j] !== '"') problems.push({ kind: 'curly', text: s.slice(i, i + j + 2), at: i });
      const tok = push({ t: 'term', v, quoted: true, at: i });
      if (!v.trim()) problems.push({ kind: 'empty', text: '""', at: i });
      i += j + 2;
      const prox = /^~(\d+)/.exec(s.slice(i));   // Europe PMC: "a b"~5
      if (prox) { tok.proximity = Number(prox[1]); tok.proxSyntax = 'epmc'; i += prox[0].length; }
      continue;
    }
    // Cochrane: [mh "Heading"], [mh ^"Heading"], [mh Heading], [mh /SU]
    const mh = /^\[\s*(mh|mesh)\s+(\^?)\s*(?:"([^"]*)"|([^\]"]*?))\s*\]/i.exec(rest);
    if (mh) { push({ t: 'term', v: (mh[3] ?? mh[4] ?? '').trim(), field: 'mh', controlled: true, explode: !mh[2], quoted: mh[3] != null, syntax: 'cochrane', at: i }); i += mh[0].length; continue; }
    if (c === '[') {
      const j = s.indexOf(']', i);
      if (j < 0) { problems.push({ kind: 'bracket', text: '[', at: i }); i = s.length; continue; }
      const v = s.slice(i + 1, j).trim();
      if (!v) { problems.push({ kind: 'empty', text: '[]', at: i }); i = j + 1; continue; }
      const prox = /^(tiab|title\/abstract|ti|title|ad|affiliation):~(\d+)$/i.exec(v);
      if (prox) push({ t: 'tag', v: { title: 'ti', 'title/abstract': 'tiab', affiliation: 'ad' }[prox[1].toLowerCase()] || prox[1].toLowerCase(), proximity: Number(prox[2]), raw: v, at: i, syntax: 'pubmed' });
      else push({ t: 'tag', v, raw: v, at: i, syntax: 'pubmed', ...(v.includes('~') ? { badProximity: true } : {}) });
      i = j + 1; continue;
    }
    if (c === ']') { problems.push({ kind: 'bracket', text: ']', at: i }); i++; continue; }
    // #12, a line of the strategy
    const ref = /^#(\d+)(?![\w])/.exec(rest);
    if (ref) { push({ t: 'ref', n: Number(ref[1]), at: i }); i += ref[0].length; continue; }
    // ClinicalTrials.gov: AREA[Field]term, AREA[Field](…), AREA[Field]"…"
    const area = /^AREA\[([^\]]+)\]/.exec(rest);
    if (area) { push({ t: 'fieldp', v: area[1], syntax: 'ctgov', at: i }); i += area[0].length; continue; }
    // Cochrane (and Embase): a field suffix after a term or a bracket, ":ti,ab,kw"
    const suffix = /^:\s*([a-z]{2,3}(?:\s*,\s*[a-z]{2,3})*)\b/i.exec(rest);
    if (suffix && (prev()?.t === ')' || prev()?.t === 'term')) { push({ t: 'suffix', v: suffix[1].replace(/\s+/g, '').toLowerCase(), syntax: 'cochrane', at: i }); i += suffix[0].length; continue; }
    // Ovid: a field suffix after a bracket, ").ti,ab."
    const osuf = /^\.([a-z]{2}(?:,[a-z]{2})*)\./i.exec(rest);
    if (osuf && prev()?.t === ')') { push({ t: 'suffix', v: osuf[1].toLowerCase(), syntax: 'ovid', at: i }); i += osuf[0].length; continue; }
    // Ovid: exp Heading/ and Heading/ (a subject heading, exploded or not)
    if (dialect === 'ovid') {
      const head = /^(exp\s+)?([A-Za-z][^/()\n"]*?)\/(?:[a-z]{2}(?:,[a-z]{2})*)?(?=\s|$|\))/.exec(rest);
      if (head && !/\s(?:and|or|not)\s/i.test(` ${head[2]} `)) { push({ t: 'term', v: head[2].trim(), field: 'mh', controlled: true, explode: !!head[1], syntax: 'ovid', at: i }); i += head[0].length; continue; }
    }
    // a field that opens a bracket: Scopus TITLE-ABS-KEY(, INDEXTERMS(
    const op1 = OPENER.exec(rest);
    if (op1 && !/^(AND|OR|NOT|W|PRE|NEAR|NEXT|SAME|ADJ\d*)$/i.test(op1[1]) && !(op1[0].includes('=') && (WOS_FIELDS.has(op1[1].toUpperCase()) || dialect === 'wos'))) {
      const name = op1[1];
      push({ t: 'field', v: name.toUpperCase() === 'TOPIC' ? 'TS' : name.toUpperCase(), syntax: SCOPUS_FIELDS.has(name.toUpperCase()) ? 'scopus' : 'unknown', raw: name, at: i });
      i += op1[0].length - 1; continue;
    }
    // Web of Science TS=( and TS=term
    const op2 = WOS_OPENER.exec(rest);
    if (op2 && (WOS_FIELDS.has(op2[1].toUpperCase()) || dialect === 'wos')) {
      const name = op2[1].toUpperCase() === 'TOPIC' ? 'TS' : op2[1].toUpperCase();
      i += op2[0].length;
      push({ t: s[i] === '(' ? 'field' : 'fieldp', v: name, syntax: WOS_FIELDS.has(name) ? 'wos' : 'unknown', raw: op2[1], at: i - op2[0].length });
      if (s[i] === '(') { out.at(-1).opened = true; }
      continue;
    }
    // Europe PMC TITLE:( , KW:"…", SRC:MED
    const ep = /^([A-Z][A-Z_]+):(?=[("A-Za-z0-9*])/.exec(rest);
    if (ep && !/^(AND|OR|NOT)$/.test(ep[1])) {
      i += ep[0].length;
      push({ t: s[i] === '(' ? 'field' : 'fieldp', v: ep[1], syntax: 'epmc', at: i - ep[0].length, ...(s[i] === '(' ? { opened: true } : {}) });
      continue;
    }
    // Scopus PUBYEAR > 2010, PUBYEAR AFT 2010
    const year = /^(PUBYEAR)\s*(>|<|=|AFT|BEF|IS)\s*(\d{4})/i.exec(rest);
    if (year) { push({ t: 'term', v: `${year[2]} ${year[3]}`, field: 'PUBYEAR', syntax: 'scopus', at: i }); i += year[0].length; continue; }
    const m = /^[^\s()"“”[\]]+/.exec(rest);
    if (!m) { problems.push({ kind: 'char', text: c, at: i }); i++; continue; }
    const w = m[0];
    // a Cochrane suffix glued to a term: stimulat*:ti,ab
    const glued = /^(.+?):([a-z]{2,3}(?:,[a-z]{2,3})*)$/i.exec(w);
    if (glued && !/^https?$/i.test(glued[1]) && dialect !== 'epmc' && !/^[A-Z_]+$/.test(glued[1])) {
      push({ t: 'term', v: glued[1], at: i }); push({ t: 'suffix', v: glued[2].toLowerCase(), syntax: 'cochrane', at: i + glued[1].length });
      i += w.length; continue;
    }
    // an Ovid suffix glued to a term: glioma.ti,ab.
    const og = /^(.+?)\.((?:ti|ab|tw|kw|kf|mp|sh|hw|pt|jn|au|ot|nm|rn)(?:,[a-z]{2})*)\.$/i.exec(w);
    if (og) { push({ t: 'term', v: og[1], field: og[2].toLowerCase(), syntax: 'ovid', at: i }); i += w.length; continue; }
    i += w.length;
    const prox = /^(W|PRE|NEAR|NEXT|SAME|ADJ)(?:\/(\d+))?$/i.exec(w) || /^(adj)(\d+)$/i.exec(w);
    if (prox && (prox[2] != null || /^(NEAR|NEXT|SAME|ADJ)$/i.test(prox[1]))) {
      const kind = prox[1].toUpperCase();
      // a lower-case near or next is a word everywhere but Ovid (adj) and the Cochrane Library
      if (prox[1] !== kind && prox[2] == null && !['ovid', 'cochrane'].includes(dialect)) { push({ t: 'term', v: w, at: i - w.length }); continue; }
      push({ t: 'op', v: kind === 'SAME' ? 'SAME' : 'NEAR', kind, n: prox[2] != null ? Number(prox[2]) : null, raw: w, at: i - w.length });
      continue;
    }
    // Ovid's or/1-5, and/3,4
    const combo = /^(or|and)\/(\d+(?:\s*[-,]\s*\d+)*)$/i.exec(w);
    if (combo) { push({ t: 'combo', v: combo[1].toUpperCase(), list: combo[2], at: i - w.length }); continue; }
    if (/^(AND|OR|NOT)$/i.test(w)) {
      const v = w.toUpperCase();
      if (v === 'NOT' && prev()?.t === 'op' && prev().v === 'AND') { prev().v = 'NOT'; prev().raw = 'AND NOT'; continue; }   // Scopus AND NOT
      push({ t: 'op', v, raw: w, ...(w !== v ? { lower: true } : {}), at: i - w.length }); continue;
    }
    push({ t: 'term', v: w, at: i - w.length });
  }
  return { tokens: out, problems };
}

/**
 * Reads a query (one line of a strategy) into its tree, in its database's order of operators. Answers { tree, problems, dialect, tokens }
 * where problems are { kind, text?, at? }: 'paren' (unbalanced), 'quote', 'curly', 'bracket', 'empty' (an empty group or phrase),
 * 'operator' (an operator with nothing on one side), 'tag' (a field tag on nothing), 'mixed' (AND and OR at one level without
 * brackets), 'proximity-form', 'char'. The tree is null when the query cannot be read.
 */
export function parseQuery(src, { dialect = '', source = '' } = {}) {
  const d = dialect || dialectOf(source, src), ord = orderOf(d);
  const { tokens: toks, problems } = tokenize(src, d);
  let k = 0, broken = problems.some(p => ['quote', 'bracket', 'char', 'empty'].includes(p.kind));
  const fail = (kind, at, text = '') => { problems.push({ kind, at, text }); broken = true; return null; };
  const bracketed = (field, depth, open) => {
    // k is at the '(' after an opener, or at the '(' itself
    k++;
    if (toks[k]?.t === ')') { problems.push({ kind: 'empty', at: open.at, text: field ? `${open.raw || field}()` : '()' }); broken = true; k++; return null; }
    const node = group(field, depth + 1, open.at);
    if (!node) return null;
    if (toks[k]?.t !== ')') return fail('paren', open.at, '(');
    k++;
    return node;
  };
  const group = (field, depth, openAt) => {
    if (depth > 64) return fail('depth', openAt);
    const items = [], ops = [];
    while (k < toks.length && toks[k].t !== ')') {
      const tok = toks[k];
      if (tok.t === 'op') {
        if (items.length === ops.length) return fail('operator', tok.at, tok.raw);
        ops.push(tok); k++; continue;
      }
      if (tok.t === 'suffix' || tok.t === 'tag') return fail('tag', tok.at, tok.raw || tok.v);
      let node;
      if (tok.t === '(') { node = bracketed(null, depth, tok); if (!node) return null; node = node.term != null ? { ...node, bracketed: true } : { ...node, group: true }; }
      else if (tok.t === 'field') {
        if (tok.syntax === 'unknown') problems.push({ kind: 'unknown-field', at: tok.at, text: tok.raw || tok.v });
        k++;
        if (toks[k]?.t !== '(') return fail('paren', tok.at);
        node = bracketed(tok.v, depth, tok); if (!node) return null;
        node = { ...node, field: tok.v, fieldSyntax: tok.syntax, group: true };
      } else if (tok.t === 'fieldp') {
        // a field for the next operand: TS=term, AREA[Field]term, KW:"phrase", SRC:MED
        k++;
        const next = toks[k];
        if (!next) return fail('operator', tok.at, tok.v);
        if (next.t === '(') { node = bracketed(tok.v, depth, next); if (!node) return null; node = { ...node, field: tok.v, fieldSyntax: tok.syntax, group: true }; }
        else if (next.t === 'term') { node = { term: next.v, field: tok.v, fieldSyntax: tok.syntax, ...(next.quoted ? { quoted: true } : {}) }; k++; }
        else return fail('operator', tok.at, tok.v);
      } else if (tok.t === 'ref') { node = { term: `#${tok.n}`, ref: tok.n, field: null }; k++; }
      else if (tok.t === 'combo') { node = { term: `${tok.v.toLowerCase()}/${tok.list}`, combo: tok.v, list: tok.list, field: null }; k++; }
      else {
        node = { term: tok.v, field: tok.field || null, ...(tok.quoted ? { quoted: true } : {}), ...(tok.controlled ? { controlled: true, explode: tok.explode } : {}),
          ...(tok.proximity != null ? { proximity: tok.proximity, proxSyntax: tok.proxSyntax } : {}), ...(tok.syntax ? { fieldSyntax: tok.syntax } : {}) };
        k++;
        // a bare run of words is one operand, as the databases read it ("spinal fusion"[tiab] is one phrase)
        while (!tok.quoted && !node.field && toks[k]?.t === 'term' && !toks[k].quoted && !toks[k].field && !toks[k].controlled) { node.term += ` ${toks[k].v}`; k++; }
      }
      // a postfix field: PubMed's [tiab], Cochrane's :ti,ab,kw, Ovid's .ti,ab.
      if (toks[k]?.t === 'tag') {
        const tag = toks[k];
        if (tag.badProximity) problems.push({ kind: 'proximity-form', at: tag.at, text: `[${tag.raw}]` });
        if (tag.proximity != null) {
          node = { ...node, proximity: tag.proximity, proxSyntax: 'pubmed' };
          if (!node.quoted || node.op || node.bracketed || String(node.term || '').includes('*') || String(node.term || '').trim().split(/\s+/).length < 2) problems.push({ kind: 'proximity-form', at: tag.at, text: `${node.term ?? '(…)'}[${tag.raw}]` });
        }
        if (node.op) problems.push({ kind: 'group-tag', at: tag.at, text: `[${tag.raw}]` });
        node = { ...node, field: tag.v, fieldSyntax: 'pubmed', ...(/^(mh|mesh|mesh terms|majr|mesh major topic)(:noexp)?$/i.test(tag.v) ? { controlled: true, explode: !/noexp/i.test(tag.v) } : {}) };
        k++;
      } else if (toks[k]?.t === 'suffix') {
        node = { ...node, field: toks[k].v, fieldSyntax: toks[k].syntax }; k++;
      }
      if (items.length > ops.length) ops.push({ t: 'op', v: 'AND', implicit: true });   // operands side by side: AND
      items.push(node);
    }
    if (!items.length) return fail('empty', openAt);
    if (ops.length !== items.length - 1) return fail('operator', ops.at(-1)?.at, ops.at(-1)?.raw);
    return combine(items, ops, field, d, ord, problems);
  };
  const tree = toks.length ? group(null, 0, 0) : null;
  if (k < toks.length) { problems.push({ kind: 'paren', at: toks[k].at, text: ')' }); broken = true; }
  return { tree: broken ? null : tree, problems, dialect: d, tokens: toks };
}

// Operands and operators of one level into a tree: each database's order, equal ranks left to right.
function combine(items, ops, field, d, ord, problems) {
  const rank = o => ord[o.v] ?? 1;
  const bools = new Set(ops.filter(o => o.v !== 'NEAR' && o.v !== 'SAME').map(o => o.v));
  const mixed = bools.has('OR') && (bools.has('AND') || bools.has('NOT'));
  const out = [], stack = [];
  const make = (o, a, b) => {
    if (o.v === 'NEAR' || o.v === 'SAME') return { op: 'NEAR', n: o.n, kind: o.kind, children: [a, b] };
    if (o.v === 'OR') return { op: 'OR', children: [...(a.op === 'OR' && !a.group && !a.field ? a.children : [a]), b] };
    const nots = o.v === 'NOT' ? 'NOT' : 'AND';
    if (a.op === 'AND' && !a.group && !a.field) return { op: 'AND', children: [...a.children, b], nots: [...a.nots, nots] };
    return { op: 'AND', children: [a, b], nots: [nots] };
  };
  const reduce = () => { const o = stack.pop(), b = out.pop(), a = out.pop(); out.push(make(o, a, b)); };
  out.push(items[0]);
  ops.forEach((o, i) => {
    while (stack.length && rank(stack.at(-1)) >= rank(o)) reduce();
    stack.push(o); out.push(items[i + 1]);
  });
  while (stack.length) reduce();
  let node = clean(out[0]);
  if (mixed) {
    node = { ...node, mixed: true, ...(ord.ordered ? {} : { ambiguous: true }) };
    problems.push({ kind: 'mixed', dialect: d, ordered: ord.ordered, at: Math.min(...ops.filter(o => o.at != null && o.v !== 'NEAR').map(o => o.at)), to: Math.max(...ops.filter(o => o.at != null && o.v !== 'NEAR').map(o => o.at)) });
  }
  if (field) node = { ...node, field };
  return node;
}
// An AND joined only by AND says so by having no `nots`; a bracket's own marker is the reader's alone.
function clean(n) {
  if (n.term != null) return n;
  const out = { ...n, children: n.children.map(c => (c.group ? (({ group, ...rest }) => rest)(c) : c)) };
  if (out.nots && out.nots.every(x => x === 'AND')) delete out.nots;
  return out;
}

// ---- strategies of numbered lines ---------------------------------------------------------------------------------------------------

const LIMIT = /\s+in\s+(Trials|Cochrane Reviews|Cochrane Protocols|Clinical Answers|Special collections|Editorials)\s*$/i;
/**
 * A strategy as its database takes it: a numbered set of lines (Cochrane "#1 …", Ovid "1. …" or "1 …", EBSCO "S1 …", a strategy file's
 * JSON { lines: [{ n, q, block }] }) or one query. Comment lines ("# …") and a ClinicalTrials.gov file's "query.term: …" parts are read
 * as such. Answers { dialect, lines: [{ n, text, block, limit?, refs }], numbered, comments, query, problems }: `query` is the final
 * line with every #n replaced by its line in brackets (the search as run); problems are { kind: 'undefined-line' | 'forward-line' |
 * 'unused-line' | 'empty-line', n, line }.
 */
export function parseStrategy(src, { source = '' } = {}) {
  let text = String(src ?? '').replace(/^﻿/, '');
  let lines = [];
  const comments = [], trimmed = text.trim();
  if (trimmed.startsWith('{')) {
    try {
      const doc = JSON.parse(trimmed);
      if (typeof doc.query === 'string') text = doc.query;
      else if (Array.isArray(doc.lines)) lines = doc.lines.map(l => ({ n: Number(l.n), text: String(l.q ?? l.query ?? ''), block: String(l.block || '') }));
      if (doc.principles) comments.push(String(doc.principles));
      source = source || String(doc.database || '');
    } catch { /* not JSON: read as text */ }
  }
  if (!lines.length) {
    const parts = [];
    for (const l of text.split(/\r?\n/)) {
      const t = l.trim();
      if (!t) continue;
      if (/^#(\s|$)/.test(t)) { comments.push(t.replace(/^#\s*/, '')); continue; }
      const num = /^(?:#|S)?(\d+)(?:[.)]\s*|\t\s*|\s+|$)(.*)$/.exec(t);
      if (num && /^(?:#\d|S\d|\d+[.)\t]|\d+\s+\S)/.test(t)) { parts.push({ n: Number(num[1]), text: num[2], block: '' }); continue; }
      const ct = /^query\.(\w+)\s*:\s*(.*)$/.exec(t);
      if (ct) { parts.push({ n: parts.length + 1, text: ct[2], block: `query.${ct[1]}`, part: ct[1] }); continue; }
      if (parts.some(p => p.part)) continue;   // a note beside a ClinicalTrials.gov file's parts
      parts.push({ n: null, text: t, block: '' });
    }
    if (parts.some(p => p.part)) lines = parts.filter(p => p.part);
    else if (parts.length > 1 && parts.every(p => p.n != null)) lines = parts;
    else lines = parts.length ? [{ n: 1, text: parts.map(p => (p.n != null && parts.length === 1 ? p.text : p.n != null ? `${p.n} ${p.text}` : p.text)).join(' '), block: '' }] : [];
  }
  const numbered = lines.length > 1 && !lines.some(l => l.part);
  const dialect = dialectOf(source, lines.map(l => l.text).join('\n'));
  const problems = [], byN = new Map();
  for (const l of lines) {
    const m = LIMIT.exec(l.text);
    if (m) { l.limit = m[1]; l.text = l.text.slice(0, m.index); }
    if (!l.text.trim()) problems.push({ kind: 'empty-line', n: l.n, line: l.n });
    l.refs = numbered ? refsOf(l.text) : [];
    byN.set(l.n, l);
  }
  if (numbered) {
    for (const l of lines) for (const r of l.refs) {
      if (!byN.has(r)) problems.push({ kind: 'undefined-line', n: r, line: l.n });
      else if (r >= l.n) problems.push({ kind: 'forward-line', n: r, line: l.n });
    }
    const used = new Set(), walk = (n, seen = new Set()) => { if (seen.has(n)) return; seen.add(n); used.add(n); for (const r of byN.get(n)?.refs || []) walk(r, seen); };
    walk(lines.at(-1).n);
    for (const l of lines) if (!used.has(l.n)) problems.push({ kind: 'unused-line', n: l.n, line: lines.at(-1).n });
  }
  let query = '';
  if (lines.some(l => l.part)) query = lines.map(l => `(${l.text})`).join(' AND ');
  else if (numbered && !problems.some(p => p.kind === 'undefined-line' || p.kind === 'forward-line')) query = expand(lines.at(-1).n, byN);
  else query = lines.at(-1)?.text || '';
  return { dialect, lines, numbered, comments, query, problems };
}
/** The lines a line refers to: #3, Ovid's bare numbers in a line of only numbers and operators, or/1-5. */
function refsOf(text) {
  const out = new Set(), t = text.trim();
  for (const m of t.matchAll(/#(\d+)\b/g)) out.add(Number(m[1]));
  if (BOOL_OVID.test(t)) for (const m of t.matchAll(/\b(\d+)\b/g)) out.add(Number(m[1]));
  for (const m of t.matchAll(/\b(?:or|and)\/([\d\s,-]+)/gi)) for (const r of rangeList(m[1])) out.add(r);
  return [...out];
}
const rangeList = t => String(t).split(',').flatMap(p => { const [a, b] = p.split('-').map(x => Number(x.trim())); return Number.isFinite(b) ? Array.from({ length: Math.max(0, b - a + 1) }, (_, i) => a + i) : [a]; }).filter(Number.isFinite);
function expand(n, byN, seen = new Set()) {
  const l = byN.get(n);
  if (!l || seen.has(n)) return '';
  const next = new Set([...seen, n]);
  let t = l.text.trim();
  const combo = /^(or|and)\/([\d\s,-]+)$/i.exec(t);
  if (combo) return rangeList(combo[2]).map(r => `(${expand(r, byN, next)})`).join(` ${combo[1].toUpperCase()} `);
  if (BOOL_OVID.test(t)) t = t.replace(/\b(\d+)\b/g, (_, m) => `#${m}`);
  return t.replace(/#(\d+)\b/g, (_, m) => `(${expand(Number(m), byN, next)})`);
}

/** Every leaf term of a tree, with the field it is searched in and whether it sits in a proximity: [{ term, field, controlled, quoted, proximity, near }]. */
export function leaves(tree, inherited = '', near = false) {
  if (!tree) return [];
  if (tree.term != null) return [{ ...tree, field: tree.field || inherited || '', near }];
  return tree.children.flatMap(c => leaves(c, tree.field || inherited, near || tree.op === 'NEAR'));
}
