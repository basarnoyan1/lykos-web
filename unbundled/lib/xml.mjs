// A small namespace-aware XML reader with the slice of the DOM that the Word
// reader uses: getElementsByTagNameNS, children, localName, namespaceURI,
// getAttribute, getAttributeNS and textContent.
//
// The webview has DOMParser; node --test does not. Reading a .docx through
// one parser in both places means the round-trip tests exercise the code the
// app runs, not a stand-in. No DTDs, no external entities: a document part is
// data, never instructions to fetch anything.

/** The character of a numeric reference; a value no character has (&#9999999999;) is U+FFFD, not a thrown import. */
export const codePoint = n => n >= 0 && n <= 0x10FFFF && !(n >= 0xD800 && n <= 0xDFFF) ? String.fromCodePoint(n) : '\uFFFD';
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const decode = s => s.indexOf('&') < 0 ? s : s.replace(/&(amp|lt|gt|quot|apos);|&#x([0-9a-f]+);|&#(\d+);/gi,
  (m, n, hx, dc) => n ? ENT[n.toLowerCase()] : codePoint(parseInt(hx || dc, hx ? 16 : 10)));

const XMLNS = 'http://www.w3.org/2000/xmlns/';

class XElement {
  constructor(name, parent) {
    this.nodeName = this.tagName = name;
    const c = name.indexOf(':');
    this.prefix = c < 0 ? null : name.slice(0, c);
    this.localName = c < 0 ? name : name.slice(c + 1);
    this.parentNode = parent;
    this.children = [];
    this.childNodes = [];
    this.attrs = new Map();
    this.ns = parent?.ns || null;   // prefix -> uri, inherited
    this.nodeType = 1;
  }
  get namespaceURI() { return this.ns?.get(this.prefix ?? '') ?? null; }
  getAttribute(name) { return this.attrs.has(name) ? this.attrs.get(name) : null; }
  getAttributeNS(uri, local) {
    for (const [k, v] of this.attrs) {
      const c = k.indexOf(':');
      if (c < 0) { if (!uri && k === local) return v; continue; }
      if (k.slice(c + 1) === local && this.ns?.get(k.slice(0, c)) === uri) return v;
    }
    return null;
  }
  hasAttribute(name) { return this.attrs.has(name); }
  getElementsByTagNameNS(uri, local) {
    const out = [];
    const walk = el => { for (const c of el.children) { if (c.localName === local && (uri === '*' || c.namespaceURI === uri)) out.push(c); walk(c); } };
    walk(this);
    return out;
  }
  getElementsByTagName(name) {
    const out = [];
    const walk = el => { for (const c of el.children) { if (c.nodeName === name || name === '*') out.push(c); walk(c); } };
    walk(this);
    return out;
  }
  get textContent() { return this.childNodes.map(n => n.nodeType === 3 ? n.data : n.textContent).join(''); }
  get firstElementChild() { return this.children[0] || null; }
  querySelector() { return null; }
}

class XDocument extends XElement {
  constructor() { super('#document', null); this.nodeType = 9; this.ns = new Map([['xml', 'http://www.w3.org/XML/1998/namespace']]); }
  get documentElement() { return this.children[0] || null; }
}

const TOKEN = /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[([\s\S]*?)\]\]>|<!DOCTYPE[^>]*>|<(\/?)([\w:.-]+)((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)>/g;
const ATTR = /([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;

/** Parse XML text into an XDocument. Throws on mismatched tags. */
export function parseXml(xml) {
  const doc = new XDocument();
  let cur = doc, last = 0;
  const text = s => { if (s && cur !== doc) cur.childNodes.push({ nodeType: 3, data: s }); };
  TOKEN.lastIndex = 0;
  for (let m; (m = TOKEN.exec(xml));) {
    if (m.index > last) text(decode(xml.slice(last, m.index)));
    last = TOKEN.lastIndex;
    if (m[1] != null) { text(m[1]); continue; }
    if (!m[3]) continue;
    if (m[2]) {
      if (cur.nodeName !== m[3]) throw new Error(`XML: </${m[3]}> closes <${cur.nodeName}>`);
      cur = cur.parentNode;
      continue;
    }
    const el = new XElement(m[3], cur);
    let own = null;
    for (const a of m[4].matchAll(ATTR)) {
      const v = decode(a[2] ?? a[3]);
      el.attrs.set(a[1], v);
      if (a[1] === 'xmlns' || a[1].startsWith('xmlns:')) { own ??= new Map(el.ns || []); own.set(a[1] === 'xmlns' ? '' : a[1].slice(6), v); }
    }
    if (own) el.ns = own;
    cur.children.push(el); cur.childNodes.push(el);
    if (!m[5]) cur = el;
  }
  if (cur !== doc) throw new Error(`XML: <${cur.nodeName}> is not closed`);
  return doc;
}

export { XMLNS };
