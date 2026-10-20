// Evidence: where a value came from, as a list. A cell such as "ODI 68 → 10;
// VAS 7 → 1" is drawn from two places, so one locator per value (the first
// contract) is replaced by a list, each item one of four kinds; an abstract
// quote has no page, only the record it was read from.
export const KINDS = ['text', 'image', 'file', 'abstract'];

export function migrateValue(v) {
  if (!v || Array.isArray(v.evidence)) return v;
  const loc = v.source_locator;
  const evidence = loc && loc.page ? [{ kind: 'text', document_version: loc.document_version, page: loc.page, quote: v.reported_value, rects: loc.rects || [] }] : [];
  return { ...v, evidence };
}

const base = p => String(p || '').split('/').pop();
export function evidenceLabel(e) {
  if (!e) return '';
  if (e.kind === 'text') return `p. ${e.page}${e.ocr ? ' (recognised text)' : ''}`;
  if (e.kind === 'abstract') return 'abstract';
  if (e.kind === 'image') return e.caption ? `p. ${e.page}, ${e.caption}` : `p. ${e.page}, figure`;
  if (e.kind === 'file') {
    const l = e.locator || {};
    if (l.sheet != null && l.cell) return `${base(e.path)} ${l.sheet}!${l.cell}`;
    if (l.paragraph != null) return `${base(e.path)} ¶${l.paragraph}`;
    if (l.line != null) return `${base(e.path)} line ${l.line}`;
    return base(e.path);
  }
  return '';
}

/** The first anchor a reader can jump to. */
export function firstLocator(v) {
  const e = (v?.evidence || []).find(x => x.kind === 'text' || x.kind === 'image');
  return e ? { page: e.page, rects: e.rects || [], kind: e.kind, region: e.region || null } : null;
}
