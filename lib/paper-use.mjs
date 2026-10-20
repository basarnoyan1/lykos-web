// Which pooled analyses the paper uses, read without waiting (lib/paper-use-graph.mjs says what "used" means). The graph behind it is many
// modules (the dependency graph reads the results, outputs, package and manuscript), so it loads on the first question, which is asked only
// for a project with a pooled result, and the views repaint when it arrives (store notify: the Overview's memo and the lists read again).
// Until then every analysis counts as used, which is what the pages said before.
import { lazyModule } from './lazy.mjs';
import { notify } from '../store.mjs';

const graph = lazyModule(() => import('./paper-use-graph.mjs'), 'which analyses the paper uses');
let asked = false;
const here = () => {
  if (graph.ready()) return graph.module();
  if (!asked) { asked = true; graph.ensure().then(() => notify(), err => console.warn('[paper-use]', err.message)); }
  return null;
};

/** Loads the graph reader; for a caller that can wait (a test, the MCP server). */
export const ensurePaperUse = () => graph.ensure();
/** `Map(outcomeId -> { used, stale })` over the analyses that ran, or null until the reader is here. */
export const analysisUse = s => here()?.analysisUse(s) ?? null;
/** Whether an outcome's analysis ran and nothing in the paper uses it (false until the reader is here). */
export const notUsed = (s, outcomeId) => here()?.notUsed(s, outcomeId) ?? false;
/** The outcomes whose analysis the paper does not use and whose data changed since it ran (none until the reader is here). */
export const atRest = s => here()?.atRest(s) ?? new Set();
