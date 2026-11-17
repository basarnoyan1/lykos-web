// Reference-list style consistency (RESEARCH-GAPS R4). Pure: no network, no model, no state.
//
// Works on the typed list that lib/reference-list.mjs parsed and matched (checkCitations' answer) and on the project's reference
// style (lib/journal-profiles.mjs referenceStyle). Each matched entry is regenerated with lib/cite.mjs formatReference and read
// back with parseEntry; the typed entry is then compared in tolerant terms only: the author count and the "et al." rule, where
// the year stands, the issue and pages, the DOI, a journal named in full or abbreviated, a closing full stop. Spelling,
// punctuation inside a field and the order of fields beyond the year are never compared, and a field the library lacks is never
// a finding. A list that is uniform is silent, whichever way it is uniform: the journal, DOI, page and full-stop findings
// report a mixture, not a preference. Findings are summary lines with counts, each placed on the first entry it concerns.
import { formatReference, STYLES } from './cite.mjs';
import { parseEntry, entryName } from './reference-list.mjs';
import { abbreviateJournal, journalShort } from './bib.mjs';

const textOf = b => b?.text ?? (b?.runs || []).map(r => r.t || '').join('');
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const lower = s => String(s || '').toLowerCase();
const letters = s => lower(s).replace(/[^\p{L}\p{N} ]+/gu, ' ').replace(/\s+/g, ' ').trim();
const STOP = new Set(['of', 'the', 'and', 'for', 'in', 'on', 'de', 'la', 'des', 'et', 'und', 'der', 'die', 'das', 'le', 'a', 'an']);
const words = s => letters(s).split(' ').filter(w => w && !STOP.has(w));

export const styleNumbered = id => (STYLES.find(s => s.id === id) || STYLES[0]).numbered;

/**
 * Whether a typed journal is the record's full name or an abbreviation of it: 'full', 'abbr', or '' when it cannot be told
 * (a one-word title reads the same both ways, and a name that is neither is left alone).
 */
export function journalForm(typed, paper) {
  const t = letters(typed), full = letters(paper?.journal);
  if (!t || !full) return '';
  if (t === full) return words(full).length > 1 || (paper.journalAbbr && letters(paper.journalAbbr) !== full) ? 'full' : '';
  const known = [paper.journalAbbr, abbreviateJournal(paper.journal)].map(letters).filter(Boolean);
  if (known.includes(t)) return 'abbr';
  // every typed word begins a word of the full name, in order: "Stat Med" for "Statistics in Medicine"
  const fw = words(full), tw = words(t);
  if (tw.length < 1 || tw.length > fw.length) return '';
  let i = 0;
  for (const w of tw) {
    while (i < fw.length && !fw[i].startsWith(w)) i++;
    if (i === fw.length) return '';
    i++;
  }
  return tw.join(' ') === fw.join(' ') ? 'full' : 'abbr';
}

/** The DOI as written: 'link' (https://doi.org/…), 'prefix' (doi:…), 'bare', or '' for an entry with none. */
const doiForm = e => {
  if (!e.doi) return '';
  const at = e.text.toLowerCase().indexOf(e.doi.toLowerCase());
  const before = e.text.slice(Math.max(0, at - 24), at).toLowerCase();
  return /https?:\/\/(?:dx\.)?doi\.org\/$/.test(before) ? 'link' : /doi:?\s*$/.test(before) ? 'prefix' : 'bare';
};

/** 'elided' for "1539-58", 'full' for "1539-1558", '' for a single page, an e-locator or no pages. */
const pageForm = pages => {
  const m = /^(\d+)[-–](\d+)$/.exec(String(pages || ''));
  if (!m) return '';
  return m[2].length < m[1].length ? 'elided' : m[2] === m[1] ? '' : 'full';
};

/** Whether the entry closes with a full stop (after a DOI, the one that ends the entry); '' for an empty entry. */
const closes = e => { const t = e.text.trim(); return t ? (/\.$/.test(t) ? 'yes' : 'no') : ''; };

/**
 * The style findings for a checked list: `{ issues, regenerated, complete }`.
 *   issues       [{ severity: 'note', kind: 'ref-style', message, blockId, at, ref }], like checkCitations' issues; none when
 *                the list is empty, not typed, or consistent
 *   regenerated  per matched entry the list item in the style, { entry, paper, text }
 *   complete     every entry is matched to a library record (a generated list may then replace the typed one)
 * `result` is checkCitations' answer; `style` the project's referenceStyle id.
 */
export function checkReferenceStyle(result, { style = '' } = {}) {
  const none = { issues: [], regenerated: [], complete: false };
  if (!result?.list?.typed || !result.list.entries.length) return none;
  const entries = result.list.entries;
  const styleId = style || (result.list.numbered ? 'vancouver' : 'apa');
  const wantForm = styleNumbered(styleId) ? 'vancouver' : 'author-year';
  const issues = [];
  const add = (message, e, at = 0) => issues.push({ severity: 'note', kind: 'ref-style', message, blockId: e.blockId, at, ref: e.key });
  const matched = result.matches.filter(m => m.paper);

  // where the year stands: after the authors (author–year) or after the journal (numbered); an entry in the other form is
  // reported once and left out of every other comparison, since its other fields cannot be compared with this style's
  const wrong = entries.filter(e => e.form && e.form !== wantForm);
  if (wrong.length)
    add(wantForm === 'vancouver' ? `${plural(wrong.length, 'entry has', 'entries have')} the year after the authors; the style puts it after the journal`
      : `${plural(wrong.length, 'entry has', 'entries have')} the year after the journal; the style puts it after the authors`, wrong[0]);
  const wrongSet = new Set(wrong);

  // regenerated entries, compared field by field
  const lacking = { issue: [], pages: [] };
  const regenerated = [];
  for (const { entry: e, paper: p } of matched) {
    const text = formatReference(p, styleId);
    regenerated.push({ entry: e, paper: p, text });
    if (wrongSet.has(e) || e.form !== wantForm) continue;
    const gen = parseEntry(text);
    const listed = e.authors.length, etAl = /\bet al\b/i.test(e.text);
    const total = (Array.isArray(p.authors) ? p.authors : String(p.authors || '').split(/;/)).filter(Boolean).length;
    // authors: the style names how many come before "et al." (or lists them all); a typed count is compared only where the
    // record holds more authors than the entry shows, so a library that kept the first author alone never contradicts it
    if (listed && total) {
      const genEtAl = /\bet al\b/i.test(text);
      if (etAl && genEtAl && listed !== gen.authors.length && total > gen.authors.length)
        add(`${entryName(e)} lists ${plural(listed, 'author', 'authors')} before et al., style says ${gen.authors.length}`, e);
      else if (etAl && !genEtAl && total > listed)
        add(`${entryName(e)} uses et al. after ${plural(listed, 'author', 'authors')}, style lists all ${total}`, e);
      else if (!etAl && genEtAl && listed > gen.authors.length)
        add(`${entryName(e)} lists ${listed} authors, style says ${gen.authors.length} then et al.`, e);
    }
    if (e.volume && !e.issue && gen.issue) lacking.issue.push(e);
    if ((e.volume || e.journal) && !e.pages && gen.pages) lacking.pages.push(e);
  }
  if (lacking.issue.length) add(`Issue number missing in ${plural(lacking.issue.length, 'entry', 'entries')}`, lacking.issue[0]);
  if (lacking.pages.length) add(`Pages missing in ${plural(lacking.pages.length, 'entry', 'entries')}`, lacking.pages[0]);

  // the list against itself: only a mixture is reported
  const mix = (a, b, said) => { if (a.length && b.length) add(said(a.length, b.length), (a.length <= b.length ? a : b)[0]); };
  const comparable = entries.filter(e => !wrongSet.has(e));
  const forms = matched.filter(m => !wrongSet.has(m.entry)).map(m => ({ e: m.entry, f: journalForm(m.entry.journal, m.paper) })).filter(x => x.f);
  mix(forms.filter(x => x.f === 'full').map(x => x.e), forms.filter(x => x.f === 'abbr').map(x => x.e),
    (a, b) => `${plural(a, 'entry uses', 'entries use')} full journal names, ${b} abbreviated`);
  mix(comparable.filter(e => pageForm(e.pages) === 'full'), comparable.filter(e => pageForm(e.pages) === 'elided'),
    (a, b) => `${plural(a, 'entry gives', 'entries give')} full page ranges, ${b} shortened`);

  // DOI: absent where the library has one, once the list uses DOIs at all; and one written form
  const withDoi = comparable.filter(e => e.doi);
  if (withDoi.length) {
    const missing = matched.map(m => m.entry).filter(e => !wrongSet.has(e) && !e.doi && cleanOf(matched, e));
    if (missing.length) add(`DOI missing in ${plural(missing.length, 'entry', 'entries')}`, missing[0]);
    const kinds = new Map();
    for (const e of withDoi) { const k = doiForm(e); kinds.set(k, [...(kinds.get(k) || []), e]); }
    if (kinds.size > 1) {
      const sorted = [...kinds.entries()].sort((x, y) => y[1].length - x[1].length);
      const name = k => k === 'link' ? 'a link' : k === 'prefix' ? 'doi:' : 'the bare number';
      add(`${sorted.map(([k, l], i) => (i ? `${l.length} as ${name(k)}` : `${plural(l.length, 'entry gives', 'entries give')} the DOI as ${name(k)}`)).join(', ')}`, sorted.at(-1)[1][0]);
    }
  }

  // a closing full stop
  const stops = comparable.map(e => ({ e, c: closes(e) })).filter(x => x.c);
  mix(stops.filter(x => x.c === 'yes').map(x => x.e), stops.filter(x => x.c === 'no').map(x => x.e),
    (a, b) => `${plural(a, 'entry ends', 'entries end')} with a full stop, ${b} without`);

  return { issues, regenerated, complete: matched.length === entries.length };
}

/** The matched record of an entry holds a DOI. */
const cleanOf = (matched, e) => Boolean(matched.find(m => m.entry === e)?.paper?.doi);

/**
 * The generated list as edits: `[{ blockId, hash-source text, text }]` for every entry whose text differs, or null when a
 * generated list may not replace the typed one (an entry the library does not hold, one that shares its paragraph, or a
 * reference manager's bibliography). Each entry keeps the number it carried. The journal is abbreviated where most of the
 * typed list abbreviates it.
 */
export function generatedList(result, blocks, { style = '' } = {}) {
  const check = checkReferenceStyle(result, { style });
  if (!check.complete || !check.issues.length) return null;
  const { entries, numbered } = result.list;
  if (entries.some(e => !e.whole || e.bib)) return null;
  const styleId = style || (numbered ? 'vancouver' : 'apa');
  const abbr = check.regenerated.filter(r => journalForm(r.entry.journal, r.paper) === 'abbr').length;
  const full = check.regenerated.filter(r => journalForm(r.entry.journal, r.paper) === 'full').length;
  const edits = [];
  for (const { entry: e, paper } of check.regenerated) {
    const b = blocks.find(x => x.id === e.blockId);
    if (!b) return null;
    const lead = /^\s*(?:\[\d{1,3}\]|\d{1,3}[.)])\s*/.exec(e.text)?.[0] || '';
    const p = abbr > full ? { ...paper, journal: journalShort(paper) } : paper;
    const text = `${lead}${formatReference(p, styleId)}`;
    if (text.trim() !== textOf(b).trim()) edits.push({ blockId: b.id, text });
  }
  return edits.length ? edits : null;
}
