// Counting the values of the typed field kinds for the data summary (data-model plan S2, plan G1a): yes or no, a category of a project
// vocabulary, several categories, countries and dates. Pure and exact: a count is read from the value's `normalized_value`, never from a
// model; a study counts once per code however many of its cells hold it; a value the kind cannot read is listed, not guessed.
import { kindOf } from './field-kinds.mjs';
import { termOf, matchTerm, grouped } from './vocabularies.mjs';
import { countryName } from './countries.mjs';
import { regionOf, REGION_ORDER } from './country-regions.mjs';

/** The typed kind the summary counts by code, or '' (text, numbers and a category without a vocabulary keep their usual reading). */
export function typedKind(f, vocab = null) {
  const k = kindOf(f);
  if (k === 'yesno' || k === 'multi' || k === 'country' || k === 'date') return k;
  return k === 'category' && vocab?.terms?.length ? 'category' : '';
}

const codesOf = nv => (Array.isArray(nv) ? nv : nv == null || nv === '' ? [] : [nv]).map(c => (typeof c === 'boolean' ? (c ? 'yes' : 'no') : String(c).trim())).filter(Boolean);
const shownText = v => String(v?.reported_value ?? v?.normalized_value ?? '').trim();

/** The year of an ISO date ("2021", "2021-05", "2021-05-17"), or ''. */
export const yearOf = nv => (/^(\d{4})(?:-\d{2}(?:-\d{2})?)?$/.exec(String(nv ?? '').trim()) || [])[1] || '';

/**
 * Levels of a typed field from its cells ({ paperId, cell, v }).
 * Returns { levels: [{ key, label, n, studies: [{ paperId, cell }], sub? }], left: [{ cell, text }], reason }; `left` are cells whose value this
 * kind cannot read (no normalized value, or a code the list does not hold).
 */
export function typedLevels(kind, cells, vocab = null) {
  const groups = new Map(), left = [], cellOf = new Map();
  const grp = (key, label) => { if (!groups.has(key)) groups.set(key, { key, label, n: 0, studies: [], seen: new Set() }); return groups.get(key); };
  const put = (g, c) => { if (g.seen.has(c.paperId)) return; g.seen.add(c.paperId); g.n++; g.studies.push({ paperId: c.paperId, cell: c.cell }); };
  const codeSets = new Map();   // vocabulary: code -> Set of study ids
  for (const c of cells) {
    const nv = c.v?.normalized_value;
    if (kind === 'yesno') {
      const codes = codesOf(nv).map(x => x.toLowerCase());
      if (codes.length === 1 && (codes[0] === 'yes' || codes[0] === 'no')) put(grp(codes[0], codes[0] === 'yes' ? 'Yes' : 'No'), c); else left.push({ cell: c.cell, text: shownText(c.v) });
    } else if (kind === 'date') {
      const y = yearOf(nv); if (y) put(grp(y, y), c); else left.push({ cell: c.cell, text: shownText(c.v) });
    } else if (kind === 'country') {
      const codes = codesOf(nv).filter(x => /^[A-Z]{2}$/.test(x)); let bad = codes.length === 0;
      for (const code of codes) put(grp(code, countryName(code) || code), c);
      if (bad) left.push({ cell: c.cell, text: shownText(c.v) });
    } else if (vocab) {   // category and multi: codes of the vocabulary; a text that names a term (label, alias) is read as that term
      const codes = codesOf(nv); let bad = codes.length === 0;
      for (const raw of codes.length ? codes : []) {
        const t = termOf(vocab, raw) || matchTerm(vocab, raw);
        if (!t) { bad = true; continue; }
        if (!codeSets.has(t.code)) codeSets.set(t.code, new Set());
        codeSets.get(t.code).add(c.paperId); if (!cellOf.has(c.paperId)) cellOf.set(c.paperId, c.cell);
      }
      if (bad) left.push({ cell: c.cell, text: shownText(c.v) });
    } else {   // several categories of a field's options: the code is the label
      const codes = codesOf(nv); if (!codes.length) left.push({ cell: c.cell, text: shownText(c.v) });
      for (const code of codes) put(grp(code, code), c);
    }
  }
  const byCount = (a, b) => b.n - a.n || String(a.label).localeCompare(String(b.label));
  const studiesOf = ids => [...ids].map(paperId => ({ paperId, cell: cellOf.get(paperId) }));
  if (kind === 'category' || (kind === 'multi' && vocab)) {
    // class first (the top level of the list), the terms under it; a term coded at the class itself is its own row
    const flat = (node, out) => { for (const ch of node.children) { if (ch.own) out.push({ key: `t:${ch.code}`, label: ch.label, n: ch.own, studies: studiesOf((codeSets.get(ch.code) || new Set())) }); flat(ch, out); } return out; };
    const levels = grouped(vocab, codeSets).map(node => {
      const sub = flat(node, []);
      if (node.own && node.children.length) sub.unshift({ key: `t:${node.code}`, label: `${node.label}, class only`, n: node.own, studies: studiesOf(codeSets.get(node.code)) });
      return { key: `t:${node.code}`, label: node.label, n: node.n, studies: studiesOf(node.ids), ...(node.children.length && sub.length ? { sub: sub.sort(byCount) } : {}) };
    });
    return { levels: levels.sort(byCount), left, reason: kind === 'multi' ? 'declared several categories, counted by class' : 'declared category, counted by class' };
  }
  const list = [...groups.values()].map(({ key, label, n, studies }) => ({ key, label, n, studies }));
  if (kind === 'date') return { levels: list.sort((a, b) => a.key.localeCompare(b.key)), left, reason: 'declared date, counted by year' };
  if (kind === 'yesno') return { levels: list.sort((a, b) => (a.key === 'yes' ? 0 : 1) - (b.key === 'yes' ? 0 : 1)), left, reason: 'declared yes or no' };
  if (kind === 'country') {
    // no map outline is vendored, so countries are grouped by continent: a bar per continent, the countries beneath it
    const byRegion = new Map();
    for (const l of list) { const r = regionOf(l.key) || 'Other'; if (!byRegion.has(r)) byRegion.set(r, { key: `r:${r}`, label: r, ids: new Set(), sub: [] }); const g = byRegion.get(r); g.sub.push(l); for (const s of l.studies) g.ids.add(s.paperId); }
    const first = new Map(); for (const l of list) for (const s of l.studies) if (!first.has(s.paperId)) first.set(s.paperId, s.cell);
    const levels = [...byRegion.values()].map(g => ({ key: g.key, label: g.label, n: g.ids.size, studies: [...g.ids].map(paperId => ({ paperId, cell: first.get(paperId) })), sub: g.sub.sort(byCount) }));
    const rank = r => { const i = REGION_ORDER.indexOf(r); return i < 0 ? 99 : i; };
    return { levels: levels.sort((a, b) => b.n - a.n || rank(a.label) - rank(b.label)), left, reason: 'declared country, counted by continent' };
  }
  return { levels: list.sort(byCount), left, reason: 'declared several categories' };
}
