// A free text read part by part (owner, 2026-10-23: "I understand that it cannot be automatically classified but still you can do that
// analysis"). A cell such as "Dynesys; 3–7 levels; T11–S1; extension to S1 in 25/57" is not one category, but its parts are: what it opens
// with (the thing named first), counts of a total ("extension to S1 in 25/57"), numbers with the word they count ("mean 6.6 levels",
// "3–7 levels") and parts that recur across studies ("cement augmentation"). Each is counted with the studies behind it; a part that is
// none of these and recurs nowhere is left as written. No vocabulary: the shapes are read, the words are the table's.

const NUM = '[-−+]?\\d+(?:\\.\\d+)?';
const num = s => Number(String(s).replace('−', '-'));
// "extension to S1 in 25/57", "iliac fixation in 40/47 (85%)"
const TALLY = new RegExp(`^(.+?)\\s+in\\s+(${NUM})\\s*/\\s*(${NUM})(?:\\s*\\(\\s*${NUM}\\s*%\\s*\\))?$`, 'i');
// "mean 6.6 levels", "median 4 levels", "3–7 levels", "5 levels"
const COUNTED = new RegExp(`^(?:(mean|median|average)\\s+)?(${NUM})(?:\\s*[–-]\\s*(${NUM}))?\\s+(\\p{L}[\\p{L}-]*)$`, 'iu');
const key = t => t.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[‐-―−]/g, '-').replace(/\s+/g, ' ').trim();

/** One part's shape: { type: 'tally', name, n, N } | { type: 'count', word, value?, lo?, hi?, stat } | { type: 'text', text }. */
export function readPart(part) {
  const t = String(part ?? '').trim();
  let m;
  if ((m = TALLY.exec(t))) { const n = num(m[2]), N = num(m[3]); if (N > 0 && n >= 0 && n <= N) return { type: 'tally', name: m[1].trim(), n, N }; }
  if ((m = COUNTED.exec(t))) return m[3] != null ? { type: 'count', word: m[4], lo: num(m[2]), hi: num(m[3]), stat: 'range' } : { type: 'count', word: m[4], value: num(m[2]), stat: (m[1] || 'value').toLowerCase() };
  return { type: 'text', text: t };
}

const partsOfCell = text => String(text ?? '').split(/\s*[;\n]\s*/).map(p => p.trim()).filter(Boolean);

/**
 * The parts of a free text field's cells ([{ paperId, cell, text }]), or null when its cells do not have parts (most hold one).
 * { leads: [{ label, n, k, studies }], tallies: [{ name, n, N, k, studies }], counts: [{ word, values: [{ stat, value | lo,hi, paperId, cell }], k, studies }],
 *   recurring: [{ label, n, k, studies }], cells } — k the studies behind each — studies as [{ paperId, cell }], each group counting a study once.
 */
export function readParts(cells, { share = 0.5 } = {}) {
  const split = cells.map(c => ({ ...c, parts: partsOfCell(c.text) }));
  if (!split.length || split.filter(c => c.parts.length >= 2).length / split.length < share) return null;
  const leads = new Map(), tallies = new Map(), counts = new Map(), texts = new Map();
  const put = (map, k, make, c) => { const g = map.get(k) || map.set(k, make()).get(k); if (!g.seen.has(c.paperId)) { g.seen.add(c.paperId); g.studies.push({ paperId: c.paperId, cell: c.cell }); } return g; };
  for (const c of split) {
    c.parts.forEach((p, at) => {
      const r = readPart(p);
      if (r.type === 'tally') { const g = put(tallies, key(r.name), () => ({ name: r.name, n: 0, N: 0, studies: [], seen: new Set() }), c); g.n += r.n; g.N += r.N; }
      else if (r.type === 'count') { const g = put(counts, key(r.word), () => ({ word: r.word, values: [], studies: [], seen: new Set() }), c); g.values.push({ ...r, paperId: c.paperId, cell: c.cell }); }
      else {
        if (at === 0) put(leads, key(r.text), () => ({ label: r.text, studies: [], seen: new Set() }), c);
        else put(texts, key(r.text), () => ({ label: r.text, studies: [], seen: new Set() }), c);
      }
    });
  }
  // k: the studies behind a group (a tally keeps n and N, its events and total)
  const done = list => list.map(({ seen, ...g }) => ({ ...g, k: g.studies.length, ...(g.N == null ? { n: g.studies.length } : {}) })).sort((a, b) => b.k - a.k || String(a.label || a.name || a.word).localeCompare(String(b.label || b.name || b.word)));
  return {
    leads: done([...leads.values()]),
    tallies: done([...tallies.values()]).filter(t => t.k >= 2),
    counts: done([...counts.values()]).filter(t => t.k >= 2),
    recurring: done([...texts.values()]).filter(t => t.k >= 2),
    cells: split.length,
  };
}

const median = xs => { const s = [...xs].sort((a, b) => a - b), h = s.length >> 1; return s.length ? (s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2) : NaN; };
/** A counted word's values in a line: "mean 4.6 to 6.6 (2 studies); range 3 to 7 (4 studies)". */
export function countLine(c, fmt = String) {
  const by = new Map(); for (const v of c.values) { const k = v.stat === 'range' ? 'range' : v.stat; (by.get(k) || by.set(k, []).get(k)).push(v); }
  return [...by].map(([stat, vs]) => {
    const k = `${vs.length} ${vs.length === 1 ? 'study' : 'studies'}`;
    if (stat === 'range') return `range ${fmt(Math.min(...vs.map(v => v.lo)))} to ${fmt(Math.max(...vs.map(v => v.hi)))} (${k})`;
    const xs = vs.map(v => v.value), lo = Math.min(...xs), hi = Math.max(...xs);
    return `${stat === 'value' ? '' : `${stat} `}${lo === hi ? fmt(lo) : `${fmt(lo)} to ${fmt(hi)}`}${xs.length > 2 ? `, median ${fmt(median(xs))}` : ''} (${k})`;
  }).join('; ');
}
