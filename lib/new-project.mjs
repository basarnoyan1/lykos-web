import { icon } from './icons.mjs';
import { formDialog } from './dialog.mjs';
import { formField } from './ui-components.mjs';
import { esc } from './html.mjs';

export const projectFolderName = name => String(name || '').trim().replace(/[<>:"/\\|?*\x00-\x1f]/g, '-').replace(/^[. ]+|[. ]+$/g, '').slice(0, 120);

/** A fresh child directory, never an existing project's location. */
export async function initializeProjectFolder(parent, name, state) {
  const child = projectFolderName(name);
  if (!child) throw new Error('Enter a project name that can be used as a folder name.');
  if ((await parent.stat(child)).exists) throw new Error('A folder with this name already exists. Choose another name.');
  await parent.mkdir(child);
  await parent.writeText(`${child}/.lykos/project.json`, JSON.stringify(state));
  return child;
}

/** Name and destination of a new, empty project (the create recipe: formDialog). Resolves true once created, false when cancelled. */
export async function newProjectDialog({ chooseFolder, create, canChooseFolder, preferFolder = canChooseFolder, initialParent = null, name = '' }) {
  const body = `${formField('Project name', `<input id="new-project-name" required maxlength="160" placeholder="My research project" autocomplete="off" value="${esc(String(name).slice(0, 160))}">`)}
    ${canChooseFolder ? formField('Save location', `<select id="new-project-storage" name="new-project-storage"><option value="app"${preferFolder ? '' : ' selected'}>App storage</option><option value="folder"${canChooseFolder ? (preferFolder ? ' selected' : '') : ' disabled'}>Project folder${canChooseFolder ? '' : ' (not available here)'}</option></select>`) : `<input type="hidden" id="new-project-storage" name="new-project-storage" value="app">`}
    ${formField('Parent folder', `<span class="record-picker"><button type="button" id="new-project-browse" title="Choose parent folder">${icon('folder')}<span id="new-project-parent">${esc(initialParent && canChooseFolder ? initialParent.path || initialParent.name : 'Choose parent folder')}</span></button></span>`)}
    <p class="meta" id="new-project-preview" hidden>Creates <span id="new-project-path"></span></p>
    <p class="note" id="new-project-error" role="alert" hidden></p>`;
  let chosen = canChooseFolder ? initialParent : null;   // the folder the last project was made in, so a second project is name and Create
  const done = await formDialog({ id: 'new-project', title: 'New project', tier: 'M', confirm: 'Create project', body,
    onMount: d => {
      const name = d.querySelector('#new-project-name'), storage = d.querySelector('#new-project-storage'), error = d.querySelector('#new-project-error');
      const browse = d.querySelector('#new-project-browse'), folderField = browse.closest('label'), previewEl = d.querySelector('#new-project-preview');
      const fail = text => { error.textContent = text; error.hidden = !text; };
      const preview = () => {
        previewEl.hidden = storage.value !== 'folder' || !chosen;
        d.querySelector('#new-project-path').textContent = chosen ? `${(chosen.path || chosen.name).replace(/\/+$/, '')}/${projectFolderName(name.value) || 'Project name'}` : '';
      };
      const sync = () => { folderField.hidden = storage.value !== 'folder'; fail(''); preview(); };
      name.oninput = () => { name.setCustomValidity(''); preview(); };
      storage.onchange = sync;
      sync();
      browse.onclick = async () => {
        fail('');
        try { const result = await chooseFolder(); if (result) { chosen = result; d.querySelector('#new-project-parent').textContent = chosen.path || chosen.name; browse.title = chosen.path || chosen.name; preview(); } }
        catch (e) { fail(e.message); }
      };
    },
    submit: async (form, d) => {
      const name = d.querySelector('#new-project-name'), storage = d.querySelector('#new-project-storage'), error = d.querySelector('#new-project-error');
      const fail = text => { error.textContent = text; error.hidden = !text; };
      if (!name.value.trim()) { name.setCustomValidity('Enter a project name'); name.reportValidity(); return undefined; }
      if (storage.value === 'folder' && !chosen) { fail('Choose a parent folder first.'); d.querySelector('#new-project-browse').focus(); return undefined; }
      fail('');
      const controls = [...d.querySelectorAll('button,input,select')];
      controls.forEach(c => { c.disabled = true; });
      try { await create({ name: name.value.trim(), chosen: storage.value === 'folder' ? chosen : null }); return true; }
      catch (e) {
        fail(e.message);
        controls.forEach(c => { c.disabled = false; });
        const folderOption = d.querySelector('#new-project-storage option[value="folder"]'); if (folderOption) folderOption.disabled = !canChooseFolder;
        return undefined;
      }
    } });
  return done === true;
}
