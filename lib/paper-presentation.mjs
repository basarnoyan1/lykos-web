const LABEL = /\b(BACKGROUND|OBJECTIVES?|AIMS?|PURPOSE|MATERIALS? AND METHODS|PATIENTS? AND METHODS|METHODS?|RESULTS?|FINDINGS|DISCUSSION|CONCLUSIONS?)\s*:\s*/gi;

/** Preserve the author's abstract structure without guessing at sentence breaks. */
export function abstractParts(value) {
  const text = String(value || '').trim();
  if (!text) return [];
  const matches = [...text.matchAll(LABEL)].filter(m => m.index === 0 || /[\n.!?]\s*$/.test(text.slice(0, m.index)));
  if (!matches.length) return text.split(/\n\s*\n/).map(t => ({ text: t.trim() })).filter(x => x.text);
  const out = [];
  if (matches[0].index) out.push({ text: text.slice(0, matches[0].index).trim() });
  for (let i = 0; i < matches.length; i++) {
    const m = matches[i];
    const body = text.slice(m.index + m[0].length, matches[i + 1]?.index ?? text.length).trim();
    if (body) out.push({ label: m[1].replace(/\s+/g, ' '), text: body });
  }
  return out;
}

const TITLES = {
  PDF_IDENTITY_UNCONFIRMED: 'PDF could not be matched',
  TIMEOUT: 'Preview timed out',
  PREVIEW_TOO_LARGE: 'PDF is too large to preview',
  PREVIEW_SETUP_ERROR: 'Preview service needs setup',
  INVALID_PDF: 'The file is not a valid PDF',
};

/** Accepts both older stored status strings and current retrieval errors. */
export function previewProblem(value) {
  const lines = String(value || '').trim().split(/\n+/).filter(Boolean);
  if (!lines.length) return null;
  const [codePart, ...reasonParts] = lines[0].split(' — ');
  const code = /^[A-Z][A-Z_]+$/.test(codePart) ? codePart : 'PREVIEW_ERROR';
  const reason = code === 'PREVIEW_ERROR' ? lines[0] : reasonParts.join(' — ');
  const detail = code === 'PDF_IDENTITY_UNCONFIRMED'
    ? 'Check the title or DOI, then retry. Scanned or translated papers may need manual review.'
    : reason || 'Check the record and retry.';
  return { title: TITLES[code] || 'Preview unavailable', detail,
    sources: lines.slice(1).map(line => line.split(': ')[0]).filter(Boolean), technical: lines.join('\n') };
}
