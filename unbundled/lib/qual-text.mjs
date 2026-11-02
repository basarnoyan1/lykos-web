// The text side of the qualitative coding workspace (views/coding.mjs): a
// document is plain text with character offsets, and everything structural is
// read from that text rather than stored beside it, so an edit can never leave
// structure and text disagreeing. Paragraphs are lines; a transcript's speaker
// turns begin at a paragraph that opens with "Name:" (optionally after or
// before a timestamp such as [00:12:34]) and run until the next such paragraph.
//
// Pure: nothing here reads the store or the DOM.

/** Paragraphs as offsets: one per line, the newline not included. */
export function paragraphs(text) {
  const out = []; let at = 0;
  for (const line of String(text ?? '').split('\n')) { out.push({ start: at, end: at + line.length }); at += line.length + 1; }
  return out;
}

const TIME = String.raw`\[(\d{1,2}:\d{2}(?::\d{2})?(?:[.,]\d+)?)\]`;
// A label is a name of up to four words, or an interviewer shorthand (I, R, P3);
// "10:30" never qualifies because a label starts with a letter.
const LABEL = String.raw`(\p{Lu}[\p{L}\d'’.-]*(?:\s+[\p{Lu}\d][\p{L}\d'’.-]*){0,3})`;
const TURN = new RegExp(String.raw`^(\s*(?:${TIME}\s*)?)${LABEL}(\s*(?:${TIME})?\s*):(?=\s|$)`, 'u');
const STAMP = new RegExp(TIME, 'g');
// Words that open ordinary prose with a colon and are not speakers.
const NOT_SPEAKER = new Set(['note', 'notes', 'example', 'question', 'answer', 'q', 'a', 'http', 'https', 'mailto', 'see', 'nb', 'ps', 'topic', 'theme']);

/**
 * Speaker turns: [{ speaker, start, end, labelStart, labelEnd, time }]. `start`
 * is the paragraph where the label is, `end` the end of the last paragraph
 * before the next label; `labelStart..labelEnd` covers "Name:".
 */
export function parseTurns(text) {
  const t = String(text ?? ''), turns = [];
  for (const p of paragraphs(t)) {
    const line = t.slice(p.start, p.end), m = TURN.exec(line);
    if (!m || NOT_SPEAKER.has(m[3].toLowerCase())) { if (turns.length && line.trim()) turns[turns.length - 1].end = p.end; continue; }
    const labelStart = p.start + m[1].length;
    turns.push({ speaker: m[3].trim(), start: p.start, end: p.end, labelStart, labelEnd: p.start + m[0].length, time: m[2] || m[5] || null });
  }
  return turns;
}

/** Distinct speakers in first-appearance order, merged ignoring case. */
export function speakersOf(text) {
  const seen = new Map();
  for (const t of parseTurns(text)) if (!seen.has(t.speaker.toLowerCase())) seen.set(t.speaker.toLowerCase(), t.speaker);
  return [...seen.values()];
}

/** The turn covering an offset, or null. */
export const turnAt = (turns, offset) => turns.find(t => offset >= t.start && offset <= t.end) || null;

/** Timestamps written in the text: [{ start, end, time }]. */
export const timestamps = text => [...String(text ?? '').matchAll(STAMP)].map(m => ({ start: m.index, end: m.index + m[0].length, time: m[1] }));

// A sentence ends at . ! or ? followed by space and a capital, a quote or a
// digit; common abbreviations do not end one.
const ABBR = /\b(?:Dr|Mr|Mrs|Ms|Prof|Mx|St|vs|etc|e\.g|i\.e|approx|No)\.$/i;
/** Sentences inside [from, to) as offsets, trimmed of surrounding space. */
export function sentences(text, from = 0, to = String(text ?? '').length) {
  const t = String(text ?? ''), out = [];
  let s = from;
  const push = (a, b) => { while (a < b && /\s/.test(t[a])) a++; while (b > a && /\s/.test(t[b - 1])) b--; if (b > a) out.push({ start: a, end: b }); };
  const re = /[.!?]+["'’”)]*(?=\s+["'‘“(]?[\p{Lu}\d])/gu;
  re.lastIndex = from;
  const body = t.slice(0, to);
  for (let m; (m = re.exec(body));) {
    const end = m.index + m[0].length;
    if (ABBR.test(body.slice(Math.max(s, m.index - 8), m.index + 1))) continue;
    push(s, end); s = end;
  }
  push(s, to);
  return out;
}

/**
 * The unit around a match: the match itself, its sentence, its paragraph or
 * its speaker turn (without the "Name:" label). Returns { start, end }.
 */
export function unitAround(text, start, end, unit, turns = null) {
  const t = String(text ?? '');
  if (unit === 'match') return { start, end };
  const para = paragraphs(t).find(p => start >= p.start && start <= p.end) || { start: 0, end: t.length };
  if (unit === 'paragraph') return { start: para.start, end: Math.max(para.end, Math.min(end, t.length)) };
  if (unit === 'turn') {
    const turn = turnAt(turns || parseTurns(t), start);
    if (turn) return { start: turn.labelEnd + (/\s/.test(t[turn.labelEnd] || '') ? 1 : 0), end: turn.end };
    return { start: para.start, end: para.end };
  }
  const list = sentences(t, para.start, para.end);
  const a = list.find(x => start >= x.start && start < x.end) || list.find(x => x.start >= start) || { start, end };
  const b = list.find(x => end > x.start && end <= x.end) || a;
  return { start: Math.min(a.start, start), end: Math.max(b.end, end) };
}

export const UNITS = [['match', 'Match'], ['sentence', 'Sentence'], ['paragraph', 'Paragraph'], ['turn', 'Speaker turn']];
export const HIT_CAP = 5000;
const escRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The search as a regular expression, or { error } for one that does not compile. */
export function compileSearch({ pattern, regex = false, caseSensitive = false, wholeWord = false }) {
  const p = String(pattern ?? '');
  if (!p.trim()) return { error: 'Nothing to find' };
  let src = regex ? p : escRe(p);
  if (wholeWord) src = String.raw`(?<![\p{L}\p{N}_])(?:${src})(?![\p{L}\p{N}_])`;
  try { return { re: new RegExp(src, `gu${caseSensitive ? '' : 'i'}`) }; }
  catch (e) { return { error: `Not a valid pattern: ${String(e.message || e).replace(/^Invalid regular expression: /, '')}` }; }
}

/**
 * Finds a pattern across documents ([{ id, name, text }]) and widens each
 * match to the chosen unit. Matches landing in the same unit make one hit.
 * Returns { hits: [{ docId, start, end, text, match }], error, truncated }.
 */
export function findHits(docs, opts = {}) {
  const { re, error } = compileSearch(opts);
  if (error) return { hits: [], error, truncated: false };
  const unit = opts.unit || 'match', cap = opts.cap || HIT_CAP, hits = [];
  for (const d of docs) {
    const t = String(d.text ?? ''), turns = unit === 'turn' ? parseTurns(t) : null, seen = new Set();
    re.lastIndex = 0;
    for (let m; (m = re.exec(t));) {
      if (!m[0].length) { re.lastIndex++; continue; }
      const u = unitAround(t, m.index, m.index + m[0].length, unit, turns), key = `${u.start}:${u.end}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (hits.length >= cap) return { hits, error: null, truncated: true };
      hits.push({ docId: d.id, start: u.start, end: u.end, text: t.slice(u.start, u.end), match: m[0] });
    }
  }
  return { hits, error: null, truncated: false };
}

// ---- layering coded ranges for display -------------------------------------
/**
 * Cuts [from, to) at every range boundary: [{ start, end, ids }] where ids are
 * the ranges covering that piece. Pieces without a range are included with
 * ids = [], so the pieces tile [from, to) exactly.
 */
export function segments(ranges, from, to) {
  const cuts = new Set([from, to]);
  for (const r of ranges) { if (r.end <= from || r.start >= to) continue; cuts.add(Math.max(from, r.start)); cuts.add(Math.min(to, r.end)); }
  const xs = [...cuts].sort((a, b) => a - b), out = [];
  for (let i = 0; i < xs.length - 1; i++) {
    const a = xs[i], b = xs[i + 1];
    if (b <= a) continue;
    out.push({ start: a, end: b, ids: ranges.filter(r => r.start < b && r.end > a).map(r => r.id) });
  }
  return out;
}

/**
 * Margin lanes for ranges, so overlapping ones sit side by side: the first
 * lane free when a range starts (greedy interval partitioning, longest first
 * among equal starts). Returns Map id -> lane and the lane count.
 */
export function lanes(ranges) {
  const order = [...ranges].sort((a, b) => a.start - b.start || (b.end - b.start) - (a.end - a.start));
  const ends = [], lane = new Map();
  for (const r of order) {
    let i = ends.findIndex(e => e <= r.start);
    if (i < 0) { i = ends.length; ends.push(r.end); } else ends[i] = r.end;
    lane.set(r.id, i);
  }
  return { lane, count: ends.length };
}
