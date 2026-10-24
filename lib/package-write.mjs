// Building a part into the project folder (plan, package amendment). The folder keeps only the current version: the previous file is renamed to
// the new version's name and its content replaced (the folder API never deletes); the version is in the name because the file is sent to people
// who do not see History. What is kept per version is what changed: a record with the part as built and the History commit its sources were
// read at, from which an earlier version is rebuilt. History keeps the built files by hash only (lib/vcs-watch.mjs addDerived).
import { snapshotOf, labels } from './package.mjs';
import { buildDocx, buildXlsx, buildPdf, sourceProblems } from './package-build.mjs';
import { loadSources, sourceHashes, evidenceHash } from './package-sources.mjs';
import { addDerived } from './vcs-watch.mjs';
import { withVersion } from './evidence-folder.mjs';
import { parseVersionFull } from './folder-map.mjs';
import { sameContent } from './project-folder.mjs';

const dirOf = p => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');
const baseOf = p => p.slice(p.lastIndexOf('/') + 1);
const join = (d, n) => (d ? `${d}/${n}` : n);
const hex = async bytes => [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(b => b.toString(16).padStart(2, '0')).join('');
export const buildKey = (partId, variantId) => (variantId ? `${partId}:${variantId}` : partId);

const VERSION_TOKEN = /([\s._-]?v(?:er(?:sion)?)?[\s._-]?\d{1,3})(?=$|[\s._-]|\s*\()/i;
/** The part's file name at a version, for a format; a variant's suffix goes before the version ("Tables_v19" → "Tables_short_v20"). */
export function fileFor(part, variant, ext, version) {
  const base = baseOf(part.file), dot = base.lastIndexOf('.');
  let stem = dot > 0 ? base.slice(0, dot) : base;
  if (variant) {
    const last = [...stem.matchAll(new RegExp(VERSION_TOKEN.source, 'gi'))].at(-1);
    stem = last ? `${stem.slice(0, last.index)}_${variant.suffix}${stem.slice(last.index)}` : `${stem}_${variant.suffix}`;
  }
  return join(dirOf(part.file), withVersion(`${stem}.${ext}`, version));
}

/** First build: the name's own version when that file is not there yet (a part made from a name), else one more; later builds: last + 1. */
async function nextVersionOf(folder, part, last) {
  if (last) return last.version + 1;
  const named = parseVersionFull(baseOf(part.file)).version;
  if (!named) return 1;
  return (await folder.stat(part.file)).exists ? named + 1 : named;
}

async function compose(pkg, partId, variantId, read, folder, state, app = null) {
  const part = pkg.parts.find(p => p.id === partId), variant = variantId ? part.variants.find(v => v.id === variantId) : null;
  const snapshot = snapshotOf(pkg, partId, variantId);
  const L = labels(pkg, variant ? { variant: { partId, variantId } } : {}), all = labels(pkg);
  const labelOf = id => L.get(id) || all.get(id);
  const sources = await loadSources(folder, snapshot.items, { ...(read ? { read } : {}), state, app });
  return { part, variant, snapshot, sources, labelOf };
}

async function formatsOf(snapshot, sources, labelOf, pdf) {
  const out = [];
  const docx = await buildDocx(snapshot, sources, { labelOf });
  if (snapshot.part.formats.includes('docx') || !snapshot.part.formats.length) out.push({ ext: 'docx', bytes: docx });
  // the app writes the PDF itself, so its figures stay vector; `pdf(docx)` (a converter of the Word copy) is used only where it is given
  if (snapshot.part.formats.includes('pdf')) out.push({ ext: 'pdf', bytes: pdf ? await pdf(docx) : buildPdf(snapshot, sources, { labelOf }) });
  if (snapshot.part.formats.includes('xlsx')) { const x = await buildXlsx(snapshot, sources, { labelOf }); if (x) out.push({ ext: 'xlsx', bytes: x }); }
  return out;
}

/**
 * `state` is the project, read by tables drawn from its evidence table (lib/package-select.mjs); `app(source)` draws a table or figure of the
 * app (lib/app-items.mjs appLoader), whose signature the record keeps so a later change to its data shows as Changed since.
 */
/**
 * What a build in keep mode writes, read before it: the version, each format's new file, and the person's files that stay as they are (a part
 * that is in the folder and that the app never built). Writes nothing.
 */
export async function planBuild(folder, pkg, partId, { variantId = null } = {}) {
  const part = pkg.parts.find(p => p.id === partId), variant = variantId ? part.variants.find(v => v.id === variantId) : null;
  const last = (pkg.builds[buildKey(partId, variantId)] || []).at(-1), exts = part.formats?.length ? part.formats : ['docx'];
  let version = await nextVersionOf(folder, part, last);
  while ((await Promise.all(exts.map(e => folder.stat(fileFor(part, variant, e, version))))).some(st => st.exists)) version++;
  const kept = [];
  for (const e of exts) { const own = last?.files.find(f => f.path.endsWith(`.${e}`))?.path || (part.file.endsWith(`.${e}`) ? part.file : null); if (own && (await folder.stat(own)).exists) kept.push(own); }
  return { version, files: exts.map(e => fileFor(part, variant, e, version)), kept };
}

export async function buildPart(folder, pkg, partId, { variantId = null, note = '', repo = null, pdf = null, state = null, app = null, keep = false, now = () => new Date().toISOString() } = {}) {
  const key = buildKey(partId, variantId), records = pkg.builds[key] || [];
  const { part, variant, snapshot, sources, labelOf } = await compose(pkg, partId, variantId, null, folder, state, app);
  const problems = sourceProblems(snapshot, sources);
  if (problems.length) return { status: 'blocked', version: records.at(-1)?.version || 0, files: [], problems, openInWord: [] };
  const made = await formatsOf(snapshot, sources, labelOf, pdf);
  const last = records.at(-1);
  // unchanged: every format equals the current file of the last build
  if (last) {
    let same = made.length === last.files.length;
    for (const m of made) {
      const prev = last.files.find(f => f.path.endsWith(`.${m.ext}`));
      same = same && !!prev && (await folder.stat(prev.path)).exists && await sameContent(await folder.read(prev.path), m.bytes, m.ext);
      if (!same) break;
    }
    if (same) {
      // the same files from data that changed and changed back, or a signature the record did not keep yet: the record reads the data now
      last.sources = { ...(last.sources || {}), ...Object.fromEntries(Object.entries(await sourceHashes(folder, snapshot.items, { sources })).filter(([k]) => k.startsWith('app:'))) };
      return { status: 'unchanged', version: last.version, files: last.files, problems: [], openInWord: [] };
    }
  }
  if (repo) { const st = await repo.status(); if (st.added.length + st.modified.length + st.deleted.length + st.moved.length) await repo.commit({ message: `Before building ${part.name}` }); }
  const ref = repo ? (await repo.status()).head : null;
  // keep: the person's file stays as it is and the build is a new file beside it, at the first version no file of the folder holds
  const version = keep ? (await planBuild(folder, pkg, partId, { variantId })).version : await nextVersionOf(folder, part, last);
  await addDerived(folder, `${dirOf(part.file) ? `${dirOf(part.file)}/` : ''}${parseVersionFull(baseOf(part.file)).stem}`);
  const files = [], openInWord = [];
  for (const m of made) {
    // the file this format replaces: the last build's, or on a first build the part's own file when it is of this format and exists
    const to = fileFor(part, variant, m.ext, version);
    const prev = last?.files.find(f => f.path.endsWith(`.${m.ext}`))?.path || (!variant && part.file.endsWith(`.${m.ext}`) && (await folder.stat(part.file)).exists ? part.file : null);
    if (!keep && prev && prev !== to && (await folder.stat(prev)).exists) {
      if ((await folder.stat(join(dirOf(prev), `~$${baseOf(prev).slice(2)}`))).exists) openInWord.push(baseOf(prev));
      await folder.rename(prev, to);
      await (folder.replaceBytes ? folder.replaceBytes(to, m.bytes) : folder.writeBytes(to, m.bytes));
    } else await folder.writeBytes(to, m.bytes);
    files.push({ path: to, hash: await hex(m.bytes) });
  }
  const record = { version, at: now(), note, ref, files, sources: await sourceHashes(folder, snapshot.items, { sources }), snapshot };
  pkg.builds[key] = [...records, record];
  if (!variant) part.file = files.find(f => f.path.endsWith('.docx'))?.path || part.file;
  return { status: 'built', version, files, problems: [], openInWord, record };
}

/**
 * An earlier version's files, rebuilt from its record: folder sources as they were (History has them), held tables as kept. The evidence table
 * is not kept per version, so a table drawn from it has today's values: the returned list's `notice` says so, and whether they differ.
 */
export async function rebuildVersion(folder, pkg, partId, record, { repo, state = null, app = null }) {
  const want = record.sources || {};
  const read = async path => {
    const here = await folder.read(path).catch(() => null);
    if (here && (!want[path] || await hex(here) === want[path])) return here;
    const old = record.ref && repo ? await repo.read(record.ref, path).catch(() => null) : null;
    if (old) return old;
    throw new Error(`Cannot rebuild v${record.version}: ${path} is in neither the folder nor History`);
  };
  const part = pkg.parts.find(p => p.id === partId);
  const snapshot = record.snapshot, all = labels(pkg);
  const L = new Map(); const n = { table: 0, figure: 0 };
  for (const it of snapshot.items) { n[it.kind]++; L.set(it.id, `${it.kind === 'table' ? 'Table' : 'Figure'} ${snapshot.part.prefix || ''}${n[it.kind]}`); }
  const sources = await loadSources(folder, snapshot.items, { read, state, app });
  const bad = sourceProblems(snapshot, sources);
  if (bad.length) throw new Error(bad[0].text);
  const made = await formatsOf(snapshot, sources, id => L.get(id) || all.get(id), null);
  const out = made.map(m => ({ name: baseOf(record.files.find(f => f.path.endsWith(`.${m.ext}`))?.path || fileFor(part, null, m.ext, record.version)), bytes: m.bytes }));
  const grids = snapshot.items.filter(it => it.source?.evidence).map(it => sources.get(it.id)?.grid).filter(Boolean);
  if (grids.length) {
    const same = want.evidence && want.evidence === await evidenceHash(grids);
    out.notice = `Rebuilt with today's values: the evidence table is not kept per version${same ? '' : want.evidence ? `, and its values have changed since v${record.version}` : ''}`;
  }
  // a drawing of the app is drawn from the data as it is today, like the evidence table
  const drawn = snapshot.items.filter(it => it.source?.app || it.source?.apps?.length);
  if (drawn.length && !out.notice) {
    const sigs = it => (it.source.app ? { [it.source.app]: sources.get(it.id)?.sig } : sources.get(it.id)?.sigs || {});
    const changed = drawn.some(it => Object.entries(sigs(it)).some(([k, sig]) => want[`app:${k}`] && sig !== want[`app:${k}`]));
    out.notice = `Rebuilt with today's data: the app's drawings are not kept per version${changed ? `, and their data have changed since v${record.version}` : ''}`;
  }
  return out;
}
