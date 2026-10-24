// Version review in the manuscript inspector (lib/review-checks.mjs): the rule categories run at once on the version as it is; Run review
// sends the model categories, each paragraph or section once per version, one call at a time, on the review model (Settings › Models,
// the cheap profile by default). The last run's findings are listed by category, each a link to its paragraph; a version reviewed
// before shows what that run found and says the text changed since.
import { get, update } from '../store.mjs';
import { esc } from '../lib/html.mjs';
import { uiBar, uiList, uiRow } from '../lib/ui-actions.mjs';
import { uiLink } from '../lib/ui-components.mjs';
import { plural } from '../lib/dates.mjs';
import { modelFor } from '../lib/model-settings.mjs';
import { supplementChecks, CATEGORIES, requestsFor, parseFindings, runRules, versionOf, reviewedParagraphs, normaliseReviewRuns } from '../lib/review-checks.mjs';
import { classifyStructure } from '../lib/manuscript-structure.mjs';

let running = null;   // { done, total } while a run is sending
let supp = null;      // the supplement checked last: { file, findings } or { error }; kept until the project changes
const SEV_WORD = { error: 'Error', warn: 'Check', note: 'Note' };

/** The section's markup: the rule findings now, the last model run's findings, and Run review. */
export function versionReviewPanel(args = {}) {
  try { return panel(args); } catch (err) { console.warn('[version review]', err); return `<p class="meta">Version review could not be drawn: ${esc(String(err?.message || err).slice(0, 120))}</p>`; }
}
function panel({ blocks = [], library = [], profile = null, researchType = 'other', facts = '' } = {}) {
  const runs = normaliseReviewRuns(get().reviewRuns), last = runs[0] || null, version = versionOf(blocks), cfg = modelFor('review');
  const rules = CATEGORIES.filter(c => c.kind === 'rule').flatMap(c => runRules(c, { blocks, library, profile, researchType, facts }));
  const model = (last?.findings || []).filter(f => CATEGORIES.find(c => c.id === f.category)?.kind === 'model');
  const all = [...rules, ...model];
  const changed = last && last.version !== version;
  const line = running ? `Reviewing: ${running.done} of ${plural(running.total, 'request')}` : !last ? 'Not reviewed by a model yet'
    : `${changed ? 'An earlier version was' : 'This version was'} reviewed ${String(last.at).slice(0, 10)} (${plural(last.cost?.calls || 0, 'call')})`;
  const SUPP = { id: 'supplement', label: supp?.file ? `Supplement: ${supp.file.slice(supp.file.lastIndexOf('/') + 1)}` : 'Supplement' };
  if (supp?.findings) all.push(...supp.findings);
  else if (supp?.error) all.push({ id: 'supplement:error', category: 'supplement', severity: 'note', blockId: '', text: supp.error, suggestion: '' });
  const groups = [...CATEGORIES, SUPP].map(c => [c, all.filter(f => f.category === c.id)]).filter(([, f]) => f.length);
  const list = groups.length ? groups.map(([c, fs]) => uiList({ id: `vr-${c.id}`, label: c.label, head: uiBar({ kind: 'head', id: `vr-${c.id}-head`, label: c.label, lead: { title: c.label, level: 'h3' }, status: { id: `vr-${c.id}-n`, text: String(fs.length), ch: 3 } }),
    rows: fs.map(f => uiRow({ attrs: { 'data-vr-sev': f.severity }, main: { html: f.blockId ? uiLink({ label: `${SEV_WORD[f.severity]}: ${f.text}`, attrs: { 'data-goto': f.blockId } }) : esc(`${SEV_WORD[f.severity]}: ${f.text}`), detail: f.suggestion ? [esc(f.suggestion)] : [], wrap: true } })) })).join('')
    : `<p class="meta">Nothing found</p>`;
  return `<div class="ms-vreview">
    ${uiBar({ kind: 'foot', label: 'Version review', id: 'vr-bar', message: { id: 'vr-line', text: line },
      actions: [{ id: 'vr-supp', label: 'Check supplement', icon: 'file', disabled: !blocks.length }, { id: 'vr-run', label: changed || !last ? 'Run review' : 'Run again', icon: 'checklist', role: 'primary', disabled: !cfg?.model || !!running || !blocks.length }] })}
    ${list}</div>`;
}

/** Sends the model categories for this version, skipping what the last run already reviewed, and keeps the run. */
export async function runVersionReview({ blocks, library = [], journal = '', style = '', researchType = '', redraw = () => {} }) {
  const cfg = modelFor('review');
  if (!cfg?.model || running) return;
  const runs = normaliseReviewRuns(get().reviewRuns), last = runs[0] || null, version = versionOf(blocks);
  const previous = last?.version === version ? last : null;   // the same text: only units it did not cover; a new version: everything again
  const roles = classifyStructure(blocks);
  const reqs = CATEGORIES.filter(c => c.kind === 'model').flatMap(c => requestsFor(c, { blocks, roles, library, previous, journal, style, researchType }).map(r => ({ ...r, cat: c })));
  running = { done: 0, total: reqs.length }; redraw();
  const findings = previous ? [...previous.findings] : [], sent = [];
  try {
    for (const r of reqs) {
      let text = '';
      try { const { complete } = await import('../lib/ai.mjs'); text = await complete(cfg, r.messages, { temperature: 0, json: true, prompt: r.cat.prompt, maxTokens: r.cat.prompt.maxTokens }); } catch (err) { findings.push({ id: `${r.key}:error`, category: r.cat.id, severity: 'note', blockId: r.blockIds[0] || '', text: `Not reviewed: ${String(err?.message || err).slice(0, 160)}`, suggestion: '' }); continue; }
      findings.push(...parseFindings(r.cat, text, r.blockIds)); sent.push({ category: r.cat.id, blockIds: r.blockIds });
      running.done++; redraw();
    }
  } finally { running = null; }
  const run = { id: `vr${Date.now().toString(36)}`, at: new Date().toISOString(), version, categories: CATEGORIES.filter(c => c.kind === 'model').map(c => c.id),
    findings, paragraphs: reviewedParagraphs(blocks, sent, previous?.paragraphs || {}), cost: { calls: (previous?.cost?.calls || 0) + sent.length } };
  update(st => { st.reviewRuns = normaliseReviewRuns([run, ...(st.reviewRuns || []).filter(x => x.id !== previous?.id)]); return st; });
  redraw();
}

/** The newest supplement Word file of the project folder, read and checked against the manuscript (lib/review-checks.mjs supplementChecks). */
export async function checkSupplement({ blocks, library = [], redraw = () => {} }) {
  const { activeFolder } = await import('../lib/projects.mjs');
  const { scanFolder } = await import('../lib/project-folder.mjs');
  const { classifyFile } = await import('../lib/folder-map.mjs');
  const { parseDocx } = await import('../lib/docx.mjs');
  const folder = activeFolder();
  if (!folder) { supp = { error: 'The supplement is read from the project folder' }; redraw(); return; }
  const files = (await scanFolder(folder).catch(() => [])).filter(f => !f.dir && /\.docx$/i.test(f.path) && !/(^|\/)~\$/.test(f.path));
  const docs = files.filter(f => { const c = classifyFile(f.path); return c.role === 'supplement' && !c.archived; }).sort((a, b) => (b.mtime || 0) - (a.mtime || 0));
  if (!docs.length) { supp = { error: 'No supplement Word file in the project folder' }; redraw(); return; }
  try {
    const parsed = await parseDocx(await folder.read(docs[0].path));
    supp = { file: docs[0].path, findings: supplementChecks({ manuscript: blocks, supplement: parsed.blocks || [], library }) };
    if (!supp.findings.length) supp.findings = [{ id: 'supplement:ok', category: 'supplement', severity: 'note', blockId: '', text: 'Nothing found: every S-number is cited and present, every row matches a record', suggestion: '' }];
  } catch (err) { supp = { error: `${docs[0].path}: ${String(err?.message || err).slice(0, 120)}` }; }
  redraw();
}
