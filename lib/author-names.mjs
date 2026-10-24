// Author name clustering: spellings of one person that a library carries as
// several (plan §3 C6, missing-metadata repair).
//
// Registries write "Özer M", "Ozer MA" and "Mehmet Özer" for one author, and a
// per-author count or a co-authorship check is wrong until they are read as one.
// This module finds the probable groups and applies a confirmed unification;
// it never merges on its own. Matching is on the family name folded to plain
// letters plus compatible initials, so "Ozer M" and "Ozer A" stay apart, and a
// one-letter slip in a long family name is offered as "likely", never "high".
// Every rewrite is logged with what it replaced, so it can be undone.
import { authorList, familyName } from './bib.mjs';

// Letters NFD leaves whole, and the German digraphs that stand for an umlaut.
const LETTERS = { 'ß': 'ss', 'ø': 'o', 'æ': 'ae', 'ı': 'i', 'ł': 'l', 'đ': 'd', 'ð': 'd', 'þ': 'th', 'œ': 'oe' };
const PARTICLES = new Set(['van', 'von', 'de', 'der', 'den', 'del', 'della', 'di', 'da', 'du', 'la', 'le', 'ten', 'ter', 'te', 'op', 'dos', 'das', 'af', 'zu', 'y', 'e', 'el', 'al', 'bin', 'ibn', "'t", 'st', 'mc', 'mac']);
// "y" and "e" join two family names ("Ortega y Gasset"), so the word before them belongs to the family too.
const CONNECTIVES = new Set(['y', 'e']);
const INITIALS_TOKEN = /^(?:[A-Z]\.?){1,3}$/;
// bib.mjs's caseFamily: a family name a registry sent in capitals.
const ALL_CAPS = /^[A-Z][A-Z' -]{2,}$/;

/** A family name as plain lower-case letters: no marks, apostrophes, hyphens or spaces; ue/oe/ae read as u/o/a. */
function fold(family) {
  return String(family || '').toLowerCase().replace(/[ßøæıłđðþœ]/g, c => LETTERS[c])
    .normalize('NFD').replace(/[̀-ͯ]/g, '').normalize('NFC')
    .replace(/(ae|oe|ue)(?=\p{L})/gu, m => m[0]).replace(/[^\p{L}]/gu, '');
}

/** Family and given parts of a name, split as bib.mjs's initials() splits them, with particles kept on the family in the given-first form; `initials` says the given part is an initials block. */
function split(name) {
  const s = String(name ?? '').replace(/\s+/g, ' ').trim();
  if (!s) return { family: '', given: '' };
  // "Smith, John, Jr.": only the second segment is the given name, as bib reads it.
  if (s.includes(',')) { const seg = s.split(','); return { family: seg[0].trim(), given: (seg[1] || '').trim() }; }
  const parts = s.split(' ');
  if (parts.length > 1 && INITIALS_TOKEN.test(parts[parts.length - 1]))
    return { family: parts.slice(0, -1).join(' '), given: parts[parts.length - 1], initials: true };
  let from = parts.length - 1;
  while (from > 1 && PARTICLES.has(parts[from - 1].toLowerCase())) {
    from--;
    if (from > 1 && CONNECTIVES.has(parts[from].toLowerCase())) from--;
  }
  return { family: parts.slice(from).join(' '), given: parts.slice(0, from).join(' ') };
}

/**
 * Initials of a given-name string: "MA" and "M. A." are two, "Mehmet Ali" two, "Jean-Pierre" one.
 * A short capital token is read as initials, as in "Brat DJ", unless the whole record is in capitals
 * ("OZER, ALI") or the token spells a name with a vowel ("Ozer, ALI"): then each token gives one letter, as bib reads it.
 */
function initialsOf(given, { block = false, caps = false } = {}) {
  const out = [];
  for (const g of String(given || '').split(/[\s.]+/).filter(Boolean)) {
    if (block || (!caps && /^[A-Z]{1,3}$/.test(g) && !(g.length === 3 && /[AEIOU]/.test(g)))) out.push(...g);
    else out.push(g[0].toUpperCase());
  }
  return out.join('');
}

/** The parts and keys of one spelling: { family, given, initials, folded, key }. */
export function normalizeName(name) {
  const { family: rawFamily, given, initials: block } = split(name);
  const family = rawFamily ? familyName(`${rawFamily}, ${given || 'X'}`) : '';
  const ini = initialsOf(given, { block, caps: ALL_CAPS.test(rawFamily) });
  const folded = fold(family);
  return { family, given, initials: ini, folded, key: `${folded}|${ini.slice(0, 1).toLowerCase()}` };
}

/** Whether two initial strings can belong to one person: same first letter, and every further letter equal where both have one. */
function compatible(a, b) {
  if (!a || !b) return a === b;
  if (a[0] !== b[0]) return false;
  for (let i = 1; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i]) return false;
  return true;
}

/** Whether two strings are within one edit of each other. */
function withinOneEdit(a, b) {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0, j = 0, edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (++edits > 1) return false;
    if (a.length > b.length) i++; else if (b.length > a.length) j++; else { i++; j++; }
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
}

const hasDiacritics = s => /[^\u0000-\u007f]/.test(s);
const paperId = (p, i) => p.id ?? p.key ?? String(i);

/** Every distinct spelling with its normalisation, count and the ids of the papers carrying it. */
function spellings(papers) {
  const by = new Map();
  (papers || []).forEach((p, i) => {
    for (const raw of authorList(p.authors)) {
      const name = String(raw).replace(/\s+/g, ' ').trim();
      if (!name) continue;
      const v = by.get(name) || { name, count: 0, paperIds: new Set(), ...normalizeName(name) };
      v.count++;
      v.paperIds.add(paperId(p, i));
      by.set(name, v);
    }
  });
  return [...by.values()].filter(v => v.folded);
}

/** The variant that names the group: most frequent; on a tie the one carrying diacritics, then the longer given name. */
const byCanonical = (a, b) => b.count - a.count || (hasDiacritics(b.name) - hasDiacritics(a.name)) || b.given.length - a.given.length || a.name.localeCompare(b.name);

/** Groups of spellings with one folded family and mutually compatible initials, most frequent spelling first. */
function highClusters(variants) {
  const byFamily = new Map();
  for (const v of variants) (byFamily.get(v.folded) || byFamily.set(v.folded, []).get(v.folded)).push(v);
  const out = [];
  for (const group of byFamily.values()) {
    const clusters = [];
    for (const v of group.sort(byCanonical)) {
      const home = clusters.find(c => c.members.every(m => compatible(m.initials, v.initials)));
      if (home) home.members.push(v); else clusters.push({ folded: v.folded, members: [v] });
    }
    out.push(...clusters);
  }
  return out;
}

/** The longest initials string a cluster carries: what a "likely" match must equal exactly. */
const longestInitials = c => c.members.reduce((m, v) => v.initials.length > m.length ? v.initials : m, '');

/** Probable same-person groups with at least two distinct spellings, by total count. */
export function authorClusters(papers) {
  const clusters = highClusters(spellings(papers)).map(c => ({ ...c, confidence: 'high', initials: longestInitials(c) }));
  // A one-letter slip in a long family name, with the same initials: offered as likely.
  // One edit changes the length by at most one, so sorted by length only neighbours need comparing.
  const byInitial = new Map();
  for (const c of clusters) (byInitial.get(c.initials[0]) || byInitial.set(c.initials[0], []).get(c.initials[0])).push(c);
  for (const same of byInitial.values()) {
    same.sort((a, b) => a.folded.length - b.folded.length);
    for (let i = 0; i < same.length; i++) for (let j = i + 1; j < same.length && same[j].folded.length - same[i].folded.length <= 1; j++) {
      const a = same[i], b = same[j];
      if (a.merged || b.merged || a.folded === b.folded || a.initials !== b.initials) continue;
      if (a.folded.length < 6 || b.folded.length < 6 || !withinOneEdit(a.folded, b.folded)) continue;
      a.members.push(...b.members); a.confidence = 'likely'; b.merged = true;
    }
  }
  const seen = new Map();
  return clusters.filter(c => !c.merged && c.members.length > 1).map(c => {
    const members = [...c.members].sort(byCanonical);
    const canonical = members[0];
    const base = `au:${canonical.key}`, n = seen.get(base) || 0; seen.set(base, n + 1);
    return {
      id: n ? `${base}#${n}` : base, canonical: canonical.name, confidence: c.confidence,
      variants: members.map(v => ({ name: v.name, count: v.count, paperIds: [...v.paperIds] })),
      paperIds: [...new Set(members.flatMap(v => [...v.paperIds]))],
      total: members.reduce((s, v) => s + v.count, 0),
    };
  }).sort((a, b) => b.total - a.total || a.canonical.localeCompare(b.canonical)).map(({ total, ...c }) => c);
}

/** Rewrite the listed spellings to the canonical one in every record, logging each change so the merge can be undone. */
export function applyAuthorNames(state, { variants = [], canonical }) {
  const wanted = new Set(variants.map(v => String(v).replace(/\s+/g, ' ').trim()).filter(v => v && v !== canonical));
  if (!canonical || !wanted.size) return state;
  const changes = [];
  (state.papers || []).forEach((p, i) => {
    const list = authorList(p.authors);
    let touched = false;
    const next = list.map((a, index) => {
      const name = String(a).replace(/\s+/g, ' ').trim();
      if (!wanted.has(name)) return a;
      changes.push({ paperId: paperId(p, i), index, from: a }); touched = true;
      return canonical;
    });
    if (touched) p.authors = next;
  });
  if (!changes.length) return state;
  const last = (state.authorMerges || []).at(-1)?.at || 0;
  state.authorMerges = [...(state.authorMerges || []), { at: Math.max(Date.now(), last + 1), canonical, variants: [...wanted], changes }];
  return state;
}

/** Put back the spellings a merge replaced, where the record still carries the canonical one, and drop the log entry. */
export function undoAuthorMerge(state, at) {
  const entry = (state.authorMerges || []).find(m => m.at === at);
  if (!entry) return state;
  (state.papers || []).forEach((p, i) => {
    const mine = entry.changes.filter(c => c.paperId === paperId(p, i));
    if (!mine.length) return;
    const list = authorList(p.authors);
    for (const c of mine) if (list[c.index] === entry.canonical) list[c.index] = c.from;
    p.authors = list;
  });
  state.authorMerges = state.authorMerges.filter(m => m !== entry);
  return state;
}

/** One row per person after normalisation: the most frequent spelling as "Family Initials", how many records, their year span as [min, max] ([null, null] when no record carries a year) and ids. */
export function authorTable(papers) {
  const rows = new Map();
  (papers || []).forEach((p, i) => {
    const year = Number(String(p.year || '').match(/\d{4}/)?.[0]) || null;
    for (const raw of authorList(p.authors)) {
      const name = String(raw).replace(/\s+/g, ' ').trim();
      const n = normalizeName(name);
      if (!n.folded) continue;
      const row = rows.get(n.key) || { spellings: new Map(), paperIds: new Set(), years: [] };
      row.spellings.set(name, (row.spellings.get(name) || 0) + 1);
      row.paperIds.add(paperId(p, i));
      if (year) row.years.push(year);
      rows.set(n.key, row);
    }
  });
  return [...rows.values()].map(r => {
    const [best] = [...r.spellings.entries()].sort((a, b) => b[1] - a[1] || hasDiacritics(b[0]) - hasDiacritics(a[0]) || b[0].length - a[0].length || a[0].localeCompare(b[0]));
    const n = normalizeName(best[0]);
    return { name: `${n.family}${n.initials ? ` ${n.initials}` : ''}`, count: r.paperIds.size, years: r.years.length ? [Math.min(...r.years), Math.max(...r.years)] : [null, null], paperIds: [...r.paperIds] };
  }).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}
