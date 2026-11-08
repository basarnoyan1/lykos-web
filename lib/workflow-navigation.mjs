// A bounded visit history for workflow screens. Back restores the actual
// caller, including the selected run, expanded result and filter.
export function workflowNavigation(initial) {
  const state = { ...initial }, history = [];
  const same = (a, b) => a.page === b.page && a.flowId === b.flowId && a.runId === b.runId;
  return {
    state,
    go(page, props = {}) {
      const next = { ...state, openBlock: undefined, openVersion: null, compare: null, feedback: '', ...props, page };
      if (!same(state, next)) { history.push({ ...state }); if (history.length > 40) history.shift(); }
      Object.assign(state, next);
    },
    back(fallback = 'home') {
      const previous = history.pop();
      Object.assign(state, previous || { ...initial, page: fallback });
    },
    reset(page = 'home', props = {}) { history.length = 0; Object.assign(state, initial, props, { page }); },
  };
}
