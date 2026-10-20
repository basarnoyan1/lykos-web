// The target journal and everything the app derives from it, in one place.
//
// project.journals[0] is the journal the manuscript is written for. From it,
// and from the choices the author has made by hand, `journalContext` answers
// the questions every page used to answer for itself: which reference style,
// numbered or author–year, which journal profile, and where each came from.
// The manuscript, its checks and exports, the reader, the bundle and Settings
// all read this; none of them reads settings.refStyle directly.
//
// Reference style, first match wins:
//   manual   the author chose one in Settings > Reference style
//   profile  the author's own (custom) journal profile names one
//   preset   the target journal is in lib/journal-presets.mjs with a style
//   catalog  the journal was chosen from the catalogue, which gives a format
//            (numeric reads as Vancouver, author-date as APA)
//   default  Vancouver
// A built-in profile's reference style is a default of its convention, not a
// journal's instruction, so it does not take part.
//
// Pure: nothing here imports a view. setJournals changes state; it never
// touches the manuscript text.

import { STYLES } from './cite.mjs';
import { JOURNAL_PRESETS, findPreset } from './journal-presets.mjs';
import { profileById } from './journal-profiles.mjs';
import { normalizeJournalProfile, activeProfile } from './journal-profile-state.mjs';

export const targetJournal = s => s.project?.journals?.[0] || s.paper?.journal || '';
export const otherJournals = s => (s.project?.journals || []).slice(1);

const styleOf = id => STYLES.find(x => x.id === id) || null;
const citationOf = id => styleOf(id)?.numbered === false ? 'author-year' : 'numbered';
const FORMAT_STYLE = { numeric: 'vancouver', 'author-date': 'apa' };
export const styleLabel = id => styleOf(id)?.label || id;

/** The reference style a journal choice asks for, when that is known: `{ style, preset }` or null. */
export function journalStyle(choice, presets = JOURNAL_PRESETS) {
  const preset = findPreset(choice, presets);
  if (preset?.style) return { style: preset.style, preset };
  const style = FORMAT_STYLE[choice?.format] || null;
  return style ? { style, preset } : null;
}

/**
 * What the target journal and the author's choices amount to:
 * `{ journal, preset, referenceStyle, citationStyle, source, profile, profileId, profileFrom, note }`.
 * `source` is 'manual' | 'profile' | 'preset' | 'catalog' | 'default';
 * `profileFrom` is 'target' (set by the journal), 'manual', 'custom' or null.
 */
export function journalContext(s, { presets = JOURNAL_PRESETS } = {}) {
  const journal = targetJournal(s || {});
  const cfg = s?.settings || {};
  const preset = journal ? findPreset(journal, presets) : null;
  const jp = normalizeJournalProfile(s?.journalProfile);
  const profile = activeProfile(jp);
  const profileId = profile ? jp.id : null;
  const profileFrom = !profileId ? null : jp.id === 'custom' ? 'custom' : jp.from === 'target' ? 'target' : 'manual';

  const stored = styleOf(cfg.refStyle) ? cfg.refStyle : null;
  // A project saved before the choice was recorded: a style Settings or an older target left in place
  // is the author's unless it was set for this very journal (journalPresetName).
  const forThisJournal = !!journal && cfg.journalPresetName === journal;
  const legacyAuthorYear = !stored && cfg.citationStyle === 'author-year';
  const manual = cfg.refStyleManual === true ? !!stored || legacyAuthorYear
    : cfg.refStyleManual === false ? false
    : (!!stored && !forThisJournal) || legacyAuthorYear;

  let referenceStyle, source;
  if (manual) { referenceStyle = stored || 'apa'; source = 'manual'; }
  else if (profileFrom === 'custom' && styleOf(profile.referenceStyle)) { referenceStyle = profile.referenceStyle; source = 'profile'; }
  else if (preset?.style && styleOf(preset.style)) { referenceStyle = preset.style; source = 'preset'; }
  else if (FORMAT_STYLE[s?.project?.journalFormat]) { referenceStyle = FORMAT_STYLE[s.project.journalFormat]; source = 'catalog'; }
  else if (forThisJournal && stored) { referenceStyle = stored; source = 'catalog'; }   // saved before the format was kept on the project
  else { referenceStyle = 'vancouver'; source = 'default'; }

  // Numbered or author–year follows the style, except in a project whose author set the two apart by hand.
  const citationStyle = manual && ['numbered', 'author-year'].includes(cfg.citationStyle) ? cfg.citationStyle : citationOf(referenceStyle);
  const ctx = { journal, preset, referenceStyle, citationStyle, source, profile, profileId, profileFrom };
  return { ...ctx, note: referenceStyleNote(ctx) };
}

/** Where the reference style came from, as a sentence for Settings ("Reference style: AMA 11th, from Neurosurgery"). */
export function referenceStyleNote({ journal, preset, referenceStyle, source }) {
  const label = styleLabel(referenceStyle);
  switch (source) {
    case 'manual': return `Reference style: ${label}, set by hand`;
    case 'profile': return `Reference style: ${label}, from the custom journal profile`;
    case 'preset': return `Reference style: ${label}, from ${preset?.label || journal}${preset && !preset.verified ? ' (unverified)' : ''}`;
    case 'catalog': return `Reference style: ${label}, from the format of ${journal}`;
    default: return journal ? `Reference style: ${label}, the format of ${journal} is not known` : `Reference style: ${label}, the default`;
  }
}

// ---- changing the target ---------------------------------------------------

/**
 * Sets the target journals (the first is the target), keeping paper.journal
 * equal. The reference style and the journal profile follow the new target as
 * journalContext describes; a style or profile the author chose is kept. A
 * style set by hand is recorded as such so it survives the change. The
 * catalogue's format for a chosen journal is kept on the project.
 */
export function setJournals(st, list, choice = null) {
  const before = journalContext(st);
  const journals = [...new Set(list.map(x => String(x || '').trim()).filter(Boolean))].slice(0, 10);
  const target = journals[0] || '';
  const changed = target !== before.journal;
  const project = { ...(st.project || {}), journals };
  if (changed || (choice && choice.label === target)) {
    const format = choice && choice.label === target && FORMAT_STYLE[choice.format] ? choice.format : null;
    if (format) project.journalFormat = format; else delete project.journalFormat;
  } else if (before.source === 'catalog' && !project.journalFormat) project.journalFormat = before.referenceStyle === 'apa' ? 'author-date' : 'numeric';   // keep what an older version left in settings
  st.project = project;
  st.paper = { ...(st.paper || {}), journal: target };

  const cfg = { ...(st.settings || {}) };
  if (before.source === 'manual') { cfg.refStyleManual = true; cfg.refStyle = before.referenceStyle; cfg.citationStyle = before.citationStyle; }
  else {
    // Left by an earlier version for the old target; the style is worked out from the new one.
    for (const k of ['refStyle', 'citationStyle', 'journalPreset', 'journalPresetName']) delete cfg[k];
  }
  if (st.settings || Object.keys(cfg).length) st.settings = cfg;

  if (changed) followProfile(st, findPreset(target));
  return st;
}

/** The journal profile follows a new target unless the author chose or wrote one. */
function followProfile(st, preset) {
  const jp = normalizeJournalProfile(st.journalProfile);
  const chosen = !!jp && (jp.from === 'manual' || (!!jp.id && jp.from !== 'target'));
  if (chosen) return;
  const id = preset?.profile && profileById(preset.profile) ? preset.profile : null;
  if (id) st.journalProfile = normalizeJournalProfile({ ...(jp || {}), id, from: 'target' });
  else if (jp?.from === 'target') st.journalProfile = normalizeJournalProfile({ ...jp, id: null, from: null });
}

/** What a target change leaves to compare: the parts of journalContext a notice speaks of. */
export function journalSnapshot(s) {
  const c = journalContext(s);
  return { journal: c.journal, referenceStyle: c.referenceStyle, source: c.source, profileId: c.profileId, profileFrom: c.profileFrom };
}

/**
 * One short sentence for a change of target journal, or '' when the target
 * did not change or was cleared: what the reference style is now and, when
 * the journal brought one, the journal profile.
 */
export function targetChangeNotice(before, s) {
  const now = journalContext(s);
  if (!now.journal || now.journal === before.journal) return '';
  const label = styleLabel(now.referenceStyle);
  const style = now.source === 'manual' ? `Style kept: ${label}, set by hand`
    : now.source === 'profile' ? `Style kept: ${label}, from the custom journal profile`
    : now.source === 'preset' || now.source === 'catalog' ? `Reference style set to ${label} for ${now.journal}`
    : now.referenceStyle === before.referenceStyle ? `Style kept: ${label} (format of this journal is not known)`
    : `Reference style set to ${label}: format of this journal is not known`;
  const followed = now.profileFrom === 'target' && now.profileId !== before.profileId
    ? `Journal profile set to ${now.profile.name}`
    : before.profileFrom === 'target' && !now.profileId ? 'Journal profile cleared' : '';
  return [style, followed].filter(Boolean).join('. ');
}

/**
 * Changes the target through the store and says what followed, once, through
 * the page's status (`say`). `store` is `{ get, update }` of store.mjs.
 */
export function changeTarget({ get, update, say }, list, choice = null) {
  const before = journalSnapshot(get());
  update(st => setJournals(st, list, choice));
  const msg = targetChangeNotice(before, get());
  if (msg) say?.(msg);
  return msg;
}
