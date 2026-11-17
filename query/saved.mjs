// Saved queries (query.html, Saved): a query's text, or the builder's tree, kept under a name in this browser (localStorage) for the
// next visit, the most recently used first and at most SAVED_CAP of them (the least recently used goes first). Every read and write is
// guarded: a private window or a full store keeps nothing, and the caller says so. Nothing is sent anywhere.
import { lib_ui_actions$uiList as uiList, lib_ui_actions$uiRow as uiRow, lib_ui_actions$uiRowEnd as uiRowEnd } from "../boot.mjs";
import { lib_dates$day as day } from "../boot.mjs";
import { DIALECT_NAMES } from '../lib/query-syntax.mjs';

export const SAVED_KEY = 'lykos.query.saved';
export const SAVED_CAP = 100;
const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// an item: { id, name, kind: 'text' | 'build', text | tree, dialect (the Database choice, '' to detect), db (the database it was read as),
// savedAt, usedAt }
const valid = x => !!x && typeof x.id === 'string' && typeof x.name === 'string'
  && (x.kind === 'text' ? typeof x.text === 'string' : x.kind === 'build' && x.tree?.kind === 'all' && Array.isArray(x.tree.items));
const used = x => x.usedAt || x.savedAt || 0;
const newest = list => list.sort((a, b) => used(b) - used(a));

/** The saved queries, the most recently used first; [] when nothing is kept or it cannot be read. */
export function readSaved() {
  try {
    const list = JSON.parse(localStorage.getItem(SAVED_KEY) || '[]');
    return Array.isArray(list) ? newest(list.filter(valid)) : [];
  } catch { return []; }
}
// the list kept, past the cap the least recently used left out; false when this browser keeps nothing
function write(list) {
  try { localStorage.setItem(SAVED_KEY, JSON.stringify(newest(list).slice(0, SAVED_CAP))); return true; } catch { return false; }
}
// a change to one item, kept; false when it is gone or nothing could be kept
function change(id, fn) {
  const list = readSaved(), x = list.find(y => y.id === id);
  if (!x) return false;
  fn(x);
  return write(list);
}

// the same query: the same text read the same way, or the same tree
const same = (a, b) => a.kind === b.kind && (a.kind === 'text' ? a.text === b.text && (a.dialect || '') === (b.dialect || '') : JSON.stringify(a.tree) === JSON.stringify(b.tree));
/** The saved item holding this query ({ kind, text | tree, dialect }), or null. */
export const findSaved = q => readSaved().find(x => same(x, q)) || null;

/**
 * Keeps query `q` ({ kind, text | tree, dialect, db }) under `name`. The same query saved before is renamed and moved to the top rather
 * than kept twice. Returns the item, or null when this browser keeps nothing.
 */
export function saveQuery(q, name, now = Date.now()) {
  const list = readSaved(), old = list.find(x => same(x, q));
  const body = q.kind === 'text' ? { text: q.text, dialect: q.dialect || '', db: q.db || '' } : { tree: q.tree, dialect: '', db: '' };
  const item = { id: old?.id || `q${now.toString(36)}${Math.random().toString(36).slice(2, 6)}`, name, kind: q.kind, ...body, savedAt: now, usedAt: now };
  return write([item, ...list.filter(x => x !== old)]) ? item : null;
}
/** Marks an item opened now (it goes to the top). */
export const useSaved = (id, now = Date.now()) => change(id, x => { x.usedAt = now; });
export const renameSaved = (id, name) => change(id, x => { x.name = name; });
export function removeSaved(id) {
  const list = readSaved(), rest = list.filter(x => x.id !== id);
  return rest.length < list.length && write(rest);
}

// a concept's first words: the first two a block keeps (what a But not takes away, and #n references, are not words of it)
function firstWords(b, out) {
  if (!b || out.length >= 2) return out;
  if (b.kind === 'term') { const w = String(b.text || '').trim(); if (w) out.push(w); }
  else if (b.kind !== 'line' && b.kind !== 'not') for (const c of b.items || []) firstWords(c, out);
  return out;
}
/** The first two words the blocks keep, in order. */
export const wordsOf = blocks => blocks.reduce((out, b) => firstWords(b, out), []);
const clip = (s, n = 48) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);
/** Where a saved query searches: the database its text was read as; a built search is written for every database. */
export const savedWhere = x => (x.kind === 'build' ? 'All databases' : DIALECT_NAMES[x.db] || DIALECT_NAMES[x.dialect] || 'Query');
/** The name a query is offered under: its database and its first concept's first words ("PubMed: deep brain stimulation, DBS"). */
export function defaultName(q, blocks = []) {
  const out = wordsOf(blocks), where = savedWhere(q);
  return out.length ? `${where}: ${clip(out.join(', '))}` : where;
}

/** The Saved list: a query's name (pressed, it opens), its database and the day it was saved; Rename and Delete are in its More. */
export function savedHtml(list, note = '') {
  return `${note ? `<p class="qv-saved-note" role="status">${esc(note)}</p>` : ''}${uiList({ id: 'qv-saved-list', label: 'Saved queries', cols: ['date'],
    rows: list.map(x => uiRow({ attrs: { 'data-saved': x.id },
      main: { html: `<button type="button" class="tk-text" data-qs-open="${esc(x.id)}" title="${esc(x.name)}">${esc(x.name)}</button>`, detail: [esc(savedWhere(x))] },
      cells: [{ col: 'date', kind: 'text', ch: 12, html: esc(day(x.savedAt)) }],
      end: uiRowEnd({ more: { label: `More for ${x.name}`, attrs: { 'data-qs-more': x.id } } }) })),
    empty: '<p class="qv-saved-empty">No saved queries</p>' })}`;
}
