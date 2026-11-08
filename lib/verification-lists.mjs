// Verification lists drawn by Lykos (2 Nov 2026): the lists two people check before submission (L1–L8 of the sham response review,
// protocol item 38 and decision 13.1), drawn from the record with Lykos's own definitions instead of a project script
// (Manuscript/Submission/build/12-verification-lists.mjs of 1 Nov 2026 read the R-era analysis CSVs). Pure: state in, lists out.
//
//   L1 included trials (both people)                       L2 full-text uncertain or awaiting classification (both people)
//   L3 full-text exclusions (person A)                     L4 full-text exclusions, 20% stratified by reason (person B)
//   L5 values entering a synthesis (person A)              L6 those values, 20% stratified by trial (person B)
//   L7 risk of bias of every included trial (both people)  L8 title/abstract exclusions, 10% stratified by database x reason (one person)
//
// Included trials, uncertain and awaiting records are reviewStudies; a record's databases are flowArms().sourcesOf, its stratum the first
// of `databases` among them. The values entering a synthesis are the cells read (change-rows source_keys) for every trial x outcome slot x
// arm row a pool of the change syntheses reads (primary, randomized withdrawal, responders, percent improvement, between-arm SMD, the S10
// medians: lib/change-synthesis.mjs changeDatasets and sensitivityRows), or that a sensitivity set can use (an SMCR-ready sham row, an
// SMCR-ready active arm of the sham/active pairs, or a sham row with only an end SD, S8); the serious adverse event cell of every coded arm
// (plan.sae.coding); and the study-level cells the models and moderators read for each of those trials. Empty cells (NR, NA) and the
// study's name and number are left out.
//
// Samples are stable: each item is ranked by its own hash, mulberry32 seeded with fnv1a("<seed>|<list>|<stratum>|<item key>"), and a stratum
// gives the first ceil(rate x its size) by rank (2 Nov 2026; be17d993 shuffled each stratum as a whole, so one record more reshuffled it).
// An item's rank depends on nothing else, so a stratum growing or shrinking by one changes its sample only at the margin: at most one item
// in and one out. The draw's options are kept with the lists
// (s.verification.draw), so staleLists says when inclusion or values have changed what a draw would give.
import { lib_review_studies$reviewStudies as reviewStudies, lib_review_studies$perVersion as perVersion } from "../boot.mjs";
import { flowArms } from './prisma-counts.mjs';
import { changeRows } from './change-rows.mjs';
import { changeSets, changeDatasets, sensitivityRows, changePlan, withScaleDecisions } from './change-synthesis.mjs';
import { percentImprovement } from './change-moderators.mjs';
import { conversionFields } from './instrument-crosswalks.mjs';
import { listsOf } from './person-checks.mjs';

export const DRAW_SEED = 20261101;
export const LIST_NAMES = Object.freeze({ L1: 'Included trial', L2: 'Full-text uncertain', L3: 'Full-text exclusion', L4: 'Full-text exclusion, 20% sample',
  L5: 'Value entering a synthesis', L6: 'Value entering a synthesis, 20% sample', L7: 'Risk of bias', L8: 'Title/abstract exclusion, 10% sample' });
const RATES = { L4: 0.2, L6: 0.2, L8: 0.1 };
const WITHDRAWAL = 'randomized-withdrawal';
const str = v => (v == null ? '' : String(v));

// ---- seeded sampling -----------------------------------------------------------------------------------------------------------------
export const fnv = t => { let h = 2166136261; for (const c of String(t)) { h ^= c.codePointAt(0); h = Math.imul(h, 16777619) >>> 0; } return h; };
export const mulberry = a => () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
/** An item's place in its stratum's draw, a number in [0, 1) that depends only on seed, list, stratum and item key. */
export const drawRank = (seed, tag, stratum, key) => mulberry(fnv(`${seed}|${tag}|${stratum}|${key}`))();
/**
 * A stratified sample: { out: [{ ...item, stratum, rank }], strata: [{ stratum, of, drawn }] }, the first ceil(rate x size) of each stratum
 * by drawRank (ties by key). rank is the item's place in that order (1 = drawn first).
 */
export function sampleStrata(items, { keyOf, stratumOf, rate, tag, seed = DRAW_SEED }) {
  const by = new Map();
  for (const x of items) { const k = stratumOf(x); if (!by.has(k)) by.set(k, []); by.get(k).push(x); }
  const out = [], strata = [];
  for (const [k, list] of [...by].sort((a, b) => a[0].localeCompare(b[0]))) {
    const a = list.map(x => ({ x, key: keyOf(x), r: drawRank(seed, tag, k, keyOf(x)) })).sort((p, q) => p.r - q.r || p.key.localeCompare(q.key));
    const n = Math.ceil(rate * a.length);
    strata.push({ stratum: k, of: a.length, drawn: n });
    a.slice(0, n).forEach((y, i) => out.push({ ...y.x, stratum: k, rank: i + 1 }));
  }
  return { out, strata };
}

// ---- values entering a synthesis -----------------------------------------------------------------------------------------------------
const EMPTY = v => /^\s*(NR|NA|N\/A|none)?\s*$/i.test(str(v)) || /^(NR|NA)\b/.test(str(v).trim());
/**
 * The value keys that enter a synthesis of the change plan (s.synthesis.change): { keys (sorted), trials (record ids), unknown (keys a row
 * reads that hold no value), table }. `studyFields` adds study-level columns to those the rows read (the review's assessor blinding).
 */
export function synthesisValueKeys(s, { studyFields = [] } = {}) {
  const plan = changePlan(s) || {}, rows = withScaleDecisions(changeRows(s, plan.rows || {}), plan.scales);
  if (!rows.table) return { keys: [], trials: [], unknown: 0, table: null };
  const F = rows.config.fields, T = rows.table, sets = changeSets(rows, { assumedR: plan.assumedR ?? 0.5 }), ds = changeDatasets(rows, plan, sets);
  const k3 = (t, a, o) => `${t}|${a}|${o}`, want = new Set(), stackedArms = new Set();
  const add = list => { for (const r of list) want.add(k3(r.trial, r.arm, r.outcome_slot)); };
  add(sets.prim); add(sets.rw); add(sets.sens); add(ds.rs); add(percentImprovement(sets.sham).rows); add(ds.smdRows);
  for (const def of (plan.sensitivity || []).filter(d => d.add === 'medians')) add(sensitivityRows(def, sets, rows).rows.filter(r => 'b_sd' in r));
  // the active arms the sham/active model reads ("arm2+arm3" is two arms combined)
  for (const r of ds.stacked) for (const a of str(r.arm).split('+')) stackedArms.add(`${r.trial}|${a}`);
  for (const a of sets.all) {
    const fb = !a.smcr_ok && a.arm_role === 'sham' && a.design !== WITHDRAWAL && a.yi_fb != null;
    if ((a.smcr_ok && (a.arm_role === 'sham' || stackedArms.has(`${a.trial}|${a.arm}`))) || fb) want.add(k3(a.trial, a.arm, a.outcome_slot));
  }
  const keys = new Set(), trials = new Set(), pidOf = new Map();
  for (const a of sets.all) {
    pidOf.set(a.trial, a.paper_id);
    if (!want.has(k3(a.trial, a.arm, a.outcome_slot))) continue;
    for (const k of a.source_keys || []) { keys.add(k); trials.add(a.paper_id); }
  }
  for (const c of plan.sae?.coding || []) { const id = pidOf.get(c.trial); if (id) { keys.add(`${id}:${T}.${F.sae}@${c.arm}`); trials.add(id); } }
  const study = [F.indicationClass, F.procedureClass, F.shamType, F.design, F.openLabel, F.blindedWeeks, F.weeksToSham, F.funding, F.primaryMet, F.randomized, ...studyFields];
  for (const id of trials) for (const f of new Set(study)) keys.add(`${id}:${T}.${f}`);
  // the covariate a crosswalk converts with (an arm's Hoehn and Yahr mix; lib/instrument-crosswalks.mjs), study-level or per arm
  for (const col of conversionFields(s, plan.scales)) for (const a of sets.all) if (trials.has(a.paper_id)) { keys.add(`${a.paper_id}:${col}`); keys.add(`${a.paper_id}:${col}@${a.arm}`); }
  const labelOnly = new Set([F.study, F.id, F.reports]), field = k => k.slice(k.indexOf(`:${T}.`) + T.length + 2).split('@')[0];
  const all = [...keys];
  return { keys: all.filter(k => s.values?.[k] && !EMPTY(s.values[k].reported_value) && !labelOnly.has(field(k))).sort(), trials: [...trials],
    unknown: all.filter(k => !s.values?.[k]).length, table: T };
}

// ---- the draw ------------------------------------------------------------------------------------------------------------------------
const reasonOf = d => (str(d?.reason).match(/^E\d+/) || ['no reason'])[0];
const both = people => (people.length > 1 ? `${people.join('; ')} (independently)` : people[0] || 'one person (to be named)');
/**
 * The eight lists from the record: { lists (for set_verification_lists), rows (one CSV row per item, the columns of CSV_COLUMNS), summary,
 * draw (the options, kept with the lists) }. Options: seed, people [A, B] (else the people of lists already drawn), databases (the order a
 * record's database stratum is chosen in), studyFields (study-level columns added to the values), file (the CSV the lists are written to).
 * A list already in the project keeps its people and blinding.
 */
export function drawLists(s, { seed = DRAW_SEED, people = [], databases = [], studyFields = [], file = '', at = new Date().toISOString() } = {}) {
  const papers = s.papers || [], byId = new Map(papers.map(p => [p.id, p])), sc = s.screening || {}, ft = s.fulltext || {};
  const rv = reviewStudies(s), { sourcesOf } = flowArms(s), vk = synthesisValueKeys(s, { studyFields });
  const prev = new Map(listsOf(s).map(l => [l.id, l]));
  const A = people[0] || prev.get('L3')?.people?.[0] || prev.get('L1')?.people?.[0] || '', B = people[1] || prev.get('L4')?.people?.[0] || prev.get('L1')?.people?.[1] || '';
  const pair = [A, B].filter(Boolean);
  const T = vk.table, idCol = T ? `${T}.${s.synthesis?.change?.rows?.fields?.id || 'column'}` : '';
  const num = p => p.folderNo ?? (T ? s.values?.[`${p.id}:${idCol}`]?.reported_value : '') ?? '';
  const rows = [], items = {};
  const put = (list, person, p, extra = {}) => rows.push({ list: `${list} ${LIST_NAMES[list].replace(/^./, c => c.toLowerCase())}`, person, record_id: p.id, label: p.label || '',
    study_id: num(p), title: p.title || '', doi: p.doi || '', pmid: p.pmid || '', ...extra });
  const item = (list, id, extra = {}) => (items[list] ??= []).push({ id, ...(extra.stratum ? { stratum: extra.stratum } : {}), ...(extra.rank ? { rank: extra.rank } : {}) });
  const trials = [...rv.studies].sort((a, b) => Number(num(a)) - Number(num(b)) || a.id.localeCompare(b.id));
  for (const p of trials) { put('L1', both(pair), p, { reason: 'include' }); item('L1', `ft:${p.id}`); }
  const awaiting = new Set(rv.awaiting.map(p => p.id)), unc = [...new Map([...rv.ftUncertain, ...rv.awaiting].map(p => [p.id, p])).values()].sort((a, b) => a.id.localeCompare(b.id));
  for (const p of unc) { put('L2', both(pair), p, { reason: awaiting.has(p.id) ? 'awaiting classification' : 'uncertain' }); item('L2', `ft:${p.id}`); }
  const ftx = papers.filter(p => ft[p.id]?.decision === 'exclude').sort((a, b) => a.id.localeCompare(b.id));
  for (const p of ftx) { put('L3', A || 'one person (to be named)', p, { reason: ft[p.id].reason || '' }); item('L3', `ft:${p.id}`); }
  const l4 = sampleStrata(ftx.map(p => ({ p })), { keyOf: x => x.p.id, stratumOf: x => reasonOf(ft[x.p.id]), rate: RATES.L4, tag: 'L4', seed });
  for (const x of l4.out) { put('L4', B || 'one person (to be named)', x.p, { reason: ft[x.p.id].reason || '', stratum: x.stratum, rank: x.rank }); item('L4', `ft:${x.p.id}`, x); }
  for (const p of trials) { put('L7', both(pair), p); item('L7', `rob:${p.id}`); }
  const order = databases.length ? databases : [];
  const dbOf = p => { const src = new Set(sourcesOf(p)); return order.find(n => src.has(n)) || [...src].sort()[0] || 'no source'; };
  const tax = papers.filter(p => sc[p.id]?.decision === 'exclude'), dbMemo = new Map(tax.map(p => [p.id, dbOf(p)]));
  const l8 = sampleStrata(tax.map(p => ({ p })), { keyOf: x => x.p.id, stratumOf: x => `${dbMemo.get(x.p.id)} | ${reasonOf(sc[x.p.id])}`, rate: RATES.L8, tag: 'L8', seed });
  const l8who = prev.get('L8')?.people?.[0] || 'one person (to be named)';
  for (const x of l8.out) { put('L8', l8who, x.p, { reason: sc[x.p.id].reason || '', database: dbMemo.get(x.p.id), stratum: x.stratum, rank: x.rank }); item('L8', `ta:${x.p.id}`, x); }
  const field = k => k.slice(k.indexOf(`:${T}.`) + T.length + 2);
  const vrow = (list, person, k, extra = {}) => { const id = k.slice(0, k.indexOf(':')), p = byId.get(id) || { id }, f = field(k);
    put(list, person, p, { value_key: k, field: f.split('@')[0], arm: f.split('@')[1] || '', value: str(s.values[k].reported_value).slice(0, 200), ...extra }); item(list, `value:${k}`, extra); };
  for (const k of vk.keys) vrow('L5', A || 'one person (to be named)', k);
  const l6 = sampleStrata(vk.keys.map(k => ({ k })), { keyOf: x => x.k, stratumOf: x => byId.get(x.k.slice(0, x.k.indexOf(':')))?.label || x.k.slice(0, x.k.indexOf(':')), rate: RATES.L6, tag: 'L6', seed });
  for (const x of l6.out) vrow('L6', B || 'one person (to be named)', x.k, { stratum: x.stratum, rank: x.rank });

  const KIND = { L1: 'ft', L2: 'ft', L3: 'ft', L4: 'ft', L5: 'value', L6: 'value', L7: 'rob', L8: 'ta' };
  const WHO = { L1: pair, L2: pair, L7: pair, L3: A ? [A] : [], L5: A ? [A] : [], L4: B ? [B] : [], L6: B ? [B] : [], L8: [] };
  const SAMPLE = { L4: 'L3', L6: 'L5' };
  const lists = Object.keys(LIST_NAMES).map(id => {
    const was = prev.get(id), its = items[id] || [], independent = ['L1', 'L2', 'L7'].includes(id) && pair.length > 1;
    const ppl = was?.people?.length ? was.people : WHO[id];
    return { id, name: LIST_NAMES[id], kind: KIND[id], people: ppl, independent: was?.independent ?? independent, ...(RATES[id] ? { rate: RATES[id] } : {}), items: its,
      ...(SAMPLE[id] ? { sampleOf: SAMPLE[id] } : {}), blinded: was ? Boolean(was.blinded) : independent || Boolean(SAMPLE[id]), source: { file, rows: its.length, at, drawn: true } };
  });
  const draw = { seed, people: pair, databases: order, studyFields, file, at };
  const count = id => (items[id] || []).length;
  const summary = { seed, L1: count('L1'), L2: count('L2'), L2_awaiting: rv.awaiting.length, L2_uncertain: rv.ftUncertain.length, L3: count('L3'), L4: count('L4'), L4_strata: l4.strata,
    L5: count('L5'), L5_trials: new Set(vk.keys.map(k => k.slice(0, k.indexOf(':')))).size, L5_keys_without_value: vk.unknown, L6: count('L6'), L7: count('L7'),
    ta_exclusions: tax.length, L8: count('L8'), L8_strata: l8.strata.length };
  return { lists, rows, summary, draw };
}

export const CSV_COLUMNS = ['list', 'person', 'record_id', 'label', 'study_id', 'title', 'doi', 'pmid', 'database', 'reason', 'stratum', 'rank', 'value_key', 'field', 'arm', 'value',
  'checked_by', 'checked_on', 'person_decision', 'agrees_with_record', 'note'];
/** The rows as the sheet a person fills in (BOM, one row per item). */
export function listsCsv(rows) {
  const q = v => { const t = str(v); return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; };
  return `﻿${[CSV_COLUMNS.join(','), ...rows.map(r => CSV_COLUMNS.map(c => q(r[c])).join(','))].join('\n')}\n`;
}

/**
 * Lists a draw would now give differently, with the options they were drawn with: [{ id, added, removed }] (empty when they are current, or
 * when the lists were not drawn by Lykos). A record newly included, excluded, or a value entering or leaving a synthesis makes a list stale.
 */
export const staleLists = perVersion(s => {
  const d = s?.verification?.draw;
  if (!d) return [];
  const fresh = drawLists(s, { ...d, people: d.people || [] }).lists, out = [];
  for (const l of fresh) {
    const was = s.verification.lists?.[l.id]; if (!was) { out.push({ id: l.id, added: l.items.length, removed: 0 }); continue; }
    const a = new Set(was.items.map(x => x.id)), b = new Set(l.items.map(x => x.id));
    const added = [...b].filter(x => !a.has(x)).length, removed = [...a].filter(x => !b.has(x)).length;
    if (added || removed) out.push({ id: l.id, added, removed });
  }
  return out;
});
/** "L1 +1, L3 −1", the stale lists in a line. */
export const staleText = st => st.map(x => `${x.id}${x.added ? ` +${x.added}` : ''}${x.removed ? ` −${x.removed}` : ''}`).join(', ');
