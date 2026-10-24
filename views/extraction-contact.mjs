// Requests to corresponding authors for unreported data (research tools review row 20, 2026-10-23), from a study's row More in Extraction
// or for the studies selected or shown ("Draft requests for 6 studies"). Each study's draft opens in a dialog to edit: Copy puts it on the
// clipboard, Open in Mail hands it to the person's mail program. Nothing is sent from Lykos. Either notes each field as requested that day
// (lib/author-contact.mjs), which the cell's tooltip then says. The address is the one the record or the paper's own text holds, or none.
import { get, update } from '../store.mjs';
import { formDialog, formValues } from '../lib/dialog.mjs';
import { formField } from '../lib/ui-components.mjs';
import { esc } from '../lib/html.mjs';
import { day, plural } from '../lib/dates.mjs';
import { copyText } from '../lib/clipboard.mjs';
import { inDesktop, openUrlNative } from '../lib/native.mjs';
import { missingFields, authorEmails, draftRequest, mailtoUrl, draftText, noteRequested, requestedOn } from '../lib/author-contact.mjs';

/** The pages of a paper's text worth reading for an address: the first two and the last (a correspondence line sits at either end). */
async function pagesOf(paper) {
  if (!paper?.pdf && !paper?.pdfRel) return [];
  try {
    const idx = await (await import('../lib/doctext.mjs')).index(paper.id);
    const pages = idx?.pages || [];
    return pages.map((p, i) => (i < 2 || i === pages.length - 1 ? p.text : ''));
  } catch { return []; }
}

const reviewName = st => String(st.protocol?.title || st.project?.title || st.project?.name || '').trim();
const senderName = st => String(st.settings?.reviewerName || st.settings?.yourName || '').trim();

function openMail(url) {
  if (inDesktop()) return openUrlNative(url);
  const a = document.createElement('a'); a.href = url; a.rel = 'noopener'; document.body.append(a); a.click(); a.remove();
  return Promise.resolve();
}

/** One study's draft in the dialog. Resolves to 'copied', 'opened' or null (skipped or cancelled). */
async function draftOne({ paper, fields }, { at = 0, of = 1 } = {}) {
  const st = get(), found = authorEmails(paper, await pagesOf(paper)), to = found[0]?.email || '';
  const draft = draftRequest({ paper, fields, to, review: reviewName(st), sender: senderName(st) });
  const asked = fields.map(f => requestedOn(st, paper.id, f.id)).filter(Boolean).sort().pop();
  const where = found[0] ? `Address from ${found[0].where}.` : 'No address in the record or the paper.';
  const name = paper.label || paper.title || '', place = `${where}${asked ? ` Requested before on ${day(asked)}.` : ''}`;
  const list = found.length > 1 ? `<datalist id="ext-contact-to">${found.map(f => `<option value="${esc(f.email)}">`).join('')}</datalist>` : '';
  const body = formField('To', `<input name="to" value="${esc(to)}" placeholder="Corresponding author's address" spellcheck="false" autocomplete="off"${list ? ' list="ext-contact-to"' : ''}>${list}`)
    + formField('Subject', `<input name="subject" value="${esc(draft.subject)}" spellcheck="true" autocomplete="off">`)
    + formField('Message', `<textarea name="body" rows="12" spellcheck="true">${esc(draft.body)}</textarea>`);
  const mark = v => update(s => noteRequested(s, paper.id, fields.map(f => f.id), { to: String(v.to || '').trim() }), { indexNeutral: true });
  const r = await formDialog({ id: 'author-request', title: 'Request missing data', detail: `${of > 1 ? `${name}, ${at + 1} of ${of}` : name}. ${place}`,
    body, confirm: 'Open in Mail', cancel: of > 1 ? 'Skip' : 'Cancel', start: { id: 'copy', label: 'Copy' },
    onAct: async (_id, d) => { const v = formValues(d.querySelector('form')); await copyText(draftText(v)); mark(v); return false; },
    submit: async form => { const v = formValues(form); mark(v); try { await openMail(mailtoUrl(v)); } catch {} return { ...v, opened: true }; } });
  return r?.act === 'copy' ? 'copied' : r?.opened ? 'opened' : null;
}

/**
 * Drafts a request for each study that lacks a value, one after another. `papers` the studies, `summaries` the data summary's fields over
 * the table's studies, `columns` the table's columns (their units and definitions), `only` the fields to ask for when the person narrowed
 * the table to studies that do not report them. Says what was done through `say`.
 */
export async function draftRequests({ papers, summaries, columns, only = null, say = () => {} }) {
  const list = papers.map(paper => ({ paper, fields: missingOf(paper.id, summaries, columns, only) })).filter(x => x.fields.length);
  if (!list.length) { say(papers.length === 1 ? 'This study reports every field' : 'Every study shown reports every field'); return 0; }
  let n = 0;
  for (let i = 0; i < list.length; i++) if (await draftOne(list[i], { at: i, of: list.length })) n++;
  say(n ? `${plural(n, 'request')} drafted; nothing was sent` : '');
  return n;
}
/** How many of `papers` lack a value in some field: what "Draft requests for N studies" counts. */
export const studiesMissing = (papers, summaries, columns, only = null) => papers.filter(p => missingOf(p.id, summaries, columns, only).length).length;
/** A study's missing fields; `only` (a set of field ids: the columns filtered to Not reported or Empty) narrows the request to them. */
const missingOf = (id, summaries, columns, only) => missingFields(id, summaries, columns).filter(f => !only?.size || only.has(f.id));
