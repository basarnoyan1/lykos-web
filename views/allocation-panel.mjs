// Sealed allocation in Analysis › Tools (amendment of 2026-09-29): a drawn
// randomisation list sealed for enrolment, revealed one participant at a
// time, with unblinding and the hash-chained audit trail
// (lib/allocation.mjs). Arms are shown only as they are revealed: the vault
// is never read here except through allocateNext, unblind and verifySeal.
import { when } from '../lib/dates.mjs';
import { get, update } from '../store.mjs';
import { esc } from '../lib/html.mjs';
import { uiBar, inspectorActions } from '../lib/ui-actions.mjs';
import { formField, pagedTable } from '../lib/ui-components.mjs';
import { ask, formDialog } from '../lib/dialog.mjs';
import { pageOf, pager, wirePager } from '../lib/paging.mjs';
import { createSealedAllocation, addAllocation, publicAllocation, allocationStatus, allocateNext, unblind, auditTrail, verifyAudit, verifySeal } from '../lib/allocation.mjs';
import { who } from './dataset-manage.mjs';

const ACTION = { seal: 'Sealed', allocate: 'Allocated', repeat: 'Repeat request', unblind: 'Unblinded' };
const last = {};   // the result of the last reveal, by allocation, shown once

// A fresh seed nobody has seen: the list drawn on screen shows the design, and
// sealing it would leave its sequence visible to whoever drew it.
const freshSeed = () => (globalThis.crypto.getRandomValues(new Uint32Array(1))[0] % 2147483646) + 1;

/**
 * Seals a list with these settings (arms, blocks, strata, size) drawn again
 * from a new random seed, and keeps it in the project. Resolves to { ok, error?, id? }.
 */
export async function sealForEnrolment(settings) {
  const values = await formDialog({ id: 'seal-enrolment', title: 'Seal for enrolment', tier: 'S', confirm: 'Seal',
    body: '<label class="ui-check"><input type="checkbox" name="blinded"><span>Blinded: reveal a pack code</span></label>' });
  if (values == null) return { ok: false };
  const blinded = values.blinded;
  let r;
  try {
    const a = createSealedAllocation({ ...settings, seed: freshSeed() }, { by: who(), blinded });
    update(s => { r = addAllocation(s, a); if (r.ok) r.id = a.id; return s; });
  } catch (err) { r = { ok: false, error: String(err.message || err) }; }
  return r;
}

const AUDIT_PAGE = 20;
const auditPages = {}, auditOpen = new Set();
function auditHtml(s, a) {
  const trail = auditTrail(s, a.id).slice().reverse();
  const v = pageOf(trail, auditPages[a.id] || 1, AUDIT_PAGE); auditPages[a.id] = v.page;
  return pagedTable({ label: 'Audit trail', html: `<table><thead><tr><th>#</th><th>Action</th><th>Participant</th><th>Stratum</th><th>Position</th><th>Revealed</th><th>Reason</th><th>By</th><th>When</th></tr></thead><tbody>${v.items.map(e =>
    `<tr><td class="num">${e.seq}</td><td>${esc(ACTION[e.action] || e.action)}</td><td>${esc(e.participantId || '')}</td><td>${esc(e.stratum || '')}</td><td class="num">${e.position ?? ''}</td>
      <td>${esc(e.action === 'seal' ? `${e.size} positions` : e.arm || e.code || '')}</td><td>${esc(e.reason || '')}</td><td>${esc(e.by || '')}</td><td>${esc(when(e.at))}</td></tr>`).join('')}</tbody></table>`,
    pager: pager({ id: `al-audit-${a.id}`, page: v.page, pages: v.pages, total: trail.length, label: 'entries', size: AUDIT_PAGE }) });
}

const participantField = formField('Participant', '<input data-al="pid" aria-label="Participant id">');
const stratumField = strata => formField('Stratum', `<select data-al="stratum" aria-label="Stratum">${strata.map(([k]) => `<option value="${esc(k)}">${esc(k)}</option>`).join('')}</select>`);

/** One sealed allocation: its head, its strata, the form that allocates the next participant, and the checks. */
function allocationSection(s, a) {
  const full = s.allocations.find(x => x.id === a.id), st = allocationStatus(a), seal = verifySeal(full), audit = verifyAudit(s, a.id);
  const strata = Object.entries(st.strata);
  const res = last[a.id];
  const facts = [a.arms.join(', '), `${a.size} positions`, a.blinded ? 'blinded' : '', `sealed ${when(a.createdAt)}${a.createdBy ? ` by ${a.createdBy}` : ''}`].filter(Boolean).join(' · ');
  return `<section class="al-one" data-alloc="${esc(a.id)}">
        ${uiBar({ kind: 'head', label: `Allocation ${a.id}`, id: `al-head-${a.id}`, lead: { title: a.id, level: 'h3' }, message: { text: facts } })}
        <table class="al-strata"><thead><tr><th>Stratum</th><th>Size</th><th>Allocated</th><th>Remaining</th></tr></thead><tbody>${strata.map(([k, v]) =>
          `<tr><td>${esc(k || 'All')}</td><td class="num">${v.size}</td><td class="num">${v.allocated}</td><td class="num">${v.remaining}</td></tr>`).join('')}</tbody></table>
        <div class="an-settings al-form">
          ${participantField}${strata.length > 1 || strata[0][0] ? stratumField(strata) : ''}
        </div>
        ${inspectorActions({ label: `Allocate in ${a.id}`, id: `al-foot-${a.id}`, start: [{ id: `al-result-${a.id}`, message: res || '' }],
          actions: [...(a.blinded ? [{ id: `al-unblind-${a.id}`, label: 'Unblind…', attrs: { 'data-al-unblind': '' } }] : []), { id: `al-next-${a.id}`, label: 'Allocate next', icon: 'run', role: 'primary', attrs: { 'data-al-next': '' } }] })}
        <div class="al-verify meta">${seal.ok ? 'Seal intact' : `Seal broken: ${esc(seal.problems.slice(0, 3).join('; '))}`} · ${audit.ok ? 'Audit trail intact' : `Audit trail broken at entry ${audit.brokenAt}`}</div>
        <details class="al-audit"${auditOpen.has(a.id) ? ' open' : ''}><summary>Audit trail</summary>${auditHtml(s, a)}</details>
      </section>`;
}

/** The Allocation panel's markup: every sealed allocation, its status per stratum, reveal and unblind, and the audit trail. */
export function allocationPanel(s = get()) {
  const list = (s.allocations || []).map(publicAllocation);
  if (!list.length) return '';
  return `<div class="panel" id="al-panel"><div class="panel-head"><h2>Allocation</h2><span class="meta">${list.length} sealed</span></div>
    <div class="panel-body al-body">${list.map(a => allocationSection(s, a)).join('')}</div></div>`;
}

/** Wires the panel drawn by allocationPanel; `rerender` redraws the view. */
export function wireAllocationPanel(el, rerender) {
  el.querySelectorAll('[data-alloc]').forEach(sec => {
    const id = sec.dataset.alloc;
    const pidOf = () => sec.querySelector('[data-al="pid"]').value.trim();
    sec.querySelector('[data-al-next]').onclick = () => {
      const pid = pidOf(), stratum = sec.querySelector('[data-al="stratum"]')?.value ?? '';
      let r;
      update(s => { r = allocateNext(s, id, { participantId: pid, stratum, by: who() }); return s; });
      last[id] = r.ok ? `${pid}: ${r.code ? `pack ${r.code}` : r.arm} (position ${r.position}${r.stratum ? `, ${r.stratum}` : ''})${r.repeat ? ', already allocated' : ''}` : r.error;
      rerender();
    };
    sec.querySelector('[data-al-unblind]')?.addEventListener('click', async () => {
      const pid = pidOf() || (await ask('Participant to unblind', { confirm: 'Next' }))?.trim();
      if (!pid) return;
      const reason = await ask(`Reason for unblinding ${pid}`, { confirm: 'Unblind' });
      if (reason == null) return;
      let r;
      update(s => { r = unblind(s, pid, { reason, by: who(), allocationId: id }); return s; });
      last[id] = r.ok ? `${pid}: ${r.arm} (unblinded)` : r.error;
      rerender();
    });
    const det = sec.querySelector('details.al-audit'); det.ontoggle = () => { det.open ? auditOpen.add(id) : auditOpen.delete(id); };
    const wireAudit = () => wirePager(sec, `al-audit-${id}`, p => {
      auditPages[id] = p;
      const summary = det.querySelector('summary');
      det.innerHTML = auditHtml(get(), publicAllocation(get().allocations.find(a=>a.id===id)));
      det.prepend(summary); wireAudit();
    }); wireAudit();
  });
}
