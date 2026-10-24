// A study's citations within the review, for the study's Details (lib/study.mjs): the included studies it cites and those that cite it,
// read from the reference lists OpenAlex gives (lib/cross-citations.mjs keeps them on the records as `p.openalex = { id, refs, at }`),
// and a reference map of the study with those neighbours. Nothing is fetched here except by readReferences, which a person starts.
import { screeningStarted, isIncluded } from './screen.mjs';

/** The studies a citation can link to: the included ones once screening has started, else every record; never the study itself. */
export const citationPool = (st, p) => (st.papers || []).filter(x => x.id !== p.id && (!screeningStarted(st) || isIncluded(st, x.id)));

/**
 * `{ read, cites, citedBy, unread }` for a study: `read` whether its own reference list is kept; `cites` the pool's studies in it;
 * `citedBy` the pool's studies whose lists name it; `unread` the pool's studies with no list yet (their citations of it are not known).
 * Each list is ordered by year, then label.
 */
export function studyCitations(st, p) {
  const pool = citationPool(st, p), order = (a, b) => (Number(a.year) || 9999) - (Number(b.year) || 9999) || String(a.label).localeCompare(String(b.label));
  const byOa = new Map(pool.filter(x => x.openalex?.id).map(x => [x.openalex.id, x]));
  const own = p.openalex?.id;
  return {
    read: !!own,
    cites: own ? [...new Set(p.openalex.refs || [])].map(r => byOa.get(r)).filter(Boolean).sort(order) : [],
    citedBy: own ? pool.filter(x => (x.openalex?.refs || []).includes(own)).sort(order) : [],
    unread: pool.filter(x => !x.openalex?.id && (x.doi || x.pmid)),
  };
}

/** Reads the reference lists of the study and of the pool's studies that have none (OpenAlex, by DOI or PMID) and keeps them. */
export async function readReferences(st, p, { update, onProgress } = {}) {
  const [cc, ms] = await Promise.all([import('./cross-citations.mjs'), import('./model-settings.mjs')]);
  const papers = [p, ...citationPool(st, p)].filter(x => !x.openalex?.id && (x.doi || x.pmid));
  if (!papers.length) return { found: 0, missing: 0 };
  const { found, missing } = await cc.fetchReferences(papers, { settings: ms.settings(), onProgress });
  update(s => cc.saveReferences(s, found));
  return { found: found.length, missing: missing.length };
}

const escSvg = v => String(v).replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]);
/**
 * The reference map, in the app's own colours (not a publication figure): the studies it cites on the left, the study in the middle,
 * the studies that cite it on the right, each a pill a person can press to open that study, joined by curves. `width` is the pane's.
 */
export function referenceMapSvg(p, c, { width = 320 } = {}) {
  const W = Math.max(260, Math.round(width)), colW = Math.min(132, Math.floor((W - 32) / 3)), rowH = 32, top = 22;
  const rows = Math.max(c.cites.length, c.citedBy.length, 1), H = top + rows * rowH + 4;
  const xs = [0, Math.round((W - colW) / 2), W - colW], fy = top + rows * rowH / 2;
  const yOf = (i, n) => top + (rows - n) * rowH / 2 + i * rowH + rowH / 2;
  const fit = t => { const max = Math.max(4, Math.floor((colW - 12) / 6)); return t.length > max ? `${t.slice(0, max - 1)}…` : t; };
  const label = x => x.label || x.title || 'Untitled';
  const pill = (x, cx, y, focus) => `<g class="rm-node${focus ? ' rm-focus' : ''}"${focus ? '' : ` data-study-peek="${escSvg(x.id)}" role="button" tabindex="0"`}><title>${escSvg(label(x))}</title>
    <rect x="${cx + 0.5}" y="${y - 11.5}" width="${colW - 1}" height="23" rx="6"/><text x="${cx + colW / 2}" y="${y + 4}" text-anchor="middle">${escSvg(fit(label(x)))}</text></g>`;
  const curve = (x1, y1, x2, y2) => { const m = (x1 + x2) / 2; return `<path class="rm-link" d="M${x1} ${y1} C${m} ${y1} ${m} ${y2} ${x2} ${y2}"/>`; };
  const links = [...c.cites.map((x, i) => curve(xs[0] + colW, yOf(i, c.cites.length), xs[1], fy)), ...c.citedBy.map((x, i) => curve(xs[1] + colW, fy, xs[2], yOf(i, c.citedBy.length)))];
  const heads = `${c.cites.length ? `<text class="rm-side" x="${xs[0]}" y="12">Cites</text>` : ''}${c.citedBy.length ? `<text class="rm-side" x="${W}" y="12" text-anchor="end">Cited by</text>` : ''}`;
  return `<svg class="ref-map" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="group" aria-label="Reference map">${heads}${links.join('')}
    ${c.cites.map((x, i) => pill(x, xs[0], yOf(i, c.cites.length))).join('')}${pill(p, xs[1], fy, true)}${c.citedBy.map((x, i) => pill(x, xs[2], yOf(i, c.citedBy.length))).join('')}</svg>`;
}
