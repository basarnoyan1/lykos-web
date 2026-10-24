// Every chart answers the pointer and the keyboard (owner, 2026-10-22: "every graph in the app should be interactive: hover shows the value,
// a press opens the studies or rows behind it"). A chart says so in its marks, whichever module drew them:
//
//   data-chart-tip     the words a mark shows on hover or focus ("Low: 9 studies"); an SVG mark of lib/charts.mjs says it with its <title>
//                      (moved to aria-label by lib/tooltips.mjs) and data-chart-mark
//   data-chart-ids     the records behind it, space separated, with data-chart-label naming them: a press opens them (the shell narrows
//                      the Library to them, as a Needs attention row narrows a page)
//   data-chart-go      the page that holds it, for a mark whose records are not a list of studies (an analysis, a section)
//
// The words show at once, in the tooltip's own look and place (placeTip), unlike a control's tooltip, which waits half a second: a chart
// is read by moving over it. A row that already has a `title` is left to the app's tooltip. Loaded with the first chart touched (app.mjs).
import { placeTip } from './tooltips.mjs';

// a mark that answers with its page's own card (a study chart's bar, an output's point) is the page's
// a pressable mark that says its words at once anyway (data-tip-now: a risk-of-bias segment or judgement, lib/rob-screen.mjs)
const OWN = ':not([data-row],[role=button])', TIPPED = `[data-chart-tip]${OWN},svg [data-chart-mark]${OWN},[data-chart-tip][data-tip-now]`;
const PRESSED = '[data-chart-ids],[data-chart-go]';
const textOf = el => el.getAttribute('data-chart-tip') || el.getAttribute('aria-label') || el.querySelector?.(':scope > title')?.textContent || '';

/** Wires the document once. `open({ ids, label, go })` is the shell's: ids open the Library narrowed to them, else `go` is a page. */
export function wireCharts({ doc = document, open, first = null } = {}) {
  let tip = null, on = null;
  const hide = () => { if (tip) delete tip.dataset.show; on = null; };
  const show = el => {
    const text = textOf(el); if (!text) { hide(); return; }
    if (!tip) { tip = doc.createElement('div'); tip.className = 'tooltip chart-tip'; tip.setAttribute('role', 'tooltip'); tip.id = 'chart-tip'; doc.body.append(tip); }
    tip.textContent = text; on = el;
    const view = doc.defaultView, r = placeTip(el.getBoundingClientRect(), { width: tip.offsetWidth, height: tip.offsetHeight }, { width: view.innerWidth, height: view.innerHeight });
    tip.style.left = `${Math.round(r.left)}px`; tip.style.top = `${Math.round(r.top)}px`; tip.dataset.show = '';
  };
  const over = e => { const el = e.target?.closest?.(TIPPED); if (el) show(el); else if (on) hide(); };
  doc.addEventListener('pointerover', over);
  doc.addEventListener('focusin', over);
  doc.addEventListener('pointerleave', hide, true);
  doc.addEventListener('scroll', hide, true);
  const press = el => {
    const ids = (el.getAttribute('data-chart-ids') || '').split(' ').filter(Boolean);
    hide(); open({ ids, label: el.getAttribute('data-chart-label') || textOf(el), go: el.getAttribute('data-chart-go') || '' });
  };
  // the mark nearest the press: a segment before its row, its row before the card around it
  doc.addEventListener('click', e => {
    const el = e.target?.closest?.(PRESSED);
    if (!el || e.target.closest('button, a[href], input, select, textarea, summary') && !e.target.closest('button, a[href], input, select, textarea, summary').contains(el)) return;
    e.stopPropagation(); e.preventDefault(); press(el);
  }, true);
  doc.addEventListener('keydown', e => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const el = e.target?.matches?.(PRESSED) ? e.target : null; if (!el) return;
    e.preventDefault(); press(el);
  });
  if (first) over(first);
}
