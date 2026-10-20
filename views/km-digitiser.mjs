// Kaplan–Meier digitiser (plan §4.8a): a picture of a survival curve in, patients out.
//
// The person sets two known points on each axis, picks the colour of a curve
// (or clicks points along it), types the numbers at risk printed under the
// figure, and reads the reconstruction against the picture before it is added
// to the patient data as rows flagged reconstructed. Nothing is added without
// that last step, and every number can be corrected by hand.
//
// It is a tab of the Files view, "Curve: <study> p.N" (DIALOGS plan #54): the picture beside its settings, with its own tools bar under the tab. The
// work (the picture, the marks, the numbers, the result) lives in `st`, held by the tab's tool, so a tab the page released draws itself again as it was.
import { esc } from '../lib/html.mjs';
import { icon } from '../lib/icons.mjs';
import { get, update } from '../store.mjs';
import { calibration, traceCurve, pickColour, toData } from '../lib/km-trace.mjs';
import { reconstructKm, kaplanMeier, medianOf, curveError } from '../lib/km-reconstruct.mjs';
import { applyReconstruction, UNIT_NAMES, METHOD } from '../lib/km-ipd.mjs';
import { uiBar, watchWidth } from '../lib/ui-actions.mjs';
import { formField, tableRegion } from '../lib/ui-components.mjs';
import { toolStacks } from './file-doc.mjs';

const MAX_ARMS = 6;
const MAX_SIDE = 4000;
const nums = text => String(text || '').split(/[\s,;]+/).filter(Boolean).map(Number);
const hex = c => `#${c.map(v => v.toString(16).padStart(2, '0')).join('')}`;
const clip = (t, n) => (String(t).length > n ? `${String(t).slice(0, n - 1)}…` : String(t));
const swatch = i => `<span class="dg-swatch" data-i="${i}"></span>`;
const POINTS = [['x', 0, 'Time, first point'], ['x', 1, 'Time, second point'], ['y', 0, 'Survival, first point'], ['y', 1, 'Survival, second point']];
const point = ([axis, i, label]) => `<div class="dg-point"><div class="dg-l"><span>${label}</span><span class="meta" data-pos="${axis}${i}">Not set</span></div>
  <button type="button" data-tool="${axis}${i}" aria-pressed="false" aria-label="Set ${label.toLowerCase()} on the picture">Set</button>
  <input data-val="${axis}${i}" class="num" inputmode="decimal" aria-label="${label} value"></div>`;

/** An image file or blob as a canvas, at most MAX_SIDE on a side. */
export async function canvasOf(blob) {
  const bmp = await createImageBitmap(blob);
  const k = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
  const g = c.getContext('2d', { willReadFrequently: true });
  g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
  g.drawImage(bmp, 0, 0, c.width, c.height);
  bmp.close?.();
  return c;
}

/**
 * Open the digitiser as a Files tab. image: a canvas (a figure region drawn from a PDF page, or a picture). source: where the figure is, kept with the
 * reconstruction. ctx: the shell's, to go to Files. Resolves once the tab is open.
 */
export async function openDigitiser({ image = null, paperId = null, source = {}, ctx = null } = {}) {
  const paper = (get().papers || []).find(p => p.id === paperId);
  const st = {
    canvas: image, img: null, mode: null, x: [null, null], y: [null, null], vx: ['0', ''], vy: ['0', '1'], box: null, percent: false, unit: 'months',
    times: '', arms: [newArm(0)], result: null, study: paperId, drag: null, status: '',
  };
  const tool = { label: `Curve: ${clip(paper?.label || paper?.title || 'image', 28)}${source.page ? ` p.${source.page}` : ''}`, icon: 'curve',
    mount: (ops, host) => mountDigitiser(ops, host, st, source) };
  const files = await import('./files.mjs');
  files.openTool(tool);
  ctx?.go?.('files');
}
function newArm(i) { return { name: `Arm ${i + 1}`, colour: null, pix: [], risk: '', total: '' }; }

function mountDigitiser(ops, { body: b, placeTools }, st, source) {
  const { uid: u, inst, say, isLive } = ops;
  const papers = get().papers || [], paperName = id => { const p = papers.find(x => x.id === id); return p ? (p.label || p.title || p.id) : 'None'; };
  const axisFields = [formField('Unit', `<select data-dg="unit">${UNIT_NAMES.map(x => `<option>${x}</option>`).join('')}</select>`),
    formField('Scale', '<select data-dg="scale"><option value="1">0 to 1</option><option value="100">0 to 100</option></select>')].join('');
  b.classList.add('fv-tool-body');
  b.innerHTML = `<div class="dg-work">
    <div class="dg-view" tabindex="0" role="region" aria-label="Figure"><div class="dg-stack"><canvas></canvas><canvas></canvas></div><div class="dg-empty">${icon('image', { size: 22 })}<span>Open or paste an image</span></div></div>
    <div class="dg-side">
      <section class="an-section"><h3>Axes</h3>
        <div class="dg-pts">${POINTS.map(point).join('')}</div>
        <div class="an-settings">${axisFields}</div>
        ${uiBar({ kind: 'tools', density: 'dense', id: `${u}-axes`, label: 'Plot area', actions: [{ id: `${u}-area`, label: 'Plot area', icon: 'region', role: 'secondary', pressed: false, attrs: { 'data-tool': 'area' } }] })}</section>
      <section class="an-section"><h3>Curves</h3><div data-dg="arms"></div>
        ${uiBar({ kind: 'tools', density: 'dense', id: `${u}-add-curve`, label: 'Curves', actions: [{ id: `${u}-add-arm`, label: 'Add curve', icon: 'plus', role: 'secondary' }] })}</section>
      <section class="an-section"><h3>Numbers at risk</h3>
        <div class="an-settings">${formField('Times', '<input data-dg="times" class="num" placeholder="0, 6, 12, 18" aria-label="Times of the numbers at risk">', { span: 2 })}</div>
        <div data-dg="risk"></div></section>
      <section class="an-section" data-dg="result" hidden></section>
    </div></div>`;
  const $ = s => b.querySelector(s);
  const view = $('.dg-view'), stack = $('.dg-stack'), empty = $('.dg-empty'), [imgC, over] = stack.querySelectorAll('canvas');

  const bar = placeTools(ops, {
    label: 'Curve tools', message: { id: `${u}-status`, text: st.status },
    actions: [
      { id: `${u}-image`, label: 'Image', icon: 'image', role: 'secondary', fold: 3 },
      { picker: true, id: `${u}-study`, label: 'Study', icon: 'library', role: 'quiet', fold: 5, value: paperName(st.study), options: [['', 'None'], ...papers.map(p => [p.id, p.label || p.title || p.id])], valueCh: 16 },
      { id: `${u}-run`, label: 'Reconstruct', icon: 'run', role: 'secondary' },
      { id: `${u}-apply`, label: 'Add to patient data', icon: 'plus', role: 'primary', disabled: true },
    ],
  });
  const tool = id => bar.querySelector(`[id="${u}-${id}"]`);
  const status = t => { st.status = t || ''; const m = tool('status'); if (m) { m.textContent = st.status; m.title = st.status; } };

  // ---- the picture -----------------------------------------------------
  const setImage = c => {
    st.canvas = c; st.img = null; st.x = [null, null]; st.y = [null, null]; st.box = null; st.result = null;
    st.arms.forEach(a => { a.pix = []; a.colour = null; });
    draw(); paint();
  };
  const choose = async f => { if (!f) return; try { setImage(await canvasOf(f)); } catch (err) { status(`Could not read the image: ${err.message}`); } };
  tool('image').onclick = () => { const input = document.createElement('input'); input.type = 'file'; input.accept = 'image/*'; input.onchange = () => choose(input.files[0]); input.click(); };
  b.addEventListener('paste', e => {
    const f = [...(e.clipboardData?.files || [])].find(x => x.type.startsWith('image/'));
    if (f) { e.preventDefault(); choose(f); }
  });
  const imageData = () => {
    if (!st.img) st.img = st.canvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, st.canvas.width, st.canvas.height);
    return st.img;
  };
  const cssColour = name => getComputedStyle(b).getPropertyValue(name).trim() || '#000';

  // ---- calibration -----------------------------------------------------
  const calib = () => {
    if (st.x.some(p => !p) || st.y.some(p => !p) || st.vx[0] === '' || st.vx[1] === '') return null;
    try {
      return calibration({ x: st.x.map((p, i) => ({ px: p.px, val: Number(st.vx[i]) })), y: st.y.map((p, i) => ({ py: p.py, val: Number(st.vy[i]) })), percent: st.percent });
    } catch { return null; }
  };
  /** The plot area: what the person dragged, else the span between the calibration points, with a little room. */
  const plotBox = () => {
    if (st.box) return st.box;
    if (st.x.some(p => !p) || st.y.some(p => !p)) return null;
    const xs = st.x.map(p => p.px), ys = st.y.map(p => p.py), w = Math.abs(xs[1] - xs[0]);
    return { x0: Math.min(...xs) - 2, x1: Math.max(...xs) + Math.max(4, w * 0.02), y0: Math.min(...ys) - 3, y1: Math.max(...ys) + 3 };
  };

  // ---- rendering the picture and marks ----------------------------------
  // The picture fits the width of its box and scrolls down when it is taller.
  const scaleOf = () => (st.canvas ? Math.max(0.05, Math.min((view.clientWidth - 2) / st.canvas.width, 1)) : 1);
  function draw() {
    empty.hidden = !!st.canvas;
    stack.hidden = !st.canvas;
    if (!st.canvas) return;
    const w = st.canvas.width, h = st.canvas.height, k = scaleOf();
    for (const c of [imgC, over]) { c.width = w; c.height = h; }
    stack.style.setProperty('--dg-w', `${Math.round(w * k)}px`); stack.style.setProperty('--dg-h', `${Math.round(h * k)}px`);
    imgC.getContext('2d').drawImage(st.canvas, 0, 0);
    marks();
  }
  function marks() {
    if (!st.canvas) return;
    const g = over.getContext('2d'), ink = cssColour('--ink'), k = 1 / scaleOf();
    g.clearRect(0, 0, over.width, over.height);
    g.lineWidth = Math.max(1, k); g.strokeStyle = ink; g.fillStyle = ink;
    st.x.forEach(p => { if (p) { g.beginPath(); g.moveTo(p.px, 0); g.lineTo(p.px, over.height); g.setLineDash([4 * k, 4 * k]); g.stroke(); g.setLineDash([]); } });
    st.y.forEach(p => { if (p) { g.beginPath(); g.moveTo(0, p.py); g.lineTo(over.width, p.py); g.setLineDash([4 * k, 4 * k]); g.stroke(); g.setLineDash([]); } });
    const box = plotBox();
    if (box && (st.box || st.mode === 'area')) { g.setLineDash([6 * k, 3 * k]); g.strokeRect(box.x0, box.y0, box.x1 - box.x0, box.y1 - box.y0); g.setLineDash([]); }
    st.arms.forEach(a => {
      g.fillStyle = a.colour ? hex(a.colour) : ink;
      for (const p of a.pix) g.fillRect(p.px - k, p.py - k, 2 * k, 2 * k);
    });
    const cal = calib();
    if (cal && st.result) {
      st.result.arms.forEach((r, i) => {
        if (!r.ok) return;
        const a = st.arms[i]; g.strokeStyle = a.colour ? hex(a.colour) : ink; g.lineWidth = Math.max(1.5, 1.5 * k); g.setLineDash([5 * k, 3 * k]);
        g.beginPath(); let last = null;
        for (const p of kaplanMeier(r.rows)) {
          const q = cal.toPixel(p.t, p.s);
          if (last) g.lineTo(q.px, last.py); else g.moveTo(q.px, q.py);
          g.lineTo(q.px, q.py); last = q;
        }
        g.stroke(); g.setLineDash([]);
      });
    }
  }

  // ---- the side panel ---------------------------------------------------
  // build() draws the rows that depend on how many curves there are; paint() brings everything else up to date in place. Nothing a field does
  // on blur replaces a button, or a click on the next control would be lost.
  const armTools = (a, i) => uiBar({ kind: 'tools', density: 'dense', id: `${u}-arm-${i}`, label: `Tools for ${a.name}`,
    actions: [{ id: `${u}-trace-${i}`, label: 'Trace', icon: 'trace-curve', role: 'secondary', disabled: true },
      { id: `${u}-add-${i}`, label: 'Add points', icon: 'dot', role: 'secondary', pressed: false, attrs: { 'data-tool': `add:${i}` } },
      { id: `${u}-erase-${i}`, label: 'Erase points', icon: 'minus', role: 'secondary', pressed: false, attrs: { 'data-tool': `erase:${i}` } }],
    overflow: [{ id: `${u}-clear-${i}`, label: 'Clear points' }, ...(st.arms.length > 1 ? [{ id: `${u}-drop-${i}`, label: 'Remove curve', danger: true }] : [])] });
  function build() {
    $('[data-dg=arms]').innerHTML = st.arms.map((a, i) => `<div class="dg-arm" data-arm="${i}">
        <div class="dg-name"><input data-name="${i}" value="${esc(a.name)}" aria-label="Curve name">
          <button type="button" data-tool="colour:${i}" aria-pressed="false">${swatch(i)}<span>Colour</span></button></div>
        ${armTools(a, i)}<span class="meta" data-count="${i}"></span></div>`).join('');
    $('[data-dg=risk]').innerHTML = st.arms.map((a, i) => `<div class="dg-risk"><span class="dg-l" data-alabel="${i}">${esc(a.name)}</span>
        <input class="num" data-risk="${i}" value="${esc(a.risk)}" placeholder="90, 66, 26" aria-label="Numbers at risk, ${esc(a.name)}">
        <input class="num" data-total="${i}" value="${esc(a.total)}" placeholder="Events" aria-label="Total events, ${esc(a.name)}"></div>`).join('');
    wireSide();
    paint();
  }
  function paint() {
    const pos = p => (p ? `${Math.round(p.px)}, ${Math.round(p.py)}` : 'Not set');
    st.x.forEach((p, i) => { $(`[data-pos=x${i}]`).textContent = pos(p); });
    st.y.forEach((p, i) => { $(`[data-pos=y${i}]`).textContent = pos(p); });
    b.querySelectorAll('[data-tool]').forEach(el => el.setAttribute('aria-pressed', String(st.mode === el.dataset.tool)));
    const ready = Boolean(calib());
    st.arms.forEach((a, i) => {
      const trace = b.querySelector(`[id="${u}-trace-${i}"]`); if (trace) trace.disabled = !(a.colour && ready);
      $(`[data-count="${i}"]`).textContent = a.pix.length ? `${a.pix.length} points` : '';
      const sw = $(`.dg-swatch[data-i="${i}"]`);
      if (sw) sw.style.background = a.colour ? hex(a.colour) : '';
      $(`[data-alabel="${i}"]`).textContent = a.name;
    });
    const add = b.querySelector(`[id="${u}-add-arm"]`); if (add) add.disabled = st.arms.length >= MAX_ARMS;
    renderResult();
    marks();
  }
  function wireSide() {
    b.querySelectorAll('[data-tool]').forEach(el => { el.onclick = () => { st.mode = st.mode === el.dataset.tool ? null : el.dataset.tool; paint(); status(''); }; });
    b.querySelectorAll('[data-name]').forEach(el => { el.onchange = () => { st.arms[Number(el.dataset.name)].name = el.value.trim() || `Arm ${Number(el.dataset.name) + 1}`; st.result = null; paint(); }; });
    b.querySelectorAll('[data-risk]').forEach(el => { el.onchange = () => { st.arms[Number(el.dataset.risk)].risk = el.value; }; });
    b.querySelectorAll('[data-total]').forEach(el => { el.onchange = () => { st.arms[Number(el.dataset.total)].total = el.value; }; });
    st.arms.forEach((a, i) => {
      const at = id => b.querySelector(`[id="${u}-${id}-${i}"]`);
      at('trace').onclick = () => trace(i);
      at('clear').onclick = () => { a.pix = []; st.result = null; paint(); };
      const drop = at('drop'); if (drop) drop.onclick = () => { st.arms.splice(i, 1); st.result = null; st.mode = null; build(); };
    });
  }
  b.querySelector(`[id="${u}-add-arm"]`).onclick = () => { st.arms.push(newArm(st.arms.length)); build(); };
  const unit = $('[data-dg=unit]'), scale = $('[data-dg=scale]'), times = $('[data-dg=times]');
  unit.value = st.unit; scale.value = st.percent ? '100' : '1'; times.value = st.times;
  unit.onchange = () => { st.unit = unit.value; renderResult(); };
  scale.onchange = () => {
    st.percent = scale.value === '100';
    st.vy = ['0', st.percent ? '100' : '1']; syncValues(); st.result = null; paint();
  };
  const syncValues = () => { for (const [axis, i] of POINTS) $(`[data-val=${axis}${i}]`).value = (axis === 'x' ? st.vx : st.vy)[i]; };
  syncValues();
  b.querySelectorAll('[data-val]').forEach(el => { el.onchange = () => { const [axis, i] = [el.dataset.val[0], Number(el.dataset.val[1])]; (axis === 'x' ? st.vx : st.vy)[i] = el.value.trim(); st.result = null; paint(); }; });
  times.onchange = () => { st.times = times.value; };
  tool('study').addEventListener('ui-pick', e => {
    st.study = e.detail?.value || null;
    const v = tool('study').querySelector('.ui-picker-value'); if (v) v.textContent = paperName(st.study);
  });
  inst.releasers.push(watchWidth(view, () => { if (isLive()) draw(); }), watchWidth(b, () => b.toggleAttribute('data-stacked', toolStacks(b.clientWidth))));

  // ---- tracing ------------------------------------------------------------
  function trace(i) {
    const a = st.arms[i], cal = calib(), box = plotBox();
    if (!a.colour || !cal || !box) return;
    status('Tracing');
    const others = st.arms.filter((o, j) => j !== i && o.colour).map(o => o.colour);
    const t = traceCurve(imageData(), { colour: a.colour, box, others });
    a.pix = t.points; st.result = null;
    status(t.points.length ? '' : 'No curve of that colour in the area');
    paint();
  }

  // ---- clicks on the picture --------------------------------------------
  const at = e => {
    const r = over.getBoundingClientRect();
    return { px: (e.clientX - r.left) * over.width / r.width, py: (e.clientY - r.top) * over.height / r.height };
  };
  over.addEventListener('pointerdown', e => {
    if (!st.canvas || !st.mode) return;
    e.preventDefault();
    const p = at(e), [kind, arg] = st.mode.split(':');
    if (kind === 'area') { st.drag = { x: p.px, y: p.py }; over.setPointerCapture(e.pointerId); return; }
    if (/^[xy][01]$/.test(kind)) {
      (kind[0] === 'x' ? st.x : st.y)[Number(kind[1])] = { px: p.px, py: p.py };
      st.mode = null; st.result = null; paint(); return;
    }
    const i = Number(arg), a = st.arms[i];
    if (kind === 'colour') { a.colour = pickColour(imageData(), p.px, p.py); st.mode = null; paint(); return; }
    if (kind === 'add') { a.pix = [...a.pix, p]; st.result = null; paint(); return; }
    if (kind === 'erase') {
      const rad = 10 / scaleOf();
      let best = -1, bd = rad * rad;
      a.pix.forEach((q, j) => { const dd = (q.px - p.px) ** 2 + (q.py - p.py) ** 2; if (dd < bd) { bd = dd; best = j; } });
      if (best >= 0) { a.pix.splice(best, 1); st.result = null; paint(); }
    }
  });
  over.addEventListener('pointermove', e => {
    if (!st.drag) return;
    const p = at(e);
    st.box = { x0: Math.min(st.drag.x, p.px), y0: Math.min(st.drag.y, p.py), x1: Math.max(st.drag.x, p.px), y1: Math.max(st.drag.y, p.py) };
    marks();
  });
  over.addEventListener('pointerup', () => { if (st.drag) { st.drag = null; st.mode = null; paint(); } });

  // ---- reconstruction -------------------------------------------------------
  function run() {
    const cal = calib();
    if (!cal) { status('Set two points on each axis and their values'); return; }
    const ts = nums(times.value);
    const arms = [];
    st.arms.forEach(a => {
      if (a.pix.length < 2) { arms.push({ ok: false, why: 'No curve' }); return; }
      const n = nums(a.risk);
      if (!ts.length || n.length !== ts.length || n.some(v => !Number.isFinite(v))) { arms.push({ ok: false, why: 'Numbers at risk do not match the times' }); return; }
      try {
        const points = toData(a.pix, cal);
        const total = a.total.trim() === '' ? null : Number(a.total);
        const r = reconstructKm(points, ts.map((t, j) => ({ t, n: n[j] })), { totalEvents: total });
        const km = kaplanMeier(r.rows);
        arms.push({ ok: true, rows: r.rows, events: r.events, censored: r.censored, n: r.n, warnings: r.warnings, curve: r.curve,
          median: medianOf(km), error: curveError(r.rows, r.curve), total, risk: ts.map((t, j) => ({ t, n: n[j] })) });
      } catch (err) { arms.push({ ok: false, why: err.message }); }
    });
    st.result = { arms };
    paint();
    status('');
  }
  tool('run').onclick = run;

  function renderResult() {
    const box = $('[data-dg=result]'), r = st.result;
    const good = r?.arms.filter(a => a.ok) || [];
    const apply = tool('apply'); if (apply) apply.disabled = !good.length || good.length !== r.arms.length;
    box.hidden = !r;
    if (!r) { box.innerHTML = ''; return; }
    box.innerHTML = `<h3>Reconstruction</h3><p class="meta">${esc(METHOD)}</p>${tableRegion({ label: 'Reconstruction', html: `<table class="dg-table"><thead><tr><th class="grow">Curve</th><th class="num">n</th><th class="num">Events</th><th class="num">Censored</th><th class="num">Median (${esc(st.unit)})</th><th class="num">Mean gap</th></tr></thead>
      <tbody>${r.arms.map((a, i) => a.ok
        ? `<tr><td class="grow">${esc(st.arms[i].name)}</td><td class="num">${a.n}</td><td class="num">${a.events}</td><td class="num">${a.censored}</td><td class="num">${a.median == null ? 'not reached' : (a.median).toFixed(1)}</td><td class="num">${(a.error.mean * 100).toFixed(2)}%</td></tr>`
        : `<tr><td class="grow">${esc(st.arms[i].name)}</td><td colspan="5">${esc(a.why)}</td></tr>`).join('')}</tbody></table>` })}
      ${good.flatMap(a => a.warnings.map(w => `<div class="note">${esc(w)}</div>`)).join('')}`;
  }

  tool('apply').onclick = () => {
    const r = st.result;
    if (!r || r.arms.some(a => !a.ok)) return;
    const cal = { x: st.x.map((p, i) => ({ ...p, val: Number(st.vx[i]) })), y: st.y.map((p, i) => ({ ...p, val: Number(st.vy[i]) })), percent: st.percent };
    const thin = pix => { const q = pix.map(p => ({ px: Math.round(p.px * 10) / 10, py: Math.round(p.py * 10) / 10 })); return q.length > 1500 ? q.filter((_, i) => i % Math.ceil(q.length / 1500) === 0) : q; };
    try {
      update(s => {
        applyReconstruction(s, {
          studyId: st.study, unit: st.unit, source: { ...source, paper: st.study || source.paper || null }, calibration: cal,
          image: st.canvas ? { width: st.canvas.width, height: st.canvas.height } : null,
          arms: r.arms.map((a, i) => ({ name: st.arms[i].name, rows: a.rows, colour: st.arms[i].colour ? hex(st.arms[i].colour) : null,
            risk: a.risk, totalEvents: a.total, points: thin(st.arms[i].pix), warnings: a.warnings })),
        });
        return s;
      });
    } catch (err) { status(err.message); return; }
    const n = r.arms.reduce((sum, a) => sum + a.rows.length, 0);
    ops.ctx?.refreshCounts?.();
    say(`Added ${n} reconstructed patients to the patient data`);
    ops.onClose();
  };

  // ---- start ------------------------------------------------------------------
  draw(); build();
}
