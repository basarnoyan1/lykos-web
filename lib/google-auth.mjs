// Signing in with Google in the hosted web build (plan §2, "Working as a team"): the access a Drive folder needs, and who is
// working. No library: the OAuth 2.0 token flow for browser apps, in a popup that returns to oauth.html, which hands the
// token back over a BroadcastChannel (Google's pages cut window.opener). The token lives in this tab's sessionStorage for
// its hour; nothing is sent anywhere but Google. The OAuth client is the owner's own (Settings › Google Drive): Lykos ships none.

const STORE = 'lykos.google', TOKEN = 'lykos.google.token', CHANNEL = 'lykos-oauth';
export const SCOPES = ['openid', 'email', 'profile', 'https://www.googleapis.com/auth/drive'];

// Storage is named, not passed: a page without it (a test, a locked-down browser) reads nothing and keeps nothing.
const areaOf = name => { try { return globalThis[name] || null; } catch { return null; } };
const readJson = (name, key) => { try { return JSON.parse(areaOf(name)?.getItem(key) || 'null'); } catch { return null; } };
const writeJson = (name, key, v) => { try { const a = areaOf(name); if (v == null) a?.removeItem(key); else a?.setItem(key, JSON.stringify(v)); } catch {} };

/** The owner's OAuth client and the signed-in person, as kept in this browser: { clientId, profile: { email, name } | null }. */
export const googleSettings = () => ({ clientId: '', profile: null, ...(readJson('localStorage', STORE) || {}) });
export function setGoogleClientId(clientId) { writeJson('localStorage', STORE, { ...googleSettings(), clientId: String(clientId || '').trim() }); }

/** The address Google returns to, which the OAuth client must list as an authorised redirect URI. */
export const redirectUri = () => (globalThis.location?.href ? new URL('oauth.html', location.href).href.replace(/[?#].*$/, '') : 'oauth.html');

const live = t => t && t.token && t.exp > Date.now() + 60_000;
export const signedIn = () => !!googleSettings().profile && live(readJson('sessionStorage', TOKEN));

/** Thrown when a Drive call needs a sign-in that only a press can start (a popup needs a gesture). */
export class SignInNeeded extends Error {
  constructor() { super('Sign in with Google again to keep saving to Drive'); this.name = 'SignInNeeded'; }
}

/**
 * Opens Google's sign-in in a popup and resolves with the token. Must run from a press. `quiet` asks Google not to show
 * the account chooser when this browser already consented (the hourly renewal).
 */
export function signIn({ quiet = false } = {}) {
  const { clientId } = googleSettings();
  if (!clientId) return Promise.reject(new Error('Add your Google OAuth client ID in Settings › Google Drive first'));
  const state = crypto.randomUUID();
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  for (const [k, v] of Object.entries({ client_id: clientId, redirect_uri: redirectUri(), response_type: 'token', scope: SCOPES.join(' '),
    include_granted_scopes: 'true', state, ...(quiet && googleSettings().profile ? { login_hint: googleSettings().profile.email } : { prompt: 'select_account' }) }))
    url.searchParams.set(k, v);
  const popup = window.open(url.href, 'lykos-google', 'popup,width=480,height=640');
  if (!popup) return Promise.reject(new Error('The browser blocked the Google sign-in window'));
  return new Promise((resolve, reject) => {
    const chan = new BroadcastChannel(CHANNEL);
    const done = (fn, v) => { clearInterval(timer); chan.close(); fn(v); };
    chan.onmessage = async ({ data }) => {
      if (data?.state !== state) return;
      if (data.error) return done(reject, new Error(`Google sign-in: ${data.error}`));
      const t = { token: data.access_token, exp: Date.now() + (Number(data.expires_in) || 3600) * 1000, scope: data.scope || '' };
      if (!SCOPES.every(s => s.startsWith('http') ? t.scope.includes(s) : true)) return done(reject, new Error('Google sign-in did not grant Drive access'));
      writeJson('sessionStorage', TOKEN, t);
      try {
        const r = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', { headers: { Authorization: `Bearer ${t.token}` } });
        const u = r.ok ? await r.json() : {};
        writeJson('localStorage', STORE, { ...googleSettings(), profile: { email: u.email || '', name: u.name || u.email || '' } });
      } catch {}
      done(resolve, t.token);
    };
    // A closed popup without an answer is a cancel.
    const timer = setInterval(() => { if (popup.closed) setTimeout(() => done(reject, Object.assign(new Error('Sign-in cancelled'), { name: 'AbortError' })), 500); }, 400);
  });
}

/** Forgets the token and the person in this browser; Google keeps the consent until it is removed in the Google account. */
export function signOut() {
  writeJson('sessionStorage', TOKEN, null);
  writeJson('localStorage', STORE, { ...googleSettings(), profile: null });
}

/** The live token, or SignInNeeded: renewal needs a press, so a save that finds the hour over says so. */
export async function accessToken() {
  const t = readJson('sessionStorage', TOKEN);
  if (live(t)) return t.token;
  throw new SignInNeeded();
}

