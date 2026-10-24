// Confidence for a qualitative evidence synthesis: GRADE-CERQual per review
// finding, and the Summary of Qualitative Findings (lib/cerqual.mjs). It takes
// the place of Certainty in that review's navigation.
//
// The findings are the analytical themes built in Synthesis. The reviewer
// judges four components and chooses the overall confidence; nothing is
// computed from the components. The overall level is not judged until every
// component is, and one rated below High needs an explanation. The
// contributing studies follow from the theme's codes.
import { copyText } from '../lib/clipboard.mjs';
import { REGISTRY } from './registry.mjs';
import { get, update } from '../store.mjs';
import { readQes, sourcesOf, labelOf, setStatement } from '../lib/qes.mjs';
import { COMPONENTS, CONCERNS, CONFIDENCE, START, assessmentOf, gaps, setComponent, setConfidence,
  summaryOfQualitativeFindings, soqfCsvRows, soqfMarkdown, soqfBlocks } from '../lib/cerqual.mjs';
import { writeDocx } from '../lib/docx-write.mjs';
import { saveFile } from '../lib/save.mjs';
import { downloadCsv, wireDownload } from '../lib/figure.mjs';
import { esc, emptyState } from '../lib/html.mjs';
import { rerenderForm } from '../lib/form-rerender.mjs';
import { uiBar, inspectorActions } from '../lib/ui-actions.mjs';
import { formField, metadataLine } from '../lib/ui-components.mjs';
import { plural } from '../lib/dates.mjs';

export const meta = { title: 'Confidence', icon: 'confidence' };

const findings = () => readQes(get()).analytical;
export const count = (...a) => REGISTRY.confidence.count(...a);
export function assistContext() {
  return `CERQual: ${findings().map(t => { const a = assessmentOf(t); return `${t.label} ${a.assessed ? a.confidence : 'not judged'}`; }).join('; ') || 'no findings'}`;
}

let pick = null;
const current = () => findings().find(t => t.id === pick) || null;

export function focus() {
  const t = current(); if (!t) return null;
  const a = assessmentOf(t);
  return { kind: 'finding', label: t.label, detail: [a.assessed ? `${a.confidence} confidence` : 'not judged',
    ...COMPONENTS.filter(x => a.components[x.id].concern).map(x => `${x.label} ${a.components[x.id].concern.toLowerCase()}`)].join('; ') };
}

export const list = {
  title: 'Findings',
  get empty() { return 'No analytical themes'; },
  items(s) {
    return readQes(s).analytical.map(t => {
      const a = assessmentOf(t), open = gaps(t);
      return { id: t.id, title: t.label, sub: open.includes('Explanation needed') ? 'Explanation needed' : (t.statement || '').slice(0, 120),
        meta: plural(sourcesOf(s, 'analytical', t.id).length, 'source'), mark: a.assessed ? a.confidence : '' };
    });
  },
};
export function select(id) { pick = id; }
export function selected() { return pick; }

export function inspect() {
  const t = summaryOfQualitativeFindings(get());
  return [{ title: 'Summary of qualitative findings', meta: `${t.rows.length} finding${t.rows.length === 1 ? '' : 's'}`,
    html: `<dl class="props">${t.rows.map(r => `<dt>${esc(r.theme)}</dt><dd>${esc(r.confidence)}</dd>`).join('')}</dl>
      ${inspectorActions({ id: 'soqf-acts', label: 'Summary actions', actions: [
        { id: 'soqf-copy', label: 'Copy', icon: 'copy', attrs: { 'data-soqf': 'md' } },
        { id: 'soqf-download', label: 'Download', icon: 'download', menu: true, disabled: !t.rows.length, attrs: { 'data-soqf': 'download' } }] })}`,
    wire: (el, ctx) => {
      el.querySelector('[data-soqf="md"]').onclick = async () => {
        if (!await copyText(soqfMarkdown(summaryOfQualitativeFindings(get())))) ctx?.say?.('Could not copy');
      };
      wireDownload(el.querySelector('[data-soqf="download"]'), [
        { label: 'CSV', icon: 'table', run: () => downloadCsv(soqfCsvRows(summaryOfQualitativeFindings(get())), 'summary-of-qualitative-findings.csv') },
        { label: 'Word', icon: 'file', run: async () => {
          const blob = await writeDocx({ blocks: soqfBlocks(summaryOfQualitativeFindings(get())), section: null, styles: null, renderCite: () => '', renderResult: () => null, references: [] });
          await saveFile(blob, 'summary-of-qualitative-findings.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
        } }]);
    } }];
}

const FROM_SYNTHESIS = 'Findings are the analytical themes built in Synthesis.';

/** The page's head is the title bar (lib/topbar.mjs): the finding being judged is its title, with the sources it rests on beside it. */
export function page() {
  const t = current();
  if (!t) return { title: 'Confidence', actions: [] };
  return { title: t.label || 'Unnamed finding', actions: [] };
}

export function render(el, ctx) {
  const t = current();
  if (!t) {
    el.innerHTML = emptyState({ icon: 'certainty', title: findings().length ? 'No finding selected' : 'No analytical themes', detail: FROM_SYNTHESIS,
      actions: [{ id: 'cq-go', label: 'Open synthesis', icon: 'layers', primary: true }] });
    el.querySelector('#cq-go').addEventListener('click', () => ctx.go('synthesis'));
    return;
  }
  const s = get(), a = assessmentOf(t), src = sourcesOf(s, 'analytical', t.id);
  const needs = Boolean(a.confidence) && a.confidence !== START && !a.explanation.trim();
  const opt = (list, cur, blank) => [['', blank], ...list.map(v => [v, v])].map(([v, l]) =>
    `<option value="${esc(v)}"${v === cur ? ' selected' : ''}>${esc(l)}</option>`).join('');

  const pair = (first, second, cls = '') => `<div class="cq-item an-settings${cls}">${first}${second}</div>`;
  const items = COMPONENTS.map(x => pair(
    formField(x.label, `<select data-concern="${x.id}" data-form-key="cq-concern-${x.id}" aria-label="${esc(x.label)} concerns">${opt(CONCERNS, a.components[x.id].concern, 'Not judged')}</select>`),
    formField('Explanation', `<input data-why="${x.id}" data-form-key="cq-why-${x.id}" value="${esc(a.components[x.id].explanation)}" aria-label="${esc(x.label)} explanation">`))).join('')
    + pair(
      formField('Overall confidence', `<select id="cq-confidence" aria-label="Overall confidence"${a.complete ? '' : ' disabled title="Judge all four components first"'}>${opt(CONFIDENCE, a.confidence, 'Not judged')}</select>`),
      formField('Explanation', `<input id="cq-explanation" value="${esc(a.explanation)}" aria-label="Explanation of the assessment"${a.confidence ? '' : ' disabled'}${needs ? ' aria-invalid="true" placeholder="Explanation needed"' : ''}>`), ' cq-overall');

  el.innerHTML = `<div class="panel">
    <div class="panel-body">
      ${formField('Finding', `<textarea id="cq-statement" rows="3" aria-label="Finding">${esc(t.statement || '')}</textarea>`)}
      ${metadataLine(['Studies contributing', src.length ? src.map(id => labelOf(s, id)).join('; ') : 'No quotes'])}
    </div></div>
    <div class="panel">${uiBar({ kind: 'head', label: 'GRADE-CERQual', id: 'cq-grade-head', lead: { title: 'GRADE-CERQual', level: 'h2' }, status: { id: 'cq-judged', text: `${a.judged} of ${COMPONENTS.length} judged`, ch: 14 } })}
    <div class="panel-body cq-form">${items}</div></div>`;

  el.querySelector('#cq-statement').oninput = e => update(st => { setStatement(st, t.id, e.target.value); return st; });
  el.querySelectorAll('[data-concern]').forEach(sel => sel.onchange = () => {
    update(st => { setComponent(st, t.id, sel.dataset.concern, { concern: sel.value }); return st; });
    rerenderForm(el, ctx); ctx.refreshCounts();
  });
  el.querySelectorAll('[data-why]').forEach(inp => inp.oninput = () =>
    update(st => { setComponent(st, t.id, inp.dataset.why, { explanation: inp.value }); return st; }));
  el.querySelector('#cq-confidence').onchange = e => {
    update(st => { setConfidence(st, t.id, { confidence: e.target.value }); return st; });
    rerenderForm(el, ctx); ctx.refreshCounts();
  };
  const why = el.querySelector('#cq-explanation');
  why.oninput = () => {
    update(st => { setConfidence(st, t.id, { explanation: why.value }); return st; });
    const c = assessmentOf(current()).confidence, missing = Boolean(c) && c !== START && !why.value.trim();
    why.toggleAttribute('aria-invalid', missing);
    why.placeholder = missing ? 'Explanation needed' : '';
  };
}
