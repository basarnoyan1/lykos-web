// A project folder's backups after the retention rule (lib/backup-rule.mjs), once a session after a save (lib/projects.mjs folderBackend).
import { keepBackups, compressible } from './backup-rule.mjs';
import { lib_fsys$join as join } from "../boot.mjs";
import { lib_gzip$gzipText as gzipText, lib_gzip$gunzipBlob as gunzipBlob, lib_gzip$textOf as textOf } from "../boot.mjs";
const decode = bytes => new TextDecoder().decode(bytes);

/**
 * The folder's backups after the retention rule (lib/backup-rule.mjs): copies the rule drops are removed, and kept plain
 * copies are compressed once (the compressed file is written and read back whole before the plain one goes). A folder that
 * cannot remove a file (no `removeBackup`) is left as it is. Answers `{ removed, compressed }`.
 */
export async function tidyBackups(f, day = new Date().toISOString().slice(0, 10)) {
  if (!f.removeBackup) return { removed: 0, compressed: 0 };
  const dir = join('.lykos', 'backups');
  let entries;
  try { entries = await f.list(dir); } catch { return { removed: 0, compressed: 0 }; }
  const names = entries.filter(e => !e.dir).map(e => e.name);
  const { keep, drop } = keepBackups(names, day);
  let removed = 0, compressed = 0;
  for (const n of drop) { try { await f.removeBackup(join(dir, n)); removed++; } catch {} }
  const present = new Set(names);
  for (const n of keep) {
    if (!compressible(n) || !f.writeBytes) continue;
    try {
      const text = decode(await f.read(join(dir, n)));
      // A compressed twin already there (a tidy stopped half way) is checked, not written again.
      if (!present.has(`${n}.gz`)) {
        const blob = await gzipText(text);
        if (await gunzipBlob(blob) !== text) continue;
        await f.writeBytes(join(dir, `${n}.gz`), new Uint8Array(await blob.arrayBuffer()));
      }
      if (await textOf(await f.read(join(dir, `${n}.gz`))) !== text) continue;
      await f.removeBackup(join(dir, n)); compressed++;
    } catch {}
  }
  return { removed, compressed };
}
