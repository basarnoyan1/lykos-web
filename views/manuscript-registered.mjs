// A manuscript built outside Lykos and registered (tools/lykos-register.mjs, change op register_output; lib/review-state.mjs
// externalOutputs): the Manuscript page shows it when the project has no manuscript of its own in the app. 1 Nov 2026: the page said
// "No manuscript" while the sham review's v4 was registered and the Overview named it. What the registration read is shown as read: the
// title, version and date, each main-text section's words, the number check, the target journal's limits, the reporting checklists and
// the files that go with it, and whether the data changed after the file was built. A reading page (one text edge, hangRow); the title
// bar holds Open in Word and Import (views/manuscript.mjs page).
import { lib_html$esc as esc } from "../boot.mjs";
import { lib_icons$icon as icon } from "../boot.mjs";
import { lib_ui_components$hangRow as hangRow } from "../boot.mjs";
import { lib_dates$when as when, lib_dates$plural as plural, lib_dates$num as num } from "../boot.mjs";
import { externalOutputs } from '../lib/review-state.mjs';
import { lib_ui_actions$uiBar as uiBar } from "../boot.mjs";
import { authorMismatches } from '../lib/author-list.mjs';

/** The registered manuscript with what changed after it was built, or null. */
export const registeredManuscript = (s, now = Date.now()) => externalOutputs(s, undefined, now).manuscript || null;

// a section with no words of its own heads the sections after it ("Methods" over its parts), until the next such heading or a section that
// is always a part of its own (Introduction, Discussion, Conclusions); its words are its parts' sum
const OWN = /^(introduction|background|discussion|conclusions?|references|acknowledg)/i;
/** The registered sections as groups: [{ name, words, parts: [{ name, words }] }]. */
export function sectionGroups(sections = []) {
  const out = [];
  let open = null;
  for (const x of sections) {
    const name = String(x?.name || '').trim(), words = Number(x?.words) || 0;
    if (!name) continue;
    if (!words) { open = { name, words: 0, parts: [] }; out.push(open); continue; }
    if (open && !OWN.test(name)) { open.parts.push({ name, words }); open.words += words; continue; }
    open = null;
    out.push({ name, words, parts: [] });
  }
  return out;
}

const TONE = { ok: 'finished', warn: 'working', missing: 'stopped' };
const GLYPH = { ok: 'check', warn: 'warn', missing: 'stop' };
const STATE_WORD = { ok: 'Passes', warn: 'To review', missing: 'Missing' };
const base = f => String(f || '').split('/').pop();
// a journal check's detail with its numbers grouped and the unit before the bracket: "4518 of 4500 (18 over)" → "4,518 of 4,500 words (18 over)"
const grouped = t => String(t || '').replace(/\b\d{4,}\b/g, n => num(Number(n)));
const inWords = d => { const t = grouped(d), i = t.indexOf(' ('); return i > 0 ? `${t.slice(0, i)} words${t.slice(i)}` : `${t} words`; };
const row = ({ name, value = '', state = '', depth = 0, tip = '' }) => hangRow({ tag: 'li', cls: 'msr-row',
  attrs: `${depth ? `data-depth="${depth}"` : ''}${tip ? ` title="${esc(tip)}"` : ''}`,
  mark: state ? `<span class="msr-state" data-tone="${TONE[state] || ''}">${icon(GLYPH[state] || 'dot', { size: 12 })}<span class="visually-hidden">${esc(STATE_WORD[state] || '')}</span></span>` : '',
  body: `<span class="msr-name">${esc(name)}</span>${value ? `<span class="msr-value">${esc(value)}</span>` : ''}` });
const list = rows => `<ul class="msr-list">${rows.join('')}</ul>`;
const section = (id, title, rows) => rows.length
  ? `<section class="msr-sec" aria-labelledby="msr-${id}-h"><h3 class="msr-h" id="msr-${id}-h">${esc(title)}</h3>${list(rows)}</section>` : '';

/**
 * The registration's facts as the inspector's sections beside the reader (views/manuscript-reader.mjs): [{ id, title, html }]. The file
 * (version, date, file, journal, whether the data changed since), its words, the number check, the journal's limits, what is left to
 * review, the reporting checklists and the files that go with it; a section with nothing to say is left out.
 */
export function registeredSections(e, now = Date.now()) {
  if (!e) return [];
  const facts = [['Version', e.version || ''], ['Built', e.builtAt ? when(e.builtAt, now) : ''], ['Edited in Lykos', e.edited?.at ? when(e.edited.at, now) : ''], ['File', e.file], ['Journal', e.journal?.profile || '']].filter(([, v]) => v);
  // the status hangs its mark in the marks' column and its words on the facts' edge, as the title does (2 Nov 2026)
  const status = e.stale
    ? hangRow({ tag: 'p', cls: 'msr-status', attrs: 'data-tone="working"', mark: icon('clock', { size: 12 }), body: esc(`Data changed since it was built: ${e.after.text}`) })
    : hangRow({ tag: 'p', cls: 'msr-status', attrs: 'data-tone="finished"', mark: icon('check', { size: 12 }), body: 'Built from the data as it is now' });
  const fileHtml = `<div class="msr ui-hang msr-in">${hangRow({ tag: 'p', cls: 'msr-title', mark: icon('file-word', { size: 14 }), body: esc(e.title || base(e.file)) })}
    <dl class="msr-facts">${facts.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>${status}</div>`;
  const limit = label => (e.journal?.sections || []).flatMap(x => x.items || []).find(i => i.label === label);
  const words = limit('Words in main text'), abs = limit('Abstract words');
  const wordRows = [
    ...(e.abstractWords != null ? [row({ name: 'Abstract', value: abs?.detail ? inWords(abs.detail) : plural(e.abstractWords, 'word'), state: abs?.state || '' })] : []),
    row({ name: 'Main text', value: words?.detail ? inWords(words.detail) : plural(e.words || 0, 'word'), state: words?.state || '',
      tip: e.statedWords && e.statedWords !== e.words ? `The title page states ${num(e.statedWords)} words` : '' })];
  // each section's words are the outline's, beside the text (views/manuscript-reader.mjs): one place (2 Nov 2026)
  const nc = e.numberCheck;
  const checkRows = nc ? [row({ name: `${num(nc.unmatched)} of ${num(nc.checked)} numbers unmatched`, value: base(nc.file), state: nc.unmatched ? 'warn' : 'ok', tip: nc.date ? `Checked ${nc.date}` : '' })] : [];
  const limitRows = (e.journal?.sections || []).find(x => x.title === 'Limits')?.items?.filter(i => !['Words in main text', 'Abstract words'].includes(i.label))
    .map(i => row({ name: i.label, value: grouped(i.detail), state: i.state })) || [];
  const reviewRows = (e.journal?.sections || []).filter(x => x.title !== 'Limits').flatMap(x => (x.items || []).filter(i => i.state !== 'ok').map(i => row({ name: `${x.title}: ${i.label}`, value: i.detail || '', state: i.state })));
  const listRows = (e.checklists || []).map(c => row({ name: c.name, value: `${c.located} of ${c.items} items located`, state: c.located === c.items ? 'ok' : 'warn', tip: c.file }));
  const fileRows = (e.files || []).map(f => row({ name: base(f.file), value: f.builtAt ? when(f.builtAt, now) : '', tip: f.file }));
  const sec = (id, title, rows) => (rows.length ? [{ id, title, html: `<div class="msr ui-hang msr-in">${list(rows)}</div>` }] : []);
  return [{ id: 'file', title: e.version ? `Manuscript ${e.version}` : 'Manuscript', html: fileHtml }, ...sec('words', 'Words', wordRows), ...sec('numbers', 'Number check', checkRows),
    ...sec('limits', `Limits of ${e.journal?.profile || 'the journal'}`, limitRows), ...sec('review', 'To review before submission', reviewRows),
    ...sec('checklists', 'Reporting checklists', listRows), ...sec('files', 'Files with it', fileRows)];
}

/**
 * The registered Word file's title page against the author list (plan W9a): each difference (names, order, degrees, affiliations,
 * placeholders, the corresponding author), read from what the registration recorded (tools/lykos-register.mjs titlePage), so an edit
 * of the list shows here at once; and Write the title page, a Word file built from the list beside the manuscript, never over a file.
 */
export function authorSection(e, s = {}) {
  if (!e?.titlePage) return [];
  const diffs = authorMismatches(e.titlePage, s.paper?.authors || []);
  const rows = diffs.length ? diffs.map(d => row({ name: d.text, state: 'warn' })) : [row({ name: 'Matches the author list', state: 'ok' })];
  const bar = uiBar({ kind: 'tools', label: 'Title page', id: 'msr-title-tools', message: { id: 'msr-title-status', text: '' },
    actions: [{ id: 'msr-title-page', label: 'Write the title page', icon: 'file-word' }] });
  return [{ id: 'authors', title: diffs.length ? `Authors: ${plural(diffs.length, 'difference')} from the list` : 'Authors', html: `<div class="msr ui-hang msr-in">${list(rows)}</div>${bar}`,
    wire: body => {
      const button = body?.querySelector('#msr-title-page'), status = body?.querySelector('#msr-title-status');
      if (button) button.onclick = async () => {
        button.disabled = true; status.textContent = 'Writing';
        try {
          const [{ EXPORTS }, { activeFolder }, { get }] = await Promise.all([import('../lib/project-exports.mjs'), import('../lib/projects.mjs'), import('../store.mjs')]);
          const { bytes } = await EXPORTS['title-page'].make(get()), folder = activeFolder();
          const dir = e.file.includes('/') ? `${e.file.slice(0, e.file.lastIndexOf('/'))}/` : '';
          if (!folder?.writeBytes) { const { saveFile } = await import('../lib/save.mjs'); await saveFile(bytes, 'Title page.docx'); status.textContent = 'Saved Title page.docx'; return; }
          let rel = '', n = 1;
          do { rel = `${dir}Title page${n > 1 ? ` v${n}` : ''}.docx`; n++; } while ((await folder.stat(rel)).exists);
          await folder.writeBytes(rel, bytes);
          status.textContent = `Wrote ${base(rel)}`;
        } catch (err) { status.textContent = err.message; } finally { button.disabled = false; }
      };
    } }];
}

/** The page for a registered manuscript `e` (registeredManuscript), on the day `now`: the registration's facts on one reading page. */
export function registeredHtml(e, now = Date.now()) {
  if (!e) return '';
  const [file, ...rest] = registeredSections(e, now);
  const head = file.html.replace('<div class="msr ui-hang msr-in">', '<header class="msr-intro">').replace(/<\/div>$/, '</header>');
  return `<div class="msr ui-hang">${head}${rest.map(x => `<section class="msr-sec" aria-labelledby="msr-${x.id}-h"><h3 class="msr-h" id="msr-${x.id}-h">${esc(x.title)}</h3>${x.html.replace(/^<div class="msr ui-hang msr-in">|<\/div>$/g, '')}</section>`).join('')}</div>`;
}

/** The registered Word files the reader can show: the manuscript, and a supplement that went with it. [{ key, label, file }]. */
export function readerDocs(e) {
  if (!e?.file || !/\.docx$/i.test(e.file)) return [];
  const supp = (e.files || []).find(f => /\.docx$/i.test(f.file) && /supplement/i.test(base(f.file)))?.file;
  return [{ key: 'manuscript', label: 'Manuscript', file: e.file }, ...(supp ? [{ key: 'supplement', label: 'Supplement', file: supp }] : [])];
}
// which of them the page shows, kept while the app is open
let shownKey = 'manuscript';
export const shownDoc = e => { const docs = readerDocs(e); return docs.find(d => d.key === shownKey) || docs[0] || null; };
export const showDoc = key => { shownKey = key; };
// how each file is shown: 'app' (read in the app's own type, its figures drawn from their Lykos outputs) or 'word' (its pages, edited as in
// Files), kept per file on this computer (2 Nov 2026: "improve both of the app style and docx viewers")
const MODE_KEY = file => `lykos.manuscript.view:${file}`;
const modes = new Map();
export function modeOf(doc) {
  if (!doc) return 'app';
  if (!modes.has(doc.file)) { let m = null; try { m = localStorage.getItem(MODE_KEY(doc.file)); } catch { /* not kept: the default */ } modes.set(doc.file, ['word', 'journal'].includes(m) ? m : 'app'); }
  return modes.get(doc.file);
}
export function setMode(mode, doc) {
  if (!doc?.file) return;
  modes.set(doc.file, ['word', 'journal'].includes(mode) ? mode : 'app');
  try { localStorage.setItem(MODE_KEY(doc.file), modes.get(doc.file)); } catch { /* kept for this session only */ }
}
