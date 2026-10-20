// A PubMed search strategy, rewritten for Web of Science Advanced Search and
// Scopus Advanced Search (plan B5, B6).
//
// The strategy is read into its structure by lib/boolean.mjs, and each term is
// given the field the target database has for it. Where the target has no
// equivalent — MeSH in Web of Science, subheadings, most publication types —
// the term is searched as free text and a note says so, because a translation
// that silently changes what a line retrieves is worse than none. Every group
// is parenthesised: PubMed reads mixed operators left to right, Web of Science
// and Scopus each apply their own precedence (Scopus applies AND NOT last).
import { parseQuery } from './boolean.mjs';

// PubMed tag -> the kind of field it names. Untagged terms are PubMed's
// automatic term mapping, closest to a topic search.
const KIND = {
  '': 'topic', all: 'topic', 'all fields': 'topic', tiab: 'topic', 'title/abstract': 'topic', tw: 'topic', 'text word': 'topic',
  ti: 'title', title: 'title',
  ab: 'abstract', abstract: 'abstract',
  mh: 'mesh', mesh: 'mesh', 'mesh terms': 'mesh', majr: 'mesh', 'mesh major topic': 'mesh',
  sh: 'subheading', 'mesh subheading': 'subheading', subheading: 'subheading',
  au: 'author', author: 'author', fau: 'author', 'full author name': 'author',
  ta: 'journal', jour: 'journal', journal: 'journal',
  pt: 'type', 'publication type': 'type',
  dp: 'year', pdat: 'year', 'publication date': 'year', 'date - publication': 'year',
  la: 'language', lang: 'language', language: 'language',
  ot: 'keyword', 'other term': 'keyword',
  doi: 'doi', aid: 'doi', lid: 'doi',
  pmid: 'pmid', uid: 'pmid',
  ad: 'affiliation', affiliation: 'affiliation',
};

const TARGETS = {
  wos: {
    name: 'Web of Science',
    code: { topic: 'TS', title: 'TI', abstract: 'AB', author: 'AU', journal: 'SO', keyword: 'AK', doi: 'DO', pmid: 'PMID',
      affiliation: 'AD', language: 'LA', year: 'PY', type: 'DT' },
    field: (code, inner) => `${code}=(${inner})`,
    near: n => ` NEAR/${n} `,
    not: ' NOT ',
    reserved: /^(AND|OR|NOT|NEAR(\/\d+)?|SAME)$/i,
    language: v => v.charAt(0).toUpperCase() + v.slice(1).toLowerCase(),
    types: { review: 'Review', 'journal article': 'Article', letter: 'Letter', editorial: 'Editorial Material', 'retracted publication': 'Retracted Publication' },
    year: (a, b) => ({ grouped: true, text: a === b ? String(a) : `${a}-${b}` }),
    notes: {
      topic: 'Title/abstract and untagged terms are searched as Topic (TS), which also covers author keywords and Keywords Plus.',
      mesh: 'Web of Science has no MeSH: MeSH terms are searched as Topic (TS) free text, without explosion.',
    },
  },
  scopus: {
    name: 'Scopus',
    code: { topic: 'TITLE-ABS-KEY', title: 'TITLE', abstract: 'ABS', author: 'AUTH', journal: 'SRCTITLE', keyword: 'AUTHKEY', doi: 'DOI',
      pmid: 'PMID', affiliation: 'AFFIL', language: 'LANGUAGE', year: 'PUBYEAR', type: 'DOCTYPE' },
    field: (code, inner) => `${code}(${inner})`,
    near: n => ` W/${n} `,
    not: ' AND NOT ',
    reserved: /^(AND|OR|NOT|W\/\d+|PRE\/\d+)$/i,
    language: v => v.toLowerCase(),
    types: { review: 're', 'journal article': 'ar', letter: 'le', editorial: 'ed', 'retracted publication': 'tb' },
    year: (a, b) => ({ grouped: false, text: a === b ? `PUBYEAR = ${a}` : `PUBYEAR > ${a - 1} AND PUBYEAR < ${b + 1}` }),
    notes: {
      topic: 'Title/abstract and untagged terms are searched as TITLE-ABS-KEY, which also covers author keywords and index terms.',
      mesh: 'MeSH terms are searched as TITLE-ABS-KEY free text; Scopus index terms include MeSH for MEDLINE records, without explosion.',
    },
  },
};

export const TRANSLATION_TARGETS = [...Object.keys(TARGETS), 'ovid-medline', 'ovid-embase', 'cinahl', 'cochrane'];
/** Each target's name as the interface writes it. */
export const TARGET_NAMES = { wos: 'Web of Science', scopus: 'Scopus', 'ovid-medline': 'MEDLINE (Ovid)', 'ovid-embase': 'Embase (Ovid)', cinahl: 'CINAHL (EBSCOhost)', cochrane: 'Cochrane Library (CENTRAL)' };

/** The field tag as written, lower-cased, with PubMed's :noexp dropped. */
const tagOf = field => String(field || '').trim().toLowerCase().replace(/:noexp$/, '');

/**
 * One term, as the target reads it: { kind, code, text, grouped } where
 * `grouped` says whether it may share a FIELD(...) block with its siblings.
 */
function leaf(n, t, note) {
  const tag = tagOf(n.field);
  let kind = KIND[tag];
  let term = n.term;
  if (!kind) { note(`Unknown field [${n.field}] searched as ${t.code.topic}.`); kind = 'topic'; }
  if (kind === 'mesh') {
    note(t.notes.mesh);
    if (term.includes('/')) { note('MeSH subheadings are dropped; only the heading is searched.'); term = term.split('/')[0]; }
    kind = 'topic';
  } else if (kind === 'subheading') {
    note(`Subheadings have no equivalent; [${n.field}] terms are searched as ${t.code.topic} free text.`);
    kind = 'topic';
  } else if (kind === 'topic' && tag !== '') note(t.notes.topic);
  else if (kind === 'topic') note(`Untagged terms are searched as ${t.code.topic}.`);

  if (kind === 'type') {
    const v = t.types[term.toLowerCase()];
    if (v) return { kind, code: t.code.type, text: v, grouped: true };
    note(`Publication type "${term}" has no ${t.name} document type; searched as ${t.code.topic} free text.`);
    kind = 'topic';
  }
  if (kind === 'year') {
    const m = /^(\d{4})(?:[/-]\d{1,2}(?:[/-]\d{1,2})?)?(?:\s*:\s*(\d{4})(?:[/-]\d{1,2}(?:[/-]\d{1,2})?)?)?$/.exec(term.trim());
    if (m) {
      if (/[/-]/.test(term)) note('Publication dates are reduced to years.');
      const a = +m[1], b = m[2] ? +m[2] : a;
      const y = t.year(Math.min(a, b), Math.max(a, b));
      return { kind, code: t.code.year, text: y.text, grouped: y.grouped };
    }
    note(`Date "${term}" not recognised; searched as ${t.code.topic}.`);
    kind = 'topic';
  }
  if (kind === 'language') return { kind, code: t.code.language, text: t.language(term), grouped: true };
  if (kind === 'doi' && !/^10\.\S+\/\S+/.test(term)) { note(`[${n.field}] value "${term}" is not a DOI; searched as ${t.code.topic}.`); kind = 'topic'; }
  if (kind === 'author') note('Author names are passed as written; check the name form the database expects.');

  const words = term.split(/\s+/).filter(Boolean);
  let text;
  if (n.proximity != null && words.length > 1) text = words.join(t.near(n.proximity));
  else if (words.length > 1 && kind !== 'author' && (n.phrase || tag !== '')) {
    if (!n.phrase) note('Tagged multi-word terms are searched as phrases.');
    text = `"${term}"`;
  } else if (n.phrase) text = `"${term}"`;
  else text = t.reserved.test(term) ? `"${term}"` : term;
  if (n.proximity != null && words.length < 2) note('Proximity on a single word has no effect and is dropped.');
  return { kind, code: t.code[kind], text, grouped: true };
}

/**
 * Translate a PubMed-syntax strategy. Returns { query, notes, errors }:
 * notes are what changed in meaning; errors are what the parser could not
 * read and a person must fix before the query is run.
 */
export function translateQuery(src, target) {
  if (EXT[target]) return translateExt(src, target);
  const t = TARGETS[target];
  if (!t) throw new Error(`unknown target ${target}`);
  const notes = [];
  const note = s => { if (!notes.includes(s)) notes.push(s); };
  const { tree, errors } = parseQuery(src);
  if (!tree) return { query: '', notes, errors: String(src || '').trim() ? ['nothing to translate', ...errors] : [] };

  // Every leaf once, so a node can tell whether all its terms share a field.
  const leaves = new Map();
  const visit = n => {
    if (!n) return;
    if (n.term != null) { leaves.set(n, leaf(n, t, note)); return; }
    if (n.mixed) note('Operators mixed without parentheses were read left to right; parentheses are added.');
    n.children.forEach(visit);
  };
  visit(tree);
  const codes = n => n.term != null ? [leaves.get(n)] : n.children.flatMap(codes);
  const uniform = n => {
    const ls = codes(n);
    return ls.length && ls.every(l => l.grouped && l.code === ls[0].code) ? ls[0].code : null;
  };
  // Inside a FIELD(...) block: the boolean structure, without field codes.
  const inner = n => {
    if (n.term != null) return leaves.get(n).text;
    if (n.op === 'NOT') return `NOT ${wrapInner(n.children[0])}`;
    return join(n, inner, wrapInner);
  };
  const wrapInner = n => n.term != null ? inner(n) : `(${inner(n)})`;
  // A child that is a single field block or term needs no parentheses.
  const atomic = n => n.term != null ? leaves.get(n).grouped : n.op === 'OR' && !!uniform(n);
  const emit = n => {
    if (n.term != null) {
      const l = leaves.get(n);
      return l.grouped ? t.field(l.code, l.text) : l.text;
    }
    // A concept (an OR block) shares one field block; concepts joined by AND
    // stay separate blocks, as a strategy is read line by line.
    const code = uniform(n);
    if (code && n.op === 'OR') return t.field(code, inner(n));
    if (n.op === 'NOT') return `NOT ${wrap(n.children[0])}`;
    return join(n, emit, wrap);
  };
  const wrap = n => atomic(n) ? emit(n) : `(${emit(n)})`;
  function join(n, self, wrapped) {
    const pos = n.children.filter(c => c.op !== 'NOT'), neg = n.children.filter(c => c.op === 'NOT');
    if (n.op !== 'AND' || !neg.length) return n.children.map(c => c.op === 'NOT' ? self(c) : (n.children.length > 1 ? wrapped(c) : self(c))).join(` ${n.op} `);
    if (!pos.length) { errors.push('a NOT with nothing before it'); return neg.map(self).join(' AND '); }
    return `${pos.map(c => pos.length > 1 ? wrapped(c) : self(c)).join(' AND ')}${neg.map(c => `${t.not}${wrapped(c.children[0])}`).join('')}`;
  }
  // A MeSH exclusion ("NOT animals[mh]") becomes a free-text exclusion, which
  // removes far more than the heading did.
  const meshNot = n => n && n.term == null && (n.op === 'NOT' ? codes(n).some(l => l && l.kind === 'topic') && hasMesh(n) : n.children.some(meshNot));
  const hasMesh = n => n.term != null ? KIND[tagOf(n.field)] === 'mesh' : n.children.some(hasMesh);
  if (meshNot(tree)) note('A MeSH exclusion is now a free-text exclusion; check that it removes only what you intend.');
  if (tree.op === 'NOT') errors.push('a NOT with nothing before it');
  const query = emit(tree);
  return { query, notes, errors: [...new Set(errors)] };
}

// ---- Ovid, EBSCOhost and the Cochrane Library ---------------------------------
// MEDLINE and Embase through Ovid, CINAHL through EBSCOhost, and CENTRAL
// through the Cochrane Library's advanced search (amendment "Workspace:
// backup, dashboard, tasks, timeline and translation"). These have no free
// API; the translation is text to paste.
//
// A MeSH heading is kept as written. Where the target's vocabulary is not
// MeSH (Emtree in Embase, CINAHL Subject Headings), no mapping is invented:
// the heading keeps its text, and the result lists it under `headings` with
// the marker "check heading" for the researcher to look up in that thesaurus.
// Ovid gives a numbered strategy (`lines`): one line per concept, the lines
// combined, then limits; its `query` is those lines, one per line, for
// Ovid's multi-line search. Proximity: PubMed's [tiab:~N] allows N words
// between the terms; Ovid's adjN allows N−1, so ~N is written adj(N+1).
// EBSCOhost's Nn and the Cochrane Library's NEAR/n are passed n as written.

const EXT = {
  'ovid-medline': { family: 'ovid', name: 'MEDLINE (Ovid)', vocab: '' },
  'ovid-embase': { family: 'ovid', name: 'Embase (Ovid)', vocab: 'Emtree' },
  cinahl: { family: 'ebsco', name: 'CINAHL (EBSCOhost)', vocab: 'CINAHL Subject Headings' },
  cochrane: { family: 'cochrane', name: 'Cochrane Library (CENTRAL)', vocab: '' },
};
export const CHECK_HEADING = 'check heading';

/** What a PubMed tag asks for, finer than KIND: untagged, tiab, tw and all fields differ in these targets. */
function classify(n) {
  const raw = String(n.field || '').trim().toLowerCase(), tag = tagOf(n.field);
  if (tag === '') return 'untagged';
  if (['tiab', 'title/abstract'].includes(tag)) return 'tiab';
  if (['tw', 'text word'].includes(tag)) return 'tw';
  if (['all', 'all fields'].includes(tag)) return 'all';
  const kind = KIND[tag];
  if (!kind) return 'unknown';
  if (kind === 'mesh') return /majr|major/.test(raw) ? 'major' : 'mesh';
  return kind;
}
const noexp = n => /:noexp$/i.test(String(n.field || '').trim());
const YEAR = /^(\d{4})(?:[/-]\d{1,2}(?:[/-]\d{1,2})?)?(?:\s*:\s*(\d{4})(?:[/-]\d{1,2}(?:[/-]\d{1,2})?)?)?$/;

const FAMILIES = {
  ovid: {
    and: ' and ', or: ' or ', not: 'not',
    reserved: /^(and|or|not|adj\d*)$/i,
    fields: { untagged: '.mp.', tiab: '.ti,ab.', tw: '.tw.', all: '.af.', title: '.ti.', abstract: '.ab.', author: '.au.', journal: '.jn.', type: '.pt.', language: '.lg.' },
    medlineOnly: { pmid: '.ui.', keyword: '.kf.' }, embaseOnly: { keyword: '.kw.' },
    field: (code, inner) => `${inner}${code}`,
    group: texts => `(${texts.join(' or ')})`,
    near: (words, n) => `(${words.join(` adj${n + 1} `)})`,
    heading: (h, { explode, major }) => `${explode ? 'exp ' : ''}${major ? '*' : ''}${h}/`,
    phrase: (term, words) => words.length > 1 ? term : term,
  },
  ebsco: {
    and: ' AND ', or: ' OR ', not: 'NOT',
    reserved: /^(AND|OR|NOT|N\d+|W\d+)$/i,
    fields: { untagged: '', tiab: 'TIAB', tw: 'TIAB', all: 'TX', title: 'TI', abstract: 'AB', author: 'AU', journal: 'SO', type: 'PT', language: 'LA' },
    field: (code, inner) => code === 'TIAB' ? `(TI ${inner} OR AB ${inner})` : code ? `${code} ${inner}` : inner,
    group: texts => `(${texts.join(' OR ')})`,
    near: (words, n) => `(${words.join(` N${n} `)})`,
    heading: (h, { explode, major }) => `(${major ? 'MM' : 'MH'} "${h}${explode ? '+' : ''}")`,
  },
  cochrane: {
    and: ' AND ', or: ' OR ', not: 'NOT',
    reserved: /^(AND|OR|NOT|NEAR(\/\d+)?|NEXT)$/i,
    fields: { untagged: ':ti,ab,kw', tiab: ':ti,ab,kw', tw: ':ti,ab,kw', all: '', title: ':ti', abstract: ':ab', keyword: ':kw', author: ':au', journal: ':so', type: ':pt' },
    field: (code, inner) => `${inner}${code}`,
    group: texts => `(${texts.join(' OR ')})`,
    near: (words, n) => `(${words.join(` NEAR/${n} `)})`,
    heading: (h, { explode }) => `[mh ${explode ? '' : '^'}${/\s/.test(h) ? `"${h}"` : h}]`,
  },
};

function extLeaf(n, target, F, note, headings) {
  const cfg = EXT[target], fam = cfg.family;
  let kind = classify(n);
  let term = n.term;
  const words = term.split(/\s+/).filter(Boolean);
  const drop = (why) => { note(why); return { drop: true }; };
  if (kind === 'unknown') { note(`Unknown field [${n.field}] searched as ${fam === 'ovid' ? 'multi-purpose (.mp.)' : fam === 'ebsco' ? 'the default fields' : 'title, abstract and keywords'}.`); kind = fam === 'ovid' || fam === 'ebsco' ? 'untagged' : 'tiab'; }
  if (kind === 'mesh' || kind === 'major') {
    if (term.includes('/')) { note('MeSH subheadings are dropped; only the heading is searched.'); term = term.split('/')[0]; }
    const explode = !noexp(n), major = kind === 'major';
    if (fam === 'cochrane' && major) note('The Cochrane Library searches MeSH without a major-topic restriction; [majr] is searched as the heading.');
    if (cfg.vocab) {
      headings.push({ heading: term, vocabulary: cfg.vocab, marker: CHECK_HEADING });
      note(`MeSH is not ${cfg.vocab}: each heading is kept as written and marked "${CHECK_HEADING}"; look it up in ${cfg.vocab} before running.`);
    }
    return { standalone: F.heading(term, { explode, major }), kind: 'heading' };
  }
  if (kind === 'subheading') { note(`Subheadings have no equivalent here; [${n.field}] terms are searched as free text.`); kind = fam === 'cochrane' ? 'tiab' : 'untagged'; }
  if (kind === 'year') {
    const m = YEAR.exec(term.trim());
    if (!m) { note(`Date "${term}" not recognised; searched as free text.`); kind = fam === 'cochrane' ? 'tiab' : 'untagged'; }
    else {
      if (/[/-]/.test(term)) note('Publication dates are reduced to years.');
      const a = Math.min(+m[1], +(m[2] || m[1])), b = Math.max(+m[1], +(m[2] || m[1]));
      return { limit: { kind: 'year', from: a, to: b, text: a === b ? String(a) : `${a}-${b}` } };
    }
  }
  if (kind === 'language') return { limit: { kind: 'language', text: term.toLowerCase() } };
  if (kind === 'type') {
    if (fam === 'ovid' && target === 'ovid-embase') note('Embase publication types differ from MEDLINE’s; check each [pt] value.');
    if (fam === 'ebsco') note('CINAHL publication types differ from MEDLINE’s; check each PT value.');
  }
  if (kind === 'author') note('Author names are passed as written; check the name form the database expects.');
  let code = F.fields[kind];
  if (fam === 'ovid' && code === undefined) code = (target === 'ovid-medline' ? F.medlineOnly : F.embaseOnly)[kind];
  if (fam === 'ebsco' && kind === 'keyword') code = undefined;
  if (code === undefined) {
    note(`[${n.field}] has no field mapped here; searched as ${fam === 'ovid' ? 'multi-purpose (.mp.)' : fam === 'ebsco' ? 'the default fields' : 'title, abstract and keywords'}.`);
    kind = fam === 'cochrane' ? 'tiab' : 'untagged';
    code = F.fields[kind];
  }
  if (fam === 'ovid' && kind === 'untagged') note('Untagged terms (PubMed’s automatic term mapping) are searched in Ovid’s multi-purpose field (.mp.), without mapping to headings.');
  if (fam === 'ebsco' && kind === 'untagged') note('Untagged terms are searched in EBSCOhost’s default fields.');
  if (fam === 'ebsco' && (kind === 'tiab' || kind === 'tw')) note('CINAHL has no combined title/abstract field; each is searched as TI … OR AB ….');
  if (fam === 'cochrane' && ['untagged', 'tiab', 'tw'].includes(kind)) note('Title/abstract and untagged terms are searched in title, abstract and keywords (:ti,ab,kw).');
  if (kind === 'tw' && fam !== 'ovid') note('Text word [tw] is searched as title and abstract.');

  let text;
  if (n.proximity != null && words.length > 1) {
    text = F.near(words, n.proximity);
    note(fam === 'ovid' ? 'PubMed [tiab:~N] allows N words between terms; Ovid adjN allows N−1, so adj(N+1) is written.' : `Proximity is written ${fam === 'ebsco' ? 'Nn' : 'NEAR/n'} with PubMed’s n; check the database’s own definition of the distance.`);
  } else {
    if (n.proximity != null) note('Proximity on a single word has no effect and is dropped.');
    const multi = words.length > 1;
    if (fam === 'ovid') {
      text = F.reserved.test(term) ? `"${term}"` : term;
      if (multi && !n.phrase && kind === 'untagged') note('Adjacent words are searched as a phrase in Ovid.');
    } else if (multi && kind !== 'author' && (n.phrase || kind !== 'untagged')) {
      if (!n.phrase) note('Tagged multi-word terms are searched as phrases.');
      text = `"${term}"`;
    } else if (multi && !n.phrase && fam === 'cochrane') {
      note('Unquoted words are searched together, each anywhere in the field, not as a phrase.');
      text = `(${term})`;
    } else text = n.phrase ? `"${term}"` : F.reserved.test(term) ? `"${term}"` : term;
  }
  return { code, text, kind };
}

function translateExt(src, target) {
  const cfg = EXT[target], F = FAMILIES[cfg.family], ovid = cfg.family === 'ovid';
  const notes = [], headings = [], limits = [];
  const note = s => { if (s && !notes.includes(s)) notes.push(s); };
  const { tree, errors } = parseQuery(src);
  if (!tree) return { query: '', notes, errors: String(src || '').trim() ? ['nothing to translate', ...errors] : [], headings, limits, ...(ovid ? { lines: [] } : {}) };
  const leaves = new Map();
  const visit = n => {
    if (!n) return;
    if (n.term != null) { leaves.set(n, extLeaf(n, target, F, note, headings)); return; }
    if (n.mixed) note('Operators mixed without parentheses were read left to right; parentheses are added.');
    n.children.forEach(visit);
  };
  visit(tree);
  // A limit (years, language) is not a term: at the top level it becomes a
  // limit line in Ovid or a limiter to set elsewhere; inside a group it is said.
  const topLimits = new Set();
  const top = tree.term == null && tree.op === 'AND' && !tree.mixed ? tree.children : [tree];
  for (const c of top) if (c.term != null && leaves.get(c).limit) { topLimits.add(c); limits.push(leaves.get(c).limit); }
  const live = n => n.term != null ? !leaves.get(n).limit && !leaves.get(n).drop : n.children.some(live);
  const nested = n => { if (n.term != null) { if (leaves.get(n).limit && !topLimits.has(n)) note('A date or language limit inside a group is left out; apply it as a limit.'); return; } n.children.forEach(nested); };
  nested(tree);

  const mergeable = n => n.term != null && leaves.get(n).code != null && !leaves.get(n).standalone && !leaves.get(n).limit;
  const atomic = n => n.term != null || (n.op !== 'NOT' && n.children.filter(live).length === 1 && atomic(n.children.filter(live)[0])) || (n.op === 'OR' && n.children.filter(live).every(c => mergeable(c) && leaves.get(c).code === leaves.get(n.children.filter(live)[0]).code));
  const leafOut = n => { const l = leaves.get(n); return l.standalone ?? F.field(l.code, l.text); };
  const emit = n => {
    if (n.term != null) return leafOut(n);
    const kids = n.children.filter(live);
    if (n.op === 'NOT') return `${F.not} ${wrap(kids[0])}`;
    if (n.op === 'OR') {
      // Terms searched in the same field share one block, where they first appear.
      const parts = [], groups = new Map();
      for (const c of kids) {
        if (mergeable(c)) {
          const code = leaves.get(c).code;
          if (!groups.has(code)) { groups.set(code, []); parts.push({ code }); }
          groups.get(code).push(leaves.get(c).text);
        } else parts.push({ text: kids.length > 1 ? wrap(c) : emit(c) });
      }
      return parts.map(p => p.text ?? F.field(p.code, groups.get(p.code).length > 1 ? F.group(groups.get(p.code)) : groups.get(p.code)[0])).join(F.or);
    }
    const pos = kids.filter(c => c.op !== 'NOT'), neg = kids.filter(c => c.op === 'NOT');
    if (!pos.length && neg.length) { errors.push('a NOT with nothing before it'); }
    // Positive terms are bracketed before an exclusion: precedence differs between these databases.
    const joined = pos.map(c => pos.length > 1 ? wrap(c) : emit(c)).join(F.and);
    return `${pos.length > 1 && neg.length ? `(${joined})` : joined}${neg.map(c => ` ${F.not} ${wrap(c.children[0])}`).join('')}`;
  };
  const wrap = n => atomic(n) ? emit(n) : `(${emit(n)})`;
  if (tree.op === 'NOT') errors.push('a NOT with nothing before it');
  const meshNot = n => n && n.term == null && (n.op === 'NOT' ? hasHeading(n) : n.children.some(meshNot));
  const hasHeading = n => n.term != null ? leaves.get(n).kind === 'heading' : n.children.some(hasHeading);
  if (cfg.vocab && meshNot(tree)) note(`An exclusion by heading depends on the ${cfg.vocab} heading chosen; check it removes only what you intend.`);

  const limitText = l => l.kind === 'year' ? (l.from === l.to ? `Publication year ${l.from}` : `Publication years ${l.from}–${l.to}`) : `Language: ${l.text}`;
  if (!ovid) {
    const body = top.filter(c => !topLimits.has(c) && live(c));
    const query = tree.term == null && tree.op === 'AND' && !tree.mixed
      ? emit({ ...tree, children: body })
      : live(tree) ? emit(tree) : '';
    for (const l of limits) note(`${limitText(l)} is not part of the search string; set it with the ${cfg.family === 'ebsco' ? 'EBSCOhost limiters' : 'Search Manager limits'}.`);
    return { query, notes, errors: [...new Set(errors)], headings, limits: limits.map(limitText) };
  }
  // Ovid: one numbered line per concept, the combination, then each limit.
  const lines = [];
  const pos = [], neg = [];
  const concepts = tree.term == null && tree.op === 'AND' && !tree.mixed ? top : [tree];
  for (const c of concepts) {
    if (topLimits.has(c) || !live(c)) continue;
    if (c.op === 'NOT') { lines.push(emit(c.children[0])); neg.push(lines.length); }
    else { lines.push(emit(c)); pos.push(lines.length); }
  }
  if (pos.length + neg.length > 1) {
    const p = pos.join(' and '), q = neg.length > 1 ? `(${neg.join(' or ')})` : String(neg[0] || '');
    lines.push(neg.length ? `${pos.length > 1 ? `(${p})` : p} not ${q}` : p);
  }
  for (const l of limits) {
    if (!lines.length) break;
    lines.push(`limit ${lines.length} to ${l.kind === 'year' ? `yr="${l.text}"` : `${l.text} language`}`);
  }
  return { query: lines.join('\n'), lines, notes, errors: [...new Set(errors)], headings, limits: limits.map(limitText) };
}
