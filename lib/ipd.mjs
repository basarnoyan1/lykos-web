// Individual participant data.
//
// A review of a rare condition pools patients, not studies: a few patients
// drawn from many case reports, or hundreds across several treatment
// strategies. The unit of analysis is the patient, and each one keeps the study
// it came from, so a result can always be traced back to its report (plan G3,
// and PRISMA-IPD).
//
// Columns are editable because no fixed schema survives contact with a second
// review; these defaults are what a comparative time-to-event pooled analysis
// needs.
import { get, update } from '../store.mjs';

export const COLUMN_TYPES = ['text', 'number', 'category', 'date', 'boolean'];

export const DEFAULT_COLUMNS = [
  { id: 'label',      name: 'Patient',        type: 'text' },
  { id: 'age',        name: 'Age',            type: 'number' },
  { id: 'sex',        name: 'Sex',            type: 'category', levels: ['Female', 'Male'] },
  { id: 'strategy',   name: 'Strategy',       type: 'category',
    levels: ['GTR alone', 'Incomplete resection alone', 'Incomplete + RT', 'Incomplete + SRS'],
    role: 'group' },
  { id: 'dose',       name: 'Marginal dose (Gy)', type: 'number' },
  { id: 'volume',     name: 'Volume (cm³)',   type: 'number' },
  { id: 'time',       name: 'Follow-up (months)', type: 'number', role: 'time' },
  { id: 'event',      name: 'Progression',    type: 'boolean', role: 'event' },
  { id: 'outcome',    name: 'Outcome',        type: 'text' },
];

export const columns = () => get().ipdColumns || DEFAULT_COLUMNS;
export const participants = () => get().participants || [];

/** The column carrying a role, so an analysis knows which is time and which is event. */
export const roleColumn = role => columns().find(c => c.role === role);

export function setColumns(cols) {
  update(s => { s.ipdColumns = cols; return s; });
}

/**
 * `extra` is for a row a model read from a report: `evidence` ({ column id:
 * [{ quote, page, ... }] }, the report's own words for each cell), `extractor`
 * ('model:<name>') and `run_id`. A row typed or imported has none of them.
 */
export function addParticipant(studyId, values = {}, extra = null) {
  const id = `ipd${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
  const own = extra ? Object.fromEntries(['evidence', 'extractor', 'run_id'].filter(k => extra[k] != null).map(k => [k, extra[k]])) : {};
  update(s => {
    s.participants = [...(s.participants || []), { id, study_id: studyId, ...values, ...own, updatedAt: new Date().toISOString() }];
    return s;
  });
  return id;
}

// ---- rows a model extracted, waiting for a person ----------------------------------
// A patient a model read from a report is not yet data: survival tables and
// pooled analyses read `participants`. Rows wait here with the quote behind each
// cell and what the rule check found, and join the participants only when a
// person accepts them (lib/extract-batch.mjs writes them).
export const participantProposals = () => get().ipdProposals || [];

/** Adds proposed rows: [{ cells, evidence, qa?, case_no? }]. Returns their ids. */
export function proposeParticipants(studyId, rows, { model = null, run_id = null } = {}) {
  const at = new Date().toISOString(), ids = [];
  update(s => {
    s.ipdProposals = s.ipdProposals || [];
    for (const r of rows) {
      const id = `ipp${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`; ids.push(id);
      s.ipdProposals.push({ id, study_id: studyId, cells: { ...(r.cells || {}) }, evidence: r.evidence || {}, qa: r.qa || null, model, run_id, at });
    }
    return s;
  });
  return ids;
}

/** Replaces the record of a proposed row (a stamp from the rule check, a re-check by a stronger model). */
export function patchParticipantProposal(id, fn) {
  update(s => { const p = (s.ipdProposals || []).find(x => x.id === id); if (p) fn(p); return s; });
}

/** A proposed row becomes a participant, with its quotes; `editedCells` are a person's corrections. Returns the participant id. */
export function acceptParticipantProposal(id, { editedCells = null } = {}) {
  const p = participantProposals().find(x => x.id === id); if (!p) return null;
  const pid = addParticipant(p.study_id, { ...p.cells, ...(editedCells || {}) },
    { evidence: p.evidence, extractor: `model:${p.model || 'unknown'}${editedCells ? ' (edited)' : ''}`, run_id: p.run_id });
  update(s => { s.ipdProposals = (s.ipdProposals || []).filter(x => x.id !== id); return s; });
  return pid;
}

export function rejectParticipantProposal(id) {
  update(s => { s.ipdProposals = (s.ipdProposals || []).filter(x => x.id !== id); return s; });
}

export function setValue(participantId, columnId, value) {
  update(s => {
    s.participants = (s.participants || []).map(p =>
      p.id === participantId ? { ...p, [columnId]: value, updatedAt: new Date().toISOString() } : p);
    return s;
  });
}

export function removeParticipant(id) {
  update(s => {
    s.participants = (s.participants || []).filter(p => p.id !== id);
    return s;
  });
}

/** Reads a numeric cell without discarding text or silently converting an unknown value to zero. */
export function numeric(p, columnId) {
  const raw = p[columnId];
  if (raw == null || typeof raw === 'boolean') return null;
  const text = String(raw).trim();
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(text)) return null;
  const n = Number(text);
  return Number.isFinite(n) ? n : null;
}

export function boolish(p, columnId) {
  const raw = String(p[columnId] ?? '').trim().toLowerCase();
  if (['1', 'yes', 'y', 'true', 'progressed', 'event'].includes(raw)) return 1;
  if (['0', 'no', 'n', 'false', 'censored'].includes(raw)) return 0;
  return null;
}

/**
 * Cut points into labelled intervals, lower bound included: "< 40", "40–<60",
 * "≥ 60". The label list is the order groups are shown in.
 */
export function binLabels(cuts) {
  const c = [...new Set(cuts.map(Number).filter(Number.isFinite))].sort((a, b) => a - b);
  if (!c.length) return [];
  return [`< ${c[0]}`, ...c.slice(1).map((x, i) => `${c[i]}–<${x}`), `≥ ${c[c.length - 1]}`];
}

/** The interval label a value falls in. */
export function binOf(value, cuts) {
  const c = [...new Set(cuts.map(Number).filter(Number.isFinite))].sort((a, b) => a - b);
  const labels = binLabels(c);
  let i = 0;
  while (i < c.length && value >= c[i]) i++;
  return labels[i];
}

const blank = v => v == null || String(v).trim() === '';

/**
 * Rows ready for a time-to-event analysis, and the ones that could not be used,
 * from participants and columns alone (no store), so a test or a bench can call it.
 *
 * opts: group (a column id; null for one group; default the column with role
 * "group"), time, event (column ids; default their roles), bins (cut points for
 * a number column used as the group), cluster (column id, default study_id;
 * a patient without one is a cluster of its own), strata (column id),
 * covariates (column ids, complete cases), subset (a predicate on the
 * participant, or a list of participant ids), landmark and landmarkMode
 * ("reset", the default, restarts the clock at the landmark; "filter" keeps
 * the original times).
 *
 * A patient missing a follow-up time or an event status is reported, not
 * silently dropped: how many were excluded is part of the result.
 */
export function survivalRowsFrom(people, cols, opts = {}) {
  const find = id => {
    const c = cols.find(x => x.id === id);
    if (!c) throw new Error(`no column "${id}"`);
    return c;
  };
  const role = r => cols.find(c => c.role === r);
  const time = opts.time ? find(opts.time) : role('time');
  const event = opts.event ? find(opts.event) : role('event');
  const group = opts.group === undefined ? role('group') : opts.group === null ? null : find(opts.group);
  const strata = opts.strata === 'study_id' ? { id: 'study_id', name: 'source report', type: 'text' } : opts.strata ? find(opts.strata) : null;
  const covs = (opts.covariates || []).map(find);
  const bins = Array.isArray(opts.bins) && opts.bins.length ? opts.bins : null;
  const clusterId = opts.cluster === undefined ? 'study_id' : opts.cluster;
  const keep = typeof opts.subset === 'function' ? opts.subset
    : Array.isArray(opts.subset) ? (p => opts.subset.includes(p.id)) : null;
  const t0 = Number(opts.landmark) > 0 ? Number(opts.landmark) : 0;

  const label = (p, c) => {
    const raw = p[c.id];
    if (blank(raw)) return null;
    if (c.type === 'boolean') { const b = boolish(p, c.id); return b == null ? null : b ? 'Yes' : 'No'; }
    if (c.type === 'number' && c === group && bins) { const n = numeric(p, c.id); return n == null ? null : binOf(n, bins); }
    return String(raw).trim();
  };

  const rows = [], excluded = [];
  for (const p of people) {
    const t = time ? numeric(p, time.id) : null;
    const e = event ? boolish(p, event.id) : null;
    const g = group ? label(p, group) : 'All';
    if (t == null || t < 0) { excluded.push({ p, why: time && !blank(p[time.id]) ? 'invalid follow-up time' : 'no follow-up time' }); continue; }
    if (e == null) { excluded.push({ p, why: event && !blank(p[event.id]) ? 'unrecognised event status' : 'no event status' }); continue; }
    if (group && !g) { excluded.push({ p, why: 'no group' }); continue; }
    if (keep && !keep(p)) { excluded.push({ p, why: 'outside the subset' }); continue; }
    const row = { id: p.id, study_id: p.study_id, time: t, event: e, group: g || 'All',
      cluster: String((clusterId && !blank(p[clusterId]) ? p[clusterId] : null) ?? p.id) };
    if (strata) {
      const s = label(p, strata);
      if (!s) { excluded.push({ p, why: `no ${strata.name || strata.id}` }); continue; }
      row.strata = s;
    }
    if (covs.length) {
      const x = {};
      let missing = null;
      for (const c of covs) {
        const v = c.type === 'number' ? numeric(p, c.id) : label(p, c);
        if (v == null) { missing = c; break; }
        x[c.id] = v;
      }
      if (missing) { excluded.push({ p, why: `no ${missing.name || missing.id}` }); continue; }
      row.x = x;
    }
    rows.push(row);
  }

  let out = rows;
  if (t0) {
    out = landmarkRows(rows, t0, { reset: opts.landmarkMode !== 'filter' });
    const kept = new Set(out.map(r => r.id));
    for (const r of rows) if (!kept.has(r.id)) excluded.push({ p: people.find(p => p.id === r.id), why: 'follow-up ends by the landmark' });
  }

  // The group order a table is read in: the column's own levels, then the rest.
  const present = [...new Set(out.map(r => r.group))];
  let levels;
  if (group && bins) levels = binLabels(bins).filter(l => present.includes(l));
  else if (group?.type === 'boolean') levels = ['No', 'Yes'].filter(l => present.includes(l));
  else {
    const own = (group?.levels || []).filter(l => present.includes(l));
    levels = [...own, ...present.filter(l => !own.includes(l)).sort()];
  }
  return { rows: out, excluded, levels, groupName: group ? group.name || group.id : null };
}

/** The participants and columns held by the open project. */
export function survivalRows(opts = {}) {
  return survivalRowsFrom(participants(), columns(), opts);
}

/**
 * A landmark analysis: patients still under follow-up beyond t0, the clock
 * restarted at t0 (unless reset is false). Someone whose event or censoring
 * falls at t0 or earlier is not in the risk set at t0 and is left out.
 */
export function landmarkRows(rows, t0, { reset = true } = {}) {
  return rows.filter(r => r.time > t0).map(r => (reset ? { ...r, time: r.time - t0 } : { ...r }));
}

/** Rows kept by a predicate on the row, or by a list of participant ids. */
export function subsetRows(rows, subset) {
  if (Array.isArray(subset)) { const ids = new Set(subset); return rows.filter(r => ids.has(r.id)); }
  if (typeof subset === 'function') return rows.filter(r => subset(r));
  return rows;
}

// ---- CSV ----------------------------------------------------------------
export function toCsv() {
  const cols = columns();
  const head = ['study', ...cols.map(c => c.name)];
  const body = participants().map(p => [
    get().papers.find(x => x.id === p.study_id)?.label ?? p.study_id,
    ...cols.map(c => p[c.id] ?? ''),
  ]);
  return [head, ...body];
}

/**
 * Reads a table where each row is a patient. Columns are matched by name; a
 * column the schema does not know is added rather than discarded, because a
 * dropped variable is a silent change to the dataset.
 */
export function fromCsv(text) {
  const rows = parseCsv(text);
  if (rows.length < 2) return { added: 0, columns: 0 };
  const header = rows[0].map(h => h.trim());
  const cols = [...columns()];
  const byName = new Map(cols.map(c => [c.name.toLowerCase(), c]));
  const mapping = header.map(h => {
    if (/^stud(y|ies)$/i.test(h)) return { study: true };
    const known = byName.get(h.toLowerCase());
    if (known) return { col: known };
    const id = h.toLowerCase().replace(/[^a-z0-9]+/g, '_').slice(0, 32) || `c${cols.length}`;
    const created = { id, name: h, type: 'text' };
    cols.push(created);
    return { col: created, created: true };
  });
  const madeCols = mapping.filter(m => m.created).length;
  if (madeCols) setColumns(cols);

  const papers = get().papers;
  let added = 0;
  for (const row of rows.slice(1)) {
    if (!row.some(v => String(v).trim())) continue;
    const values = {};
    let studyId = null;
    row.forEach((v, i) => {
      const m = mapping[i];
      if (!m) return;
      if (m.study) {
        const label = String(v).trim();
        studyId = papers.find(p => p.label === label || p.title === label)?.id ?? label;
      } else values[m.col.id] = String(v).trim();
    });
    addParticipant(studyId, values);
    added++;
  }
  return { added, columns: madeCols };
}

/** Quote-aware, so a value containing a comma survives the round trip. */
function parseCsv(text) {
  const rows = [];
  let row = [], field = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c !== '\r') field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows;
}
