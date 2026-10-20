// Identifying the papers behind attached files, automatically.
//
// A record that has a PDF but no DOI, or a title that is a file name, is not
// yet a paper. This runs over such records whenever the project opens or a
// file is attached: it reads each PDF, matches it to a registry entry, and
// puts the real title, authors, journal, year and DOI on the same record — the
// id stays, so decisions and extracted values stay attached. It is a job: its
// progress is visible and its outcome is logged. Registry calls are spaced so
// a folder of two hundred files is polite to Crossref.
import { familyName } from './bib.mjs';
import { get, update } from '../store.mjs';
import { getBytes } from './files.mjs';
import { identify } from './pdfmeta.mjs';
import { lookupDois, lookupPii, lookupVip, matchTitle } from './sources.mjs';
import { start as startJob } from './jobs.mjs';
import { pending, listeners, onProgress, FILE_NAME } from './identify-pending.mjs';

const named = rec => (rec?.authors || []).some(a => String(a || '').trim());
let running = null;
export { pending, onProgress };
const tell = msg => { for (const fn of listeners) fn(msg); };

/**
 * Run identification over everything pending. Safe to call repeatedly.
 *
 * Three phases, so the slow part touches as few files as possible:
 *   1. read every file locally, in parallel — hash, metadata DOI, title;
 *   2. one batched registry call for all DOIs found, plus publisher-id hints
 *      from file names;
 *   3. title search only for what is still unknown, spaced for the registry.
 */
export function runIdentification({ concurrency = 4, retry = false } = {}) {
  if (running) return running;
  const todo = pending(get(), { retry });
  if (!todo.length) return Promise.resolve({ fixed: 0, merged: 0, still: 0 });
  running = (async () => {
    const job = startJob('identify', `Identifying ${todo.length} ${todo.length === 1 ? 'paper' : 'papers'}`);
    const tally = { fixed: 0, merged: 0, still: 0 };
    const local = new Map();   // paper id -> meta
    // ---- phase 1: local
    let i = 0;
    const readNext = async () => {
      while (i < todo.length) {
        const p = todo[i++];
        tell(`Reading ${i} of ${todo.length}`); job.progress(`reading ${i}/${todo.length}`);
        try {
          const bytes = await getBytes(p.id);
          if (!bytes) { mark(p.id, { identified: 'unreadable' }); tally.still++; continue; }
          const meta = await identify(bytes, { name: p.pdf?.name || p.title || '' });
          const twin = [...local.entries()].find(([id, m]) => m.hash === meta.hash) ||
            get().papers.filter(x => x.id !== p.id && x.pdfHash === meta.hash).map(x => [x.id, null])[0];
          if (twin) {
            mark(p.id, { pdfHash: meta.hash, duplicateOf: twin[0], identified: 'duplicate' });
            tally.still++; continue;
          }
          mark(p.id, { pdfHash: meta.hash });
          local.set(p.id, meta);
        } catch { tally.still++; }
      }
    };
    await Promise.all(Array.from({ length: concurrency }, readNext));

    // ---- phase 2: one registry call for every DOI and hint
    tell('Looking up'); job.progress('registry');
    const dois = [];
    for (const [id, m] of local) {
      const doi = m.doi || m.hint?.doi;
      if (doi) dois.push(doi);
      if (m.hint?.doiSuffix) for (const pre of m.hint.prefixes) dois.push(`${pre}/${m.hint.doiSuffix}`);
    }
    let found = new Map();
    try { found = await lookupDois(dois); } catch { /* registry down: fall through to titles */ }
    const unresolved = [];
    for (const [id, m] of local) {
      const cands = [m.doi, m.hint?.doi, ...(m.hint?.doiSuffix ? m.hint.prefixes.map(pre => `${pre}/${m.hint.doiSuffix}`) : [])]
        .filter(Boolean).map(d => d.toLowerCase());
      const rec = cands.map(d => found.get(d)).find(Boolean);
      if (rec && named(rec)) { await apply(id, rec, m, tally); continue; }
      if (m.hint?.pii) {
        try { const r = await lookupPii(m.hint.pii); if (r && named(r)) { await apply(id, r, m, tally); continue; } } catch {}
      }
      if (m.hint?.vip) {
        try { const r = await lookupVip(m.hint.vip); if (r && named(r)) { await apply(id, r, m, tally); continue; } } catch {}
      }
      unresolved.push([id, m]);
    }

    // ---- phase 3: titles, one at a time, politely
    let k = 0;
    for (const [id, m] of unresolved) {
      k++; tell(`Matching titles ${k} of ${unresolved.length}`); job.progress(`titles ${k}/${unresolved.length}`);
      let rec = null;
      const cands = [...new Set((m.titles || [m.title]).filter(Boolean).flatMap(t => [t, t.replace(/^[A-Za-z]{3,9}\s*\d{4}\s*[:\-–]\s*/, '').trim()]))];
      for (const t of cands) {
        rec = (await matchTitle(t).catch(() => null))?.record || null;
        if (rec) break;
      }
      if (rec) { await apply(id, rec, m, tally); }
      else {
        const p = get().papers.find(x => x.id === id);
        const t = m.title || p?.title || '';
        mark(id, { title: t || p?.title, label: t && !FILE_NAME.test(t) ? t.split(/\s+/).slice(0, 3).join(' ') : (p?.pdfName || p?.label || '').replace(/\.pdf$/i, '').slice(0, 40),
          identified: 'title-only', unidentified: !t, authors: [], doi: '', journal: '' });
        tally.still++;
      }
    }
    job.done(tally);
    tell('');
    running = null;
    return tally;
  })();
  return running;
}

/** Put a registry record onto the paper's own record, or merge into a twin. */
async function apply(id, rec, meta, tally) {
  const p = get().papers.find(x => x.id === id);
  if (!p) return;
  const other = get().papers.find(x => x.id !== id && (x.key === rec.key || (x.doi && rec.doi && x.doi.toLowerCase() === rec.doi.toLowerCase())));
  if (other) {
    // Duplicate review is explicit: automatic identification must preserve
    // both records, their decisions, evidence anchors and attachments.
    mark(id, { pdfHash: meta.hash, duplicateOf: other.id, identified: 'duplicate' });
    tally.still++;
    return;
  }
  mark(id, { title: rec.title, authors: rec.authors, journal: rec.journal, year: rec.year ? String(rec.year) : '',
    doi: rec.doi, url: rec.url, source: rec.source, key: rec.key, pdfHash: meta.hash, identified: 'registry',
    volume: rec.volume || '', issue: rec.issue || '', pages: rec.pages || '', abstract: p.abstract || rec.abstract || '',
    label: [rec.authors[0] ? familyName(rec.authors[0]) : 'Study', rec.year].filter(Boolean).join(' '), unidentified: false });
  tally.fixed++;
}

const mark = (id, patch) => update(s => {
  const x = s.papers.find(y => y.id === id);
  if (x) { Object.assign(x, patch); if (patch.unidentified === false) delete x.unidentified; }
  return s;
});
