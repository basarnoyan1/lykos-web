// Fixes for the citation check (lib/reference-list.mjs), as proposals a person accepts in Proposals (plan §4.11c).
//
// Nothing here edits on its own. Each fix is one item of one proposal entry and carries only the data it needs; when it is
// accepted it is checked again against the project as it is then (the entry still reads the same, the record still holds
// what it held), so a list edited in between is refused rather than overwritten:
//   link      a near-miss entry is this library record (the match the check would not take by itself)
//   add       an entry the library does not hold becomes a record (the registry's fields where it agreed), linked to it
//   correct   a library record whose year (more than one apart), volume, first page or DOI differs from the registry takes the
//             registry's, through lib/ref-lookup.mjs applyEnrichment (undo: the library's Undo enrichment); an empty field is
//             left to Complete records, and the title and authors are never changed
//   replace   a typed entry whose title agrees with its registry but whose authors, year or details do not is rewritten from
//             the registry in the list's style, its number kept
//   restyle   a list whose entries are all matched to library records is rewritten as a generated list in the project's
//             reference style (lib/reference-style-check.mjs); every entry must still read as it did, or none is changed
//   remove    the second of two entries for one work, in an author–year list (a numbered list would renumber every citation:
//             reported, not proposed)
import { get, update } from '../store.mjs';
import { file } from './aid.mjs';
import { durableAction } from './aid-proposals.mjs';
import { applyEnrichment } from './ref-lookup.mjs';
import { importReferences, libraryRecord } from './search-library.mjs';
import { importKey } from './bib.mjs';
import { formatReference } from './cite.mjs';
import { hashText } from './manuscript.mjs';
import { generatedList } from './reference-style-check.mjs';
import { registryKey, compareWork, entryName, checkCitations, cleanDoi, MATCH } from './reference-list.mjs';

const textOf = b => b?.text ?? (b?.runs || []).map(r => r.t || '').join('');
const blockOf = (s, id) => (s.manuscript?.blocks || []).find(b => b.id === id);
const linksOf = s => s.manuscript?.citationCheck?.links || {};
const setLink = (s, key, id) => { s.manuscript.citationCheck = { ...(s.manuscript.citationCheck || {}), links: { ...linksOf(s), [key]: id } }; };

/** The registry's work as record fields; a field it lacks is left out, never invented. */
const fromWork = w => Object.fromEntries(Object.entries({ doi: w.doi, year: w.year, journal: w.journal, volume: w.volume, issue: w.issue, pages: w.pages }).filter(([, v]) => v));

function apply(d, context = {}) {
  context.guard?.();
  const s = get();
  switch (d.op) {
    case 'link': {
      if (!s.papers?.some(p => (p.id || p.key) === d.paperId)) return { refused: 'The record is no longer in the library' };
      update(st => { setLink(st, d.key, d.paperId); return st; });
      return 'Linked';
    }
    case 'add': {
      const rec = libraryRecord({ ...d.record, key: importKey(d.record) });
      let added = 0;
      update(st => { added = importReferences(st, [rec], 'Manuscript reference list', { at: new Date().toISOString() }).added; setLink(st, d.key, st.papers.find(p => p.key === rec.key || (rec.doi && cleanDoi(p.doi) === cleanDoi(rec.doi)))?.id || rec.key); return st; });
      return added ? 'Added' : 'Already in the library; linked';
    }
    case 'correct': {
      let r;
      update(st => { r = applyEnrichment(st, d.changes); return st; });
      return r.applied ? `Corrected ${r.applied} ${r.applied === 1 ? 'field' : 'fields'}` : { refused: 'The record has changed since; run the check again' };
    }
    case 'restyle': {
      const found = d.edits.map(x => ({ x, b: blockOf(s, x.blockId) }));
      if (found.some(f => !f.b || hashText(textOf(f.b)) !== f.x.hash)) return { refused: 'The list has changed since; run the check again' };
      update(st => {
        for (const x of d.edits) { const b = st.manuscript.blocks.find(y => y.id === x.blockId); b.text = x.text; b.runs = [{ t: x.text }]; }
        return st;
      });
      return `Replaced ${plural(d.edits.length, 'entry', 'entries')}`;
    }
    case 'replace': case 'remove': {
      const b = blockOf(s, d.blockId);
      if (!b) return { refused: 'The entry is gone' };
      if (hashText(textOf(b)) !== d.hash) return { refused: 'The entry has changed since; run the check again' };
      update(st => {
        const blocks = st.manuscript.blocks;
        const i = blocks.findIndex(x => x.id === d.blockId);
        if (d.op === 'remove') blocks.splice(i, 1);
        else { blocks[i].text = d.text; blocks[i].runs = [{ t: d.text }]; }
        return st;
      });
      return d.op === 'remove' ? 'Removed' : 'Replaced';
    }
    default: return { refused: 'This fix is not known' };
  }
}

/** What an item reads as now: nothing to do once its link, record or text is already there. */
function describe(d, s) {
  if (d.op === 'link' && linksOf(s)[d.key] === d.paperId) return { stale: 'Already linked' };
  if (d.op === 'add' && linksOf(s)[d.key]) return { stale: 'Already linked' };
  if (d.op === 'restyle') return d.edits.some(x => !blockOf(s, x.blockId) || hashText(textOf(blockOf(s, x.blockId))) !== x.hash) ? { stale: 'The list has changed' } : null;
  if ((d.op === 'replace' || d.op === 'remove') && hashText(textOf(blockOf(s, d.blockId))) !== d.hash) return { stale: blockOf(s, d.blockId) ? 'The entry has changed' : 'The entry is gone' };
  return null;
}
const proposal = durableAction('citation-fix', apply, describe);

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const quote = t => { const x = String(t || '').replace(/\s+/g, ' ').trim(); return x.length > 140 ? `${x.slice(0, 139)}…` : x; };
const lead = text => /^\s*(?:\[\d{1,3}\]|\d{1,3}[.)])\s*/.exec(text)?.[0] || '';

/**
 * The fixes the check supports for this project, as aid items (label, detail, acceptLabel, payload, accept). `result` is
 * checkCitations' answer; `style` the reference style for a replaced entry (the journal profile's, else Vancouver for a
 * numbered list and APA for an author–year one).
 */
export function citationFixes(s, result, { style = '' } = {}) {
  const items = [];
  // a fix that edits the document is a suggested edit of the manuscript; the rest change the library
  const push = (data, label, detail, acceptLabel) => { const { payload, accept } = proposal(data); items.push({ label, detail, acceptLabel, payload, accept, ...(['replace', 'remove', 'restyle'].includes(data.op) ? { manuscriptEdit: true } : {}) }); };
  const reg = s.manuscript?.citationCheck?.registry || {};
  const blocks = s.manuscript?.blocks || [];
  const numbered = result.list.numbered;
  const styleId = style || (numbered ? 'vancouver' : 'apa');

  for (const c of result.candidates)
    push({ op: 'link', key: c.entry.key, paperId: c.paper.id || c.paper.key }, `Link ${entryName(c.entry)} to ${c.paper.label || c.paper.title}`,
      `${quote(c.entry.title || c.entry.text)}\nLibrary: ${quote(c.paper.title)}`, 'Link');

  const candidateKeys = new Set(result.candidates.map(c => c.entry.key));
  for (const m of result.matches) {
    const e = m.entry, rk = registryKey(e), r = rk && reg[rk];
    const work = r?.status === 'found' ? r.work : null;
    const disagree = work ? compareWork(e, work) : [];
    if (!m.paper && !candidateKeys.has(e.key) && e.title) {
      // the registry's fields only where it agrees with what was typed
      const agreed = work && !disagree.some(d => d.kind === 'ref-wrong-id' || d.kind === 'ref-chimeric');
      const record = { title: e.title, authors: e.authors, year: e.year, journal: e.journal, volume: e.volume, issue: e.issue, pages: e.pages, doi: e.doi, pmid: e.pmid, ...(agreed ? fromWork(work) : {}) };
      push({ op: 'add', key: e.key, record }, `Add ${entryName(e)} to the library`, `${quote(e.title)}${record.journal ? `\n${record.journal}${record.year ? ` ${record.year}` : ''}` : ''}${agreed ? `\nWith ${r.source}'s details` : ''}`, 'Add');
    }
    if (!work) continue;
    // the library record is corrected where the registry has the work and the record disagrees with it
    if (m.paper && !disagree.some(d => d.kind === 'ref-wrong-id')) {
      const p = m.paper, changes = [];
      const want = { year: work.year, volume: work.volume, pages: work.pages, doi: work.doi };
      for (const [field, to] of Object.entries(want)) {
        if (!to) continue;
        const from = p[field] ?? '';
        // a field the record lacks is the library's Complete records (enrichment), not a disagreement to correct
        if (from === '' || from == null) continue;
        const same = field === 'doi' ? cleanDoi(from) === cleanDoi(to) : String(from).trim() === String(to).trim();
        // the same first page is the same pages; a year one apart is the online and the print year (MATCH.YEAR_SLACK)
        if (same || field === 'pages' && String(from).split(/[-–]/)[0] === String(to).split(/[-–]/)[0] || field === 'year' && from && Math.abs(Number(from) - Number(to)) <= MATCH.YEAR_SLACK) continue;
        changes.push({ paperId: p.id || p.key, field, from, to, source: r.source });
      }
      if (changes.length) push({ op: 'correct', changes }, `Correct ${p.label || p.title} from ${r.source}`, changes.map(c => `${c.field}: ${c.from || 'empty'} → ${c.to}`).join('\n'), 'Correct');
    }
    // the typed entry is rewritten where its title is the registry's work and the rest is not
    const rewrite = disagree.filter(d => ['ref-chimeric', 'ref-author', 'ref-year', 'ref-details'].includes(d.kind));
    const b = blocks.find(x => x.id === e.blockId);
    if (rewrite.length && !disagree.some(d => d.kind === 'ref-wrong-id' || d.kind === 'ref-title') && e.whole && !e.bib && b) {
      const authors = rewrite.some(d => d.kind === 'ref-chimeric' || d.kind === 'ref-author') ? (work.names?.length ? work.names : work.families) : e.authors;
      // the titles agree (no ref-title finding): the typed one keeps its own spelling
      const text = `${lead(e.text)}${formatReference({ title: e.title || work.title, authors, journal: e.journal || work.journal, year: work.year || e.year, volume: work.volume || e.volume, issue: work.issue || e.issue, pages: work.pages || e.pages, doi: work.doi || e.doi }, styleId)}`;
      if (text.trim() !== textOf(b).trim())
        push({ op: 'replace', blockId: b.id, hash: hashText(textOf(b)), text }, `Replace ${entryName(e)} with ${r.source}'s details`, `− ${quote(textOf(b))}\n+ ${quote(text)}`, 'Replace');
    }
  }

  // a generated list replaces the typed one only when the check found it inconsistent and every entry is a library record
  const edits = generatedList(result, blocks, { style: styleId });
  if (edits) push({ op: 'restyle', edits: edits.map(x => ({ ...x, hash: hashText(textOf(blocks.find(b => b.id === x.blockId))) })) },
    'Replace list with a generated list', `${plural(edits.length, 'entry', 'entries')} rewritten from the library records, in the style of the list\n− ${quote(textOf(blocks.find(b => b.id === edits[0].blockId)))}\n+ ${quote(edits[0].text)}`, 'Replace');

  if (!numbered) for (const i of result.issues.filter(x => x.kind === 'ref-duplicate')) {
    const e = result.list.entries.find(x => x.key === i.ref && x.blockId === i.blockId);
    const b = e && e.whole && !e.bib && blocks.find(x => x.id === e.blockId);
    if (b) push({ op: 'remove', blockId: b.id, hash: hashText(textOf(b)) }, `Remove ${entryName(e)}, a second entry for one work`, quote(textOf(b)), 'Remove');
  }
  return items;
}

/** Files the fixes as one proposal entry in Proposals; returns how many were filed. */
export function proposeCitationFixes(s = get(), { style = '', library = s.papers || [] } = {}) {
  const result = checkCitations(s.manuscript?.blocks || [], { library, citationCheck: s.manuscript?.citationCheck || {} });
  const items = citationFixes(s, result, { style });
  // filed under the Library: most fixes change records; the edits to the list are marked as the manuscript's (manuscriptEdit)
  if (items.length) file({ view: 'library', title: 'Citation check', items });
  return items.length;
}
