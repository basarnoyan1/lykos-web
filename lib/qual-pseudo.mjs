// Pseudonymisation of a transcript before it is coded (views/coding.mjs).
// The scan proposes; the researcher decides each hit. Replacement is
// consistent (the same name becomes the same pseudonym everywhere in the
// corpus run), the document keeps its codings through the edit model of
// lib/qual.mjs, and the real-to-pseudonym mapping is handed back to be saved
// as a file apart from the project: it is never written to the state.
//
// Candidates come from lib/case-report.mjs findIdentifiers (titled names,
// e-mail, phone, record numbers, dates of birth), the transcript's speaker
// labels, names the researcher lists, capitalised words after a title (Dr,
// Prof, Nurse), and places after 'in', 'at' or 'from'. A scan is a prompt to
// look, not a guarantee: a name the patterns do not reach is not found.
import { findIdentifiers } from './case-report.mjs';
import { parseTurns } from './qual-text.mjs';
import { qualOf, replaceRanges } from './qual.mjs';

const escRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const KIND = { name: 'Name', place: 'Place', contact: 'Contact', number: 'Record number', date: 'Date' };
// Capitalised words that open sentences or name institutions generically; never proposed as a place or name alone.
const COMMON = new Set(['I', 'The', 'A', 'An', 'And', 'But', 'So', 'Then', 'Yes', 'No', 'Well', 'Okay', 'OK', 'It', 'We', 'They', 'He', 'She', 'You', 'My', 'Our', 'This', 'That',
  'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday', 'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December',
  'Interviewer', 'Participant', 'Respondent', 'Moderator', 'Facilitator', 'Hospital', 'Clinic', 'Ward', 'GP', 'NHS', 'A&E', 'English', 'Christmas', 'Covid', 'COVID']);
const NAME = String.raw`\p{Lu}[\p{Ll}'’-]+(?:\s+\p{Lu}[\p{Ll}'’-]+)?`;
const TITLED = new RegExp(String.raw`\b(?:Dr|Doctor|Prof|Professor|Nurse|Sister|Mr|Mrs|Ms|Miss|Mx)\.?\s+(${NAME})`, 'gu');
const PLACE = new RegExp(String.raw`\b(?:[Ii]n|[Aa]t|[Ff]rom|[Nn]ear|[Tt]o)\s+((?:St\.?\s+)?\p{Lu}[\p{L}'’-]+(?:\s+(?:\p{Lu}[\p{L}'’-]+|Hospital|Infirmary|Clinic|Surgery|Road|Street|School))*)`, 'gu');

/**
 * Hits in one text: [{ start, end, text, kind }] sorted, without overlaps
 * (the longer hit wins). `names` are extra names to find wherever they occur.
 */
export function scanText(text, { names = [], speakers = true } = {}) {
  const t = String(text ?? ''), hits = [];
  const add = (start, end, kind) => { if (end > start) hits.push({ start, end, text: t.slice(start, end), kind }); };
  const labelStarts = new Set();
  if (speakers) for (const turn of parseTurns(t)) {
    const nm = turn.speaker;
    if (/^(?:I|R|P|Q|A)\d*$|^(?:Interviewer|Moderator|Facilitator|Researcher|Participant|Respondent)(?:\s*\d+)?$/i.test(nm)) continue;
    const at = t.indexOf(nm, turn.labelStart);
    if (at >= 0) { add(at, at + nm.length, 'name'); labelStarts.add(at); }
    names = [...names, ...nm.split(/\s+/).filter(w => w.length > 2 && !COMMON.has(w))];
  }
  for (const m of t.matchAll(TITLED)) { const at = m.index + m[0].length - m[1].length; add(at, at + m[1].length, 'name'); }
  for (const m of t.matchAll(PLACE)) {
    const w = m[1], first = w.split(/\s+/)[0];
    if (COMMON.has(first) || COMMON.has(w)) continue;
    const at = m.index + m[0].length - w.length; add(at, at + w.length, 'place');
  }
  for (const n of [...new Set(names.map(x => String(x).trim()).filter(x => x.length > 1))]) {
    for (const m of t.matchAll(new RegExp(String.raw`(?<![\p{L}\d])${escRe(n)}(?![\p{L}\d])`, 'gu'))) add(m.index, m.index + m[0].length, 'name');
  }
  // telephone numbers written in blocks the shared pattern does not reach (07700 900123)
  for (const m of t.matchAll(/(?<![\w+])\+?\d[\d ()-]{7,}\d(?!\w)/g)) { const n = m[0].replace(/\D/g, '').length; if (n >= 9 && n <= 15) add(m.index, m.index + m[0].length, 'contact'); }
  for (const h of findIdentifiers(t)) {
    const kind = h.kind === 'Name' ? null : /Email|Phone/.test(h.kind) ? 'contact' : /birth/i.test(h.kind) ? 'date' : 'number';
    if (!kind) continue;   // titled names are found above, the title kept
    let from = 0;
    for (let at; (at = t.indexOf(h.match, from)) >= 0; from = at + 1) add(at, at + h.match.length, kind);
  }
  hits.sort((a, b) => a.start - b.start || (b.end - b.start) - (a.end - a.start));
  const out = [];
  for (const h of hits) { const last = out[out.length - 1]; if (last && h.start < last.end) continue; out.push(h); }
  return out;
}

/**
 * A pseudonym for each distinct hit text: names become Person A, Person B…,
 * places [Place 1]…, contacts [contact], record numbers [number], dates
 * [date]. The same text (case ignored) always gets the same pseudonym, and
 * a name's parts share it ("Anna Smith" and "Anna" both become Person A).
 * `existing` carries a mapping already made, so a second document continues it.
 */
export function planPseudonyms(hits, existing = {}) {
  const map = { ...existing }, lower = k => k.toLowerCase();
  const used = [...new Set(Object.values(map))];
  let person = used.filter(v => /^Person [A-Z]+$/.test(v)).length, place = used.filter(v => /^\[Place \d+\]$/.test(v)).length;
  const letters = n => { let s = ''; n++; while (n > 0) { s = String.fromCharCode(65 + ((n - 1) % 26)) + s; n = Math.floor((n - 1) / 26); } return s; };
  const find = k => Object.keys(map).find(x => lower(x) === lower(k));
  for (const h of [...hits].sort((a, b) => b.text.length - a.text.length)) {
    if (find(h.text)) continue;
    if (h.kind === 'name') {
      const part = h.text.split(/\s+/).map(find).find(Boolean) || Object.keys(map).find(x => /^Person /.test(map[x]) && x.split(/\s+/).some(w => lower(w) === lower(h.text)));
      map[h.text] = part ? map[part] : `Person ${letters(person++)}`;
    } else if (h.kind === 'place') map[h.text] = `[Place ${++place}]`;
    else map[h.text] = `[${h.kind === 'contact' ? 'contact' : h.kind === 'date' ? 'date' : 'number'}]`;
  }
  return map;
}
export const kindLabel = k => KIND[k] || k;

/** Replacements for the hits the researcher kept (by index): [{ start, end, text }]. */
export function replacementsFor(hits, mapping, keep = null) {
  const find = k => Object.keys(mapping).find(x => x.toLowerCase() === k.toLowerCase());
  return hits.filter((h, i) => !keep || keep.has(i)).map(h => ({ start: h.start, end: h.end, text: mapping[find(h.text)] ?? h.text })).filter(r => r.text !== '');
}
/** Applies replacements to a text (for previews and tests; the store goes through lib/qual.mjs replaceRanges). */
export function applyReplacements(text, reps) {
  let t = String(text ?? '');
  for (const r of [...reps].sort((a, b) => b.start - a.start)) t = t.slice(0, r.start) + r.text + t.slice(r.end);
  return t;
}
/** The mapping as CSV rows for the file kept apart from the project. */
export const mappingCsvRows = (mapping, used = null) => [['original', 'pseudonym'], ...Object.entries(mapping).filter(([k]) => !used || used.has(k.toLowerCase())).map(([k, v]) => [k, v])];

/**
 * Writes the pseudonymised text into the document as its next version: the
 * replacements through the edit model (codings move with the text), speaker
 * links renamed with their speakers. The mapping is not stored.
 * Returns { replaced, dropped }.
 */
export function pseudonymiseDocument(s, docId, reps, mapping) {
  const q = qualOf(s), d = q.documents.find(x => x.id === docId);
  if (!d || !reps.length) return { replaced: 0, dropped: 0 };
  const { dropped } = replaceRanges(s, docId, reps);
  const find = k => Object.keys(mapping).find(x => x.toLowerCase() === k.toLowerCase());
  const speakers = {};
  for (const [k, v] of Object.entries(d.speakers || {})) speakers[find(k) ? mapping[find(k)] : k] = v;
  d.speakers = speakers;
  d.pseudonymised = { at: new Date().toISOString(), replaced: (d.pseudonymised?.replaced || 0) + reps.length };
  return { replaced: reps.length, dropped };
}
