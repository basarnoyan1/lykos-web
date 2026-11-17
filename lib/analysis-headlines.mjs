// What a registered analysis run states for each of its sections, read from the results file's own text (Findability review, 13 Nov 2026,
// item 6). A section's headline is its first line of prose or its first bullet when that line states an estimate with its interval
// ("Sham SMCR 0.30 (95% CI 0.09 to 0.51; PI -1.11 to 1.70); 47 trials, ..."). A section that opens with a table, or with a sentence
// that holds no estimate, has none: nothing is read out of a table, summed or recomputed. Pure: text in, plain facts out.

const HEADING = /^##\s+(.+?)\s*$/;
// number, then its interval: "0.30 (95% CI 0.09 to 0.51; PI -1.11 to 1.70)"; the group keeps what the file wrote inside the brackets
const ESTIMATE = /(-?\d+(?:\.\d+)?)\s*(\(95% CI\s+-?\d+(?:\.\d+)?\s+to\s+-?\d+(?:\.\d+)?[^)]*\))/;
const TRIALS = /\b(\d[\d,]*) trials?\b/;

/** The sections of a results file in order: `[{ title, lines }]`, the lines of each between its `## ` heading and the next. */
export function resultsSections(md) {
  const out = [];
  let open = null;
  for (const line of String(md || '').split(/\r?\n/)) {
    const h = HEADING.exec(line);
    if (h) { open = { title: h[1], lines: [] }; out.push(open); } else if (open) open.lines.push(line);
  }
  return out;
}

/** The first line of prose or bullet of a section's lines (a table row, a rule, a heading and a blank line are not), without its bullet. */
const firstText = lines => {
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || /^[|#]/.test(line) || /^[-*_]{3,}$/.test(line)) { if (line.startsWith('|')) return ''; continue; }   // a table before any prose: no headline
    return line.replace(/^[-*]\s+/, '');
  }
  return '';
};

/**
 * The headline of one section's lines: `{ text, trials }` or null. `text` is the estimate as written, with the words that name it
 * ("Sham SMCR", "slope", "odds ratio", a bold lead-in such as "Active-arm SMCR") and the trial count when the same line states one.
 */
export function headlineOf(lines) {
  const raw = firstText(lines);
  if (!raw) return null;
  const plain = raw.replace(/\*\*/g, ''), m = ESTIMATE.exec(plain);
  if (!m) return null;
  const lead = /^\*\*([^*0-9]+?)\*\*/.exec(raw)?.[1].trim();
  const named = /(?:^|[:,]\s+)([A-Za-z][A-Za-z-]*(?: [A-Za-z][A-Za-z-]*){0,2})\s+$/.exec(plain.slice(0, m.index))?.[1] || '';
  const label = lead || named;
  const t = TRIALS.exec(plain.slice(m.index + m[0].length));
  const trials = t ? `${t[1]} ${t[1] === '1' ? 'trial' : 'trials'}` : '';
  return { text: [label, m[1], m[2]].filter(Boolean).join(' '), trials };
}

const norm = t => String(t || '').toLowerCase().replace(/\s+/g, ' ').trim();
/** The section of a results file that a registered analysis name (`names`: the registration's own list) stands for: same words, or one begins with the other. */
export function sectionFor(name, sections) {
  const n = norm(name);
  return sections.find(s => norm(s.title) === n) || sections.find(s => norm(s.title).startsWith(n) || n.startsWith(norm(s.title))) || null;
}

/** `{ [name]: { text, trials } }` for the registered names whose section states an estimate. */
export function headlines(md, names) {
  const sections = resultsSections(md), out = {};
  for (const name of names || []) { const s = sectionFor(name, sections), h = s && headlineOf(s.lines); if (h) out[name] = { ...h, heading: s.title }; }
  return out;
}

/** The registered names that a dataset's recorded source mentions ("…results.md, Same-instrument pools; …", "(Secondary outcomes; Trial-level associations; Serious adverse events; …)"). */
export function namesInSource(source, names) {
  const text = norm(source);
  return (names || []).filter(name => {
    const full = norm(name).replace(/\s*\(.*$/, ''), head = full.split(/ (?:in|and) /)[0];   // "Certainty of evidence (GRADE …)" → "certainty of evidence"; "Serious adverse events in sham arms" → "serious adverse events"
    return text.includes(full) || (head.length >= 12 && text.includes(head));
  });
}
