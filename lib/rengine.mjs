// Browser-side R engine: boots vendored WebR and installs R packages from the
// vendored, hash-pinned tarballs instead of reaching for repo.r-wasm.org.
//
// bench/lib/engine.mjs does this in Node by mounting NODEFS, which browsers do
// not have. Here the tarballs are fetched from the local server and written
// into the WebR filesystem, then unpacked the same way. Plan I7's frozen
// environment has to hold in the browser too -- that is where the app runs.
import { appUrl } from './app-url.mjs';
export async function startR(onProgress = () => {}) {
  onProgress('Starting R');
  const { WebR } = await import(appUrl('webr/webr.js'));
  const webR = new WebR({ baseUrl: appUrl('webr/') });
  await webR.init();
  return webR;
}

/**
 * Fetches a package tarball and checks it against the hash in the lockfile.
 *
 * The tarballs are not shipped with the app — most sessions never run an
 * analysis, and carrying 60 MB for the ones that do made the download eight
 * times larger than it needed to be. Verifying the hash on arrival is the same
 * guarantee bundling gave: a tarball that does not match is refused, not used
 * and quietly wrong (plan 4.4, I7).
 */
// Whether this build carries the tarballs is one fact, written into the
// build's copy of the lockfile (`bundled`, app/build.mjs --with-packages).
// Probing /r-packages/ instead cost a 404 on every first Run of a session,
// which the console reports as an error.
export async function fetchPackage(meta, name, { bundled = false } = {}) {
  const file = meta.url.split('/').pop();
  const key = `${file}:${meta.sha256}`;
  const verify = async bytes => {
    if (bytes.length !== meta.bytes) throw new Error(`${name}: size ${bytes.length} != ${meta.bytes}`);
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    const hex = [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
    if (hex !== meta.sha256) throw new Error(`${name}: hash mismatch — refusing to install`);
    return bytes;
  };

  if (bundled) {
    const local = await fetch(appUrl(`r-packages/${file}`)).catch(() => null);
    if (local?.ok) return verify(new Uint8Array(await local.arrayBuffer()));
  }

  // Caching is optional. Every cached byte is verified, including migration
  // from the former filename-only keys. Corruption never reaches the runtime.
  for (const cacheKey of [key, file]) {
    const cached = await cacheGet(cacheKey).catch(() => null);
    if (cached) {
      // A migrated copy leaves its filename key: two copies of every package was 37 MB of the 73 MB this cache held (2026-10-11).
      try { await verify(cached); if (cacheKey !== key) { await cachePut(key, cached).catch(() => {}); await cacheOp('readwrite', s => s.delete(cacheKey)).catch(() => {}); } return cached; }
      catch { await cacheOp('readwrite', s => s.delete(cacheKey)).catch(() => {}); }
    }
  }

  // The verified bytes are kept here; the web view's own HTTP cache would keep a second copy (27 MB of it, measured 2026-10-11).
  const res = await fetch(meta.url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`${name}: HTTP ${res.status}`);
  const bytes = new Uint8Array(await res.arrayBuffer());

  await verify(bytes);
  await cachePut(key, bytes).catch(() => {});
  return bytes;
}

// A small IndexedDB cache, so the packages are fetched once per machine.
const CACHE_DB = 'lykos-rpkgs';
let cacheDb = null;
function openCache() {
  if (cacheDb) return cacheDb;
  const opening = cacheDb = new Promise((resolve, reject) => {
    const req = indexedDB.open(CACHE_DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore('tarballs');
    req.onsuccess = () => { req.result.onclose = () => { if (cacheDb === opening) cacheDb = null; }; resolve(req.result); };
    req.onerror = () => reject(req.error);
  });
  opening.catch(() => { if (cacheDb === opening) cacheDb = null; });
  return cacheDb;
}
const cacheOp = (mode, fn) => openCache().then(db => new Promise((resolve, reject) => {
  const t = db.transaction('tarballs', mode);
  const r = fn(t.objectStore('tarballs'));
  t.oncomplete = () => resolve(r?.result);
  t.onerror = () => reject(t.error);
  t.onabort = () => reject(t.error || new Error('Package cache transaction aborted'));
}));
const cacheGet = async k => { const v = await cacheOp('readonly', s2 => s2.get(k)); return v ? new Uint8Array(v) : null; };
const cachePut = (k, bytes) => cacheOp('readwrite', s2 => s2.put(bytes, k));
const cacheKeys = () => cacheOp('readonly', s2 => s2.getAllKeys());
/** The keys the current lockfile names ("file:sha256"); any other key is an older version or a filename-only copy. */
const lockKeys = lock => new Set(Object.values(lock?.rPackages || {}).map(m => `${m.url.split('/').pop()}:${m.sha256}`));
let pruned = false;
/** Lets go of packages no current lockfile names, once a session, when R loads packages (the moment the cache is written). */
async function prunePackages(lock) {
  if (pruned) return; pruned = true;
  const want = lockKeys(lock), stale = (await cacheKeys()).filter(k => !want.has(k));
  if (stale.length) await cacheOp('readwrite', s2 => { stale.forEach(k => s2.delete(k)); });
}
/** The kept packages: their bytes (from the lockfile, no tarball read) and how many. */
export async function packageCacheUsage(lock) {
  const sizes = new Map(Object.values(lock?.rPackages || {}).flatMap(m => { const file = m.url.split('/').pop(); return [[`${file}:${m.sha256}`, m.bytes], [file, m.bytes]]; }));
  const keys = await cacheKeys().catch(() => []);
  return { bytes: keys.reduce((n, k) => n + (sizes.get(k) || 0), 0), entries: keys.length };
}
/** Forgets every kept package; the next analysis fetches and checks them again. */
export async function clearPackageCache() { const keys = await cacheKeys(); await cacheOp('readwrite', s2 => { keys.forEach(k => s2.delete(k)); }); return keys.length; }

export async function installVendored(webR, pkgs, onProgress = () => {}) {
  const lock = await (await fetch(appUrl('vendor.lock.json'))).json();
  const need = new Set();
  for (const p of pkgs) {
    const closure = lock.targets?.[p];
    if (!closure) throw new Error(`no closure for "${p}" in vendor.lock.json`);
    closure.forEach(d => need.add(d));
  }
  const bufs = new Map();
  let i = 0;
  for (const name of need) {
    const meta = lock.rPackages[name];
    onProgress(`Loading ${++i} / ${need.size}`);
    const buf = await fetchPackage(meta, name, { bundled: lock.bundled === true });
    if (buf.length !== meta.bytes) throw new Error(`${name}: size ${buf.length} != ${meta.bytes}`);
    bufs.set(name, { buf, file: meta.url.split('/').pop() });
  }
  prunePackages(lock).catch(() => {});
  onProgress('Unpacking');
  const [lib, ...have] = (await webR.evalRString('paste(c(.libPaths()[1], rownames(installed.packages())), collapse="\\n")')).split('\n');
  // Mounted, not unpacked: each tarball is decompressed once and mounted read-only (WORKERFS), R reading a file from it when it opens it, so no
  // file is copied into R one by one (each a message to R's worker: the slow part of a first Run, above all where the page is not cross-origin
  // isolated). A package the mount cannot hold is unpacked as before.
  let todo = [...bufs].filter(([name]) => !have.includes(name));
  if (todo.length) {
    try { const left = await mountPackages(webR, todo.map(([name, { buf }]) => ({ name, gz: buf }))); todo = todo.filter(([name]) => left.includes(name)); }
    catch { /* every one unpacked below */ }
  }
  // The tarballs are unpacked here, in JavaScript, rather than by R's
  // untar(tar = "internal"): in the WebAssembly build R's reader took about
  // 4.9 s of a 7.8 s first Run for these 19 packages (measured, evidence
  // review 2026-09-28). A package this reader cannot unpack falls back to R.
  const viaR = [];
  for (const [name, { buf, file }] of todo) {
    try { await untarInto(webR, buf, lib); }
    catch { viaR.push(file); try { await webR.FS.mkdir('/vendor'); } catch {} await webR.FS.writeFile(`/vendor/${file}`, buf); }
  }
  const list = viaR.map(f => `"${f}"`).join(',');
  const want = pkgs.map(p => `"${p}"`).join(',');
  const res = await webR.evalRString(`
    paste(as.character(tryCatch({
      lib <- .libPaths()[1]
      for (f in c(${list || 'character(0)'})) untar(file.path("/vendor", f), exdir=lib, tar="internal")
      missing <- setdiff(c(${want}), rownames(installed.packages()))
      if (length(missing)) paste("MISSING:", paste(missing, collapse=",")) else "ok"
    }, error=function(e) paste("ERROR:", conditionMessage(e)))), collapse=" ")`);
  if (res !== 'ok') throw new Error(res);
}

let mounts = 0;
/**
 * Mounts gzipped tars (R binary packages) read-only, each a WORKERFS at a new library path put first on .libPaths(): each tar is decompressed
 * once and its files are slices of it (tarMetadata), so nothing is written into R file by file. Returns the names of the packages it could not
 * mount (a tar holding a link), which the caller unpacks.
 */
export async function mountPackages(webR, pkgs) {
  const packages = [], left = [];
  for (const { name, gz } of pkgs) {
    const tar = await gunzip(gz);
    try { packages.push({ blob: new Blob([tar]), metadata: tarMetadata(tar) }); } catch { left.push(name); }   // a link: unpacked instead
  }
  // one mount a package (one WORKERFS holding several failed with EBUSY in WebR 0.6), each its own library path, put first in one call
  const at = [];
  for (const pkg of packages) {
    const dir = `/vlib${++mounts}`;
    await webR.FS.mkdir(dir);
    await webR.FS.mount('WORKERFS', { packages: [pkg] }, dir);
    at.push(dir);
  }
  if (at.length) await webR.evalRVoid(`.libPaths(c(${at.map(d => `"${d}"`).join(', ')}, .libPaths()))`);
  return left;
}
/** A tar's files as a WORKERFS package index: `{ files: [{ filename: '/metafor/DESCRIPTION', start, end }] }` (offsets into the tar). Pure. */
export function tarMetadata(tar) {
  const files = [];
  for (const e of tarEntries(tar)) {
    if (e.type === 'dir') continue;
    files.push({ filename: `/${e.name}`.replace(/\/+/g, '/'), start: e.at, end: e.at + e.data.length });
  }
  return { files, remote_package_size: tar.length };
}

/**
 * Unpacks a gzipped tar (an R binary package) into the WebR filesystem under
 * `root`. Handles ustar prefixes, GNU long names and pax path records; any
 * other entry type (a link, a device) throws, and the caller lets R unpack
 * that package instead. Exported for tests.
 */
export async function untarInto(webR, gz, root) {
  const tar = await gunzip(gz);
  const entries = tarEntries(tar);
  const made = new Set();
  const mkdirp = async dir => {
    let cur = '';
    for (const part of dir.split('/').filter(Boolean)) {
      cur += `/${part}`;
      if (made.has(cur)) continue;
      try { await webR.FS.mkdir(cur); } catch { /* exists */ }
      made.add(cur);
    }
  };
  for (const e of entries) {
    const path = `${root}/${e.name}`.replace(/\/+/g, '/').replace(/\/$/, '');
    if (e.type === 'dir') await mkdirp(path);
    else { await mkdirp(path.slice(0, path.lastIndexOf('/'))); await webR.FS.writeFile(path, e.data); }
  }
  return entries.length;
}

async function gunzip(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** The entries of an uncompressed tar: `{ name, type: 'file' | 'dir', data, at }` (`at` a file's offset in the tar). Pure. */
export function tarEntries(tar) {
  const text = new TextDecoder();
  const field = (h, a, b) => text.decode(h.subarray(a, b)).replace(/\0[\s\S]*$/, '');
  const out = [];
  let off = 0, longName = null, paxPath = null;
  while (off + 512 <= tar.length) {
    const h = tar.subarray(off, off + 512);
    if (h.every(b => b === 0)) break;
    const size = parseInt(field(h, 124, 136).trim() || '0', 8);
    if (!Number.isFinite(size) || size < 0) throw new Error('tar: bad size');
    const flag = String.fromCharCode(h[156] || 48);
    const body = tar.subarray(off + 512, off + 512 + size), at = off + 512;
    off += 512 + Math.ceil(size / 512) * 512;
    if (flag === 'L') { longName = text.decode(body).replace(/\0[\s\S]*$/, ''); continue; }
    if (flag === 'x') { const m = /(?:^|\n)\d+ path=([^\n]*)\n/.exec(text.decode(body)); paxPath = m ? m[1] : null; continue; }
    if (flag === 'g') continue;
    let name = field(h, 0, 100);
    const prefix = field(h, 257, 263).startsWith('ustar') ? field(h, 345, 500) : '';
    if (prefix) name = `${prefix}/${name}`;
    if (longName) { name = longName; longName = null; }
    if (paxPath) { name = paxPath; paxPath = null; }
    name = name.replace(/^\.\//, '');
    if (!name || name.split('/').includes('..')) throw new Error(`tar: unsafe path ${name}`);
    if (flag === '5') out.push({ name, type: 'dir' });
    else if (flag === '0' || flag === '7') out.push({ name, type: 'file', data: body.slice(), at });
    else throw new Error(`tar: entry type ${flag} (${name})`);
  }
  return out;
}
