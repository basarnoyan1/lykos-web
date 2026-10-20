// Literature: citation chasing through OpenAlex (lib/citation-chase.mjs).
//
// One short form under the title bar (which names the page, switches the tool and shows what is left of OpenAlex's day): the Source row,
// the Direction row with Find after the choice, all on one label column. What was found is a list below it, under its own count head.
import { get, update } from '../store.mjs';
import { uiBar, uiSettingsRow } from '../lib/ui-actions.mjs';
import { metadataLine } from '../lib/ui-components.mjs';
import { emptyState } from '../lib/html.mjs';
import { num, when } from '../lib/dates.mjs';
import { run as runJob } from '../lib/jobs.mjs';
import { chase, against, accept, seedsOf, DIRECTIONS } from '../lib/citation-chase.mjs';
import { settings } from '../lib/model-settings.mjs';
import { seedPicker, seedChoice, seedReason } from './seed-picker.mjs';
import { candidateList } from './candidates.mjs';
import { onBudget } from '../lib/limiter.mjs';
import { openalexBudget } from '../lib/sources.mjs';

let direction = 'both', found = null, foundRef = null, note = '', busy = false;
let budget = '';   // what is left of OpenAlex's day, from its last answer: the title bar's status on this tool

/** The title bar's status while Citation chasing is open ('981 credits left'), or '' before OpenAlex has answered. */
export const chaseStatus = () => budget;

export function renderChase(el, ctx) {
  const s = get();
  if (foundRef !== s) { found = null; note = ''; foundRef = s; }
  el.innerHTML = `<section class="lit-tool chase">
    <div class="lit-form-rows" id="chase-form">
      <div id="chase-seeds"></div>
      ${uiSettingsRow({ id: 'chase-direction-row', label: 'Direction', controls: { id: 'chase-direction',
        view: { id: 'chase-dir', label: 'Direction', attr: 'data-dir', kind: 'segmented', value: direction, items: DIRECTIONS },
        actions: [{ id: 'chase-run', label: 'Find', icon: 'search', role: 'primary' }] } })}
    </div>
    <div class="lit-results" id="chase-result"></div></section>`;
  const run = el.querySelector('#chase-run');
  const say = text => ctx.say?.(text);
  // Find waits for a source: disabled, and the title bar says why
  let said = '';
  const ready = () => { const why = seedReason(); run.disabled = busy || !!why; if (!busy && (why || said)) say(why); said = why; };
  const draw = () => {
    const host = el.querySelector('#chase-result');
    if (!found) { host.innerHTML = emptyState({ title: 'No results yet', size: 'inline' }); return; }
    found.candidates = against(found.candidates, get().papers);   // records added meanwhile are no longer new
    const c = found.candidates, held = c.filter(x => x.inLibrary).length;
    host.innerHTML = `${uiBar({ kind: 'head', label: 'Results', id: 'chase-result-head', lead: { title: 'Results', level: 'h2' }, status: { id: 'chase-result-count', text: `${num(c.length - held)} new`, ch: 10 } })}
      <div class="lit-summary">${metadataLine([`${num(found.seeds)} seeds`, `${num(found.found.length)} found in OpenAlex`, found.missing.length ? `${num(found.missing.length)} not found` : '', `${num(found.retrieved)} works`, `${num(held)} in the library`, found.capped ? 'Cut short' : '', 'OpenAlex reference lists can be incomplete'])}</div><div class="cand-host"></div>`;
    candidateList(host.querySelector('.cand-host'), found, {
      key: 'chase', noun: 'works',
      describe: x => [x.back ? `cited by ${x.back} included` : '', x.forward ? `cites ${x.forward} included` : ''].filter(Boolean).join(' · '),
      onAdd: (ids, destination) => {
        let added = 0;
        update(st => { added = accept(st, found, ids, { destination }); return st; });
        note = `Added ${added}. Logged as a citation search`;
        ctx.refreshCounts(); ctx.rerender(note);
        return added;
      } });
  };
  seedPicker(el.querySelector('#chase-seeds'), { onChange: ready });
  el.querySelectorAll('[data-dir]').forEach(b => b.onclick = () => { direction = b.dataset.dir; el.querySelectorAll('[data-dir]').forEach(x => { const on = x === b; x.classList.toggle('on', on); x.setAttribute('aria-pressed', String(on)); }); });
  run.onclick = async () => {
    const choice = seedChoice(), seeds = seedsOf(get(), choice.mode === 'chosen' ? { ids: choice.ids } : {});
    if (!seeds.length) { ready(); return; }
    busy = true; run.disabled = true; say('Finding');
    const state = get(); let result = null;
    try {
      await runJob('search', `Citation chasing · ${seeds.length} ${seeds.length === 1 ? 'study' : 'studies'}`, async h => {
        result = await chase(seeds, { direction, settings: settings(), onProgress: t => { h.progress(t); if (el.isConnected) say(t); }, stopped: () => h.stopped() });
        return `${num(result.retrieved)} works`;
      });
      if (get() !== state) return;
      result.candidates = against(result.candidates, get().papers);
      found = result; note = '';
      say('');
    } catch (err) { if (el.isConnected) say(err.name === 'AbortError' ? 'Stopped' : err.message); }
    finally { busy = false; }
    if (el.isConnected) { run.disabled = !!seedReason(); draw(); }
  };
  // what is left of OpenAlex's day, from the last answer: the title bar's status (repainted only when the words change)
  const paintBudget = b => {
    const text = !b || (b.remaining == null && !b.closed) ? '' : b.closed ? `Used up until ${when(b.resetAt || Date.now())}` : `${num(b.remaining)} credits left`;
    if (text === budget) return;
    budget = text; if (el.isConnected) ctx.status?.(text ? { text, ch: 24 } : null);
  };
  const refresh = () => openalexBudget({ settings: settings() }).then(b => { if (el.isConnected) paintBudget(b); }).catch(() => {});
  const off = onBudget(() => { if (!el.isConnected) off(); else refresh(); });
  refresh();
  ready();
  draw();
}
