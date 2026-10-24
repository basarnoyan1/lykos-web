// Metadata only; no headers, credentials or account catalogs are persisted.
export function catalogKey(cfg) {
  let endpoint = '';
  try { const u = new URL(cfg.base); endpoint = u.origin + u.pathname.replace(/\/+$/, ''); } catch {}
  return `lykos.models.v2.${cfg.provider}:${endpoint}`;
}
export function createCatalogCache({ read, write, max = 16 } = {}) {
  const entries = new Map();
  const put = (key, doc) => {
    const entry = { ...doc, byId: new Map(doc.rows.map(row => [row.id, row])) };
    entries.delete(key); entries.set(key, entry);
    while (entries.size > max) entries.delete(entries.keys().next().value);
    return entry;
  };
  return {
    get(key) {
      if (entries.has(key)) { const value = entries.get(key); entries.delete(key); entries.set(key, value); return value; }
      try { const doc = JSON.parse(read?.(key) || 'null'); if (doc?.at && Array.isArray(doc.rows)) return put(key, doc); } catch {}
      return null;
    },
    putCatalog(key, rows, at = Date.now()) { const doc = { at, rows }; try { write?.(key, JSON.stringify(doc)); } catch {} return put(key, doc); },
    invalidate(key) { if (key) entries.delete(key); else entries.clear(); },
    get size() { return entries.size; },
  };
}
