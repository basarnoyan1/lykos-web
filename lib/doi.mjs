// Recognize a whole DOI query, never a DOI mentioned inside a topical query.
// Keep suffix punctuation: parentheses, periods and slashes can belong to a DOI.
export function doiQuery(value) {
  const unquote = s => {
    const pairs = { '"': '"', "'": "'", '“': '”', '‘': '’' };
    return pairs[s[0]] === s.at(-1) ? s.slice(1, -1).trim() : s;
  };
  let text = unquote(String(value || '').trim());
  text = unquote(text.replace(/^doi:\s*/i, '').trim());
  // A fielded PubMed expression is still a search expression, not a DOI suffix.
  if (/\[(?:doi|aid|lid|ti|title|tiab|title\/abstract|ab|abstract|all|all fields|mh|mesh|mesh terms|tw|text word)\]$/i.test(text)) return '';
  if (/^(?:https?:\/\/)?(?:dx\.)?doi\.org\//i.test(text)) {
    try {
      const url = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`);
      text = decodeURIComponent(url.pathname.slice(1));
    } catch { return ''; }
  }
  return /^10\.\d{4,9}\/\S+$/i.test(text) ? text.toLowerCase() : '';
}

/** Exact identifier queries may only display records carrying that DOI. */
export function doiRecords(query, records = []) {
  const doi = doiQuery(query);
  if (!Array.isArray(records)) return [];
  return doi ? records.filter(p => doiQuery(p.doi) === doi).slice(0, 1) : records;
}
