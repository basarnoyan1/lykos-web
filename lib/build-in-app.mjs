// Building in the app a part that is in the folder (plan §2, "Submission files"): offered only where what the app would draw agrees with what
// the folder's file prints (lib/printed-data.mjs), or where the person chose a source for an item; built beside the person's file, never over
// it (lib/package-write.mjs buildPart, keep). Pure: the caller reads the folder and builds.

/**
 * Whether the app may build an item as its printed version shows it, and why: `{ ok, why, choose }` (`choose`: the person may pick a source).
 * `it` the package item, `printed` its printed facts (lib/printed-data.mjs printedFacts) or null.
 */
export function agreement(it, printed) {
  const choose = it?.kind === 'figure' && Boolean(it.source?.app) && Boolean(printed?.path);
  if (it?.use === 'printed') return { ok: true, why: 'The printed picture, as chosen', choose };
  if (it?.use === 'app') return { ok: true, why: "The app's data, as chosen", choose };
  if (it?.kind === 'table') return { ok: true, why: it.source?.held ? 'The printed table' : '', choose: false };
  if (!it?.source?.app) return { ok: true, why: 'Its own picture', choose: false };
  const c = printed?.compare;
  if (c) return c.mismatches.length ? { ok: false, why: `${c.mismatches.length} ${c.mismatches.length === 1 ? 'difference' : 'differences'} from the printed version`, choose } : { ok: true, why: 'Agrees with the printed version', choose };
  if (printed?.path) return { ok: false, why: 'Not compared with the printed version: choose a source', choose };
  return { ok: true, why: '', choose: false };
}
/** A part's items and whether each may be built; the part may be built when every one may. `printedOf(id)` an item's printed facts. */
export function buildGate(pkg, partId, printedOf = () => null) {
  const part = pkg?.parts?.find(p => p.id === partId);
  const items = (part?.items || []).map(id => ({ id, ...agreement(pkg.items[id], printedOf(id)) }));
  return { ok: Boolean(part) && items.every(x => x.ok), items, blocked: items.filter(x => !x.ok) };
}
/** The package the build reads: an item for which the person chose the printed picture is built from that picture, not drawn again. */
export function withChoices(pkg) {
  const out = structuredClone(pkg);
  for (const it of Object.values(out.items || {})) if (it.use === 'printed' && typeof it.source?.was === 'string') it.source = { path: it.source.was };
  return out;
}
/**
 * After the app built the item's part: whether that build agrees with the printed version, for Consistency. Null where there is nothing to
 * set against (no build of the app, or no printed version).
 */
export function builtAgainstPrinted(it, printed, built) {
  if (!built || !(printed?.path || it?.source?.held)) return null;
  const a = agreement(it, printed);
  return { ok: a.ok, detail: a.ok ? a.why : `${a.why}; built ${String(built.at || '').slice(0, 10)}`, mismatches: printed?.compare?.mismatches || [] };
}
