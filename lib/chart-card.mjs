// The card a pointed-at chart mark shows. One card lives on the page, above
// every view, so a chart's own box never clips it; it is placed beside the mark
// (right, then left, then below, then above) inside the window, and never over
// the mark it describes.
import { lib_html$esc as esc } from "../boot.mjs";

export function floatingCard() {
  let card = document.querySelector('body > .chart-card-float');
  if (!card) {
    card = document.createElement('div');
    card.className = 'chart-card chart-card-float';
    card.hidden = true;
    document.body.append(card);
    // A scroll or a resize moves what it pointed at.
    addEventListener('scroll', () => { card.hidden = true; }, true);
    addEventListener('resize', () => { card.hidden = true; });
  }
  return card;
}

/**
 * Places `card` (already filled and shown) next to `rect`, the mark's client
 * rectangle. `align` says which edge of the mark the card lines up with when it
 * sits beside it: 'top', or 'bottom' so it never covers the top of a bar.
 */
export function placeCard(card, rect, { align = 'top', gap = 8, pad = 8 } = {}) {
  const cw = card.offsetWidth, ch = card.offsetHeight, vw = innerWidth, vh = innerHeight;
  const clampX = x => Math.max(pad, Math.min(vw - cw - pad, x));
  const clampY = y => Math.max(pad, Math.min(vh - ch - pad, y));
  const side = clampY(align === 'bottom' ? rect.bottom - ch : rect.top);
  const tries = [
    [rect.right + gap, side],
    [rect.left - cw - gap, side],
    [clampX(rect.left), rect.bottom + gap],
    [clampX(rect.left), rect.top - ch - gap],
  ];
  const fits = ([x, y]) => x >= pad && y >= pad && x + cw <= vw - pad && y + ch <= vh - pad;
  const [x, y] = tries.find(fits) || [clampX(rect.right + gap), side];
  card.style.setProperty('left', `${Math.round(x)}px`);
  card.style.setProperty('top', `${Math.round(y)}px`);
}

/**
 * The card a chart's mark shows on hover: its label, up to four of its row's values and the studies behind it (`m` is the rendered output,
 * lib/output-render.mjs renderOutput; a mark carries `data-row`, its row in the result, and `data-chart-mark`, its label). `labelOf(id)`
 * names a study. Used by Tables and figures and by the Manuscript reader's figures.
 */
/** A row's value as a reader reads it: a computed estimate to two decimals (three significant figures under 0.01), a minus sign, not a hyphen. */
export function shownValue(v) {
  if (typeof v !== 'number' || !Number.isFinite(v) || Number.isInteger(v)) return v;
  const a = Math.abs(v), t = a >= 0.01 ? a.toFixed(2) : a.toPrecision(2);
  return `${v < 0 && Number(t) !== 0 ? '\u2212' : ''}${t}`;
}

export function wireMarkCard(host, m, { labelOf = id => id } = {}) {
  const card = floatingCard();
  host.addEventListener('pointermove', ev => {
    const mark = ev.target.closest?.('[data-row]'); if (!mark) { card.hidden = true; return; }
    const r = Number(mark.getAttribute('data-row')), row = m.result.rows[r], refs = m.result.refs[r] || [];
    const values = m.result.columns.map((c, i) => [c.label, row?.[i]]).filter(([, v]) => v != null && v !== '' && !(Array.isArray(v) && !v.length)).slice(0, 4);
    card.innerHTML = `<strong>${esc(mark.getAttribute('data-chart-mark'))}</strong>${values.map(([k, v]) => `<span class="meta">${esc(k)}: ${esc(Array.isArray(v) ? v.join('; ') : shownValue(v))}</span>`).join('')}${refs.length > 1 ? refs.slice(0, 4).map(id => `<span>${esc(labelOf(id))}</span>`).join('') + (refs.length > 4 ? `<span class="meta">${refs.length - 4} more</span>` : '') : ''}`;
    card.hidden = false;
    placeCard(card, mark.getBoundingClientRect());
  });
  host.addEventListener('pointerleave', () => { card.hidden = true; });
}

/**
 * A press, or Enter and Space, on a mark of a rendered output: a mark that is one study (`data-study`: a forest's row, a risk-of-bias
 * name or judgement) calls `open({ ids: [study], rob, domain })`, a mark that stands for rows (`data-row`) `open({ ids: their studies,
 * label })`. `rob` is true for a risk-of-bias chart's marks, which open the study in Appraisal at `domain`. Returns `focusable()`, to be
 * called after each drawing: it makes every mark that opens something a tab stop.
 */
export function wireMarkPress(host, m, open) {
  const robChart = ['traffic-light', 'rob-summary'].includes(m.chart?.type);
  const act = ev => {
    const g = ev.target.closest?.('[data-study]'), row = ev.target.closest?.('[data-row]');
    if (g && host.contains(g)) { open({ ids: [g.getAttribute('data-study')], rob: robChart || g.hasAttribute('data-rob-domain'), domain: g.getAttribute('data-rob-domain') || '', label: g.getAttribute('data-chart-mark') || '' }); return true; }
    if (!row || !host.contains(row)) return false;
    const refs = m.result.refs[Number(row.getAttribute('data-row'))] || [];
    if (!refs.length) return false;
    open({ ids: refs, rob: false, domain: '', label: row.getAttribute('data-chart-mark') || '' });
    return true;
  };
  host.addEventListener('click', ev => { act(ev); });
  host.addEventListener('keydown', ev => { if ((ev.key === 'Enter' || ev.key === ' ') && act(ev)) ev.preventDefault(); });
  return { focusable: () => {
    for (const el of host.querySelectorAll('[data-study],[data-row]')) {
      if (el.hasAttribute('data-study') || (m.result.refs[Number(el.getAttribute('data-row'))] || []).length) {
        if (!el.hasAttribute('tabindex')) el.setAttribute('tabindex', '0');
        if (!el.hasAttribute('role')) el.setAttribute('role', 'button');
        if (!el.hasAttribute('aria-label') && el.getAttribute('data-chart-mark')) el.setAttribute('aria-label', el.getAttribute('data-chart-mark'));
      }
    }
  } };
}
