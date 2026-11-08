// Three-way merge of a project (plan §2, "Working as a team"). When another
// person's save lands between this window's read and its write, the store
// merges both against the copy it last read instead of setting its own edits
// aside: two reviewers' decisions on different records, a task added on each
// side, a comment and a resolved cell all survive. Only a value both sides
// changed differently is a conflict; the newer save wins it and the store
// keeps this window's copy for recovery.

const SKIP = new Set(['savedAt', 'saveToken']);   // stamps of a save, always the newer save's

const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v);

export function equal(a, b) {
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null || typeof a !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) return a.length === b.length && a.every((x, i) => equal(x, b[i]));
  const ka = Object.keys(a).filter(k => a[k] !== undefined), kb = Object.keys(b).filter(k => b[k] !== undefined);
  return ka.length === kb.length && ka.every(k => equal(a[k], b[k]));
}

// A list whose items each carry their own string id merges item by item. A log
// that names a record by id on each entry is not one: its ids repeat.
const ownIds = l => l === undefined || (Array.isArray(l) && l.every(x => isObj(x) && typeof x.id === 'string') && new Set(l.map(x => x.id)).size === l.length);
const keyed = (...lists) => lists.every(ownIds) && lists.some(l => l?.length);

function mergeKeyed(base = [], mine, theirs, path, conflicts) {
  const byId = l => new Map(l.map(x => [x.id, x]));
  const b = byId(base), m = byId(mine), t = byId(theirs);
  const ids = [...theirs.map(x => x.id), ...mine.map(x => x.id).filter(id => !t.has(id))];
  const out = [];
  for (const id of ids) {
    const v = merge(b.get(id), m.get(id), t.get(id), [...path, id], conflicts);
    if (v !== undefined) out.push(v);
  }
  return out;
}

// An append-only list (a log): both sides kept what was there and added to it.
function mergeAppended(base, mine, theirs) {
  if (!Array.isArray(base) || base.length > mine.length || base.length > theirs.length) return null;
  if (!base.every((x, i) => equal(x, mine[i]) && equal(x, theirs[i]))) return null;
  const added = theirs.slice(base.length);
  for (const x of mine.slice(base.length)) if (!added.some(y => equal(x, y))) added.push(x);
  return [...base, ...added];
}

function merge(base, mine, theirs, path, conflicts) {
  if (equal(mine, theirs)) return mine;
  if (equal(base, mine)) return theirs;
  if (equal(base, theirs)) return mine;
  if (isObj(mine) && isObj(theirs) && (base === undefined || isObj(base))) {
    const out = {};
    for (const k of new Set([...Object.keys(theirs), ...Object.keys(mine)])) {
      const v = SKIP.has(k) && !path.length ? theirs[k] : merge(base?.[k], mine[k], theirs[k], [...path, k], conflicts);
      if (v !== undefined) out[k] = v;
    }
    return out;
  }
  if (Array.isArray(mine) && Array.isArray(theirs)) {
    const appended = mergeAppended(base, mine, theirs);
    if (appended) return appended;
    if (keyed(base, mine, theirs)) return mergeKeyed(base, mine, theirs, path, conflicts);
  }
  conflicts.push(path.join('.'));
  return theirs;
}

/**
 * Merges `mine` and `theirs`, both changed from `base`. Answers the merged
 * project and the paths both sides changed differently (where `theirs` was kept).
 * Nothing given is changed; unchanged branches are shared with the inputs.
 */
export function mergeProjects(base, mine, theirs) {
  const conflicts = [];
  const merged = merge(base, mine, theirs, [], conflicts);
  return { merged, conflicts };
}
