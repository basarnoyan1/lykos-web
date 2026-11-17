// REDCap interchange (amendment of 2026-09-29): the data dictionary CSV to
// dataset columns and back, and a REDCap data export (raw or labels) to rows
// with coded choices decoded to their labels.
//
// A column made from a dictionary field keeps what Lykos uses as its own
// (type, choices, rules: required, min, max, allowed) and everything else of
// the field under `column.redcap`, so toDictionary() writes the field back as
// it came. Branching logic and calculations are kept as text; they are not
// evaluated. Descriptive fields have no data and so no column; they are kept
// on `dataset.redcap.descriptive` in their place.
//
// Checkbox fields are exported by REDCap as one column per choice
// (`field___code`), and are made into one column per choice here, valued
// 'Checked' or 'Unchecked'.
import { parseDelimited, writeDelimited } from './spreadsheet.mjs';
import { newDatasetId } from './datasets.mjs';

export const DICTIONARY_HEADERS = [
  'Variable / Field Name', 'Form Name', 'Section Header', 'Field Type', 'Field Label',
  'Choices, Calculations, OR Slider Labels', 'Field Note', 'Text Validation Type OR Show Slider Number',
  'Text Validation Min', 'Text Validation Max', 'Identifier?', 'Branching Logic (Show field only if...)',
  'Required Field?', 'Custom Alignment', 'Question Number (surveys only)', 'Matrix Group Name', 'Matrix Ranking?',
  'Field Annotation',
];
// Keys for the 18 columns, in order.
const KEYS = ['field', 'form', 'section', 'fieldType', 'label', 'choices', 'note', 'validation', 'min', 'max',
  'identifier', 'branching', 'required', 'alignment', 'questionNumber', 'matrixGroup', 'matrixRanking', 'annotation'];
const HEADER_MATCH = [/^variable|field name/, /^form/, /^section/, /^field type/, /^field label/, /^choices/, /^field note/,
  /^text validation type|show slider/, /validation min/, /validation max/, /^identifier/, /^branching/, /^required/,
  /alignment/, /^question number/, /^matrix group/, /^matrix ranking/, /annotation/];

export const FIELD_TYPES = ['text', 'notes', 'dropdown', 'radio', 'checkbox', 'yesno', 'truefalse', 'calc', 'file', 'slider', 'descriptive', 'sql'];
const FIXED_CHOICES = { yesno: [['1', 'Yes'], ['0', 'No']], truefalse: [['1', 'True'], ['0', 'False']] };
const CHECKED = [['0', 'Unchecked'], ['1', 'Checked']];
export const COMPLETE = [['0', 'Incomplete'], ['1', 'Unverified'], ['2', 'Complete']];

const stripHtml = t => String(t ?? '').replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim();

/** "1, Male | 2, Female" as [[code, label]]; a label may itself hold commas. */
export function parseChoices(text) {
  return String(text ?? '').split('|').map(p => p.trim()).filter(Boolean).map(p => {
    const at = p.indexOf(',');
    return at < 0 ? [p.trim(), p.trim()] : [p.slice(0, at).trim(), p.slice(at + 1).trim()];
  });
}
export const formatChoices = choices => (choices || []).map(([c, l]) => `${c}, ${l}`).join(' | ');

/** The Lykos column type a field reads as. */
export function typeOf(fieldType, validation = '') {
  const v = String(validation || '').toLowerCase();
  if (['dropdown', 'radio', 'yesno', 'truefalse', 'checkbox'].includes(fieldType)) return 'category';
  if (fieldType === 'calc') return 'number';
  if (fieldType === 'slider') return 'integer';
  if (fieldType === 'text') {
    if (v === 'integer') return 'integer';
    if (/^number/.test(v)) return 'number';
    if (/^(date|datetime)_/.test(v)) return 'date';
  }
  return 'text';
}

const rawRows = text => {
  const t = String(text ?? '');
  const delimiter = !t.includes(',') && t.includes('\t') ? '\t' : ',';
  return parseDelimited(t, delimiter).rows.filter(r => r.some(c => String(c).trim()));
};

/**
 * A data dictionary's text as field records [{ field, form, section,
 * fieldType, label, choices, note, validation, min, max, identifier,
 * branching, required, alignment, questionNumber, matrixGroup, matrixRanking,
 * annotation }] (all text, as written). Headers are matched by name, else by
 * position.
 */
export function parseDictionary(text) {
  const rows = rawRows(text);
  if (!rows.length) throw new Error('The data dictionary is empty');
  const head = rows[0].map(h => String(h).trim().toLowerCase());
  const byName = HEADER_MATCH.map(re => head.findIndex(h => re.test(h)));
  const isHeader = byName[0] >= 0 && byName[3] >= 0;
  const at = isHeader ? byName : KEYS.map((_, i) => i);
  const fields = rows.slice(isHeader ? 1 : 0).map(r => Object.fromEntries(KEYS.map((k, i) => [k, at[i] >= 0 ? String(r[at[i]] ?? '').trim() : ''])));
  const bad = fields.filter(f => !f.field || !FIELD_TYPES.includes(f.fieldType.toLowerCase()));
  if (bad.length) throw new Error(`Not a REDCap field: ${bad.slice(0, 3).map(f => f.field || '(no name)').join(', ')}`);
  for (const f of fields) f.fieldType = f.fieldType.toLowerCase();
  return fields;
}

/** Column definitions from field records (one per checkbox choice; none for a descriptive field). */
export function fieldColumns(f) {
  const base = {
    identifier: /^y/i.test(f.identifier),
    branching: f.branching || '',
    redcap: { ...f },
  };
  const required = /^y/i.test(f.required);
  if (f.fieldType === 'descriptive') return [];
  if (f.fieldType === 'checkbox') {
    return parseChoices(f.choices).map(([code, label]) => ({
      id: `${f.field}___${code.toLowerCase().replace(/[^a-z0-9_]/g, '_')}`,
      label: `${stripHtml(f.label)} (choice=${label})`,
      type: 'category',
      choices: CHECKED.map(([c, l]) => ({ code: c, label: l })),
      rules: { allowed: CHECKED.map(x => x[1]) },
      ...base,
      redcap: { ...f, checkboxCode: code, checkboxLabel: label },
    }));
  }
  const type = typeOf(f.fieldType, f.validation);
  const choices = FIXED_CHOICES[f.fieldType] || (['dropdown', 'radio'].includes(f.fieldType) ? parseChoices(f.choices) : null);
  const rules = {};
  if (required) rules.required = true;
  if (choices) rules.allowed = choices.map(x => x[1]);
  if (f.min !== '') rules.min = type === 'date' ? f.min : Number(f.min);
  if (f.max !== '') rules.max = type === 'date' ? f.max : Number(f.max);
  if (f.fieldType === 'slider') { rules.min ??= 0; rules.max ??= 100; }
  if (type === 'number' || type === 'integer') for (const k of ['min', 'max']) if (k in rules && !Number.isFinite(rules[k])) delete rules[k];
  return [{
    id: f.field,
    label: stripHtml(f.label) || f.field,
    type,
    ...(choices ? { choices: choices.map(([code, label]) => ({ code, label })) } : {}),
    rules,
    ...base,
  }];
}

/**
 * A dictionary as an empty dataset: { id, name, columns, rows: [], rowKey,
 * redcap: { descriptive: [{ after, field }] }, source }. The first field is
 * the record identifier and the row key.
 */
export function fromDictionary(text, { name = 'REDCap project', id = newDatasetId(), file = '' } = {}) {
  const fields = parseDictionary(text);
  const columns = [], descriptive = [];
  let last = null;
  for (const f of fields) {
    if (f.fieldType === 'descriptive') { descriptive.push({ after: last, field: { ...f } }); continue; }
    const cs = fieldColumns(f);
    columns.push(...cs);
    last = f.field;
  }
  const at = new Date().toISOString();
  return { id, name, columns, rows: [], rowKey: columns[0]?.id, redcap: { descriptive }, source: { file, format: 'redcap-dictionary', importedAt: at }, at };
}

/** Field records written back from a dataset's columns (the reverse of fromDictionary). */
export function dictionaryFields(dataset) {
  const out = [], seen = new Set();
  const descriptive = dataset.redcap?.descriptive || [];
  const emit = after => { for (const d of descriptive.filter(x => x.after === after)) out.push({ ...d.field }); };
  emit(null);
  for (const c of dataset.columns || []) {
    const r = c.redcap;
    if (r?.fieldType === 'checkbox') {
      if (seen.has(r.field)) continue;
      seen.add(r.field);
      const { checkboxCode, checkboxLabel, ...f } = r;
      const parts = dataset.columns.filter(x => x.redcap?.field === r.field && x.redcap?.fieldType === 'checkbox');
      out.push({ ...f, choices: formatChoices(parts.map(x => [x.redcap.checkboxCode, x.redcap.checkboxLabel])) });
      emit(r.field);
      continue;
    }
    if (REDCAP_SYSTEM.test(c.id)) continue;
    const rules = c.rules || {};
    const fieldType = r?.fieldType || (c.choices || rules.allowed ? 'dropdown' : 'text');
    const validation = r ? r.validation : c.type === 'integer' ? 'integer' : c.type === 'number' ? 'number' : c.type === 'date' ? 'date_ymd' : '';
    const choices = FIXED_CHOICES[fieldType] ? '' : c.choices ? formatChoices(c.choices.map(x => [x.code, x.label]))
      : rules.allowed ? formatChoices(rules.allowed.map((a, i) => [String(i + 1), a])) : r?.choices || '';
    const lbl = r && stripHtml(r.label) === c.label ? r.label : c.label;
    const slider = fieldType === 'slider';
    out.push({
      field: c.id, form: r?.form || 'form_1', section: r?.section || '', fieldType, label: lbl,
      choices, note: r?.note || '', validation,
      min: rules.min != null && !(slider && rules.min === 0 && !r?.min) ? String(rules.min) : '',
      max: rules.max != null && !(slider && rules.max === 100 && !r?.max) ? String(rules.max) : '',
      identifier: c.identifier ? 'y' : '', branching: c.branching ?? r?.branching ?? '', required: rules.required ? 'y' : '',
      alignment: r?.alignment || '', questionNumber: r?.questionNumber || '', matrixGroup: r?.matrixGroup || '',
      matrixRanking: r?.matrixRanking || '', annotation: r?.annotation || '',
    });
    emit(c.id);
  }
  return out;
}

/** A dataset's columns as a REDCap data dictionary CSV (the 18 standard columns). */
export function toDictionary(dataset) {
  const rows = [DICTIONARY_HEADERS, ...dictionaryFields(dataset).map(f => KEYS.map(k => f[k] ?? ''))];
  return writeDelimited(rows, { delimiter: ',', newline: '\n', trailing: true });
}

// ---- data export --------------------------------------------------------------------
const REDCAP_SYSTEM = /^(redcap_event_name|redcap_repeat_instrument|redcap_repeat_instance|redcap_data_access_group|redcap_survey_identifier|.+_timestamp|.+_complete)$/;
const SYSTEM_LABELS = { redcap_event_name: 'Event Name', redcap_repeat_instrument: 'Repeat Instrument', redcap_repeat_instance: 'Repeat Instance', redcap_data_access_group: 'Data Access Group', redcap_survey_identifier: 'Survey Identifier' };
const norm = t => stripHtml(t).toLowerCase();

/**
 * A REDCap records export (CSV, raw or labels) read against a dataset made
 * from the dictionary: { rows, columns, mode, unmatched }. Raw codes are
 * decoded to their labels, checkbox 1/0 to Checked/Unchecked and a form's
 * `_complete` 0/1/2 to Incomplete/Unverified/Complete. Columns in the export
 * that the dictionary does not define (events, repeat instances, form
 * status) are added as text or category columns. `mode` is detected from the
 * header unless given.
 */
export function parseRecords(text, dataset, { mode = 'auto' } = {}) {
  const grid = rawRows(text);
  if (!grid.length) return { rows: [], columns: [...(dataset.columns || [])], mode: 'raw', unmatched: [] };
  const head = grid[0].map(h => String(h).trim());
  const columns = (dataset.columns || []).map(c => ({ ...c }));
  const byId = new Map(columns.map(c => [c.id.toLowerCase(), c]));
  const byLabel = new Map();
  for (const c of columns) if (!byLabel.has(norm(c.label))) byLabel.set(norm(c.label), c);
  const rawHits = head.filter(h => byId.has(h.toLowerCase())).length;
  const labelHits = head.filter(h => byLabel.has(norm(h))).length;
  const m = mode === 'auto' ? (rawHits >= labelHits ? 'raw' : 'labels') : mode;
  const unmatched = [];
  const map = head.map(h => {
    let c = m === 'raw' ? byId.get(h.toLowerCase()) : byLabel.get(norm(h)) || byId.get(h.toLowerCase());
    if (c) return c;
    // a system column, or a form status column: add it
    const id = m === 'raw' ? h : (Object.entries(SYSTEM_LABELS).find(([, l]) => l.toLowerCase() === h.toLowerCase())?.[0]
      || (/^complete\??$/i.test(h) ? `form_${columns.filter(x => /_complete$/.test(x.id)).length + 1}_complete` : h));
    const complete = /_complete$/.test(id);
    c = { id, label: m === 'raw' ? (SYSTEM_LABELS[id] || id) : h, type: complete ? 'category' : id === 'redcap_repeat_instance' ? 'integer' : 'text',
      ...(complete ? { choices: COMPLETE.map(([code, label]) => ({ code, label })), rules: { allowed: COMPLETE.map(x => x[1]) } } : {}) };
    if (!REDCAP_SYSTEM.test(id)) unmatched.push(h);
    columns.push(c); byId.set(id.toLowerCase(), c);
    return c;
  });
  const decode = (c, v) => {
    const t = String(v ?? '').trim();
    if (t === '' || !c.choices) return t;
    const hit = c.choices.find(x => x.code === t) || (m === 'labels' || !c.choices.some(x => x.code === t) ? c.choices.find(x => x.label.toLowerCase() === t.toLowerCase()) : null);
    return hit ? hit.label : t;
  };
  const rows = grid.slice(1).map(r => {
    const row = Object.fromEntries(columns.map(c => [c.id, '']));
    map.forEach((c, i) => { row[c.id] = decode(c, r[i]); });
    return row;
  });
  return { rows, columns, mode: m, unmatched };
}

/** Records as a raw REDCap import CSV: variable names in the header, choices as codes. */
export function toRecords(dataset, { raw = true } = {}) {
  const cols = dataset.columns || [];
  const encode = (c, v) => {
    const t = String(v ?? '').trim();
    if (!raw || !c.choices || t === '') return t;
    return c.choices.find(x => x.label.toLowerCase() === t.toLowerCase())?.code ?? t;
  };
  const rows = [cols.map(c => raw ? c.id : c.label), ...(dataset.rows || []).map(r => cols.map(c => encode(c, r[c.id])))];
  return writeDelimited(rows, { delimiter: ',', newline: '\n', trailing: true });
}
