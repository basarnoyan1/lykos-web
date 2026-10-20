import { projects, projectGeneration } from '../store.mjs';
const cache = new Map();
const MAX = 32 * 1024 * 1024;
const key = id => `${projects().current}:${projectGeneration()}:${id}`;
function read(id) {
  const k = key(id), item = cache.get(k);
  if (item) { cache.delete(k); cache.set(k, item); }
  return item;
}
export const previewBytes = id => read(id)?.bytes || null;
export const previewArticle = id => read(id)?.article || null;
export function cachePreview(id, bytes, article = null) {
  const size = bytes?.length || JSON.stringify(article).length * 2;
  if (size > MAX) throw new Error('This document exceeds the 32 MB preview limit');
  cache.delete(key(id));
  let total = [...cache.values()].reduce((n, b) => n + b.size, 0);
  while (cache.size && (cache.size >= 24 || total + size > MAX)) {
    const oldest = cache.keys().next().value; total -= cache.get(oldest).size; cache.delete(oldest);
  }
  cache.set(key(id), { bytes, article, size });
}

export function discardTextPreview(id) { if (read(id)?.article) cache.delete(key(id)); }

export function discardPreview(id) { cache.delete(key(id)); }
