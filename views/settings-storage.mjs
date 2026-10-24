// Settings > Storage: what Lykos keeps on this machine (lib/storage-report.mjs), measured when the section is opened and after a change
// made here, never at start and never on a timer; Clear for each cache, and the limit on stored PDF previews (lib/cache-budget.mjs).
// Project data and backups are reported, never cleared here; backups of projects no longer kept here, and the paper download tool,
// are removed only from their row's More, after a confirmation that names the size.
import { formatBytes, limitOptions, previewLimit, setPreviewLimit } from '../lib/cache-budget.mjs';
import { plural } from '../lib/dates.mjs';
import { confirmAsk } from '../lib/dialog.mjs';
import { inDesktop } from '../lib/native.mjs';

// id, name, what a count is of (or a fixed detail). Kept short: the text column of a settings row is about 28 characters at 760.
const ROWS = [
  ['project', 'Project data', ''],
  ['backups', 'Backups', ''],
  ['orphans', 'Backups of removed projects', e => plural(e, 'file')],
  ['folderBackups', 'Folder backups', e => plural(e, 'copy', 'copies')],
  ['folderCache', 'Folder cache', e => plural(e, 'file')],
  ['previews', 'PDF previews', e => `Page text of ${plural(e, 'PDF')}`],
  ['fulltext', 'Full-text index', e => plural(e, 'PDF')],
  ['packages', 'R packages', e => plural(e, 'package')],
  ['models', 'Model catalog', e => plural(e, 'list')],
  ['paperbot', 'Paper download tool', 'Python environment'],
  ['other', 'Other', 'Web cache'],
];
const CLEAR = { previews: true, fulltext: true, packages: true, models: true, folderCache: true };
// Kept things that may go when the person says so: in the row's More, never a visible button.
const REMOVE = {
  orphans: r => ['Remove backups of removed projects?', `${formatBytes(r.bytes)} in ${plural(r.entries, 'file')}: copies of projects no longer kept in Lykos. They cannot be restored afterwards.`],
  paperbot: r => ['Remove the paper download tool?', `${formatBytes(r.bytes)}. Paper downloads through it stop until it is installed again.`],
};
// What is lost, said before it goes: only where clearing costs more than drawing a page again.
const ASK = {
  fulltext: r => ['Clear the full-text index?', `${formatBytes(r.bytes)} for ${plural(r.entries, 'PDF')}. Full-text search misses them until they are indexed again, as they are opened.`],
  packages: r => ['Clear R packages?', `${formatBytes(r.bytes)} of analysis packages. The next analysis downloads them again and needs an internet connection.`],
};

let measured = null;   // the measurement while the section stays open; forgotten when it closes, so opening it measures again

/** The rows, for the section's body. `srow` is Settings' row builder. */
export function storageBody(srow) {
  const live = id => ({ id: `storage-${id}` });
  return [
    ...ROWS.map(([id, name]) => srow(name, { desc: '', live: live(id), find: 'storage cache disk size backups',
      ...(CLEAR[id] ? { actions: [{ id: `storage-clear-${id}`, label: 'Clear', disabled: true }] }
        : REMOVE[id] ? { overflow: [{ id: `storage-remove-${id}`, label: 'Remove', danger: true }] } : { readout: true }) })),
    // In a tab only: whether the browser keeps it all (lib/storage-keep.mjs); Keep asks it to, and is disabled once it is.
    ...(inDesktop() ? [] : [srow('Browser storage', { desc: '', live: live('kept'), find: 'storage persist keep browser cleared evicted',
      actions: [{ id: 'storage-keep', label: 'Keep', disabled: true }] })]),
    // In a tab only: the project's daily safety copies (lib/browser-backups.mjs); Download latest saves one Import project… reads back.
    ...(inDesktop() ? [] : [srow('Safety copies', { desc: '', live: live('copies'), find: 'storage backup safety copy restore download',
      actions: [{ id: 'storage-copy-download', label: 'Download latest', icon: 'download', disabled: true }] })]),
    srow('Total', { readout: true, desc: '', live: live('total'), find: 'storage disk size' }),
    srow('PDF preview limit', { find: 'storage cache limit pdf previews least recently opened',
      filters: [{ type: 'select', id: 'storage-limit', label: 'PDF preview limit', options: limitOptions(), value: previewLimit() }] }),
  ].join('');
}

/** Measures and fills the rows when the section is open; forgets the measurement when it is not. */
export function wireStorage(el, open) {
  if (!open) { measured = null; return; }
  const rowText = (id, text) => { const out = el.querySelector(`#storage-${id}`); if (out && out.textContent !== text) out.textContent = text; };
  const paint = result => {
    if (!el.isConnected) return;
    for (const [id, , detail] of ROWS) {
      const r = result.rows[id], row = el.querySelector(`#storage-${id}`)?.closest('.ui-settings-row');
      if (row) row.hidden = !r;
      if (!r) continue;
      rowText(id, [formatBytes(r.bytes), typeof detail === 'function' ? (r.entries ? detail(r.entries) : 'None') : detail].filter(Boolean).join(', '));
      const clear = el.querySelector(`#storage-clear-${id}`);
      if (clear) clear.disabled = !r.bytes && !r.entries;
    }
    rowText('total', `${formatBytes(result.total)}${result.capped ? ' or more' : ''}`);
  };
  const measure = () => {
    if (!measured) { for (const [id] of ROWS) rowText(id, 'Measuring'); rowText('total', 'Measuring'); }
    measured ||= import('../lib/storage-report.mjs').then(m => m.measureStorage());
    measured.then(paint, err => rowText('total', `Not measured: ${err.message}`));
  };
  for (const id of Object.keys(REMOVE)) {
    const button = el.querySelector(`#storage-remove-${id}`); if (!button) continue;
    button.onclick = async () => {
      const row = (await measured)?.rows[id]; if (!row) return;
      const [title, detail] = REMOVE[id](row);
      if (!await confirmAsk(title, { detail, confirm: 'Remove', danger: true })) return;
      rowText(id, 'Removing');
      try { await (await import('../lib/storage-report.mjs')).removeStored(id); }
      catch (err) { rowText(id, `Not removed: ${err.message}`); return; }
      measured = null; measure();
    };
  }
  for (const id of Object.keys(CLEAR)) {
    const button = el.querySelector(`#storage-clear-${id}`); if (!button) continue;
    button.onclick = async () => {
      const row = (await measured)?.rows[id];
      if (ASK[id] && row) { const [title, detail] = ASK[id](row); if (!await confirmAsk(title, { detail, confirm: 'Clear', danger: true })) return; }
      button.disabled = true; rowText(id, 'Clearing');
      try { await (await import('../lib/storage-report.mjs')).clearCache(id); }
      catch (err) { rowText(id, `Not cleared: ${err.message}`); return; }
      measured = null; measure();
    };
  }
  const keep = el.querySelector('#storage-keep');
  if (keep) {
    const KEPT = { true: 'Kept', false: 'The browser may clear it', null: 'Not reported by this browser' };
    const show = kept => { rowText('kept', KEPT[kept]); keep.disabled = kept !== false; };
    import('../lib/storage-keep.mjs').then(m => m.storageKept()).then(show, () => show(null));
    keep.onclick = async () => { keep.disabled = true; show(await (await import('../lib/storage-keep.mjs')).keepStorage()); };
  }
  const download = el.querySelector('#storage-copy-download');
  if (download) {
    const copiesOf = async () => { const [b, p] = await Promise.all([import('../lib/browser-backups.mjs'), import('../lib/projects.mjs')]); return { b, p, list: p.isNone() || !b.canKeepCopies() ? [] : await b.listCopies(p.currentId()) }; };
    copiesOf().then(({ list }) => { rowText('copies', list.length ? `${plural(list.length, 'copy', 'copies')}, latest ${list[0].day}` : 'None yet'); download.disabled = !list.length; },
      err => rowText('copies', `Not read: ${err.message}`));
    download.onclick = async () => {
      const { b, list } = await copiesOf(); if (!list.length) return;
      const blob = await b.copyBlob(list[0].key);
      if (blob) await (await import('../lib/save.mjs')).saveFile(blob, list[0].file, 'application/gzip');
    };
  }
  const limit = el.querySelector('#storage-limit');
  if (limit) limit.onchange = async () => {
    setPreviewLimit(limit.value);
    await (await import('../lib/files.mjs')).trimDocText().catch(() => 0);
    measured = null; measure();
  };
  measure();
}
