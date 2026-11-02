// A boolean search string, read into its structure.
//
// Databases accept parentheses, quoted phrases, AND/OR/NOT, field tags
// ([tiab], [Mesh], [tiab:~2] proximity) and truncation (*). The string is
// what is sent; the tree is what a reader checks: which concepts are joined
// by AND, which synonyms sit under each OR, and where operators are mixed at
// one level without parentheses — which PubMed evaluates left to right, not
// by precedence, and which is therefore usually a mistake.

function tokenize(src, problems = []) {
  const out = [];
  const s = String(src || '');
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (/\s/.test(c)) { i++; continue; }
    if (c === '(' || c === ')') { out.push({ t: c }); i++; continue; }
    let text = '';
    if (c === '"' || c === '“') {
      const end = s.indexOf(c === '“' ? '”' : '"', i + 1);
      if (end < 0) problems.push('missing closing quote');
      const j = end < 0 ? s.length : end;
      text = s.slice(i, j + 1); i = j + 1;
    } else {
      const m = s.slice(i).match(/^[^\s()[\]]+/);
      text = m ? m[0] : c; i += text.length;
    }
    // an attached field tag: [tiab], [Mesh], [tiab:~2], [Title/Abstract]
    let field = '';
    const tag = s.slice(i).match(/^\s*\[([^\]]*)\]/);
    if (tag) { field = tag[1]; i += tag[0].length; }
    else if (/^\s*\[/.test(s.slice(i))) { problems.push('missing ]'); i = s.length; }
    const up = text.toUpperCase();
    if (!field && (up === 'AND' || up === 'OR' || up === 'NOT')) { out.push({ t: up }); continue; }
    out.push({ t: 'TERM', text, field });
  }
  return out;
}

/** Parse tree: { op: 'AND'|'OR'|'NOT', children: [] } | { term, field, phrase, truncated, proximity }. */
export function parseQuery(src) {
  const errors = [];
  const toks = tokenize(src, errors);
  let p = 0;
  const peek = () => toks[p];
  const take = () => toks[p++];

  const term = tk => {
    const phrase = /^["“]/.test(tk.text);
    const text = tk.text.replace(/^["“]|["”]$/g, '');
    const prox = tk.field.match(/:~(\d+)$/);
    return { term: text, field: tk.field.replace(/:~\d+$/, ''), phrase, truncated: /\*$/.test(text), proximity: prox ? +prox[1] : null };
  };
  const atom = () => {
    const tk = peek();
    if (!tk) { errors.push('ends early'); return null; }
    if (tk.t === '(') {
      take();
      const inner = expr();
      if (peek()?.t === ')') take(); else errors.push('missing )');
      return inner;
    }
    if (tk.t === ')') { errors.push('unexpected )'); take(); return atom(); }
    if (tk.t === 'TERM') { take(); return term(tk); }
    // a stray operator
    errors.push(`stray ${tk.t}`); take(); return atom();
  };
  const unary = () => {
    if (peek()?.t === 'NOT') { take(); const c = atom(); return c ? { op: 'NOT', children: [c] } : null; }
    return atom();
  };
  // One level: operands separated by operators. Adjacent untagged words are
  // one term, as a database reads them ("spinal fusion"). Mixed operators
  // at one level are kept in order, as the database will read them, and
  // flagged.
  const operand = () => {
    let n = unary();
    // Merge a run of bare words into one term. A tag on the run's last word
    // belongs to the whole run: PubMed reads "spinal fusion[tiab]" as that
    // phrase in title/abstract, not as two terms joined by AND.
    while (n && n.term != null && !n.field && !n.phrase && peek()?.t === 'TERM' && !/^["“]/.test(peek().text)) {
      const nx = term(take());
      n = { ...n, term: `${n.term} ${nx.term}`, truncated: nx.truncated, field: nx.field, proximity: nx.proximity };
      if (nx.field) break;
    }
    return n;
  };
  const expr = () => {
    const items = [operand()];
    const ops = [];
    while (peek() && peek().t !== ')') {
      const tk = peek();
      if (tk.t === 'AND' || tk.t === 'OR') { take(); ops.push(tk.t); items.push(operand()); continue; }
      if (tk.t === 'NOT') { take(); const c = atom(); ops.push('AND'); items.push(c ? { op: 'NOT', children: [c] } : null); continue; }
      ops.push('AND'); items.push(operand());   // two operands with nothing between: AND
    }
    const kids = items.filter(Boolean);
    if (kids.length === 1 && !ops.length) return kids[0];
    const set = new Set(ops);
    if (set.size <= 1) return { op: ops[0] || 'AND', children: kids };
    let node = kids[0];
    for (let k = 1; k < kids.length; k++) node = { op: ops[k - 1], children: [node, kids[k]] };
    node.mixed = true;   // one warning for the level, on its outermost node
    return node;
  };
  const tree = toks.length ? expr() : null;
  if (p < toks.length) errors.push('text after the end');
  return { tree, errors };
}

export function stats(tree) {
  let terms = 0, mixed = 0, phrases = 0;
  const walk = n => { if (!n) return; if (n.term != null) { terms++; if (n.phrase) phrases++; return; } if (n.mixed) mixed++; n.children.forEach(walk); };
  walk(tree);
  const concepts = tree?.op === 'AND' ? tree.children.length : tree ? 1 : 0;
  return { terms, phrases, concepts, mixed };
}

// ---- the string as lines to read --------------------------------------------------------------------------
// A long query is easier to check one concept to a line: the string is cut before each AND or NOT that joins
// its outermost operands (an OR list stays on its line), inside one wrapper that holds the whole string
// ((…), TS=(…), TITLE-ABS-KEY(…)) when there is nothing to cut outside it. A numbered strategy (#1 … #2 …,
// as Cochrane and Ovid export it) is cut before each line number in turn. The text is not rewritten: joined
// with spaces the lines are the string. Anything else is one line.

/** True when a text reads as a database query rather than prose: an upper-case operator, a field tag or a field opener. */
export function looksLikeQuery(src) {
  const s = String(src || '');
  return /(^|[\s)])(AND|OR|NOT)(?=[\s(])/.test(s) || /\[[A-Za-z][^\]]*\]/.test(s) || /^\s*[A-Z][A-Z-]*\s*=?\s*\(/.test(s);
}

// Splits at depth 0, outside quotes, before AND and NOT (a NOT right after AND stays with it).
function splitTop(s) {
  const parts = []; let depth = 0, quote = '', start = 0, last = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quote) { if (c === quote) quote = ''; continue; }
    if (c === '"') { quote = '"'; continue; }
    if (c === '“') { quote = '”'; continue; }
    if (c === '(') { depth++; last = '('; continue; }
    if (c === ')') { depth = Math.max(0, depth - 1); last = ')'; continue; }
    if (depth || !/[AN]/.test(c) || (i && !/[\s)]/.test(s[i - 1]))) { if (!/\s/.test(c)) last = c; continue; }
    const op = s.slice(i).match(/^(AND|NOT)(?=[\s(])/)?.[1];
    if (!op) { last = c; continue; }
    if (i > start && s.slice(start, i).trim() && !(op === 'NOT' && /AND\s*$/.test(s.slice(start, i)))) { parts.push(s.slice(start, i).trim()); start = i; }
    i += op.length - 1; last = op;
  }
  parts.push(s.slice(start).trim());
  return parts.filter(Boolean);
}
// Index of the parenthesis that closes the one at `at`, outside quotes; -1 when it is never closed.
function closeOf(s, at) {
  let depth = 0, quote = '';
  for (let i = at; i < s.length; i++) {
    const c = s[i];
    if (quote) { if (c === quote) quote = ''; continue; }
    if (c === '"') quote = '"'; else if (c === '“') quote = '”';
    else if (c === '(') depth++;
    else if (c === ')' && !--depth) return i;
  }
  return -1;
}
function numberedLines(s) {
  if (!/^#1\s/.test(s)) return null;
  const cuts = [0]; let next = 2;
  for (const m of s.matchAll(/(^|\s)#(\d+)(?=\s)/g)) {
    const at = m.index + m[1].length;
    if (Number(m[2]) !== next) continue;
    const before = s.slice(0, at).trim().split(/\s+/).at(-1) || '';
    if (/^(AND|OR|NOT)$/i.test(before) || before.endsWith('(')) continue;
    cuts.push(at); next++;
  }
  return cuts.length > 1 ? cuts.map((c, i) => s.slice(c, cuts[i + 1]).trim()) : null;
}

/** The query as lines to read (see above); one line when it has no structure to show. */
export function queryLines(src) {
  const s = String(src || '').replace(/\s+/g, ' ').trim();
  if (!s) return [];
  const numbered = numberedLines(s);
  if (numbered) return numbered;
  return cut(s, 0);
}
// Cuts one operand: at its own top level, else inside the one wrapper that holds all of it. An operand joined by AND
// (or the first) that is itself a group of AND-joined concepts is cut too, so ((A) AND (B)) AND (C) reads as three lines.
function cut(s, level) {
  let inner = s, prefix = '', suffix = '';
  for (let guard = 0; guard < 8; guard++) {
    const parts = splitTop(inner);
    if (parts.length > 1) {
      const lines = parts.map((p, i) => `${i ? '' : prefix}${p}${i === parts.length - 1 ? suffix : ''}`);
      return level > 1 ? lines : lines.flatMap(line => {
        const op = line.match(/^AND\s+(?=\()/)?.[0] || (/^[(A-Za-z]/.test(line) && !/^(AND|NOT)\b/.test(line) ? '' : null);
        if (op == null) return [line];
        const more = cut(line.slice(op.length), level + 1);
        return more.length > 1 ? [`${op}${more[0]}`, ...more.slice(1)] : [line];
      });
    }
    const open = inner.match(/^(?:[A-Za-z][A-Za-z-]*\s*=?\s*)?\(/);
    if (!open || closeOf(inner, open[0].length - 1) !== inner.length - 1) break;
    prefix += open[0]; suffix = `)${suffix}`; inner = inner.slice(open[0].length, -1).trim();
  }
  return [s];
}
