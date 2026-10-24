// Settings > Measures: the person's measure library (lib/measure-library.mjs), kept on this machine for every project. One row per
// measure with its group, type, unit, which way is better and its plausible range; the open row's editor beneath it (editorRows), with
// Merge into (the other entry's names become synonyms of this one) and Remove. The library learns from the Data summary's Add to library;
// Import common measures adds the seed under assets/measures only when asked.
import { library, saveLibrary, updateMeasure, removeMeasure, mergeMeasures, importMeasures, seedMeasures, normaliseLibrary, groupNames, rangeText, TYPES, TYPE_WORDS, BETTER_WORDS } from '../lib/measure-library.mjs';
import { measureVisuals, genericVisual } from '../lib/measure-visuals.mjs';
import '../lib/measure-visuals-generic.mjs';
import { editorRows, wireEditorRows, formField, formFit, formCells } from '../lib/ui-components.mjs';
import { uiBar } from '../lib/ui-actions.mjs';
import { confirmAsk } from '../lib/dialog.mjs';
import { showMenu } from '../lib/menu.mjs';
import { esc, emptyState } from '../lib/html.mjs';
import { plural } from '../lib/dates.mjs';

let open = null, page;   // the measure open for editing, the list's page
/** Opens the section with one measure's editor open (the Data summary's Edit in library). */
export function openMeasure(id) { open = id || null; page = undefined; }

const field = (name, value, label, attrs = '') => formField(label, `<input type="text" name="${name}" value="${esc(value ?? '')}" spellcheck="false" autocomplete="off"${attrs}>`);
const num = (name, value, label) => field(name, value == null ? '' : String(value), label, ' inputmode="decimal"');
const select = (name, value, label, options) => formField(label, `<select name="${name}">${options.map(([v, t]) => `<option value="${esc(v)}"${String(v) === String(value ?? '') ? ' selected' : ''}>${esc(t)}</option>`).join('')}</select>`);

function editor(m, lib) {
  const visuals = measureVisuals(m.type), groups = groupNames(lib);
  const body = [
    field('name', m.name, 'Name'), field('synonyms', m.synonyms.join('; '), 'Other names'),
    select('type', m.type, 'Type', TYPES.map(t => [t, TYPE_WORDS[t]])), field('unit', m.unit, 'Unit'),
    select('better', m.better || '', 'Better', [['', BETTER_WORDS['']], ['lower', BETTER_WORDS.lower], ['higher', BETTER_WORDS.higher]]),
    field('group', m.group, 'Group', ` list="ms-groups"`),
    num('rangeMin', m.range?.[0], 'Lowest plausible'), num('rangeMax', m.range?.[1], 'Highest plausible'),
    num('scaleMin', m.scale?.min, 'Scale from'), num('scaleMax', m.scale?.max, 'Scale to'),
    select('visual', visuals.some(v => v.id === m.visual) ? m.visual : 'auto', 'Visual', [['auto', 'Generic'], ...visuals.filter(v => v.id !== genericVisual(m.type)).map(v => [v.id, v.label])]),
    field('note', m.note, 'Note'),
  ].join('');
  return `<form class="an-settings ms-form" data-ms-form="${esc(m.id)}"${formFit(formCells(body))}>${body}</form><datalist id="ms-groups">${groups.map(g => `<option value="${esc(g)}">`).join('')}</datalist>
    ${uiBar({ kind: 'foot', label: `Edit ${m.name}`, id: 'ms-edit-foot', start: [{ id: 'ms-remove', label: 'Remove', icon: 'trash', role: 'destructive' }],
      actions: [{ id: 'ms-merge', label: 'Merge into', icon: 'merge', menu: true, disabled: lib.measures.length < 2 }, { id: 'ms-cancel', label: 'Cancel', keep: true }, { id: 'ms-save', label: 'Save', role: 'primary' }] })}`;
}

/** The section's body. `srow` is Settings' row builder. */
export function measuresBody(srow) {
  const lib = library(), groups = groupNames(lib);
  const rows = editorRows({ id: 'ms-rows', label: 'Measures', noun: 'measures', items: lib.measures, key: m => m.id, title: m => m.name, selected: open, page,
    columns: [
      { head: 'Measure', cell: m => `<div>${esc(m.name)}</div>${m.synonyms.length ? `<div class="meta">${esc(m.synonyms.join(', '))}</div>` : ''}` },
      { head: 'Group', cell: m => esc(m.group) },
      { head: 'Unit', cell: m => esc(m.unit) },
      { head: 'Better', cell: m => esc(m.better ? m.better.charAt(0).toUpperCase() + m.better.slice(1) : '') },
      { head: 'Plausible', cell: m => esc(rangeText(m)) },
    ],
    editor: m => editor(m, lib), empty: emptyState({ icon: 'scale', title: 'No measures yet', detail: 'Add measures from a Data summary, or import common ones', size: 'inline' }) });
  return `${srow('Library', { desc: lib.measures.length ? `${plural(lib.measures.length, 'measure')}${groups.length ? ` in ${plural(groups.length, 'group')}` : ''}` : 'None yet', live: { id: 'ms-count' },
    find: 'measure library units ranges cobb outcome scales synonyms', actions: [{ id: 'ms-import-common', label: 'Import common measures', icon: 'import' }],
    overflow: [{ id: 'ms-import-file', label: 'Import from file…' }, { id: 'ms-export', label: 'Export…', disabled: !lib.measures.length }] })}
    <div class="ms-list">${rows}</div>`;
}

const finiteOr = v => { const t = String(v ?? '').trim().replace(',', '.'); return t === '' || !Number.isFinite(Number(t)) ? null : Number(t); };
/** The form's values as an entry patch. */
function patchOf(form) {
  const v = Object.fromEntries(new FormData(form));
  const lo = finiteOr(v.scaleMin), hi = finiteOr(v.scaleMax);
  return { name: v.name, synonyms: String(v.synonyms || '').split(/\s*;\s*/), type: v.type, unit: v.unit, better: v.better || null, group: v.group,
    range: [finiteOr(v.rangeMin), finiteOr(v.rangeMax)], scale: lo != null && hi != null ? { min: lo, max: hi } : null, visual: v.visual, note: v.note };
}

/** Wires the section. `ctx.rerender` draws Settings again; `say` reports what happened. */
export function wireMeasureLibrary(el, ctx) {
  if (!el.querySelector('#ms-rows') && !el.querySelector('#ms-import-common')) return;
  const redraw = () => ctx.rerender();
  const say = msg => { const out = el.querySelector('#ms-count'); if (out) out.textContent = msg; };
  const save = (next, msg) => { if (!saveLibrary(next)) { say('Not saved: this window cannot keep data'); return false; } redraw(); if (msg) queueMicrotask(() => say(msg)); return true; };
  wireEditorRows(el, 'ms-rows', { onSelect: k => { open = k; redraw(); }, onPage: n => { page = n; open = null; redraw(); } });
  // an addon's visuals are listed once the addons are here
  const sel = el.querySelector('[data-ms-form] select[name=visual]'), type = el.querySelector('[data-ms-form] select[name=type]')?.value;
  if (sel) import('../lib/addons.mjs').then(a => a.loadAddons()).then(() => { if (el.isConnected && sel.isConnected && measureVisuals(type).length !== sel.options.length) redraw(); }, () => {});
  const form = el.querySelector('[data-ms-form]'), id = form?.dataset.msForm;
  if (form) {
    form.onsubmit = e => { e.preventDefault(); el.querySelector('#ms-save')?.click(); };
    el.querySelector('#ms-save')?.addEventListener('click', () => { const p = patchOf(form); if (!String(p.name).trim()) { form.querySelector('[name=name]')?.focus(); return; } open = null; save(updateMeasure(library(), id, p), `Saved ${p.name.trim()}`); });
    el.querySelector('#ms-cancel')?.addEventListener('click', () => { open = null; redraw(); });
    el.querySelector('#ms-remove')?.addEventListener('click', async () => {
      const m = library().measures.find(x => x.id === id); if (!m) return;
      if (!await confirmAsk(`Remove ${m.name}?`, { detail: 'It leaves your library; no project value changes', confirm: 'Remove', danger: true })) return;
      open = null; save(removeMeasure(library(), id), `Removed ${m.name}`);
    });
    el.querySelector('#ms-merge')?.addEventListener('click', e => {
      const lib = library(), m = lib.measures.find(x => x.id === id);
      showMenu(e.currentTarget, lib.measures.filter(x => x.id !== id).map(x => ({ label: x.name, meta: x.group, run: () => { open = x.id; save(mergeMeasures(lib, x.id, id), `${m.name} merged into ${x.name}`); } })), { align: 'start' });
    });
  }
  el.querySelector('#ms-import-common')?.addEventListener('click', async e => {
    const b = e.currentTarget; b.disabled = true;
    try { const { library: next, added } = importMeasures(library(), await seedMeasures()); save(next, added.length ? `Imported ${plural(added.length, 'measure')}` : 'Every common measure is already in your library'); }
    catch (err) { say(err.message); b.disabled = false; }
  });
  el.querySelector('#ms-export')?.addEventListener('click', async () => {
    const { saveFile } = await import('../lib/save.mjs');
    saveFile(new Blob([JSON.stringify(library(), null, 2)], { type: 'application/json' }), 'lykos-measures.json', 'application/json');
  });
  el.querySelector('#ms-import-file')?.addEventListener('click', () => {
    const input = Object.assign(document.createElement('input'), { type: 'file', accept: '.json,application/json' });
    input.onchange = async () => {
      try { const { library: next, added } = importMeasures(library(), normaliseLibrary(JSON.parse(await input.files[0].text()))); save(next, added.length ? `Imported ${plural(added.length, 'measure')}` : 'Every measure in the file is already in your library'); }
      catch (err) { say(`Not imported: ${err.message}`); }
    };
    input.click();
  });
}
