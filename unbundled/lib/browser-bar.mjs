// The Lykos browser's bar (browser-chrome.html, src-tauri/src/browser.rs): its two rows as declarations, and what they show for the page's
// state. The bar is a webview of its own over the page; it can step the page, go to an address and find, and nothing else (no More: a menu
// would open past the bar's 40px and be cut off, so every control keeps its place and the address field gives up width first).
import { uiBar, uiGroup, uiSwap, uiRegion } from './ui-actions.mjs';
import { findBarSpec } from './ui-recipes.mjs';

/** The navigation row: the address, the zoom when it is not 100 %, Back and Forward, Reload or Stop, Find, Copy link, Open through institution and the system browser. */
export function navBarSpec() {
  return { kind: 'tools', density: 'dense', stack: false, label: 'Browser', id: 'bc-nav',
    budget: { n: 7, reason: 'a browser bar: every control keeps its place, no More can open below a 40px webview' },
    status: { id: 'bc-zoom', text: '', ch: 4, after: 'filters' },
    filters: [{ type: 'field', id: 'bc-address', label: 'Address', placeholder: 'Web address, DOI or PMID', width: 'flex', attrs: { autocomplete: 'off', spellcheck: 'false', autocapitalize: 'off', enterkeyhint: 'go' } }],
    actions: [
      uiGroup({ id: 'bc-steps', label: 'History', keep: true, items: [{ id: 'bc-back', label: 'Back', icon: 'chevron-left', kbd: '⌘[' }, { id: 'bc-forward', label: 'Forward', icon: 'chevron-right', kbd: '⌘]' }] }),
      uiSwap({ id: 'bc-load', members: [{ id: 'bc-reload', label: 'Reload', icon: 'refresh', iconOnly: true, kbd: '⌘R' }, { id: 'bc-stop', label: 'Stop', icon: 'stop', iconOnly: true, kbd: 'Esc', hidden: true }] }),
      { id: 'bc-find', label: 'Find in page', icon: 'search', role: 'quiet', iconOnly: true, keep: true, kbd: '⌘F' },
      { id: 'bc-copy', label: 'Copy link', icon: 'copy', role: 'quiet', iconOnly: true, keep: true },
      // the page again through the institution's OpenAthens redirector (browser_institution builds the link from the saved domain)
      { id: 'bc-institution', label: 'Open through institution', icon: 'institution', role: 'quiet', iconOnly: true, keep: true },
      { id: 'bc-system', label: 'Open in system browser', icon: 'globe', role: 'quiet', iconOnly: true, keep: true }] };
}

/** The find row, in the navigation row's place while it is open. */
export const findRowSpec = () => findBarSpec({ id: 'bc-f', field: 'bc-find-q', label: 'Find in page', placeholder: 'Find in page', count: 'bc-find-count', ch: 12, grow: true,
  steps: { prevKbd: '⇧↩', nextKbd: '↩' }, close: 'Done' });

/** Both rows as one region: the navigation row first. */
export const barHtml = () => uiRegion({ id: 'bc-rows', label: 'Browser bar', bars: [uiBar(navBarSpec()), uiBar(findRowSpec())] });

/** The address as the field shows it while it is not being edited: the page's own, empty for a blank page. */
export const shownAddress = url => (/^https?:\/\//i.test(String(url || '')) ? String(url) : '');

/** The zoom readout: empty at 100 %. */
export const zoomText = pct => (Number.isFinite(pct) && pct > 0 && Math.round(pct) !== 100 ? `${Math.round(pct)}%` : '');

/** What the bar shows for a page state `{ url, title, loading, canBack, canForward, zoom, institution }` (`institution`: an OpenAthens domain is saved). */
export function barView(state = {}) {
  const web = !!shownAddress(state.url);
  return { address: shownAddress(state.url), loading: !!state.loading, back: !!state.canBack, forward: !!state.canForward, zoom: zoomText(state.zoom), copy: web,
    institution: web && state.institution === true };
}
