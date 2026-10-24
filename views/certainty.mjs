// Certainty: GRADE ratings per outcome, and the Summary of Findings table they
// produce (plan H5).
//
// The reviewer rates each domain. The certainty level follows from GRADE's own
// arithmetic, shown beside the ratings that produced it so it is never a number
// out of nowhere, and can be overridden with a stated reason.
import { copyText } from '../lib/clipboard.mjs';
import { REGISTRY } from './registry.mjs';
import { summaryOfFindings, toMarkdown as sofMarkdown, toBlocks as sofBlocks, gradeTable, gradeTableMarkdown, gradeTableBlocks } from '../lib/sof.mjs';
import { writeDocx } from '../lib/docx-write.mjs';
import { saveFile } from '../lib/save.mjs';
import { get, update } from '../store.mjs';
import { explanationText, downgrades, DESIGNS, DOWNGRADE, DOWNGRADE_RATINGS, UPGRADE, UPGRADE_RATINGS, certainty, reasons, blankOutcome, LEVELS } from '../lib/grade.mjs';
import { downloadCsv, wireDownload } from '../lib/figure.mjs';
import { ask } from '../lib/dialog.mjs';
import { importGrade } from '../lib/grade-import.mjs';
import { showShellNotice } from '../lib/shell-notice.mjs';
import { esc, emptyState } from '../lib/html.mjs';
import { icon } from '../lib/icons.mjs';
import { uiBar, inspectorActions } from '../lib/ui-actions.mjs';
import { formField } from '../lib/ui-components.mjs';
import { unchecked, checkedStamp } from '../lib/progress.mjs';
import { linkedOutcome, pooledSummary, absoluteLabels, parseRisk, parseEffect, absoluteEffect, ABSOLUTE_MEASURES, publicationBiasFacts, toRate, rateAnalysed } from '../lib/grade-link.mjs';
import { analysisOf, outcomes as outcomes2 } from '../lib/outcomes.mjs';
import { measureOf } from '../lib/effect-measures.mjs';
import { suggestionsFor } from '../lib/evidence-profile.mjs';
import { PROFILE, SWIM, isExtra, extraFocus, renderProfile, profileInspect, profilePage, renderSwim, swimInspect, swimPageSpec, extraItems } from './certainty-extra.mjs';
import { IMPORTANCE } from '../lib/grade-profile.mjs';
import { ensureLinked, nameAt, linkPlace, outcomeNamed, setUpOutcome, usesOf, outcomeLinkIssues } from '../lib/outcome-links.mjs';
import { appraisalFacts } from '../lib/grade-appraisal.mjs';
import { studies } from '../lib/screen.mjs';
import { undoPoint, offerUndo } from '../lib/undo-removal.mjs';

export const meta = { title: 'Certainty', icon: 'certainty' };

const outcomes = () => get().grade || [];
export const count = (...a) => REGISTRY.certainty.count(...a);
export function assistContext() {
  const s = get(); const os = outcomes();
  return `Certainty: outcomes ${os.map(o => typeof o === 'string' ? o : o.name || o.label || o.id).join(', ') || 'none'}; ratings recorded: ${Object.keys(s.certainty || {}).length}`;
}

// ---- list · detail · inspector ----------------------------------------------
// The items are the outcomes. The detail is the selected outcome's GRADE
// assessment and its Summary-of-findings entry; the table across all outcomes
// is what the exports in the inspector produce.
let pick = null;
const current = () => outcomes().find(x => x.id === pick) || null;

/** The outcome the person is rating: its design, certainty and downgrades. */
export function focus() {
  if (isExtra(pick)) return extraFocus(pick);
  const o = current();
  if (!o) return null;
  const c = certainty(o);
  return { kind: 'outcome', label: o.name || 'Unnamed outcome', outcomeId: o.id,
    detail: [DESIGNS.find(d => d.id === o.design)?.label, `certainty ${c.final}`,
      reasons(o).length ? `downgraded for ${reasons(o).join(', ')}` : 'no downgrades'].filter(Boolean).join('; ') };
}

const TONE = { 'High': 'good', 'Moderate': 'ok', 'Low': 'warn', 'Very low': 'bad' };

export const list = {
  title: 'Outcomes', count: false,   // the outcomes are the first rows; the two reports are a group of their own, so no one count covers both
  get empty() { return 'No outcomes'; },
  acts: refresh => [{ id: 'plist-add-outcome', label: 'Add outcome', icon: 'plus', role: 'quiet', plain: true, run: () => addOutcome(refresh) }],
  // the outcomes, then a Reports group: the evidence profile across them and synthesis without meta-analysis
  items(s) {
    return [...gradeItems(s), { id: 'g-reports', group: true, title: 'Reports' }, ...extraItems(s)];
  },
};
function gradeItems(s) {
  return (s.grade || []).map(o => {
    const c = certainty(o), why = c.overridden ? o.overrideReason : reasons(o).join(', ');
    return { id: o.id, title: o.name || 'Unnamed outcome',
      sub: why || DESIGNS.find(d => d.id === o.design)?.label || '',
      meta: participants(o) === '—' ? '' : participants(o), mark: c.final };
  });
}
export function select(id) { pick = id; }
export function selected() { return pick; }

/** The inspector's Details: the Summary of findings across outcomes, and its exports. */
export function inspect(ctx) {
  if (pick === PROFILE) return profileInspect(ctx);
  if (pick === SWIM) return swimInspect(ctx);
  const all = outcomes(), o = current();
  const secs = [];
  // names that could be two outcomes, and two rows rating one: listed for the person, never merged (lib/outcome-links.mjs)
  const issues = outcomeLinkIssues(get());
  if (issues.length) secs.push({ title: 'Outcome links', meta: `${issues.length}`, html: issues.map(x => `<p class="meta">${esc(x.text)}</p>`).join('') });
  if (o) {
    const c = certainty(o);
    const start = DESIGNS.find(d => d.id === o.design);
    secs.push({ title: 'Certainty', html: `<dl class="props">
        <dt>Starts at</dt><dd>${esc(start?.start || '—')}</dd>
        <dt>Rated down</dt><dd>${esc(reasons(o).join(', ') || 'No')}</dd>
        <dt>Result</dt><dd>${c.rated ? `<span class="cert t-${TONE[c.final]}">${esc(c.final)}</span>` : `<span class="meta">${esc(c.final)}</span>`}</dd>
        ${c.overridden ? `<dt>Override</dt><dd>${esc(o.overrideReason || '')}</dd>` : ''}</dl>` });
  }
  secs.push({ title: 'Summary of findings', meta: `${all.length} outcome${all.length === 1 ? '' : 's'}`,
    html: `<dl class="props">${all.map(x => `<dt>${esc(x.name || '—')}</dt><dd>${esc([x.effect, certainty(x).final].filter(Boolean).join('; '))}</dd>`).join('')}</dl>
      ${inspectorActions({ id: 'sof-acts', label: 'Summary actions', actions: [
        { id: 'sof-copy', label: 'Copy', icon: 'copy', menu: true, attrs: { 'data-sof': 'md' } },
        { id: 'sof-download', label: 'Download', icon: 'download', menu: true, disabled: !all.length, attrs: { 'data-sof': 'download' } }],
        overflow: [{ id: 'sof-insert', label: 'Insert in manuscript', disabled: !all.length }] })}`,
    wire: el => {
      // two layouts of the same rows: the handbook's summary of findings, and the GRADE table as a journal prints it (bold judgement, explanation under it)
      wireDownload(el.querySelector('[data-sof="md"]'), [{ label: 'Summary of findings', icon: 'copy', run: () => sofCopy(ctx) }, { label: 'GRADE table', icon: 'copy', run: () => gradeCopy(ctx) }]);
      // linked: the manuscript redraws the table when the ratings change (views/paper-place.mjs)
      el.querySelector('#sof-insert')?.addEventListener('click', async () => {
        try { ctx?.rerender?.(`Inserted at the end of the manuscript as ${await (await import('./paper-place.mjs')).insertInManuscript('sof')}`); }
        catch (err) { ctx?.rerender?.(err.message); }
      });
      wireDownload(el.querySelector('[data-sof="download"]'), [{ label: 'CSV', icon: 'table', run: sofCsv }, { label: 'Word', icon: 'file', run: sofDocx }, { label: 'Word, GRADE table', icon: 'file', run: gradeDocx }]);
    } });
  return secs;
}

async function sofCopy(ctx) {
  if (!await copyText(sofMarkdown(summaryOfFindings(get())))) ctx?.say?.('Could not copy');
}
async function sofDocx() {
  const blob = await writeDocx({ blocks: sofBlocks(summaryOfFindings(get())), section: null, styles: null, renderCite: () => '', renderResult: () => null, references: [] });
  await saveFile(blob, 'summary-of-findings.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
}
async function gradeCopy(ctx) {
  if (!await copyText(gradeTableMarkdown(gradeTable(get())))) ctx?.say?.('Could not copy');
}
async function gradeDocx() {
  const blob = await writeDocx({ blocks: gradeTableBlocks(gradeTable(get())), section: { orient: 'landscape', pageW: 842, pageH: 595, top: 54, right: 54, bottom: 54, left: 54 }, styles: null, renderCite: () => '', renderResult: () => null, references: [] });
  await saveFile(blob, 'grade-table.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
}
function sofCsv() {
  const rows = [['Outcome', 'Participants (studies)', 'Relative effect',
                 'Risk with comparator', 'Risk with intervention', 'Certainty', 'Reasons', 'Comment']];
  for (const o of outcomes()) {
    const c = certainty(o);
    rows.push([o.name, participants(o), o.effect, o.comparatorRisk || '', o.absolute, c.final,
      c.overridden ? o.overrideReason : reasons(o).join('; '), o.comment]);
  }
  downloadCsv(rows, 'summary-of-findings.csv');
}

/**
 * The page's head is the title bar (lib/topbar.mjs): the outcome being rated is its title, the certainty it comes to is beside it, and
 * Remove outcome is in More; the evidence profile and synthesis without meta-analysis declare their own.
 */
/** The file chooser for a GRADE file; `then` gets the file, nothing happens when the window is dismissed. */
function pickJson(then) {
  const i = document.createElement('input');
  i.type = 'file'; i.accept = '.json'; i.hidden = true;
  document.body.append(i);
  i.onchange = () => { const f = i.files?.[0]; i.remove(); if (f) then(f); };
  i.oncancel = () => i.remove();
  i.click();
}

export function page(rerender) {
  if (pick === PROFILE) return profilePage(rerender);
  if (pick === SWIM) return swimPageSpec();
  const o = current();
  // GRADE kept in a file beside the app (a review's grade.json; lib/grade-import.mjs): read into rows, a row of the same name replaced.
  const importItem = { id: 'cert-import', label: 'Import from a file…', run: () => pickJson(async file => {
    let doc; try { doc = JSON.parse(await file.text()); } catch { showShellNotice({ id: 'cert-import', text: `${file.name} is not a JSON file` }); return; }
    let r = { added: 0, replaced: 0 };
    update(st => { r = importGrade(st, doc); return st; });
    showShellNotice({ id: 'cert-import', text: r.added + r.replaced ? `${file.name}: ${r.added} outcome${r.added === 1 ? '' : 's'} added, ${r.replaced} replaced` : `${file.name} holds no outcome the page can read` });
    rerender();
  }) };
  if (!o) return { title: 'Certainty', actions: [], overflow: [importItem] };
  const c = certainty(o);
  return { title: o.name || 'Unnamed outcome', actions: [],
    overflow: [importItem, { id: 'cert-del', label: 'Remove outcome', danger: true, run: async () => {
      const point = undoPoint(), all = outcomes(), i = all.findIndex(x => x.id === o.id);
      pick = (all[i + 1] || all[i - 1] || null)?.id || null;
      update(st => { st.grade = (st.grade || []).filter(x => x.id !== o.id); return st; });
      rerender();
      offerUndo(point, `Removed ${o.name || 'the outcome'}`, () => { pick = o.id; rerender(); });
    } }] };
}

export function render(el, ctx) {
  ensureLinked(get, update);   // GRADE rows and SWiM domains named before outcomes had one id take the id of their outcome
  if (pick === PROFILE) return renderProfile(el, ctx);
  if (pick === SWIM) return renderSwim(el, ctx);
  const o = current();

  if (!o) {
    // the outcomes the analyses pooled can be rated from here, not only from the evidence profile (lib/grade-link.mjs rateAnalysed)
    const n = outcomes().length ? 0 : toRate(get()).length;
    el.innerHTML = emptyState({ icon: 'certainty', title: outcomes().length ? 'No outcome selected' : 'No outcomes',
      actions: [{ id: 'add', label: 'Add outcome', icon: 'plus', primary: !n },
        ...(n ? [{ id: 'rate', label: `Rate the ${n} analysed ${n === 1 ? 'outcome' : 'outcomes'}`, primary: true }] : [])] });
    el.querySelector('#add').onclick = () => addOutcome(() => ctx.rerender());
    el.querySelector('#rate')?.addEventListener('click', () => { update(st => { rateAnalysed(st); return st; }); pick = get().grade?.[0]?.id || null; ctx.rerender(); ctx.refreshCounts?.(); });
    return;
  }

  const c = certainty(o);
  const textField = (label, attrs, value, extra = '', aria = label) => formField(label, `<input ${attrs} value="${esc(value)}" aria-label="${esc(aria)}"${extra}>`);
  const selectField = (label, attrs, options, after = '', extra = '') => formField(label, `<select ${attrs} aria-label="${esc(label)}"${extra}>${options}</select>${after}`);
  const choices = (list, current) => list.map(([v, l]) => `<option value="${esc(v)}"${String(current ?? '') === String(v) ? ' selected' : ''}>${esc(l)}</option>`).join('');
  const rate = (d, table, disabled) => selectField(d.label, `data-rate="${esc(d.id)}" data-o="${esc(o.id)}"`, choices(table.map(r => [r.value, r.label]), o.ratings?.[d.id]), d.id === 'rob' ? robHint() : hint(d.id), disabled ? ' disabled' : '');
  const input = (k, label, extra = '') => textField(label, `data-o="${esc(o.id)}" data-k="${k}"`, o[k] || '', extra);
  const doms = c.overridden ? [] : downgrades(o);
  const s = get(), link = linkedOutcome(s, o), pooled = pooledSummary(s, link);
  const [compLabel, absLabel] = absoluteLabels(pooled?.family || (link ? measureOf(link.measure).family : 'binary'));
  const stale = pooled && o.filledFrom && o.filledFrom !== pooled.identity;
  const linkChoice = o.analysisOutcome === 'none' ? 'none' : link?.id || 'none';
  const absolute = absoluteOf(s, o);
  const needsReason = c.overridden && !String(o.overrideReason || '').trim();
  const pbFacts = link ? publicationBiasFacts(analysisOf(s, link.id)) : [];
  // what the linked pooled result says, beside the domain it bears on: text, never a rating
  const hints = suggestionsFor(s, o);
  // what the appraisals of the outcome's studies say, beside risk of bias: counts per instrument, never a rating (lib/grade-appraisal.mjs)
  function robHint() {
    const facts = link ? appraisalFacts(s, link.id, studies(s)) : [];
    return facts.length > 1 ? `<span class="cert-hint meta" data-hint="rob-appraisal">${facts.map(([l, t]) => `${esc(l)}: ${esc(t)}`).join('<br>')}</span>` : '';
  }
  function hint(id) {
    const h = hints?.[id];
    if (!h) return '';
    const facts = id === 'publication' ? [] : h.facts;
    return `<span class="cert-hint meta" data-hint="${esc(id)}">${facts.map(([l, t]) => `${esc(l)} ${esc(t)}`).join('; ')}${facts.length ? '<br>' : ''}${esc(h.suggestion)}</span>`;
  }

  const footnote = d => {
    const x = o.explanations?.[d.id], draft = unchecked(x);
    return textField(d.label, `data-o="${esc(o.id)}" data-x="${esc(d.id)}"${draft ? ' class="provisional" title="Drafted by a model, not checked"' : ''}`, explanationText(x), ` placeholder="Downgraded for ${esc(d.reason)}."`, `${d.label} footnote`)
      + (draft ? uiBar({ kind: 'foot', label: `Check ${d.label}`, id: `cert-check-bar-${d.id}`, actions: [{ id: `cert-check-${d.id}`, label: 'Checked', icon: 'check', attrs: { 'data-check-o': o.id, 'data-check-x': d.id } }] }) : '');
  };
  el.innerHTML = `<div class="panel">
    <div class="panel-body">
      <div class="an-settings">${input('name', 'Outcome')}</div>
      <div class="an-settings">
        ${selectField('Design', `data-o="${esc(o.id)}" data-k="design"`, choices(DESIGNS.map(d => [d.id, d.label]), o.design))}
        ${DOWNGRADE.map(d => rate(d, DOWNGRADE_RATINGS, false)).join('')}
        ${UPGRADE.map(d => rate(d, UPGRADE_RATINGS, !c.canUpgrade)).join('')}
        ${selectField('Certainty', `data-o="${esc(o.id)}" data-k="override"`, choices([['', c.rated ? `From ratings: ${c.level}` : `From ratings: ${c.final}`], ...[...LEVELS].reverse().map(l => [l, l])], c.overridden ? o.override : ''))}</div>
      ${c.overridden ? `<div class="an-settings">${input('overrideReason', 'Reason', needsReason ? ' aria-invalid="true" placeholder="Reason needed"' : '')}</div>` : ''}
      ${pbFacts.length ? `<dl class="props"><dt>Publication bias, from the analysis</dt><dd></dd>${pbFacts.map(([l, t]) => `<dt>${esc(l)}</dt><dd>${esc(t)}</dd>`).join('')}</dl>` : ''}
    </div></div>

    <div class="panel">
      ${uiBar({ kind: 'head', label: 'Summary of findings', id: 'cert-sof-head', lead: { title: 'Summary of findings' },
        ...(stale ? { status: { id: 'cert-sof-state', text: 'Pooled result changed', ch: 24 } } : o.filledFrom && pooled ? { status: { id: 'cert-sof-state', text: 'From pooled analysis', ch: 24 } } : {}),
        actions: [...(pooled ? [{ id: 'cert-fill', label: stale ? 'Fill again' : 'Fill from analysis', icon: 'analysis', attrs: { 'data-fill': o.id } }] : []),
          { id: 'cert-abs', label: 'Absolute effect', icon: 'table', disabled: !absolute, attrs: { 'data-abs': o.id } }] })}
      <div class="panel-body">
        <div class="an-settings">${selectField('Pooled analysis', `data-link="${esc(o.id)}"`, choices([['none', 'Not linked'], ...outcomes2(s).map(x => [x.id, `${x.name} (${x.measure}${analysisOf(s, x.id) ? '' : ', not run'})`])], linkChoice))}</div>
        <div class="an-settings">
          ${input('participants', 'Participants')}
          ${input('studies', 'Studies')}
          ${textField('Patients, intervention', `data-o="${esc(o.id)}" data-ev="intervention"`, o.events?.intervention || '', ' placeholder="45/120"')}
          ${textField('Patients, comparator', `data-o="${esc(o.id)}" data-ev="comparator"`, o.events?.comparator || '', ' placeholder="60/118"')}
          ${input('effect', 'Relative effect')}
          ${input('comparatorRisk', compLabel)}
          ${input('absolute', absLabel)}
          ${selectField('Importance', `data-o="${esc(o.id)}" data-k="importance"`, choices([['', 'Not stated'], ...IMPORTANCE.map(x => [x, x])], o.importance || ''))}</div>
        <div class="cert-notes">
          ${doms.map(d => footnote(d)).join('')}
          ${input('comment', 'Comment')}</div>
      </div></div>`;

  el.querySelectorAll('[data-o]').forEach(inp => {
    if (inp.dataset.rate) return;
    const write = () => {
      const { o: id, k, x: domain, ev } = inp.dataset;
      update(st => {
        st.grade = (st.grade || []).map(g => g.id !== id ? g
          : ev ? { ...g, events: { ...(g.events || {}), [ev]: inp.value } }
          : domain ? { ...g, explanations: { ...(g.explanations || {}), [domain]: inp.value } }
          : { ...g, [k]: inp.value });
        return st;
      });
    };
    if (inp.tagName === 'SELECT') inp.onchange = () => { write(); ctx.rerender(); };
    else inp.oninput = () => {
      write();
      // typing the comparator risk or the effect decides whether the absolute effect can be calculated
      const b = el.querySelector('[data-abs]'), now = get().grade?.find(g => g.id === o.id);
      if (b && now) b.disabled = !absoluteOf(get(), now);
    };
  });

  // The row's name is its outcome's: a new name renames the outcome everywhere, or links the row to the outcome of that name.
  el.querySelector('[data-k="name"]').onchange = e => { update(st => { nameAt(st, 'grade', o.id, e.target.value); return st; }); ctx.rerender(); ctx.refreshCounts?.(); };

  // Checking a drafted footnote keeps its text and marks it read by a person.
  el.querySelectorAll('[data-check-x]').forEach(b => b.onclick = () => {
    const { checkO: id, checkX: domain } = b.dataset;
    update(st => {
      st.grade = (st.grade || []).map(g => g.id !== id || !unchecked(g.explanations?.[domain]) ? g
        : { ...g, explanations: { ...g.explanations, [domain]: { ...g.explanations[domain], ...checkedStamp() } } });
      return st;
    });
    ctx.rerender(); ctx.refreshCounts();
  });

  el.querySelectorAll('[data-rate]').forEach(sel => sel.onchange = () => {
    const { rate: r, o: id } = sel.dataset;
    update(st => {
      st.grade = (st.grade || []).map(x => x.id === id
        ? { ...x, ratings: { ...x.ratings, [r]: sel.value } } : x);
      return st;
    });
    ctx.rerender();
  });

  el.querySelector('[data-link]').onchange = e => {
    // the row reports that outcome and takes its name; Not linked keeps the name it has
    update(st => linkPlace(st, 'grade', o.id, e.target.value));
    ctx.rerender(); ctx.refreshCounts?.();
  };
  el.querySelector('[data-fill]')?.addEventListener('click', () => { fillFromAnalysis(o.id); ctx.rerender(); ctx.refreshCounts(); });
  el.querySelector('[data-abs]').onclick = () => {
    const now = get().grade?.find(g => g.id === o.id), x = now && absoluteOf(get(), now);
    if (!x) return;
    update(st => { st.grade = (st.grade || []).map(g => g.id !== o.id ? g
      : { ...g, comparatorRisk: x.comparator, absolute: `${x.intervention}; ${x.difference}` }); return st; });
    ctx.rerender();
  };
}

/**
 * The absolute effect of a row: from the reviewer's assumed comparator risk and
 * the linked pooled relative effect, or the relative effect typed in the row
 * when no ratio or risk difference is linked. Null when either is missing.
 */
function absoluteOf(s, o) {
  const pooled = pooledSummary(s, linkedOutcome(s, o));
  const relative = pooled && ABSOLUTE_MEASURES.includes(pooled.measure) ? pooled : parseEffect(o.effect);
  return relative ? absoluteEffect(relative, parseRisk(o.comparatorRisk)) : null;
}

// The outcome of that name, or a new one: a new outcome is set up in Analysis and SWiM too (lib/outcome-links.mjs); an outcome that has a
// row already opens that row. A name two outcomes share gives a row of its own, listed under Outcome links.
async function addOutcome(done) {
  const name = await ask('New outcome', { placeholder: 'Name', confirm: 'Add' });
  if (!name?.trim()) return;
  let id = '';
  update(st => {
    const r = outcomeNamed(st, name.trim());
    if (r.id) { setUpOutcome(st, r.id, { swim: false }); id = usesOf(st, r.id).grade[0]?.id || ''; }
    else { const row = blankOutcome(name.trim()); st.grade = [...(st.grade || []), row]; id = row.id; }
    return st;
  });
  // A row of a pooled outcome starts from its result.
  const row = get().grade?.find(g => g.id === id);
  if (row && !row.filledFrom && pooledSummary(get(), linkedOutcome(get(), row))) fillFromAnalysis(id);
  pick = id;
  done();
}

/** Copies the linked result's studies, participants and relative effect into a row, noting which result. */
function fillFromAnalysis(id) {
  update(st => {
    st.grade = (st.grade || []).map(g => {
      if (g.id !== id) return g;
      const p = pooledSummary(st, linkedOutcome(st, g));
      return p ? { ...g, studies: p.studies, participants: p.participants || g.participants, effect: p.effect, filledFrom: p.identity } : g;
    });
    return st;
  });
}

const participants = o =>
  o.participants || o.studies
    ? `${o.participants || '—'} (${o.studies || '—'})`
    : '—';
