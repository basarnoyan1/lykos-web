// A Google Drive folder as a project folder (plan §2, "Working as a team"): the same contract as the desktop's path folder and the
// browser's directory handle (lib/fsys.mjs), over the Drive v3 REST API, so the store, backups, figures and sidecars work unchanged.
// Paths are resolved name by name from the shared folder and cached. commitText compares the SHA-256 of the copy on Drive with the
// one this window read before it writes; Drive has no atomic compare-and-write, so two saves in the same moment can still both
// land, and Drive keeps each as a revision of the file.
import { documentHash } from './files.mjs';
import { parentOf, baseName, backupCopy } from './fsys.mjs';

const API = 'https://www.googleapis.com/drive/v3', UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
const FOLDER = 'application/vnd.google-apps.folder';
const FIELDS = 'id,name,mimeType,size,modifiedTime,md5Checksum';
const ALL = 'supportsAllDrives=true';

/** A Drive folder's id from its link ("…/folders/<id>?usp=sharing") or the bare id. */
export function driveFolderId(link) {
  const s = String(link || '').trim();
  const m = s.match(/\/folders\/([\w-]{10,})/) || s.match(/[?&]id=([\w-]{10,})/) || s.match(/^([\w-]{10,})$/);
  return m ? m[1] : '';
}

const quote = s => `'${String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
const notFound = rel => Object.assign(new Error(`${rel} is not in the Drive folder`), { name: 'NotFoundError' });

/**
 * A folder object for Drive folder `rootId`. `token()` answers an access token (lib/google-auth.mjs accessToken);
 * `fetch` is injectable for tests. `access()` answers { name, canEdit } of the folder for the person signed in.
 */
export function driveFolder({ rootId, name = 'Drive folder', token, fetch: http = globalThis.fetch.bind(globalThis) }) {
  const ids = new Map([['', { id: rootId, dir: true }]]);   // rel → { id, dir }
  const known = new Map();   // rel → { md5, hash } of the last copy this window read or wrote

  async function call(url, init = {}, tries = 0) {
    const r = await http(url, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${await token()}` } });
    if ((r.status === 429 || r.status >= 500) && tries < 3) {
      await new Promise(res => setTimeout(res, 400 * 2 ** tries));
      return call(url, init, tries + 1);
    }
    if (r.status === 404) return null;
    if (!r.ok) {
      let why = '';
      try { why = (await r.json())?.error?.message || ''; } catch {}
      throw Object.assign(new Error(`Google Drive: ${why || r.status}`), { status: r.status });
    }
    return r;
  }
  const json = async (url, init) => { const r = await call(url, init); return r ? r.json() : null; };

  async function child(parentId, nm) {
    const q = `${quote(parentId)} in parents and name = ${quote(nm)} and trashed = false`;
    const out = await json(`${API}/files?q=${encodeURIComponent(q)}&fields=files(${FIELDS})&orderBy=modifiedTime desc&pageSize=10&${ALL}&includeItemsFromAllDrives=true`);
    return out?.files?.[0] || null;
  }
  async function meta(rel) {
    if (!rel) return json(`${API}/files/${rootId}?fields=${FIELDS}&${ALL}`);
    const parent = await resolve(parentOf(rel));
    if (!parent?.dir) return null;
    const f = await child(parent.id, baseName(rel));
    if (f) ids.set(rel, { id: f.id, dir: f.mimeType === FOLDER }); else ids.delete(rel);
    return f;
  }
  async function resolve(rel) {
    if (ids.has(rel)) return ids.get(rel);
    const f = await meta(rel);
    return f ? ids.get(rel) : null;
  }
  async function ensureDir(rel) {
    const hit = await resolve(rel);
    if (hit) { if (!hit.dir) throw new Error(`${rel} is a file`); return hit.id; }
    const parentId = await ensureDir(parentOf(rel));
    const f = await json(`${API}/files?fields=${FIELDS}&${ALL}`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: baseName(rel), mimeType: FOLDER, parents: [parentId] }) });
    ids.set(rel, { id: f.id, dir: true });
    return f.id;
  }
  async function upload(rel, bytes, { create = false } = {}) {
    const hit = await resolve(rel);
    if (hit?.dir) throw new Error(`${rel} is a folder`);
    if (hit && create) throw new Error('a file with that name exists');
    let f;
    if (hit) f = await json(`${UPLOAD}/files/${hit.id}?uploadType=media&fields=${FIELDS}&${ALL}`, { method: 'PATCH', body: bytes });
    else {
      const parentId = await ensureDir(parentOf(rel)), boundary = `lykos${crypto.randomUUID()}`;
      const head = new TextEncoder().encode(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify({ name: baseName(rel), parents: [parentId] })}\r\n--${boundary}\r\nContent-Type: application/octet-stream\r\n\r\n`);
      const tail = new TextEncoder().encode(`\r\n--${boundary}--`);
      const body = new Uint8Array(head.length + bytes.length + tail.length);
      body.set(head); body.set(bytes, head.length); body.set(tail, head.length + bytes.length);
      f = await json(`${UPLOAD}/files?uploadType=multipart&fields=${FIELDS}&${ALL}`, { method: 'POST', headers: { 'Content-Type': `multipart/related; boundary=${boundary}` }, body });
    }
    if (!f) throw notFound(rel);
    ids.set(rel, { id: f.id, dir: false });
    known.set(rel, { md5: f.md5Checksum, hash: await documentHash(bytes) });
    return Date.parse(f.modifiedTime) || Date.now();
  }
  async function read(rel) {
    const hit = await resolve(rel);
    if (!hit || hit.dir) throw notFound(rel);
    const r = await call(`${API}/files/${hit.id}?alt=media&${ALL}`);
    if (!r) { ids.delete(rel); throw notFound(rel); }
    return new Uint8Array(await r.arrayBuffer());
  }
  // The hash of the copy on Drive: read again only when Drive's checksum says it is not the copy this window last saw.
  async function currentHash(rel, f) {
    const k = known.get(rel);
    if (k && f.md5Checksum && k.md5 === f.md5Checksum) return k.hash;
    const bytes = await read(rel), hash = await documentHash(bytes);
    known.set(rel, { md5: f.md5Checksum, hash });
    return hash;
  }

  return {
    kind: 'drive', root: rootId, name,
    can: { rename: true, renameDir: true },
    abs: rel => rel,
    async access() {
      const f = await json(`${API}/files/${rootId}?fields=name,mimeType,capabilities(canEdit,canAddChildren)&${ALL}`);
      if (!f || f.mimeType !== FOLDER) throw new Error('That link is not a Google Drive folder you can open');
      return { name: f.name, canEdit: !!(f.capabilities?.canEdit && f.capabilities?.canAddChildren) };
    },
    async list(rel = '') {
      const hit = await resolve(rel);
      if (!hit?.dir) throw notFound(rel || 'The folder');
      const out = [];
      let page = '';
      do {
        const q = `${quote(hit.id)} in parents and trashed = false`;
        const res = await json(`${API}/files?q=${encodeURIComponent(q)}&fields=nextPageToken,files(${FIELDS})&pageSize=1000&${ALL}&includeItemsFromAllDrives=true${page ? `&pageToken=${page}` : ''}`);
        for (const f of res?.files || []) {
          const r = rel ? `${rel}/${f.name}` : f.name, dir = f.mimeType === FOLDER;
          if (f.mimeType?.startsWith('application/vnd.google-apps.') && !dir) continue;   // a Google Doc has no bytes to read
          ids.set(r, { id: f.id, dir });
          out.push({ name: f.name, dir, size: +f.size || 0, mtime: Date.parse(f.modifiedTime) || 0, rel: r });
        }
        page = res?.nextPageToken || '';
      } while (page);
      return out;
    },
    read,
    async stat(rel) {
      const f = await meta(rel);
      return f ? { exists: true, dir: f.mimeType === FOLDER, size: +f.size || 0, mtime: Date.parse(f.modifiedTime) || 0 } : { exists: false, dir: false, size: 0, mtime: 0 };
    },
    writeText: (rel, text) => upload(rel, new TextEncoder().encode(String(text))),
    writeBytes: (rel, bytes) => upload(rel, bytes, { create: true }),
    replaceBytes: (rel, bytes) => upload(rel, bytes),
    async commitText(rel, text, expectedHash) {
      const f = await meta(rel);
      if (f ? !expectedHash || await currentHash(rel, f) !== expectedHash : !!expectedHash) return { stale: true };
      const bytes = new TextEncoder().encode(String(text));
      const mtime = await upload(rel, bytes);
      return { stale: false, mtime, hash: known.get(rel).hash };
    },
    async mkdir(rel) { await ensureDir(rel); },
    async rename(from, to) {
      const hit = await resolve(from);
      if (!hit) throw notFound(from);
      const oldParent = await resolve(parentOf(from)), newParent = await ensureDir(parentOf(to));
      const move = oldParent.id !== newParent ? `&addParents=${newParent}&removeParents=${oldParent.id}` : '';
      await json(`${API}/files/${hit.id}?fields=id&${ALL}${move}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: baseName(to) }) });
      for (const k of [...ids.keys()]) if (k === from || k.startsWith(`${from}/`)) ids.delete(k);
      known.delete(from);
    },
    // Only Lykos's own daily copies are ever removed, and to Drive's bin, where they stay for 30 days.
    async removeBackup(rel) {
      if (!backupCopy(rel)) throw new Error('only backups are removed');
      const hit = await resolve(rel);
      if (hit) await json(`${API}/files/${hit.id}?fields=id&${ALL}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ trashed: true }) });
      ids.delete(rel);
    },
    async clearCache() { for (const k of [...ids.keys()]) if (k) ids.delete(k); known.clear(); },
  };
}
