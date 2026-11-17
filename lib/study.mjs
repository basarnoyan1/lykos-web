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
import { lib_native$inDesktop as inDesktop } from "../boot.mjs";
import { store$get as get, store$update as update } from "../boot.mjs";
import { journalContext } from './journal-context.mjs';
import { cellsOf, notesOf } from './record-index.mjs';
import { lib_files$getBytes as getBytes } from "../boot.mjs";
import { lib_bib_names$authorLine as authorLine, lib_bib_names$authorList as authorList } from "../boot.mjs";
import { lib_html$esc as esc } from "../boot.mjs";
import { lib_dates$plural as plural, lib_dates$day as day } from "../boot.mjs";
import { filesOf, provenanceLine, wantsDownloadFacts, downloadFactsOf, addKnown } from './file-origin.mjs';
import { editReference } from './reference-editor.mjs';
import { lib_ui_components$disclosure as disclosure, lib_ui_components$uiLink as uiLink } from "../boot.mjs";
import { lib_ui_actions$uiBar as uiBar } from "../boot.mjs";
import { abstractParts, previewProblem } from './paper-presentation.mjs';
import { lib_manuscript$numbering as numbering } from "../boot.mjs";
import { templateById } from './templates.mjs';
import { lib_screen$screeningStarted as screeningStarted, lib_screen$isIncluded as isIncluded } from "../boot.mjs";
import { instrumentFor } from './study-instrument.mjs';
import { lib_rob_review$effectiveAnswers as effectiveAnswers, lib_rob_review$STUDY as STUDY, lib_rob_review$OVERALL as OVERALL } from "../boot.mjs";
import { itemsMet, gradeBy, isChecklist } from './appraisal-summary.mjs';
import { lib_appraisal_custom$scoreMark as scoreMark } from "../boot.mjs";
import { verdictMark, verdictTone } from './appraisal-mark.mjs';
import { studyCitations, readReferences, referenceMapSvg } from './study-citations.mjs';
import { lib_outcomes$PRIMARY as PRIMARY } from "../boot.mjs";
import { analysesOf, studyValues, studyRob, studyFiles, studyUses } from './study-hub.mjs';
import { lib_lazy$lazyModule as lazyModule } from "../boot.mjs";
// the package's tables and figures number their works with the text (lib/package-cites.mjs); loaded on first use, off the start-up graph
const packageCites = lazyModule(() => import('./package-cites.mjs'), 'the package citations');
const expectedNotice = lazyModule(() => import('./expected-notice.mjs'), 'the expected files');

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
  const cells = cellsOf(st, p.id);
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

  // The analyses with a result, and those that pooled this study (lib/study-hub.mjs).
  const { results, used } = analysesOf(st, p);
  if (results.length && (used.length || inReview)) {
    const total = `${results.length} ${results.length === 1 ? 'analysis' : 'analyses'}`;
    const first = (used[0] || results[0]).o;
    out.push({ key: 'analysis', label: 'Analyses', text: used.length ? `In ${used.length} of ${total}` : `Not in any of ${total}`,
      item: first.id === PRIMARY ? 'pairwise' : `pairwise:${first.id}` });
  }

  const notes = notesOf(st, p.id).length;
  if (notes) out.push({ key: 'notes', label: 'Notes', text: plural(notes, 'note') });
  return out;
}


/** The study's four parts under "In this review", each closed and empty until it is opened: its values, its risk of bias, its files, where it is used. */
const PARTS = [['values', 'Values'], ['rob', 'Risk of bias'], ['files', 'Files'], ['uses', 'Where it is used']];
function partsHtml(st, p) {
  const cells = cellsOf(st, p.id).length;
  return PARTS.map(([id, title]) => disclosure({ id: `study-part-${id}`, title, count: id === 'values' && cells ? cells : null, className: 'study-part', attrs: { 'data-study-part': id },
    body: '<div class="study-part-body" data-study-body></div>' })).join('');
}
const VALUES_STEP = 12;
const linkTo = (n, id, label, view, item) => uiLink({ id: `study-${id}-${n}`, label: label || 'Not recorded', attrs: { 'data-study-view': view, ...(item ? { 'data-study-item': item } : {}) } });
const judged = (level) => level ? `<span class="rob-verdict">${verdictMark(level)}<span class="rob-final" data-tone="${verdictTone(level) || 'empty'}">${esc(level)}</span></span>` : '<span class="meta">Not judged</span>';
/** What each part holds, as markup; `shown` is how many values each group has drawn. */
export function partHtml(id, st, p, shown = new Map()) {
  if (id === 'values') {
    const groups = studyValues(st, p);
    if (!groups.length) return '<p class="meta">No values extracted</p>';
    let n = 0;
    return groups.map(g => {
      const upto = shown.get(g.group) || VALUES_STEP, rest = g.rows.length - upto;
      return `<h5>${esc(g.group)}</h5><dl class="props">${g.rows.slice(0, upto).map(r => `<dt title="${esc(r.label)}">${esc(r.label)}</dt><dd>${linkTo(n++, 'value', r.text, 'extraction', r.field)}</dd>`).join('')}</dl>${
        rest > 0 ? `<p class="meta">${uiLink({ id: `study-more-${n}`, label: `Show ${Math.min(rest, VALUES_STEP)} more of ${rest}`, attrs: { 'data-study-more': g.group } })}</p>` : ''}`;
    }).join('');
  }
  if (id === 'rob') {
    const r = studyRob(st, p);
    if (!r) return '<p class="meta">Not appraised</p>';
    // each judgement once: its traffic-light mark, then the level, which opens it (the level was written twice, as the link and again beside its mark)
    const verdict = (n, level, item) => (level ? `<span class="rob-verdict">${verdictMark(level)}${linkTo(n, 'rob', level, 'appraisal', item)}</span>` : judged(''));
    return `<p class="meta">${esc(r.tool)}</p><dl class="props">${r.overall ? `<dt>Overall</dt><dd>${verdict('o', r.overall, '')}</dd>` : ''}${
      r.rows.map((d, i) => `<dt title="${esc(d.label)}">${esc(d.label)}</dt><dd>${verdict(i, d.level, d.id)}</dd>`).join('')}</dl>`;
  }
  if (id === 'files') {
    const f = studyFiles(st, p), name = rel => String(rel || '').split('/').pop();
    return `<dl class="props"><dt>PDF</dt><dd>${f.own.pdf ? esc(name(f.own.rel) || 'Attached') : '<span class="meta">None attached</span>'}</dd>${
      f.companions.map((c, i) => `<dt>Companion</dt><dd>${uiLink({ id: `study-companion-${i}`, label: c.label, attrs: { 'data-study-peek': c.id } })}${c.pdf ? ` <span class="meta">${esc(name(c.rel) || 'PDF attached')}</span>` : ' <span class="meta">No PDF</span>'}</dd>`).join('')}</dl>${
      f.companions.length ? '' : '<p class="meta">No other reports linked to this study</p>'}`;
  }
  const u = studyUses(st, p);
  const analyses = u.analyses.length ? u.analyses.map((a, i) => `<dt>${i ? '' : 'Analyses'}</dt><dd>${linkTo(i, 'use', a.name, 'analysis', a.item)}</dd>`).join('') : `<dt>Analyses</dt><dd class="meta">${u.of ? `Not in any of ${plural(u.of, 'analysis', 'analyses')}` : 'None run'}</dd>`;
  const outputs = u.outputs.length ? u.outputs.map((o, i) => `<dt>${i ? '' : 'Tables and figures'}</dt><dd>${linkTo(i, 'output', o.title, 'outputs', o.id)}</dd>`).join('') : '<dt>Tables and figures</dt><dd class="meta">None draw on it</dd>';
  return `<dl class="props">${analyses}${outputs}</dl>`;
}

/**
 * A study as a section of the inspector's Details, drawing its own head. `closable`: it was opened from a table or figure (a peek), so its
 * More can close it; the shell wires `[data-peek-close]`.
 */
// files whose download attributes were read this session: one look each, whatever it found
const looked = new Set();

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
  // Each file the record holds, on one quiet line: how and when it was obtained, and when it last changed (lib/file-origin.mjs)
  const held = hasDoc ? filesOf(p) : [];
  const fileLines = held.map(f => `<p class="meta study-pdf" data-file-provenance${f.from?.url ? ` title="${esc(f.from.url)}"` : ''}>${esc(provenanceLine(f, day, { role: true }))}</p>`).join('');
  // the supplements its article cites that it does not hold (lib/expected-notice.mjs): one warning, in a slot kept for it
  const expects = p.expected?.items?.length > 0 && isIncluded(st, p.id);
  if (expects && !expectedNotice.ready()) expectedNotice.ensure().catch(() => {});
  const expectedSlot = expects ? `<div data-expected-slot>${expectedNotice.module()?.studyNotice(p) || ''}</div>` : '';
  const rowHtml = r => {
    const link = uiLink({ id: `study-result-${r.key}`, label: r.text, attrs: { 'data-study-view': r.key, ...(r.item ? { 'data-study-item': r.item } : {}) } });
    const verdict = r.verdict ? ` <span class="rob-verdict">${verdictMark(r.verdict)}<span class="rob-final" data-tone="${verdictTone(r.verdict) || 'empty'}">${esc(r.verdict)}</span></span>` : '';
    return `<dt>${esc(r.label)}</dt><dd>${link}${verdict}</dd>`;
  };
  const refLinks = links(p);
  const html = `<div class="study-details">${head}
    ${publicationHtml(p, refLinks)}
    ${pdfLine}${fileLines}${expectedSlot}
    <section class="study-review"><h4>In this review</h4><dl class="props">${reviewRows(st, p).map(rowHtml).join('')}</dl>${partsHtml(st, p)}</section>
    ${citationsHtml(st, p)}
    ${facts.length ? disclosure({ id: 'study-reference-details', title: 'Reference details', body: `<dl class="props">${facts.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>` }) : ''}
    <section class="paper-sheet-abstract"><h4>Abstract</h4>
      ${paragraphs.length ? paragraphs.map(part => `<div class="paper-abstract-part">${part.label ? `<h5>${esc(part.label)}</h5>` : ''}<p>${esc(part.text)}</p></div>`).join('') : '<p class="meta">Not recorded</p>'}
    </section>${foot}</div>`;
  const wire = root => {
    const slot = root.querySelector('[data-expected-slot]');
    if (slot) expectedNotice.ensure().then(m => m.wireNotice(slot, p.id, { get, update })).catch(() => {});
    // a file in the folder with no source yet: what macOS kept of its download, once (src-tauri where_from.rs)
    const ask = held.filter(wantsDownloadFacts).filter(f => !looked.has(`${p.id}\n${f.path}`));
    if (ask.length && inDesktop()) {
      for (const f of ask) looked.add(`${p.id}\n${f.path}`);
      import('./projects.mjs').then(m => downloadFactsOf(m.activeFolder(), ask.map(f => f.path))).then(found => {
        if (!found.some(Boolean)) return;
        update(s => { const q = s.papers.find(x => x.id === p.id); if (q) found.forEach((facts, i) => { if (facts) addKnown(q, { path: ask[i].path, role: ask[i].role }, facts); }); return s; });
      }).catch(() => {});
    }
    // Older imports may have bytes in IndexedDB without a PDF metadata flag.
    if (!hasDoc) hasDocument(p).then(available => {
      if (!available || !root.isConnected) return;
      const section = studySection(p, ctx, true, { closable }); root.innerHTML = section.html; section.wire(root);
    });
    root.querySelectorAll('.study-review > dl [data-study-view]').forEach(b => b.onclick = () => ctx.openStudyResults(b.dataset.studyView, p.id, b.dataset.studyItem));
    // the parts load when first opened, and only then
    const bindLinks = scope => scope.querySelectorAll('[data-study-view]').forEach(b => b.onclick = () => ctx.openStudyResults(b.dataset.studyView, p.id, b.dataset.studyItem));
    root.querySelectorAll('details[data-study-part]').forEach(d => {
      const shown = new Map(), body = d.querySelector('[data-study-body]');
      const draw = () => {
        body.innerHTML = partHtml(d.dataset.studyPart, get(), (get().papers || []).find(x => x.id === p.id) || p, shown);
        bindLinks(body);
        body.querySelectorAll('[data-study-peek]').forEach(b => b.onclick = () => openStudy(ctx, b.dataset.studyPeek));
        body.querySelectorAll('[data-study-more]').forEach(b => b.onclick = () => { shown.set(b.dataset.studyMore, (shown.get(b.dataset.studyMore) || VALUES_STEP) + VALUES_STEP); draw(); });
      };
      d.addEventListener('toggle', () => {
        if (!d.open || d.dataset.loaded) return;
        d.dataset.loaded = '1'; body.innerHTML = '<p class="meta" role="status">Reading…</p>';
        setTimeout(() => { if (d.isConnected) draw(); }, 0);
      });
    });
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
