// A journal's email, pasted or dropped on Submission, read into what it records: the journal, the manuscript number, the editorial
// system, what happened (submitted, revision requested, revision received, accepted, rejected, rejected without review) and the date.
// Editorial systems have no author API (Elsevier's Editorial Manager: "log in … to track the status"), and Lykos keeps no password,
// so the journal's own emails are the record. Pure: the result is a proposal (lib/submissions.mjs proposalFor) a person applies.

const SYSTEMS = [[/editorialmanager\.com|editorial manager/i, 'Editorial Manager'], [/manuscriptcentral\.com|scholarone/i, 'ScholarOne'],
  [/ejournalpress\.com|ejpress/i, 'eJournalPress'], [/snapp\.springernature|springernature\.com\/submit/i, 'Springer Nature SNAPP']];
// What happened, most specific first; the first that matches is the email's event.
const EVENTS = [
  ['accepted', /\b(accepted for publication|pleased to (?:inform you that your (?:manuscript|paper|submission) has been )?accept|decision:\s*accept)/i],
  ['rejected-desk', /\b(without (?:external |peer )?review|not (?:to )?(?:be(?:en)? )?sen[dt] (?:it |them |your (?:manuscript|paper) )?(?:out )?for (?:external |peer )?review|editorial (?:rejection|decision not to review)|desk.reject)/i],
  ['rejected', /\b(reject|not (?:be )?(?:suitable|acceptable) for publication|unable to (?:accept|publish|offer)|decided not to (?:accept|publish|proceed)|decision:\s*decline)/i],
  ['revise', /\b((?:major|minor) revision|revise and resubmit|revisions? (?:is|are) (?:required|needed|requested)|decision:\s*revis|please revise|invite you to (?:revise|resubmit))/i],
  ['revised', /\b(revised (?:manuscript|version|submission) (?:has been|was) (?:received|submitted)|(?:received|thank you for submitting) (?:your|the) revis)/i],
  ['submitted', /\b(assigned a manuscript number|(?:has|have) been (?:successfully )?(?:received|submitted)|thank you for (?:your )?submi|(?:confirming|confirm) (?:the )?(?:receipt|submission)|(?:confirm) co-?authorship)/i],
];
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const pad = n => String(n).padStart(2, '0');

/** The email's date as YYYY-MM-DD: its Date: header, else the first date written in it; '' when it states none. */
export function emailDate(text) {
  const t = String(text || ''), head = /^(?:date|sent):\s*(.+)$/im.exec(t)?.[1] || t;
  let m = /(\d{4})-(\d{2})-(\d{2})/.exec(head); if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = /\b(\d{1,2})\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?,?\s+(\d{4})/i.exec(head);
  if (m) return `${m[3]}-${pad(MONTHS.indexOf(m[2].toLowerCase()) + 1)}-${pad(m[1])}`;
  m = /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2}),?\s+(\d{4})/i.exec(head);
  if (m) return `${m[3]}-${pad(MONTHS.indexOf(m[1].toLowerCase()) + 1)}-${pad(m[2])}`;
  return '';
}

/**
 * What a journal email says: { journal, manuscriptId, system, kind, desk, at, subject }, each '' (false) when the email does not state
 * it. `kind` is a lib/submissions.mjs event kind; a status email that records no step (a reminder) has kind ''.
 */
export function readJournalEmail(text) {
  const t = String(text || '').replace(/\r/g, '');
  const subject = (/^subject:\s*(.+)$/im.exec(t)?.[1] || '').trim();
  const manuscriptId = (/\bmanuscript\s*(?:number|id|no\.?|#)\s*[:#]?\s*([A-Z][A-Z0-9]*(?:[-_.][A-Z0-9]+){1,5})/i.exec(t)?.[1]
    || /\b([A-Z]{2,8}-[A-Z]-\d{2}-\d{3,6}(?:R\d)?)\b/.exec(t)?.[1] || /\b([A-Z]{2,10}-\d{2,4}-\d{3,6}(?:\.R\d)?)\b/.exec(t)?.[1] || '').toUpperCase();
  const journal = (/^\s*journal:\s*(.+)$/im.exec(t)?.[1] || /\b(?:submission|manuscript|decision on (?:your )?(?:submission|manuscript))\s+to\s+([A-Z][^\n.,;:-]{2,80}?)(?:\s*[-–:]|\s*$)/m.exec(subject)?.[1]
    || /\b(?:submission|submit(?:ting|ted)?(?: your (?:work|manuscript|paper|article))?) to ([A-Z][\w&':' -]{2,80}?)(?:[.,\n]| -|$)/m.exec(t)?.[1] || /(?:kind|best) regards,?\s*\n\s*([A-Z][^\n]{2,80})\n/i.exec(t)?.[1] || '').trim().replace(/\s+/g, ' ');
  const system = SYSTEMS.find(([re]) => re.test(t))?.[1] || '';
  const hit = EVENTS.find(([, re]) => re.test(`${subject}\n${t}`))?.[0] || '';
  const kind = hit === 'rejected-desk' ? 'rejected' : hit;
  return { journal, manuscriptId, system, kind, desk: hit === 'rejected-desk', at: emailDate(t), subject };
}

/**
 * The proposal for lib/submissions.mjs proposalFor: the attempt the email is about (by its manuscript number, else its journal), or a new
 * one; the event with the letter kept when it is a decision. Answers { payload, read } or { error } saying what the email lacks.
 */
export function emailProposal(text, list, { today = '' } = {}) {
  const read = readJournalEmail(text);
  if (!read.kind) return { error: 'This email records no step (submitted, revision requested, revision received, accepted or rejected)', read };
  const at = read.at || today;
  const key = s => String(s || '').toLowerCase().replace(/^the\s+/, '').replace(/[^a-z0-9]+/g, ' ').trim();
  const name = a => a.journal?.label || a.journal?.name || (typeof a.journal === 'string' ? a.journal : '');
  const a = (read.manuscriptId && list.find(x => String(x.manuscriptId || '').toUpperCase() === read.manuscriptId))
    || (read.journal && [...list].reverse().find(x => key(name(x)) === key(read.journal))) || null;
  if (!a && !read.journal) return { error: 'The email does not name its journal; add the submission first, then read the email again', read };
  const letter = ['revise', 'rejected', 'accepted'].includes(read.kind) ? String(text).slice(0, 100000) : undefined;
  return { read, payload: { ...(a ? { attemptId: a.id } : { journal: read.journal }), event: { kind: read.kind, at, ...(read.desk ? { desk: true } : {}), ...(letter ? { letter } : {}) },
    source: String(text).slice(0, 4000) } };
}
