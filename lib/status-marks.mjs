// The status marks a stage of work shows, one set for the app: a circle in its verdict colour with a glyph that carries the meaning
// without the colour (a check, an exclamation, a cross, two chevrons, a dot, nothing). A workflow's pipeline (lib/pipeline-graph.mjs)
// draws its blocks with them and the Overview draws its stages with them, so a stage that passed looks the same on both pages.
// The circle is `.pipe-dot[data-mark]` in research-views.css. Pure: markup only.

/** What each mark says. */
export const MARK_LABEL = { passed: 'Passed', warning: 'Needs attention', failed: 'Failed', running: 'Running', skipped: 'Not run', pending: 'Pending' };

const GLYPH = {
  passed: '<path d="M3.2 6.3l1.9 1.9 3.8-4.2"/>',
  warning: '<path d="M6 3.2v3.3M6 8.6v.1"/>',
  failed: '<path d="M4.2 4.2l3.6 3.6M7.8 4.2l-3.6 3.6"/>',
  skipped: '<path d="M3.4 4.1l1.9 1.9-1.9 1.9M6.4 4.1l1.9 1.9-1.9 1.9"/>',
  running: '<circle cx="6" cy="6" r="1.8" class="pipe-fill"/>',
  pending: '',
};
/** A mark's glyph, 12 by 12, drawn in the circle's colour. */
export const glyph = mark => `<svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true">${GLYPH[mark] || ''}</svg>`;
