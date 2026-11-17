import { consortFlow } from './trial-logs.mjs';
import { trialState, trialPopulation } from './trial-operations.mjs';
import { survivalInputStatus } from './survival-run.mjs';
import { figureTokens } from './figure-style.mjs';
import { svgRoot, text, wrapText, hairLine } from './figure-draw.mjs';
import { flowBox, flowArrow, flowMarker } from './flow-draw.mjs';
export const FLOW_FIELDS = [['assessed', 'Assessed for eligibility'], ['excluded', 'Not enrolled'], ['included', 'Enrolled / randomised'], ['followed', 'Completed follow-up'], ['analysed', 'Analysed']];
export function participantFlow(s) {
  const log = (s.datasets || []).find(d => d.template === 'screening'), t = trialState(s), derived = {}, byArm = [];
  if (log) {
    const f = consortFlow(log);
    Object.assign(derived, { assessed: f.assessed, excluded: f.excluded.total, included: f.randomised });
    for (const arm of Object.keys(f.allocated)) byArm.push({ arm, allocated: f.allocated[arm], withdrawn: f.withdrawn[arm], lost: f.lost[arm], analysed: f.analysed?.[arm] ?? null });
    if (f.analysed) derived.analysed = f.totals.analysed;
  } else if (t.participants.length) {
    const allocated = trialPopulation(s);
    derived.assessed = t.participants.length; derived.included = allocated.length;
    // Awaiting eligibility/consent/allocation is still recruiting, not excluded.
    derived.excluded = t.participants.filter(p => p.eligibility === 'ineligible' || (p.withdrawn && !allocated.some(a => a.participantId === p.id))).length;
  }
  if (!log && survivalInputStatus(s) === 'current') derived.analysed = s.survival.n;
  const rows = FLOW_FIELDS.map(([id, label]) => {
    const entered = s.participantFlow?.[id];
    return { id, label, value: entered?.value != null && entered.value !== '' ? Number(entered.value) : derived[id] ?? null, source: entered?.value != null && entered.value !== '' ? 'Entered by researcher' : derived[id] != null ? (log ? `Screening log: ${log.name}` : id === 'analysed' ? 'Saved survival population' : 'Trial operations') : 'Not recorded', reason: entered?.reason || '', derived: derived[id] ?? null };
  });
  const issues = [];
  for (const r of rows) if (r.source === 'Entered by researcher' && !r.reason.trim()) issues.push(`${r.label}: explain the count`);
  const val = id => rows.find(x => x.id === id).value;
  if (val('assessed') != null && val('included') != null && val('included') > val('assessed')) issues.push('Enrolment exceeds the assessed population');
  if (val('included') != null && val('analysed') != null && val('analysed') > val('included')) issues.push('The analysed count exceeds enrolment; verify the populations');
  return { rows, byArm, issues };
}
export function setFlowCount(s, id, value, reason = '') {
  if (!FLOW_FIELDS.some(x => x[0] === id)) throw new Error('Unknown flow count');
  if (value !== '' && (!Number.isSafeInteger(Number(value)) || Number(value) < 0)) throw new Error('Use a non-negative whole count');
  s.participantFlow = { ...(s.participantFlow || {}), [id]: { value: value === '' ? null : Number(value), reason: String(reason).trim() } };
}
export const participantFlowRows = s => [['Stage', 'Count', 'Source', 'Explanation'], ...participantFlow(s).rows.map(r => [r.label, r.value ?? '', r.source, r.reason])];
/**
 * The participant flow (CONSORT) in the house style (FIGURE-STYLE §2): the counts of the main column in boxes, the
 * not-enrolled count beside the step it leaves, then one column per arm. A label wraps inside its box and the
 * box grows; a count the project does not hold reads "Not recorded". `style` is figureTokens (the print copy when
 * absent); the title goes to <title>, never into the figure.
 */
export function participantFlowSvg(s, { style: t = null, title = 'Participant flow' } = {}) {
  t ||= figureTokens(null, { medium: 'export' });
  const f = participantFlow(s || {}), L = t.size.label, lh = L * 1.3, padX = L * 0.8, padY = L * 0.8, P = Math.max(t.pad, L * 1.2);
  const mainW = L * 20, sideW = L * 13, armW = L * 16, armGap = L * 1.4, gapY = L * 2.6;
  const val = v => (v == null || !Number.isFinite(Number(v)) ? 'Not recorded' : `n = ${v}`);
  // a box: the label (wrapped to the box), then the count in heading weight, then any notes
  const box = (cx, y, width, label, value, notes = []) => {
    const inner = width - 2 * padX;
    const lines = [...wrapText(t, label, inner).map(x => ({ t: x, bold: false })), { t: val(value), bold: true }, ...notes.flatMap(n => wrapText(t, n, inner).map(x => ({ t: x, bold: false })))];
    return { x: cx - width / 2, y, width, height: Math.max(L * 4, lines.length * lh + 2 * padY), lines };
  };
  const draw = b => flowBox(t, b, { padY, lh });
  const AH = 'ah-flow', out = [], by = f.byArm, rowOf = id => f.rows.find(r => r.id === id);
  const chain = ['assessed', 'included', 'followed', 'analysed'].map(rowOf);
  const armsW = by.length ? by.length * armW + (by.length - 1) * armGap : 0;
  const group = mainW + armGap + sideW, w = Math.max(armsW, group) + 2 * P, cx = (w - group) / 2 + mainW / 2;
  let y = P;
  const mains = chain.map((r, i) => { const b = box(cx, y, mainW, r.label, r.value); y += b.height + (i < chain.length - 1 ? gapY : 0); return b; });
  mains.forEach((b, i) => { out.push(draw(b)); if (i) { const p = mains[i - 1]; out.push(flowArrow(t, AH, cx, p.y + p.height, cx, b.y - t.line.box)); } });
  // not enrolled: leaves the step between "assessed" and "enrolled"
  const ex = box(0, 0, sideW, 'Not enrolled', rowOf('excluded').value), a0 = mains[0], midY = a0.y + a0.height + gapY / 2;
  ex.x = cx + mainW / 2 + armGap; ex.y = midY - ex.height / 2;
  out.push(draw(ex), flowArrow(t, AH, cx, midY, ex.x - t.line.box, midY));
  let bottom = y;
  if (by.length) {
    y += gapY * 0.8;
    out.push(hairLine(t, P, y, w - P, y));
    out.push(text(t, P, y + L * 1.6, 'Recorded by arm', { role: 'head', cls: 'c-ink c-head' }));
    y += L * 2.6;
    const row = by.map((r, i) => ({ r, cx: (w - armsW) / 2 + armW / 2 + i * (armW + armGap) }));
    const alloc = row.map(({ r, cx: x }) => box(x, y, armW, r.arm, r.allocated, [`Withdrawn: ${r.withdrawn ?? 'not recorded'}; lost: ${r.lost ?? 'not recorded'}`]));
    const h1 = Math.max(...alloc.map(b => b.height)); alloc.forEach(b => { b.height = h1; });
    const y2 = y + h1 + gapY, ana = row.map(({ r, cx: x }) => box(x, y2, armW, 'Recorded analysed', r.analysed));
    alloc.forEach((b, i) => out.push(draw(b), flowArrow(t, AH, row[i].cx, b.y + b.height, row[i].cx, y2 - t.line.box), draw(ana[i])));
    bottom = y2 + Math.max(...ana.map(b => b.height));
  }
  return svgRoot(t, w, bottom + P, out.join(''), { title, desc: `${by.length ? `${by.length} arm${by.length === 1 ? '' : 's'}` : 'no arms recorded'}; counts the project does not hold read Not recorded`, defs: flowMarker(t, AH) });
}

/** The house drawings app/lint-figures.mjs checks: a screening log with three arms (one named at length), and a flow with a missing count. */
export const __fixture = style => {
  const rows = [];
  const add = (n, o) => { for (let i = 0; i < n; i++) rows.push({ screening_id: `S${rows.length + 1}`, ...o }); };
  add(30, { eligible: 'No', reason_not_eligible: 'Outside age range' });
  add(12, { eligible: 'Yes', consented: 'No', reason_not_consented: 'Declined' });
  for (const [arm, n] of [['Immediate surgical stabilisation with instrumented fusion', 40], ['Conservative care', 38], ['Delayed surgery', 36]]) add(n, { eligible: 'Yes', consented: 'Yes', randomised: 'Yes', arm, analysed: 'Yes' });
  add(3, { eligible: 'Yes', consented: 'Yes', randomised: 'Yes', arm: 'Conservative care', lost_to_follow_up: 'Yes' });
  const log = { template: 'screening', name: 'Screening log', rows };
  return [{ name: 'participantFlow', svg: participantFlowSvg({ datasets: [log] }, { style }) },
    { name: 'participantFlowBare', svg: participantFlowSvg({ participantFlow: { assessed: { value: 40, reason: 'Ledger' }, included: { value: 31, reason: 'Ledger' } } }, { style }) }];
};
