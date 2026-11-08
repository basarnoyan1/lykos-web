// Field kinds and the value/note split (data-model plan S1, step 1; plan G1).
//
// A field's kind decides what a value of it is: a number, yes or no, one category of a closed list, several categories, one or more
// countries (ISO 3166-1 alpha-2), or a date. A source often writes a qualifier beside the value ("Yes (84.1)", "4 (1-month
// postimplant)"); the qualifier is kept in the value's own note slot, not inside the value, so the value reads as its kind.
//
// Pure: no store. The vocabulary of a category field is passed in (lib/vocabularies.mjs vocabFor). "NR" is not a value of any kind: it
// is the availability not_found (lib/proposals.mjs notReported), and parseValue reports it as { nr: true }.
import { countryOf, countryName } from './countries.mjs';

import { lib_kind_list$KINDS as KINDS, lib_kind_list$isKind as isKind, lib_kind_list$kindOf as kindOf, lib_kind_list$isNumericKind as isNumericKind, lib_kind_list$isListKind as isListKind, lib_kind_list$usesLevels as usesLevels, lib_kind_list$cellNumber as cellNumber } from "../boot.mjs";
export { KINDS, isKind, kindOf, isNumericKind, isListKind, usesLevels, cellNumber };

const NR = /^(?:nr|n\/r|not reported|not stated)$/i;   // "NA" and "N/A" may be a level (not applicable), so they are not NR
const YES = /^(?:yes|y)$/i, NO = /^(?:no|n)$/i;
const SECOND = /^(?:[-–—]|to\b|vs\.?|versus\b|or\b|and\b|\/|±|\+\/?-)?\s*[-−]?\.?\d/i;
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const pad = n => String(n).padStart(2, '0');

/**
 * Candidate readings of a text as value plus note, most literal first: the whole text; a trailing bracketed part ("Yes (84.1)", nested
 * brackets allowed); a part after "; ", " — ", " – " or ": "; and, for `loose`, a leading token followed by words ("4 weeks after
 * implant"). Pure.
 */
export function splits(text, { loose = false } = {}) {
  const t = String(text ?? '').trim(), out = [{ head: t, note: '', via: 'whole' }];
  if (!t) return out;
  const close = t.at(-1) === ')' ? '(' : t.at(-1) === ']' ? '[' : '';
  if (close) {
    let depth = 0;
    for (let i = t.length - 1; i >= 0; i--) {
      if (t[i] === t.at(-1)) depth++;
      else if (t[i] === close && --depth === 0) { const head = t.slice(0, i).trim(); if (head) out.push({ head, note: t.slice(i + 1, -1).trim(), via: 'bracket' }); break; }
    }
  }
  const sep = /^(.+?)\s*(?:;|\s[—–]\s|:\s)\s*(.+)$/.exec(t);
  if (sep) out.push({ head: sep[1].trim(), note: sep[2].trim(), via: 'sep' });
  if (loose) { const lead = /^(\S+)\s+(.+)$/.exec(t); if (lead) out.push({ head: lead[1].replace(/[,;:]$/, ''), note: lead[2].trim(), via: 'lead' }); }
  return out.filter((c, i, a) => a.findIndex(x => x.head === c.head && x.note === c.note) === i);
}

function dateOf(t) {
  let m;
  const ok = (y, mo, d) => y >= 1900 && y <= 2100 && (!mo || (mo >= 1 && mo <= 12)) && (!d || (d >= 1 && d <= new Date(Date.UTC(y, mo, 0)).getUTCDate()));
  if ((m = /^(\d{4})$/.exec(t))) return ok(+m[1]) ? m[1] : null;
  if ((m = /^(\d{4})[-/.](\d{1,2})$/.exec(t))) return ok(+m[1], +m[2]) ? `${m[1]}-${pad(m[2])}` : null;
  if ((m = /^(\d{1,2})[-/.](\d{4})$/.exec(t))) return ok(+m[2], +m[1]) ? `${m[2]}-${pad(m[1])}` : null;
  if ((m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(t))) return ok(+m[1], +m[2], +m[3]) ? `${m[1]}-${pad(m[2])}-${pad(m[3])}` : null;
  const mon = s => MONTHS.indexOf(s.slice(0, 3).toLowerCase()) + 1;
  if ((m = /^([A-Za-z]{3,9})\.?,?\s+(\d{4})$/.exec(t)) && mon(m[1])) return ok(+m[2], mon(m[1])) ? `${m[2]}-${pad(mon(m[1]))}` : null;
  if ((m = /^(\d{1,2})\s+([A-Za-z]{3,9})\.?,?\s+(\d{4})$/.exec(t)) && mon(m[2])) return ok(+m[3], mon(m[2]), +m[1]) ? `${m[3]}-${pad(mon(m[2]))}-${pad(m[1])}` : null;
  if ((m = /^([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})$/.exec(t)) && mon(m[1])) return ok(+m[3], mon(m[1]), +m[2]) ? `${m[3]}-${pad(mon(m[1]))}-${pad(m[2])}` : null;
  return null;
}

const fold = t => String(t ?? '').normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
/** The closed list of a category field: [{ code, label }] from its vocabulary's terms, else its options (code = label). */
export function levelsOf(field, vocab = null) {
  if (vocab?.terms?.length) return vocab.terms.map(t => ({ code: t.code, label: t.label, aliases: t.aliases || [] }));
  return (field?.options || []).map(o => ({ code: String(o), label: String(o), aliases: [] }));
}
function levelMatch(levels, text) {
  const f = fold(text);
  return levels.find(l => fold(l.label) === f) || levels.find(l => l.code === text) || levels.find(l => l.aliases.some(a => fold(a) === f)) || null;
}
const listParts = t => t.split(/\s*(?:;|\/|\+|&|\band\b)\s*/i).filter(Boolean);

/** Reads `text` (no note) as `kind`: { ok, value, shown } or { ok: false }. */
function readAs(text, field, vocab) {
  const t = String(text ?? '').trim(), kind = kindOf(field);
  if (!t) return { ok: false };
  switch (kind) {
    case 'number': case 'integer': {
      const n = cellNumber(t, kind);
      if (!Number.isFinite(n) || (kind === 'integer' && !Number.isInteger(n))) return { ok: false };
      return { ok: true, value: n, shown: t };
    }
    case 'yesno': return YES.test(t) ? { ok: true, value: 'yes', shown: 'Yes' } : NO.test(t) ? { ok: true, value: 'no', shown: 'No' } : { ok: false };
    case 'date': { const d = dateOf(t); return d ? { ok: true, value: d, shown: d } : { ok: false }; }
    case 'country': {
      const whole = countryOf(t);
      const parts = whole ? [whole] : t.split(/\s*(?:;|,|\/|\+|&|\band\b)\s*/i).filter(Boolean).map(countryOf);
      if (!parts.length || parts.some(p => !p)) return { ok: false };
      const codes = [...new Set(parts.map(p => p.code))];
      return { ok: true, value: codes, shown: codes.map(countryName).join('; ') };
    }
    case 'category': {
      const levels = levelsOf(field, vocab);
      if (!levels.length) return { ok: true, value: t, shown: t };
      const l = levelMatch(levels, t);
      return l ? { ok: true, value: l.code, shown: l.label } : { ok: false };
    }
    case 'multi': {
      const levels = levelsOf(field, vocab);
      const whole = levels.length ? levelMatch(levels, t) : null;
      const parts = whole ? [t] : listParts(t).length > 1 ? listParts(t) : t.split(/\s*,\s*/).filter(Boolean);
      if (!levels.length) return { ok: true, value: parts, shown: parts.join('; ') };
      const hit = parts.map(p => levelMatch(levels, p));
      if (hit.some(h => !h)) return { ok: false };
      const uniq = hit.filter((h, i) => hit.findIndex(x => x.code === h.code) === i);
      return { ok: true, value: uniq.map(h => h.code), shown: uniq.map(h => h.label).join('; ') };
    }
    default: return { ok: true, value: t, shown: t };
  }
}

/**
 * Reads a cell's text as its field's kind. Returns { ok: true, value, shown, note, split } — `value` the normalized value (a number, 'yes'
 * or 'no', a code, an array of codes, an ISO date), `shown` the reported text without the note, `note` the qualifier ('' when none),
 * `split` true when a note was separated — or { ok: true, nr: true } for "NR", or { ok: false } when no reading fits. A text field keeps
 * its whole text with no note: nothing is split from free text.
 */
export function parseValue(text, field, vocab = null) {
  const t = String(text ?? '').trim(), kind = kindOf(field);
  if (!t) return { ok: false };
  if (kind !== 'text' && NR.test(t)) return { ok: true, nr: true, value: null, shown: 'NR', note: '', split: false };
  if (kind === 'text') return { ok: true, value: t, shown: t, note: '', split: false };
  for (const c of splits(t, { loose: isNumericKind(kind) })) {
    // "12 to 14", "12; 14", "3 or 4": a second number outside brackets is a range or an alternative, not a note
    if (isNumericKind(kind) && (c.via === 'sep' || c.via === 'lead') && SECOND.test(c.note)) continue;
    if (NR.test(c.head) && c.note) return { ok: true, nr: true, value: null, shown: 'NR', note: c.note, split: true };
    const r = readAs(c.head, field, vocab);
    // a note that only repeats the field's unit ("26.1 weeks" in a field in weeks) is not kept
    const note = field?.unit && fold(c.note) === fold(field.unit) ? '' : c.note;
    if (r.ok) return { ...r, note, split: Boolean(c.note) };
  }
  return { ok: false };
}

/** The text a cell shows and is edited as: the value with its note in brackets, so typing it back reads the same value and note. */
export const displayText = (shown, note = '') => (note ? `${shown} (${note})` : String(shown ?? ''));
