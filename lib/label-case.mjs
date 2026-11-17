// A name read from the data, shown as a label (owner, 2026-10-23: "we don't use lower cases"): sentence case, the first letter raised and
// everything else left as written, so an acronym (ASD, PJK, ODI) or a name that starts with a lower-case symbol (pH, eGFR) keeps its form.
// Used wherever a measure's or a level's name becomes a column head, a select's option, a card's title, an axis label or a saved title.

/** "revision" → "Revision", "screw loosening" → "Screw loosening", "ASD" → "ASD", "pH" → "pH", "eGFR" → "eGFR". */
export function labelCase(text) {
  const s = String(text ?? '').trim();
  if (!s) return '';
  const m = /^([^\p{L}]*)(\p{L})(\p{L}*)/u.exec(s);
  if (!m) return s;
  const [, lead, first, rest] = m;
  // a word that goes on in capitals, or whose second letter is a capital (pH, eGFR, mRNA), is written as its authors write it
  if (/\p{Lu}/u.test(rest)) return s;
  return `${lead}${first.toLocaleUpperCase()}${s.slice(lead.length + first.length)}`;
}
