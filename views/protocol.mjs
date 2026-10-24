// Protocol: the review's question and eligibility rules.
// The target question and a study's reported characteristics are different
// objects; extracting a paper must never rewrite these (plan A2). Each
// criterion has a stable id so decisions stay attributable (A3).
import { REGISTRY } from './registry.mjs';
import { askText } from '../lib/dialog.mjs';
import { writeDocx } from '../lib/docx-write.mjs';
import { saveFile } from '../lib/save.mjs';
import { suggestProtocol } from '../lib/helpers.mjs';
import { structureCriteria, mergeRules, criteriaSection } from '../lib/criteria.mjs';
import { modelFor } from '../lib/model-settings.mjs';
import { configured } from '../lib/ai.mjs';
import { proposalBox, esc, autoGrow, emptyState } from '../lib/html.mjs';
import { get, update } from '../store.mjs';
import { icon } from '../lib/icons.mjs';
import { showMenu } from '../lib/menu.mjs';
import { uiBar, uiList, uiRow, uiRowEnd } from '../lib/ui-actions.mjs';
import { editorRows, wireEditorRows, formField } from '../lib/ui-components.mjs';
import { plural, day } from '../lib/dates.mjs';
import { normalizeOrcid, lookupOrcid, fillOrcidDetails } from '../lib/orcid.mjs';
import { journalButton, wireJournalButton } from '../lib/journal-picker.mjs';
import { targetJournal, projectName, researchType, otherJournals, visibleViews } from '../lib/workflow.mjs';
import { outcomes, PRIMARY } from '../lib/outcomes.mjs';
import { usesOf, setUpOutcome } from '../lib/outcome-links.mjs';
import { changeTarget } from '../lib/journal-context.mjs';
import { spiritOffered } from '../lib/protocol-governance.mjs';
import { questionFrameOf } from '../lib/research-types.mjs';
import { PARTS as GOVERNANCE_PARTS, renderPart as renderGovernancePart, sectionHead } from './protocol-parts.mjs';

// The page is its own scroller (a long form such as the registration never makes the whole view tall), laid out as a sheet inside it.
export const meta = { layout: 'flush', title: 'Protocol', icon: 'protocol' };
let openCriterion = null;   // the criterion whose editor is open in the table
let openAuthors = new Set();  // authors being edited (a new author has no name yet and is always open)
let drawnGrows = [];          // the auto-growing text boxes of the page now drawn
export const count = (...a) => REGISTRY.protocol.count(...a);
export function assistContext() {
  const p = get().protocol || {}; const c = p.criteria || [], q = p.pico || {};
  return [`Protocol (${researchType(get()).label}): question "${p.title || ''}"; ${questionFields(get()).map(f => `${f.label} ${q[f.id] || (f.id === 'design' ? q.designs : '') || '—'}`).join('; ')}`,
    c.length ? `Criteria: ${c.map(x => `${x.id} [${x.kind || 'include'}, ${x.stage || 'Title/abstract'}] ${x.text}${x.question ? ` — tested by "${x.question}"` : ''}`).join(' | ')}` : 'Criteria: none',
    `Versions frozen: ${(get().protocolVersions || []).length}`].join('\n');
}

// The paper this review will become, and who is writing it. Recorded once and
// editable throughout, because the title and the author list change more often
// than anything else in a review.
const PAPER = [
  { id: 'title',    label: 'Working title', wide: true },
  { id: 'journal',  label: 'Target journal' },
  { id: 'registration', label: 'Registration', placeholder: 'PROSPERO CRD…' },
];

// The question's frame follows the research type (lib/research-types.mjs); the
// stored keys stay the same, so a project that changes type keeps what was written.
const questionFields = s => questionFrameOf(researchType(s).id);

// The field or criterion being edited, for model actions and the assistant.
let focused = null;
/** What the person is working on in the protocol: a PICO field or a criterion. */
export function focus() {
  if (!focused) return null;
  const p = get().protocol || {};
  if (focused.c) {
    const c = (p.criteria || []).find(x => x.id === focused.c);
    return c ? { kind: 'criterion', label: c.id, text: c.text, detail: c.stage } : null;
  }
  return focused.el?.isConnected ? { kind: 'protocol field', label: focused.label, text: focused.el.value || '' } : null;
}

const KINDS = [['include', 'Include'], ['exclude', 'Exclude'], ['group', 'Group']];
const kindLabel = kind => KINDS.find(([v]) => v === kind)?.[1] || 'Include';
let criteriaPage = 1;

/** A section head: the part's name is the page's own heading above it, so a part draws its head without a title. */
const head = (part, spec) => sectionHead({ ...spec, label: spec.title, title: part ? '' : spec.title });

/** A picker or menu button: the menu from the button, and the submenu when the engine folded it into More (ui-pick). */
const answers = (button, entries, onPick) => {
  if (!button) return;
  button.onclick = () => showMenu(button, entries(), { align: 'end' });
  button.addEventListener('ui-pick', e => onPick(e.detail.value));
};

/** The question's frame, one labelled field each. */
const picoFields = (state, p) => questionFields(state).map(f => `<label class="field"><span>${f.label}</span><input id="f-${f.id}" value="${esc(p.pico?.[f.id] ?? '')}"></label>`).join('');

// ---- the research team ------------------------------------------------------------------------------------------------------

const authorMenuOverflow = (i, n) => [
  { id: `author-up-${i}`, label: 'Move up', disabled: i === 0, attrs: { 'data-move-author': i, 'data-direction': -1 } },
  { id: `author-down-${i}`, label: 'Move down', disabled: i >= n - 1, attrs: { 'data-move-author': i, 'data-direction': 1 } },
  { id: `author-del-${i}`, label: 'Remove author', danger: true, attrs: { 'data-del-author': i } }];

function authorRow(a, i, paper) {
  const corresponding = a.name && paper.correspondingAuthor === a.name;
  const detail = [a.affiliation ? esc(a.affiliation) : '', a.email ? esc(a.email) : '', a.orcid ? `ORCID ${esc(a.orcid)}` : '', corresponding ? 'Corresponding author' : ''];
  return uiRow({ cls: 'author-row', attrs: { 'data-author-row': i },
    main: { html: `<span class="author-name"><span class="meta author-number">${i + 1}</span> ${esc(a.name || 'New author')}</span>`, detail, wrap: true },
    end: uiRowEnd({ inline: { id: `author-edit-${i}`, label: `Edit author ${i + 1}`, icon: 'manuscript', attrs: { 'data-edit-author': i } },
      more: { label: `More for author ${i + 1}`, attrs: { 'data-author-more': i } } }) });
}

function authorForm(a, i, n, paper) {
  const field = (key, label, extra = '') => formField(label, `<input data-author="${i}" data-k="${key}" value="${esc(a[key] ?? '')}"${extra} autocomplete="off">`);
  return `<div class="author-edit" role="listitem" data-author-row="${i}">
    <div class="author-fields">
      ${field('name', 'Full name', ' placeholder="Author name"')}
      ${field('affiliation', 'Affiliation', ' placeholder="Department, institution, country"')}
      ${formField('Email (optional)', `<input type="email" data-author="${i}" data-k="email" value="${esc(a.email ?? '')}" placeholder="name@institution.edu" autocomplete="off">`)}
      ${formField('ORCID (optional)', `<input id="author-orcid-${i}" data-author="${i}" data-k="orcid" value="${esc(a.orcid ?? '')}" placeholder="0000-0000-0000-0000" autocomplete="off" aria-describedby="orcid-status-${i}">`)}
      <label class="author-corresponding"><input type="checkbox" data-corresponding="${i}"${a.name && paper.correspondingAuthor === a.name ? ' checked' : ''}${a.name?.trim() ? '' : ' disabled'}><span>Corresponding author</span></label>
    </div>
    ${uiBar({ kind: 'foot', label: `Author ${i + 1}`, id: `author-foot-${i}`,
      message: { id: `orcid-status-${i}`, text: '' },
      actions: [{ id: `orcid-fill-${i}`, label: 'Fill from ORCID', icon: 'import', role: 'quiet', attrs: { 'data-orcid-fill': i } },
        { id: `author-done-${i}`, label: 'Done', icon: 'check', role: 'primary', attrs: { 'data-done-author': i } }],
      overflow: authorMenuOverflow(i, n) })}</div>`;
}

function teamList(authors, paper) {
  const editing = (a, i) => openAuthors.has(i) || !a.name?.trim();
  return uiList({ id: 'author-list', label: 'Research team', cls: 'author-list',
    rows: authors.map((a, i) => editing(a, i) ? authorForm(a, i, authors.length, paper) : authorRow(a, i, paper)),
    empty: emptyState({ title: 'No authors added yet', size: 'inline' }) });
}

// ---- the eligibility criteria ----------------------------------------------------------------------------------------------

function criterionEditor(c, list) {
  const i = list.findIndex(x => x.id === c.id);
  const sel = (key, options, value) => `<select data-c="${esc(c.id)}" data-k="${key}">${options.map(([v, l]) => `<option value="${esc(v)}"${v === value ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
  return `<div class="criterion-editor">
    ${formField('Criterion', `<textarea data-c="${esc(c.id)}" data-k="text" rows="2" class="autogrow">${esc(c.text)}</textarea>`)}
    <div class="criterion-fields">${formField('Kind', sel('kind', KINDS, c.kind || 'include'))}
      ${formField('Applies at', sel('stage', ['Title/abstract', 'Full text'].map(v => [v, v]), c.stage))}</div>
    ${formField('Screening question', `<textarea data-c="${esc(c.id)}" data-k="question" rows="2" class="autogrow" placeholder="Tested statement">${esc(c.question || '')}</textarea>`)}
    ${uiBar({ kind: 'foot', label: `Criterion ${c.id}`, id: `crit-foot-${i}`,
      actions: [{ id: `crit-done-${i}`, label: 'Done', icon: 'check', attrs: { 'data-crit-done': c.id } }],
      overflow: [{ id: `crit-del-${i}`, label: 'Remove criterion', danger: true, attrs: { 'data-del': c.id } }] })}</div>`;
}

function criteriaTable(criteria) {
  return editorRows({ id: 'criteria-rows', label: 'Eligibility criteria', items: criteria, key: c => c.id,
    columns: [{ head: 'ID', cell: c => esc(c.id) }, { head: 'Criterion', cell: c => `<span class="criterion-copy">${esc(c.text || 'New criterion')}</span>` },
      { head: 'Kind', cell: c => `<span class="criterion-kind">${esc(kindLabel(c.kind))}</span>` }, { head: 'Stage', cell: c => `<span class="criterion-stage">${esc(c.stage || 'Title/abstract')}</span>` }],
    selected: openCriterion, page: openCriterion == null ? criteriaPage : undefined, noun: 'criteria', editor: c => criterionEditor(c, criteria),
    empty: emptyState({ title: 'No criteria', size: 'inline' }) });
}

// ---- the parts, each its own panel ----

const protocolPanel = (part, versions) => `<div class="panel">
    ${head(part, { id: 'protocol-head', title: 'Study protocol', message: { id: 'p-version', text: versions.length ? `Version ${versions.length} frozen ${day(versions.at(-1).at)}` : 'Not frozen' },
      actions: [{ id: 'p-freeze', label: versions.length ? 'Record amendment' : 'Freeze version', icon: 'check' }, { id: 'p-reg', label: 'Registration draft', icon: 'download' }] })}
    ${versions.length ? `<div class="panel-body tight">${uiList({ id: 'protocol-versions', label: 'Frozen versions', rows: versions.map(v => uiRow({ main: { html: `v${v.v}, ${esc(day(v.at))}`, detail: [v.note ? esc(v.note) : ''] } })) })}</div>` : ''}
  </div>`;

const publicationPanel = (part, paper) => `<div class="panel">
    ${head(part, { id: 'publication-head', title: 'Publication' })}
    <div class="panel-body">
      <label class="field"><span>${PAPER[0].label}</span><textarea id="paper-title" class="autogrow" rows="1">${esc(paper.title || projectName(get()))}</textarea></label>
      ${part ? '' : `<label class="field"><span>${PAPER[1].label}</span>${journalButton('paper-journal', targetJournal(get()))}</label>
      <label class="field"><span>${PAPER[2].label}</span><input id="paper-registration" value="${esc(paper.registration ?? '')}" placeholder="${esc(PAPER[2].placeholder)}"></label>`}
    </div></div>`;

const teamPanel = (part, authors, paper) => `<div class="panel">
    ${head(part, { id: 'team-head', title: 'Research team', status: { id: 'team-count', text: plural(authors.length, 'author'), ch: 12 },
      actions: [{ id: 'add-author', label: 'Add author', icon: 'plus' }] })}
    <div class="panel-body tight" id="team-body">
      ${teamList(authors, paper)}
      ${paper.correspondingAuthor && !authors.some(a => a.name === paper.correspondingAuthor) ? `<label class="field"><span>Corresponding author</span><input id="legacy-corresponding" value="${esc(paper.correspondingAuthor)}"></label>` : ''}
    </div></div>`;

const questionPanel = (part, p, canWrite) => `<div class="panel">
    ${head(part, { id: 'question-head', title: 'Research question', message: { id: 'p-suggest-note', text: '' },
      actions: [{ id: 'p-suggest', label: 'Suggest', icon: 'draft-question', disabled: !canWrite }] })}
    <div class="panel-body"><div id="p-proposal"></div>
      <label class="field"><span>Question</span>
        <textarea id="f-title" rows="2" placeholder="What will this study answer?">${esc(p.title || '')}</textarea></label>
      ${picoFields(get(), p)}
    </div></div>`;

const criteriaPanel = (part, p, canWrite) => `<div class="panel">
      ${head(part, { id: 'criteria-head', title: 'Eligibility criteria', message: { id: 'from-text-note', text: '' }, status: { id: 'criteria-count', text: plural(p.criteria.length, 'criterion', 'criteria'), ch: 12 },
        actions: [{ id: 'from-text', label: 'From text', icon: 'criteria-edit', disabled: !canWrite }, { id: 'add', label: 'Add criterion', icon: 'plus' }] })}
      <div class="panel-body tight"><div id="c-proposal"></div><div id="criteria-body" class="criteria-body">${criteriaTable(p.criteria)}</div>
      </div></div>`;

// ---- the protocol's parts: each form lives here and nowhere else (Settings holds settings) -----------------------------------------------------

const PART_LIST = [['question', 'Research question', 'protocol'], ['criteria', 'Eligibility criteria', 'screening'], ['team', 'Research team', 'user'],
  ['publication', 'Publication', 'manuscript'], ['registration', 'Registration', 'book'], ['ethics', 'Ethics and governance', 'scale'],
  ['spirit', 'SPIRIT schedule', 'table'], ['protocol', 'Protocol versions', 'check']];
const partsOf = s => PART_LIST.filter(([id]) => id !== 'spirit' || spiritOffered(s));
let pick = 'question';   // the part the page shows

/** The shell's collection pane: the parts, one row each. */
export const list = {
  title: 'Protocol', count: false, rowHeight: 40, index: true,   // its parts, a table of contents: a narrow fixed column (app.mjs mountList)
  get empty() { return 'No parts'; },
  items: s => partsOf(s).map(([id, title, ic]) => ({ id, title, icon: ic })),
};
export function select(id) { if (PART_LIST.some(([part]) => part === id)) pick = id; }
export const selected = () => (partsOf(get()).some(([id]) => id === pick) ? pick : 'question');
export const navigationState = () => ({ list: selected() });
/** The title bar (lib/topbar.mjs) names the part on show: the page draws no title of its own above it. */
export function pageSpec({ part }) { return { title: PART_LIST.find(([x]) => x === part)?.[1] || 'Protocol', actions: [] }; }
export function page() { return pageSpec({ part: selected() }); }
export function restoreNavigation(state) { if (typeof state?.list === 'string') select(state.list); }

/**
 * Draws the selected part (the title bar names it), or one named part on its own: 'question', 'criteria', 'team', 'publication', 'protocol'
 * (versions); 'registration', 'ethics' and 'spirit' are drawn by views/protocol-parts.mjs. The wiring below skips whatever part is not drawn.
 */
export function render(el, ctx, { part = null } = {}) {
  if (!part) {
    const id = selected(), name = PART_LIST.find(([x]) => x === id)[1];
    el.innerHTML = `<section class="protocol-home" aria-label="${esc(name)}"><div class="sheet-col"><div id="protocol-part"></div></div></section>`;
    return render(el.querySelector('#protocol-part'), ctx, { part: id });
  }
  if (GOVERNANCE_PARTS.has(part)) return renderGovernancePart(el, ctx, part);
  const on = k => !part || part === k;
  const p = get().protocol || { title: '', pico: {}, criteria: [] };
  const paper = get().paper || {};
  const authors = paper.authors || [];
  const versions = get().protocolVersions || [];
  const canWrite = configured(modelFor('write'));
  const grows = [];
  el.innerHTML = `<div class="protocol-page${part ? ' protocol-part' : ''}"${part ? ` data-part="${part}"` : ''}>${on('protocol') ? protocolPanel(part, versions) : ''}
  ${on('publication') ? publicationPanel(part, paper) : ''}
  ${on('team') ? teamPanel(part, authors, paper) : ''}
  ${on('question') ? questionPanel(part, p, canWrite) : ''}
  ${on('criteria') ? criteriaPanel(part, p, canWrite) : ''}</div>`;

  const save = fn => { update(s => { s.protocol = fn({ ...(s.protocol || { title: '', pico: {}, criteria: [] }) }); return s; }); };
  // Plan A4: a frozen version is the protocol as registered; every later change
  // is an amendment with its rationale, kept beside the versions.
  (el.querySelector('#p-freeze') || {}).onclick = async () => {
    const first = !(get().protocolVersions || []).length;
    const note = first ? '' : await askText('Record amendment', { placeholder: 'Describe what changed and why…', confirm: 'Record' });
    if (!first && !note?.trim()) return;
    update(s => { s.protocolVersions = [...(s.protocolVersions || []), { v: (s.protocolVersions || []).length + 1, at: new Date().toISOString(), note: (note || '').trim(), protocol: JSON.parse(JSON.stringify(s.protocol || {})), paper: JSON.parse(JSON.stringify(s.paper || {})) }]; return s; });
    ctx.rerender();
  };
  // Plan A5: a registration-ready draft; the registration itself is a human act.
  (el.querySelector('#p-reg') || {}).onclick = async () => {
    const s2 = get(); const pp = s2.protocol || {}; const pico = pp.pico || {}; const pa = s2.paper || {};
    let n = 0; const id = () => `r${++n}`;
    const blocks = [{ id: id(), type: 'title', text: pp.title || pa.title || `${researchType(s2).label} protocol` },
      { id: id(), type: 'p', text: `Registration draft prepared ${new Date().toISOString().slice(0, 10)}${pa.registration ? `. Registration: ${pa.registration}` : '. Not yet registered.'}` },
      ...(pa.authors || []).length ? [{ id: id(), type: 'p', text: `Review team: ${(pa.authors || []).map(a => a.name).filter(Boolean).join(', ')}` }] : [],
      { id: id(), type: 'h1', text: 'Review question' },
      ...questionFields(s2).map(f => [f.label, pico[f.id] || (f.id === 'design' ? pico.designs : '')]).filter(([, v]) => v).map(([k, v]) => ({ id: id(), type: 'p', text: `${k}: ${v}` })),
      { id: id(), type: 'h1', text: 'Eligibility criteria' },
      ...(pp.criteria || []).map(c => ({ id: id(), type: 'p', text: `${c.id} (${c.stage}): ${c.text}` })),
      { id: id(), type: 'h1', text: 'Information sources and search strategy' },
      { id: id(), type: 'p', text: (s2.searches || []).length ? [...new Set((s2.searches || []).map(r => r.source || 'PubMed'))].join(', ') : '[to be added]' },
      { id: id(), type: 'h1', text: 'Selection, extraction and synthesis' },
      { id: id(), type: 'p', text: `Screening: ${s2.settings?.dualScreening ? 'two reviewers, blinded, conflicts resolved by discussion' : 'one reviewer'}. Extraction fields: ${(s2.customFields || []).length + 10}. Effect measure: ${s2.settings?.measure || 'RR'}; heterogeneity estimator: ${s2.settings?.method || 'REML'}. Certainty: GRADE.` }];
    const blob = await writeDocx({ blocks, section: null, styles: null, renderCite: () => '', renderResult: () => null, references: [] });
    await saveFile(blob, 'protocol-registration-draft.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  };
  el.querySelector('#p-suggest')?.addEventListener('click', async () => {
    const b = el.querySelector('#p-suggest'), n = el.querySelector('#p-suggest-note'); b.disabled = true; n.textContent = 'Drafting';
    try {
      const prop = await suggestProtocol(get().protocol, modelFor('write'));
      n.textContent = '';
      const host = el.querySelector('#p-proposal');
      host.innerHTML = proposalBox({ id: 'p-prop', title: 'Proposed', meta: modelFor('write').model,
        body: `<table><tbody>${Object.entries(prop.pico).filter(([, v]) => v).map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`).join('')}
          ${prop.criteria.map((c, i) => `<tr><th>Criterion ${i + 1}</th><td>${esc(c.text)} <span class="meta">${esc(c.stage)}</span></td></tr>`).join('')}</tbody></table>` });
      host.querySelector('[data-discard]').onclick = () => { host.innerHTML = ''; };
      host.querySelector('[data-accept]').onclick = () => {
        save(p => {
          const pico = { ...(p.pico || {}) };
          for (const [k, v] of Object.entries(prop.pico)) if (v && !pico[k]) pico[k] = v;
          const have = new Set(p.criteria.map(c => c.text.trim().toLowerCase()));
          const criteria = [...p.criteria, ...prop.criteria.filter(c => !have.has(c.text.trim().toLowerCase()))
            .map((c, i) => ({ id: `C${p.criteria.length + i + 1}`, text: c.text, stage: c.stage }))];
          return { ...p, pico, criteria };
        });
        ctx.rerender(); ctx.refreshCounts();
      };
    } catch (err) { n.textContent = err.message.slice(0, 80); b.disabled = false; }
  });

  // Plan A3: prose in, rules out, accepted by hand. The writing profile does
  // this; the decision model cannot write.
  el.querySelector('#from-text')?.addEventListener('click', async () => {
    // the manuscript's own criteria section, when it has one, is the starting text (the person edits or replaces it)
    const text = await askText('Eligibility criteria', { value: criteriaSection(get().manuscript?.blocks), placeholder: 'Paste the criteria', confirm: 'Structure' });
    if (!text?.trim()) return;
    const b = el.querySelector('#from-text'), n = el.querySelector('#from-text-note'); b.disabled = true; n.textContent = 'Structuring';
    try {
      const { title, pico, rules } = await structureCriteria(text, modelFor('write'));
      n.textContent = ''; b.disabled = false;
      const host = el.querySelector('#c-proposal');
      const head2 = [...(title ? [['Title', title]] : []), ...Object.entries(pico)];
      host.innerHTML = proposalBox({ id: 'c-prop', title: 'Proposed', meta: `${rules.length}, ${modelFor('write').model}`,
        body: `<table><tbody>${head2.map(([k, v]) => `<tr><th>${esc(k)}</th><td colspan="3">${esc(v)}</td></tr>`).join('')}</tbody>
          <thead><tr><th>Kind</th><th class="grow">Rule</th><th>Statement</th><th>Stage</th></tr></thead><tbody>${rules.map(r =>
          `<tr><td>${esc(r.kind)}</td><td class="grow">${esc(r.text)}</td><td>${esc(r.question)}</td><td>${esc(r.stage)}</td></tr>`).join('')}</tbody></table>` });
      host.querySelector('[data-discard]').onclick = () => { host.innerHTML = ''; };
      // Empty fields are filled; what the reviewer already wrote stays (plan A2).
      host.querySelector('[data-accept]').onclick = () => {
        save(p2 => {
          const next = { ...(p2.pico || {}) };
          for (const [k, v] of Object.entries(pico)) if (v && !next[k]) next[k] = v;
          return { ...p2, title: p2.title || title || '', pico: next, criteria: mergeRules(p2.criteria, rules) };
        });
        ctx.rerender(); ctx.refreshCounts();
      };
    } catch (err) { n.textContent = err.message.slice(0, 80); b.disabled = false; }
  });

  const savePaper = fn => update(st => { st.paper = fn({ ...(st.paper || {}) }); return st; });

  // The title is one paragraph that grows to show all of it; Enter does not add a line.
  const titleBox = el.querySelector('#paper-title');
  if (titleBox) { titleBox.onkeydown = e => { if (e.key === 'Enter') e.preventDefault(); }; grows.push(autoGrow(titleBox)); }

  PAPER.filter(f => f.id !== 'journal').forEach(f => {
    (el.querySelector(`#paper-${f.id}`) || {}).oninput = e => {
      savePaper(p2 => ({ ...p2, [f.id]: e.target.value }));
      // The working title is the project's name: the heading, window and project list follow it.
      const name = e.target.value.trim();
      if (f.id === 'title' && name) update(st => { if (st.project) st.project = { ...st.project, name }; return st; });
    };
  });
  if (el.querySelector('#paper-journal')) wireJournalButton(el.querySelector('#paper-journal'), () => targetJournal(get()),
    choice => { const msg = changeTarget({ get, update }, [choice.label, ...otherJournals(get()).filter(x => x !== choice.label)], choice); if (msg) ctx.say?.(msg); });

  // ---- the research team: rows, and the open author's form with its foot ----
  const drawTeam = () => {
    const host = el.querySelector('#team-body'); if (!host) return;
    const st = get().paper || {};
    const t = document.createElement('template'); t.innerHTML = teamList(st.authors || [], st);
    host.querySelector('#author-list')?.replaceWith(t.content.firstElementChild);
    const count = el.querySelector('#team-count'); if (count) count.textContent = plural((st.authors || []).length, 'author');
    wireTeam();
  };
  const wireTeam = () => {
    const list = el.querySelector('#author-list'); if (!list) return;
    list.querySelectorAll('[data-edit-author]').forEach(button => button.onclick = () => {
      openAuthors.add(Number(button.dataset.editAuthor)); drawTeam();
      list.querySelector(`[data-author-row="${button.dataset.editAuthor}"] [data-k="name"]`)?.focus();
    });
    list.querySelectorAll('[data-author-more]').forEach(button => {
      const i = Number(button.dataset.authorMore), n = (get().paper?.authors || []).length;
      button.onclick = () => showMenu(button, [
        { label: 'Move up', icon: 'arrow-up', disabled: i === 0, run: () => moveAuthor(i, -1) },
        { label: 'Move down', icon: 'arrow-down', disabled: i >= n - 1, run: () => moveAuthor(i, 1) },
        '-', { label: 'Remove author', icon: 'trash', run: () => removeAuthor(i) }], { align: 'end' });
    });
    list.querySelectorAll('[data-done-author]').forEach(button => button.onclick = () => {
      const i = Number(button.dataset.doneAuthor), input = list.querySelector(`[data-author="${i}"][data-k="name"]`);
      if (!input.value.trim()) { input.setCustomValidity('Enter an author name.'); input.reportValidity(); return; }
      openAuthors.delete(i); drawTeam();
      list.querySelector(`[data-edit-author="${i}"]`)?.focus();
    });
    list.querySelectorAll('[data-move-author]').forEach(button => button.onclick = () => moveAuthor(Number(button.dataset.moveAuthor), Number(button.dataset.direction)));
    list.querySelectorAll('[data-del-author]').forEach(button => button.onclick = () => removeAuthor(Number(button.dataset.delAuthor)));
    list.querySelectorAll('[data-author]').forEach(input => input.oninput = () => {
      input.setCustomValidity('');
      const idx = Number(input.dataset.author);
      savePaper(p2 => {
        const old = p2.authors[idx];
        const correspondingAuthor = input.dataset.k === 'name' && old.name && p2.correspondingAuthor === old.name ? input.value : p2.correspondingAuthor;
        return { ...p2, correspondingAuthor, authors: p2.authors.map((a, j) => j === idx ? { ...a, [input.dataset.k]: input.value } : a) };
      });
      const box = list.querySelector(`[data-corresponding="${idx}"]`), author = get().paper.authors[idx];
      if (box) { box.disabled = !author.name?.trim(); box.checked = !!author.name && get().paper.correspondingAuthor === author.name; }
    });
    list.querySelectorAll('[data-corresponding]').forEach(box => box.onchange = () => {
      savePaper(p2 => {
        const name = p2.authors[Number(box.dataset.corresponding)].name;
        return { ...p2, correspondingAuthor: p2.correspondingAuthor === name ? '' : name };
      });
      list.querySelectorAll('[data-corresponding]').forEach(b => { const name = get().paper.authors[Number(b.dataset.corresponding)].name; b.checked = !!name && get().paper.correspondingAuthor === name; });
    });
    list.querySelectorAll('[data-orcid-fill]').forEach(button => button.onclick = async () => {
      const idx = Number(button.dataset.orcidFill), row = button.closest('[data-author-row]');
      const input = row.querySelector('[data-k="orcid"]'), status = row.querySelector('[id^="orcid-status-"]');
      const id = normalizeOrcid(input.value);
      if (!id) { status.textContent = 'Enter a valid ORCID iD'; input.setAttribute('aria-invalid', 'true'); input.focus(); return; }
      input.removeAttribute('aria-invalid');
      button.disabled = true; button.setAttribute('aria-busy', 'true'); status.textContent = 'Looking up';
      try {
        const details = await lookupOrcid(id);
        // Navigation, author reordering, or an edited iD makes this response stale.
        if (!row.isConnected || normalizeOrcid(input.value) !== id) return;
        const before = get().paper.authors[idx], next = { ...fillOrcidDetails(before, details), orcid: id };
        const filled = ['name', 'affiliation', 'email'].filter(key => next[key] !== before[key]);
        savePaper(p2 => ({ ...p2, authors: p2.authors.map((author, i) => i === idx ? next : author) }));
        for (const field of row.querySelectorAll('[data-author]')) field.value = next[field.dataset.k] || '';
        const corresponding = row.querySelector('[data-corresponding]');
        corresponding.disabled = !next.name?.trim();
        corresponding.checked = !!next.name && get().paper.correspondingAuthor === next.name;
        status.textContent = filled.length ? `Added ${filled.join(', ')}`
          : ['name', 'affiliation', 'email'].some(key => details[key]) ? 'Nothing to fill' : 'No public details';
      } catch (error) { if (row.isConnected) status.textContent = error.message; }
      finally {
        if (row.isConnected) {
          button.disabled = false; button.removeAttribute('aria-busy');
          if (normalizeOrcid(input.value) !== id) status.textContent = 'ORCID changed';
        }
      }
    });
  };
  const moveAuthor = (from, delta) => {
    const to = from + delta;
    savePaper(p2 => {
      const list = [...p2.authors];
      if (to < 0 || to >= list.length) return p2;
      [list[from], list[to]] = [list[to], list[from]];
      return { ...p2, authors: list };
    });
    const had = openAuthors.has(from), hadTo = openAuthors.has(to);
    openAuthors.delete(from); openAuthors.delete(to);
    if (had) openAuthors.add(to); if (hadTo) openAuthors.add(from);
    drawTeam();
  };
  const removeAuthor = idx => {
    savePaper(p2 => ({ ...p2,
      correspondingAuthor: p2.authors[idx].name === p2.correspondingAuthor ? '' : p2.correspondingAuthor,
      authors: p2.authors.filter((_, j) => j !== idx) }));
    openAuthors = new Set([...openAuthors].filter(i => i !== idx).map(i => i > idx ? i - 1 : i));
    drawTeam();
  };
  (el.querySelector('#add-author') || {}).onclick = () => {
    savePaper(p2 => ({ ...p2, authors: [...(p2.authors || []), { name: '', affiliation: '' }] }));
    drawTeam();
    el.querySelector(`[data-author="${get().paper.authors.length - 1}"][data-k="name"]`)?.focus();
  };
  el.querySelector('#legacy-corresponding')?.addEventListener('input', e => savePaper(p2 => ({ ...p2, correspondingAuthor: e.target.value })));
  wireTeam();

  (el.querySelector('#f-title') || {}).oninput = e => save(p => ({ ...p, title: e.target.value }));
  questionFields(get()).forEach(f => (el.querySelector(`#f-${f.id}`) || {}).oninput = e =>
    save(p => ({ ...p, pico: { ...p.pico, [f.id]: e.target.value } })));
  // Naming the outcome readies the primary outcome where it is rated and synthesised, as naming one anywhere does (lib/outcome-links.mjs)
  (el.querySelector('#f-outcome') || {}).onchange = e => {
    const s2 = get();
    if (!e.target.value.trim() || outcomes(s2)[0].hidden || !visibleViews(s2).includes('certainty')) return;
    const u = usesOf(s2, PRIMARY);
    if (!u.grade.length && !u.swim.length) update(st => { setUpOutcome(st, PRIMARY); return st; });
  };

  // ---- the criteria: one table, the open criterion's editor in its row ----
  el.addEventListener('focusin', e => {
    const i = e.target.closest('input, textarea, select'); if (!i) return;
    const lab = i.closest('label')?.querySelector('span')?.textContent || i.getAttribute('aria-label') || i.placeholder || '';
    focused = i.dataset.c ? { c: i.dataset.c } : { label: lab.trim(), el: i };
  });
  const drawCriteria = () => {
    const host = el.querySelector('#criteria-body'); if (!host) return;
    host.innerHTML = criteriaTable(get().protocol?.criteria || []);
    const count = el.querySelector('#criteria-count'); if (count) count.textContent = plural((get().protocol?.criteria || []).length, 'criterion', 'criteria');
    wireCriteria();
  };
  const wireCriteria = () => {
    const host = el.querySelector('#criteria-body'); if (!host) return;
    wireEditorRows(el, 'criteria-rows', { onSelect: k => { openCriterion = k; drawCriteria(); }, onPage: n => { criteriaPage = n; openCriterion = null; drawCriteria(); } });
    host.querySelectorAll('textarea[data-c]').forEach(t => grows.push(autoGrow(t)));
    host.querySelectorAll('[data-c]').forEach(i => { i.oninput = () => {
      save(p => ({ ...p, criteria: p.criteria.map(c => c.id === i.dataset.c ? { ...c, [i.dataset.k]: i.value } : c) }));
      const cells = host.querySelector(`tr[data-edit-key="${CSS.escape(i.dataset.c)}"]`);
      if (!cells) return;
      if (i.dataset.k === 'text') cells.querySelector('.criterion-copy').textContent = i.value || 'New criterion';
      if (i.dataset.k === 'kind') cells.querySelector('.criterion-kind').textContent = i.selectedOptions[0].textContent;
      if (i.dataset.k === 'stage') cells.querySelector('.criterion-stage').textContent = i.value;
    }; });
    host.querySelectorAll('[data-crit-done]').forEach(b => b.onclick = () => {
      const id = b.dataset.critDone; openCriterion = null; drawCriteria();
      host.querySelector(`[data-edit-row="${CSS.escape(id)}"]`)?.focus();
    });
    host.querySelectorAll('[data-del]').forEach(b => b.onclick = () => {
      save(p => ({ ...p, criteria: p.criteria.filter(c => c.id !== b.dataset.del) }));
      openCriterion = null; drawCriteria(); ctx.refreshCounts();
    });
  };
  (el.querySelector('#add') || {}).onclick = () => {
    let id = '';
    save(p => {
      const used = new Set(p.criteria.map(c => c.id));
      let n = 1;
      while (used.has(`C${n}`)) n++;
      id = `C${n}`;
      return { ...p, criteria: [...p.criteria, { id, text: '', stage: 'Title/abstract', kind: 'include', question: '' }] };
    });
    openCriterion = id; drawCriteria(); ctx.refreshCounts();
    host_focus();
  };
  const host_focus = () => el.querySelector('#criteria-body [data-edit-panel] textarea')?.focus();
  wireCriteria();
  // The view is redrawn whole, never torn down, so the text boxes are let go with the page's next render.
  for (const g of drawnGrows) g.release();
  drawnGrows = grows;
}
