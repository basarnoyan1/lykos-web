// A project copied into the app (Import projects from folder…, lib/folder-import.mjs) has no folder, so it keeps the Word files its
// registered manuscript names (views/manuscript-registered.mjs readerDocs) with its PDFs, in the app's file store under the project.
// keptFolder() reads them as a folder's read and stat would, for the reader when no folder is open. Read only: there is nothing to write to.
import { lib_files$getFile as getFile, lib_files$getFileReference as getFileReference } from "../boot.mjs";

/** The file store's id of a kept file, by its path in the project's folder. */
export const keptId = rel => `kept:${rel}`;

/** A folder's read and stat over the current project's kept files; its list is empty (the files beside them were not kept). */
export function keptFolder() {
  const blob = p => getFile(keptId(p)).catch(() => null);
  return {
    kind: 'kept', name: 'Kept files', can: {},
    read: async p => { const b = await blob(p); if (!b) throw new Error(`${p} was not kept with this project`); return new Uint8Array(await b.arrayBuffer()); },
    // the stamp the reader caches by: the stored version's hash stands in for a modified time (the copy never changes)
    stat: async p => {
      const ref = await getFileReference(keptId(p)).catch(() => null);
      if (!ref?.hash) return { exists: false };
      const b = await blob(p);
      return b ? { exists: true, mtime: parseInt(String(ref.hash).replace(/^sha256:/, '').slice(0, 12), 16) || 1, size: b.size } : { exists: false };
    },
    list: async () => [],
  };
}
