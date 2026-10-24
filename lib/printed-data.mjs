// Printed data: what a table or figure that is in the folder says, read back from its own text, and set against the app's data (plan §2,
// "Submission files": the printed file is the truth). The order of sources: the printed text (an SVG or PDF of the drawing), then the data
// files its script reads (lib/figure-lineage.mjs), then the app's data; with none of them there is no data to redraw from. Nothing here
// rebuilds a file: differences are listed, never applied.
//
//   svgItems(svg), pdfItems(pages)         -> [{ x, y, t }]: each run of text where it stands (y down the page)
//   linesOf(items)                         -> [{ y, cells }]: the runs that share a baseline, left to right
//   studyBlocks(lines)                     -> [{ key, label, lines }]: a study's line, then its further arms' lines
//   comparePrinted(blocks, expected)       -> { matched, mismatches }: the app's values against the printed ones, by study and field
//   chooseSource({ printed, script, app }) -> { source, file, label }
// The readers at the end (readPrinted, scriptData) read the folder; the rest is pure.

const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', minus: '−', ndash: '–', shy: '' };
const decode = s => String(s).replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => (e[0] === '#' ? String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : ENT[e.toLowerCase()] ?? m));
const attrsOf = s => Object.fromEntries([...String(s).matchAll(/([\w:-]+)\s*=\s*"([^"]*)"/g)].map(m => [m[1], m[2]]));
const num = v => parseFloat(String(v ?? '').trim().split(/[\s,]+/)[0]);

/** The text runs of an SVG with their positions (a tspan placed on its own is a run of its own); groups' transforms are not followed. */
export function svgItems(svg) {
  const items = [], push = (x, y, t) => { const text = decode(String(t).replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim(); if (text && Number.isFinite(x) && Number.isFinite(y)) items.push({ x, y, t: text }); };
  for (const m of String(svg || '').matchAll(/<text\b([^>]*)>([\s\S]*?)<\/text>/g)) {
    const at = attrsOf(m[1]), spans = [...m[2].matchAll(/<tspan\b([^>]*)>([\s\S]*?)<\/tspan>/g)];
    if (spans.some(sp => /\b[xy]\s*=/.test(sp[1]))) for (const sp of spans) { const a = attrsOf(sp[1]); push(num(a.x ?? at.x), num(a.y ?? at.y), sp[2]); }
    else push(num(at.x), num(at.y), m[2]);
  }
  return items;
}
/**
 * The text runs of a PDF's pages (lib/page-layout.mjs pageLayout: PDF space, y up), as one sheet with y down, page after page. `drawn`
 * (pdfDrawn: the page's own strings and the glyphs it draws as pictures) puts back what the text layer loses: a hyphen its font maps to a
 * soft hyphen ("Single-arm"), and a character drawn as a picture ("0–8%"). A run whose font is named (`font`) says whether it is bold (`b`).
 */
export function pdfItems(pages) {
  const out = [];
  let top = 0;
  for (const p of pages || []) {
    const runs = restoreDrawn((p.items || []).map(it => ({ ...it, str: String(it.str || '').replace(/­+$/, '').replace(/­/g, '-') })), p.drawn);
    for (const it of runs) { const t = String(it.str || '').replace(/\s+/g, ' ').trim(); if (t) out.push({ x: it.x1, y: top + (p.height - it.y1), t, ...(Number.isFinite(it.w) ? { w: it.w } : {}), ...(it.font ? { b: /bold|black|heavy/i.test(it.font) } : {}) }); }
    top += (p.height || 0) + 100;
  }
  return out;
}
/**
 * The text layer's runs (`{ str, x1, y1, w }`) with what the page draws put back (`drawn` { runs, glyphs } from its content stream):
 *  - a string the page holds with a hyphen that the text layer dropped is written with it again;
 *  - a glyph drawn right before one of the page's strings goes before that string's text: in place of the space the text layer put in the
 *    gap ("revision 0 7%" -> "revision 0–7%"), or at a run's start, joined to the run before when that one ends where the glyph starts
 *    ("…loosening 0" + "8% …" -> "…loosening 0–8% …"; "≥" + "24" -> "≥24");
 *  - any other glyph (a mark in a column: ▲) is a run of its own.
 */
export function restoreDrawn(items, drawn) {
  const runs = (items || []).map(it => ({ ...it })), { runs: strings = [], glyphs = [] } = drawn || {};
  const same = (a, b) => Math.abs(a - b) <= 1.5, width = r => (Number.isFinite(r.w) ? r.w : r.str.length * 4);
  for (const t of new Set(strings.map(x => x.t).filter(t => /\S-\S/.test(t)))) {
    const bare = t.replace(/-/g, '');
    if (bare.replace(/\s/g, '').length < 3) continue;
    for (const r of runs) if (!r.str.includes(t) && r.str.includes(bare)) r.str = r.str.replace(bare, t);
  }
  for (const g of [...glyphs].sort((a, b) => a.x - b.x)) {
    const line = runs.filter(r => same(r.y1, g.y) && r.str.trim()).sort((a, b) => a.x1 - b.x1);   // a run of a space alone is the gap, not text
    const next = strings.filter(r => same(r.y, g.y) && r.x >= g.x - 0.5 && r.x - g.x <= (g.w || 5) + 2).sort((a, b) => a.x - b.x)[0];
    const head = next ? next.t.replace(/-/g, '').trimStart().slice(0, 12) : '';
    let placed = false;
    if (head) {
      // the text layer's run that holds the string, and where in it: the occurrence nearest where the string stands
      const hits = line.flatMap(r => [...r.str.matchAll(new RegExp(head.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'))].map(m => ({ r, at: m.index, d: Math.abs(r.x1 + (m.index / Math.max(1, r.str.length)) * width(r) - next.x) })));
      const hit = hits.sort((a, b) => a.d - b.d)[0];
      if (hit && hit.at > 0 && hit.r.str[hit.at - 1] === ' ') { hit.r.str = hit.r.str.slice(0, hit.at - 1) + g.t + hit.r.str.slice(hit.at); placed = true; }
      else if (hit && hit.at === 0) {
        const r = hit.r, before = line.filter(x => x !== r && x.x1 < r.x1).at(-1);
        const gap = before ? g.x - (before.x1 + width(before)) : Infinity;   // a dropped soft hyphen leaves the run short of where it ends
        if (gap >= -1.5 && gap <= (g.w || 5)) { before.str += g.t + r.str; before.w = r.x1 + width(r) - before.x1; runs.splice(runs.indexOf(r), 1); }
        else { r.str = g.t + r.str; r.w = width(r) + (r.x1 - g.x); r.x1 = g.x; }
        placed = true;
      }
    }
    if (!placed) runs.push({ str: g.t, x1: g.x, y1: g.y, w: g.w || 4 });
  }
  return runs;
}

// glyphs matplotlib (and others) draw as a form of their own, named after the glyph: /F2-LiberationSans-Regular-endash Do
const GLYPH = { endash: '–', emdash: '—', minus: '−', hyphen: '-', greaterequal: '≥', lessequal: '≤', plusminus: '±', multiply: '×', periodcentered: '·',
  degree: '°', mu: 'µ', approxequal: '≈', notequal: '≠', triagup: '▲', triagdn: '▼', bullet: '•', dagger: '†', daggerdbl: '‡', section: '§', quoteright: '’', quoteleft: '‘',
  quotedblleft: '“', quotedblright: '”', ellipsis: '…', alpha: 'α', beta: 'β', chi: 'χ', tau: 'τ', Delta: 'Δ', infinity: '∞', arrowright: '→', arrowleft: '←', arrowup: '↑', arrowdown: '↓' };
const glyphOf = name => GLYPH[name] ?? (/^uni([0-9A-F]{4,6})$/i.test(name) ? String.fromCodePoint(parseInt(name.slice(3), 16)) : null);
const literal = s => s.slice(1, -1).replace(/\\([nrtbf()\\]|[0-7]{1,3}|\r?\n)/g, (m, e) => ({ n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', '(': '(', ')': ')', '\\': '\\' }[e] ?? (/^[0-7]/.test(e) ? String.fromCharCode(parseInt(e, 8)) : '')));
/**
 * What one content stream draws, where it stands in page space: its literal strings (`runs` [{ x, y, t }], a TJ's pieces as one) and the
 * glyphs it draws as forms (`glyphs` [{ x, y, t, w }]). q, Q, cm, BT, Td, TD and Tm are followed; nothing else is.
 */
export function streamDrawn(content) {
  const glyphs = [], runs = [], stack = [], I = [1, 0, 0, 1, 0, 0];
  let m = I, tm = I, lm = I, args = [];
  const mul = (a, b) => [a[0] * b[0] + a[1] * b[2], a[0] * b[1] + a[1] * b[3], a[2] * b[0] + a[3] * b[2], a[2] * b[1] + a[3] * b[3], a[4] * b[0] + a[5] * b[2] + b[4], a[4] * b[1] + a[5] * b[3] + b[5]];
  const TOK = /\((?:\\[\s\S]|[^\\)])*\)|<<|>>|<[0-9A-Fa-f\s]*>|\/[^\s/[\]()<>{}%]+|[+-]?(?:\d+\.?\d*|\.\d+)|[A-Za-z'"*]+[0-9]?|[[\]]|%[^\n]*/g;
  for (const [tok] of String(content || '').matchAll(TOK)) {
    if (/^[+-]?[\d.]/.test(tok) || tok[0] === '/' || tok[0] === '(' || tok === '[' || tok === ']') { args.push(tok[0] === '/' || tok[0] === '(' || tok === '[' || tok === ']' ? tok : Number(tok)); continue; }
    const nums = args.filter(a => typeof a === 'number');
    if (tok === 'q') stack.push(m);
    else if (tok === 'Q') m = stack.pop() || I;
    else if (tok === 'cm' && nums.length >= 6) m = mul(nums.slice(-6), m);
    else if (tok === 'BT') tm = lm = I;
    else if ((tok === 'Td' || tok === 'TD') && nums.length >= 2) tm = lm = mul([1, 0, 0, 1, ...nums.slice(-2)], lm);
    else if (tok === 'Tm' && nums.length >= 6) tm = lm = nums.slice(-6);
    else if (/^(TJ|Tj|'|")$/.test(tok)) {
      const t = args.filter(a => typeof a === 'string' && a[0] === '(').map(literal).join(''), at = mul(tm, m);
      if (t.trim()) runs.push({ x: at[4], y: at[5], t });
    } else if (tok === 'Do' && typeof args.at(-1) === 'string') { const g = /-([A-Za-z0-9]+)$/.exec(args.at(-1))?.[1], t = g ? glyphOf(g) : null; if (t) glyphs.push({ x: m[4], y: m[5], t, w: Math.abs(m[0]) * 556 }); }
    args = [];
  }
  return { runs, glyphs };
}
/**
 * What a one-page PDF draws (streamDrawn over each content stream, Flate or plain), for restoreDrawn; `{ runs: [], glyphs: [] }` for a PDF
 * of several pages. `inflate(bytes)` -> text: the platform's DecompressionStream.
 */
export async function pdfDrawn(bytes, { inflate = inflateText } = {}) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []), raw = new TextDecoder('latin1').decode(b), out = { runs: [], glyphs: [] };
  if ((raw.match(/\/Type\s*\/Page\b/g) || []).length !== 1) return out;
  for (const m of raw.matchAll(/<<((?:(?!<<|>>)[\s\S]){0,600})>>\s*stream\r?\n/g)) {
    const start = m.index + m[0].length;
    let end = raw.indexOf('endstream', start);
    while (end > start && /[\r\n]/.test(raw[end - 1])) end--;   // the line end before endstream is not the stream's
    if (end <= start || /\/(Subtype\s*\/(Image|Form)|Type\s*\/XObject|Length1|FontFile)/.test(m[1])) continue;
    let text = '';
    try { text = /FlateDecode/.test(m[1]) ? await inflate(b.subarray(start, end)) : /\/Filter/.test(m[1]) ? '' : raw.slice(start, end); } catch { continue; }
    if (!/\bBT\b|\bDo\b/.test(text)) continue;
    const d = streamDrawn(text);
    out.runs.push(...d.runs); out.glyphs.push(...d.glyphs);
  }
  return out;
}
async function inflateText(bytes) {
  const ds = new DecompressionStream('deflate'), w = ds.writable.getWriter();
  w.write(bytes).catch(() => {}); w.close().catch(() => {});
  const buf = await new Response(ds.readable).arrayBuffer().catch(() => null);
  return buf ? new TextDecoder('latin1').decode(buf) : '';
}
/** The runs that share a baseline (within `tol`), as lines down the page, each line's cells left to right. */
export function linesOf(items, { tol = 3 } = {}) {
  const sorted = [...(items || [])].sort((a, b) => a.y - b.y || a.x - b.x), lines = [];
  for (const it of sorted) {
    const last = lines.at(-1);
    if (last && Math.abs(it.y - last.y) <= tol) last.items.push(it);
    else lines.push({ y: it.y, items: [it] });
  }
  return lines.map(l => { const items = l.items.sort((a, b) => a.x - b.x); return { y: l.y, cells: items.map(i => i.t), xs: items.map(i => i.x), ws: items.map(i => (Number.isFinite(i.w) ? i.w : i.t.length * 4.4)) }; });
}

// ---- studies --------------------------------------------------------------------------------------------------------------------------------
/** A study's label as printed: a surname (with "et al." or not) and a year, a letter after it for a second paper of that year. */
export const STUDY = /^((?:(?:[DdLl][aeiou]s?|[Dd]el|[Vv][ao]n|[Dd]er|[Tt]en|[Aa]l)\s+)*[A-ZÀ-Ž][\p{L}'’-]+)(?:\s+et\s+al\.?,?|,)?\s+((?:19|20)\d{2}[a-z]?)\b/u;
const fold = s => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
/** The key two labels of one study share ("Lee 2019", "Lee et al., 2019, South Korea": lee|2019), or '' for no study. */
export function studyKey(label) {
  const m = STUDY.exec(String(label || '').trim());
  return m ? `${fold(m[1]).replace(/\s+/g, ' ')}|${m[2]}` : '';
}
const STOP = /^(total|subtotal|heterogeneity|test for|overall|pooled|direction of effect|favou?rs)/i;
/**
 * The printed studies: a line that starts with a study's label, then the lines that continue it (a further arm: a line of two or more cells
 * that names no study), up to a heading, a total or the next study.
 */
export function studyBlocks(lines) {
  const out = [];
  let cur = null;
  for (const l of lines || []) {
    const text = l.cells.join(' ').trim(), key = studyKey(text);
    if (key) { cur = { key, label: STUDY.exec(text)[0].trim(), lines: [l.cells] }; out.push(cur); continue; }
    if (cur && l.cells.length >= 2 && !STOP.test(text) && TOKEN.test(text)) cur.lines.push(l.cells);
    else cur = null;
  }
  return out;
}

// ---- values ---------------------------------------------------------------------------------------------------------------------------------
const TOKEN = /\d|\bNR\b/;
/** The values a printed line holds, in order: counts over totals (3/30), numbers (with a percent), NR. */
export function tokensOf(text) {
  // a dash between two numbers is a range ("0–8%"), not a minus: the second number keeps no sign
  return [...String(text || '').replace(/(\d%?)\s*[−–—-]\s*(?=\d)/g, '$1 ').replace(/[−–]/g, '-').matchAll(/\b\d+\s*\/\s*\d+\b|-?\d+(?:[.,]\d+)?%?|\bNR\b/g)].map(m => m[0].replace(/\s+/g, '').replace(/(\d),(\d{3})\b/, '$1$2'));
}
const same = (a, b) => {
  if (a === b) return true;
  const x = Number(String(a).replace('%', '')), y = Number(String(b).replace('%', ''));
  return /%$/.test(a) === /%$/.test(b) && Number.isFinite(x) && Number.isFinite(y) && Math.abs(x - y) < 0.005 + 1e-9;
};
/** A study's printed lines read against the fields the app expects of each line: [{ field, value }]. */
function matchLine(cells, fields) {
  const text = cells.join(' ').replace(STUDY, ''), got = tokensOf(text), out = [];
  let at = 0;
  for (const f of fields) {
    const want = String(f.value);
    let k = at;
    while (k < got.length && !same(got[k], want)) k++;
    if (k < got.length) at = k + 1;
    else out.push({ field: f.field, app: want, printed: got[at] ?? 'Not printed' });
  }
  return out;
}
/**
 * The app's values against the printed ones. `expected` [{ study, lines: [[{ field, value }]] }] (a line per arm, in order). A study the app
 * holds that is not printed, and one printed that the app does not hold, are differences too; a mismatch is { study, field, app, printed }.
 */
export function comparePrinted(blocks, expected) {
  const byKey = new Map((blocks || []).map(b => [b.key, b])), mismatches = [];
  let matched = 0;
  for (const e of expected || []) {
    const b = byKey.get(studyKey(e.study));
    if (!b) { mismatches.push({ study: e.study, field: 'Study', app: e.study, printed: 'Not printed' }); continue; }
    byKey.delete(b.key); matched++;
    e.lines.forEach((fields, i) => {
      const cells = b.lines[i];
      if (!cells) { mismatches.push({ study: e.study, field: `Line ${i + 1}`, app: fields.map(f => f.value).join(' '), printed: 'Not printed' }); return; }
      for (const m of matchLine(cells, fields)) mismatches.push({ study: e.study, ...m, ...(e.lines.length > 1 ? { field: `${m.field}, ${fields.arm || `arm ${i + 1}`}` } : {}) });
    });
  }
  for (const b of byKey.values()) mismatches.push({ study: b.label, field: 'Study', app: 'Not in the app', printed: b.label });
  return { matched, mismatches };
}

/**
 * The app's values against a printed table read by position (printedTable's rows, its head first): each study's rows (its first, then the
 * rows under it that name no study, a Direction of effect row passed over) and each field in the column whose printed head names it
 * ("Follow-up" in "Follow-up (mo)"), so a table printed in another column order is read right. Same result shape as comparePrinted.
 */
export function compareRows(rows, expected) {
  const head = (rows?.[0] || []).map(h => fold(String(h)).replace(/[^a-z0-9]+/g, ' ').trim()), body = (rows || []).slice(1), mismatches = [];
  const colOf = field => { const f = fold(String(field)).replace(/[^a-z0-9]+/g, ' ').trim(); return head.findIndex(h => h === f || h.startsWith(`${f} `)); };
  const blocks = new Map();
  let cur = null;
  for (const r of body) {
    if (r.length < 2) { cur = null; continue; }
    const key = studyKey(r[0] || '');
    if (key) { cur = { key, label: r[0], rows: [r] }; blocks.set(key, cur); continue; }
    if (cur && !STOP.test(String(r[1] || '').trim())) cur.rows.push(r);
  }
  let matched = 0;
  for (const e of expected || []) {
    const b = blocks.get(studyKey(e.study));
    if (!b) { mismatches.push({ study: e.study, field: 'Study', app: e.study, printed: 'Not printed' }); continue; }
    blocks.delete(studyKey(e.study)); matched++;
    e.lines.forEach((fields, i) => {
      const row = b.rows[i];
      if (!row) { mismatches.push({ study: e.study, field: `Line ${i + 1}`, app: fields.map(f => f.value).join(' '), printed: 'Not printed' }); return; }
      for (const f of fields) {
        const c = colOf(f.field), got = c < 0 ? null : tokensOf(row[c])[0] ?? null;
        if (c < 0 || (got != null && same(got, String(f.value)))) continue;
        mismatches.push({ study: e.study, field: e.lines.length > 1 ? `${f.field}, ${fields.arm || `arm ${i + 1}`}` : f.field, app: String(f.value), printed: got ?? 'Not printed' });
      }
    });
  }
  for (const b of blocks.values()) mismatches.push({ study: b.label, field: 'Study', app: 'Not in the app', printed: b.label });
  return { matched, mismatches };
}

/** What a forest's studies should print: events and totals of each arm, the risk ratio and its interval at two decimals. */
export function forestExpected(studies) {
  const f2 = v => (Math.round(v * 100) / 100).toFixed(2);
  return (studies || []).map(st => {
    const fields = [['Events, intervention', st.e1], ['Total, intervention', st.n1], ['Events, comparator', st.e2], ['Total, comparator', st.n2]].filter(([, v]) => v != null).map(([field, value]) => ({ field, value: String(value) }));
    if (st.est) { const se = Math.sqrt(st.est.v); fields.push({ field: 'Risk ratio', value: f2(Math.exp(st.est.y)) }, { field: 'Lower limit', value: f2(Math.exp(st.est.y - 1.96 * se)) }, { field: 'Upper limit', value: f2(Math.exp(st.est.y + 1.96 * se)) }); }
    return { study: st.study, lines: [fields] };
  });
}
/** What a sheet of effects should print (lib/synth-figures.mjs effectsData): each arm's patients, follow-up and outcomes. */
export function effectsExpected(data) {
  return (data?.sections || []).flatMap(sec => sec.studies.map(st => ({ study: st.study, lines: st.arms.map(a => Object.assign(
    [{ field: 'Patients', value: String(a.n ?? '') }, ...tokensOf(a.fu).slice(0, 1).map(v => ({ field: 'Follow-up', value: v })),
      ...a.cells.flatMap((c, k) => tokensOf(c.text).slice(0, 1).map(v => ({ field: data.outcomes[k], value: v })))].filter(f => f.value !== ''), { arm: a.name })) })));
}

/** A forest drawn from its printed lines: each study's ratio and interval (the line's last three numbers that make one), the total's too. */
export function printedForest(lines) {
  const out = [];
  for (const l of lines || []) {
    const text = l.cells.join(' '), key = studyKey(text), total = /^total\b/i.test(text);
    if (!key && !total) continue;
    const m = [...text.replace(/[−–]/g, '-').matchAll(/(\d+(?:\.\d+)?)\s*[[(]\s*(\d+(?:\.\d+)?)\s*[,;to–-]+\s*(\d+(?:\.\d+)?)\s*[\])]/g)].at(-1);
    if (!m) continue;
    out.push({ label: key ? STUDY.exec(text)[0].trim() : 'Total', est: Number(m[1]), lo: Number(m[2]), hi: Number(m[3]), ...(total ? { pooled: true } : {}) });
  }
  return out;
}
/**
 * How a printed forest is laid out, read from its lines (cells left to right), so the screen forest is drawn with the same options
 * (lib/forest-options.mjs): its subgroup headings ("2.1.1 Same construct type" -> "Same construct type"; a heading need not be numbered: a
 * line of one cell between the column heads and the axis that is no study, total or note), whether it pools (a Total line), its ratio axis
 * (the ticks 0.01 … 100 -> '100'), whether it prints the follow-up and the events and totals, the arms its column heads name, its measure
 * ("Risk ratio") and its favours labels. `{ headings, groups, pool, axis, fu, events, arms, measure, favours }`, `groups` [{ name, studies }]
 * each heading's study labels; `arms` and `favours` [] when the print names none.
 */
export function printedForestLayout(lines) {
  const texts = (lines || []).map(l => (Array.isArray(l) ? l : l.cells || []).map(c => String(c).trim()));
  const tickAt = texts.findIndex(c => c.length >= 3 && c.every(x => /^\d+(\.\d+)?$/.test(x))), ticks = tickAt >= 0 ? texts[tickAt].map(Number) : [];
  const headAt = texts.findIndex(c => /^stud(y|ies)\b/i.test(c[0] || ''));
  const numbered = c => c.length === 1 && /^\d+(\.\d+)+\s+\S/.test(c[0]);
  const isHeading = (c, i) => numbered(c) || (c.length === 1 && i > headAt && headAt >= 0 && (tickAt < 0 || i < tickAt) && !studyKey(c[0]) && !STOP.test(c[0]) && !/\d/.test(c[0]) && /\p{L}{3}/u.test(c[0]));
  const name = c => c[0].replace(/^\d+(\.\d+)+\s+/, '');
  const headings = texts.filter(isHeading).map(name);
  const pool = texts.some(c => /^(total|subtotal)\b/i.test(c[0] || '') && c.some(x => /\[/.test(x)));
  const top = ticks.length ? Math.max(...ticks) : 0, axis = [2, 5, 10, 100, 1000].includes(top) && ticks.includes(1 / top) || [2, 5, 10, 100, 1000].includes(top) && Math.min(...ticks) <= 1 / top + 1e-9 ? String(top) : '';
  const headLines = texts.slice(0, headAt >= 0 ? headAt + 1 : 4), head = headLines.flat().join(' ');
  // each heading's studies: the study lines under it, up to the next heading
  const groups = [];
  texts.forEach((c, i) => {
    if (isHeading(c, i)) groups.push({ name: name(c), studies: [] });
    else if (groups.length && studyKey(c[0] || '')) groups.at(-1).studies.push(STUDY.exec(c[0])[0].trim());
  });
  // the arms: the heads over the columns that are not the follow-up, the measure or the plot ("Two-stage surgery", "Single-stage surgery")
  const MEASURE = /^((risk|odds|hazard|rate) ratio|(std\.? |standardi[sz]ed )?mean difference|risk difference)$/i;
  const arms = (headAt > 0 ? texts[headAt - 1] : []).filter(x => !/follow-?up|weight|95%|^\(?mo\)?$/i.test(x) && !MEASURE.test(x));
  const measure = headLines.flat().find(x => MEASURE.test(x)) || '';
  const favours = texts.find(c => c.length === 2 && c.every(x => /^favou?rs\b/i.test(x))) || [];
  return { headings, groups, pool, axis, fu: /follow-?up/i.test(head), events: /\bevents\b/i.test(head), arms: arms.length === 2 ? arms : [], measure, favours };
}
/**
 * A printed forest's rows in the order it prints them, as the screen forest takes them (lib/analysis-charts.mjs forestTable): a heading
 * (`{ heading }`), a study (`{ label, est, lo, hi, fu, a, b }`: its follow-up and each arm's events over total where the print has those
 * columns) or a total (`{ label, est, lo, hi, pooled: true }`). With the layout (printedForestLayout). Null when no line is a study's.
 */
export function printedForestPanel(lines) {
  const lay = printedForestLayout(lines), cells = l => (Array.isArray(l) ? l : l.cells || []).map(c => String(c).trim());
  const CI = /(\d+(?:\.\d+)?)\s*[[(]\s*(\d+(?:\.\d+)?)\s*[,;to–-]+\s*(\d+(?:\.\d+)?)\s*[\])]/;
  const rows = [], est = printedForest(lines), heads = new Set(lay.headings);
  let k = 0;
  for (const l of lines || []) {
    const c = cells(l), text = c.join(' ');
    if (c.length === 1 && heads.has(c[0].replace(/^\d+(\.\d+)+\s+/, ''))) { rows.push({ heading: c[0].replace(/^\d+(\.\d+)+\s+/, '') }); continue; }
    const key = studyKey(text), total = /^total\b/i.test(text);
    if ((!key && !total) || !CI.test(text.replace(/[−–]/g, '-'))) continue;
    const r = est[k++];
    if (!r) continue;
    if (r.pooled) { rows.push(r); continue; }
    // the cells between the label and the ratio: the follow-up first where it is printed, then the arms' events and totals
    const mid = c.slice(1).filter(x => !CI.test(x.replace(/[−–]/g, '-'))), out = { ...r };
    if (lay.fu && mid.length && /^(NR|\d+(\.\d+)?(\s*\/\s*\d+(\.\d+)?)?)$/.test(mid[0]) && mid.length !== 4) out.fu = mid.shift().replace(/\s*\/\s*/, ' / ');
    const n = mid.filter(x => /^\d+$/.test(x));
    if (lay.events && n.length === 4) { out.a = `${n[0]}/${n[1]}`; out.b = `${n[2]}/${n[3]}`; }
    rows.push(out);
  }
  return rows.some(r => r.label && !r.pooled) ? { rows, ...lay } : null;
}

// ---- panels: a print of several parts, each under its letter (A, B, …) ------------------------------------------------------------------------
/**
 * The panel letters of a print: a lone capital at the sheet's left edge, alone on its line, bold where the font says so, the letters running
 * A, B, C … down the page (two at least). [{ letter, y }] top to bottom, [] for a print of one panel.
 */
export function panelLetters(items) {
  const all = items || [];
  if (!all.length) return [];
  const left = Math.min(...all.map(i => i.x));
  const lone = all.filter(i => /^[A-Z]$/.test(i.t) && i.b !== false && i.x <= left + 12 && !all.some(o => o !== i && Math.abs(o.y - i.y) <= 3)).sort((a, b) => a.y - b.y);
  const run = [];
  for (const i of lone) if (i.t === String.fromCharCode(65 + run.length)) run.push({ letter: i.t, y: i.y });
  return run.length >= 2 ? run : [];
}
/**
 * The print's panels: each letter's runs, from its letter down to the next letter's (the letter itself left out), with where the panel stands
 * on the sheet as fractions of its height (`top`, `bottom`), for showing that part of the picture. Null for a print of one panel.
 */
export function splitPanels(items, { height = null } = {}) {
  const letters = panelLetters(items);
  if (!letters.length) return null;
  const H = height || Math.max(...items.map(i => i.y)) + 12;
  return letters.map((L, k) => {
    const from = L.y - 4, to = letters[k + 1] ? letters[k + 1].y - 4 : Infinity;
    return { letter: L.letter, top: Math.max(0, (L.y - 14) / H), bottom: Math.min(1, ((letters[k + 1]?.y ?? H + 14) - 14) / H),
      items: items.filter(i => i.y >= from && i.y < to && !(i.t === L.letter && Math.abs(i.y - L.y) <= 1)) };
  });
}
/**
 * One panel read with the readers a single print has: a forest (printedForestPanel: its rows, subgroups, columns, axis and labels), else a
 * table by position (printedTable: its heads, rows, Direction of effect rows and notes). `{ kind: 'forest', forest } | { kind: 'table', table } |
 * { kind: 'none' }`, with the panel's lines.
 */
export function readPanel(items) {
  const lines = linesOf(items), forest = printedForestPanel(lines);
  if (forest) return { kind: 'forest', forest, lines };
  const table = printedTable(lines);
  if (table?.rows?.some((r, i) => i > 0 && studyKey(r[0] || ''))) return { kind: 'table', table, lines };
  return { kind: 'none', lines };
}

/**
 * A sheet of effects as printed, in the app's columns: the header, a section's title, then a row per arm (the study named on its first);
 * a study's line whose values do not fill the columns keeps its whole text in the arm's column (nothing is cut). Text under or between the
 * rows that is not an arm (a legend, a range of a section's cohorts, a test) is the table's notes, whole, never a cell. `outcomes` the
 * sheet's outcome names. `{ rows, notes }`, rows null when no study was read.
 */
export function printedEffectsTable(lines, outcomes) {
  const head = ['Study', 'Arm', 'Patients', 'Follow-up (mo)', ...outcomes], rows = [head], notes = [];
  const VALUE = /[≤≥<>]?\d+\s*\/\s*\d+(?:\s*\(\s*[≤≥<>]?\d+(?:\.\d+)?%\))?|[≤≥<>]?\d+(?:\.\d+)?%?(?:\s*\([a-z][^)]*\))?|\bNR\b/g;
  const squash = t => t.replace(/\s+/g, '');
  // an arm: its name, then exactly its values, which say the whole line again (else its text is kept whole)
  const armOf = rest => {
    const first = rest.search(/[≤≥<>]?\b\d|\bNR\b/), arm = (first < 0 ? rest : rest.slice(0, first)).trim(), values = first < 0 ? '' : rest.slice(first);
    const cells = [...values.matchAll(VALUE)].map(m => m[0].replace(/\s*\/\s*/, '/'));
    return cells.length === 2 + outcomes.length && squash(arm + cells.join('')) === squash(rest) ? [arm, ...cells] : null;
  };
  // prose: a sentence of words, not a row of values (a legend, "range: …", "sign test P = 0.50")
  const prose = text => /[;:=]/.test(text) || TOKEN.test(text) && text.split(/\s+/).filter(w => /^\p{L}{3,}/u.test(w)).length >= 4;
  let inStudy = false, last = -1;
  for (const l of lines || []) {
    const text = l.cells.join(' ').trim(), key = studyKey(text);
    if (!text) continue;
    if (STOP.test(text)) { inStudy = false; continue; }
    if (key) {
      const label = STUDY.exec(text)[0].trim(), rest = text.slice(STUDY.exec(text)[0].length).trim(), arm = armOf(rest);
      rows.push(arm ? [label, ...arm] : [label, rest]); inStudy = true; last = rows.length - 1; continue;
    }
    const arm = inStudy && l.cells.length >= 2 ? armOf(text) : null;
    if (arm) { rows.push(['', ...arm]); last = rows.length - 1; continue; }
    // a row of the table the columns do not read (its cells are many, it is no sentence): kept whole in the arm's column
    if (inStudy && l.cells.length >= 3 && !/[;:=]/.test(text)) { rows.push(['', text]); last = rows.length - 1; continue; }
    if (l.cells.length === 1 && !TOKEN.test(text) && !/[;:=]/.test(text)) { rows.push([text]); inStudy = false; continue; }   // a section's title
    if (TOKEN.test(text) || prose(text)) {
      // a note continues the one before when it breaks mid-sentence ("revision 7–21% (2" / "cohorts); ASD 0–7%")
      if (last >= 0 && notes.length && /[^.)]$|\($|\(\d+$/.test(notes.at(-1)) && /^[\p{Ll}\d(]/u.test(text)) notes[notes.length - 1] += ` ${text}`;
      else if (last >= 0) notes.push(text);
      inStudy = false; continue;
    }
    // a line of several cells and no values (the column heads as printed) is not read again
  }
  const kept = rows.filter((r, i) => i === 0 || r.length > 1 || (rows[i + 1]?.length > 1));
  return { rows: kept.length > 1 ? kept : null, notes };
}
/**
 * A printed table read by position, as a print lays one out (a sheet of effects, a traffic light, any grid of a study per row): its head is
 * the line that names Study (with the lines stacked on it, "Follow-up" over "(mo)"), each head's extent a column; every word on a line below
 * goes to the column whose extent holds its middle, so a row keeps its columns whatever its words are ("≤9/26 (≤35%)", "Direction of
 * effect" with its ▲ and – marks). A line of one word group at the table's left edge is a section's title; a line wider than the table's
 * columns, or under its last row, is a note. `{ head, rows, notes }`: rows of cells in the head's columns, the head a row of its own first;
 * null when no line names Study.
 */
export function printedTable(lines) {
  const L = (lines || []).map(l => ({ ...l, xs: l.xs || l.cells.map((_, i) => i * 100), ws: l.ws || l.cells.map(c => String(c).length * 4.4) }));
  const at = L.findIndex(l => /^stud(y|ies)$/i.test(String(l.cells[0] || '').trim()) && l.cells.length >= 3);
  if (at < 0) return null;
  // the head: the Study line and the lines within a line's height of it, each head word by its middle
  const gaps = L.slice(1).map((l, i) => l.y - L[i].y).filter(d => d > 1).sort((a, b) => a - b), step = gaps[Math.floor(gaps.length / 2)] || 18;   // a row's height: the usual gap
  const headLines = L.filter(l => Math.abs(l.y - L[at].y) <= step * 0.6);
  const words = headLines.flatMap(l => l.cells.map((t, i) => ({ t, x: l.xs[i], w: l.ws[i], y: l.y }))).sort((a, b) => a.x - b.x);
  const cols = [];
  for (const w of words) {
    const mid = w.x + w.w / 2, near = cols.find(c => Math.abs(c.mid - mid) <= Math.max(14, Math.min(c.w, w.w) / 2));
    if (near) { near.parts.push(w); near.x = Math.min(near.x, w.x); near.end = Math.max(near.end, w.x + w.w); near.mid = (near.x + near.end) / 2; near.w = near.end - near.x; }
    else cols.push({ parts: [w], x: w.x, end: w.x + w.w, mid, w: w.w });
  }
  cols.sort((a, b) => a.x - b.x);
  const head = cols.map(c => c.parts.sort((a, b) => a.y - b.y).map(p => p.t).join(' '));
  // a column's reach: a left-aligned text column (the first two) from its start to the next column's; a value column around its middle
  const bounds = cols.map((c, k) => (k < 2 ? [c.x - 8, cols[k + 1] ? Math.min(cols[k + 1].x, cols[k + 1].mid - (cols[k + 2] ? (cols[k + 2].mid - cols[k + 1].mid) / 2 : 30)) : Infinity]
    : [k ? (cols[k - 1].mid + c.mid) / 2 : -Infinity, cols[k + 1] ? (c.mid + cols[k + 1].mid) / 2 : Infinity]));
  const colOf = (x, w) => { const mid = x + w / 2; let k = bounds.findIndex(([a, b], i) => (i < 2 ? x >= a && x < b : mid >= a && mid < b)); if (k < 0) k = x < cols[0].x ? 0 : cols.length - 1; return k; };
  const right = cols.at(-1).end + 12, rows = [head], notes = [];
  let last = -1;
  for (const l of L.filter(x => x.y > Math.max(...headLines.map(h => h.y)))) {
    const text = l.cells.join(' ').trim();
    if (!text) continue;
    // a note: a line of one or two word groups that runs past the columns or past the first value column, or a sentence; a row has its cells
    const few = l.cells.length <= 2, wide = few && (l.cells.some((c, i) => l.xs[i] + l.ws[i] > right) || l.ws.reduce((a, b) => a + b, 0) > (cols[2]?.x ?? 300) - cols[0].x + 40);
    if (l.cells.length === 1 && !wide && !TOKEN.test(text) && l.xs[0] < (cols[1]?.x ?? 100) - 4) { rows.push([text]); continue; }   // a section's title
    if (wide || few && /[;:=]/.test(text)) {
      if (notes.length && /[^.)]$|\($|\(\d+$/.test(notes.at(-1)) && /^[\p{Ll}\d(]/u.test(text)) notes[notes.length - 1] += ` ${text}`;
      else notes.push(text);
      continue;
    }
    if (notes.length && last >= 0 && few) { notes.push(text); continue; }   // under the notes: still a note
    const row = cols.map(() => '');
    l.cells.forEach((c, i) => { const k = colOf(l.xs[i], l.ws[i]); row[k] = row[k] ? `${row[k]} ${c}` : c; });
    rows.push(row); last = rows.length - 1;
  }
  // a title over nothing (the last line before the notes) is not kept
  const kept = rows.filter((r, i) => i === 0 || r.length > 1 || rows.slice(i + 1).some(x => x.length > 1));
  return { head, rows: kept, notes };
}
/** The rows of printedEffectsTable. */
export const printedEffectsRows = (lines, outcomes) => printedEffectsTable(lines, outcomes).rows;

// ---- the source ------------------------------------------------------------------------------------------------------------------------------
const base = p => String(p || '').split('/').pop();
/** The data a drawing is redrawn from, the first there is: its printed text, its script's data, the app's data. */
export function chooseSource({ printed = null, script = null, app = false } = {}) {
  if (printed) return { source: 'printed', file: printed, label: `Drawn from ${base(printed)}` };
  if (script) return { source: 'script', file: script, label: `Drawn from ${base(script)}` };
  if (app) return { source: 'app', file: '', label: "Drawn from the app's data" };
  return { source: 'none', file: '', label: 'No data to redraw from' };
}
/** The files that may hold a picture's printed text, nearest first: its SVG and PDF of the same name (a "_hires" copy's too). */
export function printedCandidates(path) {
  const p = String(path || ''), dir = p.includes('/') ? p.slice(0, p.lastIndexOf('/') + 1) : '', stem = base(p).replace(/\.[^.]+$/, '');
  const stems = [...new Set([stem, stem.replace(/[_-]hi-?res$/i, '')])];
  return /\.(svg|pdf)$/i.test(p) ? [p] : stems.flatMap(st => [`${dir}${st}.svg`, `${dir}${st}.pdf`]);
}

// ---- reading the folder ----------------------------------------------------------------------------------------------------------------------
const text = bytes => new TextDecoder().decode(bytes);
// a file read is kept by its size and time while they are unchanged (Tables and figures reads a print's panels for its list: once, not per draw)
const readMemo = new Map();   // `${file}|${size}|${mtime}` -> its reading
const READ_MAX = 24;
/** The printed text of a picture: its SVG's runs, or its PDF's (pdf.js, lazily), from the first candidate the folder has; null without one. */
export async function readPrinted(folder, path) {
  for (const file of printedCandidates(path)) {
    let st = null;
    try { st = folder.stat ? await folder.stat(file) : null; } catch { st = null; }
    if (st?.exists === false) continue;
    const key = st?.mtime ? `${file}|${st.size}|${st.mtime}` : '';
    if (key && readMemo.has(key)) return readMemo.get(key);
    const got = await readOne(folder, file);
    if (!got) continue;
    if (key) { if (readMemo.size >= READ_MAX) readMemo.delete(readMemo.keys().next().value); readMemo.set(key, got); }
    return got;
  }
  return null;
}
/** One file's printed text: an SVG's runs, else a PDF's; null when the folder gives nothing. */
async function readOne(folder, file) {
  let bytes = null;
  try { bytes = await folder.read(file); } catch { bytes = null; }
  if (!bytes?.length) return null;
  if (/\.svg$/i.test(file)) return { file, items: svgItems(text(bytes)) };
  const { loadPdf } = await import('./anchor.mjs'), { doc } = await loadPdf(bytes);
  try {
    const pages = [], drawn = doc.numPages === 1 ? await pdfDrawn(bytes).catch(() => null) : null;
    for (let n = 1; n <= Math.min(doc.numPages, 4); n++) {
      const page = await doc.getPage(n), c = await page.getTextContent();
      // a one-page print's fonts by name (its operators read first), so a bold panel letter is known as bold
      if (doc.numPages === 1) await page.getOperatorList().catch(() => null);
      const fonts = new Map(), fontOf = id => { if (!fonts.has(id)) { let f = ''; try { f = doc.numPages === 1 ? page.commonObjs.get(id)?.name || '' : ''; } catch { f = ''; } fonts.set(id, f); } return fonts.get(id); };
      pages.push({ height: page.view[3] - page.view[1], drawn: n === 1 ? drawn : null, items: c.items.filter(i => i.str).map(i => ({ str: i.str, x1: i.transform[4], y1: i.transform[5], w: i.width, ...(fontOf(i.fontName) ? { font: fontOf(i.fontName) } : {}) })) });
    }
    return { file, items: pdfItems(pages), height: pages.length === 1 ? pages[0].height : null };
  } finally { await doc.destroy?.(); }
}
/**
 * The data a picture's script reads (lib/figure-lineage.mjs scanScript over the scripts beside it and one folder up): the first data file a
 * script that writes this picture names and the folder has, with its rows when it is a CSV; null when no script names the picture.
 */
export async function scriptData(folder, path) {
  const p = String(path || ''), dir = p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '', up = dir.includes('/') ? dir.slice(0, dir.lastIndexOf('/')) : '';
  const stem = base(p).replace(/\.[^.]+$/, '').replace(/[_-]hi-?res$/i, '').toLowerCase();
  const { scanScript } = await import('./figure-lineage.mjs');
  for (const d of [...new Set([dir, up])]) {
    let entries = [];
    try { entries = await folder.list(d); } catch { continue; }
    const at = name => (d ? `${d}/${name}` : name), files = entries.filter(e => !e.dir).map(e => at(e.name));
    // the data folders beside the scripts, one level down (rob_csv/robins.csv)
    for (const sub of entries.filter(e => e.dir && !e.name.startsWith('.')).slice(0, 12)) { try { files.push(...(await folder.list(at(sub.name))).filter(e => !e.dir).map(e => `${at(sub.name)}/${e.name}`)); } catch { /* unreadable */ } }
    for (const script of files.filter(f => /\.(py|r|js|mjs)$/i.test(f))) {
      let src = '';
      try { src = text(await folder.read(script)); } catch { continue; }
      const scan = scanScript(src, script, { files });
      if (!scan.outputs?.some(o => base(o.path || o).toLowerCase().replace(/\.[^.]+$/, '') === stem)) continue;
      const input = (scan.inputs || []).find(i => i.resolved && files.includes(i.path));
      if (!input) continue;
      let rows = null;
      if (/\.csv$/i.test(input.path)) { try { rows = text(await folder.read(input.path)).split(/\r?\n/).filter(Boolean).map(l => l.split(',').map(c => c.replace(/^"|"$/g, ''))); } catch { rows = null; } }
      return { file: input.path, script, rows };
    }
  }
  return null;
}

/**
 * The printed file an item stands for: `source.was` (an app item's print) when it names a file, else `source.path`. A relinked item may keep
 * its earlier source as an object under `was` ({ app, was }); that is history, never a file name (2026-10-24: Figure 3 "could not be read").
 */
export const printedPath = src => (typeof src?.was === 'string' && src.was) || (typeof src?.path === 'string' && src.path) || '';
/**
 * An item's printed data, in full: where it is drawn from (chooseSource), the printed lines, the differences from the app's data where the
 * app holds the item (a synthesis's forest or sheet of effects), and the printed values in the shapes the previews draw. `it` a package item,
 * `folder` the project folder (read, stat, list). Null for a table (its printed text is its grid) or a picture with no file to read.
 */
export async function printedFacts(s, it, folder) {
  const path = printedPath(it?.source);
  if (!folder || !path || it.kind !== 'figure') return null;
  const printed = await readPrinted(folder, path).catch(() => null);
  // a print of several panels (A, B, …) is read panel by panel, whatever the item was made from
  const split = printed ? splitPanels(printed.items, { height: printed.height }) : null;
  if (split) return panelFacts(s, it, printed, split, path);
  const script = printed ? null : await scriptData(folder, path).catch(() => null);
  const k = String(it.source?.app || ''), m = /^synth:(forest|effects):([^:]+):(.+)$/.exec(k);
  let expected = null, outcomes = null, weights = null;
  if (m) {
    const [sp, sf] = await Promise.all([import('./synth-project.mjs'), import('./synth-figures.mjs')]), model = sp.synthesisModel(s);
    if (m[1] === 'forest') {
      const rec = model.records.find(x => x.code === m[3] && x.outcomeId === m[2] && x.method.startsWith('Meta'));
      const studies = rec ? sf.forestSpec(rec).groups.flatMap(g => g.studies) : [];
      if (studies.length) { expected = forestExpected(studies); weights = new Map(studies.map(st => [studyKey(st.study), { weight: st.weight, sid: st.sid }])); }
    } else {
      const data = sf.effectsData(model, m[3]);
      if (!data.error) { expected = effectsExpected(data); outcomes = data.outcomes; }
    }
  }
  const lines = printed ? linesOf(printed.items) : [];
  // the app's own drawings that print their values: a flow's counts, a traffic light's marks, an evidence map's counts (an item named as an
  // evidence map, set against the project's map); redrawn from the app's data only where the print agrees with it
  let own = null;
  if (printed && !m) {
    if (k === 'prisma') own = { compare: compareCounts(printed.items.map(i => i.t), prismaExpected(s.prisma)), draw: { prisma: true } };
    else if (/^rob-traffic:/.test(k)) {
      const set = (await import('./app-items.mjs')).robSets(s).find(x => x.tool.id === k.slice(12));
      if (set) own = { compare: compareTraffic(lines, set), draw: { rows: trafficRows(set) } };
    } else if (/^rob-summary:/.test(k)) own = { compare: null, why: 'The printed chart draws its values as bars: nothing to compare' };
    else if (!k && /evidence map/i.test(it.title || '') && s.evidenceMap) {
      const em = await import('./evidence-map.mjs'), map = em.itemMap(s, it);   // the item's own map options, else the project's (em.projectMap)
      if (map) own = { compare: compareMap(lines, map), draw: { panels: mapPanels(map) } };
    }
  }
  if (own) {
    const c = own.compare, agrees = c && !c.mismatches.length;
    return { source: agrees ? 'checked' : 'none', file: '', path, compare: c, draw: agrees ? own.draw : null, printedFile: printed.file, lines: lines.map(l => l.cells),
      label: agrees ? `Drawn from the app's data, which agrees with ${base(printed.file)}` : c ? `As it prints: the app's data differ from ${base(printed.file)}` : 'No data to redraw from', ...(own.why ? { why: own.why } : {}) };
  }
  // a sheet of effects by its printed columns (its own order); anything else line by line
  const sheet = printed && outcomes ? printedTable(lines) : null;
  const compare = printed && expected ? (sheet?.rows?.length > 1 ? compareRows(sheet.rows, expected) : comparePrinted(studyBlocks(lines), expected)) : null;
  const forest = printed && m?.[1] === 'forest' ? printedForest(lines).map(r => ({ ...r, ...(weights?.get(studyKey(r.label)) || {}) })) : null;
  // a sheet of effects as printed: by position (its own heads, in its own order), else by its words against the app's outcomes
  const table = printed && outcomes ? (printedTable(lines) || printedEffectsTable(lines, outcomes)) : null, effects = table?.rows?.length > 1 ? table.rows : null;
  // printed text the app cannot lay out again (a drawn map, a risk-of-bias chart): its script's data if there is some, else nothing to redraw
  // from; the picture is shown as it prints, never a partial reconstruction
  const redrawable = Boolean(forest?.length || effects);
  const later = printed && !redrawable ? await scriptData(folder, path).catch(() => null) : script;
  const choice = redrawable ? chooseSource({ printed: printed.file }) : chooseSource({ script: later?.rows ? later.file : null, app: Boolean(k) && !printed });
  return { ...choice, path, compare, forest: redrawable ? forest : null, effects: redrawable ? effects : null, notes: redrawable && table?.notes?.length ? table.notes : [], rows: later?.rows || null, lines: printed ? lines.map(l => l.cells) : null, printedFile: printed?.file || '' };
}

/**
 * A print of several panels: each read (readPanel) and set against the app's data the way a single print is, a forest's rows against the
 * Syntheses record that holds the same studies, a table's cells against the sheet of effects that holds them (Extraction's values), its
 * printed sign test against the sheet's. The item's own source (or the one it was made from, `source.was`) is preferred where it holds the
 * panel's studies. `{ source, label, path, panels: [{ letter, top, bottom, kind, forest | table, compare }], compare, lines, printedFile }`;
 * the differences of every panel in one list, each field naming its panel.
 */
export async function panelFacts(s, it, printed, split, path) {
  const panels = split.map(p => { const r = readPanel(p.items); return { letter: p.letter, top: p.top, bottom: p.bottom, kind: r.kind, ...(r.forest ? { forest: r.forest } : {}), ...(r.table ? { table: r.table } : {}), lines: r.lines.map(l => l.cells), _lines: r.lines }; });
  const hints = [it?.source?.app, it?.source?.was?.app].filter(h => typeof h === 'string');
  let model = null, sf = null;
  if (panels.some(p => p.kind !== 'none')) {
    try { const [sp, f] = await Promise.all([import('./synth-project.mjs'), import('./synth-figures.mjs')]); model = sp.synthesisModel(s); sf = f; } catch { model = null; }
  }
  for (const p of panels) {
    if (model && p.kind === 'forest') Object.assign(p, forestAgainst(model, sf, p, hints));
    else if (model && p.kind === 'table') Object.assign(p, tableAgainst(model, sf, p, hints));
    delete p._lines;
  }
  const read = panels.filter(p => p.kind !== 'none'), compared = read.filter(p => p.compare);
  const compare = compared.length ? { matched: compared.reduce((n, p) => n + p.compare.matched, 0), mismatches: compared.flatMap(p => p.compare.mismatches.map(m => ({ ...m, field: `${m.field}, panel ${p.letter}` }))) } : null;
  const lines = linesOf(split.flatMap(p => p.items)).map(l => l.cells);
  if (!read.length) return { ...chooseSource({}), path, compare: null, panels: null, forest: null, effects: null, notes: [], rows: null, lines, printedFile: printed.file };
  return { ...chooseSource({ printed: printed.file }), path, compare, panels, forest: null, effects: null, notes: [], rows: null, lines, printedFile: printed.file };
}
/**
 * Whether a print is the app's: a print of several panels whose every panel that reads found the result it shows (panelFacts: a forest's
 * Syntheses record, a table's SWiM sheet). `{ path, file, type, view, viewLabel, words, against: [key], panels: [{ letter, kind, against, what,
 * differs }], differs }`, `differs` the values the print and the app's data disagree on; null when nothing in it is the app's. Tables and
 * figures draws such a print from the app (lib/paper-items.mjs), and a print a script relinks keeps its item's link (lib/folder-sync.mjs).
 */
export async function printedMatch(s, it, folder) {
  const f = await printedFacts(s, it, folder).catch(() => null);
  const read = (f?.panels || []).filter(p => p.kind !== 'none');
  if (!read.length || read.some(p => !p.against)) return null;
  const panels = read.map(p => ({ letter: p.letter, kind: p.kind, against: p.against, what: p.what || '', differs: p.compare?.mismatches?.length || 0 }));
  const kinds = [...new Set(panels.map(p => (p.kind === 'forest' ? 'forest' : /^synth:effects:/.test(p.against) ? 'swim' : 'table')))];
  const words = panels.map(p => p.what).filter(Boolean);
  return { path: f.path, file: f.printedFile, type: kinds.join('+'), view: 'syntheses', viewLabel: 'Syntheses', words: words.length > 1 ? `${words.slice(0, -1).join(', ')} and ${words.at(-1)}` : words[0] || '',
    against: panels.map(p => p.against), panels, differs: panels.reduce((n, p) => n + p.differs, 0) };
}
/** Whether two keys of the app's results name one result: a SWiM sheet by its id whatever outcome it was keyed under ('synth:effects:*:two-stage'). */
export const sameResult = (a, b) => { const k = x => String(x || '').replace(/^synth:effects:[^:]*:/, 'synth:effects:*:'); return !!a && k(a) === k(b); };
const sameKeys = (a, b) => a.size === b.size && [...a].every(k => b.has(k));
/** A forest panel against the Syntheses record of the same studies (the item's own first on a tie): its compare, each study's record id. */
function forestAgainst(model, sf, p, hints) {
  const keys = new Set(p.forest.rows.filter(r => r.label && !r.pooled).map(r => studyKey(r.label)));
  const recs = model.records.filter(r => r.method.startsWith('Meta') && r.rows?.length);
  const hinted = new Set(hints.map(h => /^synth:forest:([^:]+):(.+)$/.exec(h)).filter(Boolean).map(m => recs.find(r => r.outcomeId === m[1] && r.code === m[2])).filter(Boolean));
  const blocks = studyBlocks(p._lines);
  const tried = recs.filter(r => sameKeys(new Set(r.rows.map(x => studyKey(x.study))), keys)).map(rec => {
    const studies = sf.forestSpec(rec).groups.flatMap(g => g.studies);
    return { rec, studies, compare: comparePrinted(blocks, forestExpected(studies)) };
  }).sort((a, b) => a.compare.mismatches.length - b.compare.mismatches.length || hinted.has(b.rec) - hinted.has(a.rec));
  // no record of the same studies: the item's own record, its differences shown
  const best = tried[0] || [...hinted].map(rec => { const studies = sf.forestSpec(rec).groups.flatMap(g => g.studies); return { rec, studies, compare: comparePrinted(blocks, forestExpected(studies)) }; })[0];
  if (!best) return { compare: null };
  const sid = new Map(best.studies.map(x => [studyKey(x.study), x.sid]));
  p.forest.rows = p.forest.rows.map(r => (r.label && !r.pooled && sid.get(studyKey(r.label)) ? { ...r, sid: sid.get(studyKey(r.label)) } : r));
  return { compare: best.compare, against: `synth:forest:${best.rec.outcomeId}:${best.rec.code}`, what: best.rec.outcome ? `${best.rec.outcome}${best.rec.code ? ` (${best.rec.code})` : ''}` : best.rec.code || '' };
}
/** A table panel against the sheet of effects of the same studies (the item's own first on a tie): its cells, then its printed sign test. */
function tableAgainst(model, sf, p, hints) {
  const keys = new Set(p.table.rows.slice(1).map(r => studyKey(r[0] || '')).filter(Boolean));
  const own = new Set(hints.map(h => /^synth:effects:[^:]*:(.+)$/.exec(h)?.[1]).filter(Boolean));
  const tried = (model.sheets || []).map(sh => ({ sh, data: sf.effectsData(model, sh.id) })).filter(x => !x.data.error)
    .filter(x => sameKeys(new Set(x.data.sections.flatMap(sec => sec.studies.map(st => studyKey(st.study)))), keys))
    .map(x => { const c = compareRows(p.table.rows, effectsExpected(x.data)); return { ...x, compare: { matched: c.matched, mismatches: [...c.mismatches, ...notesAgainst(p.table.notes, x.data.lines)] } }; })
    .sort((a, b) => a.compare.mismatches.length - b.compare.mismatches.length || own.has(b.sh.id) - own.has(a.sh.id));
  // a sheet named by a word ('two-stage') is the two-stage SWiM sheet; a sheet with a made-up id is named by its title
  const sh = tried[0]?.sh, what = sh ? (/^[a-z][a-z -]{1,30}$/i.test(sh.id) ? `the ${sh.id} SWiM sheet` : `the SWiM sheet ${sh.name || sh.id}`) : '';
  return sh ? { compare: tried[0].compare, against: `synth:effects:*:${sh.id}`, what } : { compare: null };
}
/**
 * A sheet's own lines (its sign test, its ranges) against the notes printed under it: a note that begins as the line does (a range by its
 * place among the ranges, whatever its section is called) and says other numbers.
 */
export function notesAgainst(notes, lines) {
  const range = t => /\brange:/i.test(t), head = t => fold(t).split(/[\s:,]+/).slice(0, 2).join(' '), out = [];
  const ranges = (notes || []).filter(range), mine = (lines || []).filter(range);
  for (const line of lines || []) {
    const printed = range(line) ? ranges[mine.indexOf(line)] : (notes || []).find(n => !range(n) && head(n) === head(line));
    if (!printed) continue;
    const after = t => (range(t) ? t.slice(t.search(/\brange:/i)) : t), a = tokensOf(after(line)).join(' '), b = tokensOf(after(printed)).join(' ');
    if (a !== b) out.push({ study: String(line).split(/[:,]/)[0].trim(), field: 'Note', app: line, printed });
  }
  return out;
}

// ---- the app's own drawings set against their print: PRISMA, a risk-of-bias traffic light, an evidence map ---------------------------------
const norm = t => fold(t).replace(/[^a-z0-9]+/g, ' ').trim();
const firstNumber = t => (/\(?n\s*=\s*([\d,]+)\)?|\b(\d[\d,]*)\b/i.exec(t) || []).slice(1).find(Boolean)?.replace(/,/g, '') ?? null;
/**
 * Counts against the printed text read in order (`texts`): each count is the first number at or after its label, a label searched from where
 * the last one was found, so a box that appears twice (one per column of a flow) is read in turn. `expected` [{ label, value }].
 */
export function compareCounts(texts, expected) {
  const t = (texts || []).map(x => String(x)), mismatches = [];
  let at = 0, matched = 0;
  for (const e of expected || []) {
    // the number after the label on its own run, else on the runs that follow it ("Records screened", then "(n = 436)"); a run that names the
    // label with no number after it (a heading: "Identification of studies via databases") is passed over
    const want = norm(e.label), numberAt = k => {
      const own = t[k].toLowerCase().indexOf(e.label.toLowerCase());
      let got = firstNumber(own >= 0 ? t[k].slice(own + e.label.length) : '');
      for (let j = k + 1; j < Math.min(t.length, k + 3) && got == null && !/[a-z]{4}/i.test(t[j].replace(/\bn\b/, '')); j++) got = firstNumber(t[j]);
      return got;
    };
    const find = from => { for (let i = from; i < t.length; i++) if (norm(t[i]).includes(want) && numberAt(i) != null) return i; return -1; };
    let k = find(at);
    if (k < 0) k = find(0);
    if (k < 0) { mismatches.push({ study: e.label, field: 'n', app: String(e.value), printed: t.some(x => norm(x).includes(want)) ? 'No number' : 'Not printed' }); continue; }
    const got = numberAt(k);
    at = k + 1;
    if (got === String(e.value)) matched++;
    else mismatches.push({ study: e.label, field: 'n', app: String(e.value), printed: got ?? 'Not printed' });
  }
  return { matched, mismatches, unit: ['count', 'counts'] };
}
const PRISMA_BOXES = [['database_results', 'Databases'], ['database_specific_results', null], ['duplicates', 'Duplicate records'], ['records_screened', 'Records screened'],
  ['records_excluded', 'Records excluded'], ['dbr_sought_reports', 'Reports sought for retrieval'], ['dbr_notretrieved_reports', 'Reports not retrieved'], ['dbr_assessed', 'Reports assessed for eligibility'],
  ['dbr_excluded', null], ['citations_results', 'Citation searching'], ['other_sought_reports', 'Reports sought for retrieval'], ['other_notretrieved_reports', 'Reports not retrieved'],
  ['other_assessed', 'Reports assessed for eligibility'], ['other_excluded', null], ['new_studies', 'Studies included in review']];
/** Reporting's PRISMA counts as the flow prints them, box by box in reading order; a list ("PubMed, 193; Scopus, 300") a box per entry. */
export function prismaExpected(prisma = {}) {
  const out = [];
  for (const [key, label] of PRISMA_BOXES) {
    const v = String(prisma?.[key] ?? '').trim();
    if (!v) continue;
    if (label) { if (/^\d+$/.test(v)) out.push({ label, value: Number(v) }); continue; }
    for (const part of v.split(';')) { const m = /^(.*?),\s*(\d+)\s*$/.exec(part.trim()); if (m) out.push({ label: m[1].trim(), value: Number(m[2]) }); }
  }
  return out;
}

// a traffic light prints a mark per study and domain (robvis: + low, − some concerns or moderate, x high or serious, ! critical, ? no information)
const MARK = { '+': 'low', '-': 'some', '−': 'some', x: 'high', X: 'high', '!': 'critical', '?': 'none' };
export const judgementClass = j => (/^low/i.test(j) ? 'low' : /some|moderate|unclear/i.test(j) ? 'some' : /high|serious/i.test(j) ? 'high' : /critical/i.test(j) ? 'critical' : /no info|not assessed|^no$/i.test(j) ? 'none' : '');
const CLASS_WORD = { low: 'Low', some: 'Some concerns or moderate', high: 'High or serious', critical: 'Critical', none: 'No information' };
/** The marks of one printed line, in order (a mark the PDF doubles, "xx", is one). */
export const marksOf = text => [...String(text || '').matchAll(/([+\-−xX!?])\1?/g)].map(m => MARK[m[1]]);
/** The marks of a printed line after its study, by position: a mark drawn twice over itself (two glyphs a point or two apart) is one. */
export function lineMarks(line) {
  const out = [];
  let last = null;
  (line?.cells || []).forEach((c, i) => {
    const x = line.xs?.[i] ?? i * 100;
    for (const m of marksOf(c)) { if (last && last.m === m && x - last.x < 6) { last.x = x; continue; } last = { m, x }; out.push(m); }
    if (!/^[+\-−xX!?]+$/.test(String(c).trim())) last = null;
  });
  return out;
}
/**
 * A traffic light against the app's judgements: each study's line (found by its label anywhere on it) read mark by mark against the domains
 * and the overall judgement. `set` lib/app-items.mjs robSets's entry: { tool, done: [{ label, values }] }.
 */
export function compareTraffic(lines, set) {
  const domains = [...(set?.tool?.domains || []).map(d => [d.id, d.short || d.id.toUpperCase()]), ...(set?.tool?.overall === false ? [] : [['overall', 'Overall']])];
  const texts = (lines || []).map(l => l.cells.join(' ')), mismatches = [];
  let matched = 0;
  for (const st of set?.done || []) {
    const key = studyKey(st.label), at = texts.findIndex(t => [...t.matchAll(/[\p{L}'’-]+\s+(?:et al\.?,?\s+)?(?:19|20)\d{2}[a-z]?/gu)].some(m => studyKey(m[0]) === key));
    if (at < 0) { mismatches.push({ study: st.label, field: 'Study', app: st.label, printed: 'Not printed' }); continue; }
    const marks = lineMarks(lines[at]);
    let ok = true;
    domains.forEach(([id, name], k) => {
      const want = judgementClass(String(st.values?.[id] ?? '')), got = marks[k];
      if (want && got !== want) { ok = false; mismatches.push({ study: st.label, field: name, app: CLASS_WORD[want], printed: got ? CLASS_WORD[got] : 'Not printed' }); }
    });
    if (ok) matched++;
  }
  return { matched, mismatches };
}
/** A traffic light as a table: a row per study, its judgement per domain in words. */
export const trafficRows = set => {
  const domains = [...(set.tool.domains || []).map(d => [d.id, d.short || d.id.toUpperCase()]), ...(set.tool.overall === false ? [] : [['overall', 'Overall']])];
  return [['Study', ...domains.map(([, n]) => n)], ...set.done.map(st => [st.label, ...domains.map(([id]) => String(st.values?.[id] ?? ''))])];
};

/**
 * An evidence map (lib/evidence-map.mjs evidenceMap) against its print, row by row without laying the print out again: each row's articles and
 * patients (its cells that are not zero, and its totals) are all on one printed line, a line used once; the map's totals on the Total line.
 */
export function compareMap(lines, map) {
  const lineTokens = (lines || []).map(l => ({ text: l.cells.join(' '), tokens: tokensOf(l.cells.join(' ')).map(t => t.replace(/,/g, '')) }));
  const used = new Set(), mismatches = [];
  let matched = 0;
  const holds = (tokens, want) => { const bag = [...tokens]; return want.every(v => { const i = bag.indexOf(String(v)); if (i < 0) return false; bag.splice(i, 1); return true; }); };
  map.rows.forEach((row, r) => {
    const cells = map.cells[r] || [], want = [...cells.filter(c => c.count).map(c => c.count), ...cells.filter(c => c.patients).map(c => c.patients)];
    if (!want.length) return;
    const k = lineTokens.findIndex((l, i) => !used.has(i) && !/^total\b/i.test(l.text) && holds(l.tokens, want));
    if (k < 0) { mismatches.push({ study: row, field: 'Row', app: want.join(' '), printed: 'Not printed as one line' }); return; }
    used.add(k); matched++;
  });
  const total = lineTokens.find(l => /^total\b/i.test(l.text.trim()) || /\btotal\b/i.test(l.text) && l.tokens.length > 4);
  const sums = [map.total, map.patients].filter(v => v != null && Number.isFinite(Number(v)));
  if (total && sums.length && !holds(total.tokens, sums)) mismatches.push({ study: 'Total', field: 'Articles and patients', app: sums.join(' '), printed: total.tokens.join(' ') });
  return { matched, mismatches, unit: ['row', 'rows'] };
}
/** An evidence map as two panels of rows: the articles and the patients per row and column, the totals last. */
export function mapPanels(map) {
  const head = [`${map.rowField.label} × ${map.colField.label}`, ...map.cols, 'Total'];
  const rows = by => map.rows.map((r, i) => [r, ...map.cells[i].map(c => String(c[by] || '')), String(map.cells[i].reduce((t, c) => t + (c[by] || 0), 0))]);
  return { articles: [head, ...rows('count')], patients: [head, ...rows('patients')] };
}
