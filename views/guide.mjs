// Getting started: the steps of a review in order, for a person new to reviews or to Lykos (lib/guide-steps.mjs). After the setup guides of
// Outseta, Vanta and Slite on Mobbin: how far along the review is on one line with a bar, then one rounded list, a step a row (its number or a
// check, its name, a chevron); the step to do next is open with what it is for and Open <page>, the others open in place when pressed.
// Hide this guide (More) takes it out of the sidebar on this Mac; the Overview's More brings it back.
import { views_registry$REGISTRY as REGISTRY } from "../boot.mjs";
import { store$get as get } from "../boot.mjs";
import { lib_html$esc as esc } from "../boot.mjs";
import { lib_icons$icon as icon } from "../boot.mjs";
import { lib_ui_components$uiLink as uiLink } from "../boot.mjs";
import { guideSteps as stepChecks } from '../lib/guide-steps.mjs';

/** Each step's words: its name, what it covers in one short line (owner, 31 Oct 2026: fewer prose lines), the page it opens. */
export const STEP_TEXT = Object.freeze({
  question: { title: 'Set the question and criteria', view: 'protocol', open: 'Open protocol', line: 'The review question and the rules a study must meet.' },
  search: { title: 'Search the databases', view: 'search', open: 'Open search', line: 'Run or import each database search; each is logged for the methods.' },
  screening: { title: 'Screen titles and abstracts', view: 'screening', open: 'Open screening', line: 'Include or exclude each record from its title and abstract.' },
  fulltext: { title: 'Read the full texts', view: 'library', open: 'Open library', line: 'Attach the PDFs and decide on each; exclusions need a reason.' },
  extraction: { title: 'Extract the data', view: 'extraction', open: 'Open extraction', line: 'Design, patients, follow-up and events for every included study.' },
  appraisal: { title: 'Assess the risk of bias', view: 'appraisal', open: 'Open appraisal', line: 'Each included study with the tool for its design (RoB 2, ROBINS-I).' },
  analysis: { title: 'Pool the results', view: 'analysis', open: 'Open analysis', line: 'A meta-analysis for each outcome, or a synthesis without one.' },
  certainty: { title: 'Rate the certainty of evidence', view: 'certainty', open: 'Open certainty', line: 'GRADE each result: high, moderate, low or very low.' },
  manuscript: { title: 'Write the manuscript', view: 'manuscript', open: 'Open manuscript', line: 'The paper, its numbers, tables and figures linked to the data.' },
  submission: { title: 'Submit to a journal', view: 'submissions', open: 'Open submission', line: 'Each journal, its decision and the files sent.' },
});
/** The steps of the project with their words. */
export const guideSteps = s => stepChecks(s).map(x => ({ ...x, ...STEP_TEXT[x.id] }));
import { withTerms } from '../lib/glossary.mjs';

export const meta = { title: 'Getting started', icon: 'flag' };
export const count = (...a) => REGISTRY.guide.count(...a);

const HIDE_KEY = 'lykos.guide.hidden';
/** Whether the guide was hidden on this Mac. */
export const guideHidden = () => { try { return globalThis.localStorage?.getItem(HIDE_KEY) === '1'; } catch { return false; } };
const setHidden = on => { try { if (on) globalThis.localStorage?.setItem(HIDE_KEY, '1'); else globalThis.localStorage?.removeItem(HIDE_KEY); } catch { /* kept for the session only */ } };

const opened = new Map();   // step id -> open, as the person left it on this page
let shown = null;

export function page() {
  return { title: 'Getting started', actions: [],
    overflow: [{ id: 'gd-hide', label: 'Hide this guide', run: () => { setHidden(true); syncSidebar(); shown?.ctx.go('overview'); } }] };
}

/** The sidebar's row for the guide follows the choice at once (the shell also checks it whenever it draws the sidebar). */
export function syncSidebar() {
  const b = [...document.querySelectorAll('#foot button[data-k]')].find(x => x.dataset.k === 'guide');
  if (b) b.hidden = guideHidden() || !guideSteps(get()).length;
}

// The phases the steps fall in: a quiet label above each pair on the track
const PHASE = { question: 'Plan', screening: 'Screen', extraction: 'Extract', analysis: 'Synthesize', manuscript: 'Publish' };
const PAGE_ICON = { protocol: 'criteria-edit', search: 'search', screening: 'screening', library: 'library', extraction: 'extraction', appraisal: 'appraisal', analysis: 'analysis', certainty: 'certainty', manuscript: 'manuscript', submissions: 'send' };

/**
 * The page (owner, 31 Oct 2026: "could be much better"): how far along as a figure over one segment per step, then the steps on one
 * track grouped by phase. A step done is a filled green check, the current one a blue ring, the rest their figure; the rail is green
 * between steps done. The current step opens to its line and the page it opens. `steps` and `openNow` are for tests.
 */
export function guideHtml(steps, openNow = id => opened.get(id)) {
  const done = steps.filter(x => x.done).length;
  const segs = steps.map(x => `<span class="gd-seg" data-state="${x.done ? 'done' : x.current ? 'now' : 'todo'}"></span>`).join('');
  const row = (st, i) => {
    const open = openNow(st.id) ?? Boolean(st.current), id = esc(st.id), next = steps[i + 1];
    const phase = PHASE[st.id] ? `<li class="gd-phase" role="presentation" aria-hidden="true" data-rail="${i && steps[i - 1].done && st.done ? 'done' : 'todo'}"><span>${esc(PHASE[st.id])}</span></li>` : '';
    return `${phase}<li class="gd-step" data-step="${id}" data-done="${st.done}" data-open="${open}"${st.current ? ' data-current aria-current="step"' : ''} data-rail="${st.done && next?.done ? 'done' : 'todo'}">
      <span class="gd-mark" aria-hidden="true">${st.done ? icon('check', { size: 12 }) : String(i + 1)}</span>
      <button type="button" class="gd-open" id="gd-open-${id}" aria-expanded="${open}" aria-controls="gd-body-${id}"><span class="gd-title">${st.done ? '<span class="visually-hidden">Done: </span>' : st.current ? '<span class="visually-hidden">Current: </span>' : ''}${esc(st.title)}</span><span class="gd-page">${icon(PAGE_ICON[st.view] || 'dot', { size: 14 })}</span>${icon('chevron-right', { size: 14 })}</button>
      <div class="gd-body" id="gd-body-${id}" role="region" aria-labelledby="gd-open-${id}"${open ? '' : ' hidden'}><p class="gd-line">${withTerms(st.line)}</p>
        <p class="gd-go">${uiLink({ id: `gd-go-${st.id}`, label: st.open, icon: 'chevron-right', attrs: { 'data-go': st.view } })}</p></div>
    </li>`;
  };
  return `<section class="gd" aria-label="Getting started">
    <div class="gd-top"><p class="gd-count"><span class="gd-n">${done}</span><span class="gd-of">of ${steps.length} steps done</span></p>
      <div class="gd-segs" role="img" aria-label="${done} of ${steps.length} steps done">${segs}</div></div>
    <ol class="gd-list">${steps.map(row).join('')}</ol>
  </section>`;
}

export function render(el, ctx) {
  shown = { el, ctx };
  if (guideHidden()) { setHidden(false); syncSidebar(); }   // opened from the Overview's More: the guide is back in the sidebar
  el.innerHTML = guideHtml(guideSteps(get()));
  el.querySelectorAll('.gd-open').forEach(b => b.onclick = () => {
    const li = b.closest('.gd-step'), on = b.getAttribute('aria-expanded') !== 'true';
    opened.set(li.dataset.step, on);
    b.setAttribute('aria-expanded', String(on)); li.dataset.open = String(on); li.querySelector('.gd-body').hidden = !on;
  });
  el.querySelectorAll('[data-go]').forEach(b => b.onclick = () => ctx.go(b.dataset.go));
}
