// How a folder page lists its entries: the order, the kind filter, the name filter, and what a person last chose.
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
export const SORTS = ['name', 'type', 'size', 'modified'];
export const KINDS = ['all', 'word', 'pdf', 'sheet', 'text', 'image', 'folder'];
export const folderDefaults = { view: 'list', sort: 'name', descending: false, kind: 'all', group: true, foldersFirst: true };
export function folderPreferences(value = {}) {
  return { view: value?.view === 'grid' ? 'grid' : 'list',
    sort: SORTS.includes(value?.sort) ? value.sort : 'name',
    descending: value?.descending === true,
    kind: KINDS.includes(value?.kind) ? value.kind : 'all',
    group: value?.group !== false,
    foldersFirst: value?.foldersFirst !== false };
}
export const extension = name => name.includes('.') ? name.slice(name.lastIndexOf('.') + 1).toLowerCase() : '';
export function sortFolderEntries(entries, { sort = 'name', descending = false, foldersFirst = true } = folderDefaults) {
  const direction = descending ? -1 : 1;
  return [...entries].sort((a, b) => {
    if (foldersFirst && Boolean(a.dir) !== Boolean(b.dir)) return a.dir ? -1 : 1;
    let order = 0;
    if (sort === 'size') order = (a.size || 0) - (b.size || 0);
    else if (sort === 'modified') order = (a.mtime || 0) - (b.mtime || 0);
    else if (sort === 'type') order = collator.compare(extension(a.name), extension(b.name));
    else order = collator.compare(a.name, b.name);
    return direction * (order || collator.compare(a.name, b.name));
  });
}

/** The kind of an entry as the Kind filter names it. */
export function kindOfEntry(entry) {
  if (entry?.dir) return 'folder';
  const x = extension(entry?.name || '');
  if (['docx', 'doc', 'odt', 'rtf'].includes(x)) return 'word';
  if (x === 'pdf') return 'pdf';
  if (['xlsx', 'xls', 'csv', 'tsv'].includes(x)) return 'sheet';
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'avif', 'tif', 'tiff'].includes(x)) return 'image';
  if (['txt', 'md', 'markdown', 'json', 'r', 'py', 'log', 'yaml', 'yml', 'xml', 'tex'].includes(x)) return 'text';
  return 'other';
}

/** The entries a Kind and a name filter leave. The query is a case-insensitive part of the name. */
export function filterFolderEntries(entries, { kind = 'all', query = '' } = {}) {
  const q = String(query || '').trim().toLowerCase();
  return entries.filter(e => (kind === 'all' || kindOfEntry(e) === kind) && (!q || String(e.name).toLowerCase().includes(q)));
}

/** The one sort control: a choice that carries its direction, and back. */
export const SORT_CHOICES = [
  ['name:asc', 'Name, A to Z'], ['name:desc', 'Name, Z to A'], ['modified:desc', 'Newest first'], ['modified:asc', 'Oldest first'],
  ['size:desc', 'Largest first'], ['size:asc', 'Smallest first'], ['type:asc', 'Kind'],
];
export const sortChoice = ({ sort = 'name', descending = false } = {}) => {
  const exact = `${sort}:${descending ? 'desc' : 'asc'}`;
  return SORT_CHOICES.some(([v]) => v === exact) ? exact : SORT_CHOICES.find(([v]) => v.startsWith(`${sort}:`))?.[0] || 'name:asc';
};
export function applySortChoice(preferences, value) {
  const [sort, direction] = String(value).split(':');
  return SORTS.includes(sort) ? { ...preferences, sort, descending: direction === 'desc' } : preferences;
}

/** What pressing a column header does: the same column turns the direction round; another starts at its natural direction (names and kinds A to Z, dates and sizes largest first). */
export function sortByColumn(preferences, column) {
  if (!SORTS.includes(column)) return preferences;
  if (preferences.sort === column) return { ...preferences, descending: !preferences.descending };
  return { ...preferences, sort: column, descending: column === 'modified' || column === 'size' };
}

/** A folder's own sort, remembered per folder (`{ [rel]: { sort, descending } }`, the most recent `max` folders); malformed input gives {}. */
export function folderSorts(value, max = 200) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const out = {};
  for (const [rel, s] of Object.entries(value).slice(-max)) if (s && SORTS.includes(s.sort)) out[rel] = { sort: s.sort, descending: s.descending === true };
  return out;
}
export function rememberSort(sorts, rel, { sort, descending }, max = 200) {
  const next = { ...folderSorts(sorts, max) };
  delete next[rel]; next[rel] = { sort, descending: !!descending };
  const keys = Object.keys(next);
  for (const k of keys.slice(0, Math.max(0, keys.length - max))) delete next[k];
  return next;
}

// ---- a file name in a tile: two lines at most, broken only where a person would break it, the extension always whole ----

const EXT_MAX = 8;
/** The places a name may break: after a space, '_', '-' or '.', never inside the extension and never just before it ('v1.docx' stays together). */
export function nameSegments(name) {
  const s = String(name ?? '');
  const dot = s.lastIndexOf('.');
  const ext = dot > 0 && dot < s.length - 1 && s.length - dot <= EXT_MAX ? s.slice(dot) : '';
  const stem = ext ? s.slice(0, -ext.length) : s;
  const parts = stem.match(/[^ _\-.…]*(?:[ _\-.…]+|$)/g).filter(Boolean);
  if (!parts.length) return [s];
  while (parts.length > 1 && /^[ _\-.…]+$/.test(parts[0])) parts.splice(0, 2, parts[0] + parts[1]);   // a leading dot ('.gitignore') is not a break
  parts[parts.length - 1] += ext;
  return parts;
}
/** How many lines the segments take at `width` (a segment wider than a line breaks inside itself, as overflow-wrap: break-word does). */
export function lineCount(segments, width, measure) {
  let lines = 1, used = 0;
  for (const seg of segments) {
    const w = measure(seg);
    if (used && used + w > width) { lines++; used = 0; }
    if (w > width) { lines += Math.ceil(w / width) - 1; used = w % width; } else used += w;
  }
  return lines;
}
/**
 * The name as a tile shows it: whole when it fits `lines` lines of `width`, else shortened in the middle ("IJSS_Perspective_R…ision_Plan.docx"),
 * the extension and the end of the stem kept. `measure(text)` gives a width. Returns { text, segments, cut }.
 */
export function fitName(name, { width, lines = 2, measure }) {
  const s = String(name ?? '');
  const whole = nameSegments(s);
  if (!width || !measure || lineCount(whole, width, measure) <= lines) return { text: s, segments: whole, cut: false };
  const ext = whole.at(-1).match(/\.[^.]{1,7}$/)?.[0] || '';
  const stem = ext ? s.slice(0, -ext.length) : s;
  const make = n => { const a = Math.ceil(n * 0.6), b = n - a; return `${stem.slice(0, a)}…${b ? stem.slice(stem.length - b) : ''}${ext}`; };
  let lo = 0, hi = stem.length - 1;
  while (lo < hi) { const mid = Math.ceil((lo + hi) / 2); if (lineCount(nameSegments(make(mid)), width, measure) <= lines) lo = mid; else hi = mid - 1; }
  const text = make(lo);
  return { text, segments: nameSegments(text), cut: true };
}
