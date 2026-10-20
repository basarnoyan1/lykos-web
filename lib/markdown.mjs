// Markdown in and out of the manuscript (document formats amendment of
// 2026-09-29). Reading keeps the structure a Word document would: headings,
// paragraphs with bold, italic, strikethrough, code, super- and subscript,
// block quotes, bulleted, numbered and task lists with nesting, fenced code,
// pipe tables with a header row, and the app's own citation ([@key]) and result
// ({{key}}) tokens untouched. Writing is the inverse, so a manuscript that came
// from Word leaves as Markdown with its lists and tables intact.
//
// Blocks are the manuscript's (lib/manuscript.mjs): { id, type, text, runs?,
// props?, grid? }, and lists the numbering definitions the page renderer and
// the Word writer read (lib/pages.mjs, lib/docx-write-doc.mjs).

let seq = 0;
const newId = () => `b${Date.now().toString(36)}${(seq++).toString(36)}${Math.random().toString(36).slice(2, 5)}`;
const CODE_FONT = 'Courier New';

/** The list definitions Markdown lists use: one bulleted, one numbered, nine levels each. */
export const MD_LISTS = {
  'md-bullet': { levels: Array.from({ length: 9 }, (_, i) => ({ fmt: 'bullet', text: ['•', '◦', '▪'][i % 3], start: 1, indLeft: 36 * (i + 1), indHanging: 18 })) },
  'md-number': { levels: Array.from({ length: 9 }, (_, i) => ({ fmt: ['decimal', 'lowerLetter', 'lowerRoman'][i % 3], text: `%${i + 1}.`, start: 1, indLeft: 36 * (i + 1), indHanging: 18 })) },
};

// ---- inline ------------------------------------------------------------------
// Tokens the manuscript owns are lifted out first so their brackets and braces
// never read as links or emphasis; code spans next, for the same reason.
const TOKEN = /\[@[^\]]+\]|\{\{[^}]+\}\}/g;
const MARKS = [
  [/\*\*(?=\S)([\s\S]*?\S)\*\*/, { b: true }], [/__(?=\S)([\s\S]*?\S)__/, { b: true }],
  [/~~(?=\S)([\s\S]*?\S)~~/, { strike: true }],
  [/(?<![\w*])\*(?![\s*])([^*]*?[^\s*])\*(?![\w*])/, { i: true }], [/(?<![\w_])_(?![\s_])([^_]*?[^\s_])_(?![\w_])/, { i: true }],
  [/\^(?=\S)([^^\s]*?\S)\^/, { sup: true }], [/~(?=\S)([^~\s]*?\S)~/, { sub: true }],
];

/** Runs `[{ t, b?, i?, strike?, sup?, sub?, font? }]` for a line of Markdown; plain text stays one run. */
export function inlineRuns(text, base = {}) {
  const out = [];
  const push = (t, fmt) => { if (!t) return; const last = out.at(-1); const f = { ...base, ...fmt }; if (last && same(last, f)) last.t += t; else out.push({ t, ...f }); };
  const parts = String(text).split(/(`[^`\n]+`|\[@[^\]]+\]|\{\{[^}]+\}\})/g);
  for (const part of parts) {
    if (!part) continue;
    if (part.startsWith('`') && part.endsWith('`') && part.length > 2) { push(part.slice(1, -1), { font: CODE_FONT }); continue; }
    if (TOKEN.test(part) && part.match(TOKEN)?.[0] === part) { push(part, {}); continue; }
    // an escaped character is hidden from the marker search and restored in the run
    emphasis(part.replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/\[([^\]]+)\]\((?:[^()\s]|\([^()]*\))+\)/g, '$1').replace(/\\([\\`*_{}[\]()#+\-.!~^])/g, (_, c) => String.fromCharCode(0xE000 + c.charCodeAt(0))), {}, (t, fmt) => push(t.replace(/[\uE000-\uE0FF]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xE000)), fmt));
  }
  return out.length ? out : [{ t: '', ...base }];
}
const same = (a, f) => ['b', 'i', 'strike', 'sup', 'sub', 'font', 'u'].every(k => (a[k] ?? undefined) === (f[k] ?? undefined));
function emphasis(text, fmt, push) {
  let best = null;
  for (const [re, add] of MARKS) { const m = re.exec(text); if (m && (!best || m.index < best.m.index)) best = { m, add }; }
  if (!best) { push(text, fmt); return; }
  const { m, add } = best;
  push(text.slice(0, m.index), fmt);
  emphasis(m[1], { ...fmt, ...add }, push);
  emphasis(text.slice(m.index + m[0].length), fmt, push);
}
const plain = runs => runs.map(r => r.t).join('');

// ---- blocks ------------------------------------------------------------------
const block = (type, runs, extra = {}) => {
  const formatted = runs.some(r => r.b || r.i || r.strike || r.sup || r.sub || r.font || r.u);
  return { id: newId(), type, text: plain(runs), ...(formatted ? { runs } : {}), ...extra };
};
const isTableRow = l => /^\s*\|.*\|\s*$/.test(l);
const isDelimiter = l => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(l);
const cellsOf = l => { const inner = l.trim().replace(/^\|/, '').replace(/\|$/, ''); const out = []; let cur = ''; for (let i = 0; i < inner.length; i++) { const c = inner[i]; if (c === '\\' && inner[i + 1] === '|') { cur += '|'; i++; } else if (c === '|') { out.push(cur.trim()); cur = ''; } else cur += c; } out.push(cur.trim()); return out; };
const LIST = /^(\s*)([-*+]|\d{1,3}[.)])\s+(\[[ xX]\]\s+)?(.*)$/;

/**
 * Markdown as manuscript blocks and the list definitions they use.
 * `{ blocks, lists }`.
 */
export function parseMarkdown(text) {
  const lines = String(text ?? '').replace(/\r\n?/g, '\n').split('\n');
  const blocks = [];
  let usedLists = false;
  let i = 0;
  const para = [];
  const flushPara = () => { if (!para.length) return; blocks.push(block('p', inlineRuns(para.join(' ').replace(/\s{2,}$/, '')))); para.length = 0; };
  while (i < lines.length) {
    const line = lines[i];
    // fenced code
    let m = /^\s*(`{3,}|~{3,})\s*\w*\s*$/.exec(line);
    if (m) {
      flushPara();
      const fence = m[1][0]; const body = [];
      i++;
      while (i < lines.length && !new RegExp(`^\\s*${fence}{3,}\\s*$`).test(lines[i])) body.push(lines[i++]);
      i++;
      blocks.push(block('p', [{ t: body.join('\n'), font: CODE_FONT }]));
      continue;
    }
    // headings
    m = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);
    if (m) { flushPara(); blocks.push(block(['h1', 'h2', 'h3'][Math.min(2, m[1].length - 1)], inlineRuns(m[2]))); i++; continue; }
    if (para.length && /^\s*(=+|-+)\s*$/.test(line) && !isTableRow(para.at(-1))) {
      const t = para.join(' '); para.length = 0;
      blocks.push(block(line.trim()[0] === '=' ? 'h1' : 'h2', inlineRuns(t))); i++; continue;
    }
    // rules and blank lines
    if (/^\s*([-*_]\s*){3,}$/.test(line) || !line.trim()) { flushPara(); i++; continue; }
    // block quote
    if (/^\s*>/.test(line)) {
      flushPara(); const q = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) q.push(lines[i++].replace(/^\s*>\s?/, ''));
      blocks.push(block('quote', inlineRuns(q.join(' ')))); continue;
    }
    // tables
    if (isTableRow(line) && i + 1 < lines.length && isDelimiter(lines[i + 1])) {
      flushPara();
      const header = cellsOf(line); i += 2;
      const rows = [];
      while (i < lines.length && isTableRow(lines[i])) rows.push(cellsOf(lines[i++]));
      const cols = Math.max(header.length, ...rows.map(r => r.length));
      const cell = t => { const runs = inlineRuns(t || ''); return { runs, text: plain(runs) }; };
      const grid = { cols: Array(cols).fill(Math.round(468 / cols)), borders: 'all',
        rows: [{ header: true, cells: Array.from({ length: cols }, (_, c) => cell(header[c])) }, ...rows.map(r => ({ cells: Array.from({ length: cols }, (_, c) => cell(r[c])) }))] };
      blocks.push({ id: newId(), type: 'table', styleId: 'Table', grid, text: grid.rows.map(r => r.cells.map(c => c.text).join('\t')).join('\n') });
      continue;
    }
    // lists, nested by indentation; an item's continuation lines are indented under it
    m = LIST.exec(line);
    if (m) {
      flushPara(); usedLists = true;
      while (i < lines.length && (m = LIST.exec(lines[i]))) {
        const level = Math.min(8, Math.floor(m[1].replace(/\t/g, '  ').length / 2));
        const numbered = /\d/.test(m[2]);
        const parts = [m[4]]; i++;
        while (i < lines.length && lines[i].trim() && !LIST.test(lines[i]) && /^\s{2,}/.test(lines[i])) parts.push(lines[i++].trim());
        const task = m[3] ? (/x/i.test(m[3]) ? '☑ ' : '☐ ') : '';
        blocks.push(block('p', inlineRuns(task + parts.join(' ')), { props: { list: { id: numbered ? 'md-number' : 'md-bullet', level } } }));
      }
      continue;
    }
    para.push(line.trim()); i++;
  }
  flushPara();
  return { blocks, lists: usedLists ? structuredClone(MD_LISTS) : {} };
}

// ---- out ---------------------------------------------------------------------
const wrap = (t, r) => {
  if (!t) return '';
  let s = t;
  if (r.font === CODE_FONT) return `\`${s}\``;
  if (r.sup) s = `^${s}^`; if (r.sub) s = `~${s}~`;
  if (r.strike) s = `~~${s}~~`; if (r.i) s = `*${s}*`; if (r.b) s = `**${s}**`;
  return s;
};
/** A block's inline Markdown from its runs (formatting) or its text; `token(run)` renders a citation or result run when given. */
export function inlineMarkdown(b, token = null) {
  const runs = b.runs?.length ? b.runs : [{ t: b.text || '' }];
  return runs.map(r => {
    if (r.del) return '';
    const text = token ? token(r) : (r.cite ? r.cite.map(k => `[@${k}]`).join('') : r.t ?? '');
    // whitespace at a run's edge stays outside the marker, as Markdown requires
    const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(text);
    return m[1] + wrap(m[2], r) + m[3];
  }).join('');
}
const escCell = t => String(t ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
const marker = (lists, id, level, count) => {
  const l = lists?.[id]?.levels?.[level] || (id === 'md-number' ? { fmt: 'decimal' } : { fmt: 'bullet' });
  if (l.fmt === 'bullet') return '-';
  return `${count}.`;
};

/**
 * The document as Markdown. `text(b)` gives a block's inline Markdown (by
 * default from its runs, tokens intact); lists and tables are written from
 * the blocks' own structure.
 */
export function toMarkdown(blocks, { lists = {}, text = b => inlineMarkdown(b) } = {}) {
  const out = [];
  const counts = new Map();
  let prevList = null;
  for (const b of blocks) {
    const li = b.props?.list;
    if (!li) { counts.clear(); prevList = null; }
    if (b.type === 'table' && (b.grid || Array.isArray(b.rows))) {
      const rows = b.grid ? b.grid.rows.filter(r => !r.del).map(r => r.cells.filter(c => !c.merged).map(c => escCell(c.cellDel ? '' : text(c))))
        : b.rows.map(row => row.map(cell => escCell(text({ text: String(cell ?? '') }))));
      if (!rows.length) continue;
      const cols = Math.max(...rows.map(r => r.length));
      const line = r => `| ${Array.from({ length: cols }, (_, c) => r[c] ?? '').join(' | ')} |`;
      out.push([line(rows[0] || []), `| ${Array(cols).fill('---').join(' | ')} |`, ...rows.slice(1).map(line)].join('\n'));
      continue;
    }
    if (b.type === 'toc' || b.type === 'figure' && !b.text) continue;
    if (b.type === 'bib') { out.push((b.lines || []).join('\n')); continue; }
    const body = text(b);
    if (li) {
      const key = `${li.id}:${li.level}`;
      for (const k of [...counts.keys()]) if (k.startsWith(`${li.id}:`) && Number(k.split(':')[1]) > li.level) counts.delete(k);
      counts.set(key, (counts.get(key) || 0) + 1);
      const line = `${'  '.repeat(li.level || 0)}${marker(lists, li.id, li.level || 0, counts.get(key))} ${body}`;
      // items of one list stay on consecutive lines
      if (prevList) out[out.length - 1] += `\n${line}`; else out.push(line);
      prevList = li.id;
      continue;
    }
    const prefix = { h1: '# ', h2: '## ', h3: '### ', quote: '> ' }[b.type] ?? '';
    out.push(b.type === 'quote' ? body.split('\n').map(l => `> ${l}`).join('\n') : prefix + body);
  }
  return out.join('\n\n').trim() + '\n';
}
