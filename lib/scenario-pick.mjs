// The scenario this window shows (protocol scenarios, spec "Interface"): kept in memory, per window, never saved. The main protocol unless a
// scenario is picked, and again once the picked one is gone. The pages that show a scenario (protocol, screening, PRISMA, Scenarios) put
// the same picker in their title bar.
import { MAIN_PROTOCOL, scenariosOf } from './scenario-runs.mjs';
import { scenarioView } from './scenarios.mjs';
import { lib_review_studies$liveVersion as liveVersion } from "../boot.mjs";
import { lib_menu$showMenu as showMenu } from "../boot.mjs";

let picked = MAIN_PROTOCOL;

/** The scenario id the window shows: 'main' when none is picked or the picked one is no longer in the project. */
export function currentScenario(s) {
  if (picked === MAIN_PROTOCOL) return MAIN_PROTOCOL;
  return scenariosOf(s).some(x => x.id === picked) ? picked : MAIN_PROTOCOL;
}

/** Picks a scenario for this window ('main', or no id, for the main protocol). */
export function pickScenario(id) { picked = id == null || id === '' ? MAIN_PROTOCOL : String(id); }

/**
 * The title bar's scenario picker (a page `actions` item; lib/topbar.mjs binds `run` to a press and to a choice from More), or null when the
 * project has no scenario. Choosing picks the scenario and redraws the page.
 */
export function scenarioPicker(s, rerender) {
  const list = scenariosOf(s);
  if (!list.length) return null;
  const options = [[MAIN_PROTOCOL, 'Main protocol'], ...list.map(x => [x.id, x.name || x.id])];
  const now = currentScenario(s), value = options.find(([id]) => id === now)[1];
  const choose = id => { pickScenario(id); rerender?.(); };
  warmViews(s, list.map(x => x.id).filter(id => id !== now));
  // a scenario picked is carried by weight (ui-components.css), no hue
  // a picked scenario's name stays in the bar at every width (keep): decisions go to its lane, so the page must always say which
  return { picker: true, id: 'scenario-pick', label: 'Scenario', role: 'quiet', steady: true, value, options, cls: now === MAIN_PROTOCOL ? 'scenario-pick' : 'scenario-pick scenario-picked',
    ...(now === MAIN_PROTOCOL ? {} : { keep: true }),
    run: (el, e) => {
      if (e?.type === 'ui-pick') return choose(e.detail?.value);
      showMenu(el, options.map(([id, label]) => ({ label, checked: id === now, checkType: 'radio', run: () => choose(id) })), { align: 'end', focusChecked: true });
    } };
}

/**
 * The views the picker switches to, made ahead one scenario per task while a page with the picker shows (each is kept per project version,
 * lib/scenarios.mjs), so a choice draws from them (final review I5: on Screening a first choice made its view, about 60 ms of 150 on a Sham
 * copy). Once per version: while the picker is on the page, a version that has held for a second (no edit since) is warmed again, so a run of
 * decisions does not rebuild them at each one. A project without scenarios has no picker and schedules nothing.
 */
let warmed = { s: null, v: null }, watching = null;
function warmViews(s, ids) {
  const v = liveVersion(s);
  if (typeof v !== 'number') return;
  if (!(warmed.s === s && warmed.v === v)) {
    warmed = { s, v };
    const todo = [...ids];
    const next = () => { const id = todo.shift(); if (!id || liveVersion(s) !== v) return; try { scenarioView(s, id); } catch { return; } setTimeout(next, 0); };
    setTimeout(next, 0);
  }
  if (watching || typeof document === 'undefined') return;
  let seen = v;
  watching = setInterval(() => {
    const now = liveVersion(s);
    if (!document.getElementById('scenario-pick') || typeof now !== 'number') { clearInterval(watching); watching = null; return; }
    if (now === seen && now !== warmed.v) warmViews(s, scenariosOf(s).map(x => x.id).filter(id => id !== currentScenario(s)));
    seen = now;
  }, 1000);
}
