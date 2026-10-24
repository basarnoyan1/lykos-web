// A vector PDF from one of the app's own figures (an SVG written by lib/revman-forest.mjs, lib/figure-draw.mjs and the figures built on them): lines, rectangles,
// polygons, polylines, circles and text become PDF drawing operators on one page the size of the figure, so the figure stays vector in a PDF (nothing is
// rasterised). Text is set in Helvetica, the PDF standard font that stands for Arial, with Helvetica-Bold for bold text; a character outside WinAnsi is
// written as its nearest plain form. Only the elements those figures use are read: this is not a general SVG converter. Pure: SVG text in, bytes out.
import { parseXml } from './xml.mjs';
import { arialWidth } from './revman-metrics.mjs';

const PT = 0.75;   // one px in points
const WIN = { '–': 0x96, '—': 0x97, '‘': 0x91, '’': 0x92, '“': 0x93, '”': 0x94, '•': 0x95, '…': 0x85, '€': 0x80, '™': 0x99 };
const PLAIN = { '≤': '<=', '≥': '>=', '−': '-', 'ğ': 'g', 'Ğ': 'G', 'ş': 's', 'Ş': 'S', 'ı': 'i', 'İ': 'I', '‐': '-', '‑': '-', ' ': ' ', ' ': ' ', 'τ': 'tau', 'χ': 'chi', '▲': '^', '▼': 'v' };
/** The bytes WinAnsi has for a string, escaped for a PDF string literal. */
function pdfString(s) {
  let out = '';
  for (const ch of String(s)) {
    const piece = WIN[ch] != null ? [WIN[ch]] : PLAIN[ch] != null ? [...PLAIN[ch]].map(c => c.charCodeAt(0)) : ch.codePointAt(0) < 256 ? [ch.codePointAt(0)] : [63];
    for (const b of piece) out += b === 0x28 || b === 0x29 || b === 0x5c ? `\\${String.fromCharCode(b)}` : b < 32 ? ' ' : String.fromCharCode(b);
  }
  return `(${out})`;
}
const num = v => (Math.round(v * 1000) / 1000).toString();

function colour(v) {
  const t = String(v ?? '').trim().toLowerCase();
  if (!t || t === 'none' || t === 'transparent') return null;
  let m = /^#([0-9a-f]{3})$/.exec(t); if (m) return [...m[1]].map(c => parseInt(c + c, 16) / 255);
  m = /^#([0-9a-f]{6})$/.exec(t); if (m) return [0, 2, 4].map(i => parseInt(m[1].slice(i, i + 2), 16) / 255);
  m = /^rgb\(\s*(\d+)[ ,]+(\d+)[ ,]+(\d+)/.exec(t); if (m) return [1, 2, 3].map(i => Number(m[i]) / 255);
  return { black: [0, 0, 0], white: [1, 1, 1] }[t] || [0, 0, 0];
}
const styleOf = el => Object.fromEntries(String(el.getAttribute('style') || '').split(';').map(x => x.split(':').map(y => y.trim())).filter(x => x[0] && x[1]));
const attr = (el, name, inherited) => { const st = styleOf(el); return st[name] ?? el.getAttribute(name) ?? inherited?.[name]; };

/** The PDF of a figure's SVG text, as bytes. */
export function svgToPdf(svg, { title = '' } = {}) {
  const f = figureOps(svg);
  return writePdf([{ w: f.W * PT, h: f.H * PT, ops: [`${num(PT)} 0 0 ${num(PT)} 0 0 cm`, ...f.ops] }], title || f.title || 'Figure');
}

/** The drawing operators of a figure in its own px space, origin at its lower left: { ops, W, H, title }. */
function figureOps(svg) {
  const doc = parseXml(String(svg).replace(/<!DOCTYPE[^>]*>/g, ''));
  const root = doc.documentElement;
  const vb = String(root.getAttribute('viewBox') || '').split(/[\s,]+/).map(Number);
  const W = vb.length === 4 ? vb[2] : parseFloat(root.getAttribute('width')) || 600, H = vb.length === 4 ? vb[3] : parseFloat(root.getAttribute('height')) || 400;
  const ops = [];
  const Y = y => H - y;
  const paint = (fill, stroke, width) => {
    const f = colour(fill), s = colour(stroke), out = [];
    if (f) out.push(`${f.map(num).join(' ')} rg`);
    if (s) out.push(`${s.map(num).join(' ')} RG`, `${num(width)} w`);
    return { out, op: f && s ? 'B' : f ? 'f' : s ? 'S' : 'n' };
  };
  const shape = (el, path) => {
    const fill = el.getAttribute('fill') ?? styleOf(el).fill ?? 'black', stroke = el.getAttribute('stroke') ?? styleOf(el).stroke, sw = parseFloat(el.getAttribute('stroke-width') ?? styleOf(el)['stroke-width'] ?? '1');
    const p = paint(fill, stroke, sw); if (p.op === 'n') return;
    ops.push('q', ...p.out, path, p.op, 'Q');
  };
  const walk = (el, inh) => {
    for (const c of el.children) {
      const n = c.localName;
      if (n === 'rect') {
        const x = +c.getAttribute('x') || 0, y = +c.getAttribute('y') || 0, w = parseFloat(c.getAttribute('width')), h = parseFloat(c.getAttribute('height'));
        if (c.getAttribute('width')?.endsWith('%')) { shape(c, `0 0 ${num(W)} ${num(H)} re`); continue; }
        if (w > 0 && h > 0) shape(c, `${num(x)} ${num(Y(y + h))} ${num(w)} ${num(h)} re`);
      } else if (n === 'line') {
        const p = paint('none', c.getAttribute('stroke') ?? styleOf(c).stroke ?? 'black', parseFloat(c.getAttribute('stroke-width') ?? styleOf(c)['stroke-width'] ?? '1'));
        if (p.op !== 'n') ops.push('q', ...p.out, `${num(+c.getAttribute('x1'))} ${num(Y(+c.getAttribute('y1')))} m ${num(+c.getAttribute('x2'))} ${num(Y(+c.getAttribute('y2')))} l S`, 'Q');
      } else if (n === 'polygon' || n === 'polyline') {
        const pts = String(c.getAttribute('points') || '').trim().split(/[\s,]+/).map(Number);
        const path = pts.reduce((a, v, i) => (i % 2 ? a : `${a}${num(v)} ${num(Y(pts[i + 1]))} ${i ? 'l' : 'm'} `), '');
        shape(c, n === 'polygon' ? `${path}h` : path.trimEnd());
        if (n === 'polyline' && c.getAttribute('fill') == null) { /* a polyline with no fill attribute is stroked only */ }
      } else if (n === 'circle') {
        const cx = +c.getAttribute('cx'), cy = Y(+c.getAttribute('cy')), r = +c.getAttribute('r'), k = 0.5522847498 * r;
        shape(c, `${num(cx + r)} ${num(cy)} m ${num(cx + r)} ${num(cy + k)} ${num(cx + k)} ${num(cy + r)} ${num(cx)} ${num(cy + r)} c ${num(cx - k)} ${num(cy + r)} ${num(cx - r)} ${num(cy + k)} ${num(cx - r)} ${num(cy)} c ${num(cx - r)} ${num(cy - k)} ${num(cx - k)} ${num(cy - r)} ${num(cx)} ${num(cy - r)} c ${num(cx + k)} ${num(cy - r)} ${num(cx + r)} ${num(cy - k)} ${num(cx + r)} ${num(cy)} c`);
      } else if (n === 'text') text(c, inh);
      else if (n === 'g' || n === 'svg') walk(c, inh);
    }
  };
  function text(el, inh) {
    const anchor = el.getAttribute('text-anchor') || 'start', size0 = parseFloat(attr(el, 'font-size', inh) ?? inh['font-size'] ?? '14') || 14, bold0 = /bold|[6-9]00/.test(String(attr(el, 'font-weight', inh) ?? ''));
    const fill = colour(el.getAttribute('fill') ?? styleOf(el).fill ?? inh.fill ?? 'black'); if (!fill) return;
    let x = +el.getAttribute('x') || 0, y = +el.getAttribute('y') || 0;
    // runs: the element's own text and its tspans, each with a size, a weight and a baseline shift
    const runs = [];
    let shift = 0;   // dy moves the pen and stays moved until another dy brings it back, as in SVG
    const take = (node, size, bold) => {
      for (const ch of node.childNodes) {
        if (ch.nodeType === 3) { if (ch.data) runs.push({ s: ch.data, size, bold, dy: shift }); }
        else if (ch.localName === 'tspan') { shift += parseFloat(ch.getAttribute('dy')) || 0; take(ch, parseFloat(attr(ch, 'font-size') ?? size) || size, /bold|[6-9]00/.test(String(attr(ch, 'font-weight') ?? '')) || bold); }
      }
    };
    take(el, size0, bold0);
    const width = runs.reduce((a, r) => a + arialWidth(r.s, r.size, r.bold), 0);
    x -= anchor === 'middle' ? width / 2 : anchor === 'end' ? width : 0;
    ops.push('q', `${fill.map(num).join(' ')} rg`, 'BT');
    let cx = x, base = y;
    for (const r of runs) {
      base = y + r.dy;
      ops.push(`/${r.bold ? 'F2' : 'F1'} ${num(r.size)} Tf`, `1 0 0 1 ${num(cx)} ${num(Y(base))} Tm`, `${pdfString(r.s)} Tj`);
      cx += arialWidth(r.s, r.size, r.bold);
    }
    ops.push('ET', 'Q');
  }
  const inh = { 'font-size': root.getAttribute('font-size') || '14', fill: 'black' };
  walk(root, inh);
  return { ops, W, H, title: root.getElementsByTagName('title')[0]?.textContent || '' };
}

/** A PDF of pages `[{ w, h, ops, images? }]` (points), Helvetica as F1 and Helvetica-Bold as F2; a page's images ({ dict, data }) are /Im0, /Im1, … */
function writePdf(pages, title) {
  const n = pages.length, font = 3 + 2 * n, images = pages.flatMap(pg => pg.images || []);
  const objs = ['<< /Type /Catalog /Pages 2 0 R >>', `<< /Type /Pages /Kids [${pages.map((_, i) => `${3 + 2 * i} 0 R`).join(' ')}] /Count ${n} >>`];
  let im = font + 2;
  pages.forEach((pg, i) => {
    const content = pg.ops.join('\n'), xo = (pg.images || []).map((_, j) => `/Im${j} ${im++} 0 R`).join(' ');
    objs.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${num(pg.w)} ${num(pg.h)}] /Resources << /Font << /F1 ${font} 0 R /F2 ${font + 1} 0 R >>${xo ? ` /XObject << ${xo} >>` : ''} >> /Contents ${4 + 2 * i} 0 R >>`,
      `<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
  });
  objs.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>', '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
  for (const x of images) { let s = ''; for (let i = 0; i < x.data.length; i += 8192) s += String.fromCharCode(...x.data.subarray(i, i + 8192)); objs.push(`<< ${x.dict} /Length ${x.data.length} >>\nstream\n${s}\nendstream`); }
  objs.push(`<< /Title ${pdfString(title)} /Producer (Lykos) >>`);
  let out = '%PDF-1.4\n%\xE2\xE3\xCF\xD3\n';
  const offsets = [];
  objs.forEach((o, i) => { offsets.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map(o => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objs.length + 1} /Root 1 0 R /Info ${objs.length} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  const bytes = new Uint8Array(out.length);
  for (let i = 0; i < out.length; i++) bytes[i] = out.charCodeAt(i) & 255;
  return bytes;
}

/**
 * An image a PDF can hold as it is: a JPEG (DCT) or a PNG of 8-bit grey or RGB without transparency or interlace, whose compressed rows the PDF
 * reads with the PNG predictor. { dict, data } or null (any other PNG).
 */
export function pdfImage(bytes, mime) {
  if (mime === 'image/jpeg') {
    for (let i = 2; i < bytes.length - 9;) {
      const m = bytes[i + 1], len = (bytes[i + 2] << 8) | bytes[i + 3];
      if (m >= 0xc0 && m <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(m)) { const h = (bytes[i + 5] << 8) | bytes[i + 6], w = (bytes[i + 7] << 8) | bytes[i + 8], c = bytes[i + 9];
        return { dict: `/Type /XObject /Subtype /Image /Width ${w} /Height ${h} /ColorSpace /${c === 1 ? 'DeviceGray' : c === 4 ? 'DeviceCMYK' : 'DeviceRGB'} /BitsPerComponent 8 /Filter /DCTDecode`, data: bytes, w, h }; }
      i += 2 + len;
    }
    return null;
  }
  if (mime !== 'image/png') return null;
  const u32 = i => ((bytes[i] << 24) | (bytes[i + 1] << 16) | (bytes[i + 2] << 8) | bytes[i + 3]) >>> 0, type = i => String.fromCharCode(...bytes.subarray(i + 4, i + 8));
  const w = u32(16), h = u32(20), depth = bytes[24], colour = bytes[25], interlace = bytes[28];
  if (depth !== 8 || ![0, 2].includes(colour) || interlace) return null;
  const parts = [];
  for (let i = 8; i < bytes.length;) { const len = u32(i), t = type(i); if (t === 'tRNS') return null; if (t === 'IDAT') parts.push(bytes.subarray(i + 8, i + 8 + len)); if (t === 'IEND') break; i += 12 + len; }
  const data = new Uint8Array(parts.reduce((s, p) => s + p.length, 0)); let o = 0; for (const p of parts) { data.set(p, o); o += p.length; }
  const colors = colour === 2 ? 3 : 1;
  return { dict: `/Type /XObject /Subtype /Image /Width ${w} /Height ${h} /ColorSpace /${colors === 3 ? 'DeviceRGB' : 'DeviceGray'} /BitsPerComponent 8 /Filter /FlateDecode /DecodeParms << /Predictor 15 /Colors ${colors} /BitsPerComponent 8 /Columns ${w} >>`, data, w, h };
}

// ---- a document of figures, tables and text ----------------------------------------------------------------------------------------------------
const wrap = (s, size, bold, width) => {
  const lines = [];
  for (const para of String(s ?? '').split('\n')) {
    let line = '';
    // a word breaks after its hyphens too, so "Adjacent-segment" fits a narrow column
    for (const w of para.split(/\s+/).filter(Boolean).flatMap(x => x.split(/(?<=-)(?=.)/))) {
      const next = line ? (line.endsWith('-') ? `${line}${w}` : `${line} ${w}`) : w;
      if (line && arialWidth(next, size, bold) > width) { lines.push(line); line = w; } else line = next;
    }
    lines.push(line);
  }
  return lines;
};

/**
 * A PDF of a package part (lib/package-write.mjs): `items` are `{ caption, legend, svg }` (a figure, vector, scaled to the text width, on a page of its
 * own; `image` ({ bytes, mime, ptW, ptH }) in place of `svg` for a picture file, held as it is where pdfImage can), `{ caption, grid, notes }` (a table: header row, rules above and below, cells wrapped; it runs on to further pages) or `{ blocks }` (a generated
 * document's headings and paragraphs). `page` is [width, height] in points. One font, Helvetica (the PDF's Arial); nothing is rasterised.
 */
export function documentPdf(items, { page = [595, 842], title = 'Package', margin = 72 } = {}) {
  const [PW, PH] = page, TW = PW - 2 * margin, pages = [];
  let ops = null, y = 0;
  const newPage = () => { ops = []; pages.push({ w: PW, h: PH, ops }); y = PH - margin; };
  const room = h => { if (!ops || y - h < margin) newPage(); };
  const line = (s, x, size, bold) => ops.push('BT', `/${bold ? 'F2' : 'F1'} ${num(size)} Tf`, `1 0 0 1 ${num(x)} ${num(y)} Tm`, `${pdfString(s)} Tj`, 'ET');
  const para = (s, size, bold, after = size * 0.6) => { for (const l of wrap(s, size, bold, TW)) { room(size * 1.35); y -= size * 1.35; line(l, margin, size, bold); } y -= after; };
  const rule = w => ops.push(`${num(w)} w`, `${num(margin)} ${num(y)} m ${num(margin + TW)} ${num(y)} l S`);
  for (const it of items) {
    if (it.svg) {
      newPage();
      const f = figureOps(it.svg), capH = wrap(it.caption, 11, true, TW).length * 11 * 1.35 + 8, legH = wrap(it.legend, 10, false, TW).length * 10 * 1.35 + 8;
      const scale = Math.min(TW / (f.W * PT), Math.max(0.2, (PH - 2 * margin - capH - legH) / (f.H * PT)), 1.5) * PT;
      para(it.caption, 11, true, 8);
      const h = f.H * scale;
      y -= h;
      ops.push('q', `${num(scale)} 0 0 ${num(scale)} ${num(margin + (TW - f.W * scale) / 2)} ${num(y)} cm`, ...f.ops, 'Q');
      y -= 8;
      if (it.legend) para(it.legend, 10, false);
    } else if (it.image) {
      newPage();
      para(it.caption, 11, true, 8);
      const img = pdfImage(it.image.bytes, it.image.mime);
      if (img) {
        const natW = it.image.ptW || img.w * 0.75, natH = it.image.ptH || img.h * 0.75, legH = wrap(it.legend, 10, false, TW).length * 10 * 1.35 + 8;
        const s = Math.min(TW / natW, Math.max(0.2, (y - margin - legH) / natH), 1), w = natW * s, h = natH * s;
        y -= h;
        const page = pages.at(-1); page.images ||= []; page.images.push(img);
        ops.push('q', `${num(w)} 0 0 ${num(h)} ${num(margin + (TW - w) / 2)} ${num(y)} cm`, `/Im${page.images.length - 1} Do`, 'Q');
        y -= 8;
      } else para('The picture is in the Word document.', 10, false);
      if (it.legend) para(it.legend, 10, false);
    } else if (it.grid) {
      newPage();
      para(it.caption, 11, true, 6);
      const rows = it.grid.rows.map(r => r.cells.map(c => String(c?.text ?? c ?? ''))), cols = Math.max(...rows.map(r => r.length)), size = cols > 6 ? 8 : 9, pad = 4;
      // each column at least its longest word; the rest of the width goes where the text is longest
      const words = s => String(s).split(/\s+/).flatMap(x => x.split(/(?<=-)(?=.)/));
      const least = Array.from({ length: cols }, (_, j) => Math.max(24, ...rows.map((r, i) => Math.max(0, ...words(r[j] || '').map(w => arialWidth(w, size, i === 0))) + 2 * pad)));
      const full = Array.from({ length: cols }, (_, j) => Math.max(least[j], ...rows.map(r => arialWidth(r[j] || '', size, false) + 2 * pad)));
      const spare = Math.max(0, TW - least.reduce((s, x) => s + x, 0)), need = full.map((f, j) => f - least[j]), needAll = need.reduce((s, x) => s + x, 0) || 1;
      const widths = least.map((l, j) => l + Math.min(need[j], (spare * need[j]) / needAll) + (needAll <= spare ? (spare - needAll) / cols : 0));
      function drawRow(cells, bold) {
        const wrapped = cells.map((c, j) => wrap(c, size, bold, widths[j] - 2 * pad)), h = Math.max(...wrapped.map(w => w.length)) * size * 1.3 + pad;
        if (y - h < margin) { newPage(); rule(0.75); if (!bold) { drawRow(rows[0] || [], true); rule(0.5); } }
        let x = margin;
        wrapped.forEach((ls, j) => { ls.forEach((l, k) => { const yy = y - pad / 2 - (k + 1) * size * 1.3 + size * 0.3; ops.push('BT', `/${bold ? 'F2' : 'F1'} ${num(size)} Tf`, `1 0 0 1 ${num(x + pad)} ${num(yy)} Tm`, `${pdfString(l)} Tj`, 'ET'); }); x += widths[j]; });
        y -= h;
      }
      rule(0.75);
      drawRow(rows[0] || [], true);
      rule(0.5);
      for (const r of rows.slice(1)) drawRow(r, false);
      rule(0.75);
      y -= 8;
      for (const n of it.notes || []) para(n, 9, false, 2);
    } else if (it.blocks) {
      newPage();
      for (const b of it.blocks) {
        const text = b.text ?? (b.runs || []).map(r => r.t).join('');
        if (!text) continue;
        if (/^h/.test(b.type)) para(text, b.type === 'h1' ? 13 : 11, true, 4); else para(text, 10, false);
      }
    }
  }
  if (!pages.length) newPage();
  return writePdf(pages, title);
}
