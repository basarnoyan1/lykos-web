// A field from plain words (research tools review row 4, 2026-10-23): a column head's "New field from words…" takes a sentence ("follow-up
// in months"), asks the extraction model for one typed field (lib/prompts-views.mjs extractionFieldFromWords) and files it as the assistant's
// add_field change (lib/change-ops.mjs), a proposal the person accepts in Proposals. The model writes a definition, never a value; the typed
// schema stays the authority (plan §3 G1). Loaded on first use.
import { get } from '../store.mjs';
import { ask } from '../lib/dialog.mjs';
import { fields } from '../lib/fields.mjs';
import { modelFor } from '../lib/model-settings.mjs';
import { configured, complete } from '../lib/ai.mjs';
import { messagesOf, extractionFieldFromWords } from '../lib/prompts-views.mjs';
import { proposeChanges } from '../lib/changes.mjs';

const TYPES = new Set(['text', 'number', 'integer', 'category']);
/** The model's reply as an add_field change, or null when it is not one. Pure. */
export function fieldChange(reply) {
  let o = null;
  try { const t = String(reply || ''), a = t.indexOf('{'), b = t.lastIndexOf('}'); o = a >= 0 && b > a ? JSON.parse(t.slice(a, b + 1)) : null; } catch { return null; }
  const label = String(o?.label || '').replace(/\s+/g, ' ').trim().slice(0, 80);
  if (!label) return null;
  const type = TYPES.has(o.type) ? o.type : 'text';
  const options = type === 'category' && Array.isArray(o.options) ? o.options.map(x => String(x).trim()).filter(Boolean).slice(0, 30) : [];
  return { op: 'add_field', label, type: type === 'category' && options.length < 2 ? 'text' : type, ...(options.length >= 2 && type === 'category' ? { options } : {}),
    ...(String(o.unit || '').trim() ? { unit: String(o.unit).trim().slice(0, 40) } : {}), ...(String(o.definition || '').trim() ? { definition: String(o.definition).trim().slice(0, 400) } : {}) };
}

/** Asks for the description, then files the field as a proposal and opens Proposals. */
export async function fieldFromWords(ctx) {
  const cfg = modelFor('extract');
  if (!configured(cfg)) { ctx.rerender('Set up an extraction model to describe a field in words'); return; }
  const words = await ask('New field from words', { placeholder: 'Follow-up in months', confirm: 'Propose' });
  if (!words?.trim()) return;
  ctx.say?.('Asking the model for the field');
  try {
    const existing = fields(get()).map(f => f.label);
    const reply = await complete(cfg, messagesOf(extractionFieldFromWords, { words: words.trim().slice(0, 400), existing }), { temperature: 0, json: true, prompt: extractionFieldFromWords });
    const change = fieldChange(reply);
    if (!change) { ctx.rerender('The model gave no field for that description'); return; }
    const r = await proposeChanges({ summary: `New field: ${change.label}`, changes: [change] }, { view: 'extraction', model: cfg.model, prompt: words.trim(), source: 'extraction' });
    if (!r.ok) { ctx.rerender(r.problems?.[0] || r.error || 'The field was not proposed'); return; }
    ctx.rerender(`${change.label} proposed: accept it in Proposals`);
    ctx.openProposals?.();
  } catch (err) { ctx.rerender(String(err?.message || err).slice(0, 160)); }
}
