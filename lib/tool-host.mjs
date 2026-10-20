// A page built as a Files tool (a tools bar and a body; `mount(ops, { body, placeTools })`, views/file-doc.mjs) drawn into any element: the
// Changes view hosts History and Dependencies this way, so one page has one implementation wherever it is shown.
import { uiBar } from './ui-actions.mjs';
import { wireRuns } from './topbar.mjs';

const strip = list => (list || []).map(x => (x && typeof x === 'object' && !x.__ui ? (({ run, ...spec }) => spec)(x) : x));
let seq = 0;

/** `{ ops, body, placeTools, stop }` for `el`: its contents replaced by a host whose body scrolls under the tools bar. */
export function toolHost(el, { say = () => {} } = {}) {
  el.innerHTML = '<div class="tool-host"><div class="fv-tool-body"></div></div>';
  const host = el.firstElementChild, body = host.firstElementChild;
  let live = true;
  const ops = { uid: `th${++seq}`, host, say, isLive: () => live && host.isConnected };
  const placeTools = (o, spec) => {
    host.querySelector(':scope > .fv-top')?.remove();
    const wrap = document.createElement('div'); wrap.className = 'fv-top';
    wrap.innerHTML = uiBar({ kind: 'tools', density: 'dense', id: `${ops.uid}-tools`, ...spec, actions: strip(spec.actions), overflow: strip(spec.overflow) });
    host.prepend(wrap);
    wireRuns(wrap, [...(spec.actions || []), ...(spec.overflow || [])].filter(a => a && typeof a === 'object'));
    return wrap;
  };
  return { ops, body, placeTools, stop: () => { live = false; } };
}
