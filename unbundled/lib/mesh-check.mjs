// MeSH headings checked at NLM (6 Nov 2026; plan §B, "Search sets"). A strategy's [Mesh], [mh] and [majr] terms are read with
// lib/query-syntax.mjs and looked up in NLM's MeSH database through E-utilities (db=mesh), the host the PubMed connector already
// reaches, paced by lib/limiter.mjs: no new host leaves the machine and only the headings are sent. Each heading is one of:
// - a descriptor (its name is the heading's preferred term), with its unique id (D010300) and tree numbers;
// - an entry term only: PubMed maps it to the descriptor it belongs to, which the strategy should name instead;
// - not found: PubMed finds nothing for it.
// A descriptor that has headings below it in the tree is exploded by [Mesh]; its children and how many headings sit below it are
// read from its tree numbers (`C10.228.140.079.862*[TN]`). Measured 6 Nov 2026: `"Parkinson's disease"[MH]` in db=mesh finds
// D010300 Parkinson Disease (entry terms match), an unquoted `Sham Treatment[MH]` was remapped by automatic term mapping to
// "placebos", so every heading is sent quoted, and `C10.228.140.079.862*[TN]` answers the 6 records of that subtree.
// Results are kept in the project (`s.meshChecks`, by normalized heading) with the date of the check; a heading never checked,
// or checked while offline, reads "not checked".
import { parseStrategy, parseQuery, leaves } from './query-syntax.mjs';

const MESH_FIELD = /^(mh|mesh|mesh terms|majr|mesh major topic)(\s*:\s*noexp)?$/i;
/** The dialects whose controlled vocabulary is MeSH (Embase's Emtree and Ovid's unnamed headings are not looked up). */
const MESH_DIALECTS = new Set(['pubmed', 'cochrane', '']);

/** A heading as NLM matches it: case, accents, apostrophes, hyphens and commas aside ("Parkinson's Disease" = "parkinson s disease"). */
export const normHeading = t => String(t ?? '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/**
 * The MeSH headings a strategy searches, once each in the order written: [{ heading, written, subheading, major, explode, line }].
 * A numbered strategy is read line by line; "Pain/surgery"[Mesh] is the heading Pain with the subheading surgery; a heading with a
 * wildcard is left out (MeSH is not truncated).
 */
export function meshTerms(query, { source = '' } = {}) {
  const st = parseStrategy(String(query ?? ''), { source });
  if (!MESH_DIALECTS.has(st.dialect || '')) return [];
  const out = new Map();
  for (const l of st.lines) {
    const tree = parseQuery(l.text, { dialect: st.dialect || 'pubmed' }).tree;
    for (const leaf of leaves(tree)) {
      if (!leaf.controlled || leaf.ref != null || !MESH_FIELD.test(String(leaf.field || ''))) continue;
      const written = String(leaf.term || '').trim(), [head, sub = ''] = written.split('/');
      const heading = head.trim();
      if (!heading || heading.includes('*')) continue;
      const key = normHeading(heading);
      if (!out.has(key)) out.set(key, { heading, written, subheading: sub.trim(), major: /^(majr|mesh major topic)/i.test(leaf.field), explode: !/noexp/i.test(leaf.field) && leaf.explode !== false, line: st.numbered ? l.n : null });
    }
  }
  return [...out.values()];
}

// ---- the lookup -----------------------------------------------------------------------------------------------------------------

const BATCH = 40;      // headings ORed into one esearch
const SUMMARY = 200;   // ids to one esummary
const quoted = h => `"${String(h).replace(/"/g, '')}"[MH]`;
const chunks = (xs, n) => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n));

/**
 * Looks headings up at NLM. `eutils(tool, params)` answers E-utilities JSON for a tool ('esearch', 'esummary') and its parameters
 * (lib/sources.mjs eutilsJson in the app, a stub in the tests). Answers [{ heading, key, status, ui, name, trees, children, below,
 * at, error? }]: status 'descriptor' | 'entry' | 'missing' | 'unchecked' (the lookup failed: offline, or NLM did not answer);
 * `name` and `ui` are the descriptor's (for an entry term, the descriptor PubMed maps it to); `children` the names of the headings
 * directly below it, `below` how many headings its explosion adds.
 */
export async function lookupMesh(headings, { eutils, at = new Date().toISOString().slice(0, 10) } = {}) {
  const wanted = [...new Map((headings || []).map(h => (typeof h === 'string' ? h : h.heading)).filter(Boolean).map(h => [normHeading(h), h])).entries()];
  const results = new Map(wanted.map(([key, heading]) => [key, { heading, key, status: 'unchecked', at }]));
  if (!wanted.length) return [];
  const records = new Map();   // uid -> esummary record
  const summarise = async uids => {
    for (const part of chunks(uids.filter(u => !records.has(String(u))), SUMMARY)) {
      if (!part.length) continue;
      const r = await eutils('esummary', { db: 'mesh', id: part.join(',') });
      for (const u of r?.result?.uids || []) records.set(String(u), r.result[u]);
    }
  };
  const termsOf = rec => (rec?.ds_meshterms || []).map(String);
  const isDescriptor = rec => String(rec?.ds_recordtype || 'descriptor') === 'descriptor';
  const fill = (res, rec) => {
    const name = termsOf(rec)[0] || '';
    Object.assign(res, { status: normHeading(name) === res.key && isDescriptor(rec) ? 'descriptor' : 'entry', ui: String(rec.ds_meshui || ''), name, uid: String(rec.uid || ''),
      trees: (rec.ds_idxlinks || []).map(x => String(x.treenum || '')).filter(Boolean), childIds: [...new Set((rec.ds_idxlinks || []).flatMap(x => (x.children || []).map(String)))] });
  };
  try {
    // 1. every heading in a few ORed searches; each record found is matched back to the headings among its terms
    for (const part of chunks(wanted, BATCH)) {
      const r = await eutils('esearch', { db: 'mesh', term: part.map(([, h]) => quoted(h)).join(' OR '), retmax: '500' });
      if (r?.esearchresult?.ERROR) throw new Error(String(r.esearchresult.ERROR));
      await summarise(r?.esearchresult?.idlist || []);
    }
    const byTerm = new Map();
    for (const rec of records.values()) for (const t of termsOf(rec)) { const k = normHeading(t), was = byTerm.get(k); if (!was || (!isDescriptor(was) && isDescriptor(rec))) byTerm.set(k, rec); }
    // 2. a heading no record listed is asked alone: NLM may match it in a way the normalization does not; none found is missing
    for (const [key, heading] of wanted) {
      const res = results.get(key), rec = byTerm.get(key);
      if (rec) { fill(res, rec); continue; }
      const r = await eutils('esearch', { db: 'mesh', term: quoted(heading), retmax: '5' });
      if (r?.esearchresult?.ERROR) throw new Error(String(r.esearchresult.ERROR));
      const ids = r?.esearchresult?.idlist || [];
      if (!ids.length) { Object.assign(res, { status: 'missing' }); continue; }
      await summarise(ids);
      const recs = ids.map(u => records.get(String(u))).filter(Boolean), pick = recs.find(isDescriptor) || recs[0];
      if (pick) { fill(res, pick); if (res.status === 'descriptor' && normHeading(res.name) !== key) res.status = 'entry'; } else Object.assign(res, { status: 'missing' });
    }
    // 3. what each descriptor's explosion adds: its children by name, and the count of its subtree from its tree numbers
    const exploding = [...results.values()].filter(r => r.childIds?.length);
    await summarise([...new Set(exploding.flatMap(r => r.childIds))]);
    for (const res of exploding) {
      res.children = res.childIds.map(u => termsOf(records.get(u))[0]).filter(Boolean).sort((a, b) => a.localeCompare(b));
      const r = await eutils('esearch', { db: 'mesh', term: res.trees.map(t => `${t}*[TN]`).join(' OR '), retmax: '0' });
      const n = Number(r?.esearchresult?.count);
      res.below = Number.isFinite(n) && n > 0 ? n - 1 : res.children.length;
    }
  } catch (err) {
    // offline or refused: what was read stays, the rest reads "not checked" with the reason
    for (const res of results.values()) if (res.status === 'unchecked' || (res.childIds?.length && res.below == null)) res.error = String(err?.message || err).slice(0, 160);
  }
  // a heading with nothing below it explodes to nothing; one whose explosion was not read (the lookup stopped) says so with null
  return [...results.values()].map(({ childIds, ...res }) => {
    if (res.status !== 'descriptor' && res.status !== 'entry') return res;
    const leaf = !childIds?.length;
    return { ...res, children: leaf ? [] : res.children ?? null, below: leaf ? 0 : res.below ?? null };
  });
}

/** The E-utilities fetcher of the app: lib/sources.mjs, loaded with the first check (it carries the connectors). */
export const nlmEutils = ({ settings, signal } = {}) => async (tool, params) => (await import('./sources.mjs')).eutilsJson(tool, params, { settings, signal });

// ---- the project's cache ------------------------------------------------------------------------------------------------------

/** The project's checked headings, by normalized heading: { [key]: result }. */
export const meshCache = s => (s?.meshChecks && typeof s.meshChecks === 'object' ? s.meshChecks : {});
/** Keeps lookup results in the project: a result that did not reach NLM never replaces one that did. */
export function storeMesh(s, results) {
  const cache = { ...meshCache(s) };
  for (const r of results || []) {
    if (!r?.key) continue;
    const was = cache[r.key];
    if (r.status === 'unchecked' && was && was.status !== 'unchecked') continue;
    // an explosion not read this time keeps the one read before for the same descriptor
    cache[r.key] = r.below == null && was?.below != null && was.ui && was.ui === r.ui ? { ...r, children: was.children, below: was.below } : r;
  }
  s.meshChecks = cache;
  return s;
}
/** The cached result of a heading, or a "not checked" one. */
export const meshOf = (cache, heading) => cache?.[normHeading(heading)] || { heading, key: normHeading(heading), status: 'unchecked' };

/** A strategy's headings and their state: { terms: [result + written], counts: { descriptor, entry, missing, unchecked }, at } (`at`: the oldest check). */
export function meshState(query, cache, { source = '' } = {}) {
  const terms = meshTerms(query, { source }).map(t => ({ ...meshOf(cache, t.heading), written: t.written, heading: t.heading, explode: t.explode }));
  const counts = { descriptor: 0, entry: 0, missing: 0, unchecked: 0 };
  for (const t of terms) counts[t.status in counts ? t.status : 'unchecked']++;
  const dates = terms.filter(t => t.status !== 'unchecked' && t.at).map(t => t.at).sort();
  return { terms, counts, at: dates[0] || '' };
}
/** One short phrase for a state: "12 descriptors", "11 descriptors, 1 entry term", "3 not checked", "No MeSH". */
export function meshPhrase({ counts }) {
  const n = (k, one, many) => (counts[k] ? `${counts[k]} ${counts[k] === 1 ? one : many}` : '');
  const parts = [n('missing', 'not found', 'not found'), n('entry', 'entry term', 'entry terms'), n('descriptor', 'descriptor', 'descriptors'), n('unchecked', 'not checked', 'not checked')].filter(Boolean);
  return parts.length ? parts.join(', ') : 'No MeSH';
}

const dayOf = d => String(d || '').slice(0, 10);   // as lib/query-check.mjs dates a run: 2026-11-06
const listOf = (xs, n = 6) => (xs.length > n ? `${xs.slice(0, n).join(', ')} and ${xs.length - n} more` : xs.length > 1 ? `${xs.slice(0, -1).join(', ')} and ${xs.at(-1)}` : xs.join(''));

/**
 * The problems the cached check finds in a strategy, worded for lib/query-check.mjs: [{ id: 'mesh', level, text }]. A heading not
 * found is an error, an entry term a warning, headings never checked one note; `explosions` adds a note for each exploded heading
 * with headings below it.
 */
export function meshProblems(query, cache, { source = '', explosions = false } = {}) {
  const { terms } = meshState(query, cache, { source }), out = [];
  for (const t of terms) {
    const when = t.at ? ` (NLM, ${dayOf(t.at)})` : '';
    if (t.status === 'missing') out.push({ id: 'mesh', level: 'error', text: `"${t.heading}"[Mesh] is not a MeSH heading${when}: PubMed finds nothing for it. Check its spelling in the MeSH Browser.` });
    else if (t.status === 'entry') out.push({ id: 'mesh', level: 'warn', text: `"${t.heading}"[Mesh] is an entry term of ${t.name} (${t.ui})${when}: write "${t.name}"[Mesh], the heading PubMed searches.` });
    else if (explosions && t.status === 'descriptor' && t.explode && t.below) out.push({ id: 'mesh-explode', level: 'note', text: `"${t.heading}"[Mesh] also searches ${t.below === 1 ? 'the heading' : `the ${t.below} headings`} below it: ${listOf(t.children || [])}${(t.children || []).length < t.below ? ' and theirs' : ''}.` });
  }
  const unchecked = terms.filter(t => t.status === 'unchecked');
  if (unchecked.length) out.push({ id: 'mesh', level: 'note', text: `${unchecked.length === 1 ? 'One MeSH heading' : `${unchecked.length} MeSH headings`} not checked against NLM: ${listOf(unchecked.map(t => t.heading), 4)}.` });
  const rank = { error: 0, warn: 1, note: 2 };
  return out.sort((a, b) => rank[a.level] - rank[b.level]);
}
