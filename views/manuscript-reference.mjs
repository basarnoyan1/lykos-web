// A reference of the registered manuscript in the side panel (views/manuscript-reader.mjs; the model in lib/reader-reference.mjs), the
// same family as a study's section (lib/study.mjs studySection: a head with its More, sections on hairlines, a foot). 3 Nov 2026, the
// owner: "not all papers have the hover click thing?" and "at least when clicked i should see how did we used them". The panel leads
// with the manuscript's uses of the reference (each citing sentence, its section and paragraph, each a link that scrolls the text there
// and marks the citation), then what the reference says, then its abstract: a project record's own, else fetched on open only (never at
// page load) by DOI or PMID through the app's registry readers (lib/ref-lookup.mjs recordsFromIdentifiers, paced by lib/limiter.mjs) and
// kept in the project for 30 days (s.referenceLookups). A matched record opens in its own section from the foot; an unmatched reference
// can be added to the manuscript's cited works (s.manuscript.references: literature the paper cites, never a record to screen).
import { lib_html$esc as esc } from "../boot.mjs";
import { lib_ui_actions$uiBar as uiBar } from "../boot.mjs";
import { lib_ui_components$uiLink as uiLink } from "../boot.mjs";
import { abstractParts } from '../lib/paper-presentation.mjs';
import { lib_bib_names$authorLine as authorLine, lib_bib_names$authorList as authorList } from "../boot.mjs";
import { entryKey } from '../lib/reference-list.mjs';
import { store$get as get, store$update as update } from "../boot.mjs";
import { usesOf, referenceFacts, lookupKey, cachedLookup, keepLookup } from '../lib/reader-reference.mjs';

const pending = new Map();   // lookup key -> promise, so one reference opened twice is asked once

/**
 * The section of reference `key` ("8", "e12") of the reader `state` (its model, its records), for the side panel: { title, html, wire }.
 *   record   the project record the reference matched (lib/docx-reading.mjs referenceRecord), or null
 *   onJump(use)   scrolls the text to a citation; onOpen(id) opens a matched record; onClose() closes the section
 */
export function referenceSection(state, key, { record = null, onJump, onOpen, onClose, redraw } = {}) {
  const s = get(), entry = state.model?.refs?.get(key), facts = referenceFacts(entry);
  if (!facts) return null;
  const uses = usesOf(state.model, key);
  const title = `Reference ${key}`;
  const head = uiBar({ kind: 'head', label: title, id: 'refp-head', cls: 'insp-head', lead: { title, level: 'h3' }, actions: [],
    overflow: [{ id: 'refp-close', label: 'Close reference', attrs: { 'data-refp-close': '' } }] });
  // the uses first: "how did we use them"
  const useHtml = (u, i) => `<div class="refp-use">${uiLink({ id: `refp-use-${i}`, label: `${u.section}, paragraph ${u.paragraph}`, attrs: { 'data-refp-use': String(i) } })}
    <p class="refp-quote">${esc(u.before)}<sup class="refp-cite">${esc(u.cite)}</sup>${esc(u.after)}</p></div>`;
  const usesHtml = `<section class="study-review refp-uses"><h4>In the manuscript</h4>${uses.length ? uses.map(useHtml).join('') : '<p class="meta">Cited nowhere in the text</p>'}</section>`;
  // what the reference says, as a study's publication line
  const r = record || facts, all = authorList(r.authors), names = all.slice(0, 6).map(n => authorLine([n])).join(', '), shown = all.length > 6 ? `${names}, et al.` : names;
  const issue = `${r.year || ''}${r.volume ? `;${r.volume}${r.issue ? `(${r.issue})` : ''}` : ''}${r.pages ? `:${r.pages}` : ''}`;
  const links = [r.doi ? { label: 'DOI', href: `https://doi.org/${encodeURI(String(r.doi))}` } : null, r.pmid ? { label: 'PubMed', href: `https://pubmed.ncbi.nlm.nih.gov/${encodeURIComponent(r.pmid)}/` } : null].filter(Boolean);
  const pub = `<div class="study-pub">
    ${r.title ? `<p class="study-title" title="${esc(r.title)}">${esc(r.title)}</p>` : `<p class="study-title">${esc(facts.text)}</p>`}
    <p class="study-authors">${esc(shown || 'Authors not recorded')}</p>
    <p class="study-source">${esc([String(r.journal || '').trim(), issue].filter(Boolean).join(', ') || 'Journal not recorded')}</p>
    ${links.length ? `<p class="study-links">${links.map(l => `<a href="${esc(l.href)}" target="_blank" rel="noopener noreferrer">${esc(l.label)} ↗</a>`).join('')}</p>` : ''}
  </div>`;
  // the abstract: the record's own, else the lookup's (cached, else fetched on open)
  const lk = record ? '' : lookupKey(facts), cached = lk ? cachedLookup(s, lk) : null;
  const abstractOf = p => { const parts = abstractParts(p?.abstract); return parts.length ? parts.map(part => `<div class="paper-abstract-part">${part.label ? `<h5>${esc(part.label)}</h5>` : ''}<p>${esc(part.text)}</p></div>`).join('') : ''; };
  const abs = record ? abstractOf(record) || '<p class="meta">Not recorded</p>'
    : cached?.status === 'found' ? abstractOf(cached.record) || '<p class="meta">No abstract in the registry</p>'
    : cached?.status === 'missing' ? '<p class="meta">Not in the registry</p>'
    : lk ? '<p class="meta" data-refp-status role="status">Looking up…</p>' : '<p class="meta">No DOI or PMID to look up</p>';
  const inCited = !record && (s.manuscript?.references || []).some(x => x.key === entryKey(facts));
  const foot = uiBar({ kind: 'foot', label: `${title} actions`, id: 'refp-foot', cls: 'insp-foot', actions: record
    ? [{ id: 'refp-open', label: 'Open record', role: 'primary', attrs: { 'data-refp-open': '' } }]
    : inCited ? [{ id: 'refp-added', label: 'In cited works', role: 'secondary', attrs: { disabled: '' } }] : [{ id: 'refp-add', label: 'Add to cited works', role: 'primary', attrs: { 'data-refp-add': '' } }] });
  const html = `<div class="study-details msd-refp">${head}${usesHtml}${pub}<section class="paper-sheet-abstract"><h4>Abstract</h4>${abs}</section>${foot}</div>`;
  const wire = root => {
    root.querySelectorAll('[data-refp-use]').forEach(b => b.onclick = () => onJump?.(uses[+b.dataset.refpUse]));
    root.querySelector('[data-refp-close]')?.addEventListener('click', () => onClose?.());
    root.querySelector('[data-refp-open]')?.addEventListener('click', () => onOpen?.(record.id));
    root.querySelector('[data-refp-add]')?.addEventListener('click', () => { addCited(facts, cached?.record); redraw?.(); });
    // the lookup, on open only: the answer is kept in the project, and the section drawn again
    if (lk && !cached) lookup(lk, facts).then(() => { if (root.isConnected) redraw?.(); });
  };
  return { title: '', html, wire };
}

/** Fetches the reference's record by DOI or PMID once; the answer (found, missing or failed) is kept in the project. */
function lookup(lk, facts) {
  if (pending.has(lk)) return pending.get(lk);
  const p = (async () => {
    const at = new Date().toISOString();
    let answer;
    try {
      const { recordsFromIdentifiers } = await import('../lib/ref-lookup.mjs');
      const got = await recordsFromIdentifiers(facts.doi ? { dois: [facts.doi] } : { pmids: [facts.pmid] }, { settings: get().settings });
      const r = got[0];
      answer = r ? { at, status: 'found', record: { title: r.title || '', authors: r.authors || [], journal: r.journal || '', year: r.year || '', volume: r.volume || '', issue: r.issue || '', pages: r.pages || '', doi: r.doi || '', pmid: r.pmid || '', abstract: r.abstract || '', source: r.source || '' } }
        : { at, status: 'missing' };
    } catch (err) { answer = { at, status: 'failed', error: String(err?.message || err) }; }
    update(st => keepLookup(st, lk, answer));
    pending.delete(lk);
  })();
  pending.set(lk, p);
  return p;
}

/** Keeps the reference with the manuscript's cited works (literature the paper cites, never a record to screen). */
function addCited(facts, fetched = null) {
  const key = entryKey(facts), at = new Date().toISOString();
  update(s => {
    const refs = s.manuscript?.references || [];
    if (refs.some(x => x.key === key)) return s;
    const r = { key, title: facts.title, authors: facts.authors, journal: facts.journal, year: facts.year, volume: facts.volume, issue: facts.issue, pages: facts.pages, doi: facts.doi, pmid: facts.pmid, rawCitation: facts.text, source: 'Manuscript reader', addedAt: at, ...(fetched ? { title: fetched.title || facts.title, authors: fetched.authors?.length ? fetched.authors : facts.authors, journal: fetched.journal || facts.journal, abstract: fetched.abstract || '' } : {}) };
    s.manuscript = { ...(s.manuscript || {}), references: [...refs, r] };
    return s;
  });
}
