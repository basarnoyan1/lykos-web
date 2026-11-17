// Pure width logic for action bars (action-system design, sections 5.1, 5.3, 5.6 and 6).
//
// A bar's shape is a function of measured natural widths and the available width only. bar-fit.mjs measures and calls choose();
// the builders (ui-actions.mjs) declare a BarSpec. Modes: full; compact (labels leave, then switches become dropdowns); folded
// (controls move into More one at a time); stacked (bands of equal columns; head, tools and foot only, in the folded forms).
//
// THE CONTRACT WITH THE BUILDERS (validateBarSpec checks it): modelOf() takes two plain objects.
//
// @typedef {object} BarItem        one unit in the actions region (a control the bar may fold)
// @property {string}  id           unique in the bar; the DOM id when the control has one
// @property {'act'|'group'|'picker'|'field'|'check'|'swap'} kind
//            act     one button (icon, label, or both)
//            group   2 to 6 joined members, one unit
//            picker  a button with a value label and chevron; its compact step clips the value
//            field   a text or number input; never folds
//            check   a labelled toggle that may fold into More (a foldable filter is emitted as this)
//            swap    alternatives sharing one measured slot (Run | Stop); never folds
// @property {'primary'|'secondary'|'quiet'} role   destructive acts are overflow entries, never items
// @property {number}  [fold]       0 never leaves, 9 leaves first. Default by role and kind: see FOLD_DEFAULT
// @property {boolean} [keep]       never folds (its label may still drop)
// @property {'always'|'reserve'} [presence]   'reserve' = occupies its slot invisibly, icon-only, sorted last in its cluster
// @property {'lead'|'end'} [slot]  'lead': lives in the lead slot (a back button); default fold 2 and keep. 'end': the bar's own end group after
//                                   every role cluster (the title bar's model actions and inspector), in author order, before More
//
// @typedef {object} BarSpec        what the bar declares
// @property {'head'|'tools'|'foot'|'strip'} kind
// @property {boolean} [stack]      has a stacked rung. Default: kind is not 'strip'. The topbar sets false
// @property {boolean} [equal]      decision bar: every item keeps (never folds)
// @property {boolean} [lead]       has a lead region (title, back, or input)
// @property {boolean} [message]    has a flexible message region
// @property {boolean} [status]     has a fixed status slot
// @property {{id:string, n:number}[]} [views]   0..2 view switches of n items each
// @property {{id:string, kind:'search'|'select'|'date'|'field'|'check'}[]} [filters]   never fold
// @property {BarItem[]} items      in the order the author wrote them
// @property {boolean} [hasOverflow]   the bar has overflow-only entries, so More exists at every width
//
// @typedef {object} BarMeasured    natural widths in px, measured once per content change
// @property {number} gap
// @property {number} more          width of the More button
// @property {number} [lead]        lead floor (min(natural, 180), or the input floor)
// @property {number} [status]      status slot width (max of natural and its ch)
// @property {Object<string,{seg:number,dd:number,btn:number}>} [views]   by view id
// @property {Object<string,number>} [filters]                             by filter id
// @property {Object<string,{full:number,compact:number|null}>} items      by item id
// @property {number[]} [fixed]     chrome that never folds (topbar toggles)
//
// modelOf(spec, measured) is the one place a spec becomes the model that ladder() reads. It puts
// the items in builder order (lead-slot items, then the clusters secondary, quiet, primary; inside
// a cluster the author's order with reserved items last) and supplies the defaults. The model is
// plain data, so it can be stored (app/test/fixtures/bar-models.json holds models in this shape).
// ---------------------------------------------------------------------------------------------

export const SAFE = 1;                                   // px added to every need, so sub-pixel rounding never wraps
export const MESSAGE_MIN = 96;                           // px of free width the message region needs to be shown
export const LEAD_SQUEEZE = 40;                          // px a non-stacking head's title may ellipsise to at its last rung (three letters and the ellipsis: a 320px window holds a title bar with a switch, and bar-morph's 192px a picker title with a primary)
export const STACK_AT = 240;                             // px a stacked band's columns are counted at (the narrowest list pane holds a bar of about this): a stacked bar changes its rows once, never again as it narrows
export const MODES = ['full', 'compact', 'folded', 'stacked'];
export const BAR_KINDS = ['head', 'tools', 'foot', 'strip'];
export const ITEM_KINDS = ['act', 'group', 'picker', 'field', 'check', 'swap'];
export const ROLES = ['primary', 'secondary', 'quiet'];
export const FILTER_KINDS = ['search', 'select', 'date', 'field', 'check'];
export const CLUSTER = { secondary: 0, quiet: 1, primary: 2 };
/** Fold value when the author gives none: acts by role, the other kinds by kind. 0 never leaves, 9 leaves first. */
export const FOLD_DEFAULT = { primary: 0, secondary: 3, quiet: 5, picker: 4, group: 4, check: 4, field: 0, swap: 0, lead: 2 };

const total = (parts, gap) => Math.ceil(parts.reduce((a, b) => a + b, 0) + gap * Math.max(0, parts.length - 1)) + SAFE;

/** Largest divisor c of n whose c equal cells (each at least `cell` wide) fit in `width`; every row then holds c items. */
export function columnsFor(n, width, cell, gap) {
  for (let c = n; c > 1; c--) if (n % c === 0 && c * cell + (c - 1) * gap <= width) return c;
  return 1;
}

/**
 * Model = the plain data the ladder reads (modelOf builds it):
 * m = { gap, stack, lead:{min}|null, message:boolean, status:{w}|null,
 *       views:[{id?, seg, dd, n, btn}], filters:[{id?, kind:'search'|'select'|'date'|'field'|'check', nat}],
 *       items:[{id, kind, role, fold, keep, full, compact, presence?, slot?:'lead'}], more, hasOverflow, fixed?:[widths of chrome that never folds] }
 * item.compact: width without its label (a picker: its value clipped to 12ch), or null when it has no label step
 * (icon-only, text-only, primary, field, swap, reserved). A swap's `full` is its widest member; a reserved item's `full` is its icon width.
 * There is no unit budget: every item is visible while it fits.
 */
const labelStep = it => it.compact != null && it.role !== 'primary' && it.kind !== 'field' && it.kind !== 'swap';
const foldable = it => !it.keep && it.role !== 'primary' && it.kind !== 'field' && it.kind !== 'swap';

/**
 * The rungs from widest to narrowest; each needs strictly less width than the one before.
 * rung = { mode, need, labelsOff:[ids], folded:[ids in DOM order], views:['segmented'|'dropdown'] }.
 * `folded` is in DOM order because More lists folded items in full-mode order.
 * A step that saves no width adds no rung but is still applied, so the next rung carries it.
 */
export function ladder(m) {
  const leave = m.items.map((it, i) => ({ ...it, i })).sort((a, b) => b.fold - a.fold || b.i - a.i);   // who leaves first
  const state = { off: new Set(), gone: new Set(), views: m.views.map(() => 'segmented'), statusOff: false, leadMin: null, primaryOff: false, switchShort: false };
  const need = () => total([
    state.leadMin ?? m.lead?.min, state.statusOff ? null : m.status?.w, ...(m.fixed || []),
    ...m.views.map((v, i) => state.views[i] === 'dropdown' ? (state.switchShort && v.mn != null ? v.mn : v.dd) : v.seg),
    ...m.filters.map(f => f.nat),
    ...m.items.filter(it => !state.gone.has(it.id)).map(it => state.off.has(it.id) && (labelStep(it) || (state.primaryOff && it.role === 'primary')) ? it.compact : it.full),
    (state.gone.size || m.hasOverflow) ? m.more : null].filter(x => x != null), m.gap);
  const domOrder = set => m.items.filter(it => set.has(it.id)).map(it => it.id);
  const rungs = [];
  const push = mode => {
    const n = need();
    if (!rungs.length || n < rungs.at(-1).need) rungs.push({ mode, need: n, labelsOff: domOrder(state.off), folded: domOrder(state.gone), views: [...state.views], ...(state.statusOff ? { status: 'hidden' } : {}), ...(state.leadMin != null ? { squeezed: true } : {}), ...(state.primaryOff ? { primaryOff: true } : {}), ...(state.switchShort ? { switchShort: true } : {}) });
  };
  push('full');
  for (const it of leave) if (labelStep(it)) { state.off.add(it.id); push('compact'); }
  const toDropdown = () => m.views.forEach((v, i) => { if (v.dd < v.seg) { state.views[i] = 'dropdown'; push(state.gone.size ? 'folded' : 'compact'); } });
  // the title bar's end switch (the page's own navigation) becomes its dropdown after the folds and the status (TOPBAR); elsewhere before anything folds
  if (!m.switchEnd) toDropdown();
  for (const it of leave) if (foldable(it)) { state.gone.add(it.id); push('folded'); }
  // A find bar's count (statusLast) gives way last, after the folds; its text stays the field's tooltip. A head that never stacks (the title bar,
  // TOPBAR R3, R8) gives up its status, then its primary's words, then squeezes its title; a bar that stacks keeps both and stacks instead.
  if (m.statusLast && m.status && !m.lead && !m.stack) { state.statusOff = true; push(state.gone.size ? 'folded' : 'compact'); }
  if (m.lead && !m.stack) {
    const mode = () => state.gone.size ? 'folded' : 'compact';
    if (m.status) { state.statusOff = true; push(mode()); }
    // the end switch becomes its dropdown before the title ellipsises: a cut title beside a full switch reads worse (owner, 2026-10-13)
    if (m.switchEnd) toDropdown();
    // then the primary shows only its icon (its words stay its name and tooltip)
    for (const it of m.items) if (it.role === 'primary' && it.kind === 'act' && it.compact != null && it.compact < it.full) { state.primaryOff = true; state.off.add(it.id); push(mode()); }
    // then the title ellipsises before the end switch drops its value, which names the page (owner, 2026-10-19)
    if ((m.lead.min || 0) > LEAD_SQUEEZE) { state.leadMin = LEAD_SQUEEZE; push(mode()); }
    // and last the end switch shows only its chevron (its value stays its name): the bar never overflows
    if (m.switchEnd && m.views.some((v, i) => state.views[i] === 'dropdown' && v.mn != null && v.mn < v.dd)) { state.switchShort = true; push(mode()); }
  }
  // Stacked keeps the narrowest one-row forms (amended 2026-10-11): what folded stays in More, labels stay off, a view switch that became a dropdown stays one.
  // Only the rows change, so narrowing never brings back a control, a label or a segmented switch it already gave up (the sweep kind bar-morph).
  if (m.stack) rungs.push({ mode: 'stacked', need: 0, labelsOff: domOrder(state.off), folded: domOrder(state.gone), views: [...state.views] });
  return rungs;
}

/** choose() with the ladder already computed (the engine caches it per model; resize ticks are arithmetic). */
export function chooseFrom(rungs, m, W) {
  let k = rungs.findIndex(x => x.need <= W);
  const fits = k >= 0;
  if (!fits) k = rungs.length - 1;
  const r = rungs[k];
  const out = { ...r, rung: k, fits, message: m.message ? (r.mode === 'stacked' || W - r.need >= MESSAGE_MIN ? 'shown' : 'hidden') : null };
  if (r.mode === 'stacked') out.views = stackPlan(m, W, r).filter(b => b.slot === 'view').map(b => b.as);   // a stacked band may hold a dropdown
  return out;
}
export function choose(m, W) { return chooseFrom(ladder(m), m, W); }

/**
 * The rung a preview shows for a named mode, in chooseFrom's shape: the tightest rung of that mode (the first fold for 'folded', so one control sits in More),
 * `fits` true by construction. Null when the ladder has no such mode. The engine applies it when a bar carries data-ui-bar-force under the dev flag, so the
 * component page previews the real engine at a chosen mode and never carries a second implementation of it.
 */
export function forcedFrom(rungs, m, mode, W) {
  const same = rungs.map((r, k) => ({ r, k })).filter(x => x.r.mode === mode);
  const pick = mode === 'folded' ? same[0] : same.at(-1);
  if (!pick) return null;
  const out = { ...pick.r, rung: pick.k, fits: true, message: m.message ? (pick.r.mode === 'stacked' || W - pick.r.need >= MESSAGE_MIN ? 'shown' : 'hidden') : null };
  if (out.mode === 'stacked') out.views = stackPlan(m, W, pick.r).filter(b => b.slot === 'view').map(b => b.as);
  return out;
}

/**
 * Stacked: bands in DOM order; each band's rows hold the same number of items (cols divides n). `r` is the stacked rung, whose forms the bands keep:
 * an item it folded is in More, a view it turned into a dropdown stays one (a segmented view that no longer fits its band becomes one too, a step down).
 * The actions band holds the items still shown in equal columns; More (`more`) is not one of them: it is the icon at the end of the band's first row,
 * or, alone (cols 0), the icon at the end of the band before it (ui-actions.css), so it looks the same at every width.
 */
export function stackPlan(m, W, r = ladder(m).at(-1)) {
  const bands = [], gone = new Set(r?.folded || []);
  if (m.lead) bands.push({ slot: 'lead', n: 1, cols: 1 });
  if (m.message) bands.push({ slot: 'message', n: 1, cols: 1 });
  if (m.status) bands.push({ slot: 'status', n: 1, cols: 1 });
  m.views.forEach((v, i) => { const seg = (r?.views?.[i] ?? 'segmented') === 'segmented' && v.n * v.btn + (v.n - 1) * m.gap <= W; bands.push({ slot: 'view', n: seg ? v.n : 1, cols: seg ? v.n : 1, as: seg ? 'segmented' : 'dropdown' }); });
  const search = m.filters.filter(f => f.kind === 'search' || f.kind === 'field'), fields = m.filters.filter(f => f.kind !== 'search' && f.kind !== 'field');
  for (const f of search) bands.push({ slot: 'search', n: 1, cols: 1 });
  const at = Math.min(W, STACK_AT);                       // the columns of the narrowest pane at every stacked width: the rows do not change again as the width falls
  if (fields.length) bands.push({ slot: 'filters', n: fields.length, cols: columnsFor(fields.length, at, Math.max(...fields.map(f => f.nat)), m.gap) });
  const acts = m.items.filter(it => it.slot !== 'lead' && !gone.has(it.id)), more = gone.size > 0 || m.hasOverflow;
  if (acts.length || more) bands.push({ slot: 'actions', n: acts.length, more, cols: acts.length ? columnsFor(acts.length, at - (more ? m.more + m.gap : 0), Math.max(...acts.map(a => a.full)), m.gap) : 0 });   // cols 0: More alone
  return bands;
}

/**
 * One list decides for all its rows: cells beside the text, or under it in equal columns (end slot on the same second row).
 * Wide when check + the text floor (`main`) + the cells + the end slot fit: the rule is "the width minus what the controls need leaves the text its
 * floor", not a half. `min` is the narrowest each cell can be drawn (a visual cell, a meter and its count, shrinks; a control or a text cell does not): when the
 * cells at their natural width do not fit but at their minimum they do, the list is still wide and `shrunk` says its visual cells give way (the track
 * is minmax(min, max-content), so the text column keeps its floor and the cells take what is left).
 */
export function rowMode({ width, gap, check, main, cells, end, min }) {
  const need = list => check + main + list.reduce((a, c) => a + c, 0) + end + gap * (2 + cells.length) + SAFE;
  if (need(cells) <= width) return { mode: 'wide', cols: cells.length };
  if (Array.isArray(min) && min.length === cells.length && min.some((v, i) => v < cells[i]) && need(min.map((v, i) => Math.min(v, cells[i]))) <= width) return { mode: 'wide', cols: cells.length, shrunk: true };
  return { mode: 'narrow', cols: cells.length ? columnsFor(cells.length, width - end - gap - check - gap, Math.max(...cells), gap) : 0 };
}

/**
 * A line of text parts: the highest `drop` leaves first (the rightmost of equals); `trail` (pipeline) is pinned; never wraps.
 * `hidden` lists the dropped part ids in DOM order, ready for the read-only first entry of More.
 */
export function dropParts({ parts, trail = 0, gap, W }) {
  const order = parts.map((p, i) => ({ ...p, i })).sort((a, b) => b.drop - a.drop || b.i - a.i), gone = new Set();
  const w = () => total([...parts.filter((p, i) => !gone.has(i)).map(p => p.w), trail || null].filter(x => x != null), gap);
  for (const p of order) { if (w() <= W) break; gone.add(p.i); }
  return { hidden: parts.filter((p, i) => gone.has(i)).map(p => p.id), fits: w() <= W };
}

/**
 * The shape of a strip of document tabs (uiDocTabs), as a pure function of the count, the natural width of each tab and the width the strip has.
 * full     every tab at its natural width fits
 * compact  n + 1 columns of at least `min` fit: the active tab takes two columns, the others ellipsise
 * picker   otherwise: one dropdown naming the active document, an "n of N" readout, previous and next
 * Narrowing never goes back a step: the same width gives the same shape sweeping down, sweeping up and recomputed from scratch.
 */
export const TAB_MIN = 120;                              // a shared column holds about eight characters of a name beside its icon, padding and close
/**
 * Which value columns of a one-line file list fit. `order` is the order they stand in, the one that goes first the last: they leave from the end, so a
 * narrow pane keeps the name and the date and loses the kind first. `main` is the name's floor, `end` the trailing slot, `pad` the row's padding.
 * A function of the width alone: the same width gives the same columns narrowing or widening.
 */
export function listColumns({ width, order = [], widths = {}, main = 200, end = 28, pad = 24, gap = 8 } = {}) {
  const W = Number.isFinite(width) ? width : 0;
  for (let k = order.length; k > 0; k--) {
    const cols = order.slice(0, k);
    const need = pad + main + end + gap * (cols.length + 2) + cols.reduce((a, c) => a + (Number(widths[c]) || 0), 0);
    if (need <= W) return cols;
  }
  return [];
}

/** Two groups of tabs sit side by side, and stack when the surface is narrower than this. */
export const GROUPS_STACK_BELOW = 1000;
export const groupsStack = width => Number.isFinite(width) && width < GROUPS_STACK_BELOW;
export function tabsMode({ n, natural = [], width, gap = 0, min = TAB_MIN } = {}) {
  if (!(n > 0)) return 'full';
  const W = Number.isFinite(width) ? width : 0;
  const need = natural.slice(0, n).reduce((a, w) => a + (Number.isFinite(w) ? w : 0), 0) + gap * (n - 1) + SAFE;
  if (need <= W) return 'full';
  if ((n + 1) * min <= W) return 'compact';
  return 'picker';
}

// ---------------------------------------------------------------------------------------------
// Spec to model

export class BarModelError extends Error {
  constructor(problems) { super(`bar model: ${problems.join('; ')}`); this.name = 'BarModelError'; this.problems = problems; }
}

const SPEC_KEYS = ['kind', 'stack', 'equal', 'lead', 'message', 'status', 'views', 'filters', 'items', 'hasOverflow', 'switchEnd', 'statusLast'];
const ITEM_KEYS = ['id', 'kind', 'role', 'fold', 'keep', 'presence', 'slot'];
const isId = s => typeof s === 'string' && s.length > 0;
const isNum = x => typeof x === 'number' && Number.isFinite(x) && x >= 0;
const unknown = (o, allowed, what) => Object.keys(o).filter(k => !allowed.includes(k)).map(k => `${what}: unknown key '${k}' (allowed: ${allowed.join(', ')})`);

/** The pure validator for the item list and spec a builder emits. Returns a list of problems, empty when the spec is acceptable. */
export function validateBarSpec(spec) {
  const p = [];
  if (!spec || typeof spec !== 'object') return ['spec is not an object'];
  p.push(...unknown(spec, SPEC_KEYS, 'spec'));
  if (!BAR_KINDS.includes(spec.kind)) p.push(`kind '${spec.kind}' is not one of ${BAR_KINDS.join(', ')}`);
  for (const k of ['stack', 'equal', 'lead', 'message', 'status', 'hasOverflow', 'switchEnd', 'statusLast']) if (spec[k] !== undefined && typeof spec[k] !== 'boolean') p.push(`${k} must be a boolean`);
  if (spec.switchEnd && (spec.stack !== false || !spec.lead || !(spec.views || []).length)) p.push('switchEnd is for a head that never stacks, has a title and a view switch (the title bar)');
  const ids = new Set(), seen = id => { if (!isId(id)) p.push(`id '${id}' must be a non-empty string`); else if (ids.has(id)) p.push(`duplicate id '${id}'`); else ids.add(id); };
  if (spec.views !== undefined) {
    if (!Array.isArray(spec.views) || spec.views.length > 2) p.push('views must be an array of at most 2');
    else for (const v of spec.views) { seen(v?.id); if (!Number.isInteger(v?.n) || v.n < 2) p.push(`view '${v?.id}': n must be an integer of at least 2`); p.push(...unknown(v || {}, ['id', 'n'], `view '${v?.id}'`)); }
  }
  if (spec.filters !== undefined) {
    if (!Array.isArray(spec.filters)) p.push('filters must be an array');
    else for (const f of spec.filters) { seen(f?.id); if (!FILTER_KINDS.includes(f?.kind)) p.push(`filter '${f?.id}': kind '${f?.kind}' is not one of ${FILTER_KINDS.join(', ')}`); p.push(...unknown(f || {}, ['id', 'kind'], `filter '${f?.id}'`)); }
  }
  if (!Array.isArray(spec.items)) { p.push('items must be an array'); return p; }
  let primaries = 0;
  for (const it of spec.items) {
    const tag = `item '${it?.id}'`;
    if (!it || typeof it !== 'object') { p.push('an item is not an object'); continue; }
    p.push(...unknown(it, ITEM_KEYS, tag)); seen(it.id);
    if (!ITEM_KINDS.includes(it.kind)) p.push(`${tag}: kind '${it.kind}' is not one of ${ITEM_KINDS.join(', ')}`);
    if (!ROLES.includes(it.role)) p.push(`${tag}: role '${it.role}' is not one of ${ROLES.join(', ')} (a destructive act is an overflow entry)`);
    if (it.role === 'primary') primaries++;
    if (it.fold !== undefined && !(Number.isInteger(it.fold) && it.fold >= 0 && it.fold <= 9)) p.push(`${tag}: fold must be an integer 0..9`);
    if (it.keep !== undefined && typeof it.keep !== 'boolean') p.push(`${tag}: keep must be a boolean`);
    if (it.presence !== undefined && !['always', 'reserve'].includes(it.presence)) p.push(`${tag}: presence must be 'always' or 'reserve'`);
    if (it.presence === 'reserve' && it.kind !== 'act') p.push(`${tag}: only an act can be reserved (icon-only)`);
    if (it.slot !== undefined && it.slot !== 'lead' && it.slot !== 'end') p.push(`${tag}: slot is 'lead' or 'end'`);
    if (it.slot === 'end' && it.role === 'primary') p.push(`${tag}: a primary cannot sit in the end group`);
    if (it.slot === 'lead' && !spec.lead) p.push(`${tag}: slot 'lead' needs the bar to declare lead`);
    if (it.role === 'primary' && (it.presence === 'reserve' || it.slot === 'lead')) p.push(`${tag}: a primary cannot be reserved or sit in the lead slot`);
    if (it.kind === 'swap' && it.role === 'quiet') p.push(`${tag}: a swap is secondary or primary`);
  }
  if (primaries > 1) p.push(`two primaries (${spec.items.filter(i => i?.role === 'primary').map(i => i.id).join(', ')}): make one secondary or move it to overflow`);
  return p;
}

/** Validates the measured widths against the spec: every declared thing has a finite width, and compact never exceeds full. */
export function validateMeasured(spec, measured) {
  const p = [];
  if (!measured || typeof measured !== 'object') return ['measured is not an object'];
  if (!isNum(measured.gap)) p.push('gap must be a finite number');
  if (!isNum(measured.more)) p.push('more must be a finite number');
  if (spec.lead && !isNum(measured.lead)) p.push('lead floor missing');
  if (spec.status && !isNum(measured.status)) p.push('status width missing');
  if (measured.fixed !== undefined && !(Array.isArray(measured.fixed) && measured.fixed.every(isNum))) p.push('fixed must be an array of widths');
  for (const v of spec.views || []) { const w = measured.views?.[v.id]; if (!w || !isNum(w.seg) || !isNum(w.dd) || !isNum(w.btn)) p.push(`view '${v.id}': seg, dd and btn must be measured`); }
  for (const f of spec.filters || []) if (!isNum(measured.filters?.[f.id])) p.push(`filter '${f.id}': width missing`);
  for (const it of spec.items || []) {
    const w = measured.items?.[it.id];
    if (!w || !isNum(w.full)) { p.push(`item '${it.id}': full width missing`); continue; }
    if (w.compact !== null && w.compact !== undefined) {
      if (!isNum(w.compact)) p.push(`item '${it.id}': compact must be a width or null`);
      else if (w.compact > w.full) p.push(`item '${it.id}': compact ${w.compact} exceeds full ${w.full}`);
      if ((it.role === 'primary' && !(spec.lead && spec.stack === false)) || it.kind === 'field' || it.kind === 'swap' || it.presence === 'reserve') p.push(`item '${it.id}': a primary (except in a head that never stacks, at its last rung), field, swap or reserved item has no label step (compact must be null)`);
    }
  }
  return p;
}

/** Items in builder order: lead-slot items, then the clusters secondary, quiet, primary; in a cluster the author's order, reserved items last; then the end group (slot 'end'). */
export function orderItems(items) {
  const key = it => [it.slot === 'lead' ? 0 : it.slot === 'end' ? 2 : 1, it.slot === 'lead' || it.slot === 'end' ? 0 : CLUSTER[it.role], it.presence === 'reserve' ? 1 : 0];
  return items.map((it, i) => ({ it, i, k: key(it) })).sort((a, b) => a.k[0] - b.k[0] || a.k[1] - b.k[1] || a.k[2] - b.k[2] || a.i - b.i).map(x => x.it);
}

/** The one function that turns a spec plus measured widths into the model. Throws BarModelError listing every problem. */
export function modelOf(spec, measured) {
  const problems = [...validateBarSpec(spec)];
  if (!problems.length) problems.push(...validateMeasured(spec, measured));
  if (problems.length) throw new BarModelError(problems);
  const items = orderItems(spec.items).map(it => {
    const w = measured.items[it.id], lead = it.slot === 'lead';
    const fold = it.fold ?? (lead ? FOLD_DEFAULT.lead : it.kind === 'act' ? FOLD_DEFAULT[it.role] : FOLD_DEFAULT[it.kind]);
    const out = { id: it.id, kind: it.kind, role: it.role, fold, keep: !!(it.keep ?? (lead || spec.equal || it.role === 'primary' || it.kind === 'field' || it.kind === 'swap')), full: w.full, compact: w.compact ?? null };
    if (it.presence === 'reserve') out.presence = 'reserve';
    if (lead) out.slot = 'lead';
    if (it.slot === 'end') out.slot = 'end';
    return out;
  });
  return {
    gap: measured.gap, stack: spec.stack ?? spec.kind !== 'strip', more: measured.more, hasOverflow: !!spec.hasOverflow,
    lead: spec.lead ? { min: measured.lead } : null, message: !!spec.message, status: spec.status ? { w: measured.status } : null,
    views: (spec.views || []).map(v => ({ id: v.id, ...measured.views[v.id], n: v.n })),
    filters: (spec.filters || []).map(f => ({ id: f.id, kind: f.kind, nat: measured.filters[f.id] })),
    items, fixed: measured.fixed ? [...measured.fixed] : [],
    ...(spec.switchEnd ? { switchEnd: true } : {}),
    ...(spec.statusLast ? { statusLast: true } : {}),
  };
}
