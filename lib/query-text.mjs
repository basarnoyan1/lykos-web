// A block (lib/query-blocks.mjs) written back as text in a database's own syntax (8 Nov 2026, the query visualizer's editing: the
// owner, "can we move blocks around, add them, move them inside each other etc like scratch"). What is written reads back as the same
// blocks (app/test/query-text.test.mjs round-trips the examples and the Sham review's searches), so the text and the blocks stay one
// thing: an edit of the blocks rewrites one line of the text in place, and the page draws the blocks from the text again.
//
// Each database's form: PubMed a tag on every term ("x"[tiab], [tiab:~3] for a proximity); Scopus, Web of Science, Europe PMC and
// ClinicalTrials.gov a field opened round a group whose terms all search it (TITLE-ABS-KEY(a OR b), TS=(…), TITLE:(…), AREA[Field](…))
// or round one term; the Cochrane Library a suffix after a term or a bracket (x:ti,ab,kw) and [mh "Heading"], [mh ^"Heading"] for a
// heading not exploded; Ovid a suffix after a term or a bracket (x.ti,ab.), exp Heading/ or Heading/, lower-case operators. A line of a
// strategy another line uses is #n everywhere.

const OPENER = { scopus: f => `${f}(`, wos: f => `${f}=(`, epmc: f => `${f}:(`, ctgov: f => `AREA[${f}](`, ictrp: f => `${f}(` };
const PROX = { W: 'W', PRE: 'PRE', NEAR: 'NEAR', NEXT: 'NEXT', SAME: 'SAME', ADJ: 'ADJ' };

// a term keeps the quoting it was read with: PubMed and Ovid read adjacent words as one phrase without quotes
const quote = (t, quoted) => (quoted ? `"${t}"` : t);

/** One term in the dialect; `inherited` is the field the term's group already opened, so the term is bare in it. */
function term(t, d, inherited) {
  const f = t.field || '';
  if (d === 'pubmed') {
    if (!f) return quote(t.text, t.quoted);
    return `${quote(t.text, t.quoted)}[${f}${t.proximity != null && !/:~/.test(f) ? `:~${t.proximity}` : ''}]`;
  }
  if (d === 'cochrane') {
    if (t.controlled || /^(mh|mesh)$/i.test(f)) return `[mh ${t.explode === false ? '^' : ''}${quote(t.text, t.quoted)}]`;
    // a term of capitals alone before a suffix would read as a Europe PMC field (LITT:ti,ab,kw), so it is bracketed
    const q = quote(t.text, t.quoted), safe = /^[A-Z_]+$/.test(q) ? `(${q})` : q;
    return f && f !== inherited ? `${safe}:${f}` : q;
  }
  if (d === 'ovid' || d === 'embase') {
    if (t.controlled || /^(mh|sh|emtree)$/i.test(f)) return `${t.explode === false ? '' : 'exp '}${t.text}/`;
    return f && f !== inherited ? `${t.text}.${f}.` : t.text;
  }
  if (d === 'epmc') {
    const q = `${quote(t.text, t.quoted)}${t.proximity != null ? `~${t.proximity}` : ''}`;
    return f && f !== inherited ? `${f}:${q}` : q;
  }
  const q = quote(t.text, t.quoted);
  if (!f || f === inherited || !OPENER[d]) return q;
  return d === 'ctgov' ? `AREA[${f}]${q}` : `${OPENER[d](f)}${q})`;
}

/** The field every term under `b` searches, or '' when they differ, a term has none, or a line stands among them. */
function sharedField(b) {
  const seen = new Set(), walk = n => {
    if (n.kind === 'term') seen.add(n.field || '');
    else if (n.kind === 'line') seen.add('');
    else (n.items || []).forEach(walk);
  };
  walk(b);
  return seen.size === 1 ? [...seen][0] : '';
}

const op = (word, d) => (d === 'ovid' || d === 'embase' ? word.toLowerCase() : word);
const notWord = d => (d === 'scopus' ? 'AND NOT' : op('NOT', d));
// whether a group is written with its field opened round it (FIELD(…), (…):suffix), which brackets it already
const opened = (b, d, inherited) => { const f = b.kind !== 'term' && b.kind !== 'line' && sharedField(b); return !!f && f !== inherited && (!!OPENER[d] || ['cochrane', 'ovid', 'embase'].includes(d)); };
const bracket = (s, b, d, inherited) => (b.kind === 'term' || b.kind === 'line' || opened(b, d, inherited) ? s : `(${s})`);

/** The block as text in dialect `d`; `inherited` is the field already opened round it. */
export function writeBlock(b, d = 'pubmed', inherited = '') {
  if (!b) return '';
  if (b.kind === 'term') return term(b, d, inherited);
  if (b.kind === 'line') return `#${b.n}`;
  if (b.kind === 'not') return '';   // a But not is written by the All of it takes away from
  // a field shared by every term inside is opened once, round the whole group, where the dialect opens fields
  if (opened(b, d, inherited)) {
    const shared = sharedField(b);
    if (OPENER[d]) return `${OPENER[d](shared)}${writeBlock(b, d, shared)})`;
    if (d === 'cochrane') return `(${writeBlock(b, d, shared)}):${shared}`;
    return `(${writeBlock(b, d, shared)}).${shared}.`;
  }
  const part = x => bracket(writeBlock(x, d, inherited), x, d, inherited);
  let out;
  if (b.kind === 'near') {
    const word = d === 'ovid' || d === 'embase' ? `adj${b.n ?? ''}` : `${PROX[b.op] || 'NEAR'}${b.n != null ? `/${b.n}` : ''}`;
    out = b.items.map(part).join(` ${word} `);
  } else if (b.kind === 'any') out = b.items.map(part).join(` ${op('OR', d)} `);
  else {
    // A AND B NOT C is one set in every database's order of operators (A and B, less C), so a NOT needs no bracket round what it takes
    // from. A But not is written after what is kept wherever it stands, its mouth any of what it holds (NOT x, NOT (x OR y)); an empty
    // one is nothing, and so is an All of that keeps nothing (lib/query-blocks.mjs marks it)
    const kept = b.items.filter(x => x.kind !== 'not');
    if (!kept.length) return '';
    const away = b.items.filter(x => x.kind === 'not' && x.items.length).map(x => (x.items.length > 1 ? { kind: 'any', items: x.items } : x.items[0]));
    out = `${kept.map(part).join(` ${op('AND', d)} `)}${away.map(n => ` ${notWord(d)} ${part(n)}`).join('')}`.trim();
  }
  return out;
}

/** The text with line `line` (of the model's `lines`) rewritten from `block` in the model's dialect; the rest of the text as it was. */
export function rewriteLine(src, line, block, dialect) {
  const text = writeBlock(block, dialect);
  if (line.at == null || line.end == null) return text;
  return src.slice(0, line.at) + text + src.slice(line.end);
}
