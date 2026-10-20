// Research deliverables are typed content, never executable model HTML.
// They live with the conversation and can be edited in the manuscript or exported.
import { rasterSvg, svgRoot, text as drawText, wrapText, r1 } from './figure-draw.mjs';
import { figureTokens } from './figure-style.mjs';
import { esc } from './html.mjs';
import { writeDocx } from './docx-write.mjs';
import { newTable } from './manuscript-doc.mjs';
import { writeXlsx } from './xlsx-write.mjs';
import { saveFile } from './save.mjs';
import { showMenu } from './menu.mjs';

export const ARTIFACT_TYPES = ['document', 'table', 'infographic'];
export const SECTION_TYPES = ['text', 'table', 'metrics', 'bars', 'steps', 'timeline'];
const text = (x, n = 2000) => String(x ?? '').slice(0, n);
export function validateArtifact(input) {
  if (!input || !ARTIFACT_TYPES.includes(input.kind)) throw new Error('kind must be document, table or infographic');
  if (!String(input.title || '').trim()) throw new Error('A title is required');
  if (!Array.isArray(input.sections) || !input.sections.length || input.sections.length > 20) throw new Error('Supply 1–20 sections');
  const sections = input.sections.map((s, i) => {
    if (!s || !SECTION_TYPES.includes(s.type)) throw new Error(`Section ${i + 1}: use ${SECTION_TYPES.join(', ')}`);
    const out = { type: s.type, heading: text(s.heading, 160), text: text(s.text, 12000) };
    if (s.type === 'table') {
      if (!Array.isArray(s.columns) || !s.columns.length || s.columns.length > 10) throw new Error('A table needs 1–10 columns');
      if (!Array.isArray(s.rows) || s.rows.length > 100) throw new Error('A table accepts at most 100 rows; split large tables into sections');
      out.columns = s.columns.map(c => text(c, 120));
      out.rows = s.rows.map(r => { if (!Array.isArray(r) || r.length !== out.columns.length) throw new Error('Every table row must match the column count'); return r.map(c => text(c, 1000)); });
    }
    if (['metrics', 'bars', 'steps', 'timeline'].includes(s.type)) {
      if (!Array.isArray(s.items) || !s.items.length || s.items.length > 30) throw new Error('Supply 1–30 items');
      out.items = s.items.map(item => {
        if (!String(item?.label || '').trim()) throw new Error('Every item needs a label');
        if (s.type === 'bars' && (!Number.isFinite(item.value) || item.value < 0)) throw new Error('Bars need nonnegative numeric values');
        return { label: text(item.label, 200), value: s.type === 'bars' ? item.value : text(item.value, 160), detail: text(item.detail, 1000), unit: text(item.unit, 60) };
      });
    }
    return out;
  });
  const out = { kind: input.kind, title: text(input.title, 160), subtitle: text(input.subtitle, 500), sections,
    sources: (Array.isArray(input.sources) ? input.sources : []).slice(0, 50).map(s => text(s, 600)), status: 'draft' };
  if (JSON.stringify(out).length > 120000) throw new Error('Artifact exceeds 120,000 characters; split it into separate deliverables');
  return out;
}
export function artifactBlocks(a) {
  const blocks = [{ type: 'h1', text: a.title }];
  if (a.subtitle) blocks.push({ type: 'p', text: a.subtitle });
  for (const s of a.sections) {
    if (s.heading) blocks.push({ type: 'h2', text: s.heading });
    if (s.text) blocks.push({ type: 'p', text: s.text });
    if (s.type === 'table') blocks.push({ type: 'table', header: true, rows: [s.columns, ...s.rows] });
    for (const i of s.items || []) blocks.push({ type: 'p', text: [i.label, [i.value, i.unit].filter(v => v !== '').join(' '), i.detail].filter(Boolean).join(' · ') });
  }
  if (a.sources?.length) blocks.push({ type: 'h2', text: 'Sources' }, ...a.sources.map(text => ({ type: 'p', text })));
  return blocks.map(b => { if(b.type!=='table')return b; const t=newTable(b.rows.length,b.rows[0].length); t.grid.rows.forEach((r,i)=>r.cells.forEach((c,j)=>{c.runs=[{t:b.rows[i][j]}];})); return {...b,grid:t.grid}; }).map((b, i) => ({ id: `artifact-${i}`, ...b, props: { after: 6, line: 1.15 }, runs: b.type === 'table' ? undefined : [{ t: b.text, font: 'Arial', sz: b.type === 'h1' ? 20 : b.type === 'h2' ? 14 : 11, b: b.type.startsWith('h') }] }));
}
export function artifactHtml(a) {
  return `<article class="research-artifact"><p class="meta">Draft · ${esc(a.kind)}</p>${a.subtitle ? `<p>${esc(a.subtitle)}</p>` : ''}${a.sections.map(s => `<section>${s.heading ? `<h4>${esc(s.heading)}</h4>` : ''}${s.text ? `<p>${esc(s.text).replace(/\n/g, '<br>')}</p>` : ''}${s.type === 'table' ? `<div class="chat-table-wrap" tabindex="0"><table><thead><tr>${s.columns.map(c => `<th>${esc(c)}</th>`).join('')}</tr></thead><tbody>${s.rows.map(r => `<tr>${r.map(c => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>` : ''}${s.items ? `<dl class="artifact-items">${s.items.map(i => `<div><dt>${esc(i.label)}</dt><dd>${esc([i.value, i.unit].filter(v => v !== '').join(' '))}${i.detail ? `<p>${esc(i.detail)}</p>` : ''}${s.type === 'bars' ? `<progress aria-label="${esc(i.label)}" value="${i.value}" max="${Math.max(1, ...s.items.map(i => i.value))}"></progress>` : ''}</dd></div>`).join('')}</dl>` : ''}</section>`).join('')}${a.sources?.length ? `<details class="artifact-sources"><summary>Sources · ${a.sources.length}</summary><ol>${a.sources.map(s => `<li>${esc(s)}</li>`).join('')}</ol></details>` : ''}</article>`;
}
// Each page has the same physical ratio as A4. Long content paginates rather
// than being clipped; tables repeat their column headings on each page. The pages
// are figures: drawn from a token set (the house style, FIGURE-STYLE §2: one
// family, 400 and 600, the profile's greys), text wrapped by measured width.
// `style` is a figureTokens set (the screen set when absent); the page is 760 × 1075
// at the label size of 12 and scales with it.
const tokensOf = style => style || figureTokens(null, { medium: 'screen', profile: 'lykos-house' });
export function artifactPages(a, { style = null } = {}) {
  const t = tokensOf(style), k = t.size.label / 12, PW = Math.round(760 * k * 10) / 10, PH = Math.round(1075 * k * 10) / 10;
  const L = 44 * k, TEXTW = 672 * k, BOTTOM = 1020 * k, ls = t.size.label, LH = ls * 1.5;
  const pages = []; let parts = [], y = 48 * k;
  const txt = (value, x, yy, o = {}) => drawText(t, x, yy, value, o);
  const flush = () => {
    if (pages.length >= 60) throw new Error('Artifact is too long to render as a figure');
    parts.push(txt(`${pages.length + 1}`, PW - L, 1048 * k, { anchor: 'end', role: 'small', cls: 'c-mute' }));
    pages.push(svgRoot(t, PW, PH, parts.join(''), { title: a.title, desc: `Page ${pages.length + 1}` })); parts = []; y = 48 * k;
  };
  const room = h => { if (y + h > BOTTOM) { flush(); if (pages.length > 60) throw new Error('Artifact is too long to render as a figure'); return false; } return true; };
  // body text 400, headings 600 (the house has two sizes: weight and space carry the rank)
  const lines = (value, { head = false, gap = 0.5, small = false } = {}) => {
    for (const line of wrapText(t, value, TEXTW, small ? 'small' : 'label')) { room(LH); parts.push(txt(line, L, y, { role: head ? 'head' : small ? 'small' : 'label', cls: head ? 'c-ink c-head' : small ? 'c-mute' : 'c-ink' })); y += LH; }
    y += ls * gap;
  };
  lines(a.title, { head: true, gap: 0.8 }); if (a.subtitle) lines(a.subtitle, { small: true });
  for (const s of a.sections) {
    room(70 * k); if (s.heading) { y += ls * 0.6; lines(s.heading, { head: true, gap: 0.3 }); }
    if (s.text) lines(s.text);
    if (s.type === 'table') {
      const w = TEXTW / s.columns.length, pad = ls * 0.6;
      const row = (cells, head = false) => {
        const ls2 = cells.map(c => wrapText(t, c, Math.max(ls * 2, w - 2 * pad), head ? 'label' : 'small'));
        const count = Math.max(...ls2.map(l => l.length));
        for (let start = 0; start < count;) {
          if (y + 52 * k > BOTTOM) { flush(); if (!head) row(s.columns, true); }
          const take = Math.max(1, Math.min(count - start, Math.floor((BOTTOM - y - 16 * k) / LH))), h = take * LH + pad * 1.4;
          cells.forEach((c, i) => {
            const cell = `x="${r1(L + i * w)}" y="${r1(y - ls * 1.1)}" width="${r1(w)}" height="${r1(h)}"`;
            if (head) parts.push(`<rect class="c-band" ${cell} fill="${t.color.band}"/>`);
            parts.push(`<rect class="c-grid" ${cell} fill="none" stroke="${t.color.hair}" stroke-width="${t.line.hair}"/>`);
            ls2[i].slice(start, start + take).forEach((l, j) => parts.push(txt(l, L + i * w + pad, y + j * LH, { role: head ? 'head' : 'small', cls: head ? 'c-ink c-head' : 'c-ink' })));
          });
          y += h; start += take;
        }
      };
      row(s.columns, true); s.rows.forEach(r => row(r)); y += LH;
    }
    const top = Math.max(1, ...(s.items || []).map(i => Number(i.value) || 0));
    for (const [n, i] of (s.items || []).entries()) {
      room(90 * k); lines(`${s.type === 'steps' || s.type === 'timeline' ? `${n + 1}. ` : ''}${i.label}${i.value !== '' ? ` — ${i.value}${i.unit ? ` ${i.unit}` : ''}` : ''}`, { head: true, gap: 0.2 });
      if (s.type === 'bars') {
        const bh = ls * 0.8, width = Math.max(0, 650 * k * (Number(i.value) || 0) / top);
        room(bh + LH); parts.push(`<rect class="c-bar" x="${r1(L)}" y="${r1(y - ls * 0.7)}" width="${r1(width)}" height="${r1(bh)}" fill="${t.color.mark}"/>`); y += LH;
      }
      if (i.detail) lines(i.detail, { small: true });
    }
    y += 12 * k;
  }
  if (a.sources?.length) { y += ls * 0.6; lines('Sources', { head: true, gap: 0.3 }); a.sources.forEach((s, i) => lines(`${i + 1}. ${s}`, { small: true, gap: 0.2 })); }
  if (parts.length) flush(); return pages;
}
export function artifactSvg(a, { style = null } = {}) {
  const t = tokensOf(style), k = t.size.label / 12, PH = Math.round(1075 * k * 10) / 10, step = Math.round(1095 * k * 10) / 10, PW = Math.round(760 * k * 10) / 10;
  const pages = artifactPages(a, { style: t });
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${PW} ${r1(pages.length * step)}" role="img" aria-label="${esc(a.title)}" data-style="${esc(t.id)}"><title>${esc(a.title)}</title><desc>${pages.length} ${pages.length === 1 ? 'page' : 'pages'}</desc>${pages.map((p, i) => p.replace('<svg ', `<svg y="${r1(i * step)}" `)).join('')}</svg>`;
}
export function artifactFormats(a) { return ['docx', 'pdf', 'svg', 'png', 'html', 'md', ...(a.sections.some(s => s.type === 'table') ? ['xlsx', 'csv'] : [])]; }
const mime = { docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', pdf: 'application/pdf', svg: 'image/svg+xml', png: 'image/png', html: 'text/html', md: 'text/markdown', csv: 'text/csv', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' };
export const artifactText = a => artifactBlocks(a).map(b => b.type === 'table' ? b.rows.map(r => r.join('\t')).join('\n') : b.text).join('\n\n');
// Pages through the one rasteriser (figure-draw.mjs) at three times their size, as every figure PNG is.
async function raster(svg, type = 'image/png') {
  const box = svg.match(/viewBox="0 0 (\d+) (\d+)"/);
  if (+box[2] * 3 > 24000) throw new Error('Use PDF or SVG for this long artifact');
  const r = await rasterSvg(svg, { scale: 3, type, background: '#fff' });
  if (!r) throw new Error('Image export failed');
  return r;
}
// A small standards-based PDF writer for rasterized, paginated SVG pages.
// No font substitution or loss of Unicode labels in the exported figure.
export function imagePdf(images) {
  const encoder = new TextEncoder(), objects = [null, encoder.encode('<< /Type /Catalog /Pages 2 0 R >>'), null];
  const ids = [];
  for (const im of images) {
    const page = objects.length, image = page + 1, content = page + 2; ids.push(page);
    objects.push(encoder.encode(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595.28 841.89] /Resources << /XObject << /Im ${image} 0 R >> >> /Contents ${content} 0 R >>`));
    const prefix = encoder.encode(`<< /Type /XObject /Subtype /Image /Width ${im.width} /Height ${im.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${im.bytes.length} >>\nstream\n`), suffix = encoder.encode('\nendstream');
    const data = new Uint8Array(prefix.length + im.bytes.length + suffix.length); data.set(prefix); data.set(im.bytes, prefix.length); data.set(suffix, prefix.length + im.bytes.length); objects.push(data);
    const commands = 'q 595.28 0 0 841.89 0 0 cm /Im Do Q'; objects.push(encoder.encode(`<< /Length ${commands.length} >>\nstream\n${commands}\nendstream`));
  }
  objects[2] = encoder.encode(`<< /Type /Pages /Kids [${ids.map(id => `${id} 0 R`).join(' ')}] /Count ${ids.length} >>`);
  const chunks = [encoder.encode('%PDF-1.4\n')], offsets = [0]; let length = chunks[0].length;
  for (let i = 1; i < objects.length; i++) { offsets.push(length); const start = encoder.encode(`${i} 0 obj\n`), end = encoder.encode('\nendobj\n'); chunks.push(start, objects[i], end); length += start.length + objects[i].length + end.length; }
  const xref = length; chunks.push(encoder.encode(`xref\n0 ${objects.length}\n0000000000 65535 f \n${offsets.slice(1).map(n => `${String(n).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`));
  const total = chunks.reduce((n, c) => n + c.length, 0), result = new Uint8Array(total); let at = 0; for (const c of chunks) { result.set(c, at); at += c.length; } return result;
}
// The stylesheet of the standalone HTML export (a document the reader opens outside the app, not interface).
const ARTIFACT_PAGE_CSS = ':root{--page:900px;--full:100%}body{font:15px/1.6 system-ui;max-width:var(--page);margin:40px auto;padding:20px;color:rgb(32 39 53)}table{border-collapse:collapse;width:var(--full)}th,td{border:1px solid rgb(221 221 221);padding:8px;text-align:left}section{margin:24px 0}p,td{overflow-wrap:anywhere}h4{margin-bottom:8px}.chat-table-wrap{overflow:auto}dl>div{margin:12px 0}dt{font-weight:600}dd{margin-left:0}progress{width:var(--full)}input{padding:8px;width:var(--full);box-sizing:border-box}@media print{.artifact-filter{display:none}body{margin:0}}';

export async function artifactFile(a, format) {
  if (!artifactFormats(a).includes(format)) throw new Error('Unsupported export format');
  const tables = a.sections.filter(s => s.type === 'table');
  if (format === 'docx') return writeDocx({ blocks: artifactBlocks(a), section: { pageW: 595.3, pageH: 841.9, top: 54, bottom: 54, left: 54, right: 54 }, renderCite: () => '', renderResult: () => null, references: [] });
  if (format === 'pdf') { const images = []; for (const p of artifactPages(a)) images.push(await raster(p, 'image/jpeg')); return imagePdf(images); }
  if (format === 'png') return (await raster(artifactSvg(a))).bytes;
  if (format === 'svg') return artifactSvg(a);
  if (format === 'md') return artifactText(a);
  if (format === 'html') return `<!doctype html><html lang="en"><meta charset="utf-8"><title>${esc(a.title)}</title><style>${ARTIFACT_PAGE_CSS}</style><h1>${esc(a.title)}</h1>${artifactHtml(a)}<script>document.querySelectorAll('table').forEach(table=>{const label=document.createElement('label');label.className='artifact-filter';label.textContent='Filter table ';const input=document.createElement('input');input.type='search';input.placeholder='Search rows';input.addEventListener('input',()=>{const query=input.value.toLocaleLowerCase();table.querySelectorAll('tbody tr').forEach(row=>row.hidden=!row.textContent.toLocaleLowerCase().includes(query));});label.append(input);table.parentElement.before(label);});</script></html>`;
  if (format === 'xlsx') return writeXlsx(tables.map((s, i) => ({ name: s.heading || `Table ${i + 1}`, rows: [s.columns, ...s.rows] })));
  return tables.map(s => [s.columns, ...s.rows].map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\r\n')).join('\r\n\r\n');
}
export function downloadArtifact(a, anchor) {
  const labels = { docx: 'Word', pdf: 'PDF', svg: 'SVG', png: 'PNG', html: 'Web page', md: 'Text', xlsx: 'Excel', csv: 'CSV' };
  showMenu(anchor, artifactFormats(a).map(format => ({ label: labels[format], icon: 'download', run: async () => {
    try { await saveFile(await artifactFile(a, format), `${a.title.replace(/[^\p{L}\p{N} _-]/gu, '').slice(0, 80) || 'research-artifact'}.${format}`, mime[format]); }
    catch (error) { anchor.textContent = 'Try again'; anchor.title = error.message; }
  } })));
}
export { conversationArtifacts } from './research-ledger.mjs';

/** The house drawings app/lint-figures.mjs checks: the pages of an artifact with text, a table, bars and steps, and the stacked figure. */
export const __fixture = style => {
  const a = validateArtifact({ kind: 'infographic', title: 'Evidence at a glance', subtitle: 'Draft for the review team', sections: [
    { type: 'text', heading: 'Summary', text: 'Twelve randomised trials were included. Most were at low risk of bias for randomisation and at some concerns for the reported result.' },
    { type: 'table', heading: 'Included trials', columns: ['Study', 'Participants', 'Finding'], rows: [['Aldermere 2012', '240', 'Lower pain at 12 weeks'], ['Ibarra-Montoya 2019', '118', 'No difference in function']] },
    { type: 'bars', heading: 'Participants per trial', items: [{ label: 'Aldermere 2012', value: 240 }, { label: 'Ibarra-Montoya 2019', value: 118 }] },
    { type: 'steps', heading: 'Next', items: [{ label: 'Confirm eligibility', detail: 'Two reviewers, independently' }, { label: 'Extract outcomes', value: '' }] }], sources: ['Registry search, 2026-09-29'] });
  return [{ name: 'artifactPages', svg: artifactPages(a, { style })[0] }, { name: 'artifactSvg', svg: artifactSvg(a, { style }) }];
};
