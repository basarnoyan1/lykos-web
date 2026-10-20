// Outputs proposed by the assistant or an MCP client, and accepted by a person
// (plan §6: every model edit is a proposal). A proposal carries the validated
// spec and a preview drawn from the project as it is; accepting saves it as a
// new version of the output. An MCP client without the app writes its specs to
// SIDECAR, which the Tables and figures view offers for import; the project
// file itself is only ever written by the app.
import { get, update } from '../store.mjs';
import { file as fileProposal } from './aid.mjs';
import { validateSpec, saveOutput, outputById, currentSpec, specKey, describeSpecDiff, diffSpecs, sourceLine } from './output-spec.mjs';
import { renderOutput, previewHtml } from './output-render.mjs';

export const SIDECAR = '.lykos/mcp-outputs.json';

/**
 * Validates a spec and files it as a proposal. Returns what the model is told:
 * `{ ok, errors }` or `{ ok, id, rows, summary }`.
 */
export function proposeOutput(input, { model = '', message = '', view = 'outputs', author = 'Assistant' } = {}) {
  const s = get(), v = validateSpec(input, s);
  if (!v.ok) return { ok: false, errors: v.errors };
  const spec = v.spec, existing = outputById(s, spec.id), before = currentSpec(existing), baseN = existing?.versions.at(-1)?.n || 0;
  if (before && specKey(before) === specKey(spec)) return { ok: false, errors: [`Output ${spec.id} already has exactly this spec (v${baseN}).`] };
  let m;
  try { m = renderOutput(s, spec); } catch (e) { return { ok: false, errors: [e.message] }; }
  const summary = before ? describeSpecDiff(diffSpecs(before, spec)) : `New ${spec.kind === 'chart' ? `${spec.chart.type} chart` : 'table'} · ${sourceLine(spec, s)}`;
  fileProposal({ view, title: `${before ? 'Update' : 'New'} ${spec.kind === 'chart' ? 'figure' : 'table'}: ${spec.title}`.slice(0, 80), meta: model, items: [{
    label: spec.title, detail: [summary, `${m.result.total} rows${m.grouped ? ` in ${m.groups.length} groups` : ''}`, message].filter(Boolean).join(' · '),
    preview: previewHtml(m), acceptLabel: 'Save',
    accept() {
      const now = outputById(get(), spec.id);
      if ((now?.versions.at(-1)?.n || 0) !== baseN) return { refused: 'The output changed since. Ask for an updated proposal.' };
      const check = validateSpec(spec, get());
      if (!check.ok) return { refused: check.errors[0] };
      let n = 0;
      update(st => { n = saveOutput(st, check.spec, { author, message }).version?.n || 0; return st; });
      return n ? `Saved as v${n}` : 'Unchanged';
    } }] });
  return { ok: true, id: spec.id, spec, rows: m.result.total, groups: m.groups.length, summary, notes: m.notes };
}

// ---- specs written by an MCP client without the app ------------------------------------
async function readSidecar(folder) {
  try { const st = await folder.stat(SIDECAR); if (!st.exists) return { outputs: [] }; const j = JSON.parse(new TextDecoder().decode(await folder.read(SIDECAR))); return { outputs: Array.isArray(j?.outputs) ? j.outputs : [] }; }
  catch { return { outputs: [] }; }
}
/** Specs defined through MCP that the project does not hold yet: `[{ id, spec, at, author, message }]`. */
export async function pendingMcpOutputs(folder, s = get()) {
  if (!folder) return [];
  const { outputs } = await readSidecar(folder);
  return outputs.map(o => ({ id: o.id, ...(o.versions?.at(-1) || {}) })).filter(o => o.spec && specKey(currentSpec(outputById(s, o.id))) !== specKey(o.spec));
}
/** Takes an MCP-defined spec into the project as a new version, or drops it; either way it leaves the sidecar. */
export async function settleMcpOutput(folder, id, { accept }) {
  const { outputs } = await readSidecar(folder);
  const entry = outputs.find(o => o.id === id);
  if (!entry) throw new Error('That definition is no longer waiting.');
  if (accept) {
    const last = entry.versions.at(-1), check = validateSpec(last.spec, get());
    if (!check.ok) throw new Error(check.errors[0]);
    update(st => { saveOutput(st, check.spec, { author: last.author || 'MCP', message: last.message || '' }); return st; });
  }
  await folder.writeText(SIDECAR, JSON.stringify({ outputs: outputs.filter(o => o.id !== id) }, null, 2));
}
