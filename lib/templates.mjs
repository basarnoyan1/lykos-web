// Table templates in the project. The built-in extraction fields are the
// default template, so one values store serves every table.
import { FIELDS } from '../schema.mjs';
import { get, update } from '../store.mjs';
import { fields } from './fields.mjs';

// The default table's name is not the page's: the Extraction page leads with the table it shows, so 'Extraction' would repeat the title.
// Every table lists its studies as rows (Extraction redesign §1.1); `transposed` is the person's choice per table, kept in the project.
export const DEFAULT_TEMPLATE = { id: 'default', name: 'Study data', orientation: 'studies-rows', source: null, conventions: [], columns: FIELDS };
/** Whether a table shows its fields as rows and its studies as columns (a short series with many fields). */
export const isTransposed = (id, s = get()) => (s.extractionTransposed || []).includes(id);
export function setTransposed(id, on) {
  update(s => { const ids = (s.extractionTransposed || []).filter(x => x !== id); s.extractionTransposed = on ? [...ids, id] : ids; return s; }, { indexNeutral: true });
}

export const templates = (s = get()) => [DEFAULT_TEMPLATE, ...(s.templates || [])];
export const templateById = (id, s = get()) => templates(s).find(t => t.id === id) || null;
export const columnsOf = (templateId, s = get()) => templateId === 'default' ? fields(s) : (templateById(templateId, s)?.columns || []);

export function saveTemplate(t) {
  update(s => { s.templates = [...(s.templates || []).filter(x => x.id !== t.id), t]; return s; });
}
export function removeTemplate(id) {
  update(s => {
    s.templates = (s.templates || []).filter(x => x.id !== id);
    const mine = k => k.split(':')[1]?.startsWith(`${id}.`);
    for (const k of Object.keys(s.values || {})) if (mine(k)) delete s.values[k];
    for (const k of Object.keys(s.proposals || {})) if (mine(k)) delete s.proposals[k];
    return s;
  });
}
export const newTemplateId = () => `t${Date.now().toString(36)}`;

// ---- a table's definition as a file ------------------------------------------
// The columns, their types and guidance, and the conventions: what another
// review needs to extract the same table (plan G1, schema versioning). Values
// stay in the project; the file carries the shape only.
export const TEMPLATE_FORMAT = 'lykos-template-1';
export function templateJson(t) {
  const { id, ...rest } = t;
  return JSON.stringify({ format: TEMPLATE_FORMAT, exportedAt: new Date().toISOString(), template: { ...rest, columns: (t.columns || []).map(({ id: cid, ...c }) => ({ ...c, key: cid.split('.').slice(1).join('.') || cid })) } }, null, 2);
}
/** Reads a definition file; the table gets a fresh id and its columns are keyed under it. Throws when the file is not one. */
export function templateFromJson(text, id = newTemplateId()) {
  let doc; try { doc = JSON.parse(text); } catch { throw new Error('Not a table definition file'); }
  if (doc?.format !== TEMPLATE_FORMAT || !doc.template || !Array.isArray(doc.template.columns)) throw new Error('Not a table definition file');
  const types = new Set(['text', 'number', 'integer', 'category']);
  const taken = new Set();
  const columns = doc.template.columns.map((c, i) => {
    const label = String(c.label || c.key || `Column ${i + 1}`).trim();
    let key = String(c.key || label).toLowerCase().replace(/[^\w]+/g, '_').replace(/^_|_$/g, '') || `column_${i + 1}`;
    let n = 1; const base = key; while (taken.has(key)) key = `${base}_${++n}`; taken.add(key);
    return { id: `${id}.${key}`, label, type: types.has(c.type) ? c.type : 'text', guidance: String(c.guidance || ''), examples: String(c.examples || ''), why: String(c.why || ''),
      ...(c.unit ? { unit: String(c.unit) } : {}), ...(Array.isArray(c.options) ? { options: c.options.map(String) } : {}) };
  });
  if (!columns.length) throw new Error('The definition has no columns');
  return { id, name: String(doc.template.name || 'Imported table').slice(0, 60), orientation: doc.template.orientation === 'studies-columns' ? 'studies-columns' : 'studies-rows',
    source: { file: doc.template.source?.file || '', importedAt: new Date().toISOString(), definition: true },
    conventions: Array.isArray(doc.template.conventions) ? doc.template.conventions.map(String) : [], columns };
}
