// The manuscript's caret: the height of the text, never of the line.
//
// The page reproduces the document's own typography, so a paragraph set at double line spacing has line boxes twice as tall as its
// glyphs, and an engine that draws its native caret at the height of the line box (WKWebView does) shows a bar that reaches into the
// line above. The page hides the native caret while this one is shown (#page[data-own-caret]) and draws a thin box where the
// collapsed selection is: as high as the font's ascent plus descent at the caret, centred on the line the selection reports, so
// line spacing 1.0, 2.0, an exact point value or space before and after change nothing.
//
// It never takes the pointer, never changes layout (it is positioned inside the scroller, which scrolls it with the page) and
// gives the native caret back whenever it cannot place itself.

/** Where a collapsed selection is, in viewport pixels: { x, cy } (cy = the vertical centre of the line's text), or null. */
function pointOf(range, host) {
  const rects = [...range.getClientRects()].filter(r => r.height > 0);
  if (rects.length) { const r = rects.at(-1); return { x: r.left, cy: r.top + r.height / 2 }; }
  // an engine that reports nothing for a collapsed range: the character before the caret (its right edge), else the one after (its left edge)
  const text = range.startContainer;
  if (text.nodeType === 3) {
    for (const [from, to, edge] of [[range.startOffset - 1, range.startOffset, 'right'], [range.startOffset, range.startOffset + 1, 'left']]) {
      if (from < 0 || to > text.length) continue;
      const probe = range.cloneRange(); probe.setStart(text, from); probe.setEnd(text, to);
      const r = [...probe.getClientRects()].filter(x => x.height > 0).at(-1);
      if (r) return { x: r[edge], cy: r.top + r.height / 2 };
    }
  }
  // an empty paragraph, or a line end an engine does not report: the box that holds the caret, its first line
  const node = range.startContainer, el = node.nodeType === 1 ? node : node.parentElement;
  const block = el?.closest?.('.mb-edit,.mb-cell,.mb-note,.para') || el;
  if (!block || !host.contains(block)) return null;
  const box = block.getBoundingClientRect(), cs = block.ownerDocument.defaultView.getComputedStyle(block);
  if (!box.width && !box.height) return null;
  const z = block.offsetWidth ? box.width / block.offsetWidth : 1, fs = parseFloat(cs.fontSize) || 16;
  const lh = cs.lineHeight === 'normal' ? fs * 1.2 : parseFloat(cs.lineHeight) || fs * 1.2;
  const pad = n => (parseFloat(n) || 0) * z;
  const inner = box.width - pad(cs.paddingLeft) - pad(cs.paddingRight);
  const x = cs.textAlign === 'center' ? box.left + pad(cs.paddingLeft) + inner / 2 : cs.textAlign === 'right' || cs.textAlign === 'end' ? box.right - pad(cs.paddingRight) : box.left + pad(cs.paddingLeft);
  return { x, cy: box.top + pad(cs.paddingTop) + (lh * z) / 2 };
}

/**
 * Mount the caret over `scroll` (the page's scroller) for the editing host `page`. Returns { update, dispose }. `signal` ends it.
 * The caret is hidden while the selection is a range, is outside the page, or the page is not focused.
 */
export function mountCaret({ scroll, page, signal } = {}) {
  if (!scroll || !page) return { update() {}, dispose() {} };
  const doc = scroll.ownerDocument, win = doc.defaultView;
  if (typeof doc?.createElement !== 'function' || typeof win?.getSelection !== 'function') return { update() {}, dispose() {} };   // a page without a selection to read (the Node fixture)
  const caret = doc.createElement('div'), probe = doc.createElement('span');
  caret.className = 'ms-caret'; caret.hidden = true; caret.setAttribute('aria-hidden', 'true');
  probe.className = 'ms-caret-probe'; probe.setAttribute('aria-hidden', 'true'); probe.textContent = 'Hg';
  scroll.append(caret, probe);
  let frame = 0, shown = false;
  const hide = () => { if (shown) { caret.hidden = true; shown = false; } page.removeAttribute('data-own-caret'); };
  const update = () => {
    const sel = win.getSelection();
    if (!sel?.rangeCount || !sel.isCollapsed || !page.contains(sel.anchorNode) || !page.contains(doc.activeElement)) return hide();
    const range = sel.getRangeAt(0), node = range.startContainer, el = node.nodeType === 1 ? node : node.parentElement;
    if (!el || !el.closest) return hide();
    const at = pointOf(range, page);
    if (!at) return hide();
    // the text's own height: the font at the caret, one line, at the page's scale (zoom and fitting scale the glyphs, not this box)
    const cs = win.getComputedStyle(el), block = el.closest('.mb-edit,.mb-cell,.mb-note,.para') || el;
    const z = block.offsetWidth ? block.getBoundingClientRect().width / block.offsetWidth : 1;
    probe.style.fontFamily = cs.fontFamily; probe.style.fontSize = cs.fontSize; probe.style.fontWeight = cs.fontWeight; probe.style.fontStyle = cs.fontStyle;
    const h = probe.getBoundingClientRect().height * (z || 1);
    if (!(h > 0)) return hide();
    const box = scroll.getBoundingClientRect();
    const left = at.x - box.left + scroll.scrollLeft - scroll.clientLeft, top = at.cy - h / 2 - box.top + scroll.scrollTop - scroll.clientTop;
    const moved = caret.style.left !== `${left}px` || caret.style.top !== `${top}px`;
    caret.style.left = `${left}px`; caret.style.top = `${top}px`; caret.style.height = `${h}px`; caret.style.background = cs.color;
    if (!shown || moved) { caret.style.animation = 'none'; void caret.offsetWidth; caret.style.animation = ''; }   // a moved caret is solid first, then blinks
    caret.hidden = false; shown = true;
    page.setAttribute('data-own-caret', '');
  };
  const soon = () => { if (!frame) frame = win.requestAnimationFrame(() => { frame = 0; update(); }); };
  const on = (target, type, fn, opts) => target.addEventListener(type, fn, { ...opts, signal });
  on(doc, 'selectionchange', update);
  on(page, 'input', soon); on(page, 'compositionupdate', soon); on(page, 'compositionend', soon);
  on(page, 'focusin', soon); on(page, 'focusout', soon); on(page, 'keyup', soon); on(page, 'mouseup', soon);
  on(win, 'resize', soon); on(doc, 'scroll', soon, { capture: true });
  const dispose = () => { win.cancelAnimationFrame(frame); frame = 0; hide(); caret.remove(); probe.remove(); };
  signal?.addEventListener('abort', dispose, { once: true });
  soon();
  return { update, dispose };
}
