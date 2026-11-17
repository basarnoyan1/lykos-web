// The chat tools' argument contract (assistant accuracy, Fable review 15 Nov 2026): a small model names a record by whichever word it saw
// last (the context's rows say paper_id, ten tools take paper, two doc_id, one paperId), and a wrong name used to read as an empty record
// ('no record ""'). Here a record word is read as the one the tool takes, and said so; a required argument still missing, or one the tool
// does not take, is named with the tool's own arguments, so the next call can be right. Nothing is guessed beyond a renamed key.

const RECORD_WORDS = ['paper', 'paper_id', 'paperId', 'record', 'record_id', 'recordId', 'doc_id', 'docId', 'document', 'study', 'study_id'];
// in a propose_changes item the record field is `paper`; `id` there names a task, criterion or note, never a record
const CHANGE_RECORD_WORDS = RECORD_WORDS.filter(w => w !== 'paper');

/**
 * `args` as `schema` (a tool's parameters) reads them: { args, notes, error }. `notes` say what was read as what and what was ignored;
 * `error` names a required record that is missing, with what the tool takes.
 */
export function fitArgs(name, schema, args) {
  const props = schema?.properties || {}, known = new Set(Object.keys(props)), out = { ...args }, notes = [];
  const target = RECORD_WORDS.find(w => known.has(w));
  if (target && out[target] == null) {
    // `id` is read as the record only by a tool whose record word is not `id` and that takes no `id` of its own
    const from = [...RECORD_WORDS, ...(known.has('id') ? [] : ['id'])].find(w => w !== target && out[w] != null && !known.has(w));
    if (from) { out[target] = out[from]; delete out[from]; notes.push(`read ${from} as ${target}`); }
  }
  if (name === 'propose_changes' && Array.isArray(out.changes)) out.changes = out.changes.map((c, i) => {
    if (!c || typeof c !== 'object' || c.paper != null) return c;
    const from = CHANGE_RECORD_WORDS.find(w => c[w] != null);
    if (!from) return c;
    const { [from]: v, ...rest } = c; notes.push(`change ${i + 1}: read ${from} as paper`); return { ...rest, paper: v };
  });
  const takes = () => Object.keys(props).join(', ') || 'no arguments';
  const unknown = Object.keys(out).filter(k => !known.has(k));
  if (unknown.length && Object.keys(props).length) notes.push(`${name} takes ${takes()}; ignored ${unknown.map(k => `"${k}"`).join(', ')}`);
  // only a missing record is refused here: it is the one a tool read as an empty record; other required arguments keep the tool's own
  // handling (propose_changes runs without its summary)
  const error = target && (schema?.required || []).includes(target) && (out[target] == null || out[target] === '')
    ? `error: ${name} needs "${target}", a record id or label from query_library. It takes: ${takes()}.` : '';
  return { args: out, notes, error };
}

const words = t => String(t ?? '').toLowerCase().match(/[\p{L}\p{N}]+/gu) || [];
/** For a record reference that names none: up to three records whose label, id or DOI shares a word with it, as "label (id)". */
export function closestRecords(state, ref, limit = 3) {
  const want = new Set(words(ref).filter(w => w.length > 1));
  if (!want.size) return [];
  return (state?.papers || []).map(p => {
    const have = new Set([...words(p.label), ...words(p.id), String(p.year || '')]);
    let n = 0; for (const w of want) if (have.has(w)) n += /^\d+$/.test(w) ? 1 : 2;
    return { p, n };
  }).filter(x => x.n > 0).sort((a, b) => b.n - a.n).slice(0, limit).map(({ p }) => `${p.label || p.id} (${p.id})`);
}
/** The error for a reference that names no record: what was asked, the closest records, and where ids come from. */
export const noRecord = (state, ref) => {
  const near = closestRecords(state, ref);
  return `no record "${String(ref ?? '').trim().slice(0, 60)}"${near.length ? `; closest: ${near.join(', ')}` : ''}; use an id from query_library`;
};
