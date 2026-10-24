// ORCID public record API v3: https://info.orcid.org/documentation/api-tutorials/api-tutorial-read-data-on-a-record/
export function normalizeOrcid(value) {
  const id = String(value || '').trim().replace(/^https?:\/\/(?:www\.)?orcid\.org\//i, '').replace(/\/$/, '').replace(/-/g, '').toUpperCase();
  if (!/^\d{15}[\dX]$/.test(id)) return null;
  let total = 0;
  for (const digit of id.slice(0, 15)) total = (total + Number(digit)) * 2;
  const check = (12 - total % 11) % 11;
  if (id[15] !== (check === 10 ? 'X' : String(check))) return null;
  return id.match(/.{4}/g).join('-');
}

const text = value => typeof value === 'string' ? value.trim() : '';
const publicItem = item => item && (!item.visibility || item.visibility.toLowerCase() === 'public');

export function orcidDetails(record, today = new Date().toISOString().slice(0, 10)) {
  const person = record.person || {};
  const name = publicItem(person.name) ? person.name : {};
  const emails = (person.emails?.email || []).filter(publicItem);
  const current = (record['activities-summary']?.employments?.['affiliation-group'] || [])
    .flatMap(group => (group.summaries || []).map(item => item['employment-summary']))
    .filter(publicItem).filter(item => {
      const end = item['end-date'];
      if (!end?.year?.value) return true;
      return `${end.year.value}-${String(end.month?.value || '12').padStart(2, '0')}-${String(end.day?.value || '31').padStart(2, '0')}` >= today;
    });
  const affiliations = current.map(item => [item['department-name'], item.organization?.name, item.organization?.address?.country].map(text).filter(Boolean).join(', '));
  return {
    name: text(name['credit-name']?.value) || [name['given-names']?.value, name['family-name']?.value].map(text).filter(Boolean).join(' '),
    affiliation: [...new Set(affiliations.filter(Boolean))].join('; '),
    email: text((emails.find(item => item.primary) || emails[0])?.email),
  };
}

export function fillOrcidDetails(author, details) {
  const next = { ...author };
  for (const key of ['name', 'affiliation', 'email']) {
    if (!text(next[key]) && text(details[key])) next[key] = details[key];
  }
  return next;
}

export async function lookupOrcid(value, { request = fetch } = {}) {
  const id = normalizeOrcid(value);
  if (!id) throw new Error('Enter a valid ORCID iD or orcid.org profile URL.');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await request(`https://pub.orcid.org/v3.0/${id}/record`, {
      headers: { Accept: 'application/json' }, signal: controller.signal, credentials: 'omit',
    });
    if (response.status === 404) throw new Error('No public ORCID record found for this iD.');
    if (response.status === 429) throw new Error('ORCID is busy. Try again shortly.');
    if (!response.ok) throw new Error('ORCID could not provide this record. Try again later.');
    const record = await response.json();
    if (record['orcid-identifier']?.path !== id) throw new Error('ORCID returned a different record. No details were added.');
    return { ...orcidDetails(record), orcid: id };
  } catch (error) {
    if (controller.signal.aborted) throw new Error('ORCID lookup timed out. Try again.');
    if (error instanceof TypeError) throw new Error('Could not reach ORCID. Check your connection and try again.');
    throw error;
  } finally { clearTimeout(timer); }
}
