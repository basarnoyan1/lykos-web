// Collections.
//
// Project-scoped, and a record may sit in several at once (plan C6). They are a
// way to organise work, not a property of the study, which is why membership
// lives on the collection rather than as a single folder on the record: a paper
// filed under "Insufficient dose" and "Awaiting full text" is in both, and
// neither is its home.
import { get, update } from '../store.mjs';

export const ROOT = null;

export const collections = () => get().collections || [];

export function tree(parent = ROOT) {
  return collections()
    .filter(c => (c.parent ?? null) === parent)
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(c => ({ ...c, children: tree(c.id) }));
}

export function add(name, parent = ROOT) {
  const id = `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  update(s => {
    s.collections = [...(s.collections || []), { id, name, parent: parent ?? null, members: [] }];
    return s;
  });
  return id;
}

export function rename(id, name) {
  update(s => {
    s.collections = (s.collections || []).map(c => c.id === id ? { ...c, name } : c);
    return s;
  });
}

/** Removing a collection never removes records; children move up a level. */
export function remove(id) {
  update(s => {
    const all = s.collections || [];
    const gone = all.find(c => c.id === id);
    s.collections = all
      .filter(c => c.id !== id)
      .map(c => (c.parent === id ? { ...c, parent: gone?.parent ?? null } : c));
    return s;
  });
}

export function setMembership(collectionId, paperId, member) {
  update(s => {
    s.collections = (s.collections || []).map(c => {
      if (c.id !== collectionId) return c;
      const members = new Set(c.members || []);
      member ? members.add(paperId) : members.delete(paperId);
      return { ...c, members: [...members] };
    });
    return s;
  });
}

export const membersOf = id => new Set(collections().find(c => c.id === id)?.members || []);

export const collectionsOf = paperId =>
  collections().filter(c => (c.members || []).includes(paperId));

/** A collection's count includes everything filed beneath it. */
export function countIn(id) {
  const seen = new Set();
  const walk = cid => {
    const c = collections().find(x => x.id === cid);
    if (!c) return;
    (c.members || []).forEach(m => seen.add(m));
    collections().filter(x => x.parent === cid).forEach(x => walk(x.id));
  };
  walk(id);
  return seen.size;
}

/** Records in a collection or any of its descendants. */
export function papersIn(id) {
  const ids = new Set();
  const walk = cid => {
    const c = collections().find(x => x.id === cid);
    if (!c) return;
    (c.members || []).forEach(m => ids.add(m));
    collections().filter(x => x.parent === cid).forEach(x => walk(x.id));
  };
  walk(id);
  return get().papers.filter(p => ids.has(p.id));
}
