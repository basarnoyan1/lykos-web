import { isSettled } from './flow-routing.mjs';
// Release each dependency once; waiting gates hold only their descendants.
// Yield periodically so long chains of local steps keep Stop and the UI responsive.
export async function scheduleGraph({ blocks, incoming, concurrency = 3, state, execute, stopped = () => false }) {
  const byId = new Map(blocks.map(b => [b.id, b]));
  const outgoing = new Map(blocks.map(b => [b.id, []])), remaining = new Map();
  const ready = [], running = new Map();
  const runnable = id => !['done', 'skipped', 'error', 'waiting', 'failed', 'cancelled'].includes(state(id));
  for (const b of blocks) {
    const parents = incoming.get(b.id) || [];
    remaining.set(b.id, parents.filter(id => !isSettled(state(id))).length);
    for (const id of parents) outgoing.get(id).push(b.id);
    if (!remaining.get(b.id) && runnable(b.id)) ready.push(b);
  }
  let cursor = 0, completed = 0, yielded = 0, failure = null;
  while (true) {
    if (completed - yielded >= 32) {
      await new Promise(resolve => setTimeout(resolve, 0));
      yielded = completed;
    }
    if (stopped() && !failure) failure = new Error('Workflow stopped.');
    while (!failure && running.size < concurrency && cursor < ready.length) {
      const block = ready[cursor++];
      const work = Promise.resolve().then(() => execute(block)).then(() => {
        completed++;
        if (!isSettled(state(block.id))) return;
        for (const id of outgoing.get(block.id)) {
          remaining.set(id, remaining.get(id) - 1);
          if (!remaining.get(id) && runnable(id)) ready.push(byId.get(id));
        }
      }).catch(error => { failure ||= error; }).finally(() => running.delete(block.id));
      running.set(block.id, work);
    }
    if (!running.size) break;
    await Promise.race(running.values());
  }
  if (failure) throw failure;
  if (blocks.every(b => isSettled(state(b.id)))) return 'done';
  if (blocks.some(b => state(b.id) === 'waiting')) return 'waiting';
  throw new Error('No blocks can run. Check failed blocks and connections.');
}
