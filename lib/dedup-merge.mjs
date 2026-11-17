// Merging a duplicate record into the one kept, and undoing it (moved out of lib/dedup-core.mjs on 31 Oct 2026, which the shell's
// first view loads for the Library's Duplicates filter). Nothing merges without a person or a change file.

import { lib_search_library$addMainRecords as addMainRecords } from "../boot.mjs";

function containsId(value, id, seen = new WeakSet()) {
  if (typeof value === 'string')
    return value === id || value.includes(`[@${id}]`) || value.includes(`[@${id} `);
  if (!value || typeof value !== 'object' || seen.has(value)) return false;
  seen.add(value);
  return Object.entries(value).some(([key, child]) =>
    key === id || key.startsWith(`${id}:`) || containsId(child, id, seen));
}
// containsId for many values, which a merge asks of every record and section: one `seen` for them all (a value found not to name the id is
// not walked again; a walk that finds it ends there), keys without entries and the needles made once. It was three quarters of a merge's
// time, a walk of the project per pair: 100 merges of 30,000 records took 2.8 s (15 Nov 2026).
function idFinder(id) {
  const cite = `[@${id}`, field = `${id}:`, seen = new WeakSet();
  const keyed = key => key === id || key.startsWith(field);
  // "[@id]" or "[@id " in one scan of the text (the abstracts are most of a project's text)
  const cited = text => {
    for (let i = text.indexOf(cite); i >= 0; i = text.indexOf(cite, i + 1)) { const c = text[i + cite.length]; if (c === ']' || c === ' ') return true; }
    return false;
  };
  const has = value => {
    if (typeof value === 'string') return value === id || cited(value);
    if (!value || typeof value !== 'object' || seen.has(value)) return false;
    seen.add(value);
    for (const key of Object.keys(value)) if (keyed(key) || has(value[key])) return true;
    return false;
  };
  // a record's fields but those in `skip` (whose keys still count); the record itself is not marked seen, as the copy containsId was given
  has.fields = (value, skip) => {
    for (const key of Object.keys(value)) if (keyed(key) || (!skip.includes(key) && has(value[key]))) return true;
    return false;
  };
  return has;
}

// Screening decisions follow a merge (31 Oct 2026): the sham review's Scopus v3 import left 143 duplicates that had already been
// screened, and the merge refused them as "linked screening". A decision is never lost: each stage keeps the more advanced
// decision (include over exclude, and either over uncertain, which is undecided), with its own history, and a conflict is written into the kept decision's note
// beside the other record's decision. The decisions as they were are kept on the merge, so an unmerge puts both back. A protocol scenario's
// own decisions (s.scenarioScreening, 1 Nov 2026) follow the same way.
const STAGE_KEYS = [['ta', 'screening', 'title and abstract'], ['ft', 'fulltext', 'full text']];
// uncertain is undecided (lib/prisma-counts.mjs pending): any decision is more advanced than it, and include than exclude
const RANK = { include: 3, exclude: 2, uncertain: 1 };
const rank = d => RANK[d?.decision] || 0;
const said = d => `${d.decision}${d.reason ? ` (${d.reason})` : ''}`;
// what a merge moves itself; any other area that names the duplicate is linked work the merge refuses
const MOVED = ['papers', 'merged', 'dedupDismissed', 'libraryTrash', 'settings', 'screening', 'fulltext', 'screeningLog', 'dual', 'scenarioScreening', 'scenarioPapers', 'scenarioMerged', 'modelInstructions'];
// a record's PDF and the fields that go with it (change-file attach_pdf), carried to the kept record when only the duplicate has one
const PDF_FIELD = f => /^pdf/.test(f) || f === 'folderNo';
const same = (x, y) => JSON.stringify(x) === JSON.stringify(y);

// Model-instruction runs follow a merge (9 Nov 2026): each run lists the records it decided (lib/model-instructions.mjs), and the sham
// review's 21 duplicate pairs were all refused as "linked modelInstructions". The duplicate's id becomes the kept id in each run (once);
// anything else in s.modelInstructions that names the duplicate is still linked work.
function runsLinked(s, id) {
  const mi = s.modelInstructions;
  if (!mi || typeof mi !== 'object') return false;
  const runs = Object.fromEntries(Object.entries(mi.runs || {}).map(([k, r]) => [k, r && typeof r === 'object' ? { ...r, records: undefined } : r]));
  return containsId({ ...mi, runs }, id);
}
function moveRuns(s, keepId, dupId) {
  const saved = {};
  for (const [rid, run] of Object.entries(s.modelInstructions?.runs || {})) {
    if (!Array.isArray(run?.records) || !run.records.includes(dupId)) continue;
    const before = [...run.records];
    run.records = [...new Set(run.records.map(id => (id === dupId ? keepId : id)))];
    saved[rid] = { before, after: [...run.records] };
  }
  return saved;
}
function restoreRuns(s, dupId, saved) {
  for (const [rid, { before, after }] of Object.entries(saved || {})) {
    const run = s.modelInstructions?.runs?.[rid];
    if (!run) continue;
    // a run changed since the merge keeps its change and names the duplicate again
    if (same(run.records, after)) run.records = [...before];
    else if (!(run.records || []).includes(dupId)) run.records = [...(run.records || []), dupId];
  }
}

// the decision a stage keeps when two records merge: the more advanced, the other written into its note
function combine(k, d, keep, dup, name) {
  if (!k) return { kept: { ...d }, from: dup.id };
  if (k.decision === d.decision) return { kept: k, from: keep.id };
  const dupWins = rank(d) > rank(k), win = dupWins ? d : k, lose = dupWins ? k : d;
  const line = `Merged with ${dupWins ? keep.label || keep.id : dup.label || dup.id} (${dupWins ? keep.id : dup.id}), whose ${name} decision was ${said(lose)}${lose.at ? ` on ${String(lose.at).slice(0, 10)}` : ''}; ${win.decision} kept as the more advanced decision.`;
  return { kept: { ...win, note: [win.note, line].filter(Boolean).join(' | ') }, from: dupWins ? dup.id : keep.id, conflict: `${name}: ${said(win)} kept over ${said(lose)}` };
}

function mergeDecisions(s, keep, dup, at, { main = true } = {}) {
  const saved = {}, notes = [];
  // main's decisions only between main's records: a protocol scenario's own records (s.scenarioPapers) take none
  for (const [stage, key, name] of main ? STAGE_KEYS : []) {
    const k = s[key]?.[keep.id], d = s[key]?.[dup.id];
    if (!d) continue;
    saved[key] = { keep: k ? structuredClone(k) : null, dup: structuredClone(d) };
    s[key] = s[key] || {};
    delete s[key][dup.id];
    const { kept, from, conflict } = combine(k, d, keep, dup, name);
    if (conflict) notes.push(conflict);
    s[key][keep.id] = kept;
    saved[key].after = structuredClone(kept);
    (s.screeningLog ||= []).push({ action: 'merge', stage, id: keep.id, from: dup.id, decision: kept.decision,
      ...(k ? { prior: k.decision } : {}), other: d.decision, kept: from, at });
  }
  // a protocol scenario's own decisions (lib/scenarios.mjs, s.scenarioScreening) follow as main's do, scenario by scenario
  for (const [sc, lane] of Object.entries(s.scenarioScreening || {})) for (const [stage, , name] of STAGE_KEYS) {
    const byId = lane?.[stage], d = byId?.[dup.id];
    if (!d) continue;
    const k = byId[keep.id], { kept, from } = combine(k, d, keep, dup, name);
    delete byId[dup.id];
    byId[keep.id] = kept;
    ((saved.scenarioScreening ||= {})[sc] ||= {})[stage] = { keep: k ? structuredClone(k) : null, dup: structuredClone(d), after: structuredClone(kept) };
    (s.screeningLog ||= []).push({ action: 'merge', stage, id: keep.id, from: dup.id, decision: kept.decision,
      ...(k ? { prior: k.decision } : {}), other: d.decision, kept: from, scenario: sc, at });
  }
  // two reviewers' own decisions (main's only): the duplicate's move across where the kept record has none from that reviewer
  for (const [stage, byId] of Object.entries(main ? s.dual || {} : {})) {
    const d = byId?.[dup.id];
    if (!d) continue;
    saved.dual = { ...(saved.dual || {}), [stage]: { keep: byId[keep.id] ? structuredClone(byId[keep.id]) : null, dup: structuredClone(d) } };
    byId[keep.id] = { ...d, ...(byId[keep.id] || {}) };
    delete byId[dup.id];
  }
  return { saved, notes };
}

// where a record is: main's (s.papers, its merges s.merged) or one only a protocol scenario's runs found (s.scenarioPapers, s.scenarioMerged)
function sectionOf(s, id) {
  for (const [list, merged] of [['papers', 'merged'], ['scenarioPapers', 'scenarioMerged']]) {
    const rec = (s[list] || []).find(p => p.id === id);
    if (rec) return { list, merged, rec };
  }
  return null;
}

/**
 * Merges a duplicate record into the one kept. Fails before changing anything when linked work would be lost that a merge cannot
 * carry (values, appraisals and other areas that name the duplicate, another record that cites it). What it can carry it carries:
 * model-instruction runs name the kept record instead (once), a PDF only the duplicate has moves to the kept record (with both, the
 * kept record's stays and the other's path is kept on the merge, mergedFrom[].otherPdf), and the duplicate's own earlier merges fold
 * into the kept record; an unmerge puts each back. Screening decisions
 * follow (mergeDecisions); the duplicate's databases stay counted through `s.merged` (lib/prisma-counts.mjs flowArms). Two records
 * only a protocol scenario's runs found merge the same way in their own section (s.scenarioPapers, s.scenarioMerged). A scenario's record
 * found to be one of main's is merged into main's record, whichever was named to keep, and main's numbers do not move: nothing is
 * copied onto main's record, the merge is the scenario's (s.scenarioMerged), and main's record holds the scenario's decisions on it.
 */
export function mergeRecords(s, keepId, dupId) { return mergePair(s, keepId, dupId, walkLinks); }

// How many times a merge walked the whole project for its link check (a pair's walk or a batch's index): tests count them.
export const mergeLinkWalks = { count: 0 };

// The link check, one pair's walk of the project: another record that names the duplicate (but by the merges it absorbed, and the kept
// record by its mark that it is this duplicate), an area a merge does not carry, model-instruction runs but their records.
function walkLinks(s, keep, dupId, settles) {
  mergeLinkWalks.count++;
  const names = idFinder(dupId), skip = ['mergedFrom'], skipKeep = settles ? ['mergedFrom', 'duplicateOf'] : skip;
  for (const list of [s.papers || [], s.scenarioPapers || []]) for (const p of list)
    if (p.id !== dupId && names.fields(p, p === keep ? skipKeep : skip)) throw new Error('Another record links to this record. Keep this record instead.');
  for (const area of Object.keys(s)) {
    if (MOVED.includes(area)) continue;
    if (names(s[area])) throw new Error(`This record has linked ${area}. Keep that record instead.`);
  }
  if (runsLinked(s, dupId)) throw new Error('This record has linked modelInstructions. Keep that record instead.');
}

const KEY = '\u0000key';   // a record's field whose own name names the id (it counts even where the field's value is skipped)
// The same check for many pairs from one walk (15 Nov 2026, work queue row 3): every id each record, area and the runs name, of all the
// records' ids. A merge changes only the kept record's fields, removes the duplicate and writes areas the check skips (MOVED), so after each
// merge the duplicate's names leave the index and the kept record's are read again: pair k sees pairs 1 to k-1 as they landed. Null (each
// pair walks) when something a merge changes in place is reachable from what the check reads, or a record has no string id.
function linkIndex(s) {
  mergeLinkWalks.count++;
  const ids = new Set(), changed = new WeakSet(), lists = [s.papers || [], s.scenarioPapers || []];
  const mark = v => { if (v && typeof v === 'object') changed.add(v); return v; };
  for (const list of lists) {
    mark(list);
    for (const p of list) { if (!p || typeof p !== 'object' || typeof p.id !== 'string' || changed.has(p)) return null; mark(p); ids.add(p.id); }
  }
  for (const key of ['merged', 'scenarioMerged']) for (const m of mark(s[key]) || []) mark(m);
  for (const key of ['screening', 'fulltext', 'screeningLog', 'dual', 'scenarioScreening', 'modelInstructions']) mark(s[key]);
  for (const byId of Object.values(s.dual || {})) mark(byId);
  for (const lane of Object.values(s.scenarioScreening || {})) for (const byId of Object.values(mark(lane) || {})) mark(byId);
  for (const run of Object.values(mark(s.modelInstructions?.runs) || {})) mark(mark(run)?.records);
  let maxLen = 0, shared = false;
  for (const id of ids) maxLen = Math.max(maxLen, id.length);
  const keyed = (key, out) => {
    if (ids.has(key)) out.add(key);
    for (let c = key.indexOf(':'); c >= 0; c = key.indexOf(':', c + 1)) { const id = key.slice(0, c); if (ids.has(id)) out.add(id); }
  };
  const walk = (value, out, seen) => {
    if (typeof value === 'string') {
      if (ids.has(value)) out.add(value);
      // "[@id]" or "[@id ": every prefix after "[@" that ends before a "]" or a space
      for (let i = value.indexOf('[@'); i >= 0; i = value.indexOf('[@', i + 1)) {
        const end = Math.min(value.length - 1, i + 2 + maxLen);
        for (let j = i + 2; j <= end; j++) if (value[j] === ']' || value[j] === ' ') { const id = value.slice(i + 2, j); if (ids.has(id)) out.add(id); }
      }
      return;
    }
    if (!value || typeof value !== 'object' || seen.has(value)) return;
    seen.add(value);
    if (changed.has(value)) shared = true;
    for (const key of Object.keys(value)) { keyed(key, out); walk(value[key], out, seen); }
  };
  const byId = new Map(), of = new Map();   // id -> Map(record -> the fields naming it); record -> the ids it names
  const add = p => {
    const named = new Set(), seen = new WeakSet();
    const note = (id, field) => {
      if (id === p.id) return;   // a record naming itself is never checked (the duplicate's own fields are not)
      let holders = byId.get(id); if (!holders) byId.set(id, holders = new Map());
      let fields = holders.get(p); if (!fields) holders.set(p, fields = new Set());
      fields.add(field); named.add(id);
    };
    for (const field of Object.keys(p)) {
      const out = new Set(); keyed(field, out); for (const id of out) note(id, KEY);
      if (field === 'mergedFrom') continue;
      const inner = new Set(); walk(p[field], inner, seen); for (const id of inner) note(id, field);
    }
    of.set(p, named);
  };
  const remove = p => { for (const id of of.get(p) || []) byId.get(id)?.delete(p); of.delete(p); };
  for (const list of lists) for (const p of list) add(p);
  const areas = new Map();   // id -> the areas naming it
  for (const area of Object.keys(s)) {
    if (MOVED.includes(area)) continue;
    const out = new Set(); walk(s[area], out, new WeakSet());
    for (const id of out) { let a = areas.get(id); if (!a) areas.set(id, a = new Set()); a.add(area); }
  }
  const runs = new Set(), mi = s.modelInstructions;
  if (mi && typeof mi === 'object') {
    const copies = Object.fromEntries(Object.entries(mi.runs || {}).map(([k, r]) => [k, r && typeof r === 'object' ? { ...r, records: undefined } : r]));
    walk({ ...mi, runs: copies }, runs, new WeakSet());
  }
  if (shared) return null;
  return {
    ids,
    check(keep, dupId, settles) {
      for (const [p, fields] of byId.get(dupId) || []) {
        if (p.id === dupId) continue;
        if (p !== keep || !settles || [...fields].some(f => f !== 'duplicateOf')) throw new Error('Another record links to this record. Keep this record instead.');
      }
      const named = areas.get(dupId);
      if (named) for (const area of Object.keys(s)) if (!MOVED.includes(area) && named.has(area)) throw new Error(`This record has linked ${area}. Keep that record instead.`);
      if (runs.has(dupId)) throw new Error('This record has linked modelInstructions. Keep that record instead.');
    },
    landed(keep, dup, across) { remove(dup); if (!across) { remove(keep); add(keep); } },
  };
}

/**
 * mergeRecords for a batch of pairs, each seeing the ones before it as they landed (a chain, a record merged away, a refusal): one walk of
 * the project for all their link checks instead of one per pair (change files' merge_records, folder-init.mjs applyMerges). Only merges may
 * change `s` between its calls; the caller makes a new one after anything else.
 */
export function recordMerger(s) {
  let index, open = false;   // index: undefined until the first pair's check, null once it cannot be trusted (then each pair walks)
  const check = (s, keep, dupId, settles) => {
    if (index === undefined) try { index = linkIndex(s); } catch { index = null; }   // a section that cannot be read: the pair's walk says so
    if (index && index.ids.has(dupId)) index.check(keep, dupId, settles); else walkLinks(s, keep, dupId, settles);
    open = true;
  };
  const landed = (keep, dup, across) => { index?.landed(keep, dup, across); open = false; };
  return (keepId, dupId) => {
    // a merge that throws after its check may have changed part of the project: the index is not trusted after it
    try { return mergePair(s, keepId, dupId, check, landed); } finally { if (open) { index = null; open = false; } }
  };
}

function mergePair(s, keepId, dupId, checkLinks, landed) {
  if (keepId === dupId) throw new Error('Choose two different records.');
  let k = sectionOf(s, keepId), d = sectionOf(s, dupId);
  if (!k || !d) throw new Error('A record is no longer in the library.');
  const across = k.list !== d.list;
  if (across && k.list !== 'papers') [k, d] = [d, k];
  const keep = k.rec, dup = d.rec;
  keepId = keep.id; dupId = dup.id;
  // within a section the duplicate's earlier merges fold into the kept record and its PDF is carried; a scenario's record merged into
  // main's copies nothing onto main's record, so there they are still refused
  if (across && dup.mergedFrom?.length)
    throw new Error('The record being removed holds earlier merges. Keep that record instead, or undo its merges first.');
  if (across && dup.pdf && !keep.pdf)
    throw new Error('The record being removed owns a PDF. Keep that record instead.');
  // a record that names the duplicate only as one it absorbed earlier (an id a later import brought back) is not a link
  // nor is the kept record's own mark that it is a duplicate of this one (lib/identify.mjs duplicateOf): the merge settles it
  const settles = !across && keep.duplicateOf === dupId;
  checkLinks(s, keep, dupId, settles);
  const at = new Date().toISOString();
  const index = s[d.list].findIndex(p => p.id === dupId);
  const runs = moveRuns(s, keepId, dupId), withRuns = Object.keys(runs).length ? { runs } : {};
  if (across) {
    const { saved } = mergeDecisions(s, keep, dup, at, { main: false });
    s.scenarioPapers.splice(index, 1);   // at its place, where a filter and a copy per merge were a pass over every record
    (s.scenarioMerged ||= []).push({ keepId, dup, at, index, across: true, ...(Object.keys(saved).length ? { decisions: saved } : {}), ...withRuns });
    landed?.(keep, dup, true);
    return s;
  }
  const copied = {};
  for (const field of ['doi', 'pmid', 'journal', 'year', 'volume', 'issue', 'pages', 'url', 'abstract']) {
    if (!keep[field] && dup[field]) { copied[field] = dup[field]; keep[field] = dup[field]; }
  }
  // the PDF: the duplicate's moves across when the kept record has none; with both, the kept record's stays and the other's path is recorded
  let otherPdf = null;
  if (dup.pdf && !keep.pdf) {
    for (const field of Object.keys(dup).filter(PDF_FIELD)) if (keep[field] == null && dup[field] != null) { copied[field] = structuredClone(dup[field]); keep[field] = structuredClone(dup[field]); }
  } else if (dup.pdf && keep.pdf) {
    otherPdf = Object.fromEntries(['pdfRel', 'pdfName', 'pdfHash', 'pdfMode'].filter(f => dup[f] != null).map(f => [f, dup[f]]));
  }
  // the duplicate's earlier merges fold into the kept record: their entries now name the kept record, so their databases stay counted there
  const folded = [];
  for (const m of s[k.merged] || []) if (m?.keepId === dupId && m.dup) { m.keepId = keepId; folded.push({ id: m.dup.id, at: m.at }); }
  const foldedFrom = (dup.mergedFrom || []).map(m => ({ ...m, copied: {}, folded: dupId }));
  const { saved, notes } = mergeDecisions(s, keep, dup, at, { main: k.list === 'papers' });
  const marks = settles ? { duplicateOf: keep.duplicateOf, ...(keep.identified ? { identified: keep.identified } : {}) } : null;
  if (settles) { delete keep.duplicateOf; if (keep.identified === 'duplicate') delete keep.identified; }
  keep.mergedFrom = [...(keep.mergedFrom || []), ...foldedFrom, { id: dupId, at, copied, ...(notes.length ? { conflicts: notes } : {}), ...(marks ? { marks } : {}),
    ...(otherPdf ? { otherPdf } : {}), ...(folded.length ? { folded } : {}) }];
  s[k.list].splice(index, 1);
  (s[k.merged] ||= []).push({ keepId, dup, at, index, ...(Object.keys(saved).length ? { decisions: saved } : {}), ...withRuns, ...(folded.length ? { folded } : {}) });
  landed?.(keep, dup, false);
  return s;
}

export function unmergeRecords(s, keepId, dupId) {
  // the latest merge of this pair (a record a later import brought back can be merged into the same record again), main's or a scenario's
  const find = key => (s[key] || []).findLastIndex(m => m.keepId === keepId && m.dup.id === dupId);
  const mergedKey = find('merged') >= 0 ? 'merged' : 'scenarioMerged', at = find(mergedKey);
  const entry = at < 0 ? null : s[mergedKey][at];
  // a copy repaired on load (lib/search-library.mjs separateRecords) has main's id: it never goes back beside it
  if (!entry || entry.repaired) return s;
  // a scenario's record merged into main's (across) goes back to the scenario's records; nothing on main's record changed
  const listKey = mergedKey === 'merged' ? 'papers' : 'scenarioPapers';
  const keep = entry.across ? null : (s[listKey] || []).find(p => p.id === keepId);
  if (keep) {
    const record = (keep.mergedFrom || []).findLast(m => m.id === dupId);
    if (record?.copied) {
      for (const [field, value] of Object.entries(record.copied))
        if (same(keep[field], value)) delete keep[field];
    } else if (record?.before) {
      // Earlier versions saved a full before snapshot.
      for (const field of ['doi', 'pmid', 'journal', 'year', 'pdf', 'pdfName', 'authors', 'abstract', 'language']) {
        if (same(keep[field], entry.dup[field]) && !same(record.before[field], entry.dup[field])) {
          if (Object.hasOwn(record.before, field)) keep[field] = record.before[field];
          else delete keep[field];
        }
      }
    }
    if (record?.marks) Object.assign(keep, record.marks);
    const i = (keep.mergedFrom || []).lastIndexOf(record);
    keep.mergedFrom = (keep.mergedFrom || []).filter((m, j) => j !== i && m.folded !== dupId);
  }
  // the duplicate's own earlier merges, folded into the kept record, go back to it (entry.dup still holds its mergedFrom)
  for (const f of entry.folded || []) for (const m of s[mergedKey] || []) if (m?.keepId === keepId && m.dup?.id === f.id && m.at === f.at) m.keepId = dupId;
  restoreRuns(s, dupId, entry.runs);
  // the decisions as they were before the merge: the kept record's back (unless changed since), the duplicate's back to it
  const now = new Date().toISOString();
  for (const [stage, key] of STAGE_KEYS) {
    const d = entry.decisions?.[key];
    if (!d) continue;
    s[key] = s[key] || {};
    // a decision made on the kept record since the merge stays
    if (!d.after || JSON.stringify(s[key][keepId]) === JSON.stringify(d.after)) { if (d.keep) s[key][keepId] = d.keep; else delete s[key][keepId]; }
    s[key][dupId] = d.dup;
    (s.screeningLog ||= []).push({ action: 'unmerge', stage, id: keepId, from: dupId, decision: d.dup.decision, at: now });
  }
  for (const [sc, lane] of Object.entries(entry.decisions?.scenarioScreening || {})) for (const [stage, d] of Object.entries(lane || {})) {
    const byId = ((s.scenarioScreening ||= {})[sc] ||= {})[stage] ||= {};
    if (!d.after || JSON.stringify(byId[keepId]) === JSON.stringify(d.after)) { if (d.keep) byId[keepId] = d.keep; else delete byId[keepId]; }
    byId[dupId] = d.dup;
    (s.screeningLog ||= []).push({ action: 'unmerge', stage, id: keepId, from: dupId, decision: d.dup.decision, scenario: sc, at: now });
  }
  for (const [stage, d] of Object.entries(entry.decisions?.dual || {})) {
    const byId = (s.dual ||= {})[stage] ||= {};
    if (d.keep) byId[keepId] = d.keep; else delete byId[keepId];
    byId[dupId] = d.dup;
  }
  const list = s[listKey] ||= [];
  if (!list.some(p => p.id === dupId)) {
    const at = Math.min(entry.index ?? list.length, list.length);
    if (listKey === 'papers') addMainRecords(s, [entry.dup], { at }); else list.splice(at, 0, entry.dup);
  }
  s[mergedKey] = (s[mergedKey] || []).filter((m, j) => j !== at);
  return s;
}
