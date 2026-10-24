import { esc } from './html.mjs';
import { icon, ICON_PATHS } from './icons.mjs';
import { uiBar } from './ui-actions.mjs';
import { pageOf, pager, wirePager, EDITOR_PAGE_SIZE } from './paging.mjs';

// Page templates and primitives: docs/UI_Guidelines.md. Text is escaped;
// action/body markup comes from trusted application renderers.
export const sentenceLabel = value => {
  const text = String(value ?? '').replace(/[-_]+/g, ' ').trim();
  return text ? text[0].toUpperCase() + text.slice(1) : '';
};

/**
 * A drawing made of small buttons (the run pipeline) is one visual cell of its row: measured as one column, never read as a
 * bar of controls. Put this attribute on the element that holds the drawing.
 */
export const VISUAL_CELL = 'data-ui-cell="visual"';

// ---- the controls a legacy markup string declares ------------------------------------------------------------------------
//
// Shared components take `actions` and `extra` as markup because their callers were written that way. A bar is built from
// declarations, so the markup is read back into them: a button, a select and a checkbox label are the whole vocabulary.
// Anything else, a control that is hidden, an id the builder cannot take, markup that is not one of the three, returns null
// and the component draws what it always drew, so a caller is never broken by the wrapper.

const unesc = t => String(t).replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
const slugOf = t => String(t).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const ID_OK = /^[A-Za-z][\w:.-]*$/;
function attrsIn(open) {
  const out = {};
  for (const m of open.replace(/^<\w+/, '').replace(/\/?>$/, '').matchAll(/([^\s=\/>"']+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)) out[m[1]] = unesc(m[2] ?? m[3] ?? m[4] ?? '');
  return out;
}
/** Everything but the hook attributes: data-*, aria-* (not the ones the builder writes) and a few plain names. */
function hooksOf(a, skip = []) {
  const out = {};
  for (const [k, v] of Object.entries(a)) {
    if (skip.includes(k) || /^(?:class|id|style|type|title|hidden|disabled|checked|selected|autofocus|name|value)$/.test(k) || /^on/i.test(k) || /^data-ui-/.test(k)) continue;
    if (/^aria-(?:label|haspopup|expanded|pressed)$/.test(k)) continue;
    out[k] = v === '' ? true : v;
  }
  return out;
}

/** Reads `markup` into { acts, filters, overflow, count }, or null when it holds anything the builders do not express. */
export function controlsOf(markup, base) {
  const text = String(markup ?? '');
  const TOKEN = /<button\b[^>]*>[\s\S]*?<\/button>|<select\b[^>]*>[\s\S]*?<\/select>|<label\b[^>]*>[\s\S]*?<\/label>/g;
  if (text.replace(TOKEN, '').trim()) return null;
  const acts = [], filters = [], overflow = [], icons = new Set(), ids = new Set();
  let primary = false;
  const idFor = (a, label) => {
    let id = a.id || `${base}-${slugOf(a['data-act'] || label) || 'item'}`;
    if (!ID_OK.test(id)) return null;
    for (let n = 2; ids.has(id); n++) id = `${id.replace(/-\d+$/, '')}-${n}`;
    ids.add(id); return id;
  };
  for (const m of text.matchAll(TOKEN)) {
    const tag = /^<(\w+)/.exec(m[0])[1], open = /^<[^>]*>/.exec(m[0])[0], a = attrsIn(open);
    if ('hidden' in a) return null;
    if (tag === 'button') {
      const inner = m[0].slice(open.length, -'</button>'.length);
      const marks = [...inner.matchAll(/data-icon="([^"]+)"/g)].map(x => x[1]);
      const words = unesc(inner.replace(/<svg[\s\S]*?<\/svg>/g, '').replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();
      const label = words || a['aria-label'] || a.title || '';
      if (!label) return null;
      const classes = (a.class || '').split(/\s+/).filter(Boolean);
      const id = idFor(a, label); if (!id) return null;
      let ico = marks.find(k => k !== 'chevron-down') || '';
      if (!ICON_PATHS[ico] || icons.has(ico)) ico = '';
      if (ico) icons.add(ico);
      const destructive = classes.includes('danger');
      const rest = classes.filter(c => !['primary', 'icon', 'danger', 'quiet'].includes(c) && /^[A-Za-z_][\w-]*$/.test(c));
      if (destructive) { overflow.push({ id, label, danger: true, attrs: hooksOf(a), cls: rest.join(' ') || undefined }); continue; }
      const role = classes.includes('primary') && !primary ? 'primary' : classes.includes('icon') || classes.includes('quiet') ? 'quiet' : 'secondary';
      if (role === 'primary') primary = true;
      acts.push({ id, label, icon: ico || undefined, role, keep: true, menu: 'aria-haspopup' in a || marks.includes('chevron-down'), disabled: 'disabled' in a, type: a.type === 'submit' ? 'submit' : 'button',
        pressed: 'aria-pressed' in a ? a['aria-pressed'] === 'true' : undefined, attrs: hooksOf(a), cls: rest.join(' ') || undefined });
    } else if (tag === 'select') {
      const label = a['aria-label'];
      if (!label) return null;
      const id = idFor(a, label); if (!id) return null;
      const options = [...m[0].matchAll(/<option\b([^>]*)>([\s\S]*?)<\/option>/g)].map(o => { const oa = attrsIn(`<option ${o[1]}>`); return { v: oa.value ?? unesc(o[2]), l: unesc(o[2].replace(/<[^>]+>/g, '')).trim(), on: 'selected' in oa }; });
      const dis = 'disabled' in a ? { disabled: true } : {};
      filters.push({ type: 'select', id, label, options: options.map(o => [o.v, o.l]), value: (options.find(o => o.on) || options[0])?.v, attrs: { ...hooksOf(a), ...dis } });
    } else {
      const c = /^<label\b[^>]*>\s*(<input\b[^>]*>)\s*<span[^>]*>([\s\S]*?)<\/span>\s*<\/label>$/.exec(m[0]);
      if (!c) return null;
      const ia = attrsIn(c[1]);
      const words = unesc(c[2].replace(/<[^>]+>/g, '')).trim();
      if (ia.type !== 'checkbox' || !words) return null;
      const id = idFor(ia, words); if (!id) return null;
      filters.push({ type: 'check', id, label: words, value: 'checked' in ia, attrs: { ...hooksOf(ia), ...('disabled' in ia ? { disabled: true } : {}) } });
    }
  }
  return { acts, filters, overflow, count: acts.length };
}

const legacyPageHeader = ({ title, back, actions, meta }) => `<header class="ui-page-head wf-bar">${back ? `<button class="wf-back ui-page-back" data-act="back" data-to="${esc(back[0])}" aria-label="Back to ${esc(back[1])}">${icon('chevron-left')}<span>${esc(back[1])}</span></button>` : ''}<h2 class="ui-page-title wf-title">${esc(title)}</h2>${meta ? `<span class="meta ui-page-meta">${esc(meta)}</span>` : ''}<div class="ui-page-actions wf-bar-actions">${actions}</div></header>`;

/**
 * A page header: back, title, the page's meta line and its actions. It is a head bar, so its actions never wrap: they lose
 * their labels, then stack as equal columns, by measurement. `actions` is a list of ActSpecs, or the markup older callers pass
 * (buttons, which are read back into declarations; none of them folds into More, so none can disappear from a page header).
 */
export function pageHeader({ title, back = null, actions = '', meta = '' }) {
  const list = Array.isArray(actions) ? { acts: actions, filters: [], overflow: [], count: actions.length } : controlsOf(actions, 'ph');
  if (!list || list.filters.length) return legacyPageHeader({ title, back, actions: Array.isArray(actions) ? '' : actions, meta });
  return uiBar({ kind: 'head', label: String(title || 'Page'), cls: 'ui-page-head', id: slugOf(`ph-${title}`) || undefined,
    lead: { title: String(title ?? ''), level: 'h1', back: back ? { to: back[0], label: 'Back' } : undefined },
    message: meta ? { text: String(meta) } : undefined,
    actions: list.acts, overflow: list.overflow.length ? list.overflow : undefined,
    budget: list.count > 4 ? { n: list.count, reason: 'the caller declares these actions' } : undefined });
}

/**
 * Expandable supplementary material. The summary reads, in one row that never moves a part onto a second one:
 * chevron, title, `count`, `meta`. The count is part of the title ("To do 65": a number or short text, always shown, never
 * pushed to the far edge); `meta` is a quiet line of text after it that is clipped with an ellipsis when the row is narrow, so
 * it can never take a second row or push the count away. Native details/summary keeps its keyboard and open state.
 */
export function disclosure({ id = '', title, count = null, meta = '', body, open = false, className = '', attrs = {} }) {   // attrs: a view's own data hooks on the details
  const counted = count != null && String(count) !== '';
  const extra = Object.entries(attrs || {}).filter(([k]) => /^data-[a-z0-9-]+$/.test(k)).map(([k, v]) => ` ${k}="${esc(v)}"`).join('');
  return `<details${id ? ` id="${esc(id)}"` : ''} class="ui-disclosure ${esc(className)}"${extra}${open ? ' open' : ''}><summary><span class="ui-disclosure-title">${esc(title)}</span>${counted ? `<span class="ui-disclosure-count">${esc(count)}</span>` : ''}${meta ? `<span class="meta ui-disclosure-meta">${esc(meta)}</span>` : ''}</summary><div class="ui-disclosure-body">${body}</div></details>`;
}

/**
 * Wide data in a named, keyboard-focusable scroll region. `sticky` keeps the first column in view while the rest scrolls
 * sideways and draws an edge shadow once something has slid under it (the shadow follows the region's own scroll, below),
 * so a narrow pane scrolls the table instead of losing its row names. The header row stays at the top of a region whose
 * height a caller bounds. The first column's cells need no markup of their own.
 */
/** `cue: false` drops the fade at the right edge: a grid people read like a spreadsheet shows its clipped last column as the cue. */
export function tableRegion({ label, html, sticky = false, cue = true }) {
  return `<div class="ui-table-region" role="region" aria-label="${esc(label)}" tabindex="0"${sticky ? ' data-sticky="first"' : ''}${cue ? '' : ' data-nocue'}>${html}</div>`;
}

/**
 * A table that is paged: the table scrolls sideways inside its own region and the pager (lib/paging.mjs `pager()`, passed as
 * `pager`) follows the region as one full-width foot. A pager inside the same scroller as a table wider than the pane scrolls away
 * with it, leaving a half-width block with its range and its first letters off screen; so a bare `<table>` and `pager()` are never
 * siblings in a `.panel-body`. `label`, `sticky` and `cue` are tableRegion's.
 */
export function pagedTable({ label, html, pager: pagerHtml = '', sticky = false, cue = true }) {
  return `${tableRegion({ label, html, sticky, cue })}${pagerHtml}`;
}

// The sticky column's shadow shows only while content is under it. Scroll does not bubble, so one capturing listener on the document
// serves every region, including those a view draws later; it reads the region's scrollLeft and writes one attribute. A second attribute
// (data-cue) says that columns lie beyond the right edge: the CSS fades the region's end, so a table cut at the pane's width reads as wider
// than it is. The browser tells when the region's last header cell is not wholly in view (an IntersectionObserver rooted at the region
// follows scroll, resize and a redrawn table alike), so nothing here measures a width.
const cued = new WeakSet();
/** Gives every sticky region under `root` its cue. A page gets it from enhancePageUi; a view that redraws only a region calls it on the new one. */
export function cueRegions(root) {
  if (typeof IntersectionObserver !== 'function') return;
  root?.querySelectorAll?.('.ui-table-region[data-sticky]:not([data-nocue])').forEach(region => {
    if (cued.has(region)) return;
    const last = region.querySelector('thead tr:last-child > :last-child') || region.querySelector('tr > :last-child');
    if (!last) return;
    cued.add(region);
    new IntersectionObserver(([e]) => region.toggleAttribute('data-cue', e.intersectionRatio < 0.98), { root: region, threshold: [0, 0.5, 0.98, 1] }).observe(last);
  });
}
if (typeof document !== 'undefined' && typeof document.addEventListener === 'function' && !globalThis.__lykosRegionScroll) {
  globalThis.__lykosRegionScroll = true;
  document.addEventListener('scroll', e => {
    const region = e.target;
    if (region?.nodeType === 1 && region.matches('.ui-table-region[data-sticky]')) region.toggleAttribute('data-scrolled', region.scrollLeft > 0);
  }, { capture: true, passive: true });
}

/**
 * A pressable word that goes somewhere (a record, a page): quiet at rest, with a hover fill and an optional icon after the label. A link is not a row
 * action (those are `uiRowEnd`) and not a command (those are builder buttons); legacy `button.link` markup takes the same look.
 * `attrs` pass data-* and aria-* hooks only; `breaks`: a long name may wrap after _ . -
 */
export function uiLink({ id = '', label, icon: name = '', title = '', attrs = {}, cls = '', breaks = false }) {
  const hooks = Object.entries(attrs || {}).filter(([k, v]) => /^(?:data|aria)-[a-z0-9-]+$/.test(k) && !/^data-ui-/.test(k) && v !== false && v != null)
    .map(([k, v]) => ` ${k}${v === true ? '' : `="${esc(v)}"`}`).join('');
  const classes = ['ui-link', 'link', /^[\w -]*$/.test(cls) ? cls : ''].filter(Boolean).join(' ');
  return `<button type="button" class="${esc(classes)}"${id ? ` id="${esc(id)}"` : ''}${title ? ` title="${esc(title)}"` : ''}${hooks}><span class="ui-link-label">${breaks ? esc(label).replace(/([_.-])/g, '$1<wbr>') : esc(label)}</span>${name ? icon(name, { size: 14 }) : ''}</button>`;
}

/**
 * A list of records where one of them is open for editing in place: a scrolling table region of one row per record, the
 * open record's editor in the row beneath it, and a pager of EDITOR_PAGE_SIZE (20) rows. A page of editors is never drawn:
 * 65 studies are 20 rows and, at most, one editor. The first column leads with the row's opener (a chevron button, aria-expanded);
 * the other columns are read-only cells, so the page is short, and the editor is the one place a value is typed.
 *   id         names the region and the pager (`${id}-pager`)
 *   label      the region's accessible name
 *   items      every record, in order; key(item) its stable id; title(item) its name for the opener's accessible name
 *   columns    [{ head, cell(item) -> html, num? , grow? }]; the first column's cell sits beside the opener
 *   selected   the key of the open record, or null; editor(item) -> html for the row beneath it
 *   page, size the page shown (default: the page holding the open record, else 1) and its length
 *   noun       what the pager counts ("studies"); empty is the html for no records
 * Returns { html, page, pages }; interpolating the result writes the html. Wire it once per render with wireEditorRows.
 */
export function editorRows({ id, label, items, key, title = item => key(item), columns, selected = null, editor, page, size = EDITOR_PAGE_SIZE, noun = 'rows', empty = '' }) {
  const list = Array.isArray(items) ? items : [];
  if (!list.length) return Object.freeze({ html: empty, page: 1, pages: 1, toString() { return empty; } });
  const at = selected == null ? -1 : list.findIndex(item => String(key(item)) === String(selected));
  const shown = pageOf(list, page ?? (at >= 0 ? Math.floor(at / size) + 1 : 1), size);
  const head = `<tr>${columns.map(c => `<th scope="col"${c.num ? ' class="num"' : ''}>${esc(c.head)}</th>`).join('')}</tr>`;
  const rows = shown.items.map(item => {
    const k = String(key(item)), open = selected != null && k === String(selected);
    const lead = `<button type="button" class="icon ui-edit-open" data-edit-row="${esc(k)}" aria-expanded="${open}" aria-label="${esc(`${open ? 'Close editor' : 'Edit'}: ${title(item)}`)}" title="${open ? 'Close editor' : 'Edit'}">${icon(open ? 'chevron-down' : 'chevron-right', { size: 14 })}</button>`;
    const cells = columns.map((c, i) => `<td${c.num ? ' class="num"' : c.grow ? ' class="grow"' : ''}>${i === 0 ? `<div class="ui-edit-lead">${lead}<div class="ui-edit-lead-text">${c.cell(item)}</div></div>` : c.cell(item)}</td>`).join('');
    const line = `<tr class="ui-edit-line" data-edit-key="${esc(k)}"${open ? ' data-edit-open' : ''}>${cells}</tr>`;
    return line + (open ? `<tr class="ui-edit-body"><td colspan="${columns.length}"><div class="ui-edit-panel" data-edit-panel="${esc(k)}">${editor(item)}</div></td></tr>` : '');
  }).join('');
  const html = `<div class="ui-edit-rows" id="${esc(id)}">${tableRegion({ label, sticky: true, html: `<table class="ui-edit-table"><thead>${head}</thead><tbody>${rows}</tbody></table>` })}${pager({ id: `${id}-pager`, page: shown.page, pages: shown.pages, total: list.length, label: noun, size })}</div>`;
  return Object.freeze({ html, page: shown.page, pages: shown.pages, toString() { return html; } });
}

/**
 * Wires what editorRows drew. onSelect(key | null) is called with the record to open, or null to close the open one (its opener
 * again, or Escape inside the editor); onPage(n) with the page asked for. The caller re-renders in them. Focus follows the press:
 * an opened editor takes it on its first control, a closed one returns it to its opener.
 */
export function wireEditorRows(root, id, { onSelect, onPage }) {
  const host = root.querySelector('#' + id);
  if (!host) return;
  const doc = root.ownerDocument || document;
  const opener = k => root.querySelector(`#${id} [data-edit-row="${CSS.escape(k)}"]`);
  const settle = find => { const go = () => find()?.focus({ preventScroll: true }); go(); if (!doc.activeElement || doc.activeElement === doc.body) requestAnimationFrame(go); };
  host.querySelectorAll('[data-edit-row]').forEach(b => b.onclick = () => {
    const k = b.dataset.editRow, closing = b.getAttribute('aria-expanded') === 'true';
    onSelect(closing ? null : k);
    settle(() => (closing ? null : root.querySelector(`#${id} [data-edit-panel="${CSS.escape(k)}"] :is(input,select,textarea,button):not(:disabled)`)) || opener(k));
  });
  host.addEventListener('keydown', e => {
    if (e.key !== 'Escape' || e.defaultPrevented) return;
    const panel = e.target.closest?.('[data-edit-panel]');
    if (!panel) return;
    const k = panel.dataset.editPanel;
    e.preventDefault(); e.stopPropagation();
    onSelect(null);
    settle(() => opener(k));
  });
  wirePager(root, `${id}-pager`, n => onPage(n));
}

export function metadataLine(parts) {
  return `<span class="meta ui-metadata-line">${esc(parts.filter(Boolean).join(', '))}</span>`;
}

/** Stacked labels must not inherit the horizontal field's 150px flex basis. */
export function formField(label, control, { span = 1 } = {}) {
  return `<label class="field ui-field"${span === 2 ? ' data-span="2"' : ''}><span>${esc(label)}</span>${control}</label>`;
}

/**
 * The column counts an analysis form (.an-settings) may take, from its cells in order (a number of one-cell fields, or each field's
 * span: 1, or 2 for a field declared wide). A count is kept when the fields, packed densely as the form packs them, leave at most one
 * empty cell in the last row and never put one field alone in a row of three or more. Returns the attribute for the form's element
 * (' data-fit="2-4"'); ui-components.css turns it into the grid. Two columns is always allowed: it is the narrowest form.
 */
export function formFit(cells) {
  const spans = Array.isArray(cells) ? cells : Array.from({ length: cells }, () => 1);
  const ok = c => {
    const rows = [];   // free cells per row, filled in order with a later field taking an earlier hole (grid-auto-flow: dense)
    for (const w of spans) { const at = rows.findIndex(f => f >= Math.min(w, c)); if (at >= 0) rows[at] -= Math.min(w, c); else rows.push(c - Math.min(w, c)); }
    if (rows.length < 2) return true;
    const last = c - rows.at(-1);
    return rows.slice(0, -1).every(f => f === 0) && rows.at(-1) <= 1 && !(last === 1 && c >= 3);
  };
  const fit = ok(4) ? (ok(3) ? '4' : '2-4') : ok(3) ? '3' : '2';
  return ` data-fit="${fit}"`;
}
/** The spans of a form's fields, from its html: a wide field (data-span="2") is two cells; a check beside the fields is one. */
export const formCells = html => (String(html).match(/<label class="(?:field|cr-check)[^"]*"(?: data-span="2")?/g) || []).map(m => (m.includes('data-span="2"') ? 2 : 1));

/** Counts belong to their title, rather than a separate stacked-header cell. */
export function countHeading({ title, count, countLabel = '' }) {
  return `<h2 class="ui-count-heading"><span class="ui-count-title">${esc(title)}</span> <span class="ui-heading-count"${countLabel ? ` aria-label="${esc(countLabel)}: ${esc(count)}"` : ''}>${esc(count)}</span></h2>`;
}

/** A short workflow overview, distinct from a long record collection. */
export function stageSummary(items) {
  return `<div class="ui-stage-summary">${items.map(item => `<button type="button" data-go="${esc(item.key)}" data-state="${esc(item.state)}">${icon(item.icon || 'file', { size: 18 })}<span class="ui-stage-text"><strong>${esc(item.name)}</strong><span class="meta">${esc(item.line)}</span></span>${icon(item.state === 'done' ? 'check' : 'chevron-right', { size: 16 })}</button>`).join('')}</div>`;
}

// Existing pages use the same disclosure treatment while they migrate to
// the renderer. Preserve native keyboard/open semantics and child controls.
export function enhancePageUi(root) {
  const shellTitle = document.getElementById('topbar-title')?.textContent.trim();
  root.querySelectorAll('.ui-page-back>span').forEach(span => { span.hidden = span.textContent.trim() === shellTitle; });
  root.querySelectorAll('table thead th:not([scope])').forEach(th => th.setAttribute('scope', th.colSpan > 1 ? 'colgroup' : 'col'));
  root.querySelectorAll('table tbody th:not([scope])').forEach(th => th.setAttribute('scope', th.rowSpan > 1 ? 'rowgroup' : 'row'));
  root.querySelectorAll('details').forEach(d => d.classList.add('ui-disclosure'));
  cueRegions(root);
  root.querySelectorAll('.panel-body:has(>table),.out-table-wrap').forEach(el => {
    el.classList.add('ui-table-region');
    el.tabIndex = 0; el.setAttribute('role', 'region');
    if (!el.hasAttribute('aria-label')) el.setAttribute('aria-label', `${el.closest('.panel,.out-group')?.querySelector('h2,h3')?.textContent.trim() || 'Data'} table`);
  });
}
