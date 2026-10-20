/** No temporary copy of every conversation on job-progress paints. */
export function createChatSpendReader() {
  let priorState, priorVersion = -1, priorDay = '', total = 0;
  return (state, version, day = new Date().toISOString().slice(0, 10)) => {
    if (state === priorState && version === priorVersion && day === priorDay) return total;
    total = 0;
    for (const thread of state.threads || []) for (const message of thread.messages || [])
      if (Number.isFinite(message.usage?.cost) && String(message.at || '').startsWith(day)) total += message.usage.cost;
    priorState = state; priorVersion = version; priorDay = day;
    return total;
  };
}
