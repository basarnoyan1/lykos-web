// Getting started: the steps of a review in order, for a person new to reviews or to Lykos (lib/guide-steps.mjs). After the setup guides of
// Outseta, Vanta and Slite on Mobbin: how far along the review is on one line with a bar, then one rounded list, a step a row (its number or a
// check, its name, a chevron); the step to do next is open with what it is for and Open <page>, the others open in place when pressed.
// Hide this guide (More) takes it out of the sidebar on this Mac; the Overview's More brings it back.
import { REGISTRY } from './registry.mjs';
import { get } from '../store.mjs';
import { esc } from '../lib/html.mjs';
import { icon } from '../lib/icons.mjs';
import { uiLink } from '../lib/ui-components.mjs';
import { guideSteps as stepChecks } from '../lib/guide-steps.mjs';

/** Each step's words: its name, what it is for in plain words (24 words at most), the page it opens. */
export const STEP_TEXT = Object.freeze({
  question: { title: 'Set the question and criteria', view: 'protocol', open: 'Open protocol', line: 'Write the review question and the rules a study must meet to be included. Every later decision is checked against them.' },
  search: { title: 'Search the databases', view: 'search', open: 'Open search', line: 'Run the search in PubMed and the other databases, or import the records you exported. Each search is logged for the methods.' },
  screening: { title: 'Screen titles and abstracts', view: 'screening', open: 'Open screening', line: 'Include or exclude each record from its title and abstract. Uncertain records stay in the queue until decided.' },
  fulltext: { title: 'Read the full texts', view: 'library', open: 'Open library', line: 'Attach the PDFs of the records you kept and decide on each from the full text. The excluded ones need a reason.' },
  extraction: { title: 'Extract the data', view: 'extraction', open: 'Open extraction', line: 'Fill the evidence table for every included study: design, patients, follow-up and the events for each outcome.' },
  appraisal: { title: 'Assess the risk of bias', view: 'appraisal', open: 'Open appraisal', line: 'Judge each included study with the tool for its design, such as RoB 2 for trials or ROBINS-I for cohorts.' },
  analysis: { title: 'Pool the results', view: 'analysis', open: 'Open analysis', line: 'Combine the studies for each outcome in a meta-analysis, or describe them when they cannot be pooled.' },
  certainty: { title: 'Rate the certainty of evidence', view: 'certainty', open: 'Open certainty', line: 'Rate how sure the evidence makes you of each result with GRADE: high, moderate, low or very low.' },
  manuscript: { title: 'Write the manuscript', view: 'manuscript', open: 'Open manuscript', line: 'Write the paper with the results, tables and figures linked to the data, so a changed number changes in the text.' },
  submission: { title: 'Submit to a journal', view: 'submissions', open: 'Open submission', line: 'Record where the paper was sent and each decision, with the dates and the files sent.' },
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

/** The page: how far along, then the steps. `steps` and `openNow` are for tests. */
export function guideHtml(steps, openNow = id => opened.get(id)) {
  const done = steps.filter(x => x.done).length, share = steps.length ? done / steps.length : 0;
  const row = (st, i) => {
    const open = openNow(st.id) ?? Boolean(st.current), id = esc(st.id);
    return `<li class="gd-step" data-step="${id}" data-done="${st.done}" data-open="${open}"${st.current ? ' data-current' : ''}>
      <span class="gd-mark" aria-hidden="true">${st.done ? icon('check', { size: 14 }) : String(i + 1)}</span>
      <button type="button" class="gd-open" id="gd-open-${id}" aria-expanded="${open}" aria-controls="gd-body-${id}"><span class="gd-title">${esc(st.title)}</span>${icon('chevron-right', { size: 14 })}</button>
      <div class="gd-body" id="gd-body-${id}" role="region" aria-labelledby="gd-open-${id}"${open ? '' : ' hidden'}><p class="gd-line">${withTerms(st.line)}</p>
        <p class="gd-go">${uiLink({ id: `gd-go-${st.id}`, label: st.open, icon: 'chevron-right', attrs: { 'data-go': st.view } })}</p></div>
    </li>`;
  };
  return `<section class="gd" aria-label="Getting started">
    <div class="gd-top"><span class="gd-count">${done} of ${steps.length} steps done</span>
      <svg class="ov-mk gd-meter" width="100%" height="6" aria-hidden="true" focusable="false"><rect class="gd-meter-off" x="0" y="0" width="100%" height="6" rx="1"/><rect class="gd-meter-on" x="0" y="0" width="${(share * 100).toFixed(2)}%" height="6" rx="1"/></svg></div>
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
