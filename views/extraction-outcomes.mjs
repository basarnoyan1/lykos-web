// The extraction grid's outcome dialogs (plan G3a): add an outcome to a study, or code an outcome's instrument again. Opened from a study's
// More menu; the writes are lib/outcome-edit.mjs's, a person's own values through the cell-write path. Loaded on first use.
import { store$get as get } from "../boot.mjs";
import { lib_html$esc as esc } from "../boot.mjs";
import { lib_ui_components$formField as formField } from "../boot.mjs";
import { lib_dialog$formDialog as formDialog } from "../boot.mjs";
import { registry } from '../lib/instruments.mjs';
import { entriesOf } from '../lib/outcome-store.mjs';
import { entryLines } from './extraction-arms.mjs';
import { addOutcome, recodeOutcome } from '../lib/outcome-edit.mjs';

// the instruments a person may choose, by name, each with its full name: the built-in list and the project's own (Scales adds them)
const instrumentOptions = (s, chosen = '') => [...registry(s)].sort((a, b) => a.label.localeCompare(b.label))
  .map(x => `<option value="${esc(x.code)}"${x.code === chosen ? ' selected' : ''}>${esc(x.name && x.name !== x.label ? `${x.label} (${x.name})` : x.label)}</option>`).join('');
const studyName = p => p.label || p.title || 'this study';

/** Adds an outcome to the study: its instrument and its time point. `say` reports a refusal on the page. */
export async function addOutcomeDialog(table, p, { double = null, say = () => {} } = {}) {
  const s = get();
  const out = await formDialog({ id: 'ext-add-outcome', title: `Add an outcome to ${studyName(p)}`, confirm: 'Add',
    body: formField('Instrument', `<select name="instrument" required><option value="">Choose…</option>${instrumentOptions(s)}</select>`) + formField('Time point', '<input name="time" placeholder="As the paper words it">'),
    submit: form => (form.elements.instrument.value ? { instrument: form.elements.instrument.value, time: form.elements.time.value } : undefined) });
  if (!out) return;
  const r = addOutcome(table, p.id, out, { double });
  if (r.problem) say(r.problem);
}

/** Codes one of the study's outcomes to another instrument, in every arm's cell of it. */
export async function recodeOutcomeDialog(table, p, { double = null, say = () => {} } = {}) {
  const s = get(), t = (s.templates || []).find(x => x.id === table);
  const shown = new Set(entriesOf(t, p.id).filter(e => !e.none).map(e => e.id));
  const named = [...new Map(entryLines(s, t, p.id).filter(l => shown.has(l.entry)).map(l => [l.entry, l.name.split('; ')[0]])).entries()];
  if (!named.length) return;
  const codeOf = entry => { const base = `${p.id}:${table}.out_instrument~${entry}`;
    const k = Object.keys(s.values || {}).find(x => (x === base || x.startsWith(`${base}@`)) && s.values[x]?.availability !== 'not_found');
    return k ? String(s.values[k].normalized_value ?? '') : ''; };
  const out = await formDialog({ id: 'ext-recode-outcome', title: `Recode an outcome of ${studyName(p)}`, confirm: 'Recode',
    body: formField('Outcome', `<select name="entry">${named.map(([id, name]) => `<option value="${esc(id)}">${esc(name)}</option>`).join('')}</select>`)
      + formField('Instrument', `<select name="instrument" required><option value="">Choose…</option>${instrumentOptions(s, codeOf(named[0][0]))}</select>`),
    onMount: d => { const f = d.querySelector('form'); f.elements.entry.onchange = () => { f.elements.instrument.value = codeOf(f.elements.entry.value); }; },
    submit: form => (form.elements.instrument.value ? { entry: form.elements.entry.value, instrument: form.elements.instrument.value } : undefined) });
  if (!out) return;
  const why = recodeOutcome(table, p.id, out.entry, out.instrument, { double });
  if (why) say(why);
}
