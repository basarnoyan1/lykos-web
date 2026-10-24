// What to synthesise, found from the arms' facets (plan §4.15g): every comparison the studies' own two arms make, every grouping of arms,
// the ones worth looking at first, and what is weak or missing. Pure; the verdicts themselves come from lib/synth.mjs.
//
// A facet: { id, label, levels: [{ id, label }], mixing?: false }   `mixing: false` marks a descriptor (a device name) that does not make a comparison "mixed".
// A derived facet takes its level from another: deriveFacet(arms, { id, label, from, map: { level: derived level }, otherwise }) adds it to every arm.
import { matches, SETTINGS, VERDICTS, outcomeIn, pairOf } from './synth.mjs';

const label = (facet, level) => facet.levels.find(l => l.id === level)?.label ?? String(level);

/** The arms with one more facet, its level taken from `from` through `map` (levels not in the map get `otherwise`). */
export function deriveFacet(arms, { id, from, map, otherwise }) {
  return arms.map(a => ({ ...a, facets: { ...a.facets, [id]: map[a.facets?.[from]] ?? otherwise } }));
}

/** The studies with exactly one arm of each role: the ones that make a within-study comparison. */
export function twoArmStudies(arms) {
  const by = new Map();
  for (const a of arms) (by.get(a.sid) || by.set(a.sid, []).get(a.sid)).push(a);
  return [...by].filter(([, m]) => m.filter(a => a.role === 'I').length === 1 && m.filter(a => a.role === 'C').length === 1).map(([sid]) => sid);
}

/**
 * Every comparison the studies make, by facet: for each facet, each pair of levels two arms of one study take (the intervention arm's level against the comparator's),
 * with the studies that make it. A study that takes the pair the other way round is included with its arms swapped. Each comparison is also restricted by each
 * level of each `restrictBy` facet that leaves fewer studies. `mixed` says why a comparison pools studies that differ in more than the contrasted facet.
 */
export function proposeComparisons(arms, facets, { restrictBy = [] } = {}) {
  const sids = twoArmStudies(arms), out = [];
  const pair = (sid, role) => arms.find(a => a.sid === sid && a.role === role);
  const base = [];
  for (const f of facets) {
    const groups = new Map();
    for (const sid of sids) {
      const i = pair(sid, 'I'), c = pair(sid, 'C'), x = i.facets?.[f.id], y = c.facets?.[f.id];
      if (x == null || y == null || x === y) continue;
      const flip = f.levels.findIndex(l => l.id === x) > f.levels.findIndex(l => l.id === y) && groups.has(`${y}\u0000${x}`);
      const key = flip ? `${y}\u0000${x}` : `${x}\u0000${y}`;
      (groups.get(key) || groups.set(key, []).get(key)).push(sid);
    }
    for (const [key, studies] of groups) {
      const [A, B] = key.split('\u0000');
      base.push({ facet: f, A, B, studies, title: `${f.label}: ${label(f, A)} versus ${label(f, B)}` });
    }
  }
  const make = (b, studies, restriction) => {
    const def = { code: `${b.facet.id}:${b.A}:${b.B}${restriction ? `|${restriction.facet.id}=${restriction.level}` : ''}`, title: restriction ? `${b.title}, ${restriction.facet.label.toLowerCase()} ${label(restriction.facet, restriction.level).toLowerCase()}` : b.title,
      studies, a: { facets: { [b.facet.id]: [b.A] } }, b: { facets: { [b.facet.id]: [b.B] } }, facet: b.facet.id, auto: true };
    const why = mixedWhy(arms, facets, b.facet, studies, def);
    if (why) def.mix = why;
    return def;
  };
  for (const b of base) {
    out.push(make(b, b.studies, null));
    for (const r of restrictBy) {
      const rf = facets.find(f => f.id === r); if (!rf) continue;
      for (const lv of rf.levels) {
        const sub = b.studies.filter(sid => arms.filter(a => a.sid === sid).every(a => a.facets?.[rf.id] === lv.id));
        if (sub.length && sub.length < b.studies.length) out.push(make(b, sub, { facet: rf, level: lv.id }));
      }
    }
  }
  return out;
}

/** Why the studies of a comparison are not alike beyond the contrasted facet, or '' when they are. */
function mixedWhy(arms, facets, facet, studies, def) {
  const others = facets.filter(f => f.id !== facet.id && f.mixing !== false), notes = [];
  const inside = [], sig = new Map();
  for (const sid of studies) {
    const p = pairOf(arms, sid, def); if (!p) continue;
    const diff = others.filter(f => p[0].facets?.[f.id] !== p[1].facets?.[f.id]).map(f => f.label.toLowerCase());
    if (diff.length) inside.push(`${p[0].study} also differs in ${diff.join(' and ')}`);
    sig.set(sid, others.map(f => `${f.id}=${p[1].facets?.[f.id]}`).join('|'));
  }
  if (inside.length) notes.push(...inside);
  const across = others.filter(f => [0, 1].some(side => new Set([...studies].map(sid => pairOf(arms, sid, def)?.[side].facets?.[f.id]).filter(x => x != null)).size > 1));
  if (across.length) notes.push(`The studies differ in ${across.map(f => f.label.toLowerCase()).join(' and ')}`);
  return notes.map((n, i) => (i ? n.replace(/^The /, 'the ') : n)).join('; ');
}

/** The groupings of arms: all of one role, each facet by level (arms of one role), and each restricting facet's level by each other facet. */
export function proposeGroupings(arms, facets, { restrictBy = [] } = {}) {
  const out = [], levelsIn = (f, sel) => f.levels.filter(l => arms.some(a => matches(a, sel) && a.facets?.[f.id] === l.id));
  const sub = (f, sel, extra) => levelsIn(f, sel).map(l => ({ name: label(f, l.id), where: { all: [sel, extra, { facets: { [f.id]: [l.id] } }].filter(Boolean) } }));
  out.push({ code: 'all:I', title: 'All intervention arms', subgroups: [{ name: 'All intervention arms', where: { role: 'I' } }], auto: true });
  if (arms.some(a => a.role === 'C')) out.push({ code: 'all:C', title: 'All comparator arms', subgroups: [{ name: 'All comparator arms', where: { role: 'C' } }], comparatorsOnly: true, auto: true });
  for (const f of facets) for (const [role, word] of [['I', 'intervention'], ['C', 'comparator']]) {
    const subs = sub(f, { role });
    if (subs.length >= 2) out.push({ code: `${f.id}:${role}`, title: `${f.label}, ${word} arms`, subgroups: subs, comparatorsOnly: role === 'C', auto: true });
  }
  for (const r of restrictBy) {
    const rf = facets.find(f => f.id === r); if (!rf) continue;
    for (const lv of levelsIn(rf, { role: 'I' })) for (const f of facets) {
      if (f.id === rf.id) continue;
      const subs = sub(f, { role: 'I' }, { facets: { [rf.id]: [lv.id] } });
      if (subs.length >= 2) out.push({ code: `${rf.id}=${lv.id}/${f.id}:I`, title: `${label(rf, lv.id)}: ${f.label.toLowerCase()}, intervention arms`, subgroups: subs, auto: true });
    }
  }
  return out;
}

// ---- what to look at first -------------------------------------------------------------------------------------------------------
const RANK = Object.fromEntries(VERDICTS.map((v, i) => [v, i]));
/** The `n` records most worth drawing: the best verdicts first, then the most studies and patients, at most `per` for one outcome and kind of grouping. */
export function highlights(records, n = 12, per = 2) {
  const seen = new Map(), out = [];
  const score = r => [RANK[r.verdict], -(r.kEst ?? r.kBoth), -r.patients];
  const sorted = records.filter(r => ['Usable', 'Usable with caveat', 'Usable, descriptive'].includes(r.verdict)).sort((a, b) => { const x = score(a), y = score(b); return x[0] - y[0] || x[1] - y[1] || x[2] - y[2]; });
  for (const r of sorted) {
    const key = `${r.outcomeId}|${r.family}|${r.method.slice(0, 4)}`;
    if ((seen.get(key) || 0) >= per) continue;
    seen.set(key, (seen.get(key) || 0) + 1); out.push(r);
    if (out.length >= n) break;
  }
  return out;
}

// ---- weak and missing --------------------------------------------------------------------------------------------------------------
/**
 * What limits the review, from its arms and its records: [{ kind: 'missing'|'weak', text, outcomeId?, n? }], the missing first. Counts, never opinions: each line names
 * the number it comes from.
 */
export function findings({ arms, outcomes, records, facets = [] }, settings = SETTINGS) {
  const out = [], studies = [...new Set(arms.map(a => a.sid))], name = sid => arms.find(a => a.sid === sid)?.study || String(sid);
  for (const o of outcomes) {
    const reporting = studies.filter(sid => arms.filter(a => a.sid === sid).some(a => outcomeIn(a, o)));
    if (reporting.length < studies.length) out.push({ kind: 'missing', outcomeId: o.id, n: studies.length - reporting.length, text: `${o.name}: reported by ${reporting.length} of ${studies.length} studies` });
    const partial = arms.filter(a => outcomeIn(a, o)?.partial).length;
    if (partial) out.push({ kind: 'weak', outcomeId: o.id, n: partial, text: `${o.name}: ${partial} ${partial === 1 ? 'arm has' : 'arms have'} a partly reported composite` });
    const mine = records.filter(r => r.outcomeId === o.id);
    if (mine.length && !mine.some(r => r.verdict === 'Usable')) out.push({ kind: 'weak', outcomeId: o.id, text: `${o.name}: no combination is Usable${mine.some(r => r.verdict === 'Usable with caveat') ? '; the best is Usable with caveat' : ''}` });
    const comparative = mine.filter(r => r.family === 'Comparative' && r.method.startsWith('Meta'));
    if (comparative.length && !comparative.some(r => r.kEst >= settings.usableStudies)) out.push({ kind: 'weak', outcomeId: o.id, text: `${o.name}: no comparison has ${settings.usableStudies} studies that can be pooled` });
  }
  for (const f of facets) {
    const bare = arms.filter(a => a.facets?.[f.id] == null).length;
    if (bare) out.push({ kind: 'missing', n: bare, text: `${f.label}: ${bare} ${bare === 1 ? 'arm has' : 'arms have'} no level` });
  }
  const unlike = arms.filter(a => a.nCell != null && a.n > 0 && a.nCell !== a.n);
  if (unlike.length) out.push({ kind: 'weak', n: unlike.length, text: `${unlike.length} ${unlike.length === 1 ? 'arm gives' : 'arms give'} a patient count that differs from the denominator of its counts: ${unlike.map(a => `${a.study} (${a.nCell} and ${a.n})`).slice(0, 4).join(', ')}${unlike.length > 4 ? ', …' : ''}` });
  const noN = arms.filter(a => !(a.n > 0)).length;
  if (noN) out.push({ kind: 'missing', n: noN, text: `${noN} ${noN === 1 ? 'arm has' : 'arms have'} no patient count` });
  const noFu = arms.filter(a => !(a.fu > 0)).length;
  if (noFu) out.push({ kind: 'missing', n: noFu, text: `${noFu} ${noFu === 1 ? 'arm has' : 'arms have'} no follow-up` });
  const high = records.filter(r => r.issues?.some(i => /^Heterogeneity|^I² above/.test(i))).length;
  if (high) out.push({ kind: 'weak', n: high, text: `${high} ${high === 1 ? 'combination has' : 'combinations have'} I² above ${settings.i2Flag}%` });
  const mixed = new Set(records.filter(r => r.family === 'Comparative' && r.mix).map(r => r.code)).size;   // comparisons, not comparison-outcome pairs
  if (mixed) out.push({ kind: 'weak', n: mixed, text: `${mixed} ${mixed === 1 ? 'comparison pools' : 'comparisons pool'} studies that differ in more than the contrasted facet` });
  const groups = new Map();
  for (const a of arms) if (a.overlap) (groups.get(a.overlap) || groups.set(a.overlap, new Set()).get(a.overlap)).add(a.sid);
  for (const [g, set] of groups) out.push({ kind: 'weak', text: `Overlapping cohorts (${g}): ${[...set].map(name).join(', ')}; arm-level pooling keeps one` });
  return out.sort((a, b) => (a.kind === 'missing' ? 0 : 1) - (b.kind === 'missing' ? 0 : 1));
}

/**
 * What is weak or missing, in the two forms the page shows: `outcomes`, one entry per outcome ({ id, name, reporting, total, partial, best, why }:
 * the studies that report it, the arms whose composite is partly reported, the best verdict and, when nothing is Usable, the reason in a few words),
 * and `issues`, the data problems across the review ([{ label, text }]). `records` are those shown (the named set, where there is one).
 */
export function weakSummary({ arms, outcomes, records, facets = [], overlapKeep = {} }, settings = SETTINGS) {
  const studies = [...new Set(arms.map(a => a.sid))], name = sid => arms.find(a => String(a.sid) === String(sid))?.study || String(sid);
  const rank = v => VERDICTS.indexOf(v), list = (xs, n = 4) => `${xs.slice(0, n).join(', ')}${xs.length > n ? `, and ${xs.length - n} more` : ''}`;
  const rows = outcomes.map(o => {
    // the studies behind each count, so a count opens them (Syntheses, Weak or missing)
    const reportingIds = studies.filter(sid => arms.some(a => a.sid === sid && outcomeIn(a, o))), partialArms = arms.filter(a => outcomeIn(a, o)?.partial);
    const reporting = reportingIds.length, partial = partialArms.length, partialIds = [...new Set(partialArms.map(a => a.sid))];
    const mine = records.filter(r => r.outcomeId === o.id), bestRec = mine.length ? mine.reduce((a, r) => (rank(r.verdict) < rank(a.verdict) ? r : a)) : null, best = bestRec?.verdict || null;
    const cmp = mine.filter(r => r.family === 'Comparative' && r.method.startsWith('Meta')), kMax = Math.max(0, ...cmp.map(r => r.kEst));
    const why = best === 'Usable' || !mine.length ? '' : cmp.length && kMax < settings.usableStudies ? `At most ${kMax} ${kMax === 1 ? 'study' : 'studies'} in any comparison` : 'Every usable result carries a caveat';
    return { id: o.id, name: o.name, reporting, total: studies.length, partial, best, why, reportingIds, partialIds, bestCode: bestRec?.code || '' };
  });
  const issues = [];
  for (const f of facets) { const bare = arms.filter(a => a.facets?.[f.id] == null).length; if (bare) issues.push({ label: f.label, text: `${bare} ${bare === 1 ? 'arm has' : 'arms have'} no level` }); }
  const unlike = arms.filter(a => a.nCell != null && a.n > 0 && a.nCell !== a.n);
  if (unlike.length) issues.push({ label: 'Patient count', text: list(unlike.map(a => `${a.study}: ${a.nCell} in its arm, counts out of ${a.n}`)) });
  const noN = arms.filter(a => !(a.n > 0)).length; if (noN) issues.push({ label: 'Patient count', text: `${noN} ${noN === 1 ? 'arm has' : 'arms have'} none` });
  const noFu = arms.filter(a => !(a.fu > 0)); if (noFu.length) issues.push({ label: 'Follow-up', text: `Not given for ${list([...new Set(noFu.map(a => a.study))])}` });
  const high = records.filter(r => r.issues?.some(i => /^Heterogeneity|^I² above/.test(i)));
  if (high.length) {
    const by = new Map(); for (const r of high) by.set(r.grouping, (by.get(r.grouping) || 0) + 1);
    issues.push({ label: 'Heterogeneity', text: `I² above ${settings.i2Flag}% in ${high.length} ${high.length === 1 ? 'result' : 'results'}, most in ${list([...by].sort((a, b) => b[1] - a[1]).map(([g]) => g.replace(/^./, c => c.toLowerCase())), 3)}` });
  }
  const mixed = [...new Map(records.filter(r => r.family === 'Comparative' && r.mix).map(r => [r.code, r.grouping])).values()];
  if (mixed.length) issues.push({ label: 'Mixed comparisons', text: `${mixed.length} pool studies that differ in more than the contrast: ${list(mixed.map(g => g.replace(/^./, c => c.toLowerCase())), 3)}` });
  const groups = new Map();
  for (const a of arms) if (a.overlap) (groups.get(a.overlap) || groups.set(a.overlap, new Set()).get(a.overlap)).add(a.sid);
  for (const [g, set] of groups) {
    const ids = [...set], keep = overlapKeep[g] ?? ids.map(sid => [sid, arms.filter(a => a.sid === sid).reduce((n, a) => n + (a.n || 0), 0)]).sort((a, b) => b[1] - a[1])[0][0];
    issues.push({ label: 'Overlapping cohorts', text: `${ids.map(name).join(', ')}: arm-level pooling keeps ${name(keep)}` });
  }
  return { outcomes: rows, issues };
}

/**
 * A combination a person builds (Syntheses > New combination): a comparison of the arms matching `a` against the arms matching `b` within the
 * same studies, or the proportions of the arms matching `where`, one group per level of `split` (or one group). `a`, `b` and `where` map a facet to
 * the levels chosen ({ type: ['dynamic', 'hybrid_level'] }); an empty map is any arm. `role` keeps intervention arms ('I'), comparator arms ('C')
 * or both (''). Returns { def, studies } with the definition the engine evaluates, or { error }.
 */
export function customDefinition({ kind = 'comparison', a = {}, b = {}, where = {}, split = '', role = 'I' }, arms, facets) {
  const spec = (map, extra = {}) => ({ ...extra, facets: Object.fromEntries(Object.entries(map).filter(([, v]) => v?.length)) });
  const lv = (f, id) => facets.find(x => x.id === f)?.levels.find(l => l.id === id)?.label || id;
  const words = map => Object.entries(map).filter(([, v]) => v?.length).map(([f, v]) => v.map(id => lv(f, id)).join(' or ')).join(', ') || 'any arm';
  if (kind === 'comparison') {
    const A = spec(a), B = spec(b), sids = [...new Set(arms.map(x => x.sid))];
    if (!Object.keys(A.facets).length || !Object.keys(B.facets).length) return { error: 'Choose the levels of both sides' };
    const low = s => (/^[A-Z][A-Z0-9]/.test(s) ? s : s.replace(/^./, c => c.toLowerCase()));
    const def = { title: `${words(a).replace(/^./, c => c.toUpperCase())} versus ${low(words(b))}`, a: A, b: B, studies: [] };
    def.studies = sids.filter(sid => pairOf(arms, sid, def));
    return def.studies.length ? { def, studies: def.studies } : { error: 'No study has an arm on each side' };
  }
  const base = spec(where, role ? { role } : {}), f = facets.find(x => x.id === split);
  const subgroups = f ? f.levels.map(l => ({ name: l.label, where: { all: [base, { facets: { [f.id]: [l.id] } }] } })) : [{ name: words(where).replace(/^./, c => c.toUpperCase()), where: base }];
  const used = subgroups.filter(g => arms.some(x => matches(x, g.where)));
  if (!used.length) return { error: 'No arm matches' };
  const who = role === 'I' ? 'intervention arms' : role === 'C' ? 'comparator arms' : 'arms';
  const def = { title: `${words(where)}${f ? ` by ${f.label.toLowerCase()}` : ''}, ${who}`.replace(/^./, c => c.toUpperCase()), subgroups: used, ...(role === 'C' ? { comparatorsOnly: true } : {}) };
  return { def, studies: [...new Set(arms.filter(x => used.some(g => matches(x, g.where))).map(x => x.sid))] };
}
