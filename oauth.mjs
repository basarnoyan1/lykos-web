// Google returns to oauth.html after sign-in (lib/google-auth.mjs): the token is handed to the window that asked, then this one closes.
// A file of its own, not an inline script: the site's content security policy runs scripts only from the site.
const p = new URLSearchParams(location.hash.slice(1) || location.search.slice(1));
const chan = new BroadcastChannel('lykos-oauth');
chan.postMessage(Object.fromEntries(p));
history.replaceState(null, '', location.pathname);
setTimeout(() => { chan.close(); window.close(); }, 100);
