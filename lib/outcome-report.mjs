// Records whether the paper reports an outcome's pooled result (Fable review F5, 9 Nov 2026), off the startup graph: the change-file op
// report_analysis writes it, and lib/outcomes.mjs pooledResults reads it for the stage line, the MCP overview and the completeness report.
// A result not reported is kept as an analysis, never deleted, so its numbers stay checkable (bench/proportions).
/**
 * Records whether the paper reports an outcome's pooled result. `reported` false keeps the result as an analysis the paper does not
 * use; true or null clears the decision. Needs `why` when not reported. Answers '' or why it was not recorded.
 */
export function setReported(s, outcomeId, reported, { why = '', by = '', at = new Date().toISOString() } = {}) {
  // the primary outcome may have no stored row (outcomes() builds it from settings and s.analysis): it gets one, as setOutcomeHidden does
  const primary = outcomeId === 'primary' && s.analysis;
  if (!(s.outcomes || []).some(x => x.id === outcomeId) && !primary) return 'No such outcome';
  if (reported === false && !String(why).trim()) return 'Say why the result is not reported';
  if (!(s.outcomes || []).some(x => x.id === outcomeId)) s.outcomes = [{ id: 'primary' }, ...(s.outcomes || [])];
  s.outcomes = s.outcomes.map(x => {
    if (x.id !== outcomeId) return x;
    const { reported: _r, reportedWhy: _w, reportedBy: _b, reportedAt: _a, ...rest } = x;
    return reported === false ? { ...rest, reported: false, reportedWhy: String(why).trim(), ...(by ? { reportedBy: by } : {}), reportedAt: at }
      : reported === true ? { ...rest, reported: true, ...(by ? { reportedBy: by } : {}), reportedAt: at } : rest;
  });
  return '';
}
