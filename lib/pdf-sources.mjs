// Project PDF lookup URLs. Templates are data, never code or a source of UI markup.
const FIELDS = ['doi', 'pmid', 'title'];
const FIELD = /\{(doi|pmid|title)\}/g;
export const MAX_PDF_SOURCES = 12;

export function pdfSource(input) {
  const name = String(input?.name || '').trim();
  const template = String(input?.template || '').trim();
  if (!name || name.length > 60) throw new Error('Enter a source name (up to 60 characters)');
  if (!template || template.length > 1000) throw new Error('Enter a URL (up to 1000 characters)');
  if (!FIELDS.some(field => template.includes(`{${field}}`)) || /[{}]/.test(template.replace(FIELD, ''))) {
    throw new Error('Use {doi}, {pmid}, or {title} in the URL');
  }
  const sample = template.replace(FIELD, 'paper');
  let url;
  try { url = new URL(sample); } catch { throw new Error('Enter a valid HTTPS URL'); }
  const authority = /^https:\/\/([^/?#]+)/i.exec(template)?.[1] || '';
  if (!authority || /[{}]/.test(authority) || url.protocol !== 'https:' || !url.hostname || url.username || url.password || url.port || url.hash ||
      /^(localhost|.*\.local)$/i.test(url.hostname)) throw new Error('Use a public HTTPS URL without credentials');
  if (/[\x00-\x1f\x7f]/.test(template)) throw new Error('Remove control characters from the URL');
  return { id: String(input?.id || ''), name, template, enabled: input?.enabled !== false };
}

export function activePdfSources(value) {
  if (!Array.isArray(value)) return [];
  const out = [];
  for (const item of value.slice(0, MAX_PDF_SOURCES)) {
    try { const source = pdfSource(item); if (source.enabled) out.push(source); } catch {}
  }
  return out;
}
