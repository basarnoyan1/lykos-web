// A request to a study's corresponding author for the data the paper does not report (plan §3 C4 and L4, research tools review row 20,
// 2026-10-23). For one study of an extraction table: the fields it does not report (NR, a word the table uses for it, or no value yet),
// the address to write to (found in the record or the paper's own text, never made up), and a polite, specific draft with the paper's
// citation. Nothing is sent: the draft is edited and copied, or opened in the person's mail program. When it is copied or opened, each
// field is noted as requested on that day, per study and field.
//
//   state.authorRequests  { [paperId]: { to, fields: { [fieldId]: 'YYYY-MM-DD' } } }
import { formatReference } from './cite.mjs';
import { authorList } from './bib.mjs';
import { day } from './dates.mjs';

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const clean = e => String(e).replace(/^[._-]+|[._-]+$/g, '').replace(/\.+$/, '');

/**
 * The fields a study does not report, from the data summary's counts (`summaries`, lib/extraction-summary.mjs over the table's studies):
 * [{ id, label, unit, definition, state: 'not_reported' | 'missing' }]. A field that names the study (its citation, an ID) is never asked for.
 */
export function missingFields(paperId, summaries = [], columns = []) {
  const byId = new Map(columns.map(c => [c.id, c])), out = [];
  for (const f of summaries) {
    if (f.kind === 'label') continue;
    const c = byId.get(f.id) || {};
    if (/^(#|no\.?|id|identifier|study id|record id)$/i.test(String(f.label || '').trim())) continue;
    const holds = (k) => f.states[k]?.studies?.some(s => (s.paperId || String(s.cell).split(':')[0]) === paperId);
    const nr = holds('not_reported') || Object.keys(f.states).some(k => k.startsWith('written:') && holds(k));
    const state = nr ? 'not_reported' : holds('missing') ? 'missing' : '';
    if (state) out.push({ id: f.id, label: f.label, unit: f.unit || c.unit || '', definition: String(c.definition || '').trim(), state });
  }
  return out;
}

/**
 * The addresses a record and its paper's text hold, the corresponding author's first: [{ email, where }]. `texts` are the pages of the
 * paper (first pages first). An address beside "correspond" (Corresponding author, Correspondence to) leads; one in the record's own
 * fields next; then any other in the paper. Never one that is not written there.
 */
export function authorEmails(paper, texts = []) {
  const seen = new Map();
  const add = (email, where, rank) => { const e = clean(email).toLowerCase(); if (!e.includes('@') || /example\.(com|org)$|@(journal|publisher|elsevier|springer|wiley)\./.test(e)) return; const was = seen.get(e); if (!was || was.rank > rank) seen.set(e, { email: clean(email), where, rank }); };
  for (const k of ['email', 'correspondingEmail', 'correspondence', 'address', 'affiliation', 'affiliations', 'notes', 'note', 'abstract']) {
    const v = paper?.[k]; const s = Array.isArray(v) ? v.join(' ') : typeof v === 'string' ? v : '';
    for (const m of s.matchAll(EMAIL)) add(m[0], 'the record', /correspond/i.test(s.slice(Math.max(0, m.index - 160), m.index)) ? 0 : 1);
  }
  texts.forEach((t, page) => {
    const s = String(t || '');
    for (const m of s.matchAll(EMAIL)) add(m[0], `page ${page + 1} of the paper`, /correspond|e-?mail address|electronic address|reprint/i.test(s.slice(Math.max(0, m.index - 200), m.index + 40)) ? 0 : 2);
  });
  return [...seen.values()].sort((a, b) => a.rank - b.rank).map(({ email, where }) => ({ email, where }));
}

/** The surname of the author whose name the address carries ("smith.j@…" for J Smith), else ''. */
function surnameFor(email, paper) {
  const local = String(email || '').split('@')[0].toLowerCase().replace(/[^a-z]/g, ' ');
  const parts = local.split(/\s+/).filter(Boolean);
  for (const name of authorList(paper?.authors)) {
    // a name's words of three letters or more (initials are not a surname): "Smith J", "Smith, John", "John Smith"
    for (const w of String(name).replace(/[,.]/g, ' ').split(/\s+/).filter(x => x.length >= 3)) {
      const lw = w.toLowerCase();
      if (parts.some(p => p === lw || (p.length >= 4 && lw.startsWith(p)) || (lw.length >= 4 && p.includes(lw)))) return w;
    }
  }
  return '';
}

const fieldLine = f => `- ${f.label}${f.unit && !String(f.label).includes(f.unit) ? ` (${f.unit})` : ''}${f.definition ? `: ${f.definition.replace(/\s+/g, ' ').slice(0, 160)}` : ''}`;

/**
 * The draft: { to, subject, body }. `review` names the review in a few words (the project's title), `sender` signs it ('' leaves a place
 * to sign). The request is specific: each field by name, with its unit and definition, and the paper by its citation.
 */
export function draftRequest({ paper, fields = [], to = '', review = '', sender = '' }) {
  const who = surnameFor(to, paper), label = paper?.label || paper?.title || 'your study';
  const cite = paper ? formatReference(paper, 'vancouver') : '';
  const body = [
    who ? `Dear Dr ${who},` : 'Dear colleague,',
    '',
    `I am preparing a systematic review${review ? ` on ${review.replace(/\.$/, '')}` : ''} and have included your study:`,
    '',
    cite || label,
    '',
    `The paper does not report ${fields.length === 1 ? 'one item' : 'some items'} that the review extracts from every included study. Could you share ${fields.length === 1 ? 'it, if it is' : 'them, if they are'} available?`,
    '',
    ...fields.map(fieldLine),
    '',
    'Summary figures for the study as a whole are enough; no individual patient data are needed. Your study will be cited, and your help will be acknowledged in the review.',
    '',
    'Thank you for considering this request.',
    '',
    'Kind regards,',
    sender || '[Your name]',
  ].join('\n');
  return { to, subject: `Request for unreported data: ${label}`, body };
}

/** A mailto: link that opens the draft in the person's mail program; nothing is sent from Lykos. */
export const mailtoUrl = ({ to = '', subject = '', body = '' }) =>
  `mailto:${encodeURIComponent(to).replace(/%40/g, '@')}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;

/** The draft as text to copy: the address and subject, then the letter. */
export const draftText = d => [d.to ? `To: ${d.to}` : '', `Subject: ${d.subject}`, '', d.body].filter((x, i) => i || x).join('\n');

// ---- requested notes ----------------------------------------------------------------------------------------------------------
export function normaliseRequests(r) {
  if (!r || typeof r !== 'object' || Array.isArray(r)) return {};
  return Object.fromEntries(Object.entries(r).filter(([id, e]) => id && e && typeof e === 'object' && e.fields && typeof e.fields === 'object')
    .map(([id, e]) => [id, { to: String(e.to || ''), fields: Object.fromEntries(Object.entries(e.fields).filter(([, d]) => /^\d{4}-\d{2}-\d{2}/.test(String(d)))) }]));
}
/** Notes the fields as requested from the study's author on `date` (YYYY-MM-DD). Mutates and returns the state. */
export function noteRequested(st, paperId, fieldIds, { to = '', date = new Date().toISOString().slice(0, 10) } = {}) {
  const all = normaliseRequests(st.authorRequests), e = all[paperId] || { to: '', fields: {} };
  for (const id of fieldIds) e.fields[id] = date;
  if (to) e.to = to;
  all[paperId] = e; st.authorRequests = all;
  return st;
}
/** The day a field of a study was requested, or ''. */
export const requestedOn = (st, paperId, fieldId) => st?.authorRequests?.[paperId]?.fields?.[fieldId] || '';
/** "Requested from the author on 23 Oct": a cell's tooltip line, '' when it was not. */
export const requestedText = (st, paperId, fieldId) => { const d = requestedOn(st, paperId, fieldId); return d ? `Requested from the author on ${day(d)}` : ''; };
