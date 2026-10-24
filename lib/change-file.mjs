// A change file: how an agent (Claude or another) changes a project's data without a script of its own. The agent writes one JSON file
// and applies it with the `lykos` command line (cli/, Rust: `lykos apply <folder> <file>`) or, where that is not installed,
// `node tools/lykos-apply.mjs <folder> <file>`: under the project lock, with the editing card up (lib/agent-activity.mjs), a copy of the
// project in .lykos/backups first, and a record in .lykos/inbox/applied/ (`--undo` takes it back). The two tools apply the same ops with
// the same messages (cli/tests/golden.mjs). Pure of the store and the DOM: `applyChanges(state, file)` returns the next state or the errors.
//
//   { "kind": "lykos-changes", "v": 1, "by": "Claude", "what": "Hudson 2011 arm size", "changes": [ { "op": "set_value", ... }, ... ] }
//
// Every change applies or none does. Ops (CHANGE_FILE_OPS below documents each one's fields):
//   set_value, remove_value, set_prisma, set_protocol, set_criterion, add_amendment, add_task, update_task, remove_notes, remove_results, set, unset

export const KIND = 'lykos-changes';
const PICO = ['population', 'intervention', 'comparator', 'outcome', 'design', 'language'];
const LOCKED = new Set(['savedAt', 'saveToken', 'format']);
const now = () => new Date().toISOString();
const str = v => (v == null ? '' : String(v));

/** The record a reference names: its id, key, DOI or label ("Hudson 2011"). */
export function paperRef(s, ref) {
  const r = str(ref).trim(), low = r.toLowerCase();
  return (s.papers || []).find(p => p.id === r || p.key === r) || (s.papers || []).find(p => str(p.doi).toLowerCase() === low || str(p.label).toLowerCase() === low) || null;
}

/** A value's key from { key } or { paper, field, arm }: "paper:field" or "paper:field@armN". */
function valueKey(s, c) {
  if (c.key) { const id = str(c.key).slice(0, str(c.key).indexOf(':')); if (!paperRef(s, id)) throw new Error(`no record ${id}`); return str(c.key); }
  const p = paperRef(s, c.paper); if (!p) throw new Error(`no record ${c.paper}`);
  if (!c.field) throw new Error('set_value needs key, or paper and field');
  const field = str(c.field).includes('.') || !c.template ? str(c.field) : `${c.template}.${c.field}`;
  return `${p.id}:${field}${c.arm ? `@${/^arm/.test(c.arm) ? c.arm : `arm${c.arm}`}` : ''}`;
}

export const CHANGE_FILE_OPS = {
  set_value: { doc: '{key: "paper:field[@armN]" | paper + field (+ template, arm), value, note?, source?, evidence?: [{kind, ...}]}', does: (s, c) => {
    const k = valueKey(s, c), was = s.values[k], text = str(c.value), paper = k.slice(0, k.indexOf(':')), field = k.slice(k.indexOf(':') + 1).replace(/@.*$/, '');
    const at = now();
    s.values[k] = { ...(was || { paper_id: paper, study_id: paper, field_id: field, origin: 'imported', extractor: 'agent' }), reported_value: text, normalized_value: text,
      availability: /^(nr|not reported)$/i.test(text) ? 'not_found' : 'present', verification: 'accepted', at, verified_at: at,
      ...(c.note ? { note: str(c.note) } : {}), ...(c.source ? { source: str(c.source) } : {}), ...(c.evidence ? { evidence: c.evidence } : {}) };
    return `${k}: ${was ? `${str(was.reported_value)} → ` : ''}${text}`;
  } },
  remove_value: { doc: '{key: "paper:field[@armN]" | paper + field (+ template, arm)}: removes the value (a value for the study whose arms now have their own, or one entered in error)', does: (s, c) => {
    const k = valueKey(s, c), was = s.values?.[k];
    if (!was) throw new Error(`no value ${k}`);
    delete s.values[k];
    return `${k} removed (was ${str(was.reported_value)})`;
  } },
  set_prisma: { doc: '{field: PRISMA field id (records_screened, new_reports …), value?, note?: why a count was entered by hand}', does: (s, c) => {
    if (!c.field) throw new Error('set_prisma needs field');
    s.prisma ||= {};
    if ('value' in c) s.prisma[c.field] = str(c.value);
    if ('note' in c) { s.prismaNotes ||= {}; if (str(c.note).trim()) s.prismaNotes[c.field] = str(c.note); else delete s.prismaNotes[c.field]; }
    return `PRISMA ${c.field}${'value' in c ? ` = ${str(c.value)}` : ''}${c.note ? ' (explained)' : ''}`;
  } },
  set_protocol: { doc: `{field: title | ${PICO.join(' | ')}, value}`, does: (s, c) => {
    s.protocol ||= { pico: {}, criteria: [], amendments: [] };
    if (c.field === 'title') s.protocol.title = str(c.value);
    else if (PICO.includes(c.field)) { s.protocol.pico ||= {}; s.protocol.pico[c.field] = str(c.value); }
    else throw new Error(`no protocol field ${c.field}`);
    return `Protocol ${c.field}`;
  } },
  set_criterion: { doc: '{id: C1 | E19 …, kind?: include | exclude | group, text?, question?, yes?, no?, stage?}; adds it when new', does: (s, c) => {
    if (!c.id) throw new Error('set_criterion needs id');
    s.protocol ||= { pico: {}, criteria: [], amendments: [] }; s.protocol.criteria ||= [];
    const fields = Object.fromEntries(['kind', 'text', 'question', 'yes', 'no', 'stage'].filter(f => f in c).map(f => [f, str(c[f])]));
    const i = s.protocol.criteria.findIndex(x => x.id === c.id);
    if (i < 0) { if (!fields.text || !fields.kind) throw new Error(`a new criterion ${c.id} needs kind and text`); s.protocol.criteria.push({ id: str(c.id), ...fields }); }
    else s.protocol.criteria[i] = { ...s.protocol.criteria[i], ...fields };
    return `Criterion ${c.id}${i < 0 ? ' added' : ''}`;
  } },
  add_amendment: { doc: '{note, source?}', does: (s, c) => {
    if (!str(c.note).trim()) throw new Error('add_amendment needs note');
    s.protocol ||= { pico: {}, criteria: [], amendments: [] }; s.protocol.amendments ||= [];
    s.protocol.amendments.push({ at: now(), note: str(c.note), ...(c.source ? { source: str(c.source) } : {}) });
    return 'Protocol amendment';
  } },
  add_task: { doc: '{text, notes?, due?: YYYY-MM-DD, priority?: none | low | high}', does: (s, c) => {
    if (!str(c.text).trim()) throw new Error('add_task needs text');
    s.todos ||= [];
    const id = `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    s.todos.push({ id, text: str(c.text), done: false, due: str(c.due), at: now(), ...(c.notes ? { notes: str(c.notes) } : {}), ...(c.priority ? { priority: str(c.priority) } : {}) });
    return `Task: ${str(c.text).slice(0, 60)}`;
  } },
  update_task: { doc: '{id, text?, notes?, done?: true | false, due?}', does: (s, c) => {
    const t = (s.todos || []).find(x => x.id === c.id); if (!t) throw new Error(`no task ${c.id}`);
    for (const f of ['text', 'notes', 'due']) if (f in c) t[f] = str(c[f]);
    if ('done' in c) t.done = !!c.done;
    return `Task ${c.id}`;
  } },
  remove_notes: { doc: '{ids?: [note ids], extractor?: "model:" (prefix of who wrote them), contains?: text, papers?: [records]}: notes that match every filter given', does: (s, c) => {
    if (!c.ids && !c.extractor && !c.contains && !c.papers) throw new Error('remove_notes needs at least one filter');
    const ids = c.ids && new Set(c.ids), papers = c.papers && new Set(c.papers.map(r => paperRef(s, r)?.id || r));
    const hit = n => (!ids || ids.has(n.id)) && (!c.extractor || String(n.extractor || '').startsWith(c.extractor)) && (!c.contains || String(n.text || '').includes(c.contains)) && (!papers || papers.has(n.paper));
    const before = (s.notes || []).length; s.notes = (s.notes || []).filter(n => !hit(n));
    return `${before - s.notes.length} notes removed`;
  } },
  remove_results: { doc: '{ids?: [result ids], origin?: "chat"}: saved results off the Outputs list (the chats keep their answers)', does: (s, c) => {
    const ids = new Set(c.ids || []), before = (s.results || []).length;
    if (!ids.size && !c.origin) throw new Error('remove_results needs ids or origin');
    s.results = (s.results || []).filter(r => !(ids.has(r.id) || (c.origin && r.origin === c.origin)));
    return `${before - s.results.length} saved results removed`;
  } },
  set: { doc: '{path: ["synthesis", "settings", "signExcludeCritical"], value}: any other field, by its path from the top of the project', does: (s, c) => {
    const { parent, last } = walk(s, c.path, true); parent[last] = c.value; return `${c.path.join('.')} set`;
  } },
  unset: { doc: '{path}: removes a field (an entry of an object; an array entry by its index)', does: (s, c) => {
    const { parent, last } = walk(s, c.path, false);
    if (Array.isArray(parent)) parent.splice(Number(last), 1); else delete parent[last];
    return `${c.path.join('.')} removed`;
  } },
};

function walk(s, path, make) {
  if (!Array.isArray(path) || !path.length) throw new Error('path must be a non-empty list');
  if (LOCKED.has(path[0])) throw new Error(`${path[0]} is the app's own`);
  if (path[0] === 'values' && path.length > 1) throw new Error('use set_value for values (it keeps the value record whole)');
  let o = s;
  for (const k of path.slice(0, -1)) {
    if (o[k] == null) { if (!make) throw new Error(`no ${path.join('.')}`); o[k] = {}; }
    if (typeof o[k] !== 'object') throw new Error(`${k} in ${path.join('.')} is not an object`);
    o = o[k];
  }
  if (!make && !(path.at(-1) in o)) throw new Error(`no ${path.join('.')}`);
  return { parent: o, last: path.at(-1) };
}

/** Whether a parsed file is a change file, and what is wrong with it if not. */
export function checkFile(f) {
  if (!f || typeof f !== 'object' || f.kind !== KIND) return `not a change file (kind must be "${KIND}")`;
  if (!Array.isArray(f.changes) || !f.changes.length) return 'changes must be a non-empty list';
  const bad = f.changes.find(c => !CHANGE_FILE_OPS[c?.op]);
  return bad ? `unknown op ${bad?.op} (ops: ${Object.keys(CHANGE_FILE_OPS).join(', ')})` : '';
}

/** Applies every change of a file to a copy of the state: { state, applied: [lines] } or { errors: [lines] } (nothing applied). */
export function applyChanges(state, file) {
  const problem = checkFile(file);
  if (problem) return { errors: [problem] };
  const s = structuredClone(state); s.values ||= {};
  const applied = [], errors = [];
  file.changes.forEach((c, i) => { try { applied.push(CHANGE_FILE_OPS[c.op].does(s, c)); } catch (e) { errors.push(`change ${i + 1} (${c.op}): ${e.message}`); } });
  return errors.length ? { errors } : { state: s, applied };
}

/** The ops as one text, for an agent: `node tools/lykos-apply.mjs --ops`. */
export const opsText = () => Object.entries(CHANGE_FILE_OPS).map(([n, o]) => `${n} ${o.doc}`).join('\n');
