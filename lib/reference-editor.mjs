// The reference editor: a record's bibliographic fields, edited in place in the Library's record detail (DIALOGS plan #28). It replaces the
// Add and Edit reference dialog: the Library already draws the record in the inspector, so editing it is that section's other mode.
// The draft lives here, in the module, so a repaint of the Library (the inspector is drawn again on every paint) never loses what was
// typed. A new reference is a draft record that is added to the Library when it is saved, so cancelling leaves no blank record behind.
import { normalizeLanguage } from './languages.mjs';
import { get, update, projects } from '../store.mjs';
import { discardPreview } from './preview-cache.mjs';
import { esc } from './html.mjs';
import { familyName, authorList } from './bib.mjs';
import { suggestJournals } from './journal-picker.mjs';
import { uiBar, uiList, uiRow, uiRowEnd } from './ui-actions.mjs';
import { formField, formFit, formCells, disclosure, countHeading } from './ui-components.mjs';
import { showMenu } from './menu.mjs';

const FIELDS = ['title', 'journal', 'year', 'doi', 'journalAbbr', 'volume', 'issue', 'pages', 'url', 'pdfUrl', 'pmid', 'language', 'abstract'];
let draft = null;       // { id, creating, seed, v, authors, error, project, done, select, open }

/** The reference being edited or made, if it belongs to the open project. */
export const referenceDraft = () => (draft && draft.project === projects().current ? draft : null);
/** The record the Library should select for the draft, once: an edit started from another page lands on its record. */
export function takeReferenceSelection() {
  const d = referenceDraft();
  if (!d?.select) return null;
  const id = d.select; d.select = null;
  return d.creating ? null : id;
}

function begin(paper, id, done) {
  const authors = authorList(paper.authors);
  if (!authors.length) authors.push('');
  draft = { id, creating: !id, seed: paper, error: '', project: projects().current, done, select: id, authors,
    open: { supplied: true, details: false, abstract: false },
    v: Object.fromEntries(FIELDS.map(k => [k, String(paper[k] ?? '')])) };
}
/** Starts editing a record of the Library; false when there is no such record. */
export function startEdit(id, done = () => {}) {
  const paper = get().papers.find(p => p.id === id);
  if (!paper) return false;
  begin(paper, id, done);
  return true;
}
/** Starts a new reference (`seed` may hold a supplied citation and fields); `done(id)` hears the record once it is saved. */
export function startAdd(seed = {}, done = () => {}) { begin(seed, null, done); return true; }

/** Edit a record from any page: the Library opens on it with the editor in its detail. `ctx` is the page's context (go, openDetails). */
export function editReference(id, ctx, done = () => ctx.rerender?.()) {
  if (!startEdit(id, done)) return;
  ctx.go('library'); ctx.openDetails?.();
}
/** Add a reference from any page (the assistant's suggested reference): the Library opens with a new reference in its detail. */
export function addReference(seed = {}, done = () => {}, ctx = null) {
  startAdd(seed, done);
  if (ctx) { ctx.go('library'); ctx.openDetails?.(); }
}

const area = (key, value, rows) => `<textarea data-ref="${key}" rows="${rows}">${esc(value)}</textarea>`;
const text = (key, value, extra = '') => `<input data-ref="${key}" value="${esc(value)}" autocomplete="off"${extra}>`;
const fieldsOf = html => `<div class="an-settings"${formFit(formCells(html))}>${html}</div>`;

/** The author rows and the Add author act, redrawn alone when an author is added, moved or removed. */
function authorsHtml() {
  const { authors } = draft;
  const rows = authors.map((name, i) => uiRow({ attrs: { 'data-author-row': i },
    main: { html: `<input data-author="${i}" aria-label="Author ${i + 1}" value="${esc(name)}" placeholder="Author name" spellcheck="false" autocomplete="off">` },
    end: uiRowEnd({ more: { label: `More for author ${i + 1}`, attrs: { 'data-author-more': i } } }) }));
  return `${uiList({ id: 'ref-author-list', label: 'Authors', rows })}
    ${uiBar({ kind: 'tools', label: 'Authors', id: 'ref-author-tools', actions: [{ id: 'ref-author-add', label: 'Add author', icon: 'plus' }] })}`;
}

/** The editor, as the inspector section of the record (views/library.mjs inspect). */
export function referenceEditorHtml() {
  const { v, creating, error, seed, open } = draft, label = !creating && seed.label ? seed.label : '';
  const head = uiBar({ kind: 'head', label: creating ? 'New reference' : 'Edit reference', id: 'ref-head',
    lead: { title: creating ? 'New reference' : 'Edit reference', level: 'h3' }, ...(label ? { message: { id: 'ref-record', text: label } } : {}),
    actions: [{ id: 'ref-cancel', label: 'Cancel' }, { id: 'ref-save', label: 'Save reference', role: 'primary' }] });
  const supplied = creating && seed.rawCitation ? disclosure({ id: 'ref-supplied', title: 'Supplied citation', open: open.supplied, body: `<div class="reference-source">${esc(seed.rawCitation)}</div>` }) : '';
  const main = fieldsOf([formField('Title', area('title', v.title, 2), { span: 2 }), formField('Journal', text('journal', v.journal), { span: 2 }),
    formField('Year', text('year', v.year, ' inputmode="numeric" maxlength="4"')), formField('DOI', text('doi', v.doi, ' spellcheck="false"'))].join(''));
  const details = disclosure({ id: 'ref-details', title: 'Publication details', open: open.details, body: fieldsOf([
    formField('Journal abbreviation', text('journalAbbr', v.journalAbbr), { span: 2 }), formField('Volume', text('volume', v.volume)), formField('Issue', text('issue', v.issue)),
    formField('Pages', text('pages', v.pages)), formField('PubMed ID', text('pmid', v.pmid, ' inputmode="numeric"')),
    formField('Source URL', text('url', v.url, ' spellcheck="false"'), { span: 2 }), formField('Preferred PDF URL', text('pdfUrl', v.pdfUrl, ' spellcheck="false"'), { span: 2 }),
    formField('Language (name or code)', text('language', v.language), { span: 2 })].join('')) });
  const abstract = disclosure({ id: 'ref-abstract', title: 'Abstract', open: open.abstract, body: fieldsOf(formField('Abstract', area('abstract', v.abstract, 6), { span: 2 })) });
  return `<section class="ref-edit" id="ref-edit" aria-label="Reference editor">${head}
    ${error ? `<p class="note" id="ref-error" role="alert">${esc(error)}</p>` : ''}${supplied}${main}
    <section class="ref-authors" aria-label="Authors">${countHeading({ title: 'Authors', count: draft.authors.filter(a => a.trim()).length })}<div id="ref-authors">${authorsHtml()}</div></section>
    ${details}${abstract}</section>`;
}

/** Binds the editor. `rerender` repaints the Library, which draws the editor, or the record, again. */
export function wireReferenceEditor(root, { rerender }) {
  if (!draft) return;
  const { v, authors } = draft;
  root.querySelectorAll('[data-ref]').forEach(x => { x.oninput = () => { v[x.dataset.ref] = x.value; }; });
  const track = (id, key) => { const d = root.querySelector(`#${id}`); if (d) d.ontoggle = () => { draft.open[key] = d.open; }; };
  track('ref-supplied', 'supplied'); track('ref-details', 'details'); track('ref-abstract', 'abstract');
  suggestJournals(root.querySelector('[data-ref="journal"]'), { selector: true, journals: [draft.seed.journal, ...get().papers.map(p => p.journal)] });

  const host = root.querySelector('#ref-authors');
  const count = () => { const c = root.querySelector('.ref-authors .ui-heading-count'); if (c) c.textContent = String(authors.filter(a => a.trim()).length); };
  const drawAuthors = focus => {
    host.innerHTML = authorsHtml(); bindAuthors(); count();
    if (focus != null) host.querySelector(`[data-author="${focus}"]`)?.focus();
  };
  const moveAuthor = (i, step) => {
    const to = i + step; if (to < 0 || to >= authors.length) return;
    [authors[i], authors[to]] = [authors[to], authors[i]]; drawAuthors(to);
  };
  const removeAuthor = i => { authors.splice(i, 1); if (!authors.length) authors.push(''); drawAuthors(Math.min(i, authors.length - 1)); };
  function bindAuthors() {
    const list = host.querySelector('#ref-author-list');
    list.oninput = e => { if (e.target.matches('[data-author]')) { authors[+e.target.dataset.author] = e.target.value; count(); } };
    list.onkeydown = e => {
      if (!e.target.matches('[data-author]')) return;
      const i = +e.target.dataset.author;
      if (e.key === 'Enter') { e.preventDefault(); authors.splice(i + 1, 0, ''); drawAuthors(i + 1); }
      else if (e.altKey && ['ArrowUp', 'ArrowDown'].includes(e.key)) { e.preventDefault(); moveAuthor(i, e.key === 'ArrowUp' ? -1 : 1); }
    };
    // several names pasted at once, one to a line, become one author each
    list.onpaste = e => {
      if (!e.target.matches('[data-author]')) return;
      const lines = e.clipboardData?.getData('text/plain').split(/\r?\n/).map(a => a.trim()).filter(Boolean);
      if (!lines || lines.length < 2) return;
      e.preventDefault(); const input = e.target, i = +input.dataset.author;
      lines[0] = input.value.slice(0, input.selectionStart) + lines[0];
      lines[lines.length - 1] += input.value.slice(input.selectionEnd);
      authors.splice(i, 1, ...lines); drawAuthors(i + lines.length - 1);
    };
    list.querySelectorAll('[data-author-more]').forEach(b => b.onclick = () => {
      const i = +b.dataset.authorMore;
      showMenu(b, [{ label: 'Move up', icon: 'arrow-up', disabled: i === 0, run: () => moveAuthor(i, -1) },
        { label: 'Move down', icon: 'arrow-down', disabled: i === authors.length - 1, run: () => moveAuthor(i, 1) },
        '-', { label: 'Remove author', icon: 'trash', danger: true, run: () => removeAuthor(i) }], { align: 'end' });
    });
    host.querySelector('#ref-author-add').onclick = () => { authors.push(''); drawAuthors(authors.length - 1); };
  }
  bindAuthors();

  root.querySelector('#ref-cancel').onclick = () => { draft = null; rerender(); };
  root.querySelector('#ref-save').onclick = () => save(rerender);
  if (draft.creating && !draft.focused) { draft.focused = true; root.querySelector('[data-ref="title"]')?.focus(); }
}

/** Checks the draft and writes it: a new record is added to the Library, an edited one updated in place. A problem is said on the page. */
function save(rerender) {
  const { id, creating, seed, project, done } = draft;
  const values = Object.fromEntries(FIELDS.map(k => [k, String(draft.v[k] ?? '').trim()]));
  values.doi = values.doi.replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, '').replace(/^doi:\s*/i, '');
  let error = !values.title ? 'A title is required.' : values.year && !/^\d{4}$/.test(values.year) ? 'Enter a four-digit year.' : values.doi && !/^10\.\d{4,9}\/\S+$/i.test(values.doi) ? 'Enter a valid DOI, such as 10.1234/example.' : '';
  for (const key of ['url', 'pdfUrl']) if (values[key]) { try { if (!['http:', 'https:'].includes(new URL(values[key]).protocol)) throw Error(); } catch { error = 'Enter a complete HTTP or HTTPS URL.'; } }
  if (values.pmid && !/^\d+$/.test(values.pmid)) error = 'Enter a numeric PubMed ID.';
  if (projects().current !== project) error = 'The active review changed. Reopen this reference.';
  if (creating && !error) {
    const norm = value => String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    const duplicate = get().papers.find(p => values.doi && String(p.doi || '').toLowerCase() === values.doi.toLowerCase()
      || norm(p.title) === norm(values.title) && (!values.year || String(p.year || '') === values.year));
    if (duplicate) error = `Already in the Library: ${duplicate.label || duplicate.title}`;
  }
  if (error) { draft.error = error; rerender(); return; }
  values.language = normalizeLanguage(values.language);
  if (creating ? values.language : values.language !== (seed.language || '')) values.languageSource = 'Manual';
  values.authors = draft.authors.map(a => a.trim()).filter(Boolean);
  if (creating) {
    const newId = `r${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
    const label = [values.authors[0] ? familyName(values.authors[0]) : 'Study', values.year].filter(Boolean).join(' ');
    update(s => { s.papers.push({ ...values, id: newId, key: newId, label, source: seed.source || 'Manual', rawCitation: seed.rawCitation || '', pdf: null }); return s; });
    draft = null; done(newId); return;
  }
  update(s => {
    const target = s.papers.find(p => p.id === id);
    if (target) {
      if (['doi', 'title', 'url', 'pdfUrl', 'pmid'].some(k => String(target[k] || '') !== String(values[k] || ''))) { discardPreview(id); delete target.pdfRetrieval; }
      Object.assign(target, values);
    }
    return s;
  });
  draft = null; done();
}
