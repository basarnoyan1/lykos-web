// The `dependencies` source of the query layer (lib/project-query.mjs): one row per dependency of the project, so the question "what depends on what" is
// filtered, grouped and counted like any other table. Loaded on first use; the project's state alone is read (files and commits are read by the
// Dependencies tab and tools/lykos-deps.mjs, which have the folder).
import { registerSource } from './project-query.mjs';
import { buildGraph, edgeRows } from './deps-graph.mjs';

registerSource('dependencies', (s, _q, { simpleColumns }) => {
  const rows = edgeRows(buildGraph(s));
  return { rows, refOf: () => null, cols: simpleColumns([
    ['from', 'From', 'text', r => r.from], ['from_kind', 'From kind', 'text', r => r.fromKind], ['to', 'To', 'text', r => r.to], ['to_kind', 'To kind', 'text', r => r.toKind],
    ['relation', 'Relation', 'text', r => r.relation], ['basis', 'Basis', 'text', r => r.how], ['confidence', 'Confidence', 'text', r => r.confidence],
    ['cells', 'Cells', 'number', r => r.cells], ['note', 'Note', 'text', r => r.note], ['from_id', 'From id', 'text', r => r.fromId], ['to_id', 'To id', 'text', r => r.toId]]) };
});
