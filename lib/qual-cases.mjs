// Cases and their attributes in the coding workspace (lib/qual.mjs): a case is
// a unit of analysis (a participant, a site), with typed attributes; documents
// belong to a case, and in a transcript each speaker may belong to one. A
// survey's free-text answers become a corpus here: one case per respondent,
// one document per non-empty open answer, the closed answers as attributes.
import { qualOf, readQual, uid, addDocument, editText, pruneFramework } from './qual.mjs';
import { cellValue } from './datasets.mjs';

export const ATTRIBUTE_TYPES = [['text', 'Text'], ['number', 'Number'], ['category', 'Category']];
const clean = t => String(t ?? '').replace(/\s+/g, ' ').trim();
const key = t => clean(t).toLowerCase();

export function addCase(s, label) {
  const q = qualOf(s), name = clean(label).slice(0, 120);
  if (!name) return null;
  const found = q.cases.find(c => key(c.label) === key(name));
  if (found) return found.id;
  const c = { id: uid('p'), label: name, attributes: {} };
  q.cases.push(c);
  return c.id;
}
export function renameCase(s, id, label) {
  const q = qualOf(s), c = q.cases.find(x => x.id === id), name = clean(label);
  if (!c || !name || q.cases.some(x => x.id !== id && key(x.label) === key(name))) return false;
  c.label = name; return true;
}
/** Removes cases; their documents and speakers stay, unlinked. */
export function removeCases(s, ids) {
  const q = qualOf(s), gone = new Set(ids);
  q.cases = q.cases.filter(c => !gone.has(c.id));
  for (const d of q.documents) {
    if (gone.has(d.caseId)) d.caseId = null;
    for (const [k, v] of Object.entries(d.speakers || {})) if (gone.has(v)) delete d.speakers[k];
  }
  q.memos = q.memos.filter(m => !(m.kind === 'case' && gone.has(m.target)));
  pruneFramework(q);
}

export function addAttribute(s, label, type = 'text') {
  const q = qualOf(s), name = clean(label).slice(0, 80);
  if (!name) return null;
  const found = q.attributes.find(a => key(a.label) === key(name));
  if (found) return found.id;
  const a = { id: uid('a'), label: name, type: ATTRIBUTE_TYPES.some(([t]) => t === type) ? type : 'text' };
  q.attributes.push(a);
  return a.id;
}
export function removeAttribute(s, id) {
  const q = qualOf(s);
  q.attributes = q.attributes.filter(a => a.id !== id);
  for (const c of q.cases) delete c.attributes[id];
}
/** A value as its attribute's type reads it: a number for a number attribute, else trimmed text; empty is null. */
export function typedValue(type, v) {
  if (v == null || String(v).trim() === '') return null;
  if (type === 'number') { const n = cellValue(v, 'number'); return n; }
  return clean(v);
}
export function setAttributeValue(s, caseId, attrId, value) {
  const q = qualOf(s), c = q.cases.find(x => x.id === caseId), a = q.attributes.find(x => x.id === attrId);
  if (!c || !a) return false;
  const v = typedValue(a.type, value);
  if (v == null) { delete c.attributes[attrId]; return String(value ?? '').trim() === ''; }
  c.attributes[attrId] = v; return true;
}

export function setDocumentCase(s, docId, caseId) {
  const q = qualOf(s), d = q.documents.find(x => x.id === docId);
  if (d) d.caseId = q.cases.some(c => c.id === caseId) ? caseId : null;
}
export function setSpeakerCase(s, docId, speaker, caseId) {
  const q = qualOf(s), d = q.documents.find(x => x.id === docId); if (!d) return;
  d.speakers ||= {};
  for (const k of Object.keys(d.speakers)) if (key(k) === key(speaker)) delete d.speakers[k];
  if (q.cases.some(c => c.id === caseId)) d.speakers[speaker] = caseId;
}

const attrTypeOf = t => (t === 'number' || t === 'integer' ? 'number' : t === 'category' ? 'category' : 'text');

/**
 * Attributes from a dataset: rows matched to cases by the key column (to a
 * case's label, else to a document's name, which then gets a case of that
 * name). Every other column becomes an attribute typed from the column.
 * Returns { matched, created, attributes, unmatched: [key values] }.
 */
export function importAttributes(s, dataset, keyColumn, { columns = null, createCases = false } = {}) {
  const q = qualOf(s), keyCol = dataset.columns.find(c => c.id === keyColumn);
  if (!keyCol) return { matched: 0, created: 0, attributes: 0, unmatched: [] };
  const cols = dataset.columns.filter(c => c.id !== keyColumn && (!columns || columns.includes(c.id)));
  const attrIds = new Map(cols.map(c => [c.id, addAttribute(s, c.label, attrTypeOf(c.type))]));
  let matched = 0, created = 0; const unmatched = [];
  for (const row of dataset.rows) {
    const k = clean(row[keyColumn]); if (!k) continue;
    let c = q.cases.find(x => key(x.label) === key(k));
    if (!c) {
      const doc = q.documents.find(d => key(d.name) === key(k) || key(d.name.replace(/\.\w+$/, '')) === key(k));
      if (doc || createCases) {
        const id = addCase(s, k); c = q.cases.find(x => x.id === id); created++;
        if (doc && !doc.caseId) doc.caseId = id;
      }
    }
    if (!c) { unmatched.push(k); continue; }
    matched++;
    for (const col of cols) { const a = q.attributes.find(x => x.id === attrIds.get(col.id)); const v = typedValue(a.type, row[col.id]); if (v != null) c.attributes[a.id] = v; }
  }
  return { matched, created, attributes: cols.length, unmatched };
}

/**
 * A survey's open answers as a corpus: a case per row named by the key
 * column, a document per non-empty cell of each text column, and the other
 * columns as the case's attributes. Run again on a refreshed dataset, it
 * finds each answer's document by dataset, key and column and updates its
 * text (codings move with the edit) instead of adding it twice.
 * Returns { cases, documents, updated, skipped: [reasons] }.
 */
export function surveyToCorpus(s, dataset, { key: keyColumn, textColumns = [], attributeColumns = null }) {
  const q = qualOf(s), keyCol = dataset.columns.find(c => c.id === keyColumn);
  const texts = dataset.columns.filter(c => textColumns.includes(c.id));
  if (!keyCol || !texts.length) return { cases: 0, documents: 0, updated: 0, skipped: ['Choose a key column and at least one text column'] };
  const attrCols = dataset.columns.filter(c => c.id !== keyColumn && !textColumns.includes(c.id) && (!attributeColumns || attributeColumns.includes(c.id)));
  const seen = new Set(), skipped = [];
  let cases = 0, documents = 0, updated = 0;
  const before = new Set(q.cases.map(c => c.id));
  for (const [i, row] of dataset.rows.entries()) {
    const k = clean(row[keyColumn]);
    if (!k) { skipped.push(`Row ${i + 1} has no ${keyCol.label}`); continue; }
    if (seen.has(key(k))) { skipped.push(`${keyCol.label} ${k} appears more than once; row ${i + 1} skipped`); continue; }
    seen.add(key(k));
    const caseId = addCase(s, k);
    if (!before.has(caseId)) { cases++; before.add(caseId); }
    const c = q.cases.find(x => x.id === caseId);
    for (const col of attrCols) {
      const attrId = addAttribute(s, col.label, attrTypeOf(col.type)), a = q.attributes.find(x => x.id === attrId);
      const v = typedValue(a.type, row[col.id]); if (v != null) c.attributes[a.id] = v;
    }
    for (const col of texts) {
      const text = String(row[col.id] ?? '').trim();
      const doc = q.documents.find(d => d.source?.dataset === dataset.id && key(d.source?.key) === key(k) && d.source?.column === col.id);
      if (doc) { if (text && doc.text !== text) { editText(s, doc.id, text); updated++; } continue; }
      if (!text) continue;
      addDocument(s, { name: `${k}: ${col.label}`, text, kind: 'survey', caseId, source: { dataset: dataset.id, key: k, column: col.id, columnLabel: col.label } });
      documents++;
    }
  }
  return { cases, documents, updated, skipped };
}

/** Levels of an attribute across the cases, in order (numbers ascending), with 'Unknown' for cases without a value. */
export function levelsOf(s, attrId) {
  const q = readQual(s), a = q.attributes.find(x => x.id === attrId); if (!a) return [];
  const vals = [...new Set(q.cases.map(c => c.attributes[attrId]).filter(v => v != null).map(String))];
  vals.sort((x, y) => (a.type === 'number' ? Number(x) - Number(y) : x.localeCompare(y)));
  return vals;
}
