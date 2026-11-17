// What the project already says about a group of studies (owner, 2026-10-22: "when I filter ... it should say to me that there is a table
// or analysis or figure that analyses this exact group, as itself or compared to another thing, or a suggested analysis"). The group is
// the Data summary's filter (views/extraction-summary.mjs): values chosen field by field. Spelling is made alike, so a chosen level
// "Two-stage" names the subgroup "two stage" and a "non-fusion" level is not "fusion".


const NUMBER = { one: '1', single: '1', two: '2', double: '2', three: '3', four: '4' };
/** Text made alike: lower case, no accents, dashes as spaces, "two stage" and "2-stage" as "2stage". */
export function alike(text) {
  return String(text ?? '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[‐-―−-]/g, ' ').replace(/\b(one|single|two|double|three|four|\d)\s+(stage|level|arm|segment|step)s?\b/g, (_, n, w) => `${NUMBER[n] || n}${w}`)
    .replace(/[^\p{L}\p{N}%.]+/gu, ' ').replace(/\s+/g, ' ').trim();
}

// a word said under a negation ("non fusion", "no deformity", "without fusion") does not hold
const NEGATED = /(?:^|\s)(?:non|no|not|without|absent)\s*$/;
const hasWord = (hay, term) => {
  const h = ` ${hay} `;
  for (let at = h.indexOf(term); at >= 0; at = h.indexOf(term, at + 1)) {
    const start = h[at - 1] === ' ', whole = start || term.length >= 4;
    if (whole && !NEGATED.test(h.slice(0, at).replace(/\s+$/, ''))) return true;
  }
  return false;
};

const pct = v => `${(100 * v).toFixed(1)}%`;
const studiesOfAnalysis = a => new Set((a.sources || []).map(x => String(x).split(':')[0]));

/**
 * What the project already holds about the studies found (`ids`), and what it could add: analyses split by a field the query used
 * (with the level the query names, its estimate), comparisons along that field, analyses the studies are in, evidence tables that hold
 * them; and, when none isolates them, the subgroup to add. `terms` from filterStudies, `fields` [{ id, label }].
 */
export function relatedWork(s, ids, terms, fields, { distinct = {} } = {}) {
  if (!ids?.size) return [];
  const out = [], viaFields = new Set(terms.flatMap(t => t.via)), termSet = terms.map(t => t.term);
  const labelOf = id => fields.find(f => f.id === id)?.label || String(id).split('.').pop();
  const levelHit = level => termSet.some(t => hasWord(alike(level), t));
  const analyses = Object.entries(s.analyses || {}).map(([id, a]) => ({ id, a, name: a.outcomeName || (s.outcomes || []).find(o => o.id === id)?.name || id, in: [...studiesOfAnalysis(a)].filter(x => ids.has(x)).length }));
  for (const { id, a, name } of analyses) {
    if (!a.moderator || !viaFields.has(a.moderatorLabel || labelOf(a.moderator))) continue;
    const levels = (a.mod_levels || []).map((l, i) => ({ label: l, est: a.mod_est?.[i], lo: a.mod_lo?.[i], hi: a.mod_hi?.[i], k: a.mod_k?.[i], on: levelHit(l) }));
    const hit = levels.find(l => l.on);
    out.push({ kind: 'subgroup', id, title: `${name} by ${a.moderatorLabel || labelOf(a.moderator)}${hit ? `: ${hit.label}` : ''}`, levels, measure: a.measure,
      estimate: hit ? `${pct(hit.est)} (${pct(hit.lo)} to ${pct(hit.hi)})` : '', held: hit ? `${hit.k} est.` : '' });
  }
  for (const o of s.outcomes || []) {
    const arms = o.derived?.arms; if (!arms?.column) continue;
    const col = labelOf(arms.column), on = viaFields.has(col) || termSet.some(t => hasWord(alike(`${arms.treated} ${arms.control}`), t));
    if (on) { const r = s.analyses?.[o.id]; out.push({ kind: 'contrast', id: o.id, title: o.name || `${arms.treated} vs ${arms.control}`, estimate: r ? `${pct(r.estimate)} (${pct(r.lo)} to ${pct(r.hi)})` : '', held: '', state: r ? '' : 'Not run' }); }
  }
  // a contrast saved several times over is one
  const seen = new Set(); for (let i = out.length - 1; i >= 0; i--) { if (out[i].kind !== 'contrast') continue; const k = out[i].title.toLowerCase(); if (seen.has(k)) out.splice(i, 1); else seen.add(k); }
  for (const c of s.collections || []) {
    const m = new Set(c.members || []), both = [...ids].filter(x => m.has(x)).length;
    if (both && (both === ids.size || both / m.size >= 0.8)) out.push({ kind: 'table', id: c.id, title: c.name, held: `${both} of ${m.size}`, estimate: '' });
  }
  for (const x of analyses.filter(x => x.in).sort((a, z) => z.in - a.in).slice(0, 4))
    out.push({ kind: 'analysis', id: x.id, title: x.name, held: `${x.in} of ${x.a.studies ?? x.a.k}`, estimate: `${pct(x.a.estimate)} (${pct(x.a.lo)} to ${pct(x.a.hi)})` });
  if (ids.size >= 3 && !out.some(x => x.kind === 'subgroup' && x.levels.some(l => l.on))) {
    // the field to split by: of those the query held in, the one with fewest distinct values (Deformity, Staging), not a free text
    // a field that splits the studies at all (two levels or more: never an identifier or a place in the paper)
    const field = [...viaFields].filter(v => (distinct[v] ?? 0) >= 2).sort((a, z) => distinct[a] - distinct[z])[0], first = analyses.filter(x => x.in).sort((a, z) => z.in - a.in)[0];
    if (field && first) out.push({ kind: 'suggest', id: first.id, title: `${first.name} by ${field}`, measure: first.name, field, held: '', estimate: '', state: 'Not set up' });
  }
  return out;
}
