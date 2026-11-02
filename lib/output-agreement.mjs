// Agreement of a project's built outputs with its record (25 Oct 2026). A table, workbook, figure or risk-of-bias file is made from the
// values, the synthesis and the assessments Lykos holds; this checks the files as they stand against that record, so an output that a
// build step skipped, a stored synthesis attribute that overrides the table, a cell the figures cannot read or a judgement that breaks its
// tool's own rule is found before anyone reads the file. Pure: every function takes the record and what a file holds (parsed by the
// caller), and answers findings [{ check, where, text }]. tools/lykos-check-outputs.mjs reads the files and runs them after every build.
import { parseCountText, countFor, armSize, itemKey } from './count-text.mjs';
import { britishSpellings } from './spelling.mjs';
import { similarity } from './reference-list.mjs';
import { overallFinding, robOverallRule } from './rob-overall.mjs';

const N = v => String(v ?? '').normalize('NFC').replace(/\s+/g, ' ').trim();

// ---- tables ---------------------------------------------------------------------------------------------------------------------

/** The value of one study's field for each arm: { '': 'whole study', arm1: '…', … }, from `s.values`. */
export function fieldValues(s, paperId, fieldId) {
  const out = {};
  for (const [k, v] of Object.entries(s.values || {})) {
    if (k === `${paperId}:${fieldId}`) out[''] = String(v?.reported_value ?? '');
    else if (k.startsWith(`${paperId}:${fieldId}@`)) out[k.slice(k.indexOf('@') + 1)] = String(v?.reported_value ?? '');
  }
  return out;
}

/**
 * A built table against the values it shows. `item` a Package table item whose source names its evidence template, studies and fields;
 * `table` the matching table of the built file ({ header, rows } as lib/docx-tables.mjs reads it). Each body cell must be the value (or its
 * `valueLabels` text) of its row's study for its column's field, for one of the study's arms; each value of a study must be in the table;
 * every listed study must have a row and no other study may. Answers findings.
 */
export function tableFindings(s, item, table, where) {
  const src = item?.source || {}, out = [], add = text => out.push({ check: 'table', where, text });
  if (!src.evidence || !Array.isArray(src.fields)) return out;
  const fields = src.fields, header = (table?.header || []).map(N);
  if (header.length !== fields.length) { add(`${header.length} columns, but the item lists ${fields.length} fields`); return out; }
  const tpl = (s.templates || []).find(t => t.id === src.evidence), labelOf = f => N(src.labels?.[f] ?? tpl?.columns?.find(c => c.id === f)?.label ?? f);
  fields.forEach((f, i) => { if (header[i] !== labelOf(f)) add(`column ${i + 1} is headed "${header[i]}", the field is "${labelOf(f)}"`); });
  const studyField = fields.find(f => /\.study$/.test(f)) || `${src.evidence}.study`, si = fields.indexOf(studyField);
  // a reference number in a cell is a citation control, which the table reader leaves out (lib/docx.mjs): the cell reads as the value
  const textOf = (f, v) => N(src.valueLabels?.[f]?.[v] ?? v);
  const byLabel = new Map((src.studies || []).map(pid => [textOf(studyField, fieldValues(s, pid, studyField)[''] ?? '', pid), pid]));
  const seen = new Map();   // pid -> { f -> Set(texts) }
  let last = null, lastLabel = '';
  for (const row of table?.rows || []) {
    const cells = row.map(N);
    if (new Set(cells).size === 1 && cells.length > 1) continue;   // a group heading spanning the row
    let label = si >= 0 ? cells[si] : '';
    // a plain superscript number after the label (`source.refNumbers` given as { paper id: number }, the manuscript's numbers) is not a
    // citation control, so the reader keeps it: the label is the cell without its study's number
    if (label && !byLabel.has(label) && src.refNumbers && typeof src.refNumbers === 'object')
      for (const [l, id] of byLabel) if (src.refNumbers[id] != null && label === `${l}${src.refNumbers[id]}`) { label = l; cells[si] = l; break; }
    const pid = label ? byLabel.get(label) : last;
    if (!pid) { add(`a row for "${label}", which is not among the item's studies`); continue; }
    last = pid; if (label) lastLabel = label;
    const got = seen.get(pid) || new Map(); seen.set(pid, got);
    fields.forEach((f, i) => {
      const allowed = new Set(Object.values(fieldValues(s, pid, f)).map(v => textOf(f, v, pid)));
      const c = cells[i];
      if (!got.has(f)) got.set(f, new Set());
      got.get(f).add(c);
      // an empty cell under a value spanning the arms (a merged cell read as empty)
      if (c === '' && (allowed.size <= 1 || allowed.has(''))) return;
      if (!allowed.has(c)) add(`${label || `${lastLabel} (next arm)`}: "${headerOr(header, i)}" reads "${c.slice(0, 80)}", the record has ${[...allowed].map(x => `"${x.slice(0, 80)}"`).join(' or ') || 'nothing'}`);
    });
  }
  for (const [label, pid] of byLabel) {
    const got = seen.get(pid);
    if (!got) { add(`${label}: no row`); continue; }
    for (const f of fields) for (const v of new Set(Object.values(fieldValues(s, pid, f)).map(x => textOf(f, x, pid)))) if (v && !got.get(f)?.has(v)) add(`${label}: "${labelOf(f)}" ${JSON.stringify(v.slice(0, 80))} is not in the table`);
  }
  return out;
}
const headerOr = (h, i) => h[i] || `column ${i + 1}`;

/** The notes a workbook sheet carries below its rows (a row whose first cell is "Notes" or "Table notes", then one note a row): [{ cell, text }]. */
export function workbookNotes(rows) {
  const start = (rows || []).findIndex(r => /^(table\s+)?notes$/i.test(N(r?.[0])));
  if (start < 0) return [];
  return rows.slice(start + 1).map((r, i) => ({ cell: `A${start + 2 + i}`, text: N(r?.[0]) })).filter(x => x.text);
}

/**
 * The table notes a workbook carries below its rows against the notes of the Package items made from the same template: each workbook note
 * must be one of them, word for word. `rows` the sheet's rows.
 */
export function workbookNotesFindings(rows, itemNotes, where) {
  const known = new Set(itemNotes.map(N));
  return workbookNotes(rows).filter(x => !known.has(x.text)).map(x => ({ check: 'notes', where, text: `the note "${x.text.slice(0, 90)}…" is not one of the tables' notes` }));
}

/**
 * What a workbook's notes become when a table note changed in Lykos (tools/lykos-write-back.mjs): each note of the sheet's notes block that is
 * not one of the tables' notes is written over by the one tables' note it plainly was, the closest the block does not already carry, at a
 * similarity of at least `min` (lib/reference-list.mjs, 1 − edit distance / length) and `margin` above the next. A note with no such match is
 * left for a person (the output check lists it). Answers [{ cell, from, to }].
 */
export function workbookNoteEdits(rows, itemNotes, { min = 0.85, margin = 0.1 } = {}) {
  const block = workbookNotes(rows), have = new Set(block.map(b => b.text)), known = new Map(itemNotes.map(n => [N(n), n]));
  const free = [...known.entries()].filter(([k]) => !have.has(k)), out = [];
  for (const b of block.filter(x => !known.has(x.text))) {
    const scored = free.map(([k, n]) => ({ k, n, s: similarity(b.text, k) })).filter(x => x.s >= min).sort((x, y) => y.s - x.s);
    if (!scored.length || (scored[1] && scored[0].s - scored[1].s < margin)) continue;
    out.push({ cell: b.cell, from: b.text, to: scored[0].n });
    free.splice(free.findIndex(([k]) => k === scored[0].k), 1);
  }
  return out;
}

/** A mirror workbook's sheets against the sheet they copy, cell for cell (a sources sheet by each cell's first line, before "\n— "). */
export function mirrorFindings(main, mirror, { sources = false } = {}, where) {
  const out = [], rows = main?.rows || [];
  for (let r = 0; r < rows.length; r++) for (let c = 0; c < (rows[r] || []).length; c++) {
    const a = N(rows[r][c]), raw = mirror?.rows?.[r]?.[c], b = N(sources && raw != null ? String(raw).split('\n—')[0] : raw);
    if (a !== b) out.push({ check: 'mirror', where, text: `row ${r + 1}, column ${c + 1}: "${b.slice(0, 60)}", the main sheet has "${a.slice(0, 60)}"` });
  }
  return out;
}

// ---- count columns and the synthesis --------------------------------------------------------------------------------------------

/**
 * Every value of a column the synthesis counts from must read as counts: a segment that names a count but that count-text cannot read is
 * shown as NR in every table and figure built from it. `columns` the text-counts columns. Answers findings.
 */
export function countColumnFindings(s, columns) {
  const out = [];
  for (const [k, v] of Object.entries(s.values || {})) {
    const field = k.slice(k.indexOf(':') + 1).replace(/@.*$/, '');
    if (!columns.has(field)) continue;
    const { items, unreadable } = parseCountText(String(v?.reported_value ?? ''));
    for (const i of [...items, ...unreadable]) if (i.status !== 'count' && i.status !== 'missing' && /\d+\s*\/\s*\d+/.test(i.text) && !/bound/.test(i.reason || '')) out.push({ check: 'counts', where: k, text: `"${i.text}" is not readable as a count (${i.reason})` });
  }
  return out;
}

/**
 * The synthesis inputs against the table: for each counted outcome (a text-counts component: its column, items and denominator column)
 * and each arm of the synthesis model, the count read afresh from the arm's own cell must be the count the synthesis uses, and the arm's
 * size the size its label states. A stored attribute that overrides the table (a count, a size, a follow-up) shows here. `model` the
 * synthesis model (lib/synth-project.mjs synthesisModel); `components` its text-counts outcomes.
 */
export function synthesisFindings(model, components, followUpMonths = null) {
  const out = [];
  for (const a of model?.arms || []) {
    const where = `${a.study}${a.armId ? ` ${a.armId}` : ''}`;
    for (const c of components) {
      const d = c.derived; if (d?.kind !== 'text-counts') continue;
      const text = a.cells?.[d.column], n = armSize(a.cells?.[d.nColumn]) ?? a.n;
      const r = countFor(text, d.items, { n });
      const used = a.counts?.[c.id], usedN = a.ns?.[c.id];
      if (r.status === 'count' && (used !== r.events || usedN !== r.n)) out.push({ check: 'synthesis', where, text: `${c.name}: the table reads ${r.events}/${r.n}, the synthesis uses ${used ?? 'nothing'}/${usedN ?? '–'}` });
      if (r.status !== 'count' && Number.isFinite(used) && !a.bounds?.[c.id]) out.push({ check: 'synthesis', where, text: `${c.name}: the synthesis uses ${used}/${usedN}, the table has no count (${r.reason || r.status})` });
    }
    const label = Object.entries(a.cells || {}).find(([k]) => /arm_n$/.test(k))?.[1];
    if (label && armSize(label) && a.n !== armSize(label)) out.push({ check: 'synthesis', where, text: `arm size ${a.n} in the synthesis, ${armSize(label)} in the table` });
    if (followUpMonths) {
      const fu = Object.entries(a.cells || {}).find(([k]) => /follow_up/.test(k))?.[1], m = fu != null ? followUpMonths(fu) : null;
      if (Number.isFinite(m) && Number.isFinite(a.fu) && Math.abs(m - a.fu) > 0.051 && !a.fuShared) out.push({ check: 'synthesis', where, text: `follow-up ${a.fu} mo in the synthesis, ${m} in the table` });
    }
  }
  return out;
}

// ---- risk of bias ---------------------------------------------------------------------------------------------------------------

/**
 * Each assessment's overall judgement against its domains, by the rule the project sets for its tool (lib/rob-overall.mjs, build.json
 * "checks" "robOverall"; by default ROBINS-I and RoB 2 at least the most severe domain, one step above it only with two or more domains at
 * that step). A checklist's score must be its Yes answers. `records` from lib/rob-record.mjs robRecord; `checks` the build.json "checks".
 */
export function robRuleFindings(records, checks = {}) {
  const out = [];
  for (const r of records || []) {
    if (r.checklist) {
      const yes = r.entries.filter(e => e.judgement === 'Yes').length;
      if (r.score && r.score.yes !== yes) out.push({ check: 'rob', where: r.label, text: `score ${r.score.yes} Yes, the answers give ${yes}` });
      continue;
    }
    if (!/robins/i.test(r.tool.id) && r.tool.id !== 'rob2') continue;
    if (!r.overall || r.overall === 'Not assessed') continue;
    const text = overallFinding(r.tool, r.entries.map(e => e.judgement), r.overall, robOverallRule(checks, r.tool.id));
    if (text) out.push({ check: 'rob', where: r.label, text });
  }
  return out;
}

/** A written workbook's sheets against the sheets the record makes now, cell for cell: a file the build did not rewrite, or one edited. */
export function sheetsFindings(expected, written, where) {
  const out = [];
  for (const e of expected || []) {
    const w = (written || []).find(x => x.name === e.name);
    if (!w) { out.push({ check: 'rob-file', where, text: `sheet "${e.name}" is missing` }); continue; }
    let n = 0;
    for (let r = 0; r < e.rows.length; r++) for (let c = 0; c < e.rows[r].length; c++) if (N(e.rows[r][c]) !== N(w.rows?.[r]?.[c])) { if (n++ < 3) out.push({ check: 'rob-file', where, text: `${e.name}, row ${r + 1}, column ${c + 1}: "${N(w.rows?.[r]?.[c]).slice(0, 50)}", the record gives "${N(e.rows[r][c]).slice(0, 50)}"` }); }
    if (n > 3) out.push({ check: 'rob-file', where, text: `${e.name}: ${n - 3} more cells differ` });
  }
  return out;
}

// ---- notes ----------------------------------------------------------------------------------------------------------------------

/**
 * Abbreviations a table's cells use that its notes do not define. A term is a run of capitals (CT, PJK, PI–LL); spinal levels and other
 * letter-and-number labels (L4, T11), Roman numerals (grade IV), and the terms `known` lists (device names, defined elsewhere), are left out. A definition is the term
 * followed by "=" or ",", or inside brackets, or as part of a slash pair ("TLIF/PLIF ="). Answers findings.
 */
export function abbreviationFindings(cellsText, notes, known = [], where) {
  const defs = N((notes || []).join(' ')), skip = new Set([...known.map(k => k.toUpperCase()), 'NR', 'NA']), roman = /^(?=[IVXL]+$)L?X{0,3}(IX|IV|V?I{0,3})$/;
  const terms = new Set();
  for (const m of N(cellsText).matchAll(/(?<![\p{L}\d])([A-Z]{2,}(?:[–-][A-Z]{1,})?)(?![\p{L}\d])/gu)) terms.add(m[1]);
  const out = [];
  for (const t of terms) {
    if (skip.has(t.toUpperCase()) || roman.test(t)) continue;   // a grade or stage (Bridwell IV) is not an abbreviation
    const e = t.replace(/[–-]/g, '[–-]');
    const re = new RegExp(`(?:^|[\\s(;/])${e}(?:/[A-Z]+)*\\s*(?:=|,|:)|\\(${e}\\)|[A-Z]+/${e}\\s*=`, 'u');
    if (!re.test(defs)) out.push({ check: 'notes', where, text: `${t} is used in the cells but not defined in the notes` });
  }
  return out;
}

/**
 * Definitions in a table's notes that nothing uses: an abbreviation defined ("JOA = …", "TLIF/PLIF = …", "(PJK)") or a quoted cell value
 * defined ('"direction NR" = …') that appears neither in the tables (`usedText`, their cells and headers) nor elsewhere in the notes. A note
 * carried over from a fuller table often defines what the shorter one no longer shows. Answers one finding per unused definition.
 */
export function unusedDefinitionFindings(usedText, notes, where) {
  const all = (notes || []).map(N), used = N(usedText), out = [], seen = new Set();
  const esc = t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/[–-]/g, '[–-]');
  const count = (t, text, quoted) => (text.match(new RegExp(quoted ? esc(t) : `(?<![\\p{L}\\d])${esc(t)}(?![\\p{L}\\d])`, quoted ? 'gu' : 'gu')) || []).length;
  for (const note of all) {
    const terms = [];
    for (const m of note.matchAll(/(?<![\p{L}\d])([A-Z][A-Z0-9]*[A-Z0-9](?:[–-][A-Z0-9]+)?(?:\/[A-Z][A-Z0-9]*[A-Z0-9](?:[–-][A-Z0-9]+)?)*)\s*=\s/gu)) terms.push(...m[1].split('/').map(t => [t, false]));
    for (const m of note.matchAll(/\(([A-Z][A-Z0-9]*[A-Z](?:[–-][A-Z]+)?)\)/gu)) terms.push([m[1], false]);
    for (const m of note.matchAll(/["“]([^"”]{2,40})["”]\s*=\s/gu)) terms.push([m[1], true]);
    for (const [t, quoted] of terms) {
      if (seen.has(t) || ['NR', 'NA'].includes(t)) continue;
      seen.add(t);
      const inNotes = all.reduce((a, x) => a + count(t, x, quoted), 0);
      if (!count(t, used, quoted) && inNotes < 2) out.push({ check: 'notes', where, text: `${quoted ? `"${t}"` : t} is defined in the notes but used in no table` });
    }
  }
  return out;
}

// ---- a submission's cross-references ---------------------------------------------------------------------------------------------

const KIND = { table: 'Table', tables: 'Table', figure: 'Figure', figures: 'Figure', fig: 'Figure', figs: 'Figure' };
/**
 * The files sent together (build.json "submission"): `files` [{ file, blocks }] (lib/docx.mjs parseDocx blocks; `skipColumn` a header pattern
 * of table columns quoted from papers). Each caption ("Table {{seq:Table}}.", "Figure S{{seq:Figure_S}}." or a typed number) numbers its kind
 * in order; a number given twice across the files is a finding, and every mention of a table or figure ("Table 2", "Tables 1–3", "Tables 2 and
 * 3", "Supplementary Table S1", "Figures S2–S4", "Figure 3A") must name one the files print. Answers findings.
 */
export function submissionFindings(files, { skipColumn = null } = {}) {
  const out = [], defined = new Map();   // "Table S1" -> file
  const texts = [];
  for (const f of files || []) {
    const counters = {};
    for (const b of f.blocks || []) {
      if (b.type === 'table') {
        const rows = (b.grid?.rows || []).map(r => r.cells.map(c => c.text || '')), skip = (rows[0] || []).map(h => !!(skipColumn && skipColumn.test(h)));
        rows.forEach((r, i) => r.forEach((c, k) => { if (i > 0 && !skip[k]) texts.push({ file: f.file, text: c }); }));
        continue;
      }
      let text = N(b.text);
      const cap = text.match(/^(?:Supplementary )?(Table|Figure) (S?)(?:\{\{seq:([^}]+)\}\}|(\d+))\.\s/);
      if (cap) {
        const key = cap[3] || `${cap[1]}${cap[2]}`, n = cap[4] ? Number(cap[4]) : (counters[key] = (counters[key] || 0) + 1);
        const label = `${cap[1]} ${cap[2]}${n}`;
        if (defined.has(label)) out.push({ check: 'submission', where: f.file, text: `${label} is numbered twice (also in ${defined.get(label)})` });
        else defined.set(label, f.file);
        text = text.slice(cap[0].length);
      }
      texts.push({ file: f.file, text });
    }
  }
  const NUM = 'S?\\d+[A-Z]?';
  const re = new RegExp(`(?<![\\p{L}])(Supplementary )?(Tables?|Figures?|Figs?\\.?) (${NUM}(?:\\s*(?:[–-]|to)\\s*${NUM})?(?:(?:,\\s*|,? and |,? or )${NUM}(?:\\s*[–-]\\s*${NUM})?)*)(?![\\p{L}\\d])`, 'gu');
  for (const { file, text } of texts) for (const m of N(text).matchAll(re)) {
    const kind = KIND[m[2].toLowerCase().replace('.', '')], supp = !!m[1];
    for (const part of m[3].split(/,\s*|,? and |,? or /)) {
      const [a, b] = part.split(/\s*(?:[–-]|to)\s*/).map(x => x.replace(/[A-Z]$/, ''));
      const S = (a.startsWith('S') || supp) ? 'S' : '', from = Number(a.replace('S', '')), to = b ? Number(b.replace('S', '')) : from;
      for (let n = from; n <= to && n - from < 50; n++) {
        const label = `${kind} ${S}${n}`;
        if (!defined.has(label)) out.push({ check: 'submission', where: file, text: `mentions ${label}, which no file of the submission prints ("${m[0]}")` });
      }
    }
  }
  return out;
}

// ---- cell rules ------------------------------------------------------------------------------------------------------------------

/**
 * The rules a table's cells follow, from .lykos/build.json "checks": always, no doubled or edge spaces, and every count's denominator the arm's
 * size unless the cell says the count is the whole cohort's; with "countPercent": "one-decimal" (or { "format", "columns" }; the columns default
 * to those the synthesis counts from), a count above zero carries its percentage to one decimal and a zero carries none; "columns": { "<column>": { "pattern": "<regex the whole cell matches>", "maxWords": 20 } }; "forbidden":
 * phrases no cell may hold; "startCapital": true, each cell starts with a capital. `armField` the column of the arm labels ("Arm 1 (n=32)");
 * `shown` the columns some table prints (only they are checked); `countColumns` the synthesis's count columns.
 * Answers findings, one per cell and rule.
 */
export function cellRuleFindings(s, template, rules = {}, armField = null, { shown = null, countColumns = null } = {}) {
  const out = [], T = template?.id, short = id => id.slice(id.indexOf('.') + 1);
  const label = new Map((template?.columns || []).map(c => [c.id, c.label]));
  const studyOf = pid => String(s.values?.[`${pid}:${T}.study`]?.reported_value ?? pid);
  const sizes = new Map();
  if (armField) for (const [k, v] of Object.entries(s.values || {})) if (k.includes(`:${armField}`)) { const n = armSize(v?.reported_value); if (n) sizes.set(k.replace(`:${armField}`, ''), n); }
  const forbidden = (rules.forbidden || []).map(f => new RegExp(`\\b${f.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i'));
  for (const [k, v] of Object.entries(s.values || {})) {
    if (!k.includes(`:${T}.`)) continue;
    const pid = k.slice(0, k.indexOf(':')), col = k.slice(k.indexOf(':') + 1).replace(/@.*$/, ''), arm = k.includes('@') ? k.slice(k.indexOf('@')) : '';
    if (shown && !shown.has(col)) continue;   // the rules are for what a table prints
    const text = String(v?.reported_value ?? ''), where = `${studyOf(pid)}${arm ? ` ${arm.slice(1)}` : ''}, ${label.get(col) || short(col)}`, add = t => out.push({ check: 'cells', where, text: t });
    if (/ {2}/.test(text.replace(/\n/g, '')) || text !== text.trim()) add('extra spaces');
    const n = sizes.get(`${pid}${arm}`) ?? sizes.get(pid);
    const whole = /\b(whole|entire|overall|total) (cohort|series|sample)\b/i.test(text);
    // a cell that names the subset its counts are out of ("(20 followed)", "of 20 evaluated") may have a denominator other than the arm's
    const subsets = new Set([...text.matchAll(/\b(?:of |in )?(?:the )?(\d+) (?:followed|evaluated|analy[sz]ed)\b/gi)].map(x => Number(x[1])));
    for (const m of text.matchAll(/(≤)?(\d+)\s*\/\s*(\d+)(\s*\(\s*(≤)?(\d+(?:\.\d+)?)\s*%\s*\))?/g)) {
      const [e, N] = [Number(m[2]), Number(m[3])];
      if (n && N !== n && !whole && !subsets.has(N) && col !== armField) add(`denominator ${N}, the arm has ${n}: "${m[0]}"`);
      const cp = typeof rules.countPercent === 'string' ? { format: rules.countPercent } : rules.countPercent || {};
      const cpCols = cp.columns ? new Set(cp.columns.map(c => (c.includes('.') ? c : `${T}.${c}`))) : countColumns;
      if (cp.format === 'one-decimal' && (!cpCols || cpCols.has(col))) {
        if (e > 0 && !m[4]) add(`${e}/${N} without its percentage`);
        if (e === 0 && m[4]) add(`0/${N} with a percentage`);
        if (m[4] && !/\.\d$/.test(m[6])) add(`${m[0]}: the percentage is not to one decimal`);
      }
    }
    const r = rules.columns?.[short(col)] || rules.columns?.[col];
    if (r?.pattern && !new RegExp(r.pattern, 'u').test(text)) add(`does not follow the column's format: "${text.slice(0, 80)}"`);
    if (r?.maxWords && text.split(/\s+/).filter(Boolean).length > r.maxWords) add(`${text.split(/\s+/).filter(Boolean).length} words (at most ${r.maxWords})`);
    for (const f of forbidden) if (f.test(text)) add(`holds "${text.match(f)[0]}", which the table's rules exclude`);
    if (rules.startCapital && text && /^[a-z]/.test(text) && col !== armField) add(`starts with a lower-case letter: "${text.slice(0, 40)}"`);
  }
  return out;
}

/**
 * The risk-of-bias decision log (lib/rob-record.mjs robRecordBlocks, as built) against the record: under each study's heading
 * ("ID n  Label  (Tool)"), each domain or item row's final judgement must be the record's, and its overall row the overall. `blocks` the
 * parsed document's blocks (lib/docx.mjs parseDocx). Answers findings.
 */
export function decisionLogFindings(records, blocks, where) {
  const out = [], byHead = new Map((records || []).map(r => [`ID ${r.number}  ${r.label}  (`, r]));
  let cur = null, rows = 0;
  for (const b of blocks || []) {
    if (b.type !== 'table') { const t = String(b.text || ''); for (const [h, r] of byHead) if (t.startsWith(h)) cur = r; continue; }
    const grid = (b.grid?.rows || []).map(r => r.cells.map(c => N(c.text)));
    if (!cur || !grid.length || !/^(Domain|Item)$/.test(grid[0][0]) || grid[0][1] !== 'Final') continue;
    for (const row of grid.slice(1)) {
      const key = row[0].split(' ')[0], fin = row[1];
      const want = /^overall$/i.test(key) ? cur.overall : cur.entries.find(e => e.short === key)?.judgement;
      rows++;
      if (want == null) out.push({ check: 'rob-file', where, text: `${cur.label}: the log lists ${key}, the record has no such ${cur.checklist ? 'item' : 'domain'}` });
      else if (want !== fin) out.push({ check: 'rob-file', where, text: `${cur.label} ${key}: the log says ${fin}, the record ${want}` });
    }
  }
  if (!rows && (records || []).length) out.push({ check: 'rob-file', where, text: 'no per-study judgement tables found' });
  return out;
}

/**
 * British spellings left in what a project writing American puts out: `pieces` [{ where, text }] (cells, notes, legends, figure text), quoted
 * passages and the names in `keep` left aside (lib/spelling.mjs). Answers one finding per piece.
 */
export function spellingFindings(pieces, keep = []) {
  const out = [];
  for (const p of pieces || []) { const w = britishSpellings(p.text, { keep }); if (w.length) out.push({ check: 'spelling', where: p.where, text: `British spelling: ${w.join(', ')}` }); }
  return out;
}

export { itemKey };
