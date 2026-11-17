// A reference of a registered manuscript, as the reader's side panel shows it (views/manuscript-reference.mjs). 3 Nov 2026, the owner,
// on the reader's reference list, where only entries matched to a project record opened anything: "not all papers have the hover click
// thing?", and "at least when clicked i should see how did we used them". So every entry opens, and what it opens leads with the
// manuscript's own uses of the reference: each sentence that cites it, its section and paragraph. Pure: reads the reading model
// (lib/docx-reading.mjs readingModel: units, outline, refs).
import { parseEntry } from './reference-list.mjs';

// the reader's mark on a citation (lib/docx-reading.mjs citeHtml): its reference keys and the text shown
const CITE = /<sup class="msd-cite" data-refs="([^"]+)"[^>]*>([^<]*)<\/sup>/g;
const plainLength = html => html.replace(/<[^>]*>/g, '').replace(/&(amp|lt|gt|quot|#39);/g, 'x').length;
// a sentence ends at its stop, with the citation marks the text raises after it ("…in 2001.8 The debate")
const SENTENCE = /(?<=[.!?][\de,–-]*)\s+(?=[A-Z([])/;

/**
 * Where the manuscript cites reference `key` ("8", "e12"): [{ unit, section, paragraph, before, cite, after }], one per citation in the
 * order of the text. `section` is the heading the citation is under ("Methods, Synthesis": the level-1 heading, then the nearest one when
 * it differs); `paragraph` counts the paragraphs under that heading; `before`, `cite` and `after` are the sentence around the citation,
 * split at the mark the text shows ("8" or "7–9").
 */
export function usesOf(model, key) {
  const units = model?.units || [], heads = (model?.outline || []).filter(o => !o.caption), out = [];
  units.forEach((u, k) => {
    if (!u.html || !u.html.includes('data-refs=')) return;
    for (const m of u.html.matchAll(CITE)) {
      if (!m[1].split(' ').includes(key)) continue;
      const at = plainLength(u.html.slice(0, m.index)), text = u.text || '', shown = m[2];
      if (text.slice(at, at + shown.length) !== shown) continue;
      // the sentence the citation closes or sits in
      let from = 0, to = text.length;
      for (const s of text.split(SENTENCE)) { const start = text.indexOf(s, from), end = start + s.length; if (at >= start && at < end + 1) { from = start; to = end; break; } from = end; }
      const sentence = text.slice(from, to).trim(), off = at - text.indexOf(sentence, from);
      out.push({ unit: k, ...placeOf(units, heads, k), before: sentence.slice(0, off), cite: shown, after: sentence.slice(off + shown.length) });
    }
  });
  return out;
}
// the heading over unit k (its level-1 heading, then the nearest) and the paragraph's count under the nearest heading
function placeOf(units, heads, k) {
  let near = null, top = null;
  for (const h of heads) { if (h.unit > k) break; near = h; if (h.level <= 1) top = h; }
  const names = [top?.name, near && near !== top ? near.name : ''].filter(Boolean);
  let paragraph = 0;
  for (let i = near ? near.unit + 1 : 0; i <= k; i++) if (units[i]?.kind === 'p') paragraph++;
  return { section: names.join(', ') || 'Title page', paragraph };
}

/**
 * What a reference entry says (lib/docx-reading.mjs referencesOf: key, text, doi, pmid …), read as a record: { key, n, authors, title,
 * journal, year, volume, issue, pages, doi, pmid, text }. `n` is the number the list gives it ("8", "e12").
 */
export function referenceFacts(entry) {
  if (!entry) return null;
  const p = parseEntry(entry.text || '');
  return { key: entry.key, n: entry.key, authors: p.authors || [], title: p.title || entry.title || '', journal: p.journal || entry.journal || '', year: p.year || entry.year || '',
    volume: p.volume || '', issue: p.issue || '', pages: p.pages || '', doi: entry.doi || p.doi || '', pmid: String(entry.pmid || p.pmid || ''), text: entry.text || '' };
}

/** The key a lookup of the reference is cached under: its DOI, else its PMID, else none (a title alone is not looked up here). */
export const lookupKey = f => (f?.doi ? `doi:${String(f.doi).toLowerCase()}` : f?.pmid ? `pmid:${f.pmid}` : '');
export const LOOKUP_DAYS = 30;   // as lib/ref-lookup.mjs REGISTRY_DAYS keeps a registry's answer
/** The cached answer of a lookup, when it is fresh: { at, status: 'found' | 'missing' | 'failed', record? }. */
export function cachedLookup(s, key, now = Date.now()) {
  const a = key && s?.referenceLookups?.[key];
  return a && a.status !== 'failed' && now - Date.parse(a.at || 0) < LOOKUP_DAYS * 864e5 ? a : null;
}
const KEEP = 300;
/** Keeps a lookup's answer in the project (the oldest leave past KEEP). Mutates `s`. */
export function keepLookup(s, key, answer) {
  const all = { ...(s.referenceLookups || {}), [key]: answer };
  const keys = Object.keys(all);
  if (keys.length > KEEP) for (const k of keys.sort((a, b) => Date.parse(all[a].at || 0) - Date.parse(all[b].at || 0)).slice(0, keys.length - KEEP)) delete all[k];
  s.referenceLookups = all;
  return s;
}
