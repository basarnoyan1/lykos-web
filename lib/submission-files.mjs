// The project folder's files a submission can point at (the manuscript and the decision letters), versions of one file together. Apart from
// lib/submissions.mjs so that the store and the Overview do not load the folder's file-name reader (lib/folder-map.mjs) with it.
import { groupVersions } from './file-versions.mjs';

/**
 * The files of the project folder a submission can point at: docx and pdf (or `exts`), versions of one file together (lib/file-versions.mjs),
 * the newest version first and its earlier versions under it, Archive copies marked `archived`; groups by their newest change.
 */
export function manuscriptChoices(entries, archived, { exts = ['docx', 'pdf'] } = {}) {
  const want = new Set(exts.map(x => String(x).toLowerCase()));
  const ok = e => e && typeof e.name === 'string' && !e.dir && want.has(e.name.slice(e.name.lastIndexOf('.') + 1).toLowerCase());
  const live = (Array.isArray(entries) ? entries : []).filter(ok), old = (Array.isArray(archived) ? archived : []).filter(ok);
  const groups = groupVersions(live, old).sort((a, b) => (b.latest.mtime || 0) - (a.latest.mtime || 0));
  return groups.flatMap(g => [g.latest, ...g.earlier]).map(e => ({ rel: e.rel ?? e.name, name: e.name, ...(e.archived ? { archived: true } : {}) }));
}
