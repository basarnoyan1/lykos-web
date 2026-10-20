// Tooltips, one system for the whole app (docs/UI_Guidelines.md, Foundations: "Tooltips").
// Which elements keep a title: a compact control whose name is not visible, a control whose title adds to its label (a shortcut),
// and text that is clipped; a fully labelled row loses the redundant one (wireTooltips). The app draws the tooltip itself, because
// the system draws a title's tooltip under the pointer, wherever that is: the project switcher's covered the search field below it.
// The app's is placed (placeTip): beside or under its control with a gap, never over the control it names and never over a control
// beside it that the pointer is about to use; it waits half a second as the system's does (the delay is the stylesheet's, no timer).
function visibleText(el) {
  if (el.hidden || el.getAttribute?.('aria-hidden') === 'true') return '';
  const style = getComputedStyle(el);
  if (style.display === 'none' || style.visibility === 'hidden') return '';
  return [...(el.childNodes || [])].map(n => n.nodeType === 3 ? n.textContent : n.nodeType === 1 ? visibleText(n) : '').join(' ').replace(/\s+/g, ' ').trim();
}
export function preserveControlTooltip(el) {
  if (!el.matches?.('button,[role="button"],a,input[type="button"],input[type="submit"]')) return false;
  const title = el.getAttribute('title');
  if (title == null && !el.getAttribute('aria-label')) return false;   // nothing to keep or to name it with: its words are not read (a style read per descendant)
  const label = visibleText(el);
  if (!label && !title && el.getAttribute('aria-label')) el.setAttribute('title', el.getAttribute('aria-label'));
  return !label || Boolean(title && title.trim() !== label);
}

export const TIP_GAP = 8;        // --s2 between the control and its tooltip
export const TIP_MARGIN = 4;     // the tooltip keeps this far inside the window
/** The order sides are tried in: under a control in a row (the title bar, a bar), beside a control in a column (the sidebar, the rail). */
export const TIP_SIDES = ['below', 'right', 'above', 'left'];
export const overlaps = (a, b) => a.left < b.right - 0.5 && b.left < a.right - 0.5 && a.top < b.bottom - 0.5 && b.top < a.bottom - 0.5;

/**
 * Where a tooltip of `size` ({ width, height }) goes beside `anchor` ({ left, top, right, bottom }) in a window of `view` ({ width, height }).
 * `cost(rect)` says what a placement would cover: 0 for nothing, more for each control under it (a control beside the anchor counts more).
 * Each side is centred on the anchor and kept inside the window; the first side in TIP_SIDES that fits and covers nothing wins, else the one
 * that covers least. A side that would cover the anchor itself is never taken. When the anchor's region (`region`, the sidebar opened
 * over the page, say) leaves no free side, the tooltip may go beside or under the region instead, level with the anchor.
 * Pure: the browser part is `tipCost`.
 */
export function placeTip(anchor, size, view, cost = () => 0, gap = TIP_GAP, region = null) {
  const m = TIP_MARGIN, clamp = (v, lo, hi) => Math.max(lo, Math.min(v, hi));
  const x = clamp(anchor.left + (anchor.right - anchor.left - size.width) / 2, m, view.width - m - size.width);
  const y = clamp(anchor.top + (anchor.bottom - anchor.top - size.height) / 2, m, view.height - m - size.height);
  const at = { below: [x, anchor.bottom + gap], above: [x, anchor.top - gap - size.height], right: [anchor.right + gap, y], left: [anchor.left - gap - size.width, y] };
  const sides = TIP_SIDES.map(side => [side, ...at[side]]);
  if (region) sides.push(['right', region.right + gap, y], ['below', x, region.bottom + gap]);
  let best = null;
  for (const [side, left, top] of sides) {
    const r = { side, left, top, right: left + size.width, bottom: top + size.height };
    if (r.left < m - 0.5 || r.top < m - 0.5 || r.right > view.width - m + 0.5 || r.bottom > view.height - m + 0.5 || overlaps(r, anchor)) continue;
    const c = cost(r);
    if (c === 0) return r;
    if (!best || c < best.c) best = { r, c };
  }
  if (best) return best.r;
  const left = x, top = clamp(anchor.bottom + gap, m, view.height - m - size.height);   // nothing fits (a window smaller than the tooltip): under it, inside the window
  return { side: 'below', left, top, right: left + size.width, bottom: top + size.height };
}

const CONTROL = 'button,a[href],input,select,textarea,summary,[role=button],[role=tab],[role=menuitem],[role=option],[tabindex]:not([tabindex="-1"])';
// The anchor's neighbours: the region it is in (the sidebar, the title bar, the status bar, a menu, a dialog, the list pane, the
// inspector), else the bar, row or tab list it belongs to.
const REGION = 'body > aside,main > .topbar,.statusbar,#status,[role=menu],.menu,dialog,.plist,.assist';
const GROUP = '.ui-bar,[role=toolbar],[role=tablist],.ui-row,.panel-head,nav';
/** What a tooltip at `r` would cover, read from the page: the controls under a grid of points no more than 12px apart; one of the
 * anchor's neighbours costs 10, any other 1, the anchor itself 100. */
export function tipCost(anchor, r, doc = document) {
  const group = anchor.closest(REGION) || anchor.closest(GROUP) || anchor.parentElement, seen = new Set();
  const cols = Math.max(2, Math.ceil((r.right - r.left) / 12) + 1), rows = Math.max(2, Math.ceil((r.bottom - r.top) / 12) + 1);
  let c = 0;
  for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) {
    const px = r.left + 1 + (r.right - r.left - 2) * i / (cols - 1), py = r.top + 1 + (r.bottom - r.top - 2) * j / (rows - 1);
    const hit = doc.elementFromPoint(px, py)?.closest(CONTROL);
    if (!hit || seen.has(hit)) continue;
    seen.add(hit);
    c += hit === anchor || anchor.contains(hit) || hit.contains(anchor) ? 100 : group && group.contains(hit) ? 10 : 1;
  }
  return c;
}

/**
 * The app's tooltips (called once by app.mjs, which says whether an element's text is clipped). On pointing at an element: an SVG <title> becomes the element's name, a fully labelled
 * row loses a title that only repeats it, and the nearest title left is shown by the one `.tooltip` element. While shown, the title
 * is held in `data-tip` (so the system draws none) and comes back when the pointer leaves, a press or a key ends it, or the page scrolls.
 */
export function wireTooltips({ doc = document, clippedText = () => false } = {}) {
  const win = doc.defaultView;
  let tip = null, anchor = null, held = '', settled = false;
  const ensure = () => {
    if (tip?.isConnected) return tip;
    tip = doc.createElement('div'); tip.className = 'tooltip'; tip.setAttribute('role', 'tooltip'); tip.id = 'app-tooltip';
    // The wait is over when the stylesheet's delayed transition starts: the control may have moved or shown its words since it was
    // pointed at (the rail reveals its labels), so the tooltip is placed again, or dropped when it would repeat the words now shown.
    tip.addEventListener('transitionstart', () => {
      if (!anchor || settled) return;
      settled = true;
      if (!anchor.isConnected || visibleText(anchor) === anchor.getAttribute('data-tip')) hide(); else place();
    });
    doc.body.append(tip); return tip;
  };
  const hide = () => {
    if (!anchor) return;
    if (!anchor.hasAttribute('title') && held) anchor.setAttribute('title', held);   // a title written while it was shown wins
    anchor.removeAttribute('data-tip'); anchor = null; held = '';
    tip?.removeAttribute('data-show'); tip?.removeAttribute('data-side');
  };
  // `cheap` places it by the window alone: what it would cover is read (a hit test every 12 px of each side tried) only once the wait is over,
  // so a pointer passing over a list of titled rows does no hit testing at all.
  const place = (cheap = false) => {
    const t = ensure(), a = anchor.getBoundingClientRect(), size = { width: t.offsetWidth, height: t.offsetHeight };
    const region = anchor.closest(REGION)?.getBoundingClientRect() || null;
    const r = placeTip(a, size, { width: win.innerWidth, height: win.innerHeight }, cheap ? () => 0 : rect => tipCost(anchor, rect, doc), TIP_GAP, region);
    t.style.left = `${Math.round(r.left)}px`; t.style.top = `${Math.round(r.top)}px`;
    t.setAttribute('data-side', r.side);
  };
  const show = el => {
    hide();
    const text = (el.getAttribute('title') || '').trim();
    if (!text) return;
    anchor = el; held = el.getAttribute('title'); settled = false;
    el.setAttribute('data-tip', text); el.removeAttribute('title');
    // the words go into the one text node the tooltip keeps: a node put into a child of <body> sends the stylesheet's :has() rules
    // (body:has(> .start)) through the whole page, a full style recalculation; changed text does not
    const t = ensure(); if (t.firstChild?.nodeType === 3 && !t.firstChild.nextSibling) t.firstChild.data = text; else t.textContent = text;
    t.style.left = '0px'; t.style.top = '0px';
    place(true); t.setAttribute('data-show', '');
    if (!t.getAnimations?.().length) { settled = true; place(); }   // no wait to run out (transitions off): placed in full now
  };
  doc.addEventListener('pointerover', e => {
    if (e.pointerType === 'touch') return;
    let titled = null;
    for (let n = e.target; n && n !== doc.documentElement; n = n.parentElement) {
      // A chart or figure's own <title> is a tooltip too: it becomes the label.
      if (n instanceof win.SVGElement) {
        const t = [...n.children].find(c => c.tagName.toLowerCase() === 'title');
        if (t) { if (!n.hasAttribute('aria-label')) n.setAttribute('aria-label', t.textContent); t.remove(); }
        continue;
      }
      if (!(n instanceof win.HTMLElement)) continue;
      if (n === anchor) { titled = titled || n; break; }
      const keep = preserveControlTooltip(n);   // an icon-only control gets its name as its title here
      if (!n.hasAttribute('title')) continue;
      if (keep || clippedText(n)) { titled = titled || n; continue; }
      if (!n.hasAttribute('aria-label') && !n.textContent.trim()) n.setAttribute('aria-label', n.getAttribute('title'));
      n.removeAttribute('title');
    }
    if (titled !== anchor) { if (titled) show(titled); else hide(); }
  }, true);
  doc.addEventListener('pointerout', e => { if (anchor && !(e.relatedTarget instanceof win.Node && anchor.contains(e.relatedTarget))) hide(); }, true);
  for (const type of ['pointerdown', 'keydown', 'wheel', 'scroll']) doc.addEventListener(type, hide, { capture: true, passive: true });
  win.addEventListener('blur', hide);
  doc.addEventListener('focusin', e => { if (e.target instanceof win.HTMLElement) preserveControlTooltip(e.target); }, true);
  return { hide };
}
