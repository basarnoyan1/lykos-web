// Settings > Teams: the model teams of the open project (lib/model-teams.mjs), listed, and the one being made or changed edited in place.
// A team is a coordinator and two to four members, each on a connection of Settings > Models. It replaces the team dialogs: a form with
// sections is a page (DIALOGS plan #25, #26). The draft lives here, in the module, so a repaint of Settings never loses it.
import { get, update } from '../store.mjs';
import { settingsOf } from '../lib/app-settings.mjs';
import { configured, listModelsDetailed } from '../lib/ai.mjs';
import { chatGptCatalog } from '../lib/chatgpt.mjs';
import { chooseModel } from '../lib/model-picker.mjs';
import { isJev } from '../lib/jev.mjs';
import { confirmAsk } from '../lib/dialog.mjs';
import { modelTeams, validateTeam } from '../lib/model-teams.mjs';
import { uiBar, uiList, uiRow, uiRowEnd } from '../lib/ui-actions.mjs';
import { formField, disclosure } from '../lib/ui-components.mjs';
import { plural } from '../lib/dates.mjs';
import { showMenu } from '../lib/menu.mjs';
import { esc } from '../lib/html.mjs';
import { icon } from '../lib/icons.mjs';

const uid = () => crypto.randomUUID();
const MAX_MEMBERS = 4;
let draft = null;   // { value, original, identity, error }

const profilesOf = () => settingsOf(get()).models.profiles.filter(p => !isJev(p));
const nameOf = p => p?.label || p?.model || 'Choose connection';

/** Starts editing a team of the open project, or a new one ('new'). */
export function showTeam(id) {
  const profiles = profilesOf(), first = profiles.filter(configured)[0]?.id || '';
  const original = id && id !== 'new' ? modelTeams().find(t => t.id === id) : null;
  draft = { original, identity: get().project, error: '', value: original ? structuredClone(original)
    : { id: uid(), name: 'Research team', leadProfileId: first, parallel: 2, peerReview: true,
      members: [{ id: uid(), role: 'Evidence researcher', profileId: first, instructions: '' }, { id: uid(), role: 'Critical reviewer', profileId: first, instructions: '' }] } };
}
export const teamOpen = () => !!draft;

const connectionOptions = (profiles, current) => profiles.map(p => `<option value="${esc(p.id)}"${p.id === current ? ' selected' : ''}${configured(p) ? '' : ' disabled'}>${esc(nameOf(p))}</option>`).join('');
const modelName = (profiles, profileId, model) => {
  const cfg = profiles.find(p => p.id === profileId), name = model || cfg?.model;
  return chatGptCatalog(profileId).find(m => m.id === name)?.label || name || 'Choose model';
};
const modelButton = (id, profiles, profileId, model, aria) => `<button type="button" class="field-pick" id="${esc(id)}" aria-label="${esc(aria)}" aria-haspopup="dialog"${profileId ? '' : ' disabled'}><span>${esc(modelName(profiles, profileId, model))}</span>${icon('chevron-down', { size: 12 })}</button>`;

function editor() {
  const { value, original, error } = draft, profiles = profilesOf();
  const head = uiBar({ kind: 'head', label: original ? 'Edit model team' : 'New model team', id: 'team-head', lead: { title: original ? 'Edit team' : 'New team', level: 'h3' },
    actions: [{ id: 'team-cancel', label: 'Cancel' }, { id: 'team-save', label: 'Save team', role: 'primary' }],
    overflow: original ? [{ id: 'team-delete', label: 'Delete team', danger: true }] : [] });
  const members = value.members.map((m, i) => `<div class="team-member" data-member="${esc(m.id)}">
    ${uiBar({ kind: 'head', label: `Member ${i + 1}`, id: `team-m-${m.id}`, lead: { title: `Member ${i + 1}`, level: 'h3' }, overflow: [{ id: `team-remove-${m.id}`, label: 'Remove member', danger: true, disabled: value.members.length <= 2 }] })}
    <div class="an-settings">${formField('Role', `<input data-member-role="${esc(m.id)}" value="${esc(m.role)}" maxlength="80" aria-label="Member ${i + 1} role">`, { span: 2 })}
    ${formField('Connection', `<select id="team-conn-${esc(m.id)}" data-connection="${esc(m.id)}" aria-label="Member ${i + 1} connection">${connectionOptions(profiles, m.profileId)}</select>`)}
    ${formField('Model', modelButton(`team-model-${m.id}`, profiles, m.profileId, m.model, `Member ${i + 1} model`))}</div>
    ${disclosure({ id: `team-i-${m.id}`, title: 'Role instructions', body: `<textarea data-instructions="${esc(m.id)}" rows="3" maxlength="2000" aria-label="Member ${i + 1} instructions">${esc(m.instructions || '')}</textarea>` })}
  </div>`).join('');
  return `<section class="team-edit" aria-label="Team editor">${head}
    <div class="an-settings">${formField('Name', `<input id="team-name" value="${esc(value.name)}" maxlength="80">`, { span: 2 })}
    ${formField('Coordinator connection', `<select id="team-lead" aria-label="Coordinator connection">${connectionOptions(profiles, value.leadProfileId)}</select>`)}
    ${formField('Coordinator model', modelButton('team-lead-model', profiles, value.leadProfileId, value.leadModel, 'Coordinator model'))}</div>
    ${members}
    ${uiBar({ kind: 'tools', label: 'Team options', id: 'team-tools',
      filters: [{ type: 'select', id: 'team-parallel', label: 'Members working at once', value: String(value.parallel || 2), options: [1, 2, 3, 4].map(n => [String(n), `${n} at once`]) },
        { type: 'check', id: 'team-review', label: 'Review each other’s findings', value: !!value.peerReview }],
      actions: [{ id: 'team-add', label: 'Add member', icon: 'plus', disabled: value.members.length >= MAX_MEMBERS }] })}
    ${error ? `<p class="note" id="team-error" role="alert">${esc(error)}</p>` : ''}
  </section>`;
}

/** The section's body. `srow` is Settings' row builder. */
export function teamsBody(srow) {
  const teams = modelTeams(), profiles = profilesOf();
  const rows = teams.map(t => uiRow({ attrs: { 'data-team': t.id },
    main: { html: `<button type="button" class="tk-text" data-team-open="${esc(t.id)}">${esc(t.name)}</button>`, detail: [plural(t.members.length, 'member'), nameOf(profiles.find(p => p.id === t.leadProfileId))] },
    end: uiRowEnd({ more: { label: `More for ${t.name}`, attrs: { 'data-team-more': t.id } } }) }));
  return `${srow('Model teams', { desc: teams.length ? plural(teams.length, 'team') : 'None yet', find: 'model team coordinator members',
    actions: [{ id: 'team-new', label: 'New team', icon: 'plus', disabled: !profiles.some(configured) }] })}
    ${rows.length ? uiList({ id: 'team-list', label: 'Model teams', rows }) : ''}
    ${draft ? editor() : ''}`;
}

/** Binds the section. `rerender` repaints Settings; `focus` names the control to give the keyboard back after a repaint. */
export function wireTeams(el, { rerender, goBack = null }) {
  const redraw = focusId => { rerender(); if (focusId) document.getElementById(focusId)?.focus(); };
  el.querySelector('#team-new')?.addEventListener('click', () => { showTeam('new'); redraw('team-name'); });
  el.querySelectorAll('[data-team-open]').forEach(b => b.onclick = () => { showTeam(b.dataset.teamOpen); redraw('team-name'); });
  el.querySelectorAll('[data-team-more]').forEach(b => b.onclick = () => showMenu(b, [
    { label: 'Edit', icon: 'note', run: () => { showTeam(b.dataset.teamMore); redraw('team-name'); } },
    '-', { label: 'Delete team', icon: 'trash', danger: true, run: () => removeTeam(b.dataset.teamMore, redraw) }], { align: 'end' }));
  if (!draft) return;
  const { value } = draft, profiles = profilesOf(), member = id => value.members.find(m => m.id === id);
  const pickModel = async (button, profileId, current, set) => {
    const cfg = profiles.find(p => p.id === profileId); if (!cfg || button.getAttribute('aria-expanded') === 'true') return;
    const catalog = cfg.provider === 'chatgpt' ? chatGptCatalog(profileId) : [], models = catalog.length ? catalog.map(m => m.id) : cfg.models || [];
    button.setAttribute('aria-expanded', 'true');
    try {
      const model = await chooseModel({ models, current: current || cfg.model, labels: Object.fromEntries(catalog.map(m => [m.id, m.label])), allowCustom: cfg.provider !== 'chatgpt',
        load: !models.length ? () => listModelsDetailed(cfg, { force: false }) : null });
      if (model) { set(model); redraw(button.id); }
    } finally { if (button.isConnected) button.setAttribute('aria-expanded', 'false'); }
  };
  el.querySelector('#team-name').oninput = e => { value.name = e.target.value; };
  el.querySelector('#team-lead').onchange = e => { value.leadProfileId = e.target.value; delete value.leadModel; delete value.leadEffort; redraw('team-lead'); };
  const lead = el.querySelector('#team-lead-model'); lead.onclick = () => pickModel(lead, value.leadProfileId, value.leadModel, model => { value.leadModel = model; delete value.leadEffort; });
  el.querySelectorAll('[data-member-role]').forEach(i => i.oninput = () => { member(i.dataset.memberRole).role = i.value; });
  el.querySelectorAll('[data-instructions]').forEach(i => i.oninput = () => { member(i.dataset.instructions).instructions = i.value; });
  el.querySelectorAll('[data-connection]').forEach(s => s.onchange = () => { const m = member(s.dataset.connection); m.profileId = s.value; delete m.model; delete m.effort; redraw(s.id || ''); });
  for (const m of value.members) {
    const b = el.querySelector(`#team-model-${m.id}`); if (b) b.onclick = () => pickModel(b, m.profileId, m.model, model => { m.model = model; delete m.effort; });
    el.querySelector(`#team-remove-${m.id}`)?.addEventListener('click', () => { value.members = value.members.filter(x => x.id !== m.id); redraw('team-add'); });
  }
  el.querySelector('#team-parallel').onchange = e => { value.parallel = Number(e.target.value); };
  el.querySelector('#team-review').onchange = e => { value.peerReview = e.target.checked; };
  el.querySelector('#team-add').onclick = () => {
    if (value.members.length < MAX_MEMBERS) value.members.push({ id: uid(), role: 'Specialist', profileId: profiles.filter(configured)[0]?.id || '', instructions: '' });
    redraw('team-add');
  };
  el.querySelector('#team-cancel').onclick = () => { draft = null; redraw(); };
  el.querySelector('#team-delete')?.addEventListener('click', () => removeTeam(value.id, redraw));
  el.querySelector('#team-save').onclick = () => {
    try {
      if (get().project !== draft.identity) throw new Error('Project changed. Reopen the team in this project.');
      value.name = value.name.trim();
      validateTeam(value, profiles, false);
      update(s => { const teams = s.modelTeams ||= []; const at = teams.findIndex(t => t.id === value.id); if (at >= 0) teams[at] = value; else teams.push(value); return s; });
      draft = null; redraw();
    } catch (err) { draft.error = err.message; redraw(); }
  };
}

async function removeTeam(id, redraw) {
  const identity = get().project;
  if (!await confirmAsk('Delete this team?', { detail: 'Existing chats and workflows will need another team. Saved replies and workflow results remain.', confirm: 'Delete', danger: true })) return;
  if (get().project !== identity) return;
  update(s => { s.modelTeams = (s.modelTeams || []).filter(t => t.id !== id); return s; });
  if (draft?.value.id === id) draft = null;
  redraw();
}
