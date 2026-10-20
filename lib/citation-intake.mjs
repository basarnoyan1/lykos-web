// A citation supplied in chat becomes a proposed library record. The proposal
// never writes state; the reference form validates and saves it after review.
import { parseRecords } from './bib.mjs';

const DOI = /10\.\d{4,9}\/[^\s"'<>]+/i;
const normalize = value => String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const short = (value, limit = 500) => String(value || '').trim().slice(0, limit);

export function doiIn(text) {
  return String(text || '').match(DOI)?.[0].replace(/[.,;:)\]]+$/, '') || '';
}

/** Capability questions wait for a citation; a bare citation is accepted only
 * after one of those questions. Ordinary chat questions never become actions. */
export function citationIntent(message, awaiting = false) {
  const text = String(message || '').trim();
  const add = /\b(?:add|import|save|create)\b/i.test(text) && /\b(?:citation|reference|paper|article|publication)\b/i.test(text);
  const future = /\b(?:if|when|once)\s+(?:I|we)\s+(?:give|send|paste|provide)\b/i.test(text);
  const structured = /^\s*(?:TY\s+-|@\w+\s*\{|\{\s*"(?:title|type)"|\[\s*\{)/i.test(text);
  const doi = Boolean(doiIn(text));
  const citation = structured || doi || (/\b(?:19|20)\d{2}\b/.test(text) && text.split(/\s+/).length >= 6 && /[.;]\s/.test(text));
  const titled = add && /\b(?:citation|reference|paper|article)\s*[:—-]\s*.{18,}/i.test(text);
  const capabilityQuestion = /^(?:can|could|would|will) you\b/i.test(text) && !structured && !doi && !titled;
  if (add && ((!citation && !titled) || future || capabilityQuestion)) return { awaiting: true, source: '' };
  if ((add || awaiting) && (citation || titled)) return { awaiting: false, source: text };
  return { awaiting: false, source: '' };
}

/** Keep only model fields supported by the user's text. Registry metadata is
 * handled separately because its source is the DOI lookup, not the model. */
export function citationSeed(raw, proposed = {}, registry = null) {
  const source = short(raw, 6000);
  let parsed;
  try { parsed = parseRecords(source, 'citation.txt').records[0]; }
  catch { /* A malformed paste remains editable in the review form. */ }
  const candidate = registry || parsed || proposed || {};
  const fromRegistry = Boolean(registry);
  const present = value => Boolean(normalize(value)) && normalize(source).includes(normalize(value));
  const title = short(candidate.title, 600);
  const year = short(candidate.year, 4);
  const journal = short(candidate.journal, 300);
  const authors = (Array.isArray(candidate.authors) ? candidate.authors : String(candidate.authors || '').split(/;|\n/))
    .map(x => short(x, 160)).filter(Boolean).slice(0, 30)
    .filter(a => fromRegistry || present(a) || present(a.split(/[\s,]+/)[0]));
  return {
    title: fromRegistry || present(title) ? title : '',
    authors,
    journal: fromRegistry || present(journal) ? journal : '',
    year: fromRegistry || source.includes(year) ? year : '',
    doi: doiIn(source) || (fromRegistry ? short(candidate.doi, 200) : ''),
    url: fromRegistry ? short(candidate.url, 1000) : '',
    source: fromRegistry ? (candidate.source || 'Crossref') : 'User citation',
    rawCitation: source,
  };
}
