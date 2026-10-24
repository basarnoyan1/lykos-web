// Computed chat figures: the model chooses settings, never supplies observations
// or curve coordinates. All eligible project patients go through the same strict
// complete-case policy and pinned survival engine as the analysis page.
import { DEFAULT_COLUMNS } from './ipd.mjs';
import { DEFAULT_SPEC, rowsFor, survivalInputSnapshot, legacyResult } from './survival-run.mjs';
import { kmScript, kmShape, runJson } from './survival.mjs';
import { kmFigure } from './survival-fig.mjs';
import { figureTokens } from './figure-style.mjs';
import { sanitizeSvg } from './html.mjs';
import { saveFile } from './save.mjs';
import { downloadCsv } from './figure.mjs';
import { svgToPng } from './project-folder.mjs';
import { showMenu } from './menu.mjs';
import { imagePdf } from './research-artifacts.mjs';

const list = (value, name) => {
  if (!Array.isArray(value) || value.length > 20 || value.some(n => typeof n !== 'number' || !Number.isFinite(n) || n < 0)) throw new Error(`${name} must contain up to 20 finite, nonnegative numbers.`);
  return [...new Set(value)].sort((a, b) => a - b);
};

export async function computeChatKaplanMeier(state, args = {}, { exec = runJson, signal } = {}) {
  if (signal?.aborted) throw new Error('Run stopped.');
  const people = structuredClone(state.participants || []), cols = structuredClone(state.ipdColumns || DEFAULT_COLUMNS);
  const missing = ['time', 'event'].filter(r => !cols.some(c => c.role === r));
  if (missing.length) throw new Error(`Assign the ${missing.join(' and ')} column role in Patient data before drawing Kaplan–Meier. Available columns: ${cols.map(c => c.name || c.id).join(', ')}.`);
  if (people.some(p => !p.id) || new Set(people.map(p => p.id)).size !== people.length) throw new Error('Patient records need distinct saved IDs before analysis.');
  const spec = { ...DEFAULT_SPEC, covariates: [], cluster: false, strata: '', restrict: null,
    group: args.group === undefined ? undefined : args.group, bins: args.cut_points === undefined ? [] : list(args.cut_points, 'Cut points'),
    landmarks: args.landmarks === undefined ? DEFAULT_SPEC.landmarks : list(args.landmarks, 'Landmarks') };
  if (spec.group !== undefined && spec.group !== null && (typeof spec.group !== 'string' || !cols.some(c => c.id === spec.group))) throw new Error('Choose an exact patient group column ID, or null for one curve.');
  const group = spec.group === null ? null : spec.group === undefined ? cols.find(c => c.role === 'group') : cols.find(c => c.id === spec.group);
  if (['time', 'event'].includes(group?.role)) throw new Error('The follow-up and event columns cannot define comparison groups.');
  if (group?.type === 'number' && !spec.bins.length) throw new Error('A numeric group needs explicit cut_points, or group:null for one curve.');
  if (spec.bins.length && group?.type !== 'number') throw new Error('Cut points require a numeric group column.');
  if (args.confidence_bands !== undefined && typeof args.confidence_bands !== 'boolean') throw new Error('confidence_bands must be true or false.');
  const { rows, excluded, levels, groupName } = rowsFor(people, cols, spec);
  if (rows.length < 2) throw new Error(`Kaplan–Meier needs at least two eligible patients; ${rows.length} eligible and ${excluded.length} excluded from ${people.length}. Check follow-up, event status and groups in Patient data.`);
  if (levels.length > 12) throw new Error('More than 12 groups would be unreadable. Choose a categorical group or explicit numeric cut points.');
  const script = kmScript(rows, { levels, landmarks: spec.landmarks });
  const raw = await exec(script);
  if (signal?.aborted) throw new Error('Run stopped.');
  const km = kmShape(raw), at = new Date().toISOString(), title = 'Kaplan–Meier survival';
  if (km.by.reduce((n, g) => n + g.n, 0) !== rows.length || km.by.some(g => !Array.isArray(g.steps))) throw new Error('The survival engine returned an inconsistent analysed population.');
  km.rScript ||= { code: script, r: '', packages: { survival: '' }, at };
  const figure = { title, ci: args.confidence_bands === true };
  const plot = kmFigure(km, { title, xLabel: 'Months', ci: figure.ci, style: figureTokens(null, { medium: 'export' }) });
  const reports = new Map((state.papers || []).map(p => [p.id, p]));
  const person = p => ({ id: p.id, study_id: p.study_id ?? null, reconstructed: p.reconstructed || null,
    institutional: !reports.has(p.study_id) || !!reports.get(p.study_id)?.institutional });
  const source = new Map(people.map(p => [p.id, p]));
  const ext = { figure, inputSpec: structuredClone(spec), spec: structuredClone(spec), inputSnapshot: survivalInputSnapshot(people, cols, spec), inputRows: rows,
    population: { participants: rows.map(r => person(source.get(r.id))), excluded: excluded.map(x => ({ ...person(x.p), why: x.why })) },
    counts: { n: rows.length, events: rows.reduce((n, r) => n + r.event, 0), excluded: excluded.length, source: people.length },
    groupName, groups: levels, km, at, stages: {}, method: 'Kaplan–Meier; log-log 95% confidence intervals; no adjusted model or comparison test' };
  const analysis = { ...legacyResult({ km, tests: null, cox: null }, rows, plot, at), ext };
  return { type: 'survival', title, analysis, frozenInput: { columns: cols, participants: people },
    note: `${rows.length} eligible patients, ${ext.counts.events} events, ${excluded.length} excluded, all ${people.length} project patient records assessed. Time is recorded in months.` };
}

export function survivalBlockSummary(block) {
  const ext = block.analysis.ext;
  return { method: ext.method, source: 'Complete project patient records', counts: ext.counts, group_column: ext.groupName,
    groups: ext.km.by.map(g => ({ group: g.group, n: g.n, events: g.events, median: g.median, landmarks: g.survival })),
    exclusions: Object.entries(ext.population.excluded.reduce((a, x) => { a[x.why] = (a[x.why] || 0) + 1; return a; }, {})).map(([reason, n]) => ({ reason, n })),
    warnings: ext.km.warnings, at: ext.at };
}

export function survivalBlockCsv(block) {
  return [['Group', 'Time (months)', 'Survival', 'Lower 95% CI', 'Upper 95% CI', 'At risk', 'Events', 'Censored'],
    ...block.analysis.ext.km.by.flatMap(g => g.steps.map(t => [g.group, t.time, t.surv, t.lo, t.hi, t.nRisk, t.nEvent, t.nCensor]))];
}

export function survivalBlockR(block) {
  const code = block.analysis.ext.km.rScript.code;
  if (typeof code !== 'string' || !code.trim()) throw new Error('The exact Kaplan–Meier script is unavailable. Draw the curve again.');
  return `# Exact recorded Kaplan–Meier code; attach the recorded package first.\nlibrary(survival)\n${code}\n`;
}

// The existing PDF writer uses an A4 page; pad an aspect-preserving figure on
// an A4 canvas before embedding it rather than stretching its plotted axes.
async function figurePdf(svg) {
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  try {
    const img = new Image();
    await new Promise((resolve, reject) => { img.onload = resolve; img.onerror = () => reject(new Error('The figure could not be drawn.')); img.src = url; });
    const vb = svg.match(/viewBox="([^"]+)"/)?.[1]?.split(/[\s,]+/).map(Number), w = vb?.[2] || 600, h = vb?.[3] || 400;
    const c = document.createElement('canvas'); c.width = 1786; c.height = 2526;
    const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
    const scale = Math.min((c.width - 120) / w, (c.height - 120) / h);
    ctx.drawImage(img, (c.width - w * scale) / 2, (c.height - h * scale) / 2, w * scale, h * scale);
    const blob = await new Promise(resolve => c.toBlob(resolve, 'image/jpeg', .95));
    if (!blob) throw new Error('PDF image export failed.');
    return imagePdf([{ bytes: new Uint8Array(await blob.arrayBuffer()), width: c.width, height: c.height }]);
  } finally { URL.revokeObjectURL(url); }
}

export function downloadSurvivalBlock(block, anchor) {
  const svg = sanitizeSvg(block.analysis.plot), name = 'kaplan-meier';
  showMenu(anchor, [
    { label: 'SVG', icon: 'download', run: () => saveFile(svg, name + '.svg', 'image/svg+xml') },
    { label: 'PNG', icon: 'download', run: async () => { const bytes = await svgToPng(svg); if (!bytes) throw new Error('PNG export is unavailable.'); return saveFile(bytes, name + '.png', 'image/png'); } },
    { label: 'PDF', icon: 'download', run: async () => saveFile(await figurePdf(svg), name + '.pdf', 'application/pdf') },
    { label: 'Results CSV', icon: 'download', run: () => downloadCsv(survivalBlockCsv(block), name + '-results.csv') },
    { label: 'R script', icon: 'download', run: () => saveFile(survivalBlockR(block), name + '.R', 'text/plain') },
    { label: 'Frozen input and result', icon: 'download', run: () => saveFile(JSON.stringify(block, null, 2), name + '.json', 'application/json') },
  ].map(item => ({ ...item, run: async () => { try { await item.run(); } catch (error) {
    anchor.title = error.message;
    const host = anchor.closest('.chat-block');
    if (host) { const note = host.querySelector('.chat-block-error') || Object.assign(document.createElement('p'), { className: 'chat-block-note chat-block-error', role: 'alert' }); note.textContent = error.message; host.append(note); }
  } } })));
}
