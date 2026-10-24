// Opening a study from wherever it is named.
//
// A study appears in six tables. Clicking it should always do the same thing:
// show the record — its citation, where it stands in this review and its
// abstract — with the PDF one button away when there is one, and a way to find
// one when there is not. Not nothing, which is what an inert label gives.
//
// The section's head is the study's label, Open PDF when a document is there,
// and one More (Edit reference; Close study when it was opened from a table or
// figure, as Escape does). Under it one quiet citation line and the title.
// "In this review" says each stage's state in words and goes to it (plan §2,
// "A study in Details").
import { nonEnglishLanguage } from './languages.mjs';
import { retrievePaper, canRetrievePaper } from './paper-download.mjs';
import { inDesktop } from './native.mjs';
import { get, update } from '../store.mjs';
import { journalContext } from './journal-context.mjs';
import { projectIndex } from './project-index.mjs';
import { getBytes } from './files.mjs';
import { authorLine, authorList } from './bib.mjs';
import { esc } from './html.mjs';
import { plural } from './dates.mjs';
import { editReference } from './reference-editor.mjs';
import { disclosure, uiLink } from './ui-components.mjs';
import { uiBar } from './ui-actions.mjs';
import { abstractParts, previewProblem } from './paper-presentation.mjs';
import { numbering } from './manuscript.mjs';
import { templateById } from './templates.mjs';
import { screeningStarted, isIncluded } from './screen.mjs';
import { instrumentFor } from './study-instrument.mjs';
import { effectiveAnswers, STUDY, OVERALL } from './rob-review.mjs';
import { itemsMet, gradeBy, isChecklist } from './appraisal-summary.mjs';
import { scoreMark } from './appraisal-custom.mjs';
import { verdictMark, verdictTone } from './appraisal-mark.mjs';
import { studyCitations, readReferences, referenceMapSvg } from './study-citations.mjs';
import { shownOutcomes, timepointsOf, slotId, analysisOf, PRIMARY } from './outcomes.mjs';
import { lazyModule } from './lazy.mjs';
// the package's tables and figures number their works with the text (lib/package-cites.mjs); loaded on first use, off the start-up graph
const packageCites = lazyModule(() => import('./package-cites.mjs'), 'the package citations');

/**
 * Only http(s) addresses become links. A record's url arrives from an external
 * API, and escaping an href does nothing about a `javascript:` scheme — the
 * scheme has to be checked, not the characters.
 */
const safeHref = u => {
  try {
    if (typeof u !== 'string' || !u.trim()) return null;
    const url = new URL(u);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : null;
  } catch { return null; }
};

/** A record's external addresses, in the order a reader would try them. */
function links(p) {
  const out = [];
  if (p.doi) out.push({ label: 'DOI', href: `https://doi.org/${encodeURI(String(p.doi))}` });
  if (p.pmid) out.push({ label: 'PubMed', href: `https://pubmed.ncbi.nlm.nih.gov/${encodeURIComponent(p.pmid)}/` });
  const own = safeHref(p.url);
  if (own && !out.some(l => l.href === own)) out.push({ label: 'Source', href: own });
  return out.filter(l => safeHref(l.href));
}

/** Whether a document can be opened without retrieving one. */
export const hasDocument = async p => Boolean(p.pdf || p.pdfRel || p.pdfRetrieval?.status === 'preview' || await getBytes(p.id).catch(() => null));

/** The journal as a citation line names it: the record's own abbreviation, else the name before " : " or its first comma. */
export function journalShort(p) {
  const abbr = String(p.journalAbbr || '').replace(/\s+/g, ' ').trim();
  if (abbr) return abbr;
  return String(p.journal || '').replace(/\s+/g, ' ').split(/\s+:\s+|,/)[0].trim();
}

/** "Dalbayrak S et al. · J Clin Neurosci · 2020" */
export function citationLine(p) {
  const all = authorList(p.authors), first = all.length ? `${authorLine(all.slice(0, 1))}${all.length > 1 ? ' et al.' : ''}` : '';
  return [first, journalShort(p), p.year].filter(Boolean).join(', ');
}

/** The reference as a reader looks for it: the title, up to six authors, then the journal with year, volume, issue and pages. */
function publicationHtml(p, refLinks) {
  const all = authorList(p.authors), names = all.slice(0, 6).map(n => authorLine([n])).join(', '), shown = all.length > 6 ? `${names}, et al.` : names;
  const issue = `${p.year || ''}${p.volume ? `;${p.volume}${p.issue ? `(${p.issue})` : ''}` : ''}${p.pages ? `:${p.pages}` : ''}`;
  const source = [String(p.journal || '').trim() || journalShort(p), issue].filter(Boolean).join(', ');
  return `<div class="study-pub">
    ${p.title ? `<p class="study-title" title="${esc(p.title)}">${esc(p.title)}</p>` : ''}
    <p class="study-authors">${esc(shown || 'Authors not recorded')}</p>
    <p class="study-source">${esc(source || 'Journal not recorded')}</p>
    ${refLinks.length ? `<p class="study-links">${refLinks.map(l => `<a href="${esc(l.href)}" target="_blank" rel="noopener noreferrer">${esc(l.label)} ↗</a>`).join('')}</p>` : ''}
  </div>`;
}

/** Citations in this review: the included studies this one cites and those that cite it, each a link to its Details, and the map. */
function citationsHtml(st, p) {
  const c = studyCitations(st, p);
  const readLink = n => uiLink({ id: 'study-read-refs', label: `Read reference lists (${plural(n, 'study')})`, attrs: { 'data-read-refs': '' } });
  const status = '<span class="meta" data-refs-status role="status"></span>';
  if (!c.read) {
    const n = c.unread.length + (p.doi || p.pmid ? 1 : 0);
    return `<section class="study-cites"><h4>Citations in this review</h4>
      ${n ? `<p class="meta">Not read yet. ${readLink(n)} ${status}</p>` : '<p class="meta">No DOI or PMID to look up</p>'}</section>`;
  }
  // the map says it all: what it cites on the left, what cites it on the right, each a pill that opens that study
  return `<section class="study-cites"><h4>Citations in this review</h4>
    ${c.cites.length || c.citedBy.length ? '<div class="study-cite-map" data-cite-map></div>' : '<p class="meta">It cites no other study in the review, and none cites it</p>'}
    ${c.unread.length ? `<p class="meta">${esc(`${plural(c.unread.length, 'study')} not read, so may cite it too.`)} ${readLink(c.unread.length)} ${status}</p>` : ''}
  </section>`;
}

const WORD = { include: 'Included', exclude: 'Excluded', maybe: 'Uncertain', uncertain: 'Uncertain' };

/**
 * Where a study stands in this review, one row per stage that has something to say: { key, label, text, verdict?, item? }.
 * `key` is the view the row opens and `item` where in it: the screening stage, or the analysis. A stage the study never reached (an excluded record's
 * appraisal) is left out; Notes only when there are some. Pure over the state.
 */
export function reviewRows(st, p) {
  const out = [], inReview = !screeningStarted(st) || isIncluded(st, p.id);
  const ta = st.screening?.[p.id]?.decision, ft = st.fulltext?.[p.id]?.decision;
  out.push({ key: 'screening', label: 'Screening', text: WORD[ft] ? `${WORD[ft]} at full text` : WORD[ta] ? `${WORD[ta]} at title and abstract` : 'Not screened',
    item: WORD[ft] ? 'ft' : 'ta' });

  // Values by the table that holds them; a study in a table group (the Library's "Table 1"… collections) names it.
  const cells = projectIndex(st).values.get(p.id) || [];
  if (cells.length || inReview) {
    const byTable = new Map();
    for (const [key] of cells) {
      const field = key.slice(p.id.length + 1), dot = field.indexOf('.');
      const t = dot > 0 && templateById(field.slice(0, dot), st) ? field.slice(0, dot) : 'default';
      byTable.set(t, (byTable.get(t) || 0) + 1);
    }
    const groups = (st.collections || []).filter(c => /^c-table-\d+$/.test(c.id) && (c.members || []).includes(p.id)).map(c => c.name);
    const where = byTable.size === 1 ? templateById([...byTable.keys()][0], st)?.name || 'Study data' : `${byTable.size} tables`;
    out.push({ key: 'extraction', label: 'Extraction',
      text: cells.length ? `${plural(cells.length, 'value')} in ${where}${groups.length ? ` (${groups.join(', ')})` : ''}` : 'No values extracted' });
  }

  const tool = instrumentFor(st, p.id);
  const a = effectiveAnswers(st, p.id, tool.id, STUDY).answers || {};
  const judged = tool.domains.filter(d => a[d.id]).length;
  if (judged || inReview) {
    const verdict = !judged ? '' : isChecklist(tool) ? gradeBy(itemsMet(a, tool).pct, st.appraisalRule) || '' : a[OVERALL] || scoreMark(tool, a) || '';
    out.push({ key: 'appraisal', label: 'Appraisal', text: `${tool.name}: ${judged ? `${judged} of ${tool.domains.length}` : 'not started'}`, verdict });
  }

  // The analyses with a result, and those that pooled this study (a proportion records its cells, a pooled effect its studies' labels).
  const results = shownOutcomes(st).flatMap(o => timepointsOf(st, o.id).map(t => ({ o, a: analysisOf(st, slotId(o.id, t.id)) }))).filter(r => r.a);
  const label = String(p.label || '');
  const uses = ({ a: r }) => (Array.isArray(r.sources) && r.sources.length ? r.sources.some(k => String(k).startsWith(`${p.id}:`))
    : !!label && (r.labels || []).some(l => l === label || String(l).startsWith(`${label} · `) || String(l).startsWith(`${label}, `)));   // lint-allow-dot: reads labels saved before 2026-10-20
  const used = results.filter(uses);
  if (results.length && (used.length || inReview)) {
    const total = `${results.length} ${results.length === 1 ? 'analysis' : 'analyses'}`;
    const first = (used[0] || results[0]).o;
    out.push({ key: 'analysis', label: 'Analyses', text: used.length ? `In ${used.length} of ${total}` : `Not in any of ${total}`,
      item: first.id === PRIMARY ? 'pairwise' : `pairwise:${first.id}` });
  }

  const notes = projectIndex(st).notes.get(p.id)?.length || 0;
  if (notes) out.push({ key: 'notes', label: 'Notes', text: plural(notes, 'note') });
  return out;
}

/**
 * A study as a section of the inspector's Details, drawing its own head. `closable`: it was opened from a table or figure (a peek), so its
 * More can close it; the shell wires `[data-peek-close]`.
 */
export function studySection(p, ctx, hasDoc = Boolean(p.pdf || p.pdfRel || p.pdfRetrieval?.status === 'preview'), { closable = false } = {}) {
  const st = get();
  const paragraphs = abstractParts(p.abstract);
  const referenceNumber = journalContext(st).citationStyle === 'numbered'
    ? numbering(st.manuscript?.blocks || [], (packageCites.module()?.withPackage || ((x, b, d) => d))(st, st.manuscript?.blocks || [], st.manuscript || {})).get(p.key) : null;
  if (st.package?.parts?.length && !packageCites.ready()) packageCites.ensure().catch(() => {});
  // The reference's own identifiers; where it stands in the review is "In this review".
  const facts = [
    ...(referenceNumber ? [['Reference number', String(referenceNumber)]] : []),
    ['Language', nonEnglishLanguage(p.language)], ['Source', p.source], ['DOI', p.doi], ['PMID', p.pmid],
  ].filter(([, v]) => v);
  const title = p.label || 'Study';
  // The inspector's three parts (Component review 2026-10-21, item 20, after Graphite's and Time2book's drawers): a head with the study's
  // name and its More, sections on hairlines, and a foot held at the pane's bottom with Close (a study opened from a table) and one primary.
  const head = uiBar({ kind: 'head', label: title, id: 'study-head', cls: 'insp-head', lead: { title, level: 'h3' }, actions: [],
    overflow: [{ id: 'study-edit', label: 'Edit reference', attrs: { 'data-edit-reference': '' } }] });
  const foot = hasDoc || closable ? uiBar({ kind: 'foot', label: `${title} actions`, id: 'study-foot', cls: 'insp-foot', actions: [
    ...(closable ? [{ id: 'study-close', label: 'Close study', role: 'secondary', attrs: { 'data-peek-close': '' } }] : []),
    ...(hasDoc ? [{ id: 'study-open', label: 'Open PDF', icon: 'file-pdf', role: 'primary', attrs: { 'data-open-doc': '' } }] : [])] }) : '';
  // No document: one quiet line, and Find PDF where the desktop app can look for one. A failed search says so in the same line.
  const canFind = inDesktop() && canRetrievePaper(p), failed = p.pdfRetrieval?.status === 'unavailable';
  const pdfLine = hasDoc ? '' : `<p class="meta study-pdf"><span data-retrieval-status role="status">${failed ? 'No PDF found' : 'No PDF attached'}</span>${canFind
    ? `, ${uiLink({ id: 'study-find-pdf', label: failed ? 'Find PDF again' : 'Find PDF', attrs: { 'data-retrieve': '' } })}` : ''}</p>`;
  const rowHtml = r => {
    const link = uiLink({ id: `study-result-${r.key}`, label: r.text, attrs: { 'data-study-view': r.key, ...(r.item ? { 'data-study-item': r.item } : {}) } });
    const verdict = r.verdict ? ` <span class="rob-verdict">${verdictMark(r.verdict)}<span class="rob-final" data-tone="${verdictTone(r.verdict) || 'empty'}">${esc(r.verdict)}</span></span>` : '';
    return `<dt>${esc(r.label)}</dt><dd>${link}${verdict}</dd>`;
  };
  const refLinks = links(p);
  const html = `<div class="study-details">${head}
    ${publicationHtml(p, refLinks)}
    ${pdfLine}
    <section class="study-review"><h4>In this review</h4><dl class="props">${reviewRows(st, p).map(rowHtml).join('')}</dl></section>
    ${citationsHtml(st, p)}
    ${facts.length ? disclosure({ id: 'study-reference-details', title: 'Reference details', body: `<dl class="props">${facts.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>` }) : ''}
    <section class="paper-sheet-abstract"><h4>Abstract</h4>
      ${paragraphs.length ? paragraphs.map(part => `<div class="paper-abstract-part">${part.label ? `<h5>${esc(part.label)}</h5>` : ''}<p>${esc(part.text)}</p></div>`).join('') : '<p class="meta">Not recorded</p>'}
    </section>${foot}</div>`;
  const wire = root => {
    // Older imports may have bytes in IndexedDB without a PDF metadata flag.
    if (!hasDoc) hasDocument(p).then(available => {
      if (!available || !root.isConnected) return;
      const section = studySection(p, ctx, true, { closable }); root.innerHTML = section.html; section.wire(root);
    });
    root.querySelectorAll('[data-study-view]').forEach(b => b.onclick = () => ctx.openStudyResults(b.dataset.studyView, p.id, b.dataset.studyItem));
    root.querySelectorAll('[data-study-peek]').forEach(b => b.onclick = () => openStudy(ctx, b.dataset.studyPeek));
    const redraw = () => { if (!root.isConnected) return; const now = (get().papers || []).find(x => x.id === p.id) || p, section = studySection(now, ctx, hasDoc, { closable }); root.innerHTML = section.html; section.wire(root); };
    root.querySelector('[data-read-refs]')?.addEventListener('click', async e => {
      const b = e.currentTarget, status = root.querySelector('[data-refs-status]');
      b.disabled = true; if (status) status.textContent = 'Reading…';
      try {
        const r = await readReferences(get(), (get().papers || []).find(x => x.id === p.id) || p, { update, onProgress: t => { if (status) status.textContent = t; } });
        redraw();
        if (r.missing) root.querySelector('[data-refs-status]')?.replaceChildren(`${r.missing} not found in OpenAlex`);
      } catch (err) { b.disabled = false; if (status) status.textContent = `Could not read: ${err?.message || err}`; }
    });
    const map = root.querySelector('[data-cite-map]');
    if (map) {
      map.innerHTML = referenceMapSvg(p, studyCitations(get(), p), { width: map.getBoundingClientRect().width || 320 });
      map.querySelectorAll('[data-study-peek]').forEach(g => { g.onclick = () => openStudy(ctx, g.dataset.studyPeek); g.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openStudy(ctx, g.dataset.studyPeek); } }; });
    }
    root.querySelector('[data-edit-reference]')?.addEventListener('click', () => editReference(p.id, ctx));
    root.querySelector('[data-open-doc]')?.addEventListener('click', () => ctx.openDocument(p.id));
    root.querySelector('[data-retrieve]')?.addEventListener('click', async e => {
      const b = e.currentTarget, label = b.querySelector('.ui-link-label') || b, status = root.querySelector('[data-retrieval-status]');
      b.disabled = true; status.textContent = 'Finding PDF…';
      try { await retrievePaper(p.id); ctx.refreshCounts?.(); ctx.openDocument(p.id); ctx.rerender(); }
      catch (err) {
        const problem = previewProblem(err?.message || err);
        status.textContent = 'No PDF found'; status.title = problem ? `${problem.title}: ${problem.detail}` : '';
        label.textContent = 'Find PDF again'; b.disabled = false;
      }
    });
  };
  return { paperId: p.id, html, wire };
}

/**
 * Open a study: its record first. A locator (an evidence link, a highlighted
 * quote) goes straight to that place in the document when there is one.
 */
export async function openStudy(ctx, paperId, locator = null) {
  const p = (get().papers || []).find(x => x.id === paperId);
  if (!p) return;
  // A named study shows what the project knows about it first; the document
  // opens from there. Evidence links carry a locator and go straight to the page.
  if (locator) {
    if (p.pdf || p.pdfRel || p.pdfRetrieval?.status === 'preview' || await getBytes(paperId).catch(() => null)) { ctx.openDocument(paperId, locator); return; }
  }
  ctx.showStudy(paperId, await hasDocument(p));
}

/** Wire every study cell in a container. */
export function wireStudies(el, ctx) {
  el.querySelectorAll('[data-open]').forEach(b => b.onclick = e => {
    e.stopPropagation();
    openStudy(ctx, b.dataset.open);
  });
}
