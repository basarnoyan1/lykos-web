// Opening a Google Drive folder as a project from a press (the app menu, Settings › Google Drive): asks for the folder's link, signs in
// with Google when needed (a popup, which a press allows), and opens it (lib/projects.mjs openDriveFolder).
import { ask } from './dialog.mjs';
import { googleSettings, signedIn, signIn } from './google-auth.mjs';
import { openDriveFolder } from './projects.mjs';

export async function openFromDrive() {
  // no OAuth client yet: the caller opens Settings › Google Drive, where it is entered
  if (!googleSettings().clientId) throw Object.assign(new Error('Add your Google OAuth client ID in Settings › Google Drive first'), { name: 'NoClientId' });
  const link = await ask('Open a Google Drive folder', { placeholder: 'Folder link from Share › Copy link', confirm: 'Open' });
  if (!link) return false;
  if (!signedIn()) await signIn();
  return openDriveFolder(link);
}
