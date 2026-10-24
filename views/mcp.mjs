import { get } from '../store.mjs';
import { when } from '../lib/dates.mjs';
import { esc } from '../lib/html.mjs';
import { uiBar, uiList, uiRow, uiSettingsRow } from '../lib/ui-actions.mjs';
import { disclosure } from '../lib/ui-components.mjs';
import { configQueue } from '../lib/queued-config.mjs';
import { activeFolder } from '../lib/projects.mjs';
import { connectMcp, disconnectMcp, mcpStatus, mcpTools } from '../lib/mcp-access.mjs';
export const meta = { title: 'MCP access', icon: 'connector' };

// The file server (tools/lykos-mcp.mjs) reads each project's .lykos/mcp.json
// for exposure and write permission, and logs calls to .lykos/mcp-log.jsonl.
const CONFIG = '.lykos/mcp.json', LOG = '.lykos/mcp-log.jsonl';
let script = null;
const serverScript = async () => script ??= await fetch('./mcp-server.json').then(r => r.json()).then(j => j.script).catch(() => '');
const quote = s => `"${String(s).replace(/(["\\$`])/g, '\\$1')}"`;
const parent = p => p.slice(0, p.lastIndexOf('/')) || '/';
const size = n => n < 1024 ? `${n} B` : `${Math.round(n / 1024)} KB`;
const brief = args => Object.entries(args || {}).map(([k, v]) => `${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`).join(', ').slice(0, 120);

async function readConfig(folder) {
  if (!(await folder.stat(CONFIG)).exists) return { expose: true, write: false, scope: 'project' };
  const c = JSON.parse(new TextDecoder().decode(await folder.read(CONFIG)));
  if (!c || typeof c !== 'object' || Array.isArray(c)) throw new Error('Project access settings are invalid');
  return { expose: c.expose !== false, write: c.write === true, scope: c.scope === 'all' ? 'all' : 'project' };
}
async function readLog(folder) {
  try { return new TextDecoder().decode(await folder.read(LOG)).trim().split('\n').slice(-30).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean).reverse(); }
  catch { return []; }
}

let serial = 0;
const writes = new WeakMap();
function writer(folder) {
  if (!writes.has(folder)) writes.set(folder, { pending: 0, message: '', enqueue: configQueue(() => readConfig(folder), cfg => folder.writeText(CONFIG, JSON.stringify(cfg, null, 2) + '\n')) });
  return writes.get(folder);
}
export async function render(el, ctx) {
  const mine = ++serial;   // a render started later (a filter keystroke) wins; this one stops
  const status = mcpStatus(), tools = mcpTools();
  const folder = activeFolder();
  const root = folder?.kind === 'path' ? folder.root : '';
  let cfg;
  try { cfg = folder ? await readConfig(folder) : null; }
  catch (error) {
    if (mine !== serial || !el.isConnected) return;
    el.innerHTML = `<div class="mcp-settings"><p class="note" role="alert">Could not read project access settings: ${esc(error.message || error)}</p><button type="button" id="mcp-retry">Retry</button></div>`;
    el.querySelector('#mcp-retry').onclick = () => render(el, ctx); return;
  }
  const log = folder ? await readLog(folder) : [];
  const path = await serverScript() || '<Lykos source>/tools/lykos-mcp.mjs';   // the build leaves the path out: a placeholder the person replaces
  if (mine !== serial || !el.isConnected) return;
  const target = root ? (cfg.scope === 'all' ? parent(root) : root) : '<project folder>';
  const command = `node ${quote(path)} --root ${quote(target)}`;
  const claude = `claude mcp add lykos -- ${command}`;
  const activity = [
    ...log.map(a => ({ at: a.at, tool: a.tool, detail: brief(a.args), result: a.error ? 'Failed' : size(a.bytes || 0) })),
    ...(get().mcpActivity || []).map(a => ({ at: a.at, tool: `app ${a.tool}`, detail: '', result: a.failed ? 'Failed' : 'Completed' })),
  ].sort((a, b) => String(b.at).localeCompare(String(a.at))).slice(0, 25);
  let rows = 0;
  const srow = (find, name, { desc = '', filters = [], actions = [] } = {}) => { const id = `mcp-row-${++rows}`;
    return uiSettingsRow({ id, label: name, description: desc, attrs: { 'data-find': find }, controls: { id: `${id}-bar`, label: name, filters, actions } }); };
  const copyAct = id => ({ id, label: 'Copy', icon: 'copy', dynamic: true, labels: ['Copy', 'Copied'] });
  const toolRows = tools.map(t => uiRow({ main: { html: `<strong>${esc(t.name.replaceAll('_', ' '))}</strong>`, detail: [esc(t.description)], wrap: true } }));
  const activityRows = activity.map(a => uiRow({ main: { html: esc(a.tool.replaceAll('_', ' ')), detail: [esc(a.detail), esc(a.result), esc(when(a.at))], wrap: true } }));
  el.innerHTML = `<div class="mcp-settings">
    <h3 class="setl-subhead">Project files</h3>
    ${folder ? `
    ${srow('mcp projects exposed root', 'Projects', { desc: 'Assistants such as Claude Code read this folder\'s tables, documents and review state through a local server, in small pages.',
      filters: [{ type: 'select', id: 'mcp-scope', label: 'Projects', value: cfg.scope, attrs: root ? {} : { disabled: true },
        options: [['project', 'This project'], ['all', `All projects in ${root ? parent(root).split('/').pop() : 'its parent folder'}`]] }] })}
    ${srow('mcp expose visible', 'This project', { filters: [{ type: 'check', id: 'mcp-expose', label: 'Visible to MCP clients', value: cfg.expose, foldable: false }] })}
    ${srow('mcp write files notes', 'File writes', { desc: 'Writes create new files only. An existing name becomes the next version; older versions move to the archive folder.',
      filters: [{ type: 'check', id: 'mcp-write', label: 'Allow new files and notes', value: cfg.write, foldable: false, attrs: cfg.expose ? {} : { disabled: true } }] })}
    ${srow('mcp command claude code', 'Claude Code', { desc: claude, actions: [copyAct('mcp-copy-claude')] })}
    ${srow('mcp command other clients', 'Other clients', { desc: command, actions: [copyAct('mcp-copy-cmd')] })}
    ` : ''}
    ${folder ? `<p class="note" id="mcp-config-status" role="status">${esc(writer(folder).message)}</p>` : ''}
    <h3 class="setl-subhead">Open app</h3>
    ${srow('bridge address connection', 'Bridge address', { desc: 'Connected, assistants also use app tools. Their edits, values and screening decisions wait here for your review.',
      filters: [{ type: 'field', id: 'mcp-url', label: 'Bridge address', width: 'flex', value: status.url || 'http://127.0.0.1:8750', attrs: { spellcheck: 'false', ...(status.connected ? { disabled: true } : {}) } }] })}
    ${srow('pairing token password', 'Pairing token', { desc: 'From ~/.lykos/mcp-bridge.json',
      filters: [{ type: 'field', id: 'mcp-token', label: 'Pairing token', width: 'flex', inputType: 'password', placeholder: 'Paste pairing token', attrs: status.connected ? { disabled: true } : {} }] })}
    ${uiBar({ kind: 'foot', label: 'Connection', id: 'mcp-connect-bar', start: { message: status.connected ? 'Connected for this session' : (status.error || 'Disconnected'), id: 'mcp-state' },
      actions: [{ id: 'mcp-connect', label: status.connected ? 'Disconnect' : 'Connect project', icon: status.connected ? 'close' : 'plus', role: status.connected ? 'secondary' : 'primary' }] })}
    ${disclosure({ title: 'App tools', count: tools.length, body: uiList({ label: 'App tools', rows: toolRows, empty: '<p class="meta">No tools</p>' }) })}
    ${disclosure({ title: 'Recent activity', count: activity.length || null, meta: activity.length ? '' : 'None yet', body: uiList({ label: 'Recent activity', rows: activityRows, empty: '<p class="meta">None yet</p>' }) })}
  </div>`;
  const save = async patch => {
    const job = writer(folder); if (!job.pending) job.errors = []; job.pending++; job.message = 'Saving project access settings…';
    const status = el.querySelector('#mcp-config-status'); if (status) status.textContent = job.message;
    el.querySelector('.mcp-settings')?.setAttribute('aria-busy', 'true');
    try { await job.enqueue(patch); job.message = 'Project access settings saved'; }
    catch (error) { job.errors.push(String(error.message || error)); }
    finally { job.pending--; if (!job.pending) { job.message = job.errors.length ? `Some project access settings could not be saved: ${job.errors.join('; ')}` : 'Project access settings saved'; if (el.isConnected) await render(el, ctx); } }
  };
  const copy = (id, text) => { const b = el.querySelector(id); if (b) b.onclick = async () => { try { await navigator.clipboard.writeText(text); b.querySelector('span').textContent = 'Copied'; } catch { b.querySelector('span').textContent = 'Copy failed'; } }; };
  if (folder) {
    el.querySelector('#mcp-scope').onchange = e => save({ scope: e.target.value });
    el.querySelector('#mcp-expose').onchange = e => save({ expose: e.target.checked, ...(e.target.checked ? {} : { write: false }) });
    const write = el.querySelector('#mcp-write'); if (write) write.onchange = e => save({ write: e.target.checked });
    copy('#mcp-copy-claude', claude); copy('#mcp-copy-cmd', command);
  }
  el.querySelector('#mcp-connect').onclick = async () => {
    const button = el.querySelector('#mcp-connect'); button.disabled = true;
    try {
      if (mcpStatus().connected) await disconnectMcp();
      else await connectMcp(el.querySelector('#mcp-url').value.trim(), el.querySelector('#mcp-token').value.trim());
      await render(el, ctx);
    } catch (e) { el.querySelector('#mcp-state').textContent = e.message; button.disabled = false; }
  };
}
