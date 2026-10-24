// Whether the browser keeps what Lykos stores in a tab, and asking it to. In a tab, projects, their PDFs and the settings live in the
// origin's IndexedDB, which a browser may clear when space runs low, or, in Safari, after days without a visit, unless the origin is
// persisted (StorageManager.persist()). The desktop app keeps its data in files and never asks. Asked when a project is first kept in
// the browser (lib/projects.mjs) and from Settings > Storage; Firefox asks the person, Chromium and Safari decide by themselves.
import { inDesktop } from './native.mjs';

const manager = () => (typeof navigator !== 'undefined' ? navigator.storage : null);

/** true kept, false may be cleared, null unknown (a browser without the StorageManager, or the desktop app, which needs none). */
export async function storageKept() {
  if (inDesktop() || !manager()?.persisted) return null;
  try { return !!await manager().persisted(); } catch { return null; }
}

/** Asks the browser to keep this origin's storage; answers whether it is kept. Never asks again once it is. */
export async function keepStorage() {
  if (inDesktop() || !manager()?.persist) return null;
  try { return !!(await manager().persisted() || await manager().persist()); } catch { return false; }
}
