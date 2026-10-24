// Opening a project kept in a Google Drive folder (plan §2, "Working as a team"): loaded with the first Drive folder, not with the shell.
// lib/projects.mjs lists and opens it; this module signs in, reaches the folder and says whether it may be written.
import { confirmAsk } from './dialog.mjs';
import { driveFolder, driveFolderId } from './drive-folder.mjs';
import { accessToken, signIn, SignInNeeded } from './google-auth.mjs';

/** Whether this tab holds a live token for `entry`, asking for a sign-in (a press) when the hour is over. */
export async function signedInFor(entry) {
  try { await accessToken(); return true; }
  catch (err) {
    if (!(err instanceof SignInNeeded)) throw err;
    const yes = await confirmAsk(`Open ${entry.name || 'the Drive folder'}`, { detail: 'Sign in with Google to open this Drive folder', confirm: 'Sign in' });
    if (!yes) return false;
    try { await signIn({ quiet: true }); return true; } catch { return false; }
  }
}

/** The folder object; one shared with this person for viewing is read-only, and the store never writes it (store.mjs, readOnly). */
export async function driveFolderFor(driveId, name) {
  const f = driveFolder({ rootId: driveId, name, token: accessToken });
  const access = await f.access();
  f.name = access.name;
  f.readOnly = !access.canEdit;
  return f;
}

/** What lib/projects.mjs opens for a pasted folder link; `projectIn` reads a folder's project, if it has one. */
export async function chosenFromLink(link, projectIn) {
  const driveId = driveFolderId(link);
  if (!driveId) throw new Error('Paste the link of a Google Drive folder');
  await accessToken();
  const f = await driveFolderFor(driveId);
  if (f.readOnly && !(await projectIn(f))) throw new Error('This folder holds no Lykos project, and it is shared with you for viewing only');
  return { kind: 'drive', driveId, folder: f, name: f.name };
}
