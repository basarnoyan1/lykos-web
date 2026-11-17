// The copy a restore keeps of a folder file before it writes over it (work queue row 39, 16 Nov 2026; the same rule as the MCP replace's
// keepOld, tools/mcp/writes.mjs, row 29). Since 14 Nov 2026 the history records a folder file by its hash only and reads an earlier version
// only from a folder file that holds it (storage design F3), so the "Before restoring" commit alone keeps no bytes of the file the restore
// overwrites. The bytes go to a copy under the archive root ("Old versions/" or "Archive/" at the top, the file's own path below it, " (2)"
// when the name is taken); an archived copy of the same name holding those bytes serves instead. Loaded by a restore only (lib/vcs.mjs).
const ARCHIVE_ROOT = /^(old[ _-]?versions?|archives?)$/i;
const split = rel => { const i = rel.lastIndexOf('/'), base = rel.slice(i + 1), dot = base.lastIndexOf('.'); return { dir: i < 0 ? '' : rel.slice(0, i), stem: dot > 0 ? base.slice(0, dot) : base, ext: dot > 0 ? base.slice(dot) : '' }; };

/**
 * Keeps `bytes` (the file `rel` as it is) as a copy and answers its path. `avoid` is the set of paths the restore itself may write (the
 * target commit's files): a copy never takes or reuses one of them, so the restore cannot write over what it kept. A folder on the way that
 * is a link (the Node folder's listing leaves links out; the shell's lists them as files, which is no folder) is refused: nothing is written through it.
 */
export async function keepFile({ folder, ensureDir, hash, rel, bytes, avoid }) {
  const h = await hash(bytes), top = await folder.list('');
  const root = top.find(e => e.dir && ARCHIVE_ROOT.test(e.name))?.name || 'Archive';
  const { dir, stem, ext } = split(`${root}/${rel}`);
  // every part of the copy's folder that exists is a real folder of the project, not a link out of it
  let at = '';
  for (const part of dir.split('/')) {
    const parent = at; at = at ? `${at}/${part}` : part;
    if (!(await folder.stat(at).catch(() => null))?.exists) break;
    const seen = (await folder.list(parent)).find(e => e.name.toLowerCase() === part.toLowerCase());
    if (!seen?.dir) throw new Error(`${at} is a link, not a folder of the project; nothing was restored`);
  }
  const here = (await folder.stat(dir).catch(() => null))?.exists ? await folder.list(dir) : [];
  for (const e of here) {
    const p = `${dir}/${e.name}`, s = split(p);
    if (e.dir || avoid.has(p) || s.ext !== ext || !e.name.startsWith(stem) || e.size !== bytes.length) continue;
    try { if (await hash(await folder.read(p)) === h) return { copy: p, h }; } catch { /* moved since the listing */ }
  }
  const taken = new Set(here.map(e => e.name.toLowerCase())), avoided = new Set([...avoid].map(x => x.toLowerCase()));   // a volume may fold case
  for (let i = 1; i < 1000; i++) {
    const name = i === 1 ? `${stem}${ext}` : `${stem} (${i})${ext}`, p = `${dir}/${name}`;
    if (taken.has(name.toLowerCase()) || avoided.has(p.toLowerCase())) continue;
    await ensureDir(dir);
    await folder.writeBytes(p, bytes);   // never over a name that is there
    return { copy: p, h };
  }
  throw new Error(`Too many archived copies of ${rel}; nothing was restored`);
}
