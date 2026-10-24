// Data follows its file (plan §2, 2026-10-24: "sync and link … detect the changes and automatically render it again"). A table, a list or a
// workbook the project was built from may be changed outside the app (by hand, by a script, by an agent through the MCP); when its bytes change
// the project reads it again and sets it against what was adopted (lib/drift.mjs: for each cell, its text then `f` and the app's value then `h`):
//
//   the file moved, the app did not     the cell takes the file's value (a take: the app never edited it)
//   the file moved, the app moved too   a conflict, listed with "Use the file's" and "Keep mine"; nothing is overwritten
//   the file did not move               nothing (the app may be ahead of it: lib/drift.mjs D5, a write back)
//   the file now agrees with the app    nothing but the record
//
// A value with no adoption cell counts as never edited when a file gave it (origin 'imported' from an import:… extractor), as edited otherwise;
// a value the file gives that the app has not got is added. This module is pure: lib/folder-sync.mjs reads the files and writes the state.
//
//   evidencePlan(s, { tid, entry, upd, prevPath })   the plan for an evidence table (lib/evidence-update.mjs evidenceUpdate of the file now)
//   ipdPlan(s, { entry, plan })                       the plan for a master list (lib/ipd-import.mjs ipdListFromRows of the file now)
//   applyPlan(st, plan)                               writes the takes, keeps the conflicts in st.autoSync.conflicts
//   followEntry(plan, base)                           the adoption entry after the plan (the conflicts' cells as they were adopted)
//   planText(plan)                                    the Changes entry's line: "Gao 2024: Screw loosening 0/25 (was NR); …"
//   settle(st, key, choice)                           "Use the file's" or "Keep mine" for one conflict; answers the record's new cell
import { norm, fileEntry } from './drift.mjs';
import { setValue, removeValues } from './value-import.mjs';

const clip = (t, n = 40) => { const x = norm(t).replace(/\s+/g, ' '); return x.length > n ? `${x.slice(0, n - 1)}…` : x || 'empty'; };
/** A value a file gave (an import), not one a person or the app wrote. */
export const fromAFile = v => v?.origin === 'imported' && /^import:/.test(String(v?.extractor || ''));
const paperOfKey = k => k.slice(0, k.indexOf(':'));

/** The name of a value key as a reader says it: "Gao 2024: Mechanical failure; revision (arm 2)". */
export function keyName(s, key) {
  const pid = paperOfKey(key), rest = key.slice(pid.length + 1), arm = /@(arm\d+)$/.exec(rest)?.[1], col = rest.replace(/@arm\d+$/, '');
  const paper = (s.papers || []).find(p => p.id === pid);
  const c = (s.templates || []).flatMap(t => t.columns || []).find(x => x.id === col);
  return `${paper?.label || pid}: ${c?.label || c?.name || col.split('.').pop()}${arm ? ` (${arm.replace('arm', 'arm ')})` : ''}`;
}

/**
 * The plan for an evidence table read again: `{ path, take: [{ key, name, from, to, value }], conflicts: [{ key, name, file, mine, adopted, value,
 * f }], same, studies }`. `upd` is evidenceUpdate of the file now (its values keyed like the app's, each citing its cell); `entry` the file's
 * adoption entry (a newer version's: the entry of the file it replaces), or null; `tid` the table. Only studies the file has a row for are read.
 */
export function evidencePlan(s, { tid, entry = null, upd, path }) {
  const tracked = new Map((entry?.cells || []).filter(c => c.k.startsWith('v:')).map(c => [c.k.slice(2), c]));
  const rows = new Set([...(upd.matched?.values() || [])].filter(Boolean));
  const inTable = k => { const col = k.slice(k.indexOf(':') + 1); return col.startsWith(`${tid}.`) || col.startsWith(`${upd.template?.id}.`); };
  const keys = new Set([...Object.keys(upd.values || {}), ...[...tracked.keys()].filter(k => rows.has(paperOfKey(k)) && inTable(k))]);
  const take = [], conflicts = [], refresh = [];
  let same = 0;
  for (const key of [...keys].sort()) {
    const nv = upd.values?.[key] || null, n1 = nv ? norm(nv.reported_value) : '';
    const cur = s.values?.[key], a1 = cur ? norm(cur.reported_value) : undefined, c = tracked.get(key);
    if ((a1 ?? '') === n1) { same++; if (nv && cur && !cur.locked) refresh.push({ key, value: nv }); continue; }   // they agree: the value cites the file now
    // with no adoption record there is no baseline for an empty cell: a value the app has not got is added only once the file was adopted
    if (!entry && !cur) continue;
    const base = c ? c.h : cur && fromAFile(cur) ? a1 : undefined;
    if (base !== undefined && n1 === base) { same++; continue; }               // the file did not move here (the app may be ahead)
    const edited = cur?.locked || (c ? a1 !== c.h : cur ? !fromAFile(cur) : false);
    const row = { key, name: keyName(s, key), from: a1 ?? '', to: n1, value: nv, f: nv ? norm(nv.reported_value) : '' };
    if (!edited) take.push(row);
    else conflicts.push({ key, name: row.name, file: n1, mine: a1 ?? '', adopted: base ?? '', value: nv, f: row.f, path });
  }
  return { path, kind: 'evidence', take, conflicts, refresh, same, studies: rows.size };
}

/**
 * The plan for a master list read again: each tracked patient cell (`p:<id>:<field>`) whose text moved. `rows` are the list's patients now
 * (lib/ipd-import.mjs ipdListFromRows: `{ row, raw: { field: { c, t } } }`), `patch(field, text, participant)` reads a text as the app holds it.
 */
export function ipdPlan(s, { entry, rows, patch, path }) {
  const parts = new Map((s.participants || []).map(p => [p.id, p])), byRow = new Map((rows || []).map(r => [r.row, r]));
  const take = [], conflicts = [];
  let same = 0;
  for (const c of entry?.cells || []) {
    const m = /^p:(.+):([a-z_]+)$/.exec(c.k), part = m && parts.get(m[1]);
    if (!part) continue;
    const r = byRow.get(part.src?.row), text = norm(r?.raw?.[m[2]]?.t);
    if (!r || text === c.f) { same++; continue; }
    const n1 = norm(patch(m[2], text, part)?.[m[2]] ?? text), a1 = norm(part[m[2]]);
    if (a1 === n1) { same++; continue; }
    const name = c.n || `${part.label || 'Patient'}: ${m[2]}`;
    if (a1 === c.h) take.push({ key: c.k, name, from: a1, to: n1, patient: m[1], field: m[2], text, f: text });
    else conflicts.push({ key: c.k, name, file: n1, mine: a1, adopted: c.h, patient: m[1], field: m[2], text, f: text, path });
  }
  return { path, kind: 'ipd', take, conflicts, refresh: [], same, studies: 0 };
}

/** Writes a plan's takes into `st` and keeps its conflicts (one per key; a later read of the file replaces an earlier conflict of the key). */
export function applyPlan(st, plan, { patch = null, at = '' } = {}) {
  for (const r of plan.refresh || []) { const cur = st.values?.[r.key]; if (cur && r.value?.evidence) setValue(st, r.key, { ...cur, evidence: r.value.evidence }); }
  for (const t of plan.take) {
    if (plan.kind === 'ipd') {
      st.participants = (st.participants || []).map(p => (p.id === t.patient ? { ...p, ...(patch ? patch(t.field, t.text, p) : { [t.field]: t.to }), updatedAt: at || p.updatedAt } : p));
    } else if (t.value) setValue(st, t.key, t.value);
    else removeValues(st, [t.key]);                                              // the file's cell is empty now
  }
  const mine = new Set(plan.conflicts.map(c => c.key)), took = new Set(plan.take.map(t => t.key));
  st.autoSync = st.autoSync || {};
  st.autoSync.conflicts = [...(st.autoSync.conflicts || []).filter(c => !mine.has(c.key) && !took.has(c.key)), ...plan.conflicts.map(c => ({ ...c, at }))];
  return st;
}

/**
 * The file's adoption entry after a plan: `base` is the entry the new file's import gives (each cell's text and value now); a conflict keeps
 * the value adopted before (so it still reads as both moved), and a cell the app is ahead in keeps its adopted value (still a write back).
 */
export function followEntry(base, old, plan) {
  const before = new Map((old?.cells || []).map(c => [c.k, c])), held = new Set(plan.conflicts.map(c => (plan.kind === 'ipd' ? c.key : `v:${c.key}`)));
  const cells = (base?.cells || []).map(c => {
    const was = before.get(c.k);
    if (!was) return c;
    if (held.has(c.k)) return { ...c, f: was.f, h: was.h };                    // a conflict: as it was adopted, until a person settles it
    if (c.f === was.f) return { ...c, h: was.h };                              // the file did not move here: the adopted value stands
    return c;
  });
  return fileEntry({ ...base, cells, file: base });
}

/** The Changes entry's line for a plan: the cells taken, by name, "Gao 2024: Screw loosening 0/25 (was NR)", the first few, then how many more. */
export function planText(plan, { most = 3 } = {}) {
  const parts = plan.take.slice(0, most).map(t => `${t.name} ${clip(t.to)} (was ${clip(t.from)})`);
  const more = plan.take.length - most;
  const conf = plan.conflicts.length ? `; ${plan.conflicts.length} edited here ${plan.conflicts.length === 1 ? 'differs' : 'differ'} from the file, kept until you choose` : '';
  return `${parts.join('; ')}${more > 0 ? `; ${more} more` : ''}${conf}`;
}

/**
 * One conflict settled in the state: "Use the file's" (`file`) puts the file's value where the app's was, "Keep mine" (`mine`) leaves the app's.
 * Answers the conflict (for the record: its cell now reads the file's text `f` and the file's value as adopted), or null.
 */
export function settle(st, key, choice, { patch = null, at = '' } = {}) {
  const c = (st.autoSync?.conflicts || []).find(x => x.key === key);
  if (!c || (choice === 'file' && !c.patient && st.values?.[key]?.locked)) return null;   // a locked value changes by amendment only
  if (c.rob) {
    const a = ((st.assessments ||= {})[c.rob.paper] ||= {})[c.rob.tool] ||= {};
    if (choice === 'file') a[c.rob.domain] = c.value;
    st.autoSync.robBase = { ...(st.autoSync.robBase || {}), [c.path]: { ...(st.autoSync.robBase?.[c.path] || {}), [c.key.slice(4)]: c.value } };
  } else if (choice === 'file') {
    if (c.patient) st.participants = (st.participants || []).map(p => (p.id === c.patient ? { ...p, ...(patch ? patch(c.field, c.text, p) : { [c.field]: c.file }), updatedAt: at || p.updatedAt } : p));
    else if (c.value) setValue(st, key, c.value);
    else removeValues(st, [key]);
  }
  st.autoSync.conflicts = st.autoSync.conflicts.filter(x => x.key !== key);
  // the record's cell holds the file's value either way: kept, the app's is ahead of it (a write back), and the next change of the file asks again
  return { ...c, held: c.file };
}
