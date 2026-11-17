// Stored connections determine execution. Node positions only affect the canvas.
export const isSource = node => ['library', 'search', 'zotero', 'input', 'http'].includes(node.type);
export function graphFlow(flow) {
  const blocks = (flow.blocks || []).map((b, i) => ({ ...b, ...(['ai','human'].includes(b.type)?{type:'task',executor:b.type}:{}), id: b.id || `node-${i + 1}`, x: Number.isFinite(b.x) ? b.x : 40 + i * 320, y: Number.isFinite(b.y) ? b.y : 70 }));
  const edges = Array.isArray(flow.edges) ? flow.edges.map(e => ({ ...e })) : blocks.slice(1).flatMap((b, i) => isSource(b) ? [] : [{ from: blocks[i].id, to: b.id }]);
  return { ...flow, blocks, edges };
}
export function graphOrder(flow, {allowDisconnected=false}={}) {
  const { blocks, edges } = graphFlow(flow), byId = new Map(blocks.map(b => [b.id, b]));
  if (byId.size !== blocks.length) throw new Error('Each block needs a unique ID.');
  const incoming = new Map(blocks.map(b => [b.id, []])), outgoing = new Map(blocks.map(b => [b.id, []])), pairs = new Set();
  for (const e of edges) {
    if (!byId.has(e.from) || !byId.has(e.to)) throw new Error('A connection points to a missing block.');
    if (isSource(byId.get(e.to))) throw new Error('Source blocks do not accept an input.');
    if(e.port&&!['main','match','other','error'].includes(e.port))throw new Error('Unknown connection output.');
    if(['match','other'].includes(e.port)&&byId.get(e.from).type!=='condition')throw new Error('Match outputs require a condition block.');
    const pair = JSON.stringify([e.from, e.to, e.port||'main']); if (pairs.has(pair)) throw new Error('This connection already exists.'); pairs.add(pair);
    incoming.get(e.to).push(e.from); outgoing.get(e.from).push(e.to);
  }
  for (const b of blocks) if (!allowDisconnected && ['condition','subworkflow','batch','output','merge', 'filter', 'collect', 'dedupe', 'new_records', 'sort', 'limit', 'enrich', 'abstracts', 'export', 'fanout', 'screen_pass', 'consensus', 'screening', 'dual_review', 'extraction', 'screening_sheet'].includes(b.type) && !incoming.get(b.id).length) throw new Error('Connect an input to each record-processing block.');
  const degrees = new Map(blocks.map(b => [b.id, incoming.get(b.id).length]));
  const ready = blocks.filter(b => !degrees.get(b.id)), ordered = [];
  for (let cursor = 0; cursor < ready.length; cursor++) {
    const b = ready[cursor]; ordered.push(b);
    for (const id of outgoing.get(b.id)) { degrees.set(id, degrees.get(id) - 1); if (!degrees.get(id)) ready.push(byId.get(id)); }
  }
  if (ordered.length !== blocks.length) throw new Error('Connections cannot form a loop.');
  return { blocks: ordered, incoming };
}
export function mergeRecords(groups) {
  const seen = new Set();
  return groups.flat().filter(r => { const key = r.key || r.id || r; if (seen.has(key)) return false; seen.add(key); return true; });
}

/** Lay out each connected component by dependency depth, keeping branches together. */
export function arrangeGraph(flow, direction = 'horizontal') {
  const blocks = flow.blocks || [], ids = new Set(blocks.map(b => b.id));
  const incoming = new Map(blocks.map(b => [b.id, []])), outgoing = new Map(blocks.map(b => [b.id, []]));
  for (const e of flow.edges || []) if (ids.has(e.from) && ids.has(e.to)) {
    incoming.get(e.to).push(e.from); outgoing.get(e.from).push(e.to);
  }
  const remaining = new Set(ids), positions = new Map();
  let crossBase = 40;
  while (remaining.size) {
    const component = new Set(), stack = [remaining.values().next().value];
    while (stack.length) {
      const id = stack.pop(); if (component.has(id)) continue;
      component.add(id); remaining.delete(id); stack.push(...incoming.get(id), ...outgoing.get(id));
    }
    const degree = new Map([...component].map(id => [id, incoming.get(id).length]));
    const ready = [...component].filter(id => !degree.get(id)), rank = new Map(ready.map(id => [id, 0]));
    let seen = 0;
    for (let cursor = 0; cursor < ready.length; cursor++) {
      const id = ready[cursor]; seen++;
      for (const next of outgoing.get(id)) {
        rank.set(next, Math.max(rank.get(next) || 0, rank.get(id) + 1));
        degree.set(next, degree.get(next) - 1); if (!degree.get(next)) ready.push(next);
      }
    }
    if (seen !== component.size) throw new Error('Remove the circular connection before arranging.');
    const layers = [];
    for (const b of blocks) if (component.has(b.id)) (layers[rank.get(b.id)] ||= []).push(b.id);
    const slots = Math.max(...layers.map(layer => layer.length)), order = new Map();
    layers.forEach((layer, depth) => {
      const center = id => {
        const parents = incoming.get(id); return parents.length ? parents.reduce((n,p) => n + (order.get(p) || 0), 0) / parents.length : 0;
      };
      layer.sort((a,b) => center(a) - center(b));
      layer.forEach((id,i) => {
        const slot = i + (slots - layer.length) / 2; order.set(id,slot);
        const vertical = direction === 'vertical';
        positions.set(id,vertical ? {x:crossBase + slot * 300,y:40 + depth * 160} : {x:40 + depth * 320,y:crossBase + slot * 130});
      });
    });
    crossBase += slots * (direction === 'vertical' ? 300 : 130) + 40;
  }
  return blocks.map(b => ({...b,...positions.get(b.id)}));
}
