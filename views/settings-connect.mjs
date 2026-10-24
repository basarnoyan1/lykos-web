// Settings, Models: the connect wizard. Three short dialogs on the shared recipe (lib/dialog.mjs formDialog), each one decision:
//   connect-where    where the model runs (descriptive choice tiles); a server on this Mac is looked for when Next is pressed, never before
//   connect-details  the provider or server, the key or address; the primary is Test connection, and a failure stays in the dialog
//   connect-model    the models the connection listed; the primary tests the chosen one and connects
// The answer of a test is one sentence and the step to take (lib/provider-error.mjs); what the provider said is behind a disclosure.
// A key is typed into a password field and goes only to the profile (the app-wide credentials store, §6.2a); it is never written
// into the page, a message or a log, and the dialog is removed when it closes.
import { formDialog } from '../lib/dialog.mjs';
import { formField, disclosure } from '../lib/ui-components.mjs';
import { esc } from '../lib/html.mjs';
import { inDesktop, inHostedTab } from '../lib/native.mjs';
import { PROVIDERS } from '../lib/ai.mjs';
import { testConnection, probeLocal } from '../lib/ai-connection.mjs';
import { WHERE, presetsFor, presetById, presetLabel, presetForBase, profileFromPreset, markTested, preselect } from '../lib/connect-steps.mjs';

const newId = () => `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/** The area a test writes into: one sentence and the step, the provider's own words behind a disclosure. It is always there, so nothing moves. */
const resultArea = '<div class="connect-result" data-connect-result role="status" aria-live="polite"></div>';
function paint(d, result) {
  const area = d.querySelector('[data-connect-result]'); if (!area?.isConnected) return;
  area.innerHTML = result ? `<p>${esc(result.text)}</p>${result.full ? disclosure({ title: 'What the provider said', body: `<p class="meta">${esc(result.full)}</p>` }) : ''}` : '';
}
/** Runs `work` while the dialog's primary is disabled; the answer is painted only if the dialog is still open. */
async function busy(d, work) {
  const go = d.querySelector('[type=submit]'); if (go) go.disabled = true;
  paint(d, { text: 'Testing…' });
  try { return await work(); } finally { if (go?.isConnected) go.disabled = false; }
}

function stepWhere(state) {
  const tile = (w, i) => {
    const off = w.id === 'chatgpt' && !inDesktop();
    return `<label class="setup-type${i === 0 ? ' selected' : ''}"><input type="radio" name="where" value="${w.id}"${state.where === w.id || (!state.where && i === 0) ? ' checked' : ''}${off ? ' disabled' : ''}>
      <span class="setup-type-copy"><strong>${esc(w.title)}</strong><span>${esc(off ? 'Needs the desktop app.' : w.help)}</span></span><span class="setup-type-mark" aria-hidden="true"></span></label>`;
  };
  return formDialog({ id: 'connect-where', title: 'Connect a model', detail: 'Where should the model run?', tier: 'M', confirm: 'Next',
    body: `<fieldset class="connect-tiles" aria-label="Where the model runs">${WHERE.filter(w => !inHostedTab() || w.id === 'key').map(tile).join('')}</fieldset>`,
    onMount: d => {
      const mark = () => d.querySelectorAll('.setup-type').forEach(l => l.classList.toggle('selected', l.querySelector('input').checked));
      d.addEventListener('change', mark); mark();
    },
    submit: async (form, d) => {
      const where = new FormData(form).get('where') || 'key';
      if (where === 'mac') {   // the one look at this machine, and only now that the button was pressed
        state.found = await busy(d, () => probeLocal());
        paint(d, null);
      }
      return where;
    } });
}

function serverOptions(state) {
  const found = new Map((state.found || []).map(s => [s.base, s]));
  return presetsFor('mac').map(p => {
    const hit = found.get(p.base);
    return `<option value="${p.id}">${esc(`${p.label}${hit ? (hit.up ? ', running' : ', not found') : ''}`)}</option>`;
  }).join('');
}

function stepDetails(state) {
  const mac = state.where === 'mac';
  const first = mac ? (presetsFor('mac').find(p => (state.found || []).find(s => s.base === p.base)?.up) || presetById('ollama')) : presetById(state.presetId) || presetsFor('key')[0];
  const options = mac ? serverOptions(state) : presetsFor('key').map(p => `<option value="${p.id}">${esc(presetLabel(p))}</option>`).join('');
  const body = `${formField(mac ? 'Server' : 'Provider', `<select name="preset">${options}</select>`)}
    ${mac ? '' : formField('API key', '<input name="key" type="password" autocomplete="off" spellcheck="false" placeholder="Paste key">')}
    ${formField('Endpoint', `<input name="base" type="text" inputmode="url" autocomplete="off" spellcheck="false" placeholder="https://…" value="${esc(first.base)}">`)}
    ${mac ? '' : formField('Workspace ID', '<input name="workspaceId" type="text" autocomplete="off" spellcheck="false" placeholder="Optional">')}
    ${resultArea}`;
  return formDialog({ id: 'connect-details', title: mac ? 'Connect a server on this Mac' : 'Connect with an API key', tier: 'M', confirm: 'Test connection',
    start: { id: 'back', label: 'Back' }, body,
    onMount: d => {
      const form = d.querySelector('form'), pick = form.elements.preset;
      pick.value = first.id;
      const fields = () => {
        const preset = presetById(pick.value), isClaude = preset?.provider === 'anthropic';
        form.elements.base.closest('label').hidden = isClaude;
        const ws = form.elements.workspaceId?.closest('label'); if (ws) ws.hidden = !isClaude;
      };
      fields();
      pick.addEventListener('change', () => { form.elements.base.value = presetById(pick.value)?.base ?? ''; fields(); paint(d, null); });
      d.addEventListener('input', () => paint(d, null));
    },
    submit: async (form, d) => {
      const v = Object.fromEntries(new FormData(form)), preset = presetById(v.preset);
      state.presetId = preset.id;
      const cfg = profileFromPreset(preset, { id: 'wizard', key: v.key || '', base: preset.provider === 'anthropic' ? preset.base : v.base, workspaceId: v.workspaceId || '' });
      const result = await busy(d, () => testConnection(cfg, { chooseModel: true }));
      if (!d.isConnected) return undefined;
      if (result.partial) { paint(d, null); return { cfg, models: result.models, preset }; }
      paint(d, result);   // a failure stays here, with the field to correct beside it
      return undefined;
    } });
}

function stepModel(state) {
  const { cfg, models } = state, wanted = preselect(cfg, models);
  const options = `${wanted ? '' : '<option value="">Choose a model</option>'}${models.map(m => `<option value="${esc(m)}"${m === wanted ? ' selected' : ''}>${esc(m)}</option>`).join('')}`;
  return formDialog({ id: 'connect-model', title: 'Choose a model', detail: cfg.label, tier: 'M', confirm: 'Test and connect', start: { id: 'back', label: 'Back' },
    body: `${formField('Model', `<select name="model">${options}</select>`)}${resultArea}`,
    onMount: d => d.addEventListener('change', () => paint(d, null)),
    submit: async (form, d) => {
      const model = new FormData(form).get('model');
      if (!model) { paint(d, { text: 'No model is chosen. Choose one from the list.' }); return undefined; }
      const next = { ...cfg, model };
      const result = await busy(d, () => testConnection(next));
      if (!d.isConnected) return undefined;
      if (!result.ok) { paint(d, result); return undefined; }
      markTested(next);
      return { cfg: next };
    } });
}

/**
 * The wizard. Resolves { profile, models, signIn } for a connection to add (signIn: the ChatGPT account still has to sign in), or null
 * when the person leaves. `known` is the number of profiles already held, only to number a label that would repeat.
 */
export async function connectWizard() {
  const state = { where: '', presetId: '', found: null };
  let step = 'where', models = [], cfg = null, preset = null;
  for (;;) {
    if (step === 'where') {
      const where = await stepWhere(state);
      if (!where) return null;
      state.where = where;
      if (where === 'chatgpt') return { profile: { id: newId(), label: 'ChatGPT', provider: 'chatgpt', base: PROVIDERS.chatgpt.base, key: '', model: '' }, models: [], signIn: true };
      step = 'details';
    } else if (step === 'details') {
      const out = await stepDetails(state);
      if (!out) return null;
      if (out.act === 'back') { step = 'where'; continue; }
      ({ cfg, models, preset } = out); state.cfg = cfg; state.models = models; step = 'model';
    } else {
      const out = await stepModel(state);
      if (!out) return null;
      if (out.act === 'back') { step = 'details'; continue; }
      const chosen = out.cfg;
      const profile = { ...profileFromPreset(preset || presetForBase(chosen.base) || { label: chosen.label, provider: chosen.provider, base: chosen.base }, { id: newId(), key: chosen.key, base: chosen.base, model: chosen.model, workspaceId: chosen.workspaceId || '' }), models };
      return { profile, models, signIn: false };
    }
  }
}
