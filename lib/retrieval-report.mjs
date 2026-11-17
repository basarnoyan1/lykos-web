// The report of a PDF download that did not retrieve everything (PAPER-COVERAGE F5): one line per record that failed, with the
// label, the DOI, the last source tried and the reason. The reason is the text lib/paper-download.mjs previewError produced when
// the retrieval failed: its first line is the reason, and each following line is "<host>: <code> — <what the source said>".
// The last two columns say whether the open-access lookup (lib/open-access.mjs) found a legal copy of the record ('Open access',
// with its URL to open by hand), found none ('Not found'), or was not made (no DOI, or a text-only retrieval): blank.

const oneLine = s => String(s ?? '').replace(/\s+/g, ' ').trim();

/** The first line of a failure is the reason; the last source line names the last source tried. */
export function splitError(text) {
  const lines = String(text ?? '').split('\n').map(l => l.trim()).filter(Boolean);
  const reason = oneLine(lines[0] || 'No reason given');
  const last = lines.length > 1 ? lines.at(-1) : '';
  const m = /^([^\s:]+(?:\.[^\s:]+)*)\s*:\s/.exec(last);
  return { reason, source: m ? m[1] : '' };
}

/** One record's line: label, DOI, last source tried, reason, open access, its URL, separated by tabs so a spreadsheet takes it apart. */
export function reportLine({ label = '', doi = '', error = '', oa = '', oaUrl = '' }) {
  const { reason, source } = splitError(error);
  return [oneLine(label), oneLine(doi), source, reason, oneLine(oa), oa === 'Open access' ? oneLine(oaUrl) : ''].join('\t');
}

/** The report: one line per failed record, in the order they failed. Nothing failed, nothing to write: ''. */
export function reportText(failures = []) {
  return failures.length ? `${failures.map(reportLine).join('\n')}\n` : '';
}

/** The records a retry runs: the failed ones that are still in the library, once each, in the order they failed. */
export function retryPapers(failures = [], papers = []) {
  const byId = new Map(papers.map(p => [p.id, p]));
  const seen = new Set();
  return failures.filter(f => f.id && byId.has(f.id) && !seen.has(f.id) && seen.add(f.id)).map(f => byId.get(f.id));
}
