// A Markdown file drawn as a document: headings, paragraphs, lists (with
// task boxes), block quotes, fenced code, tables and rules. The text is
// escaped first and markup added afterwards, never the reverse. Links keep
// their text and open only http(s) addresses.
import { esc } from './html.mjs';

// Links are lifted out before emphasis is read, so an address keeps its
// underscores and asterisks and no link nests in another. A URL may hold one
// level of balanced parentheses (DOIs such as 10.1016/S0140-6736(20)…).
const URL_PART = '(?:[^\\s()<>\uE000\uE001"]|\\([^\\s()<>"]*\\))+';
const LINK = new RegExp(`\\[([^\\]]{1,500})\\]\\((${URL_PART})(?:\\s+&quot;[^&]{0,200}&quot;)?\\)`, 'g');
const BARE = new RegExp(`(^|[\\s(])(https?:\\/\\/${URL_PART})`, 'g');
function inline(s) {
  return String(s).split(/(`[^`]+`)/g).map(part => {
    if (part.startsWith('`') && part.endsWith('`') && part.length > 1) return `<code>${esc(part.slice(1, -1))}</code>`;
    const held = [];
    const hold = html => `\uE000${held.push(html) - 1}\uE001`;
    const a = (href, text) => /^https?:\/\//i.test(href) ? hold(`<a href="${href}" target="_blank" rel="noopener noreferrer">${text}</a>`) : text;
    return esc(part)
      .replace(/!\[([^\]]{0,500})\]\([^)]{0,2000}\)/g, '$1')
      .replace(LINK, (m, t, href) => a(href, t.replace(/\uE000\d+\uE001/g, '')))
      .replace(BARE, (m, pre, href) => pre + a(href, href))
      .replace(/\*\*([^*]+)\*\*|__([^_]+)__/g, (m, a, b) => `<b>${a ?? b}</b>`)
      .replace(/(?<![\w*])\*(?![\s*])([^*]*?[^\s*])\*(?![\w*])/g, '<i>$1</i>')
      .replace(/(?<![\w_])_(?![\s_])([^_]*?[^\s_])_(?![\w_])/g, '<i>$1</i>')
      .replace(/~~([^~]+)~~/g, '<s>$1</s>')
      .replace(/\uE000(\d+)\uE001/g, (m, k) => held[+k]);
  }).join('');
}

const cells = line => line.trim().replace(/^\||\|$/g, '').split(/(?<!\\)\|/).map(c => c.trim().replace(/\\\|/g, '|'));
const isRule = line => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(line);
const alignOf = c => /^:-+:$/.test(c) ? 'center' : /-:$/.test(c) ? 'right' : '';

/** Markdown text to HTML for reading. */
export function markdownDocument(text, depth = 0) {
  const lines = String(text ?? '').replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  let i = 0;
  const isBlockStart = l => /^\s*(#{1,6}\s|```|~~~|>|[-*+]\s|\d+[.)]\s|(-{3,}|\*{3,}|_{3,})\s*$)/.test(l);
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }
    const fence = line.match(/^\s*(```|~~~)\s*([\w+-]*)/);
    if (fence) {
      const body = []; i++;
      while (i < lines.length && !lines[i].trim().startsWith(fence[1])) body.push(lines[i++]);
      i++;
      out.push(`<pre class="md-code"><code>${esc(body.join('\n'))}</code></pre>`);
      continue;
    }
    const h = line.match(/^\s*(#{1,6})\s+(.*?)\s*#*\s*$/);
    if (h) { const n = h[1].length; out.push(`<h${Math.min(n, 4)} class="md-h${Math.min(n, 4)}">${inline(h[2])}</h${Math.min(n, 4)}>`); i++; continue; }
    if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) { out.push('<hr>'); i++; continue; }
    // Quotes nest to a readable depth; deeper markers are text (no unbounded recursion).
    if (/^\s*>/.test(line) && depth < 8) {
      const body = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) body.push(lines[i++].replace(/^\s*>\s?/, ''));
      out.push(`<blockquote>${markdownDocument(body.join('\n'), depth + 1)}</blockquote>`);
      continue;
    }
    if (line.includes('|') && i + 1 < lines.length && isRule(lines[i + 1])) {
      const head = cells(line), aligns = cells(lines[i + 1]).map(alignOf); i += 2;
      const rows = [];
      while (i < lines.length && lines[i].includes('|') && lines[i].trim()) rows.push(cells(lines[i++]));
      const td = (tag, c, k) => `<${tag}${aligns[k] ? ` class="md-${aligns[k]}"` : ''}>${inline(c)}</${tag}>`;
      out.push(`<div class="md-table"><table><thead><tr>${head.map((c, k) => td('th', c, k)).join('')}</tr></thead><tbody>${
        rows.map(r => `<tr>${head.map((_, k) => td('td', r[k] ?? '', k)).join('')}</tr>`).join('')}</tbody></table></div>`);
      continue;
    }
    if (/^\s*([-*+]|\d+[.)])\s+/.test(line)) { const [html, next] = list(lines, i); out.push(html); i = next; continue; }
    const para = [];
    while (i < lines.length && lines[i].trim() && !isBlockStart(lines[i]) && !(lines[i].includes('|') && isRule(lines[i + 1] || ''))) para.push(lines[i++].trim());
    if (!para.length) { para.push(lines[i++].trim()); }
    out.push(`<p>${para.map(inline).join('<br>')}</p>`);
  }
  return out.join('');
}

/** A list starting at line i, nested by indentation; returns [html, next line]. */
function list(lines, i) {
  const indentOf = l => l.match(/^\s*/)[0].replace(/\t/g, '    ').length;
  const base = indentOf(lines[i]);
  const ordered = /^\s*\d+[.)]/.test(lines[i]);
  const start = ordered ? Number(lines[i].match(/\d+/)[0]) : 1;
  const items = [];
  while (i < lines.length) {
    const l = lines[i];
    if (!l.trim()) { if (i + 1 < lines.length && indentOf(lines[i + 1]) > base && lines[i + 1].trim()) { i++; continue; } break; }
    const ind = indentOf(l), m = l.match(/^\s*(?:[-*+]|\d+[.)])\s+(.*)$/);
    if (m && ind === base) { items.push({ text: [m[1]], sub: [] }); i++; continue; }
    if (m && ind > base && items.length) { const [html, next] = list(lines, i); items.at(-1).sub.push(html); i = next; continue; }
    if (ind > base && items.length) { items.at(-1).text.push(l.trim()); i++; continue; }
    break;
  }
  const tag = ordered ? 'ol' : 'ul';
  const li = it => {
    const t = it.text.join(' '), task = t.match(/^\[([ xX])\]\s+(.*)$/);
    return task
      ? `<li class="md-task"><input type="checkbox" disabled${task[1] !== ' ' ? ' checked' : ''} aria-label="${task[1] !== ' ' ? 'Done' : 'Not done'}"> ${inline(task[2])}${it.sub.join('')}</li>`
      : `<li>${inline(t)}${it.sub.join('')}</li>`;
  };
  return [`<${tag}${ordered && start !== 1 ? ` start="${start}"` : ''}>${items.map(li).join('')}</${tag}>`, i];
}
