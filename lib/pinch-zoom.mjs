// The trackpad pinch for a scrolled document: the PDF views (views/pdf-file.mjs, views/reader.mjs), the Word view (views/file-doc.mjs) and
// the Manuscript page. WebKit, the desktop app's engine, reports a pinch as gesturestart, gesturechange and gestureend with the scale since
// the pinch began; Chromium and Firefox report it as a wheel event with ctrlKey, and a mouse wheel with Control or Command does the same.
// The point under the fingers stays under them: `units` are the blocks the view lays out (pages, paragraphs), and the one under the pointer
// is found again, by its place in the list, after the new scale is applied.
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const WHEEL_END = 160;   // ms without a zooming wheel event: the pinch has ended (a wheel has no end event); the option wheelEnd sets another

/** A zooming wheel event as a scale factor: a pinch sends many small deltas, a mouse notch one large one, which is held to a step of about a quarter. */
export function wheelFactor(e) {
  const d = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1);
  return Math.exp(-clamp(d, -25, 25) * 0.01);
}

/**
 * Pinch zoom over `target`, which is or sits in the scroller (`scroller`: the element or a function giving it; the target by default).
 * `get()` is the scale shown; `set(next)` applies one (it may lay the units out again and may return a promise).
 * `live`: set() runs on every frame, for a change that costs one style write (a CSS zoom, a transform). Otherwise the units are scaled by a
 * transform while the fingers move and set() runs once when they stop, for a view that draws its pages again at a new scale.
 * `done()` runs when a pinch has been applied. Returns stop().
 */
export function pinchZoom(target, { get, set, units, min = 0.25, max = 4, live = false, scroller: of = target, done = () => {}, wheelEnd = WHEEL_END }) {
  const stop = new AbortController(), on = { signal: stop.signal };
  let scroller = target;
  let g = null, frame = 0, idle = 0, busy = false;
  const list = () => [...target.querySelectorAll(units)];

  // the unit under the point (else the nearest above or below it) and where in it the point is, as fractions
  const anchorAt = (x, y) => {
    const all = list();
    let best = -1, gap = Infinity;
    all.forEach((u, i) => { const r = u.getBoundingClientRect(), d = y < r.top ? r.top - y : y > r.bottom ? y - r.bottom : 0; if (d < gap) { gap = d; best = i; } });
    if (best < 0) return null;
    const r = all[best].getBoundingClientRect();
    return { i: best, fx: r.width ? clamp((x - r.left) / r.width, 0, 1) : 0, fy: r.height ? clamp((y - r.top) / r.height, 0, 1) : 0 };
  };
  // the scroller moved so the anchor's point is back under (x, y)
  const reanchor = (a, x, y) => {
    const u = a && list()[a.i];
    if (!u) return;
    const r = u.getBoundingClientRect();
    scroller.scrollLeft += r.left + a.fx * r.width - x;
    scroller.scrollTop += r.top + a.fy * r.height - y;
  };
  // while the fingers move (not live): each unit drawn as if the whole content were scaled about the point
  const preview = () => {
    const s = g.next / g.from;
    for (const b of g.boxes) {
      b.el.style.transformOrigin = '0 0';
      b.el.style.transform = s === 1 ? '' : `translate(${(b.x - g.px) * (s - 1)}px, ${(b.y - g.py) * (s - 1)}px) scale(${s})`;
    }
  };
  const clear = boxes => { for (const b of boxes || []) { b.el.style.transform = ''; b.el.style.transformOrigin = ''; } };

  const begin = (x, y, gesture) => {
    scroller = (typeof of === 'function' ? of() : of) || target;
    const from = get(), sr = scroller.getBoundingClientRect();
    g = { from, next: from, x, y, gesture, anchor: anchorAt(x, y), px: x - sr.left + scroller.scrollLeft, py: y - sr.top + scroller.scrollTop, boxes: [] };
    if (!live) g.boxes = list().map(el => { const r = el.getBoundingClientRect(); return { el, x: r.left - sr.left + scroller.scrollLeft, y: r.top - sr.top + scroller.scrollTop }; });
  };
  const paint = () => {
    frame = 0;
    if (!g) return;
    if (!live) { preview(); return; }
    if (Math.abs(g.next - get()) < 1e-4) return;
    set(g.next); reanchor(g.anchor, g.x, g.y);
  };
  const change = (next, x, y) => {
    g.next = clamp(next, min, max); g.x = x; g.y = y;
    if (!frame) frame = requestAnimationFrame(paint);
  };
  const finish = async () => {
    clearTimeout(idle); cancelAnimationFrame(frame); frame = 0;
    const end = g; g = null;
    if (!end) return;
    if (live) { if (Math.abs(end.next - get()) >= 1e-4) { set(end.next); reanchor(end.anchor, end.x, end.y); } done(); return; }
    clear(end.boxes);
    if (Math.abs(end.next - end.from) < 1e-3) return;
    busy = true;
    try { await set(end.next); reanchor(end.anchor, end.x, end.y); done(); } finally { busy = false; }
  };

  target.addEventListener('wheel', e => {
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    if (busy || g?.gesture) return;
    if (!g) begin(e.clientX, e.clientY, false);
    change(g.next * wheelFactor(e), e.clientX, e.clientY);
    clearTimeout(idle); idle = setTimeout(finish, wheelEnd);
  }, { passive: false, ...on });
  target.addEventListener('gesturestart', e => {
    e.preventDefault();
    if (busy) return;
    if (g) finish();
    begin(e.clientX, e.clientY, true);
  }, on);
  target.addEventListener('gesturechange', e => { e.preventDefault(); if (g?.gesture) change(g.from * e.scale, e.clientX, e.clientY); }, on);
  target.addEventListener('gestureend', e => { e.preventDefault(); if (g?.gesture) finish(); }, on);
  return () => { clearTimeout(idle); cancelAnimationFrame(frame); clear(g?.boxes); g = null; stop.abort(); };
}
