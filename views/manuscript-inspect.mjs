// Manuscript's inspector sections after the word count (DIALOGS §4.4, #13 and #15).
//
// Claims checks one claim against its source: the page's More (Check claim) puts the selected words, or the sentence with the
// caret, in Claim and its first citation in Source; the report and Keep claim record come under it; reviewed claims under that.
// A paragraph update drafted from the page's More (Propose update from results) is proposed from here until the Proposals pane
// takes drafts (plans/ASSIST-PROPOSALS.md): draftUpdate({ block, text }) is the one handoff.
//
// The inspector redraws its sections on every paint, so the drafts, the report and its source guard live in this module, never
// in a section's wire. A replaced project starts them empty.
import { get, projectGeneration } from '../store.mjs';
import { esc } from '../lib/html.mjs';
import { formField, disclosure, sentenceLabel } from '../lib/ui-components.mjs';
import { inspectorActions, uiList, uiRow } from '../lib/ui-actions.mjs';
import { uiLink } from '../lib/ui-components.mjs';
import { pageOf, pager, wirePager } from '../lib/paging.mjs';
import { recordPicker, wireRecordPicker } from '../lib/record-picker.mjs';
import { auditClaims, proposeClaimReview, claimLedger, proposeManuscriptUpdate } from '../lib/research-copilot.mjs';
import { proposalSourceSnapshot } from '../lib/research-ledger.mjs';
import { citations, resultTokens } from '../lib/manuscript.mjs';

const CLAIM_PAGE = 25;
const NOT_TEXT = ['table', 'figure', 'toc', 'bib'];
const textOf = b => b?.text ?? (b?.runs || []).map(r => r.t).join('');
const blank = () => ({ text: '', source: '', kind: 'abstract', page: '', quote: '' });
const live = sel => document.querySelector(sel);

let owner = null;                                   // the project generation the drafts below belong to
let claim = blank(), claimOpen = false, report = null, revision = 0, busy = false, claimNote = '', claimPage = 1, reviewedOpen = false;
let upd = null, updNote = '';                       // the paragraph update: { block, before, text }

function own() {
  const g = projectGeneration();
  if (owner === g) return;
  owner = g; claim = blank(); claimOpen = false; report = null; revision++; busy = false; claimNote = ''; claimPage = 1; reviewedOpen = false; upd = null; updNote = '';
}

/** The sentence around a source offset in a paragraph's text: from the end of the sentence before it to the end of its own. */
export function sentenceAt(text, at) {
  const ends = [...String(text).matchAll(/[.!?](?=\s|$)/g)].map(m => m.index + 1);
  return String(text).slice(ends.filter(e => e < at).at(-1) ?? 0, ends.find(e => e >= at) ?? text.length).trim();
}

/** Check claim (the page's More): the words become the claim, without their citation marks; the first cited record is the source. */
export function seedClaim(text) {
  own();
  const raw = String(text || '').trim();
  const words = raw.replace(/\s*\[@[^\]]*\]/g, '').replace(/\s+([.,;:])/g, '$1').trim().slice(0, 4000);
  if (words && words !== claim.text) {
    const keys = citations(raw).map(c => c.key), papers = get().papers || [];
    const source = keys.map(k => papers.find(p => p.key === k)).find(Boolean)?.id || '';
    claim = { ...blank(), text: words, source }; report = null; revision++; claimNote = '';
  }
  claimOpen = true;
}

/** Propose update from results (the page's More) hands over a paragraph and the text to start from. */
export function draftUpdate({ block, text }) {
  own();
  const b = (get().manuscript?.blocks || []).find(x => x.id === block);
  if (!b || NOT_TEXT.includes(b.type) || !textOf(b).trim()) throw new Error('Put the caret in a paragraph first');
  upd = { block, before: textOf(b), text: String(text ?? textOf(b)) }; updNote = '';
}

/** The sections, after the word count. */
export function sections(ctx) {
  own();
  const s = get();
  return [...(upd ? [updateSection(s, ctx)] : []), claimsSection(s, ctx)];
}

// ---- the paragraph update --------------------------------------------------------------------------------------------

function sectionOf(blocks, id) {
  const i = blocks.findIndex(b => b.id === id);
  for (let h = i; h >= 0; h--) if (/^h[1-3]$/.test(blocks[h].type) && blocks[h].text?.trim()) return blocks[h].text.trim();
  return '';
}

function updateSection(s, ctx) {
  const say = t => { updNote = t; const m = live('#ms-update-acts .ui-bar-message'); if (m) m.textContent = t; };
  return { title: 'Paragraph update', meta: sectionOf(s.manuscript?.blocks || [], upd.block),
    html: `<form id="ms-update-form">${formField('Replacement', `<textarea id="ms-update-text" rows="8" maxlength="12000" spellcheck="true">${esc(upd.text)}</textarea>`)}
      ${inspectorActions({ label: 'Paragraph update actions', id: 'ms-update-acts', start: { message: updNote },
        actions: [{ id: 'ms-update-discard', label: 'Discard' }, { id: 'ms-update-propose', label: 'Propose', icon: 'proposals', type: 'submit' }] })}</form>`,
    wire: host => {
      const form = host.querySelector('#ms-update-form');
      host.querySelector('#ms-update-text').oninput = e => { if (upd) upd.text = e.target.value; };
      host.querySelector('#ms-update-discard').onclick = () => { upd = null; updNote = ''; ctx.refreshDetails?.(); };
      form.onsubmit = e => {
        e.preventDefault();
        try {
          if (!upd || owner !== projectGeneration()) throw new Error('The project was replaced. Choose the paragraph again.');
          const b = get().manuscript?.blocks?.find(x => x.id === upd.block);
          if (!b) throw new Error('The paragraph was removed');
          if (textOf(b) !== upd.before) throw new Error('The paragraph changed. Choose Propose update from results again.');
          proposeManuscriptUpdate(get(), { block: upd.block, text: upd.text });
          upd = null; updNote = '';
          ctx.refreshDetails?.(); ctx.openProposals?.();
        } catch (error) { say(error.message); }
      };
    } };
}

// ---- claims ----------------------------------------------------------------------------------------------------------

function reportHtml() {
  if (!report) return '';
  const c = report.claims[0];
  return `<p>${esc(sentenceLabel(c.status))}</p>${c.issues.length ? `<ul>${c.issues.map(i => `<li>${esc(i)}</li>`).join('')}</ul>` : ''}<p class="meta">${esc(report.note)}</p>
    ${inspectorActions({ label: 'Claim record', id: 'ms-claim-keep-acts', actions: [{ id: 'ms-claim-keep', label: 'Keep claim record', icon: 'proposals' }] })}`;
}

function reviewedHtml(claims) {
  const shown = pageOf(claims, claimPage, CLAIM_PAGE); claimPage = shown.page;
  return uiList({ label: 'Claim records', id: 'ms-claims-list',
    rows: shown.items.map(c => uiRow({ main: { html: esc(c.text), detail: [sentenceLabel(c.status), sentenceLabel(c.currentSourceStatus)], wrap: true } })) })
    + pager({ id: 'ms-claims-pages', page: shown.page, pages: shown.pages, total: claims.length, size: CLAIM_PAGE, label: 'claims' });
}

function claimsSection(s, ctx) {
  const claims = claimLedger(s);
  if (report && report.sourceSnapshot !== proposalSourceSnapshot(s)) { report = null; claimNote = 'Sources changed. Check evidence again.'; }
  // The page is asked for only when the quote is on a PDF page.
  const fields = formField('Claim', `<textarea id="ms-claim-text" rows="3" maxlength="4000" spellcheck="true" required>${esc(claim.text)}</textarea>`)
    + formField('Source', recordPicker({ id: 'ms-claim-source', label: 'Source record', records: s.papers || [], value: claim.source }))
    + formField('Section', `<select id="ms-claim-kind"><option value="abstract"${claim.kind === 'abstract' ? ' selected' : ''}>Abstract</option><option value="pdf"${claim.kind === 'pdf' ? ' selected' : ''}>PDF page</option></select>`)
    + (claim.kind === 'pdf' ? formField('Page', `<input id="ms-claim-page" inputmode="numeric" autocomplete="off" value="${esc(claim.page)}">`) : '')
    + formField('Exact quote', `<textarea id="ms-claim-quote" rows="3" maxlength="8000" spellcheck="false">${esc(claim.quote)}</textarea>`);
  const body = claimOpen
    ? `<form id="ms-claim-form"><div class="an-settings">${fields}</div>
        ${inspectorActions({ label: 'Claim actions', id: 'ms-claim-acts', start: { message: claimNote },
          actions: [{ id: 'ms-claim-clear', label: 'Clear' }, { id: 'ms-claim-check', label: 'Check evidence', icon: 'check-square', type: 'submit', disabled: busy }] })}</form>
      <div id="ms-claim-report">${reportHtml()}</div>`
    // closed: the one way in, a link on the section's text edge (a lone button at the far end of an empty row read as misplaced), and what the last check said
    : `<p class="ms-claim-start">${uiLink({ id: 'ms-claim-new', label: 'Check a claim', icon: 'check-square' })}${claimNote ? `<span class="meta">${esc(claimNote)}</span>` : ''}</p>`;
  const kept = claims.length ? disclosure({ id: 'ms-claims-reviewed', title: 'Claim records', count: claims.length, open: reviewedOpen, body: reviewedHtml(claims) }) : '';
  return { title: 'Claims', meta: claims.length ? String(claims.length) : '', html: claimOpen ? body + kept : kept + body, wire: host => wireClaims(host, ctx) };
}

function wireClaims(host, ctx) {
  const say = t => { claimNote = t; const m = live('#ms-claim-acts .ui-bar-message'); if (m) m.textContent = t; };
  const details = host.querySelector('#ms-claims-reviewed');
  if (details) {
    details.addEventListener('toggle', () => { reviewedOpen = details.open; });
    const pages = () => wirePager(details, 'ms-claims-pages', next => {
      claimPage = next;
      details.querySelector('.ui-disclosure-body').innerHTML = reviewedHtml(claimLedger(get()));
      pages();
      details.querySelector('#ms-claims-pages [data-page]:not(:disabled)')?.focus();
    });
    pages();
  }
  host.querySelector('#ms-claim-new')?.addEventListener('click', () => { claimOpen = true; ctx.refreshDetails?.(); live('#ms-claim-text')?.focus(); });
  const form = host.querySelector('#ms-claim-form');
  if (!form) return;
  const invalidate = () => { revision++; report = null; live('#ms-claim-report')?.replaceChildren(); };
  wireRecordPicker(form, { id: 'ms-claim-source', label: 'Source record', records: () => get().papers || [],
    onSelect: id => { claim.source = id; invalidate(); }, onError: error => say(error.message) });
  for (const [sel, key] of [['#ms-claim-text', 'text'], ['#ms-claim-quote', 'quote'], ['#ms-claim-page', 'page']]) {
    const input = form.querySelector(sel);
    if (input) input.oninput = e => { claim[key] = e.target.value; invalidate(); };
  }
  form.querySelector('#ms-claim-kind').onchange = e => {
    claim.kind = e.target.value; invalidate(); ctx.refreshDetails?.();
    live(claim.kind === 'pdf' ? '#ms-claim-page' : '#ms-claim-kind')?.focus();
  };
  form.querySelector('#ms-claim-clear').onclick = () => { claim = blank(); claimOpen = false; report = null; revision++; claimNote = ''; ctx.refreshDetails?.(); };
  wireReport(ctx, say);
  form.onsubmit = e => { e.preventDefault(); return check(ctx, say); };
}

function wireReport(ctx, say) {
  const keep = live('#ms-claim-keep');
  if (keep) keep.onclick = () => {
    try {
      if (!report || owner !== projectGeneration()) throw new Error('The project was replaced. Check evidence again.');
      if (report.sourceSnapshot !== proposalSourceSnapshot(get())) { report = null; live('#ms-claim-report')?.replaceChildren(); throw new Error('Sources changed. Check evidence again.'); }
      proposeClaimReview(get(), report);
      claim = blank(); claimOpen = false; report = null; revision++; claimNote = '';
      ctx.refreshDetails?.(); ctx.openProposals?.();
    } catch (error) { say(error.message); }
  };
}

/** One evidence check. A claim edited, a source changed or the project replaced while it runs makes its result void. */
async function check(ctx, say) {
  if (busy) return;
  const draft = structuredClone(claim), quote = draft.quote.trim(), rev = revision, gen = projectGeneration();
  if (!draft.text.trim()) { say('Write the claim first'); return; }
  if (draft.kind === 'pdf' && quote && !(Number.isInteger(Number(draft.page)) && Number(draft.page) > 0)) { say('Give the PDF page'); return; }
  const button = () => live('#ms-claim-check');
  busy = true; button()?.setAttribute('aria-busy', 'true'); if (button()) button().disabled = true; say('Checking…');
  try {
    const sourceSnapshot = proposalSourceSnapshot(get());
    const checked = await auditClaims(get(), { claims: [{ text: draft.text,
      locators: draft.source && quote ? [{ doc_id: draft.source, kind: draft.kind, quote, ...(draft.kind === 'pdf' ? { page: Number(draft.page) } : {}) }] : [],
      result_tokens: resultTokens(draft.text).map(r => r.key) }] });
    if (gen !== projectGeneration()) { own(); throw new Error('The project was replaced. Check evidence again.'); }
    if (rev !== revision || sourceSnapshot !== proposalSourceSnapshot(get())) throw new Error('Claim or sources changed during the check. Check evidence again.');
    report = { ...checked, sourceSnapshot };
    const target = live('#ms-claim-report');
    if (target) { target.innerHTML = reportHtml(); wireReport(ctx, say); target.scrollIntoView?.({ block: 'nearest' }); }
    say('');
  } catch (error) { say(error.message); }
  finally { busy = false; const b = button(); if (b) { b.disabled = false; b.removeAttribute('aria-busy'); } }
}
