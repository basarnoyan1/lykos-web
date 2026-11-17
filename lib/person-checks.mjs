// Person checks (2 Nov 2026): what each person checked, item by item, kept apart from what a model reviewed (lib/review-ledger.mjs keeps
// the reviews that remember what they read) and from the record's own decisions. Built for two people verifying a review before submission
// (a review's verification lists L1–L8, checked by two people), in the app (Screening › Verify) and with `lykos review <folder> check`.
//
//   s.verification = { v: 1,
//     lists: { [id]: { id, name, kind: 'ta' | 'ft' | 'value' | 'rob' | 'study', people: [names], independent, blinded, sampleOf?, rate?,
//                      items: [{ id, stratum?, rank? }], source?: { file, rows, at } } },
//     checks: { [item]: { [person]: { at, by, verdict, decision?, reason?, value?, note?, version, list? } } },
//     reconciled: { [item]: { at, by, verdict, decision?, reason?, value?, note?, versions: { [person]: version } } } }
//
// An item is `ta:<record>` or `ft:<record>` (a screening decision at that stage), `value:<record>:<field>[@armN]` (an extracted value),
// `rob:<record>` (a study's risk of bias) or `study:<record>` (a study's values as a whole, as `lykos review mark --person` checks them).
// Each person's entry is their own: a second person's check never replaces the first. An entry keeps the version (fingerprint) of what it
// checked, so a check of a value or decision changed since is stale and asked again. In a blinded list a person does not see another's
// entry for an item until their own is in (visibleChecks). Agreement is computed per list over the items two people checked: percent and
// Cohen's κ, with the disagreements to reconcile; a reconciled entry is the pair's final word. Pure: state in, state or facts out.
import { fingerprint } from './fingerprint.mjs';
import { lib_rob_review$slotOf as slotOf, lib_rob_review$discrepancies as discrepancies, lib_rob_review$recordOf as robRecord, lib_rob_review$domainIds as domainIds, lib_rob_review$modelOn as modelOn, lib_rob_review$STUDY as STUDY } from "../boot.mjs";
import { readerDone } from './rob-people.mjs';
import { instrumentFor } from './study-instrument.mjs';

export const KINDS = Object.freeze(['ta', 'ft', 'value', 'rob', 'study']);
export const KIND_NAME = Object.freeze({ ta: 'Title and abstract decision', ft: 'Full-text decision', value: 'Extracted value', rob: 'Risk of bias', study: 'Study values' });
export const DECISIONS = Object.freeze(['include', 'exclude', 'uncertain']);
export const VERDICTS = Object.freeze(['agree', 'disagree', 'unsure']);
const str = v => (v == null ? '' : String(v));
const has = o => Boolean(o) && typeof o === 'object' && Object.keys(o).length > 0;

/** An item id's parts: { kind, record, key } (key: the value key for a value), or null. */
export function itemOf(id) {
  const t = str(id), i = t.indexOf(':');
  if (i < 1) return null;
  const kind = t.slice(0, i), rest = t.slice(i + 1);
  if (!KINDS.includes(kind) || !rest) return null;
  if (kind === 'value') { const j = rest.indexOf(':'); return j > 0 ? { kind, record: rest.slice(0, j), key: rest } : null; }
  return { kind, record: rest, key: rest };
}
export const isScreening = kind => kind === 'ta' || kind === 'ft';
const stageKey = kind => (kind === 'ft' ? 'fulltext' : 'screening');
/** The reason's code ("E6" of "E6: Companion report …"), for comparing two reasons. */
export const reasonCode = r => (/^\s*([A-Z]{1,3}\d+[a-z]?)\b/.exec(str(r)) || [])[1] || str(r).trim().toLowerCase();

/** What the record holds now for an item: { decision, reason } for a decision, { value } for a value, { answers } for risk of bias. */
export function recordOf(s, id) {
  const it = itemOf(id);
  if (!it) return null;
  if (isScreening(it.kind)) { const d = s[stageKey(it.kind)]?.[it.record]; return d ? { decision: str(d.decision), reason: str(d.reason) } : { decision: '', reason: '' }; }
  if (it.kind === 'value') { const v = s.values?.[it.key]; return v ? { value: str(v.reported_value), unit: str(v.unit), availability: str(v.availability) } : null; }
  if (it.kind === 'rob') return { answers: s.assessments?.[it.record] || {} };
  const vals = {};
  for (const [k, v] of Object.entries(s.values || {})) if (k.startsWith(`${it.record}:`)) vals[k] = str(v?.reported_value);
  return { values: vals };
}
/** The fingerprint of what an item is now (what a check of it saw). */
export const versionOf = (s, id) => fingerprint(recordOf(s, id));

const store = s => (s.verification && typeof s.verification === 'object' ? s.verification : null);
export const listsOf = s => Object.values(store(s)?.lists || {}).sort((a, b) => str(a.id).localeCompare(str(b.id), 'en', { numeric: true }));
export const listById = (s, id) => store(s)?.lists?.[id] || null;
export const checksOf = (s, id) => store(s)?.checks?.[id] || {};
export const reconciledOf = (s, id) => store(s)?.reconciled?.[id] || null;
/** The people named anywhere: the lists' people, then whoever checked. */
export function peopleOf(s) {
  const out = [];
  const add = n => { const t = str(n).trim(); if (t && !out.includes(t)) out.push(t); };
  for (const l of listsOf(s)) for (const p of l.people || []) add(p);
  for (const by of Object.values(store(s)?.checks || {})) for (const p of Object.keys(by || {})) add(p);
  return out;
}
/** Initials of a name ("Ada Lin Rowe" → "ALR"); a name the screening settings know by initials matches either. */
export const initialsOf = name => str(name).split(/\s+/).filter(Boolean).map(w => w[0].toLocaleUpperCase('tr')).join('');
/** The person a typed name or initials means, among the people named; '' when none or several. */
export function personNamed(s, typed) {
  const t = str(typed).trim().toLocaleLowerCase('tr');
  if (!t) return '';
  const all = peopleOf(s);
  const hit = all.filter(p => p.toLocaleLowerCase('tr') === t || initialsOf(p).toLocaleLowerCase('tr') === t);
  if (hit.length === 1) return hit[0];
  const part = all.filter(p => p.toLocaleLowerCase('tr').split(/\s+/).includes(t));
  return part.length === 1 ? part[0] : '';
}

/** The lists an item is in. */
export function listsWith(s, id) { return listsOf(s).filter(l => (l.items || []).some(x => x.id === id)); }
const blindIndex = new WeakMap();
/** Whether an item is in a blinded list (its people do not see each other's checks until their own is in). */
export function isBlinded(s, id) {
  const v = store(s);
  if (!v) return false;
  let set = blindIndex.get(v.lists || v);
  if (!set) { set = new Set(); for (const l of listsOf(s)) if (l.blinded) for (const x of l.items || []) set.add(x.id); blindIndex.set(v.lists || v, set); }
  return set.has(id);
}
/**
 * The entries a viewer may see for an item: all of them, except in a blinded list, where another person's entry stays hidden until the
 * viewer's own is in. { shown: { [person]: entry }, hidden: n }. A viewer of '' (no one named) sees nothing of a blinded item.
 */
export function visibleChecks(s, id, viewer) {
  const all = checksOf(s, id), me = str(viewer).trim();
  if (!isBlinded(s, id) || (me && all[me])) return { shown: { ...all }, hidden: 0 };
  const shown = me && all[me] ? { [me]: all[me] } : {};
  return { shown, hidden: Object.keys(all).filter(p => p !== me).length };
}
/** Whether an entry still holds: what it checked is what the record holds now. */
export const current = (s, id, entry) => Boolean(entry) && entry.version === versionOf(s, id);

/**
 * The entry a person records: for a decision, their own decision (include, exclude with a reason, uncertain) and whether it agrees with
 * the record's; for a value or a study, a verdict (agree, disagree with a note or the correct value, unsure); for risk of bias, that their
 * assessment is done. Throws on what is not a check.
 */
export function makeEntry(s, { item, person, decision = '', reason = '', verdict = '', value = '', note = '', list = '', at = new Date().toISOString() }) {
  const it = itemOf(item);
  if (!it) throw new Error(`${item} is not an item (ta:<record>, ft:<record>, value:<key>, rob:<record> or study:<record>)`);
  const by = str(person).trim();
  if (!by) throw new Error('a check needs the name of the person who made it');
  if (!(s.papers || []).some(p => p.id === it.record)) throw new Error(`no record ${it.record}`);
  if (it.kind === 'value' && !s.values?.[it.key]) throw new Error(`no value ${it.key}`);
  const base = { at, by, version: versionOf(s, item), ...(str(note).trim() ? { note: str(note).trim().slice(0, 2000) } : {}), ...(list ? { list: str(list) } : {}) };
  if (isScreening(it.kind)) {
    if (!DECISIONS.includes(decision)) throw new Error(`decision is ${DECISIONS.join(', ')}`);
    if (decision === 'exclude' && !str(reason).trim()) throw new Error('an exclusion needs its reason');
    const rec = recordOf(s, item);
    const same = decision === rec.decision && (decision !== 'exclude' || reasonCode(reason) === reasonCode(rec.reason));
    return { ...base, decision, ...(decision === 'exclude' ? { reason: str(reason).trim() } : {}), verdict: same ? 'agree' : 'disagree' };
  }
  if (!VERDICTS.includes(verdict)) throw new Error(`verdict is ${VERDICTS.join(', ')}`);
  if (verdict === 'disagree' && !str(note).trim() && !str(value).trim()) throw new Error('a disagreement needs the correct value or a note saying why');
  return { ...base, verdict, ...(str(value).trim() ? { value: str(value).trim() } : {}) };
}

const ensure = st => {
  st.verification = { v: 1, lists: {}, checks: {}, reconciled: {}, ...(st.verification || {}) };
  for (const k of ['lists', 'checks', 'reconciled']) st.verification[k] = { ...(st.verification[k] || {}) };
  return st.verification;
};
/** Records a person's check (their earlier entry for the item is replaced; another person's never is). Returns the entry. */
export function recordCheck(st, args) {
  const e = makeEntry(st, args), v = ensure(st);
  v.checks[args.item] = { ...(v.checks[args.item] || {}), [e.by]: e };
  return e;
}
/** Takes a person's check of an item back. */
export function removeCheck(st, { item, person }) {
  const v = ensure(st), by = str(person).trim();
  if (!v.checks[item]?.[by]) return false;
  const rest = { ...v.checks[item] }; delete rest[by];
  if (has(rest)) v.checks[item] = rest; else delete v.checks[item];
  return true;
}
/** The pair's final word on an item they disagreed on (or any item): their decision or verdict, with the reason. */
export function reconcile(st, { item, by, decision = '', reason = '', verdict = '', value = '', note = '', at = new Date().toISOString() }) {
  const it = itemOf(item);
  if (!it) throw new Error(`${item} is not an item`);
  if (!str(by).trim()) throw new Error('a reconciliation needs the name of who recorded it');
  if (!str(note).trim()) throw new Error('a reconciliation needs its reason');
  const v = ensure(st), versions = Object.fromEntries(Object.entries(v.checks[item] || {}).map(([p, e]) => [p, e.version]));
  let e;
  if (isScreening(it.kind)) {
    if (!DECISIONS.includes(decision)) throw new Error(`decision is ${DECISIONS.join(', ')}`);
    if (decision === 'exclude' && !str(reason).trim()) throw new Error('an exclusion needs its reason');
    e = { decision, ...(decision === 'exclude' ? { reason: str(reason).trim() } : {}) };
  } else {
    if (!VERDICTS.includes(verdict)) throw new Error(`verdict is ${VERDICTS.join(', ')}`);
    e = { verdict, ...(str(value).trim() ? { value: str(value).trim() } : {}) };
  }
  v.reconciled[item] = { at, by: str(by).trim(), ...e, note: str(note).trim().slice(0, 2000), versions };
  return v.reconciled[item];
}

// ---- agreement ------------------------------------------------------------------------------------------------------------------------
/** What an entry says, as a category two people's entries are compared on: the decision (with the reason's code), or the verdict. */
export const categoryOf = (kind, e) => (!e ? '' : isScreening(kind) ? (e.decision === 'exclude' ? `exclude ${reasonCode(e.reason)}` : e.decision) : e.verdict);
const decisionOnly = (kind, e) => (!e ? '' : isScreening(kind) ? e.decision : e.verdict);
/** Cohen's κ (unweighted) over pairs of categories, with the observed agreement; κ null when undefined (one category only, or no pairs). */
export function cohen(pairs) {
  const n = pairs.length;
  if (!n) return { n, po: null, kappa: null };
  const cats = [...new Set(pairs.flat())];
  const po = pairs.filter(([x, y]) => x === y).length / n;
  const pe = cats.reduce((t, c) => t + (pairs.filter(p => p[0] === c).length / n) * (pairs.filter(p => p[1] === c).length / n), 0);
  return { n, po, pe, kappa: pe >= 1 ? null : (po - pe) / (1 - pe) };
}
/** The two people a list's agreement is between: its own people, then the people of the list it is a sample of, then whoever checked most. */
export function pairOf(s, list) {
  const named = [...(list.people || []), ...(list.sampleOf ? listById(s, list.sampleOf)?.people || [] : [])].filter((p, i, a) => p && a.indexOf(p) === i);
  if (named.length >= 2) return named.slice(0, 2);
  const counts = new Map();
  for (const x of list.items || []) for (const p of Object.keys(checksOf(s, x.id))) counts.set(p, (counts.get(p) || 0) + 1);
  const rest = [...counts].sort((a, b) => b[1] - a[1]).map(([p]) => p).filter(p => !named.includes(p));
  return [...named, ...rest].slice(0, 2);
}
/**
 * A list's agreement: { people: [a, b], n (items both checked), agree, percent, kappa (on the decision and the reason's code, or the
 * verdict), kappaDecision (screening: on the decision alone), disagreements: [{ item, a, b, reconciled }], open (not reconciled),
 * vsRecord: { [person]: { n, agree } } }. Only current entries count; one made before the item changed is left out (stale).
 */
export function agreementOf(s, list) {
  if (list.kind === 'rob') return robAgreement(s, list);
  const kind = list.kind, [a, b] = pairOf(s, list), pairs = [], pairsD = [], disagreements = [], vsRecord = {};
  for (const x of list.items || []) {
    const all = checksOf(s, x.id);
    for (const [p, e] of Object.entries(all)) {
      if (!current(s, x.id, e)) continue;
      const r = vsRecord[p] ||= { n: 0, agree: 0 };
      r.n++; if (e.verdict === 'agree') r.agree++;
    }
    if (!a || !b) continue;
    const ea = all[a], eb = all[b];
    if (!current(s, x.id, ea) || !current(s, x.id, eb)) continue;
    const ca = categoryOf(kind, ea), cb = categoryOf(kind, eb);
    pairs.push([ca, cb]); pairsD.push([decisionOnly(kind, ea), decisionOnly(kind, eb)]);
    if (ca !== cb) disagreements.push({ item: x.id, a: ea, b: eb, reconciled: reconciledOf(s, x.id) });
  }
  const k = cohen(pairs), kd = cohen(pairsD);
  return { people: [a, b].filter(Boolean), n: pairs.length, agree: pairs.length - disagreements.length, percent: k.po == null ? null : 100 * k.po, kappa: k.kappa,
    ...(isScreening(kind) ? { kappaDecision: kd.kappa, percentDecision: kd.po == null ? null : 100 * kd.po } : {}),
    disagreements, open: disagreements.filter(d => !d.reconciled).length, vsRecord };
}

// Risk of bias is assessed, not checked: each person answers in their own slot of the study's record (lib/rob-review.mjs, reviewer A or B
// named for them), the model's answers kept apart. A person is done with a study when their slot judges every domain; the pair agrees on
// a domain when both slots hold the same judgement; a study's disagreements are its open discrepancies, reconciled when resolved.
const robTool = (s, record) => instrumentFor(s, record);
function robAgreement(s, list) {
  const people = (list.people || []).slice(0, 2), [sa, sb] = people.map(p => slotOf(s, p));
  const pairs = [], vsModel = { a: [], b: [] }, disagreements = [];
  for (const x of list.items || []) {
    const it = itemOf(x.id), tool = robTool(s, it.record), r = robRecord(s, it.record, tool.id, STUDY) || {};
    for (const d of domainIds(tool)) {
      if (sa && sb && r[sa]?.[d] && r[sb]?.[d]) pairs.push([r[sa][d], r[sb][d]]);
      if (r.model?.[d]) for (const k of ['a', 'b']) if (r[k]?.[d]) vsModel[k].push([r[k][d], r.model[d]]);
    }
    if (sa && sb) {
      const open = discrepancies(s, it.record, tool, STUDY).filter(q => q.state !== 'waiting');
      if (open.length) disagreements.push({ item: x.id, domains: open.map(q => q.domain), reconciled: open.every(q => q.state === 'resolved') ? { at: '' } : null });
    }
  }
  const k = cohen(pairs), km = { a: cohen(vsModel.a), b: cohen(vsModel.b) };
  const name = slot => people.find(p => slotOf(s, p) === slot) || (slot === 'a' ? 'Reviewer A' : 'Reviewer B');
  return { people: people.filter(p => slotOf(s, p)), n: pairs.length, agree: pairs.filter(([x, y]) => x === y).length, percent: k.po == null ? null : 100 * k.po, kappa: k.kappa,
    unit: 'judgements', disagreements, open: disagreements.filter(d => !d.reconciled).length,
    vsRecord: Object.fromEntries(['a', 'b'].filter(sl => km[sl].n).map(sl => [name(sl), { n: km[sl].n, agree: Math.round(km[sl].n * km[sl].po), kappa: km[sl].kappa }])), model: modelOn(s) };
}

/** How far each person is with a list: { [person]: { done, stale, of } }, of the items they are to check (every item, for each of its people). */
export function progressOf(s, list) {
  if (list.kind === 'rob') {
    const out = {};
    for (const p of list.people || []) {
      const slot = slotOf(s, p);
      out[p] = { done: slot ? (list.items || []).filter(x => { const rec = itemOf(x.id).record; return readerDone(s, rec, robTool(s, rec), slot); }).length : 0, stale: 0, of: (list.items || []).length, ...(slot ? { slot } : { unassigned: true }) };
    }
    return out;
  }
  const out = {};
  for (const p of list.people || []) out[p] = { done: 0, stale: 0, of: (list.items || []).length };
  for (const x of list.items || []) {
    const all = checksOf(s, x.id);
    for (const p of list.people || []) { const e = all[p]; if (!e) continue; if (current(s, x.id, e)) out[p].done++; else out[p].stale++; }
  }
  return out;
}
/** A list's items with what the viewer may see of each: [{ ...item, mine, others, hidden, reconciled, record }]. */
export function queueOf(s, list, viewer) {
  return (list.items || []).map(x => {
    const v = visibleChecks(s, x.id, viewer), mine = viewer ? checksOf(s, x.id)[viewer] || null : null;
    const others = Object.fromEntries(Object.entries(v.shown).filter(([p]) => p !== viewer));
    return { ...x, ...itemOf(x.id), mine, stale: Boolean(mine) && !current(s, x.id, mine), others, hidden: v.hidden, reconciled: reconciledOf(s, x.id) };
  });
}

// ---- Checked by a person (Submission readiness) --------------------------------------------------------------------------------------
/**
 * What the people checked of what the lists ask: { items (checks asked), checked (current checks made), open (disagreements not reconciled),
 * lists: [{ id, name, kind, asked, done, open }], persons }. With no lists, null (the readiness counts the review ledger's person entries).
 * A list asks each of its people to check each of its items: the values of L5 by one person and L6's 20% sample by the second count as
 * they are listed (one person all, the second a sample).
 */
export function listChecks(s) {
  const lists = listsOf(s).filter(l => (l.people || []).length && (l.items || []).length);
  if (!lists.length) return null;
  let items = 0, checked = 0, open = 0;
  const rows = [], persons = new Set();
  for (const l of lists) {
    const pr = progressOf(s, l), asked = (l.items.length) * l.people.length, done = Object.values(pr).reduce((t, x) => t + x.done, 0);
    const ag = agreementOf(s, l);
    items += asked; checked += done; open += ag.open;
    for (const [p, x] of Object.entries(pr)) if (x.done) persons.add(p);
    rows.push({ id: l.id, name: l.name, kind: l.kind, asked, done, open: ag.open });
  }
  return { items, checked, open, lists: rows, persons: [...persons] };
}

// ---- lists from a CSV ------------------------------------------------------------------------------------------------------------------
/** Quote-aware CSV rows (a BOM dropped). */
export function csvRows(text) {
  const t = str(text).replace(/^﻿/, ''), rows = [];
  let row = [], field = '', q = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (q) { if (c === '"' && t[i + 1] === '"') { field += '"'; i++; } else if (c === '"') q = false; else field += c; }
    else if (c === '"') q = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c !== '\r') field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows.filter(r => r.some(x => x !== ''));
}
const KIND_OF_NAME = [[/risk of bias|rob\s*2|robins/i, 'rob'], [/title.{0,3}abstract/i, 'ta'], [/value/i, 'value'], [/full.?text|included|exclusion|uncertain/i, 'ft']];
/**
 * Verification lists from a CSV with one row per item and the list's name in the first column ("L4 full-text exclusion, 20% sample"):
 * columns list, person, record_id, value_key (a value), stratum, rank. The kind is read from the name (title/abstract, full text, value, risk
 * of bias) or a value_key; the people from `person` ("Ada Lin Rowe; Ben Cole (independently)": both, blinded; "one person (to be
 * named)": none yet); a list whose items are all in another list of its kind is a sample of it (blinded from it). Returns
 * { lists, problems: [lines] } (rows naming a record or value the project lacks are problems and left out).
 */
export function listsFromCsv(s, text, { file = '', at = new Date().toISOString() } = {}) {
  const rows = csvRows(text);
  if (!rows.length) return { lists: [], problems: ['the file is empty'] };
  const head = rows[0].map(h => h.trim().toLowerCase()), col = n => head.indexOf(n);
  const L = col('list'), P = col('person'), RID = col('record_id'), VK = col('value_key'), ST = col('stratum'), RK = col('rank');
  if (L < 0 || RID < 0) return { lists: [], problems: ['the file needs the columns list and record_id'] };
  const ids = new Set((s.papers || []).map(p => p.id)), byName = new Map(), problems = [];
  for (const r of rows.slice(1)) {
    const name = str(r[L]).trim(); if (!name) continue;
    // a list is its id ("L8"), so a row that words its list's name differently is still that list
    const id = (/^(L\d+[a-z]?)\b/i.exec(name) || [])[1]?.toUpperCase() || name;
    let l = byName.get(id);
    if (!l) {
      const who = str(r[P]);
      const people = /to be named|^\s*$/i.test(who) ? [] : who.replace(/\(.*?\)/g, '').split(/;|\band\b/).map(x => x.trim()).filter(Boolean);
      const vk = VK >= 0 && str(r[VK]).trim();
      const kind = vk ? 'value' : (KIND_OF_NAME.find(([re]) => re.test(name)) || [, 'ft'])[1];
      const rate = (/(\d+(?:\.\d+)?)\s*%\s*sample/i.exec(name) || [])[1];
      l = { id, name: name.replace(/^L\d+[a-z]?\s*/i, '').replace(/^./, c => c.toUpperCase()), kind, people, independent: /independent/i.test(who) || people.length > 1,
        ...(rate ? { rate: Number(rate) / 100 } : {}), items: [], seen: new Set(), skipped: 0 };
      byName.set(id, l);
    }
    const rec = str(r[RID]).trim(), key = VK >= 0 ? str(r[VK]).trim() : '';
    const item = l.kind === 'value' ? `value:${key}` : `${l.kind}:${rec}`;
    if (!ids.has(rec) || (l.kind === 'value' && !s.values?.[key])) { l.skipped++; if (problems.length < 20) problems.push(`${l.id}: ${l.kind === 'value' ? `no value ${key}` : `no record ${rec}`}`); continue; }
    if (l.seen.has(item)) continue;
    l.seen.add(item);
    const stratum = ST >= 0 ? str(r[ST]).trim() : '', rank = RK >= 0 ? Number(r[RK]) || 0 : 0;
    l.items.push({ id: item, ...(stratum ? { stratum } : {}), ...(rank ? { rank } : {}) });
  }
  const lists = [...byName.values()];
  for (const l of lists) {
    // a sample of another list: every item of it is in a bigger list of its kind (L4 of L3, L6 of L5); blinded from that list's people
    const of = lists.find(o => o !== l && o.kind === l.kind && o.items.length > l.items.length && l.items.every(x => o.seen.has(x.id)));
    if (of) l.sampleOf = of.id;
  }
  for (const l of lists) {
    l.blinded = l.independent || Boolean(l.sampleOf);
    l.source = { file, rows: l.items.length + l.skipped, at };
    if (l.skipped) problems.push(`${l.id}: ${l.skipped} rows left out`);
    delete l.seen; delete l.skipped;
  }
  return { lists, problems };
}
/**
 * Puts lists in the project (a list with the same id is replaced; the checks already made stay, being kept by item, and a check of an item
 * unchanged since stays current). `draw`: the options Lykos drew them with (lib/verification-lists.mjs), kept to tell when they are stale.
 */
export function putLists(st, lists, { draw } = {}) {
  const v = ensure(st);
  if (draw && typeof draw === 'object') v.draw = draw;
  for (const l of lists) {
    if (!l?.id || !KINDS.includes(l.kind) || !Array.isArray(l.items)) throw new Error(`list ${l?.id || '?'} needs an id, a kind (${KINDS.join(', ')}) and items`);
    v.lists[l.id] = { ...l, people: (l.people || []).map(p => str(p).trim()).filter(Boolean), blinded: Boolean(l.blinded) };
  }
  return v;
}
/** A list's people or blinding changed (Verify › list settings; `lykos review lists --people`). */
export function setListPeople(st, id, { people, blinded } = {}) {
  const v = ensure(st), l = v.lists[id];
  if (!l) throw new Error(`no list ${id}`);
  v.lists[id] = { ...l, ...(Array.isArray(people) ? { people: people.map(p => str(p).trim()).filter(Boolean) } : {}), ...(blinded == null ? {} : { blinded: Boolean(blinded) }) };
  return v.lists[id];
}

// ---- the count Submission readiness and the Overview read ------------------------------------------------------------------------------
const MODEL = /\b(claude|codex|gpt|chatgpt|openai|deepseek|gemini|llama|mistral|qwen|sonnet|opus|haiku|model|agent)\b/i;
const byPersonEntry = e => Boolean(e && e.person === true && str(e.by).trim());
/**
 * What a person has checked: { items, checked, data: { n, checked }, rob: { n, checked }, persons, models, lists?, open? }. With verification
 * lists, the items are the checks the lists ask (each list's items, for each of its people) and `lists` says each list's share; without,
 * each study with values (`study:<id>`) and each appraised study (`rob:<id>`), counted when a person's entry holds without issues: the
 * review ledger's (`lykos review mark --person`, before 2 Nov 2026) or a person's check here. `models` names the model reviewers whose
 * checks are recorded (sweeps, value checks, the ledger): never counted.
 */
export function personChecks(s, studies, { appraised = null } = {}) {
  const ledger = s.reviewLedger?.items || {}, withValues = new Set();
  for (const k of Object.keys(s.values || {})) { const i = k.indexOf(':'); if (i > 0) withValues.add(k.slice(0, i)); }
  const mine = id => Object.values(checksOf(s, id)).some(e => e.verdict !== 'disagree' && (e.verdict === 'agree' || itemOf(id)?.kind === 'rob'));
  const ok = id => (byPersonEntry(ledger[id]) && ledger[id].verdict !== 'issue') || mine(id);
  const data = studies.filter(p => withValues.has(p.id)), rob = appraised || studies.filter(p => s.assessments?.[p.id] || s.robReview?.records?.[p.id]);
  const persons = new Set(Object.values(ledger).filter(byPersonEntry).map(e => str(e.by).trim()));
  for (const by of Object.values(store(s)?.checks || {})) for (const p of Object.keys(by || {})) persons.add(p);
  const models = new Set();
  for (const e of Object.values(ledger)) if (!byPersonEntry(e) && e?.by) models.add(str(e.by).trim());
  for (const st of Object.values(s.robSweeps?.studies || {})) for (const tool of Object.values(st || {})) for (const sw of Object.values(tool || {})) if (sw?.by) models.add(str(sw.by).replace(/\s*\(.*\)$/, ''));
  for (const v of Object.values(s.valueChecks?.studies || {})) if (v?.by) models.add(str(v.by).replace(/\s*\(.*\)$/, ''));
  const dataChecked = data.filter(p => ok(`study:${p.id}`)).length, robChecked = rob.filter(p => ok(`rob:${p.id}`)).length;
  const base = { items: data.length + rob.length, checked: dataChecked + robChecked, data: { n: data.length, checked: dataChecked }, rob: { n: rob.length, checked: robChecked },
    persons: [...persons], models: [...models].filter(m => MODEL.test(m) || !persons.has(m)).sort() };
  const lists = listChecks(s);
  return lists ? { ...base, items: lists.items, checked: lists.checked, open: lists.open, lists: lists.lists, persons: [...new Set([...lists.persons, ...base.persons])] } : base;
}
/** "L5 values: 3,210 of 4,010; L4 full-text exclusions: 0 of 118", the lists not complete, for a readiness line. */
export function listsLeftText(c) {
  const n = x => x.toLocaleString('en');
  return (c?.lists || []).filter(l => l.done < l.asked).map(l => `${l.id} ${n(l.done)} of ${n(l.asked)}`).join(', ');
}
