// The chat home's first screen, kept for the next start (app.mjs FIRST_SCREEN): what the home, the sidebar and the status line showed once
// drawn from the project, per project for one build, the last few projects only. Loaded once the home is on screen and the page is quiet.

/** Keeps the screen as drawn now; a storage that refuses (full, private) keeps nothing, and the next start draws the home once the project is in. */
export function keepScreen({ key, keep, id, build, title, home, nav }) {
  try {
    const all = JSON.parse(localStorage.getItem(key) || '{}') || {}, foot = {};
    for (const b of document.querySelectorAll('#foot button[data-k]')) foot[b.dataset.k] = [b.querySelector('.count')?.textContent || '', b.hidden];
    all[id] = { build, at: Date.now(), title: title.innerHTML, home: home.innerHTML, nav: nav.innerHTML, foot,
      status: document.getElementById('status')?.innerHTML || '', label: document.getElementById('proj-name')?.textContent || '' };
    for (const old of Object.keys(all).sort((a, b) => (all[b].at || 0) - (all[a].at || 0)).slice(keep)) delete all[old];
    localStorage.setItem(key, JSON.stringify(all));
  } catch { /* nothing kept */ }
}
