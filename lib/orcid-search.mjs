// Find an author's ORCID iD in the public registry (expanded search, v3.0), by given and family name.
import { normalizeOrcid } from './orcid.mjs';

const clean = s => String(s ?? '').trim();

/** Given and family name from "Given Family", "Family, Given" or a longer name; null for a single word. */
export function splitName(name) {
  const t = clean(name).replace(/\s+/g, ' ');
  if (!t) return null;
  if (t.includes(',')) { const [family, ...rest] = t.split(','); const given = clean(rest.join(' ')); return clean(family) && given ? { given, family: clean(family) } : null; }
  const parts = t.split(' ');
  return parts.length < 2 ? null : { given: parts.slice(0, -1).join(' '), family: parts[parts.length - 1] };
}

const term = s => clean(s).replace(/["\\()[\]{}:+!^~*?/]/g, ' ').replace(/\s+/g, ' ').trim().replace(/ /g, '\\ ');

export function searchUrl(name) {
  const n = typeof name === 'string' ? splitName(name) : name;
  if (!n) return null;
  return `https://pub.orcid.org/v3.0/expanded-search/?q=${encodeURIComponent(`given-names:${term(n.given)} AND family-name:${term(n.family)}`).replace(/%20/g, '+')}&rows=10`;
}

/** Matches from an expanded-search response: { orcid, name, institutions[] }, valid iDs only. */
export function parseSearch(json) {
  return (json?.['expanded-result'] || []).map(r => {
    const orcid = normalizeOrcid(r['orcid-id']);
    if (!orcid) return null;
    const name = clean(r['credit-name']) || [r['given-names'], r['family-names']].map(clean).filter(Boolean).join(' ');
    return { orcid, name, institutions: [...new Set((r['institution-name'] || []).map(clean).filter(Boolean))] };
  }).filter(Boolean);
}

export async function findOrcid(name, { request = fetch } = {}) {
  const url = searchUrl(name);
  if (!url) throw new Error('Enter a given and a family name first.');
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await request(url, { headers: { Accept: 'application/json' }, signal: controller.signal, credentials: 'omit' });
    if (response.status === 429) throw new Error('ORCID is busy. Try again shortly.');
    if (!response.ok) throw new Error('ORCID could not search. Try again later.');
    return parseSearch(await response.json());
  } catch (error) {
    if (controller.signal.aborted) throw new Error('ORCID search timed out. Try again.');
    if (error instanceof TypeError) throw new Error('Could not reach ORCID. Check your connection and try again.');
    throw error;
  } finally { clearTimeout(timer); }
}
