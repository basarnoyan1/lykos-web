// A query built from blocks (7 Nov 2026; the query visualizer's builder, query.html). The owner: "the page should have a query builder as
// well, from the included website styles". A search is its concepts joined by AND, each concept its words (searched in one field) and
// its subject headings, and the concepts a NOT takes away; it is written in each database's own syntax. PubMed's is written here; Web of
// Science's, Scopus's, the Cochrane Library's and Ovid's are lib/query-translate.mjs's translation of it, so what a database has no field
// for is said in a note, never changed silently. Europe PMC's and ClinicalTrials.gov's are written here from the same concepts.
import { translateQuery } from './query-translate.mjs';
import { writeBlock } from './query-text.mjs';

/** The fields a concept's words can be searched in, as PubMed tags them. */
export const WORD_FIELDS = Object.freeze([['tiab', 'Title, abstract'], ['ti', 'Title'], ['tw', 'Text words'], ['all', 'All fields']]);
/** The databases a built query is written for: [key, name]. */
export const BUILD_TARGETS = Object.freeze([['pubmed', 'PubMed'], ['scopus', 'Scopus'], ['wos', 'Web of Science'], ['cochrane', 'Cochrane CENTRAL'],
  ['epmc', 'Europe PMC'], ['ctgov', 'ClinicalTrials.gov'], ['ovid-medline', 'MEDLINE (Ovid)'], ['ovid-embase', 'Embase (Ovid)']]);

/** A box of terms as a list: one a line (or between semicolons), blank ones left out. */
export const termList = s => String(s ?? '').split(/\r?\n|;/).map(x => x.trim()).filter(Boolean);
// a term as typed, in quotes when it is a phrase (or holds a character the syntax reads) and is not quoted already
const phrase = t => (/^".*"$/.test(t) ? t : /[\s()/,:[\]]/.test(t) ? `"${t.replace(/"/g, '')}"` : t);
const heading = h => `"${h.replace(/^"|"$/g, '').replace(/"/g, '')}"`;
const any = parts => (parts.length > 1 ? `(${parts.join(' OR ')})` : parts[0] || '');
// the concepts kept and those taken away, each as its database writes a group; '' when no concept has a term
function joined(concepts, group) {
  const yes = concepts.filter(c => !c.not).map(group).filter(Boolean), no = concepts.filter(c => c.not).map(group).filter(Boolean);
  return yes.length ? [yes.join(' AND '), ...no].join(' NOT ') : '';
}

/** Concepts [{ words, field, headings, not }] as PubMed writes them: (a[tiab] OR "b c"[tiab] OR "H"[Mesh]) AND (…) NOT (…). */
export function pubmedQuery(concepts = []) {
  return joined(concepts, c => {
    const tag = c.field === 'all' ? '' : `[${WORD_FIELDS.some(f => f[0] === c.field) ? c.field : 'tiab'}]`;
    return any([...termList(c.words).map(w => `${phrase(w)}${tag}`), ...termList(c.headings).map(h => `${heading(h)}[Mesh]`)]);
  });
}

/** The query for one database: { query, notes } (notes: what that database searches differently from what was built). */
export function buildQuery(concepts = [], target = 'pubmed') {
  const pubmed = pubmedQuery(concepts);
  if (!pubmed || target === 'pubmed') return { query: pubmed, notes: [] };
  const headings = concepts.some(c => termList(c.headings).length);
  if (target === 'epmc') {
    const query = joined(concepts, c => {
      const words = [...termList(c.words), ...termList(c.headings)].map(phrase);
      if (!words.length) return '';
      const inner = words.length > 1 ? `(${words.join(' OR ')})` : words[0];
      return c.field === 'ti' ? `TITLE:${inner}` : c.field === 'tiab' || !c.field ? `(TITLE:${inner} OR ABSTRACT:${inner})` : any(words);
    });
    return { query, notes: headings ? ['Europe PMC: subject headings are searched as words, in the field of their concept.'] : [] };
  }
  if (target === 'ctgov') {
    const query = joined(concepts, c => any([...termList(c.words), ...termList(c.headings)].map(phrase)));
    return { query, notes: ['ClinicalTrials.gov has no title or abstract field: every term is searched in the whole record.'] };
  }
  const r = translateQuery(pubmed, target);
  return { query: r.query || '', notes: [...(r.notes || []), ...(r.errors || [])] };
}

// ---- the builder's blocks (8 Nov 2026: the owner, "there could be a gallery of blocks and we could build the query") -------------------
// The search is a tree of lib/query-blocks.mjs's nodes (All of, Any of, But not, terms), PubMed's fields on its terms; a group may be
// empty and a term blank while it is being built, and neither is written. PubMed's query is written from it (lib/query-text.mjs), the other
// databases' as before: translated from PubMed's, Europe PMC's and ClinicalTrials.gov's written here.

/** The fields a term of the builder searches: [PubMed tag, the block's label, the gallery's name]; '' is all fields. */
export const BUILD_FIELDS = Object.freeze([['tiab', 'Title, abstract', 'Word in title or abstract'], ['ti', 'Title', 'Word in title'],
  ['tw', 'Text words', 'Text word'], ['', 'All fields', 'Word in any field'], ['Mesh', 'MeSH', 'MeSH heading']]);
const fieldOf = f => BUILD_FIELDS.find(x => x[0] === f) || BUILD_FIELDS[0];
/** A term of the builder: blank until typed in. */
export const buildTerm = (field = 'tiab', text = '') => ({ kind: 'term', text, field: fieldOf(field)[0], label: fieldOf(field)[1], quoted: false, controlled: field === 'Mesh' });
/** A group of the builder (all, any or not), empty. */
export const buildGroup = kind => ({ kind, items: [] });
/** The search a builder starts with: two concepts, each a blank word. */
export const startTree = () => ({ kind: 'all', items: [{ kind: 'any', items: [buildTerm()] }, { kind: 'any', items: [buildTerm()] }] });

/** The concepts an earlier builder kept ([{ words, field, headings, not }]) as a tree: a concept taken away is a But not holding its terms. */
export function conceptsTree(concepts = []) {
  const terms = c => [...termList(c.words).map(w => buildTerm(c.field === 'all' ? '' : c.field, w)), ...termList(c.headings).map(h => buildTerm('Mesh', h))];
  return { kind: 'all', items: [...concepts.filter(c => !c.not).map(c => ({ kind: 'any', items: terms(c) })), ...concepts.filter(c => c.not).map(c => ({ kind: 'not', items: terms(c) }))] };
}

/**
 * A tree kept by the builder before But not was a block (8 Nov 2026), in today's shape: what an All of's second mouth (`not`) took away
 * is a But not for each thing, after what the All of keeps, an Any of's terms held directly (NOT (x OR y) is one But not of x and y).
 */
export function upgradeTree(b) {
  if (!b || typeof b !== 'object' || !Array.isArray(b.items)) return b;
  const { not, ...rest } = b;
  const away = (Array.isArray(not) ? not : []).map(upgradeTree).filter(Boolean).map(x => ({ kind: 'not', items: x.kind === 'any' ? x.items : [x] }));
  return { ...rest, items: [...b.items.map(upgradeTree), ...away] };
}

// the tree as it is written: blank terms and empty groups left out, a group of one that one (but a But not stays one), a term's quotes its
// own; an All of that keeps nothing is not written, with what it takes away
function tidy(b) {
  if (!b) return null;
  if (b.kind === 'term') {
    const t = String(b.text || '').trim().replace(/^"(.*)"$/, '$1').replace(/"/g, '');
    return t ? { ...b, text: t, quoted: b.controlled || /[\s()/,:[\]]/.test(t) } : null;
  }
  const items = (b.items || []).map(tidy).filter(Boolean);
  if (b.kind === 'not') return items.length ? { ...b, items } : null;
  if (!items.some(x => x.kind !== 'not')) return null;
  return items.length === 1 ? items[0] : { ...b, items };
}
// Europe PMC: a title-or-abstract word is searched in TITLE and in ABSTRACT, a group's such words opened once in each (a But not's mouth
// is any of what it holds)
function toEpmc(b) {
  if (b.kind === 'term') {
    if (b.field === 'ti') return { ...b, field: 'TITLE' };
    if (b.field === 'tiab') return { kind: 'any', items: [{ ...b, field: 'TITLE' }, { ...b, field: 'ABSTRACT' }] };
    return { ...b, field: '', controlled: false };
  }
  if (b.kind === 'any' || b.kind === 'not') {
    const tiab = b.items.filter(x => x.kind === 'term' && x.field === 'tiab'), rest = b.items.filter(x => !tiab.includes(x)).map(toEpmc);
    const opened = tiab.length > 1 ? [{ kind: 'any', items: tiab.map(x => ({ ...x, field: 'TITLE' })) }, { kind: 'any', items: tiab.map(x => ({ ...x, field: 'ABSTRACT' })) }] : tiab.map(toEpmc);
    return { ...b, items: [...opened, ...rest] };
  }
  return { ...b, items: b.items.map(toEpmc) };
}
const bare = b => (b.kind === 'term' ? { ...b, field: '', controlled: false } : { ...b, items: b.items.map(bare) });
const hasHeading = b => (b.kind === 'term' ? b.controlled : b.items.some(hasHeading));

/** The builder's tree written for `target`: { query, notes } ('' when nothing is typed yet). */
export function treeQuery(tree, target = 'pubmed') {
  const t = tidy(tree);
  if (!t) return { query: '', notes: [] };
  const pubmed = writeBlock(t, 'pubmed');
  if (target === 'pubmed') return { query: pubmed, notes: [] };
  if (target === 'epmc') return { query: writeBlock(toEpmc(t), 'epmc'), notes: hasHeading(t) ? ['Europe PMC: subject headings are searched as words, in any field.'] : [] };
  if (target === 'ctgov') return { query: writeBlock(bare(t), 'ctgov'), notes: ['ClinicalTrials.gov has no title or abstract field: every term is searched in the whole record.'] };
  const r = translateQuery(pubmed, target);
  return { query: r.query || '', notes: [...(r.notes || []), ...(r.errors || [])] };
}
