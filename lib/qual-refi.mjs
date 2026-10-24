// REFI-QDA codebook exchange (.qdc) for the coding workspace (lib/qual.mjs).
//
// Follows the REFI-QDA Codebook Exchange Standard, schema namespace
// urn:QDA-XML:codebook:1.0 (Codebook.xsd, as published by the REFI-QDA
// working group at qdasoftware.org): a CodeBook holding nested Code elements
// (guid, name, isCodable, an optional Description) and optional Sets of
// MemberCode references. Descriptive themes travel as Sets. Colours are not
// written: codes here are told apart by label, not hue. Written files have not
// been validated against the XSD or opened in another QDA program here.
import { parseXml } from './xml.mjs';
import { qualOf, readQual, ensureCode, setParent, setDescription, addQualTheme, setQualMembers, codeTree } from './qual.mjs';

const NS = 'urn:QDA-XML:codebook:1.0';
const esc = t => String(t ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
  .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function newGuid() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  const b = new Uint8Array(16);
  if (globalThis.crypto?.getRandomValues) globalThis.crypto.getRandomValues(b); else for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);
  b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map(x => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
/** Gives every code and descriptive theme a guid once, so re-exports keep the same identities. */
export function ensureGuids(s) {
  const q = qualOf(s);
  for (const c of q.codes) if (!GUID.test(c.guid || '')) c.guid = newGuid();
  for (const t of q.descriptive) if (!GUID.test(t.guid || '')) t.guid = newGuid();
}

/** The codebook as .qdc XML. Codes without a guid (call ensureGuids first) get a fresh one in the file only. */
export function writeQdc(s, { origin = 'Lykos' } = {}) {
  const q = readQual(s), guid = new Map(q.codes.map(c => [c.id, GUID.test(c.guid || '') ? c.guid : newGuid()]));
  const tree = codeTree(s), out = [];
  const kids = id => tree.filter(({ code }) => (code.parent || null) === id).map(x => x.code);
  const write = (c, pad) => {
    const inner = [c.description ? `${pad}  <Description>${esc(c.description)}</Description>` : '', ...kids(c.id).map(k => write(k, `${pad}  `))].filter(Boolean);
    const open = `${pad}<Code guid="${guid.get(c.id)}" name="${esc(c.label)}" isCodable="true"`;
    return inner.length ? `${open}>\n${inner.join('\n')}\n${pad}</Code>` : `${open}/>`;
  };
  out.push('<?xml version="1.0" encoding="utf-8"?>', `<CodeBook xmlns="${NS}" origin="${esc(origin)}">`, '  <Codes>', ...kids(null).map(c => write(c, '    ')), '  </Codes>');
  const sets = q.descriptive.filter(t => t.codes.some(id => guid.has(id)));
  if (sets.length) {
    out.push('  <Sets>');
    for (const t of sets) out.push(`    <Set guid="${GUID.test(t.guid || '') ? t.guid : newGuid()}" name="${esc(t.label)}">`, ...t.codes.filter(id => guid.has(id)).map(id => `      <MemberCode targetGUID="${guid.get(id)}"/>`), '    </Set>');
    out.push('  </Sets>');
  }
  out.push('</CodeBook>', '');
  return out.join('\n');
}

/**
 * Reads a .qdc into the codebook: codes matched by guid, then by name (case
 * ignored), created otherwise, nested as in the file, descriptions filled
 * where empty; Sets become descriptive themes. Returns { created, matched,
 * themes } or { error } for a file that is not a codebook.
 */
export function readQdc(s, xml) {
  let doc;
  try { doc = parseXml(String(xml ?? '')); } catch (e) { return { error: `Not readable XML: ${e.message}` }; }
  const root = doc.documentElement;
  if (!root || root.localName !== 'CodeBook') return { error: 'Not a REFI-QDA codebook (no CodeBook element)' };
  const codesEl = root.children.find(c => c.localName === 'Codes');
  const q = qualOf(s), byGuid = new Map();
  let created = 0, matched = 0;
  const walk = (el, parent) => {
    for (const c of el.children.filter(x => x.localName === 'Code')) {
      const name = String(c.getAttribute('name') || '').trim(), guid = c.getAttribute('guid') || '';
      if (!name) continue;
      let code = q.codes.find(x => guid && x.guid === guid) || q.codes.find(x => x.label.toLowerCase() === name.replace(/\s+/g, ' ').toLowerCase());
      if (code) matched++;
      else { const id = ensureCode(s, name); code = q.codes.find(x => x.id === id); created++; }
      if (GUID.test(guid) && !code.guid) code.guid = guid;
      if (parent && code.parent !== parent) setParent(s, code.id, parent);
      const d = c.children.find(x => x.localName === 'Description')?.textContent?.trim();
      if (d && !code.description) setDescription(s, code.id, d);
      byGuid.set(guid, code.id);
      walk(c, code.id);
    }
  };
  if (codesEl) walk(codesEl, null);
  let themes = 0;
  const setsEl = root.children.find(c => c.localName === 'Sets');
  for (const set of setsEl?.children.filter(x => x.localName === 'Set') || []) {
    const members = set.children.filter(x => x.localName === 'MemberCode').map(m => byGuid.get(m.getAttribute('targetGUID'))).filter(Boolean);
    const name = String(set.getAttribute('name') || '').trim(); if (!name) continue;
    const have = q.descriptive.find(t => t.label.toLowerCase() === name.toLowerCase());
    if (have) setQualMembers(s, 'descriptive', have.id, members, true); else { addQualTheme(s, 'descriptive', name, members); themes++; }
  }
  return { created, matched, themes };
}
