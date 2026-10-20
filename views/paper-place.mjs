// Placing a table or figure the app draws (lib/app-items.mjs) in the paper: "Add to package…" puts it in a part of the package, built from
// the data at each build; "Insert in manuscript" adds it at the end of the manuscript as a figure or a real table under its caption, linked,
// so the manuscript redraws it when its data changes (refreshManuscript, called by the manuscript when it is drawn or exported). Tables and
// figures, Certainty and the package reach the same functions; the item has one drawing and the paper's places are views of it. Loaded on use.
import { get, update, projectGeneration, recoveryOwner } from '../store.mjs';
import { putFile } from '../lib/files.mjs';
import { newId } from '../lib/manuscript.mjs';
import { appItems, drawApp, renderApp, linkedBlocks, refreshTables, appSig, placements, placeWords, sourceOfKey } from '../lib/app-items.mjs';

const SECTION = { pageW: 612, left: 72, right: 72 };   // the manuscript's page when it names none (lib/pages.mjs DEFAULT_SECTION)
const textWidth = d => { const sec = { ...SECTION, ...(d?.section || {}) }; return sec.pageW - sec.left - sec.right; };
const titleOf = (s, key) => appItems(s).find(x => x.key === key)?.title || drawApp(s, key).title || key;

/** A figure's print copy stored with the project's files as a PNG: `{ img, fileHash, w, h, ptW, ptH }` (the same `img` is drawn again in place). */
async function storeFigure(s, key, img = `im${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`) {
  const got = await renderApp(s, key);
  if (got.error) throw new Error(got.error);
  const fileHash = await putFile(`img-${img}`, new Blob([got.image.bytes], { type: 'image/png' }), { owner: recoveryOwner() });
  return { img, fileHash, ...got.image, sig: got.sig };
}

/**
 * Adds the drawing of `key` at the end of the manuscript: its caption and the figure (a PNG of its print copy) or the table with its notes.
 * Returns the place it took ("Figure 3"); throws with the reason it could not be drawn.
 */
export async function insertInManuscript(key) {
  const generation = projectGeneration(), s = get(), d = drawApp(s, key);
  if (d.error) throw new Error(d.error);
  const image = d.kind === 'figure' ? await storeFigure(s, key) : null;
  if (generation !== projectGeneration()) throw new Error('The project changed; nothing was inserted');
  update(st => {
    st.manuscript = st.manuscript || { blocks: [], snapshot: {} };
    st.manuscript.blocks = [...(st.manuscript.blocks || []), ...linkedBlocks(st, key, { newId, image, width: textWidth(st.manuscript) })];
    return st;
  });
  return placements(get()).get(key)?.filter(p => p.where === 'manuscript').at(-1)?.label || '';
}

let refreshing = false;
/**
 * The manuscript's linked tables and figures redrawn from the data as it is: tables at once, figures drawn again into the same image.
 * Returns what was redrawn, in words ("Figure 2 and Table 1"), or '' when nothing had changed.
 */
export async function refreshManuscript() {
  const s = get(), blocks = s.manuscript?.blocks || [];
  if (refreshing || !blocks.some(b => b?.app?.key)) return '';
  refreshing = true;
  const generation = projectGeneration(), before = labelsOf(s);
  try {
    const { tables, figures } = refreshTables(s, blocks);
    const drawn = new Map();
    for (const b of figures) {
      try { drawn.set(b.id, await storeFigure(s, b.app.key, b.img)); } catch { /* not drawable here (no rasteriser) or no longer drawable: kept as it was */ }
    }
    if (!tables.length && !drawn.size) return '';
    if (generation !== projectGeneration()) return '';
    const changed = new Set([...tables, ...drawn.keys()]);
    // applied to the blocks as they are now (the person may have typed while a figure was drawn): the tables redrawn on them, the figures by id
    update(st => {
      st.manuscript.blocks = refreshTables(st, st.manuscript.blocks || []).blocks.map(b => {
        const fig = drawn.get(b.id);
        if (!fig) return b;
        const h = b.w * (fig.h / fig.w);
        return { ...b, fileHash: fig.fileHash, h, app: { ...b.app, sig: fig.sig } };
      });
      return st;
    });
    const names = [...changed].map(id => before.get(id)).filter(Boolean);
    return names.length ? names.join(', ').replace(/, ([^,]*)$/, ' and $1') : '';
  } finally { refreshing = false; }
}
const labelsOf = s => { const out = new Map(); for (const [, list] of placements(s)) for (const p of list) if (p.blockId) out.set(p.blockId, p.label); return out; };

/** Whether a linked block's data changed since it was drawn (Files in the manuscript says so until it is redrawn). */
export const isStale = (s, b) => !!b?.app?.key && !b.app.note && b.app.sig !== appSig(s, b.app.key);

/** Add to package… for a drawing of the app: the package's parts, a new part last (views/package-view.mjs addToPackage). */
export async function addToPackage(anchor, key, done = () => {}) {
  const pv = await import('./package-view.mjs'), s = get(), d = drawApp(s, key);
  if (d.error) throw new Error(d.error);
  pv.addToPackage(anchor, { kind: d.kind, source: sourceOfKey(key), title: titleOf(s, key) }, done);
}

/** Where the paper holds the drawings of `keys`, in words: "Supplement · Figure S2", "Manuscript · Table 1". */
export function placedWords(s, keys) {
  const at = placements(s);
  return keys.flatMap(k => (at.get(k) || []).map(placeWords));
}
