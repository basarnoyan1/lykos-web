// Whether the manuscript in the app is the project's paper (moved from lib/overview-facts.mjs): a review project's manuscript is one titled as
// none of a perspective, editorial, commentary, letter, viewpoint, narrative review, technical note or case report, with Methods or Results.
// Readiness leaves what it cannot judge unassessed by it; the package's numbering and callouts are not read into another paper's text
// (lib/package-cites.mjs). Light: no store, no view.
import { researchType } from './workflow.mjs';

const NOT_REVIEW = /\b(perspective|editorial|commentary|letter to the editor|viewpoint|narrative review|technical note|case report)\b/i;
const REVIEW_TYPES = /^(systematic-review|meta-analysis|scoping-review|umbrella-review|rapid-review|dta-review|nma-review|qualitative-review)$/;
/** Whether the manuscript is the project's paper, for readiness: { ok, reason, name }. */
export function manuscriptFit(s, typeId = researchType(s).id, typeLabel = researchType(s).label) {
  const blocks = s.manuscript?.blocks || [], name = s.manuscript?.name || '';
  if (!blocks.length) return { ok: true, name };
  const heads = blocks.filter(b => /^h\d?$|^heading/.test(String(b.type || ''))).map(b => String(b.text || '').trim());
  const title = heads[0] || name;
  const kind = NOT_REVIEW.exec(title)?.[1];
  const imrad = heads.some(h => /^(materials and )?methods?\b/i.test(h)) || heads.some(h => /^results?\b/i.test(h));
  if (!REVIEW_TYPES.test(typeId)) return { ok: true, name };
  if (kind) return { ok: false, name, reason: `the manuscript (${name || 'in the app'}) is a ${kind.toLowerCase()}, not the ${String(typeLabel).toLowerCase()}` };
  if (!imrad) return { ok: false, name, reason: `the manuscript (${name || 'in the app'}) has no Methods or Results` };
  return { ok: true, name };
}


/**
 * Whether the manuscript is another paper than the review: a review project's manuscript titled as a perspective, editorial, commentary,
 * letter, viewpoint, narrative review, technical note or case report. Only the title decides here (a draft without Results yet is still the
 * review's): the package's callouts and numbering are kept out of such a text (lib/package-cites.mjs). Returns the reason, or ''.
 */
export function otherPaper(s) {
  const fit = manuscriptFit(s || {});
  return !fit.ok && /, not the /.test(fit.reason || '') ? fit.reason : '';
}
