// The two pieces of agent activity the shell draws at start: the elapsed clock and which steps a person sees. The rest loads with the chat (assistant-activity.mjs).
export function elapsedLabel(ms) {
  const seconds = Math.max(0, Math.floor(Number(ms || 0) / 1000));
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

export const visibleActivity = steps => (steps || []).filter(s => s.type !== 'model' && !['text', 'finish'].includes(s.name));
