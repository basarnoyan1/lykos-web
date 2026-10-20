// A folder's existing document read into the package once (plan, package amendment): a caption starts an item ("Table S1.", "Figure 2:",
// "Supplementary Table 3", "Fig. 4", "eTable 1"); the table or picture beside it is its content; paragraphs after a table up to the next caption
// or break are its notes; the caption's first sentence is the title, the rest the legend. A picture equal to a folder image becomes that file;
// anything else is held in .lykos/package. Nothing in the folder is changed.
import { parseDocx } from './docx.mjs';
import { cellText } from './manuscript-doc.mjs';
import { addPart, addItem, setItem, labels } from './package.mjs';
import { HELD_DIR, imageSize } from './package-sources.mjs';
import { projectFiles } from './folder-results.mjs';
import { parseVersionFull } from './folder-map.mjs';
import { ensureDir } from './project-folder.mjs';

export const CAPTION = /^\s*(?:supplementary\s+|e)?(table|fig(?:ure)?\.?)\s*(s?)(\d+)([a-z]?)\s*[.:]\s*/i;
const hex = async bytes => [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(b => b.toString(16).padStart(2, '0')).join('');
const enc = new TextEncoder();

export function captionOf(text) {
  const m = CAPTION.exec(String(text || ''));
  if (!m) return null;
  return { kind: /^t/i.test(m[1]) ? 'table' : 'figure', prefix: m[2].toUpperCase(), n: Number(m[3]), rest: String(text).slice(m[0].length).trim() };
}
const firstSentence = s => { const m = /^(.*?[.!?])(\s+|$)(.*)$/s.exec(s); return m ? [m[1].trim(), m[3].trim()] : [s.trim(), '']; };
const isLandscape = sec => !!sec && (sec.orient === 'landscape' || sec.pageW > sec.pageH);

export function readDocxPart(parsed, { path }) {
  const blocks = parsed.blocks, items = [];
  let cur = null, pendingFigure = null;
  // the orientation each block is printed in: the section a block belongs to ends at the next paragraph carrying one
  const orientAt = [], ends = blocks.map((b, i) => (b.props?.section ? i : -1)).filter(i => i >= 0);
  blocks.forEach((b, i) => { const end = ends.find(e => e >= i); orientAt[i] = isLandscape(end != null ? blocks[end].props.section : parsed.section) ? 'landscape' : 'portrait'; });
  blocks.forEach((b, i) => {
    if (b.type === 'figure') { const m = parsed.media.find(x => x.id === b.img); pendingFigure = m ? { bytes: m.bytes, mime: m.mime } : null; return; }
    if (b.type === 'table') { if (cur && cur.kind === 'table' && !cur.grid) { cur.grid = { ...b.grid, rows: b.grid.rows.map(r => ({ ...r, cells: r.cells.map(c => ({ text: cellText(c) })) })) }; cur.orient = orientAt[i]; } return; }
    const text = String(b.text || '').replace(/\{\{[^}]*\}\}/g, m => (m.startsWith('{{seq:') ? '1' : '')).trim();
    const cap = captionOf(text);
    if (cap) {
      const [title, legend] = cap.kind === 'figure' ? firstSentence(cap.rest) : [cap.rest, ''];
      cur = { kind: cap.kind, prefix: cap.prefix, title, legend, notes: [], orient: orientAt[i] };
      if (cap.kind === 'figure') { cur.image = pendingFigure; pendingFigure = null; }
      items.push(cur);
      return;
    }
    if (cur && cur.kind === 'table' && cur.grid && text) cur.notes.push(text);
  });
  const base = path.slice(path.lastIndexOf('/') + 1);
  const page = parsed.section || {};
  return { part: { name: parseVersionFull(base).stem.replace(/[_-]+/g, ' '), prefix: items.find(it => it.prefix)?.prefix || '', file: path,
    page: { size: Math.abs(Math.min(page.pageW || 595, page.pageH || 842) - 612) < 4 ? 'Letter' : 'A4', orient: isLandscape(page) ? 'landscape' : 'portrait' } }, items };
}

export async function importDocx(folder, pkg, path) {
  const parsed = await parseDocx(await folder.read(path));
  const read = readDocxPart(parsed, { path });
  if (!read.items.length) return { error: `${path} has no table or figure captions` };
  const images = new Map();
  for (const f of (await projectFiles(folder)).filter(f => /\.(png|jpe?g)$/i.test(f.path))) images.set(await hex(await folder.read(f.path)), f.path);
  const part = addPart(pkg, { ...read.part, formats: ['docx'] });
  let held = 0;
  // held files are named by their content's hash: one already there holds these bytes (a second import of the same document)
  const keep = async (rel, bytes) => { await ensureDir(folder, rel.slice(0, rel.lastIndexOf('/'))); if (!(await folder.stat(rel)).exists) await folder.writeBytes(rel, bytes); held++; };
  for (const it of read.items) {
    let source;
    if (it.kind === 'figure') {
      if (!it.image) source = { path: '' };
      else { const h = await hex(it.image.bytes); if (images.has(h)) source = { path: images.get(h) }; else { const ext = imageSize(it.image.bytes)?.mime === 'image/jpeg' ? 'jpg' : 'png'; await keep(`${HELD_DIR}/media/${h}.${ext}`, it.image.bytes); source = { from: path, held: `media/${h}.${ext}` }; } }
    } else {
      const name = `tables/${await hex(enc.encode(JSON.stringify(it.grid || {})))}.json`;
      await keep(`${HELD_DIR}/${name}`, enc.encode(JSON.stringify(it.grid || { cols: [], rows: [] }))); source = { from: path, held: name };
    }
    addItem(pkg, part.id, { kind: it.kind, source, title: it.title, legend: it.legend, notes: it.notes, ...(it.orient !== part.page.orient ? { orient: it.orient } : {}) });
  }
  // "Table S1" in a caption or note that names an item of the package becomes a reference
  const L = labels(pkg), byLabel = new Map([...L].map(([id, l]) => [l, id]));
  const link = t => String(t || '').replace(/\b(Table|Figure)\s+(S?\d+)\b/g, (m, k, n) => (byLabel.has(`${k} ${n}`) ? `{{xref:${byLabel.get(`${k} ${n}`)}}}` : m));
  for (const id of part.items) { const it = pkg.items[id]; setItem(pkg, id, { title: link(it.title), legend: link(it.legend), notes: it.notes.map(link) }); }
  return { part, count: part.items.length, held };
}
