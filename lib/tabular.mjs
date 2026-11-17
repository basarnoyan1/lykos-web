// A conservative table reader for pasted patient data. It only returns rows
// when every header names a known column; prose and ambiguous headers go to
// the configured model instead of being silently guessed.
const key = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '');

function csvRows(text, delimiter) {
  const rows = []; let row = [], field = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === delimiter) { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c !== '\r') field += c;
  }
  if (quoted) return null;
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows;
}

export function structuredPatientRows(text, columns) {
  const input = String(text || '').trim();
  if (!input || input.length > 100000) return null;
  const first = input.split(/\r?\n/, 1)[0];
  const delimiter = first.includes('\t') ? '\t' : first.includes('|') ? '|' : first.includes(',') ? ',' : null;
  if (!delimiter) return null;
  let rows = csvRows(input, delimiter);
  if (!rows?.length || rows.length < 2) return null;
  if (delimiter === '|') rows = rows.map(r => r.slice(r[0]?.trim() ? 0 : 1, r.at(-1)?.trim() ? undefined : -1));
  rows = rows.filter(r => r.some(v => v.trim()));
  if (delimiter === '|' && rows[1]?.every(v => /^:?-{3,}:?$/.test(v.trim()))) rows.splice(1, 1);
  if (rows.length < 2 || rows.length > 201) return null;
  const header = rows[0].map(v => key(v));
  if (header.length < 2 || header.length > columns.length || header.some(v => !v)) return null;
  const names = new Map();
  for (const c of columns) { names.set(key(c.id), c.id); names.set(key(c.name), c.id); }
  const ids = header.map(h => names.get(h));
  if (ids.some(id => !id) || new Set(ids).size !== ids.length) return null;
  const body = rows.slice(1).filter(r => r.some(v => v.trim()));
  if (!body.length || body.some(r => r.length !== ids.length)) return null;
  return body.map(row => Object.fromEntries(row.map((value, i) => [ids[i], value.trim()]).filter(([, value]) => value !== '')));
}
