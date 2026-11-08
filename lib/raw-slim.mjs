// Once a session, some time after a project opens (store.mjs load): the raw lines older imports kept on each record go, their declared type and
// publication types kept as fields (lib/ref-import-extra.mjs dropRaw). Only a record whose import file the search log names (kept in the folder or
// the app's store) loses its lines; any other keeps them. Loaded on its own, outside the startup path.
import { dropRaw } from './ref-import-extra.mjs';

const base = f => String(f || '').split(/[\\/]/).pop();

/** The records whose raw lines can go: their import file is kept. */
export function slimmable(s) {
  const kept = new Set((s.searches || []).filter(r => r.file || ['folder', 'store'].includes(r.raw?.kept)).map(r => base(r.file || r.raw?.name || '')).filter(Boolean));
  return (s.papers || []).filter(p => p.raw != null && kept.has(base(p.importFile)));
}

/** Drops them in one change; answers how many records it slimmed. */
export function slimStoredRaw(get, update) {
  const n = slimmable(get()).length;
  if (!n) return 0;
  update(s => { for (const p of slimmable(s)) dropRaw(p); return s; }, { indexNeutral: true, label: 'Raw import lines left to their files' });
  return n;
}
