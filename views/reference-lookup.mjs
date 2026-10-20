// Look up reference (plan §3, "Citation lookup on a selected reference"): the text selected in a document goes to Crossref when a person asks, and
// the best matches stand in the inspector as a section, each with Add to library. Nothing is looked up by itself, nothing is added without the act,
// and a failed request is a line of words in the section, never an error. The reader owns one of these per open document (views/reader.mjs);
// the Files tab's viewer takes the same, its selection foot offering `lookup` (views/reader-bars.mjs selectSpec).
import { get, update } from '../store.mjs';
import { settings } from '../lib/model-settings.mjs';
import { lookupReference, describeMatch } from '../lib/ref-lookup.mjs';
import { importReferences } from '../lib/search-library.mjs';
import { uiList, uiRow, uiRowEnd } from '../lib/ui-actions.mjs';
import { showMenu } from '../lib/menu.mjs';
import { esc } from '../lib/html.mjs';

export const LOOKUP_ADD = 'Add to library';

/** The section's markup for a lookup state (`{ busy, status, matches }`); `held(record)` says which matches the library already has. */
export function lookupHtml(state, held = () => false) {
  if (!state) return '';
  const rows = (state.matches || []).map((m, i) => {
    const d = describeMatch(m), have = held(m.record);
    return uiRow({ attrs: { 'data-lookup': i },
      main: { html: `<span class="lk-title">${esc(d.title)}</span>`, detail: [...d.detail.map(esc), have ? 'In the library' : ''], wrap: true },
      end: uiRowEnd({ primary: { id: `lk-add-${i}`, label: LOOKUP_ADD, icon: 'library', disabled: have, attrs: { 'data-lookup-add': i, ...(have ? { title: 'Already in the library' } : {}) } },
        more: { label: `More for ${d.title}`.slice(0, 80), attrs: { 'data-lookup-more': i } } }) });
  });
  const say = state.busy ? 'Looking up on Crossref' : state.status;
  return `${rows.length ? uiList({ id: 'lk-list', label: 'Matches on Crossref', rows }) : ''}${say ? `<p class="meta lk-status" role="status">${esc(say)}</p>` : ''}`;
}

/**
 * The lookup of one open document. `ctx` is the shell's (refreshDetails, openDetails, refreshCounts); `name()` is the document's name, kept with a
 * record added from it. `fetchImpl` replaces fetch in a test.
 */
export function createLookup({ ctx, name = () => '', fetchImpl = null } = {}) {
  let state = null, ctl = null, seq = 0;
  const held = rec => importReferences(get(), [rec]).matched > 0;   // a dry run: nothing is written without `at`
  const redraw = () => ctx?.refreshDetails?.();

  async function run(text) {
    ctl?.abort(); ctl = new AbortController();
    const mine = ++seq;
    state = { busy: true, status: '', matches: [] };
    ctx?.openDetails?.(); redraw();
    const r = await lookupReference(text, { settings: settings(), signal: ctl.signal, ...(fetchImpl ? { fetchImpl } : {}) });
    if (mine !== seq) return;
    state = r.aborted ? null : { busy: false, status: r.status, matches: r.matches };
    redraw();
  }
  function add(i) {
    const m = state?.matches?.[i]; if (!m) return;
    let result = { added: 0, matched: 0 };
    update(s => { result = importReferences(s, [m.record], name(), { at: new Date().toISOString() }); return s; });
    ctx?.refreshCounts?.(); redraw();
    return result;
  }
  function wire(box) {
    box.querySelectorAll('[data-lookup-add]').forEach(b => { b.onclick = () => add(+b.dataset.lookupAdd); });
    box.querySelectorAll('[data-lookup-more]').forEach(b => b.onclick = () => {
      const m = state?.matches?.[+b.dataset.lookupMore];
      showMenu(b, [
        { label: 'Copy DOI', disabled: !m?.doi, run: () => navigator.clipboard?.writeText(m.doi).catch(() => {}) },
        { label: 'Dismiss', run: () => { state.matches = state.matches.filter(x => x !== m); if (!state.matches.length) state = null; redraw(); } }]);
    });
  }
  return {
    run, add, has: () => !!state,
    /** The inspector section, or null when there is no lookup. */
    section: () => (state ? { title: 'Reference lookup', meta: state.matches.length ? String(state.matches.length) : '', html: lookupHtml(state, held), wire } : null),
    /** The document changed or closed: a request in flight is dropped and the section goes. */
    reset() { ctl?.abort(); ctl = null; seq++; state = null; },
  };
}
