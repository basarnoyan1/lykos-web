// What a file is to the project, in one phrase (plan §4.15d and the Files browser): driven by what the project already knows, never by a
// scan of its own. The phrase and its weight (`strong`: a file that wants a decision is set in weight 500, as the Needs attention rows are;
// nothing is coloured) come from `relationOf`, which is pure; `loadRelations` gathers the facts once for a folder page and answers `of(path, file)`.
//
// One phrase per row, in this order: unsaved edits in an open tab; a file that moved, or that the app is ahead of, or that values rest on
// without a record (all strong); open; adopted; in the library; imported or changed since import; written by Lykos; used by a figure;
// new since the last visit. The inspector shows every fact, not the first.
import { day, plural } from './dates.mjs';
import { ROLE_NAMES, driftReport, summaryOf } from './adoption.mjs';
import { outputsLog } from './project-folder.mjs';
import { readSidecar } from './figure-sidecar.mjs';

const isObj = v => v != null && typeof v === 'object' && !Array.isArray(v);
const str = v => typeof v === 'string' ? v : '';
const cells = n => plural(n, 'cell');

/** The text and weight of the one phrase for a file, from the facts about it; `{ text: '', strong: false, kind: '' }` when it has none. */
export function relationOf(input = {}) {
  const f = isObj(input) ? input : {};
  const a = isObj(f.adoption) ? f.adoption : null;
  const hit = (text, strong = false, kind = '') => ({ text, strong, kind });
  if (f.tab === 'dirty') return hit('Open, unsaved edits', false, 'open');
  if (a?.adopted) {
    if (a.state === 'unread') return hit('Adopted: could not be read', true, 'unread');
    if (a.state === 'changed') return hit(`Adopted: changed since adoption${a.cellsUnread ? ', cells not read' : a.differ ? `, ${cells(a.differ)} differ` : ''}`, true, 'changed');
    if (a.differ) return hit(`Adopted: ${cells(a.differ)} differ from the record`, true, 'changed');
    if (a.ahead) return hit(`Adopted: the app is ahead in ${cells(a.ahead)}`, true, 'ahead');
  }
  if (a?.unadopted) return hit('Values rest on it, not adopted', true, 'unadopted');
  if (f.tab === 'open') return hit('Open', false, 'open');
  if (a?.adopted) { const as = ROLE_NAMES[a.role]; return hit(as ? `Adopted as ${as}` : 'Adopted', false, 'adopted'); }
  if (str(f.library)) return hit(`In the library as ${f.library}`, false, 'library');
  if (isObj(f.applied)) {
    const moved = f.applied.size != null && f.size != null && (Number(f.applied.size) !== Number(f.size) || (f.applied.mtime != null && f.mtime != null && Number(f.applied.mtime) !== Number(f.mtime)));
    return moved ? hit('Changed since import', true, 'import-changed') : hit(`Imported ${day(f.applied.at)}`.trim(), false, 'imported');
  }
  if (str(f.written)) return hit(`Written by Lykos${f.written === 'Written by Lykos' ? '' : `: ${f.written}`}`, false, 'written');
  const figs = Array.isArray(f.figures) ? f.figures.filter(Boolean) : [];
  if (figs.length) return hit(`Used by ${figs.slice(0, 2).join(' and ')}${figs.length > 2 ? ` and ${figs.length - 2} more` : ''}`, false, 'figure');
  if (f.newSince) return hit('New since your last visit', false, 'new');
  return hit('');
}

/** The figures that use each file as an input, by the registry's producers: `Map<path, label[]>`. */
export function figureUse(registry) {
  const out = new Map();
  for (const p of Array.isArray(registry?.producers) ? registry.producers : []) {
    const names = (p.outputs || []).map(o => registry.figures?.[o]?.label || registry.figures?.[o.replace(/\.[^.]+$/, '')]?.label).filter(Boolean);
    const label = names[0] || str(p.label);
    for (const i of Array.isArray(p.inputs) ? p.inputs : []) if (i?.path && label) out.set(i.path, [...new Set([...(out.get(i.path) || []), label])]);
  }
  return out;
}

/** What `.lykos/outputs.json` says Lykos wrote: `Map<path, label>`. */
export function writtenBy(log) {
  const out = new Map();
  for (const e of Object.values(isObj(log) ? log : {})) for (const p of Array.isArray(e?.paths) ? e.paths : []) if (typeof p === 'string') out.set(p, str(e.label) || 'Written by Lykos');
  return out;
}

/**
 * Gathers the facts for a folder page once: the adoption record against the files, what Lykos wrote, the figure registry, the library's
 * PDFs, what was imported. Answers `{ report, of(path, { size, mtime, tab }) , phrase(path, file) }`. Reads sidecars and the files that
 * moved; writes nothing. A source that cannot be read leaves its phrases out.
 */
export async function loadRelations(folder, state, { papers = state?.papers || [], applied = state?.folderMap?.applied || {}, seenAt = 0 } = {}) {
  let report = null, written = new Map(), figures = new Map();
  try { report = await driftReport(folder, state); } catch { report = null; }
  try { written = writtenBy(await outputsLog(folder)); } catch { written = new Map(); }
  try { figures = figureUse((await readSidecar('registry', { folder })).doc); } catch { figures = new Map(); }
  const library = new Map(papers.filter(p => p?.pdfRel).map(p => [p.pdfRel, p.label || p.title || 'a record']));
  const facts = (path, file = {}) => ({
    tab: file.tab || '', adoption: report ? summaryOf(report, path) : null, library: library.get(path) || '', applied: applied[path] || null,
    size: file.size, mtime: file.mtime, written: written.get(path) || '', figures: figures.get(path) || [],
    newSince: !!seenAt && file.mtime != null && Number(file.mtime) > seenAt,
  });
  return { report, of: (path, file) => facts(path, file), phrase: (path, file) => relationOf(facts(path, file)) };
}
