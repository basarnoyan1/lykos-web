// The card that says another program is editing the project folder (lib/agent-activity.mjs reads .lykos/activity.json). Who (Claude's
// own mark for Claude, a neutral program glyph for any other), what in plain words, how far (a bar with "2 of 4" and the step when the
// file names steps, a thin moving bar when it does not), how long, and the one thing that matters meanwhile: edits made here are held.
// When it ends the same card says what was done and which files changed, offers Changes, and fades out after a few seconds unless the
// pointer or focus is on it. Dismiss hides it until the next activity (another "since"). It sits in the shell's corner above the
// status line (shellCorner below), over the notices, the way an upload card does (references: Supabase's upload card,
// Fabric's "Uploaded 1 of 2 files" strip, Manus's "is working" row; Mobbin, 2026-10-24). The card is not a live region: a separate
// status line announces the start and the end, never each step.
import { esc } from './html.mjs';
import { icon } from './icons.mjs';
import { uiBar } from './ui-actions.mjs';
import { isClaude, activityHeadline, endedWhat, endedHeadline, progressOf, elapsedText, changedText } from './agent-activity.mjs';

export const FADE_AFTER = 8000;
const FADE_MS = 400;
// Claude's mark, the official spark (the path of the Claude app's own mark, 248 units square), in its orange (--claude)
const CLAUDE_RAYS = 'M52.4285 162.873L98.7844 136.879L99.5485 134.602L98.7844 133.334H96.4921L88.7237 132.862L62.2346 132.153L39.3113 131.207L17.0249 130.026L11.4214 128.844L6.2 121.873L6.7094 118.447L11.4214 115.257L18.171 115.847L33.0711 116.911L55.485 118.447L71.6586 119.392L95.728 121.873H99.5485L100.058 120.337L98.7844 119.392L97.7656 118.447L74.5877 102.732L49.4995 86.1905L36.3823 76.62L29.3779 71.7757L25.8121 67.2858L24.2839 57.3608L30.6515 50.2716L39.3113 50.8623L41.4763 51.4531L50.2636 58.1879L68.9842 72.7209L93.4357 90.6804L97.0015 93.6343L98.4374 92.6652L98.6571 91.9801L97.0015 89.2625L83.757 65.2772L69.621 40.8192L63.2534 30.6579L61.5978 24.632C60.9565 22.1032 60.579 20.0111 60.579 17.4246L67.8381 7.49965L71.9133 6.19995L81.7193 7.49965L85.7946 11.0443L91.9074 24.9865L101.714 46.8451L116.996 76.62L121.453 85.4816L123.873 93.6343L124.764 96.1155H126.292V94.6976L127.566 77.9197L129.858 57.3608L132.15 30.8942L132.915 23.4505L136.608 14.4708L143.994 9.62643L149.725 12.344L154.437 19.0788L153.8 23.4505L150.998 41.6463L145.522 70.1215L141.957 89.2625H143.994L146.414 86.7813L156.093 74.0206L172.266 53.698L179.398 45.6635L187.803 36.802L193.152 32.5484H203.34L210.726 43.6549L207.415 55.1159L196.972 68.3492L188.312 79.5739L175.896 96.2095L168.191 109.585L168.882 110.689L170.738 110.53L198.755 104.504L213.91 101.787L231.994 98.7149L240.144 102.496L241.036 106.395L237.852 114.311L218.495 119.037L195.826 123.645L162.07 131.592L161.696 131.893L162.137 132.547L177.36 133.925L183.855 134.279H199.774L229.447 136.524L237.215 141.605L241.8 147.867L241.036 152.711L229.065 158.737L213.019 154.956L175.45 145.977L162.587 142.787H160.805V143.85L171.502 154.366L191.242 172.089L215.82 195.011L217.094 200.682L213.91 205.172L210.599 204.699L188.949 188.394L180.544 181.069L161.696 165.118H160.422V166.772L164.752 173.152L187.803 207.771L188.949 218.405L187.294 221.832L181.308 223.959L174.813 222.777L161.187 203.754L147.305 182.486L136.098 163.345L134.745 164.2L128.075 235.42L125.019 239.082L117.887 241.8L111.902 237.31L108.718 229.984L111.902 215.452L115.722 196.547L118.779 181.541L121.58 162.873L123.291 156.636L123.14 156.219L121.773 156.449L107.699 175.752L86.304 204.699L69.3663 222.777L65.291 224.431L58.2867 220.768L58.9235 214.27L62.8713 208.48L86.304 178.705L100.44 160.155L109.551 149.507L109.462 147.967L108.959 147.924L46.6977 188.512L35.6182 189.93L30.7788 185.44L31.4156 178.115L33.7079 175.752L52.4285 162.873Z';
/** Who is editing, as a 16 px mark: Claude's starburst for Claude, the program glyph (cpu) for anyone else. */
export function agentMark(by) {
  return isClaude(by)
    ? `<svg class="agent-mark agent-mark-claude" viewBox="0 0 248 248" width="16" height="16" aria-hidden="true" focusable="false"><path d="${CLAUDE_RAYS}"/></svg>`
    : `<span class="agent-mark agent-mark-other" aria-hidden="true">${icon('cpu', { size: 16 })}</span>`;
}

// who: the mark in the card's first column, the name as the head's title, the card's commands at its end
const head = (by, actions) => agentMark(by) + uiBar({ kind: 'head', id: 'agent-card-head', label: `${by}'s work in the project`, lead: { title: by, level: 'h2' }, actions });
const dismiss = { id: 'agent-card-dismiss', label: 'Dismiss', icon: 'close', role: 'quiet', iconOnly: true, plain: true };
const track = (label, p) => p.share == null
  ? `<div class="agent-track" role="progressbar" aria-label="${esc(label)}"><span class="agent-fill"></span></div>`
  : `<div class="agent-track" role="progressbar" aria-label="${esc(label)}" aria-valuemin="0" aria-valuemax="${p.total}" aria-valuenow="${p.done}" aria-valuetext="${esc(p.label)}"><span class="agent-fill"></span></div>`;
// a line of the card: words that may be cut (the whole in the tooltip) and, at its end, a figure in a slot of its own (a count, the time)
const line = (left, right, cls, rightId = '') => (left || right)
  ? `<p class="${cls}"><span class="agent-line-text" title="${esc(left)}">${esc(left)}</span>${right ? `<span class="agent-count"${rightId ? ` id="${rightId}"` : ''}>${esc(right)}</span>` : ''}</p>` : '';
const sinceText = (a, to) => { const t = Date.parse(a.since); return Number.isFinite(t) ? elapsedText(to - t) : ''; };

/**
 * The card's inside for a running activity ({ state: 'running', a }) or an ended one ({ state: 'ended', e }); `now` dates the clock.
 * Answers { html, share } (share: the bar's fill 0..1, null for the moving bar), so the caller sets the fill without a style attribute.
 */
export function agentCardBody(view, now = Date.now()) {
  if (view.state === 'running') {
    const a = view.a, what = activityHeadline(a), p = progressOf(a);
    return { share: p.share, html: head(a.by, [dismiss])
      + `<p class="agent-what" title="${esc(what)}">${esc(what)}</p>${track(what, p)}${line(p.current, p.label, 'agent-step')}`
      + line('Your edits are held until it finishes', sinceText(a, now), 'agent-note', 'agent-card-time') };
  }
  const e = view.e, what = endedWhat(e), names = e.changed.map(p => p.split('/').pop());
  return { share: 1, html: head(e.by, [{ id: 'agent-card-changes', label: 'Open Changes', role: 'quiet', plain: true }, dismiss])
    + `<p class="agent-what" title="${esc(what)}">${esc(what)}</p>${track(what, { share: 1, total: e.total || 1, done: e.total || 1, label: 'Done' })}`
    + line(changedText(e.changed) || 'Done', e.total ? `${e.total} of ${e.total}` : '', 'agent-step')
    + line(names.join(', '), sinceText(e, Date.parse(e.ended)), 'agent-note', 'agent-card-time') };
}

/** What the status line says when an activity starts and when it ends. */
export const startedSay = a => `${a.by} is editing the project: ${activityHeadline(a)}. Your edits are held until it finishes.`;
export const endedSay = e => `${endedHeadline(e)}.${e.changed.length ? ` ${changedText(e.changed)}.` : ''}`;

const runKey = x => `${x.by}|${x.since}`;

/**
 * The window's corner above the status line, made once: the card first, then the shell's notices (lib/shell-notice.mjs finds its host
 * by id, here inside the corner), so a notice that appears while the card is up stands under it instead of over it.
 */
export function shellCorner(doc = globalThis.document) {
  let c = doc.getElementById('shell-corner');
  if (!c) { c = doc.createElement('div'); c.id = 'shell-corner'; c.className = 'ui-shell-corner'; doc.body.append(c); }
  let n = doc.getElementById('shell-notices');
  if (!n) { n = doc.createElement('div'); n.id = 'shell-notices'; n.className = 'ui-shell-notices'; n.setAttribute('role', 'status'); }
  if (n.parentElement !== c) c.append(n);
  return c;
}

/**
 * The card in a document: `update(next, prev, ended)` is lib/agent-activity.mjs's listener. `corner()` answers the element the card
 * goes first in; `openChanges()` runs Open Changes. Answers { update, element, stop }.
 */
export function agentCard({ doc = globalThis.document, corner = () => shellCorner(doc), openChanges = () => {}, now = () => Date.now(), fadeAfter = FADE_AFTER } = {}) {
  let card = null, live = null, shownKey = '', shownState = '', dismissedKey = '', endedKey = '', clock = null, fadeT = null, view = null, held = false;   // held: its time is up, it waits for the pointer to leave
  const reduced = () => !!doc.defaultView?.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const say = text => {
    if (!live) { live = doc.createElement('p'); live.id = 'agent-card-live'; live.className = 'visually-hidden'; live.setAttribute('role', 'status'); corner().prepend(live); }
    live.textContent = '';
    doc.defaultView?.setTimeout(() => { live.textContent = text; }, 50);
  };
  const remove = () => {
    clearInterval(clock); clock = null; clearTimeout(fadeT); fadeT = null;
    card?.remove(); card = null; shownKey = ''; shownState = ''; view = null; held = false;
  };
  const draw = () => {
    if (!view) return;
    const body = agentCardBody(view, now());
    if (!card) {
      card = doc.createElement('section');
      card.id = 'agent-card'; card.className = 'agent-card';
      card.addEventListener('click', ev => {
        if (ev.target.closest('#agent-card-dismiss')) { dismissedKey = shownKey; remove(); }
        else if (ev.target.closest('#agent-card-changes')) { remove(); openChanges(); }
      });
      card.addEventListener('mouseleave', () => { if (held) fadeLater(2000); });
      card.addEventListener('focusout', ev => { if (held && !card?.contains(ev.relatedTarget)) fadeLater(2000); });
      const c = corner(), notices = c.querySelector('.ui-shell-notices');
      if (notices) c.insertBefore(card, notices); else c.append(card);
    }
    card.dataset.state = view.state;
    card.dataset.progress = body.share == null ? 'unknown' : 'known';
    card.setAttribute('aria-label', view.state === 'running' ? `${view.a.by} is editing the project` : `${view.e.by} finished editing the project`);
    card.removeAttribute('data-fading');
    card.innerHTML = body.html;
    if (body.share != null) card.style.setProperty('--agent-share', String(body.share));
    else card.style.removeProperty('--agent-share');
  };
  const fadeLater = (ms = fadeAfter) => {
    clearTimeout(fadeT); held = false;
    fadeT = doc.defaultView?.setTimeout(() => {
      if (!card || shownState !== 'ended') return;
      if (card.matches(':hover') || card.contains(doc.activeElement)) { held = true; return; }   // being read: it goes once the pointer and focus leave
      if (reduced()) { remove(); return; }
      card.setAttribute('data-fading', '');
      fadeT = doc.defaultView?.setTimeout(() => { if (card?.hasAttribute('data-fading')) remove(); }, FADE_MS);
    }, ms);
  };
  function update(next, prev, ended) {
    if (next) {
      const key = runKey(next);
      if (key === dismissedKey) { if (card) remove(); return; }
      if (key !== shownKey || shownState !== 'running') { remove(); say(startedSay(next)); }
      view = { state: 'running', a: next }; shownKey = key; shownState = 'running';
      draw();
      // the clock: only its own slot changes (the card is not redrawn, so focus and the pointer stay where they are)
      if (!clock) clock = doc.defaultView?.setInterval(() => { const t = card?.querySelector('#agent-card-time'); if (t && view?.state === 'running') t.textContent = sinceText(view.a, now()); }, 15000);
      return;
    }
    if (ended) {
      const key = runKey(ended);
      if (key === dismissedKey || key === endedKey) return;   // dismissed, or already said
      endedKey = key;
      clearInterval(clock); clock = null;
      view = { state: 'ended', e: ended }; shownKey = key; shownState = 'ended';
      draw(); say(endedSay(ended)); fadeLater();
      return;
    }
    if (shownState === 'running') remove();   // the file went away or went stale: nothing is editing
  }
  return { update, element: () => card, stop: remove };
}
