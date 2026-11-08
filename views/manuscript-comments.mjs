// The Manuscript reader's marks and their one card (views/manuscript-reader.mjs; the checks' model in lib/manuscript-comments.mjs).
// 3 Nov 2026, the owner, with the App view and its empty right half: "we could also use the right space for AI comments like Grammarly
// suggestions UI you know highlight the text and show your comments". 7 Nov 2026, on the first version's 104 cards stacked beside the text,
// most of them hundreds of pixels below their words: "i wanted it to be like grammarly with like highlights underlines etc and you did many
// cards we don't need that many cards maybe and they dont align with the lines as well".
//
// So the marks live in the text and the margin carries almost nothing. Each kind is one rule under its words: a number with its source a
// dotted rule (views/manuscript-reader.mjs), a check of style (a long sentence, an abbreviation before its definition, a hyphen range) a
// dashed one, what the authors still owe (a blank, a number whose data changed since the build or whose source does not hold it) a solid
// rule in the warning colour, a model's answer on a passage a quiet fill. At rest the margin holds one quiet count per paragraph that has
// something to look at, level with its first line. One card at a time: the pointed mark's (a preview, kept until another mark is pointed
// or the pointer leaves the reader) or the pressed one's (kept until Esc or a press on plain text), its top on the top of the mark's line,
// placed again whenever the reader's box changes size (a resize, a pinch's zoom, a figure drawn above it). The card groups the line: the
// pointed mark first, then every other mark on that line that has something to say. Option-Down and Option-Up step from mark to mark.
// Where the reader is too narrow for the margin the card stands under the line instead. Selecting text shows a small bar at the selection
// (uiBar, popover) with Explain, Suggest a rewrite and Check: the request goes through the app's one model path (lib/ai.mjs complete, the run
// preview's question when a connection may not yet receive the manuscript's text) to the writing task's model, and the answer is a mark of its
// own, kept in the project by file and version. A rewrite is a proposal: Accept copies it for the Word view's Edit text; the built file is
// never written here. Loaded after the first paint.
import { lib_html$esc as esc } from "../boot.mjs";
import { lib_ui_actions$uiBar as uiBar, lib_ui_actions$watchWidth as watchWidth } from "../boot.mjs";
import { titleOnly } from '../lib/table-fit.mjs';
import { locateAnchor } from '../lib/file-notes.mjs';
import { store$get as get, store$update as update } from "../boot.mjs";
import { KINDS, anchorAt, checkComments, commentsOf, cardsToShow, addModelComment, dismissComment, resolveComment } from '../lib/manuscript-comments.mjs';

// the width of the reader's text column that holds the margin beside the text: below it the card stands under its line
const WIDE = 760;   // of the text column: a reading measure of at least 440 px beside the 256 px column and its gap
// the icons of the matching model actions (lib/icons.mjs ACTION_ICONS: revise-paragraph draft, check-claims check-square); an explanation is the book
const ASKS = { explain: { label: 'Explain', icon: 'book' }, rewrite: { label: 'Suggest a rewrite', icon: 'draft' }, check: { label: 'Check', icon: 'check-square' } };
const LIMIT = { passage: 1600, paragraph: 4000 };   // characters sent of a selection and of its paragraph
/** The marks a card can show: a check's or an answer's words, a number with its source, a citation. */
export const MARKS = '.msd-cm-span, .msd-num, .msd-cite[data-refs], .msd-cite[data-keys]';
const POINT = 120;   // ms the pointer rests on a mark before its card shows: a pass across the text shows nothing
const SAME_LINE = 4;   // px: marks whose first boxes start this close stand on one line

/** The first box of a mark: the top of the line it starts on. */
const lineOf = el => el.getClientRects()[0] || el.getBoundingClientRect();

/**
 * Mounts the marks' card and counts on the reader `state` (its root, model, doc, registration and scroller). Returns { place, added(from),
 * refit, point(el, pinned), step(by), stop }. `state.el` holds the page; `state.root` the reader's grid; `state.model.units` the text;
 * `state.stale` what changed since the build; `state.markHtml(el)` and `state.markAct(target)` the reader's own words for a number or a
 * citation and its presses.
 */
export function mountComments(state) {
  const { root, model, doc } = state, file = doc.file, version = state.e?.edited?.sha256 || state.e?.sha256 || state.stamp || '';
  const main = root.querySelector('.msd-main'), body = () => state.el.querySelector('[data-doc-body]');
  const checks = checkComments(model, { stale: state.stale, cross: state.src?.check?.cross });
  const col = document.createElement('aside');
  col.className = 'msd-cm-col'; col.setAttribute('aria-label', 'Marks by paragraph');
  const card = document.createElement('section');
  card.className = 'msd-cm-card'; card.hidden = true; card.tabIndex = -1;
  card.setAttribute('aria-label', 'Mark'); card.setAttribute('aria-live', 'polite');
  main.append(col);
  const self = { shown: [], byId: new Map(), running: new Map(), stops: [], open: null, timer: 0 };
  const record = () => commentsOf(get(), file);

  // ---- the checks and answers, and their words ------------------------------------------------------------------------------------
  const list = () => {
    const r = record(), live = [...self.running.values()].map(c => ({ card: c, at: { unit: c.anchor.unit, start: c.anchor.start, end: c.anchor.end, moved: false, outdated: false }, resolved: false }));
    self.shown = [...cardsToShow(model.units, checks, r), ...live].sort((a, b) => a.at.unit - b.at.unit || a.at.start - b.at.start);
    self.byId = new Map(self.shown.map(x => [x.card.id, x]));
    return self.shown;
  };
  // something to look at: every check and answer that is not resolved or outdated (a number with its source is only looked up)
  const looks = x => !x.resolved && !x.at.outdated;

  // the span of a located check in its unit on the page: the text nodes it covers, each piece wrapped
  // (the unit's text on the page can differ from the model's by a mark or two: the quote is found again with the words around it)
  const markSpan = (unitEl, text, x) => {
    const { at } = x, id = x.card.id, shown = unitEl.textContent, quote = text.slice(at.start, at.end);
    const hit = quote && locateAnchor(shown, { quote, start: at.start, end: at.end, prefix: text.slice(Math.max(0, at.start - 40), at.start), suffix: text.slice(at.end, at.end + 40) });
    const start = hit ? hit.start : at.start, end = hit ? hit.end : at.end;
    if (end <= start) return;
    const walk = document.createTreeWalker(unitEl, NodeFilter.SHOW_TEXT), pieces = [];
    let off = 0;
    for (let t = walk.nextNode(); t; t = walk.nextNode()) {
      const a = Math.max(start, off), z = Math.min(end, off + t.length);
      if (z > a) pieces.push({ t, a: a - off, z: z - off });
      off += t.length;
    }
    const k = KINDS[x.card.kind] || KINDS.model;
    for (const { t, a, z } of pieces) {
      const mid = a > 0 ? t.splitText(a) : t;
      if (z - a < mid.length) mid.splitText(z - a);
      const wrap = mid.parentElement.closest('.msd-cm-span');
      if (wrap && wrap.textContent === mid.textContent) { wrap.dataset.cm = `${wrap.dataset.cm} ${id}`; if (k.tone) wrap.dataset.tone = k.tone; continue; }
      const span = document.createElement('span');
      span.className = 'msd-cm-span'; span.dataset.cm = id; span.dataset.kind = x.card.kind;
      if (k.tone) span.dataset.tone = k.tone;
      if (x.resolved) span.dataset.done = '';
      mid.replaceWith(span); span.append(mid);
    }
  };
  const unitEl = k => state.el.querySelector(`.msd-u[data-u="${k}"]`);
  const spansOf = id => state.el.querySelectorAll(`.msd-cm-span[data-cm~="${CSS.escape(id)}"]`);
  const clearSpans = (from = 0) => { for (const s of state.el.querySelectorAll('.msd-cm-span')) { if (+s.closest('.msd-u')?.dataset.u < from) continue; s.replaceWith(...s.childNodes); } };

  // ---- drawing: the words' marks and each paragraph's count ------------------------------------------------------------------------
  let mode = '';
  const decide = () => { const w = main.clientWidth; if (!w) return mode || 'under'; return titleOnly(w, WIDE) ? 'under' : 'margin'; };
  const draw = (from = 0) => {
    const shown = list();
    if (from === 0) { clearSpans(); for (const c of [...col.querySelectorAll('.msd-cm-count')]) c.remove(); }
    // the card hangs in the margin's column, or under its line in the text's column where there is no margin (its left edge and width are the
    // stylesheet's; only its top is the mark's)
    const host = mode === 'margin' ? col : main;
    if (card.parentElement !== host) host.append(card);
    const byUnit = new Map();
    for (const x of shown) { if (x.at.unit < from) continue; (byUnit.get(x.at.unit) || byUnit.set(x.at.unit, []).get(x.at.unit)).push(x); }
    for (const [k, xs] of byUnit) {
      const u = unitEl(k);
      if (!u) continue;   // not on the page yet: drawn with the part that brings it (added)
      for (const x of xs) if (!x.at.outdated) { try { markSpan(u, model.units[k].text || '', x); } catch { /* the words are not on the page as the text has them */ } }
      const n = xs.filter(looks).length;
      if (!n) continue;
      // a figure to read, not a control: the marks are pointed at in the text, and Option-Down steps to them
      const b = document.createElement('span');
      b.className = 'msd-cm-count'; b.dataset.u = String(k); b.textContent = String(n);
      b.title = `${n} ${n === 1 ? 'mark' : 'marks'} in this paragraph; Option-Down steps from mark to mark`;
      col.append(b);
    }
    main.dataset.comments = mode;
    main.dataset.commentsN = String(shown.filter(looks).length);
    const open = self.open;
    if (open && !open.el.isConnected) {
      // the words were wrapped again: the same mark, found by what it was
      const again = open.id && (spansOf(open.id)[0] || state.el.querySelector(open.id.startsWith('n:') ? `.msd-num[data-n="${open.id.slice(2)}"]` : ''));
      if (again) show(again, open.pinned); else close();
    } else if (open) show(open.el, open.pinned);
    place();
  };

  // ---- the one card -----------------------------------------------------------------------------------------------------------------
  const idOf = el => (el.classList.contains('msd-cm-span') ? el.dataset.cm.split(' ')[0] : el.classList.contains('msd-num') ? `n:${el.dataset.n}` : '');
  /** The marks of `el`'s line that a card lists: `el`'s own first, then the others on the line with something to say, left to right. */
  const lineMarks = el => {
    const u = el.closest('.msd-u'), top = lineOf(el).top, rows = [];
    const add = (kind, node, id) => { if (!rows.some(r => r.id === id && r.kind === kind)) rows.push({ kind, node, id }); };
    const own = node => {
      if (node.classList.contains('msd-num')) { add('number', node, `n:${node.dataset.n}`); for (const s of node.querySelectorAll('.msd-cm-span')) for (const id of s.dataset.cm.split(' ')) add('check', s, id); }
      else if (node.classList.contains('msd-cite')) add('cite', node, `c:${[...u.querySelectorAll('.msd-cite')].indexOf(node)}`);
      else { for (const id of node.dataset.cm.split(' ')) add('check', node, id); const num = node.closest('.msd-num'); if (num) add('number', num, `n:${num.dataset.n}`); }
    };
    own(el);
    const first = rows.length;
    for (const s of u ? u.querySelectorAll('.msd-cm-span') : []) {
      if (s === el || Math.abs(lineOf(s).top - top) > SAME_LINE) continue;
      for (const id of s.dataset.cm.split(' ')) { const x = self.byId.get(id); if (x && looks(x)) add('check', s, id); }
    }
    const rest = rows.slice(first).sort((a, b) => lineOf(a.node).left - lineOf(b.node).left);
    return [...rows.slice(0, first), ...rest];
  };
  const checkHtml = (x, current) => {
    const { card: c, at, resolved } = x, k = KINDS[c.kind] || KINDS.model, isModel = c.kind === 'model';
    const head = isModel ? ASKS[c.ask]?.label || 'Answer' : k.label, who = isModel ? c.model || 'model' : 'Lykos check';
    let text = '';
    if (c.running) text = `<p class="msd-mk-text"><span class="ui-progress-ring" aria-hidden="true"></span>Asking ${esc(c.model)}…</p>`;
    else if (c.error) text = `<p class="msd-mk-text" data-tone="stopped">${esc(c.error)}</p>`;
    else if (c.ask === 'check' && c.checks) text = `<ul class="msd-mk-checks">${c.checks.map(v => `<li data-verdict="${esc(v.verdict)}"><span class="msd-mk-verdict">${esc(verdictLabel(v.verdict))}</span> ${esc(v.quote)}${v.why ? ` — ${esc(v.why)}` : ''}${v.evidence ? `<span class="msd-mk-evidence">${esc(v.evidence)}</span>` : ''}</li>`).join('')}</ul>${c.text ? `<p class="msd-mk-text">${esc(c.text)}</p>` : ''}`;
    else if (c.ask === 'rewrite') text = `<p class="msd-mk-text msd-mk-proposal">${esc(c.proposal || c.text || '')}</p>`;
    else text = `<p class="msd-mk-text">${esc(c.text || '')}</p>${c.fix ? `<p class="msd-mk-fix">${esc(c.fix)}</p>` : ''}`;
    const more = c.more?.length ? `<p class="msd-mk-fix">${esc(`${c.more.length} more in this paragraph: ${c.more.join(', ')}`)}</p>` : '';
    const note = at.outdated ? '<p class="msd-mk-note">Outdated</p>' : at.moved ? '<p class="msd-mk-note">Re-anchored</p>' : resolved ? '<p class="msd-mk-note">Resolved</p>' : '';
    return `<div class="msd-mk" data-mk="${esc(c.id)}" data-kind="${esc(c.kind)}"${k.tone ? ` data-tone="${esc(k.tone)}"` : ''}${current ? ' aria-current="true"' : ''}><p class="msd-mk-top"><span class="msd-mk-kind">${esc(head)}</span><span class="msd-mk-by">${esc(who)}</span></p>${text}${more}${note}</div>`;
  };
  const actsOf = x => {
    if (!x || x.card.running) return [];
    const c = x.card;
    if (c.kind !== 'model') return [{ id: 'msd-mk-dismiss', label: 'Dismiss', role: 'quiet' }];
    return [c.ask === 'rewrite' && !x.resolved ? { id: 'msd-mk-accept', label: 'Accept', role: 'secondary' } : { id: 'msd-mk-resolve', label: x.resolved ? 'Reopen' : 'Resolve', role: 'quiet' }, { id: 'msd-mk-dismiss', label: 'Dismiss', role: 'quiet' }];
  };
  let drawing = 0;
  async function show(el, pinned) {
    const ticket = ++drawing, rows = lineMarks(el);
    const parts = [];
    for (const [i, r] of rows.entries()) {
      if (r.kind === 'check') { const x = self.byId.get(r.id); if (x) parts.push(checkHtml(x, i === 0)); continue; }
      let html = '';
      try { html = await state.markHtml?.(r.node) || ''; } catch { html = ''; }
      if (ticket !== drawing) return;
      if (!html) continue;
      const head = r.kind === 'number' ? `<p class="msd-mk-top"><span class="msd-mk-kind">${esc(r.node.textContent)}</span><span class="msd-mk-by">Source</span></p>` : `<p class="msd-mk-top"><span class="msd-mk-kind">Cited</span></p>`;
      parts.push(`<div class="msd-mk" data-kind="${r.kind}"${i === 0 ? ' aria-current="true"' : ''}>${head}${html}</div>`);
    }
    if (ticket !== drawing) return;
    if (!parts.length) { close(); return; }
    for (const m of state.el.querySelectorAll('.msd-doc .on')) if (m.matches(MARKS)) m.classList.remove('on');
    const current = rows[0]?.kind === 'check' ? self.byId.get(rows[0].id) : null, acts = actsOf(current);
    card.innerHTML = parts.join('') + (acts.length ? uiBar({ kind: 'foot', label: 'Mark', density: 'dense', actions: acts }) : '');
    card.hidden = false;
    card.dataset.pinned = pinned ? 'true' : 'false';
    self.open = { el, id: idOf(el), pinned: !!pinned, current: current?.card.id || '' };
    for (const r of rows.slice(0, 1)) for (const m of r.kind === 'check' ? spansOf(r.id) : [r.node]) m.classList.add('on');
    place();
  }
  function close() {
    clearTimeout(self.timer); drawing++;
    if (!self.open && card.hidden) return;
    self.open = null; card.hidden = true; card.textContent = '';
    for (const m of state.el.querySelectorAll('.msd-doc .on')) if (m.matches(MARKS)) m.classList.remove('on');
    for (const c of col.querySelectorAll('[data-covered]')) delete c.dataset.covered;
  }

  /** Each count level with its paragraph's first line, the card level with its mark's line (or under it), counts it covers hidden. */
  function place() {
    if (!main.isConnected) return;
    // every read first (one layout), then every write
    const m = main.getBoundingClientRect(), c = col.getBoundingClientRect(), wide = mode === 'margin' && card.parentElement === col;
    const counts = wide ? [...col.children].map(b => { const u = unitEl(b.dataset.u), f = u?.firstElementChild || u; return { b, top: f ? f.getBoundingClientRect().top - c.top : null }; }) : [];
    let top = null;
    if (self.open && !card.hidden) { const line = lineOf(self.open.el); top = wide ? line.top - c.top : line.bottom - m.top + 6; }
    for (const x of counts) x.b.style.setProperty('top', `${Math.round(x.top ?? 0)}px`);
    if (top !== null) {
      card.style.setProperty('top', `${Math.round(top)}px`);
      const h = card.offsetHeight;
      for (const x of counts) if (x.top !== null && x.top >= top - 18 && x.top <= top + h) x.b.dataset.covered = ''; else delete x.b.dataset.covered;
    } else for (const x of counts) delete x.b.dataset.covered;
  }
  const refit = () => { const md = decide(); if (md !== mode) { mode = md; draw(0); } else place(); };
  mode = decide();
  draw(0);
  // the width decides the mode (the reader's root is measured by the width engine already, lib/narrow.mjs); the reader's box changing size
  // (a resize, a pinch's zoom wrapping the lines again, a picture or a chart drawn above) places the counts and the card again
  const onWidth = () => refit();
  root.addEventListener('ui-width', onWidth); self.stops.push(() => root.removeEventListener('ui-width', onWidth));
  self.stops.push(watchWidth(main, () => requestAnimationFrame(refit), { rows: true }));
  const onLoad = ev => { if (ev.target?.tagName === 'IMG') place(); };
  body()?.addEventListener('load', onLoad, true); self.stops.push(() => body()?.removeEventListener('load', onLoad, true));

  // ---- pointing, pressing and stepping -------------------------------------------------------------------------------------------------
  const point = (el, pinned) => { clearTimeout(self.timer); if (!el?.isConnected) return; show(el, pinned); };
  const docEl = body();
  const onOver = ev => {
    const el = ev.target.closest?.(MARKS);
    if (!el || self.open?.pinned) return;
    if (self.open?.el === el) { clearTimeout(self.timer); return; }
    clearTimeout(self.timer); self.timer = setTimeout(() => point(el, false), POINT);
  };
  const onLeave = () => { clearTimeout(self.timer); if (self.open && !self.open.pinned) close(); };
  const onPress = ev => {
    if (ev.target.closest?.('.msd-ref, [data-out], [data-doi], a')) return;
    const el = ev.target.closest?.(MARKS);
    if (el) { point(el, true); return; }
    if (self.open?.pinned && !getSelection()?.toString()) close();
  };
  const onFocus = ev => { const el = ev.target.closest?.(MARKS); if (el && !self.open?.pinned) point(el, false); };
  const onKeyDoc = ev => { const el = (ev.key === 'Enter' || ev.key === ' ') && ev.target.closest?.(MARKS); if (el) { ev.preventDefault(); point(el, true); card.focus({ preventScroll: true }); } };
  docEl?.addEventListener('pointerover', onOver); docEl?.addEventListener('click', onPress); docEl?.addEventListener('focusin', onFocus); docEl?.addEventListener('keydown', onKeyDoc);
  main.addEventListener('pointerleave', onLeave);
  self.stops.push(() => { docEl?.removeEventListener('pointerover', onOver); docEl?.removeEventListener('click', onPress); docEl?.removeEventListener('focusin', onFocus); docEl?.removeEventListener('keydown', onKeyDoc); main.removeEventListener('pointerleave', onLeave); });

  /** The marks with something to say, in reading order: the first span of each. */
  // and every unmatched number: a paragraph's card folds all but its first, so each is a stop of its own
  const order = () => {
    const cards = self.shown.filter(looks).map(x => ({ x, el: spansOf(x.card.id)[0] })).filter(o => o.el);
    const nums = [...(state.el?.querySelectorAll('.msd-num.is-unmatched') || [])].filter(el => !cards.some(o => o.el === el || o.el.contains(el) || el.contains(o.el)))
      .map(el => ({ x: { card: { id: `n:${el.dataset.n}` } }, el }));
    return nums.length ? [...cards, ...nums].sort((a, b) => (a.el.compareDocumentPosition(b.el) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1)) : cards;
  };
  function step(by) {
    const all = order();
    if (!all.length) return;
    const cur = self.open?.current || self.open?.id;
    let i = cur ? all.findIndex(o => o.x.card.id === cur) : -1;
    if (i < 0) {
      // from the reading place: the first mark below the top of the view, or the last above it going back
      const sc = scrollerOf(state.el), top = sc ? sc.getBoundingClientRect().top : 0;
      const below = all.findIndex(o => lineOf(o.el).top >= top);
      i = by > 0 ? (below < 0 ? all.length : below) - 1 : below < 0 ? all.length : below;
    }
    const next = all[i + by];
    if (!next) return;
    next.el.scrollIntoView({ block: 'center', behavior: 'auto' });
    point(next.el, true);
    card.focus({ preventScroll: true });
  }
  const onKey = ev => {
    if (!main.isConnected || ev.target.closest?.('input, textarea, select, [contenteditable="true"], [contenteditable=""], dialog')) return;
    if (ev.key === 'Escape' && self.open) { close(); return; }
    if (ev.altKey && !ev.metaKey && !ev.ctrlKey && (ev.key === 'ArrowDown' || ev.key === 'ArrowUp')) { ev.preventDefault(); step(ev.key === 'ArrowDown' ? 1 : -1); }
  };
  document.addEventListener('keydown', onKey); self.stops.push(() => document.removeEventListener('keydown', onKey));

  // the card's presses: its marks' own links (a number's output, a reference), a row made current, and the current mark's acts
  card.addEventListener('click', ev => {
    const t = ev.target;
    if (state.markAct?.(t)) { close(); return; }
    const id = self.open?.current;
    if (t.closest('#msd-mk-dismiss') && id) { update(s => dismissComment(s, file, id)); self.running.delete(id); close(); draw(0); return; }
    if (t.closest('#msd-mk-resolve') && id) { const done = !record().resolved[id]; update(s => resolveComment(s, file, id, done)); draw(0); return; }
    if (t.closest('#msd-mk-accept') && id) { accept(id); return; }
    const row = t.closest('.msd-mk[data-mk]');
    if (row && row.getAttribute('aria-current') !== 'true') { const s = spansOf(row.dataset.mk)[0]; if (s) point(s, true); }
  });
  const accept = async id => {
    const c = record().cards.find(y => y.id === id);
    if (!c?.proposal) return;
    try { await navigator.clipboard?.writeText(c.proposal); } catch { /* the clipboard is not open here */ }
    update(s => resolveComment(s, file, id, true));
    say(state, 'The rewrite is copied. In the Word view, Edit text takes it into the paragraph; the built file is not changed here.');
    draw(0);
  };

  // ---- comments on request: a bar at the selection -------------------------------------------------------------------------------------
  const ask = document.createElement('div');
  ask.className = 'msd-ask'; ask.hidden = true;
  ask.innerHTML = uiBar({ kind: 'tools', id: 'msd-ask', label: 'Comment on the selection', float: 'popover', density: 'dense',
    actions: Object.entries(ASKS).map(([k, a]) => ({ id: `msd-ask-${k}`, label: a.label, icon: a.icon, role: 'quiet' })) });
  document.body.append(ask);
  self.stops.push(() => ask.remove());
  let selected = null;   // { unit, start, end, passage }
  const selectionIn = () => {
    const sel = getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount) return null;
    const r = sel.getRangeAt(0), b = body();
    const node = r.commonAncestorContainer, el = node.nodeType === 1 ? node : node.parentElement;
    const u = el?.closest?.('.msd-u');
    if (!b || !u || !b.contains(u)) return null;
    const k = +u.dataset.u, unit = model.units[k];
    if (!unit || !(unit.kind === 'p' || unit.kind === 'caption' || unit.kind === 'heading')) return null;
    const before = r.cloneRange(); before.selectNodeContents(u); before.setEnd(r.startContainer, r.startOffset);
    const start = before.toString().length, passage = r.toString();
    if (!passage.trim() || passage.length > LIMIT.passage) return null;
    return { unit: k, start, end: start + passage.length, passage, rect: r.getBoundingClientRect() };
  };
  const showAsk = () => {
    const s = selectionIn();
    if (!s) { ask.hidden = true; selected = null; return; }
    selected = s;
    ask.hidden = false;
    const w = ask.offsetWidth, h = ask.offsetHeight, { rect } = s;
    ask.style.setProperty('left', `${Math.max(8, Math.min(innerWidth - w - 8, rect.left + rect.width / 2 - w / 2))}px`);
    ask.style.setProperty('top', `${rect.top - h - 6 < 8 ? rect.bottom + 6 : rect.top - h - 6}px`);
  };
  let selTimer = 0;
  const onSel = () => { clearTimeout(selTimer); selTimer = setTimeout(showAsk, 150); };
  document.addEventListener('selectionchange', onSel); self.stops.push(() => { clearTimeout(selTimer); document.removeEventListener('selectionchange', onSel); });
  ask.addEventListener('pointerdown', ev => ev.preventDefault());   // the selection stays while the bar is pressed
  for (const k of Object.keys(ASKS)) ask.querySelector(`#msd-ask-${k}`).onclick = () => { if (selected) run(k, selected); };
  // a new answer's mark shows its card at once, pressed
  const showNew = id => { const s = spansOf(id)[0]; if (s) point(s, true); };

  async function run(kind, s) {
    ask.hidden = true;
    const { modelFor } = await import('../lib/model-settings.mjs');
    const { configured } = await import('../lib/ai.mjs');
    const cfg = modelFor('write');
    if (!configured(cfg)) { say(state, 'No model for writing: choose one in Settings, Models.'); return; }
    const P = await import('../lib/prompts-views.mjs');
    const prompt = { explain: P.readerExplain, rewrite: P.readerRewrite, check: P.readerCheck }[kind];
    const { confirmRun, promptSends } = await import('../lib/run-preview.mjs');
    if (!await confirmRun({ title: `Ask ${cfg.model}?`, confirm: 'Ask', cfgs: [cfg], classes: promptSends(prompt), items: { n: 1, noun: 'passage' } })) return;
    const anchor = anchorAt(model.units, s.unit, s.start, s.end);
    const c = { id: crypto.randomUUID(), kind: 'model', ask: kind, model: cfg.model, at: new Date().toISOString(), version, anchor, running: true };
    self.running.set(c.id, c);
    getSelection()?.removeAllRanges();
    draw(0); showNew(c.id);
    try {
      const { complete } = await import('../lib/ai.mjs');
      const unit = model.units[s.unit], args = { paragraph: unit.text.slice(0, LIMIT.paragraph), passage: s.passage };
      if (kind === 'check') Object.assign(args, await evidence(state, model, s));
      const text = await complete(cfg, P.messagesOf(prompt, args), { temperature: 0, json: kind === 'check', prompt, maxTokens: prompt.maxTokens });
      const done = { ...c, running: false };
      if (kind === 'check') { const { jsonOf } = await import('../lib/aid.mjs'); const got = jsonOf(text); done.checks = (got?.checks || []).filter(v => v?.quote).map(v => ({ quote: String(v.quote).slice(0, 300), verdict: /contradict/i.test(v.verdict) ? 'contradicted' : /support/i.test(v.verdict) ? 'supported' : 'not addressed', evidence: String(v.evidence || '').slice(0, 300), why: String(v.why || '').slice(0, 200) })); done.text = done.checks.length ? '' : 'The model found nothing to check in this passage.'; }
      else if (kind === 'rewrite') done.proposal = String(text || '').trim();
      else done.text = String(text || '').trim();
      self.running.delete(c.id);
      update(st => addModelComment(st, file, done));
    } catch (err) {
      self.running.set(c.id, { ...c, running: false, error: `${cfg.model} did not answer: ${err?.message || err}` });
    }
    draw(0); showNew(c.id);
  }

  // ---- parts of the page drawn later ------------------------------------------------------------------------------------------------
  return {
    place,
    /** Units from `from` on were just put on the page: their marks and counts are drawn. */
    added(from) { draw(from); },
    refit,
    point,
    step,
    stop() { for (const f of self.stops) { try { f(); } catch { /* stopped */ } } close(); col.remove(); card.remove(); clearSpans(); delete main.dataset.comments; delete main.dataset.commentsN; },
  };
}

const verdictLabel = v => ({ supported: 'Supported', contradicted: 'Contradicted' }[v] || 'Not addressed');
const scrollerOf = el => { for (let n = el; n && n !== document.body; n = n.parentElement) { const o = getComputedStyle(n).overflowY; if (o === 'auto' || o === 'scroll') return n; } return null; };
function say(state, text) {
  const p = state.el.querySelector('[data-state]');
  if (!p) return;
  p.textContent = text; p.hidden = false; p.dataset.tone = /^No model|did not answer/.test(text) ? 'stopped' : '';
}

/** What Check reads against: the number check's rows for the numbers of the passage, the results lines near them, the cited records' entries. */
async function evidence(state, model, s) {
  const unit = model.units[s.unit], out = { sources: '', results: '', records: '' };
  const nums = [...unit.html.matchAll(/<span class="msd-num[^"]*" data-n="(\d+)">/g)].map(m => model.numbers[+m[1]]).filter(Boolean);
  const inPassage = nums.filter(n => s.passage.includes(n.number));
  out.sources = (inPassage.length ? inPassage : nums).slice(0, 20).map(n => `${n.number}: ${n.row.source}${n.row.context ? ` (${n.row.context.slice(0, 160)})` : ''}`).join('\n');
  const lines = [];
  try {
    const file = state.stale?.analysis?.file;
    if (file && state.resultsOf) { const idx = await state.resultsOf(); for (const n of inPassage.slice(0, 8)) { const { resultLine } = await import('../lib/number-sources.mjs'); const l = resultLine(idx, n.number, n.near); if (l && !lines.includes(l.text)) lines.push(l.text); } }
  } catch { /* no results file */ }
  out.results = lines.slice(0, 12).join('\n');
  const keys = new Set();
  for (const m of unit.html.matchAll(/data-refs="([^"]+)"/g)) for (const k of m[1].split(' ')) keys.add(k);
  const refs = [...keys].slice(0, 12).map(k => model.refs?.get(k)).filter(Boolean);
  out.records = refs.map(r => `${r.key}. ${r.text.slice(0, 300)}`).join('\n');
  return out;
}
