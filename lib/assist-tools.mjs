// The inspector's chat controls and its empty states, declared (nothing here places a control: ui-actions.css does).
//
//   assistToolsSpec       the one dense tools row under the tabs: chat history, model, New chat and More. The width engine
//                         compacts New chat, then the model (its icon alone: the status bar names it), then the history
//                         picker (its name clipped) before anything is cut, then folds New chat into More. The chat's name
//                         is what a reader looks for here, so it is the last to give way.
//   assistSuggestions     the questions a view is usually asked, as quiet rows (no border, a chevron)
//   assistModelNotice     the one call to action of a chat with no model
import { uiList, uiRow, uiNotice } from './ui-actions.mjs';
import { esc } from './html.mjs';
import { icon } from './icons.mjs';

/** The characters the history picker and the model picker hold to (a share of the row, not whatever the name needs). */
export const SESSION_CH = 18, MODEL_CH = 18;
/** Expanded, the chat is the whole page and its name is the title: the picker drops its cap and holds the widest share the contract allows (24ch). */
export const EXPANDED_SESSION_CH = 24;

/**
 * A name cut at a word, not inside one: the longest whole words that fit `max` characters, then an ellipsis. One long word is cut where it stands.
 * The whole name stays in the picker's tooltip and accessible name.
 */
export function fitWords(text, max = SESSION_CH) {
  const t = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max - 1), at = cut.lastIndexOf(' '), whole = t[max - 1] === ' ';   // the cut falls between two words: nothing to take back
  return `${(whole || at < Math.floor(max / 2) ? cut : cut.slice(0, at)).replace(/[\s,;:.\-–]+$/, '')}…`;
}

/** The More entries of the chat row, in order. The view binds each by id (a click on the entry clicks the real button). The chat's
 *  budget is not here: it is a popover from the model picker's menu, beside the model it limits (lib/chat-budget.mjs). */
export const CHAT_MENU = Object.freeze([
  { id: 'assist-saved', label: 'Saved work' },
  { id: 'assist-find-open', label: 'Find in chat' },
  { id: 'assist-export', label: 'Export chat' },
  { id: 'assist-jump', label: 'Jump to latest' },
]);

/**
 * `session` is the chat's name and `model` the model or team in use (their values change, the bar re-measures on the text change);
 * `canExport` is whether the chat has turns to write out. `expanded`: the chat is the whole page, so the history picker keeps its cap off.
 */
export const assistToolsSpec = ({ session = 'New chat', model = 'Set up a model', canExport = false, expanded = false } = {}) => ({
  kind: 'tools', label: 'Chat', id: 'assist-chat-tools', cls: 'assist-chat-tools', density: 'dense', plainMore: true,
  actions: [
    // the chat's name is the row's one filled control and takes the width the row has to spare (in the inspector New chat and More then stand under
    // Expand and Close; the chat as the whole page stops it at 280px so the row's other controls stay beside it); the model is a quiet picker (its words and a
    // chevron), New chat and More plain icons like the pane's expand and close above them (owner, 2026-10-11)
    { picker: true, id: 'assist-session', label: 'Chat history', value: fitWords(session, expanded ? EXPANDED_SESSION_CH : SESSION_CH), ...(expanded ? {} : { valueCh: SESSION_CH }), keep: true, grow: expanded ? 'cap' : true },
    { picker: true, id: 'assist-model', label: 'Model', icon: 'models', role: 'quiet', plain: true, value: model, valueCh: MODEL_CH, keep: true },
    { id: 'assist-new', label: 'New chat', icon: 'plus', role: 'quiet', plain: true, presence: 'reserve', keep: true },
  ],
  overflow: CHAT_MENU.map(e => (e.id === 'assist-export' ? { ...e, disabled: !canExport } : e)),
});

/** Questions as quiet rows: the whole row is one button. `disabled` while there is no model to ask. */
export function assistSuggestions({ items = [], attr = 'data-sugg', label = 'Suggested questions', disabled = false } = {}) {
  const rows = items.map(item => {
    const [value, text] = Array.isArray(item) ? item : [item, item];
    return uiRow({ cls: 'assist-sugg-row', main: { html: `<button type="button" class="assist-sugg" ${attr}="${esc(value)}"${disabled ? ' disabled' : ''}><span>${esc(text)}</span>${icon('chevron-right', { size: 12 })}</button>` } });
  });
  return rows.length ? uiList({ label, cls: 'assist-sugg-list', rows }) : '';
}

/** A chat cannot start without a model: one sentence and the one way out. */
export const assistModelNotice = () => uiNotice({
  id: 'assist-model-notice', label: 'Model needed', text: 'Connect a model to ask about this project',
  actions: [{ id: 'assist-connect', label: 'Connect model', icon: 'models', attrs: { 'data-chat-model': '' } }],
});
