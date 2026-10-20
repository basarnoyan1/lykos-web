// About: the version of the app and the notices for the software it contains: a section of Settings, opened from
// Help, Licences and Notices (desktop) or from the command palette. The notices are
// THIRD_PARTY_NOTICES.md, generated at build time by tools/notices.mjs and copied beside the page.
import { esc } from './html.mjs';
import { disclosure } from './ui-components.mjs';
import { inDesktop } from './native.mjs';

const invoke = cmd => window.__TAURI_INTERNALS__.invoke(cmd);

/** The name, version and build commit of the running app: the shell's own name and version in the desktop app, else the build's
 * app-info.json, which also names the commit the build was made from (app/build.mjs) in both. */
export async function appIdentity() {
  let info = {};
  try { const r = await fetch('./app-info.json'); if (r.ok) info = await r.json(); } catch { /* not built */ }
  const commit = String(info.commit || '');
  if (inDesktop()) {
    try { return { name: String(await invoke('plugin:app|name')), version: String(await invoke('plugin:app|version')), commit }; } catch { /* fall through */ }
  }
  return { name: 'Lykos', version: String(info.version || ''), commit };
}
/** "0.10.0 (1a2b3c4)": the version and, when known, the build's commit. */
export const versionLabel = ({ version = '', commit = '' } = {}) => version ? `${version}${commit ? ` (${commit})` : ''}` : '';

/** The sections of the notices text: [{ title, entries, text }], the lead paragraph left out. A `## ` line inside a fenced licence text is text, not a heading. */
export function noticeSections(markdown) {
  const sections = []; let fence = '';
  for (const line of String(markdown).split('\n')) {
    const mark = /^(```|~~~~)/.exec(line)?.[1];
    if (mark) fence = fence ? (mark === fence ? '' : fence) : mark;
    if (!fence && line.startsWith('## ')) sections.push({ title: line.slice(3).trim(), lines: [], entries: 0 });
    else if (sections.length) { sections.at(-1).lines.push(line); if (!fence && line.startsWith('- ')) sections.at(-1).entries++; }
  }
  return sections.map(s => { const text = s.lines.join('\n').trim(); return { title: s.title, entries: s.entries, text }; });
}

/** A section's text as its intro (the prose before the list) and its rows: "- name version — licence — source …" → { name, version, licence, source }. */
export function noticeEntries(text) {
  const lines = String(text).split('\n'), intro = [], rows = [];
  for (const line of lines) {
    if (!line.startsWith('- ')) { if (!rows.length && line.trim()) intro.push(line.trim()); continue; }
    const [head, licence = '', ...rest] = line.slice(2).split(' — ');
    const sp = head.indexOf(' ');
    rows.push({ name: sp > 0 ? head.slice(0, sp) : head, version: sp > 0 ? head.slice(sp + 1) : '', licence: licence.replaceAll('`', ''), source: rest.join(' — ') });
  }
  return { intro: intro.join(' '), rows };
}

let notices = null;   // the notices text, read once a session
const rowsHtml = rows => `<table class="about-table"><thead><tr><th scope="col">Name</th><th scope="col">Version</th><th scope="col">Licence</th></tr></thead><tbody>${
  rows.map(r => `<tr${r.source ? ` title="${esc(r.source)}"` : ''}><td>${esc(r.name)}</td><td>${esc(r.version)}</td><td>${esc(r.licence)}</td></tr>`).join('')}</tbody></table>`;

/** Fills `host` with the notices for the software the app contains, one disclosure per section. */
export async function renderNotices(host) {
  host.innerHTML = '<p class="meta" role="status">Loading notices…</p>';
  try {
    if (!notices) { const r = await fetch('./THIRD_PARTY_NOTICES.md'); if (!r.ok) throw new Error(`HTTP ${r.status}`); notices = await r.text(); }
    const sections = noticeSections(notices);
    // a section is drawn when it is opened: a closed list of 472 crates costs nothing
    host.innerHTML = sections.map((s, i) => disclosure({ title: s.title, count: s.entries || null, attrs: { 'data-section': String(i) }, body: '' })).join('');
    const fill = d => {
      const s = sections[Number(d.dataset.section)], body = d.querySelector('.ui-disclosure-body');
      if (!s || body.dataset.filled) return;
      body.dataset.filled = '1';
      if (s.title === 'Licence texts') { body.innerHTML = '<pre class="about-notices" tabindex="0"></pre>'; body.firstChild.textContent = s.text; return; }
      const { intro, rows } = noticeEntries(s.text);
      body.innerHTML = `${intro ? `<p class="about-intro">${esc(intro.replaceAll('`', ''))}</p>` : ''}${rows.length ? rowsHtml(rows) : ''}`;
    };
    host.querySelectorAll('details[data-section]').forEach(d => d.addEventListener('toggle', () => { if (d.open) fill(d); }));
  } catch (err) {
    host.innerHTML = `<p class="note" role="alert">The notices could not be loaded: ${esc(err.message || err)}</p>`;
  }
}
