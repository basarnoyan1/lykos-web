// The Data summary's measures read through the person's measure library (lib/measure-library.mjs): the measures every field holds, under
// the library's headings across fields (Cobb, SVA and PI–LL of one field and another read together under Radiographic), each under the
// library's name and unit with its studies a press away, and the values outside its plausible range as cells to check. The measures the
// library does not know are listed last, with Add to library: name, type and unit come from the data, and only which way is better and
// the heading are chosen, one measure or all of them at once. Drawn by views/extraction-summary.mjs, which owns the page and its drills.
import { library, saveLibrary, addMeasures, byGroup, draftOf, groupNames, rangeText, BETTER_WORDS } from '../lib/measure-library.mjs';
import { measureLine } from '../lib/extraction-summary-view.mjs';
import { uiList, uiRow, uiRowEnd, uiBar } from '../lib/ui-actions.mjs';
import { uiLink, disclosure } from '../lib/ui-components.mjs';
import { ask } from '../lib/dialog.mjs';
import { showMenu } from '../lib/menu.mjs';
import { icon } from '../lib/icons.mjs';
import { esc } from '../lib/html.mjs';
import { plural, num } from '../lib/dates.mjs';

// What is being added, by measure: { better, group }; kept while the page repaints. `drawn` is what the block last drew from.
const adding = new Map(), newGroups = new Set(), NEW = 'lykos:new-group';
let drawn = { unknown: [] }, unknownOpen = false;   // the list of measures to learn is folded until opened (or while some are being added)

const nameOf = (name, unit) => (unit ? `${name} (${unit})` : name);
/** A heading a field's label suggests ("Radiographic outcome: Cobb, SVA" -> "Radiographic outcome"). */
const fieldHeading = label => { const t = String(label || '').split(/\s*[(:;,]/)[0].trim(); return t ? t.charAt(0).toUpperCase() + t.slice(1) : ''; };
/** The heading a new measure starts with: the one the library gives a measure of the same field, else the field's. */
function startGroup(u) {
  const known = (u.field.measures?.measures || []).find(m => m.entry?.group);
  return known ? known.entry.group : fieldHeading(u.field.label);
}

/**
 * The block above the field table, or '' when no field holds measures. `reg` is the page's registry of drills (each count opens its
 * studies through the page's own handler); `title(f)` names a field as the page does.
 */
export function measuresBlock(summary, reg, { title = f => f.label } = {}) {
  const fields = summary.fields.filter(f => f.kind === 'measures');
  if (!fields.length) { drawn = { unknown: [] }; return ''; }
  const lib = library(), { groups, unknown } = byGroup(lib, fields);
  drawn = { unknown };
  for (const k of [...adding.keys()]) if (!unknown.some(u => u.key === k)) adding.delete(k);
  let n = 0;
  const link = (count, label, field, items) => {
    const id = `lib-${n++}`; reg.drills.set(id, { fieldId: field.id, fieldLabel: title(field), label, items });
    return uiLink({ label: num(count), title: `Show the ${plural(count, 'study', 'studies')}`, attrs: { 'data-es-drill': id, 'aria-label': `${plural(count, 'study', 'studies')}: ${label}` } });
  };
  const reserve = () => uiRowEnd({ reserve: true });
  const cellsOf = list => list.map(s => ({ paperId: s.paperId, cell: s.cell, text: s.text }));
  const known = groups.map(g => {
    const rows = g.rows.flatMap(({ field, measure: m, entry }) => [
      uiRow({ main: { html: esc(nameOf(entry.name, entry.unit)), detail: [esc(measureLine(m)), esc(title(field))], wrap: true }, cells: [{ col: 'count', kind: 'control', html: link(m.studies.length, entry.name, field, cellsOf(m.studies)) }], end: uiRowEnd({ more: { label: `More for ${entry.name}`, attrs: { 'data-es-lib-more': entry.id } } }) }),
      ...(m.outside.length ? [uiRow({ depth: 1, main: { html: `<span class="es-check">${icon('warn', { size: 12 })}<span>${esc(`Outside ${rangeText(entry)}`)}</span></span>` },
        cells: [{ col: 'count', kind: 'control', html: link(m.outside.length, `${entry.name}: outside ${rangeText(entry)}`, field, m.outside) }], end: reserve() })] : [])]);
    const head = g.group || 'No group';
    return `<div class="es-group" role="group" aria-label="${esc(head)}"><p class="es-group-title">${esc(head)}</p>${uiList({ id: `es-lib-${n++}`, label: `Measures: ${head}`, cols: ['count'], rows })}</div>`;
  }).join('');
  return `<div class="es-lib" role="region" aria-label="Measures">${known}${unknownHtml(unknown, lib)}</div>`;
}

function unknownHtml(unknown, lib) {
  if (!unknown.length) return '';
  const rest = unknown.filter(u => !adding.has(u.key)), chosen = unknown.filter(u => adding.has(u.key));
  const heads = [...new Set([...groupNames(lib), ...newGroups, ...unknown.map(startGroup)].filter(Boolean))];
  const detail = u => [esc(measureLine(u.measure))];
  const select = (attr, key, label, value, options) => `<select data-es-lib-${attr}="${esc(key)}" aria-label="${esc(label)}">${options.map(([v, t]) => `<option value="${esc(v)}"${v === value ? ' selected' : ''}>${esc(t)}</option>`).join('')}</select>`;
  const out = [];
  if (chosen.length) {
    out.push(uiList({ id: 'es-lib-adding', label: 'Measures to add', cols: ['better', 'group'], rows: chosen.map(u => { const c = adding.get(u.key), name = u.measure.name;
      return uiRow({ main: { html: esc(nameOf(name, draftOf(u.measure).unit)), detail: detail(u), wrap: true }, cells: [
        { col: 'better', kind: 'control', html: select('better', u.key, `Which way is better: ${name}`, c.better, [['', BETTER_WORDS['']], ['lower', BETTER_WORDS.lower], ['higher', BETTER_WORDS.higher]]) },
        { col: 'group', kind: 'control', html: select('group', u.key, `Group: ${name}`, c.group, [['', 'No group'], ...heads.map(h => [h, h]), [NEW, 'New group…']]) }] }); }) }));
    out.push(uiBar({ kind: 'foot', label: 'Add to library', id: 'es-lib-foot', actions: [{ id: 'es-lib-cancel', label: 'Cancel', role: 'secondary' }, { id: 'es-lib-confirm', label: `Add ${plural(chosen.length, 'measure')}`, role: 'primary', icon: 'library-add' }] }));
  }
  if (rest.length) out.push(uiList({ id: 'es-lib-new', label: 'Measures not in your library', cols: ['add'], rows: rest.map(u => uiRow({ main: { html: esc(nameOf(u.measure.name, draftOf(u.measure).unit)), detail: detail(u), wrap: true },
    cells: [{ col: 'add', kind: 'control', html: `<button type="button" class="ui-act" data-es-lib-add="${esc(u.key)}" aria-label="${esc(`Add ${u.measure.name} to library`)}">Add to library</button>` }] })) }));
  if (rest.length > 1) out.push(uiBar({ kind: 'foot', label: 'Add every measure', id: 'es-lib-all-foot', actions: [{ id: 'es-lib-add-all', label: `Add ${plural(rest.length, 'measure')}`, icon: 'library-add', role: 'secondary' }] }));
  return disclosure({ id: 'es-lib-unknown-d', className: 'es-lib-unknown', title: 'Not in your library', count: num(unknown.length), body: out.join(''), open: unknownOpen || chosen.length > 0 });
}

/** Wires the block's controls on the page just drawn. `rerender` draws the page again; `say` reports in the status bar; `go` opens a page. */
export function wireMeasures(page, { rerender, say = () => {}, go = () => {} }) {
  page.querySelectorAll('[data-es-lib-more]').forEach(b => b.addEventListener('click', () => showMenu(b, [{ label: 'Edit in library', icon: 'rename',
    run: () => import('./settings.mjs').then(m => { m.showMeasures(b.dataset.esLibMore); go('settings'); }) }], { align: 'end' })));
  const choose = list => { for (const u of list) if (!adding.has(u.key)) adding.set(u.key, { better: '', group: startGroup(u) }); rerender(); };
  page.querySelector('#es-lib-unknown-d')?.addEventListener('toggle', e => { unknownOpen = e.currentTarget.open; });
  page.querySelector('#es-lib-add-all')?.addEventListener('click', () => choose(drawn.unknown));
  page.querySelectorAll('[data-es-lib-add]').forEach(b => b.addEventListener('click', () => choose(drawn.unknown.filter(u => u.key === b.dataset.esLibAdd))));
  page.querySelector('#es-lib-cancel')?.addEventListener('click', () => { adding.clear(); rerender(); });
  page.querySelectorAll('[data-es-lib-better]').forEach(s => s.addEventListener('change', () => { const c = adding.get(s.dataset.esLibBetter); if (c) c.better = s.value; }));
  page.querySelectorAll('[data-es-lib-group]').forEach(s => s.addEventListener('change', async () => {
    const c = adding.get(s.dataset.esLibGroup); if (!c) return;
    if (s.value !== NEW) { c.group = s.value; return; }
    const name = (await ask('New group', { placeholder: 'Group', confirm: 'Add' }))?.trim();
    if (name) { newGroups.add(name); c.group = name; }
    rerender();
  }));
  page.querySelector('#es-lib-confirm')?.addEventListener('click', () => {
    const drafts = drawn.unknown.filter(u => adding.has(u.key)).map(u => ({ ...draftOf(u.measure), better: adding.get(u.key).better || null, group: adding.get(u.key).group }));
    const { library: next, added } = addMeasures(library(), drafts);
    if (!saveLibrary(next)) { say('The library was not saved: this window cannot keep data'); return; }
    adding.clear(); newGroups.clear();
    say(`Added ${plural(added.length, 'measure')} to your library`);
    rerender();
  });
}
