// Zotero's online library (api.zotero.org, which answers a browser tab), read by the person's user ID and a key that can read it;
// loaded with the first read (lib/sources.mjs zoteroItems maps the items as it maps the local API's).
export async function zoteroWeb({ userId, key }, { limit, start }) {
  const id = String(userId || '').replace(/\D/g, '');
  if (!id || !key) throw new Error('Zotero: give your user ID and an API key (zotero.org/settings/keys)');
  let r;
  try { r = await fetch(`https://api.zotero.org/users/${id}/items/top?${new URLSearchParams({ format: 'json', limit: String(limit), start: String(start) })}`, { headers: { 'Zotero-API-Key': key, 'Zotero-API-Version': '3' } }); }
  catch { throw new Error('Zotero: the online library could not be reached'); }
  if (r.status === 403) throw new Error('Zotero: the key does not open this library (check the user ID and that the key allows reading it)');
  if (r.status !== 200) throw new Error(`Zotero: HTTP ${r.status}`);
  return { items: await r.json(), total: Number(r.headers.get('total-results')) };
}
