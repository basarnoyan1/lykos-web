// A file of Lykos's own in `.lykos` that may be stored gzip: the adoption record, `.lykos/adopted.json`, is `adopted.json.gz` once
// `lykos-compact --write` converted the folder (tools/side-files.mjs, work queue rows 33 and 42, step 1, 16 Nov 2026). It is read where it
// is, a plain one winning where both are there (a writer from before the conversion wrote it after), and written back in the form it was read.
const gz = rel => `${rel}.gz`;
const pipe = (bytes, stream) => new Response(new Blob([bytes]).stream().pipeThrough(stream)).arrayBuffer().then(b => new Uint8Array(b));
/** The bytes `bytes` (gzip) read to. */
export const gunzipBytes = bytes => pipe(bytes, new DecompressionStream('gzip'));
/** `text` as gzip bytes. */
export const gzipText = text => pipe(new TextEncoder().encode(String(text)), new CompressionStream('gzip'));
/** Where `rel` (its plain name) is stored in `folder`: `rel`, else `rel.gz`, else null. A folder of that name is not it. */
export async function sideAt(folder, rel) {
  for (const at of [rel, gz(rel)]) { const st = await folder.stat(at).catch(() => null); if (st?.exists && !st.dir) return at; }
  return null;
}
/** `{ at, raw, bytes }`: where `rel` is stored, its bytes as stored and as read (gunzipped); null when neither is there. */
export async function readSide(folder, rel) {
  const at = await sideAt(folder, rel);
  if (!at) return null;
  const raw = await folder.read(at);
  return { at, raw, bytes: at === rel ? raw : await gunzipBytes(raw) };
}
/** `text` written gzip at `rel` when what is stored there hashes to `expectedHash` (null: nothing there), else `{ stale: true }`, as
 *  lib/projects.mjs commitSidecar writes a plain record; `hash` is lib/files.mjs documentHash, `lock` projects.mjs withFolderCommit. Through
 *  the shell's PUT where the folder has its address (`fileUrl`, lib/fsys.mjs; main.rs compares and writes); else, or where an older shell
 *  refuses it, compared here. Kept out of projects.mjs and fsys.mjs: they load with the shell, and this only when a gzip record is written
 *  (app/test/startup-graph.test.mjs). */
export const commitGzip = (folder, rel, text, expectedHash, hash, lock = f => f()) => lock(async () => {
  const bytes = await gzipText(text);
  if (folder.fileUrl) {
    let r = null;
    try { r = await fetch(folder.fileUrl(rel), { method: 'PUT', body: bytes, headers: { 'Lykos-Expected': expectedHash || '' } }); } catch { /* no protocol */ }
    if (r?.ok) { const j = await r.json(); return j.stale ? { stale: true } : { ok: true, hash: j.hash || await hash(bytes) }; }
    if (r?.status === 500) throw new Error(await r.text());
  }
  const st = await folder.stat(rel);
  if (st.exists) {
    if (st.dir || !expectedHash || await hash(await folder.read(rel)) !== expectedHash) return { stale: true };
  } else if (expectedHash) return { stale: true };
  await (folder.replaceBytes || folder.writeBytes)(rel, bytes);
  return { ok: true, hash: await hash(bytes) };
});
