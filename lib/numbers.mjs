// Numbers in text, read the way a reader of a medical paper reads them.
//
// Every model action that writes text into the project checks its numbers
// here, and every check has to agree on what a number is. Five separate
// readers disagreed: one skipped anything from 1900 to 2100 as a year, one
// read "1,234" as 1.234, one ignored signs. This is the one reader.
//
// A number keeps its sign ("−0.12" is not "0.12"), its thousands ("1,234"
// and "1 234" are 1234), and its decimals ("0.720" equals "0.72"). A range
// "0.80–1.10" is two numbers, both positive. Names that contain digits are
// not numbers: PRISMA 2020, RoB 2, ROBINS-I, I², τ², "95% CI" (the level of
// an interval, a convention rather than a finding).

// Stripped before reading: digits that name a thing rather than count one.
const NAMES = [
  /\b(?:PRISMA(?:-[A-Z]+)?|CONSORT|SPIRIT|STARD|STROBE|TRIPOD(?:\+AI)?|CHEERS|CARE|ARRIVE|SQUIRE|AMSTAR|GRADE|QUADAS|PROBAST|ROBIS|COREQ|SRQR|MOOSE)(?:[\s-]*\d)?[\s-]*\d{4}\b/gi,
  /\bRoB[\s-]*2\b/gi, /\bQUADAS[\s-]*2\b/gi, /\bAMSTAR[\s-]*2\b/gi, /\bPROBAST\b/gi,
  /\b(?:I|tau|τ|chi|χ)\s*[²2]\b/gi, /\bI²/g, /τ²/g, /χ²/g,
  /\b95\s*%\s*(?=(?:CI|confidence|prediction|credible|PI)\b)/gi,
  /\bCOVID[\s-]*19\b/gi, /\bSARS[\s-]*CoV[\s-]*2\b/gi,
  /\[(?:@[^\]]*|\d+(?:[,–-]\d+)*)\]/g,   // citation markers: [@key], [3], [3–5]
  /\{\{[^}]*\}\}/g,                        // result tokens: {{pooled.k}}
];

/**
 * The numbers in a text, as { value, text } in order. `value` is a Number
 * with its sign; `text` is how it was written.
 */
export function numbersIn(text) {
  let t = String(text || '');
  for (const re of NAMES) t = t.replace(re, ' ');
  const out = [];
  // sign only where it is one: at a start, after space, "(", "=", ":" or "[";
  // "0.80–1.10" and "12-24 months" are ranges, not a negative second number
  // (a lookbehind: an optional group cannot match empty text in JavaScript,
  // so "at the start" has to be asked this way)
  // Thousands first ("1,234"), then a decimal comma ("0,72": a comma not
  // followed by exactly three digits), then a plain number with an optional
  // decimal point.
  const re = /(?:(?<=^|[\s(=:[,;])([−-]))?(?<![\d.,])(?:(\d{1,3}(?:,\d{3})+|\d{1,3}(?: \d{3})+)(?![\d,])|(\d+),(?!\d{3}(?!\d))(\d+)|(\d+))(?:\.(\d+))?/g;
  let m;
  while ((m = re.exec(t))) {
    const signed = Boolean(m[1]);
    const int = (m[2] || m[3] || m[5]).replace(/[,\u202f]/g, '');
    const frac = m[4] || m[6] || '';
    const value = Number(`${signed ? '-' : ''}${int}${frac ? `.${frac}` : ''}`);
    if (Number.isFinite(value)) out.push({ value, text: `${signed ? m[1] : ''}${m[0].replace(/^[−-]/, '')}` });
  }
  return out;
}

const same = (a, b) => a === b || Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));

/**
 * Numbers in `text` that none of `sources` contains, as written. Pass only
 * the material the claim must rest on — the facts, the record, the quote —
 * never the prompt or the project brief: a number in the instructions
 * ("at most 300 words", "PRISMA 2020") or in unrelated counts would vouch
 * for an invented one.
 */
export function unsupported(text, ...sources) {
  const have = sources.flatMap(s => numbersIn(s).map(n => n.value));
  return numbersIn(text).filter(n => !have.some(h => same(h, n.value))).map(n => n.text);
}

/**
 * Whether two texts state the same numbers, the same number of times.
 * A rewrite of a paragraph may reword; it may not change a number.
 * Returns '' when they agree, else a short description of the change.
 */
export function numbersChanged(before, after) {
  const a = numbersIn(before).map(n => n.value), b = numbersIn(after).map(n => n.value);
  const left = [...b];
  const lost = [];
  for (const v of a) {
    const i = left.findIndex(x => same(x, v));
    if (i >= 0) left.splice(i, 1); else lost.push(v);
  }
  if (!lost.length && !left.length) return '';
  const fmt = xs => xs.map(v => String(v)).join(', ');
  return [lost.length && `removed or changed ${fmt(lost)}`, left.length && `added ${fmt(left)}`].filter(Boolean).join('; ');
}

/** One number from a cell as a person or a model wrote it, or NaN: "1,234" is 1234, "−3" is −3. */
export function parseNumber(text) {
  const n = numbersIn(String(text || '').trim());
  return n.length ? n[0].value : NaN;
}

/**
 * Whether a value's number is in its quote as a number, not inside a longer
 * one: "45" is not in "145 patients".
 */
export function numberInQuote(value, quote) {
  const v = parseNumber(value);
  if (!Number.isFinite(v)) return true;
  return numbersIn(quote).some(n => same(n.value, v) || same(Math.abs(n.value), Math.abs(v)));
}

/**
 * A text with the project's study labels taken out. "Smith 2020" names a
 * study; its year is not a figure the text states, and nothing a claim is
 * checked against lists every study to vouch for it.
 */
export function withoutLabels(text, papers = []) {
  const labels = [...new Set(papers.map(p => String(p.label || '').trim()).filter(l => /\d/.test(l)))].sort((a, b) => b.length - a.length);
  let t = String(text || '');
  for (const l of labels) t = t.split(l).join(' ');
  return t;
}
