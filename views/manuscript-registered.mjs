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
const section = (id, title, rows) => rows.length
  ? `<section class="msr-sec" aria-labelledby="msr-${id}-h"><h3 class="msr-h" id="msr-${id}-h">${esc(title)}</h3><ul class="msr-list">${rows.join('')}</ul></section>` : '';

/** The page for a registered manuscript `e` (registeredManuscript), on the day `now`. */
export function registeredHtml(e, now = Date.now()) {
  if (!e) return '';
  const facts = [['Version', e.version || ''], ['Built', e.builtAt ? when(e.builtAt, now) : ''], ['File', e.file], ['Journal', e.journal?.profile || '']].filter(([, v]) => v);
  const status = e.stale
    ? `<p class="msr-status" data-tone="working">${icon('clock', { size: 12 })}<span>${esc(`Data changed since it was built: ${e.after.text}`)}</span></p>`
    : `<p class="msr-status" data-tone="finished">${icon('check', { size: 12 })}<span>Built from the data as it is now</span></p>`;
  const head = `<header class="msr-intro">${hangRow({ tag: 'h2', cls: 'msr-title', mark: icon('file-word', { size: 14 }), body: esc(e.title || base(e.file)) })}
    <dl class="msr-facts">${facts.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>${status}</header>`;
  const limit = label => (e.journal?.sections || []).flatMap(x => x.items || []).find(i => i.label === label);
  const words = limit('Words in main text'), abs = limit('Abstract words');
  const wordRows = [
    ...(e.abstractWords != null ? [row({ name: 'Abstract', value: abs?.detail ? inWords(abs.detail) : plural(e.abstractWords, 'word'), state: abs?.state || '' })] : []),
    row({ name: 'Main text', value: words?.detail ? inWords(words.detail) : plural(e.words || 0, 'word'), state: words?.state || '',
      tip: e.statedWords && e.statedWords !== e.words ? `The title page states ${num(e.statedWords)} words` : '' }),
    ...sectionGroups(e.sections).flatMap(g => [row({ name: g.name, value: num(g.words), depth: 1 }), ...g.parts.map(p => row({ name: p.name, value: num(p.words), depth: 2 }))])];
  const nc = e.numberCheck;
  const checkRows = nc ? [row({ name: `${num(nc.unmatched)} of ${num(nc.checked)} numbers unmatched`, value: base(nc.file), state: nc.unmatched ? 'warn' : 'ok', tip: nc.date ? `Checked ${nc.date}` : '' })] : [];
  const limitRows = (e.journal?.sections || []).find(x => x.title === 'Limits')?.items?.filter(i => !['Words in main text', 'Abstract words'].includes(i.label))
    .map(i => row({ name: i.label, value: grouped(i.detail), state: i.state })) || [];
  const reviewRows = (e.journal?.sections || []).filter(x => x.title !== 'Limits').flatMap(x => (x.items || []).filter(i => i.state !== 'ok').map(i => row({ name: `${x.title}: ${i.label}`, value: i.detail || '', state: i.state })));
  const listRows = (e.checklists || []).map(c => row({ name: c.name, value: `${c.located} of ${c.items} items located`, state: c.located === c.items ? 'ok' : 'warn', tip: c.file }));
  const fileRows = (e.files || []).map(f => row({ name: base(f.file), value: f.builtAt ? when(f.builtAt, now) : '', tip: f.file }));
  return `<div class="msr ui-hang">${head}${section('words', 'Words', wordRows)}${section('numbers', 'Number check', checkRows)}${section('limits', `Limits of ${e.journal?.profile || 'the journal'}`, limitRows)}${section('review', 'To review before submission', reviewRows)}${section('checklists', 'Reporting checklists', listRows)}${section('files', 'Files with it', fileRows)}</div>`;
}
