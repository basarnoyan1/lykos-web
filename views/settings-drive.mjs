// Settings > Google Drive (web build): the owner's OAuth client, the Google account signed in, and opening a shared Drive folder as a
// project (plan §2, "Working as a team"; lib/google-auth.mjs, lib/drive-folder.mjs). Built from the page's settings rows.
import { googleSettings, setGoogleClientId, redirectUri, signIn, signOut } from '../lib/google-auth.mjs';
import { initialsOf } from '../lib/team.mjs';
import { appValues } from '../lib/app-settings.mjs';
import { saveApp } from '../lib/model-settings.mjs';
import { viewOnly } from '../store.mjs';
import { openFromDrive } from '../lib/drive-open.mjs';

/** The rows; `srow` is the page's row builder. */
export function driveBody(srow) {
  const { clientId, profile } = googleSettings();
  return `
    ${srow('OAuth client ID', { desc: `A web client in Google Cloud › Credentials, with this authorized redirect URI: ${redirectUri()}`, find: 'google drive oauth client id credentials',
      filters: [{ type: 'field', width: 'flex', id: 's-google-client', label: 'OAuth client ID', value: clientId, placeholder: '….apps.googleusercontent.com', attrs: { autocomplete: 'off', spellcheck: 'false' } }] })}
    ${srow('Google account', { desc: profile ? `${profile.name} (${profile.email})` : 'Not signed in', find: 'google account sign in sign out',
      actions: [profile ? { id: 'google-signout', label: 'Sign out', icon: 'close' } : { id: 'google-signin', label: 'Sign in', icon: 'user' }] })}
    ${srow('Shared folder', { desc: viewOnly() ? 'This project is shared with you for viewing; your changes are not saved' : 'Open a project folder shared with you in Google Drive', find: 'google drive folder shared team open',
      actions: [{ id: 'google-open', label: 'Open Drive folder', icon: 'cloud' }] })}`;
}

/** Wires the rows; `ctx.rerender` draws the page again, `ctx.say` tells the person. */
export function wireDrive(el, ctx) {
  el.querySelector('#s-google-client')?.addEventListener('change', e => setGoogleClientId(e.target.value));
  el.querySelector('#google-signin')?.addEventListener('click', () => signIn().then(() => {
    // The Google name fills an empty name and initials in You: decisions, owners and comments carry it.
    const { profile } = googleSettings(), you = appValues();
    if (profile?.name && !you.reviewerName) saveApp('reviewerName', profile.name);
    if (profile?.name && !you.reviewerInitials) saveApp('reviewerInitials', initialsOf(profile.name));
    ctx.rerender();
  }, err => ctx.say?.(err.message)));
  el.querySelector('#google-signout')?.addEventListener('click', () => { signOut(); ctx.rerender(); });
  el.querySelector('#google-open')?.addEventListener('click', () => openFromDrive().catch(err => ctx.say?.(err.message)));
}
