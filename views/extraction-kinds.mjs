// A field's kind and the project's lists of terms (plan G1a, data-model plan S1b). The kind dialog changes a custom field's or a table
// column's kind and list, and "Read values again" proposes each value's new reading in the table (lib/field-retype.mjs). The lists
// dialogs add, edit and remove a vocabulary (lib/vocabularies.mjs). Nothing here writes a value: a person accepts the proposals.
import { store$get as get, store$update as update } from "../boot.mjs";
import { lib_dialog$formDialog as formDialog, lib_dialog$formValues as formValues } from "../boot.mjs";
import { lib_ui_components$formField as formField, lib_ui_components$formFit as formFit } from "../boot.mjs";
import { lib_html$esc as esc } from "../boot.mjs";
import { KINDS, usesLevels } from '../lib/field-kinds.mjs';
import { definitionOf, setFieldKind, fieldsNaming } from '../lib/field-retype.mjs';
import { vocabularies, fieldVocabularies, vocabularyById, putVocabulary, removeVocabulary, normalizeVocabulary, problemsOf } from '../lib/vocabularies.mjs';
import { termsToText, textToTerms, retypeSentence, readAgain } from '../lib/vocabulary-edit.mjs';

/** Whether the field's kind can be changed here: a custom field or a table's column, not a built-in field. */
export const kindEditable = fieldId => !!definitionOf(get(), fieldId);

const status = attr => `<p class="meta" role="status" ${attr} hidden></p>`;
const opts = (list, value) => list.map(([v, l]) => `<option value="${esc(v)}"${v === value ? ' selected' : ''}>${esc(l)}</option>`).join('');
const say = (d, sel, lines) => { const el = d.querySelector(sel); if (el) { el.hidden = !lines.length; el.innerHTML = lines.map(l => `<div>${esc(l)}</div>`).join(''); } };

/** The kind dialog of one field. Saving changes the definition; Read values again saves it first, then proposes and reports the counts. */
export async function fieldKindDialog(ctx, fieldId) {
  const def = definitionOf(get(), fieldId); if (!def) return;
  const f = def.field, lists = fieldVocabularies(get());
  const fieldsHtml = [formField('Kind', `<select name="type">${opts(KINDS, f.type)}</select>`),
    formField('List', `<select name="vocabulary">${opts([['', 'None, own levels'], ...lists.map(v => [v.id, v.label || v.id])], f.vocabulary || '')}</select>`),
    formField('Levels', `<input name="options" value="${esc((f.options || []).join(', '))}" spellcheck="false" autocomplete="off">`)];
  const body = `<div class="an-settings"${formFit([1, 1, 1])}>${fieldsHtml.join('')}</div>${status('data-kind-status')}`;
  const save = form => {
    const v = formValues(form), levels = usesLevels(v.type);
    let why = '';
    update(s => { why = setFieldKind(s, fieldId, { type: v.type, vocabulary: levels && v.vocabulary ? v.vocabulary : null, options: levels && !v.vocabulary ? v.options.split(',') : null }); return s; });
    return why;
  };
  let changed = false;
  const out = await formDialog({ id: 'field-kind', title: `Kind of ${f.label}`, tier: 'M', confirm: 'Save', cancel: 'Close', start: { id: 'reread', label: 'Read values again' }, body,
    onMount: d => {
      const form = d.querySelector('form'), sync = () => {
        const levels = usesLevels(form.elements.type.value);
        form.elements.vocabulary.closest('label').hidden = !levels || !fieldVocabularies(get()).length;
        form.elements.options.closest('label').hidden = !levels || !!form.elements.vocabulary.value;
      };
      form.elements.type.onchange = form.elements.vocabulary.onchange = sync; sync();
    },
    onAct: (_id, d) => {
      const why = save(d.querySelector('form'));
      if (why) { say(d, '[data-kind-status]', [why]); return true; }
      let plan; update(s => { plan = readAgain(s, fieldId); return s; });
      changed = true; say(d, '[data-kind-status]', [retypeSentence(plan)]);
      return true;
    },
    submit: (form, d) => { const why = save(form); if (why) { say(d, '[data-kind-status]', [why]); return undefined; } return formValues(form); } });
  if (out || changed) ctx.rerender(out ? 'Kind saved. Choose Read values again to propose readings of its values' : '');
}

// ---- lists of terms -----------------------------------------------------------------------------------------------------------------

/** The lists dialog: pick a list to edit, a new one, or remove one nothing uses. */
export async function listsDialog(ctx) {
  const lists = vocabularies(get());
  const out = await formDialog({ id: 'vocab-pick', title: 'Lists of terms', tier: 'S', confirm: 'Edit', cancel: 'Close',
    start: lists.length ? { id: 'remove', label: 'Remove list', danger: true } : null,
    body: formField('List', `<select name="id"><option value="">New list</option>${lists.map(v => `<option value="${esc(v.id)}">${esc(v.label || v.id)}</option>`).join('')}</select>`) + status('data-vocab-problems'),
    onAct: (_a, d) => {
      const id = d.querySelector('[name=id]').value;
      if (!id) { say(d, '[data-vocab-problems]', ['Choose the list to remove.']); return true; }
      let why = ''; update(s => { why = removeVocabulary(s, id, { fieldIds: fieldsNaming(s, id) }); return s; });
      if (why) { say(d, '[data-vocab-problems]', [why]); return true; }
      return false;
    } });
  if (!out) return;
  if (out.act === 'remove') { ctx.rerender('List removed'); return; }
  await vocabularyDialog(ctx, out.id || null);
}

/** One list: identifier, label and its terms, one a line as code | label | parent | aliases. The problems are shown as written. */
export async function vocabularyDialog(ctx, id = null) {
  const cur = id ? vocabularyById(get(), id) : null;
  const fieldsHtml = [formField('Identifier', `<input name="id" value="${esc(cur?.id || '')}" spellcheck="false" autocomplete="off"${cur ? ' readonly' : ''}>`),
    formField('Label', `<input name="label" value="${esc(cur?.label || '')}" autocomplete="off">`),
    formField('Terms', `<textarea name="terms" rows="10" spellcheck="false" placeholder="code | label | parent | alias; alias">${esc(termsToText(cur))}</textarea>`, { span: 2 })];
  const body = `<div class="an-settings"${formFit([1, 1, 2])}>${fieldsHtml.join('')}</div>${status('data-vocab-problems')}`;
  const out = await formDialog({ id: 'vocab-edit', title: cur ? `List ${cur.label || cur.id}` : 'New list', tier: 'L', confirm: 'Save', body,
    submit: (form, d) => {
      const v = formValues(form), list = normalizeVocabulary({ id: v.id, label: v.label, terms: textToTerms(v.terms) }), problems = problemsOf(list);
      if (problems.length) { say(d, '[data-vocab-problems]', problems); return undefined; }
      let why = ''; update(s => { why = putVocabulary(s, list, { fieldIds: fieldsNaming(s, list.id) }); return s; });
      if (why) { say(d, '[data-vocab-problems]', [why]); return undefined; }
      return list;
    } });
  if (out) ctx.rerender(`${out.label || out.id} saved`);
}
