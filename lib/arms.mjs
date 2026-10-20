// Study arms in an extraction table (plan §G, arms amendment 2026-09-28).
//
// A table's template may declare `armColumns`: the columns whose values can
// differ between the arms of a study (arm and n, age and sex, construct,
// staging, follow-up, outcomes). The other columns are study-level (study,
// design, population, selection rationale, the authors' conclusion). A study
// with more than one arm lists them on the template, `arms[paperId] = [{ id:
// 'arm1', label: 'Arm 1 (n=32)' }, …]`, and an arm's value is stored under
// `${paperId}:${columnId}@arm1`. A value shared by the arms — a cell the
// publication table merges across the arm rows — stays under the plain key,
// as does every value of a one-arm study, so values written before arms
// existed keep working.
//
// Pure and dependency-free: the extraction view, the exports, the folder
// setup and the project migration all read the same model.

export const ARM_RE = /@(arm\d+)$/;
export const armId = i => `arm${i + 1}`;

/** The value key of a cell: `${paperId}:${columnId}`, with `@armN` for an arm's own value. */
export const cellKey = (paperId, columnId, arm = null) => `${paperId}:${columnId}${arm ? `@${arm}` : ''}`;

/** A cell id as the views carry it (`columnId` or `columnId@arm2`), split. */
export function splitCellId(id) {
  const m = ARM_RE.exec(String(id || ''));
  return m ? { columnId: String(id).slice(0, m.index), arm: m[1] } : { columnId: String(id || ''), arm: null };
}

/** A value key split into paper, column and arm. */
export function parseKey(key) {
  const k = String(key), i = k.indexOf(':');
  return { paperId: k.slice(0, i), ...splitCellId(k.slice(i + 1)) };
}

/** Whether a value key belongs to one of these columns, with or without an arm. */
export const keyInColumns = (key, ids) => { const k = String(key), i = k.indexOf(':'); return i > 0 && ids.has(splitCellId(k.slice(i + 1)).columnId); };

/** The arms of a study in a table: its list when it has more than one, else null (a one-arm study). */
export function armsOf(template, paperId) {
  const list = template?.arms?.[paperId];
  return Array.isArray(list) && list.length > 1 ? list : null;
}

/** The first line of an arm cell ("Arm 1 (n=32)" of "Arm 1 (n=32)\nDynesys …"): the arm's label. */
export const armLabel = (text, i) => String(text ?? '').split('\n')[0].trim() || `Arm ${i + 1}`;

const has = (values, k) => values?.[k] != null;
const textOf = v => v == null ? '' : v.availability === 'not_found' && v.reported_value == null ? 'NR' : String(v.reported_value ?? v.normalized_value ?? '');

/**
 * A study's rows in a table, as the publication table lays them out: one row
 * per arm, and a cell that spans every arm row when its value is shared.
 * `cells[r][c]` is `{ columnId, arm, key, value, span }` for the cell that
 * starts in row r, or null where a cell above spans into it. `empty` says
 * what an arm column with no value at all becomes: 'arms' (a cell per arm,
 * for editing) or 'study' (one spanning cell, as a written table merges it).
 */
export function studyGrid(template, values, paperId, columns = template?.columns || [], { empty = 'arms' } = {}) {
  const arms = armsOf(template, paperId);
  const n = arms ? arms.length : 1;
  const armCols = new Set(template?.armColumns || []);
  const cells = Array.from({ length: n }, () => []);
  for (const c of columns) {
    const plain = cellKey(paperId, c.id);
    const perArm = arms && armCols.has(c.id) && (arms.some(a => has(values, cellKey(paperId, c.id, a.id))) || (!has(values, plain) && empty === 'arms'));
    if (!perArm) {
      cells[0].push({ columnId: c.id, arm: null, key: plain, value: values?.[plain] || null, span: n });
      for (let r = 1; r < n; r++) cells[r].push(null);
      continue;
    }
    arms.forEach((a, r) => { const k = cellKey(paperId, c.id, a.id); cells[r].push({ columnId: c.id, arm: a.id, key: k, value: values?.[k] || null, span: 1 }); });
  }
  return { arms: arms || [{ id: null, label: '' }], rows: n, cells };
}

/**
 * One text for a cell of a study, for outputs that have one cell per study
 * (a CSV, the flat evidence table): a shared value as it is, arm values each
 * on its own line after the arm's label, as the table used to join them.
 */
export function studyCellText(template, values, paperId, columnId) {
  const plain = values?.[cellKey(paperId, columnId)];
  const arms = armsOf(template, paperId);
  if (!arms) return textOf(plain);
  const per = arms.map(a => [a, values?.[cellKey(paperId, columnId, a.id)]]).filter(([, v]) => v);
  if (!per.length) return textOf(plain);
  return per.map(([a, v]) => { const t = textOf(v); return /^arm \d|^na \(/i.test(t) ? t : `${a.label.replace(/\s*\(n=.*$/i, '') || a.id}: ${t}`; }).join('\n');
}

/**
 * Splits the values an evidence table import joined per study ("Arm 1: …\n
 * Arm 2: …", with the rows kept in `arms`) into one value per arm. `sheet`,
 * when given, is the publication table as read (`rows`, `merges`) with the
 * header row index and a study → paper map: a cell merged across the arm
 * rows is study-level, any other cell of a multi-row study belongs to its
 * row's arm. Without the sheet, the rows kept on each value decide. Returns
 * a new template and values; nothing passed in is changed.
 */
export function splitJoinedArms({ template, values, sheet = null }) {
  const tpl = structuredClone(template);
  const out = { ...values };
  const report = { studies: 0, split: 0, cells: 0, sheet: !!sheet };
  const colIds = new Set(tpl.columns.map(c => c.id));
  const armCol = tpl.columns.find(c => /^arm\b/i.test(c.label));
  const armColumns = new Set(tpl.armColumns || []);
  const arms = { ...(tpl.arms || {}) };
  const byPaper = new Map();
  for (const [k, v] of Object.entries(values)) {
    const { paperId, columnId, arm } = parseKey(k);
    if (!colIds.has(columnId) || arm) continue;
    const rows = sheet?.rowsOf?.(paperId) || null;
    const perArm = rows && rows.length > 1 ? sheet.perArm(paperId, columnId) : Array.isArray(v?.arms) && v.arms.length > 1 ? v.arms : null;
    if (!perArm) continue;
    byPaper.set(paperId, [...(byPaper.get(paperId) || []), [k, v, columnId, perArm, rows]]);
  }
  for (const [paperId, list] of byPaper) {
    const n = Math.max(...list.map(([, , , per]) => per.length));
    const armCell = list.find(([, , c]) => c === armCol?.id)?.[3] || [];
    const studyArms = arms[paperId]?.length === n ? arms[paperId] : Array.from({ length: n }, (_, i) => ({ id: armId(i), label: armLabel(armCell[i], i) }));
    arms[paperId] = studyArms;
    report.studies++;
    for (const [k, v, columnId, per, rows] of list) {
      armColumns.add(columnId);
      delete out[k];
      report.split++;
      per.forEach((text, i) => {
        const t = String(text ?? '').trim();
        if (!t) return;
        const ak = cellKey(paperId, columnId, studyArms[i].id);
        if (values[ak]) return;
        out[ak] = armValue(v, t, i, rows);
        report.cells++;
      });
    }
  }
  tpl.armColumns = tpl.columns.map(c => c.id).filter(id => armColumns.has(id) || /^(arm|age|confounding)\b/i.test(tpl.columns.find(c => c.id === id).label));
  tpl.arms = arms;
  return { template: tpl, values: out, report };
}

// One arm's value from the joined value it came from: its own text, its own
// cell as the locator, the quotes read from its own row, "row 8" as the source.
function armValue(v, text, i, rows) {
  const { arms: _joined, ...rest } = v;
  const shift = cell => { const m = /^([A-Z]+)(\d+)$/.exec(cell || ''); return m ? `${m[1]}${rows ? rows[i] + 1 : Number(m[2]) + i}` : cell; };
  const evidence = (v.evidence || []).filter(e => e.arm == null || e.arm === i + 1).map((e, j) => {
    if (e.arm != null) { const { arm, ...q } = e; return q; }
    if (j === 0 && e.locator?.cell) return { ...e, locator: { ...e.locator, cell: shift(e.locator.cell) }, quote: text };
    return e;
  });
  const source = String(v.source || '').replace(/rows (\d+)[–-](\d+)/, (m, a) => `row ${Number(a) + i}`);
  const num = typeof v.normalized_value === 'number' && /^-?\d+(\.\d+)?$/.test(text) ? Number(text) : text;
  return { ...rest, reported_value: text, normalized_value: num, availability: /^NR$/i.test(text) ? 'not_found' : 'present', evidence, source, arm: armId(i) };
}

/** Whether a template still holds joined arm values (imported before arms). */
export const needsArmSplit = (template, values) => !template?.armColumns && Object.entries(values || {}).some(([k, v]) =>
  Array.isArray(v?.arms) && v.arms.length > 1 && String(k).includes(`:${template?.id}.`));
