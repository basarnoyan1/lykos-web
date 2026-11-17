// Values that are named measurements (owner, 2026-10-22: "a lot of the data here is shown in a way that makes no sense at all"): a cell
// such as "ASD 3/68 (4.4%); PJK NR" or "Cobb 17.2 → 11.3°; SVA 75.8 → 58.7 mm" holds several measures, each a name and a value. Read as
// texts they never repeat; read as measures they summarise: ASD in so many studies, so many events of so many patients; Cobb before and
// after, by median. A part without a name of its own ("34.5 → 16.5° in level 3") is the measure before it again, its words after the
// number a note. What does not read is kept as written and counted, never guessed.
// A measure the person's library knows (lib/measure-library.mjs, given as data) is read under the library's name, in its unit (5 cm of a
// measure kept in mm is 50 mm), and its values outside the library's plausible range are listed as cells to check.
import { matchMeasure, convertValue, outsideRange } from './measure-library.mjs';

const NR = /^(?:nr|n\/r|n\.r\.|not reported|na|n\/a|none reported)$/i;
const NUM = '[-−+]?\\d+(?:\\.\\d+)?';
const EVENTS = new RegExp(`^(${NUM})\\s*/\\s*(${NUM})(?:\\s*\\(\\s*(${NUM})\\s*%\\s*\\))?(.*)$`);
const CHANGE = new RegExp(`^(${NUM})\\s*(°|mm|cm|%)?\\s*(?:→|->|⇒|to)\\s*(${NUM})\\s*(°|mm|cm|%|points?)?(.*)$`, 'i');
const NUMBER = new RegExp(`^(${NUM})\\s*(°|mm|cm|%|points?|months?|years?|yrs?|y|mo)?(?![\\p{L}])(.*)$`, 'iu');
// a size written beside a name: "Dynesys (n=20)", "NA (n=68)"; the name is the part's note
// (or "Arm 1 (n=32)" over a line that says what the arm is, which is then the note)
const SIZED = new RegExp(`^([^\\n]*?)\\s*\\(\\s*n\\s*=\\s*(${NUM})\\s*\\)[ \\t]*(?:\\n([\\s\\S]*))?$`, 'i');
const num = s => Number(String(s).replace('−', '-'));
/** The words for a measure a study says it did not report, and the choice's tail that names a measure's state (the filter's term is the name). */
export const NOT_GIVEN = 'Not reported';
export const NAMED_STATE = / (?:reported|not reported)$/i;

/** One part's value: { type: 'tally', n, N } | { type: 'change', from, to, unit } | { type: 'number', value, unit } | { type: 'nr' } | null. */
export function readValue(text) {
  const t = String(text ?? '').trim();
  if (!t) return null;
  if (NR.test(t)) return { type: 'nr' };
  let m;
  if ((m = EVENTS.exec(t))) { const n = num(m[1]), N = num(m[2]); return N > 0 && n >= 0 && n <= N ? { type: 'tally', n, N, note: m[4].trim() } : null; }
  if ((m = CHANGE.exec(t))) return { type: 'change', from: num(m[1]), to: num(m[3]), unit: m[4] || m[2] || '', note: m[5].trim() };
  if ((m = SIZED.exec(t))) return { type: 'number', value: num(m[2]), unit: '', note: (m[3] || m[1]).trim(), sized: true };
  // a lone number ends the part (Age 54, BMI 27.1 kg): one followed by words is prose that happens to hold a number; a unit may take one word
  // that says what it counts ("59% female"), which then belongs to the unit
  if ((m = NUMBER.exec(t))) {
    const tail = m[3].trim();
    if (!tail) return { type: 'number', value: num(m[1]), unit: m[2] || '', note: '' };
    if (m[2] && /^\p{L}[\p{L}-]*$/u.test(tail)) return { type: 'number', value: num(m[1]), unit: `${m[2]} ${tail}`, note: '' };
  }
  return null;
}

/**
 * A cell's parts as [{ name, key, value, text }], or null when any part has no name and none came before it, or a value does not read.
 * `names`: the field label's own parts ("Age; sex" names "62.2 y; 59% female" part by part), used for parts without a name of their own when
 * the cell has as many parts as the label.
 */
export function readMeasures(text, { names = null } = {}) {
  const parts = String(text ?? '').split(/\s*;\s*/).map(p => p.trim()).filter(Boolean);
  if (!parts.length) return null;
  const byPlace = names?.length === parts.length ? names : null;
  const out = []; let last = null;
  for (const [at, p] of parts.entries()) {
    if (byPlace) {
      const value = readValue(p);
      if (value && value.type !== 'nr' && (/^[-−+]?\d/.test(p) || value.sized)) {
        out.push({ name: byPlace[at], key: keyOf(byPlace[at]), value, text: p }); last = byPlace[at]; continue;
      }
    }
    // the name runs up to the first number or NR: "PI–LL (absolute value) 13.9 → 8.5°", "ASD NR"
    const m = /^([^\d;]*?\p{L}[^\d;]*?)\s+((?:nr|n\/r|not reported|na|n\/a)\b.*|[-−+]?\d.*)$/iu.exec(p);
    let name = m ? m[1].trim() : '', rest = m ? m[2] : p;
    if (!name) { if (!last || !/^[-−+]?\d/.test(p)) return null; name = last; rest = p; }
    // a measure's name is a few words (ASD, Cobb, PI–LL (absolute value)), never a clause
    if (name.includes(',') || name.split(/\s+/).length > 5) return null;
    const value = readValue(rest);
    if (!value) return null;
    out.push({ name, key: keyOf(name), value, text: p });
    last = name;
  }
  return out;
}
const keyOf = name => name.toLowerCase().replace(/\s*\(.*?\)\s*/g, ' ').replace(/[–—-]/g, '-').replace(/\s+/g, ' ').trim();

/** Whether a field's values are measures: most present values read whole, and some measure recurs in two or more of them. */
export function looksLikeMeasures(texts, { share = 0.6, names = null } = {}) {
  const read = texts.map(t => readMeasures(t, { names })), ok = read.filter(Boolean);
  if (texts.length < 3 || ok.length / texts.length < share) return false;
  const seen = new Map(); for (const r of ok) for (const k of new Set(r.map(x => x.key))) seen.set(k, (seen.get(k) || 0) + 1);
  return [...seen.values()].some(n => n >= 2);
}

/** A value in the library entry's unit when its own converts to it (or has none); as read otherwise. */
function inUnit(v, unit) {
  if (!unit || !v || v.type === 'nr' || v.type === 'tally') return v;
  const to = x => convertValue(x, v.unit || unit, unit);
  if (v.type === 'change') { const a = to(v.from), b = to(v.to); return a == null || b == null ? v : { ...v, from: a, to: b, unit }; }
  if (v.type === 'number') { const a = to(v.value); return a == null ? v : { ...v, value: a, unit }; }
  return v;
}

const median = xs => { const s = [...xs].sort((a, b) => a - b), h = s.length >> 1; return s.length ? (s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2) : NaN; };

/**
 * The measures of a field's cells ([{ paperId, cell, text }]), most reported first: each with the studies that report it, those that say
 * it was not reported, and its summary by type: events summed (n of N, the share, the range of shares), a change by medians, a number by
 * median and range. `unread` are the cells that did not read, as written.
 */
export function summariseMeasures(cells, { names = null, library = null } = {}) {
  const by = new Map(), unread = [], known = new Map();
  for (const c of cells) {
    const parts = readMeasures(c.text, { names });
    if (!parts) { unread.push(c); continue; }
    for (const p of parts) {
      const entry = library ? (known.has(p.key) ? known.get(p.key) : known.set(p.key, matchMeasure(library, p.name, p.value.unit)).get(p.key)) : null;
      // two names of one library measure ("PI-LL", "PI–LL (absolute value)") are one measure, under the library's name
      const key = entry ? keyOf(entry.name) : p.key, value = entry ? inUnit(p.value, entry.unit) : p.value;
      const m = by.get(key) || by.set(key, { key, name: entry ? entry.name : p.name, entry, studies: [], unreported: [] }).get(key);
      (value.type === 'nr' ? m.unreported : m.studies).push({ paperId: c.paperId, cell: c.cell, value, text: p.text });
    }
  }
  const out = [...by.values()].map(m => {
    const vs = m.studies.map(s => s.value), type = ['tally', 'change', 'number'].find(t => vs.length && vs.filter(v => v.type === t).length >= vs.length / 2) || 'mixed';
    const of = vs.filter(v => v.type === type), papers = new Set(m.studies.map(s => s.paperId)).size;
    let summary = null;
    if (type === 'tally') { const n = of.reduce((a, v) => a + v.n, 0), N = of.reduce((a, v) => a + v.N, 0), shares = of.map(v => v.n / v.N); summary = { n, N, share: N ? n / N : NaN, lo: Math.min(...shares), hi: Math.max(...shares) }; }
    else if (type === 'change') summary = { from: median(of.map(v => v.from)), to: median(of.map(v => v.to)), change: median(of.map(v => v.to - v.from)), unit: of.find(v => v.unit)?.unit || '' };
    else if (type === 'number') summary = { median: median(of.map(v => v.value)), lo: Math.min(...of.map(v => v.value)), hi: Math.max(...of.map(v => v.value)), unit: of.find(v => v.unit)?.unit || '' };
    if (summary && m.entry?.unit && type !== 'tally') summary.unit = m.entry.unit;
    // a value outside the library's plausible range is a cell to check
    const outside = m.entry?.range ? m.studies.filter(s => outsideRange(m.entry, s.value)).map(s => ({ paperId: s.paperId, cell: s.cell, text: s.text })) : [];
    return { ...m, entry: m.entry || null, type, papers, summary, outside };
  }).sort((a, b) => b.papers - a.papers || b.unreported.length - a.unreported.length);
  return { measures: out, unread };
}
