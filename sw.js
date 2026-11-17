// The hosted build's file cache (registered by lib/offline-cache.mjs in a browser tab on https only; the desktop app and the dev server
// never run it). GitHub Pages lets a browser keep a file ten minutes, so a visit after that asked again for each of the app's 240 modules.
// Here every file of this build, the page included, is kept the first time it is fetched and answered from the cache afterwards.
//
// One build is never mixed with another: the cache is named by the build (tools/publish-pages.mjs writes it below), and a new build's
// worker waits until no tab runs the old one, or until a page that has just loaded says 'take' (lib/offline-cache.mjs, page-fresh.js)
// and reloads into it whole; only then is the old cache removed. A reload alone never let it take over (the old page is open while the
// new one loads), so a tab kept the old build until every tab was closed. What the worker does not hold comes from the network, so it
// holds every page of the build (the list below), under each address a page is opened at: a page it did not hold came from whatever
// build the host had by then and drew beside this build's stylesheet (the query visualizer's blocks, with no shape, in Safari from 9 to
// 17 Nov 2026). Only this site's own GET requests are kept; R packages from repo.r-wasm.org and model or search requests go to the
// network untouched.
const BUILD = '0.11.0-6cdae4b4-mwkppvdh';
const CACHE = `lykos-${BUILD}`;
// The shell and the tool pages, one path a line (tools/publish-pages.mjs writes it below, from build-assets.mjs hostedAhead): the pages,
// boot.mjs, the styles, the small scripts, the tool pages' scripts, the icons and the interface font, kept when the worker installs
// (37 files, 2.84 MB, 0.91 MB gzip on 17 Nov 2026; 27 and 0.82 MB on 9 Nov, before the tool pages, from 1,375 and 10.97 MB).
// Every other file (the view modules, PDF.js, the journal fonts, the addons, the catalogues, the R runtime) is kept when it is first fetched,
// so a view opens offline once it has been opened. Unpublished (the tests' tree), nothing is kept ahead.
const FILES = 'app-info.json\napp.mjs\nassets/app/apple-touch-icon.png\nassets/app/icon-192.png\nassets/app/icon-32.png\nassets/app/icon-512.png\nassets/app/icon.svg\nassets/fonts/geist-latin-ext-wght.woff2\nassets/fonts/geist-latin-wght.woff2\nboot.mjs\nbrowser-chrome.html\ncite.html\ncite/cite.mjs\nindex.html\njournal-preview.css\nmanifest.webmanifest\noauth.html\noauth.mjs\npage-fresh.js\nproject-prefetch.js\nquery-blocks.css\nquery.html\nquery/builder.mjs\nquery/edit.mjs\nquery/query.mjs\nquery/saved.mjs\nquery/slot-edit.mjs\nresearch-views.css\nschema.mjs\nsearch-sets.css\nstore.mjs\nstyles.css\ntheme-boot.js\ntokens.css\nui-actions.css\nui-components.css\nworkspace.css';
const AHEAD = FILES.startsWith('__LYKOS') ? [] : FILES.split('\n').filter(Boolean);
// One file that cannot be fetched is skipped, not the whole install: it is fetched and kept when it is first asked for.
// A response that came through a redirect is kept as a plain response under the address asked for and the one it moved to: Cloudflare
// Pages answers query.html with a 308 to query, and the page is opened at either; a browser refuses the kept redirect itself as the answer
// to opening a page (Safari: "Response served by service worker has redirections"; Chrome: ERR_FAILED), and before 17 Nov 2026 the install
// skipped it, so the page was never kept and came from the network, from another build (above). A redirect off the site is not kept.
const own = url => url.origin === self.location.origin && url.href.startsWith(self.registration.scope);
const keep = (cache, key, res) => {
  if (!res.ok || res.type !== 'basic') return null;
  if (!res.redirected) return cache.put(key, res);
  const landed = new URL(res.url);
  if (!own(landed)) return null;
  const plain = new Response(res.body, { status: res.status, statusText: res.statusText, headers: res.headers });
  return Promise.all([cache.put(key, plain.clone()), cache.put(landed, plain)]);
};
// Every fetch the worker keeps asks the server again ('no-cache'): GitHub Pages lets a browser hold a file ten minutes, and the paths carry
// no build in their names, so a plain fetch could fill a new build's cache with the old build's files still held from the last visit.
//
// At most AT_ONCE files are asked for at a time. All ~1,370 were asked for together, so on a first visit the page's own requests (a view
// opened in the first seconds: its dynamic import) shared the connection with the worker's 10.5 MB and waited the length of the install
// (36-42 s measured), the page showing its title and an empty body (3 Nov 2026; test/hosted-first-visit.browser.test.mjs).
const AT_ONCE = 3;
const inTurns = (items, each) => {
  const queue = [...items], run = async () => { for (let item = queue.shift(); item !== undefined; item = queue.shift()) await Promise.resolve(each(item)).catch(() => {}); };
  return Promise.all(Array.from({ length: Math.min(AT_ONCE, queue.length) }, run));
};

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => inTurns(AHEAD, f => {
    const url = new URL(f, self.registration.scope);
    return cache.match(url).then(hit => hit || fetch(url, { cache: 'no-cache' }).then(res => keep(cache, url, res)));
  })));
});

self.addEventListener('message', event => {
  if (event.data === 'take') self.skipWaiting();
  // the files the page fetched before this worker was there to see them (lib/offline-cache.mjs registers once the first view is idle):
  // each of this site's that is not kept yet is kept as an install keeps it
  else if (Array.isArray(event.data?.keep)) event.waitUntil(caches.open(CACHE).then(cache => inTurns(event.data.keep, u => {
    const url = new URL(u, self.registration.scope);
    if (!own(url)) return null;
    return cache.match(url).then(hit => hit || fetch(url, { cache: 'no-cache' }).then(res => keep(cache, url, res)));
  })));
});

// A first install (no older build kept) also takes the open tab, whose files are this build's: its views then load from the cache.
// After a publish the new worker takes over only when a page that has just loaded asks (lib/offline-cache.mjs); the other tabs of
// the old build reload when next out of sight.
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(async keys => {
    const old = keys.filter(k => k.startsWith('lykos-') && k !== CACHE);
    await Promise.all(old.map(k => caches.delete(k)));
    if (!old.length) await self.clients.claim();
  }));
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin || req.headers.has('range')) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    // the query string is not part of a file's identity here (a cache-busting ?v= asks for the same file)
    const hit = await cache.match(req, { ignoreSearch: true });
    if (hit && !hit.redirected) return hit;   // an earlier build's worker may have kept a redirect: it goes to the network instead
    const res = await fetch(req, { cache: 'no-cache' });
    if (res.ok && res.type === 'basic') Promise.resolve(keep(cache, req, res.clone())).catch(() => {});
    return res;
  })());
});
