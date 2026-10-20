// Document storage.
//
// PDFs are held as blobs in IndexedDB, not as base64 in the project record.
// Two reasons, both of which only appear at real sizes: String.fromCharCode
// applied to a spread array overflows the call stack above about 100 KB, and
// base64 inflates by 4/3 into a localStorage quota of roughly 5 MB — three
// ordinary papers exceed it. The project keeps a reference; the bytes live here.
//
// This is also the shape the Rust core will take over: a content-addressed
// store beside the database, with the project holding identifiers (plan C5).
import { previewBytes } from './preview-cache.mjs';
import { evictionPlan, limitBytes } from './cache-budget.mjs';
const DB = 'lykos-files';
const STORE = 'pdfs';       // copies, for files we were handed and cannot re-find
const HANDLES = 'handles';  // links, for files that stay where the user keeps them
const DOCTEXT = 'doctext';  // page text and item positions, keyed by document hash
let dbPromise = null;

function open() {
  if (dbPromise) return dbPromise;
  const opening = dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 3);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
      if (!db.objectStoreNames.contains(HANDLES)) db.createObjectStore(HANDLES);
      if (!db.objectStoreNames.contains(DOCTEXT)) db.createObjectStore(DOCTEXT);
    };
    req.onsuccess = () => { req.result.onclose = () => { if (dbPromise === opening) dbPromise = null; }; resolve(req.result); };
    req.onerror = () => reject(req.error);
  });
  opening.catch(() => { if (dbPromise === opening) dbPromise = null; });
  return dbPromise;
}

function tx(mode, fn, storeName = STORE) {
  return open().then(db => new Promise((resolve, reject) => {
    const t = db.transaction(storeName, mode);
    const store = t.objectStore(storeName);
    const req = fn(store);
    t.oncomplete = () => resolve(req?.result);
    t.onerror = () => reject(t.error || new Error('Document storage transaction failed'));
    t.onabort = () => reject(t.error || new Error('Document storage transaction aborted'));
  }));
}

// Some WebKit storage contexts abort Blob writes with a null transaction error.
// Keep the same content hash/reference and retry with structured-cloneable bytes.
const storedBlob = value => value?.kind === 'document-bytes-v1'
  ? new Blob([value.bytes], { type: value.type || '' }) : value;
async function writeDocument(id, owner, hash, blob) {
  const write = value => tx('readwrite', s => {
    s.put(value, assetKey(hash));
    return s.put({ asset: assetKey(hash), hash }, referenceKey(owner, id));
  });
  try { await write(blob); }
  catch { await write({ kind: 'document-bytes-v1', bytes: await blob.arrayBuffer(), type: blob.type }); }
}
const assetKey = hash => `sha256:${hash}`;
const referenceKey = (owner, id) => `ref:${JSON.stringify([owner, String(id)])}`;
const referenceWrites = new Map();
function writeReference(owner, id, write) {
  const key = referenceKey(owner, id);
  const pending = (referenceWrites.get(key) || Promise.resolve()).catch(() => {}).then(write);
  referenceWrites.set(key, pending);
  const release = () => { if (referenceWrites.get(key) === pending) referenceWrites.delete(key); };
  pending.then(release, release);
  return pending;
}
export async function documentHash(bytes) {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map(n => n.toString(16).padStart(2, '0')).join('');
}
function rememberVersion(id, hash, source) {
  if ((!source.paper && !source.asset) || source.generation !== projectGeneration() || source.owner !== recoveryOwner()) return;
  update(s => {
    if (source.asset) {
      const a = s.manuscript?.assets?.find(a => `asset-${a.id}` === id);
      if (a !== source.asset) return s;
      if (a.fileHash && a.fileHash !== hash && !(a.fileVersions || []).some(v => v.hash === a.fileHash))
        a.fileVersions = [...(a.fileVersions || []), { hash: a.fileHash, asset: a.assetRef || assetKey(a.fileHash), at: new Date().toISOString() }];
      a.fileHash = hash; a.assetRef = assetKey(hash);
      return s;
    }
    const p = s.papers?.find(p => p.id === id);
    if (p !== source.paper) return s;
    if (p.pdfHash && p.pdfHash !== hash && !(p.pdfVersions || []).some(v => v.hash === p.pdfHash))
      p.pdfVersions = [...(p.pdfVersions || []), { hash: p.pdfHash, asset: p.pdfAsset || assetKey(p.pdfHash), name: p.pdfName || '', mode: p.pdfMode || '', rel: p.pdfRel || '', at: new Date().toISOString() }];
    p.pdfHash = hash; p.pdfAsset = assetKey(hash);
    return s;
  });
}
const sourceOf = (id, owner) => ({ owner, generation: projectGeneration(), paper: get().papers?.find(p => p.id === id), asset: get().manuscript?.assets?.find(a => `asset-${a.id}` === id) });
/** Immutable bytes plus a project-owned reference. Old versions remain reachable by hash. */
export async function putFile(id, blob, { owner = recoveryOwner() } = {}) {
  const source = sourceOf(id, owner);
  return writeReference(owner, id, async () => {
  if (source.paper?.pdfHash) await getFile(id, { owner, expectedHash: source.paper.pdfHash }).catch(() => null);
  if (source.asset?.fileHash) await getFile(id, { owner, expectedHash: source.asset.fileHash }).catch(() => null);
  const hash = await documentHash(await blob.arrayBuffer());
  await writeDocument(id, owner, hash, blob);
  rememberVersion(id, hash, source);
  return hash;
  });
}
export async function getFile(id, { owner = recoveryOwner(), expectedHash } = {}) {
  if (String(id).startsWith('sha256:')) return storedBlob(await tx('readonly', s => s.get(id)));
  const paper = owner === recoveryOwner() ? get().papers?.find(p => p.id === id) : null;
  const asset = owner === recoveryOwner() ? get().manuscript?.assets?.find(a => `asset-${a.id}` === id) : null;
  expectedHash ??= paper?.pdfHash || asset?.fileHash;
  if (paper?.pdf && !expectedHash) throw new Error('This attachment has no verified document version. Reattach the intended file.');
  if (asset && !expectedHash) throw new Error('This supplement has no verified document version. Reattach the intended file.');
  // A frozen version is authoritative even after another attachment changes
  // the project's current convenience reference, or after project import.
  if (expectedHash) {
    const exact = await tx('readonly', s => s.get(assetKey(expectedHash)));
    if (exact) return storedBlob(exact);
  }
  const ref = await tx('readonly', s => s.get(referenceKey(owner, id)));
  if (ref) {
    if (expectedHash && ref.hash !== expectedHash) throw new Error('The attachment belongs to a different document version. Reattach the intended file.');
    return storedBlob(await tx('readonly', s => s.get(ref.asset)));
  }
  // Keep legacy keys intact for recovery/other projects. Migrate a paper only
  // when its recorded hash identifies these exact bytes; ambiguity is visible.
  const legacy = storedBlob(await tx('readonly', s => s.get(id)));
  if (!legacy) return null;
  if (paper && !expectedHash) throw new Error('This legacy attachment has no verified document version. Reattach the intended file.');
  const hash = await documentHash(await legacy.arrayBuffer());
  if (expectedHash && hash !== expectedHash) throw new Error('The legacy attachment does not match this project’s document version. Reattach the intended file.');
  await writeDocument(id, owner, hash, legacy);
  return legacy;
}
/** Read only this project's verified reference; never guess from a legacy global ID. */
export async function getFileReference(id, { owner = recoveryOwner() } = {}) {
  const ref = await tx('readonly', s => s.get(referenceKey(owner, id)));
  return ref && /^[a-f0-9]{64}$/.test(ref.hash || '') && ref.asset === assetKey(ref.hash) ? { hash: ref.hash, asset: ref.asset } : null;
}
export const deleteFile = (id, { owner = recoveryOwner() } = {}) => writeReference(owner, id, () => tx('readwrite', s => s.delete(referenceKey(owner, id))));
export const listFiles = async () => (await tx('readonly', s => s.getAllKeys())).filter(k => !String(k).startsWith('ref:'));

// ---- links ---------------------------------------------------------------
// A file the user chose from their own disk stays there. We keep a handle, not
// a copy: a library of a few hundred papers is gigabytes, and duplicating it
// into the app's storage helps nobody. A copy is the fallback for files handed
// to us through a plain file input, which yields no durable reference.
import { inDesktop, readFileNative } from './native.mjs';
import { get, update, recoveryOwner, projectGeneration } from '../store.mjs';
import { activeFolder } from './projects.mjs';
// No linked folders in the hosted web build, for the reason lib/fsys.mjs canOpenFolders gives.
export const canLink = () => inDesktop() || (typeof window !== 'undefined' && 'showDirectoryPicker' in window);

export async function putHandle(id, handle, { owner = recoveryOwner() } = {}) {
  const source = sourceOf(id, owner);
  return writeReference(owner, id, async () => {
  let hash = '';
  if (source.paper) {
    const bytes = handle?.path ? await readFileNative(handle.path) : new Uint8Array(await (await handle.getFile()).arrayBuffer());
    hash = await documentHash(bytes);
  }
  await tx('readwrite', s => s.put({ handle, hash }, referenceKey(owner, id)), HANDLES);
  if (hash) rememberVersion(id, hash, source);
  return hash;
  });
}
export async function getHandle(id, { owner = recoveryOwner() } = {}) {
  const ref = await tx('readonly', s => s.get(referenceKey(owner, id)), HANDLES);
  return ref?.handle || await tx('readonly', s => s.get(id), HANDLES);
}
export const listHandles = async () => (await tx('readonly', s => s.getAll(), HANDLES)).map(r => r.handle || r);
export const deleteHandle = (id, { owner = recoveryOwner() } = {}) => writeReference(owner, id, () => tx('readwrite', s => s.delete(referenceKey(owner, id)), HANDLES));

// ---- stored PDF previews (the doctext store) ---------------------------------------------------------------------------------------
// Each document's page text with item positions (lib/doctext.mjs), keyed by its hash: a cache, made again from the PDF when it is gone,
// held under the limit Settings > Storage sets (lib/cache-budget.mjs). Recognised text ('ocr:' keys, lib/ocr.mjs) shares the store but
// is not a cache: it is never counted, evicted or cleared here. A ledger beside the entries (key -> { bytes, at }) is what the limit is
// checked against when an entry is written; nothing watches the store in between.
const LEDGER = 'lru:ledger';
const isCached = key => !String(key).startsWith('ocr:') && key !== LEDGER;
const entryBytes = obj => { try { return JSON.stringify(obj).length; } catch { return 0; } };
let ledgerChain = Promise.resolve();
/** Runs fn(ledger, store keys) one at a time and writes the ledger back with the keys fn returns deleted, in one transaction. */
function withLedger(fn) {
  const run = ledgerChain.catch(() => {}).then(async () => {
    let ledger = await tx('readonly', s => s.get(LEDGER), DOCTEXT);
    if (!ledger || typeof ledger !== 'object') {
      // The first time: measure what earlier versions stored, once.
      ledger = {};
      for (const k of (await tx('readonly', s => s.getAllKeys(), DOCTEXT)).filter(isCached)) {
        const v = await tx('readonly', s => s.get(k), DOCTEXT);
        if (v) ledger[k] = { bytes: entryBytes(v), at: Date.parse(v.builtAt) || 0 };
      }
    }
    const drop = (await fn(ledger)) || [];
    for (const k of drop) delete ledger[k];
    await tx('readwrite', s => { for (const k of drop) s.delete(k); return s.put(ledger, LEDGER); }, DOCTEXT);
    return { ledger, dropped: drop };
  });
  ledgerChain = run;
  return run;
}
const fit = (ledger, keep = []) => evictionPlan(ledger, limitBytes(), keep);
export async function putDocText(key, obj) {
  await tx('readwrite', s => s.put(obj, key), DOCTEXT);
  if (isCached(key)) await withLedger(ledger => { ledger[key] = { bytes: entryBytes(obj), at: Date.now() }; return fit(ledger, [key]); }).catch(() => {});
}
export async function getDocText(key) {
  const value = await tx('readonly', s => s.get(key), DOCTEXT);
  if (value && isCached(key)) withLedger(ledger => { ledger[key] = { bytes: ledger[key]?.bytes ?? entryBytes(value), at: Date.now() }; }).catch(() => {});
  return value;
}
/** The stored previews: their bytes and how many documents. */
export async function docTextUsage() {
  const { ledger } = await withLedger(() => []);
  const list = Object.values(ledger);
  return { bytes: list.reduce((n, e) => n + (e.bytes || 0), 0), entries: list.length };
}
/** Lets the least recently used previews go until the stored ones fit the limit (after the limit is lowered). */
export const trimDocText = () => withLedger(ledger => fit(ledger)).then(r => r.dropped.length);
/** Forgets every stored preview; recognised text stays. */
export const clearDocText = () => withLedger(async ledger => [...new Set([...Object.keys(ledger), ...(await tx('readonly', s => s.getAllKeys(), DOCTEXT)).filter(isCached)])]).then(r => r.dropped.length);

/** Re-reading a linked file needs permission that may have lapsed since. */
export async function resolveHandle(handle) {
  if (!handle?.queryPermission) return null;
  let state = await handle.queryPermission({ mode: 'read' });
  if (state === 'prompt') state = await handle.requestPermission({ mode: 'read' });
  return state === 'granted' ? handle : null;
}

/**
 * Bytes for the reader: from the linked file if there is one, otherwise from a
 * copy. Returns null when the document can no longer be reached, so the caller
 * can say the file moved rather than showing an empty page.
 */
export async function getBytes(id) {
  const owner = recoveryOwner(), generation = projectGeneration();
  // A file inside the project folder is named by its path relative to the
  // folder, in the project file itself, so the project still opens its papers
  // after the folder is moved, synced or copied to another machine.
  const paper = get().papers?.find(p => p.id === id);
  const preview = previewBytes(id);
  const verify = async bytes => {
    if (paper?.pdfHash && await documentHash(bytes) !== paper.pdfHash)
      throw new Error('The file changed since this document version was recorded. Reattach it as a new version.');
    if (generation !== projectGeneration()) throw new Error('The project changed while the attachment was being read.');
    return bytes;
  };
  if (preview) return verify(preview);
  const rel = paper?.pdfRel;
  const folder = activeFolder();
  if (rel && folder) {
    let bytes; try { bytes = await folder.read(rel); } catch { return null; } return verify(bytes);
  }
  // Online-only records must not probe old linked paths or request file access.
  if (paper && !paper.pdf) return null;
  const handle = paper?.pdfMode === 'copy' ? null : await getHandle(id, { owner });
  if (handle && paper && !paper.pdfHash) throw new Error('This linked attachment has no verified document version. Reattach the intended file.');
  // A desktop link is a path under a folder the user chose; the shell reads it.
  if (handle?.path) {
    let bytes; try { bytes = await readFileNative(handle.path); } catch { return null; } return verify(bytes);
  }
  if (handle) {
    const ok = await resolveHandle(handle);
    if (!ok) return null;
    try {
      const file = await ok.getFile();
      const bytes = new Uint8Array(await file.arrayBuffer());
      return verify(bytes);
    } catch { return null; }   // moved, renamed or deleted since it was linked
  }
  const blob = await getFile(id, { owner, expectedHash: paper?.pdfHash });
  if (!blob) return null;
  return verify(new Uint8Array(await blob.arrayBuffer()));
}

export const forget = async id => {
  const owner = recoveryOwner();
  await deleteFile(id, { owner }).catch(() => {});
  await deleteHandle(id, { owner }).catch(() => {});
};

/** What the app is actually holding, separated from what it merely points at. */
export async function usage() {
  const copied = await listFiles();
  const linked = await tx('readonly', s => s.getAllKeys(), HANDLES);
  let bytes = 0;
  for (const k of copied) {
    const blob = storedBlob(await tx('readonly', s => s.get(k)));
    if (blob) bytes += blob.size;
  }
  return { copied: copied.length, linked: linked.length, bytes };
}
