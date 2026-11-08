// Sealed allocation (amendment of 2026-09-29): a randomisation list from
// lib/trial-tools.mjs put behind a seal, revealed one participant at a time,
// with every reveal and every unblinding written to a hash-chained audit log.
//
// What the seal is: each position carries a SHA-256 commitment to its arm (a
// secret salt, the stratum, the position and the arm), and the list's seed
// is kept only as a hash. The arms themselves sit in the allocation's `vault`
// in the project, because a local app has no one else to hold them; the
// vault is kept out of every view (publicAllocation) and the commitments show
// if it was edited. This is allocation concealment against a look over the
// shoulder and tamper evidence, not cryptographic secrecy from the project's
// owner, who can read the file.
//
// Deterministic and offline: the same list and seed give the same seal.
// State shape (mutated in place by the functions that take `state`):
//   state.allocations = [allocation], state.allocationLog = [entry]
import { randomisationList } from './trial-tools.mjs';
import { enrolmentIssues } from './trial-operations.mjs';

import { lib_sha256$sha256 as sha256 } from "../boot.mjs";
export { lib_sha256$sha256 as sha256 } from "../boot.mjs";

// ---- sealing -----------------------------------------------------------------------------------
const commit = (salt, stratum, position, arm) => sha256(`${salt}\u0000${stratum}\u0000${position}\u0000${arm}`);

/**
 * Seals a randomisation list (from randomisationList): returns
 *   { id, createdAt, createdBy, blinded, arms, strata, seedHash,
 *     entries: [{ stratum, position, block, hash, participantId?, arm?, code?, at?, by? }],
 *     vault: { seed, salts: [..], arms: [..] } }
 * Entries are numbered from 1 within each stratum. `blinded` allocations
 * reveal a pack code at allocation and the arm only on unblinding.
 */
export function sealAllocation(list, { id = null, at = null, by = '', blinded = false } = {}) {
  if (!list?.rows?.length) throw new Error('The randomisation list is empty');
  const seed = String(list.seed);
  const aid = id || `alloc${sha256(`${seed}\u0000${list.rows.length}\u0000${list.arms.join('|')}`).slice(0, 10)}`;
  const counter = {};
  const salts = [], arms = [];
  const entries = list.rows.map((r, i) => {
    const stratum = String(r.stratum ?? ''), position = (counter[stratum] = (counter[stratum] || 0) + 1);
    const salt = sha256(`salt\u0000${seed}\u0000${aid}\u0000${i}`);
    salts.push(salt); arms.push(r.arm);
    return { stratum, position, block: r.block, hash: commit(salt, stratum, position, r.arm) };
  });
  return {
    id: aid,
    createdAt: at || new Date().toISOString(),
    createdBy: by,
    blinded: !!blinded,
    arms: [...list.arms],
    weights: [...(list.weights || [])],
    blockSizes: [...(list.blockSizes || [])],
    strata: Object.keys(counter),
    size: entries.length,
    seedHash: sha256(`seed\u0000${seed}`),
    entries,
    vault: { seed, salts, arms },
  };
}

/** Builds the list (trial-tools) and seals it in one step. */
export const createSealedAllocation = (settings, options) => sealAllocation(randomisationList(settings), options);

/** The allocation without its vault, and with arms hidden where not yet revealed or, if blinded, not unblinded. */
export function publicAllocation(a) {
  if (!a) return null;
  const { vault, ...rest } = a;
  return { ...rest, entries: a.entries.map(e => ({ ...e })) };
}

/** Whether every entry's commitment matches its vault arm, and the seed its hash: { ok, problems }. */
export function verifySeal(a) {
  const problems = [];
  if (sha256(`seed\u0000${a.vault.seed}`) !== a.seedHash) problems.push('The seed does not match its hash');
  a.entries.forEach((e, i) => {
    if (commit(a.vault.salts[i], e.stratum, e.position, a.vault.arms[i]) !== e.hash) problems.push(`Position ${e.position}${e.stratum ? ` in ${e.stratum}` : ''} does not match its seal`);
    if (e.arm != null && e.arm !== a.vault.arms[i]) problems.push(`Position ${e.position}${e.stratum ? ` in ${e.stratum}` : ''} was revealed as a different arm`);
  });
  return { ok: !problems.length, problems };
}

/** Whether the list the seal came from is reproduced by these settings (for an audit, after the trial). */
export function matchesList(a, list) {
  return list?.rows?.length === a.size && list.rows.every((r, i) => r.arm === a.vault.arms[i] && String(r.stratum ?? '') === a.entries[i].stratum);
}

// ---- the audit log (hash-chained) -------------------------------------------------------------------
function log(state, entry) {
  const all = (state.allocationLog ||= []);
  const prev = [...all].reverse().find(e => e.allocationId === entry.allocationId)?.hash || '';
  const seq = all.filter(e => e.allocationId === entry.allocationId).length + 1;
  const body = { seq, ...entry, prev };
  const e = { ...body, hash: sha256(JSON.stringify(body)) };
  all.push(e);
  return e;
}

/** An allocation's log, oldest first. */
export const auditTrail = (state, allocationId) => (state?.allocationLog || []).filter(e => e.allocationId === allocationId);

/** Whether the log's chain is intact: { ok, brokenAt } (the seq of the first entry that does not follow). */
export function verifyAudit(state, allocationId) {
  let prev = '';
  for (const e of auditTrail(state, allocationId)) {
    const { hash, ...body } = e;
    if (body.prev !== prev || sha256(JSON.stringify(body)) !== hash) return { ok: false, brokenAt: e.seq };
    prev = hash;
  }
  return { ok: true, brokenAt: null };
}

const allocationById = (state, id) => (state?.allocations || []).find(a => a.id === id) || null;

/** Adds a sealed allocation to state.allocations and logs its creation. */
export function addAllocation(state, a, { by = a.createdBy, at = a.createdAt } = {}) {
  if (allocationById(state, a.id)) return { ok: false, error: 'An allocation with this id exists' };
  (state.allocations ||= []).push(a);
  log(state, { allocationId: a.id, action: 'seal', size: a.size, strata: a.strata, seedHash: a.seedHash, by, at });
  return { ok: true };
}

/**
 * Reveals the next allocation in a stratum for one participant and logs it.
 * Returns { ok: true, arm | code, position, stratum } — `arm` when the
 * allocation is open, `code` (a pack code) when blinded — or { ok: false, error }.
 * A participant is allocated once; a second call returns the first result
 * with `repeat: true` and is logged as a repeat request.
 */
export function allocateNext(state, allocationId, { participantId, stratum = '', by = '', at = null } = {}) {
  const a = allocationById(state, allocationId);
  if (!a) return { ok: false, error: 'No such allocation' };
  const pid = String(participantId ?? '').trim();
  if (!pid) return { ok: false, error: 'A participant id is required' };
  const when = at || new Date().toISOString();
  const shown = e => a.blinded ? { code: e.code } : { arm: e.arm };
  const prior = a.entries.find(e => e.participantId === pid);
  if (prior) {
    log(state, { allocationId, action: 'repeat', participantId: pid, stratum: prior.stratum, position: prior.position, by, at: when });
    return { ok: true, repeat: true, ...shown(prior), position: prior.position, stratum: prior.stratum };
  }
  if (state.project?.researchType === 'rct') {
    const issues = enrolmentIssues(state, pid, when);
    if (issues.length) return { ok: false, error: issues.join('; ') };
  }
  const st = String(stratum ?? '');
  if (!a.strata.includes(st)) return { ok: false, error: `No stratum '${st}' in this allocation` };
  const i = a.entries.findIndex(e => e.stratum === st && !e.participantId);
  if (i < 0) return { ok: false, error: `The list for ${st ? `stratum ${st}` : 'this allocation'} is used up` };
  const e = a.entries[i], arm = a.vault.arms[i];
  if (commit(a.vault.salts[i], e.stratum, e.position, arm) !== e.hash) return { ok: false, error: `Position ${e.position} does not match its seal; the allocation may have been edited` };
  Object.assign(e, { participantId: pid, by, at: when });
  if (a.blinded) e.code = `${a.id}-${st ? `${st}-` : ''}${String(e.position).padStart(3, '0')}`;
  else e.arm = arm;
  log(state, { allocationId, action: 'allocate', participantId: pid, stratum: st, position: e.position, ...(a.blinded ? { code: e.code } : { arm }), by, at: when });
  return { ok: true, ...shown(e), position: e.position, stratum: st };
}

/**
 * Reveals a participant's arm (emergency or planned unblinding); a reason is
 * required and logged with who and when. Returns { ok, arm } or { ok: false, error }.
 */
export function unblind(state, participantId, { reason = '', by = '', at = null, allocationId = null } = {}) {
  const pid = String(participantId ?? '').trim();
  const why = String(reason).trim();
  if (!why) return { ok: false, error: 'A reason for unblinding is required' };
  for (const a of state?.allocations || []) {
    if (allocationId && a.id !== allocationId) continue;
    const i = a.entries.findIndex(e => e.participantId === pid);
    if (i < 0) continue;
    const e = a.entries[i], arm = a.vault.arms[i];
    if (commit(a.vault.salts[i], e.stratum, e.position, arm) !== e.hash) return { ok: false, error: 'The allocation does not match its seal' };
    e.arm = arm; e.unblinded = true;
    log(state, { allocationId: a.id, action: 'unblind', participantId: pid, stratum: e.stratum, position: e.position, arm, reason: why, by, at: at || new Date().toISOString() });
    return { ok: true, arm, allocationId: a.id };
  }
  return { ok: false, error: 'The participant has no allocation' };
}

/** Counts by stratum: { [stratum]: { size, allocated, remaining } }, and revealed arms. */
export function allocationStatus(a) {
  const out = {};
  for (const e of a.entries) {
    const s = (out[e.stratum] ||= { size: 0, allocated: 0, remaining: 0 });
    s.size++; if (e.participantId) s.allocated++; else s.remaining++;
  }
  const arms = {};
  for (const e of a.entries) if (e.arm != null) arms[e.arm] = (arms[e.arm] || 0) + 1;
  return { strata: out, revealedArms: arms };
}
