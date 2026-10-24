// Starts the width engine once per page (action-system design, sections 0 "Mounting" and 5.2).
//
// index.html and the isolated fixture load this as a module script. It does three things and nothing else:
//   1. starts the one document-level MutationObserver and the one shared ResizeObserver (bar-fit.mjs), which adopt every
//      [data-ui-bar], .ui-list, .ui-region and .ui-statusline that is added anywhere, dialogs and popovers included;
//   2. reads the legacy-adapter switch from <html data-ui-adapter="on"> and, only then, loads lib/bar-legacy.mjs, whose
//      adopt(root) tags existing containers (the adapter is step 0.9 and ships switched off);
//   3. does not throw: a failure here must never stop the app that loads beside it.
import { startBars } from './bar-fit.mjs';

export const engine = (() => {
  try { return startBars(document); }
  catch (e) { console.error(`[bars] the width engine did not start: ${e?.message || e}`); return null; }
})();

if (engine && document.documentElement.dataset.uiAdapter === 'on') {
  import('./bar-legacy.mjs').then(mod => engine.legacy(mod), e => console.warn(`[bars] data-ui-adapter="on" but lib/bar-legacy.mjs did not load: ${e?.message || e}`));
}
