// Changes the assistant proposes. Reading is free; anything that edits the
// project or its folder is a proposal a person accepts (plan §6, G4). Each
// change is checked when it is proposed — the file exists, the text to replace
// occurs exactly once, the paper is in the library — so what is shown is what
// will happen, and checked again when accepted, so a file edited in between is
// refused rather than overwritten.
import { announceWrites } from './assistant-shell.mjs';
import { validateFlow } from './flow-runner.mjs';
import { graphFlow } from './flow-graph.mjs';
import { get, update } from '../store.mjs';
import { activeFolder } from './projects.mjs';
import { refuse, TEXT_EXT } from './workspace.mjs';
import { decide } from './screen.mjs';
import { file as fileProposal } from './aid.mjs';
import { CHANGE_OPS, OP_NAMES, opDoc } from './change-ops.mjs';
import { settingsOf } from './app-settings.mjs';
import * as store from '../store.mjs';
import { proposalSourceSnapshot } from './research-ledger.mjs';
import { registerProposalHandler, registerProposalDescriber } from './proposal-handlers.mjs';

export const OPS = OP_NAMES;
const DECISIONS = ['include', 'exclude', 'uncertain'];
const extOf = p => { const b = String(p).split('/').pop(); const i = b.lastIndexOf('.'); return i > 0 ? b.slice(i + 1).toLowerCase() : ''; };
const clip = (s, n) => { s = String(s ?? ''); return s.length > n ? `${s.slice(0, n)}…` : s; };

function paperOf(ref) {
  const r = String(ref || '').trim().toLowerCase(); if (!r) return null;
  const ps = get().papers || [];
  return ps.find(p => p.id === ref) || ps.find(p => (p.label || '').toLowerCase() === r) || ps.find(p => (p.doi || '').toLowerCase() === r) || null;
}
async function stamp(folder, rel) { const s = await folder.stat(rel); return s.exists ? { exists: true, dir: s.dir, key: `${s.size}:${s.mtime}` } : { exists: false }; }
const unchanged = async (folder, rel, was) => (await stamp(folder, rel)).key === was.key;

/** One change checked and turned into a proposal item, or a reason it cannot be proposed. */
async function item(c, ctx = {}) {
  // a model that writes a change as {"add_field": {...}} means {"op": "add_field", ...}; one with no op is told the shape
  if (c && typeof c === 'object' && !c.op) {
    const keys = Object.keys(c), named = keys.find(k => CHANGE_OPS[k] && c[k] && typeof c[k] === 'object');
    if (named) c = { ...c[named], op: named }; else return { error: 'each change is {"op": "<name>", ...its fields}' };
  }
  const folder = activeFolder();
  if (CHANGE_OPS[c?.op]) return CHANGE_OPS[c.op].run(c, ctx);
  switch (c?.op) {
    case 'import_files': {
      if (!folder) return { error: 'import_files needs a project folder' };
      const known = new Set((get().papers || []).map(p => p.pdfRel).filter(Boolean));
      const paths = [], skipped = [];
      for (const p of (Array.isArray(c.paths) ? c.paths : []).slice(0, 2000)) {
        let rel; try { rel = refuse(p); } catch { skipped.push(`${p}: outside the project`); continue; }
        if (extOf(rel) !== 'pdf') { skipped.push(`${rel}: not a PDF`); continue; }
        if (known.has(rel)) { skipped.push(`${rel}: already in the library`); continue; }
        if (!(await stamp(folder, rel)).exists) { skipped.push(`${rel}: not found`); continue; }
        paths.push(rel);
      }
      if (!paths.length) return { error: `nothing to import${skipped.length ? `: ${skipped.slice(0, 5).join('; ')}` : ''}` };
      return { skipped, it: {
        label: `Add ${paths.length} ${paths.length === 1 ? 'PDF' : 'PDFs'} to the library`,
        detail: paths.length <= 6 ? paths.join('\n') : `${paths.slice(0, 5).join('\n')}\n${paths.length - 5} more`,
        acceptLabel: 'Add',
        async accept() {
          const { addFolderPdfs } = await import('../views/library.mjs');
          let last = ''; await addFolderPdfs(paths, t => { last = t; });
          return last || `${paths.length} added`;
        } } };
    }
    case 'write_file': case 'edit_file': {
      if (!folder) return { error: `${c.op} needs a project folder` };
      let rel; try { rel = refuse(c.path); } catch (e) { return { error: e.message }; }
      if (!TEXT_EXT.has(extOf(rel))) return { error: `${rel}: only text and code files can be written this way` };
      const was = await stamp(folder, rel);
      if (was.dir) return { error: `${rel} is a folder` };
      if (c.op === 'write_file') {
        const content = String(c.content ?? '');
        if (content.length > 2_000_000) return { error: 'content is too large' };
        return { it: {
          label: `${was.exists ? 'Replace' : 'Create'} ${rel}`, detail: clip(content, 600), acceptLabel: was.exists ? 'Replace' : 'Create',
          async accept() {
            if (!(await unchanged(folder, rel, was))) return { refused: `${rel} changed since; ask again` };
            await folder.writeText(rel, content); return was.exists ? 'Replaced' : 'Created';
          } } };
      }
      if (!was.exists) return { error: `${rel} not found` };
      const find = String(c.find ?? ''), replace = String(c.replace ?? '');
      if (!find) return { error: 'edit_file needs the exact text to find' };
      const cur = new TextDecoder().decode(await folder.read(rel));
      const n = cur.split(find).length - 1;
      if (n !== 1) return { error: `${rel}: the text to find occurs ${n} times; quote more of it so it is unique` };
      return { it: {
        label: `Edit ${rel}`, detail: `− ${clip(find, 300)}\n+ ${clip(replace, 300)}`, acceptLabel: 'Apply',
        async accept() {
          if (!(await unchanged(folder, rel, was))) return { refused: `${rel} changed since; ask again` };
          const now = new TextDecoder().decode(await folder.read(rel));
          await folder.writeText(rel, now.replace(find, () => replace)); return 'Applied';
        } } };
    }
    case 'add_criterion': {
      const text = String(c.text || '').trim(); if (!text) return { error: 'add_criterion needs text' };
      const stage = c.stage === 'Full text' ? 'Full text' : 'Title/abstract';
      if ((get().protocol?.criteria || []).some(x => x.text.trim().toLowerCase() === text.toLowerCase())) return { error: 'that criterion exists' };
      const extra = {};
      if (['include', 'exclude', 'group'].includes(c.kind)) extra.kind = c.kind;
      for (const k of ['question', 'yes', 'no']) if (c[k]) extra[k] = clip(c[k], 400);
      return { it: { label: `Add criterion (${stage})`, detail: text, acceptLabel: 'Add',
        accept() {
          update(s => { s.protocol = s.protocol || {}; const cs = s.protocol.criteria || []; s.protocol.criteria = [...cs, { id: `C${cs.length + 1}`, text, stage, ...extra }];
            if ((s.protocolVersions || []).length) s.protocol.amendments = [...(s.protocol.amendments || []), { at: new Date().toISOString(), note: `Assistant proposal accepted: criterion C${cs.length + 1} added` }]; return s; });
          return 'Added';
        } } };
    }
    case 'screen': {
      const p = paperOf(c.paper); if (!p) return { error: `no record "${c.paper}" in the library` };
      if (!DECISIONS.includes(c.decision)) return { error: `decision must be one of ${DECISIONS.join(', ')}` };
      const reason = String(c.reason || '').trim();
      if (c.decision === 'exclude' && !reason) return { error: 'an exclusion needs a reason' };
      const stage = c.stage === 'ft' ? 'ft' : 'ta';
      const note = String(c.note || '').trim().slice(0, 2000);
      const by = settingsOf(get()).reviewerInitials || '';
      return { it: { label: `${p.label}: ${c.decision}`, detail: [reason, note && `Note: ${note}`].filter(Boolean).join('\n'), acceptLabel: 'Record', where: { paperId: p.id, label: p.label },
        accept: async () => {
          const now = (stage === 'ft' ? get().fulltext : get().screening)?.[p.id];
          if (now?.decision) return { refused: `${p.label} was decided since (${now.decision})` };
          try { await decide(stage, p.id, c.decision, { reason, by, via: 'assistant', note }); }
          catch (err) { return { refused: String(err.message || err) }; }
          return 'Recorded';
        } } };
    }
    case 'save_workflow': {
      const flow = graphFlow(structuredClone(c.flow || {}));
      try { validateFlow(flow); } catch (e) { return {error:e.message}; }
      flow.id ||= crypto.randomUUID(); flow.enabled = false;
      const identity = get().project, existing = get().workflows?.find(f => f.id === flow.id), before = JSON.stringify(existing);
      return {it:{label:`${existing?'Edit':'Create'} workflow: ${flow.name}`,detail:JSON.stringify({blocks:flow.blocks,connections:flow.edges,cron:flow.cron||'',schedule:'Disabled until you enable it'},null,2),acceptLabel:'Apply workflow',accept:()=>{
        if(get().project!==identity || JSON.stringify(get().workflows?.find(f=>f.id===flow.id))!==before)return {refused:'The project or workflow changed. Ask for an updated proposal.'};
        update(s=>{s.workflows=[...(s.workflows||[]).filter(f=>f.id!==flow.id),flow];return s;});return 'Workflow saved';
      }}};
    }
    // the older name of add_task: proposals saved with it read and apply as a suggested task
    case 'add_todo': return CHANGE_OPS.add_task.run({ ...c, op: 'add_task' }, ctx);
    default: return { error: `unknown change "${c?.op}"; use one of ${OPS.join(', ')}` };
  }
}

/**
 * Checks every change and files those that pass as one proposal. Returns what
 * the model is told: how many were filed and why any were not. Each accepted
 * item is logged (state.aiChanges: op, summary, the model and the prompt
 * version that proposed it, the record it concerns) so a change can be traced
 * to what proposed it; accepting or discarding is also counted (lib/ai-outcomes.mjs).
 */
// `write`: the chat's own changes to a page it can write in (the manuscript's paragraphs) are written there as tracked changes by the
// assistant (lib/tracked-edit.mjs) rather than filed; anything else, and anything another caller sends, waits in Proposals.
export async function proposeChanges({ summary, changes }, { view = 'overview', model = '', prompt = '', source = 'chat', write = false } = {}) {
  // the project replaced since (another opened, a reload from disk) is told by the store's generation: an op that rewrites `project`
  // (a target journal, a search's import) is an edit of this project, not another one, and must not void the items after it
  const generation = store.projectGeneration?.(), sourceSnapshot = proposalSourceSnapshot(get());
  const same = () => { if (generation !== store.projectGeneration?.()) throw new Error('The project was replaced. Request the changes again.'); };
  const list = Array.isArray(changes) ? changes.slice(0, 50) : [];
  if (!list.length) return { ok: false, error: 'changes must be a non-empty list' };
  const items = [], problems = [], written = [];
  for (const [i, c] of list.entries()) {
    const r = await item(c, { model, prompt, source }).catch(err => ({ error: String(err?.message || err) }));
    same();
    const w = !r.error && write && r.it.write ? r.it.write() : null;
    if (w) { written.push(w); logChange({ op: c.op, summary: `${w.label} (tracked)`, model, prompt }); continue; }
    if (r.error) problems.push(`#${i + 1} ${c?.op || '?'}: ${r.error}${opDoc(c?.op) ? ` (fields: ${opDoc(c.op)})` : ''}`);
    else {
      const { accept, write: _written, ...filed } = r.it;   // a filed item keeps no writer: it is applied by its accept
      const it = { ...filed, op: c.op === 'add_todo' ? 'add_task' : c.op, payload: { kind: 'change', change: structuredClone(c), model, prompt, ...(source !== 'chat' ? { source } : {}) }, accept: async () => {
        same();
        const out = await accept();
        same();
        if (!(out && typeof out === 'object' && out.refused)) logChange({ op: c.op, summary: r.it.label, model, prompt, paper: r.it.where?.paperId });
        return out;
      } };
      items.push(it);
      if (r.skipped?.length) problems.push(`#${i + 1} skipped ${r.skipped.length}: ${r.skipped.slice(0, 5).join('; ')}`);
    }
  }
  // what this call wrote itself (a tracked paragraph) is part of the state its filed items were made against
  if (items.length) fileProposal({ view, title: clip(summary || 'Proposed changes', 80), meta: model, items, prompt, sourceSnapshot: written.length ? proposalSourceSnapshot(get()) : sourceSnapshot });
  announceWrites(written);
  return { ok: items.length > 0 || written.length > 0, filed: items.length, written: written.map(({ label, block }) => ({ label, block })), problems };
}

// A stored change reads as the change and the project are now (lib/aid.mjs describeItem); add_todo reads as add_task.
const opOf = op => CHANGE_OPS[op === 'add_todo' ? 'add_task' : op];
// A live op checks the project as it is when accepted (a task, a field's name, a record's decision), so a change elsewhere since it was
// proposed does not void it: one accepted field once voided the eleven proposed beside it (a paper run, 2026-10-22).
const LIVE_LEGACY = new Set(['screen']);
const isLive = name => !!opOf(name)?.live || LIVE_LEGACY.has(name);
registerProposalDescriber('change', (payload, state) => {
  const name = payload.change?.op, d = opOf(name)?.describe?.(payload.change, state);
  return d ? { ...d, ...(isLive(name) ? { live: true } : {}) } : isLive(name) ? { live: true } : null;
});

registerProposalHandler('change', async (payload, { guard, guardBoundary }) => {
  // An op that checks the live state itself is held only to the project, not to everything else being as it was.
  const check = isLive(payload.change?.op) ? guardBoundary : guard;
  check();
  const r = await item(payload.change, { model: payload.model, prompt: payload.prompt, source: payload.source });
  check();
  if (r.error) return { refused: r.error };
  const out = await r.it.accept();
  guardBoundary();
  // Rechecking the boundary must precede any audit attribution to live state.
  if (!(out && typeof out === 'object' && out.refused)) {
    logChange({ op: payload.change.op, summary: r.it.label, model: payload.model, prompt: payload.prompt, paper: r.it.where?.paperId });
  }
  return out;
});

function logChange({ op, summary, model, prompt, paper }) {
  update(s => { s.aiChanges = [{ at: new Date().toISOString(), op, summary: clip(summary, 200), model: clip(model, 120), prompt: clip(prompt, 120), ...(paper ? { paper } : {}) }, ...(s.aiChanges || [])].slice(0, 1000); return s; });
}
