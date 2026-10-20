// Folder map rows that folder-init reads and the per-kind imports did not
// cover: a table-groups file becomes collections, a PRISMA counts file the
// flow's counts. Each goes through the same pure helpers as the whole-folder
// setup (lib/folder-init.mjs), so a row applied by hand lands as setup would.
import { get, update } from '../store.mjs';
import { collectionsFromGroups, prismaFromCounts } from './folder-init.mjs';

const dec = new TextDecoder();
const readJson = async (folder, path) => JSON.parse(dec.decode(await folder.read(path)));

/** Collections "Table 1"… from a table-groups file, matched to studies by their number (the PDF's NN). */
export async function importTableGroups(folder, path) {
  const groups = await readJson(folder, path);
  const byNo = new Map(get().papers.filter(p => p.folderNo).map(p => [Number(p.folderNo), p.id]));
  if (!byNo.size) return 'Needs the study PDFs attached first';
  const list = collectionsFromGroups(groups, no => byNo.get(Number(no)) || null);
  if (!list.length) return 'No table groups in the file';
  update(s => {
    s.collections = [...(s.collections || []).filter(c => c.parent || !list.some(t => t.name === c.name)), ...list];
    return s;
  });
  return list.map(c => `${c.name} (${c.members.length})`).join(', ');
}

/** The PRISMA flow's counts from a counts file; counts entered by hand before are replaced field by field. */
export async function importPrismaCounts(folder, path) {
  const r = prismaFromCounts(await readJson(folder, path));
  if (!r) return 'No PRISMA counts in the file';
  update(s => { s.prisma = { ...(s.prisma || {}), ...r.prisma }; s.prismaArms = { ...(s.prismaArms || {}), ...r.arms }; return s; });
  return `${Object.keys(r.prisma).length} counts`;
}
